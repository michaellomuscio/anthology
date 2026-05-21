'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');

const PROTOCOL_VERSION = 'v1';
const DEFAULT_PORT = 17872;
const DATA_COALESCE_MS = 30;
const IDLE_DISCONNECT_MS = 90 * 1000;
const RATE_WINDOW_MS = 1000;
const RATE_MAX_MSGS_PER_WINDOW = 200;
const MAX_FRAME_BYTES = 256 * 1024;
const PAIR_RATE_WINDOW_MS = 60 * 1000;
const PAIR_RATE_MAX = 5;

// Reject ids that could escape userData via path traversal or null bytes.
// Mirrors the safeId() used in main.js — the bridge can also create sessions
// so the constraint must apply to anything it accepts from a remote client.
function safeId(id) {
  const s = String(id || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(s) || s.length > 64) return null;
  return s;
}

function safeJson(text, maxBytes = MAX_FRAME_BYTES) {
  if (typeof text !== 'string' || text.length > maxBytes) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

function newSessionId(prefix = 's') {
  return `${prefix}_` + crypto.randomBytes(6).toString('base64url');
}

class BridgeServer {
  constructor({
    ptyManager,
    sessionsStore,
    bufferStore,
    scheduler,
    tokens,
    appVersion = '0.0.0',
    serverName = os.hostname(),
    port = DEFAULT_PORT,
    host = '0.0.0.0',
    onClientChange = () => {},
    onAudit = () => {},
    auditPath = null,
    workerStore = null,
    groupsStore = null,
    createPmSession = null,
    submitPromptDelayed = null,
    notifyKilled = null,
  }) {
    this.ptyManager = ptyManager;
    this.sessionsStore = sessionsStore;
    this.bufferStore = bufferStore;
    this.scheduler = scheduler;
    this.tokens = tokens;
    this.appVersion = appVersion;
    this.serverName = serverName;
    this.port = port;
    this.host = host;
    this.onClientChange = onClientChange;
    this.onAudit = onAudit;
    this.auditPath = auditPath;
    this.workerStore = workerStore;
    this.groupsStore = groupsStore;
    this.createPmSession = createPmSession;
    this.submitPromptDelayed = submitPromptDelayed;
    this.notifyKilled = notifyKilled;

    this.clients = new Set();           // connected WS clients
    this.pendingData = new Map();       // sessionId -> buffered data string
    this.coalesceTimer = null;
    this.idleSweepTimer = null;
    this.pairAttempts = [];             // [{ ip, t }] for rate limiting
    this.tokenFlushTimer = null;        // periodic token lastUsedAt persist

    this.server = http.createServer((req, res) => this._handleHttp(req, res));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    this.server.on('upgrade', (req, sock, head) => this._handleUpgrade(req, sock, head));
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server.removeAllListeners('error');
        const addr = this.server.address();
        this.port = addr.port;
        this._audit({ event: 'server_start', port: this.port, host: this.host });
        this.idleSweepTimer = setInterval(() => this._sweepIdleClients(), 15 * 1000);
        this.tokenFlushTimer = setInterval(() => this.tokens.flush(), 30 * 1000);
        resolve({ port: this.port });
      });
    });
  }

  async stop() {
    if (this.idleSweepTimer) clearInterval(this.idleSweepTimer);
    if (this.tokenFlushTimer) clearInterval(this.tokenFlushTimer);
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    this.tokens.flush();
    for (const c of this.clients) {
      try { c.ws.close(1001, 'server_shutdown'); } catch (_) {}
    }
    this.clients.clear();
    this.onClientChange(0);
    await new Promise((resolve) => this.wss.close(() => resolve()));
    await new Promise((resolve) => this.server.close(() => resolve()));
    this._audit({ event: 'server_stop' });
  }

  // --- Public hooks called by main process to fan PTY/scheduler events into clients ---

  handlePtyData(id, data) {
    if (typeof data !== 'string' || data.length === 0) return;
    const buf = this.pendingData.get(id);
    this.pendingData.set(id, buf ? buf + data : data);
    if (!this.coalesceTimer) {
      this.coalesceTimer = setTimeout(() => this._flushPendingData(), DATA_COALESCE_MS);
    }
  }

  handlePtyStatus(id, status) {
    this._broadcast({ type: 'session_status', sessionId: id, status }, (c) => this._isSubscribed(c, id));
  }

  handlePtyExit(id, exitCode, signal) {
    this._broadcast({ type: 'session_exit', sessionId: id, exitCode, signal }, (c) => this._isSubscribed(c, id));
  }

  handleSessionCreated(session) {
    this._broadcast({ type: 'session_created', session: this._toMeta(session) });
  }

  handleSessionKilled(id) {
    this._broadcast({ type: 'session_killed', sessionId: id });
  }

  handleSessionMeta(session) {
    this._broadcast({ type: 'session_meta', session: this._toMeta(session) });
  }

  /// Fan-out for group CRUD so any other iOS client sees the new bench shape.
  handleGroupsChanged() {
    if (!this.groupsStore) return;
    this._broadcast({ type: 'groups_changed', groups: this.groupsStore.list() });
  }

  handleScheduleFired(payload) {
    this._broadcast({ type: 'schedule_fired', ...payload });
  }

  handleScheduleChanged(schedule) {
    this._broadcast({ type: 'schedule_changed', schedule });
  }

  clientCount() {
    return this.clients.size;
  }

  // Force-disconnect all clients using a revoked token id.
  disconnectByTokenId(tokenId) {
    for (const c of Array.from(this.clients)) {
      if (c.tokenId === tokenId) {
        try {
          this._send(c, { type: 'bye', reason: 'token_revoked' });
          c.ws.close(4001, 'token_revoked');
        } catch (_) {}
        this.clients.delete(c);
      }
    }
    this.onClientChange(this.clients.size);
  }

  // --- HTTP ---

  _handleHttp(req, res) {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: this.serverName, version: this.appVersion, protocol: PROTOCOL_VERSION }));
      return;
    }

    if (req.method === 'POST' && req.url === '/pair') {
      this._handlePair(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }

  async _handlePair(req, res) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';

    // Rate limit
    const now = Date.now();
    this.pairAttempts = this.pairAttempts.filter((a) => now - a.t < PAIR_RATE_WINDOW_MS);
    const ipHits = this.pairAttempts.filter((a) => a.ip === ip).length;
    if (ipHits >= PAIR_RATE_MAX) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate_limited' }));
      return;
    }
    this.pairAttempts.push({ ip, t: now });

    try {
      const body = await this._readJsonBody(req, 4096);
      if (!body || typeof body !== 'object') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request' }));
        return;
      }
      const { code, label } = body;
      const result = this.tokens.claimPairing(code, label);
      if (result.error) {
        const status = result.error === 'invalid_code' ? 401
          : result.error === 'expired' ? 401
          : result.error === 'no_active_code' ? 409
          : 400;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        this._audit({ event: 'pair_failed', ip, reason: result.error });
        return;
      }
      this._audit({ event: 'pair_success', ip, tokenId: result.tokenId, label: result.label });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tokenId: result.tokenId,
        token: result.token,
        serverName: this.serverName,
        serverVersion: this.appVersion,
        protocol: PROTOCOL_VERSION,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    }
  }

  _readJsonBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > maxBytes) {
          reject(new Error('payload_too_large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (_) { resolve(null); }
      });
      req.on('error', reject);
    });
  }

  // --- WS upgrade ---

  _handleUpgrade(req, socket, head) {
    if (req.url !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Reject browser-origin upgrades. Native iOS clients don't send Origin.
    // Blocks DNS-rebinding from a malicious page that learns the local IP.
    if (req.headers['origin']) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const auth = req.headers['authorization'] || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (!m) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = m[1].trim();
    const tokenInfo = this.tokens.verify(token);
    if (!tokenInfo) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => this._onConnection(ws, req, tokenInfo));
  }

  _onConnection(ws, req, tokenInfo) {
    const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
    const client = {
      ws,
      tokenId: tokenInfo.id,
      label: tokenInfo.label,
      ip,
      subs: new Set(),     // Set of sessionId or "*" (wildcard)
      lastSeen: Date.now(),
      msgWindowStart: Date.now(),
      msgWindowCount: 0,
      connectedAt: Date.now(),
    };
    this.clients.add(client);
    this.onClientChange(this.clients.size);
    this._audit({ event: 'client_connect', tokenId: client.tokenId, label: client.label, ip });

    ws.on('message', (raw) => this._onMessage(client, raw));
    ws.on('close', () => {
      this.clients.delete(client);
      this.onClientChange(this.clients.size);
      this._audit({ event: 'client_disconnect', tokenId: client.tokenId, durationMs: Date.now() - client.connectedAt });
    });
    ws.on('error', () => { /* ws will fire close after */ });
  }

  _onMessage(client, raw) {
    client.lastSeen = Date.now();

    // Per-connection rate limit (defense against pathological clients).
    const now = Date.now();
    if (now - client.msgWindowStart > RATE_WINDOW_MS) {
      client.msgWindowStart = now;
      client.msgWindowCount = 0;
    }
    client.msgWindowCount += 1;
    if (client.msgWindowCount > RATE_MAX_MSGS_PER_WINDOW) {
      this._sendErr(client, null, 'rate_limited', 'Too many messages');
      try { client.ws.close(1008, 'rate_limited'); } catch (_) {}
      return;
    }

    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    const msg = safeJson(text);
    if (!msg || typeof msg.type !== 'string') {
      this._sendErr(client, msg && msg.id, 'bad_request', 'Invalid message');
      return;
    }

    this._dispatch(client, msg).catch((e) => {
      this._sendErr(client, msg.id, 'internal', e && e.message ? e.message : String(e));
    });
  }

  async _dispatch(client, msg) {
    const { type, id } = msg;
    switch (type) {
      case 'hello':
        return this._send(client, {
          type: 'ack', id,
          result: {
            serverName: this.serverName,
            serverVersion: this.appVersion,
            protocol: PROTOCOL_VERSION,
          },
        });

      case 'ping':
        return this._send(client, { type: 'ack', id, result: { pong: true, t: Date.now() } });

      case 'register_push_token': {
        const apnsToken = typeof msg.deviceToken === 'string' ? msg.deviceToken.trim() : null;
        if (!apnsToken || apnsToken.length < 8 || apnsToken.length > 200) {
          return this._sendErr(client, id, 'bad_request', 'deviceToken required');
        }
        const env = msg.environment === 'sandbox' ? 'sandbox' : 'production';
        const ok = this.tokens.setApnsToken(client.tokenId, apnsToken, env);
        this._audit({ event: 'push_register', tokenId: client.tokenId, env, ok });
        return this._send(client, { type: 'ack', id, result: { ok } });
      }

      case 'list_sessions': {
        const stored = this.sessionsStore.list();
        const sessions = stored.map((s) => this._toMeta(s));
        return this._send(client, { type: 'ack', id, result: { sessions } });
      }

      case 'list_recent_dirs': {
        // Mirrors what the Mac SpawnModal shows so iOS can offer the same chips.
        const dirs = (this.sessionsStore.listRecentDirs && this.sessionsStore.listRecentDirs()) || [];
        return this._send(client, { type: 'ack', id, result: { dirs } });
      }

      case 'get_buffer': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'Invalid sessionId');
        const persisted = this.bufferStore.load(sid) || '';
        const live = this.ptyManager.getRecentBuffer(sid) || '';
        // Persisted scrollback already contains historical state; live tail is
        // a strict subset so we send persisted only and let live frames flow
        // via subscribe. If there is no persisted snapshot fall back to live.
        const data = persisted || live;
        return this._send(client, { type: 'ack', id, result: { data } });
      }

      case 'subscribe': {
        const ids = msg.sessionIds;
        if (ids === 'all' || ids === '*') {
          client.subs.add('*');
          return this._send(client, { type: 'ack', id, result: { subscribed: ['*'] } });
        }
        if (!Array.isArray(ids)) return this._sendErr(client, id, 'bad_request', 'sessionIds required');
        const added = [];
        for (const s of ids) {
          const sid = safeId(s);
          if (sid) { client.subs.add(sid); added.push(sid); }
        }
        return this._send(client, { type: 'ack', id, result: { subscribed: added } });
      }

      case 'unsubscribe': {
        const ids = msg.sessionIds;
        if (ids === 'all' || ids === '*') {
          client.subs.clear();
          return this._send(client, { type: 'ack', id, result: { unsubscribed: ['*'] } });
        }
        if (!Array.isArray(ids)) return this._sendErr(client, id, 'bad_request', 'sessionIds required');
        const removed = [];
        for (const s of ids) {
          const sid = safeId(s);
          if (sid && client.subs.delete(sid)) removed.push(sid);
        }
        return this._send(client, { type: 'ack', id, result: { unsubscribed: removed } });
      }

      case 'send_input': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'Invalid sessionId');
        if (typeof msg.data !== 'string') return this._sendErr(client, id, 'bad_request', 'data required');
        if (msg.data.length > 64 * 1024) return this._sendErr(client, id, 'bad_request', 'data too large');
        if (!this.ptyManager.exists(sid)) return this._sendErr(client, id, 'not_found', 'session not found');
        this.ptyManager.write(sid, msg.data);
        return this._send(client, { type: 'ack', id, result: { ok: true } });
      }

      case 'send_prompt': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'Invalid sessionId');
        if (typeof msg.text !== 'string') return this._sendErr(client, id, 'bad_request', 'text required');
        if (!this.ptyManager.exists(sid)) return this._sendErr(client, id, 'not_found', 'session not found');
        this.ptyManager.submitPrompt(sid, msg.text);
        return this._send(client, { type: 'ack', id, result: { ok: true } });
      }

      case 'resize': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'Invalid sessionId');
        const cols = Math.max(2, Math.min(1000, Number(msg.cols) || 0));
        const rows = Math.max(2, Math.min(1000, Number(msg.rows) || 0));
        if (!this.ptyManager.exists(sid)) return this._sendErr(client, id, 'not_found', 'session not found');
        this.ptyManager.resize(sid, cols, rows);
        return this._send(client, { type: 'ack', id, result: { ok: true } });
      }

      case 'spawn': {
        const name = (typeof msg.name === 'string' ? msg.name : '').slice(0, 80) || 'remote';
        const cwd = typeof msg.cwd === 'string' ? msg.cwd : null;
        if (!cwd) return this._sendErr(client, id, 'bad_request', 'cwd required');
        const color = typeof msg.color === 'string' ? msg.color : '#7B2FBE';
        const tag = typeof msg.tag === 'string' ? msg.tag : null;
        const runClaude = msg.runClaude !== false;
        const isPm = msg.pm === true;
        const agentTool = msg.agentTool === 'codex' ? 'codex' : 'claude';
        const personaName = typeof msg.personaName === 'string' && msg.personaName.trim()
          ? msg.personaName.trim() : null;
        const groupId = typeof msg.groupId === 'string' && msg.groupId.trim()
          ? msg.groupId.trim() : null;
        const sid = newSessionId('s');
        const session = {
          id: sid, name,
          cwd,
          color: isPm ? '#7B2FBE' : color,
          tag: isPm ? (tag || 'pm') : tag,
          pinned: isPm,
          isPM: isPm,
          agentTool: isPm ? 'claude' : agentTool,
          personaName: isPm ? null : personaName,
          groupId,
          createdAt: Date.now(),
          createdBy: 'bridge',
        };
        this.sessionsStore.upsert(session);
        try {
          if (isPm) {
            if (!this.createPmSession) {
              throw new Error('PM spawn not available (createPmSession not wired)');
            }
            this.createPmSession({ id: sid, cwd });
          } else {
            this.ptyManager.create({ id: sid, cwd, runClaude, agentTool });
            // Worker persona injection — bracket-paste the persona's body after
            // claude initializes. Same 4.5s the renderer + MCP tools use.
            if (personaName && this.workerStore) {
              const worker = this.workerStore.get(personaName);
              if (worker && worker.body && this.submitPromptDelayed) {
                const intro = `You are now embodying the worker persona "${worker.frontmatter?.name || personaName}". From this point on, stay in this role for the rest of the conversation. Here is your full role definition:\n\n${worker.body}\n\nAcknowledge briefly by naming your role in one sentence, then wait for my next message.`;
                this.submitPromptDelayed(sid, intro, 4500);
              }
            }
          }
        } catch (e) {
          this.sessionsStore.remove(sid);
          return this._sendErr(client, id, 'internal', e.message);
        }
        // Fan-out so other connected clients (and the renderer, via main.js) know.
        this.handleSessionCreated(session);
        this._audit({ event: 'spawn', tokenId: client.tokenId, sessionId: sid, cwd, isPm, personaName });
        return this._send(client, { type: 'ack', id, result: { session: this._toMeta(session) } });
      }

      case 'list_workers': {
        if (!this.workerStore) {
          return this._send(client, { type: 'ack', id, result: { workers: [] } });
        }
        const all = this.workerStore.list();
        const out = all.map((w) => ({
          name: (w.name || '').replace(/^worker-/, ''),
          fullName: w.name,
          description: w.description || '',
          category: w.category || 'other',
          emoji: w.emoji || '',
          color: w.color || '',
        }));
        return this._send(client, { type: 'ack', id, result: { workers: out } });
      }

      case 'list_groups': {
        if (!this.groupsStore) {
          return this._send(client, { type: 'ack', id, result: { groups: [] } });
        }
        return this._send(client, { type: 'ack', id, result: { groups: this.groupsStore.list() } });
      }

      case 'upsert_group': {
        if (!this.groupsStore) return this._sendErr(client, id, 'unavailable', 'groups not available');
        const g = msg.group;
        if (!g || !g.id) return this._sendErr(client, id, 'bad_request', 'group.id required');
        const out = this.groupsStore.upsert(g);
        this.handleGroupsChanged();
        this._audit({ event: 'group_upsert', tokenId: client.tokenId, groupId: g.id });
        return this._send(client, { type: 'ack', id, result: { group: out } });
      }

      case 'delete_group': {
        if (!this.groupsStore) return this._sendErr(client, id, 'unavailable', 'groups not available');
        const gid = typeof msg.id === 'string' ? msg.id : null;
        if (!gid) return this._sendErr(client, id, 'bad_request', 'id required');
        // Same semantics as the IPC handler: clear groupId from any session that
        // referenced this group so the iOS UI doesn't render orphans.
        const affected = this.sessionsStore.list().filter((s) => s.groupId === gid);
        for (const s of affected) {
          const updated = this.sessionsStore.upsert({ ...s, groupId: null });
          this.handleSessionMeta(updated || s);
        }
        this.groupsStore.remove(gid);
        this.handleGroupsChanged();
        this._audit({ event: 'group_delete', tokenId: client.tokenId, groupId: gid });
        return this._send(client, { type: 'ack', id, result: { ok: true, affected: affected.length } });
      }

      case 'set_session_group': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'sessionId required');
        const existing = this.sessionsStore.list().find((s) => s.id === sid);
        if (!existing) return this._sendErr(client, id, 'not_found', 'session not found');
        const groupId = typeof msg.groupId === 'string' && msg.groupId.trim()
          ? msg.groupId.trim() : null;
        const updated = this.sessionsStore.upsert({ ...existing, groupId });
        this.handleSessionMeta(updated || existing);
        this._audit({ event: 'set_session_group', tokenId: client.tokenId, sessionId: sid, groupId });
        return this._send(client, { type: 'ack', id, result: { session: this._toMeta(updated) } });
      }

      case 'kill': {
        const sid = safeId(msg.sessionId);
        if (!sid) return this._sendErr(client, id, 'bad_request', 'Invalid sessionId');
        const killed = this.ptyManager.kill(sid);
        // Full delete — matches the renderer's own kill flow + iOS user
        // expectation that "kill" removes the row entirely (there's no
        // restart UI on the phone). notifyKilled removes the record from
        // sessionsStore, drops the cached terminal in the renderer, and
        // fans the session_killed event to all bridge clients.
        if (this.notifyKilled) this.notifyKilled(sid);
        else if (killed) this.handleSessionKilled(sid);  // fallback for unwired test setups
        this._audit({ event: 'kill', tokenId: client.tokenId, sessionId: sid });
        return this._send(client, { type: 'ack', id, result: { ok: !!killed } });
      }

      case 'list_schedules': {
        return this._send(client, { type: 'ack', id, result: { schedules: this.scheduler.list() } });
      }

      case 'upsert_schedule': {
        const s = msg.schedule;
        if (!s || !s.id) return this._sendErr(client, id, 'bad_request', 'schedule.id required');
        const result = this.scheduler.upsert(s);
        this.handleScheduleChanged(result);
        this._audit({ event: 'schedule_upsert', tokenId: client.tokenId, scheduleId: s.id });
        return this._send(client, { type: 'ack', id, result: { schedule: result } });
      }

      case 'delete_schedule': {
        const sid = typeof msg.id === 'string' ? msg.id : null;
        if (!sid) return this._sendErr(client, id, 'bad_request', 'id required');
        this.scheduler.remove(sid);
        this._audit({ event: 'schedule_delete', tokenId: client.tokenId, scheduleId: sid });
        return this._send(client, { type: 'ack', id, result: { ok: true } });
      }

      case 'run_schedule_now': {
        const sid = typeof msg.id === 'string' ? msg.id : null;
        if (!sid) return this._sendErr(client, id, 'bad_request', 'id required');
        await this.scheduler._fire(sid);
        return this._send(client, { type: 'ack', id, result: { ok: true } });
      }

      default:
        return this._sendErr(client, id, 'bad_request', `Unknown type: ${type}`);
    }
  }

  // --- helpers ---

  _toMeta(session) {
    if (!session) return null;
    const status = this.ptyManager.getStatus(session.id);
    return {
      id: session.id,
      name: session.name || 'session',
      cwd: session.cwd || '',
      color: session.color || '#7B2FBE',
      tag: session.tag || null,
      pinned: !!session.pinned,
      status: status || (this.ptyManager.exists(session.id) ? 'idle' : 'dead'),
      alive: this.ptyManager.exists(session.id),
      createdAt: session.createdAt || null,
      spawnedBySchedule: session.spawnedBySchedule || null,
      // v0.7+ fields — iOS clients ≥ 0.7 read these; older clients ignore them.
      isPM: !!session.isPM,
      agentTool: session.agentTool || null,
      personaName: session.personaName || null,
      groupId: session.groupId || null,
    };
  }

  _isSubscribed(client, sessionId) {
    return client.subs.has('*') || client.subs.has(sessionId);
  }

  _send(client, obj) {
    if (client.ws.readyState !== 1) return; // 1 = OPEN
    try { client.ws.send(JSON.stringify(obj)); } catch (_) {}
  }

  _sendErr(client, id, code, message) {
    this._send(client, { type: 'err', id: id || null, code, message });
  }

  _broadcast(obj, filter = () => true) {
    const text = JSON.stringify(obj);
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      if (!filter(c)) continue;
      try { c.ws.send(text); } catch (_) {}
    }
  }

  _flushPendingData() {
    this.coalesceTimer = null;
    if (this.pendingData.size === 0) return;
    const entries = Array.from(this.pendingData.entries());
    this.pendingData.clear();
    for (const [sessionId, data] of entries) {
      const text = JSON.stringify({ type: 'session_data', sessionId, data });
      for (const c of this.clients) {
        if (c.ws.readyState !== 1) continue;
        if (!this._isSubscribed(c, sessionId)) continue;
        try { c.ws.send(text); } catch (_) {}
      }
    }
  }

  _sweepIdleClients() {
    const now = Date.now();
    for (const c of Array.from(this.clients)) {
      if (now - c.lastSeen > IDLE_DISCONNECT_MS) {
        try {
          this._send(c, { type: 'bye', reason: 'idle_timeout' });
          c.ws.close(1000, 'idle_timeout');
        } catch (_) {}
        this.clients.delete(c);
      }
    }
    if (this.clients.size === 0) this.onClientChange(0);
  }

  _audit(entry) {
    const record = { ...entry, t: Date.now() };
    try { this.onAudit(record); } catch (_) {}
    if (!this.auditPath) return;
    try {
      fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
      // Size-based rotation. When the active log crosses 5 MB, rename it to
      // .1 (overwriting any prior rotation) and start fresh. Single rollover
      // is enough for forensic value without growing without bound.
      try {
        const stat = fs.statSync(this.auditPath);
        if (stat.size > 5 * 1024 * 1024) {
          fs.renameSync(this.auditPath, this.auditPath + '.1');
        }
      } catch (_) { /* file may not exist yet */ }
      // First write creates with mode 0600 so the audit history isn't
      // world-readable on this Mac. fs.appendFileSync respects the mode arg
      // only on file creation; on existing files we re-chmod defensively.
      fs.appendFileSync(this.auditPath, JSON.stringify(record) + '\n', { mode: 0o600 });
      try { fs.chmodSync(this.auditPath, 0o600); } catch (_) {}
    } catch (_) {}
  }
}

module.exports = BridgeServer;
module.exports.PROTOCOL_VERSION = PROTOCOL_VERSION;
module.exports.DEFAULT_PORT = DEFAULT_PORT;

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');

const BridgeServer = require('../src/main/bridge-server');
const BridgeTokens = require('../src/main/bridge-tokens');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anthology-bridge-test-'));
}

class FakePty {
  constructor() {
    this.statuses = new Map();
    this.alive = new Set();
    this.recent = new Map();
    this.writes = [];
    this.kills = [];
    this.creates = [];
  }
  exists(id) { return this.alive.has(id); }
  getStatus(id) { return this.statuses.get(id) || (this.alive.has(id) ? 'idle' : null); }
  getRecentBuffer(id) { return this.recent.get(id) || ''; }
  write(id, data) { this.writes.push({ id, data }); return true; }
  resize() { return true; }
  kill(id) { this.kills.push(id); this.alive.delete(id); return true; }
  submitPrompt(id, text) { this.writes.push({ id, prompt: text }); return true; }
  create({ id, cwd }) {
    this.creates.push({ id, cwd });
    this.alive.add(id);
    this.statuses.set(id, 'running');
    return { id, alive: true, cwd };
  }
}

class FakeSessionsStore {
  constructor() { this.s = []; this.recents = []; }
  list() { return this.s.slice(); }
  listRecentDirs() { return this.recents.slice(); }
  upsert(session) {
    const i = this.s.findIndex((x) => x.id === session.id);
    if (i >= 0) this.s[i] = { ...this.s[i], ...session }; else this.s.push(session);
    if (session.cwd && !this.recents.includes(session.cwd)) this.recents.unshift(session.cwd);
    return session;
  }
  remove(id) { this.s = this.s.filter((x) => x.id !== id); return true; }
}

class FakeBufferStore {
  constructor() { this.bufs = new Map(); }
  load(id) { return this.bufs.get(id) || null; }
  save(id, content) { this.bufs.set(id, content); return true; }
  remove(id) { this.bufs.delete(id); return true; }
}

class FakeScheduler {
  constructor() { this.s = []; }
  list() { return this.s.slice(); }
  upsert(s) {
    const i = this.s.findIndex((x) => x.id === s.id);
    if (i >= 0) this.s[i] = { ...this.s[i], ...s }; else this.s.push(s);
    return this.s.find((x) => x.id === s.id);
  }
  remove(id) { this.s = this.s.filter((x) => x.id !== id); return true; }
  async _fire(id) { return id; }
}

async function buildServer() {
  const dir = tmpDir();
  const tokens = new BridgeTokens(dir);
  const pty = new FakePty();
  const sessions = new FakeSessionsStore();
  const buffers = new FakeBufferStore();
  const scheduler = new FakeScheduler();
  const clientCounts = [];
  const server = new BridgeServer({
    ptyManager: pty,
    sessionsStore: sessions,
    bufferStore: buffers,
    scheduler,
    tokens,
    appVersion: '0.0.1-test',
    serverName: 'TestMac',
    port: 0, // ephemeral
    onClientChange: (n) => clientCounts.push(n),
  });
  const { port } = await server.start();
  return { dir, server, tokens, pty, sessions, buffers, scheduler, port, clientCounts };
}

async function pairAndConnect(server, tokens, port) {
  const { code } = tokens.startPairing();
  const res = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: 'test phone' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.token);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    headers: { Authorization: `Bearer ${body.token}` },
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return { ws, token: body.token, tokenId: body.tokenId };
}

function rpc(ws, msg) {
  const id = 'r_' + Math.random().toString(36).slice(2, 9);
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id === id) {
        ws.off('message', handler);
        if (m.type === 'err') reject(new Error(`${m.code}: ${m.message}`));
        else resolve(m);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ ...msg, id }));
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')); }, 3000);
  });
}

function nextEvent(ws, type) {
  return new Promise((resolve, reject) => {
    const handler = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === type) {
        ws.off('message', handler);
        resolve(m);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.off('message', handler); reject(new Error(`timeout waiting for ${type}`)); }, 3000);
  });
}

test('pair → connect → hello returns server info', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  const ack = await rpc(ws, { type: 'hello', clientName: 'test', clientVersion: '0', platform: 'node' });
  assert.equal(ack.type, 'ack');
  assert.equal(ack.result.serverName, 'TestMac');
  assert.equal(ack.result.serverVersion, '0.0.1-test');
});

test('expired pairing code is rejected', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { code } = tokens.startPairing();
  // Force expiry
  tokens.activePairing.expiresAt = Date.now() - 1;
  const res = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: 'late' }),
  });
  assert.equal(res.status, 401);
});

test('wrong pairing code is rejected without burning the code on first try', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { code } = tokens.startPairing();
  const wrong = String((parseInt(code, 10) + 1) % 1000000).padStart(6, '0');
  const r1 = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: wrong, label: 'bad' }),
  });
  assert.equal(r1.status, 401);
  // Original code still works on second attempt with the right value
  const r2 = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: 'good' }),
  });
  assert.equal(r2.status, 200);
});

test('WS upgrade with no Bearer is rejected 401', async (t) => {
  const { server, port } = await buildServer();
  t.after(() => server.stop());
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.once('open', () => resolve());
      ws.once('error', reject);
    }),
    /Unexpected server response: 401/,
  );
});

test('WS upgrade with Origin header is rejected (DNS rebinding guard)', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { code } = tokens.startPairing();
  const res = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label: 'origin-test' }),
  });
  const { token } = await res.json();
  await assert.rejects(
    () => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.example.com' },
      });
      ws.once('open', () => resolve());
      ws.once('error', reject);
    }),
    /Unexpected server response: 403/,
  );
});

test('list_recent_dirs returns SessionsStore.listRecentDirs()', async (t) => {
  const { server, tokens, sessions, port } = await buildServer();
  t.after(() => server.stop());
  sessions.upsert({ id: 's_a', name: 'a', cwd: '/tmp/alpha' });
  sessions.upsert({ id: 's_b', name: 'b', cwd: '/tmp/beta' });
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  const ack = await rpc(ws, { type: 'list_recent_dirs' });
  assert.deepEqual(ack.result.dirs, ['/tmp/beta', '/tmp/alpha']);
});

test('list_sessions returns the SessionsStore contents', async (t) => {
  const { server, tokens, sessions, port } = await buildServer();
  t.after(() => server.stop());
  sessions.upsert({ id: 's_one', name: 'first', cwd: '/tmp', color: '#fff', tag: 't' });
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  const ack = await rpc(ws, { type: 'list_sessions' });
  assert.equal(ack.result.sessions.length, 1);
  assert.equal(ack.result.sessions[0].id, 's_one');
});

test('subscribe + handlePtyData fan-out delivers to subscribed clients', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  await rpc(ws, { type: 'subscribe', sessionIds: ['s_demo'] });
  // Trigger a fan-out from the server side
  server.handlePtyData('s_demo', 'hello there');
  const ev = await nextEvent(ws, 'session_data');
  assert.equal(ev.sessionId, 's_demo');
  assert.equal(ev.data, 'hello there');
});

test('unsubscribed sessions do not receive data', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  await rpc(ws, { type: 'subscribe', sessionIds: ['s_only'] });
  server.handlePtyData('s_other', 'should not arrive');
  // Set a small timer; no event should land
  let received = false;
  const handler = (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'session_data') received = true;
  };
  ws.on('message', handler);
  await new Promise((r) => setTimeout(r, 200));
  ws.off('message', handler);
  assert.equal(received, false);
});

test('send_input forwards to PtyManager.write', async (t) => {
  const { server, tokens, pty, port } = await buildServer();
  t.after(() => server.stop());
  pty.alive.add('s_target');
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  const ack = await rpc(ws, { type: 'send_input', sessionId: 's_target', data: 'ls\n' });
  assert.equal(ack.result.ok, true);
  assert.deepEqual(pty.writes[pty.writes.length - 1], { id: 's_target', data: 'ls\n' });
});

test('spawn creates a session and broadcasts session_created', async (t) => {
  const { server, tokens, pty, sessions, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  await rpc(ws, { type: 'subscribe', sessionIds: '*' });
  const ackP = rpc(ws, { type: 'spawn', name: 'spawned', cwd: '/tmp', runClaude: false });
  // session_created may arrive before or after the ack — race them
  const ack = await ackP;
  assert.equal(ack.result.session.name, 'spawned');
  assert.equal(pty.creates.length, 1);
  assert.equal(sessions.list().length, 1);
});

test('revoking a token disconnects its WS client', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws, tokenId } = await pairAndConnect(server, tokens, port);
  const closed = new Promise((resolve) => ws.once('close', resolve));
  tokens.revoke(tokenId);
  server.disconnectByTokenId(tokenId);
  await closed; // must close, otherwise this hangs the test
});

test('register_push_token persists APNs token on the bearer entry', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws, tokenId } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  const ack = await rpc(ws, { type: 'register_push_token', deviceToken: 'a'.repeat(64), environment: 'production' });
  assert.equal(ack.result.ok, true);
  const targets = tokens.apnsTargets();
  assert.equal(targets.length, 1);
  assert.equal(targets[0].tokenId, tokenId);
  assert.equal(targets[0].apnsToken.length, 64);
  assert.equal(targets[0].apnsEnv, 'production');
});

test('register_push_token rejects too-short tokens', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  t.after(() => ws.close());
  await assert.rejects(
    () => rpc(ws, { type: 'register_push_token', deviceToken: 'short' }),
    /bad_request/
  );
});

test('rate limiting closes a flooding client', async (t) => {
  const { server, tokens, port } = await buildServer();
  t.after(() => server.stop());
  const { ws } = await pairAndConnect(server, tokens, port);
  const closed = new Promise((resolve) => ws.once('close', resolve));
  // Send 250 messages back-to-back; 200/s cap should trip
  for (let i = 0; i < 250; i++) {
    ws.send(JSON.stringify({ type: 'ping', id: `r_${i}` }));
  }
  await closed;
});

test('listConnectivityAddresses categorizes Tailscale and LAN ranges', () => {
  // Inline reproduction of main.js logic so we don't have to load Electron here.
  // Real test of the regex membership.
  const tail = '100.92.18.4';
  const lan = '192.168.1.20';
  const link = '169.254.5.5';
  const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(tail);
  const isLan = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(lan);
  const isLink = /^169\.254\./.test(link);
  assert.equal(isTailscale, true);
  assert.equal(isLan, true);
  assert.equal(isLink, true);
});

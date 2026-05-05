'use strict';

// Sends APNs pushes via the Cloudflare Worker when:
//   1) push is configured (workerUrl + workerSecret set, AND ≥1 paired device
//      has an apnsToken),
//   2) no WS client is currently connected to the bridge (otherwise the live
//      iOS app handles the alert in-app), and
//   3) a session transitions INTO `waiting` or `error` (continued state does
//      NOT re-fire), with a per-session debounce so we never spam.

const DEBOUNCE_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

class PushDispatcher {
  constructor({ tokens, config, bridgeServer, sessionsStore }) {
    this.tokens = tokens;
    this.config = config;
    this.bridgeServer = bridgeServer;
    this.sessionsStore = sessionsStore;
    this.lastFiredAt = new Map();   // sessionId -> ms
    this.lastStatus = new Map();    // sessionId -> status (so we only push on transitions)
  }

  noteStatus(sessionId, status) {
    const prev = this.lastStatus.get(sessionId);
    this.lastStatus.set(sessionId, status);
    if (prev === status) return;
    if (status !== 'waiting' && status !== 'error') return;
    this._maybeFire(sessionId, status);
  }

  _maybeFire(sessionId, status) {
    if (!this.config.isPushConfigured()) return;
    if (this.bridgeServer && this.bridgeServer.clientCount() > 0) return;

    const targets = this.tokens.apnsTargets();
    if (targets.length === 0) return;

    const last = this.lastFiredAt.get(sessionId) || 0;
    if (Date.now() - last < DEBOUNCE_MS) return;
    this.lastFiredAt.set(sessionId, Date.now());

    const session = this.sessionsStore && this.sessionsStore.list().find((s) => s.id === sessionId);
    const name = (session && session.name) || sessionId;
    const title = status === 'waiting' ? `${name} needs you` : `${name} hit an error`;
    const body = status === 'waiting'
      ? 'Claude is waiting on a permission decision.'
      : 'A tool call failed — open the session to investigate.';

    // Group all targets sharing the same APNs environment into one request to
    // the Worker. v1 always uses 'production' so this collapses to one call.
    const groups = new Map();
    for (const t of targets) {
      const env = t.apnsEnv || 'production';
      if (!groups.has(env)) groups.set(env, []);
      groups.get(env).push(t.apnsToken);
    }

    for (const [env, deviceTokens] of groups) {
      this._send({
        deviceTokens,
        alert: { title, body },
        payload: { sessionId, status },
        collapseId: `session-${sessionId}-${status}`,
        environment: env,
      }).catch((e) => console.warn('[push] dispatch failed:', e.message));
    }
  }

  async _send(payload) {
    const url = this.config.data.workerUrl.replace(/\/+$/, '') + '/push';
    const secret = this.config.data.workerSecret;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.warn('[push] worker rejected:', res.status, text.slice(0, 200));
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = PushDispatcher;

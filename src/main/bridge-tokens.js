'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TOKEN_PREFIX = 'ant_';
const TOKEN_RAND_BYTES = 36; // 36 bytes -> 48 url-safe chars
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_CODE_DIGITS = 6;
const MAX_FAILED_CLAIMS_BEFORE_BURN = 3;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function newToken() {
  return TOKEN_PREFIX + crypto.randomBytes(TOKEN_RAND_BYTES).toString('base64url');
}

function newTokenId() {
  return 'tk_' + crypto.randomBytes(6).toString('base64url');
}

function newPairingCode() {
  // Cryptographic random in [0, 10^6) — uniform without modulo bias because
  // 10^6 fits cleanly in 24 bits; we sample 32 bits and reject the upper
  // remainder. Practical range; brute-force is also rate-limited and the
  // code burns on too many failed claims.
  const max = 10 ** PAIRING_CODE_DIGITS;
  const reject = Math.floor(0x100000000 / max) * max;
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= reject);
  return String(n % max).padStart(PAIRING_CODE_DIGITS, '0');
}

class BridgeTokens {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'bridge-tokens.json');
    this.tokens = []; // [{ id, label, hash, createdAt, lastUsedAt }]
    this.activePairing = null; // { code, expiresAt, failedAttempts }
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.tokens = parsed;
    } catch (_) {
      this.tokens = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[bridge-tokens] save failed:', e);
    }
  }

  // --- Pairing codes ---

  startPairing() {
    const code = newPairingCode();
    this.activePairing = {
      code,
      expiresAt: Date.now() + PAIRING_CODE_TTL_MS,
      failedAttempts: 0,
    };
    return { code, expiresAt: this.activePairing.expiresAt };
  }

  cancelPairing() {
    this.activePairing = null;
  }

  pendingPairing() {
    if (!this.activePairing) return null;
    if (Date.now() > this.activePairing.expiresAt) {
      this.activePairing = null;
      return null;
    }
    return { expiresAt: this.activePairing.expiresAt };
  }

  // Returns { token, tokenId, label } on success, or { error } on failure.
  // The caller is expected to surface only the plaintext token to the requesting
  // device — it is not retrievable again.
  claimPairing(code, label) {
    const ap = this.activePairing;
    if (!ap) return { error: 'no_active_code' };
    if (Date.now() > ap.expiresAt) {
      this.activePairing = null;
      return { error: 'expired' };
    }
    if (typeof code !== 'string' || !safeEqual(code, ap.code)) {
      ap.failedAttempts += 1;
      if (ap.failedAttempts >= MAX_FAILED_CLAIMS_BEFORE_BURN) {
        this.activePairing = null;
      }
      return { error: 'invalid_code' };
    }
    const token = newToken();
    const tokenId = newTokenId();
    const safeLabel = (typeof label === 'string' ? label : '').slice(0, 100) || 'Unnamed device';
    const entry = {
      id: tokenId,
      label: safeLabel,
      hash: sha256(token),
      createdAt: Date.now(),
      lastUsedAt: null,
      apnsToken: null,
      apnsEnv: null,
    };
    this.tokens.push(entry);
    this.save();
    this.activePairing = null;
    return { token, tokenId, label: safeLabel };
  }

  // Bind an APNs device token to a paired bearer token. The dispatcher uses
  // these tokens when no WS client is currently connected so a backgrounded
  // iPhone still gets push alerts.
  setApnsToken(tokenId, apnsToken, apnsEnv = 'production') {
    const t = this.tokens.find((x) => x.id === tokenId);
    if (!t) return false;
    t.apnsToken = (typeof apnsToken === 'string' && apnsToken.length <= 200) ? apnsToken : null;
    t.apnsEnv = (apnsEnv === 'sandbox' || apnsEnv === 'production') ? apnsEnv : 'production';
    this.save();
    return true;
  }

  // Returns [{ tokenId, apnsToken, apnsEnv, label }] for every paired device
  // that has registered for push. Real APNs device tokens are exactly 64 hex
  // chars (32 bytes); the iOS Simulator gives 160-char synthetic tokens that
  // APNs accepts with status 200 but never actually delivers — filter them
  // out so the dispatcher doesn't waste cycles or produce misleading "200 OK"
  // log lines for pushes that silently disappear.
  apnsTargets() {
    return this.tokens
      .filter((t) => typeof t.apnsToken === 'string' && /^[0-9a-fA-F]{64}$/.test(t.apnsToken))
      .map((t) => ({ tokenId: t.id, apnsToken: t.apnsToken, apnsEnv: t.apnsEnv || 'production', label: t.label }));
  }

  // --- Bearer tokens ---

  // Returns the token entry on success (without the hash field), or null.
  // Updates lastUsedAt on hit.
  verify(token) {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) return null;
    const h = sha256(token);
    for (const t of this.tokens) {
      if (safeEqual(t.hash, h)) {
        t.lastUsedAt = Date.now();
        // lastUsedAt is updated in-memory each verify; persisted lazily by
        // touch() — verifying on every WS message and writing to disk every
        // time would thrash the file under streaming.
        return { id: t.id, label: t.label, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt };
      }
    }
    return null;
  }

  // Persist any in-memory lastUsedAt updates. Caller decides cadence.
  flush() {
    this.save();
  }

  list() {
    return this.tokens.map((t) => ({
      id: t.id,
      label: t.label,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      hasPush: typeof t.apnsToken === 'string' && t.apnsToken.length > 0,
    }));
  }

  revoke(tokenId) {
    const before = this.tokens.length;
    this.tokens = this.tokens.filter((t) => t.id !== tokenId);
    if (this.tokens.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
}

module.exports = BridgeTokens;
module.exports._test = { newToken, newPairingCode, sha256 };

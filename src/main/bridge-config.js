'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Persisted bridge configuration: Worker URL + secret for APNs relay, and any
// future bridge-level settings. Stored as 0600 to keep the secret out of
// casual reads. Env vars (ANTHOLOGY_WORKER_URL / ANTHOLOGY_WORKER_SECRET)
// override on every load.
class BridgeConfig {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'bridge-config.json');
    this.data = { workerUrl: null, workerSecret: null };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.data = { ...this.data, ...parsed };
    } catch (_) { /* fresh install */ }
    if (process.env.ANTHOLOGY_WORKER_URL) this.data.workerUrl = process.env.ANTHOLOGY_WORKER_URL;
    if (process.env.ANTHOLOGY_WORKER_SECRET) this.data.workerSecret = process.env.ANTHOLOGY_WORKER_SECRET;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[bridge-config] save failed:', e);
    }
  }

  set({ workerUrl, workerSecret }) {
    if (typeof workerUrl === 'string') this.data.workerUrl = workerUrl.trim() || null;
    if (typeof workerSecret === 'string') this.data.workerSecret = workerSecret.trim() || null;
    this.save();
  }

  isPushConfigured() {
    return !!(this.data.workerUrl && this.data.workerSecret);
  }

  // Public-safe view (omits the secret).
  publicView() {
    return {
      workerUrl: this.data.workerUrl,
      workerSecretSet: !!this.data.workerSecret,
      pushConfigured: this.isPushConfigured(),
    };
  }
}

module.exports = BridgeConfig;

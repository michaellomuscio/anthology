'use strict';

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Common cloudflared install paths on macOS. We check PATH first via execFileSync,
// then fall back to these. Brew-installed cloudflared lives under /opt/homebrew/bin
// on Apple Silicon and /usr/local/bin on Intel.
const KNOWN_PATHS = [
  '/opt/homebrew/bin/cloudflared',
  '/usr/local/bin/cloudflared',
  path.join(os.homedir(), '.local/bin/cloudflared'),
];

function resolveCloudflaredPath() {
  try {
    const out = execFileSync('/bin/sh', ['-lc', 'command -v cloudflared'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out && fs.existsSync(out)) return out;
  } catch (_) { /* fall through */ }
  for (const p of KNOWN_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

// Quick Tunnels emit one line during startup containing a trycloudflare.com URL.
// We grep stdout/stderr for it and resolve as soon as it's seen.
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

class CloudflaredManager {
  constructor({ onStatusChange } = {}) {
    this.onStatusChange = onStatusChange || (() => {});
    this.proc = null;
    this.url = null;
    this.localPort = null;
    this.startingPromise = null;
    this.lastError = null;
  }

  isInstalled() {
    return !!resolveCloudflaredPath();
  }

  status() {
    return {
      installed: this.isInstalled(),
      running: !!this.proc,
      url: this.url,
      localPort: this.localPort,
      lastError: this.lastError,
    };
  }

  // Spawns `cloudflared tunnel --url http://localhost:<port>` and resolves with
  // the public URL once cloudflared prints it. Quick tunnels have no auth, no
  // configuration, and no persistent identity — the URL changes every restart,
  // which is fine for the v1 "I'm at work and the firewall is blocking LAN"
  // case but bad for daily UX. Named tunnels are a future enhancement.
  async start(localPort) {
    if (this.proc) {
      if (this.url) return { url: this.url, localPort: this.localPort };
      // Mid-startup — share the same in-flight promise.
      if (this.startingPromise) return this.startingPromise;
    }
    const bin = resolveCloudflaredPath();
    if (!bin) {
      const err = new Error('cloudflared is not installed. Run `brew install cloudflared` (or download from Cloudflare) and try again.');
      this.lastError = err.message;
      this.onStatusChange(this.status());
      throw err;
    }
    this.lastError = null;
    this.localPort = localPort;
    this.startingPromise = new Promise((resolve, reject) => {
      const proc = spawn(bin, [
        'tunnel',
        '--no-autoupdate',
        '--url', `http://localhost:${localPort}`,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.proc = proc;
      let settled = false;
      const settleOk = (url) => {
        if (settled) return;
        settled = true;
        this.url = url;
        this.onStatusChange(this.status());
        resolve({ url, localPort });
      };
      const settleErr = (err) => {
        if (settled) return;
        settled = true;
        this.lastError = err.message || String(err);
        this.onStatusChange(this.status());
        try { proc.kill('SIGTERM'); } catch (_) {}
        this.proc = null;
        reject(err);
      };

      const scanForUrl = (chunk) => {
        const m = chunk.toString('utf8').match(URL_RE);
        if (m) settleOk(m[0]);
      };
      proc.stdout.on('data', scanForUrl);
      proc.stderr.on('data', scanForUrl);

      proc.on('error', (e) => settleErr(e));
      proc.on('exit', (code, signal) => {
        const stillRunning = this.proc === proc;
        this.proc = null;
        const had = this.url;
        this.url = null;
        if (stillRunning) this.onStatusChange(this.status());
        // If we never got a URL, surface an error so the UI can show a hint.
        if (!settled) {
          settleErr(new Error(`cloudflared exited (code=${code}, signal=${signal}) before reporting a URL`));
        } else if (had) {
          // Tunnel went down after running normally. Drop the recorded URL so
          // the UI doesn't pretend it's still reachable.
        }
      });

      // Hard timeout — if cloudflared hangs on a non-routable network we don't
      // want the promise to live forever.
      setTimeout(() => settleErr(new Error('cloudflared did not produce a URL within 20s')), 20_000);
    });
    try {
      const result = await this.startingPromise;
      return result;
    } finally {
      this.startingPromise = null;
    }
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.kill('SIGTERM'); } catch (_) {}
    this.proc = null;
    this.url = null;
    this.onStatusChange(this.status());
  }
}

module.exports = CloudflaredManager;
module.exports.resolveCloudflaredPath = resolveCloudflaredPath;

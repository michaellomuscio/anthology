'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  console.error('[pty-manager] Failed to load node-pty:', err);
  throw err;
}

const SecretScrubber = require('./secret-scrubber');

// Electron launched from Finder/dock starts with a stripped LaunchServices env —
// missing PATH entries, exports, and shell-init side-effects (mise/direnv/asdf/etc).
// Spawn the user's interactive login shell once and capture its env so spawned ptys
// behave like a terminal launched from a real shell. Memoized; safe-fail on timeout.
let cachedShellEnv = null;
function getInteractiveShellEnv() {
  if (cachedShellEnv) return cachedShellEnv;
  const shell = process.env.SHELL || '/bin/zsh';
  // Sentinel brackets the env block so we ignore any noise written by shell init
  // (rc-file echoes, motd, deprecation warnings).
  const sentinel = '__ANTHOLOGY_ENV_SENTINEL__';
  try {
    const out = execFileSync(shell, ['-ilc', `printf '%s\\n' '${sentinel}'; env; printf '%s\\n' '${sentinel}'`], {
      encoding: 'utf8',
      timeout: 2500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const start = out.indexOf(sentinel);
    const end = out.lastIndexOf(sentinel);
    const body = (start >= 0 && end > start) ? out.slice(start + sentinel.length, end) : out;
    const captured = {};
    // Vars that should reflect the spawned pty's process, not the snapshotting shell.
    const skip = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'TMPDIR', 'PS1', 'PROMPT', 'PROMPT_COMMAND']);
    for (const line of body.split('\n')) {
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq);
      if (skip.has(key)) continue;
      captured[key] = line.slice(eq + 1);
    }
    cachedShellEnv = captured;
  } catch (e) {
    console.warn('[pty-manager] Could not capture shell env:', e.message);
    cachedShellEnv = {};
  }
  return cachedShellEnv;
}

let appVersion = null;
function setAppVersion(v) { appVersion = v; }

// Idle / running heuristic: any output within ACTIVE_WINDOW_MS marks the session as "running",
// otherwise it's "idle". Status is also "waiting" when output ends with a recognizable
// permission-prompt pattern.
const ACTIVE_WINDOW_MS = 4000;
const STATUS_TICK_MS = 1500;

const WAITING_PATTERNS = [
  /Do you want (to )?(allow|approve|run|proceed)/i,
  /\b(Allow once|Always allow|Deny)\b/i,
  /Permission required/i,
  /\?\s*\(y\/n\)/i,
];

const ERROR_PATTERNS = [
  /\berror\b.*exit code/i,
  /command failed/i,
  /process exited with code [1-9]/i,
];

function buildEnv(extraEnv = {}) {
  // Layer order matters: process.env (Electron) → captured shell env (overrides
  // with what the user actually has in zsh) → extraEnv (per-call overrides).
  const shellEnv = getInteractiveShellEnv();
  const env = { ...process.env, ...shellEnv, ...extraEnv };
  // Make sure common user-bin dirs are on PATH so `claude` resolves even when
  // launched as a packaged app outside of a login shell.
  const home = os.homedir();
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const existing = (env.PATH || '').split(':').filter(Boolean);
  const merged = Array.from(new Set([...existing, ...extraPaths]));
  env.PATH = merged.join(':');
  env.TERM = env.TERM || 'xterm-256color';
  env.COLORTERM = env.COLORTERM || 'truecolor';
  env.LANG = env.LANG || 'en_US.UTF-8';
  // Identify ourselves so Claude Code (and other TUIs) can pick the right
  // capability path — without this they fall back to a conservative profile.
  env.TERM_PROGRAM = 'Anthology';
  if (appVersion) env.TERM_PROGRAM_VERSION = appVersion;
  return env;
}

function resolveCwd(cwd) {
  if (!cwd) return os.homedir();
  let resolved = cwd;
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = path.resolve(resolved);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
  } catch (_) {
    /* fall through */
  }
  return os.homedir();
}

function pickShell() {
  return process.env.SHELL || '/bin/zsh';
}

class PtyManager {
  constructor({ sendToRenderer }) {
    this.sendToRenderer = sendToRenderer;
    this.sessions = new Map(); // id -> { proc, lastDataAt, status, recentBuffer }
    this.statusTimer = setInterval(() => this.tickStatuses(), STATUS_TICK_MS);
  }

  create({ id, cwd, cols = 100, rows = 30, command = null, runClaude = true, maskSecrets = true }) {
    if (this.sessions.has(id)) {
      // Already exists — return current snapshot
      return { id, alive: true };
    }

    const shell = pickShell();
    const env = buildEnv();
    const workingDir = resolveCwd(cwd);

    // Pass the launch command via `-c` rather than spawn + setTimeout(write).
    // The old approach raced shell init: with heavy .zshrc setups (oh-my-zsh,
    // mise activate, direnv, p10k instant prompt) 250 ms isn't enough — the
    // shell would still be sourcing rc files when `exec claude` arrived,
    // causing partial input or lost characters. Using `-l -i -c` makes the
    // shell run rc files FIRST and only then exec the command.
    let shellArgs;
    if (runClaude || command) {
      const cmd = (command || 'exec claude').replace(/[\r\n]+$/, '');
      shellArgs = ['-l', '-i', '-c', cmd];
    } else {
      shellArgs = ['-l'];
    }

    const proc = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workingDir,
      env,
    });

    const entry = {
      id,
      proc,
      lastDataAt: Date.now(),
      status: 'running',
      recentBuffer: '',
      cwd: workingDir,
      maskSecrets: !!maskSecrets,
    };
    // Secret scrubber sits in front of every emission so credentials in the
    // PTY stream are replaced before they reach recentBuffer, the renderer,
    // or the iOS bridge. When disabled it's a passthrough.
    entry.scrubber = new SecretScrubber({
      enabled: entry.maskSecrets,
      onRedaction: (_hits, total) => {
        this.sendToRenderer('pty:redaction', { id, total });
      },
    });
    this.sessions.set(id, entry);

    const emit = (out) => {
      entry.recentBuffer = (entry.recentBuffer + out).slice(-30000);
      entry.bufferDirty = true;
      const newStatus = this.deriveStatus(entry);
      if (newStatus !== entry.status) {
        entry.status = newStatus;
        this.sendToRenderer('pty:status', { id, status: newStatus });
      }
      // No "running" re-broadcast on every chunk — under heavy claude output
      // that doubled IPC volume and forced a full <App> re-render on each chunk.
      // The per-tick deriveStatus pass below handles transitions back to running.
      this.sendToRenderer('pty:data', { id, data: out });
    };

    proc.onData((data) => {
      entry.lastDataAt = Date.now();
      entry.scrubber.feed(data, emit);
    });

    proc.onExit(({ exitCode, signal }) => {
      // Drain anything still held in the scrubber's tail before we close it,
      // so the user sees the last few bytes of output even if the process exited
      // mid-token.
      try { entry.scrubber.flush(emit); } catch (_) {}
      try { entry.scrubber.close(); } catch (_) {}
      this.sessions.delete(id);
      this.sendToRenderer('pty:exit', { id, exitCode, signal });
    });

    // No setTimeout/write needed — the shell args above embed the launch
    // command into shell-init, so `exec claude` runs only after rc files
    // finish sourcing. When claude exits (/exit, crash), the shell exits
    // along with it, the PTY closes, and we tear the session down via onExit.

    return { id, alive: true, cwd: workingDir };
  }

  write(id, data) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    try {
      entry.proc.write(data);
      return true;
    } catch (e) {
      return false;
    }
  }

  resize(id, cols, rows) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    try {
      entry.proc.resize(Math.max(2, cols | 0), Math.max(2, rows | 0));
      return true;
    } catch (e) {
      return false;
    }
  }

  kill(id) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    const proc = entry.proc;
    const pid = proc.pid;
    // SIGTERM first so claude has a chance to flush its own scrollback /
    // disconnect cleanly. After 1 s, if the *kernel* still reports the pid
    // as alive (process.kill(pid, 0) doesn't throw), escalate to SIGKILL.
    // We don't gate on this.sessions.has(id) here because proc.onExit (which
    // removes the entry) may not yet have fired; the kernel-level liveness
    // check is the source of truth.
    try { proc.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => {
      if (!pid) return;
      try {
        process.kill(pid, 0); // liveness probe — throws ESRCH if dead
      } catch (_) {
        return; // already dead, nothing to do
      }
      // Still alive after a second of SIGTERM — force it.
      try { proc.kill('SIGKILL'); } catch (_) {}
      try { process.kill(pid, 'SIGKILL'); } catch (_) {}
    }, 1000);
    return true;
  }

  exists(id) {
    return this.sessions.has(id);
  }

  // Toggle secret masking for a live session. When switching from on→off the
  // scrubber's held tail is flushed RAW (the user just opted out) so the user
  // doesn't see masked content from the last ~256 bytes lingering.
  setMaskSecrets(id, enabled) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    const want = !!enabled;
    if (entry.maskSecrets === want) return true;
    if (!want) {
      // Drain any held tail un-masked since the user just opted out.
      const tail = entry.scrubber.setEnabled(false);
      if (tail) {
        entry.recentBuffer = (entry.recentBuffer + tail).slice(-30000);
        entry.bufferDirty = true;
        this.sendToRenderer('pty:data', { id, data: tail });
      }
    } else {
      entry.scrubber.setEnabled(true);
    }
    entry.maskSecrets = want;
    this.sendToRenderer('pty:mask-state', { id, maskSecrets: want });
    return true;
  }

  getMaskSecrets(id) {
    const entry = this.sessions.get(id);
    return entry ? !!entry.maskSecrets : null;
  }

  getRedactionCount(id) {
    const entry = this.sessions.get(id);
    return entry?.scrubber ? entry.scrubber.getRedactionCount() : 0;
  }

  getStatus(id) {
    const entry = this.sessions.get(id);
    return entry ? entry.status : null;
  }

  getRecentBuffer(id) {
    const entry = this.sessions.get(id);
    return entry ? entry.recentBuffer : null;
  }

  getIdleMs(id) {
    const entry = this.sessions.get(id);
    return entry ? Date.now() - entry.lastDataAt : null;
  }

  // Submit a prompt to a Claude Code session as if the user typed it and pressed Enter.
  // Bracketed paste preserves multi-line text, then \r is sent as a SEPARATE write so
  // claude's input handler registers Enter as its own keystroke event.
  submitPrompt(id, text) {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    try {
      const safe = String(text).replace(/\[201~/g, '');
      entry.proc.write('[200~' + safe + '[201~');
      setTimeout(() => {
        try { entry.proc.write('\r'); } catch (_) {}
      }, 180);
      return true;
    } catch (_) {
      return false;
    }
  }

  killAll() {
    for (const id of Array.from(this.sessions.keys())) this.kill(id);
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  // Match against the last 2 KB of output only — claude's permission prompt
  // and error markers are always near the tail, and the regex set is heavy
  // enough that scanning 30 KB on every byte was visible CPU during streaming.
  deriveStatus(entry) {
    const tail = entry.recentBuffer.length > 2048
      ? entry.recentBuffer.slice(-2048)
      : entry.recentBuffer;
    if (WAITING_PATTERNS.some((re) => re.test(tail))) return 'waiting';
    if (ERROR_PATTERNS.some((re) => re.test(tail))) return 'error';
    return 'running';
  }

  tickStatuses() {
    const now = Date.now();
    for (const entry of this.sessions.values()) {
      // Skip entries with no new output since the last tick — pattern outcome
      // can't change without new bytes, so no work to do.
      if (!entry.bufferDirty && now - entry.lastDataAt > ACTIVE_WINDOW_MS && entry.status !== 'running') {
        continue;
      }
      const idle = now - entry.lastDataAt > ACTIVE_WINDOW_MS;
      let next = entry.status;
      if (idle && entry.status === 'running') next = 'idle';
      if (entry.bufferDirty) {
        const tail = entry.recentBuffer.length > 2048
          ? entry.recentBuffer.slice(-2048)
          : entry.recentBuffer;
        if (WAITING_PATTERNS.some((re) => re.test(tail))) next = 'waiting';
        else if (ERROR_PATTERNS.some((re) => re.test(tail))) next = 'error';
        entry.bufferDirty = false;
      }

      if (next !== entry.status) {
        entry.status = next;
        this.sendToRenderer('pty:status', { id: entry.id, status: next });
      }
    }
  }
}

module.exports = PtyManager;
module.exports.setAppVersion = setAppVersion;

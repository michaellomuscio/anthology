'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Per-session serialized terminal state — captured by xterm's serialize addon
// in the renderer and persisted here so scrollback survives app restart.
// Hard-capped to keep individual sessions from ballooning userData.
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

class BufferStore {
  constructor(userDataDir) {
    this.dir = path.join(userDataDir, 'buffers');
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (_) {}
  }

  pathFor(id) {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) return null;
    return path.join(this.dir, `${safe}.dat`);
  }

  save(id, content) {
    const p = this.pathFor(id);
    if (!p) return false;
    try {
      let data = String(content == null ? '' : content);
      if (data.length > MAX_BUFFER_BYTES) data = data.slice(-MAX_BUFFER_BYTES);
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, p);
      return true;
    } catch (e) {
      console.warn('[buffer-store] save failed:', e.message);
      return false;
    }
  }

  load(id) {
    const p = this.pathFor(id);
    if (!p) return null;
    try {
      return fs.readFileSync(p, 'utf8');
    } catch (_) {
      return null;
    }
  }

  remove(id) {
    const p = this.pathFor(id);
    if (!p) return false;
    try {
      fs.unlinkSync(p);
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = BufferStore;

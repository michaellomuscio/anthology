'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_RECENT_DIRS = 12;

class SessionsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'sessions.json');
    this.recentFile = path.join(userDataDir, 'recent-dirs.json');
    this.sessions = [];
    this.recentDirs = [];
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.sessions = parsed;
    } catch (_) {
      this.sessions = [];
    }
    try {
      const raw = fs.readFileSync(this.recentFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.recentDirs = parsed.slice(0, MAX_RECENT_DIRS);
    } catch (_) {
      // Seed recents from any existing sessions
      this.recentDirs = Array.from(new Set(this.sessions.map((s) => s.cwd).filter(Boolean))).slice(0, MAX_RECENT_DIRS);
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.sessions, null, 2));
    } catch (e) {
      console.error('[sessions-store] save failed:', e);
    }
  }

  saveRecents() {
    try {
      fs.mkdirSync(path.dirname(this.recentFile), { recursive: true });
      fs.writeFileSync(this.recentFile, JSON.stringify(this.recentDirs, null, 2));
    } catch (e) {
      console.error('[sessions-store] saveRecents failed:', e);
    }
  }

  pushRecentDir(cwd) {
    if (!cwd) return;
    this.recentDirs = [cwd, ...this.recentDirs.filter((d) => d !== cwd)].slice(0, MAX_RECENT_DIRS);
    this.saveRecents();
  }

  listRecentDirs() {
    return this.recentDirs.slice();
  }

  list() {
    return this.sessions.slice();
  }

  upsert(session) {
    if (!session || !session.id) return null;
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) this.sessions[idx] = { ...this.sessions[idx], ...session };
    else this.sessions.push(session);
    if (session.cwd) this.pushRecentDir(session.cwd);
    this.save();
    return session;
  }

  remove(id) {
    const before = this.sessions.length;
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.sessions.length !== before) this.save();
    return true;
  }
}

module.exports = SessionsStore;

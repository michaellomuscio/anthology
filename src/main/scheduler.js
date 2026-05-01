'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cron = require('node-cron');

/**
 * Schedule shape:
 * {
 *   id: string,
 *   name: string,
 *   cwd: string,
 *   prompt: string,
 *   color: string,
 *   tag: string,
 *   kind: 'cron' | 'oneshot',
 *   cron: string | null,        // when kind === 'cron'
 *   when: string | null,        // ISO datetime when kind === 'oneshot'
 *   enabled: boolean,
 *   createdAt: number,
 *   lastRunAt?: number,
 *   nextRunAt?: number,
 * }
 */

class Scheduler {
  constructor({ userDataDir, fire, broadcast }) {
    this.file = path.join(userDataDir, 'schedules.json');
    this.fire = fire; // ({ schedule }) => Promise<void>
    this.broadcast = broadcast || (() => {});
    this.schedules = [];
    this.timers = new Map(); // id -> { task: cronTask | timeout }
    this.load();
    this.armAll();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.schedules = arr;
    } catch (_) {
      this.schedules = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.schedules, null, 2));
    } catch (e) {
      console.error('[scheduler] save failed', e);
    }
  }

  list() {
    // Refresh nextRunAt as a convenience
    return this.schedules.map((s) => ({ ...s, nextRunAt: this.computeNextRun(s) }));
  }

  computeNextRun(s) {
    if (!s.enabled) return null;
    if (s.kind === 'oneshot') {
      const t = s.when ? Date.parse(s.when) : NaN;
      if (Number.isNaN(t) || t < Date.now()) return null;
      return t;
    }
    if (s.kind === 'cron' && s.cron) {
      try {
        // node-cron doesn't provide a "next-fire" computation, so we walk the
        // next 366 days minute-by-minute. Practical because schedules are typically
        // hourly/daily/weekly so we'll find one within minutes/hours.
        // Fast path: scan next ~7 days at minute resolution.
        const validator = cron.validate(s.cron);
        if (!validator) return null;
        const limit = 7 * 24 * 60; // minutes
        const now = new Date();
        for (let m = 1; m <= limit; m++) {
          const t = new Date(now.getTime() + m * 60 * 1000);
          if (cronMatches(s.cron, t)) return t.getTime();
        }
        return null;
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  upsert(schedule) {
    if (!schedule || !schedule.id) return null;
    const idx = this.schedules.findIndex((s) => s.id === schedule.id);
    if (idx >= 0) this.schedules[idx] = { ...this.schedules[idx], ...schedule };
    else this.schedules.push(schedule);
    this.save();
    this.disarm(schedule.id);
    this.arm(this.schedules.find((s) => s.id === schedule.id));
    return this.schedules.find((s) => s.id === schedule.id);
  }

  remove(id) {
    this.disarm(id);
    this.schedules = this.schedules.filter((s) => s.id !== id);
    this.save();
    return true;
  }

  disarm(id) {
    const entry = this.timers.get(id);
    if (!entry) return;
    if (entry.kind === 'cron' && entry.task && typeof entry.task.stop === 'function') {
      try { entry.task.stop(); } catch (_) {}
    } else if (entry.kind === 'oneshot' && entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.timers.delete(id);
  }

  arm(schedule) {
    if (!schedule || !schedule.enabled) return;
    if (schedule.kind === 'cron' && schedule.cron) {
      if (!cron.validate(schedule.cron)) {
        console.warn(`[scheduler] invalid cron for ${schedule.id}: ${schedule.cron}`);
        return;
      }
      const task = cron.schedule(schedule.cron, () => this._fire(schedule.id), { scheduled: true });
      this.timers.set(schedule.id, { kind: 'cron', task });
    } else if (schedule.kind === 'oneshot' && schedule.when) {
      const t = Date.parse(schedule.when);
      if (Number.isNaN(t)) return;
      const delay = t - Date.now();
      if (delay <= 0) return; // already past
      const timeoutId = setTimeout(() => this._fire(schedule.id), Math.min(delay, 2 ** 31 - 1));
      this.timers.set(schedule.id, { kind: 'oneshot', timeoutId });
    }
  }

  armAll() {
    for (const s of this.schedules) this.arm(s);
  }

  async _fire(id) {
    const sched = this.schedules.find((s) => s.id === id);
    if (!sched || !sched.enabled) return;
    sched.lastRunAt = Date.now();
    if (sched.kind === 'oneshot') sched.enabled = false; // one-shots auto-disable after firing
    this.save();
    try {
      await this.fire({ schedule: sched });
      this.broadcast('schedule:fired', { id, ok: true, lastRunAt: sched.lastRunAt });
    } catch (e) {
      console.error('[scheduler] fire failed:', e);
      this.broadcast('schedule:fired', { id, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  shutdown() {
    for (const id of Array.from(this.timers.keys())) this.disarm(id);
  }
}

// Minimal cron-matching helper (5-field spec: m h dom mon dow).
// node-cron doesn't expose a "matches at instant" API so we do it ourselves
// for nextRunAt previews. Supports: *, n, n-m, */n, comma-lists.
function cronMatches(expr, date) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mPart, hPart, domPart, monPart, dowPart] = parts;
  const m = date.getMinutes();
  const h = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1;
  const dow = date.getDay();
  return (
    matchField(mPart, m, 0, 59) &&
    matchField(hPart, h, 0, 23) &&
    matchField(domPart, dom, 1, 31) &&
    matchField(monPart, mon, 1, 12) &&
    matchField(dowPart, dow, 0, 6)
  );
}

function matchField(part, value, min, max) {
  if (part === '*') return true;
  return part.split(',').some((segment) => {
    const stepMatch = segment.match(/^(.+)\/(\d+)$/);
    let base = segment;
    let step = 1;
    if (stepMatch) {
      base = stepMatch[1];
      step = parseInt(stepMatch[2], 10);
    }
    let lo = min;
    let hi = max;
    if (base === '*') {
      // already lo..hi
    } else if (base.includes('-')) {
      const [a, b] = base.split('-').map((s) => parseInt(s, 10));
      lo = a; hi = b;
    } else {
      const n = parseInt(base, 10);
      if (Number.isNaN(n)) return false;
      lo = n; hi = n;
    }
    if (value < lo || value > hi) return false;
    return ((value - lo) % step) === 0;
  });
}

module.exports = Scheduler;

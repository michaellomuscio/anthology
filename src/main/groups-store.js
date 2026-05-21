'use strict';

const fs = require('node:fs');
const path = require('node:path');

class GroupsStore {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'groups.json');
    this.groups = [];
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.groups = parsed;
    } catch (_) {
      this.groups = [];
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.groups, null, 2));
    } catch (e) {
      console.error('[groups-store] save failed:', e);
    }
  }

  list() {
    return this.groups.slice();
  }

  upsert(group) {
    if (!group || !group.id) return null;
    const idx = this.groups.findIndex((g) => g.id === group.id);
    if (idx >= 0) this.groups[idx] = { ...this.groups[idx], ...group };
    else this.groups.push({ createdAt: Date.now(), ...group });
    this.save();
    return this.groups.find((g) => g.id === group.id);
  }

  remove(id) {
    const before = this.groups.length;
    this.groups = this.groups.filter((g) => g.id !== id);
    if (this.groups.length !== before) this.save();
    return true;
  }

  reorder(ids) {
    if (!Array.isArray(ids)) return false;
    const known = new Set(ids);
    const byId = new Map(this.groups.map((g) => [g.id, g]));
    const reordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const tail = this.groups.filter((g) => !known.has(g.id));
    this.groups = [...reordered, ...tail];
    this.save();
    return true;
  }
}

module.exports = GroupsStore;

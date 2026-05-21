'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Workers are Claude Code subagents — plain .md files in ~/.claude/agents/
// with YAML frontmatter. Anthology-managed workers all start with the
// `worker-` filename prefix so we can browse them as a distinct gallery
// without touching the user's other agents (Cass, custom one-offs, etc).
const AGENTS_DIR = path.join(os.homedir(), '.claude', 'agents');
const WORKER_PREFIX = 'worker-';

// Allowed categories for the Anthology UI. We only enforce the badge color +
// grouping; the underlying .md file is unchanged either way, so a worker with
// an unknown category just lands in "Other".
const CATEGORIES = ['engineering', 'design', 'content', 'analytics', 'business', 'research', 'other'];

// Anthology-only frontmatter fields. The first four are Claude Code's
// contract; the rest are UI sugar that other clients will simply ignore.
const KNOWN_FIELDS = ['name', 'description', 'model', 'tools', 'category', 'color', 'emoji'];

function ensureDir() {
  try { fs.mkdirSync(AGENTS_DIR, { recursive: true }); } catch (_) {}
}

// Minimal frontmatter parser. Only handles the flat key:value shape Claude
// Code uses for agents — no nested maps, no arrays. Quoted values are stripped
// of their wrapping quotes. Anything we can't parse cleanly is treated as the
// start of the body so a malformed worker still renders SOMETHING.
function parseFrontmatter(text) {
  if (!text || !text.startsWith('---')) return { frontmatter: {}, body: text || '' };
  // Look for the closing fence at the start of a line.
  const closeIdx = text.indexOf('\n---', 3);
  if (closeIdx === -1) return { frontmatter: {}, body: text };
  const fmBlock = text.slice(3, closeIdx).trim();
  let body = text.slice(closeIdx + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  const fm = {};
  for (const raw of fmBlock.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return { frontmatter: fm, body };
}

function serializeFrontmatter(fm, body) {
  const lines = ['---'];
  // Stable key order: known fields first in their canonical order, then anything
  // else alphabetically. Makes diffs against hand-edited files predictable.
  const keys = [
    ...KNOWN_FIELDS.filter((k) => fm[k] !== undefined && fm[k] !== null && fm[k] !== ''),
    ...Object.keys(fm).filter((k) => !KNOWN_FIELDS.includes(k)).sort(),
  ];
  for (const k of keys) {
    const v = String(fm[k]);
    // Quote if the value contains anything that would confuse a YAML parser.
    const needsQuote = /[:#"'\[\]{}|>&*!%@`]/.test(v) || v.trim() !== v;
    lines.push(`${k}: ${needsQuote ? JSON.stringify(v) : v}`);
  }
  lines.push('---', '');
  return lines.join('\n') + (body || '');
}

function safeName(name) {
  // Worker names are filenames — clamp to safe shell-ish chars.
  return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 80);
}

function fullName(name) {
  const n = safeName(name);
  if (n.startsWith(WORKER_PREFIX)) return n;
  return WORKER_PREFIX + n;
}

class WorkerStore {
  constructor() {
    ensureDir();
  }

  list() {
    try {
      const files = fs.readdirSync(AGENTS_DIR);
      const out = [];
      for (const f of files) {
        if (!f.startsWith(WORKER_PREFIX) || !f.endsWith('.md')) continue;
        try {
          const raw = fs.readFileSync(path.join(AGENTS_DIR, f), 'utf8');
          const { frontmatter, body } = parseFrontmatter(raw);
          out.push({
            filename: f,
            name: frontmatter.name || f.replace(/\.md$/, ''),
            description: frontmatter.description || '',
            model: frontmatter.model || '',
            tools: frontmatter.tools || '',
            category: (frontmatter.category || 'other').toLowerCase(),
            color: frontmatter.color || '',
            emoji: frontmatter.emoji || '',
            body,
            frontmatter,
          });
        } catch (e) {
          console.warn('[worker-store] skip', f, e.message);
        }
      }
      // Sort: by category (in declared order), then by name.
      out.sort((a, b) => {
        const ca = CATEGORIES.indexOf(a.category);
        const cb = CATEGORIES.indexOf(b.category);
        const ka = ca === -1 ? CATEGORIES.length : ca;
        const kb = cb === -1 ? CATEGORIES.length : cb;
        if (ka !== kb) return ka - kb;
        return a.name.localeCompare(b.name);
      });
      return out;
    } catch (e) {
      console.error('[worker-store] list failed:', e);
      return [];
    }
  }

  // Build the on-disk record from a UI-side worker shape. `name` is the
  // bare name; we always reapply the `worker-` prefix to keep the namespace
  // sealed off from the user's other agents.
  save(input) {
    if (!input || !input.name) throw new Error('Worker name is required');
    ensureDir();
    const name = fullName(input.name);
    const filename = name + '.md';
    const fm = {
      name,
      description: input.description || '',
      model: input.model || 'claude-opus-4-7',
      tools: input.tools || 'Read, Write, Edit, Glob, Grep, WebFetch',
      category: (input.category || 'other').toLowerCase(),
      color: input.color || '',
      emoji: input.emoji || '',
    };
    const body = input.body || '';
    const text = serializeFrontmatter(fm, body);
    const target = path.join(AGENTS_DIR, filename);
    // Atomic write so a crash mid-save can't leave a corrupt file.
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, text, { mode: 0o644 });
    fs.renameSync(tmp, target);
    // If the user renamed the worker (UI sent old filename), drop the old file.
    if (input.previousFilename &&
        input.previousFilename !== filename &&
        input.previousFilename.startsWith(WORKER_PREFIX)) {
      try { fs.unlinkSync(path.join(AGENTS_DIR, input.previousFilename)); } catch (_) {}
    }
    return { ok: true, filename };
  }

  remove(filename) {
    if (!filename || !filename.startsWith(WORKER_PREFIX)) return false;
    try {
      fs.unlinkSync(path.join(AGENTS_DIR, filename));
      return true;
    } catch (_) {
      return false;
    }
  }

  // Pull a single worker (used for spawn-as-worker injection).
  get(name) {
    const filename = fullName(name) + '.md';
    try {
      const raw = fs.readFileSync(path.join(AGENTS_DIR, filename), 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      return { filename, frontmatter, body, name: frontmatter.name || name };
    } catch (_) {
      return null;
    }
  }

  // Install (or refresh) the bundled starter pack. By default we don't
  // overwrite a file that already exists — the user may have edited it.
  installStarterPack(starterWorkers, { overwrite = false } = {}) {
    ensureDir();
    let installed = 0;
    let skipped = 0;
    for (const w of starterWorkers) {
      const filename = fullName(w.name) + '.md';
      const target = path.join(AGENTS_DIR, filename);
      if (!overwrite && fs.existsSync(target)) { skipped += 1; continue; }
      const fm = {
        name: fullName(w.name),
        description: w.description,
        model: w.model || 'claude-opus-4-7',
        tools: w.tools || 'Read, Write, Edit, Glob, Grep, WebFetch',
        category: w.category || 'other',
        color: w.color || '',
        emoji: w.emoji || '',
      };
      const text = serializeFrontmatter(fm, w.body);
      try {
        fs.writeFileSync(target, text, { mode: 0o644 });
        installed += 1;
      } catch (e) {
        console.warn('[worker-store] install failed for', filename, e.message);
      }
    }
    return { installed, skipped, total: starterWorkers.length };
  }
}

module.exports = WorkerStore;
module.exports.parseFrontmatter = parseFrontmatter;
module.exports.serializeFrontmatter = serializeFrontmatter;
module.exports.fullName = fullName;
module.exports.WORKER_PREFIX = WORKER_PREFIX;
module.exports.CATEGORIES = CATEGORIES;
module.exports.AGENTS_DIR = AGENTS_DIR;

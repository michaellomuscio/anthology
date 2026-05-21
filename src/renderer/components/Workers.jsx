import React, { useCallback, useEffect, useMemo, useState } from 'react';

const station = window.station;

const CATEGORIES = [
  { id: 'engineering', label: 'Engineering', color: '#7B2FBE' },
  { id: 'design',      label: 'Design',      color: '#E8634F' },
  { id: 'content',     label: 'Content',     color: '#D4A843' },
  { id: 'analytics',   label: 'Analytics',   color: '#4DA3D4' },
  { id: 'business',    label: 'Business',    color: '#1DB9A0' },
  { id: 'research',    label: 'Research',    color: '#5A6B7E' },
  { id: 'other',       label: 'Other',       color: '#6B6B73' },
];

const DEFAULT_MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

function emptyWorker() {
  return {
    name: '',
    description: '',
    model: 'claude-opus-4-7',
    tools: 'Read, Write, Edit, Glob, Grep, WebFetch',
    category: 'engineering',
    color: '',
    emoji: '🐝',
    body: '',
  };
}

function stripWorkerPrefix(name) {
  return (name || '').replace(/^worker-/, '');
}

export default function Workers({ onClose }) {
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [editing, setEditing] = useState(null); // { existing: bool, ...workerFields, previousFilename? }
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await station.listWorkers();
      setWorkers(list || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const installStarter = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await station.installWorkerStarterPack();
      await refresh();
    } finally { setBusy(false); }
  };

  const startCreate = () => {
    setEditing({ existing: false, ...emptyWorker() });
  };

  const startEdit = (w) => {
    setEditing({
      existing: true,
      previousFilename: w.filename,
      name: stripWorkerPrefix(w.name || w.filename.replace(/^worker-|\.md$/g, '')),
      description: w.description || '',
      model: w.model || 'claude-opus-4-7',
      tools: w.tools || 'Read, Write, Edit, Glob, Grep, WebFetch',
      category: w.category || 'engineering',
      color: w.color || '',
      emoji: w.emoji || '🐝',
      body: w.body || '',
    });
  };

  const saveEditing = async () => {
    if (!editing || !editing.name.trim() || busy) return;
    setBusy(true);
    try {
      await station.saveWorker({
        name: editing.name.trim(),
        description: editing.description.trim(),
        model: editing.model.trim() || 'claude-opus-4-7',
        tools: editing.tools.trim(),
        category: editing.category,
        color: editing.color.trim(),
        emoji: editing.emoji.trim(),
        body: editing.body,
        previousFilename: editing.previousFilename,
      });
      setEditing(null);
      await refresh();
    } finally { setBusy(false); }
  };

  const deleteEditing = async () => {
    if (!editing?.existing || busy) return;
    if (!window.confirm(`Delete worker "${editing.name}"? The .md file in ~/.claude/agents/ will be removed.`)) return;
    setBusy(true);
    try {
      await station.deleteWorker(editing.previousFilename);
      setEditing(null);
      await refresh();
    } finally { setBusy(false); }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers.filter((w) => {
      if (activeCategory !== 'all' && (w.category || 'other') !== activeCategory) return false;
      if (!q) return true;
      return (
        (w.name || '').toLowerCase().includes(q) ||
        (w.description || '').toLowerCase().includes(q) ||
        (w.body || '').toLowerCase().includes(q)
      );
    });
  }, [workers, query, activeCategory]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const c of CATEGORIES) map.set(c.id, []);
    for (const w of filtered) {
      const cat = w.category || 'other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(w);
    }
    return map;
  }, [filtered]);

  const totalCount = workers.length;
  const categoriesPresent = CATEGORIES.filter((c) => grouped.get(c.id)?.length).length;

  if (editing) {
    return (
      <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
        <div className="modal workers-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>{editing.existing ? 'Edit worker' : 'New worker'}</h2>
            <p>Saved to <code>~/.claude/agents/worker-{(editing.name || 'name').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.md</code></p>
          </div>
          <div className="modal-body worker-form">
            <div className="field-grid">
              <div className="field">
                <div className="field-label">Name <span className="field-label-hint">(without worker- prefix)</span></div>
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. copywriter"
                  autoFocus
                />
              </div>
              <div className="field">
                <div className="field-label">Emoji</div>
                <input
                  value={editing.emoji}
                  onChange={(e) => setEditing({ ...editing, emoji: e.target.value })}
                  maxLength={2}
                  style={{ fontSize: 20, textAlign: 'center' }}
                />
              </div>
            </div>

            <div className="field">
              <div className="field-label">Description <span className="field-label-hint">(one-sentence elevator pitch)</span></div>
              <input
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="What this worker is for and when to call them."
              />
            </div>

            <div className="field-grid">
              <div className="field">
                <div className="field-label">Category</div>
                <select
                  value={editing.category}
                  onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div className="field">
                <div className="field-label">Model</div>
                <select
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                >
                  {DEFAULT_MODELS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div className="field">
              <div className="field-label">Tools <span className="field-label-hint">(comma-separated, used when invoked via Task)</span></div>
              <input
                value={editing.tools}
                onChange={(e) => setEditing({ ...editing, tools: e.target.value })}
                placeholder="Read, Write, Edit, Glob, Grep, WebFetch"
              />
            </div>

            <div className="field">
              <div className="field-label">System prompt <span className="field-label-hint">(the worker's identity and operating principles)</span></div>
              <textarea
                className="worker-body-textarea"
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                placeholder={'You are a senior X.\n\n# How you work\n\n- ...\n\n# You refuse to\n\n- ...'}
                rows={18}
                spellCheck={false}
              />
            </div>
          </div>
          <div className="modal-footer">
            <div className="hint">
              {editing.existing
                ? `Editing existing worker — saving renames if the name changed.`
                : 'New worker — will be installed as worker-<name>.md'}
            </div>
            <div className="actions">
              {editing.existing && (
                <button type="button" onClick={deleteEditing} disabled={busy} className="phone-pair-revoke">
                  Delete
                </button>
              )}
              <button type="button" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button
                type="button"
                className="primary"
                onClick={saveEditing}
                disabled={busy || !editing.name.trim()}
              >
                {busy ? 'Saving…' : (editing.existing ? 'Save' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal workers-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header workers-header">
          <div>
            <h2>Workers</h2>
            <p>
              {totalCount === 0
                ? 'Worker agents are Claude Code personas stored in ~/.claude/agents/'
                : <>{totalCount} worker{totalCount === 1 ? '' : 's'} · {categoriesPresent} categor{categoriesPresent === 1 ? 'y' : 'ies'} · available to any Claude session via <code>Task</code></>}
            </p>
          </div>
          <div className="workers-header-actions">
            <button type="button" className="btn-primary" onClick={startCreate}>+ New worker</button>
          </div>
        </div>

        {totalCount === 0 && !loading ? (
          <div className="workers-empty">
            <div className="workers-empty-emoji">🐝</div>
            <h3>No workers yet</h3>
            <p>
              Install the bundled starter pack to get <strong>29 specialist personas</strong> across Engineering, Design,
              Content, Analytics, Business, and Research — each a tuned system prompt you can invoke
              from any Claude session via <code>Task("worker-name", ...)</code>.
            </p>
            <div className="workers-empty-actions">
              <button type="button" className="btn-primary" onClick={installStarter} disabled={busy}>
                {busy ? 'Installing…' : 'Install starter pack'}
              </button>
              <button type="button" onClick={startCreate}>Create your own</button>
            </div>
          </div>
        ) : (
          <>
            <div className="workers-filters">
              <input
                className="workers-search"
                placeholder="Search by name, description, or system prompt…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="workers-cat-chips">
                <button
                  type="button"
                  className={`workers-cat-chip ${activeCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveCategory('all')}
                >
                  All <span className="count">{workers.length}</span>
                </button>
                {CATEGORIES.map((c) => {
                  const n = workers.filter((w) => (w.category || 'other') === c.id).length;
                  if (n === 0) return null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`workers-cat-chip ${activeCategory === c.id ? 'active' : ''}`}
                      onClick={() => setActiveCategory(c.id)}
                      style={{ '--cat-color': c.color }}
                    >
                      {c.label} <span className="count">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="workers-list">
              {CATEGORIES.map((c) => {
                const list = grouped.get(c.id) || [];
                if (list.length === 0) return null;
                return (
                  <div key={c.id} className="workers-section">
                    <div className="workers-section-label" style={{ color: c.color }}>
                      {c.label} <span className="count">{list.length}</span>
                    </div>
                    <div className="workers-cards">
                      {list.map((w) => (
                        <button
                          key={w.filename}
                          type="button"
                          className="worker-card"
                          onClick={() => startEdit(w)}
                          style={{ borderColor: (w.color || c.color) + '55' }}
                        >
                          <div className="worker-card-head">
                            <span className="worker-card-emoji" style={{ background: (w.color || c.color) + '20' }}>
                              {w.emoji || '🐝'}
                            </span>
                            <span className="worker-card-name">{stripWorkerPrefix(w.name || '')}</span>
                          </div>
                          <div className="worker-card-desc">{w.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="workers-empty-search">
                  No workers match “{query}”.
                </div>
              )}
            </div>
          </>
        )}

        <div className="modal-footer">
          <div className="hint">
            Workers live at <code>~/.claude/agents/worker-*.md</code> — invokable from any Claude Code instance via <code>Task</code>.
          </div>
          <div className="actions">
            <button type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';

export default function CommandPalette({ sessions, statuses, onSelect, onClose }) {
  const [q, setQ] = useState('');

  const filtered = sessions.filter((s) => {
    const ql = q.toLowerCase();
    return !ql || s.name.toLowerCase().includes(ql) || (s.cwd || '').toLowerCase().includes(ql);
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && filtered[0]) {
        e.preventDefault();
        onSelect(filtered[0].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, onSelect]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ paddingTop: '14vh' }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--app-fg-2)' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to session…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--app-fg-1)', fontFamily: 'var(--font-body)', fontSize: 14 }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--app-fg-3)' }}>esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: '20px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--app-fg-2)' }}>
              No matches.
            </div>
          )}
          {filtered.map((s, i) => (
            <div
              key={s.id}
              className="palette-row"
              onClick={() => onSelect(s.id)}
            >
              <div className="colorbar" style={{ background: s.color }} />
              <div className={`status-dot ${statuses[s.id] || 'idle'}`} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13, fontWeight: 600, color: 'var(--app-fg-1)' }}>{s.name}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--app-fg-2)' }}>{s.cwd}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--app-fg-3)', background: 'var(--app-surface-2)', padding: '2px 6px', borderRadius: 3 }}>{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

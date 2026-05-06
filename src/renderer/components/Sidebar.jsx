import React, { useMemo, useState } from 'react';
import beeMark from '../assets/bee-mark.svg';
import AboutModal from './AboutModal.jsx';

function SearchIcon() {
  return (
    <svg className="sidebar-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="pin" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L9 8l-6 1 4.5 4.4L6 20l6-3 6 3-1.5-6.6L21 9l-6-1z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function repoLabel(cwd) {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  return parts.slice(-1)[0] || cwd;
}

function SessionRow({ session, status, unread, index, active, onClick }) {
  return (
    <div className={`session-row ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="session-color-bar" style={{ background: session.color }} />
      <div className="session-row-body">
        <div className="session-row-top">
          <div className={`status-dot ${status}`} />
          <span className="name">{session.name}</span>
          {session.isPM && <span className="pm-badge">PM</span>}
          {session.pinned && <PinIcon />}
        </div>
        <div className="session-row-meta">
          <span className="repo">{repoLabel(session.cwd)}</span>
          {session.tag && <span className="branch">{session.tag}</span>}
        </div>
      </div>
      <div className="session-row-right">
        {index <= 9 && <div className="key-hint">{index}</div>}
        {unread > 0 && <div className="unread-pill">{unread > 99 ? '99+' : unread}</div>}
      </div>
    </div>
  );
}

export default function Sidebar({
  sessions, statuses, unread, activeId, onSelect, onSpawn,
  view, setView, query, setQuery, theme,
}) {
  const [showAbout, setShowAbout] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.cwd || '').toLowerCase().includes(q) ||
      (s.tag || '').toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const pinned = filtered.filter((s) => s.pinned);
  const others = filtered.filter((s) => !s.pinned);

  const activeCount = sessions.filter((s) => statuses[s.id] === 'running' || statuses[s.id] === 'waiting').length;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-logo"
          title="About Anthology"
          onClick={() => setShowAbout(true)}
        >
          <img src={beeMark} alt="Anthology" draggable={false} />
        </button>
        <div>
          <div className="sidebar-title">ANTHOLOGY</div>
          <div className="sidebar-subtitle">{sessions.length} sessions · {activeCount} active</div>
        </div>
      </div>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      <div className="sidebar-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="Search sessions, repos, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${view === 'session' ? 'active' : ''}`} onClick={() => setView('session')}>Sessions</button>
        <button className={`sidebar-tab ${view === 'mission' ? 'active' : ''}`} onClick={() => setView('mission')}>Mission Control</button>
      </div>

      <div className="sidebar-list" data-tour="sidebar-list">
        {pinned.length > 0 && (
          <>
            <div className="sidebar-section-label">Pinned <span className="count">{pinned.length}</span></div>
            {pinned.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                status={statuses[s.id] || 'idle'}
                unread={unread[s.id] || 0}
                index={sessions.indexOf(s) + 1}
                active={s.id === activeId}
                onClick={() => onSelect(s.id)}
              />
            ))}
          </>
        )}
        <div className="sidebar-section-label">All sessions <span className="count">{others.length}</span></div>
        {others.length === 0 && pinned.length === 0 && (
          <div style={{ padding: '20px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--app-fg-2)', lineHeight: 1.5 }}>
            No sessions yet. Hit <strong>⌘N</strong> to spawn your first Claude Code session.
          </div>
        )}
        {others.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            status={statuses[s.id] || 'idle'}
            unread={unread[s.id] || 0}
            index={sessions.indexOf(s) + 1}
            active={s.id === activeId}
            onClick={() => onSelect(s.id)}
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="btn btn-primary" onClick={onSpawn} data-tour="sidebar-spawn">
          <PlusIcon />
          New session<span className="kbd">⌘N</span>
        </button>
      </div>
    </aside>
  );
}

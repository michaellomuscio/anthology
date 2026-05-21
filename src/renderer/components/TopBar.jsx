import React from 'react';

export default function TopBar({ view, setView, theme, toggleTheme, sessions, statuses, openCmdK, openHelp, openPhone, openWorkers, phoneClientCount = 0 }) {
  const counts = sessions.reduce(
    (acc, s) => {
      const st = statuses[s.id] || 'idle';
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    { running: 0, waiting: 0, error: 0, idle: 0 }
  );

  return (
    <div className="topbar">
      <div className="topbar-toggle" data-tour="topbar-views">
        <button className={view === 'session' ? 'active' : ''} onClick={() => setView('session')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></svg>
          Session
        </button>
        <button className={view === 'mission' ? 'active' : ''} onClick={() => setView('mission')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
          Mission Control
        </button>
        <button className={view === 'schedules' ? 'active' : ''} onClick={() => setView('schedules')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          Schedules
        </button>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-status">
        <div className="stat"><span className="status-dot running" /> <strong>{counts.running}</strong> running</div>
        <div className="stat"><span className="status-dot waiting" /> <strong>{counts.waiting}</strong> waiting</div>
        <div className="stat"><span className="status-dot error" /> <strong>{counts.error}</strong> error</div>
        <div className="stat"><span className="status-dot idle" /> <strong>{counts.idle}</strong> idle</div>
      </div>

      <button className="topbar-icon-btn" onClick={openCmdK} title="Command palette (⌘K)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      </button>
      <button
        className="topbar-icon-btn"
        onClick={openWorkers}
        title="Workers (your bench of agent personas)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2c2 2 2 5 0 7-2-2-2-5 0-7z" />
          <path d="M5 13c2-1 5-1 7 0M12 13c2-1 5-1 7 0" />
          <path d="M12 9v13" />
          <path d="M9 22h6" />
        </svg>
      </button>
      <button
        className={`topbar-icon-btn ${phoneClientCount > 0 ? 'has-clients' : ''}`}
        onClick={openPhone}
        title={phoneClientCount > 0 ? `${phoneClientCount} phone connected` : 'Phone (pair / manage)'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
        {phoneClientCount > 0 ? <span className="topbar-icon-dot" /> : null}
      </button>
      <button
        className="topbar-icon-btn"
        onClick={openHelp}
        title="How-to guide"
        data-tour="topbar-help"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <button className="topbar-icon-btn" onClick={toggleTheme} title="Toggle theme">
        {theme === 'dark' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
        )}
      </button>
    </div>
  );
}

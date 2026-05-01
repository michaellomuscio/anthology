import React, { useMemo } from 'react';
import TerminalPane from './Terminal.jsx';
import { STATUS_LABELS } from '../constants.js';

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v8M5 10h14l-2 8H7z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7h6l2 3h10v9a2 2 0 0 1-2 2H3z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

function KillIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

function formatIdle(ms) {
  if (!ms) return '—';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return 'now';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

export default function SessionView({ session, status, lastActivity, onKill, onPin, onRename }) {
  const repoLabel = useMemo(() => {
    if (!session.cwd) return '';
    const parts = session.cwd.split('/').filter(Boolean);
    return parts.slice(-1)[0] || session.cwd;
  }, [session.cwd]);

  return (
    <div className="session-view">
      <div className="terminal-column">
        <div className="session-header">
          <div className="session-header-row1">
            <div className="session-color-tag" style={{ background: session.color }} />
            <div className="session-name" title={session.name}>{session.name}</div>
            {session.isPM && <span className="pm-badge">PM</span>}
            <div className={`session-status-pill ${status}`}>
              <span className={`status-dot ${status}`} />
              {STATUS_LABELS[status] || status}
            </div>
            <div className="session-header-actions">
              <button className="btn btn-ghost" title={session.pinned ? 'Unpin' : 'Pin'} onClick={() => onPin(session.id)}>
                <PinIcon />
                {session.pinned ? 'Unpin' : 'Pin'}
              </button>
              <button
                className="btn btn-ghost"
                title="Rename"
                onClick={() => {
                  const next = window.prompt('Rename session', session.name);
                  if (next && next.trim()) onRename(session.id, next.trim());
                }}
              >
                Rename
              </button>
              <button
                className="btn btn-ghost"
                title="Kill session"
                onClick={() => {
                  if (window.confirm(`Kill session “${session.name}”?`)) onKill(session.id);
                }}
                style={{ color: 'var(--status-error)' }}
              >
                <KillIcon /> Kill
              </button>
            </div>
          </div>
          <div className="session-header-row2">
            <div className="meta">
              <FolderIcon />
              <strong className="truncate" title={session.cwd}>{session.cwd}</strong>
            </div>
            <div className="meta">
              <ClockIcon />
              {formatIdle(lastActivity)} ago
            </div>
            <div className="session-tags">
              {session.tag && <div className="tag">{session.tag}</div>}
              <div className="tag">{repoLabel}</div>
            </div>
          </div>
        </div>

        <TerminalPane session={session} />
      </div>

      <aside className="status-panel">
        <div className="status-panel-section">
          <div className="sp-label">Now</div>
          <div className="sp-value">{statusSentence(status)}</div>
        </div>

        <div className="status-panel-section">
          <div className="sp-label">Working directory</div>
          <div className="sp-value mono" style={{ color: 'var(--app-fg-2)' }}>{session.cwd}</div>
        </div>

        <div className="status-panel-section">
          <div className="sp-label">Session</div>
          <div className="metric-grid">
            <div className="metric">
              <div className="metric-label">Status</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{STATUS_LABELS[status] || status}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Idle</div>
              <div className="metric-value">{formatIdle(lastActivity)}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Tag</div>
              <div className="metric-value" style={{ fontSize: 18, fontFamily: 'var(--font-heading)' }}>{session.tag || '—'}</div>
            </div>
            <div className="metric">
              <div className="metric-label">Pinned</div>
              <div className="metric-value" style={{ fontSize: 18, fontFamily: 'var(--font-heading)' }}>{session.pinned ? 'yes' : 'no'}</div>
            </div>
          </div>
        </div>

        <div className="status-panel-section">
          <div className="sp-label">Tips</div>
          <div className="sp-value mono" style={{ color: 'var(--app-fg-2)', fontStyle: 'normal', lineHeight: 1.6 }}>
            ⌘N spawn · ⌘K palette · 1–9 jump<br />
            ⌘\ flip Mission Control
          </div>
        </div>
      </aside>
    </div>
  );
}

function statusSentence(status) {
  switch (status) {
    case 'waiting': return 'Claude needs a permission decision.';
    case 'running': return 'Claude is working.';
    case 'error':   return 'Last tool call failed — check the terminal.';
    case 'idle':    return 'Idle. Ready for the next message.';
    case 'exited':  return 'Session ended — restart to bring Claude back.';
    default:        return 'Session ready.';
  }
}

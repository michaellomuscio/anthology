import React, { useMemo, useState } from 'react';
import TerminalPane from './Terminal.jsx';
import { STATUS_LABELS } from '../constants.js';
import { insertPathsIntoSession } from '../files.js';

const station = window.station;

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

function PaperclipIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ShieldIcon({ filled }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Z" />
    </svg>
  );
}

function SlashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4 8 20" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h8l-2 8 10-12h-8l2-8z" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 14 8 10" />
      <circle cx="12" cy="14" r="9" />
      <path d="M12 5v2M5 14h2M19 14h2M7.5 9.5l1.4 1.4M16.5 9.5l-1.4 1.4" />
    </svg>
  );
}

// Send a slash command to a session as if the user typed it. `withArgs: true`
// leaves the line unterminated so the user can finish the value live (used for
// /effort, /model). `withArgs: false` sends \r so claude executes immediately.
function sendSlash(sessionId, cmd, { withArgs = false } = {}) {
  if (!sessionId || !cmd) return;
  const text = withArgs ? `/${cmd} ` : `/${cmd}\r`;
  try { station.writePty(sessionId, text); } catch (_) {}
}

function formatIdle(ms) {
  if (!ms) return '—';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return 'now';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

export default function SessionView({ session, status, lastActivity, redactionCount = 0, onKill, onPin, onRename, onToggleMaskSecrets, onOpenSlashPalette }) {
  const maskOn = session.maskSecrets !== false;
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const effortLevels = ['low', 'medium', 'high', 'max'];
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
              <button
                className={`btn btn-ghost mask-toggle ${maskOn ? 'active' : ''}`}
                title={maskOn
                  ? `Secret masking ON · ${redactionCount} redacted so far. Click to disable.`
                  : 'Secret masking OFF. Click to enable.'}
                onClick={() => onToggleMaskSecrets?.(session.id)}
              >
                <ShieldIcon filled={maskOn} />
                {maskOn ? 'Masked' : 'Mask off'}
                {maskOn && redactionCount > 0 && (
                  <span className="mask-count">{redactionCount > 99 ? '99+' : redactionCount}</span>
                )}
              </button>
              <button
                className="btn btn-ghost"
                title="Attach files (or drag onto the terminal)"
                onClick={async () => {
                  try {
                    const paths = await station.pickFiles();
                    if (paths && paths.length) insertPathsIntoSession(session.id, paths);
                  } catch (_) {}
                }}
              >
                <PaperclipIcon />
                Attach
              </button>
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

          {/* Claude-Code quick-action toolbar. Buttons write slash commands
              into the PTY as if the user typed them — same effect as typing
              "/effort high" in claude, just one click. */}
          <div className="claude-quickbar">
            <button
              type="button"
              className="qb-btn"
              title="Slash commands (⌘/)"
              onClick={() => onOpenSlashPalette?.()}
            >
              <SlashIcon />
              <span>Commands</span>
              <span className="kbd-pill">⌘/</span>
            </button>

            <div className="qb-group" tabIndex={0} onBlur={() => setEffortMenuOpen(false)}>
              <button
                type="button"
                className="qb-btn"
                title="Set Claude's effort level"
                onClick={() => setEffortMenuOpen((v) => !v)}
              >
                <GaugeIcon />
                <span>Effort</span>
                <span className="qb-caret">▾</span>
              </button>
              {effortMenuOpen && (
                <div className="qb-menu">
                  {effortLevels.map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className="qb-menu-item"
                      onClick={() => {
                        sendSlash(session.id, `effort ${lvl}`);
                        setEffortMenuOpen(false);
                      }}
                    >
                      <span className="qb-menu-name">{lvl}</span>
                      <span className="qb-menu-hint">/effort {lvl}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className="qb-btn"
              title="Toggle Fast mode (Opus 4.6)"
              onClick={() => sendSlash(session.id, 'fast')}
            >
              <BoltIcon />
              <span>Fast</span>
            </button>

            <button
              type="button"
              className="qb-btn"
              title="Switch model"
              onClick={() => sendSlash(session.id, 'model', { withArgs: true })}
            >
              <span>Model…</span>
            </button>

            <button
              type="button"
              className="qb-btn"
              title="Clear conversation context"
              onClick={() => sendSlash(session.id, 'clear')}
            >
              <span>Clear</span>
            </button>
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

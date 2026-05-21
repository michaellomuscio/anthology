import React from 'react';
import { STATUS_LABELS } from '../constants.js';

function repoLabel(cwd) {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  return parts.slice(-1)[0] || cwd;
}

function formatIdle(ms) {
  if (!ms) return '—';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 5) return 'now';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
}

function MCCard({ session, status, lastActivity, onSelect, alert }) {
  const tool = !session.isPM && session.agentTool ? session.agentTool : null;
  return (
    <div className={`mc-card ${alert ? 'alert' : ''}`} onClick={onSelect}>
      <div className="mc-card-row1">
        <div className="session-color-tag" style={{ background: session.color, height: 16, width: 4 }} />
        <div className={`status-dot ${status}`} />
        <div className="mc-card-name" title={session.name}>{session.name}</div>
        {session.isPM && <span className="pm-badge">PM</span>}
        {tool && (
          <span className={`agent-badge agent-badge--${tool === 'codex' ? 'codex' : 'claude'}`} title={tool === 'codex' ? 'OpenAI Codex' : 'Claude Code'}>
            <span className="agent-badge-mark">{tool === 'codex' ? '⌬' : '✱'}</span>
            {tool === 'codex' ? 'codex' : 'claude'}
          </span>
        )}
        <div className="mc-card-meta">{session.tag || ''}</div>
      </div>
      <div className="mc-card-task">
        {STATUS_LABELS[status] || status}
        <div style={{ marginTop: 4 }}>
          <span className="file" title={session.cwd}>{session.cwd}</span>
        </div>
      </div>
      <div className="mc-card-foot">
        <div>{repoLabel(session.cwd)}</div>
        <div>{formatIdle(lastActivity)} ago</div>
      </div>
    </div>
  );
}

export default function MissionControl({ sessions, statuses, lastActivity, onSelect, onSpawn }) {
  const counts = sessions.reduce(
    (acc, s) => {
      const st = statuses[s.id] || 'idle';
      acc[st] = (acc[st] || 0) + 1;
      return acc;
    },
    { running: 0, waiting: 0, error: 0, idle: 0 }
  );

  const needsAttention = sessions.filter((s) => {
    const st = statuses[s.id];
    return st === 'waiting' || st === 'error';
  });
  const working = sessions.filter((s) => statuses[s.id] === 'running');
  const idleCards = sessions.filter((s) => {
    const st = statuses[s.id];
    return st === 'idle' || st === 'done' || st === 'exited' || !st;
  });

  return (
    <div className="mission-control">
      <div className="mc-header">
        <div>
          <div className="mc-title">MISSION CONTROL</div>
          <div className="mc-subtitle">
            {sessions.length} session{sessions.length === 1 ? '' : 's'} · {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} live
          </div>
        </div>
        <div className="mc-summary">
          <div className="stat"><div className="num purple">{counts.running}</div><div className="lbl">Running</div></div>
          <div className="stat"><div className="num gold">{counts.waiting}</div><div className="lbl">Waiting</div></div>
          <div className="stat"><div className="num coral">{counts.error}</div><div className="lbl">Errors</div></div>
          <div className="stat"><div className="num">{counts.idle}</div><div className="lbl">Idle</div></div>
        </div>
      </div>

      {sessions.length === 0 && (
        <div className="mc-empty">
          <strong>NO SESSIONS YET</strong>
          Spawn your first Claude Code session and it'll show up here, live.
          <div>
            <button className="btn btn-primary" onClick={onSpawn}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
              New session<span className="kbd">⌘N</span>
            </button>
          </div>
        </div>
      )}

      {needsAttention.length > 0 && (
        <>
          <div className="mc-section-title">
            Needs your attention
            <span className="count">{needsAttention.length}</span>
          </div>
          <div className="mc-cards">
            {needsAttention.map((s) => (
              <MCCard key={s.id} session={s} status={statuses[s.id]} lastActivity={lastActivity[s.id]} onSelect={() => onSelect(s.id)} alert />
            ))}
          </div>
        </>
      )}

      {working.length > 0 && (
        <>
          <div className="mc-section-title">
            Working
            <span className="count">{working.length}</span>
          </div>
          <div className="mc-cards">
            {working.map((s) => (
              <MCCard key={s.id} session={s} status={statuses[s.id]} lastActivity={lastActivity[s.id]} onSelect={() => onSelect(s.id)} />
            ))}
          </div>
        </>
      )}

      {idleCards.length > 0 && (
        <>
          <div className="mc-section-title">
            Idle <span className="count">{idleCards.length}</span>
          </div>
          <div className="mc-cards">
            {idleCards.map((s) => (
              <MCCard key={s.id} session={s} status={statuses[s.id] || 'idle'} lastActivity={lastActivity[s.id]} onSelect={() => onSelect(s.id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

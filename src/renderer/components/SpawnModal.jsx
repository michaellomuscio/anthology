import React, { useEffect, useMemo, useState } from 'react';
import { SESSION_COLORS } from '../constants.js';

const station = window.station;

function stripWorkerPrefix(name) { return (name || '').replace(/^worker-/, ''); }

export default function SpawnModal({ onClose, onSpawn, recentTags = [] }) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState('');
  const [color, setColor] = useState(SESSION_COLORS[0]);
  // Free-text. Empty by default — tag is now optional and unconstrained.
  const [tag, setTag] = useState('');
  const [recents, setRecents] = useState([]);
  const [pmMode, setPmMode] = useState(false);
  // 'claude' is the default. 'codex' execs the OpenAI Codex CLI instead
  // (user must `brew install codex` or equivalent). PM mode forces claude
  // because the MCP-tools attach is Claude-specific in v1.
  const [agentTool, setAgentTool] = useState('claude');
  // Optional worker persona — when set, after claude/codex starts the
  // worker's system prompt is bracket-pasted as the first message so
  // the conversation runs in-persona.
  const [personaName, setPersonaName] = useState('');
  const [workers, setWorkers] = useState([]);

  useEffect(() => {
    (async () => {
      const home = await station.getHome();
      setCwd(home);
      const list = await station.listRecentDirs();
      setRecents(list || []);
      if (station.listWorkers) {
        try {
          const ws = await station.listWorkers();
          setWorkers(ws || []);
        } catch (_) {}
      }
    })();
  }, []);

  const workersByCategory = useMemo(() => {
    const map = new Map();
    for (const w of workers) {
      const cat = w.category || 'other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(w);
    }
    return map;
  }, [workers]);

  const onPick = async () => {
    const dir = await station.pickDirectory();
    if (dir) setCwd(dir);
  };

  const submit = (e) => {
    e?.preventDefault?.();
    onSpawn({
      name: name.trim() || (pmMode ? 'project manager' : cwdLeaf(cwd)) || 'session',
      cwd: cwd || '~',
      color,
      tag,
      pm: pmMode,
      agentTool: pmMode ? 'claude' : agentTool,
      // Persona injection happens in the main process after the agent CLI
      // initializes — see pty:create handler.
      personaName: pmMode ? '' : personaName,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <h2>Spawn new session</h2>
          <p>Starts a Claude Code session in the chosen directory.</p>
        </div>
        <div className="modal-body">
          <div
            className={`pm-toggle ${pmMode ? 'on' : ''}`}
            onClick={() => setPmMode((v) => !v)}
            role="button"
            tabIndex={0}
          >
            <div className="pm-toggle-switch">
              <div className="pm-toggle-knob" />
            </div>
            <div className="pm-toggle-text">
              <div className="pm-toggle-title">Project Manager mode</div>
              <div className="pm-toggle-sub">
                Gives this session MCP tools to spawn, message, monitor, and kill other sessions.
                Use it to coordinate complex multi-session work.
              </div>
            </div>
          </div>

          <div className="field">
            <div className="field-label">Agent</div>
            <div className="agent-picker">
              <button
                type="button"
                className={`agent-pill agent-pill--claude ${agentTool === 'claude' ? 'selected' : ''}`}
                onClick={() => setAgentTool('claude')}
              >
                <span className="agent-pill-mark">✱</span>
                Claude Code
              </button>
              <button
                type="button"
                className={`agent-pill agent-pill--codex ${agentTool === 'codex' ? 'selected' : ''}`}
                onClick={() => setAgentTool('codex')}
                disabled={pmMode}
                title={pmMode ? 'Project Manager mode is Claude-only in v1' : 'Spawn the OpenAI Codex CLI instead'}
              >
                <span className="agent-pill-mark">⌬</span>
                Codex
              </button>
            </div>
            {pmMode && (
              <div className="field-hint">PM mode uses Claude — MCP-tools attach is Claude-specific.</div>
            )}
          </div>

          {!pmMode && workers.length > 0 && (
            <div className="field">
              <div className="field-label">
                Persona <span className="field-label-hint">(optional — runs the session as a worker)</span>
              </div>
              <select
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
              >
                <option value="">— none (default Claude/Codex) —</option>
                {Array.from(workersByCategory.entries()).map(([cat, list]) => (
                  <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                    {list.map((w) => (
                      <option key={w.filename} value={stripWorkerPrefix(w.name || w.filename.replace(/\.md$/, ''))}>
                        {(w.emoji || '🐝') + ' ' + stripWorkerPrefix(w.name || '')}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <div className="field-label">Name</div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={pmMode ? 'e.g. ship-the-redesign PM' : 'e.g. fix login flow'}
            />
          </div>

          <div className="field">
            <div className="field-label">Working directory</div>
            <div className="field-row">
              <input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="~/code/your-repo"
              />
              <button type="button" className="btn btn-ghost" onClick={onPick}>Choose…</button>
            </div>
            {recents.length > 0 && (
              <div className="recent-dirs">
                <div className="recent-dirs-label">Recent</div>
                <div className="recent-dirs-chips">
                  {recents.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`recent-chip ${d === cwd ? 'active' : ''}`}
                      onClick={() => setCwd(d)}
                      title={d}
                    >
                      {leaf(d)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-label">Tag <span className="field-label-hint">(any label — cds-emails, marketing, research, …)</span></div>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="optional"
            />
            {recentTags.length > 0 && (
              <div className="tag-chips">
                {recentTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`tag-chip ${t === tag ? 'active' : ''}`}
                    onClick={() => setTag(t === tag ? '' : t)}
                    title={t === tag ? 'Click to clear' : 'Use this tag'}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-label">Color</div>
            <div className="color-picker">
              {SESSION_COLORS.map((c) => (
                <div
                  key={c}
                  className={`color-swatch ${c === color ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <span className="hint">
            {pmMode
              ? 'Spawns claude with --mcp-config · station_* tools available'
              : agentTool === 'codex'
                ? 'Spawns a real PTY · runs `codex` in the chosen directory'
                : 'Spawns a real PTY · runs `claude` in the chosen directory'}
          </span>
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {pmMode ? 'Spawn PM' : 'Spawn'}<span className="kbd">⏎</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function cwdLeaf(cwd) {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function leaf(p) {
  return cwdLeaf(p) || p;
}

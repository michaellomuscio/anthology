import React, { useEffect, useState, useCallback } from 'react';
import { SESSION_COLORS, TAGS } from '../constants.js';

const station = window.station;

const PRESETS = [
  { id: 'every-15m', label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { id: 'hourly',    label: 'Every hour',       cron: '0 * * * *'  },
  { id: 'daily-9',   label: 'Every day at 9:00 AM',  cron: '0 9 * * *'  },
  { id: 'daily-17',  label: 'Every day at 5:00 PM',  cron: '0 17 * * *' },
  { id: 'weekday-9', label: 'Weekdays at 9:00 AM',   cron: '0 9 * * 1-5' },
  { id: 'mon-10',    label: 'Mondays at 10:00 AM',   cron: '0 10 * * 1' },
];

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function leaf(p) {
  if (!p) return '';
  return p.split('/').filter(Boolean).slice(-1)[0] || p;
}

function uid() {
  return 'sch_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

export default function Schedules({ onJump }) {
  const [schedules, setSchedules] = useState([]);
  const [editing, setEditing] = useState(null); // null | schedule
  const [now, setNow] = useState(Date.now());

  const reload = useCallback(async () => {
    const list = await station.listSchedules();
    setSchedules(list || []);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = station.onScheduleFired(({ id, ok }) => {
      reload();
    });
    return () => off();
  }, [reload]);

  const handleSave = async (sched) => {
    await station.upsertSchedule(sched);
    setEditing(null);
    reload();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this schedule?')) return;
    await station.deleteSchedule(id);
    reload();
  };

  const handleToggleEnabled = async (sched) => {
    await station.upsertSchedule({ ...sched, enabled: !sched.enabled });
    reload();
  };

  const handleRunNow = async (sched) => {
    await station.runScheduleNow(sched.id);
  };

  return (
    <div className="schedules">
      <div className="schedules-header">
        <div>
          <div className="schedules-title">SCHEDULES</div>
          <div className="schedules-subtitle">
            {schedules.length} schedule{schedules.length === 1 ? '' : 's'} · spawn Claude Code sessions on a cron or one-shot basis
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(newScheduleDraft())}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
          New schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="schedules-empty">
          <strong>NO SCHEDULES</strong>
          Schedule a Claude Code session to run a specific prompt at a date/time, or on a recurring cron pattern.
          <div>
            <button className="btn btn-primary" onClick={() => setEditing(newScheduleDraft())}>
              Create your first schedule
            </button>
          </div>
        </div>
      ) : (
        <div className="schedules-list">
          {schedules.map((s) => (
            <div key={s.id} className={`schedule-card ${s.enabled ? '' : 'disabled'}`}>
              <div className="schedule-row1">
                <div className="schedule-color" style={{ background: s.color || '#7B2FBE' }} />
                <div className="schedule-name">{s.name}</div>
                <div className="schedule-tag">{s.tag || ''}</div>
                <div className="schedule-actions">
                  <button className="btn btn-ghost" onClick={() => handleRunNow(s)} title="Run now">Run now</button>
                  <button className="btn btn-ghost" onClick={() => handleToggleEnabled(s)}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEditing(s)}>Edit</button>
                  <button className="btn btn-ghost" style={{ color: 'var(--status-error)' }} onClick={() => handleDelete(s.id)}>Delete</button>
                </div>
              </div>
              <div className="schedule-row2">
                <div className="meta"><strong>{s.kind === 'cron' ? `cron · ${s.cron}` : `once at ${formatDate(Date.parse(s.when))}`}</strong></div>
                <div className="meta">cwd · <span className="mono">{leaf(s.cwd)}</span></div>
                {s.enabled && s.nextRunAt && <div className="meta">next · {formatDate(s.nextRunAt)}</div>}
                {s.lastRunAt && <div className="meta">last · {formatDate(s.lastRunAt)}</div>}
              </div>
              <div className="schedule-prompt">
                <div className="schedule-prompt-label">Prompt</div>
                <div className="schedule-prompt-body">{s.prompt}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ScheduleEditor
          schedule={editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function newScheduleDraft() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  return {
    id: uid(),
    name: '',
    cwd: '',
    prompt: '',
    color: SESSION_COLORS[0],
    tag: 'scheduled',
    kind: 'cron',
    cron: '0 9 * * *',
    when: now.toISOString().slice(0, 16),
    enabled: true,
    createdAt: Date.now(),
  };
}

function ScheduleEditor({ schedule, onSave, onCancel }) {
  const [draft, setDraft] = useState({ ...schedule });
  const [presetId, setPresetId] = useState(() => PRESETS.find((p) => p.cron === schedule.cron)?.id || 'custom');
  const [recents, setRecents] = useState([]);

  useEffect(() => {
    (async () => {
      if (!draft.cwd) {
        const home = await station.getHome();
        setDraft((d) => ({ ...d, cwd: home }));
      }
      const list = await station.listRecentDirs();
      setRecents(list || []);
    })();
  }, []);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const onPick = async () => {
    const dir = await station.pickDirectory();
    if (dir) set({ cwd: dir });
  };

  const submit = (e) => {
    e?.preventDefault?.();
    const out = {
      ...draft,
      name: draft.name?.trim() || (leaf(draft.cwd) || 'scheduled'),
    };
    if (out.kind === 'oneshot') {
      out.cron = null;
      out.when = new Date(out.when).toISOString();
    } else {
      out.when = null;
    }
    onSave(out);
  };

  const onPreset = (id) => {
    setPresetId(id);
    if (id !== 'custom') {
      const p = PRESETS.find((x) => x.id === id);
      if (p) set({ kind: 'cron', cron: p.cron });
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ width: 640 }}>
        <div className="modal-header">
          <h2>{schedule.name ? 'Edit schedule' : 'New schedule'}</h2>
          <p>Spawns a Claude Code session at the chosen time and submits the prompt automatically.</p>
        </div>
        <div className="modal-body">
          <div className="field">
            <div className="field-label">Name</div>
            <input autoFocus value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. morning standup digest" />
          </div>

          <div className="field">
            <div className="field-label">Working directory</div>
            <div className="field-row">
              <input value={draft.cwd} onChange={(e) => set({ cwd: e.target.value })} placeholder="~/code/your-repo" />
              <button type="button" className="btn btn-ghost" onClick={onPick}>Choose…</button>
            </div>
            {recents.length > 0 && (
              <div className="recent-dirs">
                <div className="recent-dirs-label">Recent</div>
                <div className="recent-dirs-chips">
                  {recents.map((d) => (
                    <button key={d} type="button" className={`recent-chip ${d === draft.cwd ? 'active' : ''}`} onClick={() => set({ cwd: d })} title={d}>
                      {leaf(d)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-label">Prompt</div>
            <textarea
              value={draft.prompt}
              onChange={(e) => set({ prompt: e.target.value })}
              placeholder="What should Claude do when this fires? e.g. 'Run my morning skill and summarize my inbox.'"
              rows={4}
              style={{
                width: '100%', background: 'var(--app-surface-2)', border: '1px solid var(--app-border)',
                borderRadius: 6, padding: '8px 10px', color: 'var(--app-fg-1)',
                fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical',
              }}
            />
          </div>

          <div className="field">
            <div className="field-label">When</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={`btn ${draft.kind === 'cron' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ kind: 'cron' })}>Recurring</button>
              <button type="button" className={`btn ${draft.kind === 'oneshot' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => set({ kind: 'oneshot' })}>One-shot</button>
            </div>

            {draft.kind === 'cron' ? (
              <div style={{ marginTop: 10 }}>
                <select value={presetId} onChange={(e) => onPreset(e.target.value)}>
                  {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  <option value="custom">Custom cron…</option>
                </select>
                <input
                  style={{ marginTop: 8 }}
                  value={draft.cron || ''}
                  onChange={(e) => { setPresetId('custom'); set({ cron: e.target.value }); }}
                  placeholder="m h dom mon dow  ·  e.g. 0 9 * * 1-5"
                />
                <div style={{ marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--app-fg-2)' }}>
                  5-field cron: minute · hour · day-of-month · month · day-of-week (0–6, Sun–Sat)
                </div>
              </div>
            ) : (
              <input type="datetime-local" style={{ marginTop: 10 }} value={draft.when} onChange={(e) => set({ when: e.target.value })} />
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="field">
              <div className="field-label">Tag</div>
              <select value={draft.tag} onChange={(e) => set({ tag: e.target.value })}>
                {[...new Set(['scheduled', ...TAGS])].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <div className="field-label">Color</div>
              <div className="color-picker">
                {SESSION_COLORS.map((c) => (
                  <div key={c} className={`color-swatch ${c === draft.color ? 'selected' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} />
                ))}
              </div>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={!!draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13 }}>Enabled</span>
          </label>
        </div>
        <div className="modal-footer">
          <span className="hint">Schedules persist across app restarts. Misses while the app was closed are skipped.</span>
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save schedule</button>
          </div>
        </div>
      </form>
    </div>
  );
}

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';

const station = window.station;

// Curated set of Claude Code's built-in slash commands. Skills / user-defined
// commands aren't statically discoverable, so we ship this list as the
// baseline and let the user type free text after "/" to send anything else.
//
// To add more commands without code changes: drop into the future Settings
// surface — for v1, edit this constant.
const COMMANDS = [
  { name: 'help',            description: 'Show help and the command reference' },
  { name: 'clear',           description: 'Clear the conversation context' },
  { name: 'compact',         description: 'Compact the conversation history' },
  { name: 'resume',          description: 'Resume a previous session' },
  { name: 'memory',          description: 'View or edit Claude’s long-term memory' },
  { name: 'effort',          description: 'Set effort level — low / medium / high / max' },
  { name: 'fast',            description: 'Toggle fast mode (Opus 4.6, faster output)' },
  { name: 'model',           description: 'Switch the underlying Claude model' },
  { name: 'init',            description: 'Generate a CLAUDE.md for this codebase' },
  { name: 'review',          description: 'Review a pull request' },
  { name: 'security-review', description: 'Security review of pending changes' },
  { name: 'loop',            description: 'Run a prompt on a recurring interval' },
  { name: 'schedule',        description: 'Schedule a remote agent on a cron' },
  { name: 'cost',            description: 'Show token spend for this session' },
];

function fuzzyScore(needle, hay) {
  // Simple subsequence + prefix bonus. Good enough for ~50 entries.
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (!n) return 0;
  if (h.startsWith(n)) return 100;
  if (h.includes(n)) return 50;
  // Subsequence
  let i = 0;
  for (const c of h) {
    if (c === n[i]) i += 1;
    if (i === n.length) return 10;
  }
  return -1;
}

export default function SlashPalette({ sessionId, onClose }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const ql = q.trim();
    if (!ql) return COMMANDS;
    const scored = COMMANDS
      .map((c) => ({ c, s: Math.max(fuzzyScore(ql, c.name), fuzzyScore(ql, c.description) - 10) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.map(({ c }) => c);
  }, [q]);

  // Reset selection whenever the result set shape changes.
  useEffect(() => { setSelected(0); }, [filtered.length, q]);

  // Keep the selected row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-row-idx="${selected}"]`);
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Send the chosen command to the active PTY as if the user typed it.
  // `/effort` (and a few others) take subcommand arguments — we leave the
  // line unterminated for those so the user can finish typing the value,
  // and submit \r right away for argument-less commands.
  const submit = useCallback((cmd, { withArgs = false } = {}) => {
    if (!cmd || !sessionId) return;
    const text = withArgs ? `/${cmd.name} ` : `/${cmd.name}\r`;
    try { station.writePty(sessionId, text); } catch (_) {}
    onClose();
  }, [sessionId, onClose]);

  // Commands that always take an argument — submitting bare doesn't make sense.
  const isArgCommand = (cmd) => ['effort', 'model'].includes(cmd?.name);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(filtered.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selected];
        submit(cmd, { withArgs: isArgCommand(cmd) });
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        // Tab on an argument command leaves the popup AND drops the prefix
        // into the terminal so the user finishes the value live.
        e.preventDefault();
        const cmd = filtered[selected];
        if (cmd) submit(cmd, { withArgs: true });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filtered, selected, onClose, submit]);

  return (
    <div className="modal-overlay slash-overlay" onClick={onClose}>
      <div className="modal slash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="slash-search">
          <span className="slash-prefix">/</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter Claude commands…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <span className="kbd-hint">esc</span>
        </div>
        <div className="slash-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="slash-empty">
              No commands match “{q}”. Press <strong>Enter</strong> to send it anyway, or <strong>esc</strong> to cancel.
            </div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.name}
              data-row-idx={i}
              className={`slash-row ${i === selected ? 'selected' : ''}`}
              onClick={() => submit(c, { withArgs: isArgCommand(c) })}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="slash-row-main">
                <span className="slash-row-name">/{c.name}</span>
                <span className="slash-row-desc">{c.description}</span>
              </div>
              {isArgCommand(c) && <span className="slash-row-args">takes args</span>}
            </div>
          ))}
        </div>
        <div className="slash-foot">
          <span><span className="kbd-hint">↑↓</span> navigate · <span className="kbd-hint">↵</span> send · <span className="kbd-hint">tab</span> drop prefix · <span className="kbd-hint">esc</span> close</span>
          <span>sends to the active session</span>
        </div>
      </div>
    </div>
  );
}

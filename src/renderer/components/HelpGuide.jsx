import React from 'react';

const CLAUDE_CODE_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code/setup';
const CLAUDE_CODE_HOME_URL = 'https://docs.claude.com/en/docs/claude-code/overview';

function Section({ title, children }) {
  return (
    <section className="help-guide-section">
      <h3 className="help-guide-section-title">{title}</h3>
      <div className="help-guide-section-body">{children}</div>
    </section>
  );
}

function ShortcutRow({ keys, label }) {
  return (
    <div className="help-guide-shortcut">
      <div className="help-guide-shortcut-keys">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="help-guide-shortcut-sep">then</span>}
            <kbd>{k}</kbd>
          </React.Fragment>
        ))}
      </div>
      <div className="help-guide-shortcut-label">{label}</div>
    </div>
  );
}

export default function HelpGuide({ onClose, onReplayTour }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Anthology how-to guide"
      >
        <div className="modal-header help-guide-header">
          <div>
            <h2>How to use Anthology</h2>
            <p>A quick reference for every feature in the app.</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              onClose();
              onReplayTour();
            }}
          >
            Replay onboarding tour
          </button>
        </div>

        <div className="modal-body help-guide-body">
          <Section title="Before you start: install Claude Code">
            <p>
              Anthology is a manager for real Claude Code sessions — it
              spawns the <code>claude</code> CLI under the hood. You need
              Claude Code installed and authenticated on this machine before
              spawning anything.
            </p>
            <ol className="help-guide-list">
              <li>
                Install with npm:
                <pre className="help-guide-code">
                  npm install -g @anthropic-ai/claude-code
                </pre>
              </li>
              <li>
                Run <code>claude</code> once in any terminal and complete the
                sign-in flow.
              </li>
              <li>
                Verify it works with <code>claude --version</code>.
              </li>
            </ol>
            <div className="help-guide-links">
              <a href={CLAUDE_CODE_DOCS_URL} target="_blank" rel="noopener noreferrer">
                Anthropic setup guide ↗
              </a>
              <a href={CLAUDE_CODE_HOME_URL} target="_blank" rel="noopener noreferrer">
                Claude Code documentation ↗
              </a>
            </div>
          </Section>

          <Section title="Spawning a session">
            <p>
              Hit <kbd>⌘N</kbd> or click <strong>New session</strong> in the
              sidebar. Pick a working directory — that's where{' '}
              <code>claude</code> will run, and it controls what files the
              agent can see. Optionally name the session and pick a color or
              tag to make it easy to find.
            </p>
            <p>
              Each session is a real PTY: scrollback persists across app
              restarts, terminal output is rendered with WebGL, and you can
              type into it like any terminal.
            </p>
          </Section>

          <Section title="Project Manager mode">
            <p>
              In the spawn dialog, toggle <strong>Project Manager mode</strong>{' '}
              to give a session MCP tools that let it spawn, message,
              monitor, and kill other sessions. Use this when you want one
              Claude session to coordinate a multi-session effort — e.g. a
              PM session delegating chunks of a large refactor to worker
              sessions.
            </p>
            <p>
              PM sessions are pinned by default and badged with{' '}
              <strong>PM</strong> in the sidebar.
            </p>
          </Section>

          <Section title="Mission Control & Sessions view">
            <p>
              The top-bar toggle switches between three views:
            </p>
            <ul className="help-guide-list">
              <li>
                <strong>Session</strong> — full terminal for the active
                session, with a header showing its status.
              </li>
              <li>
                <strong>Mission Control</strong> — a tile per session showing
                live status, last activity, and recent output. Great for
                keeping an eye on a fleet.
              </li>
              <li>
                <strong>Schedules</strong> — manage cron-style timers that
                fire actions (e.g. send a message into a session at 9am).
              </li>
            </ul>
          </Section>

          <Section title="Status indicators">
            <p>
              Each session has a colored status dot:{' '}
              <span className="help-guide-status">
                <span className="status-dot running" /> running
              </span>
              ,{' '}
              <span className="help-guide-status">
                <span className="status-dot waiting" /> waiting
              </span>{' '}
              (Claude is asking for a permission decision),{' '}
              <span className="help-guide-status">
                <span className="status-dot error" /> error
              </span>{' '}
              (a tool call failed), and{' '}
              <span className="help-guide-status">
                <span className="status-dot idle" /> idle
              </span>
              . Anthology sends macOS notifications when a non-active
              session needs you, and shows a dock badge for unread output.
            </p>
          </Section>

          <Section title="Keyboard shortcuts">
            <p>
              There's no cap on the number of sessions you can run — the
              1–9 shortcuts are just a one-key jump for the first nine
              sessions in the sidebar. For the rest, use the sidebar,
              search, or the command palette (<kbd>⌘K</kbd>).
            </p>
            <div className="help-guide-shortcuts">
              <ShortcutRow keys={['⌘', 'N']} label="New session" />
              <ShortcutRow keys={['⌘', 'K']} label="Open command palette" />
              <ShortcutRow keys={['⌘', '\\']} label="Toggle Session ↔ Mission Control" />
              <ShortcutRow keys={['⌘', '1–9']} label="Jump to session 1–9 (works while typing in the terminal)" />
              <ShortcutRow keys={['1–9']} label="Jump to session 1–9 (when not typing)" />
              <ShortcutRow keys={['Esc']} label="Close any modal or dialog" />
            </div>
          </Section>

          <Section title="Tips">
            <ul className="help-guide-list">
              <li>
                Sessions you've ended (<code>/exit</code> or crash) stay in
                the list with a Restart banner — hit Restart to bring them
                back, or kill from the header to remove for good.
              </li>
              <li>
                Pin sessions you check often to keep them at the top of the
                sidebar.
              </li>
              <li>
                The search box filters by name, repo, and tag — useful once
                you have more than a handful of sessions.
              </li>
            </ul>
          </Section>
        </div>

        <div className="modal-footer">
          <span className="hint">
            Press <kbd>Esc</kbd> to close this guide
          </span>
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                onClose();
                onReplayTour();
              }}
            >
              Replay tour
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

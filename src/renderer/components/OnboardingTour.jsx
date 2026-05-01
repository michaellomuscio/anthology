import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const CLAUDE_CODE_DOCS_URL = 'https://docs.claude.com/en/docs/claude-code/setup';

function ClaudeCodePrereq() {
  return (
    <div className="tour-prereq">
      <div className="tour-prereq-label">Prerequisite</div>
      <div className="tour-prereq-title">Claude Code must be installed</div>
      <p className="tour-prereq-body">
        Anthology spawns real <code>claude</code> processes on your machine —
        it does not bundle Claude Code itself. Install it once with npm and
        sign in before spawning your first session here.
      </p>
      <pre className="tour-prereq-code">npm install -g @anthropic-ai/claude-code</pre>
      <p className="tour-prereq-body">
        Then run <code>claude</code> once in any terminal to authenticate.
      </p>
      <a
        className="tour-prereq-link"
        href={CLAUDE_CODE_DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open Anthropic setup guide ↗
      </a>
    </div>
  );
}

const STEPS = [
  {
    id: 'welcome',
    placement: 'center',
    title: 'Welcome to Anthology',
    body: (
      <>
        <p>
          Anthology is a Mac app for running and coordinating multiple
          Claude Code sessions side-by-side, all in one window.
        </p>
        <p>
          This quick tour highlights the main features. It takes about thirty
          seconds — first, a one-time prerequisite.
        </p>
        <ClaudeCodePrereq />
      </>
    ),
  },
  {
    id: 'spawn',
    target: '[data-tour="sidebar-spawn"]',
    placement: 'top',
    title: 'Spawn a Claude Code session',
    body: (
      <>
        <p>
          Click here (or press <kbd>⌘N</kbd>) to start a new Claude Code
          session in any directory on your machine. Each session runs as a
          real PTY — exactly like running <code>claude</code> in a terminal.
        </p>
        <p className="tour-popout-tip">
          Tip: toggle <strong>Project Manager mode</strong> in the spawn
          dialog to give a session MCP tools that can spawn, message, and
          monitor the others.
        </p>
      </>
    ),
  },
  {
    id: 'sessions',
    target: '[data-tour="sidebar-list"]',
    placement: 'right',
    title: 'Your sessions live here',
    body: (
      <>
        <p>
          Every session you spawn shows up in this list with a live status
          dot. Pinned sessions float to the top; unread output shows as a
          pill on the row.
        </p>
        <p className="tour-popout-tip">
          You can run as many sessions as you like. Press{' '}
          <kbd>1</kbd>–<kbd>9</kbd> (or <kbd>⌘1</kbd>–<kbd>⌘9</kbd> while
          typing) for one-key jumps to the first nine; use the sidebar,
          search, or <kbd>⌘K</kbd> for the rest.
        </p>
      </>
    ),
  },
  {
    id: 'views',
    target: '[data-tour="topbar-views"]',
    placement: 'bottom',
    title: 'Three ways to see your work',
    body: (
      <>
        <p>
          <strong>Session</strong> shows the full terminal for the active
          session. <strong>Mission Control</strong> tiles every session for
          a at-a-glance overview. <strong>Schedules</strong> manages timed
          actions.
        </p>
        <p className="tour-popout-tip">
          Toggle Session ↔ Mission Control with <kbd>⌘\</kbd>. Open the
          command palette with <kbd>⌘K</kbd>.
        </p>
      </>
    ),
  },
  {
    id: 'help',
    target: '[data-tour="topbar-help"]',
    placement: 'bottom',
    title: 'Help is always one click away',
    body: (
      <p>
        Click this button anytime to open the how-to guide — it covers
        every feature in detail and lets you replay this tour. You'll find
        keyboard shortcuts and Claude Code setup tips in there too.
      </p>
    ),
  },
  {
    id: 'done',
    placement: 'center',
    title: "You're set",
    body: (
      <>
        <p>
          That's the tour. Hit <kbd>⌘N</kbd> to spawn your first Claude Code
          session and start working.
        </p>
        <p className="tour-popout-tip">
          If you skipped the Claude Code install above, run{' '}
          <code>npm install -g @anthropic-ai/claude-code</code> in a
          terminal before spawning, or sessions will fail to start.
        </p>
      </>
    ),
  },
];

const POPOUT_WIDTH = 380;
const POPOUT_GAP = 14;
const VIEWPORT_PAD = 16;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function useTargetRect(selector, active) {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!selector || !active) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      });
    };
    measure();
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    // Light polling catches sidebar layout shifts (sessions list growing,
    // search filtering, etc.) without wiring observers into every component.
    const interval = setInterval(measure, 300);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      clearInterval(interval);
    };
  }, [selector, active]);

  return rect;
}

function popoutPosition(rect, placement, popoutHeight) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = POPOUT_WIDTH;
  const h = popoutHeight || 220;

  if (!rect) {
    // Centered (welcome / done)
    return {
      top: clamp((vh - h) / 2, VIEWPORT_PAD, vh - h - VIEWPORT_PAD),
      left: clamp((vw - w) / 2, VIEWPORT_PAD, vw - w - VIEWPORT_PAD),
    };
  }

  let top, left;
  switch (placement) {
    case 'top':
      top = rect.top - h - POPOUT_GAP;
      left = rect.left + rect.width / 2 - w / 2;
      break;
    case 'bottom':
      top = rect.top + rect.height + POPOUT_GAP;
      left = rect.left + rect.width / 2 - w / 2;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - h / 2;
      left = rect.left - w - POPOUT_GAP;
      break;
    case 'right':
    default:
      top = rect.top + rect.height / 2 - h / 2;
      left = rect.left + rect.width + POPOUT_GAP;
      break;
  }

  // Keep within viewport — flip to opposite side if it would clip.
  if (left < VIEWPORT_PAD) left = rect.left + rect.width + POPOUT_GAP;
  if (left + w > vw - VIEWPORT_PAD) left = rect.left - w - POPOUT_GAP;
  if (top < VIEWPORT_PAD) top = rect.top + rect.height + POPOUT_GAP;
  if (top + h > vh - VIEWPORT_PAD) top = rect.top - h - POPOUT_GAP;

  // Final clamp in case the flip still overflows on small windows.
  top = clamp(top, VIEWPORT_PAD, vh - h - VIEWPORT_PAD);
  left = clamp(left, VIEWPORT_PAD, vw - w - VIEWPORT_PAD);

  return { top, left };
}

export default function OnboardingTour({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const popoutRef = useRef(null);
  const [popoutHeight, setPopoutHeight] = useState(220);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const rect = useTargetRect(step.target, !!step.target);

  // Measure popout to position it accurately (heights vary by step content).
  useLayoutEffect(() => {
    if (popoutRef.current) {
      setPopoutHeight(popoutRef.current.offsetHeight);
    }
  }, [stepIndex]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLast) onClose();
        else setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isLast, onClose]);

  const showSpotlight = !!step.target && !!rect;
  const pos = popoutPosition(showSpotlight ? rect : null, step.placement, popoutHeight);

  return (
    <div className="tour-root">
      {showSpotlight ? (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      ) : (
        <div className="tour-dim" onClick={onClose} />
      )}

      <div
        ref={popoutRef}
        className={`tour-popout ${step.placement === 'center' ? 'tour-popout-center' : ''}`}
        style={{ top: pos.top, left: pos.left, width: POPOUT_WIDTH }}
      >
        <div className="tour-popout-header">
          <div className="tour-popout-step-pill">
            Step {stepIndex + 1} of {STEPS.length}
          </div>
          <button
            type="button"
            className="tour-popout-close"
            onClick={onClose}
            aria-label="Skip tour"
            title="Skip tour"
          >
            ×
          </button>
        </div>
        <h3 className="tour-popout-title">{step.title}</h3>
        <div className="tour-popout-body">{step.body}</div>
        <div className="tour-popout-footer">
          <div className="tour-step-dots">
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`tour-step-dot ${i === stepIndex ? 'active' : ''} ${i < stepIndex ? 'past' : ''}`}
              />
            ))}
          </div>
          <div className="tour-popout-actions">
            {stepIndex > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </button>
            )}
            {!isLast && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={onClose}
              >
                Skip
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (isLast) onClose();
                else setStepIndex((i) => Math.min(STEPS.length - 1, i + 1));
              }}
            >
              {isLast ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

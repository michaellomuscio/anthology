import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { ImageAddon } from '@xterm/addon-image';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { isFileDrag, pathsFromDropEvent, insertPathsIntoSession } from '../files.js';

// Cap how much scrollback we serialize to disk per session — full xterm state
// can balloon for verbose claude runs; this keeps writes snappy and userData
// bounded. The save itself is also size-capped server-side as a backstop.
const PERSIST_SCROLLBACK_LINES = 2000;
const PERSIST_INTERVAL_MS = 10_000;

const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(123, 47, 190, 0.45)',
  matchBorder: '#7B2FBE',
  activeMatchBackground: 'rgba(169, 107, 219, 0.65)',
  activeMatchBorder: '#C690F0',
  matchOverviewRuler: '#7B2FBE',
  activeMatchColorOverviewRuler: '#C690F0',
};

const station = window.station;

// Per-session xterm instance + buffer cache so terminals survive view switches.
const terminalCache = new Map(); // sessionId -> { term, fit, links, buffer, attached, ptyOffData, ptyOffExit }

function makeTerm() {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace',
    fontSize: 13,
    lineHeight: 1.2,
    allowTransparency: true,
    allowProposedApi: true,
    convertEol: false,
    scrollback: 10000,
    macOptionIsMeta: true,
    theme: {
      background: '#0A0A0B',
      foreground: '#D8D8DD',
      cursor: '#D8D8DD',
      cursorAccent: '#0A0A0B',
      selectionBackground: 'rgba(123, 47, 190, 0.35)',
      black: '#0A0A0B',
      red: '#E8634F',
      green: '#1DB9A0',
      yellow: '#D4A843',
      blue: '#4DA3D4',
      magenta: '#A96BDB',
      cyan: '#6BD4B5',
      white: '#D8D8DD',
      brightBlack: '#5A5A62',
      brightRed: '#FF7E68',
      brightGreen: '#3DD9BD',
      brightYellow: '#F0C063',
      brightBlue: '#6BBEEF',
      brightMagenta: '#C690F0',
      brightCyan: '#88E8C9',
      brightWhite: '#F8F8F8',
    },
  });
  const fit = new FitAddon();
  const links = new WebLinksAddon();
  const image = new ImageAddon();
  const unicode11 = new Unicode11Addon();
  const search = new SearchAddon();
  const serialize = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(links);
  term.loadAddon(image);
  term.loadAddon(unicode11);
  term.loadAddon(search);
  term.loadAddon(serialize);
  // Activate Unicode 11 width tables so emoji and CJK render at the widths
  // Claude Code's TUI assumes — without this, columns drift in spinner output.
  term.unicode.activeVersion = '11';
  return { term, fit, links, image, search, serialize };
}

// Self-healing WebGL attach. On context loss (GPU eviction, monitor sleep,
// tab backgrounded), the addon is disposed AND we schedule a re-attach so
// the user keeps GPU rendering without having to switch sessions.
function attachWebgl(entry) {
  if (!entry?.term || entry.webglAttached) return;
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      try { webgl.dispose(); } catch (_) {}
      entry.webglAttached = false;
      entry.webgl = null;
      // Give the GPU a moment to recover before re-attaching. If the term
      // has been disposed in the meantime, the next call will no-op.
      setTimeout(() => {
        if (entry.term?.element?.isConnected) attachWebgl(entry);
      }, 500);
    });
    entry.term.loadAddon(webgl);
    entry.webgl = webgl;
    entry.webglAttached = true;
  } catch (e) {
    console.warn('[terminal] WebGL renderer unavailable, using DOM fallback:', e?.message);
  }
}

function persistEntry(sessionId, entry) {
  if (!entry?.dirty || !entry.serialize) return;
  try {
    const data = entry.serialize.serialize({ scrollback: PERSIST_SCROLLBACK_LINES });
    station.saveBuffer(sessionId, data);
    entry.dirty = false;
  } catch (e) {
    console.warn('[terminal] persist failed:', e?.message);
  }
}

// One-shot module-level subscription: when main fires `app:flush` during
// before-quit, serialize every cached entry and ack so main can proceed.
// The HMR/import-twice guard prevents double-binding in dev.
let flushHandlerInstalled = false;
function installFlushHandler() {
  if (flushHandlerInstalled) return;
  if (!station?.onFlushRequest) return;
  flushHandlerInstalled = true;
  station.onFlushRequest(async () => {
    const pending = [];
    for (const [sessionId, entry] of terminalCache.entries()) {
      if (!entry?.serialize) continue;
      try {
        const data = entry.serialize.serialize({ scrollback: PERSIST_SCROLLBACK_LINES });
        pending.push(station.saveBuffer(sessionId, data));
        entry.dirty = false;
      } catch (_) {}
    }
    try { await Promise.all(pending); } catch (_) {}
    try { station.ackFlush(); } catch (_) {}
  });
}
installFlushHandler();

async function ensureSession(sessionId, cwd, isPM, wasExited = false, maskSecrets = true, agentTool = 'claude') {
  let entry = terminalCache.get(sessionId);
  let freshEntry = false;
  if (!entry) {
    const { term, fit, links, search, serialize } = makeTerm();
    entry = {
      term, fit, links, search, serialize,
      attached: false, started: false,
      // Seed from the persisted exit marker so a session that ended before app
      // close doesn't silently respawn when the user opens it after restart.
      exited: !!wasExited,
      dirty: false, persistTimer: null,
    };
    terminalCache.set(sessionId, entry);
    freshEntry = true;
  }
  if (!entry.started) {
    // Replace any stale listeners from a prior incarnation before re-registering.
    try { entry.ptyOffData?.(); } catch (_) {}
    try { entry.ptyOffExit?.(); } catch (_) {}

    // Restore previously-saved scrollback FIRST, before attaching the live
    // data listener — otherwise live pty output (from a session that already
    // exists for this id) can land in the term before the saved replay,
    // visually scrambling the result.
    if (freshEntry) {
      try {
        const saved = await station.loadBuffer(sessionId);
        if (saved) entry.term.write(saved);
      } catch (_) { /* ignore */ }
    }

    entry.ptyOffData = station.onPtyData(({ id, data }) => {
      if (id !== sessionId) return;
      entry.term.write(data);
      entry.dirty = true;
    });
    entry.ptyOffExit = station.onPtyExit(({ id }) => {
      if (id !== sessionId) return;
      entry.term.writeln('\r\n\x1b[2m[session ended]\x1b[0m');
      entry.exited = true;
      entry.dirty = true;
      // Capture final state immediately so the user's last view survives even
      // if the periodic save hasn't fired yet.
      persistEntry(sessionId, entry);
      // Stop the periodic timer — there will be no more dirty data until the
      // user explicitly restarts. Restart re-installs it.
      if (entry.persistTimer) {
        clearInterval(entry.persistTimer);
        entry.persistTimer = null;
      }
    });

    const exists = await station.ptyExists(sessionId);
    // Don't auto-respawn an exited session; the user clicks Restart from the
    // banner inside the terminal pane to bring it back. Without this guard,
    // navigating away and back would silently spawn a fresh claude.
    if (!exists && !entry.exited) {
      if (isPM) {
        await station.createPmPty({ id: sessionId, cwd, maskSecrets });
      } else {
        await station.createPty({ id: sessionId, cwd, runClaude: true, maskSecrets, agentTool });
      }
    }
    entry.started = true;

    if (!entry.persistTimer) {
      entry.persistTimer = setInterval(() => persistEntry(sessionId, entry), PERSIST_INTERVAL_MS);
    }
  }
  return entry;
}

async function restartSession(entry, session) {
  const maskSecrets = session.maskSecrets !== false;
  const agentTool = session.agentTool || 'claude';
  if (session.isPM) {
    await station.createPmPty({ id: session.id, cwd: session.cwd, maskSecrets });
  } else {
    await station.createPty({ id: session.id, cwd: session.cwd, runClaude: true, maskSecrets, agentTool });
  }
  entry.exited = false;
  if (!entry.persistTimer) {
    entry.persistTimer = setInterval(() => persistEntry(session.id, entry), PERSIST_INTERVAL_MS);
  }
}

export default function TerminalPane({ session }) {
  const containerRef = useRef(null);
  const entryRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [exited, setExited] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [dropping, setDropping] = useState(false);
  // dragenter/leave fire on every child crossing — track depth so the overlay
  // doesn't flicker as the user drags over the inner xterm DOM.
  const dragDepth = useRef(0);
  const searchInputRef = useRef(null);

  const handleDragOver = useCallback((e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'copy'; } catch (_) {}
  }, []);

  const handleDragEnter = useCallback((e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDropping(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    if (!isFileDrag(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDropping(false);
  }, []);

  const handleDrop = useCallback((e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDropping(false);
    const paths = pathsFromDropEvent(e);
    if (paths.length && session?.id) {
      insertPathsIntoSession(session.id, paths);
      try { entryRef.current?.term?.focus(); } catch (_) {}
    }
  }, [session?.id]);

  // Mount xterm into the DOM whenever the active session changes.
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    let dataDispose = null;
    let resizeObserver = null;
    let resizeDebounceTimer = null;

    (async () => {
      const entry = await ensureSession(session.id, session.cwd, session.isPM, !!session.exitedAt, session.maskSecrets !== false, session.agentTool || 'claude');
      if (cancelled) return;
      entryRef.current = entry;
      setExited(!!entry.exited);

      // Mount xterm's DOM in the current container.
      //
      // CAREFUL: @xterm/xterm v6's Terminal.open() early-returns when
      // `this.element` already exists — so calling open() on a second mount
      // is a no-op and does NOT re-parent the element. (This differed in
      // xterm v5, where open() handled re-attach, which is why the original
      // detach+open dance worked then.) On subsequent mounts we manually
      // append the existing element to the new container; only the very
      // first mount calls open() to let xterm build its DOM tree.
      if (containerRef.current && entry.term.element?.parentNode !== containerRef.current) {
        if (entry.term.element) {
          // Already-opened term — move its element into the new container.
          containerRef.current.appendChild(entry.term.element);
        } else {
          // First open in this entry's lifetime — xterm creates + attaches.
          entry.term.open(containerRef.current);
        }
      }

      // WebGL renderer must be attached AFTER term.open(). Once attached, it
      // survives detach/re-attach into different containers, so we only do this
      // on first mount. On context loss (GPU eviction, tab backgrounded), the
      // helper re-attaches itself so the user doesn't have to switch sessions
      // to recover the GPU renderer.
      if (!entry.webglAttached) attachWebgl(entry);

      // Sync user keystrokes -> pty (re-bind on each mount in case onData was disposed)
      if (entry.dataDispose) entry.dataDispose.dispose();
      entry.dataDispose = entry.term.onData((data) => {
        station.writePty(session.id, data);
      });
      dataDispose = entry.dataDispose;

      // Fit visually in real-time, but debounce the actual SIGWINCH to the pty.
      // Resizing the window otherwise fires resizePty on every animation frame
      // and Claude Code does a full TUI re-render on each one — visible flicker
      // and wasted CPU during a drag.
      const doFit = () => {
        try {
          entry.fit.fit();
          if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
          const cols = entry.term.cols;
          const rows = entry.term.rows;
          resizeDebounceTimer = setTimeout(() => {
            try { station.resizePty(session.id, cols, rows); } catch (_) {}
          }, 120);
        } catch (_) {}
      };
      requestAnimationFrame(doFit);

      // Watch container size
      if (containerRef.current && 'ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(() => doFit());
        resizeObserver.observe(containerRef.current);
      }

      window.addEventListener('resize', doFit);
      entry.term.focus();
    })();

    return () => {
      cancelled = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
      // We intentionally do NOT dispose the term — keep it cached so output keeps streaming.
      if (dataDispose) dataDispose.dispose();
      const entry = entryRef.current;
      // Drop any lingering search highlights on the outgoing session before we
      // detach — they otherwise persist and blink at you on the next session.
      try { entry?.search?.clearDecorations(); } catch (_) {}
      setSearchOpen(false);
      setSearchQuery('');
      if (entry && entry.term?.element?.parentNode) {
        // Detach the DOM element so the next mount can re-open into a fresh container
        entry.term.element.parentNode.removeChild(entry.term.element);
      }
    };
  }, [session?.id, session?.cwd]);

  // Live exit notification for the active session — flips local state so the
  // restart banner appears even when ensureSession's per-entry listener has
  // already fired and updated entry.exited.
  useEffect(() => {
    if (!session) return undefined;
    const off = station.onPtyExit(({ id }) => {
      if (id === session.id) setExited(true);
    });
    return off;
  }, [session?.id]);

  // Cmd+F → open the in-terminal search bar. Capture phase so we win against
  // xterm's helper textarea, which would otherwise swallow the keystroke.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopPropagation();
        setSearchOpen(true);
      }
    };
    const node = containerRef.current;
    if (!node) return undefined;
    node.addEventListener('keydown', onKey, true);
    return () => node.removeEventListener('keydown', onKey, true);
  }, [session?.id]);

  // Focus the search input when the bar opens.
  useEffect(() => {
    if (!searchOpen) return;
    const id = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [searchOpen]);

  const runSearch = (direction) => {
    const search = entryRef.current?.search;
    if (!search || !searchQuery) return;
    const opts = { decorations: SEARCH_DECORATIONS, caseSensitive: false };
    if (direction === 'prev') search.findPrevious(searchQuery, opts);
    else search.findNext(searchQuery, opts);
  };

  const closeSearch = () => {
    try { entryRef.current?.search?.clearDecorations(); } catch (_) {}
    setSearchOpen(false);
    setSearchQuery('');
    entryRef.current?.term?.focus();
  };

  const handleRestart = async () => {
    if (!session || !entryRef.current || restarting) return;
    setRestarting(true);
    try {
      await restartSession(entryRef.current, session);
      setExited(false);
      entryRef.current.term?.focus();
    } catch (e) {
      console.warn('[terminal] restart failed:', e?.message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div
      className="terminal-pane"
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropping && (
        <div className="terminal-drop-overlay" aria-hidden>
          <div className="terminal-drop-hint">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 3v5h5" />
              <path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9z" />
              <path d="M12 11v7m0-7-3 3m3-3 3 3" />
            </svg>
            Drop to insert path
          </div>
        </div>
      )}
      {exited && (
        <div className="terminal-exit-banner">
          <span className="terminal-exit-banner-label">Session ended</span>
          <button
            className="terminal-exit-banner-btn"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? 'Restarting…' : 'Restart'}
          </button>
        </div>
      )}
      {searchOpen && (
        <div className="terminal-search" role="search">
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                runSearch(e.shiftKey ? 'prev' : 'next');
              }
            }}
            placeholder="Find in terminal…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button className="terminal-search-btn" onClick={() => runSearch('prev')} title="Previous match (Shift+Enter)">↑</button>
          <button className="terminal-search-btn" onClick={() => runSearch('next')} title="Next match (Enter)">↓</button>
          <button className="terminal-search-btn" onClick={closeSearch} title="Close (Esc)">✕</button>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// Allow the App to dispose terminals when killing a session
export function disposeTerminal(sessionId) {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  try { if (entry.persistTimer) clearInterval(entry.persistTimer); } catch (_) {}
  try { entry.ptyOffData && entry.ptyOffData(); } catch (_) {}
  try { entry.ptyOffExit && entry.ptyOffExit(); } catch (_) {}
  try { entry.term && entry.term.dispose(); } catch (_) {}
  terminalCache.delete(sessionId);
}

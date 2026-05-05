import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import SessionView from './components/SessionView.jsx';
import MissionControl from './components/MissionControl.jsx';
import SpawnModal from './components/SpawnModal.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import Schedules from './components/Schedules.jsx';
import OnboardingTour from './components/OnboardingTour.jsx';
import HelpGuide from './components/HelpGuide.jsx';
import PhonePairing from './components/PhonePairing.jsx';
import { disposeTerminal } from './components/Terminal.jsx';

const ONBOARDED_KEY = 'anthology-onboarded-v1';

const station = window.station;

function uid() {
  return 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('cs-theme') || 'dark';
  });
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [view, setView] = useState('mission'); // 'mission' | 'session'
  const [query, setQuery] = useState('');
  const [showSpawn, setShowSpawn] = useState(false);
  const [showCmdK, setShowCmdK] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  const [phoneClientCount, setPhoneClientCount] = useState(0);
  const [showTour, setShowTour] = useState(() => {
    try { return !localStorage.getItem(ONBOARDED_KEY); } catch (_) { return false; }
  });
  const [toast, setToast] = useState(null);
  const [statuses, setStatuses] = useState({}); // id -> 'running' | 'idle' | 'waiting' | 'error'
  const [unread, setUnread] = useState({}); // id -> count
  const [lastActivity, setLastActivity] = useState({}); // id -> ts ms

  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cs-theme', theme);
  }, [theme]);

  // Initial load
  useEffect(() => {
    (async () => {
      const stored = await station.listSessions();
      setSessions(stored);
      const initialStatus = {};
      const initialActivity = {};
      for (const s of stored) {
        // Honor a persisted exit so an app restart doesn't silently respawn
        // a session the user explicitly ended; the Restart banner will be
        // shown when the user opens it.
        initialStatus[s.id] = s.exitedAt ? 'exited' : 'idle';
        initialActivity[s.id] = s.exitedAt || Date.now();
      }
      setStatuses(initialStatus);
      setLastActivity(initialActivity);
    })();
  }, []);

  // Toast
  const fireToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }, []);

  // Pty status events
  useEffect(() => {
    const offStatus = station.onPtyStatus(({ id, status }) => {
      setStatuses((prev) => {
        const prior = prev[id];
        if (prior === status) return prev;
        // Coming back to life from 'exited' — clear the persisted exit marker
        // so a subsequent app restart treats this session as live, not ended.
        if (prior === 'exited' && status !== 'exited') {
          const session = sessionsRef.current.find((s) => s.id === id);
          if (session?.exitedAt) {
            // upsert merges, so set null explicitly to overwrite the marker.
            try { station.saveSession({ ...session, exitedAt: null }); } catch (_) {}
          }
        }
        // Background notification when a non-active session needs attention
        if (id !== activeIdRef.current && (status === 'waiting' || status === 'error')) {
          const session = sessionsRef.current.find((s) => s.id === id);
          if (session) {
            const title = status === 'waiting' ? `${session.name} needs you` : `${session.name} hit an error`;
            const body = status === 'waiting'
              ? 'Claude is waiting on a permission decision.'
              : 'A tool call failed — open the session to investigate.';
            station.notify(title, body, false);
          }
        }
        return { ...prev, [id]: status };
      });
    });
    // Per-byte App-level state updates would re-render the whole tree on every
    // chunk; under heavy claude output that's tens of thousands of renders/sec.
    // Coalesce into a 400 ms tick: count chunks per id in a ref, flush in one
    // batched setState. Active session is skipped from unread accounting.
    const pendingActivity = new Map(); // id -> latest timestamp
    const pendingUnread = new Map();   // id -> chunk count
    let flushTimer = null;
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (pendingActivity.size) {
          const update = Object.fromEntries(pendingActivity);
          pendingActivity.clear();
          setLastActivity((prev) => ({ ...prev, ...update }));
        }
        if (pendingUnread.size) {
          const updates = Array.from(pendingUnread.entries());
          pendingUnread.clear();
          setUnread((prev) => {
            const next = { ...prev };
            for (const [id, n] of updates) next[id] = (next[id] || 0) + n;
            return next;
          });
        }
      }, 400);
    };
    const offData = station.onPtyData(({ id }) => {
      pendingActivity.set(id, Date.now());
      if (id !== activeIdRef.current) {
        pendingUnread.set(id, (pendingUnread.get(id) || 0) + 1);
      }
      scheduleFlush();
    });
    const offExit = station.onPtyExit(({ id }) => {
      // PTY exit (/exit, crash, manual kill) — mark the session as ended but
      // keep it in the UI so the user can hit Restart inside the terminal pane,
      // or kill it explicitly from the session header to remove it for good.
      const session = sessionsRef.current.find((s) => s.id === id);
      if (session) {
        station.notify(`${session.name} ended`, 'Claude exited — restart from the terminal or kill to remove.', true);
        // Persist the exited timestamp so an app restart doesn't silently
        // auto-respawn this session — Terminal's ensureSession honors it.
        try { station.saveSession({ ...session, exitedAt: Date.now() }); } catch (_) {}
      }
      setStatuses((prev) => ({ ...prev, [id]: 'exited' }));
      // Clear unread for the now-ended session so it doesn't keep nagging the
      // dock badge. lastActivity is left alone — it's a real timestamp.
      setUnread((prev) => {
        if (!prev[id]) return prev;
        return { ...prev, [id]: 0 };
      });
    });
    const offCreated = station.onSessionCreated((session) => {
      setSessions((prev) => {
        if (prev.some((s) => s.id === session.id)) return prev;
        return [...prev, session];
      });
      setStatuses((prev) => ({ ...prev, [session.id]: 'running' }));
      setLastActivity((prev) => ({ ...prev, [session.id]: Date.now() }));
      // The PM is the active session — surface a small toast so the user can see
      // that the PM created a worker session.
      fireToast(`PM spawned “${session.name}”`);
    });
    const offKilled = station.onSessionKilled(({ id }) => {
      // Mirror handleKill cleanup so MCP-driven kills (PM calling
      // station_kill_session) don't leak the cached terminal or buffer file.
      try { disposeTerminal(id); } catch (_) {}
      try { station.removeBuffer(id); } catch (_) {}
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setStatuses((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
      setUnread((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
      setLastActivity((prev) => { const { [id]: _drop, ...rest } = prev; return rest; });
    });
    return () => {
      offStatus(); offData(); offExit(); offCreated(); offKilled();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [fireToast]);

  // Clear unread when switching to a session
  useEffect(() => {
    if (activeId) setUnread((prev) => ({ ...prev, [activeId]: 0 }));
  }, [activeId, view]);

  // Dock badge: waiting sessions + total unread elsewhere
  useEffect(() => {
    const waitingCount = Object.values(statuses).filter((s) => s === 'waiting' || s === 'error').length;
    const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0);
    station.setBadgeCount(waitingCount + (unreadTotal > 0 ? 1 : 0));
  }, [statuses, unread]);

  // Bridge connected-clients count (for the topbar phone icon)
  useEffect(() => {
    if (!station.bridgeInfo || !station.onBridgeClients) return;
    let off = null;
    (async () => {
      try {
        const info = await station.bridgeInfo();
        if (info && typeof info.clientCount === 'number') setPhoneClientCount(info.clientCount);
      } catch (_) {}
    })();
    off = station.onBridgeClients(({ count }) => setPhoneClientCount(count));
    return () => { try { off && off(); } catch (_) {} };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = document.activeElement?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.classList?.contains('xterm-helper-textarea');

      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowCmdK(v => !v); return; }
      if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); setShowSpawn(true); return; }
      if (meta && e.key === '\\') { e.preventDefault(); setView(v => v === 'session' ? 'mission' : 'session'); return; }
      if (e.key === 'Escape') { setShowSpawn(false); setShowCmdK(false); return; }

      // Cmd+1..9 jumps to session N (works even while terminal is focused)
      if (meta && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (sessions[idx]) {
          e.preventDefault();
          setActiveId(sessions[idx].id);
          setView('session');
        }
        return;
      }

      // Bare 1..9 only when not typing
      if (!meta && !e.altKey && /^[1-9]$/.test(e.key) && !isTyping) {
        const idx = parseInt(e.key, 10) - 1;
        if (sessions[idx]) {
          e.preventDefault();
          setActiveId(sessions[idx].id);
          setView('session');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessions]);

  const handleSelect = (id) => {
    setActiveId(id);
    setView('session');
  };

  const handleSpawn = async ({ name, cwd, color, tag, pm }) => {
    const id = uid();
    const session = {
      id,
      name: name || (pm ? 'project manager' : 'session'),
      cwd,
      color: pm ? '#7B2FBE' : color,
      tag: pm ? 'pm' : tag,
      pinned: !!pm,
      isPM: !!pm,
      createdAt: Date.now(),
    };
    setSessions((prev) => [...prev, session]);
    setStatuses((prev) => ({ ...prev, [id]: 'running' }));
    setLastActivity((prev) => ({ ...prev, [id]: Date.now() }));
    await station.saveSession(session);
    setShowSpawn(false);
    setActiveId(id);
    setView('session');
    fireToast(pm ? `Project Manager “${session.name}” online` : `Spawned “${session.name}” · session ready`);
  };

  const handleKill = async (id) => {
    await station.killPty(id);
    await station.deleteSession(id);
    try { await station.removeBuffer(id); } catch (_) {}
    try { disposeTerminal(id); } catch (_) {}
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setStatuses((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
    if (activeId === id) {
      setActiveId(null);
      setView('mission');
    }
    fireToast('Session killed');
  };

  const handlePin = async (id) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, pinned: !s.pinned } : s);
      const target = next.find((s) => s.id === id);
      if (target) station.saveSession(target);
      return next;
    });
  };

  const closeTour = useCallback(() => {
    setShowTour(false);
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (_) {}
  }, []);

  const handleRename = async (id, name) => {
    setSessions((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, name } : s);
      const target = next.find((s) => s.id === id);
      if (target) station.saveSession(target);
      return next;
    });
  };

  const active = sessions.find((s) => s.id === activeId) || null;

  return (
    <div className="app-shell">
      <div className="titlebar">ANTHOLOGY</div>

      <Sidebar
        sessions={sessions}
        statuses={statuses}
        unread={unread}
        activeId={activeId}
        onSelect={handleSelect}
        onSpawn={() => setShowSpawn(true)}
        onPin={handlePin}
        onKill={handleKill}
        view={view}
        setView={setView}
        query={query}
        setQuery={setQuery}
        theme={theme}
      />

      <div className="main">
        <TopBar
          view={view}
          setView={setView}
          theme={theme}
          toggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          sessions={sessions}
          statuses={statuses}
          openCmdK={() => setShowCmdK(true)}
          openHelp={() => setShowHelp(true)}
          openPhone={() => setShowPhone(true)}
          phoneClientCount={phoneClientCount}
        />

        {view === 'session' && active ? (
          <SessionView
            session={active}
            status={statuses[active.id] || 'idle'}
            lastActivity={lastActivity[active.id]}
            onKill={handleKill}
            onPin={handlePin}
            onRename={handleRename}
          />
        ) : view === 'schedules' ? (
          <Schedules onJump={handleSelect} />
        ) : (
          <MissionControl
            sessions={sessions}
            statuses={statuses}
            lastActivity={lastActivity}
            onSelect={handleSelect}
            onSpawn={() => setShowSpawn(true)}
          />
        )}
      </div>

      {showSpawn && (
        <SpawnModal
          onClose={() => setShowSpawn(false)}
          onSpawn={handleSpawn}
        />
      )}

      {showCmdK && (
        <CommandPalette
          sessions={sessions}
          statuses={statuses}
          onSelect={(id) => { setShowCmdK(false); handleSelect(id); }}
          onClose={() => setShowCmdK(false)}
        />
      )}

      {showHelp && (
        <HelpGuide
          onClose={() => setShowHelp(false)}
          onReplayTour={() => setShowTour(true)}
        />
      )}

      {showPhone && (
        <PhonePairing onClose={() => setShowPhone(false)} />
      )}

      {showTour && <OnboardingTour onClose={closeTour} />}

      {toast && <div className="toast"><span className="dot" />{toast}</div>}
    </div>
  );
}

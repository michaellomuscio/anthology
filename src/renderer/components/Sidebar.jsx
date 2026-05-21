import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import beeMark from '../assets/bee-mark.svg';
import AboutModal from './AboutModal.jsx';

const COLLAPSE_PREFIX = 'cs-group-collapsed-';
const PINNED_KEY = COLLAPSE_PREFIX + '_pinned';
const UNGROUPED_KEY = COLLAPSE_PREFIX + '_ungrouped';
const DRAG_MIME = 'application/x-anthology-session';

function readCollapsed(key) {
  try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
}
function writeCollapsed(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch (_) {}
}

function SearchIcon() {
  return (
    <svg className="sidebar-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="pin" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L9 8l-6 1 4.5 4.4L6 20l6-3 6 3-1.5-6.6L21 9l-6-1z" />
    </svg>
  );
}

function PlusIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChevronIcon({ collapsed }) {
  return (
    <svg
      className="group-chevron"
      width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
      style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function repoLabel(cwd) {
  if (!cwd) return '';
  const parts = cwd.split('/').filter(Boolean);
  return parts.slice(-1)[0] || cwd;
}

function SessionRow({ session, status, unread, index, active, onClick, onDragStart, onDragEnd }) {
  return (
    <div
      className={`session-row ${active ? 'active' : ''}`}
      onClick={onClick}
      draggable
      onDragStart={(e) => onDragStart(e, session.id)}
      onDragEnd={onDragEnd}
    >
      <div className="session-color-bar" style={{ background: session.color }} />
      <div className="session-row-body">
        <div className="session-row-top">
          <div className={`status-dot ${status}`} />
          <span className="name">{session.name}</span>
          {session.isPM && <span className="pm-badge">PM</span>}
          {session.pinned && <PinIcon />}
        </div>
        <div className="session-row-meta">
          <span className="repo">{repoLabel(session.cwd)}</span>
          {session.tag && <span className="branch">{session.tag}</span>}
        </div>
      </div>
      <div className="session-row-right">
        {index <= 9 && <div className="key-hint">{index}</div>}
        {unread > 0 && <div className="unread-pill">{unread > 99 ? '99+' : unread}</div>}
      </div>
    </div>
  );
}

function GroupHeader({
  label, count, collapsed, onToggle,
  editable = false, onRename, onDelete,
  forceExpanded = false,
  isRenaming = false, draftName = '', setDraftName, commitRename, cancelRename,
}) {
  const showCollapsed = collapsed && !forceExpanded;
  return (
    <div className="group-header" onClick={isRenaming ? undefined : onToggle} role="button">
      <ChevronIcon collapsed={showCollapsed} />
      {isRenaming ? (
        <input
          autoFocus
          className="group-name-input"
          value={draftName}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
          }}
          onBlur={commitRename}
        />
      ) : (
        <span className="group-name">{label}</span>
      )}
      <span className="count">{count}</span>
      {editable && !isRenaming && (
        <div className="group-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="group-action" title="Rename group" onClick={onRename}>
            <PencilIcon />
          </button>
          <button type="button" className="group-action" title="Delete group" onClick={onDelete}>
            <TrashIcon />
          </button>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  sessions, statuses, unread, activeId, onSelect, onSpawn,
  view, setView, query, setQuery, theme,
  groups, onCreateGroup, onRenameGroup, onDeleteGroup, onMoveSession,
}) {
  const [showAbout, setShowAbout] = useState(false);

  // Per-section collapse state. Persisted via localStorage so it survives reloads.
  const [collapsed, setCollapsed] = useState(() => {
    const init = { _pinned: readCollapsed(PINNED_KEY), _ungrouped: readCollapsed(UNGROUPED_KEY) };
    for (const g of groups || []) init[g.id] = readCollapsed(COLLAPSE_PREFIX + g.id);
    return init;
  });
  // Ensure newly-created groups get an entry too.
  useEffect(() => {
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const g of groups || []) {
        if (!(g.id in next)) {
          next[g.id] = readCollapsed(COLLAPSE_PREFIX + g.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groups]);

  const toggleCollapse = useCallback((key, storageKey) => {
    setCollapsed((prev) => {
      const v = !prev[key];
      writeCollapsed(storageKey, v);
      return { ...prev, [key]: v };
    });
  }, []);

  // Inline rename state — at most one group is being renamed at a time.
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');

  // New-group inline composer.
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupDraft, setNewGroupDraft] = useState('');
  const newGroupInputRef = useRef(null);
  useEffect(() => {
    if (creatingGroup) { try { newGroupInputRef.current?.focus(); } catch (_) {} }
  }, [creatingGroup]);

  // Drag state — id of the session currently being dragged + currently-hovered drop target.
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null); // group id, '_ungrouped', or null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.cwd || '').toLowerCase().includes(q) ||
      (s.tag || '').toLowerCase().includes(q)
    );
  }, [sessions, query]);

  // While a query is active, force every section open so matches aren't hidden.
  const forceExpanded = !!query.trim();

  const groupIds = useMemo(() => new Set((groups || []).map((g) => g.id)), [groups]);

  // Bucket non-pinned sessions by group. Pinned sessions render exclusively in
  // their own section (matches the prior behavior); their groupId stays intact
  // so unpinning later restores them to the right group. A session whose
  // groupId points at a deleted group falls through to '_ungrouped'.
  const buckets = useMemo(() => {
    const map = new Map();
    map.set('_ungrouped', []);
    for (const g of groups || []) map.set(g.id, []);
    for (const s of filtered) {
      if (s.pinned) continue;
      const key = s.groupId && groupIds.has(s.groupId) ? s.groupId : '_ungrouped';
      map.get(key).push(s);
    }
    return map;
  }, [filtered, groups, groupIds]);

  const pinned = filtered.filter((s) => s.pinned);
  const activeCount = sessions.filter((s) => statuses[s.id] === 'running' || statuses[s.id] === 'waiting').length;

  // Stable per-session sidebar index (1..N) used for the keyboard hint badge.
  const indexOf = useCallback((id) => sessions.findIndex((s) => s.id === id) + 1, [sessions]);

  // -------------------- Drag handlers --------------------
  const handleDragStart = useCallback((e, id) => {
    try {
      e.dataTransfer.setData(DRAG_MIME, id);
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
    } catch (_) {}
    setDraggingId(id);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverTarget(null);
  }, []);

  const handleDropTargetEnter = useCallback((targetKey) => (e) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetKey);
  }, [draggingId]);

  const handleDrop = useCallback((targetKey) => (e) => {
    e.preventDefault();
    let id = '';
    try { id = e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain') || ''; } catch (_) {}
    id = id || draggingId || '';
    setDraggingId(null);
    setDragOverTarget(null);
    if (!id) return;
    const targetGroupId = targetKey === '_ungrouped' ? null : targetKey;
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const currentGroupId = session.groupId || null;
    if (currentGroupId === targetGroupId) return;
    onMoveSession?.(id, targetGroupId);
  }, [sessions, draggingId, onMoveSession]);

  // -------------------- Group CRUD --------------------
  const startRename = (group) => {
    setRenamingId(group.id);
    setRenameDraft(group.name || '');
  };
  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const next = renameDraft.trim();
    if (next) onRenameGroup?.(renamingId, next);
    setRenamingId(null);
    setRenameDraft('');
  }, [renamingId, renameDraft, onRenameGroup]);
  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft('');
  }, []);

  const requestDelete = (group) => {
    const count = (buckets.get(group.id) || []).length;
    const msg = count > 0
      ? `Delete group "${group.name}"? Its ${count} session${count === 1 ? '' : 's'} will move to Ungrouped.`
      : `Delete group "${group.name}"?`;
    if (window.confirm(msg)) onDeleteGroup?.(group.id);
  };

  const startCreateGroup = () => {
    setCreatingGroup(true);
    setNewGroupDraft('');
  };
  const commitCreateGroup = () => {
    const name = newGroupDraft.trim();
    if (name) onCreateGroup?.(name);
    setCreatingGroup(false);
    setNewGroupDraft('');
  };
  const cancelCreateGroup = () => {
    setCreatingGroup(false);
    setNewGroupDraft('');
  };

  // -------------------- Render helpers --------------------
  const renderSessionList = (list) => list.map((s) => (
    <SessionRow
      key={s.id}
      session={s}
      status={statuses[s.id] || 'idle'}
      unread={unread[s.id] || 0}
      index={indexOf(s.id)}
      active={s.id === activeId}
      onClick={() => onSelect(s.id)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    />
  ));

  const renderDropZone = (targetKey, list, isCollapsed) => {
    const isOver = dragOverTarget === targetKey;
    const showBody = !isCollapsed || forceExpanded;
    return (
      <div
        className={`group-body ${isOver ? 'drag-over' : ''} ${showBody ? '' : 'collapsed'}`}
        onDragOver={handleDropTargetEnter(targetKey)}
        onDragEnter={handleDropTargetEnter(targetKey)}
        onDragLeave={(e) => {
          // Only clear if leaving for an element outside this drop zone.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (dragOverTarget === targetKey) setDragOverTarget(null);
        }}
        onDrop={handleDrop(targetKey)}
      >
        {showBody && list.length === 0 && (
          <div className="group-empty">
            {draggingId ? 'Drop here' : 'No sessions'}
          </div>
        )}
        {showBody && renderSessionList(list)}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button
          type="button"
          className="sidebar-logo"
          title="About Anthology"
          onClick={() => setShowAbout(true)}
        >
          <img src={beeMark} alt="Anthology" draggable={false} />
        </button>
        <div>
          <div className="sidebar-title">ANTHOLOGY</div>
          <div className="sidebar-subtitle">{sessions.length} sessions · {activeCount} active</div>
        </div>
      </div>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      <div className="sidebar-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="Search sessions, repos, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="sidebar-tabs">
        <button className={`sidebar-tab ${view === 'session' ? 'active' : ''}`} onClick={() => setView('session')}>Sessions</button>
        <button className={`sidebar-tab ${view === 'mission' ? 'active' : ''}`} onClick={() => setView('mission')}>Mission Control</button>
      </div>

      <div className="sidebar-list" data-tour="sidebar-list">
        {pinned.length > 0 && (
          <>
            <GroupHeader
              label="Pinned"
              count={pinned.length}
              collapsed={collapsed._pinned}
              forceExpanded={forceExpanded}
              onToggle={() => toggleCollapse('_pinned', PINNED_KEY)}
            />
            {(forceExpanded || !collapsed._pinned) && renderSessionList(pinned)}
          </>
        )}

        {/* New-group composer */}
        <div className="group-composer-row">
          {creatingGroup ? (
            <div className="group-composer">
              <input
                ref={newGroupInputRef}
                className="group-name-input"
                placeholder="Group name…"
                value={newGroupDraft}
                onChange={(e) => setNewGroupDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCreateGroup(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelCreateGroup(); }
                }}
                onBlur={commitCreateGroup}
              />
            </div>
          ) : (
            <button type="button" className="group-new-btn" onClick={startCreateGroup}>
              <PlusIcon size={11} />
              New group
            </button>
          )}
        </div>

        {/* User groups */}
        {(groups || []).map((g) => {
          const list = buckets.get(g.id) || [];
          const isCollapsed = !!collapsed[g.id];
          return (
            <div key={g.id} className="group-section">
              <GroupHeader
                label={g.name}
                count={list.length}
                editable
                collapsed={isCollapsed}
                forceExpanded={forceExpanded}
                onToggle={() => toggleCollapse(g.id, COLLAPSE_PREFIX + g.id)}
                onRename={() => startRename(g)}
                onDelete={() => requestDelete(g)}
                isRenaming={renamingId === g.id}
                draftName={renameDraft}
                setDraftName={setRenameDraft}
                commitRename={commitRename}
                cancelRename={cancelRename}
              />
              {renderDropZone(g.id, list, isCollapsed)}
            </div>
          );
        })}

        {/* Ungrouped — always visible so there's a drop target even with zero groups */}
        <div className="group-section">
          <GroupHeader
            label="Ungrouped"
            count={(buckets.get('_ungrouped') || []).length}
            collapsed={collapsed._ungrouped}
            forceExpanded={forceExpanded}
            onToggle={() => toggleCollapse('_ungrouped', UNGROUPED_KEY)}
          />
          {renderDropZone('_ungrouped', buckets.get('_ungrouped') || [], collapsed._ungrouped)}
        </div>

        {sessions.length === 0 && (
          <div style={{ padding: '20px 12px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--app-fg-2)', lineHeight: 1.5 }}>
            No sessions yet. Hit <strong>⌘N</strong> to spawn your first Claude Code session.
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="btn btn-primary" onClick={onSpawn} data-tour="sidebar-spawn">
          <PlusIcon />
          New session<span className="kbd">⌘N</span>
        </button>
      </div>
    </aside>
  );
}

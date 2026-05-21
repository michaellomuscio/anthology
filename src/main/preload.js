'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('station', {
  // Sessions store
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (session) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  listRecentDirs: () => ipcRenderer.invoke('sessions:recentDirs'),

  // Groups (sidebar folders)
  listGroups: () => ipcRenderer.invoke('groups:list'),
  saveGroup: (group) => ipcRenderer.invoke('groups:upsert', group),
  deleteGroup: (id) => ipcRenderer.invoke('groups:delete', id),
  reorderGroups: (ids) => ipcRenderer.invoke('groups:reorder', ids),

  // PTY
  createPty: (opts) => ipcRenderer.invoke('pty:create', opts),
  createPmPty: (opts) => ipcRenderer.invoke('pty:create-pm', opts),
  writePty: (id, data) => ipcRenderer.invoke('pty:write', { id, data }),
  resizePty: (id, cols, rows) => ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  killPty: (id) => ipcRenderer.invoke('pty:kill', id),
  ptyExists: (id) => ipcRenderer.invoke('pty:exists', id),
  setMaskSecrets: (id, enabled) => ipcRenderer.invoke('pty:set-mask-secrets', { id, enabled }),
  getMaskState: (id) => ipcRenderer.invoke('pty:get-mask-state', id),
  submitPrompt: (id, text) => ipcRenderer.invoke('pty:submit-prompt', { id, text }),
  mcpInfo: () => ipcRenderer.invoke('mcp:info'),

  // Per-session scrollback persistence
  saveBuffer: (id, content) => ipcRenderer.invoke('buffer:save', { id, content }),
  loadBuffer: (id) => ipcRenderer.invoke('buffer:load', id),
  removeBuffer: (id) => ipcRenderer.invoke('buffer:remove', id),

  // Quit-time flush coordination — main asks the renderer to serialize all
  // live xterm state before tear-down so we don't lose the last <10 s of
  // scrollback that the periodic timer hasn't picked up yet.
  onFlushRequest: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('app:flush', listener);
    return () => ipcRenderer.removeListener('app:flush', listener);
  },
  ackFlush: () => ipcRenderer.send('app:flush:done'),

  // PTY events
  onPtyData: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:data', listener);
    return () => ipcRenderer.removeListener('pty:data', listener);
  },
  onPtyExit: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:exit', listener);
    return () => ipcRenderer.removeListener('pty:exit', listener);
  },
  onPtyStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:status', listener);
    return () => ipcRenderer.removeListener('pty:status', listener);
  },
  onPtyRedaction: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:redaction', listener);
    return () => ipcRenderer.removeListener('pty:redaction', listener);
  },
  onMaskState: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('pty:mask-state', listener);
    return () => ipcRenderer.removeListener('pty:mask-state', listener);
  },
  onSessionCreated: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('session:created', listener);
    return () => ipcRenderer.removeListener('session:created', listener);
  },
  onSessionKilled: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('session:killed', listener);
    return () => ipcRenderer.removeListener('session:killed', listener);
  },

  // Dialogs / app info
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  // Resolve a File (from drag-and-drop or <input type=file>) to its absolute
  // filesystem path. webUtils.getPathForFile is the supported replacement for
  // the deprecated File.path; fall back if running on an older Electron.
  getPathForFile: (file) => {
    try {
      if (webUtils?.getPathForFile) return webUtils.getPathForFile(file) || '';
    } catch (_) {}
    return (file && file.path) || '';
  },
  getHome: () => ipcRenderer.invoke('app:home'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),

  // Notifications + dock badge
  notify: (title, body, silent) => ipcRenderer.invoke('notify:show', { title, body, silent }),
  setBadgeCount: (count) => ipcRenderer.invoke('badge:set', count),

  // Schedules
  listSchedules: () => ipcRenderer.invoke('schedules:list'),
  upsertSchedule: (s) => ipcRenderer.invoke('schedules:upsert', s),
  deleteSchedule: (id) => ipcRenderer.invoke('schedules:delete', id),
  runScheduleNow: (id) => ipcRenderer.invoke('schedules:runNow', id),
  onScheduleFired: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('schedule:fired', listener);
    return () => ipcRenderer.removeListener('schedule:fired', listener);
  },

  // Bridge (phone companion)
  bridgeInfo: () => ipcRenderer.invoke('bridge:info'),
  bridgeNetworkInfo: () => ipcRenderer.invoke('bridge:network-info'),
  bridgePairStart: (opts) => ipcRenderer.invoke('bridge:pair-start', opts || {}),
  bridgePairCancel: () => ipcRenderer.invoke('bridge:pair-cancel'),
  bridgeTokensList: () => ipcRenderer.invoke('bridge:tokens-list'),
  bridgeTokenRevoke: (tokenId) => ipcRenderer.invoke('bridge:token-revoke', tokenId),
  bridgePushConfig: () => ipcRenderer.invoke('bridge:push-config'),
  bridgePushConfigSet: (payload) => ipcRenderer.invoke('bridge:push-config-set', payload),
  onBridgeClients: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('bridge:clients', listener);
    return () => ipcRenderer.removeListener('bridge:clients', listener);
  },

  // Cloudflare Tunnel — public URL for the bridge so iOS can connect through
  // any firewall. Quick-tunnel v1: URL is ephemeral (changes per restart).
  tunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  tunnelStart: () => ipcRenderer.invoke('tunnel:start'),
  tunnelStop: () => ipcRenderer.invoke('tunnel:stop'),
  onTunnelStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('tunnel:status', listener);
    return () => ipcRenderer.removeListener('tunnel:status', listener);
  },
});

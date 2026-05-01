'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Notification, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const PtyManager = require('./pty-manager');
const SessionsStore = require('./sessions-store');
const BufferStore = require('./buffer-store');

// Reject ids that could escape userData via path traversal or null bytes.
// Mirror BufferStore.pathFor's character set so all on-disk artifacts share
// the same constraint.
function safeId(id) {
  const s = String(id || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(s) || s.length > 64) return null;
  return s;
}

// Restrict URL schemes that can be handed to the OS via shell.openExternal.
// Anything claude (or any subprocess) prints into a session can become a
// clickable target via the WebLinks addon — without this, a printed
// `vscode://` or `file://` URL one-clicks to a native side-effect.
const SAFE_URL_SCHEMES = /^(https?:|mailto:)/i;
function safeOpenExternal(url) {
  if (typeof url !== 'string' || !SAFE_URL_SCHEMES.test(url)) return;
  try { shell.openExternal(url); } catch (_) {}
}
const McpHttpServer = require('./mcp-server');
const { buildTools } = require('./mcp-tools');
const Scheduler = require('./scheduler');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const VITE_URL = 'http://localhost:5174';

// macOS reads the leftmost menu-bar label from the running bundle's Info.plist.
// In packaged builds that's "Anthology" because electron-builder bakes the
// productName in. In `npm run dev` we're running raw Electron.app, so the
// system shows "Electron" — installing a custom application menu (below) with
// the first submenu label = APP_NAME overrides it. Set it pre-`whenReady` so
// the dock title and notifications also pick it up.
const APP_NAME = 'Anthology';
app.setName(APP_NAME);

let mainWindow = null;
let ptyManager = null;
let sessionsStore = null;
let bufferStore = null;
let mcpServer = null;
let mcpInfo = null; // { port, token }
let scheduler = null;

// Standard macOS application menu, but with the leftmost label forced to
// APP_NAME so dev runs don't show "Electron" next to the apple. Same template
// in production keeps the app menu consistent with what users expect from a
// native macOS app (About, Hide, Quit, etc.).
function buildAppMenu() {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${APP_NAME}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: `Quit ${APP_NAME}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { role: 'window' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Claude Code setup guide',
          click: () => safeOpenExternal('https://docs.claude.com/en/docs/claude-code/setup'),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0A0A0B',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(VITE_URL);
    // DevTools available via Cmd+Opt+I when needed; not auto-opened.
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeOpenExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Dev-mode dock icon: in production, electron-builder bakes build/icon.icns
  // into the .app bundle, but `npm run dev` runs raw electron with its
  // default icon. Set it explicitly so the bee shows up while developing.
  if (isDev && process.platform === 'darwin' && app.dock?.setIcon) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', '..', 'build', 'icon.png'));
    } catch (_) { /* best effort */ }
  }

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(buildAppMenu());
  }

  sessionsStore = new SessionsStore(app.getPath('userData'));
  bufferStore = new BufferStore(app.getPath('userData'));

  const sendToRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  PtyManager.setAppVersion(app.getVersion());
  ptyManager = new PtyManager({ sendToRenderer });

  // Start the MCP HTTP server with station tools so PM sessions can manage workers.
  const tools = buildTools({
    ptyManager,
    sessionsStore,
    broadcast: sendToRenderer,
  });
  mcpServer = new McpHttpServer({ tools });
  try {
    mcpInfo = await mcpServer.start();
    console.log(`[mcp] listening on 127.0.0.1:${mcpInfo.port}`);
  } catch (e) {
    console.error('[mcp] failed to start:', e);
  }

  // Scheduler: when a schedule fires, spawn a session in its cwd and submit the prompt.
  scheduler = new Scheduler({
    userDataDir: app.getPath('userData'),
    broadcast: sendToRenderer,
    fire: async ({ schedule }) => {
      const id = 's_sched_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
      const session = {
        id,
        name: schedule.name || 'scheduled',
        cwd: schedule.cwd,
        color: schedule.color || '#7B2FBE',
        tag: schedule.tag || 'scheduled',
        pinned: false,
        spawnedBySchedule: schedule.id,
        createdAt: Date.now(),
      };
      sessionsStore.upsert(session);
      ptyManager.create({ id, cwd: schedule.cwd, runClaude: true });
      sendToRenderer('session:created', session);
      // Submit the prompt once claude is up.
      if (schedule.prompt && schedule.prompt.trim()) {
        setTimeout(() => {
          try { ptyManager.submitPrompt(id, schedule.prompt); } catch (_) {}
        }, 4500);
      }
      // System notification so the user knows it fired.
      try {
        if (Notification.isSupported()) {
          new Notification({ title: `Scheduled: ${session.name}`, body: 'Spawned a Claude Code session.', silent: true }).show();
        }
      } catch (_) {}
    },
  });

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Coordinate one round-trip with the renderer to flush per-session scrollback
// before tearing down ptys. Without this, the last <10 s of every live session
// would be lost on every Cmd+Q. Hard 1.5 s timeout so we can't hang on quit.
let didFlush = false;
app.on('before-quit', (e) => {
  const teardown = () => {
    if (ptyManager) ptyManager.killAll();
    if (mcpServer) mcpServer.stop().catch(() => {});
    if (scheduler) scheduler.shutdown();
  };
  if (didFlush || !mainWindow || mainWindow.isDestroyed()) {
    teardown();
    return;
  }
  e.preventDefault();
  didFlush = true;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ipcMain.removeListener('app:flush:done', finish);
    teardown();
    app.quit();
  };
  ipcMain.once('app:flush:done', finish);
  setTimeout(finish, 1500);
  try {
    mainWindow.webContents.send('app:flush');
  } catch (_) {
    finish();
  }
});

function registerIpcHandlers() {
  // -------------------- Sessions persistence --------------------
  ipcMain.handle('sessions:list', () => sessionsStore.list());
  ipcMain.handle('sessions:save', (_e, session) => sessionsStore.upsert(session));
  ipcMain.handle('sessions:delete', (_e, id) => sessionsStore.remove(id));
  ipcMain.handle('sessions:recentDirs', () => sessionsStore.listRecentDirs());

  // -------------------- PTY management --------------------
  // Public pty:create deliberately drops `command` — only the privileged
  // pty:create-pm path constructs commands (with controlled shell quoting).
  // A renderer XSS otherwise has a one-shot to write arbitrary shell input.
  ipcMain.handle('pty:create', (_e, opts) => {
    const id = safeId(opts?.id);
    if (!id) throw new Error('Invalid session id');
    const cols = Math.max(2, Math.min(1000, Number(opts?.cols) || 100));
    const rows = Math.max(2, Math.min(1000, Number(opts?.rows) || 30));
    return ptyManager.create({
      id,
      cwd: typeof opts?.cwd === 'string' ? opts.cwd : null,
      cols,
      rows,
      runClaude: opts?.runClaude !== false,
    });
  });
  ipcMain.handle('pty:write', (_e, { id, data }) => {
    const sid = safeId(id);
    if (!sid || typeof data !== 'string') return false;
    return ptyManager.write(sid, data);
  });
  ipcMain.handle('pty:resize', (_e, { id, cols, rows }) => {
    const sid = safeId(id);
    if (!sid) return false;
    const c = Math.max(2, Math.min(1000, Number(cols) || 0));
    const r = Math.max(2, Math.min(1000, Number(rows) || 0));
    return ptyManager.resize(sid, c, r);
  });
  ipcMain.handle('pty:kill', (_e, id) => {
    const sid = safeId(id);
    return sid ? ptyManager.kill(sid) : false;
  });
  ipcMain.handle('pty:exists', (_e, id) => {
    const sid = safeId(id);
    return sid ? ptyManager.exists(sid) : false;
  });

  // -------------------- PM session creation (claude with MCP tools) --------------------
  ipcMain.handle('pty:create-pm', (_e, opts) => {
    if (!mcpInfo) {
      throw new Error('MCP server is not running');
    }
    const id = safeId(opts?.id);
    if (!id) throw new Error('Invalid session id');
    const configDir = path.join(app.getPath('userData'), 'mcp-configs');
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, `pm-${id}.json`);
    const config = {
      mcpServers: {
        station: {
          type: 'http',
          url: `http://127.0.0.1:${mcpInfo.port}/mcp`,
          headers: { Authorization: `Bearer ${mcpInfo.token}` },
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Escape the path for shell — userData typically lives under
    // ~/Library/Application Support/anthology, whose parent contains a space.
    const safeConfigPath = configPath.replace(/(["\\$`])/g, '\\$1');
    const command = `exec claude --mcp-config "${safeConfigPath}"\r`;

    return ptyManager.create({
      id,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
      runClaude: true,
      command,
    });
  });

  ipcMain.handle('mcp:info', () => (mcpInfo ? { port: mcpInfo.port } : null));

  // -------------------- Per-session scrollback persistence --------------------
  ipcMain.handle('buffer:save', (_e, { id, content }) => {
    const sid = safeId(id);
    return sid ? bufferStore.save(sid, content) : false;
  });
  ipcMain.handle('buffer:load', (_e, id) => {
    const sid = safeId(id);
    return sid ? bufferStore.load(sid) : null;
  });
  ipcMain.handle('buffer:remove', (_e, id) => {
    const sid = safeId(id);
    return sid ? bufferStore.remove(sid) : false;
  });

  // -------------------- Schedules --------------------
  ipcMain.handle('schedules:list', () => scheduler.list());
  ipcMain.handle('schedules:upsert', (_e, s) => scheduler.upsert(s));
  ipcMain.handle('schedules:delete', (_e, id) => scheduler.remove(id));
  ipcMain.handle('schedules:runNow', async (_e, id) => {
    const sched = scheduler.list().find((s) => s.id === id);
    if (!sched) return null;
    await scheduler._fire(id);
    return { ok: true };
  });

  // -------------------- File / dir picker --------------------
  ipcMain.handle('dialog:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // -------------------- Notifications + dock badge --------------------
  ipcMain.handle('notify:show', (_e, { title, body, silent }) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: title || 'Anthology', body: body || '', silent: !!silent });
    n.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    n.show();
    return true;
  });

  ipcMain.handle('badge:set', (_e, count) => {
    try {
      app.setBadgeCount(Math.max(0, count | 0));
      return true;
    } catch (_) {
      return false;
    }
  });

  // -------------------- Misc --------------------
  ipcMain.handle('app:home', () => app.getPath('home'));
  ipcMain.handle('app:platform', () => process.platform);
}

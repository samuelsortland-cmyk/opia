'use strict';
// Opia 5.5: Electron main process.
// Owns the pet window, the prompt panel, the tray icon, settings, and the
// Claude Code agent, which keeps running in the background while windows hide.
const path = require('path');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage,
  globalShortcut, Notification, shell, desktopCapturer, systemPreferences, clipboard,
} = require('electron');
const { spawn } = require('child_process');
const { LinkServer } = require('./link');
const shortcuts = require('./shortcuts');
const { ChatStore, deleteClaudeTranscripts } = require('./chats');
const { Team } = require('./team');
const { Settings } = require('./settings');
const { createPhysics } = require('./physics');
const { createUpdater } = require('./updater');

const PET_SIZE = 200;
const PANEL_W = 440;
const PANEL_H = 660;
const ASSETS = path.join(__dirname, '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');

if (process.platform === 'linux') {
  // Transparent windows on Linux need these.
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu');
}
app.setName('Opia 5.5');
// Windows ties notifications and taskbar grouping to this id (the shortcuts carry it too).
if (process.platform === 'win32') app.setAppUserModelId(shortcuts.APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let petWin = null;
let panelWin = null;
let tray = null;
let settings = null;
let agent = null;
let checkClaudeFn = async () => ({ installed: false, error: 'agent module missing' });
let quitting = false;
let wanderSnoozed = false;
const dragFollow = false; // panel stays put when the pet wanders

let physics = null;
let link = null; // Opia Link: the bridge to the user's own browser
let chats = null; // chat history
let team = null;  // helper Opias for long tasks
const helperWins = new Map(); // helper index -> { win, physics }
let updater = null;

const queue = [];               // prompts waiting while the agent is busy
const pendingPerms = new Map(); // id -> { resolve, toolName, input, summary, expiresAt }
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // matches the agent's auto-deny
let notifyWin = null;   // the permission sidebar
let notifyHideTimer = null;

// ---------------------------------------------------------------- helpers

function broadcast(ev) {
  for (const w of [petWin, panelWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('agent:event', ev);
  }
}

function panelVisible() {
  return !!(panelWin && !panelWin.isDestroyed() && panelWin.isVisible());
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body: String(body || '').slice(0, 200), silent: false });
    n.on('click', () => showPanel());
    n.show();
  } catch (_) { /* notifications are best-effort */ }
}

function workAreaFor(bounds) {
  const display = bounds
    ? screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) })
    : screen.getPrimaryDisplay();
  return display.workArea;
}

function sendToPet(ev) {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send('agent:event', ev);
}

// ---------------------------------------------------------------- screen capture

const SCREEN_MAX = 1600; // longest side of the screenshot sent to Claude, in pixels

/** Screenshot of the display under the cursor (or the primary one), with Opia's windows hidden. */
async function captureScreen({ display } = {}) {
  let note = '';
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status !== 'granted') {
      note = 'macOS may be hiding other apps: allow Opia (or your terminal) in System Settings → Privacy & Security → Screen Recording.';
    }
  }
  const cursor = screen.getCursorScreenPoint();
  const displays = screen.getAllDisplays();
  const target = display === 'primary' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(cursor);
  const { width: dw, height: dh } = target.size;
  const scale = Math.min(1, SCREEN_MAX / Math.max(dw, dh));
  const thumb = { width: Math.round(dw * scale), height: Math.round(dh * scale) };

  // Keep Opia's own windows out of the picture (works on Windows and macOS).
  const own = [petWin, panelWin].filter((w) => w && !w.isDestroyed() && w.isVisible());
  own.forEach((w) => { try { w.setContentProtection(true); } catch (_) {} });
  let sources;
  try {
    if (own.length) await new Promise((r) => setTimeout(r, 120));
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: thumb });
  } finally {
    own.forEach((w) => { try { w.setContentProtection(false); } catch (_) {} });
  }
  const src = (sources || []).find((x) => String(x.display_id) === String(target.id)) || (sources || [])[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('the system returned no screen image' + (note ? ' (' + note + ')' : ''));
  sendToPet({ type: 'status', mood: 'browsing', text: 'Peeking at your screen 🧐' });
  const size = src.thumbnail.getSize();
  return {
    mimeType: 'image/jpeg',
    data: src.thumbnail.toJPEG(80).toString('base64'),
    width: size.width,
    height: size.height,
    displays: displays.length,
    displayIndex: Math.max(0, displays.findIndex((d) => d.id === target.id)),
    cursor: {
      x: Math.round((cursor.x - target.bounds.x) * size.width / target.bounds.width),
      y: Math.round((cursor.y - target.bounds.y) * size.height / target.bounds.height),
    },
    note,
  };
}

// ---------------------------------------------------------------- windows

function createPetWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  petWin = new BrowserWindow({
    width: PET_SIZE,
    height: PET_SIZE,
    x: wa.x + wa.width - PET_SIZE - 24,
    y: wa.y + wa.height - PET_SIZE,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'Opia 5.5',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep jittering when unfocused
    },
  });
  // Never steal focus from what the user is doing.
  petWin.once('ready-to-show', () => petWin.showInactive());
  petWin.webContents.on('did-finish-load', () => {
    if (wanderSnoozed) petWin.webContents.send('agent:event', { type: 'wander', paused: true });
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  try { petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  petWin.loadFile(path.join(RENDERER, 'index.html'));
  petWin.on('closed', () => { petWin = null; });
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    minWidth: 320,
    minHeight: 380,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#1b1716',
    title: 'Opia 5.5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  panelWin.loadFile(path.join(RENDERER, 'panel.html'));
  panelWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); hidePanel(); }
  });
  panelWin.on('closed', () => { panelWin = null; });
  // Open external links in the user's own browser, never inside the panel.
  panelWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function positionPanel() {
  if (!panelWin || !petWin) return;
  const pb = petWin.getBounds();
  const wa = workAreaFor(pb);
  const [w, h] = panelWin.getSize();
  // Prefer the left of the pet, else the right; align bottoms.
  let x = pb.x - w - 8;
  if (x < wa.x) x = pb.x + pb.width + 8;
  if (x + w > wa.x + wa.width) x = wa.x + wa.width - w;
  let y = pb.y + pb.height - h;
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  panelWin.setPosition(Math.round(x), Math.round(y));
}

// focus=false shows the panel without taking keyboard focus from whatever the user is doing
// (a game, a document...). Only explicit user actions (prompt button, shortcut, tray) focus it.
// ---------------------------------------------------------------- permission sidebar
// When Opia needs an OK and its chat is closed, cards slide in at the right edge of the
// screen (never taking focus), styled like the prompt box. Allow/Deny answer right there.

const NOTIFY_W = 400;

function createNotifyWindow() {
  notifyWin = new BrowserWindow({
    width: NOTIFY_W,
    height: 200,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    title: 'Opia needs your OK',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  notifyWin.setAlwaysOnTop(true, 'screen-saver');
  try { notifyWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  notifyWin.loadFile(path.join(RENDERER, 'notify.html'));
  notifyWin.webContents.on('did-finish-load', () => syncNotify());
  notifyWin.on('closed', () => { notifyWin = null; });
}

function placeNotify(height) {
  if (!notifyWin || notifyWin.isDestroyed()) return;
  const wa = workAreaFor(petWin && !petWin.isDestroyed() ? petWin.getBounds() : null);
  const h = Math.max(60, Math.min(Math.round(height || 200), wa.height - 40));
  notifyWin.setBounds({ x: wa.x + wa.width - NOTIFY_W - 6, y: wa.y + 12, width: NOTIFY_W, height: h });
}

function pendingList() {
  return [...pendingPerms.values()].map(({ id, toolName, input, summary, expiresAt }) => ({ id, toolName, input, summary, expiresAt }));
}

/** Show, update or hide the sidebar to match the pending approvals. */
function syncNotify() {
  const list = pendingList();
  const want = list.length > 0 && !panelVisible();
  if (!want) {
    if (notifyWin && !notifyWin.isDestroyed()) {
      notifyWin.webContents.send('notify:perms', []);
      clearTimeout(notifyHideTimer);
      notifyHideTimer = setTimeout(() => { if (notifyWin && !notifyWin.isDestroyed() && !(pendingPerms.size && !panelVisible())) notifyWin.hide(); }, 260);
    }
    return;
  }
  clearTimeout(notifyHideTimer);
  if (!notifyWin || notifyWin.isDestroyed()) { createNotifyWindow(); return; } // did-finish-load syncs again
  notifyWin.webContents.send('notify:perms', list);
  if (!notifyWin.isVisible()) { placeNotify(notifyWin.getBounds().height); notifyWin.showInactive(); }
}

function showPanel({ focus = true } = {}) {
  if (!panelWin) createPanelWindow();
  positionPanel();
  if (focus) {
    panelWin.show();
    panelWin.focus();
  } else if (!panelWin.isVisible()) {
    panelWin.showInactive();
  }
  broadcast({ type: 'panel', open: true });
  syncNotify(); // the chat shows the approval cards now
}

function hidePanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
  broadcast({ type: 'panel', open: false });
  syncNotify();
}

function togglePanel() {
  if (panelVisible()) hidePanel(); else showPanel();
}

function togglePet() {
  if (!petWin) { createPetWindow(); return; }
  if (petWin.isVisible()) petWin.hide(); else petWin.showInactive();
  rebuildTrayMenu();
}

// ---------------------------------------------------------------- tray

function trayIcon() {
  let img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(ASSETS, 'opia-base.png'));
  if (img.isEmpty()) return nativeImage.createEmpty();
  const size = process.platform === 'darwin' ? 18 : 22;
  return img.resize({ width: size, height: Math.round(size * img.getSize().height / img.getSize().width) || size, quality: 'best' });
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('Opia 5.5');
    tray.on('click', () => togglePanel());
    rebuildTrayMenu();
  } catch (err) {
    console.error('[opia] tray unavailable:', err.message);
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const petShown = !!(petWin && petWin.isVisible());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Opia 5.5', enabled: false },
    { type: 'separator' },
    { label: petShown ? 'Hide Opia' : 'Show Opia', click: togglePet },
    { label: 'Open prompt  (Ctrl/Cmd+Shift+O)', click: showPanel },
    {
      label: 'Snooze wandering', type: 'checkbox', checked: wanderSnoozed,
      click: (item) => { wanderSnoozed = item.checked; broadcast({ type: 'wander', paused: wanderSnoozed }); },
    },
    { label: 'Stop current task', click: () => stopTask(), enabled: !!(agent && agent.busy) },
    { type: 'separator' },
    {
      label: 'Start Opia when I log in', type: 'checkbox', checked: shortcuts.getOpenAtLogin(app),
      click: (item) => { settings.set({ openAtLogin: item.checked }); shortcuts.setOpenAtLogin(app, item.checked); },
    },
    ...(process.platform === 'win32' ? [{ label: 'Create desktop shortcut', click: () => {
      const r = shortcuts.createShortcuts(app, shell);
      notify(r.ok ? 'Shortcut created' : 'Could not create the shortcut', r.ok ? 'Opia 5.5 is on your Desktop and in the Start menu.' : (r.error || ''));
    } }] : []),
    { type: 'separator' },
    updater && updater.state.state === 'available'
      ? { label: 'Update Opia now', click: () => updater.apply() }
      : { label: 'Check for updates', click: () => updater && updater.check(), enabled: !!updater },
    { type: 'separator' },
    { label: 'Turn off Opia', click: () => turnOff() },
  ]));
}

// ---------------------------------------------------------------- agent

function loadAgent() {
  let mod;
  try {
    mod = require('./agent');
  } catch (err) {
    console.error('[opia] could not load agent:', err.message);
    return;
  }
  if (typeof mod.checkClaude === 'function') checkClaudeFn = mod.checkClaude;
  agent = new mod.OpiaAgent({
    userDataDir: app.getPath('userData'),
    getSettings: () => settings.get(),
    captureScreen,
    getLinkEndpoint: () => (link ? link.cdpEndpoint() : null),
    onTeam: (req) => (team ? team.handle(req) : { error: 'Helpers are not available.' }),
    onPermissionRequest: (req) => requestPermission(req),
  });

  // Helper Opias: the main Opia can call them in for long tasks (spawn_helpers).
  team = new Team({
    getSettings: () => settings.get(),
    createAgent: (helper) => new mod.OpiaAgent({
      userDataDir: app.getPath('userData'),
      getSettings: () => settings.get(),
      role: 'helper',
      helper,
      onTeam: (req) => team.handle(req),
      onPermissionRequest: (req) => {
        const tagged = { ...req, summary: `Opia #${helper.index} (${helper.name}): ${req.summary || ''}` };
        broadcast({ type: 'permission', id: req.id, toolName: req.toolName, input: req.input, summary: tagged.summary });
        return requestPermission(tagged);
      },
    }),
  });
  team.on('update', (snap) => broadcast({ type: 'team', ...snap }));
  team.on('start', (snap) => snap.helpers.forEach((h, k) => createHelperPet(h, k)));
  team.on('helper-event', (h, ev) => {
    const w = helperWins.get(h.index);
    if (w && w.win && !w.win.isDestroyed() && ['status', 'tool', 'assistant', 'done', 'error', 'permission'].includes(ev.type)) w.win.webContents.send('agent:event', ev);
  });
  team.on('finish', (snap) => {
    if (chats) {
      const mark = { done: '✓', error: '✕', stopped: '■' };
      chats.record({ type: 'note', text: `Team of ${snap.helpers.length} helpers: ` + snap.helpers.map((h) => `${mark[h.state] || '·'} ${h.name}`).join(' · ') });
    }
    for (const h of snap.helpers) closeHelperPet(h.index, 4500);
  });

  if (chats) agent.sessionId = (chats.current() || {}).sessionId || null; // resume the open chat
  agent.on('event', (ev) => {
    broadcast(ev);
    if (chats) {
      chats.record(ev);
      if (ev.type === 'done' || ev.type === 'error') { chats.setSession(agent.sessionId); broadcast({ type: 'chats' }); }
    }
    if (ev.type === 'done' || ev.type === 'error') {
      // Any approval still open (e.g. timed out inside the agent) is now moot.
      for (const id of pendingPerms.keys()) broadcast({ type: 'permission-resolved', id, allow: false });
      pendingPerms.clear();
      syncNotify();
      if (!panelVisible()) {
        notify(ev.type === 'done' ? 'Opia finished' : 'Opia hit a snag',
          ev.type === 'done' ? (ev.result || 'Task complete.') : ev.message);
      }
      rebuildTrayMenu();
    }
  });
}

/** Turn Opia off completely: stop any task (killing Claude Code and its tools), then quit. */
function turnOff() {
  if (agent && agent.busy) stopTask();
  quitting = true;
  app.quit();
}

/** Ask the user to approve a tool call (main Opia or a helper): sidebar card + chat card. */
function requestPermission(req) {
  return new Promise((resolve) => {
    const expiresAt = Date.now() + PERMISSION_TIMEOUT_MS;
    pendingPerms.set(req.id, { resolve, ...req, expiresAt });
    // The agent auto-denies after the timeout; drop the card then too.
    setTimeout(() => {
      if (!pendingPerms.has(req.id)) return;
      pendingPerms.delete(req.id);
      broadcast({ type: 'permission-resolved', id: req.id, allow: false });
      syncNotify();
    }, PERMISSION_TIMEOUT_MS + 500).unref();
    // The sidebar slides in at the screen edge (no focus stolen, safe while gaming).
    // With quiet mode off, the chat panel opens too (also without taking focus).
    if (!panelVisible() && !settings.get().quiet) showPanel({ focus: false });
    syncNotify();
  });
}

// ---------------------------------------------------------------- helper Opias on screen
const HELPER_SIZE = 150;

/** A smaller, tinted Opia pops out of the main one and shows what its helper is doing. */
function createHelperPet(h, k) {
  if (!petWin || petWin.isDestroyed()) return;
  const pb = petWin.getBounds();
  const win = new BrowserWindow({
    width: HELPER_SIZE, height: HELPER_SIZE,
    x: Math.round(pb.x + (pb.width - HELPER_SIZE) / 2), y: Math.round(pb.y + pb.height - HELPER_SIZE),
    transparent: true, frame: false, resizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
    focusable: false, fullscreenable: false, backgroundColor: '#00000000', title: `Opia #${h.index}`, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
  win.loadFile(path.join(RENDERER, 'index.html'), { query: { helper: String(h.index), name: h.name } });
  const phys = createPhysics({ getWindow: () => win, getWorkArea: (b) => workAreaFor(b), onEvent: (ev) => { if (!win.isDestroyed()) win.webContents.send('agent:event', ev); } });
  helperWins.set(h.index, { win, physics: phys });
  win.once('ready-to-show', () => {
    win.showInactive();
    // Pop out of the main Opia: fling up and to the left, fanning out.
    setTimeout(() => phys.fling(-420 - 260 * k, -1100 - 120 * (k % 2)), 120 * k);
  });
  win.on('closed', () => { const w = helperWins.get(h.index); if (w && w.win === win) helperWins.delete(h.index); });
}

function closeHelperPet(index, delay = 0) {
  const w = helperWins.get(index);
  if (!w) return;
  setTimeout(() => {
    try { w.physics.stop('gone'); } catch (_) {}
    try { if (w.win && !w.win.isDestroyed()) w.win.close(); } catch (_) {}
    helperWins.delete(index);
  }, delay);
}

/** Stop now: drop queued prompts, deny pending approvals, kill the running task. */
function stopTask() {
  const dropped = queue.length;
  queue.length = 0;
  broadcast({ type: 'queue', length: 0 });
  for (const [id, p] of pendingPerms) { p.resolve({ allow: false, message: 'Cancelled by user' }); pendingPerms.delete(id); }
  syncNotify();
  if (team) team.cancelAll();
  if (agent) agent.cancel();
  rebuildTrayMenu();
  return { ok: true, dropped };
}

async function runNext() {
  if (!agent || agent.busy || queue.length === 0) return;
  const text = queue.shift();
  broadcast({ type: 'queue', length: queue.length });
  rebuildTrayMenu();
  try {
    await agent.run(text);
  } catch (err) {
    broadcast({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
  rebuildTrayMenu();
  // Let the agent settle its busy flag before starting the next one.
  setTimeout(runNext, 50);
}

function enqueuePrompt(text) {
  text = String(text || '').trim();
  if (!text) return { ok: false, error: 'empty prompt' };
  if (!agent) {
    const message = 'Opia\'s brain (agent module) did not load. Check the terminal for errors.';
    broadcast({ type: 'error', message });
    return { ok: false, error: message };
  }
  queue.push(text);
  if (chats) { chats.addUser(text); broadcast({ type: 'chats' }); }
  const queued = agent.busy;
  if (queued) {
    broadcast({ type: 'queue', length: queue.length });
    broadcast({ type: 'status', mood: 'listening', text: `Got it, queued (#${queue.length}).` });
  }
  runNext();
  return { ok: true, queued, position: queued ? queue.length : 0 };
}

// ---------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.on('pet:moveBy', (e, dx, dy) => {
    if (!petWin || e.sender !== petWin.webContents || (physics && physics.active)) return; // only the main Opia walks; flying: physics owns it
    const b = petWin.getBounds();
    const wa = workAreaFor(b);
    // Allow the pet to peek a little past the left/right edges, never off the bottom.
    const x = Math.max(wa.x - b.width * 0.4, Math.min(b.x + dx, wa.x + wa.width - b.width * 0.6));
    const y = Math.max(wa.y, Math.min(b.y + dy, wa.y + wa.height - b.height));
    petWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PET_SIZE, height: PET_SIZE });
    if (panelVisible() && dragFollow) positionPanel();
  });
  const senderWin = (e) => { try { return BrowserWindow.fromWebContents(e.sender) || petWin; } catch (_) { return petWin; } };
  ipcMain.handle('pet:getBounds', (e) => { const w = senderWin(e); return w && !w.isDestroyed() ? w.getBounds() : { x: 0, y: 0, width: PET_SIZE, height: PET_SIZE }; });
  ipcMain.handle('pet:getWorkArea', (e) => { const w = senderWin(e); return workAreaFor(w && !w.isDestroyed() ? w.getBounds() : null); });
  ipcMain.handle('pet:getCursor', () => screen.getCursorScreenPoint());
  ipcMain.on('pet:fling', (e, vx, vy) => { if (physics && petWin && e.sender === petWin.webContents) physics.fling(vx, vy); });
  ipcMain.on('pet:grab', (e) => { if (physics && petWin && e.sender === petWin.webContents) physics.stop('grabbed'); });
  ipcMain.on('pet:setIgnoreMouse', (_e, ignore) => {
    if (petWin) petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.on('panel:toggle', togglePanel);
  ipcMain.on('panel:hide', hidePanel);
  ipcMain.on('app:quit', () => turnOff());
  ipcMain.on('pet:menu', () => {
    if (!petWin || petWin.isDestroyed()) return;
    Menu.buildFromTemplate([
      { label: 'Open Opia', click: () => showPanel() },
      { label: 'Stop current task', click: () => stopTask(), enabled: !!(agent && agent.busy) },
      {
        label: 'Snooze wandering', type: 'checkbox', checked: wanderSnoozed,
        click: (item) => { wanderSnoozed = item.checked; broadcast({ type: 'wander', paused: wanderSnoozed }); rebuildTrayMenu(); },
      },
      { label: 'Hide Opia (tray icon brings it back)', click: () => togglePet() },
      { type: 'separator' },
      { label: 'Turn off Opia', click: () => turnOff() },
    ]).popup({ window: petWin });
  });

  ipcMain.handle('agent:prompt', (_e, text) => enqueuePrompt(text));
  ipcMain.handle('agent:cancel', () => stopTask());
  ipcMain.handle('app:shortcuts', () => shortcuts.createShortcuts(app, shell));
  // ---------- chat history ----------
  const busyNow = () => !!(agent && agent.busy) || queue.length > 0;
  const chatOut = (c) => (c ? { id: c.id, title: c.title, messages: c.messages, updatedAt: c.updatedAt } : null);
  const blocked = { ok: false, error: 'Opia is working on something in this chat. Stop it first (■), then switch.' };
  const newChat = () => {
    if (busyNow()) return blocked;
    const c = chats.create();
    if (agent) agent.sessionId = null;
    broadcast({ type: 'chats' });
    return { ok: true, chat: chatOut(c) };
  };
  ipcMain.handle('agent:newSession', newChat);
  ipcMain.handle('chats:new', newChat);
  ipcMain.handle('chats:list', () => (chats ? chats.list() : []));
  ipcMain.handle('chats:current', () => chatOut(chats && chats.current()));
  ipcMain.handle('chats:open', (_e, id) => {
    if (chats.current() && chats.current().id === id) return { ok: true, chat: chatOut(chats.current()) };
    if (busyNow()) return blocked;
    const c = chats.open(id);
    if (!c) return { ok: false, error: 'That chat no longer exists.' };
    if (agent) agent.sessionId = c.sessionId || null;
    broadcast({ type: 'chats' });
    return { ok: true, chat: chatOut(c) };
  });
  ipcMain.handle('chats:rename', (_e, id, title) => {
    const c = chats.rename(id, title);
    broadcast({ type: 'chats' });
    return { ok: !!c };
  });
  ipcMain.handle('chats:delete', (_e, ids) => {
    const list = ids === 'all' ? chats.list().map((c) => c.id) : [].concat(ids || []);
    const cur = chats.current();
    if (busyNow() && cur && list.includes(cur.id)) return { ok: false, error: 'Opia is working in that chat. Stop it first (■), then delete it.' };
    const sessions = chats.remove(list);
    const removedFiles = deleteClaudeTranscripts(sessions);
    if (agent && !busyNow()) agent.sessionId = (chats.current() || {}).sessionId || null;
    broadcast({ type: 'chats' });
    return { ok: true, deleted: list.length, removedFiles, chat: chatOut(chats.current()) };
  });
  ipcMain.on('agent:permission', (_e, id, allow) => {
    const p = pendingPerms.get(id);
    if (!p) return;
    pendingPerms.delete(id);
    if (chats) chats.record({ type: 'permission-resolved', id, allow: !!allow, toolName: p.toolName, summary: p.summary });
    p.resolve(allow ? { allow: true } : { allow: false, message: 'The user denied this action.' });
    broadcast({ type: 'permission-resolved', id, allow: !!allow });
    syncNotify();
  });
  ipcMain.on('notify:resize', (_e, h) => placeNotify(h));
  ipcMain.on('notify:openChat', () => showPanel());

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, partial) => {
    const r = settings.set(partial);
    if (partial && typeof partial.openAtLogin === 'boolean') { shortcuts.setOpenAtLogin(app, partial.openAtLogin); rebuildTrayMenu(); }
    return r;
  });
  ipcMain.handle('claude:check', async () => {
    try { return await checkClaudeFn(settings.get()); } catch (err) { return { installed: false, error: err.message }; }
  });
  ipcMain.handle('link:status', () => (link ? link.status() : { connected: false, error: 'Opia Link is not running' }));
  ipcMain.handle('link:connect', () => {
    if (!link) return { ok: false, error: 'Opia Link is not running' };
    const dir = link.prepareExtension();
    try { clipboard.writeText(dir); } catch (_) {}
    shell.openPath(dir).catch(() => {});
    // Open the browser's Extensions page (Edge first, as Opia's default browser).
    let browserPath = '';
    try { browserPath = require('./agent').findInstalledBrowser(); } catch (_) {}
    const page = /edge/i.test(browserPath) ? 'edge://extensions/' : 'chrome://extensions/';
    if (browserPath) {
      try { spawn(browserPath, [page], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch (_) {}
    }
    return { ok: true, dir, page, browser: /edge/i.test(browserPath) ? 'Edge' : browserPath ? 'Chrome' : '' };
  });
  ipcMain.handle('browser:extension', () => {
    try { return require('./agent').findExtension(); } catch (err) { return { installed: false, error: err.message }; }
  });
  ipcMain.handle('browser:installExtension', async () => {
    const store = 'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm';
    // Open the store page in Edge on Windows (the extension must be installed in the browser Opia uses).
    const url = process.platform === 'win32' ? 'microsoft-edge:' + store : store;
    try { await shell.openExternal(url); } catch (_) { await shell.openExternal(store); }
    return { ok: true };
  });
  ipcMain.handle('update:check', () => (updater ? updater.check() : { state: 'error', message: 'Updater unavailable' }));
  ipcMain.handle('update:apply', () => (updater ? updater.apply() : { state: 'error', message: 'Updater unavailable' }));
  ipcMain.handle('update:state', () => (updater ? { ...updater.state, installed: updater.installedSha() } : { state: 'idle' }));
  ipcMain.handle('app:state', () => ({
    busy: !!(agent && agent.busy),
    queue: queue.length,
    agentLoaded: !!agent,
    pendingPermissions: [...pendingPerms.values()].map(({ id, toolName, input, summary }) => ({ id, toolName, input, summary })),
  }));
}

// ---------------------------------------------------------------- lifecycle

app.on('second-instance', () => showPanel());

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  chats = new ChatStore(app.getPath('userData'));
  registerIpc();
  loadAgent();
  // Easy ways to open Opia: shortcuts on first run (refreshed if Opia moved), optional log-in start.
  if (process.platform === 'win32' && !process.env.OPIA_SNAPSHOT_DIR) {
    const first = !settings.get().shortcutsMade;
    if (first || !shortcuts.shortcutsCurrent(app, shell)) {
      const fs = require('fs');
      const desk = path.join(app.getPath('desktop'), 'Opia 5.5.lnk');
      shortcuts.createShortcuts(app, shell, { desktop: first || fs.existsSync(desk) });
      settings.set({ shortcutsMade: true });
    }
  }
  if (settings.get().openAtLogin) shortcuts.setOpenAtLogin(app, true);
  link = new LinkServer({ dataDir: app.getPath('userData'), extensionSrc: path.join(__dirname, '..', 'extension') });
  link.start().catch((err) => console.error('[opia] Opia Link:', err.message));
  link.on('status', (st) => {
    broadcast({ type: 'link', ...st });
    if (st.connected) sendToPet({ type: 'status', mood: 'success', text: 'Opia Link connected! I can reach your tabs now 🎩' });
  });
  link.on('blocked', (b) => {
    broadcast({ type: 'link-blocked', ...b });
    sendToPet({ type: 'status', mood: 'error', text: 'No payments! I don\'t do those 🎩' });
  });
  physics = createPhysics({
    getWindow: () => petWin,
    getWorkArea: (b) => workAreaFor(b),
    onEvent: sendToPet,
  });
  let lastAnnounced = null;
  updater = createUpdater({
    appDir: path.join(__dirname, '..'),
    getSettings: () => settings.get(),
    isPackaged: app.isPackaged,
    isBusy: () => !!(agent && agent.busy),
    relaunch: () => { quitting = true; app.relaunch(); app.exit(0); },
    onEvent: (ev) => {
      broadcast(ev);
      if (ev.state === 'available' && lastAnnounced !== ev.sha) {
        lastAnnounced = ev.sha;
        notify('Opia update available', 'Open the tray menu → Update Opia now, or Settings → Updates.');
      }
      rebuildTrayMenu();
    },
  });
  const autoCheck = () => { if (settings.get().autoUpdateCheck) updater.check({ quiet: true }); };
  setTimeout(autoCheck, 20 * 1000);
  setInterval(autoCheck, 6 * 60 * 60 * 1000);
  // Linux transparency bug: create transparent windows a moment after 'ready'.
  setTimeout(() => {
    createPetWindow();
    createPanelWindow();
    createTray();
  }, process.platform === 'linux' ? 300 : 0);
  try {
    globalShortcut.register('CommandOrControl+Shift+O', togglePanel);
  } catch (_) {}
});

// A desktop pet keeps living with no windows focused; only quit explicitly.
app.on('window-all-closed', (e) => { if (!quitting) e.preventDefault(); });

app.on('before-quit', () => {
  quitting = true;
  if (physics) physics.stop('quit');
  try { if (team) team.cancelAll(); } catch (_) {}
  try { if (chats) chats.flush(); } catch (_) {}
  try { if (link) link.stop(); } catch (_) {}
  for (const p of pendingPerms.values()) p.resolve({ allow: false, message: 'Opia is quitting' });
  pendingPerms.clear();
  try { if (agent && typeof agent.dispose === 'function') agent.dispose(); else if (agent) agent.cancel(); } catch (_) {}
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// Dev aid: OPIA_SNAPSHOT_DIR=/tmp/x npm start  -> saves pet + panel PNGs a few seconds after launch, then quits.
if (process.env.OPIA_SNAPSHOT_DIR) {
  app.whenReady().then(() => setTimeout(async () => {
    const fs = require('fs');
    const dir = process.env.OPIA_SNAPSHOT_DIR;
    fs.mkdirSync(dir, { recursive: true });
    try {
      showPanel();
      broadcast({ type: 'status', mood: 'browsing', text: 'Peering at a web page…' });
      broadcast({ type: 'assistant', text: 'Looking at **Hacker News** now — top story is about `pixel art`.' });
      broadcast({ type: 'tool', name: 'mcp__playwright__browser_navigate', summary: 'Opening news.ycombinator.com' });
      broadcast({ type: 'permission', id: 'demo', toolName: 'Bash', input: { command: 'du -sh ~/Downloads/*' }, summary: 'Run this command?' });
      await new Promise((r) => setTimeout(r, 1500));
      if (process.env.OPIA_SNAPSHOT_SCREEN) {
        const shot = await captureScreen({});
        fs.writeFileSync(require('path').join(dir, 'screen.jpg'), Buffer.from(shot.data, 'base64'));
        console.log('[opia] screen capture', shot.width + 'x' + shot.height, 'cursor', JSON.stringify(shot.cursor));
      }
      for (const [name, w] of [['pet', petWin], ['panel', panelWin]]) {
        if (!w) continue;
        const img = await w.webContents.capturePage();
        fs.writeFileSync(require('path').join(dir, name + '.png'), img.toPNG());
      }
    } catch (err) {
      console.error('[opia] snapshot failed:', err);
    }
    quitting = true;
    app.quit();
  }, Number(process.env.OPIA_SNAPSHOT_DELAY || 5000)));
}

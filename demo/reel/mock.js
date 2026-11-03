// Stand-in for Opia's Electron bridge (window.opia), backed by the Reel stage in the parent page.
(function () {
  var hub = window.parent.__stage;
  var S = { permissionMode: 'ask', browserMode: 'link', screenAccess: true, quiet: true, openAtLogin: false, autoUpdateCheck: true,
    updateRepo: 'samuelsortland-cmyk/opia', updateBranch: 'main', updatePath: '', updateToken: '', extensionToken: '', browserProfile: '',
    browserHeadless: true, browser: '', browserPath: '', cwd: 'C:/Users/you', claudePath: 'claude', model: '' };
  var ok = function (v) { return Promise.resolve(v); };
  window.opia = {
    platform: 'win32',
    moveBy: function (dx, dy) { hub.moveBy(dx, dy); },
    getBounds: function () { return ok(hub.getBounds()); },
    getWorkArea: function () { return ok(hub.getWorkArea()); },
    getCursor: function () { return ok(hub.getCursor()); },
    togglePanel: function () {}, setIgnoreMouse: function () {}, fling: function () {}, grab: function () {}, petMenu: function () {},
    onAgentEvent: function (cb) { return hub.onAgentEvent(cb); },
    sendPrompt: function (t) { hub.prompts.push(t); return ok({ ok: true }); },
    cancel: function () { return ok({ ok: true }); }, newSession: function () { return ok(); },
    respondPermission: function () {}, getSettings: function () { return ok(S); }, setSettings: function () { return ok(); },
    checkClaude: function () { return ok({ installed: true, version: '2.1', loggedIn: true }); },
    hidePanel: function () {}, turnOff: function () {},
    getState: function () { return ok({ busy: false, queue: 0, agentLoaded: true, pendingPermissions: [] }); },
    checkExtension: function () { return ok({ installed: false }); }, installExtension: function () {},
    linkStatus: function () { return ok({ connected: true, tabs: 9 }); }, connectLink: function () { return ok({}); },
    getUpdateState: function () { return ok({ state: 'idle' }); }, checkUpdate: function () { return ok({}); }, applyUpdate: function () {},
    createShortcuts: function () { return ok({ ok: true }); },
  };
})();

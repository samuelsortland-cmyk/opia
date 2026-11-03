// Stand-in for the Electron preload bridge (window.opia), backed by the demo stage in the parent page.
(function () {
  var hub = window.parent.__stage;
  var who = window.frameElement && window.frameElement.id; // 'pet' | 'panel'
  window.opia = {
    moveBy: function (dx, dy) { hub.moveBy(dx, dy); },
    getBounds: function () { return Promise.resolve(hub.getBounds()); },
    getWorkArea: function () { return Promise.resolve(hub.getWorkArea()); },
    getCursor: function () { return Promise.resolve(hub.getCursor()); },
    togglePanel: function () { hub.togglePanel(); },
    setIgnoreMouse: function () {},
    onAgentEvent: function (cb) { return hub.onAgentEvent(cb); },
    sendPrompt: function (t) { hub.sendPrompt(t); return Promise.resolve({ ok: true }); },
    cancel: function () { return Promise.resolve(); },
    newSession: function () { return Promise.resolve(); },
    respondPermission: function (id, allow) { hub.respondPermission(id, allow); },
    getSettings: function () { return Promise.resolve({ permissionMode: 'ask', browserMode: 'mine', quiet: true, browserHeadless: false, browser: '', browserPath: '', extensionToken: '', browserProfile: '', cwd: '~', claudePath: 'claude', model: '' }); },
    setSettings: function () { return Promise.resolve(); },
    checkClaude: function () { return Promise.resolve({ installed: true, version: '2.1.316', loggedIn: true }); },
    hidePanel: function () { hub.hidePanel(); },
    getState: function () { return Promise.resolve({ busy: false, queue: 0, agentLoaded: true, pendingPermissions: [] }); },
    platform: 'darwin',
  };
  // Mouse moves inside the frame are reported to the stage in stage coordinates.
  document.addEventListener('mousemove', function (e) {
    var r = window.frameElement.getBoundingClientRect();
    hub.cursorAt(e.clientX + r.left, e.clientY + r.top, who);
  }, true);
})();

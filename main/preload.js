'use strict';
// Bridge between the renderer windows and the main process.
// Exposed as window.opia in both the pet and the panel windows.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opia', {
  // pet window
  moveBy: (dx, dy) => ipcRenderer.send('pet:moveBy', Math.round(dx) || 0, Math.round(dy) || 0),
  getBounds: () => ipcRenderer.invoke('pet:getBounds'),
  getWorkArea: () => ipcRenderer.invoke('pet:getWorkArea'),
  getCursor: () => ipcRenderer.invoke('pet:getCursor'),
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:setIgnoreMouse', !!ignore),
  fling: (vx, vy) => ipcRenderer.send('pet:fling', Number(vx) || 0, Number(vy) || 0),
  grab: () => ipcRenderer.send('pet:grab'),

  // both windows
  onAgentEvent: (cb) => {
    const handler = (_e, ev) => cb(ev);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },
  sendPrompt: (text) => ipcRenderer.invoke('agent:prompt', String(text || '')),
  cancel: () => ipcRenderer.invoke('agent:cancel'),
  newSession: () => ipcRenderer.invoke('agent:newSession'),
  respondPermission: (id, allow) => ipcRenderer.send('agent:permission', id, !!allow),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial || {}),
  checkClaude: () => ipcRenderer.invoke('claude:check'),

  // extras (panel)
  hidePanel: () => ipcRenderer.send('panel:hide'),
  getState: () => ipcRenderer.invoke('app:state'),
  linkStatus: () => ipcRenderer.invoke('link:status'),
  connectLink: () => ipcRenderer.invoke('link:connect'),
  checkExtension: () => ipcRenderer.invoke('browser:extension'),
  installExtension: () => ipcRenderer.invoke('browser:installExtension'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  platform: process.platform,
});

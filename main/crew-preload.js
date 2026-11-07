'use strict';
// Preload for the Crew Board window (renderer/crew.html): exposes window.crewApi (see docs/CREW.md).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crewApi', {
  list: () => ipcRenderer.invoke('crew:list'),
  agents: () => ipcRenderer.invoke('crew:agents'),
  send: (text, to) => ipcRenderer.invoke('crew:send', String(text || ''), String(to || 'all')),
  clear: () => ipcRenderer.invoke('crew:clear'),
  self: () => ipcRenderer.invoke('crew:self'),
  onUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('crew:update', handler);
    return () => ipcRenderer.removeListener('crew:update', handler);
  },
});

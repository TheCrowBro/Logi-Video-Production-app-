// A tiny, explicit bridge for the page: the desktop app's version and update controls. Nothing else from Node.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vdexDesktop', {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openDownload: () => ipcRenderer.invoke('updates:open'),
  onStatus: cb => { const fn = (_e, s) => cb(s); ipcRenderer.on('updates:status', fn); return () => ipcRenderer.removeListener('updates:status', fn); },
});

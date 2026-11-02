// A tiny, explicit bridge for the page: the desktop app's version and update controls, and sign-ins in the web browser. Nothing else from Node.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vdexDesktop', {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  updateState: () => ipcRenderer.invoke('updates:state'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  openDownload: () => ipcRenderer.invoke('updates:open'),
  onStatus: cb => { const fn = (_e, s) => cb(s); ipcRenderer.on('updates:status', fn); return () => ipcRenderer.removeListener('updates:status', fn); },
  // Sign-ins open in the web browser; the answer comes back through the local server.
  openSignIn: url => ipcRenderer.invoke('signin:open', url),
  googleSignIn: opts => ipcRenderer.invoke('signin:google', opts),
  icloudSignIn: opts => ipcRenderer.invoke('signin:icloud', opts),
});

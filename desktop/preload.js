// A tiny, explicit bridge for the page: the desktop app's version and update controls, sign-ins in the web browser, and
// the licence. Nothing else from Node.
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
  // The licence: trial, code, and this computer's place on it (desktop/licence.js).
  licence: {
    state: () => ipcRenderer.invoke('licence:state'),
    enter: (code, opts) => ipcRenderer.invoke('licence:enter', String(code || ''), opts && typeof opts.release === 'string' ? { release: opts.release } : {}),
    recheck: () => ipcRenderer.invoke('licence:recheck'),
    release: () => ipcRenderer.invoke('licence:release'),
    code: () => ipcRenderer.invoke('licence:code'),
    buy: () => ipcRenderer.invoke('licence:buy'),
    localPrice: () => ipcRenderer.invoke('licence:price'),
    onChange: cb => { const fn = (_e, s) => cb(s); ipcRenderer.on('licence:changed', fn); return () => ipcRenderer.removeListener('licence:changed', fn); },
  },
});

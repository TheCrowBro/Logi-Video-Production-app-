// Desktop updates from GitHub releases. Windows and Linux: electron-updater downloads a new release in the background
// and installs it on restart (or when the app is next closed). macOS: the app is not code-signed, which Apple requires
// for a silent update, so the app can only announce a new release and open its download page.
'use strict';
const { app, dialog, ipcMain, shell } = require('electron');

const REPO = 'TheCrowBro/Logi-Video-Production-app-';
const RELEASES = `https://github.com/${REPO}/releases/latest`;
let state = { status: 'idle', version: app.getVersion(), available: null, progress: 0, url: RELEASES, error: '' };
let send = () => {};
let updater = null, offered = false;
const set = patch => { state = { ...state, ...patch }; send(state); };
const num = v => String(v || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function checkGitHub() { // version check only, used on macOS
  set({ status: 'checking', error: '' });
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vdex' } });
    if (!r.ok) throw new Error('GitHub answered ' + r.status);
    const j = await r.json(); const tag = String(j.tag_name || '').replace(/^v/, '');
    const url = /^https:\/\/github\.com\//.test(String(j.html_url || '')) ? j.html_url : RELEASES; // never open anything but GitHub
    if (tag && newer(tag, app.getVersion())) set({ status: 'available', available: tag, url });
    else set({ status: 'current', available: null });
  } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
  return state;
}
function offerRestart(win, version) {
  if (offered || !win || win.isDestroyed()) return; offered = true;
  dialog.showMessageBox(win, { type: 'info', title: 'Vdex', message: `Vdex ${version} is ready to install.`, detail: 'Restart now to update, or it installs by itself the next time Vdex is closed.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
    .then(r => { if (r.response === 0) updater.quitAndInstall(); }).catch(() => {});
}
async function check() {
  if (!app.isPackaged) return state;
  if (!updater) return checkGitHub();
  try { await updater.checkForUpdates(); } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
  return state;
}
function initUpdater(getWindow) {
  send = s => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('updates:status', s); };
  ipcMain.handle('updates:check', () => check());
  ipcMain.handle('updates:state', () => state);
  ipcMain.handle('updates:install', () => { if (updater && state.status === 'ready') { setImmediate(() => updater.quitAndInstall()); return true; } return false; });
  ipcMain.handle('updates:open', () => shell.openExternal(/^https:\/\/github\.com\//.test(state.url || '') ? state.url : RELEASES));
  if (!app.isPackaged) { set({ status: 'dev' }); return; }
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true; updater.logger = null;
    updater.on('checking-for-update', () => set({ status: 'checking', error: '' }));
    updater.on('update-available', info => set({ status: 'downloading', available: info.version, progress: 0 }));
    updater.on('update-not-available', () => set({ status: 'current', available: null }));
    updater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', info => { set({ status: 'ready', available: info.version, progress: 100 }); offerRestart(getWindow(), info.version); });
    updater.on('error', e => {
      // An unsigned Mac build cannot update itself: fall back to telling the user about the release.
      if (process.platform === 'darwin') { updater = null; checkGitHub(); return; }
      set({ status: 'error', error: (e && e.message) || String(e) });
    });
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 8000);
    setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 3600e3);
  } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
}
module.exports = { initUpdater };

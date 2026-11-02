// Desktop updates from Vdex's own download address, https://download.crowmade.app/vdex/ (a public Cloudflare R2 bucket
// the release workflow fills). Windows, Linux and a signed + notarized Mac: electron-updater downloads a new version in
// the background and installs it on restart (or when the app is next closed). An unsigned Mac cannot replace itself,
// so it is only told and sent to the download page. Store copies (Microsoft Store MSIX, Mac App Store) are updated by
// the store, so nothing here runs for them.
'use strict';
const { app, dialog, ipcMain, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');

const FEED = 'https://download.crowmade.app/vdex/'; // must equal build.publish[0].url in package.json
const PAGE = 'https://vdex.crowmade.app/download.html'; // the download page (html_handling is "none", so the .html is needed)
const STORE = !!(process.windowsStore || process.mas);
let state = { status: 'idle', version: app.getVersion(), available: null, progress: 0, url: PAGE, error: '' };
let send = () => {};
let updater = null, offered = false;
const set = patch => { state = { ...state, ...patch }; send(state); };
const num = v => String(v || '').replace(/^v/, '').split('.').map(x => parseInt(x, 10) || 0);
const newer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

async function checkFeed() { // version check only, used by an unsigned Mac
  set({ status: 'checking', error: '' });
  try {
    const r = await fetch(FEED + 'latest-mac.yml', { headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'Vdex/' + app.getVersion() } });
    if (!r.ok) throw new Error('The update server answered ' + r.status);
    const m = /^version:\s*['"]?(\d+\.\d+\.\d+)/m.exec(await r.text());
    if (m && newer(m[1], app.getVersion())) set({ status: 'available', available: m[1], url: PAGE });
    else set({ status: 'current', available: null });
  } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
  return state;
}
// electron-updater on a Mac downloads the whole update zip first and only then hands it to Squirrel.Mac, which rejects
// it when the running app is unsigned or only ad-hoc signed. So decide up front: only an app whose signature chains to
// Apple (a Developer ID build) uses electron-updater; any other Mac just checks the version.
function macAppleSigned() {
  return new Promise(resolve => {
    const bundle = path.resolve(process.execPath, '..', '..', '..'); // …/Vdex.app/Contents/MacOS/Vdex → …/Vdex.app
    execFile('/usr/bin/codesign', ['--verify', '-R=anchor apple generic', bundle], err => resolve(!err));
  });
}
function startFeedChecks() { updater = null; setTimeout(checkFeed, 8000); setInterval(checkFeed, 4 * 3600e3); }
function offerRestart(win, version) {
  if (offered || !win || win.isDestroyed()) return; offered = true;
  dialog.showMessageBox(win, { type: 'info', title: 'Vdex', message: `Vdex ${version} is ready to install.`, detail: 'Restart now to update, or it installs by itself the next time Vdex is closed.', buttons: ['Restart now', 'Later'], defaultId: 0, cancelId: 1 })
    .then(r => { if (r.response === 0) updater.quitAndInstall(); }).catch(() => {});
}
async function check() {
  if (!app.isPackaged || STORE) return state;
  if (!updater) return checkFeed();
  try { await updater.checkForUpdates(); } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
  return state;
}
function initUpdater(getWindow) {
  send = s => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('updates:status', s); };
  ipcMain.handle('updates:check', () => check());
  ipcMain.handle('updates:state', () => state);
  ipcMain.handle('updates:install', () => { if (updater && state.status === 'ready') { setImmediate(() => updater.quitAndInstall()); return true; } return false; });
  ipcMain.handle('updates:open', () => shell.openExternal(PAGE)); // only ever our own download page
  if (!app.isPackaged) { set({ status: 'dev' }); return; }
  if (STORE) { set({ status: 'store' }); return; }
  if (process.platform === 'darwin') { macAppleSigned().then(ok => ok ? startUpdater(getWindow) : startFeedChecks()); return; }
  startUpdater(getWindow);
}
function startUpdater(getWindow) {
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true; updater.logger = null;
    updater.on('checking-for-update', () => set({ status: 'checking', error: '' }));
    updater.on('update-available', info => set({ status: 'downloading', available: info.version, progress: 0 }));
    updater.on('update-not-available', () => set({ status: 'current', available: null }));
    updater.on('download-progress', p => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
    updater.on('update-downloaded', info => { set({ status: 'ready', available: info.version, progress: 100 }); offerRestart(getWindow(), info.version); });
    updater.on('error', e => {
      const msg = (e && e.message) || String(e);
      // An unsigned Mac build cannot update itself: fall back to telling the user about the new version. A signed Mac
      // that merely lost its connection keeps electron-updater.
      if (process.platform === 'darwin' && /signature|codesign|code sign/i.test(msg)) { startFeedChecks(); return; }
      set({ status: 'error', error: msg });
    });
    setTimeout(() => updater && updater.checkForUpdates().catch(() => {}), 8000);
    setInterval(() => updater && updater.checkForUpdates().catch(() => {}), 4 * 3600e3);
  } catch (e) { set({ status: 'error', error: e.message || String(e) }); }
}
module.exports = { initUpdater };

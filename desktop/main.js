// Vdex desktop: the web app in its own window. The app is served from a small local web server at
// http://localhost:47831 so it behaves exactly as it does in Chrome: service worker, saved data, sign-ins.
'use strict';
const { app, BrowserWindow, Menu, dialog, screen, session, shell } = require('electron');
const { initUpdater } = require('./updater.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');            // the web app (inside app.asar once packaged)
const DEFAULT_PORT = 47831;                           // part of the address the browser stores data under, so it stays fixed
const AUTH_HOSTS = new Set(['accounts.google.com', 'login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'www.dropbox.com']);
const GUIDE = 'https://github.com/TheCrowBro/Logi-Video-Production-app-#readme';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.ics': 'text/calendar; charset=utf-8',
};

app.setAppUserModelId('app.vdex.desktop'); // Windows attributes notifications to Vdex
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let origin = '';
let busy = null; // set when the usual port was taken and another had to be used

/* ------------------------------- local server ------------------------------- */
function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  let file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  if (!path.extname(file)) file = path.join(ROOT, 'index.html'); // the sign-in return address and share links land on the app shell
  const stream = fs.createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { stream.destroy(); res.end(); } else stream.pipe(res);
  });
  stream.on('error', () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); });
}

const listen = (port, host) => new Promise((resolve, reject) => {
  const s = http.createServer(handler);
  s.on('error', reject);
  s.listen(port, host, () => resolve(s));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  // Saved data belongs to the address, so wait a little for the usual port before falling back to another.
  for (let attempt = 0; attempt < 8; attempt++) {
    try { await listen(DEFAULT_PORT, '127.0.0.1'); return DEFAULT_PORT; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; await sleep(250 * (attempt + 1)); }
  }
  for (let port = DEFAULT_PORT + 1; port < DEFAULT_PORT + 20; port++) {
    try { await listen(port, '127.0.0.1'); busy = port; return port; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('No free local port for Vdex');
}

/* ----------------------------------- window ---------------------------------- */
const stateFile = () => path.join(app.getPath('userData'), 'desktop-state.json');
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };
const writeState = patch => { try { fs.writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch })); } catch { /* ignore */ } };

const external = url => { try { const u = new URL(url); if (['http:', 'https:', 'mailto:', 'tel:', 'sms:'].includes(u.protocol)) shell.openExternal(url); } catch { /* not a link */ } };
const isOurs = url => url === origin || url.startsWith(origin + '/');
const isAuth = url => { try { return AUTH_HOSTS.has(new URL(url).hostname); } catch { return false; } };

// Pop-ups: sign-in windows and the print window stay inside the app; everything else goes to the system browser.
function policeWindowOpen(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || isOurs(url) || isAuth(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff' } };
    external(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', child => policeWindowOpen(child.webContents));
}

function createWindow() {
  const saved = readState().bounds;
  const fits = saved && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return saved.x >= a.x - 20 && saved.y >= a.y - 20 && saved.x + saved.width <= a.x + a.width + 20 && saved.y + saved.height <= a.y + a.height + 20;
  });
  win = new BrowserWindow({
    ...(fits ? saved : { width: 1240, height: 860 }),
    minWidth: 360, minHeight: 600,
    title: 'Vdex', backgroundColor: '#14110f', autoHideMenuBar: true, show: false,
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (readState().maximized) win.maximize();
  win.once('ready-to-show', () => {
    win.show();
    if (busy) dialog.showMessageBox(win, {
      type: 'warning', title: 'Vdex',
      message: `Another program is using the address Vdex normally runs at on this computer (localhost:${DEFAULT_PORT}).`,
      detail: `Vdex has opened at localhost:${busy} for now, so it may look empty: your saved data stays with the usual address and comes back once that other program closes and you reopen Vdex.`,
    });
  });
  win.on('close', () => { writeState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }); });
  win.on('closed', () => { win = null; });
  policeWindowOpen(win.webContents);
  // Links the page navigates to itself (maps, tel:, mailto:) open outside; sign-in pages that come back to Vdex stay inside.
  win.webContents.on('will-navigate', (e, url) => { if (isOurs(url) || isAuth(url)) return; e.preventDefault(); external(url); });
  win.loadURL(origin + '/');
}

function setPermissions() {
  const ours = contents => { try { return isOurs(contents.getURL()); } catch { return false; } };
  const ses = session.defaultSession;
  // The app may use the camera, microphone, location, notifications and so on; other pages (sign-in pop-ups) may not.
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(ours(contents)));
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => (requestingOrigin && isOurs(requestingOrigin.replace(/\/$/, ''))) || (contents ? ours(contents) : false));
}

function setMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Go to Vdex', accelerator: 'CmdOrCtrl+Shift+H', click: () => { if (win) win.loadURL(origin + '/'); } },
      { type: 'separator' },
      { role: mac ? 'close' : 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Vdex guide', click: () => shell.openExternal(GUIDE) }] },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win && origin) createWindow(); });

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    listen(port, '::1').catch(() => {}); // IPv6 loopback as well, where the system has it
    origin = `http://localhost:${port}`;
  } catch (e) {
    dialog.showErrorBox('Vdex could not start', String(e && e.message || e));
    return app.quit();
  }
  setPermissions();
  setMenu();
  createWindow();
  initUpdater(() => win);
});

// Vdex desktop: the web app in its own window. The app is served from a small local web server at
// http://localhost:47831 so it behaves exactly as it does in Chrome: service worker, saved data, sign-ins.
'use strict';
const { app, BrowserWindow, Menu, dialog, screen, session, shell, ipcMain } = require('electron');
const crypto = require('crypto');
const { initUpdater } = require('./updater.js');
const { wireLicence } = require('./licence.js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');            // the web app (inside app.asar once packaged)
const DEFAULT_PORT = 47831;                           // part of the address the browser stores data under, so it stays fixed
// Sign-in pages open in the person's own web browser (Dropbox, Google, Microsoft and Apple ask apps not to show them in
// an app window); the answer comes back to this local server and is handed to the Vdex window.
const SIGNIN_HOSTS = new Set(['www.dropbox.com', 'login.microsoftonline.com']);
const GUIDE = 'https://vdex.crowmade.app/';
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
let pendingReturn = null; // a sign-in answer waiting for the window to open
let loopbackShared = false; // set when another program holds the IPv6 side of our address: sign-ins could reach it, so they are refused

/* --------------------------------- sign-ins --------------------------------- */
const signinStates = new Set();   // Dropbox/Microsoft sign-ins this app started and is waiting for
const pagePending = new Map();    // one-time code -> a Google or Apple sign-in page waiting in the web browser
const openOut = url => { global.__vdexLastExternal = url; if (!process.env.VDEX_TEST_NO_BROWSER) shell.openExternal(url).catch(() => {}); };
const fromApp = e => { try { return isOurs(new URL(e.senderFrame.url).origin); } catch { return false; } };
const signinSafe = () => !busy && !loopbackShared; // only at the usual address, held entirely by Vdex
function bringBack() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function note(res, title, text) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><body style="font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;text-align:center"><h1 style="font-size:1.4rem">${esc(title)}</h1><p>${esc(text)}</p></body>`);
}
// The Google and Apple pages run in the web browser at this app's address (which Google and Apple know), sign in with
// the service's own window, and post the answer back here with the one-time code.
function googlePage(res, nonce, { client, scope, hint, key }) {
  const sn = crypto.randomBytes(16).toString('base64');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${sn}' https://accounts.google.com/gsi/client; style-src 'unsafe-inline' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com/gsi/; connect-src 'self' https://accounts.google.com/gsi/; img-src https: data:` });
  const cfg = JSON.stringify({ client, scope, hint: hint || '', nonce, key }).replace(/</g, '\\u003c');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to Google for Vdex</title>
<body style="font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;text-align:center"><h1 style="font-size:1.4rem">Sign in to Google for Vdex</h1>
<p id="t">Click the button, sign in and click Allow. Vdex only uses its own private area of your Google Drive.</p>
<button id="go" style="font:inherit;font-weight:700;padding:12px 22px;border-radius:10px;border:0;background:#1a73e8;color:#fff;cursor:pointer" disabled>Continue with Google</button>
<script nonce="${sn}" src="https://accounts.google.com/gsi/client"></script>
<script nonce="${sn}">
const C = ${cfg}, t = document.getElementById('t'), go = document.getElementById('go');
const send = r => fetch('/__vdex/google?n=' + encodeURIComponent(C.nonce), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vdex-Key': C.key }, body: JSON.stringify(r) })
  .then(x => { go.hidden = true; if (!x.ok) { t.textContent = 'This sign-in has expired, or a newer one took over. Go back to Vdex and tap Connect again. You can close this tab.'; return; } t.textContent = r.error ? 'Sign-in not finished. Go back to Vdex and tap Connect to try again. You can close this tab.' : 'Done. Go back to Vdex; you can close this tab.'; })
  .catch(() => { t.textContent = 'Vdex has closed, or this sign-in has expired. Open Vdex and try again.'; });
const ready = () => { go.disabled = false; go.onclick = () => google.accounts.oauth2.initTokenClient({ client_id: C.client, scope: C.scope, callback: r => send(r), error_callback: e => send({ error: e.type || 'failed' }) }).requestAccessToken(C.hint ? { prompt: '', login_hint: C.hint } : { prompt: '' }); };
window.google && google.accounts ? ready() : addEventListener('load', ready);
</script></body>`);
}
function applePage(res, nonce, { container, apiToken, environment, key }) {
  const sn = crypto.randomBytes(16).toString('base64');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${sn}'; style-src 'unsafe-inline'; connect-src 'self' https://api.apple-cloudkit.com` });
  const cfg = JSON.stringify({ container, apiToken, environment, nonce, key }).replace(/</g, '\\u003c');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in to iCloud for Vdex</title>
<body style="font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;text-align:center"><h1 style="font-size:1.4rem">Sign in to iCloud for Vdex</h1>
<p id="t">Click the button and sign in with your Apple ID. Tick “Keep me signed in” so Apple asks less often. Vdex only uses its own private space in your iCloud.</p>
<button id="go" style="font:inherit;font-weight:700;padding:12px 22px;border-radius:10px;border:0;background:#000;color:#fff;cursor:pointer">Continue with Apple</button>
<script nonce="${sn}">
const C = ${cfg}, t = document.getElementById('t'), go = document.getElementById('go');
const send = r => fetch('/__vdex/icloud?n=' + encodeURIComponent(C.nonce), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vdex-Key': C.key }, body: JSON.stringify(r) })
  .then(x => { go.hidden = true; if (!x.ok) { t.textContent = 'This sign-in has expired, or a newer one took over. Go back to Vdex and tap Connect again. You can close this tab.'; return; } t.textContent = r.error ? 'Sign-in not finished. Go back to Vdex and tap Connect to try again. You can close this tab.' : 'Done. Go back to Vdex; you can close this tab.'; })
  .catch(() => { t.textContent = 'Vdex has closed, or this sign-in has expired. Open Vdex and try again.'; });
const current = 'https://api.apple-cloudkit.com/database/1/' + encodeURIComponent(C.container) + '/' + (C.environment === 'development' ? 'development' : 'production') + '/public/users/caller?ckAPIToken=' + encodeURIComponent(C.apiToken);
go.onclick = async () => {
  const w = window.open('', 'vdex-icloud', 'width=640,height=700'); // straight from the click, or the browser blocks it
  if (!w) { t.textContent = 'The Apple window was blocked. Allow pop-ups for this page and click again.'; return; }
  let url = ''; try { url = (await (await fetch(current, { credentials: 'omit' })).json()).redirectURL || ''; } catch (e) { /* below */ }
  if (!url) { w.close(); t.textContent = 'iCloud could not be reached. Check the connection and click again.'; return; }
  w.location.href = url;
  let settled = false;
  // Only Apple's own sites, and only from that window (or a frame inside it), with an answer in it.
  const apple = o => { try { const h = new URL(o); return h.protocol === 'https:' && ['apple.com', 'icloud.com', 'apple-cloudkit.com'].some(d => h.hostname === d || h.hostname.endsWith('.' + d)); } catch (x) { return false; } };
  const fromPopup = s => { try { return !!s && (s === w || s.top === w); } catch (x) { return false; } };
  const got = e => { if (settled || !fromPopup(e.source) || !apple(e.origin) || !e.data || typeof e.data !== 'object' || !(e.data.ckWebAuthToken || e.data.ckSession || e.data.errorMessage)) return;
    settled = true; removeEventListener('message', got); try { w.close(); } catch (x) { /* closed */ }
    const tok = e.data.ckWebAuthToken || e.data.ckSession; send(tok ? { ckSession: String(tok) } : { error: 'failed' }); };
  addEventListener('message', got);
  const watch = setInterval(() => { if (!w.closed) return; clearInterval(watch); setTimeout(() => { if (!settled) { removeEventListener('message', got); t.textContent = 'The Apple window was closed before signing in. Click the button to try again.'; } }, 1500); }, 500);
};
</script></body>`);
}
ipcMain.handle('signin:open', (e, url) => {
  if (!fromApp(e) || !signinSafe()) return false;
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || !SIGNIN_HOSTS.has(u.hostname)) return false;
  const state = u.searchParams.get('state'); if (state) { signinStates.add(state); setTimeout(() => signinStates.delete(state), 30 * 60e3); }
  openOut(u.href); return true;
});
ipcMain.handle('signin:google', (e, opts = {}) => new Promise(resolve => {
  if (!fromApp(e)) return resolve({ error: 'refused' });
  if (!signinSafe()) return resolve({ error: 'address_taken' });
  waitForPage('google', { client: String(opts.client || ''), scope: String(opts.scope || ''), hint: String(opts.hint || '') }, resolve);
}));
ipcMain.handle('signin:icloud', (e, opts = {}) => new Promise(resolve => {
  if (!fromApp(e)) return resolve({ error: 'refused' });
  if (!signinSafe()) return resolve({ error: 'address_taken' });
  const container = String(opts.container || ''), apiToken = String(opts.apiToken || ''), environment = opts.environment === 'development' ? 'development' : '';
  if (!/^iCloud\.[A-Za-z0-9.-]+$/.test(container) || !/^[A-Za-z0-9]+$/.test(apiToken)) return resolve({ error: 'refused' });
  waitForPage('icloud', { container, apiToken, environment }, resolve);
}));
// One sign-in page at a time: Connect tapped again replaces the one still waiting. It expires after five minutes.
function waitForPage(kind, opts, resolve) {
  for (const p of [...pagePending.values()]) p.resolve({ error: 'replaced' });
  const nonce = crypto.randomBytes(24).toString('base64url');
  const timer = setTimeout(() => { pagePending.delete(nonce); resolve({ error: 'timed_out' }); }, 5 * 60e3);
  pagePending.set(nonce, { kind, opts, resolve: r => { clearTimeout(timer); pagePending.delete(nonce); resolve(r); } });
  openOut(`${origin}/__vdex/${kind}?n=${encodeURIComponent(nonce)}`);
}

/* ------------------------------- local server ------------------------------- */
function handler(req, res) {
  let u; try { u = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  // Google and Apple: the sign-in page, and its answer.
  const kind = u.pathname === '/__vdex/google' ? 'google' : u.pathname === '/__vdex/icloud' ? 'icloud' : '';
  if (kind) {
    const p = pagePending.get(u.searchParams.get('n') || '');
    if (!p || p.kind !== kind) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('This sign-in has expired. Open Vdex and try again.'); }
    if (req.method === 'GET') { // served once; the answer must carry the key that only this page was given
      if (p.key) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('This sign-in page was already opened. Go back to Vdex and try again.'); }
      p.key = crypto.randomBytes(24).toString('base64url');
      return (kind === 'google' ? googlePage : applePage)(res, u.searchParams.get('n'), { ...p.opts, key: p.key });
    }
    if (req.method === 'POST') {
      if (req.headers.origin !== origin || !/^application\/json/.test(req.headers['content-type'] || '') || !p.key || req.headers['x-vdex-key'] !== p.key) { res.writeHead(403); return res.end(); }
      let body = ''; req.setEncoding('utf8');
      req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
      req.on('end', () => { let r; try { r = JSON.parse(body); } catch { r = { error: 'unreadable' }; } p.resolve(r && typeof r === 'object' ? r : { error: 'unreadable' }); res.writeHead(204); res.end(); bringBack(); });
      return;
    }
  }
  // Dropbox and Microsoft: the sign-in coming back in the web browser. Hand it to the Vdex window; the tab can close.
  const state = u.searchParams.get('state') || '';
  if (req.method === 'GET' && u.pathname === '/' && signinStates.has(state) && (u.searchParams.has('code') || u.searchParams.has('error'))) {
    signinStates.delete(state);
    const back = new URL(origin + '/'); u.searchParams.forEach((v, k) => back.searchParams.set(k, v));
    if (win) { win.loadURL(back.href); bringBack(); } else { pendingReturn = back.href; createWindow(); } // a Mac keeps running with no window
    if (u.searchParams.has('error')) return note(res, 'Sign-in not finished', 'Nothing was connected. Go back to Vdex to see why, and tap Connect to try again. You can close this tab.');
    return note(res, 'Almost done', 'Go back to Vdex: it is finishing your sign-in. You can close this tab.');
  }
  if (req.method === 'GET' && u.pathname === '/' && /^vdex(ms)?-/.test(state) && (u.searchParams.has('code') || u.searchParams.has('error'))) {
    // Not one this app is waiting for (already used, too old, or from before a restart): never boot the app in the web browser.
    const fromWindow = win && (req.headers['user-agent'] || '').includes('Electron/');
    if (!fromWindow) return note(res, 'This sign-in has expired', 'Go back to Vdex and tap Connect again. You can close this tab.');
  }
  // The offline worker is for the website only; one installed here by a web browser would answer the sign-in pages.
  if (u.pathname === '/sw.js') { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not used in the desktop app'); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end(); }
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

// Pop-ups: the print window stays inside the app; everything else, sign-in pages included, goes to the web browser.
// The teleprompter's window (prompter.html) goes full screen on a second display when there is one.
function prompterWindow(contents) {
  const here = screen.getDisplayMatching(BrowserWindow.fromWebContents(contents)?.getBounds() || screen.getPrimaryDisplay().bounds);
  const other = screen.getAllDisplays().find(d => d.id !== here.id);
  const b = (other || here).workArea;
  return { x: b.x, y: b.y, width: other ? b.width : Math.min(1024, b.width), height: other ? b.height : Math.min(640, b.height), fullscreen: !!other, autoHideMenuBar: true, backgroundColor: '#000000' };
}
function policeWindowOpen(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url) && new URL(url).pathname === '/prompter.html') return { action: 'allow', overrideBrowserWindowOptions: prompterWindow(contents) };
    if (!url || url === 'about:blank' || isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 560, height: 720, autoHideMenuBar: true, backgroundColor: '#ffffff' } };
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
  // Links the page navigates to itself (maps, tel:, mailto:) open outside.
  win.webContents.on('will-navigate', (e, url) => { if (isOurs(url)) return; e.preventDefault(); external(url); });
  win.loadURL(pendingReturn || origin + '/'); pendingReturn = null;
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
    { role: 'help', submenu: [{ label: 'Vdex website', click: () => shell.openExternal(GUIDE) }] },
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!win && origin) createWindow(); });

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    listen(port, '::1').catch(e => { if (e.code === 'EADDRINUSE') loopbackShared = true; }); // IPv6 loopback as well, where the system has it; taken by someone else means no sign-ins
    origin = `http://localhost:${port}`;
  } catch (e) {
    dialog.showErrorBox('Vdex could not start', String(e && e.message || e));
    return app.quit();
  }
  setPermissions();
  setMenu();
  // The licence (desktop/licence.js). An earlier version of Vdex ran here if it left desktop-state.json (written only
  // by Vdex, when its window closes) without the licence's copy of the trial start in it, which versions with a
  // licence always add; that is read before this run opens a window, and those installs keep Vdex free. (Chromium's
  // own storage folders are no sign: they can exist before any page has run.)
  const dir = app.getPath('userData');
  wireLicence({
    ipcMain, fromApp, shell, dir, getWindow: () => win,
    hasPriorData: () => fs.existsSync(stateFile()) && !readState().licence,
    mirror: { get: () => readState().licence || null, set: v => writeState({ licence: v }) },
    site: !app.isPackaged && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(process.env.VDEX_LICENCE_SITE || '') ? process.env.VDEX_LICENCE_SITE : '', // tests only
  });
  createWindow();
  initUpdater(() => win);
});

// Cloud storage adapters. Each exposes: name, ready() -> bool, read() -> object|null, write(text).
// Dropbox and Google Drive need an app key / client ID you create once (see docs/connections.md); they are stored on this device only.

const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const settings = {
  dropboxKey: () => LS.get('logi-dropbox-key') || '',
  gdriveId: () => LS.get('logi-gdrive-id') || '',
  msId: () => LS.get('logi-ms-id') || '',
  webdav: () => { try { return JSON.parse(LS.get('logi-webdav')) || {}; } catch { return {}; } },
  setWebdav: v => v ? LS.set('logi-webdav', JSON.stringify(v)) : LS.del('logi-webdav'),
  setMsId: v => LS.set('logi-ms-id', v.trim()),
  setDropboxKey: v => LS.set('logi-dropbox-key', v.trim()),
  setGdriveId: v => LS.set('logi-gdrive-id', v.trim()),
};
export const redirectUri = () => location.origin + location.pathname;
const FILE = 'vdex-production-db.json';

const parse = text => {
  if (!text || !text.trim()) return null;
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || !('bookings' in d || 'gear' in d)) throw new Error('Not a Vdex database file');
  return d;
};

/* ------------------------------ local file ------------------------------ */
export const fileAdapter = (handle, aux = null) => ({
  id: 'file', label: handle.name, handle, aux,
  ready: async (ask) => (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' || (ask && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'),
  read: async () => parse(await (await handle.getFile()).text()),
  write: async text => { const w = await handle.createWritable(); await w.write(text); await w.close(); },
  // The calendar feed goes to a second file the user picks in the same synced folder.
  writeAux: async function ({ text }) { if (!this.aux) return; if ((await this.aux.queryPermission({ mode: 'readwrite' })) !== 'granted') return; const w = await this.aux.createWritable(); await w.write(text); await w.close(); },
});

/* -------------------------------- Dropbox -------------------------------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function dropboxBegin() {
  const key = settings.dropboxKey();
  if (!key) throw new Error('Enter your Dropbox app key first');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  LS.set('logi-dbx-verifier', verifier);
  const state = 'vdex-' + b64url(crypto.getRandomValues(new Uint8Array(16))); // random, checked on return (no cross-site login injection)
  LS.set('logi-dbx-state', state);
  const q = new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: redirectUri(), state });
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + q;
}

// Call on page load; returns true if it consumed an OAuth redirect.
export async function dropboxFinish() {
  const p = new URLSearchParams(location.search);
  const state = p.get('state');
  if (!state || !state.startsWith('vdex-')) return false;
  history.replaceState(null, '', location.pathname);
  const expected = LS.get('logi-dbx-state'); LS.del('logi-dbx-state');
  if (!expected || state !== expected) throw new Error('Dropbox sign-in did not come from this device; try again');
  const code = p.get('code');
  if (!code) throw new Error(p.get('error_description') || 'Dropbox sign-in cancelled');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: settings.dropboxKey(), code_verifier: LS.get('logi-dbx-verifier') || '', redirect_uri: redirectUri() }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(t.error_description || 'Dropbox token exchange failed');
  LS.del('logi-dbx-verifier');
  LS.set('logi-dbx-token', JSON.stringify({ refresh: t.refresh_token, access: t.access_token, exp: Date.now() + t.expires_in * 1000 - 60000 }));
  return true;
}

async function dropboxToken() {
  let t; try { t = JSON.parse(LS.get('logi-dbx-token')); } catch { /* none */ }
  if (!t) throw new Error('Not signed in to Dropbox');
  if (t.exp > Date.now()) return t.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: settings.dropboxKey() }) });
  const n = await r.json();
  if (!r.ok) throw new Error('Dropbox session expired — reconnect');
  t.access = n.access_token; t.exp = Date.now() + n.expires_in * 1000 - 60000;
  LS.set('logi-dbx-token', JSON.stringify(t));
  return t.access;
}

export const dropboxAdapter = () => ({
  id: 'dropbox', label: 'Dropbox (Apps/…)',
  ready: async () => !!LS.get('logi-dbx-token'),
  read: async () => {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken(), 'Dropbox-API-Arg': JSON.stringify({ path: '/' + FILE }) } });
    if (r.status === 409) return null; // not created yet
    if (!r.ok) throw new Error('Dropbox read failed (' + r.status + ')');
    return parse(await r.text());
  },
  write: async text => {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: '/' + FILE, mode: 'overwrite', mute: true }) }, body: text });
    if (!r.ok) throw new Error('Dropbox write failed (' + r.status + ')');
  },
  writeExtra: async (name, text) => {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: '/' + name, mode: 'overwrite', mute: true }) }, body: text });
    if (!r.ok) throw new Error('Dropbox backup write failed (' + r.status + ')');
  },
  readExtra: async name => {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken(), 'Dropbox-API-Arg': JSON.stringify({ path: '/' + name }) } });
    if (r.status === 409) return null;
    if (!r.ok) throw new Error('Dropbox read failed (' + r.status + ')');
    return r.text();
  },
  writeAux: async ({ name, text }) => {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken(), 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: '/' + name, mode: 'overwrite', mute: true }) }, body: text });
    if (!r.ok) throw new Error('Dropbox feed write failed (' + r.status + ')');
  },
  // A direct-download shared link for the feed. Needs the sharing.write scope on your Dropbox app.
  shareLink: async name => {
    const hdr = { Authorization: 'Bearer ' + await dropboxToken(), 'Content-Type': 'application/json' };
    let r = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', { method: 'POST', headers: hdr, body: JSON.stringify({ path: '/' + name }) });
    let j = await r.json().catch(() => ({}));
    if (r.status === 409 && /already_exists/.test(JSON.stringify(j))) { r = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', { method: 'POST', headers: hdr, body: JSON.stringify({ path: '/' + name, direct_only: true }) }); j = await r.json(); j = j.links?.[0] || {}; }
    if (!r.ok && r.status !== 409) throw new Error(r.status === 401 || r.status === 403 ? 'Your Dropbox app needs the sharing.write permission (add it in the Dropbox App Console, then reconnect).' : 'Dropbox link failed (' + r.status + ')');
    if (!j.url) throw new Error('Dropbox did not return a link');
    const u = new URL(j.url); u.searchParams.set('dl', '1'); return u.toString(); // dl=1 serves the file itself
  },
  signOut: () => { LS.del('logi-dbx-token'); },
});

/* ----------------------------- Google Drive ----------------------------- */
let gisPromise; const gTokens = {}; // one token per scope set
export const loadGIS = () => gisPromise || (gisPromise = new Promise((res, rej) => {
  if (window.google?.accounts?.oauth2) return res();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.append(s);
}));

export async function googleToken(scope, interactive) {
  const t = gTokens[scope];
  if (t && t.exp > Date.now()) return t.value;
  if (!interactive) throw new Error('Google sign-in needed — tap Reconnect / Sync now');
  const id = settings.gdriveId();
  if (!id) throw new Error('Enter your Google client ID first');
  await loadGIS();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: id, scope,
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); gTokens[scope] = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 - 60000 }; LS.set('logi-gdrive-on', '1'); res(r.access_token); },
      error_callback: e => rej(new Error(e.type || 'Google sign-in blocked')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}
export const forgetGoogleToken = scope => { delete gTokens[scope]; };
const DRIVE_APP = 'https://www.googleapis.com/auth/drive.appdata', DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const driveScope = () => LS.get('logi-feed-drive') === '1' ? DRIVE_APP + ' ' + DRIVE_FILE : DRIVE_APP;
const gdriveToken = interactive => googleToken(driveScope(), interactive);
const hasToken = () => { const t = gTokens[driveScope()]; return !!(t && t.exp > Date.now()); };

async function gfetch(url, init = {}, interactive = false) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await gdriveToken(interactive) } });
  if (r.status === 401) { forgetGoogleToken(driveScope()); throw new Error('Google session expired — reconnect'); }
  return r;
}

export const gdriveAdapter = () => {
  let fileId = LS.get('logi-gdrive-file');
  const findExtra = async name => { // another file of ours in the hidden app-data folder, by name
    const r = await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${name.replace(/'/g, "\\'")}'`)}&fields=files(id)`);
    if (!r.ok) throw new Error('Drive lookup failed (' + r.status + ')');
    return (await r.json()).files?.[0]?.id || null;
  };
  const find = async () => {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${FILE}'`);
    const r = await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`);
    if (!r.ok) throw new Error('Drive lookup failed (' + r.status + ')');
    fileId = (await r.json()).files?.[0]?.id || null;
    if (fileId) LS.set('logi-gdrive-file', fileId);
    return fileId;
  };
  return {
    id: 'gdrive', label: 'Google Drive (app data)',
    // Tokens last an hour and can't be refreshed silently by the browser, so ask on a user gesture when expired.
    ready: async ask => { if (hasToken()) return true; if (!ask) return false; await gdriveToken(true); return true; },
    read: async () => {
      const id = await find(); if (!id) return null;
      const r = await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
      if (r.status === 404) { fileId = null; LS.del('logi-gdrive-file'); return null; }
      if (!r.ok) throw new Error('Drive read failed (' + r.status + ')');
      return parse(await r.text());
    },
    write: async text => {
      const id = await find();
      let r;
      if (id) r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      else {
        const boundary = 'logi' + Date.now();
        const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name: FILE, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
        r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
        if (r.ok) { fileId = (await r.json()).id; LS.set('logi-gdrive-file', fileId); return; }
      }
      if (!r.ok) throw new Error('Drive write failed (' + r.status + ')');
    },
    // The feed lives as a visible file in Drive (drive.file scope: only files this app made), shared read-only by link.
    enableFeed: async () => { LS.set('logi-feed-drive', '1'); await gdriveToken(true); },
    writeExtra: async (name, text) => {
      const id = await findExtra(name);
      let r;
      if (id) r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      else {
        const boundary = 'logi' + Date.now();
        const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
        r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      }
      if (!r.ok) throw new Error('Drive backup write failed (' + r.status + ')');
    },
    readExtra: async name => {
      const id = await findExtra(name); if (!id) return null;
      const r = await gfetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('Drive read failed (' + r.status + ')');
      return r.text();
    },
    writeAux: async ({ name, text }) => {
      if (LS.get('logi-feed-drive') !== '1') return;
      let fid = LS.get('logi-gdrive-feed');
      if (!fid) { const r = await gfetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${name}' and trashed=false`)}&fields=files(id)`); fid = (await r.json()).files?.[0]?.id || null; }
      let r;
      if (fid) r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/calendar' }, body: text });
      else {
        const boundary = 'logi' + Date.now();
        r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, mimeType: 'text/calendar' })}\r\n--${boundary}\r\nContent-Type: text/calendar\r\n\r\n${text}\r\n--${boundary}--` });
        if (r.ok) fid = (await r.json()).id;
      }
      if (!r.ok) throw new Error('Drive feed write failed (' + r.status + ')');
      LS.set('logi-gdrive-feed', fid);
    },
    shareLink: async () => {
      const fid = LS.get('logi-gdrive-feed'); if (!fid) throw new Error('The feed file has not been written yet — add or edit a booking first');
      const r = await gfetch(`https://www.googleapis.com/drive/v3/files/${fid}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) });
      if (!r.ok) throw new Error('Could not share the feed file (' + r.status + ')');
      return `https://drive.google.com/uc?export=download&id=${fid}`;
    },
    signOut: () => { forgetGoogleToken(driveScope()); LS.del('logi-gdrive-file'); LS.del('logi-gdrive-feed'); LS.del('logi-gdrive-on'); },
  };
};

/* ------------------------------ Microsoft 365 ------------------------------ */
let msalPromise, msApp = null;
const loadMsal = () => msalPromise || (msalPromise = new Promise((res, rej) => {
  if (window.msal) return res();
  const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js'; s.integrity = 'sha384-B5PXeUfgiegchZiX5iMRssMrHd9NfPhFnITob1HyW1CY76udptWpBsniaDsH/+BY'; s.crossOrigin = 'anonymous'; s.onload = res; s.onerror = () => rej(new Error('Could not load Microsoft sign-in')); document.head.append(s);
}));
async function msal() {
  if (msApp) return msApp;
  const id = settings.msId(); if (!id) throw new Error('Enter your Microsoft application (client) ID first');
  await loadMsal();
  msApp = new window.msal.PublicClientApplication({ auth: { clientId: id, authority: 'https://login.microsoftonline.com/common', redirectUri: redirectUri() }, cache: { cacheLocation: 'localStorage' } });
  await msApp.initialize();
  return msApp;
}
// MSAL refreshes silently in a hidden frame, so background syncs keep working after the first sign-in.
export async function microsoftToken(scopes, interactive) {
  const app = await msal();
  const account = app.getAllAccounts()[0];
  if (account) { try { return (await app.acquireTokenSilent({ scopes, account })).accessToken; } catch (e) { if (!interactive) throw new Error('Microsoft sign-in needed — tap Sync now'); } }
  if (!interactive) throw new Error('Microsoft sign-in needed — tap Sync now');
  return (await app.loginPopup({ scopes })).accessToken;
}
/* ------------------------------- OneDrive ------------------------------- */
// Microsoft Graph, app folder only (Files.ReadWrite.AppFolder): Vdex sees nothing but its own folder.
const OD = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';
async function odfetch(path, init = {}, interactive = false) {
  const token = await microsoftToken(['Files.ReadWrite.AppFolder'], interactive);
  const r = await fetch(OD + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401) throw new Error('Microsoft sign-in expired — reconnect');
  return r;
}
export const onedriveAdapter = () => ({
  id: 'onedrive', label: 'OneDrive (app folder)',
  ready: async ask => { try { await microsoftToken(['Files.ReadWrite.AppFolder'], ask); return true; } catch { return false; } },
  read: async () => { const r = await odfetch(`${FILE}:/content`); if (r.status === 404) return null; if (!r.ok) throw new Error('OneDrive read failed (' + r.status + ')'); return parse(await r.text()); },
  write: async text => { const r = await odfetch(`${FILE}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }); if (!r.ok) throw new Error('OneDrive write failed (' + r.status + ')'); },
  writeExtra: async (name, text) => { const r = await odfetch(`${name}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }); if (!r.ok) throw new Error('OneDrive backup write failed (' + r.status + ')'); },
  readExtra: async name => { const r = await odfetch(`${name}:/content`); if (r.status === 404) return null; if (!r.ok) throw new Error('OneDrive read failed (' + r.status + ')'); return r.text(); },
  writeAux: async ({ name, text }) => { const r = await odfetch(`${name}:/content`, { method: 'PUT', headers: { 'Content-Type': 'text/calendar' }, body: text }); if (!r.ok) throw new Error('OneDrive feed write failed (' + r.status + ')'); },
  shareLink: async name => {
    const r = await odfetch(`${name}:/createLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'view', scope: 'anonymous' }) });
    if (!r.ok) throw new Error('OneDrive could not create a link (' + r.status + ')');
    const u = (await r.json()).link?.webUrl; if (!u) throw new Error('OneDrive did not return a link');
    return u + (u.includes('?') ? '&' : '?') + 'download=1';
  },
  signOut: () => microsoftSignOut(),
});

/* -------------------------------- WebDAV -------------------------------- */
// Any WebDAV folder (Nextcloud, ownCloud, Synology, Fastmail, Hetzner…). The server must allow this site's origin (CORS).
export const webdavAdapter = () => {
  const cfg = settings.webdav();
  const base = String(cfg.url || '').replace(/\/+$/, '');
  const url = name => base + '/' + encodeURIComponent(name);
  const headers = extra => ({ Authorization: 'Basic ' + btoa(`${cfg.user || ''}:${cfg.pass || ''}`), ...extra });
  let host = 'WebDAV'; try { host = new URL(base).host; } catch { /* label only */ }
  const explain = r => r.status === 401 ? 'WebDAV: wrong username or password' : r.status === 403 ? 'WebDAV: no permission for that folder' : `WebDAV ${r.status}`;
  return {
    id: 'webdav', label: `WebDAV (${host})`,
    ready: async () => !!(base && cfg.user),
    read: async () => {
      let r; try { r = await fetch(url(FILE), { headers: headers({}) }); } catch { throw new Error('WebDAV: the server did not answer or does not allow this site (CORS)'); }
      if (r.status === 404) return null; if (!r.ok) throw new Error(explain(r)); return parse(await r.text());
    },
    write: async text => { const r = await fetch(url(FILE), { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: text }).catch(() => { throw new Error('WebDAV: the server did not answer or does not allow this site (CORS)'); }); if (!r.ok) throw new Error(explain(r)); },
    writeExtra: async (name, text) => { const r = await fetch(url(name), { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: text }); if (!r.ok) throw new Error(explain(r)); },
    readExtra: async name => { const r = await fetch(url(name), { headers: headers({}) }); if (r.status === 404) return null; if (!r.ok) throw new Error(explain(r)); return r.text(); },
    writeAux: async ({ name, text }) => { const r = await fetch(url(name), { method: 'PUT', headers: headers({ 'Content-Type': 'text/calendar' }), body: text }); if (!r.ok) throw new Error(explain(r)); },
    signOut: () => settings.setWebdav(null),
  };
};

export function microsoftSignOut() { try { const app = msApp; if (app) app.getAllAccounts().forEach(a => app.logoutPopup({ account: a }).catch(() => {})); } catch { /* ignore */ } }

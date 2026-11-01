// Cloud storage adapters. Each exposes: name, ready() -> bool, read() -> object|null, write(text).
// Dropbox, Google and Microsoft sign in through Vdex's own registered apps (js/cloud-config.js), so people only see
// the service's normal sign-in page. A developer can still use an app of their own instead (Advanced); that key is
// kept on this device only and wins over the built-in one.
import { CLOUD_APPS } from './cloud-config.js';
import { toast } from './util.js';

const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const OWN = { dropbox: 'logi-dropbox-key', google: 'logi-gdrive-id', microsoft: 'logi-ms-id' };
const own = svc => (LS.get(OWN[svc]) || '').trim();
const builtIn = svc => String(CLOUD_APPS[svc] || '').trim();
// Can this service be connected here, and through whose app?
export const signIn = {
  available: svc => !!(own(svc) || builtIn(svc)),
  builtIn: svc => !!builtIn(svc),
  usingOwn: svc => !!own(svc),
};
export const settings = {
  dropboxKey: () => own('dropbox') || builtIn('dropbox'),
  gdriveId: () => own('google') || builtIn('google'),
  msId: () => own('microsoft') || builtIn('microsoft'),
  ownDropboxKey: () => own('dropbox'), ownGdriveId: () => own('google'), ownMsId: () => own('microsoft'),
  webdav: () => { try { return JSON.parse(LS.get('logi-webdav')) || {}; } catch { return {}; } },
  setWebdav: v => v ? LS.set('logi-webdav', JSON.stringify(v)) : LS.del('logi-webdav'),
  setMsId: v => (v.trim() ? LS.set('logi-ms-id', v.trim()) : LS.del('logi-ms-id')),
  setDropboxKey: v => (v.trim() ? LS.set('logi-dropbox-key', v.trim()) : LS.del('logi-dropbox-key')),
  setGdriveId: v => (v.trim() ? LS.set('logi-gdrive-id', v.trim()) : LS.del('logi-gdrive-id')),
};
// Where a sign-in comes back to. With Vdex's own apps it is always the app's folder (…/Logi-Video-Production-app-/,
// or http://localhost:47831/ in the desktop app), however the app was opened, so only those two addresses have to be
// registered. A developer's own app keeps the address the page was opened at, as it always did.
export const redirectUri = svc => (svc && !own(svc) ? new URL('./', location.href).href : location.origin + location.pathname);
const notOn = name => new Error(`${name} sign-in is not switched on in this copy of Vdex yet. Whoever looks after Vdex turns it on once (see “Turning on sign-in” in the guide), or use your own developer app under Advanced.`);
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
const pkce = async () => { const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))); return { verifier, challenge: b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))) }; };
// A sign-in page opens in place in the browser, and in the person's own web browser from the desktop app (Dropbox,
// Google and Microsoft ask apps not to show their sign-in pages inside an app window); the desktop app hands the
// answer back. Returns 'browser' when the sign-in carries on in the web browser.
// The desktop app's sign-ins are registered at its usual address; on a stand-in port they would be refused.
const desktopAway = () => window.vdexDesktop && location.port && location.port !== '47831';
const AWAY = 'Sign-in needs Vdex at its usual address. Another program is using it right now: close that program, reopen Vdex, and try again.';
async function openSignIn(url) {
  if (desktopAway()) throw new Error(AWAY);
  if (window.vdexDesktop?.openSignIn) { await window.vdexDesktop.openSignIn(url); return 'browser'; }
  location.href = url; return 'page';
}

export async function dropboxBegin() {
  const key = settings.dropboxKey();
  if (!key) throw notOn('Dropbox');
  const redirect = redirectUri('dropbox');
  LS.set('logi-dbx-redirect', redirect); // the token exchange has to name the same address
  const { verifier, challenge } = await pkce();
  LS.set('logi-dbx-verifier', verifier);
  const state = 'vdex-' + b64url(crypto.getRandomValues(new Uint8Array(16))); // random, checked on return (no cross-site login injection)
  LS.set('logi-dbx-state', state);
  LS.set('logi-dbx-client', key); // refreshes keep using the app this sign-in was made with
  const q = new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: redirect, state });
  return openSignIn('https://www.dropbox.com/oauth2/authorize?' + q);
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
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: dropboxClient(), code_verifier: LS.get('logi-dbx-verifier') || '', redirect_uri: LS.get('logi-dbx-redirect') || redirectUri('dropbox') }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(t.error_description || 'Dropbox sign-in could not be finished; try Connect again');
  LS.del('logi-dbx-verifier'); LS.del('logi-dbx-redirect');
  LS.set('logi-dbx-token', JSON.stringify({ refresh: t.refresh_token, access: t.access_token, exp: Date.now() + t.expires_in * 1000 - 60000, client: dropboxClient() }));
  dropboxWho().catch(() => {});
  return true;
}

const dropboxClient = () => LS.get('logi-dbx-client') || settings.dropboxKey();
async function dropboxToken() {
  let t; try { t = JSON.parse(LS.get('logi-dbx-token')); } catch { /* none */ }
  if (!t) throw new Error('Not signed in to Dropbox');
  if (t.exp > Date.now()) return t.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.client || dropboxClient() }) });
  const n = await r.json();
  if (!r.ok) { if (r.status === 400 || r.status === 401) LS.del('logi-dbx-token'); const e = new Error('Dropbox wants you to sign in again'); e.name = 'NotAllowedError'; throw e; } // revoked or expired: sign in again
  t.access = n.access_token; t.exp = Date.now() + n.expires_in * 1000 - 60000;
  LS.set('logi-dbx-token', JSON.stringify(t));
  return t.access;
}

// Who is signed in, shown in the storage panel so people can see it is their own account.
export const who = () => LS.get('logi-cloud-who') || '';
const setWho = v => (v ? LS.set('logi-cloud-who', v) : LS.del('logi-cloud-who'));
async function dropboxWho() {
  const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: { Authorization: 'Bearer ' + await dropboxToken() } });
  if (!r.ok) return '';
  const j = await r.json(); const v = [j.name?.display_name, j.email].filter(Boolean).join(' · '); setWho(v); return v;
}
export const dropboxAdapter = () => ({
  id: 'dropbox', label: 'Dropbox', where: 'the folder Apps › Vdex',
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
  signOut: () => { LS.del('logi-dbx-token'); LS.del('logi-dbx-client'); setWho(''); },
});

/* ----------------------------- Google Drive ----------------------------- */
let gisPromise; const gTokens = {}; // one token per scope set
export const loadGIS = () => gisPromise || (gisPromise = new Promise((res, rej) => {
  if (window.google?.accounts?.oauth2) return res();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.append(s);
}));

// Google gives a browser app an hour per sign-in and no way to renew it silently, so a renewal needs one tap. To keep
// that to one window, a renewal asks for every scope this device was granted before (Drive and Calendar together),
// and names the account (login_hint) so Google skips the account chooser and the window can close by itself.
const grantedScopes = () => new Set((LS.get('logi-google-scopes') || '').split(' ').filter(Boolean));
const liveToken = scopeStr => { // one token that covers every scope in the string, if there is one
  const parts = scopeStr.split(' ').filter(Boolean), first = gTokens[parts[0]];
  return first && first.exp > Date.now() && parts.every(p => gTokens[p] && gTokens[p].value === first.value) ? first.value : null;
};
export async function googleToken(scope, interactive) {
  const have = liveToken(scope);
  if (have) return have;
  if (!interactive) throw new Error('Google wants you to sign in again — tap Sign in again');
  const id = settings.gdriveId();
  if (!id) throw notOn('Google');
  const wanted = [...new Set([...scope.split(' ').filter(Boolean), ...grantedScopes()])], hint = LS.get('logi-google-email');
  const take = (r, res, rej) => {
    if (r.error) return rej(new Error(GOOGLE_ERR[r.error] || r.error_description || r.error));
    const got = new Set(String(r.scope || wanted.join(' ')).split(' ').filter(Boolean));
    if (scope.split(' ').some(p => !got.has(p))) return rej(new Error('Google did not give Vdex the permission it needs. Tap Connect again and leave the boxes ticked.'));
    const t = { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 - 60000 };
    for (const g of got) gTokens[g] = t;
    LS.set('logi-google-scopes', [...new Set([...grantedScopes(), ...got])].join(' '));
    LS.set('logi-gdrive-on', '1');
    res(r.access_token);
  };
  // The desktop app: Google's page opens in the web browser and the answer comes back to the app.
  if (window.vdexDesktop?.googleSignIn) {
    if (desktopAway()) throw new Error(AWAY);
    toast('Finish signing in to Google in your web browser, then come back here');
    const r = await window.vdexDesktop.googleSignIn({ client: id, scope: wanted.join(' '), hint });
    return new Promise((res, rej) => take(r || { error: 'failed' }, res, rej));
  }
  await loadGIS();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: id, scope: wanted.join(' '),
      callback: r => take(r, res, rej),
      error_callback: e => rej(new Error(GOOGLE_ERR[e.type] || e.type || 'Google sign-in blocked')),
    });
    client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' });
  });
}
const GOOGLE_ERR = { access_denied: 'Google sign-in was cancelled', popup_closed: 'The Google window was closed before signing in', popup_failed_to_open: 'The Google window was blocked. Allow pop-ups for Vdex and tap again', timed_out: 'The Google sign-in in your web browser was not finished. Tap again to retry.', failed: 'Google sign-in did not work. Tap again to retry.' };
export const forgetGoogleToken = scope => { for (const p of scope.split(' ')) delete gTokens[p]; };
const DRIVE_APP = 'https://www.googleapis.com/auth/drive.appdata', DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
const driveScope = () => LS.get('logi-feed-drive') === '1' ? DRIVE_APP + ' ' + DRIVE_FILE : DRIVE_APP;
const gdriveToken = interactive => googleToken(driveScope(), interactive);
const hasToken = () => !!liveToken(driveScope());
// The account, for the panel and for skipping Google's account chooser next time.
async function googleWho(token) {
  try { const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return; const u = (await r.json()).user || {}; if (u.emailAddress) LS.set('logi-google-email', u.emailAddress); setWho([u.displayName, u.emailAddress].filter(Boolean).join(' · ')); } catch { /* name only */ }
}

async function gfetch(url, init = {}, interactive = false) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await gdriveToken(interactive) } });
  if (r.status === 401) { forgetGoogleToken(driveScope()); const e = new Error('Google wants you to sign in again'); e.name = 'NotAllowedError'; throw e; }
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
    id: 'gdrive', label: 'Google Drive', where: 'a private Vdex area of your Google Drive',
    // Tokens last an hour and can't be refreshed silently by the browser, so ask on a user gesture when expired.
    ready: async ask => { if (hasToken()) return true; if (!ask) return false; const t = await gdriveToken(true); if (!LS.get('logi-google-email') || !who()) googleWho(t); return true; },
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
    signOut: () => { forgetGoogleToken(driveScope()); LS.del('logi-gdrive-file'); LS.del('logi-gdrive-feed'); LS.del('logi-gdrive-on'); LS.del('logi-google-email'); setWho(''); const left = [...grantedScopes()].filter(g => !g.includes('/auth/drive')); left.length ? LS.set('logi-google-scopes', left.join(' ')) : LS.del('logi-google-scopes'); },
  };
};

/* ------------------------------ Microsoft 365 ------------------------------ */
// Sign-in with the authorization code flow and PKCE, by going to Microsoft's page and back, as with Dropbox: no library
// and no pop-up window. Microsoft keeps such a sign-in for 24 hours from when it was made; after that, one tap on
// "Sign in again" goes to Microsoft and straight back while the person is still signed in there.
const MS = 'https://login.microsoftonline.com/common/oauth2/v2.0/';
export const MS_FILES = 'Files.ReadWrite.AppFolder', MS_CAL = 'Calendars.ReadWrite';
const msTok = () => { try { return JSON.parse(LS.get('logi-ms-token')) || null; } catch { return null; } };
const msSave = t => (t ? LS.set('logi-ms-token', JSON.stringify(t)) : LS.del('logi-ms-token'));
const msKey = scopes => [...scopes].sort().join(' ');
const claims = jwt => { try { return JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; } };
const msError = (code, text = '') => {
  if (code === 'access_denied' || /AADSTS65004|declined/i.test(text)) return 'Microsoft sign-in was cancelled';
  if (/AADSTS90094|AADSTS90095|admin/i.test(text)) return 'Your work or school account needs your IT department to approve Vdex first. A personal Microsoft account works straight away.';
  return text ? 'Microsoft sign-in did not work: ' + text.split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, '') : 'Microsoft sign-in did not work; try Connect again';
};
// Go to Microsoft to sign in. `intent` says what to finish on the way back: 'onedrive' or 'calendar'.
export async function microsoftBegin(scopes, intent) {
  const id = settings.msId(); if (!id) throw notOn('Microsoft');
  const { verifier, challenge } = await pkce();
  const state = 'vdexms-' + b64url(crypto.getRandomValues(new Uint8Array(16)));
  const t = msTok(), all = [...new Set([...scopes, ...((t && t.scopes) || [])])]; // keep what was granted before
  LS.set('logi-ms-pkce', JSON.stringify({ verifier, state, redirect: redirectUri('microsoft'), client: id, intent, scopes, first: !(t && t.username) }));
  const q = new URLSearchParams({ client_id: id, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri('microsoft'), scope: ['openid', 'profile', 'offline_access', ...all].join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' });
  if (t && t.username) q.set('login_hint', t.username); else q.set('prompt', 'select_account');
  return openSignIn(MS + 'authorize?' + q);
}
// On page load: finish a Microsoft sign-in that has come back. Returns the intent, or false when there was none.
export async function microsoftFinish() {
  const p = new URLSearchParams(location.search), state = p.get('state');
  if (!state || !state.startsWith('vdexms-')) return false;
  history.replaceState(null, '', location.pathname);
  let pk = null; try { pk = JSON.parse(LS.get('logi-ms-pkce')); } catch { /* none */ }
  LS.del('logi-ms-pkce');
  const fail = msg => { const e = new Error(msg); e.intent = pk && pk.intent; e.first = !!(pk && pk.first); return e; };
  if (!pk || pk.state !== state) throw fail('Microsoft sign-in did not come from this device; try again');
  if (!p.get('code')) throw fail(msError(p.get('error'), p.get('error_description') || ''));
  const r = await fetch(MS + 'token', { method: 'POST', body: new URLSearchParams({ client_id: pk.client, grant_type: 'authorization_code', code: p.get('code'), redirect_uri: pk.redirect, code_verifier: pk.verifier, scope: ['openid', 'profile', 'offline_access', ...pk.scopes].join(' ') }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(msError(j.error, j.error_description));
  const c = claims(j.id_token || ''), granted = String(j.scope || '').split(' ').filter(x => /\./.test(x) || /^[A-Z]/.test(x));
  const prev = msTok() || {};
  msSave({ client: pk.client, refresh: j.refresh_token, scopes: [...new Set([...(prev.scopes || []), ...pk.scopes])], username: c.preferred_username || prev.username || '', name: c.name || prev.name || '', access: { [msKey(pk.scopes)]: { value: j.access_token, exp: Date.now() + j.expires_in * 1000 - 60000 } } });
  if (pk.intent === 'onedrive') setWho([c.name, c.preferred_username].filter(Boolean).join(' · '));
  return pk.intent || 'onedrive';
}
// A token for these Graph permissions: from the store, by refreshing, or (interactive) by signing in again.
export async function microsoftToken(scopes, interactive, intent = 'onedrive') {
  const t = msTok(), key = msKey(scopes);
  const have = t && t.access && t.access[key];
  if (have && have.exp > Date.now()) return have.value;
  if (t && t.refresh) {
    const r = await fetch(MS + 'token', { method: 'POST', body: new URLSearchParams({ client_id: t.client, grant_type: 'refresh_token', refresh_token: t.refresh, scope: ['offline_access', ...scopes].join(' ') }) }).catch(() => null);
    if (r && r.ok) { const j = await r.json(); msSave({ ...t, refresh: j.refresh_token || t.refresh, access: { ...(t.access || {}), [key]: { value: j.access_token, exp: Date.now() + j.expires_in * 1000 - 60000 } } }); return j.access_token; }
    if (r && r.status >= 400 && r.status < 500) { const j = await r.json().catch(() => ({})); if (!/AADSTS65001|consent_required/.test(`${j.error} ${j.error_description}`)) msSave({ ...t, refresh: null, access: {} }); } // the 24 hours are up, or it was withdrawn; a missing consent keeps the rest
    else if (!r) throw new Error('Microsoft could not be reached; check the connection');
  }
  if (!interactive) { const e = new Error('Microsoft wants you to sign in again'); e.name = 'NotAllowedError'; throw e; }
  if ((await microsoftBegin(scopes, intent)) === 'browser') { const e = new Error('Finish signing in to Microsoft in your web browser, then come back here'); e.name = 'NotAllowedError'; e.handoff = true; throw e; }
  return new Promise(() => {}); // the page is on its way to Microsoft
}
export const microsoftAccount = () => { const t = msTok(); return t ? { name: t.name, username: t.username } : null; };
/* ------------------------------- OneDrive ------------------------------- */
// Microsoft Graph, app folder only (Files.ReadWrite.AppFolder): Vdex sees nothing but its own folder.
const OD = 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/';
async function odfetch(path, init = {}, interactive = false) {
  const token = await microsoftToken([MS_FILES], interactive);
  const r = await fetch(OD + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401) { const e = new Error('Microsoft wants you to sign in again'); e.name = 'NotAllowedError'; throw e; }
  return r;
}
export const onedriveAdapter = () => ({
  id: 'onedrive', label: 'OneDrive', where: 'the folder Apps › Vdex',
  ready: async ask => { try { await microsoftToken([MS_FILES], ask); return true; } catch (e) { if (ask && (e.name !== 'NotAllowedError' || e.handoff)) throw e; return false; } },
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
  signOut: o => microsoftSignOut(o),
});

/* -------------------------------- WebDAV -------------------------------- */
// Any WebDAV folder (Nextcloud, ownCloud, Synology, Fastmail, Hetzner…). The server must allow this site's origin (CORS).
// For Nextcloud and ownCloud only the server's address is needed: the folder is files/<username>/Vdex, made on connect.
export const webdavFolder = (cfg = settings.webdav()) => {
  const raw = String(cfg.url || '').trim().replace(/\/+$/, '');
  if (cfg.kind !== 'nextcloud') return raw;
  let origin = raw; try { const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); origin = u.origin + u.pathname.replace(/\/(index\.php.*|remote\.php.*|apps\/.*)?$/, '').replace(/\/+$/, ''); } catch { return ''; }
  return `${origin}/remote.php/dav/files/${encodeURIComponent(cfg.user || '')}/Vdex`;
};
export const webdavAdapter = () => {
  const cfg = settings.webdav();
  const base = webdavFolder(cfg);
  const url = name => base + '/' + encodeURIComponent(name);
  const headers = extra => ({ Authorization: 'Basic ' + btoa(`${cfg.user || ''}:${cfg.pass || ''}`), ...extra });
  let host = 'WebDAV'; try { host = new URL(base).host; } catch { /* label only */ }
  const explain = r => r.status === 401 ? 'WebDAV: wrong username or password' : r.status === 403 ? 'WebDAV: no permission for that folder' : `WebDAV ${r.status}`;
  return {
    id: 'webdav', label: cfg.kind === 'nextcloud' ? `Nextcloud (${host})` : `WebDAV (${host})`, where: cfg.kind === 'nextcloud' ? 'the folder Vdex in your files' : 'the folder you gave',
    ready: async () => !!(base && cfg.user),
    // Make the folder if it is not there yet: 201 made, 405 already there. A server that refuses is told about on the first read.
    ensureFolder: async () => { try { await fetch(base + '/', { method: 'MKCOL', headers: headers({}) }); } catch { /* the read below explains */ } },
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

// Forget this device's Microsoft sign-in (the calendar link uses it too, so keep it while that is connected).
export function microsoftSignOut({ keepToken = false } = {}) { setWho(''); if (!keepToken) msSave(null); }

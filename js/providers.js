// Cloud storage adapters. Each exposes: name, ready() -> bool, read() -> object|null, write(text).
// Dropbox, Google and Microsoft sign in through Vdex's own registered apps (js/cloud-config.js), so people only see
// the service's normal sign-in page. A developer can still use an app of their own instead (More ways → For developers); that key is
// kept on this device only and wins over the built-in one.
import { CLOUD_APPS } from './cloud-config.js';
import { toast } from './util.js';
import * as native from './native.js';

const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const OWN = { dropbox: 'logi-own-dropbox', google: 'logi-own-google', microsoft: 'logi-own-microsoft' };
// The old "paste your key" boxes saved on every keystroke, so a half-finished attempt could leave a wrong key behind.
// Keep an old key only where a sign-in was actually made with it; otherwise the built-in apps are used.
(() => {
  const OLD = { dropbox: 'logi-dropbox-key', google: 'logi-gdrive-id', microsoft: 'logi-ms-id' };
  const used = { dropbox: () => !!LS.get('logi-dbx-token'), google: () => LS.get('logi-gdrive-on') === '1', microsoft: () => LS.get('logi-provider') === 'onedrive' }; // an old Microsoft cache alone proves nothing
  for (const [svc, k] of Object.entries(OLD)) { const v = (LS.get(k) || '').trim(); if (v && used[svc]() && !LS.get(OWN[svc])) LS.set(OWN[svc], v); LS.del(k); }
})();
const own = svc => (LS.get(OWN[svc]) || '').trim();
const builtIn = svc => String(CLOUD_APPS[svc] || '').trim();
// Can this service be connected here, and through whose app?
const icloudCfg = () => CLOUD_APPS.icloud || {};
export const signIn = {
  available: svc => (svc === 'icloud' ? !!(icloudCfg().container && (window.vdexDesktop ? icloudCfg().desktopToken : icloudCfg().apiToken)) : svc === 'google-calendar' ? !!(own('google') || (builtIn('google') && CLOUD_APPS.googleCalendar !== false)) : !!(own(svc) || builtIn(svc))),
  builtIn: svc => !!builtIn(svc),
  usingOwn: svc => !!own(svc),
  // Which app the current Dropbox sign-in was made with: devices only share a copy when they use the same one.
  dropboxOwn: () => { try { const t = JSON.parse(LS.get('logi-dbx-token')); return !!(t && t.client && t.client !== builtIn('dropbox')); } catch { return false; } },
};
export const settings = {
  dropboxKey: () => own('dropbox') || builtIn('dropbox'),
  gdriveId: () => own('google') || builtIn('google'),
  msId: () => own('microsoft') || builtIn('microsoft'),
  ownDropboxKey: () => own('dropbox'), ownGdriveId: () => own('google'), ownMsId: () => own('microsoft'),
  webdav: () => { try { return JSON.parse(LS.get('logi-webdav')) || {}; } catch { return {}; } },
  setWebdav: v => v ? LS.set('logi-webdav', JSON.stringify(v)) : LS.del('logi-webdav'),
  setMsId: v => (v.trim() ? LS.set(OWN.microsoft, v.trim()) : LS.del(OWN.microsoft)),
  setDropboxKey: v => (v.trim() ? LS.set(OWN.dropbox, v.trim()) : LS.del(OWN.dropbox)),
  setGdriveId: v => (v.trim() ? LS.set(OWN.google, v.trim()) : LS.del(OWN.google)),
};
// Where a sign-in comes back to. With Vdex's own apps it is always the app's folder (…/Logi-Video-Production-app-/,
// or http://localhost:47831/ in the desktop app), however the app was opened, so only those two addresses have to be
// registered. A developer's own app keeps the address the page was opened at, as it always did.
export const redirectUri = svc => (svc && !own(svc) ? new URL('./', location.href).href : location.origin + location.pathname);
const notOn = name => new Error(`${name} sign-in isn't ready in Vdex yet. Until it is, use More ways to keep a copy, or save a backup file.`);
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
const STALE = name => `That ${name} sign-in was out of date, perhaps because Connect was tapped twice. Tap Connect once more and finish only the newest sign-in page.`;
const pkce = async () => { const verifier = b64url(crypto.getRandomValues(new Uint8Array(48))); return { verifier, challenge: b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))) }; };
// A sign-in page opens in place in the browser, and in the person's own web browser from the desktop app (Dropbox,
// Google and Microsoft ask apps not to show their sign-in pages inside an app window); the desktop app hands the
// answer back. Returns 'browser' when the sign-in carries on in the web browser.
// The desktop app's sign-ins are registered at its usual address; on a stand-in port they would be refused.
const desktopAway = () => window.vdexDesktop && location.port && location.port !== '47831';
const AWAY = 'Vdex can’t open the sign-in page because another program on this computer is using the connection Vdex needs. Restart the computer, open Vdex first, and try again. Until then, More ways to keep a copy still work.';
// The iPhone app: the page opens in the phone's own sign-in window (js/native.js), the service's answer comes back
// on the vdex:// address (js/return.js hands it over from the window), and this page opens it as if the service had
// sent it here, so the finishers below run exactly as on the website.
async function openSignIn(url) {
  if (desktopAway()) throw new Error(AWAY);
  if (window.vdexDesktop?.openSignIn) { if (!(await window.vdexDesktop.openSignIn(url))) throw new Error(AWAY); return 'browser'; }
  if (native.auth.available()) { location.href = await cameBack(url); return 'page'; }
  location.href = url; return 'page';
}
const CLOSED = () => { const e = new Error('The sign-in was closed before it finished. Tap Connect when you are ready to try again.'); e.name = 'AbortError'; return e; };
async function cameBack(url) {
  const back = await native.auth.start(url);
  if (!back) throw CLOSED();
  const i = back.indexOf('?');
  return location.origin + location.pathname + (i >= 0 ? back.slice(i) : '');
}
const APP_MARK = () => (native.auth.available() ? '~app' : ''); // on the state of a sign-in the app started: js/return.js knows it by this

export async function dropboxBegin() {
  const key = settings.dropboxKey();
  if (!key) throw notOn('Dropbox');
  const redirect = redirectUri('dropbox');
  LS.set('logi-dbx-redirect', redirect); // the token exchange has to name the same address
  const { verifier, challenge } = await pkce();
  LS.set('logi-dbx-verifier', verifier);
  const state = 'vdex-' + b64url(crypto.getRandomValues(new Uint8Array(16))) + APP_MARK(); // random, checked on return (no cross-site login injection)
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
  if (!expected || state !== expected) throw new Error(STALE('Dropbox'));
  const code = p.get('code');
  if (!code) throw new Error(p.get('error') === 'access_denied' ? 'Dropbox sign-in was cancelled. Tap Connect when you’re ready to try again.' : 'Dropbox sign-in didn’t finish. Tap Connect to try again.');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: dropboxClient(), code_verifier: LS.get('logi-dbx-verifier') || '', redirect_uri: LS.get('logi-dbx-redirect') || redirectUri('dropbox') }),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Dropbox sign-in didn’t finish. Tap Connect to try again.');
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
// Tokens are kept for their hour across visits, so reopening Vdex within the hour needs no tap; the lock seals them.
let gisPromise; const gTokens = (() => { try { return JSON.parse(LS.get('logi-google-tokens')) || {}; } catch { return {}; } })();
const saveGTokens = () => { const now = Date.now(), keep = Object.fromEntries(Object.entries(gTokens).filter(([, t]) => t && t.exp > now)); Object.keys(gTokens).forEach(k => { if (!keep[k]) delete gTokens[k]; }); Object.keys(keep).length ? LS.set('logi-google-tokens', JSON.stringify(keep)) : LS.del('logi-google-tokens'); };
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
  if (!interactive) { const e = new Error('Google wants you to sign in again'); e.name = 'NotAllowedError'; throw e; }
  const id = settings.gdriveId();
  if (!id) throw notOn('Google');
  const wanted = [...new Set([...scope.split(' ').filter(Boolean), ...grantedScopes()])], hint = LS.get('logi-google-email');
  const take = (r, res, rej) => {
    if (r.error === 'replaced') { const e = new Error('A newer sign-in took over'); e.name = 'AbortError'; return rej(e); } // Connect was tapped again: the new one carries on
    if (r.error) return rej(new Error(GOOGLE_ERR[r.error] || r.error_description || r.error));
    const got = new Set(String(r.scope || wanted.join(' ')).split(' ').filter(Boolean));
    if (scope.split(' ').some(p => !got.has(p))) return rej(new Error('Google didn’t give Vdex the permission it needs. Try again and leave the boxes ticked.'));
    const t = { value: r.access_token, exp: Date.now() + Number(r.expires_in || 3600) * 1000 - 60000 };
    for (const g of got) gTokens[g] = t;
    saveGTokens();
    LS.set('logi-google-scopes', [...new Set([...grantedScopes(), ...got])].join(' '));
    LS.set('logi-gdrive-on', '1');
    res(r.access_token);
  };
  // The desktop app: Google's page opens in the web browser and the answer comes back to the app.
  if (window.vdexDesktop?.googleSignIn) {
    if (desktopAway()) throw new Error(AWAY);
    toast('Carry on in your web browser: sign in to Google there, then come back to Vdex.');
    const r = await window.vdexDesktop.googleSignIn({ client: id, scope: wanted.join(' '), hint });
    return new Promise((res, rej) => take(r || { error: 'failed' }, res, rej));
  }
  // The iPhone app: Google's sign-in on Vdex's own page (signin-google.html) in the phone's sign-in window, which
  // Google accepts; the answer comes back on the vdex:// address.
  if (native.auth.available()) {
    const q = new URLSearchParams({ client: id, scope: wanted.join(' '), ...(hint ? { hint } : {}) });
    const back = await native.auth.start(`${location.origin}${location.pathname.replace(/[^/]*$/, '')}signin-google.html?${q}`);
    if (!back) throw CLOSED();
    const r = Object.fromEntries(new URL(back).searchParams);
    return new Promise((res, rej) => take(r, res, rej));
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
const GOOGLE_ERR = { address_taken: 'Vdex can’t open the sign-in page because another program on this computer is using the connection Vdex needs. Restart the computer, open Vdex first, and try again. Until then, More ways to keep a copy still work.', access_denied: 'Google sign-in was cancelled', popup_closed: 'The Google window was closed before signing in', popup_failed_to_open: 'The Google window was blocked. Allow pop-ups for Vdex and tap again', timed_out: 'The Google sign-in in your web browser wasn’t finished. Tap Connect to try again.', failed: 'Google sign-in did not work. Tap again to retry.' };
export const forgetGoogleToken = scope => { for (const p of scope.split(' ')) delete gTokens[p]; saveGTokens(); };
const DRIVE_APP = 'https://www.googleapis.com/auth/drive.appdata', DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
// Storage needs only Vdex's private area (drive.appdata); the calendar feed's visible file asks for drive.file on its own.
const gdriveToken = (interactive, scope = DRIVE_APP) => googleToken(scope, interactive);
const hasToken = () => !!liveToken(DRIVE_APP);
// The account, for the panel and for skipping Google's account chooser next time.
async function googleWho(token) {
  try { const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return; const u = (await r.json()).user || {}; if (u.emailAddress) LS.set('logi-google-email', u.emailAddress); setWho([u.displayName, u.emailAddress].filter(Boolean).join(' · ')); } catch { /* name only */ }
}

async function gfetch(url, init = {}, interactive = false, scope = DRIVE_APP) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await gdriveToken(interactive, scope) } });
  if (r.status === 401) { forgetGoogleToken(scope); const e = new Error('Google wants you to sign in again'); e.name = 'NotAllowedError'; throw e; }
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
    enableFeed: async () => { await gdriveToken(true, DRIVE_FILE); LS.set('logi-feed-drive', '1'); }, // only once Google has said yes
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
      if (!fid) { const r = await gfetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`name='${name}' and trashed=false`)}&fields=files(id)`, {}, false, DRIVE_FILE); fid = (await r.json()).files?.[0]?.id || null; }
      let r;
      if (fid) r = await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/calendar' }, body: text }, false, DRIVE_FILE);
      else {
        const boundary = 'logi' + Date.now();
        r = await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ name, mimeType: 'text/calendar' })}\r\n--${boundary}\r\nContent-Type: text/calendar\r\n\r\n${text}\r\n--${boundary}--` }, false, DRIVE_FILE);
        if (r.ok) fid = (await r.json()).id;
      }
      if (!r.ok) throw new Error('Drive feed write failed (' + r.status + ')');
      LS.set('logi-gdrive-feed', fid);
    },
    shareLink: async () => {
      const fid = LS.get('logi-gdrive-feed'); if (!fid) throw new Error('The feed file has not been written yet — add or edit a booking first');
      const r = await gfetch(`https://www.googleapis.com/drive/v3/files/${fid}/permissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) }, true, DRIVE_FILE);
      if (!r.ok) throw new Error('Could not share the feed file (' + r.status + ')');
      return `https://drive.google.com/uc?export=download&id=${fid}`;
    },
    signOut: () => { forgetGoogleToken(DRIVE_APP + ' ' + DRIVE_FILE); LS.del('logi-gdrive-file'); LS.del('logi-gdrive-feed'); LS.del('logi-feed-drive'); LS.del('logi-gdrive-on'); LS.del('logi-google-email'); setWho(''); const left = [...grantedScopes()].filter(g => !g.includes('/auth/drive')); left.length ? LS.set('logi-google-scopes', left.join(' ')) : LS.del('logi-google-scopes'); },
  };
};

/* --------------------------------- iCloud --------------------------------- */
// iCloud through Apple's CloudKit web service, called directly: the same requests Apple's CloudKit JS makes, without
// loading Apple's script into Vdex. The copy is a record in Vdex's own container in the person's private iCloud
// database: only they can read it, it counts toward their iCloud storage, and it is not a file in iCloud Drive.
// Signing in happens on Apple's own page. The website goes there and back, as with Dropbox (Apple's pop-up window is
// unreliable on iPhone and iPad); the desktop app opens it in the web browser. Apple hands back a web session, which
// changes with every request; it lasts two weeks when "Keep me signed in" is ticked, otherwise 30 minutes.
const CK_SESSION = 'logi-icloud-session'; // sealed by the lock like the other sign-ins
const CK_PENDING = 'logi-icloud-pending'; // set just before going to Apple: only a sign-in Vdex started is accepted back
const CK_TYPE = 'VdexFile';               // the record type the publisher sets up once (docs/turn-on-sign-in.md)
const CK_PART = 700000;                   // bytes of text per record: CloudKit allows 1 MB a record
const ck = () => CLOUD_APPS.icloud || {};
// The website and the desktop app each have their own API token: Apple sends the website's sign-ins back to the website.
const ckToken = () => String((window.vdexDesktop ? ck().desktopToken : ck().apiToken) || '').trim();
const ckBase = db => `https://api.apple-cloudkit.com/database/1/${encodeURIComponent(ck().container)}/${ck().environment === 'development' ? 'development' : 'production'}/${db}/`;
const CK_WORDS = {
  QUOTA_EXCEEDED: 'Your iCloud storage is full. Free up some space in iCloud, or choose another way to keep a copy',
  THROTTLED: 'iCloud is busy. Vdex will try again shortly', TRY_AGAIN_LATER: 'iCloud is busy. Vdex will try again shortly', SERVICE_UNAVAILABLE: 'iCloud is not answering right now. Vdex will try again shortly',
  ZONE_NOT_FOUND: 'iCloud isn’t set up for this Apple ID yet. Turn on iCloud on one of your Apple devices, then try again',
  AUTHENTICATION_FAILED: 'iCloud didn’t accept Vdex’s app details. The Vdex publisher needs to check the iCloud set-up',
  ACCESS_DENIED: 'iCloud didn’t let Vdex in. If you use Advanced Data Protection, turn on Access iCloud Data on the Web (iPhone Settings → your name → iCloud), then sign in again',
};
const ckError = (j, status) => Object.assign(new Error(CK_WORDS[j?.serverErrorCode] || ('iCloud said: ' + (j?.reason || j?.serverErrorCode || 'error ' + status))), { code: j?.serverErrorCode || '' });
const ckSignedOut = redirect => { const e = new Error('iCloud wants you to sign in again'); e.name = 'NotAllowedError'; e.redirectURL = redirect; return e; };
// One request at a time: each answer carries the session for the next request. The newest session is saved at once
// (and the lock told, so its sealed copy keeps up). If the lock cleared it while a request was out, the new one is
// kept here and put back in place of the used one when the lock opens again; a sign-out in between drops it.
let ckChain = Promise.resolve(), ckHeld = null, ckEpoch = 0, ckFullAddress = false;
const ckSave = v => { LS.set(CK_SESSION, v); dispatchEvent(new Event('vdex-secrets')); };
function ckRequest(db, path, body) {
  const run = async () => {
    let session = LS.get(CK_SESSION);
    if (ckHeld && session === ckHeld.used) { session = ckHeld.next; ckSave(session); }
    ckHeld = null;
    const epoch = ckEpoch, q = new URLSearchParams({ ckAPIToken: ckToken() });
    if (session) q.set('ckWebAuthToken', session);
    let r;
    const ref = { referrerPolicy: ckFullAddress ? 'no-referrer-when-downgrade' : 'strict-origin-when-cross-origin' }; // the app's sign-in sends this page's full address (see appleSignInAddress)
    try { r = await fetch(ckBase(db) + path + '?' + q, body === undefined ? { credentials: 'omit', ...ref } : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), credentials: 'omit', ...ref }); }
    catch { throw new Error('Could not reach iCloud. Check the connection and try again'); }
    const next = r.headers.get('x-apple-cloudkit-web-auth-token') || r.headers.get('x-apple-cloudkit-session');
    if (next && session && epoch === ckEpoch) { const now = LS.get(CK_SESSION); if (now === session) ckSave(next); else if (now == null) ckHeld = { used: session, next }; }
    let j = null; try { j = await r.json(); } catch { /* not JSON */ }
    if (r.status === 421 || j?.serverErrorCode === 'AUTHENTICATION_REQUIRED') { if (session && LS.get(CK_SESSION) === (next || session)) LS.del(CK_SESSION); ckHeld = null; throw ckSignedOut(j?.redirectURL); }
    if (!r.ok) throw ckError(j, r.status);
    return j || {};
  };
  const p = ckChain.then(run, run); ckChain = p.catch(() => {}); return p;
}
// Apple's sign-in address comes from asking iCloud who is signed in (users/caller, as CloudKit JS 2.6 does), with no session.
// marked (the iPhone app): Apple sends the sign-in back to the address that asked for it, so for this one request the
// page's address carries the app's marker (?app=icloud), which js/return.js looks for in the sign-in window.
async function appleSignInAddress(marked = false) {
  if (marked) { history.replaceState(null, '', location.pathname + '?app=icloud'); ckFullAddress = true; }
  try { await ckRequest('public', 'users/caller'); } catch (e) { if (e.name === 'NotAllowedError' && e.redirectURL) return e.redirectURL; throw e; }
  finally { if (marked) { ckFullAddress = false; history.replaceState(null, '', location.pathname + location.hash); } }
  throw new Error('Apple sign-in didn’t start. Tap Connect to try again');
}
async function icloudSignIn() {
  if (!signIn.available('icloud')) throw notOn('iCloud');
  if (native.auth.available()) { // the iPhone app: Apple's page in the phone's sign-in window, and back here with the session
    const url = await appleSignInAddress(true);
    LS.set(CK_PENDING, String(Date.now()));
    location.href = await cameBack(url);
    const e = new Error('Going to Apple to sign in'); e.name = 'AbortError'; throw e;
  }
  if (window.vdexDesktop) { // the desktop app: Apple's page opens in the web browser and the answer comes back to the app
    if (desktopAway() || !window.vdexDesktop.icloudSignIn) throw new Error(AWAY);
    toast('Carry on in your web browser: sign in with your Apple ID there, then come back to Vdex.');
    const r = (await window.vdexDesktop.icloudSignIn({ container: ck().container, apiToken: ckToken(), environment: ck().environment || '' })) || { error: 'failed' };
    if (r.error === 'replaced') { const e = new Error('A newer sign-in took over'); e.name = 'AbortError'; throw e; }
    if (r.error || !r.ckSession) throw new Error(APPLE_ERR[r.error] || 'Apple sign-in didn’t finish. Tap Connect to try again');
    ckEpoch++; ckHeld = null; ckSave(String(r.ckSession)); return;
  }
  const url = await appleSignInAddress();
  LS.set(CK_PENDING, String(Date.now()));
  location.href = url; // Apple's page, then back to Vdex with the session: icloudFinish takes it from there
  const e = new Error('Going to Apple to sign in'); e.name = 'AbortError'; throw e;
}
const APPLE_ERR = { address_taken: AWAY, timed_out: 'The Apple sign-in in your web browser wasn’t finished. Tap Connect to try again' };
// Call on page load: takes the session Apple sends back (…/?ckWebAuthToken=…). Returns true when it did.
export function icloudFinish() {
  const raw = (location.search.match(/[?&](?:ckWebAuthToken|ckSession)=([^&]*)/) || [])[1]; // read as sent: a + in it is a +
  if (!raw) { LS.del(CK_PENDING); return false; } // any other visit ends the wait, so an abandoned sign-in leaves no window open
  history.replaceState(null, '', location.pathname + location.hash);
  let token; try { token = decodeURIComponent(raw); } catch { token = raw; }
  const started = Number(LS.get(CK_PENDING)) || 0; LS.del(CK_PENDING);
  // Only a sign-in started here in the last ten minutes: a link carrying someone else's session must not be taken.
  if (!started || Date.now() - started > 10 * 60e3) throw new Error('That iCloud sign-in wasn’t started here, or it took too long. Tap Connect next to iCloud to sign in.');
  ckEpoch++; ckHeld = null; ckSave(token);
  return true;
}

// Everything lives in a zone of its own in the private database, made on the first save, so deleting Vdex's copy is
// one request that leaves nothing behind. A copy bigger than one record is split: the parts are saved first and the
// record that names them last, so a reader only ever sees a whole copy; the parts of the copy before are then removed.
// Saves run one at a time.
const CK_ZONE = { zoneName: 'Vdex' };
const ckName = name => name.replace(/[^A-Za-z0-9._-]/g, '_');
const noZone = e => e?.code === 'ZONE_NOT_FOUND';
const ckZone = async operationType => { // make or delete Vdex's zone; a zone already there, or already gone, is fine
  const z = ((await ckRequest('private', 'zones/modify', { operations: [{ operationType, zone: { zoneID: CK_ZONE } }] })).zones || [])[0];
  if (z?.serverErrorCode && !['ZONE_NOT_FOUND', 'EXISTS'].includes(z.serverErrorCode)) throw ckError(z);
};
const ckMakeZone = () => ckZone('create');
let ckWrites = Promise.resolve();
const ckSerial = fn => { const p = ckWrites.then(fn, fn); ckWrites = p.catch(() => {}); return p; };
const splitBytes = (text, max) => { // pieces of at most max UTF-8 bytes, never splitting a character
  const out = []; let start = 0, bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i), b = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xdc00 && c < 0xe000 ? 0 : c >= 0xd800 && c < 0xdc00 ? 4 : 3;
    if (b && bytes + b > max) { out.push(text.slice(start, i)); start = i; bytes = 0; }
    bytes += b;
  }
  out.push(text.slice(start)); return out;
};
async function ckLookup(recordName, desiredKeys) {
  let rec;
  try { rec = ((await ckRequest('private', 'records/lookup', { zoneID: CK_ZONE, records: [{ recordName }], ...(desiredKeys ? { desiredKeys } : {}) })).records || [])[0]; }
  catch (e) { if (noZone(e)) return null; throw e; } // nothing saved yet
  if (!rec || ['NOT_FOUND', 'UNKNOWN_ITEM', 'ZONE_NOT_FOUND'].includes(rec.serverErrorCode)) return null;
  if (rec.serverErrorCode) throw ckError(rec);
  return rec.fields || {};
}
async function ckModify(operations, again = true) {
  let recs;
  try { recs = (await ckRequest('private', 'records/modify', { zoneID: CK_ZONE, operations })).records || []; }
  catch (e) { if (again && noZone(e)) { await ckMakeZone(); return ckModify(operations, false); } throw e; }
  if (again && recs.some(r => r.serverErrorCode === 'ZONE_NOT_FOUND')) { await ckMakeZone(); return ckModify(operations, false); }
  const bad = recs.find(r => r.serverErrorCode && !(/delete/i.test(operations[0].operationType) && r.serverErrorCode === 'NOT_FOUND'));
  if (bad) throw ckError(bad);
}
async function ckGet(name) {
  const base = ckName(name), f = await ckLookup(base); if (!f) return null;
  const parts = Number(f.parts?.value) || 1, gen = f.gen?.value || '';
  let text = f.text?.value || '';
  for (let i = 1; i < parts; i++) { const p = await ckLookup(`${base}~${gen}~${i}`, ['text']); if (!p) throw new Error('Part of the iCloud copy is missing. Tap Sync now to try again'); text += p.text?.value || ''; }
  return text;
}
async function ckPut(name, text) {
  const base = ckName(name), pieces = splitBytes(text, CK_PART);
  const gen = pieces.length > 1 ? Date.now().toString(36) + Math.random().toString(36).slice(2, 7) : '';
  const was = await ckLookup(base, ['parts', 'gen']);
  for (let i = 1; i < pieces.length; i++) await ckModify([{ operationType: 'forceReplace', record: { recordName: `${base}~${gen}~${i}`, recordType: CK_TYPE, fields: { text: { value: pieces[i] } } } }]);
  await ckModify([{ operationType: 'forceReplace', record: { recordName: base, recordType: CK_TYPE, fields: { text: { value: pieces[0] }, parts: { value: pieces.length }, gen: { value: gen } } } }]);
  const oldParts = Number(was?.parts?.value) || 1, oldGen = was?.gen?.value || '';
  if (oldParts > 1 && oldGen !== gen) await ckModify(Array.from({ length: oldParts - 1 }, (_, i) => ({ operationType: 'forceDelete', record: { recordName: `${base}~${oldGen}~${i + 1}` } }))).catch(() => {}); // tidying only
}
export const icloudAdapter = () => ({
  id: 'icloud', label: 'iCloud', where: 'a private Vdex space in your iCloud (not a file in iCloud Drive)',
  ready: async ask => { if (LS.get(CK_SESSION)) return true; if (!ask) return false; await icloudSignIn(); return true; },
  read: async () => parse(await ckSerial(() => ckGet(FILE))), // never mid-way through a save of this device's
  write: text => ckSerial(() => ckPut(FILE, text)),
  // dated backups sit beside the copy as records of their own; iCloud gives no public link, so no calendar feed
  writeExtra: (name, text) => ckSerial(() => ckPut(name, text)),
  readExtra: name => ckSerial(() => ckGet(name)),
  // Removes everything Vdex keeps in iCloud by deleting its zone: the copy, its parts, the dated backups and any part
  // a broken save left behind (Apple asks apps to offer this). Waits for a save under way.
  erase: () => ckSerial(async () => { try { await ckZone('delete'); } catch (e) { if (!noZone(e)) throw e; } }), // nothing there is fine
  signOut: () => { ckEpoch++; ckHeld = null; LS.del(CK_SESSION); setWho(''); },
});

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
  if (code === 'access_denied' || /AADSTS65004|declined/i.test(text)) return 'Microsoft sign-in was cancelled. Tap Connect when you’re ready to try again.';
  if (/AADSTS90094|AADSTS90095|admin/i.test(text)) return 'Your work or school account needs your IT department to approve Vdex first. A personal Microsoft account works straight away.';
  return text ? 'Microsoft sign-in did not work: ' + text.split(/\r?\n/)[0].replace(/^AADSTS\d+:\s*/, '') : 'Microsoft sign-in did not work; try Connect again';
};
// Go to Microsoft to sign in. `intent` says what to finish on the way back: 'onedrive' or 'calendar'.
export async function microsoftBegin(scopes, intent) {
  const id = settings.msId(); if (!id) throw notOn('Microsoft');
  const { verifier, challenge } = await pkce();
  const state = 'vdexms-' + b64url(crypto.getRandomValues(new Uint8Array(16))) + APP_MARK();
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
  if (!pk || pk.state !== state) throw fail(STALE('Microsoft'));
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
  if ((await microsoftBegin(scopes, intent)) === 'browser') { const e = new Error('Carry on in your web browser: sign in to Microsoft there, then come back to Vdex.'); e.name = 'NotAllowedError'; e.handoff = true; throw e; }
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
// Downloading: Graph's /content answers with a redirect that browsers refuse to follow with a sign-in attached, so
// ask for the item's ready-made download address instead, which needs no sign-in and allows browsers.
async function odRead(name) {
  const r = await odfetch(`${name}?select=id,@microsoft.graph.downloadUrl`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('OneDrive read failed (' + r.status + ')');
  const url = (await r.json())['@microsoft.graph.downloadUrl'];
  if (!url) throw new Error('OneDrive did not give a download address');
  const d = await fetch(url);
  if (!d.ok) throw new Error('OneDrive download failed (' + d.status + ')');
  return d.text();
}
export const onedriveAdapter = () => ({
  id: 'onedrive', label: 'OneDrive', where: 'the folder Apps › Vdex',
  ready: async ask => { try { await microsoftToken([MS_FILES], ask); if (!who()) { const a = microsoftAccount(); if (a) setWho([a.name, a.username].filter(Boolean).join(' · ')); } return true; } catch (e) { if (ask && (e.name !== 'NotAllowedError' || e.handoff)) throw e; return false; } },
  read: async () => { const t = await odRead(FILE); return t == null ? null : parse(t); },
  write: async text => { const r = await odfetch(`${FILE}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }); if (!r.ok) throw new Error('OneDrive write failed (' + r.status + ')'); },
  writeExtra: async (name, text) => { const r = await odfetch(`${name}:/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }); if (!r.ok) throw new Error('OneDrive backup write failed (' + r.status + ')'); },
  readExtra: name => odRead(name),
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
export function microsoftSignOut({ keepToken = false, keepWho = false } = {}) { if (!keepWho) setWho(''); if (!keepToken) msSave(null); }

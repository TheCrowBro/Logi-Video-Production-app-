// Cloud storage adapters. Each exposes: name, ready() -> bool, read() -> object|null, write(text).
// Dropbox and Google Drive need an app key / client ID you create once (see README); they are stored on this device only.

const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const settings = {
  dropboxKey: () => LS.get('logi-dropbox-key') || '',
  gdriveId: () => LS.get('logi-gdrive-id') || '',
  setDropboxKey: v => LS.set('logi-dropbox-key', v.trim()),
  setGdriveId: v => LS.set('logi-gdrive-id', v.trim()),
};
export const redirectUri = () => location.origin + location.pathname;
const FILE = 'logi-production-db.json';

const parse = text => {
  if (!text || !text.trim()) return null;
  const d = JSON.parse(text);
  if (!d || typeof d !== 'object' || !('bookings' in d || 'gear' in d)) throw new Error('Not a Logi database file');
  return d;
};

/* ------------------------------ local file ------------------------------ */
export const fileAdapter = handle => ({
  id: 'file', label: handle.name, handle,
  ready: async (ask) => (await handle.queryPermission({ mode: 'readwrite' })) === 'granted' || (ask && (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'),
  read: async () => parse(await (await handle.getFile()).text()),
  write: async text => { const w = await handle.createWritable(); await w.write(text); await w.close(); },
});

/* -------------------------------- Dropbox -------------------------------- */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function dropboxBegin() {
  const key = settings.dropboxKey();
  if (!key) throw new Error('Enter your Dropbox app key first');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  LS.set('logi-dbx-verifier', verifier);
  const q = new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline', redirect_uri: redirectUri(), state: 'logi-dropbox' });
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + q;
}

// Call on page load; returns true if it consumed an OAuth redirect.
export async function dropboxFinish() {
  const p = new URLSearchParams(location.search);
  if (p.get('state') !== 'logi-dropbox') return false;
  history.replaceState(null, '', location.pathname);
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
  signOut: () => { LS.del('logi-dbx-token'); },
});

/* ----------------------------- Google Drive ----------------------------- */
let gisPromise, gToken = null;
export const loadGIS = () => gisPromise || (gisPromise = new Promise((res, rej) => {
  if (window.google?.accounts?.oauth2) return res();
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => rej(new Error('Could not load Google sign-in')); document.head.append(s);
}));

async function gdriveToken(interactive) {
  if (gToken && gToken.exp > Date.now()) return gToken.value;
  const id = settings.gdriveId();
  if (!id) throw new Error('Enter your Google client ID first');
  await loadGIS();
  return new Promise((res, rej) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: id, scope: 'https://www.googleapis.com/auth/drive.appdata',
      callback: r => { if (r.error) return rej(new Error(r.error_description || r.error)); gToken = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 - 60000 }; LS.set('logi-gdrive-on', '1'); res(gToken.value); },
      error_callback: e => rej(new Error(e.type || 'Google sign-in blocked')),
    });
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function gfetch(url, init = {}, interactive = false) {
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + await gdriveToken(interactive) } });
  if (r.status === 401) { gToken = null; throw new Error('Google session expired — reconnect'); }
  return r;
}

export const gdriveAdapter = () => {
  let fileId = LS.get('logi-gdrive-file');
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
    ready: async ask => { if (gToken && gToken.exp > Date.now()) return true; if (!ask) return false; await gdriveToken(true); return true; },
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
    signOut: () => { gToken = null; LS.del('logi-gdrive-file'); LS.del('logi-gdrive-on'); },
  };
};

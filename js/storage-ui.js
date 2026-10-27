// Storage & sync panel and backup actions, shared by the ☁ sheet and the Settings page.
import { h, toast } from './util.js';
import * as store from './store.js';
import * as providers from './providers.js';

export function storagePanel() {
  const el = h('div', { class: 'storage' });
  if (providers.settings.gdriveId()) providers.loadGIS().catch(() => {});
  const run = fn => async () => { try { await fn(); draw(); if (store.cloud.adapter) toast('Linked'); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } };
  const keyField = (label, get, set, ph) => h('input', { type: 'text', placeholder: ph, 'aria-label': label, value: get(), autocomplete: 'off', spellcheck: false, oninput: e => set(e.target.value) });
  const help = text => h('details', { class: 'help' }, h('summary', null, 'Setup'), h('div', { class: 'small muted' }, text));
  const draw = () => {
    const c = store.cloud, a = c.adapter;
    el.replaceChildren(
      h('p', { class: 'small muted' }, 'Your data lives on this device. Link one storage so it is mirrored automatically and shared between your phone and computer.'),
      a
        ? h('div', { class: 'stack' },
          h('p', { class: 'status-line', 'data-state': c.status }, `${a.label} — ${c.status}${c.error ? ' (' + c.error + ')' : ''}`),
          c.status === 'needs-permission' && h('button', { class: 'btn primary', onclick: run(store.reconnect) }, 'Reconnect'),
          h('button', { class: 'btn ghost', onclick: run(() => store.sync({ ask: true })) }, 'Sync now'),
          h('button', { class: 'btn ghost', onclick: run(store.unlinkCloud) }, 'Unlink'))
        : storageList());
  };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const tag = (t, cls) => h('span', { class: 'tag ' + (cls || '') }, t);
  const row = (ico, name, sub, tags, body, open) => h('details', { class: 'twirl', open },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, ico), h('span', null, h('span', { class: 'twirl-name' }, name), h('span', { class: 'twirl-sub' }, sub)), h('span', null, tags)),
    h('div', { class: 'twirl-body' }, body));
  const field = (label, get, set, ph, type = 'text') => h('input', { type, placeholder: ph, 'aria-label': label, value: get(), autocomplete: type === 'password' ? 'current-password' : 'off', spellcheck: false, oninput: e => set(e.target.value) });
  function storageList() {
    const c = store.cloud, wd = providers.settings.webdav();
    const setWd = patch => providers.settings.setWebdav({ ...providers.settings.webdav(), ...patch });
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, 'Pick one. “Direct” means Logi talks to the service itself and works on every device, including iPhone. “Synced folder” means a desktop or Android sync client does the carrying.'),
      row('📦', 'Dropbox', 'Direct · app folder · live calendar feed link', [tag('direct', 'ok'), tag('iPhone ✓', 'ok')], [
        keyField('Dropbox app key', providers.settings.dropboxKey, providers.settings.setDropboxKey, 'Dropbox app key'),
        h('button', { class: 'btn primary', onclick: run(async () => { await store.connectDropbox(); }) }, 'Connect Dropbox'),
        help(`Create an app at dropbox.com/developers/apps (Scoped access → App folder), enable files.content.read + files.content.write (and sharing.write if you want the calendar feed link), add this Redirect URI: ${providers.redirectUri()} — then paste the App key. The database is saved as logi-production-db.json in Apps/<your app>.`)]),
      row('🟢', 'Google Drive', 'Direct · hidden app-data folder · re-approve hourly', [tag('direct', 'ok'), tag('iPhone ✓', 'ok')], [
        keyField('Google OAuth client ID', providers.settings.gdriveId, providers.settings.setGdriveId, 'Google OAuth client ID'),
        h('button', { class: 'btn primary', onclick: run(store.connectGdrive) }, 'Connect Google Drive'),
        help(`In Google Cloud Console create an OAuth client ID (Web application), add ${location.origin} as an Authorised JavaScript origin, enable the Drive API, then paste the client ID. The app only uses its own hidden app-data folder. Google asks you to re-approve about hourly; tap Reconnect when prompted.`)]),
      row('🔷', 'Microsoft OneDrive', 'Direct · Logi’s own app folder · personal and work accounts', [tag('direct', 'ok'), tag('iPhone ✓', 'ok')], [
        keyField('Microsoft application (client) ID', providers.settings.msId, providers.settings.setMsId, 'Microsoft application (client) ID'),
        h('button', { class: 'btn primary', onclick: run(store.connectOneDrive) }, 'Connect OneDrive'),
        help(`Azure portal → App registrations → New: accounts in any organisational directory and personal Microsoft accounts; platform Single-page application with redirect URI ${providers.redirectUri()}; API permission Files.ReadWrite.AppFolder (delegated). Paste the Application (client) ID. The same registration also serves the Outlook calendar link. Sign-in refreshes silently.`)]),
      row('🗂️', 'A file in a synced folder', 'iCloud Drive (Mac) · OneDrive · Google Drive for desktop · Dropbox · Box Drive · Proton Drive · Synology Drive · Nextcloud · pCloud · MEGA…', [tag(c.supported ? 'this browser ✓' : 'not in this browser', c.supported ? 'ok' : 'no'), tag('iPhone ✗', 'no')],
        c.supported
          ? [h('p', { class: 'small muted' }, 'Pick a file inside any folder a sync client keeps mirrored on this computer or Android phone. Whatever that service is, it carries the file for you.'),
            h('button', { class: 'btn primary', onclick: run(store.createCloudFile) }, 'Create database file…'),
            h('button', { class: 'btn ghost', onclick: run(store.openCloudFile) }, 'Open existing database file…')]
          : h('p', { class: 'note' }, ios ? 'iPhone and iPad can’t give a web app a file to keep writing to. Use Dropbox, Google Drive or OneDrive above — they work here.' : 'This browser can’t keep a file open for writing (Firefox and Safari). Chrome or Edge can, or use a direct service above.')),
      row('🌐', 'WebDAV server', 'Advanced · Nextcloud, ownCloud, Synology, Fastmail, Hetzner, your own server', [tag('direct', 'ok'), tag('iPhone ✓', 'ok'), tag('CORS needed')], [
        field('Server folder address', () => wd.url || '', v => setWd({ url: v.trim() }), 'https://cloud.example.com/remote.php/dav/files/you/Logi/', 'url'),
        field('Username', () => wd.user || '', v => setWd({ user: v.trim() }), 'Username'),
        field('App password', () => wd.pass || '', v => setWd({ pass: v }), 'App password', 'password'),
        h('button', { class: 'btn primary', onclick: run(store.connectWebdav) }, 'Connect WebDAV'),
        help('Point it at a folder that already exists. Use an app password, not your main one; it is kept only in this browser. The server has to allow requests from this site (CORS headers for ' + location.origin + '): Nextcloud needs the WebAppPassword/CORS app, Synology and most self-hosted servers a reverse-proxy rule. Without that the browser blocks the connection and Logi tells you.')]),
      row('💾', 'No cloud — backup files', 'Export and import by hand from Backups & data', [tag('anywhere', 'ok')],
        h('p', { class: 'small muted' }, 'Keep everything on this device and move it with the Export / Import buttons whenever you like. Works with any storage you can save a file to.')));
  }
  draw();
  let last = store.cloud.status;
  const unsub = store.subscribe(() => { if (store.cloud.status !== last) { last = store.cloud.status; draw(); } });
  return { el, destroy: unsub, refresh: draw };
}

export function backupPanel() {
  const erase = h('div', { class: 'stack' });
  const armErase = () => erase.replaceChildren(
    h('div', { class: 'warn small' }, 'This removes every booking, contact, item, venue, policy and log from this device and unlinks any storage. A linked cloud copy is left as it is. There is no undo.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: async () => { await store.eraseAll(); toast('Everything erased'); draw(); } }, 'Yes, erase everything'), h('button', { class: 'btn ghost', onclick: draw }, 'Keep my data')));
  const draw = () => erase.replaceChildren(h('button', { class: 'btn ghost', onclick: armErase }, 'Erase all data on this device…'));
  draw();
  return h('div', { class: 'stack' },
    h('button', { class: 'btn ghost', onclick: exportFile }, 'Export backup (.json)'),
    h('label', { class: 'btn ghost file-btn' }, 'Import backup…', h('input', { type: 'file', accept: 'application/json,.json', onchange: importFile })),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Replace your current data with example data?')) { store.loadSample(); toast('Sample data loaded'); } } }, 'Load sample data'),
    erase);
}

export async function exportFile() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const file = new File([blob], 'logi-production-db.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Logi backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
}

export async function importFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !('bookings' in data || 'gear' in data)) throw new Error('Not a Logi database file');
    if (confirm('Replace your current data with this file?')) { store.replaceAll(data); toast('Imported'); }
  } catch (err) { toast('Import failed: ' + err.message); }
}

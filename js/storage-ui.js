// The storage panel (the cloud link and its state) and the backup actions, shared by the ☁ sheet and Settings → Storage, sync & backups.
import { h, toast } from './util.js';
import * as store from './store.js';
import * as providers from './providers.js';
import * as backup from './backup.js';
import { REPO } from './version.js';

export const SWITCH_ON = REPO + '/blob/main/docs/turn-on-sign-in.md';
// Load Google's sign-in library ahead of the tap, so its window opens straight from the tap (browsers block late ones).
export function preloadSignIn() {
  if (providers.signIn.available('google')) providers.loadGIS().catch(() => {});
}
const STATUS = { synced: 'Up to date', saving: 'Saving…', 'needs-permission': 'Needs you to sign in again', error: 'Could not reach it', off: 'Not copied yet', paused: 'Paused: cloud storage comes with a licence' };
const ICLOUD_SUB = 'Sign in with your Apple ID and tick “Keep me signed in”: Apple then asks again about every two weeks. Uses a little of your iCloud storage.';
export const BROWSER = 'Carry on in your web browser: sign in there, then come back to Vdex.';

export function storagePanel() {
  const el = h('div', { class: 'storage' });
  preloadSignIn();
  // Say what actually happened: only "up to date" when the copy really was made.
  const run = (fn, done) => async () => {
    try {
      const r = await fn(); draw();
      if (r === 'browser') return toast(BROWSER);
      const c = store.cloud; if (done === false || !c.adapter) return;
      if (c.status === 'synced') toast(done || `Connected to ${c.adapter.label}. Up to date.`);
      else if (c.status === 'needs-permission') toast(`${c.adapter.label} wants you to sign in again.`);
      else if (c.error) toast(`Not copied yet: ${c.error}. Your changes are safe on this device.`);
    } catch (e) { if (e.name !== 'AbortError') toast(e.message); draw(); }
  };
  // Linking storage, and syncing it, come with a licence: without one these explain and offer it instead.
  const paidRun = (fn, done) => { const go = run(fn, done); return () => (store.requirePaid('cloud') ? go() : undefined); };
  const draw = () => el.replaceChildren(store.cloud.adapter ? linked() : choices());

  // Connected: who, where, how it is going, and the three things you can do.
  function linked() {
    const c = store.cloud, a = c.adapter, who = providers.who();
    return h('div', { class: 'stack cloud-linked' },
      h('div', { class: 'card stack' },
        h('div', { class: 'cloud-head' }, h('span', { class: 'cloud-ico', 'aria-hidden': 'true' }, ICON[a.id] || '☁'), h('div', null, h('strong', null, `Connected to ${a.label}`), who && h('div', { class: 'small muted' }, 'Signed in as ' + who))),
        h('p', { class: 'status-line', 'data-state': c.status }, [STATUS[c.status] || c.status, c.error && c.status !== 'synced' ? c.error : ''].filter(Boolean).join(' · ')),
        ownApp(a) ? h('p', { class: 'small muted' }, 'This sign-in uses your own developer app (set under For developers), so the copy is in that app’s folder. Every device has to use the same app to share it.')
          : a.where && h('p', { class: 'small muted' }, `Vdex keeps its copy in ${a.where}, and nothing else of yours is touched. Your phone and computer share it when both are connected the same way.`),
        c.paused && h('p', { class: 'small' }, 'Nothing is copied to or from it until this device has a licence: your data stays here, and the copy there stays as it is. Syncing starts again by itself once you have one.'),
        h('div', { class: 'actions' },
          c.paused && h('button', { class: 'btn primary', onclick: () => store.requirePaid('cloud') }, 'Get a licence'),
          !c.paused && c.status === 'needs-permission' && h('button', { class: 'btn primary', onclick: paidRun(() => (a.id === 'dropbox' ? store.connectDropbox() : store.reconnect()), 'Signed in again. Up to date.') }, 'Sign in again'),
          !c.paused && h('button', { class: 'btn ' + (c.status === 'needs-permission' ? 'ghost' : 'primary'), onclick: paidRun(() => store.reconnect(), 'Up to date. Your copy is saved.') }, 'Sync now'),
          h('button', { class: 'btn ghost', onclick: run(store.unlinkCloud, false) }, 'Disconnect'))),
      h('p', { class: 'small muted' }, 'Disconnecting stops the copying. Everything stays on this device, and the copy in your storage stays where it is.'),
      a.erase && h('button', { class: 'btn ghost small', onclick: () => { if (confirm(`Delete Vdex’s copy and its backups from ${a.label}? Everything stays on this device, and Vdex disconnects.`)) run(async () => { await store.eraseCloudCopy(); toast(`Vdex’s copy was deleted from ${a.label}. Everything is still on this device.`); }, false)(); } }, `Delete Vdex’s copy from ${a.label}…`));
  }

  const ownApp = a => (a.id === 'dropbox' ? providers.signIn.dropboxOwn() : a.id === 'gdrive' ? providers.signIn.usingOwn('google') : a.id === 'onedrive' ? providers.signIn.usingOwn('microsoft') : false);
  // Not connected: Google Drive and iCloud first; everything else folded away under More ways.
  const ICON = { dropbox: '📦', gdrive: '🟢', icloud: '☁️', onedrive: '🔷', webdav: '🌐', file: '🗂️' };
  const service = (id, svc, name, sub, connect, folded = false) => {
    const on = providers.signIn.available(svc);
    return h('div', { class: 'card cloud-choice' + (on ? '' : ' off'), 'data-svc': id },
      h('span', { class: 'cloud-ico', 'aria-hidden': 'true' }, ICON[id]),
      h('div', { class: 'grow' }, h('strong', null, name), h('div', { class: 'small muted' }, on ? sub : `Not ready yet: sign-in for ${name} is still being set up for Vdex.${folded ? '' : ' Until then, see More ways below.'}`, !on && [' ', h('a', { href: SWITCH_ON, target: '_blank', rel: 'noopener', class: 'publisher-link' }, 'For the Vdex publisher: how to switch it on')])),
      h('button', { class: 'btn primary', disabled: !on, onclick: paidRun(connect), 'aria-label': `Connect ${name}` }, 'Connect'));
  };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const field = (label, get, set, ph, type = 'text') => h('label', { class: 'field' }, h('span', null, label), h('input', { type, placeholder: ph, 'aria-label': label, value: get(), autocomplete: type === 'password' ? 'current-password' : 'off', spellcheck: false, autocapitalize: 'off', oninput: e => set(e.target.value) }));
  // A fold-down that stays open or closed across redraws (a tab tapped, a key saved). Everything starts folded.
  const opened = new Set();
  const more = (title, sub, body, cls = '') => { const d = h('details', { class: 'twirl ' + cls, open: opened.has(title) }, h('summary', null, h('span', null, h('span', { class: 'twirl-name' }, title), sub && h('span', { class: 'twirl-sub' }, sub))), h('div', { class: 'twirl-body stack' }, body));
    d.addEventListener('toggle', () => { if (d.open) opened.add(title); else opened.delete(title); }); return d; };

  function choices() {
    const c = store.cloud, wd = providers.settings.webdav();
    const setWd = patch => providers.settings.setWebdav({ ...providers.settings.webdav(), ...patch });
    const nc = wd.kind === 'nextcloud';
    return h('div', { class: 'stack' },
      c.notice && h('div', { class: 'warn small' }, c.notice),
      c.paused && h('p', { class: 'small licence-note' }, 'Cloud storage comes with a Vdex licence. Until then your data is kept on this device.'),
      h('p', null, 'Sign in to your own cloud storage and Vdex keeps a copy of everything there. Your phone and computer then share the same information, and a backup is made every day.'),
      h('p', { class: 'small muted' }, 'Vdex only uses a space of its own. It cannot see, change or share any of your other files.'),
      h('div', { class: 'stack cloud-choices' },
        service('gdrive', 'google', 'Google Drive', 'Sign in and tap Allow. About once an hour Google asks again: one tap.', store.connectGdrive),
        service('icloud', 'icloud', 'iCloud', ICLOUD_SUB, store.connectIcloud)),
      h('p', { class: 'small muted' }, 'Use the same one on every device. Nothing is shared with anyone else.'),
      more('More ways to keep a copy', 'Dropbox, OneDrive, Nextcloud, a synced folder or backup files', [
        h('div', { class: 'stack cloud-choices' },
          service('dropbox', 'dropbox', 'Dropbox', 'Sign in and tap Allow. Stays connected.', () => store.connectDropbox(), true),
          service('onedrive', 'microsoft', 'OneDrive', 'Sign in and tap Accept. About once a day Microsoft asks again: one tap.', store.connectOneDrive, true)),
        h('div', { class: 'card stack' }, h('strong', null, '🌐 Nextcloud, ownCloud or another WebDAV server'),
          h('div', { class: 'seg', role: 'tablist' },
            h('button', { role: 'tab', class: nc ? 'on' : '', 'aria-selected': nc, onclick: () => { setWd({ kind: 'nextcloud' }); draw(); } }, 'Nextcloud / ownCloud'),
            h('button', { role: 'tab', class: nc ? '' : 'on', 'aria-selected': !nc, onclick: () => { setWd({ kind: 'webdav' }); draw(); } }, 'Other WebDAV')),
          nc ? field('Your Nextcloud address', () => wd.url || '', v => setWd({ url: v.trim() }), 'cloud.example.com', 'url')
            : field('Folder address', () => wd.url || '', v => setWd({ url: v.trim() }), 'https://server.example.com/dav/Vdex/', 'url'),
          field('Username', () => wd.user || '', v => setWd({ user: v.trim() }), 'Username'),
          field('App password', () => wd.pass || '', v => setWd({ pass: v }), 'App password', 'password'),
          h('p', { class: 'small muted' }, nc ? 'Make an app password in Nextcloud under Settings → Security → Devices & sessions, so your main password never leaves Nextcloud. Vdex makes a folder called Vdex in your files.' : 'Use an app password, not your main one. Vdex makes the folder if it is not there yet.'),
          h('button', { class: 'btn primary', onclick: paidRun(store.connectWebdav) }, 'Connect'),
          h('p', { class: 'small muted' }, `The server has to allow Vdex to reach it from ${location.origin}. If it does not, Vdex says so; the person who runs the server can allow it.`)),
        h('div', { class: 'card stack' }, h('strong', null, '🗂️ A file in a synced folder (computers)'),
          c.supported
            ? [h('p', { class: 'small muted' }, 'Save the database file inside a folder that iCloud Drive, OneDrive, Google Drive, Dropbox, Box or another sync app already copies, and that app carries it between your computers.'),
              h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: paidRun(store.createCloudFile) }, 'Create database file…'), h('button', { class: 'btn ghost', onclick: paidRun(store.openCloudFile) }, 'Open existing file…'))]
            : h('p', { class: 'small muted' }, ios ? 'Not on iPhone or iPad: they cannot give an app a file to keep writing to. Use Google Drive or iCloud above.' : 'Needs Chrome, Edge or the Vdex desktop app on a computer.')),
        h('div', { class: 'card stack' }, h('strong', null, '💾 No cloud at all'),
          h('p', { class: 'small muted' }, store.isPaid() ? 'Keep everything on this device and save a backup file now and then under Backups, just below.' : 'Everything stays on this device. Backup files come with a licence.')),
        more('For developers: use your own app', 'Only if you run your own copy of Vdex', [
          h('p', { class: 'small muted' }, 'Only needed if you host Vdex yourself or want sign-ins to go through an app you registered. A key here replaces the built-in one on this device; leave it empty to use the built-in one.'),
          field('Dropbox app key', providers.settings.ownDropboxKey, providers.settings.setDropboxKey, 'Dropbox app key'),
          field('Google OAuth client ID', providers.settings.ownGdriveId, providers.settings.setGdriveId, 'Google OAuth client ID'),
          field('Microsoft application (client) ID', providers.settings.ownMsId, providers.settings.setMsId, 'Microsoft application (client) ID'),
          h('p', { class: 'small muted' }, `Register these sign-in addresses with your app: ${location.origin + location.pathname} (Dropbox and Microsoft redirect URI, as a single-page application at Microsoft) and ${location.origin} (Google JavaScript origin). `),
          h('button', { class: 'btn ghost small', onclick: () => { draw(); toast('Saved'); } }, 'Use these keys')], 'twirl-inner')], 'twirl-more'));
  }
  draw();
  let last = store.cloud.status, lastA = store.cloud.adapter;
  let lastP = store.cloud.paused;
  const unsub = store.subscribe(() => { if (store.cloud.status !== last || store.cloud.adapter !== lastA || store.cloud.paused !== lastP) { last = store.cloud.status; lastA = store.cloud.adapter; lastP = store.cloud.paused; draw(); } });
  return { el, destroy: unsub, refresh: draw };
}

export function backupPanel() {
  const erase = h('div', { class: 'stack' });
  const armErase = () => erase.replaceChildren(
    h('div', { class: 'warn small' }, 'This removes every booking, contact, item, venue, policy and log from this device, unlinks any storage and removes the PIN. A linked cloud copy and any backup files are left as they are. There is no undo.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: async () => { await store.eraseAll(); toast('Everything erased'); draw(); } }, 'Yes, erase everything'), h('button', { class: 'btn ghost', onclick: draw }, 'Keep my data')));
  const draw = () => erase.replaceChildren(h('button', { class: 'btn ghost', onclick: armErase }, 'Erase all data on this device…'));
  draw();
  const a = store.cloud.adapter;
  return h('div', { class: 'stack' },
    backup.healthLine(),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: () => backup.exportFile() }, 'Export backup'),
      h('button', { class: 'btn ghost', onclick: () => backup.exportFile({ encrypted: true }) }, '🔐 Encrypted backup…'),
      h('label', { class: 'btn ghost file-btn' }, 'Import backup…', h('input', { type: 'file', accept: 'application/json,.json', onchange: backup.importFile }))),
    a && a.readExtra && h('button', { class: 'btn ghost', onclick: () => backup.restoreFromCloud() }, '☁ Restore an automatic cloud backup…'),
    h('p', { class: 'small muted' }, 'With a cloud storage linked (Google Drive, iCloud, Dropbox, OneDrive or WebDAV), Vdex also writes a dated backup next to its database once a day after a change: one per weekday and one per month. Backup files are plain unless you choose the encrypted one, so keep them somewhere private.'),
    h('button', { class: 'btn ghost', onclick: () => { if (confirm('Replace your current data with example data?')) { store.loadSample(); toast('Sample data loaded'); } } }, 'Load sample data'),
    erase);
}

export const exportFile = backup.exportFile;
export const importFile = backup.importFile;

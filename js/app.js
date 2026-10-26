import { h, sheet, toast } from './util.js';
import { createRolodex } from './rolodex.js';
import * as store from './store.js';
import * as providers from './providers.js';
import { applyPrefs, openDisplaySettings } from './a11y.js';

applyPrefs();
document.getElementById('displayBtn')?.addEventListener('click', openDisplaySettings);
import { bookings } from './pages/bookings.js';
import { crew } from './pages/crew.js';
import { gear } from './pages/gear.js';
import { insurance } from './pages/insurance.js';
import { me } from './pages/me.js';
import { field } from './pages/field.js';

const tabs = [bookings, crew, gear, insurance, me, field];
const page = document.getElementById('page');
let current = -1;
let cleanup = null;

function show(i, dir = 0) {
  cleanup && cleanup();
  cleanup = null;
  current = i;
  const t = tabs[i];
  const holder = h('section', { class: 'page-card' + (dir ? ' fade-in' : ''), 'aria-label': t.label });
  page.replaceChildren(holder);
  cleanup = t.render(holder) || null;
  try { localStorage.setItem('logi-tab', String(i)); } catch { /* private mode */ }
}

// Re-render the active page when data changes (field tools keep their own live state).
store.subscribe(() => {
  paintCloud();
  if (current >= 0 && !tabs[current].static) {
    const y = window.scrollY;
    cleanup && cleanup();
    const holder = page.firstElementChild;
    holder.replaceChildren();
    cleanup = tabs[current].render(holder) || null;
    window.scrollTo(0, y);
  }
});

let start = 0;
try { start = Math.min(tabs.length - 1, Math.max(0, Number(localStorage.getItem('logi-tab')) || 0)); } catch { /* ignore */ }
const rolodex = createRolodex(document.getElementById('rolodex'), tabs, { start, onSelect: (i, dir) => show(i, dir) });
show(start);
window.logiGo = i => rolodex.go(i); // lets pages jump between sections

/* ----------------------- storage / sync sheet ----------------------- */
const cloudBtn = document.getElementById('cloudBtn');
const cloudLabel = document.getElementById('cloudLabel');

function paintCloud() {
  const s = store.cloud.status;
  const text = { off: 'Local', synced: 'Synced', saving: 'Saving…', 'needs-permission': 'Reconnect', error: 'Sync error' }[s];
  cloudLabel.textContent = text;
  cloudBtn.dataset.state = s;
}
paintCloud();

cloudBtn.addEventListener('click', () => openStorage());

function openStorage() {
  const body = h('div', { class: 'storage' });
  if (providers.settings.gdriveId()) providers.loadGIS().catch(() => {});
  const run = fn => async () => { try { await fn(); draw(); if (store.cloud.adapter) toast('Linked'); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } };
  const keyField = (label, get, set, ph) => h('input', { type: 'text', placeholder: ph, 'aria-label': label, value: get(), autocomplete: 'off', spellcheck: false, oninput: e => set(e.target.value) });
  const help = text => h('details', { class: 'help' }, h('summary', null, 'Setup'), h('div', { class: 'small muted' }, text));

  const draw = () => {
    const c = store.cloud;
    const a = c.adapter;
    body.replaceChildren(
      h('p', null, 'Your data lives on this device. Link one storage so it is mirrored automatically and shared between your phone and computer.'),
      a
        ? h('div', { class: 'stack' },
          h('p', { class: 'status-line', 'data-state': c.status }, `${a.label} — ${c.status}${c.error ? ' (' + c.error + ')' : ''}`),
          c.status === 'needs-permission' && h('button', { class: 'btn primary', onclick: run(store.reconnect) }, 'Reconnect'),
          h('button', { class: 'btn ghost', onclick: run(() => store.sync(true)) }, 'Sync now'),
          h('button', { class: 'btn ghost', onclick: run(store.unlinkCloud) }, 'Unlink'))
        : h('div', { class: 'stack' },
          h('div', { class: 'provider' }, h('strong', null, 'Dropbox'),
            keyField('Dropbox app key', providers.settings.dropboxKey, providers.settings.setDropboxKey, 'Dropbox app key'),
            h('button', { class: 'btn primary', onclick: run(async () => { await store.connectDropbox(); }) }, 'Connect Dropbox'),
            help(`Create an app at dropbox.com/developers/apps (Scoped access → App folder), enable files.content.read + files.content.write, add this Redirect URI: ${providers.redirectUri()} — then paste the App key. The database is saved as logi-production-db.json in Apps/<your app>.`)),
          h('div', { class: 'provider' }, h('strong', null, 'Google Drive'),
            keyField('Google OAuth client ID', providers.settings.gdriveId, providers.settings.setGdriveId, 'Google OAuth client ID'),
            h('button', { class: 'btn primary', onclick: run(store.connectGdrive) }, 'Connect Google Drive'),
            help(`In Google Cloud Console create an OAuth client ID (Web application), add ${location.origin} as an Authorised JavaScript origin, enable the Drive API, then paste the client ID. The app only uses its own hidden app-data folder. Google asks you to re-approve about hourly; tap Reconnect when prompted.`)),
          c.supported
            ? h('div', { class: 'provider' }, h('strong', null, 'A file in a synced folder'),
              h('p', { class: 'small muted' }, 'Pick a file inside your Google Drive, Dropbox, OneDrive or iCloud Drive folder on this computer or Android phone.'),
              h('button', { class: 'btn ghost', onclick: run(store.createCloudFile) }, 'Create database file…'),
              h('button', { class: 'btn ghost', onclick: run(store.openCloudFile) }, 'Open existing database file…'))
            : h('p', { class: 'note' }, 'Linking a local file isn’t supported in this browser (iOS Safari, Firefox) — use Dropbox / Google Drive above, or Export below.')),
      h('hr'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn ghost', onclick: exportFile }, 'Export backup (.json)'),
        h('label', { class: 'btn ghost file-btn' }, 'Import backup…', h('input', { type: 'file', accept: 'application/json,.json', onchange: importFile })),
        h('button', { class: 'btn ghost', onclick: () => { if (confirm('Replace your current data with example data?')) { store.loadSample(); toast('Sample data loaded'); } } }, 'Load sample data')),
    );
  };
  draw();
  let last = store.cloud.status;
  const unsub = store.subscribe(() => { if (store.cloud.status !== last) { last = store.cloud.status; draw(); } });
  sheet('Storage & sync', body, { onClose: unsub });
}

async function exportFile() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const file = new File([blob], 'logi-production-db.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Logi backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
  document.body.append(a); a.click(); a.remove();
}

async function importFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !('bookings' in data || 'gear' in data)) throw new Error('Not a Logi database file');
    if (confirm('Replace your current data with this file?')) { store.replaceAll(data); toast('Imported'); }
  } catch (err) { toast('Import failed: ' + err.message); }
}

store.initCloud();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

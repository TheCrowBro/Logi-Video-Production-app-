import { h, sheet, toast } from './util.js';
import { createRolodex } from './rolodex.js';
import * as store from './store.js';
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
  const holder = h('section', { class: 'page-card' + (dir ? (dir > 0 ? ' flip-next' : ' flip-prev') : ''), 'aria-label': t.label });
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
    holder.classList.remove('flip-next', 'flip-prev');
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
  const draw = () => {
    const c = store.cloud;
    body.replaceChildren(
      h('p', null, 'Your data is stored on this device and can be mirrored to a single JSON file in any cloud-synced folder — Google Drive, Dropbox, OneDrive or iCloud Drive.'),
      c.supported
        ? h('div', { class: 'stack' },
          c.handle
            ? [h('p', { class: 'status-line', 'data-state': c.status }, `File: ${c.name} — ${c.status}${c.error ? ' (' + c.error + ')' : ''}`),
              c.status === 'needs-permission' && h('button', { class: 'btn primary', onclick: async () => { await store.reconnect(); draw(); } }, 'Reconnect to file'),
              h('button', { class: 'btn ghost', onclick: async () => { await store.sync(); draw(); toast('Synced'); } }, 'Sync now'),
              h('button', { class: 'btn ghost', onclick: async () => { await store.unlinkCloud(); draw(); } }, 'Unlink file')]
            : [h('button', { class: 'btn primary', onclick: run(store.createCloudFile) }, 'Create database file in my cloud folder…'),
              h('button', { class: 'btn ghost', onclick: run(store.openCloudFile) }, 'Open an existing database file…')])
        : h('p', { class: 'note' }, 'This browser cannot write to a chosen file (iOS Safari, Firefox). Use Share/Export below and save to iCloud Drive / Files, or open the app in Chrome or Edge to link a file directly.'),
      h('hr'),
      h('div', { class: 'stack' },
        h('button', { class: 'btn ghost', onclick: exportFile }, 'Export backup (.json)'),
        h('label', { class: 'btn ghost file-btn' }, 'Import backup…', h('input', { type: 'file', accept: 'application/json,.json', onchange: importFile })),
        h('button', { class: 'btn ghost', onclick: () => { if (confirm('Replace your current data with example data?')) { store.loadSample(); toast('Sample data loaded'); } } }, 'Load sample data')),
    );
  };
  const run = fn => async () => { try { await fn(); draw(); toast('Linked'); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } };
  draw();
  const unsub = store.subscribe(draw);
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

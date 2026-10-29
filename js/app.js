import { h, sheet, toast } from './util.js';
import { createRolodex } from './rolodex.js';
import * as store from './store.js';
import { storagePanel, backupPanel } from './storage-ui.js';
import { applyPrefs, openDisplaySettings } from './a11y.js';
import { initInstall } from './install.js';
import { startTour, tourSeen } from './tour.js';
import './calendar.js'; // registers the feed writer and the auto-push to a linked calendar
import { initClockBar } from './clock.js';
import * as lock from './lock.js';
import * as backup from './backup.js';
import { initUpdates } from './update.js';

applyPrefs();
await lock.gate(); // with a PIN set, nothing below runs until the lock screen is passed
lock.init();
const lockBtn = document.getElementById('lockBtn');
const paintLock = () => { if (lockBtn) lockBtn.hidden = !lock.enabled(); };
paintLock(); lock.onChange(paintLock);
lockBtn && lockBtn.addEventListener('click', () => lock.lockNow());
document.getElementById('displayBtn')?.addEventListener('click', openDisplaySettings);
initInstall(document.getElementById('installBtn'));
initClockBar(document.getElementById('clockbar'));
import { bookings } from './pages/bookings.js';
import { crew } from './pages/crew.js';
import { gear } from './pages/gear.js';
import { insurance } from './pages/insurance.js';
import { venues } from './pages/venues.js';
import { tcnotes, receiveSharedFile } from './pages/tcnotes.js';
import { settings } from './pages/settings.js';
import { me } from './pages/me.js';
import { field } from './pages/field.js';

const tabs = [bookings, crew, gear, venues, insurance, me, field, tcnotes, settings];
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
window.logiGo = i => rolodex.go(typeof i === 'string' ? Math.max(0, tabs.findIndex(t => t.id === i)) : i); // lets pages jump between sections

// A file shared to the app (Android share sheet) is parked by the service worker; hand it to TC Notes.
if (new URLSearchParams(location.search).get('share') === '1' && 'caches' in window) {
  history.replaceState(null, '', location.pathname);
  caches.open('logi-share').then(async c => {
    const r = await c.match('shared-file'); if (!r) return;
    const name = decodeURIComponent(r.headers.get('X-Name') || 'shared.docx');
    const file = new File([await r.blob()], name, { type: r.headers.get('Content-Type') || '' });
    await c.delete('shared-file');
    receiveSharedFile(file);
  }).catch(() => {});
}

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
  const panel = storagePanel();
  sheet('Storage & sync', h('div', null, panel.el, h('hr'), backupPanel()), { onClose: panel.destroy });
}

store.initCloud();
backup.nudgeIfStale();
if (!tourSeen()) setTimeout(() => startTour(), 700); // first launch: a short walkthrough
initUpdates(); // service worker, offline copy, and the "new version" bar

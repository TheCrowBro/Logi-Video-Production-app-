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
const help = () => import('./tutorials.js').then(m => m.openTutorial()); // the tutorials load on first use
document.getElementById('helpBtn')?.addEventListener('click', help);
window.logiHelp = help; // sheets show a ? too
initInstall(document.getElementById('installBtn'));
initClockBar(document.getElementById('clockbar'));
import { bookings } from './pages/bookings.js';

// The Bookings card is the usual start, so it loads with the app. Every other section is fetched and parsed the first
// time it is opened (the service worker keeps them all offline regardless), which keeps the start-up parse small.
const section = (id, label, icon, load) => ({ id, label, icon, load });
const tabs = [
  { id: bookings.id, label: bookings.label, icon: bookings.icon, page: bookings },
  section('crew', 'Crew', '👥', () => import('./pages/crew.js').then(m => m.crew)),
  section('gear', 'Equipment', '🎥', () => import('./pages/gear.js').then(m => m.gear)),
  section('venues', 'Venues', '📍', () => import('./pages/venues.js').then(m => m.venues)),
  section('insurance', 'Insurance', '🛡️', () => import('./pages/insurance.js').then(m => m.insurance)),
  section('me', 'Me', '🪪', () => import('./pages/me.js').then(m => m.me)),
  section('field', 'Field', '☀️', () => import('./pages/field.js').then(m => m.field)),
  section('tcnotes', 'TC Notes', '⏱️', () => import('./pages/tcnotes.js').then(m => m.tcnotes)),
  section('settings', 'Settings', '⚙️', () => import('./pages/settings.js').then(m => m.settings)),
];
const pageOf = t => (t.page ? Promise.resolve(t.page) : (t.loading || (t.loading = t.load().then(p => { t.page = p; return p; }))));
const page = document.getElementById('page');
let current = -1;
let cleanup = null;

let showing = Promise.resolve(), showToken = 0;
function show(i, dir = 0) {
  const token = ++showToken;
  current = i;
  try { localStorage.setItem('logi-tab', String(i)); } catch { /* private mode */ }
  showing = pageOf(tabs[i]).then(p => {
    if (token !== showToken) return; // the drum moved on while this section was loading
    cleanup && cleanup();
    cleanup = null;
    const holder = h('section', { class: 'page-card' + (dir ? ' fade-in' : ''), 'aria-label': p.label });
    page.replaceChildren(holder);
    cleanup = p.render(holder) || null;
  }).catch(e => { console.error(e); toast('That section could not be loaded. Check the connection and try again.'); });
  return showing;
}

// Re-render the active page when data changes (field tools keep their own live state).
// Redraws are coalesced: a burst of changes in one go (an import, a template applied, a merge) draws the page once.
let redrawQueued = false;
function redraw() {
  redrawQueued = false;
  const p = current >= 0 && tabs[current] && tabs[current].page;
  if (!p || p.static) return; // a section still loading draws itself fresh when it arrives
  const y = window.scrollY;
  const holder = page.firstElementChild;
  if (!holder) return;
  cleanup && cleanup();
  holder.replaceChildren();
  cleanup = p.render(holder) || null;
  window.scrollTo(0, y);
}
store.subscribe(reason => {
  paintCloud();
  if (reason === 'status' && tabs[current] && tabs[current].id !== 'settings') return; // sync status alone is not worth redrawing a page for
  if (!redrawQueued) { redrawQueued = true; queueMicrotask(redraw); }
});

let start = 0;
try { start = Math.min(tabs.length - 1, Math.max(0, Number(localStorage.getItem('logi-tab')) || 0)); } catch { /* ignore */ }
const rolodex = createRolodex(document.getElementById('rolodex'), tabs, { start, onSelect: (i, dir) => show(i, dir) });
show(start);
window.logiGo = i => { rolodex.go(typeof i === 'string' ? Math.max(0, tabs.findIndex(t => t.id === i)) : i); return showing; }; // lets pages jump between sections; resolves once the section is drawn
window.logiPage = () => (tabs[current] ? tabs[current].id : null); // which section is open (the page tutorials use it)

// A file shared to the app (Android share sheet) is parked by the service worker; hand it to TC Notes.
if (new URLSearchParams(location.search).get('share') === '1' && 'caches' in window) {
  history.replaceState(null, '', location.pathname);
  caches.open('logi-share').then(async c => {
    const r = await c.match('shared-file'); if (!r) return;
    const name = decodeURIComponent(r.headers.get('X-Name') || 'shared.docx');
    const file = new File([await r.blob()], name, { type: r.headers.get('Content-Type') || '' });
    await c.delete('shared-file');
    import('./pages/tcnotes.js').then(m => m.receiveSharedFile(file));
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
const idle = window.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 2500 }) : fn => setTimeout(fn, 1200);
idle(() => import('./pages/gear.js').then(m => m.serviceNudge())); // service reminders, once the first paint is out of the way
if (!tourSeen()) setTimeout(() => startTour(), 700); // first launch: a short walkthrough
initUpdates(); // service worker, offline copy, and the "new version" bar

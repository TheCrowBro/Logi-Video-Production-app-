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
import { termsGate } from './terms.js';
import * as native from './native.js';

applyPrefs();
// A shared Vdex link opened in the app (index.html#add=…, from "Add to my Vdex" on a shared page): taken out of the
// address bar at once and kept for this tab, through the lock, the terms, the PIN set-up and any sign-in on the way.
const parkAdd = () => { const m = /^#add=(.+)/.exec(location.hash); if (!m) return false; try { sessionStorage.setItem('vdex-add', m[1]); } catch { window.__vdexAdd = m[1]; } history.replaceState(null, '', location.pathname + location.search); return true; };
parkAdd();
await lock.gate(); // with a PIN set, nothing below runs until the lock screen is passed
lock.init();
await termsGate(); // nor until the terms of service and privacy policy are accepted on this device
await lock.ensurePin(); // and everyone uses Vdex with a PIN: a device without one sets it up here, before anything else
{ const why = lock.notice(); if (why) setTimeout(() => toast(why), 500); } // a word no gate has shown yet (the device was erased, a PIN was set elsewhere)
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
// What identifies a control across a redraw: its kind, its id or label, and the text around it (a checklist box is
// known by its line). The same control in the new page gets the focus back, so ticking by keyboard stays in place.
const focusKey = el => (el && el !== document.body && page.contains(el) ? [el.tagName, el.type || '', el.id || el.getAttribute('aria-label') || el.name || '', ((el.closest('label') || el).textContent || '').trim().slice(0, 80)].join('|') : null);
function redraw() {
  redrawQueued = false;
  const p = current >= 0 && tabs[current] && tabs[current].page;
  if (!p || p.static) return; // a section still loading draws itself fresh when it arrives
  const y = window.scrollY, key = focusKey(document.activeElement);
  const holder = page.firstElementChild;
  if (!holder) return;
  cleanup && cleanup();
  holder.replaceChildren();
  cleanup = p.render(holder) || null;
  window.scrollTo(0, y);
  if (key) { const again = [...holder.querySelectorAll('button, input, select, textarea, a[href], summary, [tabindex]')].find(el => focusKey(el) === key); if (again) again.focus({ preventScroll: true }); }
}
store.subscribe(reason => {
  paintCloud();
  if (reason === 'licence') return; // the licence changed what may be linked or saved: the panels concerned redraw themselves
  if (reason === 'status' && tabs[current] && tabs[current].id !== 'settings') return; // sync status alone is not worth redrawing a page for
  if (!redrawQueued) { redrawQueued = true; queueMicrotask(redraw); }
});

let start = 0;
try { start = Math.min(tabs.length - 1, Math.max(0, Number(localStorage.getItem('logi-tab')) || 0)); } catch { /* ignore */ }
const nav = document.getElementById('rolodex');
const rolodex = createRolodex(nav, tabs, { start, onSelect: (i, dir) => { showNav(); show(i, dir); } });
// The Rolodex bar: hidden by a slide while the page scrolls down, back the moment it scrolls up, and always there near
// the top, when a section changes, when something in it takes the focus, and when a tour starts.
function showNav() { nav.classList.remove('tucked'); }
window.logiShowNav = showNav;
{
  let lastY = window.scrollY, ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY, dy = y - lastY; lastY = y;
      if (y <= nav.offsetHeight || dy < -6) showNav();
      else if (dy > 6 && !document.querySelector('.sheet-back')) nav.classList.add('tucked');
    });
  }, { passive: true });
  nav.addEventListener('focusin', showNav);
}
show(start);
window.logiGo = i => { rolodex.go(typeof i === 'string' ? Math.max(0, tabs.findIndex(t => t.id === i)) : i); return showing; }; // lets pages jump between sections; resolves once the section is drawn
window.logiPage = () => (tabs[current] ? tabs[current].id : null); // which section is open (the page tutorials use it)

// The parked link, if any: js/share-add.js waits for Vdex to be ready (unlocked, no walkthrough running), shows what the
// link holds and adds it only on a tap. A link put in the address of a page that is already open comes the same way.
const showAdd = () => { let link = window.__vdexAdd || ''; window.__vdexAdd = ''; try { link = link || sessionStorage.getItem('vdex-add') || ''; } catch { /* kept in memory only */ } if (link) import('./share-add.js').then(m => m.arrived(link)).catch(() => toast('The shared link could not be opened. Check the connection and try again.')); };
showAdd();
addEventListener('hashchange', () => { if (parkAdd()) showAdd(); });

// A file handed to Vdex: the iPhone app gets it from the phone ("Copy to Vdex"); on Android the share sheet's file is
// parked by the service worker. Either way js/share-in.js asks what it is.
if (native.isApp) native.files.onShared(file => import('./share-in.js').then(m => m.arrived(file)));
if (new URLSearchParams(location.search).get('share') === '1' && 'caches' in window) {
  history.replaceState(null, '', location.pathname);
  caches.open('logi-share').then(async c => {
    const r = await c.match('shared-file'); if (!r) return;
    const name = decodeURIComponent(r.headers.get('X-Name') || 'shared.docx');
    const file = new File([await r.blob()], name, { type: r.headers.get('Content-Type') || '' });
    await c.delete('shared-file');
    import('./share-in.js').then(m => m.arrived(file));
  }).catch(() => {});
}

/* ----------------------- storage / sync sheet ----------------------- */
const cloudBtn = document.getElementById('cloudBtn');
const cloudLabel = document.getElementById('cloudLabel');

function paintCloud() {
  const s = store.cloud.status;
  const text = { off: 'Local', synced: 'Synced', saving: 'Saving…', 'needs-permission': 'Sign in', error: 'Sync error', paused: 'Paused' }[s];
  cloudLabel.textContent = text;
  cloudBtn.dataset.state = s;
}
paintCloud();

cloudBtn.addEventListener('click', () => openStorage());

function openStorage() {
  const panel = storagePanel();
  sheet('Storage, sync & backups', h('div', null, panel.el, h('h3', { class: 'ss-sub' }, 'Backups'), backupPanel()), { onClose: panel.destroy });
}

store.initCloud();
backup.nudgeIfStale();
const idle = window.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 2500 }) : fn => setTimeout(fn, 1200);
idle(() => { import('./pages/gear.js').then(m => m.serviceNudge()); import('./money.js').then(m => m.moneyNudge()); });
// Google's sign-in window has to open straight from a tap, so have its library ready before anyone taps "Sign in again".
let provider = null; try { provider = localStorage.getItem('logi-provider'); } catch { /* blocked storage */ }
if (provider === 'gdrive' || store.db.calSync?.provider === 'google') import('./providers.js').then(p => p.signIn.available('google') && p.loadGIS()).catch(() => {}); // service and overdue-invoice reminders, once the first paint is out of the way
if (!tourSeen()) setTimeout(() => startTour(), 700); // first launch: the set-up walkthrough (your details, calendar, sample people)
initUpdates(); // service worker, offline copy, and the "new version" bar
idle(() => import('./licence.js').then(m => m.initLicence()).catch(() => {})); // the trial and licence (desktop app, website and Play app)

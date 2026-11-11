import { h, toast } from './util.js';
import { createRolodex } from './rolodex.js';
import * as store from './store.js';
import { applyPrefs, openDisplaySettings } from './a11y.js';
import { initInstall } from './install.js';
import { startTour, tourSeen } from './tour.js';
import { initClockBar } from './clock.js';
import { initUpdates } from './update.js';
import { bookings } from './pages/bookings.js';

applyPrefs();
const help = () => import('./tutorials.js').then(m => m.openTutorial()); // the tutorials load on first use
document.getElementById('helpBtn')?.addEventListener('click', help);
window.logiHelp = help; // sheets show a ? too
document.getElementById('displayBtn')?.addEventListener('click', openDisplaySettings);
initInstall(document.getElementById('installBtn'));
initClockBar(document.getElementById('clockbar'));

// The Bookings card is the usual start, so it loads with the app. Every other section is fetched and parsed the first
// time it is opened (the service worker keeps them all offline regardless), which keeps the start-up parse small.
// Sections are known by their id everywhere (window.logiGo('venues')), never by position.
const section = (id, label, icon, load) => ({ id, label, icon, load });
const tabs = [
  { id: bookings.id, label: bookings.label, icon: bookings.icon, page: bookings },
  section('acts', 'Acts', '🎸', () => import('./pages/acts.js').then(m => m.acts)),
  section('people', 'People', '👥', () => import('./pages/people.js').then(m => m.people)),
  section('songs', 'Songs', '🎼', () => import('./pages/songs.js').then(m => m.songs)),
  section('sessions', 'Studio log', '🎙️', () => import('./pages/sessions.js').then(m => m.sessions)),
  section('backline', 'Backline', '🎛️', () => import('./pages/backline.js').then(m => m.backline)),
  section('venues', 'Venues', '📍', () => import('./pages/venues.js').then(m => m.venues)),
  section('money', 'Money', '💰', () => import('./pages/money.js').then(m => m.money)),
  section('tools', 'Tools', '🎚️', () => import('./pages/tools.js').then(m => m.tools)),
  section('insurance', 'Insurance', '🛡️', () => import('./pages/insurance.js').then(m => m.insurance)),
  section('settings', 'Settings', '⚙️', () => import('./pages/settings.js').then(m => m.settings)),
];
window.gigdexPages = () => tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon, page: t.page || null }));
const pageOf = t => (t.page ? Promise.resolve(t.page) : (t.loading || (t.loading = t.load().then(p => { t.page = p; return p; }).catch(e => { t.loading = null; throw e; }))));
const page = document.getElementById('page');
let current = -1;
let cleanup = null;

let showing = Promise.resolve(), showToken = 0;
function show(i, dir = 0) {
  const token = ++showToken;
  current = i;
  try { localStorage.setItem('gigdex-tab', tabs[i].id); } catch { /* private mode */ }
  showing = pageOf(tabs[i]).then(p => {
    if (token !== showToken) return; // the drum moved on while this section was loading
    cleanup && cleanup();
    cleanup = null;
    const holder = h('section', { class: 'page-card' + (dir ? ' fade-in' : ''), 'aria-label': p.label, 'data-page': p.id });
    page.replaceChildren(holder);
    cleanup = p.render(holder) || null;
  }).catch(e => { console.error(e); toast('That section could not be loaded. Check the connection and try again.'); });
  return showing;
}

// Re-render the active page when data changes (live tools keep their own state: their page sets static: true).
// Redraws are coalesced: a burst of changes in one go (an import, a sample loaded) draws the page once.
let redrawQueued = false;
// What identifies a control across a redraw: its kind, its id or label, and the text around it (a checklist box is
// known by its line). The same control in the new page gets the focus back, so ticking by keyboard stays in place.
// A control with an id is known by its id alone, so one whose words change (a status pill: Hold ▾ → Confirmed ▾) keeps it.
const focusKey = el => (el && el !== document.body && page.contains(el) ? (el.id ? `${el.tagName}|#${el.id}` : [el.tagName, el.type || '', el.getAttribute('aria-label') || el.name || '', ((el.closest('label') || el).textContent || '').trim().slice(0, 80)].join('|')) : null);
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
// After the current event, not inside it: a box that saves on change redraws once the browser has moved the focus to
// the next box (Tab or a tap), so focusKey finds that box again in the new page.
store.subscribe(() => { if (!redrawQueued) { redrawQueued = true; setTimeout(redraw, 0); } });

let start = 0;
try { const saved = localStorage.getItem('gigdex-tab'); start = Math.max(0, tabs.findIndex(t => t.id === saved)); } catch { /* ignore */ }
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
// Jump to a section by id ('venues') and resolve once it is drawn. Unknown ids stay where they are.
window.logiGo = id => {
  const i = typeof id === 'number' ? id : tabs.findIndex(t => t.id === id);
  if (i < 0 || i >= tabs.length) return showing;
  if (i === current) return showing;
  rolodex.go(i);
  return showing;
};
window.logiPage = () => (tabs[current] ? tabs[current].id : null); // which section is open (the tutorials use it)

/* ----------------------- backups ----------------------- */
document.getElementById('cloudBtn')?.addEventListener('click', () => import('./backup.js').then(m => m.openBackupSheet()).catch(e => { console.error(e); toast('Backups could not be opened.'); }));

const idle = window.requestIdleCallback ? fn => requestIdleCallback(fn, { timeout: 2500 }) : fn => setTimeout(fn, 1200);
idle(() => import('./backup.js').then(m => m.nudgeIfStale && m.nudgeIfStale()).catch(() => {}));
if (!tourSeen()) setTimeout(() => startTour(), 700); // first launch: the welcome walkthrough
initUpdates(); // service worker, offline copy, and the "new version" bar

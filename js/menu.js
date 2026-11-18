// The menu: the panel that slides in from the side when the hamburger at the top right is tapped. Its markup is in
// index.html, so its rows keep the ids the top bar's buttons had and are there from the start for whoever wires,
// shows or points at them (js/app.js, js/install.js, the walkthroughs). This module, fetched the first time the menu
// is opened, opens and closes it, keeps the keyboard inside it while it is open, and writes the version at its foot.
import { VERSION, BUILD } from './version.js';

const back = document.getElementById('menuBack'), panel = document.getElementById('menu'), btn = document.getElementById('menuBtn'), app = document.getElementById('app');
let open = false, shown = false, wasInert = false;
export const isOpen = () => open;

// What Tab and the arrow keys move between: the close button, the status while it is a button, and the rows that are
// listed (Install comes and goes).
// The keys are taken before the page sees them (the Rolodex behind turns on the arrow keys).
const items = () => [...panel.querySelectorAll('button:not([disabled])')].filter(el => el.offsetParent !== null);
const keys = e => {
  const key = e.key || '';
  if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeMenu(); }
  if (key.startsWith('Arrow')) e.stopPropagation();
  const up = key === 'ArrowUp' || (key === 'Tab' && e.shiftKey), down = key === 'ArrowDown' || (key === 'Tab' && !e.shiftKey);
  if (!up && !down) return;
  const list = items(), at = list.indexOf(document.activeElement);
  if (!list.length) return;
  if (key === 'Tab' && at >= 0 && at !== (up ? 0 : list.length - 1)) return; // inside the panel the browser's own Tab does it
  e.preventDefault();
  list[at < 0 ? (up ? list.length - 1 : 0) : (at + (up ? -1 : 1) + list.length) % list.length].focus();
};

// show: a walkthrough is pointing at the menu, so it is there to look at and not to use (no focus, no keys, no taps).
// Like the search, the menu opens only while the page itself can be used: this file is fetched on the first tap, and
// if a form, the lock or a walkthrough has opened by the time it arrives, the menu stays shut instead of opening
// underneath it and taking the focus away.
export function openMenu({ show = false } = {}) {
  if (open || (app && app.inert && !show)) return;
  open = true; shown = show;
  document.getElementById('menuVersion').textContent = `Vdex ${VERSION}${BUILD !== 'dev' ? ' · build ' + BUILD : ''}`;
  back.classList.toggle('shown', show); back.inert = show;
  back.hidden = false; panel.scrollTop = 0;
  btn.setAttribute('aria-expanded', 'true'); document.body.classList.add('menu-open');
  wasInert = !!(app && app.inert); if (app) app.inert = true; // the page behind is out of reach, as under a sheet
  if (show) return;
  document.addEventListener('keydown', keys, true);
  (panel.querySelector('.menu-row:not([hidden])') || panel).focus({ preventScroll: true }); // it is sliding in: nothing should scroll to meet it
}

// Closes at once; the focus goes back to the hamburger, so whatever opens next (a sheet) returns it there too.
export function closeMenu() {
  if (!open) return;
  open = false;
  back.hidden = true; back.inert = false; back.classList.remove('shown');
  btn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open');
  document.removeEventListener('keydown', keys, true);
  if (app) app.inert = wasInert;
  if (!shown) btn.focus();
}

// The backdrop and the ✕ close it. The backdrop closes on the whole tap, not on its first touch: the tap would
// otherwise finish on the page that has just come back underneath, and take the focus from the hamburger with it.
// Choosing a row closes the menu first (this runs before the row's own listener), and then the row does what it
// does: the tutorial, the install prompt, a sheet. The status at the top is the same while it is a button.
let downOnBack = false;
back.addEventListener('pointerdown', e => { downOnBack = e.target === back; });
back.addEventListener('click', e => { if (e.target === back && downOnBack) closeMenu(); });
panel.addEventListener('click', e => { if (e.target.closest('.menu-row, #menuClose, button.menu-status')) closeMenu(); }, true);
// The page behind does not scroll under the menu: a wheel or a one-finger drag moves the panel when it has more to
// show, and nothing otherwise. Zooming (two fingers, or the wheel with Ctrl) is left alone.
for (const type of ['wheel', 'touchmove']) back.addEventListener(type, e => { if (e.ctrlKey || (e.touches && e.touches.length > 1)) return; if (e.target === back || panel.scrollHeight <= panel.clientHeight) e.preventDefault(); }, { passive: false });

// Spotlight walkthrough: dims the page, cuts a hole over the thing being explained, moves the Rolodex as it goes.
// A step can carry a form (its body) that is saved on Next, so a walkthrough can set things up as well as point.
import { h, nodes } from './util.js';
import { db, update } from './store.js';

// The first-run walkthrough (also Settings → About → Take the tour). The profile card saves what is typed on Next.
const profileStep = {
  title: 'Your details', text: 'They go on your invoices, day sheets and contact card. Change them any time under Settings.',
  body: () => h('div', { class: 'tour-fields' }, ...[['Your name', 'name'], ['Business or project name', 'business'], ['What you do', 'role', 'Producer, band leader, tour manager…'], ['Currency symbol', 'currency', '$, £, €…']].map(([label, key, ph]) =>
    h('label', { class: 'tour-field' }, h('span', null, label), h('input', { type: 'text', value: db.profile[key] || '', 'data-key': key, placeholder: ph || '', 'aria-label': label, autocomplete: 'off' })))),
  onNext: () => {
    const patch = {};
    document.querySelectorAll('.tour-form input[data-key]').forEach(i => { const v = i.value.trim(); if ((db.profile[i.dataset.key] || '') !== v && !(i.dataset.key === 'currency' && !v)) patch[i.dataset.key] = v; });
    if (Object.keys(patch).length) update(d => { d.profile = { ...d.profile, ...patch, updatedAt: Date.now() }; });
  },
};
export const STEPS = [
  { title: 'Welcome to Gigdex', text: 'The booking deck for producers and bands: shows, studio sessions and rehearsals, your acts and people, backline, venues, songs and setlists, settlements and invoices, and the tools you need on the night. This takes about a minute. Tap Skip any time.' },
  profileStep,
  { go: 'bookings', target: ['.binder'], title: 'The Rolodex', text: 'Spin it to move between sections: drag it, tap ▲ ▼, use the arrow keys, or scroll on it.' },
  { go: 'bookings', target: ['.page-head'], title: 'Bookings', text: 'Shows, studio sessions and rehearsals on one calendar. Open one for its times, deal, setlist, guest list, day sheet, settlement and invoice.' },
  { go: 'acts', target: ['.page-head'], title: 'Acts', text: 'The bands and artists you play in, manage or produce: members, links, press kit and tech rider with the input list.' },
  { go: 'songs', target: ['.page-head'], title: 'Songs & setlists', text: 'Keys, tempos and lengths for every song, split sheets for the writers, and setlists that add up to the slot.' },
  { go: 'tools', target: ['.page-head'], title: 'Tools', text: 'A tuner, a metronome with tap tempo, delay times for any tempo, a sound level meter and a set timer.' },
  { go: 'settings', target: ['.page-head'], title: 'Settings', text: 'Your details, quotes and invoices, backups, display and this tour again. Everything stays on this device unless you save a backup.' },
];
const RESUME = 'gigdex-tour-at'; // the step to resume at when a step leaves the page (a calendar sign-in that redirects)
const done = () => { try { localStorage.setItem('gigdex-tour', 'done'); } catch { /* ignore */ } };
export const tourSeen = () => { try { return !!localStorage.getItem('gigdex-tour'); } catch { return true; } };
export const resumeTourAt = n => { try { if (n == null) localStorage.removeItem(RESUME); else localStorage.setItem(RESUME, String(n)); } catch { /* ignore */ } };

// Steps for a sheet, by the sheet's title (its aria-label): sheetTutorial('Edit setlist', steps or () => steps).
// Call at module load. The ? button inside that sheet runs them (js/tutorials.js).
const sheetTours = new Map();
export const sheetTutorial = (title, steps) => { sheetTours.set(title, steps); };
export const sheetSteps = title => sheetTours.get(title) || null;

let active = null;
export const tourActive = () => !!active;
export function startTour(from = 0) {
  let at = from; try { const saved = Number(localStorage.getItem(RESUME)); if (!from && saved) at = saved; localStorage.removeItem(RESUME); } catch { /* ignore */ }
  return runTour(STEPS, { remember: true, from: at });
}
// Runs any list of steps: { title, text, target: [selectors], go?: tabId, before?: fn, body?: ctx => node, onNext?: fn }.
// Steps whose target is not on screen are skipped. A body is a form inside the card (saved by onNext, which may return
// false to stay on the step); ctx has refresh(), next(), stop() and index.
export function runTour(steps, { remember = false, from = 0, footer = null, root = null } = {}) {
  if (active) return;
  const STEPS = steps;
  const app = document.getElementById('app');
  const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' });
  const layer = h('div', { class: 'tour' }, spot, card);
  const wasInert = !!(app && app.inert);
  window.logiShowNav?.(); // the Rolodex bar may be slid away: the tour points at it
  document.body.append(layer); if (app) app.inert = true;
  let i = from, target = null, dir = 1;
  const seen = new Set(); // steps already shown: they keep their place in the count when going back
  const stop = () => { if (!active) return; active = null; layer.remove(); if (app) app.inert = wasInert; window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', keys, true); if (remember) done(); };
  active = { stop };
  // Arrow keys move between steps, except while typing in a field of the card; Escape always leaves.
  const keys = e => { const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && e.key !== 'Escape') return; if (e.key === 'Escape') { e.stopPropagation(); stop(); } else if (e.key === 'ArrowRight') { e.stopPropagation(); next(); } else if (e.key === 'ArrowLeft') { e.stopPropagation(); dir = -1; show(i - 1); } };
  const place = () => {
    if (!target) { spot.classList.add('center'); card.classList.add('center'); return; }
    spot.classList.remove('center'); card.classList.remove('center');
    const r = target.getBoundingClientRect(), pad = 8;
    Object.assign(spot.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    card.style.left = '';
    const below = r.bottom + 16, cardH = card.offsetHeight, fits = below + cardH + 16 < innerHeight;
    card.style.top = (fits ? below : Math.max(16, r.top - 16 - cardH)) + 'px';
  };
  let busy = false; // a tap during a transition must not double-advance
  const show = async n => { if (busy) return; busy = true; try { await step(n); } finally { busy = false; } };
  // The steps that will actually show: a step whose box is not on screen is skipped, so it must not be counted either
  // (a booking with no venue has no venue box). Steps that move to a page or prepare something first are counted, as
  // their box only appears then. Worked out again at every step, so the count and "Done" are always right.
  const find = s => { const scope = (root && root()) || document; return s.target ? s.target.map(sel => { try { return scope.querySelector(sel); } catch { return null; } }).find(el => el && el.offsetParent !== null) || null : null; };
  const willShow = s => !s.target || !!s.go || !!s.before || !!find(s);
  const step = async n => {
    if (n < 0) return;
    if (n >= STEPS.length) return stop();
    i = n; const s = STEPS[n];
    if (s.go) { window.logiGo?.(s.go); await new Promise(r => setTimeout(r, 650)); }
    if (s.before) { try { await s.before(); } catch { /* the step still shows */ } await new Promise(r => setTimeout(r, 250)); }
    target = find(s);
    if (s.target && !target) return step(n + dir); // nothing to point at here, skip
    if (target) { target.scrollIntoView({ block: 'center', inline: 'nearest' }); await new Promise(r => setTimeout(r, 250)); }
    const shown = STEPS.map((x, k) => (k === n || (k > n ? willShow(x) : seen.has(k)) ? k : -1)).filter(k => k >= 0), pos = shown.indexOf(n), isLast = pos === shown.length - 1;
    seen.add(n);
    // Leaving the step forwards runs its onNext first (a form's save); Back never saves.
    const advance = async fn => { if (s.onNext) { try { if ((await s.onNext()) === false) return; } catch { /* carry on */ } } fn(); };
    const forward = () => advance(isLast ? stop : next);
    const body = s.body ? s.body({ refresh: () => show(n), next: forward, stop, index: n }) : null;
    card.replaceChildren(...nodes(
      h('div', { class: 'tour-step muted small' }, `${pos + 1} / ${shown.length}`),
      h('h2', { id: 'tour-title' }, s.title), h('p', null, s.text),
      body && h('form', { class: 'tour-form', noValidate: true, onsubmit: e => { e.preventDefault(); forward(); } }, body),
      h('div', { class: 'tour-actions' },
        h('button', { class: 'btn ghost small', type: 'button', onclick: stop }, 'Skip'), footer && footer(n, stop), h('span', { class: 'spacer' }),
        pos > 0 && h('button', { class: 'btn ghost', type: 'button', onclick: () => { dir = -1; show(n - 1); } }, 'Back'),
        h('button', { class: 'btn primary', type: 'button', onclick: forward }, isLast ? 'Done' : 'Next'))));
    spot.classList.remove('tour-pulse'); void spot.offsetWidth; spot.classList.add('tour-pulse');
    place();
    ((body && card.querySelector('.tour-form input, .tour-form textarea, .tour-form select')) || card.querySelector('.tour-actions .btn.primary'))?.focus();
  };
  const next = () => { dir = 1; show(i + 1); };
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('keydown', keys, true);
  show(i);
  return stop;
}

// Spotlight walkthrough: dims the page, cuts a hole over the thing being explained, moves the Rolodex as it goes.
import { h } from './util.js';

const STEPS = [
  { title: 'Welcome to Logi', text: 'Your whole production in one deck: bookings, crew, kit, venues, insurance, field tools and timecode notes. This tour takes about a minute. Tap Skip any time.' },
  { go: 'bookings', target: ['.binder'], title: 'The Rolodex', text: 'Spin it to move between sections: drag it, tap ▲ ▼, use the arrow keys, or scroll on it.' },
  { go: 'bookings', target: ['.bk-month .page-head', '.page-head'], title: 'Bookings', text: 'Tap a date to see the day, then a booking for its address, contacts, crew and kit. Multi-day shoots span their days.' },
  { go: 'gear', target: ['.seg[role=tablist]', '.page-head'], title: 'Equipment & kits', text: 'Log everything you own, with quantities. Save kits for the shoots you do most and tick one on a booking to load its gear.' },
  { go: 'venues', target: ['.page-head'], title: 'Venues', text: 'Rules, permits, contacts and a map pin for every place you shoot. A booking warns if your kit breaks a venue’s rules.' },
  { go: 'field', target: ['.seg.tools'], title: 'Field tools', text: 'Sun and golden hour, Polaris, white balance, a noise meter and a range finder.' },
  { go: 'tcnotes', target: ['.page-head'], title: 'Timecode notes', text: 'Sync once to your camera’s timecode and every note is stamped for the edit. Link your laptop to write on both at once.' },
  { target: ['#cloudBtn'], title: 'Your data', text: 'Everything stays on this device until you link Dropbox, Google Drive or a synced folder here. Then all your devices share one database.' },
  { target: ['#displayBtn'], title: 'Make it yours', text: 'Text size, bigger buttons, contrast and animation live here, and so does this tour if you want it again.' },
];
const done = () => { try { localStorage.setItem('logi-tour', 'done'); } catch { /* ignore */ } };
export const tourSeen = () => { try { return !!localStorage.getItem('logi-tour'); } catch { return true; } };

let active = null;
export function startTour(from = 0) {
  if (active) return;
  const app = document.getElementById('app');
  const spot = h('div', { class: 'tour-spot', 'aria-hidden': 'true' });
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' });
  const layer = h('div', { class: 'tour' }, spot, card);
  document.body.append(layer); if (app) app.inert = true;
  let i = from, target = null;
  const stop = () => { if (!active) return; active = null; layer.remove(); if (app) app.inert = false; window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('keydown', keys); done(); };
  active = { stop };
  const keys = e => { if (e.key === 'Escape') stop(); else if (e.key === 'ArrowRight' || e.key === 'Enter') next(); else if (e.key === 'ArrowLeft') show(i - 1); };
  const place = () => {
    if (!target) { spot.classList.add('center'); card.classList.add('center'); return; }
    spot.classList.remove('center'); card.classList.remove('center');
    const r = target.getBoundingClientRect(), pad = 8;
    Object.assign(spot.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    card.style.left = '';
    const below = r.bottom + 16, cardH = card.offsetHeight, fits = below + cardH + 16 < innerHeight;
    card.style.top = (fits ? below : Math.max(16, r.top - 16 - cardH)) + 'px';
  };
  const show = async n => {
    if (n < 0) return;
    if (n >= STEPS.length) return stop();
    i = n; const s = STEPS[n];
    if (s.go) { window.logiGo?.(s.go); await new Promise(r => setTimeout(r, 650)); }
    target = s.target ? s.target.map(sel => document.querySelector(sel)).find(el => el && el.offsetParent !== null) || null : null;
    if (s.target && !target) return show(n + (n >= i ? 1 : -1)); // nothing to point at here, skip
    if (target) { target.scrollIntoView({ block: 'center', inline: 'nearest' }); await new Promise(r => setTimeout(r, 250)); }
    card.replaceChildren(
      h('div', { class: 'tour-step muted small' }, `${n + 1} / ${STEPS.length}`),
      h('h2', { id: 'tour-title' }, s.title), h('p', null, s.text),
      h('div', { class: 'tour-actions' },
        h('button', { class: 'btn ghost small', onclick: stop }, 'Skip'), h('span', { class: 'spacer' }),
        n > 0 && h('button', { class: 'btn ghost', onclick: () => show(n - 1) }, 'Back'),
        h('button', { class: 'btn primary', onclick: next }, n === STEPS.length - 1 ? 'Done' : 'Next')));
    spot.classList.remove('tour-pulse'); void spot.offsetWidth; spot.classList.add('tour-pulse');
    place();
    card.querySelector('.btn.primary')?.focus();
  };
  const next = () => show(i + 1);
  window.addEventListener('resize', place); window.addEventListener('scroll', place, true); document.addEventListener('keydown', keys);
  show(i);
  return stop;
}

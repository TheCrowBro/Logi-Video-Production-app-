// The session clock. One clock runs at a time, started from a studio session's or rehearsal's Session clock box; while
// it runs, a slim strip under the Rolodex shows it on every page with Break / Back and Stop, so the day can be paused or
// stopped from anywhere. Shifts are kept in the store (db.shifts), so the clock carries on through a reload, and the
// hours it counts (breaks taken off) feed the invoice through clockHours(). Adapted from Vdex's js/clock.js and
// js/hours.js, without the overtime rules, the standard day or the break allowance.
//
// shift = { id, bookingId, start, end (null while running), breaks: [{ start, end (null while on break) }] }, times in ms.
import { h, toast, announce, uid } from './util.js';
import { db, byId, update, subscribe } from './store.js';
import { bookingTitle, fmtMin, fmtMoney, sessionFee, sessionHoursPlanned, daysSpan } from './model.js';
import { haptic } from './a11y.js';

const H = 36e5;
const num = v => Number(v) || 0;

/* ------------------------------- arithmetic ------------------------------- */
// The time a shift was worked between from and to: its span clipped to the window, less its breaks clipped the same
// way. A running shift (or break) runs up to now.
export function workedIn(s, from = -Infinity, to = Infinity, now = Date.now()) {
  if (!s || !num(s.start)) return 0;
  const lo = num(s.start), hi = s.end ? num(s.end) : now;
  const clip = (a, z) => Math.max(0, Math.min(z, to, hi) - Math.max(a, from, lo));
  let ms = clip(lo, hi);
  for (const b of Array.isArray(s.breaks) ? s.breaks : []) if (b && num(b.start)) ms -= clip(num(b.start), b.end ? num(b.end) : now);
  return Math.max(0, ms);
}
export const workedMs = (s, now = Date.now()) => workedIn(s, -Infinity, Infinity, now);
export function breakMs(s, now = Date.now()) {
  if (!s || !num(s.start)) return 0;
  const lo = num(s.start), hi = s.end ? num(s.end) : now;
  return (Array.isArray(s.breaks) ? s.breaks : []).reduce((t, b) => (b && num(b.start) ? t + Math.max(0, Math.min(hi, b.end ? num(b.end) : now) - Math.max(lo, num(b.start))) : t), 0);
}
export const onBreak = s => !!(s && !s.end && (s.breaks || []).some(b => b && !b.end));
export const currentBreak = s => (s && !s.end && (s.breaks || []).find(b => b && !b.end)) || null;
// The running shift, or null. There is never more than one.
export const runningShift = () => db.shifts.find(s => s && !s.end && num(s.start)) || null;
// A booking's shifts, newest first.
export const shiftsOf = bookingId => (bookingId ? db.shifts.filter(s => s.bookingId === bookingId && num(s.start)) : []).sort((a, b) => num(b.start) - num(a.start));
export const bookingMs = (bookingId, now = Date.now()) => shiftsOf(bookingId).reduce((t, s) => t + workedMs(s, now), 0);
const midnight = now => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const todayMs = (bookingId, now = Date.now()) => { const t0 = midnight(now); return shiftsOf(bookingId).reduce((t, s) => t + workedIn(s, t0, t0 + 864e5, now), 0); };
// Hours worked on a booking by the clock, breaks taken off, the running shift included (to the hundredth of an hour).
export function clockHours(bookingId) { return Math.round((bookingMs(bookingId) / H) * 100) / 100; }
// The clock's hours as they are billed: to the quarter hour, as the invoice (money.bookingHours) and the income do.
export const billedHours = bookingId => Math.round(clockHours(bookingId) * 4) / 4;

// "1:23:45" (hours always shown), and "2h 15m" through the shared minutes formatter.
export const fmtClock = ms => { const s = Math.max(0, Math.floor(num(ms) / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtHm = ms => fmtMin(num(ms) / 6e4);
const spoken = ms => { const m = Math.floor(num(ms) / 6e4), hh = Math.floor(m / 60), mm = m % 60; return [hh && `${hh} hour${hh === 1 ? '' : 's'}`, `${mm} minute${mm === 1 ? '' : 's'}`].filter(Boolean).join(' '); };
export const clockTime = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* --------------------------------- actions --------------------------------- */
// Start the clock on a booking. Returns the new shift, or null when a clock is already running (one at a time).
export function startShift(bookingId) {
  if (runningShift()) return null;
  const now = Date.now(), s = { id: uid(), bookingId: bookingId || '', start: now, end: null, breaks: [], createdAt: now, updatedAt: now };
  update(d => { d.shifts.push(s); });
  return byId('shifts', s.id);
}
// Stop the running clock (an open break ends with it). Returns the stopped shift, or null.
export function stopShift() {
  const s = runningShift(); if (!s) return null;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); if (!x) return; (x.breaks || []).forEach(b => { if (b && !b.end) b.end = now; }); x.end = now; x.updatedAt = now; });
  return byId('shifts', s.id);
}
export function startBreak() {
  const s = runningShift(); if (!s || onBreak(s)) return;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); if (!x) return; x.breaks = [...(x.breaks || []), { start: now, end: null }]; x.updatedAt = now; });
}
export function endBreak() {
  const s = runningShift(); if (!s) return;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); if (!x) return; (x.breaks || []).forEach(b => { if (b && !b.end) b.end = now; }); x.updatedAt = now; });
}

/* ------------------------------ words for a booking ------------------------------ */
const kindWord = b => (b && b.kind === 'rehearsal' ? 'Rehearsal' : b && b.kind === 'session' ? 'Studio' : 'Clock');
const titleOf = s => { const b = s && byId('bookings', s.bookingId); return b ? bookingTitle(b) : 'a booking that was deleted'; };

// Live numbers: any element with data-sd-tick="<kind>" (and data-sd-for="<booking id>") is refreshed every second
// while a clock runs, so a page never has to redraw itself to keep the time moving.
function tickValue(kind, bookingId, now) {
  const live = runningShift();
  switch (kind) {
    case 'shift': return live ? fmtClock(workedMs(live, now)) : '';
    case 'break': { const br = currentBreak(live); return br ? fmtClock(now - num(br.start)) : ''; }
    case 'strip': { const br = currentBreak(live); return live ? fmtClock(br ? now - num(br.start) : workedMs(live, now)) : ''; }
    case 'today': return fmtHm(todayMs(bookingId, now));
    case 'total': return fmtHm(bookingMs(bookingId, now));
    case 'fee': { const b = byId('bookings', bookingId); return b ? fmtMoney(sessionFee(b, billedHours(bookingId))) : ''; }
    default: return null;
  }
}
// Planned hours for the whole booking: the day's start to finish, times the days of a multi-day block.
export const plannedHours = b => sessionHoursPlanned(b) * Math.max(1, daysSpan(b));
function tickAll(scope = document) {
  const now = Date.now();
  for (const el of scope.querySelectorAll('[data-sd-tick]')) {
    const kind = el.dataset.sdTick, id = el.dataset.sdFor;
    if (kind === 'bar') {
      const b = byId('bookings', id), plan = b ? plannedHours(b) * H : 0, done = bookingMs(id, now);
      el.style.width = (plan ? Math.min(100, (done / plan) * 100) : 0) + '%';
      el.parentElement && el.parentElement.classList.toggle('over', !!plan && done > plan);
      continue;
    }
    const t = tickValue(kind, id, now);
    if (t != null && el.textContent !== t) el.textContent = t;
  }
}
export const tick = (kind, bookingId, attrs = {}) => { const el = h('span', { ...attrs, 'data-sd-tick': kind, 'data-sd-for': bookingId || '' }); el.textContent = tickValue(kind, bookingId, Date.now()) || ''; return el; };

// Redrawing a box that holds the focus (a keyboard user on Stop while the clock ticks) puts the focus back on the
// button with the same id, or failing that the same text.
function repaint(el, fill) {
  const a = document.activeElement, had = el.contains(a) ? { id: a.id, text: a.textContent } : null;
  fill();
  if (!had) return;
  const again = (had.id && el.querySelector('#' + CSS.escape(had.id))) || [...el.querySelectorAll('button')].find(x => x.textContent === had.text);
  if (again) again.focus({ preventScroll: true });
}
// After an action that redraws the page, the button that took over the pressed one's place keeps the focus (the page
// itself when that button is gone, as when Stop hides the strip). had: the pressed button held the focus.
const hadFocus = e => document.activeElement === e.currentTarget;
function keepFocus(id, had) {
  if (!had) return;
  setTimeout(() => { if (document.activeElement && document.activeElement !== document.body) return; const el = id && document.getElementById(id); if (el) el.focus({ preventScroll: true }); else document.getElementById('page')?.focus({ preventScroll: true }); }, 0);
}

/* --------------------------------- buttons --------------------------------- */
function doStart(b, e) {
  const had = hadFocus(e), next = e.currentTarget.dataset.next;
  const s = startShift(b.id);
  if (!s) { const live = runningShift(); toast(`The clock is already running on “${titleOf(live)}”. Stop it first.`); return; }
  haptic(30); announce(`${kindWord(b)} clock started`);
  keepFocus(next, had);
}
function doBreak(e) {
  const had = hadFocus(e), id = e.currentTarget.id;
  const live = runningShift(); if (!live) return;
  if (onBreak(live)) { endBreak(); haptic(); announce('Back from the break. The clock is running again.'); }
  else { startBreak(); haptic(20); announce('On a break. The clock is paused.'); }
  keepFocus(id, had);
}
function doStop(e) {
  const had = hadFocus(e), next = e.currentTarget.dataset.next;
  const s = stopShift(); if (!s) return;
  haptic(30);
  toast(`Logged ${fmtHm(workedMs(s))} on ${titleOf(s)}`);
  announce(`Clock stopped. ${spoken(workedMs(s))} logged.`);
  keepFocus(next, had);
}
// [Take a break | Back] [Stop] while this booking's clock runs; [Start] otherwise (greyed while another one runs).
function buttons(b, where) {
  const live = runningShift(), mine = !!live && !!b && live.bookingId === b.id;
  const key = where === 'bar' ? 'sd-bar' : `sd-card-${b ? b.id : 'x'}`;
  if (mine || (where === 'bar' && live)) {
    const breaking = onBreak(live);
    // In the strip the words hide on a narrow phone and the button keeps its name for screen readers.
    const label = (ico, text, name) => (where === 'bar' ? [h('span', { 'aria-hidden': 'true' }, ico), h('span', { class: 'sd-btn-label' }, ' ' + text)] : `${ico} ${name || text}`);
    return [
      h('button', { type: 'button', id: key + '-break', class: 'btn ' + (breaking ? 'primary' : 'ghost') + (where === 'bar' ? ' small' : ''), 'aria-pressed': breaking ? 'true' : 'false', 'aria-label': where === 'bar' ? (breaking ? 'Back from the break' : 'Take a break') : null, title: where === 'bar' ? (breaking ? 'Back from the break' : 'Take a break') : null, onclick: doBreak }, breaking ? label('▶', 'Back') : label('☕', 'Break', 'Take a break')),
      h('button', { type: 'button', id: key + '-stop', class: 'btn ' + (breaking ? 'ghost' : 'primary') + (where === 'bar' ? ' small' : ''), 'aria-label': where === 'bar' ? 'Stop the clock' : null, title: where === 'bar' ? 'Stop the clock' : null, 'data-next': key + '-start', onclick: doStop }, label('■', 'Stop')),
    ];
  }
  const word = b && b.kind === 'rehearsal' ? 'rehearsal' : 'session';
  return [h('button', { type: 'button', id: key + '-start', class: 'btn primary', disabled: !!live || !b, 'data-next': key + '-break', onclick: e => doStart(b, e) }, `● Start ${word}`)];
}

/* ------------------------------ the booking's card ------------------------------ */
// The clock on a booking's page: Start session, then Take a break / Back and Stop, with the time running live.
export function clockCard(b) {
  if (!b) return h('div');
  const live = runningShift(), mine = !!live && live.bookingId === b.id, breaking = mine && onBreak(live);
  const today = todayMs(b.id);
  const state = mine ? (breaking ? 'On a break' : 'Clock running') : 'Clock stopped';
  const el = h('div', { class: 'clock card-clock sd-clock' + (mine ? (breaking ? ' on-break' : ' working') : ''), 'data-sd-booking': b.id },
    h('div', { class: 'sd-clock-face' },
      h('span', { class: 'clock-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), state),
      mine && h('span', { class: 'sd-clock-big' }, h('span', { class: 'sr-only' }, 'Worked so far: '), tick('shift', b.id, { role: 'timer', 'aria-live': 'off' }))),
    h('div', { class: 'muted small sd-clock-sub' },
      mine
        ? [`Started ${clockTime(live.start)}`, breaking ? [' · break ', tick('break', b.id)] : (breakMs(live) >= 6e4 ? ` · breaks ${fmtHm(breakMs(live))}` : '')]
        : today > 0 ? [tick('today', b.id), ' logged today'] : `Start the clock when the ${b.kind === 'rehearsal' ? 'rehearsal' : 'session'} starts. Breaks are taken off.`),
    live && !mine && h('p', { class: 'small muted sd-clock-other' }, `The clock is running on “${titleOf(live)}”. Stop it there, or in the strip at the top, to start it here.`),
    h('div', { class: 'clock-btns' }, ...buttons(b, 'card')),
    mine && Date.now() - num(live.start) > 16 * H && h('div', { class: 'warn small' }, `Still running since ${new Date(live.start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockTime(live.start)}. Forgot to stop it? Stop now, then fix the finish time in the list of shifts.`));
  return el;
}

/* ------------------------------ the strip ------------------------------ */
// The strip under the Rolodex: "⏺ Studio · Title · 1:23:45" with Break / Back and Stop, shown only while a clock runs.
// The time ticks every second without a redraw; screen readers hear it at most once a minute.
let started = false;
export function initClockBar(root) {
  if (!root || root.dataset.sdReady) return;
  root.dataset.sdReady = '1';
  root.setAttribute('aria-live', 'off'); // the visible time changes every second: the region below speaks for it
  const inner = h('div', { class: 'sd-bar' });
  const sr = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  root.replaceChildren(inner, sr);
  let said = null; // what the screen reader last heard about: mode and minute
  const speak = live => {
    if (!live) { said = null; return; }
    const br = currentBreak(live), ms = br ? Date.now() - num(br.start) : workedMs(live);
    const key = (br ? 'b' : 'w') + Math.floor(ms / 6e4);
    if (said && said[0] === key[0] && said !== key) sr.textContent = br ? `On a break for ${spoken(ms)}` : `${kindWord(byId('bookings', live.bookingId))} clock: ${spoken(ms)} worked`;
    said = key;
  };
  const draw = () => {
    const live = runningShift();
    root.hidden = !live;
    if (!live) { inner.replaceChildren(); sr.textContent = ''; speak(null); return; }
    const b = byId('bookings', live.bookingId), breaking = onBreak(live);
    const kind = breaking ? 'On a break' : kindWord(b), name = b ? bookingTitle(b) : 'Deleted booking';
    // "Studio · Title" on one line; on a phone the kind sits small above the title, so the title gets the width.
    const words = [h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'sd-strip-text' }, h('span', { class: 'sd-strip-kind' }, kind), h('span', { class: 'sd-strip-sep' }, ' · '), h('span', { class: 'sd-strip-name' }, name))];
    repaint(inner, () => inner.replaceChildren(h('div', { class: 'clock strip sd-strip' + (breaking ? ' on-break' : ' working') },
      b
        ? h('button', { type: 'button', class: 'sd-strip-title', title: 'Open the booking', 'aria-label': `${kind} · ${name}. Open the booking`, onclick: () => import('./pages/bookings.js').then(m => m.openBooking(b.id)).catch(() => {}) }, words)
        : h('span', { class: 'sd-strip-title' }, words),
      h('span', { class: 'sd-strip-time' }, h('span', { class: 'sr-only' }, breaking ? 'Break time: ' : 'Worked: '), tick('strip', live.bookingId, { role: 'timer', 'aria-live': 'off' })),
      h('div', { class: 'sd-strip-btns' }, ...buttons(b || { id: live.bookingId }, 'bar')))));
    speak(live);
  };
  draw();
  subscribe(draw);
  if (!started) {
    started = true;
    setInterval(() => { if (document.hidden) return; const live = runningShift(); if (!live) return; tickAll(); speak(live); }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { draw(); tickAll(); } });
  }
}

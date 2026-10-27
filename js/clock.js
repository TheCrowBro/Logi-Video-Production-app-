// The clock bar under the Rolodex: appears on a shoot day, starts/stops the hours on that booking, and tracks breaks
// against the length approved for the production.
import { h, toast, announce, todayISO, fmtShort } from './util.js';
import { db, byId, subscribe, activeBookings, covers } from './store.js';
import { running, onBreak, workedMs, breakMs, startShift, stopShift, toggleBreak, fmtClock, fmtHm, allowanceFor, openHoursSheet } from './hours.js';
import { haptic } from './a11y.js';

const S = { choice: null, warned: null, timer: null };
export function initClockBar(root) {
  if (!root) return;
  const todays = () => activeBookings().filter(b => covers(b, todayISO())).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const draw = () => {
    const live = running(), list = todays();
    const liveBooking = live && byId('bookings', live.bookingId);
    root.hidden = !live && !list.length;
    if (root.hidden) { root.replaceChildren(); return; }
    const chosen = live ? liveBooking : (list.find(b => b.id === S.choice) || list[0]);
    const now = Date.now();
    const todayShifts = db.shifts.filter(s => s.date === todayISO() && chosen && s.bookingId === chosen.id);
    const workedToday = todayShifts.reduce((t, s) => t + workedMs(s, now), 0), breaksToday = todayShifts.reduce((t, s) => t + breakMs(s, now), 0);
    const allowance = chosen ? allowanceFor(chosen) : 0, over = breaksToday - allowance * 6e4;
    if (live && onBreak(live) && over >= 0 && S.warned !== live.id) { S.warned = live.id; haptic(60); announce('Approved break used up'); toast('Approved break used up'); }
    const breaking = live && onBreak(live);
    root.replaceChildren(h('div', { class: 'clock' + (live ? (breaking ? ' on-break' : ' working') : '') },
      h('div', { class: 'clock-head' },
        list.length > 1 && !live
          ? h('select', { 'aria-label': 'Project', onchange: e => { S.choice = e.target.value; draw(); } }, list.map(b => h('option', { value: b.id, selected: chosen && b.id === chosen.id }, b.title)))
          : h('span', { class: 'clock-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), chosen ? chosen.title : 'Deleted booking'),
        h('span', { class: 'clock-sub muted small' }, live
          ? (breaking ? `On break · ${fmtClock(breaksToday)} of ${allowance} min` : `Working · ${fmtClock(workedMs(live, now))}`)
          : `Shoot day · ${workedToday ? fmtHm(workedToday) + ' logged today' : 'not started'}`)),
      h('div', { class: 'clock-btns' },
        live
          ? h('button', { class: 'btn primary', onclick: () => { const s = stopShift(); if (s) { toast(`Logged ${fmtHm(workedMs(s))} on ${byId('bookings', s.bookingId)?.title || 'the booking'}`); haptic(30); } } }, '■ Stop work')
          : h('button', { class: 'btn primary', disabled: !chosen, onclick: () => { startShift(chosen.id); haptic(30); announce('Clock started'); } }, '● Start work'),
        live && h('button', { class: 'btn ghost' + (over >= 0 ? ' over' : ''), onclick: () => { toggleBreak(); haptic(); }, 'aria-pressed': breaking }, breaking ? '▶ Back to work' : '☕ Break'),
        h('button', { class: 'icon-btn', 'aria-label': 'Hours and statistics', onclick: () => openHoursSheet() }, '📊')),
      live && breaking && h('div', { class: 'clock-break small' + (over >= 0 ? ' overrun' : '') }, over >= 0 ? `Over the approved ${allowance} min by ${fmtClock(over)}` : `${fmtClock(-over)} of the approved break left`),
      live && !breaking && breaksToday > 0 && h('div', { class: 'clock-break small muted' }, `Breaks today ${fmtHm(breaksToday)} of ${allowance} min approved`),
      live && now - live.start > 16 * 36e5 && h('div', { class: 'warn small' }, `Still running since ${fmtShort(live.date)} ${new Date(live.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Forgot to stop? Stop now, then fix the time under 📊.`)));
  };
  draw();
  subscribe(draw);
  // tick once a second while something is running and the tab is visible
  setInterval(() => { if (!document.hidden && running()) draw(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
}

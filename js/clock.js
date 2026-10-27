// The clock bar under the Rolodex: appears on a shoot day, starts/stops the hours on that booking, and tracks breaks
// against the length approved for the production.
import { h, toast, announce, todayISO, fmtShort } from './util.js';
import { db, byId, subscribe, activeBookings, covers } from './store.js';
import { running, onBreak, workedMs, breakMs, startShift, stopShift, startBreak, endBreak, currentBreak, BREAK_CHOICES, breakLabel, fmtClock, fmtHm, allowanceFor, openHoursSheet } from './hours.js';
import { sheet } from './util.js';
import { haptic } from './a11y.js';
import * as notify from './notify.js';

const S = { choice: null, warned: null, timesUp: null, timer: null };
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
    const breaking = live && onBreak(live), br = breaking ? currentBreak(live) : null;
    const brElapsed = br ? now - br.start : 0, brLeft = br && br.planned ? br.planned * 6e4 - brElapsed : null;
    if (br && brLeft != null && brLeft <= 0 && S.timesUp !== br.start) { S.timesUp = br.start; haptic(80); announce('Break time is up'); toast(`Your ${breakLabel(br.planned)} break is up`); }
    notify.scheduleBreak(br, br ? breakLabel(br.planned) : '', () => { S.timesUp = br.start; });
    notify.holdScreen(!!br);
    if (live && breaking && over >= 0 && S.warned !== live.id) { S.warned = live.id; haptic(60); announce('Approved break used up'); toast('Approved break for today used up'); if (document.hidden) notify.notifyAllowanceUsed(); }
    root.replaceChildren(h('div', { class: 'clock' + (live ? (breaking ? ' on-break' : ' working') : '') },
      h('div', { class: 'clock-head' },
        list.length > 1 && !live
          ? h('select', { 'aria-label': 'Project', onchange: e => { S.choice = e.target.value; draw(); } }, list.map(b => h('option', { value: b.id, selected: chosen && b.id === chosen.id }, b.title)))
          : h('span', { class: 'clock-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), chosen ? chosen.title : 'Deleted booking'),
        h('span', { class: 'clock-sub muted small' }, live
          ? (breaking ? (brLeft != null ? (brLeft > 0 ? `Break · ${fmtClock(brLeft)} left of ${breakLabel(br.planned)}` : `Break over by ${fmtClock(-brLeft)}`) : `On break · ${fmtClock(brElapsed)}`) : `Working · ${fmtClock(workedMs(live, now))}`)
          : `Shoot day · ${workedToday ? fmtHm(workedToday) + ' logged today' : 'not started'}`)),
      h('div', { class: 'clock-btns' },
        live
          ? h('button', { class: 'btn primary', onclick: () => { const s = stopShift(); if (s) { toast(`Logged ${fmtHm(workedMs(s))} on ${byId('bookings', s.bookingId)?.title || 'the booking'}`); haptic(30); } } }, '■ Stop work')
          : h('button', { class: 'btn primary', disabled: !chosen, onclick: () => { startShift(chosen.id); haptic(30); announce('Clock started'); } }, '● Start work'),
        live && h('button', { class: 'btn ghost' + ((breaking && brLeft != null && brLeft <= 0) || over >= 0 ? ' over' : ''), onclick: () => { if (breaking) { endBreak(); haptic(); } else chooseBreak(chosen, allowance, breaksToday); }, 'aria-pressed': breaking }, breaking ? '▶ Back to work' : '☕ Break'),
        h('button', { class: 'icon-btn', 'aria-label': 'Hours and statistics', onclick: () => openHoursSheet() }, '📊')),
      live && breaking && h('div', { class: 'clock-break small' + (over >= 0 ? ' overrun' : ' muted') }, over >= 0 ? `Over today’s approved ${allowance} min by ${fmtClock(over)}` : `Breaks today ${fmtHm(breaksToday)} · ${fmtClock(-over)} of the approved ${allowance} min left`),
      live && !breaking && breaksToday > 0 && h('div', { class: 'clock-break small muted' }, `Breaks today ${fmtHm(breaksToday)} of ${allowance} min approved`),
      live && now - live.start > 16 * 36e5 && h('div', { class: 'warn small' }, `Still running since ${fmtShort(live.date)} ${new Date(live.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Forgot to stop? Stop now, then fix the time under 📊.`)));
  };
  // Pick how long the break is; the bar counts it down and says when it's up.
  function chooseBreak(booking, allowance, usedMs) {
    const leftMin = Math.max(0, Math.round((allowance * 6e4 - usedMs) / 6e4));
    const { close } = sheet('Take a break', h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, `${leftMin} min of today’s approved ${allowance} min left${booking && booking.breakNote ? ' · ' + booking.breakNote : ''}. The clock pauses until you tap Back to work.`),
      notifyLine(),
      h('div', { class: 'break-grid' }, BREAK_CHOICES.map(([m, label]) => h('button', { class: 'btn ' + (m <= leftMin ? 'primary' : 'ghost'), onclick: () => { close(); startBreak(m); haptic(20); announce(`Break started, ${label}`); } }, label, h('small', null, m <= leftMin ? 'within approved' : `${m - leftMin} min over`))))));
  }
  function notifyLine() {
    const perm = notify.permission(), on = notify.notifyPrefs().enabled;
    if (perm === 'unsupported') return null;
    if (perm === 'granted' && on) return h('p', { class: 'small muted' }, '🔔 You’ll get a notification when the break is up.');
    if (perm === 'denied') return h('p', { class: 'small muted' }, '🔕 Notifications are blocked for this site in the browser settings.');
    return h('button', { class: 'btn ghost small', onclick: async e => { const r = await notify.requestPermission(); e.target.replaceWith(h('p', { class: 'small muted' }, r === 'granted' ? '🔔 You’ll get a notification when the break is up.' : '🔕 Notifications not allowed.')); } }, '🔔 Notify me when the break is up');
  }
  // The notification's "Back to work" button and "5 more min" arrive here from the service worker.
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'break-end') { if (running() && onBreak(running())) { endBreak(); toast('Back to work'); } }
    else if (d.type === 'break-extend') { const s = running(), br = s && currentBreak(s); if (br) { notify.cancelBreak(); const planned = (br.planned || 0) + 5; import('./store.js').then(st => st.update(d2 => { const x = d2.shifts.find(y => y.id === s.id); const b2 = (x.breaks || []).find(y => !y.end); if (b2) b2.planned = planned; })); toast('5 more minutes'); } }
  });
  draw();
  subscribe(draw);
  // tick once a second while something is running and the tab is visible
  setInterval(() => { if (!document.hidden && running()) draw(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
}

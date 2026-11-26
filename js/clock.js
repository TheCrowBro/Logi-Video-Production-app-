// The shoot-day clock. Its controls live in the Hours box of the booking (Start work, Stop work, breaks, today's total);
// while the clock runs, a slim strip under the Rolodex shows the time and the same buttons on every page, so the day can
// be stopped or paused from anywhere. On an edit day the hours are logged as editing. The strip's loop also owns the
// break countdown's side effects: the notification, the wake lock, the "break's up" and "allowance used" warnings.
import { h, nodes, toast, announce, todayISO, fmtShort } from './util.js';
import { db, byId, subscribe, isEditDay, covers } from './store.js';
import { running, onBreak, workedMs, breakMs, startShift, stopShift, startBreak, endBreak, currentBreak, BREAK_CHOICES, breakLabel, fmtClock, fmtHm, allowanceFor, openHoursSheet, kindOf } from './hours.js';
import { sheet } from './util.js';
import { haptic } from './a11y.js';
import * as notify from './notify.js';

const S = { warned: null, timesUp: null };
const cards = new Set(); // the clock cards drawn on booking pages, kept in step with the strip
const editToday = b => !!b && isEditDay(b, todayISO()) && !covers(b, todayISO());

// Where the clock stands for one booking right now.
function stateFor(b) {
  const live = running(), now = Date.now(), mine = live && live.bookingId === b.id ? live : null;
  const todayShifts = db.shifts.filter(s => s.date === todayISO() && s.bookingId === b.id);
  const workedToday = todayShifts.reduce((t, s) => t + workedMs(s, now), 0), breaksToday = todayShifts.reduce((t, s) => t + breakMs(s, now), 0);
  const allowance = allowanceFor(b), over = breaksToday - allowance * 6e4;
  const breaking = !!(mine && onBreak(mine)), br = breaking ? currentBreak(mine) : null;
  const brElapsed = br ? now - br.start : 0, brLeft = br && br.planned ? br.planned * 6e4 - brElapsed : null;
  return { live, mine, now, workedToday, breaksToday, allowance, over, breaking, br, brElapsed, brLeft };
}
const subLine = st => (st.mine
  ? (st.breaking ? (st.brLeft != null ? (st.brLeft > 0 ? `Break · ${fmtClock(st.brLeft)} left of ${breakLabel(st.br.planned)}` : `Break over by ${fmtClock(-st.brLeft)}`) : `On break · ${fmtClock(st.brElapsed)}`) : `Working · ${fmtClock(workedMs(st.mine, st.now))}`)
  : `${st.workedToday ? fmtHm(st.workedToday) + ' logged today' : 'not started'}`);
function buttons(b, st) {
  if (st.mine) return [
    h('button', { class: 'btn primary', onclick: () => { const s = stopShift(); if (s) { toast(`Logged ${fmtHm(workedMs(s))} on ${byId('bookings', s.bookingId)?.title || 'the booking'}`); haptic(30); } } }, '■ Stop work'),
    h('button', { class: 'btn ghost' + ((st.breaking && st.brLeft != null && st.brLeft <= 0) || st.over >= 0 ? ' over' : ''), onclick: () => { if (st.breaking) { endBreak(); haptic(); } else chooseBreak(b, st.allowance, st.breaksToday); }, 'aria-pressed': st.breaking }, st.breaking ? '▶ Back to work' : '☕ Break'),
  ];
  const edit = !covers(b, todayISO()); // not a shoot day: the hours count as editing
  return [h('button', { class: 'btn primary', disabled: !!st.live, title: st.live ? 'The clock is already running on another booking' : '', onclick: () => { startShift(b.id, edit ? 'edit' : 'shoot'); haptic(30); announce('Clock started'); } }, edit ? '✂ Start edit session' : '● Start work')];
}
const breakLines = st => [
  st.mine && st.breaking && h('div', { class: 'clock-break small' + (st.over >= 0 ? ' overrun' : ' muted') }, st.over >= 0 ? `Over today’s approved ${st.allowance} min by ${fmtClock(st.over)}` : `Breaks today ${fmtHm(st.breaksToday)} · ${fmtClock(-st.over)} of the approved ${st.allowance} min left`),
  st.mine && !st.breaking && st.breaksToday > 0 && h('div', { class: 'clock-break small muted' }, `Breaks today ${fmtHm(st.breaksToday)} of ${st.allowance} min approved`),
  st.mine && st.now - st.mine.start > 16 * 36e5 && h('div', { class: 'warn small' }, `Still running since ${fmtShort(st.mine.date)} ${new Date(st.mine.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Forgot to stop? Stop now, then fix the time under 📊.`),
];

// The clock on a booking's page: today's state, Start / Stop / Break, and the day's breaks. Drawn again by the strip's
// loop every second while the clock runs, and on every change.
export function clockCard(b) {
  for (const c of cards) if (!c.isConnected) cards.delete(c); // cards of pages that have gone
  const el = h('div', { class: 'clock card-clock', 'data-id': b.id });
  cards.add(el); paintCard(el);
  return el;
}
// Repainting a box that holds the focus (a keyboard user on Stop work while the clock ticks) keeps the focus on the same button.
function repaint(el, fill) {
  const had = el.contains(document.activeElement) ? document.activeElement.textContent : null;
  fill();
  if (had != null) { const again = [...el.querySelectorAll('button')].find(x => x.textContent === had); if (again) again.focus({ preventScroll: true }); }
}
function paintCard(el) {
  const b = byId('bookings', el.dataset.id); if (!b) { el.replaceChildren(); return; }
  const st = stateFor(b);
  el.className = 'clock card-clock' + (st.mine ? (st.breaking ? ' on-break' : ' working') : '');
  const label = st.mine ? (kindOf(st.mine) === 'edit' ? '✂ Editing' : 'Shoot day') : editToday(b) ? '✂ Edit day' : covers(b, todayISO()) ? 'Shoot day' : 'Not a shoot day';
  repaint(el, () => el.replaceChildren(...nodes(
    h('div', { class: 'clock-head' }, h('span', { class: 'clock-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), label), h('span', { class: 'clock-sub muted small' }, subLine(st))),
    st.live && !st.mine && h('p', { class: 'small muted' }, `The clock is running on “${byId('bookings', st.live.bookingId)?.title || 'another booking'}”: stop it there, or in the strip at the top, before starting here.`),
    h('div', { class: 'clock-btns' }, ...buttons(b, st), h('button', { class: 'icon-btn', 'aria-label': 'Hours and statistics', onclick: () => openHoursSheet(b.id) }, '📊')),
    ...breakLines(st))));
}

export function initClockBar(root) {
  if (!root) return;
  const draw = () => {
    const live = running(), b = live && byId('bookings', live.bookingId);
    root.hidden = !live;
    if (live) {
      const st = stateFor(b || { id: live.bookingId });
      // Side effects of the break countdown, once per tick, wherever the controls are shown.
      if (st.br && st.brLeft != null && st.brLeft <= 0 && S.timesUp !== st.br.start) { S.timesUp = st.br.start; haptic(80); announce('Break time is up'); toast(`Your ${breakLabel(st.br.planned)} break is up`); }
      notify.scheduleBreak(st.br, st.br ? breakLabel(st.br.planned) : '', () => { S.timesUp = st.br.start; });
      notify.holdScreen(!!st.br);
      if (st.breaking && st.over >= 0 && S.warned !== live.id) { S.warned = live.id; haptic(60); announce('Approved break used up'); toast('Approved break for today used up'); if (document.hidden) notify.notifyAllowanceUsed(); }
      repaint(root, () => root.replaceChildren(h('div', { class: 'clock strip' + (st.breaking ? ' on-break' : ' working') },
        h('div', { class: 'clock-head' },
          h('span', { class: 'clock-title' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), kindOf(live) === 'edit' ? '✂ ' : '', b ? b.title : 'Deleted booking'),
          h('span', { class: 'clock-sub muted small' }, subLine(st))),
        h('div', { class: 'clock-btns' }, ...buttons(b || { id: live.bookingId }, st), h('button', { class: 'icon-btn', 'aria-label': 'Hours and statistics', onclick: () => openHoursSheet() }, '📊')))));
    } else { root.replaceChildren(); notify.scheduleBreak(null, '', null); notify.holdScreen(false); }
    for (const el of cards) { if (!el.isConnected) cards.delete(el); else paintCard(el); }
  };
  // The notification's "Back to work" button and "5 more min" arrive here through js/notify.js, from the service worker
  // or, in the iPhone app, from the phone itself; one pressed before this ran (at the lock screen) was kept for it.
  const breakAction = type => {
    if (type === 'break-end') { if (running() && onBreak(running())) { endBreak(); toast('Back to work'); } }
    else if (type === 'break-extend') { const s = running(), br = s && currentBreak(s); if (br) { notify.cancelBreak(); const planned = (br.planned || 0) + 5; import('./store.js').then(st => st.update(d2 => { const x = d2.shifts.find(y => y.id === s.id); const b2 = (x.breaks || []).find(y => !y.end); if (b2) b2.planned = planned; })); toast('5 more minutes'); } }
  };
  notify.onAction(breakAction);
  draw();
  subscribe(draw);
  // tick once a second while something is running and the tab is visible
  setInterval(() => { if (!document.hidden && running()) draw(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
}

// Pick how long the break is; the clock counts it down and says when it's up.
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

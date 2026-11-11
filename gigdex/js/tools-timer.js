// The set timer: a countdown for the set, typed in minutes or taken from tonight's show in Bookings. Big enough to
// read from the drum riser; amber at five minutes left, red at one, then counting up in red when the set runs over.
// It shows the time to curfew when tonight's show has one (curfews after midnight included), keeps the screen awake
// while it runs, and goes on counting while you look at another page: it is kept as an end time, not a ticking count.
import { h, nodes, ymd, parseISO, fmtTime } from './util.js';
import { db, byId, covers } from './store.js';
import { bookingTitle, fmtDur, fmtMin } from './model.js';
import { haptic } from './a11y.js';
import { registerState } from './audio.js';
import { pref, clamp, num, keepAwake, letSleep, wakeState } from './tools-ui.js';

const KEY = 'gigdex-settimer';
const MAX_MIN = 600;
// total and left are seconds; endsAt (ms since 1970) is set only while running; bookingId: the show it came from.
const T = (() => {
  const s = pref.get(KEY, {}) || {};
  const total = Number(s.total) >= 60 ? clamp(Math.round(Number(s.total)), 60, MAX_MIN * 60) : 45 * 60;
  const t = { total, left: Number.isFinite(Number(s.left)) ? Number(s.left) : total, endsAt: Number(s.endsAt) > 0 ? Number(s.endsAt) : null, bookingId: typeof s.bookingId === 'string' ? s.bookingId : '' };
  if (t.endsAt && Date.now() - t.endsAt > 6 * 36e5) { t.endsAt = null; t.left = total; } // left running after last night's gig: start fresh
  return t;
})();
const save = () => pref.set(KEY, { total: T.total, left: T.left, endsAt: T.endsAt, bookingId: T.bookingId });
const running = () => T.endsAt != null;
const remaining = (now = Date.now()) => (running() ? (T.endsAt - now) / 1000 : T.left);
const zoneOf = (r, fresh) => (r < 0 ? 'over' : r <= 60 ? 'one' : r <= 300 ? 'five' : fresh ? 'ready' : 'run');
registerState('timer', () => ({ running: running(), remaining: Math.round(remaining()), total: T.total, zone: zoneOf(remaining(), !running() && T.left === T.total), bookingId: T.bookingId }));

/* ------------------------------- tonight's show ------------------------------- */
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
const firstTime = b => b.doors || b.soundcheck || b.loadIn || '';
// The moment 'HH:MM' happens on a show's night. A time earlier in the day than the evening's reference time (or, with
// none, before 6 am) is after midnight, so a 00:30 curfew is the next morning.
export function onNight(night, hhmm, after = '') {
  const m = toMin(hhmm); if (m == null || !night) return null;
  const d = parseISO(night); d.setHours(0, m, 0, 0);
  const ref = toMin(after);
  if (ref != null ? m < ref : m < 6 * 60) d.setDate(d.getDate() + 1);
  return d;
}
const setStart = (b, night) => onNight(night, b.setTime, firstTime(b));
const curfewAt = (b, night) => onNight(night, b.curfew, b.setTime || firstTime(b));
function nightEnd(b, night) {
  const s = setStart(b, night);
  return curfewAt(b, night) || (s && Number(b.setLength) > 0 ? new Date(s.getTime() + Number(b.setLength) * 60000) : s ? new Date(s.getTime() + 3 * 36e5) : null);
}
// Which evening a show belongs to tonight: today's date, or yesterday's in the small hours while its night runs on.
function nightOf(b, now) {
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const today = ymd(now), yest = ymd(y);
  if (now.getHours() < 6 && covers(b, yest)) { const end = nightEnd(b, yest); if (end && end > now) return yest; }
  return covers(b, today) ? today : null;
}
// Tonight's show: the next set still to finish, or the last one tonight. { b, night } or null.
export function tonightShow(now = new Date(), prefer = '') {
  const list = db.bookings.filter(b => b && b.kind === 'show' && b.status !== 'cancelled' && b.date).map(b => ({ b, night: nightOf(b, now) })).filter(x => x.night);
  if (!list.length) return null;
  const mine = prefer && list.find(x => x.b.id === prefer);
  if (mine) return mine;
  const when = x => (setStart(x.b, x.night) || onNight(x.night, firstTime(x.b)) || parseISO(x.night)).getTime();
  list.sort((a, b) => when(a) - when(b));
  return list.find(x => { const e = nightEnd(x.b, x.night); return !e || e > now; }) || list[list.length - 1];
}

/* ------------------------------- the tool ------------------------------- */
export function setTimer(panel) {
  let alive = true, iv = 0, lastZone = zoneOf(remaining(), !running() && T.left === T.total), showKey = '', fullOpen = false;

  const minIn = h('input', { type: 'number', id: 'tl-set-min', min: 1, max: MAX_MIN, step: 1, inputMode: 'numeric', value: Math.round(T.total / 60) });
  minIn.addEventListener('change', () => {
    const v = num(minIn.value);
    if (!(v > 0)) { minIn.value = Math.round(T.total / 60); return; }
    T.total = clamp(Math.round(v), 1, MAX_MIN) * 60; T.left = T.total; T.bookingId = '';
    minIn.value = T.total / 60; save(); lastZone = zoneOf(T.left, true); paint();
  });
  const showBox = h('div', { class: 'tl-show' });
  const clock = h('div', { class: 'tl-clock', id: 'tl-clock', role: 'timer' });
  const prog = h('div', { class: 'tl-prog', 'aria-hidden': 'true' }, h('i'));
  const status = h('div', { class: 'tl-clock-status' });
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const runBtn = h('button', { type: 'button', class: 'btn primary tl-run', id: 'tl-set-run', onclick: () => startPause() });
  const resetBtn = h('button', { type: 'button', class: 'btn ghost', id: 'tl-set-reset', onclick: () => reset() }, '↺ Reset');
  const minus = h('button', { type: 'button', class: 'btn ghost small', id: 'tl-set-minus', 'aria-label': 'One minute less', onclick: () => adjust(-60) }, '−1 min');
  const plus = h('button', { type: 'button', class: 'btn ghost small', id: 'tl-set-plus', 'aria-label': 'One minute more', onclick: () => adjust(60) }, '+1 min');
  const bigBtn = h('button', { type: 'button', class: 'btn ghost small', id: 'tl-set-big', onclick: () => openFull() }, '⛶ Big screen');
  const curfewEl = h('div', { class: 'tl-curfew', hidden: true });
  const awakeEl = h('p', { class: 'muted small tl-awake', hidden: true });

  // Big screen: the clock alone, as large as the screen allows (and full screen where the browser allows).
  const bigClock = h('div', { class: 'tl-full-clock' });
  const bigStatus = h('div', { class: 'tl-full-status' });
  const bigRun = h('button', { type: 'button', class: 'btn primary', id: 'tl-full-run', onclick: () => startPause() });
  const bigClose = h('button', { type: 'button', class: 'btn ghost', id: 'tl-full-close', onclick: () => closeFull() }, '✕ Close');
  const full = h('div', { class: 'tl-full', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Set timer, big screen' },
    bigClock, bigStatus, h('div', { class: 'tl-full-actions' }, bigRun, bigClose));
  const leaveFs = () => { if (document.fullscreenElement === full) document.exitFullscreen().catch(() => {}); };
  function openFull() {
    fullOpen = true; full.hidden = false; document.body.classList.add('tl-full-on');
    try {
      const p = full.requestFullscreen && full.requestFullscreen();
      // Closed again before the browser got there: leave full screen as soon as it arrives.
      if (p && p.then) p.then(() => { if (!fullOpen) leaveFs(); }, () => {});
    } catch { /* the overlay alone will do */ }
    paint(); bigRun.focus();
  }
  function closeFull() {
    leaveFs();
    if (!fullOpen) return;
    fullOpen = false; full.hidden = true; document.body.classList.remove('tl-full-on');
    if (bigBtn.isConnected) bigBtn.focus();
  }
  const onFs = () => {
    if (!fullOpen) leaveFs();
    else if (!document.fullscreenElement) closeFull(); // the browser's own way out (Escape, back gesture) closes the big screen too
  };
  document.addEventListener('fullscreenchange', onFs);
  full.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeFull(); return; }
    if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === bigRun ? bigClose : bigRun).focus(); } // focus stays on the big screen
  });

  function startPause() {
    if (running()) { T.left = remaining(); T.endsAt = null; letSleep(); live.textContent = 'Paused'; }
    else {
      if (!(T.total > 0)) return;
      T.endsAt = Date.now() + T.left * 1000;
      keepAwake().then(() => alive && paint());
      live.textContent = `Started. ${fmtDur(Math.max(0, T.left))} to go.`;
    }
    save(); paint();
  }
  function reset() {
    const fresh = !running() && T.left === T.total;
    if (!fresh && !confirm(`Reset the set timer to ${fmtDur(T.total)}?`)) return;
    T.left = T.total; T.endsAt = null; letSleep(); save();
    lastZone = zoneOf(T.left, true); live.textContent = 'Reset'; paint();
  }
  function adjust(sec) {
    if (running()) { T.endsAt += sec * 1000; T.total = clamp(T.total + sec, 60, MAX_MIN * 60); }
    else if (T.left !== T.total) { T.left += sec; T.total = clamp(T.total + sec, 60, MAX_MIN * 60); }
    else { T.total = clamp(T.total + sec, 60, MAX_MIN * 60); T.left = T.total; minIn.value = Math.round(T.total / 60); }
    lastZone = zoneOf(remaining(), !running() && T.left === T.total);
    save(); paint();
  }
  function useShow(b) {
    const len = Number(b.setLength);
    if (!(len > 0)) return;
    if ((running() || T.left !== T.total) && !confirm(`Start the timer again with tonight’s ${fmtMin(len)} set?`)) return;
    T.total = clamp(Math.round(len), 1, MAX_MIN) * 60; T.left = T.total; T.endsAt = null; T.bookingId = b.id;
    letSleep(); save(); minIn.value = T.total / 60;
    lastZone = zoneOf(T.left, true); live.textContent = `Set timer: ${fmtMin(len)}`; paint();
  }

  function drawShow(sh) {
    const b = sh && sh.b;
    const key = b ? JSON.stringify([b.id, bookingTitle(b), b.setTime, b.setLength, b.curfew, T.bookingId === b.id]) : 'none';
    if (key === showKey) return;
    const hadFocus = showBox.contains(document.activeElement);
    showKey = key;
    if (!b) { showBox.replaceChildren(h('p', { class: 'muted small tl-note-p' }, 'No show in Bookings tonight. Type the set length above.')); return; }
    const len = Number(b.setLength) > 0 ? Number(b.setLength) : 0;
    showBox.replaceChildren(h('div', { class: 'tl-show-card' },
      h('div', { class: 'tl-show-text' },
        h('div', { class: 'tl-kicker' }, 'Tonight'),
        h('strong', null, bookingTitle(b)),
        h('div', { class: 'muted small' }, [b.setTime && `On stage ${b.setTime}`, len && `${fmtMin(len)} set`, b.curfew && `curfew ${b.curfew}`].filter(Boolean).join(' · ') || 'No set times yet')),
      T.bookingId === b.id && T.total === len * 60
        ? h('span', { class: 'pill st-confirmed' }, 'In use')
        : h('button', { type: 'button', class: 'btn ghost small', id: 'tl-set-show', disabled: !len, title: len ? '' : 'This show has no set length yet', onclick: () => useShow(b) }, len ? 'Use tonight’s show' : 'No set length')));
    if (hadFocus) (showBox.querySelector('button') || minIn).focus({ preventScroll: true });
  }

  function paint() {
    const now = Date.now(), r = remaining(now), on = running(), fresh = !on && T.left === T.total;
    const zone = zoneOf(r, fresh);
    const text = r >= 0 ? fmtDur(Math.ceil(r - 1e-6)) : '+' + fmtDur(Math.floor(-r));
    if (clock.textContent !== text) { clock.textContent = text; bigClock.textContent = text; clock.dataset.long = bigClock.dataset.long = String(text.length > 5); }
    clock.setAttribute('aria-label', r >= 0 ? `${text} left` : `Over time by ${text.slice(1)}`);
    card.dataset.zone = zone; full.dataset.zone = zone;
    prog.firstChild.style.width = clamp(T.total > 0 ? 1 - Math.max(0, r) / T.total : 0, 0, 1) * 100 + '%';
    const st = zone === 'over' ? 'Over time' : on ? `${zone === 'one' ? 'Last minute' : zone === 'five' ? 'Five minutes or less' : 'Running'} · ends at ${fmtTime(new Date(T.endsAt))}`
      : fresh ? `Ready: a ${fmtMin(T.total / 60)} set` : 'Paused';
    status.textContent = st; bigStatus.textContent = st;
    runBtn.textContent = on ? '❚❚ Pause' : fresh ? '▶ Start' : '▶ Resume';
    bigRun.textContent = runBtn.textContent;
    runBtn.setAttribute('aria-pressed', String(on));
    minIn.disabled = on;
    // Crossing into five minutes, one minute and over time: a buzz in the pocket and a word for screen readers.
    if (on && zone !== lastZone && ['five', 'one', 'over'].includes(zone)) {
      haptic([220, 120, 220]);
      live.textContent = zone === 'over' ? 'Time is up. Over time.' : zone === 'one' ? 'One minute left' : 'Five minutes left';
    }
    lastZone = zone;
    // Tonight's show and its curfew.
    const sh = tonightShow(new Date(now), T.bookingId);
    drawShow(sh);
    const cAt = sh && sh.b.curfew ? curfewAt(sh.b, sh.night) : null;
    curfewEl.hidden = !cAt;
    if (cAt) {
      const mins = (cAt.getTime() - now) / 60000;
      const late = on && T.endsAt > cAt.getTime() ? (T.endsAt - cAt.getTime()) / 60000 : 0;
      curfewEl.dataset.state = mins < 0 ? 'past' : mins < 15 ? 'near' : 'ok';
      curfewEl.replaceChildren(...nodes(
        h('span', { class: 'tl-curfew-k' }, `Curfew ${sh.b.curfew}`),
        h('b', null, mins >= 1 ? `${mins < 10 ? fmtDur(mins * 60) : fmtMin(mins)} to go` : mins > -1 ? 'Curfew is now' : `passed ${fmtMin(-mins)} ago`),
        late >= 1 && h('span', { class: 'tl-curfew-late' }, `At this pace the set ends ${fmtMin(late)} after curfew.`)));
    }
    awakeEl.hidden = !on;
    const wl = wakeState();
    awakeEl.textContent = wl === 'on' ? '☀ The screen stays on while the timer runs.' : wl === 'asking' ? 'Keeping the screen on…' : wl === 'refused' ? 'The screen couldn’t be kept on (low battery mode?): turn auto-lock off for the set.' : 'This browser can’t keep the screen on: turn auto-lock off for the set.';
  }

  const card = h('div', { class: 'tl-card tl-timer', 'data-zone': 'ready' },
    h('div', { class: 'tl-row tl-set-len' },
      h('label', { for: 'tl-set-min', class: 'tl-label' }, 'Set length'),
      h('div', { class: 'tl-row' }, minIn, h('span', { class: 'muted' }, 'minutes'))),
    showBox,
    h('div', { class: 'tl-clock-wrap' }, clock, prog, status),
    h('div', { class: 'tl-run-row' }, runBtn, resetBtn),
    h('div', { class: 'tl-row tl-adjust' }, minus, plus, bigBtn),
    curfewEl, awakeEl, live);
  panel.append(card, full,
    h('p', { class: 'muted small tl-foot' }, 'The timer keeps counting if you open another page, and picks up where it is when you come back.'));
  paint();
  iv = setInterval(() => { if (alive) paint(); }, 250);
  if (running()) keepAwake().then(() => alive && paint());

  return {
    stop() { alive = false; clearInterval(iv); closeFull(); document.removeEventListener('fullscreenchange', onFs); letSleep(); },
    visible() { if (running()) keepAwake().then(() => alive && paint()); paint(); },
    data() { showKey = ''; paint(); },
    space: true,
    key(e, { inside, loose, field, tab }) {
      if (field || tab || e.defaultPrevented) return false;
      if (e.key === 'Escape' && fullOpen) { e.preventDefault(); closeFull(); return true; }
      if (e.key === ' ' && (inside || loose)) { e.preventDefault(); if (!e.repeat) startPause(); return true; }
      return false;
    },
  };
}

export const TIMER_STEPS = [
  { target: ['#tl-set-min'], title: 'Set length', text: 'Type the length of your set in minutes, or take it from tonight’s show in Bookings.' },
  { target: ['#tl-clock'], title: 'The countdown', text: 'It turns amber at five minutes left and red at one, then counts up in red if the set runs over. Your phone buzzes at each point.' },
  { target: ['#tl-set-run'], title: 'Start and pause', text: 'Space works too. The screen stays awake while it runs, and it keeps counting if you look at another page.' },
  { target: ['#tl-set-big'], title: 'Big screen', text: 'Just the clock, as big as it goes: prop the phone on the monitor wedge.' },
  { target: ['.tl-curfew'], title: 'Curfew', text: 'When tonight’s show has a curfew, the time left to it shows here, with a warning if the set would run past it.' },
];

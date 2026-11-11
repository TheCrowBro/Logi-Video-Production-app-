// Session clock box (studio sessions and rehearsals): Start / Take a break / Back / Stop, today's time, the hours logged
// against the hours planned, what the hours come to at an hourly rate, and every shift with its breaks, each one
// editable (forgot to stop? fix the finish time) or deletable. Shifts can be added by hand too.
import { h, toast, uid, pad, ymd, todayISO, fmtShort } from '../util.js';
import { db, byId, update, remove } from '../store.js';
import { bookingTitle, fmtMoney, currency, rateUnitLabel, kindIcon, daysSpan } from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { clockCard, runningShift, onBreak, shiftsOf, workedMs, breakMs, bookingMs, fmtHm, clockTime, plannedHours, tick } from '../clock.js';

const H = 36e5;
const toHm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const at = (iso, hhmm) => { const [y, m, d] = iso.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, hh, mm, 0, 0).getTime(); };
const isTime = t => /^\d{1,2}:\d{2}$/.test(String(t || ''));
const dayOf = ms => ymd(new Date(ms));

// The bookings a shift can belong to: studio sessions and rehearsals, the nearest dates first, plus the current one.
function bookingOptions(currentId) {
  const today = todayISO();
  const list = db.bookings.filter(b => b.kind === 'session' || b.kind === 'rehearsal' || b.id === currentId)
    .sort((a, b) => Math.abs(Date.parse(a.date || today) - Date.parse(today)) - Math.abs(Date.parse(b.date || today) - Date.parse(today)));
  return list.map(b => [b.id, `${kindIcon(b.kind)} ${b.date ? fmtShort(b.date) + ' — ' : ''}${bookingTitle(b)}`]);
}

// Add hours by hand (s = null) or correct a shift: the day, start, finish and each break. Times past midnight roll
// into the next day. Times that were not changed keep their seconds, so an untouched shift adds up exactly as before.
export function editShift(s, b) {
  const running = !!s && !s.end;
  const date = s ? dayOf(s.start) : (b && b.date && b.date <= todayISO() ? b.date : todayISO());
  const values = s
    ? { bookingId: s.bookingId || (b && b.id) || '', date, start: toHm(s.start), end: s.end ? toHm(s.end) : '', breaks: (s.breaks || []).filter(x => x && x.start).map(x => ({ start: toHm(x.start), end: x.end ? toHm(x.end) : '' })) }
    : { bookingId: (b && b.id) || '', date, start: (b && b.start) || '', end: (b && b.end) || '', breaks: [] };
  const opts = bookingOptions(values.bookingId);
  openForm({
    title: s ? 'Edit shift' : 'Add hours',
    values,
    fields: [
      opts.length > 1 && { key: 'bookingId', label: 'Booking', type: 'select', options: opts },
      { key: 'date', label: 'Day it started', type: 'date', required: true },
      { key: 'start', label: 'Start', type: 'time', required: true },
      { key: 'end', label: 'Finish', type: 'time', required: !running, hint: running ? 'Leave blank to keep the clock running.' : 'Finished after midnight? Enter the time: it counts into the next day.' },
      { key: 'breaks', label: 'Breaks', type: 'rows', columns: [{ key: 'start', label: 'Break from', type: 'time' }, { key: 'end', label: 'Back at', type: 'time' }], hint: 'Breaks are taken off the hours.' + (running ? ' A break with no “back at” time is still going.' : '') },
    ].filter(Boolean),
    saveLabel: s ? 'Save' : 'Add hours',
    onSave: v => {
      if (!v.date || !isTime(v.start)) return toast('Enter the day and the start time.');
      const sameDay = s && v.date === date;
      let start = sameDay && v.start === toHm(s.start) ? s.start : at(v.date, v.start);
      let end = null;
      if (isTime(v.end)) { end = s && s.end && sameDay && v.end === toHm(s.end) ? s.end : at(v.date, v.end); while (end <= start) end += 864e5; }
      else if (!running) return toast('Enter the finish time.');
      const stillRunning = running && end == null; // giving the running shift a finish time stops it
      const old = s ? (s.breaks || []).filter(x => x && x.start) : [];
      const rows = (v.breaks || []).filter(r => isTime(r.start));
      let dropped = 0;
      const breaks = rows.map((r, i) => {
        const was = old[i];
        let bs = was && sameDay && r.start === toHm(was.start) ? was.start : at(v.date, r.start);
        while (bs < start) bs += 864e5;
        let be = null;
        if (isTime(r.end)) { be = was && was.end && sameDay && r.end === toHm(was.end) ? was.end : at(v.date, r.end); while (be <= bs) be += 864e5; }
        else if (stillRunning && i === rows.length - 1) be = null; // only a running shift's last break can still be going
        else if (end) be = end;
        else { dropped++; return null; }
        if ((end && bs >= end) || (be != null && be <= bs)) { dropped++; return null; }
        return { start: bs, end: end && be ? Math.min(be, end) : be };
      }).filter(Boolean);
      if (dropped) toast(`${dropped === 1 ? 'A break' : dropped + ' breaks'} outside the shift ${dropped === 1 ? 'was' : 'were'} left out.`);
      const bookingId = v.bookingId || (b && b.id) || '';
      const now = Date.now();
      update(d => {
        if (s) { const x = d.shifts.find(y => y.id === s.id); if (x) Object.assign(x, { bookingId, start, end, breaks, updatedAt: now }); }
        else d.shifts.push({ id: uid(), bookingId, start, end, breaks, createdAt: now, updatedAt: now });
      });
      if (!s) toast(`Added ${fmtHm(workedMs({ start, end, breaks }))}`);
    },
    onDelete: s ? () => { remove('shifts', s.id); toast('Shift deleted'); } : null,
  });
}

// One shift in the list: the day, start – finish, breaks, and the hours worked (or "running").
function shiftRow(s, b) {
  const end = s.end ? clockTime(s.end) + (dayOf(s.end) !== dayOf(s.start) ? ' (next day)' : '') : 'now';
  const br = breakMs(s), live = !s.end;
  return h('button', { type: 'button', class: 'card tap sd-shift' + (live ? ' running' : ''), 'aria-label': `${fmtShort(dayOf(s.start))}, ${clockTime(s.start)} to ${s.end ? end : 'now'}, ${live ? 'running' : fmtHm(workedMs(s)) + ' worked'}. Edit shift`, onclick: () => editShift(s, b) },
    h('div', { class: 'card-row' },
      h('div', null, h('strong', null, fmtShort(dayOf(s.start))), h('div', { class: 'muted small' }, `${clockTime(s.start)} – ${end}`, br >= 6e4 ? ` · breaks ${fmtHm(br)}` : '')),
      live ? h('span', { class: 'pill st-confirmed rec' }, live && onBreak(s) ? 'on break' : 'running') : h('span', { class: 'pill' }, fmtHm(workedMs(s)))));
}

const stat = (value, label) => h('div', { class: 'stat' }, h('b', null, value), h('span', null, label));

export default {
  id: 'clock', title: 'Session clock', icon: '⏲️', order: 12,
  kinds: ['session', 'rehearsal'],
  summary(b) {
    const live = runningShift(), mine = !!live && live.bookingId === b.id, ms = bookingMs(b.id);
    return [ms >= 6e4 && `${fmtHm(ms)} logged`, mine && (onBreak(live) ? 'on a break' : 'running')].filter(Boolean).join(' · ');
  },
  render(b, ctx = {}) {
    const sym = (ctx && ctx.sym) || currency();
    const shifts = shiftsOf(b.id);
    const plan = plannedHours(b), hourly = b.kind === 'session' && b.rateUnit === 'hour' && Number(b.rate) > 0;
    const days = Math.max(1, daysSpan(b));
    const planText = plan ? `of ${fmtHm(plan * H)} planned${days > 1 ? ` (${days} days)` : ''}` : 'logged';
    return h('div', { class: 'sd-clock-box' },
      clockCard(b),
      h('div', { class: 'stats sd-stats' + (hourly ? '' : ' two') },
        stat(tick('today', b.id), 'today'),
        stat(tick('total', b.id), planText),
        hourly && stat(tick('fee', b.id), `at ${fmtMoney(Number(b.rate), sym)}/hour, to the ¼ hour`)),
      plan > 0 && h('div', { class: 'progress sd-progress' + (bookingMs(b.id) > plan * H ? ' over' : ''), role: 'img', 'aria-label': `${fmtHm(bookingMs(b.id))} logged of ${fmtHm(plan * H)} planned` }, h('i', { 'data-sd-tick': 'bar', 'data-sd-for': b.id, style: `width:${Math.min(100, (bookingMs(b.id) / (plan * H)) * 100)}%` })),
      b.kind === 'session' && Number(b.rate) > 0 && !hourly && h('p', { class: 'muted small' }, `Billed ${fmtMoney(Number(b.rate), sym)} ${rateUnitLabel(b.rateUnit) || 'flat'}, so the hours here are for your records.`),
      b.kind === 'session' && !(Number(b.rate) > 0) && h('p', { class: 'muted small' }, 'Set an hourly rate on the booking and the hours here turn into the amount to bill.'),
      h('div', { class: 'card-row sd-shifts-head' },
        h('h4', null, shifts.length ? `Shifts (${shifts.length})` : 'Shifts'),
        h('button', { type: 'button', class: 'btn ghost small', id: `sd-add-hours-${b.id}`, onclick: () => editShift(null, b) }, '+ Add hours')),
      shifts.length
        ? h('div', { class: 'sd-shifts' }, shifts.map(s => shiftRow(s, b)))
        : h('p', { class: 'muted small' }, 'Each time the clock runs it adds a shift here. Forgot to start it? Add the hours by hand.'));
  },
  tutorial: [
    { title: 'Session clock', text: 'Start it when the session starts. Take a break pauses it; Back starts it again; Stop ends the shift. While it runs, a strip under the Rolodex shows it on every page.', target: ['#blk-clock .sd-clock', '.sd-clock'] },
    { title: 'Hours', text: 'Today’s time, all the hours logged against the hours planned (start to finish on the booking), and at an hourly rate what they come to. The invoice bills these hours, to the nearest quarter hour, and so does the amount here.', target: ['#blk-clock .sd-stats', '.sd-stats'] },
    { title: 'Shifts', text: 'Every shift with its breaks. Tap one to fix its times (or delete it), or add hours by hand when the clock was not running.', target: ['#blk-clock .sd-shifts-head', '.sd-shifts-head'] },
  ],
};

const formSteps = [
  { title: 'The day and times', text: 'The day the shift started, and its start and finish. A finish earlier than the start counts into the next day.', target: ['.sheet [data-key=start]', '.sheet .form'] },
  { title: 'Breaks', text: 'One row per break: when it started and when you were back. Breaks are taken off the hours worked.', target: ['.sheet .rows', '.sheet .form'] },
];
sheetTutorial('Edit shift', formSteps);
sheetTutorial('Add hours', formSteps);

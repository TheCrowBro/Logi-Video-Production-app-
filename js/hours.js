// Time records: shifts clocked against bookings, their statistics, and the hours sheet with its chart.
import { h, sheet, toast, uid, todayISO, ymd, parseISO, fmtShort, nodes } from './util.js';
import { db, byId, update, remove, subscribe, activeBookings } from './store.js';
import { openForm } from './form.js';

const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
export const standardDay = () => Number(LS.get('logi-stdday')) || 10;          // hours before overtime
export const defaultBreak = () => Number(LS.get('logi-breakdefault')) || 30;   // approved break minutes when a booking sets none
export const allowanceFor = b => (b && b.breakMinutes !== '' && b.breakMinutes != null ? Number(b.breakMinutes) : defaultBreak());

/* ------------------------------- arithmetic ------------------------------- */
const H = 36e5;
export const breakMs = (s, now = Date.now()) => (s.breaks || []).reduce((t, b) => t + Math.max(0, (b.end || now) - b.start), 0);
export const workedMs = (s, now = Date.now()) => Math.max(0, (s.end || now) - s.start - breakMs(s, now));
export const onBreak = s => !!(s && (s.breaks || []).some(b => !b.end));
export const running = () => db.shifts.find(s => !s.end) || null;
export const fmtHm = ms => { const m = Math.round(ms / 6e4); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
export const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const hrs = ms => Math.round(ms / H * 100) / 100;

export function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
const monthStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x; };

export const RANGES = [['week', 'This week'], ['month', 'This month'], ['90', 'Last 90 days'], ['all', 'All time']];
export function inRange(s, range) {
  const d = parseISO(s.date), now = new Date();
  if (range === 'week') return d >= weekStart(now);
  if (range === 'month') return d >= monthStart(now);
  if (range === '90') return now - d < 90 * 864e5;
  return true;
}

export function stats(shifts) {
  const days = new Set(shifts.map(s => s.date));
  const worked = shifts.reduce((t, s) => t + workedMs(s), 0), breaks = shifts.reduce((t, s) => t + breakMs(s), 0);
  const perDay = new Map(); for (const s of shifts) perDay.set(s.date, (perDay.get(s.date) || 0) + workedMs(s));
  const std = standardDay() * H;
  const overtime = [...perDay.values()].reduce((t, ms) => t + Math.max(0, ms - std), 0);
  const longest = Math.max(0, ...perDay.values());
  return { worked, breaks, days: days.size, avg: days.size ? worked / days.size : 0, overtime, longest };
}

/* --------------------------------- mutate --------------------------------- */
const touch = s => { s.updatedAt = Date.now(); return s; };
export function startShift(bookingId) {
  if (running()) return;
  const now = Date.now();
  update(d => { d.shifts.push(touch({ id: uid(), bookingId, date: ymd(new Date(now)), start: now, end: null, breaks: [] })); });
}
export function stopShift() {
  const s = running(); if (!s) return null;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); (x.breaks || []).forEach(b => { if (!b.end) b.end = now; }); x.end = now; touch(x); });
  return byId('shifts', s.id);
}
// A break is started with a chosen length (minutes) so the bar can count it down; it ends when you come back.
export const BREAK_CHOICES = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']];
export function startBreak(planned) {
  const s = running(); if (!s || onBreak(s)) return;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); x.breaks = [...(x.breaks || []), { start: now, end: null, planned }]; touch(x); });
}
export function endBreak() {
  const s = running(); if (!s) return;
  const now = Date.now();
  update(d => { const x = d.shifts.find(y => y.id === s.id); (x.breaks || []).forEach(b => { if (!b.end) b.end = now; }); touch(x); });
}
export const breakLabel = m => (BREAK_CHOICES.find(([x]) => x === m) || [m, `${m} min`])[1];
export const currentBreak = s => (s && (s.breaks || []).find(b => !b.end)) || null;
export const deleteShift = id => remove('shifts', id);

// Manual entry or correction: date, times and a single break total.
export function editShift(s, bookingId) {
  const toTime = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const vals = s ? { bookingId: s.bookingId, date: s.date, start: toTime(s.start), end: s.end ? toTime(s.end) : '', breakMin: Math.round(breakMs(s) / 6e4), note: s.note || '' } : { bookingId: bookingId || '', date: todayISO(), start: '08:00', end: '18:00', breakMin: defaultBreak(), note: '' };
  openForm({
    title: s ? 'Edit hours' : 'Add hours',
    values: vals,
    fields: [
      { key: 'bookingId', label: 'Project', type: 'select', options: [...db.bookings].sort((a, b) => b.date.localeCompare(a.date)).map(b => [b.id, `${fmtShort(b.date)} — ${b.title}`]) },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'start', label: 'Start', type: 'time', required: true },
      { key: 'end', label: 'Finish', type: 'time', hint: s && !s.end ? 'Leave blank to keep the clock running.' : 'Finishes after midnight? Enter the time; the date stays the start date.' },
      { key: 'breakMin', label: 'Breaks (minutes, total)', type: 'number', min: 0 },
      { key: 'note', label: 'Note' },
    ],
    onSave: v => {
      const [sh, sm] = v.start.split(':').map(Number); const base = parseISO(v.date); const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), sh, sm).getTime();
      let end = null;
      if (v.end) { const [eh, em] = v.end.split(':').map(Number); end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), eh, em).getTime(); if (end <= start) end += 864e5; }
      const bm = Math.max(0, Number(v.breakMin) || 0) * 6e4;
      const breaks = bm ? [{ start, end: start + bm }] : [];
      update(d => {
        if (s) { const x = d.shifts.find(y => y.id === s.id); if (x) Object.assign(x, touch({ bookingId: v.bookingId, date: v.date, start, end, breaks, note: v.note })); }
        else d.shifts.push(touch({ id: uid(), bookingId: v.bookingId, date: v.date, start, end, breaks, note: v.note }));
      });
    },
    onDelete: s ? () => deleteShift(s.id) : null,
  });
}

/* --------------------------------- chart --------------------------------- */
// Hours per week, one series: single hue, thin columns rounded only at the data end, hairline solid grid, tooltip per bar.
function weeklyChart(shifts, weeks = 12) {
  const ns = 'http://www.w3.org/2000/svg';
  const el = (n, a, ...kids) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); kids.forEach(k => e.append(k)); return e; };
  const start = weekStart(new Date()); start.setDate(start.getDate() - 7 * (weeks - 1));
  const cols = Array.from({ length: weeks }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); return { key: ymd(d), label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), ms: 0, breaks: 0, days: new Set() }; });
  for (const s of shifts) { const k = ymd(weekStart(parseISO(s.date))); const c = cols.find(x => x.key === k); if (c) { c.ms += workedMs(s); c.breaks += breakMs(s); c.days.add(s.date); } }
  const max = Math.max(1, ...cols.map(c => hrs(c.ms)));
  const step = max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : 20, top = Math.ceil(max / step) * step;
  const W = 360, Hh = 170, padL = 30, padR = 8, padT = 10, padB = 26, pw = W - padL - padR, ph = Hh - padT - padB;
  const y = v => padT + ph - (v / top) * ph, slot = pw / weeks, bw = Math.min(24, slot * 0.6);
  const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'hrs-chart', role: 'img', 'aria-label': `Hours worked per week, last ${weeks} weeks` });
  for (let v = 0; v <= top; v += step) {
    svg.append(el('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: padL - 6, y: y(v) + 3, class: 'tick', 'text-anchor': 'end' }, String(v)));
  }
  const tip = h('div', { class: 'hrs-tip', role: 'status', hidden: true });
  cols.forEach((c, i) => {
    const v = hrs(c.ms), x = padL + slot * i + (slot - bw) / 2, yTop = y(v), base = y(0), r = Math.min(4, (base - yTop) / 2);
    const d = v > 0 ? `M${x},${base} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + bw - r} Q${x + bw},${yTop} ${x + bw},${yTop + r} V${base} Z` : '';
    const g = el('g', { class: 'bar', tabindex: '0', role: 'img', 'aria-label': `Week of ${c.label}: ${fmtHm(c.ms)} over ${c.days.size} day${c.days.size === 1 ? '' : 's'}` });
    g.append(el('rect', { x: padL + slot * i, y: padT, width: slot, height: ph, class: 'hit' })); // hit area wider than the mark
    if (d) g.append(el('path', { d, class: 'mark' }));
    const show = () => { tip.replaceChildren(h('b', null, fmtHm(c.ms)), ` · ${c.days.size} day${c.days.size === 1 ? '' : 's'} · breaks ${fmtHm(c.breaks)}`, h('div', { class: 'muted small' }, 'week of ' + c.label)); tip.hidden = false; tip.style.left = `${Math.min(80, Math.max(0, ((x + bw / 2) / W) * 100))}%`; };
    g.addEventListener('pointerenter', show); g.addEventListener('focus', show);
    g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; });
    svg.append(g);
    if (i % 3 === 0 || i === weeks - 1) svg.append(el('text', { x: padL + slot * i + slot / 2, y: Hh - 8, class: 'tick', 'text-anchor': 'middle' }, c.label));
    if (i === weeks - 1 && v > 0) svg.append(el('text', { x: x + bw / 2, y: yTop - 5, class: 'val', 'text-anchor': 'middle' }, v % 1 ? v.toFixed(1) : String(v)));
  });
  const table = h('details', { class: 'help' }, h('summary', null, 'Table view'), h('table', { class: 'hrs-table' }, h('thead', null, h('tr', null, h('th', null, 'Week of'), h('th', null, 'Hours'), h('th', null, 'Days'), h('th', null, 'Breaks'))),
    h('tbody', null, cols.map(c => h('tr', null, h('td', null, c.label), h('td', null, fmtHm(c.ms)), h('td', null, c.days.size), h('td', null, fmtHm(c.breaks)))))));
  return h('div', { class: 'hrs-chart-wrap' }, h('div', { class: 'hrs-tipwrap' }, tip), svg, table);
}

// Hours by project: nominal categories, so one hue; values at the tip; at most eight bars, the rest folded.
function projectBars(shifts) {
  const by = new Map();
  for (const s of shifts) by.set(s.bookingId, (by.get(s.bookingId) || 0) + workedMs(s));
  let rows = [...by].map(([id, ms]) => ({ id, name: byId('bookings', id)?.title || 'Deleted booking', ms })).sort((a, b) => b.ms - a.ms);
  if (rows.length > 8) rows = [...rows.slice(0, 7), { id: null, name: 'Other', ms: rows.slice(7).reduce((t, r) => t + r.ms, 0) }];
  const max = Math.max(1, ...rows.map(r => r.ms));
  return h('div', { class: 'hrs-projects' }, rows.map(r => h('div', { class: 'hrs-row', title: fmtHm(r.ms) },
    h('span', { class: 'hrs-name' }, r.name), h('span', { class: 'hrs-track' }, h('i', { style: `width:${(r.ms / max) * 100}%` })), h('span', { class: 'hrs-val' }, fmtHm(r.ms)))));
}

/* --------------------------------- sheet --------------------------------- */
const tile = (label, value, sub) => h('div', { class: 'stat' }, h('b', null, value), h('span', null, label), sub && h('small', { class: 'muted' }, sub));

export function hoursPanel({ bookingId = null } = {}) {
  let range = bookingId ? 'all' : LS.get('logi-hours-range') || 'month';
  const body = h('div', { class: 'stack hours' });
  const draw = () => {
    const all = db.shifts.filter(s => !bookingId || s.bookingId === bookingId).sort((a, b) => b.start - a.start);
    const shifts = all.filter(s => inRange(s, range));
    const st = stats(shifts), live = running();
    body.replaceChildren(...nodes(
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Period' }, RANGES.map(([k, l]) => h('button', { class: 'chip' + (range === k ? ' on' : ''), 'aria-pressed': range === k, onclick: () => { range = k; if (!bookingId) LS.set('logi-hours-range', k); draw(); } }, l))),
      h('div', { class: 'stats' }, tile('hours', fmtHm(st.worked)), tile('days', String(st.days)), tile('avg day', fmtHm(st.avg)), tile('breaks', fmtHm(st.breaks)), tile('overtime', fmtHm(st.overtime), `over ${standardDay()}h days`), tile('longest day', fmtHm(st.longest))),
      live && h('div', { class: 'warn small' }, `Clock running on “${byId('bookings', live.bookingId)?.title || 'a booking'}” since ${new Date(live.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${onBreak(live) ? ' (on break)' : ''}.`),
      h('h3', null, 'Hours per week'), weeklyChart(all),
      !bookingId && shifts.length > 0 && [h('h3', null, 'By project'), projectBars(shifts)],
      h('div', { class: 'card-row' }, h('h3', null, `Days (${shifts.length})`), h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => editShift(null, bookingId) }, '+ Add hours'), shifts.length > 0 && h('button', { class: 'btn ghost small', onclick: () => exportCsv(shifts) }, '⬇ CSV'))),
      shifts.length
        ? h('div', { class: 'list' }, shifts.map(s => h('button', { class: 'card tap hrs-shift', type: 'button', onclick: () => editShift(s) },
          h('div', { class: 'card-row' }, h('div', null, h('strong', null, fmtShort(s.date)), !bookingId && h('div', { class: 'muted small' }, byId('bookings', s.bookingId)?.title || 'Deleted booking')), h('span', { class: 'pill ' + (s.end ? '' : 'st-cancelled rec') }, s.end ? fmtHm(workedMs(s)) : 'running')),
          h('div', { class: 'muted small' }, `${new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${s.end ? new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'} · breaks ${fmtHm(breakMs(s))}${s.note ? ' · ' + s.note : ''}`))))
        : h('p', { class: 'muted small' }, 'No hours in this period. Use the clock bar on a shoot day, or add them by hand.'),
      h('p', { class: 'muted small' }, `Overtime counts anything beyond a ${standardDay()}-hour day. Change the standard day and the default approved break under Settings → Hours & breaks.`)));
  };
  draw();
  const unsub = subscribe(draw);
  return { el: body, destroy: unsub };
}
export function openHoursSheet(bookingId) {
  const p = hoursPanel({ bookingId });
  sheet(bookingId ? `Hours — ${byId('bookings', bookingId)?.title || ''}` : 'Hours & statistics', p.el, { onClose: p.destroy });
}

function exportCsv(shifts) {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = ['Date,Project,Client,Start,Finish,Breaks (min),Worked (h),Note', ...shifts.map(s => { const b = byId('bookings', s.bookingId) || {}; return [s.date, q(b.title || ''), q(b.client || ''), new Date(s.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), s.end ? new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '', Math.round(breakMs(s) / 6e4), hrs(workedMs(s)), q(s.note || '')].join(','); })];
  const file = new File([rows.join('\n') + '\n'], 'logi-hours.csv', { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) { navigator.share({ files: [file], title: 'Logi hours' }).catch(() => {}); return; }
  const a = h('a', { href: URL.createObjectURL(file), download: file.name }); document.body.append(a); a.click(); a.remove(); toast('CSV saved');
}

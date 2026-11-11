// Running order: the night as it runs. Doors, the support acts, changeovers, our set and the curfew, each with its
// time, length and end. Built in one go from the show's times, edited in a sheet, always sorted by time through the
// night (a time well before the day starts is after midnight), with warnings for a set past curfew, slots that
// overlap, an act on before doors and a soundcheck after doors.
import { h, toast, uid, sheet } from '../util.js';
import { byId } from '../store.js';
import { sheetTutorial } from '../tour.js';
import { addMinutes, fmtMin, actName, venueOf, bookingTitle } from '../model.js';
import { num, saveBooking, rowsSheet, copyText, plural, textDate, refocus } from '../show-common.js';

const EDIT_TITLE = 'Running order';
const BUILD_TITLE = 'Build the running order';
const toMin = t => (/^\d{1,2}:\d{2}$/.test(t || '') ? Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]) : null);

// Minutes from the start of the show's day, so 00:30 sorts after 23:00. The day starts at load-in (else soundcheck,
// else doors); a time more than four hours before that is after midnight. With none of them, anything before 06:00 is.
export function dayClock(b) {
  const anchor = toMin((b && (b.loadIn || b.soundcheck || b.doors)) || '');
  return t => {
    const m = toMin(t);
    if (m == null) return null;
    if (anchor == null) return m < 360 ? m + 1440 : m;
    return m < anchor && anchor - m > 240 ? m + 1440 : m;
  };
}

const MARKER = /^\s*(doors|changeover|change[- ]over|curfew|soundcheck|line ?check|load[- ]?(in|out)|break|interval)\b/i;
const rowsOf = b => (Array.isArray(b && b.runningOrder) ? b.runningOrder.filter(r => r && typeof r === 'object') : []);
// An act on the bill (ours, or anyone else with a slot), as against doors, changeovers and the curfew.
export const isAct = r => !!(r && (r.ours || (!MARKER.test(r.act || '') && num(r.length) > 0)));
const nameOf = r => String((r && r.act) || '').trim() || (r && r.ours ? 'Our set' : 'Untitled slot');
const ourName = b => actName(b.actId) || (b.client || '').trim() || 'Our set';
// The booking as stored now (a button can outlive a change made since the page drew).
const byIdFresh = b => byId('bookings', b.id) || b;
const span = r => (r.time && num(r.length) > 0 ? `${r.time}–${addMinutes(r.time, num(r.length))}` : r.time || '—');

// The rows sorted through the night (rows without a time last, in the order they were typed).
export function sortedRows(b, rows = rowsOf(b)) {
  const at = dayClock(b);
  return rows.map((r, i) => ({ r, i, t: at(r.time) })).sort((x, y) => (x.t ?? 1e9) - (y.t ?? 1e9) || x.i - y.i).map(x => x.r);
}
const curfewOf = b => { const own = (b && b.curfew) || '', v = venueOf(b); return own ? { time: own, label: 'the curfew' } : v.curfew ? { time: v.curfew, label: `${v.name || 'the venue'}’s curfew` } : { time: '', label: '' }; };
// Our slots: the rows marked ours, or, with none, the show's own on-stage time and set length.
function ourSlots(b, rows = rowsOf(b)) {
  const mine = sortedRows(b, rows).filter(r => r.ours);
  if (mine.length) return mine;
  return b && b.setTime ? [{ id: '', act: ourName(b), time: b.setTime, length: b.setLength, ours: true, fromShow: true }] : [];
}

// Everything worth a second look, as sentences. rows default to the booking's own.
export function runningWarnings(b, rows = rowsOf(b)) {
  const at = dayClock(b), out = [], cf = curfewOf(b), cfAt = at(cf.time);
  const acts = rows.filter(isAct);
  if (!acts.some(r => r.ours)) acts.push(...ourSlots(b, rows));
  if (cfAt != null) {
    for (const r of acts) {
      const s = at(r.time); if (s == null) continue;
      const e = s + num(r.length), end = addMinutes(r.time, num(r.length));
      if (e > cfAt) out.push(r.ours ? `Your set ends at ${end}, ${fmtMin(e - cfAt)} after ${cf.label} (${cf.time}).` : `${nameOf(r)} ends at ${end}, after ${cf.label} (${cf.time}).`);
    }
  }
  const timed = rows.filter(r => at(r.time) != null && num(r.length) > 0).map(r => ({ r, s: at(r.time), e: at(r.time) + num(r.length) })).sort((x, y) => x.s - y.s);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length && timed[j].s < timed[i].e; j++) {
      const a = timed[i], z = timed[j];
      out.push(`${nameOf(a.r)} (${span(a.r)}) and ${nameOf(z.r)} (${span(z.r)}) overlap by ${fmtMin(Math.min(a.e, z.e) - z.s)}.`);
    }
  }
  const sc = at(b.soundcheck), dr = at(b.doors);
  if (sc != null && dr != null && sc >= dr) out.push(`Soundcheck (${b.soundcheck}) isn’t before doors (${b.doors}): you’d be checking in front of the crowd.`);
  if (dr != null) for (const r of acts) { const s = at(r.time); if (s != null && s < dr) out.push(`${r.ours ? 'Your set' : nameOf(r)} starts at ${r.time}, before doors (${b.doors}).`); }
  return [...new Set(out)];
}

/* ------------------------------- saving ------------------------------- */
// Saves the rows sorted, and keeps the show's on-stage time and set length in step with our slot.
function saveRows(b, list, msg = 'Running order saved') {
  const rows = list.map(r => ({ id: r.id || uid(), act: String(r.act || '').trim(), time: r.time || '', length: r.length === '' || r.length == null ? '' : Math.max(0, Math.round(num(r.length))), ours: !!r.ours }));
  const ours = rows.filter(r => r.ours && r.time);
  const ok = saveBooking(b.id, x => {
    x.runningOrder = sortedRows(x, rows);
    if (ours.length === 1) { x.setTime = ours[0].time; if (ours[0].length !== '') x.setLength = ours[0].length; }
  });
  if (ok) toast(msg);
}

export function editRunning(b) {
  rowsSheet({
    title: EDIT_TITLE, cls: 'sh-rows-ro', addLabel: '+ Add a slot', saveLabel: 'Save running order',
    intro: 'One line per slot: doors, each act, changeovers, the curfew. Lines sort by time when you save, and a time before the day starts counts as after midnight. Your set’s time and length also become the show’s on-stage time.',
    columns: [
      { key: 'time', label: 'Time', type: 'time' },
      { key: 'act', label: 'What / who', placeholder: 'Doors, a band, changeover…' },
      { key: 'length', label: 'Minutes', type: 'number', step: 1, inputMode: 'numeric' },
      { key: 'ours', label: 'Our set', type: 'check' },
    ],
    rows: sortedRows(b), blank: () => ({ time: '', act: '', length: '', ours: false }),
    emptyText: 'No slots. Add one, or close this and build the order from the show’s times.',
    derive: r => { const l = num(r.length); return r.time && l > 0 ? `${r.time} to ${addMinutes(r.time, l)}` : ''; },
    onSave: list => saveRows(b, list),
  });
}

/* ------------------------------- building ------------------------------- */
// The rows for a night: doors, the acts before us back to back (worked back from our time, a changeover between
// each), our set, the acts after us, the curfew. With no on-stage time, the first act goes on 30 minutes after doors
// and we follow the support.
export function buildRows(f, name) {
  const len = x => Math.max(0, Math.round(num(x)));
  const change = len(f.change);
  const keep = a => String(a.name || '').trim() || len(a.length);
  const before = (f.before || []).filter(keep), after = (f.after || []).filter(keep);
  const rows = [], push = (act, time, length, ours = false) => rows.push({ id: uid(), act, time, length, ours });
  if (f.doors) push('Doors', f.doors, 0);
  let start = f.setTime;
  if (start) {
    const pre = []; let t = start;
    for (let i = before.length - 1; i >= 0; i--) {
      if (change) { t = addMinutes(t, -change); pre.unshift(['Changeover', t, change]); }
      t = addMinutes(t, -len(before[i].length)); pre.unshift([String(before[i].name || '').trim() || 'Support', t, len(before[i].length)]);
    }
    pre.forEach(p => push(...p));
  } else if (f.doors) {
    let t = addMinutes(f.doors, 30);
    for (const a of before) { push(String(a.name || '').trim() || 'Support', t, len(a.length)); t = addMinutes(t, len(a.length)); if (change) { push('Changeover', t, change); t = addMinutes(t, change); } }
    start = t;
  }
  if (!start) return [];
  push(name, start, len(f.setLength), true);
  let t = addMinutes(start, len(f.setLength));
  for (const a of after) { if (change) { push('Changeover', t, change); t = addMinutes(t, change); } push(String(a.name || '').trim() || 'Headliner', t, len(a.length)); t = addMinutes(t, len(a.length)); }
  if (f.curfew) push('Curfew', f.curfew, 0);
  return rows;
}

export function buildRunning(b) {
  const v = venueOf(b), at = dayClock(b), existing = sortedRows(b);
  const mine = existing.find(r => r.ours), ourAt = at((mine && mine.time) || b.setTime);
  const others = existing.filter(r => isAct(r) && !r.ours);
  const pick = r => ({ name: r.act || '', length: r.length ?? '' });
  const f = {
    doors: b.doors || '', setTime: b.setTime || (mine && mine.time) || '', setLength: b.setLength ?? (mine ? mine.length : '') ?? '',
    curfew: b.curfew || v.curfew || '', change: 15,
    before: others.filter(r => ourAt == null || at(r.time) == null || at(r.time) < ourAt).map(pick),
    after: others.filter(r => ourAt != null && at(r.time) != null && at(r.time) > ourAt).map(pick),
  };
  if (!f.before.length && !f.after.length) f.before.push({ name: '', length: 30 });
  const name = ourName(b);
  const preview = h('div', { class: 'sh-build-preview', 'aria-live': 'polite' });
  const showFor = () => ({ ...b, doors: f.doors, setTime: f.setTime, setLength: f.setLength, curfew: f.curfew });
  const go = h('button', { type: 'submit', class: 'btn primary', id: 'sh-build-go' }, 'Build running order');
  const drawPreview = () => {
    const rows = buildRows(f, name), show = showFor();
    go.disabled = !rows.length;
    preview.replaceChildren(
      h('h4', null, 'It will read'),
      rows.length ? rowList(show, sortedRows(show, rows)) : h('p', { class: 'muted small' }, 'Add the doors or your on-stage time to build the order.'),
      ...runningWarnings(show, rows).map(w => h('p', { class: 'warn' }, w)));
  };
  const field = (key, label, type, extra = {}) => h('div', { class: 'field' }, h('label', { for: 'sh-b-' + key }, label),
    h('input', { id: 'sh-b-' + key, type, value: f[key] ?? '', autocomplete: 'off', ...(type === 'number' ? { min: 0, step: 1, inputMode: 'numeric' } : {}), ...extra, oninput: e => { f[key] = e.target.value; drawPreview(); } }));
  const actList = (key, label, help, addLabel) => {
    const box = h('div', { class: 'sh-build-acts' });
    const draw = focusAt => {
      box.replaceChildren(...f[key].map((a, i) => h('div', { class: 'sh-build-act' },
        h('div', { class: 'sh-cell sh-k-act' }, h('label', { for: `sh-b-${key}-${i}` }, 'Act'), h('input', { id: `sh-b-${key}-${i}`, type: 'text', value: a.name, placeholder: key === 'before' ? 'Support act' : 'Headliner', autocomplete: 'off', oninput: e => { a.name = e.target.value; drawPreview(); } })),
        h('div', { class: 'sh-cell sh-k-length' }, h('label', { for: `sh-b-${key}-${i}-len` }, 'Minutes'), h('input', { id: `sh-b-${key}-${i}-len`, type: 'number', min: 0, step: 1, inputMode: 'numeric', value: a.length, oninput: e => { a.length = e.target.value; drawPreview(); } })),
        h('button', { type: 'button', class: 'icon-btn sh-row-del', 'aria-label': `Remove ${String(a.name || '').trim() || 'this act'}`, onclick: () => { f[key].splice(i, 1); draw(-1); drawPreview(); } }, '✕'))));
      if (focusAt != null) setTimeout(() => (focusAt >= 0 ? box.querySelector(`#sh-b-${key}-${focusAt}`) : addBtn).focus(), 0);
    };
    const addBtn = h('button', { type: 'button', class: 'btn ghost small', id: `sh-b-add-${key}`, onclick: () => { f[key].push({ name: '', length: 30 }); draw(f[key].length - 1); drawPreview(); } }, addLabel);
    draw();
    return h('fieldset', { class: 'sh-build-group' }, h('legend', null, label), help && h('p', { class: 'muted small' }, help), box, addBtn);
  };
  const form = h('form', { class: 'sh-build', novalidate: true, onsubmit: e => {
    e.preventDefault();
    const rows = buildRows(f, name);
    if (!rows.length) return toast('Add the doors or your on-stage time first');
    if (existing.length && !confirm(`This replaces the ${plural(existing.length, 'line')} in the running order. Build it?`)) return;
    const ours = rows.find(r => r.ours);
    const ok = saveBooking(b.id, x => {
      x.runningOrder = sortedRows({ ...x, doors: f.doors }, rows);
      x.doors = f.doors;
      x.setTime = ours.time;
      if (f.setLength !== '' && f.setLength != null) x.setLength = Math.max(0, Math.round(num(f.setLength)));
      if (x.curfew || f.curfew !== (v.curfew || '')) x.curfew = f.curfew;
    });
    close();
    if (ok) { toast('Running order built'); refocus('sh-ro-edit'); }
  } },
    h('p', { class: 'muted small' }, 'The acts before you play back to back and finish a changeover before you go on. Anything you change here also updates the show’s times.'),
    h('div', { class: 'form' },
      field('doors', 'Doors', 'time'), field('setTime', 'You go on', 'time'),
      field('setLength', 'Your set (minutes)', 'number'), field('curfew', 'Curfew', 'time'),
      field('change', 'Changeover (minutes)', 'number')),
    actList('before', 'Before you', 'In playing order: the opener first.', '+ Add a support act'),
    actList('after', 'After you', 'If you’re the support: the headliner and anyone after.', '+ Add an act after you'),
    preview,
    h('div', { class: 'form-actions' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'), go));
  drawPreview();
  const { close } = sheet(BUILD_TITLE, form, { dismissOnBackdrop: false });
  setTimeout(() => form.querySelector('input')?.focus(), 50);
}

/* ------------------------------- the box ------------------------------- */
function rowList(b, rows) {
  const at = dayClock(b), cfAt = at(curfewOf(b).time);
  return h('ol', { class: 'sh-ro', 'aria-label': 'Running order' }, rows.map(r => {
    const s = at(r.time), l = num(r.length), late = cfAt != null && s != null && isAct(r) && s + l > cfAt;
    return h('li', { class: 'sh-ro-row' + (r.ours ? ' ours' : '') + (isAct(r) ? '' : ' marker') + (late ? ' late' : '') },
      h('div', { class: 'sh-ro-time' }, h('b', null, r.time || '—'), l > 0 && r.time && h('span', null, '–' + addMinutes(r.time, l))),
      h('div', { class: 'sh-ro-what' }, h('span', { class: 'sh-ro-name' }, nameOf(r)), r.ours && h('span', { class: 'pill sh-you' }, 'You'),
        s != null && s >= 1440 && h('span', { class: 'sh-ro-tag' }, 'after midnight')),
      h('div', { class: 'sh-ro-len' }, l > 0 ? fmtMin(l) : ''));
  }));
}

export function runningText(b) {
  const rows = sortedRows(b);
  const head = ['Running order', bookingTitle(b), textDate(b.date)].filter(Boolean).join(' · ');
  return [head, ...rows.map(r => `${span(r).padEnd(12)} ${nameOf(r)}${r.ours ? ' (us)' : ''}`)].join('\n');
}

export default {
  id: 'running', title: 'Running order', icon: '⏱️', order: 20,
  kinds: ['show'],
  summary(b) {
    const ours = ourSlots(b), acts = rowsOf(b).filter(isAct).length, parts = [];
    if (ours.length) parts.push((ours.length > 1 ? 'Our sets ' : 'Our set ') + ours.map(span).join(', '));
    if (acts) parts.push(plural(acts, 'act'));
    const w = runningWarnings(b);
    if (w.some(x => x.startsWith('Your set ends'))) parts.push('⚠ past curfew');
    else if (w.length) parts.push('⚠ ' + plural(w.length, 'warning'));
    return parts.join(' · ');
  },
  render(b) {
    const rows = sortedRows(b);
    const actions = h('div', { class: 'actions' },
      rows.length > 0 && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-ro-edit', onclick: () => editRunning(b) }, '✎ Edit'),
      h('button', { type: 'button', class: 'btn small ' + (rows.length ? 'ghost' : 'primary'), id: 'sh-ro-build', onclick: () => buildRunning(b) }, '⚡ Build from the show times'),
      rows.length === 0 && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-ro-edit', onclick: () => editRunning(b) }, '+ Add slots by hand'),
      rows.length > 0 && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-ro-copy', onclick: () => copyText(runningText(byIdFresh(b)), 'Running order copied') }, '📋 Copy'));
    if (!rows.length) {
      return h('div', { class: 'sh-block sh-running' },
        h('p', { class: 'muted' }, 'No running order yet. Build it from the doors, your set time and the curfew, then add the support acts with their set lengths.'),
        runningWarnings(b).map(w => h('p', { class: 'warn' }, w)), actions);
    }
    const mine = rows.filter(r => r.ours);
    const drift = mine.length === 1 && b.setTime && mine[0].time && mine[0].time !== b.setTime ? mine[0] : null;
    return h('div', { class: 'sh-block sh-running' },
      rowList(b, rows),
      runningWarnings(b).map(w => h('p', { class: 'warn' }, w)),
      drift && h('div', { class: 'warn sh-drift' }, h('span', null, `The show’s on-stage time is ${b.setTime}, but your slot here is at ${drift.time}.`),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-ro-sync', onclick: () => saveRows(b, rows.map(r => (r === drift ? { ...r, time: b.setTime, length: b.setLength ?? r.length } : r)), `Your slot moved to ${b.setTime}`) }, `Move it to ${b.setTime}`)),
      actions);
  },
  tutorial: [
    { title: 'Running order', text: 'The night in order: doors, the supports, changeovers, your set and the curfew, each with its end time. Times after midnight sort to the end of the night.', target: ['#blk-running .sh-ro', '#blk-running'] },
    { title: 'Build it in one go', text: 'Fill in doors, your time and set length, and the support acts: Gigdex lays out the night with 15-minute changeovers.', target: ['#sh-ro-build'] },
    { title: 'Warnings', text: 'A set past curfew, slots that overlap, or a soundcheck after doors show here in red.', target: ['#blk-running .warn'] },
  ],
};
sheetTutorial(EDIT_TITLE, [
  { title: 'One line per slot', text: 'The time, who or what, and how many minutes. Tick “Our set” on your own slot: its time and length update the show.', target: ['.sh-rows .sh-row'] },
  { title: 'Add a slot', text: 'Doors, a DJ, a changeover, the curfew: anything the night needs. It sorts by time when you save.', target: ['.sh-rows-form .actions .btn'] },
]);
sheetTutorial(BUILD_TITLE, [
  { title: 'The show’s times', text: 'Doors, when you go on, your set length and the curfew. Changes here update the show too.', target: ['#sh-b-doors'] },
  { title: 'Who else plays', text: 'Add each support act with its set length, in playing order. If you’re the support, put the headliner under After you.', target: ['.sh-build-group'] },
  { title: 'Check it', text: 'The order as it will read, with any clash or curfew problem, before you build it.', target: ['.sh-build-preview'] },
]);

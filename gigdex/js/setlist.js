// Setlists: the editor sheet (reorder by dragging the ⠿ handle, with the arrow keys on it, or with the ↑ ↓ buttons;
// add songs from the library, set breaks and free items such as a drum solo; segues; a running clock from 0:00; key and
// tuning changes marked; a slot length to fit), the big printed stage copy, and the setlist as plain text.
// Every change saves to the store at once, and the open sheet draws itself again from the store.
import { h, nodes, uid, toast, announce, sheet, fmtShort, todayISO } from './util.js';
import { db, byId, upsert, remove, update, subscribe } from './store.js';
import { setlistLength, itemTitle, fmtDur, parseDur, fmtMin, actName, markCheck, venueOf, addMinutes, minutesBetween } from './model.js';
import { openForm } from './form.js';
import { printElement } from './print.js';
import { sheetTutorial } from './tour.js';

/* --------------------------------- helpers --------------------------------- */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true });
// The gap between songs, read exactly as model.setlistLength reads it, so every running time agrees with it.
const gapOf = list => (Number.isFinite(Number(list && list.gap)) ? Number(list.gap) : 20);
const isSong = it => it && !it.isBreak;

// "A minor" → "Am", "A♯/B♭ major" → "B♭": the short form musicians write on a setlist. The spelling of the black-note
// keys follows common use (B♭ and E♭ major, F♯ and C♯ minor).
const BLACK_MAJOR = { 'C♯/D♭': 'D♭', 'D♯/E♭': 'E♭', 'F♯/G♭': 'F♯', 'G♯/A♭': 'A♭', 'A♯/B♭': 'B♭' };
const BLACK_MINOR = { 'C♯/D♭': 'C♯', 'D♯/E♭': 'E♭', 'F♯/G♭': 'F♯', 'G♯/A♭': 'G♯', 'A♯/B♭': 'B♭' };
export function shortKey(key) {
  const k = String(key || '').trim(), m = k.match(/^(.+?)\s+(major|minor)$/i);
  if (!m) return k;
  const minor = /minor/i.test(m[2]);
  return ((minor ? BLACK_MINOR : BLACK_MAJOR)[m[1]] || m[1]) + (minor ? 'm' : '');
}
const sameTuning = (a, b) => String(a || 'Standard').trim().toLowerCase() === String(b || 'Standard').trim().toLowerCase();
const isStandard = t => !String(t || '').trim() || /^standard$/i.test(String(t).trim());

// The setlist laid out for drawing: one row per item with its number, title, length and start time from 0:00, the key
// and tuning changes from the song before (a set break starts afresh), and the gap after it. The total is
// model.setlistLength's, and the start times are worked out by the same rule, so the two always agree.
export function setlistPlan(list) {
  const items = ((list && list.items) || []).filter(Boolean);
  const gap = gapOf(list), songIdx = items.map((it, i) => (isSong(it) ? i : -1)).filter(i => i >= 0), lastSong = songIdx[songIdx.length - 1];
  let t = 0, n = 0, prev = null;
  const rows = items.map((it, i) => {
    if (it.isBreak) { prev = null; return { it, kind: 'break', title: String(it.title || '').trim() || 'SET BREAK', start: t, dur: 0, gapAfter: 0 }; }
    const song = it.songId ? byId('songs', it.songId) : null;
    const dur = Number(it.duration) || (song && Number(song.duration)) || 0;
    const row = { it, kind: song ? 'song' : 'free', song, n: ++n, title: itemTitle(it), dur, start: t, key: (song && song.key) || '', bpm: (song && song.bpm) || '', tuning: (song && song.tuning) || '' };
    if (song) {
      if (prev && row.key && prev.key && row.key !== prev.key) row.keyFrom = prev.key;
      if (prev && !sameTuning(prev.tuning, row.tuning)) row.tuneFrom = prev.tuning || 'Standard';
      prev = row;
    }
    row.last = i === lastSong;
    row.gapAfter = !row.last && !it.segue ? gap : 0;
    t += dur + row.gapAfter;
    return row;
  });
  return { rows, gap, ...setlistLength(list) };
}

// How a set's running time sits against a slot in minutes: over by any amount is a problem; more than five minutes
// under is worth knowing (room for another song); anything else fits. { tone: 'over'|'under'|'ok'|'', diff (s), text }
export function fitNote(sec, slotMin) {
  const slot = Number(slotMin);
  if (!(slot > 0)) return { tone: '', diff: 0, text: '' };
  const diff = Math.round(sec - slot * 60);
  if (diff > 0) return { tone: 'over', diff, text: `${fmtDur(diff)} over the ${fmtMin(slot)} slot` };
  if (diff < -300) return { tone: 'under', diff, text: `${fmtDur(-diff)} under the ${fmtMin(slot)} slot` };
  return { tone: 'ok', diff, text: diff === 0 ? `Exactly the ${fmtMin(slot)} slot` : `Fits the ${fmtMin(slot)} slot, ${fmtDur(-diff)} to spare` };
}

// When a show's set ends by the clock: "21:15" + the running time, rounded up to the minute (wraps past midnight), and
// whether that runs past the curfew (the booking's, else the venue's).
export function setClock(b, sec) {
  if (!b || !/^\d{1,2}:\d{2}$/.test(b.setTime || '') || !sec) return null;
  const mins = Math.ceil(sec / 60), off = addMinutes(b.setTime, mins), curfew = b.curfew || venueOf(b).curfew || '';
  const room = curfew ? minutesBetween(b.setTime, curfew) : null;
  return { on: b.setTime, off, curfew, late: room != null && room > 0 && mins > room };
}

// Ticks "Setlist ready" on the shows that use this setlist, once it has something in it. Quiet (model.markCheck).
export function tickShows(setlistId) {
  const list = byId('setlists', setlistId);
  if (!list || !(list.items || []).some(isSong)) return;
  db.bookings.filter(b => b.kind === 'show' && b.setlistId === setlistId && b.status !== 'cancelled').map(b => b.id).forEach(id => markCheck(id, 'show-setlist', true));
}

// The setlist as plain text, to paste into a message to the band.
export function setlistText(list) {
  const p = setlistPlan(list), out = [list.name || 'Setlist', [actName(list.actId), plural(p.songs, 'song'), fmtDur(p.sec)].filter(Boolean).join(' · '), ''];
  let encore = false;
  for (const r of p.rows) {
    if (r.kind === 'break') { out.push('', `— ${r.title} —`); encore = /encore/i.test(r.title); continue; }
    if (r.it.encore && !encore) { out.push('', '— ENCORE —'); encore = true; }
    const bits = [r.key && `(${shortKey(r.key)})`, r.dur ? fmtDur(r.dur) : '', r.it.segue && !r.last ? '→' : ''].filter(Boolean).join(' ');
    out.push(`${r.n}. ${r.title}${bits ? ' ' + bits : ''}${r.it.note ? ` [${r.it.note}]` : ''}`);
  }
  if (p.missing) out.push('', `${plural(p.missing, 'item')} without a length, so the real total is longer.`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* --------------------------------- records --------------------------------- */
// Makes a setlist and returns the stored record. preset: { name, actId, gap, items, notes }.
export function newSetlist(preset = {}) {
  const p = preset || {};
  return upsert('setlists', {
    name: String(p.name || '').trim() || 'New setlist', actId: p.actId || '',
    gap: Number.isFinite(Number(p.gap)) && p.gap !== '' && p.gap != null ? Math.max(0, Number(p.gap)) : 20,
    items: (Array.isArray(p.items) ? p.items : []).filter(Boolean).map(it => ({ ...it, id: it.id || uid() })), notes: p.notes || '',
  });
}
function saveList(id, fields) {
  if (!byId('setlists', id)) return;
  update(d => { const s = d.setlists.find(x => x.id === id); if (!s) return; Object.assign(s, fields); s.updatedAt = Date.now(); });
}
// Changes a setlist's items: fn gets a copy of the list and returns the new list.
function editItems(id, fn) {
  if (!byId('setlists', id)) return false;
  update(d => { const s = d.setlists.find(x => x.id === id); if (!s) return; s.items = fn((s.items || []).filter(Boolean).map(x => ({ ...x }))); s.updatedAt = Date.now(); });
  return true;
}
// Leaves out empty fields, so an item only carries what it says (no segue: false, note: '').
const tidy = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== false && v !== 0 && v !== null));
const setItem = (id, itemId, fields) => editItems(id, its => its.map(x => (x.id === itemId ? tidy({ ...x, ...fields }) : x)));
const itemsOf = id => ((byId('setlists', id) || {}).items || []).filter(Boolean);
const rowOf = (id, itemId) => { const list = byId('setlists', id); return list ? setlistPlan(list).rows.find(r => r.it.id === itemId) || null : null; };
const sayItem = r => (r.kind === 'break' ? `set break ${r.title}` : `${r.n}, ${r.title}`);
function said(id, itemId) {
  const items = itemsOf(id), at = items.findIndex(x => x.id === itemId), r = rowOf(id, itemId);
  return r ? `now ${at + 1} of ${items.length}${r.kind === 'break' ? '' : `, starting at ${fmtDur(r.start)}`}` : '';
}
function moveTo(id, itemId, to) {
  const items = itemsOf(id), i = items.findIndex(x => x.id === itemId), r = rowOf(id, itemId);
  if (i < 0) return;
  const j = Math.max(0, Math.min(items.length - 1, to));
  if (j === i) { announce(j === 0 ? 'Already at the top' : 'Already at the bottom'); return; }
  editItems(id, its => { const [x] = its.splice(i, 1); its.splice(j, 0, x); return its; });
  announce(`${r.title} moved ${j < i ? 'up' : 'down'}: ${said(id, itemId)}`);
}
const moveBy = (id, itemId, d) => { const i = itemsOf(id).findIndex(x => x.id === itemId); if (i >= 0) moveTo(id, itemId, i + d); };
function setOrder(id, ids) {
  const before = itemsOf(id).map(x => x.id);
  if (ids.join() === before.join()) return false;
  editItems(id, its => { const m = new Map(its.map(x => [x.id, x])), next = ids.map(k => m.get(k)).filter(Boolean); return [...next, ...its.filter(x => !ids.includes(x.id))]; });
  return true;
}
// Older or imported items may have no id: the editor needs one per item to move it.
function ensureIds(id) {
  if (itemsOf(id).every(x => x.id)) return;
  editItems(id, its => its.map(x => (x.id ? x : { ...x, id: uid() })));
}
// Where an added item goes: [value, label] for the form's select; '' is the end.
const placeOptions = id => [['', 'At the end'], ['0', 'At the start'], ...setlistPlan(byId('setlists', id)).rows.map((r, i) => [String(i + 1), `After ${r.kind === 'break' ? r.title : r.n + '. ' + r.title}`])];
const insertAt = (its, place, x) => { const at = place === '' || place == null ? its.length : Math.max(0, Math.min(its.length, Number(place))); its.splice(at, 0, x); return its; };

/* ------------------------------- live sheets ------------------------------- */
// A sheet drawn from the store and drawn again after every change, keeping the scroll and the focused control (known
// by its data-fk). draw(ctx) returns the body's children, or null when its record has gone (the sheet then closes).
// ctx: { close(), repaint(), focus(key) } — focus names the control to focus after the next drawing.
// While a finger or the mouse button is down, the drawing waits until it lifts: a text box that saves when it loses the
// focus would otherwise redraw the sheet under the press, and the button being tapped would never get its click.
export function liveSheet(title, draw, { cls = '' } = {}) {
  const body = h('div', { class: ('sg-live ' + cls).trim(), tabIndex: -1 });
  let fk = null, want = null, queued = false, down = false, unsub = () => {}, s = null;
  body.addEventListener('focusin', e => { const k = e.target.closest && e.target.closest('[data-fk]'); fk = k && body.contains(k) ? k.dataset.fk : fk; });
  const run = () => { if (queued && !down) paint(); };
  // (A lift that never arrives, say a release outside the window, holds the drawing back for two seconds at most.)
  const later = () => { if (!queued) { queued = true; queueMicrotask(run); setTimeout(() => { if (queued) { down = false; run(); } }, 2000); } };
  const press = () => { down = true; };
  const lift = () => { down = false; if (queued) setTimeout(run, 0); }; // after the click that follows the lift
  const ctx = { close: () => s && s.close(), repaint: later, focus: key => { want = key; } };
  function paint() {
    queued = false;
    const kids = draw(ctx);
    if (!kids) { if (s) s.close(); return false; }
    const scroller = body.parentElement, y = scroller ? scroller.scrollTop : 0, a = document.activeElement;
    const inside = !!a && (a === body || body.contains(a)); // the focus is ours to keep (not in a sheet on top, not elsewhere)
    body.replaceChildren(...nodes(kids));
    if (scroller) scroller.scrollTop = y;
    const key = want || fk; want = null;
    if (inside && key) {
      const el = body.querySelector(`[data-fk="${CSS.escape(key)}"]`);
      if (el) { fk = key; el.focus({ preventScroll: true }); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    }
    return true;
  }
  s = sheet(title, body, { onClose: () => { unsub(); document.removeEventListener('pointerdown', press, true); document.removeEventListener('pointerup', lift, true); document.removeEventListener('pointercancel', lift, true); } });
  document.addEventListener('pointerdown', press, true); document.addEventListener('pointerup', lift, true); document.addEventListener('pointercancel', lift, true);
  unsub = subscribe(later);
  if (paint()) body.focus({ preventScroll: true });
  return { ...s, ctx };
}

/* --------------------------------- editor --------------------------------- */
let dragged = false; // a drag just ended: the click that follows it is not a tap
const label = (text, control, cls = '') => h('label', { class: ('sg-f ' + cls).trim() }, h('span', null, text), control);
const stat = (value, text, cls = '') => h('div', { class: ('stat ' + cls).trim() }, h('b', null, value), h('span', null, text));

// Opens the editor. opts: { target: slot in minutes (from a booking's set length), bookingId (the booking it was
// opened from: its set time and curfew are shown, and its date and venue go on the printout) }.
export function openSetlist(id, opts = {}) {
  if (!byId('setlists', id)) { toast('That setlist is not there any more.'); return null; }
  ensureIds(id);
  const st = { id, target: Number(opts && opts.target) > 0 ? Number(opts.target) : '', bookingId: (opts && opts.bookingId) || '' };
  return liveSheet('Edit setlist', ctx => { const list = byId('setlists', st.id); return list ? editor(list, st, ctx) : null; }, { cls: 'sg-ed' });
}

function editor(list, st, ctx) {
  const p = setlistPlan(list), fit = fitNote(p.sec, st.target);
  const b = st.bookingId ? byId('bookings', st.bookingId) : null, clock = b && b.kind === 'show' ? setClock(b, p.sec) : null;
  const acts = [...db.acts].sort(byName);
  const used = db.bookings.filter(x => x.setlistId === list.id && x.status !== 'cancelled' && (x.endDate || x.date || '') >= todayISO()).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const rows = p.rows.map((r, i) => itemRow(list, p, r, i, ctx));
  return [
    h('div', { class: 'sg-ed-fields' },
      label('Name', h('input', { id: 'sl-name', 'data-fk': 'sl-name', value: list.name || '', autocomplete: 'off', maxLength: 120, onchange: e => saveList(list.id, { name: e.target.value.trim() || 'Untitled setlist' }) }), 'sg-f-name'),
      label('Act', h('select', { id: 'sl-act', 'data-fk': 'sl-act', onchange: e => saveList(list.id, { actId: e.target.value }) },
        [['', 'No act'], ...acts.map(a => [a.id, a.name || 'Untitled act'])].map(([v, l]) => h('option', { value: v, selected: v === (byId('acts', list.actId) ? list.actId : '') }, l)))),
      label('Gap', h('span', { class: 'sg-unit' }, h('input', { id: 'sl-gap', 'data-fk': 'sl-gap', type: 'number', min: 0, max: 600, step: 1, inputMode: 'numeric', value: p.gap, 'aria-label': 'Gap between songs, in seconds',
        onchange: e => { const v = Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))); saveList(list.id, { gap: v }); announce(`Gap between songs: ${v} seconds`); } }), h('span', { 'aria-hidden': 'true' }, 's'))),
      label('Slot', h('span', { class: 'sg-unit' }, h('input', { id: 'sl-target', 'data-fk': 'sl-target', type: 'number', min: 0, step: 1, inputMode: 'numeric', value: st.target, placeholder: '—', 'aria-label': 'Slot length to fit, in minutes',
        onchange: e => { const v = Math.round(Number(e.target.value) || 0); st.target = v > 0 ? v : ''; ctx.repaint(); } }), h('span', { 'aria-hidden': 'true' }, 'min')))),
    h('div', { class: 'stats sg-stats', role: 'group', 'aria-label': 'Totals' },
      stat(fmtDur(p.sec), 'running time'),
      stat(String(p.songs), p.songs === 1 ? 'song' : 'songs'),
      st.target ? stat((fit.tone === 'over' ? '+' : '') + fmtDur(Math.abs(fit.diff)), fit.tone === 'over' ? `over ${fmtMin(st.target)}` : `to spare in ${fmtMin(st.target)}`, 'sg-fit-' + fit.tone)
        : stat(p.missing ? String(p.missing) : '✓', p.missing ? 'without a length' : 'all timed', p.missing ? 'sg-fit-over' : '')),
    fit.tone === 'over' && h('p', { class: 'warn sg-fit', role: 'status' }, `⚠ ${fit.text}. Cut a song, tighten a segue, or ask for a longer set.`),
    fit.tone === 'under' && h('p', { class: 'sg-soft sg-fit', role: 'status' }, `${fit.text}: room for another song or two.`),
    fit.tone === 'ok' && h('p', { class: 'sg-ok sg-fit', role: 'status' }, '✓ ' + fit.text),
    st.target && p.missing > 0 && h('p', { class: 'small muted' }, `${plural(p.missing, 'item')} ${p.missing === 1 ? 'has' : 'have'} no length, so the real running time is longer.`),
    clock && h('p', { class: 'small ' + (clock.late ? 'warn' : 'muted') }, `On at ${clock.on}, off about ${clock.off}${clock.late ? `: past the ${clock.curfew} curfew` : clock.curfew ? ` (curfew ${clock.curfew})` : ''}.`),
    rows.length
      ? h('ol', { class: 'sg-items', 'aria-label': `${list.name || 'Setlist'}, in playing order` }, rows)
      : h('div', { class: 'empty sg-ed-empty' }, h('p', null, 'Nothing in this setlist yet. Add songs from your library, then set breaks and anything else that takes time on stage.')),
    rows.length > 1 && h('p', { class: 'small muted sg-hint' }, 'Drag ⠿ to reorder (or focus it and use the arrow keys), or use ↑ ↓. Tap ⠿ for the note, length, segue and remove.'),
    h('div', { class: 'actions sg-add' },
      h('button', { class: 'btn primary', type: 'button', 'data-fk': 'sl-add-songs', onclick: () => openPicker(list.id, ctx) }, '+ Songs'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sl-add-break', onclick: () => addBreak(list.id, ctx) }, '+ Set break'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sl-add-item', onclick: () => addFree(list.id, ctx) }, '+ Other item')),
    label('Notes for the band', h('textarea', { id: 'sl-notes', 'data-fk': 'sl-notes', rows: 2, value: list.notes || '', placeholder: 'Count-ins, who starts what, changes since last time…', onchange: e => saveList(list.id, { notes: e.target.value.trim() }) }), 'sg-f-notes'),
    used.length > 0 && h('p', { class: 'small muted' }, 'Coming up with this setlist: ' + used.slice(0, 3).map(x => [x.date && fmtShort(x.date), venueOf(x).name].filter(Boolean).join(' · ')).join('; ') + (used.length > 3 ? ` and ${used.length - 3} more` : '') + '.'),
    h('div', { class: 'actions sg-ed-foot' },
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sl-print', onclick: () => printSetlist(list.id, { bookingId: st.bookingId }) }, '🖨 Print'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sl-copy', onclick: () => copySetlist(list.id) }, '📋 Copy as text'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sl-dup', onclick: () => duplicate(list.id, st, ctx) }, '⧉ Duplicate'),
      h('button', { class: 'btn danger', type: 'button', 'data-fk': 'sl-del', onclick: () => deleteSetlist(list.id, ctx) }, 'Delete')),
  ];
}

function itemRow(list, p, r, i, ctx) {
  const it = r.it, name = sayItem(r), first = i === 0, last = i === p.rows.length - 1;
  const handle = h('button', {
    class: 'sg-handle', type: 'button', 'data-fk': 'h' + it.id, 'aria-label': `Move ${name}: drag, or use the up and down arrow keys. Activate for its note, length and more`, title: 'Drag to move, or tap for options',
    onpointerdown: e => drag(e, list.id, it.id, ctx), onkeydown: e => keyMove(e, list.id, it.id), onclick: () => { if (dragged) { dragged = false; return; } itemSheet(list.id, it.id, ctx); },
  }, '⠿');
  const mv = (d, k, sym, off) => h('button', { class: 'icon-btn sg-mv', type: 'button', 'data-fk': k + it.id, 'aria-label': `Move ${name} ${d < 0 ? 'up' : 'down'}`, 'aria-disabled': off ? 'true' : null, onclick: () => moveBy(list.id, it.id, d) }, sym);
  const moves = h('div', { class: 'sg-mvs' }, mv(-1, 'u', '↑', first), mv(1, 'd', '↓', last));
  if (r.kind === 'break') {
    return h('li', { class: 'sg-item sg-break', 'data-id': it.id }, handle,
      h('div', { class: 'sg-row' }, h('span', { class: 'sg-start', title: 'At' }, fmtDur(r.start)), h('span', { class: 'sg-t' }, r.title), it.note && h('span', { class: 'sg-note' }, it.note)),
      moves);
  }
  const tags = [
    (r.tuneFrom || (r.kind === 'song' && !isStandard(r.tuning))) && h('span', { class: 'sg-tag' + (r.tuneFrom ? ' chg' : ''), title: r.tuneFrom ? `Retune from ${r.tuneFrom} to ${r.tuning || 'Standard'}` : `Tuning: ${r.tuning}` }, (r.tuneFrom ? 'Retune: ' : '') + (r.tuning || 'Standard')),
    it.encore && h('span', { class: 'sg-tag' }, 'Encore'),
  ].filter(Boolean);
  // A new key is marked on the key itself (in the accent colour, with ↗), so a run of key changes stays readable.
  const meta = [r.key && h('span', { class: 'sg-k' + (r.keyFrom ? ' chg' : ''), title: r.keyFrom ? `Key change from ${r.keyFrom} to ${r.key}` : r.key }, r.keyFrom && h('span', { 'aria-hidden': 'true' }, '↗ '), shortKey(r.key), r.keyFrom && h('span', { class: 'sr-only' }, `, a key change from ${r.keyFrom}`)), r.bpm && h('span', null, `${r.bpm} BPM`), r.dur ? h('span', null, fmtDur(r.dur)) : h('span', { class: 'sg-miss' }, 'no length')];
  return h('li', { class: 'sg-item' + (r.kind === 'free' ? ' sg-free' : ''), 'data-id': it.id }, handle,
    h('div', { class: 'sg-row' },
      h('span', { class: 'sg-start', title: 'Starts at' }, fmtDur(r.start)),
      h('span', { class: 'sg-t' }, h('span', { class: 'sg-n' }, r.n + '. '), r.title),
      h('span', { class: 'sg-meta' }, meta, tags,
        !r.last && h('button', { class: 'sg-seg' + (it.segue ? ' on' : ''), type: 'button', 'data-fk': 's' + it.id, 'aria-pressed': String(!!it.segue), 'aria-label': `Segue from ${r.title} into the next item, with no gap`,
          title: it.segue ? 'Segue: straight into the next one. Tap for a gap.' : `A ${p.gap}s gap follows. Tap to segue straight into the next one.`,
          onclick: () => { setItem(list.id, it.id, { segue: !it.segue }); announce(it.segue ? `${p.gap} second gap after ${r.title}` : `${r.title} segues into the next item`); } }, it.segue ? '→ segue' : `${p.gap}s gap`)),
      it.note && h('span', { class: 'sg-note' }, it.note)),
    moves);
}

// Arrow keys on a handle move the item one place (Home and End: to the top or bottom); the focus stays on its handle.
function keyMove(e, id, itemId) {
  const k = e.key;
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(k)) return;
  e.preventDefault(); e.stopPropagation(); // the arrows move the item, not the Rolodex
  if (k === 'Home') return moveTo(id, itemId, 0);
  if (k === 'End') return moveTo(id, itemId, itemsOf(id).length - 1);
  moveBy(id, itemId, k === 'ArrowUp' ? -1 : 1);
}

// Dragging starts once the pointer has moved a little (a tap never moves anything). The item stays in place under a
// drop line until it is let go; the sheet scrolls when the pointer nears its top or bottom edge. Escape cancels.
function drag(e, id, itemId) {
  if (e.button > 0) return;
  const grip = e.currentTarget, root = grip.closest('.sg-ed'), y0 = e.clientY;
  if (!root) return;
  let y = y0, raf = 0, done = false, on = false, ghost = null;
  try { grip.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  const mark = h('li', { class: 'sg-drop', 'aria-hidden': 'true' });
  const liveList = () => root.querySelector('.sg-items');
  const liveLi = () => { const l = liveList(); return l && [...l.children].find(n => n.dataset && n.dataset.id === itemId); };
  const start = () => {
    on = true; const li = liveLi(); if (!li) return;
    const r = li.getBoundingClientRect();
    ghost = li.cloneNode(true); ghost.classList.add('sg-ghost'); ghost.removeAttribute('data-id');
    ghost.querySelectorAll('[data-fk], [id]').forEach(n => { n.removeAttribute('data-fk'); n.removeAttribute('id'); });
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', margin: '0', pointerEvents: 'none', zIndex: '200' });
    document.body.append(ghost); li.classList.add('sg-placeholder'); document.body.classList.add('sg-dragging');
  };
  const place = () => {
    const l = liveList(), li = liveLi(); if (!l || !li) return;
    if (ghost) ghost.style.transform = `translateY(${y - y0}px)`;
    const others = [...l.querySelectorAll(':scope > li[data-id]')].filter(n => n !== li);
    const before = others.find(n => { const q = n.getBoundingClientRect(); return y < q.top + q.height / 2; });
    if (before) { if (mark.nextElementSibling !== before || mark.parentNode !== l) l.insertBefore(mark, before); } else if (l.lastElementChild !== mark) l.append(mark);
  };
  const tick = () => {
    const sc = root.parentElement;
    if (sc) { const r = sc.getBoundingClientRect(), edge = 56, dy = y < r.top + edge ? -10 : y > r.bottom - edge ? 10 : 0; if (dy) { sc.scrollTop += dy; place(); } }
    raf = requestAnimationFrame(tick);
  };
  const move = ev => { if (ev.pointerId !== e.pointerId) return; y = ev.clientY; if (!on && Math.abs(y - y0) > 6) { start(); raf = requestAnimationFrame(tick); } if (on) { ev.preventDefault(); place(); } };
  const end = ev => {
    if (done || (ev && ev.pointerId != null && ev.pointerId !== e.pointerId)) return;
    done = true; cancelAnimationFrame(raf);
    removeEventListener('pointermove', move, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); removeEventListener('keydown', esc, true);
    if (ghost) ghost.remove(); document.body.classList.remove('sg-dragging');
    const l = liveList(), li = liveLi(); if (li) li.classList.remove('sg-placeholder');
    const ids = on && l && mark.parentNode === l ? [...l.children].flatMap(n => (n === mark ? [itemId] : n !== li && n.dataset && n.dataset.id ? [n.dataset.id] : [])) : null;
    mark.remove();
    if (on) { dragged = true; setTimeout(() => { dragged = false; }, 400); }
    if (ev && ev.type === 'pointerup' && ids && setOrder(id, ids)) { const r = rowOf(id, itemId); if (r) announce(`${r.title} moved: ${said(id, itemId)}`); }
  };
  const esc = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(null); } };
  addEventListener('pointermove', move, { capture: true, passive: false }); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true); addEventListener('keydown', esc, true);
}

// One item's own details: a song's length in this set (blank: the song's), a free item's title and length, a break's
// heading; a note; segue and encore; and moves to the top or bottom, open the song, remove.
function itemSheet(id, itemId, ctx) {
  const r = rowOf(id, itemId);
  if (!r) return;
  const it = r.it, song = r.song, isBreak = r.kind === 'break';
  const f = {};
  if (!song) f.title = h('input', { id: 'sli-title', value: it.title || '', required: true, autocomplete: 'off', maxLength: 120, placeholder: isBreak ? 'SET 2' : 'Drum solo', list: isBreak ? 'sli-heads' : 'sli-free' });
  if (!isBreak) f.len = h('input', { id: 'sli-len', value: it.duration ? fmtDur(it.duration) : '', autocomplete: 'off', placeholder: song && song.duration ? fmtDur(song.duration) : 'm:ss' });
  f.note = h('input', { id: 'sli-note', value: it.note || '', autocomplete: 'off', maxLength: 200, placeholder: isBreak ? 'e.g. 15 minutes, back on at 22:00' : 'e.g. capo 2, slow count-in, Maya on keys' });
  if (!isBreak) { f.segue = h('input', { type: 'checkbox', id: 'sli-segue', checked: !!it.segue }); f.encore = h('input', { type: 'checkbox', id: 'sli-encore', checked: !!it.encore }); }
  let s = null;
  const save = () => {
    const fields = { note: f.note.value.trim() };
    if (f.title) { const t = f.title.value.trim(); if (!t) { f.title.focus(); toast('Give it a title'); return; } fields.title = t; }
    if (f.len) {
      const raw = f.len.value.trim(), d = parseDur(raw);
      if (raw && !d) { f.len.focus(); toast('Type the length as minutes and seconds, like 3:45'); return; }
      fields.duration = d || undefined;
    }
    if (f.segue) fields.segue = f.segue.checked;
    if (f.encore) fields.encore = f.encore.checked;
    s.close();
    editItems(id, its => its.map(x => { if (x.id !== itemId) return x; const y = { ...x, ...fields }; if (fields.duration === undefined && 'duration' in fields) delete y.duration; return tidy(y); }));
    if (!isBreak) tickShows(id);
    toast('Saved');
  };
  const goEnd = top => { s.close(); moveTo(id, itemId, top ? 0 : itemsOf(id).length - 1); };
  const lenHint = song ? `Leave it empty to use the song’s ${song.duration ? fmtDur(song.duration) : 'length (none yet)'}. Minutes and seconds, like 4:30.` : 'Minutes and seconds, like 1:30. Leave it empty if it has no set length.';
  const form = h('form', { class: 'sg-item-form', onsubmit: e => { e.preventDefault(); save(); } },
    song && h('div', { class: 'sg-item-song' }, h('b', null, song.title || 'Untitled'), h('span', { class: 'muted small' }, [song.key, song.bpm && song.bpm + ' BPM', song.duration ? fmtDur(song.duration) : 'no length yet', song.tuning].filter(Boolean).join(' · '))),
    f.title && label(isBreak ? 'Heading' : 'Title', f.title),
    f.title && h('datalist', { id: isBreak ? 'sli-heads' : 'sli-free' }, (isBreak ? BREAKS : FREE).map(v => h('option', { value: v }))),
    f.len && label(song ? 'Length in this set' : 'Length', f.len), f.len && h('small', { class: 'muted sg-f-hint' }, lenHint),
    label('Note', f.note),
    f.segue && h('label', { class: 'check' }, f.segue, h('span', null, 'Segue into the next item ', h('em', null, '(no gap)'))),
    f.encore && h('label', { class: 'check' }, f.encore, h('span', null, 'Encore')),
    h('div', { class: 'form-actions' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn ghost', onclick: () => s.close() }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  const more = h('div', { class: 'actions sg-item-more' },
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => goEnd(true) }, '⤒ To the top'),
    h('button', { class: 'btn ghost small', type: 'button', onclick: () => goEnd(false) }, '⤓ To the bottom'),
    song && h('button', { class: 'btn ghost small', type: 'button', onclick: () => { s.close(); import('./pages/songs.js').then(m => m.openSong(song.id)); } }, '🎼 Open the song'),
    h('button', { class: 'btn danger small', type: 'button', onclick: () => { s.close(); removeItem(id, itemId, ctx); } }, isBreak ? 'Remove this break' : 'Remove from the setlist'));
  s = sheet(isBreak ? 'Set break' : 'Setlist item', h('div', { class: 'sg-item-sheet' }, form, more));
}
const BREAKS = ['SET 2', 'SET 3', 'ENCORE', 'INTERVAL', 'CHANGEOVER'];
const FREE = ['Drum solo', 'Talk to the crowd', 'Band intros', 'Intro tape', 'Tuning break', 'Jam', 'Crowd singalong', 'Outro tape'];

function removeItem(id, itemId, ctx) {
  const items = itemsOf(id), i = items.findIndex(x => x.id === itemId), r = rowOf(id, itemId);
  if (i < 0) return;
  const next = items[i + 1] || items[i - 1];
  ctx.focus(next ? 'h' + next.id : 'sl-add-songs');
  editItems(id, its => its.filter(x => x.id !== itemId));
  toast(`Removed “${r ? r.title : 'item'}”`);
}

function addBreak(id, ctx) {
  const n = itemsOf(id).filter(x => x.isBreak).length;
  openForm({
    title: 'Add a set break', saveLabel: 'Add',
    values: { title: n ? `SET ${n + 2}` : 'SET 2', place: '' },
    fields: [
      { key: 'title', label: 'Heading', required: true, list: BREAKS, hint: 'A heading on the printed setlist: SET 2, ENCORE, or your own.' },
      { key: 'place', label: 'Where', type: 'select', options: placeOptions(id) },
    ],
    onSave: v => {
      const x = { id: uid(), isBreak: true, title: String(v.title || '').trim() || 'SET 2' };
      ctx.focus('h' + x.id);
      editItems(id, its => insertAt(its, v.place, x));
      announce(`Set break ${x.title} added`);
    },
  });
}

function addFree(id, ctx) {
  openForm({
    title: 'Add an item', saveLabel: 'Add',
    values: { title: '', duration: '', note: '', place: '' },
    fields: [
      { key: 'title', label: 'What', required: true, list: FREE, placeholder: 'Drum solo, talk to the crowd…' },
      { key: 'duration', label: 'Length', placeholder: '1:30', hint: 'Minutes and seconds. Leave it empty if it has no set length.' },
      { key: 'note', label: 'Note', placeholder: 'Optional' },
      { key: 'place', label: 'Where', type: 'select', options: placeOptions(id) },
    ],
    onSave: v => {
      const raw = String(v.duration || '').trim(), d = parseDur(raw);
      if (raw && !d) toast(`Could not read the length “${raw}”: added without one. Tap ⠿ on it to set it, like 1:30.`);
      const x = tidy({ id: uid(), title: String(v.title || '').trim() || 'Item', duration: d, note: String(v.note || '').trim() });
      ctx.focus('h' + x.id);
      editItems(id, its => insertAt(its, v.place, x));
      tickShows(id);
      announce(`${x.title} added`);
    },
  });
}

/* --------------------------------- picker --------------------------------- */
// Pick songs to add: the setlist's act first, then the rest; search; several at once, added in the order ticked.
function openPicker(id, ctx) {
  const sel = [];
  let q = '', unsub = () => {}, s = null;
  const listBox = h('div', { class: 'sg-pick-list', role: 'group', 'aria-label': 'Songs' });
  const addBtn = h('button', { class: 'btn primary', type: 'button', id: 'sgp-add', onclick: () => add() }, 'Add songs');
  const search = h('input', { class: 'search', type: 'search', id: 'sgp-q', placeholder: 'Search songs…', 'aria-label': 'Search songs', autocomplete: 'off', oninput: e => { q = e.target.value; draw(); } });
  const newSong = () => {
    const list = byId('setlists', id);
    import('./pages/songs.js').then(m => m.editSong({ actId: (list && list.actId) || '' }, rec => { if (rec && !sel.includes(rec.id)) sel.push(rec.id); draw(); }));
  };
  const refresh = () => {
    listBox.querySelectorAll('[data-song]').forEach(row => { const at = sel.indexOf(row.dataset.song); row.querySelector('.sg-pick-no').textContent = at >= 0 ? String(at + 1) : ''; });
    addBtn.textContent = sel.length ? `Add ${plural(sel.length, 'song')}` : 'Add songs';
    addBtn.disabled = !sel.length;
  };
  const row = (song, inSet, showAct) => {
    const cb = h('input', { type: 'checkbox', 'data-fk': 'p' + song.id, checked: sel.includes(song.id), onchange: e => { const at = sel.indexOf(song.id); if (e.target.checked && at < 0) sel.push(song.id); if (!e.target.checked && at >= 0) sel.splice(at, 1); refresh(); } });
    return h('label', { class: 'check sg-pick-row', 'data-song': song.id }, cb,
      h('span', { class: 'sg-pick-text' },
        h('span', { class: 'sg-pick-t' }, song.title || 'Untitled', inSet && h('em', null, ' · in this setlist')),
        h('span', { class: 'small muted' }, [shortKey(song.key), song.bpm && song.bpm + ' BPM', song.duration ? fmtDur(song.duration) : 'no length', showAct && (actName(song.actId) || 'No act')].filter(Boolean).join(' · '))),
      h('span', { class: 'sg-pick-no', 'aria-hidden': 'true' }));
  };
  function draw() {
    const list = byId('setlists', id);
    if (!list) { if (s) s.close(); return; }
    const inSet = new Set((list.items || []).map(x => x && x.songId).filter(Boolean));
    const ql = q.trim().toLowerCase();
    const songs = db.songs.filter(x => !ql || `${x.title} ${x.key} ${shortKey(x.key)} ${x.tuning || ''} ${actName(x.actId)}`.toLowerCase().includes(ql)).sort(byTitle);
    const act = byId('acts', list.actId) ? list.actId : '';
    const groups = act
      ? [[actName(act), songs.filter(x => x.actId === act), false], [db.songs.some(x => x.actId === act) ? 'Other songs' : 'Songs', songs.filter(x => x.actId !== act), true]]
      : [['Songs', songs, true]];
    const a = document.activeElement, keep = a && listBox.contains(a) && a.dataset ? a.dataset.fk : null;
    if (!db.songs.length) listBox.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'Your song library is empty. Add a song and it is ticked here, ready to go in.'), h('button', { class: 'btn primary', type: 'button', onclick: newSong }, '+ New song')));
    else if (!songs.length) listBox.replaceChildren(h('p', { class: 'muted' }, `No songs match “${q.trim()}”.`));
    else listBox.replaceChildren(...groups.filter(g => g[1].length).map(([t, arr, showAct]) => h('div', { class: 'sg-pick-group' }, h('h4', null, t), arr.map(x => row(x, inSet.has(x.id), showAct)))));
    if (keep) { const el = listBox.querySelector(`[data-fk="${CSS.escape(keep)}"]`); if (el) el.focus({ preventScroll: true }); }
    refresh();
  }
  function add() {
    const ids = sel.filter(k => byId('songs', k));
    if (!ids.length) return;
    s.close();
    const items = ids.map(songId => ({ id: uid(), songId }));
    ctx.focus('h' + items[0].id);
    editItems(id, its => [...its, ...items]);
    tickShows(id);
    toast(`Added ${plural(ids.length, 'song')}`);
  }
  const body = h('div', { class: 'sg-pick', tabIndex: -1 },
    h('div', { class: 'sg-pick-top' }, search, h('button', { class: 'btn ghost small', type: 'button', id: 'sgp-new', onclick: newSong }, '+ New song')),
    listBox,
    h('div', { class: 'sg-pick-bar' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => s.close() }, 'Cancel'), addBtn));
  s = sheet('Add songs', body, { onClose: () => unsub() });
  unsub = subscribe(() => queueMicrotask(draw));
  draw();
  body.focus({ preventScroll: true });
}

/* ------------------------------ whole setlist ------------------------------ */
async function copySetlist(id) {
  const list = byId('setlists', id);
  if (!list) return;
  const text = setlistText(list);
  try { await navigator.clipboard.writeText(text); toast('Setlist copied: paste it into a message'); } catch {
    const ta = h('textarea', { class: 'sg-copy', rows: 14, readOnly: true, value: text, 'aria-label': 'The setlist as text' });
    sheet('Setlist as text', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'This device did not let the app copy. Select the text and copy it.'), ta));
    ta.focus(); ta.select();
  }
}

function duplicate(id, st, ctx) {
  const list = byId('setlists', id);
  if (!list) return;
  const copy = newSetlist({ name: `${list.name || 'Setlist'} (copy)`, actId: list.actId, gap: gapOf(list), notes: list.notes, items: (list.items || []).filter(Boolean).map(it => ({ ...it, id: uid() })) });
  ctx.close();
  openSetlist(copy.id, { target: st.target, bookingId: st.bookingId });
  toast(`Copy made: now editing “${copy.name}”`);
}

function deleteSetlist(id, ctx) {
  const list = byId('setlists', id);
  if (!list) return;
  const n = db.bookings.filter(b => b.setlistId === id).length;
  if (!confirm(`Delete the setlist “${list.name || 'Untitled'}”?${n ? ` It comes off ${plural(n, 'booking')} too.` : ''} Your songs stay in the library.`)) return;
  ctx.close();
  remove('setlists', id);
  toast('Setlist deleted');
}

/* --------------------------------- printing --------------------------------- */
// The stage copy: big bold titles with the key small beside them, set breaks as headings, sized so about fifteen songs
// fit on one page. opts.bookingId adds that show's date, venue and set time to the top line.
export function stageDoc(list, { bookingId = '' } = {}) {
  const p = setlistPlan(list), b = bookingId ? byId('bookings', bookingId) : null;
  const where = b ? [b.date && fmtShort(b.date), venueOf(b).name, b.setTime && 'on at ' + b.setTime].filter(Boolean).join(' · ') : '';
  const items = [];
  let encore = false;
  for (const r of p.rows) {
    if (r.kind === 'break') { items.push(h('li', { class: 'sg-stage-break' }, r.title)); encore = /encore/i.test(r.title); continue; }
    if (r.it.encore && !encore) { items.push(h('li', { class: 'sg-stage-break' }, 'ENCORE')); encore = true; }
    items.push(h('li', { class: 'sg-stage-song' },
      h('span', { class: 'sg-stage-n' }, String(r.n)),
      h('span', { class: 'sg-stage-t' }, r.title, r.it.segue && !r.last ? h('span', { class: 'sg-stage-seg' }, ' →') : null),
      r.key && h('span', { class: 'sg-stage-k' }, shortKey(r.key)),
      r.it.note && h('span', { class: 'sg-stage-note' }, r.it.note)));
  }
  // A line of title takes about 1.5 × the font size; the page has about 880px for the list.
  const lines = items.length + 0.45 * p.rows.filter(r => r.it.note).length + 1;
  const fs = Math.max(16, Math.min(46, Math.floor(880 / (lines * 1.5))));
  return h('div', { class: 'cs-doc sg-stage', style: `--sg-fs:${fs}px` },
    h('div', { class: 'sg-stage-head' }, h('b', null, list.name || 'Setlist'), h('span', null, [actName(list.actId), where].filter(Boolean).join(' · ')), h('span', null, `${plural(p.songs, 'song')} · ${fmtDur(p.sec)}`)),
    items.length ? h('ol', { class: 'sg-stage-list' }, items) : h('p', null, 'This setlist is empty.'));
}
export const STAGE_CSS = (pre = '') => [
  ['.sg-stage', 'color:#000'],
  ['.sg-stage-head', 'display:flex;flex-wrap:wrap;justify-content:space-between;gap:2px 16px;border-bottom:2px solid #000;padding-bottom:5px;margin-bottom:6px;font-size:12px;color:#333'],
  ['.sg-stage-head b', 'font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:#000'],
  ['.sg-stage-list', 'list-style:none;margin:0;padding:0'],
  ['.sg-stage-list li', 'font-size:var(--sg-fs);line-height:1.15;padding:calc(var(--sg-fs)*.17) 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .35em;break-inside:avoid;border-bottom:1px solid #ccc'],
  ['.sg-stage-n', 'font-size:.4em;font-weight:700;color:#666;min-width:1.8em;text-align:right;font-variant-numeric:tabular-nums'],
  ['.sg-stage-t', 'font-weight:800;flex:1;min-width:0;overflow-wrap:anywhere'],
  ['.sg-stage-seg', 'font-weight:400'],
  ['.sg-stage-k', 'font-size:.45em;font-weight:700;color:#222;white-space:nowrap'],
  ['.sg-stage-note', 'flex-basis:100%;font-size:.38em;font-style:italic;color:#444;padding-left:5.1em'],
  ['.sg-stage-list li.sg-stage-break', 'justify-content:center;font-size:calc(var(--sg-fs)*.5);font-weight:800;letter-spacing:.24em;border-top:3px solid #000;border-bottom:3px solid #000;margin:.25em 0;padding:.12em 0'],
].map(([sel, decl]) => `${pre}${sel}{${decl}}`).join('');

export function printSetlist(id, opts = {}) {
  const list = byId('setlists', id);
  if (!list) { toast('That setlist is not there any more.'); return; }
  printElement(stageDoc(list, opts || {}), STAGE_CSS('#print-root '));
}

/* --------------------------------- tutorials --------------------------------- */
sheetTutorial('Edit setlist', [
  { target: ['.sg-ed-fields'], title: 'Name, act, gap and slot', text: 'Rename the setlist or move it to another act. The gap is the seconds between songs (tuning, a breath, the count-in). The slot is the set length you have to fill: the totals say how far over or under you are.' },
  { target: ['.sg-stats'], title: 'Running time', text: 'The whole set with the gaps, the number of songs, and how it sits against the slot (or how many items have no length yet).' },
  { target: ['.sg-items .sg-handle', '.sg-ed-empty'], title: 'Reorder', text: 'Drag the ⠿ handle to move an item, or focus it and use the arrow keys (Home and End jump to the top or bottom). Tap it for the item’s note, its length in this set, segue, encore and remove.' },
  { target: ['.sg-items .sg-mv'], title: 'Up and down', text: 'Or move one place at a time with these buttons.' },
  { target: ['.sg-items .sg-start'], title: 'Running clock', text: 'When each item starts, counting from 0:00 with the gaps. Key changes and retunes between songs are marked, so you can plan the talk and the guitar swaps.' },
  { target: ['.sg-items .sg-seg'], title: 'Segue', text: 'Tap to go straight into the next item with no gap; the running time drops by the gap.' },
  { target: ['.sg-add'], title: 'Add', text: 'Songs from your library (several at once), set breaks such as SET 2 or ENCORE, and anything else that takes time: a drum solo, band intros, a word with the crowd.' },
  { target: ['.sg-ed-foot'], title: 'Print, copy, duplicate', text: 'Print the big stage copy, copy the list as text for the band chat, make a copy to change for another night, or delete it.' },
]);
const ITEM_STEPS = [
  { target: ['.sg-item-form'], title: 'This item', text: 'A song’s length in this set (empty: the song’s own), or a free item’s title and length; a note for the band; segue straight into the next item; mark it as an encore.' },
  { target: ['.sg-item-more'], title: 'Move or remove', text: 'Send it to the top or the bottom, open the song, or take it out of the setlist (the song stays in your library).' },
];
sheetTutorial('Setlist item', ITEM_STEPS);
sheetTutorial('Set break', ITEM_STEPS);
sheetTutorial('Add songs', [
  { target: ['.sg-pick .search'], title: 'Search', text: 'Find songs by title, key, tuning or act.' },
  { target: ['.sg-pick-row'], title: 'Tick songs', text: 'Tick as many as you like. They go in, at the end, in the order you ticked them (the numbers show it). The setlist’s act comes first.' },
  { target: ['#sgp-new'], title: 'A new song', text: 'Not in the library yet? Add it here and it is ticked, ready to go in.' },
  { target: ['#sgp-add'], title: 'Add', text: 'Adds the ticked songs to the setlist.' },
]);

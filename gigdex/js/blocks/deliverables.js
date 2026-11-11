// Deliverables box (studio sessions): what the session owes the artist (rough mixes, final mixes, masters, stems…), each
// with a due date and a done tick. Quick presets add the usual ones in a tap. Due dates are coloured: overdue, today,
// soon. When every deliverable is done the session checklist's "Mixes and stems delivered" line ticks itself.
import { h, uid, toast, fmtShort, parseISO, daysUntil } from '../util.js';
import { byId, update } from '../store.js';
import { markCheck, isChecked } from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';

export const PRESETS = ['Rough mix', 'Final mix', 'Master', 'Stems', 'Instrumental', 'A cappella', 'TV mix', 'Clean edit', 'Alt mix'];
const CHECK = 'ses-deliver';
const drafts = new Map(); // booking id -> { t, due } typed into the add row, so a redraw does not wipe it
const listOf = b => (Array.isArray(b && b.deliverables) ? b.deliverables.filter(x => x && x.id) : []);
const allDone = b => { const l = listOf(b); return l.length > 0 && l.every(x => x.done); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const weekday = iso => parseISO(iso).toLocaleDateString(undefined, { weekday: 'short' });

// How a due date reads, and its tone: overdue, today, soon (within three days) or later.
export function dueInfo(d) {
  if (!d || d.done || !isDate(d.due)) return { tone: '', text: '' };
  const n = daysUntil(d.due);
  if (n < 0) return { tone: 'overdue', text: `Overdue · was due ${fmtShort(d.due)}` };
  if (n === 0) return { tone: 'today', text: 'Due today' };
  if (n === 1) return { tone: 'soon', text: 'Due tomorrow' };
  if (n <= 3) return { tone: 'soon', text: `Due ${weekday(d.due)}` };
  return { tone: '', text: `Due ${fmtShort(d.due)}` };
}
const nextWord = iso => { const n = daysUntil(iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 && n < 7 ? weekday(iso) : fmtShort(iso); };

// Change the list, then keep the checklist line in step: ticked when the last one is done, unticked again when that
// stops being true (a new deliverable, or one unticked).
function change(bookingId, fn) {
  const before = allDone(byId('bookings', bookingId));
  update(d => { const x = d.bookings.find(r => r.id === bookingId); if (!x) return; x.deliverables = listOf(x).map(y => ({ ...y })); fn(x); x.updatedAt = Date.now(); });
  const after = byId('bookings', bookingId);
  if (!after) return;
  if (allDone(after) && !before) { if (!isChecked(after, CHECK)) { markCheck(bookingId, CHECK, true); toast('All delivered: “Mixes and stems delivered” is ticked.'); } }
  else if (!allDone(after) && before) markCheck(bookingId, CHECK, false);
}
function add(b, t, due) {
  const text = String(t || '').trim(); if (!text) return false;
  change(b.id, x => { x.deliverables.push({ id: uid(), t: text, due: isDate(due) ? due : '', done: false }); });
  return true;
}
function edit(b, dl) {
  openForm({
    title: 'Edit deliverable',
    values: { t: dl.t || '', due: dl.due || '', done: dl.done ? 'yes' : 'no' },
    fields: [
      { key: 't', label: 'What', required: true, list: PRESETS },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'done', label: 'Delivered', type: 'select', options: [['no', 'Not yet'], ['yes', 'Yes, delivered']] },
    ],
    onSave: v => change(b.id, x => { const y = x.deliverables.find(z => z.id === dl.id); if (y) Object.assign(y, { t: v.t || y.t, due: isDate(v.due) ? v.due : '', done: v.done === 'yes' }); }),
    onDelete: () => { change(b.id, x => { x.deliverables = x.deliverables.filter(z => z.id !== dl.id); }); toast('Deliverable deleted'); },
  });
}

function row(b, dl) {
  const info = dueInfo(dl);
  return h('div', { class: 'check-item sd-dl' + (dl.done ? ' done' : '') + (info.tone ? ' ' + info.tone : ''), 'data-id': dl.id },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!dl.done, onchange: e => change(b.id, x => { const y = x.deliverables.find(z => z.id === dl.id); if (y) y.done = e.target.checked; }) }), h('span', null, dl.t || 'Untitled')),
    info.text && h('span', { class: 'sd-due ' + info.tone }, info.text),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${dl.t || 'deliverable'}`, onclick: () => edit(b, dl) }, '✎'));
}

export default {
  id: 'deliverables', title: 'Deliverables', icon: '📦', order: 55,
  kinds: ['session'],
  summary(b) {
    const l = listOf(b); if (!l.length) return '';
    const done = l.filter(x => x.done).length;
    if (done === l.length) return `All ${l.length} done`;
    const open = l.filter(x => !x.done && isDate(x.due)).sort((x, y) => x.due.localeCompare(y.due));
    const late = open.filter(x => daysUntil(x.due) < 0).length;
    return `${done} of ${l.length} done` + (late ? ` · ${late} overdue` : open.length ? ` · next due ${nextWord(open[0].due)}` : '');
  },
  render(b) {
    const l = listOf(b);
    const order = [...l].sort((x, y) => (x.done - y.done) || (isDate(x.due) ? 0 : 1) - (isDate(y.due) ? 0 : 1) || String(x.due || '').localeCompare(String(y.due || '')));
    const done = l.filter(x => x.done).length;
    const draft = drafts.get(b.id) || { t: '', due: '' };
    const keep = () => drafts.set(b.id, { t: text.value, due: due.value });
    const text = h('input', { type: 'text', id: `sd-dl-text-${b.id}`, placeholder: 'Add a deliverable…', 'aria-label': 'New deliverable', autocomplete: 'off', value: draft.t, oninput: () => keep() });
    const due = h('input', { type: 'date', id: `sd-dl-due-${b.id}`, 'aria-label': 'Due date for the new deliverable', value: draft.due, onchange: () => keep() });
    const songs = (b.songIds || []).map(id => byId('songs', id)).filter(Boolean);
    const named = p => (songs.length === 1 ? `${p} – ${songs[0].title}` : p);
    const addTyped = () => { const t = text.value, d = due.value; drafts.delete(b.id); if (add(b, t, d)) { setTimeout(() => document.getElementById(`sd-dl-text-${b.id}`)?.focus({ preventScroll: true }), 0); } else { keep(); text.focus(); } };
    text.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } });
    return h('div', { class: 'sd-deliver' },
      l.length > 0 && h('div', { class: 'sd-dl-progress' },
        h('div', { class: 'card-row' }, h('span', { class: 'small' }, `${done} of ${l.length} done`), allDone(b) && h('span', { class: 'pill st-confirmed' }, '✓ All delivered')),
        h('div', { class: 'progress', role: 'img', 'aria-label': `${done} of ${l.length} delivered` }, h('i', { style: `width:${(done / l.length) * 100}%` }))),
      l.length
        ? h('div', { class: 'checklist sd-dl-list' }, order.map(dl => row(b, dl)))
        : h('p', { class: 'muted small' }, 'What this session owes the artist: rough mixes, final mixes, masters, stems. Add a due date and it turns red when it is late.'),
      h('div', { class: 'sd-dl-add' }, text, due, h('button', { type: 'button', class: 'btn ghost small', id: `sd-dl-add-${b.id}`, onclick: addTyped }, 'Add')),
      h('div', { class: 'sd-presets', role: 'group', 'aria-label': 'Quick add' },
        h('span', { class: 'muted small' }, 'Quick add:'),
        PRESETS.map(p => h('button', { type: 'button', class: 'chip', 'aria-label': `Add ${named(p)}`, onclick: () => { if (add(b, named(p), due.value)) toast(`Added ${named(p)}`); } }, p))));
  },
  tutorial: [
    { title: 'Deliverables', text: 'What the session owes: tick each one when it is sent. Late ones turn red, ones due soon are highlighted. When all are done, the checklist line “Mixes and stems delivered” ticks itself.', target: ['#blk-deliverables .sd-deliver', '.sd-deliver'] },
    { title: 'Quick add', text: 'Pick a due date first if you like, then tap a preset to add it. ✎ edits or deletes one.', target: ['#blk-deliverables .sd-presets', '.sd-presets'] },
  ],
};

sheetTutorial('Edit deliverable', [
  { title: 'Edit it', text: 'Change what it is, when it is due, or mark it delivered. Delete removes it.', target: ['.sheet .form'] },
]);

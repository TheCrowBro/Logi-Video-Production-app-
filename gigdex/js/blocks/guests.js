// Guest list: names with their +1s and a note, the cap the promoter allows, and a tick at the door on the night. Counts
// names, heads (with the +1s) and who is in; warns when the list is over the cap. Copy it as text for the promoter or
// print the door list.
import { h, toast, uid } from '../util.js';
import { byId } from '../store.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { bookingTitle } from '../model.js';
import { num, saveBooking, copyText, plural, docHead, docFoot, printDoc, textDate, refocus } from '../show-common.js';

const EDIT_TITLE = 'Guest';
const listOf = b => (Array.isArray(b && b.guestList) ? b.guestList.filter(g => g && typeof g === 'object' && g.id) : []);
const plusOf = g => Math.max(0, Math.round(num(g && g.plus)));
const capOf = b => Math.max(0, Math.round(num(b && b.guestCap)));
const nameOf = g => String((g && g.name) || '').trim() || 'No name';
const sorted = list => [...list].sort((a, z) => nameOf(a).localeCompare(nameOf(z), undefined, { sensitivity: 'base' }));
const fresh = b => byId('bookings', b.id) || b;
const finds = {}; // booking id → what is typed in the Find box, kept across redraws

// { names, heads (with +1s), in (heads ticked in), cap (0 = none), over (heads past the cap) }
export function guestCounts(b) {
  const list = listOf(b), cap = capOf(b);
  const heads = list.reduce((t, g) => t + 1 + plusOf(g), 0);
  const inside = list.filter(g => g.in).reduce((t, g) => t + 1 + plusOf(g), 0);
  return { names: list.length, heads, in: inside, cap, over: cap ? Math.max(0, heads - cap) : 0 };
}

function addGuest(b, name, plus, note) {
  const n = String(name || '').trim();
  if (!n) { toast('Type a name first'); refocus('sh-g-name'); return; }
  if (listOf(fresh(b)).some(g => nameOf(g).toLowerCase() === n.toLowerCase())) { toast(`${n} is already on the list`); refocus('sh-g-name'); return; }
  const p = Math.min(20, Math.max(0, Math.round(num(plus))));
  if (!saveBooking(b.id, x => { x.guestList = [...listOf(x), { id: uid(), name: n, plus: p, note: String(note || '').trim(), in: false }]; })) return;
  const c = guestCounts(fresh(b));
  toast(c.over ? `${n} added: the list is ${c.over} over the cap` : `${n} added`);
  refocus('sh-g-name');
}
const setIn = (b, id, on) => saveBooking(b.id, x => { x.guestList = listOf(x).map(g => (g.id === id ? { ...g, in: !!on } : g)); });
function removeGuest(b, g) {
  if (!confirm(`Take ${nameOf(g)} off the guest list?`)) return;
  if (saveBooking(b.id, x => { x.guestList = listOf(x).filter(r => r.id !== g.id); })) toast(`${nameOf(g)} taken off the list`);
}
function editGuest(b, g) {
  openForm({
    title: EDIT_TITLE, saveLabel: 'Save guest',
    values: { name: g.name || '', plus: plusOf(g), note: g.note || '', in: g.in ? ['in'] : [] },
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'plus', label: 'Plus ones', type: 'number', min: 0, step: 1, hint: '0 for just them, 1 for a +1…' },
      { key: 'note', label: 'Note', placeholder: 'Press, agent, family, photo pass…' },
      { key: 'in', label: 'At the door', type: 'checks', options: [{ value: 'in', label: 'In tonight' }] },
    ],
    onSave: v => {
      const name = String(v.name || '').trim(); if (!name) return toast('A guest needs a name');
      if (listOf(fresh(b)).some(r => r.id !== g.id && nameOf(r).toLowerCase() === name.toLowerCase())) toast(`Note: ${name} is on the list twice`);
      const ok = saveBooking(b.id, x => {
        if (!listOf(x).some(r => r.id === g.id)) return;
        x.guestList = listOf(x).map(r => (r.id === g.id ? { ...r, name, plus: Math.min(20, Math.max(0, Math.round(num(v.plus)))), note: String(v.note || '').trim(), in: (v.in || []).includes('in') } : r));
      });
      if (ok) toast('Guest saved');
    },
    onDelete: () => { if (saveBooking(b.id, x => { x.guestList = listOf(x).filter(r => r.id !== g.id); })) toast(`${nameOf(g)} taken off the list`); },
  });
}

export function guestText(b) {
  const list = sorted(listOf(b)), c = guestCounts(b);
  const head = ['Guest list', bookingTitle(b), textDate(b.date)].filter(Boolean).join(' · ');
  return [head, '', ...list.map(g => `${nameOf(g)}${plusOf(g) ? ' +' + plusOf(g) : ''}${g.note ? ' (' + g.note + ')' : ''}`), '',
    `${plural(c.names, 'name')} · ${plural(c.heads, 'head')}${c.cap ? ` · cap ${c.cap}` : ''}`].join('\n');
}

// The door list to print: big rows, a box to tick, sorted by name.
export function doorList(b) {
  const list = sorted(listOf(b)), c = guestCounts(b);
  return h('div', { class: 'cs-doc sh-door' }, ...docHead(b, 'GUEST LIST'),
    b.doors && h('div', { class: 'cs-sub' }, `Doors ${b.doors}`),
    h('div', { class: 'cs-sec' }, h('h4', null, `${plural(c.names, 'name')} · ${plural(c.heads, 'head')}${c.cap ? ` · cap ${c.cap}` : ''}`),
      list.length ? h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'In'), h('th', null, 'Name'), h('th', { class: 'num' }, '+'), h('th', null, 'Note'))),
        h('tbody', null, list.map(g => h('tr', null, h('td', { class: 'sh-box' }, g.in ? '☑' : '☐'), h('td', null, h('b', null, nameOf(g))), h('td', { class: 'num' }, plusOf(g) ? '+' + plusOf(g) : ''), h('td', null, g.note || '')))))
        : h('p', null, 'No guests on the list.')),
    docFoot());
}
const DOOR_CSS = '#print-root .sh-door td{font-size:14px;padding:9px 6px}#print-root .sh-door .sh-box{width:30px;font-size:18px}';

export default {
  id: 'guests', title: 'Guest list', icon: '🎟️', order: 45,
  kinds: ['show'],
  summary(b) {
    const c = guestCounts(b);
    if (!c.names && !c.cap) return '';
    const base = c.cap ? `${c.heads} of ${c.cap}` : plural(c.heads, 'guest');
    return (c.over ? '⚠ ' : '') + base + (c.in ? ` · ${c.in} in` : '');
  },
  render(b) {
    const list = listOf(b), c = guestCounts(b), q = (finds[b.id] || '').trim().toLowerCase();
    const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
    const name = h('input', { id: 'sh-g-name', type: 'text', placeholder: 'Name', autocomplete: 'off', enterKeyHint: 'done' });
    const plus = h('input', { id: 'sh-g-plus', type: 'number', min: 0, max: 20, step: 1, inputMode: 'numeric', value: 0 });
    const note = h('input', { id: 'sh-g-note', type: 'text', placeholder: 'Press, family…', autocomplete: 'off' });
    const add = h('form', { class: 'sh-g-add', 'aria-label': 'Add a guest', novalidate: true, onsubmit: e => { e.preventDefault(); addGuest(b, name.value, plus.value, note.value); } },
      h('div', { class: 'sh-cell sh-k-name' }, h('label', { for: 'sh-g-name' }, 'Name'), name),
      h('div', { class: 'sh-cell sh-k-plus' }, h('label', { for: 'sh-g-plus' }, '+ ones'), plus),
      h('div', { class: 'sh-cell sh-k-note' }, h('label', { for: 'sh-g-note' }, 'Note'), note),
      h('button', { type: 'submit', class: 'btn primary sh-g-addbtn', id: 'sh-g-add' }, '+ Add'));
    const rowsBox = h('ul', { class: 'sh-g-list', 'aria-label': 'Guests' });
    const drawRows = () => {
      const qq = (finds[b.id] || '').trim().toLowerCase();
      const shown = sorted(list).filter(g => !qq || nameOf(g).toLowerCase().includes(qq) || String(g.note || '').toLowerCase().includes(qq));
      rowsBox.replaceChildren(...(shown.length ? shown.map(g => h('li', { class: 'sh-g-row' + (g.in ? ' in' : '') },
        h('label', { class: 'check sh-g-in' }, h('input', { type: 'checkbox', checked: !!g.in, 'aria-label': `${nameOf(g)} is in`, onchange: e => setIn(b, g.id, e.target.checked) }), h('span', { class: 'sr-only' }, 'In')),
        h('div', { class: 'sh-g-who' },
          h('div', null, h('strong', { class: 'sh-g-name' }, nameOf(g)), plusOf(g) > 0 && h('span', { class: 'pill sh-g-plus' }, '+' + plusOf(g)), g.in && h('span', { class: 'sh-g-tick' }, ' in')),
          g.note && h('div', { class: 'small muted' }, g.note)),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${nameOf(g)}`, onclick: () => editGuest(b, g) }, '✎'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take ${nameOf(g)} off the list`, onclick: () => removeGuest(b, g) }, '✕')))
        : [h('li', { class: 'muted small sh-g-none' }, q ? `No one called “${finds[b.id].trim()}” on the list.` : '')]));
    };
    drawRows();
    const cap = h('input', { id: 'sh-g-cap', type: 'number', min: 0, step: 1, inputMode: 'numeric', placeholder: 'None', value: c.cap || '',
      onchange: e => { const v = e.target.value === '' ? '' : Math.max(0, Math.round(num(e.target.value))); if (saveBooking(b.id, x => { x.guestCap = v; })) toast(v ? `Cap set to ${v}` : 'No cap on the list'); } });
    return h('div', { class: 'sh-block sh-guests' },
      list.length > 0 && h('div', { class: 'stats sh-g-stats' }, stat(String(c.names), c.names === 1 ? 'name' : 'names'),
        stat(c.cap ? `${c.heads} / ${c.cap}` : String(c.heads), c.cap ? 'heads of the cap' : 'heads with +1s', c.over ? 'bad' : ''), stat(String(c.in), 'in tonight')),
      c.over > 0 && h('p', { class: 'warn' }, `${plural(c.heads, 'head')} on the list for ${c.cap} places: ${c.over} over the cap. Ask the promoter for more, or trim the list.`),
      h('div', { class: 'sh-g-capline' }, h('label', { for: 'sh-g-cap' }, 'Places the promoter allows'), cap),
      add,
      list.length >= 8 && h('input', { id: 'sh-g-find', type: 'search', class: 'search', placeholder: 'Find a name', 'aria-label': 'Find a guest', value: finds[b.id] || '', autocomplete: 'off',
        oninput: e => { finds[b.id] = e.target.value; drawRows(); } }),
      list.length ? rowsBox : h('p', { class: 'muted small' }, 'No guests yet. Add names and their +1s; tick them in at the door on the night.'),
      list.length > 0 && h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-g-copy', onclick: () => copyText(guestText(fresh(b)), 'Guest list copied') }, '📋 Copy as text'),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-g-print', onclick: () => printDoc(doorList(fresh(b)), DOOR_CSS) }, '🖨 Print door list'),
        c.in > 0 && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-g-reset', onclick: () => { if (confirm('Untick everyone at the door?') && saveBooking(b.id, x => { x.guestList = listOf(x).map(g => ({ ...g, in: false })); })) toast('Door ticks cleared'); } }, 'Clear door ticks')));
  },
  tutorial: [
    { title: 'Guest list', text: 'Names, their +1s and a note. The heads count includes the +1s, against the places the promoter allows.', target: ['#blk-guests .sh-g-stats', '#blk-guests'] },
    { title: 'Add a guest', text: 'Type the name, the number of +1s and a note, then Add. Enter works too.', target: ['#blk-guests .sh-g-add'] },
    { title: 'At the door', text: 'Tick each guest in as they arrive. Print the door list for the venue, or copy it into a message to the promoter.', target: ['#blk-guests .sh-g-list'] },
  ],
};

sheetTutorial(EDIT_TITLE, [
  { title: 'Plus ones', text: 'How many come with this guest. They count against the cap.', target: ['[data-key=plus]'] },
  { title: 'At the door', text: 'Tick when they are in. Delete takes them off the list.', target: ['.sheet .checks'] },
]);

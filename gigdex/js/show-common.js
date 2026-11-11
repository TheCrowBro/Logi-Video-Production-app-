// Shared by the show blocks (js/blocks/deal.js, running.js, guests.js, settlement.js): writing to a booking, reading
// typed numbers, a sheet that edits a list of rows with a label over every box, copying text, and the head and foot
// of a printed document. Nothing here is a block of its own.
import { h, sheet, toast, uid, fmtLong } from './util.js';
import { db, byId, update } from './store.js';
import { bookingTitle, actName, venueOf, fmtMoney, currency } from './model.js';
import { printElement, docPage, saveFile, fileName } from './print.js';

// A typed number: 0 for blank or nonsense. numOrBlank keeps a blank box blank ('' is "not known yet").
export const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
export const numOrBlank = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// model.fmtMoney, rounded to the cent first: a split such as (3000 − 300) × 0.7 is 1889.9999… in floating point and
// would read "$1,890.00" instead of "$1,890".
export const money = (n, sym = currency()) => fmtMoney(Math.round(num(n) * 100) / 100, sym);

// Change a booking. Says so and changes nothing when the booking was deleted meanwhile (another tab, a sync).
export function saveBooking(id, fn) {
  if (!byId('bookings', id)) { toast('This show was deleted, so the change was not saved.'); return false; }
  update(d => { const x = d.bookings.find(r => r.id === id); if (!x) return; fn(x); x.updatedAt = Date.now(); });
  return true;
}

// Puts the focus back on a control after the page redraws (the redraw runs in a microtask after a change).
export const refocus = id => setTimeout(() => { const el = document.getElementById(id); if (el) el.focus({ preventScroll: true }); }, 30);

/*
 A sheet that edits rows, each a small card with a label over every box (a line of merch counts, a slot in the running
 order). columns: [{ key, label, type: 'text'|'number'|'time'|'check', wide, placeholder, min, step, inputMode }].
 derive(row) → a short line under the row, worked out as you type (an end time, what sold). onSave(rows) gets the rows
 that have something in them, numbers as numbers ('' when blank), each with an id.
*/
export function rowsSheet({ title, intro, columns, rows, blank = () => ({}), addLabel = '+ Add a line', saveLabel = 'Save', derive, onSave, cls = '', emptyText = 'Nothing here yet.' }) {
  const state = (rows || []).map(r => ({ ...r }));
  const list = h('div', { class: 'sh-rows ' + cls });
  let dirty = false;
  const cellId = (ri, key) => `sh-r-${ri}-${key}`;
  const draw = focus => {
    list.replaceChildren(...(state.length ? state.map((r, ri) => {
      const note = h('div', { class: 'sh-row-note small muted', 'aria-live': 'polite' }, derive ? derive(r) : '');
      const cells = columns.map(c => {
        const id = cellId(ri, c.key);
        if (c.type === 'check') {
          return h('label', { class: 'sh-cell sh-cell-check check sh-k-' + c.key, for: id },
            h('input', { id, type: 'checkbox', checked: !!r[c.key], onchange: e => { r[c.key] = e.target.checked; dirty = true; if (derive) note.textContent = derive(r); } }),
            h('span', null, c.label));
        }
        return h('div', { class: 'sh-cell sh-k-' + c.key + (c.wide ? ' wide' : '') },
          h('label', { for: id }, c.label),
          h('input', {
            id, type: c.type === 'number' ? 'number' : c.type || 'text', value: r[c.key] ?? '', placeholder: c.placeholder || '', autocomplete: 'off',
            min: c.type === 'number' ? (c.min ?? 0) : null, step: c.type === 'number' ? (c.step ?? 'any') : null,
            inputMode: c.inputMode || (c.type === 'number' ? 'decimal' : null),
            oninput: e => { r[c.key] = e.target.value; dirty = true; if (derive) note.textContent = derive(r); },
          }));
      });
      const name = String(r[(columns.find(c => c.type !== 'check' && c.type !== 'number' && c.type !== 'time') || columns[0]).key] || '').trim();
      return h('div', { class: 'sh-row' },
        h('div', { class: 'sh-cells' }, cells),
        h('button', { type: 'button', class: 'icon-btn sh-row-del', 'aria-label': `Remove ${name || 'this line'}`, onclick: () => { state.splice(ri, 1); dirty = true; draw(Math.min(ri, state.length - 1)); } }, '✕'),
        derive && note);
    }) : [h('p', { class: 'muted small sh-rows-empty' }, emptyText)]));
    if (focus != null && focus >= 0 && state[focus]) setTimeout(() => list.querySelector(`#${cellId(focus, columns[0].key)}`)?.focus(), 0);
    else if (focus === -1) setTimeout(() => add.focus(), 0);
  };
  const add = h('button', { type: 'button', class: 'btn ghost small', onclick: () => { state.push({ ...blank() }); dirty = true; draw(state.length - 1); } }, addLabel);
  draw();
  const clean = () => state.filter(r => columns.some(c => (c.type === 'check' ? false : String(r[c.key] ?? '').trim() !== ''))).map(r => {
    const out = { ...r, id: r.id || uid() };
    for (const c of columns) {
      if (c.type === 'number') out[c.key] = numOrBlank(String(r[c.key] ?? '').trim());
      else if (c.type === 'check') out[c.key] = !!r[c.key];
      else out[c.key] = String(r[c.key] ?? '').trim();
    }
    return out;
  });
  const form = h('form', { class: 'sh-rows-form', novalidate: true, onsubmit: e => { e.preventDefault(); close(); onSave(clean()); } },
    intro && h('p', { class: 'muted small' }, intro), list, h('div', { class: 'actions' }, add),
    h('div', { class: 'form-actions' }, h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (!dirty || confirm('Close without saving your changes?')) close(); } }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, saveLabel)));
  const { close } = sheet(title, form, { dismissOnBackdrop: false });
  setTimeout(() => { if (!form.contains(document.activeElement)) (form.querySelector('.sh-row input') || add).focus(); }, 50);
  return { close };
}

// Copies text, or shows it in a sheet to copy by hand where the clipboard is not allowed.
export async function copyText(text, done = 'Copied') {
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    const area = h('textarea', { class: 'sh-copy-area', rows: 12, readOnly: true, 'aria-label': 'Text to copy', value: text });
    sheet('Copy this text', h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'Copying isn’t allowed here. Select the text below and copy it.'), area));
    setTimeout(() => { area.focus(); area.select(); }, 60);
  }
}

// The top of a printed show document (settlement, door list): who it is from, what it is, when and where.
export function docHead(b, kicker) {
  const p = db.profile || {}, v = venueOf(b);
  return [
    h('div', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, p.business || p.name || actName(b.actId) || 'Gdex'), h('div', { class: 'cs-kicker' }, kicker)),
      h('div', { class: 'cs-when' }, b.date && h('b', null, fmtLong(b.date)), [v.name, v.address].filter(Boolean).join(', '))),
    h('h2', null, bookingTitle(b)),
  ];
}
export const docFoot = () => h('div', { class: 'cs-foot' }, `Made with Gdex · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`);

// Print a document, or save it as a web page to send.
export const printDoc = (el, css = '') => printElement(el, css);
export async function saveDoc(title, el, css = '') {
  const ok = await saveFile(docPage(title, el, css), fileName(title, 'html'), 'text/html');
  if (ok) toast('Saved');
}

// A short date line for text copies: "Sat 16 Nov".
export const textDate = iso => (iso ? new Date(iso + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');

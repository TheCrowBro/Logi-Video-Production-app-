// Schema-driven edit form shown in a sheet.
import { h, sheet, groupBy } from './util.js';

/*
 fields: [{ key, label, type, options, required, placeholder, list, rows, columns, empty, hint }]
 types: text tel email url number date time textarea select checks rows
*/
export function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Save' }) {
  const readers = [];
  const boxesByKey = {};
  const form = h('form', { class: 'form', novalidate: false });

  fields.forEach((f, i) => {
    const id = `f-${i}-${f.key}`;
    const val = values[f.key];
    let control;

    if (f.type === 'textarea') {
      control = h('textarea', { id, rows: f.rows || 3, placeholder: f.placeholder || '', value: val ?? '' });
      readers.push(() => [f.key, control.value.trim()]);
    } else if (f.type === 'select') {
      control = h('select', { id }, f.options.map(o => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: v === (val ?? f.options[0]) }, l);
      }));
      readers.push(() => [f.key, control.value]);
    } else if (f.type === 'checks') {
      const opts = f.options || [];
      const checked = new Set(val || []);
      const boxes = [];
      if (!opts.length) control = h('p', { class: 'muted' }, f.empty || 'Nothing to pick yet.');
      else {
        const groups = groupBy(opts, o => o.group || '');
        control = h('div', { class: 'checks' }, [...groups].map(([g, items]) => h('fieldset', null,
          g && h('legend', null, g),
          items.map(o => {
            const cb = h('input', { type: 'checkbox', checked: checked.has(o.value) });
            boxes.push([o.value, cb]);
            if (o.adds) cb.addEventListener('change', () => { if (cb.checked) for (const [k, vals] of Object.entries(o.adds)) vals.forEach(v => boxesByKey[k]?.get(v) && (boxesByKey[k].get(v).checked = true)); });
            return h('label', { class: 'check' }, cb, h('span', null, o.label, o.hint && h('em', null, ' ' + o.hint)));
          }))));
      }
      boxesByKey[f.key] = new Map(boxes);
      readers.push(() => [f.key, boxes.filter(([, cb]) => cb.checked).map(([v]) => v)]);
    } else if (f.type === 'rows') {
      const rows = (val || []).map(r => ({ ...r }));
      const list = h('div', { class: 'rows' });
      const draw = () => {
        list.replaceChildren(...rows.map((r, ri) => h('div', { class: 'row-edit' },
          f.columns.map(c => h('input', {
            type: c.type || 'text', placeholder: c.label, 'aria-label': c.label, value: r[c.key] ?? '',
            oninput: e => { r[c.key] = e.target.value; },
          })),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => { rows.splice(ri, 1); draw(); } }, '✕'))));
      };
      draw();
      control = h('div', null, list, h('button', { type: 'button', class: 'btn ghost small', onclick: () => { rows.push({}); draw(); } }, '+ Add'));
      readers.push(() => [f.key, rows.filter(r => Object.values(r).some(v => String(v || '').trim()))]);
    } else {
      let listEl;
      if (f.list) listEl = h('datalist', { id: id + '-l' }, f.list.map(o => h('option', { value: o })));
      control = h('input', {
        id, type: f.type === 'url' ? 'text' : (f.type || 'text'), required: !!f.required, placeholder: f.placeholder || '',
        value: val ?? '', list: f.list ? id + '-l' : null, step: f.type === 'number' ? 'any' : null,
        inputMode: f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : null, autocomplete: 'off',
      });
      readers.push(() => [f.key, f.type === 'number' ? (control.value === '' ? '' : Number(control.value)) : control.value.trim()]);
      if (listEl) control = h('div', null, control, listEl);
    }

    form.append(h('div', { class: 'field' + (f.type === 'checks' || f.type === 'rows' ? ' wide' : '') },
      h('label', { for: id }, f.label, f.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), control, f.hint && h('small', { class: 'muted' }, f.hint)));
  });

  const { close } = sheet(title, form, { dismissOnBackdrop: false });
  const actions = h('div', { class: 'form-actions' },
    onDelete && h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('Delete this permanently?')) { close(); onDelete(); } } }, 'Delete'),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'),
    h('button', { type: 'submit', class: 'btn primary' }, saveLabel));
  form.append(actions);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const out = { ...values };
    readers.forEach(r => { const [k, v] = r(); out[k] = v; });
    close();
    onSave(out);
  });
  setTimeout(() => form.querySelector('input,textarea,select')?.focus(), 50);
}

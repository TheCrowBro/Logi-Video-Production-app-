// Schema-driven edit form shown in a sheet.
import { h, sheet, groupBy, toast } from './util.js';
import { parseMapLink, geocode } from './map.js';

/*
 fields: [{ key, label, type, options, required, placeholder, list, rows, columns, empty, hint }]
 types: text tel email url number date time textarea select checks rows
*/
export function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Save' }) {
  const readers = [];
  const boxesByKey = {};
  const qtyByKey = {};
  const form = h('form', { class: 'form', novalidate: false });

  fields.forEach((f, i) => {
    const id = `f-${i}-${f.key}`;
    const val = values[f.key];
    let control;

    if (f.type === 'textarea') {
      control = h('textarea', { id, 'data-key': f.key, rows: f.rows || 3, placeholder: f.placeholder || '', value: val ?? '' });
      readers.push(() => [f.key, control.value.trim()]);
    } else if (f.type === 'matrix') {
      // Per-item permission picker: not set / allowed / needs approval / not allowed.
      const cur = { ...(val || {}) };
      const sels = f.items.map(([k, label]) => {
        const sel = h('select', { id: `${id}-${k}`, 'aria-label': label }, [['', 'Not set'], ['allowed', '✓ Allowed'], ['ask', '? Needs approval'], ['no', '✕ Not allowed']].map(([v, l]) => h('option', { value: v, selected: (cur[k] || '') === v }, l)));
        return [k, sel, h('div', { class: 'matrix-row' }, h('label', { for: sel.id }, label), sel)];
      });
      control = h('div', { class: 'matrix' }, sels.map(s => s[2]));
      readers.push(() => [f.key, Object.fromEntries(sels.map(([k, sel]) => [k, sel.value]).filter(([, v]) => v))]);
    } else if (f.type === 'place') {
      // Map location: coordinates, paste a map link, look up from the address, or use the phone's GPS.
      const g = val || {};
      const lat = h('input', { id: id + '-lat', type: 'number', step: 'any', min: -90, max: 90, placeholder: 'Latitude', 'aria-label': 'Latitude', value: g.lat ?? '' });
      const lon = h('input', { id: id + '-lon', type: 'number', step: 'any', min: -180, max: 180, placeholder: 'Longitude', 'aria-label': 'Longitude', value: g.lon ?? '' });
      const set = p => { lat.value = p.lat; lon.value = p.lon; };
      const link = h('input', { type: 'text', inputMode: 'url', placeholder: 'Paste a Google / Apple / OpenStreetMap link', 'aria-label': 'Map link to read coordinates from', autocomplete: 'off',
        onchange: () => { const p = parseMapLink(link.value); if (p) { set(p); toast('Location read from link'); } else if (link.value.trim()) toast('No coordinates found in that link. Short links (maps.app.goo.gl) need opening first.'); } });
      const addr = () => form.querySelector('[data-key=address]');
      control = h('div', { class: 'place' },
        h('div', { class: 'row-edit' }, lat, lon),
        link,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: async e => {
            const a = addr()?.value.trim(); if (!a) return toast('Enter the address first');
            e.target.disabled = true;
            try { set(await geocode(a)); toast('Location found'); } catch (err) { toast(err.message || 'Lookup failed. Are you online?'); }
            e.target.disabled = false;
          } }, '🔎 Find from address'),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => {
            if (!navigator.geolocation) return toast('Location is not available here');
            navigator.geolocation.getCurrentPosition(p => { set({ lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6) }); toast('Using your current location'); }, () => toast('Could not get your location'), { timeout: 10000 });
          } }, '📡 I’m here now')));
      readers.push(() => [f.key, lat.value !== '' && lon.value !== '' ? { lat: Number(lat.value), lon: Number(lon.value) } : null]);
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
            let stepper = null;
            if (f.qtyKey && o.qtyMax > 1) {
              const start = Math.min(o.qtyMax, Math.max(1, Math.floor(Number((values[f.qtyKey] || {})[o.value])) || 1));
              const input = h('input', { type: 'number', min: 1, max: o.qtyMax, value: start, inputMode: 'numeric', 'aria-label': `Quantity of ${o.label} (you own ${o.qtyMax})` });
              const clamp = n => { input.value = Math.min(o.qtyMax, Math.max(1, Math.floor(n) || 1)); };
              input.addEventListener('change', () => { clamp(Number(input.value)); if (Number(input.value) > 1) cb.checked = true; });
              stepper = h('div', { class: 'stepper' },
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': `One fewer ${o.label}`, onclick: () => clamp(Number(input.value) - 1) }, '−'),
                input,
                h('button', { type: 'button', class: 'icon-btn', 'aria-label': `One more ${o.label}`, onclick: () => { clamp(Number(input.value) + 1); cb.checked = true; } }, '+'));
              (qtyByKey[f.key] ||= new Map()).set(o.value, { input, clamp });
            }
            if (o.adds) cb.addEventListener('change', () => {
              if (!cb.checked) return;
              for (const [k, vals] of Object.entries(o.adds)) vals.forEach(v => boxesByKey[k]?.get(v) && (boxesByKey[k].get(v).checked = true));
              for (const [id, n] of Object.entries(o.addsQty || {})) { const q = qtyByKey.gear?.get(id); if (q) q.clamp(Math.max(Number(q.input.value), n)); }
            });
            const label = h('label', { class: 'check' }, cb, h('span', null, o.label, o.hint && h('em', null, ' ' + o.hint)));
            return stepper ? h('div', { class: 'check-row' }, label, stepper) : label;
          }))));
      }
      boxesByKey[f.key] = new Map(boxes);
      readers.push(() => [f.key, boxes.filter(([, cb]) => cb.checked).map(([v]) => v)]);
      if (f.qtyKey) readers.push(() => [f.qtyKey, Object.fromEntries(boxes.filter(([v, cb]) => cb.checked && qtyByKey[f.key]?.get(v) && Number(qtyByKey[f.key].get(v).input.value) > 1).map(([v]) => [v, Number(qtyByKey[f.key].get(v).input.value)]))]);
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
      const input = control = h('input', {
        'data-key': f.key, id, type: f.type === 'url' ? 'text' : (f.type || 'text'), required: !!f.required, placeholder: f.placeholder || '',
        value: val ?? '', list: f.list ? id + '-l' : null, step: f.type === 'number' ? (f.min != null ? 1 : 'any') : null, min: f.min ?? null,
        inputMode: f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : null, autocomplete: 'off',
      });
      readers.push(() => [f.key, f.type === 'number' ? (input.value === '' ? '' : Number(input.value)) : input.value.trim()]);
      if (listEl) control = h('div', null, control, listEl);
    }

    form.append(h('div', { class: 'field' + (['checks', 'rows', 'matrix', 'place'].includes(f.type) ? ' wide' : '') },
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

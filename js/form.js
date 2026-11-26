// Schema-driven edit form shown in a sheet.
import { h, sheet, groupBy, toast } from './util.js';
import { parseMapLink, geocode } from './map.js';
import { canChange } from './store.js';

/*
 fields: [{ key, label, type, options, required, placeholder, list, rows, columns, empty, hint, missing }]
 types: text tel email url number date time textarea select checks rows matrix place role
 validate(values): { key, message } for a box that cannot be saved as it is (the form stays open, the message on that
 box), or nothing. A select whose stored value is no longer among its options keeps it (named by `missing`).
*/
export function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Save', validate = null }) {
  const readers = [];
  const checks = []; // each answers [box, message] for something the form cannot save as it stands, or nothing
  const saved = []; // run after a save went through
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
      // One of the two alone is no place: said, instead of saving the form without what was typed.
      checks.push(() => ((lat.value === '') !== (lon.value === '') ? [lat.value === '' ? lat : lon, 'Enter both the latitude and the longitude, or neither'] : null));
    } else if (f.type === 'role') {
      // A crew role: a button that shows the role and opens the menu of roles by department (js/role-picker.js, loaded
      // on first use). A role the person typed themselves is kept under My roles once the form is saved.
      let role = String(val ?? '').trim(), picker = null;
      const text = h('span', { class: 'role-pick-text' });
      const show = () => { text.textContent = role || f.placeholder || 'Choose a role'; control.classList.toggle('unset', !role); control.setAttribute('aria-label', `${f.label}: ${role || 'none chosen'}`); };
      control = h('button', { type: 'button', id, class: 'role-pick', 'data-key': f.key, 'aria-haspopup': 'dialog', onclick: () => {
        control.focus(); // Safari leaves a clicked button unfocused, and the menu gives the focus back to its opener
        import('./role-picker.js').then(m => { picker = m; m.pickRole({ current: role, onPick: r => { role = r; show(); } }); }).catch(e => toast('Could not open the roles: ' + (e.message || e)));
      } }, text, h('span', { class: 'role-pick-arrow', 'aria-hidden': 'true' }, '▾'));
      show();
      readers.push(() => [f.key, role]);
      saved.push(() => { if (picker && role) picker.rememberRole(role); });
    } else if (f.type === 'select') {
      // A stored value that is no longer on the list (a template since deleted, an older category) stays chosen: a
      // select without it would show its first option, and saving anything else on the form would save that too.
      const known = f.options.some(o => (Array.isArray(o) ? o[0] : o) === val);
      const options = known || val == null || val === '' ? f.options : [...f.options, [val, f.missing || String(val)]];
      control = h('select', { id, 'data-key': f.key }, options.map(o => {
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
            step: c.type === 'number' ? (c.step ?? 'any') : null, inputMode: c.type === 'number' ? 'decimal' : null, // prices like 0.76 or 12.50
            oninput: e => { r[c.key] = e.target.value; },
          })),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove row', onclick: () => { rows.splice(ri, 1); draw(); } }, '✕'))));
      };
      draw();
      control = h('div', null, list, h('button', { type: 'button', class: 'btn ghost small', onclick: () => { rows.push({}); draw(); } }, '+ Add'));
      // A row counts by the boxes shown: one emptied by hand goes, whatever it carries unseen (a saved line's id).
      readers.push(() => [f.key, rows.filter(r => f.columns.some(c => String(r[c.key] ?? '').trim()))]);
    } else {
      let listEl;
      if (f.list) listEl = h('datalist', { id: id + '-l' }, f.list.map(o => h('option', { value: o })));
      const input = control = h('input', {
        'data-key': f.key, id, type: f.type === 'url' ? 'text' : (f.type || 'text'), required: !!f.required, placeholder: f.placeholder || '',
        value: val ?? '', list: f.list ? id + '-l' : null, step: f.type === 'number' ? (f.step ?? (f.min != null ? 1 : 'any')) : null, min: f.min ?? null,
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
  // A box the form refuses says why, in the browser's own bubble, and the form stays open with what was typed. The
  // message goes as soon as anything in the form changes, so a second try is judged afresh.
  const refused = new Set();
  const refuse = (el, message) => { if (!el || !el.setCustomValidity) return; el.setCustomValidity(message); refused.add(el); el.reportValidity(); };
  const clearRefused = () => { refused.forEach(el => el.setCustomValidity('')); refused.clear(); };
  form.addEventListener('input', clearRefused); form.addEventListener('change', clearRefused);
  form.addEventListener('submit', e => {
    e.preventDefault();
    clearRefused();
    // Spaces alone are not an answer: the browser lets them through "required", and they would be saved as nothing.
    const blank = [...form.querySelectorAll('input[required], textarea[required]')].find(el => !el.value.trim());
    if (blank) return refuse(blank, 'Fill this in');
    for (const check of checks) { const no = check(); if (no) return refuse(no[0], no[1]); }
    const out = { ...values };
    readers.forEach(r => { const [k, v] = r(); out[k] = v; });
    const bad = validate && validate(out);
    if (bad) return refuse(form.querySelector(`[data-key="${bad.key}"]`), bad.message);
    if (!canChange()) return; // read-only (the desktop app after its trial): keep the form and what was typed
    close();
    onSave(out);
    saved.forEach(fn => fn());
  });
  setTimeout(() => { if (!form.contains(document.activeElement)) form.querySelector('input,textarea,select')?.focus(); }, 50); // never take the cursor from a box someone is already typing in
}

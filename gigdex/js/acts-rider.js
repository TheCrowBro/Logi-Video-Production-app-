// The tech rider's editors: the input list (a sheet of rows with presets), the stage plot (labels dragged on a stage,
// or moved with the arrow keys) and the two rider texts. Everything is written through the store; the Acts page draws
// the results (js/pages/acts.js), and js/acts-docs.js prints them.
import { h, nodes, sheet, toast, announce, uid } from './util.js';
import { byId, patch, update, redraw } from './store.js';
import { openForm } from './form.js';
import { sheetTutorial } from './tour.js';
import { membersOf, roleOf, plotOf, clamp01, dupChannels } from './acts-docs.js';

const gone = () => toast('That act is no longer in Acts.');
const act = id => byId('acts', id);

/* ------------------------------- input list ------------------------------- */
// Typical lists to start from: [source, mic / DI, stand, note].
export const PRESETS = [
  { id: 'rock4', name: 'Four-piece rock band', rows: [
    ['Kick', 'Beta 52 / D112', 'Short boom'], ['Snare', 'SM57', 'Short boom'], ['Hi-hat', 'Small condenser', 'Short boom'], ['Rack tom', 'e604', 'Clip'],
    ['Floor tom', 'e604', 'Clip'], ['Overhead L', 'Condenser', 'Tall boom'], ['Overhead R', 'Condenser', 'Tall boom'], ['Bass DI', 'DI', '', 'Post-amp DI out if they have one'],
    ['Bass amp', 'MD421 / Beta 52', 'Short boom', 'Optional'], ['Guitar 1 amp', 'SM57', 'Short boom'], ['Guitar 2 amp', 'SM57', 'Short boom'],
    ['Lead vocal', 'SM58', 'Tall boom'], ['Backing vocal (guitar 2)', 'SM58', 'Tall boom'], ['Backing vocal (bass)', 'SM58', 'Tall boom']] },
  { id: 'duo', name: 'Duo with tracks', rows: [
    ['Tracks L', 'DI', '', 'From the laptop / interface'], ['Tracks R', 'DI', '', 'From the laptop / interface'], ['Click', 'DI', '', 'In-ears only, not to FOH'],
    ['Guitar', 'DI', '', 'Modeller: stereo if channels allow'], ['Keys L', 'DI', ''], ['Keys R', 'DI', ''], ['Lead vocal', 'SM58', 'Tall boom'], ['Vocal 2', 'SM58', 'Tall boom']] },
  { id: 'solo', name: 'Solo acoustic', rows: [
    ['Acoustic guitar', 'DI', '', 'Own pickup'], ['Acoustic guitar mic', 'Small condenser', 'Short boom', 'Optional, as well as the DI'],
    ['Vocal', 'SM58', 'Tall boom'], ['Playback', 'Stereo DI', '', 'Phone or laptop: walk-in music']] },
];
const SOURCES = ['Kick', 'Kick in', 'Kick out', 'Snare', 'Snare bottom', 'Hi-hat', 'Rack tom', 'Floor tom', 'Overhead L', 'Overhead R', 'Ride', 'Bass DI', 'Bass amp',
  'Guitar amp', 'Acoustic guitar', 'Keys L', 'Keys R', 'Synth', 'Tracks L', 'Tracks R', 'Click', 'Lead vocal', 'Backing vocal', 'Talkback', 'Playback'];
const MICS = ['SM58', 'SM57', 'Beta 58', 'Beta 52', 'Beta 91', 'D112', 'e604', 'e609', 'e906', 'MD421', 'Condenser', 'Small condenser', 'Ribbon', 'DI', 'Stereo DI', 'Wireless', 'Own mic'];
const STANDS = ['Tall boom', 'Short boom', 'Straight', 'Clip', 'Desk stand', 'Kick stand'];
const chOf = v => { const s = String(v ?? '').trim(); if (!s) return ''; const n = Math.round(Number(s)); return Number.isFinite(n) && n > 0 ? n : ''; };
const blankRow = r => ![r.source, r.mic, r.stand, r.note].some(v => String(v || '').trim());
const rowName = (r, i) => (String(r.source || '').trim() || `input ${i + 1}`);

// The input list editor. Every change is saved as it is made (a box when it is left, a row when it moves), so closing
// the sheet any way keeps the work.
export function openInputList(actId) {
  if (!act(actId)) return gone();
  const rowsBox = h('div', { class: 'ac-in-rows' });
  const status = h('div', { class: 'ac-in-status', 'aria-live': 'polite' });
  const lists = h('div', { hidden: true },
    h('datalist', { id: 'ac-dl-source' }, SOURCES.map(v => h('option', { value: v }))),
    h('datalist', { id: 'ac-dl-mic' }, MICS.map(v => h('option', { value: v }))),
    h('datalist', { id: 'ac-dl-stand' }, STANDS.map(v => h('option', { value: v }))));

  // What the boxes say now, merged into the stored rows (keeping any field the editor does not show).
  const fromDom = () => {
    const stored = new Map(((act(actId) || {}).inputList || []).map(r => [r.id, r]));
    return [...rowsBox.querySelectorAll('.ac-in-row')].map(el => {
      const get = k => el.querySelector(`[data-k="${k}"]`).value.trim();
      return { ...(stored.get(el.dataset.id) || {}), id: el.dataset.id, ch: chOf(get('ch')), source: get('source'), mic: get('mic'), stand: get('stand'), note: get('note') };
    });
  };
  const commit = () => {
    const a = act(actId);
    if (!a) return false;
    const list = fromDom();
    if (JSON.stringify(list) !== JSON.stringify(a.inputList || [])) patch('acts', actId, { inputList: list });
    return true;
  };
  // A change to the shape of the list: save what is typed, change the list, draw it again and put the focus back.
  const mutate = (fn, focus) => {
    if (!commit()) { close(); return gone(); }
    const list = (act(actId).inputList || []).map(r => ({ ...r }));
    if (fn(list) === false) return;
    patch('acts', actId, { inputList: list });
    draw();
    const el = focus && (typeof focus === 'function' ? focus() : body.querySelector(focus));
    if (el) el.focus();
  };
  // Move a row one place; the focus stays on the same arrow of the moved row (or its other arrow at either end), so
  // pressing it again keeps moving the row.
  const move = (id, d) => {
    const btn = dir => document.getElementById(`ac-in-${id}-${dir}`);
    mutate(l => {
      const k = l.findIndex(r => r.id === id), j = k + d;
      if (k < 0 || j < 0 || j >= l.length) return false;
      const [r] = l.splice(k, 1); l.splice(j, 0, r);
      announce(`${rowName(r, j)} moved to row ${j + 1}`);
    }, () => { const same = btn(d < 0 ? 'up' : 'down'); return same && !same.disabled ? same : btn(d < 0 ? 'down' : 'up'); });
  };

  const rowEl = (r, i, n) => {
    const name = rowName(r, i);
    const input = (k, attrs) => h('input', { 'data-k': k, id: `ac-in-${r.id}-${k}`, value: r[k] ?? '', autocomplete: 'off', onchange: commit, ...attrs });
    return h('div', { class: 'ac-in-row', 'data-id': r.id, role: 'group', 'aria-label': `Input ${i + 1}: ${name}` },
      h('div', { class: 'ac-in-l1' },
        input('ch', { class: 'ac-in-ch', type: 'number', min: 1, step: 1, inputMode: 'numeric', placeholder: 'Ch', 'aria-label': `Channel number for ${name}` }),
        input('source', { type: 'text', list: 'ac-dl-source', placeholder: 'Source (Kick, Lead vocal…)', 'aria-label': `Source, row ${i + 1}` }),
        h('div', { class: 'ac-in-tools' },
          h('button', { type: 'button', class: 'icon-btn', id: `ac-in-${r.id}-up`, 'aria-label': `Move ${name} up`, disabled: i === 0, onclick: () => move(r.id, -1) }, '↑'),
          h('button', { type: 'button', class: 'icon-btn', id: `ac-in-${r.id}-down`, 'aria-label': `Move ${name} down`, disabled: i === n - 1, onclick: () => move(r.id, 1) }, '↓'),
          h('button', { type: 'button', class: 'icon-btn ac-in-del', id: `ac-in-${r.id}-del`, 'aria-label': `Remove ${name}`, onclick: () => removeRow(r.id) }, '✕'))),
      h('div', { class: 'ac-in-l2' },
        input('mic', { type: 'text', list: 'ac-dl-mic', placeholder: 'Mic / DI', 'aria-label': `Mic or DI for ${name}` }),
        input('stand', { type: 'text', list: 'ac-dl-stand', placeholder: 'Stand', 'aria-label': `Stand for ${name}` }),
        input('note', { type: 'text', placeholder: 'Note', 'aria-label': `Note for ${name}` })));
  };
  const removeRow = id => {
    const list = fromDom(), i = list.findIndex(r => r.id === id);
    if (i < 0) return;
    if (!blankRow(list[i]) && !confirm(`Remove ${rowName(list[i], i)} from the input list?`)) return;
    mutate(l => { const k = l.findIndex(r => r.id === id); if (k < 0) return false; l.splice(k, 1); },
      () => { const rows = rowsBox.querySelectorAll('.ac-in-row'); const next = rows[Math.min(i, rows.length - 1)]; return next ? next.querySelector('[data-k="source"]') : body.querySelector('#ac-in-add'); });
  };
  const add = () => {
    const id = uid();
    mutate(l => { const top = l.reduce((m, r) => Math.max(m, Number(r.ch) || 0), 0); l.push({ id, ch: Math.max(top, l.length) + 1, source: '', mic: '', stand: '', note: '' }); }, `#ac-in-${id}-source`);
  };
  const renumber = () => mutate(l => { if (!l.length) return false; l.forEach((r, i) => { r.ch = i + 1; }); toast(`Renumbered 1–${l.length}`); }, '#ac-in-renumber');
  const preset = pid => {
    const p = PRESETS.find(x => x.id === pid);
    if (!p) return;
    commit();
    const cur = ((act(actId) || {}).inputList || []).filter(r => !blankRow(r));
    if (cur.length && !confirm(`Replace the ${cur.length} input${cur.length === 1 ? '' : 's'} on this list with the “${p.name}” list?`)) return;
    mutate(l => { l.splice(0, l.length, ...p.rows.map(([source, mic, stand = '', note = ''], i) => ({ id: uid(), ch: i + 1, source, mic, stand, note }))); toast(`${p.name}: ${p.rows.length} inputs`); }, '#ac-in-preset');
  };

  const draw = () => {
    const a = act(actId);
    if (!a) return;
    const list = a.inputList || [];
    rowsBox.replaceChildren(...list.map((r, i) => rowEl(r, i, list.length)));
    if (!list.length) rowsBox.append(h('p', { class: 'muted ac-in-empty' }, 'No inputs yet. Start from a preset above, or add them one by one: channel, source, mic or DI, stand.'));
    const dups = dupChannels(a), real = list.filter(r => !blankRow(r)).length;
    status.replaceChildren(...nodes(h('span', { class: 'muted small' }, real ? `${real} input${real === 1 ? '' : 's'}` : ''),
      dups.length > 0 && h('div', { class: 'warn' }, `Channel${dups.length === 1 ? '' : 's'} ${dups.join(', ')} ${dups.length === 1 ? 'is' : 'are'} used twice. Renumber puts them in order.`)));
  };

  const body = h('div', { class: 'ac-in-editor' },
    h('p', { class: 'small muted' }, 'The channels the sound engineer patches, in order. Use the arrows to move a row; Renumber puts the channel numbers back in order.'),
    h('div', { class: 'ac-in-top' },
      h('select', { id: 'ac-in-preset', 'aria-label': 'Fill from a preset', onchange: e => { const v = e.target.value; e.target.value = ''; preset(v); } },
        h('option', { value: '' }, 'Fill from a preset…'), PRESETS.map(p => h('option', { value: p.id }, `${p.name} (${p.rows.length})`))),
      h('button', { type: 'button', class: 'btn ghost small', id: 'ac-in-renumber', onclick: renumber }, '# Renumber')),
    status, lists, rowsBox,
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn ghost', id: 'ac-in-add', onclick: add }, '+ Add input'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn primary', id: 'ac-in-done', onclick: () => close() }, 'Done')));
  draw();
  const { close } = sheet('Input list', body, { onClose: () => { commit(); } });
  setTimeout(() => { const first = rowsBox.querySelector('[data-k="source"]'); (first || body.querySelector('#ac-in-preset')).focus({ preventScroll: true }); }, 60);
}

/* ------------------------------- riders ------------------------------- */
export function openRiders(actId) {
  const a = act(actId);
  if (!a) return gone();
  openForm({
    title: 'Riders',
    values: { riderTech: a.riderTech || '', riderHospitality: a.riderHospitality || '' },
    fields: [
      { key: 'riderTech', label: 'Technical rider', type: 'textarea', rows: 7, placeholder: 'Monitor mixes or in-ears, drum riser, backline you need, power on stage, changeover time, what you bring…' },
      { key: 'riderHospitality', label: 'Hospitality rider', type: 'textarea', rows: 6, placeholder: 'Water, towels, hot food for how many, dietary needs, drinks, a dressing room, guest list places…' },
    ],
    onSave: v => { if (!act(actId)) return gone(); patch('acts', actId, { riderTech: v.riderTech, riderHospitality: v.riderHospitality }); toast('Riders saved'); },
  });
}

/* ------------------------------- stage plot ------------------------------- */
// Things on a stage besides the players. Members are offered by name and instrument.
const ITEMS = ['Drum kit', 'Drum riser', 'Bass amp', 'Guitar amp', 'Keys', 'Vocal mic', 'Wedge', 'IEM rack', 'DI', 'Tracks / laptop', '⚡ Power'];
const memberLabel = p => { const first = String(p.name || '').trim().split(/\s+/)[0] || 'Member', inst = String(roleOf(p)).split(',')[0].trim(); return inst ? `${first} (${inst})` : first; };
let sel = null; // the selected label's id: survives the page's redraws
const where = p => `${Math.round(clamp01(p.x) * 100)}% across, ${Math.round((1 - clamp01(p.y)) * 100)}% from the front`;
const pct = v => (clamp01(v) * 100).toFixed(1) + '%';
const focusLabel = id => setTimeout(() => { const el = document.getElementById('ac-pl-' + id); if (el) el.focus({ preventScroll: true }); }, 0);

// Where a thing usually stands, as a first guess: the drums at the back in the middle, amps behind their players, the
// singer at the front, wedges on the front edge. [pattern, x, y], first match wins; anything else starts mid-stage.
const HOMES = [
  [/drum|kit\b|riser|perc|cajon/i, 0.5, 0.2], [/vocal|vox|sing/i, 0.5, 0.72], [/wedge|monitor|fill/i, 0.5, 0.92],
  [/bass.*(amp|cab)|(amp|cab).*bass/i, 0.22, 0.24], [/(guitar|gtr).*(amp|cab)|(amp|cab).*(guitar|gtr)/i, 0.78, 0.24],
  [/bass/i, 0.24, 0.5], [/guitar|gtr/i, 0.76, 0.5], [/key|piano|synth|organ|rhodes|nord/i, 0.82, 0.68],
  [/track|laptop|playback|click|iem|in-ear|rack/i, 0.16, 0.7], [/power|⚡/i, 0.5, 0.06], [/\bdi\b/i, 0.34, 0.62],
];
const homeOf = label => { const m = HOMES.find(([re]) => re.test(label)); return m ? { x: m[1], y: m[2] } : { x: 0.5, y: 0.5 }; };
// A label's size as a share of the stage (on a phone-sized stage, the tightest case): its box must not cover another.
const sizeOf = label => ({ w: Math.min(0.42, (24 + [...String(label)].length * 7.4) / 370), hgt: 0.15 });
// A free spot for a new label: the point nearest its usual place where its box clears every other label's box.
function freeSpot(plot, label) {
  const home = homeOf(label), me = sizeOf(label);
  const others = plot.map(p => ({ x: clamp01(p.x), y: clamp01(p.y), ...sizeOf(p.label || '') }));
  const clear = pt => others.every(o => Math.abs(o.x - pt.x) >= (o.w + me.w) / 2 + 0.012 || Math.abs(o.y - pt.y) >= (o.hgt + me.hgt) / 2 + 0.01);
  const pts = [];
  for (let y = 0.08; y <= 0.921; y += 0.035) for (let x = 0.03; x <= 0.971; x += 0.02) if (x - me.w / 2 >= 0.01 && x + me.w / 2 <= 0.99) pts.push({ x, y });
  pts.sort((a, b) => Math.hypot(a.x - home.x, (a.y - home.y) * 0.8) - Math.hypot(b.x - home.x, (b.y - home.y) * 0.8));
  const pt = pts.find(clear) || home; // a full stage: on its usual place, to be dragged
  return { x: clamp01(pt.x), y: clamp01(pt.y) };
}
function withPlot(actId, fn) {
  let out;
  update(d => { const a = d.acts.find(x => x.id === actId); if (!a) return; a.stagePlot = Array.isArray(a.stagePlot) ? a.stagePlot : []; out = fn(a.stagePlot, a); a.updatedAt = Date.now(); });
  return out;
}
export function addLabel(actId, label) {
  const text = String(label || '').trim().slice(0, 60);
  if (!text) return null;
  if (!act(actId)) { gone(); return null; }
  const id = uid();
  withPlot(actId, plot => { plot.push({ id, label: text, ...freeSpot(plot, text) }); });
  sel = id;
  announce(`${text} added to the stage plot. Drag it, or use the arrow keys.`);
  focusLabel(id);
  return id;
}
function setPos(actId, id, x, y) { withPlot(actId, plot => { const p = plot.find(q => q.id === id); if (p) { p.x = clamp01(x); p.y = clamp01(y); } }); }
function nudge(actId, id, dx, dy) {
  const p = withPlot(actId, plot => { const q = plot.find(r => r.id === id); if (q) { q.x = clamp01(clamp01(q.x) + dx); q.y = clamp01(clamp01(q.y) + dy); } return q; });
  if (p) announce(`${p.label}: ${where(p)}`);
}
function renameLabel(actId, id) {
  const p = plotOf(act(actId)).find(q => q.id === id);
  if (!p) return;
  openForm({ title: 'Stage plot label', values: { label: p.label || '' }, saveLabel: 'Save',
    fields: [{ key: 'label', label: 'Label', required: true, list: ITEMS, placeholder: 'e.g. Bass amp, Wedge 1, ⚡ Power' }],
    onSave: v => { const t = String(v.label || '').trim().slice(0, 60); if (!t) return; withPlot(actId, plot => { const q = plot.find(r => r.id === id); if (q) q.label = t; }); focusLabel(id); } });
}
function removeLabel(actId, id) {
  const p = plotOf(act(actId)).find(q => q.id === id);
  if (!p || !confirm(`Take “${p.label}” off the stage plot?`)) return;
  withPlot(actId, plot => { const i = plot.findIndex(q => q.id === id); if (i >= 0) plot.splice(i, 1); });
  if (sel === id) sel = null;
  toast(`Removed ${p.label}`);
}
function customLabel(actId) {
  openForm({ title: 'Stage plot label', values: {}, saveLabel: 'Add',
    fields: [{ key: 'label', label: 'Label', required: true, list: [...membersOf(act(actId)).map(memberLabel), ...ITEMS], placeholder: 'e.g. Bass amp, Wedge 1, ⚡ Power' }],
    onSave: v => addLabel(actId, v.label) });
}

// One label on the stage: drag it (mouse, pen or finger), or focus it and use the arrow keys (Shift for bigger steps);
// Enter renames it, Delete removes it. The move is drawn locally while dragging and saved once, when it is let go.
function labelEl(actId, p, stage) {
  const btn = h('button', { type: 'button', class: 'ac-pl' + (sel === p.id ? ' ac-sel' : ''), id: 'ac-pl-' + p.id, style: `left:${pct(p.x)};top:${pct(p.y)}`,
    'aria-pressed': String(sel === p.id), 'aria-describedby': 'ac-plot-hint', title: 'Drag to move' }, p.label || 'Label');
  let drag = null;
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    btn.focus({ preventScroll: true });
    const r = stage.getBoundingClientRect();
    drag = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, x: clamp01(p.x), y: clamp01(p.y), w: r.width || 1, hgt: r.height || 1, moved: false, nx: clamp01(p.x), ny: clamp01(p.y) };
    try { btn.setPointerCapture(e.pointerId); } catch { /* old browsers */ }
  });
  btn.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    btn.classList.add('ac-dragging');
    drag.nx = clamp01(drag.x + dx / drag.w); drag.ny = clamp01(drag.y + dy / drag.hgt);
    btn.style.left = pct(drag.nx); btn.style.top = pct(drag.ny);
  });
  const end = (e, keep) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    btn.classList.remove('ac-dragging');
    if (!keep) { btn.style.left = pct(p.x); btn.style.top = pct(p.y); return; }
    if (d.moved) { sel = p.id; setPos(actId, p.id, d.nx, d.ny); announce(`${p.label}: ${where({ x: d.nx, y: d.ny })}`); }
    else { sel = sel === p.id ? null : p.id; redraw(); }
  };
  btn.addEventListener('pointerup', e => end(e, true));
  btn.addEventListener('pointercancel', e => end(e, false));
  // A click from the keyboard (Space) or assistive tech selects; a mouse or touch tap was handled on pointerup.
  btn.addEventListener('click', e => { if (e.detail === 0) { sel = sel === p.id ? null : p.id; redraw(); } });
  btn.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) { e.preventDefault(); sel = p.id; nudge(actId, p.id, d[0], d[1]); return; } // preventDefault: the Rolodex leaves the key alone
    if (e.key === 'Enter') { e.preventDefault(); renameLabel(actId, p.id); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLabel(actId, p.id); }
  });
  return btn;
}

export function stagePlot(a) {
  const plot = plotOf(a);
  if (sel && !plot.some(p => p.id === sel)) sel = null;
  const cur = plot.find(p => p.id === sel);
  const stage = h('div', { class: 'ac-stage', id: 'ac-stage' },
    h('span', { class: 'ac-side ac-side-l', 'aria-hidden': 'true' }, 'Stage right'),
    h('span', { class: 'ac-side ac-side-r', 'aria-hidden': 'true' }, 'Stage left'),
    !plot.length && h('div', { class: 'ac-stage-empty' }, 'An empty stage. Add the players and the gear below, then drag them into place.'));
  stage.addEventListener('pointerdown', e => { if (e.target === stage && sel) { sel = null; redraw(); } });
  plot.forEach(p => stage.append(labelEl(a.id, p, stage)));
  const placed = new Set(plot.map(p => p.label));
  const people = membersOf(a).map(memberLabel).filter(l => !placed.has(l));
  return h('div', { class: 'ac-plot' },
    h('p', { class: 'small muted', id: 'ac-plot-hint' }, 'Drag the labels to where things stand, the audience at the bottom. With a keyboard: focus a label and use the arrow keys (Shift for bigger steps), Enter to rename, Delete to remove.'),
    h('div', { class: 'ac-stage-frame' }, h('div', { class: 'ac-stage-back', 'aria-hidden': 'true' }, 'Back of stage'), stage, h('div', { class: 'ac-audience', 'aria-hidden': 'true' }, 'Audience')),
    cur && h('div', { class: 'ac-plot-tools', role: 'group', 'aria-label': 'Selected label' },
      h('span', { class: 'grow' }, 'Selected: ', h('b', null, cur.label)),
      h('button', { type: 'button', class: 'btn ghost small', id: 'ac-pl-rename', onclick: () => renameLabel(a.id, cur.id) }, '✎ Rename'),
      h('button', { type: 'button', class: 'btn danger small', id: 'ac-pl-remove', onclick: () => removeLabel(a.id, cur.id) }, 'Remove'),
      h('button', { type: 'button', class: 'btn ghost small', id: 'ac-pl-done', onclick: () => { sel = null; redraw(); } }, 'Done')),
    h('div', { class: 'ac-quick' },
      h('div', { class: 'ac-quick-head small muted' }, 'Add to the stage'),
      h('div', { class: 'ac-chips' },
        people.map(l => h('button', { type: 'button', class: 'chip ac-chip-member', 'aria-label': `Add ${l} to the stage plot`, onclick: () => addLabel(a.id, l) }, '＋ ' + l)),
        ITEMS.map(l => h('button', { type: 'button', class: 'chip', 'aria-label': `Add ${l} to the stage plot`, onclick: () => addLabel(a.id, l) }, '＋ ' + l)),
        h('button', { type: 'button', class: 'chip ac-chip-own', id: 'ac-pl-custom', onclick: () => customLabel(a.id) }, '＋ Your own label…'))),
    plot.length > 0 && h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost small', id: 'ac-pl-clear', onclick: () => {
      if (!confirm('Clear the stage plot? Every label comes off.')) return;
      withPlot(a.id, list => { list.splice(0, list.length); }); sel = null; toast('Stage plot cleared');
    } }, 'Clear the plot')));
}

/* ------------------------------- walkthroughs ------------------------------- */
sheetTutorial('Input list', [
  { title: 'Input list', text: 'One row per channel the sound engineer patches: the channel number, the source, the mic or DI, the stand and a note.', target: ['.ac-in-editor > p'] },
  { title: 'Start from a preset', text: 'A four-piece rock band, a duo with tracks or a solo acoustic set: it fills a typical list you then change. It asks before replacing a list.', target: ['#ac-in-preset'] },
  { title: 'Rows', text: 'Type in the boxes; each one is saved when you leave it. ↑ and ↓ move a row, ✕ removes it.', target: ['.ac-in-row', '.ac-in-empty'] },
  { title: 'Renumber', text: 'After moving rows around, this numbers the channels 1, 2, 3… in the order of the list.', target: ['#ac-in-renumber'] },
  { title: 'Add a row', text: 'A new row gets the next channel number.', target: ['#ac-in-add'] },
]);
sheetTutorial('Riders', [
  { title: 'Technical rider', text: 'What the band needs on stage beyond the input list: monitor mixes, risers, backline, power, changeover time.', target: ['textarea[data-key=riderTech]'] },
  { title: 'Hospitality rider', text: 'Food, drinks, towels, a dressing room, guest list places. Both print on the tech rider.', target: ['textarea[data-key=riderHospitality]'] },
]);
sheetTutorial('Stage plot label', [
  { title: 'A label', text: 'A player, an amp, a wedge, a power drop: whatever the crew needs to see on the stage plot. Pick a suggestion or type your own.', target: ['input[data-key=label]'] },
]);

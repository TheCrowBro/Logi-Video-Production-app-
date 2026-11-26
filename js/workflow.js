// Project pipeline: every booking moves through stages, each with a checklist from a template for its job type.
// Also the smaller post/pre lists that hang off a booking: hires, shot list, media offload log, deliverables, licences.
import { h, sheet, toast, uid, fmtShort, daysUntil, telUrl, nodes, parseISO, personRate, rateText, hasUnit, keepTypedRate, typedRateHint, shortHash } from './util.js';
import { db, byId, update, upsert, remove, subscribe, endOf, splitHires } from './store.js';
import { openForm } from './form.js';
import { boardPlan } from './board.js';

/* --------------------------------- stages --------------------------------- */
export const STAGES = [
  ['Enquiry', 'enquiry'], ['Quoted', 'quoted'], ['Confirmed', 'confirmed'], ['Prepped', 'prepped'],
  ['Shot', 'shot'], ['In post', 'in-post'], ['Delivered', 'delivered'], ['Archived', 'archived'],
];
export const STATUSES = [...STAGES.map(s => s[0]), 'Cancelled'];
export const slugStatus = s => String(s || 'Enquiry').toLowerCase().replace(/\s+/g, '-');
export const stageIndex = s => Math.max(0, STAGES.findIndex(x => x[0] === s));
export const PHASE = s => (stageIndex(s) <= 3 ? 'Pre-production' : stageIndex(s) === 4 ? 'Production' : 'Post-production');

export const TYPES = [['brand', 'Brand / commercial'], ['corporate', 'Corporate / interview'], ['event', 'Event'], ['wedding', 'Wedding'], ['music', 'Music video'], ['realestate', 'Real estate'], ['doc', 'Documentary'],
  ['social', 'Social media'], ['short', 'Short film'], ['vertical', 'Vertical video (9:16)'], ['series', 'Series / episodic'], ['feature', 'Feature film'], ['other', 'Other']];

/* ---------------------------- project templates ---------------------------- */
// The user's own job types. Each one starts from a built-in type's checklists (editable like any type under
// Workflow templates) and carries the defaults a new booking of that kind should begin with.
export const projectTemplates = () => (db.projectTemplates || []).filter(t => t && t.id);
export const templateById = id => projectTemplates().find(t => t.id === id) || null;
export const baseType = type => { const t = templateById(type); return t ? (t.base || 'other') : (type || 'other'); };
export const typeOptions = () => [...projectTemplates().map(t => [t.id, `${t.icon || '📐'} ${t.name}`]), ...TYPES];
export const typeLabel = type => { const t = templateById(type); if (t) return t.name; const b = TYPES.find(x => x[0] === type); return b ? b[1] : 'Other'; };
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
// What a fresh booking of this type starts with (the form shows it, so everything can still be changed).
export function applyTemplateDefaults(booking, t) {
  if (!t) return booking;
  const out = { ...booking, type: t.id };
  if (t.start) out.start = t.start; if (t.end) out.end = t.end;
  if (t.breakMinutes !== '' && t.breakMinutes != null) out.breakMinutes = t.breakMinutes; if (t.breakNote) out.breakNote = t.breakNote;
  if ((t.kits || []).length) out.kits = [...t.kits];
  if ((t.gear || []).length) { out.gear = [...t.gear]; out.gearQty = { ...(t.gearQty || {}) }; }
  if ((t.crew || []).length) out.crew = [...t.crew];
  if (t.notes && !out.notes) out.notes = t.notes;
  return out;
}
// The parts that live outside the booking form: deliverables (due dates counted from the shoot date), the shot list
// and the call sheet's schedule and notes. Adds what is missing; never duplicates or overwrites.
export function applyTemplateExtras(bookingId, t) {
  if (!t) return 0;
  let added = 0;
  update(d => {
    const b = d.bookings.find(x => x.id === bookingId); if (!b) return;
    const have = new Set((b.deliverables || []).map(x => (x.name || '').toLowerCase()));
    for (const dl of t.deliverables || []) {
      if (!dl.name || have.has(dl.name.toLowerCase())) continue;
      const days = Number(dl.dueDays); const due = Number.isFinite(days) && dl.dueDays !== '' ? (() => { const [y, m, dd] = (b.endDate || b.date).split('-').map(Number); const x = new Date(y, m - 1, dd + days); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; })() : '';
      b.deliverables = [...(b.deliverables || []), { id: uid(), name: dl.name, duration: dl.duration || '', due, status: 'Planned', link: '', delivered: '' }]; added++;
    }
    const shots = new Set((b.shots || []).map(s => (s.text || '').toLowerCase()));
    for (const text of lines(t.shots)) if (!shots.has(text.toLowerCase())) { b.shots = [...(b.shots || []), { id: uid(), text, done: false }]; added++; }
    const cs = { ...(b.callSheet || {}) }; let csChanged = false;
    const sched = (cs.schedule || []); const seen = new Set(sched.map(r => `${r.time}|${(r.item || '').toLowerCase()}`));
    for (const r of t.schedule || []) { if (!(r.time || r.item) || seen.has(`${r.time}|${(r.item || '').toLowerCase()}`)) continue; sched.push({ id: uid(), date: b.endDate ? b.date : '', time: r.time || '', item: r.item || '' }); csChanged = true; added++; }
    if (csChanged) cs.schedule = sched;
    for (const k of ['generalCall', 'lunch', 'wrap', 'dress', 'emergency']) if (t['cs_' + k] && !cs[k]) { cs[k] = t['cs_' + k]; csChanged = true; }
    if (t.instructions && !cs.notes) { cs.notes = t.instructions; csChanged = true; }
    if (csChanged) { cs.editedAt = Date.now(); b.callSheet = cs; }
    b.updatedAt = Date.now();
  });
  return added;
}
// A booking becomes a template: its structure, with deliverable due dates turned into days after the shoot.
export function templateFromBooking(b) {
  const dayDiff = iso => { if (!iso) return ''; const [y1, m1, d1] = (b.endDate || b.date).split('-').map(Number), [y2, m2, d2] = iso.split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 864e5); };
  const cs = b.callSheet || {};
  return { name: `${b.title} template`, icon: '📐', base: baseType(b.type), start: b.start || '', end: b.end || '', breakMinutes: b.breakMinutes ?? '', breakNote: b.breakNote || '', kits: [...(b.kits || [])], gear: [...(b.gear || [])], gearQty: { ...(b.gearQty || {}) }, crew: [...(b.crew || [])], notes: b.notes || '',
    deliverables: (b.deliverables || []).map(d => ({ name: d.name, duration: d.duration || '', dueDays: dayDiff(d.due) })), shots: (b.shots || []).map(s => s.text).join('\n'),
    schedule: (cs.schedule || []).map(r => ({ time: r.time || '', item: r.item || '' })), cs_generalCall: cs.generalCall || '', cs_lunch: cs.lunch || '', cs_wrap: cs.wrap || '', cs_dress: cs.dress || '', cs_emergency: cs.emergency || '', instructions: cs.notes || '' };
}
export function editProjectTemplate(t, onDone) {
  const isNew = !t || !t.id;
  openForm({
    title: isNew ? 'New project template' : 'Edit project template',
    values: { icon: '📐', base: 'other', ...(t || {}) },
    fields: [
      { key: 'name', label: 'Template name', required: true, placeholder: 'e.g. Car shoot, Podcast episode, Conference day' },
      { key: 'icon', label: 'Icon (an emoji)', placeholder: '📐' },
      { key: 'base', label: 'Checklists start from', type: 'select', options: TYPES, hint: 'The pre- and post-production checklists of this built-in type; edit them for this template under Workflow templates.' },
      { key: 'start', label: 'Usual start', type: 'time' }, { key: 'end', label: 'Usual finish', type: 'time' },
      { key: 'breakMinutes', label: 'Approved break per day (minutes)', type: 'number', min: 0 }, { key: 'breakNote', label: 'Break terms' },
      ...(db.kits.length ? [{ key: 'kits', label: 'Kits', type: 'checks', options: db.kits.map(k => ({ value: k.id, label: k.name, hint: k.description })) }] : []),
      { key: 'gear', qtyKey: 'gearQty', label: 'Equipment', type: 'checks', options: db.gear.map(g => ({ value: g.id, label: g.name, group: g.category || 'Other', qtyMax: Math.max(1, Number(g.qty) || 1) })), empty: 'Add items on the Equipment page first.' },
      { key: 'crew', label: 'Usual crew', type: 'checks', options: db.crew.map(c => ({ value: c.id, label: c.name, hint: c.role })), empty: 'Add people on the Crew page first.' },
      { key: 'deliverables', label: 'Deliverables', type: 'rows', columns: [{ key: 'name', label: 'Deliverable' }, { key: 'duration', label: 'Duration' }, { key: 'dueDays', label: 'Due (days after shoot)', type: 'number' }] },
      { key: 'shots', label: 'Shot list', type: 'textarea', rows: 4, placeholder: 'One shot per line' },
      { key: 'schedule', label: 'Call sheet schedule', type: 'rows', columns: [{ key: 'time', label: 'Time', type: 'time' }, { key: 'item', label: 'What happens' }] },
      { key: 'cs_generalCall', label: 'General call', type: 'time' }, { key: 'cs_lunch', label: 'Lunch', type: 'time' }, { key: 'cs_wrap', label: 'Wrap', type: 'time' },
      { key: 'cs_dress', label: 'Dress code / bring' }, { key: 'cs_emergency', label: 'Emergency contact on the day' },
      { key: 'instructions', label: 'Call sheet instructions', type: 'textarea', rows: 2 },
      { key: 'notes', label: 'Booking notes', type: 'textarea', rows: 2 },
    ],
    onSave: v => {
      const item = { ...v, id: (t && t.id) || 'tpl-' + uid(), icon: (v.icon || '📐').trim().slice(0, 4) || '📐' };
      item.gearQty = Object.fromEntries(Object.entries(item.gearQty || {}).filter(([id]) => (item.gear || []).includes(id)));
      upsert('projectTemplates', item); toast(isNew ? 'Template created' : 'Template saved'); onDone && onDone(item);
    },
    // Its bookings go back to the built-in type its checklists started from: left pointing at a template that is gone,
    // they would lose those checklists and read "Other".
    onDelete: isNew ? null : () => { const base = TYPES.some(x => x[0] === t.base) ? t.base : 'other'; if (db.bookings.some(b => b.type === t.id)) update(d => { for (const b of d.bookings) if (b.type === t.id) { b.type = base; b.updatedAt = Date.now(); } }); remove('projectTemplates', t.id); toast('Template deleted'); onDone && onDone(null); },
  });
}
export function saveBookingAsTemplate(b, onDone) { editProjectTemplate({ ...templateFromBooking(b) }, onDone); }
// A sheet to pick a template for a new booking.
export function pickTemplate(onPick) {
  const list = projectTemplates();
  let close = () => {};
  const body = h('div', { class: 'stack' },
    list.length ? h('div', { class: 'list' }, ...list.map(t => h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onPick(t); } },
      h('div', { class: 'card-row' }, h('div', null, h('strong', null, `${t.icon || '📐'} ${t.name}`), h('div', { class: 'muted small' }, [t.start && `${t.start}${t.end ? '–' + t.end : ''}`, (t.kits || []).length && `${t.kits.length} kit${t.kits.length === 1 ? '' : 's'}`, (t.gear || []).length && `${t.gear.length} items`, (t.crew || []).length && `${t.crew.length} crew`, (t.deliverables || []).length && `${t.deliverables.length} deliverables`].filter(Boolean).join(' · ') || typeLabel(t.base))))))) : h('p', { class: 'muted' }, 'No templates yet. Make one here, or open a booking that went well and tap “Save as template”.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => { close(); editProjectTemplate(null, t => t && onPick(t)); } }, '+ New template')));
  ({ close } = sheet('New booking from a template', body));
}
export function projectTemplatesPanel() {
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    const list = projectTemplates();
    wrap.replaceChildren(...nodes(
      h('p', { class: 'small muted' }, 'Your own kinds of job. A template fills a new booking in: usual times and break, kits, equipment, crew, deliverables with their due dates, a shot list and the call sheet’s schedule. Its checklists start from a built-in type and can be edited under Workflow templates. Pick a template with “From template” on the Bookings page, or save any booking as one.'),
      list.length ? h('div', { class: 'list' }, ...list.map(t => h('div', { class: 'card card-row' }, h('div', null, h('strong', null, `${t.icon || '📐'} ${t.name}`), h('div', { class: 'muted small' }, `checklists: ${typeLabel(t.base)}${t.start ? ' · ' + t.start + (t.end ? '–' + t.end : '') : ''}${(t.crew || []).length ? ' · ' + t.crew.length + ' crew' : ''}${(t.deliverables || []).length ? ' · ' + t.deliverables.length + ' deliverables' : ''}`)),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => editProjectTemplate(t, draw) }, 'Edit'), h('button', { class: 'btn ghost small', onclick: () => { upsert('projectTemplates', { ...t, id: 'tpl-' + uid(), name: t.name + ' (copy)' }); draw(); } }, 'Duplicate'))))) : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => editProjectTemplate(null, draw) }, '+ New template'))));
  };
  draw();
  return wrap;
}

// Default checklists. An entry is "text" or { t: text, a: action } where the action opens the matching tool.
const BASE = {
  Enquiry: ['Brief received: objectives, audience, deliverables', 'Budget range known', 'Dates and location pencilled', 'Crew and kit availability checked'],
  Quoted: [{ t: 'Quote / estimate sent', a: 'quote' }, 'Terms and contract sent', 'Deliverables and deadlines agreed', 'Usage / licensing term agreed'],
  Confirmed: ['Deposit received', 'Booking in the calendar', { t: 'Crew asked and confirmed', a: 'crew' }, { t: 'Venue confirmed, permits requested', a: 'venue' }, { t: 'Insurance certificate sent', a: 'insurance' }, { t: 'Hires booked', a: 'hires' }],
  Prepped: [{ t: 'Shot list / storyboard done', a: 'shots' }, { t: 'Script loaded for notes', a: 'tcnotes' }, { t: 'Call sheet sent', a: 'callsheet' }, { t: 'Kit packed, batteries charged', a: 'kit' }, 'Cards formatted', 'Release forms prepared', 'Risk assessment done', { t: 'Weather and sun checked', a: 'field' }],
  Shot: [{ t: 'Shot list covered', a: 'shots' }, { t: 'Media offloaded and backed up', a: 'media' }, 'Cards cleared only after two copies', { t: 'Hours logged', a: 'hours' }, 'Releases signed and filed'],
  'In post': ['Media organised and synced', 'Assembly cut', 'Rough cut sent for review (v1)', 'Feedback received', 'Fine cut', 'Grade', 'Sound mix', { t: 'Music and stock licences logged', a: 'licences' }],
  Delivered: [{ t: 'Deliverables sent', a: 'deliverables' }, 'Client approved', { t: 'Final invoice sent', a: 'invoice' }, { t: 'Paid', a: 'invoice' }],
  Archived: ['Project archived, location noted', 'Portfolio / testimonial asked', 'Drives cleared for reuse'],
};
const EXTRA = {
  wedding: { Prepped: ['Timeline from the couple or planner', 'Family group list'], Shot: ['Speeches recorded with a second mic'] },
  event: { Confirmed: ['Accreditation / passes arranged'], Prepped: ['Run of show received', 'Power and position with the venue AV team'] },
  corporate: { Prepped: ['Interview questions agreed', 'Dress and branding guidance to interviewees'], Shot: ['Room tone recorded'] },
  brand: { Prepped: ['Treatment and shot list approved', 'Props and wardrobe confirmed'], 'In post': ['Alternate cuts for social'] },
  music: { Prepped: ['Playback track and speaker arranged', 'Performance blocking planned'] },
  realestate: { Prepped: ['Property staged and clear on the day', 'Drone permission for the area'] },
  doc: { Confirmed: ['Contributor consent and releases'], 'In post': ['Transcripts / paper edit'] },
  social: { Quoted: ['Platforms, lengths and aspect ratios agreed'], Prepped: ['Hooks for the first seconds planned', 'Captions and on-screen text planned'], Shot: ['Platform safe zones kept clear of key action'], 'In post': ['A cut for each platform and aspect ratio', 'Captions burned in and checked'] },
  short: { Confirmed: ['Script locked', 'Cast confirmed, releases prepared'], Prepped: ['Table read or rehearsal held', 'Continuity notes ready'], Shot: ['Continuity photos taken'], 'In post': ['Festival or platform delivery specs checked'] },
  vertical: { Prepped: ['Framing and safe zones agreed for 9:16', 'Camera or rig set up for vertical'], Shot: ['Key action kept inside the 9:16 safe area'], 'In post': ['Exports at 1080 × 1920'] },
  series: { Confirmed: ['Episode list and shooting order agreed'], Prepped: ['Series bible and episode notes ready', 'Block schedule across episodes'], Shot: ['Continuity logged per episode'], 'In post': ['Grade, titles and sound consistent across episodes'] },
  feature: { Confirmed: ['Cast and key crew contracts signed', 'Production insurance in place'], Prepped: ['Stripboard and shooting schedule done', 'Daily call sheets planned', 'Script supervisor booked'], Shot: ['Daily production report filed'], 'In post': ['Delivery specs confirmed (DCP, M&E, captions)'] },
};
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const itemId = (stage, text) => slugStatus(stage) + ':' + slug(text);

// Resolved template for a job type: the user's edited lists from Settings win over the defaults.
export function templateFor(type) {
  const custom = db.templates && db.templates[type || 'other'];
  const base = baseType(type);
  const out = {};
  for (const [stage] of STAGES) {
    const def = [...(BASE[stage] || []), ...((EXTRA[base] || {})[stage] || [])].map(x => (typeof x === 'string' ? { t: x } : x));
    const lines = custom && Array.isArray(custom[stage]) ? custom[stage] : null;
    out[stage] = lines ? lines.map(t => def.find(d => d.t === t) || { t }) : def;
  }
  return out;
}
export const defaultLines = (type, stage) => [...(BASE[stage] || []), ...((EXTRA[baseType(type)] || {})[stage] || [])].map(x => (typeof x === 'string' ? x : x.t));

// A line's tick is kept under its id. The id made of a-z and 0-9 is empty for a line in another script (Cyrillic, Greek,
// Arabic, Chinese, emoji…) and the same for two lines that differ only in punctuation, and those lines would share
// one tick: such a line gets a short stable mark of its whole text after the id. A line whose id is its own keeps it,
// so the ticks already on bookings stay.
export function itemsFor(b, stage) {
  const tpl = templateFor(b.type)[stage] || [], used = new Set();
  const idOf = t => { let id = itemId(stage, t); if (id.endsWith(':') || used.has(id)) id += '~' + shortHash(t); used.add(id); return id; };
  const extra = (b.extraChecks || []).filter(x => x.stage === stage).map(x => ({ t: x.text, id: x.id, custom: true }));
  return [...tpl.map(x => ({ ...x, id: idOf(x.t) })), ...extra].map(x => ({ ...x, done: !!(b.checks && b.checks[x.id]) }));
}
export const progress = (b, stage) => { const items = itemsFor(b, stage); return { done: items.filter(x => x.done).length, total: items.length }; };
export const setCheck = (b, id, done) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (!x) return; x.checks = { ...(x.checks || {}) }; if (done) x.checks[id] = Date.now(); else delete x.checks[id]; x.updatedAt = Date.now(); });
// A whole stage at once: one change, one redraw, one sync push; each item still gets its own time.
export const setChecks = (b, ids, done) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (!x) return; x.checks = { ...(x.checks || {}) }; for (const id of ids) { if (done) x.checks[id] = Date.now(); else delete x.checks[id]; } x.updatedAt = Date.now(); });
// Moving the stage by hand also forgets a "no" to archiving, so the question can come again once everything is done.
export const setStage = (b, stage) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.status = stage; delete x.archiveAsked; x.updatedAt = Date.now(); } });
// Every stage's checklist complete (stages with items): the project can be archived.
export const allComplete = b => b.status !== 'Cancelled' && STAGES.some(([s]) => progress(b, s).total > 0) && STAGES.every(([s]) => { const p = progress(b, s); return p.total === 0 || p.done === p.total; });
// Asked once the tick that completed the last stage is on screen, and only from a tap in the checklist (a quote marked
// sent or a call sheet sent tick items too, but never ask). "No" is remembered on the booking, so no device asks twice;
// unticking something later never un-archives a project.
export function offerArchive(b) {
  setTimeout(() => {
    const x = byId('bookings', b.id);
    if (!x || x.status === 'Archived' || x.archiveAsked || !allComplete(x)) return;
    if (confirm('Every stage of this project is complete. Mark this project archived?')) { setStage(x, 'Archived'); toast('Project archived'); }
    else update(d => { const y = d.bookings.find(z => z.id === x.id); if (y) { y.archiveAsked = Date.now(); y.updatedAt = Date.now(); } });
  }, 60);
}
export const addCustomItem = (b, stage, text) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.extraChecks = [...(x.extraChecks || []), { id: 'x:' + uid(), stage, text }]; x.updatedAt = Date.now(); } });
export const removeCustomItem = (b, id) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.extraChecks = (x.extraChecks || []).filter(i => i.id !== id); if (x.checks) delete x.checks[id]; x.updatedAt = Date.now(); } });

/* ------------------------------ workflow block ------------------------------ */
// actions: { crew, venue, insurance, hires, shots, tcnotes, callsheet, kit, field, media, hours, licences, deliverables }
export function workflowBlock(b, actions = {}) {
  if (b.status === 'Cancelled') return null;
  const cur = STAGES.some(s => s[0] === b.status) ? b.status : 'Enquiry';
  const ci = stageIndex(cur);
  const total = STAGES.reduce((t, [s]) => t + progress(b, s).total, 0), done = STAGES.reduce((t, [s]) => t + progress(b, s).done, 0);
  const strip = h('div', { class: 'stage-strip', role: 'tablist', 'aria-label': 'Stage' }, STAGES.map(([s, k], i) => {
    const pr = progress(b, s);
    return h('button', { class: 'stage' + (i < ci ? ' past' : i === ci ? ' now' : ''), role: 'tab', 'aria-selected': i === ci, onclick: () => setStage(b, s), title: `${s}: ${pr.done}/${pr.total}` }, h('span', { class: 'stage-no' }, i < ci ? '✓' : String(i + 1)), h('span', null, s));
  }));
  const list = stage => {
    const items = itemsFor(b, stage);
    const input = h('input', { type: 'text', placeholder: 'Add an item to this stage…', 'aria-label': 'New checklist item' });
    const add = () => { const t = input.value.trim(); if (t) { addCustomItem(b, stage, t); input.value = ''; } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    // One box for the whole stage: ticks or unticks every item; half-done shows as indeterminate.
    const allDone = items.length > 0 && items.every(i => i.done), someDone = items.some(i => i.done);
    const allBox = h('input', { type: 'checkbox', checked: allDone, 'aria-label': `${allDone ? 'Untick' : 'Tick'} every item in ${stage}`, onchange: e => { setChecks(b, items.map(i => i.id), e.target.checked); if (e.target.checked) offerArchive(b); } });
    allBox.indeterminate = someDone && !allDone;
    return h('div', { class: 'checklist' },
      items.map(it => h('div', { class: 'check-item' + (it.done ? ' done' : '') },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.done, onchange: e => { setCheck(b, it.id, e.target.checked); if (e.target.checked) offerArchive(b); } }), h('span', null, it.t)),
        it.a && actions[it.a] && h('button', { class: 'btn ghost small', 'aria-label': `Open: ${it.t}`, title: 'Open what this line is about', onclick: actions[it.a] }, '→'),
        it.custom && h('button', { class: 'icon-btn', 'aria-label': 'Remove item', onclick: () => removeCustomItem(b, it.id) }, '✕'))),
      items.length > 0 && h('div', { class: 'check-item check-all' }, h('label', { class: 'check' }, allBox, h('span', null, allDone ? 'All done · untick all' : 'Check all'))),
      h('div', { class: 'row-edit' }, input, h('button', { class: 'btn ghost small', onclick: add }, 'Add')));
  };
  const pr = progress(b, cur), complete = pr.total > 0 && pr.done === pr.total, next = STAGES[ci + 1];
  const allStages = foldAll();
  return h('section', { class: 'block workflow' }, h('h3', null, `Workflow · ${PHASE(cur)}`),
    h('div', { class: 'card' },
      strip,
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': total, 'aria-label': 'Whole project' }, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
      h('div', { class: 'card-row' }, h('strong', null, `${cur} · ${pr.done}/${pr.total}`), complete && next && h('button', { class: 'btn primary small pop-in', onclick: () => { setStage(b, next[0]); offerArchive(b); } }, `Next: ${next[0]} →`)),
      list(cur),
      allStages));
  // "All stages" and the stage inside it that was opened stay open across the redraw every tick causes.
  function foldAll() {
    const el = h('details', { class: 'help', open: ALL_OPEN.has(b.id) }, h('summary', null, 'All stages'), STAGES.filter(([s]) => s !== cur).map(([s]) => { const p = progress(b, s); const t = h('details', { class: 'twirl', open: ALL_OPEN.has(b.id + ':' + s) }, h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, p.done === p.total && p.total ? '✓' : '·'), h('span', null, h('span', { class: 'twirl-name' }, s), h('span', { class: 'twirl-sub' }, `${p.done}/${p.total}`))), h('div', { class: 'twirl-body' }, list(s))); t.addEventListener('toggle', () => { if (t.open) ALL_OPEN.add(b.id + ':' + s); else ALL_OPEN.delete(b.id + ':' + s); }); return t; }));
    el.addEventListener('toggle', () => { if (el.open) ALL_OPEN.add(b.id); else ALL_OPEN.delete(b.id); });
    return el;
  }
}
const ALL_OPEN = new Set();

/* --------------------------------- pipeline --------------------------------- */
export function openPipeline(onOpen) {
  const body = h('div', { class: 'pipeline' });
  let closeSheet = () => {};
  const draw = () => {
    const groups = STAGES.map(([s]) => [s, db.bookings.filter(b => b.status === s).sort((a, b) => a.date.localeCompare(b.date))]).filter(([, l]) => l.length);
    body.replaceChildren(...nodes(groups.length ? groups.map(([s, list]) => h('div', { class: 'pipe-col' }, h('h3', null, `${s} (${list.length})`),
      list.map(b => { const t = STAGES.reduce((acc, [st]) => { const p = progress(b, st); acc.d += p.done; acc.t += p.total; return acc; }, { d: 0, t: 0 }); const due = (b.deliverables || []).filter(x => x.due && x.status !== 'Delivered').sort((x, y) => x.due.localeCompare(y.due))[0];
        return h('button', { class: 'card tap', type: 'button', onclick: () => { closeSheet(); onOpen(b); } }, h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [fmtShort(b.date), b.client].filter(Boolean).join(' · '))), h('span', { class: 'pill' }, `${t.d}/${t.t}`)),
          due && h('div', { class: 'small' + (daysUntil(due.due) < 0 ? ' overdue' : '') }, `Due ${fmtShort(due.due)}: ${due.name}`)); })))
      : h('p', { class: 'muted' }, 'No projects yet.')));
  };
  draw();
  const unsub = subscribe(draw);
  closeSheet = sheet('Pipeline', body, { onClose: unsub }).close;
}

/* --------------------------- lists on a booking --------------------------- */
const patch = (b, fn) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { fn(x); x.updatedAt = Date.now(); } });
const money = () => db.profile.currency || '$';

// Hires are the people hired for the job (freelancers, day players); rented gear lives under rentals. A copy from an
// older build may still carry gear under hires: these two read both, and the first save sorts them out.
const legacyGear = x => !!(x && !x.name && (x.item != null || x.from != null || x.cost != null)); // an old rented item kept under hires, even with a blank item
export const hiredPeople = b => ((b && b.hires) || []).filter(x => x && !legacyGear(x));
export const rentalsOf = b => [...((b && b.rentals) || []), ...((b && b.hires) || []).filter(legacyGear)];
export const shootDaysOf = b => Math.max(1, Math.round((parseISO(endOf(b)) - parseISO(b.date)) / 864e5) + 1);
export function hiresBlock(b) {
  // An older entry holds the rate as typed: the form shows the amount and the unit it reads and saves a number and a
  // unit; the typed text is shown under the box, and what it cannot read stays until an amount replaces it (util.js).
  const rateValues = hr => { const r = personRate(hr); return { ...hr, rate: r.amount === '' ? '' : r.amount, rateUnit: hasUnit(hr) ? hr.rateUnit : r.hourly ? 'hour' : 'day' }; };
  const edit = hr => openForm({ title: hr ? 'Edit hired person' : 'Hire someone for this job', values: hr ? rateValues(hr) : { name: '', role: '', rate: '', rateUnit: 'day', days: shootDaysOf(b), phone: '', email: '', notes: '' },
    fields: [{ key: 'name', label: 'Name', required: true }, { key: 'role', label: 'Role', type: 'role' }, { key: 'rate', label: 'Rate', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 450', hint: typedRateHint(hr) + 'Feeds the budget and the suggested quote lines: a day rate per day, or an hourly rate for a standard day’s hours (Settings → Work & billing → Hours & breaks). Never goes to the crew.' }, { key: 'rateUnit', label: 'Per', type: 'select', options: [['day', 'Day'], ['hour', 'Hour']] }, { key: 'days', label: 'Days', type: 'number', min: 0, step: 'any' }, { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 }],
    onSave: v => patch(b, x => { splitHires(x); x.hires = x.hires || []; const kept = keepTypedRate(hr, v); const i = x.hires.findIndex(y => y.id === (hr && hr.id)); if (i >= 0) x.hires[i] = { ...kept, id: hr.id }; else x.hires.push({ ...kept, id: uid() }); }),
    onDelete: hr ? () => patch(b, x => { splitHires(x); x.hires = (x.hires || []).filter(y => y.id !== hr.id); if (x.crewStatus) delete x.crewStatus[hr.id]; if (x.crewCall) delete x.crewCall[hr.id]; }) : null });
  const hires = hiredPeople(b);
  return h('div', { class: 'sub', id: 'bk-hires' }, h('h4', null, `Hires (${hires.length})`),
    hires.length ? hires.map(hr => crewRow(b, hr, { sub: [rateText(hr, db.profile.currency || '$'), hr.days && `${hr.days} day${Number(hr.days) === 1 ? '' : 's'}`].filter(Boolean).join(' · '), onEdit: () => edit(hr) })) : h('p', { class: 'muted small' }, 'People hired in for this job: they go on the call sheet and the crew link like your own crew, and their cost goes in the budget.'),
    h('button', { class: 'btn ghost small', onclick: () => edit(null) }, '+ Hire someone'));
}
export function rentalsBlock(b) {
  const edit = hr => openForm({ title: hr ? 'Edit rented item' : 'Add rented item', values: hr || { item: '', from: '', cost: '', pickup: b.date, return: '', booked: 'no' },
    fields: [{ key: 'item', label: 'Item', required: true }, { key: 'from', label: 'Rental house / owner' }, { key: 'cost', label: 'Cost', type: 'number' }, { key: 'pickup', label: 'Pick up', type: 'date' }, { key: 'return', label: 'Return', type: 'date' }, { key: 'booked', label: 'Booked', type: 'select', options: [['no', 'Not yet'], ['yes', 'Booked'], ['back', 'Returned']] }],
    onSave: v => patch(b, x => { splitHires(x); x.rentals = x.rentals || []; const i = x.rentals.findIndex(y => y.id === (hr && hr.id)); if (i >= 0) x.rentals[i] = { ...v, id: hr.id }; else x.rentals.push({ ...v, id: uid() }); }),
    onDelete: hr ? () => patch(b, x => { splitHires(x); x.rentals = (x.rentals || []).filter(y => y.id !== hr.id); }) : null });
  const rentals = rentalsOf(b);
  return h('div', { class: 'sub', id: 'bk-rentals' }, h('h4', null, `Rented (${rentals.length})`),
    rentals.map(hr => h('button', { class: 'card tap', type: 'button', onclick: () => edit(hr) }, h('div', { class: 'card-row' }, h('div', null, h('strong', null, hr.item), h('div', { class: 'muted small' }, [hr.from, hr.pickup && `pick up ${fmtShort(hr.pickup)}`, hr.return && `back ${fmtShort(hr.return)}`, hr.cost !== '' && hr.cost != null && money() + hr.cost].filter(Boolean).join(' · '))), h('span', { class: 'pill ' + (hr.booked === 'yes' ? 'st-confirmed' : hr.booked === 'back' ? 'st-delivered' : 'st-enquiry') }, hr.booked === 'yes' ? 'Booked' : hr.booked === 'back' ? 'Returned' : 'Not yet')))),
    h('button', { class: 'btn ghost small', onclick: () => edit(null) }, '+ Add rented item'));
}

// The shot list card: shots grouped under their scene once an import has placed them, with the rest under Unsorted.
// Lives in the "Stripboard & shot list" section of the booking and under the board on the stripboard page.
export function shotsBlock(b) {
  const shots = b.shots || [];
  const input = h('input', { type: 'text', placeholder: 'Add a shot…', 'aria-label': 'New shot' });
  const add = () => { const t = input.value.trim(); if (!t) return; patch(b, x => { x.shots = [...(x.shots || []), ...t.split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ id: uid(), text, done: false }))]; }); input.value = ''; };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const done = shots.filter(s => s.done).length;
  const row = s => h('div', { class: 'check-item' + (s.done ? ' done' : '') }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!s.done, onchange: e => patch(b, x => { const y = (x.shots || []).find(z => z.id === s.id); if (y) y.done = e.target.checked; }) }), h('span', null, s.text)), h('button', { class: 'icon-btn', 'aria-label': 'Remove shot', onclick: () => patch(b, x => { x.shots = (x.shots || []).filter(z => z.id !== s.id); }) }, '✕'));
  const scenes = boardPlan(b).scenes, grouped = shots.some(s => s.scene);
  const label = num => { const sc = scenes.find(x => String(x.scene) === String(num)); return sc ? `Scene ${num}${sc.set ? ' · ' + sc.set : ''}` : `Scene ${num}`; };
  const order = [...new Set([...scenes.map(x => String(x.scene)), ...shots.map(s => s.scene && String(s.scene))].filter(Boolean))];
  const groups = grouped ? [...order.map(n => [n, shots.filter(s => String(s.scene || '') === n)]).filter(([, l]) => l.length), ['', shots.filter(s => !s.scene)]].filter(([, l]) => l.length) : [];
  return h('div', { class: 'card shot-list' },
    h('div', { class: 'card-row wraps' }, h('strong', null, `Shot list · ${done}/${shots.length}`), h('button', { class: 'btn ghost small', 'data-fk': 'shot-import', onclick: () => import('./stripboard.js').then(m => m.openShotImport(b)).catch(e => toast('Could not open the import: ' + (e.message || e))) }, '⬆ Import shot list…')),
    shots.length
      ? (grouped ? groups.map(([n, list]) => h('div', { class: 'shot-group' }, h('h4', null, n ? label(n) : 'Unsorted'), h('div', { class: 'checklist' }, list.map(row)))) : h('div', { class: 'checklist' }, shots.map(row)))
      : h('p', { class: 'muted small' }, 'List the shots you need and tick them off on the day. Import a shot list to fill the stripboard from it at the same time.'),
    h('div', { class: 'row-edit' }, input, h('button', { class: 'btn ghost small', onclick: add }, 'Add')));
}

const MEDIA_STEPS = [['d1', 'Drive 1'], ['d2', 'Drive 2'], ['off', 'Offsite / cloud'], ['ver', 'Verified'], ['clr', 'Card cleared']];
export function mediaBlock(b) {
  const rows = b.media || [];
  const input = h('input', { type: 'text', placeholder: 'Card or drive label, e.g. A001', 'aria-label': 'New card' });
  const add = () => { const t = input.value.trim(); if (!t) return; patch(b, x => { x.media = [...(x.media || []), { id: uid(), label: t }]; }); input.value = ''; };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const safe = r => r.d1 && r.d2;
  return h('section', { class: 'block' }, h('h3', null, 'Media & backups'),
    h('div', { class: 'card' },
      rows.length ? h('div', { class: 'media-grid' },
        h('div', { class: 'media-head' }, h('span', null, 'Card'), MEDIA_STEPS.map(([, l]) => h('span', null, l)), h('span')),
        rows.map(r => h('div', { class: 'media-row' + (safe(r) ? ' safe' : '') },
          h('span', { class: 'media-label' }, r.label),
          MEDIA_STEPS.map(([k, l]) => h('input', { type: 'checkbox', checked: !!r[k], 'aria-label': `${r.label}: ${l}`, disabled: k === 'clr' && !safe(r), title: k === 'clr' && !safe(r) ? 'Two copies first' : '', onchange: e => patch(b, x => { const y = x.media.find(z => z.id === r.id); if (y) y[k] = e.target.checked; }) })),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: () => patch(b, x => { x.media = x.media.filter(z => z.id !== r.id); }) }, '✕'))))
        : h('p', { class: 'muted small' }, 'One row per card. Clearing a card is only allowed once it is on two drives.'),
      h('div', { class: 'row-edit' }, input, h('button', { class: 'btn ghost small', onclick: add }, 'Add card'))));
}

export const DELIV_STATUS = ['Planned', 'In progress', 'Sent for review', 'Approved', 'Delivered'];
export function deliverablesBlock(b) {
  const edit = dl => openForm({ title: dl ? 'Edit deliverable' : 'Add deliverable', values: dl || { name: '', duration: '', due: '', status: 'Planned', link: '', delivered: '' },
    fields: [{ key: 'name', label: 'Deliverable', required: true, placeholder: 'e.g. Main film 16:9 4K, Social cut 9:16' }, { key: 'duration', label: 'Target duration', placeholder: '90 s' }, { key: 'due', label: 'Due', type: 'date', hint: 'Due dates go to your calendar feed and synced calendar.' }, { key: 'status', label: 'Status', type: 'select', options: DELIV_STATUS }, { key: 'link', label: 'Delivery / review link', type: 'url' }, { key: 'delivered', label: 'Delivered on', type: 'date' }],
    onSave: v => patch(b, x => { x.deliverables = x.deliverables || []; const i = x.deliverables.findIndex(y => y.id === (dl && dl.id)); if (i >= 0) x.deliverables[i] = { ...v, id: dl.id }; else x.deliverables.push({ ...v, id: uid() }); }),
    onDelete: dl ? () => patch(b, x => { x.deliverables = (x.deliverables || []).filter(y => y.id !== dl.id); }) : null });
  const list = b.deliverables || [];
  return h('section', { class: 'block' }, h('h3', null, `Deliverables (${list.length})`),
    h('div', { class: 'card' },
      list.length ? h('div', { class: 'list' }, list.map(dl => { const late = dl.due && dl.status !== 'Delivered' && daysUntil(dl.due) < 0; return h('button', { class: 'card tap', type: 'button', onclick: () => edit(dl) },
        h('div', { class: 'card-row' }, h('div', null, h('strong', null, dl.name), h('div', { class: 'muted small' }, [dl.duration, dl.due && `due ${fmtShort(dl.due)}`, dl.delivered && `delivered ${fmtShort(dl.delivered)}`].filter(Boolean).join(' · '))), h('span', { class: 'pill ' + (dl.status === 'Delivered' || dl.status === 'Approved' ? 'st-confirmed' : late ? 'st-cancelled' : dl.status === 'Planned' ? '' : 'st-enquiry') }, late ? 'Overdue' : dl.status))); }))
        : h('p', { class: 'muted small' }, 'What the client gets: formats, cuts, due dates.'),
      h('button', { class: 'btn ghost small', onclick: () => edit(null) }, '+ Add deliverable')));
}

export function licencesBlock(b) {
  const edit = lc => openForm({ title: lc ? 'Edit licence' : 'Add licence', values: lc || { kind: 'Music', title: '', licence: '', source: '', cost: '' },
    fields: [{ key: 'kind', label: 'Kind', type: 'select', options: ['Music', 'Stock footage', 'Stock photo', 'Font', 'Sound effects', 'Other'] }, { key: 'title', label: 'Title / track', required: true }, { key: 'licence', label: 'Licence number / plan' }, { key: 'source', label: 'Source (site or receipt link)', type: 'url' }, { key: 'cost', label: 'Cost', type: 'number' }],
    onSave: v => patch(b, x => { x.licences = x.licences || []; const i = x.licences.findIndex(y => y.id === (lc && lc.id)); if (i >= 0) x.licences[i] = { ...v, id: lc.id }; else x.licences.push({ ...v, id: uid() }); }),
    onDelete: lc ? () => patch(b, x => { x.licences = (x.licences || []).filter(y => y.id !== lc.id); }) : null });
  const list = b.licences || [];
  return h('div', { class: 'sub' }, h('h4', null, `Music & stock licences (${list.length})`),
    list.map(lc => h('button', { class: 'card tap', type: 'button', onclick: () => edit(lc) }, h('div', { class: 'card-row' }, h('div', null, h('strong', null, lc.title), h('div', { class: 'muted small' }, [lc.kind, lc.licence && '№ ' + lc.licence, lc.cost !== '' && lc.cost != null && money() + lc.cost].filter(Boolean).join(' · '))), h('span', { class: 'muted small' }, lc.source ? '🔗' : '')))),
    h('button', { class: 'btn ghost small', onclick: () => edit(null) }, '+ Add licence'));
}

/* ------------------------- crew confirmation on a booking ------------------------- */
export const CREW_STATES = [['', 'Not asked'], ['asked', 'Asked'], ['confirmed', 'Confirmed'], ['declined', 'Declined']];
export function crewRow(b, c, { sub = '', onEdit = null } = {}) {
  const st = (b.crewStatus || {})[c.id] || '', call = (b.crewCall || {})[c.id] || '';
  const sel = h('select', { 'aria-label': `${c.name} status`, onchange: e => patch(b, x => { x.crewStatus = { ...(x.crewStatus || {}), [c.id]: e.target.value }; }) }, CREW_STATES.map(([v, l]) => h('option', { value: v, selected: v === st }, l)));
  // Saved when the box is left or Enter is pressed, not on every change: with a keyboard a browser reports a change
  // after each part of a time typed over another, and each save draws the page again under the box. A time chosen in
  // a phone's picker (no keyboard: a coarse pointer) comes as one change and is saved at once.
  const saveCall = () => { const v = callIn.value, cur = ((byId('bookings', b.id) || b).crewCall || {})[c.id] || ''; if (v !== cur) patch(b, x => { x.crewCall = { ...(x.crewCall || {}), [c.id]: v }; }); };
  const callIn = h('input', { type: 'time', value: call, 'aria-label': `${c.name} call time`, onblur: saveCall, onchange: () => { if (window.matchMedia && matchMedia('(pointer: coarse)').matches) saveCall(); }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveCall(); } } });
  const ask = `Hi ${String(c.name || '').split(' ')[0]}, are you free for "${b.title}" on ${fmtShort(b.date)}${b.start ? ' from ' + b.start : ''}${b.address ? ' at ' + b.address.split('\n')[0] : ''}? Role: ${c.role || 'crew'}. Let me know and I’ll send the call sheet.`;
  return h('div', { class: 'card crew-line' },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, c.name), h('div', { class: 'muted' }, [c.role, sub].filter(Boolean).join(' · '))), h('span', { class: 'pill ' + (st === 'confirmed' ? 'st-confirmed' : st === 'declined' ? 'st-cancelled' : st === 'asked' ? 'st-enquiry' : '') }, CREW_STATES.find(x => x[0] === st)[1])),
    h('div', { class: 'row-edit' }, sel, h('label', { class: 'small muted' }, 'Call ', callIn)),
    h('div', { class: 'actions' }, c.phone && h('a', { class: 'btn ghost small', href: 'sms:' + telUrl(c.phone).slice(4) + '?&body=' + encodeURIComponent(ask), onclick: () => patch(b, x => { if (!(x.crewStatus || {})[c.id]) x.crewStatus = { ...(x.crewStatus || {}), [c.id]: 'asked' }; }) }, '💬 Ask by text'), c.email && h('a', { class: 'btn ghost small', href: 'mailto:' + c.email + '?' + new URLSearchParams({ subject: `Availability: ${b.title} ${fmtShort(b.date)}`, body: ask }).toString().replace(/\+/g, '%20'), onclick: () => patch(b, x => { if (!(x.crewStatus || {})[c.id]) x.crewStatus = { ...(x.crewStatus || {}), [c.id]: 'asked' }; }) }, '✉ Ask by email'), c.phone && h('a', { class: 'btn ghost small', href: telUrl(c.phone) }, '📞 Call'), onEdit && h('button', { class: 'btn ghost small', onclick: onEdit }, '✎ Edit')));
}

/* ----------------------------- templates editor ----------------------------- */
export function templatesPanel() {
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    wrap.replaceChildren(...nodes(h('p', { class: 'small muted' }, 'One checklist item per line. Items with an arrow in the app (call sheet, kit, media…) keep their shortcut if you leave their wording as it is. Changes apply to every booking of that type.'),
      [...projectTemplates().map(t => [t.id, `${t.icon || '📐'} ${t.name} (yours)`]), ...TYPES].map(([type, label]) => h('details', { class: 'twirl' }, h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '📋'), h('span', null, h('span', { class: 'twirl-name' }, label), h('span', { class: 'twirl-sub' }, db.templates && db.templates[type] ? 'customised' : 'default'))),
        h('div', { class: 'twirl-body' }, STAGES.map(([stage]) => { const lines = templateFor(type)[stage].map(x => x.t); const ta = h('textarea', { rows: Math.min(8, lines.length + 1), value: lines.join('\n'), 'aria-label': `${label}: ${stage} checklist` }); ta.addEventListener('change', () => update(d => { d.templates = d.templates || {}; d.templates[type] = { ...(d.templates[type] || {}), [stage]: ta.value.split('\n').map(s => s.trim()).filter(Boolean) }; d.templates.updatedAt = Date.now(); })); return h('div', { class: 'field' }, h('label', null, stage), ta); }),
          h('button', { class: 'btn ghost small', onclick: () => { update(d => { if (d.templates) { delete d.templates[type]; d.templates.updatedAt = Date.now(); } }); toast('Reset to defaults'); draw(); } }, 'Reset this type to defaults'))))));
  };
  draw();
  return wrap;
}

// Project pipeline: every booking moves through stages, each with a checklist from a template for its job type.
// Also the smaller post/pre lists that hang off a booking: hires, shot list, media offload log, deliverables, licences.
import { h, sheet, toast, uid, fmtShort, daysUntil, telUrl, nodes } from './util.js';
import { db, byId, update, upsert, subscribe } from './store.js';
import { openForm } from './form.js';

/* --------------------------------- stages --------------------------------- */
export const STAGES = [
  ['Enquiry', 'enquiry'], ['Quoted', 'quoted'], ['Confirmed', 'confirmed'], ['Prepped', 'prepped'],
  ['Shot', 'shot'], ['In post', 'in-post'], ['Delivered', 'delivered'], ['Archived', 'archived'],
];
export const STATUSES = [...STAGES.map(s => s[0]), 'Cancelled'];
export const slugStatus = s => String(s || 'Enquiry').toLowerCase().replace(/\s+/g, '-');
export const stageIndex = s => Math.max(0, STAGES.findIndex(x => x[0] === s));
export const PHASE = s => (stageIndex(s) <= 3 ? 'Pre-production' : stageIndex(s) === 4 ? 'Production' : 'Post-production');

export const TYPES = [['brand', 'Brand / commercial'], ['corporate', 'Corporate / interview'], ['event', 'Event'], ['wedding', 'Wedding'], ['music', 'Music video'], ['realestate', 'Real estate'], ['doc', 'Documentary'], ['other', 'Other']];

// Default checklists. An entry is "text" or { t: text, a: action } where the action opens the matching tool.
const BASE = {
  Enquiry: ['Brief received: objectives, audience, deliverables', 'Budget range known', 'Dates and location pencilled', 'Crew and kit availability checked'],
  Quoted: ['Quote / estimate sent', 'Terms and contract sent', 'Deliverables and deadlines agreed', 'Usage / licensing term agreed'],
  Confirmed: ['Deposit received', 'Booking in the calendar', { t: 'Crew asked and confirmed', a: 'crew' }, { t: 'Venue confirmed, permits requested', a: 'venue' }, { t: 'Insurance certificate sent', a: 'insurance' }, { t: 'Hires booked', a: 'hires' }],
  Prepped: [{ t: 'Shot list / storyboard done', a: 'shots' }, { t: 'Script loaded for notes', a: 'tcnotes' }, { t: 'Call sheet sent', a: 'callsheet' }, { t: 'Kit packed, batteries charged', a: 'kit' }, 'Cards formatted', 'Release forms prepared', 'Risk assessment done', { t: 'Weather and sun checked', a: 'field' }],
  Shot: [{ t: 'Shot list covered', a: 'shots' }, { t: 'Media offloaded and backed up', a: 'media' }, 'Cards cleared only after two copies', { t: 'Hours logged', a: 'hours' }, 'Releases signed and filed'],
  'In post': ['Media organised and synced', 'Assembly cut', 'Rough cut sent for review (v1)', 'Feedback received', 'Fine cut', 'Grade', 'Sound mix', { t: 'Music and stock licences logged', a: 'licences' }],
  Delivered: [{ t: 'Deliverables sent', a: 'deliverables' }, 'Client approved', 'Final invoice sent', 'Paid'],
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
};
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const itemId = (stage, text) => slugStatus(stage) + ':' + slug(text);

// Resolved template for a job type: the user's edited lists from Settings win over the defaults.
export function templateFor(type) {
  const custom = db.templates && db.templates[type || 'other'];
  const out = {};
  for (const [stage] of STAGES) {
    const def = [...(BASE[stage] || []), ...((EXTRA[type] || {})[stage] || [])].map(x => (typeof x === 'string' ? { t: x } : x));
    const lines = custom && Array.isArray(custom[stage]) ? custom[stage] : null;
    out[stage] = lines ? lines.map(t => def.find(d => d.t === t) || { t }) : def;
  }
  return out;
}
export const defaultLines = (type, stage) => [...(BASE[stage] || []), ...((EXTRA[type] || {})[stage] || [])].map(x => (typeof x === 'string' ? x : x.t));

export function itemsFor(b, stage) {
  const tpl = templateFor(b.type)[stage] || [];
  const extra = (b.extraChecks || []).filter(x => x.stage === stage).map(x => ({ t: x.text, id: x.id, custom: true }));
  return [...tpl.map(x => ({ ...x, id: itemId(stage, x.t) })), ...extra].map(x => ({ ...x, done: !!(b.checks && b.checks[x.id]) }));
}
export const progress = (b, stage) => { const items = itemsFor(b, stage); return { done: items.filter(x => x.done).length, total: items.length }; };
export const setCheck = (b, id, done) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (!x) return; x.checks = { ...(x.checks || {}) }; if (done) x.checks[id] = Date.now(); else delete x.checks[id]; x.updatedAt = Date.now(); });
export const setStage = (b, stage) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.status = stage; x.updatedAt = Date.now(); } });
export const addCustomItem = (b, stage, text) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.extraChecks = [...(x.extraChecks || []), { id: 'x:' + uid(), stage, text }]; x.updatedAt = Date.now(); } });
export const removeCustomItem = (b, id) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.extraChecks = (x.extraChecks || []).filter(i => i.id !== id); if (x.checks) delete x.checks[id]; x.updatedAt = Date.now(); } });

/* ------------------------------ workflow block ------------------------------ */
// actions: { crew, venue, insurance, hires, shots, tcnotes, callsheet, kit, field, media, hours, licences, deliverables }
export function workflowBlock(b, actions = {}) {
  if (b.status === 'Cancelled') return null;
  const cur = STAGES.some(s => s[0] === b.status) ? b.status : 'Enquiry';
  const ci = stageIndex(cur);
  const total = STAGES.reduce((t, [s]) => t + progress(b, s).total, 0), done = STAGES.reduce((t, [s]) => t + progress(b, s).done, 0);
  const showAll = b._showAllStages;
  const strip = h('div', { class: 'stage-strip', role: 'tablist', 'aria-label': 'Stage' }, STAGES.map(([s, k], i) => {
    const pr = progress(b, s);
    return h('button', { class: 'stage' + (i < ci ? ' past' : i === ci ? ' now' : ''), role: 'tab', 'aria-selected': i === ci, onclick: () => setStage(b, s), title: `${s}: ${pr.done}/${pr.total}` }, h('span', { class: 'stage-no' }, i < ci ? '✓' : String(i + 1)), h('span', null, s));
  }));
  const list = stage => {
    const items = itemsFor(b, stage);
    const input = h('input', { type: 'text', placeholder: 'Add an item to this stage…', 'aria-label': 'New checklist item' });
    const add = () => { const t = input.value.trim(); if (t) { addCustomItem(b, stage, t); input.value = ''; } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'checklist' },
      items.map(it => h('div', { class: 'check-item' + (it.done ? ' done' : '') },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: it.done, onchange: e => setCheck(b, it.id, e.target.checked) }), h('span', null, it.t)),
        it.a && actions[it.a] && h('button', { class: 'btn ghost small', onclick: actions[it.a] }, '→'),
        it.custom && h('button', { class: 'icon-btn', 'aria-label': 'Remove item', onclick: () => removeCustomItem(b, it.id) }, '✕'))),
      h('div', { class: 'row-edit' }, input, h('button', { class: 'btn ghost small', onclick: add }, 'Add')));
  };
  const pr = progress(b, cur), complete = pr.total > 0 && pr.done === pr.total, next = STAGES[ci + 1];
  return h('section', { class: 'block workflow' }, h('h3', null, `Workflow · ${PHASE(cur)}`),
    h('div', { class: 'card' },
      strip,
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': total, 'aria-label': 'Whole project' }, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` })),
      h('div', { class: 'card-row' }, h('strong', null, `${cur} · ${pr.done}/${pr.total}`), complete && next && h('button', { class: 'btn primary small pop-in', onclick: () => setStage(b, next[0]) }, `Next: ${next[0]} →`)),
      list(cur),
      h('details', { class: 'help', open: !!showAll }, h('summary', null, 'All stages'), STAGES.filter(([s]) => s !== cur).map(([s]) => { const p = progress(b, s); return h('details', { class: 'twirl' }, h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, p.done === p.total && p.total ? '✓' : '·'), h('span', null, h('span', { class: 'twirl-name' }, s), h('span', { class: 'twirl-sub' }, `${p.done}/${p.total}`))), h('div', { class: 'twirl-body' }, list(s))); }))));
}

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

export function hiresBlock(b) {
  const edit = hr => openForm({ title: hr ? 'Edit hire' : 'Add hire', values: hr || { item: '', from: '', cost: '', pickup: b.date, return: '', booked: 'no' },
    fields: [{ key: 'item', label: 'Item', required: true }, { key: 'from', label: 'Rental house / owner' }, { key: 'cost', label: 'Cost', type: 'number' }, { key: 'pickup', label: 'Pick up', type: 'date' }, { key: 'return', label: 'Return', type: 'date' }, { key: 'booked', label: 'Booked', type: 'select', options: [['no', 'Not yet'], ['yes', 'Booked'], ['back', 'Returned']] }],
    onSave: v => patch(b, x => { x.hires = x.hires || []; const i = x.hires.findIndex(y => y.id === (hr && hr.id)); if (i >= 0) x.hires[i] = { ...v, id: hr.id }; else x.hires.push({ ...v, id: uid() }); }),
    onDelete: hr ? () => patch(b, x => { x.hires = (x.hires || []).filter(y => y.id !== hr.id); }) : null });
  const hires = b.hires || [];
  return h('div', { class: 'sub' }, h('h4', null, `Hires (${hires.length})`),
    hires.map(hr => h('button', { class: 'card tap', type: 'button', onclick: () => edit(hr) }, h('div', { class: 'card-row' }, h('div', null, h('strong', null, hr.item), h('div', { class: 'muted small' }, [hr.from, hr.pickup && `pick up ${fmtShort(hr.pickup)}`, hr.return && `back ${fmtShort(hr.return)}`, hr.cost !== '' && hr.cost != null && money() + hr.cost].filter(Boolean).join(' · '))), h('span', { class: 'pill ' + (hr.booked === 'yes' ? 'st-confirmed' : hr.booked === 'back' ? 'st-delivered' : 'st-enquiry') }, hr.booked === 'yes' ? 'Booked' : hr.booked === 'back' ? 'Returned' : 'Not yet')))),
    h('button', { class: 'btn ghost small', onclick: () => edit(null) }, '+ Add hire'));
}

export function shotsBlock(b) {
  const shots = b.shots || [];
  const input = h('input', { type: 'text', placeholder: 'Add a shot…', 'aria-label': 'New shot' });
  const add = () => { const t = input.value.trim(); if (!t) return; patch(b, x => { x.shots = [...(x.shots || []), ...t.split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ id: uid(), text, done: false }))]; }); input.value = ''; };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const done = shots.filter(s => s.done).length;
  return h('section', { class: 'block' }, h('h3', null, `Shot list · ${done}/${shots.length}`),
    h('div', { class: 'card' },
      shots.length ? h('div', { class: 'checklist' }, shots.map(s => h('div', { class: 'check-item' + (s.done ? ' done' : '') }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.done, onchange: e => patch(b, x => { const y = x.shots.find(z => z.id === s.id); if (y) y.done = e.target.checked; }) }), h('span', null, s.text)), h('button', { class: 'icon-btn', 'aria-label': 'Remove shot', onclick: () => patch(b, x => { x.shots = x.shots.filter(z => z.id !== s.id); }) }, '✕')))) : h('p', { class: 'muted small' }, 'List the shots you need; tick them off on the day.'),
      h('div', { class: 'row-edit' }, input, h('button', { class: 'btn ghost small', onclick: add }, 'Add')),
      h('button', { class: 'btn ghost small', onclick: () => { const ta = h('textarea', { rows: 8, placeholder: 'One shot per line' }); const { close } = sheet('Paste a shot list', h('div', { class: 'stack' }, ta, h('button', { class: 'btn primary', onclick: () => { const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean); if (lines.length) patch(b, x => { x.shots = [...(x.shots || []), ...lines.map(text => ({ id: uid(), text, done: false }))]; }); close(); } }, 'Add shots'))); } }, 'Paste a list…')));
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
export function crewRow(b, c) {
  const st = (b.crewStatus || {})[c.id] || '', call = (b.crewCall || {})[c.id] || '';
  const sel = h('select', { 'aria-label': `${c.name} status`, onchange: e => patch(b, x => { x.crewStatus = { ...(x.crewStatus || {}), [c.id]: e.target.value }; }) }, CREW_STATES.map(([v, l]) => h('option', { value: v, selected: v === st }, l)));
  const callIn = h('input', { type: 'time', value: call, 'aria-label': `${c.name} call time`, onchange: e => patch(b, x => { x.crewCall = { ...(x.crewCall || {}), [c.id]: e.target.value }; }) });
  const ask = `Hi ${c.name.split(' ')[0]}, are you free for "${b.title}" on ${fmtShort(b.date)}${b.start ? ' from ' + b.start : ''}${b.address ? ' at ' + b.address.split('\n')[0] : ''}? Role: ${c.role || 'crew'}. Let me know and I’ll send the call sheet.`;
  return h('div', { class: 'card crew-line' },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, c.name), h('div', { class: 'muted' }, c.role || '')), h('span', { class: 'pill ' + (st === 'confirmed' ? 'st-confirmed' : st === 'declined' ? 'st-cancelled' : st === 'asked' ? 'st-enquiry' : '') }, CREW_STATES.find(x => x[0] === st)[1])),
    h('div', { class: 'row-edit' }, sel, h('label', { class: 'small muted' }, 'Call ', callIn)),
    h('div', { class: 'actions' }, c.phone && h('a', { class: 'btn ghost small', href: 'sms:' + telUrl(c.phone).slice(4) + '?&body=' + encodeURIComponent(ask), onclick: () => patch(b, x => { if (!(x.crewStatus || {})[c.id]) x.crewStatus = { ...(x.crewStatus || {}), [c.id]: 'asked' }; }) }, '💬 Ask by text'), c.email && h('a', { class: 'btn ghost small', href: 'mailto:' + c.email + '?' + new URLSearchParams({ subject: `Availability: ${b.title} ${fmtShort(b.date)}`, body: ask }).toString().replace(/\+/g, '%20'), onclick: () => patch(b, x => { if (!(x.crewStatus || {})[c.id]) x.crewStatus = { ...(x.crewStatus || {}), [c.id]: 'asked' }; }) }, '✉ Ask by email'), c.phone && h('a', { class: 'btn ghost small', href: telUrl(c.phone) }, '📞 Call')));
}

/* ----------------------------- templates editor ----------------------------- */
export function templatesPanel() {
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    wrap.replaceChildren(...nodes(h('p', { class: 'small muted' }, 'One checklist item per line. Items with an arrow in the app (call sheet, kit, media…) keep their shortcut if you leave their wording as it is. Changes apply to every booking of that type.'),
      TYPES.map(([type, label]) => h('details', { class: 'twirl' }, h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '📋'), h('span', null, h('span', { class: 'twirl-name' }, label), h('span', { class: 'twirl-sub' }, db.templates && db.templates[type] ? 'customised' : 'default'))),
        h('div', { class: 'twirl-body' }, STAGES.map(([stage]) => { const lines = templateFor(type)[stage].map(x => x.t); const ta = h('textarea', { rows: Math.min(8, lines.length + 1), value: lines.join('\n'), 'aria-label': `${label}: ${stage} checklist` }); ta.addEventListener('change', () => update(d => { d.templates = d.templates || {}; d.templates[type] = { ...(d.templates[type] || {}), [stage]: ta.value.split('\n').map(s => s.trim()).filter(Boolean) }; d.templates.updatedAt = Date.now(); })); return h('div', { class: 'field' }, h('label', null, stage), ta); }),
          h('button', { class: 'btn ghost small', onclick: () => { update(d => { if (d.templates) { delete d.templates[type]; d.templates.updatedAt = Date.now(); } }); toast('Reset to defaults'); draw(); } }, 'Reset this type to defaults'))))));
  };
  draw();
  return wrap;
}

// Call sheets, built in the app: one per shoot, edited directly on the document (times, schedule, who is on set,
// weather, emergency contact, instructions, each person's call time), then printed from the app, saved as a PDF or
// a web page, shared, or emailed to the whole crew. "Call sheets" on the Bookings page lists every shoot and whether
// its sheet has gone out.
import { h, toast, nodes, sheet, fmtLong, fmtShort, fmtTime, parseISO, todayISO, mapsUrl, uid } from './util.js';
import { db, byId, endOf, upsert, activeBookings } from './store.js';
import { getTimes } from './suncalc.js';
import { setCheck, itemId } from './workflow.js';
import { saveOrShare } from './backup.js';
import { makePdf } from './pdf.js';

const INCLUDE = { kit: true, rules: true, sun: true, contacts: true, notes: true };
const BLANK = { generalCall: '', lunch: '', wrap: '', schedule: [], attendees: '', weather: '', dress: '', emergency: '', notes: '', version: 0, editedAt: 0, sentAt: 0 };
export const sheetOf = b => { const cs = { ...BLANK, ...(b.callSheet || {}) }; cs.include = { ...INCLUDE, ...(cs.include || {}) }; cs.schedule = Array.isArray(cs.schedule) ? cs.schedule.map(r => ({ ...r })) : []; return cs; };
const hasContent = cs => !!(cs.generalCall || cs.lunch || cs.wrap || cs.schedule.length || cs.attendees || cs.weather || cs.dress || cs.emergency || cs.notes);
export const sheetState = b => { const cs = sheetOf(b); return cs.sentAt ? (cs.editedAt > cs.sentAt ? 'changed' : 'sent') : hasContent(cs) ? 'draft' : 'none'; };
const STATE_LABEL = { none: 'Not started', draft: 'Draft', sent: 'Sent', changed: 'Changed since it was sent' };
const dateLabel = (b, f = fmtLong) => (endOf(b) > b.date ? `${f(b.date)} → ${f(endOf(b))}` : f(b.date));
const multiDay = b => endOf(b) > b.date;
const slug = s => String(s || 'shoot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/* ----------------------------------- data ----------------------------------- */
export function callSheetData(b, cs = sheetOf(b), crewCall = b.crewCall || {}) {
  const p = db.profile, v = b.venueId ? byId('venues', b.venueId) : null;
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean).map(c => ({ ...c, call: crewCall[c.id] || cs.generalCall || b.start || '' }));
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const kit = {}; gear.forEach(g => { const c = g.category || 'Other'; kit[c] = (kit[c] || 0) + Math.max(1, Number((b.gearQty || {})[g.id]) || 1); });
  let loc = null; try { loc = v && v.geo && Number.isFinite(Number(v.geo.lat)) ? { lat: +v.geo.lat, lon: +v.geo.lon } : JSON.parse(localStorage.getItem('logi-loc')); } catch { /* none */ }
  const sun = loc ? getTimes(new Date(parseISO(b.date).getTime() + 12 * 36e5), loc.lat, loc.lon) : null;
  const address = (b.address || (v && v.address) || '').replace(/\n/g, ', ');
  const schedule = cs.schedule.filter(r => r && (r.time || r.item)).sort((x, y) => `${x.date || b.date} ${x.time || ''}`.localeCompare(`${y.date || b.date} ${y.time || ''}`));
  const days = multiDay(b) ? [...new Set([b.date, ...schedule.map(r => r.date).filter(Boolean)])].sort() : [b.date];
  const producer = [p.name, p.business].filter(Boolean).join(' · ') || 'Vdex';
  const producerLine = `${producer}${p.phone ? ' · ' + p.phone : ''}${p.email ? ' · ' + p.email : ''}`;
  return { b, p, v, cs, crew, kit, hires: b.hires || [], sun, address, schedule, days, producer, producerLine, generalCall: cs.generalCall || b.start || '', wrap: cs.wrap || b.end || '', breaks: [b.breakMinutes && b.breakMinutes + ' min approved', b.breakNote].filter(Boolean).join(' · ') };
}

/* ----------------------------------- text ----------------------------------- */
const line = (k, v) => (v ? `${k}: ${v}` : null);
export function callSheetText(b) {
  const d = callSheetData(b), { cs, v } = d, inc = cs.include;
  const sched = d.schedule.map(r => `${multiDay(b) && r.date ? fmtShort(r.date) + ' ' : ''}${r.time || '—'}  ${r.item || ''}`.trim());
  const out = [
    `CALL SHEET — ${b.title}${b.client ? ' (' + b.client + ')' : ''}`,
    dateLabel(b) + (cs.version ? `  ·  v${cs.version}` : ''),
    line('General call', d.generalCall), line('Lunch', cs.lunch), line('Wrap (planned)', d.wrap),
    '',
    'LOCATION',
    v && line('Venue', v.name), line('Address', d.address), v && line('Access', v.access), v && line('Parking', v.parking), v && line('Power', v.power), v && line('Nearest hospital', v.hospital),
    inc.rules && v && (v.rules || '').trim() && 'Venue rules: ' + v.rules.replace(/\n/g, '; '),
    d.breaks && line('Breaks', d.breaks),
    '',
    sched.length && 'SCHEDULE', ...sched, sched.length && '',
    inc.sun && d.sun && 'SUN', inc.sun && d.sun && `Sunrise ${fmtTime(d.sun.sunrise)} · Golden hour ends ${fmtTime(d.sun.goldenHourEnd)} · Golden hour from ${fmtTime(d.sun.goldenHour)} · Sunset ${fmtTime(d.sun.sunset)}`,
    cs.weather && line('Weather', cs.weather), ((inc.sun && d.sun) || cs.weather) && '',
    'CREW',
    ...(d.crew.length ? d.crew.map(c => `${c.name} — ${c.role || 'crew'}${c.call ? ' · call ' + c.call : ''}${c.phone ? ' · ' + c.phone : ''}${c.email ? ' · ' + c.email : ''}`) : ['(no crew assigned)']),
    '',
    inc.contacts && ((b.stakeholders || []).length || cs.attendees) && 'ON SET / CONTACTS',
    ...(inc.contacts ? (b.stakeholders || []).map(s => [s.name, s.role, s.phone].filter(Boolean).join(' · ')) : []),
    inc.contacts && cs.attendees, inc.contacts && ((b.stakeholders || []).length || cs.attendees) && '',
    inc.kit && Object.keys(d.kit).length && 'KIT', inc.kit && Object.keys(d.kit).length && Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · '),
    inc.kit && d.hires.length && 'Hires: ' + d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '),
    inc.kit && Object.keys(d.kit).length && '',
    cs.dress && line('Dress code / bring', cs.dress), cs.emergency && line('Emergency contact', cs.emergency), (cs.dress || cs.emergency) && '',
    (cs.notes || (inc.notes && b.notes)) && 'NOTES', cs.notes, inc.notes && b.notes && b.notes !== cs.notes ? b.notes : null, (cs.notes || (inc.notes && b.notes)) && '',
    'Produced by ' + d.producerLine,
  ].filter(x => x !== null && x !== false && x !== undefined && x !== 0);
  return out.join('\n');
}

/* --------------------------------- document --------------------------------- */
// One DOM for the in-app page, the print view and the saved web page. In edit mode the editable spots become inputs.
export function renderDoc(b, { cs = sheetOf(b), crewCall = b.crewCall || {}, edit = null } = {}) {
  const d = callSheetData(b, cs, crewCall), { v, p } = d, inc = cs.include, multi = multiDay(b);
  const sec = (title, ...kids) => { const body = nodes(...kids); return body.length ? h('section', { class: 'cs-sec' }, h('h4', null, title), ...body) : null; };
  const kv = (k, val) => val && h('div', { class: 'cs-kv' }, h('span', null, k), h('b', null, val));
  const table = (head, rows) => rows.length && h('table', null, h('thead', null, h('tr', null, ...head.map(x => h('th', null, x)))), h('tbody', null, ...rows.map(r => h('tr', null, ...r.map(x => h('td', null, x == null ? '' : x))))));
  const bind = (key, el) => { el.addEventListener('change', e => { cs[key] = e.target.value; edit.touch(); }); return el; };
  const input = (key, type, ph) => bind(key, h('input', { type, value: cs[key] || '', placeholder: ph, 'aria-label': ph, class: 'cs-in' }));
  const area = (key, ph, rows = 2) => bind(key, h('textarea', { rows, value: cs[key] || '', placeholder: ph, 'aria-label': ph, class: 'cs-in' }));
  const timeBox = (label, val, key) => (edit && key) ? h('div', { class: 'cs-time' }, h('span', null, label), input(key, 'time', label)) : val && h('div', { class: 'cs-time' }, h('span', null, label), h('b', null, val));
  const include = key => !edit && inc[key] === false ? false : true; // in edit mode everything shows, with a toggle
  const toggle = (key, label) => h('label', { class: 'cs-toggle' }, h('input', { type: 'checkbox', checked: inc[key] !== false, onchange: e => { cs.include[key] = e.target.checked; edit.touch(); } }), label);
  const scheduleRows = day => d.schedule.filter(r => (r.date || b.date) === day).map(r => [r.time || '—', r.item || '']);
  const scheduleEditor = () => h('div', { class: 'cs-sched-edit' },
    ...cs.schedule.map((r, i) => h('div', { class: 'row-edit' },
      multi && h('input', { type: 'date', value: r.date || b.date, 'aria-label': 'Date', onchange: e => { r.date = e.target.value; edit.touch(); } }),
      h('input', { type: 'time', value: r.time || '', 'aria-label': 'Time', onchange: e => { r.time = e.target.value; edit.touch(); } }),
      h('input', { type: 'text', value: r.item || '', placeholder: 'What happens', 'aria-label': 'What happens', onchange: e => { r.item = e.target.value; edit.touch(); } }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove line', onclick: () => { cs.schedule.splice(i, 1); edit.touch(); edit.redraw(); } }, '✕'))),
    h('button', { type: 'button', class: 'btn ghost small', onclick: () => { cs.schedule.push({ id: uid(), date: multi ? b.date : '', time: '', item: '' }); edit.touch(); edit.redraw(); } }, '+ Add line'),
    h('p', { class: 'cs-hint' }, 'Crew call, set-up, first shot, interviews, lunch, company moves, wrap… one line each.'));
  const crewCell = c => edit ? h('input', { type: 'time', value: crewCall[c.id] || '', 'aria-label': `${c.name} call time`, class: 'cs-in', onchange: e => { crewCall[c.id] = e.target.value; edit.touch(); } }) : c.call;
  return h('article', { class: 'cs-doc' },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, d.producer), h('div', { class: 'cs-kicker' }, 'CALL SHEET')),
      h('div', { class: 'cs-when' }, h('b', null, dateLabel(b, fmtShort)), h('div', null, cs.version ? `Version ${cs.version}` : 'Draft'))),
    h('h2', null, b.title), b.client && h('div', { class: 'cs-sub' }, b.client),
    edit && h('div', { class: 'cs-include' }, h('span', { class: 'cs-hint' }, 'Include:'), toggle('sun', 'Sun'), toggle('rules', 'Venue rules'), toggle('contacts', 'Contacts'), toggle('kit', 'Kit'), toggle('notes', 'Booking notes')),
    h('div', { class: 'cs-times' }, timeBox('General call', d.generalCall, 'generalCall'), timeBox('Lunch', cs.lunch, 'lunch'), timeBox('Wrap', d.wrap, 'wrap'), include('sun') && d.sun && timeBox('Sunrise', fmtTime(d.sun.sunrise)), include('sun') && d.sun && timeBox('Sunset', fmtTime(d.sun.sunset))),
    sec('Location', v && kv('Venue', v.name), kv('Address', d.address), v && kv('Access', v.access), v && kv('Parking', v.parking), v && kv('Power', v.power), v && kv('Nearest hospital', v.hospital),
      include('rules') && v && (v.rules || '').trim() && kv('Venue rules', v.rules.replace(/\n/g, '; ')),
      d.address && h('div', { class: 'cs-kv' }, h('span', null, 'Map'), h('a', { href: mapsUrl(d.address), target: '_blank', rel: 'noopener noreferrer' }, mapsUrl(d.address)))),
    edit ? sec('Schedule', scheduleEditor()) : d.schedule.length ? sec('Schedule', ...d.days.map(day => { const rows = scheduleRows(day); return rows.length && [multi && h('div', { class: 'cs-day' }, fmtLong(day)), table(['Time', 'What'], rows)]; })) : null,
    sec('Crew', d.crew.length ? table(['Name', 'Role', 'Call', 'Phone', 'Email'], d.crew.map(c => [c.name, c.role || 'crew', crewCell(c), c.phone, c.email])) : h('p', null, 'No crew assigned yet. Add people on the booking and they appear here with their call times.'),
      edit && d.crew.length && h('p', { class: 'cs-hint' }, 'A blank call time means the general call.')),
    include('contacts') && sec('On set / contacts', (b.stakeholders || []).length && table(['Name', 'Role', 'Phone'], b.stakeholders.map(s => [s.name, s.role, s.phone])),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'On set'), area('attendees', 'Who is coming from the client or talent, when, and who looks after them')) : cs.attendees && h('p', { class: 'cs-pre' }, cs.attendees),
      kv('Producer', d.producerLine),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Emergency'), input('emergency', 'text', 'Emergency contact on the day: name · phone')) : kv('Emergency contact', cs.emergency)),
    include('kit') && sec('Kit', Object.keys(d.kit).length && h('p', null, Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · ')), d.hires.length && kv('Hires', d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '))),
    sec('Day notes', include('sun') && d.sun && kv('Golden hour', `ends ${fmtTime(d.sun.goldenHourEnd)}, from ${fmtTime(d.sun.goldenHour)}`),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Weather'), input('weather', 'text', 'e.g. 14°C, showers from 3pm — bring rain covers')) : kv('Weather', cs.weather),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Dress / bring'), input('dress', 'text', 'e.g. All black, sturdy boots, hi-vis for the yard')) : kv('Dress code / bring', cs.dress),
      d.breaks && kv('Breaks', d.breaks),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Instructions'), area('notes', 'Parking passes, radio channels, quiet zones, release forms, catering…', 3)) : cs.notes && h('p', { class: 'cs-pre' }, cs.notes),
      include('notes') && b.notes && b.notes !== cs.notes && h('p', { class: 'cs-pre' }, b.notes)),
    h('footer', { class: 'cs-foot' }, `Produced by ${d.producerLine} · Made with Vdex on ${new Date().toLocaleDateString()}`));
}

// The document's own styles: used as-is in the saved web page, and scoped under #print-root for printing from the app.
const RULES = [
  ['', 'margin:0;background:#fff;color:#111;font:13px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif'],
  ['.cs-doc', 'max-width:760px;margin:0 auto;padding:28px 24px'],
  ['.cs-head', 'display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #111;padding-bottom:8px'],
  ['.cs-brand', 'font-weight:700;letter-spacing:.04em'], ['.cs-kicker', 'font-size:11px;letter-spacing:.2em;color:#555'],
  ['.cs-when', 'text-align:right;font-size:12px;color:#444'], ['.cs-when b', 'display:block;font-size:14px;color:#111'],
  ['.cs-doc h2', 'margin:14px 0 2px;font-size:22px'], ['.cs-sub', 'color:#444;margin-bottom:8px'],
  ['.cs-times', 'display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0'],
  ['.cs-time', 'border:1px solid #ddd;border-radius:8px;padding:8px 10px'], ['.cs-time span', 'display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666'], ['.cs-time b', 'font-size:18px'],
  ['.cs-sec', 'margin-top:16px;break-inside:avoid'], ['.cs-sec h4', 'margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px'],
  ['.cs-kv', 'display:grid;grid-template-columns:140px 1fr;gap:8px;padding:3px 0'], ['.cs-kv span', 'color:#666'], ['.cs-kv a', 'color:#1a4e8a;word-break:break-all'],
  ['table', 'width:100%;border-collapse:collapse;margin:4px 0 8px'], ['th,td', 'text-align:left;vertical-align:top;padding:5px 6px;border-bottom:1px solid #e3e3e3;font-size:12.5px'],
  ['th', 'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666'],
  ['.cs-day', 'font-weight:700;margin:8px 0 2px'], ['.cs-pre', 'white-space:pre-wrap;margin:4px 0'], ['.cs-foot', 'margin-top:22px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#666'],
];
export const docCss = prefix => RULES.map(([sel, decl]) => `${sel ? sel.split(',').map(s => prefix + s.trim()).join(',') : (prefix.trim() || 'body')}{${decl}}`).join('\n');
const escHtml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
export const callSheetHtml = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Call sheet — ${escHtml(b.title)}</title><style>${docCss('')}\n@page{margin:14mm}@media print{.cs-doc{padding:0}}</style></head><body>${renderDoc(b).outerHTML}</body></html>`;

/* ------------------------------------ PDF ------------------------------------ */
export function callSheetPdf(b) {
  const d = callSheetData(b), { cs, v } = d, inc = cs.include, blocks = [];
  const kv = (k, val) => { if (val) blocks.push({ type: 'kv', k, v: val }); };
  blocks.push({ type: 'title', text: b.title }, { type: 'subtitle', text: [b.client, dateLabel(b), cs.version ? `Version ${cs.version}` : 'Draft'].filter(Boolean).join('   ·   ') });
  blocks.push({ type: 'times', items: [['General call', d.generalCall], ['Lunch', cs.lunch], ['Wrap', d.wrap], inc.sun && d.sun && ['Sunrise', fmtTime(d.sun.sunrise)], inc.sun && d.sun && ['Sunset', fmtTime(d.sun.sunset)]].filter(Boolean) });
  blocks.push({ type: 'heading', text: 'Location' });
  if (v) kv('Venue', v.name); kv('Address', d.address); if (v) { kv('Access', v.access); kv('Parking', v.parking); kv('Power', v.power); kv('Nearest hospital', v.hospital); if (inc.rules && (v.rules || '').trim()) kv('Venue rules', v.rules.replace(/\n/g, '; ')); }
  if (d.address) kv('Map', mapsUrl(d.address));
  if (d.schedule.length) {
    blocks.push({ type: 'heading', text: 'Schedule' });
    for (const day of d.days) { const rows = d.schedule.filter(r => (r.date || b.date) === day).map(r => [r.time || '—', r.item || '']); if (!rows.length) continue; if (multiDay(b)) blocks.push({ type: 'text', text: fmtLong(day), bold: true }); blocks.push({ type: 'table', head: ['Time', 'What'], rows, widths: [0.16, 0.84] }); }
  }
  blocks.push({ type: 'heading', text: 'Crew' });
  if (d.crew.length) blocks.push({ type: 'table', head: ['Name', 'Role', 'Call', 'Phone', 'Email'], rows: d.crew.map(c => [c.name, c.role || 'crew', c.call, c.phone, c.email]), widths: [0.24, 0.2, 0.1, 0.2, 0.26] });
  else blocks.push({ type: 'text', text: 'No crew assigned yet.' });
  if (inc.contacts) {
    blocks.push({ type: 'heading', text: 'On set / contacts' });
    if ((b.stakeholders || []).length) blocks.push({ type: 'table', head: ['Name', 'Role', 'Phone'], rows: b.stakeholders.map(s => [s.name, s.role, s.phone]), widths: [0.4, 0.35, 0.25] });
    if (cs.attendees) blocks.push({ type: 'text', text: cs.attendees });
    kv('Producer', d.producerLine); kv('Emergency contact', cs.emergency);
  }
  if (inc.kit && (Object.keys(d.kit).length || d.hires.length)) {
    blocks.push({ type: 'heading', text: 'Kit' });
    if (Object.keys(d.kit).length) blocks.push({ type: 'text', text: Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join('  ·  ') });
    kv('Hires', d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '));
  }
  const notes = [];
  if (inc.sun && d.sun) notes.push({ type: 'kv', k: 'Golden hour', v: `ends ${fmtTime(d.sun.goldenHourEnd)}, from ${fmtTime(d.sun.goldenHour)}` });
  if (cs.weather) notes.push({ type: 'kv', k: 'Weather', v: cs.weather });
  if (cs.dress) notes.push({ type: 'kv', k: 'Dress code / bring', v: cs.dress });
  if (d.breaks) notes.push({ type: 'kv', k: 'Breaks', v: d.breaks });
  if (cs.notes) notes.push({ type: 'text', text: cs.notes });
  if (inc.notes && b.notes && b.notes !== cs.notes) notes.push({ type: 'text', text: b.notes });
  if (notes.length) blocks.push({ type: 'heading', text: 'Day notes' }, ...notes);
  return makePdf({ title: `Call sheet — ${b.title}`, blocks, footer: `Produced by ${d.producerLine} · Made with Vdex on ${new Date().toLocaleDateString()}` });
}

/* --------------------------------- printing --------------------------------- */
function ensurePrintCss() {
  if (document.getElementById('cs-print-css')) return;
  document.head.append(h('style', { id: 'cs-print-css' }, `#print-root{display:none}@media print{@page{margin:14mm}body.print-cs>*:not(#print-root){display:none!important}body.print-cs{background:#fff}body.print-cs #print-root{display:block}${docCss('#print-root ')}#print-root .cs-doc{padding:0;max-width:none}}`));
}
// Prints from the app itself: no pop-up window, so it works in the installed app and the desktop app too.
export function printCallSheet(b) {
  ensurePrintCss();
  const root = h('div', { id: 'print-root' }, renderDoc(b));
  document.body.append(root); document.body.classList.add('print-cs');
  let done = false;
  const finish = () => { if (done) return; done = true; root.remove(); document.body.classList.remove('print-cs'); window.removeEventListener('afterprint', finish); };
  window.addEventListener('afterprint', finish);
  setTimeout(() => { try { window.print(); } catch { finish(); toast('Printing is not available here; use Save PDF'); } }, 60);
  setTimeout(finish, 90000);
}

/* ---------------------------------- editing ---------------------------------- */
// Edits live in a draft until Done, so nothing re-renders under your fingers; the draft is saved if you leave the page.
const E = { id: null, draft: null, crewCall: null, changed: false };
export const isEditing = id => E.id != null && (id == null || E.id === id);
function startEdit(b) { E.id = b.id; E.draft = sheetOf(b); E.crewCall = { ...(b.crewCall || {}) }; E.changed = false; }
export function commitDraft() {
  if (!E.id) return false;
  const b = byId('bookings', E.id), changed = E.changed;
  if (b && changed) {
    const cs = { ...E.draft, schedule: E.draft.schedule.filter(r => r.time || r.item), version: (E.draft.version || 0) + 1, editedAt: Date.now() };
    upsert('bookings', { ...b, callSheet: cs, crewCall: E.crewCall });
    toast(`Call sheet saved (v${cs.version})`);
  }
  E.id = null; E.draft = null; E.crewCall = null; E.changed = false;
  return changed;
}
const cancelEdit = () => { E.id = null; E.draft = null; E.crewCall = null; E.changed = false; };
window.addEventListener('pagehide', () => commitDraft());

/* ------------------------------------ page ------------------------------------ */
function markSent(id) {
  const cur = byId('bookings', id); if (!cur) return;
  setCheck(cur, itemId('Prepped', 'Call sheet sent'), true);
  upsert('bookings', { ...byId('bookings', id), callSheet: { ...sheetOf(cur), sentAt: Date.now() } });
  toast('Marked: call sheet sent');
}
export function callSheetPage(b, go) {
  const editing = isEditing(b.id);
  if (E.id && E.id !== b.id) commitDraft(); // a draft left over from another shoot
  const redraw = () => { const y = window.scrollY; go({}); window.scrollTo(0, y); };
  const cs = sheetOf(b), state = sheetState(b);
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean), withEmail = crew.filter(c => c.email);
  const text = () => callSheetText(byId('bookings', b.id));
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: 'Call sheet — ' + b.title, text: text() }); markSent(b.id); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); markSent(b.id); } catch { toast('Select the text and copy it'); } };
  const pdf = async () => { try { const bytes = callSheetPdf(byId('bookings', b.id)); if (await saveOrShare(bytes, `call-sheet-${slug(b.title)}-${b.date}.pdf`, 'application/pdf')) { toast('PDF saved'); markSent(b.id); } } catch (e) { toast('Could not make the PDF: ' + (e.message || e)); } };
  const web = async () => { if (await saveOrShare(callSheetHtml(byId('bookings', b.id)), `call-sheet-${slug(b.title)}-${b.date}.html`, 'text/html')) markSent(b.id); };
  const emailHref = `mailto:${withEmail.map(c => c.email.trim()).join(',')}?` + new URLSearchParams({ subject: `Call sheet — ${b.title} — ${fmtShort(b.date)}`, body: text() }).toString().replace(/\+/g, '%20');
  return h('div', { class: 'cs-page' },
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => { commitDraft(); go({ view: 'booking', id: b.id }); } }, '‹ Booking'),
      editing
        ? h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { cancelEdit(); redraw(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { commitDraft(); redraw(); } }, '✓ Done'))
        : h('button', { class: 'btn primary', onclick: () => { startEdit(b); redraw(); } }, '✏️ Edit sheet')),
    h('h1', null, 'Call sheet'),
    h('div', { class: 'muted' }, `${b.title} · ${dateLabel(b, fmtShort)}`),
    h('div', { class: 'card-row' },
      h('p', { class: 'status-line', 'data-state': state === 'sent' ? 'synced' : state === 'changed' ? 'error' : '' }, `${state === 'sent' ? '✅' : state === 'changed' ? '⚠' : '📝'} ${STATE_LABEL[state]}${cs.sentAt ? ' · sent ' + new Date(cs.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}${cs.version ? ' · v' + cs.version : ''}`),
      !editing && state !== 'sent' && hasContent(cs) && h('button', { class: 'btn ghost small', onclick: () => markSent(b.id) }, 'Mark as sent')),
    editing
      ? h('p', { class: 'small muted' }, 'Change anything directly on the sheet: times, the schedule, who is on set, weather, the emergency contact, instructions, and each person’s call time. Done saves a new version.')
      : h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { printCallSheet(byId('bookings', b.id)); markSent(b.id); } }, '🖨 Print'),
        h('button', { class: 'btn ghost', onclick: pdf }, '📄 Save PDF'),
        h('a', { class: 'btn ghost', href: emailHref, onclick: () => markSent(b.id), title: withEmail.length ? `To: ${withEmail.length} crew member${withEmail.length === 1 ? '' : 's'}` : 'No crew email addresses yet' }, withEmail.length ? `✉ Email crew (${withEmail.length})` : '✉ Email'),
        h('button', { class: 'btn ghost small', onclick: share }, '📤 Share'),
        h('button', { class: 'btn ghost small', onclick: web }, '💾 Web page'),
        h('button', { class: 'btn ghost small', onclick: copy }, 'Copy text')),
    h('div', { class: 'cs-paper' + (editing ? ' editing' : '') }, renderDoc(b, editing ? { cs: E.draft, crewCall: E.crewCall, edit: { touch: () => { E.changed = true; }, redraw } } : {})),
    !editing && h('p', { class: 'small muted' }, 'The sheet is built from the booking, venue, crew, kit, hires and the sun for the day, plus what you add with Edit sheet. Print uses this device’s print dialog (save as PDF there too); Save PDF makes a file for the share sheet; Web page makes a file that opens on any phone.'));
}

/* ------------------------------------ list ------------------------------------ */
export function openCallSheets(onOpen) {
  const today = todayISO();
  const all = activeBookings().filter(b => b.status !== 'Archived');
  const upcoming = all.filter(b => endOf(b) >= today).sort((x, y) => x.date.localeCompare(y.date));
  const past = all.filter(b => endOf(b) < today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12);
  let close = () => {};
  const row = b => { const st = sheetState(b), cs = sheetOf(b); return h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onOpen(b); } },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [dateLabel(b, fmtShort), (cs.generalCall || b.start) && 'call ' + (cs.generalCall || b.start), (b.crew || []).length ? `${b.crew.length} crew` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'pill ' + (st === 'sent' ? 'st-confirmed' : st === 'changed' ? 'st-cancelled' : st === 'draft' ? 'st-enquiry' : '') }, STATE_LABEL[st]))); };
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'One call sheet per shoot, built in the app. Open one to fill in the schedule and details, then print it or send it to the crew. ✅ means it has gone out; ⚠ means it changed since.'),
    upcoming.length ? h('div', { class: 'list' }, ...upcoming.map(row)) : h('p', { class: 'muted' }, 'No upcoming shoots. Add a booking first.'),
    past.length ? h('details', { class: 'help' }, h('summary', null, `Past shoots (${past.length})`), h('div', { class: 'list' }, ...past.map(row))) : null);
  ({ close } = sheet('Call sheets', body));
}

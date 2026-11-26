// Call sheets, built in the app: one per shoot, edited directly on the document (times, schedule, who is on set,
// weather, emergency contact, instructions, each person's call time), then printed from the app, saved as a PDF or
// a web page, shared, or emailed to the whole crew. "Call sheets" on the Bookings page lists every shoot and whether
// its sheet has gone out.
import { h, toast, nodes, sheet, fmtLong, fmtShort, fmtTime, parseISO, todayISO, mapsUrl, uid, backBtn, shortHash } from './util.js';
import { db, byId, endOf, upsert, activeBookings, canChange, canChangeQuietly } from './store.js';
import { getTimes, sunClock } from './suncalc.js';
import { setCheck, itemId, hiredPeople, rentalsOf } from './workflow.js';
import { saveOrShare } from './backup.js';
import * as native from './native.js';
import { forecastLine } from './weather.js';
import { boardPlan, ieOf, dnOf, fmtEighths, castNumbers } from './board.js';

const INCLUDE = { kit: true, rules: true, sun: true, contacts: true, notes: true, scenes: true };
// A venue's rules, one per line, on one line: a space after a rule that ends a sentence, "; " after one that doesn't.
const ruleLine = text => String(text || '').split('\n').map(x => x.trim()).filter(Boolean).reduce((all, x) => (all ? all + (/[.!?;:]$/.test(all) ? ' ' : '; ') + x : x), '');
const BLANK = { generalCall: '', lunch: '', wrap: '', schedule: [], attendees: '', weather: '', dress: '', emergency: '', notes: '', version: 0, editedAt: 0, sentAt: 0 };
export const sheetOf = b => { const cs = { ...BLANK, ...(b.callSheet || {}) }; cs.include = { ...INCLUDE, ...(cs.include || {}) }; cs.schedule = Array.isArray(cs.schedule) ? cs.schedule.map(r => ({ ...r })) : []; return cs; };
const hasContent = cs => !!(cs.generalCall || cs.lunch || cs.wrap || cs.schedule.length || cs.attendees || cs.weather || cs.dress || cs.emergency || cs.notes);
// A sent sheet has changed when it was edited since, when the stripboard it shows the scenes from was, or when what
// it prints from the booking is no longer what went out (the date, the times, the address, the venue, the people and
// their call times, the kit…): marking it sent keeps a short mark of all of that (sentPrint below) to compare with.
// (When the stripboard's scenes were last changed: a restore stamps the board as changed now for the merge and keeps
// the time of the scenes beside it as editedAt; an edit on the stripboard writes the board anew, without one.)
// (And the two times are not set against each other when they need not be: a sheet marked sent keeps the stripboard's
// time of that moment as sentBoard. The board's time is the store's, which runs ahead of this device's clock while
// another device's clock does, and a sheet sent a minute after its scenes were arranged would read "changed".)
const boardTime = b => Number(b.board && (b.board.editedAt || b.board.updatedAt)) || 0;
export const sheetState = b => { const cs = sheetOf(b), boardAt = boardTime(b); return cs.sentAt ? (cs.editedAt > cs.sentAt || (cs.include.scenes !== false && boardAt > Math.max(cs.sentAt, Number(cs.sentBoard) || 0)) || (!!cs.sentHash && cs.sentHash !== sentPrint(b)) ? 'changed' : 'sent') : hasContent(cs) ? 'draft' : 'none'; };
const STATE_LABEL = { none: 'Not started', draft: 'Draft', sent: 'Sent', changed: 'Changed since it was sent' };
const dateLabel = (b, f = fmtLong) => (endOf(b) > b.date ? `${f(b.date)} → ${f(endOf(b))}` : f(b.date));
const multiDay = b => endOf(b) > b.date;
// The stripboard's shooting days that have scenes, for the call sheet's Scenes section (banners are left out).
export function sceneDays(b) {
  const plan = boardPlan(b);
  const days = plan.days.map(d => ({ ...d, scenes: d.items.filter(x => x.type === 'scene') })).filter(d => d.scenes.length);
  const used = [...new Set(days.flatMap(d => d.scenes.flatMap(x => x.cast)))];
  return { days, cast: plan.cast, castLine: plan.cast.map((n, i) => used.includes(n) ? `${i + 1} ${n}` : '').filter(Boolean).join(' · ') };
}
// A day label goes on unless it is plainly the shoot's one day (day 1, with its date).
const needsDayLabel = (sd, multi) => sd.days.length > 1 || multi || sd.days[0].n !== 1 || !sd.days[0].date;
const sceneDayLabel = d => `Day ${d.n}${d.date ? ' · ' + fmtLong(d.date) : ''} · ${fmtEighths(d.eighths)} page${d.eighths === 8 ? '' : 's'}`;
const sceneRow = (x, cast) => [x.scene, ieOf(x), [x.set, x.desc].filter(Boolean).join(' — '), x.tod || dnOf(x).toUpperCase(), castNumbers(x.cast, cast).join(', '), fmtEighths(x.eighths)];
const slug = s => String(s || 'shoot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/* ----------------------------------- data ----------------------------------- */
export function callSheetData(b, cs = sheetOf(b), crewCall = b.crewCall || {}) {
  const p = db.profile, v = b.venueId ? byId('venues', b.venueId) : null;
  // Your own crew and the people hired for this job, in one list: both get a call time and go on the sheet and the crew link.
  // Someone who has declined the job is on neither, and is not written to.
  const crew = [...(b.crew || []).map(id => byId('crew', id)).filter(Boolean), ...hiredPeople(b).map(hr => ({ id: hr.id, name: hr.name, role: hr.role, phone: hr.phone, email: hr.email, hired: true }))].filter(c => (b.crewStatus || {})[c.id] !== 'declined').map(c => ({ ...c, call: crewCall[c.id] || cs.generalCall || b.start || '' }));
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const kit = {}; gear.forEach(g => { const c = g.category || 'Other'; kit[c] = (kit[c] || 0) + Math.max(1, Number((b.gearQty || {})[g.id]) || 1); });
  const atVenue = !!(v && v.geo && Number.isFinite(Number(v.geo.lat)));
  let loc = null; try { loc = atVenue ? { lat: +v.geo.lat, lon: +v.geo.lon } : JSON.parse(localStorage.getItem('logi-loc')); } catch { /* none */ }
  const noon = new Date(parseISO(b.date).getTime() + 12 * 36e5), sun = loc ? getTimes(noon, loc.lat, loc.lon) : null;
  // The sun times are on this device's clock; at a venue on another clock they name their zone (sunClock).
  const clock = sun && atVenue ? sunClock(noon, loc.lon) : { far: false, zone: '', fmt: fmtTime };
  const address = (b.address || (v && v.address) || '').replace(/\n/g, ', ');
  // A line belongs to the day it names, also a day outside the shoot (a pre-light the evening before, a pick-up day
  // after it: the editor's date box takes any day, and the sheet prints what that box shows; a sheet that went out
  // with such a line goes on printing it there). A line with no date belongs to the first day, and on a one-day shoot
  // no line has a date at all, so every line is printed. (Moving the shoot in its form moves the lines with it.)
  const multi = multiDay(b), dayOfLine = r => (!multi ? '' : /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : b.date);
  const schedule = cs.schedule.filter(r => r && (r.time || r.item)).map(r => ({ ...r, date: dayOfLine(r) })).sort((x, y) => `${x.date} ${x.time || ''}`.localeCompare(`${y.date} ${y.time || ''}`));
  const days = multi ? [...new Set([b.date, ...schedule.map(r => r.date)])].sort() : [b.date];
  const producer = [p.name, p.business].filter(Boolean).join(' · ') || 'Vdex';
  const producerLine = `${producer}${p.phone ? ' · ' + p.phone : ''}${p.email ? ' · ' + p.email : ''}`;
  return { b, p, v, cs, crew, kit, hires: rentalsOf(b), sun, sunTime: clock.fmt, sunZone: clock.far ? clock.zone : '', atVenue, loc, address, schedule, days, producer, producerLine, generalCall: cs.generalCall || b.start || '', wrap: cs.wrap || b.end || '', breaks: [b.breakMinutes && b.breakMinutes + ' min approved', b.breakNote].filter(Boolean).join(' · ') };
}
// What a sheet shows of the booking and everything it draws on, as one short mark that is the same on every device
// (no times or dates as a device writes them, and not the device's own location): kept when the sheet is marked sent.
function sentPrint(b) {
  const d = callSheetData(b), { cs, v } = d, inc = cs.include, sd = inc.scenes !== false ? sceneDays(b) : null;
  return shortHash(JSON.stringify([b.title, b.client, b.date, endOf(b), d.generalCall, cs.lunch, d.wrap, d.address, d.breaks, d.producerLine,
    v ? [v.name, v.access, v.parking, v.power, v.hospital, inc.rules !== false && v.rules, inc.sun !== false && d.atVenue && [d.loc.lat, d.loc.lon]] : 0,
    d.schedule.map(r => [r.date, r.time, r.item]), d.crew.map(c => [c.name, c.role, c.call, c.phone, c.email]),
    inc.contacts !== false && [(b.stakeholders || []).map(s => [s.name, s.role, s.phone]), cs.attendees, cs.emergency],
    inc.kit !== false && [Object.entries(d.kit), d.hires.map(x => [x.item, x.from])], cs.weather, cs.dress, cs.notes, inc.notes !== false && b.notes,
    sd && sd.days.map(dd => [dd.n, dd.date, dd.eighths, dd.scenes.map(x => sceneRow(x, sd.cast))])]));
}

/* ----------------------------------- text ----------------------------------- */
const line = (k, v) => (v ? `${k}: ${v}` : null);
export function callSheetText(b) {
  const d = callSheetData(b), { cs, v } = d, inc = cs.include, sd = sceneDays(b), T = d.sunTime;
  const sched = d.schedule.map(r => `${multiDay(b) && r.date ? fmtShort(r.date) + ' ' : ''}${r.time || '—'}  ${r.item || ''}`.trim());
  // A section's lines, and the blank line after it, are there only when the section is: every test is a plain yes or
  // no, so an empty answer never leaves a blank line of its own behind.
  const people = inc.contacts ? (b.stakeholders || []).map(s => [s.name, s.role, s.phone].filter(Boolean).join(' · ')).filter(Boolean) : [];
  const sun = !!(inc.sun && d.sun), contacts = people.length > 0 || !!(inc.contacts && cs.attendees), kitN = inc.kit ? Object.keys(d.kit).length : 0, rented = inc.kit ? d.hires : [], notes = !!(cs.notes || (inc.notes && b.notes));
  const out = [
    `CALL SHEET — ${b.title}${b.client ? ' (' + b.client + ')' : ''}`,
    dateLabel(b) + (cs.version ? `  ·  v${cs.version}` : ''),
    line('General call', d.generalCall), line('Lunch', cs.lunch), line('Wrap (planned)', d.wrap),
    '',
    'LOCATION',
    v && line('Venue', v.name), line('Address', d.address), v && line('Access', v.access), v && line('Parking', v.parking), v && line('Power', v.power), v && line('Nearest hospital', v.hospital),
    inc.rules && v && (v.rules || '').trim() ? 'Venue rules: ' + ruleLine(v.rules) : null,
    line('Breaks', d.breaks),
    '',
    sched.length > 0 && 'SCHEDULE', ...sched, sched.length > 0 && '',
    sun && 'SUN', sun && `Sunrise ${T(d.sun.sunrise)} · Golden hour ends ${T(d.sun.goldenHourEnd)} · Golden hour from ${T(d.sun.goldenHour)} · Sunset ${T(d.sun.sunset)}${d.sunZone ? ` (${d.sunZone}, not the venue’s local time)` : ''}`,
    line('Weather', cs.weather), (sun || !!cs.weather) && '',
    'CREW',
    ...(d.crew.length ? d.crew.map(c => `${c.name} — ${c.role || 'crew'}${c.call ? ' · call ' + c.call : ''}${c.phone ? ' · ' + c.phone : ''}${c.email ? ' · ' + c.email : ''}`) : ['(no crew assigned)']),
    '',
    contacts && 'ON SET / CONTACTS', ...people, inc.contacts && cs.attendees ? cs.attendees : null, contacts && '',
    (kitN > 0 || rented.length > 0) && 'KIT', kitN > 0 && Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · '),
    rented.length > 0 && 'Rented: ' + rented.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '),
    (kitN > 0 || rented.length > 0) && '',
    line('Dress code / bring', cs.dress), line('Emergency contact', cs.emergency), !!(cs.dress || cs.emergency) && '',
    notes && 'NOTES', cs.notes || null, inc.notes && b.notes && b.notes !== cs.notes ? b.notes : null, notes && '',
    // The scenes come last, so the crew, contacts and emergency details come first in a long email.
    ...(inc.scenes && sd.days.length ? ['SCENES', ...sd.days.flatMap(dd => [sceneDayLabel(dd), ...dd.scenes.map(x => { const r = sceneRow(x, sd.cast); return `Sc ${r[0] || '—'}  ${r[1]}  ${r[2]} — ${r[3]}  ${r[5]} pg${r[4] ? '  Cast ' + r[4] : ''}`; })]), sd.castLine ? 'Cast: ' + sd.castLine : null, ''] : []),
    'Produced by ' + d.producerLine,
  ].filter(x => x !== null && x !== false && x !== undefined && x !== 0);
  return out.filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n'); // one blank line between sections, never a run of them
}

/* --------------------------------- document --------------------------------- */
// The crew page's notice (js/crew-page.js), printed at the foot of the call sheet and its PDF as well: the producer
// chose what is on it, and nobody has checked it.
export const CHECK_NOTICE = 'The times, places, weather, sun times and emergency details here were entered or chosen by the producer. Vdex has not checked them and they may be out of date. Confirm with the producer.';
// One DOM for the in-app page, the print view and the saved web page. In edit mode the editable spots become inputs.
export function renderDoc(b, { cs = sheetOf(b), crewCall = b.crewCall || {}, edit = null } = {}) {
  const d = callSheetData(b, cs, crewCall), { v, p } = d, inc = cs.include, multi = multiDay(b);
  const sec = (title, ...kids) => { const body = nodes(...kids); return body.length ? h('section', { class: 'cs-sec' }, h('h4', null, title), ...body) : null; };
  const kv = (k, val) => val && h('div', { class: 'cs-kv' }, h('span', null, k), h('b', null, val));
  const table = (head, rows, free = []) => rows.length > 0 && h('table', null, h('thead', null, h('tr', null, ...head.map(x => h('th', null, x)))), h('tbody', null, ...rows.map(r => h('tr', null, ...r.map((x, i) => h('td', free.includes(i) ? { class: 'free' } : null, x == null ? '' : x)))))); // free: the columns whose cells may wrap inside a word (styles.css)
  const bind = (key, el) => { el.addEventListener('change', e => { cs[key] = e.target.value; edit.touch(); }); return el; };
  const input = (key, type, ph) => bind(key, h('input', { type, value: cs[key] || '', placeholder: ph, 'aria-label': ph, class: 'cs-in' }));
  const area = (key, ph, rows = 2) => bind(key, h('textarea', { rows, value: cs[key] || '', placeholder: ph, 'aria-label': ph, class: 'cs-in' }));
  const timeBox = (label, val, key) => (edit && key) ? h('div', { class: 'cs-time' }, h('span', null, label), input(key, 'time', label)) : val && h('div', { class: 'cs-time' }, h('span', null, label), h('b', null, val));
  const include = key => !edit && inc[key] === false ? false : true; // in edit mode everything shows, with a toggle
  const toggle = (key, label) => h('label', { class: 'cs-toggle' }, h('input', { type: 'checkbox', checked: inc[key] !== false, onchange: e => { cs.include[key] = e.target.checked; edit.touch(); } }), label);
  const scheduleRows = day => d.schedule.filter(r => (r.date || b.date) === day).map(r => [r.time || '—', r.item || '']);
  const T = d.sunTime; // the sun's times: with their zone where the venue is on another clock
  // Children are given as yes-or-no tests (x.length > 0 && …): a bare count of 0 would be printed as "0".
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
      h('div', { class: 'cs-when' }, h('b', null, dateLabel(b, fmtShort)), h('div', null, cs.version ? `Version ${cs.version}` : cs.sentAt ? '' : 'Draft'))), // a sheet sent as it was built has no version, and is no draft
    h('h2', null, b.title), b.client && h('div', { class: 'cs-sub' }, b.client),
    edit && h('div', { class: 'cs-include' }, h('span', { class: 'cs-hint' }, 'Include:'), toggle('scenes', 'Scenes'), toggle('sun', 'Sun'), toggle('rules', 'Venue rules'), toggle('contacts', 'Contacts'), toggle('kit', 'Kit'), toggle('notes', 'Booking notes')),
    h('div', { class: 'cs-times' }, timeBox('General call', d.generalCall, 'generalCall'), timeBox('Lunch', cs.lunch, 'lunch'), timeBox('Wrap', d.wrap, 'wrap'), include('sun') && d.sun && timeBox('Sunrise', T(d.sun.sunrise)), include('sun') && d.sun && timeBox('Sunset', T(d.sun.sunset))),
    sec('Location', v && kv('Venue', v.name), kv('Address', d.address), v && kv('Access', v.access), v && kv('Parking', v.parking), v && kv('Power', v.power), v && kv('Nearest hospital', v.hospital),
      include('rules') && v && (v.rules || '').trim() && kv('Venue rules', ruleLine(v.rules)),
      d.address && h('div', { class: 'cs-kv' }, h('span', null, 'Map'), h('a', { href: mapsUrl(d.address), target: '_blank', rel: 'noopener noreferrer' }, mapsUrl(d.address)))),
    edit ? sec('Schedule', scheduleEditor()) : d.schedule.length ? sec('Schedule', ...d.days.map(day => { const rows = scheduleRows(day); return rows.length > 0 && [multi && h('div', { class: 'cs-day' }, fmtLong(day)), table(['Time', 'What'], rows)]; })) : null,
    include('scenes') && (sd => sd.days.length ? sec('Scenes', ...sd.days.map(dd => [needsDayLabel(sd, multi) && h('div', { class: 'cs-day' }, sceneDayLabel(dd)), table(['Sc', 'I/E', 'Set', 'Time', 'Cast', 'Pages'], dd.scenes.map(x => sceneRow(x, sd.cast)))]),
      sd.castLine && kv('Cast', sd.castLine), edit && h('p', { class: 'cs-hint' }, 'From the stripboard: arrange the scenes there.')) : null)(sceneDays(b)),
    sec('Crew', d.crew.length ? table(['Name', 'Role', 'Call', 'Phone', 'Email'], d.crew.map(c => [c.name, c.role || 'crew', crewCell(c), c.phone, c.email]), [3, 4]) : h('p', null, 'No crew assigned yet. Add people on the booking and they appear here with their call times.'),
      edit && d.crew.length > 0 && h('p', { class: 'cs-hint' }, 'A blank call time means the general call.')),
    include('contacts') && sec('On set / contacts', (b.stakeholders || []).length > 0 && table(['Name', 'Role', 'Phone'], b.stakeholders.map(s => [s.name, s.role, s.phone])),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'On set'), area('attendees', 'Who is coming from the client or talent, when, and who looks after them')) : cs.attendees && h('p', { class: 'cs-pre' }, cs.attendees),
      kv('Producer', d.producerLine),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Emergency'), input('emergency', 'text', 'Emergency contact on the day: name · phone')) : kv('Emergency contact', cs.emergency)),
    include('kit') && sec('Kit', Object.keys(d.kit).length > 0 && h('p', null, Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · ')), d.hires.length > 0 && kv('Rented', d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '))),
    sec('Day notes', include('sun') && d.sun && kv('Golden hour', `ends ${T(d.sun.goldenHourEnd)}, from ${T(d.sun.goldenHour)}${d.sunZone ? ` (sun times in ${d.sunZone}, not the venue’s local time)` : ''}`),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Weather'), input('weather', 'text', 'e.g. 14°C, showers from 3pm — bring rain covers')) : kv('Weather', cs.weather),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Dress / bring'), input('dress', 'text', 'e.g. All black, sturdy boots, hi-vis for the yard')) : kv('Dress code / bring', cs.dress),
      d.breaks && kv('Breaks', d.breaks),
      edit ? h('div', { class: 'cs-kv' }, h('span', null, 'Instructions'), area('notes', 'Parking passes, radio channels, quiet zones, release forms, catering…', 3)) : cs.notes && h('p', { class: 'cs-pre' }, cs.notes),
      include('notes') && b.notes && b.notes !== cs.notes && h('p', { class: 'cs-pre' }, b.notes)),
    h('footer', { class: 'cs-foot' }, `Produced by ${d.producerLine} · Made with Vdex on ${new Date().toLocaleDateString()}`, !edit && h('div', { class: 'cs-check' }, CHECK_NOTICE)));
}

// The document's own styles: used as-is in the saved web page, and scoped under #print-root for printing from the app.
import { docCss, docPrintCss } from './doc-css.js';
export { docCss };
const escHtml = s => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
export const htmlDocument = (title, el) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title)}</title><style>${docCss('')}\n${docPrintCss}</style></head><body>${el.outerHTML}</body></html>`;
export const callSheetHtml = b => htmlDocument(`Call sheet — ${b.title}`, renderDoc(b));

/* ------------------------------------ PDF ------------------------------------ */
export async function callSheetPdf(b) {
  const { makePdf } = await import('./pdf.js'); // loaded on demand
  const d = callSheetData(b), { cs, v } = d, inc = cs.include, blocks = [];
  const kv = (k, val) => { if (val) blocks.push({ type: 'kv', k, v: val }); };
  blocks.push({ type: 'title', text: b.title }, { type: 'subtitle', text: [b.client, dateLabel(b), cs.version ? `Version ${cs.version}` : cs.sentAt ? '' : 'Draft'].filter(Boolean).join('   ·   ') });
  blocks.push({ type: 'times', items: [['General call', d.generalCall], ['Lunch', cs.lunch], ['Wrap', d.wrap], inc.sun && d.sun && ['Sunrise', d.sunTime(d.sun.sunrise)], inc.sun && d.sun && ['Sunset', d.sunTime(d.sun.sunset)]].filter(Boolean) });
  blocks.push({ type: 'heading', text: 'Location' });
  if (v) kv('Venue', v.name); kv('Address', d.address); if (v) { kv('Access', v.access); kv('Parking', v.parking); kv('Power', v.power); kv('Nearest hospital', v.hospital); if (inc.rules && (v.rules || '').trim()) kv('Venue rules', ruleLine(v.rules)); }
  if (d.address) kv('Map', mapsUrl(d.address));
  if (d.schedule.length) {
    blocks.push({ type: 'heading', text: 'Schedule' });
    for (const day of d.days) { const rows = d.schedule.filter(r => (r.date || b.date) === day).map(r => [r.time || '—', r.item || '']); if (!rows.length) continue; if (multiDay(b)) blocks.push({ type: 'text', text: fmtLong(day), bold: true }); blocks.push({ type: 'table', head: ['Time', 'What'], rows, widths: [0.16, 0.84] }); }
  }
  const sd = sceneDays(b);
  if (inc.scenes && sd.days.length) {
    blocks.push({ type: 'heading', text: 'Scenes' });
    for (const dd of sd.days) { if (needsDayLabel(sd, multiDay(b))) blocks.push({ type: 'text', text: sceneDayLabel(dd), bold: true }); blocks.push({ type: 'table', head: ['Sc', 'I/E', 'Set', 'Time', 'Cast', 'Pages'], rows: dd.scenes.map(x => sceneRow(x, sd.cast)), widths: [0.07, 0.08, 0.5, 0.13, 0.12, 0.1] }); }
    if (sd.castLine) kv('Cast', sd.castLine);
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
    kv('Rented', d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '));
  }
  const notes = [];
  if (inc.sun && d.sun) notes.push({ type: 'kv', k: 'Golden hour', v: `ends ${d.sunTime(d.sun.goldenHourEnd)}, from ${d.sunTime(d.sun.goldenHour)}${d.sunZone ? ` (sun times in ${d.sunZone}, not the venue’s local time)` : ''}` });
  if (cs.weather) notes.push({ type: 'kv', k: 'Weather', v: cs.weather });
  if (cs.dress) notes.push({ type: 'kv', k: 'Dress code / bring', v: cs.dress });
  if (d.breaks) notes.push({ type: 'kv', k: 'Breaks', v: d.breaks });
  if (cs.notes) notes.push({ type: 'text', text: cs.notes });
  if (inc.notes && b.notes && b.notes !== cs.notes) notes.push({ type: 'text', text: b.notes });
  if (notes.length) blocks.push({ type: 'heading', text: 'Day notes' }, ...notes);
  blocks.push({ type: 'space', h: 10 }, { type: 'text', text: CHECK_NOTICE, size: 8, gray: 0.35 });
  return makePdf({ title: `Call sheet — ${b.title}`, blocks, footer: `Produced by ${d.producerLine} · Made with Vdex on ${new Date().toLocaleDateString()}` });
}

/* --------------------------------- printing --------------------------------- */
function ensurePrintCss() {
  if (document.getElementById('cs-print-css')) return;
  document.head.append(h('style', { id: 'cs-print-css' }, `#print-root{display:none}@media print{@page{margin:14mm}body.print-cs>*:not(#print-root){display:none!important}body.print-cs{background:#fff}body.print-cs #print-root{display:block}${docCss('#print-root ')}#print-root .cs-doc{padding:0;max-width:none}#print-root .pay-btn::after{content:" " attr(href);font-weight:400;font-size:11px;word-break:break-all}}`)); // on paper a Pay button is followed by its address, as on the client's page and the saved web page
}
// Prints from the app itself: no pop-up window, so it works in the installed app and the desktop app too.
export function printCallSheet(b) { printElement(renderDoc(b)); }
export function printElement(el) {
  ensurePrintCss();
  const root = h('div', { id: 'print-root' }, el);
  document.body.append(root); document.body.classList.add('print-cs');
  let done = false;
  const finish = () => { if (done) return; done = true; root.remove(); document.body.classList.remove('print-cs'); window.removeEventListener('afterprint', finish); };
  window.addEventListener('afterprint', finish);
  if (native.isApp) { setTimeout(() => native.files.print().catch(() => toast('Printing is not available here; use Save PDF')).finally(finish), 60); }
  else setTimeout(() => { try { window.print(); } catch { finish(); toast('Printing is not available here; use Save PDF'); } }, 60);
  setTimeout(finish, 90000);
}

/* ---------------------------------- editing ---------------------------------- */
// Edits live in a draft until Done, so nothing re-renders under your fingers; the draft is saved if you leave the page.
const E = { id: null, draft: null, crewCall: null, changed: false, before: null };
export const isEditing = id => E.id != null && (id == null || E.id === id);
function startEdit(b) { E.id = b.id; E.draft = sheetOf(b); E.crewCall = { ...(b.crewCall || {}) }; E.changed = false; E.before = null; }
export function commitDraft() {
  if (!E.id) return false;
  const b = byId('bookings', E.id), changed = E.changed;
  if (b && changed) {
    const cs = { ...E.draft, schedule: E.draft.schedule.filter(r => r.time || r.item), version: (E.draft.version || 0) + 1, editedAt: Date.now() };
    upsert('bookings', { ...b, callSheet: cs, crewCall: E.crewCall });
    toast(`Call sheet saved (v${cs.version})`);
  }
  E.id = null; E.draft = null; E.crewCall = null; E.changed = false; E.before = null;
  return changed;
}
// Cancel discards the edit, also the part of it that was saved when Vdex went to the background meanwhile.
const cancelEdit = () => { const b = E.before && byId('bookings', E.id); if (b && canChangeQuietly()) upsert('bookings', { ...b, callSheet: E.before.callSheet, crewCall: E.before.crewCall }); E.id = null; E.draft = null; E.crewCall = null; E.changed = false; E.before = null; };
window.addEventListener('pagehide', () => commitDraft());
// A phone ends a page in the background without another word (no pagehide), so what has been typed so far is also
// saved the moment Vdex goes to the background, as a new version, and the editing carries on if it comes back.
// Registered as the module loads, ahead of the lock's own listener, which seals the store when the page is hidden.
function saveDraftNow() {
  const b = E.id && E.changed ? byId('bookings', E.id) : null; if (!b || !canChangeQuietly()) return;
  const cs = { ...E.draft, schedule: E.draft.schedule.filter(r => r.time || r.item).map(r => ({ ...r })), version: (E.draft.version || 0) + 1, editedAt: Date.now() };
  const before = E.before || { callSheet: b.callSheet, crewCall: b.crewCall }; // what Cancel goes back to
  if (upsert('bookings', { ...b, callSheet: cs, crewCall: { ...E.crewCall } }) === false) return;
  E.before = before; E.draft.version = cs.version; E.changed = false; // Done after this adds a version only if something more was changed
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveDraftNow(); });

/* ------------------------------------ page ------------------------------------ */
// quiet: a side effect of printing, saving or sending, which still happen when Vdex is read-only (only the mark is
// skipped); the Mark as sent button itself is a change like any other, and says so.
function markSent(id, quiet = true) {
  if (!(quiet ? canChangeQuietly() : canChange())) return;
  const cur = byId('bookings', id); if (!cur) return;
  setCheck(cur, itemId('Prepped', 'Call sheet sent'), true);
  upsert('bookings', { ...byId('bookings', id), callSheet: { ...sheetOf(cur), sentAt: Date.now(), sentBoard: boardTime(byId('bookings', id)), sentHash: sentPrint(byId('bookings', id)) } });
  toast('Marked: call sheet sent');
}
export function callSheetPage(b, go) {
  const editing = isEditing(b.id);
  if (E.id && E.id !== b.id) commitDraft(); // a draft left over from another shoot
  const redraw = () => { const y = window.scrollY; go({}); window.scrollTo(0, y); };
  const cs = sheetOf(b), state = sheetState(b);
  const withEmail = callSheetData(b).crew.filter(c => c.email);
  const text = () => callSheetText(byId('bookings', b.id));
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: 'Call sheet — ' + b.title, text: text() }); markSent(b.id); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); markSent(b.id); } catch { toast('Select the text and copy it'); } };
  const pdf = async () => { try { const bytes = await callSheetPdf(byId('bookings', b.id)); if (await saveOrShare(bytes, `call-sheet-${slug(b.title)}-${b.date}.pdf`, 'application/pdf')) { toast('PDF saved'); markSent(b.id); } } catch (e) { toast('Could not make the PDF: ' + (e.message || e)); } };
  const web = async () => { if (await saveOrShare(callSheetHtml(byId('bookings', b.id)), `call-sheet-${slug(b.title)}-${b.date}.html`, 'text/html')) markSent(b.id); };
  // A long sheet (many scenes) does not fit in an email link (some mail apps stop at about 2,000 characters): the text
  // is copied instead, to be pasted into the email.
  const mailto = body => `mailto:${withEmail.map(c => c.email.trim()).join(',')}?` + new URLSearchParams({ subject: `Call sheet — ${b.title} — ${fmtShort(b.date)}`, body }).toString().replace(/\+/g, '%20');
  const fullHref = mailto(text()), longMail = fullHref.length > 1700;
  const emailHref = longMail ? mailto('The call sheet is copied: paste it here.\n\n') : fullHref;
  const emailClick = () => { if (longMail) { const w = navigator.clipboard && navigator.clipboard.writeText(text()); if (w) w.then(() => toast('The call sheet is long, so it was copied: paste it into the email'), () => toast('Use Copy text, then paste it into the email')); else toast('Use Copy text, then paste it into the email'); } markSent(b.id); };
  return h('div', { class: 'cs-page' },
    h('div', { class: 'page-head' },
      backBtn('Booking', () => { commitDraft(); go({ view: 'booking', id: b.id }); }),
      editing
        ? h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => { cancelEdit(); redraw(); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { commitDraft(); redraw(); } }, '✓ Done'))
        : h('button', { class: 'btn primary', onclick: () => { startEdit(b); redraw(); } }, '✏️ Edit sheet')),
    h('h1', null, 'Call sheet'),
    h('div', { class: 'muted' }, `${b.title} · ${dateLabel(b, fmtShort)}`),
    h('div', { class: 'card-row' },
      h('p', { class: 'status-line', 'data-state': state === 'sent' ? 'synced' : state === 'changed' ? 'error' : '' }, `${state === 'sent' ? '✅' : state === 'changed' ? '⚠' : '📝'} ${STATE_LABEL[state]}${cs.sentAt ? ' · sent ' + new Date(cs.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}${cs.version ? ' · v' + cs.version : ''}`),
      !editing && state !== 'sent' && hasContent(cs) && h('button', { class: 'btn ghost small', onclick: () => markSent(b.id, false) }, 'Mark as sent')),
    !editing && forecastLine(callSheetData(b).loc, b.date, { onUse: txt => { const cur = byId('bookings', b.id); upsert('bookings', { ...cur, callSheet: { ...sheetOf(cur), weather: txt, editedAt: Date.now() } }); toast('Forecast added to the sheet'); } }),
    editing
      ? h('p', { class: 'small muted' }, 'Change anything directly on the sheet: times, the schedule, who is on set, weather, the emergency contact, instructions, and each person’s call time. Done saves a new version.')
      : h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => { printCallSheet(byId('bookings', b.id)); markSent(b.id); } }, '🖨 Print'),
        h('button', { class: 'btn ghost', onclick: pdf }, '📄 Save PDF'),
        h('a', { class: 'btn ghost', href: emailHref, onclick: emailClick, title: withEmail.length ? `To: ${withEmail.length} crew member${withEmail.length === 1 ? '' : 's'}` : 'No crew email addresses yet' }, withEmail.length ? `✉ Email crew (${withEmail.length})` : '✉ Email'),
        h('button', { class: 'btn ghost small', onclick: share }, '📤 Share'),
        h('button', { class: 'btn ghost small', onclick: web }, '💾 Web page'),
        h('button', { class: 'btn ghost small', onclick: copy }, 'Copy text')),
    h('div', { class: 'cs-paper' + (editing ? ' editing' : '') }, renderDoc(b, editing ? { cs: E.draft, crewCall: E.crewCall, edit: { touch: () => { E.changed = true; }, redraw } } : {})),
    !editing && h('p', { class: 'small muted' }, 'The sheet is built from the booking, venue, crew and hired people, kit, rentals and the sun for the day, plus what you add with Edit sheet. Print uses this device’s print dialog (save as PDF there too); Save PDF makes a file for the share sheet; Web page makes a file that opens on any phone.'));
}

/* ------------------------------------ list ------------------------------------ */
export function openCallSheets(onOpen) {
  const today = todayISO();
  const all = activeBookings().filter(b => b.status !== 'Archived');
  const upcoming = all.filter(b => endOf(b) >= today).sort((x, y) => x.date.localeCompare(y.date));
  const past = all.filter(b => endOf(b) < today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12);
  let close = () => {};
  const row = b => { const st = sheetState(b), cs = sheetOf(b); return h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onOpen(b); } },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [dateLabel(b, fmtShort), (cs.generalCall || b.start) && 'call ' + (cs.generalCall || b.start), ((b.crew || []).length + hiredPeople(b).length) ? `${(b.crew || []).length + hiredPeople(b).length} crew` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'pill ' + (st === 'sent' ? 'st-confirmed' : st === 'changed' ? 'st-cancelled' : st === 'draft' ? 'st-enquiry' : '') }, STATE_LABEL[st]))); };
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'One call sheet per shoot, built in the app. Open one to fill in the schedule and details, then print it or send it to the crew. ✅ means it has gone out; ⚠ means it changed since.'),
    upcoming.length ? h('div', { class: 'list' }, ...upcoming.map(row)) : h('p', { class: 'muted' }, 'No upcoming shoots. Add a booking first.'),
    past.length ? h('details', { class: 'help' }, h('summary', null, `Past shoots (${past.length})`), h('div', { class: 'list' }, ...past.map(row))) : null);
  ({ close } = sheet('Call sheets', body));
}

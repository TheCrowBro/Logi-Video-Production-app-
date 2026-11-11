// The day sheet document, drawn from one plain data object. The app builds that object from a booking (js/daysheet.js)
// and the band's page unpacks it from a link (js/daysheet-page.js); both clean it with cleanDaySheet and draw it with
// renderDaySheet, so the preview, the printout, the saved web page, the text for a chat and the link all say the same.
// Pure: nothing here reads the store or needs the app shell, so daysheet.html loads it on its own.
//
// The data (version 1). Only these fields exist; cleanDaySheet drops anything else. There is no field for money of any
// kind: no deal, fee, ticket price, settlement, budget, rate, value or invoice can travel in a day sheet.
//   { v: 1, kind: 'show'|'session'|'rehearsal'|'other', ref, made, title, act, date, endDate, slot,
//     from: { name, business, phone, email },                           who sent it
//     times: [{ k: 'loadIn'|'soundcheck'|'doors'|'setTime'|'offStage'|'curfew'|'start'|'end', t: 'HH:MM', n: 0|1 }],
//            in the order the day runs; n = 1 for a time after midnight
//     place: { name, address, geo: { lat, lon }|null, loadIn, parking, stage, pa, noise },
//     running: [{ time, act, len, ours, n }],  people: [{ name, role, phone, email }],  contacts: [same],
//     setlist: { name, rows: [{ t, key, len, segue, encore, note } | { brk: true, t }], total, songs, missing }|null,
//     songs: [{ t, key, bpm, len }],  due: [{ t, due, done }],  gear: [{ name, qty, who }],  provided,
//     hospitality, accommodation, guests: { count, cap, names: [{ name, plus }] }|null, notes }
// Lengths travel already formatted ('3:34', '45m'), so this file needs no music maths. In a link the lists travel as
// short rows without field names (toLink / fromLink), so a typical show's link fits in an email.
import { h, nodes, fmtLong, fmtShort, telUrl, parseISO } from './util.js';
import { googleUrl } from './map.js';

export const TIME_LABELS = { loadIn: 'Load-in', soundcheck: 'Soundcheck', doors: 'Doors', setTime: 'On stage', offStage: 'Off stage', curfew: 'Curfew', start: 'Start', end: 'Finish' };
const KINDS = ['show', 'session', 'rehearsal', 'other'];
const TYPE = { show: 'Show', session: 'Studio session', rehearsal: 'Rehearsal', other: 'Booking' };
const PLACE = { show: 'Venue', session: 'Studio', rehearsal: 'Rehearsal room', other: 'Where' };
const HAS = { show: 'Venue provides', session: 'Studio has', rehearsal: 'Room has', other: 'Already there' };
const LINEUP = { show: 'Line-up', session: 'People', rehearsal: 'Line-up', other: 'People' };
const SONGS = { show: 'Songs', session: 'Songs we’re working on', rehearsal: 'Songs to rehearse', other: 'Songs' };
export const EMAIL = /^[^\s@,;?&#<>"'()]+@[^\s@,;?&#<>"'()]+\.[^\s@,;?&#<>"'()]+$/;
const TIME = /^(\d{1,2}):(\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------- order of the day ------------------------------- */
const minutes = t => { const m = TIME.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// Times in the order a day runs. items come in the order things happen (load-in, soundcheck, doors, on stage, off
// stage, curfew; or a running order as typed). A morning time that comes after an afternoon or evening one is after
// midnight: it is marked n = 1 and placed after the evening. Then everything is sorted by that, so a soundcheck typed
// before load-in still reads right. An item with no time stays just after the one before it.
export function nightOrder(items, key = 't') {
  let evening = -1;
  const keyed = items.map((x, i) => {
    const m = minutes(x[key]);
    if (m == null) return { x: { ...x, n: 0 }, k: null, i };
    const n = m < 720 && evening >= 720 ? 1 : 0;
    if (!n && m >= 720) evening = Math.max(evening, m);
    return { x: { ...x, n }, k: n * 1440 + m, i };
  });
  let prev = -1;
  keyed.forEach(o => { if (o.k == null) o.k = prev + 0.001; prev = o.k; });
  return keyed.sort((a, b) => a.k - b.k || a.i - b.i).map(o => o.x);
}

/* ------------------------------- cleaning ------------------------------- */
// Only the shapes above, with every value a string, a small whole number or a true/false. Used on what the app built
// (so the preview matches the link exactly) and on whatever a link carries (a link can be made or edited by anyone).
export function cleanDaySheet(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = (v, max = 4000) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
  const o = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const list = (v, f, max = 300) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(0, max).map(f) : []);
  const yes = v => v === true || v === 1;
  const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  const time = v => { const m = TIME.exec(s(v, 5)); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1].padStart(2, '0')}:${m[2]}` : ''; };
  const date = v => { const d = s(v, 10); return DATE.test(d) && !isNaN(parseISO(d)) ? d : ''; };
  const person = p => ({ name: s(p.name, 200), role: s(p.role, 200), phone: s(p.phone, 60), email: s(p.email, 200) });
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'other';
  const P = o(raw.place), F = o(raw.from), G = o(raw.guests), geo = o(P.geo);
  const lat = Number(geo.lat), lon = Number(geo.lon);
  const hasGeo = geo.lat != null && geo.lon != null && geo.lat !== '' && geo.lon !== '' && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const d0 = date(raw.date), d1 = date(raw.endDate);
  const S = raw.setlist && typeof raw.setlist === 'object' && !Array.isArray(raw.setlist) ? raw.setlist : null;
  const rows = S ? list(S.rows, r => (yes(r.brk) ? { brk: true, t: s(r.t, 200) } : { t: s(r.t, 200) || 'Untitled', key: s(r.key, 40), len: s(r.len, 12), segue: yes(r.segue), encore: yes(r.encore), note: s(r.note, 500) })) : [];
  const setName = S ? s(S.name, 200) : '';
  const names = list(G.names, g => ({ name: s(g.name, 200), plus: int(g.plus, 99) })).filter(g => g.name);
  const count = int(G.count, 9999), cap = int(G.cap, 9999);
  return {
    v: 1, kind, ref: s(raw.ref, 80), made: int(raw.made, 9e15),
    title: s(raw.title, 300), act: s(raw.act, 200),
    from: { name: s(F.name, 200), business: s(F.business, 200), phone: s(F.phone, 60), email: s(F.email, 200) },
    date: d0, endDate: d0 && d1 > d0 ? d1 : '', slot: s(raw.slot, 20),
    times: list(raw.times, x => ({ k: Object.prototype.hasOwnProperty.call(TIME_LABELS, x.k) ? x.k : '', t: time(x.t), n: yes(x.n) ? 1 : 0 }), 12).filter(x => x.k && x.t),
    place: { name: s(P.name, 300), address: s(P.address, 600), geo: hasGeo ? { lat, lon } : null, loadIn: s(P.loadIn, 1000), parking: s(P.parking, 1000), stage: s(P.stage, 200), pa: s(P.pa, 600), noise: s(P.noise, 20) },
    running: list(raw.running, r => ({ time: time(r.time), act: s(r.act, 200), len: s(r.len, 20), ours: yes(r.ours), n: yes(r.n) ? 1 : 0 }), 60).filter(r => r.act || r.time),
    people: list(raw.people, person).filter(p => p.name || p.phone || p.email),
    contacts: list(raw.contacts, person, 20).filter(p => p.name || p.phone || p.email),
    setlist: rows.length || setName ? { name: setName, rows, total: s(S.total, 12), songs: int(S.songs, 999), missing: int(S.missing, 999) } : null,
    songs: list(raw.songs, r => ({ t: s(r.t, 200), key: s(r.key, 40), bpm: s(r.bpm, 8), len: s(r.len, 12) })).filter(r => r.t),
    due: list(raw.due, x => ({ t: s(x.t, 300), due: date(x.due), done: yes(x.done) })).filter(x => x.t),
    gear: list(raw.gear, g => ({ name: s(g.name, 200), qty: int(g.qty, 999) || 1, who: s(g.who, 200) })).filter(g => g.name),
    provided: s(raw.provided, 2000), hospitality: s(raw.hospitality, 4000), accommodation: s(raw.accommodation, 4000),
    guests: count || cap || names.length ? { count: Math.max(count, names.reduce((t, g) => t + 1 + g.plus, 0)), cap, names } : null,
    notes: s(raw.notes, 8000),
  };
}

// Leaves out empty values before a sheet goes into a link (cleanDaySheet puts the defaults back), so links stay short.
export function compact(x) {
  if (Array.isArray(x)) return x.map(compact);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    const c = compact(v);
    if (c === '' || c == null || c === false || c === 0 || (Array.isArray(c) && !c.length) || (typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length)) continue;
    out[k] = c;
  }
  return out;
}

// The link form: compact, with each list's items as rows of values in a fixed order (trailing blanks left off).
// fromLink turns rows back into objects; anything else passes through for cleanDaySheet to check.
const ROWS = { times: ['k', 't', 'n'], running: ['time', 'act', 'len', 'ours', 'n'], people: ['name', 'role', 'phone', 'email'], contacts: ['name', 'role', 'phone', 'email'],
  songs: ['t', 'key', 'bpm', 'len'], due: ['t', 'due', 'done'], gear: ['name', 'qty', 'who'] };
const SET_ROW = ['t', 'key', 'len', 'segue', 'encore', 'note', 'brk'];
const toRow = (o, keys) => { const r = keys.map(k => (o[k] === true ? 1 : o[k] == null || o[k] === false ? '' : o[k])); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === 0)) r.pop(); return r; };
const fromRow = (r, keys) => (Array.isArray(r) ? Object.fromEntries(keys.map((k, i) => [k, r[i]])) : r);
export function toLink(d) {
  const c = compact(d);
  for (const [k, keys] of Object.entries(ROWS)) if (Array.isArray(c[k])) c[k] = c[k].map(o => toRow(o, keys));
  if (c.setlist && Array.isArray(c.setlist.rows)) c.setlist = { ...c.setlist, rows: c.setlist.rows.map(o => toRow(o, SET_ROW)) };
  return c;
}
export function fromLink(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = { ...raw };
  for (const [k, keys] of Object.entries(ROWS)) if (Array.isArray(out[k])) out[k] = out[k].map(r => fromRow(r, keys));
  if (out.setlist && typeof out.setlist === 'object' && Array.isArray(out.setlist.rows)) out.setlist = { ...out.setlist, rows: out.setlist.rows.map(r => fromRow(r, SET_ROW)) };
  return out;
}

/* ------------------------------- words ------------------------------- */
export const dayLabel = (d, f = fmtLong) => (!d.date ? 'Date to be confirmed' : d.endDate ? `${f(d.date)} → ${f(d.endDate)}` : f(d.date));
export const typeLabel = d => TYPE[d.kind] || TYPE.other;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fromLine = f => [[f.name, f.business].filter(Boolean).join(' · '), f.phone, f.email].filter(Boolean).join(' · ');
const oneLine = t => String(t || '').replace(/\s*\n+\s*/g, ', ');
const guestLine = g => `${plural(g.count, 'person', 'people')} on the list${g.cap ? ` · cap ${g.cap}` : ''}`;
const madeLine = d => (d.made ? new Date(d.made).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/* ------------------------------- the document ------------------------------- */
const out = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
const tel = p => { const u = telUrl(p); return u.length > 6 ? h('a', { href: u }, p) : p; };
const mail = e => (EMAIL.test(e) ? h('a', { href: 'mailto:' + e }, e) : e);
const contact = p => nodes(p.phone && tel(p.phone), p.phone && p.email && h('br'), p.email && mail(p.email));

// One element for the in-app preview, the printout, the saved web page and the band's page: the classes are the
// shared document ones (js/doc-css.js) plus a few of its own (dsDocCss below).
export function renderDaySheet(d) {
  const kind = KINDS.includes(d.kind) ? d.kind : 'other', P = d.place;
  const sec = (title, cls, ...kids) => { const body = nodes(...kids); return body.length ? h('section', { class: 'cs-sec ' + cls }, h('h4', null, title), ...body) : null; };
  const kv = (k, v, pre) => (v ? h('div', { class: 'cs-kv' }, h('span', null, k), h('b', { class: pre ? 'ds-pre' : null }, v)) : null);
  const th = (t, num) => h('th', { class: num ? 'num' : null, scope: 'col' }, t);
  const table = (head, rows, cls) => h('table', { class: cls || null }, h('thead', null, h('tr', null, head)), h('tbody', null, rows));
  const late = n => (n ? h('em', null, 'after midnight') : null);
  const sub = [typeLabel(d), d.act && !(d.title || '').includes(d.act) ? d.act : '', dayLabel(d)].filter(Boolean).join(' · ');

  const times = d.times.length
    ? h('div', { class: 'cs-times' }, d.times.map(x => h('div', { class: 'cs-time' + (x.n ? ' ds-next' : '') }, h('span', null, TIME_LABELS[x.k]), h('b', null, x.t), late(x.n))))
    : h('p', { class: 'ds-tbc' }, 'Times to be confirmed.');

  const address = P.address ? out(googleUrl(P), oneLine(P.address)) : P.geo ? out(googleUrl(P), 'Open the map') : '';
  const place = sec(PLACE[kind], 'ds-place', kv('Name', P.name), kv(P.address ? 'Address' : 'Map', address), kv('Load-in', P.loadIn, true), kv('Parking', P.parking, true));

  const running = d.running.length ? sec('Running order', 'ds-running', table([th('Time'), th(kind === 'show' ? 'Act' : 'What'), th('Set', true)],
    d.running.map(r => h('tr', { class: r.ours ? 'ds-ours' : null }, h('td', { class: 'ds-t' }, r.time || '—', late(r.n)), h('td', null, r.act || '—', r.ours ? h('span', { class: 'ds-tag' }, 'our set') : null), h('td', { class: 'num' }, r.len))))) : null;

  const people = (list, roleHead) => table([th('Name'), th(roleHead), th('Contact')], list.map(p => h('tr', null, h('td', null, p.name || '—'), h('td', null, p.role), h('td', { class: 'ds-c' }, contact(p)))));
  const lineup = d.people.length ? sec(LINEUP[kind], 'ds-lineup', people(d.people, kind === 'show' || kind === 'rehearsal' ? 'Plays / role' : 'Role')) : null;
  const contacts = d.contacts.length ? sec('Contacts', 'ds-contacts', people(d.contacts, 'Role')) : null;

  let setlist = null;
  if (d.setlist) {
    const S = d.setlist, hasKey = S.rows.some(r => r.key), cols = 3 + (hasKey ? 1 : 0);
    let n = 0;
    const rows = S.rows.map(r => (r.brk
      ? h('tr', { class: 'ds-brk' }, h('td', { colspan: cols }, r.t || 'Break'))
      : h('tr', null, h('td', { class: 'ds-n' }, String(++n)),
        h('td', null, r.t, r.segue ? h('span', { class: 'ds-seg', title: 'Straight into the next song' }, ' →') : null, r.encore ? h('span', { class: 'ds-tag' }, 'encore') : null, r.note ? h('div', { class: 'ds-note' }, r.note) : null),
        hasKey && h('td', null, r.key), h('td', { class: 'num' }, r.len))));
    if (S.songs) rows.push(h('tr', { class: 'ds-total' }, h('td', { colspan: cols - 1 }, `Total · ${plural(S.songs, 'song')}${d.slot ? ` · ${d.slot} slot` : ''}`), h('td', { class: 'num' }, S.total || '—')));
    setlist = sec('Setlist' + (S.name ? ' · ' + S.name : ''), 'ds-setlist',
      rows.length ? table([th('#'), th('Song'), hasKey && th('Key'), th('Length', true)], rows, 'ds-songs') : h('p', null, 'No songs on it yet.'),
      S.missing ? h('p', { class: 'ds-note' }, `${plural(S.missing, 'song')} without a length, so the total is short.`) : null);
  }
  const hasKey = d.songs.some(r => r.key), hasBpm = d.songs.some(r => r.bpm), hasLen = d.songs.some(r => r.len);
  const songs = d.songs.length ? sec(SONGS[kind], 'ds-worksongs', table([th('Song'), hasKey && th('Key'), hasBpm && th('BPM', true), hasLen && th('Length', true)],
    d.songs.map(r => h('tr', null, h('td', null, r.t), hasKey && h('td', null, r.key), hasBpm && h('td', { class: 'num' }, r.bpm), hasLen && h('td', { class: 'num' }, r.len))))) : null;
  const due = d.due.length ? sec('Due', 'ds-due', table([th('What'), th('Due', true), th('Done', true)],
    d.due.map(x => h('tr', { class: x.done ? 'ds-done' : null }, h('td', null, x.t), h('td', { class: 'num' }, x.due ? fmtShort(x.due) : ''), h('td', { class: 'num' }, x.done ? '✓' : ''))))) : null;

  const hasWho = d.gear.some(g => g.who);
  const backline = sec('Backline', 'ds-backline',
    d.gear.length && [h('div', { class: 'cs-day' }, 'We bring'), table([th('Item'), h('th', { class: 'ds-q', scope: 'col' }, 'Qty'), hasWho && th('Whose')], d.gear.map(g => h('tr', null, h('td', null, g.name), h('td', { class: 'ds-q' }, String(g.qty)), hasWho && h('td', null, g.who))))],
    kv(HAS[kind], d.provided, true), kv('Stage', P.stage), kv('PA', P.pa, true), kv('Noise limit', P.noise));

  const hosp = sec('Hospitality & stay', 'ds-hosp', kv('Hospitality', d.hospitality, true), kv('Accommodation', d.accommodation, true));
  const guests = d.guests ? sec('Guest list', 'ds-guests', h('p', { class: 'ds-count' }, guestLine(d.guests)),
    d.guests.names.length ? h('p', { class: 'ds-pre ds-names' }, d.guests.names.map(g => g.name + (g.plus ? ` +${g.plus}` : '')).join(', ')) : null) : null;
  const notes = d.notes ? sec('Notes', 'ds-notes', h('p', { class: 'cs-pre' }, d.notes)) : null;

  const who = fromLine(d.from);
  return h('article', { class: 'cs-doc ds-doc', 'data-kind': kind },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, d.from.business || d.from.name || 'Gigdex'), h('div', { class: 'cs-kicker' }, 'DAY SHEET')),
      h('div', { class: 'cs-when' }, h('b', null, d.date ? dayLabel(d, fmtShort) : 'Date TBC'), h('div', null, typeLabel(d)))),
    h('h2', null, d.title || typeLabel(d)),
    h('div', { class: 'cs-sub' }, sub),
    times, place, running, lineup, contacts, setlist, songs, due, backline, hosp, guests, notes,
    h('footer', { class: 'cs-foot' }, [who ? `Day sheet from ${who}.` : 'Day sheet.', d.made ? ` Made ${madeLine(d)}.` : '', ' If plans change, you’ll get a new one. Made with Gigdex.'].join('')));
}

/* ------------------------------- plain text ------------------------------- */
// For a band chat or a text message: short lines, capital headings, no formatting marks.
export function daySheetTextFrom(d) {
  const kind = KINDS.includes(d.kind) ? d.kind : 'other', P = d.place, L = [];
  const block = (title, lines) => { const ls = lines.flat().filter(x => x != null && x !== false && x !== ''); if (ls.length) L.push('', title, ...ls); };
  L.push(`DAY SHEET – ${d.title || typeLabel(d)}`, `${typeLabel(d)} · ${dayLabel(d)}`);
  block('TIMES', d.times.length ? d.times.map(x => `${TIME_LABELS[x.k]} ${x.t}${x.n ? ' (after midnight)' : ''}`) : ['To be confirmed']);
  block(PLACE[kind].toUpperCase(), [P.name, P.address && oneLine(P.address), (P.address || P.geo) && 'Map: ' + googleUrl(P), P.loadIn && 'Load-in: ' + oneLine(P.loadIn), P.parking && 'Parking: ' + oneLine(P.parking)]);
  block('RUNNING ORDER', d.running.map(r => `${r.time || '—'}${r.n ? ' (after midnight)' : ''}  ${r.act}${r.len ? ', ' + r.len : ''}${r.ours ? '  ← our set' : ''}`));
  block(LINEUP[kind].toUpperCase(), d.people.map(p => [p.name, p.role].filter(Boolean).join(', ') + (p.phone ? ': ' + p.phone : '')));
  block('CONTACTS', d.contacts.map(c => { const how = [c.phone, c.email].filter(Boolean).join(', '); return [c.name, c.role].filter(Boolean).join(', ') + (how ? ': ' + how : ''); }));
  if (d.setlist) {
    const S = d.setlist; let n = 0;
    block(`SETLIST${S.name ? ': ' + S.name : ''}${S.songs ? ` (${plural(S.songs, 'song')}${S.total ? ', ' + S.total : ''})` : ''}`,
      S.rows.map(r => (r.brk ? `— ${r.t || 'Break'} —` : `${++n}. ${r.t}${r.key ? ` (${r.key})` : ''}${r.segue ? ' →' : ''}${r.encore ? ' [encore]' : ''}`)));
  }
  block(SONGS[kind].toUpperCase(), d.songs.map(r => r.t + (r.key ? ` (${r.key})` : '')));
  block('DUE', d.due.map(x => `${x.done ? '✓ ' : ''}${x.t}${x.due ? ' – ' + fmtShort(x.due) : ''}`));
  block('BACKLINE', [d.gear.length && 'We bring: ' + d.gear.map(g => g.name + (g.qty > 1 ? ' ×' + g.qty : '') + (g.who ? ` (${g.who})` : '')).join(', '),
    d.provided && `${HAS[kind]}: ${oneLine(d.provided)}`, P.stage && 'Stage: ' + P.stage, P.pa && 'PA: ' + oneLine(P.pa), P.noise && 'Noise limit: ' + P.noise]);
  block('HOSPITALITY', [d.hospitality]);
  block('ACCOMMODATION', [d.accommodation]);
  if (d.guests) block('GUEST LIST', [guestLine(d.guests), d.guests.names.length && d.guests.names.map(g => g.name + (g.plus ? ` +${g.plus}` : '')).join(', ')]);
  block('NOTES', [d.notes]);
  const who = fromLine(d.from);
  if (who) L.push('', 'From ' + who);
  return L.join('\n');
}

/* ------------------------------- calendar file ------------------------------- */
// One event for the day: from the first time to the last (a time after midnight lands on the next morning). A day
// with no times, or a run of days (a festival weekend), is an all-day event. The event id follows the booking, so a
// newer link updates the event instead of adding another.
const icsText = s => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = line => { const enc = new TextEncoder(), outL = []; let cur = '', bytes = 0; for (const ch of line) { const n = enc.encode(ch).length; if (bytes + n > 74) { outL.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += n; } outL.push(cur); return outL.join('\r\n'); };
const p2 = n => String(n).padStart(2, '0');
const local = x => `${x.getFullYear()}${p2(x.getMonth() + 1)}${p2(x.getDate())}T${p2(x.getHours())}${p2(x.getMinutes())}00`;
const dayOnly = (iso, add = 0) => { const x = parseISO(iso); x.setDate(x.getDate() + add); return `${x.getFullYear()}${p2(x.getMonth() + 1)}${p2(x.getDate())}`; };
const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'day';
export function daySheetIcs(d, href = '') {
  if (!d || !d.date) return '';
  const at = x => { const [hh, mm] = x.t.split(':').map(Number), day = parseISO(d.date); day.setDate(day.getDate() + (x.n ? 1 : 0)); day.setHours(hh, mm, 0, 0); return day; };
  const timed = d.times.length && !d.endDate;
  let start = null, end = null;
  if (timed) {
    start = at(d.times[0]); end = at(d.times[d.times.length - 1]);
    if (end <= start) end = new Date(start.getTime() + 36e5); // one time only: an hour, rather than no length
  }
  const P = d.place, made = d.made || Date.now();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gigdex//Day sheet//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:daysheet-${slug(d.ref || (d.title + '-' + d.date))}@gigdex`, `DTSTAMP:${utc(Date.now())}`, `LAST-MODIFIED:${utc(made)}`, `SEQUENCE:${Math.floor(made / 1000) % 2147483647}`,
    timed ? `DTSTART:${local(start)}` : `DTSTART;VALUE=DATE:${dayOnly(d.date)}`,
    timed ? `DTEND:${local(end)}` : `DTEND;VALUE=DATE:${dayOnly(d.endDate || d.date, 1)}`,
    `SUMMARY:${icsText(d.title || typeLabel(d))}`,
    (P.name || P.address) && `LOCATION:${icsText([P.name, oneLine(P.address)].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText([d.times.map(x => `${TIME_LABELS[x.k]} ${x.t}${x.n ? ' (after midnight)' : ''}`).join('\n'), fromLine(d.from) && 'From ' + fromLine(d.from), href && 'Day sheet: ' + href].filter(Boolean).join('\n\n'))}`,
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
  return lines.map(l => fold(String(l).replace(/[\r\n]+/g, ' '))).join('\r\n') + '\r\n';
}

/* ------------------------------- styles ------------------------------- */
// The document's own extras on top of js/doc-css.js, for the printout (prefix '#print-root '), the saved web page and
// the band's page (prefix ''). The in-app preview has its own copy in css/daysheet.css, in theme colours.
const RULES = [
  ['.ds-doc', 'overflow-wrap:anywhere'],
  ['.ds-doc .cs-time em, .ds-doc td.ds-t em', 'display:block;font-style:normal;font-size:10.5px;font-weight:700;letter-spacing:.02em;color:#7a2230'],
  ['.ds-doc .cs-time.ds-next', 'border-style:dashed'],
  ['.ds-doc .ds-tbc', 'color:#555;margin:12px 0'],
  ['.ds-doc tr.ds-ours td', 'font-weight:700;background:#f3efe6;-webkit-print-color-adjust:exact;print-color-adjust:exact'],
  ['.ds-doc tr.ds-brk td', 'font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#555;padding-top:10px'],
  ['.ds-doc tr.ds-total td', 'font-weight:700;border-bottom:0'],
  ['.ds-doc tr.ds-done td', 'color:#777'],
  ['.ds-doc td.ds-n', 'width:1.8em;color:#777;font-variant-numeric:tabular-nums'],
  ['.ds-doc td.ds-t', 'white-space:nowrap;width:4.5em'],
  ['.ds-doc td.ds-c', 'overflow-wrap:anywhere'],
  ['.ds-doc .ds-q', 'text-align:center;width:3em;white-space:nowrap'],
  ['.ds-doc .cs-time span', 'letter-spacing:.04em;overflow-wrap:normal'],
  ['.ds-doc a[href^="tel:"]', 'white-space:nowrap'],
  ['.ds-doc .ds-note', 'font-size:11.5px;color:#666;margin:2px 0'],
  ['.ds-doc .ds-tag', 'display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;border:1px solid #aaa;border-radius:4px;padding:0 4px;margin-left:6px;color:#555;vertical-align:1px;white-space:nowrap'],
  ['.ds-doc .ds-pre', 'white-space:pre-wrap'],
  ['.ds-doc .ds-count', 'margin:2px 0;font-weight:600'],
  ['.ds-doc .ds-names', 'margin:2px 0'],
  ['.ds-doc .cs-kv b', 'font-weight:600'],
  ['.ds-doc td a, .ds-doc .cs-kv a', 'color:#1a4e8a;word-break:normal;overflow-wrap:anywhere'],
];
export const dsDocCss = prefix => RULES.map(([sel, decl]) => `${sel.split(',').map(x => prefix + x.trim()).join(',')}{${decl}}`).join('\n');

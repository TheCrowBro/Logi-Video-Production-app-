// What a shared link holds, turned into records of one's own: the shoot from a crew link becomes a booking, a contact
// card becomes a person on the Crew list. Both remember where they came from (record.shared), so the same thing added
// again updates what was added before instead of making a copy. A booking also remembers what the link supplied
// (shared.sent, field by field, and shared.rows, the lines the link made), so an update replaces only what is still
// as the link left it and keeps what was changed or added by hand. Everything comes in already cleaned
// (js/share-data.js) and is written in one change, which the store refuses while Vdex is read-only, after a check
// that it fits the browser's storage. Equipment has its own module (js/gear-import.js). Loaded on first use.
import { uid, parseISO } from './util.js';
import { db, byId, update } from './store.js';
import { TYPES, DELIV_STATUS } from './workflow.js';
import { parseEighths } from './board.js';
import { isTime, mail, fromLine } from './share-data.js';
import { roomFor, linkId } from './gear-import.js';

const low = v => String(v == null ? '' : v).trim().toLowerCase();
const squash = v => low(v).replace(/[\s,]+/g, ' ');
const hhmm = t => (isTime(t) ? t.padStart(5, '0') : ''); // "7:30" → "07:30", as the time boxes want it
// The id of a record a link makes: worked out from the link's own reference (linkId in js/gear-import.js), so the same
// link added on two devices of one person makes the same record on both, and the sync folds them into one.
const fromRef = (d, list, ref, tail = '') => linkId(ref && ref + tail, new Set(d[list].map(x => x.id)), d.deleted);
// Two values of a detail are the same whatever their line ends and the white space around them (a form may tidy those).
const plain = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
const same = (a, b) => plain(a) === plain(b);
// Two names are the same whatever their capitals, accents, punctuation and spacing.
const fold = v => String(v == null ? '' : v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* ----------------------------------- a booking ----------------------------------- */
// Who made the link: newer links carry the details apart; older ones have them in one line, read as well as it can be.
export function producerOf(snap) {
  const by = snap.by || {};
  if (by.name || by.business || by.phone || by.email) return { name: by.name, business: by.business, phone: by.phone, email: mail(by.email) };
  const out = { name: '', business: '', phone: '', email: '' };
  for (const p of String(snap.producer || '').split(' · ').map(x => x.trim()).filter(Boolean)) {
    if (!out.email && mail(p)) out.email = p; else if (!out.phone && /^[+(]?\d[\d\s().-]{5,}$/.test(p)) out.phone = p; else if (!out.name) out.name = p; else if (!out.business) out.business = p;
  }
  return out;
}
// The link was made from a booking of one's own: there is nothing to add. A booking's id is the reference of the
// links made from it, so a link that names a booking here was made from it, also when that booking itself came from
// someone's link and was shared on. One case apart: a booking added from this very reference before is what the link
// updates (build() finds it), whatever else carries that id. (A booking a link made has an id worked out from that
// link, the same on every device that adds it, so someone can hold both the booking from the first link and the one
// from a workmate's link made from their copy of it.)
export const ownBooking = snap => (snap.ref && !db.bookings.some(b => b.shared && b.shared.ref === snap.ref) && byId('bookings', snap.ref)) || null;

// The stripboard from the days the link carries, merged into the board the booking has (old). The link's strips come
// in the link's order, day by day. A strip the link made before (made(id) says so) is found again by what it is (a
// scene's number and set, a banner's words), else by its place in its day, and keeps its id and the notes written on
// it; one the link no longer has is gone. Strips the receiver made stay, at the end of the day they were in, or after
// the last day when that day is gone. → { board, strips: the ids of the strips the link made }, or null when the link
// brings no strip.
function boardFrom(snap, days, old, made) {
  const byDay = new Map(snap.scenes.map(d => [d.n, d])), count = Math.max(days, ...snap.scenes.map(d => d.n).filter(n => n <= 366));
  // The board as it is: the link's strips with their day and their place among the link's strips of that day, one's
  // own strips with their day, and the day breaks. What lies after the last break is not scheduled: day Infinity.
  const theirs = [], mine = [], breaks = []; let at = 1, place = 0;
  for (const x of (old && Array.isArray(old.list) ? old.list : [])) {
    if (!x || !x.id) continue;
    if (x.type === 'break') { breaks.push(String(x.id)); at++; place = 0; continue; }
    if (made(x.id)) theirs.push({ x, day: at, place: place++ }); else mine.push({ x, day: at });
  }
  for (const o of [...theirs, ...mine]) if (o.day > breaks.length) o.day = Infinity;
  const key = x => (x.type === 'banner' ? `b|${low(x.text)}` : x.scene || x.set ? `s|${low(x.scene)}|${low(x.set)}` : '');
  const byKey = new Map(), byPlace = new Map(), used = new Set();
  for (const o of theirs) { const k = key(o.x); if (k) byKey.set(k, [...(byKey.get(k) || []), o]); byPlace.set(`${o.x.type}|${o.day}|${o.place}`, o); }
  const coming = []; // the link's strips: their day, their place in it, and the strip as the board holds one
  for (let n = 1; n <= count; n++) {
    let i = 0;
    for (const x of (byDay.get(n) || { items: [] }).items) {
      if (x.banner != null) { if (x.banner) coming.push({ n, i: i++, strip: { type: 'banner', text: x.banner } }); continue; }
      coming.push({ n, i: i++, strip: { type: 'scene', scene: x.scene, ie: x.ie, set: x.set, tod: x.tod, dn: /night$/.test(x.kind) ? 'N' : 'D', desc: x.desc, cast: [...x.cast], eighths: parseEighths(x.pages) || 0 } });
    }
  }
  if (!coming.length) return null;
  // First by what a strip is, for all of them; only then by place, so a strip that was renumbered does not take the
  // notes of the one that moved up into its place.
  for (const c of coming) { const o = (byKey.get(key(c.strip)) || []).find(y => !used.has(y.x.id)); if (o) { c.old = o.x; used.add(o.x.id); } }
  for (const c of coming) { if (c.old) continue; const o = byPlace.get(`${c.strip.type}|${c.n}|${c.i}`); if (o && !used.has(o.x.id)) { c.old = o.x; used.add(o.x.id); } }
  const list = [], strips = [], cast = new Set(old && Array.isArray(old.cast) ? old.cast.map(String) : []);
  const ids = new Set([...breaks.slice(0, count), ...mine.map(o => String(o.x.id)), ...used]);
  let c = 0;
  for (let n = 1; n <= count; n++) {
    for (; c < coming.length && coming[c].n === n; c++) {
      const { strip, old: o } = coming[c], id = o ? o.id : uid();
      list.push(strip.type === 'scene' ? { id, ...strip, notes: o ? String(o.notes || '') : '' } : { id, ...strip });
      strips.push(id); if (strip.cast) strip.cast.forEach(name => cast.add(name));
    }
    for (const o of mine) if (o.day === n) list.push(o.x);
    let id = breaks[n - 1]; if (!id) { id = ids.has('day-' + n) ? uid() : 'day-' + n; ids.add(id); }
    list.push({ id, type: 'break' });
  }
  for (const o of mine) if (o.day > count) list.push(o.x); // from a day that is gone, or not scheduled yet: after the last day
  return { board: { list, cast: [...cast], updatedAt: Date.now() }, strips };
}

const VENUE = { name: 'the venue’s name', address: 'the venue’s address', access: 'the venue’s access notes', parking: 'the venue’s parking', power: 'the venue’s power', hospital: 'the venue’s nearest hospital', rules: 'the venue’s rules' };

// The booking (and its venue) as it would be saved, worked out against the data given and changing nothing. Rules:
// a first import fills the booking from the link. A later one is an update:
//   single details (title, client, dates, times, address, the call sheet's times and notes, the break; the details of
//     the venue the link made): the link's value comes in only while the booking still holds what the link supplied
//     last time (shared.sent). One changed by hand since is kept, and named in `kept` for the preview.
//   lines (crew, schedule lines, shots, deliverables, strips; contacts by name): the ones the link made are replaced by
//     the link's, the ones made by hand stay. A person still on the link keeps the rate, days and notes given to them,
//     a strip its notes, a shot its tick, a deliverable its link. Which lines the link made is kept by id in
//     shared.rows as well as on the line (`shared`), because editing a line in a form writes it anew without the mark.
//   one's own stage, checklists, crew, equipment, budget, quote, invoice, hours and notes are never touched.
// An empty part of a link changes nothing. A booking added before Vdex kept shared.sent has no record of what the link
// supplied: every detail of it then counts as unchanged, and every strip on its board as the link's.
function build(snap, d) {
  const now = Date.now(), cur = (snap.ref && d.bookings.find(b => b.shared && b.shared.ref === snap.ref)) || null, was = (cur && cur.shared) || {};
  const legacy = !!cur && !was.sent, sentWas = was.sent || {}, rowsWas = was.rows || {}, sent = {}, rows = {}, kept = new Set();
  const who = producerOf(snap), from = fromLine(who), L = snap.location, C = snap.call, odd = []; // odd: what has no box of its own, kept readable in the notes
  // One detail: the value the booking gets. v is what the link gives, written as the booking would hold it ('' when
  // the link has none), have what the booking holds now, label how the preview names it when it is kept.
  // before: what the link supplied last time; after: where what it supplies now is written down; always: there is no
  // record to go by (a new booking, or one from before the record was kept), so the link's value comes in.
  const taker = (before, after, always) => (key, label, v, have) => {
    if (have == null) have = '';
    if (v === '' || v == null) { if (key in before) after[key] = before[key]; return have; } // an empty part of a link changes nothing
    after[key] = v;
    if (always || same(have, v) || same(have, key in before ? before[key] : '')) return v;
    kept.add(label); return have; // changed by hand since the link supplied it: it stays
  };
  const take = taker(sentWas, sent, !cur || legacy);
  // Which of the booking's lines the link made: marked on the line, or named by id in shared.rows.
  const madeIn = k => { const ids = new Set(rowsWas[k] || []); return x => !!x && (x.shared === true || ids.has(x.id)); };

  let endDate = snap.endDate;
  if (endDate && (parseISO(endDate) - parseISO(snap.date)) / 864e5 > 366) { odd.push(`Last day given as ${endDate}: check the dates.`); endDate = ''; }
  const days = endDate ? Math.round((parseISO(endDate) - parseISO(snap.date)) / 864e5) + 1 : 1;
  const type = (TYPES.find(t => t[1] === snap.type) || [])[0];
  if (snap.type && !type) odd.push(`Type: ${snap.type}`);
  // The dates are one detail, and so are the times: the first day with the last, the start with the end. (These come
  // first so that the preview names what was kept in the order of the booking's own page.)
  const title = take('title', 'the title', snap.title, cur && cur.title) || 'Shared shoot', client = take('client', 'the client', snap.client, cur && cur.client);
  const span = (a, b, sep) => (a || b ? `${a || ''}${b ? sep + b : ''}` : '');
  const [date, lastDay = ''] = take('dates', 'the dates', span(snap.date, endDate, '/'), cur ? span(cur.date, cur.endDate > cur.date ? cur.endDate : '', '/') : '').split('/');
  const [start = '', end = ''] = take('times', 'the start and end times', span(hhmm(snap.start), hhmm(snap.end), '–'), cur ? span(cur.start, cur.end, '–') : '').split('–');
  const address = take('address', 'the address', L.address, cur && cur.address);

  // The place: a venue of its own when the link has more than an address, so the call sheet shows access, parking, power and the hospital.
  let venue = null;
  if (L.venue || L.access || L.parking || L.power || L.hospital || L.rules) {
    const name = L.venue || L.address.split(/[\n,]/)[0].trim() || snap.title || 'Shared venue', details = { address: L.address, access: L.access, parking: L.parking, power: L.power, hospital: L.hospital, rules: L.rules };
    const mine = snap.ref && d.venues.find(v => v.shared && v.shared.ref === snap.ref), twin = mine || d.venues.find(v => low(v.name) === low(name) && squash(v.address) === squash(L.address));
    if (twin) { // made by this link before: each detail follows the link while it is as the link left it; a venue of one's own with the same name and address: only its empty boxes are filled
      const record = { ...twin };
      if (mine) {
        const vSent = {}, vTake = taker(mine.shared.sent || {}, vSent, !mine.shared.sent);
        for (const [k, v] of Object.entries({ name, ...details })) record[k] = vTake(k, VENUE[k], v, mine[k]);
        record.shared = { ...mine.shared, sent: vSent };
      } else for (const [k, v] of Object.entries(details)) if (v && !String(twin[k] || '').trim()) record[k] = v;
      const shown = x => JSON.stringify([x.name, ...Object.keys(details).map(k => x[k] || '')]);
      venue = { record, isNew: false, changed: JSON.stringify(record) !== JSON.stringify(twin), filled: shown(record) !== shown(twin) };
    } else venue = { isNew: true, changed: true, filled: true, record: { id: fromRef(d, 'venues', snap.ref, '-venue'), name, type: '', ...details, permit: 'Unknown', notes: from ? `Shared by ${from} with “${snap.title || 'a booking'}”.` : 'Added with a shared booking.',
      shared: { ref: snap.ref, by: from, at: now, sent: Object.fromEntries(Object.entries({ name, ...details }).filter(([, v]) => v)) } } };
  }

  // People. The crew stay with this booking as the people on it (each with their call time), never on the Crew list;
  // the producer and the client's contacts are its contacts.
  const oldHires = (cur && cur.hires) || [], hireMade = madeIn('hires'), crewCall = { ...((cur && cur.crewCall) || {}) }, crewStatus = { ...((cur && cur.crewStatus) || {}) }, on = new Set();
  let hires = oldHires;
  if (snap.crew.length) {
    hires = [...snap.crew.map(p => {
      const old = oldHires.find(x => hireMade(x) && !on.has(x.id) && low(x.name) === low(p.name || p.role)), id = old ? old.id : uid();
      on.add(id); if (hhmm(p.call)) crewCall[id] = hhmm(p.call); else delete crewCall[id];
      return { rate: '', rateUnit: 'day', days: '', notes: '', ...(old || {}), id, name: p.name || p.role || 'Crew', role: p.role, phone: p.phone, email: mail(p.email), shared: true };
    }), ...oldHires.filter(x => !hireMade(x))];
    oldHires.filter(x => hireMade(x) && !on.has(x.id)).forEach(x => { delete crewCall[x.id]; delete crewStatus[x.id]; });
  }
  rows.hires = hires.filter(x => (snap.crew.length ? on.has(x.id) : hireMade(x))).map(x => x.id);

  // Contacts. The producer is always the link's; the client's contacts only when the link carries that part. Without
  // it, the contacts an earlier link brought stay, and stay known as the link's, so a later link replaces them.
  const producer = who.name || who.business ? { name: who.name || who.business, business: who.business } : null;
  const brought = snap.contacts.filter(p => p.name).map(p => ({ name: p.name, role: p.role, phone: p.phone, email: mail(p.email) }));
  const people = [producer && { name: producer.name, role: who.name && who.business ? `Producer · ${who.business}` : 'Producer', phone: who.phone, email: who.email }, ...brought].filter(Boolean);
  // A contact on the booking under a name no link has brought was added by hand, and is one's own: it stays exactly as
  // it is. A person of the same name on the link does not replace it or come in beside it (contacts are told apart by
  // name, so the two could never be kept apart afterwards), and the name does not become the link's.
  const hadNames = was.contacts || [], hadProducer = was.producer ? low(was.producer.name) : '';
  const byHand = new Set(((cur && cur.stakeholders) || []).filter(s => s && s.name).map(s => low(s.name)).filter(n => !hadNames.includes(n)));
  const fresh = people.filter(p => !byHand.has(low(p.name))), gone = new Set(fresh.map(p => low(p.name)));
  if (brought.length) hadNames.forEach(n => { if (n !== hadProducer) gone.add(n); });
  if (producer && hadProducer) gone.add(hadProducer);
  byHand.forEach(n => gone.delete(n));
  const stakeholders = [...fresh, ...((cur && cur.stakeholders) || []).filter(s => !gone.has(low(s && s.name)))];
  const contacts = [...new Set([...fresh.map(p => low(p.name)), ...hadNames.filter(n => !gone.has(n))])]; // every contact on the booking that a link brought, by name

  // The call sheet: times, the schedule, and the notes for the day.
  const cs = (cur && cur.callSheet) || {}, sched = Array.isArray(cs.schedule) ? cs.schedule : [], lineMade = madeIn('schedule');
  const lines = snap.schedule.filter(r => r.time || r.item).map(r => ({ id: uid(), date: r.date, time: hhmm(r.time), item: hhmm(r.time) || !r.time ? r.item : `${r.time} ${r.item}`.trim(), shared: true }));
  for (const [k, label] of [['general', 'General call'], ['lunch', 'Lunch'], ['wrap', 'Wrap']]) if (C[k] && !hhmm(C[k])) odd.push(`${label}: ${C[k]}`);
  const onSheet = (k, label, v) => take('cs.' + k, label, v, cs[k]);
  const callSheet = { ...cs, generalCall: onSheet('generalCall', 'the general call', hhmm(C.general)), lunch: onSheet('lunch', 'the lunch time', hhmm(C.lunch)), wrap: onSheet('wrap', 'the wrap time', hhmm(C.wrap)),
    dress: onSheet('dress', 'the dress code', C.dress), weather: onSheet('weather', 'the weather note', C.weather), emergency: onSheet('emergency', 'the emergency contact', C.emergency),
    attendees: onSheet('attendees', 'who is on set', snap.onSet), notes: onSheet('notes', 'the call sheet’s instructions', snap.notes),
    schedule: lines.length ? [...lines, ...sched.filter(r => r && !lineMade(r))] : sched, editedAt: now };
  rows.schedule = (lines.length ? lines : sched.filter(r => r && lineMade(r))).map(r => r.id);
  const brk = /^(\d{1,4}) min approved(?: · (.*))?$/.exec(C.breaks);
  const breakMinutes = take('breakMinutes', 'the approved break', brk ? Number(brk[1]) : '', cur && cur.breakMinutes);
  const breakNote = take('breakNote', 'the note on breaks', brk ? brk[2] || '' : C.breaks.slice(0, 200), cur && cur.breakNote);

  // Shots keep their ticks, deliverables their links: both are matched by their wording.
  const carry = (k, old, list, key, make) => {
    const made = madeIn(k); if (!list.length) { rows[k] = old.filter(made).map(y => y.id); return old; }
    const used = new Set(), fresh = list.map(x => { const o = old.find(y => made(y) && !used.has(y.id) && y[key] === x[key]); if (o) used.add(o.id); return make(x, o); });
    rows[k] = fresh.map(y => y.id); return [...fresh, ...old.filter(y => !made(y))];
  };
  const shots = carry('shots', (cur && cur.shots) || [], snap.shots.filter(s => s.text), 'text', (s, o) => ({ ...(o || { id: uid() }), text: s.text, done: !!(s.done || (o && o.done)), shared: true }));
  const deliverables = carry('deliverables', (cur && cur.deliverables) || [], snap.deliverables.filter(x => x.name), 'name', (x, o) => ({ link: '', delivered: '', ...(o || { id: uid() }), name: x.name, duration: x.duration, due: x.due, status: DELIV_STATUS.includes(x.status) ? x.status : (o && o.status) || 'Planned', shared: true }));

  // The producer's equipment is not one's own, so it is not ticked on the booking: it is listed in the notes, to read.
  // A link without the equipment part leaves the list an earlier link put there.
  const kit = new Map(); snap.kit.forEach(k => { const c = k.cat || 'Other'; kit.set(c, [...(kit.get(c) || []), k.name + (k.qty > 1 ? ` ×${k.qty}` : '')]); });
  const own = cur ? String(cur.notes || '') : '', held = was.note && own.includes(was.note);
  const whole = !kit.size && held && was.kitNote === undefined; // a note from before its equipment lines were kept apart stays whole
  const kitNote = kit.size ? ['Equipment on this shoot (from the shared booking):', ...[...kit].map(([c, names]) => `${c}: ${names.join(', ')}`)].join('\n') : was.kitNote || '';
  const note = whole ? was.note : [kitNote, ...odd].filter(Boolean).join('\n');
  const notes = held ? own.replace(was.note, () => note).trim() : [own, note && !own.includes(note) ? note : ''].filter(Boolean).join('\n\n');

  const booking = { ...(cur || { id: fromRef(d, 'bookings', snap.ref), status: 'Confirmed', type: type || 'other', crew: [], gear: [] }),
    title, client, date, start, end, address, stakeholders, hires, crewCall, crewStatus, shots, deliverables, callSheet, notes, updatedAt: now };
  if (lastDay) booking.endDate = lastDay; else delete booking.endDate;
  if (breakMinutes !== '') booking.breakMinutes = breakMinutes;
  if (breakNote !== '') booking.breakNote = breakNote;
  if (venue && !(cur && cur.venueId && d.venues.some(v => v.id === cur.venueId))) booking.venueId = venue.record.id;
  const strips = new Set(rowsWas.strips || []), old = cur && cur.board, board = snap.scenes.length ? boardFrom(snap, days, old, legacy ? () => true : id => strips.has(id)) : null;
  if (board) booking.board = board.board;
  rows.strips = board ? board.strips : legacy ? ((old && Array.isArray(old.list) && old.list) || []).filter(x => x && x.type !== 'break').map(x => x.id) : rowsWas.strips || [];
  booking.shared = { ref: snap.ref, by: from || was.by || '', at: was.at || now, updated: cur ? now : 0, made: snap.made, note, ...(whole ? {} : { kitNote }), contacts, producer: producer || was.producer || null, sent, rows };
  // For the preview: who the link is from, the contacts it brings, the details kept as they were changed by hand, and
  // how much of one's own is on the board.
  const theirs = new Set(rows.strips), ownStrips = board ? board.board.list.filter(x => x.type !== 'break' && !theirs.has(x.id)).length : 0;
  return { booking, venue, existing: cur, from, people: fresh, kept: [...kept], ownStrips };
}
// For the preview: what adding would do, with nothing changed.
export const planBooking = snap => ({ own: ownBooking(snap), ...build(snap, db) });
// The change itself, on the database it is given: the stored one inside update(), or a copy when the question is only
// whether it would fit (roomForBooking).
function put(d, snap) {
  const out = build(snap, d);
  if (out.venue && out.venue.changed) { const rec = { ...out.venue.record, updatedAt: Date.now() }, i = d.venues.findIndex(v => v.id === rec.id); if (i >= 0) d.venues[i] = rec; else d.venues.push(rec); }
  const i = d.bookings.findIndex(b => b.id === out.booking.id); if (i >= 0) d.bookings[i] = out.booking; else d.bookings.push(out.booking);
  return out;
}
// Whether the browser's storage has room for the booking as it would be saved (roomFor in js/gear-import.js). Asked
// before applyBooking, so a link too big to keep is turned down instead of added and then not saved.
export const roomForBooking = snap => roomFor(d => { put(d, snap); });
// Adds or updates the booking (and its venue). → what was saved, or false when Vdex is read-only or the booking is one's own.
export function applyBooking(snap) {
  if (ownBooking(snap)) return false;
  let out = null;
  const ok = update(d => { out = put(d, snap); });
  return ok === false ? false : out;
}

/* ---------------------------------- a contact card ---------------------------------- */
const digits = p => String(p || '').replace(/\D+/g, '');
const differ = (a, b) => !!a && !!b && a !== b;
// The card was made from one's own details (the Me page): there is nobody to add. The same email address says so,
// unless the card is in another name than one's own: a workmate's card under the company's address is theirs. Without
// an address on both sides, the same name with the same phone number, or the same name on a card that has nothing else.
export function ownCard(c, p = db.profile || {}) {
  const e = low(c.email), pe = low(p.email), ph = digits(c.phone), pph = digits(p.phone), name = fold(c.name || c.business);
  if (e && pe) return e === pe && (!name || !(fold(p.name) || fold(p.business)) || name === fold(p.name) || name === fold(p.business));
  const named = !!name && (name === fold(p.name) || name === fold(p.business));
  return named && (ph.length >= 6 ? ph === pph : !e && !ph);
}
// The person a card may be for, if someone on the Crew list fits: → { person, by, sure, card } or null.
//   sure  it is certainly them: the same email address under the same name, or a record that came from a card with
//         this name and that the card does not contradict (no other email address, no other phone number). Only then
//         does adding the card update the record without asking.
//   by    the detail that matched ('email', 'phone' or 'name'), for the sentence that says why they were found
//   card  the record came from a card before
// A weaker match (the same phone number, the same name, the same address under another name) may be somebody else:
// two people can share a number, a name or a company address. The preview then shows both and asks.
export function matchContact(c, d = db) {
  const e = low(c.email), ph = digits(c.phone), name = fold(c.name || c.business);
  const found = (x, by, sure) => ({ person: x, by, sure, card: !!x.shared });
  const mailed = e ? d.crew.filter(x => low(x.email) === e) : [];
  const exact = mailed.find(x => name && fold(x.name) === name); if (exact) return found(exact, 'email', true);
  const again = name && d.crew.find(x => x.shared && fold(x.shared.by) === name && !differ(low(x.email), e) && !differ(digits(x.phone), ph)); if (again) return found(again, 'name', true);
  if (mailed[0]) return found(mailed[0], 'email', false);
  const phoned = ph.length >= 6 && d.crew.find(x => digits(x.phone) === ph); if (phoned) return found(phoned, 'phone', false);
  const named = name && d.crew.find(x => fold(x.name) === name); if (named) return found(named, 'name', false);
  return null;
}
// A card's details replace the ones held; the rate and the notes are one's own and stay. A business and a home town
// have no box on a crew card, so they go into the notes, once. as: 'update' puts the card on the person found, however
// they were found; 'new' adds another person whoever was found; left out, it updates only someone who is surely them.
function buildContact(c, d, as) {
  const match = matchContact(c, d), cur = match && as !== 'new' && (as === 'update' || match.sure) ? match.person : null, had = cur ? String(cur.notes || '') : '';
  const extra = [c.name && c.business && `Business: ${c.business}`, c.location && `Based in: ${c.location}`].filter(l => l && !had.includes(l));
  const person = { ...(cur || { id: uid(), role: '', phone: '', email: '', link: '', rate: '', rateUnit: 'day' }), name: c.name || c.business || c.email || c.phone,
    ...(c.title ? { role: c.title } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}), ...(c.website ? { link: c.website } : {}),
    notes: [had, ...extra].filter(Boolean).join('\n'), shared: { by: c.name || c.business, at: (cur && cur.shared && cur.shared.at) || Date.now() }, updatedAt: Date.now() };
  return { person, existing: cur, match };
}
export const planContact = (c, as) => ({ own: ownCard(c), ...buildContact(c, db, as) });
// → what was saved, or false when Vdex is read-only or the card is one's own.
export function applyContact(c, as) {
  if (ownCard(c)) return false;
  let out = null;
  const ok = update(d => { out = buildContact(c, d, as); const i = d.crew.findIndex(x => x.id === out.person.id); if (i >= 0) d.crew[i] = out.person; else d.crew.push(out.person); });
  return ok === false ? false : out;
}

// What a shared link holds, turned into records of one's own: the shoot from a crew link becomes a booking, a contact
// card becomes a person on the Crew list. Both remember where they came from (record.shared), so the same thing added
// again updates what was added before instead of making a copy; an update takes what the link holds and leaves alone
// what was added by hand. Everything comes in already cleaned (js/share-data.js) and is written in one change, which
// the store refuses while Vdex is read-only. Equipment has its own module (js/gear-import.js). Loaded on first use.
import { uid, parseISO } from './util.js';
import { db, byId, update } from './store.js';
import { TYPES, DELIV_STATUS } from './workflow.js';
import { parseEighths } from './board.js';
import { isTime, mail, fromLine } from './share-data.js';

const low = v => String(v == null ? '' : v).trim().toLowerCase();
const squash = v => low(v).replace(/[\s,]+/g, ' ');
const hhmm = t => (isTime(t) ? t.padStart(5, '0') : ''); // "7:30" → "07:30", as the time boxes want it

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
// The link was made from a booking of one's own (the id is the link's reference): there is nothing to add.
export const ownBooking = snap => { const b = snap.ref ? byId('bookings', snap.ref) : null; return b && !(b.shared && b.shared.ref) ? b : null; };

// The stripboard again from the days the link carries: each day's strips, then that day's break, as on the board.
function boardFrom(snap, days) {
  const byDay = new Map(snap.scenes.map(d => [d.n, d])), count = Math.max(days, ...snap.scenes.map(d => d.n).filter(n => n <= 366)), list = [], cast = [];
  for (let n = 1; n <= count; n++) {
    for (const x of (byDay.get(n) || { items: [] }).items) {
      if (x.banner != null) { if (x.banner) list.push({ id: uid(), type: 'banner', text: x.banner }); continue; }
      x.cast.forEach(c => { if (!cast.includes(c)) cast.push(c); });
      list.push({ id: uid(), type: 'scene', scene: x.scene, ie: x.ie, set: x.set, tod: x.tod, dn: /night$/.test(x.kind) ? 'N' : 'D', desc: x.desc, cast: [...x.cast], eighths: parseEighths(x.pages) || 0, notes: '' });
    }
    list.push({ id: 'day-' + n, type: 'break' });
  }
  return list.some(x => x.type !== 'break') ? { list, cast, updatedAt: Date.now() } : null;
}

// The booking (and its venue) as it would be saved, worked out against the data given and changing nothing. Rules:
// a first import fills the booking from the link; a later one replaces what came from a link (marked `shared` on each
// hired person, schedule line, shot and deliverable; contacts by name) and keeps what was added by hand, the stage, the
// checklists, one's own crew and equipment, budget, quote, invoice and hours. An empty part of a link changes nothing.
function build(snap, d) {
  const now = Date.now(), cur = (snap.ref && d.bookings.find(b => b.shared && b.shared.ref === snap.ref)) || null, was = (cur && cur.shared) || {};
  const who = producerOf(snap), from = fromLine(who), L = snap.location, C = snap.call, odd = []; // odd: what has no box of its own, kept readable in the notes
  let endDate = snap.endDate;
  if (endDate && (parseISO(endDate) - parseISO(snap.date)) / 864e5 > 366) { odd.push(`Last day given as ${endDate}: check the dates.`); endDate = ''; }
  const days = endDate ? Math.round((parseISO(endDate) - parseISO(snap.date)) / 864e5) + 1 : 1;
  const type = (TYPES.find(t => t[1] === snap.type) || [])[0];
  if (snap.type && !type) odd.push(`Type: ${snap.type}`);

  // The place: a venue of its own when the link has more than an address, so the call sheet shows access, parking, power and the hospital.
  let venue = null;
  if (L.venue || L.access || L.parking || L.power || L.hospital || L.rules) {
    const name = L.venue || L.address.split(/[\n,]/)[0].trim() || snap.title || 'Shared venue', details = { address: L.address, access: L.access, parking: L.parking, power: L.power, hospital: L.hospital, rules: L.rules };
    const mine = snap.ref && d.venues.find(v => v.shared && v.shared.ref === snap.ref), twin = mine || d.venues.find(v => low(v.name) === low(name) && squash(v.address) === squash(L.address));
    if (twin) { // made by this link before: the link's details win; a venue of one's own with the same name and address: only its empty boxes are filled
      const record = { ...twin }; if (mine) record.name = name;
      for (const [k, v] of Object.entries(details)) if (v && (mine || !String(twin[k] || '').trim())) record[k] = v;
      venue = { record, isNew: false, changed: JSON.stringify(record) !== JSON.stringify(twin) };
    } else venue = { isNew: true, changed: true, record: { id: uid(), name, type: '', ...details, permit: 'Unknown', notes: from ? `Shared by ${from} with “${snap.title || 'a booking'}”.` : 'Added with a shared booking.', shared: { ref: snap.ref, by: from, at: now } } };
  }

  // People. The crew stay with this booking as the people on it (each with their call time), never on the Crew list;
  // the producer and the client's contacts are its contacts.
  const oldHires = (cur && cur.hires) || [], crewCall = { ...((cur && cur.crewCall) || {}) }, crewStatus = { ...((cur && cur.crewStatus) || {}) }, kept = new Set();
  let hires = oldHires;
  if (snap.crew.length) {
    hires = [...snap.crew.map(p => {
      const old = oldHires.find(x => x.shared && !kept.has(x.id) && low(x.name) === low(p.name || p.role)), id = old ? old.id : uid();
      kept.add(id); if (hhmm(p.call)) crewCall[id] = hhmm(p.call); else delete crewCall[id];
      return { rate: '', rateUnit: 'day', days: '', notes: '', ...(old || {}), id, name: p.name || p.role || 'Crew', role: p.role, phone: p.phone, email: mail(p.email), shared: true };
    }), ...oldHires.filter(x => !x.shared)];
    oldHires.filter(x => x.shared && !kept.has(x.id)).forEach(x => { delete crewCall[x.id]; delete crewStatus[x.id]; });
  }
  const people = [(who.name || who.business) && { name: who.name || who.business, role: who.name && who.business ? `Producer · ${who.business}` : 'Producer', phone: who.phone, email: who.email },
    ...snap.contacts.filter(p => p.name).map(p => ({ name: p.name, role: p.role, phone: p.phone, email: mail(p.email) }))].filter(Boolean);
  const gone = new Set([...(was.contacts || []), ...people.map(p => low(p.name))]);
  const stakeholders = [...people, ...((cur && cur.stakeholders) || []).filter(s => !gone.has(low(s.name)))];

  // The call sheet: times, the schedule, and the notes for the day.
  const cs = (cur && cur.callSheet) || {}, sched = Array.isArray(cs.schedule) ? cs.schedule : [];
  const lines = snap.schedule.filter(r => r.time || r.item).map(r => ({ id: uid(), date: r.date, time: hhmm(r.time), item: hhmm(r.time) || !r.time ? r.item : `${r.time} ${r.item}`.trim(), shared: true }));
  for (const [k, label] of [['general', 'General call'], ['lunch', 'Lunch'], ['wrap', 'Wrap']]) if (C[k] && !hhmm(C[k])) odd.push(`${label}: ${C[k]}`);
  const callSheet = { ...cs, generalCall: hhmm(C.general) || cs.generalCall || '', lunch: hhmm(C.lunch) || cs.lunch || '', wrap: hhmm(C.wrap) || cs.wrap || '', dress: C.dress || cs.dress || '', weather: C.weather || cs.weather || '',
    emergency: C.emergency || cs.emergency || '', attendees: snap.onSet || cs.attendees || '', notes: snap.notes || cs.notes || '', schedule: lines.length ? [...lines, ...sched.filter(r => r && !r.shared)] : sched, editedAt: now };
  const brk = /^(\d{1,4}) min approved(?: · (.*))?$/.exec(C.breaks);

  // Shots keep their ticks, deliverables their links: both are matched by their wording.
  const carry = (old, list, key, make) => { if (!list.length) return old; const used = new Set(); return [...list.map(x => { const o = old.find(y => y.shared && !used.has(y.id) && y[key] === x[key]); if (o) used.add(o.id); return make(x, o); }), ...old.filter(y => !y.shared)]; };
  const shots = carry((cur && cur.shots) || [], snap.shots.filter(s => s.text), 'text', (s, o) => ({ ...(o || { id: uid() }), text: s.text, done: !!(s.done || (o && o.done)), shared: true }));
  const deliverables = carry((cur && cur.deliverables) || [], snap.deliverables.filter(x => x.name), 'name', (x, o) => ({ link: '', delivered: '', ...(o || { id: uid() }), name: x.name, duration: x.duration, due: x.due, status: DELIV_STATUS.includes(x.status) ? x.status : (o && o.status) || 'Planned', shared: true }));

  // The producer's equipment is not one's own, so it is not ticked on the booking: it is listed in the notes, to read.
  const kit = new Map(); snap.kit.forEach(k => { const c = k.cat || 'Other'; kit.set(c, [...(kit.get(c) || []), k.name + (k.qty > 1 ? ` ×${k.qty}` : '')]); });
  const note = [...(kit.size ? ['Equipment on this shoot (from the shared booking):', ...[...kit].map(([c, names]) => `${c}: ${names.join(', ')}`)] : []), ...odd].join('\n');
  const own = cur ? String(cur.notes || '') : '';
  const notes = was.note && own.includes(was.note) ? own.replace(was.note, () => note).trim() : [own, note && !own.includes(note) ? note : ''].filter(Boolean).join('\n\n');

  const booking = { ...(cur || { id: uid(), status: 'Confirmed', type: type || 'other', crew: [], gear: [] }),
    title: snap.title || (cur && cur.title) || 'Shared shoot', client: snap.client || (cur && cur.client) || '', date: snap.date, start: hhmm(snap.start), end: hhmm(snap.end),
    address: L.address || (cur && cur.address) || '', stakeholders, hires, crewCall, crewStatus, shots, deliverables, callSheet, notes,
    shared: { ref: snap.ref, by: from, at: was.at || now, updated: cur ? now : 0, made: snap.made, note, contacts: people.map(p => low(p.name)) }, updatedAt: now };
  if (endDate) booking.endDate = endDate; else delete booking.endDate;
  if (brk) { booking.breakMinutes = Number(brk[1]); if (brk[2]) booking.breakNote = brk[2]; } else if (C.breaks) booking.breakNote = C.breaks.slice(0, 200);
  if (venue && !(cur && cur.venueId && d.venues.some(v => v.id === cur.venueId))) booking.venueId = venue.record.id;
  const board = snap.scenes.length ? boardFrom(snap, days) : null; if (board) booking.board = board;
  return { booking, venue, existing: cur, from };
}
// For the preview: what adding would do, with nothing changed.
export const planBooking = snap => ({ own: ownBooking(snap), ...build(snap, db) });
// Adds or updates the booking (and its venue). → what was saved, or false when Vdex is read-only or the booking is one's own.
export function applyBooking(snap) {
  if (ownBooking(snap)) return false;
  let out = null;
  const ok = update(d => {
    out = build(snap, d);
    if (out.venue && out.venue.changed) { const rec = { ...out.venue.record, updatedAt: Date.now() }, i = d.venues.findIndex(v => v.id === rec.id); if (i >= 0) d.venues[i] = rec; else d.venues.push(rec); }
    const i = d.bookings.findIndex(b => b.id === out.booking.id); if (i >= 0) d.bookings[i] = out.booking; else d.bookings.push(out.booking);
  });
  return ok === false ? false : out;
}

/* ---------------------------------- a contact card ---------------------------------- */
const digits = p => String(p || '').replace(/\D+/g, '');
// The person a card is for, if they are on the Crew list already: by email address, else phone number, else name.
export function findContact(c, d = db) {
  const e = low(c.email), ph = digits(c.phone), name = low(c.name || c.business);
  return (e && d.crew.find(x => low(x.email) === e)) || (ph.length >= 6 && d.crew.find(x => digits(x.phone) === ph)) || (name && d.crew.find(x => low(x.name) === name)) || null;
}
// A card's details replace the ones held; the rate and the notes are one's own and stay. A business and a home town
// have no box on a crew card, so they go into the notes, once.
function buildContact(c, d) {
  const cur = findContact(c, d), had = cur ? String(cur.notes || '') : '';
  const extra = [c.name && c.business && `Business: ${c.business}`, c.location && `Based in: ${c.location}`].filter(l => l && !had.includes(l));
  const person = { ...(cur || { id: uid(), role: '', phone: '', email: '', link: '', rate: '', rateUnit: 'day' }), name: c.name || c.business || c.email || c.phone,
    ...(c.title ? { role: c.title } : {}), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}), ...(c.website ? { link: c.website } : {}),
    notes: [had, ...extra].filter(Boolean).join('\n'), shared: { by: c.name || c.business, at: (cur && cur.shared && cur.shared.at) || Date.now() }, updatedAt: Date.now() };
  return { person, existing: cur };
}
export const planContact = c => buildContact(c, db);
export function applyContact(c) {
  let out = null;
  const ok = update(d => { out = buildContact(c, d); const i = d.crew.findIndex(x => x.id === out.person.id); if (i >= 0) d.crew[i] = out.person; else d.crew.push(out.person); });
  return ok === false ? false : out;
}

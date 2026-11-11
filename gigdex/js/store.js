// The one database: a JSON object kept in this browser's localStorage, written once per burst of changes. Nothing is
// sent anywhere; a backup file (js/backup.js) moves it between devices. Every change goes through update(), which
// stamps the time, saves, and tells the page to redraw.
import { uid, ymd } from './util.js';

const KEY = 'gigdex-db-v1';
// Every list of records, in the order the backup file shows them.
export const COLLECTIONS = ['bookings', 'acts', 'people', 'gear', 'kits', 'venues', 'songs', 'setlists', 'logs', 'shifts', 'insurance'];
const blank = () => ({
  app: 'gigdex', version: 1, updatedAt: 0,
  profile: { name: '', business: '', role: '', phone: '', email: '', website: '', location: '', address: '', currency: '$', bio: '', updatedAt: 0 },
  ...Object.fromEntries(COLLECTIONS.map(c => [c, []])),
  deleted: {},              // id -> time deleted: a merge with an older backup does not bring records back
  templates: {},            // the person's own checklist lines per booking kind (js/blocks/advance.js)
  billing: { updatedAt: 0 },// numbering, tax and payment details for quotes and invoices (js/money.js)
  priceList: { list: null, updatedAt: 0 }, // the person's rates, picked into quotes and invoices
});

export function normalise(raw) {
  const b = blank();
  const out = { ...b, ...(raw && typeof raw === 'object' ? raw : {}) };
  out.profile = { ...b.profile, ...(raw && raw.profile && typeof raw.profile === 'object' ? raw.profile : {}) };
  for (const c of COLLECTIONS) out[c] = Array.isArray(raw && raw[c]) ? raw[c].filter(x => x && typeof x === 'object' && x.id) : [];
  out.shifts = out.shifts.map(s => ({ ...s, breaks: Array.isArray(s.breaks) ? s.breaks : [] }));
  out.logs = out.logs.map(l => ({ ...l, takes: Array.isArray(l.takes) ? l.takes : [] }));
  out.deleted = Object.fromEntries(Object.entries(raw && raw.deleted && typeof raw.deleted === 'object' ? raw.deleted : {}).filter(([, t]) => Date.now() - t < 180 * 864e5));
  for (const k of ['templates', 'billing', 'priceList']) out[k] = raw && raw[k] && typeof raw[k] === 'object' ? raw[k] : b[k];
  out.app = 'gigdex';
  return out;
}

function load() {
  try { const raw = JSON.parse(localStorage.getItem(KEY)); if (raw && typeof raw === 'object') return normalise(raw); } catch { /* fall through */ }
  return blank();
}

export let db = load();
let rev = 0;
export const revision = () => rev;
export const serialize = () => JSON.stringify(db);
const subs = new Set();
// fn(reason): 'data' after a change. Returns an unsubscribe function.
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = (reason = 'data') => subs.forEach(fn => { try { fn(reason); } catch (e) { console.error(e); } });
export const redraw = () => emit();

// The optional app lock (js/lock.js) can hold writes while the app is locked; they are written when it opens.
let sealed = false, dirty = false;
export const isSealed = () => sealed;
export function setSealed(on) { if (on && writeQueued) writeNow(); sealed = !!on; if (!on && dirty) { dirty = false; persist(); } }

let writeQueued = false;
function writeNow() {
  writeQueued = false;
  if (sealed) { dirty = true; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('Could not save (storage full?)', e); }
}
function persist() { rev++; if (sealed) { dirty = true; return; } if (!writeQueued) { writeQueued = true; queueMicrotask(writeNow); } }
export function flush() { rev++; writeNow(); }
// Every change is allowed: kept so shared code (forms) can ask.
export const canChange = () => true;

// Mutate the database inside fn(db). Saves and redraws. Returns true.
export function update(fn, reason = 'data') {
  fn(db);
  db.updatedAt = Date.now();
  persist();
  emit(reason);
  return true;
}

// Insert or replace a record by id (a new id when it has none). Returns the stored record.
export function upsert(list, item) {
  let stored;
  update(d => {
    const arr = d[list];
    stored = { ...item, id: item.id || uid(), updatedAt: Date.now() };
    if (!stored.createdAt) stored.createdAt = stored.updatedAt;
    const i = arr.findIndex(x => x.id === stored.id);
    if (i >= 0) arr[i] = stored; else arr.push(stored);
  });
  return stored;
}

// Change some fields of a record. Returns the stored record, or null when there is no such record.
export function patch(list, id, fields) {
  const cur = byId(list, id);
  if (!cur) return null;
  return upsert(list, { ...cur, ...fields, id });
}

const without = (arr, id) => (Array.isArray(arr) ? arr.filter(x => x !== id) : []);
// Delete a record, and every reference to it elsewhere, so nothing points at a record that is gone.
export function remove(list, id) {
  const gone = byId(list, id);
  return update(d => {
    d[list] = d[list].filter(x => x.id !== id);
    d.deleted[id] = Date.now();
    const now = Date.now();
    const touch = r => { r.updatedAt = now; };
    if (list === 'people') {
      d.bookings.forEach(b => { if ((b.people || []).includes(id)) { b.people = without(b.people, id); if (b.settlement && b.settlement.shares) delete b.settlement.shares[id]; touch(b); } });
      d.acts.forEach(a => { if ((a.members || []).includes(id)) { a.members = without(a.members, id); touch(a); } });
      d.gear.forEach(g => { if (g.owner === id) { g.owner = ''; touch(g); } });
    }
    if (list === 'gear') {
      d.bookings.forEach(b => { if ((b.gear || []).includes(id)) { b.gear = without(b.gear, id); if (b.gearQty) delete b.gearQty[id]; touch(b); } });
      d.kits.forEach(k => { if ((k.items || []).includes(id)) { k.items = without(k.items, id); if (k.qty) delete k.qty[id]; touch(k); } });
    }
    if (list === 'acts') for (const c of ['bookings', 'songs', 'setlists']) d[c].forEach(r => { if (r.actId === id) { r.actId = ''; touch(r); } });
    if (list === 'venues') d.bookings.forEach(b => { if (b.venueId === id) { b.venueId = ''; b.venueName = b.venueName || (gone && gone.name) || ''; b.address = b.address || (gone && gone.address) || ''; touch(b); } });
    if (list === 'songs') {
      // A setlist keeps the song's title and length as its own, so the set still reads and times right.
      d.setlists.forEach(s => { let hit = false; (s.items || []).forEach(it => { if (it.songId === id) { it.songId = ''; it.fromSong = true; it.title = it.title || (gone && gone.title) || ''; if (!(Number(it.duration) > 0) && gone && Number(gone.duration) > 0) it.duration = Number(gone.duration); hit = true; } }); if (hit) touch(s); });
      d.bookings.forEach(b => { if ((b.songIds || []).includes(id)) { b.songIds = without(b.songIds, id); touch(b); } });
      d.logs.forEach(l => { if (l.songId === id) { l.songId = ''; touch(l); } (l.takes || []).forEach(t => { if (t.songId === id) t.songId = ''; }); });
    }
    if (list === 'setlists') d.bookings.forEach(b => { if (b.setlistId === id) { b.setlistId = ''; touch(b); } });
    if (list === 'kits') d.bookings.forEach(b => { if ((b.kits || []).includes(id)) { b.kits = without(b.kits, id); touch(b); } });
    if (list === 'bookings') {
      d.logs.forEach(l => { if (l.bookingId === id) { l.bookingId = ''; touch(l); } });
      d.shifts.forEach(s => { if (s.bookingId === id) { s.bookingId = ''; touch(s); } });
    }
  });
}

export const byId = (list, id) => (id && Array.isArray(db[list]) ? db[list].find(x => x.id === id) : undefined) || null;

/* ------------------------------- bookings ------------------------------- */
export const lastDay = b => (b.endDate && b.endDate > b.date ? b.endDate : b.date);
export const covers = (b, date) => !!b.date && b.date <= date && date <= lastDay(b);
export const overlaps = (a, b) => !!a.date && !!b.date && a.date <= lastDay(b) && b.date <= lastDay(a);
export const activeBookings = () => db.bookings.filter(b => b.status !== 'cancelled');
const firstOf = b => (b.kind === 'show' ? b.loadIn || b.soundcheck || b.doors || b.setTime : b.start) || '';
// The bookings on a day, earliest first.
export const bookingsOn = date => db.bookings.filter(b => covers(b, date)).sort((a, b) => firstOf(a).localeCompare(firstOf(b)));
// Upcoming (today on), soonest first.
export const upcoming = (from = ymd(new Date())) => activeBookings().filter(b => b.date && lastDay(b) >= from).sort((a, b) => (a.date + firstOf(a)).localeCompare(b.date + firstOf(b)));
const byDate = (a, b) => String(a.date || '').localeCompare(String(b.date || ''));
export const personBookings = id => activeBookings().filter(b => (b.people || []).includes(id)).sort(byDate);
export const gearBookings = id => activeBookings().filter(b => (b.gear || []).includes(id)).sort(byDate);
// Other live bookings on overlapping days that need the same person.
export const personClash = (booking, personId) => activeBookings().filter(b => b.id !== booking.id && overlaps(b, booking) && (b.people || []).includes(personId));

/* ------------------------------- gear ------------------------------- */
export const qtyOf = g => Math.max(1, Math.floor(Number(g && g.qty)) || 1);
export const usedQty = (owner, gearId) => Math.max(1, Math.floor(Number(owner && owner.gearQty && owner.gearQty[gearId])) || 1);
// How many of an item a stage pack holds (packs keep counts in kit.qty; bookings in booking.gearQty).
export const packQty = (kit, gearId) => Math.max(1, Math.floor(Number(kit && kit.qty && kit.qty[gearId])) || 1);
export const unitValue = g => Number(g && g.value) || 0;
export const totalValue = g => unitValue(g) * qtyOf(g);
// Other live bookings on overlapping days that use the same item, when together they need more than are owned.
export const gearClash = (booking, gearId) => {
  const g = byId('gear', gearId);
  const others = activeBookings().filter(b => b.id !== booking.id && overlaps(b, booking) && (b.gear || []).includes(gearId));
  const need = usedQty(booking, gearId) + others.reduce((s, b) => s + usedQty(b, gearId), 0);
  return need > qtyOf(g) ? others : [];
};

/* ------------------------------- whole database ------------------------------- */
export function replaceAll(data) { db = normalise(data); db.updatedAt = Date.now(); persist(); emit(); }
export const exportJSON = () => JSON.stringify(db, null, 2);

const ts = r => Number(r && r.updatedAt) || 0;
const newer = (x, y) => (ts(y) > ts(x) ? y : x);
function mergeList(a, b, dead) {
  const m = new Map(); (a || []).forEach(x => m.set(x.id, x));
  (b || []).forEach(y => { const x = m.get(y.id); m.set(y.id, x ? newer(x, y) : y); });
  return [...m.values()].filter(x => !(dead[x.id] > ts(x)));
}
// Two copies into one: each record follows its newer copy, and a deletion wins over an older copy of the record.
export function mergeDb(local, remote) {
  const a = normalise(local), b = normalise(remote);
  const dead = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted || {})) dead[id] = Math.max(dead[id] || 0, t);
  const out = { ...a, deleted: dead };
  for (const c of COLLECTIONS) out[c] = mergeList(a[c], b[c], dead);
  for (const k of ['templates', 'billing', 'priceList']) out[k] = ts(b[k]) > ts(a[k]) ? b[k] : a[k];
  // A real profile always beats a blank one or the sample's stand-in, whatever their times; otherwise the newer wins.
  const standIn = p => !p || !String(p.name || '').trim() || (p.name === SAMPLE_PROFILE.name && p.business === SAMPLE_PROFILE.business);
  out.profile = standIn(a.profile) !== standIn(b.profile) ? (standIn(a.profile) ? b.profile : a.profile) : ts(b.profile) > ts(a.profile) ? b.profile : a.profile;
  out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);
  return out;
}
export function mergeIn(remote) { db = mergeDb(db, remote); db.updatedAt = Date.now(); persist(); emit(); }

// Wipe this device's copy (preferences such as the theme stay).
export function eraseAll() {
  db = blank(); db.updatedAt = Date.now();
  sealed = false; dirty = false;
  flush(); emit();
  const KEEP = new Set(['gigdex-prefs', 'gigdex-tab']);
  try { const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); keys.filter(k => k && k.startsWith('gigdex-') && k !== KEY && !KEEP.has(k)).forEach(k => localStorage.removeItem(k)); } catch { /* blocked storage */ }
}

/* ------------------------------- sample ------------------------------- */
// The stand-in profile the sample fills in when there is none (Settings → Remove the sample clears it again).
export const SAMPLE_PROFILE = { name: 'Sample Producer', business: 'Sample Sound', role: 'Producer' };
// A small band and a producer's week, dated around today, so every page has something to show (and the tests have
// fixed ids to reach for). Records already present are left alone.
export function loadSample() {
  const day = n => ymd(new Date(Date.now() + n * 864e5));
  const at = (n, hh, mm = 0) => { const d = new Date(Date.now() + n * 864e5); d.setHours(hh, mm, 0, 0); return d.getTime(); };
  const now = Date.now();
  const S = {
    people: [
      { id: 's-maya', name: 'Maya Brooks', group: 'band', role: 'Vocals', instrument: 'Vocals, rhythm guitar', phone: '+1 555 0141', email: 'maya@example.com', notes: 'Sample record. Vocal mic: own Beta 58.' },
      { id: 's-leo', name: 'Leo Grant', group: 'band', role: 'Bass', instrument: 'Bass', phone: '+1 555 0142', email: 'leo@example.com' },
      { id: 's-priya', name: 'Priya Shah', group: 'band', role: 'Drums', instrument: 'Drums', phone: '+1 555 0143', email: 'priya@example.com', notes: 'Left-handed kit.' },
      { id: 's-jonah', name: 'Jonah Reyes', group: 'band', role: 'Keys', instrument: 'Keys, synth bass', phone: '+1 555 0144', email: 'jonah@example.com' },
      { id: 's-sable', name: 'Sable', group: 'band', role: 'Vocals', instrument: 'Vocals', email: 'sable@example.com', notes: 'Artist, in production for the EP.' },
      { id: 's-marcus', name: 'Marcus Bell', group: 'session', role: 'Session musician', instrument: 'Guitar', phone: '+1 555 0150', email: 'marcus@example.com', rate: 180, rateUnit: 'day' },
      { id: 's-dee', name: 'Dee Okafor', group: 'crew', role: 'FOH engineer', phone: '+1 555 0160', email: 'dee@example.com', rate: 200, rateUnit: 'day' },
      { id: 's-tom', name: 'Tom Hale', group: 'crew', role: 'Tour manager', phone: '+1 555 0161', email: 'tom@example.com' },
      { id: 's-rosa', name: 'Rosa Lind', group: 'contact', role: 'Promoter', company: 'Lantern Live', phone: '+1 555 0170', email: 'rosa@example.com' },
      { id: 's-ivy', name: 'Ivy Chen', group: 'contact', role: 'Booking agent', company: 'Northline Agency', phone: '+1 555 0171', email: 'ivy@example.com' },
    ],
    acts: [
      { id: 's-owls', name: 'The Night Owls', genre: 'Indie rock', color: '#ff5c8a', members: ['s-maya', 's-leo', 's-priya', 's-jonah'], email: 'band@example.com', bio: 'Four-piece indie rock from the harbour side. Sample act.',
        links: 'Website: https://example.com/nightowls\nSpotify: https://open.spotify.com/artist/example\nInstagram: https://instagram.com/example',
        inputList: [
          { id: 'in1', ch: 1, source: 'Kick', mic: 'Beta 91 / D112', stand: 'Short boom' }, { id: 'in2', ch: 2, source: 'Snare', mic: 'SM57', stand: 'Short boom' },
          { id: 'in3', ch: 3, source: 'Overhead L', mic: 'Condenser', stand: 'Tall boom' }, { id: 'in4', ch: 4, source: 'Overhead R', mic: 'Condenser', stand: 'Tall boom' },
          { id: 'in5', ch: 5, source: 'Bass DI', mic: 'DI', stand: '' }, { id: 'in6', ch: 6, source: 'Guitar amp', mic: 'SM57', stand: 'Short boom' },
          { id: 'in7', ch: 7, source: 'Keys L', mic: 'DI', stand: '' }, { id: 'in8', ch: 8, source: 'Keys R', mic: 'DI', stand: '' },
          { id: 'in9', ch: 9, source: 'Lead vocal', mic: 'Beta 58 (own)', stand: 'Tall boom' }, { id: 'in10', ch: 10, source: 'Backing vocal', mic: 'SM58', stand: 'Tall boom' },
        ],
        riderTech: '4 monitor mixes. Drum riser if available.', riderHospitality: 'Water, 8 towels, hot food for 6.' },
      { id: 's-sablea', name: 'Sable', genre: 'Alt R&B', color: '#22d3ee', members: ['s-sable'], bio: 'Solo artist; debut EP in production. Sample act.' },
    ],
    venues: [
      { id: 's-lantern', kind: 'venue', name: 'The Lantern Rooms', address: '12 Quay Street, Harbourtown', geo: { lat: 51.5072, lon: -0.1276 }, capacity: 350, stage: '6m × 4m', pa: 'd&b, Midas M32 at FOH', backline: 'Drum kit shell pack, bass cab', loadIn: 'Rear door on Ship Lane, 2 steps', parking: '2 spaces behind the venue', curfew: '23:00', noiseLimit: 98, contact: 'Rosa Lind', phone: '+1 555 0170', email: 'rosa@example.com', notes: 'Sample venue.' },
      { id: 's-harbour', kind: 'venue', name: 'Harbour Hall', address: '1 Pier Road, Harbourtown', capacity: 900, curfew: '23:30', noiseLimit: 102, stage: '10m × 7m' },
      { id: 's-greenfield', kind: 'festival', name: 'Greenfield Festival', address: 'Greenfield Park', capacity: 5000, curfew: '22:30', noiseLimit: 95, notes: 'Outdoor. Changeovers are 15 minutes, strict.' },
      { id: 's-echo', kind: 'studio', name: 'Echo Chamber Studios', address: '4 Mill Yard, Harbourtown', rate: 45, rateUnit: 'hour', backline: 'Rhodes, upright piano, drum kit, amps', notes: 'Live room fits a five-piece.' },
      { id: 's-basement', kind: 'rehearsal', name: 'Basement Rehearsal Rooms', address: '88 Canal Street', rate: 15, rateUnit: 'hour' },
    ],
    gear: [
      { id: 's-tele', name: 'Telecaster', category: 'Guitars', make: 'Fender', model: 'Player Telecaster', serial: 'MX21000001', value: 800, owner: 's-maya' },
      { id: 's-pbass', name: 'P-Bass', category: 'Basses', make: 'Fender', model: 'Precision Bass', serial: 'MX19000002', value: 900, owner: 's-leo' },
      { id: 's-hotrod', name: 'Hot Rod Deluxe', category: 'Amps & cabs', make: 'Fender', model: 'Hot Rod Deluxe IV', serial: 'B-1234567', value: 750 },
      { id: 's-nord', name: 'Nord Stage 3', category: 'Keys & synths', make: 'Nord', model: 'Stage 3 88', serial: 'NS3-0042', value: 3800, owner: 's-jonah' },
      { id: 's-kit', name: 'Drum kit', category: 'Drums & percussion', make: 'Gretsch', model: 'Catalina Club', value: 1100, owner: 's-priya' },
      { id: 's-sm58', name: 'SM58', category: 'Microphones', make: 'Shure', model: 'SM58', value: 99, qty: 4 },
      { id: 's-sm57', name: 'SM57', category: 'Microphones', make: 'Shure', model: 'SM57', value: 99, qty: 3 },
      { id: 's-di', name: 'DI box', category: 'DI & interfaces', make: 'Radial', model: 'ProDI', value: 99, qty: 4 },
      { id: 's-apollo', name: 'Apollo Twin', category: 'DI & interfaces', make: 'Universal Audio', model: 'Apollo Twin X', serial: 'UA-778899', value: 1100 },
      { id: 's-mbp', name: 'MacBook Pro', category: 'Computers & software', make: 'Apple', model: 'MacBook Pro 14', serial: 'C02XXXXXX', value: 2200 },
    ],
    kits: [
      { id: 's-clubpack', name: 'Club show pack', items: ['s-tele', 's-pbass', 's-hotrod', 's-nord', 's-sm58', 's-di'], qty: { 's-sm58': 2, 's-di': 3 } },
      { id: 's-studiopack', name: 'Studio pack', items: ['s-apollo', 's-mbp', 's-sm57'], qty: {} },
    ],
    songs: [
      ['s-song1', 'Harbour Lights', 'A minor', 128, 214], ['s-song2', 'Paper Moon', 'C major', 96, 241], ['s-song3', 'Low Tide', 'E minor', 82, 268],
      ['s-song4', 'Static Hearts', 'G major', 140, 189], ['s-song5', 'Northbound', 'D major', 118, 232], ['s-song6', 'Ghost Signal', 'F♯/G♭ minor', 104, 255],
      ['s-song7', 'Lanterns', 'B♭ major', 122, 203], ['s-song8', 'Last Ferry Home', 'A major', 76, 297],
    ].map(([id, title, key, bpm, duration]) => ({ id, title, actId: 's-owls', key: key.replace('B♭', 'A♯/B♭'), bpm, duration, status: 'released' })).concat([
      { id: 's-sable1', title: 'Glasshouse', actId: 's-sablea', key: 'C♯/D♭ minor', bpm: 88, duration: 201, status: 'mixing', splits: [{ id: 'sp1', name: 'Sable', role: 'Writer', share: 50, pro: 'ASCAP' }, { id: 'sp2', name: 'You (producer)', role: 'Producer', share: 50, pro: 'BMI' }] },
      { id: 's-sable2', title: 'Undertow', actId: 's-sablea', key: 'F minor', bpm: 72, duration: 0, status: 'recording' },
    ]),
    setlists: [
      { id: 's-clubset', name: 'Club set', actId: 's-owls', gap: 20, items: [
        { id: 'i1', songId: 's-song4' }, { id: 'i2', songId: 's-song1' }, { id: 'i3', songId: 's-song5', segue: true }, { id: 'i4', songId: 's-song7' },
        { id: 'i5', songId: 's-song2' }, { id: 'i6', songId: 's-song6' }, { id: 'i7', songId: 's-song3' }, { id: 'i8', songId: 's-song8', encore: true }] },
    ],
    bookings: [
      { id: 's-show1', kind: 'show', status: 'confirmed', actId: 's-owls', date: day(5), venueId: 's-lantern', loadIn: '17:00', soundcheck: '18:00', doors: '19:30', setTime: '21:15', setLength: 45, curfew: '23:00',
        contact: { name: 'Rosa Lind', role: 'Promoter', phone: '+1 555 0170', email: 'rosa@example.com' },
        deal: { type: 'versus', fee: 250, pct: 70, ticketPrice: 12, capacity: 350, expenses: 300, deposit: 100, depositPaid: true },
        runningOrder: [{ id: 'r1', act: 'Doors', time: '19:30', length: 0 }, { id: 'r2', act: 'Paper Kites (support)', time: '20:15', length: 35 }, { id: 'r3', act: 'The Night Owls', time: '21:15', length: 45, ours: true }],
        guestList: [{ id: 'g1', name: 'Ivy Chen', plus: 1, note: 'Agent' }, { id: 'g2', name: 'Sam (photographer)', plus: 0 }], guestCap: 6,
        hospitality: 'Rider: water, hot food for 6, 8 drinks tokens.', accommodation: 'Seaview Inn, 2 rooms, booked by the promoter', parking: '2 spaces behind the venue',
        setlistId: 's-clubset', people: ['s-maya', 's-leo', 's-priya', 's-jonah', 's-dee'], gear: ['s-tele', 's-pbass', 's-hotrod', 's-nord', 's-sm58', 's-di'], gearQty: { 's-sm58': 2, 's-di': 3 },
        checks: { 'show-contract': true, 'show-deposit': true }, budget: [{ id: 'bg1', cat: 'Travel', desc: 'Van hire + fuel', amount: 120 }], notes: 'Sample show.' },
      { id: 's-show2', kind: 'show', status: 'offer', actId: 's-owls', date: day(19), venueId: 's-harbour', doors: '19:00', setTime: '21:00', setLength: 60, curfew: '23:30',
        contact: { name: 'Ivy Chen', role: 'Booking agent', phone: '+1 555 0171', email: 'ivy@example.com' }, deal: { type: 'guarantee', fee: 800, ticketPrice: 18, capacity: 900, deposit: 400 }, people: ['s-maya', 's-leo', 's-priya', 's-jonah'] },
      { id: 's-fest', kind: 'show', status: 'hold', actId: 's-owls', date: day(40), endDate: day(41), venueId: 's-greenfield', setTime: '16:30', setLength: 30, deal: { type: 'guarantee', fee: 1500 } },
      { id: 's-past', kind: 'show', status: 'done', actId: 's-owls', date: day(-10), venueId: 's-lantern', doors: '19:30', setTime: '21:00', setLength: 45, curfew: '23:00',
        deal: { type: 'versus', fee: 250, pct: 70, ticketPrice: 12, capacity: 350, expenses: 300, deposit: 100, depositPaid: true },
        settlement: { tickets: 214, comps: 12, merch: [{ id: 'm1', item: 'T-shirt', start: 40, end: 29, price: 20 }, { id: 'm2', item: 'Vinyl', start: 15, end: 9, price: 25 }], costs: [{ id: 'c1', desc: 'Strings & sticks', amount: 35 }], received: 1338 },
        people: ['s-maya', 's-leo', 's-priya', 's-jonah'], setlistId: 's-clubset' },
      { id: 's-sess1', kind: 'session', status: 'confirmed', actId: 's-sablea', date: day(2), venueId: 's-echo', start: '10:00', end: '18:00', rate: 45, rateUnit: 'hour', songIds: ['s-sable2'],
        people: ['s-sable', 's-marcus'], gear: ['s-apollo', 's-mbp'], deliverables: [{ id: 'd1', t: 'Rough mix of Undertow', due: day(4), done: false }, { id: 'd2', t: 'Stems for the mix engineer', due: day(9), done: false }], notes: 'Vocals and guitar overdubs.' },
      { id: 's-sess0', kind: 'session', status: 'done', actId: 's-sablea', date: day(-3), venueId: 's-echo', start: '11:00', end: '17:00', rate: 45, rateUnit: 'hour', songIds: ['s-sable1'], people: ['s-sable'],
        deliverables: [{ id: 'd3', t: 'Comp lead vocal', done: true }] },
      { id: 's-reh', kind: 'rehearsal', status: 'confirmed', actId: 's-owls', date: day(3), venueId: 's-basement', start: '19:00', end: '22:00', people: ['s-maya', 's-leo', 's-priya', 's-jonah'], setlistId: 's-clubset' },
    ],
    logs: [
      { id: 's-log1', bookingId: 's-sess0', date: day(-3), title: 'Glasshouse vocals', songId: 's-sable1', startedAt: at(-3, 11), takes: [
        { id: 't1', n: 1, songId: 's-sable1', at: at(-3, 11, 20), rating: 'maybe', text: 'Pitchy in the bridge' },
        { id: 't2', n: 2, songId: 's-sable1', at: at(-3, 11, 31), rating: 'keep', text: 'Great verse 1 + chorus' },
        { id: 't3', n: 3, songId: 's-sable1', at: at(-3, 11, 44), rating: 'keep', text: 'Use the bridge from this one' }] },
    ],
    shifts: [{ id: 's-shift1', bookingId: 's-sess0', start: at(-3, 11), end: at(-3, 17, 15), breaks: [{ start: at(-3, 13, 30), end: at(-3, 14) }] }],
    insurance: [
      { id: 's-ins1', type: 'Instruments & equipment', provider: 'Sample Music Insurance', policy: 'MI-20481', cover: 12000, premium: 210, renewal: day(75) },
      { id: 's-ins2', type: 'Public liability', provider: 'Sample Music Insurance', policy: 'PL-55120', cover: 5000000, premium: 95, renewal: day(20), notes: 'Venues ask for this certificate.' },
    ],
  };
  update(d => {
    for (const [list, recs] of Object.entries(S)) for (const r of recs) if (!d[list].some(x => x.id === r.id)) d[list].push({ ...r, sample: true, createdAt: now, updatedAt: now });
    if (!d.profile.name) d.profile = { ...d.profile, ...SAMPLE_PROFILE }; // its time is left as it was, so it never wins a merge with a real profile
  });
}

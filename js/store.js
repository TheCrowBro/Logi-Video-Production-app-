// Single JSON database. Lives in localStorage for speed/offline, and is mirrored to a
// file you pick inside any cloud-synced folder (Google Drive, Dropbox, OneDrive, iCloud Drive...)
// using the File System Access API where available. Export/Import covers everything else.
import { uid, ymd } from './util.js';
import { fileAdapter, dropboxAdapter, gdriveAdapter, onedriveAdapter, webdavAdapter, dropboxBegin, dropboxFinish } from './providers.js';

const KEY = 'logi-db-v1';
const blank = () => ({
  version: 1, updatedAt: 0,
  profile: { name: '', business: '', title: '', phone: '', email: '', website: '', location: '', currency: '$', bio: '' },
  bookings: [], crew: [], gear: [], insurance: [], kits: [], venues: [], logs: [], shifts: [],
  deleted: {}, // id -> time deleted (tombstones, so a merge with an older copy doesn't bring records back)
  calSync: { provider: null, calendarId: null, events: {}, feed: false, updatedAt: 0 }, // calendar link + event ids per booking
  templates: {}, // per job type: edited checklist lines per stage
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') return normalise(raw);
  } catch { /* fall through */ }
  return blank();
}

function normalise(raw) {
  const b = blank();
  return {
    ...b, ...raw,
    profile: { ...b.profile, ...(raw.profile || {}) },
    bookings: Array.isArray(raw.bookings) ? raw.bookings : [],
    crew: Array.isArray(raw.crew) ? raw.crew : [],
    gear: Array.isArray(raw.gear) ? raw.gear : [],
    insurance: Array.isArray(raw.insurance) ? raw.insurance : [],
    kits: Array.isArray(raw.kits) ? raw.kits : [],
    venues: Array.isArray(raw.venues) ? raw.venues : [],
    shifts: Array.isArray(raw.shifts) ? raw.shifts.map(s => ({ ...s, breaks: Array.isArray(s.breaks) ? s.breaks : [] })) : [],
    logs: Array.isArray(raw.logs) ? raw.logs.map(l => ({ ...l, notes: Array.isArray(l.notes) ? l.notes : [], scriptAt: Number(l.scriptAt) || (l.script ? Date.parse(l.script.imported) || 1 : 0) })) : [],
    deleted: Object.fromEntries(Object.entries(raw.deleted && typeof raw.deleted === 'object' ? raw.deleted : {}).filter(([, t]) => Date.now() - t < 180 * 864e5)),
    calSync: { ...b.calSync, ...(raw.calSync && typeof raw.calSync === 'object' ? raw.calSync : {}), events: raw.calSync?.events && typeof raw.calSync.events === 'object' ? raw.calSync.events : {} },
    templates: raw.templates && typeof raw.templates === 'object' ? raw.templates : {},
  };
}

export let db = load();
// The app lock seals the plaintext copy while the app is hidden or locked; writes then wait in memory for the unseal.
let sealed = false, dirty = false, pendingSync = false, rev = 0;
export const revision = () => rev;
export const isSealed = () => sealed;
export const serialize = () => JSON.stringify(db);
export function setSealed(on) { sealed = on; if (!on) { if (dirty) { dirty = false; persistLocal(); } if (pendingSync) { pendingSync = false; schedulePush(); } } }
export function flush() { persistLocal(); }
export function reload() { db = load(); rev++; emit(); }
export const touch = () => emit();
const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach(fn => fn());

function persistLocal() {
  rev++;
  if (sealed) { dirty = true; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('localStorage full?', e); }
}

// Mutate the db inside fn, then save + sync.
export function update(fn) {
  fn(db);
  db.updatedAt = Date.now();
  persistLocal();
  emit();
  schedulePush();
}

export function upsert(list, item) {
  update(d => {
    const arr = d[list];
    const i = arr.findIndex(x => x.id === item.id);
    const stamped = { ...item, id: item.id || uid(), updatedAt: Date.now() };
    if (i >= 0) arr[i] = stamped; else arr.push(stamped);
  });
}

export function remove(list, id) {
  update(d => {
    d[list] = d[list].filter(x => x.id !== id);
    d.deleted[id] = Date.now();
    if (list === 'gear') { d.bookings.forEach(b => { b.gear = (b.gear || []).filter(g => g !== id); if (b.gearQty) delete b.gearQty[id]; }); d.kits.forEach(k => { if (k.gearQty) delete k.gearQty[id]; }); d.kits.forEach(k => k.gear = (k.gear || []).filter(g => g !== id)); }
    if (list === 'bookings') { d.logs.forEach(l => { if (l.bookingId === id) delete l.bookingId; }); d.shifts.forEach(s => { if (s.bookingId === id) { s.bookingId = null; s.updatedAt = Date.now(); } }); }
    if (list === 'venues') d.bookings.forEach(b => { if (b.venueId === id) delete b.venueId; });
    if (list === 'kits') d.bookings.forEach(b => b.kits = (b.kits || []).filter(k => k !== id));
    if (list === 'crew') d.bookings.forEach(b => b.crew = (b.crew || []).filter(c => c !== id));
  });
}

export const byId = (list, id) => db[list].find(x => x.id === id);

// A booking may span several days: date .. endDate (inclusive).
export const endOf = b => (b.endDate && b.endDate > b.date ? b.endDate : b.date);
export const covers = (b, date) => b.date <= date && date <= endOf(b);
export const overlaps = (a, b) => a.date <= endOf(b) && b.date <= endOf(a);

export const bookingsOn = date =>
  db.bookings.filter(b => covers(b, date)).sort((a, b) => (a.start || '').localeCompare(b.start || ''));

export const activeBookings = () => db.bookings.filter(b => b.status !== 'Cancelled');

export const gearBookings = id =>
  activeBookings().filter(b => (b.gear || []).includes(id)).sort((a, b) => a.date.localeCompare(b.date));

export const crewBookings = id =>
  activeBookings().filter(b => (b.crew || []).includes(id)).sort((a, b) => a.date.localeCompare(b.date));

// Quantities: an item can be owned in several units (g.qty); bookings and kits record how many they use.
export const qtyOf = g => Math.max(1, Math.floor(Number(g && g.qty)) || 1);
export const usedQty = (owner, gearId) => Math.max(1, Math.floor(Number(owner.gearQty && owner.gearQty[gearId])) || 1);
export const unitValue = g => (Number(g.value) || 0);
export const totalValue = g => unitValue(g) * qtyOf(g);

// Other active bookings overlapping this one that use the same gear, but only when together they need
// more units than you own (so 4 lights shared 2 + 2 is fine, 2 + 3 is a clash).
export const gearClash = (booking, gearId) => {
  const g = byId('gear', gearId);
  const others = activeBookings().filter(b => b.id !== booking.id && overlaps(b, booking) && (b.gear || []).includes(gearId));
  const need = usedQty(booking, gearId) + others.reduce((s, b) => s + usedQty(b, gearId), 0);
  return need > qtyOf(g) ? others : [];
};

export function replaceAll(data) {
  db = normalise(data);
  db.updatedAt = Date.now();
  persistLocal();
  emit();
  schedulePush();
}

export function exportJSON() { return JSON.stringify(db, null, 2); }

// Wipe this device: unlink storage first so the cloud copy is left alone.
export async function eraseAll() {
  await unlinkCloud();
  db = blank(); db.updatedAt = Date.now();
  sealed = false; dirty = false;
  persistLocal(); emit();
  // The lock's vault, PIN and backup marks go too, otherwise the next start would bring the old data back.
  ['logi-vault', 'logi-lock', 'logi-backup-cloud', 'logi-backup-export', 'logi-sync-at', 'logi-backup-nudge', 'logi-loc'].forEach(k => lsSet(k, null));
  setTimeout(() => location.reload(), 600);
}

export function loadSample() {
  const d = new Date(); const iso = (off) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const venueA = uid(), todayJob = uid(), past0 = uid(), past1 = uid(), past2 = uid(), past3 = uid();
  // worked days for the hours chart: [booking, days ago, start h, end h, break min]
  const shift = (bid, ago, sh, eh, bm) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ago, sh, 0); const start = x.getTime(); return { id: uid(), bookingId: bid, date: iso(-ago), start, end: start + (eh - sh) * 36e5, breaks: bm ? [{ start: start + 4 * 36e5, end: start + 4 * 36e5 + bm * 6e4 }] : [], updatedAt: start }; };
  const g = (name, category, value, serial = '', qty = 1) => ({ id: uid(), name, category, value, serial, qty, notes: '' });
  const gear = [
    g('Sony FX6 body', 'Camera', 6000, 'FX6-120934'), g('Sony FE 24-70mm f/2.8 GM II', 'Lens', 2300),
    g('Sigma 18-35mm f/1.8', 'Lens', 800), g('Aputure 600d Pro', 'Lighting', 1900), g('Aputure MC (RGB pocket light)', 'Lighting', 125, '', 4),
    g('Sennheiser MKH 416', 'Audio', 1000), g('Sound Devices MixPre-6 II', 'Audio', 900), g('Sachtler Flowtech 75 tripod', 'Support', 1400),
    g('DJI Mavic 3 Pro', 'Drone', 2200), g('Atomos Ninja V+', 'Monitoring', 900),
  ];
  const crew = [
    { id: uid(), name: 'Sam Rivera', role: 'Sound Recordist', phone: '+1 555 0101', email: 'sam@example.com', link: 'https://example.com/sam', rate: '$450/day', notes: '' },
    { id: uid(), name: 'Jo Chen', role: '1st AC', phone: '+1 555 0102', email: 'jo@example.com', link: 'https://example.com/jo', rate: '$400/day', notes: '' },
    { id: uid(), name: 'Mika Dahl', role: 'Gaffer', phone: '+1 555 0103', email: '', link: 'https://example.com/mika', rate: '$425/day', notes: '' },
    { id: uid(), name: 'Priya Nair', role: 'Editor', phone: '', email: 'priya@example.com', link: 'https://example.com/priya', rate: '$55/hr', notes: '' },
  ];
  db = normalise({
    ...db,
    gear, crew,
    bookings: [
      { id: uid(), title: 'Harbour Brewing brand film', client: 'Harbour Brewing Co.', type: 'brand', date: iso(2), start: '07:30', end: '17:00', status: 'Prepped', venueId: venueA, checks: { 'confirmed:deposit-received': 1, 'confirmed:booking-in-the-calendar': 1, 'confirmed:crew-asked-and-confirmed': 1, 'confirmed:venue-confirmed-permits-requested': 1, 'confirmed:insurance-certificate-sent': 1, 'confirmed:hires-booked': 1, 'prepped:shot-list-storyboard-done': 1, 'prepped:treatment-and-shot-list-approved': 1 }, crewStatus: { [crew[0].id]: 'confirmed', [crew[1].id]: 'asked' }, crewCall: { [crew[0].id]: '07:30', [crew[1].id]: '07:00' }, shots: [{ id: uid(), text: 'Wide: steam over the mash tun at first light', done: false }, { id: uid(), text: 'Ana interview, two lights, 50mm', done: false }, { id: uid(), text: 'Keg roll to the van, tracking', done: false }], hires: [{ id: uid(), item: 'Easyrig Vario 5', from: 'Dock Rentals', cost: 60, pickup: iso(1), return: iso(3), booked: 'yes' }], deliverables: [{ id: uid(), name: 'Brand film 16:9, 90 s', duration: '90 s', due: iso(23), status: 'Planned', link: '', delivered: '' }, { id: uid(), name: 'Social cut 9:16, 30 s', duration: '30 s', due: iso(27), status: 'Planned', link: '', delivered: '' }], address: '12 Dock Road, Portside', stakeholders: [{ name: 'Ana Ruiz', role: 'Marketing lead', phone: '+1 555 0199' }, { name: 'Tom Hale', role: 'Head brewer', phone: '' }], crew: [crew[0].id, crew[1].id], gear: [gear[0].id, gear[1].id, gear[3].id, gear[4].id, gear[5].id, gear[6].id], gearQty: { [gear[4].id]: 2 }, notes: 'Golden hour exterior at 17:30. Parking behind the loading bay.' },
      { id: uid(), title: 'Corporate interviews', client: 'Northline Legal', type: 'corporate', date: iso(2), start: '19:00', end: '21:00', status: 'Quoted', checks: { 'enquiry:brief-received-objectives-audience-deliverables': 1, 'enquiry:budget-range-known': 1, 'quoted:quote-estimate-sent': 1 }, address: '88 King Street, Level 9', stakeholders: [{ name: 'Dee Okafor', role: 'Comms', phone: '+1 555 0144' }], crew: [], gear: [gear[0].id, gear[4].id, gear[5].id], gearQty: { [gear[4].id]: 2 }, notes: '' },
      { id: uid(), title: 'Wedding weekend', client: 'Lee & Marcus', type: 'wedding', date: iso(9), endDate: iso(11), start: '10:00', end: '22:00', status: 'Confirmed', checks: { 'confirmed:deposit-received': 1 }, address: 'Elm Hall Gardens', stakeholders: [{ name: 'Lee Park', role: 'Client', phone: '+1 555 0177' }], crew: [crew[1].id], gear: [gear[0].id, gear[2].id, gear[8].id], notes: '' },
      { id: todayJob, title: 'Location recce — Elm Hall', client: 'Lee & Marcus', date: iso(0), start: '10:00', end: '14:00', status: 'Confirmed', address: 'Elm Hall Gardens', breakMinutes: 30, breakNote: '30 min lunch', stakeholders: [], crew: [], gear: [gear[0].id, gear[2].id], notes: 'Walk the ceremony route and check power at the marquee.' },
      { id: past1, title: 'Corporate headshots', client: 'Northline Legal', date: iso(-12), start: '08:00', end: '17:00', status: 'Delivered', address: '88 King Street, Level 9', breakMinutes: 45, stakeholders: [], crew: [crew[2].id], gear: [gear[0].id, gear[3].id, gear[4].id], gearQty: { [gear[4].id]: 2 }, notes: '' },
      { id: past2, title: 'Festival highlights', client: 'Portside Council', date: iso(-20), endDate: iso(-19), start: '11:00', end: '23:00', status: 'Delivered', address: 'Harbour Green', breakMinutes: 60, stakeholders: [], crew: [crew[0].id, crew[1].id], gear: [gear[0].id, gear[1].id, gear[8].id], notes: '' },
      { id: past3, title: 'Real-estate walkthrough', client: 'Dockside Lettings', date: iso(-33), start: '09:00', end: '12:00', status: 'Delivered', address: '4 Quay Lane', breakMinutes: 15, stakeholders: [], crew: [], gear: [gear[0].id, gear[8].id], notes: '' },
      { id: past0, title: 'Product shots', client: 'Kiln & Co', type: 'brand', media: [{ id: uid(), label: 'A001', d1: true, d2: true, off: true, ver: true, clr: true }, { id: uid(), label: 'A002', d1: true, d2: true, off: false, ver: true, clr: false }], deliverables: [{ id: uid(), name: 'Product stills set (24)', duration: '', due: iso(3), status: 'Sent for review', link: '', delivered: '' }], licences: [{ id: uid(), kind: 'Music', title: 'Slow Pour — Artlist', licence: 'AL-88213', source: '', cost: 0 }], date: iso(-4), start: '09:00', end: '15:00', status: 'In post', address: 'Studio B, Foundry Lane', stakeholders: [], crew: [crew[2].id], gear: [gear[0].id, gear[3].id], notes: '' },
    ],
    venues: [
      { id: venueA, name: 'Harbour Brewing Co. taproom', type: 'Retail / restaurant', address: '12 Dock Road, Portside', geo: { lat: 51.5033, lon: -0.1195 }, contact: 'Ana Ruiz', phone: '+1 555 0199', email: '', perms: { tripods: 'allowed', lighting: 'allowed', flash: 'ask', haze: 'no', drones: 'ask', generators: 'no', dollies: 'allowed', audio: 'allowed', pyro: 'no' }, rules: 'No filming of customers without a release.\nKeep the fire exit by the bar clear.\nStaff may ask you to pause during deliveries.', permit: 'Not needed', permitNotes: 'Certificate of public liability on file, minimum $2m.', access: 'Load-in 7am via the loading bay. Taproom opens at 12.', parking: 'Loading bay for 30 min, then street parking', power: 'Standard sockets, 2 x 16A at the bar', checked: iso(-20), notes: '' },
      { id: uid(), name: 'Northline Legal, level 9', type: 'Office / corporate', address: '88 King Street, Level 9', geo: { lat: 51.5136, lon: -0.0899 }, contact: 'Dee Okafor', phone: '+1 555 0144', email: 'dee@example.com', perms: { tripods: 'allowed', lighting: 'ask', flash: 'no', haze: 'no', drones: 'no', generators: 'no', dollies: 'ask', audio: 'ask', pyro: 'no' }, rules: 'Book the goods lift 48 hours ahead.\nNo equipment in the main lobby; use the service entrance.', permit: 'Required', permitNotes: 'Building manager needs your certificate 7 days ahead.', access: 'Service entrance on Mill Lane, from 6pm.', parking: 'Nearest car park is 5 min walk', power: '', checked: iso(-200), notes: '' },
    ],
    shifts: [shift(past0, 4, 8, 16, 30), shift(past1, 12, 7, 18, 45), shift(past2, 20, 10, 24, 60), shift(past2, 19, 10, 22, 45), shift(past3, 33, 8, 13, 15), shift(past1, 26, 9, 19, 30), shift(past3, 40, 8, 17, 30), shift(past0, 47, 9, 18, 45), shift(past2, 54, 10, 21, 60), shift(past1, 61, 8, 16, 30), shift(past3, 68, 9, 14, 15), shift(past0, 75, 8, 19, 45)],
    kits: [
      { id: uid(), name: 'Interview set', description: 'Two-light sit-down interview, clean dialogue', gear: [gear[0].id, gear[1].id, gear[3].id, gear[4].id, gear[5].id, gear[6].id, gear[7].id], gearQty: { [gear[4].id]: 2 }, notes: 'Add a reflector and grey card.' },
      { id: uid(), name: 'Car photography / rolling shots', description: 'Static + moving car work, optional aerials', gear: [gear[0].id, gear[2].id, gear[8].id, gear[9].id], notes: 'Polariser, microfibre cloths, tow-rig permit if needed.' },
    ],
    insurance: [
      { id: uid(), type: 'Equipment', provider: 'ProShield Mutual', policy: 'EQ-448120', cover: 12000, premium: 640, renewal: iso(21), phone: '+1 555 0900', claims: '+1 555 0901', link: '', notes: 'Covers kit on location & in transit.' },
      { id: uid(), type: 'Public Liability', provider: 'ProShield Mutual', policy: 'PL-991302', cover: 2000000, premium: 210, renewal: iso(200), phone: '+1 555 0900', claims: '', link: '', notes: '' },
    ],
    profile: { ...db.profile, name: db.profile.name || 'Your Name', business: db.profile.business || 'Your Studio', title: 'Videographer / DOP', phone: db.profile.phone || '+1 555 0100', email: db.profile.email || 'you@example.com', website: db.profile.website || 'https://example.com' },
  });
  db.updatedAt = Date.now();
  persistLocal(); emit(); schedulePush();
}

/* ------------------------------ cloud sync ------------------------------ */

export const cloud = {
  supported: typeof window.showSaveFilePicker === 'function', // local-file linking
  adapter: null,
  auxName: '', feedUrl: '', feedError: '', // calendar feed (see calendar.js)
  status: 'off', // off | synced | saving | needs-permission | error
  error: '',
};

const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open('logi', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const kv = async (mode, fn) => {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv'));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  });
};
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

function setStatus(status, error = '') { cloud.status = status; cloud.error = error; emit(); }

export async function initCloud() {
  cloud.feedUrl = lsGet('logi-feed-url') || '';
  try {
    if (await dropboxFinish()) { lsSet('logi-provider', 'dropbox'); }
  } catch (e) { setStatus('error', e.message); }
  try {
    const provider = lsGet('logi-provider');
    if (provider === 'dropbox') cloud.adapter = dropboxAdapter();
    else if (provider === 'gdrive') cloud.adapter = gdriveAdapter();
    else if (provider === 'onedrive') cloud.adapter = onedriveAdapter();
    else if (provider === 'webdav') cloud.adapter = webdavAdapter();
    else if (cloud.supported) {
      const handle = await kv('readonly', s => s.get('fileHandle'));
      if (handle) { const aux = await kv('readonly', s => s.get('auxHandle')); cloud.adapter = fileAdapter(handle, aux || null); cloud.auxName = aux ? aux.name : ''; }
    }
    if (cloud.adapter) await sync();
  } catch (e) { setStatus('error', e.message); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && cloud.adapter && cloud.status === 'synced') sync(); });
}

/* --------------------------------- merging --------------------------------- */
// Two devices may edit at once, so copies are merged record by record rather than one copy replacing the other.
const ts = r => Number(r && r.updatedAt) || 0;
const nts = n => Number(n && n.upd) || Date.parse(n && n.at) || 0;
function mergeList(a, b, dead, mergeOne) {
  const m = new Map(); a.forEach(x => m.set(x.id, x));
  b.forEach(y => { const x = m.get(y.id); m.set(y.id, x ? mergeOne(x, y) : y); });
  return [...m.values()].filter(x => !(dead[x.id] > (mergeOne === mergeNote ? nts(x) : ts(x))));
}
const newer = (x, y) => (ts(y) > ts(x) ? y : x);
const mergeNote = (x, y) => (nts(y) > nts(x) ? y : x);
// A log's settings (sync point, mode, script…) follow the newer copy; its notes are the union of both.
export function mergeLog(a, b, globalDead = db.deleted) {
  const base = newer(a, b), other = base === a ? b : a;
  const dead = { ...globalDead }; // a log carries its own note tombstones so they travel with it
  for (const src of [a.dead, b.dead]) for (const [id, t] of Object.entries(src || {})) dead[id] = Math.max(dead[id] || 0, t);
  const notes = mergeList(base.notes || [], other.notes || [], dead, mergeNote);
  const sa = Number(a.scriptAt) || 0, sb = Number(b.scriptAt) || 0;
  const sWin = sb > sa ? b : a, sLose = sWin === a ? b : a;
  const script = sWin.script !== undefined ? sWin.script : sLose.script; // undefined = not carried on the wire
  const own = Object.fromEntries(Object.entries(dead).filter(([id]) => (a.dead && id in a.dead) || (b.dead && id in b.dead)));
  return { ...base, notes, script: script === undefined ? null : script, scriptAt: Math.max(sa, sb), dead: own };
}
export function mergeDb(local, remote) {
  const dead = { ...local.deleted };
  for (const [id, t] of Object.entries(remote.deleted || {})) dead[id] = Math.max(dead[id] || 0, t);
  const out = { ...local, deleted: dead };
  for (const list of ['bookings', 'crew', 'gear', 'insurance', 'kits', 'venues', 'shifts']) out[list] = mergeList(local[list], remote[list], dead, newer);
  out.logs = mergeList(local.logs, remote.logs, dead, (x, y) => mergeLog(x, y, dead));
  out.profile = ts(remote.profile) > ts(local.profile) ? remote.profile : local.profile;
  { // calendar link follows the newer copy; the booking -> event map is the union, newer entry per booking
    const a = local.calSync || {}, b = remote.calSync || {}, base = ts(b) > ts(a) ? b : a;
    const events = { ...(a.events || {}) };
    for (const [k, v] of Object.entries(b.events || {})) if (!events[k] || (v.at || 0) > (events[k].at || 0)) events[k] = v;
    out.calSync = { ...base, events };
  }
  out.templates = ts(remote.templates) > ts(local.templates) ? remote.templates : local.templates;
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

// Merge the remote copy in, then push if anything here isn't in it yet. `quiet` skips the "Saving…" flicker (background polls).
let syncing = false;
export async function sync({ ask = false, quiet = false } = {}) {
  const a = cloud.adapter;
  if (sealed) { pendingSync = true; return; }
  if (!a || syncing) return;
  syncing = true;
  try {
    if (!(await a.ready(ask))) return setStatus('needs-permission');
    if (!quiet) setStatus('saving');
    const remote = await a.read();
    if (!remote) return await push();
    const merged = mergeDb(db, normalise(remote));
    const localChanged = JSON.stringify(merged) !== JSON.stringify(db);
    const remoteStale = JSON.stringify(merged) !== JSON.stringify(normalise(remote));
    if (localChanged) { db = merged; persistLocal(); emit(); }
    if (remoteStale) await push(); else { lsSet('logi-sync-at', String(Date.now())); setStatus('synced'); }
  } catch (e) { setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message); }
  finally { syncing = false; }
}

let auxWriter = null;
export const setAuxWriter = fn => { auxWriter = fn; }; // calendar.js supplies the feed contents
async function push() {
  if (!cloud.adapter) return;
  try {
    setStatus('saving');
    await cloud.adapter.write(exportJSON());
    lsSet('logi-sync-at', String(Date.now()));
    await autoBackup();
    if (db.calSync?.feed && auxWriter && cloud.adapter.writeAux) {
      try { await cloud.adapter.writeAux(auxWriter()); cloud.feedError = ''; } catch (e) { cloud.feedError = e.message; }
    }
    setStatus('synced');
  } catch (e) { setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message); }
}
export async function setFeed(on) {
  if (on && cloud.adapter?.enableFeed) await cloud.adapter.enableFeed();
  update(d => { d.calSync = { ...d.calSync, feed: !!on, updatedAt: Date.now() }; });
  if (on) await push();
}
export async function createFeedFile() { // local-file storage: pick where the feed file lives (same synced folder)
  const handle = await window.showSaveFilePicker({ suggestedName: 'vdex-bookings.ics', types: [{ description: 'Calendar feed', accept: { 'text/calendar': ['.ics'] } }] });
  await kv('readwrite', s => s.put(handle, 'auxHandle'));
  if (cloud.adapter) cloud.adapter.aux = handle;
  cloud.auxName = handle.name;
  await push();
}
export async function feedLink() {
  if (!cloud.adapter?.shareLink) throw new Error('No link for this storage');
  await push();
  cloud.feedUrl = await cloud.adapter.shareLink('vdex-bookings.ics');
  lsSet('logi-feed-url', cloud.feedUrl); emit();
  return cloud.feedUrl;
}

// Once a day, after a change, a dated copy goes next to the database: one file per weekday and one per month.
async function autoBackup() {
  const a = cloud.adapter; if (!a || !a.writeExtra) return;
  const now = new Date(), day = ymd(now), month = day.slice(0, 7);
  let last = {}; try { last = JSON.parse(lsGet('logi-backup-cloud')) || {}; } catch { /* none yet */ }
  if (last.day === day) return;
  const names = [`vdex-backup-${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()]}.json`];
  if (last.month !== month) names.push(`vdex-backup-${month}.json`);
  try {
    const text = exportJSON();
    for (const name of names) await a.writeExtra(name, text);
    lsSet('logi-backup-cloud', JSON.stringify({ day, month, at: Date.now(), name: names[0], provider: a.id }));
    cloud.backupError = '';
  } catch (e) { cloud.backupError = e.message; }
}

let timer;
function schedulePush() {
  if (sealed) { pendingSync = true; return; }
  if (!cloud.adapter || cloud.status === 'needs-permission') return;
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

export const reconnect = () => sync({ ask: true });

async function link(adapter, provider, handle) {
  cloud.adapter = adapter;
  lsSet('logi-provider', provider);
  if (handle) await kv('readwrite', s => s.put(handle, 'fileHandle'));
  await sync({ ask: true });
}

export async function createCloudFile() {
  const handle = await window.showSaveFilePicker({ suggestedName: 'vdex-production-db.json', types: [{ description: 'Vdex database', accept: { 'application/json': ['.json'] } }] });
  const a = fileAdapter(handle);
  await a.write(exportJSON()); // new file starts from the current data
  await link(a, null, handle);
}

export async function openCloudFile() {
  const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Vdex database', accept: { 'application/json': ['.json'] } }] });
  await link(fileAdapter(handle), null, handle);
}

export const connectDropbox = () => dropboxBegin(); // redirects away; initCloud finishes the link on return
export const connectGdrive = () => link(gdriveAdapter(), 'gdrive');
export const connectOneDrive = () => link(onedriveAdapter(), 'onedrive');
export async function connectWebdav() { const a = webdavAdapter(); if (!(await a.ready())) throw new Error('Enter the server address and username first'); await link(a, 'webdav'); if (cloud.status === 'error') { const msg = cloud.error; cloud.adapter = null; lsSet('logi-provider', null); setStatus('off'); throw new Error(msg); } }

export async function unlinkCloud() {
  cloud.adapter?.signOut?.();
  cloud.adapter = null; cloud.auxName = ''; cloud.feedUrl = ''; lsSet('logi-feed-url', null);
  await kv('readwrite', s => s.delete('auxHandle'));
  lsSet('logi-provider', null);
  await kv('readwrite', s => s.delete('fileHandle'));
  setStatus('off');
}

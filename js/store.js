// Single JSON database. Lives in localStorage for speed/offline, and is mirrored to a
// file you pick inside any cloud-synced folder (Google Drive, Dropbox, OneDrive, iCloud Drive...)
// using the File System Access API where available. Export/Import covers everything else.
import { uid, ymd, toast } from './util.js';
import { fileAdapter, dropboxAdapter, gdriveAdapter, icloudAdapter, onedriveAdapter, webdavAdapter, dropboxBegin, dropboxFinish, icloudFinish, microsoftFinish } from './providers.js';

const KEY = 'logi-db-v1';
const blank = () => ({
  version: 1, updatedAt: 0,
  profile: { name: '', business: '', title: '', phone: '', email: '', website: '', location: '', currency: '$', bio: '' },
  bookings: [], crew: [], gear: [], insurance: [], kits: [], venues: [], logs: [], shifts: [],
  deleted: {}, // id -> time deleted (tombstones, so a merge with an older copy doesn't bring records back)
  calSync: { provider: null, calendarId: null, events: {}, feed: false, updatedAt: 0 }, // calendar link + event ids per booking
  templates: {}, // per job type: edited checklist lines per stage
  projectTemplates: [], // the user's own job types: defaults for a new booking (times, kit, crew, deliverables, schedule…)
  billing: { updatedAt: 0 }, // rates, numbering, tax and payment terms for quotes and invoices
  priceList: { list: null, region: '', updatedAt: 0 }, // the lines picked into quotes and invoices (null: not set up yet)
});

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') return normalise(raw);
  } catch { /* fall through */ }
  return blank();
}

// Older copies kept rented gear under booking.hires; hires are now the people hired for the job and the gear lives
// under booking.rentals. Runs on load, on a backup import and on every remote copy, so every device agrees. Lossless:
// nothing else on the booking changes, and a copy that already moved them is left as it is.
export function migrateBooking(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.hires)) return b;
  const gear = b.hires.filter(x => x && typeof x === 'object' && !x.name && (x.item != null || x.from != null || x.cost != null)); // gear-shaped, even with a blank item
  if (!gear.length) return b;
  const have = new Set((Array.isArray(b.rentals) ? b.rentals : []).map(x => x && x.id).filter(Boolean));
  return { ...b, hires: b.hires.filter(x => !gear.includes(x)), rentals: [...(Array.isArray(b.rentals) ? b.rentals : []), ...gear.filter(x => !(x.id && have.has(x.id)))] };
}

// The same, in place, for a booking being edited inside update().
export const splitHires = x => { const m = migrateBooking(x); if (m !== x) { x.hires = m.hires; x.rentals = m.rentals; } return x; };

function normalise(raw) {
  const b = blank();
  return {
    ...b, ...raw,
    profile: { ...b.profile, ...(raw.profile || {}) },
    bookings: (Array.isArray(raw.bookings) ? raw.bookings : []).map(migrateBooking),
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
    projectTemplates: Array.isArray(raw.projectTemplates) ? raw.projectTemplates : [],
    billing: raw.billing && typeof raw.billing === 'object' ? raw.billing : { updatedAt: 0 },
    priceList: raw.priceList && typeof raw.priceList === 'object' ? raw.priceList : b.priceList,
  };
}

export let db = load();
// The app lock seals the plaintext copy while the app is hidden or locked; writes then wait in memory for the unseal.
let sealed = false, dirty = false, pendingSync = false, rev = 0;
export const revision = () => rev;
export const isSealed = () => sealed;
export const serialize = () => JSON.stringify(db);
// Unlocking runs what waited: deferred work is a full sync, which reads and merges what is in the cloud before writing.
export function setSealed(on) { if (on && writeQueued) writeNow(); sealed = on; if (!on) { if (dirty) { dirty = false; persistLocal(); } if (pendingSync) { pendingSync = false; sync({ quiet: true }); } } }
export function flush() { rev++; writeNow(); }
export function reload() { db = load(); rev++; emit(); }
export const touch = () => { rev++; emit(); };
const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = (reason = 'data') => subs.forEach(fn => fn(reason)); // 'data' after a change, 'status' for cloud status only

// Writes are coalesced: a burst of changes in one task (an import, a template, a merge) is serialised and written once,
// at the end of that task. Sealing flushes first, so nothing plain is ever written after the lock has taken over.
let writeQueued = false;
function writeNow() {
  writeQueued = false;
  if (sealed) { dirty = true; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('localStorage full?', e); }
}
function persistLocal() {
  rev++;
  if (sealed) { dirty = true; return; }
  if (!writeQueued) { writeQueued = true; queueMicrotask(writeNow); }
}

// Vdex is read-only when its free trial is over and there is no licence (js/licence.js sets this gate). Every change
// goes through update(), so this is the one place that refuses them; opening, searching and printing keep working
// (backups, spreadsheets and cloud storage come with a licence: setPaid below).
let gate = null;
export const setGate = fn => { gate = typeof fn === 'function' ? fn : null; };

// Whether a change would be accepted now (and, when not, the gate explains why). Forms check it before closing.
export const canChange = () => !gate || gate({ form: true });
// The same question asked without a word to the person: for side effects of something that is allowed anyway
// (marking a call sheet sent when it is printed), which are simply skipped when Vdex is read-only.
export const canChangeQuietly = () => !gate || gate({ quiet: true });

// Redraws the page from what is stored (after a refused change, so a ticked box shows the stored value again).
export const redraw = () => emit();

// Mutate the db inside fn, then save + sync. Returns false when the change was refused.
export function update(fn) {
  if (gate && !gate()) return false;
  fn(db);
  db.updatedAt = Date.now();
  persistLocal();
  emit();
  schedulePush();
  return true;
}

export function upsert(list, item) {
  return update(d => {
    const arr = d[list];
    const i = arr.findIndex(x => x.id === item.id);
    const stamped = { ...item, id: item.id || uid(), updatedAt: Date.now() };
    if (i >= 0) arr[i] = stamped; else arr.push(stamped);
  });
}

export function remove(list, id) {
  return update(d => {
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

// Edit days: post-production days a booking also happens on, each with optional times. They are not shoot days, so
// covers()/overlaps() (kit clashes, the calendar event's span) leave them alone; the day list and the clock use onDay().
export const editDaysOf = b => (Array.isArray(b && b.editDays) ? b.editDays.filter(d => d && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) : []);
export const isEditDay = (b, date) => editDaysOf(b).some(d => d.date === date);
export const onDay = (b, date) => covers(b, date) || isEditDay(b, date);

export const bookingsOn = date =>
  db.bookings.filter(b => onDay(b, date)).sort((a, b) => (a.start || '').localeCompare(b.start || ''));

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
  // The lock's vault, PIN and backup marks go too, otherwise the next start would bring the old data back; and so does
  // everything else Vdex keeps on this device (sign-ins, the phone's calendar link, the feed's link, the weather and
  // location caches, the fingerprint or face key), except plain preferences and the terms already agreed to. The
  // licence sign-in stays: Sign out under About & Licence gives it up (terms section 17).
  try { dispatchEvent(new Event('vdex-erased')); } catch { /* ignore */ } // the lock lets go of its key first: no vault rewrite, no seal on the way out
  const KEEP = new Set(['logi-terms', 'logi-prefs', 'logi-tour', 'logi-tour-at', 'logi-tab', 'logi-units', 'logi-stdday', 'logi-breakdefault', 'logi-notify', 'logi-hours-range', 'logi-eyeh', 'logi-decl', 'logi-lock-setup']);
  try { const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); keys.filter(k => k && (k.startsWith('logi-') || k.startsWith('msal.')) && !KEEP.has(k)).forEach(k => localStorage.removeItem(k)); } catch { /* blocked storage */ }
  try { await new Promise(res => { const r = indexedDB.deleteDatabase('logi'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch { /* ignore */ }
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
  ['Flight case 1', 'Flight case 1', 'Flight case 1', 'Van', 'Van', 'Audio bag', 'Audio bag', 'Van', 'Studio', 'Flight case 1'].forEach((place, i) => { if (gear[i]) gear[i].location = place; });
  const crew = [
    { id: uid(), name: 'Sam Rivera', role: 'Sound Recordist', phone: '+1 555 0101', email: 'sam@example.com', link: 'https://example.com/sam', rate: 450, rateUnit: 'day', notes: '' },
    { id: uid(), name: 'Jo Chen', role: '1st AC', phone: '+1 555 0102', email: 'jo@example.com', link: 'https://example.com/jo', rate: 400, rateUnit: 'day', notes: '' },
    { id: uid(), name: 'Mika Dahl', role: 'Gaffer', phone: '+1 555 0103', email: '', link: 'https://example.com/mika', rate: 425, rateUnit: 'day', notes: '' },
    { id: uid(), name: 'Priya Nair', role: 'Editor', phone: '', email: 'priya@example.com', link: 'https://example.com/priya', rate: 55, rateUnit: 'hour', notes: '' },
  ];
  db = normalise({
    ...db,
    gear, crew,
    bookings: [
      { id: uid(), title: 'Harbour Brewing brand film', client: 'Harbour Brewing Co.', type: 'brand', date: iso(2), start: '07:30', end: '17:00', status: 'Prepped', venueId: venueA, checks: { 'confirmed:deposit-received': 1, 'confirmed:booking-in-the-calendar': 1, 'confirmed:crew-asked-and-confirmed': 1, 'confirmed:venue-confirmed-permits-requested': 1, 'confirmed:insurance-certificate-sent': 1, 'confirmed:hires-booked': 1, 'prepped:shot-list-storyboard-done': 1, 'prepped:treatment-and-shot-list-approved': 1 }, crewStatus: { [crew[0].id]: 'confirmed', [crew[1].id]: 'asked' }, crewCall: { [crew[0].id]: '07:30', [crew[1].id]: '07:00' }, shots: [{ id: uid(), text: 'Wide: steam over the mash tun at first light', done: false }, { id: uid(), text: 'Ana interview, two lights, 50mm', done: false }, { id: uid(), text: 'Keg roll to the van, tracking', done: false }], rentals: [{ id: uid(), item: 'Easyrig Vario 5', from: 'Dock Rentals', cost: 60, pickup: iso(1), return: iso(3), booked: 'yes' }], deliverables: [{ id: uid(), name: 'Brand film 16:9, 90 s', duration: '90 s', due: iso(23), status: 'Planned', link: '', delivered: '' }, { id: uid(), name: 'Social cut 9:16, 30 s', duration: '30 s', due: iso(27), status: 'Planned', link: '', delivered: '' }], address: '12 Dock Road, Portside', stakeholders: [{ name: 'Ana Ruiz', role: 'Marketing lead', phone: '+1 555 0199' }, { name: 'Tom Hale', role: 'Head brewer', phone: '' }], crew: [crew[0].id, crew[1].id], gear: [gear[0].id, gear[1].id, gear[3].id, gear[4].id, gear[5].id, gear[6].id], gearQty: { [gear[4].id]: 2 }, notes: 'Golden hour exterior at 17:30. Parking behind the loading bay.' },
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
  notice: '', // why the last sign-in did not finish, shown in the storage panel
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

function setStatus(status, error = '') { cloud.status = status; cloud.error = error; emit('status'); }

// Cloud storage and saving data files (backups, spreadsheets) come with a licence; js/licence.js says whether this
// device has one. Without one (the trial included) linking storage and exporting are refused with an explanation, and
// a storage linked before is paused: nothing is copied either way, and syncing starts again once there is a licence.
// Until the licence is known, the last answer this device saw is used, so a paused link stays paused from the start.
let paid = lsGet('vdex-paid') !== '0', paidPrompt = null;
cloud.paused = !paid;
export const isPaid = () => paid;
export function setPaid(on, prompt) {
  if (prompt) paidPrompt = prompt;
  const was = paid; paid = !!on; cloud.paused = !paid;
  lsSet('vdex-paid', paid ? '1' : '0');
  if (was === paid) return;
  // 'licence': panels that show it (storage) redraw themselves; the page is not redrawn, so focus stays where it is.
  if (paid) { if (cloud.adapter) sync(); else emit('licence'); }
  else { clearTimeout(timer); if (cloud.adapter) setStatus('paused'); else emit('licence'); }
}
// True when this device may (licensed, or licences not switched on); otherwise explains, offering a licence, and false.
export function requirePaid(what) {
  if (paid) return true;
  if (paidPrompt) paidPrompt(what);
  else import('./licence.js').then(m => m.initLicence()).then(() => (paidPrompt ? paidPrompt(what) : toast('This comes with a Vdex licence.'))).catch(() => toast('This comes with a Vdex licence.'));
  return false;
}

export async function initCloud() {
  cloud.feedUrl = lsGet('logi-feed-url') || '';
  // Coming back from a sign-in page: finish it, or say why it did not work and leave nothing half-linked.
  const say = msg => setTimeout(() => toast(msg), 700);
  try {
    if (await dropboxFinish()) { lsSet('logi-provider', 'dropbox'); cloud.notice = ''; say('Connected to Dropbox'); }
  } catch (e) { cloud.notice = e.message; say(e.message); }
  let icloudFirst = false;
  try {
    if (icloudFinish()) { lsSet('logi-provider', 'icloud'); cloud.notice = ''; icloudFirst = true; }
  } catch (e) { cloud.notice = e.message; say(e.message); }
  try {
    const intent = await microsoftFinish();
    if (intent === 'onedrive') { lsSet('logi-provider', 'onedrive'); cloud.notice = ''; say('Connected to OneDrive'); }
    else if (intent === 'calendar') { update(d => { d.calSync = { ...d.calSync, provider: 'microsoft', updatedAt: Date.now() }; }); say('Connected to Outlook'); import('./calendar.js').then(m => m.syncCalendar({ interactive: false })).catch(() => {}); }
  } catch (e) {
    cloud.notice = e.message; say(e.message);
    if (e.intent === 'onedrive' && e.first && lsGet('logi-provider') === 'onedrive') lsSet('logi-provider', null);
    if (e.intent === 'calendar' && !db.calSync?.calendarId) update(d => { d.calSync = { ...d.calSync, provider: null, updatedAt: Date.now() }; });
  }
  try {
    const provider = lsGet('logi-provider');
    if (provider === 'dropbox') cloud.adapter = dropboxAdapter();
    else if (provider === 'gdrive') cloud.adapter = gdriveAdapter();
    else if (provider === 'icloud') cloud.adapter = icloudAdapter();
    else if (provider === 'onedrive') cloud.adapter = onedriveAdapter();
    else if (provider === 'webdav') cloud.adapter = webdavAdapter();
    else if (cloud.supported) {
      const handle = await kv('readonly', s => s.get('fileHandle'));
      if (handle) { const aux = await kv('readonly', s => s.get('auxHandle')); cloud.adapter = fileAdapter(handle, aux || null); cloud.auxName = aux ? aux.name : ''; }
    }
    if (cloud.adapter) await sync();
    if (icloudFirst) {
      if (cloud.status === 'synced' || sealed) say('Connected to iCloud'); // behind the PIN lock the first copy waits for the unlock
      else { const msg = cloud.error || 'iCloud didn’t finish connecting. Tap Connect to try again.'; cloud.adapter?.signOut?.(); cloud.adapter = null; lsSet('logi-provider', null); cloud.notice = msg; setStatus('off'); say(msg); }
    }
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
// A booking follows its newer copy, except its budget, which follows the newer budget: one device can plan costs while
// another ticks the checklist, and neither loses the other's work.
const budgetAt = b => Number(b && b.budget && b.budget.updatedAt) || 0, boardAt = b => Number(b && b.board && b.board.updatedAt) || 0;
// The budget and the stripboard each keep their own time, so a newer one survives a newer edit elsewhere on the booking.
const mergeBooking = (x, y) => { const base = newer(x, y), other = base === x ? y : x; let out = base; if (budgetAt(other) > budgetAt(base)) out = { ...out, budget: other.budget }; if (boardAt(other) > boardAt(base)) out = { ...out, board: other.board }; return out; };
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
  for (const list of ['bookings', 'crew', 'gear', 'insurance', 'kits', 'venues', 'shifts', 'projectTemplates']) out[list] = mergeList(local[list] || [], remote[list] || [], dead, list === 'bookings' ? mergeBooking : newer);
  out.logs = mergeList(local.logs, remote.logs, dead, (x, y) => mergeLog(x, y, dead));
  out.profile = ts(remote.profile) > ts(local.profile) ? remote.profile : local.profile;
  { // calendar link follows the newer copy; the booking -> event map is the union, newer entry per booking
    const a = local.calSync || {}, b = remote.calSync || {}, base = ts(b) > ts(a) ? b : a;
    const events = { ...(a.events || {}) };
    for (const [k, v] of Object.entries(b.events || {})) if (!events[k] || (v.at || 0) > (events[k].at || 0)) events[k] = v;
    out.calSync = { ...base, events };
  }
  out.templates = ts(remote.templates) > ts(local.templates) ? remote.templates : local.templates;
  out.billing = ts(remote.billing) > ts(local.billing) ? remote.billing : local.billing;
  out.priceList = ts(remote.priceList) > ts(local.priceList) ? remote.priceList : local.priceList; // its own record: a change to the other billing settings never undoes it
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

// Merge the remote copy in, then push if anything here isn't in it yet. `quiet` skips the "Saving…" flicker (background polls).
// One sync at a time. A sync asked for while another is running waits for it and then runs, so a fresh link (or a
// change made meanwhile) is never skipped.
let syncing = null;
export async function sync(opts = {}) {
  while (syncing) await syncing.catch(() => {});
  if (sealed) { pendingSync = true; return; }
  if (!cloud.adapter) return;
  if (cloud.paused) return setStatus('paused'); // no licence: nothing is read from or written to the storage
  syncing = runSync(opts);
  try { return await syncing; } finally { syncing = null; }
}
async function runSync({ ask = false, quiet = false } = {}) {
  const a = cloud.adapter;
  try {
    if (!(await a.ready(ask))) return setStatus('needs-permission');
    if (sealed) { pendingSync = true; return; } // locked while the sign-in was open: nothing is copied until it is unlocked
    if (!quiet) setStatus('saving');
    const remote = await a.read();
    if (cloud.paused) return setStatus('paused'); // paused while reading: nothing is merged or written
    if (!remote) return await push();
    const merged = mergeDb(db, normalise(remote));
    const localChanged = JSON.stringify(merged) !== JSON.stringify(db);
    const remoteStale = JSON.stringify(merged) !== JSON.stringify(normalise(remote));
    if (localChanged) { db = merged; persistLocal(); emit(); }
    if (remoteStale) await push(); else { lsSet('logi-sync-at', String(Date.now())); setStatus(cloud.paused ? 'paused' : 'synced'); }
  } catch (e) { setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message); }
}

let auxWriter = null;
export const setAuxWriter = fn => { auxWriter = fn; }; // calendar.js supplies the feed contents
// One copy is written at a time (a timed push and a sync's push never overlap), never while locked, and always to
// the storage that was linked when it started.
let pushing = Promise.resolve();
function push() { const p = pushing.then(pushNow, pushNow); pushing = p.catch(() => {}); return p; }
async function pushNow() {
  const a = cloud.adapter; if (!a || cloud.paused) return;
  if (sealed) { pendingSync = true; return; }
  try {
    setStatus('saving');
    await a.write(exportJSON());
    lsSet('logi-sync-at', String(Date.now()));
    if (cloud.paused) { if (cloud.adapter === a) setStatus('paused'); return; } // paused meanwhile: no backup or feed after it
    await autoBackup(a);
    if (db.calSync?.feed && auxWriter && a.writeAux) {
      try { await a.writeAux(auxWriter()); cloud.feedError = ''; } catch (e) { cloud.feedError = e.message; }
    }
    if (cloud.adapter === a) setStatus(cloud.paused ? 'paused' : 'synced');
  } catch (e) { if (cloud.adapter === a) setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message); }
}
export async function setFeed(on) {
  if (on) mustBePaid();
  if (on && cloud.adapter?.enableFeed) await cloud.adapter.enableFeed();
  update(d => { d.calSync = { ...d.calSync, feed: !!on, updatedAt: Date.now() }; });
  if (on) await push();
}
export async function createFeedFile() { // local-file storage: pick where the feed file lives (same synced folder)
  mustBePaid();
  const handle = await window.showSaveFilePicker({ suggestedName: 'vdex-bookings.ics', types: [{ description: 'Calendar feed', accept: { 'text/calendar': ['.ics'] } }] });
  await kv('readwrite', s => s.put(handle, 'auxHandle'));
  if (cloud.adapter) cloud.adapter.aux = handle;
  cloud.auxName = handle.name;
  await push();
}
export async function feedLink() {
  mustBePaid();
  if (!cloud.adapter?.shareLink) throw new Error('No link for this storage');
  await push();
  cloud.feedUrl = await cloud.adapter.shareLink('vdex-bookings.ics');
  lsSet('logi-feed-url', cloud.feedUrl); emit();
  return cloud.feedUrl;
}

// Once a day, after a change, a dated copy goes next to the database: one file per weekday and one per month.
async function autoBackup(a = cloud.adapter) {
  if (!a || !a.writeExtra || cloud.adapter !== a) return;
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
  if (!cloud.adapter || cloud.paused || cloud.status === 'needs-permission') return;
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

export function reconnectNeeded(msg) { if (cloud.adapter) setStatus('needs-permission', msg || ''); }
export async function reconnect() { const a = cloud.adapter; if (!a || cloud.paused) return; if (!(await a.ready(true))) return setStatus('needs-permission'); cloud.notice = ''; return sync(); }

// Sign in first, outside the sync lock, and link only once that has worked: a cancelled, abandoned or still-open
// sign-in leaves nothing half-linked, and tapping Connect again simply starts a fresh one.
const mustBePaid = () => { if (cloud.paused) throw new Error('Keeping a copy in your cloud storage comes with a Vdex licence.'); };
async function link(adapter, provider, handle) {
  mustBePaid();
  if (!(await adapter.ready(true))) throw new Error('The sign-in didn’t finish. Tap Connect to try again.');
  cloud.adapter = adapter; cloud.notice = '';
  lsSet('logi-provider', provider);
  if (handle) await kv('readwrite', s => s.put(handle, 'fileHandle'));
  await sync();
}

export async function createCloudFile() {
  mustBePaid();
  const handle = await window.showSaveFilePicker({ suggestedName: 'vdex-production-db.json', types: [{ description: 'Vdex database', accept: { 'application/json': ['.json'] } }] });
  const a = fileAdapter(handle);
  await a.write(exportJSON()); // new file starts from the current data
  await link(a, null, handle);
}

export async function openCloudFile() {
  mustBePaid();
  const [handle] = await window.showOpenFilePicker({ types: [{ description: 'Vdex database', accept: { 'application/json': ['.json'] } }] });
  await link(fileAdapter(handle), null, handle);
}

export const connectDropbox = () => { mustBePaid(); return dropboxBegin(); }; // redirects away; initCloud finishes the link on return
// Link, and if the first sync fails (sign-in cancelled, window blocked, wrong password) go back to unlinked and say why.
async function linkOrUndo(a, provider) {
  cloud.notice = '';
  await link(a, provider);
  if (cloud.status === 'error' || cloud.status === 'needs-permission') { const msg = cloud.error || 'Sign-in did not finish'; cloud.adapter = null; lsSet('logi-provider', null); setStatus('off'); throw new Error(msg); }
}
export const connectGdrive = () => linkOrUndo(gdriveAdapter(), 'gdrive');
export const connectIcloud = () => linkOrUndo(icloudAdapter(), 'icloud');
export const connectOneDrive = () => linkOrUndo(onedriveAdapter(), 'onedrive');
export async function connectWebdav() { const a = webdavAdapter(); if (!(await a.ready())) throw new Error('Enter the server address, your username and the app password first'); await a.ensureFolder(); await linkOrUndo(a, 'webdav'); }

// iCloud only: delete Vdex's copy and backups there, then unlink. This device keeps everything. Nothing new is copied
// or backed up while deleting, and a copy already on its way finishes first, so nothing lands after the delete.
export async function eraseCloudCopy() {
  const a = cloud.adapter; if (!a?.erase) return 0;
  if (!(await a.ready(false))) throw new Error(`Sign in to ${a.label} again first (Sign in again, above), then delete.`); // never off to a sign-in page from here
  clearTimeout(timer); cloud.adapter = null;
  let n;
  try { while (syncing) await syncing.catch(() => {}); await pushing; n = await a.erase(); }
  catch (e) { cloud.adapter = a; if (e.name === 'NotAllowedError') setStatus('needs-permission', e.message); throw e; }
  cloud.adapter = a; await unlinkCloud(); return n;
}
export async function unlinkCloud() {
  cloud.adapter?.signOut?.({ keepToken: db.calSync?.provider === 'microsoft' }); // the Outlook link shares the Microsoft sign-in
  cloud.adapter = null; cloud.auxName = ''; cloud.feedUrl = ''; lsSet('logi-feed-url', null);
  await kv('readwrite', s => s.delete('auxHandle'));
  lsSet('logi-provider', null);
  await kv('readwrite', s => s.delete('fileHandle'));
  setStatus('off');
}

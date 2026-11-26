// Single JSON database. Lives in localStorage for speed/offline, and is mirrored to a
// file you pick inside any cloud-synced folder (Google Drive, Dropbox, OneDrive, iCloud Drive...)
// using the File System Access API where available. Export/Import covers everything else.
import { uid, ymd, toast, announce } from './util.js';
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
  myRoles: [], // crew roles the person typed themselves, kept for the role menu: { id, name, updatedAt } (js/roles.js)
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

// A list holds records: things with an id. Anything else in one (a null, a word, a damaged entry in a file given to
// Import backup…, or in a copy another device made from such a file) is left out here, on load, on import and for
// every copy read from the cloud: one such entry would stop the pages that read the list, and every merge with it.
const rec = x => !!x && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id !== '';
const recs = v => (Array.isArray(v) ? v.filter(rec) : []);
// A deletion mark is an id and a time. It is kept three years, so that a phone or tablet left in a drawer for most of
// a year does not bring back, on every device, what was deleted while it was away.
const MARKS_KEPT = 3 * 365 * 864e5;
function normalise(raw) {
  const b = blank();
  return {
    ...b, ...raw,
    profile: { ...b.profile, ...(raw.profile || {}) },
    bookings: recs(raw.bookings).filter(x => typeof x.date === 'string').map(migrateBooking),
    crew: recs(raw.crew),
    gear: recs(raw.gear),
    insurance: recs(raw.insurance),
    kits: recs(raw.kits),
    venues: recs(raw.venues),
    shifts: recs(raw.shifts).map(s => ({ ...s, breaks: Array.isArray(s.breaks) ? s.breaks : [] })),
    logs: recs(raw.logs).map(l => ({ ...l, notes: recs(l.notes), scriptAt: Number(l.scriptAt) || (l.script ? Date.parse(l.script.imported) || 1 : 0) })),
    deleted: Object.fromEntries(Object.entries(raw.deleted && typeof raw.deleted === 'object' ? raw.deleted : {}).filter(([, t]) => Date.now() - t < MARKS_KEPT)),
    calSync: { ...b.calSync, ...(raw.calSync && typeof raw.calSync === 'object' ? raw.calSync : {}), events: raw.calSync?.events && typeof raw.calSync.events === 'object' ? raw.calSync.events : {} },
    templates: raw.templates && typeof raw.templates === 'object' ? raw.templates : {},
    projectTemplates: recs(raw.projectTemplates),
    billing: raw.billing && typeof raw.billing === 'object' ? raw.billing : { updatedAt: 0 },
    priceList: raw.priceList && typeof raw.priceList === 'object' ? raw.priceList : b.priceList,
    myRoles: (Array.isArray(raw.myRoles) ? raw.myRoles : []).filter(r => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string' && r.name.trim()),
  };
}

export let db = load();
// The app lock seals the plaintext copy while the app is hidden or locked; writes then wait in memory for the unseal.
let sealed = false, dirty = false, pendingSync = false, rev = 0;
export const revision = () => rev;
export const isSealed = () => sealed;
export const serialize = () => JSON.stringify(db);
// Unlocking runs what waited: deferred work is a full sync, which reads and merges what is in the cloud before writing.
// A window that was sealed did not hear what another window of Vdex saved meanwhile (the storage listener below skips
// a sealed window). The plain copy on the disk may hold that work, and nothing else may: with the storage nearly
// full the other window's encrypted copy could not be rewritten. So a window coming back merges the plain copy
// first, as it would have merged the save itself, and what it has more is saved in turn. fresh: the caller reads the
// disk anew right after (a start), so there is nothing to merge.
function takeDisk() {
  if (erased) return;
  let theirs; try { const raw = localStorage.getItem(KEY); if (!raw) return; theirs = normalise(JSON.parse(raw)); } catch { return; }
  const merged = mergeDb(db, theirs);
  if (JSON.stringify(merged) === JSON.stringify(db)) return;
  db = merged; rev++; if (!sameCopy(merged, theirs)) dirty = true;
  emit();
}
export function setSealed(on, fresh = false) { const was = sealed; if (on && writeQueued) writeNow(); sealed = on; if (!on) { if (was && !fresh) takeDisk(); if (dirty) { dirty = false; persistLocal(); } if (pendingSync) { pendingSync = false; sync({ quiet: true }); } } }
export function flush() { rev++; writeNow(); }
export function reload() { db = load(); rev++; emit(); }
export const touch = () => { rev++; emit(); };
const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = (reason = 'data') => subs.forEach(fn => fn(reason)); // 'data' after a change, 'status' for cloud status only

// Writes are coalesced: a burst of changes in one task (an import, a template, a merge) is serialised and written once,
// at the end of that task. Sealing flushes first, so nothing plain is ever written after the lock has taken over.
// When the browser refuses the write (its storage for Vdex is full, or it lets nothing be stored), the person is told:
// in a toast and to a screen reader, and again at most once a minute for as long as it lasts, so that no change is
// ever lost without a word. The change stays in memory, and every later change tries to save everything again.
const NOT_SAVED = 'Not enough storage to save your last change: free some space, or erase old logs and bookings. Until then, changes may be gone when Vdex is closed.';
const NO_STORAGE = 'This browser is not letting Vdex store anything, so your last change is not saved. Changes may be gone when Vdex is closed.';
let writeQueued = false, notSavedAt = 0;
function notSaved(e) {
  console.warn('The database could not be saved', e);
  if (Date.now() - notSavedAt < 60000) return;
  notSavedAt = Date.now();
  const full = !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014), text = full ? NOT_SAVED : NO_STORAGE;
  toast(text); announce(text);
}
function writeNow() {
  writeQueued = false;
  if (sealed) { dirty = true; return; }
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { notSaved(e); }
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

// Redraws the page from what is stored (after a refused change, so a ticked box or a typed field shows the stored
// value again). 'stored': the page does not put back what was being typed (js/app.js), as it does after other changes.
export const redraw = () => emit('stored');

// Every time of its own in a copy, under a name that is the same before and after a change: a record's, a booking's
// budget, stripboard, quote and invoice (or the mark a deleted one left), a log's script, notes and note marks, the
// deletion marks, and the settings that follow their newer copy. As [name, holder, field].
function* stamps(d) {
  for (const list of [...LISTS, 'logs']) for (const x of d[list] || []) {
    if (!x || typeof x !== 'object') continue;
    yield [`${list}/${x.id}`, x, 'updatedAt'];
    if (list === 'bookings') { for (const k of ['budget', 'board', 'quote', 'invoice']) { if (x[k] && typeof x[k] === 'object') yield [`${x.id}/${k}`, x[k], 'updatedAt']; } for (const k of ['quoteGoneAt', 'invoiceGoneAt']) if (x[k]) yield [`${x.id}/${k}`, x, k]; }
    if (list === 'logs') { yield [`${x.id}/script`, x, 'scriptAt']; for (const n of x.notes || []) { if (n && n.id) yield [`${x.id}/note/${n.id}`, n, 'upd']; } for (const id of Object.keys(x.dead || {})) yield [`${x.id}/dead/${id}`, x.dead, id]; }
  }
  for (const id of Object.keys(d.deleted || {})) yield [`deleted/${id}`, d.deleted, id];
  for (const k of ['profile', 'billing', 'priceList', 'templates', 'calSync']) if (d[k] && typeof d[k] === 'object') yield [k, d[k], 'updatedAt'];
}
// The newest time anywhere in this device's copy: what a restore has to outrank.
const newestIn = d => { let t = Number(d.updatedAt) || 0; for (const [, o, f] of stamps(d)) { const v = Number(o[f]) || 0; if (v > t) t = v; } return t; };

// Mutate the db inside fn, then save + sync. Returns false when the change was refused.
// A change counts as made after everything this copy has seen. Usually that is simply now. But a copy can hold times
// this device's clock has not reached: another device's clock runs ahead (a restore there stamps every record with
// it), or this one's runs behind. A change stamped with the plain clock would then lose to the copy it replaces at
// the next sync, on every device, without a word. So while the copy is ahead of the clock, whatever fn stamps is
// moved to one past the newest time the copy held.
// "One past" is not the same number on every device: two devices that both hold that copy and each change the same
// record before reading the other would then stamp it alike, each would keep its own at every merge (a tie goes to
// the copy here), and both would upload the whole copy at every sync from then on. So each running Vdex counts in a
// seat of its own, one of 256: the next time after t that is its seat's turn. Two such changes then differ, the later
// number wins on both devices, and they agree. (A change made after reading the other's is later whatever the seats.)
const SEAT = Math.floor(Math.random() * 256), SEATS = 256;
const onePast = t => { const n = t + 1; return n + ((SEAT - n) % SEATS + SEATS) % SEATS; };
export const stampSeat = () => SEAT; // (for the specs: two devices of a case must not sit in the same seat by chance)
export function update(fn) {
  if (gate && !gate()) return false;
  const seen = Number(db.updatedAt) || 0, before = seen > Date.now() ? new Map([...stamps(db)].map(([k, o, f]) => [k, o[f]])) : null;
  fn(db);
  const now = Date.now(), at = before && seen >= now ? onePast(seen) : now;
  if (before) for (const [k, o, f] of stamps(db)) { const v = Number(o[f]) || 0; if (v && v < at && before.get(k) !== o[f]) o[f] = at; }
  db.updatedAt = Math.max(at, Number(db.updatedAt) || 0);
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

// What is deleted is taken off the bookings, kits and logs that named it. Each of those then counts as changed one
// moment after its copy before: later than the copy another device still holds, so that device takes it (should the
// deleted thing come back there, changed by someone who had not heard, the two would otherwise each keep their own
// copy of the booking for ever and upload it in turn), and earlier than any real change to the booking made
// meanwhile, which is kept.
export function remove(list, id) {
  return update(d => {
    d[list] = d[list].filter(x => x.id !== id);
    d.deleted[id] = Date.now();
    const less = (o, k) => { if (!(o[k] || []).includes(id)) return false; o[k] = o[k].filter(x => x !== id); return true; };
    const lessQty = o => { if (!(o.gearQty && id in o.gearQty)) return false; delete o.gearQty[id]; return true; };
    const lessKey = (o, k) => { if (o[k] !== id) return false; delete o[k]; return true; };
    const each = (name, change) => d[name].forEach(o => { if (change(o)) o.updatedAt = ts(o) + 1; });
    if (list === 'gear') { each('bookings', b => [less(b, 'gear'), lessQty(b)].some(Boolean)); each('kits', k => [less(k, 'gear'), lessQty(k)].some(Boolean)); }
    if (list === 'bookings') { each('logs', l => lessKey(l, 'bookingId')); d.shifts.forEach(s => { if (s.bookingId === id) { s.bookingId = null; s.updatedAt = Date.now(); } }); }
    if (list === 'venues') each('bookings', b => lessKey(b, 'venueId'));
    if (list === 'kits') each('bookings', b => less(b, 'kits'));
    if (list === 'crew') each('bookings', b => less(b, 'crew'));
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

// A restore (a backup file, or a backup kept in the cloud) replaces what is on this device. Everything restored counts
// as changed now: a record deleted by mistake and brought back this way must outrank the deletion mark the other
// devices and the cloud copy still hold for it, or the next sync would take it away again without a word.
// The same goes for the parts of a booking that keep a time of their own (budget, stripboard, quote, invoice). And what
// this device held that the backup does not is marked deleted, so that the other devices let go of it too and do not
// hand it back at the next sync: after a restore every device ends with what the backup holds.
// "Now" is never earlier than the newest time in the copy this device holds (newestIn): on a device whose clock runs
// behind, the plain clock would be older than the marks and edits it has already taken from the cloud, and the
// restore would be undone by the next sync.
// A list or a setting the file does not carry at all (a backup made before it existed, a file with one list in it) is
// no part of the backup: this device's own stays as it is, unstamped, and nothing of it is marked deleted. Only a
// list the file does carry, empty or not, replaces the one here.
export const carries = (data, k) => { const v = data && typeof data === 'object' ? data[k] : null; return LISTS.includes(k) || k === 'logs' ? Array.isArray(v) : ['profile', 'billing', 'priceList', 'templates', 'calSync', 'deleted'].includes(k) ? !!v && typeof v === 'object' : v != null; };
export function replaceAll(data) {
  const was = db, now = Math.max(Date.now(), onePast(newestIn(db))), has = k => carries(data, k);
  db = normalise(data);
  for (const k of Object.keys(was)) if (!has(k) && k !== 'version' && k !== 'updatedAt') db[k] = was[k];
  for (const list of LISTS) if (has(list)) db[list] = (db[list] || []).map(x => (x && typeof x === 'object' ? { ...x, updatedAt: now } : x));
  if (has('bookings')) db.bookings = db.bookings.map(b => {
    const o = { ...b };
    // (the stripboard also says when its scenes were last changed, which is what a sent call sheet is set against:
    // being restored is no change to them)
    if (o.board && typeof o.board === 'object') o.board = { ...o.board, editedAt: Number(o.board.editedAt) || Number(o.board.updatedAt) || 0 };
    for (const k of ['budget', 'board']) if (o[k] && typeof o[k] === 'object') o[k] = { ...o[k], updatedAt: now };
    for (const k of ['quote', 'invoice']) { if (o[k] && typeof o[k] === 'object') { o[k] = { ...o[k], updatedAt: now }; delete o[k + 'GoneAt']; } else o[k + 'GoneAt'] = now; }
    return o;
  });
  // A timecode log's notes and its script each follow their own time in a merge (mergeLog): the notes are stamped, the
  // script counts as put in now (also "no script"), and markGone leaves a mark for each note made since the backup.
  if (has('logs')) db.logs = db.logs.map(l => ({ ...l, updatedAt: now, script: l.script === undefined ? null : l.script, scriptAt: now, notes: l.notes.map(n => (n && typeof n === 'object' ? { ...n, upd: now } : n)) }));
  // The settings that follow their newer copy in a merge (the profile, the billing settings, the price list, the
  // checklists) count as changed now too: the save that follows a restore reads the cloud copy first, and its newer
  // settings would otherwise take the place of the restored ones at once (a price list emptied by mistake could not be
  // brought back). The calendar link is not content: it stays as the newer copy has it.
  for (const k of ['profile', 'billing', 'priceList', 'templates']) if (has(k) && db[k] && typeof db[k] === 'object') db[k] = { ...db[k], updatedAt: now };
  markGone(was, db, now);
  db.updatedAt = now;
  persistLocal();
  emit();
  schedulePush();
}

// Marks as deleted, in `now`, every record `was` held that `now` does not (a restore, the example data), and in a
// log that both hold every note `was` had that `now` does not (a log carries the marks of its own notes: mergeLog).
function markGone(was, now, at) {
  for (const list of [...LISTS, 'logs']) { const kept = new Set((now[list] || []).map(x => x.id)); for (const x of was[list] || []) if (x && x.id && !kept.has(x.id)) now.deleted[x.id] = at; }
  const before = new Map((was.logs || []).map(l => [l.id, l]));
  now.logs = (now.logs || []).map(l => {
    const kept = new Set((l.notes || []).map(n => n.id)), gone = ((before.get(l.id) || {}).notes || []).filter(n => n && n.id && !kept.has(n.id));
    return gone.length ? { ...l, dead: { ...(l.dead || {}), ...Object.fromEntries(gone.map(n => [n.id, at])) } } : l;
  });
}

export function exportJSON() { return JSON.stringify(db, null, 2); }

// Wipe this device: unlink storage first so the cloud copy is left alone.
export async function eraseAll() {
  clearTimeout(timer);
  await unlinkCloud(); // a sync that is reading at this moment finds its storage unlinked when the answer comes, and merges nothing (runSync)
  // Vdex open in another window of this device is told first (the storage listener below): the empty copy written
  // next is an erase, not a save for that window to merge its own copy into and write back. The plain copy goes
  // before the word does, so that a full storage has room for it.
  lsSet(KEY, null); lsSet(ERASING, String(Date.now()));
  db = blank(); db.updatedAt = Date.now();
  sealed = false; dirty = false;
  persistLocal(); emit();
  // The lock's vault, PIN and backup marks go too, otherwise the next start would bring the old data back; and so does
  // everything else Vdex keeps on this device (sign-ins, the phone's calendar link, the feed's link, the weather and
  // location caches, the fingerprint or face key), except plain preferences and the terms already agreed to. The
  // licence sign-in stays: Sign out under About & Licence gives it up (terms section 17).
  try { dispatchEvent(new Event('vdex-erased')); } catch { /* ignore */ } // the lock lets go of its key first: no vault rewrite, no seal on the way out
  const KEEP = new Set(['logi-terms', 'logi-prefs', 'logi-tour', 'logi-tour-at', 'logi-tab', 'logi-units', 'logi-wx-units', 'logi-stdday', 'logi-breakdefault', 'logi-notify', 'logi-hours-range', 'logi-eyeh', 'logi-decl', 'logi-lock-setup']);
  try { const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); keys.filter(k => k && (k.startsWith('logi-') || k.startsWith('msal.')) && !KEEP.has(k)).forEach(k => localStorage.removeItem(k)); } catch { /* blocked storage */ }
  try { await new Promise(res => { const r = indexedDB.deleteDatabase('logi'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch { /* ignore */ }
  try { sessionStorage.setItem('logi-wiped', 'Everything on this device was erased.'); } catch { /* ignore */ } // the PIN set-up that follows says so, as after Erase this device on the lock screen
  setTimeout(() => location.reload(), 600);
}

export function loadSample() {
  const d = new Date(); const iso = (off) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + off); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const venueA = uid(), todayJob = uid(), past0 = uid(), past1 = uid(), past2 = uid(), past3 = uid();
  // worked days for the hours chart: [booking, days ago, start h, end h, break min]
  const shift = (bid, ago, sh, eh, bm) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ago, sh, 0); const start = x.getTime(); return { id: uid(), bookingId: bid, date: iso(-ago), start, end: start + (eh - sh) * 36e5, breaks: bm ? [{ start: start + 4 * 36e5, end: start + 4 * 36e5 + bm * 6e4 }] : [], updatedAt: start }; };
  const was = db, now = Math.max(Date.now(), onePast(newestIn(db))); // never earlier than what this copy has seen, as for a restore
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
    profile: { ...db.profile, name: db.profile.name || 'Your Name', business: db.profile.business || 'Your Studio', title: 'Videographer / DOP', phone: db.profile.phone || '+1 555 0100', email: db.profile.email || 'you@example.com', website: db.profile.website || 'https://example.com', updatedAt: now }, // changed now: a linked device takes it, instead of each keeping its own for ever
  });
  // What the examples replace is marked deleted and the examples count as made now, so a linked device ends with the
  // examples too, not with both (the shifts keep their own times: the hours chart reads them).
  for (const list of ['bookings', 'crew', 'gear', 'kits', 'venues', 'insurance']) db[list] = db[list].map(x => ({ ...x, updatedAt: now }));
  markGone(was, db, now);
  db.updatedAt = now;
  persistLocal(); emit(); schedulePush();
}

/* ------------------------------ cloud sync ------------------------------ */

export const cloud = {
  notice: '', // why the last sign-in did not finish, shown in the storage panel
  supported: typeof window.showSaveFilePicker === 'function', // local-file linking
  adapter: null,
  auxName: '', feedUrl: '', feedError: '', // calendar feed (see calendar.js)
  backupError: '', // why today's dated backup could not be written, if it could not
  damaged: null, // the text of a cloud copy that could not be read as a Vdex database (null: none)
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
// Two things follow the licence a little differently: links and QR codes that pass on the contact card or equipment
// also work during the trial (`links`), and saving a backup file also works until `backupUntil`, 30 days after a
// licence stopped covering this device. The last answer is kept as 'vdex-paid': '1' a licence, '0' none, 'ro' none and
// read-only.
const lastPaid = lsGet('vdex-paid');
let paid = lastPaid !== '0' && lastPaid !== 'ro', paidPrompt = null, links = paid, backupUntil = 0;
cloud.paused = !paid;
// Read-only the last time the licence was known: read-only again from the start, until it is known (a licence check
// held up, neither loading nor failing, must not leave Vdex editable meanwhile). A first visit, with nothing kept, is
// not held up so.
const CHECKING = 'Vdex is still checking its licence, so nothing was changed. Try again in a moment.';
// Work Vdex does by itself meanwhile is refused quietly; a change someone just asked for is explained.
if (lastPaid === 'ro') {
  let said = 0, input = 0;
  try { for (const t of ['pointerdown', 'keydown', 'change']) document.addEventListener(t, e => { if (e.isTrusted) input = Date.now(); }, true); } catch { /* no page */ }
  gate = ({ quiet = false } = {}) => { if (!quiet && Date.now() - input < 3000 && Date.now() - said > 5e3) { said = Date.now(); toast(CHECKING); announce('Vdex is read-only. Nothing was changed.'); } return false; };
}
export const isPaid = () => paid;
export const linksAllowed = () => paid || links;
export const backupsAllowed = () => paid || Date.now() < backupUntil;
export const backupsUntil = () => (paid ? 0 : backupUntil); // when saving backups stops here, while a licence's 30 days run
export function setPaid(on, prompt, more = {}) {
  if (prompt) paidPrompt = prompt;
  const was = paid, wasMore = linksAllowed() + '|' + backupUntil; paid = !!on; cloud.paused = !paid;
  links = !!more.links; backupUntil = Number(more.backupUntil) || 0;
  lsSet('vdex-paid', paid ? '1' : more.canEdit === false ? 'ro' : '0');
  if (was === paid) { if (wasMore !== linksAllowed() + '|' + backupUntil) emit('licence'); return; }
  // 'licence': panels that show it (storage) redraw themselves; the page is not redrawn, so focus stays where it is.
  if (paid) { if (cloud.adapter) sync(); else emit('licence'); }
  else { clearTimeout(timer); if (cloud.adapter) setStatus('paused'); else emit('licence'); }
}
const may = what => paid || (what === 'link' && links) || (what === 'backup' && Date.now() < backupUntil);
const NO_CHECK = 'Vdex could not load the part of itself that checks the licence, so it is read-only until it can. Check the internet connection.';
// True when this device may (licensed, or licences not switched on; for 'link' also the trial, for 'backup' also the
// 30 days after a licence ended here); otherwise explains, offering a licence, and false.
export function requirePaid(what) {
  if (may(what)) return true;
  if (paidPrompt) paidPrompt(what);
  else loadLicence().then(() => { if (may(what)) return; if (paidPrompt) paidPrompt(what); else toast(L.waiting ? NO_CHECK : 'This comes with a Vdex licence.'); });
  return false;
}
// The same for a button that can wait a moment: the licence loads just after Vdex starts, and is known by the answer
// (the last answer this device saw is not taken on trust here).
export async function requireLicence(what) {
  await loadLicence();
  return requirePaid(what);
}

// The licence check itself (js/licence.js, and the website's js/licence-web.js), loaded once Vdex is up. While it
// cannot be loaded (a first visit that lost its connection, or a blocked file), or has not loaded 30 seconds after it
// was asked for, Vdex is read-only and nothing is copied or saved as a file; it is tried again when the connection
// comes back, when Vdex comes to the front and every minute, and js/licence.js sets the real rules once it is in.
// A browser remembers a module that failed to load, under its address, for as long as the page is open, and so would
// every module that imports it (Settings' licence panel, the tutorials). So the file is fetched first and imported only
// once that has worked; should the import fail all the same, later tries ask for it under a new address (js/licence.js
// does the same for the file it loads). Never fails: resolves once the licence is known, or not loaded.
const L = { mod: null, tries: 0, busy: null, waiting: false, timer: 0, heard: false, renamed: false };
export const licenceKnown = () => loadLicence();
export const licenceMissing = () => L.waiting; // the licence check could not be loaded (yet): Vdex is read-only
export async function importChecked(url, name, state) {
  const n = ++state.tries;
  if (!state.renamed) { const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${name} could not be loaded (${r.status})`); }
  try { return await import(state.renamed ? `${url.href}?try=${n}` : url.href); } catch (e) { state.renamed = true; throw e; }
}
export function loadLicence() {
  if (!L.busy) {
    L.busy = (L.mod ? Promise.resolve(L.mod) : importChecked(new URL('./licence.js', import.meta.url), 'js/licence.js', L).then(m => (L.mod = m)))
      .then(m => m.initLicence())
      .then(() => { clearInterval(L.timer); L.timer = 0; if (L.waiting) { L.waiting = false; emit('licence'); } }, waitForLicence)
      .finally(() => { L.busy = null; });
  }
  const busy = L.busy;
  return new Promise(done => { const slow = setTimeout(() => { waitForLicence(); done(); }, 30e3); busy.then(() => { clearTimeout(slow); done(); }); });
}
function waitForLicence() {
  if (L.waiting) return;
  L.waiting = true;
  let said = 0;
  setGate(({ quiet = false } = {}) => {
    if (!quiet && Date.now() - said > 5e3) { said = Date.now(); toast(NO_CHECK); announce('Vdex is read-only. Nothing was changed.'); } // once, not for every background change
    return false;
  });
  setPaid(false, null, { canEdit: false }); emit('licence');
  const again = () => { if (L.waiting && !document.hidden) loadLicence(); };
  if (!L.timer) L.timer = setInterval(again, 60e3);
  if (!L.heard) { L.heard = true; window.addEventListener('online', again); document.addEventListener('visibilitychange', again); }
}

// Resolves once initCloud() has found out whether a storage is linked: cloud.adapter is set by then, or stays null.
let linkKnown; export const cloudKnown = new Promise(res => { linkKnown = res; });
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
    else if (intent === 'calendar') { update(d => { const was = d.calSync || {}; d.calSync = { ...was, provider: 'microsoft', calendarId: (was.calendarFor || was.provider || 'microsoft') === 'microsoft' ? was.calendarId || null : null, calendarFor: 'microsoft', updatedAt: Date.now() }; }); /* a calendar id kept from another service's link is not Outlook's */ say('Connected to Outlook'); import('./calendar.js').then(m => m.syncCalendar({ interactive: false })).catch(() => {}); }
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
    linkKnown();
    if (cloud.adapter) await sync();
    if (icloudFirst) {
      if (cloud.status === 'synced' || sealed) say('Connected to iCloud'); // behind the PIN lock the first copy waits for the unlock
      else { const msg = cloud.error || 'iCloud didn’t finish connecting. Tap Connect to try again.'; cloud.adapter?.signOut?.(); cloud.adapter = null; lsSet('logi-provider', null); cloud.notice = msg; setStatus('off'); say(msg); }
    }
  } catch (e) { setStatus('error', e.message); }
  linkKnown();
  // After the start the cloud copy is read again whenever this device may have fallen behind another: when Vdex comes
  // to the front, when its window is clicked into, when the connection comes back, and every five minutes while it
  // stays in view (a desktop window left open never comes "to the front"). A sync that failed is tried again the same
  // way; one that waits for a sign-in needs the person's tap. Two of these at once are one sync.
  let asked = 0;
  const again = quiet => () => {
    if (document.hidden || !cloud.adapter || cloud.paused || !(cloud.status === 'synced' || cloud.status === 'error') || Date.now() - asked < 1000) return;
    asked = Date.now(); sync({ quiet: quiet && cloud.status === 'synced', join: true });
  };
  document.addEventListener('visibilitychange', again(false));
  window.addEventListener('focus', again(true)); window.addEventListener('online', again(true));
  setInterval(again(true), 5 * 60e3);
}

// Another window of Vdex on this device saved: its copy is merged into this window's, record by record as a copy from
// the cloud is, so the next save here does not write this window's older copy over what the other one just made.
// What this window has that the other lacks is saved in turn. A sealed window (hidden or locked) reads the disk when
// it is opened again.
// Erase all data in another window is no save: this window lets go of its copy as well (the lock of its key, as in the
// window that erased), writes nothing back, and starts again as that window does.
// An erase by a window still running 1.4.0 says no such word; the lock sees the PIN's settings go from the disk, which
// every erase removes before the empty copy is written, and calls this (js/lock.js).
const ERASING = 'logi-erasing';
let erased = false;
export function erasedElsewhere() {
  if (erased) return; erased = true;
  clearTimeout(timer); cloud.adapter = null;
  db = blank(); dirty = false; rev++;
  try { dispatchEvent(new Event('vdex-erased')); } catch { /* ignore */ }
  try { sessionStorage.setItem('logi-wiped', 'Everything on this device was erased.'); } catch { /* ignore */ }
  setTimeout(() => location.reload(), 700);
}
try {
  window.addEventListener('storage', e => {
    if (e.key === ERASING && e.newValue) return erasedElsewhere();
    if (e.key !== KEY || !e.newValue || sealed || erased) return;
    let theirs; try { theirs = normalise(JSON.parse(e.newValue)); } catch { return; }
    const merged = mergeDb(db, theirs);
    if (JSON.stringify(merged) === JSON.stringify(db)) return;
    db = merged; rev++; emit();
    if (!sameCopy(merged, theirs)) persistLocal();
  });
} catch { /* no page */ }

/* --------------------------------- merging --------------------------------- */
const LISTS = ['bookings', 'crew', 'gear', 'insurance', 'kits', 'venues', 'shifts', 'projectTemplates', 'myRoles']; // merged record by record (the logs too, with their notes)
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
// On a booking added from a shared link, which strips the link made is written beside the board, by id
// (shared.rows.strips, js/share-import.js). Both copies' lists are joined: an id is in a list only if a link made that
// strip, on whichever device, so neither copy can be wrong about one, and a copy that knows of fewer must not win.
// With one copy's list alone, a merge that takes the other's stripboard (or a copy handed back by a device on a
// version that merged the board without the list) would leave strips of the link unlisted, and the next update from
// the link would take them for the receiver's own and add them a second time. (An id whose strip has gone does no harm.)
// The quote and the invoice keep their own time too (js/money.js stamps each save, and leaves quoteGoneAt or
// invoiceGoneAt behind a deleted one): a payment recorded on the phone is not lost because the laptop, not yet in
// step, changed the booking's notes a minute later, and a document deleted on one device does not come back.
const docAt = (b, k) => (b && b[k] ? Number(b[k].updatedAt) || 0 : Number(b && b[k + 'GoneAt']) || 0);
const mergeBooking = (x, y) => {
  const base = newer(x, y), other = base === x ? y : x; let out = base;
  if (budgetAt(other) > budgetAt(base)) out = { ...out, budget: other.budget };
  if (boardAt(other) > boardAt(base)) out = { ...out, board: other.board };
  for (const k of ['quote', 'invoice']) if (docAt(other, k) > docAt(base, k)) {
    out = { ...out }; delete out[k]; delete out[k + 'GoneAt'];
    if (other[k]) out[k] = other[k]; else out[k + 'GoneAt'] = other[k + 'GoneAt'];
    // The booking that results is neither copy, so it counts as newer than both: a device on 1.4.0, which takes a
    // booking by its newer copy whole, then takes this one, and the two devices end with the same instead of each
    // keeping its own and uploading it at every sync. (A copy written by 1.4.0 leaves no mark behind a document
    // deleted there, so that document comes back from a device that still holds it: a booking edited on a device
    // that never had the document looks exactly the same, and taking that for a deletion would lose an invoice.)
    out.updatedAt = Math.max(ts(x), ts(y)) + 1;
  }
  const rows = base.shared && base.shared.rows, had = (rows && rows.strips) || [], seen = new Set(had), more = ((other.shared && other.shared.rows && other.shared.rows.strips) || []).filter(id => !seen.has(id));
  if (rows && more.length) out = { ...out, shared: { ...out.shared, rows: { ...rows, strips: [...had, ...more] } } };
  return out;
};
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
  for (const list of LISTS) out[list] = mergeList(local[list] || [], remote[list] || [], dead, list === 'bookings' ? mergeBooking : newer);
  out.logs = mergeList(local.logs, remote.logs, dead, (x, y) => mergeLog(x, y, dead));
  // A crew member, an item or a kit deleted on another device arrives as a deletion mark only: its id is taken out of
  // the bookings and kits here as well, as remove() does on the device that deleted it (and never for a record that
  // is still on a list, such as one restored from a backup).
  { const gone = list => { const ids = new Set(out[list].map(x => x.id)); return id => !!dead[id] && !ids.has(id); };
    const noGear = gone('gear'), noCrew = gone('crew'), noKit = gone('kits'), noVenue = gone('venues'), noBooking = gone('bookings');
    const less = (o, k, test) => (Array.isArray(o[k]) && o[k].some(test) ? { ...o, [k]: o[k].filter(id => !test(id)) } : o);
    const lessQty = o => (o.gearQty && Object.keys(o.gearQty).some(noGear) ? { ...o, gearQty: Object.fromEntries(Object.entries(o.gearQty).filter(([id]) => !noGear(id))) } : o);
    const lessKey = (o, k, test) => { if (o[k] == null || !test(o[k])) return o; const c = { ...o }; delete c[k]; return c; }; // a venue on a booking, a booking on a log
    out.bookings = out.bookings.map(b => lessKey(lessQty(less(less(less(b, 'gear', noGear), 'crew', noCrew), 'kits', noKit)), 'venueId', noVenue));
    out.kits = out.kits.map(k => lessQty(less(k, 'gear', noGear)));
    out.logs = out.logs.map(l => lessKey(l, 'bookingId', noBooking)); }
  out.profile = ts(remote.profile) > ts(local.profile) ? remote.profile : local.profile;
  { // calendar link follows the newer copy; the booking -> event map is the union, newer entry per booking
    const a = local.calSync || {}, b = remote.calSync || {}, base = ts(b) > ts(a) ? b : a;
    const events = { ...(a.events || {}) };
    // (two entries of the same time: the one that looked at the calendar later, so that both devices choose the same)
    for (const [k, v] of Object.entries(b.events || {})) { const cur = events[k]; if (!cur || (v.at || 0) > (cur.at || 0) || ((v.at || 0) === (cur.at || 0) && (Number(v.seen) || 0) > (Number(cur.seen) || 0))) events[k] = v; }
    out.calSync = { ...base, events };
  }
  out.templates = ts(remote.templates) > ts(local.templates) ? remote.templates : local.templates;
  out.billing = ts(remote.billing) > ts(local.billing) ? remote.billing : local.billing;
  out.priceList = ts(remote.priceList) > ts(local.priceList) ? remote.priceList : local.priceList; // its own record: a change to the other billing settings never undoes it
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}

// Two copies that differ only in the order of the records in a list, or of the keys in a record, hold the same: the
// pages sort the lists themselves, and each device keeps the order it met the records in. Without this, two devices
// that each added something would upload the whole copy at every sync from then on, for the order alone.
function sameCopy(x, y) {
  const byId = (p, q) => (String(p && p.id) < String(q && q.id) ? -1 : 1);
  const text = d => {
    const o = { ...d }; for (const list of LISTS) if (Array.isArray(o[list])) o[list] = [...o[list]].sort(byId);
    o.logs = [...(o.logs || [])].sort(byId).map(l => ({ ...l, notes: [...(l.notes || [])].sort(byId) }));
    return JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v));
  };
  return text(x) === text(y);
}

// Merge the remote copy in, then push if anything here isn't in it yet. `quiet` skips the "Saving…" flicker (background polls).
// One sync at a time. A sync asked for while another is running waits for it and then runs, so a fresh link (or a
// change made meanwhile) is never skipped. join: the caller only wants this device to know what is in the cloud, so a
// sync that is already running will do, and no second one follows it.
let syncing = null;
export async function sync(opts = {}) {
  if (opts.join && syncing) return syncing.catch(() => {});
  while (syncing) await syncing.catch(() => {});
  if (sealed) { pendingSync = true; return; }
  if (!cloud.adapter) return;
  if (cloud.paused) return setStatus('paused'); // no licence: nothing is read from or written to the storage
  syncing = runSync(opts);
  try { return await syncing; } finally { syncing = null; }
}
// A storage unlinked while its answer was on the way (Disconnect, Erase all data) gets nothing merged from it, and
// says nothing about the state any more: `here` is false from then on.
async function runSync({ ask = false, quiet = false } = {}) {
  const a = cloud.adapter, here = () => cloud.adapter === a;
  try {
    if (!(await a.ready(ask))) { if (here()) setStatus('needs-permission'); return; }
    if (!here()) return;
    if (sealed) { pendingSync = true; return; } // locked while the sign-in was open: nothing is copied until it is unlocked
    if (!quiet) setStatus('saving');
    const remote = await a.read();
    if (!here()) return;
    cloud.damaged = null;
    if (cloud.paused) return setStatus('paused'); // paused while reading: nothing is merged or written
    if (!remote) return await push();
    const theirs = normalise(remote), merged = mergeDb(db, theirs);
    const localChanged = JSON.stringify(merged) !== JSON.stringify(db);
    const remoteStale = !sameCopy(merged, theirs);
    if (localChanged) { db = merged; persistLocal(); emit(); }
    if (remoteStale) await push();
    else {
      if (localChanged) await writeFeed(a); // what came in from another device goes into the calendar feed this device keeps
      lsSet('logi-sync-at', String(Date.now())); if (here()) setStatus(cloud.paused ? 'paused' : 'synced');
    }
  } catch (e) {
    if (!here()) return;
    // A copy that cannot be read as what Vdex wrote (cut short while it was being saved): kept, to be put beside the new
    // one, and the storage panel offers to replace it with this device's copy (replaceDamagedCopy).
    cloud.damaged = e.name === 'DamagedCopy' ? e.text || '' : null;
    setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message);
  }
}
// The copy in the storage could not be read: this device's copy takes its place, and what was there is first kept
// beside it (where the storage keeps files beside the database) in case something can be saved from it by hand.
export async function replaceDamagedCopy() {
  const a = cloud.adapter, text = cloud.damaged;
  if (!a || cloud.paused || text == null) return;
  if (text && a.writeExtra) try { await a.writeExtra('vdex-damaged-copy.json', text); } catch { /* the new copy matters more */ }
  cloud.damaged = null;
  await push();
}
// The calendar feed, where this storage keeps one and it is switched on.
async function writeFeed(a) {
  if (!a || !(db.calSync?.feed && auxWriter && a.writeAux) || cloud.adapter !== a) return; // (no storage: unlinked while the caller was reading)
  try { await a.writeAux(auxWriter()); cloud.feedError = ''; } catch (e) { cloud.feedError = e.message; }
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
    await writeFeed(a);
    if (cloud.adapter === a) setStatus(cloud.paused ? 'paused' : 'synced');
  } catch (e) { if (cloud.adapter === a) setStatus(e.name === 'NotAllowedError' ? 'needs-permission' : 'error', e.message); }
}
// The three feed actions read the cloud copy before they write, as every save does (sync): a blind write of this
// device's copy would take out of the storage what another device saved since this one last read it. Switching the
// feed on changes the calendar link, so its sync uploads, and the upload writes the feed; the other two write the
// feed themselves once the copies are in step.
export async function setFeed(on) {
  if (on) mustBePaid();
  if (on && cloud.adapter?.enableFeed) await cloud.adapter.enableFeed();
  update(d => { d.calSync = { ...d.calSync, feed: !!on, updatedAt: Date.now() }; });
  if (on) await sync();
}
export async function createFeedFile() { // local-file storage: pick where the feed file lives (same synced folder)
  mustBePaid();
  const handle = await window.showSaveFilePicker({ suggestedName: 'vdex-bookings.ics', types: [{ description: 'Calendar feed', accept: { 'text/calendar': ['.ics'] } }] });
  await kv('readwrite', s => s.put(handle, 'auxHandle'));
  if (cloud.adapter) cloud.adapter.aux = handle;
  cloud.auxName = handle.name;
  await sync(); await writeFeed(cloud.adapter);
}
export async function feedLink() {
  mustBePaid();
  if (!cloud.adapter?.shareLink) throw new Error('No link for this storage');
  await sync(); await writeFeed(cloud.adapter);
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
  } catch (e) { cloud.backupError = e.message || 'it could not be written'; } // shown where backups are spoken of (js/backup.js); the status that follows redraws them
}

let timer;
function schedulePush() {
  if (sealed) { pendingSync = true; return; }
  if (!cloud.adapter || cloud.paused || cloud.status === 'needs-permission') return;
  // Read, merge, then write (sync), never a blind write: another device may have saved since this one last read, and
  // its work would be gone from the cloud copy, and for good if that device were lost before it synced again.
  // Not quiet: from the read on it says "Saving…", since the change is not in the storage until the write is done (on
  // a slow connection "Synced" would stand there meanwhile, over a change that is on this device alone).
  clearTimeout(timer);
  timer = setTimeout(() => sync(), 800);
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
  cloud.adapter = null; cloud.auxName = ''; cloud.feedUrl = ''; cloud.backupError = ''; cloud.damaged = null; lsSet('logi-feed-url', null);
  await kv('readwrite', s => s.delete('auxHandle'));
  lsSet('logi-provider', null);
  await kv('readwrite', s => s.delete('fileHandle'));
  setStatus('off');
}

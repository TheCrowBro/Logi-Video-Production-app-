// Equipment arriving from outside: a list a workmate shared by link, or rows read from a spreadsheet. Plain item
// objects come in, under the names an equipment record uses (GEAR_FIELDS, plus an optional `ref` naming the item at
// its source). planGearImport() compares them with what is already owned and says, row by row, what would happen;
// the caller may show that and change each row's action; applyGearImport() then does it all in one change, which the
// store refuses while Vdex is read-only, and undoGearImport() takes it back as far as that is still safe. roomFor()
// says beforehand whether the browser's storage can hold the database as a change would leave it (any change: an
// equipment list, a shared booking), so that what does not fit is turned down instead of added and then not saved.
// Nothing here draws anything. Loaded on first use.
import { uid } from './util.js';
import { db, update, serialize } from './store.js';

// What describes an item. Not here on purpose: its service log, and which bookings and kits use it.
export const GEAR_FIELDS = ['name', 'category', 'serial', 'location', 'qty', 'value', 'purchased', 'warranty', 'serviceEvery', 'firmware', 'notes'];
export const ACTIONS = [['skip', 'Skip it: leave mine as it is'], ['update', 'Update mine with these details'], ['add', 'Add anyway, as another item']];
// Two serial numbers are the same whatever their capitals, spaces or hyphens.
export const serialKey = s => String(s == null ? '' : s).toUpperCase().replace(/[\s-]+/g, '');
const nameKey = g => `${String(g.name || '').trim().toLowerCase()}|${String(g.category || '').trim().toLowerCase()}`;
const has = v => v !== '' && v != null;
const tidy = v => (typeof v === 'string' ? v.trim() : v);
const qty = v => Math.max(1, Math.floor(Number(v)) || 1);

// → { rows: [{ item, match, why, action }] }, in the order given (items without a name are left out).
// match is the owned item a row duplicates, and why says how it was found:
//   'ref'     it was added from this very source item before: action 'update', so the sender's newer details come in.
//             Or it is that item itself (match.id === item.ref: the list was made from one's own item): action
//             'skip', because one's own item is at least as new as any list made from it
//   'serial'  the same serial number: action onSerial ('skip' unless asked otherwise)
//   'name'    only with matchNames: the same name and category, neither with a serial number: action onName
// A row with no match is 'add'. A row's action may be changed to 'add', 'update' or 'skip' before applying.
export function planGearImport(items, { existing = db.gear, onSerial = 'skip', onName = 'skip', matchNames = false } = {}) {
  // By name an owned item is matched by one row only: two owned items of one name (four lights in the van, two on a
  // shelf) are two rows in a list, and each row goes to its own, the one in the same place first. A row beyond the
  // items owned under that name matches nothing and is an add.
  const byRef = new Map(), bySerial = new Map(), byName = new Map(), taken = new Set(), place = x => String((x && x.location) || '').trim().toLowerCase();
  for (const g of existing) {
    const k = serialKey(g.serial);
    if (g.shared && g.shared.ref && !byRef.has(g.shared.ref)) byRef.set(g.shared.ref, g);
    if (k && !bySerial.has(k)) bySerial.set(k, g);
    if (!k) { const n = nameKey(g); if (byName.has(n)) byName.get(n).push(g); else byName.set(n, [g]); }
  }
  const named = item => { const free = (byName.get(nameKey(item)) || []).filter(g => !taken.has(g)); return free.find(g => place(g) === place(item)) || free[0] || null; };
  for (const g of existing) byRef.set(g.id, g); // an item's own id comes before a copy made from it
  const rows = (items || []).filter(x => x && String(x.name || '').trim()).map(item => {
    const k = serialKey(item.serial), ref = item.ref && byRef.get(item.ref), ser = k && bySerial.get(k), nam = !ref && matchNames && !k && named(item);
    if (ref || ser || nam) taken.add(ref || ser || nam);
    return ref ? { item, match: ref, why: 'ref', action: ref.id === item.ref ? 'skip' : 'update' } : ser ? { item, match: ser, why: 'serial', action: onSerial } : nam ? { item, match: nam, why: 'name', action: onName } : { item, match: null, why: '', action: 'add' };
  });
  return { rows };
}
// What a row will really do: an update with nothing to update is an add.
const doing = r => (r.action === 'update' && !r.match ? 'add' : r.action === 'update' || r.action === 'skip' ? r.action : 'add');
export const planCounts = plan => plan.rows.reduce((c, r) => { c[doing(r)]++; return c; }, { add: 0, update: 0, skip: 0 });

// A new record has every field; an update takes only the fields the row has something in, so nothing owned is blanked.
const fields = (item, fresh) => {
  const o = {};
  for (const f of GEAR_FIELDS) { const v = f === 'qty' ? (has(item.qty) ? qty(item.qty) : fresh ? 1 : '') : tidy(item[f]); if (has(v)) o[f] = v; else if (fresh) o[f] = ''; }
  return o;
};

// A list may say when each item was last serviced (Vdex's own asset register does): item.lastService, a date. It
// becomes a line in the item's service log, unless the log already has a service, clean, calibration or check that recent.
const servicedOn = g => (g.log || []).filter(e => ['service', 'clean', 'calibration', 'check'].includes(e.kind) && e.date).map(e => e.date).sort().pop() || '';
const serviceLine = (g, date) => (/^\d{4}-\d{2}-\d{2}$/.test(date || '') && date > servicedOn(g) ? [...(g.log || []), { id: uid(), date, kind: 'service', note: 'Last service, as an imported list gave it', cost: '' }] : null);

// The kit a list's kit is here already as: one's own (the list was made from it), or one made from that kit before.
export const kitOf = (kits, ref) => (ref && kits.find(x => x.id === ref || (x.shared && x.shared.ref === ref))) || null;

// The plan carried out on the database it is given: the stored one inside update() (applyGearImport), or a copy of it
// when the question is only how big the database would become (roomForGear). out collects what was done.
const outcome = () => ({ added: [], updated: [], skipped: 0, ids: [], kits: [], at: Date.now(), before: [], kitsAdded: [], kitsBefore: [] });
function carry(d, plan, { kits = [], from = '' } = {}, out) {
  const now = out.at, acts = [];
  const mark = ref => (ref || from ? { shared: { ...(ref ? { ref } : {}), by: from, at: now } } : {});
  const copy = x => JSON.parse(JSON.stringify(x));
  const owned = new Map(d.gear.map(g => [g.id, g])), changed = new Set(); // one look-up per row, so a list of thousands stays quick
  plan.rows.forEach((r, i) => {
    const cur = r.match ? owned.get(r.match.id) || null : null, act = acts[i] = doing({ ...r, match: cur });
    if (act === 'add') { const g = { id: uid(), ...fields(r.item, true), ...mark(r.item.ref), updatedAt: now }, log = serviceLine(g, r.item.lastService); if (log) g.log = log; d.gear.push(g); out.added.push(g.id); out.ids[i] = g.id; }
    else if (act === 'update') {
      if (!changed.has(cur.id)) { changed.add(cur.id); out.before.push(copy(cur)); out.updated.push(cur.id); }
      const log = serviceLine(cur, r.item.lastService);
      Object.assign(cur, fields(r.item, false), cur.id === r.item.ref ? {} : mark(r.item.ref), log ? { log } : {}, { updatedAt: now }); out.ids[i] = cur.id;
    }
    else { out.skipped++; out.ids[i] = cur ? cur.id : null; }
  });
  for (const k of kits) {
    const gear = [], gearQty = {};
    for (const [row, n] of k.items || []) { const id = out.ids[row]; if (!id || gear.includes(id)) continue; gear.push(id); if (qty(n) > 1) gearQty[id] = qty(n); }
    if (!gear.length || !String(k.name || '').trim()) continue;
    const cur = kitOf(d.kits, k.ref);
    // A kit that is here already (one's own, or made from this source before) is left as it is when every row it
    // names was skipped: with nothing taken from the list, the kit is not rewritten from the list either.
    if (cur && !(k.items || []).some(([row]) => acts[row] === 'add' || acts[row] === 'update')) continue;
    if (cur) out.kitsBefore.push(copy(cur));
    if (cur) Object.assign(cur, { name: k.name, description: k.description || cur.description || '', notes: k.notes || cur.notes || '', gear, gearQty, updatedAt: now }, cur.id === k.ref ? {} : mark(k.ref));
    else d.kits.push({ id: uid(), name: k.name, description: k.description || '', gear, gearQty, notes: k.notes || '', ...mark(k.ref), updatedAt: now });
    out.kits.push(cur ? cur.id : d.kits[d.kits.length - 1].id);
    if (!cur) out.kitsAdded.push(d.kits[d.kits.length - 1].id);
  }
  return out;
}

// Carries the plan out. kits: [{ ref, name, description, notes, items: [[row, quantity], …] }], a row being a place in
// plan.rows: each is made as a kit of the items those rows ended up as (a skipped duplicate counts as the owned item),
// or updated when it was made from the same source kit before and at least one of its rows was added or updated (a
// kit whose rows were all skipped stays as it is). from: who the list is from; a record made or updated from a source
// remembers it (record.shared), which is what lets the same list update it next time.
// → false when the change was refused, else { added: [ids], updated: [ids], skipped, ids: [id or null per row], kits: [ids] },
// which also remembers what undoGearImport() needs: when it happened (at), each updated item and kit as it was before
// (before, kitsBefore) and the kits it made (kitsAdded).
export function applyGearImport(plan, { kits = [], from = '' } = {}) {
  const out = outcome();
  if (update(d => { carry(d, plan, { kits, from }, out); }) === false) return false;
  // "When it happened" is the time the records now carry, which is what Undo knows them by: the store counts a change
  // as later than everything its copy has seen, and moves the time when another device's clock runs ahead (update()).
  const one = db.gear.find(g => g.id === (out.added[0] || out.updated[0])) || db.kits.find(k => k.id === out.kits[0]);
  if (one && Number(one.updatedAt)) out.at = one.updatedAt;
  return out;
}

/* --------------------------------- room to keep it --------------------------------- */
// Vdex keeps everything in this browser's own storage, which has a ceiling (about 5 MB in most browsers), and with a
// PIN the encrypted copy sits in the same storage beside the plain one. roomFor() answers, before anything is
// changed, whether the database would still fit after a change:
//   change(d)  makes the change on the copy of the database it is given, exactly as it would inside update()
//   → true when it fits (or the storage cannot be asked at all), false when the browser would refuse the save
// It measures what would really be written: the whole database as text after the change, less what is stored now,
// and with a PIN the growth of the encrypted copy as well. Then it asks the browser, by writing a test entry of that
// size and taking it away again at once. The entry is made of random characters: nothing of the database is ever
// written anywhere but in its own two entries (so nothing plain can be left behind the lock), and a browser that
// squeezes what it stores is not flattered by a run of one letter.
const STORED = 'logi-db-v1', VAULT = 'logi-vault', PROBE = 'logi-import-room';
const bytes = text => new TextEncoder().encode(text).length;
// The vault holds the database as a string inside JSON (every quote in it escaped), encrypted (16 bytes more) and
// written in base64 (4 characters for every 3 bytes).
const sealedSize = text => Math.ceil((bytes(JSON.stringify(text)) + 16) / 3) * 4;
function noise(n) { let s = ''; const buf = new Uint8Array(30000); while (s.length < n) { crypto.getRandomValues(buf); s += btoa(String.fromCharCode.apply(null, buf)); } return s.slice(0, n); }
export function roomFor(change) {
  let plain, vault;
  try { plain = localStorage.getItem(STORED); vault = localStorage.getItem(VAULT); } catch { return true; } // storage is blocked: there is nothing to ask, and the store says so itself when a save fails
  const now = serialize(), copy = JSON.parse(now);
  change(copy);
  const next = JSON.stringify(copy);
  const morePlain = Math.max(0, next.length - (plain == null ? 0 : plain.length));
  const moreVault = vault == null ? 0 : Math.max(0, sealedSize(next) + Math.max(0, vault.length - sealedSize(now)) - vault.length); // what else the vault holds (sign-ins) stays the size it is
  if (!(morePlain + moreVault)) return true;
  const spare = 2048 + Math.ceil((morePlain + moreVault) / 50); // ids and times are not the same to the letter on the real run
  try { localStorage.setItem(PROBE, noise(morePlain + moreVault + spare)); return true; } catch { return false; }
  finally { try { localStorage.removeItem(PROBE); } catch { /* nothing to take away */ } }
}
// The same question for an equipment import: the plan as applyGearImport(plan, { kits, from }) would carry it out.
export const roomForGear = (plan, { kits = [], from = '' } = {}) => roomFor(d => { carry(d, plan, { kits, from }, outcome()); });

// Takes back what applyGearImport() did (done: what it returned), as far as that is safe. An item or kit it added is
// removed when nothing has changed it since and nothing uses it (no booking, no other kit); one it updated gets back
// what it held before, when nothing has changed it since. Whatever was touched in the meantime stays as it is now.
// → false when the change was refused, else { removed, restored, kept }, counting items.
export function undoGearImport(done) {
  const out = { removed: 0, restored: 0, kept: 0 };
  const ok = update(d => {
    const now = Math.max(Date.now(), done.at + 1), fresh = x => x && x.updatedAt === done.at; // later than the import, so a merge with an older copy cannot bring the items back
    const goneKits = new Set((done.kitsAdded || []).filter(id => fresh(d.kits.find(k => k.id === id)) && !d.bookings.some(b => (b.kits || []).includes(id))));
    if (goneKits.size) { d.kits = d.kits.filter(k => !goneKits.has(k.id)); goneKits.forEach(id => { d.deleted[id] = now; }); }
    for (const was of done.kitsBefore || []) { const i = d.kits.findIndex(k => k.id === was.id); if (i >= 0 && fresh(d.kits[i])) d.kits[i] = { ...was, updatedAt: now }; }
    const used = new Set(); d.bookings.forEach(b => (b.gear || []).forEach(id => used.add(id))); d.kits.forEach(k => (k.gear || []).forEach(id => used.add(id)));
    const owned = new Map(d.gear.map(g => [g.id, g])), gone = new Set();
    for (const id of done.added || []) { const g = owned.get(id); if (!g) continue; if (!fresh(g) || used.has(id)) { out.kept++; continue; } gone.add(id); d.deleted[id] = now; }
    if (gone.size) d.gear = d.gear.filter(g => !gone.has(g.id));
    out.removed = gone.size;
    for (const was of done.before || []) { const i = d.gear.findIndex(g => g.id === was.id); if (i < 0) continue; if (!fresh(d.gear[i])) { out.kept++; continue; } d.gear[i] = { ...was, updatedAt: now }; out.restored++; }
  });
  return ok === false ? false : out;
}

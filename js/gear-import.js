// Equipment arriving from outside: a list a workmate shared by link, or rows read from a spreadsheet. Plain item
// objects come in, under the names an equipment record uses (GEAR_FIELDS, plus an optional `ref` naming the item at
// its source). planGearImport() compares them with what is already owned and says, row by row, what would happen;
// the caller may show that and change each row's action; applyGearImport() then does it all in one change, which the
// store refuses while Vdex is read-only, and undoGearImport() takes it back as far as that is still safe. Nothing here
// draws anything. Loaded on first use.
import { uid } from './util.js';
import { db, update } from './store.js';

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
//   'ref'     it was added from this very source item before (or is that item itself): action 'update'
//   'serial'  the same serial number: action onSerial ('skip' unless asked otherwise)
//   'name'    only with matchNames: the same name and category, neither with a serial number: action onName
// A row with no match is 'add'. A row's action may be changed to 'add', 'update' or 'skip' before applying.
export function planGearImport(items, { existing = db.gear, onSerial = 'skip', onName = 'skip', matchNames = false } = {}) {
  const byRef = new Map(), bySerial = new Map(), byName = new Map();
  for (const g of existing) {
    const k = serialKey(g.serial);
    if (g.shared && g.shared.ref && !byRef.has(g.shared.ref)) byRef.set(g.shared.ref, g);
    if (k && !bySerial.has(k)) bySerial.set(k, g);
    if (!k && !byName.has(nameKey(g))) byName.set(nameKey(g), g);
  }
  for (const g of existing) byRef.set(g.id, g); // an item's own id comes before a copy made from it
  const rows = (items || []).filter(x => x && String(x.name || '').trim()).map(item => {
    const k = serialKey(item.serial), ref = item.ref && byRef.get(item.ref), ser = k && bySerial.get(k), nam = matchNames && !k && byName.get(nameKey(item));
    return ref ? { item, match: ref, why: 'ref', action: 'update' } : ser ? { item, match: ser, why: 'serial', action: onSerial } : nam ? { item, match: nam, why: 'name', action: onName } : { item, match: null, why: '', action: 'add' };
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

// Carries the plan out. kits: [{ ref, name, description, notes, items: [[row, quantity], …] }], a row being a place in
// plan.rows: each is made as a kit of the items those rows ended up as (a skipped duplicate counts as the owned item),
// or updated when it was made from the same source kit before. from: who the list is from; a record made or updated
// from a source remembers it (record.shared), which is what lets the same list update it next time.
// → false when the change was refused, else { added: [ids], updated: [ids], skipped, ids: [id or null per row], kits: [ids] },
// which also remembers what undoGearImport() needs: when it happened (at), each updated item and kit as it was before
// (before, kitsBefore) and the kits it made (kitsAdded).
export function applyGearImport(plan, { kits = [], from = '' } = {}) {
  const out = { added: [], updated: [], skipped: 0, ids: [], kits: [], at: 0, before: [], kitsAdded: [], kitsBefore: [] }, now = out.at = Date.now();
  const mark = ref => (ref || from ? { shared: { ...(ref ? { ref } : {}), by: from, at: now } } : {});
  const copy = x => JSON.parse(JSON.stringify(x));
  const ok = update(d => {
    const owned = new Map(d.gear.map(g => [g.id, g])), changed = new Set(); // one look-up per row, so a list of thousands stays quick
    plan.rows.forEach((r, i) => {
      const cur = r.match ? owned.get(r.match.id) || null : null, act = doing({ ...r, match: cur });
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
      const cur = k.ref ? d.kits.find(x => x.id === k.ref || (x.shared && x.shared.ref === k.ref)) : null;
      if (cur) out.kitsBefore.push(copy(cur));
      if (cur) Object.assign(cur, { name: k.name, description: k.description || cur.description || '', notes: k.notes || cur.notes || '', gear, gearQty, updatedAt: now }, cur.id === k.ref ? {} : mark(k.ref));
      else d.kits.push({ id: uid(), name: k.name, description: k.description || '', gear, gearQty, notes: k.notes || '', ...mark(k.ref), updatedAt: now });
      out.kits.push(cur ? cur.id : d.kits[d.kits.length - 1].id);
      if (!cur) out.kitsAdded.push(d.kits[d.kits.length - 1].id);
    }
  });
  return ok === false ? false : out;
}

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

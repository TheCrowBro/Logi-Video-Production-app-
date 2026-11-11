// Backline: the instruments, amps, mics, DIs and cables the band owns, with make, model, serial, value and whose they
// are; stage packs (saved sets of backline for a kind of gig); and the inventory for an insurer or a customs carnet.
// The page draws from db every time (it is drawn again after every change), and every change goes through the store.
import { h, nodes, empty, sheet, toast, fmtShort, fmtLong, todayISO, groupBy } from '../util.js';
import { db, byId, upsert, patch, remove, subscribe, gearBookings, gearClash, gearShort, activeBookings, lastDay, qtyOf, usedQty, unitValue, totalValue } from '../store.js';
import { GEAR_CATS, PEOPLE_GROUPS, fmtMoney, currency, bookingTitle, kindIcon, statusLabel, statusTone } from '../model.js';
import { openForm } from '../form.js';
import { printElement, docPage, saveFile, fileName, csv } from '../print.js';
import { sheetTutorial } from '../tour.js';

// What the page is showing. Kept here so it survives the redraw after every change.
const S = { view: 'items', q: '', owner: '' }; // owner: '' everyone, 'band' (nobody's own), or a person's id

/* ------------------------------- helpers ------------------------------- */
const catOf = g => String((g && g.category) || '').trim() || 'Other';
const catRank = c => { const i = GEAR_CATS.indexOf(c); return i >= 0 ? i : GEAR_CATS.length - 1.5; }; // a category of its own sits just before Other
const byCatThenName = (a, b) => catRank(catOf(a)) - catRank(catOf(b)) || catOf(a).localeCompare(catOf(b)) || String(a.name || '').localeCompare(String(b.name || ''));
const sortGear = list => [...list].sort(byCatThenName);
const ownerOf = g => (g && g.owner && byId('people', g.owner)) || null; // an owner deleted elsewhere reads as the band
const ownerName = g => { const p = ownerOf(g); return p ? p.name || 'Unnamed' : ''; };
const makeModel = g => [g.make, g.model].map(x => String(x || '').trim()).filter(Boolean).join(' ');
const hasValue = g => unitValue(g) > 0;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const itemName = g => String((g && g.name) || '').trim() || 'Unnamed item';
const brand = () => db.profile.business || db.profile.name || 'Gdex';
// Stage packs keep their counts in k.qty ({ gearId: n }); never more than are owned.
const packQty = (k, id) => Math.max(1, Math.floor(Number(k && k.qty && k.qty[id])) || 1);
const packItems = k => (Array.isArray(k && k.items) ? k.items : []).map(id => byId('gear', id)).filter(Boolean);
const packCount = (k, g) => Math.min(packQty(k, g.id), qtyOf(g));
const packPieces = k => packItems(k).reduce((s, g) => s + packCount(k, g), 0);
const packValue = k => packItems(k).reduce((s, g) => s + unitValue(g) * packCount(k, g), 0);
const dateText = b => (b.date ? fmtShort(b.date) + (lastDay(b) > b.date ? ' – ' + fmtShort(lastDay(b)) : '') : 'No date yet');

// The live bookings an item is on, soonest first. A booking saved without a date must not break the page.
function bookingsWith(id) {
  try { return gearBookings(id); } catch { return activeBookings().filter(b => (b.gear || []).includes(id)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))); }
}
const isAhead = (b, today = todayISO()) => !b.date || lastDay(b) >= today;
const aheadOf = id => { const t = todayISO(); return bookingsWith(id).filter(b => isAhead(b, t)); };
const clashesOf = (b, id) => { try { return b.date ? gearClash(b, id) : []; } catch { return []; } };
const goBooking = id => import('./bookings.js').then(m => m.openBooking(id)).catch(e => { console.error(e); toast('That booking could not be opened.'); });

// Everyone who can own gear, band first, then by name.
const groupRank = p => { const i = PEOPLE_GROUPS.findIndex(x => x[0] === p.group); return i < 0 ? PEOPLE_GROUPS.length : i; };
const peopleSorted = () => [...db.people].sort((a, b) => groupRank(a) - groupRank(b) || String(a.name || '').localeCompare(String(b.name || '')));
const locations = () => [...new Set(db.gear.map(g => String(g.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const MAKES = ['Fender', 'Gibson', 'Gretsch', 'Ibanez', 'PRS', 'Rickenbacker', 'Martin', 'Taylor', 'Yamaha', 'Roland', 'Korg', 'Nord', 'Moog', 'Arturia', 'Novation', 'Marshall', 'Vox', 'Orange', 'Ampeg', 'Mesa/Boogie', 'Kemper', 'Line 6', 'Fractal', 'Boss', 'Electro-Harmonix', 'Strymon', 'Pearl', 'Ludwig', 'DW', 'Tama', 'Sonor', 'Zildjian', 'Sabian', 'Meinl', 'Shure', 'Sennheiser', 'Audio-Technica', 'Neumann', 'AKG', 'Radial', 'Universal Audio', 'Focusrite', 'RME', 'Apple', 'Ableton', 'Mackie', 'QSC', 'Behringer', 'Midas', 'Allen & Heath', 'Pelican', 'SKB', 'Gator'];
const makes = () => [...new Set([...db.gear.map(g => String(g.make || '').trim()).filter(Boolean), ...MAKES])];
const PLACE_HINT = 'e.g. Rehearsal room, Van, Maya’s flat, Flight case 2, At the repair shop';

const matchOwner = g => !S.owner || (S.owner === 'band' ? !ownerOf(g) : g.owner === S.owner && !!ownerOf(g));
const searchText = g => [g.name, g.make, g.model, g.serial, g.location, g.notes, catOf(g), ownerName(g)].map(x => String(x || '')).join(' ').toLowerCase();

// Redraw without losing the box someone is typing in or the chip they tapped (by id).
function keepFocus(root, fn) {
  const a = document.activeElement;
  const id = a && a !== document.body && root.contains(a) ? a.id : '';
  const pos = id && typeof a.selectionStart === 'number' ? a.selectionStart : null;
  fn();
  if (!id) return;
  const el = document.getElementById(id);
  if (!el || !root.contains(el)) return;
  el.focus({ preventScroll: true });
  if (pos != null) { try { el.setSelectionRange(pos, pos); } catch { /* not a text box */ } }
}

/* ------------------------------- the page ------------------------------- */
export const backline = {
  id: 'backline', label: 'Backline', icon: '🎛️',
  render(root) {
    const draw = () => keepFocus(root, () => root.replaceChildren(...nodes(S.view === 'packs' ? packsView(draw) : itemsView(draw))));
    draw();
  },
  tutorial: () => (S.view === 'packs' ? PACK_STEPS : ITEM_STEPS),
};

const stat = (v, label, cls = '') => h('div', { class: 'stat' + (cls ? ' ' + cls : '') }, h('b', null, String(v)), h('span', null, label));

function head(draw) {
  const packs = S.view === 'packs';
  const units = db.gear.reduce((s, g) => s + qtyOf(g), 0);
  const tab = (id, label) => h('button', { type: 'button', role: 'tab', id: 'bl-tab-' + id, class: S.view === id ? 'on' : '', 'aria-selected': String(S.view === id),
    onclick: () => { if (S.view !== id) { S.view = id; draw(); } } }, label);
  return [
    h('div', { class: 'page-head bl-head' }, h('h1', null, 'Backline'),
      h('button', { type: 'button', class: 'btn primary', id: 'bl-add', onclick: () => (packs ? editKit({}) : editGear({})) }, packs ? '+ New pack' : '+ Add')),
    h('div', { class: 'seg bl-seg', role: 'tablist', 'aria-label': 'Items or stage packs' }, tab('items', `Items (${units})`), tab('packs', `Stage packs (${db.kits.length})`)),
  ];
}

function itemsView(draw) {
  const all = db.gear;
  if (S.owner && S.owner !== 'band' && !all.some(g => g.owner === S.owner && ownerOf(g))) S.owner = ''; // that person owns nothing now
  const q = S.q.trim().toLowerCase();
  const shown = sortGear(all.filter(g => matchOwner(g) && (!q || searchText(g).includes(q))));
  const units = all.reduce((s, g) => s + qtyOf(g), 0);
  const total = all.reduce((s, g) => s + totalValue(g), 0);
  const booked = all.filter(g => aheadOf(g.id).length > 0).length;
  const noValue = all.filter(g => !hasValue(g)).length;
  const owners = [...new Set(all.map(ownerOf).filter(Boolean))].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const chip = (key, label, n) => h('button', { type: 'button', id: 'bl-own-' + (key || 'all'), class: 'chip' + (S.owner === key ? ' on' : ''), 'aria-pressed': String(S.owner === key),
    onclick: () => { S.owner = key; draw(); } }, label, n != null && h('span', { class: 'bl-n' }, ' ' + n));
  const clear = h('button', { type: 'button', class: 'btn ghost', id: 'bl-clear', onclick: () => { S.q = ''; S.owner = ''; draw(); } }, 'Show everything');
  return [
    ...head(draw),
    all.length > 0 && h('div', { class: 'stats bl-stats' }, stat(units, units === 1 ? 'item' : 'items'), stat(fmtMoney(total), 'total value', 'bl-total'), stat(booked, 'booked ahead')),
    noValue > 0 && h('p', { class: 'note small bl-novalue' }, `${plural(noValue, 'item has', 'items have')} no value yet, so the total leaves ${noValue === 1 ? 'it' : 'them'} out.`),
    all.length > 0 && h('div', { class: 'subactions bl-docs' },
      h('button', { type: 'button', class: 'btn ghost small', id: 'bl-inv', onclick: () => openInventory() }, '🖨 Inventory'),
      h('button', { type: 'button', class: 'btn ghost small', id: 'bl-csv', onclick: () => saveCsv('') }, '⤓ CSV')),
    owners.length > 0 && h('div', { class: 'chips bl-owners', role: 'group', 'aria-label': 'Whose gear' },
      chip('', 'Everyone'), chip('band', '🎸 Band-owned', all.filter(g => !ownerOf(g)).length),
      owners.map(p => chip(p.id, p.name || 'Unnamed', all.filter(g => g.owner === p.id).length))),
    (all.length > 5 || S.q) && h('input', { class: 'search', type: 'search', id: 'bl-search', placeholder: 'Search name, make, serial, place…', 'aria-label': 'Search backline', value: S.q, autocomplete: 'off',
      oninput: e => { S.q = e.target.value; draw(); } }),
    shown.length
      ? h('div', { class: 'bl-groups' }, [...groupBy(shown, catOf)].map(([cat, list]) => groupSection(cat, list)))
      : all.length
        ? empty('Nothing matches that. Try another word, or show everyone’s gear.', clear)
        : empty('Log every guitar, amp, mic and DI the band owns, with serials and values. Then pick them for shows, pack them into stage packs, and print an inventory for insurance or a carnet.',
          h('button', { type: 'button', class: 'btn primary', id: 'bl-first', onclick: () => editGear({}) }, 'Add the first item')),
  ];
}

function groupSection(cat, list) {
  const n = list.reduce((s, g) => s + qtyOf(g), 0), v = list.reduce((s, g) => s + totalValue(g), 0);
  return h('section', { class: 'block bl-group', 'aria-label': cat },
    h('h3', null, h('span', null, cat), h('span', { class: 'bl-group-sum' }, [plural(n, 'piece'), v > 0 && fmtMoney(v)].filter(Boolean).join(' · '))),
    h('div', { class: 'list' }, list.map(itemCard)));
}

const valueText = g => {
  if (!hasValue(g)) return '';
  const n = qtyOf(g);
  return n > 1 ? `${fmtMoney(unitValue(g))} each · ${fmtMoney(totalValue(g))}` : fmtMoney(unitValue(g));
};

function itemCard(g) {
  const n = qtyOf(g), owner = ownerOf(g), next = aheadOf(g.id), mm = makeModel(g), val = valueText(g);
  return h('button', { type: 'button', class: 'card tap bl-card', id: 'bl-item-' + g.id, 'data-id': g.id, onclick: () => openGear(g.id) },
    h('span', { class: 'bl-card-top' },
      h('span', { class: 'bl-card-name' }, h('strong', null, itemName(g)), n > 1 && h('span', { class: 'bl-qty' }, ' ×' + n)),
      next.length > 0 && h('span', { class: 'pill st-confirmed' }, `${next.length} booked`)),
    mm && h('span', { class: 'bl-sub muted small' }, mm),
    h('span', { class: 'bl-meta small' },
      h('span', { class: 'bl-owner' + (owner ? '' : ' band') }, owner ? '👤 ' + (owner.name || 'Unnamed') : '🎸 Band'),
      g.location && h('span', { class: 'bl-loc' }, '📍 ' + g.location),
      g.serial && h('span', { class: 'bl-serial muted' }, 'S/N ' + g.serial),
      val && h('span', { class: 'bl-val' }, val)));
}

/* ------------------------------- one item ------------------------------- */
const row = (label, value) => (value == null || value === '' ? null : [h('dt', null, label), h('dd', null, value)]);

function bookingRow(b, g, close) {
  const q = usedQty(b, g.id), ahead = isAhead(b), short = ahead && gearShort(b, g.id), clash = ahead ? clashesOf(b, g.id) : [];
  // This booking alone needing more than are owned (How many was lowered after it was picked) comes first.
  const also = clash.length ? `Also needed at ${clash.map(bookingTitle).join(', ')} the same day` : '';
  const warn = short ? `⚠ Needs ${q}, and you own ${qtyOf(g)}.${also ? ' ' + also + '.' : ''}` : also ? `⚠ ${also}, and you own ${qtyOf(g)}.` : '';
  return h('button', { type: 'button', class: 'bl-row', id: 'bl-bk-' + b.id, onclick: () => { close(); goBooking(b.id); } },
    h('span', { class: 'bl-row-date' }, dateText(b)),
    h('span', { class: 'pill ' + statusTone(b.status) }, statusLabel(b.status)),
    h('span', { class: 'bl-row-main' }, `${kindIcon(b.kind)} ${bookingTitle(b)}`, q > 1 && h('b', { class: 'bl-qty' }, ` ×${q}`)),
    warn && h('span', { class: 'bl-row-warn' }, warn));
}

// The item's sheet: its details, the stage packs it is in, and the bookings it is on (tap one to open it).
export function openGear(id) {
  const first = byId('gear', id);
  if (!first) { toast('That item is no longer in your backline.'); return null; }
  let title = itemName(first);
  sheetTutorial(title, ITEM_SHEET_STEPS);
  const body = h('div', { class: 'stack bl-sheet' });
  let handle = null, queued = false, unsub = () => {};
  const close = () => handle && handle.close();
  const draw = () => {
    queued = false;
    const g = byId('gear', id);
    if (!g) { close(); return; } // deleted (here or from another sheet)
    if (handle && itemName(g) !== title) { // renamed: the sheet's heading follows
      title = itemName(g); sheetTutorial(title, ITEM_SHEET_STEPS);
      handle.el.setAttribute('aria-label', title);
      const h2 = handle.el.querySelector('.sheet-head h2'); if (h2) h2.textContent = title;
    }
    const n = qtyOf(g), owner = ownerOf(g), now = todayISO();
    const all = bookingsWith(id), next = all.filter(b => isAhead(b, now)), past = all.filter(b => !isAhead(b, now)).reverse();
    const packs = db.kits.filter(k => (k.items || []).includes(id));
    body.replaceChildren(...nodes(
      h('dl', { class: 'bl-kv' },
        row('Category', catOf(g)), row('Make', g.make), row('Model', g.model), row('Serial', g.serial),
        row('How many', n > 1 ? `${n} owned` : '1'),
        row('Value', hasValue(g) ? (n > 1 ? `${fmtMoney(unitValue(g))} each · ${fmtMoney(totalValue(g))} in all` : fmtMoney(unitValue(g))) : h('span', { class: 'muted' }, 'Not recorded')),
        row('Owner', owner
          ? h('button', { type: 'button', class: 'bl-link', id: 'bl-owner-link', onclick: () => import('./people.js').then(m => m.openPerson(owner.id)).catch(e => console.error(e)) }, (owner.name || 'Unnamed') + ' ›')
          : 'The band'),
        row('Where it is', g.location),
        row('Notes', g.notes)),
      h('div', { class: 'actions bl-sheet-actions' },
        h('button', { type: 'button', class: 'btn primary', id: 'bl-edit', onclick: () => editGear(g) }, '✎ Edit'),
        h('button', { type: 'button', class: 'btn ghost', id: 'bl-move', onclick: () => moveItem(g) }, '📍 Move')),
      packs.length > 0 && h('p', { class: 'small bl-in-packs' }, h('span', { class: 'muted' }, 'In stage packs: '), packs.map(k => (k.name || 'Untitled pack') + (packCount(k, g) > 1 ? ` ×${packCount(k, g)}` : '')).join(', ')),
      h('section', { class: 'bl-bookings' },
        h('h3', null, `Coming up (${next.length})`),
        next.length ? h('div', { class: 'bl-rows' }, next.map(b => bookingRow(b, g, close)))
          : h('p', { class: 'muted small' }, 'Not on any booking coming up. Pick it in a booking’s Line-up box, or put it in a stage pack.'),
        past.length > 0 && [h('h3', null, `Before (${past.length})`), h('div', { class: 'bl-rows' }, past.slice(0, 5).map(b => bookingRow(b, g, close))),
          past.length > 5 && h('p', { class: 'muted small' }, `and ${plural(past.length - 5, 'more booking')}.`)])));
  };
  handle = sheet(title, body, { onClose: () => unsub() });
  unsub = subscribe(() => { if (!queued) { queued = true; queueMicrotask(draw); } });
  draw();
  return handle;
}

// Where an item is right now, in one go: loading the van, lending a pedal, off to the repair shop.
function moveItem(g) {
  openForm({
    title: `Where is ${itemName(g)}?`, values: { location: g.location || '' }, saveLabel: 'Save',
    fields: [{ key: 'location', label: 'Where it is', list: locations(), placeholder: PLACE_HINT, hint: 'Leave it empty when there is nothing to say.' }],
    onSave: v => {
      if (!byId('gear', g.id)) return toast('That item was deleted meanwhile.');
      const place = String(v.location || '').trim();
      patch('gear', g.id, { location: place });
      toast(place ? `${itemName(g)}: ${place}` : 'Place cleared');
    },
  });
}

/* ------------------------------- forms ------------------------------- */
const num = (v, { min = 0, whole = false } = {}) => {
  if (v === '' || v == null || !Number.isFinite(Number(v))) return '';
  const n = Math.max(min, Number(v));
  return whole ? Math.floor(n) : n;
};

// Add or edit an item. onSaved(record) after it is stored.
export function editGear(g = {}, onSaved) {
  const cur = (g && g.id && byId('gear', g.id)) || g || {};
  const cats = !cur.category || GEAR_CATS.includes(cur.category) ? GEAR_CATS : [...GEAR_CATS, cur.category]; // keep a category of its own
  const ownerOk = cur.owner && byId('people', cur.owner);
  openForm({
    title: cur.id ? 'Edit item' : 'Add item',
    saveLabel: cur.id ? 'Save' : 'Add item',
    values: { qty: 1, ...cur, category: cur.category || 'Other', owner: ownerOk ? cur.owner : '' },
    fields: [
      { key: 'name', label: 'Item', required: true, placeholder: 'e.g. Telecaster, Bass amp, SM58' },
      { key: 'category', label: 'Category', type: 'select', options: cats },
      { key: 'make', label: 'Make', list: makes(), placeholder: 'e.g. Fender' },
      { key: 'model', label: 'Model', placeholder: 'e.g. Player Telecaster' },
      { key: 'serial', label: 'Serial number', hint: 'Insurers, customs and the police ask for it.' },
      { key: 'qty', label: 'How many', type: 'number', min: 1, hint: 'Own four SM58s? Enter 4.' },
      { key: 'value', label: 'Replacement value (each)', type: 'number', min: 0, step: 'any', placeholder: currency() },
      { key: 'owner', label: 'Whose it is', type: 'select', options: [['', 'Nobody / the band'], ...peopleSorted().map(p => [p.id, (p.name || 'Unnamed') + (p.role ? ' · ' + p.role : '')])] },
      { key: 'location', label: 'Where it is', list: locations(), placeholder: PLACE_HINT },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Strings and setup, quirks, what is in the case…' },
    ],
    onSave: v => {
      const name = String(v.name || '').trim();
      if (!name) return toast('Give the item a name first.');
      const stored = upsert('gear', { ...v, name, make: String(v.make || '').trim(), model: String(v.model || '').trim(), serial: String(v.serial || '').trim(),
        location: String(v.location || '').trim(), qty: Math.max(1, num(v.qty, { min: 1, whole: true }) || 1), value: num(v.value), owner: v.owner || '' });
      // Fewer owned now than a booking ahead needs: say so (each such booking is marked on the item's sheet).
      const short = cur.id && stored.qty < qtyOf(cur) ? aheadOf(stored.id).filter(b => gearShort(b, stored.id)).length : 0;
      toast(!cur.id ? `${name} added` : short ? `Saved, but ${plural(short, 'booking')} coming up ${short === 1 ? 'needs' : 'need'} more than you own now.` : 'Saved');
      onSaved && onSaved(stored);
    },
    onDelete: cur.id ? () => { remove('gear', cur.id); toast(`${itemName(cur)} deleted`); } : null,
  });
}

// Add or edit a stage pack: a name, its backline (with how many of each), and notes. onSaved(record) after it is stored.
export function editKit(k = {}, onSaved) {
  const cur = (k && k.id && byId('kits', k.id)) || k || {};
  const options = sortGear(db.gear).map(g => {
    const n = qtyOf(g), mm = makeModel(g);
    return { value: g.id, label: itemName(g), group: catOf(g), qtyMax: n, hint: [mm, n > 1 && `${n} owned`, ownerName(g)].filter(Boolean).join(' · ') };
  });
  openForm({
    title: cur.id ? 'Edit stage pack' : 'New stage pack',
    saveLabel: cur.id ? 'Save' : 'Make pack',
    values: { ...cur, items: (cur.items || []).filter(id => byId('gear', id)), qty: { ...(cur.qty || {}) } },
    fields: [
      { key: 'name', label: 'Pack name', required: true, placeholder: 'e.g. Club show, Festival fly-in, Acoustic duo' },
      { key: 'items', qtyKey: 'qty', label: 'Backline in this pack', type: 'checks', options, empty: 'Add backline items first, then group them into packs.',
        hint: 'Tick what goes. Use − and + for more than one of something you own several of.' },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Spares and things to buy or hire: strings, sticks, batteries, gaffer tape…' },
    ],
    onSave: v => {
      const name = String(v.name || '').trim();
      if (!name) return toast('Give the pack a name first.');
      const items = (v.items || []).filter(id => byId('gear', id));
      const qty = Object.fromEntries(Object.entries(v.qty || {}).filter(([id, n]) => items.includes(id) && Number(n) > 1));
      const stored = upsert('kits', { ...v, name, items, qty });
      toast(cur.id ? 'Saved' : `${name} made`);
      onSaved && onSaved(stored);
    },
    onDelete: cur.id ? () => { remove('kits', cur.id); toast(`${cur.name || 'Pack'} deleted`); } : null,
  });
}

/* ------------------------------- stage packs ------------------------------- */
function packsView(draw) {
  const kits = [...db.kits].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return [
    ...head(draw),
    h('p', { class: 'muted small bl-intro' }, 'A stage pack is a saved set of backline for a kind of gig. Pick a pack on a booking and its gear comes along.'),
    kits.length ? h('div', { class: 'list bl-packs' }, kits.map(packCard))
      : db.gear.length
        ? empty('No stage packs yet. Make one for each kind of gig you play: a club show, a festival fly-in, a studio day.', h('button', { type: 'button', class: 'btn primary', id: 'bl-first-pack', onclick: () => editKit({}) }, 'Make a stage pack'))
        : empty('Add your backline items first, then group them into stage packs.', h('button', { type: 'button', class: 'btn primary', id: 'bl-first', onclick: () => { S.view = 'items'; draw(); editGear({}); } }, 'Add an item')),
  ];
}

function packCard(k) {
  const items = sortGear(packItems(k)), pieces = packPieces(k), name = k.name || 'Untitled pack';
  const t = todayISO(), uses = activeBookings().filter(b => (b.kits || []).includes(k.id) && isAhead(b, t)).length;
  return h('div', { class: 'card bl-pack', 'data-id': k.id },
    h('div', { class: 'card-row' },
      h('div', { class: 'grow' }, h('strong', { class: 'bl-pack-name' }, name),
        h('div', { class: 'muted small' }, [plural(pieces, 'piece'), fmtMoney(packValue(k)), uses > 0 && `on ${plural(uses, 'booking')} ahead`].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Print the packing list for ' + name, title: 'Print packing list', onclick: () => printPack(k) }, '🖨'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Duplicate ' + name, title: 'Duplicate', onclick: () => duplicatePack(k) }, '⧉'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Edit ' + name, title: 'Edit', onclick: () => editKit(k) }, '✎')),
    items.length
      ? [...groupBy(items, catOf)].map(([cat, list]) => h('div', { class: 'bl-pack-line' }, h('b', null, cat + ': '), list.map(g => itemName(g) + (packCount(k, g) > 1 ? ` ×${packCount(k, g)}` : '')).join(', ')))
      : h('p', { class: 'muted small' }, 'Nothing in this pack yet. Tap ✎ to pick its backline.'),
    k.notes && h('div', { class: 'muted small prewrap bl-pack-notes' }, k.notes));
}

function duplicatePack(k) {
  const copy = upsert('kits', { ...k, id: undefined, createdAt: undefined, sample: undefined, name: (k.name || 'Pack') + ' (copy)', items: [...(k.items || [])], qty: { ...(k.qty || {}) } });
  toast(`${copy.name} made`);
}

/* ------------------------------- inventory ------------------------------- */
const scopeItems = who => sortGear(db.gear.filter(g => !who || (who === 'band' ? !ownerOf(g) : g.owner === who && !!ownerOf(g))));
const scopeName = who => (!who ? '' : who === 'band' ? 'Band-owned' : (byId('people', who) || {}).name || '');
const cell = (tag, v, cls) => h(tag, cls ? { class: cls } : null, v == null || v === '' ? '' : String(v));

// The inventory as a document: one numbered table by category, with make, model, serial, quantity, value and owner,
// and the totals. Insurers ask for it; so do customs for a carnet when the band tours abroad.
function inventoryDoc(who = '') {
  const items = scopeItems(who), p = db.profile, today = todayISO();
  const units = items.reduce((s, g) => s + qtyOf(g), 0), total = items.reduce((s, g) => s + totalValue(g), 0), missing = items.filter(g => !hasValue(g)).length;
  const scope = scopeName(who);
  let n = 0;
  const contact = [p.name && p.business ? p.name : '', p.phone, p.email].filter(Boolean).join(' · ');
  return h('div', { class: 'cs-doc bl-inv' },
    h('div', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-kicker' }, 'BACKLINE INVENTORY'), h('div', { class: 'cs-brand' }, brand())),
      h('div', { class: 'cs-when' }, h('b', null, fmtLong(today)), contact)),
    h('h2', null, scope ? `Backline: ${scope}` : 'Backline'),
    h('div', { class: 'cs-sub' }, `${plural(units, 'item')} · total replacement value ${fmtMoney(total)}`),
    items.length
      ? h('table', null,
        h('thead', null, h('tr', null, cell('th', '#'), cell('th', 'Item'), cell('th', 'Make'), cell('th', 'Model'), cell('th', 'Serial'), cell('th', 'Qty', 'num'), cell('th', 'Value each', 'num'), cell('th', 'Total', 'num'), cell('th', 'Owner'))),
        h('tbody', null, [...groupBy(items, catOf)].map(([cat, list]) => [
          h('tr', { class: 'bl-cat' }, h('td', { colSpan: 9 }, cat)),
          list.map(g => h('tr', { class: 'bl-line' }, cell('td', ++n, 'bl-no'), cell('td', itemName(g)), cell('td', g.make), cell('td', g.model), cell('td', g.serial), cell('td', qtyOf(g), 'num'),
            cell('td', hasValue(g) ? fmtMoney(unitValue(g)) : '—', 'num'), cell('td', hasValue(g) ? fmtMoney(totalValue(g)) : '—', 'num'), cell('td', ownerName(g) || 'Band'))),
        ])))
      : h('p', null, 'No items to list.'),
    h('div', { class: 'money-totals' },
      h('div', { class: 'cs-kv' }, h('span', null, 'Items'), h('b', null, String(units))),
      h('div', { class: 'cs-kv total' }, h('span', null, 'Total value'), h('b', { class: 'bl-inv-total' }, fmtMoney(total)))),
    missing > 0 && h('p', { class: 'cs-pre' }, `${plural(missing, 'item has', 'items have')} no value recorded.`),
    h('div', { class: 'cs-foot' }, `Replacement values as recorded by the owner. Made with Gdex on ${fmtLong(today)}.`));
}

const PRINT_CSS = '#print-root .bl-inv tr.bl-cat td{font-weight:700;background:#f1f1f1;-webkit-print-color-adjust:exact;print-color-adjust:exact}#print-root .bl-inv td.bl-no{color:#777}#print-root .bl-inv td.bl-tick{font-size:16px;line-height:1}';
const PAGE_CSS = PRINT_CSS.replace(/#print-root /g, '');

function inventoryCsv(who = '') {
  const items = scopeItems(who), sym = currency();
  const rows = [['#', 'Item', 'Category', 'Make', 'Model', 'Serial number', 'Quantity', `Value each (${sym})`, `Total (${sym})`, 'Owner', 'Where it is', 'Notes']];
  let total = 0;
  items.forEach((g, i) => {
    const each = unitValue(g), all = totalValue(g); total += all;
    rows.push([i + 1, itemName(g), catOf(g), g.make || '', g.model || '', g.serial || '', qtyOf(g), each || '', all || '', ownerName(g) || 'Band', g.location || '', String(g.notes || '').replace(/\r?\n/g, ' ')]);
  });
  rows.push(['', 'Total', '', '', '', '', items.reduce((s, g) => s + qtyOf(g), 0), '', total, '', '', `${brand()}, ${todayISO()}`]);
  return '﻿' + csv(rows).replace(/\n/g, '\r\n'); // a byte-order mark so spreadsheets read the currency and accents right
}

async function saveCsv(who) {
  const scope = scopeName(who);
  if (await saveFile(inventoryCsv(who), fileName(`Backline inventory${scope ? ' ' + scope : ''} ${todayISO()}`, 'csv'), 'text/csv')) toast('Inventory saved');
}

// The inventory sheet: whose gear, a preview, and Print, CSV and Save as a web page.
export function openInventory() {
  let who = S.owner && (S.owner === 'band' || byId('people', S.owner)) ? S.owner : '';
  const body = h('div', { class: 'stack bl-inv-sheet' });
  const draw = () => {
    const owners = [...new Set(db.gear.map(ownerOf).filter(Boolean))].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const select = h('select', { id: 'bl-inv-who', onchange: e => { who = e.target.value; draw(); document.getElementById('bl-inv-who')?.focus(); } },
      [['', 'Everything'], ['band', 'Band-owned'], ...owners.map(p => [p.id, p.name || 'Unnamed'])].map(([v, l]) => h('option', { value: v, selected: v === who }, l)));
    const scope = scopeName(who);
    body.replaceChildren(...nodes(
      h('div', { class: 'field' }, h('label', { for: 'bl-inv-who' }, 'Whose gear'), select),
      h('div', { class: 'actions bl-inv-actions' },
        h('button', { type: 'button', class: 'btn primary', id: 'bl-inv-print', onclick: () => printElement(inventoryDoc(who), PRINT_CSS) }, '🖨 Print'),
        h('button', { type: 'button', class: 'btn ghost', id: 'bl-inv-csv', onclick: () => saveCsv(who) }, '⤓ CSV'),
        h('button', { type: 'button', class: 'btn ghost', id: 'bl-inv-html', onclick: async () => {
          const title = `Backline inventory${scope ? ' ' + scope : ''} ${todayISO()}`;
          if (await saveFile(docPage(title, inventoryDoc(who), PAGE_CSS), fileName(title, 'html'), 'text/html')) toast('Inventory saved');
        } }, '⤓ Web page')),
      h('p', { class: 'muted small' }, 'For your insurer, and for customs or a carnet when you tour abroad. Print it, or save a copy to email.'),
      h('div', { class: 'cs-paper bl-inv-paper', role: 'region', 'aria-label': 'Inventory preview', tabindex: '0' }, inventoryDoc(who))));
  };
  sheet('Backline inventory', body);
  draw();
}

// A stage pack's packing list: a tick box per piece, for loading the van and again at load-out.
function printPack(k) {
  const items = sortGear(packItems(k)), today = todayISO();
  const doc = h('div', { class: 'cs-doc bl-inv' },
    h('div', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-kicker' }, 'PACKING LIST'), h('div', { class: 'cs-brand' }, brand())),
      h('div', { class: 'cs-when' }, h('b', null, fmtLong(today)))),
    h('h2', null, k.name || 'Stage pack'),
    h('div', { class: 'cs-sub' }, `${plural(packPieces(k), 'piece')} · ${fmtMoney(packValue(k))}`),
    items.length
      ? h('table', null,
        h('thead', null, h('tr', null, cell('th', '✓'), cell('th', 'Item'), cell('th', 'Make / model'), cell('th', 'Serial'), cell('th', 'Qty', 'num'), cell('th', 'Owner'))),
        h('tbody', null, [...groupBy(items, catOf)].map(([cat, list]) => [
          h('tr', { class: 'bl-cat' }, h('td', { colSpan: 6 }, cat)),
          list.map(g => h('tr', null, cell('td', '☐', 'bl-tick'), cell('td', itemName(g)), cell('td', makeModel(g)), cell('td', g.serial), cell('td', packCount(k, g), 'num'), cell('td', ownerName(g) || 'Band'))),
        ])))
      : h('p', null, 'Nothing in this pack yet.'),
    k.notes && h('div', { class: 'cs-sec' }, h('h4', null, 'Notes'), h('div', { class: 'cs-pre' }, k.notes)),
    h('div', { class: 'cs-foot' }, 'Tick each piece as it goes in the van, and again at load-out.'));
  printElement(doc, PRINT_CSS);
}

/* ------------------------------- walkthroughs ------------------------------- */
const ITEM_STEPS = [
  { title: 'Your backline', text: 'Every guitar, amp, mic, DI and cable the band owns, with make, model, serial, value and whose it is. + Add logs an item.', target: ['.bl-head'] },
  { title: 'Items and stage packs', text: 'Items is everything you own. Stage packs are named sets of it for the gigs you play most, like a club show or a festival fly-in.', target: ['.bl-seg'] },
  { title: 'What it is worth', text: 'How many pieces, their total replacement value, and how many are on a show, session or rehearsal coming up.', target: ['.bl-stats'] },
  { title: 'Inventory', text: 'Print or save the list with serials and values: for your insurer, and for customs or a carnet when you tour abroad. CSV opens in a spreadsheet.', target: ['.bl-docs'] },
  { title: 'Whose is it?', text: 'Show one person’s gear, or what the band owns together.', target: ['.bl-owners'] },
  { title: 'Find something', text: 'Search by name, make, model, serial number or where it is.', target: ['#bl-search'] },
  { title: 'An item', text: 'Tap one for its details and the bookings it is on, with a warning when the same piece is needed in two places on one day.', target: ['.bl-card'] },
];
const PACK_STEPS = [
  { title: 'Stage packs', text: 'A saved set of backline for a kind of gig. + New pack makes one from your items, with how many of each.', target: ['.bl-head'] },
  { title: 'A pack', text: 'What is in it by category, how many pieces and what they are worth. 🖨 prints a packing list to tick off at load-in and load-out, ⧉ copies it, ✎ edits it.', target: ['.bl-pack'] },
  { title: 'Back to the items', text: 'Items lists every piece on its own.', target: ['.bl-seg'] },
];
const ITEM_SHEET_STEPS = [
  { title: 'The details', text: 'Make, model, serial, value and whose it is. Tap the owner to open their card.', target: ['.bl-kv'] },
  { title: 'Edit or move it', text: 'Edit changes anything, or deletes the item. Move says where it is right now: the van, the rehearsal room, the repair shop.', target: ['.bl-sheet-actions'] },
  { title: 'Where it is booked', text: 'The shows, sessions and rehearsals it is on. Tap one to open it. A warning shows when the same piece is needed in two places on one day, or a booking needs more than you own.', target: ['.bl-bookings'] },
];
const FORM_STEPS = [
  { title: 'What it is', text: 'A short name you would call it on stage, and its category for the lists.', target: ['[data-key=name]'] },
  { title: 'For the insurer', text: 'Make, model, serial and replacement value go on the inventory you print for insurance or a carnet.', target: ['[data-key=serial]'] },
  { title: 'How many', text: 'Own several of the same thing (mics, DIs, stands)? Enter how many, and the value of one.', target: ['[data-key=qty]'] },
];
const PACK_FORM_STEPS = [
  { title: 'Name the pack', text: 'After the kind of gig it is for.', target: ['[data-key=name]'] },
  { title: 'What goes', text: 'Tick each piece. Where you own several, − and + set how many go.', target: ['.checks', '.field.wide'] },
];
const INVENTORY_STEPS = [
  { title: 'Whose gear', text: 'Everything, what the band owns together, or one person’s gear (for their own insurance).', target: ['#bl-inv-who'] },
  { title: 'Print or save', text: 'Print it, save a spreadsheet (CSV), or save a web page to email.', target: ['.bl-inv-actions'] },
  { title: 'The list', text: 'Numbered by category with make, model, serial, quantity, value and owner, and the total at the bottom.', target: ['.bl-inv-paper'] },
];
sheetTutorial('Add item', FORM_STEPS);
sheetTutorial('Edit item', FORM_STEPS);
sheetTutorial('New stage pack', PACK_FORM_STEPS);
sheetTutorial('Edit stage pack', PACK_FORM_STEPS);
sheetTutorial('Backline inventory', INVENTORY_STEPS);

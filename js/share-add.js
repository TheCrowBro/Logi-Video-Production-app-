// Shared things arriving in Vdex: a booking, a contact card or an equipment list that someone packed into a link.
// The link comes in through "Add to my Vdex" on a shared page (index.html#add=…, which js/app.js parks for this tab),
// or pasted or scanned under "Add from a link" on the Bookings, Crew and Equipment pages. It waits until Vdex is
// really open (unlocked, the terms agreed, the PIN set, no walkthrough running), then a sheet lists exactly what
// would be added. Nothing is added without the tap on Add, and nothing in a link is trusted: js/share-data.js cleans
// it first, and everything is drawn as text. Adding respects read-only mode and needs no licence. Loaded on first use.
import { h, sheet, toast, fmtLong, money } from './util.js';
import * as store from './store.js';
import * as lock from './lock.js';
import { tourSeen, tourActive } from './tour.js';
import { readShared, fromLine, GEAR_MAX } from './share-data.js';

const PARKED = 'vdex-add'; // where js/app.js keeps a link that arrived in the address, for this tab only
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const names = (list, max = 4) => { const n = list.filter(Boolean); return n.slice(0, max).join(', ') + (n.length > max ? ` and ${n.length - max} more` : ''); };
const rows = list => h('ul', { class: 'add-list' }, list.filter(r => r && r[1]).map(([k, v]) => h('li', null, h('b', null, k), h('span', null, v))));
const initials = name => name.split(/\s+/).map(w => [...w][0] || '').slice(0, 2).join('').toUpperCase();
// One link is looked at at a time. A sheet about a link (its preview, or why it cannot be read) takes the place of the
// one before it, so links that arrive one after another never pile up; and of several that wait for Vdex to be ready,
// only the newest is shown (js/app.js keeps only that one parked, too).
let shown = null, newest = 0;
// These sheets may open by themselves, with no button behind them: the dialog takes the focus, so a keyboard or a
// screen reader starts inside it (and hears its title) rather than on the page underneath.
const dialog = (title, body) => {
  if (shown) shown.close();
  const sh = sheet(title, body, { onClose: () => { if (shown === sh) shown = null; } });
  shown = sh; sh.el.tabIndex = -1; sh.el.focus({ preventScroll: true }); return sh;
};
const newer = snap => snap.newer && h('p', { class: 'note small' }, 'This link was made with a newer version of Vdex, so some of what it holds may be left out. Updating Vdex first is the safe way.');

// Vdex is ready for a question once nothing stands in front of it: the lock, the terms, the PIN set-up, a walkthrough.
// With cloud storage linked, the cloud copy is read first. A device reads it only when it starts and when it comes
// back to the front, so one that has been open for a while may not hold what another of one's devices added from this
// very link, and would offer to add it a second time where it should offer to update it. The read gets a few seconds
// (one already on its way will do, as when Vdex has only just started: which storage is linked is known a moment
// after the start); without an answer by then the sheet comes as this device knows things, and the tap on Add looks
// again (each of the three previews below).
const READ_FOR = 4000;
async function ready() {
  const clear = async () => { while (lock.isLocked() || store.isSealed() || !tourSeen() || tourActive() || document.querySelector('.terms-gate, .lock')) await sleep(400); };
  await clear();
  await store.licenceKnown(); // whether changes are allowed is known before Add is offered
  const slow = setTimeout(() => { if (store.cloud.adapter && !store.cloud.paused) toast('Checking your cloud storage first…'); }, 800);
  await Promise.race([store.cloudKnown.then(() => (store.cloud.adapter && !store.cloud.paused ? store.sync({ quiet: true, join: true }) : null)).catch(() => {}), sleep(READ_FOR)]);
  clearTimeout(slow);
  await clear(); // Vdex may have been locked, or a walkthrough begun, while the storage was being read
}
// A preview says what the tap would do as things stood when it was drawn. If the cloud copy comes in while it is open
// (the read above was still on its way, or Vdex came back to the front) and brings what the link would add, the tap
// must not add it a second time: the preview is then drawn again, with this line, and waits for another tap.
const again = what => h('p', { class: 'note small add-again' }, `Your ${what} changed while this was open, so this has been worked out again. Check it, then tap again.`);
// The read above gets nothing when the storage wants a new sign-in first (Google Drive does an hour after the last
// one) or cannot be reached, and then no later read puts the preview right before the tap. A preview that would add
// says so, since the same thing added on another device would then be here twice after the next sync.
const unread = () => { const c = store.cloud, signIn = c.status === 'needs-permission'; return !!c.adapter && !c.paused && (signIn || c.status === 'error') && h('p', { class: 'note small add-unread', role: 'note' }, `Vdex could not sync with your cloud storage just now${signIn ? `: it needs ${c.adapter.id === 'file' ? 'your permission to use the file again' : 'you to sign in again'} (the menu ☰ at the top, then Storage, sync & backups)` : ''}, so this device may not have what your other devices have added. If one of them has added this already, adding it here makes a second copy.`); };

// A link that came in with the address. Shown once Vdex is ready; a link that cannot be read says why.
export async function arrived(link) {
  const mine = ++newest;
  let snap = null, problem = null;
  try { snap = await readShared(link); } catch (e) { problem = e; }
  await ready();
  if (mine !== newest) return; // another link came in while this one waited: that one is shown
  try { sessionStorage.removeItem(PARKED); } catch { /* nothing parked */ }
  if (problem) return void dialog('Nothing was added', h('div', { class: 'stack' }, h('p', null, problem.message), h('p', { class: 'small muted' }, 'Nothing in the link was added to Vdex.')));
  return preview(snap);
}
function preview(snap) { return snap.kind === 'crew' ? previewBooking(snap) : snap.kind === 'contact' ? previewContact(snap) : previewGear(snap); }

// The foot of every preview, which stays in view while a long list scrolls above it: what would happen in a line
// (sum, where there is one), a place for the sentence when it cannot be done (refuse), then the buttons and Cancel.
// buttons: [[label, run, class]]. A button is off while its run lasts and stays off when its `off` says so. While Vdex
// is read-only, a button explains (the usual sheet) and nothing closes.
function foot(buttons, close, sum = null) {
  const said = h('p', { class: 'warn small add-refused', role: 'alert', hidden: true });
  const refuse = text => { said.textContent = text; said.hidden = false; said.scrollIntoView({ block: 'nearest' }); };
  const btns = buttons.map(([label, run, cls = 'ghost']) => {
    const b = h('button', { class: 'btn ' + cls, type: 'button', onclick: async () => { if (!store.canChange()) return; said.hidden = true; b.disabled = true; try { await run(); } catch (e) { toast('Could not add it: ' + (e.message || e)); } b.disabled = !!b.off; } }, label);
    return b;
  });
  return { el: h('div', { class: 'add-foot' }, sum, said, h('div', { class: 'actions add-actions' }, ...btns, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'))), refuse, btns };
}
// Once Add has added it, what follows only shows the thing where it now lives (and, for equipment, offers Undo). Each
// of those steps may need a part of Vdex that is fetched on first use, and with no connection and no offline copy yet
// that fetch fails. The thing is in all the same, so such a failure never reaches the button's "Could not add it":
// it is passed over, and `missing` (when given) says what is missing instead.
const afterAdd = async (step, missing = '') => { try { return await step(); } catch (e) { console.warn('share-add:', e); if (missing) toast(missing); return null; } };
// What does not fit the browser's storage is turned down before anything is changed (roomFor in js/gear-import.js).
const noRoom = (what, done, ask) => `This ${what} is bigger than the space Vdex has on this device, so nothing was ${done}. Free some space first (erase old logs and bookings), or ask for ${ask}.`;

/* ----------------------------------- a booking ----------------------------------- */
async function previewBooking(snap, redrawn = false) {
  const [m, { billTo }] = await Promise.all([import('./share-import.js'), import('./money.js')]), p = m.planBooking(snap), L = snap.location, C = snap.call, was = p.existing;
  const found = x => [x.own && x.own.id, x.existing && x.existing.id].join(); // which booking of one's own the link is about
  if (p.own) {
    const sh = dialog('This booking is yours', h('div', { class: 'stack' }, h('p', null, `“${p.own.title}” is already in your Bookings: this link was made from it, so there is nothing to add.`),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => { sh.close(); await window.logiGo('bookings'); (await import('./pages/bookings.js')).openBooking(p.own.id); } }, 'Open it'))));
    return;
  }
  const when = (snap.endDate ? `${fmtLong(snap.date)} → ${fmtLong(snap.endDate)}` : fmtLong(snap.date)) + (snap.start ? `, ${snap.start}${snap.end ? '–' + snap.end : ''}` : '');
  const strips = snap.scenes.flatMap(d => d.items), scenes = strips.filter(x => x.banner == null).length, banners = strips.filter(x => x.banner).length;
  // Who a quote or an invoice made on this booking would go to (billTo in js/money.js): the person who shared it.
  const sender = p.booking.shared.producer, head = billTo(p.booking).head, toSender = !!sender && head === (sender.business || sender.name);
  const had = was && was.shared.by, other = had && had !== p.from; // the booking was added from someone, and this link is not from them
  // A quote or an invoice already made on the booking is not kept apart from it: who it is headed and emailed to is
  // worked out from the booking each time (billTo). When this update changes that (another sender, a sender where there
  // was none, a new address), the sheet says so before the tap, since the document may have gone out under the old name.
  const docs = was ? ['quote', 'invoice'].filter(k => was[k]) : [], toOf = b => { const t = billTo(b); return [t.head, ...t.contacts.map(s => (s.email || '').trim()).filter(Boolean)]; };
  const toWas = docs.length ? toOf(was) : null, toNow = docs.length ? toOf(p.booking) : null, moved = !!toWas && toWas.join('\n') !== toNow.join('\n');
  const whom = t => `${t[0] === '—' ? 'nobody' : t[0]}${t.length > 1 ? ` (${t.slice(1).join(', ')})` : ''}`;
  const f = foot([[was ? 'Update the booking' : 'Add to my Bookings', async () => {
    if (found(m.planBooking(snap)) !== found(p)) return previewBooking(snap, true);
    if (!m.roomForBooking(snap)) return f.refuse(noRoom('booking', was ? 'changed' : 'added', 'a link with fewer parts ticked'));
    const done = m.applyBooking(snap); if (!done) return;
    sh.close(); toast(was ? 'Booking updated' : 'Added to your Bookings');
    await afterAdd(async () => { await window.logiGo('bookings'); (await import('./pages/bookings.js')).openBooking(done.booking.id); });
  }, 'primary']], () => sh.close());
  const sh = dialog(was ? 'Update this booking?' : 'Add this booking?', h('div', { class: 'stack add-preview' },
    h('div', null, h('h3', { class: 'add-title' }, snap.title || 'Shared shoot'), h('div', { class: 'muted small' }, p.from ? `Shared by ${p.from}` : 'From a shared link', snap.made ? ` · sent ${new Date(snap.made).toLocaleDateString()}` : '')),
    redrawn && again('Bookings'), !was && unread(),
    was && h('p', { class: 'note small' }, `“${was.title}” is in your Bookings already${was.shared.at ? `, added ${new Date(was.shared.at).toLocaleDateString()}` : ''}. Adding it again updates it from this link.`),
    other && h('p', { class: 'warn small add-other', role: 'note' }, p.from ? `This link is from ${p.from}; the booking in your Bookings came from ${had}. Check that it is the same shoot before you update it.` : `This link does not say who it is from; the booking in your Bookings came from ${had}. Check that it is the same shoot before you update it.`),
    moved && h('p', { class: 'warn small add-readdress', role: 'note' }, `The ${docs.join(' and the ')} you made on this booking ${docs.length === 1 ? 'is' : 'are'} headed to ${whom(toWas)}. After this update ${docs.length === 1 ? 'it is' : 'they are'} headed to ${whom(toNow)}, even if ${docs.length === 1 ? 'it has' : 'they have'} been sent already.`),
    // What an update replaces and what it leaves, as build() in js/share-import.js does it.
    was && h('div', { class: 'stack add-rules small' },
      h('p', null, h('b', null, 'Replaced: '), was.shared.sent
        ? 'each of these while it is still as the link left it: title, client, dates, times, address, the call sheet’s times, dress code, weather note, emergency contact, who is on set and instructions, the break, and the details of the venue the link made. And the crew, contacts, schedule lines, scenes, banners, shots and deliverables that came from the link: their order and details are the link’s, and one the link no longer has is removed.'
        : 'this booking was added before Vdex kept track of what a link supplied, so this once every detail the link holds comes in (title, client, dates, times, address, the call sheet’s times and notes, the break, the venue the link made), with the crew, contacts, schedule lines, shots and deliverables that came from the link, and every scene and banner on its stripboard.'),
      h('p', null, h('b', null, 'Stays: '), `${was.shared.sent ? 'any of those details you changed yourself, and everything you added by hand: your own people, contacts, schedule lines, scenes, banners, shots and deliverables. Your' : 'your'} notes on scenes, the rate, days and notes you gave a person, shot ticks and delivery links. Your own notes, stage, checklists, crew, equipment, budget, quote, invoice and hours. A part this link does not carry is left as it is.`),
      p.kept.length > 0 && h('p', { class: 'add-kept' }, h('b', null, 'You changed: '), `${names(p.kept, 12)}. ${p.kept.length === 1 ? 'It stays as you have it' : 'They stay as you have them'}.`),
      p.ownStrips > 0 && h('p', { class: 'add-own-strips' }, h('b', null, 'Your strips: '), `${plural(p.ownStrips, 'strip')} of your own ${p.ownStrips === 1 ? 'stays' : 'stay'} on the stripboard.`)),
    rows([
      ['When', when], ['Type', snap.type], ['Client', snap.client], ['Place', [L.venue, L.address].filter(Boolean).join(', ')],
      p.venue && ['Venue', p.venue.isNew ? `“${p.venue.record.name}” goes into your Venues, with what the link says about access, parking, power, the nearest hospital and the rules` : `Your venue “${p.venue.record.name}” is used${p.venue.filled ? ', and its details are filled in from the link' : ''}`],
      ['Call sheet', [C.general && `general call ${C.general}`, C.lunch && `lunch ${C.lunch}`, C.wrap && `wrap ${C.wrap}`, snap.schedule.length && plural(snap.schedule.length, 'schedule line'), C.breaks && 'breaks', C.dress && 'dress code', C.weather && 'weather note', C.emergency && 'emergency contact', snap.onSet && 'who is on set', snap.notes && 'instructions'].filter(Boolean).join(', ')],
      ['Crew', snap.crew.length && `${plural(snap.crew.length, 'person').replace('persons', 'people')} (${names(snap.crew.map(c => c.name || c.role))}), kept on this booking with their call times, not added to your Crew list`],
      ['Contacts', p.people.length && `${plural(p.people.length, 'contact')} on the booking (${names(p.people.map(s => s.name))})`],
      ['Scenes', scenes + banners > 0 && `${[scenes && plural(scenes, 'scene'), banners && plural(banners, 'banner')].filter(Boolean).join(' and ')} on its stripboard, over ${plural(snap.scenes.filter(d => d.items.length).length, 'shooting day')}${snap.cut ? `. The link holds more than one shoot may bring: ${plural(snap.cut, 'more strip')} ${snap.cut === 1 ? 'is' : 'are'} left out` : ''}`],
      ['Shot list', snap.shots.length && plural(snap.shots.length, 'shot')], ['Deliverables', snap.deliverables.length && names(snap.deliverables.map(x => x.name))],
      ['In the notes', snap.kit.length && `the equipment on the shoot (${plural(snap.kit.length, 'item')}), to read: it is not yours, so it is not ticked on the booking`],
    ]),
    h('p', { class: 'small muted add-bill' }, 'A shared booking never carries prices. ', toSender ? `A quote or an invoice you make on it goes to ${head}, who shared it with you, not to their client or the client’s contacts. ` : head === '—' ? 'The link does not say who shared it, so a quote or an invoice you make on it is headed to nobody until you add a contact or change the client. ' : '', 'Everything can be edited afterwards.'),
    newer(snap), f.el));
}

/* ---------------------------------- a contact card ---------------------------------- */
const MATCHED = { email: 'email address', phone: 'phone number', name: 'name' };
async function previewContact(c, redrawn = false) {
  const m = await import('./share-import.js'), p = m.planContact(c), name = p.person.name, found = p.match;
  const about = x => [x.own, x.match && x.match.person.id, x.match && x.match.sure].join(); // whom on the Crew list the card is about
  if (p.own) {
    const sh = dialog('This is your own card', h('div', { class: 'stack' }, h('p', null, 'This card was made from your own details, so there is nobody to add to your Crew list.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => sh.close() }, 'Close'))));
    return;
  }
  // was: someone who is surely the card's person, so the card updates them. maybe: someone who shares a detail with
  // the card and may be somebody else, so both are shown and adding a new person is the first choice.
  const was = found && found.sure ? found.person : null, maybe = found && !found.sure ? found.person : null;
  const add = as => async () => {
    if (about(m.planContact(c)) !== about(p)) return previewContact(c, true);
    const done = m.applyContact(c, as); if (!done) return;
    sh.close(); toast(done.existing ? 'Contact updated' : 'Added to your Crew');
    await afterAdd(async () => (await import('./pages/crew.js')).showPerson(done.person.id));
  };
  const f = foot(was ? [['Update the contact', add('update'), 'primary']] : maybe ? [['Add as a new person', add('new'), 'primary'], [`Update ${maybe.name}`, add('update')]] : [['Add to my Crew', add('new'), 'primary']], () => sh.close());
  const sh = dialog(was ? 'Update this contact?' : 'Add this contact?', h('div', { class: 'stack add-preview' },
    h('div', { class: 'card-row add-who' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(name)), h('div', { class: 'grow' }, h('h3', { class: 'add-title' }, name), h('div', { class: 'muted small' }, [c.title, c.name && c.business].filter(Boolean).join(' · ')))),
    redrawn && again('Crew list'), !was && unread(),
    was && h('p', { class: 'note small' }, `${was.name} is on your Crew list already${found.card ? ', from this card' : ', with this name and email address'}. Adding the card${found.card ? ' again' : ''} updates the details below; the rate and notes you keep for them stay as they are.`),
    rows([['Role', c.title], ['Phone', c.phone], ['Email', c.email], ['Their work', c.website], ['In the notes', [c.name && c.business && `Business: ${c.business}`, c.location && `Based in: ${c.location}`].filter(Boolean).join(' · ')]]),
    maybe && h('section', { class: 'add-group add-maybe', 'aria-label': 'Someone on your Crew list' },
      h('h4', null, `On your Crew list, with the same ${MATCHED[found.by]}`),
      h('div', { class: 'card-row add-who' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(maybe.name || '?')), h('div', { class: 'grow' }, h('strong', null, maybe.name), h('div', { class: 'muted small' }, [maybe.role, maybe.phone, maybe.email].filter(Boolean).join(' · ')))),
      h('p', { class: 'note small' }, `Two people can share ${found.by === 'name' ? 'a name' : found.by === 'phone' ? 'a phone number' : 'an email address'}. If this card is for someone else, add it as a new person. If it is ${maybe.name}, Update puts the card’s name and details on their record and keeps the rate and notes you have for them.`)),
    !was && !maybe && h('p', { class: 'small muted' }, 'It goes into your Crew list. A rate and your own notes can be added afterwards.'),
    newer(c), f.el));
}

/* -------------------------------- an equipment list -------------------------------- */
async function previewGear(g, redrawn = false) {
  const m = await import('./gear-import.js'), plan = m.planGearImport(g.items), from = fromLine(g.by), cur = g.currency || '';
  const dup = plan.rows.filter(r => r.match), fresh = plan.rows.filter(r => !r.match), mine = r => r.match.id === r.item.ref, allMine = dup.length > 0 && dup.every(mine);
  // Which items and kits of one's own the list is about: the rows' matches, and the kits it would rewrite.
  const found = pl => JSON.stringify([pl.rows.map(r => (r.match ? r.match.id : '')), g.kits.map(k => (m.kitOf(store.db.kits, k.ref) || {}).id || '')]), seen = found(plan);
  const sum = h('p', { class: 'add-sum', role: 'status' }), selects = [];
  // A kit that is here already is rewritten only when one of the rows it names is added or updated (applyGearImport).
  const KIT = { make: 'is made as a kit', update: 'is updated', same: 'stays as it is: every item of it is skipped' };
  const kitDoes = k => (!m.kitOf(store.db.kits, k.ref) ? 'make' : k.items.some(([row]) => { const r = plan.rows[row]; return r && !(r.match && r.action === 'skip'); }) ? 'update' : 'same');
  const kitLines = g.kits.map(k => h('span'));
  const f = foot([['', async () => {
    if (found(m.planGearImport(g.items)) !== seen) return previewGear(g, true);
    if (!m.roomForGear(plan, { kits: g.kits, from })) return f.refuse(noRoom('list', 'added', 'the list in parts'));
    const done = m.applyGearImport(plan, { kits: g.kits, from }); if (!done) return;
    sh.close();
    await afterAdd(async () => (await import('./pages/gear.js')).showItems([...done.added, ...done.updated]));
    // The same Undo as after a file import: a bar for a short while, then under Import… until Vdex is closed. Without
    // the file that draws it, the equipment is in and said to be; only Undo is missing, and that is said too.
    const kits = (done.kitsAdded || []).length + (done.kitsBefore || []).length;
    const said = [done.added.length && `${done.added.length.toLocaleString()} added`, done.updated.length && `${done.updated.length.toLocaleString()} updated`].filter(Boolean).join(', ') || (kits ? 'Your kits are changed' : '');
    const ui = await afterAdd(() => import('./gear-import-ui.js'), said ? `${said}. Undo could not be loaded, so there is none for this import.` : 'Nothing changed');
    if (!ui) return;
    const undo = ui.offerUndo(done, from ? `a link shared by ${from}` : 'a shared link');
    if (undo) undo.focus({ preventScroll: true }); else toast('Nothing changed');
  }, 'primary add-go']], () => sh.close(), sum), go = f.btns[0];
  // The line above the buttons and the button itself say what the tap would do; with nothing to do, there is no tap.
  const paint = () => {
    const c = m.planCounts(plan), kits = g.kits.map(kitDoes), made = kits.filter(k => k === 'make').length;
    g.kits.forEach((k, i) => { kitLines[i].textContent = `“${k.name}” (${plural(k.items.length, 'item')}) ${KIT[kits[i]]}`; });
    sum.textContent = [c.add && `${c.add.toLocaleString()} to add`, c.update && `${c.update.toLocaleString()} to update`, c.skip && `${c.skip.toLocaleString()} left as ${c.skip === 1 ? 'it is' : 'they are'}`].filter(Boolean).join(' · ') || 'Nothing to add.';
    go.textContent = c.add && c.update ? `Add ${c.add.toLocaleString()} and update ${c.update.toLocaleString()}` : c.update ? `Update ${plural(c.update, 'item')}` : c.add ? `Add ${plural(c.add, 'item')} to my Equipment` : made ? (made === 1 ? 'Make the kit' : `Make ${made} kits`) : 'Nothing to add';
    go.off = go.disabled = !(c.add + c.update + made);
  };
  const WHY = { ref: r => (mine(r) ? 'This is your own item: the list was made from it' : `Added from this list before${r.match.name !== r.item.name ? `, as “${r.match.name}”` : ''}`), serial: r => `Same serial number as your “${r.match.name}”`, name: r => `Same name as your “${r.match.name}”` };
  const line = r => { const x = r.item; return [h('div', null, h('strong', null, x.name), x.qty > 1 && ` × ${x.qty}`), h('div', { class: 'muted small' }, [x.category, x.serial && 'S/N ' + x.serial, x.value !== '' && money(x.value, cur) + (x.qty > 1 ? ' each' : ''), x.location && '📍 ' + x.location].filter(Boolean).join(' · '))]; };
  const pick = r => { const sel = h('select', { 'aria-label': `What to do with ${r.item.name}`, onchange: e => { r.action = e.target.value; paint(); } }, m.ACTIONS.map(([v, label]) => h('option', { value: v, selected: v === r.action }, label))); selects.push(sel); return sel; };
  const all = dup.length > 1 && h('label', { class: 'add-all small' }, 'All of these: ', h('select', { 'aria-label': 'What to do with every item you already have', onchange: e => { if (!e.target.value) return; dup.forEach(r => { r.action = e.target.value; }); selects.forEach(s => { s.value = e.target.value; }); paint(); } }, h('option', { value: '' }, 'Choose…'), m.ACTIONS.map(([v, label]) => h('option', { value: v }, label))));
  const sh = dialog('Add this equipment?', h('div', { class: 'stack add-preview' },
    h('div', null, h('h3', { class: 'add-title' }, g.title || 'Equipment list'), h('div', { class: 'muted small' }, from ? `Shared by ${from}` : 'From a shared link', g.made ? ` · sent ${new Date(g.made).toLocaleDateString()}` : '')),
    redrawn && again('Equipment'), fresh.length > 0 && unread(),
    h('p', { class: 'small muted' }, 'A copy of each item goes into your Equipment, with its serial number, value, notes and the rest of its details. Values come as the numbers they are, in whatever currency the sender uses.'),
    g.cut > 0 && h('p', { class: 'note small add-cut' }, `This list is longer than one link carries: only its first ${GEAR_MAX.toLocaleString()} items are here, and ${plural(g.cut, 'more item')} ${g.cut === 1 ? 'is' : 'are'} not. Ask for the rest in a second link.`),
    dup.length > 0 && h('section', { class: 'add-group', 'aria-label': 'Items you already have' }, h('h4', null, `Already in your Equipment (${dup.length.toLocaleString()})`),
      allMine && h('p', { class: 'note small add-mine' }, `${dup.length === 1 ? 'This is your own item: the list was made from it. It is' : 'These are your own items: the list was made from them. They are'} left as ${dup.length === 1 ? 'it is' : 'they are'} unless you choose otherwise.`), all,
      h('ul', { class: 'add-list add-items' }, dup.map(r => h('li', { class: 'add-dup' }, ...line(r), !allMine && h('div', { class: 'small add-why' }, WHY[r.why](r)), pick(r))))),
    fresh.length > 0 && h('section', { class: 'add-group', 'aria-label': 'New items' }, h('h4', null, `New (${fresh.length.toLocaleString()})`), h('ul', { class: 'add-list add-items' }, fresh.map(r => h('li', null, ...line(r))))),
    g.kits.length > 0 && h('section', { class: 'add-group add-kits' }, h('h4', null, g.kits.length === 1 ? 'Kit' : 'Kits'), h('ul', { class: 'add-list' }, kitLines.map(el => h('li', null, el)))),
    newer(g), f.el));
  paint();
}

/* --------------------------------- add from a link --------------------------------- */
// For a link that cannot open this copy of Vdex by itself (the desktop app, the iPhone app, another browser): paste
// it, or scan its QR code with the camera. The same preview follows.
export function openAddFromLink() {
  let scan = null, sh = null;
  const stop = () => { if (scan) { scan.stop(); scan = null; } };
  const area = h('textarea', { class: 'share-link', rows: 4, 'aria-label': 'The shared Vdex link', placeholder: 'https://vdex.crowmade.app/…', spellcheck: false, autocapitalize: 'off' });
  const msg = h('p', { class: 'warn small', role: 'alert', hidden: true });
  const camBox = h('div', { class: 'stack' });
  // scanned: what is in the box came from the camera, so a code that is not a Vdex link is spoken of as a code.
  const go = async ({ scanned = false } = {}) => {
    msg.hidden = true;
    if (!area.value.trim()) { msg.textContent = 'Paste the link first, or scan its QR code.'; msg.hidden = false; area.focus(); return; }
    let snap; try { snap = await readShared(area.value, { scanned }); } catch (e) { msg.textContent = e.message; msg.hidden = false; area.focus(); return; }
    sh.close(); await ready(); preview(snap);
  };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) { area.value = t.trim(); go(); } else toast('The clipboard is empty'); } catch { toast('Vdex may not read the clipboard here: paste into the box instead'); area.focus(); } };
  const scanNow = async () => {
    stop(); msg.hidden = true;
    const { scanner } = await import('./qr.js');
    scan = scanner(code => { area.value = code; camBox.replaceChildren(); scan = null; go({ scanned: true }); }, { hint: 'Point the camera at the QR code on their screen', instead: 'Paste the link instead.' });
    camBox.replaceChildren(scan.el, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { stop(); camBox.replaceChildren(); } }, 'Stop the camera'));
    camBox.scrollIntoView({ block: 'nearest' });
  };
  sh = sheet('Add from a link', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'Did someone share a booking, their contact card or an equipment list with you from Vdex? Paste the link here, or scan its QR code. You see what it holds before anything is added.'),
    area, msg,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => go() }, 'Show what it holds'),
      navigator.clipboard && navigator.clipboard.readText && h('button', { class: 'btn ghost', type: 'button', onclick: paste }, '📋 Paste'),
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia && h('button', { class: 'btn ghost', type: 'button', onclick: () => scanNow().catch(() => toast('The camera could not be opened here')) }, '📷 Scan a QR code')),
    camBox,
    h('p', { class: 'small muted' }, 'Nothing is sent anywhere: the booking, card or list is inside the link itself.')), { onClose: stop });
  setTimeout(() => area.focus(), 60);
}

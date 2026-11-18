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
import { readShared, fromLine } from './share-data.js';

const PARKED = 'vdex-add'; // where js/app.js keeps a link that arrived in the address, for this tab only
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (list, max = 4) => { const n = list.filter(Boolean); return n.slice(0, max).join(', ') + (n.length > max ? ` and ${n.length - max} more` : ''); };
const rows = list => h('ul', { class: 'add-list' }, list.filter(r => r && r[1]).map(([k, v]) => h('li', null, h('b', null, k), h('span', null, v))));
// These sheets may open by themselves, with no button behind them: the dialog takes the focus, so a keyboard or a
// screen reader starts inside it (and hears its title) rather than on the page underneath.
const dialog = (title, body) => { const sh = sheet(title, body); sh.el.tabIndex = -1; sh.el.focus({ preventScroll: true }); return sh; };
const newer = snap => snap.newer && h('p', { class: 'note small' }, 'This link was made with a newer version of Vdex, so some of what it holds may be left out. Updating Vdex first is the safe way.');

// Vdex is ready for a question once nothing stands in front of it: the lock, the terms, the PIN set-up, a walkthrough.
async function ready() {
  while (lock.isLocked() || store.isSealed() || !tourSeen() || tourActive() || document.querySelector('.terms-gate, .lock')) await sleep(400);
  await import('./licence.js').then(m => m.initLicence()).catch(() => {}); // whether changes are allowed is known before Add is offered
}

// A link that came in with the address. Shown once Vdex is ready; a link that cannot be read says why.
export async function arrived(link) {
  let snap = null, problem = null;
  try { snap = await readShared(link); } catch (e) { problem = e; }
  await ready();
  try { sessionStorage.removeItem(PARKED); } catch { /* nothing parked */ }
  if (problem) return void dialog('Nothing was added', h('div', { class: 'stack' }, h('p', null, problem.message), h('p', { class: 'small muted' }, 'Nothing in the link was added to Vdex.')));
  return preview(snap);
}
function preview(snap) { return snap.kind === 'crew' ? previewBooking(snap) : snap.kind === 'contact' ? previewContact(snap) : previewGear(snap); }

// The bottom of every preview: Add and Cancel. While Vdex is read-only, Add explains (the usual sheet) and nothing closes.
function confirmRow(label, add, close) {
  const go = h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (!store.canChange()) return; go.disabled = true; try { await add(); } catch (e) { toast('Could not add it: ' + (e.message || e)); } go.disabled = false; } }, label);
  return h('div', { class: 'actions add-actions' }, go, h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel'));
}

/* ----------------------------------- a booking ----------------------------------- */
async function previewBooking(snap) {
  const m = await import('./share-import.js'), p = m.planBooking(snap), L = snap.location, C = snap.call, was = p.existing;
  if (p.own) {
    const sh = dialog('This booking is yours', h('div', { class: 'stack' }, h('p', null, `“${p.own.title}” is already in your Bookings: this link was made from it, so there is nothing to add.`),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => { sh.close(); await window.logiGo('bookings'); (await import('./pages/bookings.js')).openBooking(p.own.id); } }, 'Open it'))));
    return;
  }
  const when = (snap.endDate ? `${fmtLong(snap.date)} → ${fmtLong(snap.endDate)}` : fmtLong(snap.date)) + (snap.start ? `, ${snap.start}${snap.end ? '–' + snap.end : ''}` : '');
  const scenes = snap.scenes.reduce((n, d) => n + d.items.filter(x => x.banner == null).length, 0), contacts = p.booking.shared.contacts.length;
  const sh = dialog(was ? 'Update this booking?' : 'Add this booking?', h('div', { class: 'stack add-preview' },
    h('div', null, h('h3', { class: 'add-title' }, snap.title || 'Shared shoot'), h('div', { class: 'muted small' }, p.from ? `Shared by ${p.from}` : 'From a shared link', snap.made ? ` · sent ${new Date(snap.made).toLocaleDateString()}` : '')),
    was && h('p', { class: 'note small' }, `“${was.title}” is in your Bookings already${was.shared.at ? `, added ${new Date(was.shared.at).toLocaleDateString()}` : ''}. Adding it again updates it with what this link holds. Your own stage and checklists, crew, equipment, budget, quote, invoice, hours and anything you added by hand stay as they are.`),
    rows([
      ['When', when], ['Type', snap.type], ['Client', snap.client], ['Place', [L.venue, L.address].filter(Boolean).join(', ')],
      p.venue && ['Venue', p.venue.isNew ? `“${p.venue.record.name}” goes into your Venues, with what the link says about access, parking, power, the nearest hospital and the rules` : `Your venue “${p.venue.record.name}” is used${p.venue.changed ? ', and its details are filled in from the link' : ''}`],
      ['Call sheet', [C.general && `general call ${C.general}`, C.lunch && `lunch ${C.lunch}`, C.wrap && `wrap ${C.wrap}`, snap.schedule.length && plural(snap.schedule.length, 'schedule line'), C.breaks && 'breaks', C.dress && 'dress code', C.weather && 'weather note', C.emergency && 'emergency contact', snap.onSet && 'who is on set', snap.notes && 'instructions'].filter(Boolean).join(', ')],
      ['Crew', snap.crew.length && `${plural(snap.crew.length, 'person').replace('persons', 'people')} (${names(snap.crew.map(c => c.name || c.role))}), kept on this booking with their call times, not added to your Crew list`],
      ['Contacts', contacts && `${plural(contacts, 'contact')} on the booking (${names(p.booking.stakeholders.slice(0, contacts).map(s => s.name))})`],
      ['Scenes', scenes && `${plural(scenes, 'scene')} on its stripboard, over ${plural(snap.scenes.length, 'shooting day')}`],
      ['Shot list', snap.shots.length && plural(snap.shots.length, 'shot')], ['Deliverables', snap.deliverables.length && names(snap.deliverables.map(x => x.name))],
      ['In the notes', snap.kit.length && `the equipment on the shoot (${plural(snap.kit.length, 'item')}), to read: it is not yours, so it is not ticked on the booking`],
    ]),
    h('p', { class: 'small muted' }, 'A shared booking never carries prices. Everything can be edited afterwards.'),
    newer(snap),
    confirmRow(was ? 'Update the booking' : 'Add to my Bookings', async () => {
      const done = m.applyBooking(snap); if (!done) return;
      sh.close(); toast(was ? 'Booking updated' : 'Added to your Bookings');
      await window.logiGo('bookings'); (await import('./pages/bookings.js')).openBooking(done.booking.id);
    }, () => sh.close())));
}

/* ---------------------------------- a contact card ---------------------------------- */
async function previewContact(c) {
  const m = await import('./share-import.js'), p = m.planContact(c), was = p.existing, name = p.person.name;
  const sh = dialog(was ? 'Update this contact?' : 'Add this contact?', h('div', { class: 'stack add-preview' },
    h('div', { class: 'card-row add-who' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, name.split(/\s+/).map(w => [...w][0] || '').slice(0, 2).join('').toUpperCase()), h('div', { class: 'grow' }, h('h3', { class: 'add-title' }, name), h('div', { class: 'muted small' }, [c.title, c.name && c.business].filter(Boolean).join(' · ')))),
    was && h('p', { class: 'note small' }, `${was.name} is on your Crew list already. Adding the card again updates the details below; the rate and notes you keep for them stay as they are.`),
    rows([['Role', c.title], ['Phone', c.phone], ['Email', c.email], ['Their work', c.website], ['In the notes', [c.name && c.business && `Business: ${c.business}`, c.location && `Based in: ${c.location}`].filter(Boolean).join(' · ')]]),
    !was && h('p', { class: 'small muted' }, 'It goes into your Crew list. A rate and your own notes can be added afterwards.'),
    newer(c),
    confirmRow(was ? 'Update the contact' : 'Add to my Crew', async () => {
      const done = m.applyContact(c); if (!done) return;
      sh.close(); toast(was ? 'Contact updated' : 'Added to your Crew');
      (await import('./pages/crew.js')).showPerson(done.person.id);
    }, () => sh.close())));
}

/* -------------------------------- an equipment list -------------------------------- */
async function previewGear(g) {
  const m = await import('./gear-import.js'), plan = m.planGearImport(g.items), from = fromLine(g.by), cur = g.currency || '';
  const dup = plan.rows.filter(r => r.match), fresh = plan.rows.filter(r => !r.match);
  const sum = h('p', { class: 'add-sum', role: 'status' }), selects = [];
  const paint = () => { const c = m.planCounts(plan); sum.textContent = [c.add && `${c.add} to add`, c.update && `${c.update} to update`, c.skip && `${c.skip} left as ${c.skip === 1 ? 'it is' : 'they are'}`].filter(Boolean).join(' · ') || 'Nothing to add.'; };
  const WHY = { ref: r => (r.match.id === r.item.ref ? 'This is your own item: the list was made from it' : `Added from this list before${r.match.name !== r.item.name ? `, as “${r.match.name}”` : ''}`), serial: r => `Same serial number as your “${r.match.name}”`, name: r => `Same name as your “${r.match.name}”` };
  const line = r => { const x = r.item; return [h('div', null, h('strong', null, x.name), x.qty > 1 && ` × ${x.qty}`), h('div', { class: 'muted small' }, [x.category, x.serial && 'S/N ' + x.serial, x.value !== '' && money(x.value, cur) + (x.qty > 1 ? ' each' : ''), x.location && '📍 ' + x.location].filter(Boolean).join(' · '))]; };
  const pick = r => { const sel = h('select', { 'aria-label': `What to do with ${r.item.name}`, onchange: e => { r.action = e.target.value; paint(); } }, m.ACTIONS.map(([v, label]) => h('option', { value: v, selected: v === r.action }, label))); selects.push(sel); return sel; };
  const all = dup.length > 1 && h('label', { class: 'add-all small' }, 'All of these: ', h('select', { 'aria-label': 'What to do with every item you already have', onchange: e => { if (!e.target.value) return; dup.forEach(r => { r.action = e.target.value; }); selects.forEach(s => { s.value = e.target.value; }); paint(); } }, h('option', { value: '' }, 'Choose…'), m.ACTIONS.map(([v, label]) => h('option', { value: v }, label))));
  const kitNote = k => { const made = k.ref && store.db.kits.find(x => x.id === k.ref || (x.shared && x.shared.ref === k.ref)); return `“${k.name}” (${plural(k.items.length, 'item')}) is ${made ? 'updated' : 'made as a kit'}`; };
  const sh = dialog('Add this equipment?', h('div', { class: 'stack add-preview' },
    h('div', null, h('h3', { class: 'add-title' }, g.title || 'Equipment list'), h('div', { class: 'muted small' }, from ? `Shared by ${from}` : 'From a shared link', g.made ? ` · sent ${new Date(g.made).toLocaleDateString()}` : '')),
    h('p', { class: 'small muted' }, 'A copy of each item goes into your Equipment, with its serial number, value, notes and the rest of its details. Values come as the numbers they are, in whatever currency the sender uses.'),
    dup.length > 0 && h('section', { class: 'add-group', 'aria-label': 'Items you already have' }, h('h4', null, `Already in your Equipment (${dup.length})`), all,
      h('ul', { class: 'add-list add-items' }, dup.map(r => h('li', { class: 'add-dup' }, ...line(r), h('div', { class: 'small add-why' }, WHY[r.why](r)), pick(r))))),
    fresh.length > 0 && h('section', { class: 'add-group', 'aria-label': 'New items' }, h('h4', null, `New (${fresh.length})`), h('ul', { class: 'add-list add-items' }, fresh.map(r => h('li', null, ...line(r))))),
    g.kits.length > 0 && h('section', { class: 'add-group' }, h('h4', null, g.kits.length === 1 ? 'Kit' : 'Kits'), h('ul', { class: 'add-list' }, g.kits.map(k => h('li', null, h('span', null, kitNote(k)))))),
    newer(g), sum,
    confirmRow('Add to my Equipment', async () => {
      const done = m.applyGearImport(plan, { kits: g.kits, from }); if (!done) return;
      sh.close(); toast([done.added.length && `${done.added.length} added`, done.updated.length && `${done.updated.length} updated`, done.skipped && `${done.skipped} left as ${done.skipped === 1 ? 'it was' : 'they were'}`].filter(Boolean).join(', ') || 'Nothing changed');
      (await import('./pages/gear.js')).showItems([...done.added, ...done.updated]);
    }, () => sh.close())));
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
  const go = async () => {
    msg.hidden = true;
    if (!area.value.trim()) { msg.textContent = 'Paste the link first, or scan its QR code.'; msg.hidden = false; area.focus(); return; }
    let snap; try { snap = await readShared(area.value); } catch (e) { msg.textContent = e.message; msg.hidden = false; area.focus(); return; }
    sh.close(); await ready(); preview(snap);
  };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); if (t) { area.value = t.trim(); go(); } else toast('The clipboard is empty'); } catch { toast('Vdex may not read the clipboard here: paste into the box instead'); area.focus(); } };
  const scanNow = async () => {
    stop(); msg.hidden = true;
    const { scanner } = await import('./qr.js');
    scan = scanner(code => { area.value = code; camBox.replaceChildren(); scan = null; go(); }, { hint: 'Point the camera at the QR code on their screen' });
    camBox.replaceChildren(scan.el, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { stop(); camBox.replaceChildren(); } }, 'Stop the camera'));
    camBox.scrollIntoView({ block: 'nearest' });
  };
  sh = sheet('Add from a link', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'Did someone share a booking, their contact card or an equipment list with you from Vdex? Paste the link here, or scan its QR code. You see what it holds before anything is added.'),
    area, msg,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: go }, 'Show what it holds'),
      navigator.clipboard && navigator.clipboard.readText && h('button', { class: 'btn ghost', type: 'button', onclick: paste }, '📋 Paste'),
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia && h('button', { class: 'btn ghost', type: 'button', onclick: () => scanNow().catch(() => toast('The camera could not be opened here')) }, '📷 Scan a QR code')),
    camBox,
    h('p', { class: 'small muted' }, 'Nothing is sent anywhere: the booking, card or list is inside the link itself.')), { onClose: stop });
  setTimeout(() => area.focus(), 60);
}

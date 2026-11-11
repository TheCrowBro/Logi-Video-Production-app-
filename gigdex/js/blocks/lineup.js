// Line-up & gear on a booking: who is playing or working (from People), each with a quick call and text, and what
// gear goes (from Backline and its stage packs, with quantities). Someone or something also needed by another live
// booking on the same days is flagged ("Leo is also on Harbour Hall that day"; three SM58s here and two there, four
// owned).
import { h, toast, fmtShort, telUrl, sheet, todayISO } from '../util.js';
import { db, byId, update, patch, personClash, gearClash, gearShort, qtyOf, usedQty, lastDay } from '../store.js';
import * as model from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { editPerson, openPerson } from '../pages/people.js';
import { editGear, editKit } from '../pages/backline.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const groupLabel = g => (model.PEOPLE_GROUPS.find(x => x[0] === g) || [, ''])[1];
const groupIndex = g => { const i = model.PEOPLE_GROUPS.findIndex(x => x[0] === g); return i < 0 ? 99 : i; };
const catIndex = c => { const i = model.GEAR_CATS.indexOf(c); return i < 0 ? 98 : i; };
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'They';
const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));

const peopleOf = b => (b.people || []).map(id => byId('people', id)).filter(Boolean);
const gearOf = b => (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
const units = b => gearOf(b).reduce((s, g) => s + usedQty(b, g.id), 0);

// The other live bookings that need this person or item at the same time. A cancelled booking needs nobody and
// nothing, so it has no clashes (it is out of clashes, as its status says).
const peopleClash = (b, id) => (model.isLive(b) ? personClash(b, id) : []);
const itemClash = (b, id) => (model.isLive(b) ? gearClash(b, id) : []);

// Where and when another booking is, in a few words: "Harbour Hall that day", "Greenfield Festival on Sat 12 Dec".
const placeOf = o => model.venueOf(o).name || model.bookingTitle(o);
const whenOf = (o, b) => (o.date === b.date && lastDay(o) === lastDay(b) ? 'that day' : `on ${fmtShort(o.date)}`);
const others = (list, b) => list.map(o => `${placeOf(o)} ${whenOf(o, b)}`).join(' and ');
export const personClashText = (b, p) => { const o = peopleClash(b, p.id); return o.length ? `${firstName(p.name)} is also on ${others(o, b)}` : ''; };
// This booking alone needs more than are owned ('How many' lowered after it was planned): flagged like a clash.
const itemShort = (b, id) => model.isLive(b) && model.lastDate(b) >= todayISO() && gearShort(b, id); // only bookings still to come, as Backline flags them
export function gearClashText(b, g) {
  const o = itemClash(b, g.id);
  if (itemShort(b, g.id)) return `${usedQty(b, g.id)} needed, ${qtyOf(g)} owned` + (o.length ? `: also on ${others(o, b)}` : '');
  if (!o.length) return '';
  const need = usedQty(b, g.id) + o.reduce((s, x) => s + usedQty(x, g.id), 0), owned = qtyOf(g);
  return owned > 1 || need > 2 ? `${need} needed, ${owned} owned: also on ${others(o, b)}` : `Also on ${others(o, b)}`;
}

function setPeople(b, ids) { patch('bookings', b.id, { people: [...new Set(ids)].filter(id => byId('people', id)) }); }

function pickPeople(b) {
  const people = [...db.people].sort((x, y) => groupIndex(x.group) - groupIndex(y.group) || byName(x, y));
  openForm({
    title: 'Who is on this booking', saveLabel: 'Done',
    values: { people: (b.people || []).filter(id => byId('people', id)) },
    fields: [{
      key: 'people', label: 'People', type: 'checks', empty: 'No people yet. Add band members, session players and crew on the People page.',
      options: people.map(p => ({ value: p.id, label: p.name || 'Unnamed', group: groupLabel(p.group) || 'Other', hint: [p.role || p.instrument, peopleClash(b, p.id).length && 'booked elsewhere then'].filter(Boolean).join(' · ') })),
    }],
    onSave: v => { setPeople(b, v.people || []); toast(`${plural((v.people || []).length, 'person', 'people')} on this booking`); },
  });
}

function addMembers(b, act) {
  const add = (act.members || []).filter(id => byId('people', id) && !(b.people || []).includes(id));
  if (!add.length) return;
  setPeople(b, [...(b.people || []), ...add]);
  toast(`${plural(add.length, 'member')} of ${act.name || 'the act'} added`);
}

function pickGear(b) {
  const gear = [...db.gear].sort((x, y) => catIndex(x.category) - catIndex(y.category) || String(x.category || '').localeCompare(String(y.category || '')) || byName(x, y));
  const kits = [...db.kits].sort(byName);
  openForm({
    title: 'Backline for this booking', saveLabel: 'Done',
    values: { kits: (b.kits || []).filter(id => byId('kits', id)), gear: (b.gear || []).filter(id => byId('gear', id)), gearQty: { ...(b.gearQty || {}) } },
    fields: [
      kits.length > 0 && { key: 'kits', label: 'Stage packs', type: 'checks', hint: 'Ticking a pack ticks its gear below. You can still change the list.',
        options: kits.map(k => ({ value: k.id, label: k.name || 'Unnamed pack', hint: plural((k.items || []).length, 'item'), adds: { gear: (k.items || []).filter(id => byId('gear', id)) }, addsQty: k.qty || {} })) },
      { key: 'gear', qtyKey: 'gearQty', label: 'Gear', type: 'checks', empty: 'No gear yet. Add instruments, amps and mics on the Backline page.',
        options: gear.map(g => ({ value: g.id, label: g.name || 'Unnamed', group: g.category || 'Other', qtyMax: qtyOf(g), hint: qtyOf(g) > 1 ? `(${qtyOf(g)} owned)` : '' })) },
    ].filter(Boolean),
    onSave: v => {
      const ids = (v.gear || []).filter(id => byId('gear', id));
      const qty = Object.fromEntries(Object.entries(v.gearQty || {}).filter(([id, n]) => ids.includes(id) && Number(n) > 1).map(([id, n]) => [id, Math.min(qtyOf(byId('gear', id)), Math.floor(Number(n)))]));
      patch('bookings', b.id, { gear: ids, gearQty: qty, kits: (v.kits || []).filter(id => byId('kits', id)) });
      toast(`${plural(ids.length, 'item')} on this booking`);
    },
  });
}

// Add a stage pack: its gear joins the list (with its quantities, never fewer than already set).
function addKit(b, k) {
  if (!k) return;
  update(d => {
    const x = d.bookings.find(r => r.id === b.id); if (!x) return;
    const items = (k.items || []).filter(id => d.gear.some(g => g.id === id));
    x.gear = [...new Set([...(x.gear || []), ...items])];
    x.gearQty = { ...(x.gearQty || {}) };
    for (const id of items) {
      const g = d.gear.find(r => r.id === id), want = Math.max(usedQty(x, id), Math.floor(Number((k.qty || {})[id])) || 1);
      const n = Math.min(qtyOf(g), want);
      if (n > 1) x.gearQty[id] = n; else delete x.gearQty[id];
    }
    x.kits = [...new Set([...(x.kits || []), k.id])];
    x.updatedAt = Date.now();
  });
  toast(`${k.name || 'Stage pack'} added`);
}
function kitSheet(b) {
  let close = () => {};
  const kits = [...db.kits].sort(byName);
  const body = h('div', { class: 'stack' },
    kits.length
      ? h('div', { class: 'list' }, kits.map(k => h('button', { type: 'button', class: 'card tap', onclick: () => { close(); addKit(byId('bookings', b.id) || b, k); } },
        h('strong', null, k.name || 'Unnamed pack'),
        h('div', { class: 'muted small' }, (k.items || []).map(id => byId('gear', id)).filter(Boolean).map(g => g.name + ((k.qty || {})[g.id] > 1 ? ` ×${k.qty[g.id]}` : '')).join(', ') || 'Empty'))))
      : h('p', { class: 'muted' }, 'No stage packs yet. A pack is a set of gear you take together (a club show pack, a studio pack).'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => { close(); editKit({}, k => k && addKit(byId('bookings', b.id) || b, k)); } }, '+ New stage pack'));
  ({ close } = sheet('Add a stage pack', body));
}

function emailAll(b, people) {
  const to = people.map(p => String(p.email || '').trim()).filter(Boolean);
  if (!to.length) return null;
  const v = model.venueOf(b);
  const run = model.timesFor(b.kind).map(([k, l]) => b[k] && `${l} ${b[k]}`).filter(Boolean).join(', ');
  const facts = [`${model.bookingTitle(b)}${b.date ? ', ' + fmtShort(b.date) : ''}`, run, [v.name, String(v.address || '').replace(/\s*\n\s*/g, ', ')].filter(Boolean).join(', ')].filter(Boolean);
  const body = ['Hi all,', '', ...facts, '', ''].join('\r\n');
  const href = 'mailto:' + to.map(e => encodeURIComponent(e).replace(/%40/g, '@')).join(',') + '?subject=' + encodeURIComponent(`${model.bookingTitle(b)}${b.date ? ' – ' + fmtShort(b.date) : ''}`) + '&body=' + encodeURIComponent(body);
  return h('a', { class: 'btn ghost small', href }, '✉ Email everyone');
}

function personRow(b, p) {
  const clash = personClashText(b, p);
  const digits = p.phone ? telUrl(p.phone).slice(4) : '';
  const hello = `Hi ${firstName(p.name)}, about ${model.bookingTitle(b)}${b.date ? ' on ' + fmtShort(b.date) : ''}: `;
  return h('div', { class: 'bk-person' + (clash ? ' clash' : ''), 'data-person': p.id },
    h('span', { class: 'avatar bk-av', 'aria-hidden': 'true' }, initials(p.name)),
    h('div', { class: 'bk-row-main' },
      h('button', { type: 'button', class: 'bk-link', onclick: () => openPerson(p.id), 'aria-label': `${p.name || 'Unnamed'}: open their card` }, p.name || 'Unnamed'),
      h('div', { class: 'muted small' }, [p.role || p.instrument, groupLabel(p.group)].filter(Boolean).join(' · ')),
      clash && h('div', { class: 'bk-clash small' }, '⚠ ' + clash)),
    digits && h('a', { class: 'icon-btn bk-quick', href: 'tel:' + digits, 'aria-label': `Call ${p.name}` }, '📞'),
    digits && h('a', { class: 'icon-btn bk-quick', href: 'sms:' + digits + '?&body=' + encodeURIComponent(hello), 'aria-label': `Text ${p.name}` }, '💬'),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take ${p.name || 'them'} off this booking`, onclick: () => setPeople(b, (b.people || []).filter(id => id !== p.id)) }, '✕'));
}

function gearRow(b, g) {
  const clash = gearClashText(b, g), n = usedQty(b, g.id), owner = g.owner && byId('people', g.owner);
  return h('div', { class: 'bk-gear-row' + (clash ? ' clash' : ''), 'data-gear': g.id },
    h('div', { class: 'bk-row-main' },
      h('span', { class: 'bk-gear-name' }, g.name || 'Unnamed', n > 1 && h('b', { class: 'qty' }, ` ×${n}`)),
      h('div', { class: 'muted small' }, [[g.make, g.model].filter(Boolean).join(' '), owner && `${firstName(owner.name)}’s`].filter(Boolean).join(' · ')),
      clash && h('div', { class: 'bk-clash small' }, '⚠ ' + clash)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take ${g.name || 'this item'} off this booking`, onclick: () => update(d => {
      const x = d.bookings.find(r => r.id === b.id); if (!x) return;
      x.gear = (x.gear || []).filter(id => id !== g.id); if (x.gearQty) { x.gearQty = { ...x.gearQty }; delete x.gearQty[g.id]; }
      x.updatedAt = Date.now();
    }) }, '✕'));
}

export default {
  id: 'lineup', title: 'Line-up & gear', icon: '👥', order: 30,
  kinds: ['show', 'session', 'rehearsal', 'other'],
  summary(b) {
    const n = peopleOf(b).length, u = units(b);
    const clashes = peopleOf(b).filter(p => peopleClash(b, p.id).length).length + gearOf(b).filter(g => itemClash(b, g.id).length || itemShort(b, g.id)).length;
    if (!n && !u) return '';
    return `${plural(n, 'person', 'people')} · ${plural(u, 'item')}` + (clashes ? ` · ⚠ ${plural(clashes, 'clash', 'clashes')}` : '');
  },
  render(b) {
    const people = peopleOf(b).sort((x, y) => groupIndex(x.group) - groupIndex(y.group));
    const gear = gearOf(b);
    const act = b.actId && byId('acts', b.actId);
    const missing = act ? (act.members || []).filter(id => byId('people', id) && !(b.people || []).includes(id)) : [];
    const pc = people.map(p => personClashText(b, p)).filter(Boolean), gc = gear.map(g => gearClashText(b, g) && `${g.name}: ${gearClashText(b, g)}`).filter(Boolean);
    const clashes = [...pc, ...gc];
    // A few clashes are listed; many are summed up (each row below names its own).
    const many = clashes.length > 3 && [h('strong', null, `⚠ ${plural(clashes.length, 'thing', 'things')} to sort out`),
      h('div', null, `${[pc.length && plural(pc.length, 'person', 'people'), gc.length && plural(gc.length, 'item')].filter(Boolean).join(' and ')} are also needed elsewhere at the same time. Each is marked below.`)];
    const cats = new Map();
    [...gear].sort((x, y) => catIndex(x.category) - catIndex(y.category) || byName(x, y)).forEach(g => { const c = g.category || 'Other'; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(g); });
    return h('div', { class: 'bk-lineup' },
      clashes.length > 0 && h('div', { class: 'warn bk-clashes', role: 'note' }, many || (clashes.length === 1 ? '⚠ ' + clashes[0] : [h('strong', null, `⚠ ${plural(clashes.length, 'thing', 'things')} to sort out`), h('ul', null, clashes.map(c => h('li', null, c)))])),
      h('section', { class: 'bk-people', 'aria-label': 'People' },
        h('h4', null, `People (${people.length})`),
        people.length ? h('div', { class: 'bk-rows' }, people.map(p => personRow(b, p))) : h('p', { class: 'muted small' }, act ? 'Nobody on this booking yet.' : 'Nobody on this booking yet. Pick band members, session players and crew from People.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => pickPeople(byId('bookings', b.id) || b) }, '☑ Pick people'),
          missing.length > 0 && h('button', { type: 'button', class: 'btn ghost small', onclick: () => addMembers(byId('bookings', b.id) || b, act) }, `+ Add the act’s members (${missing.length})`),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => editPerson({ group: 'band' }, p => { const cur = byId('bookings', b.id); if (p && p.id && cur) setPeople(cur, [...(cur.people || []), p.id]); }) }, '+ New person'),
          emailAll(b, people))),
      h('section', { class: 'bk-gear', 'aria-label': 'Gear' },
        h('h4', null, `Gear (${units(b)})`),
        gear.length ? [...cats].map(([c, list]) => h('div', { class: 'bk-gear-cat' }, h('div', { class: 'bk-cat muted small' }, c), h('div', { class: 'bk-rows' }, list.map(g => gearRow(b, g)))))
          : h('p', { class: 'muted small' }, 'No gear on this booking yet. Pick items, or add a whole stage pack.'),
        (b.kits || []).some(id => byId('kits', id)) && h('p', { class: 'muted small' }, 'Stage packs: ' + b.kits.map(id => byId('kits', id)).filter(Boolean).map(k => k.name).join(', ')),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => pickGear(byId('bookings', b.id) || b) }, '☑ Pick gear'),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => kitSheet(b) }, '🎛️ Add a stage pack'),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => editGear({}, g => { const cur = byId('bookings', b.id); if (g && g.id && cur) patch('bookings', b.id, { gear: [...new Set([...(cur.gear || []), g.id])] }); }) }, '+ New item'))));
  },
  tutorial: [
    { title: 'People', text: 'Who is playing or working. 📞 and 💬 call or text them. Anyone booked somewhere else on the same day is flagged.', target: ['#blk-lineup .bk-people'] },
    { title: 'Gear', text: 'What goes to the booking, with how many. Add a whole stage pack in one go. Gear needed in two places at once is flagged when you do not own enough.', target: ['#blk-lineup .bk-gear'] },
  ],
};

sheetTutorial('Who is on this booking', [{ title: 'People', text: 'Tick everyone on this booking. Anyone already booked elsewhere that day says so.', target: ['.checks'] }]);
sheetTutorial('Backline for this booking', [
  { title: 'Stage packs', text: 'Ticking a pack ticks all its gear.', target: ['.checks'] },
  { title: 'How many', text: 'For things you own more than one of, − and + set how many go.', target: ['.stepper', '.checks'] },
]);
sheetTutorial('Add a stage pack', [{ title: 'Stage packs', text: 'Tap a pack to add all its gear to the booking.', target: ['.sheet .list', '.sheet .btn'] }]);

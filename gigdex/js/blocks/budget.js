// The Costs box on every booking: what it costs you (travel, fuel, the van, a hotel, per diems, hire, crew, players),
// line by line, against what it brings in, so the expected profit is plain before the day. b.budget is an array of
// { id, cat, desc, amount }: model.settle() reads it too, so a show's settlement takes these costs off the night.
// Private: costs never go onto a quote, an invoice, a day sheet or a link.
import { h, sheet, toast, uid } from '../util.js';
import { byId, update } from '../store.js';
import { openForm } from '../form.js';
import { fmtMoney, bookingIncome, settle, venueOf, daysSpan, minutesBetween } from '../model.js';
import { plannedHours } from '../clock.js';
import { sheetTutorial } from '../tour.js';

export const BUDGET_CATS = ['Travel', 'Fuel', 'Van hire', 'Accommodation', 'Per diems', 'Backline hire', 'PA hire', 'Crew', 'Session players', 'Studio', 'Merch stock', 'Marketing', 'Other'];
const HINTS = { Travel: 'e.g. Train tickets, flights', Fuel: 'e.g. Diesel for the van', 'Van hire': 'e.g. Splitter van, two days', Accommodation: 'e.g. Hotel, 2 rooms', 'Per diems': 'e.g. 4 people × $25', 'Backline hire': 'e.g. Drum kit and bass amp', 'PA hire': 'e.g. PA and engineer', Crew: 'e.g. FOH engineer', 'Session players': 'e.g. Trumpet player', Studio: 'e.g. Room hire, engineer', 'Merch stock': 'e.g. 50 T-shirts', Marketing: 'e.g. Posters, social ads', Other: 'What it is' };
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const costLines = b => (Array.isArray(b && b.budget) ? b.budget : []).filter(x => x && typeof x === 'object');
export const costTotal = b => r2(costLines(b).reduce((t, c) => t + num(c.amount), 0));
const catIndex = c => { const i = BUDGET_CATS.indexOf(c); return i < 0 ? BUDGET_CATS.length : i; };

// Changes the booking's cost lines as they are now (the record is read again inside the update).
const changeCosts = (bookingId, fn) => update(d => { const x = d.bookings.find(r => r.id === bookingId); if (!x) return; x.budget = fn(costLines(x).map(c => ({ ...c }))); x.updatedAt = Date.now(); });

function editCost(bookingId, line) {
  const isNew = !line;
  openForm({
    title: isNew ? 'Add a cost' : 'Edit cost',
    values: line ? { cat: BUDGET_CATS.includes(line.cat) ? line.cat : 'Other', desc: line.desc || '', amount: line.amount ?? '' } : { cat: 'Travel', desc: '', amount: '' },
    fields: [
      { key: 'cat', label: 'Category', type: 'select', options: BUDGET_CATS },
      { key: 'desc', label: 'What it is', placeholder: line ? HINTS[line.cat] || '' : 'e.g. Van hire, hotel, per diems' },
      { key: 'amount', label: 'Cost', type: 'number', min: 0, step: '0.01', required: true, hint: 'What it costs you, not what you charge.' },
    ],
    saveLabel: isNew ? 'Add' : 'Save',
    onSave: v => {
      if (!byId('bookings', bookingId)) return toast('That booking has been deleted.');
      const next = { id: (line && line.id) || uid(), cat: BUDGET_CATS.includes(v.cat) ? v.cat : 'Other', desc: String(v.desc || '').trim(), amount: r2(num(v.amount)) };
      changeCosts(bookingId, list => (list.some(c => c.id === next.id) ? list.map(c => (c.id === next.id ? next : c)) : [...list, next]));
      toast(isNew ? `Cost added: ${fmtMoney(next.amount)}` : 'Cost saved');
    },
    onDelete: isNew ? null : () => { changeCosts(bookingId, list => list.filter(c => c.id !== line.id)); toast('Cost removed'); },
  });
}

// Costs the booking already knows about: the crew and hired players on it at their rates, and a room or studio with
// an hourly or daily rate. Lines already there (same words) are left out. A session or rehearsal's hours are its
// planned start to finish on every day it runs (a block of studio days), as the clock and the invoice count them.
function hoursOn(b) {
  if (b.kind === 'show') { const start = b.loadIn || b.soundcheck || b.doors || b.setTime, m = minutesBetween(start, b.curfew); return m ? m / 60 : 0; }
  return plannedHours(b);
}
export function suggestCosts(b) {
  const out = [], have = new Set(costLines(b).map(c => String(c.desc || '').trim().toLowerCase())), days = daysSpan(b), hours = Math.round(hoursOn(b) * 4) / 4;
  const add = (cat, desc, amount, note) => { if (amount > 0 && !have.has(desc.toLowerCase())) out.push({ cat, desc, amount: r2(amount), note }); };
  for (const id of Array.isArray(b.people) ? b.people : []) {
    const p = byId('people', id); if (!p || !(num(p.rate) > 0) || (p.group !== 'session' && p.group !== 'crew')) continue;
    const u = p.rateUnit || 'day', qty = u === 'hour' ? hours || 1 : u === 'day' ? days : u === 'song' ? Math.max(1, (b.songIds || []).length) : 1;
    const unitWord = u === 'hour' ? 'hour' : u === 'day' ? 'day' : u === 'song' ? 'song' : 'show';
    add(p.group === 'session' ? 'Session players' : 'Crew', `${p.name}${p.role ? ', ' + p.role : ''}`, num(p.rate) * qty, `${qty} ${unitWord}${qty === 1 ? '' : 's'} × ${fmtMoney(p.rate)}`);
  }
  const v = venueOf(b);
  if (v && v.id && num(v.rate) > 0 && (b.kind === 'rehearsal' || b.kind === 'session')) {
    const u = v.rateUnit || 'hour', qty = u === 'hour' ? hours || 1 : u === 'day' ? days : 1;
    add('Studio', `${b.kind === 'rehearsal' ? 'Room hire' : 'Studio hire'}: ${v.name}`, num(v.rate) * qty, u === 'hour' || u === 'day' ? `${qty} ${u}${qty === 1 ? '' : 's'} × ${fmtMoney(v.rate)}` : '');
  }
  return out;
}
function pickSuggestions(bookingId) {
  const b = byId('bookings', bookingId); if (!b) return;
  const list = suggestCosts(b), chosen = new Set(list.map((_, i) => i));
  let close = () => {};
  const add = h('button', { class: 'btn primary', type: 'button', id: 'mn-cost-pick-add' }, `Add ${list.length} cost${list.length === 1 ? '' : 's'}`);
  const count = () => { add.disabled = !chosen.size; add.textContent = chosen.size ? `Add ${chosen.size} cost${chosen.size === 1 ? '' : 's'}` : 'Add costs'; };
  add.addEventListener('click', () => {
    const lines = list.filter((_, i) => chosen.has(i)).map(s => ({ id: uid(), cat: s.cat, desc: s.desc, amount: s.amount }));
    close(); if (!lines.length) return;
    changeCosts(bookingId, cur => [...cur, ...lines]); toast(`${lines.length} cost${lines.length === 1 ? '' : 's'} added`);
  });
  ({ close } = sheet('Costs from the booking', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'The crew and players on this booking at their rates, and the room’s hire. Untick what you don’t pay for, and check the hours.'),
    h('div', { class: 'stack' }, ...list.map((s, i) => h('label', { class: 'check price-pick' },
      h('input', { type: 'checkbox', checked: true, onchange: e => { if (e.target.checked) chosen.add(i); else chosen.delete(i); count(); } }),
      h('span', { class: 'price-pick-text' }, h('span', null, `${s.desc}: ${fmtMoney(s.amount)}`), h('em', null, [s.cat, s.note].filter(Boolean).join(' · ')))))),
    h('div', { class: 'form-actions' }, add, h('span', { class: 'spacer' }), h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel')))));
}
sheetTutorial('Costs from the booking', [{ title: 'Costs you already know', text: 'Each person on the booking with a rate, and a room or studio with one. Untick anything you don’t pay, then add the rest.', target: ['.price-pick'] }]);

export default {
  id: 'budget', title: 'Costs', icon: '💸', order: 65,
  kinds: ['show', 'session', 'rehearsal', 'other'],
  summary(b) { const n = costLines(b).length; return n ? `${fmtMoney(costTotal(b))} costs` : ''; },
  render(b, ctx = {}) {
    b = byId('bookings', b.id) || b;
    const lines = costLines(b).slice().sort((x, y) => catIndex(x.cat) - catIndex(y.cat)), total = costTotal(b), income = bookingIncome(b), profit = r2(income - total);
    const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
    const ideas = suggestCosts(b);
    const s = b.kind === 'show' && b.settlement && (num(b.settlement.tickets) > 0 || b.settlement.received != null && b.settlement.received !== '') ? settle(b) : null;
    return h('div', { class: 'mn-costs stack' },
      h('div', { class: 'stats mn-cost-stats' }, stat(fmtMoney(total), 'costs'), stat(fmtMoney(income), b.status === 'cancelled' ? 'income (cancelled)' : 'income'), stat(fmtMoney(profit), 'expected profit', profit < 0 ? 'bad' : '')),
      s && h('p', { class: 'small muted' }, `With the settlement (merch ${fmtMoney(s.merch)}, the night’s costs ${fmtMoney(s.nightCosts)}), the show made ${fmtMoney(s.profit)}.`, ctx.open && ' ', ctx.open && h('button', { class: 'btn ghost small', type: 'button', onclick: () => ctx.open('settlement') }, 'Open the settlement')),
      lines.length
        ? h('div', { class: 'mn-cost-list' }, ...lines.map(c => h('button', { class: 'mn-cost', type: 'button', 'data-fk': 'cost-' + c.id, 'aria-label': `${c.cat}${c.desc ? ': ' + c.desc : ''}, ${fmtMoney(num(c.amount))}. Edit`, onclick: () => editCost(b.id, c) },
          h('span', { class: 'mn-cost-text' }, h('span', { class: 'mn-cost-cat' }, c.cat || 'Other'), c.desc && h('span', null, c.desc)), h('b', null, fmtMoney(num(c.amount))))))
        : h('p', { class: 'muted small' }, 'What this booking costs you: travel, fuel, the van, a hotel, per diems, hire, crew and players. Only you see it: costs never go on a quote, invoice or day sheet.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', type: 'button', id: 'mn-cost-add', onclick: () => editCost(b.id, null) }, '+ Add a cost'),
        ideas.length > 0 && h('button', { class: 'btn ghost small', type: 'button', id: 'mn-cost-suggest', 'aria-label': `Add costs from the booking (${ideas.length} to pick from)`, onclick: () => pickSuggestions(b.id) }, '+ From the booking')));
  },
  tutorial: [
    { title: 'Costs', text: 'What the booking costs you, against what it brings in: the expected profit before the day. On a show, the settlement takes these off the night too.', target: ['#blk-budget'] },
    { title: 'Add costs', text: 'Add travel, fuel, the van, a hotel, per diems or hire, or take the crew and players on the booking at their rates.', target: ['#mn-cost-add'] },
  ],
};

// Deal & fee: what the promoter is paying for a show. The kind of deal (a guarantee, a door split, a guarantee versus
// a %, a guarantee plus a % after break-even), the numbers, the deposit; then what it pays at a quarter, half, three
// quarters and a full house, where the % starts to count, and whether the deposit is in. Every sum is model.js's, so
// the deal reads the same here, on the settlement and on the money page.
import { h, toast, fmtShort, todayISO, daysUntil } from '../util.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { DEAL_TYPES, dealPays, dealSummary, dealBest, currency, markCheck, venueOf } from '../model.js';
import { num, numOrBlank, saveBooking, plural, refocus, money } from '../show-common.js';

const FORM_TITLE = 'Deal & fee';
const hasDeal = b => !!(b && b.deal && b.deal.type);
const typeLabel = t => (DEAL_TYPES.find(x => x[0] === t) || ['', ''])[1];
const hasPct = t => t === 'door' || t === 'versus' || t === 'plus';
const pctText = d => `${+num(d.pct).toFixed(2)}%`;
const CROWDS = [[0.25, 'A quarter full'], [0.5, 'Half full'], [0.75, 'Three quarters'], [1, 'Full house']];

// Where the % starts to count, as the first whole number of tickets. versus: the % beats the guarantee; plus: the door
// passes the promoter's break-even (their costs and the guarantee); door: the door passes the promoter's costs.
// { tickets, gross } or null when it can't be worked out (no % in the deal, no ticket price, a 0% versus).
export function breakEven(deal) {
  const d = deal || {}, price = num(d.ticketPrice), pct = num(d.pct) / 100, fee = num(d.fee), exp = num(d.expenses);
  if (!hasPct(d.type) || price <= 0) return null;
  const after = gross => Math.floor(gross / price + 1e-9) + 1; // the first ticket count whose door is more than gross
  if (d.type === 'versus') { if (pct <= 0) return null; const g = fee / pct + exp; return { tickets: after(g), gross: g }; }
  if (d.type === 'plus') return { tickets: after(fee + exp), gross: fee + exp };
  return { tickets: after(exp), gross: exp };
}

// The deal's form. Prefills the capacity from the venue the first time.
export function editDeal(b) {
  const d = (b && b.deal) || {}, v = venueOf(b);
  const values = {
    type: d.type || 'guarantee', fee: d.fee ?? '', pct: d.pct ?? '', ticketPrice: d.ticketPrice ?? '',
    capacity: d.capacity !== undefined && d.capacity !== '' ? d.capacity : (num(v.capacity) || ''),
    expenses: d.expenses ?? '', deposit: d.deposit ?? '', depositDue: d.depositDue || '', depositPaid: d.depositPaid ? ['paid'] : [], notes: d.notes || '',
  };
  openForm({
    title: FORM_TITLE, values, saveLabel: 'Save deal',
    fields: [
      { key: 'type', label: 'Kind of deal', type: 'select', options: DEAL_TYPES },
      { key: 'fee', label: 'Guarantee or fee', type: 'number', min: 0, step: 'any', placeholder: '0', hint: 'The flat fee, or the guarantee in a versus or plus deal.' },
      { key: 'pct', label: 'Your % of the door', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 70', hint: 'For a door split, a versus or a plus deal.' },
      { key: 'ticketPrice', label: 'Ticket price', type: 'number', min: 0, step: 'any', placeholder: '0' },
      { key: 'capacity', label: 'Capacity', type: 'number', min: 0, step: 1, placeholder: 'How many the room holds', hint: num(v.capacity) ? `${v.name || 'The venue'} holds ${num(v.capacity)}.` : '' },
      { key: 'expenses', label: 'Promoter costs off the top', type: 'number', min: 0, step: 'any', placeholder: '0', hint: 'What the promoter takes from the door before any split: sound, staff, the room. Ask for the figure in writing.' },
      { key: 'deposit', label: 'Deposit', type: 'number', min: 0, step: 'any', placeholder: '0' },
      { key: 'depositDue', label: 'Deposit due by', type: 'date' },
      { key: 'depositPaid', label: 'Paid yet?', type: 'checks', options: [{ value: 'paid', label: 'Deposit received' }] },
      { key: 'notes', label: 'Notes on the deal', type: 'textarea', rows: 3, placeholder: 'Buyout instead of a meal, merch split, radius clause, who settles on the night…' },
    ],
    onSave: f => {
      let pct = numOrBlank(f.pct);
      if (pct !== '' && pct > 100) { pct = 100; toast('A share over 100% was set to 100%'); }
      const pos = x => { const n = numOrBlank(x); return n === '' ? '' : Math.max(0, n); };
      const paid = (f.depositPaid || []).includes('paid');
      const deal = { type: f.type, fee: pos(f.fee), pct: pct === '' ? '' : Math.max(0, pct), ticketPrice: pos(f.ticketPrice), capacity: pos(f.capacity) === '' ? '' : Math.round(pos(f.capacity)),
        expenses: pos(f.expenses), deposit: pos(f.deposit), depositDue: f.depositDue || '', depositPaid: paid, notes: f.notes || '' };
      if (!saveBooking(b.id, x => { x.deal = { ...(x.deal || {}), ...deal }; })) return;
      if (paid !== !!d.depositPaid) markCheck(b.id, 'show-deposit', paid);
      toast('Deal saved');
    },
    onDelete: hasDeal(b) ? () => { if (saveBooking(b.id, x => { delete x.deal; })) toast('Deal removed'); } : null,
  });
}

// One tap: the deposit is in (or not, after all). Ticks the "Deposit received" line of the advance checklist too.
export function setDepositPaid(b, on) {
  if (!saveBooking(b.id, x => { x.deal = { ...(x.deal || {}), depositPaid: !!on }; })) return;
  markCheck(b.id, 'show-deposit', !!on);
  toast(on ? 'Deposit marked as received' : 'Deposit marked as not received');
}

// A sentence on where the % starts to count, or '' when the deal has no %.
function breakEvenText(d, sym) {
  const be = breakEven(d), cap = num(d.capacity), pct = pctText(d), m = n => money(n, sym);
  if (!hasPct(d.type)) return '';
  if (d.type === 'versus' && num(d.pct) <= 0) return `With 0% of the door, the ${m(num(d.fee))} guarantee is what it pays.`;
  if (!be) return 'Add the ticket price to see where the % starts to count.';
  const each = num(d.ticketPrice) * num(d.pct) / 100;
  const share = cap ? ` (${Math.round(be.tickets / cap * 100)}% full)` : '';
  const tooMany = cap && be.tickets > cap;
  if (d.type === 'versus') {
    return tooMany ? `Even a full house of ${cap} won’t beat the guarantee: the ${pct} needs ${be.tickets} tickets. Expect ${m(num(d.fee))}.`
      : `The ${pct} beats the ${m(num(d.fee))} guarantee from ${plural(be.tickets, 'ticket')} sold${share}. Below that, you get the guarantee.`;
  }
  if (d.type === 'plus') {
    return tooMany ? `The promoter breaks even at ${m(be.gross)} of tickets (${be.tickets} sold), more than the room holds, so expect the ${m(num(d.fee))}.`
      : `The promoter breaks even at ${m(be.gross)} of tickets: their costs and your guarantee. From ${plural(be.tickets, 'ticket')} sold${share}, you also get ${pct} of every ticket (${m(each)} each).`;
  }
  return num(d.expenses) > 0 ? `The first ${m(num(d.expenses))} of tickets covers the promoter’s costs (${plural(Math.ceil(num(d.expenses) / num(d.ticketPrice) - 1e-9), 'ticket')}). After that you get ${pct} of every ticket: ${m(each)} each.`
    : `You get ${pct} of every ticket: ${m(each)} each.`;
}

// "What it pays" at four crowds (and on the night, once the door is counted).
function paysTable(b, d, sym) {
  const cap = num(d.capacity), price = num(d.ticketPrice), m = n => money(n, sym);
  const counted = b.settlement && b.settlement.tickets !== '' && b.settlement.tickets != null ? num(b.settlement.tickets) : null;
  const which = gross => { if (d.type !== 'versus') return ''; const net = Math.max(0, gross - num(d.expenses)); return net * num(d.pct) / 100 > num(d.fee) ? pctText(d) : 'guarantee'; };
  const row = (label, tickets, cls = '') => {
    const gross = tickets * price, pays = dealPays(d, gross), w = which(gross);
    return h('tr', { class: cls }, h('th', { scope: 'row' }, label), h('td', { class: 'num' }, String(tickets)), h('td', { class: 'num' }, m(gross)),
      h('td', { class: 'num sh-pays-fee' }, m(pays), w && h('span', { class: 'sh-pays-which' }, w)));
  };
  return h('div', { class: 'sh-pays' },
    h('h4', null, 'What it pays'),
    h('div', { class: 'sh-table-wrap' }, h('table', { class: 'sh-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Crowd'), h('th', { scope: 'col', class: 'num' }, 'Tickets'), h('th', { scope: 'col', class: 'num' }, 'Door'), h('th', { scope: 'col', class: 'num' }, 'You get'))),
      h('tbody', null, CROWDS.map(([p, label]) => row(label, Math.round(cap * p), p === 1 ? 'sh-best' : '')), counted != null && row('On the night', counted, 'sh-night')))),
    h('p', { class: 'small muted sh-pays-note' }, `Door = tickets × ${m(price)}${num(d.expenses) ? `; the promoter’s ${m(num(d.expenses))} costs come off it before the split` : ''}.`));
}

function depositBox(b, d, sym) {
  const dep = num(d.deposit), paid = !!d.depositPaid, m = n => money(n, sym);
  if (dep <= 0) return h('div', { class: 'sh-deposit' }, h('p', { class: 'small muted' }, paid ? 'Marked as received, but no deposit amount is set.' : 'No deposit on this deal.'));
  const due = d.depositDue, left = due ? daysUntil(due) : null;
  const late = !paid && due && due < todayISO();
  const when = paid ? 'Received' : !due ? 'No due date set' : left === 0 ? 'Due today' : left < 0 ? 'Overdue' : `Due ${fmtShort(due)}${left <= 14 ? ` (in ${plural(left, 'day')})` : ''}`;
  return h('div', { class: 'sh-deposit' + (paid ? ' paid' : late ? ' late' : '') },
    h('div', { class: 'card-row' },
      h('div', null, h('strong', null, `Deposit ${m(dep)}`), h('div', { class: 'small ' + (late ? 'sh-bad' : 'muted') }, when)),
      h('button', { type: 'button', id: 'sh-deposit-toggle', class: 'btn small ' + (paid ? 'primary' : 'ghost'), 'aria-pressed': String(paid), onclick: () => setDepositPaid(b, !paid) }, paid ? '✓ Deposit received' : 'Deposit received')),
    late && h('p', { class: 'warn', role: 'note' }, `The deposit was due ${fmtShort(due)} (${plural(-left, 'day')} ago) and isn’t marked as received. Worth a message to ${(b.contact && b.contact.name) || 'the promoter'}.`));
}

export default {
  id: 'deal', title: 'Deal & fee', icon: '🤝', order: 10,
  kinds: ['show'],
  summary(b) { return hasDeal(b) ? dealSummary(b.deal, currency()) : 'No deal yet'; },
  render(b, ctx = {}) {
    const sym = ctx.sym || currency();
    if (!hasDeal(b)) {
      return h('div', { class: 'sh-block sh-deal' },
        h('div', { class: 'empty' }, h('p', null, 'No deal yet. Add what the promoter offered (a guarantee, a door split or both) and the ticket price: Gdex works out what the night pays at different crowds.'),
          h('button', { type: 'button', class: 'btn primary', id: 'sh-deal-add', onclick: () => editDeal(b) }, '+ Add the deal')));
    }
    const d = b.deal, m = n => money(n, sym);
    const cap = num(d.capacity), price = num(d.ticketPrice);
    const facts = [
      price > 0 && ['Tickets', m(price)], cap > 0 && ['Capacity', String(cap)], num(d.expenses) > 0 && hasPct(d.type) && ['Promoter costs', m(num(d.expenses))],
    ].filter(Boolean);
    const be = breakEvenText(d, sym);
    const past = b.date && b.date <= todayISO();
    const settled = b.status === 'settled' || (b.settlement && b.settlement.settledAt);
    return h('div', { class: 'sh-block sh-deal' },
      h('div', { class: 'sh-deal-head' },
        h('div', { class: 'sh-deal-line' }, dealSummary(d, sym)),
        h('div', { class: 'small muted' }, typeLabel(d.type)),
        d.type !== 'none' && hasPct(d.type) && price > 0 && cap > 0 && h('div', { class: 'small' }, `Up to ${m(dealBest(d))} with a full house.`)),
      facts.length > 0 && h('div', { class: 'sh-facts' }, facts.map(([k, v]) => h('div', { class: 'sh-fact' }, h('span', null, k), h('b', null, v)))),
      d.type === 'guarantee' && h('p', { class: 'small muted' }, `A flat fee: ${m(num(d.fee))} however many come.`),
      d.type === 'none' && h('p', { class: 'small muted' }, 'No fee for this one (a showcase, a charity night). Costs and merch still count on the settlement.'),
      hasPct(d.type) && (price > 0 && cap > 0 ? paysTable(b, d, sym)
        : h('p', { class: 'small muted' }, `Add the ${[!price && 'ticket price', !cap && 'capacity'].filter(Boolean).join(' and ')} to see what it pays at different crowds.`)),
      be && h('p', { class: 'sh-breakeven' }, be),
      depositBox(b, d, sym),
      d.notes && h('p', { class: 'prewrap small sh-deal-notes' }, d.notes),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-deal-edit', onclick: () => editDeal(b) }, '✎ Edit deal'),
        past && !settled && ctx.open && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-deal-settle', onclick: () => { ctx.open('settlement'); refocus('sh-st-tickets'); } }, '🧾 Settle the night')));
  },
  tutorial: [
    { title: 'Deal & fee', text: 'What the promoter is paying: a guarantee, a split of the door, or both. Tap Edit deal to change the numbers.', target: ['#blk-deal'] },
    { title: 'What it pays', text: 'What you would get with a quarter, half, three quarters and a full room, worked out from the ticket price, the promoter’s costs and your %.', target: ['#blk-deal .sh-pays'] },
    { title: 'Where the % counts', text: 'How many tickets it takes before the % beats the guarantee, or starts on top of it.', target: ['#blk-deal .sh-breakeven'] },
    { title: 'Deposit', text: 'Tap Deposit received when it lands. It ticks the line on the advance checklist and comes off what is owed on the night.', target: ['#blk-deal .sh-deposit'] },
  ],
};

sheetTutorial(FORM_TITLE, [
  { title: 'Kind of deal', text: 'Guarantee: a flat fee. Door split: a % of the door after the promoter’s costs. Versus: the guarantee or the %, whichever is more. Plus: the guarantee, and a % of what the door makes past break-even.', target: ['#f-0-type'] },
  { title: 'Guarantee and %', text: 'Fill in what applies to your deal; the rest can stay blank.', target: ['#f-1-fee', '#f-2-pct'] },
  { title: 'Tickets and room', text: 'The ticket price and how many the room holds give the “what it pays” table.', target: ['#f-3-ticketPrice', '#f-4-capacity'] },
  { title: 'Promoter costs', text: 'What comes off the door before a split. Get the number agreed before the night.', target: ['#f-5-expenses'] },
  { title: 'Deposit', text: 'How much, by when, and whether it has arrived. A late deposit shows a warning on the show.', target: ['#f-6-deposit'] },
]);

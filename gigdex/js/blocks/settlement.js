// Settlement: settle the night with the promoter. The ticket count and comps, what the deal pays at that door, the
// deposit already paid, what is owed and what was handed over; merch counted in and out; the night's costs and the
// show's budget; the band's profit and each person's payout, weighted if not everyone takes an equal share. Every
// figure comes from model.settle(b), so the money page and the settlement agree. Print, copy or save the sheet.
import { h, toast, fmtShort, todayISO, ymd } from '../util.js';
import { byId } from '../store.js';
import { sheetTutorial } from '../tour.js';
import { settle, currency, markCheck, dealSummary, bookingTitle } from '../model.js';
import { num, saveBooking, rowsSheet, copyText, plural, docHead, docFoot, printDoc, saveDoc, textDate, refocus, money } from '../show-common.js';

const MERCH_TITLE = 'Merch counts';
const COSTS_TITLE = 'Costs on the night';
const fresh = b => byId('bookings', b.id) || b;
const sOf = b => (b && b.settlement && typeof b.settlement === 'object' ? b.settlement : {});
const known = v => v !== '' && v != null;
const setS = (b, fields) => saveBooking(b.id, x => { x.settlement = { ...sOf(x), ...fields }; });
const peopleOn = b => (Array.isArray(b && b.people) ? b.people : []).map(id => byId('people', id)).filter(Boolean);
const merchOf = b => (Array.isArray(sOf(b).merch) ? sOf(b).merch.filter(Boolean) : []);
const costsOf = b => (Array.isArray(sOf(b).costs) ? sOf(b).costs.filter(Boolean) : []);
const budgetOf = b => (Array.isArray(b && b.budget) ? b.budget.filter(Boolean) : []);
const soldOf = m => num(m.start) - num(m.end) - num(m.comps);
const weightOf = (b, id) => { const w = (sOf(b).shares || {})[id]; return known(w) ? Math.max(0, num(w)) : 1; };
export const isSettled = b => !!(sOf(b).settledAt || (b && b.status === 'settled'));
// Has anything been filled in for the night yet?
export const hasFigures = b => { const s = sOf(b); return known(s.tickets) || known(s.received) || merchOf(b).length > 0 || costsOf(b).length > 0 || num(s.merchTotal) > 0; };

/* ------------------------------- changes ------------------------------- */
function markSettled(b) {
  const s = sOf(b), ask = [];
  if (!known(s.tickets)) ask.push('there’s no ticket count');
  if (!known(s.received)) ask.push('nothing is recorded as received');
  if (b.date && b.date > todayISO()) ask.push('the show hasn’t happened yet');
  if (ask.length && !confirm(`${ask.join(', ').replace(/^./, c => c.toUpperCase())}. Mark the show settled anyway?`)) return;
  if (!saveBooking(b.id, x => { x.status = 'settled'; x.settlement = { ...sOf(x), settledAt: Date.now() }; })) return;
  markCheck(b.id, 'show-settled', true);
  toast('Show settled');
  refocus('sh-st-reopen');
}
function reopen(b) {
  if (!confirm('Reopen the settlement? The show goes back to Done until you settle it again.')) return;
  if (!saveBooking(b.id, x => { x.status = 'done'; const s = { ...sOf(x) }; delete s.settledAt; x.settlement = s; })) return;
  markCheck(b.id, 'show-settled', false);
  toast('Settlement reopened');
  refocus('sh-st-settle');
}
function setShare(b, personId, v) {
  saveBooking(b.id, x => { const shares = { ...(sOf(x).shares || {}) }; if (v === '' || v == null) delete shares[personId]; else shares[personId] = Math.max(0, num(v)); x.settlement = { ...sOf(x), shares }; });
}
function editMerch(b) {
  rowsSheet({
    title: MERCH_TITLE, cls: 'sh-rows-merch', addLabel: '+ Add an item', saveLabel: 'Save counts',
    intro: 'Count each item before doors and again at the end of the night. Sold = start − end − given away.',
    columns: [
      { key: 'item', label: 'Item', wide: true, placeholder: 'T-shirt (M), vinyl, tote bag…' },
      { key: 'start', label: 'Start count', type: 'number', step: 1, inputMode: 'numeric' },
      { key: 'end', label: 'End count', type: 'number', step: 1, inputMode: 'numeric' },
      { key: 'comps', label: 'Given away', type: 'number', step: 1, inputMode: 'numeric' },
      { key: 'price', label: 'Price', type: 'number' },
    ],
    rows: merchOf(b), blank: () => ({ item: '', start: '', end: '', comps: '', price: '' }),
    emptyText: 'No items yet. Add one line per item (and size, if you count them apart).',
    derive: r => { if (!known(r.start) && !known(r.end)) return ''; const sold = soldOf(r); return sold < 0 ? 'The end count is more than the start: check the numbers.' : `Sold ${sold} · ${money(sold * num(r.price))}`; },
    onSave: rows => { if (setS(b, { merch: rows })) toast('Merch counts saved'); },
  });
}
function editCosts(b) {
  rowsSheet({
    title: COSTS_TITLE, cls: 'sh-rows-costs', addLabel: '+ Add a cost', saveLabel: 'Save costs',
    intro: 'What the night itself cost you: strings, a taxi, the merch seller, a parking fine. Travel, hotel and hire planned ahead go in the show’s budget.',
    columns: [{ key: 'desc', label: 'What', placeholder: 'Strings & sticks' }, { key: 'amount', label: 'Amount', type: 'number' }],
    rows: costsOf(b), blank: () => ({ desc: '', amount: '' }), emptyText: 'No costs on the night.',
    onSave: rows => { if (setS(b, { costs: rows })) toast('Costs saved'); },
  });
}

/* ------------------------------- the sheet to print or send ------------------------------- */
export function settlementDoc(b, sym = currency()) {
  const r = settle(b), s = sOf(b), d = b.deal || {}, m = n => money(n, sym);
  const kv = (k, v, cls) => h('div', { class: 'cs-kv' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, v));
  const merch = merchOf(b), costs = [...costsOf(b).map(c => [c.desc || 'Cost', c.amount, 'On the night']), ...budgetOf(b).map(c => [[c.cat, c.desc].filter(Boolean).join(': ') || 'Budget line', c.amount, 'Budget'])];
  return h('div', { class: 'cs-doc sh-settle-doc' }, ...docHead(b, 'SETTLEMENT'),
    h('div', { class: 'cs-sec' }, h('h4', null, 'The door'),
      kv('Deal', dealSummary(d, sym) || 'No deal'),
      kv('Tickets sold', `${r.tickets}${num(s.comps) ? ` (and ${num(s.comps)} comps)` : ''}`),
      kv('Ticket price', m(r.price)), kv('Gross door', m(r.gross)),
      num(d.expenses) > 0 && kv('Promoter costs', m(num(d.expenses))),
      kv('The deal pays', m(r.fee)),
      r.depositPaid && r.deposit > 0 && kv('Deposit paid before', '−' + m(r.deposit)),
      kv('Owed on the night', m(r.owedOnNight)),
      r.received != null && kv('Received', m(r.received)),
      r.short > 0.005 && kv('Still owed', m(r.short))),
    (merch.length > 0 || r.merch > 0) && h('div', { class: 'cs-sec' }, h('h4', null, 'Merch'),
      merch.length ? h('table', null, h('thead', null, h('tr', null, h('th', null, 'Item'), h('th', { class: 'num' }, 'Start'), h('th', { class: 'num' }, 'End'), h('th', { class: 'num' }, 'Given'), h('th', { class: 'num' }, 'Sold'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Total'))),
        h('tbody', null, merch.map(x => h('tr', null, h('td', null, x.item || 'Item'), h('td', { class: 'num' }, String(num(x.start))), h('td', { class: 'num' }, String(num(x.end))), h('td', { class: 'num' }, String(num(x.comps))), h('td', { class: 'num' }, String(Math.max(0, soldOf(x)))), h('td', { class: 'num' }, m(num(x.price))), h('td', { class: 'num' }, m(Math.max(0, soldOf(x)) * num(x.price)))))))
        : null,
      kv('Merch total', m(r.merch))),
    costs.length > 0 && h('div', { class: 'cs-sec' }, h('h4', null, 'Costs'),
      h('table', null, h('tbody', null, costs.map(([what, amt, from]) => h('tr', null, h('td', null, what), h('td', null, from), h('td', { class: 'num' }, m(num(amt))))))),
      kv('Costs total', m(r.costs))),
    h('div', { class: 'money-totals' }, kv('Fee', m(r.fee)), kv('Merch', m(r.merch)), kv('Costs', '−' + m(r.costs)), kv('Profit', m(r.profit), 'total')),
    r.payouts.length > 0 && h('div', { class: 'cs-sec' }, h('h4', null, 'Payouts'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Who'), h('th', { class: 'num' }, 'Share'), h('th', { class: 'num' }, 'Amount'))),
        h('tbody', null, r.payouts.map(p => h('tr', null, h('td', null, (byId('people', p.personId) || {}).name || ''), h('td', { class: 'num' }, String(p.weight)), h('td', { class: 'num' }, m(p.amount))))))),
    s.notes && h('div', { class: 'cs-sec' }, h('h4', null, 'Notes'), h('p', { class: 'cs-pre' }, s.notes)),
    s.settledAt && h('p', null, `Settled ${new Date(s.settledAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}.`),
    docFoot());
}

export function settlementText(b, sym = currency()) {
  const r = settle(b), s = sOf(b), d = b.deal || {}, m = n => money(n, sym), L = [];
  L.push(['Settlement', bookingTitle(b), textDate(b.date)].filter(Boolean).join(' · '));
  L.push('', `Deal: ${dealSummary(d, sym) || 'no deal'}`, `Tickets: ${r.tickets} × ${m(r.price)} = ${m(r.gross)}${num(s.comps) ? ` (${num(s.comps)} comps)` : ''}`, `The deal pays: ${m(r.fee)}`);
  if (r.depositPaid && r.deposit > 0) L.push(`Deposit paid before: −${m(r.deposit)}`);
  L.push(`Owed on the night: ${m(r.owedOnNight)}`);
  if (r.received != null) L.push(`Received: ${m(r.received)}${r.short > 0.005 ? ` (still owed ${m(r.short)})` : ''}`);
  if (r.merch > 0 || merchOf(b).length) L.push('', `Merch: ${m(r.merch)}`, ...merchOf(b).map(x => `  ${x.item || 'Item'}: ${Math.max(0, soldOf(x))} sold × ${m(num(x.price))}`));
  if (r.costs > 0) L.push('', `Costs: ${m(r.costs)}`, ...costsOf(b).map(c => `  ${c.desc || 'Cost'}: ${m(num(c.amount))}`), ...budgetOf(b).map(c => `  ${[c.cat, c.desc].filter(Boolean).join(': ') || 'Budget'}: ${m(num(c.amount))}`));
  L.push('', `Profit: ${m(r.profit)}`);
  if (r.payouts.length) L.push(...r.payouts.map(p => `  ${(byId('people', p.personId) || {}).name || ''}${p.weight !== 1 ? ` (share ${p.weight})` : ''}: ${m(p.amount)}`));
  if (s.notes) L.push('', s.notes);
  return L.join('\n');
}

/* ------------------------------- the box ------------------------------- */
const numBox = (id, label, value, onSave, { decimal = false, placeholder = '—' } = {}) => h('div', { class: 'sh-cell sh-k-' + id },
  h('label', { for: id }, label),
  h('input', { id, type: 'number', min: 0, step: decimal ? 'any' : 1, inputMode: decimal ? 'decimal' : 'numeric', value: known(value) ? value : '', placeholder,
    onchange: e => onSave(e.target.value === '' ? '' : Math.max(0, decimal ? num(e.target.value) : Math.round(num(e.target.value)))) }));
const line = (k, v, cls = '') => h('div', { class: 'sh-line ' + cls }, h('span', null, k), h('b', null, v));

export default {
  id: 'settlement', title: 'Settlement', icon: '🧾', order: 60,
  kinds: ['show'],
  summary(b) {
    if (!hasFigures(b)) return isSettled(b) ? 'Settled' : 'Not settled yet';
    return `Profit ${money(settle(b).profit)}` + (isSettled(b) ? ' · settled' : '');
  },
  render(b, ctx = {}) {
    const sym = ctx.sym || currency(), m = n => money(n, sym);
    const s = sOf(b), d = b.deal || {}, r = settle(b), done = isSettled(b);
    const open = id => ctx.open && ctx.open(id);
    const future = b.date && b.date > todayISO();
    const cap = num(d.capacity), through = num(s.tickets) + num(s.comps);
    const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));

    // The door
    const door = h('section', { class: 'sh-sec', 'aria-labelledby': 'sh-st-door-h' },
      h('h4', { id: 'sh-st-door-h' }, 'The door'),
      h('div', { class: 'sh-st-inputs' },
        numBox('sh-st-tickets', 'Tickets sold', s.tickets, v => setS(b, { tickets: v })),
        numBox('sh-st-comps', 'Comps', s.comps, v => setS(b, { comps: v })),
        numBox('sh-st-received', 'Received tonight', s.received, v => setS(b, { received: v }), { decimal: true })),
      !d.type && h('div', { class: 'warn' }, h('span', null, 'No deal on this show yet, so there’s no fee to work out. '), ctx.open && h('button', { type: 'button', class: 'btn ghost small', onclick: () => open('deal') }, 'Add the deal')),
      d.type && !num(d.ticketPrice) && d.type !== 'guarantee' && d.type !== 'none' && h('p', { class: 'warn' }, 'The deal has no ticket price, so the door counts as nothing. Add it under Deal & fee.'),
      cap > 0 && through > cap && h('p', { class: 'warn' }, `${through} through the door (tickets and comps) is more than the capacity of ${cap}. Worth a second count.`),
      h('div', { class: 'sh-lines' },
        line(`Door: ${r.tickets} × ${m(r.price)}`, m(r.gross)),
        num(d.expenses) > 0 && d.type !== 'guarantee' && d.type !== 'none' && line('Promoter costs off the top', m(num(d.expenses)), 'muted'),
        line('The deal pays' + (d.type ? ` (${dealSummary(d, sym)})` : ''), m(r.fee)),
        r.depositPaid && r.deposit > 0 && line('Deposit already paid', '−' + m(r.deposit)),
        !r.depositPaid && r.deposit > 0 && line('Deposit (not marked received)', m(0), 'muted'),
        line('Owed on the night', m(r.owedOnNight), 'strong'),
        r.received != null && line('Received', m(r.received))),
      r.received != null && (r.short > 0.005 ? h('p', { class: 'warn', id: 'sh-st-short' }, `${m(r.short)} short: the promoter handed over less than the deal works out to. Settle up before you leave, or note why below.`)
        : r.received - r.owedOnNight > 0.005 ? h('p', { class: 'small muted' }, `${m(r.received - r.owedOnNight)} more than the deal works out to. Worth checking the count.`)
          : h('p', { class: 'small sh-good' }, '✓ Paid in full on the night.')));

    // Merch
    const merch = merchOf(b), bad = merch.filter(x => soldOf(x) < 0);
    const merchSec = h('section', { class: 'sh-sec', 'aria-labelledby': 'sh-st-merch-h' },
      h('h4', { id: 'sh-st-merch-h' }, 'Merch'),
      merch.length ? h('div', { class: 'sh-table-wrap' }, h('table', { class: 'sh-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Item'), h('th', { scope: 'col', class: 'num' }, 'Sold'), h('th', { scope: 'col', class: 'num' }, 'Total'))),
        h('tbody', null, merch.map(x => h('tr', { class: soldOf(x) < 0 ? 'sh-badrow' : '' }, h('th', { scope: 'row' }, x.item || 'Item'),
          h('td', { class: 'num' }, `${Math.max(0, soldOf(x))} × ${m(num(x.price))}`), h('td', { class: 'num' }, m(Math.max(0, soldOf(x)) * num(x.price)))))),
        h('tfoot', null, h('tr', null, h('th', { scope: 'row' }, 'Merch'), h('td'), h('td', { class: 'num' }, m(r.merch))))))
        : h('div', { class: 'sh-st-inputs' }, numBox('sh-st-merchtotal', 'Merch takings', s.merchTotal, v => setS(b, { merchTotal: v }), { decimal: true, placeholder: '0' })),
      bad.length > 0 && h('p', { class: 'warn' }, `${bad.map(x => x.item || 'An item').join(', ')}: the end count is more than the start. Those lines count as nothing until fixed.`),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-merch', onclick: () => editMerch(b) }, merch.length ? '✎ Merch counts' : '+ Count each item')));

    // Costs
    const costs = costsOf(b), budget = budgetOf(b);
    const costSec = h('section', { class: 'sh-sec', 'aria-labelledby': 'sh-st-costs-h' },
      h('h4', { id: 'sh-st-costs-h' }, 'Costs'),
      (costs.length || budget.length) ? h('div', { class: 'sh-lines' },
        costs.map(c => line(c.desc || 'Cost', m(num(c.amount)))),
        budget.map(c => line([c.cat, c.desc].filter(Boolean).join(': ') || 'Budget line', m(num(c.amount)), 'sh-from-budget')),
        line('Costs', m(r.costs), 'strong'))
        : h('p', { class: 'small muted' }, 'No costs yet: add what the night cost you. The show’s budget lines count here too.'),
      budget.length > 0 && h('p', { class: 'small muted' }, `${plural(budget.length, 'line')} from the show’s budget (${m(r.budget)}).`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-costs', onclick: () => editCosts(b) }, costs.length ? '✎ Costs on the night' : '+ Add a cost'),
        ctx.open && h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-budget', onclick: () => open('budget') }, 'Budget →')));

    // Totals and payouts
    const ppl = peopleOn(b), equal = ppl.every(p => weightOf(b, p.id) === 1), zero = ppl.length > 0 && ppl.every(p => weightOf(b, p.id) === 0);
    const totals = h('div', { class: 'stats sh-st-totals' }, stat(m(r.income), 'fee + merch'), stat(m(r.costs), 'costs'), stat(m(r.profit), 'profit', r.profit < 0 ? 'bad' : 'sh-profit'));
    const pay = h('section', { class: 'sh-sec', 'aria-labelledby': 'sh-st-pay-h' },
      h('h4', { id: 'sh-st-pay-h' }, 'Payouts'),
      !ppl.length ? h('div', { class: 'small muted' }, h('p', null, 'No one is on this show yet. Add the band under Line-up to split the profit.'), ctx.open && h('button', { type: 'button', class: 'btn ghost small', onclick: () => open('lineup') }, 'Line-up →'))
        : [h('p', { class: 'small muted' }, 'The profit split between everyone on the show, an equal share each. Change a share to weight it: 2 = a double share, 0.5 = a half share, 0 = not paid from this night.'),
          r.profit < 0 && h('p', { class: 'warn' }, `The night lost ${m(-r.profit)}. The amounts below are each person’s share of the loss.`),
          zero && h('p', { class: 'warn' }, 'Every share is 0, so no one is paid.'),
          h('div', { class: 'sh-pay' }, ppl.map(p => {
            const out = r.payouts.find(x => x.personId === p.id) || { amount: 0 }, id = 'sh-w-' + p.id;
            return h('div', { class: 'sh-pay-row' },
              h('div', { class: 'sh-pay-who' }, h('strong', null, p.name || 'No name'), p.role && h('span', { class: 'small muted' }, p.role)),
              h('div', { class: 'sh-pay-share' }, h('label', { for: id, class: 'small muted' }, 'Share'),
                h('input', { id, type: 'number', min: 0, step: 0.5, inputMode: 'decimal', value: weightOf(b, p.id), 'aria-label': `Share for ${p.name || 'this person'}`, onchange: e => setShare(b, p.id, e.target.value) })),
              h('b', { class: 'sh-pay-amt' }, m(out.amount)));
          })),
          !equal && h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-equal', onclick: () => { if (setS(b, { shares: {} })) toast('Everyone back to an equal share'); } }, 'Equal shares again'))]);

    const notes = h('div', { class: 'field sh-st-notes' }, h('label', { for: 'sh-st-notes' }, 'Notes from the night'),
      h('textarea', { id: 'sh-st-notes', rows: 2, placeholder: 'Who counted the door, what was agreed, what is still owed…', value: s.notes || '', onchange: e => { if (setS(b, { notes: e.target.value.trim() })) toast('Notes saved'); } }));

    const doc = () => settlementDoc(fresh(b), sym);
    return h('div', { class: 'sh-block sh-settle' + (done ? ' settled' : '') },
      done ? h('div', { class: 'sh-st-status card-row' }, h('div', null, h('span', { class: 'pill st-settled' }, 'Settled'), s.settledAt ? h('span', { class: 'small muted' }, ` on ${fmtShort(ymd(new Date(s.settledAt)))}`) : null),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-reopen', onclick: () => reopen(b) }, 'Reopen'))
        : future && !hasFigures(b) && h('p', { class: 'muted small' }, 'For the night itself: fill this in with the promoter after the show. It works out what you’re owed, the merch and each person’s share.'),
      door, merchSec, costSec, totals, pay, notes,
      h('div', { class: 'actions sh-st-actions' },
        !done && h('button', { type: 'button', class: 'btn primary', id: 'sh-st-settle', onclick: () => markSettled(b) }, '✓ Mark settled'),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-print', onclick: () => printDoc(doc()) }, '🖨 Print'),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-copy', onclick: () => copyText(settlementText(fresh(b), sym), 'Settlement copied') }, '📋 Copy'),
        h('button', { type: 'button', class: 'btn ghost small', id: 'sh-st-save', onclick: () => saveDoc(`Settlement – ${bookingTitle(fresh(b))}`, doc()) }, '⬇ Save')));
  },
  tutorial: [
    { title: 'The door', text: 'Type the ticket count, comps and what the promoter handed over. Gdex works out what the deal pays, takes off the deposit and shows anything still owed.', target: ['#blk-settlement .sh-st-inputs', '#blk-settlement'] },
    { title: 'Merch and costs', text: 'Count each merch item in and out, and add the night’s costs. The show’s budget lines count too.', target: ['#sh-st-merch'] },
    { title: 'Payouts', text: 'The profit split between everyone on the show. Make a share 2 for a double share, or 0 to leave someone out.', target: ['#blk-settlement .sh-pay', '#blk-settlement .sh-st-totals'] },
    { title: 'Settle up', text: 'Mark settled when it’s done; print, copy or save the sheet for the promoter and the band.', target: ['#blk-settlement .sh-st-actions'] },
  ],
};

sheetTutorial(MERCH_TITLE, [
  { title: 'One line per item', text: 'Count before doors (start) and at the end (end). Given away covers freebies for the crew and the support.', target: ['.sh-rows .sh-row'] },
  { title: 'What sold', text: 'Under each line: how many sold and what they took.', target: ['.sh-row-note'] },
]);
sheetTutorial(COSTS_TITLE, [
  { title: 'The night’s costs', text: 'Anything spent on the night. They come off the profit before the payouts.', target: ['.sh-rows .sh-row', '.sh-rows-form .actions .btn'] },
]);

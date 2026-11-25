// The quote and invoice document itself, built from a self-contained snapshot: the Money page shows it, prints it,
// makes the PDF and the email text from it, and packs it into the link the client opens; the public invoice page
// renders the very same snapshot. Nothing here touches the store.
import { h, parseISO } from './util.js';
import { payLinks, payTexts, epcPayload } from './pay.js';

export const KINDS = { quote: { label: 'Quote', statuses: ['Draft', 'Sent', 'Accepted', 'Declined'], dateLabel: 'Valid until', dateKey: 'until' }, invoice: { label: 'Invoice', statuses: ['Draft', 'Sent', 'Paid', 'Void'], dateLabel: 'Due', dateKey: 'due' } };
export const fmt = (n, sym = '$') => { const v = Number(n) || 0; return (v < 0 ? '-' : '') + sym + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
// A date on a document, with its year: an invoice is read months later, and by an accountant.
export const fmtDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? parseISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : String(s || ''));
export const docTitle = snap => `${KINDS[snap.kind].label} ${snap.number} — ${snap.title}`;

// Lines, tax, total, what has been paid (the deposit plus every recorded payment; an invoice marked Paid with nothing
// recorded counts as paid in full) and the balance due. Every figure is rounded to cents once and the next is worked
// out from the rounded ones, so the lines add up to the subtotal, subtotal and tax to the total, and the balance asked
// for (on the document, the Pay buttons, the payment form and the accountant's file) is the total less what was paid.
const r2 = n => { const v = Math.sign(n) * Math.round(Number((Math.abs(n) * 100).toPrecision(15))) / 100; return Number.isFinite(v) ? v : 0; };
export function calc(snap) {
  const lines = (snap.lines || []).map(l => ({ ...l, amount: r2((Number(l.qty) || 0) * (Number(l.price) || 0)) }));
  const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0)), rate = Number(snap.taxRate) || 0, tax = r2(subtotal * rate / 100), total = r2(subtotal + tax);
  const deposit = r2(Number(snap.deposit) || 0), received = r2((snap.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  const paid = snap.kind === 'invoice' && snap.status === 'Paid' ? Math.max(total, r2(deposit + received)) : r2(deposit + received);
  return { lines, subtotal, rate, tax, total, deposit, received, paid, balance: Math.max(0, r2(total - paid)) };
}
export const payContext = snap => ({ amount: calc(snap).balance, code: snap.code || '', reference: snap.number, payee: snap.payee }); // no code: the currency is not one Vdex knows, and none is put in a link
export const payButtons = snap => (snap.kind === 'invoice' && snap.status !== 'Void' && calc(snap).balance > 0 ? payLinks(snap.pay || {}, payContext(snap)) : []);
// Paid: marked so (also at a total of nothing), or nothing left of a total that was something. Owing: something is
// still to pay; a credit note or a zero total asks for nothing, shows no ways to pay and is never overdue.
export const isPaid = snap => snap.kind === 'invoice' && (snap.status === 'Paid' || (calc(snap).total > 0 && calc(snap).balance <= 0));
export const owing = snap => snap.kind === 'invoice' && snap.status !== 'Void' && !isPaid(snap) && calc(snap).balance > 0;

// The "How to pay" section: buttons, bank details, a bank QR when there is an IBAN, the reference to quote.
function paySection(snap, { qr, pending } = {}) {
  if (snap.kind !== 'invoice' || snap.status === 'Void') return null;
  const t = calc(snap), pay = snap.pay || {}, buttons = payButtons(snap), bank = payTexts(pay), ctx = payContext(snap);
  const epc = epcPayload(pay, ctx), kids = [];
  if (isPaid(snap)) kids.push(h('div', { class: 'paid-stamp' }, 'Paid, thank you'));
  if (!buttons.length && !bank.length) return kids.length ? h('section', { class: 'cs-sec pay-sec' }, h('h4', null, 'Payment'), ...kids) : null;
  if (owing(snap)) {
    if (buttons.length) kids.push(h('div', { class: 'pay-buttons' }, ...buttons.map(b => h('a', { class: 'pay-btn', href: b.href, target: '_blank', rel: 'noopener noreferrer', 'data-pay': b.id }, b.label))));
    if (bank.length) kids.push(h('p', { class: 'cs-pre' }, bank.join('\n')));
    const codes = [epc && ['Scan with your banking app to fill in the transfer', epc], ...buttons.filter(b => b.qr).map(b => [b.qr, b.href])].filter(Boolean);
    // The codes are drawn a moment later (the QR writer loads on first use): whoever saves or prints the document at once waits for `pending`.
    if (qr) for (const [label, text] of codes) { const box = h('div', { class: 'pay-qr' }, h('div', { class: 'qr-box', 'aria-label': 'QR code' }), h('div', { class: 'small' }, label)); const drawn = qr(text, { cellSize: 3 }).then(svg => { box.firstElementChild.innerHTML = svg; }).catch(() => box.remove()); if (pending) pending.push(drawn); kids.push(box); }
    kids.push(h('p', { class: 'pay-ref' }, `Balance due ${fmt(t.balance, snap.currency)}${snap.due ? ' by ' + fmtDate(snap.due) : ''} · please quote ${snap.number} as the reference.`));
  }
  return kids.length ? h('section', { class: 'cs-sec pay-sec' }, h('h4', null, isPaid(snap) ? 'Payment' : 'How to pay'), ...kids) : null;
}

export function renderDoc(snap, opts = {}) {
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency || '$', to = snap.to || [];
  const kv = (k, v, cls = '') => h('div', { class: 'cs-kv ' + cls }, h('span', null, k), h('b', null, v));
  return h('article', { class: 'cs-doc money-doc' },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, (snap.from || [])[0] || 'Vdex'), h('div', { class: 'cs-kicker' }, K.label.toUpperCase())),
      h('div', { class: 'cs-when' }, h('b', null, snap.number), h('div', null, fmtDate(snap.date)), snap[K.dateKey] && h('div', null, `${K.dateLabel} ${fmtDate(snap[K.dateKey])}`))),
    h('div', { class: 'money-parties' },
      h('div', null, h('h4', null, 'From'), ...(snap.from || []).map(l => h('div', null, l))),
      h('div', null, h('h4', null, 'To'), ...(to.length ? to : ['—']).map(l => h('div', null, l)))),
    h('h2', null, snap.title), h('div', { class: 'cs-sub' }, snap.when || ''),
    h('table', null, h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Amount'))),
      h('tbody', null, ...t.lines.map(l => h('tr', null, h('td', null, l.desc || ''), h('td', { class: 'num' }, String(l.qty ?? '')), h('td', null, l.unit || ''), h('td', { class: 'num' }, l.price === '' || l.price == null ? '' : fmt(l.price, sym)), h('td', { class: 'num' }, fmt(l.amount, sym)))))),
    h('div', { class: 'money-totals' }, kv('Subtotal', fmt(t.subtotal, sym)), t.rate > 0 && kv(`${snap.taxLabel || 'Tax'} ${t.rate}%`, fmt(t.tax, sym)), kv('Total', fmt(t.total, sym), 'total'),
      snap.kind === 'invoice' && t.deposit > 0 && kv('Already paid', '-' + fmt(t.deposit, sym)),
      ...(snap.kind === 'invoice' ? (snap.payments || []).map(p => kv(`Paid ${p.date ? fmtDate(p.date) : ''}${p.method ? ' · ' + p.method : ''}`, '-' + fmt(p.amount, sym))) : []),
      snap.kind === 'invoice' && t.paid > 0 && kv('Balance due', fmt(t.balance, sym), 'total')),
    snap.notes && h('section', { class: 'cs-sec' }, h('h4', null, snap.kind === 'quote' ? 'Notes' : 'Terms'), h('p', { class: 'cs-pre' }, snap.notes)),
    paySection(snap, opts),
    h('footer', { class: 'cs-foot' }, `${(snap.from || []).join(' · ')} · ${K.label} ${snap.number}${snap.status && snap.status !== 'Draft' ? ' · ' + snap.status : ''}`));
}

export function docText(snap) {
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency || '$', buttons = payButtons(snap), bank = owing(snap) ? payTexts(snap.pay || {}) : [];
  const out = [`${K.label.toUpperCase()} ${snap.number} — ${snap.title}`, `From: ${(snap.from || []).join(' · ')}`, `To: ${(snap.to || []).join(', ')}`, `Date: ${fmtDate(snap.date)}${snap[K.dateKey] ? ` · ${K.dateLabel}: ${fmtDate(snap[K.dateKey])}` : ''}`, '',
    ...t.lines.map(l => `${l.desc}  ${l.qty ?? ''} ${l.unit || ''} × ${fmt(l.price, sym)} = ${fmt(l.amount, sym)}`), '',
    `Subtotal: ${fmt(t.subtotal, sym)}`, t.rate > 0 ? `${snap.taxLabel || 'Tax'} ${t.rate}%: ${fmt(t.tax, sym)}` : null, `Total: ${fmt(t.total, sym)}`,
    snap.kind === 'invoice' && t.paid > 0 ? `Paid so far: ${fmt(t.paid, sym)} · Balance due: ${fmt(t.balance, sym)}` : null,
    snap.notes ? '\n' + snap.notes : null,
    isPaid(snap) ? '\nPaid, thank you.' : null,
    buttons.length || bank.length ? '\nHow to pay:' : null, ...buttons.map(b => `${b.label}: ${b.href}`), ...bank,
    buttons.length || bank.length ? `Please quote ${snap.number} as the reference.` : null];
  return out.filter(x => x !== null && x !== undefined && x !== false).join('\n');
}

export function pdfBlocks(snap) {
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency || '$', buttons = payButtons(snap), bank = owing(snap) ? payTexts(snap.pay || {}) : [];
  const blocks = [{ type: 'title', text: `${K.label} ${snap.number}` }, { type: 'subtitle', text: [fmtDate(snap.date), snap[K.dateKey] && `${K.dateLabel} ${fmtDate(snap[K.dateKey])}`, snap.status !== 'Draft' && snap.status].filter(Boolean).join('   ·   ') },
    { type: 'heading', text: 'From' }, { type: 'text', text: (snap.from || []).join('\n') }, { type: 'heading', text: 'To' }, { type: 'text', text: (snap.to || []).join('\n') || '—' },
    { type: 'heading', text: snap.title }, { type: 'text', text: snap.when || '', gray: 0.4 },
    { type: 'table', head: ['Description', 'Qty', 'Unit', 'Price', 'Amount'], rows: t.lines.map(l => [l.desc, l.qty, l.unit, l.price === '' || l.price == null ? '' : fmt(l.price, sym), fmt(l.amount, sym)]), widths: [0.46, 0.1, 0.12, 0.16, 0.16] },
    { type: 'kv', k: 'Subtotal', v: fmt(t.subtotal, sym) }];
  if (t.rate > 0) blocks.push({ type: 'kv', k: `${snap.taxLabel || 'Tax'} ${t.rate}%`, v: fmt(t.tax, sym) });
  blocks.push({ type: 'kv', k: 'Total', v: fmt(t.total, sym) });
  if (snap.kind === 'invoice' && t.deposit > 0) blocks.push({ type: 'kv', k: 'Already paid', v: '-' + fmt(t.deposit, sym) });
  if (snap.kind === 'invoice') for (const p of snap.payments || []) blocks.push({ type: 'kv', k: `Paid ${p.date ? fmtDate(p.date) : ''}${p.method ? ' · ' + p.method : ''}`, v: '-' + fmt(p.amount, sym) });
  if (snap.kind === 'invoice' && t.paid > 0) blocks.push({ type: 'kv', k: 'Balance due', v: fmt(t.balance, sym) });
  if (snap.notes) blocks.push({ type: 'heading', text: snap.kind === 'quote' ? 'Notes' : 'Terms' }, { type: 'text', text: snap.notes });
  if (isPaid(snap)) blocks.push({ type: 'heading', text: 'Payment' }, { type: 'text', text: 'Paid, thank you.', bold: true });
  else if (buttons.length || bank.length) blocks.push({ type: 'heading', text: 'How to pay' }, { type: 'text', text: [...buttons.map(b => `${b.label}: ${b.href}`), ...bank, `Please quote ${snap.number} as the reference.`].join('\n') });
  return blocks;
}

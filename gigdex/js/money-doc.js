// The quote or invoice document itself, drawn from a self-contained snapshot: the app's preview, the printout, the
// saved web page, the email text and the client's page (invoice.html) all come from here, so the client sees exactly
// what the app shows. calc() is the one money formula for documents. Pure: nothing here touches the store.
import { h } from './util.js';
import { payButtons, bankLines, bankQr, codeFor } from './money-pay.js';

// The two kinds of document, their statuses ([id, label]) and the label of their second date.
export const KINDS = {
  quote: { label: 'Quote', statuses: [['draft', 'Draft'], ['sent', 'Sent'], ['accepted', 'Accepted'], ['declined', 'Declined']], dueLabel: 'Valid until' },
  invoice: { label: 'Invoice', statuses: [['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['void', 'Void']], dueLabel: 'Due' },
};
export const statusLabel = (kind, s) => ((KINDS[kind] || KINDS.invoice).statuses.find(x => x[0] === s) || ['', 'Draft'])[1];

// Money on a document: always two decimals and a plain minus, so it reads the same on paper, in an email and in a PDF.
export const fmtDoc = (n, sym = '$') => { const v = Number(n) || 0; return (v < 0 ? '-' : '') + sym + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// "16 Nov 2026" in the reader's own language; '' for anything that is not a date.
export const dateText = iso => { if (!ISO.test(iso || '')) return ''; const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
// "6 hours", "1 show", "2 half days", "3 each".
export const qtyText = (qty, unit) => { const q = qty === '' || qty == null ? '' : String(Math.round(num(qty) * 100) / 100), u = String(unit || '').trim(); if (!u) return q; const plural = num(qty) !== 1 && u !== 'each' && !/s$/i.test(u) && !/^per\b/i.test(u); return `${q} ${plural ? u + 's' : u}`.trim(); };

// The sums: each line's amount, the net, the tax on it, the total, what has been paid (every payment recorded; an
// invoice marked paid counts as paid in full) and what is still due (nothing on a void invoice). Works on a stored
// document and on a snapshot alike.
export function calc(doc = {}) {
  const lines = (Array.isArray(doc.lines) ? doc.lines : []).map(l => ({ ...l, amount: r2(num(l.qty) * num(l.price)) }));
  const net = r2(lines.reduce((s, l) => s + l.amount, 0)), rate = Math.max(0, num(doc.taxRate)), tax = r2(net * rate / 100), total = r2(net + tax);
  const received = r2((Array.isArray(doc.payments) ? doc.payments : []).reduce((s, p) => s + num(p && p.amount), 0));
  const paid = doc.status === 'paid' ? Math.max(total, received) : received;
  const due = doc.status === 'void' ? 0 : Math.max(0, r2(total - paid));
  return { lines, net, rate, tax, total, received, paid, due };
}
export const isPaidDoc = snap => snap.kind === 'invoice' && snap.status !== 'void' && (snap.status === 'paid' || (calc(snap).total > 0 && calc(snap).due <= 0));
export const docTitle = snap => `${KINDS[snap.kind].label} ${snap.number}${snap.title ? ' – ' + snap.title : ''}`;
const payCtx = snap => ({ amount: calc(snap).due, code: snap.code || codeFor(snap.currency), reference: snap.number });

// "How to pay": Pay buttons for the balance, bank details with a QR, the person's own note, the reference to quote.
// opts.qr(text) → Promise<svg markup>; opts.pending collects those promises (printing waits for them).
function paySection(snap, opts) {
  if (snap.kind !== 'invoice') return null;
  if (snap.status === 'void') return h('section', { class: 'cs-sec pay-sec' }, h('div', { class: 'paid-stamp mn-void-stamp' }, 'Void: nothing is owed on this invoice'));
  if (isPaidDoc(snap)) return h('section', { class: 'cs-sec pay-sec' }, h('h4', null, 'Payment'), h('div', { class: 'paid-stamp' }, 'Paid, thank you'));
  const pay = snap.pay || {}, t = calc(snap), ctx = payCtx(snap), buttons = payButtons(pay, ctx), bank = bankLines(pay), note = String(pay.note || '').trim();
  if (!buttons.length && !bank.length && !note) return null;
  const kids = [];
  if (buttons.length) kids.push(h('div', { class: 'pay-buttons' }, ...buttons.map(b => h('a', { class: 'pay-btn', href: b.href, target: '_blank', rel: 'noopener noreferrer', 'data-pay': b.id }, b.label))));
  if (bank.length) {
    kids.push(h('p', { class: 'cs-pre mn-bank' }, ['Bank transfer', ...bank].join('\n')));
    const code = bankQr(pay, ctx);
    if (code && opts.qr) {
      const box = h('div', { class: 'pay-qr' }, h('div', { class: 'qr-box', role: 'img', 'aria-label': code.label }), h('div', { class: 'small' }, code.label));
      const p = Promise.resolve().then(() => opts.qr(code.text, { cellSize: 3 })).then(svg => { box.firstElementChild.innerHTML = svg; }).catch(() => box.remove());
      if (opts.pending) opts.pending.push(p);
      kids.push(box);
    }
  }
  if (note) kids.push(h('p', { class: 'cs-pre' }, note));
  if (t.due > 0) kids.push(h('p', { class: 'pay-ref' }, `Balance due ${fmtDoc(t.due, snap.currency || '$')}${snap.due ? ' by ' + dateText(snap.due) : ''} · please quote ${snap.number} as the reference.`));
  return h('section', { class: 'cs-sec pay-sec' }, h('h4', null, 'How to pay'), ...kids);
}

export function renderDoc(snap, opts = {}) {
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency || '$', m = n => fmtDoc(n, sym), to = (snap.to || []).filter(Boolean);
  const kv = (k, v, cls = '') => h('div', { class: 'cs-kv' + (cls ? ' ' + cls : '') }, h('span', null, k), h('b', null, v));
  const isInv = snap.kind === 'invoice';
  return h('article', { class: 'cs-doc money-doc' },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, (snap.from || [])[0] || 'Gigdex'), h('div', { class: 'cs-kicker' }, K.label.toUpperCase())),
      h('div', { class: 'cs-when' }, h('b', null, snap.number), snap.issued && h('div', null, dateText(snap.issued)), snap.due && h('div', null, `${K.dueLabel} ${dateText(snap.due)}`))),
    h('div', { class: 'money-parties' },
      h('div', null, h('h4', null, 'From'), ...(snap.from || []).map(l => h('div', null, l))),
      h('div', null, h('h4', null, isInv ? 'Bill to' : 'For'), ...(to.length ? to : ['—']).map(l => h('div', null, l)))),
    snap.title && h('h2', null, snap.title), snap.when && h('div', { class: 'cs-sub' }, snap.when),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Amount'))),
      h('tbody', null, ...(t.lines.length ? t.lines.map(l => h('tr', null, h('td', null, l.desc || ''), h('td', { class: 'num' }, qtyText(l.qty, l.unit)), h('td', { class: 'num' }, l.price === '' || l.price == null ? '' : m(l.price)), h('td', { class: 'num' }, m(l.amount))))
        : [h('tr', null, h('td', { colSpan: 4 }, 'No lines yet.'))]))),
    h('div', { class: 'money-totals' },
      t.tax > 0 || t.rate > 0 ? [kv('Subtotal', m(t.net)), kv(`${snap.taxName || 'Tax'} ${t.rate}%`, m(t.tax))] : null,
      kv('Total', m(t.total), 'total'),
      isInv ? (snap.payments || []).map(p => kv(['Paid', p.date && dateText(p.date), p.method].filter(Boolean).join(' · '), '-' + m(p.amount))) : null,
      isInv && t.paid > 0 && snap.status !== 'void' && kv('Balance due', m(t.due), 'total')),
    snap.notes && h('section', { class: 'cs-sec' }, h('h4', null, 'Notes'), h('p', { class: 'cs-pre' }, snap.notes)),
    paySection(snap, opts),
    h('footer', { class: 'cs-foot' }, [...(snap.from || []).slice(0, 2), `${K.label} ${snap.number}`, 'Made with Gigdex'].join(' · ')));
}

// The same document as plain text, for an email or a message.
export function docText(snap) {
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency || '$', m = n => fmtDoc(n, sym), isInv = snap.kind === 'invoice';
  const pay = snap.pay || {}, buttons = isInv && !isPaidDoc(snap) && snap.status !== 'void' ? payButtons(pay, payCtx(snap)) : [], bank = isInv && !isPaidDoc(snap) && snap.status !== 'void' ? bankLines(pay) : [];
  const note = isInv && !isPaidDoc(snap) && snap.status !== 'void' ? String(pay.note || '').trim() : '';
  return [
    `${K.label.toUpperCase()} ${snap.number}${snap.title ? ' – ' + snap.title : ''}`,
    snap.when || null,
    `From: ${(snap.from || []).join(' · ')}`,
    (snap.to || []).length ? `${isInv ? 'Bill to' : 'For'}: ${snap.to.join(' · ')}` : null,
    [snap.issued && `Date: ${dateText(snap.issued)}`, snap.due && `${K.dueLabel}: ${dateText(snap.due)}`].filter(Boolean).join(' · ') || null,
    '',
    ...t.lines.map(l => `${l.desc || '—'}: ${qtyText(l.qty, l.unit)}${l.price === '' || l.price == null ? '' : ' × ' + m(l.price)} = ${m(l.amount)}`),
    '',
    t.rate > 0 ? `Subtotal: ${m(t.net)}` : null,
    t.rate > 0 ? `${snap.taxName || 'Tax'} ${t.rate}%: ${m(t.tax)}` : null,
    `Total: ${m(t.total)}`,
    ...(isInv ? (snap.payments || []).map(p => `Paid${p.date ? ' ' + dateText(p.date) : ''}${p.method ? ' (' + p.method + ')' : ''}: ${m(p.amount)}`) : []),
    isInv && t.paid > 0 && snap.status !== 'void' ? `Balance due: ${m(t.due)}` : null,
    snap.status === 'void' && isInv ? '\nThis invoice is void: nothing is owed.' : null,
    isPaidDoc(snap) ? '\nPaid, thank you.' : null,
    snap.notes ? '\n' + snap.notes : null,
    buttons.length || bank.length || note ? '\nHow to pay:' : null,
    ...buttons.map(b => `${b.label}: ${b.href}`),
    ...(bank.length ? ['Bank transfer', ...bank] : []),
    note || null,
    buttons.length || bank.length ? `Please quote ${snap.number} as the reference.` : null,
  ].filter(x => x !== null && x !== undefined && x !== false).join('\n');
}

/* --------------------------- reading a snapshot from a link --------------------------- */
// A link can be made or changed by anyone, so the client's page keeps only the fields it knows, as the types it
// expects, within sensible sizes. Returns a clean snapshot, or null when it is not a document at all.
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const fin = (v, lim = 1e9) => { if (v === '' || v == null) return ''; const n = Number(v); return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : ''; };
const iso = v => (typeof v === 'string' && ISO.test(v) ? v : '');
const strs = (a, n = 8, max = 200) => (Array.isArray(a) ? a.slice(0, n).map(x => str(x, max)).filter(Boolean) : []);
export function cleanSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS[raw.kind]) return null;
  const kind = raw.kind, number = str(raw.number, 40).trim();
  if (!number) return null;
  const status = KINDS[kind].statuses.some(s => s[0] === raw.status) ? raw.status : 'sent';
  const pay = {};
  if (kind === 'invoice' && raw.pay && typeof raw.pay === 'object') for (const k of ['accountName', 'bankName', 'sortCode', 'accountNumber', 'iban', 'bic', 'paypal', 'venmo', 'cashapp', 'revolut', 'payLink', 'payLinkLabel']) { const v = str(raw.pay[k], k === 'payLink' ? 500 : 120).trim(); if (v) pay[k] = v; }
  if (kind === 'invoice' && raw.pay && typeof raw.pay === 'object') { const n = str(raw.pay.note, 1000).trim(); if (n) pay.note = n; }
  return {
    v: 1, kind, number, status, issued: iso(raw.issued), due: iso(raw.due),
    title: str(raw.title, 200), when: str(raw.when, 200),
    from: strs(raw.from), to: strs(raw.to),
    lines: (Array.isArray(raw.lines) ? raw.lines.slice(0, 300) : []).filter(l => l && typeof l === 'object').map(l => ({ desc: str(l.desc, 500), qty: fin(l.qty, 1e6), unit: str(l.unit, 30), price: fin(l.price) })),
    taxRate: Math.max(0, Math.min(100, Number(fin(raw.taxRate, 100)) || 0)), taxName: str(raw.taxName, 30),
    notes: str(raw.notes, 4000),
    payments: kind === 'invoice' && Array.isArray(raw.payments) ? raw.payments.slice(0, 200).filter(p => p && typeof p === 'object').map(p => ({ date: iso(p.date), amount: Number(fin(p.amount)) || 0, method: str(p.method, 60) })) : [],
    currency: str(raw.currency, 6) || '$', code: /^[A-Z]{3}$/.test(raw.code || '') ? raw.code : '',
    email: /^[^\s@<>"]+@[^\s@<>"]+$/.test(str(raw.email, 200)) ? str(raw.email, 200) : '',
    pay,
  };
}

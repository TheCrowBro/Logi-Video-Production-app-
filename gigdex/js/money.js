// Quotes and invoices: one of each per booking (b.quote, b.invoice). Lines are suggested from the booking (a show's
// fee, a session's studio time and players, an other booking's fee) or picked from the person's price list, then
// edited; payments are recorded against the invoice; the document is printed, saved as a web page, copied as text,
// emailed, or sent as a link that opens it on the client's phone with Pay buttons. Numbering, tax and payment details
// live in db.billing, the price list in db.priceList (Settings shows billingPanel() and priceListPanel()).
//
// A document: { number, status, issued, due, lines: [{ id, desc, qty, unit, price }], taxRate, taxName, notes,
//   payments: [{ id, date, amount, method }], sentAt, acceptedAt, paidAt, createdAt, updatedAt }.
// Quote statuses: draft, sent, accepted, declined. Invoice statuses: draft, sent, paid, void.
import { h, sheet, toast, uid, todayISO, parseISO, ymd, fmtLong } from './util.js';
import { db, byId, update } from './store.js';
import { openForm } from './form.js';
import { bookingTitle, actName, venueOf, fmtMoney, currency, settle, dealPays, daysSpan, markCheck, lastDate } from './model.js';
import { clockHours, plannedHours } from './clock.js';
import { sheetTutorial } from './tour.js';
import { printElement, docPage, saveFile, fileName } from './print.js';
import { shareBase } from './version.js';
import { KINDS, calc, renderDoc, docText, docTitle, statusLabel, fmtDoc, dateText, qtyText, isPaidDoc } from './money-doc.js';
import { CURRENCIES, codeFor } from './money-pay.js';
export { KINDS, statusLabel, calc, qtyText };
// The QR maker and the link packer load only when a document with a bank QR is drawn or a link is made.
const qrSvg = (text, opts) => import('./qr.js').then(m => m.qrSvg(text, opts));
const pack = obj => import('./link-pack.js').then(m => m.pack(obj));

const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const pad4 = n => String(n).padStart(4, '0');
const addDays = (iso, n) => { const d = parseISO(iso); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (Number(n) || 0))); };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isISO = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/* ------------------------------- billing settings ------------------------------- */
const DEF = {
  quotePrefix: 'Q-', invoicePrefix: 'INV-', nextQuote: 1, nextInvoice: 1, // counters: a number is used once, never again
  taxName: 'Tax', taxRate: 0, dueDays: 14, validDays: 30, currencyCode: '',
  accountName: '', bankName: '', sortCode: '', accountNumber: '', iban: '', bic: '',
  paypal: '', venmo: '', cashapp: '', revolut: '', payLink: '', payLinkLabel: '', payNote: '',
};
export const billing = () => ({ ...DEF, ...(db.billing && typeof db.billing === 'object' ? db.billing : {}) });
export function setBilling(patch) { update(d => { d.billing = { ...DEF, ...(d.billing && typeof d.billing === 'object' ? d.billing : {}), ...patch, updatedAt: Date.now() }; }); }
export const currencyCode = () => billing().currencyCode || codeFor(currency());

/* ------------------------------- documents ------------------------------- */
// The document on a booking, with its lists always present, or null.
export function docOf(b, kind) {
  const d = b && (kind === 'quote' || kind === 'invoice') ? b[kind] : null;
  if (!d || typeof d !== 'object') return null;
  return { ...d, lines: Array.isArray(d.lines) ? d.lines : [], payments: Array.isArray(d.payments) ? d.payments : [] };
}
export function docTotals(doc) { const t = calc(doc || {}); return { net: t.net, tax: t.tax, total: t.total, paid: t.paid, due: t.due }; }
// An invoice that was sent, is past its due date, and still has money due.
export function isOverdue(b) { const inv = docOf(b, 'invoice'); return !!(inv && inv.status === 'sent' && inv.due && inv.due < todayISO() && docTotals(inv).due > 0.005); }
export const isPaid = doc => !!doc && isPaidDoc({ ...doc, kind: 'invoice' });

// Every number on any document, so a number typed by hand is never used twice.
const usedNumbers = (d = db, except = null) => new Set(d.bookings.flatMap(b => ['quote', 'invoice'].filter(k => !(except && b.id === except[0] && k === except[1])).map(k => b[k] && b[k].number)).filter(Boolean).map(String));
const prefixOf = (bl, kind) => String((kind === 'quote' ? bl.quotePrefix : bl.invoicePrefix) ?? '');
const counterKey = kind => (kind === 'quote' ? 'nextQuote' : 'nextInvoice');
// The number the next document of a kind will get (without taking it): the counter's, or, when the counter is
// missing or blank, one past the highest number with this prefix still on a document.
export function nextNumber(kind, d = db) {
  const bl = { ...DEF, ...(d.billing || {}) }, prefix = prefixOf(bl, kind), used = usedNumbers(d);
  const stored = Math.floor(Number(bl[counterKey(kind)]));
  let n = stored >= 1 ? stored : 1 + Math.max(0, ...[...used].filter(u => u.startsWith(prefix) && /^\d+$/.test(u.slice(prefix.length))).map(u => Number(u.slice(prefix.length))));
  while (used.has(prefix + pad4(n))) n++;
  return { number: prefix + pad4(n), n };
}
// Takes the next number inside an update: the counter moves on, so a deleted document's number is never given out again.
function takeNumber(d, kind) {
  const { number, n } = nextNumber(kind, d);
  d.billing = { ...DEF, ...(d.billing || {}), [counterKey(kind)]: n + 1, updatedAt: Date.now() };
  return number;
}

const CHECKS = { show: { sent: 'show-invoice', paid: 'show-paid' }, session: { sent: 'ses-invoice', paid: 'ses-paid' } };
// Saves a document onto its booking: stamps when it was sent, accepted or paid, and ticks the booking's checklist
// (an invoice sent ticks "Invoice sent"; paid in full ticks "Paid in full", and unticks it if a payment is undone).
export function saveDoc(bookingId, kind, next) {
  const b = byId('bookings', bookingId);
  if (!b) { toast('That booking has been deleted.'); return false; }
  const prev = docOf(b, kind) || {}, now = Date.now(), doc = { ...next, updatedAt: now };
  if (doc.status !== 'draft' && !doc.sentAt) doc.sentAt = now;
  if (kind === 'quote' && doc.status === 'accepted' && !doc.acceptedAt) doc.acceptedAt = now;
  // An invoice whose payments already cover it (the deposit and the night's takings came in) is paid, not just sent.
  if (kind === 'invoice' && doc.status === 'sent' && Array.isArray(doc.payments) && doc.payments.length && calc({ ...doc, status: 'sent' }).total > 0 && calc({ ...doc, status: 'sent' }).due <= 0.005) doc.status = 'paid';
  if (kind === 'invoice') { if (doc.status === 'paid') doc.paidAt = doc.paidAt || now; else doc.paidAt = null; }
  update(d => { const x = d.bookings.find(r => r.id === bookingId); if (!x) return; x[kind] = doc; x.updatedAt = now; });
  const ids = CHECKS[b.kind];
  if (kind === 'invoice' && ids) {
    if (doc.status === 'sent' || doc.status === 'paid') markCheck(bookingId, ids.sent, true);
    if (doc.status === 'paid') markCheck(bookingId, ids.paid, true);
    else if (prev.status === 'paid') markCheck(bookingId, ids.paid, false);
  }
  return true;
}

/* ------------------------------- suggested lines ------------------------------- */
// The hours a session is billed for: the session clock's when it ran, else the planned start to finish (past
// midnight too) on every day of the booking, to the quarter hour.
export function bookingHours(b) {
  let c = 0; try { c = Number(clockHours(b.id)) || 0; } catch { c = 0; }
  if (c > 0) return { hours: Math.round(c * 4) / 4, from: 'clock' };
  const p = plannedHours(b);
  return { hours: Math.round(p * 4) / 4, from: p > 0 ? 'planned' : '' };
}
// "16 Nov 2026", or "16 Nov 2026 to 17 Nov 2026" for more than a day.
const whenShort = b => (b && b.date ? (lastDate(b) > b.date ? `${dateText(b.date)} to ${dateText(lastDate(b))}` : dateText(b.date)) : '');
const whenLong = b => (b && b.date ? (lastDate(b) > b.date ? `${fmtLong(b.date)} to ${fmtLong(lastDate(b))}` : fmtLong(b.date)) : '');
const songsOf = b => (Array.isArray(b.songIds) ? b.songIds : []).map(id => byId('songs', id)).filter(Boolean);
const priceOrBlank = n => (num(n) ? r2(n) : '');
// A person's quantity on a booking by their rate unit: days, hours, one show, or one per song.
function personQty(p, b) {
  switch (p.rateUnit) {
    case 'hour': return { qty: bookingHours(b).hours || 1, unit: 'hour' };
    case 'show': return { qty: 1, unit: 'show' };
    case 'song': return { qty: Math.max(1, songsOf(b).length), unit: 'song' };
    default: return { qty: daysSpan(b), unit: 'day' };
  }
}

// What a new quote or invoice starts with. { lines, payments, notes, hint } (hint is for the person, not the client).
export function suggestLines(b, kind) {
  const lines = [], payments = [], line = (desc, qty, unit, price) => lines.push({ id: uid(), desc, qty, unit, price: priceOrBlank(price) });
  let notes = '', hint = '';
  const act = actName(b.actId) || b.client || '', venue = venueOf(b).name || '', when = whenShort(b), at = venue ? ` at ${venue}` : '';
  if (b.kind === 'show') {
    const deal = b.deal || {}, s = b.settlement || {}, night = settle(b), today = todayISO();
    const settled = num(s.tickets) > 0 || !!s.settledAt;
    const fee = settled ? night.fee : dealPays(deal, 0);
    line(`Performance${act ? ': ' + act : ''}${at}${when ? ', ' + when : ''}`, 1, 'show', fee);
    if (settled) hint = 'The fee is what the settlement says the deal paid.';
    else if (!(fee > 0)) hint = deal.type === 'door' ? 'A door deal has no fee until the night is settled: type the amount in.' : deal.type === 'none' ? 'The deal says no fee (a showcase or charity show).' : 'There is no fee in the deal yet: type the amount in.';
    const dep = num(deal.deposit);
    // A deposit already received comes off the invoice. When it came in is not kept, so it is dated by the latest it
    // can have arrived: its due date, the show or today, whichever is earliest (so it counts in the right year).
    if (dep > 0 && deal.depositPaid && kind === 'invoice') payments.push({ id: uid(), date: [deal.depositDue, b.date, today].filter(isISO).sort()[0], amount: r2(dep), method: 'Deposit received' });
    // So does what the promoter handed over on the night (the settlement's "received", on top of the deposit), so the
    // invoice asks only for what the settlement says is still owed.
    if (night.received > 0 && kind === 'invoice') {
      payments.push({ id: uid(), date: isISO(b.date) && b.date <= today ? b.date : today, amount: r2(night.received), method: 'Received on the night' });
      hint = (hint ? hint + ' ' : '') + 'What was handed over on the night comes off.';
    }
    if (dep > 0 && !deal.depositPaid && kind === 'quote') notes = `Deposit: ${fmtDoc(dep, currency())}${deal.depositDue ? ' by ' + dateText(deal.depositDue) : ''}, to confirm the date.`;
  } else if (b.kind === 'session') {
    const rate = num(b.rate);
    switch (b.rateUnit) {
      case 'hour': { const { hours, from } = bookingHours(b); line(`Studio time${at}${when ? ', ' + when : ''}`, hours || 1, 'hour', rate); hint = from === 'clock' ? 'Hours from the session clock.' : from === 'planned' ? `Hours from the planned start and finish${daysSpan(b) > 1 ? `, on each of the ${daysSpan(b)} days` : ''}.` : 'No times on the booking: check the hours.'; break; }
      case 'day': { const n = daysSpan(b); line(`Studio ${n === 1 ? 'day' : 'days'}${at}${when ? ', ' + when : ''}`, n, 'day', rate); break; }
      case 'song': { const songs = songsOf(b); if (songs.length) songs.forEach(s => line(`Production: ${s.title || 'Untitled'}`, 1, 'song', rate)); else line(`Production${at}${when ? ', ' + when : ''}`, 1, 'song', rate); break; }
      default: line(`Studio session${at}${when ? ', ' + when : ''}`, 1, 'session', rate);
    }
    // The players and engineers on the session at their own rates.
    for (const id of Array.isArray(b.people) ? b.people : []) {
      const p = byId('people', id); if (!p || !(num(p.rate) > 0)) continue;
      const { qty, unit } = personQty(p, b);
      line(`${p.group === 'session' || !p.role ? 'Session player' : p.role}: ${p.name}${p.instrument ? ' (' + p.instrument + ')' : ''}`, qty, unit, p.rate);
    }
  } else {
    line(`${bookingTitle(b)}${when ? ', ' + when : ''}`, 1, 'each', b.fee);
    if (!(num(b.fee) > 0)) hint = 'There is no fee on the booking yet: type the amount in.';
  }
  return { lines, payments, notes, hint };
}

// Starts a quote or invoice on a booking: from the booking's suggested lines, from its quote, or blank. Takes the
// next number. Returns the new document, or null.
export function createDoc(bookingId, kind, source = 'booking') {
  const b = byId('bookings', bookingId);
  if (!b) { toast('That booking has been deleted.'); return null; }
  if (docOf(b, kind)) return docOf(b, kind);
  const bl = billing(), today = todayISO(), now = Date.now();
  let lines = [], payments = [], notes = '', taxRate = num(bl.taxRate), taxName = String(bl.taxName || 'Tax');
  if (source === 'quote' && docOf(b, 'quote')) {
    const q = docOf(b, 'quote');
    lines = q.lines.map(l => ({ ...l, id: uid() })); taxRate = num(q.taxRate); taxName = q.taxName || taxName;
    payments = suggestLines(b, kind).payments; // a deposit already paid comes off the invoice
  } else if (source === 'booking') ({ lines, payments, notes } = suggestLines(b, kind));
  let doc = null;
  update(d => {
    const x = d.bookings.find(r => r.id === bookingId); if (!x || x[kind]) return;
    doc = { number: takeNumber(d, kind), status: 'draft', issued: today, due: addDays(today, kind === 'quote' ? num(bl.validDays) || 30 : Math.max(0, num(bl.dueDays))), lines, taxRate, taxName, notes, payments: kind === 'invoice' ? payments : [], createdAt: now, updatedAt: now };
    x[kind] = doc; x.updatedAt = now;
  });
  return doc;
}

export function setStatus(bookingId, kind, status) {
  const doc = docOf(byId('bookings', bookingId), kind); if (!doc) return;
  if (status === 'void' && !confirm(`Void invoice ${doc.number}? It stays on record with its number, but nothing is owed on it.`)) return;
  if (saveDoc(bookingId, kind, { ...doc, status })) toast(`${KINDS[kind].label} ${doc.number}: ${statusLabel(kind, status).toLowerCase()}`);
}
// Deleting an invoice that was sent also unticks "Invoice sent" and "Paid in full": the booking has no invoice now.
export function deleteDoc(bookingId, kind) {
  const b = byId('bookings', bookingId), doc = docOf(b, kind); if (!doc) return false;
  if (!confirm(`Delete ${KINDS[kind].label.toLowerCase()} ${doc.number}? This cannot be undone, and the number is not used again.`)) return false;
  update(d => { const x = d.bookings.find(r => r.id === bookingId); if (x) { delete x[kind]; x.updatedAt = Date.now(); } });
  const ids = CHECKS[b.kind];
  if (kind === 'invoice' && ids && doc.status !== 'draft') { markCheck(bookingId, ids.sent, false); markCheck(bookingId, ids.paid, false); }
  toast(`${KINDS[kind].label} ${doc.number} deleted`);
  return true;
}

/* ------------------------------- payments ------------------------------- */
const METHODS = ['Bank transfer', 'Cash', 'Card', 'PayPal', 'Venmo', 'Cash App', 'Revolut', 'Monzo', 'Cheque', 'Other'];
const methodOptions = () => {
  const bl = billing(), mine = [(bl.iban || bl.accountNumber) && 'Bank transfer', bl.paypal && 'PayPal', bl.venmo && 'Venmo', bl.cashapp && 'Cash App', /monzo/i.test(bl.revolut) ? 'Monzo' : bl.revolut && 'Revolut'].filter(Boolean);
  return [...new Set([...mine, ...METHODS])];
};
export function recordPayment(bookingId) {
  const b = byId('bookings', bookingId), doc = docOf(b, 'invoice'); if (!doc) return;
  const t = calc(doc), opts = methodOptions();
  openForm({
    title: 'Record a payment', saveLabel: 'Record',
    values: { date: todayISO(), amount: t.due > 0 ? r2(t.due) : '', method: opts[0] },
    fields: [
      { key: 'date', label: 'Date received', type: 'date', required: true },
      { key: 'amount', label: `Amount (${currency()})`, type: 'number', min: 0, step: '0.01', required: true, hint: t.due > 0 ? `${fmtMoney(t.due)} still due on ${doc.number}.` : 'Nothing is due on this invoice.' },
      { key: 'method', label: 'How it was paid', type: 'select', options: opts },
    ],
    onSave: v => {
      const cur = docOf(byId('bookings', bookingId), 'invoice'); if (!cur) return toast('That invoice has been deleted.');
      const amount = r2(v.amount); if (!(amount > 0)) return toast('Enter the amount received.');
      const payments = [...cur.payments, { id: uid(), date: v.date || todayISO(), amount, method: v.method || '' }];
      const left = calc({ ...cur, payments, status: 'sent' }).due, all = left <= 0.005;
      saveDoc(bookingId, 'invoice', { ...cur, payments, status: all ? 'paid' : cur.status === 'draft' ? 'sent' : cur.status, paidAt: all ? parseISO(v.date || todayISO()).getTime() : null });
      const over = r2(calc({ ...cur, payments, status: 'sent' }).received - calc(cur).total);
      toast(all ? (over > 0.005 ? `Paid in full: ${cur.number}, with ${fmtMoney(over)} more than the total.` : `Paid in full: ${cur.number}`) : `Payment recorded. ${fmtMoney(left)} still due.`);
    },
  });
}
export function removePayment(bookingId, paymentId) {
  const cur = docOf(byId('bookings', bookingId), 'invoice'); if (!cur) return;
  const p = cur.payments.find(x => x.id === paymentId); if (!p) return;
  if (!confirm(`Remove the payment of ${fmtMoney(p.amount)}${p.date ? ' on ' + dateText(p.date) : ''}?`)) return;
  const payments = cur.payments.filter(x => x.id !== paymentId), open = calc({ ...cur, payments, status: 'sent' }).due > 0.005;
  saveDoc(bookingId, 'invoice', { ...cur, payments, status: open && cur.status === 'paid' ? 'sent' : cur.status });
  toast('Payment removed');
}

/* ------------------------------- the document as the client sees it ------------------------------- */
const profileLines = () => { const p = db.profile || {}; const top = p.business || p.name; return [top, p.business && p.name && p.name !== p.business ? p.name : '', p.address || p.location, p.phone, p.email, p.website].filter(Boolean).map(String); };
// Who the document is for: a show's promoter and venue; a session's artist and contact; anyone else's client.
function partyTo(b) {
  const c = b.contact && typeof b.contact === 'object' ? b.contact : {}, who = c.name ? [c.name, c.role].filter(Boolean).join(', ') : '';
  const venue = venueOf(b).name, act = actName(b.actId) || b.client || '';
  const lines = b.kind === 'show' ? [who, venue] : b.kind === 'session' ? [act, who] : [b.client || who, b.client ? who : ''];
  return [...new Set([...lines, c.email, c.phone].filter(Boolean).map(String))];
}
const payInfo = bl => { const out = {}; for (const [k, src] of [['accountName'], ['bankName'], ['sortCode'], ['accountNumber'], ['iban'], ['bic'], ['paypal'], ['venmo'], ['cashapp'], ['revolut'], ['payLink'], ['payLinkLabel'], ['note', 'payNote']]) { const v = String(bl[src || k] || '').trim(); if (v) out[k] = v; } return out; };
// A self-contained copy of the document: the preview, print, web page, text and the client's link all come from it.
export function snapshot(b, kind) {
  const doc = docOf(b, kind); if (!doc) return null;
  const bl = billing(), sym = currency(), p = db.profile || {};
  return {
    v: 1, kind, number: String(doc.number || ''), status: doc.status || 'draft', issued: doc.issued || '', due: doc.due || '',
    title: bookingTitle(b), when: whenLong(b), from: profileLines(), to: partyTo(b),
    lines: doc.lines.map(({ desc, qty, unit, price }) => ({ desc: desc || '', qty: qty ?? '', unit: unit || '', price: price ?? '' })),
    taxRate: num(doc.taxRate), taxName: doc.taxName || bl.taxName || 'Tax', notes: doc.notes || '',
    payments: kind === 'invoice' ? doc.payments.map(({ date, amount, method }) => ({ date: date || '', amount: num(amount), method: method || '' })) : [],
    currency: sym, code: currencyCode(), email: p.email || '',
    pay: kind === 'invoice' ? payInfo(bl) : {},
  };
}
const current = id => byId('bookings', id);
const DOC_CSS = '.mn-void-stamp{color:#666;border-color:#888}';
// The document drawn for the screen, with any bank QR filled in; resolves once the QR is there (for print and save).
export async function renderReady(b, kind) {
  const pending = [], el = renderDoc(snapshot(b, kind), { qr: qrSvg, pending });
  await Promise.allSettled(pending);
  return el;
}
export async function printDoc(bookingId, kind) {
  const b = current(bookingId); if (!docOf(b, kind)) return;
  printElement(await renderReady(b, kind), '#print-root ' + DOC_CSS);
}
export async function saveWebPage(bookingId, kind) {
  const b = current(bookingId); if (!docOf(b, kind)) return;
  const snap = snapshot(b, kind), el = await renderReady(b, kind);
  if (await saveFile(docPage(docTitle(snap), el, DOC_CSS), fileName(docTitle(snap), 'html'), 'text/html')) toast('Saved as a web page');
}
export const docTextFor = (bookingId, kind) => { const b = current(bookingId); return b && docOf(b, kind) ? docText(snapshot(b, kind)) : ''; };
export async function copyText(bookingId, kind) {
  const text = docTextFor(bookingId, kind); if (!text) return;
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into a message or an email.'); }
  catch { const area = h('textarea', { class: 'share-link', readOnly: true, rows: 12, 'aria-label': 'The document as text' }, text); sheet('The document as text', h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Select the text and copy it.'), area)); setTimeout(() => area.select(), 60); }
}
export function previewDoc(bookingId, kind) {
  const b = current(bookingId); if (!docOf(b, kind)) return;
  const snap = snapshot(b, kind);
  sheet(`${KINDS[kind].label} ${snap.number}`, h('div', { class: 'stack' }, h('div', { class: 'cs-paper mn-paper' }, renderDoc(snap, { qr: qrSvg }))));
}

/* ------------------------------- the client's link and email ------------------------------- */
// The whole document travels inside the link (in the part after #, which browsers never send to a server).
export async function shareLink(bookingId, kind) { const b = current(bookingId); return shareBase() + 'invoice.html#' + await pack(snapshot(b, kind)); }
const safeEmail = e => { const s = String(e || '').trim(); return /^[^\s@,;?&<>"]+@[^\s@,;?&<>"]+$/.test(s) ? s : ''; };
export const contactEmail = b => safeEmail(b && b.contact && b.contact.email);
export function mailtoFor(bookingId, kind, url = '') {
  const b = current(bookingId), doc = docOf(b, kind); if (!doc) return 'mailto:';
  const K = KINDS[kind], snap = snapshot(b, kind), t = calc(snap), p = db.profile || {}, sign = p.name || p.business || '';
  const first = String((b.contact && b.contact.name) || '').trim().split(/\s+/)[0];
  // An overdue invoice gets a polite reminder instead of the first letter.
  const remind = kind === 'invoice' && isOverdue(b);
  const subject = remind ? `Reminder: invoice ${doc.number} – ${fmtDoc(t.due, snap.currency)} due` : `${K.label} ${doc.number} – ${snap.title}`;
  const intro = remind
    ? `Hi${first ? ' ' + first : ''},\n\nA friendly reminder that invoice ${doc.number} for ${snap.title} was due on ${dateText(doc.due)}, and ${fmtDoc(t.due, snap.currency)} is still open.`
    : `Hi${first ? ' ' + first : ''},\n\nHere is ${K.label.toLowerCase()} ${doc.number} for ${snap.title}: ${fmtDoc(t.total, snap.currency)}${kind === 'invoice' && t.paid > 0 && t.due > 0 ? `, with ${fmtDoc(t.due, snap.currency)} still due` : ''}${doc.due && !(kind === 'invoice' && t.due <= 0) ? `, ${K.dueLabel.toLowerCase()} ${dateText(doc.due)}` : ''}.`;
  const text = docText(snap);
  const link = url ? `\n\nYou can see it${kind === 'invoice' && t.due > 0 ? ' and pay' : ''} here:\n${url}` : '';
  const body = `${intro}${link}${!url || url.length + text.length < 1800 ? '\n\n' + text : ''}\n\nThanks${sign ? ',\n' + sign : ''}`;
  return `mailto:${contactEmail(b)}?` + new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
}
export async function openShareSheet(bookingId, kind) {
  const b = current(bookingId), doc = docOf(b, kind); if (!doc) return;
  const K = KINDS[kind];
  let url; try { url = await shareLink(bookingId, kind); } catch (e) { return toast('Could not make the link: ' + (e.message || e)); }
  const area = h('textarea', { id: 'mn-link-text', class: 'share-link', readOnly: true, rows: 4, 'aria-label': `Link to ${K.label.toLowerCase()} ${doc.number}` }, url);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { area.focus(); area.select(); toast('Select the link and copy it'); } };
  const share = async () => { try { await navigator.share({ title: `${K.label} ${doc.number}`, text: `${K.label} ${doc.number} – ${bookingTitle(b)}`, url }); } catch (e) { if (e.name !== 'AbortError') copy(); } };
  const qrBox = h('div', { class: 'share-qr', role: 'img', 'aria-label': 'QR code of the link' });
  qrSvg(url, { cellSize: 2 }).then(svg => { qrBox.innerHTML = svg; }).catch(() => { qrBox.replaceWith(h('p', { class: 'small muted' }, 'This document is too long for a QR code. Send the link instead.')); });
  const email = contactEmail(b);
  sheet('Link for the client', h('div', { class: 'stack mn-share' },
    h('p', { class: 'small muted' }, `The whole ${K.label.toLowerCase()} is inside this link, so nothing is stored online. Anyone with the link can read it, so send it only to your client.${kind === 'invoice' && calc(doc).due > 0 ? ' It opens with Pay buttons for the balance.' : ''}`),
    area,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: 'mn-link-copy', onclick: copy }, '📋 Copy link'),
      navigator.share && h('button', { class: 'btn ghost', type: 'button', onclick: share }, '📤 Share…'),
      h('a', { class: 'btn ghost', href: mailtoFor(bookingId, kind, url), id: 'mn-link-email' }, email ? '✉ Email it' : '✉ Email'),
      h('a', { class: 'btn ghost', href: url, target: '_blank', rel: 'noopener', id: 'mn-link-open' }, 'Open it')),
    !email && h('p', { class: 'small muted' }, 'No email for the contact on this booking yet: add it there and the email is addressed for you.'),
    qrBox, h('p', { class: 'small muted mn-center' }, 'Scan to open it on a phone'),
    h('p', { class: 'small muted' }, 'The link is a copy of the document as it is now. If you change it or record a payment, send a fresh link.')));
}

/* ------------------------------- the editor ------------------------------- */
export const UNITS = ['show', 'set', 'hour', 'half day', 'day', 'song', 'track', 'stem', 'session', 'night', 'mile', 'km', 'each'];
// Edits a document in a sheet: number, status, dates, lines (with live amounts), tax and notes. Nothing is saved
// until Save; Cancel or Escape leaves it as it was.
export function openEditor(bookingId, kind) {
  const b = current(bookingId), doc = docOf(b, kind); if (!doc) return;
  const K = KINDS[kind];
  const w = { lines: doc.lines.map(l => ({ id: l.id || uid(), desc: l.desc ?? '', qty: l.qty ?? '', unit: l.unit ?? '', price: l.price ?? '' })) };
  const field = (id, label, control, cls = '') => h('div', { class: 'field ' + cls }, h('label', { for: id }, label), control);
  const number = h('input', { id: 'mn-ed-number', type: 'text', value: doc.number || '', required: true, autocomplete: 'off', spellcheck: false });
  const status = h('select', { id: 'mn-ed-status' }, K.statuses.map(([v, l]) => h('option', { value: v, selected: v === (doc.status || 'draft') }, l)));
  const issued = h('input', { id: 'mn-ed-issued', type: 'date', value: doc.issued || '' });
  const due = h('input', { id: 'mn-ed-due', type: 'date', value: doc.due || '' });
  const taxName = h('input', { id: 'mn-ed-taxname', type: 'text', value: doc.taxName || billing().taxName || 'Tax', placeholder: 'VAT, GST, sales tax…', autocomplete: 'off' });
  const taxRate = h('input', { id: 'mn-ed-taxrate', type: 'number', min: 0, max: 100, step: 'any', inputMode: 'decimal', value: doc.taxRate ?? '' });
  const notes = h('textarea', { id: 'mn-ed-notes', rows: 3, placeholder: kind === 'quote' ? 'What is included, how long it is valid, the deposit…' : 'Thanks, payment terms, anything the client should know…' }, doc.notes || '');
  const linesBox = h('div', { class: 'mn-lines' }), totals = h('div', { class: 'mn-ed-totals', 'aria-live': 'polite' });
  const unitList = h('datalist', { id: 'mn-units' }, UNITS.map(u => h('option', { value: u })));
  const drawTotals = () => {
    const t = calc({ lines: w.lines, taxRate: taxRate.value, payments: doc.payments, status: 'sent' }), kv = (k, v, cls = '') => h('div', { class: cls }, h('span', null, k), h('b', null, v));
    // replaceChildren() would write a false out as the word "false", so the rows left out are filtered first.
    totals.replaceChildren(...[kv('Subtotal', fmtMoney(t.net)), t.rate > 0 && kv(`${taxName.value.trim() || 'Tax'} ${t.rate}%`, fmtMoney(t.tax)), kv('Total', fmtMoney(t.total), 'mn-strong'),
      kind === 'invoice' && t.received > 0 && kv('Paid so far', fmtMoney(t.received)), kind === 'invoice' && t.received > 0 && kv('Still due', fmtMoney(t.due), 'mn-strong')].filter(Boolean));
  };
  const lineRow = (l, i) => {
    const n = i + 1, amount = h('b', { 'aria-live': 'off' }, fmtMoney(r2(num(l.qty) * num(l.price))));
    const set = (k, el) => { el.addEventListener('input', () => { l[k] = el.value; amount.textContent = fmtMoney(r2(num(l.qty) * num(l.price))); drawTotals(); }); return el; };
    const part = (label, el) => h('label', { class: 'mn-lf' }, h('span', { 'aria-hidden': 'true' }, label), el);
    return h('div', { class: 'mn-line', 'data-line': l.id },
      h('div', { class: 'mn-line-top' },
        set('desc', h('input', { type: 'text', id: `mn-l${n}-desc`, value: l.desc, placeholder: 'What it is', 'aria-label': `Line ${n}: description`, autocomplete: 'off' })),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove line ${n}`, onclick: () => { w.lines.splice(i, 1); drawLines(Math.min(i, w.lines.length - 1)); drawTotals(); } }, '✕')),
      h('div', { class: 'mn-line-nums' },
        part('Qty', set('qty', h('input', { type: 'number', id: `mn-l${n}-qty`, value: l.qty, step: 'any', inputMode: 'decimal', 'aria-label': `Line ${n}: quantity` }))),
        part('Unit', set('unit', h('input', { type: 'text', id: `mn-l${n}-unit`, value: l.unit, list: 'mn-units', placeholder: 'hour, show…', 'aria-label': `Line ${n}: unit (hour, show, song…)`, autocomplete: 'off' }))),
        part(`Price (${currency()})`, set('price', h('input', { type: 'number', id: `mn-l${n}-price`, value: l.price, step: 'any', inputMode: 'decimal', 'aria-label': `Line ${n}: price each (${currency()})` }))),
        h('div', { class: 'mn-lf mn-line-amt', 'aria-label': `Line ${n} amount` }, h('span', { 'aria-hidden': 'true' }, 'Amount'), amount)));
  };
  const drawLines = focusAt => {
    linesBox.replaceChildren(...(w.lines.length ? w.lines.map(lineRow) : [h('p', { class: 'muted small' }, 'No lines yet. Add one, or pick from your price list.')]));
    if (focusAt != null) { const el = linesBox.querySelector(focusAt >= 0 ? `#mn-l${focusAt + 1}-desc` : 'input') || box.querySelector('#mn-ed-addline'); el && el.focus(); }
  };
  const addLine = () => { w.lines.push({ id: uid(), desc: '', qty: 1, unit: 'each', price: '' }); drawLines(w.lines.length - 1); drawTotals(); };
  const fromList = () => pickFromPriceList(current(bookingId) || b, picked => { w.lines.push(...picked); drawLines(); drawTotals(); toast(`${plural(picked.length, 'line')} added`); });
  taxRate.addEventListener('input', drawTotals); taxName.addEventListener('input', drawTotals);
  let close = () => {};
  const save = () => {
    const now = current(bookingId), cur = docOf(now, kind);
    if (!cur) { close(); return toast(`That ${K.label.toLowerCase()} has been deleted.`); }
    const nb = number.value.trim();
    if (!nb) { number.focus(); return toast('Give it a number.'); }
    if (nb !== cur.number && usedNumbers(db, [bookingId, kind]).has(nb)) { number.focus(); return toast(`${nb} is already on another document. Each number is used once.`); }
    const lines = w.lines.map(l => {
      const price = l.price === '' || l.price == null || !Number.isFinite(Number(l.price)) ? '' : Number(l.price);
      const qty = l.qty === '' || l.qty == null || !Number.isFinite(Number(l.qty)) ? (price !== '' ? 1 : '') : Number(l.qty);
      return { id: l.id || uid(), desc: String(l.desc || '').trim(), qty, unit: String(l.unit || '').trim(), price };
    }).filter(l => l.desc || (l.price !== '' && l.price !== 0));
    const rate = Math.max(0, Math.min(100, num(taxRate.value)));
    const next = { ...cur, number: nb, status: status.value, issued: issued.value, due: due.value, lines, taxRate: rate, taxName: taxName.value.trim() || 'Tax', notes: notes.value.trim() };
    // Payments that cover the total make it paid; and an invoice the payments had paid in full opens again when the
    // edit raises the total above them (one marked paid by hand without the payments to match stays paid).
    const open = kind === 'invoice' ? calc({ ...next, status: 'sent' }).due : 0;
    if (kind === 'invoice' && next.status !== 'paid' && next.status !== 'void' && cur.payments.length && open <= 0.005) next.status = 'paid';
    const reopened = kind === 'invoice' && cur.status === 'paid' && next.status === 'paid' && cur.payments.length && open > 0.005 && calc({ ...cur, status: 'sent' }).due <= 0.005;
    if (reopened) next.status = 'sent';
    close();
    if (saveDoc(bookingId, kind, next)) toast(reopened ? `${K.label} ${nb} saved. It is not paid in full any more: ${fmtMoney(open)} still due.` : `${K.label} ${nb} saved`);
  };
  const box = h('form', { class: 'stack mn-editor', novalidate: true, onsubmit: e => { e.preventDefault(); save(); } },
    h('div', { class: 'mn-pair' }, field('mn-ed-number', `${K.label} number`, number), field('mn-ed-status', 'Status', status), field('mn-ed-issued', 'Date', issued), field('mn-ed-due', K.dueLabel, due)),
    h('h4', { class: 'mn-ed-head' }, 'Lines'),
    unitList, linesBox,
    h('div', { class: 'actions mn-ed-add' },
      h('button', { type: 'button', class: 'btn ghost small', id: 'mn-ed-addline', onclick: addLine }, '+ Add a line'),
      h('button', { type: 'button', class: 'btn ghost small', id: 'mn-ed-fromlist', onclick: fromList }, '+ From the price list')),
    h('div', { class: 'mn-pair mn-ed-tax' }, field('mn-ed-taxname', 'Tax name', taxName), field('mn-ed-taxrate', 'Tax rate (%)', taxRate)),
    totals,
    field('mn-ed-notes', 'Notes on the document', notes, 'wide'),
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'btn danger', onclick: () => { if (deleteDoc(bookingId, kind)) close(); } }, 'Delete'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  drawLines(); drawTotals();
  ({ close } = sheet(`Edit the ${kind}`, box, { dismissOnBackdrop: false }));
  setTimeout(() => { if (!box.contains(document.activeElement)) number.focus({ preventScroll: true }); }, 60);
}

/* ------------------------------- the price list ------------------------------- */
// The person's own rates: [{ id, desc, unit, price }]. It starts empty: these are ideas to add, with no prices.
export const PRICE_IDEAS = [['Show fee', 'show'], ['Extra set', 'set'], ['Studio time', 'hour'], ['Half day in the studio', 'half day'], ['Production', 'song'], ['Mixing', 'song'], ['Stem mix', 'song'], ['Mastering', 'track'], ['Session musician', 'song'], ['Session musician', 'day'], ['Backline hire', 'day'], ['Travel', 'each']];
const per = u => (!u || u === 'each' ? 'each' : 'per ' + u);
const priceOk = p => p !== '' && p != null && Number.isFinite(Number(p));
const priceText = i => (priceOk(i.price) ? `${fmtMoney(i.price)} ${per(i.unit)}` : `no price yet · ${per(i.unit)}`);
export const priceItems = () => (db.priceList && Array.isArray(db.priceList.list) ? db.priceList.list : []).filter(i => i && typeof i === 'object' && i.id).map(i => ({ id: String(i.id), desc: String(i.desc ?? ''), unit: String(i.unit || 'each'), price: priceOk(i.price) ? Number(i.price) : '' }));
// Changes the list as it is now (another device may have synced a newer one since the panel was drawn).
const changePrices = fn => update(d => { d.priceList = { ...(d.priceList && typeof d.priceList === 'object' ? d.priceList : {}), list: fn(priceItems()), updatedAt: Date.now() }; });
const sameLine = (a, b) => a.desc.trim().toLowerCase() === b.desc.trim().toLowerCase() && (a.unit || 'each') === (b.unit || 'each');

function editPrice(item, isNew, onDone) {
  openForm({
    title: isNew ? 'Add to the price list' : 'Edit price',
    values: { desc: item.desc || '', price: item.price ?? '', unit: item.unit || 'each' },
    fields: [
      { key: 'desc', label: 'Line on the quote or invoice', required: true, placeholder: 'e.g. Show fee, Studio time, Mixing' },
      { key: 'price', label: `Price (${currency()})`, type: 'number', min: 0, step: 'any', hint: 'Leave it blank to fill in on each quote.' },
      { key: 'unit', label: 'Per', list: UNITS, placeholder: 'hour, show, song…', hint: 'Hours, days and songs fill in from the booking when you pick it.' },
    ],
    saveLabel: isNew ? 'Add' : 'Save',
    onSave: v => {
      const next = { id: item.id || uid(), desc: String(v.desc || '').trim(), unit: String(v.unit || 'each').trim() || 'each', price: v.price === '' || v.price == null ? '' : Number(v.price) };
      if (!next.desc) return toast('Give the line a name.');
      changePrices(list => (list.some(i => i.id === next.id) ? list.map(i => (i.id === next.id ? next : i)) : [...list, next]));
      toast(isNew ? 'Added to the price list' : 'Price saved'); onDone && onDone(next.id);
    },
    onDelete: isNew ? null : () => { changePrices(list => list.filter(i => i.id !== item.id)); toast('Removed from the price list'); onDone && onDone(null); },
  });
}
// The editor for Settings (and the sheet opened from a quote). Redraws itself after its own changes.
export function priceListPanel() {
  const wrap = h('div', { class: 'stack mn-prices' });
  const draw = focusId => {
    const list = priceItems(), ideas = PRICE_IDEAS.filter(([desc, unit]) => !list.some(i => sameLine(i, { desc, unit })));
    wrap.replaceChildren(...[
      h('p', { class: 'small muted' }, 'The things you charge for again and again, with your prices. Pick them into any quote or invoice with “+ From the price list”; hours, days and songs fill in from the booking.'),
      list.length ? h('div', { class: 'stack' }, ...list.map(i => h('button', { class: 'card tap price-item', type: 'button', 'data-id': i.id, 'aria-label': `${i.desc}, ${priceText(i)}. Edit`, onclick: () => editPrice(i, false, id => draw(id || 'add')) },
        h('strong', null, i.desc || '—'), h('span', { class: 'muted small' }, priceText(i)))))
        : h('p', { class: 'muted mn-prices-empty' }, 'Your price list is empty.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', 'data-id': 'add', id: 'mn-price-add', onclick: () => editPrice({ unit: 'each' }, true, id => draw(id)) }, '+ Add a line')),
      ideas.length && h('div', { class: 'mn-ideas' }, h('p', { class: 'small muted' }, list.length ? 'More ideas (tap one, then type your price):' : 'Ideas to start from (tap one, then type your price):'),
        h('div', { class: 'mn-chips' }, ...ideas.map(([desc, unit]) => h('button', { class: 'chip', type: 'button', 'data-id': `idea-${desc}-${unit}`, 'aria-label': `Add ${desc}, ${per(unit)}`, onclick: () => editPrice({ desc, unit, price: '' }, true, id => draw(id)) }, `${desc} · ${per(unit)}`)))),
    ].filter(Boolean));
    if (focusId) setTimeout(() => { const el = wrap.querySelector(`[data-id="${CSS.escape(focusId)}"]`) || wrap.querySelector('[data-id="add"]'); if (el && el.isConnected) el.focus(); }, 0);
  };
  draw();
  return wrap;
}
export const openPriceList = onClose => sheet('Price list', priceListPanel(), { onClose });
// How many of a price-list line a booking needs: its hours, days or songs.
const qtyFor = (unit, b) => (unit === 'hour' ? bookingHours(b).hours || 1 : unit === 'song' || unit === 'track' || unit === 'stem' ? songsOf(b).length || 1 : unit === 'day' ? daysSpan(b) : 1);
// The picker on a quote or invoice: tick lines, add them. onPick(lines).
export function pickFromPriceList(b, onPick) {
  const body = h('div', { class: 'stack price-picker' });
  let close = () => {};
  const draw = () => {
    const list = priceItems(), chosen = new Set();
    const add = h('button', { class: 'btn primary', type: 'button', id: 'mn-pick-add', disabled: true }, 'Add lines');
    const count = () => { add.disabled = !chosen.size; add.textContent = chosen.size ? `Add ${plural(chosen.size, 'line')}` : 'Add lines'; };
    add.addEventListener('click', () => {
      const lines = list.filter(i => chosen.has(i.id)).map(i => ({ id: uid(), desc: i.desc, qty: qtyFor(i.unit, b), unit: i.unit || 'each', price: i.price }));
      if (!lines.length) return; close(); onPick(lines);
    });
    const edit = h('button', { class: 'btn ghost', type: 'button', onclick: () => openPriceList(draw) }, list.length ? 'Edit the price list' : 'Set up the price list');
    body.replaceChildren(...[
      list.length ? h('div', { class: 'stack price-group' }, ...list.map(i => h('label', { class: 'check price-pick' },
        h('input', { type: 'checkbox', 'aria-label': `${i.desc}, ${priceText(i)}`, onchange: e => { if (e.target.checked) chosen.add(i.id); else chosen.delete(i.id); count(); } }),
        h('span', { class: 'price-pick-text' }, h('span', null, i.desc || '—'), h('em', null, `${priceText(i)} · ${qtyText(qtyFor(i.unit, b), i.unit)} on this booking`)))))
        : h('p', { class: 'muted' }, 'Your price list is empty. Add the things you charge for (show fee, studio time, mixing per song…) once, and pick them into any quote or invoice.'),
      h('div', { class: 'form-actions' }, list.length ? add : null, h('span', { class: 'spacer' }), edit),
    ]);
  };
  draw();
  ({ close } = sheet('Add from the price list', body));
}

/* ------------------------------- settings ------------------------------- */
// Numbering, tax, terms and payment details: one panel for Settings. Every box saves as it changes.
export function billingPanel() {
  const bl = billing(), sym = currency();
  // need: a number box that cannot be left blank (the numbering counters: a blank would start them again at 1).
  const input = (key, label, type = 'text', { hint, whole, need, ...attrs } = {}) => {
    const id = 'mn-bl-' + key;
    const el = type === 'textarea'
      ? h('textarea', { id, rows: 2, placeholder: attrs.placeholder || '', onchange: e => setBilling({ [key]: e.target.value.trim() }) }, bl[key] ?? '')
      : h('input', { id, type, value: bl[key] ?? '', autocomplete: 'off', inputMode: type === 'number' ? 'decimal' : null, ...attrs, onchange: e => {
        if (type !== 'number') {
          const v = e.target.value.trim();
          if (key === 'payLink' && v && !/^https:\/\/\S+$/i.test(v)) { toast('A payment page link starts with https://'); e.target.value = billing()[key] ?? ''; return; }
          return setBilling({ [key]: v });
        }
        const v = e.target.value === '' ? '' : Number(e.target.value);
        if (v === '' ? need : (!Number.isFinite(v) || (attrs.min != null && v < attrs.min) || (attrs.max != null && v > attrs.max))) {
          toast(`${label}: enter a number${attrs.min != null ? ' from ' + attrs.min : ''}${attrs.max != null ? ' to ' + attrs.max : ' or more'}.`);
          e.target.value = billing()[key] ?? ''; return;
        }
        setBilling({ [key]: whole && v !== '' ? Math.floor(v) : v });
      } });
    return h('div', { class: 'field' + (type === 'textarea' ? ' wide' : '') }, h('label', { for: id }, label), el, hint && h('small', { class: 'muted' }, hint));
  };
  const cur = bl.currencyCode, auto = codeFor(sym);
  const codeSel = h('select', { id: 'mn-bl-currencyCode', onchange: e => setBilling({ currencyCode: e.target.value }) },
    h('option', { value: '', selected: !cur }, `From my currency symbol (${auto})`), ...CURRENCIES.map(([c, s]) => h('option', { value: c, selected: c === cur }, `${c} ${s}`)));
  return h('div', { class: 'stack mn-billing' },
    h('p', { class: 'small muted' }, 'Your name, business, address, phone and email on quotes and invoices come from your profile.'),
    h('h4', { class: 'mn-bl-head' }, 'Numbering'),
    h('div', { class: 'mn-pair' },
      input('quotePrefix', 'Quote prefix', 'text', { placeholder: 'Q-' }), input('nextQuote', 'Next quote number', 'number', { min: 1, step: 1, whole: true, need: true }),
      input('invoicePrefix', 'Invoice prefix', 'text', { placeholder: 'INV-' }), input('nextInvoice', 'Next invoice number', 'number', { min: 1, step: 1, whole: true, need: true })),
    h('p', { class: 'small muted', id: 'mn-bl-next' }, `The next quote is ${nextNumber('quote').number} and the next invoice ${nextNumber('invoice').number}. Each number is used once: deleting a document never gives its number out again.`),
    h('h4', { class: 'mn-bl-head' }, 'Tax and terms'),
    h('div', { class: 'mn-pair' },
      input('taxName', 'Tax name', 'text', { placeholder: 'VAT, GST, sales tax…' }), input('taxRate', 'Tax rate (%)', 'number', { min: 0, max: 100, step: 'any', hint: '0 if you don’t charge it.' }),
      input('dueDays', 'Invoices due after (days)', 'number', { min: 0, step: 1, whole: true }), input('validDays', 'Quotes valid for (days)', 'number', { min: 1, step: 1, whole: true })),
    h('h4', { class: 'mn-bl-head' }, 'Getting paid'),
    h('p', { class: 'small muted' }, 'Every invoice gets a Pay button for each of these with the amount and invoice number filled in where the service allows it, and your bank details with a QR code. Leave out anything you don’t use.'),
    h('h5', { class: 'mn-bl-sub' }, 'Bank transfer'),
    h('div', { class: 'mn-pair' },
      input('accountName', 'Account name'), input('bankName', 'Bank'),
      input('sortCode', 'Sort code / routing'), input('accountNumber', 'Account number'),
      input('iban', 'IBAN'), input('bic', 'BIC / SWIFT')),
    h('p', { class: 'small muted' }, 'With an IBAN, European banking apps can scan the invoice’s QR code to fill in the transfer.'),
    h('h5', { class: 'mn-bl-sub' }, 'Payment apps'),
    h('div', { class: 'mn-pair' }, input('paypal', 'PayPal.me username', 'text', { placeholder: 'yourname' }), input('venmo', 'Venmo username', 'text', { placeholder: 'yourname' })),
    h('div', { class: 'grid2' },
      input('cashapp', 'Cash App $cashtag', 'text', { placeholder: '$yourname' }), input('revolut', 'Revolut or Monzo link', 'text', { placeholder: 'https://revolut.me/yourname' }),
      input('payLink', 'Payment page link', 'text', { inputMode: 'url', placeholder: 'https://…', hint: 'A card payment page (Stripe, Square…). {amount} and {reference} in it are filled in.' }), input('payLinkLabel', 'Its button says', 'text', { placeholder: 'Pay by card' }),
      h('div', { class: 'field' }, h('label', { for: 'mn-bl-currencyCode' }, 'Currency for payment links'), codeSel)),
    input('payNote', 'Payment note (on every invoice)', 'textarea', { placeholder: 'e.g. Thank you! Payment within 14 days, please.' }));
}

/* ------------------------------- walkthroughs for the sheets ------------------------------- */
const editorSteps = kind => [
  { title: `${KINDS[kind].label} number and dates`, text: 'The number comes from your numbering in Settings and is used only once. The status changes as you send it and get paid.', target: ['#mn-ed-number'] },
  { title: 'Lines', text: 'What you charge for: a description, how many, the unit (hour, show, song…) and the price each. The amount adds up as you type.', target: ['.mn-lines'] },
  { title: 'Add more', text: 'Add a blank line, or pick from your price list: the hours, days and songs fill in from the booking.', target: ['.mn-ed-add'] },
  { title: 'Tax', text: 'The tax name and rate go on the document. Leave the rate at 0 if you don’t charge it.', target: ['.mn-ed-tax'] },
  { title: 'Totals', text: 'The subtotal, tax and total update as you edit. Save when it looks right; Cancel leaves it as it was.', target: ['.mn-ed-totals'] },
];
sheetTutorial('Edit the invoice', () => editorSteps('invoice'));
sheetTutorial('Edit the quote', () => editorSteps('quote'));
sheetTutorial('Add from the price list', [
  { title: 'Pick lines', text: 'Tick what this booking needs. The quantity comes from the booking: its hours, days or songs.', target: ['.price-group'] },
  { title: 'Add them', text: 'They go onto the document, where you can change anything before you save.', target: ['#mn-pick-add'] },
]);
sheetTutorial('Price list', [
  { title: 'Your rates', text: 'Each line is something you charge for, with your price and what it is per.', target: ['.mn-prices .price-item', '.mn-prices-empty'] },
  { title: 'Ideas', text: 'Tap an idea to add it, then type your price.', target: ['.mn-ideas'] },
]);
sheetTutorial('Record a payment', [
  { title: 'A payment', text: 'The date it arrived, the amount (the balance is filled in) and how it was paid. Part payments are fine: the invoice shows what is still due, and paid in full ticks the checklist.', target: ['.form'] },
]);
sheetTutorial('Link for the client', [
  { title: 'The link', text: 'The whole document is inside the link. Copy it into a message, or email it.', target: ['#mn-link-text'] },
  { title: 'Send it', text: 'Copy, share or email the link. The client opens it on any phone or computer, with Pay buttons for the balance.', target: ['#mn-link-copy'] },
]);

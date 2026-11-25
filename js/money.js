// Quotes and invoices, one of each per booking. Lines are suggested from the booking (shoot days, crew with their
// day rates, kit, the deliverables a template put there) or, for the invoice, copied from the quote or built from the
// hours logged; the user edits them. Printed from the app, saved as PDF, emailed to the client's contacts, and
// summed up on the Money overview. Rates, the price list, numbering, tax and payment terms live in Settings → Work & billing → Quotes &
// invoices.
import { h, sheet, toast, nodes, fmtShort, fmtLong, todayISO, parseISO, ymd, uid, backBtn, parseRate, personRate } from './util.js';
export { parseRate };
import { db, byId, upsert, update, endOf, requirePaid } from './store.js';
import { openForm } from './form.js';
import { setCheck, itemId, hiredPeople, rentalsOf } from './workflow.js';
import { stats, workedMs, standardDay } from './hours.js';
import { saveOrShare, csvCell, csvText } from './backup.js';
import { printElement, htmlDocument } from './callsheet.js';
import { KINDS, calc, renderDoc, docText, pdfBlocks, docTitle, payButtons, fmtDate } from './money-doc.js';
import { CURRENCIES, knownCode, amountStr, PAY_TYPES, typeOf, summaryOf, methodsOf } from './pay.js';
// The QR library and the link packer load only when a document with a bank QR is drawn or a link is made.
const qrSvg = (text, opts) => import('./qr.js').then(m => m.qrSvg(text, opts));
const pack = obj => import('./link-pack.js').then(m => m.pack(obj));
import { SITE } from './version.js';
export { KINDS };

const DEF = { quotePrefix: 'Q-', invoicePrefix: 'INV-', nextQuote: 1, nextInvoice: 1, taxLabel: 'VAT', taxRate: 0, validDays: 30, dueDays: 14, terms: 'Payment within 14 days of the invoice date.', payment: '', dayRate: '', hourRate: '', overtimeRate: '', kitRate: '',
  currencyCode: '', payMethods: null, paypalMe: '', venmo: '', cashtag: '', payLink: '', payLinkLabel: '', upi: '', accountName: '', iban: '', bic: '' };
// The ways to get paid as a list (older fixed fields are read into it).
export const payMethods = () => methodsOf(billing());
export const billing = () => ({ ...DEF, ...(db.billing || {}) });
export const setBilling = patch => update(d => { d.billing = { ...DEF, ...(d.billing || {}), ...patch, updatedAt: Date.now() }; });
const sym = () => db.profile.currency || '$';
// The currency a payment link asks in: the one chosen under Getting paid, else the one the profile's symbol plainly
// means, else none ('': the link then leaves the currency to the payment service), never a guess.
const code = () => billing().currencyCode || knownCode(sym());
export const fmtMoney = n => { const v = Number(n) || 0; return (v < 0 ? '-' : '') + sym() + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
export const docOf = (b, kind) => (b && b[kind] ? { lines: [], ...b[kind] } : null);
// Lines, tax, total, what has been paid (deposit plus recorded payments) and the balance due.
export const totals = (doc, kind = 'invoice') => calc({ ...(doc || {}), kind });
export function nextNumber(kind) {
  const bl = billing(), prefix = kind === 'quote' ? bl.quotePrefix : bl.invoicePrefix, floor = Number(kind === 'quote' ? bl.nextQuote : bl.nextInvoice) || 1;
  const used = db.bookings.map(b => b[kind] && b[kind].number).filter(Boolean).map(n => (String(n).startsWith(prefix) ? parseInt(String(n).slice(prefix.length), 10) : NaN)).filter(Number.isFinite);
  return prefix + String(Math.max(floor, ...used.map(x => x + 1))).padStart(4, '0');
}
const shootDays = b => Math.max(1, Math.round((parseISO(endOf(b)) - parseISO(b.date)) / 864e5) + 1);
const addDays = (iso, n) => { const d = parseISO(iso); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
export const isOverdue = b => { const inv = docOf(b, 'invoice'); return !!(inv && inv.status === 'Sent' && inv.due && inv.due < todayISO() && totals(inv).balance > 0); };
const num = v => (v === '' || v == null ? '' : Number(v));
// The amount in a typed cost ("$120", "1.200,50 €"); the parser lives in util.js. A person's hourly rate is quoted for a
// standard day's hours (Settings → Work & billing → Hours & breaks) per shoot day.
export const rateOf = r => parseRate(r).amount;
// A cost kept as a number (the Cost box of a rental or a licence) is that number: read as typed text, 85.125 would be
// taken for eighty-five thousand, the dot for a thousands mark.
const costOf = c => (typeof c === 'number' ? c : rateOf(c));

// The people hired for a job who belong in its money. A booking added from someone's shared link (js/share-import.js)
// carries that producer's whole crew as its hires, to read and to call: they are not one's own costs or charges, so
// the ones the link made are left out until one is given a rate. (To count them all again, return hiredPeople(b).)
// The same goes for the deliverables the link brought: they are what the producer owes their client, so they are not
// suggested as lines of one's own quote or invoice; a deliverable added by hand is. (ownDeliverables below; to suggest
// them all again, return b.deliverables.) A line counts as the link's by its mark, or by its id in shared.rows (a form
// writes a line anew without the mark).
const linkMade = (b, x, rows = 'hires') => x.shared === true || !!(b.shared && b.shared.rows && (b.shared.rows[rows] || []).includes(x.id));
const paidHires = b => hiredPeople(b).filter(hr => !(linkMade(b, hr) && (hr.rate === '' || hr.rate == null)));
const ownDeliverables = b => (b.deliverables || []).filter(x => x && !linkMade(b, x, 'deliverables'));

// Suggested lines: from the booking, from the quote, or from the hours logged. Each carries where it comes from (src:
// the shoot days, a crew member, the kit, a deliverable, a rental, the editing hours…), which never leaves the app, so
// that asking again after the booking or the hours changed brings the line it made up to date instead of adding a
// second one beside it.
export function suggestLines(b, kind, source = 'booking') {
  const bl = billing(), days = shootDays(b), lines = [];
  const line = (src, desc, qty, unit, price) => lines.push({ id: uid(), desc, qty, unit, price: num(price), src });
  if (source === 'quote') return ((b.quote && b.quote.lines) || []).map(l => ({ ...l, id: uid(), src: l.src || 'q:' + l.id }));
  if (source === 'hours') {
    const shifts = db.shifts.filter(s => s.bookingId === b.id && s.end);
    const shoot = shifts.filter(s => (s.kind || 'shoot') === 'shoot'), edit = shifts.filter(s => s.kind === 'edit');
    const sd = new Set(shoot.map(s => s.date)).size;
    if (sd) line('shoot', `Shoot day${sd === 1 ? '' : 's'} — ${b.title}`, sd, 'day', bl.dayRate);
    const editH = Math.round(edit.reduce((t, s) => t + workedMs(s), 0) / 36e5 * 4) / 4;
    if (editH) line('hours:edit', 'Editing', editH, 'hour', bl.hourRate);
    const ot = Math.round(stats(shoot).overtime / 36e5 * 4) / 4;
    if (ot) line('hours:ot', 'Overtime on shoot days', ot, 'hour', bl.overtimeRate || bl.hourRate);
    return lines;
  }
  line('shoot', `Shoot day${days === 1 ? '' : 's'} — ${b.title}`, days, 'day', bl.dayRate);
  for (const id of b.crew || []) { const c = byId('crew', id); if (c) { const r = personRate(c); line('crew:' + id, `Crew: ${c.name}${c.role ? ' (' + c.role + ')' : ''}`, r.hourly ? days * standardDay() : days, r.hourly ? 'hour' : 'day', r.amount); } }
  for (const hr of paidHires(b)) { const r = personRate(hr), n = Number(hr.days) || days; line('person:' + hr.id, `Crew: ${hr.name}${hr.role ? ' (' + hr.role + ')' : ''}`, r.hourly ? n * standardDay() : n, r.hourly ? 'hour' : 'day', r.amount); }
  if ((b.gear || []).length || (b.kits || []).length) line('kit', 'Equipment package', days, 'day', bl.kitRate);
  for (const dl of ownDeliverables(b)) line('deliv:' + dl.id, `${dl.name}${dl.duration ? ' (' + dl.duration + ')' : ''}`, 1, 'each', '');
  if (kind === 'invoice') for (const hr of rentalsOf(b)) line('hire:' + hr.id, `Hire: ${hr.item}${hr.from ? ' (' + hr.from + ')' : ''}`, 1, 'each', hr.cost);
  return lines;
}
// Suggested lines put onto a document that already has lines. A suggestion and a line are the same thing when they
// carry the same src; a line from before lines carried one is known by what it says (the shoot days, the editing
// hours, the overtime and the kit by their wording, anything else by the same description). From the booking or the
// hours, the line already there takes the new quantity; from the quote, only what is missing is added.
const SHOOT_LINE = /^Shoot days? — /;
const srcOf = l => l.src || (SHOOT_LINE.test(l.desc || '') ? 'shoot' : l.desc === 'Editing' && l.unit === 'hour' ? 'hours:edit' : l.desc === 'Overtime on shoot days' ? 'hours:ot' : l.desc === 'Equipment package' ? 'kit' : '');
export function mergeSuggested(lines, suggested, source) {
  const out = (lines || []).map(l => ({ ...l })), low = l => (l.desc || '').trim().toLowerCase(); let added = 0, updated = 0;
  for (const sg of suggested) {
    let i = out.findIndex(l => srcOf(l) === sg.src);
    if (i < 0) i = out.findIndex(l => !srcOf(l) && low(l) === low(sg));
    if (i < 0) { out.push(sg); added++; continue; }
    if (source === 'quote') continue;
    const l = out[i], next = { ...l, src: sg.src, qty: sg.qty, unit: sg.unit, desc: sg.src === 'shoot' && SHOOT_LINE.test(l.desc || '') ? sg.desc : l.desc };
    if (Number(l.qty) !== Number(sg.qty) || (l.unit || '') !== (sg.unit || '') || l.desc !== next.desc) updated++;
    out[i] = next;
  }
  return { lines: out, added, updated };
}

function saveDoc(id, kind, doc) {
  const prev = docOf(byId('bookings', id), kind) || {}, now = Date.now();
  const next = { ...doc, taxLabel: String(doc.taxLabel || '').trim() || billing().taxLabel, updatedAt: now };
  // The dates follow the status: an invoice taken back from Paid has no paid date, and a document taken back to Draft
  // was not sent.
  if (next.status === 'Draft') next.sentAt = null;
  if (next.status === 'Sent' && prev.status !== 'Sent' && !next.sentAt) next.sentAt = now;
  if (kind === 'quote' && next.status === 'Accepted' && !next.acceptedAt) next.acceptedAt = now;
  if (kind === 'invoice' && next.status !== 'Paid') next.paidAt = null;
  if (kind === 'invoice' && next.status === 'Paid' && !next.paidAt) next.paidAt = now;
  const cur = { ...byId('bookings', id), [kind]: next }; delete cur[kind + 'GoneAt']; // the mark a deleted document left (see the form's Delete)
  upsert('bookings', cur);
  // A number that has gone out is never proposed again, also after its booking or the document is deleted: the
  // "next number" in the settings moves past it. (A draft's number is still free.)
  if (next.status !== 'Draft') {
    const bl = billing(), prefix = kind === 'quote' ? bl.quotePrefix : bl.invoicePrefix, key = kind === 'quote' ? 'nextQuote' : 'nextInvoice';
    const n = String(next.number || '').startsWith(prefix) && /^\d+$/.test(String(next.number).slice(prefix.length)) ? parseInt(String(next.number).slice(prefix.length), 10) : NaN;
    if (Number.isFinite(n) && n + 1 > (Number(bl[key]) || 1)) setBilling({ [key]: n + 1 });
  }
  const b = byId('bookings', id);
  if (kind === 'quote' && ['Sent', 'Accepted'].includes(next.status)) setCheck(b, itemId('Quoted', 'Quote / estimate sent'), true);
  if (kind === 'invoice' && ['Sent', 'Paid'].includes(next.status)) setCheck(b, itemId('Delivered', 'Final invoice sent'), true);
  if (kind === 'invoice' && next.status === 'Paid') setCheck(b, itemId('Delivered', 'Paid'), true);
}
export const setDocStatus = (id, kind, status) => { const doc = docOf(byId('bookings', id), kind); if (doc) { saveDoc(id, kind, { ...doc, status }); toast(`${KINDS[kind].label} marked ${status.toLowerCase()}`); } };

export function editMoney(b, kind, onDone, preset) {
  const K = KINDS[kind], bl = billing(), cur = docOf(b, kind);
  // Invoices due in 0 days are due on receipt: only an empty box falls back to 14 (a quote is valid for a day at least).
  const set = kind === 'quote' ? bl.validDays : bl.dueDays, given = set !== '' && set != null && Number.isFinite(Number(set));
  const days = kind === 'quote' ? (given && Number(set) > 0 ? Number(set) : 30) : (given && Number(set) >= 0 ? Number(set) : 14);
  const base = cur || { number: nextNumber(kind), date: todayISO(), [K.dateKey]: addDays(todayISO(), days), lines: [], taxRate: bl.taxRate, taxLabel: bl.taxLabel, notes: kind === 'invoice' ? bl.terms : '', status: 'Draft', deposit: '' };
  const values = { ...base, ...(preset || {}) };
  openForm({
    title: cur ? `Edit ${K.label.toLowerCase()}` : `New ${K.label.toLowerCase()}`,
    values,
    fields: [
      { key: 'number', label: `${K.label} number`, required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: K.dateKey, label: K.dateLabel, type: 'date' },
      { key: 'lines', label: 'Lines', type: 'rows', columns: [{ key: 'desc', label: 'Description' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'unit', label: 'Unit' }, { key: 'price', label: `Price (${sym()})`, type: 'number' }], hint: 'Quantity × price per line. Units are free text: day, hour, each…' },
      { key: 'taxLabel', label: 'Tax name', placeholder: bl.taxLabel || 'VAT, GST, Sales tax…', hint: `Printed on this ${K.label.toLowerCase()} beside the rate.` },
      { key: 'taxRate', label: 'Tax rate (%)', type: 'number', min: 0, step: 'any', hint: '0 if you don’t charge it.' },
      ...(kind === 'invoice' ? [{ key: 'deposit', label: 'Already paid / deposit', type: 'number', min: 0, step: 'any' }] : []),
      { key: 'status', label: 'Status', type: 'select', options: K.statuses },
      { key: 'notes', label: kind === 'quote' ? 'What is included / notes' : 'Payment terms / notes', type: 'textarea', rows: 3 },
    ],
    onSave: v => { saveDoc(b.id, kind, { ...values, ...v, lines: (v.lines || []).map(l => ({ ...l, id: l.id || uid() })) }); toast(`${K.label} saved`); onDone && onDone(); },
    onDelete: cur ? () => { update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { delete x[kind]; x[kind + 'GoneAt'] = x.updatedAt = Date.now(); } }); toast(`${K.label} removed`); onDone && onDone(); } : null,
  });
}

/* --------------------------------- documents --------------------------------- */
const dateLabel = b => (endOf(b) > b.date ? `${fmtLong(b.date)} → ${fmtLong(endOf(b))}` : fmtLong(b.date));
const partyLines = () => { const p = db.profile; return [p.business || p.name, p.business && p.name ? p.name : null, p.phone, p.email, p.website, p.location].filter(Boolean); };
// Who a quote or an invoice goes to: the name it is headed to, and the booking's contacts who are named under it and
// emailed. Usually the booking's client and all its contacts. A booking added from someone's shared link is different:
// the person who shared it (the producer) hired you, so your quote and invoice go to them, not to their client. On
// such a booking the contacts the link brought, other than the producer, are left out (b.shared.contacts names them);
// contacts added by hand count as always; and while the client is still the one the link supplied, the document is
// headed to the producer (their business when the link gave one, else their name). Change the client on the booking
// and it heads the document again. The client's name stays on the booking and the call sheet either way.
// (To go back to billing the booking's client whatever its origin, make the first line of the function the only one.)
const lowName = v => String(v == null ? '' : v).trim().toLowerCase();
export function billTo(b) {
  const all = (b.stakeholders || []).filter(Boolean), named = all.filter(s => s.name), sh = b.shared && b.shared.ref ? b.shared : null;
  if (!sh) return { head: b.client || (named[0] && named[0].name) || '—', contacts: all };
  const brought = new Set(sh.contacts || []);
  // A booking added before Vdex recorded the producer apart (it has no shared.sent either, which came in with it):
  // they are the contact the link brought as "Producer". On a booking added since, no producer means the link named no
  // sender, and a client's contact whose role happens to begin with "Producer" is not taken for one.
  const old = !sh.producer && !sh.sent && named.find(s => brought.has(lowName(s.name)) && /^Producer( · |$)/.test(s.role || ''));
  const producer = sh.producer || (old ? { name: old.name, business: (old.role.split(' · ')[1] || '') } : null), who = producer ? lowName(producer.name) : '';
  const contacts = all.filter(s => !brought.has(lowName(s.name)) || lowName(s.name) === who), mine = contacts.filter(s => s.name);
  const linkClient = sh.sent ? sh.sent.client || '' : b.client || ''; // no record of what the link supplied: it counts as unchanged
  const own = (b.client || '') !== linkClient ? b.client : '';
  return { head: own || (producer && (producer.business || producer.name)) || (mine[0] && mine[0].name) || '—', contacts };
}
// The name beside a quote or an invoice wherever the documents are listed rather than drawn: the head of the Money
// page, a row of the Money overview, the Client column of the invoices spreadsheet, a search result. The booking's
// client as always; on a booking added from someone's link it is the name the document is headed to (billTo above),
// so the list and the document never name two different people, and nothing while the document is headed to nobody.
export const billedName = b => { if (!(b.shared && b.shared.ref)) return b.client; const head = billTo(b).head; return head === '—' ? '' : head; };
// A self-contained copy of a quote or invoice: the document, the PDF, the email text and the client's link are all
// made from it, and the public invoice page renders it without the app.
export function snapshot(b, kind) {
  const doc = docOf(b, kind), bl = billing(), p = db.profile, to = billTo(b), contacts = to.contacts.filter(s => s.name);
  return {
    v: 1, kind, number: doc.number, date: doc.date, due: doc.due, until: doc.until, status: doc.status, title: b.title, when: dateLabel(b),
    from: partyLines(), to: [to.head, ...contacts.slice(0, 3).map(s => [s.name, s.role, s.email || s.phone].filter(Boolean).join(' · '))],
    lines: (doc.lines || []).map(({ desc, qty, unit, price }) => ({ desc, qty, unit, price })), taxLabel: doc.taxLabel || bl.taxLabel, taxRate: doc.taxRate, deposit: doc.deposit,
    payments: (doc.payments || []).map(({ date, amount, method }) => ({ date, amount, method: methodLabel(method) })), notes: doc.notes,
    currency: sym(), code: code(), payee: p.business || p.name || '', email: p.email || '',
    pay: kind === 'invoice' ? { methods: payMethods(), payment: bl.payment } : {},
  };
}
export const renderMoneyDoc = (b, kind, pending) => renderDoc(snapshot(b, kind), { qr: qrSvg, pending });
// The same, once its QR codes are in it (they are drawn a moment after the document): for a file or a print made at once.
const finishedDoc = async (b, kind) => { const pending = [], el = renderMoneyDoc(b, kind, pending); await Promise.all(pending); return el; };
export const moneyText = (b, kind) => docText(snapshot(b, kind));
export async function moneyPdf(b, kind) {
  const { makePdf } = await import('./pdf.js');
  const snap = snapshot(b, kind);
  return makePdf({ title: docTitle(snap), blocks: pdfBlocks(snap), footer: `${snap.from.join(' · ')} · Made with Vdex` });
}

/* ------------------------------ the client's link ------------------------------ */
// The whole document is packed into the link itself, so it works with no server and nothing is stored online.
const siteBase = () => (window.vdexDesktop || !/^https?:$/.test(location.protocol) ? SITE : new URL('./', location.href).href);
const current = b => byId('bookings', b.id) || b; // handlers may hold a copy drawn before the latest change
export async function shareLink(b, kind) { return siteBase() + 'invoice.html#' + await pack(snapshot(current(b), kind)); }
export function mailtoFor(b, kind, url, mode = 'send') {
  b = current(b);
  const K = KINDS[kind], doc = docOf(b, kind), snap = snapshot(b, kind), t = calc(snap), payee = snap.payee || 'Vdex';
  const emails = billTo(b).contacts.map(s => (s.email || '').trim()).filter(Boolean);
  const subject = mode === 'remind' ? `Reminder: invoice ${doc.number} — ${fmtMoney(t.balance)} due${doc.due ? ' ' + fmtDate(doc.due) : ''}` : `${K.label} ${doc.number} — ${b.title}`;
  const body = mode === 'remind'
    ? `Hi,\n\nA quick reminder that invoice ${doc.number} for ${b.title} (${fmtMoney(t.total)}) ${doc.due ? (doc.due < todayISO() ? 'was due on ' : 'is due on ') + fmtDate(doc.due) : 'is due'}. The balance of ${fmtMoney(t.balance)} is still open.\n\nView it and pay here:\n${url}\n\nThank you,\n${payee}`
    : `Hi,\n\nHere is ${K.label.toLowerCase()} ${doc.number} for ${b.title}: ${fmtMoney(t.total)}${kind === 'invoice' && t.paid > 0 ? ` (balance due ${fmtMoney(t.balance)})` : ''}${doc[K.dateKey] ? `, ${K.dateLabel.toLowerCase()} ${fmtDate(doc[K.dateKey])}` : ''}.\n\nView it${kind === 'invoice' && t.balance > 0 ? ' and pay' : ''} here:\n${url}\n\n${docText(snap)}\n\nThanks,\n${payee}`;
  return `mailto:${emails.join(',')}?` + new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
}
export async function openShareSheet(b, kind) {
  b = current(b);
  const K = KINDS[kind], doc = docOf(b, kind), snap = snapshot(b, kind);
  let url; try { url = await shareLink(b, kind); } catch (e) { return toast('Could not make the link: ' + (e.message || e)); }
  const area = h('textarea', { class: 'share-link', readonly: true, rows: 4, 'aria-label': 'Link for the client' }, url);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { area.select(); toast('Select the link and copy it'); } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: docTitle(snap), text: `${K.label} ${doc.number} — ${b.title}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const qrBox = h('div', { class: 'share-qr' }); qrSvg(url, { cellSize: 2 }).then(svg => { qrBox.innerHTML = svg; }).catch(() => qrBox.remove());
  sheet(`Link for the client · ${K.label} ${doc.number}`, h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `The whole ${K.label.toLowerCase()} is inside the link itself, so nothing is stored online. Anyone who has the link can read it, so send it to the client only.${kind === 'invoice' && payButtons(snap).length ? ' It opens with Pay buttons for the balance.' : ''}`),
    area,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: copy }, '📋 Copy link'), h('button', { class: 'btn ghost', onclick: share }, '📤 Share…'), h('a', { class: 'btn ghost', href: mailtoFor(b, kind, url, 'send') }, '✉ Email it'), h('a', { class: 'btn ghost small', href: url, target: '_blank', rel: 'noopener' }, 'Open preview')),
    qrBox, h('p', { class: 'small muted', style: 'text-align:center' }, 'Scan to open it on a phone')));
}

/* ---------------------------------- payments ---------------------------------- */
const LEGACY_METHODS = { transfer: 'Bank transfer', paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', link: 'Online payment', upi: 'UPI', card: 'Card', cash: 'Cash', cheque: 'Cheque', other: 'Other' };
export const methodLabel = m => LEGACY_METHODS[m] || m || '';
const methodNames = () => [...new Set([...payMethods().map(m => typeOf(m.type).name), 'Bank transfer', 'Card', 'Cash', 'Cheque', 'Other'])];
export function recordPayment(b, onDone) {
  b = current(b);
  const doc = docOf(b, 'invoice'); if (!doc) return;
  const t = totals(doc), names = methodNames(), options = names.map(n => [n, n]);
  openForm({
    title: `Payment on ${doc.number}`, saveLabel: 'Record',
    values: { date: todayISO(), amount: t.balance > 0 ? amountStr(t.balance) : '', method: names[0], note: '' },
    fields: [{ key: 'date', label: 'Date received', type: 'date', required: true }, { key: 'amount', label: `Amount (${sym()})`, type: 'number', min: 0.01, step: 'any', required: true, hint: t.balance > 0 ? `Balance due ${fmtMoney(t.balance)}` : 'Nothing outstanding' }, { key: 'method', label: 'How it arrived', type: 'select', options }, { key: 'note', label: 'Reference / note' }],
    onSave: v => {
      const amount = Math.round((Number(v.amount) || 0) * 100) / 100; if (!(amount > 0)) return toast('Enter the amount received');
      const payments = [...(doc.payments || []), { id: uid(), date: v.date, amount, method: v.method, note: v.note }];
      const left = totals({ ...doc, payments, status: 'Sent' }).balance, paidAll = left <= 0.005;
      saveDoc(b.id, 'invoice', { ...doc, payments, status: paidAll ? 'Paid' : doc.status === 'Draft' ? 'Sent' : doc.status, paidAt: paidAll ? parseISO(v.date).getTime() : doc.paidAt });
      toast(paidAll ? 'Paid in full 🎉' : `Payment recorded · balance ${fmtMoney(left)}`); onDone && onDone();
    },
  });
}
export function removePayment(b, id, onDone) {
  b = current(b);
  const doc = docOf(b, 'invoice'); if (!doc) return;
  const payments = (doc.payments || []).filter(p => p.id !== id), open = totals({ ...doc, payments, status: 'Sent' }).balance > 0.005;
  saveDoc(b.id, 'invoice', { ...doc, payments, status: open && doc.status === 'Paid' ? 'Sent' : doc.status, paidAt: open ? null : doc.paidAt });
  toast('Payment removed'); onDone && onDone();
}
// Once a day at start-up: a word about invoices that have passed their due date unpaid.
export function moneyNudge() {
  const over = db.bookings.filter(b => !b.practice && isOverdue(b)); if (!over.length) return; // the walkthrough's practice job never nags
  let last = 0; try { last = Number(localStorage.getItem('logi-money-nudge')) || 0; } catch { /* ignore */ }
  if (Date.now() - last < 864e5) return;
  try { localStorage.setItem('logi-money-nudge', String(Date.now())); } catch { /* ignore */ }
  const owed = over.reduce((a, b) => a + totals(b.invoice).balance, 0);
  setTimeout(() => toast(`${over.length} invoice${over.length === 1 ? ' is' : 's are'} overdue (${fmtMoney(owed)}). Bookings → Money → Send a reminder.`), 3500);
}

/* ----------------------------------- page ----------------------------------- */
const slug = s => String(s || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function moneyPage(b, kind, go) {
  const K = KINDS[kind], doc = docOf(b, kind), refresh = () => go({});
  const to = billTo(b), emails = to.contacts.map(s => (s.email || '').trim()).filter(Boolean);
  // On a booking added from a shared link the contacts the link brought are not written to (billTo above), so the
  // booking can show an email address while this button has nobody to address: its tip then says who it goes to.
  const leftOut = (b.stakeholders || []).some(s => s && (s.email || '').trim() && !to.contacts.includes(s));
  const text = () => moneyText(byId('bookings', b.id), kind);
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: `${K.label} ${doc.number}`, text: text() }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); } catch { toast('Select the text and copy it'); } };
  const pdf = async () => { try { if (await saveOrShare(await moneyPdf(byId('bookings', b.id), kind), `${kind}-${slug(doc.number)}-${slug(b.title)}.pdf`, 'application/pdf')) toast('PDF saved'); } catch (e) { toast('Could not make the PDF: ' + (e.message || e)); } };
  const web = async () => saveOrShare(htmlDocument(`${K.label} ${doc.number} — ${b.title}`, await finishedDoc(byId('bookings', b.id), kind)), `${kind}-${slug(doc.number)}.html`, 'text/html');
  const addLines = (source, label) => { const now = byId('bookings', b.id) || b, m = mergeSuggested(doc.lines, suggestLines(now, kind, source), source), n = x => `${x} line${x === 1 ? '' : 's'}`; if (!m.added && !m.updated) return toast('Nothing new to add'); saveDoc(b.id, kind, { ...doc, lines: m.lines }); toast(`${[m.added && n(m.added) + ' added', m.updated && n(m.updated) + ' updated'].filter(Boolean).join(' and ')} from ${label}`); };
  // Lines picked from the price list go onto the document; with no document yet they start a new one in the editor.
  const fromList = () => import('./price-list.js').then(m => m.pickFromPriceList(b, lines => { const now = byId('bookings', b.id); if (!now) return toast('That booking has been removed'); const d = docOf(now, kind); if (!d) return editMoney(now, kind, refresh, { lines }); saveDoc(b.id, kind, { ...d, lines: [...(d.lines || []), ...lines] }); toast(`${lines.length} line${lines.length === 1 ? '' : 's'} added from the price list`); })).catch(e => toast('Could not open the price list: ' + (e.message || e)));
  const t = doc && totals(doc);
  // A status button is gone from the page once it is pressed (the page is drawn again without it): the focus goes to the
  // status line, which now says what the button did, instead of being dropped to the top of the page.
  const mark = status => { setDocStatus(b.id, kind, status); queueMicrotask(() => { const line = document.querySelector('.money-page [data-fk="m-status"]'); if (line && (!document.activeElement || document.activeElement === document.body)) line.focus({ preventScroll: true }); }); };
  const stateCls = doc && (doc.status === 'Paid' || doc.status === 'Accepted' ? 'synced' : isOverdue(b) || doc.status === 'Declined' ? 'error' : '');
  // The email carries the client's link once it is made (it is packed asynchronously); the plain text goes first.
  const mailA = doc && h('a', { class: 'btn ghost', href: `mailto:${emails.join(',')}?` + new URLSearchParams({ subject: `${K.label} ${doc.number} — ${b.title}`, body: text() }).toString().replace(/\+/g, '%20'), title: emails.length ? `To: ${emails.join(', ')}` : leftOut ? 'On a booking added from a shared link this goes to the person who shared it and to contacts you add yourself: give one of them an email address on the booking' : 'Add contact emails on the booking' }, emails.length ? `✉ Email client (${emails.length})` : '✉ Email');
  if (doc) shareLink(b, kind).then(url => { mailA.href = mailtoFor(b, kind, url, 'send'); }).catch(() => {});
  const remind = () => shareLink(b, kind).then(url => { location.href = mailtoFor(b, kind, url, 'remind'); }).catch(e => toast('Could not make the link: ' + (e.message || e)));
  const partPaid = doc && kind === 'invoice' && doc.status !== 'Paid' && t.received > 0;
  return h('div', { class: 'cs-page money-page' },
    h('div', { class: 'page-head' },
      backBtn('Booking', () => go({ view: 'booking', id: b.id })),
      h('div', { class: 'seg', role: 'tablist' }, ...Object.entries(KINDS).map(([k, v]) => h('button', { role: 'tab', class: k === kind ? 'on' : '', 'aria-selected': k === kind, onclick: () => go({ kind: k }) }, v.label + (b[k] ? ' ✓' : ''))))),
    h('h1', null, K.label), h('div', { class: 'muted' }, [b.title, billedName(b)].filter(Boolean).join(' · ')),
    doc ? [
      h('div', { class: 'card-row' }, h('p', { class: 'status-line', 'data-state': stateCls, 'data-fk': 'm-status', tabindex: '-1' }, `${doc.status}${isOverdue(b) ? ' · overdue' : ''}${partPaid ? ' · part paid' : ''} · ${fmtMoney(t.total)}${kind === 'invoice' && t.paid > 0 && t.balance > 0 ? ' · balance ' + fmtMoney(t.balance) : ''}${doc.sentAt ? ' · sent ' + fmtShort(ymd(new Date(doc.sentAt))) : ''}${doc.paidAt ? ' · paid ' + fmtShort(ymd(new Date(doc.paidAt))) : ''}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editMoney(b, kind, refresh) }, '✏️ Edit'),
        doc.status === 'Draft' && h('button', { class: 'btn ghost', onclick: () => mark('Sent') }, 'Mark as sent'),
        kind === 'quote' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => mark('Accepted') }, '✅ Accepted'),
        kind === 'invoice' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => mark('Paid') }, '✅ Paid in full'),
        h('button', { class: 'btn ghost small', onclick: () => addLines('booking', 'the booking') }, '＋ Lines from the booking'),
        h('button', { class: 'btn ghost small', onclick: fromList }, '＋ From the price list'),
        kind === 'invoice' && b.quote && h('button', { class: 'btn ghost small', onclick: () => addLines('quote', 'the quote') }, '＋ Lines from the quote'),
        kind === 'invoice' && h('button', { class: 'btn ghost small', onclick: () => addLines('hours', 'the hours logged') }, '＋ Lines from hours logged')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => finishedDoc(byId('bookings', b.id), kind).then(printElement) }, '🖨 Print'),
        h('button', { class: 'btn ghost', onclick: pdf }, '📄 Save PDF'),
        mailA,
        h('button', { class: 'btn ghost small', onclick: share }, '📤 Share'), h('button', { class: 'btn ghost small', onclick: web }, '💾 Web page'), h('button', { class: 'btn ghost small', onclick: copy }, 'Copy text')),
      h('div', { class: 'actions pay-actions' },
        h('button', { class: 'btn ghost', onclick: () => openShareSheet(b, kind) }, '🔗 Link for the client'),
        kind === 'invoice' && doc.status !== 'Void' && t.balance > 0 && h('button', { class: 'btn ghost', onclick: () => recordPayment(b, refresh) }, '💳 Record a payment'),
        kind === 'invoice' && doc.status === 'Sent' && t.balance > 0 && h('button', { class: 'btn ghost small', onclick: remind }, '⏰ Send a reminder')),
      kind === 'invoice' && (doc.payments || []).length > 0 && h('section', { class: 'card stack pay-list' }, h('h4', null, 'Payments received'),
        ...doc.payments.map(p => h('div', { class: 'card-row' }, h('div', null, h('strong', null, fmtMoney(p.amount)), h('div', { class: 'muted small' }, [p.date && fmtShort(p.date), methodLabel(p.method), p.note].filter(Boolean).join(' · '))),
          h('button', { class: 'icon-btn', 'aria-label': 'Remove payment', onclick: () => { if (confirm('Remove this payment?')) removePayment(b, p.id, refresh); } }, '✕'))),
        h('div', { class: 'muted small' }, `Paid ${fmtMoney(t.paid)} of ${fmtMoney(t.total)} · balance ${fmtMoney(t.balance)}`)),
      h('div', { class: 'cs-paper' }, renderMoneyDoc(b, kind)),
    ] : h('div', { class: 'stack' },
      h('p', { class: 'muted' }, kind === 'quote' ? 'No quote yet. Start from the booking and Vdex suggests the lines: shoot days at your day rate, each crew member at their day or hourly rate, the kit, and the deliverables. Edit anything, then send it.' : 'No invoice yet. Start from the quote, from the hours logged on the shoot, or from the booking.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'booking') }) }, '＋ From the booking'),
        kind === 'invoice' && b.quote && h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'quote'), taxRate: b.quote.taxRate }) }, '＋ From the quote'),
        kind === 'invoice' && h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'hours') }) }, '＋ From hours logged'),
        h('button', { class: 'btn ghost', onclick: fromList }, '＋ From the price list'),
        h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh) }, 'Start blank')),
      !billing().dayRate && h('p', { class: 'small muted' }, 'Tip: set your day, hour and kit rates under Settings → Work & billing → Quotes & invoices, and each person’s day or hourly rate on the Crew page, and the suggested lines come priced.'),
      // New to this? A read-through and a walkthrough on a practice job (the tutorials load on first use).
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small walk-btn', type: 'button', onclick: () => import('./tutorials.js').then(m => m.openMoneyGuide()).catch(e => toast('Could not open the guide: ' + (e.message || e))) }, '🎓 New to quoting? Start here'))));
}
export function moneyBlock(b, go) {
  const row = kind => { const doc = docOf(b, kind), K = KINDS[kind]; return h('div', { class: 'card-row' }, h('div', null, h('strong', null, K.label), h('div', { class: 'muted small' }, doc ? `${doc.number} · ${doc.status}${isOverdue(b) && kind === 'invoice' ? ' · overdue' : ''} · ${fmtMoney(totals(doc).total)}${kind === 'invoice' && doc.status !== 'Paid' && totals(doc).paid > 0 ? ` · ${fmtMoney(totals(doc).balance)} due` : ''}` : 'none yet')), h('button', { class: 'btn ghost small', onclick: () => go({ view: 'money', id: b.id, kind }) }, doc ? 'Open' : 'Create')); };
  return h('section', { class: 'block', id: 'bk-money' }, h('h3', null, 'Money'), h('div', { class: 'card stack' }, row('quote'), row('invoice')));
}

/* ---------------------------------- budget ---------------------------------- */
// What a job will cost you, line by line, with each line in a category picked from a list. Private: it never goes
// into a quote, an invoice, a call sheet or a crew link. Compared with the quote, it shows what is left for you.
export const BUDGET_CATS = ['Crew', 'Cast & talent', 'Equipment hire', 'Locations & permits', 'Travel & transport', 'Accommodation', 'Catering', 'Art, props & wardrobe', 'Hair & make-up', 'Post-production', 'Music & licences', 'Insurance', 'Marketing & distribution', 'Contingency', 'Other'];
const BUDGET_UNITS = ['item', 'day', 'half day', 'hour', 'week', 'person', 'night', 'km', 'mile'];
const unitText = (q, u = 'item') => (Number(q) === 1 ? u : ({ person: 'people', km: 'km' }[u] || u + 's'));
const lineEst = l => (Number(l.qty) || 0) * (Number(l.rate) || 0);
const hasActual = l => l.actual !== '' && l.actual != null && Number.isFinite(Number(l.actual));
export function budgetTotals(b) {
  const lines = (b.budget && b.budget.lines) || [];
  const est = lines.reduce((s, l) => s + lineEst(l), 0), spent = lines.reduce((s, l) => s + (hasActual(l) ? Number(l.actual) : 0), 0);
  const byCat = BUDGET_CATS.map(cat => { const ls = lines.filter(l => (BUDGET_CATS.includes(l.cat) ? l.cat : 'Other') === cat); return { cat, lines: ls, est: ls.reduce((s, l) => s + lineEst(l), 0), spent: ls.reduce((s, l) => s + (hasActual(l) ? Number(l.actual) : 0), 0) }; }).filter(c => c.lines.length);
  const forecast = lines.reduce((s, l) => s + (hasActual(l) ? Number(l.actual) : lineEst(l)), 0); // actual costs where known, estimates for the rest
  const toPay = lines.reduce((s, l) => s + (hasActual(l) ? 0 : lineEst(l)), 0);
  const q = docOf(b, 'quote'), quoted = q ? totals(q, 'quote').subtotal : null; // before tax: the tax is not yours to spend
  return { lines, est, spent, forecast, toPay, byCat, quoted, margin: quoted == null ? null : quoted - forecast };
}
const patchBooking = (b, fn) => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { x.budget = { lines: [], ...(x.budget || {}) }; x.budget.lines = [...(x.budget.lines || [])]; fn(x.budget); x.budget.updatedAt = Date.now(); x.updatedAt = Date.now(); } });
function editBudgetLine(b, line) {
  openForm({
    title: line ? 'Edit budget line' : 'Add budget line',
    values: line || { cat: 'Crew', desc: '', qty: 1, unit: 'day', rate: '', actual: '', supplier: '' },
    fields: [
      { key: 'cat', label: 'Category', type: 'select', options: BUDGET_CATS },
      { key: 'desc', label: 'What it is', required: true, placeholder: 'e.g. Gaffer, van hire, location fee' },
      { key: 'qty', label: 'Quantity', type: 'number', min: 0, step: 'any', hint: 'Half days and part hours are fine, e.g. 1.5.' },
      { key: 'unit', label: 'Per', type: 'select', options: BUDGET_UNITS },
      { key: 'rate', label: 'Cost each (estimate)', type: 'number', hint: 'What it will cost you, not what you charge the client.' },
      { key: 'actual', label: 'Actual cost, once known', type: 'number', hint: 'The whole line, as it turned out. Leave blank until you know.' },
      { key: 'supplier', label: 'Paid to', placeholder: 'Person or company' },
    ],
    onSave: v => patchBooking(b, bd => { const next = { ...v, qty: v.qty === '' ? 1 : v.qty, id: (line && line.id) || uid(), src: line && line.src }; const i = bd.lines.findIndex(l => l.id === next.id); if (i >= 0) bd.lines[i] = next; else bd.lines.push(next); }),
    onDelete: line ? () => patchBooking(b, bd => { bd.lines = bd.lines.filter(l => l.id !== line.id); if (line.src) bd.skip = [...new Set([...(bd.skip || []), line.src])]; }) : null, // Fill from booking leaves it out from now on
  });
}
// Lines from what the booking already knows: crew and hired people at their day or hourly rates, rented gear and licences at
// their cost. Only adds what is not there yet, so it can be tapped again after the booking changes.
export function fillBudget(b) {
  b = current(b);
  const have = new Set([...((b.budget && b.budget.lines) || []).map(l => l.src).filter(Boolean), ...((b.budget && b.budget.skip) || [])]), add = [], days = shootDays(b);
  for (const id of b.crew || []) { const c = byId('crew', id); if (c && !have.has('crew:' + id)) { const r = personRate(c), hourly = r.hourly; add.push({ cat: 'Crew', desc: c.name + (c.role ? ` (${c.role})` : '') + (hourly ? ' — check the hours' : ''), qty: hourly ? days * standardDay() : days, unit: hourly ? 'hour' : 'day', rate: r.amount, src: 'crew:' + id }); } }
  for (const hr of paidHires(b)) if (!have.has('person:' + hr.id)) { const r = personRate(hr), hourly = r.hourly, n = Number(hr.days) || days; add.push({ cat: 'Crew', desc: hr.name + (hr.role ? ` (${hr.role})` : '') + ' — hired' + (hourly ? ', check the hours' : ''), qty: hourly ? n * standardDay() : n, unit: hourly ? 'hour' : 'day', rate: r.amount, src: 'person:' + hr.id }); }
  for (const hr of rentalsOf(b)) if (!have.has('hire:' + hr.id)) add.push({ cat: 'Equipment hire', desc: [hr.item, hr.from].filter(Boolean).join(' — '), qty: 1, unit: 'item', rate: costOf(hr.cost), src: 'hire:' + hr.id });
  for (const lc of b.licences || []) if (!have.has('lic:' + lc.id)) add.push({ cat: 'Music & licences', desc: [lc.kind, lc.title].filter(Boolean).join(': '), qty: 1, unit: 'item', rate: costOf(lc.cost), src: 'lic:' + lc.id });
  if (add.length) patchBooking(b, bd => { bd.lines.push(...add.map(l => ({ ...l, id: uid(), actual: '', supplier: '' }))); });
  return add.length;
}
function budgetCsv(b) {
  const t = budgetTotals(b), q = csvCell, tx = csvText; // tx: text, which a spreadsheet must not run as a formula
  const rows = [['Category', 'What it is', 'Quantity', 'Per', 'Cost each', 'Estimate', 'Actual', 'Paid to'].map(q).join(',')];
  for (const c of t.byCat) for (const l of c.lines) rows.push([tx(c.cat), tx(l.desc), q(l.qty), tx(l.unit), q(l.rate), q(lineEst(l).toFixed(2)), q(hasActual(l) ? Number(l.actual).toFixed(2) : ''), tx(l.supplier)].join(','));
  rows.push(['Total', '', '', '', '', t.est.toFixed(2), t.spent.toFixed(2), ''].map(q).join(','));
  return '\ufeff' + rows.join('\r\n');
}
export function budgetBlock(b) {
  const t = budgetTotals(b);
  const line = l => h('button', { class: 'card tap budget-line', type: 'button', onclick: () => editBudgetLine(b, l) },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, l.desc), h('div', { class: 'muted small' }, [`${l.qty || 0} ${unitText(l.qty, l.unit || 'item')} × ${fmtMoney(l.rate)}`, l.supplier].filter(Boolean).join(' · '))),
      h('div', { class: 'budget-amts' }, h('span', null, fmtMoney(lineEst(l))), hasActual(l) && h('span', { class: 'small ' + (Number(l.actual) > lineEst(l) + 0.005 ? 'overdue' : 'muted') }, 'actual ' + fmtMoney(l.actual)))));
  const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
  return h('section', { class: 'block', id: 'bk-budget' }, h('h3', null, 'Budget'),
    h('div', { class: 'card stack' },
      t.lines.length
        ? [h('div', { class: 'stats' }, stat(fmtMoney(t.est), 'Estimate'), stat(fmtMoney(t.spent), 'Spent so far'), stat(fmtMoney(t.toPay), 'Still to pay')),
          Math.abs(t.forecast - t.est) > 0.005 && h('p', { class: 'small' + (t.forecast > t.est ? ' overdue' : '') }, `Expected total cost, with the actual costs so far: ${fmtMoney(t.forecast)} (${t.forecast > t.est ? fmtMoney(t.forecast - t.est) + ' over' : fmtMoney(t.est - t.forecast) + ' under'} the estimate).`),
          t.quoted != null && h('p', { class: 'small' + (t.margin < 0 ? ' overdue' : '') }, `Quoted to the client: ${fmtMoney(t.quoted)} before tax. Left for you after costs: ${fmtMoney(t.margin)}${t.quoted > 0 ? ` (${Math.round(t.margin / t.quoted * 100)}%)` : ''}.`),
          ...t.byCat.map(c => h('details', { class: 'twirl budget-cat' }, h('summary', null, h('span', null, h('span', { class: 'twirl-name' }, c.cat), h('span', { class: 'twirl-sub' }, `${c.lines.length} line${c.lines.length === 1 ? '' : 's'} · ${fmtMoney(c.est)}${c.spent ? ' · spent ' + fmtMoney(c.spent) : ''}`))),
            h('div', { class: 'twirl-body stack' }, c.lines.map(line))))]
        : h('p', { class: 'muted small' }, 'Plan what this job will cost you: crew, hires, travel, locations and more. Only you see it: it never goes into a quote, an invoice or a crew link.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => editBudgetLine(b, null) }, '+ Add line'),
        h('button', { class: 'btn ghost small', onclick: () => { const n = fillBudget(b); toast(n ? `${n} line${n === 1 ? '' : 's'} added from the booking` : 'Nothing new to add from the booking'); } }, '↻ Fill from booking'),
        t.lines.length > 0 && h('button', { class: 'btn ghost small', onclick: () => requirePaid('export') && saveOrShare(budgetCsv(b), `budget-${String(b.title || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`, 'text/csv') }, '⬇ Export CSV'))));
}

/* --------------------------------- overview --------------------------------- */
export function openMoney(onOpen) {
  const today = todayISO(), year = today.slice(0, 4);
  const list = db.bookings.filter(b => b.quote || b.invoice).sort((x, y) => y.date.localeCompare(x.date));
  const real = list.filter(b => !b.practice); // the walkthrough's practice job is listed, and left out of the sums and the accountant's file
  const sum = (f) => real.reduce((s, b) => s + f(b), 0);
  const invOpen = b => (b.invoice && b.invoice.status === 'Sent' ? totals(b.invoice).balance : 0);
  const outstanding = sum(invOpen), overdue = sum(b => (isOverdue(b) ? invOpen(b) : 0));
  // Money received in the year: recorded payments by their date, the deposit with the invoice, and the rest of an
  // invoice marked paid in full on the day it was marked.
  const paidIn = b => { const inv = b.invoice; if (!inv) return 0; const t = totals(inv), inYear = d => String(d || '').startsWith(year);
    let got = (inv.payments || []).filter(p => inYear(p.date)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    if (t.deposit > 0 && inYear(inv.date)) got += t.deposit;
    const rest = t.total - t.deposit - t.received; if (inv.status === 'Paid' && rest > 0.005 && inYear(inv.paidAt ? ymd(new Date(inv.paidAt)) : inv.date)) got += rest;
    return got; };
  const paidYear = sum(paidIn);
  const quotedOpen = sum(b => (b.quote && b.quote.status === 'Sent' ? totals(b.quote).total : 0));
  let close = () => {};
  const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
  const csv = () => {
    // Text cells (a title or a client can come from someone's shared link) are written so that a spreadsheet does not
    // run them as formulas; amounts and dates stay plain, so a negative balance is still a number. Client is who the
    // invoice is headed to (billedName above): on a booking added from a link, the person who shared it.
    const q = csvCell, tx = csvText;
    const rows = [['Number', 'Date', 'Due', 'Client', 'Project', 'Subtotal', 'Tax', 'Total', 'Paid', 'Balance', 'Status', 'Paid on'].map(q).join(',')];
    for (const b of real.filter(x => x.invoice).sort((x, y) => String(x.invoice.number).localeCompare(String(y.invoice.number)))) { const t = totals(b.invoice); rows.push([tx(b.invoice.number), q(b.invoice.date), q(b.invoice.due), tx(billedName(b)), tx(b.title), q(t.subtotal.toFixed(2)), q(t.tax.toFixed(2)), q(t.total.toFixed(2)), q(t.paid.toFixed(2)), q(t.balance.toFixed(2)), tx(b.invoice.status), q(b.invoice.paidAt ? ymd(new Date(b.invoice.paidAt)) : '')].join(',')); }
    if (!requirePaid('export')) return; // spreadsheets come with a licence
    saveOrShare('﻿' + rows.join('\r\n'), `vdex-invoices-${today}.csv`, 'text/csv').then(ok => ok && toast('Invoices exported'));
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'stats money-stats' }, stat(fmtMoney(outstanding), 'invoiced, unpaid'), stat(fmtMoney(overdue), 'overdue', overdue ? 'bad' : ''), stat(fmtMoney(quotedOpen), 'quoted, awaiting'), stat(fmtMoney(paidYear), `paid in ${year}`)),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onOpen(b); } },
      h('div', { class: 'card-row money-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [billedName(b), fmtShort(b.date), b.practice && 'practice, not counted'].filter(Boolean).join(' · '))),
        h('div', { class: 'money-pills' }, b.quote && h('span', { class: 'pill ' + (b.quote.status === 'Accepted' ? 'st-confirmed' : b.quote.status === 'Declined' ? 'st-cancelled' : 'st-enquiry') }, `Q ${b.quote.status} ${fmtMoney(totals(b.quote).total)}`),
          b.invoice && h('span', { class: 'pill ' + (b.invoice.status === 'Paid' ? 'st-confirmed' : isOverdue(b) ? 'st-cancelled' : 'st-enquiry') }, `Inv ${isOverdue(b) ? 'Overdue' : b.invoice.status}${b.invoice.status !== 'Paid' && totals(b.invoice).received > 0 ? ' (part paid)' : ''} ${fmtMoney(totals(b.invoice).total)}`))))))
      : h('p', { class: 'muted' }, 'No quotes or invoices yet. Open a booking and create one under Money.'),
    h('div', { class: 'actions' }, real.some(b => b.invoice) && h('button', { class: 'btn ghost small', onclick: csv }, '⬇ Invoices (CSV) for the accountant')));
  ({ close } = sheet('Money', body));
}

/* --------------------------------- settings --------------------------------- */
// The list of ways to get paid: edit, remove, and add from the catalogue.
function payMethodsList() {
  const methods = payMethods();
  const save = list => setBilling({ payMethods: list });
  const edit = (m, i) => {
    const T = typeOf(m.type), fields = T.fields
      ? [{ key: 'accountName', label: 'Account name', required: true }, { key: 'iban', label: 'IBAN or account number', required: true }, { key: 'bic', label: 'BIC / SWIFT / sort code' }]
      : [{ key: 'value', label: T.ask, type: T.text ? 'textarea' : 'text', required: true, placeholder: T.placeholder || '', rows: T.text ? 3 : undefined, hint: T.blurb }, ...(T.label ? [{ key: 'label', label: 'Button label', placeholder: 'Pay by card' }] : [])];
    openForm({ title: (i >= 0 ? 'Edit ' : 'Add ') + T.name, values: { value: '', label: '', accountName: '', iban: '', bic: '', ...m }, fields, saveLabel: i >= 0 ? 'Save' : 'Add',
      onSave: v => { const next = { ...m, ...v, type: m.type }; const list = methods.slice(); if (i >= 0) list[i] = next; else list.push(next); save(list); toast(`${T.name} ${i >= 0 ? 'saved' : 'added'}`); },
      onDelete: i >= 0 ? () => { save(methods.filter((_, j) => j !== i)); toast(`${T.name} removed`); } : null });
  };
  const add = () => { let close = () => {}; ({ close } = sheet('Add a way to pay', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Pick one. You can add as many as you like, and edit or remove them later.'),
    h('div', { class: 'list' }, ...PAY_TYPES.map(T => h('button', { class: 'card tap', type: 'button', onclick: () => { close(); edit({ type: T.id }, -1); } }, h('strong', null, T.name), h('div', { class: 'muted small' }, T.blurb))))))); };
  return h('div', { class: 'stack pay-methods' },
    methods.length ? h('div', { class: 'list' }, ...methods.map((m, i) => h('div', { class: 'card card-row' }, h('div', null, h('strong', null, typeOf(m.type).name), h('div', { class: 'muted small' }, summaryOf(m) || '—')),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => edit(m, i) }, 'Edit'), h('button', { class: 'icon-btn', 'aria-label': `Remove ${typeOf(m.type).name}`, onclick: () => { if (confirm('Remove this way to pay?')) { save(methods.filter((_, j) => j !== i)); toast('Removed'); } } }, '✕')))))
      : h('p', { class: 'muted small' }, 'No ways to pay yet: invoices show only the free text below until you add one.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: add }, '+ Add a way to pay')));
}

export function billingPanel() {
  const wrap = h('div', { class: 'stack' });
  const bl = billing();
  const field = (label, key, type = 'text', extra = {}) => h('div', { class: 'field' }, h('label', null, label), type === 'textarea'
    ? h('textarea', { rows: 2, value: bl[key] ?? '', 'aria-label': label, onchange: e => setBilling({ [key]: e.target.value }) })
    : h('input', { type, value: bl[key] ?? '', 'aria-label': label, inputMode: type === 'number' ? 'decimal' : null, ...extra, onchange: e => setBilling({ [key]: type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }) }));
  wrap.append(
    h('p', { class: 'small muted' }, 'Rates feed the suggested lines on quotes and invoices; each crew member’s day or hourly rate is on their own card (an hourly rate is quoted for a standard day’s hours per shoot day). Your name, business, phone and email come from your profile (Settings → General → Profile).'),
    h('div', { class: 'grid2' }, field(`Day rate (${sym()})`, 'dayRate', 'number', { min: 0 }), field(`Hour rate for editing (${sym()})`, 'hourRate', 'number', { min: 0 }), field(`Overtime hour rate (${sym()})`, 'overtimeRate', 'number', { min: 0 }), field(`Equipment package per day (${sym()})`, 'kitRate', 'number', { min: 0 })),
    h('div', { class: 'grid2' }, field('Tax name', 'taxLabel'), field('Tax rate (%)', 'taxRate', 'number', { min: 0 }), field('Quote number prefix', 'quotePrefix'), field('Next quote number', 'nextQuote', 'number', { min: 1 }), field('Invoice number prefix', 'invoicePrefix'), field('Next invoice number', 'nextInvoice', 'number', { min: 1 }), field('Quotes valid for (days)', 'validDays', 'number', { min: 1 }), field('Invoices due in (days)', 'dueDays', 'number', { min: 0 })),
    field('Payment terms (on every invoice)', 'terms', 'textarea'),
    h('h4', { class: 'pay-head' }, 'Price list'),
    h('p', { class: 'small muted' }, 'The lines you charge for again and again, with your prices, to pick into a quote or an invoice with ＋ From the price list. It starts from typical freelance rates where you work: change any price to yours.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost price-list-btn', onclick: () => import('./price-list.js').then(m => m.openPriceList()).catch(e => toast('Could not open the price list: ' + (e.message || e))) }, '🏷 Edit the price list')),
    h('h4', { class: 'pay-head' }, 'Getting paid'),
    h('p', { class: 'small muted' }, 'Add the ways you like to be paid, as many as you want. Every invoice then carries a Pay button for each one that has a link, with the balance filled in, plain instructions for the ones that do not, bank details (with a QR code banking apps can scan, when the account is an IBAN), and the invoice number as the reference. The link you send a client opens the invoice with the same buttons.'),
    h('div', { class: 'field' }, h('label', null, 'Currency for payment links'), h('select', { 'aria-label': 'Currency for payment links', onchange: e => setBilling({ currencyCode: e.target.value }) }, h('option', { value: '', selected: code() === '' ? 'selected' : null }, 'Not listed: leave the currency out'), ...CURRENCIES.map(([c, sy]) => h('option', { value: c, selected: c === code() ? 'selected' : null }, `${c} ${sy.trim()}`))),
      h('small', { class: 'muted' }, 'PayPal links carry this currency. With none chosen, PayPal asks in your account’s own.')),
    payMethodsList(),
    field('How to pay, in your own words (printed on every invoice)', 'payment', 'textarea'));
  return wrap;
}

// Quotes and invoices, one of each per booking. Lines are suggested from the booking (shoot days, crew with their
// day rates, kit, the deliverables a template put there) or, for the invoice, copied from the quote or built from the
// hours logged; the user edits them. Printed from the app, saved as PDF, emailed to the client's contacts, and
// summed up on the Money overview. Rates, numbering, tax and payment terms live in Settings → Quotes & invoices.
import { h, sheet, toast, nodes, fmtShort, fmtLong, todayISO, parseISO, ymd, uid } from './util.js';
import { db, byId, upsert, update, endOf } from './store.js';
import { openForm } from './form.js';
import { setCheck, itemId } from './workflow.js';
import { stats, workedMs } from './hours.js';
import { saveOrShare } from './backup.js';
import { printElement, htmlDocument } from './callsheet.js';
import { KINDS, calc, renderDoc, docText, pdfBlocks, docTitle, payButtons } from './money-doc.js';
import { CURRENCIES, codeFor, amountStr, PAY_TYPES, typeOf, summaryOf, methodsOf } from './pay.js';
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
const code = () => billing().currencyCode || codeFor(sym());
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

// Suggested lines: from the booking, from the quote, or from the hours logged.
export function suggestLines(b, kind, source = 'booking') {
  const bl = billing(), days = shootDays(b), lines = [];
  const line = (desc, qty, unit, price) => lines.push({ id: uid(), desc, qty, unit, price: num(price) });
  if (source === 'quote') return ((b.quote && b.quote.lines) || []).map(l => ({ ...l, id: uid() }));
  if (source === 'hours') {
    const shifts = db.shifts.filter(s => s.bookingId === b.id && s.end);
    const shoot = shifts.filter(s => (s.kind || 'shoot') === 'shoot'), edit = shifts.filter(s => s.kind === 'edit');
    const sd = new Set(shoot.map(s => s.date)).size;
    if (sd) line(`Shoot day${sd === 1 ? '' : 's'} — ${b.title}`, sd, 'day', bl.dayRate);
    const editH = Math.round(edit.reduce((t, s) => t + workedMs(s), 0) / 36e5 * 4) / 4;
    if (editH) line('Editing', editH, 'hour', bl.hourRate);
    const ot = Math.round(stats(shoot).overtime / 36e5 * 4) / 4;
    if (ot) line('Overtime on shoot days', ot, 'hour', bl.overtimeRate || bl.hourRate);
    return lines;
  }
  line(`Shoot day${days === 1 ? '' : 's'} — ${b.title}`, days, 'day', bl.dayRate);
  for (const id of b.crew || []) { const c = byId('crew', id); if (c) line(`Crew: ${c.name}${c.role ? ' (' + c.role + ')' : ''}`, days, 'day', c.rate); }
  if ((b.gear || []).length || (b.kits || []).length) line('Equipment package', days, 'day', bl.kitRate);
  for (const dl of b.deliverables || []) line(`${dl.name}${dl.duration ? ' (' + dl.duration + ')' : ''}`, 1, 'each', '');
  if (kind === 'invoice') for (const hr of b.hires || []) line(`Hire: ${hr.item}${hr.from ? ' (' + hr.from + ')' : ''}`, 1, 'each', hr.cost);
  return lines;
}

function saveDoc(id, kind, doc) {
  const prev = docOf(byId('bookings', id), kind) || {}, now = Date.now();
  const next = { ...doc, taxLabel: doc.taxLabel || billing().taxLabel, updatedAt: now };
  if (next.status === 'Sent' && prev.status !== 'Sent' && !next.sentAt) next.sentAt = now;
  if (kind === 'quote' && next.status === 'Accepted' && !next.acceptedAt) next.acceptedAt = now;
  if (kind === 'invoice' && next.status === 'Paid' && !next.paidAt) next.paidAt = now;
  upsert('bookings', { ...byId('bookings', id), [kind]: next });
  const b = byId('bookings', id);
  if (kind === 'quote' && ['Sent', 'Accepted'].includes(next.status)) setCheck(b, itemId('Quoted', 'Quote / estimate sent'), true);
  if (kind === 'invoice' && ['Sent', 'Paid'].includes(next.status)) setCheck(b, itemId('Delivered', 'Final invoice sent'), true);
  if (kind === 'invoice' && next.status === 'Paid') setCheck(b, itemId('Delivered', 'Paid'), true);
}
export const setDocStatus = (id, kind, status) => { const doc = docOf(byId('bookings', id), kind); if (doc) { saveDoc(id, kind, { ...doc, status }); toast(`${KINDS[kind].label} marked ${status.toLowerCase()}`); } };

export function editMoney(b, kind, onDone, preset) {
  const K = KINDS[kind], bl = billing(), cur = docOf(b, kind);
  const base = cur || { number: nextNumber(kind), date: todayISO(), [K.dateKey]: addDays(todayISO(), Number(kind === 'quote' ? bl.validDays : bl.dueDays) || (kind === 'quote' ? 30 : 14)), lines: [], taxRate: bl.taxRate, taxLabel: bl.taxLabel, notes: kind === 'invoice' ? bl.terms : '', status: 'Draft', deposit: '' };
  const values = { ...base, ...(preset || {}) };
  openForm({
    title: cur ? `Edit ${K.label.toLowerCase()}` : `New ${K.label.toLowerCase()}`,
    values,
    fields: [
      { key: 'number', label: `${K.label} number`, required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: K.dateKey, label: K.dateLabel, type: 'date' },
      { key: 'lines', label: 'Lines', type: 'rows', columns: [{ key: 'desc', label: 'Description' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'unit', label: 'Unit' }, { key: 'price', label: `Price (${sym()})`, type: 'number' }], hint: 'Quantity × price per line. Units are free text: day, hour, each…' },
      { key: 'taxRate', label: `${bl.taxLabel || 'Tax'} rate (%)`, type: 'number', min: 0, hint: '0 if you don’t charge it.' },
      ...(kind === 'invoice' ? [{ key: 'deposit', label: 'Already paid / deposit', type: 'number', min: 0 }] : []),
      { key: 'status', label: 'Status', type: 'select', options: K.statuses },
      { key: 'notes', label: kind === 'quote' ? 'What is included / notes' : 'Payment terms / notes', type: 'textarea', rows: 3 },
    ],
    onSave: v => { saveDoc(b.id, kind, { ...values, ...v, lines: (v.lines || []).map(l => ({ ...l, id: l.id || uid() })) }); toast(`${K.label} saved`); onDone && onDone(); },
    onDelete: cur ? () => { update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { delete x[kind]; x.updatedAt = Date.now(); } }); toast(`${K.label} removed`); onDone && onDone(); } : null,
  });
}

/* --------------------------------- documents --------------------------------- */
const dateLabel = b => (endOf(b) > b.date ? `${fmtLong(b.date)} → ${fmtLong(endOf(b))}` : fmtLong(b.date));
const partyLines = () => { const p = db.profile; return [p.business || p.name, p.business && p.name ? p.name : null, p.phone, p.email, p.website, p.location].filter(Boolean); };
// A self-contained copy of a quote or invoice: the document, the PDF, the email text and the client's link are all
// made from it, and the public invoice page renders it without the app.
export function snapshot(b, kind) {
  const doc = docOf(b, kind), bl = billing(), p = db.profile, contacts = (b.stakeholders || []).filter(s => s.name);
  return {
    v: 1, kind, number: doc.number, date: doc.date, due: doc.due, until: doc.until, status: doc.status, title: b.title, when: dateLabel(b),
    from: partyLines(), to: [b.client || (contacts[0] && contacts[0].name) || '—', ...contacts.slice(0, 3).map(s => [s.name, s.role, s.email || s.phone].filter(Boolean).join(' · '))],
    lines: (doc.lines || []).map(({ desc, qty, unit, price }) => ({ desc, qty, unit, price })), taxLabel: doc.taxLabel || bl.taxLabel, taxRate: doc.taxRate, deposit: doc.deposit,
    payments: (doc.payments || []).map(({ date, amount, method }) => ({ date, amount, method: methodLabel(method) })), notes: doc.notes,
    currency: sym(), code: code(), payee: p.business || p.name || '', email: p.email || '',
    pay: kind === 'invoice' ? { methods: payMethods(), payment: bl.payment } : {},
  };
}
export const renderMoneyDoc = (b, kind) => renderDoc(snapshot(b, kind), { qr: qrSvg });
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
  const emails = (b.stakeholders || []).map(s => (s.email || '').trim()).filter(Boolean);
  const subject = mode === 'remind' ? `Reminder: invoice ${doc.number} — ${fmtMoney(t.balance)} due${doc.due ? ' ' + fmtShort(doc.due) : ''}` : `${K.label} ${doc.number} — ${b.title}`;
  const body = mode === 'remind'
    ? `Hi,\n\nA quick reminder that invoice ${doc.number} for ${b.title} (${fmtMoney(t.total)}) ${doc.due ? (doc.due < todayISO() ? 'was due on ' : 'is due on ') + fmtShort(doc.due) : 'is due'}. The balance of ${fmtMoney(t.balance)} is still open.\n\nView it and pay here:\n${url}\n\nThank you,\n${payee}`
    : `Hi,\n\nHere is ${K.label.toLowerCase()} ${doc.number} for ${b.title}: ${fmtMoney(t.total)}${kind === 'invoice' && t.paid > 0 ? ` (balance due ${fmtMoney(t.balance)})` : ''}${doc[K.dateKey] ? `, ${K.dateLabel.toLowerCase()} ${fmtShort(doc[K.dateKey])}` : ''}.\n\nView it${kind === 'invoice' && t.balance > 0 ? ' and pay' : ''} here:\n${url}\n\n${docText(snap)}\n\nThanks,\n${payee}`;
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
    h('p', { class: 'small muted' }, `The whole ${K.label.toLowerCase()} is inside the link itself, so nothing is stored online and nothing can go missing. Anyone who has the link can read it, so send it to the client only.${kind === 'invoice' && payButtons(snap).length ? ' It opens with Pay buttons for the balance.' : ''}`),
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
    fields: [{ key: 'date', label: 'Date received', type: 'date', required: true }, { key: 'amount', label: `Amount (${sym()})`, type: 'number', min: 0, required: true, hint: t.balance > 0 ? `Balance due ${fmtMoney(t.balance)}` : 'Nothing outstanding' }, { key: 'method', label: 'How it arrived', type: 'select', options }, { key: 'note', label: 'Reference / note' }],
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
  const over = db.bookings.filter(isOverdue); if (!over.length) return;
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
  const emails = (b.stakeholders || []).map(s => (s.email || '').trim()).filter(Boolean);
  const text = () => moneyText(byId('bookings', b.id), kind);
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: `${K.label} ${doc.number}`, text: text() }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); } catch { toast('Select the text and copy it'); } };
  const pdf = async () => { try { if (await saveOrShare(await moneyPdf(byId('bookings', b.id), kind), `${kind}-${slug(doc.number)}-${slug(b.title)}.pdf`, 'application/pdf')) toast('PDF saved'); } catch (e) { toast('Could not make the PDF: ' + (e.message || e)); } };
  const web = () => saveOrShare(htmlDocument(`${K.label} ${doc.number} — ${b.title}`, renderMoneyDoc(byId('bookings', b.id), kind)), `${kind}-${slug(doc.number)}.html`, 'text/html');
  const addLines = (source, label) => { const have = new Set((doc.lines || []).map(l => (l.desc || '').toLowerCase())); const add = suggestLines(b, kind, source).filter(l => !have.has((l.desc || '').toLowerCase())); if (!add.length) return toast('Nothing new to add'); saveDoc(b.id, kind, { ...doc, lines: [...(doc.lines || []), ...add] }); toast(`${add.length} line${add.length === 1 ? '' : 's'} added from ${label}`); };
  const t = doc && totals(doc);
  const stateCls = doc && (doc.status === 'Paid' || doc.status === 'Accepted' ? 'synced' : isOverdue(b) || doc.status === 'Declined' ? 'error' : '');
  // The email carries the client's link once it is made (it is packed asynchronously); the plain text goes first.
  const mailA = doc && h('a', { class: 'btn ghost', href: `mailto:${emails.join(',')}?` + new URLSearchParams({ subject: `${K.label} ${doc.number} — ${b.title}`, body: text() }).toString().replace(/\+/g, '%20'), title: emails.length ? `To: ${emails.join(', ')}` : 'Add contact emails on the booking' }, emails.length ? `✉ Email client (${emails.length})` : '✉ Email');
  if (doc) shareLink(b, kind).then(url => { mailA.href = mailtoFor(b, kind, url, 'send'); }).catch(() => {});
  const remind = () => shareLink(b, kind).then(url => { location.href = mailtoFor(b, kind, url, 'remind'); }).catch(e => toast('Could not make the link: ' + (e.message || e)));
  const partPaid = doc && kind === 'invoice' && doc.status !== 'Paid' && t.received > 0;
  return h('div', { class: 'cs-page money-page' },
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => go({ view: 'booking', id: b.id }) }, '‹ Booking'),
      h('div', { class: 'seg', role: 'tablist' }, ...Object.entries(KINDS).map(([k, v]) => h('button', { role: 'tab', class: k === kind ? 'on' : '', 'aria-selected': k === kind, onclick: () => go({ kind: k }) }, v.label + (b[k] ? ' ✓' : ''))))),
    h('h1', null, K.label), h('div', { class: 'muted' }, [b.title, b.client].filter(Boolean).join(' · ')),
    doc ? [
      h('div', { class: 'card-row' }, h('p', { class: 'status-line', 'data-state': stateCls }, `${doc.status}${isOverdue(b) ? ' · overdue' : ''}${partPaid ? ' · part paid' : ''} · ${fmtMoney(t.total)}${kind === 'invoice' && t.paid > 0 && t.balance > 0 ? ' · balance ' + fmtMoney(t.balance) : ''}${doc.sentAt ? ' · sent ' + fmtShort(ymd(new Date(doc.sentAt))) : ''}${doc.paidAt ? ' · paid ' + fmtShort(ymd(new Date(doc.paidAt))) : ''}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editMoney(b, kind, refresh) }, '✏️ Edit'),
        doc.status === 'Draft' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Sent') }, 'Mark as sent'),
        kind === 'quote' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Accepted') }, '✅ Accepted'),
        kind === 'invoice' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Paid') }, '✅ Paid in full'),
        h('button', { class: 'btn ghost small', onclick: () => addLines('booking', 'the booking') }, '＋ Lines from the booking'),
        kind === 'invoice' && b.quote && h('button', { class: 'btn ghost small', onclick: () => addLines('quote', 'the quote') }, '＋ Lines from the quote'),
        kind === 'invoice' && h('button', { class: 'btn ghost small', onclick: () => addLines('hours', 'the hours logged') }, '＋ Lines from hours logged')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => printElement(renderMoneyDoc(byId('bookings', b.id), kind)) }, '🖨 Print'),
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
      h('p', { class: 'muted' }, kind === 'quote' ? 'No quote yet. Start from the booking and Vdex suggests the lines: shoot days at your day rate, each crew member at theirs, the kit, and the deliverables. Edit anything, then send it.' : 'No invoice yet. Start from the quote, from the hours logged on the shoot, or from the booking.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'booking') }) }, '＋ From the booking'),
        kind === 'invoice' && b.quote && h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'quote'), taxRate: b.quote.taxRate }) }, '＋ From the quote'),
        kind === 'invoice' && h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh, { lines: suggestLines(b, kind, 'hours') }) }, '＋ From hours logged'),
        h('button', { class: 'btn ghost', onclick: () => editMoney(b, kind, refresh) }, 'Start blank')),
      !billing().dayRate && h('p', { class: 'small muted' }, 'Tip: set your day, hour and kit rates under Settings → Quotes & invoices, and each person’s day rate on the Crew page, and the suggested lines come priced.')));
}
export function moneyBlock(b, go) {
  const row = kind => { const doc = docOf(b, kind), K = KINDS[kind]; return h('div', { class: 'card-row' }, h('div', null, h('strong', null, K.label), h('div', { class: 'muted small' }, doc ? `${doc.number} · ${doc.status}${isOverdue(b) && kind === 'invoice' ? ' · overdue' : ''} · ${fmtMoney(totals(doc).total)}${kind === 'invoice' && doc.status !== 'Paid' && totals(doc).paid > 0 ? ` · ${fmtMoney(totals(doc).balance)} due` : ''}` : 'none yet')), h('button', { class: 'btn ghost small', onclick: () => go({ view: 'money', id: b.id, kind }) }, doc ? 'Open' : 'Create')); };
  return h('section', { class: 'block', id: 'bk-money' }, h('h3', null, 'Money'), h('div', { class: 'card stack' }, row('quote'), row('invoice')));
}

/* --------------------------------- overview --------------------------------- */
export function openMoney(onOpen) {
  const today = todayISO(), year = today.slice(0, 4);
  const list = db.bookings.filter(b => b.quote || b.invoice).sort((x, y) => y.date.localeCompare(x.date));
  const sum = (f) => list.reduce((s, b) => s + f(b), 0);
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
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Number', 'Date', 'Due', 'Client', 'Project', 'Subtotal', 'Tax', 'Total', 'Paid', 'Balance', 'Status', 'Paid on'].map(q).join(',')];
    for (const b of list.filter(x => x.invoice).sort((x, y) => String(x.invoice.number).localeCompare(String(y.invoice.number)))) { const t = totals(b.invoice); rows.push([b.invoice.number, b.invoice.date, b.invoice.due, b.client, b.title, t.subtotal.toFixed(2), t.tax.toFixed(2), t.total.toFixed(2), t.paid.toFixed(2), t.balance.toFixed(2), b.invoice.status, b.invoice.paidAt ? ymd(new Date(b.invoice.paidAt)) : ''].map(q).join(',')); }
    saveOrShare('﻿' + rows.join('\r\n'), `vdex-invoices-${today}.csv`, 'text/csv').then(ok => ok && toast('Invoices exported'));
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'stats' }, stat(fmtMoney(outstanding), 'invoiced, unpaid'), stat(fmtMoney(overdue), 'overdue', overdue ? 'bad' : ''), stat(fmtMoney(quotedOpen), 'quoted, awaiting'), stat(fmtMoney(paidYear), `paid in ${year}`)),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onOpen(b); } },
      h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [b.client, fmtShort(b.date)].filter(Boolean).join(' · '))),
        h('div', { class: 'money-pills' }, b.quote && h('span', { class: 'pill ' + (b.quote.status === 'Accepted' ? 'st-confirmed' : b.quote.status === 'Declined' ? 'st-cancelled' : 'st-enquiry') }, `Q ${b.quote.status} ${fmtMoney(totals(b.quote).total)}`),
          b.invoice && h('span', { class: 'pill ' + (b.invoice.status === 'Paid' ? 'st-confirmed' : isOverdue(b) ? 'st-cancelled' : 'st-enquiry') }, `Inv ${isOverdue(b) ? 'Overdue' : b.invoice.status}${b.invoice.status !== 'Paid' && totals(b.invoice).received > 0 ? ' (part paid)' : ''} ${fmtMoney(totals(b.invoice).total)}`))))))
      : h('p', { class: 'muted' }, 'No quotes or invoices yet. Open a booking and create one under Money.'),
    h('div', { class: 'actions' }, list.some(b => b.invoice) && h('button', { class: 'btn ghost small', onclick: csv }, '⬇ Invoices (CSV) for the accountant')));
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
    h('p', { class: 'small muted' }, 'Rates feed the suggested lines on quotes and invoices; each crew member’s day rate is on their own card. Your name, business, phone and email come from the Me page.'),
    h('div', { class: 'grid2' }, field(`Day rate (${sym()})`, 'dayRate', 'number', { min: 0 }), field(`Hour rate for editing (${sym()})`, 'hourRate', 'number', { min: 0 }), field(`Overtime hour rate (${sym()})`, 'overtimeRate', 'number', { min: 0 }), field(`Equipment package per day (${sym()})`, 'kitRate', 'number', { min: 0 })),
    h('div', { class: 'grid2' }, field('Tax name', 'taxLabel'), field('Tax rate (%)', 'taxRate', 'number', { min: 0 }), field('Quote number prefix', 'quotePrefix'), field('Next quote number', 'nextQuote', 'number', { min: 1 }), field('Invoice number prefix', 'invoicePrefix'), field('Next invoice number', 'nextInvoice', 'number', { min: 1 }), field('Quotes valid for (days)', 'validDays', 'number', { min: 1 }), field('Invoices due in (days)', 'dueDays', 'number', { min: 0 })),
    field('Payment terms (on every invoice)', 'terms', 'textarea'),
    h('h4', { class: 'pay-head' }, 'Getting paid'),
    h('p', { class: 'small muted' }, 'Add the ways you like to be paid, as many as you want. Every invoice then carries a Pay button for each one that has a link, with the balance filled in, plain instructions for the ones that do not, bank details with a QR code banking apps can scan, and the invoice number as the reference. The link you send a client opens the invoice with the same buttons.'),
    h('div', { class: 'field' }, h('label', null, 'Currency for payment links'), h('select', { 'aria-label': 'Currency for payment links', onchange: e => setBilling({ currencyCode: e.target.value }) }, ...CURRENCIES.map(([c, sy]) => h('option', { value: c, selected: c === code() ? 'selected' : null }, `${c} ${sy.trim()}`)))),
    payMethodsList(),
    field('How to pay, in your own words (printed on every invoice)', 'payment', 'textarea'));
  return wrap;
}

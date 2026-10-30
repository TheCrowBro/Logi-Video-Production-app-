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

const DEF = { quotePrefix: 'Q-', invoicePrefix: 'INV-', nextQuote: 1, nextInvoice: 1, taxLabel: 'VAT', taxRate: 0, validDays: 30, dueDays: 14, terms: 'Payment within 14 days of the invoice date.', payment: '', dayRate: '', hourRate: '', overtimeRate: '', kitRate: '' };
export const billing = () => ({ ...DEF, ...(db.billing || {}) });
export const setBilling = patch => update(d => { d.billing = { ...DEF, ...(d.billing || {}), ...patch, updatedAt: Date.now() }; });
const sym = () => db.profile.currency || '$';
export const fmtMoney = n => { const v = Number(n) || 0; return (v < 0 ? '-' : '') + sym() + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
export const KINDS = { quote: { label: 'Quote', statuses: ['Draft', 'Sent', 'Accepted', 'Declined'], dateLabel: 'Valid until', dateKey: 'until' }, invoice: { label: 'Invoice', statuses: ['Draft', 'Sent', 'Paid', 'Void'], dateLabel: 'Due', dateKey: 'due' } };
export const docOf = (b, kind) => (b && b[kind] ? { lines: [], ...b[kind] } : null);
export function totals(doc) {
  const lines = ((doc && doc.lines) || []).map(l => ({ ...l, amount: (Number(l.qty) || 0) * (Number(l.price) || 0) }));
  const subtotal = lines.reduce((s, l) => s + l.amount, 0), rate = Number(doc && doc.taxRate) || 0, tax = subtotal * rate / 100, deposit = Number(doc && doc.deposit) || 0;
  return { lines, subtotal, rate, tax, total: subtotal + tax, deposit, balance: subtotal + tax - deposit };
}
export function nextNumber(kind) {
  const bl = billing(), prefix = kind === 'quote' ? bl.quotePrefix : bl.invoicePrefix, floor = Number(kind === 'quote' ? bl.nextQuote : bl.nextInvoice) || 1;
  const used = db.bookings.map(b => b[kind] && b[kind].number).filter(Boolean).map(n => (String(n).startsWith(prefix) ? parseInt(String(n).slice(prefix.length), 10) : NaN)).filter(Number.isFinite);
  return prefix + String(Math.max(floor, ...used.map(x => x + 1))).padStart(4, '0');
}
const shootDays = b => Math.max(1, Math.round((parseISO(endOf(b)) - parseISO(b.date)) / 864e5) + 1);
const addDays = (iso, n) => { const d = parseISO(iso); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
export const isOverdue = b => { const inv = docOf(b, 'invoice'); return !!(inv && inv.status === 'Sent' && inv.due && inv.due < todayISO()); };
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
export function renderMoneyDoc(b, kind) {
  const K = KINDS[kind], doc = docOf(b, kind), t = totals(doc), bl = billing(), contacts = (b.stakeholders || []).filter(s => s.name);
  const kv = (k, v, cls = '') => h('div', { class: 'cs-kv ' + cls }, h('span', null, k), h('b', null, v));
  return h('article', { class: 'cs-doc money-doc' },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, partyLines()[0] || 'Vdex'), h('div', { class: 'cs-kicker' }, K.label.toUpperCase())),
      h('div', { class: 'cs-when' }, h('b', null, doc.number), h('div', null, fmtShort(doc.date)), doc[K.dateKey] && h('div', null, `${K.dateLabel} ${fmtShort(doc[K.dateKey])}`))),
    h('div', { class: 'money-parties' },
      h('div', null, h('h4', null, 'From'), ...partyLines().map(l => h('div', null, l))),
      h('div', null, h('h4', null, 'To'), h('div', null, b.client || (contacts[0] && contacts[0].name) || '—'), ...contacts.slice(0, 3).map(s => h('div', null, [s.name, s.role, s.email || s.phone].filter(Boolean).join(' · '))))),
    h('h2', null, b.title), h('div', { class: 'cs-sub' }, dateLabel(b)),
    h('table', null, h('thead', null, h('tr', null, h('th', null, 'Description'), h('th', { class: 'num' }, 'Qty'), h('th', null, 'Unit'), h('th', { class: 'num' }, 'Price'), h('th', { class: 'num' }, 'Amount'))),
      h('tbody', null, ...t.lines.map(l => h('tr', null, h('td', null, l.desc || ''), h('td', { class: 'num' }, String(l.qty ?? '')), h('td', null, l.unit || ''), h('td', { class: 'num' }, l.price === '' || l.price == null ? '' : fmtMoney(l.price)), h('td', { class: 'num' }, fmtMoney(l.amount)))))),
    h('div', { class: 'money-totals' }, kv('Subtotal', fmtMoney(t.subtotal)), t.rate > 0 && kv(`${doc.taxLabel || bl.taxLabel} ${t.rate}%`, fmtMoney(t.tax)), kv('Total', fmtMoney(t.total), 'total'),
      kind === 'invoice' && t.deposit > 0 && kv('Already paid', '-' + fmtMoney(t.deposit)), kind === 'invoice' && t.deposit > 0 && kv('Balance due', fmtMoney(t.balance), 'total')),
    doc.notes && h('section', { class: 'cs-sec' }, h('h4', null, kind === 'quote' ? 'Notes' : 'Terms'), h('p', { class: 'cs-pre' }, doc.notes)),
    kind === 'invoice' && bl.payment && h('section', { class: 'cs-sec' }, h('h4', null, 'How to pay'), h('p', { class: 'cs-pre' }, bl.payment)),
    h('footer', { class: 'cs-foot' }, `${partyLines().join(' · ')} · ${K.label} ${doc.number}${doc.status && doc.status !== 'Draft' ? ' · ' + doc.status : ''}`));
}
export function moneyText(b, kind) {
  const K = KINDS[kind], doc = docOf(b, kind), t = totals(doc), bl = billing();
  const out = [`${K.label.toUpperCase()} ${doc.number} — ${b.title}`, `From: ${partyLines().join(' · ')}`, `To: ${[b.client, ...(b.stakeholders || []).map(s => s.name)].filter(Boolean).join(', ')}`, `Date: ${fmtShort(doc.date)}${doc[K.dateKey] ? ` · ${K.dateLabel}: ${fmtShort(doc[K.dateKey])}` : ''}`, '',
    ...t.lines.map(l => `${l.desc}  ${l.qty ?? ''} ${l.unit || ''} × ${fmtMoney(l.price)} = ${fmtMoney(l.amount)}`), '',
    `Subtotal: ${fmtMoney(t.subtotal)}`, t.rate > 0 ? `${doc.taxLabel || bl.taxLabel} ${t.rate}%: ${fmtMoney(t.tax)}` : null, `Total: ${fmtMoney(t.total)}`,
    kind === 'invoice' && t.deposit > 0 ? `Already paid: ${fmtMoney(t.deposit)} · Balance due: ${fmtMoney(t.balance)}` : null, doc.notes ? '' : null, doc.notes, kind === 'invoice' && bl.payment ? '\nHow to pay:\n' + bl.payment : null];
  return out.filter(x => x !== null && x !== undefined && x !== false).join('\n');
}
export async function moneyPdf(b, kind) {
  const { makePdf } = await import('./pdf.js');
  const K = KINDS[kind], doc = docOf(b, kind), t = totals(doc), bl = billing();
  const blocks = [{ type: 'title', text: `${K.label} ${doc.number}` }, { type: 'subtitle', text: [fmtShort(doc.date), doc[K.dateKey] && `${K.dateLabel} ${fmtShort(doc[K.dateKey])}`, doc.status !== 'Draft' && doc.status].filter(Boolean).join('   ·   ') },
    { type: 'heading', text: 'From' }, { type: 'text', text: partyLines().join('\n') }, { type: 'heading', text: 'To' }, { type: 'text', text: [b.client, ...(b.stakeholders || []).map(s => [s.name, s.role, s.email || s.phone].filter(Boolean).join(' · '))].filter(Boolean).join('\n') || '—' },
    { type: 'heading', text: b.title }, { type: 'text', text: dateLabel(b), gray: 0.4 },
    { type: 'table', head: ['Description', 'Qty', 'Unit', 'Price', 'Amount'], rows: t.lines.map(l => [l.desc, l.qty, l.unit, l.price === '' || l.price == null ? '' : fmtMoney(l.price), fmtMoney(l.amount)]), widths: [0.46, 0.1, 0.12, 0.16, 0.16] },
    { type: 'kv', k: 'Subtotal', v: fmtMoney(t.subtotal) }];
  if (t.rate > 0) blocks.push({ type: 'kv', k: `${doc.taxLabel || bl.taxLabel} ${t.rate}%`, v: fmtMoney(t.tax) });
  blocks.push({ type: 'kv', k: 'Total', v: fmtMoney(t.total) });
  if (kind === 'invoice' && t.deposit > 0) blocks.push({ type: 'kv', k: 'Already paid', v: '-' + fmtMoney(t.deposit) }, { type: 'kv', k: 'Balance due', v: fmtMoney(t.balance) });
  if (doc.notes) blocks.push({ type: 'heading', text: kind === 'quote' ? 'Notes' : 'Terms' }, { type: 'text', text: doc.notes });
  if (kind === 'invoice' && bl.payment) blocks.push({ type: 'heading', text: 'How to pay' }, { type: 'text', text: bl.payment });
  return makePdf({ title: `${K.label} ${doc.number} — ${b.title}`, blocks, footer: `${partyLines().join(' · ')} · Made with Vdex` });
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
  const mailto = doc ? `mailto:${emails.join(',')}?` + new URLSearchParams({ subject: `${K.label} ${doc.number} — ${b.title}`, body: text() }).toString().replace(/\+/g, '%20') : '';
  const addLines = (source, label) => { const have = new Set((doc.lines || []).map(l => (l.desc || '').toLowerCase())); const add = suggestLines(b, kind, source).filter(l => !have.has((l.desc || '').toLowerCase())); if (!add.length) return toast('Nothing new to add'); saveDoc(b.id, kind, { ...doc, lines: [...(doc.lines || []), ...add] }); toast(`${add.length} line${add.length === 1 ? '' : 's'} added from ${label}`); };
  const t = doc && totals(doc);
  const stateCls = doc && (doc.status === 'Paid' || doc.status === 'Accepted' ? 'synced' : isOverdue(b) || doc.status === 'Declined' ? 'error' : '');
  return h('div', { class: 'cs-page money-page' },
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => go({ view: 'booking', id: b.id }) }, '‹ Booking'),
      h('div', { class: 'seg', role: 'tablist' }, ...Object.entries(KINDS).map(([k, v]) => h('button', { role: 'tab', class: k === kind ? 'on' : '', 'aria-selected': k === kind, onclick: () => go({ kind: k }) }, v.label + (b[k] ? ' ✓' : ''))))),
    h('h1', null, K.label), h('div', { class: 'muted' }, [b.title, b.client].filter(Boolean).join(' · ')),
    doc ? [
      h('div', { class: 'card-row' }, h('p', { class: 'status-line', 'data-state': stateCls }, `${doc.status}${isOverdue(b) ? ' · overdue' : ''} · ${fmtMoney(t.total)}${kind === 'invoice' && t.deposit > 0 ? ' · balance ' + fmtMoney(t.balance) : ''}${doc.sentAt ? ' · sent ' + fmtShort(ymd(new Date(doc.sentAt))) : ''}${doc.paidAt ? ' · paid ' + fmtShort(ymd(new Date(doc.paidAt))) : ''}`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editMoney(b, kind, refresh) }, '✏️ Edit'),
        doc.status === 'Draft' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Sent') }, 'Mark as sent'),
        kind === 'quote' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Accepted') }, '✅ Accepted'),
        kind === 'invoice' && doc.status === 'Sent' && h('button', { class: 'btn ghost', onclick: () => setDocStatus(b.id, kind, 'Paid') }, '✅ Paid'),
        h('button', { class: 'btn ghost small', onclick: () => addLines('booking', 'the booking') }, '＋ Lines from the booking'),
        kind === 'invoice' && b.quote && h('button', { class: 'btn ghost small', onclick: () => addLines('quote', 'the quote') }, '＋ Lines from the quote'),
        kind === 'invoice' && h('button', { class: 'btn ghost small', onclick: () => addLines('hours', 'the hours logged') }, '＋ Lines from hours logged')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', onclick: () => printElement(renderMoneyDoc(byId('bookings', b.id), kind)) }, '🖨 Print'),
        h('button', { class: 'btn ghost', onclick: pdf }, '📄 Save PDF'),
        h('a', { class: 'btn ghost', href: mailto, title: emails.length ? `To: ${emails.join(', ')}` : 'Add contact emails on the booking' }, emails.length ? `✉ Email client (${emails.length})` : '✉ Email'),
        h('button', { class: 'btn ghost small', onclick: share }, '📤 Share'), h('button', { class: 'btn ghost small', onclick: web }, '💾 Web page'), h('button', { class: 'btn ghost small', onclick: copy }, 'Copy text')),
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
  const row = kind => { const doc = docOf(b, kind), K = KINDS[kind]; return h('div', { class: 'card-row' }, h('div', null, h('strong', null, K.label), h('div', { class: 'muted small' }, doc ? `${doc.number} · ${doc.status}${isOverdue(b) && kind === 'invoice' ? ' · overdue' : ''} · ${fmtMoney(totals(doc).total)}` : 'none yet')), h('button', { class: 'btn ghost small', onclick: () => go({ view: 'money', id: b.id, kind }) }, doc ? 'Open' : 'Create')); };
  return h('section', { class: 'block', id: 'bk-money' }, h('h3', null, 'Money'), h('div', { class: 'card stack' }, row('quote'), row('invoice')));
}

/* --------------------------------- overview --------------------------------- */
export function openMoney(onOpen) {
  const today = todayISO(), year = today.slice(0, 4);
  const list = db.bookings.filter(b => b.quote || b.invoice).sort((x, y) => y.date.localeCompare(x.date));
  const sum = (f) => list.reduce((s, b) => s + f(b), 0);
  const invSent = b => (b.invoice && b.invoice.status === 'Sent' ? totals(b.invoice).balance : 0);
  const outstanding = sum(invSent), overdue = sum(b => (isOverdue(b) ? invSent(b) : 0));
  const paidYear = sum(b => (b.invoice && b.invoice.status === 'Paid' && (b.invoice.paidAt ? ymd(new Date(b.invoice.paidAt)) : b.invoice.date).startsWith(year) ? totals(b.invoice).total : 0));
  const quotedOpen = sum(b => (b.quote && b.quote.status === 'Sent' ? totals(b.quote).total : 0));
  let close = () => {};
  const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
  const csv = () => {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['Number', 'Date', 'Due', 'Client', 'Project', 'Subtotal', 'Tax', 'Total', 'Status', 'Paid on'].map(q).join(',')];
    for (const b of list.filter(x => x.invoice).sort((x, y) => String(x.invoice.number).localeCompare(String(y.invoice.number)))) { const t = totals(b.invoice); rows.push([b.invoice.number, b.invoice.date, b.invoice.due, b.client, b.title, t.subtotal.toFixed(2), t.tax.toFixed(2), t.total.toFixed(2), b.invoice.status, b.invoice.paidAt ? ymd(new Date(b.invoice.paidAt)) : ''].map(q).join(',')); }
    saveOrShare('﻿' + rows.join('\r\n'), `vdex-invoices-${today}.csv`, 'text/csv').then(ok => ok && toast('Invoices exported'));
  };
  const body = h('div', { class: 'stack' },
    h('div', { class: 'stats' }, stat(fmtMoney(outstanding), 'invoiced, unpaid'), stat(fmtMoney(overdue), 'overdue', overdue ? 'bad' : ''), stat(fmtMoney(quotedOpen), 'quoted, awaiting'), stat(fmtMoney(paidYear), `paid in ${year}`)),
    list.length ? h('div', { class: 'list' }, ...list.map(b => h('button', { class: 'card tap', type: 'button', onclick: () => { close(); onOpen(b); } },
      h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [b.client, fmtShort(b.date)].filter(Boolean).join(' · '))),
        h('div', { class: 'money-pills' }, b.quote && h('span', { class: 'pill ' + (b.quote.status === 'Accepted' ? 'st-confirmed' : b.quote.status === 'Declined' ? 'st-cancelled' : 'st-enquiry') }, `Q ${b.quote.status} ${fmtMoney(totals(b.quote).total)}`),
          b.invoice && h('span', { class: 'pill ' + (b.invoice.status === 'Paid' ? 'st-confirmed' : isOverdue(b) ? 'st-cancelled' : 'st-enquiry') }, `Inv ${isOverdue(b) ? 'Overdue' : b.invoice.status} ${fmtMoney(totals(b.invoice).total)}`))))))
      : h('p', { class: 'muted' }, 'No quotes or invoices yet. Open a booking and create one under Money.'),
    h('div', { class: 'actions' }, list.some(b => b.invoice) && h('button', { class: 'btn ghost small', onclick: csv }, '⬇ Invoices (CSV) for the accountant')));
  ({ close } = sheet('Money', body));
}

/* --------------------------------- settings --------------------------------- */
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
    field('Payment terms (on every invoice)', 'terms', 'textarea'), field('How to pay: bank details, PayPal, etc.', 'payment', 'textarea'));
  return wrap;
}

// The Quote & invoice box on a show, a session or an other booking: a tab for each document. With none yet, it shows
// what Gigdex would start it with (the show's fee, the studio time and players, the booking's fee) and makes it in one
// tap; with one, its lines, totals and payments, what to do next (send, accept, record a payment) and the ways to
// send it (the client's link, email, print, a web page, text). The documents live in js/money.js.
import { h, toast, ymd } from '../util.js';
import { byId, redraw } from '../store.js';
import { fmtMoney } from '../model.js';
import { dateText } from '../money-doc.js';
import {
  KINDS, statusLabel, calc, qtyText, docOf, docTotals, isOverdue, isPaid, suggestLines, createDoc, setStatus, recordPayment, removePayment,
  openEditor, openShareSheet, printDoc, saveWebPage, copyText, previewDoc, mailtoFor, shareLink, contactEmail,
} from '../money.js';

const tabs = new Map(); // booking id → the tab last opened ('quote' | 'invoice'), kept across redraws
// "11 Dec" this year, "11 Dec 2027" otherwise.
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }); };
const tabOf = b => tabs.get(b.id) || (docOf(b, 'invoice') || !docOf(b, 'quote') ? 'invoice' : 'quote');

// The pill for a document's status.
function statusPill(b, kind, doc) {
  const t = docTotals(doc);
  if (kind === 'invoice' && isOverdue(b)) return h('span', { class: 'pill mn-over mn-pill' }, 'Overdue');
  if (kind === 'invoice' && isPaid(doc)) return h('span', { class: 'pill st-settled mn-pill' }, 'Paid');
  if (kind === 'invoice' && doc.status !== 'void' && t.paid > 0 && t.due > 0) return h('span', { class: 'pill st-advanced mn-pill' }, 'Part paid');
  const tone = { draft: 'st-hold', sent: 'st-offer', accepted: 'st-confirmed', declined: 'st-cancelled', paid: 'st-settled', void: 'st-cancelled' }[doc.status] || 'st-hold';
  return h('span', { class: `pill ${tone} mn-pill` }, statusLabel(kind, doc.status));
}

// No document yet: what it would start with, and the buttons that make it.
function makeView(b, kind) {
  const K = KINDS[kind], s = suggestLines(b, kind), quote = docOf(b, 'quote');
  const net = s.lines.reduce((t, l) => t + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  return h('div', { class: 'mn-make stack' },
    h('p', { class: 'muted small mn-lead' }, kind === 'quote' ? 'No quote yet. Gigdex starts one from the booking with:' : 'No invoice yet. Gigdex starts one from the booking with:'),
    h('ul', { class: 'mn-suggest' },
      ...s.lines.map(l => h('li', null, h('span', null, l.desc, h('small', { class: 'muted' }, ` · ${qtyText(l.qty, l.unit)}`)), h('b', null, l.price === '' ? 'no price yet' : fmtMoney((Number(l.qty) || 0) * Number(l.price))))),
      ...s.payments.map(p => h('li', { class: 'mn-suggest-pay' }, h('span', null, p.method), h('b', null, '−' + fmtMoney(p.amount))))),
    s.hint && h('p', { class: 'small muted' }, s.hint),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', id: `mn-make-${kind}`, onclick: () => { const d = createDoc(b.id, kind, 'booking'); if (d) toast(`${K.label} ${d.number} started${net > 0 ? ': ' + fmtMoney(net) : ''}`); } }, kind === 'quote' ? 'Make the quote' : 'Make the invoice'),
      kind === 'invoice' && quote && h('button', { class: 'btn ghost', type: 'button', id: 'mn-make-from-quote', onclick: () => { const d = createDoc(b.id, 'invoice', 'quote'); if (d) toast(`Invoice ${d.number} made from quote ${quote.number}`); } }, `From quote ${quote.number}`),
      h('button', { class: 'btn ghost', type: 'button', id: `mn-blank-${kind}`, onclick: () => { const d = createDoc(b.id, kind, 'blank'); if (d) openEditor(b.id, kind); } }, 'Start blank')));
}

// A document: number, status, dates, lines, totals, payments, next steps and the ways to send it.
function docView(b, kind, doc) {
  const K = KINDS[kind], t = calc(doc), tot = docTotals(doc), isInv = kind === 'invoice', email = contactEmail(b);
  const dates = [doc.issued && `Dated ${dateText(doc.issued)}`, doc.due && `${K.dueLabel.toLowerCase()} ${dateText(doc.due)}`, doc.sentAt && doc.status !== 'draft' && `sent ${dateText(ymd(new Date(doc.sentAt)))}`].filter(Boolean).join(' · ');
  const stat = (v, l, cls = '') => h('div', { class: 'stat ' + cls }, h('b', null, v), h('span', null, l));
  // The email opens addressed to the booking's contact; the client's link is added once it is packed.
  const mail = h('a', { class: 'btn ghost small', id: `mn-email-${kind}`, href: mailtoFor(b.id, kind), title: email ? `To ${email}` : 'No email for the contact on this booking' }, isOverdue(b) && kind === 'invoice' ? '✉ Send a reminder' : '✉ Email the client');
  shareLink(b.id, kind).then(url => { mail.href = mailtoFor(b.id, kind, url); }).catch(() => {});
  const next = [];
  if (doc.status === 'draft') next.push(h('button', { class: 'btn primary small', type: 'button', id: `mn-sent-${kind}`, onclick: () => setStatus(b.id, kind, 'sent') }, '✓ Mark as sent'));
  if (kind === 'quote' && doc.status === 'sent') next.push(h('button', { class: 'btn primary small', type: 'button', id: 'mn-accepted', onclick: () => setStatus(b.id, 'quote', 'accepted') }, '✓ Accepted'), h('button', { class: 'btn ghost small', type: 'button', id: 'mn-declined', onclick: () => setStatus(b.id, 'quote', 'declined') }, 'Declined'));
  if (kind === 'quote' && !docOf(b, 'invoice') && doc.status !== 'declined') next.push(h('button', { class: (doc.status === 'accepted' ? 'btn primary' : 'btn ghost') + ' small', type: 'button', id: 'mn-quote-to-invoice', onclick: () => { const d = createDoc(b.id, 'invoice', 'quote'); if (d) { tabs.set(b.id, 'invoice'); toast(`Invoice ${d.number} made from quote ${doc.number}`); } } }, '→ Make the invoice from this quote'));
  if (isInv && doc.status !== 'void' && tot.due > 0) next.push(h('button', { class: (doc.status === 'draft' ? 'btn ghost' : 'btn primary') + ' small', type: 'button', id: 'mn-pay', onclick: () => recordPayment(b.id) }, '💳 Record a payment'));
  if (isInv && doc.status === 'sent' && tot.paid === 0) next.push(h('button', { class: 'btn ghost small', type: 'button', id: 'mn-void', onclick: () => setStatus(b.id, 'invoice', 'void') }, 'Void'));
  return h('div', { class: 'mn-doc stack' },
    h('div', { class: 'mn-doc-head' },
      h('div', { class: 'mn-doc-id' }, h('strong', null, `${K.label} ${doc.number}`), statusPill(b, kind, doc)),
      dates && h('div', { class: 'muted small' }, dates)),
    isInv && isOverdue(b) && h('p', { class: 'warn' }, `${fmtMoney(tot.due)} was due on ${dateText(doc.due)}. “Email the client” sends a reminder with the link.`),
    h('div', { class: 'stats mn-doc-stats' }, stat(fmtMoney(tot.total), t.rate > 0 ? `total with ${doc.taxName || 'tax'}` : 'total'),
      isInv ? stat(fmtMoney(tot.paid), 'paid') : stat(String(doc.lines.length), doc.lines.length === 1 ? 'line' : 'lines'),
      isInv ? stat(fmtMoney(tot.due), doc.status === 'void' ? 'void' : 'due', isOverdue(b) ? 'bad' : '') : stat(doc.due ? shortDate(doc.due) : '—', 'valid until')),
    h('ul', { class: 'mn-doc-lines', 'aria-label': `Lines on ${K.label.toLowerCase()} ${doc.number}` },
      ...(t.lines.length ? t.lines.map(l => h('li', null, h('span', null, l.desc || '—', h('small', { class: 'muted' }, ` · ${qtyText(l.qty, l.unit)}${l.price === '' || l.price == null ? '' : ' × ' + fmtMoney(l.price)}`)), h('b', null, fmtMoney(l.amount))))
        : [h('li', { class: 'muted' }, 'No lines yet: tap Edit to add them.')]),
      t.rate > 0 && h('li', { class: 'mn-doc-tax' }, h('span', null, `${doc.taxName || 'Tax'} ${t.rate}%`), h('b', null, fmtMoney(t.tax)))),
    isInv && doc.payments.length > 0 && h('div', { class: 'mn-payments' }, h('h4', null, 'Payments'),
      ...doc.payments.map(p => h('div', { class: 'card-row mn-payment' }, h('div', null, h('strong', null, fmtMoney(p.amount)), h('div', { class: 'muted small' }, [p.date && dateText(p.date), p.method].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove the payment of ${fmtMoney(p.amount)}${p.date ? ' on ' + dateText(p.date) : ''}`, onclick: () => removePayment(b.id, p.id) }, '✕')))),
    h('div', { class: 'actions mn-doc-actions' },
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-edit-${kind}`, onclick: () => openEditor(b.id, kind) }, '✏️ Edit'), ...next),
    h('div', { class: 'mn-send' },
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-link-${kind}`, onclick: () => openShareSheet(b.id, kind) }, '🔗 Client link'),
      mail,
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-preview-${kind}`, onclick: () => previewDoc(b.id, kind) }, '👁 Preview'),
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-print-${kind}`, onclick: () => printDoc(b.id, kind) }, '🖨 Print'),
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-web-${kind}`, 'aria-label': 'Save as a web page', title: 'Save as a web page (to attach to an email)', onclick: () => saveWebPage(b.id, kind) }, '💾 Web page'),
      h('button', { class: 'btn ghost small', type: 'button', id: `mn-copy-${kind}`, onclick: () => copyText(b.id, kind) }, '📋 Copy text')),
    !email && h('p', { class: 'small muted' }, 'Add an email for the contact on this booking and “Email the client” is addressed for you.'));
}

export default {
  id: 'money', title: 'Quote & invoice', icon: '💰', order: 70,
  kinds: ['show', 'session', 'other'],
  summary(b) {
    const inv = docOf(b, 'invoice'), q = docOf(b, 'quote');
    if (inv) {
      const t = docTotals(inv);
      if (inv.status === 'void') return `Invoice ${inv.number} · void`;
      if (isPaid(inv)) return `Invoice ${inv.number} · paid`;
      if (inv.status === 'draft') return `Invoice ${inv.number} · draft · ${fmtMoney(t.total)}`;
      return `Invoice ${inv.number} · ${fmtMoney(t.due)} ${isOverdue(b) ? 'overdue' : 'due'}`;
    }
    if (q) { const t = docTotals(q); return `Quote ${statusLabel('quote', q.status).toLowerCase()}${t.total ? ' · ' + fmtMoney(t.total) : ''}`; }
    return '';
  },
  render(b) {
    b = byId('bookings', b.id) || b;
    const kind = tabOf(b), doc = docOf(b, kind);
    // Switching tabs is a view change only: the page is drawn again with the other document.
    const tab = k => { const d = docOf(b, k); return h('button', { type: 'button', role: 'tab', id: `mn-tab-${k}`, class: k === kind ? 'on' : '', 'aria-selected': String(k === kind), tabIndex: k === kind ? 0 : -1, 'aria-controls': 'mn-panel', onclick: () => { if (k === kind) return; tabs.set(b.id, k); redraw(); } },
      KINDS[k].label, d && h('small', { class: 'mn-tab-st' }, ' · ' + statusLabel(k, d.status).toLowerCase())); };
    return h('div', { class: 'mn-block' },
      h('div', { class: 'seg mn-tabs', role: 'tablist', 'aria-label': 'Quote or invoice', onkeydown: e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); const k = kind === 'quote' ? 'invoice' : 'quote'; tabs.set(b.id, k); redraw();
        setTimeout(() => document.getElementById(`mn-tab-${k}`)?.focus(), 0);
      } }, tab('quote'), tab('invoice')),
      h('div', { id: 'mn-panel', role: 'tabpanel', 'aria-labelledby': `mn-tab-${kind}` }, doc ? docView(b, kind, doc) : makeView(b, kind)));
  },
  tutorial: [
    { title: 'Quote & invoice', text: 'One quote and one invoice per booking. Gigdex starts them from the booking: a show’s fee, a session’s studio time and players, or the booking’s fee.', target: ['#blk-money'] },
    { title: 'Quote or invoice', text: 'Switch between the two. A quote becomes the invoice in one tap once it is accepted.', target: ['.mn-tabs'] },
    { title: 'Next step', text: 'Edit the lines, mark it as sent, and record payments as they arrive. Paid in full ticks the checklist for you.', target: ['.mn-doc-actions', '.mn-make'] },
    { title: 'Send it', text: 'A link the client opens on any phone with Pay buttons, an email, a printout or a web page to attach.', target: ['.mn-send'] },
  ],
};

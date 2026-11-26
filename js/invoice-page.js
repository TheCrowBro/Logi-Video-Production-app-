// The page a client opens from the link: the quote or invoice packed into the URL fragment, drawn by the same
// renderer the app uses, with Pay buttons for the balance. No store, no account, nothing fetched but this page.
import { h, todayISO } from './util.js';
import { unpack } from './link-pack.js';
import { KINDS, calc, renderDoc, pdfBlocks, docTitle, fmt, fmtDate, isPaid, owing } from './money-doc.js';
import { docCss, docPrintCss } from './doc-css.js';
import { qrSvg } from './qr.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
addEventListener('hashchange', () => location.reload()); // another invoice link opened in this same tab: draw that one
// old: the browser cannot unpack any link, so a fresh one would not help; the PDF would.
const fail = (msg, old = false) => { box.replaceChildren(h('div', { class: 'msg' }, h('h2', null, 'This link does not open an invoice'), h('p', null, msg), h('p', null, old ? 'Or ask the person who sent it for the PDF.' : 'Ask the person who sent it for a fresh link, or for the PDF.'))); };
const save = (text, name, type) => { const a = h('a', { href: URL.createObjectURL(new File([text], name, { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
const slug = s => String(s || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

(async () => {
  let snap;
  try { snap = await unpack(location.hash); } catch (e) { return fail(e.message || 'It is incomplete or damaged.', e.code === 'old'); }
  if (!snap || !KINDS[snap.kind] || !snap.number) return fail('It is incomplete or damaged.');
  const K = KINDS[snap.kind], t = calc(snap);
  document.title = docTitle(snap);
  document.head.append(h('style', null, docCss('.paper ') + '\n' + docPrintCss));
  const paid = isPaid(snap), due = owing(snap); // an invoice with nothing left to pay (a credit note, a zero total) is neither due nor overdue
  const overdue = due && snap.due && snap.due < todayISO();
  const tag = snap.kind === 'invoice'
    ? (paid ? h('span', { class: 'tag paid' }, 'Paid, thank you') : snap.status === 'Void' ? h('span', { class: 'tag' }, 'Void') : !due ? h('span', { class: 'tag' }, 'Nothing to pay') : h('span', { class: 'tag' + (overdue ? ' over' : '') }, `${fmt(t.balance, snap.currency)} due${snap.due ? (overdue ? ', was due ' : ' by ') + fmtDate(snap.due) : ''}`))
    : h('span', { class: 'tag' }, snap.status === 'Accepted' ? 'Accepted' : snap.until ? `Valid until ${fmtDate(snap.until)}` : 'Quote');
  const pdf = async () => { try { const { makePdf } = await import('./pdf.js'); save(makePdf({ title: docTitle(snap), blocks: pdfBlocks(snap), footer: `${(snap.from || []).join(' · ')} · Made with Vdex` }), `${snap.kind}-${slug(snap.number)}.pdf`, 'application/pdf'); } catch (e) { alert('Could not make the PDF: ' + (e.message || e)); } };
  bar.replaceChildren(
    h('div', { class: 'who' }, `${K.label} ${snap.number}`, h('small', null, [(snap.from || [])[0] ? `from ${snap.from[0]}` : '', snap.title || ''].filter(Boolean).join(' · '))),
    h('div', { class: 'acts' }, tag, h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print'), h('button', { class: 'btn', type: 'button', onclick: pdf }, 'Save PDF'), snap.email && h('a', { class: 'btn', href: `mailto:${snap.email}?subject=${encodeURIComponent(`${K.label} ${snap.number}`)}` }, 'Reply')));
  box.replaceChildren(h('div', { class: 'paper' }, renderDoc(snap, { qr: qrSvg })));
})();

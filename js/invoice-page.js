// The page a client opens from the link: the quote or invoice packed into the URL fragment, drawn by the same
// renderer the app uses, with Pay buttons for the balance. No store, no account, nothing fetched but this page.
import { h, fmtShort, todayISO } from './util.js';
import { unpack } from './link-pack.js';
import { KINDS, calc, renderDoc, pdfBlocks, docTitle, fmt } from './money-doc.js';
import { docCss, docPrintCss } from './doc-css.js';
import { qrSvg } from './qr.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
const fail = msg => { box.replaceChildren(h('div', { class: 'msg' }, h('h2', null, 'This link does not open an invoice'), h('p', null, msg), h('p', null, 'Ask the person who sent it for a fresh link, or for the PDF.'))); };
const save = (text, name, type) => { const a = h('a', { href: URL.createObjectURL(new File([text], name, { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
const slug = s => String(s || 'doc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

(async () => {
  let snap;
  try { snap = await unpack(location.hash); } catch (e) { return fail(e.message || 'It is incomplete or damaged.'); }
  if (!snap || !KINDS[snap.kind] || !snap.number) return fail('It is incomplete or damaged.');
  const K = KINDS[snap.kind], t = calc(snap);
  document.title = docTitle(snap);
  document.head.append(h('style', null, docCss('.paper ') + '\n' + docPrintCss));
  const paid = snap.kind === 'invoice' && (snap.status === 'Paid' || (t.total > 0 && t.balance <= 0));
  const overdue = snap.kind === 'invoice' && !paid && snap.status !== 'Void' && snap.due && snap.due < todayISO();
  const tag = snap.kind === 'invoice'
    ? (paid ? h('span', { class: 'tag paid' }, 'Paid, thank you') : snap.status === 'Void' ? h('span', { class: 'tag' }, 'Void') : h('span', { class: 'tag' + (overdue ? ' over' : '') }, `${fmt(t.balance, snap.currency)} due${snap.due ? (overdue ? ', was due ' : ' by ') + fmtShort(snap.due) : ''}`))
    : h('span', { class: 'tag' }, snap.status === 'Accepted' ? 'Accepted' : snap.until ? `Valid until ${fmtShort(snap.until)}` : 'Quote');
  const pdf = async () => { try { const { makePdf } = await import('./pdf.js'); save(makePdf({ title: docTitle(snap), blocks: pdfBlocks(snap), footer: `${(snap.from || []).join(' · ')} · Made with Vdex` }), `${snap.kind}-${slug(snap.number)}.pdf`, 'application/pdf'); } catch (e) { alert('Could not make the PDF: ' + (e.message || e)); } };
  bar.replaceChildren(
    h('div', { class: 'who' }, `${K.label} ${snap.number}`, h('small', null, `from ${(snap.from || [])[0] || 'Vdex'}${snap.title ? ' · ' + snap.title : ''}`)),
    h('div', { class: 'acts' }, tag, h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print'), h('button', { class: 'btn', type: 'button', onclick: pdf }, 'Save PDF'), snap.email && h('a', { class: 'btn', href: `mailto:${snap.email}?subject=${encodeURIComponent(`${K.label} ${snap.number}`)}` }, 'Reply')));
  box.replaceChildren(h('div', { class: 'paper' }, renderDoc(snap, { qr: qrSvg })));
})();

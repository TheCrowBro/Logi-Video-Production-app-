// The page a client opens from the link: the quote or invoice packed into the URL fragment (js/link-pack.js), checked
// field by field (a link can be made by anyone), and drawn by the same renderer the app uses, with Pay buttons for the
// balance and the bank details with a QR. No store, no account, nothing fetched but this page's own files.
import { h } from './util.js';
import { unpack } from './link-pack.js';
import { KINDS, calc, renderDoc, docTitle, fmtDoc, dateText, cleanSnapshot, isPaidDoc } from './money-doc.js';
import { docCss, docPrintCss } from './doc-css.js';
import { qrSvg } from './qr.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
document.head.append(h('style', null, docCss('.paper ') + '\n' + docPrintCss));

function fail(msg) {
  document.title = 'Gdex';
  bar.replaceChildren();
  box.replaceChildren(h('div', { class: 'msg', role: 'alert' }, h('h2', null, 'This link does not open a document'), h('p', null, msg), h('p', null, 'Ask the person who sent it for a fresh link.')));
}

async function show() {
  if (!location.hash || location.hash.length < 3) return fail('The link is incomplete: the part after # is missing.');
  let raw;
  try { raw = await unpack(location.hash); } catch { return fail('The link is incomplete or damaged. It may have been cut short when it was copied.'); }
  const snap = cleanSnapshot(raw);
  if (!snap) return fail('The link does not hold a quote or an invoice.');
  const K = KINDS[snap.kind], t = calc(snap), sym = snap.currency;
  document.title = docTitle(snap);
  const isInv = snap.kind === 'invoice', paid = isPaidDoc(snap), overdue = isInv && !paid && snap.status !== 'void' && t.due > 0 && snap.due && snap.due < today();
  const tag = isInv
    ? (paid ? h('span', { class: 'tag paid' }, 'Paid, thank you') : snap.status === 'void' ? h('span', { class: 'tag void' }, 'Void')
      : t.due > 0 ? h('span', { class: 'tag' + (overdue ? ' over' : '') }, `${fmtDoc(t.due, sym)} due${snap.due ? (overdue ? ', was due ' : ' by ') + dateText(snap.due) : ''}`) : null)
    : h('span', { class: 'tag' }, snap.status === 'accepted' ? 'Accepted' : snap.status === 'declined' ? 'Declined' : snap.due ? `Valid until ${dateText(snap.due)}` : 'Quote');
  const paper = h('div', { class: 'paper' }, renderDoc(snap, { qr: qrSvg }));
  const paySec = paper.querySelector('.pay-sec');
  if (paySec) paySec.id = 'pay';
  const canPay = isInv && !paid && snap.status !== 'void' && t.due > 0 && paySec && paySec.querySelector('.pay-btn, .cs-pre');
  bar.replaceChildren(
    h('div', { class: 'who' }, `${K.label} ${snap.number}`, h('small', null, [(snap.from || [])[0] && `from ${snap.from[0]}`, snap.title].filter(Boolean).join(' · '))),
    h('div', { class: 'acts' }, tag,
      canPay && h('a', { class: 'btn primary', href: '#pay', id: 'pay-jump', onclick: e => { e.preventDefault(); paySec.scrollIntoView({ behavior: 'smooth', block: 'start' }); (paySec.querySelector('.pay-btn') || paySec).focus?.(); } }, `Pay ${fmtDoc(t.due, sym)}`),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print or save as PDF'),
      snap.email && h('a', { class: 'btn', href: `mailto:${snap.email}?subject=${encodeURIComponent(`${K.label} ${snap.number}`)}` }, 'Reply')));
  box.replaceChildren(paper);
}

window.addEventListener('hashchange', () => { if (location.hash !== '#pay') show(); });
show();

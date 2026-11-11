// The page the band opens from a day sheet link (daysheet.html#…): the sheet was packed into the address by the sender's
// Gigdex, and is drawn here read-only, with Print and Add to calendar. No store, no account, nothing fetched but this
// page. Whatever the link carries goes through cleanDaySheet first: only the day sheet's own fields, as plain text.
import { h, fmtShort } from './util.js';
import { unpack } from './link-pack.js';
import { docCss } from './doc-css.js';
import { fileName } from './print.js';
import { cleanDaySheet, fromLink, renderDaySheet, daySheetIcs, dsDocCss, dayLabel, typeLabel } from './daysheet-doc.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
document.head.append(h('style', { id: 'ds-doc-css' }, docCss('.ds-paper ') + '\n' + dsDocCss('.ds-paper ')));

const fail = (msg, head = 'This link is incomplete') => {
  document.title = 'Day sheet · Gigdex';
  bar.replaceChildren();
  box.replaceChildren(h('div', { class: 'ds-msg', role: 'alert' }, h('h1', null, head), h('p', null, msg), h('p', null, 'Ask whoever sent it for a fresh link.')));
};
const save = (text, name, type) => {
  const url = URL.createObjectURL(new File([text], name, { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};

let token = 0;
async function show() {
  const n = ++token;
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return fail('It has no day sheet in it: the part after the # is missing. Copy the whole link and open it again.');
  let raw;
  try { raw = await unpack(hash); } catch { if (n === token) fail('Part of it is missing or damaged: it may have been cut off when it was copied.'); return; }
  if (n !== token) return;
  if (raw && typeof raw === 'object' && Number(raw.v) > 1) return fail('It was made by a newer version of Gigdex than this page knows. Reload the page; if that does not help, ask for a fresh link.', 'This day sheet is too new for this page');
  const d = raw && typeof raw === 'object' && Number(raw.v) === 1 ? cleanDaySheet(fromLink(raw)) : null;
  if (!d || !(d.title || d.date || d.times.length)) return fail('It does not hold a day sheet Gigdex can read.');

  document.title = `${d.title || typeLabel(d)}${d.date ? ' – ' + fmtShort(d.date) : ''} · Day sheet`;
  const from = [d.from.name, d.from.business].filter(Boolean).join(' · ');
  const ics = daySheetIcs(d, location.href);
  bar.replaceChildren(
    h('div', { class: 'ds-who' }, h('span', { class: 'ds-kick' }, 'Day sheet'), h('strong', null, d.title || typeLabel(d)), h('small', null, [dayLabel(d, fmtShort), from && 'from ' + from].filter(Boolean).join(' · '))),
    h('div', { class: 'ds-acts' },
      ics && h('button', { class: 'ds-btn', type: 'button', onclick: () => save(ics, fileName(`${d.title || 'Day sheet'}${d.date ? ' ' + d.date : ''}`, 'ics'), 'text/calendar') }, '📆 Add to calendar'),
      h('button', { class: 'ds-btn', type: 'button', onclick: () => window.print() }, '🖨 Print')));
  box.replaceChildren(h('div', { class: 'ds-paper' }, renderDaySheet(d)));
}
addEventListener('hashchange', show); // another day sheet opened in this same tab
show();

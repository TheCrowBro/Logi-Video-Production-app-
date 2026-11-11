// Printing and saving documents (day sheets, setlists, riders, split sheets, quotes and invoices) from the app itself:
// no pop-up window, so it works in the installed app too. Documents are plain elements styled by js/doc-css.js
// (.cs-doc, .cs-head, .cs-sec, .cs-kv, tables…) plus any extra CSS the caller passes.
import { h, toast } from './util.js';
import { docCss, docPrintCss } from './doc-css.js';

function ensurePrintCss() {
  if (document.getElementById('gd-print-css')) return;
  document.head.append(h('style', { id: 'gd-print-css' }, `#print-root{display:none}@media print{@page{margin:14mm}body.print-doc>*:not(#print-root){display:none!important}body.print-doc{background:#fff}body.print-doc #print-root{display:block}${docCss('#print-root ')}#print-root .cs-doc{padding:0;max-width:none}}`));
}

// Print an element. extraCss is scoped by the caller (write selectors that start with #print-root).
export function printElement(el, extraCss = '') {
  ensurePrintCss();
  const style = extraCss ? h('style', null, `@media print{${extraCss}}`) : null;
  const root = h('div', { id: 'print-root' }, el);
  if (style) document.head.append(style);
  document.body.append(root); document.body.classList.add('print-doc');
  let done = false;
  const finish = () => { if (done) return; done = true; root.remove(); style && style.remove(); document.body.classList.remove('print-doc'); window.removeEventListener('afterprint', finish); };
  window.addEventListener('afterprint', finish);
  setTimeout(() => { try { window.print(); } catch { finish(); toast('Printing is not available here. Use Save as a web page instead.'); } }, 60);
  setTimeout(finish, 90000);
}

// A whole standalone web page for a document (to save, share or email as a file).
export const docPage = (title, el, extraCss = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${docCss('')}${docPrintCss}${extraCss}</style></head><body>${el.outerHTML}</body></html>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Saves a file: the share sheet where the device has one that takes files, else a download.
export async function saveFile(text, name, type = 'text/plain') {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

// A file name from a title: "Day sheet – The Night Owls @ Lantern.html".
export const fileName = (title, ext) => String(title || 'document').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + '.' + ext;

// CSV from rows (arrays of cells).
export const csv = rows => rows.map(r => r.map(c => { const s = c == null ? '' : String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');

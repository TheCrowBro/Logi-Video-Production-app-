// Script files of every kind, read on this device into lines for buildScript (js/docx.js): Word (.docx), PDF, Final
// Draft (.fdx), Fountain and plain text. Nothing is uploaded. Loaded on first use, by the Add script sheet.
//
// PDF: PDF.js 3.11.174 from cdnjs, fetched the first time a PDF is opened, both of its files pinned with Subresource
// Integrity. Its worker's code is loaded as a page script too, so that its integrity can be checked as well (a Worker
// cannot be given one): PDF.js then runs it on the page, which is quick enough for a script.
import { docxToLines, textToLines } from './docx.js';

export const SCRIPT_ACCEPT = '.docx,.pdf,.fdx,.fountain,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const scriptKind = file => {
  const n = String(file.name || '').toLowerCase(), t = String(file.type || '');
  if (/\.docx$/.test(n) || /wordprocessingml/.test(t)) return 'docx';
  if (/\.pdf$/.test(n) || t === 'application/pdf') return 'pdf';
  if (/\.fdx$/.test(n)) return 'fdx';
  return 'text';
};
export async function readScriptFile(file) {
  const kind = scriptKind(file);
  if (kind === 'docx') return docxToLines(file);
  if (kind === 'pdf') return pdfToLines(file);
  if (kind === 'fdx') return fdxToLines(file);
  if (file.size > 20e6) throw new Error('This file is too big to be a script');
  return textToLines(await file.text());
}

/* ------------------------------ Final Draft ------------------------------ */
// A .fdx file is XML: each paragraph says what it is (Scene Heading, Action, Character, Dialogue…), and its text runs
// carry their style (Bold, Italic, Underline). A shot is direction. Dual dialogue keeps its paragraphs in order.
const FDX = { 'scene heading': 'heading', action: 'para', character: 'character', dialogue: 'dialogue', parenthetical: 'paren', transition: 'transition', shot: 'para', general: 'para', 'new act': 'heading', 'end of act': 'heading' };
export async function fdxToLines(file) {
  if (file.size > 30e6) throw new Error('This Final Draft file is too big to open');
  const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.nodeName !== 'FinalDraft') throw new Error('This is not a Final Draft (.fdx) file');
  const content = [...doc.documentElement.children].find(c => c.nodeName === 'Content');
  if (!content) throw new Error('No script found in this Final Draft file');
  const lines = [];
  for (const p of content.getElementsByTagName('Paragraph')) {
    if ([...p.children].some(c => c.nodeName === 'DualDialogue')) continue; // a container: its own paragraphs come next
    const type = String(p.getAttribute('Type') || 'General').toLowerCase();
    if (type === 'cast list') continue;
    let raw = '';
    const marks = [];
    for (const t of p.children) {
      if (t.nodeName !== 'Text') continue;
      const s = t.textContent, st = String(t.getAttribute('Style') || '').toLowerCase();
      const f = (/bold/.test(st) ? 'b' : '') + (/italic/.test(st) ? 'i' : '') + (/underline/.test(st) ? 'u' : '');
      if (f && s) marks.push([raw.length, raw.length + s.length, f]);
      raw += s;
    }
    const text = raw.trim(); if (!text) continue;
    const lead = raw.length - raw.trimStart().length;
    const kept = marks.map(([a, b, f]) => [Math.max(0, a - lead), Math.min(text.length, b - lead), f]).filter(([a, b]) => b > a);
    lines.push({ text, kind: FDX[type] || 'para', ...(type === 'shot' ? { dir: true } : {}), ...(kept.length ? { marks: kept } : {}) });
  }
  if (!lines.length) throw new Error('No script found in this Final Draft file');
  return lines;
}

/* ---------------------------------- PDF ---------------------------------- */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const SRI = {
  'pdf.worker.min.js': 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==',
  'pdf.min.js': 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==',
};
let loading = null;
const load = name => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = PDFJS + name; s.integrity = SRI[name]; s.crossOrigin = 'anonymous';
  s.onload = res; s.onerror = () => { s.remove(); rej(new Error('The PDF reader could not be fetched. It needs a connection the first time; check it and try again, or paste the text.')); };
  document.head.append(s);
});
const pdfjs = () => (loading || (loading = (async () => {
  if (!window.pdfjsWorker) await load('pdf.worker.min.js');
  if (!window.pdfjsLib) await load('pdf.min.js');
  return window.pdfjsLib;
})().catch(e => { loading = null; throw e; })));

// Words on a page come as pieces with a position. Pieces at the same height make a row, left to right; rows make a
// paragraph while they follow on closely at the same indent, as a screenplay's speech or a block of action does. Page
// numbers and the CONTINUED and (MORE) a screenplay puts at page breaks are left out. A page laid out in VIDEO and
// AUDIO columns, with those words heading them, is read as two columns: the audio column is read, the video column is
// direction, each paragraph in its place down the page.
const FURNITURE = /^(\d{1,3}\.?|page \d+( of \d+)?|\(?more\)?|\(?continued\)?:?|\d*\s*continued:?\s*(\(\d+\))?|cont'?d)$/i;
const HEAD_V = /^(video|visuals?|vision|pictures?|images?|shots?|on ?screen)\b/i, HEAD_A = /^(audio|sound|v\.?\s?o\.?|voice ?-?over|narration|dialogue|script|words)\b/i;
function rowsOf(items) {
  const pieces = items.filter(i => i.str && i.str.trim()).map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, size: Math.hypot(i.transform[2], i.transform[3]) || i.height || 10 }));
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const p of pieces) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r.y - p.y) <= Math.max(2, r.size * 0.45)) r.pieces.push(p); else rows.push({ y: p.y, size: p.size, pieces: [p] });
  }
  return rows.map(r => { r.pieces.sort((a, b) => a.x - b.x); return r; });
}
const join = pieces => pieces.reduce((t, p, i) => { if (!i) return p.str; const q = pieces[i - 1], gap = p.x - (q.x + q.w); return t + (gap > p.size * 0.15 && !/\s$/.test(t) && !/^\s/.test(p.str) ? ' ' : '') + p.str; }, '').replace(/\s+/g, ' ').trim();
// Rows into paragraphs: a new one after a gap of more than about one blank line, or at a change of indent.
function paragraphs(rows, page) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const text = join(r.pieces); if (!text || FURNITURE.test(text)) continue;
    const x = r.pieces[0].x;
    if (cur && cur.lastY - r.y <= r.size * 1.9 && Math.abs(cur.x - x) <= r.size * 0.8) { cur.text += ' ' + text; cur.lastY = r.y; continue; }
    cur = { text, x, y: r.y, lastY: r.y, page }; out.push(cur);
  }
  return out;
}
export async function pdfToLines(file) {
  if (file.size > 60e6) throw new Error('This PDF is too big to open');
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const pdf = await task.promise.catch(e => { throw new Error(/password/i.test(e && e.name || '') ? 'This PDF is locked with a password. Save a copy without one, or paste the text.' : 'Could not read this PDF'); });
  const lines = [];
  let split = null; // the x where an AUDIO column starts, once a page has headed its columns
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, 500); n++) {
      const page = await pdf.getPage(n);
      const rows = rowsOf((await page.getTextContent()).items);
      page.cleanup();
      for (const r of rows) {
        const v = r.pieces.find(p => HEAD_V.test(p.str.trim())), a = r.pieces.find(p => HEAD_A.test(p.str.trim()));
        if (v && a && a.x > v.x && r.pieces.length <= 6) { split = { at: a.x - r.size * 0.5, head: r }; break; }
      }
      if (split) {
        const body = rows.filter(r => r !== split.head);
        const left = body.map(r => ({ ...r, pieces: r.pieces.filter(p => p.x < split.at) })).filter(r => r.pieces.length);
        const right = body.map(r => ({ ...r, pieces: r.pieces.filter(p => p.x >= split.at) })).filter(r => r.pieces.length);
        const both = [...paragraphs(left, n).map(p => ({ ...p, dir: true })), ...paragraphs(right, n)].sort((a, b) => b.y - a.y || (a.dir ? -1 : 1));
        both.forEach(p => lines.push(p.dir ? { text: p.text, heading: false, dir: true } : { text: p.text, heading: false }));
      } else {
        paragraphs(rows, n).forEach((p, i) => {
          const last = lines[lines.length - 1];
          // A paragraph carried over from the page before (same indent, its sentence not finished) is joined to it.
          if (i === 0 && last && !last.dir && last.x != null && Math.abs(last.x - p.x) < 2 && !/[.!?:"”')\]]$/.test(last.text)) last.text += ' ' + p.text;
          else lines.push({ text: p.text, heading: false, x: p.x });
        });
      }
    }
  } finally { pdf.destroy(); }
  lines.forEach(l => delete l.x);
  if (!lines.length) throw new Error('No text found in this PDF. A scanned script has none: ask for the original file, or paste the words.');
  return lines;
}

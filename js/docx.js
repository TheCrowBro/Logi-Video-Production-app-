// Script import: read .docx (no library: the browser's own DecompressionStream unzips it) or plain text,
// and split into paragraphs with a light screenplay-style classification for display.
import { uid } from './util.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/* ------------------------------- zip reader ------------------------------- */
// One entry of a zip file, as text. js/table-read.js reads .xlsx files with it too (a zip of XML like .docx): `kind`
// names the file type in the messages, a missing entry is an error with code 'missing', and `max` stops unpacking an
// entry that grows past that many bytes (code 'big'), since a small file can be made to unpack into gigabytes.
// `budget` ({ left: bytes }) is one allowance for all the entries read from a file: each entry may unpack into what
// is left of it at most, and takes what it unpacked off it, so many entries just under `max` cannot add up to more.
export async function zipEntry(buf, wanted, { kind = '.docx', max = 0, budget = null } = {}) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const big = () => Object.assign(new Error(`This ${kind} file holds too much to open`), { code: 'big' });
  if (budget) { if (budget.left <= 0) throw big(); max = max ? Math.min(max, budget.left) : budget.left; }
  const spend = n => { if (budget) budget.left -= n; };
  // End-of-central-directory record sits in the last 64KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`Not a ${kind} file`);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.byteLength || dv.getUint32(p, true) !== 0x02014b50) throw new Error(`Damaged ${kind} file`);
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name !== wanted) continue;
    if (off + 30 > buf.byteLength) throw new Error(`Damaged ${kind} file`);
    const dn = dv.getUint16(off + 26, true), de = dv.getUint16(off + 28, true);
    const data = u8.subarray(off + 30 + dn + de, off + 30 + dn + de + csize);
    if (method === 0) { if (max && data.length > max) throw big(); spend(data.length); return dec.decode(data); }
    if (method !== 8) throw new Error(`Unsupported ${kind} compression`);
    if (typeof DecompressionStream !== 'function') throw new Error(`This browser cannot read ${kind} files. Paste the text instead.`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    if (!max) return new Response(stream).text();
    const reader = stream.getReader(), parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      n += value.length; if (n > max) { reader.cancel().catch(() => {}); spend(n); throw big(); }
      parts.push(value);
    }
    spend(n);
    return new Blob(parts).text();
  }
  throw Object.assign(new Error('No document text found in this file'), { code: 'missing' });
}

/* ------------------------------ docx -> text ------------------------------ */
const kids = (n, name) => [...n.childNodes].filter(c => c.nodeType === 1 && c.namespaceURI === W && c.localName === name);
// A run's bold, italic and underline ('b', 'i', 'u'), for the teleprompter to show what to stress. A switch written
// as off (w:b w:val="0", w:u w:val="none") is off.
const isOn = el => !!el && !/^(0|false|off|none)$/i.test(el.getAttributeNS(W, 'val') || '');
const runFlags = r => { const pr = kids(r, 'rPr')[0]; if (!pr) return ''; return (isOn(kids(pr, 'b')[0]) ? 'b' : '') + (isOn(kids(pr, 'i')[0]) ? 'i' : '') + (isOn(kids(pr, 'u')[0]) ? 'u' : ''); };
// A paragraph's text, and its emphasis as [start, end, flags] over that text.
function paragraphText(p) {
  let out = '';
  const marks = [];
  const walk = (n, flags) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      const ln = c.localName, ns = c.namespaceURI;
      if (ns === W && ln === 'del') continue; // tracked deletions
      if (ln === 'Fallback') continue;        // mc:AlternateContent duplicates
      if (ns === W && ln === 't') { const t = c.textContent; if (flags && t) { const m = marks[marks.length - 1]; if (m && m[1] === out.length && m[2] === flags) m[1] += t.length; else marks.push([out.length, out.length + t.length, flags]); } out += t; }
      else if (ns === W && ln === 'tab') out += '\t';
      else if (ns === W && (ln === 'br' || ln === 'cr')) out += '\n';
      else if (ns === W && ln === 'p' && c !== p) continue; // nested paragraphs (text boxes) are visited on their own
      else if (ns === W && ln === 'r') walk(c, runFlags(c));
      else walk(c, flags);
    }
  };
  walk(p, '');
  return { text: out, marks };
}
// Trimming a line moves its emphasis with it.
const trimMarks = (raw, marks) => {
  const lead = raw.length - raw.trimStart().length, len = raw.trim().length;
  return marks.map(([a, b, f]) => [Math.max(0, a - lead), Math.min(len, b - lead), f]).filter(([a, b]) => b > a);
};

// A script laid out as a table with a VIDEO (or Visuals, Picture, Shot) column and an AUDIO (or Sound, VO, Script,
// Narration, Dialogue) column, as corporate and documentary scripts often are: the header row names the columns. The
// audio column is what is read; the video column is direction. Any other column (a number, a time) is left out.
const VIDEO = /^(video|visuals?|vision|pictures?|images?|shots?|on ?screen|graphics|b-?roll)\b/i;
const AUDIO = /^(audio|sound|v\.?\s?o\.?|voice ?-?over|narration|dialogue|script|words|copy|spoken|presenter|speech)\b/i;
function avTable(tbl) {
  const rows = kids(tbl, 'tr'); if (rows.length < 2) return null;
  const head = kids(rows[0], 'tc').map(tc => tc.textContent.replace(/[^\p{L}\p{N}/. -]/gu, ' ').replace(/\s+/g, ' ').trim());
  const roles = head.map(t => (AUDIO.test(t) ? 'audio' : VIDEO.test(t) ? 'video' : ''));
  return roles.includes('audio') && roles.includes('video') ? { rows, roles } : null;
}

// A Word screenplay's own paragraph styles (js/stripboard.js reads them the same way): when a third of the lines have
// one, they say what each line is, rather than the guesses of buildScript.
const STYLE = [[/scene.?head|slug/i, 'heading'], [/^char/i, 'character'], [/dialog/i, 'dialogue'], [/paren/i, 'paren'], [/transition/i, 'transition'], [/action|general|descr|shot/i, 'para']];
const styleKind = style => { const hit = STYLE.find(([re]) => re.test(style || '')); return hit ? hit[1] : ''; };

const DOCX_MAX = 60e6; // bytes the text of a Word document may unpack into: far more than any script, far less than a zip bomb
export async function docxToLines(file) {
  const xml = await zipEntry(await file.arrayBuffer(), 'word/document.xml', { max: DOCX_MAX });
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read the document text');
  const roleOf = new Map(); // a paragraph of a VIDEO | AUDIO table: 'audio', 'video', or 'skip' (the header row, other columns)
  for (const tbl of doc.getElementsByTagNameNS(W, 'tbl')) {
    const av = avTable(tbl); if (!av) continue;
    av.rows.forEach((tr, ri) => kids(tr, 'tc').forEach((tc, ci) => { for (const q of tc.getElementsByTagNameNS(W, 'p')) roleOf.set(q, ri === 0 ? 'skip' : av.roles[ci] || 'skip'); }));
  }
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    if (p.closest && p.closest('Fallback')) continue;
    const role = roleOf.get(p); if (role === 'skip') continue;
    const raw = paragraphText(p), full = raw.text.replace(/\u00a0/g, ' '), text = full.trim();
    if (!text) continue;
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    const marks = trimMarks(full, raw.marks);
    lines.push({ text, heading: /heading|title/i.test(style), style, ...(role === 'video' ? { dir: true } : {}), ...(marks.length ? { marks } : {}) }); // the style lets the stripboard read screenplay formatting (Character, Dialogue…)
  }
  // Emphasis on nearly everything (a document typed all in bold) says nothing about what to stress: it is dropped.
  const total = lines.reduce((t, l) => t + l.text.length, 0) || 1;
  for (const f of 'biu') {
    const covered = lines.reduce((t, l) => t + (l.marks || []).filter(m => m[2].includes(f)).reduce((u, [a, b]) => u + b - a, 0), 0);
    if (covered / total > 0.6) lines.forEach(l => { if (!l.marks) return; l.marks = l.marks.map(([a, b, g]) => [a, b, g.replace(f, '')]).filter(m => m[2]); if (!l.marks.length) delete l.marks; });
  }
  const styled = lines.filter(l => styleKind(l.style)).length;
  if (styled > lines.length / 3) lines.forEach(l => { const k = l.dir ? 'para' : styleKind(l.style); if (k) l.kind = k; });
  return lines;
}

export const textToLines = text => String(text || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text, heading: false }));

/* --------------------------- screenplay flavour --------------------------- */
const isCaps = s => s === s.toUpperCase() && /[A-Z]/.test(s);
// A line may say what it is (kind, from Final Draft or a Word screenplay's styles), that it is direction rather than
// words to read (dir: the video column of a VIDEO | AUDIO script, a Final Draft shot), and what it stresses (marks).
export function buildScript(name, lines) {
  const paras = [];
  let prev = '';
  for (const { text, heading, kind: given, dir, marks } of lines) {
    let kind = 'para';
    if (dir) kind = 'para';
    else if (given) kind = given;
    else if (heading || /^(INT|EXT|INT\.?\/EXT|I\/E|EST)[.\s/-]/i.test(text) || /^(SCENE|ACT)\s+\d+/i.test(text)) kind = 'heading';
    else if (/^\(.*\)$/.test(text) && text.length < 60) kind = 'paren';
    else if (isCaps(text) && text.length <= 40 && !/[.!?]$/.test(text) && !/^(CUT TO|FADE|DISSOLVE)/.test(text)) kind = 'character';
    else if (/^(CUT TO|FADE (IN|OUT)|DISSOLVE TO|SMASH CUT)/i.test(text)) kind = 'transition';
    else if (prev === 'character' || prev === 'paren' || prev === 'dialogue' && text.length < 240 && !/^[A-Z][^.]{0,40}:/.test(text)) kind = prev === 'dialogue' ? 'para' : 'dialogue';
    const p = { id: uid(), text, kind };
    if (dir) p.dir = true;
    if (marks && marks.length) p.marks = marks;
    paras.push(p);
    prev = kind;
  }
  return { name, paras, imported: new Date().toISOString() };
}

export const SAMPLE_SCRIPT = `INT. HARBOUR BREWING TAPROOM — MORNING
Early light through the dock windows. Steam rises off the mash tun.
ANA
(to camera)
Every batch starts before sunrise. If you're not here at five, you've missed the best part.
She pulls a sample from the tank and holds it to the light.
ANA (CONT'D)
That colour is six weeks of waiting.
EXT. LOADING BAY — CONTINUOUS
TOM rolls a keg to the van. He nods at the camera but doesn't stop.
TOM
Interview's at ten. I've got forty of these first.
CUT TO:`;

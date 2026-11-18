// Rows and columns out of whatever a kit list is kept in: a CSV or tab-separated file, an Excel .xlsx workbook, or
// text pasted from a spreadsheet, a notes app or an email. Everything is read here, on the device: nothing is
// uploaded and no library is used (an .xlsx is a zip of XML, opened with the zip reader in js/docx.js). What comes
// out is plain text cells only: a formula is never worked out, and what a cell shows is all that is kept of it.
// Files from strangers are expected: sizes, rows, columns and cell lengths are capped, a zip that unpacks too far is
// stopped, and a file that is not text says so. Long work gives the page a turn every few milliseconds, so a list of
// thousands of rows does not freeze it. Loaded on first use (js/gear-import-ui.js).
import { zipEntry } from './docx.js';

export const LIMITS = { fileBytes: 20e6, unpacked: 60e6, rows: 10000, cols: 60, cell: 2000 };

const fail = (code, message) => Object.assign(new Error(message), { code });
const NOT_READ = 'Nothing was read from it.';
const SAVE_AS = 'Open it in Excel, Numbers or Google Sheets, save it as Excel (.xlsx) or CSV, and choose that file.';

// A turn for the page (painting, a tap on Cancel) whenever the work has run for longer than a frame or so.
function breather() {
  let last = performance.now();
  return async () => { if (performance.now() - last < 12) return; await new Promise(r => setTimeout(r)); last = performance.now(); };
}
const clip = s => (s.length > LIMITS.cell ? s.slice(0, LIMITS.cell) : s);
// A row with a cell that was cut at the limit says so (cut: true), so the person can be told which row lost text.
const marked = row => { if (row.cells.some(c => c.length >= LIMITS.cell)) row.cut = true; return row; };

/* ------------------------------- separated text ------------------------------- */
// Fields per record under one separator, quotes respected, for the first records only: enough to tell which
// separator a file uses without reading it all.
function widths(text, sep, max = 40) {
  const out = []; let n = 1, quoted = false, any = false, fresh = true;
  for (let i = 0; i < text.length && out.length < max; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') i++; else quoted = false; } continue; }
    if (c === '"' && fresh) { quoted = true; any = true; fresh = false; }
    else if (c === sep) { n++; fresh = true; any = true; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; if (any) out.push(n); n = 1; any = false; fresh = true; }
    else { if (c !== ' ') any = true; fresh = false; }
  }
  if (any && out.length < max) out.push(n);
  return out;
}
// The separator most of the first records agree on, and that gives them the most columns. '' when no separator
// splits most lines the same way: the text is then a list, one item per line. A decimal comma inside
// semicolon-separated numbers loses to the semicolon because it splits fewer columns, and less evenly.
export function sniffSeparator(text) {
  text = text.slice(0, 200000); // the opening of the file is enough, however long one line of it is
  let best = '', score = 0;
  for (const sep of ['\t', ';', ',', '|']) {
    const w = widths(text, sep); if (!w.length) continue;
    const tally = new Map(); w.forEach(n => tally.set(n, (tally.get(n) || 0) + 1));
    const [cols, times] = [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const s = cols > 1 ? (times / w.length) * cols * (times / w.length >= 0.6 ? 1 : 0.2) : 0;
    if (s > score) { score = s; best = sep; }
  }
  return best;
}

// Text → [{ n, cells }], n being the record's place in the file, counted from 1. Quoted fields may hold the
// separator, line breaks and doubled quotes; a quote in the middle of an unquoted field is just a quote; lines end
// the Windows, Unix or old Mac way; a byte-order mark and wholly empty records are dropped.
export async function parseSeparated(text, sep) {
  text = String(text || '').replace(/^\uFEFF/, '');
  if (sep == null) sep = sniffSeparator(text);
  const rows = [], rest = breather(), L = text.length;
  let cells = [], cell = '', quoted = false, wasQuoted = false, n = 1, more = false, truncated = false;
  const endCell = () => { if (cells.length < LIMITS.cols) cells.push(clip(wasQuoted ? cell : cell.trim())); cell = ''; wasQuoted = false; }; // a line of a million separators is still 60 cells
  const endRow = () => {
    endCell();
    if (cells.some(c => c !== '')) { if (rows.length >= LIMITS.rows) truncated = true; else rows.push(marked({ n, cells })); }
    cells = []; n++;
  };
  for (let i = 0; i < L; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else if (cell.length <= LIMITS.cell) cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === '' && !wasQuoted) { quoted = true; wasQuoted = true; cell = ''; }
    else if (sep && c === sep) endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow(); more = false;
      if (truncated) break;
      if ((n & 255) === 0) await rest();
      continue;
    }
    else if (cell.length <= LIMITS.cell) cell += c;
    more = true;
  }
  if (more && !truncated) endRow();
  return { rows, truncated, sep };
}

// A list with one item on each line, as typed in a notes app or an email: "2x Aputure 600d", "- Sony FX6 (S/N
// 4512345)", "Sachtler Flowtech 75 x 2". The bullet or number in front goes, a count becomes a quantity and a serial
// number named as one becomes the serial. A line that ends in a colon ("Lenses:") is a heading over the lines under
// it, not an item: its row says so (heading: true). The rows come back under headings of their own, like a small table.
const BULLET = /^\s*(?:[-*•·–—▪◦☐☑✓✔]+|\[[ xX]?\]|\(?\d{1,3}[.)](?=\s))\s*/;
const SERIAL_IN_LINE = /[\s,;(\[]*\b(?:s\/n|sn|serial(?:\s+(?:number|no\.?))?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-\/_.]{2,39})\s*[)\]]?/i;
export function listLines(rows) {
  let anyQty = false, anySerial = false;
  const out = rows.map(r => {
    let s = (r.cells[0] || '').replace(BULLET, '').trim(), qty = '', serial = '';
    if (/[:：]$/.test(s)) return { n: r.n, cells: [s.replace(/[\s:：]+$/, ''), '', ''], heading: true };
    const sm = s.match(SERIAL_IN_LINE);
    if (sm && /\d/.test(sm[1])) { serial = sm[1]; s = (s.slice(0, sm.index) + ' ' + s.slice(sm.index + sm[0].length)).trim(); anySerial = true; }
    // "4x5 camera" and "1.4x converter" are names, not counts: the x of a count is followed by a space or a letter
    const front = s.match(/^(\d{1,3})\s*[x×](?:\s+|(?=[^\d\s]))/i), back = s.match(/\s+(?:[x×]\s*(\d{1,3})|\((\d{1,3})\))\s*$/i);
    if (front) { qty = front[1]; s = s.slice(front[0].length); anyQty = true; }
    else if (back) { qty = back[1] || back[2]; s = s.slice(0, back.index); anyQty = true; }
    return { n: r.n, cells: [s.replace(/[\s,;:–—-]+$/, '').trim(), qty, serial], ...(r.cut ? { cut: true } : {}) };
  }).filter(r => r.cells[0]);
  const keep = [true, anyQty, anySerial], head = ['Item', 'Quantity', 'Serial number'];
  return [{ n: 0, cells: head.filter((_, i) => keep[i]), made: true }, ...out.map(r => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) }))];
}

/* ------------------------------------ .xlsx ------------------------------------ */
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const point = n => { try { return n === 9 || n === 10 || n === 13 || n >= 32 ? String.fromCodePoint(n) : ''; } catch { return ''; } }; // no other control characters
// Text out of XML: the five named entities and numbered ones, and Excel's own _x000D_ way of writing a control character.
const unxml = s => (s.includes('&') || s.includes('_x') ? s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => (e[0] === '#' ? point(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : XML_ENT[e.toLowerCase()] ?? m)).replace(/_x([0-9A-Fa-f]{4})_/g, (m, hex) => point(parseInt(hex, 16))) : s);
// Every <name …>…</name> or <name …/> in a piece of XML, in order, as [attributes, what is inside, where it starts,
// where it ends]; the tags may
// carry a prefix (<x:row>). Found by plain searching from one tag to the next, never by a pattern that has to guess
// where an element ends: a file made of thousands of tags that are never closed just ends the list, it cannot make
// the reading crawl.
function* tags(xml, name) {
  const first = xml.match(new RegExp(`<((?:[\\w.-]+:)?)${name}[\\s/>]`)); if (!first) return;
  const open = '<' + first[1] + name, close = '</' + first[1] + name + '>';
  for (let i = xml.indexOf(open); i >= 0; i = xml.indexOf(open, i)) {
    const next = xml.charCodeAt(i + open.length); // the name ends here: <c …> is a cell, <col …> is not
    if (!(next === 32 || next === 62 || next === 47 || next === 9 || next === 10 || next === 13)) { i += open.length; continue; }
    const gt = xml.indexOf('>', i); if (gt < 0) return;
    if (xml.charCodeAt(gt - 1) === 47) { yield [xml.slice(i + open.length, gt - 1), '', i, gt + 1]; i = gt + 1; continue; }
    const end = xml.indexOf(close, gt); if (end < 0) return;
    yield [xml.slice(i + open.length, gt), xml.slice(gt + 1, end), i, end + close.length];
    i = end + close.length;
  }
}
const ATTR = new Map();
const attr = (attrs, name) => { let re = ATTR.get(name); if (!re) ATTR.set(name, re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)); const m = attrs.match(re); return m ? unxml(m[1] ?? m[2]) : null; };
// The text of a string item or an inline string: its <t> parts joined, without the phonetic guides (<rPh>) East Asian text may carry.
function textOf(xml) {
  if (xml.includes('rPh')) { let kept = '', from = 0; for (const [, , start, end] of tags(xml, 'rPh')) { kept += xml.slice(from, start); from = end; } xml = kept + xml.slice(from); }
  let out = ''; for (const [, inner] of tags(xml, 't')) out += unxml(inner);
  return out;
}
const colIndex = ref => { let n = 0; for (let i = 0; i < ref.length; i++) { const c = ref.charCodeAt(i) & 0xDF; if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };
// Number formats that show a date. 14–22 and 45–47 are Excel's built-in date and time formats, 27–36 and 50–58 the
// East Asian ones; a custom format is a date when, outside its quoted text and [bracketed] parts, it has day or year
// letters, or month letters and no digit places.
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = code => { const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''); return /[dy]/i.test(bare) || /m/i.test(bare) && !/[0#?]/.test(bare); };
// A day counted from Excel's start (or from 1904 in workbooks made on an old Mac) → 2024-03-01. Times of day are dropped.
const pad = n => String(n).padStart(2, '0');
export function serialToISO(serial, date1904 = false) {
  const days = Math.floor(Number(serial)) + (date1904 ? 1462 : 0); if (!Number.isFinite(days) || days < 1 || days > 2958465) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + days * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
// 0.1 + 0.2 is stored as 0.30000000000000004: show what the spreadsheet shows.
const tidyNumber = v => { const n = Number(v); return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v; };

async function readXlsx(buf) {
  const opt = { kind: 'Excel', max: LIMITS.unpacked }, rest = breather();
  const entry = async (name, optional) => { try { return await zipEntry(buf, name, opt); } catch (e) { if (optional && e.code === 'missing') return ''; throw e; } };
  let book;
  try { book = await entry('xl/workbook.xml'); }
  catch (e) {
    if (e.code === 'big') throw fail('big', `This file unpacks into more than Vdex will read. ${NOT_READ} Save only the sheet with your kit as CSV and try that.`);
    if (e.code === 'missing') throw fail('kind', `This file is not an Excel workbook (a Numbers or Pages file, or a zip of something else). ${NOT_READ} In Numbers, choose File → Export To → CSV or Excel, and pick that file.`);
    throw fail('damaged', `This Excel file could not be opened: it looks damaged or is protected with a password. ${NOT_READ} Saving it again as .xlsx or CSV usually helps.`);
  }
  try {
    const rels = await entry('xl/_rels/workbook.xml.rels', true), strings = await entry('xl/sharedStrings.xml', true), styles = await entry('xl/styles.xml', true);
    let date1904 = false; for (const [a] of tags(book, 'workbookPr')) date1904 = /^(1|true)$/.test(attr(a, 'date1904') || '');
    const target = {};
    for (const [a] of tags(rels, 'Relationship')) { const id = attr(a, 'Id'), t = attr(a, 'Target'); if (id && t) target[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, ''); }
    const shared = [];
    for (const [, inner] of tags(strings, 'si')) { shared.push(clip(textOf(inner))); if (shared.length >= 2e6) break; if ((shared.length & 1023) === 0) await rest(); }
    // Which cell styles show a date: the style's number format, by its id.
    const custom = new Map(), dateStyle = [];
    for (const [a] of tags(styles, 'numFmt')) custom.set(Number(attr(a, 'numFmtId')), attr(a, 'formatCode') || '');
    for (const [, xfs] of tags(styles, 'cellXfs')) for (const [a] of tags(xfs, 'xf')) { const id = Number(attr(a, 'numFmtId')) || 0; dateStyle.push(custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATES.has(id)); }

    const sheets = [];
    let i = 0;
    for (const [a] of tags(book, 'sheet')) {
      i++;
      const name = attr(a, 'name') || `Sheet ${i}`, rid = attr(a, 'r:id') || attr(a, 'id'), hidden = /hidden/i.test(attr(a, 'state') || '');
      const path = target[rid] || `xl/worksheets/sheet${i}.xml`;
      if (sheets.length >= 30 || !/worksheets\//.test(path)) continue; // chart sheets and the like hold no rows
      const xml = await entry(path, true); if (!xml) continue;
      const rows = []; let truncated = false, auto = 0;
      for (const [ra, inside] of tags(xml, 'row')) {
        const n = Number(attr(ra, 'r')) || auto + 1; auto = n;
        if (!inside) continue;
        const cells = []; let next = 0, any = false;
        for (const [ca, body] of tags(inside, 'c')) {
          const ref = attr(ca, 'r'), at = ref ? colIndex(ref) : next; next = at + 1;
          if (at < 0 || at >= LIMITS.cols || !body) continue;
          const t = attr(ca, 't') || 'n';
          let raw = ''; for (const [, v] of tags(body, 'v')) { raw = unxml(v); break; }
          let v = '';
          if (t === 's') v = shared[Number(raw)] ?? '';
          else if (t === 'inlineStr') v = textOf(body);
          else if (t === 'str') v = raw;                       // what a formula gave when the file was saved
          else if (t === 'b') v = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e') v = '';                          // #N/A, #REF! and the like
          else if (t === 'd') v = raw.slice(0, 10);
          else if (raw !== '') v = dateStyle[Number(attr(ca, 's')) || 0] ? serialToISO(raw, date1904) || tidyNumber(raw) : tidyNumber(raw);
          v = clip(String(v).trim());
          if (v !== '') { cells[at] = v; any = true; }
        }
        if (any) { if (rows.length >= LIMITS.rows) { truncated = true; break; } for (let k = 0; k < cells.length; k++) if (cells[k] == null) cells[k] = ''; rows.push(marked({ n, cells })); }
        if ((rows.length & 127) === 0) await rest();
      }
      sheets.push({ name: String(name).slice(0, 80), rows, truncated, hidden });
    }
    return sheets;
  } catch (e) {
    if (e.code === 'big') throw fail('big', `This file unpacks into more than Vdex will read. ${NOT_READ} Save only the sheet with your kit as CSV and try that.`);
    throw fail('damaged', `This Excel file could not be read all the way through: it looks damaged. ${NOT_READ} Saving it again as .xlsx or CSV usually helps.`);
  }
}

/* --------------------------------- files and text --------------------------------- */
const starts = (u8, ...bytes) => bytes.every((b, i) => u8[i] === b);
function decode(u8) {
  if (starts(u8, 0xFF, 0xFE)) return new TextDecoder('utf-16le').decode(u8);
  if (starts(u8, 0xFE, 0xFF)) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
  catch { return new TextDecoder('windows-1252').decode(u8); } // a CSV saved by Excel on Windows in its "ANSI" form
}
const textSheets = async (text, name) => {
  const { rows, truncated, sep } = await parseSeparated(text);
  const width = rows.reduce((w, r) => Math.max(w, r.cells.length), 0);
  return { sep, sheets: [{ name, rows: width <= 1 ? listLines(rows) : rows, truncated, list: width <= 1 }] };
};

// A chosen file → { name, kind: 'xlsx' | 'text', sheets: [{ name, rows: [{ n, cells }], truncated }] }, or an Error
// whose message can be shown as it is. What the file is comes from its first bytes, not from its name.
export async function readTableFile(file) {
  const name = String(file && file.name || 'file').slice(0, 120), ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (!file || !file.size) throw fail('empty', `“${name}” is empty. ${NOT_READ}`);
  if (file.size > LIMITS.fileBytes) throw fail('big', `“${name}” is ${Math.round(file.size / 1e6)} MB, more than Vdex will read (${LIMITS.fileBytes / 1e6} MB). ${NOT_READ} Save only the sheet with your kit as CSV and try that.`);
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  if (starts(u8, 0xD0, 0xCF, 0x11, 0xE0)) throw fail('xls', `“${name}” is in the older Excel format (.xls), which Vdex cannot read. ${NOT_READ} ${SAVE_AS}`);
  if (starts(u8, 0x50, 0x4B)) {
    if (ext === 'numbers' || ext === 'pages' || ext === 'ods') throw fail('kind', `“${name}” is a ${ext === 'ods' ? 'OpenDocument' : ext === 'numbers' ? 'Numbers' : 'Pages'} file, which Vdex cannot read. ${NOT_READ} ${ext === 'numbers' ? 'In Numbers, choose File → Export To → CSV or Excel, and pick that file.' : SAVE_AS}`);
    const sheets = (await readXlsx(buf)).filter(s => s.rows.length);
    if (!sheets.length) throw fail('empty', `“${name}” has no rows in it. ${NOT_READ}`);
    return { name, kind: 'xlsx', sheets };
  }
  if (ext === 'xls') throw fail('xls', `“${name}” is in the older Excel format (.xls), which Vdex cannot read. ${NOT_READ} ${SAVE_AS}`);
  if (starts(u8, 0x25, 0x50, 0x44, 0x46)) throw fail('kind', `“${name}” is a PDF, which Vdex cannot read as a list. ${NOT_READ} Copy the rows out of it and paste them here instead.`);
  const utf16 = starts(u8, 0xFF, 0xFE) || starts(u8, 0xFE, 0xFF);
  if (!utf16) { // text has no zero bytes and next to no control characters; a picture, a program or a database has plenty
    let odd = 0; const look = Math.min(u8.length, 8192);
    for (let i = 0; i < look; i++) { const b = u8[i]; if (b === 0) { odd = look; break; } if (b < 9 || (b > 13 && b < 32 && b !== 27)) odd++; }
    if (odd > look / 50) throw fail('binary', `“${name}” is not a list Vdex can read: it is not text and not an Excel .xlsx file. ${NOT_READ} Choose a CSV or .xlsx file, or paste the rows instead.`);
  }
  const { sheets } = await textSheets(decode(u8), name);
  if (!sheets[0].rows.length || sheets[0].list && sheets[0].rows.length < 2) throw fail('empty', `“${name}” has no rows in it. ${NOT_READ}`);
  return { name, kind: 'text', sheets };
}

// Pasted text → the same shape. Rows copied out of a spreadsheet arrive tab-separated; a list arrives a line an item.
export async function readTableText(text) {
  text = String(text || '');
  if (!text.trim()) throw fail('empty', 'Nothing is pasted yet.');
  if (text.length > LIMITS.fileBytes) throw fail('big', `That is more text than Vdex will read in one go. ${NOT_READ} Paste it in parts, or save it as a file and choose that.`);
  const { sheets } = await textSheets(text, 'the pasted text');
  if (!sheets[0].rows.length || sheets[0].list && sheets[0].rows.length < 2) throw fail('empty', 'No rows were found in the pasted text.');
  return { name: 'the pasted text', kind: 'text', sheets };
}

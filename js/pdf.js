// A small PDF writer with no library: A4 pages, Helvetica and Helvetica-Bold, word wrapping, simple tables and page
// numbers. Enough for a call sheet. Characters outside the Latin set (emoji, other scripts) are dropped or become '?'.
const W = 595.28, H = 841.89, M = 42, FOOT = 24;
// Helvetica glyph widths for codes 32–126 (per 1000 units); bold is a touch wider, so it is scaled when measuring.
const WIDTHS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const MAP = { '—': 0x97, '–': 0x96, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '™': 0x99, ' ': 0x20, '→': 0x3e, '×': 0xd7 };
function enc(str) { // JS string → WinAnsi bytes held in a latin1 string
  let out = '';
  for (const ch of String(str == null ? '' : str)) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out += c >= 32 ? ch : ' ';
    else if (MAP[ch] != null) out += String.fromCharCode(MAP[ch]);
    else if (c >= 0x80 && c <= 0xff) out += ch; // Latin-1, and WinAnsi bytes from text that was already encoded once (wrapped lines)
    else if (c > 0xffff || (c >= 0x2190 && c <= 0x2bff) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0x200d) { /* emoji and symbols: dropped */ }
    else out += '?';
  }
  return out;
}
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const fx = n => (Math.round(n * 100) / 100).toString();
export function textWidth(str, size, bold = false) {
  let w = 0;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); w += c >= 32 && c <= 126 ? WIDTHS[c - 32] : 556; }
  return (w / 1000) * size * (bold ? 1.08 : 1);
}
function wrap(str, size, bold, width) {
  const lines = [];
  for (const para of enc(str).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? line + ' ' + word : word;
      if (textWidth(probe, size, bold) <= width) { line = probe; continue; }
      if (line) lines.push(line);
      line = word;
      while (textWidth(line, size, bold) > width && line.length > 1) { // a single word longer than the line: split it
        let cut = line.length - 1; while (cut > 1 && textWidth(line.slice(0, cut), size, bold) > width) cut--;
        lines.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

// blocks: { type: 'title'|'subtitle'|'heading'|'text'|'kv'|'times'|'table'|'space', ... }
export function makePdf({ title = '', blocks = [], footer = '' }) {
  const pages = []; let ops = []; let y = H - M;
  const newPage = () => { pages.push(ops); ops = []; y = H - M; };
  const ensure = need => { if (y - need < M + FOOT) newPage(); };
  const text = (x, yy, str, size, bold = false, gray = 0) => { const s = esc(enc(str)); if (s) ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${fx(gray)} g ${fx(x)} ${fx(yy)} Td (${s}) Tj ET`); };
  const rule = (x1, yy, x2, gray = 0.82, w = 0.6) => ops.push(`${fx(gray)} G ${w} w ${fx(x1)} ${fx(yy)} m ${fx(x2)} ${fx(yy)} l S`);
  const para = (str, size, bold = false, { x = M, width = W - 2 * M, gray = 0, lh = size * 1.38 } = {}) => {
    for (const ln of wrap(str, size, bold, width)) { ensure(lh); y -= lh; text(x, y, ln, size, bold, gray); }
  };
  const innerW = W - 2 * M;
  for (const b of blocks) {
    if (b.type === 'title') { y -= 6; para(b.text, 20, true, { lh: 24 }); }
    else if (b.type === 'subtitle') { para(b.text, 11, false, { gray: 0.35, lh: 15 }); y -= 4; }
    else if (b.type === 'heading') { ensure(34); y -= 16; text(M, y, String(b.text).toUpperCase(), 8.5, true, 0.35); y -= 5; rule(M, y, W - M, 0.75); y -= 2; }
    else if (b.type === 'text') { y -= 2; para(b.text, b.size || 9.5, !!b.bold, { gray: b.gray || 0 }); }
    else if (b.type === 'space') { y -= b.h || 8; }
    else if (b.type === 'kv') {
      const lines = wrap(b.v, 9.5, false, innerW - 125); const lh = 13; ensure(lh * lines.length + 2);
      y -= lh; text(M, y, b.k, 9, false, 0.4); text(M + 125, y, lines[0], 9.5);
      for (const ln of lines.slice(1)) { ensure(lh); y -= lh; text(M + 125, y, ln, 9.5); }
      y -= 1;
    }
    else if (b.type === 'times') {
      const items = b.items.filter(x => x && x[1]); if (!items.length) continue;
      const cols = Math.min(items.length, 5), cw = innerW / cols; let i = 0;
      while (i < items.length) {
        ensure(44); const top = y - 4;
        items.slice(i, i + cols).forEach(([label, val], j) => { const x = M + j * cw; ops.push(`0.86 G 0.6 w ${fx(x + 1)} ${fx(top - 36)} ${fx(cw - 4)} 36 re S`); text(x + 8, top - 13, String(label).toUpperCase(), 6.5, false, 0.45); text(x + 8, top - 29, val, 14, true); });
        y = top - 40; i += cols;
      }
    }
    else if (b.type === 'table') {
      const widths = (b.widths || b.head.map(() => 1 / b.head.length)).map(f => f * innerW), size = 9, lh = 12, pad = 4;
      const header = () => { ensure(lh + 6); y -= lh; let x = M; b.head.forEach((hd, i) => { text(x + pad, y, String(hd).toUpperCase(), 7, true, 0.4); x += widths[i]; }); y -= 4; rule(M, y, W - M, 0.55, 0.8); };
      header();
      for (const row of b.rows) {
        const cells = row.map((c, i) => wrap(String(c == null ? '' : c), size, false, widths[i] - 2 * pad));
        const n = Math.max(...cells.map(c => c.length)), hgt = n * lh + 6;
        if (y - hgt < M + FOOT) { newPage(); header(); }
        let x = M;
        cells.forEach((lines, i) => { lines.forEach((ln, k) => text(x + pad, y - lh * (k + 1) + 3, ln, size)); x += widths[i]; });
        y -= hgt; rule(M, y + 2, W - M, 0.85);
      }
      y -= 2;
    }
  }
  newPage();
  const n = pages.length;
  pages.forEach((p, i) => {
    const pg = `${i + 1} / ${n}`;
    p.push(`BT /F1 7.5 Tf 0.45 g ${fx(M)} ${fx(M - 12)} Td (${esc(enc(footer))}) Tj ET`);
    p.push(`BT /F1 7.5 Tf 0.45 g ${fx(W - M - textWidth(enc(pg), 7.5))} ${fx(M - 12)} Td (${esc(pg)}) Tj ET`);
  });
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  pages.forEach((p, i) => {
    const stream = p.join('\n');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (${esc(enc(title))}) /Producer (Vdex) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, c => c.charCodeAt(0) & 0xff);
}

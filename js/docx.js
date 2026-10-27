// Script import: read .docx (no library: the browser's own DecompressionStream unzips it) or plain text,
// and split into paragraphs with a light screenplay-style classification for display.
import { uid } from './util.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/* ------------------------------- zip reader ------------------------------- */
async function zipEntry(buf, wanted) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  // End-of-central-directory record sits in the last 64KB.
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a .docx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Damaged .docx file');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name !== wanted) continue;
    const dn = dv.getUint16(off + 26, true), de = dv.getUint16(off + 28, true);
    const data = u8.subarray(off + 30 + dn + de, off + 30 + dn + de + csize);
    if (method === 0) return dec.decode(data);
    if (method !== 8) throw new Error('Unsupported .docx compression');
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot read .docx files. Paste the text instead.');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  throw new Error('No document text found in this file');
}

/* ------------------------------ docx -> text ------------------------------ */
function paragraphText(p) {
  let out = '';
  const walk = n => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      const ln = c.localName, ns = c.namespaceURI;
      if (ns === W && ln === 'del') continue; // tracked deletions
      if (ln === 'Fallback') continue;        // mc:AlternateContent duplicates
      if (ns === W && ln === 't') out += c.textContent;
      else if (ns === W && ln === 'tab') out += '\t';
      else if (ns === W && (ln === 'br' || ln === 'cr')) out += '\n';
      else if (ns === W && ln === 'p' && c !== p) continue; // nested paragraphs (text boxes) are visited on their own
      else walk(c);
    }
  };
  walk(p);
  return out;
}

export async function docxToLines(file) {
  const xml = await zipEntry(await file.arrayBuffer(), 'word/document.xml');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read the document text');
  const lines = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    if (p.closest && p.closest('Fallback')) continue;
    const text = paragraphText(p).replace(/ /g, ' ').trim();
    if (!text) continue;
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    lines.push({ text, heading: /heading|title/i.test(style) });
  }
  return lines;
}

export const textToLines = text => String(text || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text, heading: false }));

/* --------------------------- screenplay flavour --------------------------- */
const isCaps = s => s === s.toUpperCase() && /[A-Z]/.test(s);
export function buildScript(name, lines) {
  const paras = [];
  let prev = '';
  for (const { text, heading } of lines) {
    let kind = 'para';
    if (heading || /^(INT|EXT|INT\.?\/EXT|I\/E|EST)[.\s/-]/i.test(text) || /^(SCENE|ACT)\s+\d+/i.test(text)) kind = 'heading';
    else if (/^\(.*\)$/.test(text) && text.length < 60) kind = 'paren';
    else if (isCaps(text) && text.length <= 40 && !/[.!?]$/.test(text) && !/^(CUT TO|FADE|DISSOLVE)/.test(text)) kind = 'character';
    else if (/^(CUT TO|FADE (IN|OUT)|DISSOLVE TO|SMASH CUT)/i.test(text)) kind = 'transition';
    else if (prev === 'character' || prev === 'paren' || prev === 'dialogue' && text.length < 240 && !/^[A-Z][^.]{0,40}:/.test(text)) kind = prev === 'dialogue' ? 'para' : 'dialogue';
    paras.push({ id: uid(), text, kind });
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

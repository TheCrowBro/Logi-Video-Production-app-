// QR codes: made with the vendored qrcode-generator, loaded the first time one is needed.
import { h } from './util.js';

const load = (src, globalName) => window[globalName] ? Promise.resolve(window[globalName]) : new Promise((res, rej) => document.head.append(h('script', { src, onload: () => res(window[globalName]), onerror: () => rej(new Error('Could not load ' + src)) })));
export const loadQR = () => load('vendor/qrcode.js', 'qrcode');

// SVG markup for a QR of `text` (async: resolves to the markup). Byte mode in UTF-8, so names like Zoë or F♯ scan right;
// error-correction level L keeps dense codes scannable.
export async function qrSvg(text, { cellSize = 4, level = 'L' } = {}) {
  const qrcode = await loadQR();
  if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, level); qr.addData(text, 'Byte'); qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

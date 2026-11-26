// QR helpers: generate (qrcode-generator) and decode from camera frames (jsQR). Both vendored, both lazy.
import { h } from './util.js';

const load = (src, globalName) => window[globalName] ? Promise.resolve(window[globalName]) : new Promise((res, rej) => document.head.append(h('script', { src, onload: () => res(window[globalName]), onerror: () => rej(new Error('Could not load ' + src)) })));
// Text goes into a code as UTF-8, which is what phones read it as. (The library's own default keeps the low byte of
// each character: a name outside ASCII, or a curly apostrophe, came out of a scan as other characters.)
export const loadQR = () => load('vendor/qrcode.js', 'qrcode').then(q => { q.stringToBytes = q.stringToBytesFuncs['UTF-8']; return q; });
export const loadJsQR = () => load('vendor/jsQR.js', 'jsQR');

// SVG markup for a QR of `text` (byte mode), error-correction level L keeps dense codes scannable.
export async function qrSvg(text, { cellSize = 4, level = 'L' } = {}) {
  const qrcode = await loadQR();
  const qr = qrcode(0, level); qr.addData(text, 'Byte'); qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

// Camera scanner: calls onCode(text) once a QR is read. Returns { el, stop }.
//   hint     the words under the picture while it looks
//   instead  what to do when the camera cannot be used, in the words of the sheet it sits in
// It looks at the middle square of the picture, by turns small and at full size. Small (SMALL pixels a side) is quick
// and takes a short code even from a shaking hand; at full size, up to LARGE pixels a side, the squares of a long code
// (a shared link of a thousand characters and more) are still more than a pixel each. The camera is asked for a
// 1080-line picture for the same reason. One look follows the other only when it is done, so a slow phone is never
// handed a second picture while it is still reading the first.
export const SCAN = { SMALL: 480, LARGE: 960, PART: 0.9, EVERY: 160 };
export function scanner(onCode, { hint = 'Point the camera at the code', instead = 'Paste the code instead.' } = {}) {
  const video = h('video', { autoplay: true, playsInline: true, muted: true, class: 'cam' });
  const status = h('div', { class: 'muted small scan-status' }, hint);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, timer = null, done = false, turn = 0;
  const stop = () => { done = true; clearTimeout(timer); stream && stream.getTracks().forEach(t => t.stop()); stream = null; };
  (async () => {
    try {
      const [jsQR] = await Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(s => { stream = s; video.srcObject = s; })]);
      if (done) { stream && stream.getTracks().forEach(t => t.stop()); return; } // stopped while the camera was still opening
      const look = () => {
        if (done) return;
        if (video.videoWidth) {
          const s = Math.min(video.videoWidth, video.videoHeight) * SCAN.PART; // the middle square
          const w = Math.round(turn++ % 2 ? Math.min(SCAN.LARGE, s) : Math.min(SCAN.SMALL, s)); canvas.width = canvas.height = w;
          ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, w, w);
          const r = jsQR(ctx.getImageData(0, 0, w, w).data, w, w, { inversionAttempts: 'dontInvert' });
          if (r && r.data) { stop(); status.textContent = 'Code read'; onCode(r.data); return; }
        }
        timer = setTimeout(look, SCAN.EVERY);
      };
      look();
    } catch (e) { status.textContent = 'Camera unavailable: ' + (e.message || e.name) + '. ' + instead; }
  })();
  const el = h('div', { class: 'scan' }, h('div', { class: 'cam-wrap scan-wrap' }, video, h('div', { class: 'scan-reticle', 'aria-hidden': 'true' })), status);
  return { el, stop };
}

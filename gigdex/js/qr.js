// QR helpers: generate (qrcode-generator) and decode from camera frames (jsQR). Both vendored, both lazy.
import { h } from './util.js';

const load = (src, globalName) => window[globalName] ? Promise.resolve(window[globalName]) : new Promise((res, rej) => document.head.append(h('script', { src, onload: () => res(window[globalName]), onerror: () => rej(new Error('Could not load ' + src)) })));
export const loadQR = () => load('vendor/qrcode.js', 'qrcode');
export const loadJsQR = () => load('vendor/jsQR.js', 'jsQR');

// SVG markup for a QR of `text` (byte mode), error-correction level L keeps dense codes scannable.
export async function qrSvg(text, { cellSize = 4, level = 'L' } = {}) {
  const qrcode = await loadQR();
  const qr = qrcode(0, level); qr.addData(text, 'Byte'); qr.make();
  return qr.createSvgTag({ cellSize, margin: 2, scalable: true });
}

// Camera scanner: calls onCode(text) once a QR is read. Returns { el, stop }.
export function scanner(onCode, { hint = 'Point the camera at the code' } = {}) {
  const video = h('video', { autoplay: true, playsInline: true, muted: true, class: 'cam' });
  const status = h('div', { class: 'muted small scan-status' }, hint);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, timer = null, done = false;
  const stop = () => { done = true; clearInterval(timer); stream && stream.getTracks().forEach(t => t.stop()); stream = null; };
  (async () => {
    try {
      const [jsQR] = await Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }).then(s => { stream = s; video.srcObject = s; })]);
      timer = setInterval(() => {
        if (done || !video.videoWidth) return;
        const s = Math.min(video.videoWidth, video.videoHeight) * 0.9; // centre square, downscaled for speed
        const w = 480; canvas.width = canvas.height = w;
        ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, w, w);
        const img = ctx.getImageData(0, 0, w, w);
        const r = jsQR(img.data, w, w, { inversionAttempts: 'dontInvert' });
        if (r && r.data) { stop(); status.textContent = 'Code read'; onCode(r.data); }
      }, 160);
    } catch (e) { status.textContent = 'Camera unavailable: ' + (e.message || e.name) + '. Paste the code instead.'; }
  })();
  const el = h('div', { class: 'scan' }, h('div', { class: 'cam-wrap scan-wrap' }, video, h('div', { class: 'scan-reticle', 'aria-hidden': 'true' })), status);
  return { el, stop };
}

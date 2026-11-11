// Small pieces the tools share: settings kept on this device, number clamps, readouts, buttons that repeat while
// held, and a wake lock that keeps the screen on.
import { h } from './util.js';
import { registerState } from './audio.js';

// Settings saved in this browser (keys start gigdex-). Reads fall back when storage is blocked or holds junk.
export const pref = {
  get(key, fallback) { try { const raw = localStorage.getItem(key); if (raw == null) return fallback; const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full: the setting lasts this visit */ } },
};
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const num = v => (v === '' || v == null ? NaN : Number(v));
// A typing field: Space and arrow keys belong to it, not to the tool's shortcuts.
export const isField = el => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

// A small labelled figure: "Max  97 dB".
export const readout = (label, valueEl, extra) => h('div', { class: 'tl-readout' }, h('span', { class: 'tl-readout-k' }, label), valueEl, extra || null);

// A button that acts once on a tap or a key, and keeps acting while a finger or the mouse holds it down.
export function repeatButton(attrs, label, fn) {
  let delay = null, rep = null, viaPointer = false;
  const stop = () => { clearTimeout(delay); clearInterval(rep); delay = rep = null; };
  const btn = h('button', { type: 'button', ...attrs }, label);
  btn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    viaPointer = true; fn();
    stop(); delay = setTimeout(() => { rep = setInterval(fn, 70); }, 450);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) btn.addEventListener(t, stop);
  btn.addEventListener('click', () => { if (viaPointer) { viaPointer = false; return; } fn(); }); // keyboard and screen readers
  btn.addEventListener('contextmenu', e => e.preventDefault()); // a long press must not open the browser's menu
  return btn;
}

// A toggle switch (a real checkbox, styled).
export function switchBox({ id, label, checked, onchange }) {
  const input = h('input', { type: 'checkbox', id, role: 'switch', checked: !!checked, onchange: e => onchange(e.target.checked) });
  return h('label', { class: 'tl-switch', for: id }, input, h('span', { class: 'tl-switch-track', 'aria-hidden': 'true' }, h('i')), h('span', null, label));
}

/* ------------------------------- wake lock ------------------------------- */
// Keeps the screen on while something needs it (the set timer running). Released on stop and when the page is left;
// the browser drops it by itself when the app goes to the background, so keepAwake() is called again on return.
let lock = null, wanted = false, asking = false, refused = false;
export const wakeLockSupported = () => typeof navigator !== 'undefined' && 'wakeLock' in navigator;
export async function keepAwake() {
  wanted = true;
  if (!wakeLockSupported() || lock || asking || document.hidden) return !!lock;
  asking = true;
  try {
    const l = await navigator.wakeLock.request('screen');
    if (!wanted) { l.release().catch(() => {}); return false; } // stopped while the browser was deciding
    lock = l; refused = false;
    l.addEventListener('release', () => { if (lock === l) lock = null; });
    return true;
  } catch { refused = true; return false; } // battery saver, or the page isn't visible
  finally { asking = false; }
}
export function letSleep() {
  wanted = false; refused = false;
  if (lock) { const l = lock; lock = null; l.release().catch(() => {}); }
}
export const awake = () => !!lock;
// 'on', 'asking', 'refused' or 'unsupported': what the screen will do while something wants it awake.
export const wakeState = () => (lock ? 'on' : !wakeLockSupported() ? 'unsupported' : asking ? 'asking' : refused ? 'refused' : 'asking');
registerState('wakeLock', () => !!lock);

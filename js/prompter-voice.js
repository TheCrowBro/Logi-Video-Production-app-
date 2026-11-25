// Voice-follow: the prompter keeps pace with the talent's voice instead of a set speed. The browser's own speech
// recognition turns what the microphone hears into words (Chrome, Edge and the Android app send the sound to
// Google's speech service to do it, Safari to Apple's); Vdex matches the last few words heard to the script near
// where the talent is, and aims the stage at that word. Nothing is recorded or kept by Vdex. It is off unless the
// person turns it on, after a word about where the sound goes (once on each device), and it listens only while the
// prompter runs. Loaded on first use.
import { isApp } from './native.js';

const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
// Not in the iPhone app (its web view would need Apple's speech recogniser, and a permission text for it, added to
// the app) nor in the desktop app (its browser has no speech service): there the 🎙 button does not show.
export const voiceSupported = () => !isApp && !window.vdexDesktop && !!SR();
const OK = 'logi-voice-ok';
export const voiceAgreed = () => { try { return localStorage.getItem(OK) === '1'; } catch { return false; } };
export const agreeVoice = () => { try { localStorage.setItem(OK, '1'); } catch { /* asked again next time */ } };
export const VOICE_NOTE = 'Voice-follow listens through this device’s microphone while the prompter runs, and moves the script along as the talent reads it. To turn speech into words it uses the browser’s own speech recognition: Chrome, Edge and the Android app send the sound to Google’s speech service for that, and Safari to Apple’s. Vdex records nothing and keeps nothing; it only matches the words to the script. It stops when the prompter pauses or closes, and you can turn it off at any time with 🎙.';

/* the words of the script, and of what was heard, made comparable */
const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const norm = w => { const x = w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]/gu, ''); return /^\d+$/.test(x) && Number(x) <= 20 ? NUMBERS[Number(x)] : x; };
export const wordsOf = text => String(text).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/[\s\-–—/]+/).map(norm).filter(Boolean);
// Every word read aloud, in order: the line it is on, and its place in that line (k of n).
export function tokensOf(lines) {
  const out = [];
  for (const a of lines) {
    if (a.role !== 'say' && a.role !== 'other') continue;
    const ws = wordsOf(a.text);
    ws.forEach((w, k) => out.push({ w, id: a.id, k, n: ws.length }));
  }
  return out;
}
// One letter more, less or different (a recogniser's near miss), for words of four letters or more.
const near = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return d + (a.length - i) + (b.length - j) <= 1;
};
const same = (a, b) => a === b || (a.length > 3 && b.length > 3 && (near(a, b) || a.startsWith(b) || b.startsWith(a)));
// Where in the script the last words heard end, looking a little behind the talent and further ahead: the last word
// heard must match there (it may be half a word yet, as a recogniser hears it), and as many of the words before it as
// can (a word skipped on either side is allowed). More words matched wins; then the place nearer where the talent was.
// A last word or two that fit nowhere (an "um", a word misheard) are let go. -1 when nothing fits.
function alignTail(tokens, cursor, tail) {
  const need = Math.min(2, tail.length), last = tail[tail.length - 1];
  let best = -1, bestScore = -Infinity;
  for (let j = Math.max(0, cursor - 4); j <= Math.min(tokens.length - 1, cursor + 40); j++) {
    const w = tokens[j].w;
    if (!(same(w, last) || (last.length >= 2 && w.startsWith(last)))) continue;
    let score = 1, t = tail.length - 2, k = j - 1, skips = 0;
    while (t >= 0 && k >= 0 && skips <= 2) {
      if (same(tokens[k].w, tail[t])) { score++; t--; k--; }
      else if (t > 0 && same(tokens[k].w, tail[t - 1])) { t--; skips++; } // a word heard that is not in the script
      else { k--; skips++; } // a word of the script not read
    }
    if (score < need) continue;
    const sc = score * 10 - Math.abs(j - cursor) * 0.5;
    if (sc > bestScore) { bestScore = sc; best = j; }
  }
  return best;
}
export function align(tokens, cursor, heard) {
  if (!heard.length || !tokens.length) return -1;
  for (let drop = 0; drop <= 2 && heard.length - drop > 0; drop++) {
    const j = alignTail(tokens, cursor, heard.slice(0, heard.length - drop).slice(-6));
    if (j >= 0) return j;
  }
  return -1;
}

// Listens and aims: onAim(lineId, frac) as the talent moves through the script; onStatus({ listening }) or
// ({ error }) when it cannot (no microphone, no permission, no connection for the speech service). from: the line
// the talent starts at. Returns { stop }.
export function listen({ lines, from = null, onAim, onStatus = () => {} }) {
  const Rec = SR(); if (!Rec) { onStatus({ error: 'unsupported' }); return { stop() {} }; }
  const tokens = tokensOf(lines);
  let cursor = Math.max(0, from ? tokens.findIndex(t => t.id === from) : 0), on = true, rec = null, restarts = 0;
  const begin = () => {
    rec = new Rec();
    rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.lang = navigator.language || 'en-GB';
    rec.onresult = e => {
      restarts = 0;
      let text = ''; for (let i = Math.max(0, e.results.length - 3); i < e.results.length; i++) text += ' ' + e.results[i][0].transcript;
      const j = align(tokens, cursor, wordsOf(text));
      if (j >= 0 && j !== cursor) { cursor = j; const t = tokens[j]; onAim(t.id, (t.k + 1) / t.n); }
    };
    rec.onerror = e => { if (['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error)) { on = false; onStatus({ error: e.error }); } };
    // A recogniser stops after a while, or a silence: start it again while the prompter runs (but not in a loop).
    rec.onend = () => { if (on && restarts++ < 20) setTimeout(() => { if (on) { try { begin(); } catch { on = false; onStatus({ error: 'start' }); } } }, 250); };
    rec.start();
  };
  try { begin(); onStatus({ listening: true }); } catch { on = false; onStatus({ error: 'start' }); }
  return { stop() { on = false; try { rec && rec.abort(); } catch { /* stopped already */ } } };
}
// What to tell the person when it cannot listen.
export const voiceTrouble = error => ({
  unsupported: 'This browser cannot turn speech into words. Voice-follow works in Chrome, Edge and Safari.',
  'not-allowed': 'Voice-follow needs the microphone. Allow it for Vdex in the browser or the phone’s settings, then turn 🎙 on again.',
  'service-not-allowed': 'The speech service is not available here. In Chrome, Edge or Safari voice-follow can use it.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice-follow needs a connection to the speech service, which it could not reach. The prompter carries on at its speed.',
  'language-not-supported': 'The speech service does not offer this device’s language.',
}[error] || 'Voice-follow could not start. The prompter carries on at its speed.');

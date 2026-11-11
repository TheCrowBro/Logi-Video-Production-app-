// Sound for the Tools page. One AudioContext, made the first time a tool needs it and woken by a tap (browsers keep
// sound asleep until someone touches the page); the microphone, with plain words when it can't be had; and stopAll(),
// so leaving the page leaves nothing listening or playing. Also the pure sums the tools share: pitch detection, note
// names and frequencies, sound levels, and an A-weighting filter for the meter. Nothing here is sent anywhere: the
// microphone is analysed in the browser and never recorded.

/* ------------------------------- the context ------------------------------- */
let ctx = null;
const mics = new Set();       // live microphone streams
const states = new Map();     // name -> () => object, merged into gigdexAudioState() (tests and debugging)
let generation = 0;           // bumped by stopAll(): a microphone that arrives after it is stopped at once

// A problem with a message written for a person. code: unsupported, insecure, denied, nomic, busy, cancelled, other.
export class AudioProblem extends Error {
  constructor(code, message) { super(message); this.name = 'AudioProblem'; this.code = code; }
}

export function audioContext() {
  if (ctx && ctx.state !== 'closed') return ctx;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) throw new AudioProblem('unsupported', 'This browser can’t make or hear sound. Try an up-to-date Chrome, Safari, Firefox or Edge.');
  try { ctx = new C({ latencyHint: 'interactive' }); } catch { ctx = new C(); }
  return ctx;
}
// The context, running. Call it from a tap: that is when a browser lets sound start.
export async function wakeAudio() {
  const c = audioContext();
  if (c.state === 'suspended') { try { await c.resume(); } catch { /* the next tap tries again */ } }
  return c;
}
// Wake a sleeping context without making one (the page calls this on every tap inside the tools).
export function nudgeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }
export const audioAwake = () => !!ctx && ctx.state === 'running';

/* ------------------------------- the microphone ------------------------------- */
// 'granted', 'denied', 'prompt' or 'unknown' (browsers that can't say). Never asks.
export async function micPermission() {
  try { const p = await navigator.permissions.query({ name: 'microphone' }); return p.state; } catch { return 'unknown'; }
}

export async function getMic() {
  if (!window.isSecureContext) throw new AudioProblem('insecure', 'The microphone only works when Gigdex is opened from its secure (https://) address or installed on your device. Open it from there and try again.');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new AudioProblem('unsupported', 'This browser can’t use the microphone. Try an up-to-date Chrome, Safari, Firefox or Edge.');
  const gen = generation;
  let stream;
  try {
    // Raw sound: echo cancelling, noise suppression and automatic gain would bend both the pitch and the level.
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  } catch (e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') throw new AudioProblem('denied', 'Gigdex isn’t allowed to use the microphone. Allow it for this site in your browser’s settings (tap the lock or ⓘ beside the address), then tap Start again.');
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') throw new AudioProblem('nomic', 'No microphone was found. Plug one in, or check that this device has one, then tap Start again.');
    if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') throw new AudioProblem('busy', 'The microphone is busy: another app or tab may be using it. Close that, then tap Start again.');
    throw new AudioProblem('other', 'The microphone could not be started' + (e && e.message ? ` (${e.message})` : '') + '. Tap Start to try again.');
  }
  if (gen !== generation) { // the page was left while the browser was asking
    stream.getTracks().forEach(t => t.stop());
    throw new AudioProblem('cancelled', 'Stopped.');
  }
  mics.add(stream);
  stream.getTracks().forEach(t => t.addEventListener('ended', () => { if (stream.getTracks().every(x => x.readyState === 'ended')) mics.delete(stream); }));
  return stream;
}
export function releaseMic(stream) {
  if (!stream) return;
  stream.getTracks().forEach(t => { try { t.stop(); } catch { /* already stopped */ } });
  mics.delete(stream);
}
// True while the microphone is still delivering sound (false once it is unplugged or taken by another app).
export const micLive = stream => !!stream && stream.getAudioTracks().some(t => t.readyState === 'live');

// The microphone into an analyser, through optional filters (filters(ctx) returns a chain of nodes).
// Returns { analyser, stream, ctx, stop }. Throws an AudioProblem.
export async function micAnalyser({ fftSize = 4096, filters = null } = {}) {
  const stream = await getMic();
  let c, src, chain = [];
  try {
    c = await wakeAudio();
    src = c.createMediaStreamSource(stream);
    chain = filters ? filters(c) : [];
  } catch (e) { releaseMic(stream); throw e instanceof AudioProblem ? e : new AudioProblem('other', 'Sound could not be started on this device.'); }
  const analyser = c.createAnalyser();
  analyser.fftSize = fftSize; analyser.smoothingTimeConstant = 0;
  let head = src;
  chain.forEach(n => { head.connect(n); head = n; });
  head.connect(analyser);
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    [src, ...chain, analyser].forEach(n => { try { n.disconnect(); } catch { /* already gone */ } });
    releaseMic(stream);
  };
  return { analyser, stream, ctx: c, stop };
}

// Stop every microphone and close the context. The next tool to need sound makes a new one.
export function stopAll() {
  generation++;
  [...mics].forEach(releaseMic);
  mics.clear();
  if (ctx) { const c = ctx; ctx = null; try { c.close().catch(() => {}); } catch { /* already closed */ } }
}

/* ------------------------------- state hook ------------------------------- */
// A tool reports its live state here (metronome running, wake lock held…). window.gigdexAudioState() shows it all.
export const registerState = (name, fn) => { states.set(name, fn); };
export function audioState() {
  const live = [...mics].flatMap(s => s.getTracks()).filter(t => t.readyState === 'live').length;
  const out = { context: ctx ? ctx.state : 'none', liveTracks: live, mics: mics.size };
  for (const [k, fn] of states) { try { out[k] = fn(); } catch { out[k] = null; } }
  return out;
}
if (typeof window !== 'undefined') window.gigdexAudioState = audioState;

/* ------------------------------- notes ------------------------------- */
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT_NAMES = ['', 'D♭', '', 'E♭', '', '', 'G♭', '', 'A♭', '', 'B♭', ''];
const SPOKEN = ['C', 'C sharp', 'D', 'D sharp', 'E', 'F', 'F sharp', 'G', 'G sharp', 'A', 'A sharp', 'B'];
export const A4_MIN = 415, A4_MAX = 466;
export const midiFreq = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const midiFloat = (freq, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
// A midi note number as { midi, name ('A♯'), letter ('A'), sharp, flat ('B♭' or ''), octave, label ('A♯4'), spoken }.
export function noteName(midi) {
  const pc = ((midi % 12) + 12) % 12, octave = Math.floor(midi / 12) - 1, name = NOTE_NAMES[pc];
  return { midi, pc, name, letter: name[0], sharp: name.length > 1, flat: FLAT_NAMES[pc], octave, label: name + octave, spoken: `${SPOKEN[pc]} ${octave}` };
}
// The nearest note to a frequency, and how far off it is in cents (−50…+50).
export function noteOf(freq, a4 = 440) {
  const m = midiFloat(freq, a4), midi = Math.round(m);
  return { ...noteName(midi), cents: (m - midi) * 100, freq };
}

/* ------------------------------- pitch ------------------------------- */
// The pitch in a buffer of samples, by the YIN method (de Cheveigné & Kawahara, 2002): a difference function, its
// cumulative mean normalisation, the first dip under a threshold, refined between samples by a parabola. A level gate
// (minRms) keeps silence and hiss from reading as notes. Returns { freq, clarity (0–1), rms } or null.
// 2048–4096 samples at 44.1 / 48 kHz read from a five-string bass's low B (31 Hz) up past a piccolo's top notes.
let scratch = new Float32Array(0);
export function analysePitch(buf, rate, { minFreq = 28, maxFreq = 2000, threshold = 0.12, minRms = 0.006 } = {}) {
  const n = buf ? buf.length : 0;
  if (n < 64 || !(rate > 0)) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / n);
  if (!(rms >= minRms)) return null;
  const maxTau = Math.min(Math.floor(rate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(rate / maxFreq));
  if (maxTau <= minTau + 2) return null;
  const W = n - maxTau;
  if (scratch.length < maxTau + 2) scratch = new Float32Array(maxTau + 2);
  const d = scratch;
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const x = buf[j] - buf[j + tau]; s += x * x; }
    running += s;
    d[tau] = running > 0 ? (s * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minTau; t < maxTau; t++) {
    if (d[t] < threshold) { while (t + 1 < maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) { // no clear dip: take the deepest one if it is still a fairly clean tone
    let best = minTau;
    for (let t = minTau + 1; t < maxTau; t++) if (d[t] < d[best]) best = t;
    if (d[best] > 0.3) return null;
    tau = best;
  }
  let exact = tau;
  if (tau > 1 && tau < maxTau) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b;
    if (den > 0) exact = tau + (a - c) / (2 * den);
  }
  const freq = rate / exact;
  if (!(freq >= minFreq && freq <= maxFreq)) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - d[tau])), rms };
}
// Just the frequency in Hz, or null for silence or noise.
export function detectPitch(buf, rate, opts) { const p = analysePitch(buf, rate, opts); return p ? p.freq : null; }

/* ------------------------------- level ------------------------------- */
export function rmsOf(buf) { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return buf.length ? Math.sqrt(s / buf.length) : 0; }
// Decibels below full scale (0 is the loudest the microphone delivers). Silence gives −120.
export const dbfs = rms => (rms > 1e-6 ? 20 * Math.log10(rms) : -120);
// The energy average of levels in dB (Leq): loud moments count for more, as they do for ears and noise limits.
export function leq(levels) {
  const xs = (levels || []).filter(Number.isFinite);
  if (!xs.length) return null;
  return 10 * Math.log10(xs.reduce((s, l) => s + 10 ** (l / 10), 0) / xs.length);
}

// An A-weighting filter (IEC 61672) as three biquads and a gain, so the meter reads like the dB(A) venues measure:
// two poles at 20.6 Hz, one each at 107.7 and 737.9 Hz (high-passes), two at 12194 Hz (a low-pass), 0 dB at 1 kHz.
// BiquadFilterNode takes the Q of its low- and high-passes in decibels.
export function aWeighting(c) {
  const qdb = q => 20 * Math.log10(q);
  const biquad = (type, f, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, c.sampleRate * 0.45); b.Q.value = qdb(q); return b; };
  const mid = Math.sqrt(107.7 * 737.9);
  const nodes = [biquad('highpass', 20.6, 0.5), biquad('highpass', mid, mid / (107.7 + 737.9)), biquad('lowpass', 12194, 0.5)];
  const g = c.createGain();
  const f = new Float32Array([1000]), mag = new Float32Array(1), ph = new Float32Array(1);
  let at1k = 1;
  for (const n of nodes) { n.getFrequencyResponse(f, mag, ph); at1k *= mag[0] || 1; }
  g.gain.value = at1k > 0 ? 1 / at1k : 1;
  return [...nodes, g];
}

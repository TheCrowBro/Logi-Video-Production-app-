// The tuner: the microphone, a pitch every ~50 ms (js/audio.js analysePitch), the nearest note with its octave, how
// many cents off it is on a needle, and the frequency. A median of the last readings and a gentle glide keep the
// needle from jittering; a note only changes when the pitch is clearly past half-way to the next one. Silence shows
// "Play a note". Concert pitch (A4) is adjustable from 415 to 466 Hz and saved; a reference tone plays any note.
import { h } from './util.js';
import {
  micAnalyser, micPermission, micLive, wakeAudio, analysePitch, noteName, midiFreq, midiFloat, rmsOf, dbfs,
  NOTE_NAMES, FLAT_NAMES, A4_MIN, A4_MAX, registerState,
} from './audio.js';
import { pref, clamp, repeatButton } from './tools-ui.js';

const A4_KEY = 'gdex-a4', TONE_KEY = 'gdex-tone';
const STRINGS = [['E2', 40], ['A2', 45], ['D3', 50], ['G3', 55], ['B3', 59], ['E4', 64], ['A4', 69]]; // a guitar's open strings, and A
const IN_TUNE = 5; // cents either side that count as in tune

export const readA4 = () => { const v = Math.round(Number(pref.get(A4_KEY, 440))); return Number.isFinite(v) && v >= A4_MIN && v <= A4_MAX ? v : 440; };
const savedTone = pref.get(TONE_KEY, {}) || {};
const T = {
  a4: readA4(),
  toneMidi: Number.isInteger(savedTone.midi) && savedTone.midi >= 24 && savedTone.midi <= 95 ? savedTone.midi : 69,
  rich: savedTone.rich !== false, // a sine plus overtones: phone speakers can't play a bass string's fundamental
};

/* ------------------------------- reference tone ------------------------------- */
let tone = null; // { osc, gain, ctx }
const RICH = [0, 1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05];
async function startTone() {
  const c = await wakeAudio();
  stopTone();
  const osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime;
  if (T.rich) osc.setPeriodicWave(c.createPeriodicWave(new Float32Array(RICH.length), new Float32Array(RICH)));
  else osc.type = 'sine';
  osc.frequency.value = midiFreq(T.toneMidi, T.a4);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.28, t + 0.04); // a short fade: no click at the start
  osc.connect(gain); gain.connect(c.destination);
  osc.start(t);
  tone = { osc, gain, ctx: c };
}
function retuneTone() {
  if (!tone) return;
  try { tone.osc.frequency.setTargetAtTime(midiFreq(T.toneMidi, T.a4), tone.ctx.currentTime, 0.015); } catch { tone = null; }
}
function stopTone() {
  if (!tone) return;
  const { osc, gain, ctx } = tone; tone = null;
  try {
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + 0.05);
    osc.stop(t + 0.07);
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch { /* gone */ } };
  } catch { /* the context is already closed: it made no sound */ }
}

let current = null; // the open tuner's state, for gdexAudioState()
registerState('tuner', () => (current ? current() : { listening: false, note: null, hz: null, tone: tone ? noteName(T.toneMidi).label : null }));

export function tuner(panel) {
  let mic = null, raf = 0, alive = true, starting = false, wanted = false, resumeOnShow = false;
  let shown = null, cents = 0, hz = 0, lastHeard = 0, lastRun = 0, level = -120;
  const hist = [];
  let said = '', saidAt = 0;
  const buf = new Float32Array(4096);

  /* ---------- the display ---------- */
  const letter = h('span', { class: 'tl-note-letter' }, '–');
  const acc = h('span', { class: 'tl-note-acc' });
  const oct = h('span', { class: 'tl-note-oct' });
  const alt = h('div', { class: 'tl-note-alt' });
  const needle = h('i', { class: 'tl-needle' });
  const centsEl = h('div', { class: 'tl-cents' }, 'Play a note');
  const hzEl = h('div', { class: 'tl-hz' }, '— Hz');
  const levelBar = h('i');
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const listening = h('span', { class: 'tl-live', hidden: true }, h('i', { 'aria-hidden': 'true' }), 'Listening');
  const err = h('div', { class: 'warn', role: 'alert', hidden: true });
  const startBtn = h('button', { type: 'button', class: 'btn primary', id: 'tl-tuner-start', onclick: () => (mic || starting ? stopListening(true) : start()) }, '🎤 Start tuner');
  const ticks = [];
  for (let c = -40; c <= 40; c += 10) ticks.push(h('i', { class: 'tl-tick' + (c === 0 ? ' zero' : c % 20 === 0 ? ' major' : ''), style: `left:${50 + c}%` }));
  const scaleLabel = (c, text) => h('span', { style: `left:${50 + c}%` }, text);
  const display = h('div', { class: 'tl-tuner', 'data-state': 'idle' },
    h('div', { class: 'tl-tuner-top' }, listening, h('span', { class: 'tl-a4-tag' })),
    h('div', { class: 'tl-note', 'aria-hidden': 'true' }, letter, acc, oct),
    alt,
    h('div', { class: 'tl-scale', 'aria-hidden': 'true' }, h('div', { class: 'tl-zone' }), ticks, needle),
    h('div', { class: 'tl-scale-labels', 'aria-hidden': 'true' }, scaleLabel(-50, '♭ −50'), scaleLabel(-25, '−25'), scaleLabel(0, '0'), scaleLabel(25, '+25'), scaleLabel(50, '+50 ♯')),
    centsEl, hzEl,
    h('div', { class: 'tl-level', title: 'What the microphone hears', 'aria-hidden': 'true' }, levelBar),
    live);
  const a4Tag = display.querySelector('.tl-a4-tag');

  /* ---------- concert pitch ---------- */
  const a4In = h('input', { type: 'number', id: 'tl-a4', min: A4_MIN, max: A4_MAX, step: 1, inputMode: 'numeric', value: T.a4, 'aria-label': 'Concert pitch: A4 in hertz' });
  const a4Back = h('button', { type: 'button', class: 'btn ghost small', id: 'tl-a4-reset', onclick: () => setA4(440) }, 'Back to 440');
  const setA4 = (v, typing = false) => {
    if (!Number.isFinite(v)) return;
    T.a4 = clamp(Math.round(v), A4_MIN, A4_MAX);
    pref.set(A4_KEY, T.a4);
    if (!typing || Number(a4In.value) !== T.a4) a4In.value = T.a4;
    paintA4(); retuneTone(); paintTone();
  };
  a4In.addEventListener('input', () => { const v = Number(a4In.value); if (a4In.value !== '' && v >= A4_MIN && v <= A4_MAX) setA4(v, true); });
  a4In.addEventListener('change', () => setA4(a4In.value === '' ? T.a4 : Number(a4In.value)));
  const paintA4 = () => { a4Tag.textContent = `A4 = ${T.a4} Hz`; a4Back.hidden = T.a4 === 440; };
  const a4Box = h('div', { class: 'tl-card' },
    h('div', { class: 'tl-row' },
      h('label', { for: 'tl-a4', class: 'tl-label' }, 'Concert pitch', h('span', { class: 'muted small' }, 'A4 in hertz')),
      h('div', { class: 'tl-stepper' },
        repeatButton({ class: 'icon-btn', id: 'tl-a4-down', 'aria-label': 'Lower concert pitch by 1 hertz' }, '−', () => setA4(T.a4 - 1)),
        a4In,
        repeatButton({ class: 'icon-btn', id: 'tl-a4-up', 'aria-label': 'Raise concert pitch by 1 hertz' }, '+', () => setA4(T.a4 + 1)))),
    h('p', { class: 'muted small tl-note-p' }, 'Most bands tune to 440. Some orchestras use 442 or 443, baroque groups 415. Saved on this device.', ' '),
    a4Back);

  /* ---------- reference tone ---------- */
  const playBtn = h('button', { type: 'button', class: 'btn primary', id: 'tl-tone-play', 'aria-pressed': 'false', onclick: () => toggleTone() }, '▶ Play');
  const noteSel = h('select', { id: 'tl-tone-note', 'aria-label': 'Reference note', onchange: () => pickTone(Number(octSel.value) * 12 + 12 + Number(noteSel.value)) },
    NOTE_NAMES.map((n, i) => h('option', { value: i }, n + (FLAT_NAMES[i] ? ' / ' + FLAT_NAMES[i] : ''))));
  const octSel = h('select', { id: 'tl-tone-oct', 'aria-label': 'Octave', onchange: () => pickTone(Number(octSel.value) * 12 + 12 + Number(noteSel.value)) },
    [1, 2, 3, 4, 5, 6].map(o => h('option', { value: o }, 'Octave ' + o)));
  const toneHz = h('div', { class: 'muted small tl-tone-hz' });
  const chips = STRINGS.map(([label, midi]) => h('button', { type: 'button', class: 'chip', 'data-midi': midi, 'aria-pressed': 'false', 'aria-label': `${label}${midi === 69 ? '' : ', guitar string'}`, onclick: () => pickTone(midi, true) }, label));
  const kind = [['sine', 'Sine'], ['rich', 'Rich']].map(([k, l]) => h('button', { type: 'button', 'data-k': k, 'aria-pressed': 'false', onclick: () => { T.rich = k === 'rich'; saveTone(); paintTone(); if (tone) startTone().catch(() => {}); } }, l));
  const saveTone = () => pref.set(TONE_KEY, { midi: T.toneMidi, rich: T.rich });
  async function pickTone(midi, play = false) {
    T.toneMidi = clamp(midi, 24, 95); saveTone(); retuneTone(); paintTone();
    if (play && !tone) await toggleTone();
  }
  async function toggleTone() {
    if (tone) { stopTone(); paintTone(); return; }
    try { await startTone(); } catch (e) { showProblem(e.message || 'Sound could not be started.'); }
    if (!alive) stopTone();
    paintTone();
  }
  function paintTone() {
    const n = noteName(T.toneMidi);
    noteSel.value = String(n.pc); octSel.value = String(clamp(n.octave, 1, 6));
    toneHz.textContent = `${n.label}${n.flat ? ' / ' + n.flat + n.octave : ''} · ${midiFreq(T.toneMidi, T.a4).toFixed(2)} Hz${T.rich ? ' · with overtones' : ' · pure sine'}`;
    playBtn.textContent = tone ? '■ Stop' : '▶ Play';
    playBtn.setAttribute('aria-pressed', String(!!tone));
    playBtn.classList.toggle('ghost', !!tone); playBtn.classList.toggle('primary', !tone);
    chips.forEach(c => { const on = Number(c.dataset.midi) === T.toneMidi; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    kind.forEach(b => { const on = (b.dataset.k === 'rich') === T.rich; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }
  const toneBox = h('div', { class: 'tl-card tl-tone' },
    h('h3', { class: 'tl-h' }, 'Reference tone'),
    h('div', { class: 'tl-chips', role: 'group', 'aria-label': 'Quick notes' }, chips),
    h('div', { class: 'tl-row tl-tone-pick' }, noteSel, octSel, playBtn),
    toneHz,
    h('div', { class: 'tl-row tl-tone-kind' }, h('span', { class: 'muted small' }, 'Sound'), h('div', { class: 'seg tl-mini-seg', role: 'group', 'aria-label': 'Tone sound' }, kind)),
    h('p', { class: 'muted small tl-note-p' }, 'Phone speakers can’t play a bass string’s low note: Rich adds overtones you can hear and tune to. Use Sine through headphones or an amp.'));

  /* ---------- listening ---------- */
  function showProblem(msg) { err.textContent = msg; err.hidden = !msg; }
  async function start() {
    if (mic || starting || !alive) return;
    starting = true; wanted = true; showProblem('');
    paintButtons();
    try {
      const m = await micAnalyser({ fftSize: 4096 });
      if (!alive || !wanted) { m.stop(); return; }
      mic = m; hist.length = 0; shown = null; lastHeard = 0;
      raf = requestAnimationFrame(loop);
    } catch (e) {
      wanted = false;
      if (e.code !== 'cancelled') showProblem(e.message);
    } finally { starting = false; paint(); paintButtons(); }
  }
  function stopListening(byHand = false) {
    if (byHand) wanted = false;
    cancelAnimationFrame(raf); raf = 0;
    if (mic) { mic.stop(); mic = null; }
    shown = null; hist.length = 0; level = -120;
    paint(); paintButtons();
  }
  function paintButtons() {
    const on = !!mic;
    startBtn.textContent = starting ? 'Starting…' : on ? '■ Stop listening' : '🎤 Start tuner';
    startBtn.classList.toggle('ghost', on); startBtn.classList.toggle('primary', !on);
    listening.hidden = !on;
    display.classList.toggle('on', on);
  }

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (!mic || ts - lastRun < 45) return;
    lastRun = ts;
    if (!micLive(mic.stream)) { stopListening(true); showProblem('The microphone stopped (unplugged, or taken by another app). Tap Start tuner to listen again.'); return; }
    mic.analyser.getFloatTimeDomainData(buf);
    level = dbfs(rmsOf(buf));
    const now = performance.now();
    const p = analysePitch(buf, mic.ctx.sampleRate);
    if (p) {
      const m = midiFloat(p.freq, T.a4);
      hist.push(m); if (hist.length > 5) hist.shift();
      const recent = hist.slice(-3).sort((a, b) => a - b), med = recent[Math.floor(recent.length / 2)];
      if (shown == null || Math.abs(med - shown) > 0.62) { shown = Math.round(med); cents = (med - shown) * 100; }
      else cents += ((med - shown) * 100 - cents) * 0.35;
      hz = midiFreq(shown + cents / 100, T.a4);
      lastHeard = now;
    } else if (shown != null && now - lastHeard > 850) { shown = null; hist.length = 0; }
    paint();
  }

  function paint() {
    levelBar.style.width = clamp((level + 66) / 60, 0, 1) * 100 + '%';
    const asleep = mic && mic.ctx.state !== 'running';
    if (shown == null) {
      letter.textContent = '–'; acc.textContent = ''; oct.textContent = ''; alt.textContent = '';
      needle.style.left = '50%';
      display.dataset.state = 'idle';
      centsEl.textContent = asleep ? 'Tap here to start listening' : mic ? 'Play a note' : starting ? 'Starting the microphone…' : 'Tap Start tuner, then play a note';
      hzEl.textContent = '— Hz';
      return;
    }
    const n = noteName(shown), c = clamp(cents, -50, 50), r = Math.round(cents);
    letter.textContent = n.letter; acc.textContent = n.sharp ? '♯' : ''; oct.textContent = String(n.octave);
    alt.textContent = n.flat ? `or ${n.flat}${n.octave}` : '';
    needle.style.left = 50 + c + '%';
    const state = Math.abs(cents) <= IN_TUNE ? 'in' : Math.abs(cents) <= 15 ? 'near' : 'off';
    display.dataset.state = state;
    centsEl.textContent = state === 'in' ? 'In tune ✓' : `${r > 0 ? '+' : '−'}${Math.abs(r)} cents · ${r > 0 ? 'sharp, tune down' : 'flat, tune up'}`;
    hzEl.textContent = `${hz.toFixed(1)} Hz`;
    // A screen reader hears the note when it settles, at most once a second and a half.
    const say = `${n.spoken}, ${state === 'in' ? 'in tune' : `${Math.abs(r)} cents ${r > 0 ? 'sharp' : 'flat'}`}`;
    const key = n.label + state;
    const now = performance.now();
    if (key !== said && now - saidAt > 1500) { said = key; saidAt = now; live.textContent = say; }
  }

  current = () => ({ listening: !!mic, note: shown != null ? noteName(shown).label : null, hz: shown != null ? Math.round(hz * 10) / 10 : null, cents: shown != null ? Math.round(cents) : null, tone: tone ? noteName(T.toneMidi).label : null, a4: T.a4 });
  display.addEventListener('click', () => { if (mic && mic.ctx.state !== 'running') wakeAudio().catch(() => {}); });

  panel.append(
    h('div', { class: 'tl-card tl-tuner-card' }, display, err, h('div', { class: 'actions center' }, startBtn)),
    a4Box, toneBox,
    h('p', { class: 'muted small tl-foot' }, 'The microphone is only listened to while the tuner is open. Nothing is recorded or sent anywhere.'));
  paintA4(); paintTone(); paint(); paintButtons();
  // Listen straight away when the microphone is already allowed; otherwise wait for a tap (no surprise prompts).
  micPermission().then(s => { if (alive && s === 'granted' && !mic && !starting) start(); });

  return {
    stop() { alive = false; wanted = false; stopListening(); stopTone(); current = null; },
    hidden() { if (mic || starting) { resumeOnShow = true; stopListening(); } },
    visible() { if (resumeOnShow && alive) { resumeOnShow = false; start(); } },
  };
}

export const TUNER_STEPS = [
  { target: ['.tl-tuner'], title: 'The tuner', text: 'Play one string or note at a time. The big letter is the nearest note with its octave; the needle shows how far off you are, in cents. Green and “In tune” means within 5 cents.' },
  { target: ['#tl-tuner-start'], title: 'Microphone', text: 'Gdex listens only while the tuner is open, and asks your permission the first time. Nothing is recorded.' },
  { target: ['#tl-a4'], title: 'Concert pitch', text: 'Tuning to a piano or an orchestra at 442? Change A4 here. It is saved on this device.' },
  { target: ['.tl-tone'], title: 'Reference tone', text: 'Pick a string or any note and play it to tune by ear. Rich adds overtones so low notes are audible on a phone speaker.' },
];

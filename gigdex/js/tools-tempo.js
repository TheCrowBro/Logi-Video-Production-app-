// Tempo: tap it in (on the pad or with the T key), turn BPM into milliseconds and back, and read delay times for any
// tempo (every note value straight, dotted and triplet, in ms and Hz) and reverb settings that breathe with the song.
// Tempo here is in quarter notes, the way a DAW counts it.
import { h, toast } from './util.js';
import { pref, clamp, num } from './tools-ui.js';

/* ------------------------------- the sums ------------------------------- */
// BPM from tap times in ms (oldest first): the average gap between them. null until there are two taps.
export function tapTempo(times) {
  if (!Array.isArray(times) || times.length < 2) return null;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? (60000 * (times.length - 1)) / span : null;
}
// A tap counter: averages the last `keep` taps and starts again after `resetAfter` ms without one.
export function createTapper({ resetAfter = 2000, keep = 9 } = {}) {
  let taps = [];
  const state = () => ({ bpm: tapTempo(taps), count: taps.length, last: taps[taps.length - 1] ?? null });
  return {
    tap(t = performance.now()) {
      if (taps.length && t - taps[taps.length - 1] > resetAfter) taps = [];
      if (taps.length && t <= taps[taps.length - 1]) return state(); // the same instant twice (a touch and its click)
      taps.push(t); if (taps.length > keep) taps.shift();
      return state();
    },
    reset() { taps = []; },
    stale(now = performance.now()) { return !taps.length || now - taps[taps.length - 1] > resetAfter; },
    state,
  };
}

export const NOTE_VALUES = [
  { id: '1/1', name: 'Whole', beats: 4 }, { id: '1/2', name: 'Half', beats: 2 }, { id: '1/4', name: 'Quarter', beats: 1 },
  { id: '1/8', name: 'Eighth', beats: 0.5 }, { id: '1/16', name: 'Sixteenth', beats: 0.25 }, { id: '1/32', name: 'Thirty-second', beats: 0.125 },
];
export const FEELS = [{ id: 'straight', name: 'Straight', k: 1 }, { id: 'dotted', name: 'Dotted', k: 1.5 }, { id: 'triplet', name: 'Triplet', k: 2 / 3 }];
export const msPerBeat = bpm => 60000 / bpm;
// Every note value at a tempo: [{ id, name, cells: [{ feel, ms, hz }] }].
export function delayTable(bpm) {
  const q = msPerBeat(bpm);
  return NOTE_VALUES.map(v => ({ ...v, cells: FEELS.map(f => { const ms = q * v.beats * f.k; return { feel: f.id, ms, hz: 1000 / ms }; }) }));
}
export const fmtMs = ms => (Number.isFinite(ms) ? ms.toFixed(1) : '—');
export const fmtHz = hz => (Number.isFinite(hz) ? (hz >= 10 ? hz.toFixed(1) : hz.toFixed(2)) : '—');
export const fmtTime = ms => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${fmtMs(ms)} ms`);
// Reverb that fits the tempo: a short pre-delay (a 64th or 32nd note) and a decay that ends just as the next note
// value arrives (that note's length less the pre-delay). Starting points for the ear, not rules.
export function reverbTimes(bpm) {
  const q = msPerBeat(bpm), pre64 = q / 16, pre32 = q / 8;
  return [
    { id: 'room', name: 'Small room', pre: pre64, preNote: '1/64', decay: q - pre64, fits: 'a quarter note' },
    { id: 'plate', name: 'Plate', pre: pre64, preNote: '1/64', decay: 2 * q - pre64, fits: 'a half note' },
    { id: 'hall', name: 'Hall', pre: pre32, preNote: '1/32', decay: 4 * q - pre32, fits: 'a bar of 4/4' },
    { id: 'ambient', name: 'Long / ambient', pre: pre32, preNote: '1/32', decay: 8 * q - pre32, fits: 'two bars of 4/4' },
  ];
}

/* ------------------------------- the tool ------------------------------- */
const KEY = 'gigdex-tempo';
export const TEMPO_MIN = 20, TEMPO_MAX = 400;
const S = { bpm: (() => { const v = Number((pref.get(KEY, {}) || {}).bpm); return Number.isFinite(v) && v >= TEMPO_MIN && v <= TEMPO_MAX ? v : 120; })() };
const tapper = createTapper();

export function tempo(panel, ctx) {
  let alive = true, staleTimer = 0;
  const round1 = v => Math.round(v * 10) / 10;

  /* ---------- tap ---------- */
  const tapBpm = h('b', { class: 'tl-tap-bpm' }, '–');
  const tapSub = h('span', { class: 'tl-tap-sub' }, 'Tap along: here, or press T');
  const tapLive = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const pad = h('button', { type: 'button', class: 'tl-tap', id: 'tl-tap', 'aria-label': 'Tap the tempo', 'aria-describedby': 'tl-tap-sub' },
    h('span', { class: 'tl-tap-word', 'aria-hidden': 'true' }, 'TAP'), tapBpm, h('span', { class: 'tl-tap-unit', 'aria-hidden': 'true' }, 'BPM'));
  tapSub.id = 'tl-tap-sub';
  let handledAt = 0;
  const doTap = t => {
    handledAt = performance.now();
    const s = tapper.tap(t);
    pad.classList.remove('hit'); void pad.offsetWidth; pad.classList.add('hit');
    if (s.bpm) {
      tapBpm.textContent = String(Math.round(s.bpm));
      tapSub.textContent = `${s.count} taps · average ${s.bpm.toFixed(1)}`;
      setBpm(Math.round(s.bpm), 'tap');
      tapLive.textContent = `${Math.round(s.bpm)} BPM`;
    } else { tapBpm.textContent = '…'; tapSub.textContent = 'Keep tapping…'; }
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { if (alive && tapper.stale()) tapSub.textContent = 'Tap again to start over'; }, 2100);
  };
  pad.addEventListener('pointerdown', e => { if (e.button === 0) doTap(e.timeStamp || performance.now()); });
  pad.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); doTap(performance.now()); } });
  pad.addEventListener('click', () => { if (performance.now() - handledAt > 350) doTap(performance.now()); }); // a screen reader's tap has no pointerdown
  const clearTaps = h('button', { type: 'button', class: 'btn ghost small', id: 'tl-tap-clear', onclick: () => { tapper.reset(); tapBpm.textContent = '–'; tapSub.textContent = 'Tap along: here, or press T'; } }, 'Clear');

  /* ---------- BPM ⇄ ms ---------- */
  const bpmIn = h('input', { type: 'number', id: 'tl-tempo-bpm', min: TEMPO_MIN, max: TEMPO_MAX, step: 'any', inputMode: 'decimal', value: S.bpm });
  const msIn = h('input', { type: 'number', id: 'tl-tempo-ms', min: 1, step: 'any', inputMode: 'decimal', value: fmtMs(msPerBeat(S.bpm)) });
  const hzOut = h('span', { class: 'muted small' });
  bpmIn.addEventListener('input', () => { const v = num(bpmIn.value); if (v >= TEMPO_MIN && v <= TEMPO_MAX) setBpm(v, 'bpm'); });
  bpmIn.addEventListener('change', () => { const v = num(bpmIn.value); setBpm(Number.isFinite(v) ? clamp(v, TEMPO_MIN, TEMPO_MAX) : S.bpm); });
  msIn.addEventListener('input', () => { const v = num(msIn.value); if (v > 0 && 60000 / v >= TEMPO_MIN && 60000 / v <= TEMPO_MAX) setBpm(60000 / v, 'ms'); });
  msIn.addEventListener('change', () => { const v = num(msIn.value); setBpm(v > 0 ? clamp(60000 / v, TEMPO_MIN, TEMPO_MAX) : S.bpm); });
  const toMetro = h('button', { type: 'button', class: 'btn ghost', id: 'tl-tempo-metro', onclick: () => ctx.toMetronome(S.bpm) }, '🥁 Use in the metronome');

  /* ---------- tables ---------- */
  const table = h('div', { class: 'tl-dt', role: 'table', 'aria-label': 'Delay times' });
  const reverb = h('div', { class: 'tl-rv', role: 'table', 'aria-label': 'Reverb times' });
  const title = h('span', { class: 'tl-dt-bpm' });
  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast(`Copied ${what}`); } catch { toast(`${what} (copying isn’t available here)`); }
  };
  function paintTables() {
    const rows = delayTable(S.bpm);
    title.textContent = `at ${round1(S.bpm)} BPM`;
    table.replaceChildren(
      h('div', { class: 'tl-dt-row tl-dt-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Note'), FEELS.map(f => h('span', { role: 'columnheader' }, f.name))),
      ...rows.map(r => h('div', { class: 'tl-dt-row' + (r.id === '1/4' ? ' beat' : ''), role: 'row' },
        h('span', { class: 'tl-dt-note', role: 'rowheader' }, h('b', null, r.id), h('small', null, r.name.toLowerCase())),
        r.cells.map(c => {
          const feel = FEELS.find(f => f.id === c.feel).name.toLowerCase();
          const what = `${feel === 'straight' ? '' : feel + ' '}${r.name.toLowerCase()}`;
          return h('span', { role: 'cell' }, h('button', { type: 'button', class: 'tl-dt-cell', 'data-note': r.id, 'data-feel': c.feel,
            'aria-label': `${what}: ${fmtMs(c.ms)} milliseconds, ${fmtHz(c.hz)} hertz. Copy`,
            onclick: () => copy(fmtMs(c.ms), `${fmtMs(c.ms)} ms (${what})`) },
          h('b', null, fmtMs(c.ms)), h('small', null, `${fmtHz(c.hz)} Hz`)));
        }))));
    reverb.replaceChildren(
      h('div', { class: 'tl-rv-row tl-dt-head', role: 'row' }, h('span', { role: 'columnheader' }, 'Space'), h('span', { role: 'columnheader' }, 'Pre-delay'), h('span', { role: 'columnheader' }, 'Decay')),
      ...reverbTimes(S.bpm).map(r => h('div', { class: 'tl-rv-row', role: 'row', 'data-rv': r.id },
        h('span', { role: 'rowheader' }, h('b', null, r.name), h('small', null, `ends on ${r.fits}`)),
        h('span', { role: 'cell' }, h('b', null, `${fmtMs(r.pre)} ms`), h('small', null, `${r.preNote} note`)),
        h('span', { role: 'cell' }, h('b', null, fmtTime(r.decay))))));
  }

  function setBpm(v, from) {
    if (!Number.isFinite(v) || v <= 0) return;
    S.bpm = clamp(round1(v), TEMPO_MIN, TEMPO_MAX);
    pref.set(KEY, { bpm: S.bpm });
    if (from !== 'bpm') bpmIn.value = String(S.bpm);
    if (from !== 'ms') msIn.value = fmtMs(msPerBeat(S.bpm));
    hzOut.textContent = `One beat lasts ${fmtMs(msPerBeat(S.bpm))} ms (${fmtHz(S.bpm / 60)} Hz).`;
    paintTables();
  }

  panel.append(
    h('div', { class: 'tl-card tl-tap-card' }, pad, h('div', { class: 'tl-row tl-tap-foot' }, tapSub, clearTaps), tapLive),
    h('div', { class: 'tl-card' },
      h('h3', { class: 'tl-h' }, 'BPM and milliseconds'),
      h('div', { class: 'tl-conv' },
        h('div', { class: 'field' }, h('label', { for: 'tl-tempo-bpm' }, 'Tempo (BPM)'), bpmIn),
        h('span', { class: 'tl-conv-eq', 'aria-hidden': 'true' }, '⇄'),
        h('div', { class: 'field' }, h('label', { for: 'tl-tempo-ms' }, 'One beat (ms)'), msIn)),
      hzOut,
      h('div', { class: 'actions' }, toMetro)),
    h('div', { class: 'tl-card' },
      h('div', { class: 'tl-row' }, h('h3', { class: 'tl-h' }, 'Delay times ', title)),
      h('p', { class: 'muted small tl-note-p' }, 'Milliseconds for a delay’s time, hertz for a tremolo, auto-pan or LFO rate. Tap a time to copy it.'),
      table),
    h('div', { class: 'tl-card' },
      h('h3', { class: 'tl-h' }, 'Reverb that fits the tempo'),
      h('p', { class: 'muted small tl-note-p' }, 'A pre-delay keeps the words clear of the reverb; a decay that ends just before the next note keeps the mix from smearing. Starting points: trust your ears.'),
      reverb));
  setBpm(S.bpm, null);

  return {
    stop() { alive = false; clearTimeout(staleTimer); },
    key(e, { inside, loose, field, tab }) {
      if ((e.key === 't' || e.key === 'T') && (inside || loose || tab) && !field && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); doTap(performance.now()); return true; }
      return false;
    },
  };
}

export const TEMPO_STEPS = [
  { target: ['#tl-tap'], title: 'Tap tempo', text: 'Tap along with the band or a record: four or more taps give a steady reading. The T key works too. It starts again after two seconds without a tap.' },
  { target: ['#tl-tempo-bpm'], title: 'BPM and milliseconds', text: 'Type a tempo to see one beat in milliseconds, or type milliseconds to get the tempo.' },
  { target: ['.tl-dt'], title: 'Delay times', text: 'Every note value at this tempo, straight, dotted and triplet. A dotted eighth is the classic U2 / Edge delay. Tap any time to copy it.' },
  { target: ['.tl-rv'], title: 'Reverb', text: 'Pre-delay and decay times that end on the beat, for rooms, plates, halls and long ambient tails.' },
];

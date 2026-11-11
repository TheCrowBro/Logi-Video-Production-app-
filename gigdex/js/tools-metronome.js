// The metronome. Clicks are scheduled on the audio clock a little ahead of time (a timer wakes every 25 ms and books
// every click due in the next 120 ms), so they stay exact however busy the page is; the beat lights follow the same
// booked times. Tempo is in quarter notes, as in a DAW: in 6/8, 7/8 and 12/8 each click is an eighth note, with the
// strong beats of the bar accented. Settings are saved on this device.
import { h, sheet, toast } from './util.js';
import { db } from './store.js';
import { actName, fmtDur } from './model.js';
import { wakeAudio, registerState } from './audio.js';
import { pref, clamp, num, repeatButton, switchBox } from './tools-ui.js';
import { createTapper } from './tools-tempo.js';
import { sheetTutorial } from './tour.js';

export const BPM_MIN = 30, BPM_MAX = 300;
export const SIGS = [
  { id: '2/4', beats: 2, unit: 4 }, { id: '3/4', beats: 3, unit: 4 }, { id: '4/4', beats: 4, unit: 4 }, { id: '5/4', beats: 5, unit: 4 },
  { id: '6/8', beats: 6, unit: 8, groups: [3] }, { id: '7/8', beats: 7, unit: 8, groups: [2, 4] }, { id: '12/8', beats: 12, unit: 8, groups: [3, 6, 9] },
];
const SUB_NAMES = { 4: [['None', 'No subdivision'], ['8ths', 'Eighth notes'], ['Triplets', 'Triplets'], ['16ths', 'Sixteenth notes']], 8: [['None', 'No subdivision'], ['16ths', 'Sixteenth notes'], ['Triplets', 'Sixteenth-note triplets'], ['32nds', 'Thirty-second notes']] };
const MARKINGS = [[40, 'Grave'], [60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [156, 'Allegro'], [176, 'Vivace'], [200, 'Presto'], [Infinity, 'Prestissimo']];
export const marking = bpm => MARKINGS.find(([max]) => bpm <= max)[1];
const sigOf = id => SIGS.find(s => s.id === id) || SIGS[2];

const KEY = 'gigdex-metronome';
const saved = pref.get(KEY, {}) || {};
const M = {
  bpm: Number.isFinite(Number(saved.bpm)) ? clamp(Math.round(Number(saved.bpm)), BPM_MIN, BPM_MAX) : 120,
  sig: sigOf(saved.sig).id,
  sub: [1, 2, 3, 4].includes(saved.sub) ? saved.sub : 1,
  accent: saved.accent !== false,
  vol: Number.isFinite(Number(saved.vol)) ? clamp(Number(saved.vol), 0, 1) : 0.8,
  song: '', // the song a tempo came from, until the tempo is changed by hand
};
const save = () => pref.set(KEY, { bpm: M.bpm, sig: M.sig, sub: M.sub, accent: M.accent, vol: M.vol });
// Set the tempo from elsewhere (the Tempo tool's "Use in the metronome").
export function setMetronomeBpm(bpm, from = '') { if (!Number.isFinite(Number(bpm))) return; M.bpm = clamp(Math.round(Number(bpm)), BPM_MIN, BPM_MAX); M.song = from; save(); }

// The engine's live numbers, for gigdexAudioState().metronome.
const E = { running: false, clicks: 0, beats: 0, lastBeat: -1 };
registerState('metronome', () => ({ running: E.running, bpm: M.bpm, sig: M.sig, sub: M.sub, accent: M.accent, clicks: E.clicks, beats: E.beats, beat: E.lastBeat }));

const gainOf = v => v * v * 0.9; // a slider that feels even: loudness grows with the square

export function metronome(panel, ctx) {
  let alive = true, ac = null, master = null, timer = 0, raf = 0;
  let nextTime = 0, beat = 0, part = 0, queue = [];
  const tapper = createTapper();

  /* ---------- tempo ---------- */
  const bpmIn = h('input', { type: 'number', id: 'tl-bpm', class: 'tl-bpm-in', min: BPM_MIN, max: BPM_MAX, step: 1, inputMode: 'numeric', value: M.bpm, 'aria-label': 'Tempo in beats per minute' });
  const range = h('input', { type: 'range', id: 'tl-bpm-range', min: BPM_MIN, max: BPM_MAX, step: 1, value: M.bpm, 'aria-label': 'Tempo slider', 'aria-valuetext': `${M.bpm} BPM` });
  const markEl = h('div', { class: 'tl-mark' });
  const eighthEl = h('div', { class: 'muted small tl-eighths' });
  const songEl = h('div', { class: 'tl-from', hidden: true });
  bpmIn.addEventListener('input', () => { const v = num(bpmIn.value); if (Number.isInteger(v) && v >= BPM_MIN && v <= BPM_MAX) setBpm(v, 'box'); });
  bpmIn.addEventListener('change', () => { const v = num(bpmIn.value); setBpm(Number.isFinite(v) ? v : M.bpm); });
  range.addEventListener('input', () => setBpm(Number(range.value), 'range'));
  const tapBtn = h('button', { type: 'button', class: 'btn ghost', id: 'tl-metro-tap', 'aria-label': 'Tap the tempo' }, '👆 Tap');
  let tappedAt = 0;
  const tap = t => { tappedAt = performance.now(); const s = tapper.tap(t); if (s.bpm) setBpm(s.bpm); else toast('Keep tapping…'); };
  tapBtn.addEventListener('pointerdown', e => { if (e.button === 0) tap(e.timeStamp || performance.now()); });
  tapBtn.addEventListener('click', () => { if (performance.now() - tappedAt > 350) tap(performance.now()); });

  function setBpm(v, from, song = '') {
    if (!Number.isFinite(v)) return;
    M.bpm = clamp(Math.round(v), BPM_MIN, BPM_MAX); M.song = song;
    save(); paintBpm(from);
  }
  function paintBpm(from) {
    if (from !== 'box' || document.activeElement !== bpmIn) bpmIn.value = String(M.bpm);
    if (from !== 'range') range.value = String(M.bpm);
    range.setAttribute('aria-valuetext', `${M.bpm} BPM`);
    markEl.textContent = marking(M.bpm);
    const sig = sigOf(M.sig);
    eighthEl.textContent = sig.unit === 8 ? `Each click is an eighth note: ${M.bpm * 2} a minute${sig.groups && sig.groups.length && sig.beats % 3 === 0 ? ` · dotted quarter = ${Math.round((M.bpm * 2) / 3)}` : ''}` : '';
    eighthEl.hidden = sig.unit !== 8;
    songEl.hidden = !M.song;
    songEl.textContent = M.song ? `♪ From “${M.song}”` : '';
  }

  /* ---------- bar ---------- */
  const lights = h('div', { class: 'tl-lights', 'aria-hidden': 'true', 'data-beat': '-1' });
  const subDot = h('i', { class: 'tl-subdot', 'aria-hidden': 'true' });
  const sigBtns = SIGS.map(s => h('button', { type: 'button', 'data-sig': s.id, 'aria-pressed': 'false', 'aria-label': `${s.id} time`, onclick: () => setSig(s.id) }, s.id));
  const subBtns = [1, 2, 3, 4].map(n => h('button', { type: 'button', 'data-sub': n, 'aria-pressed': 'false', onclick: () => setSub(n) }));
  function drawLights() {
    const sig = sigOf(M.sig);
    lights.style.setProperty('--n', sig.beats);
    lights.replaceChildren(...Array.from({ length: sig.beats }, (_, i) => h('i', { class: (i === 0 && M.accent ? 'acc' : M.accent && sig.groups && sig.groups.includes(i) ? 'grp' : '') }, h('span', null, String(i + 1)))));
    lights.dataset.beat = '-1';
  }
  function paintBar() {
    const sig = sigOf(M.sig);
    sigBtns.forEach(b => { const on = b.dataset.sig === M.sig; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    subBtns.forEach(b => { const n = Number(b.dataset.sub), [short, long] = SUB_NAMES[sig.unit][n - 1], on = n === M.sub; b.textContent = short; b.setAttribute('aria-label', long); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    drawLights();
  }
  // A change of metre or subdivision while playing starts cleanly on the next beat.
  const onBeatBoundary = (oldSig, oldSub) => {
    if (!E.running || !part) return;
    nextTime += (oldSub - part) * (clickSec(oldSig) / oldSub);
    part = 0; beat = (beat + 1) % oldSig.beats;
  };
  function setSig(id) { const old = sigOf(M.sig); if (id === M.sig) return; onBeatBoundary(old, M.sub); M.sig = id; beat = 0; save(); paintBar(); paintBpm(); }
  function setSub(n) { if (n === M.sub) return; onBeatBoundary(sigOf(M.sig), M.sub); M.sub = n; save(); paintBar(); }
  const accent = switchBox({ id: 'tl-accent', label: 'Accent beat one', checked: M.accent, onchange: on => { M.accent = on; save(); drawLights(); } });
  const vol = h('input', { type: 'range', id: 'tl-vol', min: 0, max: 100, step: 1, value: Math.round(M.vol * 100), 'aria-label': 'Click volume',
    oninput: e => { M.vol = Number(e.target.value) / 100; save(); if (master && ac) master.gain.setTargetAtTime(gainOf(M.vol), ac.currentTime, 0.02); } });

  /* ---------- engine ---------- */
  const clickSec = sig => (sig.unit === 8 ? 30 : 60) / M.bpm;
  function click(t, level) {
    const f = { accent: 1760, group: 1320, beat: 1000, sub: 760 }[level];
    const v = { accent: 1, group: 0.72, beat: 0.6, sub: 0.3 }[level];
    const len = level === 'sub' ? 0.03 : level === 'accent' ? 0.06 : 0.045;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + len + 0.02);
    o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* gone */ } };
  }
  function schedule() {
    if (!E.running || !ac || ac.state === 'closed') return;
    // In the background the browser slows timers to about once a second: book further ahead so the click carries on.
    const ahead = document.hidden ? 1.6 : 0.12;
    const sig = sigOf(M.sig);
    if (nextTime < ac.currentTime - 0.2) nextTime = ac.currentTime + 0.05; // woke from a long stall: don't machine-gun the missed clicks
    while (nextTime < ac.currentTime + ahead) {
      const level = part ? 'sub' : beat === 0 ? (M.accent ? 'accent' : 'beat') : M.accent && sig.groups && sig.groups.includes(beat) ? 'group' : 'beat';
      click(nextTime, level);
      queue.push({ time: nextTime, beat, part });
      if (queue.length > 4000) queue.splice(0, queue.length - 4000);
      E.clicks++;
      nextTime += clickSec(sig) / M.sub;
      if (++part >= M.sub) { part = 0; beat = (beat + 1) % sig.beats; }
    }
    timer = setTimeout(schedule, 25);
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!ac) return;
    const heard = ac.currentTime - (ac.outputLatency || 0) - (ac.baseLatency || 0); // light up when the click reaches the ear
    let main = null, sub = false;
    while (queue.length && queue[0].time <= heard) { const n = queue.shift(); if (n.part === 0) { main = n; E.beats++; } else sub = true; }
    if (main) {
      const kids = lights.children;
      for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i === main.beat);
      const el = kids[main.beat];
      if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
      lights.dataset.beat = String(main.beat);
      E.lastBeat = main.beat;
    }
    if (sub || main) { subDot.classList.remove('flash'); void subDot.offsetWidth; subDot.classList.add('flash'); }
  }
  async function start() {
    if (E.running) return;
    let c;
    try { c = await wakeAudio(); } catch (e) { problem.textContent = e.message; problem.hidden = false; return; }
    if (!alive || E.running) return;
    problem.hidden = true;
    ac = c; master = ac.createGain(); master.gain.value = gainOf(M.vol); master.connect(ac.destination);
    E.running = true; E.clicks = 0; E.beats = 0; E.lastBeat = -1;
    beat = 0; part = 0; queue = [];
    nextTime = ac.currentTime + 0.06;
    schedule();
    raf = requestAnimationFrame(frame);
    paintRun();
  }
  function stop() {
    clearTimeout(timer); cancelAnimationFrame(raf); timer = raf = 0;
    if (master) { try { master.disconnect(); } catch { /* gone */ } } // silences clicks already booked
    master = null; ac = null; queue = [];
    E.running = false;
    [...lights.children].forEach(el => el.classList.remove('on', 'flash'));
    lights.dataset.beat = '-1';
    paintRun();
  }
  const toggle = () => (E.running ? stop() : start());

  /* ---------- song tempo ---------- */
  function openSongs() {
    const withTempo = db.songs.filter(s => Number(s.bpm) > 0);
    const without = db.songs.length - withTempo.length;
    const q = h('input', { type: 'search', class: 'search', id: 'tl-song-q', placeholder: 'Search songs', 'aria-label': 'Search songs', autocomplete: 'off' });
    const list = h('div', { class: 'list tl-songs' });
    let close = () => {};
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const hits = withTempo.filter(s => !t || [s.title, actName(s.actId), s.key].join(' ').toLowerCase().includes(t))
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
      list.replaceChildren(...(hits.length ? hits.map(s => h('button', { type: 'button', class: 'card tap tl-song', 'data-song': s.id,
        onclick: () => { setBpm(Number(s.bpm), null, s.title || 'Untitled'); close(); toast(`Tempo set to ${M.bpm} BPM from “${s.title || 'Untitled'}”`); } },
      h('div', { class: 'card-row' },
        h('div', null, h('strong', null, s.title || 'Untitled'), h('div', { class: 'muted small' }, [actName(s.actId), s.key, Number(s.duration) > 0 && fmtDur(s.duration)].filter(Boolean).join(' · '))),
        h('span', { class: 'tl-song-bpm' }, h('b', null, String(Math.round(Number(s.bpm)))), h('small', null, 'BPM'))))) : [h('p', { class: 'muted' }, `No song matches “${q.value.trim()}”.`)]));
    };
    q.addEventListener('input', draw);
    const body = withTempo.length
      ? h('div', { class: 'stack' }, q, list, without > 0 && h('p', { class: 'muted small' }, `${without} song${without === 1 ? ' has' : 's have'} no tempo yet, so ${without === 1 ? 'it isn’t' : 'they aren’t'} listed. Add the BPM under Songs.`))
      : h('div', { class: 'empty' }, h('p', null, db.songs.length ? 'None of your songs has a tempo yet. Add the BPM to a song under Songs and it shows up here.' : 'No songs yet. Add your songs with their tempo under Songs, and pick one here to set the click.'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); window.logiGo && window.logiGo('songs'); } }, '🎼 Go to Songs'));
    ({ close } = sheet('Use a song’s tempo', body));
    if (withTempo.length) { draw(); setTimeout(() => q.focus(), 60); }
  }

  /* ---------- the panel ---------- */
  const problem = h('div', { class: 'warn', role: 'alert', hidden: true });
  const runBtn = h('button', { type: 'button', class: 'btn primary tl-run', id: 'tl-metro-run', onclick: toggle });
  const paintRun = () => {
    runBtn.textContent = E.running ? '■ Stop' : '▶ Start';
    runBtn.setAttribute('aria-pressed', String(E.running));
    runBtn.classList.toggle('on', E.running);
    display.classList.toggle('running', E.running);
  };
  const display = h('div', { class: 'tl-metro' },
    lights, subDot,
    h('div', { class: 'tl-bpm-row' },
      repeatButton({ class: 'tl-round', id: 'tl-bpm-down', 'aria-label': 'Slower: 1 BPM less' }, '−', () => setBpm(M.bpm - 1)),
      h('div', { class: 'tl-bpm-box' }, bpmIn, h('span', { class: 'tl-bpm-unit', 'aria-hidden': 'true' }, 'BPM')),
      repeatButton({ class: 'tl-round', id: 'tl-bpm-up', 'aria-label': 'Faster: 1 BPM more' }, '+', () => setBpm(M.bpm + 1))),
    markEl, songEl, range, eighthEl);
  panel.append(
    h('div', { class: 'tl-card' }, display, problem,
      h('div', { class: 'tl-run-row' }, runBtn, tapBtn),
      h('p', { class: 'muted small tl-keys' }, 'Keyboard: Space starts and stops; ↑ ↓ change the tempo (hold Shift for 5).')),
    h('div', { class: 'tl-card' },
      h('div', { class: 'tl-label' }, 'Time signature'),
      h('div', { class: 'seg tl-sigs', role: 'group', 'aria-label': 'Time signature' }, sigBtns),
      h('div', { class: 'tl-label' }, 'Subdivision'),
      h('div', { class: 'seg tl-subs', role: 'group', 'aria-label': 'Subdivision' }, subBtns),
      h('div', { class: 'tl-row tl-opts' }, accent,
        h('label', { class: 'tl-vol', for: 'tl-vol' }, h('span', { 'aria-hidden': 'true' }, '🔈'), vol, h('span', { 'aria-hidden': 'true' }, '🔊')))),
    h('div', { class: 'tl-card tl-songcard' },
      h('div', { class: 'tl-row' },
        h('div', null, h('strong', null, 'Play along to a song'), h('div', { class: 'muted small' }, 'Set the click from a song’s tempo in Songs.')),
        h('button', { type: 'button', class: 'btn ghost', id: 'tl-metro-song', onclick: openSongs }, '🎼 Use a song’s tempo'))));
  paintBar(); paintBpm(); paintRun();

  return {
    stop() { alive = false; stop(); },
    space: true,
    key(e, { inside, loose, field, tab }) {
      if (field || tab || e.defaultPrevented) return false;
      if (e.key === ' ' && (inside || loose)) { e.preventDefault(); if (!e.repeat) toggle(); return true; }
      if (inside && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        setBpm(M.bpm + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 1));
        return true;
      }
      return false;
    },
  };
}

export const METRONOME_STEPS = [
  { target: ['.tl-bpm-row'], title: 'Tempo', text: 'Type the BPM, use − and + (hold to run), drag the slider, or tap it in with Tap. Tempo counts quarter notes, like your DAW.' },
  { target: ['.tl-lights'], title: 'Beat lights', text: 'One light per beat, in time with the click. Beat one is accented; in 6/8, 7/8 and 12/8 the other strong beats get a lighter accent.' },
  { target: ['.tl-sigs'], title: 'Time signature and subdivision', text: 'Pick the metre and, if you like, eighths, triplets or sixteenths between the beats.' },
  { target: ['#tl-metro-run'], title: 'Start and stop', text: 'Or press Space. The click is timed by the audio clock, so it stays steady even when the phone is busy.' },
  { target: ['#tl-metro-song'], title: 'A song’s tempo', text: 'Pick a song from Songs and the click takes its BPM.' },
];
sheetTutorial('Use a song’s tempo', [
  { target: ['#tl-song-q'], title: 'Find a song', text: 'Type part of a title, an act or a key.' },
  { target: ['.tl-song'], title: 'Pick it', text: 'Tap a song to set the metronome to its tempo. Songs without a BPM aren’t listed; add one under Songs.' },
]);

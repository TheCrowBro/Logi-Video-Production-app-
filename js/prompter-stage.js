// The teleprompter's stage: the script, white on black, scrolling at a speed in words a minute past a reading line.
// It knows nothing of logs, takes or storage, so the same stage runs in the prompter over the page (js/prompter.js),
// and in a window of its own on a second screen (prompter.html, js/prompter-screen.js), which never opens the vault.
// Whatever drives it (a tap, a key, a remote, a controlling window) sends it commands (cmd) and hears its state.
//
// The speed is in words a minute: the height a word takes up is measured from the lines that are read aloud, so a
// speed means the same at any text size and on any screen. The reading line sits at a fixed height on the screen; the
// line under it is the current line. Mirror and upside down turn the stage (the text, the reading line, the countdown
// and the time left, which the talent reads through the glass of a rig) and never the buttons around it. These
// settings belong to the screen, so they are kept on the device; which speaker's lines are read belongs to the script.
import { h, hold, wasHeld } from './util.js';

/* -------------------------------- settings -------------------------------- */
const KEY = 'logi-prompter';
// Text size: about this many characters on a line of the column (fewer is bigger text).
export const SIZES = [52, 44, 38, 33, 29, 25, 22, 19, 16, 13];
export const COLS = [['narrow', 'Narrow', 0.62], ['medium', 'Medium', 0.8], ['full', 'Full width', 0.95]];
export const MARKS = [[0.2, 'Near the top'], [0.33, 'A third down'], [0.5, 'The middle']];
export const SPACINGS = [[1.15, 'Tight'], [1.32, 'Normal'], [1.6, 'Loose']];
export const COUNT_LENGTHS = [3, 5, 10]; // seconds of countdown before a take, when it is on (count 0 is off)
export const DIRS = [['dim', 'Dimmed'], ['hide', 'Hidden'], ['read', 'Like the rest']];
const DEF = { size: 5, wpm: 140, mark: 0.33, col: 'medium', spacing: 1.32, mirror: false, flip: false, count: 3, countLen: 3, dirs: 'dim', names: true, voice: false };
const WPM_MIN = 60, WPM_MAX = 300;
const read = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEF }; } };
export const P = read();
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* kept for this visit */ } };
// Another window of Vdex on this device changed them (the second screen's window and the page share them).
export const reload = () => Object.assign(P, read());
export const clampSize = n => Math.max(0, Math.min(SIZES.length - 1, n));
export const clampWpm = n => Math.max(WPM_MIN, Math.min(WPM_MAX, n));
const SETTABLE = { size: v => clampSize(Number(v)), wpm: v => clampWpm(Number(v)), mark: v => (MARKS.some(m => m[0] === v) ? v : P.mark), col: v => (COLS.some(c => c[0] === v) ? v : P.col), spacing: v => (SPACINGS.some(s => s[0] === v) ? v : P.spacing), mirror: v => !!v, flip: v => !!v, count: v => ([0, ...COUNT_LENGTHS].includes(Number(v)) ? Number(v) : P.count), countLen: v => (COUNT_LENGTHS.includes(Number(v)) ? Number(v) : P.countLen), dirs: v => (DIRS.some(d => d[0] === v) ? v : P.dirs), names: v => !!v, voice: v => !!v };
export const setSetting = (k, v) => { if (!SETTABLE[k]) return false; P[k] = SETTABLE[k](v); save(); return true; };

/* --------------------------------- script --------------------------------- */
// Speakers' colours on black, for their names and the bar beside their lines.
const COLOURS = ['#ffd166', '#6fd3ff', '#ff8fb1', '#9be28a', '#c9a7ff', '#ffb37a'];
const SCENE = /^(?:[A-Z]?\d+[A-Z]?[.)]?\s+)?(INT|EXT|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|EST)[.\s/-]/i;
const ROLE = /^(presenter|host|narrator|interviewer|interviewee|anchor|reporter|voice ?over|v\.?o\.?|speaker \d+)$/i;
const DIR = /\[[^\]]*\]|\([^)]*\)/g; // directions inside a spoken line: [smile], (beat)
const caps = s => s === s.toUpperCase() && /\p{Lu}/u.test(s);
export const wordCount = t => (String(t).replace(DIR, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const cueName = t => t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const allDirection = t => /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/.test(t);

// Each line with who reads it and what it is: say (read aloud), dir (a direction), cue (a speaker's name over their
// lines), head (a scene or section heading), other (another speaker's line, when one speaker's lines are chosen). A
// script with scene headings (INT., EXT.) is a screenplay: only its dialogue is read, and the action between is
// direction. Any other script is read line by line, except lines that are all direction ([B-roll of the brewery]) and
// lines marked as direction (dir: the video column of a VIDEO | AUDIO script, a Final Draft shot); in it a name alone
// on a line names who reads what follows when the name comes back later in the script (a heading in capitals does
// not come back), and "ANA: Hello" or "Presenter: Hello" names who reads that line and what follows.
export function analyse(script, focus = '', dirs = P.dirs) {
  const paras = (script && script.paras) || [];
  const play = paras.some(p => p.kind === 'heading' && SCENE.test(p.text));
  const seen = {};
  paras.forEach(p => { if (p.kind === 'character') { const n = cueName(p.text); seen[n] = (seen[n] || 0) + 1; } });
  const isCue = p => p.kind === 'character' && (play || seen[cueName(p.text)] > 1 || ROLE.test(cueName(p.text)));
  const colour = {}; let next = 0;
  const colourOf = name => (name ? colour[name] || (colour[name] = COLOURS[next++ % COLOURS.length]) : '');
  let who = '';
  return paras.map(p => {
    let text = p.text, speaker = '', role = 'say', inline = false;
    if (isCue(p)) { who = cueName(p.text); return { id: p.id, text, speaker: who, role: 'cue', colour: colourOf(who), words: 0, marks: [] }; }
    if (p.dir) role = 'dir';
    else if (p.kind === 'heading' || p.kind === 'character') { who = ''; role = 'head'; }
    else if (p.kind === 'transition') role = 'dir';
    else if (p.kind === 'paren') { role = 'dir'; speaker = who; }
    else if (play) { if (p.kind === 'dialogue') speaker = who; else role = 'dir'; }
    else {
      const m = text.match(/^([^:\n]{1,30}):\s+(\S[\s\S]*)$/);
      if (m && (caps(m[1].trim()) || ROLE.test(m[1].trim()))) { who = cueName(m[1]); text = m[2]; inline = true; }
      speaker = who;
      if (allDirection(text)) role = 'dir';
    }
    if (role === 'dir' && dirs === 'read') role = 'say';
    if (role === 'say' && focus && speaker !== focus) role = 'other';
    // Emphasis from the file (bold, italic, underline), moved along when a "NAME:" was taken off the front.
    const cut = p.text.length - text.length;
    const marks = (p.marks || []).map(([a, b, f]) => [Math.max(0, a - cut), b - cut, f]).filter(([a, b]) => b > a && a < text.length);
    return { id: p.id, text, speaker, role, inline, marks, colour: colourOf(speaker), words: role === 'say' ? wordCount(text) : 0 };
  });
}
export const speakersOf = script => [...new Set(analyse(script, '', 'dim').filter(a => a.role === 'say' && a.speaker).map(a => a.speaker))];
export const wordsIn = (script, focus = '') => analyse(script, focus).reduce((t, a) => t + a.words, 0);
export const clock = secs => { const s = Math.max(0, Math.round(secs)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const quote = t => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 89) + '…' : s; };

/* --------------------------------- the stage --------------------------------- */
// The stage: el is its element; load() gives it a script ({ script, focus, from }); update() a changed one; cmd()
// drives it; state() says where it is: { playing, counting, line, wpm, size, left (seconds), end }. onState hears every
// change of state (and its place, four times a second, while it runs); onTap and onHold hear a tap and a held line.
export function makeStage({ onState = () => {}, onTap = null, onHold = null } = {}) {
  let A = [], els = [], lines = [], pos = 0, maxPos = 0, markY = 0, pxWord = 10, rowH = 40;
  let playing = false, raf = 0, last = 0, counting = 0, cur = -1, drag = null, key = '', data = null, beat = 0, ro = null;
  let follow = false, aimPos = null; // voice-follow: run to where the talent is (aim), not at a speed

  const col = h('div', { class: 'pr-col' });
  const padTop = h('div', { class: 'pr-pad' }), padBottom = h('div', { class: 'pr-pad' });
  const track = h('div', { class: 'pr-track' }, padTop, col, padBottom);
  const marker = h('div', { class: 'pr-marker', 'aria-hidden': 'true' });
  const count = h('div', { class: 'pr-count', 'aria-hidden': 'true', hidden: true });
  const left = h('div', { class: 'pr-left', 'aria-hidden': 'true' });
  const rec = h('div', { class: 'pr-rec', 'aria-hidden': 'true', hidden: true }, '● REC');
  const el = h('div', { class: 'pr-stage' }, track, marker, count, left, rec);

  /* the script on the stage: [directions] dimmed, and the stress the file gave (em-b bold, em-i italic, em-u underlined) */
  const parts = (t, marks = []) => {
    const dirs = [...t.matchAll(DIR)].map(m => [m.index, m.index + m[0].length]);
    const at = [...new Set([0, t.length, ...dirs.flat(), ...marks.flatMap(([a, b]) => [Math.min(a, t.length), Math.min(b, t.length)])])].sort((x, y) => x - y), out = [];
    for (let i = 0; i < at.length - 1; i++) {
      const a = at[i], b = at[i + 1], seg = t.slice(a, b); if (!seg) continue;
      const cls = new Set([...(dirs.some(([x, y]) => x <= a && b <= y) ? ['pr-dir'] : []), ...marks.filter(([x, y]) => x <= a && b <= y).flatMap(([, , f]) => [...f].map(c => 'em-' + c))]);
      out.push(cls.size ? h('span', { class: [...cls].join(' ') }, seg) : seg);
    }
    return out;
  };
  const lineEl = a => h('div', { class: `pr-line r-${a.role}`, 'data-id': a.id, hidden: (a.role === 'cue' && !P.names) || (a.role === 'dir' && P.dirs === 'hide'), style: a.colour ? `--spk:${a.colour}` : null },
    a.inline && P.names && a.speaker && h('span', { class: 'pr-who' }, a.speaker), ...parts(a.text, a.marks));
  const keyOf = d => `${d.script.rev || d.script.imported}|${d.script.paras.length}|${d.focus || ''}|${P.names}|${P.dirs}`;
  const render = () => { A = analyse(data.script, data.focus || ''); els = A.map(lineEl); col.replaceChildren(...els); key = keyOf(data); cur = -1; };

  /* layout: the font size from the screen's width, where each line sits, how far a word is */
  const anchor = () => (A[cur] && lines[cur] ? { id: A[cur].id, frac: lines[cur].h ? (pos - lines[cur].top) / lines[cur].h : 0 } : null);
  const measure = (at = anchor()) => {
    const W = el.clientWidth, H = el.clientHeight; if (!W || !H || !data) return;
    const colW = Math.round(W * ((COLS.find(c => c[0] === P.col) || COLS[1])[2]));
    const fs = Math.max(14, Math.round(colW / (SIZES[P.size] * 0.52)));
    const lh = Number(P.spacing) || 1.32;
    el.style.setProperty('--pr-fs', fs + 'px'); col.style.width = colW + 'px'; col.style.lineHeight = String(lh);
    markY = Math.round(H * P.mark); rowH = fs * lh;
    padTop.style.height = markY + 'px'; padBottom.style.height = Math.max(0, H - markY) + 'px';
    marker.style.top = markY + 'px'; marker.style.height = Math.round(rowH) + 'px';
    let end = 0;
    lines = els.map((x, i) => { if (x.hidden) return { top: end, h: 0, words: 0 }; const t = x.offsetTop; end = t + x.offsetHeight; return { top: t, h: x.offsetHeight, words: A[i].words }; });
    const said = lines.filter(l => l.words), sh = said.reduce((t, l) => t + l.h, 0), sw = said.reduce((t, l) => t + l.words, 0);
    pxWord = sw ? sh / sw : rowH / 5;
    maxPos = Math.max(0, end - rowH * 0.6);
    const i = at ? A.findIndex(a => a.id === at.id) : -1;
    pos = i >= 0 ? clampPos(lines[i].top + (at.frac || 0) * lines[i].h) : clampPos(pos);
    apply(); drawLeft(); emit();
  };
  const clampPos = p => Math.max(0, Math.min(maxPos, p));
  const indexAt = p => { let lo = 0, hi = lines.length - 1, at = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].top <= p + 1) { at = m; lo = m + 1; } else hi = m - 1; } while (at > 0 && !lines[at].h) at--; return at; };
  const apply = () => {
    track.style.transform = `translate3d(0, ${-pos}px, 0)`;
    const i = lines.length ? indexAt(pos) : -1;
    if (i !== cur) { els[cur]?.classList.remove('now'); cur = i; els[i]?.classList.add('now'); emit(); }
  };
  const pxPerSec = () => (pxWord * P.wpm) / 60;
  const secsLeft = () => (maxPos - pos) / pxPerSec();
  const drawLeft = () => { left.textContent = `${clock(secsLeft())} left · ${P.wpm} wpm`; };
  const state = () => ({ playing, counting: !!counting, line: A[cur] ? A[cur].id : null, wpm: P.wpm, size: P.size, left: Math.round(secsLeft()), end: pos >= maxPos, follow });
  const emit = () => { try { onState(state()); } catch { /* a listener's trouble is not the stage's */ } };

  /* playing */
  const frame = t => {
    if (!playing) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    if (!(drag && drag.moved)) pos = follow ? (aimPos == null ? pos : clampPos(pos + (aimPos - pos) * Math.min(1, dt * 3))) : clampPos(pos + pxPerSec() * dt);
    apply();
    if (pos >= maxPos && !follow) { pause(); return; }
    raf = requestAnimationFrame(frame);
  };
  const play = () => {
    if (playing) return;
    if (pos >= maxPos) pos = 0;
    playing = true; last = 0; el.dataset.state = 'running'; raf = requestAnimationFrame(frame);
    clearInterval(beat); beat = setInterval(() => { drawLeft(); emit(); }, 250); emit();
  };
  const pause = () => {
    if (counting) stopCount();
    if (!playing) return;
    playing = false; cancelAnimationFrame(raf); clearInterval(beat); el.dataset.state = 'paused'; drawLeft(); emit();
  };
  const firstSaid = () => Math.max(0, A.findIndex(a => a.role === 'say'));
  // From a stop at the top of the script, the countdown runs first; a pause in the middle carries straight on.
  const start = () => { if (cur <= firstSaid() && pos <= (lines[firstSaid()] || { top: 0 }).top + 1) countdown(play); else play(); };
  const toggle = () => (playing || counting ? pause() : start());
  const countdown = then => {
    let n = Number(P.count) || 0; if (!n) return then();
    if (counting) stopCount();
    el.dataset.state = 'count'; count.hidden = false; count.textContent = n;
    counting = setInterval(() => { n -= 1; if (n > 0) { count.textContent = n; return; } stopCount(); then(); }, 1000);
    emit();
  };
  const stopCount = () => { clearInterval(counting); counting = 0; count.hidden = true; if (el.dataset.state === 'count') el.dataset.state = 'paused'; emit(); };

  /* moving */
  const jump = i => { if (!lines[i]) return; pos = clampPos(lines[i].top); apply(); drawLeft(); emit(); };
  // A clicker's next and back go from one line that is read aloud to the next, past names and directions.
  const spoken = i => !!(A[i] && (A[i].role === 'say' || A[i].role === 'other') && lines[i] && lines[i].h);
  const stepLine = d => {
    if (d < 0 && spoken(cur) && pos > lines[cur].top + 2) return jump(cur); // part-way down a line: back to its start first
    let i = cur + d;
    while (i >= 0 && i < A.length && !spoken(i)) i += d;
    if (i < 0 || i >= A.length) { i = cur + d; while (lines[i] && !lines[i].h) i += d; } // none that way: the next line of any kind
    if (lines[i]) jump(i);
  };
  // The first line read aloud from i on (a take starts there; ⚑ marks it).
  const sayFrom = i => { for (let k = Math.max(0, i); k < A.length; k++) if (A[k].role === 'say' && lines[k] && lines[k].h) return k; return -1; };

  /* under a finger: tap plays and pauses (or onTap), a drag moves the text, holding a line offers it (onHold) */
  el.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { y: e.clientY, pos, moved: false }; });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 8) { drag.moved = true; try { el.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    if (drag.moved) { pos = clampPos(drag.pos - (P.flip ? -dy : dy)); apply(); drawLeft(); }
  });
  el.addEventListener('pointerup', () => { const d = drag; drag = null; if (!d || d.moved || wasHeld(el)) { if (d && d.moved) emit(); return; } if (onTap) onTap(); else toggle(); });
  el.addEventListener('pointercancel', () => { drag = null; });
  el.addEventListener('wheel', e => { e.preventDefault(); pos = clampPos(pos + (P.flip ? -e.deltaY : e.deltaY)); apply(); drawLeft(); }, { passive: false });
  if (onHold) hold(el, 550, e => { const x = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pr-line'); if (x && drag && !drag.moved) { drag = null; onHold(x.dataset.id); } });

  /* driving it */
  const look = () => { el.classList.toggle('mirror', !!P.mirror); el.classList.toggle('flip', !!P.flip); };
  const refresh = () => { look(); if (data && keyOf(data) !== key) { const at = anchor(); render(); measure(at); } else measure(); };
  const cmd = (name, arg) => {
    switch (name) {
      case 'toggle': return toggle();
      case 'play': return play();
      case 'pause': return pause();
      case 'start': return start();
      case 'go': if (arg && arg.from) { const i = A.findIndex(a => a.id === arg.from); if (i >= 0) jump(i); } return countdown(play); // a take: from its line, after the countdown
      case 'step': return stepLine(arg < 0 ? -1 : 1);
      case 'goto': { const i = A.findIndex(a => a.id === arg); if (i >= 0) jump(i); return; }
      case 'home': return jump(0);
      case 'end': pos = maxPos; apply(); drawLeft(); emit(); return;
      case 'wpm': P.wpm = clampWpm(P.wpm + Number(arg || 0)); save(); drawLeft(); emit(); return;
      case 'size': { const was = P.size; P.size = clampSize(P.size + Number(arg || 0)); if (P.size !== was) { save(); measure(); } emit(); return; }
      case 'set': if (arg && setSetting(arg.key, arg.value)) refresh(); emit(); return;
      case 'follow': follow = !!arg; aimPos = null; emit(); return; // voice-follow on or off
      // Where the talent's voice is: a line and how far through it (0 to 1). The row with that word goes to the
      // reading line, and the stage runs there smoothly while it plays.
      case 'aim': { const i = arg ? A.findIndex(a => a.id === arg.id) : -1; if (i < 0 || !lines[i]) return; const l = lines[i]; aimPos = clampPos(Math.max(l.top, l.top + Math.max(0, Math.min(1, Number(arg.frac) || 0)) * l.h - rowH)); return; }
      default:
    }
  };
  return {
    el, cmd, state, refresh,
    load: d => { data = { script: d.script, focus: d.focus || '' }; look(); render(); measure({ id: d.from || (A[0] && A[0].id), frac: 0 }); },
    update: d => { const next = { script: d.script, focus: d.focus || '' }; const changed = !data || keyOf(next) !== key; data = next; if (changed) { const at = anchor(); render(); measure(at); } },
    attach: () => { ro = new ResizeObserver(() => measure()); ro.observe(el); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (el.isConnected) measure(); }); },
    setRec: on => { rec.hidden = !on; },
    lines: () => A, current: () => cur, sayFrom, firstSay: () => sayFrom(0),
    destroy: () => { playing = false; cancelAnimationFrame(raf); clearInterval(beat); clearInterval(counting); counting = 0; if (ro) ro.disconnect(); },
  };
}

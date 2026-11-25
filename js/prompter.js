// The teleprompter: a log's script read full screen to the talent, scrolling at a reading speed, with the takes it
// prompts logged on the log (js/pages/tcnotes.js keeps the log and its takes; this file shows it). Loaded on first use,
// from a log's Prompter view, from a line of its script (Prompt from here) and from the logs page's 📜 Prompter.
//
// The speed is in words a minute: the height a word takes up is measured from the lines that are read aloud, so a
// speed means the same at any text size and on any screen. The reading line sits at a fixed height on the screen; the
// line under it is the current line. Mirror and upside down turn the stage (the text, the reading line, the countdown
// and the time left, which the talent reads through the glass of a rig) and never the buttons, which are for whoever
// holds the device. Those settings belong to the screen, so they are kept on this device; which speaker's lines are
// read belongs to the script, so it is kept on the log.
import { h, sheet, announce, hold, wasHeld, covered, settleApp } from './util.js';
import { byId, update, subscribe } from './store.js';
import * as store from './store.js';
import { haptic } from './a11y.js';
import { nowTc, fmt, quoteOf, startTake, endTake, rateTake, openTake, markLine, editLine, openImport } from './pages/tcnotes.js';

/* -------------------------------- settings -------------------------------- */
const KEY = 'logi-prompter';
// Text size: about this many characters on a line of the column (fewer is bigger text).
const SIZES = [52, 44, 38, 33, 29, 25, 22, 19, 16, 13];
const COLS = [['narrow', 'Narrow', 0.62], ['medium', 'Medium', 0.8], ['full', 'Full width', 0.95]];
const MARKS = [[0.2, 'Near the top'], [0.33, 'A third down'], [0.5, 'The middle']];
const SPACINGS = [[1.15, 'Tight'], [1.32, 'Normal'], [1.6, 'Loose']];
const COUNTS = [[0, 'Off'], [3, '3 s'], [5, '5 s']];
const DIRS = [['dim', 'Dimmed'], ['hide', 'Hidden'], ['read', 'Like the rest']];
const DEF = { size: 5, wpm: 140, mark: 0.33, col: 'medium', spacing: 1.32, mirror: false, flip: false, count: 3, dirs: 'dim', names: true };
const WPM_MIN = 60, WPM_MAX = 300;
const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEF }; } };
const P = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* kept for this visit */ } };
const clampSize = n => Math.max(0, Math.min(SIZES.length - 1, n));
const clampWpm = n => Math.max(WPM_MIN, Math.min(WPM_MAX, n));
export const prompterSettings = () => ({ ...P });

/* --------------------------------- script --------------------------------- */
// Speakers' colours on black, for their names and the bar beside their lines.
const COLOURS = ['#ffd166', '#6fd3ff', '#ff8fb1', '#9be28a', '#c9a7ff', '#ffb37a'];
const SCENE = /^(?:[A-Z]?\d+[A-Z]?[.)]?\s+)?(INT|EXT|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|EST)[.\s/-]/i;
const ROLE = /^(presenter|host|narrator|interviewer|interviewee|anchor|reporter|voice ?over|v\.?o\.?|speaker \d+)$/i;
const DIR = /\[[^\]]*\]|\([^)]*\)/g; // directions inside a spoken line: [smile], (beat)
const caps = s => s === s.toUpperCase() && /\p{Lu}/u.test(s);
const wordCount = t => (String(t).replace(DIR, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const cueName = t => t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
const allDirection = t => /^\s*(\[[^\]]*\]|\([^)]*\))\s*$/.test(t);

// Each line with who reads it and what it is: say (read aloud), dir (a direction), cue (a speaker's name over their
// lines), head (a scene or section heading), other (another speaker's line, when one speaker's lines are chosen). A
// script with scene headings (INT., EXT.) is a screenplay: only its dialogue is read, and the action between is
// direction. Any other script is read line by line, except lines that are all direction ([B-roll of the brewery]); in
// it a name alone on a line names who reads what follows when the name comes back later in the script (a heading in
// capitals does not come back), and "ANA: Hello" or "Presenter: Hello" names who reads that line and what follows.
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
    if (isCue(p)) { who = cueName(p.text); return { id: p.id, text, speaker: who, role: 'cue', colour: colourOf(who), words: 0 }; }
    if (p.kind === 'heading' || p.kind === 'character') { who = ''; role = 'head'; }
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
    return { id: p.id, text, speaker, role, inline, colour: colourOf(speaker), words: role === 'say' ? wordCount(text) : 0 };
  });
}
export const speakersOf = script => [...new Set(analyse(script, '', 'dim').filter(a => a.role === 'say' && a.speaker).map(a => a.speaker))];
const focusOf = log => (log && log.prompt && log.prompt.focus) || '';
export const wordsToRead = log => analyse(log.script, focusOf(log)).reduce((t, a) => t + a.words, 0);
const clock = secs => { const s = Math.max(0, Math.round(secs)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const quote = t => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 89) + '…' : s; };

/* ------------------------------ the log's view ------------------------------ */
// The Prompter view of a log: what will be read and how long it takes, the settings for this screen, and the takes.
export function prompterPane(log) {
  const sc = log.script;
  if (!sc || !sc.paras || !sc.paras.length) {
    return h('div', { class: 'empty pr-pane' },
      h('p', null, 'The prompter reads a script full screen to the talent, at the speed they speak, and logs each take you roll. Add the script first.'),
      h('button', { class: 'btn primary', onclick: () => openImport(log, null, { view: 'prompter' }) }, '📄 Add script'));
  }
  const sum = h('div', { class: 'muted small pr-sum' });
  const drawSum = () => { const w = wordsToRead(byId('logs', log.id) || log); sum.textContent = `${sc.paras.length} lines · ${w} words to read · about ${clock((w / P.wpm) * 60)} at ${P.wpm} words a minute`; };
  drawSum();
  const takes = log.notes.filter(n => n.kind === 'roll').sort((a, b) => (b.take || 0) - (a.take || 0) || String(b.at).localeCompare(String(a.at)));
  return h('div', { class: 'pr-pane stack' },
    h('div', { class: 'card pr-launch' },
      h('div', null, h('strong', null, sc.name || 'Script'), sum),
      h('button', { class: 'btn primary pr-open', type: 'button', onclick: () => openPrompter(log.id) }, '📜 Open the prompter'),
      !log.sync && h('p', { class: 'small muted' }, 'Not synced yet: takes are logged with the time of day. Sync this log to the camera and they carry its timecode.')),
    h('div', { class: 'card pr-setup' }, h('h3', null, 'This screen'), settingsPanel(log.id, drawSum)),
    takes.length > 0 && h('div', { class: 'card pr-takes' }, h('h3', null, `Takes (${takes.length})`),
      h('ol', { class: 'pr-take-list' }, takes.slice(0, 40).map(n => takeRow(log, n)))),
    h('p', { class: 'small muted pr-keys' }, 'Clickers, foot pedals and keyboards: Space plays and pauses, Page Down and Page Up move a line, ↑ and ↓ change the speed, R rolls and cuts, F marks the line, Esc closes.'));
}
const rateButtons = (logId, n) => h('span', { class: 'pr-rates' },
  h('button', { class: 'btn small ' + (n.rate === 'good' ? 'on good' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'good', onclick: () => rateTake(logId, n.id, n.rate === 'good' ? null : 'good') }, '★ Good'),
  h('button', { class: 'btn small ' + (n.rate === 'ng' ? 'on ng' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'ng', onclick: () => rateTake(logId, n.id, n.rate === 'ng' ? null : 'ng') }, '✕ No good'));
const takeRow = (log, n) => h('li', { class: 'pr-take' },
  h('span', { class: 'tc-mono pr-take-tc' }, n.frames == null ? 'unsynced' : fmt(n.frames, log)),
  h('span', { class: 'grow' }, h('b', null, `Take ${n.take || ''}`), n.dur ? ` · ${n.dur}` : ' · rolling', n.quote && h('span', { class: 'muted' }, ` · from “${n.quote}”`)),
  rateButtons(log.id, n));

// The settings, in the Prompter view and behind ⚙ on the prompter. onChange(key) after each change.
function settingsPanel(logId, onChange = () => {}) {
  const box = h('div', { class: 'stack pr-prefs' });
  const set = (k, v) => { P[k] = v; save(); haptic(); draw(); onChange(k); };
  const seg = (label, key, opts) => h('div', { class: 'pref', role: 'group', 'aria-label': label }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', { type: 'button', class: P[key] === v ? 'on' : '', 'aria-pressed': P[key] === v, onclick: () => set(key, v) }, l))));
  const stepper = (cls, label, value, less, more, lessLabel, moreLabel) => h('div', { class: 'pref ' + cls }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'pr-stepper' }, h('button', { type: 'button', class: 'btn ghost', 'aria-label': lessLabel, onclick: less }, '−'), h('span', { class: 'pr-val' }, value), h('button', { type: 'button', class: 'btn ghost', 'aria-label': moreLabel, onclick: more }, '+')));
  const draw = () => {
    const log = byId('logs', logId), speakers = log && log.script ? speakersOf(log.script) : [], focus = focusOf(log);
    box.replaceChildren(
      stepper('pr-set-size', 'Text size', `about ${SIZES[P.size]} letters a line`, () => set('size', clampSize(P.size - 1)), () => set('size', clampSize(P.size + 1)), 'Smaller text', 'Bigger text'),
      stepper('pr-set-speed', 'Speed', `${P.wpm} words a minute`, () => set('wpm', clampWpm(P.wpm - 5)), () => set('wpm', clampWpm(P.wpm + 5)), 'Slower', 'Faster'),
      seg('Mirror', 'mirror', [[false, 'Off'], [true, 'Mirrored for a rig']]),
      seg('Upside down', 'flip', [[false, 'Off'], [true, 'On']]),
      seg('Reading line', 'mark', MARKS),
      seg('Column', 'col', COLS.map(([v, l]) => [v, l])),
      seg('Line spacing', 'spacing', SPACINGS),
      seg('Countdown before a take', 'count', COUNTS),
      seg('Directions', 'dirs', DIRS),
      seg('Speaker names', 'names', [[true, 'Shown'], [false, 'Hidden']]),
      speakers.length > 1 && h('div', { class: 'pref', role: 'group', 'aria-label': 'Lines to read' }, h('div', { class: 'pref-label' }, 'Lines to read'),
        h('div', { class: 'seg wide' }, [['', 'Everyone'], ...speakers.map(s => [s, s])].map(([v, l]) => h('button', { type: 'button', class: focus === v ? 'on' : '', 'aria-pressed': focus === v, onclick: () => setFocus(logId, v) }, l)))),
      speakers.length > 1 && h('p', { class: 'small muted' }, 'Choosing one speaker dims the others’ lines, so they are still there as cues.'));
  };
  draw();
  return box;
}
function setFocus(logId, v) {
  update(d => { const l = d.logs.find(x => x.id === logId); if (!l) return; l.prompt = { ...(l.prompt || {}), focus: v }; l.updatedAt = Date.now(); });
}

/* ------------------------------- the prompter ------------------------------- */
let OPEN = null; // the prompter on screen: { close }
const lastLine = new Map(); // log id → the line it was on, to open there again
export const prompterOpen = () => !!OPEN;
export function openPrompter(logId, { from = null } = {}) {
  if (OPEN) return;
  const log = byId('logs', logId);
  if (!log || !log.script || !log.script.paras || !log.script.paras.length) return;
  if (!store.requirePaid('prompter')) return; // free during the trial, then with a licence
  OPEN = run(logId, from || lastLine.get(logId) || null);
}
export function closePrompter() { if (OPEN) OPEN.close(); }

function run(logId, from) {
  const opener = document.activeElement;
  let log = byId('logs', logId);
  let A = [], els = [], lines = [], pos = 0, maxPos = 0, markY = 0, pxWord = 10, rowH = 40;
  let playing = false, raf = 0, last = 0, counting = 0, cur = -1, drag = null, hudTimer = 0, hintTimer = 0, lastTake = null, key = '';

  /* the stage: what the talent reads */
  const col = h('div', { class: 'pr-col' });
  const padTop = h('div', { class: 'pr-pad' }), padBottom = h('div', { class: 'pr-pad' });
  const track = h('div', { class: 'pr-track' }, padTop, col, padBottom);
  const marker = h('div', { class: 'pr-marker', 'aria-hidden': 'true' });
  const count = h('div', { class: 'pr-count', 'aria-hidden': 'true', hidden: true });
  const left = h('div', { class: 'pr-left', 'aria-hidden': 'true' });
  const rec = h('div', { class: 'pr-rec', 'aria-hidden': 'true', hidden: true }, '● REC');
  const stage = h('div', { class: 'pr-stage' }, track, marker, count, left, rec);

  /* the buttons: for whoever holds the device */
  const title = h('strong', { class: 'pr-name' });
  const state = h('span', { class: 'pr-state muted' });
  const tc = h('span', { class: 'tc-mono pr-tc' });
  const top = h('div', { class: 'pr-hud pr-top' },
    h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close the prompter', onclick: () => close() }, '✕'),
    h('div', { class: 'pr-title' }, title, state),
    tc,
    h('button', { class: 'icon-btn pr-help', type: 'button', 'aria-label': 'Tutorial for the prompter', title: 'Tutorial', onclick: () => { pause(); import('./tutorials.js').then(m => m.openTutorial('tcprompt')); } }, '?'),
    h('button', { class: 'icon-btn pr-settings', type: 'button', 'aria-label': 'Prompter settings', title: 'Settings', onclick: () => openSettings() }, '⚙'));
  const rollBtn = h('button', { class: 'btn pr-roll', type: 'button', onclick: () => rollCut() });
  const playBtn = h('button', { class: 'btn primary pr-play', type: 'button', onclick: () => toggle() });
  const wpm = h('span', { class: 'pr-wpm' });
  const bottom = h('div', { class: 'pr-hud pr-bottom' },
    rollBtn,
    h('button', { class: 'btn pr-prev', type: 'button', 'aria-label': 'Back a line', onclick: () => stepLine(-1) }, '▲'),
    playBtn,
    h('button', { class: 'btn pr-next', type: 'button', 'aria-label': 'On a line', onclick: () => stepLine(1) }, '▼'),
    h('button', { class: 'btn pr-flag', type: 'button', 'aria-label': 'Mark the line being read', title: 'Mark this line', onclick: () => flag() }, '⚑'),
    h('div', { class: 'pr-speed', role: 'group', 'aria-label': 'Speed' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Slower', onclick: () => setWpm(-5) }, '−'), wpm,
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Faster', onclick: () => setWpm(5) }, '+')),
    h('div', { class: 'pr-size', role: 'group', 'aria-label': 'Text size' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Smaller text', onclick: () => setSize(-1) }, 'A−'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Bigger text', onclick: () => setSize(1) }, 'A+')));
  const rateBox = h('div', { class: 'pr-ratebox', hidden: true, role: 'group', 'aria-label': 'Rate the take' });
  const hint = h('div', { class: 'pr-hint', role: 'status' });
  const root = h('div', { class: 'prompter', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Teleprompter', 'data-state': 'paused', tabindex: '-1' }, stage, top, bottom, rateBox, hint);

  /* the script on the stage */
  const parts = t => { const out = []; let i = 0; for (const m of t.matchAll(DIR)) { if (m.index > i) out.push(t.slice(i, m.index)); out.push(h('span', { class: 'pr-dir' }, m[0])); i = m.index + m[0].length; } if (i < t.length) out.push(t.slice(i)); return out; };
  const lineEl = a => h('div', { class: `pr-line r-${a.role}`, 'data-id': a.id, hidden: (a.role === 'cue' && !P.names) || (a.role === 'dir' && P.dirs === 'hide'), style: a.colour ? `--spk:${a.colour}` : null },
    a.inline && P.names && a.speaker && h('span', { class: 'pr-who' }, a.speaker), ...parts(a.text));
  const keyOf = l => `${l.script.rev || l.script.imported}|${l.script.paras.length}|${focusOf(l)}|${P.names}|${P.dirs}`;
  const render = () => {
    log = byId('logs', logId);
    A = analyse(log.script, focusOf(log)); els = A.map(lineEl); col.replaceChildren(...els);
    title.textContent = log.script.name || log.title; key = keyOf(log); cur = -1;
  };

  /* layout: the font size from the screen's width, where each line sits, how far a word is */
  const anchor = () => (A[cur] && lines[cur] ? { id: A[cur].id, frac: lines[cur].h ? (pos - lines[cur].top) / lines[cur].h : 0 } : null);
  const measure = (at = anchor()) => {
    const W = stage.clientWidth, H = stage.clientHeight; if (!W || !H) return;
    const colW = Math.round(W * ((COLS.find(c => c[0] === P.col) || COLS[1])[2]));
    const fs = Math.max(14, Math.round(colW / (SIZES[P.size] * 0.52)));
    const lh = Number(P.spacing) || 1.32;
    stage.style.setProperty('--pr-fs', fs + 'px'); col.style.width = colW + 'px'; col.style.lineHeight = String(lh);
    markY = Math.round(H * P.mark); rowH = fs * lh;
    padTop.style.height = markY + 'px'; padBottom.style.height = Math.max(0, H - markY) + 'px';
    marker.style.top = markY + 'px'; marker.style.height = Math.round(rowH) + 'px';
    let end = 0;
    lines = els.map((el, i) => { if (el.hidden) return { top: end, h: 0, words: 0 }; const t = el.offsetTop; end = t + el.offsetHeight; return { top: t, h: el.offsetHeight, words: A[i].words }; });
    const said = lines.filter(l => l.words), sh = said.reduce((t, l) => t + l.h, 0), sw = said.reduce((t, l) => t + l.words, 0);
    pxWord = sw ? sh / sw : rowH / 5;
    maxPos = Math.max(0, end - rowH * 0.6);
    const i = at ? A.findIndex(a => a.id === at.id) : -1;
    pos = i >= 0 ? clampPos(lines[i].top + (at.frac || 0) * lines[i].h) : clampPos(pos);
    apply(); drawLeft();
  };
  const clampPos = p => Math.max(0, Math.min(maxPos, p));
  const indexAt = p => { let lo = 0, hi = lines.length - 1, at = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].top <= p + 1) { at = m; lo = m + 1; } else hi = m - 1; } while (at > 0 && !lines[at].h) at--; return at; };
  const apply = () => {
    track.style.transform = `translate3d(0, ${-pos}px, 0)`;
    const i = lines.length ? indexAt(pos) : -1;
    if (i !== cur) { els[cur]?.classList.remove('now'); cur = i; els[i]?.classList.add('now'); if (A[i]) lastLine.set(logId, A[i].id); }
  };
  const pxPerSec = () => (pxWord * P.wpm) / 60;
  const drawLeft = () => { left.textContent = `${clock((maxPos - pos) / pxPerSec())} left · ${P.wpm} wpm`; };

  /* playing */
  const frame = t => {
    if (!playing) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
    if (!(drag && drag.moved)) pos = clampPos(pos + pxPerSec() * dt);
    apply();
    if (pos >= maxPos) { pause(); tell('The end of the script'); return; }
    raf = requestAnimationFrame(frame);
  };
  const play = () => {
    if (playing) return;
    if (pos >= maxPos) pos = 0;
    playing = true; last = 0; root.dataset.state = 'running'; raf = requestAnimationFrame(frame); drawHud(); hudSoon(); announce('Playing');
  };
  const pause = () => {
    if (counting) stopCount();
    if (!playing) return;
    playing = false; cancelAnimationFrame(raf); root.dataset.state = 'paused'; showHud(); drawHud(); drawLeft(); announce('Paused');
  };
  const firstSaid = () => Math.max(0, A.findIndex(a => a.role === 'say'));
  // From a stop at the top of the script, the countdown runs first; a pause in the middle carries straight on.
  const start = () => { if (cur <= firstSaid() && pos <= (lines[firstSaid()] || { top: 0 }).top + 1) countdown(play); else play(); };
  const toggle = () => (playing || counting ? pause() : start());
  const countdown = then => {
    let n = Number(P.count) || 0; if (!n) return then();
    root.dataset.state = 'count'; count.hidden = false; count.textContent = n;
    counting = setInterval(() => { n -= 1; if (n > 0) { count.textContent = n; return; } stopCount(); then(); }, 1000);
    drawHud();
  };
  const stopCount = () => { clearInterval(counting); counting = 0; count.hidden = true; if (root.dataset.state === 'count') root.dataset.state = 'paused'; drawHud(); };

  /* moving */
  const jump = i => { if (!lines[i]) return; pos = clampPos(lines[i].top); apply(); drawLeft(); };
  // A clicker's next and back go from one line that is read aloud to the next, past names and directions.
  const spoken = i => !!(A[i] && (A[i].role === 'say' || A[i].role === 'other') && lines[i] && lines[i].h);
  const stepLine = d => {
    if (d < 0 && spoken(cur) && pos > lines[cur].top + 2) return jump(cur); // part-way down a line: back to its start first
    let i = cur + d;
    while (i >= 0 && i < A.length && !spoken(i)) i += d;
    if (i < 0 || i >= A.length) { i = cur + d; while (lines[i] && !lines[i].h) i += d; } // none that way: the next line of any kind
    if (lines[i]) jump(i);
  };
  const setWpm = d => { P.wpm = clampWpm(P.wpm + d); save(); drawHud(); drawLeft(); };
  const setSize = d => { const was = P.size; P.size = clampSize(P.size + d); if (P.size !== was) { save(); measure(); } };

  /* takes: Roll starts one (a pickup when it starts below the first line read), Cut ends it and asks for a rating */
  const sayFrom = i => { for (let k = Math.max(0, i); k < A.length; k++) if (A[k].role === 'say' && lines[k] && lines[k].h) return k; return -1; };
  const rollCut = () => {
    if (openTake(logId)) {
      pause(); const n = endTake(logId); lastTake = n; drawHud();
      if (n) showRating(n);
      return;
    }
    hideRating();
    const k = sayFrom(cur), first = sayFrom(0);
    const pickup = k > first && k >= 0 ? { para: A[k].id, quote: quoteOf(byId('logs', logId).script.paras.find(p => p.id === A[k].id) || { text: A[k].text }) } : {};
    if (k >= 0 && k !== cur) jump(k);
    startTake(logId, pickup);
    drawHud(); countdown(play);
  };
  const showRating = n => {
    rateBox.replaceChildren(
      h('span', { class: 'pr-rate-title' }, `Take ${n.take}${n.dur ? ' · ' + n.dur : ''}`),
      h('button', { class: 'btn pr-good', type: 'button', onclick: () => rate('good') }, '★ Good'),
      h('button', { class: 'btn pr-ng', type: 'button', onclick: () => rate('ng') }, '✕ No good'),
      h('button', { class: 'btn pr-later', type: 'button', onclick: hideRating }, 'Later'));
    rateBox.hidden = false;
  };
  const hideRating = () => { rateBox.hidden = true; };
  const rate = v => { if (!lastTake) return; rateTake(logId, lastTake.id, v); haptic(15); announce(v === 'good' ? `Take ${lastTake.take}: good` : `Take ${lastTake.take}: no good`); hideRating(); };
  const flag = () => {
    const k = sayFrom(cur) >= 0 ? sayFrom(cur) : cur; if (!A[k]) return;
    const t = openTake(logId);
    markLine(logId, A[k].id, t ? `⚑ Take ${t.take}` : '⚑');
    tell(`Marked: “${quote(A[k].text)}”`);
  };

  /* the buttons' words, the clock and what is written on the stage */
  const drawHud = () => {
    const l = byId('logs', logId); if (!l) return;
    const t = openTake(logId);
    rollBtn.textContent = t ? '■ Cut' : '● Roll'; rollBtn.classList.toggle('cut', !!t); rollBtn.setAttribute('aria-label', t ? `Cut take ${t.take}` : 'Roll: start a take');
    playBtn.textContent = playing || counting ? '❚❚ Pause' : '▶ Play';
    state.textContent = t ? ` · take ${t.take} rolling` : l.take ? ` · ${l.take} take${l.take === 1 ? '' : 's'}` : '';
    rec.hidden = !t;
    wpm.textContent = `${P.wpm} wpm`;
  };
  const tick = () => { const l = byId('logs', logId); tc.textContent = l && l.sync ? nowTc(l) : 'no timecode'; if (playing) drawLeft(); };
  const tell = msg => { hint.textContent = msg; hint.classList.add('shown'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove('shown'), 2600); };
  const showHud = () => { root.classList.remove('hud-off'); clearTimeout(hudTimer); hudSoon(); };
  const hudSoon = () => { clearTimeout(hudTimer); if (playing) hudTimer = setTimeout(() => { if (playing) root.classList.add('hud-off'); }, 2500); };

  /* the stage under a finger: tap plays and pauses, a drag moves the text, holding a line offers it */
  stage.addEventListener('pointerdown', e => { if (e.button !== 0) return; drag = { y: e.clientY, pos, moved: false }; showHud(); });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) > 8) { drag.moved = true; try { stage.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    if (drag.moved) { pos = clampPos(drag.pos - (P.flip ? -dy : dy)); apply(); drawLeft(); }
  });
  stage.addEventListener('pointerup', () => { const d = drag; drag = null; if (!d || d.moved || wasHeld(stage)) return; toggle(); });
  stage.addEventListener('pointercancel', () => { drag = null; });
  stage.addEventListener('wheel', e => { e.preventDefault(); pos = clampPos(pos + (P.flip ? -e.deltaY : e.deltaY)); apply(); drawLeft(); showHud(); }, { passive: false });
  root.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') showHud(); });
  root.addEventListener('focusin', e => { if (e.target !== root) showHud(); }); // a button reached with Tab shows them all
  hold(stage, 550, e => { const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pr-line'); if (el && drag && !drag.moved) { drag = null; lineMenu(el.dataset.id); } });
  const lineMenu = id => {
    pause();
    const a = A.find(x => x.id === id); if (!a) return;
    const { close: done } = sheet('This line', h('div', { class: 'stack' },
      h('p', null, `“${quote(a.text)}”`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { done(); jump(A.indexOf(a)); tell('The next take starts here'); } }, '▶ Start from here'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { done(); const t = openTake(logId); markLine(logId, id, t ? `⚑ Take ${t.take}` : '⚑'); } }, '⚑ Mark it'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { done(); editLine(logId, id); } }, '✏ Edit line'))));
  };
  const openSettings = () => { pause(); sheet('Prompter settings', settingsPanel(logId, () => { refresh(); })); };
  const refresh = () => { stage.classList.toggle('mirror', !!P.mirror); stage.classList.toggle('flip', !!P.flip); const l = byId('logs', logId); if (l && l.script && keyOf(l) !== key) render(); measure(); drawHud(); };

  /* keys: a clicker sends Page Down and Page Up (and B or . for its blank-screen button), a pedal what it is set to */
  const FOCUSABLE = 'button:not([disabled]):not([hidden])';
  const onKey = e => {
    if (!root.isConnected || covered() || document.querySelector('.sheet-back, .tour')) return; // what is over the prompter has the keys
    const k = e.key, t = e.target;
    if (k === 'Tab') { const items = [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null); if (!items.length) return; const i = items.indexOf(document.activeElement); e.preventDefault(); showHud(); items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus(); return; }
    if ((k === ' ' || k === 'Enter') && t && t.closest && t.closest('button')) return; // a button with the focus is pressed, not the text
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let used = true;
    if (k === ' ' || k === 'Enter' || k === 'k' || k === 'K' || k === 'b' || k === 'B' || k === '.') toggle();
    else if (k === 'PageDown' || k === 'ArrowRight') stepLine(1);
    else if (k === 'PageUp' || k === 'ArrowLeft') stepLine(-1);
    else if (k === 'ArrowUp') setWpm(-5);
    else if (k === 'ArrowDown') setWpm(5);
    else if (k === '+' || k === '=') setSize(1);
    else if (k === '-' || k === '_') setSize(-1);
    else if (k === 'Home') jump(0);
    else if (k === 'End') { pos = maxPos; apply(); drawLeft(); }
    else if (k === 'r' || k === 'R') rollCut();
    else if (k === 'f' || k === 'F') flag();
    else if ((k === 'g' || k === 'G') && !rateBox.hidden) rate('good');
    else if ((k === 'n' || k === 'N') && !rateBox.hidden) rate('ng');
    else if (k === 'Escape') close();
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  };

  /* the screen stays on, and the page goes full screen where it can (the whole page, so sheets still show over it) */
  let wake = null, ownFull = false;
  const keepAwake = async () => { try { if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { wake = null; } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); else pause(); };

  /* changes to the log from here, from the script, or from a linked device */
  const unsub = subscribe(() => {
    const l = byId('logs', logId);
    if (!l || !l.script || !l.script.paras || !l.script.paras.length) { close(); return; }
    if (keyOf(l) !== key) { const at = anchor(); render(); measure(at); }
    drawHud();
  });
  const ro = new ResizeObserver(() => measure());
  const iv = setInterval(tick, 250);

  function close() {
    if (!root.isConnected) return;
    pause(); stopCount();
    // A take rolled here in free run ends with the prompter. In record run the camera may still be rolling, so a take
    // there stays open for the log's own Cut.
    const l = byId('logs', logId); if (l && l.open && !(l.mode === 'record' && l.sync)) endTake(logId);
    clearInterval(iv); clearTimeout(hudTimer); clearTimeout(hintTimer); ro.disconnect(); unsub();
    window.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVisible);
    try { wake?.release(); } catch { /* gone already */ }
    if (ownFull && document.fullscreenElement === document.documentElement) document.exitFullscreen?.().catch(() => {});
    root.remove(); OPEN = null; settleApp();
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  render();
  stage.classList.toggle('mirror', !!P.mirror); stage.classList.toggle('flip', !!P.flip);
  window.logiMenu?.close(); window.logiSearch?.close();
  document.body.append(root); settleApp();
  window.addEventListener('keydown', onKey, true); document.addEventListener('visibilitychange', onVisible);
  if (document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) { ownFull = true; document.documentElement.requestFullscreen().catch(() => { ownFull = false; }); }
  keepAwake();
  measure({ id: from || (A[0] && A[0].id), frac: 0 }); // the first line, or the line asked for, on the reading line
  ro.observe(stage);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (root.isConnected) measure(); });
  drawHud(); tick();
  root.focus({ preventScroll: true }); // the dialog itself: Space then plays, and no button wears a focus ring
  tell('Tap the text or ▶ to start · hold a line to start from it, mark it or edit it');
  return { close };
}

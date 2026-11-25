// The teleprompter's controls: a log's Prompter view, the prompter over the page, and a remote for a prompter shown
// elsewhere: on the device at the other end of the link (js/link.js), or in a window of its own on a second screen
// (prompter.html, over a BroadcastChannel). The stage itself, the script scrolling past the reading line, is
// js/prompter-stage.js. Takes are the log's (js/pages/tcnotes.js): whichever device presses Roll and Cut logs them,
// and the link keeps the log the same on both. Loaded on first use, from a log's Prompter view, from a line of its
// script (Prompt from here), from the logs page's 📜 Prompter, and by a linked device asking to show the prompter.
import { h, sheet, toast, announce, covered, settleApp } from './util.js';
import { byId, update, subscribe } from './store.js';
import * as store from './store.js';
import * as link from './link.js';
import { haptic } from './a11y.js';
import { P, SIZES, COLS, MARKS, SPACINGS, COUNTS, DIRS, analyse, speakersOf, wordsIn, clock, quote, makeStage, setSetting, clampSize, clampWpm, reload } from './prompter-stage.js';
import { nowTc, fmt, quoteOf, startTake, endTake, rateTake, openTake, markLine, editLine, openImport } from './pages/tcnotes.js';
import { voiceSupported, voiceAgreed, agreeVoice, VOICE_NOTE, listen, voiceTrouble } from './prompter-voice.js';
export { analyse } from './prompter-stage.js';

const focusOf = log => (log && log.prompt && log.prompt.focus) || '';
const paraOf = (logId, id) => { const l = byId('logs', logId); return (l && l.script && l.script.paras.find(p => p.id === id)) || null; };
const lastLine = new Map(); // log id → the line its prompter was on, to open there again
const KEYS_HELP = 'Clickers, foot pedals and keyboards: Space plays and pauses, Page Down and Page Up move a line, ↑ and ↓ change the speed, R rolls and cuts, F marks the line, V turns voice-follow on and off, Esc closes.';

// Voice-follow, turned on with 🎙 (js/prompter-voice.js): the first time on a device, a word about where the sound
// goes, and on only if the person says so. then() once agreed.
function askVoice(then) {
  const { close } = sheet('Voice-follow', h('div', { class: 'stack' },
    h('p', null, VOICE_NOTE),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => { agreeVoice(); close(); then(); } }, '🎙 Turn on voice-follow'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Not now'))));
}
// Listening while the stage runs with voice-follow on; aim(id, frac) moves it; fail(message) when it cannot listen.
function earFor(getLines, aim, fail) {
  let ear = null;
  return {
    check(s) {
      const want = !!(P.voice && voiceSupported() && s && s.playing);
      if (want && !ear) ear = listen({ lines: getLines(), from: s.line, onAim: aim, onStatus: st => { if (st.error) { ear = null; fail(voiceTrouble(st.error)); } } });
      else if (!want && ear) { ear.stop(); ear = null; }
    },
    listening: () => !!ear,
    stop() { if (ear) { ear.stop(); ear = null; } },
  };
}

/* ------------------------------ the log's view ------------------------------ */
// The Prompter view of a log: what will be read and how long it takes, where to show it, the settings for this
// screen, and the takes.
export function prompterPane(log) {
  reload(); // a second screen's window may have changed them
  const sc = log.script;
  if (!sc || !sc.paras || !sc.paras.length) {
    return h('div', { class: 'empty pr-pane' },
      h('p', null, 'The prompter reads a script full screen to the talent, at the speed they speak, and logs each take you roll. Add the script first.'),
      h('button', { class: 'btn primary', onclick: () => openImport(log, null, { view: 'prompter' }) }, '📄 Add script'));
  }
  const sum = h('div', { class: 'muted small pr-sum' });
  const drawSum = () => { const l = byId('logs', log.id) || log, w = wordsIn(l.script, focusOf(l)); sum.textContent = `${sc.paras.length} lines · ${w} words to read · about ${clock((w / P.wpm) * 60)} at ${P.wpm} words a minute`; };
  drawSum();
  const peer = link.link.status === 'connected' ? link.link.peer?.name || 'the linked device' : '';
  const computer = !matchMedia('(pointer: coarse)').matches; // a mouse: a computer, which can give the prompter a window of its own
  const takes = log.notes.filter(n => n.kind === 'roll').sort((a, b) => (b.take || 0) - (a.take || 0) || String(b.at).localeCompare(String(a.at)));
  return h('div', { class: 'pr-pane stack' },
    h('div', { class: 'card pr-launch' },
      h('div', null, h('strong', null, sc.name || 'Script'), sum),
      h('button', { class: 'btn primary pr-open', type: 'button', onclick: () => openPrompter(log.id) }, '📜 Open the prompter'),
      (peer || computer) && h('div', { class: 'pr-elsewhere' },
        peer && h('button', { class: 'btn ghost pr-on-peer', type: 'button', onclick: () => promptOnPeer(log.id) }, `🔗 Prompt on ${peer}`),
        computer && h('button', { class: 'btn ghost pr-on-window', type: 'button', onclick: () => promptInWindow(log.id) }, '🖥 Second screen'),
        h('p', { class: 'small muted' }, [peer && `Prompt on ${peer} shows the prompter there and makes this device its remote.`, computer && 'Second screen opens it in a window of its own, for the monitor in a rig, and makes this window its remote.'].filter(Boolean).join(' '))),
      !log.sync && h('p', { class: 'small muted' }, 'Not synced yet: takes are logged with the time of day. Sync this log to the camera and they carry its timecode.')),
    h('div', { class: 'card pr-setup' }, h('h3', null, 'This screen'), settingsPanel(log.id, drawSum)),
    takes.length > 0 && h('div', { class: 'card pr-takes' }, h('h3', null, `Takes (${takes.length})`),
      h('ol', { class: 'pr-take-list' }, takes.slice(0, 40).map(n => takeRow(log, n)))),
    h('p', { class: 'small muted pr-keys' }, KEYS_HELP));
}
const rateButtons = (logId, n) => h('span', { class: 'pr-rates' },
  h('button', { class: 'btn small ' + (n.rate === 'good' ? 'on good' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'good', onclick: () => rateTake(logId, n.id, n.rate === 'good' ? null : 'good') }, '★ Good'),
  h('button', { class: 'btn small ' + (n.rate === 'ng' ? 'on ng' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'ng', onclick: () => rateTake(logId, n.id, n.rate === 'ng' ? null : 'ng') }, '✕ No good'));
const takeRow = (log, n) => h('li', { class: 'pr-take' },
  h('span', { class: 'tc-mono pr-take-tc' }, n.frames == null ? 'unsynced' : fmt(n.frames, log)),
  h('span', { class: 'grow' }, h('b', null, `Take ${n.take || ''}`), n.dur ? ` · ${n.dur}` : ' · rolling', n.quote && h('span', { class: 'muted' }, ` · from “${n.quote}”`)),
  rateButtons(log.id, n));

// The settings: in the Prompter view and behind ⚙ (this screen's, kept on this device), or in a remote's ⚙ (the
// screen's at the other end: get gives what it last said they are, set sends a change).
function settingsPanel(logId, onChange = () => {}, { get = () => P, set = (k, v) => setSetting(k, v) } = {}) {
  const box = h('div', { class: 'stack pr-prefs' });
  const change = (k, v) => { set(k, v); haptic(); draw(); onChange(k); };
  const seg = (label, key, opts) => h('div', { class: 'pref', role: 'group', 'aria-label': label }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', { type: 'button', class: get()[key] === v ? 'on' : '', 'aria-pressed': get()[key] === v, onclick: () => change(key, v) }, l))));
  const stepper = (cls, label, value, less, more, lessLabel, moreLabel) => h('div', { class: 'pref ' + cls }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'pr-stepper' }, h('button', { type: 'button', class: 'btn ghost', 'aria-label': lessLabel, onclick: less }, '−'), h('span', { class: 'pr-val' }, value), h('button', { type: 'button', class: 'btn ghost', 'aria-label': moreLabel, onclick: more }, '+')));
  const draw = () => {
    const log = byId('logs', logId), speakers = log && log.script ? speakersOf(log.script) : [], focus = focusOf(log), p = get();
    box.replaceChildren(
      stepper('pr-set-size', 'Text size', `about ${SIZES[clampSize(p.size)]} letters a line`, () => change('size', clampSize(p.size - 1)), () => change('size', clampSize(p.size + 1)), 'Smaller text', 'Bigger text'),
      stepper('pr-set-speed', 'Speed', `${p.wpm} words a minute`, () => change('wpm', clampWpm(p.wpm - 5)), () => change('wpm', clampWpm(p.wpm + 5)), 'Slower', 'Faster'),
      seg('Mirror', 'mirror', [[false, 'Off'], [true, 'Mirrored for a rig']]),
      seg('Upside down', 'flip', [[false, 'Off'], [true, 'On']]),
      seg('Reading line', 'mark', MARKS),
      seg('Column', 'col', COLS.map(([v, l]) => [v, l])),
      seg('Line spacing', 'spacing', SPACINGS),
      seg('Countdown before a take', 'count', COUNTS),
      seg('Directions', 'dirs', DIRS),
      seg('Speaker names', 'names', [[true, 'Shown'], [false, 'Hidden']]),
      speakers.length > 1 && h('div', { class: 'pref', role: 'group', 'aria-label': 'Lines to read' }, h('div', { class: 'pref-label' }, 'Lines to read'),
        h('div', { class: 'seg wide' }, [['', 'Everyone'], ...speakers.map(s => [s, s])].map(([v, l]) => h('button', { type: 'button', class: focus === v ? 'on' : '', 'aria-pressed': focus === v, onclick: () => { setFocus(logId, v); draw(); onChange('focus'); } }, l)))),
      speakers.length > 1 && h('p', { class: 'small muted' }, 'Choosing one speaker dims the others’ lines, so they are still there as cues.'));
  };
  draw();
  return box;
}
function setFocus(logId, v) {
  update(d => { const l = d.logs.find(x => x.id === logId); if (!l) return; l.prompt = { ...(l.prompt || {}), focus: v }; l.updatedAt = Date.now(); });
}

// A take from whichever line the stage is on: Roll starts one (a pickup when it starts below the first line read) and
// tells the stage to count down and run from that line; Cut stops the stage and ends the take. lines: the stage's
// lines (analyse), at: the index of its current line. Returns the take Cut ended, for its rating.
function rollOrCut(logId, lines, at, drive) {
  if (openTake(logId)) { drive('pause'); return { cut: endTake(logId) }; }
  let k = -1; for (let j = Math.max(0, at); j < lines.length; j++) if (lines[j].role === 'say') { k = j; break; }
  const first = lines.findIndex(a => a.role === 'say');
  const pickup = k > first && k >= 0 ? { para: lines[k].id, quote: quoteOf(paraOf(logId, lines[k].id) || { text: lines[k].text }) } : {};
  startTake(logId, pickup);
  drive('go', { from: k >= 0 ? lines[k].id : null });
  return { rolled: true };
}
// ⚑: the line being read, marked with the timecode (and the take, if one is rolling).
function flagLine(logId, lines, at) {
  let k = at; for (let j = Math.max(0, at); j < lines.length; j++) if (lines[j].role === 'say') { k = j; break; }
  if (!lines[k]) return '';
  const t = openTake(logId);
  markLine(logId, lines[k].id, t ? `⚑ Take ${t.take}` : '⚑');
  return lines[k].text;
}
// The rating after Cut, in box: ★ Good, ✕ No good, or Later.
function ratingBox(box, logId, n) {
  const rate = v => { rateTake(logId, n.id, v); haptic(15); announce(v === 'good' ? `Take ${n.take}: good` : `Take ${n.take}: no good`); box.hidden = true; };
  box.replaceChildren(
    h('span', { class: 'pr-rate-title' }, `Take ${n.take}${n.dur ? ' · ' + n.dur : ''}`),
    h('button', { class: 'btn pr-good', type: 'button', onclick: () => rate('good') }, '★ Good'),
    h('button', { class: 'btn pr-ng', type: 'button', onclick: () => rate('ng') }, '✕ No good'),
    h('button', { class: 'btn pr-later', type: 'button', onclick: () => { box.hidden = true; } }, 'Later'));
  box.hidden = false;
  return rate;
}
// The keys both the prompter and a remote answer. act(name, arg) does it; returns whether the key was one of them.
function promptKey(e, act) {
  const k = e.key;
  if (k === ' ' || k === 'Enter' || k === 'k' || k === 'K' || k === 'b' || k === 'B' || k === '.') act('toggle');
  else if (k === 'PageDown' || k === 'ArrowRight') act('step', 1);
  else if (k === 'PageUp' || k === 'ArrowLeft') act('step', -1);
  else if (k === 'ArrowUp') act('wpm', -5);
  else if (k === 'ArrowDown') act('wpm', 5);
  else if (k === '+' || k === '=') act('size', 1);
  else if (k === '-' || k === '_') act('size', -1);
  else if (k === 'Home') act('home');
  else if (k === 'End') act('end');
  else if (k === 'r' || k === 'R') act('roll');
  else if (k === 'f' || k === 'F') act('flag');
  else if (k === 'v' || k === 'V') act('voice');
  else if (k === 'g' || k === 'G') act('good');
  else if (k === 'n' || k === 'N') act('ng');
  else if (k === 'Escape') act('close');
  else return false;
  return true;
}
// Keeps Tab inside an overlay (a dialog of its own, like a sheet).
function trapTab(e, root) {
  const items = [...root.querySelectorAll('button:not([disabled]):not([hidden])')].filter(el => el.offsetParent !== null); if (!items.length) return;
  const i = items.indexOf(document.activeElement); e.preventDefault();
  items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
}
// A button tapped or clicked hands the focus back to the overlay, so that a clicker's Space or Enter plays and pauses
// rather than pressing that button again (one reached with Tab keeps it). After a sheet it opened, too.
function giveBackFocus(root) {
  const back = () => { if (root.isConnected && !document.querySelector('.sheet-back, .tour')) root.focus({ preventScroll: true }); };
  root.addEventListener('click', e => { if (e.detail > 0 && e.target.closest && e.target.closest('button')) setTimeout(back, 0); });
  return back;
}
// A key for an overlay, unless something is over it (a sheet, a walkthrough, the lock) or it is a button's own press.
const keyFor = (e, root) => root.isConnected && !covered() && !document.querySelector('.sheet-back, .tour') && !(e.ctrlKey || e.metaKey || e.altKey) && !((e.key === ' ' || e.key === 'Enter') && e.target && e.target.closest && e.target.closest('button'));

/* ------------------------------- the prompter ------------------------------- */
let OPEN = null; // the prompter on screen: { logId, cmd, close }
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
  let hudTimer = 0, hintTimer = 0, was = null, rate = null;
  const stage = makeStage({ onState: s => onState(s), onHold: id => lineMenu(id) });

  /* the buttons: for whoever holds the device */
  const title = h('strong', { class: 'pr-name' });
  const state = h('span', { class: 'pr-state muted' });
  const tc = h('span', { class: 'tc-mono pr-tc' });
  const top = h('div', { class: 'pr-hud pr-top' },
    h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close the prompter', onclick: () => close() }, '✕'),
    h('div', { class: 'pr-title' }, title, state),
    tc,
    h('button', { class: 'icon-btn pr-help', type: 'button', 'aria-label': 'Tutorial for the prompter', title: 'Tutorial', onclick: () => { stage.cmd('pause'); import('./tutorials.js').then(m => m.openTutorial('tcprompt')); } }, '?'),
    h('button', { class: 'icon-btn pr-settings', type: 'button', 'aria-label': 'Prompter settings', title: 'Settings', onclick: () => { stage.cmd('pause'); sheet('Prompter settings', settingsPanel(logId, () => { stage.refresh(); drawHud(); })); } }, '⚙'));
  const rollBtn = h('button', { class: 'btn pr-roll', type: 'button', onclick: () => act('roll') });
  const playBtn = h('button', { class: 'btn primary pr-play', type: 'button', onclick: () => act('toggle') });
  const wpm = h('span', { class: 'pr-wpm' });
  const voiceBtn = voiceSupported() && h('button', { class: 'btn pr-voice', type: 'button', 'aria-label': 'Voice-follow', title: 'Voice-follow: the script follows the talent’s voice', onclick: () => act('voice') }, '🎙');
  const bottom = h('div', { class: 'pr-hud pr-bottom' },
    rollBtn,
    h('button', { class: 'btn pr-prev', type: 'button', 'aria-label': 'Back a line', onclick: () => act('step', -1) }, '▲'),
    playBtn,
    h('button', { class: 'btn pr-next', type: 'button', 'aria-label': 'On a line', onclick: () => act('step', 1) }, '▼'),
    h('button', { class: 'btn pr-flag', type: 'button', 'aria-label': 'Mark the line being read', title: 'Mark this line', onclick: () => act('flag') }, '⚑'),
    voiceBtn,
    h('div', { class: 'pr-speed', role: 'group', 'aria-label': 'Speed' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Slower', onclick: () => act('wpm', -5) }, '−'), wpm,
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Faster', onclick: () => act('wpm', 5) }, '+')),
    h('div', { class: 'pr-size', role: 'group', 'aria-label': 'Text size' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Smaller text', onclick: () => act('size', -1) }, 'A−'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Bigger text', onclick: () => act('size', 1) }, 'A+')));
  const rateBox = h('div', { class: 'pr-ratebox', hidden: true, role: 'group', 'aria-label': 'Rate the take' });
  const hint = h('div', { class: 'pr-hint', role: 'status' });
  // 🎙 voice-follow: the script follows the talent's voice while it runs (shown where the browser can do it).
  const ear = earFor(() => stage.lines(), (id, frac) => stage.cmd('aim', { id, frac }), msg => { setSetting('voice', false); stage.cmd('follow', false); drawHud(); tell(msg); });
  function setVoice(on) {
    if (on && !voiceAgreed()) { stage.cmd('pause'); askVoice(() => setVoice(true)); return; }
    setSetting('voice', on); stage.cmd('follow', on); ear.check(stage.state()); drawHud(); setTimeout(() => refocus(), 0);
    tell(on ? '🎙 Voice-follow: the script follows the talent as they read' : 'Voice-follow off: the script runs at its speed');
  }
  const root = h('div', { class: 'prompter', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Teleprompter', 'data-state': 'paused', tabindex: '-1' }, stage.el, top, bottom, rateBox, hint);

  // What a button, a key or a remote asks: the stage's own commands go to it; takes and marks are done here.
  function act(name, arg) {
    if (name === 'roll') { const r = rollOrCut(logId, stage.lines(), stage.current(), (c, a) => stage.cmd(c, a)); if (r.cut) rate = ratingBox(rateBox, logId, r.cut); else rateBox.hidden = true; drawHud(); return; }
    if (name === 'flag') { const t = flagLine(logId, stage.lines(), stage.current()); if (t) tell(`Marked: “${quote(t)}”`); return; }
    if (name === 'good' || name === 'ng') { if (rate && !rateBox.hidden) rate(name); return; }
    if (name === 'voice') { if (voiceSupported()) setVoice(!P.voice); return; }
    if (name === 'close') return close();
    stage.cmd(name, arg);
  }
  function onState(s) {
    ear.check(s);
    root.dataset.state = s.counting ? 'count' : s.playing ? 'running' : 'paused';
    if (s.playing && !(was && was.playing)) hudSoon();
    if (!s.playing && (!was || was.playing)) showHud();
    if (was && was.playing && !s.playing && s.end) tell('The end of the script');
    if (s.line) lastLine.set(logId, s.line);
    was = s; drawHud(s);
    if (link.link.status === 'connected') link.send({ t: 'pr-state', log: logId, s: { ...s, prefs: { ...P } } }); // a remote at the other end follows it
  }
  function drawHud(s = stage.state()) {
    const l = byId('logs', logId); if (!l) return;
    const t = openTake(logId);
    rollBtn.textContent = t ? '■ Cut' : '● Roll'; rollBtn.classList.toggle('cut', !!t); rollBtn.setAttribute('aria-label', t ? `Cut take ${t.take}` : 'Roll: start a take');
    playBtn.textContent = s.playing || s.counting ? '❚❚ Pause' : '▶ Play';
    state.textContent = t ? ` · take ${t.take} rolling` : l.take ? ` · ${l.take} take${l.take === 1 ? '' : 's'}` : '';
    stage.setRec(!!t);
    wpm.textContent = s.follow ? '🎙 voice' : `${s.wpm} wpm`;
    if (voiceBtn) { voiceBtn.setAttribute('aria-pressed', String(!!P.voice)); voiceBtn.classList.toggle('on', !!P.voice); }
    if (ear.listening()) state.textContent += ' · listening';
    title.textContent = l.script ? l.script.name || l.title : l.title;
  }
  const tick = () => { const l = byId('logs', logId); tc.textContent = l && l.sync ? nowTc(l) : 'no timecode'; };
  const tell = msg => { hint.textContent = msg; hint.classList.add('shown'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove('shown'), 2600); };
  const showHud = () => { root.classList.remove('hud-off'); clearTimeout(hudTimer); hudSoon(); };
  const hudSoon = () => { clearTimeout(hudTimer); if (stage.state().playing) hudTimer = setTimeout(() => { if (stage.state().playing) root.classList.add('hud-off'); }, 2500); };
  root.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') showHud(); });
  root.addEventListener('pointerdown', () => showHud());
  root.addEventListener('focusin', e => { if (e.target !== root) showHud(); }); // a button reached with Tab shows them all
  const refocus = giveBackFocus(root);
  function lineMenu(id) {
    stage.cmd('pause');
    const a = stage.lines().find(x => x.id === id); if (!a) return;
    const { close: done } = sheet('This line', h('div', { class: 'stack' },
      h('p', null, `“${quote(a.text)}”`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => { done(); stage.cmd('goto', id); tell('The next take starts here'); } }, '▶ Start from here'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { done(); const t = openTake(logId); markLine(logId, id, t ? `⚑ Take ${t.take}` : '⚑'); } }, '⚑ Mark it'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { done(); editLine(logId, id); } }, '✏ Edit line'))));
  }

  /* keys: a clicker sends Page Down and Page Up (and B or . for its blank-screen button), a pedal what it is set to */
  const onKey = e => {
    if (!keyFor(e, root)) return;
    if (e.key === 'Tab') { showHud(); trapTab(e, root); return; }
    if (promptKey(e, act)) { e.preventDefault(); e.stopPropagation(); }
  };

  /* the screen stays on, and the page goes full screen where it can (the whole page, so sheets still show over it) */
  let wake = null, ownFull = false;
  const keepAwake = async () => { try { if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { wake = null; } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); else stage.cmd('pause'); };

  /* changes to the log from here, from the script, or from a linked device */
  const unsub = subscribe(() => {
    const l = byId('logs', logId);
    if (!l || !l.script || !l.script.paras || !l.script.paras.length) { close(); return; }
    stage.update({ script: l.script, focus: focusOf(l) });
    drawHud();
  });
  const iv = setInterval(tick, 250);

  function close() {
    if (!root.isConnected) return;
    stage.cmd('pause');
    // A take rolled here in free run ends with the prompter. In record run the camera may still be rolling, so a take
    // there stays open for the log's own Cut.
    const l = byId('logs', logId); if (l && l.open && !(l.mode === 'record' && l.sync)) endTake(logId);
    clearInterval(iv); clearTimeout(hudTimer); clearTimeout(hintTimer); ear.stop(); stage.destroy(); unsub();
    window.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVisible);
    try { wake?.release(); } catch { /* gone already */ }
    if (ownFull && document.fullscreenElement === document.documentElement) document.exitFullscreen?.().catch(() => {});
    root.remove(); OPEN = null; settleApp();
    if (link.link.status === 'connected') link.send({ t: 'pr-closed', log: logId });
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  window.logiMenu?.close(); window.logiSearch?.close();
  document.body.append(root); settleApp();
  window.addEventListener('keydown', onKey, true); document.addEventListener('visibilitychange', onVisible);
  if (document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) { ownFull = true; document.documentElement.requestFullscreen().catch(() => { ownFull = false; }); }
  keepAwake();
  const log = byId('logs', logId);
  stage.load({ script: log.script, focus: focusOf(log), from });
  stage.attach();
  if (P.voice && voiceSupported() && voiceAgreed()) stage.cmd('follow', true); // left on last time on this device
  drawHud(); tick();
  root.focus({ preventScroll: true }); // the dialog itself: Space then plays, and no button wears a focus ring
  tell('Tap the text or ▶ to start · hold a line to start from it, mark it or edit it');
  return { logId, cmd: (c, a) => stage.cmd(c, a), close };
}

/* ------------------------------- the remote ------------------------------- */
// A remote for a prompter shown elsewhere. port: { kind ('link' or 'window'), name (where it is), send(cmd, arg),
// closeScreen(), done() }. It hears the stage's state through state(s), and keys pressed in the second screen's
// window through key(k). Takes and marks are done here, on this device's copy of the log.
let REMOTE = null;
function openRemote(logId, port) {
  if (REMOTE) REMOTE.close(true);
  let s = null, rate = null, hudLines = [], items = [];
  const log = () => byId('logs', logId);
  const lines = () => { const l = log(); return l && l.script ? analyse(l.script, focusOf(l), (s && s.prefs && s.prefs.dirs) || P.dirs) : []; };
  const at = () => { const a = hudLines; return s && s.line ? Math.max(0, a.findIndex(x => x.id === s.line)) : 0; };
  const status = h('div', { class: 'pr-rstatus', role: 'status' }, `Waiting for the prompter on ${port.name}…`);
  const tc = h('span', { class: 'tc-mono pr-tc' });
  const rollBtn = h('button', { class: 'btn pr-roll', type: 'button', onclick: () => act('roll') }, '● Roll');
  const playBtn = h('button', { class: 'btn primary pr-play', type: 'button', onclick: () => act('toggle') }, '▶ Play');
  const wpm = h('span', { class: 'pr-wpm' }, `${P.wpm} wpm`);
  const list = h('ol', { class: 'pr-rlist', 'aria-label': 'The script: tap a line to go to it' });
  // 🎙 on the remote: this device's microphone listens, and the stage at the other end follows.
  const voiceBtn = voiceSupported() && h('button', { class: 'btn pr-voice', type: 'button', 'aria-label': 'Voice-follow, listening on this device', onclick: () => act('voice') }, '🎙');
  const ear = earFor(() => hudLines, (id, frac) => port.send('aim', { id, frac }), msg => { setSetting('voice', false); port.send('follow', false); status.textContent = msg; draw(); });
  function setVoice(on) {
    if (on && !voiceAgreed()) { askVoice(() => setVoice(true)); return; }
    setSetting('voice', on); port.send('follow', on); ear.check(s); draw(); setTimeout(() => refocus(), 0);
  }
  const rateBox = h('div', { class: 'pr-ratebox', hidden: true, role: 'group', 'aria-label': 'Rate the take' });
  const root = h('div', { class: 'prompter pr-remote', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Prompter remote', tabindex: '-1' },
    h('div', { class: 'pr-hud pr-top' },
      h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close the remote', onclick: () => close() }, '✕'),
      h('div', { class: 'pr-title' }, h('strong', null, 'Remote'), h('span', { class: 'muted' }, ` · ${port.name}`)),
      tc,
      h('button', { class: 'icon-btn pr-help', type: 'button', 'aria-label': 'Tutorial for the remote', title: 'Tutorial', onclick: () => import('./tutorials.js').then(m => m.openTutorial('tcremote')) }, '?'),
      h('button', { class: 'icon-btn pr-settings', type: 'button', 'aria-label': `Settings of the prompter on ${port.name}`, title: 'Its settings', onclick: () => sheet(`Settings on ${port.name}`, settingsPanel(logId, () => {}, { get: () => ({ ...P, ...(s && s.prefs) }), set: (k, v) => { port.send('set', { key: k, value: v }); if (s) s.prefs = { ...(s.prefs || {}), [k]: v }; } })) }, '⚙')),
    status,
    h('div', { class: 'pr-rpad' },
      rollBtn, playBtn,
      h('button', { class: 'btn pr-prev', type: 'button', 'aria-label': 'Back a line', onclick: () => act('step', -1) }, '▲'),
      h('button', { class: 'btn pr-next', type: 'button', 'aria-label': 'On a line', onclick: () => act('step', 1) }, '▼'),
      h('button', { class: 'btn pr-flag', type: 'button', 'aria-label': 'Mark the line being read', onclick: () => act('flag') }, '⚑'),
      voiceBtn,
      h('div', { class: 'pr-speed', role: 'group', 'aria-label': 'Speed' }, h('button', { class: 'btn', type: 'button', 'aria-label': 'Slower', onclick: () => act('wpm', -5) }, '−'), wpm, h('button', { class: 'btn', type: 'button', 'aria-label': 'Faster', onclick: () => act('wpm', 5) }, '+')),
      h('div', { class: 'pr-size', role: 'group', 'aria-label': 'Text size' }, h('button', { class: 'btn', type: 'button', 'aria-label': 'Smaller text', onclick: () => act('size', -1) }, 'A−'), h('button', { class: 'btn', type: 'button', 'aria-label': 'Bigger text', onclick: () => act('size', 1) }, 'A+'))),
    list, rateBox);
  const drawList = () => {
    hudLines = lines();
    items = hudLines.map(a => h('li', { class: `pr-ritem r-${a.role}`, 'data-id': a.id }, h('button', { type: 'button', onclick: () => port.send('goto', a.id) }, a.role === 'cue' ? a.speaker || a.text : a.text)));
    list.replaceChildren(...items);
    mark();
  };
  const mark = () => { items.forEach(li => li.classList.toggle('now', !!s && li.dataset.id === s.line)); const now = list.querySelector('.now'); if (now && s && s.playing) now.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  let key = '';
  const keyOf = () => { const l = log(); return l && l.script ? `${l.script.rev || l.script.imported}|${l.script.paras.length}|${focusOf(l)}|${s && s.prefs ? s.prefs.dirs : ''}` : ''; };
  function draw() {
    const l = log(); if (!l) return close();
    const t = openTake(logId);
    rollBtn.textContent = t ? '■ Cut' : '● Roll'; rollBtn.classList.toggle('cut', !!t);
    playBtn.textContent = s && (s.playing || s.counting) ? '❚❚ Pause' : '▶ Play';
    if (s) { wpm.textContent = s.follow ? '🎙 voice' : `${s.wpm} wpm`; status.textContent = [t ? `● REC take ${t.take}` : '', s.counting ? 'counting down' : s.playing ? 'running' : 'paused', ear.listening() ? '🎙 listening here' : '', `${clock(s.left)} left`].filter(Boolean).join(' · '); }
    if (voiceBtn) { voiceBtn.setAttribute('aria-pressed', String(!!P.voice)); voiceBtn.classList.toggle('on', !!P.voice); }
    if (keyOf() !== key) { key = keyOf(); drawList(); } else mark();
  }
  function act(name, arg) {
    if (name === 'roll') { const r = rollOrCut(logId, hudLines, at(), (c, a) => port.send(c, a)); if (r.cut) rate = ratingBox(rateBox, logId, r.cut); else rateBox.hidden = true; draw(); return; }
    if (name === 'flag') { flagLine(logId, hudLines, at()); return; }
    if (name === 'good' || name === 'ng') { if (rate && !rateBox.hidden) rate(name); return; }
    if (name === 'voice') { if (voiceSupported()) setVoice(!P.voice); return; }
    if (name === 'close') return close();
    port.send(name, arg);
  }
  const onKey = e => {
    if (!keyFor(e, root)) return;
    if (e.key === 'Tab') { trapTab(e, root); return; }
    if (promptKey(e, act)) { e.preventDefault(); e.stopPropagation(); }
  };
  const refocus = giveBackFocus(root);
  const unsub = subscribe(() => draw());
  const iv = setInterval(() => { const l = log(); tc.textContent = l && l.sync ? nowTc(l) : 'no timecode'; }, 250);
  // keep: closing because another remote takes over leaves the screen to it.
  function close(keep) {
    if (!root.isConnected) return;
    clearInterval(iv); unsub(); ear.stop(); window.removeEventListener('keydown', onKey, true);
    if (!keep) port.closeScreen();
    port.done && port.done();
    root.remove(); REMOTE = null; settleApp();
  }
  window.logiMenu?.close(); window.logiSearch?.close();
  document.body.append(root); settleApp();
  window.addEventListener('keydown', onKey, true);
  draw(); root.focus({ preventScroll: true });
  REMOTE = { logId, port, close, state: st => { s = st; if (s.line) lastLine.set(logId, s.line); if (P.voice && voiceSupported() && voiceAgreed() && !s.follow) port.send('follow', true); ear.check(s); draw(); }, key: k => promptKey({ key: k }, act), lost: msg => { ear.stop(); status.textContent = msg; s = null; draw(); } };
  return REMOTE;
}

// 🔗 Prompt on the linked device: it opens the prompter on this log (asked over the link), and this device is its
// remote. The other device needs the log's script first; the link sends it with the log.
function promptOnPeer(logId) {
  if (link.link.status !== 'connected') { toast('Link the devices first: 🔗 Link device.'); return; }
  if (!store.requirePaid('prompter')) return;
  link.send({ t: 'pr-open', log: logId, from: lastLine.get(logId) || null });
  openRemote(logId, { kind: 'link', name: link.link.peer?.name || 'the linked device', send: (cmd, arg) => link.send({ t: 'pr-cmd', log: logId, cmd, arg }), closeScreen: () => link.send({ t: 'pr-close', log: logId }) });
}
// Messages over the link, passed on by js/pages/tcnotes.js. On the device asked to show the prompter: open it, drive
// it, close it. On the remote: the stage's state, and the prompter closing at the other end.
export function fromLink(m) {
  if (m.t === 'pr-open') {
    if (OPEN && OPEN.logId !== m.log) OPEN.close();
    if (OPEN) return;
    // The log and its script may still be on their way over the link: wait a few seconds for them.
    const tryOpen = n => { const l = byId('logs', m.log); if (l && l.script && l.script.paras && l.script.paras.length) openPrompter(m.log, { from: m.from || null }); else if (n < 25) setTimeout(() => tryOpen(n + 1), 200); else link.send({ t: 'pr-closed', log: m.log, why: 'no script' }); };
    tryOpen(0);
  } else if (m.t === 'pr-cmd') { if (OPEN && OPEN.logId === m.log) OPEN.cmd(m.cmd, m.arg); }
  else if (m.t === 'pr-close') { if (OPEN && OPEN.logId === m.log) OPEN.close(); }
  else if (m.t === 'pr-state') { if (REMOTE && REMOTE.logId === m.log && REMOTE.port.kind === 'link') REMOTE.state(m.s); }
  else if (m.t === 'pr-closed') { if (REMOTE && REMOTE.logId === m.log && REMOTE.port.kind === 'link') REMOTE.lost(m.why === 'no script' ? `${REMOTE.port.name} has no copy of this script yet. Open this log there, then try again.` : `The prompter on ${REMOTE.port.name} was closed.`); }
}
// A linked device that goes away leaves its remote saying so.
link.onChange(l => { if (l.status !== 'connected' && REMOTE && REMOTE.port.kind === 'link') REMOTE.lost('The link to the other device was lost. Link them again to carry on.'); });

// 🖥 Second screen: the prompter in a window of its own (prompter.html), moved to another screen where the browser
// can (and the desktop app always), with this window as its remote. They talk over a BroadcastChannel: this window
// sends the script and the commands, that one answers with its state and the takes' keys pressed in it.
function promptInWindow(logId) {
  if (!store.requirePaid('prompter')) return;
  const w = window.open('prompter.html', 'vdex-prompter', 'popup=yes,width=1024,height=640');
  if (!w) { toast('The window was blocked. Allow pop-ups for Vdex, then try again.'); return; }
  placeOnOtherScreen(w);
  const bc = new BroadcastChannel('vdex-prompter');
  const data = () => { const l = byId('logs', logId); return l && l.script ? { script: l.script, focus: focusOf(l) } : null; };
  let up = false;
  bc.onmessage = e => {
    const m = e.data || {};
    if (m.t === 'ready') { up = true; const d = data(); if (d) bc.postMessage({ t: 'load', ...d, from: lastLine.get(logId) || null }); }
    else if (m.t === 'state') { if (REMOTE && REMOTE.port.bc === bc) REMOTE.state(m.s); }
    else if (m.t === 'key') { if (REMOTE && REMOTE.port.bc === bc) REMOTE.key(m.key); }
    else if (m.t === 'closed') { if (REMOTE && REMOTE.port.bc === bc) REMOTE.lost('The prompter window was closed.'); up = false; }
  };
  const unsub = subscribe(() => { if (up) { const d = data(); if (d) bc.postMessage({ t: 'update', ...d }); } });
  openRemote(logId, { kind: 'window', bc, name: 'the second screen', send: (cmd, arg) => bc.postMessage({ t: 'cmd', cmd, arg }), closeScreen: () => { bc.postMessage({ t: 'close' }); try { w.close(); } catch { /* gone */ } }, done: () => { unsub(); setTimeout(() => bc.close(), 300); } });
}
// The window onto a screen other than this one, where the browser can tell them apart (Window Management, Chrome and
// Edge, after asking once); otherwise it opens here, to be dragged across. The desktop app places it itself.
async function placeOnOtherScreen(w) {
  try {
    if (!('getScreenDetails' in window)) return;
    const d = await window.getScreenDetails();
    const other = d.screens.find(x => x !== d.currentScreen); if (!other) return;
    w.moveTo(other.availLeft, other.availTop); w.resizeTo(other.availWidth, other.availHeight);
  } catch { /* opened where it is: the person drags it */ }
}

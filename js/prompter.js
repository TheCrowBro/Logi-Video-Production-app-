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
import { P, SIZES, COLS, MARKS, SPACINGS, COUNT_LENGTHS, DIRS, LOOKS, LINE_COLOURS, STRENGTHS, LINE_DEF, analyse, speakersOf, wordsIn, clock, quote, makeStage, setSetting, clampSize, clampWpm, reload } from './prompter-stage.js';
import { nowTc, fmt, quoteOf, startTake, endTake, rateTake, openTake, markLine, editLine, openImport } from './pages/tcnotes.js';
import { voiceSupported, voiceAgreed, agreeVoice, VOICE_NOTE, listen, voiceTrouble } from './prompter-voice.js';
export { analyse } from './prompter-stage.js';

const focusOf = log => (log && log.prompt && log.prompt.focus) || '';
const paraOf = (logId, id) => { const l = byId('logs', logId); return (l && l.script && l.script.paras.find(p => p.id === id)) || null; };
const lastLine = new Map(); // log id → the line its prompter was on, to open there again
const KEYS_HELP = 'Clickers, foot pedals and keyboards: Space plays and pauses, Page Down and Page Up move a line, ← → and ↑ ↓ change the speed, R rolls and cuts, F marks the line, V turns voice-follow on and off, Esc closes.';

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
    h('div', { class: 'card pr-setup' }, h('h3', null, 'This screen'), settingsPanel(log.id, drawSum, { goto: id => openPrompter(log.id, { from: id }), replace: () => openImport(byId('logs', log.id) || log, null, { view: 'prompter' }) })),
    takes.length > 0 && h('div', { class: 'card pr-takes' }, h('h3', null, `Takes (${takes.length})`),
      h('ol', { class: 'pr-take-list' }, takes.slice(0, 40).map(n => takeRow(log, n)))));
}
const rateButtons = (logId, n) => h('span', { class: 'pr-rates' },
  h('button', { class: 'btn small ' + (n.rate === 'good' ? 'on good' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'good', onclick: () => rateTake(logId, n.id, n.rate === 'good' ? null : 'good') }, '★ Good'),
  h('button', { class: 'btn small ' + (n.rate === 'ng' ? 'on ng' : 'ghost'), type: 'button', 'aria-pressed': n.rate === 'ng', onclick: () => rateTake(logId, n.id, n.rate === 'ng' ? null : 'ng') }, '✕ No good'));
const takeRow = (log, n) => h('li', { class: 'pr-take' },
  h('span', { class: 'tc-mono pr-take-tc' }, n.frames == null ? 'unsynced' : fmt(n.frames, log)),
  h('span', { class: 'grow' }, h('b', null, `Take ${n.take || ''}`), n.dur ? ` · ${n.dur}` : ' · rolling', n.quote && h('span', { class: 'muted' }, ` · from “${n.quote}”`)),
  rateButtons(log.id, n));

// The settings, under three icons, each with its twirl-downs: Script (how it shows, replacing it, its scenes, finding a
// line), Format (the text, the reading line, the rig) and Other (the countdown, the speed, scrolling, the keys). In the
// Prompter view and behind ⚙ (this screen's, kept on this device), or in a remote's ⚙ (the screen's at the other end:
// get gives what it last said they are, set sends a change). goto(id) takes the prompter to a line (Jump to a scene,
// Find a line); replace() opens the Add script sheet; hint is a line under the icons. The icon chosen and the
// twirl-downs left open are kept on the device: the first time, Format.
const UI_KEY = 'logi-prompter-ui';
const readUi = () => { const def = { tab: 'format', open: { show: true, text: true, count: true } }; try { const u = JSON.parse(localStorage.getItem(UI_KEY)) || {}; return { ...def, ...u, open: { ...def.open, ...(u.open || {}) } }; } catch { return def; } };
const saveUi = u => { try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch { /* kept for this visit */ } };
const SVG = 'http://www.w3.org/2000/svg';
const icon = paths => { const g = document.createElementNS(SVG, 'svg'); g.setAttribute('viewBox', '0 0 24 24'); g.setAttribute('aria-hidden', 'true'); g.setAttribute('class', 'pr-tab-ico'); for (const d of paths) { const x = document.createElementNS(SVG, 'path'); x.setAttribute('d', d); g.append(x); } return g; };
const TABS = [
  ['script', 'Script', ['M6.5 3h7.5l4 4v14h-11.5z', 'M14 3v4h4', 'M9.5 11.5h5.5', 'M9.5 15h5.5', 'M9.5 18.5h3.5']],
  ['format', 'Format', ['M2.5 19 7.7 5h1.6l5.2 14', 'M4.7 14h7.6', 'M18 12.4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z', 'M20.5 11.8v7.2']],
  ['other', 'Other', ['M4 7h8', 'M16 7h4', 'M14 5v4', 'M4 12h2', 'M10 12h10', 'M8 10v4', 'M4 17h10', 'M18 17h2', 'M16 15v4']],
];
const labelOf = (list, v) => (list.find(x => x[0] === v) || [, ''])[1];
const norm = t => String(t).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
// The controls a setting is made with: get() is what they are, change(key, value) makes one.
function kit(get, change) {
  const seg = (label, key, opts) => h('div', { class: 'pref', role: 'group', 'aria-label': label }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', { type: 'button', class: get()[key] === v ? 'on' : '', 'aria-pressed': get()[key] === v, 'data-fk': `${key}:${v}`, onclick: () => change(key, v) }, l))));
  const stepper = (cls, label, value, less, more, lessLabel, moreLabel) => h('div', { class: 'pref ' + cls }, h('div', { class: 'pref-label' }, label),
    h('div', { class: 'pr-stepper' }, h('button', { type: 'button', class: 'btn ghost', 'aria-label': lessLabel, 'data-fk': `${cls}:less`, onclick: less }, '−'), h('span', { class: 'pr-val' }, value), h('button', { type: 'button', class: 'btn ghost', 'aria-label': moreLabel, 'data-fk': `${cls}:more`, onclick: more }, '+')));
  // The reading line's look, in its menu and in Format: how it shows, its colour and strength, the lock, and Reset.
  const lineLook = () => {
    const p = get();
    return [
      seg('How it looks', 'lineLook', LOOKS),
      h('div', { class: 'pref', role: 'group', 'aria-label': 'Colour' }, h('div', { class: 'pref-label' }, 'Colour'),
        h('div', { class: 'seg wide pr-colours' }, LINE_COLOURS.map(([v, l]) => h('button', { type: 'button', class: p.lineColour === v ? 'on' : '', 'aria-pressed': p.lineColour === v, 'data-fk': `lineColour:${v}`, onclick: () => change('lineColour', v) }, h('i', { class: 'pr-swatch', 'data-colour': v, 'aria-hidden': 'true' }), l)))),
      seg('Strength', 'lineStrength', STRENGTHS),
      seg('Lock it in place', 'lineLock', [[false, 'Unlocked'], [true, 'Locked']]),
      h('button', { class: 'btn ghost pr-line-reset', type: 'button', 'data-fk': 'line:reset', onclick: () => { for (const [k, v] of Object.entries(LINE_DEF)) change(k, v); } }, 'Reset the reading line'),
    ];
  };
  return { seg, stepper, lineLook };
}
const lineSum = p => { const at = MARKS.find(m => m[0] === p.mark); return [at ? at[1].toLowerCase() : `${Math.round(p.mark * 100)}% down`, labelOf(LOOKS, p.lineLook).toLowerCase(), labelOf(LINE_COLOURS, p.lineColour).toLowerCase(), p.lineLock && 'locked'].filter(Boolean).join(' · '); };

function settingsPanel(logId, onChange = () => {}, { get = () => P, set = (k, v) => setSetting(k, v), goto = null, replace = null, hint = '' } = {}) {
  const u = readUi();
  let query = ''; // what Find a line was given, kept while the panel is drawn again
  const change = (k, v) => { set(k, v); haptic(); draw(); onChange(k); };
  const { seg, stepper, lineLook } = kit(get, change);
  const tabs = h('div', { class: 'pr-tabs', role: 'group', 'aria-label': 'Settings' });
  const body = h('div', { class: 'pr-tabbody stack' });
  const box = h('div', { class: 'pr-prefs' }, tabs, hint && h('p', { class: 'small pr-panel-hint' }, hint), body);
  const twirl = (id, title, sub, ...kids) => {
    const d = h('details', { class: 'twirl pr-twirl', 'data-twirl': id, open: !!u.open[id] },
      h('summary', { 'data-fk': `twirl:${id}` }, h('span', null, h('span', { class: 'twirl-name' }, title), sub && h('span', { class: 'twirl-sub' }, sub))),
      h('div', { class: 'twirl-body' }, ...kids));
    d.addEventListener('toggle', () => { if (u.open[id] !== d.open) { u.open[id] = d.open; saveUi(u); } });
    return d;
  };
  // The countdown before a take: a switch, and how long it is while it is on (the length is kept while it is off).
  const countdown = p => {
    const on = Number(p.count) > 0, len = Number(p.countLen) || Number(p.count) || 3;
    return h('div', { class: 'pref pr-count-set', role: 'group', 'aria-label': 'Countdown before a take' }, h('div', { class: 'pref-label' }, 'Countdown before a take'),
      h('div', { class: 'seg wide pr-count-switch' }, [[false, 'Off'], [true, 'On']].map(([v, l]) => h('button', { type: 'button', class: on === v ? 'on' : '', 'aria-pressed': on === v, 'data-fk': `count:${v}`, onclick: () => change('count', v ? len : 0) }, l))),
      on && h('div', { class: 'seg wide pr-count-len', role: 'group', 'aria-label': 'How long the countdown is' }, COUNT_LENGTHS.map(n => h('button', { type: 'button', class: Number(p.count) === n ? 'on' : '', 'aria-pressed': Number(p.count) === n, 'data-fk': `countLen:${n}`, onclick: () => { set('countLen', n); change('count', n); } }, `${n} s`))));
  };
  // Find a line: a few words, and the lines that have them (the words marked); a tap goes there.
  const finder = A => {
    const found = h('div', { class: 'pr-found' });
    const show = () => {
      const q = norm(query.trim());
      if (q.length < 2) { found.replaceChildren(); return; }
      const hits = A.filter(a => a.role !== 'cue' && norm(a.text).includes(q)).slice(0, 20);
      found.replaceChildren(...(hits.length ? hits.map(a => {
        const t = a.text, i = norm(t).indexOf(q), from = Math.max(0, i - 40), to = Math.min(t.length, i + q.length + 60);
        return h('button', { class: 'pr-jump-item', type: 'button', onclick: () => goto(a.id) }, a.speaker && a.role !== 'head' && h('b', null, a.speaker + ' '), (from ? '…' : '') + t.slice(from, i), h('mark', null, t.slice(i, i + q.length)), t.slice(i + q.length, to) + (to < t.length ? '…' : ''));
      }) : [h('p', { class: 'small muted' }, 'No line has those words.')]));
    };
    const input = h('input', { type: 'search', class: 'pr-find', placeholder: 'A few words from the line', 'aria-label': 'Find a line: a few words from it', 'data-fk': 'find', value: query, oninput: e => { query = e.target.value; show(); } });
    show();
    return [input, found];
  };
  const panes = {
    script: (p, log, focus, speakers) => {
      const sc = log && log.script, A = sc ? analyse(sc, focus, p.dirs) : [], heads = A.filter(a => a.role === 'head');
      return [
        twirl('show', 'How it shows', [`directions ${labelOf(DIRS, p.dirs).toLowerCase()}`, `names ${p.names ? 'shown' : 'hidden'}`, speakers.length > 1 && (focus ? `${focus}’s lines` : 'everyone’s lines')].filter(Boolean).join(' · '),
          seg('Directions', 'dirs', DIRS),
          seg('Speaker names', 'names', [[true, 'Shown'], [false, 'Hidden']]),
          speakers.length > 1 && h('div', { class: 'pref', role: 'group', 'aria-label': 'Lines to read' }, h('div', { class: 'pref-label' }, 'Lines to read'),
            h('div', { class: 'seg wide' }, [['', 'Everyone'], ...speakers.map(x => [x, x])].map(([v, l]) => h('button', { type: 'button', class: focus === v ? 'on' : '', 'aria-pressed': focus === v, 'data-fk': `focus:${v}`, onclick: () => { setFocus(logId, v); draw(); onChange('focus'); } }, l)))),
          speakers.length > 1 && h('p', { class: 'small muted' }, 'Choosing one speaker dims the others’ lines, so they are still there as cues.')),
        replace && twirl('replace', 'Import or replace', sc ? `${sc.name || 'Script'} · ${sc.paras.length} lines` : 'no script yet',
          h('p', { class: 'small muted' }, 'A Word file, PDF, Final Draft, Fountain or plain text, a Google Doc, pasted text, or a script from another log. Replacing it keeps your notes and their quotes.'),
          h('button', { class: 'btn ghost pr-replace', type: 'button', 'data-fk': 'replace', onclick: () => replace() }, sc ? '📄 Replace the script…' : '📄 Add a script…')),
        goto && A.length > 0 && twirl('scenes', 'Jump to a scene', heads.length ? `${heads.length} heading${heads.length === 1 ? '' : 's'}` : 'no headings in this script',
          h('div', { class: 'pr-jump' },
            h('button', { class: 'pr-jump-item pr-jump-top', type: 'button', onclick: () => goto(A[0].id) }, '↑ The top of the script'),
            heads.map(a => h('button', { class: 'pr-jump-item', type: 'button', onclick: () => goto(a.id) }, quote(a.text)))),
          !heads.length && h('p', { class: 'small muted' }, 'This script has no scene or section headings: Find a line finds any line.')),
        goto && A.length > 0 && twirl('find', 'Find a line', 'a few words, then the line', ...finder(A)),
      ];
    },
    format: p => [
      twirl('text', 'Text', [`about ${SIZES[clampSize(p.size)]} letters a line`, `${labelOf(SPACINGS, p.spacing).toLowerCase()} spacing`, `${labelOf(COLS, p.col).toLowerCase()} column`].join(' · '),
        stepper('pr-set-size', 'Text size', `about ${SIZES[clampSize(p.size)]} letters a line`, () => change('size', clampSize(p.size - 1)), () => change('size', clampSize(p.size + 1)), 'Smaller text', 'Bigger text'),
        seg('Line spacing', 'spacing', SPACINGS),
        seg('Column', 'col', COLS.map(([v, l]) => [v, l]))),
      twirl('line', 'Reading line', lineSum(p),
        seg('Where it sits', 'mark', MARKS),
        !MARKS.some(m => m[0] === p.mark) && h('p', { class: 'small muted' }, `Where it was dragged to: ${Math.round(p.mark * 100)}% down the screen.`),
        h('p', { class: 'small muted' }, 'Or drag its arrow on the prompter. Its menu (tap the arrow, or right-click the line) has the rest of these.'),
        ...lineLook()),
      twirl('rig', 'Rig', [p.mirror ? 'mirrored' : 'not mirrored', p.flip ? 'upside down' : 'upright'].join(' · '),
        seg('Mirror', 'mirror', [[false, 'Off'], [true, 'Mirrored for a rig']]),
        seg('Upside down', 'flip', [[false, 'Off'], [true, 'On']])),
    ],
    other: p => [
      twirl('count', 'Countdown', Number(p.count) > 0 ? `${p.count} s before a take` : 'off', countdown(p)),
      twirl('speed', 'Speed', `${p.wpm} words a minute`,
        stepper('pr-set-speed', 'Speed', `${p.wpm} words a minute`, () => change('wpm', clampWpm(p.wpm - 5)), () => change('wpm', clampWpm(p.wpm + 5)), 'Slower', 'Faster'),
        h('p', { class: 'small muted' }, '← → and ↑ ↓ change it too, and while it runs with its buttons away, the − and + in the bottom corner.')),
      twirl('scroll', 'Scrolling', p.wheel ? 'mouse and trackpad on' : 'mouse and trackpad off',
        seg('Scroll with mouse or trackpad', 'wheel', [[true, 'On'], [false, 'Off']]),
        h('p', { class: 'small muted' }, 'On, a mouse wheel or a trackpad scrolls the script as a web page scrolls; while it runs, it holds while you scroll and carries on from there. Off, the wheel, the trackpad and dragging with a mouse leave it where it is; a finger still drags it.')),
      twirl('keys', 'Keys and clickers', 'Space, Page Up and Down, the arrows', h('p', { class: 'small pr-keys-help' }, KEYS_HELP)),
    ],
  };
  const draw = () => {
    const log = byId('logs', logId), speakers = log && log.script ? speakersOf(log.script) : [], focus = focusOf(log), p = get();
    // The focus stays on the control that had it, and the twirl-downs where they were scrolled to.
    const had = box.contains(document.activeElement) ? document.activeElement.dataset.fk : null, y = body.scrollTop;
    tabs.replaceChildren(...TABS.map(([id, label, paths]) => h('button', { type: 'button', class: 'pr-tab' + (u.tab === id ? ' on' : ''), 'data-tab': id, 'aria-pressed': u.tab === id, 'data-fk': `tab:${id}`, onclick: () => { if (u.tab === id) return; u.tab = id; saveUi(u); body.scrollTop = 0; draw(); } }, icon(paths), h('span', null, label))));
    body.replaceChildren(...panes[u.tab](p, log, focus, speakers).filter(Boolean));
    body.scrollTop = y;
    if (had) { const el = box.querySelector(`[data-fk="${CSS.escape(had)}"]`); if (el) el.focus({ preventScroll: true }); }
  };
  draw();
  box.redraw = draw; // what the keys or the buttons changed meanwhile (the speed, the text size)
  box.show = (tab, twirlId) => { u.tab = tab; if (twirlId) u.open[twirlId] = true; saveUi(u); draw(); return box.querySelector(`[data-twirl="${twirlId}"]`); }; // for the walkthrough
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
  else if (k === 'PageDown') act('step', 1);
  else if (k === 'PageUp') act('step', -1);
  else if (k === 'ArrowUp' || k === 'ArrowLeft') act('wpm', -5);
  else if (k === 'ArrowDown' || k === 'ArrowRight') act('wpm', 5);
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
  const items = [...root.querySelectorAll('button:not([disabled]):not([hidden]), input, summary')].filter(el => el.offsetParent !== null && !el.closest('[inert]') && !el.closest('details:not([open]) > .twirl-body')); if (!items.length) return;
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
// A key for an overlay, unless something is over it (a sheet, a walkthrough, the lock), it is a button's own press, or it
// is typed into a box (Find a line): there only Escape is the overlay's.
const typing = e => !!(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'));
const keyFor = (e, root) => root.isConnected && !covered() && !document.querySelector('.sheet-back, .tour') && !(e.ctrlKey || e.metaKey || e.altKey) && !((e.key === ' ' || e.key === 'Enter') && e.target && e.target.closest && e.target.closest('button, summary')) && !(typing(e) && e.key !== 'Escape');

/* ------------------------------- the prompter ------------------------------- */
let OPEN = null; // the prompter on screen: { logId, cmd, close }
export const prompterOpen = () => !!OPEN;
export function openPrompter(logId, { from = null, controls = true } = {}) {
  if (OPEN) return;
  const log = byId('logs', logId);
  if (!log || !log.script || !log.script.paras || !log.script.paras.length) return;
  if (!store.requirePaid('prompter')) return; // free during the trial, then with a licence
  OPEN = run(logId, from || lastLine.get(logId) || null, controls);
}
export function closePrompter() { if (OPEN) OPEN.close(); }

function run(logId, from, controls = true) {
  const opener = document.activeElement;
  let hudTimer = 0, hintTimer = 0, liveTimer = 0, was = null, rate = null, moved = null, scriptAt = null;
  const stage = makeStage({ onState: s => onState(s), onHold: id => lineMenu(id), onLine: what => (what === 'menu' ? readingLineMenu() : tell('The reading line is locked: tap its arrow to unlock it')) });

  /* the buttons: for whoever holds the device */
  const title = h('strong', { class: 'pr-name' });
  const state = h('span', { class: 'pr-state muted' });
  const tc = h('span', { class: 'tc-mono pr-tc' });
  const top = h('div', { class: 'pr-hud pr-top' },
    h('button', { class: 'icon-btn pr-close', type: 'button', 'aria-label': 'Close the prompter', onclick: () => close() }, '✕'),
    h('div', { class: 'pr-title' }, title, state),
    tc,
    h('button', { class: 'icon-btn pr-help', type: 'button', 'aria-label': 'Tutorial for the prompter', title: 'Tutorial', onclick: () => { stage.cmd('pause'); import('./tutorials.js').then(m => m.openTutorial('tcprompt')); } }, '?'),
    h('button', { class: 'icon-btn pr-settings', type: 'button', 'aria-label': 'Prompter controls', 'aria-expanded': 'false', title: 'Controls', onclick: () => showPanel(!panel.classList.contains('open')) }, '⚙'));
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
  // While it runs with the buttons away: the speed in a corner, still in reach of a finger, so a phone or a tablet
  // changes it without stopping (a tap anywhere else still pauses). Faint until it is used; not there with voice-follow.
  const liveWpm = h('span', { class: 'pr-live-val' });
  const nudgeSpeed = d => { act('wpm', d); live.classList.add('used'); clearTimeout(liveTimer); liveTimer = setTimeout(() => live.classList.remove('used'), 1500); };
  const live = h('div', { class: 'pr-live', role: 'group', 'aria-label': 'Speed while it runs' },
    h('button', { class: 'pr-live-btn', type: 'button', 'aria-label': 'Slower', onclick: () => nudgeSpeed(-5) }, '−'), liveWpm,
    h('button', { class: 'pr-live-btn', type: 'button', 'aria-label': 'Faster', onclick: () => nudgeSpeed(5) }, '+'));
  const rateBox = h('div', { class: 'pr-ratebox', hidden: true, role: 'group', 'aria-label': 'Rate the take' });
  const hint = h('div', { class: 'pr-hint', role: 'status' });
  // 🎙 voice-follow: the script follows the talent's voice while it runs (shown where the browser can do it).
  const ear = earFor(() => stage.lines(), (id, frac) => stage.cmd('aim', { id, frac }), msg => { setSetting('voice', false); stage.cmd('follow', false); drawHud(); tell(msg); });
  function setVoice(on) {
    if (on && !voiceAgreed()) { stage.cmd('pause'); askVoice(() => setVoice(true)); return; }
    setSetting('voice', on); stage.cmd('follow', on); ear.check(stage.state()); drawHud(); setTimeout(() => refocus(), 0);
    tell(on ? '🎙 Voice-follow: the script follows the talent as they read' : 'Voice-follow off: the script runs at its speed');
  }
  // The controls, sliding out over the prompter: open while it is set up (the stage behind shows each change as it
  // is made), away as soon as it prompts (Play, Roll, the countdown), and back with ⚙. Escape puts them away too.
  const prefs = settingsPanel(logId, () => { stage.refresh(); drawHud(); }, {
    goto: id => { stage.cmd('goto', id); lastLine.set(logId, id); },
    replace: () => { const l = byId('logs', logId); if (l) openImport(l, null, { view: 'prompter' }); },
    hint: 'Each change shows on the script behind. ▶ Play or ● Roll puts these away; ⚙ brings them back.' });
  const panel = h('aside', { class: 'pr-panel', 'aria-label': 'Prompter controls', inert: true },
    h('div', { class: 'pr-panel-head' }, h('h2', null, 'Controls'), h('button', { class: 'icon-btn pr-panel-close', type: 'button', 'aria-label': 'Hide the controls', onclick: () => showPanel(false) }, '✕')),
    prefs);
  const root = h('div', { class: 'prompter', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Teleprompter', 'data-state': 'paused', tabindex: '-1' }, stage.el, panel, top, bottom, live, rateBox, hint);
  const gear = top.querySelector('.pr-settings');
  // On an upright phone the drawer would cover the reading line, so while it is out the stage is lifted into the strip
  // above it, with the reading line as far down that strip as it is down the whole screen: the text size, the spacing
  // and the reading line itself all show as they are changed. (`translate` adds to the stage's mirror and upside down.)
  const upright = matchMedia('(orientation: portrait)');
  function fitStage() {
    let lift = 0;
    if (panel.classList.contains('open') && upright.matches) {
      const m = stage.el.querySelector('.pr-marker'), H = stage.el.clientHeight, row = m.offsetHeight;
      const y = stage.el.classList.contains('flip') ? H - m.offsetTop - row : m.offsetTop; // the reading line, where it shows
      const a = top.offsetHeight, b = H - bottom.offsetHeight, to = panel.offsetTop; // the screen between the bars; the drawer's top, once out
      const f = Math.max(0, Math.min(1, (y - a) / Math.max(1, b - a - row)));
      lift = Math.min(0, Math.round(a + f * Math.max(0, to - a - row) - y));
    }
    stage.el.style.translate = lift ? `0 ${lift}px` : '';
  }
  function showPanel(open) {
    if (open === panel.classList.contains('open')) return;
    if (open) { const s = stage.state(); if (s.playing || s.counting) stage.cmd('pause'); root.style.setProperty('--pr-top', top.offsetHeight + 'px'); root.style.setProperty('--pr-bot', bottom.offsetHeight + 'px'); prefs.redraw(); showHud(); }
    panel.classList.toggle('open', open); panel.inert = !open; gear.setAttribute('aria-expanded', String(open)); gear.classList.toggle('on', open);
    fitStage();
    if (!open && panel.contains(document.activeElement)) root.focus({ preventScroll: true });
  }

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
    if (s.playing || s.counting) showPanel(false); // prompting: the controls get out of the way
    else if (panel.classList.contains('open')) { if (was && (was.wpm !== s.wpm || was.size !== s.size)) prefs.redraw(); fitStage(); } // measured again: a setting, a turn of the phone
    root.dataset.state = s.counting ? 'count' : s.playing ? 'running' : 'paused';
    const on = s.playing || s.counting, wasOn = !!(was && (was.playing || was.counting));
    if (on && !wasOn) { root.classList.add('cursor-off'); moved = null; hudSoon(); } // the pointer goes as it starts
    if (!on) root.classList.remove('cursor-off');
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
    liveWpm.textContent = `${s.wpm} wpm`; root.classList.toggle('following', !!s.follow);
    if (voiceBtn) { voiceBtn.setAttribute('aria-pressed', String(!!P.voice)); voiceBtn.classList.toggle('on', !!P.voice); }
    if (ear.listening()) state.textContent += ' · listening';
    title.textContent = l.script ? l.script.name || l.title : l.title;
  }
  const tick = () => { const l = byId('logs', logId); tc.textContent = l && l.sync ? nowTc(l) : 'no timecode'; };
  const tell = msg => { hint.textContent = msg; hint.classList.add('shown'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove('shown'), 2600); };
  // While it runs the buttons step away after 2 seconds, and the mouse pointer as soon as it starts (the countdown too).
  // A real move of the mouse brings both back; a nudge (a knock on the desk, a hand on the trackpad) does not, and nor
  // does scrolling. A tap or a click brings the buttons back, except on the speed in the corner, which works without.
  const running = () => { const s = stage.state(); return s.playing || s.counting; };
  const showHud = () => { root.classList.remove('hud-off', 'cursor-off'); moved = null; clearTimeout(hudTimer); hudSoon(); };
  const hudSoon = () => { clearTimeout(hudTimer); if (running()) hudTimer = setTimeout(() => { if (!running()) return; root.classList.add('cursor-off'); if (stage.state().playing) root.classList.add('hud-off'); moved = null; }, 2000); };
  root.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    if (!root.classList.contains('cursor-off') && !root.classList.contains('hud-off')) { hudSoon(); return; } // still in sight: in sight for longer
    const t = performance.now();
    if (!moved || t - moved.t > 600) { moved = { x: e.clientX, y: e.clientY, t }; return; }
    if (Math.hypot(e.clientX - moved.x, e.clientY - moved.y) > 10) showHud();
  });
  root.addEventListener('pointerdown', e => { if (!e.target.closest('.pr-live')) showHud(); });
  root.addEventListener('focusin', e => { if (e.target !== root && !e.target.closest('.pr-live')) showHud(); }); // a button reached with Tab shows them all (the speed in the corner works without them)
  const refocus = giveBackFocus(root);
  // The reading line's own menu (its arrow tapped or held, or the line right-clicked): how it looks, its colour and
  // strength, the lock, and Reset. Opening it pauses, as a line's menu does; each change shows behind it at once.
  function readingLineMenu() {
    stage.cmd('pause');
    const body = h('div', { class: 'stack pr-line-menu' });
    const change = (k, v) => { setSetting(k, v); haptic(); stage.refresh(); draw(); if (panel.classList.contains('open')) prefs.redraw(); };
    const { lineLook } = kit(() => P, change);
    const draw = () => body.replaceChildren(h('p', { class: 'small muted' }, P.lineLock ? 'Locked: unlock it to drag it again.' : 'Drag its arrow up or down on the screen to move it.'), ...lineLook());
    draw();
    sheet('The reading line', body);
  }
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
    if (e.key === 'Escape' && panel.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); showPanel(false); return; } // the controls first, then the prompter
    if (promptKey(e, act)) { e.preventDefault(); e.stopPropagation(); }
  };
  const onResize = () => { if (panel.classList.contains('open')) { root.style.setProperty('--pr-top', top.offsetHeight + 'px'); root.style.setProperty('--pr-bot', bottom.offsetHeight + 'px'); } };
  addEventListener('resize', onResize);

  /* the screen stays on, and the page goes full screen where it can (the whole page, so sheets still show over it) */
  let wake = null, ownFull = false;
  const keepAwake = async () => { try { if (!wake && 'wakeLock' in navigator && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { wake = null; } };
  const onVisible = () => { if (document.visibilityState === 'visible') keepAwake(); else stage.cmd('pause'); };

  /* changes to the log from here, from the script, or from a linked device; a script replaced starts at its top */
  const unsub = subscribe(() => {
    const l = byId('logs', logId);
    if (!l || !l.script || !l.script.paras || !l.script.paras.length) { close(); return; }
    const fresh = scriptAt !== null && l.script.imported !== scriptAt; scriptAt = l.script.imported;
    stage.update({ script: l.script, focus: focusOf(l) });
    if (fresh) { stage.cmd('home'); prefs.redraw(); tell(`Script loaded: ${l.script.name || 'the script'}`); }
    drawHud();
  });
  const iv = setInterval(tick, 250);

  function close() {
    if (!root.isConnected) return;
    stage.cmd('pause');
    // A take rolled here in free run ends with the prompter. In record run the camera may still be rolling, so a take
    // there stays open for the log's own Cut.
    const l = byId('logs', logId); if (l && l.open && !(l.mode === 'record' && l.sync)) endTake(logId);
    clearInterval(iv); clearTimeout(hudTimer); clearTimeout(hintTimer); clearTimeout(liveTimer); ear.stop(); stage.destroy(); unsub();
    window.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVisible); removeEventListener('resize', onResize);
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
  stage.load({ script: log.script, focus: focusOf(log), from }); scriptAt = log.script.imported;
  stage.attach();
  if (P.voice && voiceSupported() && voiceAgreed()) stage.cmd('follow', true); // left on last time on this device
  drawHud(); tick();
  root.focus({ preventScroll: true }); // the dialog itself: Space then plays, and no button wears a focus ring
  if (controls) showPanel(true); // set it up first; it slides away when it prompts (and says how, at its top)
  else tell('Tap the text or ▶ to start · hold a line to start from it, mark it or edit it');
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
      h('button', { class: 'icon-btn pr-settings', type: 'button', 'aria-label': `Settings of the prompter on ${port.name}`, title: 'Its settings', onclick: () => {
        const sh = sheet(`Settings on ${port.name}`, settingsPanel(logId, () => {}, {
          get: () => ({ ...P, ...(s && s.prefs) }),
          set: (k, v) => { port.send('set', { key: k, value: v }); if (s) s.prefs = { ...(s.prefs || {}), [k]: v }; },
          goto: id => port.send('goto', id), // Jump to a scene and Find a line move the other screen
          replace: () => { sh.close(); const l = log(); if (l) openImport(l, null, { view: 'prompter' }); } }));
      } }, '⚙')),
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
    const tryOpen = n => { const l = byId('logs', m.log); if (l && l.script && l.script.paras && l.script.paras.length) openPrompter(m.log, { from: m.from || null, controls: false }); else if (n < 25) setTimeout(() => tryOpen(n + 1), 200); else link.send({ t: 'pr-closed', log: m.log, why: 'no script' }); };
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

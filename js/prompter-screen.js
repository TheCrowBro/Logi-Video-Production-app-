// The prompter on a second screen: a window of its own (prompter.html), opened by Vdex on this computer (🖥 Second
// screen on a log's Prompter view), showing the stage (js/prompter-stage.js) and nothing else. The window that opened
// it holds the log, the script and the takes; this one hears them over a BroadcastChannel and answers with where it
// is. It never opens the vault, so it has no lock of its own: it shows only the script it is given, while it is open.
import { h } from './util.js';
import { makeStage, P } from './prompter-stage.js';

const bc = new BroadcastChannel('vdex-prompter');
let loaded = false, hideTimer = 0, moved = null;
// The mouse pointer goes as it starts (and while it counts down), comes back with a real move of the mouse (not a nudge,
// nor scrolling) and goes again after 2 seconds still. Its settings go with its state, for the remote's ⚙ (a reading
// line dragged here, too).
const running = s => !!(s && (s.playing || s.counting));
const stage = makeStage({ onState: s => {
  root.dataset.state = s.counting ? 'count' : s.playing ? 'running' : 'paused';
  if (running(s) && !root.classList.contains('was-on')) { root.classList.add('cursor-off', 'was-on'); moved = null; }
  if (!running(s)) { root.classList.remove('cursor-off', 'was-on'); clearTimeout(hideTimer); }
  bc.postMessage({ t: 'state', s: { ...s, prefs: { ...P } } });
} });
const fill = h('button', { class: 'btn pr-fill', type: 'button', onclick: () => document.documentElement.requestFullscreen?.().catch(() => {}) }, '⛶ Fill this screen');
const wait = h('div', { class: 'pr-wait' }, h('p', null, 'This is the prompter’s window. Open it from Vdex on this computer: TC Notes → a log → Prompter → 🖥 Second screen.'));
const root = h('div', { class: 'prompter pr-window', 'data-state': 'paused', role: 'main', 'aria-label': 'Teleprompter' }, stage.el, fill, wait);
document.body.append(root);
stage.attach();
root.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse' || !running(stage.state())) return;
  const t = performance.now();
  if (root.classList.contains('cursor-off')) {
    if (!moved || t - moved.t > 600) { moved = { x: e.clientX, y: e.clientY, t }; return; }
    if (Math.hypot(e.clientX - moved.x, e.clientY - moved.y) <= 10) return;
    root.classList.remove('cursor-off'); moved = null;
  }
  clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (running(stage.state())) { root.classList.add('cursor-off'); moved = null; } }, 2000);
});

bc.onmessage = e => {
  const m = e.data || {};
  if (m.t === 'load') { stage.load(m); loaded = true; wait.hidden = true; }
  else if (m.t === 'update' && loaded) stage.update(m);
  else if (m.t === 'cmd' && loaded) stage.cmd(m.cmd, m.arg);
  else if (m.t === 'close') window.close();
};
bc.postMessage({ t: 'ready' });
addEventListener('pagehide', () => bc.postMessage({ t: 'closed' }));
const fullscreen = () => { fill.hidden = !!document.fullscreenElement || !document.fullscreenEnabled; };
document.addEventListener('fullscreenchange', fullscreen); fullscreen();

// Keys pressed in this window: the stage's own here; Roll, ⚑ and a rating go to the window that holds the log.
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || !loaded) return;
  const k = e.key, cmd = { ' ': 'toggle', Enter: 'toggle', k: 'toggle', K: 'toggle', b: 'toggle', B: 'toggle', '.': 'toggle', PageDown: ['step', 1], PageUp: ['step', -1], ArrowUp: ['wpm', -5], ArrowLeft: ['wpm', -5], ArrowDown: ['wpm', 5], ArrowRight: ['wpm', 5], '+': ['size', 1], '=': ['size', 1], '-': ['size', -1], _: ['size', -1], Home: 'home', End: 'end' }[k];
  if (cmd) { const [c, a] = Array.isArray(cmd) ? cmd : [cmd]; stage.cmd(c, a); e.preventDefault(); return; }
  if (/^[rRfFgGnN]$/.test(k)) { bc.postMessage({ t: 'key', key: k }); e.preventDefault(); }
});

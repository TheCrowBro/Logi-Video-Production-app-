// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';
import { startTour } from './tour.js';

const KEY = 'logi-prefs';
export const PALETTES = [{"id": "brass", "name": "Brass", "dark": {"bg": "#14110f", "bg2": "#1d1915", "card": "#25201b", "line": "#3a332b", "text": "#f1e6cf", "muted": "#a09584", "accent": "#e0a43a", "accent-ink": "#1a1305", "paper": "#f1e6cf", "paper-ink": "#2a2118"}, "light": {"bg": "#efe8da", "bg2": "#e6dec9", "card": "#fbf7ec", "line": "#d4c9b0", "text": "#2a2118", "muted": "#756a58", "accent": "#b87a10", "accent-ink": "#ffffff", "paper": "#fbf7ec", "paper-ink": "#2a2118"}}, {"id": "noir", "name": "Noir", "dark": {"bg": "#0b0b0c", "bg2": "#141416", "card": "#1b1b1e", "line": "#2c2c31", "text": "#f2f2f2", "muted": "#9a9aa2", "accent": "#e8412c", "accent-ink": "#ffffff", "paper": "#ececec", "paper-ink": "#121214"}, "light": {"bg": "#f3f3f4", "bg2": "#e9e9ec", "card": "#ffffff", "line": "#d6d6dc", "text": "#151518", "muted": "#6b6b74", "accent": "#d2321e", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#151518"}}, {"id": "forest", "name": "Forest", "dark": {"bg": "#0f1712", "bg2": "#16211a", "card": "#1d2b22", "line": "#2d4034", "text": "#e9f0e4", "muted": "#93a596", "accent": "#c9b23a", "accent-ink": "#141a0a", "paper": "#e9f0e4", "paper-ink": "#1a2a1f"}, "light": {"bg": "#e9efe5", "bg2": "#dde6d7", "card": "#f7faf4", "line": "#c6d3bf", "text": "#1b2a20", "muted": "#5f7064", "accent": "#7a8a13", "accent-ink": "#ffffff", "paper": "#f7faf4", "paper-ink": "#1b2a20"}}, {"id": "ocean", "name": "Ocean", "dark": {"bg": "#0d141c", "bg2": "#142030", "card": "#1a2a3d", "line": "#2b4258", "text": "#e6eef5", "muted": "#90a4b8", "accent": "#3cc1b8", "accent-ink": "#06211f", "paper": "#e6eef5", "paper-ink": "#13263a"}, "light": {"bg": "#e7eef3", "bg2": "#dbe5ec", "card": "#f9fbfd", "line": "#c3d2de", "text": "#13263a", "muted": "#5a6f82", "accent": "#0f8f87", "accent-ink": "#ffffff", "paper": "#f9fbfd", "paper-ink": "#13263a"}}, {"id": "plum", "name": "Plum", "dark": {"bg": "#17101a", "bg2": "#221826", "card": "#2b1f31", "line": "#44304c", "text": "#f3e8f5", "muted": "#ad9bb3", "accent": "#e07ab0", "accent-ink": "#2a0a1c", "paper": "#f3e8f5", "paper-ink": "#2b1a30"}, "light": {"bg": "#f1e9f3", "bg2": "#e8dcec", "card": "#fcf8fd", "line": "#d8c6dd", "text": "#2b1a30", "muted": "#74607b", "accent": "#b23c7f", "accent-ink": "#ffffff", "paper": "#fcf8fd", "paper-ink": "#2b1a30"}}, {"id": "mono", "name": "Mono", "dark": {"bg": "#121212", "bg2": "#1a1a1a", "card": "#222222", "line": "#343434", "text": "#eeeeee", "muted": "#9a9a9a", "accent": "#e6e6e6", "accent-ink": "#111111", "paper": "#eeeeee", "paper-ink": "#111111"}, "light": {"bg": "#f4f4f4", "bg2": "#eaeaea", "card": "#ffffff", "line": "#d4d4d4", "text": "#111111", "muted": "#666666", "accent": "#222222", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#111111"}}];
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'soft', haptics: true, targets: 'normal', palette: 'brass', scheme: 'system' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (!['soft', 'bar', 'off'].includes(prefs.motion)) prefs.motion = 'soft'; // older saved values map to the default

const LIGHT = matchMedia('(prefers-color-scheme: light)');
export const resolvedScheme = () => (prefs.scheme === 'light' || prefs.scheme === 'dark' ? prefs.scheme : LIGHT.matches ? 'light' : 'dark');
LIGHT.addEventListener('change', () => { if (prefs.scheme === 'system') applyPrefs(); });
export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.palette = PALETTES.some(p => p.id === prefs.palette) ? prefs.palette : 'brass';
  r.dataset.scheme = resolvedScheme();
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) { const p = PALETTES.find(x => x.id === r.dataset.palette); meta.content = p[r.dataset.scheme].bg; }
  r.dataset.text = prefs.text;
  r.dataset.contrast = prefs.contrast;
  // The Rolodex bar spins and page content fades softly; nothing else moves. All off when the device asks for reduced motion.
  r.dataset.motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : prefs.motion;
  r.dataset.targets = prefs.targets;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } applyPrefs(); };

export function haptic(ms = 12) {
  if (prefs.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } }
}

const GROUPS = [
  ['text', 'Text size', [['normal', 'Standard'], ['large', 'Large'], ['xlarge', 'Extra large']]],
  ['targets', 'Button size', [['normal', 'Standard'], ['large', 'Extra large']]],
  ['contrast', 'Contrast', [['normal', 'Standard'], ['high', 'High']]],
  ['motion', 'Animation', [['soft', 'Rolodex + small touches'], ['bar', 'Rolodex only'], ['off', 'None']]],
  ['haptics', 'Vibration feedback', [[true, 'On'], [false, 'Off']]],
];

export const themeSummary = () => `${(PALETTES.find(p => p.id === prefs.palette) || PALETTES[0]).name} · ${prefs.scheme === 'system' ? 'follows device' : prefs.scheme}`;
export const prefsSummary = () => [prefs.palette !== 'brass' && (PALETTES.find(p => p.id === prefs.palette) || {}).name, prefs.scheme !== 'system' && prefs.scheme, prefs.text !== 'normal' && `${prefs.text === 'large' ? 'large' : 'extra large'} text`, prefs.targets === 'large' && 'big buttons', prefs.contrast === 'high' && 'high contrast', prefs.motion !== 'soft' && (prefs.motion === 'off' ? 'no animation' : 'Rolodex only')].filter(Boolean).join(' · ') || 'standard';

export function displayPanel({ onTour } = {}) {
  const groups = h('div', { class: 'stack' });
  const draw = () => groups.replaceChildren(...GROUPS.map(([key, label, opts]) => h('div', { class: 'pref', role: 'group', 'aria-label': label },
    h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', {
      type: 'button', class: prefs[key] === v ? 'on' : '', 'aria-pressed': prefs[key] === v,
      onclick: () => { prefs[key] = v; save(); haptic(); draw(); },
    }, l))))));
  draw();
  // Colour theme twirl-down: palette swatches plus light / dark / follow-device.
  const themeSum = h('span', { class: 'twirl-sub' });
  const themeBody = h('div', { class: 'twirl-body' });
  const drawTheme = () => {
    themeSum.textContent = themeSummary();
    themeBody.replaceChildren(
      h('div', { class: 'pref' }, h('div', { class: 'pref-label' }, 'Appearance'),
        h('div', { class: 'seg wide' }, [['system', 'Follow device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('button', { type: 'button', class: prefs.scheme === v ? 'on' : '', 'aria-pressed': prefs.scheme === v, onclick: () => { prefs.scheme = v; save(); haptic(); drawTheme(); } }, l)))),
      h('div', { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Colour theme' }, PALETTES.map(p => {
        const c = p[resolvedScheme()], on = prefs.palette === p.id;
        return h('button', { type: 'button', class: 'theme-row', role: 'radio', 'aria-checked': on, onclick: () => { prefs.palette = p.id; save(); haptic(); drawTheme(); } },
          h('span', { class: 'swatches', 'aria-hidden': 'true' }, ['bg', 'card', 'accent', 'text'].map(k => h('i', { style: `background:${c[k]}` }))),
          h('span', null, p.name, h('span', { class: 'twirl-sub' }, p.id === 'brass' ? 'the original: warm dark with amber' : p.id === 'noir' ? 'black, white and record-light red' : p.id === 'forest' ? 'deep greens with a gold accent' : p.id === 'ocean' ? 'navy and teal' : p.id === 'plum' ? 'aubergine and rose' : 'greyscale, no colour at all')),
          h('span', { class: 'check' }, on ? '✓' : ''));
      })));
  };
  drawTheme();
  const theme = h('details', { class: 'twirl' }, h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '🎨'), h('span', null, h('span', { class: 'twirl-name' }, 'Colour theme'), themeSum)), themeBody);
  const el = h('div', { class: 'stack' }, theme, groups,
    onTour && h('div', { class: 'pref' }, h('div', { class: 'pref-label' }, 'Help'), h('button', { class: 'btn ghost', onclick: onTour }, '🧭 Take the tour again')),
    h('p', { class: 'muted small' }, '“Small touches” are short, gentle effects: buttons pressing, cards lifting, new notes popping in, the tour spotlight gliding. Nothing slides across the screen. Choose Rolodex only or None to stop them; everything also stops if your phone is set to reduce motion.'));
  return { el, destroy: () => {} };
}

export function openDisplaySettings() {
  const { close } = sheet('Display & accessibility', displayPanel({ onTour: () => { close(); setTimeout(() => startTour(), 150); } }).el);
}

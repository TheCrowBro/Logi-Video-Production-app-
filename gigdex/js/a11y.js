// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';
import { startTour } from './tour.js';

const KEY = 'gdex-prefs';
export const PALETTES = [{"id": "stage", "name": "Stage", "group": "classic", "blurb": "dark stage, pink spotlight", "dark": {"bg": "#120f1a", "bg2": "#1a1626", "card": "#231d33", "line": "#382f50", "text": "#efe9fb", "muted": "#a59dbb", "accent": "#ff5c8a", "accent-ink": "#2a0612", "paper": "#f3eefb", "paper-ink": "#211a2e"}, "light": {"bg": "#efecf5", "bg2": "#e5e0ef", "card": "#fcfbff", "line": "#d5cee5", "text": "#1f1830", "muted": "#6c6484", "accent": "#c3265a", "accent-ink": "#ffffff", "paper": "#fcfbff", "paper-ink": "#1f1830"}}, {"id": "brass", "name": "Brass", "group": "classic", "blurb": "warm dark with amber, like valves glowing", "dark": {"bg": "#14110f", "bg2": "#1d1915", "card": "#25201b", "line": "#3a332b", "text": "#f1e6cf", "muted": "#a09584", "accent": "#e0a43a", "accent-ink": "#1a1305", "paper": "#f1e6cf", "paper-ink": "#2a2118"}, "light": {"bg": "#efe8da", "bg2": "#e6dec9", "card": "#fbf7ec", "line": "#d4c9b0", "text": "#2a2118", "muted": "#756a58", "accent": "#b87a10", "accent-ink": "#ffffff", "paper": "#fbf7ec", "paper-ink": "#2a2118"}}, {"id": "noir", "name": "Noir", "group": "classic", "blurb": "black, white and record-light red", "dark": {"bg": "#0b0b0c", "bg2": "#141416", "card": "#1b1b1e", "line": "#2c2c31", "text": "#f2f2f2", "muted": "#9a9aa2", "accent": "#e8412c", "accent-ink": "#ffffff", "paper": "#ececec", "paper-ink": "#121214"}, "light": {"bg": "#f3f3f4", "bg2": "#e9e9ec", "card": "#ffffff", "line": "#d6d6dc", "text": "#151518", "muted": "#6b6b74", "accent": "#d2321e", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#151518"}}, {"id": "forest", "name": "Forest", "group": "classic", "blurb": "deep greens with a gold accent", "dark": {"bg": "#0f1712", "bg2": "#16211a", "card": "#1d2b22", "line": "#2d4034", "text": "#e9f0e4", "muted": "#93a596", "accent": "#c9b23a", "accent-ink": "#141a0a", "paper": "#e9f0e4", "paper-ink": "#1a2a1f"}, "light": {"bg": "#e9efe5", "bg2": "#dde6d7", "card": "#f7faf4", "line": "#c6d3bf", "text": "#1b2a20", "muted": "#5f7064", "accent": "#7a8a13", "accent-ink": "#ffffff", "paper": "#f7faf4", "paper-ink": "#1b2a20"}}, {"id": "ocean", "name": "Ocean", "group": "classic", "blurb": "navy and teal", "dark": {"bg": "#0d141c", "bg2": "#142030", "card": "#1a2a3d", "line": "#2b4258", "text": "#e6eef5", "muted": "#90a4b8", "accent": "#3cc1b8", "accent-ink": "#06211f", "paper": "#e6eef5", "paper-ink": "#13263a"}, "light": {"bg": "#e7eef3", "bg2": "#dbe5ec", "card": "#f9fbfd", "line": "#c3d2de", "text": "#13263a", "muted": "#5a6f82", "accent": "#0f8f87", "accent-ink": "#ffffff", "paper": "#f9fbfd", "paper-ink": "#13263a"}}, {"id": "mono", "name": "Mono", "group": "classic", "blurb": "greyscale, no colour at all", "dark": {"bg": "#121212", "bg2": "#1a1a1a", "card": "#222222", "line": "#343434", "text": "#eeeeee", "muted": "#9a9a9a", "accent": "#e6e6e6", "accent-ink": "#111111", "paper": "#eeeeee", "paper-ink": "#111111"}, "light": {"bg": "#f4f4f4", "bg2": "#eaeaea", "card": "#ffffff", "line": "#d4d4d4", "text": "#111111", "muted": "#666666", "accent": "#222222", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#111111"}}, {"id": "neon", "name": "Neon", "group": "mood", "blurb": "club black with electric cyan", "dark": {"bg": "#07090d", "bg2": "#0e1218", "card": "#141a22", "line": "#24303d", "text": "#e8f6fb", "muted": "#8ea3b0", "accent": "#22d3ee", "accent-ink": "#03161b", "paper": "#e8f6fb", "paper-ink": "#0b1a22"}, "light": {"bg": "#eef5f8", "bg2": "#e2edf1", "card": "#ffffff", "line": "#c9dbe2", "text": "#0b1a22", "muted": "#557080", "accent": "#0e7f95", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#0b1a22"}}, {"id": "vinyl", "name": "Vinyl", "group": "mood", "blurb": "record black with a label orange", "dark": {"bg": "#100e0d", "bg2": "#181514", "card": "#211d1b", "line": "#36302c", "text": "#f6ece4", "muted": "#a89a90", "accent": "#ff8a3d", "accent-ink": "#2a1204", "paper": "#f6ece4", "paper-ink": "#241c17"}, "light": {"bg": "#f5eee8", "bg2": "#ece2d9", "card": "#fffaf6", "line": "#dccdc0", "text": "#241c17", "muted": "#76675b", "accent": "#c45a12", "accent-ink": "#ffffff", "paper": "#fffaf6", "paper-ink": "#241c17"}}, {"id": "synth", "name": "Synthwave", "group": "mood", "blurb": "midnight purple with a sunset glow", "dark": {"bg": "#140b24", "bg2": "#1d1033", "card": "#261642", "line": "#3d2763", "text": "#f5e9ff", "muted": "#b29cc9", "accent": "#ffb347", "accent-ink": "#2a1300", "paper": "#f5e9ff", "paper-ink": "#22123a"}, "light": {"bg": "#f3ecfb", "bg2": "#e8def5", "card": "#fdfaff", "line": "#d6c6ea", "text": "#22123a", "muted": "#6f5c88", "accent": "#a8590a", "accent-ink": "#ffffff", "paper": "#fdfaff", "paper-ink": "#22123a"}}, {"id": "tape", "name": "Cassette", "group": "mood", "blurb": "cream label, brown tape", "dark": {"bg": "#17130f", "bg2": "#211b15", "card": "#2b231c", "line": "#45392d", "text": "#f3e7d3", "muted": "#ab9a85", "accent": "#d9b26a", "accent-ink": "#1f1607", "paper": "#f3e7d3", "paper-ink": "#2b2118"}, "light": {"bg": "#f4ecdc", "bg2": "#ebe0c9", "card": "#fffaf0", "line": "#dacdb2", "text": "#2b2118", "muted": "#7a6a55", "accent": "#8a5f17", "accent-ink": "#ffffff", "paper": "#fffaf0", "paper-ink": "#2b2118"}}];
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'soft', haptics: true, targets: 'normal', palette: 'stage', scheme: 'system' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (!['soft', 'bar', 'off'].includes(prefs.motion)) prefs.motion = 'soft'; // older saved values map to the default

const LIGHT = matchMedia('(prefers-color-scheme: light)');
export const resolvedScheme = () => (prefs.scheme === 'light' || prefs.scheme === 'dark' ? prefs.scheme : LIGHT.matches ? 'light' : 'dark');
LIGHT.addEventListener('change', () => { if (prefs.scheme === 'system') applyPrefs(); });
export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.palette = PALETTES.some(p => p.id === prefs.palette) ? prefs.palette : 'stage';
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
  if (!prefs.haptics) return;
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* ignore */ } }
}

const GROUPS = [
  ['text', 'Text size', [['normal', 'Standard'], ['large', 'Large'], ['xlarge', 'Extra large']]],
  ['targets', 'Button size', [['normal', 'Standard'], ['large', 'Extra large']]],
  ['contrast', 'Contrast', [['normal', 'Standard'], ['high', 'High']]],
  ['motion', 'Animation', [['soft', 'Rolodex + small touches'], ['bar', 'Rolodex only'], ['off', 'None']]],
  ['haptics', 'Vibration feedback', [[true, 'On'], [false, 'Off']]],
];

export const themeSummary = () => `${(PALETTES.find(p => p.id === prefs.palette) || PALETTES[0]).name} · ${prefs.scheme === 'system' ? 'follows device' : prefs.scheme}`;
export const prefsSummary = () => [prefs.palette !== 'stage' && (PALETTES.find(p => p.id === prefs.palette) || {}).name, prefs.scheme !== 'system' && prefs.scheme, prefs.text !== 'normal' && `${prefs.text === 'large' ? 'large' : 'extra large'} text`, prefs.targets === 'large' && 'big buttons', prefs.contrast === 'high' && 'high contrast', prefs.motion !== 'soft' && (prefs.motion === 'off' ? 'no animation' : 'Rolodex only')].filter(Boolean).join(' · ') || 'standard';

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
      h('div', { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Colour theme' }, PALETTES.flatMap((p, i) => [i === 0 && h('div', { class: 'theme-group' }, 'Classic'), p.group === 'mood' && PALETTES[i - 1].group !== 'mood' && h('div', { class: 'theme-group' }, 'Stage moods'), (() => {
        const c = p[resolvedScheme()], on = prefs.palette === p.id;
        return h('button', { type: 'button', class: 'theme-row', role: 'radio', 'aria-checked': on, onclick: () => { prefs.palette = p.id; save(); haptic(); drawTheme(); } },
          h('span', { class: 'swatches', 'aria-hidden': 'true' }, ['bg', 'card', 'accent', 'text'].map(k => h('i', { style: `background:${c[k]}` }))),
          h('span', null, p.name, h('span', { class: 'twirl-sub' }, p.blurb || '')),
          h('span', { class: 'check' }, on ? '✓' : ''));
      })()])));
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

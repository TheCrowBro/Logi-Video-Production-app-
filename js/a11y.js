// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';
import { startTour } from './tour.js';

const KEY = 'logi-prefs';
export const PALETTES = [{"id": "brass", "name": "Brass", "dark": {"bg": "#14110f", "bg2": "#1d1915", "card": "#25201b", "line": "#3a332b", "text": "#f1e6cf", "muted": "#a09584", "accent": "#e0a43a", "accent-ink": "#1a1305", "paper": "#f1e6cf", "paper-ink": "#2a2118"}, "light": {"bg": "#efe8da", "bg2": "#e6dec9", "card": "#fbf7ec", "line": "#d4c9b0", "text": "#2a2118", "muted": "#756a58", "accent": "#b87a10", "accent-ink": "#ffffff", "paper": "#fbf7ec", "paper-ink": "#2a2118"}, "group": "classic"}, {"id": "noir", "name": "Noir", "dark": {"bg": "#0b0b0c", "bg2": "#141416", "card": "#1b1b1e", "line": "#2c2c31", "text": "#f2f2f2", "muted": "#9a9aa2", "accent": "#e8412c", "accent-ink": "#ffffff", "paper": "#ececec", "paper-ink": "#121214"}, "light": {"bg": "#f3f3f4", "bg2": "#e9e9ec", "card": "#ffffff", "line": "#d6d6dc", "text": "#151518", "muted": "#6b6b74", "accent": "#d2321e", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#151518"}, "group": "classic"}, {"id": "forest", "name": "Forest", "dark": {"bg": "#0f1712", "bg2": "#16211a", "card": "#1d2b22", "line": "#2d4034", "text": "#e9f0e4", "muted": "#93a596", "accent": "#c9b23a", "accent-ink": "#141a0a", "paper": "#e9f0e4", "paper-ink": "#1a2a1f"}, "light": {"bg": "#e9efe5", "bg2": "#dde6d7", "card": "#f7faf4", "line": "#c6d3bf", "text": "#1b2a20", "muted": "#5f7064", "accent": "#7a8a13", "accent-ink": "#ffffff", "paper": "#f7faf4", "paper-ink": "#1b2a20"}, "group": "classic"}, {"id": "ocean", "name": "Ocean", "dark": {"bg": "#0d141c", "bg2": "#142030", "card": "#1a2a3d", "line": "#2b4258", "text": "#e6eef5", "muted": "#90a4b8", "accent": "#3cc1b8", "accent-ink": "#06211f", "paper": "#e6eef5", "paper-ink": "#13263a"}, "light": {"bg": "#e7eef3", "bg2": "#dbe5ec", "card": "#f9fbfd", "line": "#c3d2de", "text": "#13263a", "muted": "#5a6f82", "accent": "#0f8f87", "accent-ink": "#ffffff", "paper": "#f9fbfd", "paper-ink": "#13263a"}, "group": "classic"}, {"id": "plum", "name": "Plum", "dark": {"bg": "#17101a", "bg2": "#221826", "card": "#2b1f31", "line": "#44304c", "text": "#f3e8f5", "muted": "#ad9bb3", "accent": "#e07ab0", "accent-ink": "#2a0a1c", "paper": "#f3e8f5", "paper-ink": "#2b1a30"}, "light": {"bg": "#f1e9f3", "bg2": "#e8dcec", "card": "#fcf8fd", "line": "#d8c6dd", "text": "#2b1a30", "muted": "#74607b", "accent": "#b23c7f", "accent-ink": "#ffffff", "paper": "#fcf8fd", "paper-ink": "#2b1a30"}, "group": "classic"}, {"id": "mono", "name": "Mono", "dark": {"bg": "#121212", "bg2": "#1a1a1a", "card": "#222222", "line": "#343434", "text": "#eeeeee", "muted": "#9a9a9a", "accent": "#e6e6e6", "accent-ink": "#111111", "paper": "#eeeeee", "paper-ink": "#111111"}, "light": {"bg": "#f4f4f4", "bg2": "#eaeaea", "card": "#ffffff", "line": "#d4d4d4", "text": "#111111", "muted": "#666666", "accent": "#222222", "accent-ink": "#ffffff", "paper": "#ffffff", "paper-ink": "#111111"}, "group": "classic"}, {"id": "sony", "name": "Sony", "group": "brand", "blurb": "graphite with Alpha orange", "dark": {"bg": "#0f0f10", "bg2": "#171718", "card": "#1f1f21", "line": "#323235", "text": "#f2f2f2", "muted": "#9c9ca2", "accent": "#ff7a1a", "accent-ink": "#1a0d00", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f4f4f5", "bg2": "#eaeaec", "card": "#ffffff", "line": "#d5d5da", "text": "#1a1a1c", "muted": "#66666d", "accent": "#c04f00", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "canon", "name": "Canon", "group": "brand", "blurb": "warm black with Canon red", "dark": {"bg": "#141011", "bg2": "#1d1718", "card": "#261f20", "line": "#3b3032", "text": "#f5efef", "muted": "#a69a9b", "accent": "#e2231a", "accent-ink": "#ffffff", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f7f3f3", "bg2": "#eee6e6", "card": "#ffffff", "line": "#dccfcf", "text": "#241a1a", "muted": "#71615f", "accent": "#c0130b", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "nikon", "name": "Nikon", "group": "brand", "blurb": "black with Nikon yellow", "dark": {"bg": "#121210", "bg2": "#1a1a16", "card": "#23231d", "line": "#383830", "text": "#f4f3ea", "muted": "#a3a194", "accent": "#ffe100", "accent-ink": "#1a1700", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f6f5ec", "bg2": "#ecebdd", "card": "#fffffa", "line": "#d9d7c2", "text": "#201f16", "muted": "#6b6957", "accent": "#d6b400", "accent-ink": "#1a1700", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "fujifilm", "name": "Fujifilm", "group": "brand", "blurb": "deep green, Fuji green accent", "dark": {"bg": "#0f1512", "bg2": "#161f1a", "card": "#1d2922", "line": "#2f4036", "text": "#eef5f0", "muted": "#97a79d", "accent": "#1fbf74", "accent-ink": "#04170c", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#eef4f0", "bg2": "#e1eae4", "card": "#fafdfb", "line": "#c8d8ce", "text": "#162019", "muted": "#5f7066", "accent": "#007a44", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "lumix", "name": "Lumix", "group": "brand", "blurb": "midnight with Panasonic blue", "dark": {"bg": "#0e1220", "bg2": "#161b2c", "card": "#1e2438", "line": "#30395a", "text": "#eef0f8", "muted": "#9aa1bb", "accent": "#4d86ff", "accent-ink": "#031033", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#eef1f8", "bg2": "#e1e6f2", "card": "#fbfcff", "line": "#c9d2e6", "text": "#171b2a", "muted": "#5e6680", "accent": "#0041c0", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "blackmagic", "name": "Blackmagic", "group": "brand", "blurb": "studio grey with a Blackmagic orange", "dark": {"bg": "#131313", "bg2": "#1b1b1b", "card": "#242424", "line": "#373737", "text": "#f1f1f1", "muted": "#9d9d9d", "accent": "#ff8a2b", "accent-ink": "#1c0e00", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f2f2f2", "bg2": "#e8e8e8", "card": "#ffffff", "line": "#d3d3d3", "text": "#1b1b1b", "muted": "#666666", "accent": "#b84f00", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "red", "name": "RED", "group": "brand", "blurb": "true black with RED red", "dark": {"bg": "#0d0d0d", "bg2": "#161616", "card": "#1f1f1f", "line": "#333333", "text": "#f3f3f3", "muted": "#9b9b9b", "accent": "#e5001f", "accent-ink": "#ffffff", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f5f2f2", "bg2": "#ebe5e5", "card": "#ffffff", "line": "#d8cfcf", "text": "#1c1818", "muted": "#6d6262", "accent": "#c0001a", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "arri", "name": "ARRI", "group": "brand", "blurb": "ARRI blue on navy", "dark": {"bg": "#0c1424", "bg2": "#131d31", "card": "#1a2640", "line": "#2c3b5c", "text": "#edf2fa", "muted": "#98a5bf", "accent": "#5aa9ff", "accent-ink": "#02132b", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#edf2f9", "bg2": "#dfe7f3", "card": "#fbfdff", "line": "#c7d3e6", "text": "#141c2c", "muted": "#5b6a85", "accent": "#1f4e9c", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "leica", "name": "Leica", "group": "brand", "blurb": "graphite and the red dot", "dark": {"bg": "#0c0c0c", "bg2": "#151515", "card": "#1e1e1e", "line": "#313131", "text": "#f4f4f4", "muted": "#9a9a9a", "accent": "#e2001a", "accent-ink": "#ffffff", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#f4f4f4", "bg2": "#eaeaea", "card": "#ffffff", "line": "#d4d4d4", "text": "#161616", "muted": "#656565", "accent": "#cf0014", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "gopro", "name": "GoPro", "group": "brand", "blurb": "deep sea blue, GoPro cyan", "dark": {"bg": "#0b1220", "bg2": "#13203a", "card": "#1a2a46", "line": "#2d4466", "text": "#eaf3fb", "muted": "#93aac0", "accent": "#19b0ff", "accent-ink": "#001a2b", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#eaf4fa", "bg2": "#dbe9f3", "card": "#f9fdff", "line": "#c2d7e6", "text": "#12202c", "muted": "#54707f", "accent": "#006fa6", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}, {"id": "dji", "name": "DJI", "group": "brand", "blurb": "cool graphite, silver-blue accent", "dark": {"bg": "#111314", "bg2": "#191c1e", "card": "#212528", "line": "#353b3f", "text": "#eff2f3", "muted": "#9ba5aa", "accent": "#9ec5d6", "accent-ink": "#08181f", "paper": "#f3efe6", "paper-ink": "#24211d"}, "light": {"bg": "#eef1f3", "bg2": "#e1e6e9", "card": "#fbfcfd", "line": "#cbd4d9", "text": "#171c1f", "muted": "#5f6b72", "accent": "#3b6b85", "accent-ink": "#ffffff", "paper": "#fbf9f4", "paper-ink": "#24211d"}}];
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
      h('div', { class: 'theme-list', role: 'radiogroup', 'aria-label': 'Colour theme' }, PALETTES.flatMap((p, i) => [i === 0 && h('div', { class: 'theme-group' }, 'Classic'), p.group === 'brand' && PALETTES[i - 1].group !== 'brand' && h('div', { class: 'theme-group' }, 'Camera brands', h('span', { class: 'twirl-sub' }, 'colours inspired by the brands; not affiliated')), (() => {
        const c = p[resolvedScheme()], on = prefs.palette === p.id;
        return h('button', { type: 'button', class: 'theme-row', role: 'radio', 'aria-checked': on, onclick: () => { prefs.palette = p.id; save(); haptic(); drawTheme(); } },
          h('span', { class: 'swatches', 'aria-hidden': 'true' }, ['bg', 'card', 'accent', 'text'].map(k => h('i', { style: `background:${c[k]}` }))),
          h('span', null, p.name, h('span', { class: 'twirl-sub' }, p.blurb ? p.blurb : p.id === 'brass' ? 'the original: warm dark with amber' : p.id === 'noir' ? 'black, white and record-light red' : p.id === 'forest' ? 'deep greens with a gold accent' : p.id === 'ocean' ? 'navy and teal' : p.id === 'plum' ? 'aubergine and rose' : 'greyscale, no colour at all')),
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

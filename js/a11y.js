// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';

const KEY = 'logi-prefs';
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'reduce', haptics: true, targets: 'normal' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (prefs.motion !== 'full') prefs.motion = 'reduce'; // older saved value 'system' -> reduced

export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.text = prefs.text;
  r.dataset.contrast = prefs.contrast;
  // Full animation is opt-in, and never applies when the device asks for reduced motion.
  r.dataset.motion = prefs.motion === 'full' && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'full' : 'reduce';
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
  ['motion', 'Animation', [['reduce', 'Reduced (recommended)'], ['full', 'Full (spinning tabs)']]],
  ['haptics', 'Vibration feedback', [[true, 'On'], [false, 'Off']]],
];

export function openDisplaySettings() {
  const body = h('div', { class: 'stack' });
  const draw = () => body.replaceChildren(...GROUPS.map(([key, label, opts]) => h('div', { class: 'pref', role: 'group', 'aria-label': label },
    h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', {
      type: 'button', class: prefs[key] === v ? 'on' : '', 'aria-pressed': prefs[key] === v,
      onclick: () => { prefs[key] = v; save(); haptic(); draw(); },
    }, l))))));
  draw();
  body.append(h('p', { class: 'muted small' }, 'Reduced animation removes the spinning tab wheel, page flips and sliding panels, so nothing moves on screen unless you do. Layouts also follow your phone’s font-size and contrast settings.'));
  sheet('Display & accessibility', body);
}

// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';

const KEY = 'logi-prefs';
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'rolodex', haptics: true, targets: 'normal' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (prefs.motion !== 'off') prefs.motion = 'rolodex'; // only the tab bar animates; older saved values map to this

export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.text = prefs.text;
  r.dataset.contrast = prefs.contrast;
  // Only the Rolodex bar animates, and not at all when the device asks for reduced motion.
  r.dataset.motion = prefs.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : 'rolodex';
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
  ['motion', 'Animation', [['rolodex', 'Tab bar only'], ['off', 'None']]],
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
  body.append(h('p', { class: 'muted small' }, 'The spinning Rolodex is the only thing that animates. Choose None to stop it too; it also stops if your phone is set to reduce motion. Layouts follow your phone’s font-size and contrast settings.'));
  sheet('Display & accessibility', body);
}

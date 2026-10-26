// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';

const KEY = 'logi-prefs';
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'system', haptics: true, targets: 'normal' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }

export function applyPrefs() {
  const r = document.documentElement;
  r.dataset.text = prefs.text;
  r.dataset.contrast = prefs.contrast;
  r.dataset.motion = prefs.motion;
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
  ['motion', 'Animation', [['system', 'Follow device'], ['reduce', 'Reduce']]],
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
  body.append(h('p', { class: 'muted small' }, 'Layouts also follow your phone’s own font-size, contrast and reduce-motion settings.'));
  sheet('Display & accessibility', body);
}

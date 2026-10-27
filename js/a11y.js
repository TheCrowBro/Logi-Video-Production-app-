// Display & accessibility preferences, stored on this device only.
import { h, sheet } from './util.js';
import { startTour } from './tour.js';

const KEY = 'logi-prefs';
const DEFAULTS = { text: 'normal', contrast: 'normal', motion: 'soft', haptics: true, targets: 'normal' };
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (!['soft', 'bar', 'off'].includes(prefs.motion)) prefs.motion = 'soft'; // older saved values map to the default

export function applyPrefs() {
  const r = document.documentElement;
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

export function openDisplaySettings() {
  const body = h('div', { class: 'stack' });
  const draw = () => body.replaceChildren(...GROUPS.map(([key, label, opts]) => h('div', { class: 'pref', role: 'group', 'aria-label': label },
    h('div', { class: 'pref-label' }, label),
    h('div', { class: 'seg wide' }, opts.map(([v, l]) => h('button', {
      type: 'button', class: prefs[key] === v ? 'on' : '', 'aria-pressed': prefs[key] === v,
      onclick: () => { prefs[key] = v; save(); haptic(); draw(); },
    }, l))))));
  draw();
  body.append(
    h('div', { class: 'pref' }, h('div', { class: 'pref-label' }, 'Help'), h('button', { class: 'btn ghost', onclick: () => { close(); setTimeout(() => startTour(), 150); } }, '🧭 Take the tour again')),
    h('p', { class: 'muted small' }, '“Small touches” are short, gentle effects: buttons pressing, cards lifting, new notes popping in, the tour spotlight gliding. Nothing slides across the screen. Choose Rolodex only or None to stop them; everything also stops if your phone is set to reduce motion.'));
  const { close } = sheet('Display & accessibility', body);
}

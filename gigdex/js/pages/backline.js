// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const backline = {
  id: 'backline', label: 'Backline', icon: '🎛️',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Backline')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function editGear(g = {}, onSaved) {}
export function editKit(k = {}, onSaved) {}

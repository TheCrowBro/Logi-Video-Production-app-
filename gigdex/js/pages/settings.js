// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const settings = {
  id: 'settings', label: 'Settings', icon: '⚙️',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Settings')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};

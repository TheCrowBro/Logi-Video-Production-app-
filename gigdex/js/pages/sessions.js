// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const sessions = {
  id: 'sessions', label: 'Studio log', icon: '🎙️',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Studio log')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openLog(id) {}
export function newLog(preset = {}) {}

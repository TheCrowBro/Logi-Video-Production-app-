// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const acts = {
  id: 'acts', label: 'Acts', icon: '🎸',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Acts')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openAct(id) {}
export function editAct(a = {}, onSaved) {}
export function printRider(actId) {}

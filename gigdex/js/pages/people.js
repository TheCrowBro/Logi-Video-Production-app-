// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const people = {
  id: 'people', label: 'People', icon: '👥',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'People')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openPerson(id) {}
export function editPerson(p = {}, onSaved) {}

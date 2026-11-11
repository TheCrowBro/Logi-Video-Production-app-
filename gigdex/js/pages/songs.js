// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const songs = {
  id: 'songs', label: 'Songs', icon: '🎼',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Songs')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openSong(id) {}
export function editSong(s = {}, onSaved) {}

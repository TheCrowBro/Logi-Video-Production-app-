// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const venues = {
  id: 'venues', label: 'Venues', icon: '📍',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Venues')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openVenue(id) {}
export function editVenue(v = {}, onSaved) {}
export function venueWarnings(booking) { return []; }

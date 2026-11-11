// STUB: replaced by the page's real module. Keeps the app loading while the page is being built.
import { h } from '../util.js';

export const bookings = {
  id: 'bookings', label: 'Bookings', icon: '📅',
  render(root) { root.append(h('div', { class: 'page-head' }, h('h1', null, 'Bookings')), h('p', { class: 'muted' }, 'Coming soon.')); },
  tutorial: [],
};
export function openBooking(id) { return window.logiGo('bookings'); }
export function newBooking(preset = {}) { return window.logiGo('bookings'); }

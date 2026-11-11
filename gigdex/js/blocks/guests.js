// STUB (show agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'guests', title: 'Guest list', icon: '🎟️', order: 45,
  kinds: ['show'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

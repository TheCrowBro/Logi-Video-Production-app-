// STUB (songs agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'setlist', title: 'Setlist', icon: '🎼', order: 40,
  kinds: ['show', 'rehearsal'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

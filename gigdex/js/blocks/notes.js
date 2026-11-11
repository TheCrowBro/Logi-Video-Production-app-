// STUB (bookings agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'notes', title: 'Notes', icon: '📝', order: 95,
  kinds: ['show', 'session', 'rehearsal', 'other'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

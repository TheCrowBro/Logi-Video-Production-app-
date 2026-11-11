// STUB (bookings agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'lineup', title: 'Line-up & gear', icon: '👥', order: 30,
  kinds: ['show', 'session', 'rehearsal', 'other'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

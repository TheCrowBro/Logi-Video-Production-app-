// STUB (bookings agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'advance', title: 'Advance checklist', icon: '✅', order: 15,
  kinds: ['show', 'session', 'rehearsal'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

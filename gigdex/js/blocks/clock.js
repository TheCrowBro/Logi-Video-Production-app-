// STUB (studio agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'clock', title: 'Session clock', icon: '⏲️', order: 12,
  kinds: ['session', 'rehearsal'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

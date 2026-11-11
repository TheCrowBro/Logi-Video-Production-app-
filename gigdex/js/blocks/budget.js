// STUB (money agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'budget', title: 'Costs', icon: '💸', order: 65,
  kinds: ['show', 'session', 'rehearsal', 'other'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

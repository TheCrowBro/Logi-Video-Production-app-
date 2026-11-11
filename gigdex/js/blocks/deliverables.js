// STUB (studio agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'deliverables', title: 'Deliverables', icon: '📦', order: 55,
  kinds: ['session'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

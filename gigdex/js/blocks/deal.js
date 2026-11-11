// STUB (show agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'deal', title: 'Deal & fee', icon: '🤝', order: 10,
  kinds: ['show'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

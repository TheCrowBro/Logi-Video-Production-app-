// STUB (money agent): replaced by the real block. See docs/developers.md → Booking blocks.
import { h } from '../util.js';

export default {
  id: 'money', title: 'Quote & invoice', icon: '💰', order: 70,
  kinds: ['show', 'session', 'other'],
  summary(b) { return ''; },
  render(b, ctx) { return h('p', { class: 'muted' }, 'Coming soon.'); },
};

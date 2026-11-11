// Every block a booking page can show, in one list (docs/developers.md → Booking blocks). js/pages/bookings.js draws the
// ones whose kinds include the booking's kind, sorted by order.
import lineup from './lineup.js';
import advance from './advance.js';
import notes from './notes.js';
import deal from './deal.js';
import running from './running.js';
import guests from './guests.js';
import settlement from './settlement.js';
import daysheet from './daysheet.js';
import setlist from './setlist.js';
import money from './money.js';
import budget from './budget.js';
import clock from './clock.js';
import takes from './takes.js';
import worksongs from './worksongs.js';
import deliverables from './deliverables.js';

export const BLOCKS = [lineup, advance, notes, deal, running, guests, settlement, daysheet, setlist, money, budget, clock, takes, worksongs, deliverables].sort((a, b) => a.order - b.order);
export const blocksFor = kind => BLOCKS.filter(x => (x.kinds || []).includes(kind));

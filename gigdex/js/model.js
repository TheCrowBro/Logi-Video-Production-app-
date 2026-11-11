// The music domain in one place: the kinds of booking, their statuses, roles, gear categories, deal types, song
// keys, and the pure sums every page agrees on (set lengths, deal and settlement maths, a booking's income). Nothing
// here touches the page or the store's storage; pass records in, get values out. Pages import from here instead of
// keeping their own lists, so a show reads the same on the calendar, the day sheet and the money page.
import { db, byId, update } from './store.js';
import { pad } from './util.js';

/* ------------------------------- bookings ------------------------------- */
// [id, label, icon]. A show is a gig (load-in, soundcheck, doors, set, curfew, a deal); a session is studio time
// (start, end, a rate, songs, takes); a rehearsal is band practice; other is anything else in the diary.
export const KINDS = [['show', 'Show', '🎤'], ['session', 'Studio session', '🎚️'], ['rehearsal', 'Rehearsal', '🥁'], ['other', 'Other', '📌']];
export const kindLabel = k => (KINDS.find(x => x[0] === k) || KINDS[3])[1];
export const kindIcon = k => (KINDS.find(x => x[0] === k) || KINDS[3])[2];

// [id, label, tone]. tone is the pill class suffix (st-hold, st-confirmed, …) styled in styles.css.
export const STATUSES = [
  ['hold', 'Hold', 'hold'], ['offer', 'Offer in', 'offer'], ['confirmed', 'Confirmed', 'confirmed'], ['advanced', 'Advanced', 'advanced'],
  ['done', 'Done', 'done'], ['settled', 'Paid / settled', 'settled'], ['cancelled', 'Cancelled', 'cancelled'],
];
const STATUS_BY_KIND = { show: ['hold', 'offer', 'confirmed', 'advanced', 'done', 'settled', 'cancelled'], session: ['hold', 'confirmed', 'done', 'settled', 'cancelled'], rehearsal: ['hold', 'confirmed', 'done', 'cancelled'], other: ['hold', 'confirmed', 'done', 'cancelled'] };
export const statusesFor = kind => STATUSES.filter(s => (STATUS_BY_KIND[kind] || STATUS_BY_KIND.other).includes(s[0]));
export const statusLabel = s => (STATUSES.find(x => x[0] === s) || ['', s || '—'])[1];
export const statusTone = s => 'st-' + ((STATUSES.find(x => x[0] === s) || [])[2] || 'hold');
export const isLive = b => b && b.status !== 'cancelled'; // counts on the calendar, in clashes and in money

// The times a booking can carry, in the order a day runs. Each is 'HH:MM' or ''.
export const SHOW_TIMES = [['loadIn', 'Load-in'], ['soundcheck', 'Soundcheck'], ['doors', 'Doors'], ['setTime', 'On stage'], ['curfew', 'Curfew']];
export const SESSION_TIMES = [['start', 'Start'], ['end', 'Finish']];
export const timesFor = kind => (kind === 'show' ? SHOW_TIMES : SESSION_TIMES);
// The first time on the day (for sorting a day's bookings and for the calendar line).
export const firstTime = b => (b ? (b.kind === 'show' ? [b.loadIn, b.soundcheck, b.doors, b.setTime] : [b.start]).find(Boolean) || '' : '');
export const lastDate = b => (b.endDate && b.endDate > b.date ? b.endDate : b.date);
export const coversDay = (b, iso) => !!b.date && b.date <= iso && iso <= lastDate(b);

// "Act @ Venue" when no title was typed.
export function bookingTitle(b) {
  if (!b) return '';
  if (b.title) return b.title;
  const act = actName(b.actId) || b.client || '';
  const where = venueOf(b).name;
  return [act, where].filter(Boolean).join(' @ ') || kindLabel(b.kind);
}
export const actName = id => (id && byId('acts', id) ? byId('acts', id).name : '');
// The venue record, or a stand-in built from the booking's own typed name and address.
export function venueOf(b) {
  const v = b && b.venueId ? byId('venues', b.venueId) : null;
  return v || { id: '', name: (b && b.venueName) || '', address: (b && b.address) || '', geo: null };
}

/* ------------------------------- checklists ------------------------------- */
// The built-in checklist lines per kind, each with a stable id: other features tick them by id (the day sheet ticks
// 'show-daysheet' when it is sent, the invoice 'show-invoice' and 'show-paid'…), so the wording can change freely.
// The person's own extra lines live in db.templates[kind] as [{ id, t }]. Ticks live in booking.checks[id] = true.
export const CHECKLISTS = {
  show: [
    ['show-offer', 'Offer, date and deal agreed'], ['show-contract', 'Contract or confirmation in writing'], ['show-deposit', 'Deposit received'],
    ['show-advance', 'Show advanced with the promoter'], ['show-times', 'Load-in, soundcheck and set times confirmed'], ['show-backline', 'PA, backline and input list confirmed'],
    ['show-hospitality', 'Hospitality, parking and guest list agreed'], ['show-travel', 'Travel and accommodation booked'], ['show-promo', 'Show announced and promoted'],
    ['show-setlist', 'Setlist ready'], ['show-daysheet', 'Day sheet sent to the band'], ['show-settled', 'Settled on the night'],
    ['show-invoice', 'Invoice sent'], ['show-paid', 'Paid in full'],
  ],
  session: [
    ['ses-booked', 'Studio and engineer confirmed'], ['ses-prep', 'Demos, lyrics and charts shared'], ['ses-tempo', 'Tempo, key and click agreed'],
    ['ses-players', 'Session players booked'], ['ses-backup', 'Session files backed up (two copies)'], ['ses-deliver', 'Mixes and stems delivered'],
    ['ses-splits', 'Split sheet signed'], ['ses-invoice', 'Invoice sent'], ['ses-paid', 'Paid in full'],
  ],
  rehearsal: [['reh-room', 'Room booked'], ['reh-setlist', 'Setlist shared with the band'], ['reh-gear', 'Who brings what agreed']],
  other: [],
};
// Every line for a kind: the built-in ones, then the person's own. [{ id, t, own }]
export const checklistFor = kind => [...(CHECKLISTS[kind] || []).map(([id, t]) => ({ id, t, own: false })), ...((db.templates && Array.isArray(db.templates[kind]) ? db.templates[kind] : []).filter(x => x && x.id).map(x => ({ id: x.id, t: x.t, own: true })))];
export const isChecked = (b, id) => !!(b && b.checks && b.checks[id]);
// Tick (or untick) a line on a booking. Quiet: no toast. Returns nothing.
export function markCheck(bookingId, id, on = true) {
  const b = byId('bookings', bookingId);
  if (!b || !!(b.checks && b.checks[id]) === !!on) return;
  update(d => { const x = d.bookings.find(r => r.id === bookingId); if (!x) return; x.checks = { ...(x.checks || {}) }; if (on) x.checks[id] = true; else delete x.checks[id]; x.updatedAt = Date.now(); });
}

/* ------------------------------- people & gear ------------------------------- */
export const PEOPLE_GROUPS = [['band', 'Band members'], ['session', 'Session players'], ['crew', 'Crew'], ['contact', 'Industry contacts']];
export const ROLES = ['Vocals', 'Guitar', 'Bass', 'Drums', 'Keys', 'Producer', 'Engineer', 'Mix engineer', 'Mastering engineer', 'Session musician',
  'Tour manager', 'FOH engineer', 'Monitor engineer', 'Backline tech', 'Lighting', 'Merch', 'Driver', 'Promoter', 'Booking agent', 'Manager',
  'Label', 'Publisher', 'Studio manager', 'Photographer / video', 'Other'];
export const GEAR_CATS = ['Guitars', 'Basses', 'Amps & cabs', 'Drums & percussion', 'Keys & synths', 'Pedals & effects', 'Microphones', 'DI & interfaces',
  'Stands & hardware', 'Cables', 'PA & monitors', 'Lighting', 'Computers & software', 'Cases & transport', 'Other'];
export const VENUE_KINDS = [['venue', 'Venue'], ['studio', 'Studio'], ['rehearsal', 'Rehearsal room'], ['festival', 'Festival / outdoor'], ['other', 'Other']];
export const venueKindLabel = k => (VENUE_KINDS.find(x => x[0] === k) || VENUE_KINDS[4])[1];
// A booking's rate (studio time, a session player's job) and a person's usual rate share these units ('show' only for people).
export const RATE_UNITS = [['hour', 'per hour'], ['day', 'per day'], ['song', 'per song'], ['flat', 'flat fee']];
export const PERSON_RATE_UNITS = [['day', 'per day'], ['hour', 'per hour'], ['show', 'per show'], ['song', 'per song']];
export const rateUnitLabel = u => (RATE_UNITS.find(x => x[0] === u) || ['', ''])[1];

/* ------------------------------- songs ------------------------------- */
export const SONG_STATUS = [['idea', 'Idea'], ['writing', 'Writing'], ['demo', 'Demo'], ['recording', 'Recording'], ['mixing', 'Mixing'], ['mastered', 'Mastered'], ['released', 'Released']];
export const songStatusLabel = s => (SONG_STATUS.find(x => x[0] === s) || ['', ''])[1];
export const NOTES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
export const KEYS = [...NOTES.map(n => n + ' major'), ...NOTES.map(n => n + ' minor')];
export const SPLIT_ROLES = ['Writer', 'Composer', 'Lyricist', 'Producer', 'Publisher', 'Performer'];

/* ------------------------------- time & duration ------------------------------- */
// Seconds ⇄ "m:ss" (and "h:mm:ss" past an hour). parseDur reads "3:45", "3.45", "225", "3m45s", "4" (minutes when ≤ 20).
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
export function parseDur(t) {
  const s = String(t ?? '').trim().toLowerCase();
  if (!s) return 0;
  let m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/); if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = s.match(/^(\d+)[:.'](\d{1,2})$/); if (m) return +m[1] * 60 + +m[2];
  m = s.match(/^(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/); if (m && (m[1] || m[2])) return (+m[1] || 0) * 60 + (+m[2] || 0);
  const n = Number(s); if (Number.isFinite(n)) return n <= 20 ? Math.round(n * 60) : Math.round(n);
  return 0;
}
// Minutes → "1h 05m" / "45m".
export const fmtMin = min => { const m = Math.max(0, Math.round(Number(min) || 0)); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
// 'HH:MM' + minutes → 'HH:MM' (wraps past midnight). '' in, '' out.
export function addMinutes(hhmm, min) {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return '';
  const [h, m] = hhmm.split(':').map(Number), t = (((h * 60 + m + Math.round(Number(min) || 0)) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
// Minutes from a to b on the same night ('22:30' → '00:15' is 105).
export const minutesBetween = (a, b) => { if (!a || !b) return null; const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number); return ((bh * 60 + bm - (ah * 60 + am)) % 1440 + 1440) % 1440; };

/* ------------------------------- setlists ------------------------------- */
// A setlist's running time: the songs' lengths plus a gap between songs (not after a segue, not after the last).
export function setlistLength(list) {
  if (!list || !Array.isArray(list.items)) return { sec: 0, songs: 0, missing: 0 };
  const gap = Number.isFinite(Number(list.gap)) ? Number(list.gap) : 20;
  let sec = 0, songs = 0, missing = 0;
  const items = list.items.filter(i => i && !i.isBreak);
  items.forEach((it, i) => {
    const song = it.songId ? byId('songs', it.songId) : null;
    const d = Number(it.duration) || (song && Number(song.duration)) || 0;
    if (!d) missing++;
    sec += d; songs++;
    if (i < items.length - 1 && !it.segue) sec += gap;
  });
  return { sec, songs, missing };
}
export const itemTitle = it => (it && it.songId && byId('songs', it.songId) ? byId('songs', it.songId).title : (it && it.title) || 'Untitled');

/* ------------------------------- deals & settlement ------------------------------- */
// deal = { type, fee, pct, ticketPrice, capacity, expenses, deposit, depositPaid }
export const DEAL_TYPES = [['guarantee', 'Guarantee (flat fee)'], ['door', 'Door split (% of the door)'], ['versus', 'Guarantee vs % (whichever is more)'], ['plus', 'Guarantee + % after break-even'], ['none', 'No fee (showcase, charity)']];
const num = v => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : 0);
// Rounded to the cent first, so a door split of 1889.9999… reads $1,890.
export const fmtMoney = (n, sym = currency()) => { const v = Math.round(Number(n) * 100) / 100; if (!Number.isFinite(v)) return '—'; const neg = v < 0; const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: Math.abs(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }); return (neg ? '−' : '') + sym + s; };
export const currency = () => (db.profile && db.profile.currency) || '$';

// What a deal pays at a given door. gross = tickets × price. Promoter expenses come off the gross before a split.
//   guarantee: the fee.   door: pct of (gross − expenses).   versus: the larger of the fee and pct of the net.
//   plus: the fee, plus pct of whatever the gross makes above break-even (expenses + fee).   none: nothing.
export function dealPays(deal = {}, gross = 0) {
  const fee = num(deal.fee), pct = num(deal.pct) / 100, exp = num(deal.expenses), net = Math.max(0, gross - exp);
  switch (deal.type) {
    case 'door': return net * pct;
    case 'versus': return Math.max(fee, net * pct);
    case 'plus': return fee + Math.max(0, gross - exp - fee) * pct;
    case 'none': return 0;
    default: return fee;
  }
}
export function dealSummary(deal, sym = currency()) {
  if (!deal || !deal.type) return '';
  const fee = fmtMoney(num(deal.fee), sym), pct = `${num(deal.pct)}%`, after = num(deal.expenses) ? ` after ${fmtMoney(num(deal.expenses), sym)} costs` : '';
  return { guarantee: `${fee} guarantee`, door: `${pct} of the door${after}`, versus: `${fee} vs ${pct}${after}`, plus: `${fee} + ${pct} after break-even`, none: 'No fee' }[deal.type] || '';
}
// The deal at a full house: the most it can pay.
export const dealBest = deal => dealPays(deal, num(deal && deal.ticketPrice) * num(deal && deal.capacity));

// The night's settlement. b.settlement = { tickets, comps, merch: [{ item, start, end, price, comps }], merchTotal,
// costs: [{ desc, amount }], received, shares: { personId: weight } }. Every figure is a number (0 when unknown).
export function settle(b) {
  const deal = (b && b.deal) || {}, s = (b && b.settlement) || {};
  const tickets = num(s.tickets), price = num(deal.ticketPrice);
  const gross = tickets * price;
  const fee = deal.type ? dealPays(deal, gross) : 0;
  const deposit = num(deal.deposit), depositPaid = !!deal.depositPaid;
  const merchLines = Array.isArray(s.merch) ? s.merch : [];
  const merchCounted = merchLines.reduce((t, m) => t + Math.max(0, num(m.start) - num(m.end) - num(m.comps)) * num(m.price), 0);
  const merch = merchLines.length ? merchCounted : num(s.merchTotal);
  const nightCosts = (Array.isArray(s.costs) ? s.costs : []).reduce((t, c) => t + num(c.amount), 0);
  const budget = (Array.isArray(b && b.budget) ? b.budget : []).reduce((t, c) => t + num(c.amount), 0);
  const costs = nightCosts + budget;
  const owedOnNight = Math.max(0, fee - (depositPaid ? deposit : 0));
  const received = s.received === '' || s.received == null ? null : num(s.received);
  const short = received == null ? 0 : Math.max(0, owedOnNight - received);
  const income = fee + merch;
  const profit = income - costs;
  // Payouts: the profit shared between the people on the booking by weight (1 each unless set).
  const ids = (Array.isArray(b && b.people) ? b.people : []).filter(id => byId('people', id));
  const weights = ids.map(id => Math.max(0, num((s.shares || {})[id] ?? 1)));
  const total = weights.reduce((a, c) => a + c, 0);
  const payouts = ids.map((id, i) => ({ personId: id, weight: weights[i], amount: total ? Math.round((profit * weights[i] / total) * 100) / 100 : 0 }));
  return { tickets, price, gross, fee, deposit, depositPaid, owedOnNight, received, short, merch, costs, nightCosts, budget, income, profit, payouts };
}

// Studio time: the rate times the hours, days or songs. hours comes from the session clock when kept.
export function sessionFee(b, hours) {
  const rate = num(b && b.rate);
  switch (b && b.rateUnit) {
    case 'hour': return rate * num(hours != null ? hours : sessionHoursPlanned(b) * Math.max(1, daysSpan(b))); // planned: every day of a block of studio days
    case 'day': return rate * Math.max(1, daysSpan(b));
    case 'song': return rate * Math.max(1, (b.songIds || []).length);
    default: return rate;
  }
}
export const sessionHoursPlanned = b => { const m = minutesBetween(b && b.start, b && b.end); return m == null ? 0 : m / 60; };
export const daysSpan = b => (b && b.date ? Math.round((Date.parse(lastDate(b)) - Date.parse(b.date)) / 864e5) + 1 : 1);

// What a booking brings in (before costs and tax), for the money page and the calendar: what its invoice bills when it
// has one (not void), else a show's deal (at the counted door when settled, else at the guarantee) or a session's fee;
// nothing for a cancelled booking.
export function bookingIncome(b) {
  if (!isLive(b)) return 0;
  const inv = b.invoice;
  if (inv && inv.status !== 'void' && Array.isArray(inv.lines) && inv.lines.length) return Math.round(inv.lines.reduce((t, l) => t + num(l && l.qty) * num(l && l.price), 0) * 100) / 100;
  if (b.kind === 'show') return b.settlement && b.settlement.tickets ? settle(b).fee : dealPays(b.deal || {}, 0);
  if (b.kind === 'session') return sessionFee(b);
  return num(b.fee);
}

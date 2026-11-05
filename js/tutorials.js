// Page tutorials: the ? button at the top runs a short walkthrough of whatever is on screen, highlighting each box
// with a one-line description. Steps whose box is not on screen (an empty list, a hidden tool) are skipped, so the
// same tutorial fits a fresh install and a full one. "Other pages…" opens any page's tutorial from anywhere.
import { h, sheet, toast, ymd, todayISO, uid } from './util.js';
import { runTour, startTour, resumeTourAt } from './tour.js';
import * as store from './store.js';
import * as lock from './lock.js';
import * as providers from './providers.js';
import { connectCalendar } from './calendar.js';

const T = (title, text, ...rest) => { const opts = rest.length && typeof rest[rest.length - 1] === 'object' ? rest.pop() : {}; return { title, text, target: rest, ...opts }; };
const tab = n => () => { const b = document.querySelector(`.tc-views button:nth-child(${n})`); if (b) b.click(); };
const topSheet = () => { const all = document.querySelectorAll('.sheet'); return all[all.length - 1] || document; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// A card with no box to point at: a short read between the highlighted steps.
const C = (title, text) => ({ title, text, target: null });
const clickQ = sel => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; };
const closeSheet = () => { const all = document.querySelectorAll('.sheet'); const top = all[all.length - 1]; if (top) top.querySelector('.sheet-tools button:last-child')?.click(); };
const closeSheets = async () => { for (let i = 0; i < 4 && document.querySelector('.sheet'); i++) { closeSheet(); await wait(120); } };
const toLogs = async () => { await closeSheets(); if (document.querySelector('.tc-log-head')) clickQ('.tc-log-head .btn.ghost.small'); };
const openPractice = async () => { await closeSheets(); const m = await import('./pages/tcnotes.js'); m.openPracticeLog(); await wait(300); };
const openSyncSheet = async () => { await closeSheets(); await wait(100); clickQ('.tc-head .card-row .btn'); };
const openWork = () => { const d = document.querySelector('#bk-work'); if (d) d.open = true; };
const openLinkSheet = async () => { await closeSheets(); await wait(100); clickQ('.tc-log-head .actions button:nth-child(1)'); };
const openExportSheet = async () => { await closeSheets(); await wait(100); clickQ('.tc-log-head .actions button:nth-child(2)'); };
const backToNotes = async () => { await closeSheets(); tab(1)(); };

/* ------------------------------- setting up ------------------------------- */
// The first-run walkthrough does things as well as pointing: cards with a form save on Next, the calendar card
// connects, and two sample people are added to try the Crew page on. Settings → General → About & Licence runs it again.
const SAMPLES = [
  { id: 'sample-talent', name: 'Sample talent', role: 'Talent', phone: '+1 555 0101', email: 'talent@example.com', rate: 300, rateUnit: 'day', notes: 'Added by the set-up walkthrough to show how the Crew page works. Remove when you like: ✎ then Delete.', sample: true },
  { id: 'sample-crew', name: 'Sample crew member', role: 'Camera Operator', phone: '+1 555 0102', email: 'crew@example.com', rate: 450, rateUnit: 'day', notes: 'Added by the set-up walkthrough to show how the Crew page works. Remove when you like: ✎ then Delete.', sample: true },
];
const addSamples = () => { for (const x of SAMPLES) if (!store.byId('crew', x.id)) store.upsert('crew', x); };
const removeSamples = () => { for (const x of SAMPLES) if (store.byId('crew', x.id)) store.remove('crew', x.id); };
const samplesPresent = () => SAMPLES.some(x => store.byId('crew', x.id));
// A card with fields of the profile: what is typed is saved when the card is left with Next (or Enter).
const profileStep = (title, text, fields) => {
  let box = null;
  const input = ([label, key, type = 'text', extra = {}]) => h('label', { class: 'tour-field' }, h('span', null, label), h('input', { type, value: store.db.profile[key] || '', 'data-key': key, 'aria-label': label, autocomplete: 'off', ...extra }));
  return { title, text, target: null,
    body: () => { box = h('div', { class: 'tour-fields' }, ...fields.map(input)); return box; },
    onNext: () => { if (!box) return; const p = store.db.profile, patch = {}; box.querySelectorAll('input[data-key]').forEach(i => { const v = i.value.trim(); if ((p[i.dataset.key] || '') !== v) patch[i.dataset.key] = v; }); if (Object.keys(patch).length) store.update(d => { d.profile = { ...d.profile, ...patch, updatedAt: Date.now() }; }); } };
};
const revealSetting = title => async () => { await closeSheets(); const m = await import('./pages/settings.js'); m.reveal(title); };
// The calendar card: connect Google or Microsoft from the card itself (a sign-in has to start from a tap), with the
// licence note for the live feed when this device has no licence. Next skips it; Settings → Calendar & email later.
const calendarStep = () => {
  const paid = store.isPaid();
  const text = `Two-way sync keeps a “Vdex bookings” calendar in your Google or Microsoft account: bookings go there, and changes made there come back. Connect now, or tap Next to skip this and do it later under Settings → Calendar & email. Apple Calendar and other apps take a calendar file (Export once) or follow the live feed${paid ? '.' : ', which keeps a file in your cloud storage. Cloud storage comes with a Vdex licence (20 USD once, for up to 3 of your devices): Buy and Sign in are under Settings → General → About & Licence.'}`;
  const choice = (ctx, svc, name) => {
    const on = providers.signIn.available(svc === 'google' ? 'google-calendar' : svc);
    return h('div', { class: 'card-row' },
      h('div', { class: 'grow' }, h('strong', null, name), !on && h('div', { class: 'small muted' }, `Not ready yet: sign-in for ${name} is still being set up for this copy of Vdex.`)),
      h('button', { class: 'btn primary small', type: 'button', disabled: !on, 'aria-label': `Connect ${name}`, onclick: async e => {
        e.target.disabled = true; e.target.textContent = 'Connecting…';
        if (svc === 'microsoft') resumeTourAt(ctx.index); // Microsoft signs in on its own page and comes back: carry on here
        try { await connectCalendar(svc); toast(`${name} connected`); } catch (err) { toast(err.message || 'Could not connect'); }
        resumeTourAt(null); ctx.refresh();
      } }, 'Connect'));
  };
  return { title: 'Your calendar', text, target: ['#page details[data-s="Calendar & email"]'], go: 'settings', before: revealSetting('Calendar & email'),
    body: ctx => { const cs = store.db.calSync || {};
      return cs.provider ? h('p', { class: 'status-line', 'data-state': 'synced' }, `${cs.provider === 'google' ? 'Google Calendar' : 'Outlook / Microsoft 365'} is connected. Sync now and Disconnect are under Settings → Calendar & email.`)
        : h('div', { class: 'stack tour-cal' }, choice(ctx, 'google', 'Google Calendar'), choice(ctx, 'microsoft', 'Outlook / Microsoft 365')); },
    footer: !paid ? stop => h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { stop(); const m = await import('./pages/settings.js'); await m.openSettingsSection('About & Licence'); } }, 'Licence…') : null };
};
const setupSteps = () => [
  C('Welcome to Vdex', 'Your whole production in one deck: bookings, crew, kit, venues, insurance, field tools and timecode notes. This set-up takes about three minutes: a look at the deck, your details, your calendar, and two sample people to try things on. Next moves on, and Skip leaves at any point; Settings → General → About & Licence → Take the tour runs it again.'),
  C('Your PIN', (lock.enabled() ? 'Vdex is locked with the PIN you just set' : 'Vdex locks with a PIN') + ', and everything it stores on this device is encrypted whenever it is locked, in the background or closed. A forgotten PIN cannot be recovered: the way back is to erase the device and restore from your cloud storage or a backup, so keep one of those current. Settings → Security sets when it locks, adds fingerprint or face unlock, and has a switch to erase this device after 10 wrong PINs, which stays off unless you turn it on.'),
  T('The Rolodex', 'Spin it to move between sections: drag it, tap ▲ ▼, use the arrow keys, or scroll on it. It slides away as a page scrolls down and comes back as you scroll up.', '.binder', '#rolodex', { go: 'bookings' }),
  C('What is in the deck', 'Bookings holds the calendar and, for each shoot, the call sheet, the stripboard, the crew link, the hours, the quote and the invoice. Crew, Equipment, Venues and Insurance are your lists. Me is your contact card. Field has the sun, Polaris, white balance, noise and range tools. TC Notes stamps notes with the camera’s timecode. Settings has the rest. Tap ? at the top of any page for that page’s own walkthrough.'),
  profileStep('You', 'Your name and business go on call sheets, quotes and invoices, and on your contact card. Type them here and tap Next.', [['Full name', 'name'], ['Business name', 'business']]),
  profileStep('How clients reach you', 'Phone and email go on your documents and your contact card, and the crew link shows them to the people on your shoots.', [['Phone', 'phone', 'tel'], ['Email', 'email', 'email']]),
  profileStep('Your website', 'Your site, showreel or portfolio goes on the contact card with a QR code anyone can scan, and on your documents. A job title, where you are based and a short bio can be added later under Settings → General → Profile.', [['Website', 'website', 'text', { inputMode: 'url', placeholder: 'https://…' }]]),
  T('Where they live', 'Settings → General → Profile holds everything you just entered, and the Me section shows it as a contact card with a QR code.', '#page details[data-s="Profile"]', { go: 'settings', before: revealSetting('Profile') }),
  calendarStep(),
  T('Two sample people', 'Sample talent and Sample crew member were just added to your Crew list, so you can see how it works: a role, a day or hourly rate, phone and email, and the bookings they are on. A booking picks its crew from this list, and their rates price the quote.', '.crew-card[data-id="sample-talent"]', '.crew-card', { go: 'crew', before: addSamples }),
  T('Removing someone', 'Tap ✎ on a card to edit the person; Delete at the bottom of the form removes them, and Vdex asks once to be sure.', '.crew-card[data-id="sample-talent"] .icon-btn', '.crew-card .icon-btn'),
  { title: 'Keep the samples?', text: 'Sample talent and Sample crew member stay on the Crew page until you remove them: ✎ then Delete, or the button here. That is the set-up done. Tap ? at the top of any page for its walkthrough, and Other pages… on its first card for any other.', target: null,
    body: ctx => h('div', { class: 'actions tour-done' }, samplesPresent()
      ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { removeSamples(); toast('Samples removed'); ctx.refresh(); } }, '🗑 Remove the samples')
      : h('span', { class: 'small muted' }, 'The samples have been removed.')) },
];

/* ------------------------------ quotes and invoices, start to finish ------------------------------ */
// A beginner's course on a practice job Vdex makes, so nothing touches the real numbering (its documents are
// numbered Q-PRACTICE and INV-PRACTICE, which the numbering ignores). The hooks make the quote, send and accept it,
// make the invoice from it and record a payment, so each card shows the real thing at that point.
const PRACTICE = 'practice-booking';
const practiceJob = () => store.byId('bookings', PRACTICE) || store.db.bookings.find(b => b.practice) || null;
const plus = n => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
function makePracticeJob() {
  if (!practiceJob()) store.upsert('bookings', { id: PRACTICE, practice: true, title: 'Practice job (delete when done)', client: 'Sample client', type: 'corporate', date: plus(7), start: '09:00', end: '17:00', status: 'Enquiry', address: '1 Example Street', stakeholders: [{ id: 'sample-client', name: 'Sam Client', role: 'Producer', phone: '', email: 'client@example.com' }], crew: [], gear: [], deliverables: [{ id: 'sample-deliverable', name: 'Main film, 16:9', duration: '90 s', due: plus(30), status: 'Planned', link: '' }], notes: 'Made by the quotes and invoices walkthrough. Delete this booking when you are done: Edit, then Delete at the bottom.' });
  return practiceJob();
}
const toPracticeJob = async (patch = {}) => { await closeSheets(); if (!makePracticeJob()) return; await window.logiGo?.('bookings'); await wait(200); const m = await import('./pages/bookings.js'); m.openBooking(PRACTICE, patch); await wait(400); };
const patchPractice = fn => store.update(d => { const x = d.bookings.find(y => y.id === PRACTICE) || d.bookings.find(y => y.practice); if (x) { fn(x); x.updatedAt = Date.now(); } });
async function ensurePracticeQuote() {
  const m = await import('./money.js'), b = practiceJob(); if (!b || b.quote) return;
  const bl = m.billing();
  // Suggested from the booking, as the button does; prices the rates leave blank get example figures.
  const lines = m.suggestLines(b, 'quote', 'booking').map(l => ({ ...l, price: l.price === '' || l.price == null ? (/shoot day/i.test(l.desc) ? 600 : 120) : l.price }));
  patchPractice(x => { x.quote = { number: 'Q-PRACTICE', date: todayISO(), until: plus(30), lines, taxRate: Number(bl.taxRate) || 0, taxLabel: bl.taxLabel || 'Tax', notes: 'Example quote from the walkthrough. Includes one shoot day and the edit of the main film.', status: 'Draft', deposit: '' }; });
}
async function ensurePracticeInvoice() {
  const m = await import('./money.js'), b = practiceJob(); if (!b || !b.quote) return;
  if (!b.invoice) patchPractice(x => { x.invoice = { number: 'INV-PRACTICE', date: todayISO(), due: plus(14), lines: (x.quote.lines || []).map(l => ({ ...l, id: uid() })), taxRate: x.quote.taxRate, taxLabel: x.quote.taxLabel, notes: m.billing().terms || '', status: 'Draft', deposit: '', payments: [] }; });
  if ((practiceJob().invoice || {}).status === 'Draft') m.setDocStatus(PRACTICE, 'invoice', 'Sent');
}
const quoteState = async status => { const m = await import('./money.js'), b = practiceJob(); if (b && b.quote && b.quote.status !== status) m.setDocStatus(PRACTICE, 'quote', status); };
async function recordHalf() {
  const m = await import('./money.js'), b = practiceJob(); if (!b || !b.invoice || (b.invoice.payments || []).length) return;
  const t = m.totals(b.invoice);
  patchPractice(x => { x.invoice.payments = [{ id: uid(), date: todayISO(), amount: Math.round(t.total * 50) / 100, method: '', note: 'Practice payment' }]; });
}
const moneyView = kind => async () => { await closeSheets(); await window.logiGo?.('bookings'); await wait(150); const m = await import('./pages/bookings.js'); m.openBooking(PRACTICE, { view: 'money', kind }); await wait(400); };
const practiceRemover = ctx => h('div', { class: 'actions tour-done' }, practiceJob()
  ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => { store.remove('bookings', PRACTICE); toast('Practice job removed'); (await import('./pages/bookings.js')).showMonth(); ctx.refresh(); } }, '🗑 Remove the practice job')
  : h('span', { class: 'small muted' }, 'The practice job has been removed.'));

export const TUTORIALS = {
  setup: { name: 'Set up Vdex', page: null, hidden: true, dynamic: setupSteps },
  around: { name: 'Getting around', page: null, steps: [
    T('The Rolodex', 'Spin it to move between sections: drag or swipe it, tap ▲ ▼, or use the arrow keys on a keyboard.', '.binder', '#rolodex'),
    T('The top bar', 'Aa sets text size, theme and accessibility. ☁ links your cloud storage and shows the sync state. 🔒 appears once a PIN is set and locks Vdex at once. ⤓ installs the app.', '.top-actions'),
    T('This button', 'Tap ? on any page for its tutorial. The first card has “Other pages…” to read about a page you are not on.', '#helpBtn'),
    T('The running clock', 'While the clock runs, this strip shows the time on every page: stop work or take a timed break from anywhere. Start it in the Hours box of the booking.', '#clockbar:not([hidden])'),
  ] },
  bookings: { name: 'Bookings calendar', page: 'bookings', steps: [
    T('Your calendar', 'Every booking on its days; today is outlined, multi-day shoots span their dates, and edit days show in their own colour. Tap a day to open it.', '.bk-month .cal-panel', '.bk-month .cal'),
    T('Month to month', 'Previous, next, and Today.', '.bk-month .cal-nav'),
    T('New bookings', '+ New starts a blank booking. From template fills one in from a project template you made, with its kit, crew, deliverables and schedule.', '.bk-month .page-head .actions', '.bk-month .page-head'),
    T('Tools for all your shoots', 'Pipeline shows every project by stage. Call sheets lists each shoot’s sheet. Money has quotes and invoices. Hours & statistics and Calendar & email do what they say.', '.bk-month .bk-tiles', '.bk-month .subactions'),
    T('Next up', 'The next few shoots: tap one to open it, or press and hold it for three seconds to delete it.', '.bk-month h3 + .list', '.bk-month .list', '.bk-month .empty'),
  ] },
  day: { name: 'A day', page: 'bookings', steps: [
    T('The day', 'Step to the previous or next day; ‹ Calendar goes back to the month.', '.cal-nav'),
    T('Sun and weather', 'Sunrise, sunset and golden hour for your location, with the forecast when the day is within two weeks.', '.sunline', '.wxline'),
    T('Bookings that day', 'Tap one to open it, or press and hold it for three seconds to delete it. Add another with + New or From template.', '.list', '.empty'),
  ] },
  booking: { name: 'A booking', page: 'bookings', steps: [
    T('The booking', 'Project, client, dates, times and address, with Add to calendar, Share calendar event and Email. Edit changes the details, including the edit days that show on the calendar in their own colour. Press and hold this box for three seconds to delete the booking.', '.bk-detail .card.hero'),
    T('Call sheet, stripboard and crew link', 'Call sheet opens this shoot’s sheet. Stripboard & shot list breaks the shoot down scene by scene into shooting days and keeps the shot list. Share with crew makes a read-only page for your cast and crew, with the times, location, who is on and the shot list, and never any prices or budgets.', '.bk-detail .bk-tools'),
    T('Hours', 'The clock for this job: Start work on the day (on an edit day, or any other day, the hours count as editing), Stop work, timed breaks against the approved allowance, and the total so far with overtime. While it runs, a strip under the Rolodex repeats it on every page.', '#bk-hours'),
    T('Templates', 'Save as template turns a job that went well into a template; Apply template items adds anything a template still has to offer.', '.bk-detail .bk-tools-more'),
    T('Weather and sun', 'The forecast for the day within two weeks, and sunrise, sunset and golden hour at the venue.', '.bk-detail .wx-card'),
    T('Workflow, budget, quote and invoice', 'One box for the project’s progress and its money. Closed, the line shows the budget, the quote, the invoice and the stage at a glance; open it for the checklists and the documents.', '#bk-work > summary'),
    T('Stages', 'Every project moves Enquiry → Quoted → Confirmed → Prepped → Shot → In post → Delivered → Archived. Tap a stage to move it; the checklist underneath belongs to the current stage.', '.bk-detail .stage-strip', { before: openWork }),
    T('The checklist', 'Tick things off one by one, or Check all for the whole stage; add your own lines, and tap an arrow to open the tool a line is about. When a stage is complete, Next moves the project on, and once every stage is done Vdex asks whether to archive the project.', '.bk-detail .checklist', { before: openWork }),
    T('Budget', 'What the job will cost you, line by line, in categories you pick from a list. Fill from booking adds your crew and hired people at their rates, your rentals and your licences. It compares with the quote, and only you see it.', '#bk-budget', { before: openWork }),
    T('Money', 'The quote and the invoice for this booking.', '#bk-money', { before: openWork }),
    T('Venue', 'The venue’s rules, access, parking and map, with a warning if your kit breaks a rule.', '#bk-venue'),
    T('People', 'The client’s contacts, your crew with their call times and confirmations, and anyone hired in for the job. Hired people go on the call sheet and the crew link like crew, and their cost into the budget. Long lists fold after five.', '#bk-people'),
    T('Stripboard & shot list', 'Where the board stands, and the shot list to tick off on the day. Import a shot list and its scene headings fill the board as well: check what it guessed.', '#bk-shots'),
    T('Equipment', 'The kit on this shoot, grouped by category, with a warning when an item is also booked elsewhere, and the items rented in with who they come from. Save the set as a kit for next time.', '#bk-kit'),
    T('Media & backups', 'One row per card: tick as it reaches drive 1, drive 2, offsite and verified. A card can only be cleared once it is on two drives.', '#bk-media'),
    T('Deliverables', 'What the client gets, with due dates that appear in your calendar, status and links.', '#bk-deliverables'),
    T('Licences', 'Music and stock licences kept with the project.', '#bk-licences'),
  ] },
  strips: { name: 'Stripboard & shot list', page: 'bookings', steps: [
    T('The stripboard', 'One strip per scene, in shooting order: the scene number, interior or exterior and the time of day, the set, what happens, the cast numbers and the pages in eighths.', '.sb-page .sb-board'),
    T('The shot list', 'The same shot list as on the booking, under the board: tick shots off on the day, and import a list to fill the board from its scene headings.', '#sb-shots'),
    T('Scenes from the script', 'Pick a Word, Fountain or text script and each scene heading becomes a strip, with its speaking cast and an estimated page count. ＋ Scene adds one by hand, ＋ Banner a line such as a company move, ＋ Day a shooting day.', '.sb-page .sb-tools'),
    T('Colours', 'As on a paper board: white interior day, yellow exterior day, blue interior night, green exterior night.', '.sb-page .sb-legend'),
    T('Move strips', 'Drag a strip by its ⠿ handle, or focus the handle and use the up and down arrow keys. Tap a strip to edit it or send it to a day.', '.sb-page .sb-handle'),
    T('Shooting days', 'Each black strip ends a day and adds up its pages and scenes; anything below the last one is not scheduled yet. ⚖ Spread over the days shares the pages out evenly; ↕ groups the unscheduled scenes by location.', '.sb-page .sb-break'),
    T('Print and share', 'Print makes a one-line-per-scene schedule with the cast list. The call sheet and the crew link show each day’s scenes.', '.sb-page .sb-tools2'),
  ] },
  callsheet: { name: 'Call sheet', page: 'bookings', steps: [
    T('Edit the sheet', '‹ Booking goes back. Edit sheet turns the document’s fields into boxes you can type in; Done saves a new version.', '.cs-page .page-head'),
    T('State', 'Draft, sent, or changed since it was sent, with the version number. Mark as sent when it has gone out another way.', '.cs-page .status-line'),
    T('Send it', 'Print uses this device’s print dialog; Save PDF makes a file for the share sheet; Email crew is addressed to everyone on the shoot; Share, Web page and Copy text cover the rest.', '.cs-page .actions'),
    T('Forecast', 'The weather for the shoot day at the venue. Add to call sheet puts it on the sheet so it prints.', '.cs-page .wxline'),
    T('The sheet', 'Built from the booking, venue, crew and hired people, kit and rentals, and the sun for the day, plus everything you add in Edit sheet: call times, the schedule, who is on set, dress code, emergency contact and instructions.', '.cs-page .cs-paper'),
  ] },
  money: { name: 'Quote and invoice', page: 'bookings', steps: [
    T('Quote or invoice', 'Each booking has one of each; switch here. A tick means it exists.', '.money-page .seg'),
    T('State and total', 'Draft, sent, accepted or paid, the total, and overdue when an invoice passes its due date unpaid.', '.money-page .status-line'),
    T('Build it', 'Edit the lines by hand, or add suggested lines: from the booking (shoot days, crew at their day or hourly rates, kit, deliverables), from your price list, from the quote, or from the hours logged. Mark as sent, accepted or paid ticks the pipeline.', '.money-page .actions'),
    T('Send it', 'Print, Save PDF, Email client (to the contacts on the booking), Share, Web page, Copy text.', '.money-page .actions ~ .actions'),
    T('Get paid', 'Link for the client opens the document as a web page with Pay buttons for the balance; record payments as they arrive, and send a reminder when an invoice is overdue. Your PayPal, Venmo, Cash App, payment page, UPI and bank details live under Settings → Work & billing → Quotes & invoices.', '.money-page .pay-actions'),
    T('The document', 'Your details from Settings → General → Profile, the client, the lines, tax and totals, the terms, and on an invoice the Pay buttons, bank details and a bank QR code from Settings → Work & billing → Quotes & invoices.', '.money-page .cs-paper'),
    T('Start one', 'From the booking suggests the lines at your rates; From the price list adds the lines you tick; an invoice can also start from the quote or from the hours logged; or start blank.', '.money-page .stack .actions'),
  ] },
  moneycourse: { name: 'Quotes & invoices, start to finish', page: 'bookings', course: true, steps: [
    C('Quotes and invoices, start to finish', 'About five minutes, on a practice job that Vdex makes for you, so nothing touches your real numbering. Next moves on, Back re-reads, Skip leaves at any point, and the last card removes the practice job.'),
    C('How it works', 'Every booking has one quote and one invoice. A quote goes Draft → Sent → Accepted (or Declined); an invoice Draft → Sent → Paid. Marking the quote sent ticks the Quoted stage of the project’s checklist; marking the invoice sent and then paid ticks the Delivered stage. Numbers run on from the prefixes you set.'),
    T('Your rates, once', 'Day rate, hour rate for editing, overtime, and the equipment package per day. They price the lines Vdex suggests; each crew member’s own rate is on their card on the Crew page.', '#page details[data-s="Quotes & invoices"] .grid2', { go: 'settings', before: revealSetting('Quotes & invoices') }),
    T('Tax, numbering and terms', 'The tax name and rate, the number prefixes and where numbering starts, how long quotes stay valid, when invoices fall due, and the payment terms printed on every invoice.', '#page details[data-s="Quotes & invoices"] .grid2 ~ .grid2'),
    T('Your price list', 'The things you charge for again and again, with your prices, to tick into a quote or an invoice: a filming day, a drone day, colour grading, rush delivery. It starts from typical rates where you work; change any price to yours.', '#page details[data-s="Quotes & invoices"] .price-list-btn'),
    T('Getting paid', 'Add the ways you like to be paid. Every invoice then carries a Pay button for each one with a link, your bank details with a QR code, and your own instructions.', '#page details[data-s="Quotes & invoices"] .pay-methods'),
    T('The practice job', 'A booking Vdex just made for this walkthrough: next week, for a sample client. Its workflow, budget, quote and invoice live in this one box; closed, the line shows them at a glance.', '#bk-work > summary', { before: () => toPracticeJob() }),
    T('Quote and invoice rows', 'One row each at the bottom of the box: the number, the state and the total, with Open, or Create when there is none yet.', '#bk-money', { before: openWork }),
    T('The quote', 'Made from the booking, as ＋ From the booking does: a line per shoot day at your day rate, each crew member at theirs, the kit, and the deliverables. On the practice job the prices are examples. Quote or Invoice switches here; a tick means it exists.', '.money-page .seg', { before: async () => { await ensurePracticeQuote(); await moneyView('quote')(); } }),
    T('State and total', 'Draft for now, with the total. It becomes Sent, Accepted or Declined as you mark it.', '.money-page .status-line'),
    T('Change it', 'Edit opens every line, the tax rate, the status and the notes. The ＋ buttons add lines: from the booking, from your price list, or from the hours logged.', '.money-page .actions'),
    T('Send it', 'Print, Save PDF, Email client (to the contacts on the booking), Share, Web page or Copy text. Then Mark as sent, and the Quoted stage ticks itself.', '.money-page .actions ~ .actions'),
    T('Sent, then accepted', 'Marked sent, the quote waits in the Money overview as quoted and awaiting. When the client says yes, ✅ Accepted records it.', '.money-page .status-line', { before: () => quoteState('Sent') }),
    T('The client’s link', 'Link for the client opens the document as a web page, with Pay buttons on an invoice. Copy it, share it or email it; the link holds the document itself, so there is no server in between.', '.money-page .pay-actions'),
    T('Now the invoice', 'The Invoice tab. With the quote accepted, start the invoice From the quote; From hours logged bills the days and hours the clock recorded; From the booking suggests again.', '.money-page .stack .actions', { before: async () => { await quoteState('Accepted'); await moneyView('invoice')(); } }),
    T('The invoice', 'Made from the quote: the same lines, due in 14 days (Settings sets the days), and already marked sent. It counts as invoiced and unpaid until the money arrives; past its due date it shows overdue, and Send a reminder emails the client with the link.', '.money-page .status-line', { before: ensurePracticeInvoice }),
    T('Record a payment', 'As money arrives, Record a payment: the date, the amount and how it came. A part payment shows the balance; the last one marks the invoice Paid, and the Delivered stage ticks itself.', '.money-page .pay-actions'),
    T('Payments received', 'Half of the practice invoice was just recorded as paid: the list shows each payment, and the status line the balance still due.', '.money-page .pay-list', { before: recordHalf }),
    T('The document', 'Your details from Settings → General → Profile, the client from the booking, the lines, tax and totals, the terms, and on an invoice the Pay buttons and bank details.', '.money-page .cs-paper'),
    T('The Money overview', 'Bookings → Money: what is invoiced and unpaid, overdue, quoted and awaiting, and paid this year, with every booking that has a quote or an invoice, and a spreadsheet of the invoices for the accountant.', '.sheet .stats', { before: async () => { await closeSheets(); const m = await import('./money.js'); m.openMoney(() => {}); await wait(300); } }),
    { title: 'Tidy up', text: 'That is the whole loop: rates once, the quote from the booking, send and accept, the invoice from the quote, payments and reminders. The practice job can go now, with the button here, or later from its page: Edit, then Delete. Your own numbering was not touched.', target: null, before: closeSheets, body: practiceRemover },
  ] },
  crew: { name: 'Crew', page: 'crew', steps: [
    T('Your crew', 'The freelancers you work with. + Add creates a person with their role, phone, email, a day or hourly rate, and a link to their work.', '#crew .page-head', '.page-head'),
    T('Find someone', 'Search by name or role.', '#crew .search', '.search'),
    T('Filter by role', 'Tap a role to see only those people.', '#crew .chips', '.chips'),
    T('A person', 'Call, text or email them from here, see their work, and which of your bookings they are on.', '.crew-card'),
  ] },
  gear: { name: 'Equipment', page: 'gear', steps: [
    T('Items and kits', 'Items is everything you own. Kits are named sets of gear for the shoots you do most; tick a kit on a booking to load its gear.', '.seg[role=tablist]'),
    T('Asset register', 'Exports everything with serial numbers, values, warranty and last service: for the insurer, and for the police if kit goes missing.', '.subactions'),
    T('Due for service', 'Items whose service is overdue or whose warranty is about to end.', '#page .warn'),
    T('Totals', 'How many items, what they are worth, and how many are booked ahead.', '.stats'),
    T('Find an item', 'Search by name, serial number or place; the chips filter by category, and the 📍 chips by where things are.', '.search', '.chips'),
    T('An item', 'Quantity, serial, value, where it is and which shoots it is booked on. Tap the 📍 place to move it (loading the van, lending a lens, off to the repair shop). 🔧 opens its service log; ✎ edits it (service interval, warranty, firmware).', '.gear-card'),
    T('Service log', 'Services, cleans, calibrations, repairs and firmware updates, with dates and costs. Set a service interval and Vdex reminds you.', 'button[aria-label^="Service log for"]'),
    T('Kits', 'Each kit lists its gear and notes. New kit makes one; a booking can also be saved as a kit.', '#page .list .card'),
  ] },
  venues: { name: 'Venues', page: 'venues', steps: [
    T('Places you shoot', '+ Add saves a venue: address, map pin, contact, equipment rules, permit needs, access, parking, power and the nearest hospital.', '#venues .page-head', '.page-head'),
    T('Find a venue', 'Search by name or address.', '#venues .search', '.search'),
    T('A venue', 'Tap one for its map, rules and details. Bookings at a venue warn when your kit breaks a rule, and the call sheet carries its access notes.', '#venues .list', '.list'),
    T('Map', 'Opens directions in your maps app.', '.minimap'),
    T('Equipment rules', 'What is allowed, needs approval or is not allowed here: tripods, lighting, haze, drones…', '.perm-chips'),
    T('Details', 'Permits and insurance, access and logistics, contact. Edit to change them, and note when the rules were last confirmed.', '.kv.card'),
  ] },
  insurance: { name: 'Insurance', page: 'insurance', steps: [
    T('Your policies', '+ Add stores a policy: type, provider, number, cover, premium, renewal date, claims line and a link to the document.', '#insurance .page-head', '.page-head'),
    T('Cover at a glance', 'Policies, premiums per year, and the value of the kit you logged.', '.stats'),
    T('Under-insured?', 'A warning when your equipment cover is below the value of the kit you own.', '#page .warn'),
    T('A policy', 'Renewal date, cover, the claims line to call, and the document.', '#page .list .card'),
  ] },
  me: { name: 'Me', page: 'me', steps: [
    T('Your card', 'Name, business, title and where you are based, as entered under Settings → General → Profile; your details also go on call sheets, quotes and invoices.', '.id-card'),
    T('QR code', 'Contact hands over your card; Website opens your site. Anyone can scan it with their camera.', '#me .seg', '.seg'),
    T('The code', 'Tap Save .vcf to share your contact file instead.', '.qr'),
    T('Contact lines', 'Phone and email, tappable.', '#me .card.kv', '.card.kv'),
  ] },
  field: { name: 'Field tools', page: 'field', steps: [
    T('Five tools', 'Sun and golden hour, Polaris, white balance, noise meter and range finder.', '.seg.tools'),
    T('Location', 'Use GPS, or type a place, for the sun and Polaris tools. Saved under Settings → Field tool defaults.', '.loc-actions', '#field .card'),
    T('The tool', 'Sun: times, direction and a slider through the day; aim the phone to find it. Polaris: where it is tonight. WB: a rough colour temperature. Noise: a sound level, calibrate it once. Range: AR on Android, the tilt method anywhere.', '.tool-body'),
    T('Live readings', 'Numbers update as you move the phone.', '.readouts'),
    T('Accuracy', 'Phones estimate; the warning says how far to trust each tool.', '#page .warn'),
  ] },
  tccourse: { name: 'Timecode, start to finish', page: 'tcnotes', course: true, steps: [
    C('Timecode, start to finish', 'About five minutes, on a practice log that Vdex creates for you, so you can try every part without a camera. Delete the practice log afterwards from its ⚙ settings. Next moves on, Back re-reads, Skip leaves at any point.'),
    C('What timecode is', 'A camera stamps every frame with a running clock: hours, minutes, seconds and frames, like 01:04:22:15, and the editor sees the same stamp on the footage. If your notes carry the camera’s timecode, “the good take” or “plane overhead” is one search away in the edit, however many cards and cameras there were.'),
    C('Free run or record run', 'Free run: the camera’s clock always counts, like a wall clock, even between takes. Most documentary, event and corporate work. Record run: it counts only while recording, so each take carries on from where the last one stopped; common on drama, and the default on some cameras. Vdex handles both, but it must know which: check the camera’s timecode menu.'),
    C('Frame rate', 'Pick the camera’s timecode frame rate, which is not always the sensor or project rate: 23.976 for most mirrorless and cinema cameras shooting 24p, 25 in PAL regions, 29.97 for NTSC broadcast. 29.97 and 59.94 come in drop frame (DF, shown with a semicolon) and non-drop; the camera menu says which. A wrong rate makes stamps drift by a few seconds every hour.'),
    T('Start a log', '+ New log: one per camera and per shoot day. Name it clearly (job, day, camera), set the frame rate and the mode to match the camera, and tie it to the booking. The practice log for this walkthrough is already in the list.', '#page .page-head .actions .btn.primary', { before: toLogs }),
    T('Your logs', 'Each card shows the date, the frame rate, the camera and how many notes it holds; the green pill means it is synced. Tap one to open it. Logs travel with your cloud storage, so a laptop linked to the same storage sees them too.', '#page .list'),
    T('Inside a log', 'The header: ‹ Logs goes back, 🔗 links another device, Export shares the notes, and ⚙ opens the log’s settings: frame rate, mode, whether each take is logged, and delete.', '.tc-log-head', { before: openPractice }),
    T('Sync', 'Once per log, Vdex has to learn what the camera’s clock says. That is Sync (Re-sync once it is done). The next four steps go through the sheet it opens.', '.tc-head .card-row .btn'),
    T('What the phone thinks', 'When a log is already synced, the top of the sheet shows the timecode the phone expects the camera to show right now. Hold the phone next to the camera and compare. A difference of a second or more means drift: sync again.', '.sheet .tc-live', { before: openSyncSheet }),
    T('Recording right now?', 'Record run only. Tick it if the camera is rolling while you sync, so the phone counts from the moment you tap; leave it unticked if the camera is stopped and holding a timecode.', '.sheet label.check.card'),
    T('Type what the camera shows', 'Read the camera’s timecode display, type it, and tap Sync at the exact moment the display shows that value. A trick: type the next round number, say 01:05:00:00, and tap Sync as the camera reaches it. Being a second out matters; the frame does not.', '.sheet .row-edit'),
    T('Or scan the display', 'Use camera turns on the phone’s camera. Point it at the camera’s timecode display and tap Scan: the reading is taken at the instant you tap and the digits are worked out afterwards, so a slow read never puts you out. The text reader downloads once, so do that with a connection, and check the digits before you accept them.', '.sheet .tc-cam-btn', '.sheet .tc-cam', '.sheet .cam-wrap'),
    T('Start again', 'Clear sync forgets the sync. Re-sync after a battery change, after the camera has been off, or whenever the comparison at the top looks out.', '.sheet .tc-clear'),
    T('The clock', 'Back on the log: the camera’s timecode as the phone follows it, frame by frame. Dashes mean not synced yet. In record run it holds still between takes.', '.tc-clock', { before: closeSheets }),
    T('State', 'The frame rate, the mode, and when and how the sync was done: by hand or by camera scan. In record run it names the take that is recording.', '.tc-head > .muted.small'),
    C('Roll and cut', 'In record run the log shows ● Roll and ■ Cut. Tap Roll as the camera starts and Cut as it stops: the clock pauses between takes and each take is logged as a note with its length, so the editor gets a take list for free. The practice log is free run, so they are not shown here.'),
    T('Take a note', 'Type what you see: “plane overhead”, “great take”, “boom in shot”. The timecode is captured the moment you start typing, not when you finish, so the stamp is the moment you noticed it. Enter adds the note.', '.tc-composer', { before: backToNotes }),
    T('Mark now', '⏺ Mark now drops a stamp with no words for a fast moment; tap the note later to add the text. Next note at shows the stamp the next note will get.', '.tc-composer .card-row'),
    T('Your notes', 'In timecode order. Tap the text to edit it, the timecode to correct it (a note taken before syncing says unsynced and can be fixed here), and a quoted line to jump to that spot in the script.', '.tc-notes'),
    T('The script', 'Add the script and tap any line, or press and hold to select words, to pin a stamp to it. Word documents, Google Docs (downloaded as Word, or shared to Vdex on Android), plain text and Fountain all work, and Try a sample script shows how.', '.script', '#page .tc-pane .empty', { before: tab(2) }),
    T('Mark a line', 'What you selected shows here with the live timecode. Mark stamps it; Mark + note stamps it with a note. The badge on the line shows its stamp; tap it to read the note.', '.sc-bar'),
    T('Replace or remove', 'The script’s name and counts. Replace swaps the document and keeps your notes and their quotes.', '.sc-head'),
    T('Link a laptop', 'Two devices, one log: show a code on one, scan it on the other, then scan the reply. Same Wi‑Fi or hotspot, no internet, no account. Their clocks are measured against each other, so stamps agree to a few milliseconds. Typing on a laptop while the phone sits by the camera is the comfortable set-up.', '.sheet .actions.center', '.sheet .link-code', '.sheet .link-state', { before: openLinkSheet }),
    T('Export for the editor', 'Share as text for anyone, or as a spreadsheet (CSV) with the timecode, the note, the script line and the time it was captured, which an editor turns into markers.', '.sheet .sheet-body', { before: openExportSheet }),
    T('Log settings', '⚙ changes the frame rate, free or record run, whether each take is logged as a note, and deletes the log. The practice log can go once you are done.', '.tc-log-head .actions .icon-btn', { before: closeSheets }),
    C('On set, in order', '1. A new log per camera, matching its frame rate and mode. 2. Sync next to the camera; re-check after lunch and battery changes. 3. Notes as things happen; Mark now for fast moments. 4. Record run: Roll and Cut with the camera. 5. Script marks for scripted work. 6. Export the CSV for the editor the same evening, while it is fresh.'),
    C('When something looks wrong', 'Stamps a few seconds out: the frame rate is wrong or the camera drifted; fix the rate in ⚙ and re-sync. The clock shows dashes: not synced yet. Notes say unsynced: they were taken before the sync; tap their timecode to correct them. Two cameras: one log each, synced separately. Phone and laptop disagree: link them. The 📖 Guide on the logs page goes into all of it.'),
  ] },
  tcnotes: { name: 'Timecode notes: your logs', page: 'tcnotes', steps: [
    T('One log per camera or day', '+ New log starts one: name it (camera, card, day), pick the frame rate, say whether the camera’s timecode is free run (always counting) or record run (counts only while recording), and tie it to a booking.', '#page .page-head .actions .btn.primary', '#page .page-head'),
    T('Link device', 'Pairs this phone with a laptop on the same Wi‑Fi or hotspot, with no internet or account. One shows a code, the other scans it, then they swap. While linked, the open log, its sync, Roll/Cut and every note stay identical on both.', '#page .page-head .actions button:first-child'),
    T('The idea', 'Sync the phone to the camera’s timecode once. After that every note is stamped with the camera’s timecode the moment you start typing, ready for the edit.', '#page .page-head + p', '#page p.muted.small'),
    T('Your logs', 'Each card shows when it was made, its frame rate, whether it is synced and how many notes it holds. Tap one to open it. Logs travel with your cloud storage like everything else.', '#page .list', '#page .empty'),
  ] },
  tclog: { name: 'Timecode notes: a log', page: 'tcnotes', steps: [
    T('Link, export, settings', '🔗 links another device so you both write on this log. Export shares the notes as text or a spreadsheet. ⚙ changes the log’s frame rate, free run or record run, and whether each take is logged as a note.', '.tc-log-head .actions'),
    T('Sync', 'Once per log: tap Sync and match the camera, by typing the timecode it shows or by scanning its display. Re-sync after a battery change or if the camera was reset.', '.tc-head .card-row .btn'),
    T('The clock', 'The camera’s timecode as this phone follows it, drop-frame aware. Dashes mean not synced yet. In record run it holds between takes.', '.tc-clock'),
    T('State', 'Frame rate, mode, and when and how it was synced, by hand or by camera scan. In record run it says which take is recording.', '.tc-head > .muted.small'),
    T('Roll and cut', 'Record run only. Tap Roll as the camera rolls and Cut as it stops: the clock pauses between takes and each take is logged with its length.', '.rollcut'),
    T('Notes or script', 'Switch between your notes and the script. On a wide screen they sit side by side.', '.tc-views', { before: tab(1) }),
    T('Take a note', 'The timecode is captured the moment you start typing, not when you finish, so the stamp is the moment you saw it. Enter adds the note. ⏺ Mark now drops a stamp with no text for a fast moment; type the words later.', '.tc-composer'),
    T('Your notes', 'Tap a note’s text to edit it, its timecode to correct it, and a quoted line to jump to where it sits in the script. Notes sync to a linked device and to your cloud storage.', '.tc-notes'),
    T('The script', 'Add a Word file, paste text, or try the sample. Then mark it: tap a line, or press and hold to select words, and Mark pins a stamp to that spot.', '.script', '.tc-pane .empty', '#page .empty', { before: tab(2) }),
    T('Replace or remove', 'The script’s name, how many lines and marks it has, and Replace or Remove. Replacing keeps your notes and their quotes.', '.sc-head', { before: tab(2) }),
    T('Mark a line', 'What you selected shows here with the live timecode. Mark stamps it; Mark + note stamps it with a note.', '.sc-bar', { before: tab(2) }),
    T('Back to the notes', 'Everything you mark on the script also appears in the notes list, with its quote.', '.tc-views', { before: tab(1) }),
    T('More walkthroughs', 'Tap ? inside the Sync, Link device, Add script and Export sheets for their own steps.', '.tc-log-head .actions'),
  ] },
  tcsync: { name: 'Timecode: syncing', page: null, sheet: true, steps: [
    T('What the phone thinks', 'If this log is already synced, this is the timecode the phone expects the camera to show right now. Compare them, and re-sync if it has drifted.', '.tc-live'),
    T('Recording right now?', 'Record run: tick if the camera is rolling as you sync; leave it unticked if the camera is stopped and holding its last timecode.', 'label.check.card'),
    T('Type it', 'Read the camera’s display, type the timecode, and tap Sync at the exact instant the camera shows that value. A second out matters; the frame does not.', '.row-edit'),
    T('Scan it', 'Use camera, point the phone at the camera’s timecode display and tap Scan: the reading is taken the moment you tap, so a slow read does not put you out. The text reader downloads once, so do that with a connection.', '.tc-cam', '.cam-wrap'),
    T('Start again', 'Clear sync forgets the sync so you can redo it.', '.tc-clear'),
  ] },
  tclink: { name: 'Timecode: linking devices', page: null, sheet: true, steps: [
    T('A direct link', 'Phone to laptop on the same Wi‑Fi or hotspot, with no internet and no account. The link ends when either side closes the app; your cloud copy carries on regardless.', '.sheet-body p.small.muted'),
    T('Two scans', 'Show a code on one device. On the other tap Scan a code and scan it; it shows a reply; scan the reply with the first device. No camera on a laptop? Copy the code and paste it on the other side.', '.actions.center', '.link-code'),
    T('Linked', 'The clocks are measured against each other, so timecode stamps agree to a few milliseconds. The open log, its sync, Roll/Cut and every note stay identical on both. Unlink stops it.', '.link-state[data-s=connected]'),
  ] },
  tcimport: { name: 'Timecode: adding a script', page: null, sheet: true, steps: [
    T('Word document', 'A .docx from Word or Pages, a Google Doc downloaded as Word, or plain text and Fountain files. Each line becomes a tappable paragraph.', '.card'),
    T('Google Docs', 'Google does not let an app read a Doc directly: download it as Word, share it to Vdex from the Docs app on Android, or copy and paste the text here.', '.card ~ .card'),
    T('Try a sample', 'A short sample script, to see how marking works.', '.tc-sample'),
    T('What was found', 'The lines Vdex read. Use this script loads them; replacing a script keeps your notes and their quotes.', '.import-preview'),
  ] },
  tcexport: { name: 'Timecode: exporting notes', page: null, sheet: true, steps: [
    T('Text or spreadsheet', 'Share as text for anyone, or as a spreadsheet (CSV) with the timecode, the note, the script line and the time it was captured, for the edit suite.', '.sheet-body'),
  ] },
  settings: { name: 'Settings', page: 'settings', dynamic: () => {
    const blurbs = { 'General': 'Display and accessibility, your profile, and About & Licence: open it to see the three.', 'Work & billing': 'Project and workflow templates, quotes and invoices, hours and breaks.', 'Storage, sync & backups': 'Link one cloud storage and every device shares one database; below it, export and import backups, restore an automatic cloud backup, load sample data, erase everything.', 'Security': 'A PIN, fingerprint or face unlock, and encrypted data whenever Vdex is locked or in the background.', 'Calendar & email': 'Send bookings to your calendar once, subscribe to a live feed, or keep a two-way sync.', 'Display & accessibility': 'Text size, bigger buttons, contrast, animation and the colour theme, including camera-brand themes.', 'Field tool defaults': 'Your location, units, range-finder camera height and noise-meter calibration.', 'Hours & breaks': 'Standard day, break notifications, default approved break.', 'Quotes & invoices': 'Your rates, price list, tax, numbering, payment terms and bank details.', 'Project templates': 'Your own job types: what a new booking of that kind starts with.', 'Workflow templates': 'The checklists for each job type and each stage.', 'Profile': 'Your name, business and contact details for call sheets, quotes, invoices and the Me page: the one place to change them.', 'Install': 'Add Vdex to your home screen or desktop.', 'About & Licence': 'Version, updates, your licence, the tour and the legal pages.' };
    // Groups first, then the sections inside each (the group is opened so they can be pointed at), then the rest.
    // Looked up when the step runs, not when the steps were made: a redraw in between replaces every section.
    const openUp = sel => () => { const live = document.querySelector(sel); for (let p = live && live.parentElement && live.parentElement.closest('details'); p; p = p.parentElement && p.parentElement.closest('details')) p.open = true; };
    return [...document.querySelectorAll('#page details.settings-group, #page details.settings-section')].map(el => {
      const title = el.dataset.s || el.querySelector(':scope > summary .ss-title')?.textContent || 'Section';
      const inGroup = !!(el.parentElement && el.parentElement.closest('details.settings-group'));
      const sel = `#page details[data-s="${title.replace(/"/g, '')}"]`;
      return { title, text: blurbs[title] || 'Open the section to see its settings.', target: [sel + ' > summary'], before: inGroup ? openUp(sel) : undefined };
    });
  } },
};

// Which tutorial fits what is on screen.
export function currentContext() {
  const q = s => !!document.querySelector(s);
  const page = (window.logiPage && window.logiPage()) || 'bookings';
  const sheets = document.querySelectorAll('.sheet[aria-label]'), title = sheets.length ? sheets[sheets.length - 1].getAttribute('aria-label') : '';
  const bySheet = { 'Sync timecode': 'tcsync', 'Link another device': 'tclink', 'Add script': 'tcimport', 'Replace script': 'tcimport', 'Export notes': 'tcexport' }[title];
  if (bySheet) return bySheet;
  if (page === 'bookings') return q('.money-page') ? 'money' : q('.cs-page') ? 'callsheet' : q('.sb-page') ? 'strips' : q('.bk-detail') ? 'booking' : q('.bk-month') ? 'bookings' : 'day';
  if (page === 'tcnotes') return q('.tc-log-head') ? 'tclog' : 'tcnotes';
  return TUTORIALS[page] ? page : 'around';
}
export const stepsFor = key => { const t = TUTORIALS[key]; return t.dynamic ? t.dynamic() : t.steps; };
// The set-up walkthrough (the first-run tour, and Take the tour again): remembered as seen when it ends.
export function openSetup(from = 0) {
  const steps = stepsFor('setup');
  return runTour(steps, { remember: true, from, footer: (n, stop) => (steps[n] && steps[n].footer ? steps[n].footer(stop) : null) });
}

export function openTutorial(key = currentContext()) {
  const t = TUTORIALS[key]; if (!t) return;
  const steps = stepsFor(key);
  if (!steps.length) return toast('Nothing to show here yet');
  runTour(steps, { root: t.sheet ? topSheet : null, footer: (n, stop) => n === 0 && !t.sheet && [h('button', { class: 'btn ghost small', onclick: () => { stop(); openChooser(); } }, 'Other pages…'), key.startsWith('tc') && h('button', { class: 'btn ghost small', onclick: () => { stop(); openTcGuide(); } }, '📖 Guide'), (key === 'money' || key === 'moneycourse') && h('button', { class: 'btn ghost small', onclick: () => { stop(); openMoneyGuide(); } }, '📖 Guide')] });
}

// Reaches a page (and, for a booking, a call sheet or money, the first booking) before running its tutorial.
async function reach(key) {
  const t = TUTORIALS[key];
  if (t.page) { await window.logiGo?.(t.page); await wait(650); }
  if (key === 'tcnotes' && document.querySelector('.tc-log-head')) { click('.tc-log-head .btn.ghost.small'); await wait(300); }
  if (key === 'tclog' && !document.querySelector('.tc-log-head')) { if (!click('#page .list .card.tap')) { toast('Create a log first with + New log, then tap ? inside it.'); return false; } await wait(350); }
  const click = sel => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; };
  if (['booking', 'callsheet', 'money', 'day', 'strips'].includes(key)) {
    // from wherever the Bookings page is, go to the month view first
    for (let i = 0; i < 3 && !document.querySelector('.bk-month'); i++) { if (!(click('.cs-page .page-head button') || click('.money-page .page-head button') || click('.sb-page .page-head button') || click('.bk-detail .page-head button') || click('button.btn.ghost.small'))) break; await wait(300); }
    if (key === 'day') { click('.bk-month .cal .day.today') || click('.bk-month .cal .day.has') || click('.bk-month .cal .day'); await wait(300); return true; }
    if (!(click('.bk-month h3 + .list .card.tap') || click('.bk-month .list .card.tap'))) { toast('Add a booking first, then open this tutorial from the booking.'); return false; }
    await wait(350);
    if (key === 'callsheet') { click('.bk-tools button'); await wait(350); }
    if (key === 'strips') { click('.bk-tools .sb-open'); await wait(600); }
    if (key === 'money') { click('#bk-money button'); await wait(350); }
  }
  return true;
}
export function openChooser() {
  let close = () => {};
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'A short walkthrough of any page. Each one highlights the boxes on that page with a line about what they do.'),
    h('div', { class: 'list' }, ...Object.entries(TUTORIALS).filter(([, t]) => !t.sheet && !t.hidden).map(([key, t]) => h('button', { class: 'card tap', type: 'button', onclick: async () => { close(); if (await reach(key)) openTutorial(key); } }, h('strong', null, t.name)))),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => { close(); openTcGuide(); } }, '📖 Timecode guide'), h('button', { class: 'btn ghost small', onclick: () => { close(); openMoneyGuide(); } }, '📖 Quotes & invoices guide'), h('button', { class: 'btn ghost small', onclick: () => { close(); startTour(); } }, '🧭 The set-up walkthrough again')));
  ({ close } = sheet('Tutorials', body));
}

/* ------------------------------ the timecode guide ------------------------------ */
// A read-through of the whole job, for the section new users find hardest. Opened from the 📖 button on the
// timecode page, from the tutorials chooser, and from the timecode walkthroughs.
const GUIDE = [
  ['What timecode is, and why notes need it', ['A camera stamps every frame with a running clock: hours, minutes, seconds and frames, written 01:04:22:15. The editor sees that same stamp on every clip. A note that carries the camera’s timecode therefore points at an exact frame, on any card from any camera, months later.', 'Vdex does not touch the camera. It learns what the camera’s clock says once (the sync), follows it on the phone, and stamps every note with it.']],
  ['Before the shoot', ['One log per camera and per shoot day. Name it so it still makes sense in a year: job, day, camera.', 'Frame rate: the camera’s timecode rate, from its timecode menu, which is not always the recording rate. Most mirrorless and cinema cameras shooting 24p use 23.976; PAL regions use 25; NTSC broadcast uses 29.97. 29.97 and 59.94 come in drop frame (DF, written with a semicolon, 01:04:22;15) and non-drop; the camera menu says which.', 'Mode: free run means the clock always counts, like a wall clock, even between takes; record run means it counts only while recording. Documentary, event and corporate work is usually free run; drama and some camera defaults are record run. On most cameras this lives under a menu called Timecode, TC/UB or TC Setup, as TC Run or Run Mode.', 'A wrong rate or mode is the usual cause of stamps that drift: 23.976 taken as 24 drifts about 3.6 seconds every hour.']],
  ['Syncing', ['Tap Sync on the log. Type the timecode the camera shows and tap Sync at the exact moment it shows that value, or point the phone at the camera’s display and tap Scan. A trick for typing: enter the next round number, say 01:05:00:00, and tap as the camera reaches it. Being a second out matters; the frame does not.', 'The scan takes its reading at the instant you tap, then works out the digits, so a slow read never puts you out. It downloads the text reader the first time, so do that with a connection. Check the digits it read before accepting them.', 'In record run, tick Recording right now? if the camera is rolling while you sync; leave it unticked if the camera is stopped and holding a timecode.', 'Once synced, the sheet shows the timecode the phone expects the camera to show. Compare them now and then, and after lunch, battery changes or the camera being switched off: a second or more of difference means re-sync.', 'Several cameras: one log each, each synced to its own camera. If the cameras are jam-synced to one timecode generator, one sync serves them all; keep a log per camera anyway, for the editor’s sake.']],
  ['During the shoot', ['Type what you see, as it happens: “plane overhead”, “great take”, “boom in shot”. The stamp is taken the moment you start typing, not when you finish, so it is the moment you noticed it. Enter adds the note.', '⏺ Mark now drops a stamp with no words for a fast moment; add the words later by tapping the note.', 'Record run: tap ● Roll as the camera starts and ■ Cut as it stops. The clock pauses between takes and each take is logged with its length.', 'Tap a note’s text to edit it, its timecode to correct it, a quoted line to jump to the script. Notes taken before the sync say unsynced; correct them by hand from the camera’s display.']],
  ['Scripts', ['Add the script to mark lines rather than describe them. Word documents (.docx), plain text and Fountain files open directly; a Google Doc is downloaded as Word, shared to Vdex from the Docs app on Android, or pasted as text. Try a sample script shows how it works.', 'Tap a line, or press and hold to select words, then Mark to stamp it or Mark + note to stamp it with a note. The badge on the line shows its stamp. Replacing the script keeps the notes and their quotes.']],
  ['A phone and a laptop together', ['Link device on both: one shows a code, the other scans it, then they swap. Same Wi‑Fi or hotspot, no internet, no account. The clocks are measured against each other, so stamps from either device agree to a few milliseconds. A laptop without a camera uses Copy code and paste instead.', 'While linked, the open log, its sync, Roll and Cut and every note stay identical on both. The comfortable set-up: the phone by the camera for syncing and quick marks, the laptop for typing.']],
  ['After the shoot', ['Export shares the notes as text for anyone, or as a spreadsheet (CSV) with the timecode, the note, the script line and the time of day it was captured. Editors turn the CSV into markers in their editing software, or simply search it. Send it the same evening, while it is fresh.', 'Logs travel with your cloud storage like everything else in Vdex, so they are on your computer too.']],
  ['When something looks wrong', ['Stamps are a few seconds out: the frame rate or mode is wrong, or the camera drifted. Fix the rate in ⚙ and re-sync.', 'The clock shows dashes: the log is not synced yet.', 'Notes say unsynced: they were taken before the sync. Tap their timecode to correct them.', 'The phone and the laptop disagree: link them, or sync each to the camera separately.', 'Drop-frame confusion: a timecode with a semicolon is drop frame; set the log to the DF rate and type the semicolon, or let the scan read it.', 'A practice log, with a sync, a few notes and the sample script, lets you try all of this without a camera: Walk me through it below makes one.']],
];
export function openTcGuide() {
  let close = () => {};
  const body = h('div', { class: 'stack tc-guide-body' },
    h('p', { class: 'small muted' }, 'Everything about timecode notes in one read, in the order of a shoot day. Five minutes.'),
    ...GUIDE.map(([head, paras]) => h('section', null, h('h3', null, head), ...paras.map(t => h('p', null, t)))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: async () => { close(); if (await reach('tccourse')) openTutorial('tccourse'); } }, '🎓 Walk me through it'),
      h('button', { class: 'btn ghost', onclick: async () => { close(); const m = await import('./pages/tcnotes.js'); m.openPracticeLog(); } }, '🧪 Open the practice log')));
  ({ close } = sheet('Timecode guide', body));
}

/* ------------------------------ the quotes and invoices guide ------------------------------ */
// The same read-through for money: opened from the Money page, the tutorials chooser and the money walkthroughs.
const MONEY_GUIDE = [
  ['How quotes and invoices work', ['Every booking has one quote and one invoice, under Money in the box that also holds its workflow and budget. A quote goes Draft → Sent → Accepted or Declined; an invoice Draft → Sent → Paid, or Void. The numbers run on from the prefixes and starting numbers under Settings → Work & billing → Quotes & invoices, and nothing is sent anywhere until you send it.', 'Marking a quote sent ticks the Quoted stage of the project checklist; marking the invoice sent, and then paid, ticks the Delivered stage. So the money and the workflow keep each other honest.']],
  ['Before the first quote', ['Set your rates once: the day rate, the hour rate for editing, overtime, and the equipment package per day. They price the lines Vdex suggests. Each crew member’s own rate, per day or per hour, lives on their card on the Crew page and prices the crew lines; an hourly rate is quoted for a standard day’s hours per shoot day.', 'Then the tax name and rate, how long quotes stay valid, when invoices fall due, and the payment terms printed on every invoice. Add the ways you like to be paid, so invoices carry Pay buttons, bank details and a QR code.', 'The price list is for the things you charge for again and again: a filming day, a drone day, colour grading, a music licence, rush delivery. It starts from typical freelance rates where you work; change any price to yours, and add your own lines.']],
  ['Making the quote', ['Open the booking, open the Workflow, budget, quote & invoice box, and tap Create next to Quote. ＋ From the booking suggests the lines: a line per shoot day at your day rate, each crew member and hired person at theirs, the equipment package, and the deliverables. ＋ From the price list adds the lines you tick. Edit anything: descriptions, quantities, units, prices, the tax rate, the notes.', 'Save it as a draft. The total, the tax and the validity date are worked out for you.']],
  ['Sending it, and what happens next', ['Print it, Save PDF, or Email client, which addresses the contacts on the booking. Share, Web page and Copy text cover everything else. Link for the client opens the quote as a web page; the link holds the document itself, so there is no server in between.', 'Then Mark as sent. The quote now counts as quoted and awaiting in the Money overview. When the client agrees, ✅ Accepted records it; if not, Edit lets you mark it Declined.']],
  ['From quote to invoice', ['Switch to the Invoice tab on the same page. ＋ From the quote copies the accepted lines; ＋ From hours logged bills the shoot days, editing hours and overtime the clock recorded, at your rates; ＋ From the booking suggests again. A deposit already paid goes in the Already paid field.', 'Mark as sent when it has gone out. The due date comes from your Invoices due in setting; past it, unpaid, the invoice shows overdue everywhere.']],
  ['Getting paid', ['Every invoice carries a Pay button for each way to pay that has a link (PayPal, Venmo, Cash App, a payment page, UPI), with the balance and the invoice number filled in, plus bank details with a QR code and your own instructions. The client’s link shows the same buttons on the web page.', 'As money arrives, tap Record a payment: the date, the amount and how it came. Part payments show the balance still due; the last one marks the invoice Paid, or tap ✅ Paid in full.']],
  ['Late payers', ['An invoice past its due date shows overdue on the booking, in the overview and in a reminder at start-up. Send a reminder opens an email to the client with the link and the balance. Change the due date with Edit if you agreed more time.']],
  ['The overview, and the accountant', ['Bookings → 💰 Money shows what is invoiced and unpaid, overdue, quoted and awaiting, and paid this year, and lists every booking that has a quote or an invoice. Invoices (CSV) exports them as a spreadsheet for the accountant, with a licence.']],
];
export function openMoneyGuide() {
  let close = () => {};
  const body = h('div', { class: 'stack tc-guide-body money-guide-body' },
    h('p', { class: 'small muted' }, 'Quotes and invoices in one read, in the order of a job: from setting your rates to the accountant’s spreadsheet. Five minutes.'),
    ...MONEY_GUIDE.map(([head, paras]) => h('section', null, h('h3', null, head), ...paras.map(t => h('p', null, t)))),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: async () => { close(); if (await reach('moneycourse')) openTutorial('moneycourse'); } }, '🎓 Walk me through it'),
      h('button', { class: 'btn ghost', onclick: async () => { close(); await toPracticeJob(); } }, '📐 Open the practice job')));
  ({ close } = sheet('Quotes & invoices guide', body));
}

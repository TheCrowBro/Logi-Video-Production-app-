// Page tutorials: the ? button at the top runs a short walkthrough of whatever is on screen, highlighting each box
// with a one-line description. Steps whose box is not on screen (an empty list, a hidden tool) are skipped, so the
// same tutorial fits a fresh install and a full one. "Other pages…" opens any page's tutorial from anywhere.
import { h, sheet, toast } from './util.js';
import { runTour, startTour } from './tour.js';

const T = (title, text, ...target) => ({ title, text, target });
const wait = ms => new Promise(r => setTimeout(r, ms));

export const TUTORIALS = {
  around: { name: 'Getting around', page: null, steps: [
    T('The Rolodex', 'Spin it to move between sections: drag or swipe it, tap ▲ ▼, or use the arrow keys on a keyboard.', '.binder', '#rolodex'),
    T('The top bar', 'Aa sets text size, theme and accessibility. ☁ links your cloud storage and shows the sync state. 🔒 appears once a PIN is set and locks Vdex at once. ⤓ installs the app.', '.top-actions'),
    T('This button', 'Tap ? on any page for its tutorial. The first card has “Other pages…” to read about a page you are not on.', '#helpBtn'),
    T('Shoot-day clock', 'On a shoot day this bar appears: start and stop the clock for the booking, take timed breaks, and see the day’s total.', '#clockbar:not([hidden])'),
  ] },
  bookings: { name: 'Bookings calendar', page: 'bookings', steps: [
    T('Your calendar', 'Every booking on its days; today is outlined and multi-day shoots span their dates. Tap a day to open it.', '.bk-month .cal'),
    T('Month to month', 'Previous, next, and Today.', '.bk-month .cal-nav'),
    T('New bookings', '+ New starts a blank booking. From template fills one in from a project template you made, with its kit, crew, deliverables and schedule.', '.bk-month .page-head .actions', '.bk-month .page-head'),
    T('Tools for all your shoots', 'Pipeline shows every project by stage. Call sheets lists each shoot’s sheet. Money has quotes and invoices. Hours & statistics and Calendar & email do what they say.', '.bk-month .subactions'),
    T('Next up', 'The next few shoots, tap one to open it.', '.bk-month h3 + .list', '.bk-month .list', '.bk-month .empty'),
  ] },
  day: { name: 'A day', page: 'bookings', steps: [
    T('The day', 'Step to the previous or next day; ‹ Calendar goes back to the month.', '.cal-nav'),
    T('Sun and weather', 'Sunrise, sunset and golden hour for your location, with the forecast when the day is within two weeks.', '.sunline', '.wxline'),
    T('Bookings that day', 'Tap one to open it. Add another with + New or From template.', '.list', '.empty'),
  ] },
  booking: { name: 'A booking', page: 'bookings', steps: [
    T('The booking', 'Project, client, dates, times and address, with Add to calendar, Share and Email. Edit changes the details.', '.bk-detail .card.hero'),
    T('Stages', 'Every project moves Enquiry → Quoted → Confirmed → Prepped → Shot → In post → Delivered → Archived. Tap a stage to move it; the checklist underneath belongs to the current stage.', '.bk-detail .stage-strip'),
    T('The checklist', 'Tick things off, add your own lines, and tap an arrow to open the tool a line is about. When a stage is complete, Next moves the project on.', '.bk-detail .checklist'),
    T('Call sheet and templates', 'Call sheet opens this shoot’s sheet. Save as template turns a job that went well into a template; Apply template items adds anything a template still has to offer.', '.bk-detail .bk-tools'),
    T('Venue', 'The venue’s rules, access, parking and map, with a warning if your kit breaks a rule.', '#bk-venue'),
    T('Sun and weather', 'Sunrise, sunset and golden hour at the venue, plus the forecast within two weeks.', '.bk-detail .sunline'),
    T('Crew', 'Who is on the shoot: ask them by text or email, set each person’s call time, and mark them confirmed.', '#bk-crew'),
    T('Shot list', 'List the shots you need and tick them off on the day.', '#bk-shots'),
    T('Equipment', 'The kit on this shoot, grouped by category, with a warning when an item is also booked elsewhere. Save the set as a kit for next time.', '#bk-kit'),
    T('Hires', 'Equipment hired in for the job, with who it comes from.', '#bk-hires'),
    T('Media & backups', 'One row per card: tick as it reaches drive 1, drive 2, offsite and verified. A card can only be cleared once it is on two drives.', '#bk-media'),
    T('Deliverables', 'What the client gets, with due dates that appear in your calendar, status and links.', '#bk-deliverables'),
    T('Licences', 'Music and stock licences kept with the project.', '#bk-licences'),
    T('Money', 'The quote and the invoice for this booking.', '#bk-money'),
    T('Hours', 'What the clock bar logged on this job, with overtime, and a button to start an edit session.', '#bk-hours'),
  ] },
  callsheet: { name: 'Call sheet', page: 'bookings', steps: [
    T('Edit the sheet', '‹ Booking goes back. Edit sheet turns the document’s fields into boxes you can type in; Done saves a new version.', '.cs-page .page-head'),
    T('State', 'Draft, sent, or changed since it was sent, with the version number. Mark as sent when it has gone out another way.', '.cs-page .status-line'),
    T('Send it', 'Print uses this device’s print dialog; Save PDF makes a file for the share sheet; Email crew is addressed to everyone on the shoot; Share, Web page and Copy text cover the rest.', '.cs-page .actions'),
    T('Forecast', 'The weather for the shoot day at the venue. Add to call sheet puts it on the sheet so it prints.', '.cs-page .wxline'),
    T('The sheet', 'Built from the booking, venue, crew, kit, hires and the sun for the day, plus everything you add in Edit sheet: call times, the schedule, who is on set, dress code, emergency contact and instructions.', '.cs-page .cs-paper'),
  ] },
  money: { name: 'Quote and invoice', page: 'bookings', steps: [
    T('Quote or invoice', 'Each booking has one of each; switch here. A tick means it exists.', '.money-page .seg'),
    T('State and total', 'Draft, sent, accepted or paid, the total, and overdue when an invoice passes its due date unpaid.', '.money-page .status-line'),
    T('Build it', 'Edit the lines by hand, or add suggested lines: from the booking (shoot days, crew at their day rates, kit, deliverables), from the quote, or from the hours logged. Mark as sent, accepted or paid ticks the pipeline.', '.money-page .actions'),
    T('Send it', 'Print, Save PDF, Email client (to the contacts on the booking), Share, Web page, Copy text.', '.money-page .actions ~ .actions'),
    T('The document', 'Your details from the Me page, the client, the lines, tax and totals, and the terms and payment details from Settings → Quotes & invoices.', '.money-page .cs-paper'),
    T('Start one', 'From the booking suggests the lines at your rates; an invoice can also start from the quote or from the hours logged; or start blank.', '.money-page .stack .actions'),
  ] },
  crew: { name: 'Crew', page: 'crew', steps: [
    T('Your crew', 'The freelancers you work with. + Add creates a person with their role, phone, email, day rate and a link to their work.', '#crew .page-head', '.page-head'),
    T('Find someone', 'Search by name or role.', '#crew .search', '.search'),
    T('Filter by role', 'Tap a role to see only those people.', '#crew .chips', '.chips'),
    T('A person', 'Call, text or email them from here, see their work, and which of your bookings they are on.', '.crew-card'),
  ] },
  gear: { name: 'Equipment', page: 'gear', steps: [
    T('Items and kits', 'Items is everything you own. Kits are named sets of gear for the shoots you do most; tick a kit on a booking to load its gear.', '.seg[role=tablist]'),
    T('Asset register', 'Exports everything with serial numbers, values, warranty and last service: for the insurer, and for the police if kit goes missing.', '.subactions'),
    T('Due for service', 'Items whose service is overdue or whose warranty is about to end.', '#page .warn'),
    T('Totals', 'How many items, what they are worth, and how many are booked ahead.', '.stats'),
    T('Find an item', 'Search by name or serial number; the chips filter by category.', '.search', '.chips'),
    T('An item', 'Quantity, serial, value and which shoots it is booked on. 🔧 opens its service log; ✎ edits it (service interval, warranty, firmware).', '.gear-card'),
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
    T('Your card', 'Name, business, title and where you are based. Edit fills it in; your details also go on call sheets, quotes and invoices.', '.id-card'),
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
  tcnotes: { name: 'Timecode notes', page: 'tcnotes', steps: [
    T('Logs and linking', '+ New log starts a log for a camera or a shoot day. Link device pairs this phone with a laptop so both take notes on the same log.', '#page .page-head .actions'),
    T('Your logs', 'One per camera or day. Open one to sync it and take notes.', '#page .list', '#page .empty'),
    T('Sync', '‹ Logs goes back. Sync matches the phone to the camera’s timecode: type what the camera shows, or scan its display.', '.tc-log-head'),
    T('The clock', 'The camera’s timecode as the phone follows it. In record run it holds between takes.', '.tc-clock'),
    T('Roll and cut', 'In record run, tap these with the camera; each take is logged with its length.', '.rollcut'),
    T('Notes and script', 'Switch between the notes and the script (side by side on a wide screen).', '.tc-views'),
    T('Take a note', 'Each note is stamped with the timecode the moment you start typing. Mark now drops a stamp to fill in later.', '.tc-composer'),
    T('Your notes', 'Every note with its timecode; export them as text or a spreadsheet for the edit.', '.tc-notes'),
    T('The script', 'Add a Word file or paste text, then tap a line (or press and hold to select words) and Mark to pin a stamp to it.', '.tc-pane:nth-of-type(2)', '.tc-script'),
  ] },
  settings: { name: 'Settings', page: 'settings', dynamic: () => {
    const blurbs = { 'Storage & sync': 'Link one cloud storage and every device shares one database.', 'Security': 'A PIN, fingerprint or face unlock, and encrypted data whenever Vdex is locked or in the background.', 'Calendar & email': 'Send bookings to your calendar once, subscribe to a live feed, or keep a two-way sync.', 'Display & accessibility': 'Text size, bigger buttons, contrast, animation and the colour theme, including camera-brand themes.', 'Field tool defaults': 'Your location, units, range-finder camera height and noise-meter calibration.', 'Hours & breaks': 'Standard day, break notifications, default approved break.', 'Quotes & invoices': 'Your rates, tax, numbering, payment terms and bank details.', 'Project templates': 'Your own job types: what a new booking of that kind starts with.', 'Workflow templates': 'The checklists for each job type and each stage.', 'Profile': 'Your details for call sheets, quotes and the Me page.', 'Install': 'Add Vdex to your home screen or desktop.', 'Backups & data': 'Export and import backups, restore an automatic cloud backup, load sample data, erase everything.', 'About': 'Version, updates, the tour and the licences.' };
    return [...document.querySelectorAll('.settings-section')].map((el, i) => { const title = el.querySelector('.ss-title')?.textContent || 'Section'; return { title, text: blurbs[title] || 'Open the section to see its settings.', target: [`.settings-section:nth-of-type(${i + 1}) > summary`] }; });
  } },
};

// Which tutorial fits what is on screen.
export function currentContext() {
  const q = s => !!document.querySelector(s);
  const page = (window.logiPage && window.logiPage()) || 'bookings';
  if (page === 'bookings') return q('.money-page') ? 'money' : q('.cs-page') ? 'callsheet' : q('.bk-detail') ? 'booking' : q('.bk-month') ? 'bookings' : 'day';
  return TUTORIALS[page] ? page : 'around';
}
const stepsFor = key => { const t = TUTORIALS[key]; return t.dynamic ? t.dynamic() : t.steps; };

export function openTutorial(key = currentContext()) {
  const t = TUTORIALS[key]; if (!t) return;
  const steps = stepsFor(key);
  if (!steps.length) return toast('Nothing to show here yet');
  runTour(steps, { footer: (n, stop) => n === 0 && h('button', { class: 'btn ghost small', onclick: () => { stop(); openChooser(); } }, 'Other pages…') });
}

// Reaches a page (and, for a booking, a call sheet or money, the first booking) before running its tutorial.
async function reach(key) {
  const t = TUTORIALS[key];
  if (t.page) { window.logiGo?.(t.page); await wait(650); }
  const click = sel => { const el = document.querySelector(sel); if (el) { el.click(); return true; } return false; };
  if (['booking', 'callsheet', 'money', 'day'].includes(key)) {
    // from wherever the Bookings page is, go to the month view first
    for (let i = 0; i < 3 && !document.querySelector('.bk-month'); i++) { if (!(click('.cs-page .page-head button') || click('.money-page .page-head button') || click('.bk-detail .page-head button') || click('button.btn.ghost.small'))) break; await wait(300); }
    if (key === 'day') { click('.bk-month .cal .day.today') || click('.bk-month .cal .day.has') || click('.bk-month .cal .day'); await wait(300); return true; }
    if (!(click('.bk-month h3 + .list .card.tap') || click('.bk-month .list .card.tap'))) { toast('Add a booking first, then open this tutorial from the booking.'); return false; }
    await wait(350);
    if (key === 'callsheet') { click('.bk-tools button'); await wait(350); }
    if (key === 'money') { click('#bk-money button'); await wait(350); }
  }
  return true;
}
export function openChooser() {
  let close = () => {};
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'A short walkthrough of any page. Each one highlights the boxes on that page with a line about what they do.'),
    h('div', { class: 'list' }, ...Object.entries(TUTORIALS).map(([key, t]) => h('button', { class: 'card tap', type: 'button', onclick: async () => { close(); if (await reach(key)) openTutorial(key); } }, h('strong', null, t.name)))),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => { close(); startTour(); } }, '🧭 The welcome tour again')));
  ({ close } = sheet('Tutorials', body));
}

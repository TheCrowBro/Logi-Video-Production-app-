// Page tutorials: the ? button at the top runs a short walkthrough of whatever is on screen, highlighting each box
// with a one-line description. Steps whose box is not on screen (an empty list, a hidden tool) are skipped, so the
// same tutorial fits a fresh install and a full one. "Other pages…" opens any page's tutorial from anywhere.
import { h, sheet, toast } from './util.js';
import { runTour, startTour } from './tour.js';

const T = (title, text, ...rest) => { const opts = rest.length && typeof rest[rest.length - 1] === 'object' ? rest.pop() : {}; return { title, text, target: rest, ...opts }; };
const tab = n => () => { const b = document.querySelector(`.tc-views button:nth-child(${n})`); if (b) b.click(); };
const topSheet = () => { const all = document.querySelectorAll('.sheet'); return all[all.length - 1] || document; };
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
    const blurbs = { 'Storage & sync': 'Link one cloud storage and every device shares one database.', 'Security': 'A PIN, fingerprint or face unlock, and encrypted data whenever Vdex is locked or in the background.', 'Calendar & email': 'Send bookings to your calendar once, subscribe to a live feed, or keep a two-way sync.', 'Display & accessibility': 'Text size, bigger buttons, contrast, animation and the colour theme, including camera-brand themes.', 'Field tool defaults': 'Your location, units, range-finder camera height and noise-meter calibration.', 'Hours & breaks': 'Standard day, break notifications, default approved break.', 'Quotes & invoices': 'Your rates, tax, numbering, payment terms and bank details.', 'Project templates': 'Your own job types: what a new booking of that kind starts with.', 'Workflow templates': 'The checklists for each job type and each stage.', 'Profile': 'Your details for call sheets, quotes and the Me page.', 'Install': 'Add Vdex to your home screen or desktop.', 'Backups & data': 'Export and import backups, restore an automatic cloud backup, load sample data, erase everything.', 'About': 'Version, updates, the tour and the licences.' };
    return [...document.querySelectorAll('.settings-section')].map((el, i) => { const title = el.querySelector('.ss-title')?.textContent || 'Section'; return { title, text: blurbs[title] || 'Open the section to see its settings.', target: [`.settings-section:nth-of-type(${i + 1}) > summary`] }; });
  } },
};

// Which tutorial fits what is on screen.
export function currentContext() {
  const q = s => !!document.querySelector(s);
  const page = (window.logiPage && window.logiPage()) || 'bookings';
  const sheets = document.querySelectorAll('.sheet[aria-label]'), title = sheets.length ? sheets[sheets.length - 1].getAttribute('aria-label') : '';
  const bySheet = { 'Sync timecode': 'tcsync', 'Link another device': 'tclink', 'Add script': 'tcimport', 'Replace script': 'tcimport', 'Export notes': 'tcexport' }[title];
  if (bySheet) return bySheet;
  if (page === 'bookings') return q('.money-page') ? 'money' : q('.cs-page') ? 'callsheet' : q('.bk-detail') ? 'booking' : q('.bk-month') ? 'bookings' : 'day';
  if (page === 'tcnotes') return q('.tc-log-head') ? 'tclog' : 'tcnotes';
  return TUTORIALS[page] ? page : 'around';
}
const stepsFor = key => { const t = TUTORIALS[key]; return t.dynamic ? t.dynamic() : t.steps; };

export function openTutorial(key = currentContext()) {
  const t = TUTORIALS[key]; if (!t) return;
  const steps = stepsFor(key);
  if (!steps.length) return toast('Nothing to show here yet');
  runTour(steps, { root: t.sheet ? topSheet : null, footer: (n, stop) => n === 0 && !t.sheet && h('button', { class: 'btn ghost small', onclick: () => { stop(); openChooser(); } }, 'Other pages…') });
}

// Reaches a page (and, for a booking, a call sheet or money, the first booking) before running its tutorial.
async function reach(key) {
  const t = TUTORIALS[key];
  if (t.page) { window.logiGo?.(t.page); await wait(650); }
  if (key === 'tcnotes' && document.querySelector('.tc-log-head')) { click('.tc-log-head .btn.ghost.small'); await wait(300); }
  if (key === 'tclog' && !document.querySelector('.tc-log-head')) { if (!click('#page .list .card.tap')) { toast('Create a log first with + New log, then tap ? inside it.'); return false; } await wait(350); }
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
    h('div', { class: 'list' }, ...Object.entries(TUTORIALS).filter(([, t]) => !t.sheet).map(([key, t]) => h('button', { class: 'card tap', type: 'button', onclick: async () => { close(); if (await reach(key)) openTutorial(key); } }, h('strong', null, t.name)))),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => { close(); startTour(); } }, '🧭 The welcome tour again')));
  ({ close } = sheet('Tutorials', body));
}

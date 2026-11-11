# Gigdex: how it is built

Gigdex is the booking deck for **music producers and their bands**: shows, studio sessions and rehearsals; acts, people,
backline and venues; songs, setlists and split sheets; day sheets, settlements, quotes and invoices; and the tools a
musician needs on the night (tuner, metronome, delay times, sound level meter, set timer).

It is a sibling of Vdex (the videographer app at the root of this repository). It began as a copy of Vdex's shell
(the Rolodex, sheets, forms, themes, offline service worker) with everything rebuilt for music. **Gigdex is
self-contained in `gigdex/`.** It never imports, links to or edits anything outside this folder, and nothing outside
this folder knows it exists, so Vdex's build, tests and publishing are untouched. The folder can be moved to a
repository of its own as it is.

It is a plain web app: ES modules, no framework, no build step, no external libraries or CDNs (only
`vendor/qrcode.js`). It works offline once opened, installs to a home screen, and keeps all data in the browser's
`localStorage` under keys that start with `gigdex-`. Nothing is sent to any server.

## Running it

```
cd gigdex
node tests/run.mjs              # every browser spec (Playwright + Chromium)
node tests/run.mjs 30- songs    # only specs whose file name contains "30-" or "songs"
node tools/stamp-build.mjs --dev  # after adding or removing a file: refreshes the offline file list in sw.js
npm run serve                   # http://localhost:8124/
```

## Folder layout

| Path | What |
|---|---|
| `index.html` | The app. Links `styles.css` and every `css/*.css`. |
| `invoice.html`, `daysheet.html` | Share pages: open a document packed into the link (no server). |
| `privacy.html` | The privacy page. |
| `styles.css` | Core styles and themes (copied from Vdex, re-skinned). |
| `css/<feature>.css` | One stylesheet per feature, owned by that feature. |
| `js/app.js` | Boot, the Rolodex, sections, redraw on change. |
| `js/store.js` | The database. |
| `js/model.js` | Music domain constants and pure sums (deals, settlement, set lengths, durations). |
| `js/pages/*.js` | One module per Rolodex section. |
| `js/blocks/*.js` | Boxes on a booking's page (deal, setlist, guest list…), listed in `js/blocks/index.js`. |
| `js/*.js` | Shared modules (see below). |
| `tests/` | `run.mjs`, `lib.mjs`, `helpers.cjs`, `specs/NN-name.cjs`. |
| `tools/` | `stamp-build.mjs`, `site-files.mjs`. |

## The sections (Rolodex cards)

| id | Label | Module | What it is |
|---|---|---|---|
| `bookings` | Bookings | `pages/bookings.js` | Calendar and list of shows, studio sessions, rehearsals; the booking page with its blocks. |
| `acts` | Acts | `pages/acts.js` | Bands and artists: members, links, press kit (EPK) with QR, tech rider (input list, stage plot), hospitality rider. |
| `people` | People | `pages/people.js` | Band members, session players, crew, industry contacts (promoters, agents…). |
| `songs` | Songs | `pages/songs.js` | Song library (key, BPM, length, status, split sheet) and setlists. |
| `sessions` | Studio log | `pages/sessions.js` | Take logs for recording sessions: song, take number, time, keep/maybe/no, notes. |
| `backline` | Backline | `pages/backline.js` | Instruments, amps, mics… with serials, values, owners; stage packs (kits). |
| `venues` | Venues | `pages/venues.js` | Venues, studios, rehearsal rooms, festivals: capacity, stage, PA, curfew, noise limit, load-in, map. |
| `money` | Money | `pages/money.js` | Overview: income by month and act, unpaid invoices, deposits due, settlements, payouts. |
| `tools` | Tools | `pages/tools.js` | Tuner, metronome + tap tempo, delay/reverb times, sound level meter, set timer. |
| `insurance` | Insurance | `pages/insurance.js` | Policies (instruments, public liability…), renewals, cover vs backline value. |
| `settings` | Settings | `pages/settings.js` | Profile, money settings, backups, display, tour, erase. |

Navigate in code with `window.logiGo('venues')` (string ids only; resolves once drawn). `window.logiPage()` is the
open section's id.

## Page contract

```js
export const venues = {
  id: 'venues', label: 'Venues', icon: '📍',
  render(root) { root.append(...); return cleanup || undefined; }, // draw into root (a fresh <section class="page-card">)
  tutorial: [ { title, text, target: ['.css-selector'] } ] // or () => steps for the current view
  // static: true  only for a page that keeps live state and must not be redrawn on data changes (Tools)
};
```

* `render` is called again (into an emptied root) after **every** store change, so it must draw from `store.db` each
  time, keep any view state (open tab, selected record, filters) in module-level variables, and not leak listeners
  (return a cleanup function for timers, audio, media streams, window listeners).
* Give interactive controls an `id` or `aria-label` so focus is restored after a redraw.
* Start the page with `h('div', { class: 'page-head' }, h('h1', null, 'Venues'), actionButton)`.
* An empty list shows `empty('One sentence on what goes here and why.', primaryButton)`.

## Data (`js/store.js`)

```js
import { db, update, upsert, patch, remove, byId, subscribe } from '../store.js';
```

* `db` is a live binding: read `db.venues` etc. at render time; never keep it across `await`.
* **Every change goes through the store**: `upsert(list, record)` (new id if none; stamps `updatedAt`, `createdAt`;
  returns the stored record), `patch(list, id, fields)`, `remove(list, id)` (also removes references elsewhere: see the
  code), or `update(d => { …mutate d…; rec.updatedAt = Date.now(); })` for anything else. A change saves and redraws.
* Ids: `uid()` from `util.js`. Dates: `'YYYY-MM-DD'`. Times of day: `'HH:MM'`. Instants (clocks, takes): ms epoch.
  Durations of songs: seconds. Money: plain numbers (the currency symbol is `db.profile.currency`).
* Numbers typed in forms arrive as numbers from `type: 'number'` fields but as **strings** from `rows` columns:
  convert with `Number()` before sums.
* `loadSample()` fills a realistic sample (ids start with `s-`: act `s-owls`, show `s-show1`, past show `s-past`,
  session `s-sess1`, setlist `s-clubset`, venue `s-lantern`…). Tests use it.
* Helpers: `bookingsOn(date)`, `upcoming()`, `activeBookings()`, `covers(b, date)`, `overlaps(a, b)`, `lastDay(b)`,
  `personBookings(id)`, `gearBookings(id)`, `personClash(b, personId)`, `gearClash(b, gearId)`, `qtyOf(g)`,
  `usedQty(booking, gearId)` (counts in `booking.gearQty`), `packQty(kit, gearId)` (counts in `kit.qty`; applying a pack
  to a booking copies them into `gearQty`), `totalValue(g)`, `exportJSON()`, `replaceAll(data)`, `mergeIn(data)`, `eraseAll()`.

### Records

`db.profile`: `{ name, business, role, phone, email, website, location, address, currency, bio, updatedAt }`

`bookings`:
```js
{ id, kind: 'show'|'session'|'rehearsal'|'other', status, title,   // title optional: model.bookingTitle(b) fills it in
  actId, client,                       // which act (acts id); client = free text for a session's artist not in Acts
  date, endDate,                       // endDate only for multi-day (festival weekend, a block of studio days)
  venueId, venueName, address,         // venue from Venues, or typed name/address
  // show times ('HH:MM'): loadIn, soundcheck, doors, setTime, curfew; setLength (minutes)
  // session/rehearsal/other times: start, end
  contact: { name, role, phone, email },          // promoter / client / studio contact for this booking
  deal: { type, fee, pct, ticketPrice, capacity, expenses, deposit, depositDue, depositPaid, notes },  // shows
  runningOrder: [{ id, act, time, length, ours }],// shows: doors, support acts, changeovers, our set
  guestList: [{ id, name, plus, note, in }], guestCap,
  hospitality, accommodation, parking, backlineProvided,   // text
  setlistId,                                       // setlists id
  settlement: { tickets, comps, merch: [{ id, item, start, end, comps, price }], merchTotal,
                costs: [{ id, desc, amount }], received, shares: { personId: weight }, settledAt, notes },
  rate, rateUnit: 'hour'|'day'|'song'|'flat', songIds: [], deliverables: [{ id, t, due, done }],   // sessions
  fee,                                             // other: a plain fee
  people: [personId], gear: [gearId], gearQty: { gearId: n }, kits: [kitId],
  checks: { checkId: true },                       // advance / session checklist (js/blocks/advance.js)
  budget: [{ id, cat, desc, amount }],             // our costs (travel, hotel, hire…)
  quote, invoice,                                  // documents, owned by js/money.js
  daySheet: { sentAt, sig },                       // when the day sheet was last sent, and a fingerprint of it (daysheet)
  notes, createdAt, updatedAt }
```
Statuses per kind: `model.statusesFor(kind)` (`hold`, `offer`, `confirmed`, `advanced`, `done`, `settled`,
`cancelled`). Pills: `h('span', { class: 'pill ' + statusTone(s) }, statusLabel(s))`.

`acts`: `{ id, name, genre, color, bio, links (text, one "Label: url" per line), email, phone, members: [personId],
inputList: [{ id, ch, source, mic, stand, note }], stagePlot: [{ id, label, x, y }], riderTech, riderHospitality, notes }`

`people`: `{ id, name, group: 'band'|'session'|'crew'|'contact', role, instrument, company, phone, email, rate,
rateUnit: 'day'|'hour'|'show', notes }`. Act membership lives on the act (`act.members`).

`gear`: `{ id, name, category, make, model, serial, value, qty, owner (personId), location, notes }`.
`kits` (stage packs): `{ id, name, items: [gearId], qty: { gearId: n }, notes }`.

`venues`: `{ id, kind: 'venue'|'studio'|'rehearsal'|'festival'|'other', name, address, geo: { lat, lon }, capacity,
stage, pa, backline, loadIn, parking, curfew, noiseLimit (dB), contact, phone, email, website, hospitality, rate,
rateUnit, notes }`.

`songs`: `{ id, title, actId, key, bpm, duration (seconds), tuning, status, isrc, lyrics, link, notes,
splits: [{ id, name, role, share (%), pro, ipi, publisher }] }`.

`setlists`: `{ id, name, actId, gap (seconds between songs), items: [{ id, songId, title, duration, note, segue,
encore, isBreak }], notes }`. An item with `songId` takes its title and length from the song; one without carries its
own `title` (and `duration`). `isBreak` is a set break ("SET 2", "ENCORE" heading). Length: `model.setlistLength(list)`.

`logs` (take logs): `{ id, bookingId, date, title, songId, startedAt, takes: [{ id, n, songId, at, rating:
'keep'|'maybe'|'no'|'', text }], notes }`.

`shifts` (session clock): `{ id, bookingId, start, end (null while running), breaks: [{ start, end }] }`.

`insurance`: `{ id, type, provider, policy, cover, premium, renewal, phone, claims, link, notes }`.

`db.templates[kind]`: the person's own checklist lines per kind (advance block). `db.billing`, `db.priceList`: owned
by `js/money.js`.

## The music model (`js/model.js`)

Constants: `KINDS`, `STATUSES`, `statusesFor`, `statusLabel`, `statusTone`, `kindLabel`, `kindIcon`, `SHOW_TIMES`,
`SESSION_TIMES`, `timesFor`, `PEOPLE_GROUPS`, `ROLES`, `GEAR_CATS`, `VENUE_KINDS`, `RATE_UNITS`, `SONG_STATUS`,
`NOTES`, `KEYS`, `SPLIT_ROLES`, `DEAL_TYPES`.
Helpers: `bookingTitle(b)`, `actName(id)`, `venueOf(b)`, `firstTime(b)`, `coversDay(b, iso)`, `fmtDur(sec)`,
`parseDur(text)`, `fmtMin(min)`, `addMinutes('HH:MM', min)`, `minutesBetween(a, b)`, `setlistLength(list)`,
`itemTitle(item)`, `fmtMoney(n, sym?)`, `currency()`, `dealPays(deal, gross)`, `dealSummary(deal)`, `dealBest(deal)`,
`settle(b)`, `sessionFee(b, hours?)`, `sessionHoursPlanned(b)`, `bookingIncome(b)`.

Checklists: `CHECKLISTS` (built-in lines per kind with stable ids such as `show-daysheet`, `show-invoice`,
`show-paid`, `show-settled`, `ses-invoice`, `ses-paid`, `ses-deliver`), `checklistFor(kind)`, `isChecked(b, id)`,
`markCheck(bookingId, id, on)`. A feature that completes a step ticks it by id (sending the day sheet ticks
`show-daysheet`; sending an invoice ticks `show-invoice`/`ses-invoice`; a paid invoice `show-paid`/`ses-paid`;
settling the night `show-settled`). People's rate units: `PERSON_RATE_UNITS` (day, hour, show, song).

Use these instead of re-implementing them, so a show's numbers agree on every page. If one is wrong or missing, say
so in your report rather than forking it.

## Booking blocks (`js/blocks/*.js`)

The booking page (`pages/bookings.js`) shows a header (title, kind, status, date, times, venue, act, contact) and then
one collapsible box per block whose `kinds` include the booking's kind, sorted by `order`:

```js
export default {
  id: 'deal', title: 'Deal & fee', icon: '🤝', order: 10, kinds: ['show'],
  summary(b) { return '$250 vs 70%'; },          // short text on the closed box ('' when nothing to say)
  render(b, ctx) { return node; },               // the open box's body
  tutorial: [ ...steps ],                         // optional: added to the booking page's walkthrough
};
```

* `b` is the current booking record; read related records from `db` at render time.
* Write with `patch('bookings', b.id, { … })` or `update(d => { const x = d.bookings.find(r => r.id === b.id); …;
  x.updatedAt = Date.now(); })`. The page redraws itself after every change.
* `ctx`: `{ sym }` (currency symbol) and `ctx.open(blockId)` (open another block, e.g. settlement → money).
* Each box is `<details class="blk" id="blk-<id>">`. Its open state survives redraws.
* Big editors open in a sheet (`util.sheet` / `form.openForm`), not inline.

| Block | Owner | Kinds | What |
|---|---|---|---|
| `deal` (10) | show | show | Deal type, fee, %, ticket price, capacity, costs, deposit (due, paid). Shows what it pays at 50%, 75%, full. |
| `clock` (12) | studio | session, rehearsal | Session clock: start/stop/break; hours vs planned; feeds the invoice. |
| `advance` (15) | bookings | show, session, rehearsal | Checklist per kind (advance a show; prep a session), editable lines. |
| `running` (20) | show | show | Running order: doors, support, changeovers, our set; computed from set length. |
| `worksongs` (25) | studio | session | Songs worked on (from Songs; add new). |
| `lineup` (30) | bookings | all | Who is playing/working (People) and what gear goes (Backline, stage packs), with clash warnings. |
| `takes` (35) | studio | session | This session's take log (opens/creates a log in Studio log). |
| `setlist` (40) | songs | show, rehearsal | Pick or make a setlist; its length vs the set length; print the stage copy. |
| `guests` (45) | show | show | Guest list with +1s and a cap; tick in at the door. |
| `daysheet` (50) | daysheet | show, session, rehearsal | Preview, print, save, and share the day sheet link with the band. |
| `deliverables` (55) | studio | session | Mixes, masters, stems… with due dates and done ticks. |
| `settlement` (60) | show | show | The night: tickets, comps, merch counts, costs, received; what the band made; payouts per person. |
| `budget` (65) | money | all | Our costs: travel, hotel, van, per diems, hire. |
| `money` (70) | money | show, session, other | Quote and invoice for the booking: lines, tax, numbering, payments, client link. |
| `notes` (95) | bookings | all | Free notes. |

## Shared API between features

Each of these exists from the start as a stub with this exact signature. The owner replaces the stub; everyone else
may call it.

| Export | Owner | Signature / behaviour |
|---|---|---|
| `pages/bookings.js` `openBooking(id)` | bookings | Go to Bookings and show that booking's page. Returns a promise. |
| `pages/bookings.js` `newBooking(preset)` | bookings | Open the new-booking form, prefilled (`{ kind, actId, venueId, date, setlistId }`). |
| `pages/acts.js` `openAct(id)` / `editAct(a, onSaved)` / `printRider(actId)` | acts | View sheet / edit form / print the tech rider. |
| `pages/people.js` `openPerson(id)` / `editPerson(p, onSaved)` | people | View sheet / edit form (it also edits which acts the person is in: `act.members`). |
| `pages/songs.js` `openSong(id)` / `editSong(s, onSaved)` | songs | View sheet / edit form. |
| `js/setlist.js` `openSetlist(id, { target, bookingId })` / `newSetlist(preset)` / `printSetlist(id, { bookingId })` / `setlistText(list)` | songs | Editor sheet (target = slot minutes) / create and return the record / print the big stage copy (with the show's date, venue and set time) / plain text. |
| `pages/sessions.js` `openLog(id)` / `newLog(preset)` | studio | Go to Studio log and open that log / create one (`{ bookingId, songId, title }`) and open it. |
| `pages/backline.js` `editGear(g, onSaved)` / `editKit(k, onSaved)` | backline | Edit forms. |
| `pages/venues.js` `openVenue(id)` / `editVenue(v, onSaved)` / `venueWarnings(b)` | venues | View sheet / edit form / warnings for a booking at that venue (curfew before the set ends, noise limit, capacity < tickets…) as strings. |
| `js/daysheet.js` `openDaySheet(bookingId)` / `printDaySheet(bookingId)` | daysheet | Preview sheet / print. |
| `js/money.js` `docOf(b, 'quote'|'invoice')` / `docTotals(doc)` / `isOverdue(b)` | money | The document or null / `{ net, tax, total, paid, due }` / unpaid past due. |
| `js/money.js` `billingPanel()` / `priceListPanel()` | money | Nodes for Settings: numbering, tax, payment details; the person's price list. |
| `js/clock.js` `initClockBar(el)` / `clockCard(b)` | studio | The strip under the Rolodex while a clock runs / start-stop card. |
| `js/clock.js` `clockHours(bookingId)` / `runningShift()` | studio | Hours worked by the clock, breaks taken off (money bills them) / the running shift or null. |
| `js/backup.js` `openBackupSheet()` / `nudgeIfStale()` / `backupPanel()` | settings | ☁ sheet / an occasional reminder / the panel used in Settings. |
| `js/tour.js` `sheetTutorial(title, steps)` | core | Register walkthrough steps for a sheet by its title. |
| `blocks/running.js` `sortedRows(b)` / `runningWarnings(b)` / `dayClock(b)` | show | The running order in the night's order (after-midnight aware) / its warnings / the day's clock. |
| `blocks/guests.js` `guestCounts(b)`; `blocks/settlement.js` `isSettled(b)` / `settlementDoc(b)` | show | Names, heads and in / whether the night is settled / the printable settlement. |
| `js/daysheet-doc.js` `cleanDaySheet(data)` / renderer | daysheet | Pure (no store): the whitelist and renderer shared by the app and `daysheet.html`. |
| `js/ics.js` `bookingIcs(b)` / `allIcs(list)` | bookings | Calendar files (RFC 5545, past-midnight safe, no money). |
| `js/print.js` `printElement(el, css)` / `docPage(title, el, css)` / `saveFile(text, name, type)` / `fileName(title, ext)` / `csv(rows)` | core | Printing and saving documents. |

`onSaved(record)` is called with the stored record after a form saves.

## Shared modules (core)

* `util.js`: `h(tag, attrs, ...kids)` (attrs: `class`, `onclick`…, `aria-*`, `data-*`, `html` for trusted markup
  only), `nodes`, `uid`, `pad`, `ymd`, `todayISO`, `parseISO`, `fmtLong`, `fmtShort`, `fmtTime`, `daysUntil`,
  `groupBy`, `toast(msg)`, `announce(msg)`, `sheet(title, body, { onClose })` → `{ el, close }`, `mapsUrl`, `telUrl`,
  `safeUrl` (always use it for user-typed links), `empty(msg, action)`, `backBtn(label, fn)`, `hold(el, ms, fn)` /
  `wasHeld(el)` (press and hold), `rateText(c, sym)`, `personRate(c)`.
* `form.js` `openForm({ title, fields, values, onSave(values), onDelete, saveLabel, confirmDelete, onReady(formEl) })`. Field `type`s: `text` (default),
  `tel`, `email`, `url`, `number` (`min`, `step`), `date`, `time`, `textarea` (`rows`), `select` (`options`: values or
  `[value, label]`), `checks` (`options: [{ value, label, group, hint }]`, returns an array), `rows` (`columns: [{ key,
  label, type, list }]`, returns an array of objects with string values), `place` (lat/lon with lookup; key `geo`).
  `list: [...]` gives a text box suggestions. `required`, `placeholder`, `hint`.
* `map.js`: `hasGeo(geo)`, `miniMap(venue)`, `mapButtons(venue)`, `directionsUrl(venue)`, `geocode(address)`.
* `qr.js`: `qrSvg(text)` → a Promise of the SVG markup (UTF-8; put it in with `h('div', { class: 'qr', html: await qrSvg(t) })`).
* `link-pack.js`: `pack(obj)` → string for a URL fragment; `unpack(str)` → obj.
* `version.js`: `VERSION`, `shareBase()` (where share pages live: build links as `shareBase() + 'daysheet.html#' + packed`).
* `print.js`: see above. Documents use the classes in `doc-css.js` (`.cs-doc`, `.cs-head`, `.cs-brand`, `.cs-kicker`,
  `.cs-when`, `.cs-times`/`.cs-time`, `.cs-sec`, `.cs-kv`, `table`, `.money-parties`, `.money-totals`, `.cs-foot`).
* `a11y.js`: `haptic()`. `tour.js`: `runTour(steps)`, `sheetTutorial()`.

## Styles

* Colours only from the theme tokens: `--bg`, `--bg2`, `--card`, `--line`, `--text`, `--muted`, `--accent`,
  `--accent-ink`, `--paper`, `--paper-ink`, `--danger`, `--ok`, `--blue`; sizes `--radius`, `--pad`, `--hit` (44px
  minimum touch target). Never hard-code colours in a page; every theme has a light and a dark scheme.
* Existing components (in `styles.css`): `.page-head`, `.btn` (`.primary`, `.ghost`, `.danger`, `.small`),
  `.icon-btn`, `.card` (`.tap` clickable), `.card-row`, `.grow`, `.list`, `.stats`/`.stat`, `.kv`, `.pill` (+ `st-*`
  tones), `.chip`, `.muted`, `.small`, `.warn`, `.empty`, `.actions`, `.stack`, `.seg` (segmented buttons), `.twirl`,
  `.qr`, `.meter`, `.form`, `.field`, `.sheet`.
* Your own styles go in **your** `css/<feature>.css` only, with class names prefixed for your feature
  (`.bk-`, `.sh-`, `.ds-`, `.mn-`, `.st-` is taken by status pills so studio uses `.sd-`, `.sg-` songs, `.ac-` acts,
  `.pp-` people, `.bl-` backline, `.vn-` venues, `.tl-` tools, `.se-` settings, `.ins-` insurance).
* Phone first (360–430px wide), and it must also look right on a laptop (the page widens past 900px).

## Share pages

`invoice.html` (money) and `daysheet.html` (daysheet) open a document packed into the URL fragment
(`link-pack.js`), so nothing reaches a server. They load their own script (`js/invoice-page.js`,
`js/daysheet-page.js`) with `<script type="module" src=…>`: **no inline scripts** (the CSP forbids them). They must
never show private numbers that are not meant for the reader (a day sheet for the band never shows the deal, fees,
settlement or budget).

## Writing for people

Gigdex is used by musicians on a phone, often in a dark venue or a studio. Write the way Vdex does: plain words,
short sentences, no jargon a musician would not use, helpful empty states, labels on every control, confirmation
before anything destructive, and a toast after a save that isn't visible otherwise. Use music words people know:
load-in, soundcheck, doors, set, curfew, changeover, guarantee, door split, settlement, rider, input list, stage plot,
backline, take, comp, stems, split sheet.

## Tests

* `tests/helpers.cjs`: `const { open, ok, sleep, go, topSheet } = require('../helpers.cjs');`
  `const { browser, page, errors } = await open({ sample: true, tab: 'songs' });` Each `ok(name, condition, extra)`
  prints a PASS or FAIL line. End every spec with `ok('no errors in the console', errors.length === 0, …)` and
  `await browser.close()`, and wrap the whole spec in `(async () => { … })().catch(e => { console.log('FAIL … crashed — ' + e.message); process.exit(1); })`.
* Spec files by owner: `00-smoke` (core), `10-bookings`, `15-show`, `20-daysheet`, `25-money`, `30-studio`,
  `35-songs`, `40-acts`, `45-people`, `50-backline`, `55-venues`, `60-tools`, `65-insurance`, `70-settings`.
* Test what a person does: open the section, tap the buttons, fill the forms, check what shows and what is stored.
* `window.gigdexAudioState()` (from `js/audio.js`) reports live audio (context, microphone tracks, tuner, metronome,
  meter, timer, wake lock): a spec can check that leaving a page leaves nothing listening.
* `00-smoke` must keep passing: every section opens with and without the sample, with no console errors.

## Who owns which files

Only edit files you own. Core files (`index.html`, `styles.css`, `js/app.js`, `js/store.js`, `js/model.js`,
`js/util.js`, `js/form.js`, `js/tour.js`, `js/tutorials.js`, `js/print.js`, `js/blocks/index.js`, `sw.js`, `tools/`,
`tests/lib.mjs`, `tests/run.mjs`, `tests/helpers.cjs`, `tests/specs/00-smoke.cjs`) belong to the integrator: if you
need a change there, describe it in your report instead.

| Feature | Files |
|---|---|
| bookings | `js/pages/bookings.js`, `js/blocks/advance.js`, `js/blocks/lineup.js`, `js/blocks/notes.js`, `js/ics.js`, `css/bookings.css`, `tests/specs/10-bookings.cjs` |
| show | `js/blocks/deal.js`, `js/blocks/running.js`, `js/blocks/guests.js`, `js/blocks/settlement.js`, `css/show.css`, `tests/specs/15-show.cjs` |
| daysheet | `js/daysheet.js`, `js/blocks/daysheet.js`, `daysheet.html`, `js/daysheet-page.js`, `css/daysheet.css`, `tests/specs/20-daysheet.cjs` |
| money | `js/money.js`, `js/blocks/money.js`, `js/blocks/budget.js`, `js/pages/money.js`, `invoice.html`, `js/invoice-page.js`, `css/money.css`, `tests/specs/25-money.cjs` |
| studio | `js/clock.js`, `js/blocks/clock.js`, `js/blocks/takes.js`, `js/blocks/worksongs.js`, `js/blocks/deliverables.js`, `js/pages/sessions.js`, `css/studio.css`, `tests/specs/30-studio.cjs` |
| songs | `js/pages/songs.js`, `js/setlist.js`, `js/blocks/setlist.js`, `css/songs.css`, `tests/specs/35-songs.cjs` |
| acts | `js/pages/acts.js`, `css/acts.css`, `tests/specs/40-acts.cjs` |
| people | `js/pages/people.js`, `js/pages/insurance.js`, `css/people.css`, `tests/specs/45-people.cjs`, `tests/specs/65-insurance.cjs` |
| backline | `js/pages/backline.js`, `js/pages/venues.js`, `css/backline.css`, `tests/specs/50-backline.cjs`, `tests/specs/55-venues.cjs` |
| tools | `js/pages/tools.js`, `js/audio.js`, `css/tools.css`, `tests/specs/60-tools.cjs` |
| settings | `js/pages/settings.js`, `js/backup.js`, `css/settings.css`, `tests/specs/70-settings.cjs` |

A feature may add new files of its own under `js/` (named after the feature) if it needs them.

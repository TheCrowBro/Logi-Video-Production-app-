# Logi Production Deck

An installable (PWA) app for freelance videographers and small video businesses. A 3D **Rolodex** drum at the top cycles through the sections — drag/swipe it, tap the ▲▼ buttons, use the arrow keys or the mouse wheel.

| # | Section | What it does |
|---|---------|--------------|
| 1 | **Bookings** | Month calendar (multi-day shoots span their days) → tap a day → all bookings that day → tap a booking for address, stakeholders (tap-to-call), crew, notes and the **equipment list pulled from your gear inventory**. Warns when kit is double-booked on the same day. Shows sunrise/sunset/golden hour for the day once you've set a location. |
| 2 | **Crew** | Trusted crew by role, with call/text/email buttons, a "View work" link to their portfolio, and their upcoming bookings. |
| 3 | **Equipment** | Everything you own by category with serials, values and quantities (own 4 of the same light? set Quantity owned to 4; bookings and kits record how many units they use, and a clash is only flagged when overlapping jobs need more units than you own), and which upcoming projects each item is booked on. A **Kits** tab holds reusable gear sets per shoot type (interview, car shoot…); tick a kit on a booking to add its gear, or save a booking's gear as a new kit. |
| 4 | **Venues** | Saved places with a map pin, directions (Google / Apple Maps), contact, access and parking notes, a rules list (tripods, lighting, haze, drones, generators… each *allowed / needs approval / not allowed*), permit and insurance requirements, and a "rules last confirmed" date. Choose a venue on a booking and the app warns if your booked gear breaks its rules. |
| 5 | **Insurance** | Policies, claims lines, renewal countdown, and a warning if equipment cover is below the value of your logged kit. |
| 6 | **Me** | Your details, a **QR code** (vCard contact card, or a link to your website), share as `.vcf`. |
| 7 | **Field** | Sun planner (rise/set, golden & blue hour, bearings, time scrubber), Polaris finder, white-balance reader (camera), noise meter (microphone), range finder (AR on Android/ARCore phones; tilt method on any phone). |

| 8 | **TC Notes** | Timecode-stamped shoot notes. Pick the camera's frame rate (23.976, 24, 25, 29.97 NDF/DF, 30, 50, 59.94 NDF/DF, 60), free-run or record-run mode, sync once by typing the camera's timecode or scanning its display with the phone camera, then every note is stamped with the running camera timecode the moment you start typing. "Mark now" drops a stamp to fill in later. Export as .txt or .csv for the edit. |

## Web app and installed app — the same thing

Logi is one web app at one address. Open the address in any browser and use it there, or install it from that same address for an icon, full-screen use and offline access. Both share the same data (link a cloud storage under ☁ to keep your phone, laptop and browser in step).

| Platform | Use in the browser | Install |
|----------|--------------------|---------|
| iPhone / iPad | Safari | Safari → Share → **Add to Home Screen** (the **Install** button in the header shows the steps) |
| Android | Chrome, Edge, Samsung Internet | **Install** button in the header, or menu ⋮ → *Install app* |
| Windows / Mac / Linux | Any browser | Chrome or Edge: **Install** button, or the install icon in the address bar. Firefox has no install; use it in a tab. |

On a laptop the layout opens up: calendar beside the upcoming list, booking details in two columns, equipment and crew in a grid, and in TC Notes the script sits beside the notes.

### Publishing it (GitHub Pages)

`.github/workflows/pages.yml` deploys the app to GitHub Pages at `https://thecrowbro.github.io/Logi-Video-Production-app-/`. It runs on every push to `main`, or on demand: Actions → *Deploy to GitHub Pages* → *Run workflow* (pick any branch to preview it). The first run switches Pages on for the repository by itself. Any static host (Netlify, Cloudflare Pages, your own server) works too: upload the folder as is, over HTTPS.

| 9 | **Settings** | Storage & sync, calendar & email, display & accessibility, field-tool defaults (location, units, declination, camera height, noise calibration), profile currency, install, backups (export / import / sample / erase), about and the tour. The ☁ and Aa buttons in the header are shortcuts to the same panels. |

## Run it

It's a static site with no build step — serve the folder over HTTP:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Camera, microphone, location and the service worker (offline/install) need **HTTPS** (or `localhost`). Easiest: publish the repo with GitHub Pages / Netlify / Cloudflare Pages, open the URL on your phone and "Add to Home Screen".

## Your data and cloud storage

All data is one JSON document, kept on the device and mirrored to **one** storage you link under the ☁ button. Newest copy wins when the app opens or regains focus; there is no server and no account.

| Option | Works on | One-time setup |
|--------|----------|----------------|
| **Dropbox** | every browser incl. iPhone | Create an app at dropbox.com/developers/apps (Scoped access → *App folder*), enable `files.content.read` + `files.content.write`, add the Redirect URI shown in the app (your hosted URL), paste the **App key**. Saved as `Apps/<your app>/logi-production-db.json`. Stays signed in (refresh token). |
| **Microsoft OneDrive** | every browser incl. iPhone | Azure app registration (single-page app, redirect URI = the app's address, delegated `Files.ReadWrite.AppFolder`), paste the Application (client) ID. Logi only sees its own app folder. Sign-in refreshes silently. |
| **WebDAV server** (Nextcloud, ownCloud, Synology, Fastmail…) | every browser | Folder address, username and an app password, kept in the browser. The server must allow this site's origin (CORS). |
| **Google Drive** | every browser incl. iPhone | In Google Cloud Console enable the Drive API, create an OAuth *Web* client ID with your hosted origin as an authorised JavaScript origin, paste the **client ID**. Uses only the hidden app-data folder. Google tokens last ~1 hour, so tap *Reconnect* now and then. |
| **File in a synced folder** | Chrome/Edge/Android | Pick a file inside any folder a sync client mirrors: iCloud Drive (Mac), OneDrive, Google Drive for desktop, Dropbox, Box Drive, Proton Drive, Synology Drive, Nextcloud, pCloud, MEGA… |
| **Export / Import** | everywhere | Manual backup (Share → Save to Files). |

Dropbox and Google need HTTPS hosting (e.g. GitHub Pages) so the sign-in can return to the app. The keys/IDs are public identifiers, not secrets; they and the sign-in tokens are stored only in this browser. Copies are merged record by record (see Timecode notes below), so editing on two devices is safe; a record edited on both within the same few seconds keeps the later edit.

## Timecode notes

- Each log has a **timecode mode**. *Free run*: the camera's clock always counts, so the app counts continuously from the sync moment. *Record run*: the camera only counts while recording, so you tap **● Roll** and **■ Cut** with the camera; the clock holds between takes, and each take is logged as a note with its length (switch that off in the log settings).
- When syncing in record run, tick "the camera is recording right now" only if it is; a stopped camera shows its last recorded timecode, and the app holds there until you tap Roll.
- The sync moment is the instant you tap Sync (typed) or Scan (camera); a slow OCR read doesn't put you out. Re-sync if the camera's clock is reset.
- Camera scanning uses Tesseract OCR loaded from a CDN on first use (needs a connection once; the reader is then cached by the browser). Glare, tilt and tiny displays defeat it — typing the value is always available.
- **Script marking**: add the script to a log (Script tab) from a Word .docx, a .txt/Fountain file, pasted text, or — on Android — by sharing the file straight to Logi from Google Docs (⋮ → Share & export → Send a copy → Word). Google Docs can't be read directly by an app, so on iPhone download it as Word or copy-paste. Tap a line to select it, or press and hold to select words, then **Mark** (or **Mark + note**): the note is stamped with the camera timecode and pinned to that line, shown as a highlight with a timecode badge, like a lined script. Notes list the quoted line and jump back to it; exports include it.
- **Two devices at once (phone + laptop)**: tap **🔗 Link device** in TC Notes on both. One shows a code, the other scans it (or paste the code), then they swap. The link is direct between the two devices over the same Wi‑Fi or hotspot — no account, no internet needed — and while it is up the open log, its sync point, Roll/Cut and every note stay identical on both, within a fraction of a second. The two clocks are measured against each other (NTP-style, usually to a few ms) so stamps made on either device agree; a sync made on a device whose clock hasn't been measured shows a warning and may be a second out. Closing the app on either side drops the link; re-link with a fresh code.
- **Cloud copies merge** rather than overwrite: records are merged one by one (newest edit wins per record, notes are combined, deletions are remembered), so two devices editing at the same time don't lose each other's work. While TC Notes is open the cloud copy is also re-read every few seconds, so notes from another device arrive even without a direct link (subject to the cloud service's own delay).
- Phone clocks drift about a second a day against a camera's crystal, so re-sync on long days.

## Pre- and post-production workflow

Every booking moves through stages — Enquiry → Quoted → Confirmed → Prepped → Shot → In post → Delivered → Archived — and each stage has a checklist from a template for the job type (brand, corporate, event, wedding, music video, real estate, documentary). Tick items off on the booking page; items with an arrow open the matching tool (call sheet, kit, media log, hours…), custom items can be added per booking, and the templates themselves are editable under Settings → Workflow templates. **🗂 Pipeline** on the Bookings page shows every project by stage with its progress and next deadline.

On the booking page, pre-production adds **crew confirmation** (asked / confirmed / declined, individual call times, one-tap ask by text or email), **hires** (rental items with pickup/return and cost), a **shot list** to tick off on the day, and the **📋 Call sheet**: built from the booking, venue (address, access, parking, power, nearest hospital, rules), crew with call times, kit, hires, notes and the sun for the day; share, copy, email or print it.

Post-production adds the **media & backups log** (one row per card: drive 1, drive 2, offsite, verified; a card can only be marked cleared once it is on two drives), **deliverables** with due dates (which go to the calendar feed and synced calendar), **music & stock licences**, and **✂ Start edit session**, which runs the clock bar for post days; the hours statistics can be split shoot vs edit.

## Hours and breaks (the clock bar)

On a shoot day a bar appears under the Rolodex naming the booking. **● Start work** starts the clock for that project; **■ Stop work** logs the hours. **☕ Break** asks how long (15 min, 30 min, 1 hour, 2 hours), pauses the work time and counts that break down, buzzing when it's up; **▶ Back to work** ends it whenever you actually return. With notifications turned on (Settings → Hours & breaks, or the link in the break chooser) a system notification says when the break is up, with a *Back to work* button and a *5 more min* button, and optionally a warning two minutes before; it works while the app is open on a computer, in the background on a phone for the first few minutes, or for the whole break with *Keep the screen on during breaks*. A browser app without a server can't wake a suspended phone, so if the app was suspended the notification arrives the moment you come back to it. Every break also counts against the length approved for that production per day (set per booking as *Approved break per day*, with a default under Settings → Hours & breaks); the chooser shows how much of that is left, and the bar warns when it's used up. If a shift is left running overnight the bar says so. Hours can also be added or corrected by hand (date, start, finish, break total), per booking or from the **📊 Hours** button on the Bookings page.

**📊 Hours & statistics** shows totals for the period (hours, days, average day, breaks, overtime beyond your standard day, longest day), hours per week as a chart with a table view, hours by project, the list of days, and a CSV export for invoicing.

## Calendar and email

Open **📆 Calendar** on the Bookings page, or **Add to calendar** on any booking.

| Strength | What it does | Works with |
|----------|--------------|-----------|
| **Add once** | One tap puts a booking into Google Calendar, Outlook.com, Microsoft 365, Yahoo (prefilled event) or Apple Calendar / anything else (`.ics` file). *Share* sends the `.ics` and details through the phone's share sheet; *Email* opens a message with the details filled in. *Share bookings* exports every active booking as one `.ics`. | Everything, no setup |
| **Live feed** | With a cloud storage linked (☁), Logi keeps `logi-bookings.ics` up to date next to its database. Subscribe to the file's link once (Google Calendar: *Other calendars → From URL*; Apple Calendar: *File → New Calendar Subscription*; iPhone: *Settings → Calendar → Accounts → Add Subscribed Calendar*; Outlook: *Add calendar → Subscribe from web*) and the calendar follows every change. Dropbox and Google Drive links are fetched by the app (Dropbox needs the `sharing.write` permission on your Dropbox app; Drive adds the `drive.file` scope, limited to files Logi created). With a synced folder, pick where the file goes and share it from your Dropbox/Drive/OneDrive app. One-way; refresh timing is the calendar's (Apple: your choice, Outlook ~3 h, Google up to a day). | Any calendar app that can subscribe to a URL |
| **Two-way sync** | Logi creates a *Logi bookings* calendar in your account and keeps it in step: new, changed and cancelled bookings go up; a date, time, title or address you edit in the calendar comes back into the booking. Google needs the same OAuth client ID as the Drive link plus the Google Calendar API enabled (scope `calendar.app.created`: Logi can only touch the calendar it made, and Google asks you to re-approve about hourly). Microsoft needs an Azure app registration (single-page application, redirect URI = the app's address, delegated `Calendars.ReadWrite`); its sign-in refreshes silently. | Google Calendar, Microsoft 365 / Outlook |

Apple's iCloud calendar has no web API, so for it use the live feed or Add once. Cancelled bookings are removed from the feed and from synced calendars.

## Field-tool accuracy

- **Sun / Polaris** use standard astronomical formulas (checked against known solstice values). Times display in the device's time zone. Compass aiming uses the phone's magnetic compass; enter your local declination for true north.
- **White balance**: phones auto-correct colour, so the reading is only a true Kelvin value on devices that let the app lock white balance (some Android Chrome builds). Otherwise it's a rough indication — a grey card and your camera's own WB are the reference.
- **Range finder**: not every phone can measure distance. *AR measure* uses WebXR hit-testing and needs an Android phone with ARCore in Chrome; iPhones can't do it in a browser. The *tilt method* works on any phone with a motion sensor: enter the camera height, aim at where the subject meets the ground, and distance = height ÷ tan(tilt); aim at the top for the subject's height. Expect about ±10% on level ground.
- **Noise**: phone mics aren't calibrated. Match the offset once against a reference meter; treat results as an estimate.

## Layout

```
index.html  styles.css  sw.js  manifest.webmanifest
js/app.js        shell, tab switching, storage sheet
js/rolodex.js    3D tab drum
js/store.js      database, sync engine
js/providers.js  Dropbox, Google Drive and local-file adapters
js/form.js       schema-driven edit forms
js/suncalc.js    sun + Polaris maths
js/pages/*.js    one file per section
js/map.js        map preview, directions links, address lookup
js/install.js    install prompt / Add-to-Home-Screen help
js/link.js       direct device-to-device link (WebRTC), clock offset measurement
js/qr.js         QR generate / camera decode
js/range.js      range finder (WebXR hit-test + tilt method)
js/calendar.js   .ics, add-to-calendar links, live feed, two-way sync (Google / Microsoft)
js/tour.js       first-run spotlight walkthrough
.github/workflows/pages.yml  deploy to GitHub Pages
js/timecode.js   SMPTE timecode maths (drop-frame aware)
js/docx.js       .docx reader (no library) and script line classification
vendor/qrcode.js qrcode-generator (MIT); vendor/jsQR.js jsQR (Apache-2.0)
```

## Tour and motion

- A short spotlight walkthrough runs on first launch and can be replayed from **Aa → Take the tour again**.
- Animation has three settings under **Aa**: *Rolodex + small touches* (default: the drum spins, pages fade in, buttons press, cards lift, new notes pop in, REC blinks softly, the tour spotlight glides), *Rolodex only*, and *None*. The phone's reduce-motion setting switches everything off regardless.

## Accessibility

- Every button, chip, tab and checkbox is at least 44 px (48 px on touch screens), with a visible focus ring.
- **Motion is deliberately small**: the Rolodex bar spins and page content fades in softly (opacity only); pages, sheets and buttons never slide or flip. Under **Aa → Animation** you can keep only the Rolodex, or turn everything off. All motion stops automatically when the device asks for reduced motion.
- **Aa** button (and Settings → Display): colour theme (Brass, Noir, Forest, Ocean, Plum, Mono) with light / dark / follow-device, text size, extra-large buttons, high contrast, animation, vibration feedback.
- Dialogs trap focus and return it on close, the page behind is hidden from screen readers while one is open, and section changes are announced. Forms never close by accident when tapping outside them.

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
| 7 | **Field** | Sun planner (rise/set, golden & blue hour, bearings, time scrubber), Polaris finder, white-balance reader (camera), noise meter (microphone). |

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
| **Google Drive** | every browser incl. iPhone | In Google Cloud Console enable the Drive API, create an OAuth *Web* client ID with your hosted origin as an authorised JavaScript origin, paste the **client ID**. Uses only the hidden app-data folder. Google tokens last ~1 hour, so tap *Reconnect* now and then. |
| **File in a synced folder** | Chrome/Edge/Android | Pick a file inside any Drive/Dropbox/OneDrive/iCloud folder. |
| **Export / Import** | everywhere | Manual backup (Share → Save to Files). |

Dropbox and Google need HTTPS hosting (e.g. GitHub Pages) so the sign-in can return to the app. The keys/IDs are public identifiers, not secrets; they and the sign-in tokens are stored only in this browser. Sync is whole-file last-writer-wins, so avoid editing on two devices at once while offline.

## Timecode notes

- Each log has a **timecode mode**. *Free run*: the camera's clock always counts, so the app counts continuously from the sync moment. *Record run*: the camera only counts while recording, so you tap **● Roll** and **■ Cut** with the camera; the clock holds between takes, and each take is logged as a note with its length (switch that off in the log settings).
- When syncing in record run, tick "the camera is recording right now" only if it is; a stopped camera shows its last recorded timecode, and the app holds there until you tap Roll.
- The sync moment is the instant you tap Sync (typed) or Scan (camera); a slow OCR read doesn't put you out. Re-sync if the camera's clock is reset.
- Camera scanning uses Tesseract OCR loaded from a CDN on first use (needs a connection once; the reader is then cached by the browser). Glare, tilt and tiny displays defeat it — typing the value is always available.
- **Script marking**: add the script to a log (Script tab) from a Word .docx, a .txt/Fountain file, pasted text, or — on Android — by sharing the file straight to Logi from Google Docs (⋮ → Share & export → Send a copy → Word). Google Docs can't be read directly by an app, so on iPhone download it as Word or copy-paste. Tap a line to select it, or press and hold to select words, then **Mark** (or **Mark + note**): the note is stamped with the camera timecode and pinned to that line, shown as a highlight with a timecode badge, like a lined script. Notes list the quoted line and jump back to it; exports include it.
- Phone clocks drift about a second a day against a camera's crystal, so re-sync on long days.

## Field-tool accuracy

- **Sun / Polaris** use standard astronomical formulas (checked against known solstice values). Times display in the device's time zone. Compass aiming uses the phone's magnetic compass; enter your local declination for true north.
- **White balance**: phones auto-correct colour, so the reading is only a true Kelvin value on devices that let the app lock white balance (some Android Chrome builds). Otherwise it's a rough indication — a grey card and your camera's own WB are the reference.
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
.github/workflows/pages.yml  deploy to GitHub Pages
js/timecode.js   SMPTE timecode maths (drop-frame aware)
js/docx.js       .docx reader (no library) and script line classification
vendor/qrcode.js qrcode-generator (MIT)
```

## Accessibility

- Every button, chip, tab and checkbox is at least 44 px (48 px on touch screens), with a visible focus ring.
- **Motion is deliberately small**: the Rolodex bar spins and page content fades in softly (opacity only); pages, sheets and buttons never slide or flip. Under **Aa → Animation** you can keep only the Rolodex, or turn everything off. All motion stops automatically when the device asks for reduced motion.
- **Aa** button: text size, extra-large buttons, high contrast, animation, vibration feedback.
- Dialogs trap focus and return it on close, the page behind is hidden from screen readers while one is open, and section changes are announced. Forms never close by accident when tapping outside them.

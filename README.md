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
vendor/qrcode.js qrcode-generator (MIT)
```

## Accessibility

- Every button, chip, tab and checkbox is at least 44 px (48 px on touch screens), with a visible focus ring.
- **Motion is deliberately small**: the Rolodex bar spins and page content fades in softly (opacity only); pages, sheets and buttons never slide or flip. Under **Aa → Animation** you can keep only the Rolodex, or turn everything off. All motion stops automatically when the device asks for reduced motion.
- **Aa** button: text size, extra-large buttons, high contrast, animation, vibration feedback.
- Dialogs trap focus and return it on close, the page behind is hidden from screen readers while one is open, and section changes are announced. Forms never close by accident when tapping outside them.

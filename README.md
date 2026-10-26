# Logi Production Deck

An installable (PWA) app for freelance videographers and small video businesses. A 3D **Rolodex** drum at the top cycles through the sections — drag/swipe it, tap the ▲▼ buttons, use the arrow keys or the mouse wheel.

| # | Section | What it does |
|---|---------|--------------|
| 1 | **Bookings** | Month calendar → tap a day → all bookings that day → tap a booking for address, stakeholders (tap-to-call), crew, notes and the **equipment list pulled from your gear inventory**. Warns when kit is double-booked on the same day. Shows sunrise/sunset/golden hour for the day once you've set a location. |
| 2 | **Crew** | Trusted crew by role, with call/text/email buttons, a "View work" link to their portfolio, and their upcoming bookings. |
| 3 | **Equipment** | Everything you own by category with serials and values, and which upcoming projects each item is booked on. |
| 4 | **Insurance** | Policies, claims lines, renewal countdown, and a warning if equipment cover is below the value of your logged kit. |
| 5 | **Me** | Your details, a **QR code** (vCard contact card, or a link to your website), share as `.vcf`. |
| 6 | **Field** | Sun planner (rise/set, golden & blue hour, bearings, time scrubber), Polaris finder, white-balance reader (camera), noise meter (microphone). |

## Run it

It's a static site with no build step — serve the folder over HTTP:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Camera, microphone, location and the service worker (offline/install) need **HTTPS** (or `localhost`). Easiest: publish the repo with GitHub Pages / Netlify / Cloudflare Pages, open the URL on your phone and "Add to Home Screen".

## Your data and cloud storage

All data is one JSON document, kept on the device and (optionally) mirrored to a file **you** choose:

- **Chrome / Edge / Android Chrome:** ☁ button → *Create database file…* and pick a file inside your Google Drive, Dropbox, OneDrive or iCloud Drive folder. Every change is written to that file; your cloud client syncs it. Newest copy wins when the app opens or regains focus. After a browser restart you may be asked to tap *Reconnect* (a browser permission rule).
- **iOS Safari / Firefox** (no file-write API): use *Export backup* (share sheet → Save to Files / iCloud Drive) and *Import backup*.
- Nothing is sent to any server; there is no account.

Sync is last-writer-wins on the whole file, so avoid editing on two devices at once while offline.

## Field-tool accuracy

- **Sun / Polaris** use standard astronomical formulas (checked against known solstice values). Times display in the device's time zone. Compass aiming uses the phone's magnetic compass; enter your local declination for true north.
- **White balance**: phones auto-correct colour, so the reading is only a true Kelvin value on devices that let the app lock white balance (some Android Chrome builds). Otherwise it's a rough indication — a grey card and your camera's own WB are the reference.
- **Noise**: phone mics aren't calibrated. Match the offset once against a reference meter; treat results as an estimate.

## Layout

```
index.html  styles.css  sw.js  manifest.webmanifest
js/app.js        shell, tab switching, storage sheet
js/rolodex.js    3D tab drum
js/store.js      database, cloud-file sync
js/form.js       schema-driven edit forms
js/suncalc.js    sun + Polaris maths
js/pages/*.js    one file per section
vendor/qrcode.js qrcode-generator (MIT)
```

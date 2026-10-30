# For developers

Vdex is a static web app: plain HTML, CSS and JavaScript modules, no build step, no framework, no backend.

**Run it locally**
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
Camera, microphone, location, notifications and installing need https or `localhost`.

**Tests.** `npm install`, then `npx playwright install chromium` once and `npm test`: the browser specs in `tests/specs` run against a scratch copy of the app (the lock and vault, biometric unlock through a virtual authenticator, the call sheet builder and PDF, the update cycle, templates and themes, performance, money, weather and the service log). `npm run test:desktop` launches the desktop app (under `xvfb-run` on Linux). `.github/workflows/tests.yml` runs both on every push and pull request.

**Signing the desktop apps (optional).** Add these repository secrets and the installers come out signed; without them they are unsigned, as before. Mac: `MAC_CERT_P12` (a Developer ID Application certificate exported as .p12 and base64-encoded), `MAC_CERT_PASSWORD`, and for notarization `APPLE_ID`, `APPLE_APP_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`; a signed and notarized Mac build updates itself through the same release metadata as Windows and Linux, and loses the “unidentified developer” warning. Windows: `WIN_CERT_PFX` (base64) and `WIN_CERT_PASSWORD`. The Mac build uses the hardened runtime with the entitlements in `desktop/build/entitlements.mac.plist`.

**Releasing updates.** Pushing to `main` deploys the web app: the Pages workflow first runs `tools/stamp-build.mjs`, which writes the commit into `js/version.js` and `sw.js` and regenerates the service worker's offline file list from the tree, so every deploy is one versioned set of files and every installed web copy picks it up on its next open (the page checks on start, when it comes to the front, when the network returns and hourly, then offers a reload). For the desktop apps, bump `VERSION` in `js/version.js`, commit, and push a tag such as `v1.2.0`: the workflow builds the installers plus the `latest*.yml` update metadata and attaches them to a release, which installed Windows and Linux apps fetch by themselves through electron-updater (`desktop/updater.js`); Macs are told and sent to the download.

**Making the installers.** `npm install` once, then `npm run dist -- --win`, `--mac` or `--linux` builds `Vdex-Setup-<version>.exe`, `Vdex-<version>.pkg` or `Vdex-<version>.AppImage` into `dist/`, each on its own kind of computer (a Windows build on Linux also needs Wine). `.github/workflows/desktop.yml` builds all three on GitHub: open the **Actions** tab → **Build desktop installers** → **Run workflow**, then download them from the run's Artifacts; pushing a tag such as `v1.1.0` attaches them to a release of that name. The builds are unsigned; electron-builder picks up certificates through its `CSC_*` variables if you have them. The version comes from `js/version.js`.

**The desktop app** is `desktop/main.js`: Electron serving these same files from `http://localhost:47831`, so the service worker, storage and sign-ins behave exactly as in Chrome. Sign-in pop-ups and the print window stay inside the app; every other link opens in the system browser. Electron has no service-worker notifications, so `js/notify.js` shows plain ones there, and `js/install.js` treats the app as already installed.

**Security notes**
- `index.html` carries a Content Security Policy: scripts only from this origin and the three sign-in / OCR / Microsoft libraries, no inline scripts (the theme pre-paint lives in `js/prepaint.js`), workers from blob URLs for the OCR engine, frames only for Google and Microsoft sign-in, no plugins, no base-URI tricks.
- The two third-party scripts loaded at run time (MSAL and tesseract.js) are pinned to exact versions with Subresource Integrity hashes; Google's sign-in script changes too often for a hash.
- The DOM is built with `h()` text nodes; the only `innerHTML` uses carry generated QR SVG. User links go through `safeUrl` (http or https only); calendar and CSV output is escaped; the call-sheet print window escapes HTML.
- Dropbox sign-in uses PKCE with a random `state` checked on return. Google and Microsoft tokens live in memory or in the libraries' own cache; the Dropbox refresh token and the WebDAV password are kept in localStorage and are part of what the lock encrypts.
- The app lock (`js/lock.js`, `js/crypto.js`): a random 256-bit data key encrypts the database and those secrets with AES-256-GCM into `logi-vault`; the key is wrapped by a PBKDF2-SHA-256 key derived from the PIN (300,000 iterations, random salt) and, when enrolled, by a WebAuthn platform credential: with the PRF extension the wrapping key comes from the authenticator itself, otherwise the biometric gates a non-extractable key kept in IndexedDB and the assertion signature is verified. Plaintext copies exist only while the app is unlocked and visible; they are removed synchronously on hide, lock and page exit. Wrong PINs are rate-limited and can optionally wipe the device.
- Not covered, by design: the copy in your cloud storage is plain JSON protected by that account; the phone-to-laptop link trusts whoever scanned the code; a short PIN can be brute-forced offline by someone who copies the device's storage, which is why 6 or more digits and the device's own lock still matter.

**Platform notes**
- Install prompts come from `beforeinstallprompt` (Chromium); iOS gets written instructions (`js/install.js`).
- The synced-folder storage uses the File System Access API, so it is offered only where `showSaveFilePicker` exists (desktop Chromium).
- Script files can be shared into the app through the Web Share Target in `manifest.webmanifest` and `sw.js` (Android Chrome); elsewhere the file picker and paste are used.
- Break notifications are local (service-worker `showNotification` on timers), so they depend on the page staying alive; there is no push server.
- Motion sensors use `DeviceOrientationEvent.requestPermission` where it exists (iOS) and `deviceorientationabsolute` elsewhere.
- The desktop app has no network geolocation (that needs a Google API key in Electron), so the location is entered by hand there.

**Where things are**
```
index.html  styles.css  sw.js  manifest.webmanifest   app shell, styles, service worker (offline, share target, notifications), install manifest
js/app.js        startup, Rolodex tabs, header
js/rolodex.js    the 3D drum
js/store.js      the database, record-by-record merging, cloud sync engine
js/providers.js  Dropbox, Google Drive, OneDrive, WebDAV and local-file adapters; Google and Microsoft sign-in
js/storage-ui.js storage panel and backups
js/form.js       schema-driven edit forms
js/pages/        one file per Rolodex card (bookings, crew, gear with the service log, venues, insurance, me, field, tcnotes, settings)
js/workflow.js   stages, checklist templates, project templates, pipeline, hires, shot list, media log, deliverables, licences
js/callsheet.js  call sheets: in-place editor, document, in-app printing, PDF, web page, list     js/pdf.js   small PDF writer (no library)
js/hours.js      shifts, breaks, statistics, chart     js/clock.js   the shoot-day clock bar     js/notify.js  break notifications
js/calendar.js   .ics, add-to-calendar links, live feed, two-way sync
js/timecode.js   SMPTE timecode maths (drop-frame aware)     js/docx.js   .docx reader and script line classification
js/link.js       phone–laptop link over WebRTC with clock-offset measurement     js/qr.js   QR generate / decode
js/suncalc.js    sun and Polaris     js/range.js   range finder (WebXR + tilt)     js/map.js   map preview and directions
js/a11y.js       themes, text size, motion, accessibility     js/tour.js   spotlight walkthrough engine, first-run tour     js/tutorials.js   per-page tutorials behind the ? button     js/install.js   install prompt
js/lock.js       PIN / biometric lock and the encrypted vault     js/crypto.js   WebCrypto helpers     js/backup.js   backup health, encrypted backups, cloud restore, asset register
js/update.js     service worker registration, update checks, the "new version" bar     tools/stamp-build.mjs   stamps a deploy
js/money.js      quotes and invoices: suggested lines, documents, PDF, overview, billing settings     js/weather.js   Open-Meteo day forecast
desktop/         the desktop app (main.js), its preload bridge, the GitHub-release updater, its icon, and the version sync used by the installers
vendor/          qrcode-generator (MIT), jsQR (Apache-2.0); see vendor/LICENSES.md
```

**Versions.** The current version is shown under Settings → About. Version 1.0.0 (before the workflow features) is kept on the branch `claude/backup-v1.0.0`.

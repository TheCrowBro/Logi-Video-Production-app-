# For developers

Vdex is a static web app: plain HTML, CSS and JavaScript modules, no build step, no framework, no backend.

**Run it locally**
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
Camera, microphone, location, notifications and installing need https or `localhost`.

**Tests.** `npm install`, then `npx playwright install chromium` once and `npm test`: the browser specs in `tests/specs` run against a scratch copy of the app (the lock and vault, biometric unlock through a virtual authenticator, the call sheet builder and PDF, the update cycle, templates and themes, performance, money, weather and the service log). `npm run test:desktop` launches the desktop app (under `xvfb-run` on Linux). `.github/workflows/tests.yml` runs both on every push and pull request.

**Signing the desktop apps (optional).** Add these repository secrets and the installers come out signed; without them they are unsigned, as before. Mac: `MAC_CERT_P12` (a Developer ID Application certificate exported as .p12 and base64-encoded), `MAC_CERT_PASSWORD`, and for notarization `APPLE_ID`, `APPLE_APP_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`; a signed and notarized Mac build updates itself through the same release metadata as Windows and Linux, and loses the “unidentified developer” warning. Windows: `WIN_CERT_PFX` (base64) and `WIN_CERT_PASSWORD`. The Mac build uses the hardened runtime with the entitlements in `desktop/build/entitlements.mac.plist`.

**Where the website comes from.** The app's public address is `https://thecrowbro.github.io/Logi-Video-Production-app-/`. GitHub Pages serves it (*Settings → Pages → Source: GitHub Actions*), and GitHub's `github-pages` environment only accepts deployments made from `main`. The *Deploy to GitHub Pages* workflow (`.github/workflows/pages.yml`) therefore works in two steps: a push to the working branch `claude/videographer-gear-app-xlg8eb` runs the browser test suite and, when it passes, the `mirror` job moves `main` to that commit and starts the workflow again on `main`, where the `deploy` job stamps the build and publishes. So `main` is always exactly what is live, a broken push never reaches anyone's phone, and a change is on the site about six minutes after the push. *Run workflow* on `main` from the Actions tab publishes on demand. If the mirror step fails with "not a fast forward", someone committed to `main` directly: merge `main` into the working branch and push again. A fresh copy of the repository that still answers "404" needs Pages switched on once under *Settings → Pages* with *Source: GitHub Actions*, then the workflow run on `main`. Every installed copy picks each update up by itself.

**Releasing updates.** Every push to the working branch deploys the web app once the tests pass (through `main`, as above): the Pages workflow first runs `tools/stamp-build.mjs`, which writes the commit into `js/version.js` and `sw.js` and regenerates the service worker's offline file list from the tree, so every deploy is one versioned set of files and every installed web copy picks it up on its next open (the page checks on start, when it comes to the front, when the network returns and hourly, then offers a reload). For the desktop apps, bump `VERSION` in `js/version.js`, commit, and push a tag such as `v1.2.0`: the workflow builds the installers plus the `latest*.yml` update metadata and attaches them to a release, which installed Windows and Linux apps fetch by themselves through electron-updater (`desktop/updater.js`); Macs are told and sent to the download.

**Making the installers.** `npm install` once, then `npm run dist -- --win`, `--mac` or `--linux` builds `Vdex-Setup-<version>.exe`, `Vdex-<version>.pkg` or `Vdex-<version>.AppImage` into `dist/`, each on its own kind of computer (a Windows build on Linux also needs Wine). `.github/workflows/desktop.yml` builds all three on GitHub: open the **Actions** tab → **Build desktop installers** → **Run workflow**, then download them from the run's Artifacts; pushing a tag such as `v1.1.0` attaches them to a release of that name. The builds are unsigned; electron-builder picks up certificates through its `CSC_*` variables if you have them. The version comes from `js/version.js`.

**The Android app (Google Play)** is `android/`: a Trusted Web Activity generated with Bubblewrap (`@bubblewrap/core` 1.27) from `android/twa-manifest.json`, so the store app is a thin shell that opens the live site in Chrome with no browser UI, and website updates reach it on their own. It targets Android 16 (API 36), asks only for the notifications permission, and registers the web app's share target so files can be shared into it. `.github/workflows/android.yml` builds the bundle and the apk on every change to `android/` (or by hand), signs them, and attaches them to the rolling `android-latest` pre-release; the release notes name the signing certificate. The upload key is `android/upload-key.keystore.enc` (AES-256, PBKDF2) and is unlocked with the `ANDROID_KEY_PASSPHRASE` repository secret, which is also the keystore password; without the secret the workflow signs with a throwaway key and says so. `.well-known/assetlinks.json` carries the upload key's certificate fingerprint; Google's own app-signing fingerprint has to be added there after the first Play upload, and the file only counts once it is served from the root of the site's domain. To change the shell (icon, name, start address, version), edit `twa-manifest.json`, raise `appVersionCode`, and regenerate with `npx @bubblewrap/cli@1.27.0 update --manifest=android/twa-manifest.json`, or edit `android/app/build.gradle` directly for the version alone. Store listing texts, the checklist for the account owner and the data safety answers are in `docs/google-play.md`; the store pictures are in `store/android/`.

**Start-up and storage costs.** Only the Bookings section and the shared modules load with the app (28 modules, about 350 KB unminified); the other eight sections and the tutorials are fetched the first time they are opened, and `index.html` lists the start-up modules as `modulepreload` hints so a first visit fetches them in one go instead of discovering the import chain level by level. The service worker registers after the page has loaded and precaches with `cache: 'no-cache'`, so the offline copy costs revalidations rather than a second download. Store writes are coalesced: a burst of changes in one task is serialised and written once, and sealing flushes first. Spec 50 keeps all of this honest: the preload list must equal the real start-up graph, the lazy sections must not load at start-up, and a burst of writes must store once.

**Getting paid** is built around links rather than a processor. `js/pay.js` turns the settings into Pay buttons with the balance and the invoice number filled in (PayPal.Me takes `name/amountCODE`, Venmo and Cash App take the amount in the address, any payment page gets `{amount}` and `{reference}` substituted), plus bank lines and an EPC069-12 payload for the bank QR (euro amounts only, as the standard requires). `snapshot(b, kind)` in `js/money.js` is the self-contained copy of a document that everything renders from; `shareLink` packs it with `js/link-pack.js` into `invoice.html#1.<base64url deflate-raw>` (`0.` when the browser has no CompressionStream), and `js/invoice-page.js` unpacks and draws it with the same `money-doc.js` renderer, so the client's page and the app can never disagree. The fragment never leaves the browser, which is why no server is involved. Payments live on the invoice as `payments[]`; `calc()` derives paid and balance, and an invoice marked Paid with nothing recorded counts as paid in full, which keeps older records right. The ways to pay are a list (`billing.payMethods`, each `{ type, value, label }` or bank fields) drawn from `PAY_TYPES` in `js/pay.js`; `methodsOf()` also reads the older fixed fields, so earlier settings and earlier links still work. Spec 90 covers settings and the catalogue, buttons, QR, payments, the link, the public page, reminders, the overview and the CSV.

**The timecode course.** `tccourse` in `js/tutorials.js` is a 27-step walkthrough whose `before` hooks open and close the Sync, Link and Export sheets and switch the notes and script tabs as it goes; cards with `target: null` are read-only interludes. It runs on a practice log that `openPracticeLog()` in `js/pages/tcnotes.js` creates (synced ten minutes ago at 01:00:00:00, three notes, one script mark, the sample script, `practice: true`). `openTcGuide()` is the readable guide, opened from the 📖 button on the logs page, the tutorials chooser and the timecode tutorials' first card. Spec 70 walks the course and checks the guide.

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
js/app.js        startup, Rolodex tabs, header; every section but Bookings loads the first time it is opened
js/money.js      quotes and invoices: settings, suggested lines, payments and balances, the client's link, reminders, the overview
js/money-doc.js  the document itself from a self-contained snapshot (page, print, PDF, email text, public page)
js/pay.js        payment links (PayPal.Me, Venmo, Cash App, any payment page, UPI), bank lines, the EPC bank QR
js/link-pack.js  packs a document into a link (deflate + base64url in the URL fragment) and unpacks it
js/doc-css.js    print and standalone styles shared by the call sheet, the money documents and the public page
invoice.html     the page a client opens: js/invoice-page.js renders the packed document with Pay buttons
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

# Vdex on the App Store

This is the step-by-step for putting Vdex on the iPhone App Store, written for the person who owns the Apple account. The technical side is in the repository under `apple/`: an iPhone app that opens https://vdex.crowmade.app in its own window and adds what only an app can do on an iPhone: break alerts when the app is closed, scripts and shot lists sent to Vdex from other apps, a "Vdex bookings" calendar on the phone, backups in the Files app, and buying the licence through the App Store. Every change published to the website reaches the app at once; the app itself only needs a new version when something native changes.

**What you need.** A Mac with Xcode (the free developer tools from the Mac App Store), an Apple Developer account (99 USD a year), and the iPhone you will test on. Windows and Linux cannot build or sign an iPhone app; the Mac can be any model from 2020 on.

## Two ways to buy, on the iPhone

Apple's rules: anything bought inside an iPhone app must go through Apple's own purchase (Apple keeps 15 % under the Small Business Program, 30 % otherwise). So the app offers both:

1. **Buy in the app:** a one-off "Vdex Licence" at 19.99 USD through the App Store. The app sends Apple's signed receipt to vdex.crowmade.app, which turns it into an ordinary Vdex licence (the same 3 devices, the same code, the same email flow when the person adds an email). A refund through Apple cancels it, as a Stripe refund does.
2. **Sign in:** someone who bought on the website signs in with that email, as on Android.

The app never links to the website's Buy page, and the website's Buy page is never shown inside the app: Apple rejects apps that point to a cheaper purchase elsewhere.

## Step 1. Open the Apple Developer account

1. On the Mac, go to https://developer.apple.com/programs/enroll/ and sign in with the Apple ID that will own the app (make one at https://appleid.apple.com if you want it separate from your personal one, with two-factor sign-in on).
2. Choose **Individual** unless you have a registered company (a company needs a D-U-N-S number and takes longer).
3. Pay the yearly fee (99 USD). Apple checks the identity; it usually takes a day, sometimes a week. You get an email when the account is active.
4. Then, in **App Store Connect** (https://appstoreconnect.apple.com) → **Business** (or Agreements, Tax, and Banking): accept the **Paid Apps** agreement, add your bank account and fill in the tax forms. This is what lets the app sell the licence; without it the purchase never shows up. (For the US form, you are a sole proprietor unless you have a company.)
5. Optional but worth it: apply for the **App Store Small Business Program** (https://developer.apple.com/app-store/small-business-program/), which cuts Apple's share to 15 % while you earn under 1 million USD a year.

## Step 2. Set the Mac up (one time)

1. Install **Xcode** from the Mac App Store (it is large; let it finish), open it once and let it install its extra components.
2. Install **Node.js** from https://nodejs.org (the LTS version).
3. Get the code: install Git if the Mac asks, then in Terminal:
   ```
   git clone https://github.com/TheCrowBro/Logi-Video-Production-app-.git vdex
   cd vdex/apple
   npm install
   npx cap sync ios
   npx cap open ios
   ```
   The last line opens the project in Xcode.
4. In Xcode: **Xcode → Settings → Accounts** → **+** → sign in with the developer Apple ID.
5. Select the **App** target → **Signing & Capabilities**: tick **Automatically manage signing** and choose your team. Xcode makes the certificates and the app's profile itself. The bundle identifier is `app.crowmade.vdex` and must stay so.
6. Still under Signing & Capabilities, press **+ Capability** and add **In-App Purchase**. (Push Notifications is not needed: break alerts are local notifications.)
7. Plug in your iPhone, pick it at the top of Xcode and press **Run** (▶). The first time, the iPhone asks you to trust the developer under Settings → General → VPN & Device Management. Vdex opens on the phone.

## Step 3. Create the app in App Store Connect

1. https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**.
2. Platform **iOS**, name **Vdex**, primary language English, bundle ID **app.crowmade.vdex** (it appears in the list once Xcode has registered it; otherwise register it at https://developer.apple.com/account/resources/identifiers/list with the In-App Purchase capability ticked), SKU `vdex-ios-1`, full access.

## Step 4. The licence as an in-app purchase

1. In the app's page → **Monetization → In-App Purchases** → **+**.
2. Type **Non-Consumable**, reference name `Vdex Licence`, product ID **`app.crowmade.vdex.licence`** (the app asks for exactly this id; it can never change).
3. Price: pick the tier closest to **19.99 USD** (Apple sets the other currencies).
4. Localization: display name **Vdex Licence**, description **One licence for up to 3 of your devices: cloud storage, backups and spreadsheets, for good.**
5. Review screenshot: any screenshot of the licence panel in Settings → General → About & Licence (Apple needs one).
6. Save. It says "Ready to Submit" and is submitted together with the app's first version.

## Step 5. Tell Apple where to send refund notices

A refund or a chargeback through Apple should cancel the licence, as a Stripe refund does. App Store Connect → **Business** (or General → App Information) → **App Store Server Notifications**:
- Production server URL: `https://vdex.crowmade.app/licence/apple/notify`
- Sandbox server URL: the same address
- Version 2 notifications.

Then give the website Apple's app identifiers so it can check receipts: in Cloudflare → Workers → the `vdex` worker → Settings → Variables, add `APPLE_BUNDLE_ID` = `app.crowmade.vdex`. Nothing secret is needed: Apple signs every receipt, and the website checks that signature against Apple's own root certificate, which is built in.

## Step 6. The store listing

Most of it is the Google Play text, which lives in [google-play.md](google-play.md) under "Texts to paste"; the differences:

- **Subtitle** (30 characters): `Bookings, crew, kit, call sheets`
- **Promotional text**: `Your whole production in one deck, on your phone and your computer.`
- **Keywords**: `videographer,film,production,call sheet,crew,equipment,stripboard,timecode,invoice,booking`
- **Support URL**: https://vdex.crowmade.app/docs/full-guide.md · **Marketing URL**: https://vdex.crowmade.app · **Privacy policy URL**: https://vdex.crowmade.app/privacy.html
- **Category**: Productivity (secondary: Business).
- **Age rating**: answer No to everything → 4+.
- **Screenshots**: the Android ones under `store/android/screenshots` are the wrong shape; take iPhone ones from the phone (Settings → Developer → or simply the side-button + volume-up shortcut) at 6.7-inch and 6.1-inch sizes, with the Bookings calendar, a booking, the call sheet, the stripboard and the quote.
- **App Privacy** (the nutrition label): Vdex collects no data. Answer **No, we do not collect data from this app** (the licence email goes to your own website only when the person buys or signs in, which Apple counts as not collected by the app's developer for tracking; say in the review notes that the website keeps the licence email and nothing else).
- **Sign-in information for the review**: the reviewer needs to try the app. Under App Review Information write: "No account is needed; the app has a 30-day free trial. To test the licence sign-in, use the code we attached" and attach a free licence code made with the licence generator (docs/selling-desktop.md).
- **Notes for the reviewer**: "Vdex is a web app for freelance videographers that runs in this app with native notifications, calendar, Files and the App Store purchase. The licence can be bought in the app (In-App Purchase) or, for people who already bought on our website, by signing in with their email. The app never shows the website's purchase."

## Step 7. Test on your phone, then with TestFlight

1. Run from Xcode once more; try the native parts: start a break on a booking and lock the phone (the alert comes, with Back to work on it), share a .docx script from Files or Mail to Vdex (Vdex asks whether it is a script or a shot list), connect the calendar under Bookings → Calendar & email → This phone's calendar (the "Vdex bookings" calendar appears in the Calendar app), export a backup (the Files picker opens), and print a call sheet (the print sheet opens).
2. Sandbox purchases: Settings → App Store → Sandbox Account on the iPhone, with a sandbox tester made in App Store Connect → Users and Access → Sandbox. Buy the licence in the app: Apple's sheet shows "[Environment: Sandbox]" and nothing is charged. Settings → General → About & Licence then says "Licensed".
3. In Xcode: **Product → Archive**, then **Distribute App → TestFlight & App Store → Upload**. After a few minutes the build is in App Store Connect → TestFlight; add yourself as a tester and install the TestFlight app on the phone.

## Step 8. Submit

1. App Store Connect → the app → **1.3 Prepare for Submission**: pick the uploaded build, check everything above, tick the In-App Purchase under "In-App Purchases and Subscriptions", and press **Add for Review**, then **Submit to App Review**.
2. Review takes one to three days. Common questions and the answers are in Step 6. If Apple asks why the licence can also be bought outside, answer: "The in-app purchase is offered to everyone; sign-in is only for people who already own a licence from our website, as Apple's guideline 3.1.3(b) allows for multiplatform services."
3. Once approved, choose **Manually release** or let it go out at once. Later versions: `git pull`, `npx cap sync ios`, bump the version in Xcode (App target → General → Version and Build), Archive, upload, submit.

## What is in the app, and what is not yet

- Everything on the website, at once. Install, Add to Home Screen and the browser's own buttons do not show.
- The lock: the PIN works as everywhere. Fingerprint and face unlock through the web standard (WebAuthn) is not available inside an iPhone app's web view, so the first version has no Face ID; a native Face ID unlock is planned for a later version.
- Break alerts come as the phone's own notifications, with Back to work and 5 more minutes.
- Scripts and shot lists: in any app's share sheet, choose Vdex (under the apps row, or "Copy to Vdex") for .docx, .txt, .md, .csv and .fountain files; Vdex asks whether they are a script for TC Notes or a shot list for a booking.
- Calendar: Settings → Calendar & email offers **This phone's calendar** beside Google and Outlook. It makes a "Vdex bookings" calendar in the Calendar app and keeps it in step both ways.
- Backups: export and import go through the Files picker (iCloud Drive, On My iPhone, Dropbox and so on). The app's own folder also shows in the Files app under On My iPhone → Vdex. Spreadsheets, calendar files and the asset register go the same way, and Share buttons open the phone's share sheet.
- Printing: Print on a call sheet, quote or invoice opens the phone's print sheet (AirPrint, or Save to Files for a PDF).
- The purchase: Buy a licence in Settings → General → About & Licence shows Apple's sheet at the App Store's price; a licence bought on the website is used with Sign in. After a reinstall, or on a second iPhone or iPad with the same Apple ID, the app finds the purchase by itself within a day, and Restore purchases does it at once.

## If something goes wrong

- **"Signing requires a development team"**: Step 2, point 5.
- **The purchase sheet never appears**: the Paid Apps agreement (Step 1, point 4) is not accepted, or the product id differs from `app.crowmade.vdex.licence`, or the product was created less than an hour ago.
- **"Vdex could not confirm the purchase"** after paying: the website could not check the receipt; the purchase is kept by Apple, and **Restore purchases** under About & Licence tries again (also after a reinstall or on a second iPhone with the same Apple ID).
- **Apple asks for a demo account**: Vdex has none; point to the free trial and the attached licence code.
- **The app shows a blank page the first time**: the phone has no connection; the app needs one once, then works offline.

# Vdex on the App Store

This is the step-by-step for putting Vdex on the iPhone App Store, written for the person who owns the Apple account. The technical side is in the repository under `apple/`: an iPhone app that opens https://vdex.crowmade.app in its own window and adds what only an app can do on an iPhone: break alerts when the app is closed, scripts and shot lists sent to Vdex from other apps, a "Vdex bookings" calendar on the phone, backups in the Files app, and buying the licence through the App Store. Every change published to the website reaches the app at once; the app itself only needs a new version when something native changes.

**What you need.** A Mac with Xcode (the free developer tools from the Mac App Store), an Apple Developer account (99 USD a year), and the iPhone you will test on. Windows and Linux cannot build or sign an iPhone app; the Mac can be any model from 2020 on.

## Two ways to buy, on the iPhone

Apple's rules: anything bought inside an iPhone app must go through Apple's own purchase (Apple keeps 15 % under the Small Business Program, 30 % otherwise). So the app offers both:

1. **Buy in the app:** a one-off "Vdex Licence" at 19.99 USD through the App Store. The app sends Apple's signed receipt to vdex.crowmade.app, which turns it into a Vdex licence that works on every iPhone and iPad of the buyer's Apple Account, as Apple's standard licence promises, without taking any of its 3 places; those stay free for the buyer's computers and Android phone (the same code and the same email flow when the person adds an email). A refund through Apple cancels it, as a Stripe refund does.
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
8. From now on, every change pushed to GitHub under `apple/` also runs an unsigned build of the app on GitHub's own Mac runners (the *iPhone app* workflow, `.github/workflows/ios.yml`, under the repository's **Actions** tab), which catches Swift errors before your Mac does. It cannot sign, archive or upload, so Steps 7 and 8 stay with your Mac; and because Mac minutes are dear, it runs only when something under `apple/` changes, or when you press **Run workflow** there.

## Step 3. Create the app in App Store Connect

1. https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**.
2. Platform **iOS**, name **Vdex**, primary language English, bundle ID **app.crowmade.vdex** (it appears in the list once Xcode has registered it; otherwise register it at https://developer.apple.com/account/resources/identifiers/list with the In-App Purchase capability ticked), SKU `vdex-ios-1`, full access.

## Step 4. The licence as an in-app purchase

1. In the app's page → **Monetization → In-App Purchases** → **+**.
2. Type **Non-Consumable**, reference name `Vdex Licence`, product ID **`app.crowmade.vdex.licence`** (the app asks for exactly this id; it can never change).
3. Price: pick the tier closest to **19.99 USD** (Apple sets the other currencies).
4. Localization: display name **Vdex Licence**, description **All your iPhones and iPads, for good.** (App Store Connect allows 30 characters for the name and 45 for the description.)
   Leave **Family Sharing** off for it: the licence is for one person.
5. Review screenshot: any screenshot of the licence panel in Settings → General → About & Licence (Apple needs one).
6. Save. It says "Ready to Submit" and is submitted together with the app's first version.

## Step 5. Tell Apple where to send refund notices

A refund or a chargeback through Apple should cancel the licence, as a Stripe refund does. App Store Connect → **Business** (or General → App Information) → **App Store Server Notifications**:
- Production server URL: `https://vdex.crowmade.app/licence/apple/notify`
- Sandbox server URL: the same address
- Version 2 notifications.

Then give the website Apple's app identifiers so it can check receipts: in Cloudflare → Workers → the `vdex` worker → Settings → Variables, add `APPLE_BUNDLE_ID` = `app.crowmade.vdex`. Nothing secret is needed: Apple signs every receipt, and the website checks that signature against Apple's own root certificate, which is built in.

The website's sign-in must be switched on too (`WEB_SIGN_IN` = `on`, with its email settings: docs/selling-desktop.md, part 9). Without it, nothing about licences shows in the app at all, neither the trial nor the purchase, and Apple's reviewer would find no in-app purchase to test.

Add a second variable there, `APPLE_ALLOW_SANDBOX` = `on`. TestFlight, your own sandbox tester (Step 7) and Apple's reviewers all buy in Apple's **Sandbox** environment, where nothing is charged, so the licence server has to accept sandbox purchases while you test and while the app is under review; without it, such a purchase is refused with "That is a test purchase, which does not license Vdex". A sandbox purchase gets a licence of its own, which never touches a real one: it can neither unlock nor cancel anything bought for real. It licenses that phone for 30 days and nothing else: it has no code for the desktop app and cannot have an email address added. The variable can stay on for good, because a sandbox purchase needs a sandbox tester account that only you or Apple's reviewers have; or delete it between reviews and add it back before the next one.

## Step 6. The store listing

Most of it is the Google Play text, which lives in [google-play.md](google-play.md) under "Texts to paste"; the differences:

- **Subtitle** (at most 30 characters): `Shoots, crew, kit, call sheets`
- **Promotional text**: `Your whole production in one deck, on your phone and your computer.`
- **Keywords**: `videographer,film,production,call sheet,crew,equipment,stripboard,timecode,invoice,booking`
- **Support URL**: https://crowmade.app/vdex/ (Vdex's page on your own site, with its Support email link: Apple checks that the Support URL gives a direct way to reach you, so keep that link on the page). The `docs/` folder is never published, so a `.md` address would not open. · **Marketing URL**: https://vdex.crowmade.app · **Privacy policy URL**: https://vdex.crowmade.app/privacy.html
- **Category**: Productivity (secondary: Business).
- **Age rating**: answer No to the content questions (violence, sexual content, gambling and so on). Where the questionnaire asks about what the app can do, say that it has **user-generated content** from version 1.4.0 on: a user can pass a booking, their contact card or an equipment list to another user as a link or QR code, and the other user can add it to their own Vdex. It has no messaging or chat, no public content, no advertising, and each such page has "Report this page: support@crowmade.app". If you answered these questions before this version, answer them again. Then set the age rating to **18+** (App Store Connect lets an app with a higher minimum age than its content needs choose a higher rating). Vdex's terms ask for users of 18 or over, and the Google Play listing is 18 and over too.
- **Screenshots**: the app is offered for iPhone only (an iPad runs it in compatibility mode, as a scaled-up iPhone app), so App Store Connect asks for iPhone screenshots only. Its upload page lists the sizes it needs (at the moment the 6.9-inch size, which also takes 6.7-inch pictures); take them on your phone and App Store Connect scales them for the smaller sizes. The Android ones under `store/android/screenshots` are the wrong shape: take iPhone ones on the phone (press the side button and volume up together) of the Bookings calendar, a booking, the call sheet, the stripboard and the quote, and keep them under `store/apple/screenshots`, next to the 1024 × 1024 icon (`store/apple/icon-1024.png`, the same picture that is built into the app, which App Store Connect takes from the uploaded build).
- **App Privacy** (the nutrition label): press **Get Started** and answer as in "App Privacy answers" below: four data types, none of them used for tracking.
- **Sign-in information for the review**: the reviewer needs to try the app, and the iPhone app takes no licence codes (Apple's rule), only an email sign-in or the purchase. Apple's reviewers cannot read someone else's mailbox, so they sign in with the review address and its fixed code, which sends no email: set the two up as "The reviewers' sign-in" in [google-play.md](google-play.md) describes (two settings on the licence server, and a free licence with an end date for the address), and change the code after each review. Under App Review Information write the text below, with the real address and code in place of the two placeholders (they are never written in this guide or anywhere in the repository), and give the same address and code in the sign-in fields:

  ```
  No account is needed; the app has a 30-day free trial and the licence can be bought in the app (In-App Purchase). To test signing in with a licence bought on our website: Settings → General → About & Licence → Sign in. Sign in with <review address> and the code <review code>. The code does not change and no mailbox is needed.
  ```
- **License agreement**: leave Apple's standard licence agreement in place (App Store Connect → App Information → License Agreement: do not upload your own). Section 21 of Vdex's terms of service already contains what Apple asks of an app's own terms, so the two fit together.
- **Account deletion** (Apple's guideline 5.1.1(v)): there is no account to create, but a licence can be linked to an email address, so the app has **Delete my licence records** under Settings → General → About & Licence. Mention it in the notes below if the reviewer asks.
- **Notes for the reviewer**: "Vdex is a web app for freelance videographers that runs in this app with native notifications, calendar, Files and the App Store purchase. The licence can be bought in the app (In-App Purchase) or, for people who already bought on our website, by signing in with their email. The app never shows the website's purchase."

## Step 7. Test on your phone, then with TestFlight

1. Run from Xcode once more; try the native parts: start a break on a booking and lock the phone (the alert comes, with Back to work on it), share a .docx script from Files or Mail to Vdex (Vdex asks whether it is a script or a shot list), connect the calendar under Bookings → Calendar & email → This phone's calendar (the "Vdex bookings" calendar appears in the Calendar app), export a backup (the Files picker opens), and print a call sheet (the print sheet opens).
2. Sandbox purchases: Settings → App Store → Sandbox Account on the iPhone, with a sandbox tester made in App Store Connect → Users and Access → Sandbox. Buy the licence in the app: Apple's sheet shows "[Environment: Sandbox]" and nothing is charged. Settings → General → About & Licence then says "Licensed". This only works while `APPLE_ALLOW_SANDBOX` is `on` on the website's Worker (Step 5); otherwise the app answers "That is a test purchase, which does not license Vdex".
3. In Xcode: **Product → Archive**, then **Distribute App → TestFlight & App Store → Upload**. After a few minutes the build is in App Store Connect → TestFlight; add yourself as a tester and install the TestFlight app on the phone. Every upload to App Store Connect needs a higher **Build** number than the one before, even for the same version (unlike Google Play, where GitHub's build carries the number): before each Archive, select the App target → **General** and raise **Build** by one (it is `CURRENT_PROJECT_VERSION` in the project). **Version** is kept equal to the website's by the code, so leave it alone.

### First run on the Mac: what to check

Before the upload in point 3, go through this list on the phone. Each item is something only the app can do, so the website's own tests never see it:

- **Offline.** Open Vdex once with a connection, close it, turn on Airplane Mode and open it again: it starts and shows your bookings (the app keeps an offline copy of the website, which the first visit registers).
- **A break alert with the app closed.** Open a booking, start a 15-minute break, close the app and lock the phone. When the break ends, the alert arrives on the lock screen; **Back to work** on it opens Vdex (after the PIN) with the break ended.
- **The phone's calendar.** Bookings → Calendar & email → **This phone's calendar**: the phone asks for calendar access, and a "Vdex bookings" calendar appears in the Calendar app with your shoots.
- **Files.** Export a backup (Settings → Storage, sync & backups): the Files picker opens and the file saves; Import opens the picker and reads it back.
- **Printing.** Print on a call sheet, a quote or an invoice opens the phone's print sheet.
- **The purchase.** With `APPLE_ALLOW_SANDBOX` = `on` (Step 5) and the sandbox tester signed in (point 2), Buy a licence under About & Licence goes through, and the page says "Licensed".
- **Cloud sign-ins.** Connecting Google Drive, iCloud, Dropbox or OneDrive opens the sign-in and comes back to the app with the storage connected (the sign-in window closes by itself). iCloud is the one to watch: its return relies on Apple sending the sign-in back to the page that asked for it. If iCloud's window stays open on Vdex's page instead of closing, tell me: the fix is a second iCloud API token for the app, set up in the CloudKit console.
- **The look.** The icon on the home screen is the Vdex camera on its dark background, and the picture shown while the app starts is the same logo on the same dark background, never a white screen.

## Step 8. Submit

1. App Store Connect → the app → **1.3 Prepare for Submission**: pick the uploaded build, check everything above, tick the In-App Purchase under "In-App Purchases and Subscriptions", and press **Add for Review**, then **Submit to App Review**. Apple's reviewers try the purchase in the Sandbox too, so `APPLE_ALLOW_SANDBOX` stays `on` (Step 5) for as long as the app is under review.
2. Review takes one to three days. Common questions and the answers are in Step 6. If Apple asks why the licence can also be bought outside, answer: "The in-app purchase is offered to everyone; sign-in is only for people who already own a licence from our website, as Apple's guideline 3.1.3(b) allows for multiplatform services."
3. Once approved, choose **Manually release** or let it go out at once. Later versions: `git pull`, `npx cap sync ios`, raise the Build number in Xcode (App target → General → Build; a new version number comes with the code), Archive, upload, submit.

## What is in the app, and what is not yet

- Everything on the website, at once. Install, Add to Home Screen and the browser's own buttons do not show.
- The lock: the PIN works as everywhere. Fingerprint and face unlock through the web standard (WebAuthn) is not available inside an iPhone app's web view, so the first version has no Face ID; a native Face ID unlock is planned for a later version.
- Break alerts come as the phone's own notifications, with Back to work and 5 more minutes.
- Scripts and shot lists: in any app's share sheet, choose Vdex (under the apps row, or "Copy to Vdex") for .docx, .txt, .md, .csv and .fountain files; Vdex asks whether they are a script for TC Notes or a shot list for a booking, and for a .csv also offers to bring it into Equipment as the kit list you already keep.
- Calendar: Settings → Calendar & email offers **This phone's calendar** beside Google and Outlook. It makes a "Vdex bookings" calendar in the Calendar app and keeps it in step both ways.
- Backups: export and import go through the Files picker (iCloud Drive, On My iPhone, Dropbox and so on). Spreadsheets, calendar files and the asset register go the same way, and Share buttons open the phone's share sheet.
- Printing: Print on a call sheet, quote or invoice opens the phone's print sheet (AirPrint, or Save to Files for a PDF).
- The purchase: Buy a licence in Settings → General → About & Licence shows Apple's sheet at the App Store's price; a licence bought on the website is used with Sign in. After a reinstall, or on a second iPhone or iPad with the same Apple ID, the app finds the purchase by itself within a day, and Restore purchases does it at once. The same licence works on the person's other devices too: **Add your email** puts an email address on it (a 6-digit code to that address), after which the website and the Android app sign in with it, and **Copy the code for the desktop app** gives the code to paste into the desktop app. No code is ever typed into the iPhone app (Apple's rule 3.1.1); the Sign in sheet there takes an email only.
- Cloud storage and calendar accounts: Google Drive, iCloud, Dropbox, OneDrive, Google Calendar and Outlook sign in through the phone's own sign-in window (the one Safari and other apps use), because none of those services sign in inside an app's web view. The answer comes back to the app by itself. Nothing needs registering for it beyond what the website already has (docs/turn-on-sign-in.md), except one optional Google address for a fallback, described there.

## App Privacy answers

Apple asks what the app does with people's information, as Google does (the "Data safety answers" in [google-play.md](google-play.md)). The whole list of what can leave the phone is in google-play.md and in the privacy policy; two of those things count here. The weather forecast sends the coordinates of the venue or, if it has none, of the location saved in Vdex (which may be the person's own), rounded to two decimal places, with the date, to Open-Meteo, which says it keeps server logs that can include coordinates for up to 90 days. And the licence: a purchase in the app sends Apple's signed receipt, with the purchase's transaction number, to Vdex's licence server, which keeps that number so the purchase can be found again and a refund cancels it; signing in instead sends the email address the person types, and the server emails it a sign-in code; either way the phone then takes one of the licence's places, which sends a random number made for that installation. So under App Privacy → **Get Started** answer **Yes, we collect data from this app**, tick these four data types, and answer the questions about each as in the table. Everything else: not collected.

Voice-follow in the teleprompter uses the web view's speech recognition, which the iPhone app does not have yet (it would need Apple's speech recogniser added to the app, and with it a microphone and speech recognition permission text in Info.plist and an **Audio Data** answer here). Until then the 🎙 button does not show in the iPhone app, and nothing here changes.

| Data type | Why it is collected | Linked to the user's identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| **Contact Info → Email Address** | Optional: only when the person signs in with a licence's email address, or adds an email address to an App Store licence; the server keeps which addresses belong to which licences. | Yes | No | App Functionality |
| **Identifiers → Device ID** | A random number made for the installation, so the licence's devices can be counted (never the phone's own identifier). | Yes | No | App Functionality |
| **Location → Precise Location** and **Coarse Location** | Optional: for the weather, sent to Open-Meteo rounded to two decimal places (about a kilometre); Open-Meteo says its server logs can hold coordinates for up to 90 days. The sun times are worked out on the phone. | No | No | App Functionality |
| **Purchases → Purchase History** | The App Store purchase's transaction number, kept by our licence server so the purchase can be found again (Restore purchases) and a refund cancels it. | Yes | No | App Functionality |

Why "not collected" for the rest (name, photos, files, contacts, usage, crash data…): everything a person types into Vdex about their work stays on the phone. When they link their own Google Drive (or iCloud, Dropbox or OneDrive, when Vdex offers them), the backup goes to the person's own account at their own request, which Apple does not count as collection by the developer. The links a person makes and sends themselves hold their contents inside the link and are stored nowhere online. The privacy policy explains all of it. If a reviewer asks for changes to this section, send me what they wrote and I will adjust the wording.

## If something goes wrong

- **"Signing requires a development team"**: Step 2, point 5.
- **The purchase sheet never appears**: the Paid Apps agreement (Step 1, point 4) is not accepted, or the product id differs from `app.crowmade.vdex.licence`, or the product was created less than an hour ago.
- **"Vdex could not confirm the purchase"** after paying: the website could not check the receipt; the purchase is kept by Apple, and **Restore purchases** under About & Licence tries again (also after a reinstall or on a second iPhone with the same Apple ID).
- **Apple asks for a demo account**: Vdex has none; point to the free trial, the in-app purchase, and the review address and its fixed code from Step 6.
- **The app shows a blank page the first time**: the phone has no connection; the app needs one once, then works offline.
- **The reviewer could not sign in, or the review code "does not work"**: check both settings are in Cloudflare and the review address's free licence has not passed its end date (docs/selling-desktop.md, part 10). After 5 wrong codes in a day from one connection, that connection is refused until the next day, and after 20 in a day from everyone together the review address is refused for everyone until the next day, the right code included: ask Apple to try again the day after.
- **"That is a test purchase, which does not license Vdex"**: the purchase was made in Apple's Sandbox (TestFlight, your sandbox tester, App Review) while `APPLE_ALLOW_SANDBOX` is not `on` on the Worker: Step 5.
- **The upload is refused because a build with this number already exists**: raise the Build number (Step 7, point 3) and Archive again.

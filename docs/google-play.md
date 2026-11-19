# Vdex on Google Play

This is the step-by-step for putting Vdex in the Google Play store, written for the person who owns the Google account. The technical side is done: GitHub builds and signs the Android app by itself, the privacy policy is published, and every text and picture the store asks for is ready below. What remains are the steps only the account owner can do. Each takes a few minutes, and the two-week test runs by itself.

**Do this on a computer if you can.** Google's Play Console works in a phone browser, but it is a lot of forms, and a bigger screen helps.

**The website is ready.** The Android app opens https://vdex.crowmade.app, which is live, so the app works as soon as it is installed.

## What you will paste or upload

| What | Where it is |
|---|---|
| Privacy policy address | https://vdex.crowmade.app/privacy.html |
| Terms of service address | https://vdex.crowmade.app/terms.html |
| Address for deleting licence records (Data safety asks for it) | https://vdex.crowmade.app/delete-account.html |
| The app file for Google Play (`vdex-android.aab`) | the newest run at https://github.com/TheCrowBro/Logi-Video-Production-app-/actions/workflows/android.yml → **Artifacts** at the bottom → `vdex-android` (a zip; kept for 3 days, so press **Run workflow** there for a fresh one). Every build has the same version number, so Google Play takes it only once: later releases reuse the uploaded bundle (Step 9) or need a raised version (see "Later: updates") |
| Icon, 512 × 512 | https://github.com/TheCrowBro/Logi-Video-Production-app-/blob/main/store/android/icon-512.png (press the download button) |
| Feature graphic, 1024 × 500 | https://github.com/TheCrowBro/Logi-Video-Production-app-/blob/main/store/android/feature-graphic.jpg |
| Phone and tablet screenshots | https://github.com/TheCrowBro/Logi-Video-Production-app-/tree/main/store/android/screenshots (the files are listed at the end of this page) |
| The app's package name (it can never change) | `app.crowmade.vdex` |
| The texts | the "Texts to paste" section below |

## Step 1. Open a Google Play developer account

1. Go to https://play.google.com/console/signup and sign in with the Google account that will own the app.
2. Choose **Yourself** (a personal account) unless you have a registered company, which Google asks a D-U-N-S number for.
3. Pay the one-time registration fee (US $25) and complete the identity check. Google asks for an ID document and may take a few days to confirm it.
4. Google also asks for a contact email that will be shown publicly on the store page (use `support@crowmade.app`), and a phone number for its own use.

## Step 1b. Your developer details (one time)

1. **Trader status.** Play Console → **Manage account** → **Account details** → **About you**, and declare that you are a trader (selling Vdex licences makes you one). Google then shows your name, a phone number and your legal address on the store page. That address must be a real street address that matches your ID: Google does not accept a PO box, so on a personal account it is normally your home address. (Showing a different address needs an organization account with its own registered address.) The phone number is entered separately, so a business number is fine.

The Android app is a free download (people pay for the licence on the website), so Google's payments profile, bank account, tax form, 15% fee programme and Japan's payment authorization are not needed.

## Step 2. Let GitHub sign the real app (one time)

The app has to be signed with a key that stays the same for every version, so that Google and phones accept each update. That key already exists. GitHub holds an encrypted copy, and the passphrase that unlocks it was sent to you privately in our chat, together with a backup copy of the key. Keep both in a password manager.

Until the passphrase is in GitHub, the builds are signed with a temporary key, and GitHub keeps no app file from them. Never upload a file from such a build to Google Play: Play would accept it, because the first upload sets the key it expects from then on, and every real build after it would be refused until Google resets the key, which takes days.

1. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/settings/secrets/actions
2. Press **New repository secret**.
3. Name: `ANDROID_KEY_PASSPHRASE`. Secret: paste the passphrase exactly as it was sent to you. Press **Add secret**.
4. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/actions/workflows/android.yml and press **Run workflow**, then the green **Run workflow** button.
5. About five minutes later the run turns green. Open it: its summary says "Signed with the upload key", and **Artifacts** at the bottom has `vdex-android`. That zip holds `vdex-android.aab`, the build to give Google.

The app is no longer on a public download page on GitHub: it is distributed through Google Play. Each build's `.aab` stays in its run's **Artifacts** for 3 days. While the code on GitHub is public, anyone signed in to GitHub could still download it, which matters little: it cannot be installed on a phone as it is, and it only opens the website. Once the code is private, only you can.

**Can't find the passphrase?** Before the first upload, make a new key: add the `ANDROID_KEY_PASSPHRASE` secret with a passphrase you choose (12 or more characters; write it in a password manager), then Actions → **Make a new Android key** → Run workflow → type `REPLACE`. It makes and locks the key itself, and the passphrase never leaves GitHub. (Or say so here.) Until the first upload to Google Play, a new key costs nothing: I make one in a few minutes and send you its passphrase. After the first upload, losing it means Google's process for registering a replacement upload key, which takes a couple of days.

## Step 3. Create the app in the Play Console

1. In the Play Console press **Create app**.
2. App name: `Vdex`. Default language: English. App or game: **App**. Free or paid: **Free**.

   > **Free, because the licence is the payment.** The Android app has the same 30-day trial as the website, then asks people to sign in with the licence they bought on vdex.crowmade.app (one licence covers 3 devices, and the phone takes one of them). Charging on Google Play too would make people pay twice. Google never lets an app offered for free become a paid one, so this choice is for good: if you would rather sell the Android app on Google Play instead, say so before creating the app.

3. Tick the declarations (developer programme policies and US export laws) and press **Create app**.

## Step 4. The store listing

Left menu → **Grow users** → **Store presence** → **Main store listing** (names in the console change now and then; look for "store listing").

1. **App name:** Vdex.
2. **Short description** and **Full description:** paste the texts from "Texts to paste" below.
3. **App icon:** upload `icon-512.png`.
4. **Feature graphic:** upload `feature-graphic.jpg`.
5. **Phone screenshots:** upload the `phone-*.jpg` files. **7-inch and 10-inch tablet screenshots:** upload the `tablet-*.jpg` files for both.
6. Save.

Then **Store settings**: app category **Productivity**; contact email: the address you want shown; website: `https://vdex.crowmade.app/`.

Then **Monetize with Play** → **Products** → **App pricing**: leave the app **Free**. The Android app has the same 30-day trial as the website, then people sign in with the email address of the licence they bought on vdex.crowmade.app (20 USD, for up to 3 devices; the phone takes one of the 3 places). Charging on Google Play as well would make them pay twice. Inside the Android app Vdex never shows a price or a link to buy, because Google Play only allows buying through Google Play inside a Play app; people buy on the website.

## Step 5. The questionnaires

Left menu → **Monitor and manage** → **Policy and programmes** → **App content** (older layouts call it just "App content"). Work through every item on the list:

| Item | Answer |
|---|---|
| Privacy policy | The privacy policy address from the table above. |
| Ads | **No, my app does not contain ads.** |
| App access | **All or some functionality is restricted.** Paste the instructions from "The reviewers' sign-in" below, with the real review address and review code in place of the two placeholders. They are never written in this guide or anywhere in the repository. |
| Content rating | Start the questionnaire, enter your email, choose **Utility, Productivity, Communication, or Other**. Answer **No** to violence, sexual content, bad language, drugs, gambling, sharing the user's location with other users, and purchases. For the question about users interacting or exchanging content with each other, answer **Yes** from this version on: a user can pass a booking, their contact card or an equipment list to another user as a link or QR code, and the other user can add it to their own Vdex. If the form asks for detail: the link is sent by the user with their own email or messaging app; there is no chat, no public page, no feed and no search of other users; nothing is stored online or by us, the receiver sees what a link holds before adding it, and every such page has "Report this page: support@crowmade.app". The rating should still come out as "Everyone", now with a "Users interact" note. If you answered this questionnaire before this version, answer it again. |
| Target audience and content | Age group: **18 and over** only. Designed for children: **No**. |
| News apps | **No.** |
| COVID-19 contact tracing and status apps | **Not a COVID-19 app.** |
| Data safety | See "Data safety answers" below. |
| Government apps | **No.** |
| Financial features | **My app doesn't provide any financial features.** (Vdex writes invoices but moves no money.) |
| Health | **My app does not have any health features.** |
| Advertising ID | **No, my app does not use advertising ID.** |

### The reviewers' sign-in

Google's reviewers cannot read someone else's mailbox, so they do not get the emailed 6-digit code. The licence server has a sign-in for them instead: one review address that takes one fixed code and sends no email.

1. Choose a review address (any address at your own domain; it needs no mailbox) and a review code of 6 digits, which is what the sign-in box takes. Keep both in your password manager.
2. Add them to the licence server as two **Secrets**, in the same place as the other settings (Cloudflare → Workers & Pages → the Worker **vdex** → Settings → Variables and Secrets; docs/selling-desktop.md names the two settings). With either one missing, the reviewers' sign-in does not exist.
3. Give the review address a free licence with an end date a few weeks after the review, in the generator page (docs/selling-desktop.md, part 10, step 3, which also says how many devices to allow), as for any other person: without a licence the address cannot sign in.
4. Paste these instructions under App access, with the address and the code in place of the two placeholders:

   ```
   Everything except cloud storage and saving backup or spreadsheet files works without signing in for 30 days from the first time the app is opened. Those, and changing anything after 30 days, need a Vdex licence: Settings → General → About & Licence → Sign in. Sign in with <review address> and the code <review code>. The code does not change and no mailbox is needed. When Vdex first opens it asks you to choose a PIN of 4 to 20 digits (any you like). It locks the information on the device; it is not an account.
   ```
5. After each review, change the review code (step 2), and let the free licence run out.

Wrong codes are limited, so the code cannot be found by trying: 5 a day from one internet connection, and 20 a day from everyone together, which is what an ordinary address allows in a day (4 codes, 5 tries each). Because the review code does not change, those 20 a day add up over the days, but at that rate finding it takes about 68 years on average. Part 10 of docs/selling-desktop.md has the details.

## Step 6. Upload the app to a closed test

Google requires new personal accounts to run a closed test with at least 12 testers for 14 days before an app can go public. The testers are friends or coworkers with an Android phone and a Google account.

1. Left menu → **Test and release** → **Testing** → **Closed testing** → **Create track**. Name it `Coworkers`.
2. **Testers** tab → **Create email list** → name it, paste the Google account emails of at least 12 coworkers (more is safer, in case some do not install), save, tick the list.
3. **Releases** tab → **Create new release**.
4. If Google asks about app signing, keep the default (**Use Google-generated key** / let Google manage the signing key) and continue.
5. Upload `vdex-android.aab` (from the `vdex-android` zip in the table above; unzip it first). The first upload fixes the app's package name, `app.crowmade.vdex`, for good.
6. Release notes: `First test build.` Press **Next**, fix anything it flags, then **Save**, **Review release**, and **Start rollout to Closed testing**.

## Step 7. The testers

1. On the **Testers** tab copy the **opt-in link** and send it to the coworkers on the list.
2. Each of them opens the link while signed in to the same Google account, presses **Become a tester**, then follows the Play Store link to install Vdex.
3. Ask them to keep it installed and to open it now and then for two weeks. Google counts testers who stay opted in for 14 days in a row, and it looks for some real use.

**Testers install it free.** The app is a free download with a 30-day trial, which covers the 14-day test.

## Step 8. Remove the browser bar at the top (asset link)

The Android app opens the website inside itself. Android shows a thin browser bar at the top until the website proves that the app belongs to it. That proof is a small file on the website containing the fingerprint of Google's signing certificate for the app. Two things are needed:

1. **The fingerprint.** After the first upload, in the Play Console go to **Test and release** → **Setup** → **App signing** (sometimes under "App integrity"). Under **App signing key certificate**, copy the **SHA-256 certificate fingerprint** and send it to me. I add it to the website file.
2. **The website on its own address.** Android looks for the proof at the root of the site's own domain, https://vdex.crowmade.app/.well-known/assetlinks.json, which the website already serves. Without the fingerprint, the app still works fully; it just shows that thin bar.

## Step 9. Apply for production, then publish

1. After the 14 days, the Play Console dashboard shows **Apply for production access**. Press it and answer the short questions about the test: what was tested, what feedback came back, what changed. Google answers within a few days.
2. Then **Test and release** → **Testing** → **Closed testing** → `Coworkers` → **Promote release** → **Production**. This sends the same bundle the testers used. Don't upload a new file: every build has the same version number, and Play refuses a version number it has already seen. (The same thing another way: **Production** → **Create new release** → **Add from library**, and pick that bundle.) Choose the countries: all of them. Then **Review release** and **Start rollout to Production**.
3. Google reviews a first production release. It usually takes a few days, occasionally a week. After that Vdex is in the store.

## Later: updates

The Android app is a thin shell that opens the live website, so website updates reach it on their own, with nothing to do in the Play Console. A new shell is only needed when the app's icon, name, address or permissions change. When that happens the version number goes up, GitHub builds the new files, and you upload the new `vdex-android.aab` under **Production** → **Create new release**.

## Texts to paste

**Short description** (80 characters at most):

```
Shoots, crew, kit, call sheets, timecode notes and invoices, all on your phone.
```

**Full description:**

```
Vdex is the videographer's deck: everything about your shoots in one place, on your phone and your computer, with no subscription and no ads. Free to try for 30 days, then sign in with your Vdex licence.

BOOKINGS
A calendar of your shoots, kept in two-way sync with your Google Calendar if you like. Each one holds the client, the contacts, the address, the crew and the kit you're taking, a pipeline from enquiry to paid, and the hours you worked.

CALL SHEETS
Built in the app from the booking, with the schedule, the weather and the sunset time, the crew list and the venue notes. Edit it on the spot, then email it to the crew or print it.

STRIPBOARD
Turn the script into colour-coded scene strips (white interior day, yellow exterior day, blue interior night, green exterior night) with the cast and page counts, and drag them into shooting days. Each day adds up its pages, and the call sheet lists the day's scenes.

QUOTES AND INVOICES
Vdex suggests the lines from the shoot: days, crew rates, kit, deliverables. Or tick them from your own price list, which starts from typical freelance rates where you work. Send the client a link that opens the invoice with Pay buttons for PayPal, Venmo, Cash App, your card payment page or a bank transfer, record payments as they arrive, and see what is still unpaid.

CREW, EQUIPMENT, VENUES, INSURANCE
Your people and how to reach them. Everything you own, with serial numbers, values, warranties and a service log. Kits for the jobs you do often. The places you film, with access notes and a map. Your policies and their renewal dates.

ON SET
Sunrise and sunset, a white balance reader, a sound level meter and a range finder. Timecode notes stamped with the camera's clock, synced from the audio feed, exported for the editor.

YOURS, PRIVATELY
Vdex keeps everything on your device, behind a PIN, and opens with your fingerprint or face. With a licence, link your own Google Drive to share between your phone and computer and keep a daily backup. Pick a colour theme to match your camera brand.

Works offline once set up. A licence is checked online at least once every 90 days. Every page has its own walkthrough, in the menu.
```

## Data safety answers

Google asks what the app does with people's information. The form must agree with the privacy policy, so this is the policy's list of what can leave the phone, and when:

- **The weather forecast.** For a day, a booking or a call sheet within the next 16 days, Vdex sends Open-Meteo the coordinates of the venue or, if it has none, the location saved in Vdex (which may be the person's own), rounded to two decimal places (about a kilometre), with the date. It happens by itself. Open-Meteo also sees the phone's internet address and says it keeps server logs, which can include coordinates, for up to 90 days.
- **The licence.** After the 30-day trial, signing in sends the email address the person types to Vdex's licence server, which keeps which email addresses belong to which licences and emails them a sign-in code; the phone then takes one of the licence's places, which sends a random number made for that installation.
- **Addresses and maps**, when the person looks one up: the address text and the map area go to OpenStreetMap.
- **The person's own cloud storage and calendar**, if they link them (Google Drive and Google Calendar today): their Vdex database, backups and booking events go to their own account.
- **Add to calendar buttons**: the booking's title, dates, location and description go to Google Calendar, Outlook or Yahoo Calendar, whichever button the person presses.
- **Links the person sends** (quote, invoice, crew, contact card, equipment list): everything is inside the link, which they send with their own email or messaging app. Nothing reaches us or any server of ours.
- **Linking two devices** (TC Notes): each device's internet address goes to a Google connection server, and the open timecode log travels between the two devices.
- **Scanning a script or a timecode**: the first use downloads the text-reading library from public content networks. The picture stays on the phone.
- **The website itself**: Cloudflare, which serves vdex.crowmade.app, keeps ordinary web server logs.

Of these, Google's form counts what the app itself sends to us or to another company without the person choosing where it goes: the email address, the installation's random number, and the location for the weather. What goes to the person's own accounts at their own request, and what they send themselves, is not collection by the developer. The honest declaration is therefore:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data is deleted? | **Yes**: in the app (Settings → General → About & Licence → **Delete my licence records**), or by email to `support@crowmade.app`. The web address Google asks for is https://vdex.crowmade.app/delete-account.html (if the form still has privacy.html there from an earlier version, change it). |
| Data types: **Personal info → Email address** | Collected: **Yes**. Shared: **No**. Processed ephemerally: **No**. Required or optional: **Required** (to keep using the app after the 30-day trial). Purposes: **App functionality**, **Account management**. |
| Data types: **Device or other IDs** | Collected: **Yes** (a random number made for the installation, to count the licence's devices). Shared: **No**. Processed ephemerally: **No**. Required. Purpose: **App functionality**. |
| Data types: **Location → Approximate location** and **Precise location** | Collected: **Yes**. Shared: **Yes** (it goes to Open-Meteo, another company, for the forecast; answer No only if Google's own guidance for this question tells you a weather service like this does not count as sharing). Processed ephemerally: **No** (Open-Meteo says its logs can hold coordinates for up to 90 days). Required or optional: **Optional** (it is sent only when a venue is on the map or a location is saved). Purpose: **App functionality**. Declare both kinds: two decimal places is an area of about one square kilometre, which Google still counts as precise. |
| Every other data type (financial info, messages, photos, files, contacts, app activity…) | **Not collected.** |

Why "not collected" for the rest: everything a user types into Vdex about their work stays on the device. When a user links their own Google Drive (or iCloud, Dropbox or OneDrive, when Vdex offers them), the backup goes to the user's own account at their own request, which Google does not count as collection by the developer; the same goes for the bookings Vdex keeps in the user's own Google Calendar, and for the links a user makes and sends themselves, which hold their contents inside the link and are stored nowhere online. The privacy policy explains all of it.

**If the forms were filled in from an earlier version of this guide**, four things change with version 1.4.0, and a website update does not change them for you: here, the deletion address (delete-account.html) and the Location row (Shared: Yes; Processed ephemerally: No); in Step 5, the App access instructions and the content rating answer about users exchanging content; and in the store listing, the last line of the full description.

If a Google reviewer asks for changes to this section, send me what they wrote and I will adjust the wording.

## If something goes wrong

- **"The Android App Bundle was signed with the wrong key"**: the first upload was signed with another key. Tell me: Google can reset the upload key (it takes a few days), and the version number has to go up before the next upload.
- **"Version code 1 has already been used"**: Play already has this bundle. Use **Promote release** or **Add from library** instead of uploading (Step 9). A new file is only accepted after the version number goes up; tell me and I raise it.
- **The upload is rejected for the target Android version:** tell me; I will update the Android project and rebuild.
- **Testers cannot find the app:** they must open the opt-in link while signed in with the exact Google account that is on the list, and the release must have finished rolling out (it can take a few hours the first time).
- **Google says it could not sign in, or the review code "does not work":** check both settings are in Cloudflare and the review address's free licence has not passed its end date (docs/selling-desktop.md, part 10). After 5 wrong codes in a day from one connection, that connection is refused until the next day, and after 20 in a day from everyone together the review address is refused for everyone until the next day, the right code included: ask Google to try again the day after.
- **The dashboard does not offer "Apply for production access":** the 14 days have not completed with 12 testers opted in the whole time. Add more testers and wait.

## The screenshot files

They are made from the app itself, with its sample data, by `node tools/store-screenshots.mjs` (last remade on 7 November 2026, after the new layout); run it again after a visible change and upload the new files.

Phone (1080 × 1920): `phone-01-bookings.jpg`, `phone-02-booking.jpg`, `phone-03-call-sheet.jpg`, `phone-04-equipment.jpg`, `phone-05-crew.jpg`, `phone-06-field.jpg`, `phone-07-timecode.jpg`, `phone-08-money.jpg`.

Tablet (1600 × 2560): `tablet-01-bookings.jpg`, `tablet-02-booking.jpg`.

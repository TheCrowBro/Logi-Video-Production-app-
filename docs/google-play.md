# Vdex on Google Play

This is the step-by-step for putting Vdex in the Google Play store, written for the person who owns the Google account. The technical side is done: GitHub builds and signs the Android app by itself, the privacy policy is published, and every text and picture the store asks for is ready below. What remains are the steps only the account owner can do. Each takes a few minutes, and the two-week test runs by itself.

**Do this on a computer if you can.** Google's Play Console works in a phone browser, but it is a lot of forms, and a bigger screen helps.

## What you will paste or upload

| What | Where it is |
|---|---|
| Privacy policy address | https://thecrowbro.github.io/Logi-Video-Production-app-/privacy.html |
| The app file for Google Play (`vdex-android.aab`) | https://github.com/TheCrowBro/Logi-Video-Production-app-/releases/tag/android-latest |
| The app file to try on a phone first (`vdex-android.apk`) | same page |
| Icon, 512 × 512 | https://thecrowbro.github.io/Logi-Video-Production-app-/store/android/icon-512.png |
| Feature graphic, 1024 × 500 | https://thecrowbro.github.io/Logi-Video-Production-app-/store/android/feature-graphic.jpg |
| Phone and tablet screenshots | https://thecrowbro.github.io/Logi-Video-Production-app-/store/android/screenshots/ (the files are listed at the end of this page) |
| The texts | the "Texts to paste" section below |

## Step 1. Open a Google Play developer account

1. Go to https://play.google.com/console/signup and sign in with the Google account that will own the app.
2. Choose **Yourself** (a personal account) unless you have a registered company, which Google asks a D-U-N-S number for.
3. Pay the one-time registration fee (US $25) and complete the identity check. Google asks for an ID document and may take a few days to confirm it.
4. Google also asks for a contact email that will be shown publicly on the store page, and a phone number for its own use.

## Step 2. Let GitHub sign the real app (one time)

The app has to be signed with a key that stays the same for every version, so that Google and phones accept each update. That key already exists. GitHub holds an encrypted copy, and the passphrase that unlocks it was sent to you privately in our chat, together with a backup copy of the key. Keep both in a password manager.

Until the passphrase is in GitHub, the builds on the release page are signed with a temporary key. They are fine for trying on a phone, but Google Play will not accept them.

1. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/settings/secrets/actions
2. Press **New repository secret**.
3. Name: `ANDROID_KEY_PASSPHRASE`. Secret: paste the passphrase exactly as it was sent to you. Press **Add secret**.
4. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/actions/workflows/android.yml and press **Run workflow**, then the green **Run workflow** button.
5. About five minutes later the release page (link in the table above) has new files. Its notes say "Signed with the upload key". That is the build to give Google.

If the passphrase is ever lost, say so: a new key can be made, and Google has a process for registering a replacement upload key that takes a couple of days.

## Step 3. Create the app in the Play Console

1. In the Play Console press **Create app**.
2. App name: `Vdex`. Default language: English. App or game: **App**. Free or paid: **Free**.
3. Tick the declarations (developer programme policies and US export laws) and press **Create app**.

## Step 4. The store listing

Left menu → **Grow users** → **Store presence** → **Main store listing** (names in the console change now and then; look for "store listing").

1. **App name:** Vdex.
2. **Short description** and **Full description:** paste the texts from "Texts to paste" below.
3. **App icon:** upload `icon-512.png`.
4. **Feature graphic:** upload `feature-graphic.jpg`.
5. **Phone screenshots:** upload the `phone-*.jpg` files. **7-inch and 10-inch tablet screenshots:** upload the `tablet-*.jpg` files for both.
6. Save.

Then **Store settings**: app category **Productivity**; contact email: the address you want shown; website: `https://thecrowbro.github.io/Logi-Video-Production-app-/`.

## Step 5. The questionnaires

Left menu → **Monitor and manage** → **Policy and programmes** → **App content** (older layouts call it just "App content"). Work through every item on the list:

| Item | Answer |
|---|---|
| Privacy policy | The privacy policy address from the table above. |
| Ads | **No, my app does not contain ads.** |
| App access | **All functionality is available without special access.** If asked for notes: "No account is needed. The PIN lock is optional and only set by the user." |
| Content rating | Start the questionnaire, enter your email, choose **Utility, Productivity, Communication, or Other**, and answer **No** to every question (no violence, no sexual content, no bad language, no drugs, no gambling, no user-to-user interaction, no location sharing with other users, no purchases). The rating comes out as "Everyone". |
| Target audience and content | Age group: **18 and over** only. Designed for children: **No**. |
| News apps | **No.** |
| COVID-19 contact tracing and status apps | **Not a COVID-19 app.** |
| Data safety | See "Data safety answers" below. |
| Government apps | **No.** |
| Financial features | **My app doesn't provide any financial features.** (Vdex writes invoices but moves no money.) |
| Health | **My app does not have any health features.** |
| Advertising ID | **No, my app does not use advertising ID.** |

## Step 6. Upload the app to a closed test

Google requires new personal accounts to run a closed test with at least 12 testers for 14 days before an app can go public. Your coworkers are the testers.

1. Left menu → **Test and release** → **Testing** → **Closed testing** → **Create track**. Name it `Coworkers`.
2. **Testers** tab → **Create email list** → name it, paste the Google account emails of at least 12 coworkers (more is safer, in case some do not install), save, tick the list.
3. **Releases** tab → **Create new release**.
4. If Google asks about app signing, keep the default (**Use Google-generated key** / let Google manage the signing key) and continue.
5. Upload `vdex-android.aab` from the release page (download it to your computer first).
6. Release notes: `First test build.` Press **Next**, fix anything it flags, then **Save**, **Review release**, and **Start rollout to Closed testing**.

## Step 7. The testers

1. On the **Testers** tab copy the **opt-in link** and send it to the coworkers on the list.
2. Each of them opens the link while signed in to the same Google account, presses **Become a tester**, then follows the Play Store link to install Vdex.
3. Ask them to keep it installed and to open it now and then for two weeks. Google counts testers who stay opted in for 14 days in a row, and it looks for some real use.

## Step 8. Remove the browser bar at the top (asset link)

The Android app opens the website inside itself. Android shows a thin browser bar at the top until the website proves that the app belongs to it. That proof is a small file on the website containing the fingerprint of Google's signing certificate for the app. Two things are needed:

1. **The fingerprint.** After the first upload, in the Play Console go to **Test and release** → **Setup** → **App signing** (sometimes under "App integrity"). Under **App signing key certificate**, copy the **SHA-256 certificate fingerprint** and send it to me. I add it to the website file.
2. **The website on its own address.** Android looks for the proof at the root of the site's domain. The current address is a shared GitHub one, so the proof file cannot sit at the root. Once Vdex has its own domain name (see the README), the file is served automatically. Without this, the app still works fully; it just shows that thin bar.

## Step 9. Apply for production, then publish

1. After the 14 days, the Play Console dashboard shows **Apply for production access**. Press it and answer the short questions about the test: what was tested, what feedback came back, what changed. Google answers within a few days.
2. Then **Test and release** → **Production** → **Create new release**. Upload the current `vdex-android.aab` from the release page, choose the countries (all), **Review release**, **Start rollout to Production**.
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
Vdex is the videographer's deck: everything about your shoots in one place, on your phone and your computer, with no account to make and nothing to pay.

BOOKINGS
A calendar of your shoots. Each one holds the client, the contacts, the address, the crew and the kit you're taking, a pipeline from enquiry to paid, and the hours you worked.

CALL SHEETS
Built in the app from the booking, with the schedule, the weather and the sunset time, the crew list and the venue notes. Edit it on the spot, then email it to the crew or print it.

QUOTES AND INVOICES
Vdex suggests the lines from the shoot: days, crew rates, kit, deliverables. Send as a PDF or by email, and see what is still unpaid.

CREW, EQUIPMENT, VENUES, INSURANCE
Your people and how to reach them. Everything you own, with serial numbers, values, warranties and a service log. Kits for the jobs you do often. The places you film, with access notes and a map. Your policies and their renewal dates.

ON SET
Sunrise and sunset, a white balance reader, a sound level meter and a range finder. Timecode notes stamped with the camera's clock, synced from the audio feed, exported for the editor.

YOURS, PRIVATELY
Vdex keeps everything on your device. Set a PIN and it locks with your fingerprint or face. Link your own Dropbox, Google Drive or OneDrive to share between devices and keep a daily backup. Pick a colour theme to match your camera brand.

Works offline. Tap ? on any page for a walkthrough.
```

## Data safety answers

Google asks what the app does with people's information. Vdex sends nothing to us. One feature sends information to an outside service: the weather forecast, which sends the coordinates of the shoot location, or of the phone's own location if that is what is set, to Open-Meteo. It is used once and not kept. The honest declaration is therefore:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** |
| Do you provide a way for users to request that their data is deleted? | **No, but the data isn't collected in a way that can be deleted** (choose the option that says the data is processed ephemerally / not stored). If the form insists on yes or no, answer **Yes** and point to Settings → Backups & data → Erase everything. |
| Data types: **Location → Approximate location** and **Precise location** | Collected: **Yes**. Shared: **No**. Processed ephemerally: **Yes**. Required or optional: **Optional** (users can choose whether to use it). Purpose: **App functionality**. |
| Every other data type (personal info, financial info, messages, photos, files, contacts, app activity, device IDs…) | **Not collected.** |

Why "not collected" for the rest: everything a user types stays on the device. When a user links their own Dropbox, Google Drive or OneDrive, the backup goes to the user's own account at their own request, which Google does not count as collection by the developer. The privacy policy explains all of it.

If a Google reviewer asks for changes to this section, send me what they wrote and I will adjust the wording.

## If something goes wrong

- **"The Android App Bundle was signed with the wrong key"** on the second upload: the first upload was a temporary-key build. Finish Step 2, re-run the workflow, and upload the new file. If a temporary-key build already went live, say so: Google can reset the upload key.
- **The upload is rejected for the target Android version:** tell me; I will update the Android project and rebuild.
- **Testers cannot find the app:** they must open the opt-in link while signed in with the exact Google account that is on the list, and the release must have finished rolling out (it can take a few hours the first time).
- **The dashboard does not offer "Apply for production access":** the 14 days have not completed with 12 testers opted in the whole time. Add more testers and wait.

## The screenshot files

Phone (1080 × 1920): `phone-01-bookings.jpg`, `phone-02-booking.jpg`, `phone-03-call-sheet.jpg`, `phone-04-equipment.jpg`, `phone-05-crew.jpg`, `phone-06-field.jpg`, `phone-07-timecode.jpg`, `phone-08-money.jpg`.

Tablet (1600 × 2560): `tablet-01-bookings.jpg`, `tablet-02-booking.jpg`.

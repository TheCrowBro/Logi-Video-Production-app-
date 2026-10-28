# Vdex

**Vdex is a production deck for freelance videographers and small video businesses.** Bookings, crew, kit, venues, insurance, a shoot-day clock, timecode notes, pre- and post-production checklists and a few field tools, all in one app that lives on your phone and works on your computer too.

- **No account, no subscription, no server.** Your data stays on your device and only goes where *you* send it (your own Dropbox, Google Drive, OneDrive or server).
- **Works offline** once installed, which matters on location.
- **Locks with a PIN, or your fingerprint or face,** and keeps everything it stores encrypted whenever it is locked, in the background or closed. Never loses your data: automatic daily backups in your cloud storage, encrypted backup files, and a reminder when there's no recent copy.
- **Phone and computer share one database** once you link a cloud storage.
- **On a computer, one click installs it:** there is an installer for Windows, Mac and Linux, or use it in any browser.

## Which guide do you need?

| Your device | Read this |
|---|---|
| 📱 **iPhone or iPad** | [iPhone guide](#iphone-guide) |
| 🤖 **Android phone or tablet** | [Android guide](#android-guide) |
| 💻 **Windows, Mac or Linux computer** | [Using Vdex on a computer](#using-vdex-on-a-computer): one-click installers, or the browser |
| 🔌 Linking Dropbox, Google, Microsoft or your own server | [Setup guides](#setup-guides-optional-connections), done once from any device |
| 🧑‍💻 Running the app yourself | [For developers](#for-developers) |

The two phone guides cover the same ground in the same order, so a crew with both kinds of phone can follow along together. Where the phones behave differently, the guide for that phone says so.

---

## iPhone guide

### Install it on your iPhone

Vdex is a web app, so there is nothing to find in the App Store. You install it from Safari:

1. Open the Vdex address in **Safari**. Other iPhone browsers can't add it to the Home Screen properly.
2. Tap **Share**, the square with an arrow at the bottom of the screen.
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. From now on, open Vdex from its Home Screen icon.

Tapping **Install** in Vdex's own top bar shows these same steps.

Why install it rather than keep it in a Safari tab:

- **It keeps your data.** Safari may clear a website's saved data after about a week of not using it. The installed app is kept apart from Safari and doesn't lose data that way.
- **Notifications only work in the installed app.** Safari tabs can't show them. Camera, microphone and location work in the installed app on iOS 16.4 or later.
- **It opens full-screen and works offline.**

**One thing to know:** the installed app and the Safari tab are two separate copies with separate data. If you entered bookings in Safari before installing, export a backup there (Settings → *Backups & data* → **Export backup**) and import it in the installed app, or link the same cloud storage on both and they merge.

### Let Vdex use the camera, microphone and location

iPhone asks the first time a tool needs something. Tap **Allow**.

| It asks for | Used by |
|---|---|
| Camera | Scanning the camera's timecode, reading white balance, scanning a link code |
| Microphone | The noise meter |
| Location | Sun, golden hour and Polaris, and the sunrise and sunset on call sheets |
| Motion & Orientation | Aiming at the sun or Polaris, and the tilt range finder |
| Notifications | "Break's up" alerts from the shoot-day clock |

If you tapped **Don't Allow** by mistake: the camera and microphone are asked for again next time. For location, open iPhone **Settings → Privacy & Security → Location Services → Safari Websites** (installed web apps usually follow that setting). For notifications, open **Settings → Notifications**, find Vdex and switch it on, then turn the toggle on again inside Vdex (Settings → *Hours & breaks*).

### The first time you open it

1. **Take the tour.** It starts by itself. Replay it any time from **Aa → Take the tour again**.
2. **Want to see it full of data first?** Settings → *Backups & data* → **Load sample data** fills it with example bookings, crew, kit and venues. It replaces what's there, so only do this on a fresh install.
3. The top bar has three buttons: **Install** (until it's installed), **Aa** (text size, theme, accessibility) and **☁** (storage and sync).

### What's on the Rolodex

The spinning drum at the top is how you move between sections: **swipe it** up or down, or tap **▲ ▼**.

| Card | What it's for |
|------|---------------|
| **Bookings** | Your calendar of shoots. Each booking holds the client, times, address, contacts, crew, kit, venue, notes, hours, and its pre/post-production checklist. |
| **Crew** | The freelancers you trust: role, phone, email, a link to their work, and which of your bookings they're on. |
| **Equipment** | Everything you own, with serial numbers, values and quantities, and which shoots each item is booked on. The **Kits** tab saves sets of gear for the jobs you do most (an interview set, a car-shoot set…). |
| **Venues** | Places you shoot: map pin and directions, access and parking notes, nearest hospital, contact, and the rules (tripods, lighting, haze, drones… allowed, needs approval, or not allowed). |
| **Insurance** | Your policies, claims lines and renewal dates, with a warning if your kit is worth more than it's insured for. |
| **Me** | Your details and a QR code that hands your contact card, or your website, to anyone who scans it. |
| **Field** | Sun and golden hour, Polaris finder, white-balance reader, noise meter, range finder. |
| **TC Notes** | Shoot notes stamped with the camera's timecode, with your script alongside. Links your iPhone and a laptop so both can take notes. |
| **Settings** | Storage, calendar links, themes, defaults, backups, templates, and everything else. |

### Add a booking

1. Bookings → **+ New** (or tap a date, then **+ New**).
2. Fill in the project, client, **job type** (this picks the right checklist), dates (multi-day shoots have an end date), times and address.
3. Pick a **venue** if you've saved one: its address fills in and Vdex warns if your kit breaks the venue's rules.
4. Tick **crew** and **equipment**. Tick a **kit** to load a whole set of gear at once, then adjust. Items you own more than one of get a quantity.
5. Set the **approved break per day** if the production has one. The shoot-day clock uses it.

Vdex warns when the same piece of kit is needed on two overlapping jobs.

### Run a shoot day

- On the day, a **clock bar** appears under the Rolodex with the booking's name. **● Start work** starts the clock; **■ Stop work** logs the hours.
- **☕ Break** asks how long (15 min, 30 min, 1 hour, 2 hours), pauses the clock and counts the break down. **▶ Back to work** ends it when you're actually back. The bar keeps a running total against the break length approved for that production and warns when it's used up.
- **Notifications on an iPhone.** Turn them on under Settings → *Hours & breaks* (installed app only). Vdex counts the break only while it is on screen: the moment you switch to another app or lock the phone, iPhone pauses Vdex, so a "break's up" alert can't go off in the background. It shows the moment you reopen Vdex instead. For a reliable alarm on a long break, leave Vdex open with *Keep the screen on during breaks* switched on, or set a timer in the Clock app as well.
- **📋 Call sheet** on the booking page builds one from the booking, venue, crew (with each person's call time), kit, hires and the day's sunrise and sunset. **Share** opens the iPhone share sheet (Messages, Mail, AirDrop, WhatsApp…); you can also copy it, email it or print it with AirPrint.
- The **shot list** on the booking page is there to tick off as you cover it.

### Take timecode notes

1. TC Notes → **+ New log**. Choose the camera's frame rate and whether its timecode is **free run** (always counting) or **record run** (counts only while recording).
2. Tap **Sync**: type the timecode the camera shows and tap Sync at that instant, or point the iPhone at the camera's timecode display and tap **Scan**. The scanner downloads its text reader the first time, so do that once while you have a connection.
3. Type notes. Each one is stamped with the camera's timecode the moment you start typing. **⏺ Mark now** drops a stamp to fill in later.
4. In record run, tap **● Roll** and **■ Cut** with the camera; each take is logged with its length.
5. **Adding the script on an iPhone.** Tap **Script → Word document** and pick a `.docx` from the Files app (iCloud Drive, Google Drive and Dropbox all show up in Files). For a Google Doc, open it in the Docs app, tap ⋮ → *Share & export → Send a copy → Word* and save it to Files first, or select all, copy, and paste the text into Vdex. Then tap a line, or press and hold to select words, and **Mark** to pin a stamp to that part of the script.
6. **Export** shares the notes as text or a spreadsheet, to Mail, AirDrop, Files or anywhere else in the share sheet.

**iPhone and laptop together:** tap **🔗 Link device** on both. One shows a code, the other scans it with its camera, then they swap. Both then show the same clock and the same notes, live, with no internet needed. They need to be on the same Wi‑Fi or one phone's hotspot. If the laptop has no camera, use **Copy code** and paste it on the other side.

### Keep track of a project

- Every booking has a **stage**: Enquiry → Quoted → Confirmed → Prepped → Shot → In post → Delivered → Archived. The strip on the booking page shows where it is; tap a stage to move it.
- Each stage has a **checklist** that depends on the job type. Tick things off, add your own items, and when a stage is complete a **Next** button moves the project on. Items with an arrow open the tool they're about (call sheet, kit, media log, hours…).
- **🗂 Pipeline** on the Bookings page shows every project by stage, with its progress and next deadline.
- Change the checklists for each job type under Settings → *Workflow templates*.

### After the shoot

- **Media & backups** on the booking page: one row per card; tick as it's copied to drive 1, drive 2, offsite, and verified. A card can only be marked *cleared* once it's on two drives.
- **Deliverables**: what the client gets, with due dates (they appear in your calendar), status and links.
- **Music & stock licences**: keep the licence numbers with the project.
- **✂ Start edit session** runs the clock for post days. **📊 Hours & statistics** shows totals, hours per week, hours by project and overtime, and shares a spreadsheet for invoicing.

### Your data on an iPhone

**Where it lives.** Inside the installed app on this phone. Nothing is uploaded unless you link a storage of your own.

**Backups.** Settings → *Backups & data* → **Export backup** opens the share sheet: choose **Save to Files** (iCloud Drive keeps it off the phone), AirDrop it to your Mac, or mail it to yourself. **Import backup** picks that file from Files. Do this before changing phones.

**Using Vdex on more than one device.** Link **one** cloud storage under **☁** (or Settings → *Storage & sync*). Every device linked to the same storage then shares one database, and changes made on two devices at once are merged rather than overwriting each other.

| On an iPhone you can link | Notes |
|---|---|
| **Dropbox** | Needs a one-time setup, see [Setup guides](#setup-guides-optional-connections). Stays signed in. |
| **Google Drive** | Needs a one-time setup. Google makes you sign in again about once an hour; tap **Reconnect** when asked. |
| **OneDrive** | Needs a one-time setup. Stays signed in. |
| **WebDAV** | Your own Nextcloud, ownCloud, Synology or similar server. |

There is no iCloud Drive option: iPhones don't let web apps keep a file in a synced folder. The four above work on your iPhone and on your computer, so pick one and link it everywhere.

### Calendar on an iPhone

1. **Add once.** On any booking, **📆 Add to calendar** → **Apple Calendar** saves a calendar file; open it and tap **Add All**. The Google Calendar and Outlook options open those apps or sites ready-filled. **📤 Share** and **✉ Email** send the details to anyone.
2. **Live feed.** With a cloud storage linked, Vdex keeps a calendar file up to date that your calendar can subscribe to once. Bookings → **📆 Calendar & email** → *Live feed*: tick *Publish the feed*, tap **Get the subscription link** and copy it. Then on the iPhone: **Settings → Calendar** (on iOS 18, **Settings → Apps → Calendar**) → **Accounts → Add Account → Other → Add Subscribed Calendar**, paste the link. On a Mac, Calendar → *File → New Calendar Subscription* does the same and reaches the iPhone through iCloud.
3. **Two-way sync.** Vdex keeps a "Vdex bookings" calendar in your Google or Microsoft account. Bookings go up, and if you move or rename one in the calendar it comes back into Vdex. Needs the [Setup guides](#setup-guides-optional-connections).

Deliverable due dates ride along as all-day events.

### Field tools on an iPhone

Set your location first (Field → **Use GPS**, or Settings → *Field tool defaults*), then:

- **Sun** — sunrise, sunset, golden and blue hour, the sun's direction, and a slider to see any time of day. Aim the phone to find the sun (allow Motion & Orientation when asked).
- **Polaris** — where it is tonight, for aligning timelapses and star trackers (northern hemisphere).
- **WB** — a rough colour temperature from the camera. iPhones auto-correct colour, so treat it as a guide; a grey card and your camera's own white balance are the reference.
- **Noise** — a sound level estimate from the microphone. Calibrate it once against a real meter (Settings → *Field tool defaults*).
- **Range** — **AR measure isn't available on iPhones** (Safari can't do AR in a web app yet). Use the **tilt method**: enter the camera height, aim at where the subject meets the ground, and it works out the distance; aim at the top for the subject's height. About ±10% on level ground.

### Make it yours

Tap **Aa** (or Settings → *Display & accessibility*):

- **Colour theme** — Brass, Noir, Forest, Ocean, Plum or Mono, each in light and dark, or following your iPhone.
- **Text size** and **extra-large buttons** for gloves and bright sun; **high contrast**.
- **Animation** — the Rolodex plus small touches, the Rolodex only, or none. iPhone's Reduce Motion setting switches everything off regardless.
- **Vibration feedback** has no effect on an iPhone: iPhones don't let web apps vibrate.
- Everything works with VoiceOver.

### Lock it: PIN, Face ID and Touch ID

1. Settings → **Security** → **Set a PIN…** (4 to 8 digits; 6 is a good length).
2. Switch on **Unlock with fingerprint, face or Windows Hello** if the switch appears. On an iPhone that is Face ID or Touch ID, and it works in Safari and in the installed app on iOS 16.4 or later. If the switch doesn't appear, your iPhone or browser doesn't offer it to web apps, and the PIN is the way in.
3. Choose **Lock when you leave the app**: straight away, after 1, 5 or 15 minutes, or only when Vdex is closed. The 🔒 button in the top bar locks it right now, for instance before handing the phone to someone.

What the lock does: the screen can't be used until the PIN or Face ID opens it, and everything Vdex stores on the phone (bookings, contacts, kit serials, insurance details, cloud sign-ins) is kept **encrypted** (AES-256) whenever Vdex is locked, in the background or closed. The PIN is never stored, only a key derived from it, so after five wrong tries the lock makes you wait, and you can choose to have the phone's Vdex data **erased after 10 wrong PINs** (only sensible with a cloud storage linked or a recent backup).

**If you forget the PIN** it cannot be recovered: tap *Forgot PIN?* on the lock screen, erase this phone's Vdex data, then link your cloud storage or import a backup and everything comes back. That is why the next section matters.

### Never lose your data

A stolen, lost or broken phone should cost you a phone, not your business records. Keep at least one copy somewhere else:

- **Link a cloud storage** (Dropbox, Google Drive, OneDrive or WebDAV). Besides syncing, Vdex writes a dated backup next to its database once a day after a change: one file per weekday and one per month. Settings → *Backups & data* → **Restore an automatic cloud backup…** brings any of them back, which also undoes a mistake from earlier in the week.
- **Export a backup** now and then (Settings → *Backups & data*). The **Encrypted backup…** option protects the file with a passphrase, so it can sit in email or a shared drive safely. Both kinds import on any device.
- Settings shows the **last off-device copy** and Vdex reminds you, at most every few days, when there has been none for a week.
- **Equipment → Asset register (CSV)** exports everything you own with serial numbers and values. Keep a copy with your insurer and at home: it is what the police and the insurer ask for when kit goes missing.
- **If the phone is stolen:** with a PIN set, the Vdex data on it is encrypted. Change the password of the cloud account you linked, install Vdex on the new phone, link the same storage or import a backup, and set a new PIN.

### iPhone questions and answers

**I installed it and my bookings vanished.**
They're still in Safari: the installed app and the Safari tab are separate copies. In Safari, Settings → *Backups & data* → **Export backup**, then **Import backup** in the installed app.

**My data disappeared after a few weeks.**
Safari clears website data it hasn't seen for a while. Use the installed app, link a cloud storage, and export a backup now and then.

**The Install button only shows instructions.**
That's how iPhones work: web apps are added through Safari's Share button, not a download.

**I can't turn notifications on.**
Only the installed app can show them, on iOS 16.4 or later. Open Vdex from the Home Screen icon and try again.

**The camera, microphone or GPS won't start.**
They need the installed app or a secure (https) address, iOS 16.4 or later, and your permission when asked. If you refused once, see *Let Vdex use the camera…* above.

**Google keeps asking me to sign in again.**
That's Google's rule for apps like this: a sign-in lasts about an hour. Tap **Reconnect** or **Sync now**. Dropbox and Microsoft stay signed in.

**My iPhone and laptop won't link.**
Put both on the same Wi‑Fi or on the iPhone's hotspot (no internet needed). Some office and hotel networks keep devices apart; a hotspot always works. If one side can't scan, copy the code and paste it.

**Will I get a break notification if the phone is locked?**
Not while it's locked or in another app: iPhone pauses web apps straight away. The alert appears when you reopen Vdex. Keep Vdex on screen with *Keep the screen on during breaks*, or use the Clock app's timer too.

**Can clients log in to review or approve?**
No. Vdex is your side of the job: you record their feedback and send them the documents.

**I deleted something by mistake.**
Import your last backup. If a cloud storage is linked, the deletion has already synced, so a backup is the way back.

**Can I start over?**
Settings → *Backups & data* → **Erase all data on this device**. It asks twice, unlinks any storage, removes the PIN, and leaves the cloud copy alone.

**I forgot my PIN.**
It can't be recovered. Tap *Forgot PIN?* on the lock screen to erase this phone's Vdex data, then link your storage or import a backup.

**Is my data encrypted?**
On the phone, yes once a PIN is set: whenever Vdex is locked, in the background or closed. The copy in your cloud storage is protected by that account's own sign-in, and backup files are plain unless you choose the encrypted kind.

---

## Android guide

### Install it on your Android phone

Vdex is a web app, so there is nothing to find in the Play Store. You install it from the browser:

1. Open the Vdex address in **Chrome**. Edge and Samsung Internet work too. Firefox can't install it, so use it in a tab there.
2. Tap **Install** in Vdex's top bar and confirm. If you don't see it, open Chrome's menu **⋮ → Install app** (older phones say *Add to Home screen*).
3. Vdex appears in your app list and on the Home screen. It opens full-screen and works offline.

Chrome and the installed app share the same data, so it doesn't matter which one you open. (If you install from Samsung Internet, that browser keeps its own copy, so pick one browser and stick with it.)

### Let Vdex use the camera, microphone and location

Android asks the first time a tool needs something. Tap **Allow** (or *While using the app*).

| It asks for | Used by |
|---|---|
| Camera | Scanning the camera's timecode, reading white balance, scanning a link code, AR measuring |
| Microphone | The noise meter |
| Location | Sun, golden hour and Polaris, and the sunrise and sunset on call sheets |
| Notifications | "Break's up" alerts from the shoot-day clock |

Android doesn't ask for motion sensors; the sun pointer and tilt range finder just work.

If you tapped **Don't allow** by mistake: long-press the Vdex icon → **App info** → **Site settings**, or in Chrome **⋮ → Settings → Site settings → All sites → the Vdex address**, and allow it there.

### The first time you open it

1. **Take the tour.** It starts by itself. Replay it any time from **Aa → Take the tour again**.
2. **Want to see it full of data first?** Settings → *Backups & data* → **Load sample data** fills it with example bookings, crew, kit and venues. It replaces what's there, so only do this on a fresh install.
3. The top bar has three buttons: **Install** (until it's installed), **Aa** (text size, theme, accessibility) and **☁** (storage and sync).

### What's on the Rolodex

The spinning drum at the top is how you move between sections: **swipe it** up or down, or tap **▲ ▼**.

| Card | What it's for |
|------|---------------|
| **Bookings** | Your calendar of shoots. Each booking holds the client, times, address, contacts, crew, kit, venue, notes, hours, and its pre/post-production checklist. |
| **Crew** | The freelancers you trust: role, phone, email, a link to their work, and which of your bookings they're on. |
| **Equipment** | Everything you own, with serial numbers, values and quantities, and which shoots each item is booked on. The **Kits** tab saves sets of gear for the jobs you do most (an interview set, a car-shoot set…). |
| **Venues** | Places you shoot: map pin and directions, access and parking notes, nearest hospital, contact, and the rules (tripods, lighting, haze, drones… allowed, needs approval, or not allowed). |
| **Insurance** | Your policies, claims lines and renewal dates, with a warning if your kit is worth more than it's insured for. |
| **Me** | Your details and a QR code that hands your contact card, or your website, to anyone who scans it. |
| **Field** | Sun and golden hour, Polaris finder, white-balance reader, noise meter, range finder. |
| **TC Notes** | Shoot notes stamped with the camera's timecode, with your script alongside. Links your phone and a laptop so both can take notes. |
| **Settings** | Storage, calendar links, themes, defaults, backups, templates, and everything else. |

### Add a booking

1. Bookings → **+ New** (or tap a date, then **+ New**).
2. Fill in the project, client, **job type** (this picks the right checklist), dates (multi-day shoots have an end date), times and address.
3. Pick a **venue** if you've saved one: its address fills in and Vdex warns if your kit breaks the venue's rules.
4. Tick **crew** and **equipment**. Tick a **kit** to load a whole set of gear at once, then adjust. Items you own more than one of get a quantity.
5. Set the **approved break per day** if the production has one. The shoot-day clock uses it.

Vdex warns when the same piece of kit is needed on two overlapping jobs.

### Run a shoot day

- On the day, a **clock bar** appears under the Rolodex with the booking's name. **● Start work** starts the clock; **■ Stop work** logs the hours.
- **☕ Break** asks how long (15 min, 30 min, 1 hour, 2 hours), pauses the clock and counts the break down. **▶ Back to work** ends it when you're actually back. The bar keeps a running total against the break length approved for that production and warns when it's used up.
- **Notifications on Android.** Turn them on under Settings → *Hours & breaks*. When a break is up, Android shows a notification with **▶ Back to work** and **5 more min** buttons, even while you're in another app, plus a two-minute warning. Android keeps Vdex counting in the background for a few minutes and may then pause it to save battery, in which case the alert arrives when you open Vdex again. For long breaks, switch on *Keep the screen on during breaks*, or stop Android pausing Chrome (phone **Settings → Apps → Chrome → Battery → Unrestricted**).
- **📋 Call sheet** on the booking page builds one from the booking, venue, crew (with each person's call time), kit, hires and the day's sunrise and sunset. **Share** opens the Android share sheet (WhatsApp, Gmail, Messages…); you can also copy it, email it or print it.
- The **shot list** on the booking page is there to tick off as you cover it.

### Take timecode notes

1. TC Notes → **+ New log**. Choose the camera's frame rate and whether its timecode is **free run** (always counting) or **record run** (counts only while recording).
2. Tap **Sync**: type the timecode the camera shows and tap Sync at that instant, or point the phone at the camera's timecode display and tap **Scan**. The scanner downloads its text reader the first time, so do that once while you have a connection.
3. Type notes. Each one is stamped with the camera's timecode the moment you start typing. **⏺ Mark now** drops a stamp to fill in later.
4. In record run, tap **● Roll** and **■ Cut** with the camera; each take is logged with its length.
5. **Adding the script on Android.** Share it straight into Vdex: in the Google Docs app tap ⋮ → *Share & export → Send a copy → Word*, then choose **Vdex** in the share sheet. Any `.docx` can be shared to Vdex the same way, or picked with **Script → Word document**. You can also paste the text. Then tap a line, or press and hold to select words, and **Mark** to pin a stamp to that part of the script.
6. **Export** shares the notes as text or a spreadsheet, to Gmail, Drive or anywhere else in the share sheet.

**Phone and laptop together:** tap **🔗 Link device** on both. One shows a code, the other scans it with its camera, then they swap. Both then show the same clock and the same notes, live, with no internet needed. They need to be on the same Wi‑Fi or one phone's hotspot. If the laptop has no camera, use **Copy code** and paste it on the other side.

### Keep track of a project

- Every booking has a **stage**: Enquiry → Quoted → Confirmed → Prepped → Shot → In post → Delivered → Archived. The strip on the booking page shows where it is; tap a stage to move it.
- Each stage has a **checklist** that depends on the job type. Tick things off, add your own items, and when a stage is complete a **Next** button moves the project on. Items with an arrow open the tool they're about (call sheet, kit, media log, hours…).
- **🗂 Pipeline** on the Bookings page shows every project by stage, with its progress and next deadline.
- Change the checklists for each job type under Settings → *Workflow templates*.

### After the shoot

- **Media & backups** on the booking page: one row per card; tick as it's copied to drive 1, drive 2, offsite, and verified. A card can only be marked *cleared* once it's on two drives.
- **Deliverables**: what the client gets, with due dates (they appear in your calendar), status and links.
- **Music & stock licences**: keep the licence numbers with the project.
- **✂ Start edit session** runs the clock for post days. **📊 Hours & statistics** shows totals, hours per week, hours by project and overtime, and shares a spreadsheet for invoicing.

### Your data on Android

**Where it lives.** In Chrome's storage for the Vdex site, which the installed app shares. Nothing is uploaded unless you link a storage of your own. Clearing Chrome's browsing or site data removes it, so keep a backup.

**Backups.** Settings → *Backups & data* → **Export backup** opens the share sheet: save it to Drive, Files or mail it to yourself. **Import backup** picks that file. Do this before changing phones.

**Using Vdex on more than one device.** Link **one** cloud storage under **☁** (or Settings → *Storage & sync*). Every device linked to the same storage then shares one database, and changes made on two devices at once are merged rather than overwriting each other.

| On Android you can link | Notes |
|---|---|
| **Google Drive** | Needs a one-time setup, see [Setup guides](#setup-guides-optional-connections). Google makes you sign in again about once an hour; tap **Reconnect** when asked. |
| **Dropbox** | Needs a one-time setup. Stays signed in. |
| **OneDrive** | Needs a one-time setup. Stays signed in. |
| **WebDAV** | Your own Nextcloud, ownCloud, Synology or similar server. |

The *file in a synced folder* option you may see on a computer doesn't appear on Android: phones don't let web apps keep a file in a synced folder. The four above work on your phone and on your computer, so pick one and link it everywhere.

### Calendar on Android

1. **Add once.** On any booking, **📆 Add to calendar** → **Google Calendar** opens the Google Calendar app ready-filled; **Outlook** does the same for Outlook. The Apple option saves a calendar file for any app that imports one. **📤 Share** and **✉ Email** send the details to anyone.
2. **Live feed.** With a cloud storage linked, Vdex keeps a calendar file up to date that your calendar can subscribe to once. Bookings → **📆 Calendar & email** → *Live feed*: tick *Publish the feed*, tap **Get the subscription link** and copy it. The Google Calendar app can't add subscriptions itself, so open **calendar.google.com** in a browser → *Other calendars → + → From URL* and paste the link; it then shows up in the app and in Samsung Calendar. Outlook: **outlook.com → Add calendar → Subscribe from web**.
3. **Two-way sync.** Vdex keeps a "Vdex bookings" calendar in your Google or Microsoft account. Bookings go up, and if you move or rename one in the calendar it comes back into Vdex. Needs the [Setup guides](#setup-guides-optional-connections).

Deliverable due dates ride along as all-day events.

### Field tools on Android

Set your location first (Field → **Use GPS**, or Settings → *Field tool defaults*), then:

- **Sun** — sunrise, sunset, golden and blue hour, the sun's direction, and a slider to see any time of day. Aim the phone to find the sun. If the pointer seems off, wave the phone in a figure of eight to calibrate the compass.
- **Polaris** — where it is tonight, for aligning timelapses and star trackers (northern hemisphere).
- **WB** — a rough colour temperature from the camera. Phones auto-correct colour, so treat it as a guide; a grey card and your camera's own white balance are the reference.
- **Noise** — a sound level estimate from the microphone. Calibrate it once against a real meter (Settings → *Field tool defaults*).
- **Range** — **AR measure** works on Android phones that support ARCore (most recent phones; Google Play Services for AR installs itself), in Chrome. Tap **📐 Measure in AR**, point the phone at a surface and the distance from the camera is shown; tap **Set point** twice to measure the length between two places. On other phones, or outdoors in flat light where AR struggles, use the **tilt method**: enter the camera height, aim at where the subject meets the ground, and it works out the distance; aim at the top for the subject's height. About ±10% on level ground.

### Make it yours

Tap **Aa** (or Settings → *Display & accessibility*):

- **Colour theme** — Brass, Noir, Forest, Ocean, Plum or Mono, each in light and dark, or following your phone.
- **Text size** and **extra-large buttons** for gloves and bright sun; **high contrast**.
- **Animation** — the Rolodex plus small touches, the Rolodex only, or none. Android's *Remove animations* setting switches everything off regardless.
- **Vibration feedback** gives a small buzz on taps; turn it off here if you'd rather not.
- Everything works with TalkBack.

### Lock it: PIN, fingerprint and face

1. Settings → **Security** → **Set a PIN…** (4 to 8 digits; 6 is a good length).
2. Switch on **Unlock with fingerprint, face or Windows Hello** if the switch appears. On Android that is the fingerprint, face or screen-lock check Chrome already uses. If the switch doesn't appear, your phone or browser doesn't offer it to web apps, and the PIN is the way in.
3. Choose **Lock when you leave the app**: straight away, after 1, 5 or 15 minutes, or only when Vdex is closed. The 🔒 button in the top bar locks it right now, for instance before handing the phone to someone.

What the lock does: the screen can't be used until the PIN or your fingerprint opens it, and everything Vdex stores on the phone (bookings, contacts, kit serials, insurance details, cloud sign-ins) is kept **encrypted** (AES-256) whenever Vdex is locked, in the background or closed. The PIN is never stored, only a key derived from it, so after five wrong tries the lock makes you wait, and you can choose to have the phone's Vdex data **erased after 10 wrong PINs** (only sensible with a cloud storage linked or a recent backup).

**If you forget the PIN** it cannot be recovered: tap *Forgot PIN?* on the lock screen, erase this phone's Vdex data, then link your cloud storage or import a backup and everything comes back. That is why the next section matters.

### Never lose your data

A stolen, lost or broken phone should cost you a phone, not your business records. Keep at least one copy somewhere else:

- **Link a cloud storage** (Dropbox, Google Drive, OneDrive or WebDAV). Besides syncing, Vdex writes a dated backup next to its database once a day after a change: one file per weekday and one per month. Settings → *Backups & data* → **Restore an automatic cloud backup…** brings any of them back, which also undoes a mistake from earlier in the week.
- **Export a backup** now and then (Settings → *Backups & data*). The **Encrypted backup…** option protects the file with a passphrase, so it can sit in email or a shared drive safely. Both kinds import on any device.
- Settings shows the **last off-device copy** and Vdex reminds you, at most every few days, when there has been none for a week.
- **Equipment → Asset register (CSV)** exports everything you own with serial numbers and values. Keep a copy with your insurer and at home: it is what the police and the insurer ask for when kit goes missing.
- **If the phone is stolen:** with a PIN set, the Vdex data on it is encrypted. Change the password of the cloud account you linked, install Vdex on the new phone, link the same storage or import a backup, and set a new PIN.

### Android questions and answers

**There's no Install button.**
Either Vdex is already installed (open it from your app list), or you're in a browser that can't install web apps. Open the address in Chrome.

**Notifications don't show.**
Allow them when Vdex asks, check the phone's notification settings for Chrome (or for Vdex under App info), and check Do Not Disturb. If alerts arrive late, Android has paused Vdex in the background: see *Run a shoot day* above.

**The camera, microphone or GPS won't start.**
They need a secure (https) address or the installed app, and your permission when asked. If you refused once, see *Let Vdex use the camera…* above.

**AR measure says it's not available.**
Your phone has no ARCore support, or you're not in Chrome. Use the tilt method instead.

**The sun pointer points the wrong way.**
Calibrate the compass by moving the phone in a figure of eight, and keep it away from magnets, cases with magnets and car mounts.

**Google keeps asking me to sign in again.**
That's Google's rule for apps like this: a sign-in lasts about an hour. Tap **Reconnect** or **Sync now**. Dropbox and Microsoft stay signed in.

**My phone and laptop won't link.**
Put both on the same Wi‑Fi or on the phone's hotspot (no internet needed). Some office and hotel networks keep devices apart; a hotspot always works. If one side can't scan, copy the code and paste it.

**My bookings aren't on my other device.**
Each device starts with its own data. Link the same storage on both (☁), or export a backup on one and import it on the other.

**Can clients log in to review or approve?**
No. Vdex is your side of the job: you record their feedback and send them the documents.

**I deleted something by mistake.**
Import your last backup. If a cloud storage is linked, the deletion has already synced, so a backup is the way back.

**Can I start over?**
Settings → *Backups & data* → **Erase all data on this device**. It asks twice, unlinks any storage, removes the PIN, and leaves the cloud copy alone.

**I forgot my PIN.**
It can't be recovered. Tap *Forgot PIN?* on the lock screen to erase this phone's Vdex data, then link your storage or import a backup.

**Is my data encrypted?**
On the phone, yes once a PIN is set: whenever Vdex is locked, in the background or closed. The copy in your cloud storage is protected by that account's own sign-in, and backup files are plain unless you choose the encrypted kind.

---

## Using Vdex on a computer

### The easy way: a one-click installer

Open the repository's **Releases** page, download the file for your computer, and open it:

| Computer | File | Then |
|---|---|---|
| **Windows** | `Vdex-Setup-<version>.exe` | Double-click it. Vdex installs in a few seconds, opens, and gets a Start menu and desktop shortcut. If Windows shows *Windows protected your PC*, click **More info → Run anyway**: the installer isn't signed with a paid certificate, which is all that warning means. |
| **Mac** | `Vdex-<version>.pkg` | Double-click it and follow the installer; Vdex lands in Applications. If macOS says it can't be opened because it's from an unidentified developer, right-click (Control-click) the file and choose **Open**, or go to **System Settings → Privacy & Security** and click **Open Anyway**. |
| **Linux** | `Vdex-<version>.AppImage` | Make it executable (right-click → Properties → *Allow executing as program*, or `chmod +x`), then double-click it. |

The installed app opens in its own window, works offline, and keeps its data on your user account on that computer. It also has an extra storage option, **☁ → A file in a synced folder**, which keeps the database as a file inside iCloud Drive (Mac), OneDrive, Google Drive for desktop, Dropbox or any synced folder with no sign-in. Phones can't use that option, so for phone-and-computer use choose Dropbox, Google Drive, OneDrive or WebDAV, and link the same one everywhere.

**Good to know about the desktop app**

- It and the browser version keep separate data. Pick one, or link the same cloud storage on both and they merge.
- There is no GPS in a computer, so set your location by hand: Field → **Enter**, or Settings → *Field tool defaults*. The sun, Polaris and call-sheet times then work as usual.
- Break notifications pop up like any other app's. They have no buttons; clicking one brings Vdex to the front.
- Backups, call sheets and exports save through a normal Save dialog instead of a share sheet.
- The PIN lock works the same way (Settings → *Security*), with Windows Hello or Touch ID where the browser offers it. It locks when the window goes to the background or when you press 🔒.
- To link a phone: the computer shows the code, the phone scans it and shows a reply; scan the reply with the webcam, or copy and paste it.
- Everything else, from bookings to timecode notes, works as described in the phone guides; the [Android guide](#android-guide) is the closer match.

### Or use it in a browser

Everything in the phone guides works the same on a computer in a browser, with no installer at all. In Chrome or Edge tap **Install** in Vdex's top bar (or the install icon at the right of the address bar) to give it a window and an icon; Safari on a Mac has *File → Add to Dock*; Firefox and Chromebooks just use it in a tab. Chrome and Edge also offer the *file in a synced folder* storage option. With a wide window, timecode notes and the script sit side by side, and the Rolodex turns with the **arrow keys** or the mouse wheel.

---

## Setup guides (optional connections)

These are one-time jobs, needed only for the direct cloud links and two-way calendar sync. The app shows the exact address to paste wherever a form asks for a "redirect URI" or "origin": for the desktop app it is `http://localhost:47831`, and for the browser version it is the secure (https) address Vdex is opened from. The forms are easiest on a computer, but the key or ID you get at the end can be typed into Vdex on any device.

### Dropbox
1. Go to **dropbox.com/developers/apps** and create an app: *Scoped access*, *App folder*. Give it any name (Vdex will save into `Apps/that name/`).
2. On the **Permissions** tab tick `files.content.read` and `files.content.write` (and `sharing.write` if you want the live calendar feed link).
3. On the **Settings** tab, under *Redirect URIs*, add the address shown in Vdex's Dropbox setup panel.
4. Copy the **App key** into Vdex (☁ → Dropbox) and tap **Connect Dropbox**.

### Google (Drive and Calendar)
1. In **console.cloud.google.com**, create a project and enable the **Google Drive API** (and the **Google Calendar API** for two-way sync).
2. *APIs & Services → Credentials → Create credentials → OAuth client ID*, type **Web application**. Under *Authorised JavaScript origins* add Vdex's address.
3. Copy the **Client ID** into Vdex (☁ → Google Drive, and Bookings → Calendar → Google Calendar). Vdex uses only its own hidden folder in Drive and only the calendar it creates.

### Microsoft (OneDrive and Outlook / Microsoft 365)
1. In the **Azure portal → App registrations → New registration**: any name; account types *any organisational directory and personal Microsoft accounts*.
2. Under *Authentication* add a **Single-page application** platform with Vdex's address as the redirect URI.
3. Under *API permissions* add the delegated permissions `Files.ReadWrite.AppFolder` (OneDrive) and `Calendars.ReadWrite` (calendar).
4. Copy the **Application (client) ID** into Vdex. One registration serves both the storage link and the calendar sync.

### A file in a synced folder (computers only)
1. In the desktop app, or in Chrome or Edge, ☁ → *A file in a synced folder* → **Create database file…**
2. Save it inside a folder your sync app keeps copied (iCloud Drive on a Mac, OneDrive, Google Drive for desktop, Dropbox, Box, Proton Drive, Synology Drive…).
3. On another computer, choose **Open existing database file…** and pick the same file.

### WebDAV (Nextcloud, ownCloud, Synology, Fastmail…)
1. Create a folder on the server for Vdex and an **app password** for your account.
2. In ☁ → WebDAV enter the folder's address, your username and the app password.
3. The server must allow requests from Vdex's address (called CORS). Nextcloud needs the "WebAppPassword" or a CORS app; most self-hosted servers need a line in the reverse-proxy settings. If it isn't allowed, Vdex says so instead of connecting.

### Live calendar feed
1. Link a cloud storage first, then Bookings → **📆 Calendar & email** → tick *Publish the feed*.
2. Tap **Get the subscription link** (Dropbox, Google Drive, OneDrive) or, with a synced folder on a computer, pick where the file goes and share it from your sync app as a direct-download link.
3. Subscribe once: Google Calendar on the web *Other calendars → + → From URL*; Apple Calendar *File → New Calendar Subscription*; iPhone *Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar*; Outlook *Add calendar → Subscribe from web*. How often it refreshes is up to the calendar app.

---

## For developers

Vdex is a static web app: plain HTML, CSS and JavaScript modules, no build step, no framework, no backend.

**Run it locally**
```sh
python3 -m http.server 8000   # then open http://localhost:8000
```
Camera, microphone, location, notifications and installing need https or `localhost`.

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
js/pages/        one file per Rolodex card (bookings, crew, gear, venues, insurance, me, field, tcnotes, settings)
js/workflow.js   stages, checklist templates, pipeline, hires, shot list, media log, deliverables, licences
js/callsheet.js  call sheet text
js/hours.js      shifts, breaks, statistics, chart     js/clock.js   the shoot-day clock bar     js/notify.js  break notifications
js/calendar.js   .ics, add-to-calendar links, live feed, two-way sync
js/timecode.js   SMPTE timecode maths (drop-frame aware)     js/docx.js   .docx reader and script line classification
js/link.js       phone–laptop link over WebRTC with clock-offset measurement     js/qr.js   QR generate / decode
js/suncalc.js    sun and Polaris     js/range.js   range finder (WebXR + tilt)     js/map.js   map preview and directions
js/a11y.js       themes, text size, motion, accessibility     js/tour.js   first-run tour     js/install.js   install prompt
js/lock.js       PIN / biometric lock and the encrypted vault     js/crypto.js   WebCrypto helpers     js/backup.js   backup health, encrypted backups, cloud restore, asset register
desktop/         the desktop app (main.js), its icon, and the version sync used by the installers
vendor/          qrcode-generator (MIT), jsQR (Apache-2.0); see vendor/LICENSES.md
```

**Versions.** The current version is shown under Settings → About. Version 1.0.0 (before the workflow features) is kept on the branch `claude/backup-v1.0.0`.

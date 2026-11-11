# Gdex

**Gdex is an app for music producers and the bands they play in, manage or produce.**

It keeps your shows, studio sessions and rehearsals in one calendar, with your acts, the people you work with, your
backline, the venues and studios you play, and your songs and setlists. On the day it gives the band a day sheet, tunes
your guitar, counts you in and times your set. Afterwards it settles the night, splits the money and makes the invoice.

It works on a phone and on a computer, in the browser or installed like an app, and keeps working with no signal. There
is no account: your information stays on your own phone or computer unless you choose to save a backup or send a link.

Gdex is a sibling of Vdex, the app for videographers, and shares its look and the way it works.

## Start here

1. **Open Gdex** in your phone's or computer's browser. (It is not published at a public address yet; until it is,
   the person who looks after the tech can run it: see *For the person who looks after the tech* below.)
2. **Put it on your home screen** so it opens like a normal app, even with no signal:
   - **iPhone:** open it in Safari, tap **Share** (the square with an arrow), then **Add to Home Screen**.
   - **Android and computers:** tap **Install** (⤓) at the top of the page.
3. **Tap ? at the top of any page.** It walks you through that page, box by box.

## What the cards are

The spinning drum at the top is the Rolodex. Swipe it, or tap the little arrows, to move between the cards:

| Card | What it's for |
|---|---|
| 📅 **Bookings** | Shows, studio sessions and rehearsals on one calendar. Open one for everything about it. |
| 🎸 **Acts** | The bands and artists you work with: members, links, press kit, tech rider with the input list and stage plot. |
| 👥 **People** | Band members, session players, crew, promoters and agents, and how to reach them. |
| 🎼 **Songs** | Keys, tempos and lengths; split sheets for the writers; setlists that add up to your slot. |
| 🎙️ **Studio log** | A take log for recording: tap + Take, mark the keepers, note what to fix. |
| 🎛️ **Backline** | Instruments, amps, mics and cables with serial numbers and values; stage packs for the gigs you do often. |
| 📍 **Venues** | Venues, studios, rehearsal rooms and festivals: capacity, stage, PA, curfew, noise limit, load-in, map. |
| 💰 **Money** | What you've earned, what's unpaid, deposits due, settlements and each person's share. |
| 🎚️ **Tools** | A tuner, a metronome, tap tempo with delay times, a sound level meter and a set timer. |
| 🛡️ **Insurance** | Your policies and renewals, and whether your cover matches your backline. |
| ⚙️ **Settings** | Your details, quotes and invoices, backups, display, and the tour again. |

## Your first show

1. **Bookings → + New → Show.** Pick the act and the venue, the date, and the times: load-in, soundcheck, doors, on
   stage and the curfew.
2. **Deal & fee:** a guarantee, a door split, or a guarantee versus a percentage. Gdex shows what it pays at a quarter,
   half, three quarters and a full house.
3. **Advance checklist:** tick it off as you advance the show, or tap **Email the promoter** for an advance email that
   asks about everything still blank.
4. **Line-up & gear, setlist, guest list:** who's playing, what's going in the van, the set that fits your slot, and who's
   on the door list.
5. **Day sheet:** print it, or send the band a link with the times, address, line-up and setlist. It never shows money.
6. **On the night: Settlement.** Tickets, comps, merch counts and costs; Gdex works out what the band made and each
   person's share.
7. **Quote & invoice:** made from the booking, with Pay buttons in the link you send.

## Your first studio session

1. **Bookings → + New → Studio session.** The act or client, the studio, the times and your rate (per hour, per day,
   per song or a flat fee).
2. **Session clock:** tap **Start** when you begin, **Break** for lunch, **Stop** at the end. While it runs, a strip under
   the Rolodex shows it on every page.
3. **Take log:** tap **+ Take** for each take, mark the keepers, write what to fix.
4. **Songs and deliverables:** what you worked on, and the rough mix, final mix, master and stems with due dates.
5. **Quote & invoice:** the hours from the clock go straight onto the invoice.

## Keep your things safe

- **Everything stays on this device.** Nothing is sent anywhere by itself. The [privacy page](privacy.html) says in
  plain words what leaves your device and when.
- **Save a backup now and then:** tap ☁ at the top → **Save a backup**. Keep the file somewhere safe. To move to a new
  phone or computer, open Gdex there and import the file. On a computer with Chrome or Edge you can also have Gdex
  keep a copy in a file inside your Dropbox, Google Drive, OneDrive or iCloud Drive folder.
- **Links you send** (a day sheet, an invoice) carry the document inside the link itself, so no server sees them. Send
  them only to the people they are for.

## For the person who looks after the tech

- Gdex is a plain web app with no build step: serve this repository's files from any static web host.
  `npm run serve` (or `node -e "import('./tests/lib.mjs').then(m => m.serve('.', 8124))"`) runs it on
  http://localhost:8124/.
- Before publishing a new version, run `node tools/stamp-build.mjs` so installed copies notice the update.
- The browser tests: `node tests/run.mjs` (needs Playwright and Chromium).
- [How it is built](docs/developers.md): the data, the sections, the booking boxes and who owns which file.
- Gdex does not share anything with Vdex: its own storage (`gdex-…` keys), its own offline cache, its own files.

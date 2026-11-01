# Connecting your storage

Vdex keeps everything on your own device. Connecting a cloud storage adds a copy there, so your phone and computer share the same information and a backup is made every day. Vdex only uses a folder of its own and cannot see, change or share your other files.

## Dropbox, Google Drive or OneDrive

1. Tap **☁** at the top of Vdex (or Settings → *Storage & sync*).
2. Tap **Connect** next to the one you use.
3. Sign in to your own account on their page and tap **Allow** (Microsoft says **Accept**).
4. You come straight back to Vdex, and the panel says *Connected* with your name.

Do the same on your other devices with the same account. That's all.

| Service | How long the sign-in lasts | Where Vdex keeps its copy |
|---|---|---|
| **Dropbox** | Stays connected | The folder *Apps › Vdex* |
| **Google Drive** | About an hour at a time. Then one tap on **Sign in again**; if you're still signed in to Google, the window closes by itself | A private area of your Drive that only Vdex can see |
| **OneDrive** | About a day at a time, on every device. Then one tap on **Sign in again** | The folder *Apps › Vdex* |

Until you tap, nothing is lost: your changes wait safely on the device and are copied as soon as you do.

**In the desktop app** the sign-in opens in your normal web browser, because these services don't allow it inside an app window. Sign in there, then come back to Vdex.

**Work or school Microsoft accounts** are often stopped with "Need admin approval" until the IT department approves Vdex. A personal Microsoft account works straight away.

**The Connect buttons are grey?** Sign-in hasn't been switched on in this copy of Vdex yet. Whoever looks after Vdex does it once: see [Turning on sign-in](turn-on-sign-in.md).

**Disconnecting** (☁ → *Disconnect*) stops the copying. Everything stays on your device, and the copy in your storage stays where it is. To withdraw Vdex's access completely, remove it in your account's settings at Dropbox (*Connected apps*), Google (*Third-party connections*) or Microsoft (*Apps and services*).

## Nextcloud, ownCloud or another WebDAV server

☁ → *Other ways to keep a copy* → **Nextcloud / ownCloud**:

1. Type your Nextcloud address (for example `cloud.example.com`) and your username.
2. Make an **app password** in Nextcloud (*Settings → Security → Devices & sessions*) and paste it. Your main password never leaves Nextcloud.
3. Tap **Connect**. Vdex makes a folder called *Vdex* in your files.

For another WebDAV server, pick **Other WebDAV** and give the full address of a folder. Either way the server has to allow Vdex to reach it from its web address (called CORS). Nextcloud needs its CORS or WebAppPassword app; most self-hosted servers need a line in their web-server settings. If it isn't allowed, Vdex says so.

## A file in a synced folder (computers only)

1. In the desktop app, or in Chrome or Edge: ☁ → *Other ways* → **Create database file…**
2. Save it inside a folder your sync app keeps copied (iCloud Drive on a Mac, OneDrive, Google Drive for desktop, Dropbox, Box, Proton Drive, Synology Drive…).
3. On another computer choose **Open existing file…** and pick the same file.

## Live calendar feed

1. Connect a cloud storage first, then Bookings → **📆 Calendar & email** → tick *Publish the feed*.
2. Tap **Get the subscription link** (Dropbox, Google Drive, OneDrive), or with a synced folder on a computer, pick where the file goes and share it from your sync app as a direct-download link.
3. Subscribe once: Google Calendar on the web *Other calendars → + → From URL*; Apple Calendar *File → New Calendar Subscription*; iPhone *Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar*; Outlook *Add calendar → Subscribe from web*. How often it refreshes is up to the calendar app.

Two-way sync with Google Calendar or Outlook is in the same panel: tap **Connect** and sign in, as above. Google asks again about once an hour and Microsoft about once a day; when it does, Vdex says so, and **Sync now** in that panel carries on.

## Using your own developer apps

Only for developers who run their own copy of Vdex at another address, or who want sign-ins to go through apps they registered themselves.

- **Built in for everyone:** put your app key and client IDs in `js/cloud-config.js`. Follow [Turning on sign-in](turn-on-sign-in.md), with your own addresses in place of the ones in its table: the redirect URI is the app's folder (for example `https://example.com/vdex/`), and the Google JavaScript origin is the scheme and host only (`https://example.com`).
- **On one device only:** ☁ → *Advanced: use your own developer app*, and paste the key or IDs there. They are kept on that device only and replace the built-in ones. Register the address the app is opened at (shown in that panel) as the redirect URI.

What each service needs: Dropbox, a *Scoped access, App folder* app with `files.content.read`, `files.content.write`, `sharing.write` and `sharing.read`, public clients allowed, no secret. Google, a *Web application* client with the Drive and Calendar APIs enabled and the scopes `drive.appdata`, `drive.file` and `calendar.app.created`, no redirect URI needed. Microsoft, a registration for *any directory and personal accounts* with the redirect URIs under *Single-page application* and the delegated permissions `Files.ReadWrite.AppFolder` and `Calendars.ReadWrite`, no secret.

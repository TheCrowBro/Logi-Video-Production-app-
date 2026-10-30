# Connecting Dropbox, Google, Microsoft or your own server

These are one-time jobs, needed only for the direct cloud links and two-way calendar sync. The app shows the exact address to paste wherever a form asks for a "redirect URI" or "origin": for the desktop app it is `http://localhost:47831`, and for the browser version it is the secure (https) address Vdex is opened from. The forms are easiest on a computer, but the key or ID you get at the end can be typed into Vdex on any device.

## Dropbox
1. Go to **dropbox.com/developers/apps** and create an app: *Scoped access*, *App folder*. Give it any name (Vdex will save into `Apps/that name/`).
2. On the **Permissions** tab tick `files.content.read` and `files.content.write` (and `sharing.write` if you want the live calendar feed link).
3. On the **Settings** tab, under *Redirect URIs*, add the address shown in Vdex's Dropbox setup panel.
4. Copy the **App key** into Vdex (☁ → Dropbox) and tap **Connect Dropbox**.

## Google (Drive and Calendar)
1. In **console.cloud.google.com**, create a project and enable the **Google Drive API** (and the **Google Calendar API** for two-way sync).
2. *APIs & Services → Credentials → Create credentials → OAuth client ID*, type **Web application**. Under *Authorised JavaScript origins* add Vdex's address.
3. Copy the **Client ID** into Vdex (☁ → Google Drive, and Bookings → Calendar → Google Calendar). Vdex uses only its own hidden folder in Drive and only the calendar it creates.

## Microsoft (OneDrive and Outlook / Microsoft 365)
1. In the **Azure portal → App registrations → New registration**: any name; account types *any organisational directory and personal Microsoft accounts*.
2. Under *Authentication* add a **Single-page application** platform with Vdex's address as the redirect URI.
3. Under *API permissions* add the delegated permissions `Files.ReadWrite.AppFolder` (OneDrive) and `Calendars.ReadWrite` (calendar).
4. Copy the **Application (client) ID** into Vdex. One registration serves both the storage link and the calendar sync.

## A file in a synced folder (computers only)
1. In the desktop app, or in Chrome or Edge, ☁ → *A file in a synced folder* → **Create database file…**
2. Save it inside a folder your sync app keeps copied (iCloud Drive on a Mac, OneDrive, Google Drive for desktop, Dropbox, Box, Proton Drive, Synology Drive…).
3. On another computer, choose **Open existing database file…** and pick the same file.

## WebDAV (Nextcloud, ownCloud, Synology, Fastmail…)
1. Create a folder on the server for Vdex and an **app password** for your account.
2. In ☁ → WebDAV enter the folder's address, your username and the app password.
3. The server must allow requests from Vdex's address (called CORS). Nextcloud needs the "WebAppPassword" or a CORS app; most self-hosted servers need a line in the reverse-proxy settings. If it isn't allowed, Vdex says so instead of connecting.

## Live calendar feed
1. Link a cloud storage first, then Bookings → **📆 Calendar & email** → tick *Publish the feed*.
2. Tap **Get the subscription link** (Dropbox, Google Drive, OneDrive) or, with a synced folder on a computer, pick where the file goes and share it from your sync app as a direct-download link.
3. Subscribe once: Google Calendar on the web *Other calendars → + → From URL*; Apple Calendar *File → New Calendar Subscription*; iPhone *Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar*; Outlook *Add calendar → Subscribe from web*. How often it refreshes is up to the calendar app.

---

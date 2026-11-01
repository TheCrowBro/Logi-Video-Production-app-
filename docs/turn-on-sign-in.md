# Turning on sign-in

**Who this is for:** the one person who looks after Vdex. Nobody else ever needs this page.

**What it does:** at the moment the **Connect** buttons for Dropbox, Google Drive and OneDrive are grey. That is because Dropbox, Google and Microsoft only let an app ask people to sign in once the app has been registered with them. You do that registration once, for everybody. After that, everyone who uses Vdex just taps **Connect**, signs in to their own account and taps **Allow**. Nobody types a code or visits a developer page again.

**What you need:**

- A computer. The forms are hard work on a phone.
- About 10 minutes for Dropbox, 15 for Google and 20 for Microsoft. You can do one today and the others another day; each service switches on by itself.
- An account at each service that you will keep for good. The registration belongs to that account, so if the account is closed, everyone's connection stops. Turn on two-step sign-in for each one.
- Nothing to pay for Dropbox or Google. Microsoft asks for a payment card to open a free account; nothing is charged (see the Microsoft section).

**At the end** each service gives you one code. Send the three codes to whoever maintains Vdex's code (for this project, Claude), or see [Putting the codes in](#4-putting-the-codes-in). The codes are not passwords: every app that offers "Sign in with Google" carries one like it in plain view.

## The addresses you will be asked for

Copy these exactly, including the slash at the end where there is one.

| What the form calls it | Paste this |
|---|---|
| Website, home page | `https://thecrowbro.github.io/Logi-Video-Production-app-/` |
| Privacy policy | `https://thecrowbro.github.io/Logi-Video-Production-app-/privacy.html` |
| Redirect URI, first one | `https://thecrowbro.github.io/Logi-Video-Production-app-/` |
| Redirect URI, second one (the desktop app) | `http://localhost:47831/` |
| JavaScript origin, first one (Google only) | `https://thecrowbro.github.io` |
| JavaScript origin, second one (Google only) | `http://localhost:47831` |

## 1. Dropbox (about 10 minutes)

1. Sign in at **dropbox.com** with the Dropbox account that will own Vdex's registration.
2. Go to **dropbox.com/developers/apps** and click **Create app**.
3. *Choose an API*: pick **Scoped access**.
4. *Choose the type of access you need*: pick **App folder**. This can't be changed later, and it is what keeps Vdex out of everyone's other files.
5. *Name your app*: type **Vdex**. If Dropbox says the name is taken, try **Vdex Production Manager**. (Dropbox doesn't allow names containing "Dropbox", starting with "drop", or using "DB".) Tick the box and click **Create app**.
6. You are now on the **Settings** tab. Find **App key** and copy it somewhere safe. That is your Dropbox code. Leave **App secret** alone; Vdex doesn't use it.
7. Still on Settings, under **OAuth 2** → **Redirect URIs**: paste the first redirect address from the table and click **Add**. Then paste the second one (`http://localhost:47831/`) and click **Add**.
8. Just below, check that **Allow public clients (Implicit Grant & PKCE)** says **Allow**. Leave it like that.
9. Under **Development users**, click **Enable additional users**. Without this, only your own Dropbox can connect.
10. Still on Settings, find **App folder name**, click **Change**, type **Vdex** and save. That way the folder people see in their Dropbox is always *Apps › Vdex*, whatever name the app got in step 5.
11. Open the **Permissions** tab. Tick **files.content.read**, **files.content.write**, **sharing.write** and **sharing.read**. Leave anything already ticked as it is. Click **Submit** at the bottom.
12. Open the **Branding** tab. App name: **Vdex**. Publisher: your name. Description: *Keeps your Vdex production database in your own Dropbox.* App website: the home page address from the table. Icons: upload `icons/icon-64.png` and `icons/icon-256.png` from the project, one in each box (download them from GitHub first). Click **Save**.

**Later, when people are using it:** Dropbox lets up to 50 people connect a new app, then gives you two weeks to ask for full approval, after which new people can't connect until it is approved. So when about 40 people have connected (the **Analytics** tab shows the number), go to the **Settings** tab and click **Apply for production**. Say what Vdex does with Dropbox: *one database file and dated backups in its own app folder, and an optional share link for a calendar feed.* Give the privacy policy address. Dropbox usually answers within a few working days. People already connected carry on regardless.

## 2. Google (about 15 minutes)

1. Sign in at **console.cloud.google.com** with the Google account that will own Vdex's registration. If Google asks you to agree to terms, agree.
2. At the top, click the project picker and then **New project**. Name it **Vdex** and click **Create**. Wait a moment, then make sure **Vdex** is the project shown at the top.
3. In the search box at the top, type **Google Drive API**, open it and click **Enable**. Do the same for **Google Calendar API**.
4. In the menu (☰), go to **Google Auth platform** → **Branding**. If it says it isn't configured yet, click **Get started**:
   - App name: **Vdex**. User support email: pick your email. **Next**.
   - Audience: **External**. **Next**.
   - Contact information: your email. **Next**.
   - Tick the box to agree, **Continue**, **Create**.
5. Still on **Branding**, fill in: application home page and privacy policy (both from the table), and under **Authorized domains** click **Add domain** and type `thecrowbro.github.io`. Leave the logo empty for now. Click **Save**.
6. Go to **Data access** → **Add or remove scopes**. In the box for adding scopes by hand, paste these three lines, then click **Add to table**, **Update** and **Save**:

   ```
   https://www.googleapis.com/auth/drive.appdata
   https://www.googleapis.com/auth/drive.file
   https://www.googleapis.com/auth/calendar.app.created
   ```

   Then look at where they landed. The two Drive ones should be under **non-sensitive scopes**. If the calendar one is under **sensitive scopes**, remove it again (click its bin icon and **Save**): Drive will work for everyone, and Google Calendar sync is left for later, because Google wants a review for sensitive permissions. In that case the Google Calendar button has to be switched off too: say so when you send the codes, or set `googleCalendar: false` in the file in step 4.
7. Go to **Clients** → **Create client**. Application type: **Web application**. Name: **Vdex**. Under **Authorized JavaScript origins**, click **Add URI** and paste `https://thecrowbro.github.io`, then **Add URI** again and paste `http://localhost:47831`. Leave **Authorized redirect URIs** empty. Click **Create**.
8. Copy the **Client ID**, which ends in `.apps.googleusercontent.com`. That is your Google code. (Google also shows a client secret; Vdex doesn't use it.)
9. Go to **Audience** and click **Publish app**, then **Confirm**. Until you do this, only accounts you list as test users can sign in, and only for seven days at a time.

**What people will see:** Google's window will name `thecrowbro.github.io` rather than "Vdex". Showing the app's name and logo needs a check that Google only does for a domain you own. If Vdex moves to its own domain later, you can ask for it then. Google may take a few minutes, sometimes a few hours, before a new client ID works.

## 3. Microsoft (about 20 minutes)

Microsoft no longer lets a personal account register an app on its own; it needs a free "directory" first, which comes with a free Azure account.

1. **Open a free Azure account** at **azure.microsoft.com/free** with the Microsoft account that will own Vdex's registration. It asks for a phone number and a payment card to prove you are a person. You create nothing that costs money, so nothing is charged.
2. **Before 30 days are up**, sign in at **portal.azure.com**, search for **Subscriptions**, open the subscription the sign-up made and choose **Upgrade subscription** (or the upgrade banner). Pick the free **Basic** support plan and **Upgrade**. Otherwise Azure switches the account off after the trial. With nothing created in it, pay-as-you-go costs nothing.
3. Go to **entra.microsoft.com** and sign in with the same account. If you see more than one directory, use the gear icon at the top → **Directories + subscriptions** and pick **Default Directory**.
4. In the menu go to **Entra ID** → **App registrations** → **New registration**.
   - Name: **Vdex** (this is also the folder name people see in OneDrive: Apps › Vdex).
   - Supported account types: **Any Entra ID Tenant + Personal Microsoft accounts** (older screens: *Accounts in any organizational directory … and personal Microsoft accounts*). This is what lets everyone sign in.
   - Redirect URI, if the page offers one: pick **Single-page application (SPA)** in the list, and paste the first redirect address from the table. If it doesn't offer one, you add it in step 6.
   - Click **Register**.
5. On the page that opens, copy the **Application (client) ID** (it looks like `0a1b2c3d-…`). That is your Microsoft code. Don't create anything under *Certificates & secrets*.
6. Go to **Authentication** → **Add redirect URI** (or **Add a platform**) → **Single-page application**, paste `http://localhost:47831/` and save, and the first address too if it isn't there yet. Check both addresses now sit under **Single-page application**, not under *Web*. Leave the *Access tokens* and *ID tokens* boxes unticked.
7. Go to **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated permissions**. Search for and tick **Files.ReadWrite.AppFolder** and **Calendars.ReadWrite**, then **Add permissions**. Leave **User.Read** in place.
8. Optional: under **Owners**, add a second Microsoft account you trust, so the registration isn't lost with a single account.

**What people will see:** Microsoft's window shows "Vdex" with the word *Unverified* where a company name would be. Personal Microsoft accounts (Outlook.com, Hotmail, Live) can accept and carry on. Work or school accounts are usually stopped with "Need admin approval" until their IT department approves Vdex; Vdex tells them so in plain words. Removing the *Unverified* label needs a registered business in Microsoft's partner programme.

**To keep it working:** sign in at **entra.microsoft.com** and **portal.azure.com** every few months. Microsoft eventually closes accounts and directories nobody uses, and the code goes with them.

## 4. Putting the codes in

**Easiest:** send the three codes to whoever maintains Vdex's code (for this project, Claude), for example:

```
Dropbox: abc123xyz
Google: 1234-abcd.apps.googleusercontent.com
Microsoft: 0a1b2c3d-1111-2222-3333-444455556666
```

They go into `js/cloud-config.js`, and the website updates by itself about five minutes after that. Phones and browsers pick it up the next time Vdex is opened. **The desktop app** carries its own copy of Vdex, so it picks the codes up with its next update: ask whoever maintains Vdex to publish one.

**By hand, on GitHub:** open the repository, switch to the branch `claude/videographer-gear-app-xlg8eb`, open `js/cloud-config.js`, tap the pencil to edit, paste each code between the quotes on its line, and **Commit changes**. The website updates by itself a few minutes later, once the automatic checks have passed.

## If something goes wrong

| What you see | What it means |
|---|---|
| The Connect button for a service is still grey | That service's code isn't in yet, or the website hasn't updated. Wait five minutes and reopen Vdex. Still grey after ten? Open the repository's **Actions** tab: if *Deploy to GitHub Pages* shows a red cross for your change, open it and choose **Re-run failed jobs**, or send its link to whoever maintains Vdex. In the desktop app, the codes arrive with its next update. |
| Dropbox says "Invalid redirect_uri" | A redirect address in step 7 has a typo or a missing slash at the end. |
| Dropbox says the app has reached its limit | Apply for production on the Dropbox Settings tab (see "Later" under Dropbox). |
| Google says "Access blocked: Vdex has not completed the Google verification process" | The app is still in testing. Do step 9 of the Google section (Publish app). |
| Google says "redirect_uri_mismatch" or "origin mismatch" | A JavaScript origin in step 7 is wrong. It must have no slash and no path at the end. |
| Microsoft says the reply URL does not match | A redirect address is missing, or is under *Web* instead of *Single-page application*. |
| Microsoft says "Need admin approval" | That person is using a work or school account. A personal Microsoft account works, or their IT department can approve Vdex. |

If Vdex later moves to its own domain name, add the new addresses at each service in the same places, next to the old ones.

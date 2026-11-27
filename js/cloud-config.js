// Vdex's own registered apps at Apple (iCloud), Google, Dropbox and Microsoft. With these filled in, everyone connects by tapping
// Connect and signing in to their own account: nothing to create, nothing to paste. They identify the app to the
// service; they are not passwords, and every web app that offers "Sign in with Google" ships one like them.
// How to get them, once, for whoever looks after Vdex: docs/turn-on-sign-in.md
export const CLOUD_APPS = {
  // iCloud (Apple CloudKit): the container identifier and two API tokens from the CloudKit Console, one for the website
  // (sign-in callback: URL Redirect to the website) and one for the desktop app (sign-in callback: Post Message)
  icloud: { container: '', apiToken: '', desktopToken: '' }, // container looks like iCloud.app.crowmade.vdex
  dropbox: '',   // Dropbox App key (App Console → your app → Settings)
  google: '943564062295-f5ut36hads3mdv7sjhnah971msh7btq6.apps.googleusercontent.com', // Google OAuth client ID (Google Cloud project Vdex)
  microsoft: '', // Microsoft Application (client) ID, looks like 00000000-0000-0000-0000-000000000000
  googleCalendar: true, // false while Google treats the calendar permission as "sensitive" (docs/turn-on-sign-in.md, Google step 6)
  googlePickerKey: '', // Google Picker API key, for choosing a Google Doc as a script (docs/turn-on-sign-in.md, Google Docs); empty: not offered
};

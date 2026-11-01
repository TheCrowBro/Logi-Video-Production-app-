// Vdex's own registered apps at Dropbox, Google and Microsoft. With these filled in, everyone connects by tapping
// Connect and signing in to their own account: nothing to create, nothing to paste. They identify the app to the
// service; they are not passwords, and every web app that offers "Sign in with Google" ships one like them.
// How to get them, once, for whoever looks after Vdex: docs/turn-on-sign-in.md
export const CLOUD_APPS = {
  dropbox: '',   // Dropbox App key (App Console → your app → Settings)
  google: '',    // Google OAuth client ID, ends in .apps.googleusercontent.com
  microsoft: '', // Microsoft Application (client) ID, looks like 00000000-0000-0000-0000-000000000000
  googleCalendar: true, // false while Google treats the calendar permission as "sensitive" (docs/turn-on-sign-in.md, Google step 6)
};

// The website's own files, in one place: tools/stamp-build.mjs builds the offline (service worker) list from them, and
// tools/stage-site.mjs publishes exactly these, so the two can never drift apart. A new page goes in PAGES.
export const PAGES = ['index.html', 'privacy.html', 'terms.html', 'invoice.html', 'crew.html', 'download.html', 'signin-google.html', 'delete-account.html']; // signin-google.html: the iPhone app's Google sign-in (js/signin-google.js)
export const ROOT_FILES = ['styles.css', 'manifest.webmanifest'];
export const DIRS = ['js', 'vendor', 'icons'];
// Addresses the Worker answers instead of a file (cloudflare/worker.mjs and wrangler.jsonc → assets.run_worker_first).
export const WORKER_ROUTES = ['/buy', '/licence/*'];

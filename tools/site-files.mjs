// The website's own files, in one place: tools/stamp-build.mjs builds the offline (service worker) list from them, and
// tools/stage-site.mjs publishes exactly these, so the two can never drift apart. A new page goes in PAGES.
export const PAGES = ['index.html', 'privacy.html', 'terms.html', 'invoice.html', 'crew.html'];
export const ROOT_FILES = ['styles.css', 'manifest.webmanifest'];
export const DIRS = ['js', 'vendor', 'icons'];

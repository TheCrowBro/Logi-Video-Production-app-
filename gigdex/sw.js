// Gigdex service worker: makes the app work offline and carries updates. Every deploy stamps a new BUILD (see
// tools/stamp-build.mjs), which gives a new cache: the app's files are fetched once into it and served cache-first,
// so one deploy is one consistent set of files, and the old set is dropped when the new worker takes over. The page
// (js/update.js) then offers to reload. Only caches named gigdex-… are ever touched.
const BUILD = 'dev'; // stamped with the commit on deploy
const CACHE = 'gigdex-' + BUILD;
const SHELL = [
  './', 'index.html', 'invoice.html', 'daysheet.html', 'privacy.html', 'styles.css', 'manifest.webmanifest', 'js/a11y.js', 'js/app.js', 'js/audio.js', 'js/backup.js', 'js/blocks/advance.js', 'js/blocks/budget.js', 'js/blocks/clock.js', 'js/blocks/daysheet.js', 'js/blocks/deal.js', 'js/blocks/deliverables.js', 'js/blocks/guests.js', 'js/blocks/index.js', 'js/blocks/lineup.js', 'js/blocks/money.js', 'js/blocks/notes.js', 'js/blocks/running.js', 'js/blocks/setlist.js', 'js/blocks/settlement.js', 'js/blocks/takes.js', 'js/blocks/worksongs.js', 'js/clock.js', 'js/crypto.js', 'js/daysheet.js', 'js/doc-css.js', 'js/form.js', 'js/install.js', 'js/link-pack.js', 'js/map.js', 'js/model.js', 'js/money.js', 'js/pages/acts.js', 'js/pages/backline.js', 'js/pages/bookings.js', 'js/pages/insurance.js', 'js/pages/money.js', 'js/pages/people.js', 'js/pages/sessions.js', 'js/pages/settings.js', 'js/pages/songs.js', 'js/pages/tools.js', 'js/pages/venues.js', 'js/prepaint.js', 'js/print.js', 'js/qr.js', 'js/rolodex.js', 'js/setlist.js', 'js/store.js', 'js/tools-meter.js', 'js/tools-metronome.js', 'js/tools-tempo.js', 'js/tools-timer.js', 'js/tools-tuner.js', 'js/tools-ui.js', 'js/tour.js', 'js/tutorials.js', 'js/update.js', 'js/util.js', 'js/version.js', 'css/acts.css', 'css/backline.css', 'css/bookings.css', 'css/daysheet.css', 'css/money.css', 'css/people.css', 'css/settings.css', 'css/show.css', 'css/songs.css', 'css/studio.css', 'css/tools.css', 'vendor/jsQR.js', 'vendor/qrcode.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-256.png', 'icons/icon-512.png', 'icons/icon-64.png', 'icons/icon.svg',
];
const shellKeys = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
const keyOf = req => { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; };

// Precache with cache: 'no-cache': every file is revalidated with the server, never taken from the browser's HTTP cache
// on trust, so a build is never a mix.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
const dropOld = () => caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('gigdex-') && k !== CACHE).map(k => caches.delete(k))));
self.addEventListener('activate', e => { e.waitUntil(dropOld().then(() => self.clients.claim())); });
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  else if (e.data === 'cleanup') e.waitUntil(dropOld());
  else if (e.data === 'build' && e.source) e.source.postMessage({ type: 'build', build: BUILD });
});

let tidied = false;
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = keyOf(req);
  if (!tidied) { tidied = true; e.waitUntil(dropOld()); }
  e.respondWith(caches.open(CACHE).then(async c => {
    if (req.mode === 'navigate' || shellKeys.has(key)) {
      // The app's own files: this build's copy, always. New files come with a new build.
      const hit = await c.match(key) || await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' && new URL(req.url).pathname.endsWith('/') ? await c.match('./') : null);
      if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(key, r.clone()); return r;
    }
    // Anything else of ours: cached copy at once, refreshed in the background.
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

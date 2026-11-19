// Vdex service worker: makes the app work offline and carries updates. Every deploy stamps a new BUILD (see
// tools/stamp-build.mjs), which gives a new cache: the app's files are fetched once into it and served cache-first,
// so one deploy is one consistent set of files, and the old set is dropped when the new worker takes over. The page
// (js/update.js) then offers to reload.
const BUILD = 'dev'; // stamped with the commit on deploy
const CACHE = 'logi-' + BUILD;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'privacy.html', 'terms.html', 'invoice.html', 'crew.html', 'shared.html', 'signin-google.html', 'js/crew-link.js', 'js/crew-page.js', 'js/share-data.js', 'js/shared-page.js', 'js/share-out.js', 'js/share-add.js', 'js/share-import.js', 'js/gear-import.js', 'js/gear-import-ui.js', 'js/gear-columns.js', 'js/table-read.js', 'js/a11y.js', 'js/app.js', 'js/backup.js', 'js/board.js', 'js/calendar.js', 'js/callsheet.js', 'js/clock.js', 'js/crypto.js', 'js/docx.js', 'js/form.js', 'js/hours.js', 'js/install.js', 'js/link.js', 'js/lock.js', 'js/map.js', 'js/money.js', 'js/native.js', 'js/notify.js', 'js/pages/bookings.js', 'js/pages/crew.js', 'js/pages/field.js', 'js/pages/gear.js', 'js/pages/insurance.js', 'js/pages/me.js', 'js/pages/settings.js', 'js/pages/tcnotes.js', 'js/pages/venues.js', 'js/pdf.js', 'js/prepaint.js', 'js/price-list.js', 'js/price-rates.js', 'js/providers.js', 'js/qr.js', 'js/range.js', 'js/return.js', 'js/rolodex.js', 'js/share-in.js', 'js/signin-google.js', 'js/storage-ui.js', 'js/stripboard.js', 'js/store.js', 'js/suncalc.js', 'js/terms.js', 'js/timecode.js', 'js/tour.js', 'js/tutorials.js', 'js/update.js', 'js/util.js', 'js/version.js', 'js/weather.js', 'js/workflow.js', 'vendor/LICENSES.md', 'vendor/jsQR.js', 'vendor/qrcode.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg',
];
const shellKeys = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
// Addresses the site's Worker answers (cloudflare/worker.mjs): never the app, never cached. From tools/site-files.mjs.
const WORKER_ROUTES = ['/buy', '/licence/*'];
const workerRoute = u => { const base = new URL(self.registration.scope).pathname.replace(/\/$/, ''); return u.origin === location.origin && WORKER_ROUTES.some(r => (r.endsWith('/*') ? u.pathname.startsWith(base + r.slice(0, -1)) : u.pathname === base + r)); };
const keyOf = req => { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; };

// Precache with cache: 'no-cache': every file is revalidated with the server (a cheap 304 when the page just fetched it),
// never taken from the browser's HTTP cache on trust, so a build is never a mix and nothing is downloaded twice.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});
// Old caches are dropped as this build takes over and at each tidy, but never while a newer build is installing or
// waiting: the cache that build is filling is not an old one, and deleting it would leave it to take over with nothing.
const dropOld = () => caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'logi-share').map(k => caches.delete(k))));
const coming = () => !!(self.registration.installing || self.registration.waiting);
// Puts back whatever of this build is missing from its cache. The worker of the build before this one can wake while
// this one is installing and delete this build's half-filled cache as an old one (builds from before the rule above
// do it on any request). This build would then take over with a few files, or none, and Vdex would not open offline.
// So the list is checked as this build takes over and at each tidy, and the missing files are fetched again.
const refill = () => caches.open(CACHE).then(async c => {
  const have = new Set((await c.keys()).map(r => r.url));
  await Promise.allSettled(SHELL.filter(p => !have.has(new URL(p, self.registration.scope).href)).map(p => c.add(new Request(p, { cache: 'no-cache' }))));
});
// Taking over: this build's cache is made whole first, here and not only when a page asks for it, because Vdex may be
// closed by now, and the next start may be one without a connection. (There is one now: the install has just ended.)
// With nothing missing, which is the rule, no file is fetched. The requests of an open page wait until this is over,
// so a refill that drags on is given 20 seconds and then carries on beside them. A newer build may have been found
// and installed in that time: then the old caches are left to it, which drops them as it takes over in its turn.
self.addEventListener('activate', e => {
  e.waitUntil(Promise.race([refill().catch(() => {}), new Promise(r => setTimeout(r, 20000))]).then(() => coming() || dropOld()).then(() => self.clients.claim()));
});
// Tidying up after taking over: old caches go and this build's own is made whole.
// → whether it was begun (false: there is a newer build on its way, so it is left for later).
const tidy = e => { if (coming()) return false; e.waitUntil(dropOld().then(refill).catch(() => {})); return true; };
let tidied = false;
const passed = new Set(); // pages handed over from the server because this build does not hold them (see the fetch handler)
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  else if (e.data === 'cleanup') tidy(e); // a request the old worker was still handling can leave an empty cache behind
  else if (e.data === 'build' && e.source) e.source.postMessage({ type: 'build', build: BUILD });
});

// Break notifications: the buttons on them act on the open app (or open it).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.action === 'back' ? 'break-end' : e.action === 'later' ? 'break-extend' : null;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const client = list[0] || (await self.clients.openWindow('./index.html'));
    if (client) { if (client.focus) client.focus(); if (action) client.postMessage({ type: action }); }
  }));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (new URL(req.url).pathname.includes('/__vdex/')) return; // the desktop app's sign-in pages are never the app
  if (workerRoute(new URL(req.url))) return; // the shop's pages (Buy, the code after paying) always come from the server
  // Web Share Target: a file shared to the app arrives as a POST; park it and send the app to pick it up.
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData(); const file = fd.get('file');
        if (file) await (await caches.open('logi-share')).put('shared-file', new Response(file, { headers: { 'X-Name': encodeURIComponent(file.name || 'shared'), 'Content-Type': file.type || 'application/octet-stream' } }));
      } catch { /* nothing usable was shared */ }
      return Response.redirect('./index.html?share=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = keyOf(req);
  // A tidy each time this worker starts (the browser puts an idle worker to sleep) and each time a page is opened: one
  // that could put nothing back, for want of a connection, is so made good at the next start of Vdex that has one.
  if (!tidied || req.mode === 'navigate') tidied = tidy(e);
  // A page that came from the server because this build does not hold it (below) belongs to a later build, and so do
  // its scripts and styles: they come from the server too, and are not kept. This build's copies stand in only when
  // the server cannot be reached. (Not for the page's next navigation: that request still carries this page's id.)
  if (req.mode !== 'navigate' && e.clientId && passed.has(e.clientId)) {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then(c => c.match(key)).then(hit => hit || Response.error())));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    if (req.mode === 'navigate' || shellKeys.has(key)) {
      // The app's own files: this build's copy, always. New files come with a new build.
      const hit = await c.match(key) || await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        // A page of this build that has gone missing from its cache is fetched and put back, like any other file of
        // the build (below): nothing else ever asks for the app's own page, and without it Vdex cannot open offline.
        // A page this build does not hold (one a newer build added, opened before this copy has updated): the
        // server's own answer when it has one, passed on and not kept, so the cache stays one build's files; what
        // that page then loads is not kept either (passed, above), and the server is asked for the newer build.
        // Only when the server has no such page, or cannot be reached, is it the app itself.
        try {
          const r = await fetch(req);
          if (r.ok && shellKeys.has(key)) c.put(key, r.clone());
          else if (r.ok && e.resultingClientId) { passed.add(e.resultingClientId); self.registration.update().catch(() => {}); }
          if (r.ok || r.type === 'opaqueredirect') return r;
        } catch { /* offline */ }
        return await c.match('./') || await c.match('index.html') || fetch(req);
      }
      const r = await fetch(req); if (r.ok) c.put(key, r.clone()); return r;
    }
    // Anything else of ours: cached copy at once, refreshed in the background.
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

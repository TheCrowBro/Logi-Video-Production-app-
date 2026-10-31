// Vdex service worker: makes the app work offline and carries updates. Every deploy stamps a new BUILD (see
// tools/stamp-build.mjs), which gives a new cache: the app's files are fetched once into it and served cache-first,
// so one deploy is one consistent set of files, and the old set is dropped when the new worker takes over. The page
// (js/update.js) then offers to reload.
const BUILD = 'dev'; // stamped with the commit on deploy
const CACHE = 'logi-' + BUILD;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'privacy.html', 'js/a11y.js', 'js/app.js', 'js/backup.js', 'js/calendar.js', 'js/callsheet.js', 'js/clock.js', 'js/crypto.js', 'js/docx.js', 'js/form.js', 'js/hours.js', 'js/install.js', 'js/link.js', 'js/lock.js', 'js/map.js', 'js/money.js', 'js/notify.js', 'js/pages/bookings.js', 'js/pages/crew.js', 'js/pages/field.js', 'js/pages/gear.js', 'js/pages/insurance.js', 'js/pages/me.js', 'js/pages/settings.js', 'js/pages/tcnotes.js', 'js/pages/venues.js', 'js/pdf.js', 'js/prepaint.js', 'js/providers.js', 'js/qr.js', 'js/range.js', 'js/rolodex.js', 'js/storage-ui.js', 'js/store.js', 'js/suncalc.js', 'js/timecode.js', 'js/tour.js', 'js/tutorials.js', 'js/update.js', 'js/util.js', 'js/version.js', 'js/weather.js', 'js/workflow.js', 'vendor/LICENSES.md', 'vendor/jsQR.js', 'vendor/qrcode.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg',
];
const shellKeys = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
const keyOf = req => { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; };

// Precache straight from the server (cache: 'reload'), never from the browser's HTTP cache, so a build is never a mix.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
const dropOld = () => caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'logi-share').map(k => caches.delete(k))));
self.addEventListener('activate', e => {
  e.waitUntil(dropOld().then(() => self.clients.claim()));
});
let tidied = false;
self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
  else if (e.data === 'cleanup') e.waitUntil(dropOld()); // a request the old worker was still handling can leave an empty cache behind
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
  if (!tidied) { tidied = true; e.waitUntil(dropOld()); }
  e.respondWith(caches.open(CACHE).then(async c => {
    if (req.mode === 'navigate' || shellKeys.has(key)) {
      // The app's own files: this build's copy, always. New files come with a new build.
      const hit = await c.match(key) || await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('./') || await c.match('index.html') : null);
      if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(key, r.clone()); return r;
    }
    // Anything else of ours: cached copy at once, refreshed in the background.
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

const CACHE = 'logi-v13';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png', 'js/install.js', 'vendor/qrcode.js',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/a11y.js', 'js/providers.js', 'js/rolodex.js', 'js/form.js', 'js/suncalc.js',
  'js/pages/bookings.js', 'js/pages/crew.js', 'js/pages/gear.js', 'js/pages/venues.js', 'js/map.js', 'js/pages/tcnotes.js', 'js/timecode.js', 'js/docx.js', 'js/link.js', 'js/qr.js', 'vendor/jsQR.js', 'js/range.js', 'js/tour.js', 'js/calendar.js', 'js/storage-ui.js', 'js/version.js', 'js/pages/settings.js', 'js/hours.js', 'js/clock.js', 'js/pages/insurance.js',
  'js/pages/me.js', 'js/pages/field.js',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'logi-share').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Stale-while-revalidate for same-origin GETs.
// Web Share Target: a file shared to the app arrives as a POST; park it and send the app to pick it up.
self.addEventListener('fetch', e => {
  const req = e.request;
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
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const reqs = []; page.on('response', async r => { try { const u = r.url(); if (/localhost:8123/.test(u)) reqs.push({ url: u.replace(/.*8123\//, ''), bytes: Number(r.headers()['content-length'] || 0), type: r.request().resourceType() }); } catch { /* ignore */ } });
  const t0 = Date.now();
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  const toRolodex = Date.now() - t0;
  await sleep(1500); // let the service worker precache finish
  const js = reqs.filter(r => /\.js$/.test(r.url) && r.type !== 'other');
  const docReqs = reqs.filter(r => r.type === 'script' || r.type === 'document' || r.type === 'stylesheet');
  console.log(`startup: ${toRolodex} ms to the Rolodex (cold, local server) · ${docReqs.length} script/style/document requests by the page · ${Math.round(docReqs.reduce((s, r) => s + r.bytes, 0) / 1024)} KB`);
  ok('PDF writer is not loaded at startup', !reqs.some(r => r.url === 'js/pdf.js' && r.type === 'script'));
  ok('QR libraries are not loaded at startup', !reqs.some(r => /vendor\/(jsQR|qrcode)\.js/.test(r.url) && r.type === 'script'));
  // re-render behaviour: a cloud-status-only emit must not redraw the page; a data change must
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  const probe = await page.evaluate(async () => {
    const page = document.getElementById('page'); const before = page.firstElementChild.firstElementChild;
    const s = await import('./js/store.js');
    // reach the private setStatus through a status-only path: cloud.status change via the subscribe reason
    let statusEmit = 0, dataEmit = 0; const off = s.subscribe(r => { if (r === 'status') statusEmit++; else dataEmit++; });
    // simulate what sync does when only the status changes
    s.cloud.status = 'saving'; (await import('./js/store.js')).touch; // no API to emit status from outside; use the real path below
    off();
    const same1 = page.firstElementChild.firstElementChild === before;
    s.update(d => { d.profile.name = 'Perf ' + Date.now(); });
    await new Promise(r => setTimeout(r, 0)); // redraws are coalesced into a microtask
    const same2 = page.firstElementChild.firstElementChild === before;
    return { same1, same2 };
  });
  ok('a data change redraws the page', probe.same2 === false);
  // status-only path: trigger through the public API by calling setFeed? simplest: emit('status') is internal. Observe redraws while sync status flips using a fake adapter.
  const redraws = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const page = document.getElementById('page'); let count = 0;
    const mo = new MutationObserver(() => count++); mo.observe(page, { childList: true });
    s.cloud.adapter = { id: 'fake', label: 'Fake', ready: async () => true, read: async () => null, write: async () => {} };
    await s.sync(); // read null → push → setStatus('saving') then ('synced'): status-only emits
    await new Promise(r => setTimeout(r, 300)); mo.disconnect(); s.cloud.adapter = null;
    return count;
  });
  ok('sync status changes do not redraw the page', redraws === 0, redraws + ' redraws');
  const t1 = Date.now(); await page.evaluate(() => window.logiGo('gear')); await page.waitForSelector('.page-card'); console.log(`tab switch: ${Date.now() - t1} ms`);
  const big = await page.evaluate(async () => { const s = await import('./js/store.js'); const t = performance.now(); for (let i = 0; i < 200; i++) s.update(d => { d.gear.push({ id: 'g' + i, name: 'Item ' + i, category: 'Lighting', qty: 1, value: 100 }); }); return { ms: Math.round(performance.now() - t), size: Math.round(localStorage.getItem('logi-db-v1').length / 1024) }; });
  console.log(`200 updates with full page redraws: ${big.ms} ms · database now ${big.size} KB`);
  ok('200 record writes in one burst stay well under a second (redraws coalesced)', big.ms < 1000);
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const ORIGIN = new URL(process.env.VDEX_URL || 'http://localhost:8123/').origin + '/';
  const reqs = []; page.on('response', async r => { try { const u = r.url(); if (u.startsWith(ORIGIN)) reqs.push({ url: u.slice(ORIGIN.length), bytes: Number(r.headers()['content-length'] || 0), type: r.request().resourceType() }); } catch { /* ignore */ } });
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
  // --- sections load on first use; the start-up graph is small and preloaded ---
  const fs = require('fs'), path = require('path'); const ROOT = process.env.VDEX_ROOT;
  const graph = (() => { const seen = new Map(); const walk = f => { if (seen.has(f)) return; const src = fs.readFileSync(path.join(ROOT, f), 'utf8'); const deps = [...src.matchAll(/^\s*import\s[^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)].map(m => path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]))); seen.set(f, deps); deps.forEach(walk); }; walk('js/app.js'); return [...seen.keys()]; })();
  const preloads = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);
  const wanted = graph.filter(f => f !== 'js/app.js').sort(), have = [...preloads].sort();
  ok('index.html preloads exactly the start-up modules', JSON.stringify(wanted) === JSON.stringify(have), `missing: ${wanted.filter(f => !have.includes(f)).join(', ') || 'none'}; extra: ${have.filter(f => !wanted.includes(f)).join(', ') || 'none'}`);
  ok(`the start-up graph stays small (${graph.length} modules)`, graph.length <= 30);
  const lazy = ['js/pages/tcnotes.js', 'js/pages/field.js', 'js/pages/settings.js', 'js/pages/crew.js', 'js/tutorials.js'];
  ok('other sections and the tutorials are not loaded at startup', !reqs.some(r => lazy.includes(r.url) && r.type === 'script'), reqs.filter(r => lazy.includes(r.url)).map(r => r.url + ':' + r.type).join(', '));
  await page.evaluate(() => window.logiGo('tcnotes'));
  ok('a section loads and draws when opened', (await page.locator('.page-card[aria-label="TC Notes"]').count()) === 1 && reqs.some(r => r.url === 'js/pages/tcnotes.js'));
  const labels = await page.evaluate(async () => { const out = []; for (const id of ['crew', 'gear', 'venues', 'insurance', 'me', 'field', 'tcnotes', 'settings']) { const m = await import(`./js/pages/${id}.js`); const p = m[id]; const tab = [...document.querySelectorAll('#rolodex .tab')].find(t => t.querySelector('.tab-name').textContent === p.label); out.push(!!tab && tab.querySelector('.tab-ico').textContent === p.icon); } return out; });
  ok('the drum shows every section with its own label and icon', labels.every(Boolean), labels.join(','));
  const writes = await page.evaluate(async () => { const s = await import('./js/store.js'); let n = 0; const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'logi-db-v1') n++; return orig.call(this, k, v); }; for (let i = 0; i < 50; i++) s.update(d => { d.profile.name = 'Burst ' + i; }); const during = n; await new Promise(r => setTimeout(r, 0)); Storage.prototype.setItem = orig; return { during, after: n, stored: JSON.parse(localStorage.getItem('logi-db-v1')).profile.name }; });
  ok('a burst of 50 writes is stored once, and completely', writes.during === 0 && writes.after === 1 && writes.stored === 'Burst 49', JSON.stringify(writes));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

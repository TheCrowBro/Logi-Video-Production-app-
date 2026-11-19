// The website's licence (js/licence-web.js and js/licence.js), with the page's /licence/… requests answered by the real
// Worker (cloudflare/worker.mjs) in Cloudflare's runtime and Resend faked: nothing while the owner has it switched off
// (the Worker's note, signed with the shop's key), then a 30-day trial, read-only after it, signing in with an emailed
// 6-digit code, signing out, and the Google Play app (no Buy button; it takes one of the licence's places). Licences are
// on unless such a note says off: no answer, a blocked one, a plain, unsigned, wrongly signed, old or replayed one, and
// an "off" stored by an earlier version all mean on; and with the licence check's own files blocked, Vdex is read-only
// until they load. Needs `npm ci --prefix cloudflare` (CI does it), and the test run's key (tests/run.mjs), which the
// Worker here uses as its shop key, since the page under test carries its public half.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
const REPO = path.resolve(__dirname, '../..');
const NM = path.join(REPO, 'cloudflare/node_modules');
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const codes = require(path.join(ROOT, 'desktop/licence-codes.js'));
const DAY = 86400e3;
const STATUS_KEY = process.env.VDEX_STATUS_KEY;

(async () => {
  if (!fs.existsSync(path.join(NM, 'miniflare'))) { console.log('FAIL the website licence spec needs Wrangler\'s runtime — run: npm ci --prefix cloudflare'); process.exit(1); }
  if (!STATUS_KEY) { console.log('FAIL the website licence spec needs the test run\'s key — run it with node tests/run.mjs 104'); process.exit(1); }
  const { statusNote } = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'lib.mjs')).href);
  const esbuild = require(path.join(NM, 'esbuild'));
  const { Miniflare, convertV4MiniflareOptions } = require(path.join(NM, 'miniflare'));
  const owner = await codes.newKeyPair(), shop = { pkcs8: codes.b64u.dec(STATUS_KEY), publicKey: await codes.publicOf(await codes.importPrivate(STATUS_KEY, true)) };
  const KEYS = { 1: owner.publicKey, 2: shop.publicKey };
  const ownerKey = await codes.importPrivate(codes.b64u.enc(owner.pkcs8));
  const out = await esbuild.build({ entryPoints: [path.join(ROOT, 'cloudflare/worker.mjs')], bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent',
    plugins: [{ name: 'test-keys', setup(b) { b.onLoad({ filter: /licence-keys\.json$/ }, () => ({ contents: JSON.stringify(KEYS), loader: 'json' })); } }] });
  const mails = [];
  const outbound = async req => { if (new globalThis.URL(req.url).hostname === 'api.resend.com') { mails.push(JSON.parse(await req.text())); return Response.json({ id: 'e' }); } return new Response('no', { status: 599 }); };
  const worker = on => new Miniflare(convertV4MiniflareOptions({ modules: true, script: out.outputFiles[0].text, compatibilityDate: '2026-10-01', kvNamespaces: ['LICENCES'],
    bindings: { LICENCE_SHOP_KEY: codes.b64u.enc(shop.pkcs8), RESEND_API_KEY: 're_test', ...(on ? { WEB_SIGN_IN: 'on' } : {}) }, outboundService: outbound, serviceBindings: { ASSETS: () => new Response('x') } }));
  let mf = worker(true);
  const codeFor = to => { const m = mails.filter(x => x.to[0] === to).at(-1); return m && (m.subject.match(/^(\d{6}) /) || [])[1]; };
  // A licence with an email linked, as a purchase or the generator would leave it.
  const freeCode = await codes.signCode(ownerKey, 1, { name: 'Jo Web', email: 'jo@example.com', comp: false, issued: '2026-11-02' });
  const ref = (await codes.verifyCode(freeCode, { keys: KEYS })).licence.ref;
  const link = async () => mf.dispatchFetch('https://vdex.crowmade.app/licence/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await codes.signNote('admin', ownerKey, 1, { op: 'link', ref, code: freeCode, at: Date.now() })) });
  await link();

  const browser = await chromium.launch();
  const errors = [];
  // The country the licence server sees each request come from (Cloudflare's request.cf), and the paths asked for.
  let country = '';
  const asked = [];
  // status: answers /licence/web/status in place of the licence server (route => fulfil or abort); routes: more of
  // them, set before the page opens.
  // block: licence server paths whose requests are refused (as a blocked address); tz: the browser's time zone;
  // answers: { path: route => … }, licence server paths answered by the test in place of the Worker (a local answer).
  const open = async ({ width = 420, start = '', storage = null, status = null, routes = null, block = null, tz = '', answers = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block', ...(tz ? { timezoneId: tz } : {}) });
    if (routes) await routes(ctx);
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.route(u => new globalThis.URL(u).pathname.startsWith('/licence/'), async r => {
      const q = r.request();
      if (status && new globalThis.URL(q.url()).pathname === '/licence/web/status') { asked.push('/licence/web/status'); return status(r); }
      if (block && block.test(new globalThis.URL(q.url()).pathname)) return r.abort('blockedbyclient');
      if (answers && answers[new globalThis.URL(q.url()).pathname]) return answers[new globalThis.URL(q.url()).pathname](r);
      // The test swaps the fake licence server now and then; a request caught in between gets "unavailable", as it would
      // from a real server that is restarting, instead of crashing the test.
      asked.push(new globalThis.URL(q.url()).pathname);
      let res; try { res = await mf.dispatchFetch('https://vdex.crowmade.app' + new globalThis.URL(q.url()).pathname, { method: q.method(), headers: { 'Content-Type': 'application/json' }, body: q.method() === 'POST' ? q.postData() : undefined, cf: { country } }); } catch { res = null; }
      if (!res) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"not-ready"}' }).catch(() => {});
      await r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() }).catch(() => {});
    });
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    if (storage) await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vdex-licence', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(storage));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(URL + start); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const about = async page => {
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'About & Licence');
    await page.waitForFunction(() => !document.querySelector('.licence-panel')?.hidden || window.__noPanel, null, { timeout: 4000 }).catch(() => {});
    await sleep(300);
  };
  const lic = page => page.evaluate(() => JSON.parse(localStorage.getItem('vdex-licence') || '{}'));
  try {
    // Switched off: nothing changes.
    await mf.dispose(); mf = worker(false);
    let { ctx, page } = await open();
    await about(page); await sleep(1800);
    ok('until the owner switches it on, the website shows nothing about licences and everything works', (await page.locator('.licence-panel:not([hidden])').count()) === 0 && (await page.locator('.licence-bar').count()) === 0 && (await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Free' }; })))) === true);
    await ctx.close();

    // Licences are on unless the licence server's note, signed with the shop's key, says off (report item 1).
    const repoKeys = JSON.parse(fs.readFileSync(path.join(REPO, 'desktop/licence-keys.json'), 'utf8'));
    const pageKeys = JSON.parse((fs.readFileSync(path.join(REPO, 'js/licence-web.js'), 'utf8').match(/^const KEYS = (\{[^\n]*\});$/m) || [])[1] || 'null');
    ok('the page checks notes with the public keys the desktop app and the Worker use (desktop/licence-keys.json)', Object.keys(repoKeys).length > 0 && JSON.stringify(pageKeys) === JSON.stringify(repoKeys), JSON.stringify(pageKeys));
    const answer = body => r => r.fulfill({ status: 200, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
    const meet = async opts => {
      const o = await open(opts);
      const st = await o.page.evaluate(() => import('./js/licence.js').then(async m => { await m.initLicence(); const s = m.licenceState(), store = await import('./js/store.js'); return { mode: s.mode, trialLeft: s.trialLeft, canEdit: s.canEdit, paid: store.isPaid() }; }));
      await o.ctx.close(); return st;
    };
    const isOn = st => st.mode === 'trial' && st.trialLeft === 30 && st.canEdit === true && st.paid === false;
    const fresh = await statusNote(STATUS_KEY), stranger = codes.b64u.enc((await codes.newKeyPair()).pkcs8);
    let st = await meet({});
    ok('the licence server\'s own note, signed with the shop\'s key, switches licences off (the test server sends one to every other spec)', st.mode === 'off' && st.paid === true, JSON.stringify(st));
    st = await meet({ status: answer({ on: false, note: fresh }) });
    ok('…as does the same note from anywhere, while it is fresh', st.mode === 'off', JSON.stringify(st));
    const flip = t => t.slice(0, -2) + (t.slice(-2, -1) === 'A' ? 'B' : 'A') + t.slice(-1);
    for (const [what, how] of [
      ['no answer (the address blocked)', r => r.abort('blockedbyclient')],
      ['a server error', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"on":false}' })],
      ['a plain {"on":false}, as the test server and the Worker answered before', answer('{"on":false}')],
      ['a note whose signature was changed', answer({ on: false, note: { ...fresh, sig: flip(fresh.sig) } })],
      ['a note whose words were changed', answer({ on: false, note: { ...fresh, data: JSON.stringify({ off: true, at: Date.now() + 1 }) } })],
      ['a note signed with another key', answer({ on: false, note: await statusNote(stranger) })],
      ['a note signed with the shop\'s key for something else (a sign-in token)', answer({ on: false, note: await codes.signNote('web', await codes.importPrivate(STATUS_KEY), 2, { off: true, at: Date.now() }) })],
      ['a note that says something other than off', answer({ on: false, note: await statusNote(STATUS_KEY, { off: 'yes', at: Date.now() }) })],
      ['a note signed more than 3 days ago, kept and played back', answer({ on: false, note: await statusNote(STATUS_KEY, { off: true, at: Date.now() - 3 * DAY - 60e3 }) })],
      ['a note dated more than 3 days ahead', answer({ on: false, note: await statusNote(STATUS_KEY, { off: true, at: Date.now() + 3 * DAY + 60e3 }) })],
      ['the app\'s own page, as the desktop app\'s local server answers that address', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Vdex</title>' })],
    ]) { st = await meet({ status: how }); ok(`…but ${what} means on: the 30-day trial runs, and cloud storage and files wait for a licence`, isOn(st), JSON.stringify(st)); }
    // A request held open (a proxy that never answers) does not keep the licence unknown, and Vdex unchecked, for long.
    const began = Date.now();
    st = await meet({ status: () => new Promise(() => {}) });
    ok('…and a status request that is never answered keeps the licence unknown for 3 seconds at most: licences are on', isOn(st) && Date.now() - began < 9000, `${JSON.stringify(st)} in ${Date.now() - began} ms`);
    // What is kept in the browser: an "off" stored by a version from before notes, and notes kept from earlier answers
    // (the address is not asked again within 6 hours, nor when it cannot be reached).
    const kept = extra => ({ on: false, statusAt: Date.now() - 60e3, ...extra });
    st = await meet({ storage: kept({}) });
    ok('an "off" stored by an earlier version counts for nothing: the trial starts', isOn(st), JSON.stringify(st));
    st = await meet({ status: r => r.abort(), storage: kept({ note: await statusNote(STATUS_KEY, { off: true, at: Date.now() - 2 * DAY }), statusAt: Date.now() - 7 * 3600e3 }) });
    ok('a note kept from 2 days ago still says off while the licence server cannot be reached', st.mode === 'off', JSON.stringify(st));
    st = await meet({ status: r => r.abort(), storage: kept({ note: await statusNote(STATUS_KEY, { off: true, at: Date.now() - 3 * DAY - 60e3 }), statusAt: Date.now() - 7 * 3600e3 }) });
    ok('…and after its 3 days no longer: licences are on, and the trial starts', isOn(st), JSON.stringify(st));
    st = await meet({ storage: kept({ note: fresh, seen: Date.now() + 4 * DAY }) });
    ok('winding the clock back gains nothing: a note more than 3 days older than the latest time this browser has seen means on', st.mode === 'trial' && st.paid === false, JSON.stringify(st));
    st = await meet({ storage: kept({ note: { ...fresh, sig: flip(fresh.sig) } }) });
    ok('a note changed in the browser\'s storage means on', isOn(st), JSON.stringify(st));
    // Only the address is asked, at most every 6 hours, and with nothing about the person.
    asked.length = 0;
    let statusReq = null;
    // A cookie the site might have set is not sent with it.
    ({ ctx, page } = await open({ status: r => { statusReq = r.request(); return answer({ on: false, note: fresh })(r); }, routes: c => c.addCookies([{ name: 'seen', value: 'yes', url: URL }]) }));
    await page.evaluate(() => import('./js/licence.js').then(m => m.initLicence())); await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => import('./js/licence.js').then(m => m.initLicence())); await sleep(300);
    ok('the page asks once in 6 hours, with a plain GET that carries nothing about the person (no cookie, no address of the page)', asked.filter(x => x === '/licence/web/status').length === 1 && statusReq.method() === 'GET' && !statusReq.postData() && !/[?#]/.test(statusReq.url()) && !Object.keys(await statusReq.allHeaders()).some(k => /cookie|authorization|referer/i.test(k)), asked.join(' ') + ' ' + JSON.stringify(await statusReq.allHeaders()));
    await ctx.close();
    // A request that could not be sent (no connection) never reached the server, so the next look asks again; one that
    // was answered, even with no note, waits its 6 hours.
    asked.length = 0;
    let tries = 0;
    ({ ctx, page } = await open({ status: r => (++tries === 1 ? r.abort('internetdisconnected') : tries === 2 ? answer({ on: false, note: fresh })(r) : answer('{"on":true}')(r)) }));
    const looks = [];
    const lookAgain = () => page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(false))).then(s => looks.push(s.mode));
    await page.evaluate(() => import('./js/licence.js').then(m => m.initLicence())); // the first look; the next comes 1.5 seconds later
    for (let i = 0; i < 50 && tries < 2; i++) await sleep(100);
    await sleep(400); await lookAgain(); await lookAgain();
    ok('a status request that could not be sent is asked again at the next look (here licences are off), and an answered one not for 6 hours', tries === 2 && looks.join() === 'off,off', `${tries} asked: ${looks.join()}`);
    await ctx.close();

    // The licence check's own files cannot be loaded: Vdex is read-only until they can, then carries on.
    for (const file of ['js/licence.js', 'js/licence-web.js']) {
      let blocked = true;
      const seen = [];
      ({ ctx, page } = await open({ routes: c => c.route(u => new globalThis.URL(u).pathname === '/' + file, r => { seen.push(r.request().url().replace(/^.*\//, '') + (blocked ? ' refused' : ' sent')); return blocked ? r.abort('blockedbyclient') : r.fallback(); }) }));
      await page.evaluate(() => { window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true }); });
      await sleep(3500); // Vdex loads it once it is up
      const refused = await page.evaluate(() => import('./js/store.js').then(s => ({ changed: s.update(d => { d.profile = { ...d.profile, name: 'Free for all' }; }), paid: s.isPaid(), name: s.db.profile.name })));
      await sleep(200);
      const said = await page.evaluate(() => window.__toasts.join(' | '));
      ok(`with ${file} blocked, Vdex is read-only and nothing is saved as a file or copied, and it says why`, refused.changed === false && refused.paid === false && refused.name !== 'Free for all' && /could not load the part of itself that checks the licence, so it is read-only until it can/.test(said), JSON.stringify(refused) + ' ' + said);
      blocked = false;
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      for (let i = 0; i < 40 && !(await page.evaluate(() => import('./js/store.js').then(s => s.isPaid()))); i++) await sleep(200); // at most 8 seconds
      const after = await page.evaluate(() => import('./js/store.js').then(s => ({ changed: s.update(d => { d.profile = { ...d.profile, name: 'Back again' }; }), paid: s.isPaid(), missing: s.licenceMissing() })));
      after.seen = seen;
      ok(`…and once ${file} can be loaded (the connection is back), the licence check takes over: here licences are off, so everything works`, after.changed === true && after.paid === true, JSON.stringify(after));
      await ctx.close();
    }
    // Read-only the last time the licence was known: read-only from the start, also while the licence check is held up
    // (a request that neither loads nor fails), rather than editable until it gives up 30 seconds later.
    ({ ctx, page } = await open({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 40 * DAY, seen: Date.now() }, routes: c => Promise.all([
      c.addInitScript(() => { if (!sessionStorage.getItem('ro-seeded')) { localStorage.setItem('vdex-paid', 'ro'); sessionStorage.setItem('ro-seeded', '1'); } }),
      c.route(u => new globalThis.URL(u).pathname === '/js/licence.js', () => {}), // held open: never answered
    ]) }));
    await sleep(4000);
    const held = await page.evaluate(() => import('./js/store.js').then(s => ({ changed: s.update(d => { d.profile = { ...d.profile, name: 'Held up' }; }), paid: s.isPaid(), missing: s.licenceMissing() })));
    ok('a browser that was read-only last time stays read-only while its licence check is held up, with no cloud storage or files', held.changed === false && held.paid === false && held.missing === false, JSON.stringify(held));
    await ctx.close();
    await mf.dispose(); mf = worker(true); await link();

    // Switched on: the 30-day trial.
    ({ ctx, page } = await open());
    await about(page);
    ok('switched on, a browser gets a 30-day trial, with Buy and Sign in', /Free trial: 30 days left/.test(await page.locator('.licence-panel').innerText()) && (await page.locator('.licence-panel').getByRole('button', { name: /Buy a licence/ }).count()) === 1 && (await page.locator('.licence-panel').getByRole('button', { name: 'Sign in' }).count()) === 1);
    ok('the trial starts on the first visit after it is switched on (people who used the website before get it too)', Math.abs((await lic(page)).first - Date.now()) < 60e3);
    await ctx.close();

    // The whole price where the law asks for it (the UK, the EU and Australia): the licence server answers from the
    // country the request comes from.
    country = 'DE';
    ({ ctx, page } = await open());
    await about(page); await sleep(400);
    ok('in Germany, the website offers the licence at 23.80 USD with 19% VAT', (await page.locator('.licence-panel').getByRole('button', { name: 'Buy a licence · 23.80 USD with VAT' }).count()) === 1 && /\(23\.80 USD once in Germany, including 19% VAT, for up to 3 of your devices\)/.test(await page.locator('.licence-panel').innerText()));
    await ctx.close();
    country = 'US';
    ({ ctx, page } = await open());
    await about(page); await sleep(400);
    ok('…and in the US, 20 USD plus any tax', (await page.locator('.licence-panel').getByRole('button', { name: 'Buy a licence · 20 USD' }).count()) === 1 && /\(20 USD once plus any tax where you live, for up to 3 of your devices\)/.test(await page.locator('.licence-panel').innerText()));
    await ctx.close();
    country = '';

    // After the trial: read-only, then sign in.
    ({ ctx, page } = await open({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.waitForSelector('.licence-bar', { timeout: 5000 });
    ok('after 30 days the website is read-only, offering Buy and Sign in', /trial has ended: Vdex is read-only/.test(await page.locator('.licence-bar').innerText()) && (await page.locator('.licence-bar').getByRole('button', { name: 'Sign in' }).count()) === 1);
    ok('changes are refused', (await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Nope' }; })))) === false);
    await page.locator('.licence-bar').getByRole('button', { name: 'Sign in' }).click();
    const sh = page.locator('.sheet');
    await sh.locator('input[type="email"]').fill('Jo@Example.com');
    await sh.getByRole('button', { name: 'Email me a code' }).click();
    await page.waitForFunction(() => !!document.querySelector('.licence-digits') && document.querySelector('.licence-digits').offsetParent !== null, null, { timeout: 8000 });
    const sent = codeFor('jo@example.com');
    ok('signing in emails a 6-digit code to the licence\'s address and asks for it', /^\d{6}$/.test(sent || '') && /jo@example\.com/.test(await sh.innerText()));
    await page.screenshot({ path: OUT + '/licence-web-code.png' });
    await sh.locator('.licence-digits').fill('000000' === sent ? '111111' : '000000');
    await sh.getByRole('button', { name: 'Sign in' }).click(); await sleep(400);
    ok('a wrong code says so', /That code is not right, or has run out/.test(await sh.innerText()));
    await sh.locator('.licence-digits').fill(sent);
    await sh.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 8000 });
    await sleep(300);
    ok('the right code signs in: no bar, and changes are accepted again', (await page.locator('.licence-bar').count()) === 0 && (await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Yes' }; })))) === true);
    await about(page);
    ok('Settings shows who is signed in, with Sign out (no code to copy on the website)', /Signed in as jo@example\.com · up to 3 devices/.test(await page.locator('.licence-panel').innerText()) && (await page.locator('.licence-panel').getByRole('button', { name: 'Sign out' }).count()) === 1 && (await page.locator('.licence-panel').getByRole('button', { name: 'Copy the code' }).count()) === 0);
    await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await sleep(1800);
    ok('the sign-in is kept when the page is opened again', (await page.locator('.licence-bar').count()) === 0 && !!(await lic(page)).token);
    // A firewall, Cloudflare challenge or school filter answering instead of the licence server does not sign anyone out.
    await page.route('**/licence/web/check', r => r.fulfill({ status: 403, contentType: 'text/html', body: '<html>Blocked by your network</html>' }));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.checked = Date.now() - 2 * 86400e3; localStorage.setItem('vdex-licence', JSON.stringify(s)); });
    const afterBlock = await page.evaluate(() => import('./js/licence.js').then(async () => { const { webLicence } = await import('./js/licence-web.js'); return webLicence().recheck(true); }));
    ok('a refusal from something other than the licence server keeps the sign-in', afterBlock.mode === 'licensed' && !!(await lic(page)).token);
    await page.unroute('**/licence/web/check');
    await about(page);
    await page.locator('.licence-panel').getByRole('button', { name: 'Sign out' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Sign out' }).click(); await sleep(400);
    ok('signing out goes back to read-only (the trial is over)', !(await lic(page)).token && /trial has ended/.test(await page.locator('.licence-bar').innerText()));
    await ctx.close();

    // At phone width the update bar (made here as js/update.js makes it) wraps to three rows: the read-only bar sits
    // above it, so its Buy and Sign in buttons can still be tapped.
    ({ ctx, page } = await open({ width: 390, storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.waitForSelector('.licence-bar', { timeout: 5000 });
    const bars = await page.evaluate(() => {
      const el = (tag, cls, text, attrs = {}) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = text; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
      const bar = el('div', 'update-bar', '', { role: 'status' });
      bar.append(el('span', '', 'Vdex has been updated.'), el('button', 'btn primary small', 'Reload for the new version'), el('button', 'icon-btn', '✕', { 'aria-label': 'Not now' }));
      document.body.append(bar); document.body.classList.add('has-update-bar');
      const lb = document.querySelector('.licence-bar').getBoundingClientRect(), ub = bar.getBoundingClientRect();
      const free = [...document.querySelectorAll('.licence-bar button')].map(b => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && b.contains(hit); });
      return { overlap: Math.round(Math.max(0, Math.min(lb.bottom, ub.bottom) - Math.max(lb.top, ub.top))), free, top: Math.round(lb.top) };
    });
    ok('at phone width, with the update bar showing too, the read-only bar sits above it and each of its buttons can be tapped', bars.overlap === 0 && bars.free.length >= 2 && bars.free.every(Boolean) && bars.top > 0, JSON.stringify(bars));
    await ctx.close();

    // After the trial, the setup tour (Take the tour) shows the profile as it is stored and takes nothing, so no
    // read-only explanation comes up under its card, and it adds no sample people.
    ({ ctx, page } = await open({ width: 390, storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.waitForSelector('.licence-bar', { timeout: 5000 });
    await page.evaluate(() => import('./js/tutorials.js').then(t => t.openSetup(t.stepsFor('setup').findIndex(x => x.title === 'You'))));
    await page.waitForSelector('#tour-title', { timeout: 5000 }); await sleep(400);
    const youCard = await page.evaluate(() => ({ title: document.getElementById('tour-title').textContent, inputs: [...document.querySelectorAll('.tour-form input')].map(i => i.disabled), text: document.querySelector('.tour-form').textContent }));
    const ro = [];
    for (let i = 0; i < 12 && (await page.locator('#tour-title').count()); i++) {
      const title = await page.locator('#tour-title').innerText();
      if (title === 'Keep the samples?') { ro.push(await page.locator('.tour-done').innerText()); break; }
      await page.locator('.tour-actions .btn.primary').click(); await sleep(500);
      ro.push((await page.locator('.sheet.licence-readonly').count()) ? 'read-only sheet after ' + title : 'ok');
    }
    const crewNow = await page.evaluate(() => import('./js/store.js').then(s => s.db.crew.length));
    ok('after the trial, Take the tour shows the profile\'s fields as stored, says why they cannot be changed, and takes nothing: no read-only sheet comes up under the tour, and no sample people are added', youCard.title === 'You' && youCard.inputs.length === 2 && youCard.inputs.every(Boolean) && /read-only/.test(youCard.text) && !ro.some(x => /read-only sheet/.test(x)) && /no samples were added/.test(ro.at(-1) || '') && crewNow === 0, JSON.stringify({ youCard, ro, crewNow }));
    await ctx.close();

    // Switched off and on again: the trial carries on where it was, it did not run while off.
    ({ ctx, page } = await open({ storage: { on: true, statusAt: Date.now() - 7 * 3600e3, first: Date.now() - 25 * DAY, seen: Date.now() - 15 * DAY } })); // 10 days of trial used
    // The page asks at most every 6 hours, Try again included: each step below is 7 hours after the one before.
    const hoursLater = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.statusAt = Date.now() - 7 * 3600e3; localStorage.setItem('vdex-licence', JSON.stringify(s)); });
    await page.evaluate(() => import('./js/licence.js').then(m => m.initLicence())); // the page's own first look is over (it asked as it opened)
    await mf.dispose(); mf = worker(false); await hoursLater();
    const offNow = await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(true)));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.offAt = Date.now() - 15 * 86400e3; localStorage.setItem('vdex-licence', JSON.stringify(s)); }); // switched off 15 days ago
    await mf.dispose(); mf = worker(true); await link();
    const stillOff = await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(true)));
    ok('switched off, the page learns it from the Worker\'s note; switched on again, Try again within 6 hours does not ask again', offNow.mode === 'off' && stillOff.mode === 'off', `${offNow.mode} ${stillOff.mode}`);
    await hoursLater();
    const resumed = await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(true)));
    ok('switching sign-in off pauses the trial: switched on again, it carries on rather than ending at once', resumed.mode === 'trial' && resumed.trialLeft >= 19 && resumed.trialLeft <= 21, `${resumed.mode} ${resumed.trialLeft}`);
    await ctx.close();

    // Signing in from the "read-only" explanation: it closes, and focus goes back to the field that was changed.
    ({ ctx, page } = await open({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.waitForSelector('.licence-bar', { timeout: 5000 });
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'Profile');
    await page.locator('input[aria-label="Currency symbol"]').fill('£'); await page.locator('input[aria-label="Currency symbol"]').press('Enter'); await sleep(300);
    await page.locator('.sheet.licence-readonly').getByRole('button', { name: 'Sign in' }).click();
    await page.locator('.sheet input[type="email"]').last().fill('jo@example.com'); await page.locator('.sheet').last().getByRole('button', { name: 'Email me a code' }).click();
    await page.waitForFunction(() => document.querySelector('.licence-digits')?.offsetParent != null, null, { timeout: 8000 });
    await page.locator('.sheet .licence-digits').fill(codeFor('jo@example.com')); await page.locator('.sheet').last().getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 8000 }); await sleep(400);
    ok('signing in from the read-only explanation closes it and puts focus back on the field', (await page.locator('.licence-readonly').count()) === 0 && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Currency symbol');
    await ctx.close();

    // A refund signs the browser out at its next check.
    ({ ctx, page } = await open({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.evaluate(async () => { const m = await import('./js/licence.js'); await m.initLicence(); });
    await page.evaluate(() => import('./js/licence.js').then(m => m.signIn()));
    await page.locator('.sheet input[type="email"]').fill('jo@example.com'); await page.locator('.sheet').getByRole('button', { name: 'Email me a code' }).click();
    await page.waitForFunction(() => document.querySelector('.licence-digits')?.offsetParent != null, null, { timeout: 8000 });
    await page.locator('.sheet .licence-digits').fill(codeFor('jo@example.com')); await page.locator('.sheet').getByRole('button', { name: 'Sign in' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 8000 });
    await mf.dispatchFetch('https://vdex.crowmade.app/licence/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await codes.signNote('admin', ownerKey, 1, { op: 'cancel', ref, at: Date.now() })) });
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.checked = Date.now() - 2 * 86400e3; localStorage.setItem('vdex-licence', JSON.stringify(s)); });
    await page.evaluate(() => import('./js/licence.js').then(async m => { document.dispatchEvent(new Event('visibilitychange')); }));
    await page.waitForFunction(() => /cancelled/.test(document.querySelector('.licence-bar')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    ok('a cancelled licence (a refund) signs the browser out at its next daily check', /licence has been cancelled/.test(await page.locator('.licence-bar').innerText().catch(() => '')));
    await mf.dispatchFetch('https://vdex.crowmade.app/licence/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await codes.signNote('admin', ownerKey, 1, { op: 'restore', ref, at: Date.now() })) });
    // Switched back on (a payment dispute settled in the seller's favour, or the owner's restore): the next day's look
    // finds it, and the browser is signed in again by itself.
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.cancelTried = Date.now() - 2 * 86400e3; localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !document.querySelector('.licence-bar'), null, { timeout: 8000 }).catch(() => {});
    const back = await lic(page);
    ok('…and once the licence works again (a dispute won), the next daily look signs the browser in again by itself', (await page.locator('.licence-bar').count()) === 0 && !!back.token && !back.cancelled && !back.cancelledToken && (await page.evaluate(() => import('./js/licence.js').then(m => m.licenceState().mode))) === 'licensed', JSON.stringify(Object.keys(back)));
    await ctx.close();

    // Only the licence server's signature counts as a sign-in: a token typed into the browser's storage, a real one
    // beside a licence it does not name, or a store app's place typed in as taken is none. And the 90 days without a
    // check run from the licence server's own time on the token, which every check renews, not from a stored time.
    const shopKey = await codes.importPrivate(STATUS_KEY);
    const jo = { email: 'jo@example.com', name: 'Jo Web', ref, seats: 3, comp: false, expires: '' };
    const token = (extra = {}) => codes.signNote('web', shopKey, 2, { email: 'jo@example.com', ref, iat: Date.now(), ...extra });
    const blocked = /^\/licence\/web\/(check|activate)$/;
    const trialOver = extra => ({ on: true, statusAt: Date.now(), first: Date.now() - 40 * DAY, seen: Date.now(), checked: Date.now(), tried: Date.now(), ...extra });
    const lookAt = async opts => {
      const o = await open(opts);
      await o.page.evaluate(() => import('./js/licence.js').then(m => m.initLicence()));
      await sleep(2800); // the first background look (1.5 seconds after the licence loads) has had its answer
      const st = await o.page.evaluate(() => import('./js/licence.js').then(async m => {
        const s = m.licenceState(), store = await import('./js/store.js'), kept = JSON.parse(localStorage.getItem('vdex-licence') || '{}'), panel = m.licencePanel(), line = (panel.el.querySelector('p') || {}).textContent || ''; panel.destroy();
        return { mode: s.mode, canEdit: s.canEdit, paid: store.isPaid(), backups: store.backupsAllowed(), links: store.linksAllowed(), trialLeft: s.trialLeft, trialEnds: s.trialEnds, lapsedAt: s.lapsedAt || 0, iat: kept.token ? JSON.parse(kept.token.data).iat : 0,
          seatReceipt: !!kept.seatReceipt, oldSeat: !!kept.oldSeat, line, noble: performance.getEntriesByType('resource').some(e => /\/vendor\/ed25519\.js/.test(e.name)) };
      }));
      await o.ctx.close(); return st;
    };
    const madeUp = { kid: 2, data: JSON.stringify({ email: 'jo@example.com', ref, iat: Date.now() }), sig: 'A'.repeat(86) };
    st = await lookAt({ block: blocked, storage: trialOver({ token: madeUp, licence: jo }) });
    ok('a made-up sign-in token in the browser\'s storage is no licence: after the trial Vdex stays read-only, with no cloud storage, files or links, also with the check blocked', st.mode === 'ended' && st.canEdit === false && !st.paid && !st.backups && !st.links, JSON.stringify(st));
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token(), licence: { ...jo, ref: '2:999' } }) });
    ok('…nor is the licence server\'s own token beside a licence it does not name', st.mode === 'ended' && !st.paid, JSON.stringify(st));
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token(), licence: jo }) });
    ok('…while the licence server\'s token for the licence still signs in, with its check blocked', st.mode === 'licensed' && st.paid, JSON.stringify(st));
    st = await lookAt({ block: blocked, start: 'index.html?src=play', storage: trialOver({ v14: 1, play: true, token: await token(), licence: jo, seat: 'ok', seatChecked: Date.now() + 365 * DAY, seatTried: Date.now(), install: 'inst-play-typed-00001' }) });
    ok('in the Play app, a place typed in as taken (by this version: an earlier one\'s is below), with its check blocked, is no place: not licensed until the licence server adds the phone', st.mode === 'pending' && st.canEdit === false && !st.paid, JSON.stringify(st));
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token({ iat: Date.now() - 100 * DAY }), licence: jo, checked: Date.now() + 365 * DAY }) });
    ok('a sign-in the licence server last confirmed 100 days ago, with its check blocked and the time of the last check typed a year ahead, turns read-only once the check fails: Export backup still works, cloud storage and spreadsheets do not', st.mode === 'offline' && st.canEdit === false && !st.paid && st.backups, JSON.stringify(st));
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token({ iat: Date.now() - 2 * DAY }), licence: jo, checked: Date.now() - 2 * DAY, tried: Date.now() - 2 * DAY }) });
    ok('…one confirmed 2 days ago stays licensed while the check is blocked', st.mode === 'licensed' && st.paid, JSON.stringify(st));
    st = await lookAt({ storage: trialOver({ token: await token({ iat: Date.now() - 100 * DAY }), licence: jo, checked: Date.now() - 100 * DAY, tried: Date.now() - 100 * DAY }) });
    ok('…and one that can reach the licence server again is confirmed, with a new token from it', st.mode === 'licensed' && st.paid && Date.now() - st.iat < 60e3, JSON.stringify(st));
    // A check answered from anywhere but the licence server is no check that got through: an answer with no token, or
    // with the token already kept (played back), leaves a sign-in last confirmed 100 days ago read-only, and a
    // cancelled browser cancelled.
    const old = await token({ iat: Date.now() - 100 * DAY }), says = body => ({ '/licence/web/check': r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }) });
    st = await lookAt({ answers: says({ ok: true, licence: jo }), storage: trialOver({ token: old, licence: jo, checked: Date.now() - 100 * DAY, tried: Date.now() - 100 * DAY }) });
    ok('a sign-in last confirmed 100 days ago whose check is answered "ok" from elsewhere, with no new token, turns read-only as with the check blocked', st.mode === 'offline' && !st.paid, JSON.stringify(st));
    st = await lookAt({ answers: says({ ok: true, licence: jo, token: old }), storage: trialOver({ token: old, licence: jo, checked: Date.now() - 100 * DAY, tried: Date.now() - 100 * DAY }) });
    ok('…as does one answered with the token it already has, played back', st.mode === 'offline' && !st.paid, JSON.stringify(st));
    st = await lookAt({ answers: says({ ok: true, licence: jo }), storage: trialOver({ cancelled: true, cancelledToken: await token({ iat: Date.now() - 10 * DAY }), cancelTried: Date.now() - 2 * DAY, licence: jo, v14: 1 }) });
    ok('…and a browser signed out by a refund stays signed out when its daily look is answered "ok" from elsewhere', st.mode === 'cancelled' && !st.paid, JSON.stringify(st));
    const oldReceipt = await codes.signNote('active', shopKey, 2, { ref, install: 'inst-play-replay-0001', at: Date.now() - 100 * DAY });
    st = await lookAt({ start: 'index.html?src=play', answers: { '/licence/web/activate': r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, receipt: oldReceipt }) }) }, storage: trialOver({ v14: 1, play: true, token: await token(), licence: jo, seat: 'ok', seatReceipt: oldReceipt, seatChecked: Date.now() - 100 * DAY, seatTried: Date.now() - 100 * DAY, install: 'inst-play-replay-0001' }) });
    ok('…and a Play app whose place was last confirmed 100 days ago, with its place check answered by its own receipt played back, turns read-only', st.mode === 'offline' && !st.paid, JSON.stringify(st));
    // Update day: a store app given its place by an earlier version, which kept no receipt for it, is licensed until
    // its first place check gets through, also when it is opened with no connection; that check brings the receipt.
    const before14 = async install => trialOver({ play: true, token: await token(), licence: jo, seat: 'ok', seatChecked: Date.now() - DAY, seatTried: Date.now() - DAY, install });
    st = await lookAt({ block: /^\/licence\//, start: 'index.html?src=play', storage: await before14('inst-play-update-0001') });
    ok('update day: a Play app given its place by an earlier version (which kept no receipt for it), opened with no connection, stays licensed, with cloud storage and backup files', st.mode === 'licensed' && st.canEdit && st.paid && st.backups && st.oldSeat, JSON.stringify(st));
    st = await lookAt({ start: 'index.html?src=play', storage: await before14('inst-play-update-0002') });
    ok('…and online, its place check brings the licence server\'s receipt, which is kept in its place', st.mode === 'licensed' && st.paid && st.seatReceipt && !st.oldSeat, JSON.stringify(st));
    await mf.dispatchFetch('https://vdex.crowmade.app/licence/web/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: await token(), install: 'inst-play-update-0002' }) });
    // A browser whose Web Crypto has no Ed25519 (Safari before 17, say) checks the signatures with the bundled checker,
    // loaded only there: a genuine sign-in opened with no connection is licensed, and a made-up one is not.
    const noEd = c => c.addInitScript(() => {
      const su = crypto.subtle, imp = su.importKey.bind(su), ver = su.verify.bind(su), ed = a => a === 'Ed25519' || (a && a.name === 'Ed25519');
      const no = () => Promise.reject(new DOMException('Unrecognized name.', 'NotSupportedError'));
      su.importKey = (f, k, a, ...r) => (ed(a) ? no() : imp(f, k, a, ...r)); su.verify = (a, ...r) => (ed(a) ? no() : ver(a, ...r));
    });
    st = await lookAt({ routes: noEd, block: /^\/licence\//, storage: trialOver({ token: await token({ iat: Date.now() - DAY }), licence: jo }) });
    ok('without Ed25519 in Web Crypto, a genuine sign-in opened with no connection is licensed, checked by the bundled vendor/ed25519.js', st.mode === 'licensed' && st.paid && st.backups && st.noble, JSON.stringify(st));
    st = await lookAt({ routes: noEd, block: blocked, storage: trialOver({ token: madeUp, licence: jo }) });
    ok('…while a made-up token is still no sign-in there', st.mode === 'ended' && !st.paid, JSON.stringify(st));
    st = await lookAt({ routes: noEd, answers: says({ ok: true, licence: jo, token: { ...madeUp, data: JSON.stringify({ email: 'jo@example.com', ref, iat: Date.now() + 1000 }) } }), storage: trialOver({ token: madeUp, licence: jo }) });
    ok('…nor one "confirmed" by an answer from elsewhere', st.mode === 'ended' && !st.paid, JSON.stringify(st));
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token(), licence: jo }) });
    ok('…and a browser with Ed25519 never loads the bundled checker', st.mode === 'licensed' && !st.noble, JSON.stringify(st));
    // A device whose clock is 100 days ahead counts the 90 days by its own clock (the time it sent, signed into the
    // token), so one failed check does not make it read-only.
    const ahead = c => c.addInitScript(() => {
      const D = Date, off = 100 * 86400e3, real = D.now.bind(D);
      class Ahead extends D { constructor(...a) { super(...(a.length ? a : [real() + off])); } static now() { return real() + off; } }
      globalThis.Date = Ahead;
    });
    st = await lookAt({ routes: ahead, block: blocked, storage: trialOver({ token: await token({ clock: Date.now() + 100 * DAY }), licence: jo }) });
    ok('a device whose clock is 100 days ahead stays licensed when a check made just after a good one fails', st.mode === 'licensed' && st.paid, JSON.stringify(st));
    // A free licence's end date counts as the licence server signed it into the token, not as stored beside it.
    st = await lookAt({ block: blocked, storage: trialOver({ token: await token({ expires: '2026-11-01' }), licence: { ...jo, comp: true, expires: '' } }) });
    ok('a free licence past the end date in its token has ended, also with the date taken out of the stored licence and the check blocked', st.mode === 'expired' && !st.paid, JSON.stringify(st));
    // A refund learned by an earlier version kept no token aside, so this browser cannot sign in again by itself.
    st = await lookAt({ storage: trialOver({ cancelled: true, licence: jo }) });
    const keptAside = await lookAt({ storage: trialOver({ cancelled: true, cancelledToken: await token({ iat: Date.now() - 10 * DAY }), cancelTried: Date.now(), licence: jo, v14: 1 }) });
    ok('the cancelled line says to sign in again after a won dispute when this browser kept no sign-in to try again with, and "within a day" when it did', /sign in again to use it here/.test(st.line) && !/within a day/.test(st.line) && /works here again within a day/.test(keptAside.line), `${st.line} | ${keptAside.line}`);
    // The trial: never more than 30 days, and its last day in the browser's own time zone.
    st = await lookAt({ storage: { on: true, statusAt: Date.now(), first: Date.now() + 20 * DAY, seen: Date.now() } });
    ok('a trial start moved into the future gives no more than the 30 days', st.mode === 'trial' && st.trialLeft === 30, JSON.stringify(st));
    for (const [tz, hour] of [['America/Los_Angeles', 3], ['Australia/Sydney', 20]]) {
      const d = new Date(Date.now() + 3 * DAY), end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
      const want = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(end));
      st = await lookAt({ tz, storage: { on: true, statusAt: Date.now(), first: end - 30 * DAY, seen: Date.now() } });
      ok(`in ${tz}, the trial's last day is the date there (${want}), not the date in London`, st.trialEnds === want, JSON.stringify(st));
    }
    // A refund learned under an earlier version, which kept no day: its 30 days of Export backup run from the first look now.
    st = await lookAt({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 90 * DAY, seen: Date.now(), cancelled: true } });
    ok('a browser signed out by a refund under an earlier version gets its 30 days of Export backup from now', st.mode === 'cancelled' && Math.abs(st.lapsedAt - Date.now()) < 60e3 && st.backups && !st.paid, JSON.stringify(st));
    st = await lookAt({ storage: { on: true, statusAt: Date.now(), first: Date.now() - 90 * DAY, seen: Date.now() } });
    ok('…and someone who only ever had the trial gets none', st.mode === 'ended' && !st.lapsedAt && !st.backups, JSON.stringify(st));

    // The Google Play app: no Buy, and it takes a place on the licence.
    ({ ctx, page } = await open({ start: 'index.html?src=play', storage: { on: true, statusAt: Date.now(), first: Date.now() - 31 * DAY, seen: Date.now() - DAY } }));
    await page.waitForSelector('.licence-bar', { timeout: 5000 });
    const barText = await page.locator('.licence-bar').innerText();
    ok('in the Play app the read-only bar offers only Sign in: no Buy and no price (Google Play\'s rule)', !/Buy|USD/.test(barText) && (await page.locator('.licence-bar').getByRole('button', { name: 'Sign in' }).count()) === 1, barText.replace(/\n/g, ' | '));
    await about(page);
    asked.length = 0; country = 'GB'; await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await about(page); await sleep(600);
    ok('nor does Settings in the Play app, and it never asks the licence server for a price', !/Buy|USD|20/.test(await page.locator('.licence-panel').innerText()) && !asked.includes('/licence/price'), asked.join(' '));
    const playOffer = await page.evaluate(() => import('./js/licence.js').then(m => m.offer()));
    ok('…nor the setup tour: no Buy and no price', playOffer.buy === false && playOffer.price === '', JSON.stringify(playOffer));
    country = '';
    // Fill the licence's 3 places first, from three computers.
    for (let i = 1; i <= 3; i++) await mf.dispatchFetch('https://vdex.crowmade.app/licence/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: freeCode, install: 'install-computer-0000000' + i, os: 'Mac' }) });
    await page.evaluate(() => import('./js/licence.js').then(m => m.signIn()));
    await page.locator('.sheet input[type="email"]').fill('jo@example.com'); await page.locator('.sheet').getByRole('button', { name: 'Email me a code' }).click();
    await page.waitForFunction(() => document.querySelector('.licence-digits')?.offsetParent != null, null, { timeout: 8000 });
    await page.locator('.sheet .licence-digits').fill(codeFor('jo@example.com')); await page.locator('.sheet').getByRole('button', { name: 'Sign in' }).click();
    await page.waitForSelector('.sheet .lic-computers li', { timeout: 8000 });
    ok('with 3 devices already on the licence, the Play app lists them and offers to move one', (await page.locator('.sheet .lic-computers li').count()) === 3 && /on this phone/.test(await page.locator('.sheet').innerText()));
    await page.screenshot({ path: OUT + '/licence-play-full.png' });
    await page.locator('.sheet .lic-computers li').first().getByRole('button', { name: 'Move it here' }).click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 8000 });
    await about(page);
    const look = await (await mf.dispatchFetch('https://vdex.crowmade.app/licence/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await codes.signNote('admin', ownerKey, 1, { op: 'look', ref, at: Date.now() })) })).json();
    ok('moving it puts this phone on the licence (as Android) and unlocks the app', /this phone is one of them/.test(await page.locator('.licence-panel').innerText()) && look.computers.filter(c => c.os === 'Android').length === 1 && look.computers.length === 3);
    await page.locator('.licence-panel').getByRole('button', { name: 'Sign out' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Sign out' }).click(); await sleep(500);
    const look2 = await (await mf.dispatchFetch('https://vdex.crowmade.app/licence/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await codes.signNote('admin', ownerKey, 1, { op: 'look', ref, at: Date.now() })) })).json();
    ok('signing out in the Play app gives its place back', look2.computers.length === 2 && !look2.computers.some(c => c.os === 'Android'));
    await ctx.close();

    // The desktop app keeps its own licence: the website's never runs there.
    ({ ctx, page } = await open());
    ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
    await ctx.close();
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally { await browser.close(); await mf.dispose().catch(() => {}); }
})();

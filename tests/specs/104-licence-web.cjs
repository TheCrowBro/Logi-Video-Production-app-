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
  const open = async ({ width = 420, start = '', storage = null, status = null, routes = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block' });
    if (routes) await routes(ctx);
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.route(u => new globalThis.URL(u).pathname.startsWith('/licence/'), async r => {
      const q = r.request();
      if (status && new globalThis.URL(q.url()).pathname === '/licence/web/status') { asked.push('/licence/web/status'); return status(r); }
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
    await ctx.close();

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

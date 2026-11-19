// The iPhone app (apple/ and js/native.js): the website inside Capacitor, with the phone's plugins standing in here
// (window.Capacitor as the app injects it) and the licence server faked. Buying the licence through the App Store,
// restoring it, a full licence, signing out; no Install button; break alerts scheduled with the phone and their
// buttons; the phone's calendar kept in step both ways; backups through the Files app; a file handed to Vdex; printing
// and sharing through the phone. The server side of the purchase is spec 102.
const { chromium } = require('playwright');
const { acceptTerms, openSetting, openMenu, menuClick, shopSign } = require('../helpers.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const DAY = 86400e3, PRODUCT = 'app.crowmade.vdex.licence';
const b64 = s => Buffer.from(s, 'utf8').toString('base64'), unb64 = s => Buffer.from(s, 'base64').toString('utf8');

// What the app puts on the page: the plugins, answering as the phone would, and a record of every call.
const bridge = () => {
  const cap = window.__cap = { calls: [], listeners: {}, buy: { state: 'purchased', jws: 'good.jws' }, owned: [], picked: null, perm: 'granted', cal: { calendars: [], events: [], next: 1 } };
  const P = (name, methods) => {
    const o = {};
    for (const [m, fn] of Object.entries(methods)) o[m] = async (args = {}) => { cap.calls.push({ plugin: name, method: m, args }); return fn(args); };
    o.addListener = async (ev, cb) => {
      (cap.listeners[name + '.' + ev] = cap.listeners[name + '.' + ev] || []).push(cb);
      const held = sessionStorage.getItem('cap-held-action'); // a notification's button pressed while the app was closed
      if (held && name === 'LocalNotifications' && ev === 'localNotificationActionPerformed') { sessionStorage.removeItem('cap-held-action'); setTimeout(() => cb({ actionId: held, notification: { extra: { tag: 'logi-break' } } }), 0); }
      return { remove() {} };
    };
    return o;
  };
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {
    LocalNotifications: P('LocalNotifications', { checkPermissions: () => ({ display: cap.perm }), requestPermissions: () => ({ display: (cap.perm = 'granted') }), registerActionTypes: () => {}, schedule: a => ({ notifications: a.notifications.map(n => ({ id: n.id })) }), cancel: () => {}, getPending: () => ({ notifications: [] }) }),
    CapacitorCalendar: P('CapacitorCalendar', {
      checkAllPermissions: () => ({ result: { readCalendar: 'granted', writeCalendar: 'granted', readReminders: 'prompt', writeReminders: 'prompt' } }), requestFullCalendarAccess: () => ({ result: 'granted' }),
      listCalendars: () => ({ result: cap.cal.calendars }), createCalendar: a => { const id = 'cal' + cap.cal.next++; cap.cal.calendars.push({ id, title: a.title, allowsContentModifications: true }); return { id }; },
      listEventsInRange: a => ({ result: cap.cal.events.filter(e => e.startDate < a.to && e.endDate > a.from) }),
      createEvent: a => { const id = 'ev' + cap.cal.next++; cap.cal.events.push({ ...a, id, lastModifiedDate: Date.now() }); return { id }; },
      modifyEvent: a => { const e = cap.cal.events.find(x => x.id === a.id); if (!e) throw new Error('no event ' + a.id); Object.assign(e, a, { lastModifiedDate: Date.now() }); },
      deleteEvent: a => { cap.cal.events = cap.cal.events.filter(x => x.id !== a.id); }, createEventWithPrompt: () => ({ id: 'ev-prompt', ics: null }) }),
    DocumentPicker: P('DocumentPicker', { save: () => ({ saved: true }), open: () => cap.picked || { name: null }, print: () => ({ printed: true }) }),
    Purchases: P('Purchases', { products: a => ({ products: a.ids.map(id => ({ id, name: 'Vdex Licence', description: '', price: '£19.99' })) }), buy: () => cap.buy, current: () => ({ entitlements: cap.owned }), restore: () => {} }),
    Share: P('Share', { share: () => ({ activityType: 'x' }), canShare: () => ({ value: true }) }),
    Filesystem: P('Filesystem', { writeFile: a => ({ uri: 'file:///cache/' + a.path }), deleteFile: () => {} }),
    Haptics: P('Haptics', { impact: () => {} }),
    App: P('App', {}),
    // The phone's sign-in window: the service's answer, as it would come back on the vdex:// address.
    WebAuth: P('WebAuth', { start: a => {
      sessionStorage.setItem('cap-webauth-last', JSON.stringify(a)); // the page moves on afterwards; the spec reads it there
      const u = new URL(a.url), state = u.searchParams.get('state') || '';
      if (cap.authClosed) return { cancelled: true };
      if (/dropbox\.com\/oauth2\/authorize/.test(a.url)) return { url: 'vdex://signin?state=' + encodeURIComponent(state) + '&code=dbx-code-1' };
      if (/login\.microsoftonline\.com/.test(a.url)) return { url: 'vdex://signin?code=ms-code-1&state=' + encodeURIComponent(state) };
      if (/signin-google\.html/.test(a.url)) return { url: 'vdex://signin?google=1&access_token=gtok-1&expires_in=3600&scope=' + encodeURIComponent(u.searchParams.get('scope') || '') };
      if (/idmsa\.apple\.com/.test(a.url)) return { url: 'vdex://signin?app=icloud&ckWebAuthToken=ck-session-1' };
      return { cancelled: true };
    } }),
  } };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [], hits = [];
  const lic = { ref: '2:7', seats: 3, name: 'App Store customer', email: '', comp: false, expires: '' };
  // Sign-in tokens as the licence server signs them: the App Store purchase's, and an email licence's.
  const TA = await shopSign('web', { apple: '2000000007', ref: '2:7', iat: Date.now() }), TE = await shopSign('web', { email: 'jo@example.com', ref: '1:1', iat: Date.now() });
  // A token is known by whom and which licence it is for: the daily check answers with a new one each time, as the Worker does.
  const who = t => { try { const v = JSON.parse(t.data); return `${v.apple || v.email}|${v.ref}`; } catch { return ''; } };
  const is = (t, T) => !!t && typeof t === 'object' && t.kid === T.kid && who(t) === who(T);
  const renewed = (t, clock) => shopSign('web', { ...JSON.parse(t.data), iat: Date.now(), expires: '', ...(Number.isSafeInteger(clock) ? { clock } : {}) });
  const open = async ({ storage }) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    // The licence server, as cloudflare/worker.mjs answers (its own tests are specs 102 and 104).
    await ctx.route(u => new globalThis.URL(u).pathname.startsWith('/licence/'), async r => {
      const q = r.request(), p = new globalThis.URL(q.url()).pathname, body = q.method() === 'POST' ? (q.postDataJSON() || {}) : {};
      hits.push({ p, body });
      const ans = (status, b) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) }).catch(() => {});
      if (p === '/licence/web/status') return ans(200, { on: true });
      if (p === '/licence/apple/status') return ans(200, { on: true, product: PRODUCT });
      if (p === '/licence/apple/claim') {
        if (body.jws === 'good.jws') return ans(200, { ok: true, appleDevices: true, token: TA, licence: lic, code: 'VDEX-FAKE-CODE-1' });
        if (body.jws === 'full.jws') return ans(200, { ok: true, appleDevices: true, token: TA, licence: lic, code: 'VDEX-FAKE-CODE-1' }); // a licence whose 3 places are all taken elsewhere: an Apple device needs none of them
        return ans(400, { error: 'bad-signature' });
      }
      if (p === '/licence/apple/email') return ans(is(body.token, TA) && /@/.test(body.email) ? 200 : 401, is(body.token, TA) ? { ok: true } : { error: 'signed-out' });
      if (p === '/licence/apple/email/verify') return body.code === '123456' ? ans(200, { ok: true, licence: { ...lic, email: body.email }, code: 'VDEX-FAKE-CODE-2' }) : ans(400, { error: 'wrong-code' });
      if (p === '/licence/web/forget') return ans(is(body.token, TA) ? 200 : 401, is(body.token, TA) ? { ok: true } : { error: 'signed-out' });
      if (p === '/licence/apple/code') return ans(is(body.token, TA) ? 200 : 401, is(body.token, TA) ? { ok: true, code: 'VDEX-FAKE-CODE-3' } : { error: 'signed-out' });
      if (p === '/licence/web/check') return is(body.token, TA) ? ans(200, { ok: true, licence: lic, token: await renewed(body.token, body.clock) }) : is(body.token, TE) ? ans(200, { ok: true, licence: { ...lic, ref: '1:1', email: 'jo@example.com' }, token: await renewed(body.token, body.clock) }) : ans(401, { error: 'signed-out' });
      if (p === '/licence/web/activate') return ans(200, { ok: true, used: body.release ? 3 : 1, receipt: await shopSign('active', { ref: is(body.token, TE) ? '1:1' : '2:7', install: body.install, at: Date.now() }) });
      if (p === '/licence/web/release') return ans(200, { ok: true });
      return ans(404, { error: 'not-found' });
    });
    await ctx.addInitScript(bridge);
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-notify', JSON.stringify({ enabled: true, early: true, wake: false })); });
    await ctx.addInitScript(acceptTerms());
    await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vdex-licence', v); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(storage));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    await page.goto(URL + 'index.html?src=ios'); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const about = async page => {
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'About & Licence');
    await page.waitForFunction(() => !document.querySelector('.licence-panel')?.hidden, null, { timeout: 4000 }).catch(() => {});
    await sleep(300);
  };
  const calls = (page, plugin, method) => page.evaluate(([p, m]) => window.__cap.calls.filter(c => c.plugin === p && c.method === m).map(c => c.args), [plugin, method]);
  const lastHit = p => hits.filter(h => h.p === p).at(-1);
  const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('vdex-licence') || '{}'));
  const panel = page => page.locator('.licence-panel').innerText();
  const btn = (page, name) => page.locator('.licence-panel').getByRole('button', { name, exact: true });
  const toastText = page => page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
  try {
    const now = Date.now();
    const { ctx: ctx1, page } = await open({ storage: { on: true, statusAt: now, first: now - 3 * DAY, seen: now } });
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    await sleep(600);

    /* --------------------------------- the app --------------------------------- */
    await openMenu(page);
    const rows = await page.locator('#menu .menu-row:visible .menu-name').allInnerTexts();
    ok('Install is not listed in the app’s menu; the tutorial, text size and theme, and storage are', (await page.locator('#installBtn').isHidden()) && JSON.stringify(rows) === JSON.stringify(['Tutorial for this page', 'Text size and theme', 'Storage, sync & backups']), rows.join(' | '));
    await page.keyboard.press('Escape'); await sleep(150);
    ok('the app is known as the iPhone app, not the Play app', (await stored(page)).ios === true && !(await stored(page)).play);

    /* ------------------------------- the licence ------------------------------- */
    await about(page);
    const t1 = await panel(page);
    ok('on trial, About & Licence offers the App Store purchase at the App Store’s price, signing in, and restoring', /Buy a licence · £19\.99/.test(t1) && (await btn(page, 'Sign in').count()) === 1 && (await btn(page, 'Restore purchases').count()) === 1, t1.slice(0, 160));
    ok('…and says what it is for: a licence here, or an email sign-in; never the website’s shop', /buy a licence \(£19\.99 once, for up to 3 of your devices\), or sign in with the email address of a licence you already have/.test(t1) && (await page.locator('a[href*="/buy"]').count()) === 0, t1.slice(0, 220));
    await page.screenshot({ path: OUT + '/iphone-licence-trial.png' });
    // a cancelled purchase sheet changes nothing
    await page.evaluate(() => { window.__cap.buy = { state: 'cancelled' }; });
    await btn(page, 'Buy a licence · £19.99').click(); await sleep(500);
    ok('a purchase cancelled in Apple’s sheet asks the App Store for the product and changes nothing', (await calls(page, 'Purchases', 'buy')).length === 1 && (await calls(page, 'Purchases', 'buy'))[0].id === PRODUCT && !lastHit('/licence/apple/claim') && /Buy a licence/.test(await panel(page)));
    // a purchase while the licence's three places are taken elsewhere: an iPhone or iPad needs none of them
    const activatesBefore = hits.filter(x => x.p === '/licence/web/activate').length;
    await page.evaluate(() => { window.__cap.buy = { state: 'purchased', jws: 'full.jws' }; });
    await btn(page, 'Buy a licence · £19.99').click(); await sleep(600);
    const claim1 = lastHit('/licence/apple/claim');
    ok('Apple’s signed purchase goes to the licence server with this phone’s install id and “iPhone”', claim1 && claim1.body.jws === 'full.jws' && /^[\w-]{16,}$/.test(claim1.body.install) && claim1.body.os === 'iPhone', JSON.stringify(claim1 && claim1.body).slice(0, 120));
    ok('it licenses the phone at once, on every iPhone and iPad of the Apple Account, with no device to move and no place taken', /Licensed through the App Store · on every iPhone and iPad of your Apple Account, and up to 3 other devices/.test(await panel(page)) && (await page.locator('.sheet .lic-computers li').count()) === 0, (await panel(page)).slice(0, 160));
    await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(true))); await sleep(400);
    ok('…and its checks never ask for a place', hits.filter(x => x.p === '/licence/web/activate').length === activatesBefore);
    ok('…and the store is paid: cloud storage and files are allowed', await page.evaluate(() => import('./js/store.js').then(s => s.isPaid())));
    await page.screenshot({ path: OUT + '/iphone-licence-all-devices.png' });
    // sign out: nothing to give back, and the purchase is offered again
    const releasesBefore = hits.filter(x => x.p === '/licence/web/release').length;
    await btn(page, 'Sign out').click(); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Sign out', exact: true }).click(); await sleep(500);
    ok('signing out returns to the trial with the purchase offered again; there is no place to give back', hits.filter(x => x.p === '/licence/web/release').length === releasesBefore && /Free trial/.test(await panel(page)) && /Buy a licence · £19\.99/.test(await panel(page)));
    // a straightforward purchase
    await page.evaluate(() => { window.__cap.buy = { state: 'purchased', jws: 'good.jws' }; });
    await btn(page, 'Buy a licence · £19.99').click(); await sleep(600);
    const s1 = await stored(page);
    ok('a purchase confirmed by the licence server licenses the phone at once: a sign-in token and the licence, no place', is(s1.token, TA) && !s1.seat && s1.via === 'apple' && s1.licence && s1.licence.ref === '2:7' && /Licensed through the App Store/.test(await panel(page)) && /Thank you! Vdex is licensed on this phone/.test(await toastText(page)), JSON.stringify(s1).slice(0, 160));
    await page.screenshot({ path: OUT + '/iphone-licence-licensed.png' });
    // the buyer adds an email address, so the same licence signs in elsewhere; the desktop code is there to copy
    ok('an App Store licence offers to add an email, and the code for the desktop app, which is kept nowhere on the phone', (await btn(page, 'Add your email').count()) === 1 && (await btn(page, 'Copy the code for the desktop app').count()) === 1 && !(await stored(page)).code);
    await ctx1.grantPermissions(['clipboard-read', 'clipboard-write']);
    await btn(page, 'Copy the code for the desktop app').click(); await page.waitForFunction(() => /Licence code copied|could not/i.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')), null, { timeout: 5000 }).catch(() => {});
    ok('Copy the code fetches it from the licence server with the phone’s sign-in and copies it', (() => { const c = lastHit('/licence/apple/code'); return c && is(c.body.token, TA); })() && (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === 'VDEX-FAKE-CODE-3' && /Licence code copied/.test(await toastText(page)), await toastText(page));
    await btn(page, 'Add your email').click(); await page.waitForSelector('.sheet input[type="email"]');
    await page.locator('.sheet input[type="email"]').fill('jo@example.com'); await page.locator('.sheet').getByRole('button', { name: 'Email me a code' }).click(); await sleep(400);
    ok('the address gets a 6-digit code (the licence server asked with the phone’s sign-in)', (() => { const e = lastHit('/licence/apple/email'); return e && e.body.email === 'jo@example.com' && is(e.body.token, TA); })() && /on its way to jo@example.com/.test(await page.locator('.sheet').innerText()));
    await page.locator('.sheet input[aria-label="6-digit code"]').fill('111111'); await page.locator('.sheet').getByRole('button', { name: 'Add the address' }).click(); await sleep(400);
    ok('a wrong code is said so', /not right/.test(await page.locator('.sheet').innerText()));
    await page.locator('.sheet input[aria-label="6-digit code"]').fill('123456'); await page.locator('.sheet').getByRole('button', { name: 'Add the address' }).click(); await sleep(500);
    ok('the right code puts the address on the licence: the panel shows it and the Add button is gone', /Licensed through the App Store · jo@example.com · on every iPhone and iPad of your Apple Account/.test(await panel(page)) && (await btn(page, 'Add your email').count()) === 0 && (await page.locator('.sheet').count()) === 0, (await panel(page)).slice(0, 120));
    // restore purchases after signing out (a reinstall, a second iPhone)
    await btn(page, 'Sign out').click(); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Sign out', exact: true }).click(); await sleep(500);
    await page.evaluate(() => { window.__cap.owned = [{ state: 'owned', jws: 'good.jws', productId: 'app.crowmade.vdex.licence', originalTransactionId: '2000000123456789' }]; });
    await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().recheck(true))); await sleep(400);
    ok('a sign-out holds: the hourly check does not quietly take the purchase back', /Free trial/.test(await panel(page)) && (await stored(page)).signedOut === true && !(await stored(page)).token);
    await page.evaluate(() => { window.__cap.owned = []; });
    await btn(page, 'Restore purchases').click(); await sleep(500);
    ok('Restore purchases with nothing owned says so, and stays on trial', /No Vdex purchase was found for this Apple ID/.test(await toastText(page)) && /Free trial/.test(await panel(page)), await toastText(page));
    await page.evaluate(() => { window.__cap.owned = [{ state: 'owned', jws: 'good.jws', productId: 'app.crowmade.vdex.licence', originalTransactionId: '2000000123456789' }]; });
    await btn(page, 'Restore purchases').click(); await sleep(600);
    ok('Restore purchases asks the App Store again and brings an owned purchase back as the licence', (await calls(page, 'Purchases', 'restore')).length >= 1 && /Licensed through the App Store/.test(await panel(page)) && /Your purchase is back/.test(await toastText(page)));
    await btn(page, 'Delete my licence records').click(); await page.waitForSelector('.sheet');
    ok('Delete my licence records says what goes and what stays before anything is deleted', /the link between your licence and your App Store purchase/.test(await page.locator('.sheet').innerText()) && /Your licence itself is not cancelled/.test(await page.locator('.sheet').innerText()) && !lastHit('/licence/web/forget'));
    ok('…and that a computer which still has the licence code puts itself back unless it is released first', /your other devices are signed out at their next check\. A computer that still has your licence code puts itself back at its next weekly check: use Release this computer there first\./.test(await page.locator('.sheet').innerText()));
    await page.locator('.sheet').getByRole('button', { name: 'Delete my records' }).click(); await sleep(500);
    ok('…and deleting signs this phone out, with the purchase offered again', (() => { const f = lastHit('/licence/web/forget'); return f && is(f.body.token, TA); })() && /Free trial/.test(await panel(page)) && /Restore purchases/.test(await panel(page)) && (await stored(page)).signedOut === true);
    await btn(page, 'Restore purchases').click(); await sleep(600);

    /* ------------------------------ break alerts ------------------------------ */
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.evaluate(() => { window.__cap.calls.length = 0; });
    const bid = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings[0].id));
    const t0 = Date.now();
    await page.evaluate(id => import('./js/hours.js').then(hrs => { hrs.startShift(id); hrs.startBreak(15); }), bid); await sleep(600);
    const sched = await calls(page, 'LocalNotifications', 'schedule');
    const list = sched.flatMap(a => a.notifications), end = list.find(n => n.id === 1), early = list.find(n => n.id === 2);
    const near = (d, ms) => Math.abs(new Date(d).getTime() - ms) < 5000;
    ok('a 15-minute break is scheduled with the phone: “Break’s up” at the end, with the Back to work and 5 more minutes buttons, and the warning two minutes before', !!end && !!early && near(end.schedule.at, t0 + 15 * 6e4) && near(early.schedule.at, t0 + 13 * 6e4) && end.actionTypeId === 'VDEX_BREAK' && end.extra.tag === 'logi-break' && !early.actionTypeId, JSON.stringify(list).slice(0, 240));
    const types = await calls(page, 'LocalNotifications', 'registerActionTypes');
    ok('the buttons are registered with the phone once', types.length === 1 && types[0].types[0].actions.map(a => a.id).join() === 'back,later');
    await page.evaluate(() => window.__cap.listeners['LocalNotifications.localNotificationActionPerformed'][0]({ actionId: 'later', notification: { extra: { tag: 'logi-break' } } })); await sleep(500);
    const br = await page.evaluate(() => import('./js/hours.js').then(hrs => hrs.currentBreak(hrs.running())));
    const sched2 = (await calls(page, 'LocalNotifications', 'schedule')).flatMap(a => a.notifications).filter(n => n.id === 1);
    ok('“5 more minutes” on the phone’s notification extends the break and re-schedules the alert', br && br.planned === 20 && sched2.length === 2 && near(sched2[1].schedule.at, t0 + 20 * 6e4), JSON.stringify(br));
    await page.evaluate(() => window.__cap.listeners['LocalNotifications.localNotificationActionPerformed'][0]({ actionId: 'back', notification: { extra: { tag: 'logi-break' } } })); await sleep(500);
    const over = await page.evaluate(() => import('./js/hours.js').then(hrs => !hrs.onBreak(hrs.running())));
    const cancels = await calls(page, 'LocalNotifications', 'cancel');
    ok('“Back to work” on it ends the break and cancels the phone’s pending alerts', over && cancels.some(c => c.notifications.map(n => n.id).join() === '1,2') && /Back to work/.test(await toastText(page)));
    await page.evaluate(id => import('./js/hours.js').then(hrs => { hrs.startBreak(30); }), bid); await sleep(300);
    await page.evaluate(() => sessionStorage.setItem('cap-held-action', 'back'));
    await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
    await page.waitForFunction(() => import('./js/hours.js').then(hrs => !hrs.onBreak(hrs.running())), null, { timeout: 5000 }).catch(() => {});
    ok('Back to work pressed on the notification while Vdex was closed ends the break once the app opens', await page.evaluate(() => import('./js/hours.js').then(hrs => !!hrs.running() && !hrs.onBreak(hrs.running()))));
    await page.evaluate(() => import('./js/hours.js').then(hrs => hrs.stopShift())); await sleep(300);
    await page.evaluate(() => window.logiGo('settings')); await sleep(300);
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); await sleep(200);
    ok('Settings says the phone itself keeps the time, so the alert comes with Vdex closed', (await page.locator('#page').innerText()).includes('The phone itself keeps the time'));

    /* ----------------------------- the phone’s calendar ----------------------------- */
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .card[data-svc="apple"]');
    ok('Calendar & email offers this phone’s calendar as a link of its own beside the account ones, with no sign-in', (await page.locator('.sheet .card[data-svc="apple"]').count()) === 1 && /with no sign-in/.test(await page.locator('.sheet .card[data-svc="apple"]').innerText()) && (await page.locator('.sheet .cloud-choices .cloud-choice').count()) === 2);
    await page.locator('.sheet button[aria-label="Connect This phone’s calendar"]').click();
    await page.waitForFunction(() => { const pl = JSON.parse(localStorage.getItem('logi-cal-phone') || 'null'); return pl && pl.calendarId && Object.keys(pl.events || {}).length > 0; }, null, { timeout: 10000 }).catch(() => {}); await sleep(200);
    const cal = await page.evaluate(() => window.__cap.cal);
    const want = await page.evaluate(() => import('./js/calendar.js').then(m => import('./js/store.js').then(s => s.activeBookings().length + m.dueEvents().length + m.editEvents().length)));
    const cs = await page.evaluate(() => import('./js/store.js').then(s => s.db.calSync || {})), pl = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-cal-phone') || 'null'));
    ok('connecting makes a “Vdex bookings” calendar on the phone and puts every booking, deliverable and edit day in it, each tagged with its Vdex id', cal.calendars.length === 1 && cal.calendars[0].title === 'Vdex bookings' && cal.events.length === want && cal.events.every(e => e.calendarId === cal.calendars[0].id && /event=/.test(e.url)) && pl && pl.calendarId === cal.calendars[0].id && Object.keys(pl.events || {}).length === want, `${cal.events.length} events for ${want}`);
    ok('…as a link of this phone alone: the shared database’s account link is untouched', !cs.provider && !cs.calendarId);
    ok('…and says so', /This phone’s calendar — Up to date/.test(await page.locator('.sheet').innerText()));
    await page.screenshot({ path: OUT + '/iphone-calendar.png' });
    const first = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.activeBookings()[0]; return { id: b.id, title: b.title, allDay: !b.start }; }));
    const ev = cal.events.find(e => decodeURIComponent(e.url.split('event=')[1]) === first.id);
    ok('a timed booking is a timed event and an all-day one an all-day event', !!ev && ev.isAllDay === first.allDay && ev.title.startsWith(first.title));
    // an edit made in the Calendar app comes back
    await page.evaluate(id => { const e = window.__cap.cal.events.find(x => x.id === id); e.title = 'Moved by the calendar'; e.lastModifiedDate = Date.now() + 5000; }, ev.id);
    await page.evaluate(() => import('./js/calendar.js').then(m => m.syncCalendar({ interactive: true }))); await sleep(400);
    ok('a title changed in the Calendar app comes back into the booking', (await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).title), first.id)) === 'Moved by the calendar');
    // a change in Vdex goes out by itself
    await page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const b = d.bookings.find(x => x.id === id); b.title = 'Renamed in Vdex'; b.updatedAt = Date.now(); })), first.id);
    await page.waitForFunction(id => (window.__cap.cal.events.find(x => x.id === id) || {}).title?.startsWith('Renamed in Vdex'), ev.id, { timeout: 10000 }).catch(() => {});
    ok('a booking renamed in Vdex is renamed on the phone’s calendar by itself', (await page.evaluate(id => window.__cap.cal.events.find(x => x.id === id).title, ev.id)).startsWith('Renamed in Vdex'));
    await page.evaluate(() => import('./js/calendar.js').then(m => m.disconnectCalendar('phone')));
    ok('disconnecting forgets the link on this phone', (await page.evaluate(() => localStorage.getItem('logi-cal-phone'))) === null);
    await page.keyboard.press('Escape'); await sleep(300);
    // the one-off add goes to the phone's own new-event screen
    await page.evaluate(id => import('./js/calendar.js').then(m => import('./js/store.js').then(s => m.openAddToCalendar(s.byId('bookings', id)))), first.id); await page.waitForSelector('.sheet');
    await page.locator('.sheet').getByRole('button', { name: 'This phone’s calendar' }).click(); await sleep(400);
    const prompt = await calls(page, 'CapacitorCalendar', 'createEventWithPrompt');
    ok('Add to calendar offers the phone’s own new-event screen, filled in', prompt.length === 1 && prompt[0].title.startsWith('Renamed in Vdex') && typeof prompt[0].startDate === 'number' && /Added to the calendar/.test(await toastText(page)));
    await page.keyboard.press('Escape'); await sleep(300);

    /* --------------------------------- the Files app --------------------------------- */
    await page.evaluate(() => import('./js/storage-ui.js').then(m => m.exportFile())); await sleep(600);
    const saves = await calls(page, 'DocumentPicker', 'save');
    const backup = saves[0] && JSON.parse(unb64(saves[0].data));
    ok('Export backup opens the Files app with the backup file', saves.length === 1 && /^vdex-backup-\d{4}-\d\d-\d\d\.json$/.test(saves[0].name) && saves[0].type === 'application/json' && backup && Array.isArray(backup.bookings) && backup.bookings.length > 0 && /Backup saved/.test(await toastText(page)), JSON.stringify(saves[0] && saves[0].name));
    backup.bookings[0].title = 'Imported from the Files app';
    await page.evaluate(f => { window.__cap.picked = f; }, { name: 'vdex-backup.json', data: b64(JSON.stringify(backup)), type: 'application/json' });
    await menuClick(page, '#cloudBtn'); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Import backup…' }).click(); await sleep(600);
    ok('Import backup picks the file in the Files app and restores it', (await calls(page, 'DocumentPicker', 'open')).length === 1 && (await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings[0].title))) === 'Imported from the Files app' && /Imported/.test(await toastText(page)));
    await page.keyboard.press('Escape'); await sleep(300);

    /* ------------------------------ a file for Vdex ------------------------------ */
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    const shots = 'INT. KITCHEN - DAY\nWide: Ana at the stove\nClose-up: hands on the kettle\n';
    await page.evaluate(f => window.__cap.listeners['DocumentPicker.file'][0](f), { name: 'shots.txt', data: b64(shots), type: 'text/plain' }); await page.waitForSelector('.sheet'); await sleep(200);
    const sheetText = await page.locator('.sheet').innerText();
    ok('a file handed to Vdex asks what it is: a script for TC Notes, or a shot list for one of the bookings', /A file for Vdex/.test(sheetText) && /shots\.txt/.test(sheetText) && (await page.locator('.sheet').getByRole('button', { name: /Script for TC Notes/ }).count()) === 1 && /Shot list for a booking/.test(sheetText));
    await page.screenshot({ path: OUT + '/iphone-file-arrived.png' });
    await page.locator('.sheet').getByRole('button', { name: /Imported from the Files app/ }).click(); await sleep(500);
    const nShots = await page.evaluate(() => import('./js/store.js').then(s => (s.db.bookings[0].shots || []).length));
    ok('as a shot list, its shots go on that booking', nShots >= 2 && /2 shots added/.test(await toastText(page)), `${nShots} shots · ${await toastText(page)}`);
    await page.evaluate(f => window.__cap.listeners['DocumentPicker.file'][0](f), { name: 'scene-12.txt', data: b64('ANA\nIs the kettle on?\nBEN\nNearly.\n'), type: 'text/plain' }); await page.waitForSelector('.sheet'); await sleep(200);
    await page.locator('.sheet').getByRole('button', { name: /Script for TC Notes/ }).click(); await sleep(800);
    ok('as a script, it goes to TC Notes', (await page.evaluate(() => window.logiPage())) === 'tcnotes' && /scene-12\.txt|import-preview/.test(await page.evaluate(() => document.getElementById('page').innerText + (document.querySelector('.import-preview') ? 'import-preview' : ''))));
    await page.keyboard.press('Escape'); await sleep(300);

    /* --------------------------- printing and sharing --------------------------- */
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.evaluate(() => import('./js/callsheet.js').then(m => import('./js/store.js').then(s => m.printCallSheet(s.db.bookings[0])))); await sleep(500);
    ok('printing a call sheet uses the phone’s print sheet, and the page is put back afterwards', (await calls(page, 'DocumentPicker', 'print')).length === 1 && !(await page.evaluate(() => document.body.classList.contains('print-cs'))));
    await page.evaluate(() => import('./js/calendar.js').then(m => m.shareAll())); await sleep(500);
    const w = await calls(page, 'Filesystem', 'writeFile'), sh = await calls(page, 'Share', 'share');
    ok('sharing the bookings file goes through the phone’s share sheet, with the file written for it first', w.length === 1 && w[0].path === 'share/vdex-bookings.ics' && w[0].directory === 'CACHE' && sh.length === 1 && sh[0].files[0] === 'file:///cache/share/vdex-bookings.ics' && /BEGIN:VCALENDAR/.test(unb64(w[0].data)));

    /* ------------------------------ sign-ins in the app ------------------------------ */
    // Google, Microsoft, Dropbox and Apple refuse to sign in inside an app's web view: in the app each opens in the phone's
    // own sign-in window and comes back on the vdex:// address, which the page then opens as the service's own return.
    const IDS = { dropbox: 'dbxTestKey123', google: '123-test.apps.googleusercontent.com', microsoft: '11111111-2222-3333-4444-555555555555', icloud: { container: 'iCloud.test.vdex', apiToken: 'ck-test-token' } };
    const { ctx: c3, page: p3 } = await open({ storage: { on: true, statusAt: now, first: now - 3 * DAY, seen: now, ios: true, token: TA, licence: lic, seat: 'ok', checked: now, tried: now, seatChecked: now, seatTried: now, install: 'inst-1234567890abcdef' } });
    await c3.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: `export const CLOUD_APPS = ${JSON.stringify(IDS)};` }));
    const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'x-apple-cloudkit-web-auth-token' };
    const api = { dropboxToken: null, msToken: null, ckReferer: null, ck: 0 };
    await c3.route('https://api.dropboxapi.com/**', r => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); if (r.request().url().includes('/oauth2/token')) api.dropboxToken = r.request().postData(); r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.request().url().includes('/oauth2/token') ? { refresh_token: 'dbx-refresh', access_token: 'dbx-access', expires_in: 14400 } : { email: 'jo@example.com', name: { display_name: 'Jo' } }) }); });
    await c3.route('https://login.microsoftonline.com/**', r => { if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS }); if (r.request().url().includes('/token')) api.msToken = r.request().postData(); r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600, scope: 'Calendars.ReadWrite', id_token: 'e30.eyJuYW1lIjoiSm8iLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJqb0BleGFtcGxlLmNvbSJ9.x' }) }); });
    await c3.route('https://graph.microsoft.com/**', r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(r.request().url().includes('/calendars') && r.request().method() === 'POST' ? { id: 'mscal1' } : { value: [] }) }));
    await c3.route('https://api.apple-cloudkit.com/**', r => {
      const u = new globalThis.URL(r.request().url()); api.ck++;
      const reply = (status, body) => r.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!u.searchParams.get('ckWebAuthToken')) { api.ckReferer = r.request().headers().referer || ''; return reply(421, { serverErrorCode: 'AUTHENTICATION_REQUIRED', redirectURL: 'https://idmsa.apple.com/IDMSWebAuth/signin?appIdKey=test' }); }
      if (u.pathname.endsWith('/users/caller')) return reply(200, { userRecordName: '_u1' });
      if (u.pathname.endsWith('/records/lookup')) return reply(200, { records: [{ serverErrorCode: 'NOT_FOUND' }] });
      if (u.pathname.endsWith('/zones/modify')) return reply(200, { zones: [{}] });
      return reply(200, { records: [{ recordName: 'ok' }] });
    });
    await p3.reload(); await p3.waitForSelector('#rolodex .drum-btn'); await sleep(400);
    const wait3 = act => Promise.all([p3.waitForEvent('framenavigated', { predicate: f => f === p3.mainFrame() && /[?&](state|app)=/.test(f.url()), timeout: 10000 }), act()]).then(() => p3.waitForSelector('#rolodex .drum-btn')).then(() => sleep(600));
    // Dropbox
    await menuClick(p3, '#cloudBtn'); await p3.waitForSelector('.sheet .storage'); await sleep(200);
    const more = p3.locator('.sheet details.twirl-more'); if (!(await more.evaluate(e => e.open))) { await more.locator('> summary').click(); await sleep(350); }
    await wait3(() => p3.locator('.sheet .cloud-choice[data-svc="dropbox"] button').click());
    const lastAuth = () => p3.evaluate(() => JSON.parse(sessionStorage.getItem('cap-webauth-last') || 'null'));
    const dbx = await lastAuth(), dbxUrl = dbx && new globalThis.URL(dbx.url);
    ok('Dropbox opens in the phone’s sign-in window, with the app’s mark on the state and the website’s own return address', !!dbxUrl && /dropbox\.com/.test(dbxUrl.host) && /~app$/.test(dbxUrl.searchParams.get('state')) && dbxUrl.searchParams.get('redirect_uri') === URL && dbx.scheme === 'vdex', dbx && dbx.url);
    ok('…and the answer the window brings back finishes the sign-in on the page: Dropbox is connected', api.dropboxToken && /code=dbx-code-1/.test(api.dropboxToken) && (await p3.evaluate(() => localStorage.getItem('logi-provider'))) === 'dropbox', String(api.dropboxToken).slice(0, 120));
    // Google
    const gtok = await p3.evaluate(() => import('./js/providers.js').then(p => p.googleToken('https://www.googleapis.com/auth/drive.appdata', true)));
    const g = await lastAuth(), gUrl = g && /signin-google/.test(g.url) && new globalThis.URL(g.url);
    ok('Google signs in on Vdex’s own page in the phone’s window, with the app’s client and the permission asked for', !!gUrl && gUrl.pathname === '/signin-google.html' && gUrl.searchParams.get('client') === IDS.google && /drive\.appdata/.test(gUrl.searchParams.get('scope')), g && g.url);
    ok('…and the token it brings back is kept, as the website keeps Google’s', gtok === 'gtok-1' && /gtok-1/.test(await p3.evaluate(() => localStorage.getItem('logi-google-tokens') || '')));
    // Microsoft (the calendar)
    await wait3(() => p3.evaluate(() => import('./js/providers.js').then(p => p.microsoftBegin(['Calendars.ReadWrite'], 'calendar'))));
    const ms = await lastAuth(), msUrl = ms && /microsoftonline/.test(ms.url) && new globalThis.URL(ms.url);
    ok('Microsoft opens in the phone’s window with the app’s mark, and its answer connects the calendar', !!msUrl && /~app$/.test(msUrl.searchParams.get('state')) && api.msToken && /code=ms-code-1/.test(api.msToken) && (await p3.evaluate(() => import('./js/store.js').then(s => s.db.calSync && s.db.calSync.provider))) === 'microsoft', String(api.msToken).slice(0, 100));
    await p3.evaluate(() => import('./js/calendar.js').then(m => m.disconnectCalendar()));
    // iCloud
    await wait3(() => p3.evaluate(() => import('./js/store.js').then(s => s.connectIcloud().catch(() => {}))));
    const ap = await lastAuth().then(a => a && /idmsa\.apple/.test(a.url) && a);
    ok('iCloud asks Apple with the page’s marked address, opens Apple’s page in the phone’s window, and keeps the session it brings back', !!ap && /\?app=icloud$/.test(api.ckReferer || '') && (await p3.evaluate(() => localStorage.getItem('logi-icloud-session'))) === 'ck-session-1' && (await p3.evaluate(() => localStorage.getItem('logi-provider'))) === 'icloud', `referer ${api.ckReferer}`);
    ok('…and the page’s address is clean again', (await p3.evaluate(() => location.search)) === '');
    // a window closed early
    await p3.evaluate(() => { window.__cap.authClosed = true; });
    const closed = await p3.evaluate(() => import('./js/providers.js').then(p => p.googleToken('https://www.googleapis.com/auth/calendar.app.created', true).then(() => 'token', e => e.name + ': ' + e.message)));
    ok('a sign-in window closed before the end is a cancelled sign-in, not an error', /^AbortError: The sign-in was closed/.test(closed), closed);
    await c3.close();
    // the hand-over itself: on the website, a page opened by the sign-in window with the app's mark goes to the vdex:// address and no further
    const c4 = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await c4.addInitScript(() => { window.__vdexSignin = u => { window.__bounced = u; }; localStorage.setItem('logi-tour', 'done'); });
    await c4.addInitScript(acceptTerms());
    const p4 = await c4.newPage();
    await p4.goto(URL + 'index.html?state=vdex-abc~app&code=x').catch(() => {}); await sleep(300);
    const b1 = await p4.evaluate(() => window.__bounced || '');
    await p4.goto(URL + 'index.html?app=icloud&ckWebAuthToken=t1').catch(() => {}); await sleep(300);
    const b2 = await p4.evaluate(() => window.__bounced || '');
    await p4.goto(URL + 'index.html?state=vdex-abc&code=x').catch(() => {}); await sleep(300);
    const b3 = await p4.evaluate(() => window.__bounced || '');
    ok('a marked Dropbox or Microsoft answer and a marked iCloud session are handed to the app', b1 === 'vdex://signin?state=vdex-abc~app&code=x' && b2 === 'vdex://signin?app=icloud&ckWebAuthToken=t1', b1 + ' | ' + b2);
    ok('…while the website’s own returns are left alone', b3 === '' && (await p4.locator('#rolodex .drum-btn').count()) > 0);
    await c4.close();

    /* ------------------------------ read-only in the app ------------------------------ */
    const { page: p2 } = await open({ storage: { on: true, statusAt: now, first: now - 31 * DAY, seen: now } });
    await p2.waitForSelector('.licence-bar'); await sleep(300);
    const bar = await p2.locator('.licence-bar').innerText();
    ok('with the trial over, the read-only bar offers the App Store purchase at its price and signing in', /Vdex is read-only/.test(bar) && /Buy · £19\.99/.test(bar) && (await p2.locator('.licence-bar').getByRole('button', { name: 'Sign in' }).count()) === 1 && !/USD/.test(bar), bar);
    await p2.screenshot({ path: OUT + '/iphone-readonly.png' });
    await p2.locator('.licence-bar').getByRole('button', { name: 'Buy · £19.99' }).click(); await sleep(600);
    ok('…and buying from the bar licenses the phone', (await p2.evaluate(sig => { const v = JSON.parse(localStorage.getItem('vdex-licence')); return !!v.token && v.token.sig === sig && v.via === 'apple'; }, TA.sig)) && (await p2.locator('.licence-bar').count()) === 0);

    /* ------------------------------ moving between licences ------------------------------ */
    // A phone on an email licence that restores an App Store purchase gives the email licence's place back first.
    const { ctx: c5, page: p5 } = await open({ storage: { on: true, statusAt: now, first: now - 40 * DAY, seen: now, ios: true, via: 'email', token: TE, licence: { ...lic, ref: '1:1', email: 'jo@example.com' }, seat: 'ok', seatReceipt: await shopSign('active', { ref: '1:1', install: 'inst-abcdef1234567890', at: now }), checked: now, tried: now, seatChecked: now, seatTried: now, install: 'inst-abcdef1234567890' } });
    await p5.evaluate(() => { window.__cap.owned = [{ state: 'owned', jws: 'good.jws', productId: 'app.crowmade.vdex.licence' }]; });
    const relBefore = hits.filter(x => x.p === '/licence/web/release').length;
    const moved = await p5.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().restore()));
    const rel5 = hits.filter(x => x.p === '/licence/web/release').slice(relBefore);
    ok('restoring an App Store purchase on a phone that holds a place on an email licence gives that place back first', rel5.length === 1 && is(rel5[0].body.token, TE) && rel5[0].body.install === 'inst-abcdef1234567890' && moved.mode === 'licensed' && is(await p5.evaluate(() => JSON.parse(localStorage.getItem('vdex-licence')).token), TA), JSON.stringify(rel5).slice(0, 160));
    await c5.close();
    // A phone signed in with an App Store purchase before the app knew how it was licensed still shows it so.
    const { ctx: c6, page: p6 } = await open({ storage: { on: true, statusAt: now, first: now - 40 * DAY, seen: now, ios: true, token: TA, licence: lic, seat: 'ok', checked: now, tried: now, seatChecked: now, seatTried: now, install: 'inst-abcdef1234567890' } });
    await about(p6);
    ok('an older App Store sign-in (from before the app recorded how) reads as one, with Add your email and the desktop code', /Licensed through the App Store/.test(await panel(p6)) && (await btn(p6, 'Add your email').count()) === 1 && (await btn(p6, 'Copy the code for the desktop app').count()) === 1);
    await c6.close();

    /* ------------------------------ the first screen in the app ------------------------------ */
    // Apple asks an app with a trial to say, before it starts, how long it lasts, what stops after it and what it costs.
    const c9 = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await c9.addInitScript(bridge);
    const p9 = await c9.newPage(); const popups = []; c9.on('page', pg => popups.push(pg.url()));
    await p9.goto(URL + 'index.html?src=ios'); await p9.waitForSelector('.terms-gate');
    const gateText = await p9.locator('.terms-gate').innerText();
    ok('the iPhone app’s first screen states the trial in full: 30 days, then read-only until a licence, what needs the licence from the start, and that the licence is the in-app purchase or a sign-in', /free to try for 30 days, then is read-only until you have a licence\. Backup files, spreadsheets and cloud storage need the licence from the start\. In this app the licence is the Vdex Licence, a one-off purchase whose price the App Store shows before you buy; or sign in with a licence you already have\./.test(gateText), gateText.slice(0, 300));
    await Promise.all([p9.waitForURL(/terms\.html/, { timeout: 8000 }).catch(() => {}), p9.locator('.terms-gate a[href="terms.html"]').first().click()]);
    ok('…and the terms open inside the app, not in Safari, with the way back to Vdex', /\/terms\.html$/.test(p9.url()) && popups.length === 0 && (await p9.locator('a.back').count()) === 1, p9.url() + ' popups ' + popups.length);
    await c9.close();

    /* ------------------------------ Vdex's Google sign-in page ------------------------------ */
    const c7 = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await c7.route('https://accounts.google.com/gsi/client', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.google = { accounts: { oauth2: { initTokenClient: cfg => ({ requestAccessToken: o => { window.__greq = { cfg: { client_id: cfg.client_id, scope: cfg.scope }, o }; setTimeout(() => cfg.callback({ access_token: "gtok-page", expires_in: 3599, scope: cfg.scope }), 0); } }) } } };' }));
    await c7.addInitScript(() => { window.__vdexSignin = u => { window.__bounced = u; }; });
    const p7 = await c7.newPage(); const err7 = []; p7.on('pageerror', e => err7.push(e.message)); p7.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) err7.push(m.text()); });
    await p7.goto(URL + 'signin-google.html'); await sleep(300);
    ok('the Google sign-in page on its own says what it is for and offers nothing to press', /The Vdex app opens this page/.test(await p7.locator('#t').innerText()) && await p7.locator('#go').isHidden());
    await p7.goto(URL + 'signin-google.html?client=123-test.apps.googleusercontent.com&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.appdata') + '#hint=' + encodeURIComponent('jo@example.com')); await sleep(300);
    const hashGone = await p7.evaluate(() => location.hash === '');
    await p7.locator('#go').click(); await p7.waitForFunction(() => !!window.__bounced, null, { timeout: 5000 }).catch(() => {});
    const bounced = new globalThis.URL(await p7.evaluate(() => window.__bounced || 'about:blank'));
    const greq = await p7.evaluate(() => window.__greq);
    ok('with the app’s client and permission it asks Google, naming the account it was given after the #, and hands the token to the app', bounced.protocol === 'vdex:' && bounced.searchParams.get('access_token') === 'gtok-page' && bounced.searchParams.get('google') === '1' && greq && greq.cfg.client_id === '123-test.apps.googleusercontent.com' && greq.o.login_hint === 'jo@example.com' && hashGone, bounced.href + ' ' + JSON.stringify(greq));
    ok('…with no errors and nothing its security policy refuses', err7.length === 0, err7.join(' | '));
    await c7.close();

    /* ------------------------------ the Android share sheet ------------------------------ */
    // On Android a file shared to Vdex is parked by the service worker and picked up at ?share=1: it goes to the same chooser.
    const c8 = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await c8.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await c8.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await c8.addInitScript(acceptTerms());
    const p8 = await c8.newPage();
    await p8.goto(URL); await p8.waitForSelector('#rolodex .drum-btn');
    await p8.evaluate(() => caches.open('logi-share').then(c => c.put('shared-file', new Response('INT. KITCHEN - DAY\nWide: Ana at the stove\n', { headers: { 'X-Name': 'shots.txt', 'Content-Type': 'text/plain' } }))));
    await p8.goto(URL + 'index.html?share=1'); await p8.waitForSelector('.sheet', { timeout: 8000 }).catch(() => {});
    ok('a file shared on Android opens the same chooser: a script for TC Notes, or a shot list for a booking', /A file for Vdex/.test(await p8.locator('.sheet').innerText().catch(() => '')) && /shots\.txt/.test(await p8.locator('.sheet').innerText().catch(() => '')) && (await p8.evaluate(() => location.search)) === '');
    await c8.close();

    ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  } finally { await browser.close(); }
})().catch(e => { console.log('FAIL spec crashed: ' + (e.stack || e)); process.exit(1); });

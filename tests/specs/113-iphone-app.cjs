// The iPhone app (apple/ and js/native.js): the website inside Capacitor, with the phone's plugins standing in here
// (window.Capacitor as the app injects it) and the licence server faked. Buying the licence through the App Store,
// restoring it, a full licence, signing out; no Install button; break alerts scheduled with the phone and their
// buttons; the phone's calendar kept in step both ways; backups through the Files app; a file handed to Vdex; printing
// and sharing through the phone. The server side of the purchase is spec 102.
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
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
    o.addListener = async (ev, cb) => { (cap.listeners[name + '.' + ev] = cap.listeners[name + '.' + ev] || []).push(cb); return { remove() {} }; };
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
  } };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [], hits = [];
  const lic = { ref: '2:7', seats: 3, name: 'App Store customer', email: '', comp: false, expires: '' };
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
        if (body.jws === 'good.jws') return ans(200, { ok: true, used: 1, token: 'tok-apple', licence: lic });
        if (body.jws === 'full.jws') return ans(409, { error: 'full', computers: [{ tag: 't1', os: 'Windows', added: '2026-10-01', seen: '2026-11-01' }, { tag: 't2', os: 'Android', added: '2026-10-02', seen: '2026-11-02' }, { tag: 't3', os: 'iPad', added: '2026-10-03', seen: '2026-11-03' }], swapsLeft: 3, token: 'tok-apple', licence: lic });
        return ans(400, { error: 'bad-signature' });
      }
      if (p === '/licence/web/check') return body.token === 'tok-apple' ? ans(200, { ok: true, licence: lic }) : ans(401, { error: 'signed-out' });
      if (p === '/licence/web/activate') return ans(200, { ok: true, used: body.release ? 3 : 1 });
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
    const { page } = await open({ storage: { on: true, statusAt: now, first: now - 3 * DAY, seen: now } });
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    await sleep(600);

    /* --------------------------------- the app --------------------------------- */
    ok('the Install button does not show in the app', await page.locator('#installBtn').isHidden());
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
    // a purchase while the licence's three places are taken: choose one to take off
    await page.evaluate(() => { window.__cap.buy = { state: 'purchased', jws: 'full.jws' }; });
    await btn(page, 'Buy a licence · £19.99').click(); await page.waitForSelector('.sheet .lic-computers li'); await sleep(200);
    const claim1 = lastHit('/licence/apple/claim');
    ok('Apple’s signed purchase goes to the licence server with this phone’s install id and “iPhone”', claim1 && claim1.body.jws === 'full.jws' && /^[\w-]{16,}$/.test(claim1.body.install) && claim1.body.os === 'iPhone', JSON.stringify(claim1 && claim1.body).slice(0, 120));
    ok('with 3 devices already on the licence, the app lists them (iPad and Android apps named) and offers to move one here', (await page.locator('.sheet .lic-computers li').count()) === 3 && /iPad app/.test(await page.locator('.sheet').innerText()) && /Android app/.test(await page.locator('.sheet').innerText()));
    await page.screenshot({ path: OUT + '/iphone-licence-full.png' });
    await page.locator('.sheet .lic-computers li').first().getByRole('button', { name: 'Move it here' }).click(); await sleep(500);
    const act1 = lastHit('/licence/web/activate');
    ok('moving it here releases that device and licenses this phone', act1 && act1.body.release === 't1' && act1.body.token === 'tok-apple' && act1.body.os === 'iPhone' && /Licensed through the App Store · up to 3 devices, and this phone is one of them/.test(await panel(page)), (await panel(page)).slice(0, 160));
    ok('…and the store is paid: cloud storage and files are allowed', await page.evaluate(() => import('./js/store.js').then(s => s.isPaid())));
    // sign out gives the place back
    await btn(page, 'Sign out').click(); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Sign out', exact: true }).click(); await sleep(500);
    const rel = lastHit('/licence/web/release');
    ok('signing out gives the phone’s place back and returns to the trial, with the purchase offered again', rel && rel.body.token === 'tok-apple' && /Free trial/.test(await panel(page)) && /Buy a licence · £19\.99/.test(await panel(page)));
    // a straightforward purchase
    await page.evaluate(() => { window.__cap.buy = { state: 'purchased', jws: 'good.jws' }; });
    await btn(page, 'Buy a licence · £19.99').click(); await sleep(600);
    const s1 = await stored(page);
    ok('a purchase confirmed by the licence server licenses the phone at once: a sign-in token, the licence, this phone on it', s1.token === 'tok-apple' && s1.seat === 'ok' && s1.licence && s1.licence.ref === '2:7' && /Licensed through the App Store/.test(await panel(page)) && /Thank you! Vdex is licensed on this phone/.test(await toastText(page)), JSON.stringify(s1).slice(0, 160));
    await page.screenshot({ path: OUT + '/iphone-licence-licensed.png' });
    // restore purchases after signing out (a reinstall, a second iPhone)
    await btn(page, 'Sign out').click(); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Sign out', exact: true }).click(); await sleep(500);
    await btn(page, 'Restore purchases').click(); await sleep(500);
    ok('Restore purchases with nothing owned says so, and stays on trial', /No Vdex purchase was found for this Apple ID/.test(await toastText(page)) && /Free trial/.test(await panel(page)), await toastText(page));
    await page.evaluate(() => { window.__cap.owned = [{ state: 'owned', jws: 'good.jws', productId: 'app.crowmade.vdex.licence', originalTransactionId: '2000000123456789' }]; });
    await btn(page, 'Restore purchases').click(); await sleep(600);
    ok('Restore purchases asks the App Store again and brings an owned purchase back as the licence', (await calls(page, 'Purchases', 'restore')).length >= 1 && /Licensed through the App Store/.test(await panel(page)) && /Your purchase is back/.test(await toastText(page)));

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
    await page.evaluate(() => import('./js/hours.js').then(hrs => hrs.stopShift())); await sleep(300);
    await page.evaluate(() => window.logiGo('settings')); await sleep(300);
    await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; })); await sleep(200);
    ok('Settings says the phone itself keeps the time, so the alert comes with Vdex closed', (await page.locator('#page').innerText()).includes('The phone itself keeps the time'));

    /* ----------------------------- the phone’s calendar ----------------------------- */
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice[data-svc="apple"]');
    ok('Calendar & email offers this phone’s calendar first, with no sign-in', (await page.locator('.sheet .cloud-choices .cloud-choice').first().getAttribute('data-svc')) === 'apple' && /needs no sign-in/.test(await page.locator('.sheet').innerText()));
    await page.locator('.sheet button[aria-label="Connect This phone’s calendar"]').click(); await sleep(1200);
    const cal = await page.evaluate(() => window.__cap.cal);
    const want = await page.evaluate(() => import('./js/calendar.js').then(m => import('./js/store.js').then(s => s.activeBookings().length + m.dueEvents().length + m.editEvents().length)));
    const cs = await page.evaluate(() => import('./js/store.js').then(s => s.db.calSync));
    ok('connecting makes a “Vdex bookings” calendar on the phone and puts every booking, deliverable and edit day in it, each tagged with its Vdex id', cal.calendars.length === 1 && cal.calendars[0].title === 'Vdex bookings' && cal.events.length === want && cal.events.every(e => e.calendarId === cal.calendars[0].id && /event=/.test(e.url)) && cs.provider === 'apple' && cs.calendarId === cal.calendars[0].id, `${cal.events.length} events for ${want}`);
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
    await page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const b = d.bookings.find(x => x.id === id); b.title = 'Renamed in Vdex'; b.updatedAt = Date.now(); })), first.id); await sleep(2500);
    ok('a booking renamed in Vdex is renamed on the phone’s calendar by itself', (await page.evaluate(id => window.__cap.cal.events.find(x => x.id === id).title, ev.id)).startsWith('Renamed in Vdex'));
    await page.evaluate(() => import('./js/calendar.js').then(m => m.disconnectCalendar()));
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
    await page.click('#cloudBtn'); await page.waitForSelector('.sheet'); await page.locator('.sheet').getByRole('button', { name: 'Import backup…' }).click(); await sleep(600);
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

    /* ------------------------------ read-only in the app ------------------------------ */
    const { page: p2 } = await open({ storage: { on: true, statusAt: now, first: now - 31 * DAY, seen: now } });
    await p2.waitForSelector('.licence-bar'); await sleep(300);
    const bar = await p2.locator('.licence-bar').innerText();
    ok('with the trial over, the read-only bar offers the App Store purchase at its price and signing in', /Vdex is read-only/.test(bar) && /Buy · £19\.99/.test(bar) && (await p2.locator('.licence-bar').getByRole('button', { name: 'Sign in' }).count()) === 1 && !/USD/.test(bar), bar);
    await p2.screenshot({ path: OUT + '/iphone-readonly.png' });
    await p2.locator('.licence-bar').getByRole('button', { name: 'Buy · £19.99' }).click(); await sleep(600);
    ok('…and buying from the bar licenses the phone', (await p2.evaluate(() => JSON.parse(localStorage.getItem('vdex-licence')).seat)) === 'ok' && (await p2.locator('.licence-bar').count()) === 0);

    ok('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  } finally { await browser.close(); }
})().catch(e => { console.log('FAIL spec crashed: ' + (e.stack || e)); process.exit(1); });

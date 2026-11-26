// What a licence unlocks besides editing: cloud storage and saving data files (backups and spreadsheets). Without one,
// the trial included, they are refused with an explanation and an offer, a storage linked earlier is paused (nothing
// read or written) and resumes once there is a licence; PDFs and the rest keep working. Checked on the website (the
// licence check switched on, faked) and in the desktop app (a stand-in bridge), and that nothing changes while
// licences are switched off. Also: a device the licence no longer covers (its place moved, or a store app that signed
// in while all were taken) is as it is without one; Export backup stays open for 30 days after a licence stopped
// covering a device, and not for someone who only had the trial; and links or QR codes that pass on the contact card
// or equipment are made during the trial and with a licence, and after the trial only with one.
const { chromium } = require('playwright');
const { acceptTerms, openSetting, menuClick, shopSign } = require('../helpers.cjs');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 86400e3;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // web: the licence check's answers ({ on } and /check); dav: a fake WebDAV storage that counts every request.
  const open = async ({ web = null, desktop = null, storage = null, dav = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    const davCalls = [];
    if (dav) await ctx.route('https://dav.example.test/**', r => { davCalls.push(r.request().method() + ' ' + new globalThis.URL(r.request().url()).pathname); r.fulfill({ status: r.request().method() === 'GET' ? 404 : 201, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }); });
    if (web) await ctx.route(u => new globalThis.URL(u).pathname.startsWith('/licence/web/'), r => {
      const p = new globalThis.URL(r.request().url()).pathname;
      if (p.endsWith('/status')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ on: web.on }) });
      // web.answers: { check: [status, body], … } in place of the usual answers, read at each request (a test may change them).
      const own = web.answers && web.answers[p.split('/').pop()];
      if (own) return r.fulfill({ status: own[0], contentType: 'application/json', body: JSON.stringify(own[1]) });
      if (p.endsWith('/check')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, licence: { email: 'jo@example.com', ref: '2:1', seats: 3 } }) });
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not-found"}' });
    });
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    if (storage) await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x); sessionStorage.setItem('seeded', '1'); } }, Object.fromEntries(Object.entries(storage).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
    if (desktop) await ctx.addInitScript(st => { window.vdexDesktop = { platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({}), onStatus: () => () => {}, licence: { state: async () => window.__lic || st, onChange: () => () => {}, code: async () => '', buy: async () => true, recheck: async () => window.__lic || st, enter: async () => ({}), release: async () => st } }; }, desktop); // window.__lic: what the desktop app reports from then on
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const downloads = []; page.on('download', d => downloads.push(d.suggestedFilename()));
    await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => import('./js/licence.js').then(m => m.initLicence()));
    await sleep(600);
    return { ctx, page, downloads, davCalls };
  };
  const backups = async page => {
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'Storage, sync & backups');
    await sleep(200);
  };
  const closeSheets = async page => { while (await page.locator('.sheet').count()) { await page.keyboard.press('Escape'); await sleep(150); } };
  // Jo's sign-in token, as the licence server signs it (the page counts no other).
  const TJ = await shopSign('web', { email: 'jo@example.com', ref: '2:1', iat: Date.now() });
  const trialWeb = { on: true }, trialStore = { 'vdex-licence': { on: true, statusAt: Date.now(), first: Date.now() - 2 * DAY, seen: Date.now() } };
  try {
    // Licences switched off (as now): everything works as before.
    let { ctx, page, downloads } = await open();
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(500);
    ok('while licences are switched off, backups save as before', downloads.some(n => /^vdex-backup-.*\.json$/.test(n)) && (await page.locator('.licence-needed').count()) === 0);
    await ctx.close();

    // The website in its trial: no backups, spreadsheets or cloud storage.
    ({ ctx, page, downloads } = await open({ web: trialWeb, storage: trialStore }));
    await backups(page);
    ok('Storage, sync & backups says backups come with a licence, rather than warning there is no copy', /Backup files and cloud storage come with a Vdex licence/.test(await page.evaluate(() => [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector('.ss-title').textContent === 'Storage, sync & backups').innerText)));
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(400);
    const sheetText = await page.locator('.licence-needed').innerText().catch(() => '');
    ok('saving a backup during the trial explains it comes with a licence, offers Buy and Sign in, and saves nothing', /Saving backups and spreadsheet files comes with a Vdex licence/.test(sheetText) && /Cloud storage, backup files and spreadsheets need the licence; everything else works during your free trial\./.test(sheetText) && /Buy a licence/.test(sheetText) && /Sign in/.test(sheetText) && !downloads.length);
    ok('the explanation takes the focus itself, not its Buy button', await page.evaluate(() => document.activeElement?.classList.contains('licence-needed')));
    await closeSheets(page);
    await page.getByRole('button', { name: /Encrypted backup/ }).click(); await sleep(300);
    ok('so does an encrypted backup (before asking for a passphrase)', (await page.locator('.licence-needed').count()) === 1 && !(await page.getByText('Passphrase for this backup').count()));
    await closeSheets(page);
    const csvs = await page.evaluate(async () => {
      const store = await import('./js/store.js'), backup = await import('./js/backup.js');
      await backup.exportAssetRegister();
      return { paid: store.isPaid(), asks: store.requirePaid('export') };
    });
    await sleep(300);
    ok('the asset register and other spreadsheets are refused too', csvs.paid === false && csvs.asks === false && !downloads.length);
    await closeSheets(page);
    await menuClick(page, '#cloudBtn'); await sleep(400);
    const panel = page.locator('.sheet').first();
    const panelText = await panel.innerText();
    ok('the storage panel says cloud storage comes with a licence', /Cloud storage comes with a Vdex licence/.test(panelText), panelText.slice(0, 300).replace(/\n/g, ' | '));
    await panel.evaluate(p => p.querySelectorAll('details').forEach(d => { d.open = true; })); await sleep(200);
    await panel.locator('.card', { hasText: 'WebDAV server' }).getByRole('button', { name: 'Connect', exact: true }).click(); await sleep(300);
    ok('connecting a cloud storage explains and offers a licence instead of signing in', /Keeping a copy in your own cloud storage comes with a Vdex licence/.test(await page.locator('.licence-needed').innerText().catch(() => '')));
    await closeSheets(page);
    await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await sleep(300);
    await page.getByRole('button', { name: /Share bookings \(\.ics\)/ }).click(); await sleep(300);
    ok('saving every booking as a calendar file is refused too (Add to calendar for one booking is not)', (await page.locator('.licence-needed').count()) === 1 && !downloads.length);
    await closeSheets(page);
    // Signing in while the explanation is open: it closes, and Storage, sync & backups changes in place.
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(300);
    await page.evaluate(tok => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.token = tok; s.licence = { email: 'jo@example.com', ref: '2:1', seats: 3 }; s.checked = s.tried = Date.now(); localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); }, TJ);
    await page.waitForFunction(() => !document.querySelector('.licence-needed'), null, { timeout: 5000 }).catch(() => {});
    const after = await page.evaluate(() => [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector('.ss-title').textContent === 'Storage, sync & backups').innerText);
    ok('once signed in, the "comes with a licence" offer closes and Storage, sync & backups no longer says it needs one', (await page.locator('.licence-needed').count()) === 0 && !/come with a Vdex licence|backups with a licence/.test(after), after.slice(0, 160).replace(/\n/g, ' | '));
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); delete s.token; delete s.licence; localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => import('./js/store.js').then(s => !s.isPaid()), null, { timeout: 5000 }).catch(() => {});
    const pdfOk = await page.evaluate(async () => (await import('./js/store.js')).isPaid() === false && typeof (await import('./js/callsheet.js')).callSheetHtml === 'function');
    ok('call sheets, quotes and invoices are not affected (no licence check on them)', pdfOk);
    await ctx.close();

    // A storage linked before the licence check: paused, nothing read or written; resumes after signing in.
    const davStore = { ...trialStore, 'logi-provider': 'webdav', 'logi-webdav': { kind: 'webdav', url: 'https://dav.example.test/Vdex', user: 'u', pass: 'p' } };
    let davCalls;
    ({ ctx, page, davCalls } = await open({ web: trialWeb, storage: davStore, dav: true }));
    await sleep(800);
    const first = davCalls.length;
    await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Trial Tess' }; })));
    await sleep(1800);
    const st = await page.evaluate(() => import('./js/store.js').then(s => ({ status: s.cloud.status, paused: s.cloud.paused })));
    ok('a storage linked earlier is paused during the trial: changes are not copied to it', st.paused && st.status === 'paused' && davCalls.length === first, `${first} → ${davCalls.length}, ${st.status}`);
    const pausedTop = await page.evaluate(() => { const b = document.getElementById('menuBtn'); return { dot: b.dataset.dot, name: b.getAttribute('aria-label'), row: document.getElementById('cloudLabel').textContent }; });
    ok('the hamburger carries an amber dot and says sync is paused, and the menu’s storage row says Paused', pausedTop.dot === 'amber' && /^Menu\. Sync with .+ is paused$/.test(pausedTop.name) && pausedTop.row === 'Paused', JSON.stringify(pausedTop));
    await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await sleep(1500);
    ok('opened again, the paused storage is not touched at all', davCalls.length === first, `${first} → ${davCalls.length}`);
    await menuClick(page, '#cloudBtn'); await sleep(400);
    ok('its panel explains the pause and offers a licence, with no Sync now', /Paused: cloud storage comes with a licence/.test(await page.locator('.sheet').first().innerText()) && (await page.locator('.sheet').first().getByRole('button', { name: 'Get a licence' }).count()) === 1 && (await page.locator('.sheet').first().getByRole('button', { name: 'Sync now' }).count()) === 0);
    await closeSheets(page);
    // Signing in (here: a stored sign-in the faked server confirms).
    await page.evaluate(tok => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.token = tok; s.licence = { email: 'jo@example.com', ref: '2:1', seats: 3 }; s.checked = s.tried = Date.now(); localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); }, TJ);
    await page.waitForFunction(() => import('./js/store.js').then(s => !s.cloud.paused), null, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    ok('with a licence, syncing starts again by itself', davCalls.length > first && (await page.evaluate(() => import('./js/store.js').then(s => s.cloud.status))) !== 'paused', `${davCalls.length - first} requests`);
    await ctx.close();

    // Signed in on the website: backups save.
    ({ ctx, page, downloads } = await open({ web: trialWeb, storage: { 'vdex-licence': { ...trialStore['vdex-licence'], token: TJ, licence: { email: 'jo@example.com', ref: '2:1', seats: 3 }, checked: Date.now(), tried: Date.now() } } }));
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(500);
    ok('signed in with a licence, backups save', downloads.some(n => /^vdex-backup-/.test(n)) && (await page.locator('.licence-needed').count()) === 0);
    await ctx.close();

    // The Google Play app: the same, without a Buy button.
    ({ ctx, page, downloads } = await open({ web: trialWeb, storage: { 'vdex-licence': { ...trialStore['vdex-licence'], play: true } } }));
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(400);
    const playText = await page.locator('.licence-needed').innerText().catch(() => '');
    ok('in the Play app the explanation offers only Sign in: no Buy, no price', /comes with a Vdex licence/.test(playText) && !/Buy|USD/.test(playText) && /Sign in/.test(playText));
    await ctx.close();

    // The desktop app: in its trial, refused; an early user's or a licensed copy, allowed.
    ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode: 'trial', canEdit: true, trialLeft: 20, seats: 3 } }));
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(400);
    ok('the desktop app in its trial: backups explain and offer Buy and Enter licence code', /comes with a Vdex licence/.test(await page.locator('.licence-needed').innerText().catch(() => '')) && (await page.locator('.licence-needed').getByRole('button', { name: 'Enter licence code' }).count()) === 1 && !downloads.length);
    await ctx.close();
    // A licence code that has not reached the licence server yet (entered without the internet): editing works while
    // it waits, but it is not a licence for backups, spreadsheets or cloud storage until the computer has been added online.
    const waiting = { enabled: true, mode: 'pending', canEdit: true, daysLeft: 9, trialLeft: 0, seats: 3, licence: { name: 'Wendy Waits', email: 'wendy@example.com', seats: 3 } };
    const davWait = { 'logi-provider': 'webdav', 'logi-webdav': { kind: 'webdav', url: 'https://dav.example.test/Vdex', user: 'u', pass: 'p' } };
    ({ ctx, page, downloads, davCalls } = await open({ desktop: waiting, storage: davWait, dav: true }));
    await sleep(800);
    const wFirst = davCalls.length;
    const edited = await page.evaluate(() => import('./js/store.js').then(s => { s.update(d => { d.profile = { ...d.profile, name: 'Wendy Waits' }; }); return { name: s.db.profile.name, paid: s.isPaid() }; }));
    await sleep(1500);
    const wst = await page.evaluate(() => import('./js/store.js').then(s => ({ status: s.cloud.status, paused: s.cloud.paused })));
    ok('the desktop app with a code waiting to be activated: editing works, and it does not count as a licence', edited.name === 'Wendy Waits' && edited.paid === false, JSON.stringify(edited));
    await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await sleep(1500);
    ok('…a cloud storage linked earlier is paused: the change is not copied to it, and opened again it is not touched at all', wst.paused && wst.status === 'paused' && davCalls.length === wFirst, `${wFirst} → ${davCalls.length}, ${wst.status}`);
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(400);
    const waitText = await page.locator('.licence-needed').innerText().catch(() => '');
    ok('…saving a backup is refused, and the explanation says the code is not activated yet, with Try again and no Buy', /Saving backups and spreadsheet files comes with a Vdex licence/.test(waitText) && /Licensed to Wendy Waits \(wendy@example\.com\), but not activated on this computer yet/.test(waitText) && /\(9 days left\)/.test(waitText) && /Cloud storage, backup files and spreadsheets start once it is activated/.test(waitText) && !/Buy|USD|Enter licence code/.test(waitText) && (await page.locator('.licence-needed').getByRole('button', { name: 'Try again' }).count()) === 1 && !downloads.length, waitText.replace(/\n/g, ' | '));
    await closeSheets(page);
    const wcsv = await page.evaluate(async () => { const store = await import('./js/store.js'), backup = await import('./js/backup.js'); await backup.exportAssetRegister(); return store.requirePaid('cloud'); });
    await sleep(300);
    ok('…and so are spreadsheets and connecting a cloud storage', wcsv === false && !downloads.length && (await page.locator('.licence-needed').count()) >= 1);
    await closeSheets(page);
    await page.evaluate(() => window.logiGo('settings')); await sleep(300);
    await openSetting(page, 'About & Licence'); await sleep(300);
    const panelLine = await page.locator('.licence-panel').innerText();
    ok('About & Licence says what waits for the activation', /not activated on this computer yet: Vdex needs the internet once to do that \(9 days left\)\. Cloud storage, backup files and spreadsheets start once it is activated\./.test(panelLine), panelLine.replace(/\n/g, ' | '));
    // The licence server is reached: the computer is on the code's list, and everything a licence brings starts.
    await backups(page);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(300);
    await page.evaluate(() => { window.__lic = { enabled: true, mode: 'licensed', canEdit: true, seats: 3, licence: { name: 'Wendy Waits', email: 'wendy@example.com', seats: 3 } }; });
    await page.locator('.licence-needed').getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => !document.querySelector('.licence-needed'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => import('./js/store.js').then(s => !s.cloud.paused), null, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(500);
    ok('once the code is activated online, the explanation closes, backups save and the storage syncs again', (await page.locator('.licence-needed').count()) === 0 && downloads.some(n => /^vdex-backup-/.test(n)) && davCalls.length > wFirst, `${davCalls.length} requests, ${downloads.join()}`);
    await ctx.close();
    for (const mode of ['founder', 'licensed']) {
      ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode, canEdit: true, seats: 3, licence: { name: 'A', seats: 3 } } }));
      await backups(page);
      await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(500);
      ok(`the desktop app (${mode}): backups save`, downloads.some(n => /^vdex-backup-/.test(n)));
      await ctx.close();
    }
    /* -------- a device the licence does not cover (B7), and Export backup after a licence ends (B9) -------- */
    const unlocks = page => page.evaluate(async () => { const s = await import('./js/store.js'); return { paid: s.isPaid(), cloud: !s.cloud.paused, backup: s.backupsAllowed(), links: s.linksAllowed() }; });
    const tryBackup = async (page, downloads) => {
      await backups(page); const before = downloads.length;
      await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(600);
      const text = await page.locator('.licence-needed').innerText({ timeout: 1500 }).catch(() => ''), health = await page.evaluate(() => [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector('.ss-title').textContent === 'Storage, sync & backups').innerText);
      await closeSheets(page);
      return { saved: downloads.length > before && /^vdex-backup-/.test(downloads.at(-1)), text: text.replace(/\n/g, ' | '), health: health.replace(/\n/g, ' | ') };
    };
    const trySheet = async (page, downloads) => {
      const before = downloads.length;
      await page.evaluate(() => import('./js/backup.js').then(b => b.exportAssetRegister())); await sleep(500);
      const text = await page.locator('.licence-needed').innerText({ timeout: 1500 }).catch(() => ''); await closeSheets(page);
      return { saved: downloads.length > before, text: text.replace(/\n/g, ' | ') };
    };
    // Waits (at most 8 seconds) until the licence the page shows is in this mode.
    const modeIs = async (page, mode) => { for (let i = 0; i < 40; i++) { if ((await page.evaluate(() => import('./js/licence.js').then(m => (m.licenceState() || {}).mode))) === mode) return true; await sleep(200); } return false; };
    const mo = { name: 'Mo Moved', email: 'mo@example.com', seats: 3 };
    const moved = { enabled: true, mode: 'released', canEdit: false, trialLeft: 0, seats: 3, licence: mo };
    ({ ctx, page, downloads } = await open({ desktop: moved }));
    let u = await unlocks(page), b = await tryBackup(page, downloads);
    ok('a computer whose place was moved to another device has no cloud storage, spreadsheets or backup files (it never had a licence that ended here)', !u.paid && !u.cloud && !u.backup && !b.saved, JSON.stringify(u));
    ok('…and pressing Export backup says so, with that computer\'s own next step (Activate here again) and no offer to buy', /comes with a Vdex licence/.test(b.text) && /This computer is not on your licence/.test(b.text) && /Activate here again/.test(b.text) && !/Buy a licence/.test(b.text), b.text);
    await ctx.close();
    ({ ctx, page, downloads } = await open({ desktop: { ...moved, lapsedAt: Date.now() - DAY } }));
    u = await unlocks(page); b = await tryBackup(page, downloads);
    let sheetTry = await trySheet(page, downloads);
    ok('a computer that learned yesterday that its place was moved still saves a backup file', b.saved && u.backup && !u.paid && !u.cloud, JSON.stringify(u));
    ok('…Storage, sync & backups says until when, and that cloud storage and spreadsheets need a licence', /Your licence no longer covers this device\. Export backup still saves a backup file of everything here until .+; cloud storage and spreadsheets need a licence\./.test(b.health), b.health.slice(0, 260));
    ok('…while spreadsheets stop at once, and their explanation says backups still work until a date', !sheetTry.saved && /Saving spreadsheet files comes with a Vdex licence/.test(sheetTry.text) && /Export backup still saves a backup file of everything here until/.test(sheetTry.text), sheetTry.text);
    await ctx.close();
    for (const [days, works] of [[29, true], [31, false]]) {
      ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode: 'cancelled', canEdit: false, trialLeft: 0, seats: 3, licence: mo, lapsedAt: Date.now() - days * DAY } }));
      b = await tryBackup(page, downloads);
      ok(`a desktop licence cancelled (refunded or charged back) ${days} days ago: Export backup ${works ? 'still saves a file' : 'no longer does'}`, b.saved === works && (works || /Saving backups and spreadsheet files comes with a Vdex licence/.test(b.text)), b.text);
      await ctx.close();
    }
    // The code removed afterwards: the day stays (desktop/licence.js keeps it), and so do the 30 days.
    ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, seats: 3, lapsedAt: Date.now() - 2 * DAY } }));
    b = await tryBackup(page, downloads);
    ok('…with the code removed after it ended, the 30 days carry on from the same day', b.saved, b.text);
    await ctx.close();
    ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, seats: 3 } }));
    b = await tryBackup(page, downloads);
    ok('someone who only ever had the trial gets no backup file after it', !b.saved && /Saving backups and spreadsheet files comes with a Vdex licence/.test(b.text), b.text);
    await ctx.close();

    // The website: a refund learned at the daily check, kept on the device, not started again by signing in again.
    const jo = { email: 'jo@example.com', ref: '2:1', seats: 3 };
    const signedIn = extra => ({ 'vdex-licence': { on: true, statusAt: Date.now(), first: Date.now() - 40 * DAY, seen: Date.now(), token: TJ, licence: jo, checked: Date.now() - 2 * DAY, tried: Date.now() - 2 * DAY, ...extra } });
    const refunded = { on: true, answers: { check: [403, { error: 'cancelled' }], start: [200, { ok: true }], verify: [403, { error: 'no-licence' }] } };
    ({ ctx, page, downloads } = await open({ web: refunded, storage: signedIn() }));
    await modeIs(page, 'cancelled');
    const kept = () => page.evaluate(() => JSON.parse(localStorage.getItem('vdex-licence')));
    const lapsed1 = (await kept()).lapsed;
    u = await unlocks(page); b = await tryBackup(page, downloads); sheetTry = await trySheet(page, downloads);
    const edits = await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Nope' }; })));
    ok('a signed-in browser learns of a refund at its daily check, and keeps that day on the device', Math.abs(lapsed1 - Date.now()) < 60e3, String(lapsed1));
    ok('…Export backup still saves a file, while spreadsheets and cloud storage stop at once and (the trial long over) nothing can be changed', b.saved && !sheetTry.saved && !u.paid && !u.cloud && edits === false, JSON.stringify(u) + ' ' + sheetTry.text);
    await closeSheets(page);
    await page.evaluate(() => import('./js/licence.js').then(m => m.signIn())); await sleep(200);
    await page.locator('.sheet input[type="email"]').fill('jo@example.com'); await page.locator('.sheet').getByRole('button', { name: 'Email me a code' }).click();
    await page.waitForFunction(() => document.querySelector('.licence-digits')?.offsetParent != null, null, { timeout: 8000 });
    await page.locator('.sheet .licence-digits').fill('123456'); await page.locator('.sheet').getByRole('button', { name: 'Sign in' }).click(); await sleep(500);
    ok('signing in again with that licence does not start the 30 days again (the licence server refuses it)', (await kept()).lapsed === lapsed1 && /No licence is linked/.test(await page.locator('.sheet').last().innerText()));
    await ctx.close();
    // A free licence past its end date, then signed out: the day stays.
    ({ ctx, page, downloads } = await open({ web: { on: true }, storage: signedIn({ licence: { ...jo, comp: true, expires: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10) }, checked: Date.now(), tried: Date.now() }) }));
    const ended1 = await kept();
    await page.evaluate(() => import('./js/licence-web.js').then(m => m.webLicence().release()));
    await page.evaluate(() => import('./js/licence.js').then(m => document.dispatchEvent(new Event('visibilitychange')))); await sleep(600);
    const ended2 = await kept(); b = await tryBackup(page, downloads);
    ok('a licence given until a date that has passed: the day this browser saw it is kept, also after signing out, and Export backup still works', ended1.lapsed > 0 && Math.abs(ended1.lapsed - Date.now()) < 60e3 && !ended2.token && ended2.lapsed === ended1.lapsed && b.saved, JSON.stringify({ l1: ended1.lapsed, l2: ended2.lapsed, b }));
    await ctx.close();
    for (const [days, works] of [[29, true], [31, false]]) {
      ({ ctx, page, downloads } = await open({ web: { on: true }, storage: { 'vdex-licence': { on: true, statusAt: Date.now(), first: Date.now() - 90 * DAY, seen: Date.now(), cancelled: true, lapsed: Date.now() - days * DAY } } }));
      b = await tryBackup(page, downloads);
      ok(`on the website, ${days} days after a licence stopped covering the browser, Export backup ${works ? 'still saves a file' : 'no longer does'}`, b.saved === works, b.text);
      await ctx.close();
    }
    // The Play app: its place moved to another device at its weekly check (a licence it had), or signed in while the
    // licence's 3 places were taken (never on it).
    const three = [1, 2, 3].map(i => ({ tag: 't' + i, os: 'Mac', added: '2026-11-01', seen: '2026-11-18' }));
    ({ ctx, page, downloads } = await open({ web: { on: true, answers: { activate: [409, { error: 'full', computers: three, swapsLeft: 2 }] } }, storage: signedIn({ play: true, seat: 'ok', seatChecked: Date.now() - 8 * DAY, seatTried: Date.now() - 8 * DAY, checked: Date.now(), tried: Date.now(), install: 'inst-play-000000000' }) }));
    await modeIs(page, 'released');
    u = await unlocks(page); b = await tryBackup(page, downloads);
    ok('a Play app whose place was moved: no cloud storage or spreadsheets, Export backup for 30 days, and its own next step (Add this phone)', (await kept()).seat === 'released' && !u.paid && !u.cloud && u.backup && b.saved && Math.abs((await kept()).lapsed - Date.now()) < 60e3, JSON.stringify(u));
    sheetTry = await trySheet(page, downloads);
    ok('…spreadsheets explain it is not on the licence and offer Add this phone, not Buy', !sheetTry.saved && /This phone is not on your licence/.test(sheetTry.text) && /Add this phone/.test(sheetTry.text) && !/Buy/.test(sheetTry.text), sheetTry.text);
    await ctx.close();
    // Moved before this version, which kept no day: its 30 days run from the first look now.
    ({ ctx, page, downloads } = await open({ web: { on: true }, storage: signedIn({ play: true, seat: 'released', seatTried: Date.now(), checked: Date.now(), tried: Date.now() }) }));
    await modeIs(page, 'released');
    u = await unlocks(page);
    ok('a Play app moved off the licence under an earlier version gets its 30 days of Export backup from now, and no cloud storage or spreadsheets', !u.paid && !u.cloud && u.backup && Math.abs((await kept()).lapsed - Date.now()) < 60e3, JSON.stringify(u));
    await ctx.close();
    ({ ctx, page, downloads } = await open({ web: { on: true }, storage: signedIn({ play: true, seat: 'full', seatTried: Date.now(), checked: Date.now(), tried: Date.now() }) }));
    u = await unlocks(page); b = await tryBackup(page, downloads);
    ok('a Play app that signed in while all 3 places were taken: as without a licence (no cloud storage, spreadsheets or backups)', !u.paid && !u.cloud && !u.backup && !b.saved, JSON.stringify(u));
    await ctx.close();
    // Signed in, but its place not added yet (the licence server could not be reached for it, or that address is
    // blocked): not a licence here until it is, as with a desktop code that waits.
    ({ ctx, page, downloads } = await open({ web: { on: true, answers: { activate: [503, {}] } }, storage: signedIn({ play: true, checked: Date.now(), tried: Date.now(), install: 'inst-play-000000001' }) }));
    await modeIs(page, 'pending');
    u = await unlocks(page); sheetTry = await trySheet(page, downloads);
    ok('a Play app whose place has not been added yet: no cloud storage, spreadsheets or backups, and the explanation says why, with Try again and no Buy', !u.paid && !u.cloud && !u.backup && !sheetTry.saved && /not on your licence yet/.test(sheetTry.text) && /Try again/.test(sheetTry.text) && !/Buy/.test(sheetTry.text), JSON.stringify(u) + ' ' + sheetTry.text);
    await ctx.close();

    /* ------------- links that pass on the contact card or equipment (the owner's decision on item 30) ------------- */
    const db = { profile: { name: 'Sam Sample', title: 'Camera operator', phone: '555 0100', email: 'sam@example.com', website: 'https://example.com' }, gear: [{ id: 'g1', name: 'Cinema camera', category: 'Camera', qty: 1, serial: 'SN-1', value: 1000 }],
      bookings: [{ id: 'b1', title: 'Brand film', client: 'Kiln & Co', date: '2026-12-01', start: '09:00', end: '17:00', status: 'Confirmed', crew: [], gear: [] }] };
    const linksNow = async page => {
      const out = {};
      await page.evaluate(() => window.logiGo('me')); await page.waitForSelector('.qr'); await sleep(700);
      out.cardCode = await page.locator('.qr svg').count() > 0; out.cardText = await page.locator('.qr').innerText();
      for (const mode of ['Phone contacts', 'Website']) { await page.locator('.me-modes button', { hasText: mode }).click(); await sleep(500); out[mode] = await page.locator('.qr svg').count() > 0; }
      await page.locator('.me-modes button', { hasText: 'Contact card' }).click(); await sleep(400);
      await page.getByRole('button', { name: /My card’s link/ }).click(); await sleep(500);
      out.cardLink = await page.locator('.sheet textarea.share-link').count() > 0; out.cardAsk = await page.locator('.licence-needed').innerText({ timeout: 1500 }).catch(() => '');
      await closeSheets(page);
      await page.evaluate(() => window.logiGo('gear')); await sleep(500);
      await page.locator('#page button', { hasText: '📤 Share…' }).click(); await sleep(500);
      if (await page.locator('.sheet button', { hasText: 'Make the link' }).count()) { await page.locator('.sheet button', { hasText: 'Make the link' }).click(); await sleep(800); }
      out.gearLink = await page.locator('.sheet textarea.share-link').count() > 0; out.gearCode = await page.locator('.sheet .share-qr svg').count() > 0; out.gearAsk = await page.locator('.licence-needed').innerText({ timeout: 1500 }).catch(() => '');
      await closeSheets(page);
      // Never gated: a link for the crew (and quotes and invoices, which these rules do not touch).
      await page.evaluate(() => Promise.all([import('./js/crew-link.js'), import('./js/store.js')]).then(([c, s]) => c.openCrewShare(s.db.bookings[0]))); await sleep(800);
      out.crew = /crew\.html#/.test(await page.locator('.sheet textarea.share-link').inputValue({ timeout: 1500 }).catch(() => ''));
      await closeSheets(page);
      return out;
    };
    const asks = /Sending your contact card or equipment as a link or QR code comes with a Vdex licence/;
    for (const [label, opts, allowed] of [
      ['on the last day of the free trial', { web: trialWeb, storage: { 'logi-db-v1': db, 'vdex-licence': { on: true, statusAt: Date.now(), first: Date.now() - 29.5 * DAY, seen: Date.now() } } }, true],
      ['the day after the trial ended', { web: trialWeb, storage: { 'logi-db-v1': db, 'vdex-licence': { on: true, statusAt: Date.now(), first: Date.now() - 30.5 * DAY, seen: Date.now() } } }, false],
      ['with a licence, after the trial', { web: trialWeb, storage: { 'logi-db-v1': db, ...signedIn({ checked: Date.now(), tried: Date.now() }) } }, true],
      ['in the desktop app, its trial over', { desktop: { enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, seats: 3 }, storage: { 'logi-db-v1': db } }, false],
      ['while licences are switched off', { storage: { 'logi-db-v1': db } }, true],
    ]) {
      ({ ctx, page, downloads } = await open(opts));
      const l = await linksNow(page);
      if (allowed) ok(`${label}: the Contact card code, the card's link and equipment links with their QR code are made`, l.cardCode && l.cardLink && l.gearLink && l.gearCode && !l.cardAsk && !l.gearAsk && l.crew, JSON.stringify(l));
      else {
        ok(`${label}: the Me page makes no Contact card code and says it needs a licence, while Phone contacts and Website still work`, !l.cardCode && /The Contact card code needs a Vdex licence once the free trial has ended/.test(l.cardText) && l['Phone contacts'] && l.Website, JSON.stringify(l));
        ok(`${label}: the card's link and Equipment → Share… show the licence offer instead, and the crew link still works`, !l.cardLink && !l.gearLink && asks.test(l.cardAsk) && asks.test(l.gearAsk) && l.crew, JSON.stringify(l));
      }
      if (label === 'the day after the trial ended') {
        // Opening a link never needs a licence: the shared page shows a card someone sent.
        const packed = await page.evaluate(() => Promise.all([import('./js/link-pack.js'), import('./js/share-out.js')]).then(([lp, so]) => lp.pack(so.contactSnapshot({ name: 'Ola Other', phone: '555 0111' }))));
        const other = await ctx.newPage(); await other.goto(URL + 'shared.html#' + packed); await other.waitForSelector('.paper h1', { timeout: 8000 }).catch(() => {});
        ok('…and a link someone sent still opens', /Ola Other/.test(await other.locator('.paper h1').innerText().catch(() => '')));
        await other.close();
        // Signing in while on the Me page: the card's code appears without leaving the page.
        await page.evaluate(() => window.logiGo('me')); await sleep(500);
        await page.evaluate(tok => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.token = tok; s.licence = { email: 'jo@example.com', ref: '2:1', seats: 3 }; s.checked = s.tried = Date.now(); localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); }, TJ);
        await page.waitForSelector('.qr svg', { timeout: 6000 }).catch(() => {});
        ok('…and once signed in, the Me page draws the Contact card code by itself', (await page.locator('.qr svg').count()) === 1);
      }
      await ctx.close();
    }
    ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();

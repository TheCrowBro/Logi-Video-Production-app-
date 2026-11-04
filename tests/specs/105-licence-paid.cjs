// What a licence unlocks besides editing: cloud storage and saving data files (backups and spreadsheets). Without one,
// the trial included, they are refused with an explanation and an offer, a storage linked earlier is paused (nothing
// read or written) and resumes once there is a licence; PDFs and the rest keep working. Checked on the website (the
// licence check switched on, faked) and in the desktop app (a stand-in bridge), and that nothing changes while
// licences are switched off.
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
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
      if (p.endsWith('/check')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, licence: { email: 'jo@example.com', ref: '2:1', seats: 3 } }) });
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not-found"}' });
    });
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    if (storage) await ctx.addInitScript(v => { if (!sessionStorage.getItem('seeded')) { for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x); sessionStorage.setItem('seeded', '1'); } }, Object.fromEntries(Object.entries(storage).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
    if (desktop) await ctx.addInitScript(st => { window.vdexDesktop = { platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({}), onStatus: () => () => {}, licence: { state: async () => st, onChange: () => () => {}, code: async () => '', buy: async () => true, recheck: async () => st, enter: async () => ({}), release: async () => st } }; }, desktop);
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
    ok('saving a backup during the trial explains it comes with a licence, offers Buy and Sign in, and saves nothing', /Saving backups and spreadsheet files comes with a Vdex licence/.test(sheetText) && /Everything else works during your free trial/.test(sheetText) && /Buy a licence/.test(sheetText) && /Sign in/.test(sheetText) && !downloads.length);
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
    await page.evaluate(() => document.getElementById('cloudBtn').click()); await sleep(400);
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
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.token = { kid: 2, data: '{}', sig: 'x' }; s.licence = { email: 'jo@example.com', ref: '2:1', seats: 3 }; s.checked = s.tried = Date.now(); localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
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
    ok('the cloud button says Paused', /Paused/.test(await page.locator('#cloudBtn').innerText()));
    await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await sleep(1500);
    ok('opened again, the paused storage is not touched at all', davCalls.length === first, `${first} → ${davCalls.length}`);
    await page.evaluate(() => document.getElementById('cloudBtn').click()); await sleep(400);
    ok('its panel explains the pause and offers a licence, with no Sync now', /Paused: cloud storage comes with a licence/.test(await page.locator('.sheet').first().innerText()) && (await page.locator('.sheet').first().getByRole('button', { name: 'Get a licence' }).count()) === 1 && (await page.locator('.sheet').first().getByRole('button', { name: 'Sync now' }).count()) === 0);
    await closeSheets(page);
    // Signing in (here: a stored sign-in the faked server confirms).
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('vdex-licence')); s.token = { kid: 2, data: '{}', sig: 'x' }; s.licence = { email: 'jo@example.com', ref: '2:1', seats: 3 }; s.checked = s.tried = Date.now(); localStorage.setItem('vdex-licence', JSON.stringify(s)); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => import('./js/store.js').then(s => !s.cloud.paused), null, { timeout: 8000 }).catch(() => {});
    await sleep(1500);
    ok('with a licence, syncing starts again by itself', davCalls.length > first && (await page.evaluate(() => import('./js/store.js').then(s => s.cloud.status))) !== 'paused', `${davCalls.length - first} requests`);
    await ctx.close();

    // Signed in on the website: backups save.
    ({ ctx, page, downloads } = await open({ web: trialWeb, storage: { 'vdex-licence': { ...trialStore['vdex-licence'], token: { kid: 2, data: '{}', sig: 'x' }, licence: { email: 'jo@example.com', ref: '2:1', seats: 3 }, checked: Date.now(), tried: Date.now() } } }));
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
    for (const mode of ['founder', 'licensed']) {
      ({ ctx, page, downloads } = await open({ desktop: { enabled: true, mode, canEdit: true, seats: 3, licence: { name: 'A', seats: 3 } } }));
      await backups(page);
      await page.getByRole('button', { name: 'Export backup' }).click(); await sleep(500);
      ok(`the desktop app (${mode}): backups save`, downloads.some(n => /^vdex-backup-/.test(n)));
      await ctx.close();
    }
    ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();

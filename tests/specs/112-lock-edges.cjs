// The lock's edges: a vault that cannot be written (storage full) never costs the plain copy; a vault that will not
// open never blanks the page; putting the phone away while the PIN is checked still locks; the erase countdown shows
// on every message; Enter never presses a key; the reason for a sudden gate is on the gate itself; two tabs, one PIN:
// a tab that was still on the terms starts again on the lock screen, and an erase in one tab ends the other's part.
const { chromium } = require('playwright');
const { TERMS_RECORD } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); page.on('dialog', d => d.accept()); };
  const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
  const setVis = (page, hidden) => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  // An existing user with data and a PIN, started fresh for each case: the specs' skip flag only until the data is in.
  const existing = async (pin = '246810') => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.addInitScript(t => { if (!localStorage.getItem('spec-seeded')) { localStorage.setItem('spec-seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    if (pin) { await page.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), pin); await page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 }); }
    await page.evaluate(() => localStorage.removeItem('logi-lock-setup'));
    return { ctx, page };
  };
  // The browser's storage is full for the vault: setItem throws for that key only.
  const fullFor = (page, key, on) => page.evaluate(([k, on]) => { const S = Storage.prototype; if (on) { if (!S.__set) S.__set = S.setItem; S.setItem = function (kk, v) { if (kk === k) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } return S.__set.call(this, kk, v); }; } else if (S.__set) { S.setItem = S.__set; } }, [key, on]);

  // --- storage full: the plain copy is never dropped for a vault that was not written ---
  { const { ctx, page } = await existing();
    await fullFor(page, 'logi-vault', true);
    await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Big Data', updatedAt: Date.now() }; }))); await sleep(700);
    ok('a change that cannot reach the vault says so once', (await page.locator('.toast').allInnerTexts()).some(t => /Not enough storage/.test(t)));
    await setVis(page, true); await sleep(600);
    ok('…and hiding the app keeps the plain copy, since there is no encrypted one to fall back on', !!(await ls(page, 'logi-db-v1')) && /Big Data/.test(await ls(page, 'logi-db-v1')) && !(await page.evaluate(() => import('./js/store.js').then(s => s.isSealed()))));
    await setVis(page, false); await sleep(400);
    await fullFor(page, 'logi-vault', false);
    await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Big Data 2', updatedAt: Date.now() }; }))); await sleep(700);
    await setVis(page, true); await sleep(600);
    ok('once there is room again the vault is written and the next hide seals as usual', (await ls(page, 'logi-db-v1')) === null && /Big Data 2/.test(await page.evaluate(() => import('./js/store.js').then(s => s.db.profile.name))));
    await setVis(page, false); await sleep(600);
    ok('…and the data is back when it shows', /Big Data 2/.test(await ls(page, 'logi-db-v1') || ''));
    await ctx.close(); }

  // --- storage full at the set-up: no PIN is saved without its vault ---
  { const { ctx, page } = await existing(null);
    await page.reload(); await page.waitForSelector('.lock-setup');
    await fullFor(page, 'logi-vault', true);
    await page.locator('.lock-setup .pin-input').nth(0).fill('246810'); await page.locator('.lock-setup .pin-input').nth(1).fill('246810'); await page.locator('.lock-setup button[type=submit]').click();
    await page.waitForFunction(() => /Could not set the PIN/.test(document.querySelector('.lock-setup .lock-msg')?.textContent || ''), null, { timeout: 60000 });
    ok('the set-up refuses a PIN whose vault cannot be saved, and keeps no half-made config', /storage is full/.test(await page.locator('.lock-setup .lock-msg').innerText()) && (await ls(page, 'logi-lock')) === null && !!(await ls(page, 'logi-db-v1')));
    await fullFor(page, 'logi-vault', false);
    await page.locator('.lock-setup button[type=submit]').click(); await page.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
    ok('…and takes it once there is room', !!(await ls(page, 'logi-lock')) && !!(await ls(page, 'logi-vault')));
    await ctx.close(); }

  // --- put away while the PIN is being checked ---
  { const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ autoLock: 0 })));
    await page.locator('#lockBtn').click(); await page.waitForSelector('.lock');
    await page.keyboard.type('24681');
    await page.evaluate(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true })); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(2500);
    ok('the PIN typed as the phone goes away unlocks, but the hidden app seals again and stays locked', (await ls(page, 'logi-db-v1')) === null && (await page.evaluate(() => import('./js/lock.js').then(l => l.isLocked()))));
    await setVis(page, false); await sleep(400);
    ok('…so it asks for the PIN when it comes back', (await page.locator('.lock').count()) === 1);
    await page.keyboard.type('246810'); await page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 60000 });
    ok('…and opens with everything intact', (await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length))) === 8);
    await ctx.close(); }

  // --- the erase countdown is on every message, and a vault that will not open never blanks the page ---
  { const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ wipe: true, attempts: 8, until: 0 })));
    await page.locator('#lockBtn').click(); await page.waitForSelector('.lock');
    await page.keyboard.type('246'); await page.keyboard.press('Enter'); await sleep(300);
    ok('Enter with three digits typed adds nothing and tries nothing', (await page.locator('.pin-dots i.on').count()) === 3 && (await page.evaluate(() => JSON.parse(localStorage.getItem('logi-lock')).attempts)) === 8);
    await page.keyboard.type('999'); await page.waitForFunction(() => /Try again in/.test(document.querySelector('.lock-msg')?.textContent || ''), null, { timeout: 60000 });
    ok('the ninth wrong PIN starts a wait and still warns that the next one erases the device', /Try again in \d+ s\. 1 try left before this device is erased\./.test(await page.locator('.lock-msg').innerText()), await page.locator('.lock-msg').innerText());
    ok('the dots tell a screen reader how many digits are in', (await page.locator('.pin-dots').getAttribute('aria-label')) === '0 of 6 digits entered');
    ok('while locked, the app and the skip link are inert', await page.evaluate(() => document.getElementById('app').inert && document.querySelector('.skip').inert));
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ until: 0 }))); await sleep(200);
    await page.keyboard.type('246810'); await page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 60000 });
    ok('…and the right PIN still opens it, lifting the inert', !(await page.evaluate(() => document.getElementById('app').inert)) && !(await page.evaluate(() => document.querySelector('.skip').inert)));
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ wipe: false, attempts: 0 })));
    // a vault that cannot be opened (damaged, or written with another key) while a plain copy is still there: start from the copy
    const plain = await ls(page, 'logi-db-v1');
    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('logi-vault')); v.ct = v.ct.slice(0, -8) + 'AAAAAAAA'; localStorage.setItem('logi-vault', JSON.stringify(v)); });
    await ctx.addInitScript(([db]) => { if (!sessionStorage.getItem('plain-put-back')) { sessionStorage.setItem('plain-put-back', '1'); localStorage.setItem('logi-db-v1', db); const v = JSON.parse(localStorage.getItem('logi-vault') || 'null'); if (v) { v.ct = v.ct.slice(0, -8) + 'AAAAAAAA'; localStorage.setItem('logi-vault', JSON.stringify(v)); } } }, [plain]);
    await page.reload(); await page.waitForSelector('.lock'); await page.keyboard.type('246810');
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 60000 }); await sleep(900);
    ok('a vault that will not open is put aside and Vdex starts from the plain copy, saying so', (await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length))) === 8 && !!(await ls(page, 'logi-vault-broken')) && (await page.locator('.toast').allInnerTexts()).some(t => /starting from the last plain copy/.test(t)), (await page.locator('.toast').allInnerTexts()).join(' | '));
    await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'After', updatedAt: Date.now() }; }))); await sleep(600);
    ok('…and a fresh vault is written again', !!(await ls(page, 'logi-vault')) && (await ls(page, 'logi-vault')) !== (await ls(page, 'logi-vault-broken')));
    // the same with no plain copy at all: Vdex still starts, empty, and says what to do
    await page.evaluate(() => { localStorage.removeItem('logi-db-v1'); const v = JSON.parse(localStorage.getItem('logi-vault')); v.ct = v.ct.slice(0, -8) + 'AAAAAAAA'; localStorage.setItem('logi-vault', JSON.stringify(v)); });
    await page.evaluate(() => { window.addEventListener('pagehide', () => localStorage.removeItem('logi-db-v1'), { capture: true }); });
    await page.reload(); await page.waitForSelector('.lock'); await page.keyboard.type('246810');
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 60000 }); await sleep(900);
    ok('with no plain copy either, Vdex still starts (empty) and says to restore from the cloud or a backup', (await page.locator('.toast').allInnerTexts()).some(t => /no plain copy on this device/.test(t)) && (await page.locator('.lock').count()) === 0);
    await ctx.close(); }

  // --- the reason for a sudden gate is on the gate itself; the Security panel keeps the focus ---
  { const { ctx, page } = await existing();
    await page.evaluate(() => sessionStorage.setItem('logi-wiped', 'A PIN was just set in another tab: enter it here.'));
    await page.reload(); await page.waitForSelector('.lock'); await sleep(300);
    ok('a note left for the next start shows on the lock screen itself', (await page.locator('.lock .lock-msg').innerText()) === 'A PIN was just set in another tab: enter it here.');
    await page.keyboard.type('246810'); await page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 60000 });
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await page.evaluate(() => { const d = [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector(':scope > summary .ss-title')?.textContent === 'Security'); d.open = true; });
    const sel = page.locator('details[data-s="Security"] select[aria-label="Lock when you leave the app"]');
    await sel.focus(); await sel.selectOption('5'); await sleep(300);
    ok('changing the lock timing keeps the focus on the select', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Lock when you leave the app' && (await page.evaluate(() => JSON.parse(localStorage.getItem('logi-lock')).autoLock)) === 5);
    ok('the set-up and lock fields are codes, not passwords, with the label spacing normal', await page.evaluate(() => { const i = document.createElement('input'); i.className = 'pin-input'; i.placeholder = 'Repeat the PIN'; document.body.append(i); const sp = getComputedStyle(i, '::placeholder').letterSpacing; i.remove(); return sp === 'normal'; }));
    await ctx.close(); }

  // --- two tabs on a new device: the one still on the terms starts again on the lock screen for the PIN the other set ---
  { const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    const a = await ctx.newPage(), b = await ctx.newPage(); watch(a); watch(b);
    await a.goto(BASE); await a.waitForSelector('.terms-gate'); await b.goto(BASE); await b.waitForSelector('.terms-gate');
    await a.locator('.terms-gate label.terms-check input').check(); await a.locator('.terms-gate button:has-text("Agree and continue")').click();
    await a.waitForSelector('.lock-setup', { timeout: 15000 });
    await a.locator('.lock-setup .pin-input').nth(0).fill('246810'); await a.locator('.lock-setup .pin-input').nth(1).fill('246810'); await a.locator('.lock-setup button[type=submit]').click(); await a.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
    await b.locator('.terms-gate label.terms-check input').check(); await b.locator('.terms-gate button:has-text("Agree and continue")').click();
    await b.waitForSelector('.lock:not(.lock-setup)', { timeout: 15000 }); await sleep(400);
    ok('the tab that was still on the terms goes to the lock screen, with the reason on it', /Enter your PIN/.test(await b.locator('.lock h1').innerText()) && /set in another tab/.test(await b.locator('.lock .lock-msg').innerText()));
    await b.keyboard.type('246810'); await b.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
    ok('…and the first tab’s PIN opens it: one key for both', (await b.locator('.lock').count()) === 0 && (await b.evaluate(() => JSON.parse(localStorage.getItem('logi-lock')).len)) === 6);
    await ctx.close(); }

  // --- an erase in one tab ends the other tab's part, instead of being undone by it ---
  { const { ctx, page: a } = await existing();
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await b.waitForSelector('.lock'); await b.keyboard.type('246810'); await b.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
    await a.bringToFront(); await sleep(200);
    await b.locator('#lockBtn').click(); await b.waitForSelector('.lock');
    await b.locator('.lock button', { hasText: 'Forgot PIN?' }).click(); await b.locator('.lock-forgot button', { hasText: 'Erase this device' }).click();
    await b.waitForSelector('.terms-gate', { timeout: 15000 }); await sleep(1500);
    ok('after Forgot PIN → Erase in one tab, the device really is erased: the other tab did not write its copy back', (await ls(b, 'logi-db-v1')) === null && (await ls(b, 'logi-lock')) === null && (await ls(b, 'logi-vault')) === null);
    ok('…the erased tab lands on the terms with the reason written on them', /This device was erased/.test(await b.locator('.terms-gate').innerText()));
    await sleep(500);
    ok('…and the other tab started again too', (await a.locator('.terms-gate').count()) === 1);
    await ctx.close(); }

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

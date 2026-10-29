const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const csp = [], errors = [];
  page.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) csp.push(t); else if (m.type() === 'error') errors.push(t); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length);
  ok('sample data loaded', before > 0, before + ' bookings');
  const setVis = hidden => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  const ls = k => page.evaluate(k => localStorage.getItem(k), k);

  // --- set a PIN through the Settings UI ---
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await page.locator('.settings-section > summary', { hasText: 'Security' }).click();
  ok('security section says no PIN', await page.locator('details.settings-section:has(> summary:has-text("Security"))').innerText().then(t => /No PIN/.test(t)));
  await page.getByRole('button', { name: 'Set a PIN…' }).click();
  await page.waitForSelector('.sheet .pin-input');
  const t0 = Date.now();
  await page.locator('.sheet .pin-input').nth(0).fill('246810'); await page.locator('.sheet .pin-input').nth(1).fill('246810');
  await page.locator('.sheet button[type=submit]').click();
  await page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 15000 });
  ok('PIN set: lock config + vault written, plaintext kept while unlocked', !!(await ls('logi-lock')) && !!(await ls('logi-vault')) && !!(await ls('logi-db-v1')), `${Date.now() - t0} ms incl. key derivation`);
  ok('header lock button visible', await page.locator('#lockBtn').isVisible());
  ok('security status shows PIN set', await page.locator('details.settings-section:has(> summary:has-text("Security"))').innerText().then(t => /PIN set/.test(t)));

  // --- hide → sealed; back within the auto-lock time → unsealed without a PIN ---
  await page.evaluate(() => localStorage.setItem('logi-loc', JSON.stringify({ lat: 1, lon: 2 })));
  await setVis(true); await sleep(700);
  ok('hidden: plaintext database and location removed, vault present', (await ls('logi-db-v1')) === null && (await ls('logi-loc')) === null && !!(await ls('logi-vault')));
  const vaultLooksEncrypted = await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('logi-vault')); return v.v === 1 && typeof v.ct === 'string' && !/bookings|Elm Hall/.test(atob(v.ct)); });
  ok('vault content is not readable', vaultLooksEncrypted);
  await setVis(false); await sleep(700);
  ok('visible again (within 1 min): plaintext restored, no lock screen', (await ls('logi-db-v1')) !== null && (await ls('logi-loc')) !== null && (await page.locator('.lock').count()) === 0);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length);
  ok('data intact after seal/unseal', after === before);

  // --- lock straight away on leaving ---
  await page.locator('details.settings-section:has(> summary:has-text("Security"))').locator('select').selectOption('0');
  await setVis(true); await sleep(500); await setVis(false); await sleep(300);
  ok('auto-lock "straight away": lock screen shown, app inert', (await page.locator('.lock').count()) === 1 && (await page.evaluate(() => document.getElementById('app').inert)));
  ok('while locked: plaintext database absent', (await ls('logi-db-v1')) === null);
  for (const d of '111111') await page.locator(`.lock .key[aria-label="${d}"]`).click();
  await page.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 15000 });
  ok('wrong PIN rejected', true, await page.locator('.lock-msg').innerText());
  for (const d of '246810') await page.locator(`.lock .key[aria-label="${d}"]`).click();
  await page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 15000 });
  ok('correct PIN unlocks; plaintext back; app usable', (await ls('logi-db-v1')) !== null && !(await page.evaluate(() => document.getElementById('app').inert)));

  // --- reload: the lock gate runs before the app draws ---
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
  await page.reload(); await page.waitForSelector('.lock');
  await page.screenshot({ path: S + '/lock-screen.png' });
  ok('after reload: lock screen first, no plaintext on disk, no pages drawn', (await ls('logi-db-v1')) === null && (await page.locator('#rolodex .drum-btn').count()) === 0);
  await page.keyboard.type('246810');
  await page.waitForSelector('#rolodex .drum-btn', { timeout: 15000 });
  const afterReload = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length);
  ok('keyboard PIN entry unlocks at boot, data restored', afterReload === before, afterReload + ' bookings');

  // --- throttling after repeated failures ---
  await page.locator('#lockBtn').click(); await page.waitForSelector('.lock');
  ok('Lock now seals the plaintext', (await ls('logi-db-v1')) === null);
  for (let i = 0; i < 5; i++) { await page.keyboard.type('999999'); await page.waitForFunction(n => (JSON.parse(localStorage.getItem('logi-lock')).attempts || 0) >= n, i + 1, { timeout: 15000 }); }
  const msg = await page.locator('.lock-msg').innerText();
  ok('five wrong PINs start a wait', /Try again in \d+ s/.test(msg), msg);
  await page.keyboard.type('246810'); await sleep(800);
  ok('PIN ignored during the wait', (await page.locator('.lock').count()) === 1);
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('logi-lock')); c.until = 0; c.attempts = 0; localStorage.setItem('logi-lock', JSON.stringify(c)); });
  await page.reload(); await page.waitForSelector('.lock'); await page.keyboard.type('246810'); await page.waitForSelector('#rolodex .drum-btn', { timeout: 15000 });

  // --- encrypted backup round trip ---
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await page.locator('.settings-section > summary', { hasText: 'Backups & data' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Encrypted backup…' }).click().then(async () => { await page.waitForSelector('.sheet .pin-input'); await page.locator('.sheet .pin-input').nth(0).fill('correct horse battery'); await page.locator('.sheet .pin-input').nth(1).fill('correct horse battery'); await page.locator('.sheet button[type=submit]').click(); })]);
  const encPath = S + '/enc-backup.json'; await dl.saveAs(encPath);
  const enc = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  ok('encrypted backup file has no plaintext', enc.vdex === 'encrypted-backup' && !/bookings/.test(fs.readFileSync(encPath, 'utf8').replace('"vdex":"encrypted-backup"', '')), dl.suggestedFilename());
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.bookings = []; })));
  ok('bookings cleared before import', (await page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length)) === 0);
  await page.locator('details.settings-section:has(> summary:has-text("Backups & data"))').locator('input[type=file]').setInputFiles(encPath);
  await page.waitForSelector('.sheet .pin-input'); await page.locator('.sheet .pin-input').fill('wrong one'); await page.locator('.sheet button[type=submit]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /wrong passphrase/.test(t.textContent)), null, { timeout: 15000 }).then(() => ok('wrong passphrase refused', true)).catch(() => ok('wrong passphrase refused', false));
  await sleep(2800);
  await page.locator('details.settings-section:has(> summary:has-text("Backups & data"))').locator('input[type=file]').setInputFiles(encPath);
  await page.waitForSelector('.sheet .pin-input'); await page.locator('.sheet .pin-input').fill('correct horse battery'); await page.locator('.sheet button[type=submit]').click();
  await page.waitForFunction(n => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length === n, before, { timeout: 15000 });
  ok('encrypted backup imported with the right passphrase', true);
  ok('backup health line shows a copy today', await page.locator('details.settings-section:has(> summary:has-text("Backups & data"))').innerText().then(t => /copy today/.test(t)));

  // --- asset register ---
  await page.evaluate(() => window.logiGo('gear')); await sleep(400);
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
  const csvPath = S + '/assets.csv'; await dl2.saveAs(csvPath); const csv = fs.readFileSync(csvPath, 'utf8');
  ok('asset register CSV has serials and a total', /Serial number/.test(csv) && /"Total"/.test(csv), csv.split('\n').length + ' lines');

  // --- remove the PIN ---
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await page.locator('.settings-section > summary', { hasText: 'Security' }).click();
  await page.getByRole('button', { name: 'Remove PIN…' }).click();
  await page.waitForSelector('.sheet .pin-input'); await page.locator('.sheet .pin-input').fill('246810'); await page.locator('.sheet button[type=submit]').click();
  await page.waitForFunction(() => !localStorage.getItem('logi-lock'), null, { timeout: 15000 });
  ok('PIN removed: no lock config, no vault, plaintext present, lock button hidden', (await ls('logi-vault')) === null && (await ls('logi-db-v1')) !== null && !(await page.locator('#lockBtn').isVisible()));

  // --- CSP: third-party script with integrity still loads; no CSP violations so far ---
  const msal = await page.evaluate(() => new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.28.1/lib/msal-browser.min.js'; s.integrity = 'sha384-B5PXeUfgiegchZiX5iMRssMrHd9NfPhFnITob1HyW1CY76udptWpBsniaDsH/+BY'; s.crossOrigin = 'anonymous'; s.onload = () => res('loaded ' + typeof window.msal); s.onerror = () => res('error'); document.head.append(s); setTimeout(() => res('timeout'), 30000); }));
  ok('MSAL loads under CSP with integrity', /^loaded object/.test(msal), msal);
  ok('no CSP violations during the run', csp.length === 0, csp.slice(0, 3).join(' | '));
  ok('no page errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

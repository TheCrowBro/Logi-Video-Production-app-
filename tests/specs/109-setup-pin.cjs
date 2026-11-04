// Everyone uses Vdex with a PIN. A device without one meets a full-screen set-up before anything else, whether it is a
// first start (after the terms) or an existing user's next one; the screen explains that a forgotten PIN cannot be
// recovered and that the erase-after-10-wrong-tries option is off unless turned on; Settings has no way to remove the
// PIN; and the tests' skip flag skips only the set-up, never the lock of a PIN that exists.
const { chromium } = require('playwright');
const { TERMS_RECORD } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); };
  const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);

  // --- an existing user: terms agreed, tour seen, data on the device, no PIN yet ---
  { const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.addInitScript(t => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await page.waitForSelector('.lock-setup'); await sleep(300);
    const text = await page.locator('.lock-setup').innerText();
    ok('an existing user with no PIN meets the set-up screen before anything else', (await page.locator('#rolodex .drum-btn').count()) === 0 && /Set a PIN to keep using Vdex/.test(text) && (await page.evaluate(() => document.getElementById('app').inert)));
    ok('…which says the data stays put, that a forgotten PIN cannot be recovered, and that erasing after 10 wrong PINs stays off unless turned on', /stays exactly where it is/.test(text) && /cannot be recovered/.test(text) && /erase this device after 10 wrong PINs/.test(text) && /stays off/.test(text));
    ok('the first PIN field has the focus, and the only button is Save', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'New PIN' && (await page.locator('.lock-setup button').allInnerTexts()).join('|') === 'Save the PIN and continue');
    const a = page.locator('.lock-setup .pin-input').nth(0), b = page.locator('.lock-setup .pin-input').nth(1), save = page.locator('.lock-setup button[type=submit]'), msg = page.locator('.lock-setup .lock-msg');
    await a.fill('12'); await b.fill('12'); await save.click(); await sleep(150);
    ok('too short is refused', /Use 4 to 8 digits/.test(await msg.innerText()), await msg.innerText());
    await a.fill('1111'); await b.fill('1111'); await save.click(); await sleep(150);
    ok('all the same digit is refused', /Not all the same digit/.test(await msg.innerText()), await msg.innerText());
    await a.fill('246810'); await b.fill('246811'); await save.click(); await sleep(150);
    ok('two different PINs are refused, and the repeat field gets the focus', /The two PINs differ/.test(await msg.innerText()) && (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Repeat the PIN');
    ok('the set-up cannot be got around: still no app behind it', (await page.locator('#rolodex .drum-btn').count()) === 0 && (await page.locator('.lock-setup').count()) === 1);
    await b.fill('246810'); await page.keyboard.press('Enter'); // Enter in a field saves, like the button
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 }); await sleep(900);
    const cfg = JSON.parse(await ls(page, 'logi-lock') || 'null');
    ok('saving the PIN starts the app: lock config and vault written, the lock button shown, no walkthrough for an existing user', (await page.locator('.lock-setup').count()) === 0 && cfg && !!cfg.pin && cfg.wipe === false && !!(await ls(page, 'logi-vault')) && (await page.locator('#lockBtn').isVisible()) && (await page.locator('.tour-card').count()) === 0, JSON.stringify(cfg && { wipe: cfg.wipe, len: cfg.len }));
    ok('the PIN itself is not stored', !/246810/.test(await ls(page, 'logi-lock')));
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await page.evaluate(() => { const d = [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector(':scope > summary .ss-title')?.textContent === 'Security'); d.open = true; });
    const btns = await page.locator('details[data-s="Security"] button').allInnerTexts();
    ok('Settings → Security offers Lock now and Change PIN…, and no way to remove the PIN', btns.some(t => /Lock now/.test(t)) && btns.some(t => /Change PIN/.test(t)) && !btns.some(t => /Remove PIN/.test(t)) && !btns.some(t => /Set a PIN/.test(t)), btns.join(' | '));
    ok('…and says every device has one', /Every device that runs Vdex has a PIN/.test(await page.locator('details[data-s="Security"]').innerText()));
    await page.reload(); await page.waitForSelector('.lock'); await sleep(200);
    ok('the next start asks for the PIN on the lock screen: the set-up is done', (await page.locator('.lock-setup').count()) === 0 && /Enter your PIN/.test(await page.locator('.lock h1').innerText()));
    await page.keyboard.type('246810'); await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    ok('…and the PIN opens it', (await page.locator('.lock').count()) === 0);
    await page.evaluate(() => localStorage.setItem('logi-lock-setup', 'skip'));
    await page.reload(); await page.waitForSelector('.lock'); await sleep(200);
    ok('the tests’ skip flag skips only the set-up: a PIN that exists still locks', /Enter your PIN/.test(await page.locator('.lock h1').innerText()) && (await page.locator('#rolodex .drum-btn').count()) === 0);
    await page.keyboard.type('246810'); await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    // Change PIN… follows the same rules as the set-up screen
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await page.evaluate(() => { const d = [...document.querySelectorAll('details.settings-section')].find(x => x.querySelector(':scope > summary .ss-title')?.textContent === 'Security'); d.open = true; });
    await page.getByRole('button', { name: 'Change PIN…' }).click(); await page.waitForSelector('.sheet .pin-input');
    await page.locator('.sheet .pin-input').fill('246810'); await page.locator('.sheet button[type=submit]').click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet .pin-input').length === 2, null, { timeout: 15000 });
    await page.locator('.sheet .pin-input').nth(0).fill('2222'); await page.locator('.sheet .pin-input').nth(1).fill('2222'); await page.locator('.sheet button[type=submit]').click(); await sleep(150);
    ok('Change PIN… refuses the same weak PINs as the set-up screen', /Not all the same digit/.test(await page.locator('.sheet .lock-msg').innerText()));
    await page.locator('.sheet .pin-input').nth(0).fill('135790'); await page.locator('.sheet .pin-input').nth(1).fill('135790'); await page.locator('.sheet button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 15000 }); await sleep(800);
    await page.reload(); await page.waitForSelector('.lock'); await page.keyboard.type('135790'); await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    ok('…and the new PIN opens Vdex, with the data intact', (await page.evaluate(() => import('./js/store.js').then(s => Array.isArray(s.db.bookings)))));
    await ctx.close(); }

  // --- a brand-new device: the terms first, then the PIN as the first step, then the set-up walkthrough ---
  { const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await page.waitForSelector('.terms-gate'); await sleep(300);
    ok('a new device is asked to agree to the terms first, with no PIN screen yet', (await page.locator('.lock-setup').count()) === 0);
    await page.locator('.terms-gate label.terms-check input').check(); await page.locator('.terms-gate button:has-text("Agree and continue")').click();
    await page.waitForSelector('.lock-setup', { timeout: 15000 }); await sleep(300);
    ok('…then to set a PIN as the first step, before the Rolodex or the walkthrough', /First, set a PIN/.test(await page.locator('.lock-setup h1').innerText()) && (await page.locator('#rolodex .drum-btn').count()) === 0 && (await page.locator('.tour-card').count()) === 0);
    await page.locator('.lock-setup .pin-input').nth(0).fill('246810'); await page.locator('.lock-setup .pin-input').nth(1).fill('246810'); await page.locator('.lock-setup button[type=submit]').click();
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    await page.waitForSelector('.tour-card', { timeout: 10000 }); await sleep(300);
    ok('…and the set-up walkthrough follows', /Welcome to Vdex/.test(await page.locator('.tour-card h2').innerText()));
    await page.locator('.tour-card .btn.primary').click(); await sleep(500);
    ok('its second card explains the PIN just set, and the erase option that stays off', /Your PIN/.test(await page.locator('.tour-card h2').innerText()) && /the PIN you just set/.test(await page.locator('.tour-card p').innerText()) && /stays off unless you turn it on/.test(await page.locator('.tour-card p').innerText()));
    await page.keyboard.press('Escape'); await sleep(200);
    ok('the lock button is in the top bar from the start', await page.locator('#lockBtn').isVisible());
    await ctx.close(); }

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

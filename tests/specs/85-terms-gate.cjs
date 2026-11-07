// Using Vdex means accepting its terms of service and privacy policy: nothing starts until they are accepted on the
// device, the acceptance is remembered, and everyone is asked again when the terms change. Clients opening an
// invoice link are never asked.
const { chromium } = require('playwright');
const { TERMS_VERSION } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  };

  // --- a first visit ---
  { const { ctx, page } = await newPage();
    const outside = []; page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) outside.push(u.hostname); });
    await page.goto(BASE); await page.waitForSelector('.terms-gate'); await sleep(600);
    ok('a first visit opens on the terms, and nothing else has started', (await page.locator('#rolodex .drum-btn').count()) === 0 && (await page.locator('.tour-card').count()) === 0 && /Before you start/.test(await page.locator('.terms-gate h1').innerText()));
    ok('…with the short version, and links to the terms and the privacy policy', /keep your own backups/.test(await page.locator('.terms-gate').innerText()) && (await page.locator('.terms-gate a[href="terms.html"]').count()) >= 1 && (await page.locator('.terms-gate a[href="privacy.html"]').count()) >= 1);
    ok('…saying plainly how limited the developer’s responsibility is, for business use and for consumers, linked to those sections', /If you use Vdex for your business, many kinds of loss are excluded and the rest is capped at 50 US dollars\. If you use it as a consumer, you keep your legal rights\./.test(await page.locator('.terms-gate').innerText()) && (await page.locator('.terms-gate a[href="terms.html#liability"]').count()) === 1);
    ok('…and asking to confirm the minimum age and agree to the terms, with the privacy policy there to inform, not to be agreed to', /I am 18 or over, and I have read and agree to the terms of service\./.test(await page.locator('.terms-gate label.terms-check').innerText()) && !/privacy/i.test(await page.locator('.terms-gate label.terms-check').innerText()));
    const agree = page.locator('.terms-gate button:has-text("Agree and continue")');
    ok('Agree stays off until the box is ticked, and the box has the focus', (await agree.isDisabled()) && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'terms-ok');
    ok('the app behind cannot be reached meanwhile', await page.evaluate(() => [...document.body.children].filter(e => !e.classList.contains('terms-gate')).every(e => e.inert)));
    const [doc] = await Promise.all([ctx.waitForEvent('page'), page.locator('.terms-points + .terms-links a[href="terms.html"]').click()]);
    await doc.waitForLoadState();
    ok('the terms open to read without leaving the gate', /terms\.html$/.test(doc.url()) && (await page.locator('.terms-gate').count()) === 1);
    await doc.close();
    ok('nothing has gone to any other site before agreeing', outside.length === 0, outside.join(', '));
    await page.locator('#terms-ok').focus(); await page.keyboard.press('Space'); // by keyboard
    ok('ticking the box turns Agree on', !(await agree.isDisabled()));
    await agree.click();
    await page.waitForSelector('.lock-setup', { timeout: 15000 }); await sleep(200);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-terms')));
    ok('agreeing moves on to setting a PIN (everyone uses Vdex with one), still before the app and the tour', (await page.locator('.terms-gate').count()) === 0 && (await page.locator('#rolodex .drum-btn').count()) === 0 && (await page.locator('.tour-card').count()) === 0 && /First, set a PIN/.test(await page.locator('.lock-setup h1').innerText()));
    await page.locator('.lock-setup .pin-input').nth(0).fill('246810'); await page.locator('.lock-setup .pin-input').nth(1).fill('246810'); await page.locator('.lock-setup button[type=submit]').click();
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    ok('the PIN set, the app starts and the set-up walkthrough follows', (await page.locator('.lock-setup').count()) === 0 && !!(await page.waitForSelector('.tour-card', { timeout: 5000 }).catch(() => null)));
    ok('the acceptance is remembered with its version and time', rec && rec.v === TERMS_VERSION && !isNaN(Date.parse(rec.at)), JSON.stringify(rec));
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForSelector('.lock'); await page.keyboard.type('246810'); await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    ok('the next visit asks only for the PIN: no terms, no set-up', (await page.locator('.terms-gate').count()) === 0 && (await page.locator('.lock-setup').count()) === 0);
    await ctx.close(); }

  // --- someone who accepted an earlier version ---
  { const { ctx, page } = await newPage();
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', JSON.stringify({ v: '2000-01-01', at: '2000-01-01T00:00:00.000Z' })); } });
    await page.goto(BASE); await page.waitForSelector('.terms-gate');
    ok('when the terms change, everyone is asked again, and told why', /The terms have changed/.test(await page.locator('.terms-gate h1').innerText()) && /stays where it is/.test(await page.locator('.terms-gate').innerText()));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.locator('.terms-gate button.terms-save').click()]);
    let saved = null; try { saved = dl && JSON.parse(require('fs').readFileSync(await dl.path(), 'utf8')); } catch { /* below */ }
    ok('…and anyone, licence or not, can save a backup file of their information there before deciding', !!dl && /^vdex-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) && !!saved && Array.isArray(saved.bookings) && (await page.locator('.terms-gate').count()) === 1, dl ? dl.suggestedFilename() : 'no download');
    ok('…and is told Vdex will not open again until they agree', /will not open again until you agree/.test(await page.locator('.terms-gate').innerText()));
    await page.locator('.terms-gate label.terms-check input').check();
    await page.locator('.terms-gate button:has-text("Agree and continue")').click();
    await page.waitForSelector('.lock-setup', { timeout: 15000 });
    ok('…and, having no PIN yet, is asked to set one once', /Set a PIN to keep using Vdex/.test(await page.locator('.lock-setup h1').innerText()) && (await page.locator('#rolodex .drum-btn').count()) === 0);
    await page.locator('.lock-setup .pin-input').nth(0).fill('246810'); await page.locator('.lock-setup .pin-input').nth(1).fill('246810'); await page.locator('.lock-setup button[type=submit]').click();
    await page.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
    ok('…and carries on with the new version accepted', (await page.evaluate(() => JSON.parse(localStorage.getItem('logi-terms')).v)) === TERMS_VERSION);
    await ctx.close(); }

  // --- a client opening an invoice link is not a Vdex user ---
  { const { ctx, page } = await newPage();
    await page.goto(BASE + 'invoice.html'); await sleep(800);
    ok('the client invoice page never shows the terms gate', (await page.locator('.terms-gate').count()) === 0);
    const foot = await page.locator('.foot').innerText();
    ok('…and tells the client Vdex cannot confirm who made the link, to check payment details with the sender', /cannot confirm who made this link/.test(foot) && /confirm the amount and payment details with the sender/.test(foot) && (await page.locator('.foot a[href="terms.html"]').count()) === 1);
    await ctx.close(); }

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

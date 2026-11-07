// Press and hold a booking for three seconds (its card under Next up or on a day, or its header on its own page) and a
// sheet offers to delete it; a tap still opens it, a short hold or a scroll does nothing, and Keep it keeps it.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, hasTouch: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  const count = () => page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length));
  const card = title => page.locator('.bk-month .list .card.tap', { hasText: title });
  const press = async (loc, ms) => { await loc.scrollIntoViewIfNeeded(); await sleep(150); const b = await loc.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + 30); await page.mouse.down(); await sleep(ms); return b; };
  const before = await count();

  // a tap opens the booking, as before
  await card('Location recce').click(); await page.waitForSelector('.bk-detail'); await sleep(200);
  ok('a tap on a card still opens the booking', (await page.locator('.bk-detail').count()) === 1);
  await page.locator('.bk-detail .page-head .back-btn').click(); await sleep(300);
  await page.evaluate(() => { const back = [...document.querySelectorAll('#page .page-head button')].find(b => /Calendar/.test(b.textContent)); if (back) back.click(); }); await sleep(300);

  // a short hold is a tap
  await press(card('Location recce'), 700);
  ok('while held, the card shows the fill', await card('Location recce').evaluate(el => el.classList.contains('holding') && getComputedStyle(el, '::after').animationName === 'hold-fill'));
  await page.mouse.up(); await sleep(400);
  ok('letting go before three seconds opens the booking like a tap, with no sheet', (await page.locator('.bk-detail').count()) === 1 && (await page.locator('.sheet').count()) === 0);
  await page.locator('.bk-detail .page-head .back-btn').click(); await sleep(300);
  await page.evaluate(() => { const back = [...document.querySelectorAll('#page .page-head button')].find(b => /Calendar/.test(b.textContent)); if (back) back.click(); }); await sleep(300);

  // moving the finger (a scroll) cancels the hold
  const b1 = await press(card('Location recce'), 300);
  await page.mouse.move(b1.x + b1.width / 2, b1.y + 30 + 40, { steps: 4 }); await sleep(3200);
  ok('moving the pointer cancels the hold: no sheet after three seconds', (await page.locator('.sheet').count()) === 0 && !(await card('Location recce').evaluate(el => el.classList.contains('holding'))));
  await page.mouse.up(); await sleep(300);
  if (await page.locator('.bk-detail').count()) { await page.locator('.bk-detail .page-head .back-btn').click(); await sleep(300); await page.evaluate(() => { const back = [...document.querySelectorAll('#page .page-head button')].find(b => /Calendar/.test(b.textContent)); if (back) back.click(); }); await sleep(300); }

  // three seconds: the sheet, with Keep it
  await press(card('Location recce'), 3300);
  await page.waitForSelector('.sheet[aria-label="Delete this booking?"]', { timeout: 3000 });
  await page.mouse.up(); await sleep(300);
  const text = await page.locator('.sheet').innerText();
  ok('held for three seconds, a sheet offers to delete that booking and says what goes with it', /Location recce/.test(text) && /cannot be undone/.test(text) && (await page.locator('.sheet button', { hasText: 'Delete booking' }).count()) === 1 && (await page.locator('.sheet button', { hasText: 'Keep it' }).count()) === 1, text.replace(/\n/g, ' | ').slice(0, 160));
  ok('…and letting go after the hold does not open the booking', (await page.locator('.bk-detail').count()) === 0);
  await page.locator('.sheet button', { hasText: 'Keep it' }).click(); await sleep(300);
  ok('Keep it keeps it', (await count()) === before && (await card('Location recce').count()) === 1 && (await page.locator('.sheet').count()) === 0);

  // delete from the list
  await press(card('Corporate interviews'), 3300);
  await page.waitForSelector('.sheet[aria-label="Delete this booking?"]', { timeout: 3000 }); await page.mouse.up();
  await page.locator('.sheet button', { hasText: 'Delete booking' }).click(); await sleep(500);
  ok('Delete booking removes it: gone from the data, the list and with a toast', (await count()) === before - 1 && (await card('Corporate interviews').count()) === 0 && (await page.locator('.toast', { hasText: 'Booking deleted' }).count()) >= 1 && (await page.evaluate(() => import('./js/store.js').then(s => !s.db.bookings.some(b => /Corporate interviews/.test(b.title)) && Object.keys(s.db.deleted).length >= 1))));

  // on the booking's own page: hold the header
  await card('Location recce').click(); await page.waitForSelector('.bk-detail'); await sleep(300);
  const hero = page.locator('.bk-detail .card.hero');
  await press(hero, 3300);
  await page.waitForSelector('.sheet[aria-label="Delete this booking?"]', { timeout: 3000 }); await page.mouse.up();
  ok('holding the booking’s header on its page offers the same sheet', /Location recce/.test(await page.locator('.sheet').innerText()));
  await page.locator('.sheet button', { hasText: 'Delete booking' }).click(); await sleep(600);
  ok('deleting from its page lands on the day it was on', (await page.locator('.bk-detail').count()) === 0 && (await page.locator('.cal-title').count()) === 1 && (await count()) === before - 2);
  // a button inside the header never starts a hold
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.evaluate(() => { const back = [...document.querySelectorAll('#page .page-head button')].find(b => /Calendar/.test(b.textContent)); if (back) back.click(); }); await sleep(300);
  await card('Harbour Brewing').click(); await page.waitForSelector('.bk-detail'); await sleep(300);
  const btn = page.locator('.bk-detail .card.hero button', { hasText: 'Share calendar event' });
  await press(btn, 3300);
  ok('holding a button inside the header does not start the delete hold', (await page.locator('.sheet[aria-label="Delete this booking?"]').count()) === 0 && !(await page.locator('.bk-detail .card.hero').evaluate(el => el.classList.contains('holding'))));
  await page.mouse.up(); await sleep(300);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

const { chromium } = require('playwright');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  ok('the ? button is in the top bar', await page.locator('#helpBtn').isVisible());
  // Walk a tutorial: count the steps that resolved to a highlighted box, and that Done closes it
  const walk = async () => {
    await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card');
    let spots = 0, cards = 0, titles = [];
    for (let i = 0; i < 25; i++) {
      const h2 = page.locator('.tour-card h2');
      if (!(await h2.count())) { await sleep(600); if (!(await h2.count())) break; } // the tour closed by itself: nothing to point at
      cards++;
      titles.push(await h2.innerText());
      if (!(await page.locator('.tour-spot').evaluate(el => el.classList.contains('center')))) spots++;
      const btn = page.locator('.tour-card .btn.primary');
      const label = await btn.innerText();
      await btn.click(); await sleep(350);
      if (label === 'Done') break;
    }
    const closed = (await page.locator('.tour').count()) === 0;
    return { cards, spots, closed, titles };
  };
  const expect = async (name, min) => { const r = await walk(); ok(`${name}: ${r.cards} steps, ${r.spots} highlighted, closes on Done`, r.cards >= min && r.spots >= min && r.closed, r.titles.join(' · ')); };
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400); await expect('Bookings calendar', 4);
  await page.evaluate(() => document.querySelector('.bk-month .cal .day.has')?.click()); await sleep(400); await expect('A day', 2);
  await page.evaluate(() => { document.querySelectorAll('.card.tap').forEach(c => { if (/Harbour/.test(c.textContent)) c.click(); }); }); await page.waitForSelector('.bk-detail'); await expect('A booking', 8);
  await page.locator('.bk-tools button').first().click(); await page.waitForSelector('.cs-page'); await expect('Call sheet', 3);
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(300);
  await page.locator('#bk-money button').first().click(); await page.waitForSelector('.money-page'); await expect('Money', 2);
  for (const [tab, name, min] of [['crew', 'Crew', 3], ['gear', 'Equipment', 5], ['venues', 'Venues', 3], ['insurance', 'Insurance', 3], ['me', 'Me', 3], ['field', 'Field', 2], ['tcnotes', 'Timecode notes', 2], ['settings', 'Settings', 10]]) {
    await page.evaluate(t => window.logiGo(t), tab); await sleep(450); await expect(name, min);
  }
  // Other pages…: the chooser lists every tutorial and can reach a booking from anywhere
  await page.evaluate(() => window.logiGo('crew')); await sleep(300);
  await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card');
  await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet');
  const names = await page.locator('.sheet .card.tap').allInnerTexts();
  ok('chooser lists every tutorial', names.length === Object.keys({ around: 1, bookings: 1, day: 1, booking: 1, callsheet: 1, money: 1, crew: 1, gear: 1, venues: 1, insurance: 1, me: 1, field: 1, tcnotes: 1, settings: 1 }).length, names.join(', '));
  await page.locator('.sheet .card.tap', { hasText: 'A booking' }).click();
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('choosing “A booking” opens a booking and starts its tutorial', (await page.locator('.bk-detail').count()) === 1 && /booking/i.test(await page.locator('.tour-card h2').innerText()));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes the tutorial and the page is usable again', (await page.locator('.tour').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
  await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card'); await page.screenshot({ path: S + '/tutorial.png' }); await page.keyboard.press('Escape');
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

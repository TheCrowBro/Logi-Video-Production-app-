// The top bar on one slim row (the hamburger as an icon on a phone, its name still read out); the Rolodex on a bar of its own that
// slides away as the page scrolls down and comes back as it scrolls up, on a section change or when it takes the
// focus; the Bookings tools as a grid of even tiles; the calendar in its own frame; the clock in the booking's Hours
// box with a strip under the Rolodex only while it runs.
const { chromium } = require('playwright');
const { acceptTerms, openMenu } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);

  // ---- the top bar ----
  // The bar holds the hamburger (and the lock, once a PIN is set: spec 115); everything else is in the menu behind it.
  const row = async () => page.evaluate(() => { const b = [...document.querySelectorAll('.top-actions button')].filter(x => !x.hidden); const tops = b.map(x => Math.round(x.getBoundingClientRect().top)); const label = document.querySelector('#menuBtn .cloud-label'); return { n: b.length, ids: b.map(x => x.id).join(','), oneRow: tops.every(t => t === tops[0]), height: Math.round(document.querySelector('.top').getBoundingClientRect().height), wide: document.documentElement.scrollWidth <= innerWidth, labelW: Math.round(label.getBoundingClientRect().width), text: label.textContent, name: document.getElementById('menuBtn').getAttribute('aria-label') }; });
  for (const w of [360, 420]) {
    await page.setViewportSize({ width: w, height: 900 }); await sleep(200);
    const r = await row();
    ok(`at ${w}px the top bar is one slim row with the hamburger as an icon, its name still read out, no sideways scroll`, r.ids === 'menuBtn' && r.oneRow && r.height <= 64 && r.wide && r.labelW <= 1 && r.text === 'Menu' && r.name === 'Menu', JSON.stringify(r));
  }
  await page.setViewportSize({ width: 1100, height: 900 }); await sleep(200);
  const wide = await row();
  ok('on a wide screen the hamburger shows its label', wide.oneRow && wide.labelW > 10 && wide.text === 'Menu', JSON.stringify(wide));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);
  await openMenu(page);
  ok('Install is listed in the menu in a browser (it goes once installed)', await page.locator('#installBtn').isVisible());
  await page.keyboard.press('Escape'); await sleep(150);

  // ---- the Rolodex bar ----
  const bar = page.locator('#rolodex');
  const state = async () => page.evaluate(() => { const n = document.getElementById('rolodex'); const cs = getComputedStyle(n); return { tucked: n.classList.contains('tucked'), y: Math.round(window.scrollY), bottom: Math.round(n.getBoundingClientRect().bottom), margin: cs.marginLeft, border: cs.borderBottomWidth, pointer: cs.pointerEvents, transform: cs.transform }; });
  const s0 = await state();
  ok('the Rolodex sits on a bar of its own, full width, with a bottom edge', s0.margin === '-16px' && s0.border === '1px' && !s0.tucked, JSON.stringify(s0));
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 300);
  ok('the Bookings page is tall enough to scroll', tall);
  await page.evaluate(() => window.scrollTo(0, 400)); await sleep(120); await page.evaluate(() => window.scrollTo(0, 700)); await sleep(350);
  const s1 = await state();
  ok('scrolling down slides the bar away (out of reach for the pointer)', s1.tucked && s1.bottom <= 2 && s1.pointer === 'none', JSON.stringify(s1));
  await page.evaluate(() => window.scrollTo(0, 650)); await sleep(350);
  const s2 = await state();
  ok('scrolling up, even a little, brings it back', !s2.tucked && s2.bottom > 60, JSON.stringify(s2));
  await page.evaluate(() => window.scrollTo(0, 900)); await sleep(350);
  ok('…and down tucks it again', (await state()).tucked);
  await page.evaluate(() => window.logiGo('crew')); await sleep(500);
  ok('changing section shows the bar', !(await state()).tucked);
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await page.evaluate(() => window.scrollTo(0, 900)); await sleep(350);
  await page.evaluate(() => { document.querySelector('#rolodex .tab[aria-selected="true"]').focus(); }); await sleep(200);
  ok('focus on the Rolodex shows the bar (keyboard users never lose it)', !(await state()).tucked);
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  ok('at the top of the page it is always shown', !(await state()).tucked);

  // ---- the tiles and the framed calendar ----
  const tiles = page.locator('.bk-month .subactions.bk-tiles > .btn');
  const tops = await tiles.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  const names = await tiles.allInnerTexts();
  ok('five even tiles, three to a row on a phone, each with its icon and name', tops.length === 5 && tops[0] === tops[1] && tops[1] === tops[2] && tops[3] > tops[0] && tops[3] === tops[4] && /Pipeline/.test(names[0]) && /Call sheets/.test(names[1]) && /Money/.test(names[2]) && /Hours & statistics/.test(names[3]) && /Calendar & email/.test(names[4]) && (await tiles.first().locator('.tile-ico').count()) === 1, JSON.stringify({ tops, names }));
  const widths = await tiles.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)));
  ok('the tiles are the same size and darker outlined boxes', widths.every(w => Math.abs(w - widths[0]) <= 1) && (await tiles.first().evaluate(e => getComputedStyle(e).borderTopWidth)) === '2px', widths.join(','));
  ok('the old names still reach the same tools', (await page.getByRole('button', { name: 'Call sheets' }).count()) === 1 && (await page.getByRole('button', { name: 'Money' }).count()) === 1);
  await page.setViewportSize({ width: 1100, height: 900 }); await sleep(250);
  const topsWide = await tiles.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  ok('on a wide screen all five sit in one row', topsWide.every(t => t === topsWide[0]), topsWide.join(','));
  const frameWide = await page.evaluate(() => { const p = document.querySelector('.bk-month .cal-panel'), h3 = document.querySelector('.bk-month > h3'); return { panel: !!p, calInside: !!p.querySelector('.cal') && !!p.querySelector('.cal-nav'), beside: h3.getBoundingClientRect().left > p.getBoundingClientRect().right - 10 }; });
  ok('wide: the framed calendar sits left with Next up beside it', frameWide.panel && frameWide.calInside && frameWide.beside, JSON.stringify(frameWide));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(250);
  const frame = await page.evaluate(() => { const p = document.querySelector('.bk-month .cal-panel'), h3 = document.querySelector('.bk-month > h3'); const cs = getComputedStyle(p); return { border: cs.borderTopWidth, darker: cs.backgroundColor !== getComputedStyle(document.querySelector('.cal .day:not(.blank)')).backgroundColor, gap: Math.round(h3.getBoundingClientRect().top - p.getBoundingClientRect().bottom), label: p.getAttribute('aria-label') }; });
  ok('the calendar is framed in a darker outlined panel, apart from the list below it', frame.border === '2px' && frame.darker && frame.gap >= 8 && frame.label === 'Calendar', JSON.stringify(frame));
  await page.screenshot({ path: S + '/bookings-month-tiles.png', fullPage: true });

  // ---- the clock: in the booking's Hours box, with a strip under the Rolodex only while it runs ----
  ok('no strip under the Rolodex while nothing runs, even on a shoot day', await page.locator('#clockbar').evaluate(e => e.hidden));
  await page.evaluate(() => { [...document.querySelectorAll('.card.tap')].find(x => /Location recce/.test(x.textContent))?.click(); }); await page.waitForSelector('.bk-detail'); await sleep(300);
  const clock = page.locator('#bk-hours .card-clock');
  ok('the booking’s Hours box has the clock: today is a shoot day, not started, Start work', /Shoot day/.test(await clock.innerText()) && /not started/.test(await clock.innerText()) && (await clock.getByRole('button', { name: 'Start work' }).count()) === 1, await clock.innerText());
  await clock.getByRole('button', { name: 'Start work' }).click(); await sleep(1300);
  const strip = page.locator('#clockbar .clock.strip');
  ok('Start work runs the clock: the card and the strip both count, with Stop work and Break', /Working · 0:00:0/.test(await clock.innerText()) && await strip.isVisible() && /Location recce/.test(await strip.innerText()) && (await strip.getByRole('button', { name: 'Break' }).count()) === 1 && (await clock.getByRole('button', { name: 'Stop work' }).count()) === 1, await strip.innerText());
  await page.evaluate(() => window.logiGo('crew')); await sleep(400);
  ok('the strip follows to every page', await strip.isVisible() && (await page.locator('#clockbar').evaluate(e => !e.hidden)));
  await strip.getByRole('button', { name: 'Break' }).click(); await page.waitForSelector('.sheet .break-grid');
  await page.locator('.sheet .break-grid .btn').first().click(); await sleep(400);
  ok('a break taken from the strip shows there with the countdown', /Break · /.test(await strip.innerText()) && (await strip.getByRole('button', { name: 'Back to work' }).count()) === 1, await strip.innerText());
  await strip.getByRole('button', { name: 'Back to work' }).click(); await sleep(300);
  await strip.getByRole('button', { name: 'Stop work' }).click(); await sleep(400);
  ok('Stop work from the strip ends the day and the strip goes', await page.locator('#clockbar').evaluate(e => e.hidden) && (await page.evaluate(() => import('./js/hours.js').then(hh => !hh.running()))));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  ok('back on the booking the card shows the time logged today and Start work again', /logged today/.test(await page.locator('#bk-hours .card-clock').innerText()) && (await page.locator('#bk-hours .card-clock').getByRole('button', { name: 'Start work' }).count()) === 1, await page.locator('#bk-hours .card-clock').innerText());
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

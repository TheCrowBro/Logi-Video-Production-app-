// A crew member's rate is an amount per day or per hour, chosen in the form and shown on the card; quotes and budgets
// price it (an hourly rate for a standard day's hours per shoot day); a card from an older copy that holds a typed rate
// still works and is converted when edited; someone hired for a job gets the same choice.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
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
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const store = fn => page.evaluate(fn);
  const card = name => page.locator('.crew-card', { hasText: name });

  // ---- the Crew page ----
  await page.evaluate(() => window.logiGo('crew')); await sleep(400);
  const cards = await page.locator('.crew-card .muted').allInnerTexts();
  ok('the sample crew show their rate per day or per hour', cards.includes('Sound Recordist · $450/day') && cards.includes('Editor · $55/hour'), cards.join(' | '));
  await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForSelector('.sheet form');
  const per = page.locator('.sheet form select');
  ok('the form has a Rate box and a Per choice of Day or Hour', (await page.locator('.sheet form input[data-key="rate"]').getAttribute('type')) === 'number' && (await per.count()) === 1 && (await per.locator('option').allInnerTexts()).join('|') === 'Day|Hour' && (await per.inputValue()) === 'day' && (await page.locator('.sheet form label', { hasText: 'Per' }).count()) === 1);
  await page.locator('.sheet form input[data-key="name"]').fill('Lee Hour'); await page.locator('.sheet form input[data-key="role"]').fill('Colourist');
  await page.locator('.sheet form input[data-key="rate"]').fill('62.5'); await per.selectOption('hour');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const lee = await store(() => import('./js/store.js').then(s => s.db.crew.find(c => c.name === 'Lee Hour')));
  ok('an hourly rate is saved as a number per hour', lee && lee.rate === 62.5 && lee.rateUnit === 'hour', JSON.stringify(lee && { rate: lee.rate, unit: lee.rateUnit }));
  ok('…and the card says so', /Colourist · \$62\.50\/hour/.test(await card('Lee Hour').innerText()), await card('Lee Hour').locator('.muted').first().innerText());
  await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="name"]').fill('Dee Day'); await page.locator('.sheet form input[data-key="role"]').fill('Grip'); await page.locator('.sheet form input[data-key="rate"]').fill('380');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const dee = await store(() => import('./js/store.js').then(s => s.db.crew.find(c => c.name === 'Dee Day')));
  ok('a day rate is the default, saved as a number per day', dee && dee.rate === 380 && dee.rateUnit === 'day' && /Grip · \$380\/day/.test(await card('Dee Day').innerText()));
  // cards from an older copy hold the rate as it was typed
  await store(() => import('./js/store.js').then(s => { s.upsert('crew', { id: 'old-1', name: 'Old Hand', role: 'Boom Operator', rate: '£55 an hour', phone: '', email: '', link: '', notes: '' }); s.upsert('crew', { id: 'old-2', name: 'Old Note', role: 'Runner', rate: 'TBC', phone: '', email: '', link: '', notes: '' }); })); await sleep(400);
  ok('an older typed rate shows as it was typed', /Boom Operator · £55 an hour/.test(await card('Old Hand').innerText()) && /Runner · TBC/.test(await card('Old Note').innerText()));
  await card('Old Hand').locator('button[aria-label="Edit Old Hand"]').click(); await page.waitForSelector('.sheet form');
  ok('editing it shows the amount it reads and the unit', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '55' && (await page.locator('.sheet form select').inputValue()) === 'hour');
  await page.locator('.sheet form input[data-key="rate"]').fill('60'); await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const old = await store(() => import('./js/store.js').then(s => s.byId('crew', 'old-1')));
  ok('saving converts it to a number and a unit', old.rate === 60 && old.rateUnit === 'hour' && /Boom Operator · \$60\/hour/.test(await card('Old Hand').innerText()));
  await card('Old Note').locator('button[aria-label="Edit Old Note"]').click(); await page.waitForSelector('.sheet form');
  ok('a rate that reads as no amount opens with the box empty, per day', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '' && (await page.locator('.sheet form select').inputValue()) === 'day');
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- quotes and budgets price the rate per day, or per hour for a standard day's hours ----
  ok('the standard day is 10 hours unless changed', (await store(() => import('./js/hours.js').then(hh => hh.standardDay()))) === 10);
  const seed = await store(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => /Harbour/.test(x.title)), sam = s.db.crew.find(c => c.name === 'Sam Rivera'), lee = s.db.crew.find(c => c.name === 'Lee Hour'); s.update(d => { const x = d.bookings.find(y => y.id === b.id); delete x.endDate; x.crew = [sam.id, lee.id]; x.hires = []; x.budget = { lines: [], skip: [] }; }); return b.id; }));
  const quote = id => page.evaluate(id => import('./js/money.js').then(m => import('./js/store.js').then(s => m.suggestLines(s.byId('bookings', id), 'quote', 'booking').filter(l => /^Crew:/.test(l.desc)).map(l => [l.desc, l.qty, l.unit, l.price]))), id);
  let lines = await quote(seed);
  ok('the quote suggests a day line for a day rate and an hours line for an hourly rate', JSON.stringify(lines) === JSON.stringify([['Crew: Sam Rivera (Sound Recordist)', 1, 'day', 450], ['Crew: Lee Hour (Colourist)', 10, 'hour', 62.5]]), JSON.stringify(lines));
  await page.evaluate(() => { localStorage.setItem('logi-stdday', '8'); });
  lines = await quote(seed);
  ok('the hours follow the standard day from Hours & breaks', (await store(() => import('./js/hours.js').then(hh => hh.standardDay()))) === 8 && lines[1][1] === 8, JSON.stringify(lines));
  const budget = await page.evaluate(id => import('./js/money.js').then(m => import('./js/store.js').then(s => { m.fillBudget(s.byId('bookings', id)); return s.byId('bookings', id).budget.lines.filter(l => l.cat === 'Crew').map(l => [l.desc, l.qty, l.unit, l.rate]); })), seed);
  ok('Fill from booking prices the budget the same way, flagging the hours to check', JSON.stringify(budget) === JSON.stringify([['Sam Rivera (Sound Recordist)', 1, 'day', 450], ['Lee Hour (Colourist) — check the hours', 8, 'hour', 62.5]]), JSON.stringify(budget));

  // ---- someone hired for the job gets the same choice ----
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), seed); await page.waitForSelector('.bk-detail'); await sleep(300);
  await page.locator('#bk-hires button', { hasText: 'Hire someone' }).click(); await page.waitForSelector('.sheet form');
  ok('the hire form has the same Rate box and Per choice', (await page.locator('.sheet form input[data-key="rate"]').getAttribute('type')) === 'number' && (await page.locator('.sheet form select option').allInnerTexts()).join('|') === 'Day|Hour');
  await page.locator('.sheet form input[data-key="name"]').fill('Pat Hire'); await page.locator('.sheet form input[data-key="role"]').fill('Drone Pilot'); await page.locator('.sheet form input[data-key="rate"]').fill('70'); await page.locator('.sheet form select').selectOption('hour'); await page.locator('.sheet form input[data-key="days"]').fill('2');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(500);
  const pat = await store(() => import('./js/store.js').then(s => (s.db.bookings.find(x => /Harbour/.test(x.title)).hires || [])[0]));
  ok('the hired person is saved with a number per hour and shown with it', pat && pat.rate === 70 && pat.rateUnit === 'hour' && /Drone Pilot · \$70\/hour · 2 days/.test(await page.locator('#bk-hires').innerText()), await page.locator('#bk-hires .crew-line .muted').first().innerText());
  lines = await quote(seed);
  ok('the quote bills the hired person for 2 days of 8 hours at the hourly rate', lines.some(l => l[0] === 'Crew: Pat Hire (Drone Pilot)' && l[1] === 16 && l[2] === 'hour' && l[3] === 70), JSON.stringify(lines));
  // an older hire with a typed rate still prices, and converts when edited
  await store(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => /Harbour/.test(y.title)); x.hires.push({ id: 'hire-old', name: 'Robin Old', role: 'Gaffer', rate: '$400/day', days: 1, phone: '', email: '', notes: '' }); }))); await sleep(400);
  lines = await quote(seed);
  ok('an older hire with a typed rate is still priced per day', lines.some(l => l[0] === 'Crew: Robin Old (Gaffer)' && l[1] === 1 && l[2] === 'day' && l[3] === 400) && /Gaffer · \$400\/day · 1 day/.test(await page.locator('#bk-hires').innerText()));
  await page.locator('#bk-hires .crew-line', { hasText: 'Robin Old' }).locator('button', { hasText: 'Edit' }).click(); await page.waitForSelector('.sheet form');
  ok('its form shows 400 per day', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '400' && (await page.locator('.sheet form select').inputValue()) === 'day');
  await page.keyboard.press('Escape'); await sleep(200);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

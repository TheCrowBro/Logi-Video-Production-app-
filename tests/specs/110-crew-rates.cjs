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
  ok('a rate that reads as no amount opens with the box empty, per day, and says what was typed', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '' && (await page.locator('.sheet form select').inputValue()) === 'day' && /Typed before: “TBC”/.test(await page.locator('.sheet form').innerText()));
  await page.locator('.sheet form textarea[data-key="notes"]').fill('Owes me a coffee'); await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const note = await store(() => import('./js/store.js').then(s => s.byId('crew', 'old-2')));
  ok('editing another field keeps the typed rate as it was', note.rate === 'TBC' && note.rateUnit === undefined && note.notes === 'Owes me a coffee' && /Runner · TBC/.test(await card('Old Note').innerText()), JSON.stringify({ rate: note.rate, unit: note.rateUnit }));
  await card('Old Note').locator('button[aria-label="Edit Old Note"]').click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="rate"]').fill('200'); await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  ok('an amount replaces it', (await store(() => import('./js/store.js').then(s => { const c = s.byId('crew', 'old-2'); return c.rate === 200 && c.rateUnit === 'day'; }))) && /Runner · \$200\/day/.test(await card('Old Note').innerText()));
  // a typed rate that says more than an amount and a unit keeps the rest in the notes when it is converted
  await store(() => import('./js/store.js').then(s => s.upsert('crew', { id: 'old-4', name: 'Old Overtime', role: 'Gaffer', rate: '$500/day, OT $60/hr', phone: '', email: '', link: '', notes: 'Own van' }))); await sleep(400);
  await card('Old Overtime').locator('button[aria-label="Edit Old Overtime"]').click(); await page.waitForSelector('.sheet form');
  ok('its form reads 500 per day and says what was typed', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '500' && (await page.locator('.sheet form select').inputValue()) === 'day' && /Typed before: “\$500\/day, OT \$60\/hr”/.test(await page.locator('.sheet form').innerText()));
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const ot = await store(() => import('./js/store.js').then(s => s.byId('crew', 'old-4')));
  ok('saving keeps the overtime note in the notes', ot.rate === 500 && ot.rateUnit === 'day' && ot.notes === 'Own van\nRate as typed: $500/day, OT $60/hr', JSON.stringify({ rate: ot.rate, unit: ot.rateUnit, notes: ot.notes }));
  await card('Old Overtime').locator('button[aria-label="Edit Old Overtime"]').click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  ok('…once', (await store(() => import('./js/store.js').then(s => s.byId('crew', 'old-4').notes))) === 'Own van\nRate as typed: $500/day, OT $60/hr');
  // a unit left behind by an older copy never beats the unit written in a typed rate
  await store(() => import('./js/store.js').then(s => s.upsert('crew', { id: 'old-3', name: 'Old Mix', role: 'Grip', rate: '55/hr', rateUnit: 'day', phone: '', email: '', link: '', notes: '' }))); await sleep(400);
  await card('Old Mix').locator('button[aria-label="Edit Old Mix"]').click(); await page.waitForSelector('.sheet form');
  ok('the unit read from a typed rate wins over a stale stored one', (await page.locator('.sheet form input[data-key="rate"]').inputValue()) === '55' && (await page.locator('.sheet form select').inputValue()) === 'hour');
  await page.keyboard.press('Escape'); await sleep(200);
  // the cards use the profile's currency symbol
  await store(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, currency: '€', updatedAt: Date.now() }; }))); await sleep(400);
  ok('the cards use the currency symbol from the profile', /Grip · €380\/day/.test(await card('Dee Day').innerText()) && /Colourist · €62\.50\/hour/.test(await card('Lee Hour').innerText()));
  await store(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, currency: '$', updatedAt: Date.now() }; }))); await sleep(300);

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
  await page.locator('.sheet form button[type=submit]').click(); await sleep(500);
  const robin = await store(() => import('./js/store.js').then(s => (s.db.bookings.find(x => /Harbour/.test(x.title)).hires || []).find(x => x.name === 'Robin Old')));
  ok('saving converts the hire to a number and a unit', robin && robin.rate === 400 && robin.rateUnit === 'day' && /Gaffer · \$400\/day · 1 day/.test(await page.locator('#bk-hires').innerText()), JSON.stringify(robin && { rate: robin.rate, unit: robin.rateUnit }));
  // a hired person with an hourly unit and no amount yet still gets an hours line, left for the price
  await store(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => /Harbour/.test(y.title)); x.hires.push({ id: 'hire-blank', name: 'Blank Hour', role: 'Runner', rate: '', rateUnit: 'hour', days: 1, phone: '', email: '', notes: '' }); }))); await sleep(300);
  lines = await quote(seed);
  ok('an hourly person with no amount yet gets an hours line with the price left blank', lines.some(l => l[0] === 'Crew: Blank Hour (Runner)' && l[1] === 8 && l[2] === 'hour' && l[3] === ''), JSON.stringify(lines));
  // the standard day is kept between 1 and 24 hours whatever was typed
  await page.evaluate(() => { localStorage.setItem('logi-stdday', '-5'); });
  ok('a nonsense standard day falls back to 10 hours', (await store(() => import('./js/hours.js').then(hh => hh.standardDay()))) === 10);
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

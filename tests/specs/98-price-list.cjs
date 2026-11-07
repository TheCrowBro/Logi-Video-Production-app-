// The price list: typical rates for five regions (every line, in order low ≤ typical ≤ high, and in sensible
// proportion), the list picked from the currency, the editor in Settings, and the picker on a quote and an invoice.
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: 'block' });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));

  // ---- the researched rates ----
  const data = await page.evaluate(() => Promise.all([import('./js/price-rates.js'), import('./js/price-list.js')]).then(([r, p]) => ({ RATES: r.RATES, keys: p.ITEMS.map(i => i[0]), regions: p.REGIONS })));
  const bad = [];
  for (const [k, , code] of data.regions) {
    const R = data.RATES[k];
    if (!R || R.code !== code) { bad.push(`${k}: missing or not in ${code}`); continue; }
    for (const key of data.keys) { const x = R.items[key]; if (!x || x.length !== 3 || !x.every(n => Number.isFinite(n) && n > 0) || !(x[0] <= x[1] && x[1] <= x[2])) bad.push(`${k}.${key} ${JSON.stringify(x)}`); }
    const extra = Object.keys(R.items).filter(key => !data.keys.includes(key)); if (extra.length) bad.push(`${k}: unknown ${extra}`);
  }
  ok('every region has a low, typical and high rate for every line, in order', !bad.length, bad.slice(0, 6).join('; '));
  const odd = [];
  for (const [k] of data.regions) {
    const t = key => data.RATES[k] && data.RATES[k].items[key] ? data.RATES[k].items[key][1] : NaN;
    const half = t('shoot_half') / t('shoot_day'), editDay = t('edit_day') / t('edit_hour');
    if (!(half >= 0.45 && half <= 0.8)) odd.push(`${k} half day ${Math.round(half * 100)}% of a day`);
    if (!(editDay >= 5 && editDay <= 10)) odd.push(`${k} editing day ${editDay.toFixed(1)}× an hour`);
    if (!(t('second_camera') <= t('shoot_day') * 1.1)) odd.push(`${k} second camera above the main day`);
    if (!(t('wedding') >= t('shoot_day'))) odd.push(`${k} wedding below a filming day`);
  }
  ok('the typical rates hang together (half day, editing day, second camera, wedding)', !odd.length, odd.join('; '));

  // ---- which list: from the currency ----
  const pick = sym => page.evaluate(sym => import('./js/store.js').then(async s => {
    s.update(d => { d.profile = { ...d.profile, currency: sym, updatedAt: Date.now() }; d.billing = { ...d.billing, currencyCode: '', dayRate: '', hourRate: '', updatedAt: Date.now() }; d.priceList = { list: null, region: '', updatedAt: Date.now() }; });
    const p = await import('./js/price-list.js'), r = await import('./js/price-rates.js'), x = p.priceList();
    return { region: x.region, own: x.own, day: x.list.find(i => i.key === 'shoot_day').price, mile: x.list.find(i => i.key === 'mileage').unit, want: r.RATES[x.region] ? r.RATES[x.region].items.shoot_day[1] : '' };
  }), sym);
  const us = await pick('$'), uk = await pick('£'), eu = await pick('€'), au = await pick('A$'), ca = await pick('C$'), inr = await pick('₹'), won = await pick('₩'), typed = await pick('GBP');
  ok('the list starts from the rates where the currency is used', us.region === 'us' && uk.region === 'uk' && eu.region === 'eu' && au.region === 'au' && ca.region === 'ca' && !us.own, [us, uk, eu, au, ca].map(x => x.region).join(','));
  ok('a filming day starts at the typical rate for the region', [us, uk, eu, au, ca].every(x => x.day === x.want && x.day > 0), [us, uk, eu, au, ca].map(x => x.day).join(','));
  ok('mileage is per mile in the US and UK, per km elsewhere', us.mile === 'mile' && uk.mile === 'mile' && eu.mile === 'km' && au.mile === 'km');
  ok('a currency with no research gives the lines with no prices', inr.region === '' && inr.day === '');
  ok('an unfamiliar currency symbol gets no prices, never US dollar rates', won.region === '' && won.day === '');
  ok('a currency typed as its code is understood', typed.region === 'uk' && typed.day === uk.day);
  const own = await page.evaluate(() => import('./js/store.js').then(async s => { s.update(d => { d.profile = { ...d.profile, currency: '£', updatedAt: Date.now() }; d.billing = { ...d.billing, dayRate: 300, hourRate: 48, updatedAt: Date.now() }; }); const p = await import('./js/price-list.js'), l = p.priceList().list, ca = p.startList('ca'), r = (await import('./js/price-rates.js')).RATES; const v = k => l.find(i => i.key === k).price; return { day: v('shoot_day'), half: v('shoot_half'), hour: v('edit_hour'), eday: v('edit_day'), caDay: ca.find(i => i.key === 'shoot_day').price, caWant: r.ca.items.shoot_day[1] }; }));
  ok('your own day rate and editing hour rate win over the typical ones', own.day === 300 && own.hour === 48, JSON.stringify(own));
  ok('the half day and the editing day follow your own rates, so a half day never costs more than a day', own.half < own.day && own.half >= 150 && own.eday >= 48 * 6 && own.eday <= 48 * 10, JSON.stringify(own));
  ok('your own rates are not mixed into another region\'s currency', own.caDay === own.caWant);

  // ---- the editor in Settings ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(300);
  await openSetting(page, 'Quotes & invoices'); await sleep(200);
  await page.getByRole('button', { name: /Edit the price list/ }).click(); await page.waitForSelector('.sheet .price-list');
  const ed = page.locator('.sheet').last();
  ok('the editor groups the lines in pull-downs, the first one open', (await ed.locator('details.budget-cat').count()) >= 7 && (await ed.locator('details.budget-cat[open]').count()) === 1);
  ok('the editor says the rates are a starting point, not advice', /starting point, not advice/.test(await ed.innerText()));
  ok('the editor prints no stray words', !/false|undefined|null/.test(await ed.innerText()));
  await ed.locator('.price-item', { hasText: 'Second camera operator' }).click(); await page.waitForSelector('.sheet form');
  const form = page.locator('.sheet').last();
  ok('editing a line shows the typical range for the region', /Typical in the United Kingdom: £\d+ \(usually £\d+ to £\d+\)/.test(await form.innerText()));
  await form.locator('input[type=number]').first().fill('333'); await form.locator('button[type=submit]').click(); await sleep(300);
  let bl = await page.evaluate(() => import('./js/store.js').then(s => s.db.priceList));
  ok('a changed price makes the list your own and keeps it', Array.isArray(bl.list) && bl.region === 'uk' && bl.list.find(i => i.key === 'second_camera').price === 333 && bl.list.length === data.keys.length);
  ok('focus comes back to the line just edited', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('price-item') && /Second camera/.test(document.activeElement.textContent)));
  ok('the editor redraws with the new price', /£333/.test(await page.locator('.sheet .price-list').innerText()));
  await page.locator('.sheet .price-list').getByRole('button', { name: '+ Add a line' }).click(); await page.waitForSelector('.sheet form');
  const add = page.locator('.sheet').last();
  await add.locator('input').first().fill('Same-day edit for socials'); await add.locator('input[type=number]').fill('275'); await add.locator('button[type=submit]').click(); await sleep(300);
  await page.locator('.sheet .price-list select[aria-label="Typical rates from"]').selectOption('ca');
  await page.locator('.sheet .price-list').getByRole('button', { name: /Start again from these rates/ }).click(); await sleep(300);
  bl = await page.evaluate(() => import('./js/store.js').then(s => s.db.priceList));
  const caRates = await page.evaluate(() => import('./js/price-rates.js').then(r => r.RATES.ca.items.second_camera[1]));
  ok('starting again from another region replaces the standard lines and keeps your own', bl.region === 'ca' && bl.list.find(i => i.key === 'second_camera').price === caRates && bl.list.some(i => i.desc === 'Same-day edit for socials' && i.price === 275));
  ok('rates in another currency carry a warning', (await page.locator('.sheet .price-list .warn').count()) === 1 && /CAD/.test(await page.locator('.sheet .price-list .warn').innerText()));
  await page.locator('.sheet .price-list .warn button').click(); await sleep(300);
  ok('the warning goes once you say the prices are in your currency', (await page.locator('.sheet .price-list .warn').count()) === 0);
  // Escape in a form opened over the list closes the form only
  await page.locator('.sheet .price-list .price-item').first().click(); await page.waitForSelector('.sheet form'); await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape in a form over the price list closes only the form', (await page.locator('.sheet form').count()) === 0 && (await page.locator('.sheet .price-list').count()) === 1);
  // the list is its own record: a newer change to the other billing settings elsewhere does not undo it
  const merged = await page.evaluate(() => import('./js/store.js').then(s => { const local = JSON.parse(s.serialize()), remote = JSON.parse(s.serialize()); remote.billing = { ...remote.billing, taxRate: 7, updatedAt: Date.now() + 5000 }; remote.priceList = { list: null, region: '', updatedAt: 1 }; const out = s.mergeDb(local, remote); return { tax: out.billing.taxRate, kept: Array.isArray(out.priceList.list) && out.priceList.list.length }; }));
  ok('a billing change on another device keeps the price list', merged.tax === 7 && merged.kept > 30, JSON.stringify(merged));
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.billing = { ...d.billing, dayRate: 600, updatedAt: Date.now() }; d.priceList = { list: null, region: '', updatedAt: Date.now() }; d.profile = { ...d.profile, currency: '$', updatedAt: Date.now() }; })));

  // ---- the picker on a quote ----
  // A two-day booking with no quote or invoice yet.
  const id = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => /Harbour/.test(x.title)) || s.db.bookings[0]; s.update(d => { const x = d.bookings.find(y => y.id === b.id), [y, m, dd] = x.date.split('-').map(Number), n = new Date(y, m - 1, dd + 1); delete x.quote; delete x.invoice; x.endDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; x.updatedAt = Date.now(); }); return b.id; }));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  const open = () => page.evaluate(id => import('./js/store.js').then(s => { const t = s.byId('bookings', id).title, c = [...document.querySelectorAll('.card.tap')].find(x => x.textContent.includes(t)); if (c) c.click(); return !!c; }), id);
  if (!(await open())) { await page.getByRole('button', { name: 'Calendar' }).click(); await sleep(300); await open(); }
  await page.waitForSelector('.bk-detail');
  await page.locator('#bk-work').evaluate(d => { d.open = true; }); await sleep(150);
  await page.locator('.bk-detail .block:has(h3:has-text("Money")) button', { hasText: 'Create' }).first().click(); await page.waitForSelector('.money-page');
  await page.locator('.money-page button', { hasText: 'From the price list' }).click(); await page.waitForSelector('.sheet .price-pick');
  const pk = page.locator('.sheet').last();
  ok('the picker opens with every line, grouped', (await pk.locator('.price-pick').count()) === data.keys.length && (await pk.locator('.price-group h4').count()) >= 7);
  const squeezed = await pk.locator('.price-pick-text').evaluateAll(els => els.filter(e => e.getClientRects().length && (e.getBoundingClientRect().width < 120 || e.getBoundingClientRect().height > 120)).length);
  ok('picker rows are readable on a 360 px phone', squeezed === 0, `${squeezed} squeezed`);
  await pk.locator('input[type=search]').fill('drone'); await sleep(100);
  const seen = await pk.locator('.price-pick:visible').count();
  ok('search narrows the list', seen === 1, `${seen} shown`);
  await pk.locator('.price-pick:visible input').check();
  await pk.locator('input[type=search]').press('Escape'); await sleep(150);
  ok('Escape in the search clears it and keeps the picker open with the tick', (await page.locator('.sheet .price-pick').count()) === data.keys.length && (await pk.locator('input[type=search]').inputValue()) === '' && (await pk.locator('.price-pick input:checked').count()) === 1);
  await pk.locator('.price-pick', { hasText: 'Colour grading' }).locator('input').check();
  await pk.locator('.price-pick', { hasText: 'Mileage' }).locator('input').check();
  await pk.locator('.price-pick', { hasText: 'Filming by the hour' }).locator('input').check();
  ok('the add button counts the ticked lines', /Add 4 lines/.test(await pk.locator('.form-actions .btn.primary').innerText()));
  await pk.locator('.form-actions .btn.primary').click(); await page.waitForSelector('.sheet form');
  const qf = page.locator('.sheet').last();
  const lines = await qf.locator('.field:has(label:has-text("Lines")) .row-edit').evaluateAll(rs => rs.map(r => [...r.querySelectorAll('input')].map(i => i.value)));
  const usDrone = data.RATES.us.items.drone[1], usGrade = data.RATES.us.items.grade[1];
  const usMile = data.RATES.us.items.mileage[1], usHour = data.RATES.us.items.shoot_hour[1];
  const L = d => lines.find(l => d.test(l[0])) || [];
  ok('with no quote yet, the picked lines start a new one: day lines for each shoot day', lines.length === 4 && L(/Drone/)[1] === '2' && L(/Drone/)[2] === 'day' && L(/Drone/)[3] === String(usDrone) && L(/Colour grading/)[1] === '1' && L(/Colour grading/)[3] === String(usGrade), JSON.stringify(lines));
  ok('the hourly filming line starts at its 2-hour minimum', L(/Filming by the hour/)[1] === '2' && L(/Filming by the hour/)[3] === String(usHour));
  ok('a price with cents (mileage) is accepted by the editor', L(/Mileage/)[3] === String(usMile) && await qf.locator('.row-edit input[type=number]').evaluateAll(xs => xs.every(x => x.checkValidity())));
  await qf.locator('button[type=submit]').click(); await sleep(400);
  await page.locator('.money-page button', { hasText: 'From the price list' }).click(); await page.waitForSelector('.sheet .price-pick');
  await page.locator('.sheet').last().locator('.price-pick', { hasText: 'Rush delivery' }).locator('input').check();
  await page.locator('.sheet').last().locator('.form-actions .btn.primary').click(); await sleep(400);
  const q = await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).quote), id);
  ok('the quote saved with all four lines, mileage with its cents', q.lines.length === 5 && q.lines.some(l => /Mileage/.test(l.desc) && Number(l.price) === usMile));
  ok('on a quote that exists, picked lines are added to the end', /Rush delivery/.test(q.lines[4].desc) && q.lines[4].qty === 1);
  ok('the document shows the new line', /Rush delivery/.test(await page.locator('.money-doc').innerText()));
  ok('no errors', !errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
})();

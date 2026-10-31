const { chromium } = require('playwright');
const fs = require('fs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-loc', JSON.stringify({ lat: 51.5, lon: -0.12 })); });
  // Forecast API mocked: a fixed sunny-then-showery day
  await ctx.route('https://api.open-meteo.com/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily_units: { temperature_2m_max: '°C' }, daily: { time: ['2026-11-01'], weather_code: [80], temperature_2m_max: [14.2], temperature_2m_min: [8.6], precipitation_probability_max: [60], wind_speed_10m_max: [24.1], wind_gusts_10m_max: [45.3] } }) }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const harbour = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.find(b => /Harbour/.test(b.title))));

  // ---- weather on the booking page and the call sheet ----
  await page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const b = d.bookings.find(x => x.id === id); b.date = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); b.endDate && delete b.endDate; })), harbour.id);
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.evaluate(id => { window.__id = id; }, harbour.id);
  await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', window.__id); document.querySelectorAll('.card.tap').forEach(c => { if (c.textContent.includes(b.title)) c.click(); }); }));
  await page.waitForSelector('.bk-detail');
  await page.waitForFunction(() => /chance of rain/.test(document.querySelector('.bk-detail .wxline')?.textContent || ''), null, { timeout: 10000 }).then(() => ok('forecast line on the booking page', true, (document => '')(null))).catch(() => ok('forecast line on the booking page', false));
  const wx = await page.locator('.bk-detail .wxline').innerText();
  ok('forecast summary reads well', /Showers, 9–14°C, 60% chance of rain, wind to 24 km\/h \(gusts 45\)/.test(wx), wx);
  await page.getByRole('button', { name: /Call sheet/ }).first().click(); await page.waitForSelector('.cs-page');
  await page.waitForSelector('.cs-page .wxline button');
  await page.locator('.cs-page .wxline button').click(); await sleep(300);
  const cs = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).callSheet));
  ok('Add to call sheet writes the forecast into the sheet', /Showers/.test(cs.weather) && cs.editedAt > 0);
  ok('the sheet prints the forecast', /Showers/.test(await page.locator('.cs-doc').evaluate(el => el.textContent)));

  // ---- quotes and invoices ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(300);
  await page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices")) > summary').click();
  const sec = page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices"))');
  for (const [label, val] of [['Day rate', '600'], ['Hour rate for editing', '55'], ['Equipment package per day', '250'], ['Tax rate (%)', '20'], ['Tax name', 'VAT']]) { await sec.locator(`input[aria-label^="${label}"]`).fill(val); await sec.locator(`input[aria-label^="${label}"]`).press('Tab'); await sleep(150); }
  await sec.locator('textarea[aria-label^="How to pay"]').fill('Bank: 12-34-56 · 12345678'); await sec.locator('textarea[aria-label^="How to pay"]').press('Tab'); await sleep(150);
  const bl = await page.evaluate(() => import('./js/store.js').then(s => s.db.billing));
  ok('billing settings saved', bl.dayRate === 600 && bl.hourRate === 55 && bl.kitRate === 250 && bl.taxRate === 20 && /Bank/.test(bl.payment), JSON.stringify(bl));
  // crew day rate + stakeholder email
  await page.evaluate(() => import('./js/store.js').then(s => { const c = s.db.crew[0]; s.upsert('crew', { ...c, rate: 350 }); const b = s.byId('bookings', window.__id); s.upsert('bookings', { ...b, crew: [c.id], stakeholders: [{ name: 'Priya Nair', role: 'Marketing lead', phone: '', email: 'priya@example.com' }] }); }));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(200); // back from the call sheet page
  await page.locator('.bk-detail .page-head button').first().click(); await sleep(200); await page.getByRole('button', { name: 'Calendar' }).click(); await sleep(300);
  await page.evaluate(() => { document.querySelectorAll('.card.tap').forEach(c => { if (c.textContent.includes('Harbour')) c.click(); }); }); await page.waitForSelector('.bk-detail');
  ok('booking page has a Money block', (await page.locator('.bk-detail h3', { hasText: 'Money' }).count()) === 1);
  await page.locator('.bk-detail .block:has(h3:has-text("Money")) button', { hasText: 'Create' }).first().click(); await page.waitForSelector('.money-page');
  await page.getByRole('button', { name: 'From the booking' }).click(); await page.waitForSelector('.sheet form');
  const f = page.locator('.sheet').last();
  const rows = await f.locator('.field:has(label:has-text("Lines")) .row-edit').count();
  const firstPrice = await f.locator('.field:has(label:has-text("Lines")) .row-edit').first().locator('input').nth(3).inputValue();
  const crewPrice = await f.locator('.field:has(label:has-text("Lines")) .row-edit').nth(1).locator('input').nth(3).inputValue();
  ok('suggested quote lines: shoot day at the day rate, crew at their rate, kit, deliverables', rows >= 3 && firstPrice === '600' && crewPrice === '350', `${rows} lines, prices ${firstPrice}/${crewPrice}`);
  await f.locator('button[type=submit]').click(); await sleep(400);
  const q = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).quote));
  ok('quote saved with a number and tax', /^Q-0001$/.test(q.number) && q.taxRate === 20 && q.status === 'Draft', JSON.stringify({ n: q.number, lines: q.lines.length }));
  const docText = await page.locator('.money-doc').evaluate(el => el.textContent);
  ok('document shows parties, lines, VAT and total', /QUOTE/.test(docText) && /Priya Nair/.test(docText) && /VAT 20%/.test(docText) && /Total/.test(docText));
  await page.getByRole('button', { name: 'Mark as sent' }).click(); await sleep(300);
  const checks = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).checks));
  ok('marking the quote sent ticks the Quoted checklist item', !!checks['quoted:quote-estimate-sent']);
  await page.getByRole('button', { name: 'Accepted' }).click(); await sleep(300);
  ok('quote accepted', (await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).quote.status))) === 'Accepted');
  const mail = await page.locator('.money-page a', { hasText: 'Email client' }).getAttribute('href');
  ok('Email client goes to the stakeholder address', /^mailto:priya@example\.com\?subject=Quote/.test(mail));
  // invoice from the quote, then paid; overdue detection; overview and CSV
  await page.locator('.money-page .seg button', { hasText: 'Invoice' }).click(); await page.waitForSelector('.money-page');
  await page.getByRole('button', { name: 'From the quote' }).click(); await page.waitForSelector('.sheet form');
  const f2 = page.locator('.sheet').last();
  await f2.locator('input[data-key="due"]').fill('2026-01-01');
  await f2.locator('input[data-key="deposit"]').fill('500');
  await f2.locator('button[type=submit]').click(); await sleep(400);
  await page.getByRole('button', { name: 'Mark as sent' }).click(); await sleep(300);
  const inv = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', window.__id); return { number: b.invoice.number, status: b.invoice.status, lines: b.invoice.lines.length, overdue: !!(b.invoice.due < new Date().toISOString().slice(0, 10)) }; }));
  ok('invoice copied the quote lines, numbered INV-0001, sent, and is overdue', inv.number === 'INV-0001' && inv.status === 'Sent' && inv.lines === q.lines.length && inv.overdue);
  ok('status line shows overdue and the balance after the deposit', /overdue/.test(await page.locator('.money-page .status-line').innerText()) && /balance/.test(await page.locator('.money-page .status-line').innerText()));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save PDF' }).click()]);
  const pdf = fs.readFileSync(await dl.path()).toString('latin1');
  ok('invoice PDF is well formed and carries the total and payment details', /^%PDF-1\.4/.test(pdf) && /INV-0001/.test(pdf) && /Bank: 12-34-56/.test(pdf), dl.suggestedFilename());
  await page.getByRole('button', { name: 'Paid' }).click(); await sleep(300);
  const after = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', window.__id); return { status: b.invoice.status, paid: !!b.checks['delivered:paid'], sent: !!b.checks['delivered:final-invoice-sent'] }; }));
  ok('marking paid ticks the Delivered checklist items', after.status === 'Paid' && after.paid && after.sent);
  // hours-based invoice lines on a past booking with shifts
  const hoursLines = await page.evaluate(() => import('./js/store.js').then(async s => { const m = await import('./js/money.js'); const b = s.db.bookings.find(x => s.db.shifts.some(sh => sh.bookingId === x.id && sh.end)); return b ? m.suggestLines(b, 'invoice', 'hours') : null; }));
  ok('invoice lines can be built from the hours logged', Array.isArray(hoursLines) && hoursLines.length >= 1 && hoursLines[0].price === 600, JSON.stringify(hoursLines && hoursLines.map(l => [l.desc, l.qty, l.price])));
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(200);
  await page.locator('.bk-detail .page-head button').first().click(); await sleep(200); await page.getByRole('button', { name: 'Calendar' }).click(); await sleep(300);
  await page.getByRole('button', { name: 'Money' }).click(); await page.waitForSelector('.sheet .stats');
  const stats = await page.locator('.sheet .stats').innerText();
  ok('Money overview sums paid this year', /paid in 2026/.test(stats) && !/NaN/.test(stats), stats.replace(/\n/g, ' | '));
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Invoices \(CSV\)/ }).click()]);
  ok('invoice CSV export', /INV-0001/.test(fs.readFileSync(await csv.path(), 'utf8')));
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- equipment service log ----
  await page.evaluate(() => window.logiGo('gear')); await sleep(300);
  await page.evaluate(() => import('./js/store.js').then(s => { const g = s.db.gear[0]; const past = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10); const soon = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10); s.upsert('gear', { ...g, serviceEvery: 12, purchased: past, warranty: soon, firmware: '2.01' }); window.__g = g.id; }));
  await sleep(300);
  const alerts = await page.locator('.page-card .warn', { hasText: 'Due:' }).innerText();
  ok('Equipment page warns about an overdue service and a warranty ending', /overdue/i.test(alerts) && /warranty ends/i.test(alerts), alerts.slice(0, 90));
  const gName = await page.evaluate(() => import('./js/store.js').then(s => s.byId('gear', window.__g).name));
  await page.locator(`button[aria-label="Service log for ${gName}"]`).click(); await page.waitForSelector('.sheet');
  await page.getByRole('button', { name: '+ Log an entry' }).click(); await page.waitForSelector('.sheet form');
  const lf = page.locator('.sheet').last();
  await lf.locator('.field:has(label:has-text("What")) select').selectOption('clean');
  await lf.locator('textarea[data-key="note"]').fill('Sensor clean at the shop');
  await lf.locator('input[data-key="cost"]').fill('45');
  await lf.locator('input[data-key="firmware"]').fill('2.10');
  await lf.locator('button[type=submit]').click();
  await page.waitForFunction(() => import('./js/store.js').then(s => (s.byId('gear', window.__g).log || []).length === 1), null, { timeout: 8000 }).catch(() => {}); // the save is synchronous, but a loaded machine can be slow to get there
  const g = await page.evaluate(() => import('./js/store.js').then(s => s.byId('gear', window.__g)));
  ok('log entry saved and firmware updated', g.log.length === 1 && g.log[0].kind === 'clean' && g.firmware === '2.10');
  const due = await page.evaluate(() => import('./js/pages/gear.js').then(m => import('./js/store.js').then(s => m.serviceDue(s.byId('gear', window.__g)))));
  const d0 = new Date(), pad2 = n => String(n).padStart(2, '0');
  ok('next service is a year after the clean', due === `${d0.getFullYear() + 1}-${pad2(d0.getMonth() + 1)}-${pad2(d0.getDate())}`, due);
  await page.keyboard.press('Escape'); await sleep(200);
  const [csv2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
  ok('asset register carries warranty, firmware and last service', /Warranty until/.test(fs.readFileSync(await csv2.path(), 'utf8')) && /2\.10/.test(fs.readFileSync(await csv2.path(), 'utf8')));
  await page.screenshot({ path: S + '/features.png' });
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

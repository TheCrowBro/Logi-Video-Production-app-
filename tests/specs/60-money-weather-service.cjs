const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const fs = require('fs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-loc', JSON.stringify({ lat: 51.50735, lon: -0.12776 })); }); // a saved location to the metre, as "use my location" gives it
  await ctx.addInitScript(acceptTerms());
  // Forecast API mocked: a fixed sunny-then-showery day
  const asked = []; // every address the forecast was asked at
  await ctx.route('https://api.open-meteo.com/**', route => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily_units: { temperature_2m_max: '°C' }, daily: { time: ['2026-11-01'], weather_code: [80], temperature_2m_max: [14.2], temperature_2m_min: [8.6], precipitation_probability_max: [60], wind_speed_10m_max: [24.1], wind_gusts_10m_max: [45.3] } }) }); });
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
  const wx = await page.locator('.bk-detail .wx-card').innerText();
  ok('the weather card reads well: the sky, the range, rain and wind', /Showers/.test(wx) && /9–14°C/.test(wx) && /60% chance of rain/.test(wx) && /wind to 24 km\/h \(gusts 45\)/.test(wx), wx.replace(/\n/g, ' | '));
  await page.getByRole('button', { name: /Call sheet/ }).first().click(); await page.waitForSelector('.cs-page');
  await page.waitForSelector('.cs-page .wxline button');
  await page.locator('.cs-page .wxline button').click(); await sleep(300);
  const cs = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).callSheet));
  ok('Add to call sheet writes the forecast into the sheet', /Showers/.test(cs.weather) && cs.editedAt > 0);
  ok('the sheet prints the forecast', /Showers/.test(await page.locator('.cs-doc').evaluate(el => el.textContent)));
  // The privacy policy says the coordinates are rounded to two decimals before they are sent (about a kilometre).
  const coords = asked.map(u => new URL(u).searchParams), keys = [...new Set(asked.flatMap(u => [...new URL(u).searchParams.keys()]))].sort();
  ok('the forecast is asked for with coordinates rounded to two decimals, never the saved location to the metre', asked.length > 0 && coords.every(q => /^-?\d+\.\d{2}$/.test(q.get('latitude')) && /^-?\d+\.\d{2}$/.test(q.get('longitude'))) && !asked.some(u => /50735|12776/.test(u)), asked[0]);
  ok('…and with nothing else but the day, the time zone setting and what to forecast', keys.every(k => ['daily', 'end_date', 'latitude', 'longitude', 'start_date', 'temperature_unit', 'timezone', 'wind_speed_unit'].includes(k)) && coords.every(q => q.get('timezone') === 'auto' && q.get('start_date') === q.get('end_date')), keys.join(', '));

  // ---- quotes and invoices ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(300);
  await openSetting(page, 'Quotes & invoices');
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
  await page.locator('#bk-work').evaluate(d => { d.open = true; }); await sleep(150);
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
  // A 360-pixel phone with a big job on the books: every total and badge stays on screen.
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => { const doc = (n, status, extra) => ({ number: n, date: '2026-09-01', lines: [{ id: n + 'l', desc: 'Shoot days', qty: 12, price: 1850 }], taxRate: 0, taxLabel: 'Tax', notes: '', status, deposit: '', ...extra }); s.upsert('bookings', { id: 'wide-money', title: 'Feature documentary, second unit', client: 'Northern Lights Productions', date: '2026-10-01', status: 'Delivered', checks: {}, quote: doc('Q-9001', 'Sent', { until: '2026-12-01' }), invoice: doc('INV-9001', 'Sent', { due: '2026-10-16', payments: [] }) }); }));
  await page.setViewportSize({ width: 360, height: 900 }); await sleep(300);
  await page.getByRole('button', { name: 'Money' }).click(); await page.waitForSelector('.sheet .stats'); await sleep(300);
  const narrow = await page.evaluate(() => { const box = document.querySelector('.sheet .sheet-body').getBoundingClientRect(), all = [...document.querySelectorAll('.sheet .stat, .sheet .money-pills .pill')]; return { n: all.length, wide: /22,200/.test(document.querySelector('.sheet').innerText), out: all.filter(e => e.getBoundingClientRect().right > box.right + 0.5).map(e => e.textContent) }; });
  ok('on a 360-pixel phone, with five-figure amounts, the four totals and the quote and invoice badges all stay on screen', narrow.n >= 7 && narrow.wide && narrow.out.length === 0, JSON.stringify(narrow));
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.remove('bookings', 'wide-money')));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);
  await page.getByRole('button', { name: 'Money' }).click(); await page.waitForSelector('.sheet .stats');
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Invoices \(CSV\)/ }).click()]);
  ok('invoice CSV export', /INV-0001/.test(fs.readFileSync(await csv.path(), 'utf8')));
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- repairs after 1.4.0: quotes and invoices ----
  const mform = page.locator('.sheet form'), mlines = () => page.evaluate(() => import('./js/store.js').then(s => (s.byId('bookings', 'mn-h').invoice.lines || []).map(l => [l.desc, l.qty, l.unit].join(' ')).join(' | ')));
  await page.evaluate(() => import('./js/store.js').then(s => { const day = n => { const x = new Date(); x.setDate(x.getDate() - n); return x; }, iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    window.__shift = (id, n, kind, hours) => { const x = day(n), start = new Date(x.getFullYear(), x.getMonth(), x.getDate(), 8).getTime(); return { id, bookingId: 'mn-h', kind, date: iso(x), start, end: start + hours * 36e5, breaks: [], updatedAt: 1 }; };
    s.update(d => { d.bookings.push({ id: 'mn-h', title: 'Probe shoot', client: 'Probe Client', date: iso(day(3)), status: 'Shot', crew: [], gear: [], stakeholders: [] }); d.shifts.push(window.__shift('mh1', 3, 'shoot', 8), window.__shift('mh2', 2, 'edit', 3)); }); }));
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('mn-h', { view: 'money', kind: 'invoice' }))); await page.waitForSelector('.money-page');
  await page.getByRole('button', { name: 'From hours logged' }).click(); await mform.waitFor(); await mform.locator('button[type=submit]').click(); await sleep(400);
  const hours1 = await mlines();
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.shifts.push(window.__shift('mh3', 1, 'shoot', 8), window.__shift('mh4', 0, 'edit', 5)); }))); await sleep(200);
  await page.getByRole('button', { name: 'Lines from hours logged' }).click(); await sleep(400);
  const hours2 = await mlines();
  ok('“Lines from hours logged” tapped again after more work brings the lines up to date: two shoot days once, eight editing hours', hours1 === 'Shoot day — Probe shoot 1 day | Editing 3 hour' && hours2 === 'Shoot days — Probe shoot 2 day | Editing 8 hour', hours1 + ' → ' + hours2);
  await page.getByRole('button', { name: 'Lines from hours logged' }).click(); await sleep(300);
  ok('a further tap adds and changes nothing', (await mlines()) === hours2, await mlines());
  const merged = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { if (!m.mergeSuggested) return null;
    const c = s.db.crew[0], show = r => r.lines.map(l => [l.desc.split(' — ')[0], l.qty, l.unit].join(' ')).join(' | ') + ` (+${r.added} ~${r.updated})`;
    const job = days => ({ id: 'mn-q', title: 'Grown job', date: '2026-12-01', endDate: days > 1 ? '2026-12-03' : '', crew: [c.id], gear: [], stakeholders: [] });
    const grown = m.mergeSuggested(m.suggestLines(job(1), 'quote', 'booking'), m.suggestLines(job(3), 'quote', 'booking'), 'booking'); // the quote of a one-day job that grew to three
    const old = m.mergeSuggested([{ id: 'a', desc: 'Shoot day — Probe shoot', qty: 1, unit: 'day', price: 600 }, { id: 'b', desc: 'Editing', qty: 3, unit: 'hour', price: 55 }, { id: 'c', desc: 'Travel', qty: 1, unit: 'each', price: 80 }], m.suggestLines(s.byId('bookings', 'mn-h'), 'invoice', 'hours'), 'hours'); // lines saved before lines carried their source
    const quoted = m.mergeSuggested(s.byId('bookings', 'mn-h').invoice.lines, m.suggestLines({ id: 'x', date: '2026-12-01', quote: { lines: [{ id: 'q1', desc: 'Editing', qty: 1, unit: 'day', price: 400 }, { id: 'q2', desc: 'Travel', qty: 1, unit: 'each', price: 80 }] } }, 'invoice', 'quote'), 'quote'); // the price list's "Editing" by the day, on the quote
    const again = m.mergeSuggested(quoted.lines, m.suggestLines({ id: 'x', date: '2026-12-01', quote: { lines: [{ id: 'q1', desc: 'Editing', qty: 2, unit: 'day', price: 400 }, { id: 'q2', desc: 'Travel', qty: 1, unit: 'each', price: 80 }] } }, 'invoice', 'quote'), 'quote');
    return { grown: show(grown), price: grown.lines[0].price, old: show(old), quoted: show(quoted), again: show(again), leak: JSON.stringify(m.snapshot(s.byId('bookings', 'mn-h'), 'invoice')).includes('"src"') }; }));
  ok('a quote made for one day, asked again once the job is three days, has three shoot days and three crew days, each once', !!merged && /^Shoot days 3 day \| Crew: [^|]+ 3 day \(\+0 ~2\)$/.test(merged.grown) && merged.price === 600, JSON.stringify(merged && merged.grown));
  ok('lines saved before this repair are known by what they say, and a line typed by hand is left as it is', !!merged && merged.old === 'Shoot days 2 day | Editing 8 hour | Travel 1 each (+0 ~2)', JSON.stringify(merged && merged.old));
  ok('“Lines from the quote” adds the quote’s Editing by the day beside the editing hours, once, and never changes a line', !!merged && merged.quoted === 'Shoot days 2 day | Editing 8 hour | Editing 1 day | Travel 1 each (+2 ~0)' && merged.again === 'Shoot days 2 day | Editing 8 hour | Editing 1 day | Travel 1 each (+0 ~0)' && !merged.leak, JSON.stringify(merged && [merged.quoted, merged.again, merged.leak]));
  // Documents made before lines carried their source (1.4.0): a quote made "From the booking", its invoice made "From
  // the quote", there or after the update. Asking for the lines again adds only what is missing.
  const before = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => {
    const c = s.db.crew[0], show = r => r.lines.map(l => [l.desc.split(' — ')[0], l.qty, l.unit].join(' ')).join(' | ') + ` (+${r.added} ~${r.updated})`;
    const b = { id: 'mn-old', title: 'Made before', date: '2026-12-01', endDate: '2026-12-02', crew: [c.id], gear: ['g'], rentals: [{ id: 'r1', item: 'Prism lens', from: 'Camera Co', cost: 85 }], deliverables: [{ id: 'd1', name: 'Main film', duration: '3 min' }], stakeholders: [] };
    const bare = lines => lines.map(({ src, ...l }) => l); // as 1.4.0 kept a line: no source
    const quote = { lines: bare(m.suggestLines(b, 'quote', 'booking')) }, withQuote = { ...b, quote };
    const invOld = bare(quote.lines.map(l => ({ ...l, id: 'i' + l.id }))); // the invoice 1.4.0 made from that quote
    const fromQuote = m.mergeSuggested(invOld, m.suggestLines(withQuote, 'invoice', 'quote'), 'quote');
    const invNew = m.suggestLines(withQuote, 'invoice', 'quote'); // the invoice made from that quote now
    const fromBooking = m.mergeSuggested(invNew, m.suggestLines(withQuote, 'invoice', 'booking'), 'booking');
    const typed = { ...b, quote: { lines: [...quote.lines, { id: 'h1', desc: 'Travel', qty: 1, unit: 'each', price: 80 }] } }; // a line typed on the quote by hand
    const again = m.mergeSuggested(m.suggestLines(typed, 'invoice', 'quote'), m.suggestLines(typed, 'invoice', 'quote'), 'quote');
    return { n: quote.lines.length, fromQuote: show(fromQuote), fromBooking: show(fromBooking), again: `+${again.added} ~${again.updated}` }; }));
  ok('“Lines from the quote” on an invoice made from its quote before the update adds nothing: no line twice', !!before && before.n === 4 && /\(\+0 ~0\)$/.test(before.fromQuote), JSON.stringify(before));
  ok('“Lines from the booking” on an invoice made from a quote of before the update adds the rented lens alone', !!before && /^Shoot days 2 day \| Crew: [^|]+ 2 day \| Equipment package 2 day \| Main film \(3 min\) 1 each \| Hire: Prism lens \(Camera Co\) 1 each \(\+1 ~0\)$/.test(before.fromBooking) && before.again === '+0 ~0', JSON.stringify(before));
  // found by the last check: a quote may hold two lines that read alike (travel there and travel back, a second
  // "Shoot day — …" or equipment package for another unit). Each is a line of its own on the invoice: asked for
  // on an invoice that exists, none of them is left out, and asked for again, none comes twice.
  const alike = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => {
    const show = r => r.lines.map(l => `${l.desc} ${l.qty}x${l.price}`).join(' | ') + ` (+${r.added})`, own = [{ id: 'x', desc: 'Deposit handling', qty: 1, unit: 'each', price: 10 }];
    const from = lines => { const b = { id: 'mn-alike', title: 'Alike', date: '2026-12-01', crew: [], gear: [], quote: { lines } }, first = m.mergeSuggested(own, m.suggestLines(b, 'invoice', 'quote'), 'quote'); return [show(first), `+${m.mergeSuggested(first.lines, m.suggestLines(b, 'invoice', 'quote'), 'quote').added}`]; };
    return { travel: from([{ id: 'l1', desc: 'Travel', qty: 1, unit: 'each', price: 80 }, { id: 'l2', desc: 'Travel', qty: 1, unit: 'each', price: 45 }]),
      shoot: from([{ id: 'l1', desc: 'Shoot day — main unit', qty: 1, unit: 'day', price: 600 }, { id: 'l2', desc: 'Shoot day — second unit', qty: 1, unit: 'day', price: 400 }]),
      kit: from([{ id: 'l1', desc: 'Equipment package', qty: 1, unit: 'day', price: 100 }, { id: 'l2', desc: 'Equipment package', qty: 2, unit: 'day', price: 60 }]) }; }));
  ok('“Lines from the quote” brings both of two quote lines that read alike, and none twice when asked again', !!alike && alike.travel.join() === 'Deposit handling 1x10 | Travel 1x80 | Travel 1x45 (+2),+0' && alike.shoot.join() === 'Deposit handling 1x10 | Shoot day — main unit 1x600 | Shoot day — second unit 1x400 (+2),+0' && alike.kit.join() === 'Deposit handling 1x10 | Equipment package 1x100 | Equipment package 2x60 (+2),+0', JSON.stringify(alike));
  // The form: an emptied line goes; the document's own tax name can be changed
  await page.evaluate(() => import('./js/money.js').then(m => m.setBilling({ taxLabel: 'Sales tax' }))); await sleep(200);
  await page.locator('.money-page').getByRole('button', { name: 'Edit' }).click(); await mform.waitFor();
  for (const box of await mform.locator('.field:has(label:has-text("Lines")) .row-edit').nth(1).locator('input').all()) await box.fill('');
  const hasName = await mform.locator('input[data-key="taxLabel"]').count();
  if (hasName) await mform.locator('input[data-key="taxLabel"]').fill('Sales tax');
  await mform.locator('input[data-key="taxRate"]').fill('8'); await mform.locator('button[type=submit]').click(); await sleep(400);
  const edited = await page.evaluate(() => import('./js/store.js').then(s => { const inv = s.byId('bookings', 'mn-h').invoice; return { lines: inv.lines.map(l => l.desc).join(' | '), doc: document.querySelector('.money-doc .money-totals').textContent }; }));
  ok('a line emptied by hand in the form is dropped, not left as a blank line priced nothing', edited.lines === 'Shoot days — Probe shoot', edited.lines);
  ok('the form has the invoice’s own tax name, and the document prints the name the form shows', hasName === 1 && /Sales tax 8%/.test(edited.doc) && !/VAT/.test(edited.doc), edited.doc);
  // Invoices due in 0 days are due on receipt
  const dueOn = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { m.setBilling({ dueDays: 0 }); s.upsert('bookings', { id: 'mn-d', title: 'Due on receipt', date: '2026-12-01', status: 'Shot', crew: [], gear: [], stakeholders: [] }); m.editMoney(s.byId('bookings', 'mn-d'), 'invoice'); })).then(async () => { await mform.waitFor(); const v = [await mform.locator('input[data-key="date"]').inputValue(), await mform.locator('input[data-key="due"]').inputValue()]; await page.keyboard.press('Escape'); return v; });
  ok('with “Invoices due in (days)” at 0 a new invoice is due on its own date', dueOn[0] === dueOn[1] && /^\d{4}-\d\d-\d\d$/.test(dueOn[1]), dueOn.join(' / '));
  await page.evaluate(() => import('./js/money.js').then(m => m.setBilling({ dueDays: 14, taxLabel: 'VAT' }))); await sleep(200);
  // The walkthrough's practice job is listed, but is not money: not in the totals, not in the accountant's file
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await sleep(300);
  const overview = async () => { await page.getByRole('button', { name: 'Money' }).click(); await page.waitForSelector('.sheet .stats'); const t = (await page.locator('.sheet .stats').innerText()).replace(/\s+/g, ' '); return t; };
  const sumsBefore = await overview(); await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => { const today = new Date().toISOString().slice(0, 10), doc = (number, status, more) => ({ number, date: today, lines: [{ id: number, desc: 'Practice day', qty: 1, unit: 'day', price: 720 }], taxRate: 0, taxLabel: 'VAT', status, ...more });
    s.upsert('bookings', { id: 'practice-x', practice: true, title: 'Practice job (delete when done)', client: 'Sample client', date: today, status: 'Delivered', crew: [], gear: [], stakeholders: [], quote: doc('Q-PRACTICE', 'Accepted'), invoice: doc('INV-PRACTICE', 'Sent', { due: today, payments: [{ id: 'pp', date: today, amount: 360, method: 'Bank transfer' }] }) }); }));
  const sumsAfter = await overview(), listed = await page.locator('.sheet .list').innerText();
  const [pcsv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Invoices \(CSV\)/ }).click()]);
  const pcsvText = fs.readFileSync(await pcsv.path(), 'utf8');
  ok('the practice job of the money walkthrough is listed but left out of the Money totals and the accountant’s CSV', sumsAfter === sumsBefore && /Practice job/.test(listed) && !/PRACTICE/.test(pcsvText) && /INV-0001/.test(pcsvText), sumsBefore + ' → ' + sumsAfter);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => { s.remove('bookings', 'practice-x'); s.remove('bookings', 'mn-d'); }));
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
  ok('log entry saved and firmware updated', g.log && g.log.length === 1 && g.log[0].kind === 'clean' && g.firmware === '2.10', JSON.stringify({ log: g.log, fw: g.firmware, sheets: await page.locator('.sheet').count(), toast: await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '') }));
  const due = await page.evaluate(() => import('./js/pages/gear.js').then(m => import('./js/store.js').then(s => m.serviceDue(s.byId('gear', window.__g)))));
  const d0 = new Date(), pad2 = n => String(n).padStart(2, '0');
  ok('next service is a year after the clean', due === `${d0.getFullYear() + 1}-${pad2(d0.getMonth() + 1)}-${pad2(d0.getDate())}`, due);
  await page.keyboard.press('Escape'); await sleep(200);
  const [csv2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
  ok('asset register carries warranty, firmware and last service', /Warranty until/.test(fs.readFileSync(await csv2.path(), 'utf8')) && /2\.10/.test(fs.readFileSync(await csv2.path(), 'utf8')));
  // where it is
  await page.locator(`.gear-card:has-text("${gName}") .loc-chip`).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="location"]').fill('Van'); await page.locator('.sheet form button[type=submit]').click();
  await page.waitForFunction(() => import('./js/store.js').then(s => s.byId('gear', window.__g).location === 'Van'), null, { timeout: 8000 });
  await sleep(300);
  ok('the item shows where it is', /📍 Van/.test(await page.locator(`.gear-card:has-text("${gName}")`).innerText()));
  await page.locator('.loc-chips .chip:has-text("Van")').click(); await sleep(300);
  const shown = await page.locator('.gear-card').allInnerTexts();
  ok('the place chip filters the list to items in that place', shown.length >= 1 && shown.every(t => /📍 Van/.test(t)), shown.length + ' cards');
  await page.locator('.loc-chips .chip:has-text("Anywhere")').click(); await sleep(300);
  const [csv3] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Asset register' }).click()]);
  const reg = fs.readFileSync(await csv3.path(), 'utf8');
  ok('the asset register has a Where column with the place', /"Where"/.test(reg) && new RegExp(`"${gName}".*"Van"`).test(reg));

  // ---- the Equipment page, the service log, kits, the register, insurance and the forecast: repairs after 1.4.0 ----
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 780 }, acceptDownloads: true });
    const asked2 = []; let answer = { daily: { time: [] } };
    await c2.route('https://api.open-meteo.com/**', route => { asked2.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }); });
    await c2.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); }); await c2.addInitScript(acceptTerms());
    const p = await c2.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await p.waitForSelector('#rolodex .drum-btn');
    const LINK = 'https://www.dropbox.example/scl/fi/a1b2c3d4e5f6g7h8i9j0/Showreel_2026_final_v3.mp4?rlkey=abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz&dl=0';
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const go = async id => { await p.evaluate(i => window.logiGo(i), id); await sleep(350); };
    const names = () => p.locator('.gear-card strong').allInnerTexts(), noMatch = () => p.locator('.empty', { hasText: 'No matches.' }).count();
    const save = async () => { await p.locator('.sheet form button[type=submit]').click(); await sleep(350); };
    await p.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.gear.push({ id: 'g-cam', name: 'Sony FX6 body', category: 'Camera', qty: 1, value: 6000, notes: '' }, { id: 'g-lens', name: 'Sigma 24-70', category: 'Lens', qty: 1, value: 800, location: 'Van', notes: '' }); })));
    await go('gear');
    // a filter whose chip, place or search box goes away with the change just made is let go
    await p.locator('.chips:not(.loc-chips) .chip', { hasText: 'Camera' }).click(); await sleep(200);
    await p.locator('.gear-card button[aria-label="Edit Sony FX6 body"]').click(); await p.waitForSelector('.sheet form');
    await p.locator('.sheet form input[data-key="category"]').fill('lenses'); await save();
    const cat = await p.evaluate(() => import('./js/store.js').then(s => s.byId('gear', 'g-cam').category));
    ok('an item moved out of the category the list is filtered by leaves the whole list, not “No matches.”', (await names()).length === 2 && (await noMatch()) === 0, (await names()).join());
    ok('a category typed as “lenses” is filed as Lens', cat === 'Lens', cat);
    await p.locator('.loc-chips .chip', { hasText: 'Van' }).click(); await sleep(200);
    await p.locator('.gear-card .loc-chip').click(); await p.waitForSelector('.sheet form');
    await p.locator('.sheet form input[data-key="location"]').fill(''); await save();
    ok('…and so does the last item of a place when its place is emptied', (await names()).length === 2 && (await noMatch()) === 0, (await names()).join());
    await p.evaluate(() => import('./js/store.js').then(s => s.update(d => { for (const [id, name, category] of [['g3', 'Zoom F6', 'Audio'], ['g4', 'Rode NTG5', 'audio'], ['g5', 'Tilta cage', 'Support'], ['g6', 'Aputure 300d', 'Lighting']]) d.gear.push({ id, name, category, qty: 1, value: 100, notes: '' }); }))); await sleep(300);
    const heads = (await p.locator('section.block h3').allInnerTexts()).map(x => x.toLowerCase());
    ok('“Audio” and “audio” are one section of the list', heads.filter(x => x === 'audio').length === 1 && new Set(heads).size === heads.length, heads.join());
    await p.locator('.search').fill('zoom'); await sleep(250);
    const found = await names();
    await p.locator('.gear-card button[aria-label="Edit Zoom F6"]').click(); await p.waitForSelector('.sheet form');
    await p.locator('.sheet form .btn.danger').click(); await sleep(400);
    ok('…and a search whose one match is deleted, in a list now too short for the search box', found.join() === 'Zoom F6' && (await names()).length === 5 && (await noMatch()) === 0 && (await p.locator('.search').count()) === 0, found.join() + ' → ' + (await names()).length);
    // the service log takes a cost with pennies, and a month's step from the 31st lands in the next month
    await p.locator('.gear-card button[aria-label="Service log for Tilta cage"]').click(); await p.waitForSelector('.sheet');
    await p.getByRole('button', { name: '+ Log an entry' }).click(); await p.waitForSelector('.sheet form');
    await p.locator('.sheet form input[data-key="cost"]').fill('49.50'); await save();
    const entry = await p.evaluate(() => import('./js/store.js').then(s => (s.byId('gear', 'g5').log || [])[0]));
    ok('a service entry with a cost of 49.50 is saved', !!entry && entry.cost === 49.5, JSON.stringify(entry));
    await p.keyboard.press('Escape'); await sleep(250);
    const due = await p.evaluate(() => import('./js/pages/gear.js').then(g => [g.monthsLater('2027-01-31', 1), g.monthsLater('2025-08-31', 6), g.monthsLater('2024-01-31', 1), g.monthsLater('2026-03-15', 2), g.monthsLater('2026-11-30', 3), g.serviceDue({ purchased: '2027-01-31', serviceEvery: 1 })]));
    ok('a service due a month after 31 January is due on the last day of February, never in March', due.join() === '2027-02-28,2026-02-28,2024-02-29,2026-05-15,2027-02-28,2027-02-28', due.join());
    // a kit counts no more of an item than are owned now
    await p.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.gear.push({ id: 'g-tube', name: 'Tube light', category: 'Lighting', qty: 4, value: 100, notes: 'Line one\nLine two' }); d.kits.push({ id: 'k-tube', name: 'Tube kit', gear: ['g-tube'], gearQty: { 'g-tube': 4 }, notes: '' }); })));
    await p.evaluate(() => import('./js/store.js').then(s => s.upsert('gear', { ...s.byId('gear', 'g-tube'), qty: 1 })));
    await p.getByRole('tab', { name: /^Kits/ }).click(); await sleep(250);
    const kit = (await p.locator('.kit-card[data-id="k-tube"]').innerText()).replace(/\s+/g, ' ');
    ok('a kit of four lights reads one light once only one is owned', /1 item · \$100/.test(kit) && !/×4/.test(kit), kit);
    await p.getByRole('tab', { name: /^Items/ }).click(); await sleep(250);
    // the asset register keeps the line breaks of a note, and Vdex reads them back
    const [reg2] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
    const regText = fs.readFileSync(await reg2.path(), 'utf8');
    const back = await p.evaluate(text => import('./js/table-read.js').then(async T => (await T.readTableText(text)).sheets[0].rows.some(r => r.cells.includes('Line one\nLine two'))), regText);
    ok('a note of two lines is two lines in the asset register, and read back as two', /"Line one\r?\nLine two"/.test(regText) && back, String(back));
    // insurance: one day is one day
    await p.evaluate(([one, two]) => import('./js/store.js').then(s => s.update(d => { d.insurance.push({ id: 'p1', type: 'Equipment', provider: 'Tomorrow Mutual', renewal: one, notes: '' }, { id: 'p2', type: 'Public Liability', provider: 'Later Mutual', renewal: two, notes: '' }); })), [day(1), day(2)]);
    await go('insurance');
    const pills = [await p.locator('.policy-card[data-id="p1"] .pill').innerText(), await p.locator('.policy-card[data-id="p2"] .pill').innerText()];
    ok('a policy that expires tomorrow has 1 day left, not “1 days”', pills.join() === '1 day left,2 days left', pills.join());
    // a long unbroken note (a pasted link) wraps inside its card on a phone
    await p.evaluate(link => import('./js/store.js').then(s => s.update(d => { const note = 'Reel: ' + link;
      d.crew.push({ id: 'c-long', name: 'Long Note', role: 'Editor', notes: note }); d.gear[0].notes = note; d.kits[0].notes = note; d.insurance[0].notes = note;
      d.venues.push({ id: 'v-long', name: 'Long Hall', address: '1 Example Road', rules: note, permit: 'Required', permitNotes: note, access: link, parking: link, power: link, hospital: link, notes: note }); })), LINK);
    const wide = {}, over = () => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    for (const id of ['crew', 'gear', 'insurance']) { await go(id); wide[id] = await over(); }
    await go('gear'); await p.getByRole('tab', { name: /^Kits/ }).click(); await sleep(250); wide.kits = await over(); await p.getByRole('tab', { name: /^Items/ }).click();
    await p.evaluate(() => import('./js/pages/venues.js').then(v => v.openVenue('v-long'))); await sleep(400); wide.venue = await over();
    ok('a pasted link in a note wraps inside its card on Crew, Equipment, Kits, Insurance and a venue’s page (390 px)', Object.values(wide).every(n => n <= 0), JSON.stringify(wide));
    // the forecast: a day the service has no values for yet is no forecast, and nothing is kept of it
    const lone = day(14);
    answer = { daily: { time: [lone], weather_code: [null], temperature_2m_max: [null], temperature_2m_min: [null], precipitation_probability_max: [null], wind_speed_10m_max: [null], wind_gusts_10m_max: [null] } };
    const none = await p.evaluate(async iso => { const w = await import('./js/weather.js'), got = await w.forecast(51.5, -0.12, iso), card = w.forecastCard({ lat: 51.5, lon: -0.12 }, iso), line = w.forecastLine({ lat: 51.5, lon: -0.12 }, iso, { onUse: () => {} }); document.body.append(card, line); await new Promise(r => setTimeout(r, 500)); const out = { got, card: card.innerText, line: line.isConnected, kept: Object.keys(JSON.parse(localStorage.getItem('logi-wx') || '{}')).length }; card.remove(); line.remove(); return out; }, lone);
    ok('a day the forecast service has no values for yet reads “No forecast for this day yet.”, not 0–0°C, and no line is offered for the call sheet', none.got === null && /No forecast for this day yet/.test(none.card) && !/0–0/.test(none.card) && none.line === false && none.kept === 0, JSON.stringify(none));
    // feet for distances and Celsius for the forecast can be had together
    answer = { daily: { time: ['x'], weather_code: [3], temperature_2m_max: [10], temperature_2m_min: [5], precipitation_probability_max: [20], wind_speed_10m_max: [12], wind_gusts_10m_max: [20] } };
    const wx = iso => p.evaluate(iso => import('./js/weather.js').then(w => w.forecast(51.5, -0.12, iso)).then(v => v.tUnit + ' ' + v.wUnit), iso);
    await p.evaluate(() => localStorage.setItem('logi-units', 'ft'));
    const inFeet = [await wx(day(2)), /temperature_unit=fahrenheit&wind_speed_unit=mph/.test(asked2[asked2.length - 1])];
    await go('settings'); await openSetting(p, 'Field tool defaults'); await sleep(200);
    await p.locator('.wx-units button', { hasText: '°C, km/h' }).click(); await sleep(150);
    const own = [await wx(day(3)), /fahrenheit|mph/.test(asked2[asked2.length - 1]), await p.evaluate(() => [localStorage.getItem('logi-units'), localStorage.getItem('logi-wx-units')].join())];
    ok('with feet chosen the forecast is in °F and mph until Settings gives it units of its own; then °C and km/h, and distances stay in feet', inFeet.join() === '°F mph,true' && own.join() === '°C km/h,false,ft,c', JSON.stringify([inFeet, own]));
    await c2.close();
  }
  await page.screenshot({ path: S + '/features.png' });
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

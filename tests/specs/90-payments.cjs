// Getting paid: payment settings, Pay buttons and the bank QR on an invoice, payments and balances, the client's
// link and the public invoice page, reminders, the overview and the CSV.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');

  // Payment settings
  await page.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); s.update(d => { d.profile.currency = '€'; d.profile.business = 'Portside Films'; d.profile.email = 'me@example.com'; }); }));
  await page.evaluate(() => import('./js/money.js').then(m => m.setBilling({ currencyCode: 'EUR', payMethods: [{ type: 'paypal', value: 'portsidefilms' }, { type: 'cashapp', value: 'portside' }, { type: 'link', value: 'https://pay.example.com/portside?amt={amount}&ref={reference}', label: 'Pay by card' }, { type: 'bank', accountName: 'Portside Films', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX' }, { type: 'zelle', value: 'pay@portsidefilms.example' }], payment: 'Reference: the invoice number.' })));
  await page.evaluate(() => window.logiGo('settings'));
  await page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices")) > summary').click();
  const settingsText = await page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices"))').innerText();
  ok('Settings → Quotes & invoices lists the ways to pay', /Getting paid/.test(settingsText) && /PayPal/.test(settingsText) && /Bank transfer/.test(settingsText) && /Zelle/.test(settingsText) && /portsidefilms/.test(settingsText) && /DE89/.test(settingsText));
  await page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices")) button:has-text("Add a way to pay")').click(); await page.waitForSelector('.sheet .list');
  const cat = await page.locator('.sheet').last().innerText();
  ok('the catalogue offers the common systems and a custom one', /Venmo/.test(cat) && /Stripe/.test(cat) && /Square/.test(cat) && /Revolut/.test(cat) && /Monzo/.test(cat) && /Wise/.test(cat) && /UPI/.test(cat) && /Interac/.test(cat) && /Any other payment page/.test(cat) && /Other instructions/.test(cat));
  await page.locator('.sheet .card:has-text("Venmo")').click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="value"]').fill('portside-films'); await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const types = await page.evaluate(() => import('./js/money.js').then(m => m.payMethods().map(x => x.type)));
  ok('a way added from the catalogue is saved', types.join(',') === 'paypal,cashapp,link,bank,zelle,venmo', types.join(','));
  const legacy = await page.evaluate(() => import('./js/pay.js').then(p => p.methodsOf({ paypalMe: 'old', iban: 'GB00', payLink: 'https://x.test/{amount}', payLinkLabel: 'Card' }).map(m => m.type)));
  ok('older fixed settings are read as a list', legacy.join(',') === 'paypal,link,bank', legacy.join(','));

  // An invoice on a delivered booking, open on its Money page
  const id = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => x.title === 'Corporate headshots'); const iso = off => { const x = new Date(); x.setDate(x.getDate() + off); return x.toISOString().slice(0, 10); };
    s.update(d => { const x = d.bookings.find(y => y.id === b.id); x.stakeholders = [{ id: 'c1', name: 'Dee Okafor', role: 'Client', email: 'dee@example.com' }]; x.invoice = { number: 'INV-0041', date: iso(-20), due: iso(-6), status: 'Sent', taxRate: 20, taxLabel: 'VAT', deposit: 200, lines: [{ id: 'l1', desc: 'Shoot day', qty: 1, unit: 'day', price: 1000 }, { id: 'l2', desc: 'Retouching', qty: 10, unit: 'photo', price: 10 }] }; }); window.__b = b.id; return b.id; }));
  await page.evaluate(() => window.logiGo('bookings'));
  await page.locator('button:has-text("Money")').first().click(); await page.waitForSelector('.sheet .stats');
  await page.locator('.sheet .list .card:has-text("Corporate headshots")').click(); await sleep(600);
  if (!(await page.locator('.money-page .status-line').count())) { await page.locator('.money-page .seg button:has-text("Invoice")').click(); await sleep(400); }
  const status = await page.locator('.money-page .status-line').innerText();
  ok('status line shows overdue and the balance after the deposit', /overdue/.test(status) && /balance €1,120\.00/.test(status), status);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.money-page .cs-paper .pay-btn')].map(a => [a.dataset.pay, a.getAttribute('href')]));
  ok('invoice carries Pay buttons for the balance: PayPal, Cash App, the card page and Venmo', hrefs.length === 4 && hrefs.some(([k, u]) => k === 'paypal' && u === 'https://paypal.me/portsidefilms/1120.00EUR') && hrefs.some(([k, u]) => k === 'cashapp' && u === 'https://cash.app/$portside/1120.00') && hrefs.some(([k, u]) => k === 'link' && u === 'https://pay.example.com/portside?amt=1120.00&ref=INV-0041') && hrefs.some(([k, u]) => k === 'venmo' && u === 'https://venmo.com/portside-films?txn=pay&amount=1120.00&note=INV-0041'), JSON.stringify(hrefs));
  const paper = await page.locator('.money-page .cs-paper').innerText();
  ok('bank details, the Zelle instruction and the reference are on the invoice', /IBAN \/ account: DE89/.test(paper) && /Zelle: pay@portsidefilms\.example/.test(paper) && /Reference: the invoice number/.test(paper) && /quote INV-0041 as the reference/.test(paper));
  await page.waitForSelector('.money-page .cs-paper .pay-qr svg', { timeout: 10000 }).catch(() => {});
  const epc = await page.evaluate(() => import('./js/pay.js').then(m => m.epcPayload({ iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX', accountName: 'Portside Films' }, { amount: 1120, code: 'EUR', reference: 'INV-0041' })));
  ok('a bank QR (EPC) is drawn with the euro amount and the reference', (await page.locator('.money-page .cs-paper .pay-qr svg').count()) === 1 && epc.split('\n').slice(0, 8).join('|') === 'BCD|002|1|SCT|COBADEFFXXX|Portside Films|DE89370400440532013000|EUR1120.00' && /INV-0041$/.test(epc));
  const pdfText = await page.evaluate(() => import('./js/money.js').then(m => import('./js/store.js').then(s => m.moneyPdf(s.byId('bookings', window.__b), 'invoice'))).then(bytes => new TextDecoder('latin1').decode(bytes)));
  ok('the PDF lists how to pay', /%PDF/.test(pdfText.slice(0, 8)) && /HOW TO PAY|How to pay/.test(pdfText) && /paypal.me\/portsidefilms/.test(pdfText));

  // Payments and the balance
  await page.locator('.money-page button:has-text("Record a payment")').click(); await page.waitForSelector('.sheet form');
  const amt = await page.locator('.sheet form input[data-key="amount"]').inputValue();
  ok('the payment form proposes the balance', amt === '1120.00', amt);
  await page.locator('.sheet form input[data-key="amount"]').fill('500');
  await page.locator('.sheet form input[data-key="note"]').fill('first half');
  await page.locator('.sheet form button[type=submit]').click();
  await page.waitForFunction(() => import('./js/store.js').then(s => (s.byId('bookings', window.__b).invoice.payments || []).length === 1), null, { timeout: 8000 });
  await sleep(300);
  const st2 = await page.locator('.money-page .status-line').innerText();
  ok('after a part payment: part paid, balance €620', /part paid/.test(st2) && /balance €620\.00/.test(st2), st2);
  ok('the payments list shows it', /€500\.00/.test(await page.locator('.money-page .pay-list').innerText()) && /first half/.test(await page.locator('.money-page .pay-list').innerText()));
  const hrefs2 = await page.evaluate(() => [...document.querySelectorAll('.money-page .cs-paper .pay-btn')].map(a => a.getAttribute('href')));
  ok('Pay buttons now ask for the new balance', hrefs2.some(u => u === 'https://paypal.me/portsidefilms/620.00EUR'), JSON.stringify(hrefs2));
  await page.locator('.money-page button:has-text("Record a payment")').click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form button[type=submit]').click();
  await page.waitForFunction(() => import('./js/store.js').then(s => s.byId('bookings', window.__b).invoice.status === 'Paid'), null, { timeout: 8000 });
  await sleep(300);
  const inv = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', window.__b); return { status: b.invoice.status, n: b.invoice.payments.length, paidAt: !!b.invoice.paidAt, check: !!b.checks['delivered:paid'] }; }));
  ok('paying the rest marks the invoice paid, with the pipeline ticked', inv.status === 'Paid' && inv.n === 2 && inv.paidAt && inv.check, JSON.stringify(inv));
  ok('the invoice now says paid, thank you, and has no Pay buttons', /Paid, thank you/i.test(await page.locator('.money-page .cs-paper').innerText()) && (await page.locator('.money-page .cs-paper .pay-btn').count()) === 0);
  await page.locator('.money-page .pay-list button[aria-label="Remove payment"]').last().click();
  await page.waitForFunction(() => import('./js/store.js').then(s => s.byId('bookings', window.__b).invoice.status === 'Sent'), null, { timeout: 8000 });
  await sleep(400);
  ok('removing a payment reopens the balance', /balance €620\.00/.test(await page.locator('.money-page .status-line').innerText()));

  // The client's link and the public page
  await page.locator('.money-page button:has-text("Link for the client")').click(); await page.waitForSelector('.sheet textarea.share-link');
  const link = await page.locator('.sheet textarea.share-link').inputValue();
  ok('the link points at invoice.html with the document inside it', /\/invoice\.html#1\.[A-Za-z0-9_-]{100,}$/.test(link), link.slice(0, 60) + '… (' + link.length + ' chars)');
  const mail = await page.locator('.sheet a:has-text("Email it")').getAttribute('href');
  ok('Email it is addressed to the client and carries the link', /^mailto:dee@example\.com\?/.test(mail) && decodeURIComponent(mail).includes(link));
  await page.waitForSelector('.sheet .share-qr svg', { timeout: 10000 }).catch(() => {});
  ok('a QR of the link is offered', (await page.locator('.sheet .share-qr svg').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);
  const client = await ctx.newPage();
  const cErrors = []; client.on('pageerror', e => cErrors.push(e.message)); client.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) cErrors.push(m.text()); });
  await client.goto(link); await client.waitForSelector('.paper .cs-doc');
  const ptext = await client.evaluate(() => document.body.innerText);
  ok('the public page shows the invoice: number, lines, totals, balance and payee', /INV-0041/.test(ptext) && /Shoot day/.test(ptext) && /Retouching/.test(ptext) && /Total\s*€1,320\.00/.test(ptext) && /Balance due\s*€620\.00/.test(ptext) && /Portside Films/.test(ptext), ptext.slice(0, 120).replace(/\s+/g, ' '));
  ok('its title names the invoice', /Invoice INV-0041/.test(await client.title()));
  const phrefs = await client.evaluate(() => [...document.querySelectorAll('.pay-btn')].map(a => a.getAttribute('href')));
  ok('the public page has the same Pay buttons for the balance', phrefs.includes('https://paypal.me/portsidefilms/620.00EUR') && phrefs.includes('https://pay.example.com/portside?amt=620.00&ref=INV-0041'), JSON.stringify(phrefs));
  ok('it says what is due and by when, and offers Print, Save PDF and Reply', /€620\.00 due, was due/.test(ptext) && (await client.locator('button:has-text("Print")').count()) === 1 && (await client.locator('a:has-text("Reply")').getAttribute('href')).startsWith('mailto:me@example.com'));
  await client.waitForSelector('.pay-qr svg', { timeout: 10000 }).catch(() => {});
  ok('the bank QR is drawn on the public page too', (await client.locator('.pay-qr svg').count()) === 1);
  const [dl] = await Promise.all([client.waitForEvent('download', { timeout: 15000 }), client.locator('button:has-text("Save PDF")').click()]);
  const pdfPath = await dl.path(); const head = fs.readFileSync(pdfPath).slice(0, 8).toString();
  ok('Save PDF on the public page makes a PDF', dl.suggestedFilename() === 'invoice-inv-0041.pdf' && /^%PDF/.test(head), dl.suggestedFilename());
  ok('no sideways scrolling on a phone', await client.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('no errors or CSP violations on the public page', cErrors.length === 0, cErrors.join(' | '));
  await client.goto('about:blank'); await client.goto(BASE + 'invoice.html#1.notavalidlink'); await client.waitForSelector('.msg h2', { timeout: 10000 }).catch(() => {});
  ok('a broken link gets a plain explanation', /does not open an invoice/.test(await client.evaluate(() => document.body.innerText)));
  await client.close();

  // Reminder, overview and CSV
  const remind = await page.evaluate(() => import('./js/money.js').then(m => import('./js/store.js').then(s => m.mailtoFor(s.byId('bookings', window.__b), 'invoice', 'https://example.test/invoice.html#x', 'remind'))));
  ok('the reminder email names the balance, the due date and the link', /^mailto:dee@example\.com\?/.test(remind) && /Reminder%3A%20invoice%20INV-0041/.test(remind) && /was%20due%20on/.test(remind) && decodeURIComponent(remind).includes('https://example.test/invoice.html#x'));
  ok('a Send a reminder button is on the page for an unpaid, sent invoice', (await page.locator('.money-page button:has-text("Send a reminder")').count()) === 1);
  // back out to the calendar: money page → booking → day → month
  await page.locator('.money-page .page-head button').first().click(); await sleep(300);
  await page.locator('#page .page-head button').first().click(); await sleep(300);
  await page.locator('button:has-text("Calendar")').first().click(); await sleep(300);
  await page.locator('button:has-text("Money")').first().click(); await page.waitForSelector('.sheet .stats');
  const stats = await page.locator('.sheet .stats').innerText();
  ok('the overview counts the open balance and what was received this year', /€620\.00\s*invoiced, unpaid/.test(stats) && /€700\.00\s*paid in/.test(stats), stats.replace(/\s+/g, ' '));
  const [csv] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('.sheet button:has-text("Invoices (CSV)")').click()]);
  const csvText = fs.readFileSync(await csv.path(), 'utf8');
  ok('the CSV carries Paid and Balance columns', /"Paid","Balance"/.test(csvText) && /"INV-0041".*"700\.00","620\.00"/.test(csvText));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { localStorage.removeItem('logi-money-nudge'); });
  const nudged = await page.evaluate(() => import('./js/money.js').then(m => { const seen = []; const orig = window.alert; m.moneyNudge(); return new Promise(r => setTimeout(() => r(!!document.querySelector('.toast') || true), 100)); }));
  ok('the overdue reminder at start-up runs without error', nudged === true);
  const policy = await (await page.goto(BASE + 'privacy.html')).text();
  ok('the privacy policy explains invoice links', /inside the link itself/i.test(policy));
  ok('no page errors or CSP violations', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

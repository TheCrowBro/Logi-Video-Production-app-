// Getting paid: payment settings, Pay buttons and the bank QR on an invoice, payments and balances, the client's
// link and the public invoice page, reminders, the overview and the CSV.
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const fs = require('fs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');

  // Payment settings
  await page.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); s.update(d => { d.profile.currency = '€'; d.profile.business = 'Portside Films'; d.profile.email = 'me@example.com'; }); }));
  await page.evaluate(() => import('./js/money.js').then(m => m.setBilling({ currencyCode: 'EUR', payMethods: [{ type: 'paypal', value: 'portsidefilms' }, { type: 'cashapp', value: 'portside' }, { type: 'link', value: 'https://pay.example.com/portside?amt={amount}&ref={reference}', label: 'Pay by card' }, { type: 'bank', accountName: 'Portside Films', iban: 'DE89 3704 0044 0532 0130 00', bic: 'COBADEFFXXX' }, { type: 'zelle', value: 'pay@portsidefilms.example' }], payment: 'Reference: the invoice number.' })));
  await page.evaluate(() => window.logiGo('settings'));
  await openSetting(page, 'Quotes & invoices');
  const settingsText = await page.locator('details.settings-section:has(> summary:has-text("Quotes & invoices"))').innerText();
  ok('Settings → Work & billing → Quotes & invoices lists the ways to pay', /Getting paid/.test(settingsText) && /PayPal/.test(settingsText) && /Bank transfer/.test(settingsText) && /Zelle/.test(settingsText) && /portsidefilms/.test(settingsText) && /DE89/.test(settingsText));
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

  // ---- repairs after 1.4.0: payments and the documents ----
  const pform = page.locator('.sheet form'), inv2 = () => page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', 'mn-p').invoice));
  const focusOn = () => page.evaluate(() => { const el = document.activeElement; return !el || el === document.body ? 'nothing' : (el.dataset.fk || el.textContent.trim().slice(0, 12)); });
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 'mn-p', title: 'Cents and corrections', client: 'Probe Client', date: '2026-12-01', status: 'Delivered', crew: [], gear: [], stakeholders: [{ name: 'Pat Probe', email: 'pat@example.com' }],
    invoice: { number: 'INV-0100', date: '2025-12-20', due: '2026-01-03', status: 'Draft', taxRate: 20, taxLabel: 'VAT', lines: [{ id: 'a', desc: 'Filming day', qty: 1, unit: 'day', price: 1250.5 }] } })));
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('mn-p', { view: 'money', kind: 'invoice' }))); await page.waitForSelector('.money-page .status-line');
  // The keyboard keeps its place: after a status button, and after the form is saved
  await page.locator('.money-page').getByRole('button', { name: 'Mark as sent' }).focus(); await page.keyboard.press('Enter'); await sleep(300);
  const f1 = await focusOn();
  await page.locator('.money-page').getByRole('button', { name: 'Edit' }).focus(); await page.keyboard.press('Enter'); await pform.waitFor(); await sleep(150);
  await pform.locator('input[data-key="number"]').press('Enter'); await sleep(400);
  const f2 = await focusOn();
  ok('after Mark as sent the focus is on the status line that now says so, and after the form is saved it is back on Edit', f1 === 'm-status' && /Edit/.test(f2) && (await inv2()).status === 'Sent', f1 + ' / ' + f2);
  // A payment to the cent; a payment of nothing is refused in the form
  await page.locator('.money-page button:has-text("Record a payment")').click(); await pform.waitFor();
  const proposed = await pform.locator('input[data-key="amount"]').inputValue();
  await pform.locator('input[data-key="amount"]').fill('0'); await pform.locator('input[data-key="note"]').fill('cheque 000123'); await pform.locator('button[type=submit]').click(); await sleep(300);
  const zero = (await pform.count()) ? await pform.locator('input[data-key="note"]').inputValue() : 'form closed';
  ok('a payment of 0 is refused in the form, which stays open with what was typed', zero === 'cheque 000123' && ((await inv2()).payments || []).length === 0, zero);
  if (!(await pform.count())) { await page.locator('.money-page button:has-text("Record a payment")').click(); await pform.waitFor(); }
  await pform.locator('input[data-key="amount"]').fill('500.50'); await pform.locator('button[type=submit]').click(); await sleep(500);
  const part = ((await inv2()).payments || []).map(p => p.amount).join();
  if (await pform.count()) await page.keyboard.press('Escape');
  await page.locator('.money-page button:has-text("Record a payment")').click(); await pform.waitFor();
  const rest = await pform.locator('input[data-key="amount"]').inputValue();
  await pform.locator('button[type=submit]').click(); await sleep(500);
  if (await pform.count()) await page.keyboard.press('Escape');
  const paidUp = await inv2();
  ok('a payment with cents is recorded, and so is the balance the form proposes itself', proposed === '1500.60' && part === '500.5' && rest === '1000.10' && paidUp.status === 'Paid' && (paidUp.payments || []).length === 2, JSON.stringify({ proposed, part, rest, status: paidUp.status }));
  // The dates follow the status
  const dates = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const inv = () => s.byId('bookings', 'mn-p').invoice, out = { paid: !!inv().paidAt };
    m.setDocStatus('mn-p', 'invoice', 'Sent'); out.backToSent = inv().paidAt || null; out.sent = !!inv().sentAt; m.setDocStatus('mn-p', 'invoice', 'Draft'); out.backToDraft = inv().sentAt || null; m.setDocStatus('mn-p', 'invoice', 'Sent'); out.sentAgain = !!inv().sentAt; return out; }));
  await sleep(300);
  ok('an invoice taken back from Paid has no paid date, and one taken back to Draft no sent date', dates.paid && dates.backToSent === null && dates.sent && dates.backToDraft === null && dates.sentAgain && !/ · paid \w/.test(await page.locator('.money-page .status-line').innerText()), JSON.stringify(dates));
  // Every figure from amounts rounded to cents
  const sums = await page.evaluate(() => import('./js/money-doc.js').then(md => { const of = (rate, ...lines) => { const snap = { calc: 2, kind: 'invoice', status: 'Sent', number: 'X', taxRate: rate, lines: lines.map(([qty, price]) => ({ qty, price })), pay: { methods: [{ type: 'paypal', value: 'probefilms' }] }, code: 'EUR' }, t = md.calc(snap); return [t.lines.map(l => l.amount).join('+'), t.subtotal, t.tax, t.total, t.balance, (md.payButtons(snap)[0].href.match(/[\d.]+(?=EUR)/) || [])[0]].join(' '); };
    return [of(19, [1, 117.5]), of(8.25, [1, 102]), of(10, [1, 100.05]), of(0, [1.5, 33.33], [1.5, 33.33])]; }));
  ok('lines add up to the subtotal, subtotal and tax to the total, and the balance and the Pay button ask for the total', sums.join(' | ') === '117.5 117.5 22.33 139.83 139.83 139.83 | 102 102 8.42 110.42 110.42 110.42 | 100.05 100.05 10.01 110.06 110.06 110.06 | 50+50 100 0 100 100 100.00', sums.join(' | '));
  // A document that went out under 1.4.0 keeps the figures it showed: the arithmetic follows the document's mark
  const kept = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js'), import('./js/money-doc.js'), import('./js/link-pack.js')]).then(async ([s, m, md, lp]) => {
    const doc = status => ({ number: 'INV-OLD', date: '2026-11-01', due: '2026-11-15', status, taxRate: 17.5, taxLabel: 'VAT', deposit: '', payments: [], lines: [{ id: 'o1', desc: 'Hours', qty: 12.5, unit: 'hour', price: 12.95 }], updatedAt: 1 }); // as 1.4.0 saved it: no mark
    const total = id => md.fmt(m.totals(s.byId('bookings', id).invoice).total, ''), mark = id => s.byId('bookings', id).invoice.calc || 0;
    s.update(d => { d.bookings.push({ id: 'mn-old1', title: 'Sent before the update', date: '2026-11-01', status: 'Delivered', crew: [], gear: [], stakeholders: [], invoice: doc('Sent') }, { id: 'mn-old2', title: 'A draft from before', date: '2026-11-01', status: 'Shot', crew: [], gear: [], stakeholders: [], invoice: doc('Draft') }); });
    const out = { sent: total('mn-old1') };
    const snap = m.snapshot(s.byId('bookings', 'mn-old1'), 'invoice'); out.link = md.fmt(md.calc(await lp.unpack('#' + await lp.pack(snap))).total, ''); out.pay = (md.payButtons({ ...snap, pay: { methods: [{ type: 'paypal', value: 'probefilms' }] }, code: 'GBP' })[0].href.match(/[\d.]+(?=GBP)/) || [])[0];
    // paid as the document asked: nothing is left due
    out.left = m.totals({ ...s.byId('bookings', 'mn-old1').invoice, payments: [{ amount: 190.2 }] }).balance;
    m.setDocStatus('mn-old1', 'invoice', 'Paid'); m.setDocStatus('mn-old1', 'invoice', 'Sent'); out.resent = total('mn-old1') + ' ' + mark('mn-old1');
    m.setDocStatus('mn-old1', 'invoice', 'Draft'); out.redrafted = total('mn-old1') + ' ' + mark('mn-old1');
    out.draft = total('mn-old2') + ' ' + mark('mn-old2'); m.setDocStatus('mn-old2', 'invoice', 'Sent'); out.draftSent = total('mn-old2') + ' ' + mark('mn-old2');
    out.fresh = (m.snapshot(s.byId('bookings', 'mn-p'), 'invoice').v) + ' ' + mark('mn-p');
    s.remove('bookings', 'mn-old1'); s.remove('bookings', 'mn-old2'); return out; }));
  await sleep(300);
  ok('an invoice sent before the update keeps its total, in the app, in its link and in the Pay button, and what it asked for pays it in full', kept.sent === '190.20' && kept.link === '190.20' && kept.pay === '190.20' && kept.left === 0 && kept.resent === '190.20 0', JSON.stringify(kept));
  ok('…until it is taken back to Draft; a draft from before the update is sent as it stood; a document made now is rounded line by line', kept.redrafted === '190.21 2' && kept.draft === '190.20 0' && kept.draftSent === '190.20 0' && kept.fresh === '2 2', JSON.stringify(kept));
  // A link made by 1.4.0 for a currency Vdex does not know carries that build's guess: the page does not ask for US dollars
  const oldLink = await page.evaluate(() => import('./js/money-doc.js').then(md => { const snap = (v, currency, code) => ({ v, kind: 'invoice', status: 'Sent', number: 'X', currency, code, lines: [{ qty: 1, price: 3500 }], pay: { methods: [{ type: 'paypal', value: 'probefilms' }] } });
    return [snap(1, '₪', 'USD'), snap(1, '$', 'USD'), snap(1, '₪', 'EUR'), snap(2, '₪', 'USD'), snap(2, '₪', '')].map(sn => md.payButtons(sn)[0].href.split('/').pop()); }));
  ok('a link from before the update in a currency Vdex does not know opens with no currency in its PayPal button; dollars, a chosen currency and a link made now are as written', oldLink.join(' ') === '3500.00 3500.00USD 3500.00EUR 3500.00USD 3500.00', oldLink.join(' '));
  // No guessed currency in a payment link
  const money7 = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js'), import('./js/money-doc.js')]).then(([s, m, md]) => { const was = s.db.profile.currency, href = sym => { s.update(d => { d.profile.currency = sym; }); const snap = m.snapshot(s.byId('bookings', 'mn-p'), 'invoice'); return [snap.code, (md.payButtons({ ...snap, status: 'Sent', payments: [] }).find(b => b.id === 'paypal') || {}).href].join(' '); };
    m.setBilling({ currencyCode: '' }); const out = [href('₪'), href('US$'), href('zł ')]; m.setBilling({ currencyCode: 'EUR' }); s.update(d => { d.profile.currency = was; }); return out; }));
  ok('a currency Vdex does not know is left out of the PayPal link instead of being called US dollars; one it knows is named', money7.join(' | ') === ' https://paypal.me/portsidefilms/1500.60 | USD https://paypal.me/portsidefilms/1500.60USD | PLN https://paypal.me/portsidefilms/1500.60PLN', money7.join(' | '));
  await page.evaluate(() => window.logiGo('settings')); await openSetting(page, 'Quotes & invoices');
  ok('the currency list for payment links has a “Not listed” choice', /Not listed/.test(await page.locator('select[aria-label="Currency for payment links"] option').first().innerText()));
  // The bank QR only for an account that is an IBAN
  const epcs = await page.evaluate(() => import('./js/pay.js').then(p => { const ctx = { amount: 10, code: 'USD', reference: 'INV-9' }, of = (iban, bic) => p.epcPayload({ methods: [{ type: 'bank', accountName: 'Probe Films LLC', iban, bic }] }, ctx).split('\n'); return { us: of('000123456789', '111000025').join('|'), wrong: of('DE89 3704 0044 0532 0130 01', 'COBADEFFXXX').join('|'), right: of('DE89 3704 0044 0532 0130 00', 'not a bic').slice(3, 7).join('|') }; }));
  ok('no bank QR for an account number that is not an IBAN (or whose check digits are wrong), and no routing number passed off as a BIC', epcs.us === '' && epcs.wrong === '' && epcs.right === 'SCT||Probe Films LLC|DE89370400440532013000', JSON.stringify(epcs));
  // Dates with their year; nothing to pay asks for nothing
  const words = await page.evaluate(() => import('./js/money-doc.js').then(md => { const base = { kind: 'invoice', number: 'INV-9', title: 'T', when: '', from: ['Probe Films'], to: ['Client'], currency: '$', code: 'USD', date: '2025-12-20', due: '2026-01-03', taxLabel: 'VAT', pay: { methods: [{ type: 'bank', accountName: 'Probe Films', iban: 'DE89 3704 0044 0532 0130 00' }] } };
    const dated = { ...base, status: 'Sent', taxRate: 0, lines: [{ desc: 'Day', qty: 1, price: 500 }], payments: [{ date: '2025-12-28', amount: 100, method: 'Stripe payment link' }] }, credit = { ...base, status: 'Sent', taxRate: 20, lines: [{ desc: 'Refund of overcharge', qty: 1, price: -150 }] }, zeroPaid = { ...base, status: 'Paid', taxRate: 0, lines: [] };
    const text = s => md.renderDoc(s).textContent, pdfWords = s => md.pdfBlocks(s).map(b => [b.k, b.v, b.text].filter(Boolean).join(' ')).join(' / ');
    return { head: md.renderDoc(dated).querySelector('.cs-when').textContent, text: md.docText(dated).split('\n')[3], paid: /Paid [^·]*2025/.test(text(dated)), pdf: /2025/.test(pdfWords(dated)) && /2026/.test(pdfWords(dated)), ref: (text(dated).match(/Balance due \$400\.00 by [^·]*/) || [''])[0],
      credit: text(credit), creditText: md.docText(credit), creditPdf: pdfWords(credit), zeroPaid: text(zeroPaid) }; }));
  ok('a quote or an invoice gives its date, its due date and its payments with the year: on the document, in its text and in the PDF', /2025/.test(words.head) && /2026/.test(words.head) && /2025/.test(words.text) && /2026/.test(words.text) && words.paid && words.pdf && /2026/.test(words.ref), JSON.stringify([words.head, words.text, words.ref]));
  ok('an invoice with nothing to pay (a credit note) shows no bank details, no QR and no balance to pay; one marked Paid at zero says so', /Total-\$180\.00/.test(words.credit) && !/IBAN|How to pay|Balance due/i.test(words.credit) && !/IBAN|How to pay/i.test(words.creditText) && !/IBAN|How to pay/i.test(words.creditPdf) && /Paid, thank you/.test(words.zeroPaid), words.credit.slice(-160));
  // The PDF: readable amounts in every currency on the list, lines kept apart, a long payment label clear of its amount
  const pdfFix = await page.evaluate(() => Promise.all([import('./js/pdf.js'), import('./js/money-doc.js')]).then(([pdf, md]) => { const ops = blocks => [...new TextDecoder('latin1').decode(pdf.makePdf({ title: 't', blocks })).matchAll(/\((.*?)\) Tj/g)].map(x => x[1]);
    const amounts = ops([{ type: 'text', text: '₹25,000.00' }, { type: 'text', text: 'zł 65 000,00' }, { type: 'text', text: 'Kč 65 000,00' }, { type: 'text', text: '€25 000,00' }, { type: 'text', text: 'Zdjęcia ślubne, Wałęsa Studio, Dvořák & Şahin, İstanbul, Győr, Škoda' }]);
    const snap = { kind: 'invoice', number: 'INV-9', title: 'T', when: '', status: 'Sent', currency: '$', date: '2026-11-01', taxRate: 0, from: ['Probe Films', 'Pat Probe', 'pat@example.com'], to: ['Client'], lines: [{ desc: 'Day', qty: 1, price: 5000 }], notes: 'Included:\n- one filming day\n- one edit\n\nNot included: music licences.', payments: [{ date: '2026-11-21', amount: 5000, method: 'Stripe payment link' }], pay: {} };
    const doc = ops(md.pdfBlocks(snap)); return { amounts, from: doc.includes('Pat Probe') && doc.includes('pat@example.com'), notes: doc.includes('Included:') && doc.includes('- one filming day') && doc.includes('- one edit') && doc.includes('Not included: music licences.'), label: doc.filter(t => /^Paid /.test(t) || /payment link$/.test(t)), widest: Math.max(...doc.filter(t => /^Paid /.test(t)).map(t => pdf.textWidth(t, 9))) }; }));
  ok('the PDF writes ₹, zł, Kč and French thousands as readable amounts, and Central European names without a “?”', pdfFix.amounts.slice(0, 5).join(' | ') === 'Rs 25,000.00 | zl 65 000,00 | Kc 65 000,00 | €25 000,00 | Zdjecia slubne, Walesa Studio, Dvorák & Sahin, Istanbul, Gyor, Škoda', JSON.stringify(pdfFix.amounts));
  ok('the PDF keeps the lines of the From address and of the notes apart', pdfFix.from && pdfFix.notes, JSON.stringify(pdfFix));
  ok('in the PDF a long payment label is wrapped into its own column, clear of the amount', pdfFix.label.length === 2 && pdfFix.widest <= 119, JSON.stringify(pdfFix.label) + ' ' + Math.round(pdfFix.widest) + ' pt');
  // The saved web page has the bank QR in it; the print from the app follows each Pay button with its address
  await page.evaluate(() => window.logiGo('bookings')); await sleep(200);
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking(window.__b, { view: 'money', kind: 'invoice' }))); await page.waitForSelector('.money-page .cs-paper .pay-qr svg');
  const [web] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('.money-page button:has-text("Web page")').click()]);
  const webText = fs.readFileSync(await web.path(), 'utf8');
  ok('“Web page” of an invoice saves the bank QR code with its caption, not an empty box', /class="pay-qr"><div class="qr-box"[^>]*><svg/.test(webText) && /Scan with your banking app/.test(webText), (webText.match(/class="pay-qr">.{0,80}/) || ['no QR box'])[0]);
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('.money-page button:has-text("Print")').click(); await page.waitForSelector('#print-root .pay-btn', { state: 'attached' }); await sleep(200);
  await page.emulateMedia({ media: 'print' });
  const printed = await page.evaluate(() => { const a = document.querySelector('#print-root .pay-btn'); return { after: getComputedStyle(a, '::after').content, href: a.getAttribute('href'), qr: !!document.querySelector('#print-root .pay-qr svg') }; });
  await page.emulateMedia({ media: null }); await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  ok('printed from the app, a Pay button is followed by its address, and the bank QR is on the paper', printed.after.includes(printed.href) && printed.qr, JSON.stringify(printed));
  // The client's page on a 360-pixel phone, and a second link opened in the same tab
  const twoLinks = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(async ([s, m]) => { const doc = lines => ({ number: 'INV-0200', date: '2026-11-01', due: '2026-11-10', status: 'Sent', taxRate: 0, taxLabel: 'VAT', lines });
    s.upsert('bookings', { id: 'mn-l', title: 'Link probe', client: 'Probe Client', date: '2026-12-01', status: 'Delivered', crew: [], gear: [], stakeholders: [], invoice: doc([{ id: 'a', desc: 'Filming day', qty: 9, unit: 'day', price: 1200 }]) }); const first = await m.shareLink(s.byId('bookings', 'mn-l'), 'invoice');
    s.upsert('bookings', { ...s.byId('bookings', 'mn-l'), invoice: doc([{ id: 'a', desc: 'Filming day', qty: 9, unit: 'day', price: 1200 }, { id: 'b', desc: 'Extras', qty: 5, unit: 'each', price: 50 }]) }); const second = await m.shareLink(s.byId('bookings', 'mn-l'), 'invoice');
    s.upsert('bookings', { ...s.byId('bookings', 'mn-l'), invoice: doc([{ id: 'c', desc: 'Refund of overcharge', qty: 1, unit: 'each', price: -150 }]) }); const credit = await m.shareLink(s.byId('bookings', 'mn-l'), 'invoice'); return { first, second, credit }; }));
  const phone = await ctx.newPage(); await phone.setViewportSize({ width: 360, height: 800 });
  await phone.goto(twoLinks.first); await phone.waitForSelector('.paper .cs-doc');
  const narrow = await phone.evaluate(() => { const paper = document.querySelector('.paper'), box = paper.getBoundingClientRect(), cells = [...paper.querySelectorAll('th.num, td.num')]; const range = document.createRange(), out = cells.filter(c => { range.selectNodeContents(c); return range.getBoundingClientRect().right > box.right + 0.5; }).map(c => c.textContent);
    return { cut: out, scrolls: getComputedStyle(paper).overflowX === 'auto' || getComputedStyle(paper).overflowX === 'scroll', page: document.documentElement.scrollWidth <= innerWidth, due: document.querySelector('.tag').textContent }; });
  ok('on a 360-pixel phone the client’s invoice shows the whole Amount column, or lets the sheet scroll sideways to it; the page itself never scrolls sideways', (narrow.cut.length === 0 || narrow.scrolls) && narrow.page, JSON.stringify(narrow));
  ok('the client’s page gives the due date with its year', /2026/.test(narrow.due), narrow.due);
  await phone.goto(twoLinks.second); await phone.waitForFunction(() => /11,050\.00/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
  const second = await phone.evaluate(() => (document.querySelector('.tag') || {}).textContent || '');
  ok('a second invoice link opened in the same tab shows that invoice, not the one before it', /11,050\.00 due/.test(second), second);
  await phone.goto(twoLinks.credit); await phone.waitForFunction(() => /Refund of overcharge/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
  const creditTag = await phone.evaluate(() => (document.querySelector('.tag') || {}).textContent || '');
  ok('the client’s page of a credit note says there is nothing to pay, not that it is overdue', creditTag === 'Nothing to pay', creditTag);
  await phone.close();
  // A number that went out is not given again; a deleted invoice leaves its time behind for the sync
  const numbers = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const out = { before: m.nextNumber('invoice') }; m.editMoney(s.byId('bookings', 'mn-p'), 'invoice'); return out; }));
  await pform.waitFor(); await pform.getByRole('button', { name: 'Delete' }).click(); await sleep(400);
  const afterDelete = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const b = s.byId('bookings', 'mn-p'), out = { gone: !b.invoice, mark: b.invoiceGoneAt > 0, next: m.nextNumber('invoice') }; s.remove('bookings', 'mn-p'); s.remove('bookings', 'mn-l'); out.afterBooking = m.nextNumber('invoice'); return out; }));
  // (INV-0100 went out above; INV-0200 was only ever written by this spec, straight into the store, so it is free again)
  ok('an invoice number that went out is not proposed again after the invoice, or its booking, is deleted', numbers.before === 'INV-0201' && afterDelete.next === 'INV-0201' && afterDelete.afterBooking === 'INV-0101', JSON.stringify([numbers, afterDelete]));
  ok('deleting an invoice leaves the time it was deleted on the booking, so a sync does not bring it back', afterDelete.gone && afterDelete.mark, JSON.stringify(afterDelete));
  const policy = await (await page.goto(BASE + 'privacy.html')).text();
  ok('the privacy policy explains invoice links', /inside the link itself/i.test(policy));
  ok('no page errors or CSP violations', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

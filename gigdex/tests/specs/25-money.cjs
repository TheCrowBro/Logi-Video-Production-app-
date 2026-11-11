// Money: billing settings and the price list, a show's invoice from the booking (tax, deposit, payments, the paid
// tick), a quote turned into an invoice, a session's invoice from its hours, the client's link and page, costs that
// change the settlement, and the Money page with its CSV exports. The blocks are drawn on their own (not through the
// booking page) so this spec does not depend on the Bookings feature.
const { open, ok, sleep, go, topSheet } = require('../helpers.cjs');
const fs = require('fs');

// Draws a block (or a settings panel) into a box of its own under the page, again after every change.
async function mount(page, what, bookingId) {
  await page.evaluate(async ([what, bookingId]) => {
    const [store, util] = await Promise.all([import('./js/store.js'), import('./js/util.js')]);
    const blk = what === 'billing' || what === 'prices' ? null : (await import(`./js/blocks/${what}.js`)).default;
    const money = await import('./js/money.js');
    document.getElementById('mn-test')?.remove();
    document.getElementById('page').hidden = true;
    const root = util.h('div', { id: 'mn-test' });
    document.getElementById('app').append(root);
    const draw = () => {
      if (!blk) { root.replaceChildren(what === 'billing' ? money.billingPanel() : money.priceListPanel()); return; }
      const b = store.byId('bookings', bookingId);
      root.replaceChildren(util.h('details', { class: 'blk', id: 'blk-' + what, open: true }, util.h('summary', { id: 'mn-test-summary' }, b ? blk.summary(b) : ''), b ? blk.render(b, { sym: '$', open: () => {} }) : util.h('p', null, 'gone')));
    };
    if (window.__mnUnsub) window.__mnUnsub();
    window.__mnUnsub = blk ? store.subscribe(() => queueMicrotask(draw)) : null;
    draw();
  }, [what, bookingId]);
  await sleep(120);
}
async function unmount(page) { await page.evaluate(() => { if (window.__mnUnsub) window.__mnUnsub(); window.__mnUnsub = null; document.getElementById('mn-test')?.remove(); document.getElementById('page').hidden = false; }); }
const dbNow = page => page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db))));
const booking = async (page, id) => (await dbNow(page)).bookings.find(b => b.id === id);
const summary = page => page.locator('#mn-test-summary').innerText();
async function setField(page, sel, value) { const l = page.locator(sel); await l.fill(String(value)); await l.dispatchEvent('change'); await sleep(60); }
async function submitTop(page) { await topSheet(page).locator('button[type=submit]').click(); await sleep(200); }

(async () => {
  const { browser, ctx, page, errors } = await open({ sample: true, tab: 'money' });

  /* ---------------- billing settings ---------------- */
  await mount(page, 'billing');
  ok('billing panel shows the numbering', await page.locator('#mn-bl-invoicePrefix').isVisible());
  await setField(page, '#mn-bl-invoicePrefix', 'GIG-');
  await setField(page, '#mn-bl-nextInvoice', 7);
  await setField(page, '#mn-bl-taxName', 'VAT');
  await setField(page, '#mn-bl-taxRate', 20);
  await setField(page, '#mn-bl-dueDays', 30);
  await setField(page, '#mn-bl-paypal', 'https://paypal.me/nightowls/');
  await setField(page, '#mn-bl-venmo', '@owls');
  await setField(page, '#mn-bl-accountName', 'The Night Owls');
  await setField(page, '#mn-bl-iban', 'DE89 3704 0044 0532 0130 00');
  await setField(page, '#mn-bl-payLink', 'javascript:alert(1)');
  await setField(page, '#mn-bl-payNote', 'Thanks for having us!');
  await setField(page, '#mn-bl-revolut', 'https://monzo.me/nightowls');
  await setField(page, '#mn-bl-taxRate', 150); // out of range: refused
  let d = await dbNow(page);
  ok('billing settings are saved', d.billing.invoicePrefix === 'GIG-' && d.billing.nextInvoice === 7 && d.billing.taxName === 'VAT' && d.billing.dueDays === 30 && d.billing.paypal === 'https://paypal.me/nightowls/' && d.billing.payNote === 'Thanks for having us!', JSON.stringify(d.billing));
  ok('a tax rate over 100% is refused', d.billing.taxRate === 20, String(d.billing.taxRate));
  ok('a payment link that is not https is refused', !d.billing.payLink, d.billing.payLink);
  // A cleared "Next invoice number" would start the numbers again at 1 and hand out a deleted invoice's number.
  await setField(page, '#mn-bl-nextInvoice', '');
  d = await dbNow(page);
  ok('a blank next invoice number is refused', d.billing.nextInvoice === 7 && (await page.inputValue('#mn-bl-nextInvoice')) === '7', JSON.stringify(d.billing.nextInvoice));
  const afterBlank = await page.evaluate(() => import('./js/money.js').then(m => m.nextNumber('invoice', { billing: { invoicePrefix: 'Z-', nextInvoice: '' }, bookings: [{ invoice: { number: 'Z-0002' } }] }).number));
  ok('with no counter, numbering carries on past the highest number in use', afterBlank === 'Z-0003', afterBlank);
  await mount(page, 'billing');
  ok('the next numbers are shown', /GIG-0007/.test(await page.locator('#mn-bl-next').innerText()) && /Q-0001/.test(await page.locator('#mn-bl-next').innerText()));

  /* ---------------- the price list ---------------- */
  await mount(page, 'prices');
  ok('the price list starts empty with ideas', (await page.locator('.mn-prices .price-item').count()) === 0 && (await page.locator('.mn-ideas .chip').count()) >= 10);
  await page.locator('.mn-ideas .chip', { hasText: 'Studio time' }).click();
  await page.waitForSelector('.sheet[aria-label="Add to the price list"]');
  ok('an idea comes with its words and no price', (await topSheet(page).locator('[data-key=desc]').inputValue()) === 'Studio time' && (await topSheet(page).locator('[data-key=price]').inputValue()) === '');
  await topSheet(page).locator('[data-key=price]').fill('60');
  await submitTop(page);
  await page.locator('.mn-ideas .chip', { hasText: 'Mixing' }).click();
  await page.waitForSelector('.sheet[aria-label="Add to the price list"]');
  await topSheet(page).locator('[data-key=price]').fill('150');
  await submitTop(page);
  d = await dbNow(page);
  const pl = (d.priceList && d.priceList.list) || [];
  ok('price list lines are stored', pl.length === 2 && pl.some(i => i.desc === 'Studio time' && i.unit === 'hour' && i.price === 60) && pl.some(i => i.desc === 'Mixing' && i.unit === 'song' && i.price === 150), JSON.stringify(pl));

  /* ---------------- a show's invoice from the booking ---------------- */
  await mount(page, 'money', 's-show1');
  ok('a show with no invoice offers to make one', await page.locator('#mn-make-invoice').isVisible());
  const preview = await page.locator('.mn-suggest').innerText();
  ok('the suggestion is the performance fee and the deposit', /Performance: The Night Owls at The Lantern Rooms/.test(preview) && /\$250/.test(preview) && /Deposit received/.test(preview), preview);
  await page.click('#mn-make-invoice');
  await page.waitForSelector('#mn-edit-invoice');
  let b = await booking(page, 's-show1');
  const today = await page.evaluate(() => import('./js/util.js').then(u => u.todayISO()));
  const in30 = await page.evaluate(t => { const [y, m, dd] = t.split('-').map(Number); const x = new Date(y, m - 1, dd + 30); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }, today);
  ok('the invoice takes the next number', b.invoice && b.invoice.number === 'GIG-0007', b.invoice && b.invoice.number);
  ok('the counter moves on', (await dbNow(page)).billing.nextInvoice === 8);
  ok('the invoice has the fee line', b.invoice.lines.length === 1 && b.invoice.lines[0].price === 250 && b.invoice.lines[0].qty === 1 && b.invoice.lines[0].unit === 'show', JSON.stringify(b.invoice.lines));
  ok('the deposit paid is a payment', b.invoice.payments.length === 1 && b.invoice.payments[0].amount === 100 && b.invoice.payments[0].method === 'Deposit received');
  ok('tax and terms come from billing', b.invoice.taxRate === 20 && b.invoice.taxName === 'VAT' && b.invoice.issued === today && b.invoice.due === in30 && b.invoice.status === 'draft', `${b.invoice.due} vs ${in30}`);
  let tot = await page.evaluate(() => import('./js/money.js').then(async m => m.docTotals((await import('./js/store.js')).byId('bookings', 's-show1').invoice)));
  ok('totals with tax', tot.net === 250 && tot.tax === 50 && tot.total === 300 && tot.paid === 100 && tot.due === 200, JSON.stringify(tot));
  const stats = await page.locator('.mn-doc-stats').innerText();
  ok('the box shows total, paid and due', /\$300/.test(stats) && /\$100/.test(stats) && /\$200/.test(stats), stats.replace(/\n/g, ' '));
  ok('summary of a draft', /Invoice GIG-0007 · draft · \$300/.test(await summary(page)), await summary(page));

  await page.click('#mn-sent-invoice');
  await sleep(250);
  b = await booking(page, 's-show1');
  ok('marking it sent stamps it and ticks "Invoice sent"', b.invoice.status === 'sent' && b.invoice.sentAt > 0 && b.checks['show-invoice'] === true);
  ok('summary of a sent invoice', /Invoice GIG-0007 · \$200 due/.test(await summary(page)), await summary(page));

  // A part payment, then the rest.
  await page.click('#mn-pay');
  await page.waitForSelector('.sheet[aria-label="Record a payment"]');
  ok('the payment form starts with the amount due', (await topSheet(page).locator('[data-key=amount]').inputValue()) === '200');
  await topSheet(page).locator('[data-key=amount]').fill('150');
  await submitTop(page);
  b = await booking(page, 's-show1');
  ok('a part payment is recorded', b.invoice.payments.length === 2 && b.invoice.payments[1].amount === 150 && b.invoice.status === 'sent' && !b.checks['show-paid']);
  ok('the balance shows', /\$50 due/.test(await summary(page)), await summary(page));
  await page.click('#mn-pay');
  await page.waitForSelector('.sheet[aria-label="Record a payment"]');
  await submitTop(page);
  b = await booking(page, 's-show1');
  ok('paid in full: status and the "Paid in full" tick', b.invoice.status === 'paid' && b.invoice.paidAt > 0 && b.checks['show-paid'] === true, JSON.stringify({ s: b.invoice.status, c: b.checks }));
  ok('summary of a paid invoice', /Invoice GIG-0007 · paid/.test(await summary(page)), await summary(page));
  ok('no Record a payment when nothing is due', (await page.locator('#mn-pay').count()) === 0);
  // Taking the last payment off opens the balance again and unticks "Paid in full".
  await page.locator('.mn-payment button[aria-label^="Remove the payment of $50"]').click();
  await sleep(250);
  b = await booking(page, 's-show1');
  ok('removing a payment reopens the invoice', b.invoice.status === 'sent' && b.invoice.payments.length === 2 && !b.checks['show-paid'] && b.checks['show-invoice'] === true);

  // Edit the lines: add an extra set.
  await page.click('#mn-edit-invoice');
  await page.waitForSelector('.sheet[aria-label="Edit the invoice"]');
  await page.click('#mn-ed-addline');
  await page.fill('#mn-l2-desc', 'Extra set');
  await page.fill('#mn-l2-qty', '1');
  await page.fill('#mn-l2-unit', 'set');
  await page.fill('#mn-l2-price', '100');
  const live = await page.locator('.mn-ed-totals').innerText();
  ok('the editor adds up as you type', /\$350/.test(live) && /\$70/.test(live) && /\$420/.test(live), live.replace(/\n/g, ' '));
  await page.click('.sheet[aria-label="Edit the invoice"] button[type=submit]');
  await sleep(250);
  b = await booking(page, 's-show1');
  tot = await page.evaluate(() => import('./js/money.js').then(async m => m.docTotals((await import('./js/store.js')).byId('bookings', 's-show1').invoice)));
  ok('the edited invoice is saved', b.invoice.lines.length === 2 && b.invoice.lines[1].desc === 'Extra set' && b.invoice.lines[1].price === 100 && tot.total === 420 && tot.due === 170, JSON.stringify(tot));
  // Pick from the price list inside the editor, then cancel: nothing changes.
  await page.click('#mn-edit-invoice');
  await page.waitForSelector('.sheet[aria-label="Edit the invoice"]');
  await page.click('#mn-ed-fromlist');
  await page.waitForSelector('.sheet[aria-label="Add from the price list"]');
  await topSheet(page).locator('label', { hasText: 'Mixing' }).locator('input').check();
  await page.click('#mn-pick-add');
  await sleep(150);
  ok('a picked line lands in the editor', (await page.locator('.mn-line').count()) === 3 && (await page.inputValue('#mn-l3-desc')) === 'Mixing');
  await page.locator('.sheet[aria-label="Edit the invoice"] .form-actions button', { hasText: 'Cancel' }).click();
  await sleep(150);
  ok('Cancel leaves the invoice as it was', (await booking(page, 's-show1')).invoice.lines.length === 2);

  // The email to the client carries the link.
  await page.waitForFunction(() => (document.getElementById('mn-email-invoice') || {}).href?.includes('invoice.html'), null, { timeout: 8000 }).catch(() => {});
  const mail = await page.getAttribute('#mn-email-invoice', 'href');
  ok('Email the client is addressed to the contact with the link', mail.startsWith('mailto:rosa@example.com?') && /invoice\.html%23/.test(mail) && /GIG-0007/.test(decodeURIComponent(mail)), mail.slice(0, 120));

  /* ---------------- the client's link and page ---------------- */
  await page.click('#mn-link-invoice');
  await page.waitForSelector('#mn-link-text');
  const url = await page.inputValue('#mn-link-text');
  ok('the link points at invoice.html with the document after #', /\/invoice\.html#1\./.test(url) || /\/invoice\.html#0\./.test(url), url.slice(0, 80));
  await page.keyboard.press('Escape');
  const client = await ctx.newPage();
  const clientErrors = [];
  client.on('pageerror', e => clientErrors.push(e.message));
  client.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) clientErrors.push(m.text()); });
  await client.goto(url);
  await client.waitForSelector('.money-doc');
  ok('the client page opens the invoice', /Invoice GIG-0007/.test(await client.title()));
  const totals = await client.locator('.money-totals').innerText();
  ok('the client sees the right total and balance', /\$420\.00/.test(totals) && /\$170\.00/.test(totals), totals.replace(/\n/g, ' '));
  const pays = await client.locator('a.pay-btn').evaluateAll(as => as.map(a => [a.dataset.pay, a.getAttribute('href')]));
  const pp = pays.find(p => p[0] === 'paypal'), vm = pays.find(p => p[0] === 'venmo');
  ok('a PayPal button with the amount', pp && pp[1] === 'https://paypal.me/nightowls/170.00USD', JSON.stringify(pays));
  const mz = pays.find(p => p[0] === 'monzo');
  ok('a Monzo button with the amount and the reference', mz && mz[1] === 'https://monzo.me/nightowls/170.00?d=GIG-0007', mz && mz[1]);
  ok('a Venmo button with the amount and the invoice number', vm && vm[1] === 'https://venmo.com/owls?txn=pay&amount=170.00&note=GIG-0007', vm && vm[1]);
  ok('a payment link that is not https is left out', pays.every(p => /^https:/.test(p[1])));
  ok('bank details are on the invoice', /IBAN: DE89/.test(await client.locator('.pay-sec').innerText()));
  await client.waitForSelector('.pay-qr svg', { timeout: 8000 }).catch(() => {});
  ok('the bank QR is drawn', (await client.locator('.pay-qr svg').count()) === 1);
  ok('the bar shows the balance due', /\$170\.00 due/.test(await client.locator('#bar').innerText()));
  ok('the payment note is there', /Thanks for having us!/.test(await client.locator('.pay-sec').innerText()));
  await client.click('#pay-jump');
  await sleep(200);
  ok('Pay jumps to the buttons without losing the document', /#1\.|#0\./.test(client.url()) && (await client.locator('.money-doc').count()) === 1);
  ok('the client page has no console errors', clientErrors.length === 0, clientErrors.join(' | '));
  // A forged link: only the fields the page knows, as plain text; a broken link says so.
  const forged = await page.evaluate(() => import('./js/link-pack.js').then(m => m.pack({ kind: 'invoice', number: 'X-1', status: 'paid', title: '<img src=x onerror=alert(1)>', lines: [{ desc: 'Thing', qty: 1, price: 10 }], pay: { payLink: 'javascript:alert(1)', paypal: 'evil' }, extra: 'ignored' })));
  await client.goto('about:blank');
  await client.goto(url.split('#')[0] + '#' + forged);
  await client.waitForSelector('.money-doc');
  ok('a forged link shows its text as text', (await client.locator('.money-doc img').count()) === 0 && /<img src=x/.test(await client.locator('.money-doc h2').innerText()));
  ok('a paid invoice shows the stamp and no Pay buttons', (await client.locator('.paid-stamp').count()) === 1 && (await client.locator('a.pay-btn').count()) === 0);
  await client.goto('about:blank');
  await client.goto(url.split('#')[0] + '#1.not-a-document');
  await client.waitForSelector('.msg');
  ok('a broken link says so', /does not open a document/.test(await client.locator('.msg').innerText()));
  await client.close();

  /* ---------------- a quote that becomes the invoice ---------------- */
  await mount(page, 'money', 's-show2');
  await page.click('#mn-tab-quote');
  await page.waitForSelector('#mn-make-quote');
  await page.click('#mn-make-quote');
  await page.waitForSelector('#mn-edit-quote');
  b = await booking(page, 's-show2');
  ok('the quote takes its own number', b.quote && b.quote.number === 'Q-0001' && b.quote.lines[0].price === 800, JSON.stringify(b.quote && b.quote.lines));
  ok('the quote mentions the deposit still to pay', /Deposit: \$400\.00/.test(b.quote.notes), b.quote.notes);
  await page.click('#mn-sent-quote'); await sleep(200);
  await page.click('#mn-accepted'); await sleep(200);
  b = await booking(page, 's-show2');
  ok('the quote is accepted', b.quote.status === 'accepted' && b.quote.acceptedAt > 0);
  ok('summary of a quote', /Quote accepted · \$960/.test(await summary(page)), await summary(page));
  await page.click('#mn-quote-to-invoice');
  await page.waitForSelector('#mn-edit-invoice');
  b = await booking(page, 's-show2');
  ok('the invoice is made from the quote', b.invoice && b.invoice.number === 'GIG-0008' && b.invoice.lines.length === 1 && b.invoice.lines[0].price === 800 && b.invoice.lines[0].id !== b.quote.lines[0].id);
  ok('the box switches to the invoice', (await page.getAttribute('#mn-tab-invoice', 'aria-selected')) === 'true');
  // Deleting it never frees its number, and a sent invoice deleted takes its "Invoice sent" tick with it.
  await page.click('#mn-sent-invoice'); await sleep(200);
  ok('the invoice made from the quote is sent', (await booking(page, 's-show2')).checks['show-invoice'] === true);
  await page.click('#mn-edit-invoice');
  await page.waitForSelector('.sheet[aria-label="Edit the invoice"]');
  await page.locator('.sheet[aria-label="Edit the invoice"] .btn.danger').click();
  await sleep(250);
  b = await booking(page, 's-show2');
  ok('an invoice can be deleted', !b.invoice);
  ok('deleting a sent invoice unticks "Invoice sent" and "Paid in full"', !b.checks['show-invoice'] && !b.checks['show-paid'], JSON.stringify(b.checks));
  await page.click('#mn-make-from-quote');
  await sleep(250);
  ok('its number is not used again', (await booking(page, 's-show2')).invoice.number === 'GIG-0009');

  /* ---------------- a session's invoice from its hours ---------------- */
  const hours = await page.evaluate(() => import('./js/clock.js').then(m => Number(m.clockHours('s-sess0')) || 0));
  const want = hours > 0 ? Math.round(hours * 4) / 4 : 6;
  await mount(page, 'money', 's-sess0');
  await page.click('#mn-make-invoice');
  await page.waitForSelector('#mn-edit-invoice');
  b = await booking(page, 's-sess0');
  ok('a session invoice bills the studio hours', b.invoice.lines[0].qty === want && b.invoice.lines[0].price === 45 && b.invoice.lines[0].unit === 'hour' && /Studio time at Echo Chamber Studios/.test(b.invoice.lines[0].desc), JSON.stringify(b.invoice.lines[0]) + ' clock ' + hours);
  tot = await page.evaluate(() => import('./js/money.js').then(async m => m.docTotals((await import('./js/store.js')).byId('bookings', 's-sess0').invoice)));
  ok('the session total is hours × rate plus tax', Math.abs(tot.net - want * 45) < 0.001 && Math.abs(tot.total - want * 45 * 1.2) < 0.001, JSON.stringify(tot));
  await page.click('#mn-sent-invoice'); await sleep(200);
  ok('sending a session invoice ticks "Invoice sent"', (await booking(page, 's-sess0')).checks['ses-invoice'] === true);
  // Past its due date: the box says so and the email becomes a reminder.
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.id === 's-sess0'); const t = new Date(Date.now() - 5 * 864e5); x.invoice.due = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; })));
  await page.waitForFunction(() => decodeURIComponent((document.getElementById('mn-email-invoice') || {}).href || '').includes('Reminder: invoice'), null, { timeout: 8000 }).catch(() => {});
  const remind = decodeURIComponent(await page.getAttribute('#mn-email-invoice', 'href'));
  ok('an overdue invoice is emailed as a reminder', /Reminder: invoice GIG-0010/.test(remind) && /still open/.test(remind) && /Send a reminder/.test(await page.locator('#mn-email-invoice').innerText()), remind.slice(0, 160));
  ok('the box shows it is overdue', (await page.locator('.mn-doc .warn').count()) === 1 && /Overdue/.test(await page.locator('.mn-doc-id .pill').innerText()) && /overdue/.test(await summary(page)));
  await mount(page, 'money', 's-sess1');
  const sessPreview = await page.locator('.mn-suggest').innerText();
  ok('session players are suggested at their rate', /Session player: Marcus Bell \(Guitar\)/.test(sessPreview) && /\$180/.test(sessPreview), sessPreview);
  // A late session past midnight, with no act or venue.
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-late', kind: 'session', status: 'confirmed', date: '2026-11-20', start: '22:00', end: '02:00', rate: 50, rateUnit: 'hour' })));
  await mount(page, 'money', 't-late');
  const late = await page.locator('.mn-suggest').innerText();
  ok('a session past midnight counts its hours', /4 hours/.test(late) && /\$200/.test(late) && /^Studio time, /.test(late.trim()), late);
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-other', kind: 'other', status: 'confirmed', date: '2026-11-21', title: 'Guitar lesson' })));
  await mount(page, 'money', 't-other');
  ok('a booking with no fee says to type it in', /no price yet/.test(await page.locator('.mn-suggest').innerText()) && /no fee/.test(await page.locator('.mn-make').innerText()));
  // A block of three studio days with no clock: the planned hours of every day, as its fee counts them.
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-block', kind: 'session', status: 'confirmed', date: '2026-12-01', endDate: '2026-12-03', start: '10:00', end: '18:00', venueId: 's-echo', rate: 45, rateUnit: 'hour', people: ['s-marcus'] })));
  await mount(page, 'money', 't-block');
  const block = await page.locator('.mn-suggest').innerText();
  ok('a block of studio days bills the planned hours of every day', /Studio time at Echo Chamber Studios/.test(block) && /24 hours/.test(block) && /\$1,080/.test(block) && /3 days/.test(block) && /\$540/.test(block), block.replace(/\n/g, ' '));
  // A settled show: the deposit and what the promoter handed over on the night both come off, so the invoice asks
  // only for what the settlement says is still owed; the deposit is dated no later than the show.
  await mount(page, 'money', 's-past');
  const pastText = await page.locator('.mn-suggest').innerText();
  const past = await page.evaluate(() => Promise.all([import('./js/money.js'), import('./js/model.js'), import('./js/store.js')]).then(([mn, m, s]) => {
    const b = s.byId('bookings', 's-past'), sg = mn.suggestLines(b, 'invoice');
    return { date: b.date, short: m.settle(b).short, due: mn.calc({ lines: sg.lines, payments: sg.payments, status: 'sent' }).due, pays: sg.payments.map(p => [p.method, p.amount, p.date]) };
  }));
  ok('a settled show\'s invoice takes off what was received on the night', /Received on the night/.test(pastText) && /\$1,338/.test(pastText) && past.short > 0 && Math.abs(past.due - past.short) < 0.005, JSON.stringify(past));
  ok('the deposit received is dated no later than the show', past.pays.some(p => p[0] === 'Deposit received' && p[1] === 100 && p[2] === past.date), JSON.stringify(past.pays));
  // An invoice the payments had paid in full opens again when an edit raises its total.
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-paid', kind: 'session', status: 'done', date: '2026-11-02', rate: 500, rateUnit: 'flat', checks: { 'ses-invoice': true, 'ses-paid': true },
    invoice: { number: 'T-0001', status: 'paid', issued: '2026-11-02', due: '2026-11-16', taxRate: 0, taxName: 'Tax', lines: [{ id: 'l1', desc: 'Studio session', qty: 1, unit: 'session', price: 500 }], payments: [{ id: 'p1', date: '2026-11-03', amount: 500, method: 'Cash' }], sentAt: 1, paidAt: 1 } })));
  await mount(page, 'money', 't-paid');
  await page.click('#mn-edit-invoice');
  await page.waitForSelector('.sheet[aria-label="Edit the invoice"]');
  const edTotals = await page.locator('.mn-ed-totals').innerText();
  ok('the editor\'s totals have no stray words', !/false/.test(edTotals) && /Paid so far/.test(edTotals), edTotals.replace(/\n/g, ' '));
  await page.click('#mn-ed-addline');
  await page.fill('#mn-l2-desc', 'Extra hour');
  await page.fill('#mn-l2-price', '200');
  await page.click('.sheet[aria-label="Edit the invoice"] button[type=submit]');
  await sleep(250);
  b = await booking(page, 't-paid');
  tot = await page.evaluate(() => import('./js/money.js').then(async m => m.docTotals((await import('./js/store.js')).byId('bookings', 't-paid').invoice)));
  ok('raising a paid invoice\'s total opens it again', b.invoice.status === 'sent' && !b.invoice.paidAt && tot.total === 700 && tot.due === 200 && !b.checks['ses-paid'] && b.checks['ses-invoice'] === true, JSON.stringify({ s: b.invoice.status, tot, c: b.checks }));
  // One marked paid by hand without the payments to match (a discount agreed, say) stays paid when saved.
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(r => r.id === 't-paid'); x.invoice = { ...x.invoice, status: 'paid', paidAt: 1 }; })));
  await page.click('#mn-edit-invoice');
  await page.waitForSelector('.sheet[aria-label="Edit the invoice"]');
  await page.click('.sheet[aria-label="Edit the invoice"] button[type=submit]');
  await sleep(250);
  ok('an invoice marked paid by hand stays paid', (await booking(page, 't-paid')).invoice.status === 'paid');

  /* ---------------- costs ---------------- */
  await mount(page, 'budget', 's-show1');
  const before = await page.evaluate(() => import('./js/model.js').then(async m => m.settle((await import('./js/store.js')).byId('bookings', 's-show1')).costs));
  ok('costs show the booking\'s lines', (await page.locator('.mn-cost').count()) === 1 && /\$120 costs/.test(await summary(page)));
  await page.click('#mn-cost-add');
  await page.waitForSelector('.sheet[aria-label="Add a cost"]');
  await topSheet(page).locator('select').selectOption('Fuel');
  await topSheet(page).locator('[data-key=desc]').fill('Diesel');
  await topSheet(page).locator('[data-key=amount]').fill('45.5');
  await submitTop(page);
  b = await booking(page, 's-show1');
  const added = b.budget.find(c => c.desc === 'Diesel');
  ok('a cost is stored in the budget shape', added && Object.keys(added).sort().join() === 'amount,cat,desc,id' && added.cat === 'Fuel' && added.amount === 45.5, JSON.stringify(added));
  const after = await page.evaluate(() => import('./js/model.js').then(async m => m.settle((await import('./js/store.js')).byId('bookings', 's-show1')).costs));
  ok('the settlement counts the new cost', Math.abs(after - before - 45.5) < 0.001, `${before} → ${after}`);
  ok('the summary adds it up', /\$165\.50 costs/.test(await summary(page)), await summary(page));
  const profitText = await page.locator('.mn-cost-stats').innerText();
  const expectProfit = await page.evaluate(() => import('./js/model.js').then(async m => { const b = (await import('./js/store.js')).byId('bookings', 's-show1'); return m.fmtMoney(m.bookingIncome(b) - (b.budget || []).reduce((s, c) => s + Number(c.amount || 0), 0)); }));
  ok('expected profit against the income (the invoice, once there is one)', profitText.includes(expectProfit), profitText.replace(/\n/g, ' ') + ' — expected ' + expectProfit);
  await page.click('#mn-cost-suggest');
  await page.waitForSelector('.sheet[aria-label="Costs from the booking"]');
  ok('crew on the booking are suggested at their rate', /Dee Okafor, FOH engineer: \$200/.test(await topSheet(page).innerText()));
  await page.click('#mn-cost-pick-add');
  await sleep(200);
  b = await booking(page, 's-show1');
  ok('suggested costs are added', b.budget.some(c => c.cat === 'Crew' && c.amount === 200) && b.budget.length === 3);
  ok('nothing left to suggest', (await page.locator('#mn-cost-suggest').count()) === 0);
  // Hourly costs on a block of studio days cover every day, as the day rates on the same sheet do.
  await mount(page, 'budget', 't-block');
  await page.click('#mn-cost-suggest');
  await page.waitForSelector('.sheet[aria-label="Costs from the booking"]');
  const blockCosts = await topSheet(page).innerText();
  ok('studio hire on a block of days counts every day', /Studio hire: Echo Chamber Studios: \$1,080/.test(blockCosts) && /24 hours × \$45/.test(blockCosts) && /Marcus Bell, Session musician: \$540/.test(blockCosts), blockCosts.replace(/\n/g, ' '));
  await topSheet(page).locator('.form-actions button', { hasText: 'Cancel' }).click();
  await sleep(150);
  await page.evaluate(() => import('./js/store.js').then(s => { s.remove('bookings', 't-block'); s.remove('bookings', 't-paid'); }));
  await mount(page, 'budget', 's-show1');
  await page.locator('.mn-cost', { hasText: 'Diesel' }).click();
  await page.waitForSelector('.sheet[aria-label="Edit cost"]');
  await topSheet(page).locator('.btn.danger').click();
  await sleep(200);
  ok('a cost can be removed', !(await booking(page, 's-show1')).budget.some(c => c.desc === 'Diesel'));
  // A cost on the settled show changes what it made.
  await mount(page, 'budget', 's-past');
  const pastBefore = await page.evaluate(() => import('./js/model.js').then(async m => m.settle((await import('./js/store.js')).byId('bookings', 's-past')).profit));
  await page.click('#mn-cost-add');
  await page.waitForSelector('.sheet[aria-label="Add a cost"]');
  await topSheet(page).locator('select').selectOption('Van hire');
  await topSheet(page).locator('[data-key=amount]').fill('80');
  await submitTop(page);
  const pastAfter = await page.evaluate(() => import('./js/model.js').then(async m => m.settle((await import('./js/store.js')).byId('bookings', 's-past')).profit));
  ok('a cost lowers the settled show\'s profit', Math.abs(pastBefore - pastAfter - 80) < 0.001, `${pastBefore} → ${pastAfter}`);
  await unmount(page);

  /* ---------------- the Money page ---------------- */
  await go(page, 'bookings'); await go(page, 'money');
  await page.waitForSelector('.mn-stats');
  const expect = await page.evaluate(async () => {
    const [m, s, mn] = await Promise.all([import('./js/model.js'), import('./js/store.js'), import('./js/money.js')]);
    const Y = new Date().getFullYear() + '';
    const live = s.db.bookings.filter(b => b.status !== 'cancelled' && (b.date || '').startsWith(Y));
    const earned = live.filter(b => b.status === 'done' || b.status === 'settled').reduce((t, b) => t + m.bookingIncome(b), 0);
    const unpaid = s.db.bookings.filter(b => b.invoice && b.invoice.status === 'sent').reduce((t, b) => t + mn.docTotals(b.invoice).due, 0);
    return { earned: m.fmtMoney(earned), unpaid: m.fmtMoney(unpaid), Y };
  });
  ok('earned this year from done and settled bookings', (await page.locator('#mn-stat-earned b').innerText()) === expect.earned, `${await page.locator('#mn-stat-earned b').innerText()} vs ${expect.earned}`);
  ok('unpaid invoices are added up', (await page.locator('#mn-stat-unpaid b').innerText()) === expect.unpaid, `${await page.locator('#mn-stat-unpaid b').innerText()} vs ${expect.unpaid}`);
  const unpaidText = await page.locator('.mn-unpaid').innerText();
  ok('the unpaid list shows the show invoice', /GIG-0007/.test(unpaidText) && /\$170/.test(unpaidText), unpaidText.replace(/\n/g, ' '));
  ok('overdue invoices come first', unpaidText.indexOf('GIG-0010') >= 0 && unpaidText.indexOf('GIG-0010') < unpaidText.indexOf('GIG-0007') && /Overdue/.test(unpaidText));
  ok('the overdue total', (await page.locator('#mn-stat-overdue b').innerText()) !== '$0' && (await page.locator('#mn-stat-overdue').getAttribute('class')).includes('bad'));
  ok('sent invoices come before drafts', unpaidText.indexOf('GIG-0007') >= 0 && unpaidText.indexOf('GIG-0007') < unpaidText.indexOf('GIG-0009') && /not sent yet/.test(unpaidText));
  const dep = await page.locator('.mn-deposits').innerText();
  ok('deposits due lists the offer with a deposit', /Harbour Hall/.test(dep) && /\$400/.test(dep), dep.replace(/\n/g, ' '));
  await page.locator('.mn-deposits button[aria-label^="Deposit received"]').first().click();
  await sleep(250);
  b = await booking(page, 's-show2');
  ok('a deposit can be marked received', b.deal.depositPaid === true && b.checks['show-deposit'] === true);
  ok('the deposits list empties', (await page.locator('.mn-deposits').count()) === 0);
  const settledText = await page.locator('.mn-settled').innerText();
  ok('settled shows with their profit', /The Night Owls @ The Lantern Rooms/.test(settledText) && /profit/.test(settledText), settledText.replace(/\n/g, ' '));
  ok('a show counted but not marked settled says so in Settled shows', /not marked settled/.test(settledText), settledText.replace(/\n/g, ' '));
  ok('payouts per person from settled shows', /Maya Brooks/.test(await page.locator('.mn-payouts').innerText()) && /from 1 show/.test(await page.locator('.mn-payouts').innerText()));
  ok('income by month has twelve rows with their values in words', (await page.locator('.mn-bar-row').count()) === 12 && (await page.locator('.mn-bar-v .sr-only').count()) === 12);
  ok('totals per act', /The Night Owls/.test(await page.locator('.mn-acts').innerText()) && /Sable/.test(await page.locator('.mn-acts').innerText()));
  // An act's profit counts a show's merch, as the settled shows and the payouts do.
  const owls = await page.locator('.mn-act', { hasText: 'The Night Owls' }).innerText();
  const owlsWant = await page.evaluate(async () => {
    const [m, s] = await Promise.all([import('./js/model.js'), import('./js/store.js')]);
    const Y = new Date().getFullYear() + '', done = s.db.bookings.filter(b => b.actId === 's-owls' && b.kind === 'show' && (b.status === 'done' || b.status === 'settled') && (b.date || '').startsWith(Y));
    return { profit: m.fmtMoney(done.reduce((t, b) => t + m.settle(b).profit, 0)), merch: done.reduce((t, b) => t + m.settle(b).merch, 0), merchText: m.fmtMoney(done.reduce((t, b) => t + m.settle(b).merch, 0)) };
  });
  ok('an act\'s profit counts its merch', owls.includes(`profit ${owlsWant.profit}`) && (!(owlsWant.merch > 0) || owls.includes(`merch ${owlsWant.merchText}`)), owls.replace(/\n/g, ' ') + ' — expected ' + JSON.stringify(owlsWant));
  // The CSV exports download.
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#mn-csv-invoices')]);
  const csvText = fs.readFileSync(await dl.path(), 'utf8');
  ok('the invoices CSV downloads', dl.suggestedFilename() === `gigdex-invoices-${expect.Y}.csv` && /^﻿?Number,Date,Due/.test(csvText) && /GIG-0007/.test(csvText) && /420\.00/.test(csvText), csvText.slice(0, 200));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#mn-csv-shows')]);
  const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
  ok('the shows CSV downloads with the settlement (Settled says no for a night counted but not marked settled)', /Date,Act,Venue/.test(csv2) && /The Lantern Rooms,Done,[^\n]*,214,[^\n]*,1338\.00,no/.test(csv2), csv2.split('\n').slice(0, 3).join(' / '));
  // The year switcher: only years with bookings (and this one).
  ok('no earlier year to go to without bookings in it', await page.locator('#mn-year-prev').isDisabled());
  await page.evaluate(y => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-last-year', kind: 'other', status: 'done', date: `${y}-06-14`, title: 'Wedding', fee: 900 })), Number(expect.Y) - 1);
  await sleep(200);
  await page.click('#mn-year-prev');
  await sleep(150);
  ok('the year switcher goes back a year', (await page.locator('.mn-year-now').innerText()) === String(Number(expect.Y) - 1) && (await page.locator('#mn-stat-earned b').innerText()) === '$900', await page.locator('#mn-stat-earned b').innerText());
  ok('focus stays on the year switcher', await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.mn-year')));
  await page.click('#mn-year-next');
  await sleep(150);
  ok('and forward again', (await page.locator('.mn-year-now').innerText()) === expect.Y);
  // An invoice from last year that is still owed counts in this year's unpaid and overdue, as in the list below them.
  await page.evaluate(y => import('./js/store.js').then(s => s.patch('bookings', 't-last-year', { invoice: { number: 'OLD-0001', status: 'sent', issued: `${y}-12-10`, due: `${y}-12-24`, taxRate: 0, taxName: 'Tax', lines: [{ id: 'l1', desc: 'Wedding', qty: 1, unit: 'show', price: 900 }], payments: [], sentAt: 1 } })), Number(expect.Y) - 1);
  await sleep(250);
  const owed = await page.evaluate(async () => {
    const [m, s, mn] = await Promise.all([import('./js/model.js'), import('./js/store.js'), import('./js/money.js')]);
    const sent = s.db.bookings.filter(b => b.invoice && b.invoice.status === 'sent');
    return { unpaid: m.fmtMoney(sent.reduce((t, b) => t + mn.docTotals(b.invoice).due, 0)), overdue: m.fmtMoney(sent.filter(b => mn.isOverdue(b)).reduce((t, b) => t + mn.docTotals(b.invoice).due, 0)) };
  });
  const owedNow = { unpaid: await page.locator('#mn-stat-unpaid b').innerText(), overdue: await page.locator('#mn-stat-overdue b').innerText(), list: await page.locator('.mn-unpaid').innerText() };
  ok('last year\'s unpaid invoice counts in this year\'s unpaid and overdue', /OLD-0001/.test(owedNow.list) && owedNow.unpaid === owed.unpaid && owedNow.overdue === owed.overdue, JSON.stringify({ owedNow: { ...owedNow, list: undefined }, owed }));
  // The tutorial runs.
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial()));
  const toured = await page.waitForFunction(() => /Your year/.test((document.querySelector('.tour-card') || {}).innerText || ''), null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok('the Money page has a walkthrough', toured, toured ? '' : await page.locator('.tour-card').innerText().catch(() => 'no card'));
  await page.keyboard.press('Escape');

  // A session's income counts its players at their own rates, as its invoice will (s-sess1: 8 h × $45 + Marcus $180).
  const inc = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/model.js')]).then(([s, m]) => { s.loadSample(); return m.bookingIncome(s.byId('bookings', 's-sess1')); }));
  ok('a session’s income includes its session players, as the invoice does', inc === 540, String(inc));
  // An invoice whose payments already cover it is saved as paid, not just sent (and ticks Paid in full).
  const covered = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, mo]) => {
    s.upsert('bookings', { id: 't-covered', kind: 'other', status: 'done', title: 'Covered', date: '2026-02-02', fee: 100 });
    mo.saveDoc('t-covered', 'invoice', { number: 'T-1', status: 'sent', issued: '2026-02-02', lines: [{ id: 'l', desc: 'Fee', qty: 1, price: 100 }], payments: [{ id: 'p', date: '2026-02-02', amount: 100, method: 'cash' }] });
    const b = s.byId('bookings', 't-covered'); return b.invoice.status;
  }));
  ok('an invoice its payments already cover is saved as paid', covered === 'paid', covered);
  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  /* ---------------- an empty database ---------------- */
  const e = await open({ tab: 'money' });
  await e.page.waitForSelector('#page .page-card');
  ok('with no bookings the Money page explains itself', /once you have bookings/.test(await e.page.locator('.empty').innerText()) && (await e.page.locator('.empty .btn').count()) === 1);
  ok('no errors on an empty Money page', e.errors.length === 0, e.errors.join(' | '));
  await e.browser.close();
})().catch(e => { console.log('FAIL money crashed — ' + e.message); process.exit(1); });

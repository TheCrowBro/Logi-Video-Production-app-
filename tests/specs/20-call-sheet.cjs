const { chromium } = require('playwright');
const fs = require('fs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);

  // From the Bookings page: the list, then the builder page (no modal)
  await page.getByRole('button', { name: 'Call sheets' }).click(); await page.waitForSelector('.sheet .card.tap');
  await page.locator('.sheet .card.tap').filter({ hasText: 'Harbour Brewing' }).first().click();
  await page.waitForSelector('.cs-page .cs-doc');
  ok('a row opens the call sheet as a page inside Bookings', (await page.locator('.sheet').count()) === 0 && (await page.locator('.cs-page h1').innerText()) === 'Call sheet');
  const title = await page.locator('.cs-doc h2').innerText();

  // Edit on the document itself
  await page.getByRole('button', { name: 'Edit sheet' }).click(); await page.waitForSelector('.cs-paper.editing');
  ok('edit mode turns the sheet’s fields into inputs', (await page.locator('.cs-doc input[type=time]').count()) >= 3 && (await page.locator('.cs-doc textarea').count()) >= 2);
  const doc = page.locator('.cs-doc');
  await doc.locator('.cs-time input[aria-label="General call"]').fill('07:00');
  await doc.locator('.cs-time input[aria-label="Lunch"]').fill('12:30');
  await doc.locator('.cs-time input[aria-label="Wrap"]').fill('18:30');
  await doc.getByRole('button', { name: '+ Add line' }).click(); await doc.getByRole('button', { name: '+ Add line' }).click();
  const rows = doc.locator('.cs-sched-edit .row-edit');
  await rows.nth(0).locator('input[type=time]').fill('07:00'); await rows.nth(0).locator('input[type=text]').fill('Crew call, unload at rear gate');
  await rows.nth(1).locator('input[type=time]').fill('09:30'); await rows.nth(1).locator('input[type=text]').fill('First interview — brewhouse');
  await doc.locator('input[aria-label="Sam Okafor call time"], input[aria-label$="call time"]').first().fill('06:30');
  await doc.locator('textarea[aria-label^="Who is coming"]').fill('Client: Priya (marketing) from 10:00');
  await doc.locator('input[aria-label^="e.g. 14"]').fill('14°C, showers from 3pm');
  await doc.locator('input[aria-label^="Emergency contact"]').fill('Sam · 0400 000 000');
  await doc.locator('.cs-toggle').filter({ hasText: 'Kit' }).locator('input').uncheck();
  ok('inputs hold what was typed (wrap 18:30, first crew call 06:30)', (await doc.locator('.cs-time input[aria-label="Wrap"]').inputValue()) === '18:30' && (await doc.locator('input[aria-label$="call time"]').first().inputValue()) === '06:30', (await doc.locator('.cs-time input[aria-label="Wrap"]').inputValue()) + ' / ' + (await doc.locator('input[aria-label$="call time"]').first().inputValue()));
  await page.screenshot({ path: S + '/builder-edit.png', fullPage: false });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForFunction(() => !document.querySelector('.cs-paper.editing'));
  const view = await page.locator('.cs-doc').innerText();
  ok('Done saves the edits onto the sheet', /07:00/.test(view) && /12:30/.test(view) && /18:30/.test(view) && /First interview — brewhouse/.test(view) && /showers from 3pm/.test(view) && /Priya/.test(view) && /Sam · 0400/.test(view));
  ok('the per-person call time is on the crew table', /06:30/.test(view));
  ok('the unticked Kit section is left off', !/KIT/.test(view));
  ok('status shows Draft v1', /Draft/.test(await page.locator('.cs-page .status-line').innerText()) && /v1/.test(await page.locator('.cs-page .status-line').innerText()));
  const saved = await page.evaluate(t => import('./js/store.js').then(s => s.db.bookings.find(b => b.title === t)), title);
  ok('saved on the booking record', saved.callSheet.version === 1 && saved.callSheet.schedule.length === 2 && saved.callSheet.include.kit === false && Object.values(saved.crewCall || {}).includes('06:30'));
  await page.screenshot({ path: S + '/builder-view.png', fullPage: false });

  // Cancel discards; a store change while editing keeps the draft
  await page.getByRole('button', { name: 'Edit sheet' }).click(); await page.waitForSelector('.cs-paper.editing');
  await page.locator('.cs-doc .cs-time input[aria-label="Lunch"]').fill('13:00');
  await page.evaluate(() => import('./js/store.js').then(s => s.touch())); await sleep(200);
  ok('a re-render while editing keeps the draft (still editing, value kept)', (await page.locator('.cs-paper.editing').count()) === 1 && (await page.locator('.cs-doc .cs-time input[aria-label="Lunch"]').inputValue()) === '13:00');
  await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForFunction(() => !document.querySelector('.cs-paper.editing'));
  ok('Cancel discards the change', /12:30/.test(await page.locator('.cs-doc').innerText()) && !/13:00/.test(await page.locator('.cs-doc').innerText()));

  // Print from the app: no pop-up; the document is printed from the page itself
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { cls: document.body.classList.contains('print-cs'), docs: document.querySelectorAll('#print-root .cs-doc').length, css: !!document.getElementById('cs-print-css') }; window.dispatchEvent(new Event('afterprint')); }; window.open = () => { window.__popup = true; return null; }; });
  await page.getByRole('button', { name: 'Print' }).click(); await sleep(400);
  const printed = await page.evaluate(() => ({ p: window.__printed, popup: !!window.__popup, cleaned: !document.getElementById('print-root') && !document.body.classList.contains('print-cs') }));
  ok('Print uses the page’s own print dialog with the sheet as the only printable content, then cleans up', printed.p && printed.p.cls && printed.p.docs === 1 && printed.p.css && !printed.popup && printed.cleaned, JSON.stringify(printed));
  ok('printing marks the sheet as sent', /Sent/.test(await page.locator('.cs-page .status-line').innerText()));

  // Save PDF: a real PDF file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save PDF' }).click()]);
  const pdfPath = S + '/callsheet-browser.pdf'; await dl.saveAs(pdfPath);
  const pdf = fs.readFileSync(pdfPath).toString('latin1');
  const start = Number(pdf.slice(pdf.lastIndexOf('startxref') + 10).trim().split(/\s/)[0]);
  ok('PDF file is well formed and carries the schedule and crew', /^%PDF-1\.4/.test(pdf) && pdf.slice(start, start + 4) === 'xref' && /First interview/.test(pdf) && /sam@example\.com/.test(pdf) && /06:30/.test(pdf), dl.suggestedFilename() + ', ' + pdf.length + ' bytes');
  const emailHref = await page.locator('.cs-page a', { hasText: 'Email crew' }).getAttribute('href');
  ok('Email crew is addressed to the crew', /^mailto:[^?]+@[^?]+,[^?]+@/.test(emailHref));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Web page' }).click()]);
  ok('Web page file saved', /\.html$/.test(dl2.suggestedFilename()));

  // Back to the booking; the button there shows the state; the list shows it too
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(300);
  ok('booking page button shows the state', /Call sheet · sent/.test(await page.locator('.bk-detail').innerText()));
  await page.locator('.bk-detail .page-head button').first().click(); await sleep(200); // day view
  await page.getByRole('button', { name: 'Calendar' }).click(); await sleep(300); // month view
  await page.getByRole('button', { name: 'Call sheets' }).click(); await page.waitForSelector('.sheet .card.tap');
  ok('list shows Sent for that shoot', (await page.locator('.sheet .card.tap').filter({ hasText: 'Harbour Brewing' }).first().locator('.pill').innerText()) === 'Sent');
  await page.keyboard.press('Escape'); await sleep(200);

  // Leaving the tab while editing saves the draft
  await page.getByRole('button', { name: 'Call sheets' }).click(); await page.waitForSelector('.sheet .card.tap');
  await page.locator('.sheet .card.tap').filter({ hasText: 'Harbour Brewing' }).first().click(); await page.waitForSelector('.cs-page .cs-doc');
  await page.getByRole('button', { name: 'Edit sheet' }).click(); await page.waitForSelector('.cs-paper.editing');
  await page.locator('.cs-doc input[aria-label^="e.g. All black"]').fill('All black, boots');
  await page.evaluate(() => window.logiGo('crew')); await sleep(500);
  const after = await page.evaluate(t => import('./js/store.js').then(s => s.db.bookings.find(b => b.title === t).callSheet), title);
  ok('switching tabs mid-edit saves the draft as a new version', after.dress === 'All black, boots' && after.version === 2, 'v' + after.version);
  // Multi-day grouping and escaping through the builders
  const multi = await page.evaluate(() => import('./js/store.js').then(async s => { const m = await import('./js/callsheet.js'); const b = s.db.bookings.find(x => /Wedding/.test(x.title)); const cs = { ...m.sheetOf(b), schedule: [{ id: '1', date: b.date, time: '10:00', item: 'Bridal prep' }, { id: '2', date: b.endDate, time: '11:00', item: 'Brunch' }] }; const html = m.callSheetHtml({ ...b, callSheet: cs, title: 'Evil <b>x</b> & co' }); const doc = m.renderDoc({ ...b, callSheet: cs }); return { days: doc.querySelectorAll('.cs-day').length, escaped: /Evil &lt;b&gt;x&lt;\/b&gt; &amp; co/.test(html) && !/<b>x<\/b>/.test(html), pdfOk: (await m.callSheetPdf({ ...b, callSheet: cs })).length > 1000 }; }));
  ok('multi-day schedule groups by day; user text escaped; PDF builds for multi-day', multi.days === 2 && multi.escaped && multi.pdfOk, JSON.stringify(multi));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

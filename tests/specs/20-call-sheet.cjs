const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const fs = require('fs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
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
  const docText = await page.locator('.cs-doc').innerText();
  ok('the venue rules read as one line: a space after a rule that ends a sentence, never ".;"', /without a release\. Keep the fire exit/.test(docText) && !/\.;/.test(docText), (docText.match(/Venue rules[^\n]*\n?[^\n]*/) || [''])[0]);

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
  await doc.locator('input[aria-label="Sam Rivera call time"], input[aria-label$="call time"]').first().fill('06:30');
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
  // The crew page's notice goes on the printed sheet, the saved web page and the PDF (report item 2), not in the editor.
  const NOTICE = 'The times, places, weather, sun times and emergency details here were entered or chosen by the producer. Vdex has not checked them and they may be out of date. Confirm with the producer.';
  const notice = await page.evaluate(() => import('./js/store.js').then(async s => {
    const m = await import('./js/callsheet.js'), b = s.db.bookings.find(x => /Wedding/.test(x.title));
    const pdf = new TextDecoder('latin1').decode(await m.callSheetPdf(b)), words = [...pdf.matchAll(/\((.*?)\) Tj/g)].map(x => x[1]).join(' ');
    return { doc: m.renderDoc(b).querySelector('.cs-foot').textContent, html: m.callSheetHtml(b), edit: m.renderDoc(b, { edit: { touch() {}, redraw() {} } }).querySelector('.cs-foot').textContent, pdf: words };
  }));
  ok('a printed call sheet, its web page and its PDF carry the notice that the producer chose the details and nobody checked them', notice.doc.includes(NOTICE) && notice.html.includes(NOTICE) && notice.pdf.replace(/\s+/g, ' ').includes(NOTICE) && !notice.edit.includes('Vdex has not checked'), notice.doc);

  // ---- repairs after 1.4.0: the call sheet ----
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  const csFix = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js'), import('./js/crew-link.js')]).then(async ([s, m, link]) => {
    const [c1, c2] = s.db.crew, off = -new Date(2026, 11, 8, 12).getTimezoneOffset() / 60, lonAt = h => ((((off + h) * 15 + 180) % 360) + 360) % 360 - 180; // a place h hours of sun away from this device's clock
    s.update(d => {
      d.venues.push({ id: 'cf-far', name: 'Far studio', address: '5 Far Street', geo: { lat: 40.7, lon: lonAt(6) } }, { id: 'cf-near', name: 'Near studio', address: '5 Near Street', geo: { lat: 40.7, lon: lonAt(0) } });
      d.bookings.push(
        { id: 'cf-bare', title: 'Bare shoot', date: '2026-12-08', start: '08:00', end: '17:00', address: '1 Test Road', status: 'Confirmed', stakeholders: [], crew: [], gear: [], callSheet: { lunch: '12:30' } },
        { id: 'cf-far', title: 'Far shoot', date: '2026-12-08', start: '08:00', venueId: 'cf-far', status: 'Confirmed', stakeholders: [], crew: [], gear: [] }, { id: 'cf-near', title: 'Near shoot', date: '2026-12-08', start: '08:00', venueId: 'cf-near', status: 'Confirmed', stakeholders: [], crew: [], gear: [] },
        { id: 'cf-days', title: 'Moved shoot', date: '2026-12-08', endDate: '2026-12-10', status: 'Confirmed', stakeholders: [], crew: [c1.id, c2.id], crewStatus: { [c2.id]: 'declined' }, gear: [], callSheet: { schedule: [{ id: 'a', date: '2026-12-01', time: '08:00', item: 'Day one' }, { id: 'b', date: '2026-12-02', time: '09:00', item: 'Day two' }, { id: 'c', date: '2026-12-09', time: '10:00', item: 'Middle day' }, { id: 'd', time: '11:00', item: 'No date' }] } },
        { id: 'cf-shift', title: 'Shifting shoot', date: '2026-12-01', endDate: '2026-12-03', status: 'Confirmed', stakeholders: [], crew: [], gear: [], callSheet: { schedule: ['01', '02', '03'].map((d, i) => ({ id: 's' + i, date: '2026-12-' + d, time: '08:00', item: 'Line ' + (i + 1) })) } }); });
    const zeros = el => { const out = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n; (n = w.nextNode());) if (/^0+$/.test(n.data.trim())) out.push(n.parentNode.tagName); return out; };
    const get = id => s.byId('bookings', id), bare = get('cf-bare'), days = get('cf-days');
    const multi = m.renderDoc(days), sched = [...multi.querySelectorAll('.cs-sec')].find(x => x.querySelector('h4').textContent === 'Schedule'), text = m.callSheetText(bare), data = m.callSheetData(days), snap = link.crewSnapshot(days);
    return { zeros: [...zeros(m.renderDoc(bare)), ...zeros(m.renderDoc(bare, { edit: { touch() {}, redraw() {} } })), ...zeros(multi)], kit: /<h4>Kit<\/h4>/.test(m.callSheetHtml(bare)),
      gaps: (text.match(/\n{3,}/g) || []).length, endsClean: /\n\nProduced by /.test(text) && /Address: 1 Test Road\n\nCREW/.test(text),
      lines: data.schedule.map(r => r.date + ' ' + r.item).join(), heads: sched.querySelectorAll('.cs-day').length, rows: sched.querySelectorAll('tbody tr').length, link: snap.schedule.map(r => r.date).join(), asText: (m.callSheetText(days).match(/Day one|Day two|Middle day/g) || []).length,
      crew: data.crew.map(c => c.name).join(), linkCrew: snap.crew.map(c => c.name).join(), first: c1.name,
      far: m.callSheetText(get('cf-far')).split('\n').find(l => /^Sunrise/.test(l)) || '', near: m.callSheetText(get('cf-near')).split('\n').find(l => /^Sunrise/.test(l)) || '', farBox: m.renderDoc(get('cf-far')).querySelector('.cs-times').textContent,
      zone: (new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date(2026, 11, 8, 12)).find(p => p.type === 'timeZoneName') || {}).value };
  }));
  ok('a call sheet with no contacts, no kit and no crew prints no stray “0”, also in the editor and on a multi-day sheet, and no empty Kit heading', csFix.zeros.length === 0 && !csFix.kit, JSON.stringify({ zeros: csFix.zeros, kit: csFix.kit }));
  ok('the sheet’s text has one blank line between sections, never a run of them', csFix.gaps === 0 && csFix.endsClean, JSON.stringify(csFix.text || csFix.gaps));
  ok('a schedule line dated outside the shoot is printed under the date its editor shows, and a line with no date under the first day: on the sheet, in its text and on the crew link', csFix.lines === '2026-12-01 Day one,2026-12-02 Day two,2026-12-08 No date,2026-12-09 Middle day' && csFix.heads === 4 && csFix.rows === 4 && csFix.link === '2026-12-01,2026-12-02,2026-12-08,2026-12-09' && csFix.asText === 3, JSON.stringify({ lines: csFix.lines, heads: csFix.heads, rows: csFix.rows, link: csFix.link }));
  ok('a crew member who declined is not on the call sheet or the crew link', csFix.crew === csFix.first && csFix.linkCrew === csFix.first, csFix.crew + ' / ' + csFix.linkCrew);
  ok('sun times for a venue on another clock name their zone and say they are not the venue’s local time; a venue on this clock reads as before', csFix.far.includes(' ' + csFix.zone + ' ·') && /not the venue’s local time/.test(csFix.far) && csFix.farBox.includes(csFix.zone) && !csFix.near.includes(csFix.zone) && !/local time/.test(csFix.near), JSON.stringify({ far: csFix.far, near: csFix.near, zone: csFix.zone }));
  // Moving the shoot in its form moves the schedule lines with it; one day clears their dates
  const cform = page.locator('.sheet form'), lineDates = () => page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', 'cf-shift').callSheet.schedule.map(r => r.date).join()));
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('cf-shift'))); await sleep(300);
  await page.locator('.bk-detail .page-head').getByRole('button', { name: 'Edit', exact: true }).click(); await cform.waitFor();
  await cform.locator('input[data-key="date"]').fill('2026-12-08'); await cform.locator('input[data-key="endDate"]').fill('2026-12-10'); await cform.locator('button[type=submit]').click(); await sleep(400);
  const movedLines = await lineDates();
  await page.locator('.bk-detail .page-head').getByRole('button', { name: 'Edit', exact: true }).click(); await cform.waitFor();
  await cform.locator('input[data-key="endDate"]').fill(''); await cform.locator('button[type=submit]').click(); await sleep(400);
  const oneDay = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(([s, m]) => { const b = s.byId('bookings', 'cf-shift'); return { dates: b.callSheet.schedule.map(r => r.date).join(), rows: m.renderDoc(b).querySelectorAll('.cs-sec table tbody tr').length }; }));
  ok('a shoot moved a week in its form takes its schedule lines with it, and cut to one day its lines lose their dates and are all printed', movedLines === '2026-12-08,2026-12-09,2026-12-10' && oneDay.dates === ',,' && oneDay.rows === 3, movedLines + ' / ' + JSON.stringify(oneDay));
  // A restore stamps the stripboard as changed now (for the merge); the scenes themselves were not changed
  const restored = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(([s, m]) => { const t = Date.now() - 864e5, get = () => s.byId('bookings', 'cf-sent');
    s.update(d => { d.bookings.push({ id: 'cf-sent', title: 'Sent sheet', date: '2026-12-08', endDate: '2026-12-10', status: 'Confirmed', stakeholders: [], crew: [], gear: [], board: { list: [{ id: 'day-1', type: 'break' }, { id: 'sc1', type: 'scene', scene: '1', set: 'Hall' }], cast: [], updatedAt: t - 1000 }, callSheet: { generalCall: '08:00', version: 2, editedAt: t - 500, sentAt: t } }); });
    const out = { before: m.sheetState(get()) };
    s.replaceAll(JSON.parse(s.exportJSON())); out.after = m.sheetState(get()); s.replaceAll(JSON.parse(s.exportJSON())); out.twice = m.sheetState(get());
    s.update(d => { const x = d.bookings.find(b => b.id === 'cf-sent'); x.board = { list: [...x.board.list, { id: 'sc2', type: 'scene', scene: '2', set: 'Yard' }], cast: [], updatedAt: Date.now() }; x.updatedAt = Date.now(); }); out.edited = m.sheetState(get());
    s.remove('bookings', 'cf-sent'); return out; }));
  ok('a call sheet that was sent still reads Sent after a backup is restored, twice over, and Changed once its stripboard is edited', restored.before === 'sent' && restored.after === 'sent' && restored.twice === 'sent' && restored.edited === 'changed', JSON.stringify(restored));
  // Sent, then the booking changes: the sheet says it changed; and a sheet sent as built is no "Draft"
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('cf-bare', { view: 'callsheet' }))); await page.waitForSelector('.cs-page .cs-doc');
  await page.getByRole('button', { name: 'Mark as sent' }).click(); await sleep(300);
  const sent = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(async ([s, m]) => { const get = () => s.byId('bookings', 'cf-bare'), out = { first: m.sheetState(get()), head: m.renderDoc(get()).querySelector('.cs-when').textContent };
    const words = [...new TextDecoder('latin1').decode(await m.callSheetPdf(get())).matchAll(/\((.*?)\) Tj/g)].map(x => x[1]).join(' '); out.pdfDraft = /Draft/.test(words);
    s.upsert('bookings', { ...get(), status: 'Prepped' }); out.stage = m.sheetState(get());
    s.upsert('bookings', { ...get(), start: '05:30', address: '9 Other Road' }); out.moved = m.sheetState(get()); return out; }));
  await sleep(300);
  ok('a sheet sent as it was built is not headed “Draft”, on the page or in the PDF', sent.first === 'sent' && !/Draft/.test(sent.head) && !sent.pdfDraft, JSON.stringify(sent));
  ok('a sent sheet stays Sent when only the stage moves, and reads “Changed since it was sent” once the call time and address change', sent.stage === 'sent' && sent.moved === 'changed' && /Changed since it was sent/.test(await page.locator('.cs-page .status-line').innerText()), JSON.stringify(sent));
  // What is typed in Edit sheet is saved when Vdex goes to the background (a phone may end it there); Cancel still undoes it
  await page.getByRole('button', { name: 'Edit sheet' }).click(); await page.waitForSelector('.cs-paper.editing');
  await page.locator('.cs-doc .cs-time input[aria-label="Lunch"]').fill('13:15'); await page.locator('.cs-doc .cs-time input[aria-label="Lunch"]').blur();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenSave = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', 'cf-bare').callSheet.lunch));
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(200);
  const stillEditing = await page.locator('.cs-paper.editing').count();
  await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForFunction(() => !document.querySelector('.cs-paper.editing'));
  const afterCancel = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', 'cf-bare').callSheet.lunch));
  ok('a call sheet being edited is saved when Vdex goes to the background, the editing carries on, and Cancel still takes the edit back', hiddenSave === '13:15' && stillEditing === 1 && afterCancel === '12:30', JSON.stringify({ hiddenSave, stillEditing, afterCancel }));
  // The crew table on a phone: a phone number and an email address wrap inside their cells, so the table ends at the
  // paper's edge and the Email column is not cut off (names and roles keep whole words)
  await page.evaluate(() => import('./js/store.js').then(s => { const crew = [['cw-1', 'Sam Rivera', 'Sound Recordist', '+1 555 0101', 'sam.rivera@example.com'], ['cw-2', 'Jo Chen', '1st AC', '+1 555 0102', 'jo@example.com'], ['cw-3', 'Priya Nair', 'Editor', '+1 555 0104', 'priya.nair@example.com']];
    s.update(d => { for (const [id, name, role, phone, email] of crew) d.crew.push({ id, name, role, phone, email, updatedAt: Date.now() }); d.bookings.push({ id: 'cf-phone', title: 'Crew table', date: '2026-12-08', start: '08:00', status: 'Confirmed', stakeholders: [], crew: crew.map(c => c[0]), crewCall: { 'cw-1': '07:30', 'cw-2': '07:00' }, hires: [{ id: 'cw-h', name: 'Ada Lovell', role: 'Gaffer', phone: '+1 555 0105', email: 'ada@example.com' }], gear: [], updatedAt: Date.now() }); }); }));
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('cf-phone', { view: 'callsheet' }))); await page.waitForSelector('.cs-paper table');
  const fits = [];
  for (const width of [320, 360, 390]) { await page.setViewportSize({ width, height: 800 }); await sleep(250);
    fits.push(await page.evaluate(() => { const paper = document.querySelector('.cs-paper'), t = [...paper.querySelectorAll('table')].find(x => /Email/.test(x.textContent)), words = [...t.querySelectorAll('td')].filter(td => /^(Sam Rivera|Sound Recordist|1st AC)$/.test(td.textContent)).every(td => getComputedStyle(td).overflowWrap !== 'anywhere');
      return { inside: paper.scrollWidth <= paper.clientWidth + 1 && t.getBoundingClientRect().right <= paper.getBoundingClientRect().right + 1, words, page: document.documentElement.scrollWidth <= innerWidth }; })); }
  ok('at 320, 360 and 390 px the call sheet’s crew table ends at the paper’s edge: the email address wraps in its cell, names and roles keep whole words', fits.every(f => f.inside && f.words && f.page), JSON.stringify(fits));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

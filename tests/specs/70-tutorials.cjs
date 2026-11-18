const { chromium } = require('playwright');
const { acceptTerms, openMenu, menuClick } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  // Sign-in switched off, whatever js/cloud-config.js holds, so the calendar card shows its greyed state (spec 95 covers it on).
  await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: "export const CLOUD_APPS = { icloud: { container: '', apiToken: '', desktopToken: '' }, dropbox: '', google: '', microsoft: '', googleCalendar: true };" }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await openMenu(page);
  ok('Tutorial for this page is a row of the menu', (await page.locator('#helpBtn').isVisible()) && /Tutorial for this page/.test(await page.locator('#helpBtn').innerText()));
  await page.keyboard.press('Escape');
  // Walk a tutorial: count the steps that resolved to a highlighted box, and that Done closes it
  const walk = async (btn = '#helpBtn') => {
    if (btn === '#helpBtn') await menuClick(page, btn); else if (btn) await page.locator(btn).last().click();
    await page.waitForSelector('.tour-card');
    let spots = 0, cards = 0, titles = [], counter = '', label = '';
    for (let i = 0; i < 40; i++) {
      const h2 = page.locator('.tour-card h2');
      if (!(await h2.count())) { await sleep(600); if (!(await h2.count())) break; } // the tour closed by itself: nothing to point at
      cards++;
      titles.push(await h2.innerText());
      if (!(await page.locator('.tour-spot').evaluate(el => el.classList.contains('center')))) spots++;
      const btn = page.locator('.tour-card .btn.primary');
      label = await btn.innerText();
      const was = counter = await page.locator('.tour-step').innerText();
      await btn.click();
      if (label === 'Done') break;
      await page.waitForFunction(prev => !document.querySelector('.tour-card') || (document.querySelector('.tour-step') || {}).textContent !== prev, was, { timeout: 8000 }).catch(() => {});
      await sleep(120);
    }
    const closed = (await page.locator('.tour').count()) === 0;
    return { cards, spots, closed, titles, counter, label };
  };
  const expect = async (name, min, btn) => { const r = await walk(btn); ok(`${name}: ${r.cards} steps, ${r.spots} highlighted, ends on Done at ${r.cards} / ${r.cards}`, r.cards >= min && r.spots >= min && r.closed && r.label === 'Done' && r.counter === `${r.cards} / ${r.cards}`, `${r.counter} · ${r.label} · ` + r.titles.join(' · ')); };
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400); await expect('Bookings calendar', 4);
  await page.evaluate(() => document.querySelector('.bk-month .cal .day.has')?.click()); await sleep(400); await expect('A day', 2);
  // open the Harbour booking whatever today's date is: back to the month, then its card in Next up (or its day)
  await page.evaluate(() => { const back = [...document.querySelectorAll('#page .page-head button')].find(b => /Calendar/.test(b.textContent)); if (back) back.click(); }); await sleep(300);
  await page.evaluate(() => { const c = [...document.querySelectorAll('#page .card.tap')].find(x => /Harbour/.test(x.textContent)); if (c) c.click(); }); await page.waitForSelector('.bk-detail'); await expect('A booking', 8);
  await page.locator('.bk-tools button').first().click(); await page.waitForSelector('.cs-page'); await expect('Call sheet', 3);
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(300);
  await page.locator('#bk-work').evaluate(d => { d.open = true; }); await sleep(150);
  await page.locator('#bk-money button').first().click(); await page.waitForSelector('.money-page'); await expect('Money', 2);
  ok('the Money page offers newcomers the guide, and its tutorial card offers it too', (await page.locator('.money-page .walk-btn').count()) === 1);
  await menuClick(page, '#helpBtn'); await page.waitForSelector('.tour-card .tour-actions');
  ok('…as a Guide button on the first card', (await page.locator('.tour-card button:has-text("Guide")').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  for (const [tab, name, min] of [['crew', 'Crew', 3], ['gear', 'Equipment', 5], ['venues', 'Venues', 3], ['insurance', 'Insurance', 3], ['me', 'Me', 3], ['field', 'Field', 2], ['settings', 'Settings', 10]]) {
    await page.evaluate(t => window.logiGo(t), tab); await sleep(450); await expect(name, min);
  }
  // Timecode notes: the logs list, then a log made through the UI, then the sheets' own ? buttons
  await page.evaluate(() => window.logiGo('tcnotes')); await sleep(450); await expect('Timecode logs', 3);
  await page.getByRole('button', { name: '+ New log' }).first().click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="title"]').fill('A cam — day 1');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(500);
  if (!(await page.locator('.tc-log-head').count())) { await page.locator('#page .list .card.tap').first().click(); }
  await page.waitForSelector('.tc-log-head');
  await expect('A timecode log', 8);
  ok('the log tutorial visited the script tab and came back to the notes', (await page.locator('.tc-views button.on').innerText()).startsWith('Notes'));
  await page.locator('.tc-head .card-row .btn').click(); await page.waitForSelector('.sheet[aria-label="Sync timecode"]');
  ok('sheets carry a ? button', (await page.locator('.sheet .sheet-help').count()) >= 1);
  await expect('Sync sheet', 2, '.sheet .sheet-help');
  ok('the sync sheet is still open after its tutorial', (await page.locator('.sheet[aria-label="Sync timecode"]').count()) === 1);
  await page.locator('.sheet .sheet-help').last().click(); await page.waitForSelector('.tour-card h2'); await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape closes the tutorial but not the sheet beneath it', (await page.locator('.tour').count()) === 0 && (await page.locator('.sheet[aria-label="Sync timecode"]').count()) === 1);
  await page.locator('.sheet[aria-label="Sync timecode"] .icon-btn[aria-label="Close"]').click(); await sleep(250);
  await page.locator('.tc-log-head .actions button').first().click(); await page.waitForSelector('.sheet[aria-label="Link another device"]');
  await expect('Link sheet', 2, '.sheet .sheet-help');
  await page.locator('.sheet[aria-label="Link another device"] .icon-btn[aria-label="Close"]').click(); await sleep(250);
  await page.locator('.tc-views button').nth(1).click(); await sleep(250);
  await page.locator('#page .empty .btn.primary').click(); await page.waitForSelector('.sheet[aria-label="Add script"]');
  await expect('Add script sheet', 3, '.sheet .sheet-help');
  await page.locator('.sheet[aria-label="Add script"] .icon-btn[aria-label="Close"]').click(); await sleep(250);
  await page.locator('.tc-log-head .actions button', { hasText: 'Export' }).click(); await page.waitForSelector('.sheet[aria-label="Export notes"]');
  await expect('Export sheet', 1, '.sheet .sheet-help');
  await page.locator('.sheet[aria-label="Export notes"] .icon-btn[aria-label="Close"]').click(); await sleep(250);
  // Other pages…: the chooser lists every tutorial and can reach a booking from anywhere
  await page.evaluate(() => window.logiGo('crew')); await sleep(300);
  await menuClick(page, '#helpBtn'); await page.waitForSelector('.tour-card');
  await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet');
  const names = await page.locator('.sheet .card.tap').allInnerTexts();
  ok('chooser lists every page tutorial (sheet walkthroughs live behind the sheets’ own ?; the set-up walkthrough has its own button)', names.length === 18 && names.some(n => /Stripboard/.test(n)) && names.some(n => /a log/.test(n)) && names.some(n => /Timecode, start to finish/.test(n)) && names.some(n => /Quotes & invoices, start to finish/.test(n)) && !names.some(n => /Set up/.test(n)), names.join(', '));
  ok('…with the two guides and the set-up walkthrough as buttons', (await page.locator('.sheet button:has-text("Quotes & invoices guide")').count()) === 1 && (await page.locator('.sheet button:has-text("set-up walkthrough")').count()) === 1);
  await page.locator('.sheet .card.tap', { hasText: 'A booking' }).click();
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('choosing “A booking” opens a booking and starts its tutorial', (await page.locator('.bk-detail').count()) === 1 && /booking/i.test(await page.locator('.tour-card h2').innerText()));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes the tutorial and the page is usable again', (await page.locator('.tour').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
  await menuClick(page, '#helpBtn'); await page.waitForSelector('.tour-card'); await page.screenshot({ path: S + '/tutorial.png' }); await page.keyboard.press('Escape');
  // Timecode, start to finish: on the practice log, with the sheets opening and closing along the way
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(700);
  ok('the practice log exists, synced, with notes and a script', await page.evaluate(() => import('./js/store.js').then(s => { const l = s.db.logs.find(x => x.practice); return !!(l && l.sync && l.notes.length >= 3 && l.script); })));
  ok('the practice log is open with a running clock', /^01:1\d:\d\d/.test(await page.locator('.tc-clock').innerText()), await page.locator('.tc-clock').innerText());
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('tccourse')));
  const course = await walk(null);
  ok(`Timecode, start to finish: ${course.cards} steps, ${course.spots} highlighted, closes on Done`, course.cards >= 24 && course.spots >= 15 && course.closed, course.titles.join(' · '));
  ok('the course visited the sync, link and export sheets', ['What the phone thinks', 'Type what the camera shows', 'Link a laptop', 'Export for the editor'].every(t => course.titles.includes(t)));
  ok('no sheet is left open after the course', (await page.locator('.sheet').count()) === 0);
  await page.evaluate(() => { document.querySelector('.tc-log-head .btn.ghost.small')?.click(); }); await sleep(300);
  await page.locator('#page button:has-text("Guide")').first().click(); await page.waitForSelector('.sheet .tc-guide-body');
  const guide = await page.locator('.sheet').last().innerText();
  ok('the timecode guide reads through the whole job', /What timecode is/i.test(guide) && /Before the shoot/i.test(guide) && /Syncing/i.test(guide) && /During the shoot/i.test(guide) && /Scripts/i.test(guide) && /After the shoot/i.test(guide) && /looks wrong/i.test(guide) && /drop frame/i.test(guide)); // headings are shown in capitals
  ok('the guide offers the walkthrough and the practice log', (await page.locator('.sheet button:has-text("Walk me through it")').count()) === 1 && (await page.locator('.sheet button:has-text("practice log")').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);
  await menuClick(page, '#helpBtn'); await page.waitForSelector('.tour-card .tour-actions');
  ok('the timecode page tutorials offer the guide', (await page.locator('.tour-card button:has-text("Guide")').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  // Quotes & invoices, start to finish: through Settings, then a practice job's quote, invoice, a payment and the overview
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('moneycourse')));
  const mc = await walk(null);
  ok(`Quotes & invoices, start to finish: ${mc.cards} steps, ${mc.spots} highlighted, ends on Done at ${mc.cards} / ${mc.cards}`, mc.cards >= 18 && mc.spots >= 14 && mc.closed && mc.label === 'Done' && mc.counter === `${mc.cards} / ${mc.cards}`, `${mc.counter} · ` + mc.titles.join(' · '));
  ok('the course visited the rates, the quote, the invoice, a payment and the overview', ['Your rates, once', 'Getting paid', 'The quote', 'Sent, then accepted', 'Now the invoice', 'The invoice', 'Payments received', 'The Money overview', 'Tidy up'].every(t => mc.titles.includes(t)));
  const practice = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => x.practice); return b && { q: b.quote && b.quote.number + ' ' + b.quote.status, inv: b.invoice && b.invoice.number + ' ' + b.invoice.status + ' ' + (b.invoice.payments || []).length, checks: Object.keys(b.checks || {}), real: s.db.bookings.filter(x => !x.practice && x.quote).map(x => x.quote.number) }; }));
  ok('it ran on a practice job with its own numbers: quote accepted, invoice sent with one payment, the pipeline ticked', practice && practice.q === 'Q-PRACTICE Accepted' && practice.inv === 'INV-PRACTICE Sent 1' && practice.checks.includes('quoted:quote-estimate-sent') && practice.checks.includes('delivered:final-invoice-sent'), JSON.stringify(practice));
  ok('no sheet is left open after the course', (await page.locator('.sheet').count()) === 0);
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openMoneyGuide())); await page.waitForSelector('.sheet .money-guide-body');
  const mg = await page.locator('.sheet').last().innerText();
  ok('the quotes & invoices guide reads through the whole job', /How quotes and invoices work/i.test(mg) && /Before the first quote/i.test(mg) && /Making the quote/i.test(mg) && /From quote to invoice/i.test(mg) && /Getting paid/i.test(mg) && /Late payers/i.test(mg) && /accountant/i.test(mg)); // headings are shown in capitals
  ok('…and offers the walkthrough and the practice job', (await page.locator('.sheet button:has-text("Walk me through it")').count()) === 1 && (await page.locator('.sheet button:has-text("practice job")').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(300);
  // the last card of the course removes the practice job
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('moneycourse'))); await page.waitForSelector('.tour-card');
  for (let i = 0; i < 30 && (await page.locator('.tour-card h2').innerText()) !== 'Tidy up'; i++) { const was = await page.locator('.tour-step').innerText(); await page.locator('.tour-card .btn.primary').click(); await page.waitForFunction(prev => (document.querySelector('.tour-step') || {}).textContent !== prev, was, { timeout: 8000 }).catch(() => {}); await sleep(120); }
  await page.locator('.tour-form button', { hasText: 'Remove the practice job' }).click(); await sleep(500);
  ok('Remove the practice job on the last card takes it away, and the course ends on the month view', !(await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.some(x => x.practice)))) && /removed/.test(await page.locator('.tour-form').innerText()));
  await page.locator('.tour-card .btn.primary').click(); await sleep(300);
  ok('…with the real quotes untouched', (await page.locator('.tour').count()) === 0 && (await page.locator('.bk-month').count()) === 1);
  // The set-up walkthrough (the first-run tour, and Take the tour later): it saves what is typed and adds the samples
  await page.evaluate(() => import('./js/tour.js').then(m => m.startTour())); await page.waitForSelector('.tour-card', { timeout: 10000 }); await sleep(300);
  const seen = []; let calCard = false, samplesSeen = false, removed = false, arrowStayed = false, closedOk = false;
  for (let i = 0; i < 20; i++) {
    const h2 = await page.locator('.tour-card h2').innerText(); seen.push(h2);
    const step = await page.locator('.tour-step').innerText();
    if (h2 === 'You') { await page.locator('.tour-form input[data-key="name"]').fill('Sam Operator'); await page.keyboard.press('ArrowRight'); await sleep(250); arrowStayed = (await page.locator('.tour-card h2').innerText()) === 'You'; await page.locator('.tour-form input[data-key="business"]').fill('Operator Films'); }
    if (h2 === 'How clients reach you') { await page.locator('.tour-form input[data-key="phone"]').fill('+1 555 0199'); await page.locator('.tour-form input[data-key="email"]').fill('sam@example.com'); }
    if (h2 === 'Your website') { await page.locator('.tour-form input[data-key="website"]').fill('https://operator.example'); }
    if (h2 === 'Your calendar') calCard = (await page.locator('.tour-form button[aria-label^="Connect"]').count()) === 2 && /Not ready yet/.test(await page.locator('.tour-form').innerText()) && (await page.locator('.tour-form button[aria-label^="Connect"]').first().isDisabled());
    if (h2 === 'Two sample people') samplesSeen = await page.evaluate(() => import('./js/store.js').then(s => { const t = s.db.crew.find(c => c.id === 'sample-talent'), c = s.db.crew.find(x => x.id === 'sample-crew'); return !!(t && t.role === 'Talent' && t.name === 'Sample talent' && c && c.name === 'Sample crew member'); })) && !(await page.locator('.tour-spot').evaluate(el => el.classList.contains('center')));
    if (h2 === 'Keep the samples?') { await page.locator('.tour-form button', { hasText: 'Remove the samples' }).click(); await sleep(400); removed = await page.evaluate(() => import('./js/store.js').then(s => !s.db.crew.some(c => c.sample))) && /removed/.test(await page.locator('.tour-form').innerText()); }
    const label = await page.locator('.tour-actions .btn.primary').innerText();
    await page.locator('.tour-actions .btn.primary').click();
    if (label === 'Done') { closedOk = (await page.locator('.tour').count()) === 0; break; }
    await page.waitForFunction(prev => !document.querySelector('.tour-card') || (document.querySelector('.tour-step') || {}).textContent !== prev, step, { timeout: 8000 }).catch(() => {}); await sleep(150);
  }
  ok('the set-up walkthrough runs through the deck, your details, the calendar and the samples, and ends on Done', ['Welcome to Vdex', 'Your PIN', 'The Rolodex', 'What is in the deck', 'You', 'How clients reach you', 'Your website', 'Where they live', 'Your calendar', 'Two sample people', 'Removing someone', 'Keep the samples?'].every(t => seen.includes(t)) && closedOk, seen.join(' · '));
  const prof = await page.evaluate(() => import('./js/store.js').then(s => s.db.profile));
  ok('what was typed on the cards is saved to the profile', prof.name === 'Sam Operator' && prof.business === 'Operator Films' && prof.phone === '+1 555 0199' && prof.email === 'sam@example.com' && prof.website === 'https://operator.example', JSON.stringify(prof));
  ok('arrow keys do not move the walkthrough while typing in its fields', arrowStayed);
  ok('the calendar card offers Google and Microsoft from the card itself (greyed until sign-in is switched on), and Next skips it', calCard);
  ok('the samples were added as crew (Sample talent with the Talent role) and removed again from the last card', samplesSeen && removed);
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

const { chromium } = require('playwright');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  ok('the ? button is in the top bar', await page.locator('#helpBtn').isVisible());
  // Walk a tutorial: count the steps that resolved to a highlighted box, and that Done closes it
  const walk = async (btn = '#helpBtn') => {
    if (btn) await page.locator(btn).last().click();
    await page.waitForSelector('.tour-card');
    let spots = 0, cards = 0, titles = [];
    for (let i = 0; i < 40; i++) {
      const h2 = page.locator('.tour-card h2');
      if (!(await h2.count())) { await sleep(600); if (!(await h2.count())) break; } // the tour closed by itself: nothing to point at
      cards++;
      titles.push(await h2.innerText());
      if (!(await page.locator('.tour-spot').evaluate(el => el.classList.contains('center')))) spots++;
      const btn = page.locator('.tour-card .btn.primary');
      const label = await btn.innerText();
      const was = await page.locator('.tour-step').innerText();
      await btn.click();
      if (label === 'Done') break;
      await page.waitForFunction(prev => !document.querySelector('.tour-card') || (document.querySelector('.tour-step') || {}).textContent !== prev, was, { timeout: 8000 }).catch(() => {});
      await sleep(120);
    }
    const closed = (await page.locator('.tour').count()) === 0;
    return { cards, spots, closed, titles };
  };
  const expect = async (name, min, btn) => { const r = await walk(btn); ok(`${name}: ${r.cards} steps, ${r.spots} highlighted, closes on Done`, r.cards >= min && r.spots >= min && r.closed, r.titles.join(' · ')); };
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400); await expect('Bookings calendar', 4);
  await page.evaluate(() => document.querySelector('.bk-month .cal .day.has')?.click()); await sleep(400); await expect('A day', 2);
  await page.evaluate(() => { document.querySelectorAll('.card.tap').forEach(c => { if (/Harbour/.test(c.textContent)) c.click(); }); }); await page.waitForSelector('.bk-detail'); await expect('A booking', 8);
  await page.locator('.bk-tools button').first().click(); await page.waitForSelector('.cs-page'); await expect('Call sheet', 3);
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(300);
  await page.locator('#bk-money button').first().click(); await page.waitForSelector('.money-page'); await expect('Money', 2);
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
  await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card');
  await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet');
  const names = await page.locator('.sheet .card.tap').allInnerTexts();
  ok('chooser lists every page tutorial (sheet walkthroughs live behind the sheets’ own ?)', names.length === 16 && names.some(n => /a log/.test(n)) && names.some(n => /start to finish/.test(n)), names.join(', '));
  await page.locator('.sheet .card.tap', { hasText: 'A booking' }).click();
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('choosing “A booking” opens a booking and starts its tutorial', (await page.locator('.bk-detail').count()) === 1 && /booking/i.test(await page.locator('.tour-card h2').innerText()));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes the tutorial and the page is usable again', (await page.locator('.tour').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
  await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card'); await page.screenshot({ path: S + '/tutorial.png' }); await page.keyboard.press('Escape');
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
  await page.locator('#helpBtn').click(); await page.waitForSelector('.tour-card .tour-actions');
  ok('the timecode page tutorials offer the guide', (await page.locator('.tour-card button:has-text("Guide")').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

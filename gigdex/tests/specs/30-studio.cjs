// The studio: the session clock (start, break, back, stop; the strip on every page; one clock at a time; hours by the
// clock; editing a shift), the Studio log (a new log, + Take, numbering per song, ratings, notes, the keepers filter,
// the CSV), and the session boxes (deliverables, songs, take log). The booking boxes are drawn straight into the page
// here, so this spec does not depend on the Bookings page.
const fs = require('fs');
const { open, ok, sleep, go, topSheet } = require('../helpers.cjs');

const db = (page, fn) => page.evaluate(`import('./js/store.js').then(s => (${fn})(s.db, s))`);
// Draw a booking box into the page and keep it drawn after each change, as the booking page does.
const mount = (page, block, bookingId) => page.evaluate(async ([block, bookingId]) => {
  const m = await import(`./js/blocks/${block}.js`), s = await import('./js/store.js');
  const id = `host-${block}-${bookingId}`;
  let host = document.getElementById(id);
  if (!host) { host = document.createElement('div'); host.id = id; host.className = 'card'; document.body.append(host); }
  const draw = () => { const b = s.byId('bookings', bookingId); host.replaceChildren(); if (b) host.append(m.default.render(b, { sym: '$', open() {} })); };
  draw();
  if (!host.dataset.sub) { host.dataset.sub = '1'; s.subscribe(() => queueMicrotask(draw)); }
}, [block, bookingId]);
const summary = (page, block, bookingId) => page.evaluate(([block, bookingId]) => Promise.all([import(`./js/blocks/${block}.js`), import('./js/store.js')]).then(([m, s]) => m.default.summary(s.byId('bookings', bookingId))), [block, bookingId]);
const ymdOffset = n => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

(async () => {
  const { browser, page, errors } = await open({ sample: true, tab: 'songs' });

  /* ------------------------------ session clock ------------------------------ */
  const sample = await page.evaluate(() => import('./js/clock.js').then(c => c.clockHours('s-sess0')));
  ok('clockHours of the sample shift: 6h15m less a 30 min break is 5.75 h', sample === 5.75, String(sample));
  ok('no clock runs at first, so the strip is hidden', await page.locator('#clockbar').isHidden());
  ok('the session clock box sums up the sample shift', (await summary(page, 'clock', 's-sess0')) === '5h 45m logged', await summary(page, 'clock', 's-sess0'));

  await mount(page, 'clock', 's-sess1');
  await page.waitForSelector('#sd-card-s-sess1-start');
  ok('the box offers Start session', (await page.textContent('#sd-card-s-sess1-start')).includes('Start session'));
  await page.focus('#sd-card-s-sess1-start'); // by keyboard: the focus moves on to Take a break
  await page.keyboard.press('Enter');
  await page.waitForSelector('#clockbar:not([hidden]) .sd-strip');
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'sd-card-s-sess1-break');
  ok('starting by keyboard leaves the focus on Take a break', true);
  let running = await db(page, d => d.shifts.filter(x => !x.end));
  ok('Start session stores one running shift on the session', running.length === 1 && running[0].bookingId === 's-sess1' && running[0].end === null && Array.isArray(running[0].breaks), JSON.stringify(running));
  const stripText = await page.textContent('#clockbar .sd-strip');
  ok('the strip reads Studio · the booking · the time', /Studio · Sable @ Echo Chamber Studios/.test(stripText) && /\d:\d\d:\d\d/.test(stripText), stripText);
  ok('the screen reader is not told every second', (await page.getAttribute('#clockbar', 'aria-live')) === 'off' && (await page.locator('#clockbar [role=status][aria-live=polite]').count()) === 1);
  await page.waitForSelector('#sd-card-s-sess1-break');
  ok('the box now offers Take a break and Stop', (await page.textContent('#sd-card-s-sess1-break')).includes('Take a break') && (await page.locator('#sd-card-s-sess1-stop').count()) === 1);
  const t1 = await page.textContent('#clockbar .sd-strip-time [data-sd-tick]');
  await sleep(2300);
  const t2 = await page.textContent('#clockbar .sd-strip-time [data-sd-tick]');
  ok('the strip time ticks by itself', t1 !== t2, `${t1} → ${t2}`);
  ok('the running time counts in clockHours', await page.evaluate(() => import('./js/clock.js').then(c => c.clockHours('s-sess1') >= 0 && c.runningShift() && c.runningShift().bookingId === 's-sess1')));
  ok('the box summary says it is running', /running/.test(await summary(page, 'clock', 's-sess1')), await summary(page, 'clock', 's-sess1'));

  await go(page, 'venues');
  ok('the strip shows on another section', await page.locator('#clockbar .sd-strip').isVisible());

  // One clock at a time: the rehearsal's Start is greyed out, and starting in code is refused.
  await mount(page, 'clock', 's-reh');
  await page.waitForSelector('#sd-card-s-reh-start');
  ok('another booking cannot start while a clock runs', await page.locator('#sd-card-s-reh-start').isDisabled());
  ok('…and says where the clock is running', (await page.textContent('#host-clock-s-reh')).includes('The clock is running on'));
  const second = await page.evaluate(() => import('./js/clock.js').then(c => c.startShift('s-reh')));
  running = await db(page, d => d.shifts.filter(x => !x.end));
  ok('only one running clock', second === null && running.length === 1);

  // Break and back, from the strip and from the box.
  await page.click('#clockbar #sd-bar-break');
  await page.waitForSelector('#clockbar .sd-strip.on-break');
  let sh = (await db(page, d => d.shifts.filter(x => !x.end)))[0];
  ok('Break from the strip opens a break', sh.breaks.length === 1 && sh.breaks[0].end === null);
  ok('the strip says On a break and offers Back', /On a break/.test(await page.textContent('#clockbar .sd-strip')) && (await page.textContent('#clockbar #sd-bar-break')).includes('Back'));
  await sleep(1100);
  await page.click('#clockbar #sd-bar-break');
  await page.waitForSelector('#clockbar .sd-strip.working');
  sh = (await db(page, d => d.shifts.filter(x => !x.end)))[0];
  ok('Back closes the break', sh.breaks.length === 1 && sh.breaks[0].end > sh.breaks[0].start);
  await page.click('#sd-card-s-sess1-break');
  await page.waitForFunction(() => document.querySelector('#sd-card-s-sess1-break') && document.querySelector('#sd-card-s-sess1-break').textContent.includes('Back'));
  sh = (await db(page, d => d.shifts.filter(x => !x.end)))[0];
  ok('Take a break from the box opens a second break', sh.breaks.length === 2 && sh.breaks[1].end === null);
  await page.click('#sd-card-s-sess1-break');
  await page.waitForFunction(() => document.querySelector('#sd-card-s-sess1-break') && document.querySelector('#sd-card-s-sess1-break').textContent.includes('Take a break'));

  // The clock survives a reload: it is stored.
  await page.reload();
  await page.waitForSelector('#rolodex .drum-btn');
  await page.waitForSelector('#clockbar:not([hidden]) .sd-strip');
  ok('after a reload the strip is back', /Sable @ Echo Chamber Studios/.test(await page.textContent('#clockbar .sd-strip')));

  // Stop from the strip.
  await page.click('#clockbar #sd-bar-stop');
  await page.waitForSelector('#clockbar', { state: 'hidden' });
  const stopped = await db(page, d => d.shifts.filter(x => x.bookingId === 's-sess1'));
  ok('Stop ends the shift and closes its breaks', stopped.length === 1 && stopped[0].end >= stopped[0].start && stopped[0].breaks.every(b => b.end));
  ok('after Stop the strip is gone', await page.locator('#clockbar').isHidden());
  ok('no clock runs any more', await page.evaluate(() => import('./js/clock.js').then(c => c.runningShift() === null)));

  // Fix a shift by hand: the sample shift finishes an hour later.
  await mount(page, 'clock', 's-sess0');
  await page.click('#host-clock-s-sess0 .sd-shift');
  await page.waitForSelector('.sheet[aria-label="Edit shift"]');
  await topSheet(page).locator('[data-key=end]').fill('18:15');
  await topSheet(page).locator('button[type=submit]').click();
  await sleep(300);
  const edited = await page.evaluate(() => import('./js/clock.js').then(c => c.clockHours('s-sess0')));
  ok('editing the finish time changes the hours (6.75 h)', edited === 6.75, String(edited));
  // Add hours by hand, past midnight, with a break.
  await page.click('#sd-add-hours-s-sess0');
  await page.waitForSelector('.sheet[aria-label="Add hours"]');
  const form = topSheet(page);
  await form.locator('[data-key=start]').fill('22:00');
  await form.locator('[data-key=end]').fill('01:30');
  await form.locator('button:has-text("+ Add")').click();
  await form.locator('.rows input[aria-label="Break from"]').fill('23:00');
  await form.locator('.rows input[aria-label="Back at"]').fill('23:30');
  await form.locator('button[type=submit]').click();
  await sleep(300);
  const late = await page.evaluate(() => import('./js/clock.js').then(c => c.clockHours('s-sess0')));
  ok('hours added by hand past midnight, less the break, add 3 h', late === 9.75, String(late));
  ok('the box lists both shifts', (await page.locator('#host-clock-s-sess0 .sd-shift').count()) === 2);

  /* ------------------------------ Studio log ------------------------------ */
  await go(page, 'sessions');
  await page.waitForSelector('.sd-list-view');
  ok('the Studio log lists the sample log', (await page.textContent('.sd-logs')).includes('Glasshouse vocals'));
  await page.click('#sd-new');
  await page.waitForSelector('.sheet[aria-label="New take log"]');
  const nl = topSheet(page);
  await nl.locator('[data-key=title]').fill('Undertow vocals');
  await nl.locator('select').nth(0).selectOption('s-sable2');
  await nl.locator('select').nth(1).selectOption('s-sess1');
  await nl.locator('button[type=submit]').click();
  await page.waitForSelector('#sd-take');
  let log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  ok('a new log is stored with its song, session and start time', !!log && log.songId === 's-sable2' && log.bookingId === 's-sess1' && log.startedAt > 0 && log.takes.length === 0, JSON.stringify(log));
  ok('the log opens with + Take', (await page.textContent('.sd-title h1')) === 'Undertow vocals');

  // The timer keeps going without the page being drawn again.
  await page.evaluate(() => { document.querySelector('.sd-log-view').dataset.marker = 'same'; });
  const tm1 = await page.textContent('.sd-timer');
  await sleep(2200);
  const tm2 = await page.textContent('.sd-timer');
  ok('the log timer ticks', tm1 !== tm2, `${tm1} → ${tm2}`);
  ok('…without redrawing the page', (await page.getAttribute('.sd-log-view', 'data-marker')) === 'same');

  await page.click('#sd-take');
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 1);
  await page.focus('#sd-take');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 2);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'sd-take');
  ok('+ Take by keyboard keeps the focus on + Take', true);
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  ok('+ Take twice stores takes 1 and 2 of Undertow, stamped', log.takes.map(t => t.n).join(',') === '1,2' && log.takes.every(t => t.songId === 's-sable2' && t.at >= log.startedAt && t.rating === ''), JSON.stringify(log.takes));
  ok('the newest take shows first', (await page.locator('.sd-take').first().locator('.sd-take-no b').textContent()) === '2');
  ok('the button says what comes next', (await page.textContent('#sd-take')).includes('Take 3 · Undertow'));

  await page.selectOption('#sd-song', 's-sable1');
  await page.waitForFunction(() => document.querySelector('#sd-take').textContent.includes('Take 1 · Glasshouse'));
  await page.click('#sd-take');
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 3);
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  const g1 = log.takes.find(t => t.songId === 's-sable1');
  ok('a new song starts again at Take 1', !!g1 && g1.n === 1 && log.songId === 's-sable1');

  await page.focus('button[aria-label="Keep: take 2 of Undertow"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Keep: take 2 of Undertow"]')?.getAttribute('aria-pressed') === 'true');
  await sleep(100);
  ok('rating by keyboard keeps the focus on the rating', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Keep: take 2 of Undertow');
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  ok('Keep rates the take', log.takes.find(t => t.n === 2 && t.songId === 's-sable2').rating === 'keep');
  await page.click('button[aria-label="Maybe: take 1 of Undertow"]');
  await sleep(200);
  await page.click('button[aria-label="Maybe: take 1 of Undertow"]');
  await sleep(200);
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  ok('tapping a rating again clears it', log.takes.find(t => t.n === 1 && t.songId === 's-sable2').rating === '');

  await page.click('#sd-note');
  await page.keyboard.type('Late on the chorus');
  ok('the note is stamped when typing starts', /On take 1 of Glasshouse/.test(await page.textContent('#sd-stamp')) && /into the take/.test(await page.textContent('#sd-stamp')));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Late on the chorus/.test(document.querySelector('.sd-takes').textContent));
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  const noted = log.takes.find(t => t.songId === 's-sable1');
  ok('the note goes on the latest take with how far into it', /^\[\d+:\d{2}\] Late on the chorus$/.test(noted.text), noted.text);
  ok('the note box is empty again and keeps the focus', (await page.inputValue('#sd-note')) === '' && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'sd-note');

  await page.click('#sd-f-keep');
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 1);
  ok('Keepers only shows just the keeper', (await page.textContent('.sd-take')).includes('Undertow') && (await page.locator('.sd-take .sd-take-no b').textContent()) === '2');

  await page.click('#sd-export');
  await page.waitForSelector('.sheet[aria-label="Export take log"]');
  ok('the export preview lists the keepers', /KEEPERS\nUndertow: 2/.test(await page.textContent('.sd-export-preview')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sd-csv')]);
  const csvText = fs.readFileSync(await dl.path(), 'utf8');
  ok('the CSV is named after the log', dl.suggestedFilename() === 'Undertow vocals.csv', dl.suggestedFilename());
  ok('the CSV has a header and the keeper (keepers only)', /^Date,Song,Take,Time,Into the log,Rating,Notes\n/.test(csvText) && csvText.trim().split('\n').length === 2 && /,Undertow,2,.*,Keep,/.test(csvText), csvText);
  await page.click('.sheet[aria-label="Export take log"] .sd-export input[type=checkbox]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#sd-csv')]);
  const all = fs.readFileSync(await dl2.path(), 'utf8');
  ok('with Keepers only unticked, the CSV has every take', all.trim().split('\n').length === 4 && all.includes('[') && all.includes('Late on the chorus'), all);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.sheet', { state: 'detached' });

  await page.click('#sd-f-all');
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 3);
  await page.click('button[aria-label="Edit take 1 of Undertow"]');
  await page.waitForSelector('.sheet[aria-label="Edit take"]');
  await topSheet(page).locator('select').first().selectOption('no');
  await topSheet(page).locator('textarea').fill('Count-in was off');
  await topSheet(page).locator('button[type=submit]').click();
  await sleep(250);
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  const t1u = log.takes.find(t => t.n === 1 && t.songId === 's-sable2');
  ok('editing a take saves its rating and note', t1u.rating === 'no' && t1u.text === 'Count-in was off');
  await page.click('button[aria-label="Edit take 1 of Undertow"]');
  await page.waitForSelector('.sheet[aria-label="Edit take"]');
  await topSheet(page).locator('button.danger').click(); // the confirm is accepted
  await sleep(250);
  log = await db(page, d => d.logs.find(l => l.title === 'Undertow vocals'));
  ok('deleting a take removes it (after a confirm)', log.takes.length === 2 && !log.takes.some(t => t.n === 1 && t.songId === 's-sable2'));
  await page.click('#sd-take'); // Glasshouse again: take 2 (numbers are not reused)
  await page.waitForFunction(() => document.querySelectorAll('.sd-take').length === 3);
  await page.selectOption('#sd-song', 's-sable2');
  await page.waitForFunction(() => document.querySelector('#sd-take').textContent.includes('Take 3 · Undertow'));
  ok('take numbers are never reused after a delete', true);

  await page.click('.sd-log-view .back-btn');
  await page.waitForSelector('.sd-list-view');
  const card = page.locator('.sd-log', { hasText: 'Undertow vocals' });
  ok('the list shows the new log with its takes and keepers', (await card.count()) === 1 && /3 takes/.test(await card.textContent()) && /1 keeper/.test(await card.textContent()), await card.textContent());

  /* ------------------------------ take log box ------------------------------ */
  await go(page, 'bookings');
  await mount(page, 'takes', 's-sess1');
  ok('the Take log box lists this session’s log', (await page.textContent('#host-takes-s-sess1')).includes('Undertow vocals'));
  ok('its summary counts logs and keepers', (await summary(page, 'takes', 's-sess1')) === '1 log · 1 keeper', await summary(page, 'takes', 's-sess1'));
  await page.click('#sd-start-log-s-sess1');
  await page.waitForSelector('.sd-log-view #sd-take');
  log = await db(page, d => d.logs.filter(l => l.bookingId === 's-sess1').sort((a, b) => b.startedAt - a.startedAt)[0]);
  ok('Start a take log makes a log for the session’s first song and opens it', log.title === 'Undertow takes' && log.songId === 's-sable2' && (await page.evaluate(() => window.logiPage())) === 'sessions', JSON.stringify(log));
  await go(page, 'bookings');
  await page.click('#host-takes-s-sess1 .sd-log >> nth=1');
  await page.waitForSelector('.sd-log-view');
  ok('tapping a log in the box opens it', (await page.textContent('.sd-title h1')).length > 0 && (await page.evaluate(() => window.logiPage())) === 'sessions');

  /* ------------------------------ deliverables ------------------------------ */
  await go(page, 'bookings');
  await mount(page, 'deliverables', 's-sess1');
  ok('the Deliverables box shows the sample’s two', (await page.locator('#host-deliverables-s-sess1 .sd-dl').count()) === 2);
  ok('its summary: 0 of 2 done, next due', /^0 of 2 done · next due /.test(await summary(page, 'deliverables', 's-sess1')), await summary(page, 'deliverables', 's-sess1'));
  await page.fill('#sd-dl-text-s-sess1', 'Final mix – Undertow');
  await page.fill('#sd-dl-due-s-sess1', ymdOffset(-1));
  await page.click('#sd-dl-add-s-sess1');
  await page.waitForFunction(() => document.querySelectorAll('#host-deliverables-s-sess1 .sd-dl').length === 3);
  let b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  const fm = b.deliverables.find(x => x.t === 'Final mix – Undertow');
  ok('Add stores a deliverable with its due date', !!fm && fm.due === ymdOffset(-1) && fm.done === false);
  ok('a late one is marked overdue', (await page.locator('#host-deliverables-s-sess1 .sd-dl.overdue .sd-due.overdue').textContent()).startsWith('Overdue'));
  ok('the summary counts it overdue', /1 overdue/.test(await summary(page, 'deliverables', 's-sess1')));
  await page.click('#host-deliverables-s-sess1 button[aria-label="Add Stems – Undertow"]');
  await page.waitForFunction(() => document.querySelectorAll('#host-deliverables-s-sess1 .sd-dl').length === 4);
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('a quick preset adds in one tap (named for the session’s song)', b.deliverables.some(x => x.t === 'Stems – Undertow'));
  for (let i = 0; i < 4; i++) {
    await page.locator('#host-deliverables-s-sess1 .sd-dl:not(.done) input[type=checkbox]').first().click();
    await sleep(150);
  }
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('ticking stores done', b.deliverables.every(x => x.done));
  ok('all done ticks “Mixes and stems delivered”', !!(b.checks && b.checks['ses-deliver']));
  ok('the summary says all done', (await summary(page, 'deliverables', 's-sess1')) === 'All 4 done');
  await page.locator('#host-deliverables-s-sess1 .sd-dl.done input[type=checkbox]').first().click();
  await sleep(200);
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('unticking one unticks the checklist line again', !(b.checks && b.checks['ses-deliver']));
  await page.click('#host-deliverables-s-sess1 button[aria-label="Edit Stems – Undertow"]');
  await page.waitForSelector('.sheet[aria-label="Edit deliverable"]');
  await topSheet(page).locator('button.danger').click();
  await sleep(250);
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('a deliverable can be deleted (after a confirm)', b.deliverables.length === 3 && !b.deliverables.some(x => x.t === 'Stems – Undertow'));

  /* ------------------------------ songs worked on ------------------------------ */
  await mount(page, 'worksongs', 's-sess1');
  const sel = page.locator('#host-worksongs-s-sess1 select[aria-label="Status of Undertow"]');
  ok('the Songs box shows Undertow with its status', (await sel.inputValue()) === 'recording');
  await sel.selectOption('mixing');
  await sleep(200);
  ok('changing the status writes the song record', (await db(page, d => d.songs.find(s => s.id === 's-sable2').status)) === 'mixing');
  await page.click('#sd-pick-songs-s-sess1');
  await page.waitForSelector('.sheet[aria-label="Songs for this session"]');
  await topSheet(page).locator('label.check', { hasText: 'Glasshouse' }).locator('input').check();
  await topSheet(page).locator('button[type=submit]').click();
  await sleep(250);
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('ticking a song adds it to the session', JSON.stringify(b.songIds) === '["s-sable2","s-sable1"]', JSON.stringify(b.songIds));
  ok('the summary names the songs', (await summary(page, 'worksongs', 's-sess1')) === 'Undertow, Glasshouse');
  await page.click('#host-worksongs-s-sess1 button[aria-label="Take Glasshouse off this session"]');
  await sleep(200);
  b = await db(page, d => d.bookings.find(x => x.id === 's-sess1'));
  ok('✕ takes a song off the session but keeps the song', JSON.stringify(b.songIds) === '["s-sable2"]' && (await db(page, d => !!d.songs.find(s => s.id === 's-sable1'))));

  /* ------------------------------ edge: a running clock's booking is deleted ------------------------------ */
  await mount(page, 'clock', 's-reh'); // the boxes drawn before the reload are gone
  await page.click('#sd-card-s-reh-start');
  await page.waitForSelector('#clockbar:not([hidden]) .sd-strip');
  ok('a rehearsal clock reads Rehearsal in the strip', /Rehearsal ·/.test(await page.textContent('#clockbar .sd-strip')));
  await page.evaluate(() => import('./js/store.js').then(s => s.remove('bookings', 's-reh')));
  await page.waitForSelector('#clockbar', { state: 'hidden' });
  ok('deleting the booking stops its clock and the strip goes', await page.evaluate(() => import('./js/clock.js').then(c => c.runningShift() === null)));
  ok('…and its shifts go with it (no record left that no page can list)', await db(page, d => !d.shifts.some(s => s.bookingId === 's-reh' || s.bookingId === '')));

  /* ------------------------------ empty database ------------------------------ */
  await page.evaluate(() => import('./js/store.js').then(s => s.eraseAll()));
  await go(page, 'tools');
  await go(page, 'sessions');
  await page.waitForSelector('.sd-list-view .empty');
  ok('an empty Studio log explains itself and offers a new log', (await page.textContent('.sd-list-view .empty')).includes('Log takes while you record') && (await page.locator('.sd-list-view .empty button').count()) === 1);

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL studio crashed — ' + e.message); process.exit(1); });

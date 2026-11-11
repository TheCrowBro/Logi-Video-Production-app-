// Venues: the empty state, adding a venue with the form, kind filters and search, the venue sheet (map, details,
// bookings there past and upcoming, live after an edit), venueWarnings for the booking page (curfew past midnight,
// capacity, a later curfew, load-in after soundcheck, the noise limit as information), + Book here, and deleting.
const { open, ok, sleep, go } = require('../helpers.cjs');

// A blank map tile, so the mini map loads without a 404 in the console.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const store = (page, fn, arg) => page.evaluate(fn, arg); // fn reads the store module from window.__s
const sheetTitle = page => page.evaluate(() => { const all = document.querySelectorAll('.sheet[aria-label]'); return all.length ? all[all.length - 1].getAttribute('aria-label') : ''; });
const text = async (page, sel) => ((await page.locator(sel).count()) ? page.locator(sel).first().innerText() : '');
const cards = page => page.locator('#page .vn-card').count();
const flat = s => String(s).replace(/\s*\n\s*/g, ' / ');

(async () => {
  const { browser, ctx, page, errors } = await open({ tab: 'venues' });
  await ctx.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  await page.waitForSelector('#page .vn-head');
  await page.evaluate(() => import('./js/store.js').then(s => { window.__s = s; }));

  /* ---------------- empty, and adding one with the form ---------------- */
  ok('an empty venues page says what goes here', /clubs, halls, studios and rehearsal rooms/.test(await text(page, '#page .empty')));
  await page.click('#vn-first');
  await page.waitForSelector('.sheet form');
  ok('Add a venue opens the form', (await sheetTitle(page)) === 'Add venue');
  await page.fill('.sheet [data-key=name]', 'The Crow Bar');
  await page.selectOption('.sheet select[id$="-kind"]', 'venue');
  await page.fill('.sheet [data-key=address]', '5 Raven Lane\nHarbourtown');
  await page.fill('.sheet input[aria-label=Latitude]', '51.5');
  await page.fill('.sheet input[aria-label=Longitude]', '-0.12');
  await page.fill('.sheet [data-key=capacity]', '120');
  await page.fill('.sheet [data-key=curfew]', '00:30');
  await page.fill('.sheet [data-key=noiseLimit]', '100');
  await page.fill('.sheet [data-key=stage]', '4m × 3m');
  await page.fill('.sheet [data-key=contact]', 'Corvin');
  await page.fill('.sheet [data-key=phone]', '+1 555 0199');
  await page.fill('.sheet [data-key=website]', 'crowbar.example');
  await page.click('.sheet button[type=submit]');
  await sleep(300);
  const crow = await store(page, () => window.__s.db.venues.find(v => v.name === 'The Crow Bar'));
  ok('the venue is stored with numbers as numbers', crow && crow.capacity === 120 && crow.noiseLimit === 100 && crow.kind === 'venue', JSON.stringify(crow));
  ok('…with the curfew, the address and the map location', crow && crow.curfew === '00:30' && crow.address === '5 Raven Lane\nHarbourtown' && crow.geo && crow.geo.lat === 51.5 && crow.geo.lon === -0.12);
  const crowCard = await text(page, '#vn-' + crow.id);
  ok('its card shows the address on one line and the facts', /5 Raven Lane, Harbourtown/.test(crowCard) && /Holds 120/.test(crowCard) && /Curfew 00:30/.test(crowCard) && /100 dB/.test(crowCard), flat(crowCard));
  ok('no kind chips with only one kind of place', (await page.locator('#page .vn-kinds').count()) === 0);

  /* ---------------- the sample: filters and search ---------------- */
  await page.evaluate(() => window.__s.loadSample());
  await sleep(300);
  ok('every place shows, sorted by name', (await cards(page)) === 6 && (await page.locator('#page .vn-card-name').first().innerText()) === 'Basement Rehearsal Rooms');
  ok('kind chips show the kinds there are, with counts', /All 6/.test(await text(page, '#vn-kind-all')) && /Venue 3/.test(await text(page, '#vn-kind-venue')) && (await page.locator('#vn-kind-other').count()) === 0);
  await page.click('#vn-kind-studio');
  ok('the Studio chip shows only studios', (await cards(page)) === 1 && (await page.locator('#vn-s-echo').count()) === 1);
  ok('the chip is pressed and keeps the focus', (await page.getAttribute('#vn-kind-studio', 'aria-pressed')) === 'true' && (await page.evaluate(() => document.activeElement.id)) === 'vn-kind-studio');
  ok('a studio card shows its rate', /\$45 per hour/.test(await text(page, '#vn-s-echo')));
  await page.click('#vn-kind-all');
  await page.click('#vn-search');
  await page.keyboard.type('pier');
  await sleep(150);
  ok('search finds a place by its address', (await cards(page)) === 1 && (await page.locator('#vn-s-harbour').count()) === 1);
  ok('the search box keeps the focus while typing', (await page.evaluate(() => document.activeElement.id)) === 'vn-search');
  await page.fill('#vn-search', 'nowhere at all');
  ok('no match says so', /No place matches/.test(await text(page, '#page .empty')));
  await page.click('#vn-clear');
  ok('Show every place clears the search', (await cards(page)) === 6);
  ok('a card shows the next booking there (without repeating the venue)', /Next: .*The Night Owls/.test(await text(page, '#vn-s-lantern')) && !/@/.test(await text(page, '#vn-s-lantern .vn-next')));

  /* ---------------- the venue sheet ---------------- */
  await page.click('#vn-s-lantern');
  await page.waitForSelector('.vn-sheet');
  ok('tapping a venue opens its sheet', (await sheetTitle(page)) === 'The Lantern Rooms');
  const details = await text(page, '.vn-sheet .vn-details');
  ok('the sheet shows the details a band needs', ['350', '6m × 4m', 'Midas M32', 'Drum kit shell pack', 'Ship Lane', '23:00', '98 dB'].every(x => details.includes(x)), flat(details));
  ok('the sheet has the map and map buttons', (await page.locator('.vn-sheet .vn-map .minimap').count()) === 1 && /Directions/.test(await text(page, '.vn-sheet .vn-map')));
  ok('the sheet has contact buttons', (await page.locator('.vn-sheet .vn-contact a[href^="tel:"]').count()) === 1 && (await page.locator('.vn-sheet .vn-contact a[href="mailto:rosa@example.com"]').count()) === 1);
  ok('upcoming bookings there are listed', (await page.locator('.vn-sheet #vn-bk-s-show1').count()) === 1 && /Coming up here \(1\)/i.test(await text(page, '.vn-bookings')));
  ok('past bookings there are listed too', (await page.locator('.vn-sheet #vn-bk-s-past').count()) === 1 && /Before \(1\)/i.test(await text(page, '.vn-bookings')) && /Done/.test(await text(page, '#vn-bk-s-past')));
  ok('the sample show has no warning row', (await page.locator('#vn-bk-s-show1 .vn-row-warn').count()) === 0);
  await page.click('#vn-edit');
  await page.waitForSelector('.sheet[aria-label="Edit venue"]');
  ok('Edit opens the form with the venue filled in', (await page.inputValue('.sheet[aria-label="Edit venue"] [data-key=capacity]')) === '350');
  await page.fill('.sheet[aria-label="Edit venue"] [data-key=capacity]', '300');
  await page.click('.sheet[aria-label="Edit venue"] button[type=submit]');
  await sleep(300);
  ok('the edit is stored', (await store(page, () => window.__s.byId('venues', 's-lantern').capacity)) === 300);
  ok('the open sheet follows the edit', /300/.test(await text(page, '.vn-sheet .vn-details')));
  ok('…and now warns that the deal counts on more than the room holds', /The deal counts on 350 tickets, but The Lantern Rooms holds 300/.test(await text(page, '#vn-bk-s-show1')), flat(await text(page, '#vn-bk-s-show1')));
  await store(page, () => window.__s.patch('venues', 's-lantern', { capacity: 350 }));
  await sleep(200);
  await page.click('#vn-bk-s-show1');
  await sleep(500);
  ok('tapping a booking closes the sheet and opens it in Bookings', (await page.locator('.vn-sheet').count()) === 0 && (await page.evaluate(() => window.logiPage())) === 'bookings');
  await go(page, 'venues');

  /* ---------------- venueWarnings ---------------- */
  const w = await page.evaluate(async crowId => {
    const v = await import('./js/pages/venues.js'), s = window.__s;
    const show1 = s.byId('bookings', 's-show1');
    return {
      late: v.venueWarnings({ ...show1, setTime: '22:30', setLength: 45 }),
      show1: v.venueWarnings(show1),
      session: v.venueWarnings(s.byId('bookings', 's-sess1')),
      noVenue: v.venueWarnings({ kind: 'show', setTime: '22:30', setLength: 45, curfew: '23:00' }),
      gone: v.venueWarnings({ ...show1, venueId: 'not-there' }),
      nothing: v.venueWarnings(null),
      pastMidnightOk: v.venueWarnings({ kind: 'show', venueId: crowId, doors: '20:00', setTime: '23:30', setLength: 45 }),
      pastMidnightLate: v.venueWarnings({ kind: 'show', venueId: crowId, doors: '20:00', setTime: '23:50', setLength: 45 }),
      onlySetTime: v.venueWarnings({ kind: 'show', venueId: 's-lantern', setTime: '23:30', setLength: 30 }),
      morningFestival: v.venueWarnings({ kind: 'show', venueId: 's-greenfield', setTime: '10:00', setLength: 40 }),
      capacity: v.venueWarnings({ ...show1, deal: { ...show1.deal, capacity: 400 } }),
      laterCurfew: v.venueWarnings({ ...show1, curfew: '23:30' }),
      loadIn: v.venueWarnings({ ...show1, loadIn: '18:30', soundcheck: '18:00' }),
      rehearsal: v.venueWarnings({ kind: 'rehearsal', venueId: crowId, start: '22:00', end: '01:00' }),
    };
  }, crow.id);
  const has = (list, re) => list.some(x => re.test(x));
  ok('a set ending 23:15 at a 23:00 curfew warns', has(w.late, /Your set ends at 23:15, 15m after the 23:00 curfew at The Lantern Rooms\./), JSON.stringify(w.late));
  ok('the sample show (set ends 22:00) has no curfew or other warning', !has(w.show1, /curfew|holds|Load-in/) && w.show1.length === 1, JSON.stringify(w.show1));
  ok('a show tells the noise limit as information', has(w.show1, /Noise limit 98 dB/));
  ok('a studio session with no curfew has nothing to say', w.session.length === 0, JSON.stringify(w.session));
  ok('no venue, an unknown venue or no booking: an empty array', Array.isArray(w.noVenue) && w.noVenue.length === 0 && w.gone.length === 0 && Array.isArray(w.nothing) && w.nothing.length === 0);
  ok('past midnight: a set ending 00:15 at a 00:30 curfew is fine', !has(w.pastMidnightOk, /curfew/), JSON.stringify(w.pastMidnightOk));
  ok('past midnight: a set ending 00:35 at a 00:30 curfew warns', has(w.pastMidnightLate, /ends at 00:35, 5m after the 00:30 curfew at The Crow Bar/), JSON.stringify(w.pastMidnightLate));
  ok('a set that starts after the curfew warns', has(w.onlySetTime, /The curfew at The Lantern Rooms \(23:00\) is before your set starts \(23:30\)/), JSON.stringify(w.onlySetTime));
  ok('a morning festival set is not read as after the evening curfew', !has(w.morningFestival, /curfew/), JSON.stringify(w.morningFestival));
  ok('a deal counting on more people than the venue holds warns', has(w.capacity, /400 tickets, but The Lantern Rooms holds 350/));
  ok('a booking curfew later than the venue’s warns', has(w.laterCurfew, /curfew \(23:30\) is later than the usual 23:00 at The Lantern Rooms/));
  ok('load-in after soundcheck warns', has(w.loadIn, /Load-in \(18:30\) is after soundcheck \(18:00\)/));
  ok('a rehearsal running past the room’s curfew warns', has(w.rehearsal, /runs to 01:00, 30m past the 00:30 curfew at The Crow Bar/), JSON.stringify(w.rehearsal));

  /* ---------------- + Book here ---------------- */
  await page.click('#vn-s-echo');
  await page.waitForSelector('.vn-sheet');
  ok('a studio with nothing coming up says what + Book here does', /starts a studio session at Echo Chamber Studios/.test(await text(page, '.vn-bookings')) || (await page.locator('.vn-bookings .vn-row').count()) > 0);
  await page.click('#vn-book');
  await sleep(600);
  ok('+ Book here closes the venue sheet and starts a booking', (await page.locator('.vn-sheet').count()) === 0
    && ((await page.evaluate(() => window.logiPage())) === 'bookings' || (await page.locator('.sheet').count()) > 0));
  await page.evaluate(() => document.querySelectorAll('.sheet-back').forEach(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))));
  await sleep(200);
  await go(page, 'venues');

  /* ---------------- delete ---------------- */
  await page.click('#vn-s-harbour');
  await page.waitForSelector('.vn-sheet');
  await page.click('#vn-edit');
  await page.waitForSelector('.sheet[aria-label="Edit venue"]');
  await page.click('.sheet[aria-label="Edit venue"] .btn.danger');
  await sleep(300);
  ok('Delete (confirmed) removes the venue', !(await store(page, () => window.__s.byId('venues', 's-harbour'))));
  ok('…its sheet closes', (await page.locator('.sheet').count()) === 0);
  const show2 = await store(page, () => window.__s.byId('bookings', 's-show2'));
  ok('…and bookings there keep its name and address', show2.venueId === '' && show2.venueName === 'Harbour Hall' && show2.address === '1 Pier Road, Harbourtown');
  await page.click('#vn-kind-festival');
  await store(page, () => window.__s.remove('venues', 's-greenfield'));
  await sleep(250);
  ok('a filter on a kind with nothing left goes back to all', (await cards(page)) === 4 && (await page.getAttribute('#vn-kind-all', 'aria-pressed')) === 'true');
  await page.click('#vn-s-basement');
  await page.waitForSelector('.vn-sheet');
  await store(page, () => window.__s.remove('venues', 's-basement'));
  await sleep(250);
  ok('a venue deleted elsewhere closes its open sheet', (await page.locator('.vn-sheet').count()) === 0);
  const openGone = await page.evaluate(() => import('./js/pages/venues.js').then(v => v.openVenue('s-basement')));
  await sleep(150);
  ok('openVenue on a deleted venue opens nothing', openGone === null && (await page.locator('.sheet').count()) === 0);

  /* ---------------- walkthroughs ---------------- */
  await page.click('#helpBtn');
  await page.waitForSelector('.tour-card h2');
  ok('the ? walkthrough starts on the venues page', (await text(page, '.tour-card h2')) === 'Places you play and record');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('#vn-s-lantern');
  await page.waitForSelector('.vn-sheet');
  await page.click('.sheet .sheet-help');
  await page.waitForSelector('.tour-card h2');
  ok('the venue sheet has its own walkthrough', (await text(page, '.tour-card h2')) === 'Book here');
  await page.keyboard.press('Escape');
  await sleep(150);
  await page.keyboard.press('Escape');

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL venues crashed — ' + e.message); process.exit(1); });

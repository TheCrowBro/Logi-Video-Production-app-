// Backline: the empty state, adding an item with a quantity and an owner, the total value, owner filters and search,
// the item sheet with the bookings using it (and a clash), stage packs with quantities, the inventory print and CSV,
// a pack's packing list, deleting, and an item deleted while its sheet is open.
const fs = require('fs');
const { open, ok, sleep, go } = require('../helpers.cjs');

const gear = (page, id) => page.evaluate(i => import('./js/store.js').then(s => s.byId('gear', i)), id);
// Runs fn(store module, arg) in the page (the module is put on window.__s once, below).
const store = (page, fn, arg) => page.evaluate(fn, arg);
const sheetTitle = page => page.evaluate(() => { const all = document.querySelectorAll('.sheet[aria-label]'); return all.length ? all[all.length - 1].getAttribute('aria-label') : ''; });
const text = async (page, sel) => ((await page.locator(sel).count()) ? page.locator(sel).first().innerText() : '');
const cards = page => page.locator('#page .bl-card').count();

(async () => {
  const { browser, page, errors } = await open({ tab: 'backline' });
  await page.waitForSelector('#page .bl-head');
  await page.evaluate(() => import('./js/store.js').then(s => { window.__s = s; }));

  /* ---------------- empty ---------------- */
  ok('an empty backline says what goes here', /guitar, amp, mic and DI/.test(await text(page, '#page .empty')));
  ok('no stats or inventory buttons without items', (await page.locator('#page .bl-stats, #page .bl-docs').count()) === 0);
  await page.click('#bl-tab-packs');
  ok('the packs view asks for items first', /items first/.test(await text(page, '#page .empty')));
  ok('the packs tab is selected', (await page.getAttribute('#bl-tab-packs', 'aria-selected')) === 'true');
  await page.click('#bl-tab-items');

  /* ---------------- the sample ---------------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.waitForSelector('#page .bl-stats');
  ok('the stats show 18 items', /^18\s*items/.test((await text(page, '#page .bl-stats .stat')).trim()));
  ok('the total value stat adds up every item × quantity', (await text(page, '#page .bl-total b')) === '$11,739', await text(page, '#page .bl-total b'));
  ok('items are grouped by category in GEAR_CATS order', (await page.locator('#page .bl-group h3 > span:first-child').allInnerTexts()).map(s => s.toLowerCase()).join('|') === 'guitars|basses|amps & cabs|drums & percussion|keys & synths|microphones|di & interfaces|computers & software');
  const tele = await text(page, '#bl-item-s-tele');
  ok('a card shows make and model, owner, serial and value', /Fender Player Telecaster/.test(tele) && /Maya Brooks/.test(tele) && /S\/N MX21000001/.test(tele) && /\$800/.test(tele), tele.replace(/\n/g, ' / '));
  ok('a card with several shows the quantity and the value each', /×4/.test(await text(page, '#bl-item-s-sm58')) && /\$99 each · \$396/.test(await text(page, '#bl-item-s-sm58')));
  ok('an item on a booking ahead says so', /1 booked/.test(tele));
  ok('a band item says Band', /Band/.test(await text(page, '#bl-item-s-hotrod')));

  /* ---------------- add an item with qty 2 ---------------- */
  await page.click('#bl-add');
  await page.waitForSelector('.sheet form');
  ok('+ Add opens the Add item form', (await sheetTitle(page)) === 'Add item');
  const owners = await page.locator('.sheet select[id$="-owner"] option').allInnerTexts();
  ok('the owner list starts with Nobody / the band, then people', owners[0] === 'Nobody / the band' && owners.some(o => /Priya Shah/.test(o)), owners.slice(0, 3).join(', '));
  await page.fill('.sheet [data-key=name]', 'Beta 52A');
  await page.selectOption('.sheet select[id$="-category"]', 'Microphones');
  await page.fill('.sheet [data-key=make]', 'Shure');
  await page.fill('.sheet [data-key=model]', 'Beta 52A');
  await page.fill('.sheet [data-key=serial]', 'B52-0001');
  await page.fill('.sheet [data-key=qty]', '2');
  await page.fill('.sheet [data-key=value]', '189.50');
  await page.selectOption('.sheet select[id$="-owner"]', 's-priya');
  await page.fill('.sheet [data-key=location]', 'Van');
  await page.click('.sheet button[type=submit]');
  await sleep(300);
  const added = await store(page, () => window.__s.db.gear.find(g => g.name === 'Beta 52A'));
  ok('the new item is stored with qty 2 as a number', added && added.qty === 2, JSON.stringify(added));
  ok('…with its value, category, owner, make and serial', added && added.value === 189.5 && added.category === 'Microphones' && added.owner === 's-priya' && added.make === 'Shure' && added.serial === 'B52-0001' && added.location === 'Van');
  ok('the form closed', (await page.locator('.sheet').count()) === 0);
  ok('the total value now includes 2 × $189.50', (await text(page, '#page .bl-total b')) === '$12,118', await text(page, '#page .bl-total b'));
  ok('the item count is 20', /^20\s*items/.test((await text(page, '#page .bl-stats .stat')).trim()));
  const card = await text(page, '#bl-item-' + added.id);
  ok('its card shows ×2, the owner, the place and both values', /×2/.test(card) && /Priya Shah/.test(card) && /Van/.test(card) && /\$189\.50 each · \$379/.test(card), card.replace(/\n/g, ' / '));

  /* ---------------- filters ---------------- */
  await page.click('#bl-own-s-priya');
  ok('the owner filter shows only Priya’s gear', (await cards(page)) === 2);
  ok('the chip keeps the focus after the redraw', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'bl-own-s-priya');
  await page.click('#bl-own-band');
  ok('Band-owned shows what nobody owns on their own', (await cards(page)) === 6, String(await cards(page)));
  await page.click('#bl-own-all');
  ok('Everyone shows every item again', (await cards(page)) === 11);
  await page.click('#bl-search');
  await page.keyboard.type('MX21');
  await sleep(150);
  ok('search finds an item by its serial', (await cards(page)) === 1 && (await page.locator('#bl-item-s-tele').count()) === 1);
  ok('the search box keeps the focus while typing', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'bl-search');
  await page.fill('#bl-search', 'zzz-nothing');
  ok('no match says so and offers to show everything', /Nothing matches/.test(await text(page, '#page .empty')) && (await page.locator('#bl-clear').count()) === 1);
  await page.click('#bl-clear');
  ok('Show everything clears the search', (await cards(page)) === 11 && (await page.inputValue('#bl-search')) === '');

  /* ---------------- the item sheet: bookings using it ---------------- */
  await page.click('#bl-item-s-tele');
  await page.waitForSelector('.bl-sheet');
  ok('tapping an item opens its sheet', (await sheetTitle(page)) === 'Telecaster');
  ok('the sheet lists its details', /MX21000001/.test(await text(page, '.bl-sheet .bl-kv')) && /Maya Brooks/.test(await text(page, '.bl-sheet .bl-kv')));
  ok('the sheet lists the booking using it (store.gearBookings)', (await page.locator('.bl-sheet #bl-bk-s-show1').count()) === 1 && /The Night Owls @ The Lantern Rooms/.test(await text(page, '#bl-bk-s-show1')));
  ok('it says which stage packs hold it', /Club show pack/.test(await text(page, '.bl-in-packs')));
  // Another show the same day that needs the only Telecaster: the sheet warns.
  await store(page, () => { const s = window.__s, day = s.byId('bookings', 's-show1').date; s.patch('bookings', 's-show2', { date: day, gear: ['s-tele'] }); });
  await sleep(250);
  ok('a clash with another booking the same day is shown', /Also needed at .*Harbour Hall/.test(await text(page, '#bl-bk-s-show1')), (await text(page, '#bl-bk-s-show1')).replace(/\s*\n\s*/g, ' / '));
  // Edit from the sheet: the sheet follows the change.
  await page.click('#bl-edit');
  await page.waitForSelector('.sheet[aria-label="Edit item"]');
  await page.fill('.sheet[aria-label="Edit item"] [data-key=location]', 'Rehearsal room');
  await page.click('.sheet[aria-label="Edit item"] button[type=submit]');
  await sleep(300);
  ok('editing from the sheet stores the change', (await gear(page, 's-tele')).location === 'Rehearsal room');
  ok('the open sheet shows the change', /Rehearsal room/.test(await text(page, '.bl-sheet .bl-kv')));
  await page.click('#bl-bk-s-show1');
  await sleep(500);
  ok('tapping the booking closes the sheet and opens Bookings', (await page.locator('.bl-sheet').count()) === 0 && (await page.evaluate(() => window.logiPage())) === 'bookings');
  await go(page, 'backline');

  /* ---------------- stage packs ---------------- */
  await page.click('#bl-tab-packs');
  await page.waitForSelector('#page .bl-pack');
  const club = await text(page, '#page .bl-pack[data-id="s-clubpack"]');
  ok('a pack shows its pieces and value (quantities counted)', /9 pieces · \$6,745/.test(club), club.split('\n')[1]);
  ok('a pack lists items by category with ×n', /Microphones: SM58 ×2/.test(club) && /DI & interfaces: DI box ×3/.test(club));
  await page.click('#bl-add');
  await page.waitForSelector('.sheet form');
  ok('+ New pack opens the stage pack form', (await sheetTitle(page)) === 'New stage pack');
  ok('the picker groups items by category', (await page.locator('.sheet .checks legend').allInnerTexts()).includes('Microphones'));
  await page.fill('.sheet [data-key=name]', 'Festival pack');
  await page.locator('.sheet label.check', { hasText: 'Telecaster' }).click();
  await page.click('.sheet button[aria-label="One more SM58"]');
  await page.click('.sheet button[aria-label="One more SM58"]');
  await page.click('.sheet button[type=submit]');
  await sleep(300);
  const pack = await store(page, () => window.__s.db.kits.find(k => k.name === 'Festival pack'));
  ok('the pack is stored with its items', pack && pack.items.length === 2 && pack.items.includes('s-tele') && pack.items.includes('s-sm58'), JSON.stringify(pack && pack.items));
  ok('…and the quantity of each (only those above one)', pack && JSON.stringify(pack.qty) === '{"s-sm58":3}', JSON.stringify(pack && pack.qty));
  ok('its card shows 4 pieces worth $1,097', /4 pieces · \$1,097/.test(await text(page, `#page .bl-pack[data-id="${pack.id}"]`)));
  // Edit: the form opens with the saved quantity.
  await page.click(`#page .bl-pack[data-id="${pack.id}"] button[aria-label="Edit Festival pack"]`);
  await page.waitForSelector('.sheet form');
  ok('editing a pack shows the saved quantity', (await page.inputValue('.sheet input[aria-label^="Quantity of SM58"]')) === '3');
  await page.click('.sheet button[aria-label="One fewer SM58"]');
  await page.click('.sheet button[type=submit]');
  await sleep(300);
  ok('lowering it to 2 is stored', JSON.stringify((await store(page, id => window.__s.byId('kits', id), pack.id)).qty) === '{"s-sm58":2}');
  await page.click('#page .bl-pack[data-id="s-clubpack"] button[aria-label="Duplicate Club show pack"]');
  await sleep(250);
  ok('Duplicate makes a copy of a pack', (await store(page, () => window.__s.db.kits.filter(k => k.name === 'Club show pack (copy)').length)) === 1);

  /* ---------------- printing and saving ---------------- */
  await page.evaluate(() => { window.__printed = []; window.print = () => { const r = document.getElementById('print-root'); window.__printed.push(r ? r.innerHTML : ''); window.dispatchEvent(new Event('afterprint')); }; });
  await page.click(`#page .bl-pack[data-id="${pack.id}"] button[aria-label="Print the packing list for Festival pack"]`);
  await sleep(300);
  let printed = await page.evaluate(() => window.__printed.pop() || '');
  ok('a pack prints a packing list with tick boxes', /PACKING LIST/.test(printed) && /Festival pack/.test(printed) && /☐/.test(printed) && /Telecaster/.test(printed));
  await page.click('#bl-tab-items');
  await page.click('#bl-inv');
  await page.waitForSelector('.bl-inv-paper .cs-doc');
  ok('Inventory opens a preview of the document', (await sheetTitle(page)) === 'Backline inventory' && (await page.locator('.bl-inv-paper tr.bl-line').count()) === 11);
  await page.click('#bl-inv-print');
  await sleep(300);
  printed = await page.evaluate(() => window.__printed.pop() || '');
  ok('Print puts the inventory .cs-doc in the print root', /class="cs-doc bl-inv"/.test(printed) && (printed.match(/class="bl-line"/g) || []).length === 11);
  ok('the printed inventory has make, model, serial, qty, value and owner columns', ['Make', 'Model', 'Serial', 'Qty', 'Value each', 'Total', 'Owner'].every(c => printed.includes(`>${c}<`)) && /MX21000001/.test(printed) && /Priya Shah/.test(printed));
  ok('…and the total value', /\$12,118/.test(printed));
  ok('the print root is gone after printing', (await page.locator('#print-root').count()) === 0);
  await page.selectOption('#bl-inv-who', 's-priya');
  await sleep(150);
  ok('Whose gear narrows the inventory to one person', (await page.locator('.bl-inv-paper tr.bl-line').count()) === 2 && /Backline: Priya Shah/.test(await text(page, '.bl-inv-paper h2')));
  let [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bl-inv-csv')]);
  let file = fs.readFileSync(await dl.path(), 'utf8');
  ok('the inventory CSV downloads with a name and a header row', /^Backline inventory Priya Shah \d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && /^﻿#,Item,Category,Make,Model,Serial number,Quantity/.test(file), dl.suggestedFilename());
  ok('…holding only Priya’s gear', /Drum kit/.test(file) && /Beta 52A/.test(file) && !/Telecaster/.test(file));
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bl-inv-html')]);
  file = fs.readFileSync(await dl.path(), 'utf8');
  ok('Web page saves a standalone document', /\.html$/.test(dl.suggestedFilename()) && /<!doctype html>/i.test(file) && /BACKLINE INVENTORY/.test(file));
  await page.keyboard.press('Escape');
  await sleep(200);
  [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bl-csv')]);
  file = fs.readFileSync(await dl.path(), 'utf8');
  const lines = file.trim().split(/\r?\n/);
  ok('the page CSV lists every item and a total row', lines.length === 13 && /Telecaster/.test(file) && /^,Total,,,,,20,,12118,/.test(lines[lines.length - 1]), lines[lines.length - 1]);

  /* ---------------- delete ---------------- */
  await page.click('#bl-item-' + added.id);
  await page.waitForSelector('.bl-sheet');
  await page.click('#bl-edit');
  await page.waitForSelector('.sheet[aria-label="Edit item"]');
  await page.click('.sheet[aria-label="Edit item"] .btn.danger');
  await sleep(300);
  ok('Delete (confirmed) removes the item from the store', !(await gear(page, added.id)));
  ok('…and its sheet closes', (await page.locator('.sheet').count()) === 0);
  ok('…and the page no longer shows it', (await page.locator('#bl-item-' + added.id).count()) === 0);
  await page.click('#bl-item-s-pbass');
  await page.waitForSelector('.bl-sheet');
  await store(page, () => window.__s.remove('gear', 's-pbass'));
  await sleep(250);
  ok('an item deleted elsewhere closes its open sheet', (await page.locator('.bl-sheet').count()) === 0);
  await store(page, () => window.__s.remove('people', 's-maya'));
  await sleep(250);
  ok('an item whose owner was deleted reads as the band’s', /Band/.test(await text(page, '#bl-item-s-tele')));

  /* ---------------- walkthroughs ---------------- */
  await page.click('#helpBtn');
  await page.waitForSelector('.tour-card h2');
  ok('the ? walkthrough starts on the backline page', (await text(page, '.tour-card h2')) === 'Your backline');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.click('#bl-item-s-hotrod');
  await page.waitForSelector('.bl-sheet');
  await page.click('.sheet .sheet-help');
  await page.waitForSelector('.tour-card h2');
  ok('the item sheet has its own walkthrough', (await text(page, '.tour-card h2')) === 'The details');
  await page.keyboard.press('Escape');
  await sleep(150);
  await page.keyboard.press('Escape');

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL backline crashed — ' + e.message); process.exit(1); });

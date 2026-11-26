// The stripboard: scenes read from a script (headings, cast, descriptions, page counts), colour-coded strips, day
// breaks with page totals, dragging and keyboard moves, editing, spreading over the days, grouping by location, the
// call sheet's Scenes section, the crew link (never the private notes), merging across devices and printing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

const SCRIPT = `Title: Harbour Lights
Author: Test

FADE IN:

1 INT. HARBOUR BREWING TAPROOM - MORNING 1

Early light through the dock windows. Steam rises off the mash tun.

ANA
(to camera)
Every batch starts before sunrise.

TOM (O.S.)
Ana! The van's here.

2 EXT. LOADING BAY - CONTINUOUS 2

TOM rolls a keg to the van. He nods at the camera but doesn't stop.

TOM
Interview's at ten. I've got forty of these first.

3 INT. TOM'S VAN - DAY 3

Tom drives along the coast road, radio on, the harbour sliding past the window.

4 EXT. HARBOUR WALL - NIGHT 4

The lighthouse sweeps the water. Ana and Tom sit with two bottles.

ANA
Do you ever think about stopping?

MAYA (V.O.)
They never stopped.

INT./EXT. TAPROOM OFFICE - NIGHT #5#

Ana alone with invoices. She rubs her eyes.

ANA (CONT'D)
One more year.

6 EXT. FISH MARKET - DAWN 6

Crates of ice. MAYA, 60s, haggles with a trawlerman.

MAYA
You call that fresh?

7 INT. HARBOUR BREWING TAPROOM - DAY 7

The taproom is full. Ana pours. Tom carries crates. Maya watches from the corner.
`;

(async () => {
  const file = path.join(os.tmpdir(), `harbour-${process.pid}.fountain`); fs.writeFileSync(file, SCRIPT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, serviceWorkers: 'block' });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');

  // ---- reading a script ----
  const parsed = await page.evaluate(src => import('./js/stripboard.js').then(m => m.parseScenes(src).map(s => ({ scene: s.scene, ie: s.ie, set: s.set, tod: s.tod, dn: s.dn, cast: s.cast, desc: s.desc, eighths: s.eighths }))), SCRIPT);
  const by = n => parsed.find(s => s.scene === n) || {};
  ok('each scene heading becomes a scene, and the title page is left out', parsed.length === 7 && parsed.map(s => s.scene).join() === '1,2,3,4,5,6,7', parsed.map(s => s.scene + ':' + s.set).join(' | '));
  ok('interior or exterior, the set and the time of day come from the heading', by('1').ie === 'INT' && by('1').set === 'HARBOUR BREWING TAPROOM' && by('1').tod === 'MORNING' && by('4').ie === 'EXT' && by('4').tod === 'NIGHT' && by('5').ie === 'I/E' && by('5').set === 'TAPROOM OFFICE');
  ok('a Fountain scene number (#5#) and a numbered heading both give the scene number', by('5').scene === '5' && by('3').set === "TOM'S VAN");
  ok('"CONTINUOUS" keeps the colour of the scene before it', by('2').tod === 'CONTINUOUS' && by('2').dn === 'D');
  ok('the cast are the characters who speak, without (O.S.) or (CONT\'D)', JSON.stringify(by('1').cast) === '["ANA","TOM"]' && by('5').cast.join() === 'ANA');
  ok('a voice-over is not counted as on set', !by('4').cast.includes('MAYA') && by('4').cast.includes('ANA'));
  ok('known characters named in the action count too', ['ANA', 'TOM', 'MAYA'].every(n => by('7').cast.includes(n)) && by('3').cast.includes('TOM'));
  ok('the first action line is the description, even after a numbered heading', /^TOM rolls a keg/.test(by('2').desc) && /^Early light/.test(by('1').desc));
  ok('every scene gets a page count of at least an eighth', parsed.every(s => s.eighths >= 1));
  const pages = await page.evaluate(() => import('./js/board.js').then(b => [b.fmtEighths(11), b.fmtEighths(3), b.fmtEighths(16), b.parseEighths('1 3/8'), b.parseEighths('3/8'), b.parseEighths('2'), b.parseEighths('1.5'), b.parseEighths('lots')]));
  ok('pages are written and read in eighths', JSON.stringify(pages) === JSON.stringify(['1 3/8', '3/8', '2', 11, 3, 16, 12, null]), JSON.stringify(pages));
  const fallback = await page.evaluate(() => Promise.all([import('./js/stripboard.js')]).then(([m]) => m.parseScenes([{ text: 'My Film', heading: true }, { text: 'THE KITCHEN', heading: true }, { text: 'Steam.', heading: false }, { text: 'INT. HALL - DAY', heading: false }, { text: 'Quiet.', heading: false }]).map(s => s.set)));
  ok('a Word heading style is not taken for a scene when the script has real scene headings', JSON.stringify(fallback) === '["HALL"]', JSON.stringify(fallback));

  // ---- real-world script shapes ----
  const tricky = await page.evaluate(() => import('./js/stripboard.js').then(m => {
    const out = src => m.parseScenes(src).map(s => ({ scene: s.scene, ie: s.ie, set: s.set, tod: s.tod, dn: s.dn, cast: s.cast, desc: s.desc, eighths: s.eighths }));
    return {
      directions: out('1 INT. OFFICE - DAY 1\n\nJane at her desk.\n\nINSERT - THE LETTER\n\nIt reads: GO HOME.\n\nANGLE ON JANE\n\nShe folds it.\n\nJANE\nNo.\n\nLIVING ROOM\n\nJane walks in.\n\nJUMP CUT TO:\n\n> THE END <'),
      fountain: out('EXT. RIVER - DAY #1A#\n\nA strange fish swims. [[A note about the river.]]\n\n/* boneyard\nINT. FAKE - NIGHT\n\nJOE\ncut text\n*/\n\n# ACT TWO\n\n= The river at dusk.\n\n===\n\nINT. BOAT - NIGHT #2#\n\n*Rain* hammers the deck.'),
      light: out('2 EXT. STREET - NIGHT - RAIN 2\n\nWet.\n\n3 INT. CAR - NIGHT - MOVING 3\n\nDriving.\n\n4 INT. CAR - SECONDS LATER 4\n\nStill driving.\n\nA12 INT. KITCHEN - DAY A12\n\nSteam.\n\nSCENE 13 - EXT. FIELD - NIGHT\n\nGrass.\n\nINT. APARTMENT 4B\n\nA door.'),
      wrapped: out('INT. CAR - NIGHT\n\nRain on the windscreen as the wipers\nbeat a steady rhythm.\n\nSARAH\nI told Tom we would be there by\nsix, but Mike will not hurry and\nAna is still at the office.'),
      page: out('INT. KITCHEN - NIGHT\n\n' + Array.from({ length: 9 }, (_, i) => `PERSON${i % 2 ? 'A' : 'B'}\nThis is a line of dialogue that runs to about two lines in standard layout, give or take.\n`).join('\n')),
      soft: out([{ text: 'INT. KITCHEN - NIGHT' }, { text: 'MARY' }, { text: 'Where is John?' }, { text: 'EXT. GARDEN - DAY\nJohn digs.' }, { text: 'JOHN' }, { text: 'Here.' }]),
      names: out('INT. YARD - DAY\n\nThe guards wait.\n\nMORENO\nOpen it.\n\n2ND GUARD\nYes, boss.\n\nSUPERVISOR\nNow.\n\nBLACKWOOD\nWait.'),
      continuous: out('INT. HALL - DAY\n\nLight.\n\nINT. HOUSE - NIGHT - CONTINUOUS\n\nDark.'),
      pdf: out('INT. CAR - NIGHT\nRain on the windscreen as the wipers\nbeat a steady rhythm.\nSARAH\nI told Tom we would be there by\nsix, but Mike will not hurry.\nEXT. ROAD - NIGHT\nThe car pulls away.'),
      styled: out([{ text: 'INT. HALL - DAY', style: 'SceneHeading' }, { text: 'LIVING ROOM', style: 'Action' }, { text: 'MARY', style: 'Character' }, { text: 'Hello.', style: 'Dialogue' }, { text: 'Mary waves.', style: 'Action' }]),
    };
  }));
  ok('camera directions, sub-headings, transitions and centred text are not cast', JSON.stringify(tricky.directions[0].cast) === '["JANE"]', JSON.stringify(tricky.directions[0].cast));
  ok('Fountain notes, the boneyard, sections, synopses, page breaks and emphasis are left out', tricky.fountain.length === 2 && tricky.fountain[0].scene === '1A' && tricky.fountain[0].desc === 'A strange fish swims.' && tricky.fountain[1].desc === 'Rain hammers the deck.' && !tricky.fountain.some(x => x.set === 'FAKE'), JSON.stringify(tricky.fountain.map(x => [x.scene, x.set, x.desc])));
  const L = n => tricky.light.find(x => x.scene === n) || {};
  ok('the time of day is found wherever it sits in the heading ("NIGHT - RAIN")', L('2').set === 'STREET' && /NIGHT/.test(L('2').tod) && L('3').set === 'CAR' && /NIGHT/.test(L('3').tod), JSON.stringify([L('2'), L('3')].map(x => [x.set, x.tod])));
  ok('"SECONDS LATER" keeps the colour of the scene before it', L('4').dn === 'N');
  ok('headings numbered A12 and "SCENE 13 - EXT." are read, and a location number is not a scene number', L('A12').set === 'KITCHEN' && L('13').ie === 'EXT' && L('13').set === 'FIELD' && tricky.light.some(x => x.set === 'APARTMENT 4B' && !x.scene), JSON.stringify(tricky.light.map(x => [x.scene, x.ie, x.set])));
  ok('a speech wrapped over several lines stays dialogue: people only mentioned in it are not cast', JSON.stringify(tricky.wrapped[0].cast) === '["SARAH"]' && /^Rain on the windscreen as the wipers beat/.test(tricky.wrapped[0].desc), JSON.stringify(tricky.wrapped[0]));
  ok('a page of dialogue counts as about a page', tricky.page[0].eighths >= 6 && tricky.page[0].eighths <= 10, String(tricky.page[0].eighths));
  ok('a soft line break after a Word heading still starts a new scene', tricky.soft.length === 2 && tricky.soft[1].set === 'GARDEN' && tricky.soft[0].cast.join() === 'MARY');
  ok('real names that start like a camera direction stay in the cast (MORENO, 2ND GUARD, SUPERVISOR, BLACKWOOD)', ['MORENO', '2ND GUARD', 'SUPERVISOR', 'BLACKWOOD'].every(n => tricky.names[0].cast.includes(n)), JSON.stringify(tricky.names[0].cast));
  ok('"NIGHT - CONTINUOUS" keeps its own night', tricky.continuous[1].set === 'HOUSE' && /NIGHT/.test(tricky.continuous[1].tod) && tricky.continuous[1].dn !== 'D', JSON.stringify(tricky.continuous[1]));
  ok('text with no blank lines (from a PDF) is joined back into sentences', tricky.pdf.length === 2 && JSON.stringify(tricky.pdf[0].cast) === '["SARAH"]' && /wipers beat a steady rhythm/.test(tricky.pdf[0].desc), JSON.stringify(tricky.pdf.map(x => [x.set, x.cast, x.desc])));
  ok('a Word file\'s screenplay styles are followed (Action is never a speaker)', tricky.styled.length === 1 && JSON.stringify(tricky.styled[0].cast) === '["MARY"]');
  ok('"11/8" pages is eleven eighths', await page.evaluate(() => import('./js/board.js').then(b => b.parseEighths('11/8') === 11 && b.parseEighths('1-3/8') === 11)));

  // ---- the page ----
  await page.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); const b = s.db.bookings.find(x => /Harbour/.test(x.title)) || s.db.bookings[0]; const [y, m, d] = b.date.split('-').map(Number), e = new Date(y, m - 1, d + 1); s.update(D => { const x = D.bookings.find(z => z.id === b.id); delete x.board; x.endDate = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; x.updatedAt = Date.now(); }); window.__id = b.id; }));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  const open = () => page.evaluate(() => import('./js/store.js').then(s => { const t = s.byId('bookings', window.__id).title, c = [...document.querySelectorAll('.card.tap')].find(x => x.textContent.includes(t)); if (c) c.click(); return !!c; }));
  if (!(await open())) { await page.getByRole('button', { name: 'Calendar' }).click(); await sleep(300); await open(); }
  await page.waitForSelector('.bk-detail');
  await page.locator('.bk-tools .sb-open').click(); await page.waitForSelector('.sb-page .sb-board');
  ok('a new board has one day break per shoot day and no scenes', (await page.locator('.sb-break').count()) === 2 && (await page.locator('.sb-strip').count()) === 0 && /No scenes yet/.test(await page.locator('.sb-page .status-line').innerText()));
  ok('the ? button finds the stripboard tutorial', await page.evaluate(() => import('./js/tutorials.js').then(t => t.currentContext() === 'strips')));
  await page.locator('.sb-tools button', { hasText: 'Scenes from a script' }).click(); await page.waitForSelector('.sheet input[type=file]', { state: 'attached' });
  await page.locator('.sheet input[type=file]').setInputFiles(file); await page.waitForSelector('.sb-strip');
  await sleep(300);
  ok('importing a script makes a strip per scene, all waiting under Not scheduled yet', (await page.locator('.sb-strip').count()) === 7 && /7 scenes · .* · 2 shooting days · 7 not scheduled yet/.test(await page.locator('.sb-page .status-line').innerText()));
  const cls = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sb-strip')].map(li => [li.querySelector('.sb-num').textContent, li.className.match(/sb-(int|ext)-(day|night)/)[0]])));
  ok('strips are coloured: white interior day, yellow exterior day, blue interior night, green exterior night', cls['1'] === 'sb-int-day' && cls['2'] === 'sb-ext-day' && cls['4'] === 'sb-ext-night' && cls['5'] === 'sb-ext-night' && cls['6'] === 'sb-ext-day' && cls['3'] === 'sb-int-day', JSON.stringify(cls));
  const strip1 = await page.locator('.sb-strip', { has: page.locator('.sb-num', { hasText: /^1$/ }) }).innerText();
  ok('a strip shows the scene, set, time of day, description, cast numbers and pages', /HARBOUR BREWING TAPROOM/.test(strip1) && /INT · MORNING/.test(strip1) && /Early light/.test(strip1) && /Cast 1, 2/.test(strip1) && /\d\/8|\b\d\b/.test(strip1), strip1.replace(/\n/g, ' | '));
  const castList = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).board.cast));
  const sceneCast = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).board.list.filter(x => x.type === 'scene').map(x => x.cast)));
  const counts = castList.map(n => sceneCast.filter(c => c.includes(n)).length);
  ok('the cast list runs from the most scenes to the fewest', castList.length === 3 && counts.every((c, i) => i === 0 || c <= counts[i - 1]) && castList[0] === 'TOM', castList.map((n, i) => n + ' ' + counts[i]).join(', '));
  const squeezed = await page.locator('.sb-set').evaluateAll(els => els.filter(e => e.getBoundingClientRect().width < 60).length);
  ok('strips are readable on a 360 px phone, with nothing wider than the screen', squeezed === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  // ---- spreading over the days ----
  await page.locator('.sb-tools2 button', { hasText: 'Spread' }).click(); await sleep(400);
  const plan = () => page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/board.js')]).then(([s, b]) => { const p = b.boardPlan(s.byId('bookings', window.__id)); return { days: p.days.map(d => ({ scenes: d.items.filter(i => i.type === 'scene').map(i => i.scene), eighths: d.eighths, date: d.date })), pool: p.pool.map(i => i.scene || i.text), total: p.eighths }; }));
  let pl = await plan();
  ok('Spread over the days shares every scene out, in order, about evenly by pages', pl.pool.length === 0 && pl.days.length === 2 && pl.days.every(d => d.scenes.length) && [...pl.days[0].scenes, ...pl.days[1].scenes].join() === '1,2,3,4,5,6,7' && Math.abs(pl.days[0].eighths - pl.days[1].eighths) <= Math.max(...(await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).board.list.filter(x => x.type === 'scene').map(x => x.eighths))))), JSON.stringify(pl.days));
  const breakText = await page.locator('.sb-break').first().innerText();
  const fmt = await page.evaluate(e => import('./js/board.js').then(b => b.fmtEighths(e)), pl.days[0].eighths);
  ok('each End of day strip shows its date, its pages and its scenes', /End of day 1 of 2/i.test(breakText) && breakText.includes(fmt + ' page') && /\d scenes?/.test(breakText) && !!pl.days[0].date, breakText.replace(/\n/g, ' | '));

  // ---- keyboard moves ----
  const firstDay2 = pl.days[1].scenes[0];
  const handle = n => page.locator('.sb-strip', { has: page.locator('.sb-num', { hasText: new RegExp(`^${n}$`) }) }).locator('.sb-handle');
  await handle(firstDay2).focus(); await page.keyboard.press('ArrowUp'); await sleep(400);
  pl = await plan();
  ok('the up arrow on a handle moves the strip up past the day break, into the day before', pl.days[0].scenes[pl.days[0].scenes.length - 1] === firstDay2, JSON.stringify(pl.days.map(d => d.scenes)));
  ok('the handle keeps the keyboard focus after the move', await page.evaluate(n => { const a = document.activeElement; return !!a && a.classList.contains('sb-handle') && a.closest('li').querySelector('.sb-num').textContent === n; }, firstDay2));
  await page.keyboard.press('ArrowDown'); await sleep(400);
  pl = await plan();
  ok('the down arrow moves it back', pl.days[1].scenes[0] === firstDay2);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp', { delay: 0 });
  await sleep(500);
  ok('pressing an arrow again and again keeps moving the strip and never switches section', await page.evaluate(() => window.logiPage()) === 'bookings' && (await page.locator('.sb-page').count()) === 1 && await page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('sb-handle')));
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown', { delay: 0 });
  await sleep(500);
  pl = await plan();
  ok('and back again', pl.days[1].scenes[0] === firstDay2, JSON.stringify(pl.days.map(d => d.scenes)));
  // a tap on a handle moves nothing; it offers the moves (for screen readers and phones)
  const beforeTap = JSON.stringify((await plan()).days.map(d => d.scenes));
  await handle(firstDay2).click(); await page.waitForSelector('.sheet .btn');
  ok('activating a handle moves nothing and offers Up, Down and each day', JSON.stringify((await plan()).days.map(d => d.scenes)) === beforeTap && (await page.locator('.sheet button', { hasText: 'Up one' }).count()) === 1 && (await page.locator('.sheet button', { hasText: /End of day 1/ }).count()) === 1);
  await page.locator('.sheet button', { hasText: /End of day 1/ }).click(); await sleep(400);
  pl = await plan();
  ok('a move chosen there is made', pl.days[0].scenes[pl.days[0].scenes.length - 1] === firstDay2);
  await handle(firstDay2).focus(); await page.keyboard.press('ArrowDown'); await sleep(300);

  // ---- dragging ----
  const last = pl.days[1].scenes[pl.days[1].scenes.length - 1];
  await handle(last).scrollIntoViewIfNeeded(); await sleep(200); // a drag starts on a handle that is on screen (the page keeps the Rolodex bar's height clear at the top of a scroll, so the last strip may be below the fold)
  const from = await handle(last).boundingBox(), to = await page.locator('.sb-strip').first().boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + from.width / 2, from.y + (to.y + 4 - from.y) * i / 12); await sleep(30); }
  await page.mouse.up(); await sleep(500);
  pl = await plan();
  ok('dragging a strip by its handle moves it, here to the top of day 1', pl.days[0].scenes[0] === last, JSON.stringify(pl.days.map(d => d.scenes)));
  ok('no drag leftovers stay on screen', (await page.locator('.sb-ghost, .sb-placeholder, .sb-drop').count()) === 0 && (await page.locator('.sheet').count()) === 0);
  // a press on a handle that does not move (even near the bottom of the screen) changes nothing
  const order0 = JSON.stringify((await plan()).days.map(d => d.scenes));
  const lowHandle = page.locator('.sb-strip .sb-handle').last(); await lowHandle.evaluate(el => el.scrollIntoView({ block: 'end' }));
  const hb = await lowHandle.boundingBox(); await page.mouse.move(hb.x + 10, hb.y + hb.height / 2); await page.mouse.down(); await sleep(450); await page.mouse.up(); await sleep(300);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('holding a handle without moving it never moves a strip', JSON.stringify((await plan()).days.map(d => d.scenes)) === order0);

  // ---- editing ----
  await page.locator('.sb-strip', { has: page.locator('.sb-num', { hasText: /^3$/ }) }).locator('.sb-body').click(); await page.waitForSelector('.sheet form');
  const form = page.locator('.sheet').last();
  await form.locator('.field:has(label:has-text("Pages")) input').fill('1 4/8');
  await form.locator('.field:has(label:has-text("Shooting day")) select').selectOption('0');
  await form.locator('.field:has(label:has-text("Notes")) textarea').fill('SECRET NOTE: smoke machine');
  await form.locator('button[type=submit]').click(); await sleep(400);
  const s3 = await page.evaluate(() => import('./js/store.js').then(s => s.byId('bookings', window.__id).board.list.find(x => x.scene === '3')));
  pl = await plan();
  ok('editing a strip saves its pages in eighths and can unschedule it', s3.eighths === 12 && pl.pool.includes('3') && !pl.days.some(d => d.scenes.includes('3')));
  await page.locator('.sb-tools button', { hasText: 'Banner' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet').last().locator('input').first().fill('Company move to the harbour');
  await page.locator('.sheet').last().locator('select').selectOption('1');
  await page.locator('.sheet').last().locator('button[type=submit]').click(); await sleep(400);
  ok('a banner goes into a day', (await page.locator('.sb-banner', { hasText: 'Company move' }).count()) === 1 && (await plan()).days[0].scenes.length >= 1);
  await page.locator('.sb-tools button', { hasText: '＋ Day' }).click(); await sleep(300);
  ok('＋ Day adds a shooting day, and a day past the booking\'s dates has no date', (await plan()).days.length === 3 && (await plan()).days[2].date === '' && /more shooting days than the booking/.test(await page.locator('.sb-page').innerText()));
  await page.locator('.sb-break-x').last().click(); await sleep(300);
  ok('a day break can be removed again', (await plan()).days.length === 2);
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => y.id === window.__id), [yy, m, dd] = x.date.split('-').map(Number), e = new Date(yy, m - 1, dd + 2); x.endDate = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; x.updatedAt = Date.now(); })));
  await sleep(300);
  await page.locator('.sb-page button', { hasText: 'Add the missing day' }).click(); await sleep(300);
  ok('when the booking grows, the board offers to add the missing days', (await plan()).days.length === 3 && (await page.locator('.sb-page button', { hasText: 'Add the missing day' }).count()) === 0);
  await page.locator('.sb-break-x').last().click(); await sleep(300);
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => y.id === window.__id), [yy, m, dd] = x.date.split('-').map(Number), e = new Date(yy, m - 1, dd + 1); x.endDate = `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; x.updatedAt = Date.now(); })));
  await sleep(300);

  // ---- grouping the unscheduled scenes ----
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => y.id === window.__id); const brk = x.board.list.filter(i => i.type === 'break'), rest = x.board.list.filter(i => i.type !== 'break'); x.board.list = [...brk, ...rest]; x.board.updatedAt = Date.now(); x.updatedAt = Date.now(); })));
  await sleep(300); await page.locator('.sb-tools2 button', { hasText: 'Group unscheduled' }).click(); await sleep(300);
  const pool = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/board.js')]).then(([s, b]) => b.boardPlan(s.byId('bookings', window.__id)).pool.filter(i => i.type === 'scene').map(i => i.set)));
  ok('Group unscheduled by location puts scenes at the same set together', pool.join('|') === [...pool].sort((a, b) => a.localeCompare(b)).join('|') && pool.indexOf('HARBOUR BREWING TAPROOM') + 1 === pool.lastIndexOf('HARBOUR BREWING TAPROOM'), pool.join(' | '));
  await page.locator('.sb-tools2 button', { hasText: 'Spread' }).click(); await sleep(400);

  // ---- the cast list ----
  await page.locator('.sb-tools2 button', { hasText: 'Cast' }).click(); await page.waitForSelector('.sb-cast-list');
  const firstCast = castList[0];
  await page.locator('.sb-cast-list li').first().locator('button', { hasText: 'Rename' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet').last().locator('input').first().fill('Tommy'); await page.locator('.sheet').last().locator('button[type=submit]').click(); await sleep(400);
  const renamed = await page.evaluate(() => import('./js/store.js').then(s => { const bd = s.byId('bookings', window.__id).board; return { cast: bd.cast, inScenes: bd.list.filter(x => x.type === 'scene' && x.cast.includes('TOMMY')).length }; }));
  ok('renaming someone in the cast list changes every scene they are in', renamed.cast[0] === 'TOMMY' && renamed.inScenes >= 3 && !renamed.cast.includes(firstCast), JSON.stringify(renamed));
  await page.locator('.sb-cast-list li').first().locator('button', { hasText: 'Rename' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet').last().locator('input').first().fill(firstCast); await page.locator('.sheet').last().locator('button[type=submit]').click(); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- printing ----
  const printed = await page.evaluate(async () => { window.print = () => {}; document.querySelector('.sb-tools2 button:last-child').click(); await new Promise(r => setTimeout(r, 200)); const r = document.getElementById('print-root'); const out = r ? { text: r.innerText, rows: r.querySelectorAll('tr.sb-row').length, coloured: r.querySelectorAll('tr.sb-ext-night').length } : null; window.dispatchEvent(new Event('afterprint')); return out; });
  ok('Print makes a one-line-per-scene schedule by day, coloured, with the cast list', printed && /STRIPBOARD/.test(printed.text) && /Day 1 of 2/.test(printed.text) && printed.rows >= 7 && printed.coloured >= 1 && printed.text.includes('1 ' + castList[0]), printed && printed.text.slice(0, 120));

  // ---- the call sheet and the crew link ----
  const cs = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(([s, c]) => { const b = s.byId('bookings', window.__id), doc = c.renderDoc(b); return { text: c.callSheetText(b), doc: doc.textContent, rows: [...doc.querySelectorAll('section')].filter(x => /Scenes/.test(x.querySelector('h4')?.textContent || '')).map(x => x.querySelectorAll('tbody tr').length)[0] || 0 }; }));
  ok('in the call sheet text the scenes come after the crew and contacts', cs.text.indexOf('SCENES') > cs.text.indexOf('CREW'));
  const state = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(([s, c]) => { const id = window.__id, t = Date.now(); s.update(d => { const x = d.bookings.find(y => y.id === id); x.callSheet = { ...(x.callSheet || {}), sentAt: t, editedAt: t - 1000 }; x.board.updatedAt = t - 5000; }); const before = c.sheetState(s.byId('bookings', id)); s.update(d => { const x = d.bookings.find(y => y.id === id); x.board.updatedAt = t + 1000; }); return [before, c.sheetState(s.byId('bookings', id))]; }));
  ok('a sent call sheet shows as changed once its scenes change on the stripboard', state[0] === 'sent' && state[1] === 'changed', state.join(' → '));
  const plainShare = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/crew-link.js')]).then(async ([s, m]) => { const other = s.db.bookings.find(x => x.id !== window.__id && !(x.board && x.board.list && x.board.list.some(i => i.type === 'scene'))); m.openCrewShare(other); await new Promise(r => setTimeout(r, 300)); const txt = document.querySelector('.sheet:last-of-type, .sheet') ? [...document.querySelectorAll('.sheet')].pop().innerText : ''; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); return txt; }));
  ok('a booking with no stripboard offers no Scenes tick box when sharing with crew', !/Scenes from the stripboard/.test(plainShare) && /Shot list/.test(plainShare));
  ok('the call sheet lists each day\'s scenes with the cast numbers', /SCENES/.test(cs.text) && /Sc 1 /.test(cs.text) && cs.text.includes('Cast: 1 ' + castList[0]) && cs.rows >= 6, cs.text.split('SCENES')[1]?.slice(0, 160));
  const snap = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/crew-link.js'), import('./js/link-pack.js')]).then(async ([s, m, lp]) => { const snp = m.crewSnapshot(s.byId('bookings', window.__id)); const back = await lp.unpack('#' + await lp.pack(snp)); return { scenes: snp.scenes, raw: JSON.stringify(back) }; }));
  ok('the crew link carries the scenes by day', snap.scenes && snap.scenes.length === 2 && snap.scenes[0].items.some(x => x.scene && x.kind && x.cast));
  ok('a strip\'s private notes never go into the crew link', !/SECRET NOTE|smoke machine/.test(snap.raw));
  const url = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/crew-link.js')]).then(([s, m]) => m.crewLink(s.byId('bookings', window.__id))));
  const crew = await ctx.newPage(); await crew.goto(url.replace(/^https?:\/\/[^/]+\/(?:[^#]*\/)?/, BASE)); await crew.waitForSelector('.paper');
  const crewText = await crew.locator('.paper').innerText();
  ok('the crew page shows the scenes with their colours', /SCENES/i.test(crewText) && /HARBOUR WALL/.test(crewText) && (await crew.locator('table.scenes tr.sb-ext-night').count()) >= 1 && !/SECRET NOTE/.test(crewText));
  await crew.close();

  // ---- two devices ----
  const merged = await page.evaluate(() => import('./js/store.js').then(s => { const local = JSON.parse(s.serialize()), remote = JSON.parse(s.serialize()); const rb = remote.bookings.find(x => x.id === window.__id); rb.title = 'Renamed elsewhere'; rb.updatedAt = Date.now() + 5000; rb.board = { list: [], cast: [], updatedAt: 1 }; const out = s.mergeDb(local, remote).bookings.find(x => x.id === window.__id); return { title: out.title, scenes: out.board.list.filter(x => x.type === 'scene').length }; }));
  ok('a newer edit to the booking on another device keeps the newer stripboard', merged.title === 'Renamed elsewhere' && merged.scenes === 7, JSON.stringify(merged));
  ok('the booking page counts the scenes on its Stripboard button', await (async () => { await page.locator('.sb-page .page-head button').click(); await page.waitForSelector('.bk-detail'); return /Stripboard & shot list · 7 scenes/.test(await page.locator('.bk-tools .sb-open').innerText()); })());
  ok('no errors', !errors.length, errors.slice(0, 3).join(' | '));
  fs.rmSync(file, { force: true });
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

// Songs, split sheets and setlists: the library (groups, act chips, search), the song form (a length typed as 3:45 is
// stored as 225 seconds; the split sheet and its 100% check), the printed split sheet, the setlist editor (songs from
// the picker, a set break, a free item, moves by button, by keyboard and by dragging, segues, a slot to fit, totals
// that match model.setlistLength, copy, print, duplicate, delete), and the Setlist box on a show and a rehearsal.
const { open, ok, sleep } = require('../helpers.cjs');

(async () => {
  const { browser, page, errors } = await open({ sample: true, tab: 'songs', init: () => { window.print = () => {}; }, permissions: ['clipboard-read', 'clipboard-write'] });
  const T = { timeout: 15000 };
  const store = fn => page.evaluate(`import('./js/store.js').then(s => (${fn})(s))`);
  const song = id => page.evaluate(id => import('./js/store.js').then(s => s.byId('songs', id)), id);
  const list = id => page.evaluate(id => import('./js/store.js').then(s => s.byId('setlists', id)), id);
  const booking = id => page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id)), id);
  const len = id => page.evaluate(id => Promise.all([import('./js/store.js'), import('./js/model.js')]).then(([s, m]) => m.setlistLength(s.byId('setlists', id))), id);
  const fmt = sec => page.evaluate(sec => import('./js/model.js').then(m => m.fmtDur(sec)), sec);
  const sheetNamed = name => page.locator(`.sheet[aria-label="${name}"]`);
  const waitSheet = name => page.waitForSelector(`.sheet[aria-label="${name}"]`, T);
  const closeAll = async () => { for (let i = 0; i < 6 && (await page.locator('.sheet').count()); i++) { await page.keyboard.press('Escape'); await sleep(150); } };
  const focusedFk = () => page.evaluate(() => (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk || '' : ''));
  const afterPrint = () => page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  /* ------------------------------- the library ------------------------------- */
  await page.waitForSelector('.sg-song', T);
  ok('the songs page lists every sample song', (await page.locator('.sg-song').count()) === 10);
  const heads = await page.locator('.sg-group h3').allTextContents();
  ok('songs are grouped by act', heads.some(t => t.includes('The Night Owls')) && heads.some(t => t.includes('Sable')), heads.join(' | '));
  const harbour = await page.locator('.sg-song[data-fk="pg-song-s-song1"]').textContent();
  ok('a song card shows title, key, BPM, length and status', ['Harbour Lights', 'A minor', '128 BPM', '3:34', 'Released'].every(x => harbour.includes(x)), harbour);
  ok('a song with no length says so', (await page.locator('.sg-song[data-fk="pg-song-s-sable2"] .sg-miss').count()) === 1);
  await page.click('.sg-acts .chip:has-text("Sable")'); await sleep(200);
  ok('the act chip shows only that act’s songs', (await page.locator('.sg-song').count()) === 2);
  await page.click('.sg-acts .chip:has-text("All")'); await sleep(200);
  await page.fill('#sg-q', 'ferry'); await sleep(250);
  ok('search finds a song by title', (await page.locator('.sg-song').count()) === 1 && (await page.locator('.sg-song').textContent()).includes('Last Ferry Home'));
  ok('the search box keeps the focus while typing', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'sg-q');
  await page.fill('#sg-q', 'Em'); await sleep(250);
  const byKey = await page.locator('.sg-song').allTextContents();
  ok('search finds a song by its short key (Em)', byKey.length === 1 && byKey[0].includes('Low Tide'), byKey.join(' | '));
  await page.fill('#sg-q', ''); await sleep(250);

  /* ------------------------------- add a song ------------------------------- */
  await page.click('#sg-new-song'); await waitSheet('Add a song');
  const add = sheetNamed('Add a song');
  await add.locator('[data-key=title]').fill('Midnight Train');
  await add.locator('select[id$="-actId"]').selectOption('s-owls');
  await add.locator('select[id$="-key"]').selectOption('E minor');
  await add.locator('input[id$="-bpm"]').fill('100');
  await add.locator('input[id$="-duration"]').fill('3:45');
  await add.locator('input[id$="-tuning"]').fill('Drop D');
  const addRow = add.locator('.sg-splits-field button:has-text("+ Add")');
  await addRow.click(); await addRow.click();
  const rows = add.locator('.sg-splits-field .row-edit');
  const fillRow = async (i, vals) => { for (const [k, v] of Object.entries(vals)) await rows.nth(i).locator(`[aria-label="${k}"]`).fill(v); };
  await fillRow(0, { Name: 'Maya Brooks', Role: 'Writer', 'Share %': '50', PRO: 'ASCAP', IPI: '00012345678' });
  await fillRow(1, { Name: 'Leo Grant', Role: 'Composer', 'Share %': '50', PRO: 'BMI', Publisher: 'Night Owl Songs' });
  const sum = add.locator('.sg-split-sum');
  ok('the form adds up the shares as they are typed (50 + 50 = 100%)', (await sum.textContent()).includes('100%') && (await sum.getAttribute('class')).includes('ok'), await sum.textContent());
  ok('the role box suggests the split roles', (await rows.nth(1).locator('[aria-label="Role"]').getAttribute('list')) === 'sg-split-roles');
  await add.locator('button[type=submit]').click(); await sleep(400);
  const added = await store(s => s.db.songs.find(x => x.title === 'Midnight Train'));
  ok('a length typed as 3:45 is stored as 225 seconds', added && added.duration === 225, JSON.stringify(added && added.duration));
  ok('the song keeps its act, key, tempo, tuning and status', added.actId === 's-owls' && added.key === 'E minor' && added.bpm === 100 && added.tuning === 'Drop D' && added.status === 'idea');
  ok('split shares are stored as numbers, each party with an id', added.splits.length === 2 && added.splits.every(p => typeof p.share === 'number' && p.share === 50 && p.id) && added.splits[0].ipi === '00012345678' && added.splits[1].publisher === 'Night Owl Songs');
  const card = page.locator(`.sg-song[data-fk="pg-song-${added.id}"]`);
  ok('the new card shows the length as 3:45 and the tuning', (await card.textContent()).includes('3:45') && (await card.textContent()).includes('Drop D'));

  /* ------------------------------- the song sheet ------------------------------- */
  await card.click(); await waitSheet('Song');
  const sh = sheetNamed('Song');
  const shText = await sh.textContent();
  ok('the song sheet shows the details', ['Midnight Train', 'The Night Owls', 'E minor', '100 BPM', '3:45', 'Drop D'].every(x => shText.includes(x)), shText.slice(0, 200));
  ok('a 50/50 split sheet adds up to 100%: no warning', (await sh.locator('.sg-split-warn').count()) === 0 && (await sh.locator('.sg-total').textContent()).includes('100%'));
  ok('the song is not in a setlist yet', shText.includes('Not in a setlist yet'));
  await sh.locator('[data-fk="sg-edit"]').click(); await waitSheet('Edit song');
  const ed1 = sheetNamed('Edit song');
  await ed1.locator('.sg-splits-field .row-edit').nth(1).locator('[aria-label="Share %"]').fill('60');
  const sum2 = ed1.locator('.sg-split-sum');
  ok('the form warns while the shares make 110%', (await sum2.textContent()).includes('110%') && (await sum2.getAttribute('class')).includes('bad'), await sum2.textContent());
  await ed1.locator('button[type=submit]').click(); await sleep(400);
  ok('the open song sheet redraws: a 60/50 split warns', (await sh.locator('.sg-split-warn').count()) === 1 && (await sh.locator('.sg-split-warn').textContent()).includes('110%'));
  ok('the new share is stored as the number 60', (await song(added.id)).splits[1].share === 60);
  ok('the focus comes back to Edit after saving', (await focusedFk()) === 'sg-edit', await focusedFk());
  ok('the song card on the page flags the split', (await card.locator('.sg-flag').count()) === 1);

  /* ------------------------------- print the split sheet ------------------------------- */
  await sh.locator('[data-fk="sg-print"]').click(); await sleep(250);
  const doc = page.locator('#print-root .cs-doc');
  ok('Print split sheet makes the document', (await doc.count()) === 1);
  const dt = await doc.textContent();
  ok('the split sheet names the song and each party with role, share, PRO, IPI and publisher', ['SPLIT SHEET', 'Midnight Train', 'Maya Brooks', 'Writer', '50%', 'ASCAP', '00012345678', 'Leo Grant', '60%', 'BMI', 'Night Owl Songs'].every(x => dt.includes(x)), dt.slice(0, 300));
  ok('it is dated today', dt.includes(await page.evaluate(() => import('./js/util.js').then(u => u.fmtLong(u.todayISO())))));
  ok('it has a signature line for each party', (await doc.locator('.sg-sign-party').count()) === 2 && (await doc.locator('.sg-sign-line').count()) === 2);
  ok('it warns that the shares do not add up', (await doc.locator('.sg-split-bad').count()) === 1);
  await afterPrint(); await sleep(100);
  ok('the print copy is cleared after printing', (await page.locator('#print-root').count()) === 0);
  await closeAll();

  /* ------------------------------- setlists view ------------------------------- */
  await page.click('#sg-view-setlists'); await sleep(250);
  const clubLen = await len('s-clubset');
  const clubCard = await page.locator('.sg-setlist[data-fk="pg-sl-s-clubset"]').textContent();
  ok('the setlist card shows its songs and the total from model.setlistLength', clubCard.includes('8 songs') && clubCard.includes(await fmt(clubLen.sec)) && clubCard.includes('The Night Owls'), clubCard);
  ok('the sample club set runs 33:39 (8 songs, 6 gaps of 20s, one segue)', clubLen.sec === 2019 && clubLen.songs === 8 && clubLen.missing === 0, JSON.stringify(clubLen));

  await page.click('#sg-new-setlist'); await waitSheet('New setlist');
  await sheetNamed('New setlist').locator('[data-key=name]').fill('Test set');
  await sheetNamed('New setlist').locator('select').selectOption('s-owls');
  await sheetNamed('New setlist').locator('button[type=submit]').click();
  await waitSheet('Edit setlist');
  const ed = sheetNamed('Edit setlist');
  const testId = await store(s => (s.db.setlists.find(x => x.name === 'Test set') || {}).id);
  let L = await list(testId);
  ok('a new setlist starts empty, for its act, with a 20 second gap', L && L.items.length === 0 && L.gap === 20 && L.actId === 's-owls', JSON.stringify(L));
  ok('the empty editor says what to do', (await ed.locator('.sg-ed-empty').count()) === 1);

  /* ------------------------------- add songs ------------------------------- */
  await ed.locator('[data-fk="sl-add-songs"]').click(); await waitSheet('Add songs');
  const pk = sheetNamed('Add songs');
  ok('the picker lists the act’s songs first', ((await pk.locator('.sg-pick-group h4').first().textContent()) || '').includes('The Night Owls'));
  for (const id of ['s-song1', 's-song2', 's-song3']) await pk.locator(`.sg-pick-row[data-song="${id}"]`).click();
  ok('ticked songs are numbered in the order ticked', (await pk.locator('.sg-pick-row[data-song="s-song3"] .sg-pick-no').textContent()) === '3');
  ok('the add button counts them', (await pk.locator('#sgp-add').textContent()) === 'Add 3 songs');
  await pk.locator('#sgp-q').fill('glass'); await sleep(200);
  ok('the picker search narrows the list (and keeps the ticks)', (await pk.locator('.sg-pick-row').count()) === 1 && (await pk.locator('#sgp-add').textContent()) === 'Add 3 songs');
  await pk.locator('#sgp-q').fill(''); await sleep(200);
  await pk.locator('#sgp-add').click(); await sleep(400);
  L = await list(testId);
  ok('Add puts the songs in, in the order ticked', L.items.map(i => i.songId).join() === 's-song1,s-song2,s-song3', L.items.map(i => i.songId).join());
  ok('the editor shows them', (await ed.locator('.sg-item').count()) === 3);
  ok('the focus goes to the first song added', (await focusedFk()) === 'h' + L.items[0].id, await focusedFk());

  /* ------------------------------- a set break and a free item ------------------------------- */
  await ed.locator('[data-fk="sl-add-break"]').click(); await waitSheet('Add a set break');
  const bf = sheetNamed('Add a set break');
  ok('a first set break is called SET 2', (await bf.locator('[data-key=title]').inputValue()) === 'SET 2');
  await bf.locator('select').selectOption('2');
  await bf.locator('button[type=submit]').click(); await sleep(300);
  L = await list(testId);
  ok('the set break goes where asked (after song 2)', L.items.length === 4 && L.items[2].isBreak === true && L.items[2].title === 'SET 2', JSON.stringify(L.items));
  ok('the break shows as a heading in the editor', ((await ed.locator('.sg-break .sg-t').textContent()) || '').includes('SET 2'));
  await ed.locator('[data-fk="sl-add-item"]').click(); await waitSheet('Add an item');
  const ff = sheetNamed('Add an item');
  await ff.locator('[data-key=title]').fill('Drum solo');
  await ff.locator('[data-key=duration]').fill('1:30');
  await ff.locator('button[type=submit]').click(); await sleep(300);
  L = await list(testId);
  const solo = L.items[L.items.length - 1];
  ok('a free item keeps its own title and length (1:30 → 90 s)', solo.title === 'Drum solo' && solo.duration === 90 && !solo.songId, JSON.stringify(solo));

  /* ------------------------------- totals and the running clock ------------------------------- */
  const shownTotal = async () => (await ed.locator('.sg-stats .stat').first().locator('b').textContent()).trim();
  let t = await len(testId);
  ok('the running time matches model.setlistLength (813 s of music + 3 gaps = 14:33)', t.sec === 873 && (await shownTotal()) === await fmt(t.sec), `${await shownTotal()} / ${t.sec}`);
  ok('the song count matches model.setlistLength (breaks and free items like the drum solo are not songs)', ((await ed.locator('.sg-stats .stat').nth(1).locator('b').textContent()) || '').trim() === String(t.songs) && t.songs === 3 && t.items === 4, JSON.stringify(t));
  const starts = await ed.locator('.sg-item .sg-start').allTextContents();
  ok('each item shows when it starts, from 0:00 (a break shares the next song’s start)', starts.join(',') === '0:00,3:54,8:15,8:15,13:03', starts.join(','));
  ok('key changes between songs are marked (A minor → C major)', (await ed.locator('.sg-item').nth(1).locator('.sg-k.chg').count()) === 1 && (await ed.locator('.sg-item').nth(0).locator('.sg-k.chg').count()) === 0);
  ok('the set break starts the comparison afresh', (await ed.locator('.sg-item').nth(3).locator('.sg-k.chg').count()) === 0);

  /* ------------------------------- move: buttons, keyboard, drag ------------------------------- */
  const first = L.items[0].id;
  await ed.locator(`[data-fk="d${first}"]`).click(); await sleep(300);
  L = await list(testId);
  ok('↓ moves a song one place down', L.items[1].id === first && L.items[0].songId === 's-song2', L.items.map(i => i.songId || i.title).join());
  ok('the focus stays on that ↓ button after the move', (await focusedFk()) === 'd' + first, await focusedFk());
  ok('↑ is marked as not possible on the top item', (await ed.locator(`[data-fk="u${L.items[0].id}"]`).getAttribute('aria-disabled')) === 'true');
  const tide = L.items.find(x => x.songId === 's-song3').id;
  await ed.locator(`[data-fk="h${tide}"]`).focus();
  await page.keyboard.press('ArrowUp'); await sleep(300);
  L = await list(testId);
  ok('ArrowUp on a handle moves the item up, above the set break', L.items[2].id === tide && L.items[3].isBreak === true, L.items.map(i => i.songId || i.title).join());
  ok('the handle keeps the focus after a keyboard move', (await focusedFk()) === 'h' + tide, await focusedFk());
  await sleep(150);
  const said = await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent || '');
  ok('the move is announced for screen readers', /Low Tide moved up: now 3 of 5/.test(said), said);
  ok('the arrow key does not turn the Rolodex', (await page.evaluate(() => window.logiPage())) === 'songs');
  await page.keyboard.press('Home'); await sleep(300);
  L = await list(testId);
  ok('Home on a handle moves the item to the top', L.items[0].id === tide);
  const lastLi = ed.locator('.sg-item').last();
  await lastLi.scrollIntoViewIfNeeded();
  const hb = await lastLi.locator('.sg-handle').boundingBox(), top = await ed.locator('.sg-item').first().boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 12, { steps: 3 });
  await page.mouse.move(hb.x + hb.width / 2, top.y + 6, { steps: 12 }); await sleep(120);
  await page.mouse.up(); await sleep(400);
  L = await list(testId);
  ok('dragging a handle moves the item (the drum solo to the top)', L.items[0].title === 'Drum solo', L.items.map(i => i.songId || i.title).join());
  ok('a drag does not open the item’s options', (await page.locator('.sheet[aria-label="Setlist item"]').count()) === 0);
  ok('nothing is left over from the drag', (await page.locator('.sg-ghost, .sg-drop, .sg-placeholder').count()) === 0);

  /* ------------------------------- segue ------------------------------- */
  t = await len(testId);
  const seg = L.items.find(x => x.songId === 's-song2').id;
  await ed.locator(`[data-fk="s${seg}"]`).click(); await sleep(300);
  const t2 = await len(testId);
  ok('a segue takes the gap out of the running time', t2.sec === t.sec - 20, `${t.sec} → ${t2.sec}`);
  ok('the segue is stored on the item and the button shows it', (await list(testId)).items.find(x => x.id === seg).segue === true && (await ed.locator(`[data-fk="s${seg}"]`).getAttribute('aria-pressed')) === 'true');
  ok('the total shown still matches model.setlistLength', (await shownTotal()) === await fmt(t2.sec), await shownTotal());

  /* ------------------------------- the gap and the slot ------------------------------- */
  await ed.locator('#sl-gap').fill('0'); await ed.locator('#sl-gap').press('Enter'); await sleep(300);
  ok('a gap of 0 leaves just the music', (await list(testId)).gap === 0 && (await len(testId)).sec === 813 && (await shownTotal()) === '13:33');
  await ed.locator('#sl-gap').fill('20'); await ed.locator('#sl-gap').press('Enter'); await sleep(300);
  await ed.locator('#sl-target').fill('5'); await ed.locator('#sl-target').press('Enter'); await sleep(250);
  ok('a slot shorter than the set warns that it is over', ((await ed.locator('.sg-fit.warn').textContent()) || '').includes('over the 5m slot'));
  await ed.locator('#sl-target').fill('60'); await ed.locator('#sl-target').press('Enter'); await sleep(250);
  ok('a slot far longer says how much is left', ((await ed.locator('.sg-soft.sg-fit').textContent()) || '').includes('under the 1h 00m slot'));
  await ed.locator('#sl-target').fill('15'); await ed.locator('#sl-target').press('Enter'); await sleep(250);
  ok('a slot it fits says so', ((await ed.locator('.sg-ok.sg-fit').textContent()) || '').includes('Fits the 15m slot'), await ed.locator('.sg-fit').textContent());

  /* ------------------------------- rename, act, item options ------------------------------- */
  await ed.locator('#sl-name').fill('Test set renamed');
  const tapId = (await list(testId)).items[0].id;
  await ed.locator(`[data-fk="d${tapId}"]`).click(); await sleep(350);
  ok('renaming saves when the box loses the focus', (await list(testId)).name === 'Test set renamed');
  ok('a button tapped straight after typing still gets its tap', (await list(testId)).items[1].id === tapId);
  await ed.locator(`[data-fk="u${tapId}"]`).click(); await sleep(300);
  ok('↑ moves it back', (await list(testId)).items[0].id === tapId);
  await ed.locator('#sl-act').selectOption('s-sablea'); await sleep(250);
  ok('changing the act saves at once', (await list(testId)).actId === 's-sablea');
  await ed.locator('#sl-act').selectOption('s-owls'); await sleep(250);
  L = await list(testId);
  const moon = L.items.find(x => x.songId === 's-song2').id;
  await ed.locator(`[data-fk="h${moon}"]`).click(); await waitSheet('Setlist item');
  const it = sheetNamed('Setlist item');
  await it.locator('#sli-note').fill('capo 2');
  await it.locator('#sli-len').fill('5:00');
  await it.locator('button[type=submit]').click(); await sleep(300);
  const moonItem = (await list(testId)).items.find(x => x.id === moon);
  ok('tapping a handle opens the item: a note and a longer live length are saved', moonItem.note === 'capo 2' && moonItem.duration === 300 && moonItem.segue === true, JSON.stringify(moonItem));
  ok('the note shows in the editor', ((await ed.locator(`.sg-item[data-id="${moon}"] .sg-note`).textContent()) || '').includes('capo 2'));
  ok('the total follows the new length', (await shownTotal()) === await fmt((await len(testId)).sec));

  /* ------------------------------- copy and print ------------------------------- */
  await ed.locator('[data-fk="sl-copy"]').click(); await sleep(300);
  let text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (await sheetNamed('Setlist as text').count()) { text = text || await sheetNamed('Setlist as text').locator('textarea').inputValue(); await page.keyboard.press('Escape'); await sleep(150); }
  ok('Copy as text puts the setlist on the clipboard', text.startsWith('Test set renamed') && text.includes('1. Drum solo') && text.includes('— SET 2 —') && text.includes('Paper Moon (C) 5:00 → [capo 2]'), text);
  await ed.locator('[data-fk="sl-print"]').click(); await sleep(250);
  const stage = page.locator('#print-root .sg-stage');
  ok('Print makes the stage copy', (await stage.count()) === 1);
  ok('the stage copy has a big title per item, keys small, and the set break as a heading', (await stage.locator('.sg-stage-song').count()) === 4 && (await stage.locator('.sg-stage-k').count()) === 3 && ((await stage.locator('.sg-stage-break').textContent()) || '').includes('SET 2'));
  const fs = await stage.evaluate(el => parseFloat(el.style.getPropertyValue('--sg-fs')));
  ok('a short set prints in big letters', fs >= 40, String(fs));
  await afterPrint();
  const fs15 = await page.evaluate(() => import('./js/setlist.js').then(m => { const items = Array.from({ length: 15 }, (_, i) => ({ id: 'q' + i, title: 'Song ' + i, duration: 200 })); items.splice(8, 0, { id: 'qb', isBreak: true, title: 'SET 2' }); return parseFloat(m.stageDoc({ name: 'Long', items }).style.getPropertyValue('--sg-fs')); }));
  ok('a fifteen-song set is sized to fit one page', fs15 >= 28 && fs15 * 1.5 * 17 <= 900, String(fs15));

  /* ------------------------------- duplicate and delete ------------------------------- */
  const before = await store(s => s.db.setlists.length);
  await ed.locator('[data-fk="sl-dup"]').click(); await sleep(400);
  const copy = await store(s => s.db.setlists.find(x => x.name === 'Test set renamed (copy)'));
  ok('Duplicate makes a copy with the same items under new ids', copy && (await store(s => s.db.setlists.length)) === before + 1 && copy.items.length === 5 && copy.items.every(x => !(L.items.some(y => y.id === x.id))));
  ok('the editor now shows the copy', (await sheetNamed('Edit setlist').locator('#sl-name').inputValue()) === 'Test set renamed (copy)' && (await page.locator('.sheet').count()) === 1);
  await sheetNamed('Edit setlist').locator('[data-fk="sl-del"]').click(); await sleep(400);
  ok('Delete (after the confirm) removes the copy and closes the editor', !(await list(copy.id)) && (await page.locator('.sheet').count()) === 0);
  await closeAll();

  /* ------------------------------- the Setlist box on a show ------------------------------- */
  await page.evaluate(async () => {
    const m = await import('./js/blocks/setlist.js'), s = await import('./js/store.js'), u = await import('./js/util.js');
    const host = document.createElement('div'); host.id = 'sg-test-host'; document.querySelector('#page').append(host);
    const draw = () => { const b = s.byId('bookings', window.__bid); host.replaceChildren(b ? u.h('details', { class: 'blk', id: 'blk-setlist', open: true }, u.h('summary', null, m.default.summary(b)), m.default.render(b, { sym: '$', open() {} })) : ''); };
    window.__drawBlk = id => { window.__bid = id; draw(); };
    s.subscribe(() => queueMicrotask(draw));
    window.__drawBlk('s-show1');
  });
  const blk = page.locator('#sg-test-host');
  const summary = await page.evaluate(() => Promise.all([import('./js/blocks/setlist.js'), import('./js/store.js')]).then(([m, s]) => m.default.summary(s.byId('bookings', 's-show1'))));
  ok('the box’s summary reads “Club set · 8 songs · 33:39”', summary === 'Club set · 8 songs · 33:39', summary);
  ok('the box lists the songs compactly, the encore as a heading', (await blk.locator('.sg-mini li:not(.sg-mini-break)').count()) === 8 && ((await blk.locator('.sg-mini-break').textContent()) || '').includes('Encore'));
  ok('a 45-minute set with a 33:39 setlist: more than 5 minutes under is pointed out', ((await blk.locator('.sg-soft.sg-blk-fit').textContent()) || '').includes('11:21 under the 45m slot'));
  ok('the box says when the set ends by the clock', ((await blk.textContent()) || '').includes('On at 21:15, off about 21:49'));
  await store(s => s.patch('bookings', 's-show1', { setLength: 30 })); await sleep(250);
  ok('a 30-minute set warns that the setlist is over', ((await blk.locator('.warn.sg-blk-fit').textContent()) || '').includes('3:39 over the 30m slot'));
  await store(s => s.patch('bookings', 's-show1', { setLength: 35 })); await sleep(250);
  ok('a 35-minute set fits (under by less than 5 minutes)', (await blk.locator('.sg-ok.sg-blk-fit').count()) === 1);
  await store(s => s.patch('bookings', 's-show1', { setLength: 45, setTime: '23:30', curfew: '00:00' })); await sleep(250);
  ok('a set that runs past a curfew after midnight is flagged', ((await blk.textContent()) || '').includes('off about 00:04: past the 00:00 curfew'));
  await store(s => s.patch('bookings', 's-show1', { setTime: '21:15', curfew: '23:00' })); await sleep(250);
  await blk.locator('button:has-text("Edit")').click(); await waitSheet('Edit setlist');
  ok('Edit opens the editor sized to the show’s set length', (await sheetNamed('Edit setlist').locator('#sl-target').inputValue()) === '45');
  ok('…and shows when the set ends', ((await sheetNamed('Edit setlist').textContent()) || '').includes('On at 21:15, off about 21:49'));
  await closeAll();
  await blk.locator('button:has-text("Print")').click(); await sleep(250);
  ok('Print from the box puts the show’s venue and date on the stage copy', ((await page.locator('#print-root .sg-stage-head').textContent()) || '').includes('The Lantern Rooms'));
  await afterPrint();
  await blk.locator('button:has-text("Remove from this show")').click(); await sleep(300);
  ok('Remove takes the setlist off the show and keeps the setlist', (await booking('s-show1')).setlistId === '' && !!(await list('s-clubset')));
  ok('the box then offers a choice and a new setlist', (await blk.locator('select').count()) === 1 && (await blk.locator('button:has-text("New setlist for this show")').count()) === 1 && (await blk.locator('summary').textContent()) === '');
  const optgroups = await blk.locator('optgroup').evaluateAll(gs => gs.map(g => g.label));
  ok('the act’s setlists come first in the choice', optgroups[0] === 'The Night Owls', optgroups.join(','));
  await blk.locator('select').selectOption('s-clubset'); await sleep(300);
  let b = await booking('s-show1');
  ok('choosing a setlist attaches it to the show', b.setlistId === 's-clubset');
  ok('a setlist with songs ticks “Setlist ready”', !!(b.checks && b.checks['show-setlist']));
  await blk.locator('button:has-text("Remove from this show")').click(); await sleep(300);
  ok('taking it off unticks “Setlist ready”', !((await booking('s-show1')).checks || {})['show-setlist']);
  await blk.locator('button:has-text("New setlist for this show")').click(); await waitSheet('Edit setlist');
  b = await booking('s-show1');
  const nl = await list(b.setlistId);
  ok('a new setlist for the show is made for its act and named after the night', nl && nl.actId === 's-owls' && nl.name.startsWith('The Lantern Rooms · '), nl && nl.name);
  ok('…and opens sized to the set length', (await sheetNamed('Edit setlist').locator('#sl-target').inputValue()) === '45');
  ok('an empty setlist does not tick “Setlist ready”', !(b.checks || {})['show-setlist']);
  await sheetNamed('Edit setlist').locator('[data-fk="sl-add-songs"]').click(); await waitSheet('Add songs');
  await sheetNamed('Add songs').locator('.sg-pick-row[data-song="s-song4"]').click();
  await sheetNamed('Add songs').locator('#sgp-add').click(); await sleep(300);
  ok('adding songs to it ticks “Setlist ready” on the show', !!((await booking('s-show1')).checks || {})['show-setlist']);
  await closeAll();
  // Switching to an empty setlist, or deleting the show's setlist, leaves the show with nothing ready: the tick comes off.
  const emptyId = await store(s => s.upsert('setlists', { name: 'Empty set', actId: 's-owls', gap: 20, items: [] }).id); await sleep(250);
  await blk.locator('select').selectOption(emptyId); await sleep(300);
  b = await booking('s-show1');
  ok('switching the show to an empty setlist unticks “Setlist ready”', b.setlistId === emptyId && !(b.checks || {})['show-setlist'], JSON.stringify(b.checks));
  await blk.locator('select').selectOption(nl.id); await sleep(300);
  ok('switching back to one with songs ticks it again', !!((await booking('s-show1')).checks || {})['show-setlist']);
  await blk.locator('button:has-text("Edit")').click(); await waitSheet('Edit setlist');
  await sheetNamed('Edit setlist').locator('[data-fk="sl-del"]').click(); await sleep(400);
  b = await booking('s-show1');
  ok('deleting the show’s setlist unticks “Setlist ready” too', !(await list(nl.id)) && b.setlistId === '' && !(b.checks || {})['show-setlist'], JSON.stringify(b.checks));
  await closeAll();

  /* ------------------------------- a rehearsal, and a bare show ------------------------------- */
  await page.evaluate(() => window.__drawBlk('s-reh')); await sleep(200);
  const reh = await blk.textContent();
  ok('a rehearsal shows its setlist with no slot to fit', reh.includes('Club set') && reh.includes('running time') && !reh.includes('slot'), reh.slice(0, 160));
  await store(s => s.upsert('bookings', { id: 'x-bare', kind: 'show', status: 'hold', date: '' }));
  await page.evaluate(() => window.__drawBlk('x-bare')); await sleep(200);
  await blk.locator('button:has-text("New setlist for this show")').click(); await waitSheet('Edit setlist');
  const bare = await list((await booking('x-bare')).setlistId);
  ok('a show with no act, venue, date or set length still gets a setlist', bare && bare.name === 'Show setlist' && bare.actId === '' && (await sheetNamed('Edit setlist').locator('#sl-target').inputValue()) === '');
  await closeAll();

  /* ------------------------------- records deleted elsewhere ------------------------------- */
  await page.evaluate(() => window.__drawBlk('s-reh')); await sleep(150);
  await store(s => s.remove('songs', 's-song1')); await sleep(300);
  const club = await list('s-clubset');
  ok('a deleted song stays in the setlist under its title', club.items.some(x => !x.songId && x.title === 'Harbour Lights'));
  ok('…and the box still shows it', ((await blk.textContent()) || '').includes('Harbour Lights'));
  await page.evaluate(() => import('./js/setlist.js').then(m => m.openSetlist('s-clubset'))); await waitSheet('Edit setlist');
  ok('the editor shows it as a free item that keeps its length (3:34)', (await sheetNamed('Edit setlist').locator('.sg-free:has-text("Harbour Lights") .sg-miss').count()) === 0 && club.items.find(x => x.title === 'Harbour Lights').duration === 214 && (await len('s-clubset')).songs === 8, JSON.stringify(club.items.find(x => x.title === 'Harbour Lights')));
  await store(s => s.remove('setlists', 's-clubset')); await sleep(300);
  ok('deleting the setlist elsewhere closes its open editor', (await page.locator('.sheet').count()) === 0);
  ok('…and the rehearsal’s box goes back to offering a choice', (await booking('s-reh')).setlistId === '' && (await blk.locator('button:has-text("New setlist for this rehearsal")').count()) === 1);
  await page.evaluate(() => import('./js/pages/songs.js').then(m => m.openSong('no-such-song'))); await sleep(200);
  ok('opening a song that is gone just says so', (await page.locator('.sheet').count()) === 0);
  await page.evaluate(() => document.getElementById('sg-test-host').remove());

  /* ------------------------------- a search left on with few songs ------------------------------- */
  await page.click('#sg-view-songs'); await sleep(200);
  await page.fill('#sg-q', 'ferry'); await sleep(250);
  await store(s => s.db.songs.map(x => x.id).filter(id => !['s-song8', 's-song2', 's-sable1'].includes(id)).forEach(id => s.remove('songs', id))); await sleep(300);
  ok('with 3 songs left, the search typed earlier still shows its box', (await page.locator('#sg-q').count()) === 1 && (await page.inputValue('#sg-q')) === 'ferry' && (await page.locator('.sg-song').count()) === 1);
  if (await page.locator('#sg-q').count()) { await page.fill('#sg-q', ''); await sleep(250); }
  ok('clearing it shows all 3 songs, and the box stays with the focus in it (it goes when the view changes)', (await page.locator('.sg-song').count()) === 3 && (await page.locator('#sg-q').count()) === 1 && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'sg-q');

  /* ------------------------------- empty states ------------------------------- */
  await store(s => s.eraseAll()); await sleep(300);
  await page.click('#sg-view-songs'); await sleep(200);
  ok('with no songs the page explains and offers to add one', (await page.locator('.empty').count()) === 1 && (await page.locator('.empty button:has-text("Add a song")').count()) === 1);
  await page.click('#sg-view-setlists'); await sleep(200);
  ok('with no setlists the page explains and offers to make one', (await page.locator('.empty button:has-text("New setlist")').count()) === 1);

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL songs crashed — ' + e.message); process.exit(1); });

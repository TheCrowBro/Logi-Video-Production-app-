// Acts: the empty page, making an act, its links, members, the press kit with its QR code, the input list (presets,
// renumber, move, add), the stage plot (drag with the mouse, nudge with the keys), the printed tech rider, editing,
// and deleting an act (its songs and bookings stay, without an act).
const { open, ok, sleep, go, topSheet } = require('../helpers.cjs');

const actNamed = (page, name) => page.evaluate(n => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.acts.find(a => a.name === n) || null))), name);
const printed = async (page, click) => {
  await page.evaluate(() => { window.__printed = []; window.print = () => { const r = document.getElementById('print-root'); window.__printed.push(r ? r.innerHTML : ''); }; });
  await click();
  await page.waitForFunction(() => window.__printed && window.__printed.length > 0, null, { timeout: 10000 });
  return page.evaluate(() => { const html = window.__printed.pop(); document.getElementById('print-root')?.remove(); document.body.classList.remove('print-doc'); return html; });
};

(async () => {
  /* ---------------- an empty database ---------------- */
  {
    const { browser, page, errors } = await open({ tab: 'acts' });
    await page.waitForSelector('.ac-page .empty');
    ok('an empty Acts page says what an act is', /band or artist/.test(await page.textContent('.ac-page .empty')));
    ok('the empty state offers + New act', await page.locator('#ac-new-empty').isVisible());
    await page.click('#ac-new-empty');
    await page.waitForSelector('.sheet[aria-label="New act"]');
    await topSheet(page).locator('input[data-key=name]').fill('Solo Me');
    await topSheet(page).locator('button[type=submit]').click();
    await page.waitForSelector('.ac-view .ac-title');
    ok('an act with only a name opens', (await page.textContent('.ac-title')) === 'Solo Me');
    ok('with no members, songs or bookings it says so', /No members yet/.test(await page.textContent('#ac-members')) && /Nothing booked/.test(await page.textContent('#ac-coming')));
    await page.click('#ac-tab-epk');
    await page.waitForSelector('.ac-qr-card');
    ok('with no link or contact, the press kit asks for one instead of a QR code', /Add a link/.test(await page.textContent('.ac-qr-card')) && (await page.locator('.ac-qr svg').count()) === 0);
    await page.click('#ac-tab-rider');
    await page.waitForSelector('#ac-inputs');
    ok('the rider starts empty with a hint', /No input list yet/.test(await page.textContent('#ac-inputs')) && /empty stage/.test(await page.textContent('#ac-plot')));
    ok('no errors in the console on an empty database', errors.length === 0, errors.slice(0, 5).join(' | '));
    await browser.close();
  }

  /* ---------------- the sample ---------------- */
  const { browser, page, errors } = await open({ sample: true, tab: 'acts' });
  const dialogs = [];
  page.on('dialog', d => dialogs.push(d.message())); // helpers.cjs accepts every dialog
  await page.waitForSelector('.ac-card');
  ok('the sample acts are listed', (await page.locator('.ac-card').count()) === 2);
  const owls = page.locator('.ac-card[data-id="s-owls"]');
  ok('a card shows genre, members and songs', /Indie rock · 4 members · 8 songs/.test(await owls.textContent()), await owls.textContent());
  ok('a card shows the next booking', /Next:/.test(await owls.textContent()));
  ok('the act colour is the card stripe', ((await owls.getAttribute('style')) || '').includes('#ff5c8a'));

  /* make an act */
  await page.click('#ac-new');
  await page.waitForSelector('.sheet[aria-label="New act"]');
  const form = topSheet(page);
  await form.locator('input[data-key=name]').fill('The Test Pilots');
  await form.locator('input[data-key=genre]').fill('Post-punk');
  await form.locator('textarea[data-key=links]').fill('Bandcamp: https://testpilots.example.com/music\nInstagram: instagram.com/testpilots\nBad: javascript:alert(1)\njust some words');
  await form.locator('input[data-key=email]').fill('pilots@example.com');
  await form.locator('textarea[data-key=bio]').fill('Three friends, one van.');
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('.ac-view .ac-title');
  let a = await actNamed(page, 'The Test Pilots');
  ok('a new act is stored with its details', !!a && a.genre === 'Post-punk' && a.email === 'pilots@example.com' && a.bio === 'Three friends, one van.');
  ok('a new act starts with empty lists', !!a && Array.isArray(a.members) && !a.members.length && Array.isArray(a.inputList) && Array.isArray(a.stagePlot));
  ok('a new act gets a colour no other act uses', !!a && /^#/.test(a.color) && !['#ff5c8a', '#22d3ee'].includes(a.color), a && a.color);
  ok('the new act opens', (await page.textContent('.ac-title')) === 'The Test Pilots');
  const id = a.id;

  /* links */
  const links = await page.$$eval('.ac-links a', as => as.map(x => ({ href: x.getAttribute('href'), text: x.textContent.trim(), target: x.getAttribute('target') })));
  ok('links render as buttons with their labels', links.length === 2 && /Bandcamp/.test(links[0].text) && /Instagram/.test(links[1].text), JSON.stringify(links));
  ok('a link typed without https gets it', !!links[1] && links[1].href === 'https://instagram.com/testpilots');
  ok('links open in a new tab', links.every(l => l.target === '_blank'));
  ok('a javascript: line is not a link', !links.some(l => /javascript/i.test(l.href)));
  ok('the email is a mailto button', (await page.locator('.ac-contact a[href="mailto:pilots@example.com"]').count()) === 1);

  /* members */
  await page.click('#ac-addm');
  await page.waitForSelector('.sheet[aria-label="Add members"] #ac-addm-s-maya');
  await page.click('#ac-addm-s-maya');
  await page.waitForSelector('#ac-addm-s-maya', { state: 'detached' });
  await page.click('#ac-addm-s-dee');
  ok('a picked person leaves the list to pick from', (await page.locator('#ac-addm-s-maya').count()) === 0);
  await page.click('#ac-addm-done');
  a = await actNamed(page, 'The Test Pilots');
  ok('members are stored on the act, in order', JSON.stringify(a.members) === '["s-maya","s-dee"]', JSON.stringify(a.members));
  const membersText = await page.textContent('#ac-members');
  ok('members show with their role', /Maya Brooks/.test(membersText) && /FOH engineer/.test(membersText));
  ok('two members with email give Email the band', /maya@example\.com,dee@example\.com/.test(await page.getAttribute('#ac-mailband', 'href')));
  await page.click('button[aria-label="Take Dee Okafor out of The Test Pilots"]');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('✕ asks, then takes a member out of the act', JSON.stringify(a.members) === '["s-maya"]' && /stay in People/.test(dialogs[dialogs.length - 1] || ''));
  ok('…and they stay in People', await page.evaluate(() => import('./js/store.js').then(s => !!s.byId('people', 's-dee'))));
  ok('the act counts its members', /1 member\b/.test(await page.textContent('.ac-hero')));

  /* edit keeps what the form does not show */
  await page.click('#ac-edit');
  await page.waitForSelector('.sheet[aria-label="Edit act"]');
  await topSheet(page).locator('input[data-key=genre]').fill('Post-punk revival');
  await topSheet(page).locator('button[type=submit]').click();
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('editing an act saves the change and keeps its members', a.genre === 'Post-punk revival' && JSON.stringify(a.members) === '["s-maya"]');

  /* book a show for the act */
  await page.click('#ac-book');
  await page.waitForSelector('.sheet select[data-key="actId"]', { timeout: 15000 });
  const preset = await page.evaluate(() => { const sel = [...document.querySelectorAll('.sheet select[data-key="actId"]')].pop(); return { value: sel.value, text: sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '' }; });
  ok('+ Book a show opens the new show form with this act picked', preset.text === 'The Test Pilots', JSON.stringify(preset));
  await page.keyboard.press('Escape'); await sleep(300);
  await go(page, 'acts');
  await page.waitForSelector('.ac-view .ac-title');
  ok('coming back to Acts shows the same act', (await page.textContent('.ac-title')) === 'The Test Pilots');

  /* press kit */
  await page.click('#ac-tab-epk');
  await page.waitForSelector('.ac-qr svg', { timeout: 15000 });
  ok('the press kit shows a QR code', (await page.locator('.ac-qr svg').count()) === 1);
  ok('the QR code is the first link', /Bandcamp: https:\/\/testpilots\.example\.com\/music/.test(await page.textContent('.ac-qr-card')));
  ok('the press kit is a document with the bio, links and line-up', (await page.locator('.ac-paper .cs-doc').count()) === 1 && /Three friends/.test(await page.textContent('.ac-paper')) && /Maya Brooks/.test(await page.textContent('.ac-paper')));
  const epk = await printed(page, () => page.click('#ac-epk-print'));
  ok('Print prints the press kit document', /cs-doc/.test(epk) && /PRESS KIT/.test(epk) && /The Test Pilots/.test(epk));
  ok('the printed press kit carries the QR code', /<svg[^>]*>/.test(epk) && /<path|<rect/.test(epk));
  ok('the printed press kit lists links and the line-up', /testpilots\.example\.com/.test(epk) && /Maya Brooks/.test(epk) && /Vocals/.test(epk));
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#ac-epk-save')]);
  ok('Save as a web page gives an .html file named after the act', download.suggestedFilename() === 'Press kit - The Test Pilots.html', download.suggestedFilename());
  await page.click('#ac-qr-big');
  await page.waitForSelector('.sheet[aria-label="QR code"] .ac-qr-full svg', { timeout: 15000 });
  const big = await page.locator('.ac-qr-full').boundingBox();
  ok('Show it big opens a bigger QR code in a sheet', big.width > (await page.locator('.ac-qr').boundingBox()).width, big.width);
  await page.keyboard.press('Escape');
  await sleep(200);

  /* input list */
  await page.click('#ac-tab-rider');
  await page.click('#ac-in-edit');
  await page.waitForSelector('.sheet[aria-label="Input list"]');
  await page.selectOption('#ac-in-preset', 'rock4');
  await page.waitForSelector('.ac-in-row');
  a = await actNamed(page, 'The Test Pilots');
  ok('a preset fills a typical input list', a.inputList.length === 14 && a.inputList[0].source === 'Kick' && a.inputList[0].ch === 1 && a.inputList[13].ch === 14, a.inputList.length);
  const count = (await page.textContent('.ac-in-status')).trim();
  ok('the editor counts the inputs', count === '14 inputs', count);
  const asked = dialogs.length;
  await page.selectOption('#ac-in-preset', 'duo');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('another preset asks before replacing the list, then replaces it', dialogs.length === asked + 1 && /Replace the 14 inputs/.test(dialogs[dialogs.length - 1]) && a.inputList.length === 8 && a.inputList[0].source === 'Tracks L');
  await page.selectOption('#ac-in-preset', 'rock4');
  await sleep(250);
  const third = page.locator('.ac-in-row').nth(2);
  await third.locator('[data-k=ch]').fill('30');
  await third.locator('[data-k=source]').click();
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('a typed channel number is saved when the box is left', a.inputList[2].ch === 30, a.inputList[2].ch);
  await page.click('button[aria-label="Move Snare down"]');
  await sleep(200);
  a = await actNamed(page, 'The Test Pilots');
  ok('↓ moves a row down', a.inputList[1].source === 'Hi-hat' && a.inputList[2].source === 'Snare');
  ok('the focus stays on the moved row’s arrow', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Move Snare down');
  await page.click('button[aria-label="Move Snare up"]');
  await sleep(200);
  a = await actNamed(page, 'The Test Pilots');
  ok('↑ moves it back', a.inputList[1].source === 'Snare' && a.inputList[2].source === 'Hi-hat');
  ok('the first row cannot move up, the last cannot move down', await page.locator('button[aria-label="Move Kick up"]').isDisabled() && await page.locator('button[aria-label="Move Backing vocal (bass) down"]').isDisabled());
  await page.click('#ac-in-renumber');
  await sleep(200);
  a = await actNamed(page, 'The Test Pilots');
  ok('Renumber numbers the channels in list order', a.inputList.every((r, i) => r.ch === i + 1), a.inputList.map(r => r.ch).join(','));
  await page.click('#ac-in-add');
  await sleep(150);
  await page.keyboard.type('Talkback');
  await page.click('#ac-in-done');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  const last = a.inputList[a.inputList.length - 1];
  ok('+ Add input adds a row with the next channel, saved on Done', a.inputList.length === 15 && last.source === 'Talkback' && last.ch === 15, JSON.stringify(last));
  ok('the page shows the input list', (await page.locator('#ac-inputs tbody tr').count()) === 15 && /Talkback/.test(await page.textContent('#ac-inputs')));
  await page.click('#ac-in-edit');
  await page.waitForSelector('.sheet[aria-label="Input list"] .ac-in-row');
  await page.locator('.ac-in-row').nth(4).locator('[data-k=ch]').fill('2');
  await page.click('#ac-in-done');
  await sleep(250);
  ok('a channel number used twice shows a warning', /Channel 2 is on the list twice/.test(await page.textContent('#ac-inputs')));

  /* stage plot */
  await page.click('button[aria-label="Add Drum kit to the stage plot"]');
  await page.waitForSelector('.ac-pl');
  a = await actNamed(page, 'The Test Pilots');
  const p0 = a.stagePlot[0];
  ok('a quick-add chip puts a label on the stage plot', a.stagePlot.length === 1 && p0.label === 'Drum kit');
  ok('a drum kit lands at the back in the middle', Math.abs(p0.x - 0.5) < 0.05 && p0.y < 0.3, `${p0.x},${p0.y}`);
  ok('the new label is selected, with Rename and Remove', /Selected: Drum kit/.test(await page.textContent('.ac-plot-tools')));
  const st = await page.locator('#ac-stage').boundingBox();
  const box = await page.locator('#ac-pl-' + p0.id).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 20, { steps: 5 });
  await page.mouse.move(cx + 60, cy + 40, { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  a = await actNamed(page, 'The Test Pilots');
  const p1 = a.stagePlot[0];
  ok('dragging a label with the mouse stores where it was dropped', Math.abs((p1.x - p0.x) - 60 / st.width) < 0.015 && Math.abs((p1.y - p0.y) - 40 / st.height) < 0.015, `${p0.x},${p0.y} → ${p1.x},${p1.y}`);
  ok('positions are stored between 0 and 1', p1.x > 0 && p1.x < 1 && p1.y > 0 && p1.y < 1);
  await page.focus('#ac-pl-' + p0.id);
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  await page.keyboard.press('ArrowDown');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  const p2 = a.stagePlot[0];
  ok('ArrowRight nudges a label right', Math.abs(p2.x - (p1.x + 0.02)) < 0.0015, `${p1.x} → ${p2.x}`);
  ok('ArrowDown nudges it toward the audience', Math.abs(p2.y - (p1.y + 0.02)) < 0.0015, `${p1.y} → ${p2.y}`);
  ok('the arrow keys do not spin the Rolodex', (await page.evaluate(() => window.logiPage())) === 'acts');
  ok('the label keeps the focus after a nudge', (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'ac-pl-' + p0.id);
  await page.keyboard.press('Shift+ArrowLeft');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('Shift+arrow moves in bigger steps', Math.abs(a.stagePlot[0].x - (p2.x - 0.1)) < 0.0015);
  await page.click('button[aria-label="Add Maya (Vocals) to the stage plot"]');
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('members are offered as labels by name and instrument', a.stagePlot.length === 2 && a.stagePlot[1].label === 'Maya (Vocals)');
  ok('a placed member is no longer offered', (await page.locator('button[aria-label="Add Maya (Vocals) to the stage plot"]').count()) === 0);
  ok('two labels do not land on top of each other', Math.hypot(a.stagePlot[0].x - a.stagePlot[1].x, a.stagePlot[0].y - a.stagePlot[1].y) > 0.05);
  await page.click('#ac-pl-rename');
  await page.waitForSelector('.sheet[aria-label="Stage plot label"]');
  await topSheet(page).locator('input[data-key=label]').fill('Maya (vocals, guitar)');
  await topSheet(page).locator('button[type=submit]').click();
  await sleep(250);
  a = await actNamed(page, 'The Test Pilots');
  ok('Rename changes a label', a.stagePlot[1].label === 'Maya (vocals, guitar)');

  /* the printed tech rider */
  const rider = await printed(page, () => page.click('#ac-print-rider'));
  ok('Print the tech rider prints the input list', /TECHNICAL RIDER/.test(rider) && /Input list/.test(rider) && /Kick/.test(rider) && /Talkback/.test(rider) && /<table/.test(rider));
  ok('…and the stage plot as a drawing with its labels', /<svg[^>]*ac-plot-svg/.test(rider) && /AUDIENCE/.test(rider) && /Drum kit/.test(rider) && /Maya \(vocals, guitar\)/.test(rider));
  ok('…and the contact', /pilots@example\.com/.test(rider));
  const [riderFile] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#ac-save-rider')]);
  ok('the tech rider saves as a web page', riderFile.suggestedFilename() === 'Tech rider - The Test Pilots.html', riderFile.suggestedFilename());
  const riderPage = require('fs').readFileSync(await riderFile.path(), 'utf8');
  ok('the saved tech rider is a whole page with the input list and plot', /^<!doctype html>/.test(riderPage) && /Talkback/.test(riderPage) && /ac-plot-svg/.test(riderPage));
  await go(page, 'songs');
  const owlsRider = await printed(page, () => page.evaluate(() => import('./js/pages/acts.js').then(m => m.printRider('s-owls'))));
  ok('printRider(actId) works from another page', /The Night Owls/.test(owlsRider) && /Beta 58 \(own\)/.test(owlsRider) && /4 monitor mixes/.test(owlsRider) && /Water, 8 towels/.test(owlsRider));
  ok('printRider of an act that is gone prints nothing', (await page.evaluate(() => import('./js/pages/acts.js').then(m => m.printRider('nope')))) === false);

  /* openAct from elsewhere, an act deleted elsewhere */
  await page.evaluate(() => import('./js/pages/acts.js').then(m => m.openAct('s-owls')));
  await page.waitForSelector('.ac-view .ac-title');
  ok('openAct goes to Acts and shows the act', (await page.evaluate(() => window.logiPage())) === 'acts' && (await page.textContent('.ac-title')) === 'The Night Owls');
  ok('the act shows its bookings coming up', (await page.locator('#ac-coming .ac-bk').count()) >= 3);
  ok('…and its songs and setlists', /8\s*songs/.test(await page.textContent('#ac-songs')) && /1\s*setlist/.test(await page.textContent('#ac-songs')));

  /* walkthroughs: the act's, through its three parts, and the input list sheet's */
  await page.click('#helpBtn');
  await page.waitForSelector('.tour-card');
  const titles = [];
  for (let i = 0; i < 14 && await page.locator('.tour-card').count(); i++) {
    titles.push(await page.textContent('#tour-title'));
    await page.click('.tour-actions .btn.primary');
    await sleep(1000);
  }
  ok('the act’s walkthrough runs through all three parts', titles.includes('Members') && titles.includes('QR code') && titles.includes('Stage plot') && titles[titles.length - 1] === 'Print the tech rider', titles.join(' › '));
  await page.click('#ac-in-edit');
  await page.waitForSelector('.sheet[aria-label="Input list"] .sheet-help');
  await page.click('.sheet[aria-label="Input list"] .sheet-help');
  await page.waitForSelector('.tour-card');
  ok('the input list sheet has its own walkthrough', (await page.textContent('#tour-title')) === 'Input list');
  await page.keyboard.press('Escape');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(200);
  ok('the walkthroughs close cleanly', (await page.locator('.tour-card').count()) === 0 && (await page.locator('.sheet').count()) === 0);
  await page.click('#ac-tab-about');
  await page.evaluate(i => import('./js/pages/acts.js').then(m => m.openAct(i)), id);
  await page.waitForSelector('.ac-view .ac-title');
  await page.evaluate(i => import('./js/store.js').then(s => { s.remove('acts', i); }), id);
  await page.waitForSelector('.ac-page .ac-card');
  ok('an act deleted elsewhere goes back to the list', (await page.locator('.ac-view').count()) === 0);

  /* delete an act: its songs and bookings stay, without an act */
  await page.evaluate(() => import('./js/pages/acts.js').then(m => m.openAct('s-owls')));
  await page.waitForSelector('#ac-delete');
  await page.click('#ac-delete');
  await page.waitForSelector('.ac-page');
  await sleep(200);
  const after = await page.evaluate(() => import('./js/store.js').then(s => ({ act: !!s.byId('acts', 's-owls'), songs: s.db.songs.filter(x => x.actId === 's-owls').length, sets: s.db.setlists.filter(x => x.actId === 's-owls').length,
    bookings: s.db.bookings.filter(b => b.actId === 's-owls').length, song1: (s.byId('songs', 's-song1') || {}).actId, show1: (s.byId('bookings', 's-show1') || {}).actId })));
  ok('Delete asks first, saying what is kept', /Its \d+ bookings, 8 songs and 1 setlist stay/.test(dialogs[dialogs.length - 1] || ''), dialogs[dialogs.length - 1]);
  ok('deleting an act removes it', !after.act && (await page.locator('.ac-card[data-id="s-owls"]').count()) === 0);
  ok('its songs, setlists and bookings stay, with no act', after.songs === 0 && after.sets === 0 && after.bookings === 0 && after.song1 === '' && after.show1 === '', JSON.stringify(after));

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL acts spec crashed — ' + e.message); process.exit(1); });

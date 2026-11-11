// The day sheet: the booking's box, the sheet with its preview and ways to send it, the text version, the link and the
// band's page (daysheet.html), the order of the day past midnight, and that no money ever shows.
// The box is drawn on its own here (the booking page is another feature), exactly as the booking page draws it.
const { open, ok, sleep, BASE } = require('../helpers.cjs');
const fs = require('fs');
const path = require('path');
const OUT = process.env.S || path.join(__dirname, '..', 'output');

const MONEY = text => [/\$\s?\d/, /guarantee/i, /ticket price/i, /\bfee\b/i, /settle/i, /budget/i, /invoice/i, /\b70\s?%/, /\b250\b/, /\b999\b/, /per hour/i].filter(re => re.test(text)).map(String);
const SETLIST = ['Static Hearts', 'Harbour Lights', 'Northbound', 'Lanterns', 'Paper Moon', 'Ghost Signal', 'Low Tide', 'Last Ferry Home'];
const LINEUP = ['Maya Brooks', 'Leo Grant', 'Priya Shah', 'Jonah Reyes', 'Dee Okafor'];

(async () => {
  const { browser, ctx, page, errors } = await open({ sample: true, permissions: ['clipboard-read', 'clipboard-write'] });
  // The copy path: no share sheet on this machine (a stub stands in for a phone's later on).
  await page.evaluate(() => { try { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); } catch (e) { /* not there */ } });
  const sheet = page.locator('.sheet[aria-label="Day sheet"]');
  const doc = sheet.locator('.ds-preview .ds-doc');
  const times = loc => loc.locator('.cs-time').evaluateAll(els => els.map(e => e.querySelector('span').textContent + ' ' + e.querySelector('b').textContent));
  const booking = id => page.evaluate(i => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.byId('bookings', i)))), id);
  const clip = () => page.evaluate(() => navigator.clipboard.readText());
  // Draws the Day sheet box for a booking, as the booking page does, in a holder the app does not redraw.
  const drawBlock = id => page.evaluate(async i => {
    const blk = (await import('./js/blocks/daysheet.js')).default, { byId } = await import('./js/store.js');
    document.getElementById('ds-test')?.remove();
    const b = byId('bookings', i);
    const box = document.createElement('details'); box.id = 'ds-test'; box.className = 'blk'; box.open = true;
    const sum = document.createElement('summary'); sum.textContent = blk.title + ' — ' + blk.summary(b); box.append(sum, blk.render(b, { sym: '$', open() {} }));
    document.getElementById('app').append(box);
    return { summary: blk.summary(b), kinds: blk.kinds, order: blk.order, id: blk.id };
  }, id);
  const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.sheet[aria-label="Day sheet"]')); };

  /* ---------------- the box on the booking ---------------- */
  const blk = await drawBlock('s-show1');
  ok('the block is for shows, sessions and rehearsals, after the guest list', blk.id === 'daysheet' && blk.kinds.join() === 'show,session,rehearsal' && blk.order === 50, JSON.stringify(blk));
  ok('the closed box shows the times until it is sent', blk.summary === 'Load-in 17:00 · on 21:15', blk.summary);
  const chips = await page.locator('#ds-test .ds-chip').evaluateAll(els => els.map(e => e.querySelector('span').textContent + ' ' + e.querySelector('b').textContent));
  ok('the box shows the day’s times in order', chips.join(' | ') === 'Load-in 17:00 | Soundcheck 18:00 | Doors 19:30 | On stage 21:15 | Off stage 22:00 | Curfew 23:00', chips.join(' | '));
  const blkText = await page.locator('#ds-test').innerText();
  ok('the box has the key lines: venue, line-up, setlist, guest count', /The Lantern Rooms/.test(blkText) && /5 on the line-up: Maya, Leo, Priya, Jonah, Dee/.test(blkText) && /Club set · 8 songs/.test(blkText) && /Guest list: 3 of 6/.test(blkText), blkText.replace(/\n/g, ' / ').slice(0, 300));
  ok('the box says it has not been sent and shows no money', /Not sent to the band yet/.test(blkText) && MONEY(blkText.replace(/Never on it:[^\n]*/, '')).length === 0, MONEY(blkText).join());
  ok('the box has Open, Share link, Email the band and Print', (await page.locator('#ds-test .ds-blk-actions .btn').allInnerTexts()).join('|') === '📋 Open sheet|📤 Share link|✉ Email (5)|🖨 Print');
  await page.waitForFunction(() => /^mailto:/.test(document.querySelector('#ds-test a.btn[aria-label^="Email the day sheet to the band"]').getAttribute('href') || ''));

  /* ---------------- the sheet ---------------- */
  await page.locator('#ds-test button[aria-label="Open the day sheet"]').click();
  await doc.waitFor();
  const t1 = await times(doc);
  ok('the sheet’s document has the times in day order', t1.join(' | ') === 'Load-in 17:00 | Soundcheck 18:00 | Doors 19:30 | On stage 21:15 | Off stage 22:00 | Curfew 23:00', t1.join(' | '));
  const songs = await doc.locator('.ds-setlist tbody tr:not(.ds-total):not(.ds-brk) td:nth-child(2)').evaluateAll(els => els.map(e => e.firstChild.textContent));
  ok('the setlist is on it, in order', songs.join('|') === SETLIST.join('|'), songs.join('|'));
  const docText = await doc.innerText();
  ok('the setlist has keys, lengths, the total and the slot', /G major/.test(docText) && /3:09/.test(docText) && /Total · 8 songs · 45m slot/.test(docText), (docText.match(/Total[^\n]*/) || [''])[0]);
  ok('the line-up is on it with what they play and their phones', LINEUP.every(n => docText.includes(n)) && /Vocals, rhythm guitar/.test(docText) && /\+1 555 0141/.test(docText) && /FOH engineer/.test(docText));
  ok('the venue, the way in and parking are on it', /The Lantern Rooms/.test(docText) && /12 Quay Street, Harbourtown/.test(docText) && /Rear door on Ship Lane/.test(docText) && /2 spaces behind the venue/.test(docText));
  ok('the address links to a map', /^https:\/\/www\.google\.com\/maps\//.test(await doc.locator('.ds-place a').first().getAttribute('href') || ''));
  ok('the running order is on it, with our set marked', /Paper Kites \(support\)/.test(docText) && (await doc.locator('tr.ds-ours').count()) === 1 && /our set/i.test(await doc.locator('tr.ds-ours').innerText()));
  ok('the promoter is a contact once (the venue’s contact is the same person)', (docText.match(/Rosa Lind/g) || []).length === 1, String((docText.match(/Rosa Lind/g) || []).length));
  ok('backline: what we bring with how many and whose, and what the venue provides', /Telecaster/.test(docText) && /Maya Brooks/.test(await doc.locator('.ds-backline').innerText()) && /SM58\s+2/.test(await doc.locator('.ds-backline').innerText()) && /Drum kit shell pack/.test(docText) && /Midas M32/.test(docText));
  ok('hospitality, accommodation, guest count and notes are on it', /hot food for 6/.test(docText) && /Seaview Inn/.test(docText) && /3 people on the list · cap 6/.test(docText) && /Sample show\./.test(docText));
  ok('guest names stay off unless chosen', !/Ivy Chen/.test(docText) && !/photographer/.test(docText));
  ok('NO money on the day sheet: no $ amounts, guarantee, fee, ticket price, settlement or budget', MONEY(docText).length === 0 && !docText.includes('$'), MONEY(docText).join(', '));
  ok('the status says it has not gone out yet', /Not sent to the band yet/.test(await sheet.locator('.ds-status').innerText()));
  const href = await sheet.locator('a.btn', { hasText: 'Email the band' }).getAttribute('href');
  ok('Email the band is addressed to everyone on the booking', /^mailto:maya@example\.com,leo@example\.com,priya@example\.com,jonah@example\.com,dee@example\.com\?/.test(href), href.slice(0, 120));
  const subject = new URLSearchParams(href.split('?')[1]).get('subject'), body = new URLSearchParams(href.split('?')[1]).get('body');
  const short = await page.evaluate(() => import('./js/util.js').then(u => u.fmtShort(u.ymd(new Date(Date.now() + 5 * 864e5)))));
  ok('the email subject is “Day sheet – title – date”', subject === `Day sheet – The Night Owls @ The Lantern Rooms – ${short}`, subject);
  ok('the email carries the link, and stays under 1,800 characters', /daysheet\.html#1\./.test(body) && href.length <= 1800, href.length + ' chars');
  await page.screenshot({ path: path.join(OUT, 'daysheet-sheet.png') });

  // The text version (for a band chat)
  const text = await page.evaluate(() => Promise.all([import('./js/daysheet.js'), import('./js/store.js')]).then(([d, s]) => d.daySheetText(s.byId('bookings', 's-show1'))));
  ok('the text version has the times in order, the venue, the line-up and the setlist', /^DAY SHEET – The Night Owls @ The Lantern Rooms/.test(text) && /Load-in 17:00\nSoundcheck 18:00\nDoors 19:30\nOn stage 21:15\nOff stage 22:00\nCurfew 23:00/.test(text) && /12 Quay Street/.test(text) && /Maya Brooks, Vocals, rhythm guitar: \+1 555 0141/.test(text) && /1\. Static Hearts \(G major\)/.test(text) && /8\. Last Ferry Home \(A major\) \[encore\]/.test(text), text.slice(0, 200));
  ok('the text version has no money either', MONEY(text).length === 0 && !text.includes('$'), MONEY(text).join());

  /* ---------------- sharing ticks the checklist ---------------- */
  ok('before sharing, “Day sheet sent” is not ticked', !((await booking('s-show1')).checks || {})['show-daysheet']);
  await sheet.getByRole('button', { name: 'Share the day sheet link' }).click();
  await page.waitForFunction(() => import('./js/store.js').then(s => !!(s.byId('bookings', 's-show1').checks || {})['show-daysheet']), null, { timeout: 8000 });
  const shared = await booking('s-show1');
  const link = await clip();
  ok('Share link (no share sheet here) copies the link to daysheet.html', /^http:\/\/localhost:\d+\/daysheet\.html#1\.[\w-]+$/.test(link), link.slice(0, 80));
  ok('sharing ticks “Day sheet sent to the band” on the show and remembers when', shared.checks['show-daysheet'] === true && shared.daySheet && shared.daySheet.sentAt > 0 && !!shared.daySheet.sig);
  await page.waitForFunction(() => /Sent to the band/.test(document.querySelector('.ds-status').textContent));
  ok('the status line now says it was sent', /✓ Sent to the band/.test(await sheet.locator('.ds-status').innerText()));
  ok('the link holds no money fields at all', await page.evaluate(async u => { const m = await import('./js/link-pack.js'); const d = await m.unpack(u.split('#')[1]); const s = JSON.stringify(d); return !/deal|fee|ticket|settle|budget|rate|invoice|quote|value/i.test(s) && d.v === 1; }, link));

  /* ---------------- the band's page ---------------- */
  const band = await ctx.newPage();
  const bandErrors = [];
  band.on('pageerror', e => bandErrors.push(e.message));
  band.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) bandErrors.push(m.text()); });
  await band.goto(link); await band.waitForSelector('.ds-paper .ds-doc');
  const bt = await times(band.locator('.ds-doc'));
  ok('the link opens daysheet.html with the same times in the same order', bt.join(' | ') === t1.join(' | '), bt.join(' | '));
  const bandText = await band.locator('.ds-doc').innerText();
  ok('the band’s page has the setlist, the line-up and the venue', SETLIST.every(s => bandText.includes(s)) && LINEUP.every(n => bandText.includes(n)) && /The Lantern Rooms/.test(bandText));
  ok('the band’s page shows no money', MONEY(bandText).length === 0 && !bandText.includes('$'), MONEY(bandText).join());
  ok('the band’s page names the sheet and who sent it', /The Night Owls @ The Lantern Rooms/.test(await band.locator('.ds-bar').innerText()) && /Sample Producer/.test(await band.locator('.ds-bar').innerText()) && /Day sheet/.test(await band.title()));
  ok('the phone numbers can be tapped to call', (await band.locator('.ds-doc a[href^="tel:"]').count()) >= 5);
  await band.screenshot({ path: path.join(OUT, 'daysheet-band-page.png'), fullPage: true });
  await band.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await band.getByRole('button', { name: /Print/ }).click();
  ok('Print on the band’s page prints', (await band.evaluate(() => window.__printed)) === 1);
  const [dl] = await Promise.all([band.waitForEvent('download'), band.getByRole('button', { name: /Add to calendar/ }).click()]);
  const ics = fs.readFileSync(await dl.path(), 'utf8');
  const ymd5 = await page.evaluate(() => import('./js/util.js').then(u => u.ymd(new Date(Date.now() + 5 * 864e5)).replace(/-/g, '')));
  ok('Add to calendar gives an event from load-in to curfew at the venue', /\.ics$/.test(dl.suggestedFilename()) && ics.includes(`DTSTART:${ymd5}T170000`) && ics.includes(`DTEND:${ymd5}T230000`) && /SUMMARY:The Night Owls @ The Lantern Rooms/.test(ics) && /LOCATION:The Lantern Rooms\\, 12 Quay Street/.test(ics) && /UID:daysheet-s-show1@gigdex/.test(ics) && /\r\n/.test(ics), dl.suggestedFilename());
  ok('every line of the calendar file is folded to 75 bytes', ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75));

  /* ---------------- after midnight ---------------- */
  await closeSheet();
  await page.evaluate(() => import('./js/store.js').then(s => { const u = (n) => { const d = new Date(Date.now() + n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    s.upsert('bookings', { id: 't-late', kind: 'show', status: 'confirmed', actId: 's-owls', date: u(7), venueId: 's-harbour', loadIn: '20:00', soundcheck: '21:00', doors: '22:00', setTime: '23:15', setLength: 60, curfew: '00:30', people: ['s-maya', 's-leo'], deal: { type: 'guarantee', fee: 999, ticketPrice: 25, capacity: 900 }, budget: [{ id: 'x', cat: 'Travel', desc: 'Van', amount: 999 }], notes: 'Late one.' }); }));
  await page.evaluate(() => import('./js/daysheet.js').then(m => m.openDaySheet('t-late')));
  await doc.waitFor();
  const t2 = await times(doc);
  ok('a 00:30 curfew comes after the evening times, with the off-stage time before it', t2.join(' | ') === 'Load-in 20:00 | Soundcheck 21:00 | Doors 22:00 | On stage 23:15 | Off stage 00:15 | Curfew 00:30', t2.join(' | '));
  ok('times after midnight are marked', (await doc.locator('.cs-time.ds-next').count()) === 2 && /after midnight/.test(await doc.locator('.cs-time.ds-next').first().innerText()));
  const lateText = await doc.innerText();
  ok('the late show’s deal and budget stay off it', MONEY(lateText).length === 0 && !lateText.includes('$'), MONEY(lateText).join());
  ok('the late show’s text version puts the curfew last, after midnight', /Off stage 00:15 \(after midnight\)\nCurfew 00:30 \(after midnight\)/.test(await page.evaluate(() => Promise.all([import('./js/daysheet.js'), import('./js/store.js')]).then(([d, s]) => d.daySheetText(s.byId('bookings', 't-late'))))));
  await page.screenshot({ path: path.join(OUT, 'daysheet-late.png') });
  // Print from the sheet: the page's own print dialog, the sheet the only thing printed, then cleaned up.
  await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = { docs: document.querySelectorAll('#print-root .ds-doc').length, cls: document.body.classList.contains('print-doc'), extra: [...document.querySelectorAll('style')].some(s => /#print-root \.ds-doc/.test(s.textContent)) }; window.dispatchEvent(new Event('afterprint')); }; });
  await sheet.getByRole('button', { name: 'Print the day sheet' }).click();
  await page.waitForFunction(() => window.__printed);
  const printed = await page.evaluate(() => ({ p: window.__printed, cleaned: !document.getElementById('print-root') && !document.body.classList.contains('print-doc') }));
  ok('Print puts the day sheet (only) on the page’s print dialog, then cleans up', printed.p.docs === 1 && printed.p.cls && printed.p.extra && printed.cleaned, JSON.stringify(printed));
  await page.waitForFunction(() => import('./js/store.js').then(s => !!(s.byId('bookings', 't-late').checks || {})['show-daysheet']));
  ok('printing ticks “Day sheet sent” too', true);
  const lateLink = await page.evaluate(() => Promise.all([import('./js/daysheet.js'), import('./js/store.js')]).then(([d, s]) => d.daySheetLink(s.byId('bookings', 't-late'))));
  await band.goto(lateLink); await band.waitForFunction(() => /Harbour Hall/.test((document.querySelector('.ds-doc h2') || {}).textContent || ''));
  ok('the band’s page keeps the after-midnight order', (await times(band.locator('.ds-doc'))).join(' | ') === t2.join(' | '));
  const [dl2] = await Promise.all([band.waitForEvent('download'), band.getByRole('button', { name: /Add to calendar/ }).click()]);
  const ics2 = fs.readFileSync(await dl2.path(), 'utf8');
  const [d7, d8] = await page.evaluate(() => import('./js/util.js').then(u => [7, 8].map(n => u.ymd(new Date(Date.now() + n * 864e5)).replace(/-/g, ''))));
  ok('the calendar event ends the next morning at the curfew', ics2.includes(`DTSTART:${d7}T200000`) && ics2.includes(`DTEND:${d8}T003000`), (ics2.match(/DT(START|END)[^\r]*/g) || []).join(' '));

  // Copy text: the text plus the link, and it counts as sending
  await sheet.getByRole('button', { name: 'Copy the day sheet as text' }).click(); await sleep(400);
  const copied = await clip();
  ok('Copy text copies the sheet as text with the link at the end', /^DAY SHEET – The Night Owls @ Harbour Hall/.test(copied) && /The full day sheet: http:\/\/localhost:\d+\/daysheet\.html#/.test(copied), copied.slice(0, 60));

  // Save as a web page
  const [dl3] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Save the day sheet as a web page' }).click()]);
  const html = fs.readFileSync(await dl3.path(), 'utf8');
  ok('Save as a web page saves the document with its styles, and no money', /^Day sheet - The Night Owls @ Harbour Hall.*\.html$/.test(dl3.suggestedFilename()) && /<style>[\s\S]*\.cs-doc[\s\S]*\.ds-doc/.test(html) && /DAY SHEET/.test(html) && !/\$|999/.test(html.replace(/<style>[\s\S]*<\/style>/, '')), dl3.suggestedFilename());
  await closeSheet();

  /* ---------------- what goes on it ---------------- */
  await page.evaluate(() => import('./js/daysheet.js').then(m => m.openDaySheet('s-show1')));
  await doc.waitFor();
  await sheet.locator('.ds-parts > summary').click();
  await sheet.getByLabel('Guest list names and +1s').check();
  await page.waitForFunction(() => /Ivy Chen \+1/.test(document.querySelector('.ds-preview').textContent));
  ok('ticking guest names puts them on the sheet, and it is remembered', /Ivy Chen \+1, Sam \(photographer\)/.test(await doc.innerText()) && (await page.evaluate(() => JSON.parse(localStorage.getItem('gigdex-daysheet')).guestNames)) === true);
  await sheet.getByLabel('Booking notes').uncheck();
  await page.waitForFunction(() => !/Sample show\./.test(document.querySelector('.ds-preview').textContent));
  ok('unticking booking notes takes them off', !/Sample show\./.test(await doc.innerText()));
  ok('changing what goes on it is not a change to the sheet that was sent', /✓ Sent to the band/.test(await sheet.locator('.ds-status').innerText()));
  await sheet.getByLabel('Booking notes').check(); await sheet.getByLabel('Guest list names and +1s').uncheck(); await sleep(200);

  /* ---------------- changed since it was sent ---------------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.patch('bookings', 's-show1', { deal: { ...s.byId('bookings', 's-show1').deal, fee: 300 } })));
  await sleep(250);
  ok('a change to the deal is not a change to the day sheet', /✓ Sent to the band/.test(await sheet.locator('.ds-status').innerText()));
  await page.evaluate(() => import('./js/store.js').then(s => s.patch('bookings', 's-show1', { doors: '19:45' })));
  await page.waitForFunction(() => /Changed since/.test(document.querySelector('.ds-status').textContent));
  ok('changing the doors time shows “changed since it was sent” and the preview follows', /Doors 19:45/.test((await times(doc)).join(' | ')));
  ok('the closed box says it changed', (await drawBlock('s-show1')).summary === 'Changed since sent');
  await closeSheet();

  /* ---------------- on a phone: the share sheet ---------------- */
  await page.evaluate(() => { window.__shared = null; Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: function (d) { window.__shared = d; return Promise.resolve(); } }); });
  await drawBlock('s-show2');
  await page.waitForFunction(() => /^mailto:/.test(document.querySelector('#ds-test a.btn[aria-label^="Email the day sheet to the band"]').getAttribute('href') || ''));
  await page.locator('#ds-test button[aria-label="Share the day sheet link"]').click();
  await page.waitForFunction(() => window.__shared);
  const viaShare = await page.evaluate(() => window.__shared);
  ok('Share link uses the phone’s share sheet where there is one, with the link and a title', /daysheet\.html#1\./.test(viaShare.url) && viaShare.title === 'Day sheet – The Night Owls @ Harbour Hall', JSON.stringify(viaShare).slice(0, 120));
  await page.waitForFunction(() => import('./js/store.js').then(s => !!(s.byId('bookings', 's-show2').checks || {})['show-daysheet']));
  ok('sharing from the box ticks “Day sheet sent” too', (await drawBlock('s-show2')).summary === 'Sent');
  await page.evaluate(() => { Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true }); });

  /* ---------------- a sheet too long for an email link ---------------- */
  const longMail = await page.evaluate(async () => {
    const [d, s] = await Promise.all([import('./js/daysheet.js'), import('./js/store.js')]);
    s.patch('bookings', 's-show1', { notes: Array.from({ length: 60 }, (_, i) => `Note ${i}: bring spare strings, sticks and a ${['red', 'blue', 'green'][i % 3]} gaffer roll ${Math.random().toString(36).slice(2)}`).join('\n') });
    const b = s.byId('bookings', 's-show1'), url = await d.daySheetLink(b), m = d.emailFor(b, url);
    return { mode: m.mode, len: m.href.length, linkLen: url.length, body: new URLSearchParams(m.href.split('?')[1]).get('body') };
  });
  ok('a sheet too long for a mail link: the email asks to paste the link, and stays under 1,800 characters', longMail.mode === 'paste' && longMail.len <= 1800 && /Paste the link here/.test(longMail.body) && longMail.linkLen > 1800, `${longMail.mode}, ${longMail.len} chars, link ${longMail.linkLen}`);
  await page.evaluate(() => import('./js/store.js').then(s => s.patch('bookings', 's-show1', { notes: 'Sample show.' })));
  await page.screenshot({ path: path.join(OUT, 'daysheet-block.png') });

  /* ---------------- a studio session ---------------- */
  const sess = await drawBlock('s-sess1');
  ok('a session’s box shows its start and finish', sess.summary === '10:00–18:00', sess.summary);
  await page.locator('#ds-test button[aria-label="Open the day sheet"]').click(); await doc.waitFor();
  const sessText = await doc.innerText();
  ok('a session’s sheet: start and finish, the studio, people, songs and what is due', (await times(doc)).join(' | ') === 'Start 10:00 | Finish 18:00' && /Echo Chamber Studios/.test(sessText) && /Sable/.test(sessText) && /Marcus Bell/.test(sessText) && /Undertow/.test(sessText) && /Rough mix of Undertow/.test(sessText) && /Stems for the mix engineer/.test(sessText) && /Rhodes, upright piano/.test(sessText), sessText.replace(/\n/g, ' / ').slice(0, 300));
  ok('a session’s sheet shows no rate or money', MONEY(sessText).length === 0 && !sessText.includes('$'), MONEY(sessText).join());
  await sheet.getByRole('button', { name: 'Share the day sheet link' }).click();
  await page.waitForFunction(() => import('./js/store.js').then(s => !!(s.byId('bookings', 's-sess1').daySheet || {}).sentAt));
  const sessB = await booking('s-sess1');
  ok('sharing a session’s sheet remembers it was sent (no show checklist line to tick)', !(sessB.checks || {})['show-daysheet'] && (await drawBlock('s-sess1')).summary === 'Sent');
  await closeSheet();

  /* ---------------- edges: no act, no venue, deleted while open ---------------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-bare', kind: 'rehearsal', status: 'hold', date: s.db.bookings[0].date })));
  await page.evaluate(() => import('./js/daysheet.js').then(m => m.openDaySheet('t-bare'))); await doc.waitFor();
  const bare = await doc.innerText();
  ok('a rehearsal with no act, venue, times or people still makes a sheet', /Rehearsal/.test(bare) && /Times to be confirmed/.test(bare), bare.slice(0, 120));
  ok('it says what is missing', /Not on it yet: times, the room and the line-up/.test(await sheet.locator('.ds-hints').innerText()));
  await page.evaluate(() => import('./js/store.js').then(s => s.remove('bookings', 't-bare')));
  await page.waitForFunction(() => /was deleted/.test(document.querySelector('.sheet[aria-label="Day sheet"]').textContent));
  ok('a booking deleted while its sheet is open says so, and its buttons stop', await sheet.getByRole('button', { name: 'Print the day sheet' }).isDisabled());
  await closeSheet();
  const gone = await page.evaluate(() => import('./js/daysheet.js').then(m => m.openDaySheet('no-such-booking')));
  ok('opening the sheet of a booking that is gone shows a message, not an error', gone === null && /not here any more/.test(await page.locator('.toast').last().innerText()));

  /* ---------------- links that are broken or tampered with ---------------- */
  await band.goto(BASE + 'daysheet.html'); await band.waitForSelector('.ds-msg h1');
  ok('a link with nothing after the # says it is incomplete', /This link is incomplete/.test(await band.locator('.ds-msg').innerText()) && /part after the # is missing/.test(await band.locator('.ds-msg').innerText()));
  await band.goto(BASE + 'daysheet.html#1.AAAA-not-a-sheet'); await band.waitForFunction(() => /damaged/.test((document.querySelector('.ds-msg') || {}).textContent || ''));
  ok('a damaged link says it is incomplete, nicely', /This link is incomplete/.test(await band.locator('.ds-msg').innerText()) && /cut off/.test(await band.locator('.ds-msg').innerText()));
  await band.screenshot({ path: path.join(OUT, 'daysheet-band-broken.png') });
  const evil = await page.evaluate(() => import('./js/link-pack.js').then(m => m.pack({ v: 1, kind: 'show', title: '<img src=x onerror="window.__x=1">Owls', date: '2026-12-01', deal: { fee: 5000 }, fee: 5000, ticketPrice: 30, times: [{ k: 'doors', t: '19:00' }, { k: 'onerror', t: '20:00' }], people: [{ name: 'Al', phone: 'javascript:alert(1)', email: 'x@y.z" onmouseover="1' }], setlist: { rows: [{ t: 'Song', len: '3:00' }], total: '3:00', songs: 1 } })));
  await band.goto(BASE + 'daysheet.html#' + evil); await band.waitForSelector('.ds-paper .ds-doc');
  const evilText = await band.locator('.ds-doc').innerText();
  ok('a tampered link shows text as text, and only the day sheet’s own fields', (await band.locator('.ds-doc img').count()) === 0 && /<img src=x/.test(evilText) && !/5000/.test(evilText) && (await times(band.locator('.ds-doc'))).join('|') === 'Doors 19:00' && !(await band.evaluate(() => window.__x)));
  ok('a tampered phone or email does not become a link', (await band.locator('.ds-doc a[href^="javascript"]').count()) === 0 && (await band.locator('.ds-doc a[href^="mailto"]').count()) === 0);
  ok('the band’s page has no errors and no blocked content', bandErrors.length === 0, bandErrors.slice(0, 3).join(' | '));

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL daysheet crashed — ' + e.message); process.exit(1); });

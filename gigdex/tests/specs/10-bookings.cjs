// Bookings: the calendar, Coming up, a day, the new-booking form for each kind, the booking page (times past midnight,
// status, duplicate, delete from the page and by press and hold, the .ics files), and the bookings feature's own boxes
// (advance checklist with the person's own lines and the advance email, line-up & gear with clashes, notes).
const fs = require('fs');
const { open, ok, sleep } = require('../helpers.cjs');

const rec = (page, id) => page.evaluate(id => import('./js/store.js').then(s => { const b = s.byId('bookings', id); return b ? JSON.parse(JSON.stringify(b)) : null; }), id);
const byVenueName = (page, n) => page.evaluate(n => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => x.venueName === n); return b ? JSON.parse(JSON.stringify(b)) : null; }), n);
const dayFromNow = (page, n) => page.evaluate(n => import('./js/util.js').then(u => { const d = new Date(); d.setDate(d.getDate() + n); return u.ymd(d); }), n);
const compact = iso => iso.replace(/-/g, '');
const sheetNamed = (page, title) => page.locator(`.sheet[aria-label="${title}"]`);
async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), click()]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
}
async function press(page, loc, ms) {
  await loc.scrollIntoViewIfNeeded(); await sleep(200);
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(30, b.height / 2)); await page.mouse.down(); await sleep(ms);
}
const unfold = t => t.replace(/\r\n /g, '');

(async () => {
  /* ------------------------------ an empty diary ------------------------------ */
  {
    const { browser, page, errors } = await open();
    await page.waitForSelector('.bk-monthview');
    ok('with no bookings, Coming up says what goes there and offers a new booking', /Nothing coming up/.test(await page.locator('.bk-monthview .empty').innerText()) && (await page.locator('.bk-monthview .empty button', { hasText: 'New booking' }).count()) === 1);
    ok('the calendar shows this month, with today marked', (await page.locator('.bk-day.today[aria-current="date"]').count()) === 1);
    const title = () => page.locator('.bk-cal-panel .cal-title').innerText();
    const t0 = await title();
    await page.click('[aria-label="Next month"]'); await sleep(150);
    const t1 = await title();
    await page.click('[aria-label="Previous month"]'); await sleep(150);
    ok('‹ and › move a month at a time', t1 !== t0 && (await title()) === t0, `${t0} → ${t1}`);
    // a swipe to the left is the next month; a tap after it opens nothing
    const grid = await page.locator('.bk-cal').boundingBox();
    await page.mouse.move(grid.x + grid.width - 30, grid.y + grid.height / 2); await page.mouse.down();
    await page.mouse.move(grid.x + 40, grid.y + grid.height / 2 + 6, { steps: 6 }); await page.mouse.up(); await sleep(300);
    ok('a swipe across the calendar moves to the next month, and does not open a day', (await title()) === t1 && (await page.locator('.bk-monthview').count()) === 1);
    await page.click('[aria-label="This month"]'); await sleep(150);
    ok('Today comes back to this month', (await title()) === t0);
    // arrow keys move between days and leave the Rolodex alone
    const todayCell = page.locator('.bk-day.today');
    const iso = await todayCell.getAttribute('data-date');
    await todayCell.focus(); await page.keyboard.press('ArrowRight'); await sleep(200);
    const next = await page.evaluate(() => document.activeElement && document.activeElement.dataset.date);
    const want = await page.evaluate(iso => import('./js/util.js').then(u => { const d = u.parseISO(iso); d.setDate(d.getDate() + 1); return u.ymd(d); }), iso);
    ok('→ on a day moves the focus to the next day (into the next month when needed), and the section stays', next === want && (await page.evaluate(() => window.logiPage())) === 'bookings', `${iso} → ${next}`);
    await page.locator('.bk-new').click();
    await sheetNamed(page, 'What are you booking?').waitFor();
    ok('+ New asks what kind of booking: show, studio session, rehearsal or other', (await page.locator('.bk-kind').count()) === 4 && /Studio session/.test(await page.locator('.bk-kinds').innerText()));
    await page.keyboard.press('Escape'); await sleep(200);
    ok('no errors in the console (empty diary)', errors.length === 0, errors.slice(0, 4).join(' | '));
    await browser.close();
  }

  /* ------------------------------ with the sample ------------------------------ */
  const { browser, page, errors } = await open({ sample: true });
  await page.waitForSelector('.bk-monthview .bk-agenda');
  const D = await dayFromNow(page, 12), D1 = await dayFromNow(page, 13), D7 = await dayFromNow(page, 19);
  ok('Coming up lists the sample’s next bookings, soonest first', (await page.locator('.bk-agenda .bk-card').first().innerText()).includes('Echo Chamber') && (await page.locator('.bk-agenda .bk-card', { hasText: 'Lantern Rooms' }).count()) === 1);
  ok('a card in Coming up gives the kind, the first time and the status', /Load-in 17:00/.test(await page.locator('.bk-agenda .bk-card', { hasText: 'Lantern Rooms' }).innerText()) && /Confirmed/.test(await page.locator('.bk-agenda .bk-card', { hasText: 'Lantern Rooms' }).innerText()));

  // filters
  await page.locator('.bk-filters .chip', { hasText: 'Sessions' }).click(); await sleep(250);
  let ids = await page.locator('.bk-agenda .bk-card').evaluateAll(els => els.map(e => e.dataset.id));
  let kinds = await page.evaluate(ids => import('./js/store.js').then(s => ids.map(id => s.byId('bookings', id).kind)), ids);
  ok('the Sessions chip leaves only studio sessions in Coming up', ids.length >= 1 && kinds.every(k => k === 'session'), kinds.join(','));
  ok('…and the chip keeps the focus, pressed', await page.evaluate(() => { const a = document.activeElement; return !!a && /Sessions/.test(a.textContent) && a.getAttribute('aria-pressed') === 'true'; }));
  await page.locator('.bk-filters .chip', { hasText: 'All kinds' }).click(); await sleep(150);
  await page.locator('.bk-filters .chip', { hasText: 'Sable' }).click(); await sleep(250);
  ids = await page.locator('.bk-agenda .bk-card').evaluateAll(els => els.map(e => e.dataset.id));
  const acts = await page.evaluate(ids => import('./js/store.js').then(s => ids.map(id => s.byId('bookings', id).actId)), ids);
  ok('an act chip leaves only that act’s bookings', ids.length >= 1 && acts.every(a => a === 's-sablea'), acts.join(','));
  await page.locator('.bk-filters .chip', { hasText: 'All acts' }).click(); await sleep(150);

  /* ---- a new show through the form ---- */
  await page.locator('.bk-new').click();
  await page.locator('.bk-kind[data-kind="show"]').click();
  const form = sheetNamed(page, 'New show');
  await form.waitFor();
  ok('the show form asks for the act, venue, the times of the day, set length, curfew and the contact', await form.evaluate(f => ['loadIn', 'soundcheck', 'doors', 'setTime', 'setLength', 'curfew', 'venueName', 'contactName', 'contactEmail'].every(k => f.querySelector(`[data-key="${k}"]`)) && !!f.querySelector('select[id$="-actId"]') && !!f.querySelector('select[id$="-venueId"]')));
  await form.locator('select[id$="-actId"]').selectOption('s-owls');
  await form.locator('[data-key="date"]').fill(D);
  ok('“Not in my venues” shows boxes for the venue’s name and address', await form.locator('[data-key="venueName"]').isVisible() && await form.locator('[data-key="address"]').isVisible());
  await form.locator('select[id$="-venueId"]').selectOption('s-harbour'); await sleep(100);
  ok('picking a saved venue hides them and shows its address', !(await form.locator('[data-key="venueName"]').isVisible()) && /Pier Road/.test(await form.locator('.bk-venue-note').innerText()));
  await form.locator('select[id$="-venueId"]').selectOption(''); await sleep(100);
  await form.locator('[data-key="venueName"]').fill('The Moth Club');
  await form.locator('[data-key="address"]').fill('Valette Street, Hackney\nLondon');
  await form.locator('[data-key="loadIn"]').fill('18:00');
  await form.locator('[data-key="doors"]').fill('19:30');
  await form.locator('[data-key="setTime"]').fill('23:30');
  await form.locator('[data-key="setLength"]').fill('60');
  await form.locator('[data-key="curfew"]').fill('00:30');
  await form.locator('[data-key="contactName"]').fill('Rosa Lind');
  await form.locator('button[type="submit"]').click();
  await page.waitForSelector('.bk-page .bk-hero');
  let show = await byVenueName(page, 'The Moth Club');
  ok('the show is stored with its kind, act, date, typed venue, times and set length as a number', show && show.kind === 'show' && show.actId === 's-owls' && show.date === D && show.address === 'Valette Street, Hackney\nLondon' && show.setTime === '23:30' && show.setLength === 60 && show.curfew === '00:30' && show.status === 'hold', JSON.stringify(show || {}).slice(0, 200));
  ok('the act’s members join the empty line-up', show && JSON.stringify(show.people) === JSON.stringify(['s-maya', 's-leo', 's-priya', 's-jonah']));
  ok('a contact picked from People brings their phone, email and role', show && show.contact.email === 'rosa@example.com' && show.contact.phone === '+1 555 0170' && show.contact.role === 'Promoter');
  const SID = show.id;
  ok('the new show opens on its own page, titled “Act @ Venue”', (await page.locator('.bk-title').innerText()).includes('The Night Owls @ The Moth Club'));
  const times = await page.locator('.bk-time').allInnerTexts();
  ok('the times run in order, off stage is worked out, and times after midnight are marked +1', times.some(t => /OFF STAGE\s*00:30\s*\+1/i.test(t)) && times.some(t => /CURFEW\s*00:30\s*\+1/i.test(t)) && times.some(t => /ON STAGE\s*23:30/i.test(t) && /60 min set/.test(t)) && !times.some(t => /LOAD-IN[\s\S]*\+1/i.test(t)), times.join(' | ').replace(/\n/g, ' '));
  ok('the contact has call, text and email buttons', (await page.locator('.bk-contact a[href^="tel:"]').count()) === 1 && (await page.locator('.bk-contact a[href^="sms:"]').count()) === 1 && (await page.locator('.bk-contact a[href="mailto:rosa@example.com"]').count()) === 1);
  ok('the typed venue has map buttons', (await page.locator('.bk-venue a', { hasText: 'Directions' }).count()) === 1);
  const showBlocks = await page.evaluate(() => import('./js/blocks/index.js').then(m => m.blocksFor('show').map(b => 'blk-' + b.id)));
  const onPage = await page.locator('.bk-blocks > details.blk').evaluateAll(els => els.map(e => e.id));
  ok('every box for a show is listed in order, closed', JSON.stringify(showBlocks) === JSON.stringify(onPage) && (await page.locator('.bk-blocks > details.blk[open]').count()) === 0, onPage.join(','));
  await page.locator('#blk-advance > summary').click(); await sleep(200);
  ok('tapping a box opens it and draws its body', (await page.locator('#blk-advance .blk-body .checklist').count()) === 1);

  // calendar, Coming up and the day
  await page.locator('.bk-page .back-btn').click(); await page.waitForSelector('.bk-dayview');
  ok('back goes to the day, which lists the show', (await page.locator('.bk-daylist .bk-card', { hasText: 'Moth Club' }).count()) === 1);
  await page.locator('.bk-dayview .back-btn').click(); await page.waitForSelector('.bk-monthview');
  ok('the calendar shows the show on its day', /The Night Owls @ The Moth Club \(Hold\)/.test(await page.locator(`.bk-day[data-date="${D}"]`).getAttribute('aria-label')) && (await page.locator(`.bk-day[data-date="${D}"] .bk-dot.st-hold`).count()) === 1);
  ok('…and Coming up lists it', (await page.locator('.bk-agenda .bk-card', { hasText: 'Moth Club' }).count()) === 1);
  await page.locator('.bk-agenda .bk-card', { hasText: 'Moth Club' }).click(); await page.waitForSelector('.bk-page');
  ok('a box opened before is still open when the booking is opened again', (await page.locator('#blk-advance[open] .checklist').count()) === 1);

  /* ---- status ---- */
  await page.locator('.bk-status').click();
  await sheetNamed(page, 'Booking status').waitFor();
  ok('the status picker offers the show statuses with the current one marked', (await page.locator('.bk-status-opt').count()) === 7 && (await page.locator('.bk-status-opt[aria-checked="true"]').getAttribute('data-status')) === 'hold');
  await page.locator('.bk-status-opt[data-status="confirmed"]').click(); await sleep(300);
  ok('picking a status stores it and the pill changes', (await rec(page, SID)).status === 'confirmed' && /Confirmed/.test(await page.locator('.bk-status').innerText()));
  ok('…and the focus is back on the status button', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('bk-status')));
  await page.locator('.bk-status').click(); await page.locator('.bk-status-opt[data-status="advanced"]').click(); await sleep(300);
  show = await rec(page, SID);
  ok('marking the show Advanced ticks “Show advanced with the promoter”', show.status === 'advanced' && show.checks['show-advance'] === true);
  ok('open boxes stay open through the redraw', (await page.locator('#blk-advance[open]').count()) === 1);

  /* ---- advance checklist ---- */
  ok('the advance box sums up as “1 of 14”', /1 of 14/.test(await page.locator('#blk-advance > summary').innerText()));
  await page.locator('#blk-advance label.check', { hasText: 'Contract or confirmation in writing' }).locator('input').check(); await sleep(250);
  ok('ticking a line stores it on the booking and moves the count on', (await rec(page, SID)).checks['show-contract'] === true && /2 of 14/.test(await page.locator('#blk-advance > summary').innerText()));
  ok('the focus stays on the line after the redraw', await page.evaluate(() => { const a = document.activeElement; return !!a && a.type === 'checkbox' && /Contract or confirmation/.test(a.closest('label').textContent); }));
  await page.locator('#blk-advance label.check', { hasText: 'Contract or confirmation in writing' }).locator('input').uncheck(); await sleep(250);
  ok('unticking takes it off', !(await rec(page, SID)).checks['show-contract']);
  await page.fill('#bk-adv-new', 'Merch float ready');
  await page.locator('#blk-advance .bk-adv-add button', { hasText: 'Add' }).click(); await sleep(300);
  let tpl = await page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.templates))));
  const own = (tpl.show || [])[0];
  ok('an own line is stored in the show template with an id, and the template is stamped', own && own.t === 'Merch float ready' && own.id && tpl.updatedAt > 0 && (await page.locator('#blk-advance label.check', { hasText: 'Merch float ready' }).count()) === 1 && /1 of 15/.test(await page.locator('#blk-advance > summary').innerText()));
  ok('…and it is on every show’s checklist', await page.evaluate(() => import('./js/model.js').then(m => m.checklistFor('show').some(l => l.t === 'Merch float ready' && l.own))) && !(await page.evaluate(() => import('./js/model.js').then(m => m.checklistFor('session').some(l => l.t === 'Merch float ready')))));
  await page.locator('#blk-advance label.check', { hasText: 'Merch float ready' }).locator('input').check(); await sleep(250);
  ok('an own line ticks like any other', (await rec(page, SID)).checks[own.id] === true);
  await page.locator(`#blk-advance [aria-label="Rename “Merch float ready”"]`).click();
  await sheetNamed(page, 'Rename checklist line').waitFor();
  await page.fill('.sheet [data-key="t"]', 'Merch float and card reader');
  await page.locator('.sheet button[type="submit"]').click(); await sleep(300);
  tpl = await page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.templates))));
  ok('an own line can be renamed, keeping its id and its tick', tpl.show.length === 1 && tpl.show[0].id === own.id && tpl.show[0].t === 'Merch float and card reader' && (await rec(page, SID)).checks[own.id] === true);
  await page.locator(`#blk-advance [aria-label="Remove “Merch float and card reader”"]`).click(); await sleep(300); // the confirm is accepted
  tpl = await page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.templates))));
  ok('removing an own line (after a confirm) takes it and its ticks away', tpl.show.length === 0 && !(await rec(page, SID)).checks[own.id] && (await page.locator('#blk-advance label.check', { hasText: 'Merch float' }).count()) === 0);
  const mail = await page.locator('#blk-advance a.bk-mail').getAttribute('href');
  const mailBody = decodeURIComponent((mail.split('&body=')[1] || ''));
  ok('Email the promoter writes to the contact with the advance subject', mail.startsWith('mailto:rosa@example.com?subject=') && /Advance: The Night Owls @ The Moth Club/.test(decodeURIComponent(mail.split('&body=')[0])), mail.slice(0, 90));
  ok('the advance email gives what is known (date, act, venue, times, set length)', /Act: The Night Owls/.test(mailBody) && /Venue: The Moth Club, Valette Street, Hackney, London/.test(mailBody) && /Load-in: 18:00/.test(mailBody) && /On stage: 23:30 for 60 minutes \(off stage 00:30\)/.test(mailBody) && /Curfew: 00:30/.test(mailBody) && /Hi Rosa,/.test(mailBody));
  ok('…and asks about everything still blank', ['soundcheck', 'parking', 'PA and backline', 'hospitality or a buyout', 'guest list allowance', 'Merch: who sells', 'cash or transfer', 'Wi-Fi'].every(q => mailBody.includes(q)) && !/What time is load-in/.test(mailBody) && !/What is the curfew/.test(mailBody), mailBody.replace(/\r?\n/g, ' / ').slice(0, 300));

  /* ---- line-up & gear ---- */
  await page.locator('#blk-lineup > summary').click(); await sleep(200);
  ok('the line-up lists the four members, with call and text', (await page.locator('#blk-lineup .bk-person').count()) === 4 && (await page.locator('#blk-lineup a[aria-label="Call Leo Grant"]').count()) === 1 && (await page.locator('#blk-lineup a[aria-label="Text Leo Grant"]').count()) === 1);
  ok('its summary counts people and items', /4 people · 0 items/.test(await page.locator('#blk-lineup > summary').innerText()));
  await page.locator('#blk-lineup [aria-label="Take Leo Grant off this booking"]').click(); await sleep(250);
  ok('✕ takes someone off the booking', !(await rec(page, SID)).people.includes('s-leo') && (await page.locator('#blk-lineup .bk-person').count()) === 3);
  await page.locator('#blk-lineup button', { hasText: 'Add the act’s members (1)' }).click(); await sleep(250);
  ok('“Add the act’s members” brings back whoever is missing', (await rec(page, SID)).people.includes('s-leo') && (await page.locator('#blk-lineup button', { hasText: 'Add the act’s members' }).count()) === 0);
  await page.locator('#blk-lineup button', { hasText: 'Pick people' }).click();
  await sheetNamed(page, 'Who is on this booking').waitFor();
  ok('Pick people groups People by band, session players, crew and contacts', /Band members[\s\S]*Session players[\s\S]*Crew[\s\S]*Industry contacts/.test(await page.locator('.sheet .checks').innerText()));
  await page.locator('.sheet label.check', { hasText: 'Dee Okafor' }).locator('input').check();
  await page.locator('.sheet button[type="submit"]').click(); await sleep(300);
  ok('ticking someone in the picker puts them on the booking', (await rec(page, SID)).people.includes('s-dee') && (await page.locator('#blk-lineup .bk-person').count()) === 5);
  await page.locator('#blk-lineup button', { hasText: 'Pick gear' }).click();
  await sheetNamed(page, 'Backline for this booking').waitFor();
  await page.locator('.sheet label.check', { hasText: 'Telecaster' }).locator('input').check();
  await page.locator('.sheet [aria-label="One more SM58"]').click(); await page.locator('.sheet [aria-label="One more SM58"]').click();
  await page.locator('.sheet button[type="submit"]').click(); await sleep(300);
  show = await rec(page, SID);
  ok('gear is picked with quantities (three SM58s)', show.gear.includes('s-tele') && show.gear.includes('s-sm58') && show.gearQty['s-sm58'] === 3 && /SM58\s*×3/.test(await page.locator('#blk-lineup .bk-gear').innerText()), JSON.stringify(show.gearQty));
  await page.locator('#blk-lineup button', { hasText: 'Add a stage pack' }).click();
  await sheetNamed(page, 'Add a stage pack').waitFor();
  await page.locator('.sheet .card.tap', { hasText: 'Club show pack' }).click(); await sleep(300);
  show = await rec(page, SID);
  ok('a stage pack adds its gear and quantities without lowering one already set', ['s-pbass', 's-hotrod', 's-nord', 's-di'].every(id => show.gear.includes(id)) && show.gearQty['s-di'] === 3 && show.gearQty['s-sm58'] === 3 && show.kits.includes('s-clubpack'), JSON.stringify(show.gearQty));
  ok('the summary now says 5 people · 10 items, with no clash yet', /5 people · 10 items/.test(await page.locator('#blk-lineup > summary').innerText()) && (await page.locator('#blk-lineup .warn').count()) === 0);

  /* ---- notes ---- */
  await page.locator('#blk-notes > summary').click(); await sleep(150);
  await page.fill('#bk-notes-text', 'Bring the spare snare\nAsk about the rider');
  ok('typing does not save on every key', !(await rec(page, SID)).notes);
  await page.locator('#bk-notes-text').press('Tab'); await sleep(300);
  ok('leaving the box saves the notes', (await rec(page, SID)).notes === 'Bring the spare snare\nAsk about the rider');
  ok('the notes box sums up with its first line', /Bring the spare snare/.test(await page.locator('#blk-notes > summary').innerText()) && !/rider/.test(await page.locator('#blk-notes > summary').innerText()));

  /* ---- the calendar file ---- */
  await page.evaluate(id => import('./js/store.js').then(s => s.patch('bookings', id, { deal: { type: 'guarantee', fee: 777, deposit: 123 } })), SID); await sleep(200);
  const one = await download(page, () => page.locator('.bk-actions button', { hasText: 'Add to calendar' }).click());
  const lines1 = one.text.split('\r\n');
  ok('Add to calendar downloads an .ics file with CRLF line ends', /\.ics$/.test(one.name) && one.text.endsWith('\r\n') && !/[^\r]\n/.test(one.text) && one.text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0'), one.name);
  const u1 = unfold(one.text);
  ok('it starts at load-in and ends at the curfew after midnight, the next day, in local time', u1.includes(`DTSTART:${compact(D)}T180000\r\n`) && u1.includes(`DTEND:${compact(D1)}T003000\r\n`), (u1.match(/DT(START|END)[^\r]*/g) || []).join(' '));
  ok('the location is the venue and its address on one line, commas escaped', u1.includes('LOCATION:The Moth Club\\, Valette Street\\, Hackney\\, London\r\n'));
  ok('the description carries the run of the day and the act, and no money', /DESCRIPTION:Show · Advanced\\nAct: The Night Owls\\n\\nLoad-in 18:00\\nDoors 19:30\\nOn stage 23:30 \(60 min set\)\\nOff stage 00:30\\nCurfew 00:30/.test(u1) && !/777|fee|Guarantee|deposit/i.test(u1.replace(/^(UID|DTSTAMP):[^\r]*\r\n/gm, '')));
  ok('an advanced show is CONFIRMED and has a stable UID', u1.includes('STATUS:CONFIRMED') && u1.includes(`UID:${SID}@gigdex.crowmade.app`));
  ok('no line is longer than 75 octets', lines1.every(l => Buffer.byteLength(l, 'utf8') <= 75), String(Math.max(...lines1.map(l => Buffer.byteLength(l, 'utf8')))));
  const unit = await page.evaluate(() => import('./js/ics.js').then(m => {
    const a = m.bookingIcs({ id: 'u1', kind: 'other', status: 'hold', title: 'Back\\slash; semi, comma\nnew line', date: '2026-12-01', endDate: '2026-12-02' });
    const long = 'Ünïcödé “quotes” and 🎸 guitars — '.repeat(6);
    const b = m.bookingIcs({ id: 'u2', kind: 'session', status: 'cancelled', title: long, date: '2026-12-03', start: '22:00', end: '02:00' });
    return { a, b, long, esc: m.icsEscape(long) };
  }));
  ok('escaping: backslash, semicolon, comma and line breaks', unit.a.includes('SUMMARY:Back\\\\slash\\; semi\\, comma\\nnew line\r\n'), unit.a.match(/SUMMARY[^\r]*/)[0]);
  ok('a booking with no times is all day over its days (end date exclusive) and a hold is TENTATIVE', unit.a.includes('DTSTART;VALUE=DATE:20261201\r\n') && unit.a.includes('DTEND;VALUE=DATE:20261203\r\n') && unit.a.includes('STATUS:TENTATIVE'));
  const bl = unit.b.split('\r\n');
  ok('long lines fold at 75 octets without splitting a character, and unfold back to the same text', bl.every(l => Buffer.byteLength(l, 'utf8') <= 75) && !unit.b.includes('�') && unfold(unit.b).includes('SUMMARY:' + unit.esc + '\r\n'));
  ok('a studio session past midnight ends the next day; a cancelled one is CANCELLED', unit.b.includes('DTSTART:20261203T220000') && unit.b.includes('DTEND:20261204T020000') && unit.b.includes('STATUS:CANCELLED'));

  /* ---- duplicate, and clashes ---- */
  await page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.id === id); x.settlement = { tickets: 100, received: 500 }; x.quote = { n: 'Q1' }; x.invoice = { n: 'I1' }; x.guestList = [{ id: 'g1', name: 'Ivy', plus: 1, in: true }]; x.deal.depositPaid = true; x.checks = { ...x.checks, 'show-deposit': true }; x.updatedAt = Date.now(); })), SID); await sleep(200);
  await page.locator('.bk-actions button', { hasText: 'Duplicate' }).click();
  await sheetNamed(page, 'Duplicate booking').waitFor();
  ok('Duplicate asks for the new date (a week on to start with)', (await page.inputValue('#bk-dup-date')) === D7);
  await page.fill('#bk-dup-date', D);
  await page.locator('.sheet button[type="submit"]').click();
  await page.waitForSelector('.bk-page .bk-hero'); await sleep(500);
  const copies = await page.evaluate(n => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.bookings.filter(b => b.venueName === n)))), 'The Moth Club');
  const copy = copies.find(b => b.id !== SID);
  ok('the copy is a new booking on the new date, on hold', copies.length === 2 && copy && copy.date === D && copy.status === 'hold' && copy.actId === 's-owls' && copy.setTime === '23:30');
  ok('the copy has no settlement, quote, invoice or ticks, nobody marked in and the deposit not paid', copy && !copy.settlement && !copy.quote && !copy.invoice && Object.keys(copy.checks || {}).length === 0 && copy.guestList[0].in === false && copy.guestList[0].name === 'Ivy' && copy.deal.depositPaid === false && copy.deal.fee === 777);
  ok('the copy keeps the people and gear', copy && copy.people.length === 5 && copy.gearQty['s-sm58'] === 3);
  ok('the copy opens on its page', (await page.locator('.bk-hero').count()) === 1 && /Hold/.test(await page.locator('.bk-status').innerText()));
  await page.locator('#blk-lineup > summary').click(); await sleep(200);
  const lineupText = await page.locator('#blk-lineup').innerText();
  ok('a clash: someone on two bookings on the same day is named', lineupText.includes('Leo is also on The Moth Club that day'), lineupText.slice(0, 200).replace(/\n/g, ' | '));
  ok('a clash: more SM58s needed than owned', lineupText.includes('6 needed, 4 owned: also on The Moth Club that day'));
  ok('the line-up summary warns of the clashes', /⚠ 11 clashes/.test(await page.locator('#blk-lineup > summary').innerText()));
  ok('many clashes are summed up at the top, each row naming its own', /5 people and 6 items are also needed elsewhere/.test(await page.locator('#blk-lineup .bk-clashes').innerText()) && (await page.locator('#blk-lineup .bk-person.clash').count()) === 5);
  await page.evaluate(id => import('./js/store.js').then(s => s.patch('bookings', id, { people: ['s-leo'], gear: [], gearQty: {}, kits: [] })), copy.id); await sleep(300);
  ok('a single clash is said in full at the top', (await page.locator('#blk-lineup .bk-clashes').innerText()).trim() === '⚠ Leo is also on The Moth Club that day');
  // openBooking from another section
  await page.evaluate(() => window.logiGo('venues')); await sleep(400);
  const opened = await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), SID);
  ok('openBooking(id) goes to Bookings and shows that booking, resolving once drawn', opened === true && (await page.evaluate(() => window.logiPage())) === 'bookings' && (await page.locator('.bk-hero').count()) === 1 && /Advanced/.test(await page.locator('.bk-status').innerText()));
  ok('…the original shows the clash too', /Leo is also on The Moth Club that day/.test(await page.locator('#blk-lineup').innerText()));
  ok('openBooking of a booking that is gone resolves false', (await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('nope')))) === false);

  /* ---- delete: from the page, and by press and hold ---- */
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), copy.id); await sleep(300);
  await page.locator('.bk-actions .bk-delete').click();
  await sheetNamed(page, 'Delete this booking?').waitFor();
  ok('Delete asks first and says what goes with it', /cannot be undone/.test(await page.locator('.sheet').innerText()) && (await page.locator('.sheet button', { hasText: 'Keep it' }).count()) === 1);
  await page.locator('.sheet button', { hasText: 'Delete booking' }).click(); await sleep(400);
  ok('Delete booking removes it and lands on its day', !(await rec(page, copy.id)) && (await page.locator('.bk-dayview').count()) === 1 && (await page.locator('.bk-daylist .bk-card', { hasText: 'Moth Club' }).count()) === 1);
  await page.locator('.bk-dayview .back-btn').click(); await page.waitForSelector('.bk-monthview');
  const card = page.locator('.bk-agenda .bk-card', { hasText: 'Moth Club' });
  await press(page, card, 700); await page.mouse.up(); await sleep(400);
  ok('a short press is a tap: it opens the booking, with no sheet', (await page.locator('.bk-page').count()) === 1 && (await page.locator('.sheet').count()) === 0);
  await page.locator('.bk-page .back-btn').click(); await page.locator('.bk-dayview .back-btn').click(); await page.waitForSelector('.bk-monthview');
  await press(page, page.locator('.bk-agenda .bk-card', { hasText: 'Moth Club' }), 3300);
  await sheetNamed(page, 'Delete this booking?').waitFor({ timeout: 4000 }); await page.mouse.up(); await sleep(300);
  ok('press and hold for three seconds offers to delete, and letting go does not open it', (await page.locator('.bk-page').count()) === 0 && /The Moth Club/.test(await page.locator('.sheet').innerText()));
  await page.locator('.sheet button', { hasText: 'Delete booking' }).click(); await sleep(400);
  ok('…and Delete booking deletes it', !(await rec(page, SID)) && (await page.locator('.bk-agenda .bk-card', { hasText: 'Moth Club' }).count()) === 0 && (await page.locator('.toast', { hasText: 'Booking deleted' }).count()) >= 1);

  /* ---- export the calendar ---- */
  const all = await download(page, () => page.locator('.bk-export').click());
  const upcomingCount = await page.evaluate(() => import('./js/store.js').then(s => s.upcoming().length));
  ok('Export calendar saves every upcoming booking in one file', (all.text.match(/BEGIN:VEVENT/g) || []).length === upcomingCount && upcomingCount >= 4 && /X-WR-CALNAME:Gigdex/.test(all.text), `${(all.text.match(/BEGIN:VEVENT/g) || []).length} of ${upcomingCount}`);
  ok('…with no deals or fees in it', !/Guarantee|\$|fee/i.test(unfold(all.text)));
  const F0 = compact(await dayFromNow(page, 40)), F1 = compact(await dayFromNow(page, 41));
  const fest = (unfold(all.text).split('BEGIN:VEVENT').find(e => e.includes('Greenfield Festival')) || '');
  ok('…and a two-day festival hold runs from its set time on the first day to its last day, tentative', fest.includes(`DTSTART:${F0}T163000`) && fest.includes(`DTEND:${F1}T170000`) && fest.includes('STATUS:TENTATIVE'), fest.replace(/\r\n/g, ' ').slice(0, 160));

  /* ---- a day: + New on this day, a rehearsal at a saved room ---- */
  if (!(await page.locator(`.bk-day[data-date="${D1}"]`).count())) { await page.click('[aria-label="Next month"]'); await sleep(200); }
  await page.locator(`.bk-day[data-date="${D1}"]`).click();
  await page.waitForSelector('.bk-dayview');
  ok('a day with nothing on it says so and offers to add one', /Nothing booked on this day/.test(await page.locator('.bk-dayview .empty').innerText()));
  await page.locator('.bk-new-day').click();
  await page.locator('.bk-kind[data-kind="rehearsal"]').click();
  const rform = sheetNamed(page, 'New rehearsal'); await rform.waitFor();
  ok('“+ New on this day” fills in the date', (await rform.locator('[data-key="date"]').inputValue()) === D1);
  ok('a rehearsal asks for the act, room and times, and no deal or contact', !(await rform.locator('[data-key="contactName"]').count()) && !(await rform.locator('[data-key="setLength"]').count()) && (await rform.locator('[data-key="start"]').count()) === 1);
  await rform.locator('select[id$="-actId"]').selectOption('s-owls');
  await rform.locator('select[id$="-venueId"]').selectOption('s-basement');
  await rform.locator('[data-key="start"]').fill('19:00');
  await rform.locator('[data-key="end"]').fill('22:00');
  await rform.locator('button[type="submit"]').click();
  await page.waitForSelector('.bk-page .bk-hero'); await sleep(200);
  const reh = await page.evaluate(d => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.bookings.find(b => b.kind === 'rehearsal' && b.date === d)))), D1);
  ok('a rehearsal at a saved room keeps the room’s id and not a copy of its address', reh && reh.venueId === 's-basement' && !reh.address && !reh.venueName && reh.status === 'confirmed' && reh.people.length === 4);
  ok('its page shows the room, the times and how long', /Basement Rehearsal Rooms/.test(await page.locator('.bk-hero').innerText()) && /LENGTH\s*3h 00m/i.test(await page.locator('.bk-times').innerText()));
  ok('a rehearsal has its own boxes (no deal)', (await page.locator('#blk-deal').count()) === 0 && (await page.locator('#blk-advance').count()) === 1 && (await page.locator('#blk-lineup').count()) === 1);
  // deleted elsewhere while open
  await page.evaluate(id => import('./js/store.js').then(s => s.remove('bookings', id)), reh.id); await sleep(300);
  ok('a booking deleted elsewhere while open falls back to its day', (await page.locator('.bk-dayview').count()) === 1 && (await page.locator('.bk-page').count()) === 0);

  /* ---- a session for a client not in Acts; newBooking with a preset ---- */
  await page.evaluate(d => import('./js/pages/bookings.js').then(m => m.newBooking({ kind: 'session', date: d })), D);
  const sform = sheetNamed(page, 'New studio session'); await sform.waitFor();
  ok('newBooking({ kind }) opens that form straight away', (await sform.locator('[data-key="date"]').inputValue()) === D);
  ok('with no act chosen, a session asks for the artist or client', await sform.locator('[data-key="client"]').isVisible());
  await sform.locator('select[id$="-actId"]').selectOption('s-sablea'); await sleep(80);
  ok('choosing an act hides that box', !(await sform.locator('[data-key="client"]').isVisible()));
  await sform.locator('select[id$="-actId"]').selectOption(''); await sleep(80);
  await sform.locator('[data-key="client"]').fill('Juno');
  await sform.locator('select[id$="-venueId"]').selectOption('s-echo');
  await sform.locator('[data-key="start"]').fill('10:00');
  await sform.locator('[data-key="end"]').fill('18:00');
  await sform.locator('[data-key="rate"]').fill('52.5');
  await sform.locator('select[id$="-rateUnit"]').selectOption('day');
  await sform.locator('button[type="submit"]').click();
  await page.waitForSelector('.bk-page .bk-hero'); await sleep(200);
  const ses = await page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.bookings.find(b => b.client === 'Juno')))));
  ok('the session is stored with its client, studio, rate (a decimal) and unit, and nobody added', ses && ses.kind === 'session' && !ses.actId && ses.venueId === 's-echo' && ses.rate === 52.5 && ses.rateUnit === 'day' && ses.people.length === 0 && ses.status === 'hold');
  ok('its page is titled with the client and studio, and shows the client', (await page.locator('.bk-title').innerText()).includes('Juno @ Echo Chamber Studios') && /Juno/.test(await page.locator('.bk-act-row').innerText()));
  await page.locator('#blk-advance > summary').click(); await sleep(150);
  ok('the session gets the studio email in its checklist box', (await page.locator('#blk-advance a.bk-mail', { hasText: 'Email the studio' }).count()) === 1);
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.newBooking({ kind: 'show', actId: 's-owls', venueId: 's-lantern', date: '2027-01-15' })));
  const pform = sheetNamed(page, 'New show'); await pform.waitFor();
  ok('newBooking prefills the act, the venue (with its contact) and the date', (await pform.locator('select[id$="-actId"]').inputValue()) === 's-owls' && (await pform.locator('select[id$="-venueId"]').inputValue()) === 's-lantern' && (await pform.locator('[data-key="contactName"]').inputValue()) === 'Rosa Lind' && (await pform.locator('[data-key="date"]').inputValue()) === '2027-01-15');
  await pform.locator('button', { hasText: 'Cancel' }).click(); await sleep(200);

  /* ---- something else: no act, no saved venue ---- */
  await page.evaluate(d => import('./js/pages/bookings.js').then(m => m.newBooking({ kind: 'other', date: d })), D);
  const oform = sheetNamed(page, 'New diary entry'); await oform.waitFor();
  await oform.locator('[data-key="title"]').fill('Radio session, BBC 6 Music');
  await oform.locator('[data-key="fee"]').fill('0');
  await oform.locator('button[type="submit"]').click();
  await page.waitForSelector('.bk-page .bk-hero'); await sleep(200);
  ok('a diary entry with no act, venue or times still has a page', (await page.locator('.bk-title').innerText()).includes('Radio session, BBC 6 Music') && (await page.locator('.bk-act-row').count()) === 0 && /No times yet/.test(await page.locator('.bk-hero').innerText()));
  ok('its boxes are the ones for every kind (line-up and notes)', (await page.locator('#blk-lineup').count()) === 1 && (await page.locator('#blk-notes').count()) === 1 && (await page.locator('#blk-advance').count()) === 0);
  // a box that fails shows a line instead of breaking the page
  await page.evaluate(() => import('./js/blocks/index.js').then(m => { const n = m.BLOCKS.find(x => x.id === 'notes'); n._render = n.render; n.render = () => { throw new Error('boom'); }; }));
  await page.locator('#blk-notes > summary').click(); await sleep(200);
  ok('a box whose drawing fails shows a small error line and the page carries on', /could not be shown \(boom\)/.test(await page.locator('#blk-notes .blk-body').innerText()) && (await page.locator('.bk-hero').count()) === 1);
  await page.evaluate(() => import('./js/blocks/index.js').then(m => { const n = m.BLOCKS.find(x => x.id === 'notes'); n.render = n._render; delete n._render; }));

  /* ---- the walkthrough ---- */
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('s-show1'))); await sleep(300);
  await page.locator('#blk-advance > summary').click(); await sleep(150);
  const steps = await page.evaluate(() => window.gigdexPages().find(p => p.id === 'bookings').page.tutorial().map(s => s.title));
  ok('the booking page’s walkthrough includes the open boxes’ steps', steps.includes('Status') && steps.includes('Checklist') && steps.includes('Your own lines') && !steps.includes('Notes'), steps.join(', '));
  await page.click('#helpBtn'); await page.waitForSelector('.tour-card'); await sleep(400);
  ok('the ? button runs it', /The booking/.test(await page.locator('.tour-card').innerText()));
  await page.keyboard.press('Escape'); await sleep(200);

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL bookings crashed — ' + (e.stack || e.message).split('\n').slice(0, 3).join(' ')); process.exit(1); });

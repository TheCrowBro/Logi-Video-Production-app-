// People: the empty page, the sample's cards, adding someone through the form (group, rate unit, act), filtering by
// group and act, search, a person's sheet (upcoming bookings, past, gear, clashes, a booking past midnight), their
// contact card as a QR code and a .vcf file, "Ask if they're free" (no money in it, add to the line-up), editing,
// deleting with the cascade, a person deleted elsewhere while their sheet is open, and the tutorials.
const fs = require('fs');
const { open, ok: say, sleep, go } = require('../helpers.cjs');
const ok = (name, cond, extra = '') => say(name, cond, String(extra).replace(/\s*\n\s*/g, ' / ')); // one line per result
// Runs fn(store module, arg) in the page and returns its result (a source string, evaluated by the browser's devtools,
// so the page's CSP, which forbids eval, is not involved).
const store = (page, fn, arg) => page.evaluate(`import('./js/store.js').then(s => (${fn.toString()})(s, ${JSON.stringify(arg ?? null)}))`);
const names = async page => (await page.locator('.pp-card .pp-name').allTextContents()).map(s => s.trim()).sort();
const sheetFor = (page, title) => page.locator(`.sheet[aria-label="${title}"]`);

(async () => {
  const { browser, page, errors } = await open({ tab: 'people' });
  const dialogs = [];
  page.on('dialog', d => dialogs.push(d.message())); // helpers.cjs accepts them

  /* ---------- empty ---------- */
  await page.waitForSelector('.pp-page');
  ok('an empty People page explains what goes here', await page.locator('.pp-page .empty').isVisible());
  ok('the empty page offers to add a person', await page.locator('#pp-empty-add').isVisible());

  /* ---------- the sample ---------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.waitForSelector('.pp-card');
  ok('the sample shows ten people', (await page.locator('.pp-card').count()) === 10, String(await page.locator('.pp-card').count()));
  const heads = (await page.locator('.pp-groupsec > h3').allTextContents()).join(' | ');
  ok('people are grouped under headings', /Band members/.test(heads) && /Session players/.test(heads) && /Crew/.test(heads) && /Industry contacts/.test(heads), heads);
  const maya = page.locator('.pp-card[data-id="s-maya"]');
  ok('a card shows the role and instruments', (await maya.locator('.pp-sub').innerText()).includes('Vocals, rhythm guitar'));
  ok('a card shows the acts they are in as chips', (await maya.locator('.pp-act').allTextContents()).map(s => s.trim()).join() === 'The Night Owls');
  ok('a card shows their next booking', /Next:/.test(await maya.locator('.pp-next').innerText()));
  const hrefs = await maya.locator('.pp-quick a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  ok('a card has Call, Text and Email', hrefs.join() === 'tel:+15550141,sms:+15550141,mailto:maya@example.com', hrefs.join());
  ok('a session player’s card shows their usual rate', (await page.locator('.pp-card[data-id="s-marcus"] .pp-sub').innerText()).includes('$180 per day'));
  ok('a person with no phone has only Email', (await page.locator('.pp-card[data-id="s-sable"] .pp-quick a').count()) === 1);

  /* ---------- add a person ---------- */
  await page.click('#pp-add');
  const form = sheetFor(page, 'Add a person');
  await form.waitFor();
  await form.locator('[data-key=name]').fill('Nina Park');
  await form.locator('select[id$="-group"]').selectOption('session');
  await form.locator('[data-key=role]').fill('Session musician');
  await form.locator('[data-key=instrument]').fill('Trumpet, flugelhorn');
  await form.locator('[data-key=company]').fill('Brass Section Ltd');
  await form.locator('[data-key=phone]').fill('+1 555 0199');
  await form.locator('[data-key=email]').fill('nina@example.com');
  await form.locator('[data-key=rate]').fill('220');
  await form.locator('select[id$="-rateUnit"]').selectOption('show');
  await form.locator('label.check', { hasText: 'The Night Owls' }).locator('input').check();
  await form.locator('button[type=submit]').click();
  await page.waitForSelector('.pp-card .pp-name:text-is("Nina Park")');
  const nina = await store(page, s => { const p = s.db.people.find(x => x.name === 'Nina Park'); return p && { ...p, inOwls: s.byId('acts', 's-owls').members.includes(p.id) }; });
  ok('the new person is stored', !!nina);
  ok('with the group chosen', nina && nina.group === 'session', nina && nina.group);
  ok('with the rate as a number and its unit', nina && nina.rate === 220 && nina.rateUnit === 'show', nina && `${nina.rate} ${nina.rateUnit}`);
  ok('with the role, instruments and company', nina && nina.role === 'Session musician' && nina.instrument === 'Trumpet, flugelhorn' && nina.company === 'Brass Section Ltd');
  ok('and added to the act ticked', nina && nina.inOwls);
  ok('no form-only field is stored on the person', nina && !('acts' in nina));
  ok('their card shows the rate per show', (await page.locator(`.pp-card[data-id="${nina.id}"] .pp-sub`).innerText()).includes('$220 per show'));

  /* ---------- filter by group ---------- */
  await page.click('#pp-g-session');
  ok('the Session chip shows only session players', JSON.stringify(await names(page)) === JSON.stringify(['Marcus Bell', 'Nina Park']), (await names(page)).join());
  ok('the chip says it is on', (await page.getAttribute('#pp-g-session', 'aria-pressed')) === 'true');
  ok('the chip keeps the focus after the redraw', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pp-g-session'));
  await page.click('#pp-g-crew');
  ok('the Crew chip shows the crew', JSON.stringify(await names(page)) === JSON.stringify(['Dee Okafor', 'Tom Hale']), (await names(page)).join());
  await page.click('#pp-g-contact');
  ok('the Contacts chip shows industry contacts', JSON.stringify(await names(page)) === JSON.stringify(['Ivy Chen', 'Rosa Lind']), (await names(page)).join());
  await page.click('#pp-g-all');
  ok('Everyone shows everyone again', (await page.locator('.pp-card').count()) === 11);

  /* ---------- filter by act ---------- */
  await page.click('#pp-a-s-owls');
  ok('an act chip shows the people in that act', JSON.stringify(await names(page)) === JSON.stringify(['Jonah Reyes', 'Leo Grant', 'Maya Brooks', 'Nina Park', 'Priya Shah']), (await names(page)).join());
  await page.click('#pp-g-band');
  ok('act and group together narrow it further', JSON.stringify(await names(page)) === JSON.stringify(['Jonah Reyes', 'Leo Grant', 'Maya Brooks', 'Priya Shah']), (await names(page)).join());
  await page.click('#pp-a-s-sablea');
  ok('another act shows its own people', JSON.stringify(await names(page)) === JSON.stringify(['Sable']), (await names(page)).join());
  await page.click('#pp-a-all'); await page.click('#pp-g-all');

  /* ---------- search ---------- */
  await page.fill('#pp-search', 'promoter');
  ok('search finds a role', JSON.stringify(await names(page)) === JSON.stringify(['Rosa Lind']), (await names(page)).join());
  ok('the search box keeps the focus while typing', await page.evaluate(() => document.activeElement && document.activeElement.id === 'pp-search'));
  await page.fill('#pp-search', 'northline');
  ok('search finds a company', JSON.stringify(await names(page)) === JSON.stringify(['Ivy Chen']), (await names(page)).join());
  await page.fill('#pp-search', 'night owls drums');
  ok('search matches an act name and a role together', JSON.stringify(await names(page)) === JSON.stringify(['Priya Shah']), (await names(page)).join());
  await page.fill('#pp-search', 'zzzz');
  ok('no match says so and offers to show everyone', (await page.locator('.pp-page .empty').innerText()).includes('No one matches') && await page.locator('#pp-clear').isVisible());
  await page.click('#pp-clear');
  ok('Show everyone clears the search', (await page.locator('.pp-card').count()) === 11 && (await page.inputValue('#pp-search')) === '');

  /* ---------- the person sheet ---------- */
  // A booking with no act and no venue, past midnight, on the same day as Maya's show: a clash.
  const showDay = await store(page, s => s.byId('bookings', 's-show1').date);
  await store(page, (s, d) => s.upsert('bookings', { id: 't-late', kind: 'rehearsal', status: 'confirmed', date: d, start: '22:00', end: '01:30', people: ['s-maya'] }), showDay);
  await page.click('#pp-open-s-maya');
  const sh = sheetFor(page, 'Maya Brooks');
  await sh.waitFor();
  const upIds = await sh.locator('.pp-upcoming .pp-bk').evaluateAll(els => els.map(e => e.dataset.id));
  ok('the sheet lists Maya’s upcoming bookings, soonest first', JSON.stringify(upIds) === JSON.stringify(['s-reh', 's-show1', 't-late', 's-show2']), upIds.join());
  ok('it does not list her past show there', !upIds.includes('s-past'));
  ok('the past show is under Past bookings', (await sh.locator('.pp-past .pp-bk[data-id="s-past"]').count()) === 1);
  ok('a booking shows its title', (await sh.locator('.pp-bk[data-id="s-show1"]').innerText()).includes('The Night Owls @ The Lantern Rooms'));
  ok('two bookings on one day are flagged as a clash', (await sh.locator('.pp-bk[data-id="s-show1"] .pp-clash').count()) === 1 && (await sh.locator('.pp-bk[data-id="t-late"] .pp-clash').count()) === 1);
  ok('a booking past midnight says so', (await sh.locator('.pp-bk[data-id="t-late"] .pp-bk-when').innerText()).includes('22:00–01:30 (past midnight)'));
  ok('a booking with no act or venue still reads', (await sh.locator('.pp-bk[data-id="t-late"] .pp-bk-title').innerText()).includes('Rehearsal'));
  ok('the sheet shows her act', (await sh.locator('.pp-acts-sec').innerText()).includes('The Night Owls'));
  ok('the sheet shows the gear she owns', (await sh.locator('.pp-gear').innerText()).includes('Telecaster'));
  ok('the sheet shows her notes', (await sh.locator('.pp-notes').innerText()).includes('Beta 58'));
  ok('the sheet says her rate is not set', /Usual rate\s*Not set/.test(await sh.locator('.pp-details').innerText()));

  /* ---------- share contact ---------- */
  await sh.locator('#pp-share').click();
  const share = sheetFor(page, 'Share contact');
  await share.waitFor();
  await page.waitForSelector('.sheet[aria-label="Share contact"] .pp-qr svg', { timeout: 20000 });
  ok('the contact card is drawn as a QR code', (await share.locator('.pp-qr svg').count()) === 1);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), share.locator('#pp-vcf').click()]);
  ok('the .vcf file is named after the person', dl.suggestedFilename() === 'Maya Brooks.vcf', dl.suggestedFilename());
  const vcf = fs.readFileSync(await dl.path(), 'utf8');
  ok('the file is a vCard', vcf.startsWith('BEGIN:VCARD') && vcf.trim().endsWith('END:VCARD'));
  ok('with her name, phone and email', ['N:Brooks;Maya;;;', 'FN:Maya Brooks', 'TEL;TYPE=CELL:+1 555 0141', 'EMAIL;TYPE=INTERNET:maya@example.com', 'TITLE:Vocals'].every(l => vcf.includes(l)), vcf.replace(/\r\n/g, ' / '));
  ok('and her act', vcf.includes('Acts: The Night Owls'));
  ok('but not your notes about her', !vcf.includes('Beta 58'));
  await page.keyboard.press('Escape'); await sleep(250);

  /* ---------- ask if they're free ---------- */
  await sh.locator('#pp-ask').click();
  const ask = sheetFor(page, 'Ask if they’re free');
  await ask.waitFor();
  ok('it starts on the first booking she is not on yet', (await page.inputValue('#pp-ask-booking')) === 's-sess1', await page.inputValue('#pp-ask-booking'));
  const noMoney = s => !/[$€£]|\b250\b|\b70\b|\bfee\b|\bdeal\b|guarantee|\brate\b/i.test(s);
  await page.selectOption('#pp-ask-booking', 's-show1');
  const sms = decodeURIComponent(await page.getAttribute('#pp-ask-sms', 'href'));
  const mail = decodeURIComponent(await page.getAttribute('#pp-ask-mail', 'href'));
  ok('the text goes to her phone', sms.startsWith('sms:+15550141?&body='), sms.slice(0, 40));
  ok('it says the act, the venue and the day', sms.includes('Are you free for The Night Owls at The Lantern Rooms on'), sms);
  ok('it gives the load-in and stage times', sms.includes('Load-in 17:00') && sms.includes('on stage 21:15'));
  ok('the text has no money in it', noMoney(sms), sms);
  ok('the email goes to her with the same message', mail.startsWith('mailto:maya@example.com?subject=') && mail.includes('Load-in 17:00'));
  ok('the email has no money in it', noMoney(mail), mail);
  ok('a clash on that day is pointed out', (await ask.locator('.pp-clash').isVisible()) && (await ask.locator('.pp-clash').innerText()).includes('Rehearsal'));
  await page.selectOption('#pp-ask-booking', 't-late');
  const lateMsg = await page.inputValue('#pp-ask-text');
  ok('a booking with no act or venue asks plainly', /Are you free for a rehearsal on .+\?/.test(lateMsg), lateMsg);
  ok('a booking past midnight says when it finishes', lateMsg.includes('From 22:00 to 01:30 (finishing after midnight)'), lateMsg);
  await page.fill('#pp-ask-text', 'Hi Maya, free that night?');
  ok('editing the message updates the text link', decodeURIComponent(await page.getAttribute('#pp-ask-sms', 'href')).endsWith('Hi Maya, free that night?'));
  await page.selectOption('#pp-ask-booking', 's-sess1');
  ok('the line-up button offers to add her', (await page.innerText('#pp-ask-add')).includes('Add Maya to the line-up'));
  await page.click('#pp-ask-add'); await sleep(250);
  ok('adding her puts her on the booking', await store(page, s => s.byId('bookings', 's-sess1').people.includes('s-maya')));
  ok('the button then says she is on it', (await page.innerText('#pp-ask-add')).includes('On the line-up') && await page.isDisabled('#pp-ask-add'));
  await page.keyboard.press('Escape'); await sleep(250);
  ok('her sheet now lists the session too', (await sh.locator('.pp-upcoming .pp-bk[data-id="s-sess1"]').count()) === 1);

  /* ---------- edit from the sheet ---------- */
  await sh.locator('#pp-edit').click();
  const ed = sheetFor(page, 'Edit person');
  await ed.waitFor();
  ok('the edit form has her details', (await ed.locator('[data-key=name]').inputValue()) === 'Maya Brooks' && (await ed.locator('select[id$="-group"]').inputValue()) === 'band');
  ok('and her act ticked', await ed.locator('label.check', { hasText: 'The Night Owls' }).locator('input').isChecked());
  await ed.locator('[data-key=rate]').fill('150');
  await ed.locator('select[id$="-rateUnit"]').selectOption('show');
  await ed.locator('button[type=submit]').click(); await sleep(300);
  ok('the change is stored', await store(page, s => { const p = s.byId('people', 's-maya'); return p.rate === 150 && p.rateUnit === 'show'; }));
  ok('the open sheet follows it', /Usual rate\s*\$150 per show/.test(await sh.locator('.pp-details').innerText()));
  ok('her act membership is left as it was', await store(page, s => s.byId('acts', 's-owls').members.includes('s-maya')));
  await page.keyboard.press('Escape'); await sleep(250);

  /* ---------- tap a booking ---------- */
  await page.click('#pp-open-s-maya'); await sh.waitFor();
  await sh.locator('.pp-bk[data-id="s-show1"]').click(); await sleep(700);
  ok('tapping a booking closes the sheet and opens Bookings', (await page.locator('.sheet').count()) === 0 && (await page.evaluate(() => window.logiPage())) === 'bookings');
  await go(page, 'people');

  /* ---------- delete from the sheet: the cascade ---------- */
  await page.click('#pp-open-s-leo');
  await sheetFor(page, 'Leo Grant').waitFor();
  dialogs.length = 0;
  await page.click('#pp-delete'); await sleep(300);
  ok('deleting warns how many bookings and acts include them', /4 bookings/.test(dialogs[0] || '') && /The Night Owls/.test(dialogs[0] || ''), dialogs[0]);
  ok('and that their gear stays', /1 backline item/.test(dialogs[0] || ''), dialogs[0]);
  const after = await store(page, s => ({ gone: !s.byId('people', 's-leo'), show: s.byId('bookings', 's-show1').people.includes('s-leo'), owls: s.byId('acts', 's-owls').members.includes('s-leo'), bass: s.byId('gear', 's-pbass').owner }));
  ok('the person is deleted', after.gone);
  ok('and taken off s-show1', !after.show);
  ok('and out of The Night Owls', !after.owls);
  ok('their bass stays, with no owner', after.bass === '', JSON.stringify(after.bass));
  ok('the sheet closes and the card is gone', (await page.locator('.sheet').count()) === 0 && (await page.locator('.pp-card[data-id="s-leo"]').count()) === 0);

  /* ---------- delete from the edit form ---------- */
  dialogs.length = 0;
  await page.click('[aria-label="Edit Nina Park"]');
  await sheetFor(page, 'Edit person').waitFor();
  await page.click('.sheet[aria-label="Edit person"] .form-actions .btn.danger'); await sleep(300);
  ok('the form asks, then says what else changes', dialogs.length === 2 && /permanently/.test(dialogs[0]) && /1 act \(The Night Owls\)/.test(dialogs[1]), dialogs.join(' || '));
  ok('the person is deleted and out of the act', await store(page, (s, id) => !s.byId('people', id) && !s.byId('acts', 's-owls').members.includes(id), nina.id));

  /* ---------- a contact, and a booking with no date ---------- */
  await store(page, s => s.upsert('bookings', { id: 't-nodate', kind: 'show', status: 'hold', people: ['s-priya'] }));
  await sleep(250);
  ok('a booking without a date does not break the page', (await page.locator('.pp-card[data-id="s-priya"]').count()) === 1);
  await page.click('#pp-open-s-rosa');
  const rosa = sheetFor(page, 'Rosa Lind');
  await rosa.waitFor();
  ok('a promoter’s sheet lists the shows they are the contact for', (await rosa.locator('.pp-contact-for .pp-bk[data-id="s-show1"]').count()) === 1);
  ok('and leaves out the empty act and line-up sections', (await rosa.locator('.pp-acts-sec').count()) === 0 && (await rosa.locator('.pp-upcoming').count()) === 0);
  ok('a contact is not asked if they are free', (await rosa.locator('#pp-ask').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(250);

  /* ---------- deleted elsewhere while open ---------- */
  await page.click('#pp-open-s-tom');
  await sheetFor(page, 'Tom Hale').waitFor();
  await store(page, s => s.remove('people', 's-tom')); await sleep(300);
  ok('a person deleted elsewhere closes their open sheet', (await page.locator('.sheet').count()) === 0);
  ok('openPerson of someone gone shows a note instead of an empty sheet', await page.evaluate(() => import('./js/pages/people.js').then(m => { m.openPerson('nobody'); return document.querySelectorAll('.sheet').length === 0; })));

  /* ---------- a name with accents ---------- */
  await store(page, s => s.upsert('people', { id: 't-zoe', name: 'Zoë Ångström', group: 'session', role: 'Cello', phone: '+44 7700 900123' }));
  await page.click('#pp-open-t-zoe');
  await sheetFor(page, 'Zoë Ångström').waitFor();
  await page.click('#pp-share');
  await page.waitForSelector('.sheet[aria-label="Share contact"] .pp-qr svg', { timeout: 20000 });
  ok('a name with accents still makes a QR code', (await page.locator('.sheet[aria-label="Share contact"] .pp-qr svg').count()) === 1);
  ok('a person with no email has no Email button in the sheet', (await page.locator('.sheet[aria-label="Zoë Ångström"] .pp-quick a[href^="mailto:"]').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('Escape'); await sleep(250);

  /* ---------- tutorials ---------- */
  await page.click('#helpBtn');
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  ok('the page tutorial starts on People', (await page.innerText('.tour-card h2')) === 'People');
  await page.keyboard.press('Escape'); await sleep(250);
  await page.click('#pp-open-s-maya'); await sh.waitFor();
  await sh.locator('.sheet-help').click();
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  ok('the person sheet has its own tutorial', (await page.innerText('.tour-card h2')) === 'Get in touch');
  await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Escape'); await sleep(250);

  /* ---------- export ---------- */
  await page.click('#pp-g-band');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#pp-export')]);
  const many = fs.readFileSync(await dl2.path(), 'utf8');
  ok('the filtered people save as one contacts file', (many.match(/BEGIN:VCARD/g) || []).length === 4 && dl2.suggestedFilename() === 'Gigdex contacts - Band members.vcf', dl2.suggestedFilename());
  ok('with every band member in it', ['FN:Maya Brooks', 'FN:Priya Shah', 'FN:Jonah Reyes', 'FN:Sable'].every(l => many.includes(l)));
  await page.click('#pp-g-all');

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL people crashed — ' + e.message); process.exit(1); });

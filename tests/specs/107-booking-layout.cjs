// The booking page laid out anew: tools, hours and the day's weather at the top in outlined boxes; the workflow,
// budget, quote and invoice folded into one box with a summary line; Check all and the archive question; people
// (stakeholders, crew, hired people) in one section with rentals under Equipment; long lists folding after five;
// edit days in their own colour on the calendar, in the feed and on the clock bar; the shot-list import filling the
// stripboard; the back button; the share button named for the calendar.
const { chromium } = require('playwright');
const { acceptTerms, chooseRole } = require('../helpers.cjs');
const fs = require('fs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: ['x'], weather_code: [80], temperature_2m_max: [14], temperature_2m_min: [9], precipitation_probability_max: [60], wind_speed_10m_max: [24], wind_gusts_10m_max: [45] } }) }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  const dialogs = []; let answer = 'accept'; page.on('dialog', d => { dialogs.push(d.message()); if (answer === 'accept') d.accept(); else d.dismiss(); });
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  // Sample data; the Harbour shoot in three days, the recce out of today's way, a legacy rental stored under hires
  const seed = await page.evaluate(d3 => import('./js/store.js').then(s => {
    s.loadSample();
    const b = s.db.bookings.find(x => /Harbour/.test(x.title)), c = s.db.bookings.find(x => /Corporate interviews/.test(x.title)), r = s.db.bookings.find(x => /recce/.test(x.title));
    s.update(D => { const x = D.bookings.find(z => z.id === b.id); x.date = d3; delete x.endDate; x.hires = [{ id: 'h1', item: 'Prism lens', from: 'Camera Co', cost: 150 }]; x.updatedAt = Date.now(); const rr = D.bookings.find(z => z.id === r.id); rr.date = '2026-01-05'; rr.updatedAt = Date.now(); });
    return { id: b.id, title: b.title, other: c.id, otherTitle: c.title };
  }), iso(3));
  // Back up to the month (whatever page is open), then into the booking from Next up or its day
  const openBooking = async (title) => {
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    for (let i = 0; i < 3 && !(await page.locator('.bk-month').count()); i++) { await page.locator('#page .page-head .back-btn').first().click(); await sleep(300); }
    const hit = await page.evaluate(t => { const c = [...document.querySelectorAll('.card.tap')].find(x => x.textContent.includes(t)); if (c) c.click(); return !!c; }, title);
    if (!hit) throw new Error('booking not listed: ' + title);
    await page.waitForSelector('.bk-detail'); await sleep(300);
  };
  await openBooking(seed.title);

  // ---- the layout ----
  const order = await page.evaluate(() => [...document.querySelector('.bk-detail').children].map(e => e.id || e.className.split(' ').slice(0, 2).join('.')));
  ok('order: header, summary, the three tool boxes, Hours, templates, weather, the folded workflow box, then venue and people', order.slice(0, 9).join(' > ') === 'page-head > card.hero > actions.bk-tools > bk-hours > actions.bk-tools-more > card.wx-card > bk-work > bk-venue > bk-people', order.join(' > '));
  const tools = await page.locator('.bk-tools > .btn').allInnerTexts();
  ok('the tools are Call sheet, Stripboard & shot list and Share with crew, in outlined boxes', tools.length === 3 && /Call sheet/.test(tools[0]) && /Stripboard & shot list/.test(tools[1]) && /Share with crew/.test(tools[2]) && (await page.locator('.bk-tools > .btn').first().evaluate(e => getComputedStyle(e).borderTopWidth)) === '2px', tools.join(' | '));
  ok('the Hours box and the weather card share that darker outlined style', (await page.locator('#bk-hours .card.box-dark').count()) === 1 && (await page.locator('.wx-card.box-dark').count()) === 1);
  await page.waitForFunction(() => /chance of rain/.test(document.querySelector('.bk-detail .wx-card')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const wx = await page.locator('.bk-detail .wx-card').innerText();
  ok('the weather card: a big symbol, the sky, the range, rain, wind and the sun times', (await page.locator('.wx-card .wx-ico').innerText()) !== '🌤' && /Showers/.test(wx) && /9–14°C/.test(wx) && /60% chance of rain/.test(wx) && /Rise .* Set .* Golden hour/.test(wx), wx.replace(/\n/g, ' | '));
  const share = page.locator('.bk-detail .hero button', { hasText: 'Share calendar event' });
  ok('the share button says it shares the calendar event, not the project', (await share.count()) === 1 && /calendar file/.test(await share.getAttribute('title')));
  const back = page.locator('.bk-detail .page-head .back-btn');
  ok('the back button is the ringed return mark with the day it goes to', (await back.count()) === 1 && (await back.locator('.back-arrow').count()) === 1 && /^‹ \w{3}, (\d+ \w{3}|\w{3} \d+)$/.test((await back.textContent()).trim()) && await back.evaluate(e => e.classList.contains('shine') && getComputedStyle(e, '::after').animationName === 'back-shine'), await back.textContent());

  // ---- the folded box ----
  const fold = page.locator('#bk-work');
  ok('the workflow box starts closed with a summary line: budget, quote, invoice and the stage', !(await fold.evaluate(d => d.open)) && /Budget none yet · No quote · No invoice · Prepped \d+\/\d+/.test(await page.locator('#bk-work > summary').innerText()), await page.locator('#bk-work > summary').innerText());
  await page.locator('#bk-work > summary').click(); await sleep(250);
  ok('open, it holds the stages, the checklist, the budget and the money', await page.locator('#bk-work .stage-strip').isVisible() && await page.locator('#bk-work .checklist').first().isVisible() && await page.locator('#bk-budget').isVisible() && await page.locator('#bk-money').isVisible());
  ok('its stage strip scrolls inside the box rather than widening the page', (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#bk-work .twirl-body').getBoundingClientRect().width <= innerWidth)));
  const cur = page.locator('#bk-work .card > .checklist').first();
  const allBox = cur.locator('.check-all input');
  ok('each stage has a Check all box; half done shows as indeterminate', (await allBox.count()) === 1 && await allBox.evaluate(e => e.indeterminate) && !(await allBox.isChecked()));
  await allBox.click(); await sleep(400);
  ok('Check all ticks the whole stage in one go, the box stays open, the summary follows', /Prepped 10\/10/.test(await page.locator('#bk-work > summary').innerText()) && await page.locator('#bk-work').evaluate(d => d.open) && (await page.locator('#bk-work .card > .checklist').first().locator('.check-item.done').count()) === 10, await page.locator('#bk-work > summary').innerText());
  await page.locator('#bk-work .card > .checklist').first().locator('.check-all input').click(); await sleep(400);
  ok('…and unticks it again', /Prepped 0\/10/.test(await page.locator('#bk-work > summary').innerText()) && (await page.locator('#bk-work .card > .checklist').first().locator('.check-all span').innerText()) === 'Check all');
  ok('no archive question while other stages are open', dialogs.length === 0);
  // Everything but one item of the current stage done: the last tick asks, and yes archives the project
  await page.evaluate(id => import('./js/workflow.js').then(w => import('./js/store.js').then(s => { const b = s.byId('bookings', id); const ids = w.STAGES.flatMap(([st]) => w.itemsFor(b, st).map(i => i.id)), keep = w.itemsFor(b, b.status)[0].id; w.setChecks(b, ids.filter(i => i !== keep), true); w.setCheck(b, keep, false); })), seed.id); await sleep(400);
  const last = page.locator('#bk-work .checklist .check-item:not(.done):not(.check-all) input');
  ok('one item left in the whole project', (await last.count()) === 1);
  answer = 'accept'; await last.first().click(); await sleep(600);
  ok('ticking the last item asks "Mark this project archived?" and yes archives it', dialogs.length === 1 && /Mark this project archived\?/.test(dialogs[0]) && (await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).status), seed.id)) === 'Archived' && /Archived/.test(await page.locator('.bk-detail .hero .pill').innerText()), dialogs.join(' | '));
  // On another project, no means no: it is not asked again, and unticking later never un-archives anything
  await page.evaluate(id => import('./js/workflow.js').then(w => import('./js/store.js').then(s => { const b = s.byId('bookings', id); const ids = w.STAGES.flatMap(([st]) => w.itemsFor(b, st).map(i => i.id)), keep = w.itemsFor(b, b.status)[0].id; w.setChecks(b, ids.filter(i => i !== keep), true); w.setCheck(b, keep, false); })), seed.other);
  await openBooking(seed.otherTitle); await page.locator('#bk-work > summary').click(); await sleep(250);
  answer = 'dismiss'; await page.locator('#bk-work .checklist .check-item:not(.done):not(.check-all) input').first().click(); await sleep(600);
  const after = await page.evaluate(id => import('./js/store.js').then(s => ({ status: s.byId('bookings', id).status, asked: !!s.byId('bookings', id).archiveAsked })), seed.other);
  ok('no leaves the project where it is and remembers the answer', dialogs.length === 2 && after.status === 'Quoted' && after.asked, JSON.stringify(after));
  await page.locator('#bk-work .checklist .check-item.done:not(.check-all) input').first().click(); await sleep(300);
  await page.locator('#bk-work .checklist .check-item:not(.done):not(.check-all) input').first().click(); await sleep(600);
  ok('…so unticking and ticking again does not ask twice', dialogs.length === 2 && (await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).status), seed.other)) === 'Quoted');
  await page.evaluate(id => import('./js/workflow.js').then(w => import('./js/store.js').then(s => w.setStage(s.byId('bookings', id), 'Confirmed'))), seed.other); await sleep(300);
  ok('moving the project to another stage forgets the no, so the question can come again', !(await page.evaluate(id => import('./js/store.js').then(s => !!s.byId('bookings', id).archiveAsked), seed.other)));
  await openBooking(seed.title); await page.locator('#bk-work').evaluate(d => { d.open = true; }); await sleep(250);
  await page.locator('#bk-work .checklist .check-item.done:not(.check-all) input').first().click(); await sleep(400);
  ok('unticking an item on the archived project never un-archives it, and asks nothing', dialogs.length === 2 && (await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).status), seed.id)) === 'Archived');
  await page.locator('#bk-work .checklist .check-item:not(.done):not(.check-all) input').first().click(); await sleep(400);
  ok('…nor does ticking it again ask twice', dialogs.length === 2);

  // ---- people: stakeholders, crew, hired people; rentals under Equipment; the legacy copy sorted out ----
  await openBooking(seed.title);
  const people = page.locator('#bk-people');
  ok('one People section: stakeholders, crew and hires', (await people.locator('#bk-stakeholders h4').innerText()) === 'Stakeholders (2)' && (await people.locator('#bk-crew h4').innerText()) === 'Crew (2)' && (await people.locator('#bk-hires h4').innerText()) === 'Hires (0)');
  ok('the rental an older copy kept under hires is shown as rented equipment, with the one already under rentals', (await page.locator('#bk-kit #bk-rentals h4').innerText()) === 'Rented (2)' && /Prism lens/.test(await page.locator('#bk-rentals').innerText()) && /Easyrig/.test(await page.locator('#bk-rentals').innerText()), await page.locator('#bk-kit #bk-rentals h4').innerText());
  await page.locator('#bk-hires button', { hasText: 'Hire someone' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="name"]').fill('Dana Fox'); await chooseRole(page, 'Gaffer'); await page.locator('.sheet form input[data-key="rate"]').fill('400'); await page.locator('.sheet form select').selectOption('day');
  await page.locator('.sheet form input[data-key="days"]').fill('2'); await page.locator('.sheet form input[data-key="phone"]').fill('+1 555 0150'); await page.locator('.sheet form input[data-key="email"]').fill('dana@example.com');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  const stored = await page.evaluate(id => import('./js/store.js').then(s => { const b = s.byId('bookings', id); return { hires: b.hires, rentals: b.rentals }; }), seed.id);
  ok('hiring someone saves a person under hires and moves the old rental under rentals', stored.hires.length === 1 && stored.hires[0].name === 'Dana Fox' && stored.hires[0].days === 2 && stored.rentals.length === 2 && stored.rentals.some(r => r.item === 'Prism lens' && r.id === 'h1'), JSON.stringify(stored));
  const hireRow = page.locator('#bk-hires .crew-line');
  ok('the hired person gets the crew row: status, call time, ask by text or email, and Edit', (await hireRow.count()) === 1 && /Dana Fox/.test(await hireRow.innerText()) && /Gaffer · \$400\/day · 2 days/.test(await hireRow.innerText()) && (await hireRow.locator('select').count()) === 1 && (await hireRow.locator('input[type=time]').count()) === 1 && (await hireRow.getByRole('button', { name: 'Edit' }).count()) === 1, await hireRow.innerText());
  await page.locator('#bk-work').evaluate(d => { d.open = true; }); await sleep(200);
  await page.locator('#bk-budget button:has-text("Fill from booking")').click(); await sleep(400);
  const lines = await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).budget.lines.map(l => [l.cat, l.desc, l.qty, l.rate, l.src])), seed.id);
  ok('Fill from booking costs the hired person as crew and the rental as equipment hire', lines.some(l => l[0] === 'Crew' && /Dana Fox \(Gaffer\) — hired/.test(l[1]) && l[2] === 2 && l[3] === 400 && /^person:/.test(l[4])) && lines.some(l => l[0] === 'Equipment hire' && /Prism lens/.test(l[1]) && l[3] === 150 && l[4] === 'hire:h1'), JSON.stringify(lines));
  await page.locator('.bk-tools > .btn').first().click(); await page.waitForSelector('.cs-page');
  const csText = await page.locator('.cs-doc').innerText(), emailBtn = await page.locator('.cs-page a', { hasText: 'Email crew' }).innerText();
  ok('the call sheet lists the hired person with the crew and emails them too', /Dana Fox/.test(csText) && /Gaffer/.test(csText) && /Email crew \(3\)/.test(emailBtn), emailBtn);
  ok('the call sheet page comes back with the ringed back button', (await page.locator('.cs-page .page-head .back-btn').count()) === 1);
  await page.getByRole('button', { name: '‹ Booking' }).click(); await sleep(300);
  const snap = await page.evaluate(id => import('./js/store.js').then(s => import('./js/crew-link.js').then(m => m.crewSnapshot(s.byId('bookings', id)))), seed.id);
  const dana = (snap.crew || []).find(c => c.name === 'Dana Fox');
  ok('the crew link carries the hired person with name, role, phone, email and call, and no rate or days', !!dana && dana.role === 'Gaffer' && dana.phone && dana.email && 'call' in dana && !('rate' in dana) && !('days' in dana) && !/400/.test(JSON.stringify(snap)), JSON.stringify(dana));
  const norm = await page.evaluate(() => import('./js/store.js').then(s => { const raw = { bookings: [{ id: 'old', title: 'Old copy', date: '2026-01-01', hires: [{ id: 'g1', item: 'Dolly', from: 'Grip Co', cost: 90 }, { id: 'p9', name: 'Kim', role: 'Runner' }], rentals: [{ id: 'g0', item: 'Van' }] }] }; const b = s.migrateBooking(raw.bookings[0]); return { hires: b.hires.map(x => x.id), rentals: b.rentals.map(x => x.id), twice: JSON.stringify(s.migrateBooking(b)) === JSON.stringify(b) }; }));
  ok('an older copy is sorted on load: gear under hires moves to rentals, people stay, and running it again changes nothing', norm.hires.join() === 'p9' && norm.rentals.join() === 'g0,g1' && norm.twice, JSON.stringify(norm));

  // ---- long lists fold after five ----
  await page.evaluate(id => import('./js/store.js').then(s => { const extra = ['Ana Leigh', 'Ben Oyelaran', 'Cy Marsh', 'Dee Park', 'Eli Stone'].map(name => ({ id: 'x-' + name.split(' ')[0].toLowerCase(), name, role: 'Runner', phone: '', email: '', rate: '', notes: '', updatedAt: Date.now() })); s.update(D => { D.crew.push(...extra); const b = D.bookings.find(x => x.id === id); b.crew = [...b.crew, ...extra.map(c => c.id)]; b.updatedAt = Date.now(); }); }), seed.id); await sleep(400);
  const crewBox = page.locator('#bk-crew');
  ok('seven crew show five and "Show all (7)"', (await crewBox.locator('.crew-line').count()) === 5 && (await crewBox.locator('.fold-more button').innerText()) === 'Show all (7)' && (await crewBox.locator('h4').innerText()) === 'Crew (7)');
  await crewBox.locator('.fold-more button').click(); await sleep(300);
  ok('Show all shows them all, with Show fewer, and the Equipment list folds the same way', (await page.locator('#bk-crew .crew-line').count()) === 7 && (await page.locator('#bk-crew .fold-more button').innerText()) === 'Show fewer' && (await page.locator('#bk-kit .gear-line').count()) === 5 && (await page.locator('#bk-kit .fold-more button').innerText()) === 'Show all (6)');
  await page.evaluate(id => import('./js/store.js').then(s => s.update(D => { const b = D.bookings.find(x => x.id === id); b.notes = 'touched'; b.updatedAt = Date.now(); })), seed.id); await sleep(400);
  ok('the choice survives the redraw a change causes', (await page.locator('#bk-crew .crew-line').count()) === 7);
  await page.locator('#bk-crew .fold-more button').click(); await sleep(300);
  ok('Show fewer folds the list back to five', (await page.locator('#bk-crew .crew-line').count()) === 5 && (await page.locator('#bk-crew .fold-more button').innerText()) === 'Show all (7)');

  // ---- edit days ----
  await page.locator('.bk-detail .page-head button', { hasText: 'Edit' }).click(); await page.waitForSelector('.sheet form');
  const ed = page.locator('.sheet form .field:has(label:has-text("Edit days"))');
  ok('the booking form has an Edit days table', (await ed.count()) === 1);
  await ed.getByRole('button', { name: '+ Add' }).click(); await ed.getByRole('button', { name: '+ Add' }).click();
  await ed.locator('.row-edit').nth(0).locator('input[type=date]').fill(iso(8)); await ed.locator('.row-edit').nth(0).locator('input[type=time]').nth(0).fill('10:00'); await ed.locator('.row-edit').nth(0).locator('input[type=time]').nth(1).fill('16:00');
  await ed.locator('.row-edit').nth(1).locator('input[type=date]').fill(iso(0));
  await page.locator('.sheet form button[type=submit]').click(); await sleep(500);
  const saved = await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).editDays), seed.id);
  ok('edit days are saved in date order with the times given', saved && saved.length === 2 && saved[0].date === iso(0) && !saved[0].start && saved[1].date === iso(8) && saved[1].start === '10:00' && saved[1].end === '16:00', JSON.stringify(saved));
  ok('the booking shows its edit days in the edit colour', /✂ Edit days:/.test(await page.locator('.bk-detail .edit-days').innerText()) && (await page.locator('.bk-detail .edit-days').evaluate(e => getComputedStyle(e).color)) === (await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--edit)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })));
  const cal = await page.evaluate(id => import('./js/store.js').then(s => import('./js/calendar.js').then(c => { const b = s.byId('bookings', id); const ev = c.editEvents([b]); const ics = c.icsFor([b], ev, b.title); return { n: ev.length, ids: ev.map(e => e.id), allDay: ev.map(e => e.allDay), events: (ics.match(/BEGIN:VEVENT/g) || []).length, title: ev[1] && ev[1].title, feed: /Edit: Harbour/.test(c.feedIcs()), summary: c.summaryText(b) }; })), seed.id);
  ok('each edit day is a calendar event of its own: in the booking’s file, the feed and the email text', cal.n === 2 && cal.ids.every(i => i.startsWith('edit:')) && cal.allDay[0] === true && cal.allDay[1] === false && cal.events === 3 && /^Edit: Harbour/.test(cal.title) && cal.feed && /Edit days: /.test(cal.summary), JSON.stringify(cal));
  await page.locator('.bk-detail .page-head .back-btn').click(); await sleep(300);
  await page.getByRole('button', { name: '‹ Calendar' }).click(); await sleep(300);
  await page.evaluate(() => { document.querySelector('.cal-nav .btn')?.click(); }); await sleep(200);
  const today = await page.evaluate(() => { const d = new Date(); const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); const el = [...document.querySelectorAll('.cal .day')].find(x => x.getAttribute('aria-label')?.startsWith(label)); return el ? { cls: el.className, label: el.getAttribute('aria-label'), dots: [...el.querySelectorAll('.dots i')].map(i => i.className), mini: [...el.querySelectorAll('.mini')].map(m => m.className + ':' + m.textContent) } : null; });
  ok('on the calendar an edit day is marked in the edit colour, and says so', !!today && /edit-day/.test(today.cls) && /edit day/.test(today.label) && (today.dots.some(c => /\bedit\b/.test(c)) || today.mini.some(c => /\bedit\b/.test(c))), JSON.stringify(today));
  await page.evaluate(() => { const d = new Date(); const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); [...document.querySelectorAll('.cal .day')].find(x => x.getAttribute('aria-label')?.startsWith(label))?.click(); }); await sleep(300);
  const dayCard = page.locator('#page .card.tap', { hasText: 'Harbour' });
  ok('the day lists the booking as an edit day', (await dayCard.count()) === 1 && (await dayCard.locator('.pill.edit').innerText()) === 'Edit day' && /✂ Edit day/.test(await dayCard.innerText()));
  ok('no strip under the Rolodex while the clock is not running', await page.locator('#clockbar').evaluate(e => e.hidden));
  await dayCard.click(); await page.waitForSelector('.bk-detail'); await sleep(200);
  const clock = page.locator('#bk-hours .card-clock');
  ok('the booking’s Hours box holds the clock and knows it is an edit day', (await clock.count()) === 1 && /✂ Edit day/.test(await clock.innerText()) && (await clock.getByRole('button', { name: 'Start edit session' }).count()) === 1, await clock.innerText());
  await clock.getByRole('button', { name: 'Start edit session' }).click(); await sleep(400);
  const live = await page.evaluate(() => import('./js/hours.js').then(hh => { const r = hh.running(); return r && { kind: hh.kindOf(r), bookingId: r.bookingId }; }));
  ok('Start work on an edit day logs the hours as editing on that project', live && live.kind === 'edit' && live.bookingId === seed.id, JSON.stringify(live));
  const strip = page.locator('#clockbar .clock.strip');
  ok('while it runs, the strip under the Rolodex shows the booking, the time and Stop work', await strip.isVisible() && /Harbour/.test(await strip.innerText()) && /Working/.test(await strip.innerText()) && (await strip.getByRole('button', { name: 'Stop work' }).count()) === 1 && /Working/.test(await clock.innerText()), await strip.innerText());
  await strip.getByRole('button', { name: 'Stop work' }).click(); await sleep(400);
  ok('Stop work from the strip stops it everywhere and the strip goes away', await page.locator('#clockbar').evaluate(e => e.hidden) && (await clock.getByRole('button', { name: 'Start edit session' }).count()) === 1);
  const todayShort = await page.evaluate(() => import('./js/util.js').then(u => u.fmtShort(u.todayISO())));
  ok('back from the booking goes to the day it was opened from (today), and the hours say the session was editing', (await page.locator('.bk-detail .page-head .back-btn').textContent()).trim() === '‹ ' + todayShort && /all editing/.test(await page.locator('#bk-hours').innerText()), await page.locator('#bk-hours').innerText().then(t => t.replace(/\n/g, ' | ').slice(0, 120)));

  // ---- the shot list import fills the stripboard ----
  await page.locator('#bk-shots button', { hasText: 'Import shot list' }).click(); await page.waitForSelector('.sheet textarea[aria-label="Pasted shot list"]');
  await page.locator('.sheet textarea[aria-label="Pasted shot list"]').fill('Drone: harbour at golden hour\n\nINT. TAPROOM - MORNING\nWide: steam over the mash tun\n2. CU: Ana pouring\n\nScene 12 - EXT. LOADING BAY - DUSK\n- Tracking shot along the quay\n');
  await page.locator('.sheet button', { hasText: 'Add these shots' }).click(); await sleep(500);
  const imp = await page.evaluate(id => import('./js/store.js').then(s => { const b = s.byId('bookings', id); return { shots: b.shots.map(x => [x.text, x.scene || '']), scenes: b.board.list.filter(x => x.type === 'scene').map(x => [x.scene, x.ie, x.set, x.tod, x.eighths]), review: b.shotImportReview && b.shotImportReview.scenes }; }), seed.id);
  ok('the shots are added under their scenes, list marks dropped, the one before any heading unsorted', imp.shots.some(x => x[0] === 'Wide: steam over the mash tun' && x[1] === '1') && imp.shots.some(x => x[0] === 'CU: Ana pouring' && x[1] === '1') && imp.shots.some(x => x[0] === 'Tracking shot along the quay' && x[1] === '12') && imp.shots.some(x => x[0] === 'Drone: harbour at golden hour' && x[1] === ''), JSON.stringify(imp.shots));
  ok('the headings became strips on the board, marked for a check', imp.scenes.length === 2 && imp.scenes[0].join('|') === '1|INT|TAPROOM|MORNING|1' && imp.scenes[1].join('|') === '12|EXT|LOADING BAY|DUSK|1' && imp.review === 2, JSON.stringify(imp.scenes));
  const shotsBox = await page.locator('#bk-shots').innerText();
  ok('the section groups the shots by scene, with Unsorted, and asks for the check', /Scene 1 · TAPROOM/.test(shotsBox) && /Scene 12 · LOADING BAY/.test(shotsBox) && /Unsorted/.test(shotsBox) && /2 scenes came from the shot list/.test(shotsBox) && /2 scenes · .* · 1 shooting day · 2 not scheduled yet/.test(shotsBox), shotsBox.replace(/\n/g, ' | ').slice(0, 300));
  // a heading with no number names a scene the board already has: its shots join that scene, no duplicate strip
  const again = await page.evaluate(id => import('./js/stripboard.js').then(m => import('./js/store.js').then(s => { const r = m.applyShotImport(s.byId('bookings', id), m.parseShotList('INT. TAPROOM - MORNING\nMCU: the brewer tastes')); const b = s.byId('bookings', id); return { added: r, scenes: b.board.list.filter(x => x.type === 'scene').length, shot: (b.shots.find(x => x.text === 'MCU: the brewer tastes') || {}).scene }; })), seed.id);
  ok('a later import with the same heading, unnumbered, joins the scene on the board instead of duplicating it', again.added.scenes === 0 && again.added.shots === 1 && again.scenes === 2 && again.shot === '1', JSON.stringify(again));
  // a spreadsheet export is read by its columns: the header row is not a shot, the scene column groups, size goes in front
  const csv = await page.evaluate(() => import('./js/stripboard.js').then(m => m.parseShotList('Scene,Shot,Size,Description\n12,1,WS,"Dolly past the pallets, slow"\n12,2,CU,Hands on the forklift\n,,,A pick-up with no scene\n')));
  ok('a CSV shot list is read by its columns', csv.scenes.length === 1 && csv.scenes[0].num === '12' && csv.scenes[0].shots.join('|') === 'WS: Dolly past the pallets, slow|CU: Hands on the forklift' && csv.loose.join('|') === 'A pick-up with no scene', JSON.stringify(csv));
  ok('a plain list with commas in it is still one shot per line', (await page.evaluate(() => import('./js/stripboard.js').then(m => m.parseShotList('Wide shot, kitchen\nClose up, hands\n4K - the quay from the drone')))).loose.join('|') === 'Wide shot, kitchen|Close up, hands|4K - the quay from the drone');
  await page.locator('.bk-tools .sb-open').click(); await page.waitForSelector('.sb-page .sb-board'); await sleep(300);
  ok('the stripboard page shows the new strips, the warning and the shot list under the board', (await page.locator('.sb-strip').count()) === 2 && (await page.locator('.sb-page .review-note').count()) === 1 && (await page.locator('#sb-shots .check-item').count()) === 8 && (await page.locator('.sb-page h1').innerText()) === 'Stripboard & shot list'); // 7 shots plus the one the second import added
  await page.locator('.sb-page .review-note button', { hasText: 'Checked' }).click(); await sleep(300);
  ok('Checked clears the warning', (await page.locator('.sb-page .review-note').count()) === 0 && !(await page.evaluate(id => import('./js/store.js').then(s => !!s.byId('bookings', id).shotImportReview), seed.id)));

  // ---- repairs after 1.4.0: the calendar ----
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await sleep(300);
  // The calendar file: an overnight shoot ends the next morning; semicolons are escaped; lines are folded by bytes, on whole characters
  const icsFix = await page.evaluate(() => import('./js/calendar.js').then(c => {
    const night = { id: 'n1', title: 'Night shoot', date: '2026-12-10', start: '22:00', end: '04:00', status: 'Confirmed' };
    const ev = c.eventOf(night), bare = c.eventOf({ ...night, end: '' }), ed = c.editEvents([{ id: 'n2', title: 'Edit', date: '2026-12-10', status: 'Confirmed', editDays: [{ date: '2026-12-20', start: '22:00', end: '02:00' }] }])[0];
    const semi = c.icsFor([{ id: 'n3', title: 'Launch; teaser, and film', address: 'Unit 4; Dock Road, Portside', date: '2026-12-10', status: 'Confirmed' }]);
    const long = c.icsFor([{ id: 'n4', title: 'A'.repeat(65) + '🎬 shoot', address: 'Улица Большая Дмитровка, дом 7, строение 2, вход со двора, домофон 14, третий этаж, студия', date: '2026-12-10', status: 'Confirmed' }]);
    const te = new TextEncoder(), asRead = new TextDecoder().decode(te.encode(long)); // as a calendar reads the saved file
    return { end: ev.end.getTime() === new Date(2026, 11, 11, 4, 0).getTime(), hour: bare.end - bare.start === 36e5, edit: ed.end.getTime() === new Date(2026, 11, 21, 2, 0).getTime(),
      semi: semi.includes('SUMMARY:Launch\\; teaser\\, and film') && semi.includes('LOCATION:Unit 4\\; Dock Road\\, Portside'),
      bytes: Math.max(...long.split('\r\n').map(l => te.encode(l).length)), emoji: asRead.replace(/\r\n /g, '').includes('🎬 shoot') && !asRead.includes('�') };
  }));
  ok('an overnight shoot (22:00 to 04:00) goes to the calendar ending 04:00 the next day, an overnight edit day too, and a shoot with no finish still gets an hour', icsFix.end && icsFix.edit && icsFix.hour, JSON.stringify(icsFix));
  ok('the calendar file escapes semicolons as it does commas', icsFix.semi);
  ok('its lines are folded at 75 bytes and never in the middle of an emoji or a letter', icsFix.bytes <= 75 && icsFix.emoji, JSON.stringify({ bytes: icsFix.bytes, emoji: icsFix.emoji }));

  // Two-way sync against a stand-in calendar: only the requests are stood in for, the sync itself is the real one
  await page.evaluate(async () => {
    const [c, s] = await Promise.all([import('./js/calendar.js'), import('./js/store.js')]);
    const G = c.ADAPTERS.google, fake = { events: new Map(), n: 0, skew: 0, delay: 0, calendars: [], updates: [] };
    const shape = e => ({ title: e.title, allDay: e.allDay, start: e.allDay ? e.start : e.start.toISOString(), end: e.allDay ? e.end : e.end.toISOString(), location: e.location });
    const wait = () => (fake.delay ? new Promise(r => setTimeout(r, fake.delay)) : null);
    window.__cal = { fake, real: { ...G }, c, s, of: id => [...fake.events.values()].find(e => e.logiId === id),
      sync: async () => { await c.syncCalendar({ interactive: true, which: 'account' }); while (c.calState.status === 'syncing') await new Promise(r => setTimeout(r, 20)); },
      edit: (id, patch) => Object.assign(window.__cal.of(id), patch, { updated: Date.now() + fake.skew + 60000 }), // an edit made in the calendar, a minute from now
      at: (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm).toISOString() };
    Object.assign(G, { signIn: async () => {}, signOut() {},
      call: async (path, init = {}) => { if (init.method === 'POST' && path === '/calendars') { const id = 'cal' + (fake.calendars.length + 1); fake.calendars.push(id); return { ok: true, json: async () => ({ id }) }; } const m = /^\/calendars\/([^/]+)$/.exec(path); return { ok: !!m && fake.calendars.includes(decodeURIComponent(m[1])), json: async () => ({}) }; },
      list: async () => [...fake.events.values()].map(e => ({ ...e })),
      create: async (id, e) => { await wait(); const eid = 'ev' + (++fake.n); fake.events.set(eid, { id: eid, logiId: e.id, ...shape(e), updated: Date.now() + fake.skew }); return eid; },
      update: async (id, eid, e) => { await wait(); Object.assign(fake.events.get(eid), shape(e), { updated: Date.now() + fake.skew }); fake.updates.push(e.id); },
      remove: async (id, eid) => { fake.events.delete(eid); } });
    const old = Date.now() - 3600000, bk = (id, title, more) => ({ id, title, client: '', type: 'brand', status: 'Confirmed', address: 'Old Road 1', stakeholders: [], crew: [], gear: [], notes: '', updatedAt: old, ...more });
    s.update(d => { d.bookings.push(bk('cs-night', 'Overnight', { date: '2026-12-10', start: '22:00', end: '04:00' }), bk('cs-start', 'Start only', { date: '2026-12-11', start: '09:00' }), bk('cs-multi', 'Three days', { date: '2026-12-14', endDate: '2026-12-16', start: '09:00' }), bk('cs-norm', 'Normal', { date: '2026-12-12', start: '09:00', end: '17:00' })); });
    await c.connectCalendar('google'); while (c.calState.status === 'syncing') await new Promise(r => setTimeout(r, 20));
  });
  const pick = () => page.evaluate(() => Object.fromEntries(['cs-night', 'cs-start', 'cs-multi', 'cs-norm'].map(id => { const b = window.__cal.s.byId('bookings', id); return [id, [b.title, b.date, b.endDate || '', b.start || '', b.end || '', b.address].join('|')]; })));
  const connected = await page.evaluate(() => ({ n: ['cs-night', 'cs-start', 'cs-multi', 'cs-norm'].filter(id => window.__cal.of(id)).length, nightEnd: window.__cal.of('cs-night').end === window.__cal.at(2026, 12, 11, 4, 0), cals: window.__cal.fake.calendars.length }));
  ok('connecting puts the bookings in one “Vdex bookings” calendar, the overnight one ending the next morning', connected.n === 4 && connected.nightEnd && connected.cals === 1, JSON.stringify(connected));
  await page.evaluate(async () => { for (const id of ['cs-night', 'cs-start', 'cs-multi', 'cs-norm']) window.__cal.edit(id, { location: 'New Place 5' }); await window.__cal.sync(); });
  const moved = await pick();
  ok('a new address typed on the calendar events comes back as the address and nothing else: no finish is made up or overwritten', moved['cs-night'] === 'Overnight|2026-12-10||22:00|04:00|New Place 5' && moved['cs-start'] === 'Start only|2026-12-11||09:00||New Place 5' && moved['cs-multi'] === 'Three days|2026-12-14|2026-12-16|09:00||New Place 5' && moved['cs-norm'] === 'Normal|2026-12-12||09:00|17:00|New Place 5', JSON.stringify(moved));
  await page.evaluate(async () => { const C = window.__cal; C.edit('cs-night', { start: C.at(2026, 12, 10, 21, 0), end: C.at(2026, 12, 11, 5, 0) }); C.edit('cs-start', { start: C.at(2026, 12, 12, 10, 0), end: C.at(2026, 12, 12, 11, 0) }); C.edit('cs-norm', { end: C.at(2026, 12, 12, 18, 30) }); await C.sync(); });
  const timed = await pick();
  ok('times changed in the calendar come back: a finish the next morning stays an overnight finish, a moved shoot with no finish gets none, a later finish is taken', timed['cs-night'] === 'Overnight|2026-12-10||21:00|05:00|New Place 5' && timed['cs-start'] === 'Start only|2026-12-12||10:00||New Place 5' && timed['cs-norm'] === 'Normal|2026-12-12||09:00|18:30|New Place 5', JSON.stringify(timed));
  // The calendar's clock 20 seconds ahead of this device's: Vdex's own push must not pass for a calendar edit
  await page.evaluate(async () => { const C = window.__cal; C.fake.skew = 20000; C.s.upsert('bookings', { ...C.s.byId('bookings', 'cs-norm'), notes: 'Bring the long lens' }); await C.sync(); await C.sync();
    C.s.upsert('bookings', { ...C.s.byId('bookings', 'cs-norm'), title: 'Normal renamed', date: '2026-12-19' }); await C.sync(); });
  const skew = await pick(), skewEv = await page.evaluate(() => window.__cal.of('cs-norm').title);
  ok('with the device’s clock behind the calendar’s, an edit made in Vdex is kept and sent, and nothing else changes', skew['cs-norm'] === 'Normal renamed|2026-12-19||09:00|18:30|New Place 5' && skewEv === 'Normal renamed' && skew['cs-night'] === timed['cs-night'], JSON.stringify(skew) + ' / ' + skewEv);
  // A booking changed while a sync is still running goes out when that sync ends
  await sleep(1700); // let the automatic syncs of the changes above finish first
  const queued = await page.evaluate(async () => { const C = window.__cal, nap = ms => new Promise(r => setTimeout(r, ms)); while (C.c.calState.status === 'syncing') await nap(20);
    C.fake.skew = 0; C.fake.delay = 300;
    C.s.upsert('bookings', { ...C.s.byId('bookings', 'cs-norm'), title: 'Renamed again' }); const first = C.c.syncCalendar();
    await nap(80); C.s.upsert('bookings', { ...C.s.byId('bookings', 'cs-norm'), start: '06:00' }); C.c.syncCalendar(); // asked for while the first is still sending
    await first; C.fake.delay = 0; const ev = C.of('cs-norm'); return { title: ev.title, hour: new Date(ev.start).getHours(), state: C.c.calState.status }; });
  ok('a change made while a sync is running reaches the calendar when that sync ends', queued.title === 'Renamed again' && queued.hour === 6 && queued.state === 'ok', JSON.stringify(queued));
  // Disconnect and Connect again use the calendar Vdex made before
  const reconnect = await page.evaluate(async () => { const C = window.__cal; C.c.disconnectCalendar('account'); await C.c.connectCalendar('google'); while (C.c.calState.status === 'syncing') await new Promise(r => setTimeout(r, 20));
    const out = { cals: C.fake.calendars.length, id: C.s.db.calSync.calendarId, events: [...C.fake.events.values()].filter(e => e.logiId === 'cs-norm').length };
    C.c.disconnectCalendar('account'); Object.assign(C.c.ADAPTERS.google, C.real); C.s.update(d => { d.bookings = d.bookings.filter(b => !b.id.startsWith('cs-')); }); return out; });
  ok('Disconnect and Connect again go back to the same calendar: no second “Vdex bookings”, no booking twice', reconnect.cals === 1 && reconnect.id === "cal1" && reconnect.events === 1, JSON.stringify(reconnect));

  // ---- repairs after 1.4.0: the booking form and page ----
  const form = page.locator('.sheet form');
  await page.getByRole('button', { name: '+ New' }).click(); await form.waitFor();
  await form.locator('input[data-key="title"]').fill('   '); await form.locator('button[type=submit]').click(); await sleep(300);
  ok('a project name of spaces alone is refused like an empty one: the form stays open and nothing is stored', (await form.count()) === 1 && !(await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.some(b => !String(b.title || '').trim())))), await form.locator('input[data-key="title"]').evaluate(e => e.validationMessage).catch(() => 'form closed'));
  if (!(await form.count())) { await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.bookings = d.bookings.filter(b => String(b.title || '').trim()); }))); await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await page.getByRole('button', { name: '+ New' }).click(); await form.waitFor(); }
  await form.locator('input[data-key="title"]').fill('Backwards'); await form.locator('input[data-key="date"]').fill('2026-12-20'); await form.locator('input[data-key="endDate"]').fill('2026-12-18');
  await form.locator('button[type=submit]').click(); await sleep(300);
  const backMsg = (await form.count()) ? await form.locator('input[data-key="endDate"]').evaluate(e => e.validationMessage) : 'form closed';
  ok('an end date before the start date is said so on the End date box, and the form stays open', backMsg === 'The end date is before the start date', backMsg);
  const venueSel = form.locator('select').filter({ has: page.locator('option', { hasText: 'No saved venue' }) });
  if (await form.count()) { await form.locator('input[data-key="endDate"]').fill('2026-12-22'); await form.locator('button[type=submit]').click(); await sleep(400); }
  const back1 = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => x.title === 'Backwards') || {}; return { id: b.id, end: b.endDate }; }));
  ok('with the end date put right the booking is saved over its days', back1.end === '2026-12-22', JSON.stringify(back1));
  // The address follows the venue unless it was typed by hand
  const editBk = async () => { await page.locator('.bk-detail .page-head').getByRole('button', { name: 'Edit', exact: true }).click(); await form.waitFor(); };
  const saveBk = async () => { await form.locator('button[type=submit]').click(); await sleep(400); };
  const addr = () => page.evaluate(id => import('./js/store.js').then(s => { const b = s.byId('bookings', id); return { address: b.address, venue: (s.byId('venues', b.venueId) || {}).address }; }), back1.id);
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), back1.id); await sleep(300);
  await editBk(); await venueSel.selectOption({ label: 'Harbour Brewing Co. taproom' }); await saveBk(); const at1 = await addr();
  await editBk(); await venueSel.selectOption({ label: 'Northline Legal, level 9' }); await saveBk(); const at2 = await addr();
  ok('changing the saved venue changes the address that came from the venue before', !!at1.address && at1.address === at1.venue && at2.address === at2.venue && at2.address !== at1.address, JSON.stringify([at1, at2]));
  await page.evaluate(id => Promise.all([import('./js/store.js'), import('./js/pages/venues.js')]).then(([s, v]) => v.editVenue(s.byId('venues', s.byId('bookings', id).venueId))), back1.id); await form.waitFor();
  await form.locator('textarea[data-key="address"]').fill('21 Corrected Street, Portside'); await saveBk();
  ok('correcting the venue’s address corrects it on the bookings that held the old one', (await addr()).address === '21 Corrected Street, Portside', JSON.stringify(await addr()));
  await editBk(); await form.locator('textarea[data-key="address"]').fill('Loading bay B, behind the building'); await saveBk();
  await editBk(); await venueSel.selectOption({ label: 'Harbour Brewing Co. taproom' }); await saveBk();
  ok('an address typed by hand stays when the venue changes', (await addr()).address === 'Loading bay B, behind the building', JSON.stringify(await addr()));

  // What is being typed on the page survives the redraw a change elsewhere causes (a calendar or cloud sync)
  const shot = page.locator('#bk-shots input[aria-label="New shot"]');
  await shot.click(); await page.keyboard.type('Wide of the brewhouse');
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile.bio = 'changed elsewhere ' + Date.now(); }))); await sleep(150);
  await page.keyboard.type(' from the mezzanine'); await page.keyboard.press('Enter'); await sleep(300);
  const shots = await page.evaluate(id => import('./js/store.js').then(s => (s.byId('bookings', id).shots || []).map(x => x.text)), back1.id);
  ok('a shot being typed while the page is drawn again is stored whole', shots.length === 1 && shots[0] === 'Wide of the brewhouse from the mezzanine', JSON.stringify(shots));

  // A call time typed over another with the keyboard is taken whole, and the focus stays in the box
  await page.evaluate(id => import('./js/store.js').then(s => { const c = s.db.crew[0]; s.upsert('bookings', { ...s.byId('bookings', id), crew: [c.id], crewCall: { [c.id]: '07:30' } }); }), back1.id); await sleep(300);
  const callBox = page.locator('#bk-crew .crew-line input[type=time]').first();
  await callBox.focus(); await page.keyboard.type('0845'); await sleep(200);
  const midFocus = await page.evaluate(() => document.activeElement && document.activeElement.type);
  await callBox.blur(); await sleep(300); // leaving the box (Tab goes through its hours, minutes and AM/PM first)
  const call = await page.evaluate(id => import('./js/store.js').then(s => Object.values(s.byId('bookings', id).crewCall)[0]), back1.id);
  ok('typing 0 8 4 5 over a call time of 07:30 gives 08:45, with the focus still in the box while typing', call === '08:45' && midFocus === 'time', call + ' / focus on ' + midFocus);

  // Long unbroken names and a pasted map link wrap inside a 360-pixel phone
  await page.evaluate(id => import('./js/store.js').then(s => s.upsert('bookings', { ...s.byId('bookings', id), title: 'ACME_BrandFilm_Q4_2026_SocialCutdowns_v2', client: 'Bundesverband_der_Filmschaffenden_Deutschland_eV', address: 'https://www.google.com/maps/place/Harbour+Brewing+Co/@51.5072178,-0.1275862,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5072178!4d-0.1275862', date: new Date().toISOString().slice(0, 10), endDate: '' })), back1.id);
  await page.setViewportSize({ width: 360, height: 800 }); await sleep(300);
  const widths = {};
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  widths.booking = await wide();
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id, { view: 'callsheet' })), back1.id); await sleep(300); widths.callsheet = await wide();
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id, { view: 'strips' })), back1.id); await sleep(400); widths.strips = await wide();
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await sleep(300); widths.month = await wide();
  ok('a long unbroken project name, client and map link stay inside a 360-pixel phone: the booking, its call sheet and stripboard, and the list', Object.values(widths).every(w => w <= 360), JSON.stringify(widths));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);

  // A crew member or an item deleted on another device: its id leaves the bookings and kits here too
  const gone = await page.evaluate(() => import('./js/store.js').then(s => { const local = JSON.parse(s.serialize()), [c1, c2] = local.crew.map(x => x.id), [g1, g2] = local.gear.map(x => x.id);
    local.bookings.push({ id: 'mg1', title: 'Merge', date: '2026-12-01', status: 'Confirmed', crew: [c1, c2], gear: [g1, g2], gearQty: { [g1]: 2 }, updatedAt: 5 }); local.kits.push({ id: 'mk1', name: 'Merge kit', gear: [g1, g2], updatedAt: 5 });
    const remote = JSON.parse(JSON.stringify(local)), off = x => x.id !== c1 && x.id !== g1;
    remote.crew = remote.crew.filter(off); remote.gear = remote.gear.filter(off); remote.deleted = { ...remote.deleted, [c1]: Date.now(), [g1]: Date.now() };
    for (const o of [remote.bookings.find(x => x.id === 'mg1'), remote.kits.find(x => x.id === 'mk1')]) { o.gear = o.gear.filter(x => x !== g1); if (o.crew) o.crew = o.crew.filter(x => x !== c1); } // as the device that deleted them left it: no new stamp
    const m = s.mergeDb(local, remote), b = m.bookings.find(x => x.id === 'mg1'), k = m.kits.find(x => x.id === 'mk1'); return { crew: b.crew.join() === c2, gear: b.gear.join() === g2, qty: !(g1 in (b.gearQty || {})), kit: k.gear.join() === g2 }; }));
  ok('after a sync, a booking and a kit no longer hold the crew member and the item that were deleted on the other device', gone.crew && gone.gear && gone.qty && gone.kit, JSON.stringify(gone));

  // ---- the night the clocks change (a browser in New York): the crew page's calendar file and hours added by hand ----
  const ny = await browser.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'America/New_York', acceptDownloads: true });
  await ny.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ny.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); }); await ny.addInitScript(acceptTerms());
  const np = await ny.newPage(); np.on('pageerror', e => errors.push(e.message));
  await np.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await np.waitForSelector('#rolodex .drum-btn');
  const links = await np.evaluate(async () => { const s = await import('./js/store.js'), l = await import('./js/crew-link.js'); const bk = (id, date) => ({ id, title: 'Night ' + id, date, start: '22:00', end: '04:00', status: 'Confirmed', crew: [], gear: [], stakeholders: [] });
    s.update(d => { d.bookings.push(bk('dst1', '2026-10-31'), bk('dst2', '2027-03-13'), bk('dst3', '2026-12-10')); }); return Promise.all(['dst1', 'dst2', 'dst3'].map(id => l.crewLink(s.byId('bookings', id)))); });
  const ends = [];
  for (const link of links) { const cp = await ny.newPage(); await cp.goto(link); await cp.waitForSelector('.paper');
    const [dl] = await Promise.all([cp.waitForEvent('download', { timeout: 15000 }), cp.getByRole('button', { name: /Add to calendar/ }).click()]);
    ends.push((/DTEND:(\S+)/.exec(fs.readFileSync(await dl.path(), 'utf8')) || [])[1]); await cp.close(); }
  ok('the crew page’s calendar file ends an overnight shoot at 04:00 the next day, also on the nights the clocks go back and forward', ends.join() === '20261101T040000,20270314T040000,20261211T040000', ends.join());
  const nform = np.locator('.sheet form'), worked = [];
  for (const [date, id] of [['2026-10-31', 'dst1'], ['2027-03-13', 'dst2'], ['2026-12-10', 'dst3']]) {
    await np.evaluate(id => import('./js/hours.js').then(hh => hh.editShift(null, id)), id); await nform.waitFor();
    await nform.locator('input[data-key="date"]').fill(date); await nform.locator('input[data-key="start"]').fill('22:00'); await nform.locator('input[data-key="end"]').fill('04:00'); await nform.locator('input[data-key="breakMin"]').fill('0');
    await nform.locator('button[type=submit]').click(); await sleep(300);
    worked.push(await np.evaluate(id => import('./js/store.js').then(s => { const x = s.db.shifts.find(y => y.bookingId === id); return x ? [(x.end - x.start) / 36e5, new Date(x.end).getHours()].join('h to ') : 'none'; }), id)); }
  ok('hours added by hand from 22:00 to 04:00 end at 04:00: seven hours when the clocks go back, five when they go forward, six on any other night', worked.join() === '7h to 4,5h to 4,6h to 4', worked.join());
  await ny.close();

  // ---- venues: repairs after 1.4.0 ----
  { // Today is the day here, not in Greenwich: at 6 pm in Los Angeles (2 am the next day in UTC) today's shoot is still listed.
    const at = new Date(); at.setUTCHours(2, 0, 0, 0);
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    const la = await browser.newContext({ viewport: { width: 420, height: 900 }, timezoneId: 'America/Los_Angeles' });
    await la.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    let lookups = 0; await la.route('https://nominatim.openstreetmap.org/**', r => { lookups++; return r.abort('internetdisconnected'); });
    await la.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); });
    await la.addInitScript(acceptTerms());
    const vp = await la.newPage(); vp.on('pageerror', e => errors.push(e.message)); vp.on('dialog', d => d.accept());
    await vp.clock.install({ time: at });
    await vp.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await vp.waitForSelector('#rolodex .drum-btn');
    await vp.evaluate(date => import('./js/store.js').then(s => s.update(d => {
      d.venues.push({ id: 'v-today', name: 'Probe Studio', address: '1 Example Road', hospital: 'Example General, 2 miles', perms: { drones: 'ask', lighting: 'no' } }, ...['Alpha Studio', 'Beta Hall', 'Delta Loft', 'Zeta Yard'].map((name, i) => ({ id: 'v' + i, name, address: '' })));
      d.bookings.push({ id: 'b-today', title: 'Evening shoot', date, start: '17:00', end: '22:00', status: 'Confirmed', venueId: 'v-today', crew: [], gear: [] }); })), local);
    const openVenue = async id => { await vp.evaluate(id => import('./js/pages/venues.js').then(v => v.openVenue(id)), id); await sleep(400); };
    await openVenue('v-today');
    const pageText = (await vp.locator('main, #app').first().innerText()).replace(/\s+/g, ' ');
    ok('at 6 pm in Los Angeles a venue still lists today’s shoot under Upcoming shoots here', /Upcoming shoots here Evening shoot/i.test(pageText) && !/None booked/.test(pageText), pageText.slice(-140));
    ok('a venue with only its hospital recorded does not also say “Nothing recorded yet.”', /Example General, 2 miles/.test(pageText) && !/Nothing recorded yet/.test(pageText));
    // a search left in the box when the list becomes too short for the box
    await vp.locator('.page-head button', { hasText: 'Venues' }).click(); await sleep(250);
    await vp.locator('.search').fill('zeta'); await sleep(250);
    await vp.locator('.venue-card .card-main').click(); await sleep(250);
    await vp.locator('.page-head button', { hasText: 'Edit' }).click(); await vp.waitForSelector('.sheet form');
    await vp.locator('.sheet form .btn.danger').click(); await sleep(400);
    ok('deleting the one venue a search found, in a list then too short for the search box, shows the venues that are left', (await vp.locator('.venue-card').count()) === 4 && (await vp.locator('.empty', { hasText: 'No matches.' }).count()) === 0 && (await vp.locator('.search').count()) === 0, (await vp.locator('.venue-card').count()) + ' cards');
    // the venue form's map location
    await vp.locator('.page-head button.primary').click(); await vp.waitForSelector('.sheet form');
    const lat = vp.locator('.sheet form input[aria-label="Latitude"]'), lon = vp.locator('.sheet form input[aria-label="Longitude"]'), link = vp.locator('.sheet form input[aria-label="Map link to read coordinates from"]');
    await vp.locator('.sheet form input[data-key="name"]').fill('Map Hall'); await vp.locator('.sheet form textarea[data-key="address"]').fill('1 Example Road, Portside');
    await vp.evaluate(() => window.__toasts.splice(0));
    await vp.getByRole('button', { name: /Find from address/ }).click(); await sleep(500);
    const offline = await vp.evaluate(() => window.__toasts.splice(0));
    ok('Find from address with no connection says “Lookup failed. Are you online?”, not the browser’s own words', lookups === 1 && offline.join('|') === 'Lookup failed. Are you online?', offline.join('|'));
    await link.fill('https://www.google.com/maps/search/100%+coffee/@51.5007,-0.1246,17z'); await link.press('Tab'); await sleep(250);
    ok('a map link with a stray % sign is still read', (await lat.inputValue()) === '51.5007' && (await lon.inputValue()) === '-0.1246' && /Location read from link/.test((await vp.evaluate(() => window.__toasts.splice(0))).join('|')), await lat.inputValue());
    await lon.fill(''); await vp.locator('.sheet form button[type=submit]').click(); await sleep(300);
    const half = [await vp.locator('.sheet form').count(), await lon.evaluate(e => e.validationMessage), await vp.evaluate(() => import('./js/store.js').then(s => s.db.venues.filter(v => v.name === 'Map Hall').length))];
    await lon.fill('-0.1246'); await vp.locator('.sheet form button[type=submit]').click(); await sleep(350);
    const whole = await vp.evaluate(() => import('./js/store.js').then(s => s.db.venues.find(v => v.name === 'Map Hall')));
    ok('a latitude without a longitude is refused with a word on the empty box, and saved once both are there', half[0] === 1 && /both/.test(half[1]) && half[2] === 0 && !!whole && whole.geo && whole.geo.lat === 51.5007 && whole.geo.lon === -0.1246, JSON.stringify([half, whole && whole.geo]));
    // a venue's rules go by what kind of thing an item is, however its category was typed
    const warned = await vp.evaluate(() => Promise.all([import('./js/pages/venues.js'), import('./js/store.js')]).then(([v, s]) => ['Drone', 'Drones', 'drone', ' DRONES ', 'Lighting', 'lighting', 'Camera'].map(category => v.venueWarnings(s.byId('venues', 'v-today'), [{ category }]).length)));
    ok('“drone”, “Drones” and “Drone” all bring the venue’s drone rule to a booking', warned.join() === '1,1,1,1,1,1,0', warned.join());
    await la.close();
  }
  await page.screenshot({ path: S + '/booking-layout.png', fullPage: true });
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

// The booking page laid out anew: tools, hours and the day's weather at the top in outlined boxes; the workflow,
// budget, quote and invoice folded into one box with a summary line; Check all and the archive question; people
// (stakeholders, crew, hired people) in one section with rentals under Equipment; long lists folding after five;
// edit days in their own colour on the calendar, in the feed and on the clock bar; the shot-list import filling the
// stripboard; the back button; the share button named for the calendar.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
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

  // ---- people: stakeholders, crew, hired people; rentals under Equipment; the legacy copy sorted out ----
  await openBooking(seed.title);
  const people = page.locator('#bk-people');
  ok('one People section: stakeholders, crew and hires', (await people.locator('#bk-stakeholders h4').innerText()) === 'Stakeholders (2)' && (await people.locator('#bk-crew h4').innerText()) === 'Crew (2)' && (await people.locator('#bk-hires h4').innerText()) === 'Hires (0)');
  ok('the rental an older copy kept under hires is shown as rented equipment, with the one already under rentals', (await page.locator('#bk-kit #bk-rentals h4').innerText()) === 'Rented (2)' && /Prism lens/.test(await page.locator('#bk-rentals').innerText()) && /Easyrig/.test(await page.locator('#bk-rentals').innerText()), await page.locator('#bk-kit #bk-rentals h4').innerText());
  await page.locator('#bk-hires button', { hasText: 'Hire someone' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="name"]').fill('Dana Fox'); await page.locator('.sheet form input[data-key="role"]').fill('Gaffer'); await page.locator('.sheet form input[data-key="rate"]').fill('$400/day');
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
  const cell = page.locator(`.cal .day[aria-label*="${new Date().getDate()} "]`).first();
  const today = await page.evaluate(() => { const d = new Date(); const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); const el = [...document.querySelectorAll('.cal .day')].find(x => x.getAttribute('aria-label')?.startsWith(label)); return el ? { cls: el.className, label: el.getAttribute('aria-label'), dots: [...el.querySelectorAll('.dots i')].map(i => i.className), mini: [...el.querySelectorAll('.mini')].map(m => m.className + ':' + m.textContent) } : null; });
  ok('on the calendar an edit day is marked in the edit colour, and says so', !!today && /edit-day/.test(today.cls) && /edit day/.test(today.label) && (today.dots.some(c => /\bedit\b/.test(c)) || today.mini.some(c => /\bedit\b/.test(c))), JSON.stringify(today));
  await page.evaluate(() => { const d = new Date(); const label = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); [...document.querySelectorAll('.cal .day')].find(x => x.getAttribute('aria-label')?.startsWith(label))?.click(); }); await sleep(300);
  const dayCard = page.locator('#page .card.tap', { hasText: 'Harbour' });
  ok('the day lists the booking as an edit day', (await dayCard.count()) === 1 && (await dayCard.locator('.pill.edit').innerText()) === 'Edit day' && /✂ Edit day/.test(await dayCard.innerText()));
  const bar = page.locator('#clockbar');
  ok('the clock bar shows the edit day', await bar.isVisible() && /✂ Edit day/.test(await bar.innerText()), await bar.innerText());
  await bar.getByRole('button', { name: 'Start work' }).click(); await sleep(300);
  const live = await page.evaluate(() => import('./js/hours.js').then(hh => { const r = hh.running(); return r && { kind: hh.kindOf(r), bookingId: r.bookingId }; }));
  ok('Start work on an edit day logs the hours as editing on that project', live && live.kind === 'edit' && live.bookingId === seed.id, JSON.stringify(live));
  await bar.getByRole('button', { name: 'Stop work' }).click(); await sleep(300);
  await dayCard.click(); await page.waitForSelector('.bk-detail'); await sleep(200);
  ok('back from the booking goes to the day it was opened from, and the hours say the session was editing', /^‹ /.test((await page.locator('.bk-detail .page-head .back-btn').textContent()).trim()) && /editing/.test(await page.locator('#bk-hours').innerText()), await page.locator('#bk-hours').innerText().then(t => t.replace(/\n/g, ' | ').slice(0, 120)));

  // ---- the shot list import fills the stripboard ----
  await page.locator('#bk-shots button', { hasText: 'Import shot list' }).click(); await page.waitForSelector('.sheet textarea[aria-label="Pasted shot list"]');
  await page.locator('.sheet textarea[aria-label="Pasted shot list"]').fill('Drone: harbour at golden hour\n\nINT. TAPROOM - MORNING\nWide: steam over the mash tun\n2. CU: Ana pouring\n\nScene 12 - EXT. LOADING BAY - DUSK\n- Tracking shot along the quay\n');
  await page.locator('.sheet button', { hasText: 'Add these shots' }).click(); await sleep(500);
  const imp = await page.evaluate(id => import('./js/store.js').then(s => { const b = s.byId('bookings', id); return { shots: b.shots.map(x => [x.text, x.scene || '']), scenes: b.board.list.filter(x => x.type === 'scene').map(x => [x.scene, x.ie, x.set, x.tod, x.eighths]), review: b.shotImportReview && b.shotImportReview.scenes }; }), seed.id);
  ok('the shots are added under their scenes, list marks dropped, the one before any heading unsorted', imp.shots.some(x => x[0] === 'Wide: steam over the mash tun' && x[1] === '1') && imp.shots.some(x => x[0] === 'CU: Ana pouring' && x[1] === '1') && imp.shots.some(x => x[0] === 'Tracking shot along the quay' && x[1] === '12') && imp.shots.some(x => x[0] === 'Drone: harbour at golden hour' && x[1] === ''), JSON.stringify(imp.shots));
  ok('the headings became strips on the board, marked for a check', imp.scenes.length === 2 && imp.scenes[0].join('|') === '1|INT|TAPROOM|MORNING|1' && imp.scenes[1].join('|') === '12|EXT|LOADING BAY|DUSK|1' && imp.review === 2, JSON.stringify(imp.scenes));
  const shotsBox = await page.locator('#bk-shots').innerText();
  ok('the section groups the shots by scene, with Unsorted, and asks for the check', /Scene 1 · TAPROOM/.test(shotsBox) && /Scene 12 · LOADING BAY/.test(shotsBox) && /Unsorted/.test(shotsBox) && /2 scenes came from the shot list/.test(shotsBox) && /2 scenes · .* · 1 shooting day · 2 not scheduled yet/.test(shotsBox), shotsBox.replace(/\n/g, ' | ').slice(0, 300));
  await page.locator('.bk-tools .sb-open').click(); await page.waitForSelector('.sb-page .sb-board'); await sleep(300);
  ok('the stripboard page shows the new strips, the warning and the shot list under the board', (await page.locator('.sb-strip').count()) === 2 && (await page.locator('.sb-page .review-note').count()) === 1 && (await page.locator('#sb-shots .check-item').count()) === 7 && (await page.locator('.sb-page h1').innerText()) === 'Stripboard & shot list');
  await page.locator('.sb-page .review-note button', { hasText: 'Checked' }).click(); await sleep(300);
  ok('Checked clears the warning', (await page.locator('.sb-page .review-note').count()) === 0 && !(await page.evaluate(id => import('./js/store.js').then(s => !!s.byId('bookings', id).shotImportReview), seed.id)));
  await page.screenshot({ path: S + '/booking-layout.png', fullPage: true });
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

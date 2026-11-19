// Shared things, there and back: a booking (the crew link), a contact card and an equipment list are each made into
// a link in one browser, opened in another that never used Vdex with the sender, read on the public page, and added
// with "Add to my Vdex" after a preview; adding again updates instead of copying. Also: the card's .vcf download,
// serial-number duplicates (skip, update, add anyway) and a kit, the notice about serial numbers and values, hostile
// and oversized links, read-only mode, and a link that arrives while Vdex is locked, on the terms or in the tour.
// Then what a review of all that found: an update that keeps what was changed and added by hand (and says exactly what
// it replaces), money on a booking that came from a producer, cards that only look like someone on the Crew list, one's
// own card and one's own equipment, Undo after an equipment link, lists and shoots longer than a link may bring, a
// link too big for the browser's storage, one preview at a time, the scanner on a long code, and the shared pages'
// line for people whose Vdex is an app. And: the name an invoice is listed under when the booking came from a link, the
// formula guard in the TC Notes spreadsheet, and an Add whose follow-up cannot be fetched. And what a second check of
// those fixes found: a contact typed by hand under a name a later link also carries, an invoice headed anew by an
// update, a link that names no sender, the producer's deliverables, a sync between two devices that took the same
// link (or of which only one took its update), and a workmate's card under one's own email address.
const { chromium } = require('playwright');
const fs = require('fs');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const hashOf = u => u.slice(u.indexOf('#') + 1);

(async () => {
  const browser = await chromium.launch();
  const errors = [], requests = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); p.on('dialog', d => d.accept()); return p; };
  // A browser of its own: by default one that has agreed to the terms, skipped the PIN set-up and seen the tour.
  const open = async ({ width = 420, height = 900, terms = true, tour = true, init = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    if (tour) await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(terms ? acceptTerms().content : `try { localStorage.setItem('logi-lock-setup', 'skip'); } catch (e) {}`);
    if (init) await ctx.addInitScript(init);
    ctx.on('request', q => requests.push(q.url()));
    return { ctx, page: watch(await ctx.newPage()) };
  };
  const db = page => page.evaluate(() => import('./js/store.js').then(s => JSON.parse(s.serialize())));
  // The shared page, then its "Add to my Vdex" button, then the app's preview sheet.
  const viaPage = async (page, link) => {
    await page.goto(link); await page.waitForSelector('a.btn.primary');
    const href = await page.locator('a.btn.primary').getAttribute('href');
    await Promise.all([page.waitForURL(/index\.html/), page.locator('a.btn.primary', { hasText: 'Add to my Vdex' }).click()]);
    await page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
    return href;
  };
  const sheetText = page => page.locator('.sheet').last().innerText();

  /* ============================== the sender ============================== */
  const A = await open();
  await A.page.goto(BASE); await A.page.waitForSelector('#rolodex .drum-btn');
  await A.page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const seed = await A.page.evaluate(([d1, d2]) => import('./js/store.js').then(s => {
    const b = s.db.bookings.find(x => /Harbour/.test(x.title)), c = s.db.crew[0], c2 = s.db.crew[1], g = s.db.gear[0], v = s.db.venues[0];
    s.update(d => {
      d.profile = { ...d.profile, name: 'Pat Producer', business: 'Quay Films', title: 'Producer / DOP', phone: '+44 20 7946 0100', email: 'pat@quayfilms.example', website: 'quayfilms.example', location: 'Portside', currency: '£', updatedAt: Date.now() };
      const x = d.bookings.find(y => y.id === b.id), gr = d.gear.find(y => y.id === g.id), vn = d.venues.find(y => y.id === v.id);
      Object.assign(d.crew.find(y => y.id === c.id), { rate: 450, rateUnit: 'day', email: 'sam@example.com', phone: '+1 555 0101' });
      Object.assign(gr, { value: 9876, serial: 'FX6-120934', location: 'Flight case 1', notes: 'Spare battery plate in the lid', purchased: '2024-03-01', warranty: '2027-03-01', serviceEvery: 12, firmware: '5.01', log: [{ id: 'lg1', date: '2026-01-10', kind: 'service', note: 'SECRET SERVICE NOTE', cost: 222 }] });
      Object.assign(vn, { hospital: 'Portside General, 2 Hill Road', parking: 'Loading bay for 30 min', power: '2 x 16A at the bar' });
      Object.assign(x, { title: 'Harbour Brewing brand film', client: 'Harbour Brewing Co.', type: 'vertical', date: d1, endDate: d2, start: '07:30', end: '17:00', status: 'Prepped', address: '12 Dock Road, Portside', venueId: v.id, crew: [c.id, c2.id], crewCall: { [c.id]: '07:00' }, gear: [g.id], notes: 'SECRET BOOKING NOTE', breakMinutes: 45, breakNote: 'lunch on the quay',
        stakeholders: [{ name: 'Ana Ruiz', role: 'Marketing lead', phone: '+1 555 0199', email: 'ana@harbour.example' }],
        hires: [{ id: 'h1', name: 'Dee Driver', role: 'Runner', rate: 150, rateUnit: 'day', days: 2, phone: '+1 555 0177', email: 'dee@example.com' }],
        shots: [{ id: 's1', text: 'Wide of the harbour at dawn', done: false }, { id: 's2', text: 'Close-up of the hands', done: true }],
        deliverables: [{ id: 'd1', name: 'Main cut 9:16', duration: '60 s', due: d2, status: 'In progress', link: 'https://private.example/review' }],
        quote: { number: 'Q-0099', status: 'Sent', date: d1, taxRate: 20, lines: [{ id: 'q1', desc: 'Production', qty: 1, unit: 'item', price: 2500 }] },
        budget: { lines: [{ id: 'bl1', cat: 'Crew', desc: 'Sam', qty: 1, unit: 'day', rate: 450 }], updatedAt: Date.now() },
        board: { list: [{ id: 'sc1', type: 'scene', scene: '1', ie: 'EXT', set: 'QUAY', tod: 'DAWN', dn: 'D', desc: 'The boats come in', cast: ['ANA', 'TOM'], eighths: 12, notes: 'SECRET STRIP NOTE' }, { id: 'bn1', type: 'banner', text: 'Company move' }, { id: 'sc2', type: 'scene', scene: '2', ie: 'INT', set: 'TAPROOM', tod: '', dn: 'N', desc: 'Last orders', cast: ['ANA'], eighths: 5, notes: '' }, { id: 'day-1', type: 'break' }, { id: 'day-2', type: 'break' }], cast: ['ANA', 'TOM'], updatedAt: Date.now() },
        callSheet: { generalCall: '07:30', lunch: '12:30', wrap: '18:00', schedule: [{ id: 'r1', date: d1, time: '08:00', item: 'First set-up on the quay' }, { id: 'r2', date: d2, time: '09:00', item: 'Interviews in the taproom' }], dress: 'Warm layers', emergency: 'Site medic 555 0111', notes: 'Bring a head torch', attendees: 'Talent arrives 09:00', weather: 'Dry, cold' } });
      x.updatedAt = Date.now();
    });
    return { id: b.id, venue: v.name, gearId: g.id, kit: s.db.kits[0].id, kitName: s.db.kits[0].name, kitGear: s.db.kits[0].gear.length };
  }), [day(3), day(4)]);
  const EVERYTHING = { client: true, crew: true, contacts: true, scenes: true, shots: true, kit: true, deliverables: true, rules: true, notes: true };
  const crewLink = () => A.page.evaluate(([id, inc]) => Promise.all([import('./js/store.js'), import('./js/crew-link.js')]).then(([s, m]) => m.crewLink(s.byId('bookings', id), inc)), [seed.id, EVERYTHING]);

  /* ============================== a booking ============================== */
  await A.page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await A.page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), seed.id);
  await A.page.locator('.bk-detail button:has-text("Share with crew")').click();
  await A.page.waitForFunction(() => (document.querySelector('.sheet textarea.share-link') || {}).value?.includes('crew.html#'), null, { timeout: 8000 });
  ok('Share with crew says crew who use Vdex can add the shoot to their own Bookings', /add the shoot to their own Bookings/.test(await sheetText(A.page)));
  const uiLink = await A.page.locator('.sheet textarea.share-link').inputValue();
  await A.page.keyboard.press('Escape'); await sleep(200);
  const link1 = await crewLink(); // the same link with every part ticked, the client's contacts too

  const B = await open({ width: 360, height: 740 }); // the workmate: a phone, a browser that has never held any of this
  await B.page.goto(uiLink); await B.page.waitForSelector('.paper h1');
  const addHref = await B.page.locator('a.btn.primary').getAttribute('href');
  ok('the crew page offers Add to my Vdex, and the button carries the very same packed link into the app', (await B.page.locator('a.btn.primary').innerText()).includes('Add to my Vdex') && addHref === 'index.html#add=' + hashOf(uiLink));
  ok('…beside what was there before: Add to calendar and Print, and the shoot to read with no Vdex at all', (await B.page.locator('.bar .acts button').count()) === 2 && /Harbour Brewing brand film/.test(await B.page.locator('.paper').innerText()));
  const crewFits = await B.page.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth, hit: [...document.querySelectorAll('.bar .btn')].every(b => b.getBoundingClientRect().height >= 44) }));
  ok('…fitting a 360-pixel phone with full-size buttons', crewFits.page && crewFits.hit, JSON.stringify(crewFits));

  await viaPage(B.page, link1);
  const at1 = await B.page.evaluate(() => ({ hash: location.hash, href: location.href, parked: sessionStorage.getItem('vdex-add') }));
  ok('the app opens with a preview, and the link is gone from the address bar', at1.hash === '' && !at1.href.includes('#') && /index\.html$/.test(at1.href), at1.href);
  const pv = await sheetText(B.page);
  ok('the preview says what it is and who shared it', /Add this booking\?/.test(pv) && /Harbour Brewing brand film/.test(pv) && /Shared by Pat Producer · Quay Films/.test(pv));
  ok('…and lists what will be added: when, place, venue, call sheet, crew, contacts, scenes, shots, deliverables', /When/.test(pv) && /07:30–17:00/.test(pv) && /12 Dock Road, Portside/.test(pv) && new RegExp(`“${seed.venue}” goes into your Venues`).test(pv) && /general call 07:30, lunch 12:30, wrap 18:00, 2 schedule lines/.test(pv) && /3 people \(Sam Rivera, Jo Chen, Dee Driver\), kept on this booking/.test(pv) && /2 contacts on the booking \(Pat Producer, Ana Ruiz\)/.test(pv) && /2 scenes and 1 banner on its stripboard, over 1 shooting day/.test(pv) && /2 shots/.test(pv) && /Main cut 9:16/.test(pv), pv.replace(/\s+/g, ' ').slice(0, 300));
  ok('…with the crew kept on the booking, not put on the Crew list, and no prices', /not added to your Crew list/.test(pv) && /never carries prices/.test(pv) && !/450|2500|9876|Q-0099|£|\$/.test(pv));
  ok('nothing is added before the tap', (await db(B.page)).bookings.length === 0 && (await db(B.page)).venues.length === 0);
  const pvFits = await B.page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return { page: document.documentElement.scrollWidth <= innerWidth, sheet: s.left >= 0 && s.right <= innerWidth, hit: [...document.querySelectorAll('.sheet .add-actions .btn')].every(b => b.getBoundingClientRect().height >= 44), modal: document.querySelector('.sheet').getAttribute('aria-modal') === 'true' && document.getElementById('app').inert }; });
  ok('the preview is a dialog that fits a 360-pixel phone, with full-size Add and Cancel', pvFits.page && pvFits.sheet && pvFits.hit && pvFits.modal, JSON.stringify(pvFits));
  await sleep(400); await B.page.screenshot({ path: OUT + '/share-add-booking-360.png' });
  await B.page.locator('.sheet button:has-text("Cancel")').click(); await sleep(300);
  const afterCancel = await B.page.evaluate(() => ({ sheets: document.querySelectorAll('.sheet').length, parked: sessionStorage.getItem('vdex-add') }));
  ok('Cancel adds nothing, and the link is not kept for later', (await db(B.page)).bookings.length === 0 && afterCancel.sheets === 0 && afterCancel.parked === null, JSON.stringify(afterCancel));
  await B.page.reload(); await B.page.waitForSelector('#rolodex .drum-btn'); await sleep(900);
  ok('…so it does not come back on the next start', (await B.page.locator('.sheet').count()) === 0);

  await viaPage(B.page, link1);
  await B.page.locator('.sheet button:has-text("Add to my Bookings")').click();
  await B.page.waitForSelector('.bk-detail', { timeout: 8000 }); await sleep(400);
  const d1 = await db(B.page), bk = d1.bookings[0];
  ok('Add puts it in Bookings and opens it', d1.bookings.length === 1 && /Harbour Brewing brand film/.test(await B.page.locator('.bk-detail .hero h2').innerText()));
  ok('…marked with where it came from', /Shared by Pat Producer · Quay Films/.test(await B.page.locator('.bk-detail .hero .shared-by').innerText()) && bk.shared.ref === seed.id && bk.id !== seed.id);
  ok('the dates, times, type and client are the shoot’s', bk.date === day(3) && bk.endDate === day(4) && bk.start === '07:30' && bk.end === '17:00' && bk.type === 'vertical' && bk.client === 'Harbour Brewing Co.' && bk.status === 'Confirmed', JSON.stringify([bk.date, bk.endDate, bk.start, bk.end, bk.type, bk.status]));
  const vn = d1.venues[0];
  ok('the place comes as a venue of its own with access, parking, power, the hospital and the rules, and the booking uses it', d1.venues.length === 1 && bk.venueId === vn.id && vn.name === seed.venue && bk.address === '12 Dock Road, Portside' && /Load-in 7am/.test(vn.access) && vn.parking === 'Loading bay for 30 min' && vn.power === '2 x 16A at the bar' && /Portside General/.test(vn.hospital) && /No filming of customers/.test(vn.rules) && vn.shared.ref === seed.id, JSON.stringify(vn).slice(0, 200));
  const cs = bk.callSheet;
  ok('the call sheet has the call, lunch, wrap, schedule by day, dress, weather, emergency contact, who is on set and the instructions', cs.generalCall === '07:30' && cs.lunch === '12:30' && cs.wrap === '18:00' && cs.schedule.length === 2 && cs.schedule[0].time === '08:00' && cs.schedule[0].item === 'First set-up on the quay' && cs.schedule[1].date === day(4) && cs.dress === 'Warm layers' && cs.weather === 'Dry, cold' && cs.emergency === 'Site medic 555 0111' && cs.attendees === 'Talent arrives 09:00' && cs.notes === 'Bring a head torch');
  ok('…and the approved break', bk.breakMinutes === 45 && bk.breakNote === 'lunch on the quay');
  const hires = bk.hires || [];
  ok('the shared crew are the booking’s own people, each with their call time, and none of them is on the Crew list', hires.length === 3 && hires.map(h => h.name).join() === 'Sam Rivera,Jo Chen,Dee Driver' && hires[0].role === 'Sound Recordist' && hires[0].phone === '+1 555 0101' && hires[0].email === 'sam@example.com' && bk.crewCall[hires[0].id] === '07:00' && bk.crewCall[hires[1].id] === '07:30' && d1.crew.length === 0 && bk.crew.length === 0, JSON.stringify(hires.map(h => [h.name, bk.crewCall[h.id]])));
  ok('the producer and the client’s contact are the booking’s contacts', bk.stakeholders.length === 2 && bk.stakeholders[0].name === 'Pat Producer' && bk.stakeholders[0].role === 'Producer · Quay Films' && bk.stakeholders[0].phone === '+44 20 7946 0100' && bk.stakeholders[0].email === 'pat@quayfilms.example' && bk.stakeholders[1].name === 'Ana Ruiz' && bk.stakeholders[1].email === 'ana@harbour.example');
  const strips = bk.board.list;
  ok('the scenes are on its stripboard, in their day, with the banner, the cast and the page counts', strips.map(x => x.type).join() === 'scene,banner,scene,break,break' && strips[0].scene === '1' && strips[0].ie === 'EXT' && strips[0].set === 'QUAY' && strips[0].eighths === 12 && strips[0].cast.join() === 'ANA,TOM' && strips[1].text === 'Company move' && strips[2].dn === 'N' && strips[2].eighths === 5 && bk.board.cast.join() === 'ANA,TOM', JSON.stringify(strips).slice(0, 200));
  ok('the shot list keeps its ticks, and the deliverables their due dates and state', bk.shots.length === 2 && bk.shots[0].text === 'Wide of the harbour at dawn' && bk.shots[1].done === true && bk.deliverables.length === 1 && bk.deliverables[0].name === 'Main cut 9:16' && bk.deliverables[0].due === day(4) && bk.deliverables[0].status === 'In progress' && bk.deliverables[0].link === '');
  ok('the producer’s equipment is not ticked on the booking: it is listed in the notes to read', bk.gear.length === 0 && /Equipment on this shoot/.test(bk.notes) && /Camera: Sony FX6 body/.test(bk.notes));
  const rawB = JSON.stringify(d1);
  ok('no money and nothing private came across: no rate, quote, budget, value, booking note, strip note or review link', !bk.quote && !bk.budget && hires.every(h => h.rate === '') && !/SECRET|Q-0099|private\.example|"(price|cost|value|budget|quote|invoice|actual)":/.test(rawB) && !/"rate":(?!"")/.test(rawB));
  ok('it can be edited like any booking', await (async () => { await B.page.locator('.bk-detail .page-head button', { hasText: 'Edit' }).click(); await B.page.waitForSelector('.sheet form'); const v = await B.page.locator('.sheet form input[data-key="title"]').inputValue(); await B.page.keyboard.press('Escape'); await sleep(200); return v === 'Harbour Brewing brand film'; })());

  // ---- the same shoot again: an update, never a copy ----
  await B.page.evaluate(() => import('./js/store.js').then(s => s.update(d => {
    const x = d.bookings[0];
    x.status = 'Prepped'; x.notes = 'MY OWN NOTE\n\n' + x.notes; x.shots[0].done = true; x.shots.push({ id: 'mine', text: 'My own extra shot', done: false });
    x.hires.push({ id: 'myhire', name: 'My Own Assistant', role: 'Runner', rate: 100, rateUnit: 'day' }); x.hires[0].rate = 400; x.hires[0].notes = 'worked with Sam before';
    x.stakeholders.push({ name: 'My Own Contact', role: 'Driver', phone: '1' }); x.callSheet.schedule.push({ id: 'myrow', date: '', time: '06:00', item: 'My own early start' });
    x.deliverables[0].link = 'https://my.example/cut'; x.budget = { lines: [{ id: 'mb', cat: 'Travel & transport', desc: 'Train', qty: 1, unit: 'item', rate: 30 }], updatedAt: Date.now() }; x.updatedAt = Date.now();
  })));
  await A.page.evaluate(([id, d]) => import('./js/store.js').then(s => s.update(dd => {
    const x = dd.bookings.find(y => y.id === id);
    x.start = '06:45'; x.crew = [x.crew[0]]; x.crewCall = { [x.crew[0]]: '06:30' };
    x.shots = [...x.shots, { id: 's3', text: 'Drone over the breakwater', done: false }];
    x.callSheet = { ...x.callSheet, generalCall: '06:45', schedule: [{ id: 'r1', date: d, time: '07:15', item: 'First set-up on the quay' }] };
    x.stakeholders = [{ name: 'Ana Ruiz', role: 'Head of marketing', phone: '+1 555 0200', email: 'ana@harbour.example' }]; x.updatedAt = Date.now();
  })), [seed.id, day(3)]);
  const link2 = await crewLink();
  await viaPage(B.page, link2);
  const pv2 = await sheetText(B.page);
  ok('adding the same shoot again offers an update and says what stays yours', /Update this booking\?/.test(pv2) && /is in your Bookings already/.test(pv2) && /Replaced: each of these while it is still as the link left it/.test(pv2) && /Stays: any of those details you changed yourself, and everything you added by hand/.test(pv2) && (await B.page.locator('.sheet button:has-text("Update the booking")').count()) === 1);
  await B.page.locator('.sheet button:has-text("Update the booking")').click();
  await B.page.waitForSelector('.bk-detail'); await sleep(400);
  const d2 = await db(B.page), b2 = d2.bookings[0];
  ok('…and updates the booking that was added before instead of making a copy', d2.bookings.length === 1 && b2.id === bk.id && d2.venues.length === 1 && b2.start === '06:45' && b2.callSheet.generalCall === '06:45', `${d2.bookings.length} bookings, ${d2.venues.length} venues`);
  ok('…taking what the link now holds: the new shot, the new call time, the moved schedule line, the contact’s new number, and one person fewer', b2.shots.some(s => s.text === 'Drone over the breakwater') && b2.hires.filter(h => h.shared).map(h => h.name).join() === 'Sam Rivera,Dee Driver' && b2.crewCall[b2.hires[0].id] === '06:30' && b2.callSheet.schedule.filter(r => r.shared).length === 1 && b2.callSheet.schedule[0].time === '07:15' && b2.stakeholders.find(s => s.name === 'Ana Ruiz').phone === '+1 555 0200', JSON.stringify(b2.hires.map(h => h.name)));
  ok('…while keeping what was added by hand: the stage, a tick, an extra shot, a hired person, a contact, a schedule line, a note, a rate, a delivery link and the budget', b2.status === 'Prepped' && b2.shots.find(s => s.text === 'Wide of the harbour at dawn').done === true && b2.shots.some(s => s.id === 'mine') && b2.hires.some(h => h.id === 'myhire') && b2.hires[0].id === hires[0].id && b2.hires[0].rate === 400 && b2.hires[0].notes === 'worked with Sam before' && b2.stakeholders.some(s => s.name === 'My Own Contact') && b2.callSheet.schedule.some(r => r.id === 'myrow') && /MY OWN NOTE/.test(b2.notes) && (b2.notes.match(/Equipment on this shoot/g) || []).length === 1 && b2.deliverables[0].link === 'https://my.example/cut' && b2.budget.lines[0].desc === 'Train');
  ok('…and the page says it was updated', /updated/.test(await B.page.locator('.bk-detail .hero .shared-by').innerText()));

  // the sender's own link, in the sender's own Vdex
  await A.page.goto(BASE + 'index.html#add=' + hashOf(link2)); await A.page.waitForSelector('.sheet');
  ok('one’s own link has nothing to add: the booking is already there, and there is no Add button', /This booking is yours/.test(await sheetText(A.page)) && /this link was made from it, so there is nothing to add/.test(await sheetText(A.page)) && (await A.page.locator('.sheet .add-actions').count()) === 0 && (await db(A.page)).bookings.filter(x => x.title === 'Harbour Brewing brand film').length === 1);
  await A.page.keyboard.press('Escape'); await sleep(200);

  /* ============================== a contact card ============================== */
  await A.page.evaluate(() => window.logiGo('me')); await A.page.waitForSelector('#page .qr svg', { timeout: 8000 });
  const readQr = page => page.evaluate(async () => {
    const svg = document.querySelector('#page .qr svg'); if (!svg) return '';
    const jsQR = await (await import('./js/qr.js')).loadJsQR(), img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg)); await img.decode();
    const c = document.createElement('canvas'); c.width = c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 900); g.drawImage(img, 0, 0, 900, 900);
    const r = jsQR(g.getImageData(0, 0, 900, 900).data, 900, 900); return r ? r.data : '';
  });
  const qrCard = await readQr(A.page);
  const cardLink = await A.page.evaluate(() => import('./js/share-out.js').then(m => m.contactLink()));
  ok('the Me page’s usual QR code is now a link to the contact card’s page', (await A.page.locator('#page .me-modes button.on').innerText()) === 'Contact card' && qrCard === cardLink && cardLink.startsWith(BASE + 'shared.html#'), qrCard.slice(0, 60));
  await A.page.locator('#page .me-modes button', { hasText: 'Phone contacts' }).click(); await A.page.waitForSelector('#page .qr svg'); await sleep(300);
  const qrV = await readQr(A.page);
  ok('the plain vCard code is still there as a choice, for a phone’s own contacts', /^BEGIN:VCARD/.test(qrV) && /FN:Pat Producer/.test(qrV) && /TEL;TYPE=CELL:\+44 20 7946 0100/.test(qrV) && (await A.page.evaluate(() => document.activeElement && document.activeElement.textContent)) === 'Phone contacts', qrV.slice(0, 40));
  await A.page.locator('#page .me-modes button', { hasText: 'Website' }).click(); await A.page.waitForSelector('#page .qr svg'); await sleep(300);
  ok('…and so is the website code', (await readQr(A.page)) === 'https://quayfilms.example');
  await A.page.locator('#page .me-modes button', { hasText: 'Contact card' }).click(); await sleep(300);
  await A.page.locator('#page button', { hasText: 'My card’s link' }).click(); await A.page.waitForSelector('.sheet textarea.share-link');
  ok('the card’s link can be copied, shared or emailed instead of showing the code', (await A.page.locator('.sheet textarea.share-link').inputValue()) === cardLink && (await A.page.locator('.sheet .actions .btn').allInnerTexts()).join('|') === '📋 Copy link|📤 Share…|✉ Email it|Open preview' && decodeURIComponent(await A.page.locator('.sheet a:has-text("Email it")').getAttribute('href')).includes(cardLink) && /anyone who has the link can read it/i.test(await sheetText(A.page)));
  await A.page.keyboard.press('Escape'); await sleep(200);
  const cardSnap = await A.page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), cardLink);
  ok('the card carries the name, title, business, phone, email, website and home town, and nothing else', JSON.stringify(Object.keys(cardSnap).sort()) === JSON.stringify(['business', 'email', 'kind', 'location', 'name', 'phone', 'title', 'v', 'website']) && cardSnap.kind === 'contact', Object.keys(cardSnap).join());

  await B.page.goto(cardLink); await B.page.waitForSelector('.paper.card h1');
  const card = await B.page.locator('.paper').innerText();
  ok('the card’s page shows the details to anyone, with no Vdex needed', (await B.page.locator('.terms-gate').count()) === 0 && /Pat Producer/.test(card) && /Producer \/ DOP · Quay Films/.test(card) && /Portside/.test(card));
  ok('…with the phone, email and website as links', (await B.page.locator('.paper a[href="tel:+442079460100"]').count()) === 1 && (await B.page.locator('.paper a[href="mailto:pat@quayfilms.example"]').count()) === 1 && (await B.page.locator('.paper a[href="https://quayfilms.example/"]').count()) === 1);
  const cardFits = await B.page.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth, hit: [...document.querySelectorAll('.bar .btn')].every(b => b.getBoundingClientRect().height >= 44) }));
  ok('…fitting a 360-pixel phone with full-size buttons', cardFits.page && cardFits.hit, JSON.stringify(cardFits));
  await B.page.screenshot({ path: OUT + '/share-card-page-360.png', fullPage: true });
  const [vcf] = await Promise.all([B.page.waitForEvent('download', { timeout: 8000 }), B.page.locator('button:has-text("Save to my contacts (.vcf)")').click()]);
  const vcfText = fs.readFileSync(await vcf.path(), 'utf8');
  ok('Save to my contacts (.vcf) downloads the card as a .vcf file, and does not claim this is a phone', /\.vcf$/.test(vcf.suggestedFilename()) && /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/.test(vcfText) && /\r\nFN:Pat Producer\r\n/.test(vcfText) && /\r\nN:Producer;Pat;;;\r\n/.test(vcfText) && /\r\nORG:Quay Films\r\n/.test(vcfText) && /\r\nTEL;TYPE=CELL:\+44 20 7946 0100\r\n/.test(vcfText) && /\r\nEMAIL:pat@quayfilms\.example\r\n/.test(vcfText) && /\r\nURL:https:\/\/quayfilms\.example\/\r\n/.test(vcfText) && /END:VCARD$/.test(vcfText), vcf.suggestedFilename());

  await viaPage(B.page, cardLink);
  const pc = await sheetText(B.page);
  ok('Add to my Vdex shows the card before adding it', /Add this contact\?/.test(pc) && /Pat Producer/.test(pc) && /\+44 20 7946 0100/.test(pc) && /pat@quayfilms\.example/.test(pc) && /goes into your Crew list/.test(pc) && (await db(B.page)).crew.length === 0);
  await B.page.locator('.sheet button:has-text("Add to my Crew")').click();
  await B.page.waitForSelector('.crew-card.just-added', { timeout: 8000 });
  const c1 = (await db(B.page)).crew;
  ok('Add puts the person on the Crew list and opens it there', c1.length === 1 && (await B.page.evaluate(() => window.logiPage())) === 'crew' && /Pat Producer/.test(await B.page.locator('.crew-card.just-added').innerText()));
  ok('…with their name, role, phone, email and website, and the business in the notes', c1[0].name === 'Pat Producer' && c1[0].role === 'Producer / DOP' && c1[0].phone === '+44 20 7946 0100' && c1[0].email === 'pat@quayfilms.example' && c1[0].link === 'https://quayfilms.example/' && /Business: Quay Films/.test(c1[0].notes) && /Based in: Portside/.test(c1[0].notes), JSON.stringify(c1[0]));
  await B.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { Object.assign(d.crew[0], { rate: 500, rateUnit: 'day', notes: d.crew[0].notes + '\nMY NOTE ABOUT PAT', updatedAt: Date.now() }); })));
  await A.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, phone: '+44 20 7946 0999', title: 'Director', updatedAt: Date.now() }; })));
  const cardLink2 = await A.page.evaluate(() => import('./js/share-out.js').then(m => m.contactLink()));
  await viaPage(B.page, cardLink2);
  ok('the same card again offers an update', /Update this contact\?/.test(await sheetText(B.page)) && /on your Crew list already/.test(await sheetText(B.page)));
  await B.page.locator('.sheet button:has-text("Update the contact")').click(); await B.page.waitForSelector('.crew-card.just-added'); await sleep(200);
  const c2 = (await db(B.page)).crew;
  ok('…and updates the person instead of adding another, keeping the rate and notes', c2.length === 1 && c2[0].id === c1[0].id && c2[0].phone === '+44 20 7946 0999' && c2[0].role === 'Director' && c2[0].rate === 500 && /MY NOTE ABOUT PAT/.test(c2[0].notes) && (c2[0].notes.match(/Business: Quay Films/g) || []).length === 1, JSON.stringify(c2[0]));

  /* ============================== equipment ============================== */
  await A.page.evaluate(() => window.logiGo('gear')); await sleep(400);
  await A.page.locator('#page .subactions button', { hasText: 'Share…' }).click(); await A.page.waitForSelector('.sheet .share-warn');
  const warn = await A.page.locator('.sheet .share-warn').innerText();
  ok('before anything is shared, a notice says serial numbers and values go with it', /Serial numbers and values go with it/.test(warn) && /service log and your bookings do not/.test(warn) && /anyone who has the link can read it/.test(warn) && (await A.page.locator('.sheet textarea.share-link').count()) === 0 && (await A.page.locator('.sheet .share-qr svg').count()) === 0);
  ok('…with the whole list, a kit or picked items to choose from, and the link made only on the button', (await A.page.locator('.sheet .seg button').allInnerTexts()).join() === 'Whole list,A kit,Pick items' && (await A.page.locator('.sheet .seg button[aria-pressed="true"]').innerText()) === 'Whole list' && /13 items, worth £\d/.test(await A.page.locator('.sheet .share-sum').innerText()));
  await sleep(400); await A.page.screenshot({ path: OUT + '/share-gear-sheet.png' });
  await A.page.locator('.sheet button:has-text("Make the link")').click();
  await A.page.waitForSelector('.sheet textarea.share-link'); await A.page.waitForSelector('.sheet .share-qr svg', { timeout: 8000 });
  const allLink = await A.page.locator('.sheet textarea.share-link').inputValue();
  const allSnap = await A.page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), allLink);
  const fx = allSnap.items.find(x => x.serial === 'FX6-120934');
  ok('the whole list is a link to the shared page, with copy, share, email and a QR code', allLink.startsWith(BASE + 'shared.html#') && allLink.length <= 2800 && (await A.page.locator('.sheet .actions .btn').allInnerTexts()).join('|') === '📋 Copy link|📤 Share…|✉ Email it|Open preview' && /^mailto:\?subject=Equipment%20list%20from%20Pat%20Producer&body=/.test(await A.page.locator('.sheet a:has-text("Email it")').getAttribute('href')));
  ok('…carrying everything that describes an item: name, category, serial, place, quantity, value, dates, service interval, firmware and notes', allSnap.kind === 'gear' && allSnap.items.length === 10 && fx && fx.name === 'Sony FX6 body' && fx.category === 'Camera' && fx.value === 9876 && fx.location === 'Flight case 1' && fx.purchased === '2024-03-01' && fx.warranty === '2027-03-01' && fx.serviceEvery === 12 && fx.firmware === '5.01' && /Spare battery plate/.test(fx.notes) && allSnap.items.find(x => /Aputure MC/.test(x.name)).qty === 4 && allSnap.kits.length === 2 && allSnap.currency === '£', JSON.stringify(fx));
  ok('…but never the service log, or which bookings use it', !JSON.stringify(allSnap).includes('SECRET SERVICE NOTE') && !('log' in fx) && !/Harbour|bookings/.test(JSON.stringify(allSnap)) && JSON.stringify(Object.keys(fx).sort()) === JSON.stringify(['category', 'firmware', 'location', 'name', 'notes', 'purchased', 'ref', 'serial', 'serviceEvery', 'value', 'warranty']), Object.keys(fx).join());
  await A.page.locator('.sheet .seg button', { hasText: 'A kit' }).click(); await sleep(200);
  ok('changing what is shared takes the old link away at once', (await A.page.locator('.sheet textarea.share-link').count()) === 0 && (await A.page.locator('.sheet .share-qr svg').count()) === 0 && (await A.page.evaluate(() => document.activeElement && document.activeElement.textContent)) === 'A kit');
  await A.page.locator('.sheet button:has-text("Make the link")').click(); await A.page.waitForSelector('.sheet textarea.share-link');
  const kitLink = await A.page.locator('.sheet textarea.share-link').inputValue();
  const kitSnap = await A.page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), kitLink);
  ok('a kit goes with its own items only, as a kit', kitSnap.title === seed.kitName && kitSnap.items.length === seed.kitGear && kitSnap.kits.length === 1 && kitSnap.kits[0].items.length === seed.kitGear && kitSnap.kits[0].items.some(p => p[1] === 2));
  await A.page.locator('.sheet .seg button', { hasText: 'Pick items' }).click(); await sleep(200);
  ok('picked items: nothing to share until something is ticked', await A.page.locator('.sheet button:has-text("Make the link")').isDisabled());
  await A.page.locator('.sheet .share-picks label.check', { hasText: 'Sony FX6 body' }).locator('input').check();
  await A.page.locator('.sheet .share-picks label.check', { hasText: 'Sigma 18-35mm' }).locator('input').check();
  await A.page.locator('.sheet button:has-text("Make the link")').click(); await A.page.waitForSelector('.sheet textarea.share-link');
  const pickSnap = await A.page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), await A.page.locator('.sheet textarea.share-link').inputValue());
  ok('…then just those items, with no kit', pickSnap.items.map(x => x.name).sort().join() === 'Sigma 18-35mm f/1.8,Sony FX6 body' && pickSnap.kits.length === 0);
  await A.page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes the sheet and the focus goes back to Share…', (await A.page.locator('.sheet').count()) === 0 && /Share…/.test(await A.page.evaluate(() => document.activeElement && document.activeElement.textContent)));
  // a list too long for a QR code
  await A.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { for (let i = 0; i < 60; i++) d.gear.push({ id: 'big' + i, name: 'Cable ' + i + ' ' + Math.random().toString(36).slice(2), category: 'Accessories', serial: 'SN' + Math.random().toString(36).slice(2, 12), qty: 1, value: 10 + i, notes: Math.random().toString(36).slice(2) }); })));
  await A.page.evaluate(() => window.logiGo('gear')); await sleep(300);
  await A.page.locator('#page .subactions button', { hasText: 'Share…' }).click(); await A.page.locator('.sheet button:has-text("Make the link")').click(); await A.page.waitForSelector('.sheet textarea.share-link'); await sleep(500);
  const longLink = await A.page.locator('.sheet textarea.share-link').inputValue();
  ok('a link too long for a QR code says so, and still offers copy, share and email (the long link is pasted into the email)', longLink.length > 2800 && (await A.page.locator('.sheet .share-qr svg').count()) === 0 && /too long for a QR code/.test(await A.page.locator('.sheet .share-qr').innerText()) && (await A.page.locator('.sheet .actions .btn').count()) === 4 && decodeURIComponent(await A.page.locator('.sheet a:has-text("Email it")').getAttribute('href')).includes('[Paste the link here]'), `${longLink.length} characters`);
  await A.page.keyboard.press('Escape'); await sleep(200);
  await A.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.gear = d.gear.filter(g => !/^big/.test(g.id)); })));

  // the workmate already owns the camera (the same serial number, written differently) and one item with no serial
  await B.page.goto(BASE); await B.page.waitForSelector('#rolodex .drum-btn');
  await B.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.gear.push({ id: 'mine1', name: 'My FX6', category: 'Camera', serial: 'fx6 120934', qty: 1, value: 5000, location: 'My shelf', notes: 'mine', log: [{ id: 'ml', date: '2026-02-02', kind: 'clean', note: 'my own log' }] }, { id: 'mine2', name: 'Sennheiser MKH 416', category: 'Audio', serial: '', qty: 1, value: 700, notes: '' }); })));
  await B.page.goto(kitLink); await B.page.waitForSelector('.paper h1');
  const gp = await B.page.locator('.paper').innerText();
  ok('the list’s page shows every item to read, with serial numbers, values and where each is kept, and who it is from', new RegExp(seed.kitName).test(gp) && /from Pat Producer · Quay Films/.test(gp) && /Sony FX6 body/.test(gp) && /Serial number FX6-120934/.test(gp) && /£9,876/.test(gp) && /Kept: Flight case 1/.test(gp) && /Service every 12 months/.test(gp) && /Firmware 5\.01/.test(gp) && /Spare battery plate/.test(gp) && /× 4/.test(gp), gp.slice(0, 160).replace(/\s+/g, ' '));
  ok('…the kit and what is in it, that it is a one-off copy, and buttons to print it and to add it', /Kit\b/i.test(gp) && /Aputure MC \(RGB pocket light\) × 2/.test(gp) && /one-off copy/.test(gp) && (await B.page.locator('.bar button:has-text("Print")').count()) === 1 && (await B.page.locator('.bar a:has-text("Add to my Vdex")').count()) === 1);
  const gearFits = await B.page.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth, hit: [...document.querySelectorAll('.bar .btn')].every(b => b.getBoundingClientRect().height >= 44) }));
  ok('…fitting a 360-pixel phone', gearFits.page && gearFits.hit, JSON.stringify(gearFits));
  await B.page.screenshot({ path: OUT + '/share-gear-page-360.png', fullPage: true });

  const before = (await db(B.page)).gear.length;
  await viaPage(B.page, kitLink);
  const pg = await sheetText(B.page);
  ok('the preview finds the duplicate by its serial number, whatever its spaces and capitals, and leaves it alone unless told otherwise', /Add this equipment\?/.test(pg) && /Already in your Equipment \(1\)/.test(pg) && /Same serial number as your “My FX6”/.test(pg) && (await B.page.locator('.sheet .add-dup select').inputValue()) === 'skip' && new RegExp(`New \\(${seed.kitGear - 1}\\)`).test(pg), pg.replace(/\s+/g, ' ').slice(0, 200));
  ok('…offers skip, update or add anyway, and says what will happen', (await B.page.locator('.sheet .add-dup select option').allInnerTexts()).join('|') === 'Skip it: leave mine as it is|Update mine with these details|Add anyway, as another item' && new RegExp(`${seed.kitGear - 1} to add · 1 left as it is`).test(await B.page.locator('.sheet .add-sum').innerText()) && new RegExp(`“${seed.kitName}” \\(${seed.kitGear} items\\) is made as a kit`).test(pg));
  ok('…a same-named item with no serial number is not taken for a duplicate', !/Same name/.test(pg));
  await sleep(400); await B.page.screenshot({ path: OUT + '/share-add-gear-360.png' });
  await B.page.locator('.sheet .add-go').click();
  await B.page.waitForSelector('.gear-card.just-added', { timeout: 8000 });
  const g1 = await db(B.page), mine = g1.gear.find(x => x.id === 'mine1'), kit1 = g1.kits[0];
  ok('skip: the new items are added and the one already owned is untouched', g1.gear.length === before + seed.kitGear - 1 && mine.name === 'My FX6' && mine.value === 5000 && mine.location === 'My shelf' && !mine.shared && (await B.page.evaluate(() => window.logiPage())) === 'gear' && (await B.page.locator('.gear-card.just-added').count()) === seed.kitGear - 1, `${g1.gear.length} items`);
  const mc = g1.gear.find(x => /Aputure MC/.test(x.name)), lens = g1.gear.find(x => /24-70/.test(x.name));
  ok('…each with its details, and none with a service log', mc.qty === 4 && mc.value === 125 && mc.category === 'Lighting' && mc.location === 'Van' && lens.value === 2300 && g1.gear.filter(x => x.shared).every(x => !x.log && x.shared.by === 'Pat Producer · Quay Films'));
  ok('the kit is made again as a kit, with the owned camera standing in for the skipped one and the quantities kept', g1.kits.length === 1 && kit1.name === seed.kitName && kit1.gear.length === seed.kitGear && kit1.gear.includes('mine1') && kit1.gearQty[mc.id] === 2 && /reflector/.test(kit1.notes), JSON.stringify(kit1.gearQty));

  await viaPage(B.page, kitLink);
  const pg2 = await sheetText(B.page);
  ok('the same list again: what was added before is found and set to update, nothing is new', new RegExp(`Already in your Equipment \\(${seed.kitGear}\\)`).test(pg2) && /Added from this list before/.test(pg2) && !/New \(/.test(pg2) && new RegExp(`${seed.kitGear - 1} to update · 1 left as it is`).test(await B.page.locator('.sheet .add-sum').innerText()) && /is updated/.test(pg2));
  await B.page.locator('.sheet .add-dup', { hasText: 'Same serial number' }).locator('select').selectOption('update');
  ok('…choosing Update for the duplicate changes the count', new RegExp(`${seed.kitGear} to update`).test(await B.page.locator('.sheet .add-sum').innerText()));
  await B.page.locator('.sheet .add-go').click(); await B.page.waitForSelector('.gear-card.just-added'); await sleep(200);
  const g2 = await db(B.page), mine2 = g2.gear.find(x => x.id === 'mine1');
  ok('update: no copies are made, the owned camera takes the list’s details and keeps its own service log, and the kit is not doubled', g2.gear.length === g1.gear.length && g2.kits.length === 1 && mine2.name === 'Sony FX6 body' && mine2.value === 9876 && mine2.location === 'Flight case 1' && mine2.serial === 'FX6-120934' && mine2.log.length === 1 && mine2.log[0].note === 'my own log', `${g2.gear.length} items, ${g2.kits.length} kits`);

  await viaPage(B.page, kitLink);
  await B.page.locator('.sheet .add-all select').selectOption('skip');
  ok('one choice can be set for every duplicate at once', (await B.page.locator('.sheet .add-dup select').evaluateAll(els => els.every(s => s.value === 'skip'))) && new RegExp(`${seed.kitGear} left as they are`).test(await B.page.locator('.sheet .add-sum').innerText()));
  ok('…and with every item skipped there is nothing to do: the button says so and is off, and the kit that is already there stays as it is', (await B.page.locator('.sheet .add-go').innerText()) === 'Nothing to add' && await B.page.locator('.sheet .add-go').isDisabled() && /stays as it is: every item of it is skipped/.test(await B.page.locator('.sheet .add-kits').innerText()), await B.page.locator('.sheet .add-kits').innerText());
  await B.page.locator('.sheet .add-dup', { hasText: 'Sony FX6 body' }).locator('select').selectOption('add');
  ok('…one item set to Add anyway names the button after it, and the kit it is in is updated again', (await B.page.locator('.sheet .add-go').innerText()) === 'Add 1 item to my Equipment' && !(await B.page.locator('.sheet .add-go').isDisabled()) && /is updated$/.test(await B.page.locator('.sheet .add-kits').innerText()));
  await B.page.locator('.sheet .add-go').click(); await B.page.waitForSelector('.gear-card.just-added'); await sleep(200);
  const g3 = await db(B.page);
  ok('add anyway: the item is added as another one beside the one already there', g3.gear.length === g2.gear.length + 1 && g3.gear.filter(x => x.serial === 'FX6-120934').length === 2 && (await B.page.locator('.gear-card.just-added').count()) === 1);
  const plans = await B.page.evaluate(() => import('./js/gear-import.js').then(m => {
    const own = [{ id: 'a', name: 'Tripod', category: 'Support', serial: 'AB-12 34' }, { id: 'b', name: 'Reflector', category: 'Lighting', serial: '' }];
    const rows = [{ name: 'Sticks', serial: 'ab1234' }, { name: 'reflector ', category: 'lighting' }, { name: 'Brand new' }, { name: '' }];
    const p = (o = {}) => m.planGearImport(rows, { existing: own, ...o }).rows.map(r => [r.why, r.action, r.match && r.match.id]);
    return { def: p(), names: p({ matchNames: true, onName: 'update', onSerial: 'update' }), counts: m.planCounts(m.planGearImport(rows, { existing: own })) };
  }));
  ok('the matching is one reusable piece: serials match whatever their spaces, hyphens and capitals; names only when asked; rows without a name are left out', JSON.stringify(plans.def) === JSON.stringify([['serial', 'skip', 'a'], ['', 'add', null], ['', 'add', null]]) && JSON.stringify(plans.names) === JSON.stringify([['serial', 'update', 'a'], ['name', 'update', 'b'], ['', 'add', null]]) && JSON.stringify(plans.counts) === JSON.stringify({ add: 2, update: 0, skip: 1 }), JSON.stringify(plans));

  /* ============================== survives sync, backup and restore ============================== */
  const kept = await B.page.evaluate(() => import('./js/store.js').then(s => {
    const copy = JSON.parse(s.serialize()), other = JSON.parse(s.serialize());
    other.bookings[0].checks = { 'x:t': 1 }; other.bookings[0].updatedAt = Date.now() + 5000; // another device edits the booking later
    const m = s.mergeDb(copy, other), b = m.bookings[0];
    s.replaceAll(JSON.parse(s.exportJSON())); // a backup restored
    const r = s.db.bookings[0];
    return { merged: !!(b.shared && b.shared.ref && b.hires.some(h => h.shared) && b.checks['x:t']), gear: m.gear.filter(g => g.shared && g.shared.ref).length, restored: !!(r.shared && r.shared.ref && r.shots.some(x => x.shared)) && s.db.gear.some(g => g.shared) && !!s.db.crew[0].shared && !!s.db.kits[0].shared };
  }));
  ok('where a record came from survives the record-by-record merge, a backup and a restore', kept.merged && kept.gear >= 6 && kept.restored, JSON.stringify(kept));

  /* ============================== add from a link ============================== */
  await B.page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await B.page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await sleep(300);
  const entries = {};
  for (const tab of ['bookings', 'crew', 'gear']) { await B.page.evaluate(t => window.logiGo(t), tab); await sleep(400); entries[tab] = await B.page.locator('#page button', { hasText: 'Add from a link' }).count(); }
  ok('Bookings, Crew and Equipment each have Add from a link', entries.bookings === 1 && entries.crew === 1 && entries.gear === 1, JSON.stringify(entries));
  await B.page.evaluate(() => window.logiGo('crew')); await sleep(400);
  await B.page.locator('#page button', { hasText: 'Add from a link' }).click(); await B.page.waitForSelector('.sheet textarea');
  await sleep(200);
  ok('it asks for the link, with the box focused, and offers to scan a QR code with the camera', (await B.page.evaluate(() => document.activeElement && document.activeElement.tagName)) === 'TEXTAREA' && (await B.page.locator('.sheet button:has-text("Scan a QR code")').count()) === 1 && /before anything is added/.test(await sheetText(B.page)));
  await B.page.locator('.sheet button:has-text("Show what it holds")').click(); await sleep(200);
  ok('an empty box says what to do', /Paste the link first/.test(await B.page.locator('.sheet [role=alert]').innerText()));
  await B.page.locator('.sheet textarea').fill('https://example.com/not-a-vdex-link'); await B.page.locator('.sheet button:has-text("Show what it holds")').click(); await sleep(300);
  ok('something that is not a Vdex link is refused in plain words, and the sheet stays', /does not look like a Vdex link/.test(await B.page.locator('.sheet [role=alert]').innerText()) && (await B.page.locator('.sheet textarea').count()) === 1);
  const invoiceLink = await A.page.evaluate(id => import('./js/money.js').then(m => m.shareLink({ id }, 'quote')), seed.id);
  await B.page.locator('.sheet textarea').fill(invoiceLink); await B.page.locator('.sheet button:has-text("Show what it holds")').click(); await sleep(400);
  ok('a quote or invoice link is recognised, and politely not added', /quote or invoice link/.test(await B.page.locator('.sheet [role=alert]').innerText()));
  // a link an email wrapped over several lines still reads
  await B.page.locator('.sheet textarea').fill(cardLink2.replace(/(.{60})/g, '$1\n')); await B.page.locator('.sheet button:has-text("Show what it holds")').click();
  await B.page.waitForSelector('.sheet .add-preview');
  ok('a pasted link (even one an email broke over several lines) leads to the same preview', /Update this contact\?/.test(await sheetText(B.page)) && (await B.page.locator('.sheet').count()) === 1);
  await B.page.keyboard.press('Escape'); await sleep(200);
  await B.page.locator('#page button', { hasText: 'Add from a link' }).click(); await B.page.waitForSelector('.sheet textarea');
  await B.page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes it and the focus goes back to the button', (await B.page.locator('.sheet').count()) === 0 && /Add from a link/.test(await B.page.evaluate(() => document.activeElement && document.activeElement.textContent)));

  /* ============================== hostile and oversized links ============================== */
  const pack = o => A.page.evaluate(x => import('./js/link-pack.js').then(m => m.pack(x)), o);
  const XSS = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  const evilCrew = await pack({ v: 1, kind: 'crew', ref: 'evil-1', made: 1e99, title: XSS + 'T'.repeat(5000), type: 'Not a type', date: '2026-12-01', endDate: '2199-01-01', start: '25:99', end: ['17:00'],
    budget: { lines: [{ rate: 99999 }] }, quote: { number: 'EVIL-1' }, status: 'Archived', id: 'forced-id', crew: [{ name: XSS, role: { a: 1 }, phone: 'x'.repeat(999), email: 'a@b.example?bcc=spy@evil.example&body=hi', rate: 999, call: 'whenever' }, 'not a person', ...Array.from({ length: 3000 }, (_, i) => ({ name: 'P' + i }))],
    by: { name: XSS, email: 'javascript:alert(1)' }, call: 'not an object', location: { venue: XSS, address: 'A'.repeat(99999), rules: 7 }, schedule: { length: 5 }, shots: [{ text: XSS, done: 'yes' }], kit: [{ name: 'K', qty: -5 }], scenes: [{ n: 999999, items: [{ scene: XSS, kind: 'sb-evil" onload="x', pages: 'lots' }] }], deliverables: [{ name: 'D', due: '2026-99-99', status: XSS }], notes: null, constructor: { prototype: { polluted: 1 } } });
  const H = await open({ width: 360, height: 740 });
  await H.page.goto(BASE + 'index.html#add=' + evilCrew); await H.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  const hv = await H.page.evaluate(() => ({ pwned: window.__pwned, imgs: document.querySelectorAll('.sheet img, .sheet script').length, title: document.querySelector('.sheet .add-title').textContent, polluted: {}.polluted, fits: document.documentElement.scrollWidth <= innerWidth }));
  ok('a hostile booking link is shown as plain text: nothing in it runs or becomes an element', hv.pwned === undefined && hv.imgs === 0 && hv.title.startsWith('<img src=x') && hv.title.length === 200 && hv.polluted === undefined && hv.fits, JSON.stringify(hv).slice(0, 160));
  await H.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await H.page.waitForSelector('.bk-detail'); await sleep(300);
  const hd = await db(H.page), hb = hd.bookings[0];
  ok('…and added through the allow-list only: no budget, quote, forced id or stage, lists and texts cut to size, bad dates and times dropped', hd.bookings.length === 1 && !hb.budget && !hb.quote && hb.id !== 'forced-id' && hb.status === 'Confirmed' && hb.type === 'other' && hb.title.length === 200 && hb.hires.length === 400 && hb.hires.every(h => h.rate === '' && h.phone.length <= 60) && hb.start === '' && hb.end === '' && !hb.endDate && hb.address.length === 600 && !hb.board && hb.deliverables[0].due === '' && hb.deliverables[0].status === 'Planned' && hb.shots[0].done === false && hb.shared.made === 0, JSON.stringify([hb.hires.length, hb.address.length, hb.status, hb.type, hb.endDate]));
  ok('…with an email address that smuggles in other recipients or a script dropped, and no page left broken', hb.hires[0].email === '' && hb.stakeholders[0].email === '' && (await H.page.evaluate(() => window.__pwned)) === undefined && (await H.page.locator('.bk-detail img[src="x"]').count()) === 0 && /Type: Not a type/.test(hb.notes));
  const evilCard = await pack({ v: 1, kind: 'contact', name: XSS, title: 'x', phone: '+1 (555) 000<script>', email: 'x@y.example\r\nBcc: spy@evil.example', website: 'javascript:alert(document.domain)', location: 'L\r\nEND:VCARD\r\nBEGIN:VCARD' });
  await H.page.goto(BASE + 'shared.html#' + evilCard); await H.page.waitForSelector('.paper.card h1');
  const hc = await H.page.evaluate(() => ({ pwned: window.__pwned, bad: document.querySelectorAll('.paper img, .paper script, .paper a[href^="javascript"]').length, links: [...document.querySelectorAll('.paper a')].map(a => a.getAttribute('href')), name: document.querySelector('.paper h1').textContent }));
  ok('a hostile card’s page draws text only: no script, no javascript: link, no smuggled email header', hc.pwned === undefined && hc.bad === 0 && hc.name.startsWith('<img src=x') && hc.links.join() === 'tel:+1555000', JSON.stringify(hc.links));
  const [evilVcf] = await Promise.all([H.page.waitForEvent('download', { timeout: 8000 }), H.page.locator('button:has-text("Save to my contacts (.vcf)")').click()]);
  const evilText = fs.readFileSync(await evilVcf.path(), 'utf8');
  ok('…and its .vcf file is one card with nothing slipped in', (evilText.match(/^BEGIN:VCARD/gm) || []).length === 1 && (evilText.match(/^END:VCARD/gm) || []).length === 1 && !/^URL:/m.test(evilText) && !/^EMAIL:/m.test(evilText) && !/^Bcc/mi.test(evilText), evilText.replace(/\r\n/g, ' | ').slice(0, 200));
  // a few thousand characters that unpack into megabytes, and a link far longer than any honest one
  const bomb = await pack({ v: 1, kind: 'gear', items: [{ name: 'A'.repeat(6e6) }] });
  await H.page.goto(BASE + 'index.html#add=' + bomb); await H.page.waitForSelector('.sheet', { timeout: 15000 });
  ok(`an oversized link (${bomb.length} characters that unpack into 6 MB) is refused in plain words, and nothing is added`, bomb.length < 20000 && /Nothing was added/.test(await sheetText(H.page)) && /far more than a shared booking, contact or equipment list would/.test(await sheetText(H.page)) && (await db(H.page)).gear.length === 0 && (await H.page.evaluate(() => location.hash + '|' + sessionStorage.getItem('vdex-add'))) === '|null');
  await H.page.keyboard.press('Escape'); await sleep(200);
  const tooLong = await H.page.evaluate(() => import('./js/share-data.js').then(m => m.readShared('https://vdex.crowmade.app/shared.html#1.' + 'A'.repeat(500000)).then(() => 'read', e => e.code)));
  ok('…and so is one too long to be a real link, before anything is unpacked', tooLong === 'big', tooLong);
  await H.page.goto(BASE + 'index.html#add=' + await pack({ v: 7, kind: 'storyboard', frames: [1, 2, 3] })); await H.page.waitForSelector('.sheet', { timeout: 15000 });
  ok('a kind this version does not know is turned down politely', /does not know/.test(await sheetText(H.page)) && /update Vdex and try again/.test(await sheetText(H.page)) && (await db(H.page)).bookings.length === 1);
  await H.page.keyboard.press('Escape'); await sleep(200);
  await H.page.goto(BASE + 'index.html#add=' + await pack({ v: 9, kind: 'contact', name: 'Future Fay', phone: '123456', hologram: { x: 1 } })); await H.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('a link from a newer version is read as far as this version understands, and says so', /Future Fay/.test(await sheetText(H.page)) && /newer version of Vdex/.test(await sheetText(H.page)));
  await H.page.locator('.sheet button:has-text("Add to my Crew")').click(); await H.page.waitForSelector('.crew-card.just-added');
  ok('…and what it adds has no unknown fields', !('hologram' in (await db(H.page)).crew[0]));
  await H.page.goto(BASE + 'index.html#add=1.garbage'); await H.page.waitForSelector('.sheet', { timeout: 15000 });
  ok('a damaged link says so', /incomplete or damaged/.test(await sheetText(H.page)));
  await H.page.goto(BASE + 'shared.html#1.garbage'); await sleep(600);
  ok('…on the shared page too, as does a link with nothing in it', /does not open/.test(await H.page.locator('#doc').innerText()) && /incomplete or damaged/.test(await H.page.locator('#doc').innerText()) && await (async () => { await H.page.goto(BASE + 'shared.html'); await sleep(500); return /nothing in it/.test(await H.page.locator('#doc').innerText()); })());
  await H.page.goto(BASE + 'shared.html#' + hashOf(link1)); await H.page.waitForSelector('.paper h1'); await sleep(200);
  ok('a shoot’s link opened on the wrong page finds its own page', /crew\.html#/.test(H.page.url()) && /Harbour Brewing brand film/.test(await H.page.locator('.paper h1').innerText()));
  await H.ctx.close();

  /* ============================== read-only ============================== */
  const ended = { enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, trialEnds: '2026-10-01', seats: 3 };
  const R = await open({ init: `window.vdexDesktop = { platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({ status: 'current' }), onStatus: () => () => {},
    licence: { state: async () => (${JSON.stringify(ended)}), enter: async () => ({ error: 'no' }), recheck: async () => (${JSON.stringify(ended)}), release: async () => (${JSON.stringify(ended)}), code: async () => '', buy: async () => true, onChange: () => () => {} } };` });
  await R.page.goto(BASE + 'index.html#add=' + hashOf(cardLink)); await R.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('read-only (the trial is over, no licence): the shared card can still be looked at', /Add this contact\?/.test(await sheetText(R.page)));
  await R.page.locator('.sheet button:has-text("Add to my Crew")').click(); await R.page.waitForSelector('.sheet.licence-readonly', { timeout: 8000 });
  ok('…but Add is refused with the usual explanation, nothing is added, and the preview stays', /Vdex is read-only/.test(await R.page.locator('.sheet.licence-readonly').innerText()) && (await db(R.page)).crew.length === 0 && (await R.page.locator('.sheet .add-preview').count()) === 1 && (await R.page.locator('.toast').count()) === 0);
  await R.page.keyboard.press('Escape'); await sleep(200); await R.page.keyboard.press('Escape'); await sleep(200);
  await R.page.goto(BASE + 'index.html#add=' + hashOf(kitLink)); await R.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  await R.page.locator('.sheet .add-go').click(); await R.page.waitForSelector('.sheet.licence-readonly', { timeout: 8000 });
  const noGear = (await db(R.page)).gear.length === 0 && (await db(R.page)).kits.length === 0;
  await R.page.keyboard.press('Escape'); await sleep(200); await R.page.keyboard.press('Escape'); await sleep(200);
  ok('…the same for equipment and for a booking', noGear && (await R.page.locator('.sheet').count()) === 0 && await (async () => { await R.page.goto(BASE + 'index.html#add=' + hashOf(link1)); await R.page.waitForSelector('.sheet .add-preview', { timeout: 15000 }); await R.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await R.page.waitForSelector('.sheet.licence-readonly', { timeout: 8000 }); const d = await db(R.page); return d.bookings.length === 0 && d.venues.length === 0; })());
  await R.ctx.close();
  // on a trial with no licence, adding needs none (it is not an export or a cloud feature)
  const T = await open({ init: `window.vdexDesktop = { platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({ status: 'current' }), onStatus: () => () => {},
    licence: { state: async () => ({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 20, trialEnds: '2026-12-08', seats: 3 }), enter: async () => ({ error: 'no' }), recheck: async () => ({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 20, seats: 3 }), release: async () => ({}), code: async () => '', buy: async () => true, onChange: () => () => {} } };` });
  await T.page.goto(BASE + 'index.html#add=' + hashOf(cardLink)); await T.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  await T.page.locator('.sheet button:has-text("Add to my Crew")').click(); await T.page.waitForSelector('.crew-card.just-added', { timeout: 8000 });
  ok('during the trial, with no licence, shared things can be added: it needs none', (await db(T.page)).crew.length === 1 && (await T.page.locator('.sheet').count()) === 0);
  await T.ctx.close();

  /* ============================== arriving while Vdex is not ready ============================== */
  // locked by a PIN
  const L = await open();
  await L.page.goto(BASE); await L.page.waitForSelector('#rolodex .drum-btn');
  await L.page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810'))); await L.page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
  await L.page.goto(BASE + 'index.html#add=' + hashOf(cardLink)); await L.page.waitForSelector('.lock', { timeout: 15000 }); await sleep(900);
  const locked = await L.page.evaluate(() => ({ hash: location.hash, sheets: document.querySelectorAll('.sheet').length, plain: localStorage.getItem('logi-db-v1') }));
  ok('a link that arrives while Vdex is locked waits behind the PIN: no preview, nothing readable, and the link already out of the address bar', locked.hash === '' && locked.sheets === 0 && locked.plain === null, JSON.stringify(locked));
  for (const d of '246810') await L.page.locator(`.lock .key[aria-label="${d}"]`).click();
  await L.page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 30000 });
  await L.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('…and its preview opens once the PIN is in', /Add this contact\?/.test(await sheetText(L.page)) && (await db(L.page)).crew.length === 0);
  await L.page.locator('.sheet button:has-text("Add to my Crew")').click(); await L.page.waitForSelector('.crew-card.just-added', { timeout: 8000 });
  ok('…and adding then works as usual', (await db(L.page)).crew.length === 1);
  await L.ctx.close();
  // still on the terms, then the first-run tour
  const N = await open({ terms: false, tour: false });
  await N.page.goto(BASE + 'index.html#add=' + hashOf(cardLink)); await N.page.waitForSelector('.terms-gate', { timeout: 15000 }); await sleep(700);
  ok('a link that arrives before the terms are agreed waits behind them, out of the address bar', (await N.page.locator('.sheet').count()) === 0 && (await N.page.evaluate(() => location.hash)) === '' && (await N.page.locator('#rolodex .drum-btn').count()) === 0);
  await N.page.locator('#terms-ok').check(); await N.page.locator('.terms-gate button:has-text("Agree and continue")').click();
  await N.page.waitForSelector('.tour-card', { timeout: 15000 }); await sleep(1200);
  ok('…and behind the first-run walkthrough', (await N.page.locator('.sheet').count()) === 0 && (await N.page.locator('.tour-card').count()) === 1);
  await N.page.locator('.tour-card button:has-text("Skip")').click();
  await N.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('…then opens its preview, and nothing was added on the way', /Add this contact\?/.test(await sheetText(N.page)) && (await db(N.page)).crew.length === 0);
  await N.page.locator('.sheet button:has-text("Add to my Crew")').click(); await N.page.waitForSelector('.crew-card.just-added', { timeout: 8000 });
  ok('…and adds on the tap', (await db(N.page)).crew.some(c => c.name === 'Pat Producer'));
  // a reload on the way (a sign-in page and back, say) does not lose a link that has not been shown yet
  await N.page.evaluate(() => { localStorage.removeItem('logi-tour'); });
  const N2 = watch(await N.ctx.newPage());
  await N2.goto(BASE + 'index.html#add=' + hashOf(kitLink)); await N2.waitForSelector('.tour-card', { timeout: 15000 }); await sleep(300);
  await N2.reload(); await N2.waitForSelector('.tour-card', { timeout: 15000 }); await sleep(300);
  await N2.locator('.tour-card button:has-text("Skip")').click(); await N2.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('a link not shown yet survives a reload of its tab', /Add this equipment\?/.test(await sheetText(N2)));
  await N.ctx.close();

  /* ============================== an update keeps what was changed and added by hand ============================== */
  // A shoot written out by hand, so each link differs from the last in known ways.
  const arrive = async (page, packed, what = '.sheet .add-preview') => { await page.goto(BASE + 'index.html#add=' + packed); await page.waitForSelector(what, { timeout: 15000 }); await sleep(150); };
  const shoot = (over = {}) => ({ v: 1, kind: 'crew', ref: 'REF-U1', made: Date.now(), title: 'Quay film', date: day(10), endDate: day(11), start: '09:00', end: '18:00', client: 'Northwind Ltd',
    by: { name: 'Pat Producer', business: 'Quay Films', phone: '+44 20 7946 0100', email: 'pat@quayfilms.example' },
    call: { general: '09:00', lunch: '13:00', wrap: '18:00', dress: 'Black', weather: 'Dry', emergency: 'Medic 555 0111', breaks: '45 min approved · lunch on the quay' },
    location: { venue: 'Quay House', address: '1 Quay Road, Portside', access: 'Gate B', parking: 'Bay 4', power: '16A', hospital: 'Portside General', rules: 'No drones' },
    schedule: [{ date: day(10), time: '10:00', item: 'First set-up' }],
    crew: [{ name: 'Anna Lee', role: 'Gaffer', phone: '+1 555 0100', email: 'anna@example.com', call: '08:30' }, { name: 'Sam Stone', role: 'Sound', phone: '', email: '', call: '09:00' }],
    contacts: [{ name: 'Carl Client', role: 'Marketing', phone: '+1 555 0142', email: 'carl@northwind.example' }], onSet: 'Client arrives 11:00',
    scenes: [{ n: 1, date: day(10), pages: '1 4/8', items: [{ scene: '1', ie: 'EXT', set: 'QUAY', tod: 'DAY', desc: 'Boats', cast: ['ANA'], pages: '1', kind: 'sb-ext-day' }, { banner: 'Company move' }, { scene: '2', ie: 'INT', set: 'OFFICE', tod: 'DAY', desc: 'Meeting', cast: ['ANA', 'TOM'], pages: '4/8', kind: 'sb-int-day' }] },
      { n: 2, date: day(11), pages: '1', items: [{ scene: '3', ie: 'INT', set: 'BAR', tod: 'NIGHT', desc: 'Last orders', cast: ['TOM'], pages: '1', kind: 'sb-int-night' }] }],
    shots: [{ text: 'Wide of the quay', done: false }], kit: [{ name: 'Sony FX6', cat: 'Camera', qty: 1 }, { name: 'Aputure 600d', cat: 'Lighting', qty: 2 }],
    deliverables: [{ name: 'Main film', duration: '90 s', due: day(20), status: 'Planned' }], notes: 'Park at the quay gate.', ...over });
  const U = await open();
  await U.page.goto(BASE); await U.page.waitForSelector('#rolodex .drum-btn');
  await arrive(U.page, await pack(shoot()));
  const upv = await sheetText(U.page);
  ok('the preview of a shared booking says who a quote or an invoice on it would go to: the person who shared it, not their client', /A quote or an invoice you make on it goes to Quay Films, who shared it with you, not to their client/.test(upv), upv.replace(/\s+/g, ' ').slice(-260));
  await U.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await U.page.waitForSelector('.bk-detail'); await sleep(300);
  const u1 = (await db(U.page)).bookings[0], ids1 = u1.board.list.map(x => x.id);
  ok('the booking remembers what the link supplied and which lines the link made', u1.shared.sent.client === 'Northwind Ltd' && u1.shared.sent.times === '09:00–18:00' && u1.shared.sent['cs.notes'] === 'Park at the quay gate.' && u1.shared.rows.strips.length === 4 && u1.shared.rows.hires.length === 2 && u1.shared.rows.deliverables.length === 1 && u1.shared.producer.business === 'Quay Films' && u1.breakMinutes === 45, JSON.stringify(u1.shared.sent).slice(0, 200));

  // ---- money on a booking that came from a link (the producer hired you) ----
  const bill = () => U.page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const b = s.db.bookings[0]; return { to: m.snapshot(b, 'invoice').to, mail: decodeURIComponent(m.mailtoFor(b, 'invoice', 'https://x.example/i').split('?')[0]), lines: m.suggestLines(b, 'invoice').map(l => l.desc), head: m.billTo(b).head }; }));
  await U.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings[0]; x.invoice = { number: 'INV-0007', date: x.date, lines: [{ id: 'l1', desc: 'Shoot day', qty: 1, unit: 'day', price: 500 }], status: 'Draft' }; x.stakeholders.push({ name: 'My Billing Contact', role: 'Accounts', email: 'accounts@quayfilms.example' }); x.updatedAt = Date.now(); })));
  const m1 = await bill();
  ok('an invoice on it is headed to the producer’s business, with the producer and a contact added by hand under it, and never the producer’s client or the client’s contact', m1.to[0] === 'Quay Films' && m1.to.length === 3 && /^Pat Producer · Producer · Quay Films · pat@quayfilms\.example$/.test(m1.to[1]) && /^My Billing Contact/.test(m1.to[2]) && !m1.to.join().includes('Carl') && !m1.to.join().includes('Northwind'), JSON.stringify(m1.to));
  ok('…and its email goes to the producer and that contact, not to the client’s contact', m1.mail === 'mailto:pat@quayfilms.example,accounts@quayfilms.example', m1.mail);
  ok('the producer’s crew are not suggested as lines of one’s own quote or invoice while they have no rate', !m1.lines.some(l => /^Crew:/.test(l)) && m1.lines.some(l => /^Shoot days/.test(l)), JSON.stringify(m1.lines));
  // a rate given through the form: the form writes the person anew, without the mark the link put on the line
  await U.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings[0], form = ({ shared, ...rest }, patch) => ({ ...rest, ...patch }); x.hires = x.hires.map(hr => (hr.name === 'Sam Stone' ? form(hr, { rate: 300, rateUnit: 'day', notes: 'worked with Sam before' }) : hr)); x.hires.push({ id: 'myhire', name: 'My Own Runner', role: 'Runner', rate: 120, rateUnit: 'day' }); x.updatedAt = Date.now(); })));
  const m2 = await bill();
  const budget = await U.page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { m.fillBudget(s.db.bookings[0]); return s.db.bookings[0].budget.lines.map(l => l.desc); }));
  ok('…one given a rate is, with the people one hired oneself; the budget follows the same rule', m2.lines.filter(l => /^Crew:/.test(l)).join('|') === 'Crew: Sam Stone (Sound)|Crew: My Own Runner (Runner)' && budget.length === 2 && budget.every(l => /Sam Stone|My Own Runner/.test(l)), JSON.stringify([m2.lines, budget]));

  // ---- by hand, the way the app's own pages write: forms write a line anew, the stripboard keeps only a strip's own fields ----
  await U.page.evaluate(() => import('./js/store.js').then(s => s.update(d => {
    const x = d.bookings[0], form = ({ shared, ...rest }, patch) => ({ ...rest, ...patch }), v = d.venues.find(y => y.id === x.venueId), l = x.board.list;
    x.client = 'Quay Films (my client)'; x.callSheet.notes += '\nMY NOTE: gate code 4411'; v.hospital = 'St Mary’s, 5 Hill Road'; v.updatedAt = Date.now();
    l.find(y => y.scene === '1').notes = 'MY STRIP NOTE: long lens';
    l.splice(l.findIndex(y => y.id === 'day-1'), 0, { id: 'mine-1', type: 'scene', scene: 'PU1', ie: 'EXT', set: 'QUAY', tod: 'DAY', dn: 'D', desc: 'My own pick-up', cast: [], eighths: 2, notes: 'mine' });
    l.splice(l.findIndex(y => y.id === 'day-2'), 0, { id: 'mine-2', type: 'banner', text: 'MY OWN BANNER' });
    x.board = { list: l.map(({ shared, ...strip }) => strip), cast: x.board.cast, updatedAt: Date.now() };
    x.deliverables = x.deliverables.map(dl => form(dl, { link: 'https://my.example/cut' }));
    x.shots[0].done = true; x.shots.push({ id: 'myshot', text: 'My own extra shot', done: false });
    x.callSheet.schedule.push({ id: 'myrow', date: '', time: '06:00', item: 'My own early start' }); x.notes = 'MY OWN BOOKING NOTE\n\n' + x.notes; x.status = 'Prepped'; x.updatedAt = Date.now();
  })));
  ok('…and once the client is changed by hand, that client heads the invoice again', (await bill()).to[0] === 'Quay Films (my client)');
  // link 2: an earlier call, no start and end times, Anna gone and Dee new, scene 1 rewritten, scene 2 gone, scene 4 new
  const two = shoot({ made: Date.now() + 1000, notes: 'Park at the quay gate. Bring wet weather gear.', crew: [{ name: 'Sam Stone', role: 'Sound Recordist', phone: '+1 555 0155', email: '', call: '08:00' }, { name: 'Dee Driver', role: 'Runner', phone: '', email: '', call: '08:00' }],
    scenes: [{ n: 1, date: day(10), pages: '1', items: [{ scene: '1', ie: 'EXT', set: 'QUAY', tod: 'DAWN', desc: 'Boats come in at first light', cast: ['ANA'], pages: '1', kind: 'sb-ext-day' }, { banner: 'Company move' }] },
      { n: 2, date: day(11), pages: '1 2/8', items: [{ scene: '3', ie: 'INT', set: 'BAR', tod: 'NIGHT', desc: 'Last orders', cast: ['TOM'], pages: '1', kind: 'sb-int-night' }, { scene: '4', ie: 'INT', set: 'CELLAR', tod: 'NIGHT', desc: 'The barrels', cast: ['ZOE'], pages: '2/8', kind: 'sb-int-night' }] }] });
  two.call.general = '08:00'; delete two.start; delete two.end;
  await arrive(U.page, await pack(two));
  const upv2 = await sheetText(U.page);
  ok('the update preview says exactly what is replaced and what stays', /Update this booking\?/.test(upv2) && /Replaced: each of these while it is still as the link left it: title, client, dates, times, address/.test(upv2) && /one the link no longer has is removed/.test(upv2) && /Stays: any of those details you changed yourself, and everything you added by hand/.test(upv2) && /Your notes on scenes, the rate, days and notes you gave a person/.test(upv2) && /A part this link does not carry is left as it is/.test(upv2) && !/anything you added by hand stay as they are/.test(upv2), upv2.replace(/\s+/g, ' ').slice(0, 400));
  ok('…names the details changed by hand, which stay, and counts the strips of one’s own', /You changed: the client, the venue’s nearest hospital, the call sheet’s instructions\. They stay as you have them\./.test(upv2) && /Your strips: 2 strips of your own stay on the stripboard\./.test(upv2), (upv2.match(/You changed[^\n]*/) || [''])[0]);
  ok('…and says nothing about the sender when the link is from the same person', (await U.page.locator('.sheet .add-other').count()) === 0);
  await U.page.locator('.sheet button:has-text("Update the booking")').click(); await U.page.waitForSelector('.bk-detail'); await sleep(300);
  const ud = await db(U.page), u2 = ud.bookings[0], uv = ud.venues.find(v => v.id === u2.venueId), l2 = u2.board.list;
  ok('a detail changed by hand is kept: the client, the call sheet’s instructions, the venue’s hospital', ud.bookings.length === 1 && u2.client === 'Quay Films (my client)' && /MY NOTE: gate code 4411/.test(u2.callSheet.notes) && !/wet weather/.test(u2.callSheet.notes) && uv.hospital === 'St Mary’s, 5 Hill Road', JSON.stringify([u2.client, u2.callSheet.notes, uv.hospital]));
  ok('…one not touched takes the link’s new value, and the start and end stay when the link has none', u2.callSheet.generalCall === '08:00' && u2.start === '09:00' && u2.end === '18:00' && u2.shared.sent.times === '09:00–18:00' && u2.shared.sent.client === 'Northwind Ltd' && u2.shared.sent['cs.notes'] === 'Park at the quay gate. Bring wet weather gear.', JSON.stringify([u2.callSheet.generalCall, u2.start, u2.end]));
  const s1 = l2.find(x => x.scene === '1'), day1 = l2.slice(0, l2.findIndex(x => x.id === 'day-1')).map(x => x.scene || x.text), day2 = l2.slice(l2.findIndex(x => x.id === 'day-1') + 1, l2.findIndex(x => x.id === 'day-2')).map(x => x.scene || x.text);
  ok('the stripboard is merged, not replaced: a note written on the link’s strip stays on it, with the strip’s id, while its details follow the link', s1.id === ids1[0] && s1.notes === 'MY STRIP NOTE: long lens' && s1.desc === 'Boats come in at first light' && s1.tod === 'DAWN', JSON.stringify(s1));
  ok('…a scene and a banner of one’s own stay in their day, a scene the link no longer has is gone, a new one comes in', JSON.stringify(day1) === JSON.stringify(['1', 'Company move', 'PU1']) && JSON.stringify(day2) === JSON.stringify(['3', '4', 'MY OWN BANNER']) && l2.find(x => x.id === 'mine-1').notes === 'mine' && !l2.some(x => x.scene === '2') && l2.filter(x => x.type === 'break').map(x => x.id).join() === 'day-1,day-2' && u2.board.cast.join() === 'ANA,TOM,ZOE', JSON.stringify(l2.map(x => x.scene || x.text || x.id)));
  const sam = u2.hires.filter(h => h.name === 'Sam Stone');
  ok('a person still on the link is one line, with the rate and notes given by hand (through a form, which drops the line’s mark) and the link’s new role and number; one no longer on the link is removed; one’s own stays', sam.length === 1 && sam[0].id === u1.hires[1].id && sam[0].rate === 300 && sam[0].notes === 'worked with Sam before' && sam[0].role === 'Sound Recordist' && sam[0].phone === '+1 555 0155' && u2.crewCall[sam[0].id] === '08:00' && !u2.hires.some(h => h.name === 'Anna Lee') && u2.hires.some(h => h.name === 'Dee Driver') && u2.hires.some(h => h.id === 'myhire') && u2.hires.length === 3, JSON.stringify(u2.hires.map(h => [h.name, h.rate])));
  ok('…a deliverable edited in its form is still one deliverable, with its link; shots, schedule lines, notes and the stage of one’s own stay', u2.deliverables.length === 1 && u2.deliverables[0].link === 'https://my.example/cut' && u2.shots.length === 2 && u2.shots[0].done === true && u2.shots.some(s => s.id === 'myshot') && u2.callSheet.schedule.some(r => r.id === 'myrow') && u2.callSheet.schedule.filter(r => r.shared).length === 1 && /^MY OWN BOOKING NOTE/.test(u2.notes) && u2.status === 'Prepped', JSON.stringify(u2.deliverables));

  // ---- an empty part of a link changes nothing ----
  const three = shoot({ made: Date.now() + 2000, crew: two.crew, scenes: two.scenes }); delete three.contacts; delete three.onSet; delete three.kit; delete three.start; delete three.end;
  await arrive(U.page, await pack(three));
  ok('a link without the contacts part counts only the contact it brings (the producer)', /Contacts\s+1 contact on the booking \(Pat Producer\)/.test(await sheetText(U.page)));
  await U.page.locator('.sheet button:has-text("Update the booking")').click(); await U.page.waitForSelector('.bk-detail'); await sleep(300);
  const u3 = (await db(U.page)).bookings[0];
  ok('…and leaves the contacts an earlier link brought, and the equipment list an earlier link put in the notes', u3.stakeholders.map(s => s.name).join('|') === 'Pat Producer|Carl Client|My Billing Contact' && u3.callSheet.attendees === 'Client arrives 11:00' && /Camera: Sony FX6/.test(u3.notes) && /Lighting: Aputure 600d ×2/.test(u3.notes) && (u3.notes.match(/Equipment on this shoot/g) || []).length === 1 && u3.shared.contacts.join('|') === 'pat producer|carl client', JSON.stringify([u3.stakeholders.map(s => s.name), u3.notes]));
  const four = shoot({ made: Date.now() + 3000, crew: two.crew, scenes: two.scenes, contacts: [{ name: 'Dana New', role: 'Brand lead', phone: '', email: 'dana@northwind.example' }], kit: [{ name: 'Sony FX3', cat: 'Camera', qty: 1 }], by: { name: 'Robin Other', business: '', phone: '', email: 'robin@elsewhere.example' } });
  await arrive(U.page, await pack(four));
  ok('a link for the same shoot from someone else says so before the update', /This link is from Robin Other; the booking in your Bookings came from Pat Producer · Quay Films\. Check that it is the same shoot/.test(await U.page.locator('.sheet .add-other').innerText()));
  await U.page.locator('.sheet button:has-text("Update the booking")').click(); await U.page.waitForSelector('.bk-detail'); await sleep(300);
  const u4 = (await db(U.page)).bookings[0];
  ok('…and a later link that does carry contacts and equipment replaces the ones a link brought, never one’s own', u4.stakeholders.map(s => s.name).join('|') === 'Robin Other|Dana New|My Billing Contact' && /Camera: Sony FX3/.test(u4.notes) && !/Sony FX6/.test(u4.notes) && /^MY OWN BOOKING NOTE/.test(u4.notes), JSON.stringify([u4.stakeholders.map(s => s.name), u4.notes]));

  // ---- a booking shared on is still one's own ----
  const onward = await U.page.evaluate(inc => Promise.all([import('./js/store.js'), import('./js/crew-link.js')]).then(([s, m]) => m.crewLink(s.db.bookings[0], inc)), EVERYTHING);
  await arrive(U.page, hashOf(onward), '.sheet');
  ok('a booking that came from a link and is shared on is known as one’s own when its link comes back: nothing to add, no copy (the link was made from it, or from someone else’s copy of the same shared booking, which has the same reference)', /This booking is yours/.test(await sheetText(U.page)) && /this link was made from it, or from another copy of the same shared booking, so there is nothing to add/.test(await sheetText(U.page)) && (await U.page.locator('.sheet .add-actions').count()) === 0 && (await db(U.page)).bookings.length === 1);
  await U.page.keyboard.press('Escape'); await sleep(200);

  // ---- a booking from before Vdex kept what a link supplied ----
  await U.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings[0], sh = x.shared; x.shared = { ref: sh.ref, by: sh.by, at: sh.at, updated: sh.updated, made: sh.made, note: sh.note, contacts: sh.contacts }; const v = d.venues.find(y => y.id === x.venueId); v.shared = { ref: v.shared.ref, by: v.shared.by, at: v.shared.at }; x.board.list.find(y => y.scene === '3').notes = 'NOTE ON THREE'; x.updatedAt = Date.now(); })));
  await arrive(U.page, await pack(shoot({ made: Date.now() + 4000, crew: two.crew, scenes: two.scenes })));
  const upv5 = await sheetText(U.page);
  ok('for such a booking the preview says that this once every detail the link holds comes in', /Replaced: this booking was added before Vdex kept track of what a link supplied, so this once every detail the link holds comes in/.test(upv5) && /Stays: your notes on scenes/.test(upv5) && !/You changed/.test(upv5), upv5.replace(/\s+/g, ' ').slice(0, 300));
  await U.page.locator('.sheet button:has-text("Update the booking")').click(); await U.page.waitForSelector('.bk-detail'); await sleep(300);
  const u5 = (await db(U.page)).bookings[0];
  ok('…and it does: the client and the venue’s hospital are the link’s again, the strips are the link’s with their notes kept, and from now on the booking keeps the record', u5.client === 'Northwind Ltd' && (await db(U.page)).venues[0].hospital === 'Portside General' && (await db(U.page)).venues[0].shared.sent.hospital === 'Portside General' && !u5.board.list.some(x => x.id === 'mine-1') && u5.board.list.find(x => x.scene === '3').notes === 'NOTE ON THREE' && u5.shared.sent.client === 'Northwind Ltd' && u5.shared.rows.strips.length === 4, JSON.stringify([u5.client, u5.board.list.map(x => x.scene || x.text || x.id)]));
  await U.ctx.close();

  /* ============================== what a second check of those fixes found ============================== */
  // ---- a contact typed by hand under a name a later link also carries stays one's own ----
  const J = await open();
  await J.page.goto(BASE); await J.page.waitForSelector('#rolodex .drum-btn');
  const jb = ref => db(J.page).then(d => d.bookings.find(b => b.shared && b.shared.ref === ref));
  const jbill = ref => J.page.evaluate(ref => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const b = s.db.bookings.find(x => x.shared && x.shared.ref === ref); return { to: m.snapshot(b, 'invoice').to, mail: decodeURIComponent(m.mailtoFor(b, 'invoice', 'https://x.example/i').split('?')[0]), head: m.billTo(b).head, named: m.billedName(b) }; }), ref);
  // By hand, on the booking a link made: lists are added to, anything else is set.
  const jput = (ref, patch) => J.page.evaluate(([ref, patch]) => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.shared && b.shared.ref === ref); for (const [k, v] of Object.entries(patch)) x[k] = Array.isArray(v) ? [...(x[k] || []), ...v] : v; x.updatedAt = Date.now(); })), [ref, patch]);
  const invoice = number => ({ number, date: day(10), lines: [{ id: 'l1', desc: 'Shoot day', qty: 1, unit: 'day', price: 500 }], status: 'Sent' });
  const update = async (page = J.page) => { await page.locator('.sheet button:has-text("Update the booking")').click(); await page.waitForSelector('.bk-detail'); await sleep(300); };
  const first = shoot({ ref: 'REF-J1' }); delete first.contacts; // the producer left "Client contacts" unticked, as it is to begin with
  await arrive(J.page, await pack(first));
  await J.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await J.page.waitForSelector('.bk-detail'); await sleep(300);
  // by hand: the client's contact, with one's own details for him, and an invoice that has gone out
  await jput('REF-J1', { stakeholders: [{ name: 'Carl Client', role: 'Marketing (my contact)', phone: '+44 7700 900123', email: 'carl.private@example.com' }], invoice: invoice('INV-0041') });
  const j0 = await jbill('REF-J1');
  // link 2: the producer ticks the contacts, and their list has Carl with the office address and no phone
  await arrive(J.page, await pack(shoot({ ref: 'REF-J1', made: Date.now() + 1000, contacts: [{ name: 'Carl Client', role: 'Marketing', phone: '', email: 'carl@northwind.example' }] })));
  const jp = await sheetText(J.page);
  ok('a link that carries a contact one typed in by hand under the same name does not count him among the contacts it brings', /Contacts\s+1 contact on the booking \(Pat Producer\)/.test(jp) && /everything you added by hand: your own people, contacts/.test(jp) && !/You changed/.test(jp), (jp.match(/Contacts\s[^\n]*/) || [''])[0]);
  ok('…and, as nothing about who the invoice goes to would change, says nothing about re-addressing it', (await J.page.locator('.sheet .add-readdress').count()) === 0);
  await update();
  const j1 = await jb('REF-J1'), carl1 = j1.stakeholders.filter(s => s.name === 'Carl Client'), j1bill = await jbill('REF-J1');
  ok('…and the update leaves him exactly as typed: one line, with the role, number and address one gave him, and his name is not the link’s', carl1.length === 1 && carl1[0].role === 'Marketing (my contact)' && carl1[0].phone === '+44 7700 900123' && carl1[0].email === 'carl.private@example.com' && j1.shared.contacts.join('|') === 'pat producer', JSON.stringify([carl1, j1.shared.contacts]));
  ok('…so he is still on the invoice’s To lines and in its email', JSON.stringify(j1bill) === JSON.stringify(j0) && j1bill.to.length === 3 && j1bill.to[2] === 'Carl Client · Marketing (my contact) · carl.private@example.com' && j1bill.mail === 'mailto:pat@quayfilms.example,carl.private@example.com', JSON.stringify(j1bill));
  // link 3: other contacts. The link's own are replaced; the typed one was never the link's, and stays
  await arrive(J.page, await pack(shoot({ ref: 'REF-J1', made: Date.now() + 2000, contacts: [{ name: 'Dana New', role: 'Brand lead', phone: '', email: 'dana@northwind.example' }] })));
  await update();
  const j2 = await jb('REF-J1');
  ok('…and he is still there after a later link with other contacts, which come in beside him', j2.stakeholders.map(s => s.name).join('|') === 'Pat Producer|Dana New|Carl Client' && j2.stakeholders[2].email === 'carl.private@example.com' && j2.shared.contacts.join('|') === 'pat producer|dana new', JSON.stringify(j2.stakeholders));

  // ---- an invoice already made is headed and emailed anew by an update from another sender: the sheet says so ----
  const olive = { name: 'Olive Other', business: 'Harbour Media', phone: '', email: 'olive@harbour.example' }, dana = [{ name: 'Dana New', role: 'Brand lead', phone: '', email: 'dana@northwind.example' }];
  await arrive(J.page, await pack(shoot({ ref: 'REF-J1', made: Date.now() + 3000, by: olive, contacts: dana })));
  const moved = await J.page.locator('.sheet .add-readdress').innerText().catch(() => '(no such line)');
  ok('an update that changes who an invoice already made is headed and emailed to says so before the tap, with both names and the addresses', moved === 'The invoice you made on this booking is headed to Quay Films (pat@quayfilms.example, carl.private@example.com). After this update it is headed to Harbour Media (olive@harbour.example, carl.private@example.com), even if it has been sent already.' && /quote, invoice and hours/.test(await sheetText(J.page)), moved);
  await update();
  const j3bill = await jbill('REF-J1');
  ok('…which is what the update then does to the invoice that was sent', j3bill.head === 'Harbour Media' && j3bill.named === 'Harbour Media' && j3bill.mail === 'mailto:olive@harbour.example,carl.private@example.com', JSON.stringify(j3bill));
  await arrive(J.page, await pack(shoot({ ref: 'REF-J1', made: Date.now() + 4000, by: olive, contacts: dana })));
  ok('…and the same sender’s link again, which changes nothing of that, has no such line', (await J.page.locator('.sheet .add-readdress').count()) === 0 && (await J.page.locator('.sheet .add-other').count()) === 0 && /Update this booking\?/.test(await sheetText(J.page)));
  await J.page.keyboard.press('Escape'); await sleep(200);

  // ---- a link that names no sender, and a contact typed under the name a later link gives as its sender ----
  const anon = shoot({ ref: 'REF-J2', title: 'Pier film', by: {}, contacts: [{ name: 'Carl Client', role: 'Marketing', phone: '', email: 'carl@northwind.example' }, { name: 'Paula Agency', role: 'Producer · Tidewater', phone: '', email: 'paula@agency.example' }] });
  await arrive(J.page, await pack(anon));
  const nsv = await J.page.locator('.sheet .add-bill').innerText();
  ok('a link that names no sender says a quote or an invoice on it is headed to nobody, also when one of the client’s contacts has a role that begins with “Producer”', /The link does not say who shared it, so a quote or an invoice you make on it is headed to nobody until you add a contact or change the client/.test(nsv) && !/goes to/.test(nsv), nsv);
  await J.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await J.page.waitForSelector('.bk-detail'); await sleep(300);
  await jput('REF-J2', { invoice: invoice('INV-0042') });
  // The Email button of the Money page, as the page draws it.
  const mailBtn = ref => J.page.evaluate(ref => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => { const b = ref ? s.db.bookings.find(x => x.shared && x.shared.ref === ref) : s.db.bookings.find(x => x.id === 'plain-job'), a = m.moneyPage(b, 'invoice', () => {}).querySelector('a[href^="mailto:"]'); return { text: a.textContent, tip: a.title, to: decodeURIComponent(a.getAttribute('href').split('?')[0]) }; }), ref);
  const ns = { ...(await jbill('REF-J2')), producer: (await jb('REF-J2')).shared.producer, btn: await mailBtn('REF-J2') };
  ok('…and so it is: that contact is not taken for the person who shared it, and the invoice names and emails nobody', ns.producer === null && ns.head === '—' && ns.named === '' && ns.to.join('|') === '—' && ns.mail === 'mailto:', JSON.stringify(ns));
  const TIP = 'On a booking added from a shared link this goes to the person who shared it and to contacts you add yourself: give one of them an email address on the booking';
  ok('the Email button, with nobody to write to while the booking shows contacts with addresses, says who it goes to on such a booking instead of “Add contact emails”', ns.btn.text === '✉ Email' && ns.btn.tip === TIP && ns.btn.to === 'mailto:', JSON.stringify(ns.btn));
  await jput('REF-J2', { stakeholders: [{ name: 'Pat Producer', role: 'Hired me', phone: '', email: 'pat.billing@quay.example' }] });
  const nb = await mailBtn('REF-J2');
  ok('…and once a contact of one’s own has an address, it writes to them', nb.text === '✉ Email client (1)' && nb.tip === 'To: pat.billing@quay.example' && nb.to === 'mailto:pat.billing@quay.example', JSON.stringify(nb));
  await J.page.evaluate(d => import('./js/store.js').then(s => s.update(x => { x.bookings.push({ id: 'plain-job', title: 'Plain job', client: 'Acme', type: 'other', date: d, status: 'Confirmed', crew: [], gear: [], stakeholders: [{ name: 'No Address', role: '', phone: '', email: '' }], notes: '', deliverables: [{ id: 'pd1', name: 'Teaser', duration: '30 s', status: 'Planned' }], invoice: { number: 'INV-0043', date: d, lines: [], status: 'Draft' } }); })), day(12));
  const pb = await mailBtn('');
  ok('…while an ordinary booking with no addresses still says to add contact emails', pb.text === '✉ Email' && pb.tip === 'Add contact emails on the booking', JSON.stringify(pb));
  await J.page.evaluate(() => import('./js/tutorials.js').then(m => m.openMoneyGuide())); await J.page.waitForSelector('.sheet .money-guide-body');
  ok('the quotes and invoices guide says who Email client writes to on a booking added from a shared link', /Email client, which addresses the contacts on the booking \(on a booking added from a shared link: the person who shared it and the contacts you added yourself\)/.test(await sheetText(J.page)));
  await J.page.keyboard.press('Escape'); await sleep(200);
  // the producer's next link names them: the line typed under their name is one's own, and stays through update after update
  const named = made => { const x = shoot({ ref: 'REF-J2', title: 'Pier film', made }); delete x.contacts; return x; };
  for (const made of [Date.now() + 1000, Date.now() + 2000]) { await arrive(J.page, await pack(named(made))); await update(); }
  const j5 = await jb('REF-J2'), j5bill = await jbill('REF-J2'), pats = j5.stakeholders.filter(s => s.name === 'Pat Producer');
  ok('a contact typed under the name a later link gives as its sender stays as typed through two updates, and the invoice is headed to the sender’s business and emailed to the typed address', pats.length === 1 && pats[0].role === 'Hired me' && pats[0].email === 'pat.billing@quay.example' && j5.shared.producer.business === 'Quay Films' && !j5.shared.contacts.includes('pat producer') && j5bill.head === 'Quay Films' && j5bill.mail === 'mailto:pat.billing@quay.example', JSON.stringify([j5.stakeholders, j5.shared.contacts, j5bill]));
  // a booking from before the producer was recorded apart still finds them among the link's contacts, by their role
  await J.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.shared && b.shared.ref === 'REF-J1'), sh = x.shared; x.shared = { ref: sh.ref, by: sh.by, at: sh.at, updated: sh.updated, made: sh.made, note: sh.note, contacts: sh.contacts }; x.updatedAt = Date.now(); })));
  const oldBill = await jbill('REF-J1');
  ok('a booking added before the sender was recorded apart is still billed to the contact the link brought as “Producer”', oldBill.head === 'Harbour Media' && oldBill.mail === 'mailto:olive@harbour.example,carl.private@example.com', JSON.stringify(oldBill));

  // ---- the producer's deliverables are not suggested as lines of one's own quote or invoice ----
  const sug = ref => J.page.evaluate(ref => Promise.all([import('./js/store.js'), import('./js/money.js')]).then(([s, m]) => m.suggestLines(ref ? s.db.bookings.find(x => x.shared && x.shared.ref === ref) : s.db.bookings.find(x => x.id === 'plain-job'), 'invoice').map(l => l.desc)), ref);
  const sug1 = await sug('REF-J2');
  // one added by hand, and the link's own edited in its form (which writes the line anew, without the link's mark)
  await J.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.shared && b.shared.ref === 'REF-J2'); x.deliverables = [...x.deliverables.map(({ shared, ...dl }) => ({ ...dl, link: 'https://my.example/cut' })), { id: 'mydl', name: 'Sound stems', duration: '', due: '', status: 'Planned', link: '', delivered: '' }]; x.updatedAt = Date.now(); })));
  const sug2 = await sug('REF-J2');
  ok('the deliverables a link brought are the producer’s, and are not suggested as lines of one’s own invoice; one added by hand is', !sug1.some(l => /Main film/.test(l)) && sug1.some(l => /^Shoot day/.test(l)) && !sug2.some(l => /Main film/.test(l)) && sug2.includes('Sound stems'), JSON.stringify([sug1, sug2]));
  ok('…and an ordinary booking’s deliverables are suggested as before', (await sug('')).includes('Teaser (30 s)'));
  await J.ctx.close();

  // ---- two devices of one person: a link update on one, a later edit of the booking on the other, then the sync ----
  const M = await open();
  await M.page.goto(BASE); await M.page.waitForSelector('#rolodex .drum-btn');
  const strip = (scene, set) => ({ scene, ie: 'INT', set, tod: 'DAY', desc: '', cast: [], pages: '1', kind: 'sb-int-day' });
  const board = (...sets) => [{ n: 1, date: day(10), pages: String(sets.length), items: sets.map((set, i) => strip(String(i + 1), set)) }];
  const mk = (over = {}) => shoot({ ref: 'REF-M1', title: 'Kitchen film', endDate: '', scenes: board('KITCHEN', 'HALL'), ...over });
  const linkOne = await pack(mk()), linkTwo = await pack(mk({ made: Date.now() + 1000, scenes: board('KITCHEN', 'HALL', 'GARDEN') }));
  const synced = await M.page.evaluate(async ([one, two]) => {
    const s = await import('./js/store.js'), sd = await import('./js/share-data.js'), si = await import('./js/share-import.js');
    const read = l => sd.readShared('#' + l), mine = d => d.bookings.find(b => b.shared && b.shared.ref === 'REF-M1'), wait = () => new Promise(r => setTimeout(r, 25));
    si.applyBooking(await read(one));
    const before = s.serialize(); // both devices hold the booking with scenes 1 and 2
    await wait(); si.applyBooking(await read(two)); // device A takes the producer's new link: scene 3 comes in
    const a = JSON.parse(s.serialize());
    s.replaceAll(JSON.parse(before)); // device B, still open and not synced, ticks a checklist line a moment later
    s.update(d => { const x = mine(d); x.checks = { 'x:t': 1 }; x.updatedAt = Date.now() + 5000; });
    const b = JSON.parse(s.serialize()), out = {};
    for (const [k, m] of [['ba', s.mergeDb(b, a)], ['ab', s.mergeDb(a, b)]]) { const x = mine(m), sc = x.board.list.filter(y => y.type === 'scene'); out[k] = { scenes: sc.map(y => y.scene).join(), strips: x.shared.rows.strips.length, ticked: !!(x.checks && x.checks['x:t']), listed: sc.every(y => x.shared.rows.strips.includes(y.id)) }; }
    s.replaceAll(s.mergeDb(b, a));
    out.own = si.planBooking(await read(two)).ownStrips;
    return out;
  }, [linkOne, linkTwo]);
  ok('after a sync that keeps one device’s later edit of the booking and the other’s updated stripboard, the list of the strips the link made is the one that goes with that board', ['ba', 'ab'].every(k => synced[k].scenes === '1,2,3' && synced[k].strips === 3 && synced[k].ticked && synced[k].listed) && synced.own === 0, JSON.stringify(synced));
  await arrive(M.page, linkTwo);
  const againM = await sheetText(M.page);
  await update(M.page);
  const afterM = (await db(M.page)).bookings.find(b => b.shared && b.shared.ref === 'REF-M1').board.list.filter(x => x.type === 'scene').map(x => `${x.scene} ${x.set}`);
  ok('…so the same link again counts no strips as one’s own, and the update leaves each scene once', !/Your strips/.test(againM) && afterM.join('|') === '1 KITCHEN|2 HALL|3 GARDEN', JSON.stringify([(againM.match(/Your strips[^\n]*/) || [''])[0], afterM]));

  // ---- the same links added on two devices before either has read the other's copy ----
  const dock = { venue: 'Dock Hall', address: '9 Dock Road, Portside', access: 'Side door', parking: '', power: '', hospital: '', rules: '' };
  const harbour = (over = {}) => shoot({ ref: 'REF-X1', title: 'Harbour film', location: dock, ...over });
  const kitList = { v: 1, kind: 'gear', made: Date.now(), title: 'Interview kit', currency: '£', by: { name: 'Pat Producer' }, items: [{ ref: 'gx1', name: 'Sony FX6', category: 'Camera', serial: 'FX6-1' }, { ref: 'gx2', name: 'Sigma 24-70', category: 'Lens' }], kits: [{ ref: 'kx1', name: 'Interview kit', items: [[0, 1], [1, 1]] }] };
  const laterCall = harbour({ made: Date.now() + 1000 }); laterCall.call = { ...laterCall.call, general: '06:15' };
  const twice = await M.page.evaluate(async ([bk, upd, gear, onward, direct]) => {
    const s = await import('./js/store.js'), sd = await import('./js/share-data.js'), si = await import('./js/share-import.js'), gi = await import('./js/gear-import.js');
    const read = l => sd.readShared('#' + l), g = await read(gear), wait = () => new Promise(r => setTimeout(r, 25));
    const addBoth = async () => { si.applyBooking(await read(bk)); gi.applyGearImport(gi.planGearImport(g.items), { kits: g.kits, from: 'Pat Producer' }); return JSON.parse(s.serialize()); };
    const from = x => !!x.shared && /^(REF-X1|gx\d|kx\d)$/.test(x.shared.ref || '');
    const count = d => ({ bookings: d.bookings.filter(from).length, venues: d.venues.filter(from).length, gear: d.gear.filter(from).length, kits: d.kits.filter(from).length });
    const start = s.serialize();
    const a = await addBoth(); s.replaceAll(JSON.parse(start)); await wait(); const b = await addBoth(); // device A, then device B from the same start
    const out = { each: [count(a), count(b)] };
    s.replaceAll(s.mergeDb(a, b)); out.merged = count(s.db);
    out.kit = s.db.kits.filter(from).map(k => k.gear.map(id => (s.db.gear.find(x => x.id === id) || {}).name).join('+')).join('|');
    si.applyBooking(await read(upd)); // the producer's update, on either device after the sync
    out.calls = s.db.bookings.filter(from).map(x => x.callSheet.generalCall).join('|');
    out.again = gi.planGearImport(g.items).rows.map(r => r.why + ':' + r.action).join('|');
    // “Add anyway, as another item” still makes another item, and a booking deleted and added again is a record of its own
    const plan = gi.planGearImport(g.items); plan.rows.forEach(r => { r.action = 'add'; }); gi.applyGearImport(plan, { kits: [], from: 'Pat Producer' });
    out.anyway = { gear: s.db.gear.filter(from).length, ids: new Set(s.db.gear.map(x => x.id)).size === s.db.gear.length };
    const was = s.db.bookings.find(from).id; s.remove('bookings', was); await wait(); si.applyBooking(await read(bk));
    const back = s.db.bookings.filter(from); out.readded = back.length === 1 && back[0].id !== was && s.mergeDb(JSON.parse(s.serialize()), a).bookings.filter(from).length === 1;
    // someone who holds a workmate's link made from the workmate's copy of a shoot, and then the producer's own link:
    // the workmate's link again updates the booking it made, and is not taken for a link made from the other one
    si.applyBooking(await read(onward)); si.applyBooking(await read(direct));
    const p = si.planBooking(await read(onward));
    out.onward = { own: !!p.own, updates: !!p.existing && p.existing.shared.ref === 'link-REF-X2', held: s.db.bookings.filter(x => x.shared && /REF-X2$/.test(x.shared.ref)).length };
    return out;
  }, [await pack(harbour()), await pack(laterCall), await pack(kitList), await pack(shoot({ ref: 'link-REF-X2', title: 'Second film', by: { name: 'Wes Workmate', business: '', phone: '', email: '' } })), await pack(shoot({ ref: 'REF-X2', title: 'Second film' }))]);
  ok('each device makes one booking, one venue, two items and one kit from the links', twice.each.every(c => JSON.stringify(c) === JSON.stringify({ bookings: 1, venues: 1, gear: 2, kits: 1 })), JSON.stringify(twice.each));
  ok('…and after the sync there is still one of each, not two: what a link makes has the same id on every device', JSON.stringify(twice.merged) === JSON.stringify({ bookings: 1, venues: 1, gear: 2, kits: 1 }) && twice.kit === 'Sony FX6+Sigma 24-70', JSON.stringify([twice.merged, twice.kit]));
  ok('…so the producer’s update reaches the one booking there is, and the equipment link again finds each item once', twice.calls === '06:15' && twice.again === 'ref:update|ref:update', JSON.stringify([twice.calls, twice.again]));
  ok('“Add anyway” still makes another item with an id of its own, and a booking deleted and added again is a new record that a merge with an older copy does not take away', twice.anyway.gear === 4 && twice.anyway.ids && twice.readded, JSON.stringify([twice.anyway, twice.readded]));
  ok('a link whose reference is the id of a booking made from another link updates the booking that link made before, and is not taken for one’s own', !twice.onward.own && twice.onward.updates && twice.onward.held === 2, JSON.stringify(twice.onward));
  await M.ctx.close();

  /* ============================== a card that only looks like someone on the Crew list ============================== */
  const C = await open();
  await C.page.goto(BASE); await C.page.waitForSelector('#rolodex .drum-btn');
  await C.page.evaluate(d => import('./js/store.js').then(s => s.update(x => {
    x.profile = { ...x.profile, name: 'Uma Owner', business: 'Owner Films', email: 'uma@ownerfilms.example', phone: '+1 555 0500', updatedAt: Date.now() };
    x.crew.push({ id: 'c1', name: 'Anna Lee', role: 'Gaffer', phone: '+1 555 010 0100', email: 'anna@acme.example', rate: 450, rateUnit: 'day', notes: 'Prefers morning calls' },
      { id: 'cx', name: 'Alex', role: 'Editor', phone: '', email: 'alex.the.editor@example.com', rate: 350, rateUnit: 'day', notes: '' },
      { id: 'ck', name: 'Kim Vale', role: 'Gaffer', phone: '', email: 'bookings@quay.example', rate: 400, rateUnit: 'day', notes: 'Great with HMIs' });
    x.bookings.push({ id: 'b1', title: 'Anna job', client: '', type: 'other', date: d, status: 'Confirmed', crew: ['c1'], gear: [], stakeholders: [], notes: '' });
  })), day(5));
  const cardOf = o => pack({ v: 1, kind: 'contact', ...o });
  const crewOf = async () => (await db(C.page)).crew;
  await arrive(C.page, await cardOf({ name: 'Bob Stone', title: 'Gaffer', phone: '+1 (555) 010-0100', email: 'bob@acme.example' }));
  const cp1 = await sheetText(C.page), cb1 = await C.page.locator('.sheet .add-actions .btn').allInnerTexts();
  ok('a card that shares only a phone number with someone is not taken for them: both are shown, with the detail that matched', /Add this contact\?/.test(cp1) && /On your Crew list, with the same phone number/.test(cp1) && /Anna Lee/.test(cp1) && /anna@acme\.example/.test(cp1) && /Two people can share a phone number/.test(cp1) && !/again/.test(cp1), cp1.replace(/\s+/g, ' ').slice(0, 300));
  ok('…adding a new person is the first button, updating the one found the second', cb1.join('|') === 'Add as a new person|Update Anna Lee|Cancel' && await C.page.locator('.sheet .add-actions .btn').first().evaluate(b => b.classList.contains('primary')), cb1.join('|'));
  await C.page.locator('.sheet button:has-text("Add as a new person")').click(); await C.page.waitForSelector('.crew-card.just-added'); await sleep(200);
  const cr1 = await crewOf(), anna = cr1.find(x => x.id === 'c1');
  ok('…and then Anna stays Anna, on her booking, and Bob is a person of his own', cr1.length === 4 && anna.name === 'Anna Lee' && anna.email === 'anna@acme.example' && anna.role === 'Gaffer' && anna.rate === 450 && cr1.some(x => x.name === 'Bob Stone' && x.id !== 'c1' && x.email === 'bob@acme.example') && (await db(C.page)).bookings[0].crew.join() === 'c1', JSON.stringify(cr1.map(x => [x.id, x.name])));
  await arrive(C.page, await cardOf({ name: 'Alex', title: 'Drone pilot', phone: '+1 555 0777', email: 'alex.flies@example.org' }));
  ok('the same for a card that shares only a name', /On your Crew list, with the same name/.test(await sheetText(C.page)) && /Two people can share a name/.test(await sheetText(C.page)));
  await C.page.locator('.sheet button:has-text("Add as a new person")').click(); await C.page.waitForSelector('.crew-card.just-added'); await sleep(200);
  const cr2 = await crewOf();
  ok('…two people called Alex, the first untouched', cr2.filter(x => x.name === 'Alex').length === 2 && cr2.find(x => x.id === 'cx').role === 'Editor' && cr2.find(x => x.id === 'cx').email === 'alex.the.editor@example.com' && cr2.find(x => x.id === 'cx').rate === 350);
  await arrive(C.page, await cardOf({ name: 'Robin Vale', title: 'Editor', phone: '+1 555 0999', email: 'bookings@quay.example' }));
  ok('…and for one that shares an email address under another name', /On your Crew list, with the same email address/.test(await sheetText(C.page)) && (await C.page.locator('.sheet .add-actions .btn').allInnerTexts()).join('|') === 'Add as a new person|Update Kim Vale|Cancel');
  await C.page.locator('.sheet button:has-text("Update Kim Vale")').click(); await C.page.waitForSelector('.crew-card.just-added'); await sleep(200);
  const kim = (await crewOf()).find(x => x.id === 'ck');
  ok('Update, when chosen, puts the card on the person found and keeps their rate and notes', (await crewOf()).length === 5 && kim.name === 'Robin Vale' && kim.role === 'Editor' && kim.rate === 400 && /Great with HMIs/.test(kim.notes), JSON.stringify(kim));
  await arrive(C.page, await cardOf({ name: 'Bob Stone', title: 'Best boy', phone: '+1 (555) 010-0100', email: 'bob@acme.example' }));
  const cp4 = await sheetText(C.page);
  ok('a card that came in before is certainly the same person: Update and Cancel only, and “again”', /Update this contact\?/.test(cp4) && /Bob Stone is on your Crew list already, from this card\. Adding the card again updates/.test(cp4) && (await C.page.locator('.sheet .add-actions .btn').allInnerTexts()).join('|') === 'Update the contact|Cancel' && (await C.page.locator('.sheet .add-maybe').count()) === 0, cp4.replace(/\s+/g, ' ').slice(0, 200));
  await C.page.locator('.sheet button:has-text("Update the contact")').click(); await C.page.waitForSelector('.crew-card.just-added'); await sleep(200);
  ok('…updated in place', (await crewOf()).length === 5 && (await crewOf()).find(x => x.name === 'Bob Stone').role === 'Best boy');
  await arrive(C.page, await cardOf({ name: 'anna  LEE', title: 'Chief lighting technician', email: 'ANNA@acme.example' }));
  const cp5 = await sheetText(C.page);
  ok('the same name and email address is certain too, and “again” is not said of someone who never came from a card', /Update this contact\?/.test(cp5) && /Anna Lee is on your Crew list already, with this name and email address\. Adding the card updates/.test(cp5) && !/again/.test(cp5), cp5.replace(/\s+/g, ' ').slice(0, 200));
  await C.page.keyboard.press('Escape'); await sleep(200);
  const before5 = (await crewOf()).length;
  await arrive(C.page, await cardOf({ name: 'Uma Owner', title: 'Director', business: 'Owner Films', phone: '+1 555 0500', email: 'uma@ownerfilms.example' }), '.sheet');
  ok('one’s own contact card says it is one’s own, with nothing to add', /This is your own card/.test(await sheetText(C.page)) && (await C.page.locator('.sheet .add-actions').count()) === 0 && (await C.page.locator('.sheet .actions .btn').allInnerTexts()).join() === 'Close');
  const ownApplied = await C.page.evaluate(() => import('./js/share-import.js').then(m => m.applyContact({ kind: 'contact', name: 'Uma Owner', email: 'uma@ownerfilms.example', phone: '', title: '', business: '', website: '', location: '' })));
  ok('…and one is never put on one’s own Crew list', ownApplied === false && (await crewOf()).length === before5 && !(await crewOf()).some(x => x.name === 'Uma Owner'));
  await C.page.locator('.sheet button:has-text("Close")').click(); await sleep(200);
  // a workmate's card under the company's address is theirs, not one's own
  await arrive(C.page, await cardOf({ name: 'Wes Workmate', title: 'Editor', phone: '+1 555 0444', email: 'uma@ownerfilms.example' }), '.sheet');
  ok('a card in another name that carries the email address of one’s own profile (a company address) is not one’s own card: it can be added', /Add this contact\?/.test(await sheetText(C.page)) && (await C.page.locator('.sheet .add-actions .btn').allInnerTexts()).join('|') === 'Add to my Crew|Cancel', (await sheetText(C.page)).replace(/\s+/g, ' ').slice(0, 160));
  await C.page.locator('.sheet button:has-text("Add to my Crew")').click().catch(() => {}); await C.page.waitForSelector('.crew-card.just-added', { timeout: 8000 }).catch(() => {}); await sleep(200);
  ok('…and the tap adds them to the Crew list', (await crewOf()).some(x => x.name === 'Wes Workmate' && x.email === 'uma@ownerfilms.example' && x.role === 'Editor'));
  if (await C.page.locator('.sheet').count()) { await C.page.keyboard.press('Escape'); await sleep(200); }
  const owns = await C.page.evaluate(() => import('./js/share-import.js').then(m => { const p = { name: 'Uma Owner', business: 'Owner Films', email: 'uma@ownerfilms.example', phone: '+1 555 0500' }, c = o => m.ownCard({ name: '', business: '', email: '', phone: '', ...o }, p); return [c({ name: 'Uma Owner', email: 'UMA@ownerfilms.example' }), c({ name: 'Owner Films', email: 'uma@ownerfilms.example' }), c({ email: 'uma@ownerfilms.example' }), c({ name: 'Uma Owner', email: 'other@elsewhere.example', phone: '+1 555 0500' }), c({ name: 'Wes Workmate', email: 'uma@ownerfilms.example', phone: '+1 555 0500' }), m.ownCard({ name: 'Wes Workmate', business: '', email: 'x@y.example', phone: '' }, { name: '', business: '', email: 'x@y.example', phone: '' })]; }));
  ok('…while one’s own name or business under that address, or the address with no name, is still one’s own card; one’s name and number under another address is not; and a profile with no name goes by the address alone', JSON.stringify(owns) === JSON.stringify([true, true, true, false, false, true]), JSON.stringify(owns));

  // ---- one link at a time ----
  const three3 = [await cardOf({ name: 'Ann Test', phone: '555 0001 01' }), await cardOf({ name: 'Ben Test', phone: '555 0001 02' }), await cardOf({ name: 'Cy Test', phone: '555 0001 03' })];
  await C.page.evaluate(async links => { for (const l of links) { location.hash = 'add=' + l; await new Promise(r => setTimeout(r, 30)); } }, three3);
  await C.page.waitForSelector('.sheet .add-preview', { timeout: 15000 }); await sleep(1500);
  ok('links that arrive one after another do not pile up: one preview, of the last', (await C.page.locator('.sheet').count()) === 1 && /Cy Test/.test(await C.page.locator('.sheet .add-title').innerText()), `${await C.page.locator('.sheet').count()} sheets`);
  await C.page.evaluate(l => { location.hash = 'add=' + l; }, three3[0]); await sleep(1500);
  ok('…and a link that arrives while a preview is open takes its place', (await C.page.locator('.sheet').count()) === 1 && /Ann Test/.test(await C.page.locator('.sheet .add-title').innerText()) && (await C.page.evaluate(() => document.getElementById('app').inert)) === true);
  await C.page.keyboard.press('Escape'); await sleep(200);
  ok('…leaving the page usable when it is closed', (await C.page.locator('.sheet').count()) === 0 && (await C.page.evaluate(() => document.getElementById('app').inert)) === false);

  // ---- Add from a link: the box, and a QR code that is not a link ----
  await C.page.evaluate(() => window.logiGo('crew')); await sleep(300);
  // a camera that shows a picture of ours: a QR code drawn on a canvas, moved a little all the time, as a hand does
  // fill: how much of the picture's height the code takes, at its middle size (it swings a little, as a hand does)
  // still: the code does not move at all. The camera notes what it is asked for (window.__camAsked).
  const fakeCamera = (page, text, fill = 0.72, still = false) => page.evaluate(async ([t, fill, still]) => {
    const { qrSvg } = await import('./js/qr.js'), img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(await qrSvg(t, { cellSize: 4 })); await img.decode();
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080; const g = c.getContext('2d'); let k = 0;
    const draw = () => { const sw = still ? 0 : 1, d = 1080 * 0.9 * (fill + sw * (fill < 0.6 ? 0.03 : 0.06) * Math.sin(k / 3)), x = 960 - d / 2 + sw * 6 * Math.sin(k / 2), y = 540 - d / 2 + sw * 6 * Math.cos(k / 2); k++; g.filter = 'none'; g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, 1920, 1080); g.filter = 'blur(1px)'; g.fillStyle = '#fff'; g.fillRect(x - 12, y - 12, d + 24, d + 24); g.drawImage(img, x, y, d, d); };
    draw(); clearInterval(window.__cam); window.__cam = setInterval(draw, 100);
    const stream = c.captureStream(10); window.__camAsked = []; navigator.mediaDevices.getUserMedia = async asked => { window.__camAsked.push(asked); return stream; };
  }, [text, fill, still]);
  await C.page.locator('#page button', { hasText: 'Add from a link' }).click(); await C.page.waitForSelector('.sheet textarea');
  const boxSize = await C.page.evaluate(() => ({ box: parseFloat(getComputedStyle(document.querySelector('.sheet textarea.share-link')).fontSize), root: parseFloat(getComputedStyle(document.documentElement).fontSize) }));
  ok('the box a link is pasted into is as large as the page’s text, not 12 pixels', boxSize.box === boxSize.root && boxSize.box >= 16, JSON.stringify(boxSize));
  await C.page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new Error('no camera here'); }; });
  await C.page.locator('.sheet button:has-text("Scan a QR code")').click(); await C.page.waitForFunction(() => /Camera unavailable/.test((document.querySelector('.sheet .scan-status') || {}).textContent || ''), null, { timeout: 8000 });
  ok('with no camera, the scanner says to paste the link (not a code)', /Camera unavailable: no camera here\. Paste the link instead\./.test(await C.page.locator('.sheet .scan-status').innerText()));
  await C.page.locator('.sheet button:has-text("Stop the camera")').click();
  await fakeCamera(C.page, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Producer;Pat;;;\r\nFN:Pat Producer\r\nTEL;TYPE=CELL:+44 20 7946 0100\r\nEND:VCARD');
  await C.page.locator('.sheet button:has-text("Scan a QR code")').click();
  await C.page.waitForFunction(() => { const a = document.querySelector('.sheet [role=alert]'); return a && !a.hidden; }, null, { timeout: 30000 });
  ok('scanning the Phone contacts code says it is a QR code that is not a Vdex link, and which code to scan', /That QR code is not a Vdex link\. On their Me page the code has to be set to Contact card/.test(await C.page.locator('.sheet [role=alert]').innerText()) && !/long run of letters/.test(await C.page.locator('.sheet [role=alert]').innerText()), await C.page.locator('.sheet [role=alert]').innerText());
  const own = await C.page.evaluate(() => import('./js/share-data.js').then(m => m.QR_OWN));
  // The filler is the same text in every run (a fixed sequence, not Math.random), so every run scans the same code.
  const longCard = n => C.page.evaluate(async ([n, base]) => { const { pack } = await import('./js/link-pack.js'), o = { v: 1, kind: 'contact', name: 'Long Link Lou', phone: '555 0190', location: '' }, link = async () => base + 'shared.html#' + await pack(o); let l = await link();
    let x = 20261118; const more = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x.toString(36); };
    while (l.length <= n) { o.location += more(); l = await link(); } while (l.length > n) { o.location = o.location.slice(0, -2); l = await link(); } return l; }, [n, BASE]);
  const ownLink = await longCard(own);
  await fakeCamera(C.page, ownLink);
  await C.page.locator('.sheet button:has-text("Scan a QR code")').click();
  const scanned = await C.page.waitForSelector('.sheet .add-preview', { timeout: 60000 }).then(() => true, () => false);
  ok(`Vdex’s own scanner reads a link of the longest length it is said to read (${ownLink.length} characters, held at about three quarters of the frame, slightly blurred)`, scanned && own >= 1000 && ownLink.length > own - 12 && /Long Link Lou/.test(await sheetText(C.page)), `${ownLink.length} of ${own}`);
  const asked = await C.page.evaluate(() => window.__camAsked[window.__camAsked.length - 1] || null);
  ok('…having asked for the back camera and a 1080-line picture, which the squares of a long code need', !!asked && asked.audio === false && !!asked.video && asked.video.facingMode === 'environment' && !!asked.video.width && asked.video.width.ideal >= 1920 && !!asked.video.height && asked.video.height.ideal >= 1080, JSON.stringify(asked));
  await C.page.evaluate(() => clearInterval(window.__cam)); await C.page.keyboard.press('Escape'); await sleep(200);
  // Held further away, so the code takes about half of the picture: its squares are then too fine for the small
  // sample alone (1.5 pixels each), and only the look at full size reads it. The code is held still here, so the
  // case does not lean on the luck of a swinging picture against the clock: each look of the scanner is noted with
  // its size and whether it read the code, and what counts is which look read it.
  await C.page.locator('#page button', { hasText: 'Add from a link' }).click(); await C.page.waitForSelector('.sheet textarea');
  const farLink = await longCard(own);
  await fakeCamera(C.page, farLink, 0.5, true);
  await C.page.evaluate(() => { const real = window.jsQR; window.__looks = []; window.jsQR = (data, w, h, o) => { const r = real(data, w, h, o); window.__looks.push([w, !!(r && r.data)]); return r; }; });
  await C.page.locator('.sheet button:has-text("Scan a QR code")').click();
  const far = await C.page.waitForSelector('.sheet .add-preview', { timeout: 60000 }).then(() => true, () => false);
  const looks = await C.page.evaluate(() => window.__looks), SMALL = await C.page.evaluate(() => import('./js/qr.js').then(m => m.SCAN.SMALL)), last = looks[looks.length - 1] || [0, false];
  ok('…and reads it held further away, at about half of the frame: the small look does not read it, and the look at full size does', far && /Long Link Lou/.test(await sheetText(C.page)) && last[1] && last[0] > SMALL && looks.some(([w]) => w <= SMALL) && !looks.some(([w, read]) => read && w <= SMALL), `${farLink.length} characters; looks (size, read): ${JSON.stringify(looks.slice(-8))}`);
  await C.page.evaluate(() => clearInterval(window.__cam)); await C.page.keyboard.press('Escape'); await sleep(200);
  await C.ctx.close();

  /* ============================== equipment by link: one's own list, Undo, long lists ============================== */
  // the sender opens an old link to their own list, after changing an item and a kit since
  const ownAll = await A.page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/share-out.js')]).then(async ([s, m]) => {
    const link = await m.gearLink({ items: [...s.db.gear], kits: s.db.kits });
    const g = s.db.gear[0], k = s.db.kits[0], other = s.db.gear.find(x => !k.gear.includes(x.id)), was = g.value, kitSize = k.gear.length + 1;
    s.update(d => { Object.assign(d.gear.find(x => x.id === g.id), { value: 12345, location: 'NEW PLACE', updatedAt: Date.now() }); const kk = d.kits.find(x => x.id === k.id); kk.gear = [...kk.gear, other.id]; kk.updatedAt = Date.now(); });
    return { link, id: g.id, was, kit: k.id, kitSize, n: s.db.gear.length };
  }));
  await arrive(A.page, hashOf(ownAll.link));
  const og = await sheetText(A.page), goBtn = A.page.locator('.sheet .add-go');
  ok('one’s own equipment link: the list says the items are one’s own and leaves them as they are', /These are your own items: the list was made from them\. They are left as they are unless you choose otherwise/.test(og) && (await A.page.locator('.sheet .add-dup select').evaluateAll(els => els.every(s => s.value === 'skip'))) && new RegExp(`${ownAll.n} left as they are`).test(await A.page.locator('.sheet .add-sum').innerText()), og.replace(/\s+/g, ' ').slice(0, 260));
  ok('…with nothing to do, the button says so and cannot be tapped, and each kit stays as it is', (await goBtn.innerText()) === 'Nothing to add' && await goBtn.isDisabled() && (await A.page.locator('.sheet .add-kits li').allInnerTexts()).every(t => /stays as it is: every item of it is skipped/.test(t)), await goBtn.innerText());
  await A.page.locator('.sheet .add-dup select').first().selectOption('update');
  ok('choosing Update for one item names the button after what it will do', (await goBtn.innerText()) === 'Update 1 item' && !(await goBtn.isDisabled()) && /1 to update/.test(await A.page.locator('.sheet .add-sum').innerText()), await goBtn.innerText());
  await A.page.locator('.sheet .add-all select').selectOption('update');
  ok('…and for all of them, with the kits they are in now said to be updated', (await goBtn.innerText()) === `Update ${ownAll.n} items` && (await A.page.locator('.sheet .add-kits li').allInnerTexts()).every(t => /is updated$/.test(t)), await goBtn.innerText());
  await goBtn.click(); await A.page.waitForSelector('.undo-bar', { timeout: 15000 }); await sleep(300);
  const rolled = await A.page.evaluate(o => import('./js/store.js').then(s => ({ value: s.byId('gear', o.id).value, kit: s.byId('kits', o.kit).gear.length, bar: document.querySelector('.undo-bar').innerText, focus: document.activeElement && document.activeElement.textContent })), ownAll);
  ok('an equipment link is followed by the same Undo as a file import, with the focus on it', /updated/.test(rolled.bar) && rolled.focus === 'Undo' && rolled.value === ownAll.was && rolled.kit === ownAll.kitSize - 1, JSON.stringify(rolled));
  await A.page.locator('.undo-bar button', { hasText: 'Undo' }).click(); await sleep(400);
  const undone = await A.page.evaluate(o => import('./js/store.js').then(s => ({ value: s.byId('gear', o.id).value, location: s.byId('gear', o.id).location, kit: s.byId('kits', o.kit).gear.length, bar: document.querySelectorAll('.undo-bar').length })), ownAll);
  ok('…and Undo puts back what the link overwrote: the item and the kit as they were before it', undone.value === 12345 && undone.location === 'NEW PLACE' && undone.kit === ownAll.kitSize && undone.bar === 0, JSON.stringify(undone));

  // ---- how a link's QR code is drawn ----
  const qrOf = async () => { await A.page.evaluate(() => window.logiGo('gear')); await sleep(300); await A.page.locator('#page .subactions button', { hasText: 'Share…' }).click(); await A.page.locator('.sheet button:has-text("Make the link")').click(); await A.page.waitForSelector('.sheet .share-qr svg', { timeout: 8000 }); await sleep(200);
    const r = await A.page.evaluate(() => ({ len: document.querySelector('.sheet textarea.share-link').value.length, large: document.querySelector('.sheet .share-qr').classList.contains('large'), width: Math.round(document.querySelector('.sheet .share-qr svg').getBoundingClientRect().width), note: document.querySelector('.sheet .share-qr-note').textContent })); await A.page.keyboard.press('Escape'); await sleep(200); return r; };
  const limits = await A.page.evaluate(() => import('./js/share-data.js').then(m => ({ own: m.QR_OWN, large: m.QR_LARGE, max: m.QR_MAX })));
  const keepGear = await A.page.evaluate(() => import('./js/store.js').then(s => { const all = JSON.stringify(s.db.gear); s.update(d => { d.gear = d.gear.slice(0, 2).map(g => ({ ...g, notes: '', location: '' })); }); return all; }));
  const q1 = await qrOf();
  ok('a short link’s code is drawn at the usual size, with no caution', q1.len <= limits.large && !q1.large && q1.width <= 200 && /^A workmate can scan this to open the list on their phone$/.test(q1.note), JSON.stringify(q1));
  await A.page.evaluate(async own => { const s = await import('./js/store.js'), m = await import('./js/share-out.js'); for (let i = 0; i < 80 && (await m.gearLink()).length <= own + 60; i++) s.update(d => { d.gear.push({ id: 'qr' + i, name: 'Lens ' + Math.random().toString(36).slice(2), category: 'Lenses', serial: 'SN' + Math.random().toString(36).slice(2, 12), qty: 1, value: 100 + i, notes: Math.random().toString(36).slice(2) }); }); }, limits.own);
  const q2 = await qrOf();
  ok('a long link’s code is drawn larger, and one longer than Vdex’s own scanner reads says a phone’s camera may read it and to send the link if it will not scan', q2.len > limits.own && q2.len <= limits.max && q2.large && q2.width > 250 && q2.width <= 352 && /A workmate can scan this to open the list on their phone\. This is a long code\. A phone’s camera may read it; the scanner inside Vdex may not\. If it will not scan, send the link instead\.$/.test(q2.note), JSON.stringify(q2));
  await A.page.evaluate(all => import('./js/store.js').then(s => s.update(d => { d.gear = JSON.parse(all); })), keepGear);

  // a list longer than one link carries
  const many = n => ({ v: 1, kind: 'gear', made: Date.now(), title: '', currency: '$', by: { name: 'Pat Producer' }, items: Array.from({ length: n }, (_, i) => ({ ref: 'r' + i, name: 'Item ' + i, category: i < n - 300 ? 'Camera' : 'Support', value: i })) });
  const bigList = { ...many(2400), kits: [{ ref: 'kk', name: 'Late kit', items: [[5, 1], [2100, 1], [2399, 2]] }] };
  const E = await open({ width: 390, height: 800 });
  await E.ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const bigPacked = await pack(bigList);
  const bigRead = await E.page.goto(BASE + 'shared.html#' + bigPacked).then(() => E.page.waitForSelector('.paper h1')).then(() => E.page.evaluate(() => import('./js/share-data.js').then(m => m.readShared(location.hash)).then(g => ({ items: g.items.length, cut: g.cut, kit: g.kits[0].items.length, max: null }))));
  ok('a list of 2,400 items is read as its first 2,000, and says how many were left out', bigRead.items === 2000 && bigRead.cut === 400 && bigRead.kit === 1, JSON.stringify(bigRead));
  ok('…on its page', /only its first 2,000 items are here, and 400 more items are not\. Ask Pat Producer for the rest in a second link/.test(await E.page.locator('.paper').innerText()));
  await arrive(E.page, bigPacked);
  ok('…and in the preview before adding', /only its first 2,000 items are here, and 400 more items are not/.test(await E.page.locator('.sheet .add-cut').innerText()) && (await E.page.locator('.sheet .add-go').innerText()) === 'Add 2,000 items to my Equipment');
  const foot = await E.page.evaluate(() => { const r = el => el.getBoundingClientRect(), go = r(document.querySelector('.sheet .add-go')), sum = r(document.querySelector('.sheet .add-sum')), cancel = r([...document.querySelectorAll('.sheet .add-actions .btn')].pop()), body = document.querySelector('.sheet .sheet-body'); return { go: go.top >= 0 && go.bottom <= innerHeight, sum: sum.top >= 0 && sum.bottom <= innerHeight && sum.bottom <= go.top + 1, cancel: cancel.bottom <= innerHeight, long: body.scrollHeight > body.clientHeight * 5, top: body.scrollTop }; });
  ok('in a long list the count, Add and Cancel stay in view from the start, with every item still listed above them', foot.go && foot.sum && foot.cancel && foot.long && foot.top === 0 && (await E.page.locator('.sheet .add-items li').count()) === 2000, JSON.stringify(foot));
  await E.page.keyboard.press('Escape'); await sleep(200);
  const places = await E.page.evaluate(async () => { const lp = await import('./js/link-pack.js'), sd = await import('./js/share-data.js'); const g = await sd.readShared('#' + await lp.pack({ v: 1, kind: 'gear', items: Array.from({ length: 100 }, (_, i) => ({ name: 'I' + i })), kits: Array.from({ length: 200 }, (_, k) => ({ name: 'K' + k, items: Array.from({ length: 100 }, (_, i) => [i, 1]) })) })); return g.kits.reduce((n, k) => n + k.items.length, 0); });
  ok('all the kits of one link together name 5,000 places at most (a hand-built link asked for 20,000)', places === 5000, String(places));
  // the sender is told before a link like that is made
  await E.page.goto(BASE); await E.page.waitForSelector('#rolodex .drum-btn');
  await E.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { for (let i = 0; i < 2001; i++) d.gear.push({ id: 'm' + i, name: 'Thing ' + i, category: 'Accessories', serial: '', qty: 1, value: 1, notes: '' }); })));
  await E.page.evaluate(() => window.logiGo('gear')); await sleep(600);
  await E.page.locator('#page .subactions button', { hasText: 'Share…' }).click(); await E.page.locator('.sheet button:has-text("Make the link")').click(); await sleep(600);
  ok('sharing more than 2,000 items makes no link and says to share in parts', /One link carries 2,000 items at most, and this is 2,001\. Share it in parts: one kit at a time, or pick items/.test(await E.page.locator('.sheet .share-many').innerText()) && (await E.page.locator('.sheet textarea.share-link').count()) === 0);
  await E.page.keyboard.press('Escape'); await sleep(200);

  // ---- the shared pages: for someone whose Vdex is an app, and for the Play app ----
  for (const [name, link, where] of [['a contact card', cardLink, 'Crew'], ['an equipment list', kitLink, 'Equipment'], ['a shoot', link1, 'Bookings']]) {
    await E.page.goto(link); await E.page.waitForSelector('.paper h1');
    const line = await E.page.locator('.bar .elsewhere').innerText();
    await E.page.locator('.bar .elsewhere button', { hasText: 'Copy link' }).click(); await sleep(200);
    const copied = await E.page.evaluate(() => navigator.clipboard.readText());
    ok(`the page of ${name} says that Add to my Vdex opens this browser’s Vdex, and gives the link to copy for an app’s Add from a link`, new RegExp(`Add to my Vdex opens Vdex in this browser\\. A Vdex on an iPhone’s Home Screen, the iPhone app and the desktop app are each a separate copy: for one of those, copy this link and use Add from a link on its ${where} page`).test(line) && copied === link && /Link copied\./.test(await E.page.locator('.bar .elsewhere [role=status]').innerText()) && (await E.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), line);
  }
  const hrefs = await E.page.evaluate(() => import('./js/share-data.js').then(m => [m.addHref('#1.abc', 'android-app://app.crowmade.vdex/'), m.addHref('#1.abc', 'android-app://app.crowmade.vdex'), m.addHref('#1.abc', ''), m.addHref('#1.abc', 'https://vdex.crowmade.app/'), m.addHref('#1.abc', 'android-app://app.crowmade.vdex.evil/')]));
  ok('opened by the Play app, Add to my Vdex carries the app’s mark into the app; from anywhere else it does not', JSON.stringify(hrefs) === JSON.stringify(['index.html?src=play#add=1.abc', 'index.html?src=play#add=1.abc', 'index.html#add=1.abc', 'index.html#add=1.abc', 'index.html#add=1.abc']) && (await E.page.locator('a.btn.primary').getAttribute('href')) === 'index.html#add=' + hashOf(link1), JSON.stringify(hrefs));
  await E.page.goto(BASE + 'index.html?src=play#add=' + hashOf(cardLink)); await E.page.waitForSelector('.sheet .add-preview', { timeout: 15000 });
  ok('…and the app keeps that mark in its address while the link itself is taken out of it', (await E.page.evaluate(() => location.search + '|' + location.hash)) === '?src=play|' && /Add this contact\?/.test(await sheetText(E.page)));
  await E.page.keyboard.press('Escape'); await sleep(200);
  // The pages themselves have to pass the browser's referrer on, which the call above does not show. A referrer stands
  // in here on the two shared pages only, as in real use: the Play app opens the shared page, and the app's own page
  // is then opened from that page, so its referrer is the shared page and the mark can only come with the link.
  for (const [ref, mark] of [['android-app://app.crowmade.vdex/', '?src=play'], ['android-app://com.example.other/', '']]) {
    const P = await open({ init: `if (/\\/(crew|shared)\\.html$/.test(location.pathname)) Object.defineProperty(Document.prototype, 'referrer', { configurable: true, get: () => ${JSON.stringify(ref)} });` });
    const got = [];
    for (const link of [cardLink, link1]) { await P.page.goto(link); await P.page.waitForSelector('a.btn.primary'); got.push(await P.page.locator('a.btn.primary').first().getAttribute('href')); }
    await Promise.all([P.page.waitForURL(/index\.html/), P.page.locator('a.btn.primary', { hasText: 'Add to my Vdex' }).click()]);
    await P.page.waitForSelector('.sheet .add-preview', { timeout: 15000 }); await sleep(400);
    const at = await P.page.evaluate(() => location.search + '|' + location.hash), kept = await P.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('vdex-licence')).play === true; } catch { return false; } });
    ok(mark ? 'the contact card’s page and the shoot’s page, opened by the Play app, put the app’s mark in their Add to my Vdex link, and the app it opens starts with the mark and keeps it' : '…and opened by another app they do not, and the app keeps no mark', got.join('|') === [cardLink, link1].map(l => `index.html${mark}#add=${hashOf(l)}`).join('|') && at === mark + '|' && kept === !!mark, JSON.stringify([got.map(g => g.replace(/#add=.*/, '#add=…')), at, kept]));
    await P.ctx.close();
  }

  // ---- the Me page's code ----
  await E.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Uma Owner', phone: '+1 555 0500', email: 'uma@ownerfilms.example', updatedAt: Date.now() }; })));
  await E.page.evaluate(() => window.logiGo('me')); await E.page.waitForSelector('#page .qr svg', { timeout: 8000 });
  ok('the Contact card code says the other phone needs a connection, and which code works without one', /The other phone needs a connection; Phone contacts works without one\./.test(await E.page.locator('#page .qr-cap').innerText()));
  await E.page.locator('#page .me-modes button', { hasText: 'Phone contacts' }).click(); await E.page.waitForSelector('#page .qr svg'); await sleep(200);
  await E.page.reload(); await E.page.waitForSelector('#rolodex .drum-btn'); await E.page.evaluate(() => window.logiGo('me')); await E.page.waitForSelector('#page .qr svg', { timeout: 8000 });
  ok('the code chosen is remembered on this device: after a reload it is still Phone contacts', (await E.page.locator('#page .me-modes button.on').innerText()) === 'Phone contacts' && /No connection needed/.test(await E.page.locator('#page .qr-cap').innerText()) && (await E.page.evaluate(() => localStorage.getItem('logi-me-code'))) === 'vcard');

  // ---- text from a link in the spreadsheets Vdex writes, and the name an invoice is listed under ----
  // The link-made booking (its invoice is headed to the sender, here a business whose name starts like a formula) beside
  // two bookings of one's own: one with a client, one with only a contact.
  await arrive(E.page, await pack(shoot({ ref: 'REF-CSV', title: '=HYPERLINK("https://evil.example","Open")', client: '+SUM(1,2)', by: { name: 'Pat Producer', business: '-2+3 Films', email: 'pat@quayfilms.example' } })));
  await E.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await E.page.waitForSelector('.bk-detail'); await sleep(300);
  await E.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { const x = d.bookings[0]; x.invoice = { number: 'INV-0009', date: x.date, due: x.date, lines: [{ id: 'l', desc: 'Day', qty: 1, unit: 'day', price: 100 }], taxRate: 0, deposit: 150, status: 'Sent' };
    d.shifts.push({ id: 'sh1', bookingId: x.id, date: x.date, kind: 'shoot', start: Date.now() - 8 * 36e5, end: Date.now() - 36e5, breaks: [], note: '@cmd' }); x.updatedAt = Date.now();
    d.bookings.push({ id: 'own-job', title: 'Own job', client: 'Harbour Bakery', date: x.date, start: '09:00', end: '17:00', status: 'Confirmed', address: '', stakeholders: [{ name: 'Bea Baker', role: 'Owner', email: 'bea@harbourbakery.example' }], crew: [], gear: [], notes: '', invoice: { number: 'INV-0010', date: x.date, due: x.date, lines: [{ id: 'o', desc: 'Edit day', qty: 1, unit: 'day', price: 300 }], taxRate: 0, status: 'Sent' }, updatedAt: Date.now() },
      { id: 'own-bare', title: 'No client yet', client: '', date: x.date, start: '09:00', end: '17:00', status: 'Enquiry', address: '', stakeholders: [{ name: 'Zed Contact', role: '', email: '' }], crew: [], gear: [], notes: '', quote: { number: 'Q-0003', date: x.date, lines: [{ id: 'q', desc: 'Day', qty: 1, unit: 'day', price: 50 }], taxRate: 0, status: 'Draft' }, updatedAt: Date.now() }); })));
  const moneyRows = async () => { await E.page.evaluate(() => import('./js/money.js').then(m => m.openMoney(() => {}))); await E.page.waitForSelector('.sheet .stats'); return E.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sheet .list .card.tap')].map(c => [c.querySelector('strong').textContent, c.querySelector('.muted.small').textContent]))); };
  const invoicesCsv = async () => { const [dl] = await Promise.all([E.page.waitForEvent('download', { timeout: 15000 }), E.page.locator('.sheet button:has-text("Invoices (CSV)")').click()]); return fs.readFileSync(await dl.path(), 'utf8').split('\r\n'); };
  const rows1 = await moneyRows(), csv1 = await invoicesCsv(), invText = csv1[1];
  const cells = await E.page.evaluate(() => import('./js/backup.js').then(m => [m.csvText('=1+1'), m.csvText('-5 gels'), m.csvText('@x'), m.csvText('Plain "quoted"'), m.csvCell(-50), m.csvCell('2026-11-28')]));
  ok('the invoices spreadsheet keeps a title and a sender’s business from a link as text (an apostrophe in front of = and -), and its amounts and dates as they are', invText.includes(`"'-2+3 Films","'=HYPERLINK(""https://evil.example"",""Open"")","100.00"`) && invText.startsWith('"INV-0009","') && !/"'\d/.test(invText) && JSON.stringify(cells) === JSON.stringify([`"'=1+1"`, `"'-5 gels"`, `"'@x"`, '"Plain ""quoted"""', '"-50"', '"2026-11-28"']), invText + ' ' + cells.join(' '));
  // who an invoice is for, wherever it is named: the Money overview, the spreadsheet, the Money page, the search, the
  // document, its link, its PDF and its emails
  const HEAD = '-2+3 Films', TITLE = '=HYPERLINK("https://evil.example","Open")';
  ok('the Money overview lists an invoice on a booking from a link under the name it is headed to, the sender, not under the sender’s client', (rows1[TITLE] || '').startsWith(HEAD + ' · ') && !/SUM/.test(rows1[TITLE]), JSON.stringify(rows1));
  ok('…and so does the Client column of the invoices spreadsheet', csv1[0].split(',')[3] === '"Client"' && invText.split('","')[3] === `'${HEAD}` && !invText.includes('SUM(1,2)'), invText);
  ok('a booking of one’s own is listed under its client as before, there and in the spreadsheet; one with no client shows none (a contact’s name is not put in its place)', (rows1['Own job'] || '').startsWith('Harbour Bakery · ') && /^"INV-0010",.*"Harbour Bakery","Own job","300\.00"/.test(csv1[2]) && !!rows1['No client yet'] && !/Zed|·/.test(rows1['No client yet']), JSON.stringify([rows1, csv1[2]]));
  await E.page.keyboard.press('Escape'); await sleep(200);
  const linkId = await E.page.evaluate(() => import('./js/store.js').then(s => s.db.bookings[0].id));
  const moneyHead = async id => { await E.page.evaluate(id => window.logiGo('bookings').then(() => import('./js/pages/bookings.js')).then(m => m.openBooking(id, { view: 'money', kind: 'invoice' })), id); await E.page.waitForSelector('.money-page .money-doc'); await sleep(200); return E.page.evaluate(() => ({ head: document.querySelector('.money-page > .muted').textContent, to: [...document.querySelectorAll('.money-page .money-parties > div')][1].innerText.split('\n').slice(1) })); };
  const pageLink = await moneyHead(linkId), pageOwn = await moneyHead('own-job');
  ok('the Money page names the same one above the document as the document is headed to; a booking of one’s own shows its client', pageLink.head === `${TITLE} · ${HEAD}` && pageLink.to[0] === HEAD && !/SUM/.test(pageLink.head + pageLink.to.join()) && pageOwn.head === 'Own job · Harbour Bakery' && pageOwn.to[0] === 'Harbour Bakery', JSON.stringify([pageLink, pageOwn]));
  const found = await E.page.evaluate(() => import('./js/search.js').then(m => { m.buildIndex(); const pick = q => m.search(q, 'money').map(r => `${r.title} | ${r.meta}`); return { byNumber: pick('INV-0009'), bySender: pick('films'), byClient: pick('sum'), own: pick('INV-0010'), ownByClient: pick('bakery'), bare: pick('Q-0003'), bareByContact: pick('zed') }; }));
  ok('the search lists that invoice with the sender’s name, finds it by that name, and still finds it by the client on the booking', found.byNumber.length === 1 && found.byNumber[0].startsWith(`Invoice INV-0009 | ${TITLE} · ${HEAD} · Sent`) && found.bySender.join() === found.byNumber.join() && found.byClient.join() === found.byNumber.join(), JSON.stringify(found));
  ok('…and one’s own invoices and quotes are listed and found as before', found.own.length === 1 && found.own[0].startsWith('Invoice INV-0010 | Own job · Harbour Bakery · Sent') && found.ownByClient.join() === found.own.join() && found.bare.length === 1 && found.bare[0].startsWith('Quote Q-0003 | No client yet · Draft') && found.bareByContact.length === 0, JSON.stringify(found));
  const docs = await E.page.evaluate(id => Promise.all([import('./js/store.js'), import('./js/money.js'), import('./js/money-doc.js')]).then(async ([s, m, d]) => { const b = s.byId('bookings', id), snap = m.snapshot(b, 'invoice'), mail = k => decodeURIComponent(m.mailtoFor(b, 'invoice', 'https://x.example/i', k)), pdf = d.pdfBlocks(snap); return { link: await m.shareLink(b, 'invoice'), text: m.moneyText(b, 'invoice').split('\n')[2], pdfTo: pdf[pdf.findIndex(x => x.type === 'heading' && x.text === 'To') + 1].text.split('\n')[0], send: mail('send'), remind: mail('remind'), named: m.billedName(b) }; }), linkId);
  const pub = await E.ctx.newPage(); await pub.goto(docs.link); await pub.waitForSelector('.paper .money-doc');
  const pubTo = await pub.evaluate(() => [...document.querySelectorAll('.money-parties > div')][1].innerText.split('\n').slice(1)); await pub.close();
  ok('the page the link opens, the PDF, the text and both emails all name the sender, and none of them the sender’s client', pubTo[0] === HEAD && docs.pdfTo === HEAD && docs.text === `To: ${HEAD}, Pat Producer · Producer · ${HEAD} · pat@quayfilms.example` && docs.named === HEAD && docs.send.startsWith('mailto:pat@quayfilms.example?') && docs.remind.startsWith('mailto:pat@quayfilms.example?') && ![pubTo.join(), docs.pdfTo, docs.text, docs.send, docs.remind].some(t => /SUM\(1,2\)/.test(t)), JSON.stringify([pubTo, docs.pdfTo, docs.text, docs.named]));
  // the client changed by hand heads the document again, and every list follows
  await E.page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.id === id); x.client = 'Lantern Studios'; x.updatedAt = Date.now(); })), linkId);
  const rows2 = await moneyRows(), csv2 = await invoicesCsv();
  const after = await E.page.evaluate(id => Promise.all([import('./js/store.js'), import('./js/money.js'), import('./js/search.js')]).then(([s, m, q]) => { q.buildIndex(); const b = s.byId('bookings', id); return { to: m.snapshot(b, 'invoice').to[0], search: q.search('INV-0009', 'money').map(r => r.meta) }; }), linkId);
  ok('with the client changed by hand the document is headed to that client, and the overview, the spreadsheet and the search say the same', after.to === 'Lantern Studios' && (rows2[TITLE] || '').startsWith('Lantern Studios · ') && csv2[1].split('","')[3] === 'Lantern Studios' && after.search.length === 1 && after.search[0].startsWith(`${TITLE} · Lantern Studios · Sent`), JSON.stringify([after, rows2[TITLE], csv2[1]]));
  await E.page.keyboard.press('Escape'); await sleep(200);
  await E.page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(b => b.id === id); x.client = '+SUM(1,2)'; x.updatedAt = Date.now(); })), linkId);
  await E.page.evaluate(id => import('./js/hours.js').then(m => m.openHoursSheet(id)), linkId); await E.page.waitForSelector('.sheet button:has-text("CSV")');
  const [hrs] = await Promise.all([E.page.waitForEvent('download', { timeout: 15000 }), E.page.locator('.sheet button:has-text("CSV")').click()]);
  const hrsText = fs.readFileSync(await hrs.path(), 'utf8').split('\n')[1];
  ok('the hours spreadsheet guards its text too, for the project, the client and the note (hours belong to the booking, so the client there is the booking’s)', hrsText.includes(`"'=HYPERLINK(""https://evil.example"",""Open"")","'+SUM(1,2)"`) && hrsText.endsWith(`"'@cmd"`), hrsText);
  await E.page.keyboard.press('Escape'); await sleep(200);
  // ---- the TC Notes spreadsheet: a note, and a script line that came from someone else's script ----
  await E.page.evaluate(() => import('./js/store.js').then(s => s.upsert('logs', { id: 'log-csv', title: 'Formula log', created: '2026-11-18', rate: '25', mode: 'free', camera: '', sync: null, script: null, notes: [
    { id: 'n1', frames: 2250000, text: '=1+1', at: '2026-11-18T10:00:00.000Z' }, { id: 'n2', frames: 2250025, text: 'said, "twice"', quote: '-Who is there?', start: 3, at: '2026-11-18T10:00:01.000Z' },
    { id: 'n3', frames: 2250050, text: '', dur: '00:00:02:00', quote: '+44 on the door', at: '=NOW()' }, { id: 'n4', frames: 2250075, text: '@home take, good', at: '2026-11-18T10:00:03.000Z' }, { id: 'n5', frames: 2250100, text: 'Plane overhead', at: '2026-11-18T10:00:04.000Z' }] })));
  await E.page.evaluate(() => window.logiGo('tcnotes').then(() => import('./js/pages/tcnotes.js')).then(m => m.openLog('log-csv'))); await E.page.waitForSelector('.tc-log-head');
  await E.page.locator('.tc-log-head .actions button', { hasText: 'Export' }).click(); await E.page.waitForSelector('.sheet button:has-text("Share as spreadsheet")');
  const [tc] = await Promise.all([E.page.waitForEvent('download', { timeout: 15000 }), E.page.locator('.sheet button:has-text("Share as spreadsheet")').click()]);
  const tcRows = fs.readFileSync(await tc.path(), 'utf8').split('\n');
  ok('the TC Notes spreadsheet keeps a note and a script line that start like a formula as text, as the others do', tcRows[0] === 'Timecode,Note,Script line,Captured' && /^\d\d:\d\d:\d\d:\d\d,"'=1\+1","",2026-11-18T10:00:00\.000Z$/.test(tcRows[1]) && tcRows[2].includes(`,"said, ""twice""","'-Who is there?",2026-11-18T10:00:01.000Z`) && tcRows[3].includes(`," [00:00:02:00]","'+44 on the door","'=NOW()"`) && tcRows[4].includes(`,"'@home take, good","",`), tcRows.slice(1, 5).join(' ¶ '));
  ok('…and leaves a plain note, the timecode and the time it was captured exactly as they were', /^\d\d:\d\d:\d\d:\d\d,"Plane overhead","",2026-11-18T10:00:04\.000Z$/.test(tcRows[5]) && tcRows.length === 7 && tcRows[6] === '', tcRows[5]);
  await E.page.keyboard.press('Escape'); await sleep(200);
  await E.ctx.close();

  /* ============================== a link too big for the browser's storage ============================== */
  const big = await pack({ ...shoot({ ref: 'REF-BIG', title: 'Too big' }), scenes: Array.from({ length: 200 }, (_, d) => ({ n: d + 1, items: Array.from({ length: 400 }, (_, i) => ({ banner: 'A banner of twenty ch' })) })) });
  const G = await open();
  await G.page.goto(BASE); await G.page.waitForSelector('#rolodex .drum-btn');
  const bigSnap = await G.page.evaluate(l => import('./js/share-data.js').then(m => m.readShared(l)).then(s => ({ strips: s.scenes.reduce((n, d) => n + d.items.length, 0), cut: s.cut })), '#' + big);
  ok('a hand-built link of 200 days of 400 banners brings 2,500 strips at most, and counts the rest as left out', bigSnap.strips === 2500 && bigSnap.cut === 77500 && big.length < 20000, JSON.stringify(bigSnap));
  const manyCast = await G.page.evaluate(async () => { const lp = await import('./js/link-pack.js'), sd = await import('./js/share-data.js'), si = await import('./js/share-import.js'); let n = 0;
    const snap = await sd.readShared('#' + await lp.pack({ v: 1, kind: 'crew', ref: 'REF-CAST', title: 'Cast', date: '2027-01-05', scenes: Array.from({ length: 40 }, (_, d) => ({ n: d + 1, items: Array.from({ length: 12 }, () => ({ scene: String(n), cast: Array.from({ length: 100 }, () => 'N' + n++) })) })) }));
    const t = performance.now(), p = si.planBooking(snap); return { names: p.booking.board.cast.length, ms: Math.round(performance.now() - t), strips: p.booking.board.list.filter(x => x.type === 'scene').length }; });
  ok('…and 1,000 different cast names at most (a link asked for 48,000), so its preview is worked out at once', manyCast.names === 1000 && manyCast.strips === 480 && manyCast.ms < 1500, JSON.stringify(manyCast));
  // nearly full: about 150,000 characters free, and the capped booking needs about twice that
  const room = page => page.evaluate(() => { let lo = 0, hi = 12e6; while (hi - lo > 256) { const mid = (lo + hi) >> 1; try { localStorage.setItem('zz-room', 'x'.repeat(mid)); lo = mid; } catch { hi = mid; } } localStorage.removeItem('zz-room'); return lo; });
  const pad = (page, by) => page.evaluate(n => import('./js/store.js').then(s => { s.update(d => { d.profile = { ...d.profile, bio: (d.profile.bio || '') + 'b'.repeat(n) }; }); }), by);
  const onDisk = page => page.evaluate(() => { const d = JSON.parse(localStorage.getItem('logi-db-v1') || '{}'); return { bookings: (d.bookings || []).length, gear: (d.gear || []).length, name: (d.profile || {}).name || '' }; });
  await pad(G.page, (await room(G.page)) - 150000); await sleep(300);
  const free = await room(G.page);
  await arrive(G.page, big);
  const bigPv = await sheetText(G.page);
  ok('its preview counts the banners and says strips were left out', /2,500 banners on its stripboard, over 7 shooting days\. The link holds more than one shoot may bring: 77,500 more strips are left out/.test(bigPv), (bigPv.match(/Scenes[^\n]*\n[^\n]*/) || [''])[0]);
  await G.page.locator('.sheet button:has-text("Add to my Bookings")').click(); await sleep(800);
  const refused = await G.page.evaluate(() => { const p = document.querySelector('.sheet .add-refused'); return { text: p && !p.hidden ? p.textContent : '', sheets: document.querySelectorAll('.sheet .add-preview').length, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') }; });
  const inMem = (await db(G.page)).bookings.length;
  ok(`with ${free.toLocaleString()} characters free, a booking that would not fit is turned down in a sentence before anything is changed`, /This booking is bigger than the space Vdex has on this device, so nothing was added\. Free some space first \(erase old logs and bookings\), or ask for a link with fewer parts ticked\./.test(refused.text) && refused.sheets === 1 && !/Added/.test(refused.toasts) && inMem === 0 && (await onDisk(G.page)).bookings === 0, JSON.stringify(refused));
  await G.page.keyboard.press('Escape'); await sleep(200);
  await G.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, name: 'Still Saving' }; }))); await sleep(400);
  ok('…so the next change is saved as always, and survives a reload', (await onDisk(G.page)).name === 'Still Saving' && await (async () => { await G.page.reload(); await G.page.waitForSelector('#rolodex .drum-btn'); return (await db(G.page)).profile.name === 'Still Saving' && (await db(G.page)).bookings.length === 0; })());
  const fatList = await pack({ v: 1, kind: 'gear', by: { name: 'Pat Producer' }, items: Array.from({ length: 900 }, (_, i) => ({ ref: 'f' + i, name: 'Fat item ' + i, notes: 'n'.repeat(300) + i })), kits: [{ ref: 'fk', name: 'Fat kit', items: [[0, 1], [1, 1]] }] });
  await arrive(G.page, fatList);
  await G.page.locator('.sheet .add-go').click(); await sleep(800);
  const refused2 = await G.page.evaluate(() => { const p = document.querySelector('.sheet .add-refused'); return p && !p.hidden ? p.textContent : ''; });
  ok('the same for an equipment list from a link: turned down, nothing added, no kit made', /This list is bigger than the space Vdex has on this device, so nothing was added\. Free some space first \(erase old logs and bookings\), or ask for the list in parts\./.test(refused2) && (await db(G.page)).gear.length === 0 && (await db(G.page)).kits.length === 0 && (await onDisk(G.page)).gear === 0 && (await G.page.locator('.undo-bar').count()) === 0, refused2);
  await G.page.keyboard.press('Escape'); await sleep(200);
  await G.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, bio: '' }; }))); await sleep(300);
  await arrive(G.page, fatList);
  await G.page.locator('.sheet .add-go').click(); await G.page.waitForSelector('.undo-bar', { timeout: 20000 });
  ok('…and with room again it is added, with Undo offered', (await db(G.page)).gear.length === 900 && (await onDisk(G.page)).gear === 900 && /900 added/.test(await G.page.locator('.undo-bar').innerText()));
  await G.ctx.close();

  /* ============================== a wide screen, the light theme, and nothing sent ============================== */
  const W = await open({ width: 1200, height: 800, init: `try { localStorage.setItem('logi-prefs', JSON.stringify({ scheme: 'light' })); } catch (e) {}` });
  await W.page.goto(kitLink); await W.page.waitForSelector('.paper h1'); await W.page.screenshot({ path: OUT + '/share-gear-page-1200.png', fullPage: true });
  await viaPage(W.page, kitLink);
  const wide = await W.page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return { inside: s.left >= 0 && s.right <= innerWidth && s.bottom <= innerHeight + 1, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok('on a 1200-pixel screen the preview sits inside the window', wide.inside && wide.page, JSON.stringify(wide));
  await sleep(400); await W.page.screenshot({ path: OUT + '/share-add-gear-1200.png' });
  await W.ctx.close();

  /* ============== after the Add, a part of Vdex that cannot be fetched is not "Could not add it" ============== */
  // No connection and no offline copy yet: the file that draws the Undo bar (and, for a contact, the Crew page) cannot be
  // fetched once Add has been tapped. A browser of its own, whose failed requests are expected and counted apart.
  const offline = async (lost, packed) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document, { childList: true, subtree: true }); }); // every message, even one that has faded
    await ctx.addInitScript(acceptTerms().content);
    const page = await ctx.newPage(), broke = []; page.on('pageerror', e => broke.push(e.message)); page.on('dialog', d => d.accept());
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    await ctx.route(lost, r => r.abort());
    await arrive(page, packed);
    return { ctx, page, broke };
  };
  const O1 = await offline('**/js/gear-import-ui.js', await pack({ v: 1, kind: 'gear', title: 'Two lights', by: { name: 'Lena Lights' }, items: [{ name: 'Offline panel A', serial: 'OFF-A1' }, { name: 'Offline panel B', serial: 'OFF-B2' }], kits: [] }));
  await O1.page.locator('.sheet .add-go').click();
  await O1.page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 15000 }).catch(() => {}); await sleep(500);
  const o1 = await O1.page.evaluate(() => import('./js/store.js').then(s => ({ gear: s.db.gear.map(g => g.name).sort().join('|'), toasts: window.__toasts, sheets: document.querySelectorAll('.sheet-back').length, bar: document.querySelectorAll('.undo-bar').length, on: window.logiPage(), shown: document.querySelectorAll('.gear-card.just-added').length })));
  ok('when the file behind Undo cannot be fetched, the equipment is added all the same and shown on the Equipment page', o1.gear === 'Offline panel A|Offline panel B' && o1.sheets === 0 && o1.on === 'gear' && o1.shown === 2, JSON.stringify(o1));
  ok('…it is said to be added, never “Could not add it”, and that Undo is what is missing', o1.toasts.length === 1 && o1.toasts[0] === '2 added. Undo could not be loaded, so there is none for this import.' && o1.bar === 0 && O1.broke.length === 0, JSON.stringify([o1.toasts, O1.broke]));
  await O1.ctx.close();
  const O2 = await offline('**/js/pages/crew.js', await cardOf({ name: 'Otto Offline', title: 'Gaffer', phone: '+1 555 0177', email: 'otto@offline.example' }));
  await O2.page.locator('.sheet button:has-text("Add to my Crew")').click();
  await O2.page.waitForFunction(() => window.__toasts.length > 0, null, { timeout: 15000 }).catch(() => {}); await sleep(600);
  const o2 = await O2.page.evaluate(() => import('./js/store.js').then(s => ({ crew: s.db.crew.map(c => c.name).join('|'), toasts: window.__toasts, sheets: document.querySelectorAll('.sheet-back').length })));
  ok('the same for a contact when the Crew page cannot be fetched: the person is added and said to be, and nothing says otherwise', o2.crew === 'Otto Offline' && o2.toasts.join('|') === 'Added to your Crew' && o2.sheets === 0 && O2.broke.length === 0, JSON.stringify([o2, O2.broke]));
  await O2.ctx.close();
  const origin = new URL(BASE).origin;
  const outside = requests.filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !/^https:\/\/api\.open-meteo\.com\//.test(u));
  const leaked = requests.filter(u => u.includes(hashOf(cardLink).slice(0, 40)) || u.includes(hashOf(kitLink).slice(0, 40)) || /[?&]add=/.test(u));
  ok('nothing was sent anywhere in all of this: every request was for the app’s own files, and no link’s contents were in any of them', outside.length === 0 && leaked.length === 0, [...outside, ...leaked].slice(0, 3).join(' | '));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

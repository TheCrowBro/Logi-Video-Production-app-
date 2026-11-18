// Shared things, there and back: a booking (the crew link), a contact card and an equipment list are each made into
// a link in one browser, opened in another that never used Vdex with the sender, read on the public page, and added
// with "Add to my Vdex" after a preview; adding again updates instead of copying. Also: the card's .vcf download,
// serial-number duplicates (skip, update, add anyway) and a kit, the notice about serial numbers and values, hostile
// and oversized links, read-only mode, and a link that arrives while Vdex is locked, on the terms or in the tour.
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
  ok('…beside what was there before: Add to calendar and Print, and the shoot to read with no Vdex at all', (await B.page.locator('.bar button').count()) === 2 && /Harbour Brewing brand film/.test(await B.page.locator('.paper').innerText()));
  const crewFits = await B.page.evaluate(() => ({ page: document.documentElement.scrollWidth <= innerWidth, hit: [...document.querySelectorAll('.bar .btn')].every(b => b.getBoundingClientRect().height >= 44) }));
  ok('…fitting a 360-pixel phone with full-size buttons', crewFits.page && crewFits.hit, JSON.stringify(crewFits));

  await viaPage(B.page, link1);
  const at1 = await B.page.evaluate(() => ({ hash: location.hash, href: location.href, parked: sessionStorage.getItem('vdex-add') }));
  ok('the app opens with a preview, and the link is gone from the address bar', at1.hash === '' && !at1.href.includes('#') && /index\.html$/.test(at1.href), at1.href);
  const pv = await sheetText(B.page);
  ok('the preview says what it is and who shared it', /Add this booking\?/.test(pv) && /Harbour Brewing brand film/.test(pv) && /Shared by Pat Producer · Quay Films/.test(pv));
  ok('…and lists what will be added: when, place, venue, call sheet, crew, contacts, scenes, shots, deliverables', /When/.test(pv) && /07:30–17:00/.test(pv) && /12 Dock Road, Portside/.test(pv) && new RegExp(`“${seed.venue}” goes into your Venues`).test(pv) && /general call 07:30, lunch 12:30, wrap 18:00, 2 schedule lines/.test(pv) && /3 people \(Sam Rivera, Jo Chen, Dee Driver\), kept on this booking/.test(pv) && /2 contacts on the booking \(Pat Producer, Ana Ruiz\)/.test(pv) && /2 scenes on its stripboard, over 1 shooting day/.test(pv) && /2 shots/.test(pv) && /Main cut 9:16/.test(pv), pv.replace(/\s+/g, ' ').slice(0, 300));
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
  ok('adding the same shoot again offers an update and says what stays yours', /Update this booking\?/.test(pv2) && /is in your Bookings already/.test(pv2) && /anything you added by hand stay as they are/.test(pv2) && (await B.page.locator('.sheet button:has-text("Update the booking")').count()) === 1);
  await B.page.locator('.sheet button:has-text("Update the booking")').click();
  await B.page.waitForSelector('.bk-detail'); await sleep(400);
  const d2 = await db(B.page), b2 = d2.bookings[0];
  ok('…and updates the booking that was added before instead of making a copy', d2.bookings.length === 1 && b2.id === bk.id && d2.venues.length === 1 && b2.start === '06:45' && b2.callSheet.generalCall === '06:45', `${d2.bookings.length} bookings, ${d2.venues.length} venues`);
  ok('…taking what the link now holds: the new shot, the new call time, the moved schedule line, the contact’s new number, and one person fewer', b2.shots.some(s => s.text === 'Drone over the breakwater') && b2.hires.filter(h => h.shared).map(h => h.name).join() === 'Sam Rivera,Dee Driver' && b2.crewCall[b2.hires[0].id] === '06:30' && b2.callSheet.schedule.filter(r => r.shared).length === 1 && b2.callSheet.schedule[0].time === '07:15' && b2.stakeholders.find(s => s.name === 'Ana Ruiz').phone === '+1 555 0200', JSON.stringify(b2.hires.map(h => h.name)));
  ok('…while keeping what was added by hand: the stage, a tick, an extra shot, a hired person, a contact, a schedule line, a note, a rate, a delivery link and the budget', b2.status === 'Prepped' && b2.shots.find(s => s.text === 'Wide of the harbour at dawn').done === true && b2.shots.some(s => s.id === 'mine') && b2.hires.some(h => h.id === 'myhire') && b2.hires[0].id === hires[0].id && b2.hires[0].rate === 400 && b2.hires[0].notes === 'worked with Sam before' && b2.stakeholders.some(s => s.name === 'My Own Contact') && b2.callSheet.schedule.some(r => r.id === 'myrow') && /MY OWN NOTE/.test(b2.notes) && (b2.notes.match(/Equipment on this shoot/g) || []).length === 1 && b2.deliverables[0].link === 'https://my.example/cut' && b2.budget.lines[0].desc === 'Train');
  ok('…and the page says it was updated', /updated/.test(await B.page.locator('.bk-detail .hero .shared-by').innerText()));

  // the sender's own link, in the sender's own Vdex
  await A.page.goto(BASE + 'index.html#add=' + hashOf(link2)); await A.page.waitForSelector('.sheet');
  ok('one’s own link has nothing to add: the booking is already there, and there is no Add button', /This booking is yours/.test(await sheetText(A.page)) && (await A.page.locator('.sheet .add-actions').count()) === 0 && (await db(A.page)).bookings.filter(x => x.title === 'Harbour Brewing brand film').length === 1);
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
  const [vcf] = await Promise.all([B.page.waitForEvent('download', { timeout: 8000 }), B.page.locator('button:has-text("Save to my phone’s contacts")').click()]);
  const vcfText = fs.readFileSync(await vcf.path(), 'utf8');
  ok('Save to my phone’s contacts downloads the card as a .vcf file', /\.vcf$/.test(vcf.suggestedFilename()) && /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/.test(vcfText) && /\r\nFN:Pat Producer\r\n/.test(vcfText) && /\r\nN:Producer;Pat;;;\r\n/.test(vcfText) && /\r\nORG:Quay Films\r\n/.test(vcfText) && /\r\nTEL;TYPE=CELL:\+44 20 7946 0100\r\n/.test(vcfText) && /\r\nEMAIL:pat@quayfilms\.example\r\n/.test(vcfText) && /\r\nURL:https:\/\/quayfilms\.example\/\r\n/.test(vcfText) && /END:VCARD$/.test(vcfText), vcf.suggestedFilename());

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
  await B.page.locator('.sheet button:has-text("Add to my Equipment")').click();
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
  await B.page.locator('.sheet button:has-text("Add to my Equipment")').click(); await B.page.waitForSelector('.gear-card.just-added'); await sleep(200);
  const g2 = await db(B.page), mine2 = g2.gear.find(x => x.id === 'mine1');
  ok('update: no copies are made, the owned camera takes the list’s details and keeps its own service log, and the kit is not doubled', g2.gear.length === g1.gear.length && g2.kits.length === 1 && mine2.name === 'Sony FX6 body' && mine2.value === 9876 && mine2.location === 'Flight case 1' && mine2.serial === 'FX6-120934' && mine2.log.length === 1 && mine2.log[0].note === 'my own log', `${g2.gear.length} items, ${g2.kits.length} kits`);

  await viaPage(B.page, kitLink);
  await B.page.locator('.sheet .add-all select').selectOption('skip');
  ok('one choice can be set for every duplicate at once', (await B.page.locator('.sheet .add-dup select').evaluateAll(els => els.every(s => s.value === 'skip'))) && new RegExp(`${seed.kitGear} left as they are`).test(await B.page.locator('.sheet .add-sum').innerText()));
  await B.page.locator('.sheet .add-dup', { hasText: 'Sony FX6 body' }).locator('select').selectOption('add');
  await B.page.locator('.sheet button:has-text("Add to my Equipment")').click(); await B.page.waitForSelector('.gear-card.just-added'); await sleep(200);
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
  const [evilVcf] = await Promise.all([H.page.waitForEvent('download', { timeout: 8000 }), H.page.locator('button:has-text("Save to my phone’s contacts")').click()]);
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
  await R.page.locator('.sheet button:has-text("Add to my Equipment")').click(); await R.page.waitForSelector('.sheet.licence-readonly', { timeout: 8000 });
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

  /* ============================== a wide screen, the light theme, and nothing sent ============================== */
  const W = await open({ width: 1200, height: 800, init: `try { localStorage.setItem('logi-prefs', JSON.stringify({ scheme: 'light' })); } catch (e) {}` });
  await W.page.goto(kitLink); await W.page.waitForSelector('.paper h1'); await W.page.screenshot({ path: OUT + '/share-gear-page-1200.png', fullPage: true });
  await viaPage(W.page, kitLink);
  const wide = await W.page.evaluate(() => { const s = document.querySelector('.sheet').getBoundingClientRect(); return { inside: s.left >= 0 && s.right <= innerWidth && s.bottom <= innerHeight + 1, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok('on a 1200-pixel screen the preview sits inside the window', wide.inside && wide.page, JSON.stringify(wide));
  await sleep(400); await W.page.screenshot({ path: OUT + '/share-add-gear-1200.png' });
  await W.ctx.close();
  const origin = new URL(BASE).origin;
  const outside = requests.filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !/^https:\/\/api\.open-meteo\.com\//.test(u));
  const leaked = requests.filter(u => u.includes(hashOf(cardLink).slice(0, 40)) || u.includes(hashOf(kitLink).slice(0, 40)) || /[?&]add=/.test(u));
  ok('nothing was sent anywhere in all of this: every request was for the app’s own files, and no link’s contents were in any of them', outside.length === 0 && leaked.length === 0, [...outside, ...leaked].slice(0, 3).join(' | '));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

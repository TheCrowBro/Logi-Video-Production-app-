// The five production types and their checklists, the private budget with category pull-downs, and the crew link:
// a read-only page packed into the link (no server), which never carries prices, rates, budgets, quotes, invoices,
// kit values or booking notes.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); };
  watch(page); page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));

  // ---- production types ----
  const NEW = ['Social media', 'Short film', 'Vertical video (9:16)', 'Series / episodic', 'Feature film'];
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.locator('.page button:has-text("+ New")').first().click();
  await page.waitForSelector('.sheet select');
  const opts = await page.locator('.sheet select').first().evaluate(s => [...s.options].map(o => o.textContent));
  ok('the job type pull-down offers Social, Short, Vertical, Series and Feature', NEW.every(t => opts.includes(t)), opts.join(', '));
  await page.keyboard.press('Escape'); await sleep(200);
  const steps = await page.evaluate(() => import('./js/workflow.js').then(w => Object.fromEntries(['social', 'short', 'vertical', 'series', 'feature'].map(t => [t, w.STAGES.flatMap(([s]) => w.itemsFor({ type: t, checks: {} }, s).map(i => i.t))]))));
  ok('each new type brings checklist steps of its own', steps.vertical.includes('Framing and safe zones agreed for 9:16') && steps.feature.includes('Daily production report filed') && steps.social.includes('A cut for each platform and aspect ratio') && steps.series.includes('Episode list and shooting order agreed') && steps.short.includes('Script locked'));

  // ---- a booking set up for both ----
  const seed = await page.evaluate(() => import('./js/store.js').then(s => {
    const b = s.db.bookings.find(x => /Harbour/.test(x.title)) || s.db.bookings[0], c = s.db.crew[0], g = s.db.gear[0], v = s.db.venues[0];
    s.update(d => {
      const x = d.bookings.find(y => y.id === b.id), cr = d.crew.find(y => y.id === c.id), gr = d.gear.find(y => y.id === g.id);
      cr.rate = '$450/day'; cr.email = 'sam@example.com'; cr.phone = '+1 555 0101';
      gr.value = 9876;
      Object.assign(x, { address: '1 Quay Street, Portside', type: 'vertical', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), crew: [c.id], gear: [g.id], venueId: v ? v.id : undefined, notes: 'SECRET BOOKING NOTE', status: 'Confirmed',
        stakeholders: [{ name: 'Client Person', role: 'Client', phone: '+1 555 0999', email: 'client@example.com' }],
        hires: [{ id: 'h1', item: 'Prism lens', from: 'Camera Co', cost: 150 }], licences: [{ id: 'l1', kind: 'Music', title: 'Track One', cost: 60 }],
        shots: [{ id: 's1', text: 'Wide of the harbour at dawn', done: false }, { id: 's2', text: 'Close-up of the hands', done: true }],
        deliverables: [{ id: 'd1', name: 'Main cut 9:16', duration: '60 s', due: '', status: 'Planned', link: 'https://private.example/review' }],
        quote: { number: 'Q-0099', status: 'Sent', date: new Date().toISOString().slice(0, 10), taxRate: 20, lines: [{ id: 'q1', desc: 'Production', qty: 1, unit: 'item', price: 2500 }] },
        callSheet: { generalCall: '07:30', lunch: '12:30', wrap: '18:00', schedule: [{ id: 'r1', date: '', time: '08:00', item: 'First set-up on the quay' }], dress: 'Warm layers', emergency: 'Site medic 555 0111', notes: 'Bring a head torch', attendees: 'Talent arrives 09:00' } });
      x.updatedAt = Date.now();
    });
    return { id: b.id, title: b.title, crewName: c.name };
  }));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.evaluate(t => { document.querySelectorAll('.card.tap').forEach(c => { if (c.textContent.includes(t)) c.click(); }); }, seed.title);
  await page.waitForSelector('.bk-detail');

  // ---- budget ----
  const money = n => page.evaluate(v => import('./js/money.js').then(m => m.fmtMoney(v)), n);
  const budget = page.locator('#bk-budget');
  ok('the booking has a private Budget section', /Only you see it/.test(await budget.innerText()));
  await budget.locator('button:has-text("Fill from booking")').click(); await sleep(400);
  const lines1 = await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).budget.lines.map(l => [l.cat, l.desc, l.qty, l.rate])), seed.id);
  ok('Fill from booking adds the crew at their day rate (read from "$450/day"), the hires and the licences', lines1.length === 3 && lines1.some(l => l[0] === 'Crew' && l[3] === 450 && l[2] === 1) && lines1.some(l => l[0] === 'Equipment hire' && l[3] === 150) && lines1.some(l => l[0] === 'Music & licences' && l[3] === 60), JSON.stringify(lines1));
  await budget.locator('button:has-text("Fill from booking")').click(); await sleep(300);
  ok('…and never adds the same thing twice', (await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).budget.lines.length), seed.id)) === 3);
  await page.locator('#bk-budget button:has-text("Add line")').click();
  await page.waitForSelector('.sheet select');
  const cats = await page.locator('.sheet select').first().evaluate(s => [...s.options].map(o => o.textContent));
  ok('a budget line’s category is picked from a pull-down', ['Crew', 'Cast & talent', 'Equipment hire', 'Locations & permits', 'Travel & transport', 'Catering', 'Post-production', 'Contingency'].every(c => cats.includes(c)), cats.join(', '));
  await page.locator('.sheet select').first().selectOption('Travel & transport');
  await page.locator('.sheet input').nth(0).fill('Van');
  await page.locator('.sheet input[type=number]').nth(0).fill('2');
  await page.locator('.sheet input[type=number]').nth(1).fill('80');
  await page.locator('.sheet input[type=number]').nth(2).fill('170');
  await page.locator('.sheet button:has-text("Save")').click(); await sleep(400);
  const text = await page.locator('#bk-budget').innerText();
  ok('totals show the estimate, what is spent and what is still to pay', text.includes(await money(450 + 150 + 60 + 160)) && text.includes(await money(170)) && /Still to pay/.test(text) && text.includes(await money(450 + 150 + 60)), text.slice(0, 200).replace(/\s+/g, ' '));
  ok('…and the expected cost once actual costs are in', text.includes(`Expected total cost, with the actual costs so far: ${await money(830)} (${await money(10)} over the estimate)`), text.match(/Expected[^\n]*/)?.[0]);
  ok('…lines are grouped by category', (await page.locator('#bk-budget details.budget-cat').count()) === 4 && /Travel & transport/.test(text));
  ok('…and compared with the quote before tax: what is left for you after costs', text.includes(`Quoted to the client: ${await money(2500)} before tax`) && text.includes(`Left for you after costs: ${await money(2500 - 830)}`), text.match(/Quoted[^\n]*/)?.[0]);
  await page.setViewportSize({ width: 360, height: 800 }); await sleep(300);
  const fits = await page.evaluate(() => { const st = document.querySelector('#bk-budget .stats').getBoundingClientRect(), card = document.querySelector('#bk-budget .card').getBoundingClientRect(); return { inCard: st.right <= card.right + 0.5, page: document.documentElement.scrollWidth <= innerWidth }; });
  ok('the budget, and the whole booking page, fit a 360-pixel phone with no sideways scrolling', fits.inCard && fits.page, JSON.stringify(fits));
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.locator('#bk-budget button:has-text("Export CSV")').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('the budget exports as a spreadsheet file Excel reads correctly', csv.charCodeAt(0) === 0xfeff && /^\ufeff"Category","What it is"/.test(csv) && /"Travel & transport","Van","2","day","80","160.00","170.00"/.test(csv) && /"Total"/.test(csv), csv.split('\r\n')[1]);

  // half days, deleted lines staying deleted, typed rates, and a budget edited on two devices
  await page.locator('#bk-budget button:has-text("Add line")').click(); await page.waitForSelector('.sheet select');
  await page.locator('.sheet input').nth(0).fill('Half-day grip');
  await page.locator('.sheet input[type=number]').nth(0).fill('1.5');
  await page.locator('.sheet input[type=number]').nth(1).fill('300');
  await page.locator('.sheet button:has-text("Save")').click(); await sleep(400);
  ok('a quantity can be a half day', await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).budget.lines.some(l => l.desc === 'Half-day grip' && Number(l.qty) === 1.5)), seed.id));
  await page.locator('#bk-budget details.budget-cat:has-text("Equipment hire")').evaluate(d => { d.open = true; });
  await page.locator('#bk-budget button.budget-line:has-text("Prism lens")').click(); await page.waitForSelector('.sheet');
  await page.locator('.sheet button:has-text("Delete")').click(); await sleep(400);
  await page.locator('#bk-budget button:has-text("Fill from booking")').click(); await sleep(400);
  ok('a line deleted on purpose is not brought back by Fill from booking', !(await page.evaluate(id => import('./js/store.js').then(s => s.byId('bookings', id).budget.lines.some(l => /Prism lens/.test(l.desc))), seed.id)));
  const rates = await page.evaluate(() => import('./js/money.js').then(m => ['$500/day, OT $60/hr', '£55 an hour', '1.200,50 €', '1,200 per week', 'TBC'].map(r => [m.rateOf(r), m.parseRate(r).hourly])));
  ok('typed crew rates are read sensibly: a day rate with an hourly overtime note stays a day rate', JSON.stringify(rates) === JSON.stringify([[500, false], [55, true], [1200.5, false], ['', false], ['', false]]), JSON.stringify(rates));
  const merged = await page.evaluate(id => import('./js/store.js').then(s => {
    const base = JSON.parse(s.serialize()), b = base.bookings.find(x => x.id === id);
    const a = JSON.parse(JSON.stringify(base)), c = JSON.parse(JSON.stringify(base));
    const ba = a.bookings.find(x => x.id === id), bc = c.bookings.find(x => x.id === id);
    ba.budget = { ...(ba.budget || {}), lines: [...(ba.budget.lines || []), { id: 'zz', cat: 'Catering', desc: 'Lunch for 8', qty: 8, unit: 'person', rate: 15, actual: '' }], updatedAt: Date.now() + 1000 }; ba.updatedAt = Date.now() + 1000;
    bc.checks = { ...(bc.checks || {}), 'x:ticked': 1 }; bc.updatedAt = Date.now() + 5000; // another device, later, did not touch the budget
    const out = s.mergeDb(a, c).bookings.find(x => x.id === id);
    return { lunch: out.budget.lines.some(l => l.desc === 'Lunch for 8'), ticked: !!(out.checks && out.checks['x:ticked']) };
  }), seed.id);
  ok('a budget edited on one device survives another device’s later edit to the same booking', merged.lunch && merged.ticked, JSON.stringify(merged));

  // ---- crew link ----
  await page.locator('.bk-detail button:has-text("Share with crew")').click();
  await page.waitForFunction(() => (document.querySelector('.sheet textarea.share-link') || {}).value?.includes('crew.html#'), null, { timeout: 8000 });
  const url = await page.locator('.sheet textarea.share-link').inputValue();
  ok('Share with crew makes a link to the crew page with everything inside it', url.startsWith(BASE + 'crew.html#'), url.slice(0, 80));
  const snap = await page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), url);
  const raw = JSON.stringify({ ...snap, made: 0, ref: '' }); // the timestamp and the random id could contain any digits
  const keys = new Set(); (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!Array.isArray(o)) keys.add(k); walk(v); } })(snap);
  const FORBIDDEN = ['rate', 'price', 'cost', 'value', 'actual', 'budget', 'quote', 'invoice', 'payments', 'pay', 'link', 'notesOnBooking'];
  ok('the link carries no money: no rates, prices, costs, values, budgets, quotes or invoices', !FORBIDDEN.some(k => keys.has(k)) && !/450|9876|2500|Q-0099|Van|SECRET BOOKING NOTE|private\.example/.test(raw), [...keys].join(','));
  ok('…and carries what the crew needs', snap.title === seed.title && snap.call.general === '07:30' && snap.schedule.some(r => r.item === 'First set-up on the quay') && snap.crew.some(c => c.name === seed.crewName && c.call === '07:30' && c.phone) && snap.shots.length === 2 && snap.kit.length === 1 && snap.notes === 'Bring a head torch' && snap.type === 'Vertical video (9:16)');
  ok('the link carries a stable reference so a newer link updates the crew’s calendar event', snap.ref === seed.id);
  const tpl = await page.evaluate(id => import('./js/store.js').then(async s => {
    s.update(d => { d.projectTemplates = [...(d.projectTemplates || []), { id: 'tpl-gold', name: 'Gold package $4,500', base: 'vertical', updatedAt: Date.now() }]; const x = d.bookings.find(y => y.id === id); x.type = 'tpl-gold'; x.updatedAt = Date.now(); });
    const m = await import('./js/crew-link.js'); const snp = m.crewSnapshot(s.byId('bookings', id));
    s.update(d => { const x = d.bookings.find(y => y.id === id); x.type = 'vertical'; x.updatedAt = Date.now(); });
    return { type: snp.type, raw: JSON.stringify(snp) };
  }), seed.id);
  ok('the name of the producer’s own template never goes in, only the built-in type', tpl.type === 'Vertical video (9:16)' && !/Gold package|4,500/.test(tpl.raw), tpl.type);
  ok('client contacts stay out unless ticked', !('contacts' in snap) && !/client@example\.com|555 0999/.test(raw));
  ok('Email the crew is addressed to the crew', /^mailto:sam@example\.com\?/.test(await page.locator('.sheet a:has-text("Email the crew")').getAttribute('href')));
  // the tick and the check in one step: the old link must be gone at once, whatever the speed of the device
  const during = await page.evaluate(() => { const cb = [...document.querySelectorAll('.sheet label.check')].find(l => /Client contacts/.test(l.textContent)).querySelector('input'); cb.click(); return { text: document.querySelector('.sheet textarea.share-link').value, copyOff: document.querySelector('.sheet button.btn.primary').disabled }; });
  ok('after a change of ticks the old link is no longer offered while the new one is made', during.text === '' && during.copyOff, JSON.stringify(during));
  await page.waitForFunction(prev => { const v = document.querySelector('.sheet textarea.share-link').value; return v.includes('crew.html#') && v !== prev; }, url, { timeout: 8000 });
  const url2 = await page.locator('.sheet textarea.share-link').inputValue();
  const snap2 = await page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), url2);
  ok('ticking a part puts it in, and the choice is remembered', snap2.contacts && snap2.contacts[0].email === 'client@example.com' && snap2.onSet === 'Talent arrives 09:00' && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-crew-share'))).contacts === true);
  await page.locator('.sheet label.check:has-text("Client contacts") input').uncheck(); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(id => import('./js/store.js').then(s => s.update(d => { const x = d.bookings.find(y => y.id === id); x.shots = Array.from({ length: 70 }, (_, i) => ({ id: 'ls' + i, text: `Shot ${i + 1}: ` + Array.from({ length: 6 }, () => Math.random().toString(36).slice(2, 8)).join(' '), done: false })); /* varied text, so packing cannot shrink it much */ x.updatedAt = Date.now(); })), seed.id);
  await page.locator('.bk-detail button:has-text("Share with crew")').click();
  await page.waitForFunction(() => (document.querySelector('.sheet textarea.share-link') || {}).value?.includes('crew.html#'), null, { timeout: 8000 });
  const longHref = decodeURIComponent(await page.locator('.sheet a:has-text("Email the crew")').getAttribute('href'));
  const longUrl = await page.locator('.sheet textarea.share-link').inputValue();
  ok('a very long link is not squeezed into the email: the email asks for it to be pasted', longUrl.length > 1700 && longHref.includes('[Paste the link here]') && !longHref.includes(longUrl), `${longUrl.length} characters`);
  ok('…and no broken QR code is shown for it', longUrl.length <= 2800 || ((await page.locator('.sheet .share-qr svg').count()) === 0 && !(await page.locator('.sheet p:has-text("Crew can scan")').isVisible())));
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- the crew page ----
  const crew = await ctx.newPage(); watch(crew);
  await crew.goto(url); await crew.waitForSelector('.paper h1');
  const page2 = await crew.locator('.paper').innerText();
  { const freshCtx = await browser.newContext({ serviceWorkers: 'block' }), fresh = await freshCtx.newPage(); await fresh.goto(url); await fresh.waitForSelector('.paper h1');
    ok('the crew page opens from the link with no sign-in and no terms gate, even in a browser that never used Vdex', (await fresh.locator('.terms-gate').count()) === 0 && (await fresh.locator('.paper h1').innerText()) === seed.title);
    await freshCtx.close(); }
  ok('…showing the call, schedule, crew, shot list and kit', /General call\s*07:30/.test(page2) && /First set-up on the quay/.test(page2) && page2.includes(seed.crewName) && /Wide of the harbour at dawn/.test(page2) && /✓ Close-up of the hands/.test(page2) && /Bring a head torch/.test(page2));
  ok('…with no money anywhere on it', !/\$|£|€|450|9876|2500|budget|invoice|quote/i.test(page2));
  ok('…and phone numbers and the address as links', (await crew.locator('.paper a[href^="tel:"]').count()) >= 1 && (await crew.locator('.paper a[href^="https://www.google.com/maps/"]').count()) === 1);
  const [ics] = await Promise.all([crew.waitForEvent('download', { timeout: 8000 }), crew.locator('button:has-text("Add to calendar")').click()]);
  const icsText = require('fs').readFileSync(await ics.path(), 'utf8');
  ok('crew can add the shoot to their calendar', /BEGIN:VEVENT/.test(icsText) && icsText.includes('SUMMARY:' + seed.title.replace(/,/g, '\\,')) && /DTSTART:\d{8}T073000/.test(icsText), icsText.split('\r\n').filter(l => /^DT|^SUMMARY/.test(l)).join(' | '));
  ok('the page says it is a copy from when it was sent, and who made it', /if plans change, the producer sends a new link/.test(page2) && /cannot confirm who made this link/.test(await crew.locator('.foot').innerText()));
  const packed = o => page.evaluate(x => import('./js/link-pack.js').then(m => m.pack(x)), o);
  const icsOf = async o => { await crew.goto(BASE + 'crew.html#' + await packed(o)); await crew.waitForSelector('.paper h1'); const [d] = await Promise.all([crew.waitForEvent('download', { timeout: 8000 }), crew.locator('button:has-text("Add to calendar")').click()]); return require('fs').readFileSync(await d.path(), 'utf8'); };
  const evil = await icsOf({ kind: 'crew', ref: 'r1', title: 'Shoot', date: '2026-11-10', made: '1\r\nURL:https://evil.example/pay', endDate: '2026-11-11\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nEND:VALARM', call: { general: '07:30' }, location: {} });
  ok('a tampered link cannot slip extra lines into the calendar file', !/^URL:|^BEGIN:VALARM|^ATTACH/m.test(evil) && /^DTEND:20261110T083000/m.test(evil), evil.split('\r\n').filter(l => /^(URL|BEGIN:VALARM|DTEND|UID)/.test(l)).join(' | '));
  const night = await icsOf({ kind: 'crew', ref: 'r2', title: 'Night shoot', date: '2026-11-10', made: 1, call: { general: '18:00', wrap: '02:00' }, location: {} });
  ok('an overnight shoot ends the next morning in the calendar', /^DTSTART:20261110T180000/m.test(night) && /^DTEND:20261111T020000/m.test(night));
  const later = await icsOf({ kind: 'crew', ref: 'r2', title: 'Night shoot', date: '2026-11-10', made: 2000, call: { general: '19:00', wrap: '02:00' }, location: {} });
  ok('a newer link for the same shoot updates the same calendar event', night.match(/^UID:.*$/m)[0] === later.match(/^UID:.*$/m)[0] && /^SEQUENCE:2$/m.test(later));
  ok('calendar lines are folded at 75 bytes', icsText.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75));
  const multi = await page.evaluate(id => import('./js/store.js').then(async s => {
    const m = await import('./js/crew-link.js'), was = s.byId('bookings', id), keep = { endDate: was.endDate, start: was.start, end: was.end }, last = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    s.update(d => { Object.assign(d.bookings.find(y => y.id === id), { endDate: last, start: '08:00', end: '19:00', updatedAt: Date.now() }); });
    const snp = m.crewSnapshot(s.byId('bookings', id));
    s.update(d => { const x = d.bookings.find(y => y.id === id); Object.assign(x, keep, { updatedAt: Date.now() }); if (!keep.endDate) delete x.endDate; });
    return { snp, last, packed: await (await import('./js/link-pack.js')).pack(snp) }; }), seed.id);
  ok('a multi-day shoot keeps its last day and its times in the link', multi.snp.endDate === multi.last && multi.snp.start === '08:00' && multi.snp.end === '19:00', JSON.stringify({ endDate: multi.snp.endDate, start: multi.snp.start, end: multi.snp.end }));
  await crew.goto(BASE + 'crew.html#' + multi.packed); await crew.waitForSelector('.paper h1');
  ok('…and the crew page shows both days', /→/.test(await crew.locator('.paper .sub').first().innerText()));
  const anon = await page.evaluate(id => import('./js/store.js').then(async s => { const keep = { ...s.db.profile }; s.update(d => { d.profile = { ...d.profile, name: '', business: '', phone: '', email: '', updatedAt: Date.now() }; }); const snp = (await import('./js/crew-link.js')).crewSnapshot(s.byId('bookings', id)); s.update(d => { d.profile = { ...keep, updatedAt: Date.now() }; }); return snp.producer; }), seed.id);
  ok('with no name in the profile, the crew page never claims the info is from Vdex', anon === '', JSON.stringify(anon));
  const semi = await icsOf({ kind: 'crew', ref: 'r3', title: 'Day 2; pick-ups', date: '2026-11-12', made: 1, call: { general: '09:00' }, location: { address: '12 Dock Rd; Gate B' } });
  ok('semicolons are escaped in the calendar file', /^SUMMARY:Day 2\\; pick-ups$/m.test(semi) && /^LOCATION:12 Dock Rd\\; Gate B$/m.test(semi));
  await crew.goto(BASE + 'crew.html'); await sleep(600);
  ok('a link with nothing after it says so in plain words', /no shoot info in it/.test(await crew.locator('body').innerText()));
  await crew.goto(BASE + 'crew.html#1.garbage'); await sleep(600);
  ok('a damaged link says so plainly', /does not open shoot info/.test(await crew.locator('body').innerText()));
  await crew.close();

  // ---- the money stays private elsewhere too ----
  const invoiceSnap = await page.evaluate(id => import('./js/money.js').then(m => m.shareLink(m.docOf ? { id } : { id }, 'quote')).then(u => import('./js/link-pack.js').then(p => p.unpack(new URL(u).hash))), seed.id);
  ok('the client’s quote link carries no budget', !JSON.stringify(invoiceSnap).includes('Van') && !('budget' in invoiceSnap));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

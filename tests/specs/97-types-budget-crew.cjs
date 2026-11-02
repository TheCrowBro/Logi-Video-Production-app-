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
      Object.assign(x, { type: 'vertical', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), crew: [c.id], gear: [g.id], venueId: v ? v.id : undefined, notes: 'SECRET BOOKING NOTE', status: 'Confirmed',
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
  ok('totals show the estimate, what is spent and what is left', text.includes(await money(450 + 150 + 60 + 160)) && text.includes(await money(170)) && /Still to spend/.test(text), text.slice(0, 200).replace(/\s+/g, ' '));
  ok('…lines are grouped by category', (await page.locator('#bk-budget details.budget-cat').count()) === 4 && /Travel & transport/.test(text));
  ok('…and compared with the quote before tax: what is left for you', text.includes(`Quoted to the client: ${await money(2500)} before tax`) && text.includes(`Left for you after this budget: ${await money(2500 - 820)}`), text.match(/Quoted[^\n]*/)?.[0]);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.locator('#bk-budget button:has-text("Export CSV")').click()]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  ok('the budget exports as a spreadsheet file', /^"Category","What it is"/.test(csv) && /"Travel & transport","Van","2","day","80","160.00","170.00"/.test(csv) && /"Total"/.test(csv), csv.split('\r\n')[1]);

  // ---- crew link ----
  await page.locator('.bk-detail button:has-text("Share with crew")').click();
  await page.waitForFunction(() => (document.querySelector('.sheet textarea.share-link') || {}).value?.includes('crew.html#'), null, { timeout: 8000 });
  const url = await page.locator('.sheet textarea.share-link').inputValue();
  ok('Share with crew makes a link to the crew page with everything inside it', url.startsWith(BASE + 'crew.html#'), url.slice(0, 80));
  const snap = await page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), url);
  const raw = JSON.stringify(snap);
  const keys = new Set(); (function walk(o) { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!Array.isArray(o)) keys.add(k); walk(v); } })(snap);
  const FORBIDDEN = ['rate', 'price', 'cost', 'value', 'actual', 'budget', 'quote', 'invoice', 'payments', 'pay', 'link', 'notesOnBooking'];
  ok('the link carries no money: no rates, prices, costs, values, budgets, quotes or invoices', !FORBIDDEN.some(k => keys.has(k)) && !/450|9876|2500|Q-0099|Van|SECRET BOOKING NOTE|private\.example/.test(raw), [...keys].join(','));
  ok('…and carries what the crew needs', snap.title === seed.title && snap.call.general === '07:30' && snap.schedule.some(r => r.item === 'First set-up on the quay') && snap.crew.some(c => c.name === seed.crewName && c.call === '07:30' && c.phone) && snap.shots.length === 2 && snap.kit.length === 1 && snap.notes === 'Bring a head torch' && snap.type === 'Vertical video (9:16)');
  ok('client contacts stay out unless ticked', !('contacts' in snap) && !/client@example\.com|555 0999/.test(raw));
  ok('Email the crew is addressed to the crew', /^mailto:sam@example\.com\?/.test(await page.locator('.sheet a:has-text("Email the crew")').getAttribute('href')));
  await page.locator('.sheet label.check:has-text("Client contacts") input').check();
  await page.waitForFunction(prev => document.querySelector('.sheet textarea.share-link').value !== prev, url, { timeout: 8000 });
  const url2 = await page.locator('.sheet textarea.share-link').inputValue();
  const snap2 = await page.evaluate(u => import('./js/link-pack.js').then(m => m.unpack(new URL(u).hash)), url2);
  ok('ticking a part puts it in, and the choice is remembered', snap2.contacts && snap2.contacts[0].email === 'client@example.com' && snap2.onSet === 'Talent arrives 09:00' && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-crew-share'))).contacts === true);
  await page.locator('.sheet label.check:has-text("Client contacts") input').uncheck(); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- the crew page ----
  const crew = await ctx.newPage(); watch(crew);
  await crew.goto(url); await crew.waitForSelector('.paper h1');
  const page2 = await crew.locator('.paper').innerText();
  ok('the crew page opens from the link with no sign-in and no terms gate', (await crew.locator('.terms-gate').count()) === 0 && page2.includes(seed.title));
  ok('…showing the call, schedule, crew, shot list and kit', /General call\s*07:30/.test(page2) && /First set-up on the quay/.test(page2) && page2.includes(seed.crewName) && /Wide of the harbour at dawn/.test(page2) && /✓ Close-up of the hands/.test(page2) && /Bring a head torch/.test(page2));
  ok('…with no money anywhere on it', !/\$|£|€|450|9876|2500|budget|invoice|quote/i.test(page2));
  ok('…and phone numbers and the address as links', (await crew.locator('.paper a[href^="tel:"]').count()) >= 1);
  const [ics] = await Promise.all([crew.waitForEvent('download', { timeout: 8000 }), crew.locator('button:has-text("Add to calendar")').click()]);
  const icsText = require('fs').readFileSync(await ics.path(), 'utf8');
  ok('crew can add the shoot to their calendar', /BEGIN:VEVENT/.test(icsText) && icsText.includes('SUMMARY:' + seed.title.replace(/,/g, '\\,')) && /DTSTART:\d{8}T073000/.test(icsText), icsText.split('\r\n').filter(l => /^DT|^SUMMARY/.test(l)).join(' | '));
  ok('the page says it is a copy from when it was sent, and who made it', /if plans change, the producer sends a new link/.test(page2) && /cannot confirm who made this link/.test(await crew.locator('.foot').innerText()));
  await crew.goto(BASE + 'crew.html#1.garbage'); await sleep(600);
  ok('a damaged link says so plainly', /does not open shoot info/.test(await crew.locator('body').innerText()));
  await crew.close();

  // ---- the money stays private elsewhere too ----
  const invoiceSnap = await page.evaluate(id => import('./js/money.js').then(m => m.shareLink(m.docOf ? { id } : { id }, 'quote')).then(u => import('./js/link-pack.js').then(p => p.unpack(new URL(u).hash))), seed.id);
  ok('the client’s quote link carries no budget', !JSON.stringify(invoiceSnap).includes('Van') && !('budget' in invoiceSnap));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

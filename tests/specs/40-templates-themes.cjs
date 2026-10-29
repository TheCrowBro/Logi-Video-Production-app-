const { chromium } = require('playwright');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));

  // ---- camera-brand themes ----
  await page.locator('#displayBtn').click(); await page.waitForSelector('.sheet');
  await page.locator('.sheet details.twirl > summary', { hasText: 'Colour theme' }).click();
  const groups = await page.locator('.sheet .theme-group').allInnerTexts();
  ok('theme chooser has Classic and Camera brands groups', groups.length === 2 && /camera brands/i.test(groups[1]) && /not affiliated/i.test(groups[1]), JSON.stringify(groups));
  ok('17 themes offered', (await page.locator('.sheet .theme-row').count()) === 17);
  await page.locator('.sheet .theme-row', { hasText: 'Sony' }).click();
  const sony = await page.evaluate(() => ({ palette: document.documentElement.dataset.palette, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), meta: document.querySelector('meta[name=theme-color]').content, saved: JSON.parse(localStorage.getItem('logi-prefs')).palette }));
  ok('Sony theme applies (accent, theme colour, saved)', sony.palette === 'sony' && /ff7a1a|c04f00/i.test(sony.accent) && sony.saved === 'sony', JSON.stringify(sony));
  await page.locator('.sheet .seg button', { hasText: 'Light' }).click();
  const sonyLight = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  ok('light variant of the brand theme switches in', /c04f00/i.test(sonyLight), sonyLight);
  await page.locator('.sheet .theme-row', { hasText: 'Nikon' }).click();
  const nik = await page.evaluate(() => ({ a: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), ink: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim() }));
  ok('Nikon light uses dark ink on yellow', /d6b400/i.test(nik.a) && /1a1700/i.test(nik.ink), JSON.stringify(nik));
  await page.screenshot({ path: S + '/theme-nikon.png' });
  await page.locator('.sheet .seg button', { hasText: 'Dark' }).click(); await page.locator('.sheet .theme-row', { hasText: 'Blackmagic' }).click();
  await page.keyboard.press('Escape'); await sleep(300);
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
  ok('brand theme survives a reload (pre-paint script)', (await page.evaluate(() => document.documentElement.dataset.palette)) === 'blackmagic');
  await page.screenshot({ path: S + '/theme-blackmagic.png' });

  // ---- project templates: create one in Settings ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await page.locator('details.settings-section:has(> summary:has-text("Project templates")) > summary').click();
  await page.getByRole('button', { name: '+ New template' }).click(); await page.waitForSelector('.sheet form');
  const f = page.locator('.sheet').last();
  await f.locator('input[data-key="name"]').fill('Car shoot');
  await f.locator('input[data-key="icon"]').fill('🚗');
  await f.locator('.field:has(label:has-text("Checklists start from")) select').selectOption('brand');
  await f.locator('input[data-key="start"]').fill('06:00'); await f.locator('input[data-key="end"]').fill('16:00');
  await f.locator('input[data-key="breakMinutes"]').fill('45');
  await f.locator('.field:has(label:has-text("Kits")) input[type=checkbox]').first().check();
  await f.locator('.field:has(label:has-text("Usual crew")) input[type=checkbox]').first().check();
  const delivField = f.locator('.field:has(label:has-text("Deliverables"))');
  await delivField.getByRole('button', { name: '+ Add' }).click(); await delivField.getByRole('button', { name: '+ Add' }).click();
  const dr = delivField.locator('.row-edit');
  await dr.nth(0).locator('input').nth(0).fill('Hero film 16:9'); await dr.nth(0).locator('input').nth(1).fill('60 s'); await dr.nth(0).locator('input').nth(2).fill('14');
  await dr.nth(1).locator('input').nth(0).fill('Social cut 9:16'); await dr.nth(1).locator('input').nth(2).fill('21');
  await f.locator('textarea[data-key="shots"]').fill('Rolling shots on the coast road\nDetail: badge, wheels, interior');
  const schedField = f.locator('.field:has(label:has-text("Call sheet schedule"))');
  await schedField.getByRole('button', { name: '+ Add' }).click();
  await schedField.locator('.row-edit input[type=time]').fill('06:00'); await schedField.locator('.row-edit input[type=text]').fill('Crew call at the car park');
  await f.locator('input[data-key="cs_dress"]').fill('Hi-vis, no logos');
  await f.locator('button[type=submit]').click(); await sleep(400);
  const tpls = await page.evaluate(() => import('./js/store.js').then(s => s.db.projectTemplates));
  ok('template saved with its defaults', tpls.length === 1 && tpls[0].name === 'Car shoot' && tpls[0].base === 'brand' && tpls[0].deliverables.length === 2 && tpls[0].kits.length === 1 && tpls[0].crew.length === 1 && tpls[0].schedule.length === 1, JSON.stringify(tpls[0] && { id: tpls[0].id, n: tpls[0].deliverables.length }));
  ok('Project templates section lists it', /Car shoot/.test(await page.locator('details.settings-section:has(> summary:has-text("Project templates"))').evaluate(el => el.textContent)));
  await page.locator('details.settings-section:has(> summary:has-text("Workflow templates")) > summary').click();
  ok('its checklists can be edited under Workflow templates', /Car shoot \(yours\)/.test(await page.locator('details.settings-section:has(> summary:has-text("Workflow templates"))').evaluate(el => el.textContent)));

  // ---- a new booking from the template ----
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await page.getByRole('button', { name: 'From template' }).first().click(); await page.waitForSelector('.sheet .card.tap');
  await page.locator('.sheet .card.tap', { hasText: 'Car shoot' }).click(); await page.waitForSelector('.sheet form');
  const bf = page.locator('.sheet').last();
  const pre = { type: await bf.locator('.field:has(label:has-text("Job type")) select').inputValue(), start: await bf.locator('input[data-key="start"]').inputValue(), end: await bf.locator('input[data-key="end"]').inputValue(), brk: await bf.locator('input[data-key="breakMinutes"]').inputValue(), kit: await bf.locator('.field:has(label:has-text("Kits")) input[type=checkbox]').first().isChecked(), crew: await bf.locator('.field:has(label:has-text("Crew")) input[type=checkbox]').first().isChecked() };
  ok('booking form is pre-filled from the template', pre.type === tpls[0].id && pre.start === '06:00' && pre.end === '16:00' && pre.brk === '45' && pre.kit && pre.crew, JSON.stringify(pre));
  ok('the type select lists the template first', (await bf.locator('.field:has(label:has-text("Job type")) select option').first().innerText()).includes('Car shoot'));
  await bf.locator('input[data-key="title"]').fill('Coupe launch film'); await bf.locator('input[data-key="date"]').fill('2026-12-05');
  await bf.locator('button[type=submit]').click(); await sleep(600);
  const b = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.find(x => x.title === 'Coupe launch film')));
  ok('saved booking carries the template extras: deliverables with due dates, shots, call sheet schedule and dress code', b.type === tpls[0].id && b.deliverables.length === 2 && b.deliverables[0].due === '2026-12-19' && b.deliverables[1].due === '2026-12-26' && b.shots.length === 2 && b.callSheet.schedule.length === 1 && b.callSheet.dress === 'Hi-vis, no logos', JSON.stringify({ due: b.deliverables.map(d => d.due), shots: b.shots.length }));
  const detail = await page.locator('.bk-detail').evaluate(el => el.textContent);
  ok('booking page shows the template name and its checklists', /Car shoot/.test(detail) && /Treatment and shot list approved/.test(detail));
  ok('Apply template items reports nothing missing', await page.getByRole('button', { name: 'Apply template items' }).click().then(() => page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Nothing missing/.test(t.textContent)), null, { timeout: 5000 })).then(() => true).catch(() => false));

  // ---- save an existing booking as a template ----
  await page.getByRole('button', { name: 'Save as template' }).click(); await page.waitForSelector('.sheet form');
  const sf = page.locator('.sheet').last();
  const prefill = { name: await sf.locator('input[data-key="name"]').inputValue(), start: await sf.locator('input[data-key="start"]').inputValue(), rows: await sf.locator('.field:has(label:has-text("Deliverables")) .row-edit').count(), due: await sf.locator('.field:has(label:has-text("Deliverables")) .row-edit').first().locator('input').nth(2).inputValue() };
  ok('Save as template pre-fills from the booking, with due dates as days after the shoot', /Coupe launch film template/.test(prefill.name) && prefill.start === '06:00' && prefill.rows === 2 && prefill.due === '14', JSON.stringify(prefill));
  await sf.locator('button[type=submit]').click(); await sleep(400);
  ok('second template stored', (await page.evaluate(() => import('./js/store.js').then(s => s.db.projectTemplates.length))) === 2);
  await page.screenshot({ path: S + '/templates.png' });
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

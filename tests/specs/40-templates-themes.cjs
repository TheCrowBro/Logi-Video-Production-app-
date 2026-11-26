const { chromium } = require('playwright');
const { acceptTerms, openSetting, menuClick } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));

  // ---- camera-brand themes ----
  await menuClick(page, '#displayBtn'); await page.waitForSelector('.sheet');
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
  // …and where the accent is the colour of words (links, small headings, legends) it is dark enough to read on a card.
  const words = await page.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(v => { v = Number(v) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const card = document.createElement('div'); card.className = 'card'; const a = document.createElement('a'); a.href = '#'; a.textContent = 'a link'; const h4 = document.createElement('h4'); h4.textContent = 'A heading'; card.append(a, h4); document.getElementById('page').append(card);
    const out = { link: +ratio(getComputedStyle(a).color, getComputedStyle(card).backgroundColor).toFixed(2), heading: +ratio(getComputedStyle(h4).color, getComputedStyle(card).backgroundColor).toFixed(2), onPage: +ratio(getComputedStyle(a).color, getComputedStyle(document.body).backgroundColor).toFixed(2) };
    card.remove(); return out;
  });
  ok('in the light Nikon theme a link and a small heading have at least 4.5:1 against the card and the page (the yellow is for buttons)', words.link >= 4.5 && words.heading >= 4.5 && words.onPage >= 4.5, JSON.stringify(words));
  await page.screenshot({ path: S + '/theme-nikon.png' });
  await page.locator('.sheet .seg button', { hasText: 'Dark' }).click(); await page.locator('.sheet .theme-row', { hasText: 'Blackmagic' }).click();
  await page.keyboard.press('Escape'); await sleep(300);
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
  ok('brand theme survives a reload (pre-paint script)', (await page.evaluate(() => document.documentElement.dataset.palette)) === 'blackmagic');
  await page.screenshot({ path: S + '/theme-blackmagic.png' });

  // ---- project templates: create one in Settings ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await openSetting(page, 'Project templates');
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
  await openSetting(page, 'Workflow templates');
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

  // ---- repairs after 1.4.0: checklists and project templates ----
  const wfFix = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/workflow.js')]).then(([s, wf]) => {
    s.update(d => { d.templates = { ...(d.templates || {}), brand: { ...((d.templates || {}).brand || {}), Enquiry: ['Бриф получен', 'Бюджет известен', 'Даты согласованы', 'Call sheet?', 'Call sheet!'] }, updatedAt: Date.now() };
      d.bookings.push({ id: 'wf-ru', title: 'Checklist', type: 'brand', date: '2026-12-01', status: 'Enquiry', checks: {}, crew: [], gear: [], stakeholders: [] }); });
    const get = () => s.byId('bookings', 'wf-ru'), ids = wf.itemsFor(get(), 'Enquiry').map(x => x.id);
    wf.setCheck(get(), ids[0], true); wf.setCheck(get(), ids[3], true);
    return { ids, unique: new Set(ids).size === ids.length, done: wf.itemsFor(get(), 'Enquiry').map(x => (x.done ? 1 : 0)).join(''), n: wf.progress(get(), 'Enquiry').done, latin: wf.itemsFor(get(), 'Quoted')[0].id };
  }));
  ok('checklist lines in a non-Latin script, and lines that differ only in punctuation, each have a tick of their own', wfFix.unique && wfFix.done === '10010' && wfFix.n === 2, JSON.stringify(wfFix));
  ok('a line whose id was already its own keeps it, so the ticks on existing bookings stay', wfFix.latin === 'quoted:quote-estimate-sent' && wfFix.ids[3] === 'enquiry:call-sheet', wfFix.latin + ' ' + wfFix.ids[3]);
  // Ticks made before lines had marks (1.4.0 kept one tick for all the lines that shared an id): a line ticked then is
  // ticked now, and unticking one of them unticks that one alone
  const oldTicks = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/workflow.js')]).then(([s, wf]) => {
    s.update(d => { d.bookings.push({ id: 'wf-old', title: 'Ticked before', type: 'brand', date: '2026-12-01', status: 'Enquiry', checks: { 'enquiry:': 1, 'enquiry:call-sheet': 1 }, crew: [], gear: [], stakeholders: [] }, { id: 'wf-half', title: 'Half ticked before', type: 'brand', date: '2026-12-01', status: 'Enquiry', checks: { 'enquiry:call-sheet': 1 }, crew: [], gear: [], stakeholders: [] }); });
    const get = id => s.byId('bookings', id), row = id => wf.itemsFor(get(id), 'Enquiry').map(x => (x.done ? 1 : 0)).join(''), out = { before: row('wf-old'), n: wf.progress(get('wf-old'), 'Enquiry').done, half: row('wf-half') };
    const ids = wf.itemsFor(get('wf-old'), 'Enquiry').map(x => x.id);
    wf.setCheck(get('wf-old'), ids[1], false); out.unticked = row('wf-old');
    wf.setCheck(get('wf-old'), ids[3], false); out.first = row('wf-old'); // the line that owns the plain id: the one like it keeps its tick
    wf.setCheck(get('wf-old'), ids[1], true); out.again = row('wf-old');
    s.remove('bookings', 'wf-old'); s.remove('bookings', 'wf-half'); return out; }));
  ok('lines ticked before the update are ticked after it, also the ones in another script and the second of two that read alike', oldTicks.before === '11111' && oldTicks.n === 5 && oldTicks.half === '00011', JSON.stringify(oldTicks));
  ok('…and unticking one of them unticks that line alone, as does ticking it again', oldTicks.unticked === '10111' && oldTicks.first === '10101' && oldTicks.again === '11101', JSON.stringify(oldTicks));
  // A deleted project template hands its bookings the built-in type its checklists came from
  await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/workflow.js')]).then(([s, wf]) => { const bk = (id, title, type) => ({ id, title, type, date: '2026-12-02', start: '09:00', status: 'Confirmed', crew: [], gear: [], stakeholders: [] });
    s.update(d => { d.projectTemplates.push({ id: 'tpl-pod', name: 'Podcast episode', icon: '🎙', base: 'corporate', updatedAt: 1 }); d.bookings.push(bk('wf-pod', 'Episode 12', 'tpl-pod'), bk('wf-lost', 'Lost template', 'tpl-gone')); });
    wf.editProjectTemplate(s.byId('projectTemplates', 'tpl-pod')); }));
  const tform = page.locator('.sheet form'); await tform.waitFor();
  await tform.getByRole('button', { name: 'Delete' }).click(); await sleep(400);
  const pod = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/workflow.js')]).then(([s, wf]) => { const b = s.byId('bookings', 'wf-pod'); return { type: b.type, label: wf.typeLabel(b.type), lines: wf.itemsFor(b, 'Prepped').some(x => x.t === 'Interview questions agreed'), gone: !s.byId('projectTemplates', 'tpl-pod') }; }));
  ok('deleting a project template leaves its bookings on the built-in type its checklists started from', pod.gone && pod.type === 'corporate' && pod.label === 'Corporate / interview' && pod.lines, JSON.stringify(pod));
  // …and a booking that still points at a template that is gone keeps its type when its form is saved
  await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
  await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('wf-lost'))); await sleep(300);
  await page.locator('.bk-detail .page-head').getByRole('button', { name: 'Edit', exact: true }).click(); await tform.waitFor();
  const typeShown = await tform.locator('select').first().inputValue();
  await tform.locator('input[data-key="start"]').fill('10:00'); await tform.locator('button[type=submit]').click(); await sleep(400);
  const lost = await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', 'wf-lost'); return { type: b.type, start: b.start }; }));
  ok('saving the form of a booking whose template is gone changes only what was changed: it never takes another template’s type by itself', typeShown === 'tpl-gone' && lost.type === 'tpl-gone' && lost.start === '10:00', typeShown + ' ' + JSON.stringify(lost));
  await page.screenshot({ path: S + '/templates.png' });
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

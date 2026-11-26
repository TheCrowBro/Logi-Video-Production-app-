// Settings laid out in groups: General (display, profile, about and licence) and Work & billing first, then the rest in
// order; a section opened inside a closed group opens the group; the profile is edited in Settings only; storage,
// sync and backups are one section (and the ☁ sheet matches).
const { chromium } = require('playwright');
const { acceptTerms, openSetting, menuClick } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.evaluate(() => window.logiGo('settings')); await sleep(450);

  // ---- the layout ----
  const top = await page.evaluate(() => [...document.querySelectorAll('#page .page-card > details')].map(d => d.dataset.s + ':' + d.tagName.toLowerCase() + '.' + d.className + ':' + (d.open ? 'open' : 'closed')));
  ok('top level: General, Work & billing, then Calendar, Field tools, Storage, Security, Install, all closed', top.join('|') === 'General:details.settings-group:closed|Work & billing:details.settings-group:closed|Calendar & email:details.settings-section:closed|Field tool defaults:details.settings-section:closed|Storage, sync & backups:details.settings-section:closed|Security:details.settings-section:closed|Install:details.settings-section:closed', top.join(' | '));
  const inside = await page.evaluate(() => ['General', 'Work & billing'].map(g => [...document.querySelector(`details[data-s="${g}"] > .sg-body`).children].map(d => d.dataset.s).join(', ')));
  ok('General holds Display & accessibility, Profile, About & Licence', inside[0] === 'Display & accessibility, Profile, About & Licence', inside[0]);
  ok('Work & billing holds the templates, quotes and invoices, hours and breaks', inside[1] === 'Project templates, Workflow templates, Quotes & invoices, Hours & breaks', inside[1]);
  ok('no section is still called About, Backups & data or Storage & sync', (await page.evaluate(() => [...document.querySelectorAll('#page .ss-title')].map(e => e.textContent))).every(t => !['About', 'Backups & data', 'Storage & sync'].includes(t)));

  // ---- opening a section inside a closed group opens the group ----
  await page.evaluate(() => { document.querySelector('details[data-s="About & Licence"]').open = true; });
  await page.waitForFunction(() => document.querySelector('details[data-s="General"]').open, null, { timeout: 3000 }).catch(() => {});
  ok('opening About & Licence opens General around it', await page.evaluate(() => document.querySelector('details[data-s="General"]').open && document.querySelector('details[data-s="About & Licence"]').open));
  const about = await page.locator('details[data-s="About & Licence"]').innerText();
  ok('About & Licence has the version, the tour and the legal pages', /Vdex \d+\.\d+\.\d+/.test(about) && /Take the tour/.test(about) && /Terms of service/.test(about) && /Privacy policy/.test(about));
  ok('its summary is visible, so it can be tapped', await page.locator('details[data-s="About & Licence"] > summary').isVisible());
  // The group remembers it was opened across a redraw (a saved setting redraws the page)
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, currency: '€' }; }))); await sleep(400);
  ok('a redraw keeps General and About & Licence open', await page.evaluate(() => document.querySelector('details[data-s="General"]').open && document.querySelector('details[data-s="About & Licence"]').open && !document.querySelector('details[data-s="Work & billing"]').open));
  // Folded up by hand while a section inside is still open: it stays folded across the next redraw too
  await page.locator('details[data-s="General"] > summary').click(); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, bio: 'Folded' }; }))); await sleep(400);
  ok('a group folded up by hand stays folded across a redraw, even with a section open inside it', await page.evaluate(() => !document.querySelector('details[data-s="General"]').open && document.querySelector('details[data-s="About & Licence"]').open));
  const rv = await page.evaluate(async () => { const m = await import('./js/pages/settings.js'); const r = m.reveal('Security'); const nav = document.getElementById('rolodex').getBoundingClientRect().bottom; return { r, open: document.querySelector('details[data-s="Security"]').open, focus: document.activeElement === document.querySelector('details[data-s="Security"] > summary'), below: document.querySelector('details[data-s="Security"]').getBoundingClientRect().top >= nav - 1, none: m.reveal('No such section') }; });
  ok('reveal() opens a section by title, focuses it, lands it below the Rolodex, and says no for an unknown title', rv.r === true && rv.open && rv.focus && rv.below && rv.none === false, JSON.stringify(rv));

  // ---- the profile: edited here, shown on Me ----
  await openSetting(page, 'Profile');
  const prof = page.locator('details[data-s="Profile"]');
  ok('Profile lists the details on file, the Edit button and the currency', /Name/.test(await prof.innerText()) && (await prof.getByRole('button', { name: /Edit your details/ }).count()) === 1 && (await prof.locator('input[aria-label="Currency symbol"]').inputValue()) === '€');
  await prof.getByRole('button', { name: /Edit your details/ }).click(); await page.waitForSelector('.sheet form');
  const keys = await page.evaluate(() => [...document.querySelectorAll('.sheet form [data-key]')].map(e => e.dataset.key));
  ok('the form has name, business, title, phone, email, website, based in and bio', ['name', 'business', 'title', 'phone', 'email', 'website', 'location', 'bio'].every(k => keys.includes(k)), keys.join(','));
  await page.locator('.sheet form input[data-key="name"]').fill('Sam Operator');
  await page.locator('.sheet form input[data-key="business"]').fill('Operator Films');
  await page.locator('.sheet form button[type=submit]').click(); await sleep(400);
  ok('saving updates the profile and the General status', (await page.evaluate(() => import('./js/store.js').then(s => s.db.profile.name))) === 'Sam Operator' && /Sam Operator/.test(await page.locator('details[data-s="General"] > summary').innerText()));
  await page.evaluate(() => window.logiGo('me')); await sleep(450);
  const me = await page.locator('#page').innerText();
  ok('the Me page shows the new name and has no edit form of its own, only the way to Settings', /Sam Operator/.test(me) && /Operator Films/.test(me) && (await page.locator('#page button', { hasText: 'Edit in Settings' }).count()) === 1 && (await page.locator('#page button', { hasText: /^Edit$/ }).count()) === 0);
  await page.locator('#page button', { hasText: 'Edit in Settings' }).click();
  await page.waitForFunction(() => document.querySelector('details[data-s="Profile"]')?.open, null, { timeout: 4000 }).catch(() => {});
  ok('Edit in Settings lands on Settings with General and Profile open', (await page.evaluate(() => window.logiPage())) === 'settings' && await page.evaluate(() => document.querySelector('details[data-s="General"]').open && document.querySelector('details[data-s="Profile"]').open));

  // ---- storage, sync and backups in one place ----
  await openSetting(page, 'Storage, sync & backups');
  const st = page.locator('details[data-s="Storage, sync & backups"]');
  const stText = await st.innerText();
  ok('the section has the storage choices and, under a Backups heading, the backup actions', /Google Drive/.test(stText) && /BACKUPS|Backups/.test(stText) && (await st.getByRole('button', { name: 'Export backup' }).count()) === 1 && (await st.getByRole('button', { name: 'Load sample data' }).count()) === 1 && (await st.getByRole('button', { name: /Erase all data/ }).count()) === 1);
  await menuClick(page, '#cloudBtn'); await page.waitForSelector('.sheet');
  ok('the sheet behind the menu’s storage row carries the same name and the backups', (await page.locator('.sheet[aria-label="Storage, sync & backups"]').count()) === 1 && (await page.locator('.sheet').getByRole('button', { name: 'Export backup' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(250);

  // ---- boxes that save as they are left: the next box still gets the focus, and what is typed there ----
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await page.evaluate(() => { document.querySelectorAll('#page details').forEach(d => { d.open = true; }); }); await sleep(400);
  await page.evaluate(() => import('./js/money.js').then(m => m.setBilling({ dayRate: '', hourRate: '', overtimeRate: '', kitRate: '' }))); await sleep(300);
  const focusOn = () => page.evaluate(() => { const a = document.activeElement; return a === document.body ? 'nothing' : a.getAttribute('aria-label') || a.tagName; });
  const rates = () => page.evaluate(() => import('./js/money.js').then(m => { const b = m.billing(); return [b.dayRate, b.hourRate, b.overtimeRate, b.kitRate].join('/'); }));
  const QI = '#page details[data-s="Quotes & invoices"] input';
  const dayBox = page.locator(QI + '[aria-label^="Day rate"]'); await dayBox.scrollIntoViewIfNeeded(); await dayBox.click(); await page.keyboard.type('650'); await page.keyboard.press('Tab'); await sleep(300);
  const tab1 = await focusOn(); await page.keyboard.type('75'); await page.keyboard.press('Tab'); await sleep(300);
  const tab2 = await focusOn();
  ok('a rate typed, Tab, the next rate typed, Tab: the focus goes from box to box and both rates are stored', /^Hour rate/.test(tab1) && /^Overtime/.test(tab2) && (await rates()) === '650/75//', JSON.stringify([tab1, tab2, await rates()]));
  await page.locator(QI + '[aria-label^="Overtime"]').click(); await page.keyboard.type('95');
  const kitBox = await page.locator(QI + '[aria-label^="Equipment package"]').boundingBox(); await page.mouse.click(kitBox.x + kitBox.width / 2, kitBox.y + kitBox.height / 2); await sleep(400);
  const clicked = await focusOn(); await page.keyboard.type('120'); await page.keyboard.press('Tab'); await sleep(300);
  ok('…and one click into the next box after typing a rate puts the cursor there: both are stored', /^Equipment package/.test(clicked) && (await rates()) === '650/75/95/120', JSON.stringify([clicked, await rates()]));
  // the currency box shows what was stored, not what was typed
  const cur = page.locator('#page input[aria-label="Currency symbol"]'); await cur.scrollIntoViewIfNeeded();
  const curNow = async typed => { await cur.click(); await cur.press('Control+a'); await cur.press('Delete'); if (typed) await page.keyboard.type(typed); await page.keyboard.press('Enter'); await sleep(350); return [await page.evaluate(() => import('./js/store.js').then(s => s.db.profile.currency)), await page.locator('#page input[aria-label="Currency symbol"]').inputValue()].join('|'); };
  const curSpaced = await curNow(' £ '), curEmpty = await curNow('');
  ok('a currency symbol typed with spaces, or emptied, shows in its box as it was stored', curSpaced === '£|£' && curEmpty === '$|$', curSpaced + ' / ' + curEmpty);
  await curNow('€');
  // a job type's checklists stay unfolded while they are edited: every save draws the page again
  const wed = page.locator('#page details.twirl', { has: page.locator('.twirl-name', { hasText: /Wedding/ }) }).first();
  await wed.evaluate(d => { d.open = false; }); await wed.locator('summary').click(); await sleep(200);
  const enq = wed.locator('textarea[aria-label$="Enquiry checklist"]'); await enq.click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nAsk about the venue curfew');
  const quoted = await wed.locator('textarea[aria-label$="Quoted checklist"]').boundingBox(); await page.mouse.click(quoted.x + 20, quoted.y + 10); await sleep(400);
  const inQuoted = await focusOn(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nSend the contract'); await page.keyboard.press('Tab'); await sleep(400);
  const tplNow = await page.evaluate(() => import('./js/store.js').then(s => { const t = (s.db.templates || {}).wedding || {}; return { enquiry: (t.Enquiry || []).slice(-1)[0], quoted: (t.Quoted || []).slice(-1)[0], open: [...document.querySelectorAll('#page details.twirl')].filter(d => /Wedding/.test(d.querySelector('.twirl-name')?.textContent || '')).map(d => d.open).join() }; }));
  ok('a job type stays unfolded while its checklists are edited: a line added to one stage, a click into the next, a line added there, and both are stored', /Quoted checklist$/.test(inQuoted) && tplNow.enquiry === 'Ask about the venue curfew' && tplNow.quoted === 'Send the contract' && tplNow.open === 'true', JSON.stringify([inQuoted, tplNow]));
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { if (d.templates) { delete d.templates.wedding; d.templates.updatedAt = Date.now(); } }))); await sleep(200);
  await page.setViewportSize({ width: 420, height: 900 }); await sleep(200);

  // ---- the Settings tutorial walks the groups and their sections ----
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  const steps = await page.evaluate(async () => { const m = await import('./js/tutorials.js'); return m.TUTORIALS.settings.dynamic().map(s => s.title); });
  ok('the Settings tutorial lists the groups and every section', steps.includes('General') && steps.includes('Work & billing') && steps.includes('About & Licence') && steps.includes('Storage, sync & backups') && steps.length >= 12, steps.join(' · '));
  await page.screenshot({ path: S + '/settings-groups.png', fullPage: true });
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

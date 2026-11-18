// The top bar's menu. The bar is one slim row: the brand, a place for the search control, the lock (only when a PIN
// is set) and the hamburger. Everything else the bar used to hold is a row of the panel that slides in from the side:
// the page's tutorial, Install (only while Vdex is not installed), text size and theme, and storage, with the sync
// status in words at its top and the version at its foot. The hamburger carries a dot about the cloud storage: none
// when all is well, amber while saving or when it needs the person, red on an error. The panel is a dialog: the
// keyboard stays inside it, Escape, the ✕ and the backdrop close it, the focus goes back to the hamburger, and a row
// closes it before doing its work. It is never left open under a sheet, a walkthrough or the lock.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { acceptTerms, openMenu, menuClick } = require('../helpers.cjs');
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const S = process.env.S || '/tmp';
const VERSION = /VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'version.js'), 'utf8'))[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // A page of its own: a phone unless told otherwise, the terms accepted and the first-run tour done.
  const open = async ({ w = 360, h = 740, installed = false, terms = true, options = {} } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...options });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    if (terms) await ctx.addInitScript(acceptTerms());
    if (installed) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }); }); // what an installed iPhone web app reports
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
    await page.goto(URL);
    if (terms) await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const rows = page => page.locator('#menu .menu-row:visible .menu-name').allInnerTexts();
  const bar = page => page.evaluate(() => {
    const top = document.querySelector('.top').getBoundingClientRect(), shown = [...document.querySelectorAll('.top-actions button')].filter(b => !b.hidden);
    const box = b => { const r = b.getBoundingClientRect(); return { id: b.id, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) }; };
    return { height: Math.round(top.height), buttons: shown.map(box), fits: document.documentElement.scrollWidth <= innerWidth, drum: Math.round(document.querySelector('#rolodex .drum').getBoundingClientRect().height), rolodexTop: Math.round(document.getElementById('rolodex').getBoundingClientRect().top), barBottom: Math.round(top.bottom) };
  });
  const menuState = page => page.evaluate(() => { const b = document.getElementById('menuBtn'), back = document.getElementById('menuBack'); return { open: !back.hidden, expanded: b.getAttribute('aria-expanded'), inert: document.getElementById('app').inert, focus: document.activeElement && document.activeElement.id, bodyClass: document.body.classList.contains('menu-open') }; });
  const closed = s => !s.open && s.expanded === 'false' && !s.inert && !s.bodyClass;
  const focusId = page => page.evaluate(() => document.activeElement && document.activeElement.id);

  /* ---------------------------- the bar and the menu's contents ---------------------------- */
  let { ctx, page } = await open();
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(300);
  const b0 = await bar(page);
  ok('at 360 px the bar is one slim row holding only the hamburger, with no sideways scroll, and the Rolodex below keeps its full height', b0.buttons.length === 1 && b0.buttons[0].id === 'menuBtn' && b0.height <= 64 && b0.fits && b0.drum === 128 && b0.rolodexTop >= b0.barBottom, JSON.stringify(b0));
  ok('the hamburger is a 44 px target at the right of the bar', b0.buttons[0].w >= 44 && b0.buttons[0].h >= 44 && b0.buttons[0].right >= 360 - 17, JSON.stringify(b0.buttons[0]));
  const attrs = await page.evaluate(() => { const b = document.getElementById('menuBtn'), m = document.getElementById(b.getAttribute('aria-controls')); return { name: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), popup: b.getAttribute('aria-haspopup'), role: m && m.getAttribute('role'), modal: m && m.getAttribute('aria-modal'), label: m && document.getElementById(m.getAttribute('aria-labelledby'))?.textContent, described: m && m.getAttribute('aria-describedby'), hidden: m && m.offsetParent === null, lock: document.getElementById('lockBtn').hidden }; });
  ok('closed, the hamburger is named Menu, says it is collapsed and controls a dialog labelled Menu; the lock is not shown without a PIN', attrs.name === 'Menu' && attrs.expanded === 'false' && attrs.popup === 'dialog' && attrs.role === 'dialog' && attrs.modal === 'true' && attrs.label === 'Menu' && attrs.described === 'menuStatus' && attrs.hidden && attrs.lock, JSON.stringify(attrs));
  ok('the menu’s code is not fetched until the menu is first opened', !(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /js\/menu\.js/.test(r.name)))));

  await page.locator('#menuBtn').click(); await page.locator('#menu').waitFor({ state: 'visible' }); await sleep(350);
  const r0 = await rows(page);
  ok('in a browser the menu lists the tutorial, Install, text size and theme, and storage, in that order', JSON.stringify(r0) === JSON.stringify(['Tutorial for this page', 'Install Vdex', 'Text size and theme', 'Storage, sync and backups']), r0.join(' | '));
  const top0 = await page.evaluate(() => ({ title: document.getElementById('menuStatusTitle').textContent, text: document.getElementById('menuStatusText').textContent, row: document.getElementById('cloudLabel').textContent, version: document.getElementById('menuVersion').textContent, statusFirst: document.getElementById('menuStatus').getBoundingClientRect().bottom <= document.getElementById('helpBtn').getBoundingClientRect().top, versionLast: document.getElementById('menuVersion').getBoundingClientRect().top >= document.getElementById('cloudBtn').getBoundingClientRect().bottom }));
  ok('its top says in words that everything is kept on this device, and its foot gives the version', top0.title === 'Kept on this device only' && /No cloud storage is linked/.test(top0.text) && top0.row === 'Local' && top0.version === 'Vdex ' + VERSION && top0.statusFirst && top0.versionLast, JSON.stringify(top0));
  const s1 = await menuState(page);
  ok('open: the hamburger says expanded, the page behind is out of reach and the first row has the focus', s1.open && s1.expanded === 'true' && s1.inert && s1.focus === 'helpBtn', JSON.stringify(s1));
  const geo = await page.evaluate(() => { const m = document.getElementById('menu'), r = m.getBoundingClientRect(); const hit = [...m.querySelectorAll('button')].filter(b => b.offsetParent).map(b => { const q = b.getBoundingClientRect(); return [b.id, Math.round(q.width), Math.round(q.height), q.left >= r.left && q.right <= r.right]; }); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), fits: m.scrollWidth <= m.clientWidth && document.documentElement.scrollWidth <= innerWidth, hit, anim: getComputedStyle(m).animationName, z: Number(getComputedStyle(document.getElementById('menuBack')).zIndex) }; });
  ok('the panel is at the right, the full height, leaving a strip of the page to tap; nothing in it is clipped sideways', geo.right === 360 && geo.left >= 40 && geo.top === 0 && geo.bottom === 740 && geo.fits, JSON.stringify(geo));
  ok('its rows are large (at least 60 px tall) and the ✕ is a 44 px target, all inside the panel', geo.hit.length === 5 && geo.hit.every(([id, w, h, inside]) => inside && w >= 44 && h >= (id === 'menuClose' ? 44 : 60)), JSON.stringify(geo.hit));
  ok('it slides in, and sits under sheets (100), walkthroughs (150) and the lock (300)', geo.anim === 'menuIn' && geo.z < 100, `${geo.anim}, z ${geo.z}`);
  ok('the menu shows no price, Buy button or link', (await page.locator('#menu a').count()) === 0 && !/\$|£|€|buy/i.test(await page.locator('#menu').innerText()));
  // The "new version" and licence bars float above the page (and above sheets): under the open menu they go behind it.
  await page.evaluate(() => { const b = document.createElement('div'); b.className = 'update-bar'; b.id = 'testBar'; b.textContent = 'A new version of Vdex is ready.'; document.body.append(b); });
  const over = () => page.evaluate(() => { const r = document.getElementById('testBar').getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el.closest('#menuBack') ? 'menu' : el.id; });
  const barOpen = await over();
  await page.keyboard.press('Escape');
  const barClosed = await over();
  ok('the update and licence bars sit behind the open menu, not over its rows, and are back in front once it closes', barOpen === 'menu' && barClosed === 'testBar', `${barOpen}, ${barClosed}`);
  await page.evaluate(() => document.getElementById('testBar').remove());
  await openMenu(page); await sleep(350);
  await page.screenshot({ path: S + '/menu-360.png' });

  /* ------------------------------------ closing it ------------------------------------ */
  await page.keyboard.press('Escape');
  const s2 = await menuState(page);
  ok('Escape closes it and the focus goes back to the hamburger', closed(s2) && s2.focus === 'menuBtn', JSON.stringify(s2));
  await openMenu(page); await sleep(300);
  await page.mouse.click(20, 400);
  const s3 = await menuState(page);
  ok('a tap on the backdrop closes it, focus back on the hamburger', closed(s3) && s3.focus === 'menuBtn', JSON.stringify(s3));
  await openMenu(page); await sleep(300);
  await page.locator('#menuClose').click();
  const s4 = await menuState(page);
  ok('the ✕ closes it, focus back on the hamburger', closed(s4) && s4.focus === 'menuBtn', JSON.stringify(s4));

  /* ------------------------------------ the keyboard ------------------------------------ */
  await page.locator('#menuBtn').focus(); await page.keyboard.press('Enter'); await page.locator('#menu').waitFor({ state: 'visible' });
  const k = [await focusId(page)];
  for (const key of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) { await page.keyboard.press(key); k.push(await focusId(page)); }
  ok('Enter on the hamburger opens it; Tab and Shift+Tab go round inside it, and the arrow keys move up and down the rows', k.join(' ') === 'helpBtn menuClose cloudBtn menuClose helpBtn installBtn displayBtn cloudBtn menuClose cloudBtn', k.join(' '));
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
  ok('the arrow keys stay in the menu: the Rolodex behind it does not turn', (await page.evaluate(() => window.logiPage())) === 'bookings', await page.evaluate(() => window.logiPage()));
  await page.keyboard.press('ArrowUp'); // Text size and theme
  await page.keyboard.press('Enter'); await page.waitForSelector('.sheet');
  const s5 = await menuState(page);
  ok('Enter on a row closes the menu and then opens what the row is for', !s5.open && s5.expanded === 'false' && (await page.locator('.sheet[aria-label="Display & accessibility"]').count()) === 1, JSON.stringify(s5));
  await page.keyboard.press('Escape'); await sleep(200);
  const s6 = await menuState(page);
  ok('closing that sheet puts the focus back on the hamburger, and the page is usable again', closed(s6) && s6.focus === 'menuBtn' && (await page.locator('.sheet').count()) === 0, JSON.stringify(s6));

  /* ------------------------------------ each row ------------------------------------ */
  await menuClick(page, '#cloudBtn'); await page.waitForSelector('.sheet .storage');
  ok('Storage, sync and backups closes the menu and opens the storage sheet with the backups', !(await menuState(page)).open && (await page.locator('.sheet[aria-label="Storage, sync & backups"]').count()) === 1 && (await page.locator('.sheet').getByRole('button', { name: 'Export backup' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  await menuClick(page, '#installBtn'); await page.waitForSelector('.sheet');
  ok('Install closes the menu and, with no install prompt from the browser, shows how to install', !(await menuState(page)).open && (await page.locator('.sheet[aria-label="Install Vdex"]').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  // The browser's own install prompt opens no sheet of ours: the row itself must have closed the menu before asking.
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => { window.__prompts = (window.__prompts || 0) + 1; window.__menuAtPrompt = !document.getElementById('menuBack').hidden; }; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
  await menuClick(page, '#installBtn'); await sleep(200);
  const prompt = await page.evaluate(() => ({ prompts: window.__prompts, menuAtPrompt: window.__menuAtPrompt, sheets: document.querySelectorAll('.sheet').length }));
  ok('with the browser’s install prompt ready, Install closes the menu first and then shows the prompt', prompt.prompts === 1 && prompt.menuAtPrompt === false && prompt.sheets === 0 && closed(await menuState(page)) && (await focusId(page)) === 'menuBtn', JSON.stringify(prompt));
  await menuClick(page, '#helpBtn'); await page.waitForSelector('.tour-card h2');
  ok('Tutorial for this page closes the menu and starts the tutorial of the page that is open', !(await menuState(page)).open && /calendar/i.test(await page.locator('.tour-card h2').innerText()), await page.locator('.tour-card h2').innerText());
  await page.keyboard.press('Escape'); await sleep(200);
  ok('after the tutorial the page is usable and the menu is closed', closed(await menuState(page)) && (await page.locator('.tour').count()) === 0);

  /* ------------------------- never under a sheet or a walkthrough ------------------------- */
  await openMenu(page); await sleep(250);
  await page.evaluate(() => import('./js/a11y.js').then(m => m.openDisplaySettings())); await page.waitForSelector('.sheet');
  const s7 = await menuState(page);
  ok('a sheet that opens while the menu is open closes the menu first', !s7.open && s7.expanded === 'false' && !s7.bodyClass && s7.inert, JSON.stringify(s7));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and closing the sheet leaves the page usable, focus on the hamburger', closed(await menuState(page)) && (await focusId(page)) === 'menuBtn');
  await openMenu(page); await sleep(250);
  await page.evaluate(() => import('./js/tour.js').then(t => { t.runTour([{ title: 'A walkthrough', text: 'Started while the menu was open.', target: null }]); })); await page.waitForSelector('.tour-card');
  ok('a walkthrough that starts while the menu is open closes the menu', !(await menuState(page)).open);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and the page is usable when it ends', closed(await menuState(page)));

  /* ---------------------- the Getting around tutorial shows the menu ---------------------- */
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2');
  const seen = [];
  for (let i = 0; i < 8; i++) {
    await sleep(700);
    if (!(await page.locator('.tour-card h2').count())) break; // it ended early: the checks below say so
    const st = await page.evaluate(() => { const back = document.getElementById('menuBack'), spot = document.querySelector('.tour-spot'), r = spot.getBoundingClientRect(), m = document.getElementById('menu').getBoundingClientRect(); return { title: document.querySelector('.tour-card h2').textContent, step: document.querySelector('.tour-step').textContent, button: document.querySelector('.tour-card .btn.primary').textContent, menu: !back.hidden, look: back.inert && back.classList.contains('shown'), onMenu: !spot.classList.contains('center') && r.left >= m.left - 10 && r.right <= m.right + 10 && r.width > 100, focusInCard: !!document.activeElement.closest('.tour-card') }; });
    seen.push(st);
    if (st.title === 'How syncing is going' && seen.length === 3) { // Back from the first menu step: the menu closes again
      await page.locator('.tour-card').getByRole('button', { name: 'Back', exact: true }).click(); await sleep(700);
      seen.push({ back: true, title: await page.locator('.tour-card h2').innerText(), menu: !(await page.evaluate(() => document.getElementById('menuBack').hidden)) });
      await page.locator('.tour-card .btn.primary').click(); await sleep(700);
    }
    if (st.button === 'Done') break;
    await page.locator('.tour-card .btn.primary').click();
  }
  const steps = seen.filter(x => !x.back), menuSteps = steps.filter(x => x.menu), wentBack = seen.find(x => x.back);
  ok('Getting around: the top bar, then three steps inside the menu, counted right to the end', steps.map(x => x.title).join(' · ') === 'The Rolodex · The top bar · How syncing is going · The menu · Tutorial for this page' && steps[4].step === '5 / 5' && steps[4].button === 'Done', steps.map(x => `${x.step} ${x.title}`).join(' · '));
  ok('its menu steps show the menu open, to look at and not to use, with the spotlight on it and the focus in the card', menuSteps.length === 3 && menuSteps.every(x => x.look && x.onMenu && x.focusInCard) && !steps[0].menu && !steps[1].menu, JSON.stringify(steps.map(x => [x.title, x.menu, x.look, x.onMenu, x.focusInCard])));
  ok('going Back to a step outside the menu closes it', wentBack && wentBack.title === 'The top bar' && wentBack.menu === false, JSON.stringify(wentBack));
  await page.screenshot({ path: S + '/menu-tutorial-360.png' });
  if (await page.locator('.tour-card .btn.primary').count()) await page.locator('.tour-card .btn.primary').click();
  await sleep(300);
  ok('Done closes the walkthrough and the menu, and the page is usable', (await page.locator('.tour').count()) === 0 && closed(await menuState(page)));
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2');
  for (let i = 0; i < 3; i++) { await sleep(700); await page.locator('.tour-card .btn.primary').click(); }
  await sleep(700);
  const mid = await menuState(page);
  await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape on a menu step closes the walkthrough and the menu together', mid.open && (await page.locator('.tour').count()) === 0 && closed(await menuState(page)), JSON.stringify(mid));

  const words = await page.evaluate(async () => { const m = await import('./js/tutorials.js'); return m.stepsFor('setup').map(x => x.text).join(' '); });
  ok('the set-up walkthrough sends people to the menu for a page’s tutorial, not to a ? button in the bar', (words.match(/Tutorial for this page/g) || []).length === 2 && /menu ☰ at the top right/.test(words) && !/Tap \? at the top/.test(words));
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; }); await openMenu(page); await sleep(300);
  const rtl = await page.evaluate(() => { const r = document.getElementById('menu').getBoundingClientRect(), b = document.getElementById('menuBtn').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), anim: getComputedStyle(document.getElementById('menu')).animationName, btnLeft: Math.round(b.left), fits: document.documentElement.scrollWidth <= innerWidth }; });
  await page.keyboard.press('Escape'); await page.evaluate(() => { document.documentElement.removeAttribute('dir'); }); await sleep(100);
  ok('on a right-to-left page the hamburger is at the left and the panel comes in from that side', rtl.left === 0 && rtl.right <= 320 && rtl.anim === 'menuInRtl' && rtl.btnLeft <= 17 && rtl.fits, JSON.stringify(rtl));

  /* ------------------------------------ the status dot ------------------------------------ */
  await sleep(1500); // the licence check has had its say (licences are off here), so a pause set below stays
  const setCloud = st => page.evaluate(async st => {
    const s = await import('./js/store.js');
    const fake = (over = {}) => ({ id: 'gdrive', label: 'Google Drive', ready: async () => true, read: async () => null, write: async () => {}, ...over });
    if (st === 'off') await s.unlinkCloud();
    if (st === 'synced') { s.cloud.adapter = fake(); await s.sync(); }
    if (st === 'saving') { s.cloud.adapter = fake({ write: () => new Promise(r => { window.__letGo = r; }) }); s.sync(); await new Promise(r => setTimeout(r, 250)); }
    if (st === 'needs-permission') { s.cloud.adapter = fake(); await s.sync(); s.reconnectNeeded(); }
    if (st === 'error') { s.cloud.adapter = fake({ read: async () => { throw new Error('Google Drive did not answer'); } }); await s.sync(); }
    if (st === 'paused') { s.cloud.adapter = fake(); await s.sync(); s.setPaid(false); }
    const b = document.getElementById('menuBtn'), dot = b.querySelector('.menu-dot'), cs = getComputedStyle(dot);
    const colour = v => { const e = document.createElement('i'); e.style.background = `var(${v})`; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; };
    const out = { status: s.cloud.status, dot: b.dataset.dot || '', shown: cs.display !== 'none', amber: cs.backgroundColor === colour('--warn'), red: cs.backgroundColor === colour('--danger'), differ: colour('--warn') !== colour('--danger'), mark: getComputedStyle(dot, '::after').content, pulse: cs.animationName, size: Math.round(dot.getBoundingClientRect().width), name: b.getAttribute('aria-label'), title: b.title, line: document.getElementById('menuStatusTitle').textContent, text: document.getElementById('menuStatusText').textContent, row: document.getElementById('cloudLabel').textContent, lineState: document.getElementById('menuStatus').dataset.state };
    if (st === 'saving') { window.__letGo(); await new Promise(r => setTimeout(r, 100)); }
    if (st === 'paused') s.setPaid(true);
    return out;
  }, st);
  const well = d => d.dot === '' && !d.shown && d.name === 'Menu' && d.title === 'Menu';
  const synced = await setCloud('synced');
  ok('synced: no dot, the hamburger is plainly Menu, and the menu says Synced with the storage’s name', synced.status === 'synced' && well(synced) && synced.line === 'Synced with Google Drive' && /up to date/.test(synced.text) && synced.row === 'Synced' && synced.lineState === 'synced', JSON.stringify(synced));
  const saving = await setCloud('saving');
  ok('syncing: an amber dot that pulses, and a name that says it is saving', saving.status === 'saving' && saving.dot === 'amber' && saving.shown && saving.amber && saving.pulse === 'pulse' && saving.name === 'Menu. Saving to Google Drive…' && saving.title === saving.name && saving.line === 'Saving to Google Drive…' && saving.row === 'Saving…', JSON.stringify(saving));
  const needs = await setCloud('needs-permission');
  ok('needs sign-in: a steady amber dot, and the name and the menu say to sign in again and where', needs.status === 'needs-permission' && needs.dot === 'amber' && needs.shown && needs.amber && needs.pulse === 'none' && needs.name === 'Menu. Google Drive needs you to sign in again' && needs.line === 'Google Drive needs you to sign in again' && /Storage, sync and backups.*Sign in again/.test(needs.text) && needs.row === 'Sign in', JSON.stringify(needs));
  const error = await setCloud('error');
  ok('error: a red dot, larger and marked with a ! so it is not told by colour alone, and the name and the menu say what went wrong', error.status === 'error' && error.dot === 'red' && error.shown && error.red && error.differ && /!/.test(error.mark) && error.size > needs.size && error.name === 'Menu. Could not sync with Google Drive' && error.line === 'Could not sync with Google Drive' && /Google Drive did not answer · Your changes are safe on this device/.test(error.text) && error.row === 'Sync error' && error.lineState === 'error', JSON.stringify(error));
  const paused = await setCloud('paused');
  ok('paused: an amber dot, and the name and the menu say sync is paused, with no price or Buy', paused.status === 'paused' && paused.dot === 'amber' && paused.shown && paused.amber && paused.name === 'Menu. Sync with Google Drive is paused' && /until this device has a licence/.test(paused.text) && !/\$|buy/i.test(paused.text) && paused.row === 'Paused', JSON.stringify(paused));
  const off = await setCloud('off');
  ok('local only again: no dot, plainly Menu', off.status === 'off' && well(off) && off.line === 'Kept on this device only' && off.row === 'Local', JSON.stringify(off));
  await setCloud('error'); await openMenu(page); await sleep(300);
  await page.screenshot({ path: S + '/menu-error-360.png' });
  ok('with the menu open the status is the first thing in it, readable in full', await page.evaluate(() => { const s = document.getElementById('menuStatus'), m = document.getElementById('menu').getBoundingClientRect(), r = s.getBoundingClientRect(); return r.left >= m.left && r.right <= m.right && s.scrollWidth <= s.clientWidth && r.top < document.getElementById('helpBtn').getBoundingClientRect().top; }));
  await page.keyboard.press('Escape'); await setCloud('off');

  /* --------------------------- a place for the search control --------------------------- */
  const slot = await page.evaluate(() => { const t = document.querySelector('.top'), kids = [...t.children].map(c => c.className.split(' ')[0]); const s = document.getElementById('topSearch'); return { kids, room: s.getBoundingClientRect().width }; });
  ok('the bar has an empty place for the search control between the brand and the buttons, taking no room', JSON.stringify(slot.kids) === JSON.stringify(['brand', 'top-search', 'top-actions']) && slot.room === 0, JSON.stringify(slot));
  await page.evaluate(() => { const b = document.createElement('button'); b.className = 'cloud'; b.textContent = '🔍'; document.getElementById('topSearch').append(b); });
  const withSearch = await bar(page);
  const slotBox = await page.evaluate(() => { const r = document.querySelector('#topSearch button').getBoundingClientRect(), m = document.getElementById('menuBtn').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect(); return { top: Math.round(r.top), w: Math.round(r.width), right: Math.round(r.right), menuTop: Math.round(m.top), menuLeft: Math.round(m.left), brandRight: Math.round(br.right) }; });
  ok('a button put there sits on the same row between the brand and the hamburger, and the bar stays slim with no sideways scroll', withSearch.height <= 64 && withSearch.fits && slotBox.top === slotBox.menuTop && slotBox.w >= 44 && slotBox.right <= slotBox.menuLeft && slotBox.brandRight <= slotBox.right - slotBox.w, JSON.stringify({ withSearch, slotBox }));
  await page.evaluate(() => document.getElementById('topSearch').replaceChildren());
  await ctx.close();

  /* ------------------------------ with a PIN: the lock stays in the bar ------------------------------ */
  ({ ctx, page } = await open());
  await page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810')));
  await page.waitForFunction(() => !document.getElementById('lockBtn').hidden, null, { timeout: 60000 });
  await page.evaluate(() => { const b = document.createElement('button'); b.className = 'cloud'; b.textContent = '🔍'; document.getElementById('topSearch').append(b); }); // the fullest the bar gets: search, lock, hamburger
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.cloud.adapter = { id: 'gdrive', label: 'Google Drive', ready: async () => true, read: async () => { throw new Error('no'); }, write: async () => {} }; await s.sync(); });
  const b1 = await bar(page);
  ok('with a PIN the lock shows beside the hamburger, to its left, both 44 px; at 360 px the bar is still one slim row with no sideways scroll, even with a search button and the dot', b1.buttons.map(b => b.id).join(',') === 'lockBtn,menuBtn' && b1.buttons.every(b => b.w >= 44 && b.h >= 44 && b.top === b1.buttons[0].top) && b1.buttons[0].right <= b1.buttons[1].left && b1.height <= 64 && b1.fits && b1.drum === 128, JSON.stringify(b1));
  await page.screenshot({ path: S + '/bar-pin-360.png', clip: { x: 0, y: 0, width: 360, height: 200 } });
  await page.evaluate(() => document.getElementById('topSearch').replaceChildren());
  await openMenu(page); await sleep(250);
  ok('the lock is not a row of the menu', !(await rows(page)).some(t => /lock/i.test(t)) && (await page.locator('#menu #lockBtn').count()) === 0);
  await page.evaluate(() => import('./js/lock.js').then(l => l.lockNow())); await page.waitForSelector('.lock');
  const underLock = await menuState(page);
  ok('locking while the menu is open closes the menu: it is not left behind the lock screen', !underLock.open && underLock.expanded === 'false' && !underLock.bodyClass, JSON.stringify(underLock));
  await page.keyboard.type('246810'); await page.waitForSelector('.lock', { state: 'detached', timeout: 60000 }); await sleep(300);
  ok('unlocked, the page is usable and the menu opens again', closed(await menuState(page)));
  await page.locator('#lockBtn').click(); await page.waitForSelector('.lock');
  ok('the lock button in the bar locks at once', (await page.locator('.lock').count()) === 1);
  await page.keyboard.type('246810'); await page.waitForSelector('.lock', { state: 'detached', timeout: 60000 }); await sleep(300);
  await page.evaluate(() => import('./js/lock.js').then(l => l.removePin())); await sleep(300);
  ok('with the PIN removed the lock leaves the bar', await page.locator('#lockBtn').isHidden());
  await ctx.close();

  /* ---------------------------------- installed: no Install ---------------------------------- */
  ({ ctx, page } = await open({ installed: true }));
  await openMenu(page); await sleep(250);
  const r1 = await rows(page);
  ok('once installed, Install is not listed', JSON.stringify(r1) === JSON.stringify(['Tutorial for this page', 'Text size and theme', 'Storage, sync and backups']) && (await page.locator('#installBtn').isHidden()), r1.join(' | '));
  const k2 = [await focusId(page)];
  for (const key of ['ArrowDown', 'ArrowDown', 'Tab', 'Tab']) { await page.keyboard.press(key); k2.push(await focusId(page)); }
  ok('…and the keyboard skips it', k2.join(' ') === 'helpBtn displayBtn cloudBtn menuClose helpBtn', k2.join(' '));
  await ctx.close();

  /* ------------------------------ a wide screen, and reduced motion ------------------------------ */
  ({ ctx, page } = await open({ w: 1200, h: 800, options: { reducedMotion: 'reduce' } }));
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(300);
  const b2 = await bar(page);
  ok('at 1200 px the bar is one slim row and the hamburger shows its label', b2.height <= 64 && b2.fits && b2.buttons.length === 1 && (await page.locator('#menuBtn .cloud-label').evaluate(e => e.getBoundingClientRect().width)) > 10 && (await page.locator('#menuBtn').innerText()).trim() === 'Menu', JSON.stringify(b2));
  await openMenu(page);
  const wide = await page.evaluate(() => { const m = document.getElementById('menu'), r = m.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), anim: getComputedStyle(m).animationName, fade: getComputedStyle(document.getElementById('menuBack')).animationName, fits: document.documentElement.scrollWidth <= innerWidth }; });
  ok('the panel is 340 px wide against the right edge, the full height', wide.right === 1200 && wide.w === 340 && wide.h === 800 && wide.fits, JSON.stringify(wide));
  ok('with reduced motion asked for, it appears without sliding or fading', wide.anim === 'none' && wide.fade === 'none', JSON.stringify(wide));
  await page.screenshot({ path: S + '/menu-1200.png' });
  await ctx.close();

  /* ----------------------------------- the terms gate ----------------------------------- */
  ({ ctx, page } = await open({ terms: false }));
  await page.waitForSelector('.terms-gate');
  const gate = await page.evaluate(() => ({ inert: document.getElementById('app').inert, hidden: document.getElementById('menuBack').hidden, top: document.elementFromPoint(innerWidth - 30, 30)?.closest('.terms-gate') != null }));
  ok('behind the terms gate the hamburger is out of reach and the menu stays closed', gate.inert && gate.hidden && gate.top, JSON.stringify(gate));
  await ctx.close();

  ok('no page errors or Content Security Policy refusals', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

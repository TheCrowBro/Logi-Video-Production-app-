// The top bar: its menu, and the search across everything. The bar is one slim row: the brand, the search control, the
// lock (only when a PIN is set) and the hamburger. Everything else the bar used to hold is a row of the panel that
// slides in from the side: the page's tutorial, Install (only while Vdex is not installed), text size and theme, and
// storage, with the sync status in words at its top (plain words when all is well, a button to the storage sheet when
// it needs the person) and the version at its foot. The hamburger carries a dot about the
// cloud storage: none when all is well, amber while saving or when it needs the person, red on an error. The panel is
// a dialog: the keyboard stays inside it, Escape, the ✕ and the backdrop close it, the focus goes back to the
// hamburger, and a row closes it before doing its work. It is never left open under a sheet, a walkthrough or the lock.
//
// The search control (a magnifier on a phone, a field-shaped button on a wide screen, "/" or Ctrl+K on a keyboard)
// opens a dialog with one field. What is typed is looked for in everything on the device: bookings and their call
// sheets, stripboards, quotes and invoices, crew, equipment and kits, venues, policies, timecode logs, your own
// details and your settings lists. Every word must be found, in any order; capitals, accents and the punctuation
// round a word do not matter; a match in a name or title comes before a match in notes. Results are options of a list
// box, grouped by page with a count each, the words marked in them; chips keep them to one page; the arrow keys move,
// Enter opens, Escape closes. A result opens the thing itself where it lives. Nothing is asked of the network and
// nothing is written to storage; it works while Vdex is read-only; locking closes and empties it, and while locked
// it cannot be opened.
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
  const open = async ({ w = 360, h = 740, installed = false, terms = true, options = {}, init = null } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...options });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    if (terms) await ctx.addInitScript(acceptTerms());
    if (installed) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }); }); // what an installed iPhone web app reports
    if (init) await ctx.addInitScript(init);
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
    return { height: Math.round(top.height), buttons: shown.map(box), search: box(document.getElementById('searchBtn')), fits: document.documentElement.scrollWidth <= innerWidth, drum: Math.round(document.querySelector('#rolodex .drum').getBoundingClientRect().height), rolodexTop: Math.round(document.getElementById('rolodex').getBoundingClientRect().top), barBottom: Math.round(top.bottom) };
  });
  const menuState = page => page.evaluate(() => { const b = document.getElementById('menuBtn'), back = document.getElementById('menuBack'); return { open: !back.hidden, expanded: b.getAttribute('aria-expanded'), inert: document.getElementById('app').inert, focus: document.activeElement && document.activeElement.id, bodyClass: document.body.classList.contains('menu-open') }; });
  const closed = s => !s.open && s.expanded === 'false' && !s.inert && !s.bodyClass;
  const focusId = page => page.evaluate(() => document.activeElement && document.activeElement.id);

  /* ---------------------------- the bar and the menu's contents ---------------------------- */
  let { ctx, page } = await open();
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(300);
  const b0 = await bar(page);
  ok('at 360 px the bar is one slim row holding the search and the hamburger, with no sideways scroll, and the Rolodex below keeps its full height', b0.buttons.length === 1 && b0.buttons[0].id === 'menuBtn' && b0.search.top === b0.buttons[0].top && b0.search.right <= b0.buttons[0].left && b0.height <= 64 && b0.fits && b0.drum === 128 && b0.rolodexTop >= b0.barBottom, JSON.stringify(b0));
  ok('the hamburger is a 44 px target at the right of the bar', b0.buttons[0].w >= 44 && b0.buttons[0].h >= 44 && b0.buttons[0].right >= 360 - 17, JSON.stringify(b0.buttons[0]));
  const attrs = await page.evaluate(() => { const b = document.getElementById('menuBtn'), m = document.getElementById(b.getAttribute('aria-controls')); return { name: b.getAttribute('aria-label'), expanded: b.getAttribute('aria-expanded'), popup: b.getAttribute('aria-haspopup'), role: m && m.getAttribute('role'), modal: m && m.getAttribute('aria-modal'), label: m && document.getElementById(m.getAttribute('aria-labelledby'))?.textContent, described: m && m.getAttribute('aria-describedby'), hidden: m && m.offsetParent === null, lock: document.getElementById('lockBtn').hidden }; });
  ok('closed, the hamburger is named Menu, says it is collapsed and controls a dialog labelled Menu; the lock is not shown without a PIN', attrs.name === 'Menu' && attrs.expanded === 'false' && attrs.popup === 'dialog' && attrs.role === 'dialog' && attrs.modal === 'true' && attrs.label === 'Menu' && attrs.described === 'menuStatus' && attrs.hidden && attrs.lock, JSON.stringify(attrs));
  ok('the menu’s code is not fetched until the menu is first opened', !(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /js\/menu\.js/.test(r.name)))));

  await page.locator('#menuBtn').click(); await page.locator('#menu').waitFor({ state: 'visible' }); await sleep(350);
  const r0 = await rows(page);
  ok('in a browser the menu lists the tutorial, Install, text size and theme, and storage, in that order', JSON.stringify(r0) === JSON.stringify(['Tutorial for this page', 'Install Vdex', 'Text size and theme', 'Storage, sync & backups']), r0.join(' | '));
  const plain0 = await page.evaluate(() => { const s = document.getElementById('menuStatus'), cs = getComputedStyle(s); return { tag: s.tagName, border: cs.borderTopColor, bg: cs.backgroundColor, cursor: cs.cursor, h: Math.round(s.getBoundingClientRect().height) }; });
  ok('with nothing to do about the storage, the status at the top is plain words: not a button, and with no box drawn round it like the rows below', plain0.tag === 'DIV' && /rgba\(0, 0, 0, 0\)|transparent/.test(plain0.border) && /rgba\(0, 0, 0, 0\)|transparent/.test(plain0.bg) && plain0.cursor !== 'pointer', JSON.stringify(plain0));
  const top0 = await page.evaluate(() => ({ title: document.getElementById('menuStatusTitle').textContent, text: document.getElementById('menuStatusText').textContent, row: document.getElementById('cloudLabel').textContent, version: document.getElementById('menuVersion').textContent, statusFirst: document.getElementById('menuStatus').getBoundingClientRect().bottom <= document.getElementById('helpBtn').getBoundingClientRect().top, versionLast: document.getElementById('menuVersion').getBoundingClientRect().top >= document.getElementById('cloudBtn').getBoundingClientRect().bottom }));
  ok('its top says in words that everything is kept on this device, and its foot gives the version', top0.title === 'Kept on this device only' && /No cloud storage is linked/.test(top0.text) && top0.row === 'Local' && top0.version === 'Vdex ' + VERSION && top0.statusFirst && top0.versionLast, JSON.stringify(top0));
  const s1 = await menuState(page);
  ok('open: the hamburger says expanded, the page behind is out of reach and the first row has the focus', s1.open && s1.expanded === 'true' && s1.inert && s1.focus === 'helpBtn', JSON.stringify(s1));
  const geo = await page.evaluate(() => { const m = document.getElementById('menu'), r = m.getBoundingClientRect(); const hit = [...m.querySelectorAll('button')].filter(b => b.offsetParent).map(b => { const q = b.getBoundingClientRect(); return [b.id, Math.round(q.width), Math.round(q.height), q.left >= r.left && q.right <= r.right]; }); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), fits: m.scrollWidth <= m.clientWidth && document.documentElement.scrollWidth <= innerWidth, hit, anim: getComputedStyle(m).animationName, z: Number(getComputedStyle(document.getElementById('menuBack')).zIndex) }; });
  ok('the panel is at the right, the full height, leaving a strip of the page to tap; nothing in it is clipped sideways', geo.right === 360 && geo.left >= 40 && geo.top === 0 && geo.bottom === 740 && geo.fits, JSON.stringify(geo));
  ok('its rows are large (at least 60 px tall) and the ✕ is a 44 px target, all inside the panel', geo.hit.length === 5 && geo.hit.every(([id, w, h, inside]) => inside && w >= 44 && h >= (id === 'menuClose' ? 44 : 60)), JSON.stringify(geo.hit));
  ok('it slides in, and sits under sheets (100), walkthroughs (150) and the lock (300)', geo.anim === 'menuIn' && geo.z < 100, `${geo.anim}, z ${geo.z}`);
  ok('the menu shows no price, Buy button or link', (await page.locator('#menu a').count()) === 0 && !/\$|£|€|buy/i.test(await page.locator('#menu').innerText()));
  await page.locator('#menuStatus').click(); await sleep(200);
  ok('a tap on the plain status does nothing: the menu stays open and no sheet opens', (await menuState(page)).open && (await page.locator('.sheet').count()) === 0);
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
  const named = await page.evaluate(() => ({ sheet: document.querySelector('.sheet').getAttribute('aria-label'), row: document.querySelector('#displayBtn .menu-sub').textContent }));
  ok('the row names the sheet it opens the way the sheet names itself (Display & accessibility)', named.row === named.sheet, JSON.stringify(named));
  await page.keyboard.press('Escape'); await sleep(200);
  const s6 = await menuState(page);
  ok('closing that sheet puts the focus back on the hamburger, and the page is usable again', closed(s6) && s6.focus === 'menuBtn' && (await page.locator('.sheet').count()) === 0, JSON.stringify(s6));

  /* ------------------------------------ each row ------------------------------------ */
  await menuClick(page, '#cloudBtn'); await page.waitForSelector('.sheet .storage');
  ok('Storage, sync & backups closes the menu and opens the storage sheet with the backups, which carries the same name as the row', !(await menuState(page)).open && (await page.locator('.sheet[aria-label="Storage, sync & backups"]').count()) === 1 && (await page.locator('.sheet').getByRole('button', { name: 'Export backup' }).count()) === 1 && (await page.evaluate(() => document.querySelector('#cloudBtn .menu-name').textContent === document.querySelector('.sheet').getAttribute('aria-label'))));
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
  for (let i = 0; i < 10; i++) {
    await sleep(1100); // a step that shows the search with results takes a moment longer, and the spotlight glides to its place
    if (!(await page.locator('.tour-card h2').count())) break; // it ended early: the checks below say so
    const st = await page.evaluate(() => { const back = document.getElementById('menuBack'), sb = document.getElementById('searchBack'), sp = document.getElementById('search'), spot = document.querySelector('.tour-spot'), r = spot.getBoundingClientRect(), m = document.getElementById('menu').getBoundingClientRect(), q = sp ? sp.getBoundingClientRect() : null; return { title: document.querySelector('.tour-card h2').textContent, step: document.querySelector('.tour-step').textContent, button: document.querySelector('.tour-card .btn.primary').textContent, menu: !back.hidden, look: back.inert && back.classList.contains('shown'), onMenu: !spot.classList.contains('center') && r.left >= m.left - 10 && r.right <= m.right + 10 && r.width > 100, search: !!sb && !sb.hidden, searchLook: !!sb && sb.inert && sb.classList.contains('shown'), text: document.querySelector('.tour-card p').textContent, q: (document.getElementById('searchInput') || { value: '' }).value, options: document.querySelectorAll('#searchList [role=option]').length, marks: document.querySelectorAll('#searchList mark').length, counts: [...document.querySelectorAll('#search .chip-n')].map(c => c.textContent).join(''), onSearch: !!q && !spot.classList.contains('center') && r.left >= q.left - 10 && r.right <= q.right + 10 && r.width > 100, spotOn: (() => { const near = el => { if (!el || el.offsetParent === null) return false; const b = el.getBoundingClientRect(); return Math.abs(b.left - 8 - r.left) < 3 && Math.abs(b.top - 8 - r.top) < 3; }; return near(document.getElementById('searchInput')) ? 'searchInput' : near(document.querySelector('#search .search-chips')) ? 'chips' : ''; })(), cardClear: (() => { const c = document.querySelector('.tour-card').getBoundingClientRect(); return c.top >= r.bottom - 1 || c.bottom <= r.top + 1; })(), onButton: !spot.classList.contains('center') && Math.abs(r.left + r.width / 2 - (document.getElementById('searchBtn').getBoundingClientRect().left + document.getElementById('searchBtn').getBoundingClientRect().width / 2)) < 4, focusInCard: !!document.activeElement.closest('.tour-card') }; });
    seen.push(st);
    if (st.title === 'How syncing is going' && !seen.some(x => x.back)) { // Back from the first menu step: the menu closes again, and the step before it shows the search again
      await page.locator('.tour-card').getByRole('button', { name: 'Back', exact: true }).click(); await sleep(1100);
      seen.push({ back: true, title: await page.locator('.tour-card h2').innerText(), menu: !(await page.evaluate(() => document.getElementById('menuBack').hidden)), search: !(await page.evaluate(() => (document.getElementById('searchBack') || { hidden: true }).hidden)) });
      await page.locator('.tour-card .btn.primary').click(); await sleep(1100);
    }
    if (st.button === 'Done') break;
    await page.locator('.tour-card .btn.primary').click();
  }
  const steps = seen.filter(x => !x.back), menuSteps = steps.filter(x => x.menu), wentBack = seen.find(x => x.back);
  ok('Getting around: the top bar, three steps about the search, then three inside the menu, counted right to the end', steps.map(x => x.title).join(' · ') === 'The Rolodex · The top bar · Search everything · What to type · What comes back · How syncing is going · The menu · Tutorial for this page' && steps[7].step === '8 / 8' && steps[7].button === 'Done', steps.map(x => `${x.step} ${x.title}`).join(' · '));
  ok('its menu steps show the menu open, to look at and not to use, with the spotlight on it and the focus in the card', menuSteps.length === 3 && menuSteps.every(x => x.look && x.onMenu && x.focusInCard && !x.search) && steps.slice(0, 5).every(x => !x.menu), JSON.stringify(steps.map(x => [x.title, x.menu, x.look, x.onMenu, x.focusInCard])));
  const searchSteps = steps.filter(x => x.search);
  ok('its search steps point at the search button, then show the search panel open, to look at and not to use, with the spotlight on its field and then on its chips', steps[2] && steps[2].onButton && !steps[2].search && searchSteps.map(x => x.title).join() === 'What to type,What comes back' && searchSteps.every(x => x.searchLook && x.onSearch && x.focusInCard && x.cardClear) && searchSteps[0].spotOn === 'searchInput' && searchSteps[1].spotOn === 'chips', JSON.stringify(steps.map(x => [x.title, x.search, x.searchLook, x.onSearch, x.onButton, x.spotOn, x.cardClear])));
  ok('going Back to a step outside the menu closes it (and that step shows the search again)', wentBack && wentBack.title === 'What comes back' && wentBack.menu === false && wentBack.search === true, JSON.stringify(wentBack));
  const typeStep = searchSteps[0] || {}, backStep = searchSteps[1] || {}, word = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings[0].title.split(/\s+/)[0]));
  ok('the step about what to type shows the field empty; the step about what comes back shows real results: a word from the first booking looked for, results listed with the word marked, and a count on the chips', typeStep.q === '' && typeStep.options === 0 && backStep.q === word && backStep.options > 0 && backStep.marks > 0 && /[1-9]/.test(backStep.counts) && backStep.text.includes(`looked for “${word}”`), JSON.stringify([word, typeStep.q, typeStep.options, backStep.q, backStep.options, backStep.marks, backStep.counts]));
  await page.screenshot({ path: S + '/menu-tutorial-360.png' });
  if (await page.locator('.tour-card .btn.primary').count()) await page.locator('.tour-card .btn.primary').click();
  await sleep(300);
  ok('Done closes the walkthrough, the menu and the search, and the page is usable', (await page.locator('.tour').count()) === 0 && closed(await menuState(page)) && (await page.evaluate(() => (document.getElementById('searchBack') || { hidden: false }).hidden && document.getElementById('searchBtn').getAttribute('aria-expanded') === 'false' && !document.body.classList.contains('search-open'))));
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2');
  for (let i = 0; i < 3; i++) { await sleep(700); await page.locator('.tour-card .btn.primary').click(); }
  await sleep(700);
  const onSearchStep = await page.evaluate(() => ({ shown: !(document.getElementById('searchBack') || { hidden: true }).hidden, field: (document.getElementById('searchInput') || { value: null }).value, focusInCard: !!document.activeElement.closest('.tour-card') }));
  await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape on the search step closes the walkthrough and the search together, and the page is usable', onSearchStep.shown && onSearchStep.field === '' && onSearchStep.focusInCard && (await page.locator('.tour').count()) === 0 && (await page.evaluate(() => (document.getElementById('searchBack') || { hidden: false }).hidden && !document.getElementById('app').inert)), JSON.stringify(onSearchStep));
  await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2');
  for (let i = 0; i < 6; i++) { await sleep(1100); await page.locator('.tour-card .btn.primary').click(); }
  await sleep(1100);
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
  ok('needs sign-in: a steady amber dot, and the name and the menu say to sign in again and where', needs.status === 'needs-permission' && needs.dot === 'amber' && needs.shown && needs.amber && needs.pulse === 'none' && needs.name === 'Menu. Google Drive needs you to sign in again' && needs.line === 'Google Drive needs you to sign in again' && /Storage, sync & backups.*Sign in again/.test(needs.text) && needs.row === 'Sign in', JSON.stringify(needs));
  const error = await setCloud('error');
  ok('error: a red dot, larger and marked with a ! so it is not told by colour alone, and the name and the menu say what went wrong', error.status === 'error' && error.dot === 'red' && error.shown && error.red && error.differ && /!/.test(error.mark) && error.size > needs.size && error.name === 'Menu. Could not sync with Google Drive' && error.line === 'Could not sync with Google Drive' && /Google Drive did not answer · Your changes are safe on this device/.test(error.text) && error.row === 'Sync error' && error.lineState === 'error', JSON.stringify(error));
  const paused = await setCloud('paused');
  ok('paused: an amber dot, and the name and the menu say sync is paused, with no price or Buy', paused.status === 'paused' && paused.dot === 'amber' && paused.shown && paused.amber && paused.name === 'Menu. Sync with Google Drive is paused' && /until this device has a licence/.test(paused.text) && !/\$|buy/i.test(paused.text) && paused.row === 'Paused', JSON.stringify(paused));
  const off = await setCloud('off');
  ok('local only again: no dot, plainly Menu', off.status === 'off' && well(off) && off.line === 'Kept on this device only' && off.row === 'Local', JSON.stringify(off));
  await setCloud('error'); await openMenu(page); await sleep(300);
  await page.screenshot({ path: S + '/menu-error-360.png' });
  ok('with the menu open the status is the first thing in it, readable in full', await page.evaluate(() => { const s = document.getElementById('menuStatus'), m = document.getElementById('menu').getBoundingClientRect(), r = s.getBoundingClientRect(); return r.left >= m.left && r.right <= m.right && s.scrollWidth <= s.clientWidth && r.top < document.getElementById('helpBtn').getBoundingClientRect().top; }));
  await page.keyboard.press('Escape');
  // While the storage needs the person, the status is a button to the storage sheet, like the rows under it.
  await setCloud('needs-permission'); await openMenu(page); await sleep(300);
  const act = await page.evaluate(() => { const s = document.getElementById('menuStatus'), cs = getComputedStyle(s), row = getComputedStyle(document.getElementById('helpBtn')), r = s.getBoundingClientRect(), m = document.getElementById('menu').getBoundingClientRect(); return { tag: s.tagName, type: s.type, likeRow: cs.borderTopWidth === row.borderTopWidth && cs.borderRadius === row.borderRadius && cs.backgroundColor === row.backgroundColor && cs.cursor === 'pointer', h: Math.round(r.height), inside: r.left >= m.left && r.right <= m.right && s.scrollWidth <= s.clientWidth, arrow: getComputedStyle(s, '::after').content, text: s.innerText, described: document.getElementById('menu').getAttribute('aria-describedby'), focus: document.activeElement.id }; });
  ok('while the storage needs you to sign in again, the status at the top of the menu is a button that looks like the rows, at least 60 px tall, with an arrow and its words in full', act.tag === 'BUTTON' && act.type === 'button' && act.likeRow && act.h >= 60 && act.inside && /›/.test(act.arrow) && /needs you to sign in again/.test(act.text) && /Tap here to open Storage, sync & backups/.test(act.text) && act.described === 'menuStatus' && act.focus === 'helpBtn', JSON.stringify(act));
  const viaKeys = [];
  for (const key of ['ArrowUp', 'ArrowUp', 'Tab', 'Tab']) { await page.keyboard.press(key); viaKeys.push(await focusId(page)); }
  ok('…and the keyboard reaches it, between the ✕ and the first row', viaKeys.join(' ') === 'menuStatus menuClose menuStatus helpBtn', viaKeys.join(' '));
  await page.locator('#menuStatus').click(); await page.waitForSelector('.sheet .storage', { timeout: 4000 }).catch(() => {});
  ok('tapping it closes the menu and opens Storage, sync & backups', !(await menuState(page)).open && (await page.locator('.sheet[aria-label="Storage, sync & backups"]').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and closing that sheet leaves the page usable, focus on the hamburger', closed(await menuState(page)) && (await focusId(page)) === 'menuBtn');
  await openMenu(page); await sleep(250); await page.locator('#menuStatus').focus();
  // A save going through while the menu is open: the status is a button, then plain words, and the rows stay where they are.
  const rowAt = () => page.evaluate(() => Math.round(document.getElementById('helpBtn').getBoundingClientRect().top));
  const during = await page.evaluate(async () => { const s = await import('./js/store.js'); s.cloud.adapter = { id: 'gdrive', label: 'Google Drive', ready: async () => true, read: async () => null, write: () => new Promise(r => { window.__letGo = r; }) }; s.sync(); await new Promise(r => setTimeout(r, 250)); return { tag: document.getElementById('menuStatus').tagName, state: document.getElementById('menuStatus').dataset.state, row: Math.round(document.getElementById('helpBtn').getBoundingClientRect().top) }; });
  await page.evaluate(() => window.__letGo()); await page.waitForFunction(() => document.getElementById('menuStatus').dataset.state === 'synced', null, { timeout: 5000 }).catch(() => {}); await sleep(100);
  const settled = await page.evaluate(() => ({ tag: document.getElementById('menuStatus').tagName, focus: document.activeElement.id, title: document.getElementById('menuStatusTitle').textContent, n: document.querySelectorAll('#menuStatus').length }));
  ok('when all is well again it is plain words once more, and the focus it had goes to the first row', during.tag === 'BUTTON' && during.state === 'saving' && settled.tag === 'DIV' && settled.n === 1 && settled.focus === 'helpBtn' && settled.title === 'Synced with Google Drive', JSON.stringify({ during, settled }));
  ok('…without the rows moving under a finger as it changes', (await rowAt()) === during.row, `${during.row} → ${await rowAt()}`);
  await page.keyboard.press('Escape'); await setCloud('off');

  /* --------------------------- the search control in the bar --------------------------- */
  const slot = await page.evaluate(() => { const t = document.querySelector('.top'), kids = [...t.children].map(c => c.className.split(' ')[0]), b = document.getElementById('searchBtn'), r = b.getBoundingClientRect(), m = document.getElementById('menuBtn').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect(), label = b.querySelector('.cloud-label').getBoundingClientRect(), key = b.querySelector('.search-key'); return { kids, inSlot: b.parentElement.id === 'topSearch', top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), menuTop: Math.round(m.top), menuLeft: Math.round(m.left), brandRight: Math.round(br.right), brandWhole: document.querySelector('.brand').scrollWidth <= document.querySelector('.brand').clientWidth && Math.round(document.getElementById('topSearch').getBoundingClientRect().width) <= 60, labelW: Math.round(label.width), keyShown: getComputedStyle(key).display !== 'none', name: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), expanded: b.getAttribute('aria-expanded'), icon: !!b.querySelector('svg[aria-hidden=true]') }; });
  const withSearch = await bar(page);
  ok('the search control sits between the brand and the buttons, on the same row as the hamburger: at 360 px a 44 px magnifier that takes no more room than that (the brand is not squeezed), and the bar stays slim with no sideways scroll', JSON.stringify(slot.kids) === JSON.stringify(['brand', 'top-search', 'top-actions']) && slot.inSlot && withSearch.height <= 64 && withSearch.fits && slot.top === slot.menuTop && slot.w >= 44 && slot.w <= 60 && slot.h >= 44 && slot.right <= slot.menuLeft && slot.brandRight <= slot.right - slot.w && slot.brandWhole && slot.labelW <= 1 && !slot.keyShown && slot.icon, JSON.stringify({ withSearch, slot }));
  ok('it is a button named Search everything that says it opens a dialog and is collapsed', slot.name === 'Search everything' && slot.popup === 'dialog' && slot.expanded === 'false', JSON.stringify(slot));
  await ctx.close();

  /* ------------------------------ with a PIN: the lock stays in the bar ------------------------------ */
  ({ ctx, page } = await open());
  await page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810')));
  await page.waitForFunction(() => !document.getElementById('lockBtn').hidden, null, { timeout: 60000 });
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.cloud.adapter = { id: 'gdrive', label: 'Google Drive', ready: async () => true, read: async () => { throw new Error('no'); }, write: async () => {} }; await s.sync(); });
  const b1 = await bar(page);
  ok('with a PIN the lock shows beside the hamburger, to its left, both 44 px; at 360 px the bar is still one slim row with no sideways scroll, with the search, the lock, the hamburger and its dot (the fullest it gets)', b1.buttons.map(b => b.id).join(',') === 'lockBtn,menuBtn' && b1.buttons.every(b => b.w >= 44 && b.h >= 44 && b.top === b1.buttons[0].top) && b1.buttons[0].right <= b1.buttons[1].left && b1.search.w >= 44 && b1.search.h >= 44 && b1.search.top === b1.buttons[0].top && b1.search.right <= b1.buttons[0].left && b1.search.left >= 0 && b1.height <= 64 && b1.fits && b1.drum === 128, JSON.stringify(b1));
  await page.screenshot({ path: S + '/bar-pin-360.png', clip: { x: 0, y: 0, width: 360, height: 200 } });
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

  /* ------------------ the menu's code arriving after something else has opened ------------------ */
  // The menu's file is fetched on the first tap. On a slow connection a form, or the lock, can be open by the time it
  // arrives: the menu then stays shut, as the search does, instead of opening underneath and taking the focus.
  ({ ctx, page } = await open({ options: { serviceWorkers: 'block' } }));
  await page.evaluate(() => window.logiGo('crew')); await page.waitForSelector('#page .page-head'); await sleep(300);
  await page.route('**/js/menu.js', async r => { await sleep(1500); await r.continue(); });
  await page.locator('#menuBtn').click(); // its code is on the way
  await page.getByRole('button', { name: '+ Add' }).first().click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="name"]').click(); await page.keyboard.type('Ada');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => /js\/menu\.js/.test(r.name)), null, { timeout: 8000 }).catch(() => {}); await sleep(400);
  await page.keyboard.type('m');
  const late = await page.evaluate(() => ({ arrived: performance.getEntriesByType('resource').some(r => /js\/menu\.js/.test(r.name)), menu: !document.getElementById('menuBack').hidden, bodyClass: document.body.classList.contains('menu-open'), expanded: document.getElementById('menuBtn').getAttribute('aria-expanded'), focus: document.activeElement.dataset.key || document.activeElement.id, value: document.querySelector('.sheet form input[data-key="name"]').value }));
  ok('a menu whose code arrives after a form has opened stays shut: the focus stays in the form’s field and typing carries on there', late.arrived && !late.menu && !late.bodyClass && late.expanded === 'false' && late.focus === 'name' && late.value === 'Adam', JSON.stringify(late));
  await page.keyboard.press('Escape'); await sleep(250);
  ok('…Escape closes the form, as usual, and the page is usable', (await page.locator('.sheet').count()) === 0 && closed(await menuState(page)));
  await page.unroute('**/js/menu.js');
  await page.locator('#menuBtn').click({ timeout: 4000 }).catch(() => {}); await page.locator('#menu').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  ok('…and the next tap on the hamburger opens the menu', (await menuState(page)).open);
  await ctx.close();

  /* ---------------------------------- installed: no Install ---------------------------------- */
  ({ ctx, page } = await open({ installed: true }));
  await openMenu(page); await sleep(250);
  const r1 = await rows(page);
  ok('once installed, Install is not listed', JSON.stringify(r1) === JSON.stringify(['Tutorial for this page', 'Text size and theme', 'Storage, sync & backups']) && (await page.locator('#installBtn').isHidden()), r1.join(' | '));
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

  /* ====================================== the search ====================================== */
  { // a block of its own: its names are its own
  // The sample data, plus one of everything the sample lacks: a quote, an invoice, a call sheet, a stripboard, a hired
  // person and a timecode log with a script, a name with accents, and two bookings that tell a title from a note.
  const seed = page => page.evaluate(async () => {
    const s = await import('./js/store.js');
    s.loadSample();
    const hb = s.db.bookings.find(b => b.title === 'Harbour Brewing brand film');
    s.update(d => {
      const b = d.bookings.find(x => x.id === hb.id);
      b.quote = { number: 'Q-0042', date: '2026-11-02', until: '2026-12-02', status: 'Sent', taxRate: 0, lines: [{ id: 'l1', desc: 'Filming day with gimbal operator', qty: 1, unit: 'day', price: 900 }], notes: 'Includes two rounds of changes.' };
      b.invoice = { number: 'INV-0007', date: '2026-11-21', due: '2026-12-05', status: 'Sent', taxRate: 0, lines: [{ id: 'l2', desc: 'Aerial footage licence', qty: 1, unit: 'each', price: 300 }], notes: 'Bank transfer preferred.', payments: [{ id: 'p1', date: '2026-11-22', amount: 100, method: 'Bank transfer', note: 'Deposit ref HB-77' }] };
      b.callSheet = { generalCall: '07:00', schedule: [{ id: 'r1', time: '07:15', item: 'Unload at the goods yard' }, { id: 'r2', time: '12:30', item: 'Lunch from Portside Deli' }], notes: 'Walkie channel 4. Quiet zone near the fermenters.', emergency: 'Site manager · +1 555 0188', editedAt: Date.now() };
      b.board = { list: [{ id: 's1', type: 'scene', scene: '12A', ie: 'INT', set: 'Fermentation hall', tod: 'MORNING', desc: 'Ana checks the gauges', cast: ['ANA'], eighths: 6 }, { id: 'day-1', type: 'break' }], cast: ['ANA'], updatedAt: Date.now() };
      b.hires = [{ id: 'h1', name: 'Quentin Abbot', role: 'Drone Pilot', phone: '+1 555 0166', rate: 500, rateUnit: 'day' }];
      b.editDays = [{ date: '2027-03-09' }];
      b.budget = { lines: [{ id: 'bl1', cat: 'Travel & transport', desc: 'Ferry tickets', qty: 2, unit: 'item', rate: 40, actual: '', supplier: 'Islander Ferries' }], updatedAt: Date.now() };
      b.extraChecks = [{ id: 'x:1', stage: 'Prepped', text: 'Collect the visitor lanyards' }];
      b.updatedAt = Date.now();
      d.priceList = { list: [{ id: 'pl1', key: '', desc: 'Underwater housing', unit: 'day', price: 150, cat: 'Equipment hire' }], region: '', updatedAt: Date.now() };
      d.billing = { ...d.billing, terms: 'Payment within 21 days, late fee after that.', accountName: 'Studio Nightjar Ltd', updatedAt: Date.now() };
      d.templates = { brand: { Prepped: ['Charge the batteries', 'Print the release forms'] }, updatedAt: Date.now() };
      d.shifts.push({ id: 'sh1', bookingId: b.id, date: b.date, start: Date.now() - 36e5, end: Date.now(), breaks: [], note: 'Overran because of the fog', updatedAt: Date.now() });
      d.projectTemplates = [{ id: 'pt1', name: 'Brewery promo', icon: '🍺', base: 'brand', deliverables: [{ name: 'Teaser 15 s', duration: '15 s', dueDays: 7 }], shots: 'Pour shot\nLabel close-up', schedule: [], notes: '' }];
    });
    s.upsert('logs', { id: 'log1', title: 'Brewery day one, A cam', rate: '25', mode: 'free', camera: 'Card 7', created: '2026-11-20', bookingId: hb.id, sync: null, take: 0, autoTakes: true,
      notes: [{ id: 'n1', frames: 100, text: 'Flare on the kettle, go again', at: '2026-11-20T08:00:00.000Z' }, { id: 'n2', frames: 900, text: 'Best take of the pour', at: '2026-11-20T08:10:00.000Z' }],
      script: { name: 'Brewery script', imported: '2026-11-01T10:00:00.000Z', paras: [{ id: 'sp1', text: 'INT. TAPROOM — MORNING', kind: 'heading' }, { id: 'sp2', text: 'Every batch starts before sunrise, says the brewmaster.', kind: 'para' }] } });
    s.upsert('crew', { id: 'zoe', name: 'Zoë Müller', role: 'Régisseuse', phone: '+44 20 7946 0958', email: 'zoe@example.com', link: '', notes: 'Speaks German and French.' });
    s.upsert('bookings', { id: 'rankA', title: 'Zephyr Airlines promo', client: 'Skyline Group', date: '2027-02-10', status: 'Enquiry', stakeholders: [], crew: [], gear: [], notes: '' });
    s.upsert('bookings', { id: 'rankB', title: 'School open day', client: 'Hill School', date: '2027-01-08', status: 'Enquiry', stakeholders: [], crew: [], gear: [], notes: 'Borrow the zephyr fan from the studio.' });
    s.upsert('bookings', { id: 'tagged', title: 'Launch <img src=x onerror="window.__xss=1"> party', client: '<b>Bold & Co</b>', date: '2027-04-01', status: 'Enquiry', stakeholders: [], crew: [], gear: [], notes: '' });
    const fx6 = s.db.gear.find(g => g.name === 'Sony FX6 body');
    s.upsert('gear', { ...fx6, log: [{ id: 'e1', date: '2026-10-01', kind: 'clean', note: 'Sensor cleaned at Lensworks', cost: 40 }] });
    await new Promise(r => setTimeout(r, 50));
    return { hb: hb.id, fx6: fx6.id };
  });
  // What the panel shows: each group with its results (title, second line, the lines saying where a word was found, and what is marked).
  // A group or a result that is not there reads as an empty one, and a tap on something missing is given up after a
  // few seconds: a check about it then fails, instead of the whole spec stopping there.
  const lenient = (arr, blank) => new Proxy(arr, { get: (t, k) => (typeof k === 'string' && /^\d+$/.test(k) && !(k in t) ? blank() : t[k]) });
  const noItem = () => ({ kind: '', title: '', meta: '', snips: [], marks: [] }), noGroup = () => ({ group: '', name: '', head: '', items: lenient([], noItem), more: '' });
  const grp = (res, group) => res.find(g => g.group === group) || noGroup();
  const tap = loc => loc.click({ timeout: 4000 }).catch(() => {});
  const found = async page => lenient((await page.evaluate(() => [...document.querySelectorAll('#searchList .sr-group')].map(g => ({ group: g.dataset.group, name: g.getAttribute('aria-label'), head: g.querySelector('.sr-head').textContent,
    items: [...g.querySelectorAll('.sr:not(.sr-more)')].map(o => ({ kind: o.dataset.kind, title: o.querySelector('.sr-title').textContent, meta: (o.querySelector('.sr-meta') || {}).textContent || '', snips: [...o.querySelectorAll('.sr-snip')].map(x => x.textContent), marks: [...o.querySelectorAll('mark')].map(m => m.textContent) })),
    more: (g.querySelector('.sr-more') || {}).textContent || '' })))).map(g => ({ ...g, items: lenient(g.items, noItem) })), noGroup);
  const titles = (res, group) => [...grp(res, group).items].map(i => i.title);
  const say = async (page, q) => { await page.locator('#searchInput').fill(q, { timeout: 4000 }).catch(() => {}); await sleep(350); return found(page); }; // typing is searched once it pauses (120 ms)
  // Puts away whatever a failed step may have left open, so the checks after it are about themselves.
  const tidy = page => page.evaluate(() => { window.logiSearch.close(); window.logiMenu.close(); document.querySelectorAll('.tour-card .tour-actions .btn.ghost.small').forEach(b => b.click()); document.querySelectorAll('.sheet .sheet-tools button:last-child').forEach(b => b.click()); document.getElementById('app').inert = false; });
  const sState = page => page.evaluate(() => { const b = document.getElementById('searchBtn'), back = document.getElementById('searchBack'); return { open: !!back && !back.hidden, expanded: b.getAttribute('aria-expanded'), inert: document.getElementById('app').inert, focus: document.activeElement && document.activeElement.id, bodyClass: document.body.classList.contains('search-open') }; });
  const sClosed = st => !st.open && st.expanded === 'false' && !st.inert && !st.bodyClass;
  const chipsNow = page => page.evaluate(() => [...document.querySelectorAll('#search .search-chips .chip')].map(c => ({ group: c.dataset.group, label: c.firstChild.textContent, n: c.lastChild.textContent, on: c.getAttribute('aria-pressed') === 'true', name: c.getAttribute('aria-label') })));
  const openIt = async page => { if (!(await page.locator('#search').isVisible().catch(() => false))) await tap(page.locator('#searchBtn')); await page.locator('#search').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); };
  // Searches, taps the result with that title in that group, and says where it landed.
  const pick = async (page, q, group, title) => {
    await openIt(page); await say(page, q);
    await tap(page.locator(`#searchList .sr-group[data-group="${group}"] .sr:not(.sr-more)`).filter({ has: page.locator('.sr-title', { hasText: title }) }).first());
    await sleep(700);
    return page.evaluate(() => { const f = document.querySelector('#page .found'), r = f ? f.getBoundingClientRect() : null; return { tab: window.logiPage(), search: !(document.getElementById('searchBack') || { hidden: true }).hidden, inert: document.getElementById('app').inert, found: f ? f.textContent : '', foundClass: f ? f.className : '', inView: !!r && r.top >= 0 && r.bottom <= innerHeight + 1, focusOnFound: !!f && document.activeElement === f, focusInPage: !!document.activeElement.closest('#page'), text: document.getElementById('page').innerText, sheets: [...document.querySelectorAll('.sheet')].map(x => x.getAttribute('aria-label')) }; });
  };

  ({ ctx, page } = await open());
  const ids = await seed(page);
  ok('the search’s code is not fetched until the search is first opened', !(await page.evaluate(() => performance.getEntriesByType('resource').some(r => /js\/search\.js/.test(r.name)))));
  await page.locator('#searchBtn').click(); await page.locator('#search').waitFor({ state: 'visible' }); await sleep(350);
  const dlg = await page.evaluate(() => { const p = document.getElementById('search'), i = document.getElementById('searchInput'), l = document.getElementById(i.getAttribute('aria-controls')), b = document.getElementById('searchBtn'), r = p.getBoundingClientRect(); return { role: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), label: p.getAttribute('aria-label'), controls: b.getAttribute('aria-controls'), expanded: b.getAttribute('aria-expanded'), inert: document.getElementById('app').inert, focus: document.activeElement.id, input: { type: i.type, role: i.getAttribute('role'), name: i.getAttribute('aria-label'), expanded: i.getAttribute('aria-expanded'), auto: i.getAttribute('aria-autocomplete'), value: i.value, font: parseFloat(getComputedStyle(i).fontSize) }, list: l && { role: l.getAttribute('role'), name: l.getAttribute('aria-label'), hidden: l.hidden }, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], z: Number(getComputedStyle(document.getElementById('searchBack')).zIndex), blank: document.querySelector('.search-blank').innerText, fits: document.documentElement.scrollWidth <= innerWidth && p.scrollWidth <= p.clientWidth }; });
  ok('tapping it opens a dialog labelled Search with the field focused and empty; the button says expanded and the page behind is out of reach', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.label === 'Search' && dlg.controls === 'search' && dlg.expanded === 'true' && dlg.inert && dlg.focus === 'searchInput' && dlg.input.value === '', JSON.stringify(dlg));
  ok('the field is a combobox that drives a list box of results, and is named for what it searches', dlg.input.role === 'combobox' && dlg.input.type === 'search' && dlg.input.auto === 'list' && dlg.input.expanded === 'false' && /Search everything/.test(dlg.input.name) && dlg.list && dlg.list.role === 'listbox' && dlg.list.name === 'Search results' && dlg.list.hidden, JSON.stringify(dlg));
  ok('at 360 px the panel fills the screen with nothing clipped sideways, the field’s text is at least 16 px (no zoom on an iPhone), and it sits under sheets (100), walkthroughs (150) and the lock (300)', JSON.stringify(dlg.box) === '[0,0,360,740]' && dlg.fits && dlg.input.font >= 16 && dlg.z < 100 && dlg.z > 90, JSON.stringify(dlg));
  ok('with nothing typed it says what can be searched, how words combine, and that nothing leaves the device or is saved', /Search everything in Vdex/.test(dlg.blank) && /serial number/.test(dlg.blank) && /every one of them/.test(dlg.blank) && /Nothing you type is sent anywhere, and nothing about it is saved/.test(dlg.blank), dlg.blank);
  const chips0 = await chipsNow(page);
  ok('the chips are All and then only the pages that have something: here every page with data, with no counts until something is typed', chips0.map(c => c.label).join(' · ') === 'All · Bookings · Call sheets · Stripboard · Money · Crew · Equipment · Venues · Insurance · TC Notes · Me · Settings' && chips0[0].on && chips0.every(c => c.n === '') && chips0.filter(c => c.on).length === 1, chips0.map(c => c.label + c.n).join(' · '));
  await page.screenshot({ path: S + '/search-empty-360.png' });

  // From here until told otherwise, nothing may be asked of the network and nothing may be written to storage.
  const requests = []; const onReq = r => requests.push(r.url()); page.on('request', onReq);
  const stored = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage).sort()]));
  const before = await stored();

  /* ----------------------------- it finds every kind of thing ----------------------------- */
  let res = await say(page, 'harbour');
  ok('“harbour” finds the booking by its title first, then a booking by its address, and the venue, the call sheet, the stripboard, the quote, the invoice and the log that belong to it', titles(res, 'bookings')[0] === 'Harbour Brewing brand film' && titles(res, 'bookings').includes('Festival highlights') && titles(res, 'venues')[0] === 'Harbour Brewing Co. taproom' && titles(res, 'callsheets')[0] === 'Harbour Brewing brand film' && titles(res, 'strips')[0] === 'Harbour Brewing brand film' && titles(res, 'money').slice().sort().join() === 'Invoice INV-0007,Quote Q-0042' && titles(res, 'tcnotes')[0] === 'Brewery day one, A cam', JSON.stringify(res.map(g => [g.group, g.items.map(i => i.title)])));
  ok('results are in groups named for their page, each with its count, and the page with the best match comes first', res[0].group === 'bookings' && res.every(g => g.name === `${{ bookings: 'Bookings', venues: 'Venues', callsheets: 'Call sheets', strips: 'Stripboard', money: 'Money', tcnotes: 'TC Notes' }[g.group]}, ${g.items.length} result${g.items.length === 1 ? '' : 's'}` && g.head.endsWith(String(g.items.length))), JSON.stringify(res.map(g => [g.name, g.head])));
  const hbItem = res[0].items[0], fest = res[0].items.find(i => i.title === 'Festival highlights');
  ok('the words typed are marked where they were found, and a match that is not in the two lines gets a line of its own saying where', hbItem.marks.join('|') === 'Harbour|Harbour' && /Harbour Brewing Co\./.test(hbItem.meta) && /Prepped/.test(hbItem.meta) && hbItem.snips.length === 0 && fest.snips.join() === 'Address: Harbour Green' && fest.marks.join() === 'Harbour', JSON.stringify([hbItem, fest]));
  const listed = await page.evaluate(() => { const list = document.getElementById('searchList'), i = document.getElementById('searchInput'); const opts = [...list.querySelectorAll('[role=option]')]; return { expanded: i.getAttribute('aria-expanded'), n: opts.length, grouped: opts.every(o => o.parentElement.getAttribute('role') === 'group' && o.parentElement.parentElement === list), ids: new Set(opts.map(o => o.id)).size === opts.length, selected: opts.filter(o => o.getAttribute('aria-selected') === 'true').length, tall: opts.every(o => o.getBoundingClientRect().height >= 44), inside: opts.every(o => { const r = o.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), status: document.getElementById('searchStatus').textContent, described: i.getAttribute('aria-describedby'), fits: document.documentElement.scrollWidth <= innerWidth && list.scrollWidth <= list.clientWidth }; });
  ok('each result is an option of the list box, inside its group, at least 44 px tall and inside the screen; a line says how many were found', listed.expanded === 'true' && listed.n === 8 && listed.grouped && listed.ids && listed.selected === 0 && listed.tall && listed.inside && listed.fits && listed.status === '8 results on 6 pages' && listed.described === 'searchStatus', JSON.stringify(listed));
  const names = await page.evaluate(() => [...document.querySelectorAll('#searchList [role=option]')].slice(0, 2).map(o => o.getAttribute('aria-label')));
  ok('each result is named line by line for a screen reader: its name, its second line, then where the word was found', /^Harbour Brewing brand film\. .*Harbour Brewing Co\. · Prepped$/.test(names[0]) && /^Festival highlights\. .*Delivered\. Address: Harbour Green$/.test(names[1]), JSON.stringify(names));
  await sleep(500);
  ok('the count is announced for screen readers once typing has paused, page by page', (await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent)) === '8 results: Bookings 2, Call sheets 1, Stripboard 1, Money 2, Venues 1, TC Notes 1', await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent));
  await page.screenshot({ path: S + '/search-results-360.png' });

  res = await say(page, 'rivera');
  ok('a crew member is found by name, with the role, phone and email on the second line', titles(res, 'crew').join() === 'Sam Rivera' && grp(res, 'crew').items[0].meta === 'Sound Recordist · +1 555 0101 · sam@example.com' && grp(res, 'crew').items[0].kind === 'crew', JSON.stringify(res));
  ok('…and so are the bookings that person is on, below, saying they are crew there', res[0].group === 'crew' && titles(res, 'bookings').includes('Harbour Brewing brand film') && grp(res, 'bookings').items.every(i => /^Crew: Sam Rivera/.test(i.snips[0])), JSON.stringify(res.map(g => [g.group, g.items.map(i => [i.title, i.snips])])));
  res = await say(page, 'focus puller');
  ok('a crew member is found by another name for their role, as in the Crew page’s own search box: “focus puller” finds the 1st AC, with a line saying where', titles(res, 'crew').join() === 'Jo Chen' && grp(res, 'crew').items[0].snips.join() === 'Also called: Focus Puller, First Assistant Camera, First AC', JSON.stringify(res));
  res = await say(page, 'cinematographer');
  ok('…and nobody is found by a name that belongs to someone else’s role', res.length === 0, JSON.stringify(res));
  res = await say(page, 'lighting');
  ok('…and by the group their role is filed under: “lighting” finds the Gaffer', titles(res, 'crew').join() === 'Mika Dahl' && grp(res, 'crew').items[0].snips.join() === 'Group: Lighting', JSON.stringify(res.map(g => [g.group, g.items.map(i => [i.title, i.snips])])));
  res = await say(page, 'FX6-120934');
  const fx = (res.find(g => g.group === 'gear') || { items: [] }).items[0] || {};
  ok('a serial number finds the item, with the number marked', res.length === 1 && fx.title === 'Sony FX6 body' && fx.kind === 'gear' && /S\/N FX6-120934/.test(fx.meta) && fx.marks.join() === 'FX6-120934', JSON.stringify(res));
  res = await say(page, '120934');
  ok('…and so does part of it', titles(res, 'gear').join() === 'Sony FX6 body' && res[0].items[0].marks.join() === '120934', JSON.stringify(res));
  res = await say(page, 'audio bag');
  ok('equipment is found by where it is', titles(res, 'gear').sort().join() === 'Sennheiser MKH 416,Sound Devices MixPre-6 II', JSON.stringify(res));
  res = await say(page, 'lensworks');
  ok('…and by a note in its service log', titles(res, 'gear').join() === 'Sony FX6 body' && /^Service log: Sensor cleaned at Lensworks/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'interview set');
  ok('a kit is found by its name, under Equipment', res[0].group === 'gear' && res[0].items[0].title === 'Interview set' && res[0].items[0].kind === 'kit', JSON.stringify(res.map(g => [g.group, g.items.map(i => i.title)])));
  res = await say(page, 'goods lift');
  ok('a venue is found by its rules', titles(res, 'venues').join() === 'Northline Legal, level 9' && /^Rules: Book the goods lift 48 hours ahead/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'mill lane');
  ok('…and by its access notes', titles(res, 'venues').join() === 'Northline Legal, level 9' && /^Access: Service entrance on Mill Lane/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'EQ-448120');
  ok('an insurance policy is found by its number', res.length === 1 && res[0].group === 'insurance' && res[0].items[0].title === 'Equipment' && /ProShield Mutual · #EQ-448120/.test(res[0].items[0].meta) && res[0].items[0].kind === 'policy', JSON.stringify(res));
  res = await say(page, 'INV-0007');
  ok('an invoice is found by its number, under Money', res.length === 1 && res[0].group === 'money' && res[0].items.length === 1 && res[0].items[0].title === 'Invoice INV-0007' && res[0].items[0].kind === 'invoice' && /Harbour Brewing brand film · Harbour Brewing Co\. · Sent/.test(res[0].items[0].meta) && res[0].items[0].marks.join() === 'INV-0007', JSON.stringify(res));
  res = await say(page, 'q-0042');
  ok('…a quote by its number, in any case', res.length === 1 && titles(res, 'money').join() === 'Quote Q-0042' && res[0].items[0].kind === 'quote', JSON.stringify(res));
  res = await say(page, 'gimbal');
  ok('…and either by what is on a line', titles(res, 'money').join() === 'Quote Q-0042' && res[0].items[0].snips.join() === 'Line: Filming day with gimbal operator', JSON.stringify(res));
  res = await say(page, 'walkie');
  ok('a call sheet is found by its instructions', res.length === 1 && res[0].group === 'callsheets' && res[0].items[0].title === 'Harbour Brewing brand film' && /^Call sheet · /.test(res[0].items[0].meta) && /^Instructions: Walkie channel 4/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'goods yard');
  ok('…and by a row of its schedule', res.length === 1 && res[0].group === 'callsheets' && res[0].items[0].snips.join() === 'Schedule: 07:15 Unload at the goods yard', JSON.stringify(res));
  res = await say(page, 'fermentation');
  ok('a stripboard is found by a scene', res.length === 1 && res[0].group === 'strips' && /^Scene: Scene 12A · INT Fermentation hall/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'kettle');
  ok('a timecode log is found by a note', res.length === 1 && res[0].group === 'tcnotes' && res[0].items[0].title === 'Brewery day one, A cam' && res[0].items[0].snips.join() === 'Note: Flare on the kettle, go again', JSON.stringify(res));
  res = await say(page, 'brewmaster');
  ok('…and by a line of its script', res.length === 1 && res[0].group === 'tcnotes' && /^Script: Every batch starts before sunrise/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'mash tun');
  ok('a booking is found by its shot list', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && /^Shot: Wide: steam over the mash tun/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'quentin');
  ok('…by someone hired for it', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && /^Hired: Quentin Abbot · Drone Pilot/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'easyrig');
  ok('…by kit rented for it', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && /^Rented: Easyrig Vario 5 · Dock Rentals/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'AL-88213');
  ok('…by a licence number', titles(res, 'bookings').join() === 'Product shots' && /^Licence: Music · Slow Pour — Artlist · AL-88213/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'social cut');
  ok('…by a deliverable', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && /^Deliverable: Social cut 9:16, 30 s/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'dee okafor');
  ok('…by a contact (and the venue with the same contact is found too)', titles(res, 'bookings').join() === 'Corporate interviews' && /^Contact: Dee Okafor · Comms/.test(grp(res, 'bookings').items[0].snips[0]) && titles(res, 'venues').join() === 'Northline Legal, level 9', JSON.stringify(res));
  res = await say(page, '2027-03-09');
  ok('…by an edit day', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && /^Edit day: /.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'delivered');
  ok('…by its stage', titles(res, 'bookings').slice().sort().join() === 'Corporate headshots,Festival highlights,Real-estate walkthrough' && res[0].items.every(i => i.marks.join() === 'Delivered'), JSON.stringify(res));
  res = await say(page, 'wedding');
  ok('…and by its type of job', titles(res, 'bookings')[0] === 'Wedding weekend', JSON.stringify(res));
  res = await say(page, 'your studio');
  ok('your own details are found under Me', res.length === 1 && res[0].group === 'me' && res[0].items[0].title === 'Your details' && /Your Studio/.test(res[0].items[0].meta), JSON.stringify(res));
  res = await say(page, 'teaser');
  ok('a project template of your own is found under Settings', res.length === 1 && res[0].group === 'settings' && res[0].items[0].title === 'Brewery promo' && res[0].items[0].meta === 'Project template' && /^Deliverable: Teaser 15 s/.test(res[0].items[0].snips[0]), JSON.stringify(res));
  res = await say(page, 'underwater');
  ok('…and so is a line of your price list', res.length === 1 && res[0].group === 'settings' && res[0].items[0].title === 'Price list' && res[0].items[0].snips.join() === 'Equipment hire: Underwater housing', JSON.stringify(res));
  res = await say(page, 'nightjar');
  ok('…your payment details for invoices', res.length === 1 && res[0].group === 'settings' && res[0].items[0].title === 'Quotes & invoices' && res[0].items[0].snips.join() === 'Account name: Studio Nightjar Ltd', JSON.stringify(res));
  res = await say(page, 'release forms');
  ok('…and a checklist line of your own', res.length === 1 && res[0].group === 'settings' && res[0].items[0].title === 'Workflow templates' && res[0].items[0].snips.join() === 'Prepped: Print the release forms', JSON.stringify(res));
  res = await say(page, 'ferry');
  ok('a booking is also found by a line of its budget', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && res[0].items[0].snips.join() === 'Budget: Ferry tickets · Travel & transport · Islander Ferries', JSON.stringify(res));
  res = await say(page, 'lanyards fog');
  ok('…by a checklist line added to it and a note on its hours', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && res[0].items[0].snips.join(' | ') === 'Checklist: Collect the visitor lanyards | Hours: Overran because of the fog', JSON.stringify(res));
  res = await say(page, 'generators');
  ok('a venue is found by one of its equipment rules', titles(res, 'venues').slice().sort().join() === 'Harbour Brewing Co. taproom,Northline Legal, level 9' && res[0].items.every(i => i.snips.join() === 'Equipment rules: Generators: not allowed'), JSON.stringify(res));
  res = await say(page, '5550101');
  ok('a phone number typed without its spaces finds the person, with the number marked', titles(res, 'crew').join() === 'Sam Rivera' && res[0].items[0].marks.join() === '555 0101', JSON.stringify(res));

  /* ------------------------- several words, accents, capitals, ranking ------------------------- */
  res = await say(page, 'film harbour');
  ok('several words are matched in any order', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && res[0].items[0].marks.join('|') === 'Harbour|film|Harbour', JSON.stringify(res));
  res = await say(page, 'steam northline');
  const none1 = await page.evaluate(() => ({ list: document.getElementById('searchList').hidden, blank: document.querySelector('.search-blank').innerText, expanded: document.getElementById('searchInput').getAttribute('aria-expanded') }));
  ok('…and all of them must be in the same thing: a word from one booking and a word from another find nothing', res.length === 0 && none1.list && /Nothing found for “steam northline”/.test(none1.blank), JSON.stringify(none1));
  res = await say(page, 'tracking prepped ruiz');
  ok('…though they may be in different parts of it (a shot, the stage and a contact)', titles(res, 'bookings').join() === 'Harbour Brewing brand film' && res[0].items[0].snips.length === 2, JSON.stringify(res));
  res = await say(page, 'location recce - elm hall,');
  ok('punctuation around a word is not part of it: a hyphen typed for a dash, or a comma after a word, still finds it', titles(res, 'bookings').join() === 'Location recce — Elm Hall', JSON.stringify(res.map(g => [g.group, g.items.map(i => i.title)])));
  res = await say(page, 'zoe muller');
  ok('accents do not matter: “zoe muller” finds Zoë Müller, with her name marked as it is written', titles(res, 'crew').join() === 'Zoë Müller' && res[0].items[0].marks.join('|') === 'Zoë|Müller|zoe', JSON.stringify(res)); // the third is her email address
  res = await say(page, 'REGISSEUSE');
  ok('…nor capitals: “REGISSEUSE” finds the Régisseuse', titles(res, 'crew').join() === 'Zoë Müller' && res[0].items[0].marks.join() === 'Régisseuse', JSON.stringify(res));
  res = await say(page, 'hárbour bréwing');
  ok('…and accents typed where none are stored find it as well', titles(res, 'bookings')[0] === 'Harbour Brewing brand film', JSON.stringify(res.map(g => [g.group, g.items.map(i => i.title)])));
  res = await say(page, 'zephyr');
  ok('a match in a title comes before a match in notes, even when the other booking is sooner', titles(res, 'bookings').join(' > ') === 'Zephyr Airlines promo > School open day' && /^Notes: Borrow the zephyr fan/.test(res[0].items[1].snips[0]), JSON.stringify(res));
  res = await say(page, 'northline');
  ok('…and a match that starts a name before one inside a client’s name: the venue’s group leads, the bookings follow', res[0].group === 'venues' && titles(res, 'bookings').slice().sort().join() === 'Corporate headshots,Corporate interviews', JSON.stringify(res.map(g => [g.group, g.items.map(i => i.title)])));
  res = await say(page, 'launch party');
  const tagged = await page.evaluate(() => ({ imgs: document.querySelectorAll('#search img, #search b').length, xss: window.__xss || 0, title: document.querySelector('#searchList .sr-title').textContent }));
  ok('what is stored is shown as text, never read as HTML: a title with a tag in it stays a title', tagged.imgs === 0 && tagged.xss === 0 && tagged.title === 'Launch <img src=x onerror="window.__xss=1"> party' && res[0].items[0].meta.includes('<b>Bold & Co</b>'), JSON.stringify(tagged));

  /* ------------------------------------ the chips ------------------------------------ */
  await say(page, 'harbour');
  const chips1 = await chipsNow(page);
  ok('once something is typed each chip shows how many it has, and says so by name', chips1.map(c => `${c.label} ${c.n}`).join(' · ') === 'All 8 · Bookings 2 · Call sheets 1 · Stripboard 1 · Money 2 · Crew 0 · Equipment 0 · Venues 1 · Insurance 0 · TC Notes 1 · Me 0 · Settings 0' && chips1[1].name === 'Bookings, 2 results' && chips1[2].name === 'Call sheets, 1 result' && chips1[0].on, chips1.map(c => `${c.label} ${c.n}`).join(' · '));
  const chipBox = await page.evaluate(() => { const row = document.querySelector('#search .search-chips'), cs = [...row.querySelectorAll('.chip')]; return { tall: cs.every(c => c.getBoundingClientRect().height >= 44), scrolls: row.scrollWidth > row.clientWidth, pageFits: document.documentElement.scrollWidth <= innerWidth, role: row.getAttribute('role'), name: row.getAttribute('aria-label') }; });
  ok('the chips are a named group of 44 px buttons on one row that scrolls sideways by itself, not the page', chipBox.tall && chipBox.scrolls && chipBox.pageFits && chipBox.role === 'group' && chipBox.name === 'Show results from', JSON.stringify(chipBox));
  await tap(page.locator('#search .chip[data-group="money"]')); await sleep(150);
  res = await found(page);
  const chips2 = await chipsNow(page);
  ok('a chip keeps the results to its page: Money shows the quote and the invoice and nothing else, and is the one pressed', res.length === 1 && res[0].group === 'money' && titles(res, 'money').slice().sort().join() === 'Invoice INV-0007,Quote Q-0042' && chips2.filter(c => c.on).map(c => c.label).join() === 'Money' && (await page.locator('#searchStatus').innerText()) === '2 results in Money', JSON.stringify([res.map(g => g.group), chips2.filter(c => c.on)]));
  res = await say(page, 'elm hall');
  ok('the chip stays while the words change; with nothing on its page it says so and offers the results on the others', res.length === 0 && /Nothing in Money for “elm hall”/.test(await page.locator('.search-blank').innerText()) && /2 results on other pages/.test(await page.locator('.search-blank').innerText()) && (await page.locator('.search-blank').getByRole('button', { name: 'Show all 2 results' }).count()) === 1, await page.locator('.search-blank').innerText());
  await tap(page.locator('.search-blank').getByRole('button', { name: 'Show all 2 results' })); await sleep(150);
  res = await found(page);
  ok('…and that button goes back to All, and the focus goes to the All chip (the button itself is gone)', titles(res, 'bookings').slice().sort().join() === 'Location recce — Elm Hall,Wedding weekend' && (await chipsNow(page))[0].on && (await page.evaluate(() => document.activeElement.classList.contains('chip') && document.activeElement.dataset.group === '')), JSON.stringify(res));
  await page.locator('#searchInput').focus();
  await say(page, 'e');
  res = await found(page);
  const many = grp(res, 'bookings');
  ok('with every page shown, a page with many matches lists its best five and offers the rest', many.items.length === 5 && /^Show all \d+ in Bookings$/.test(many.more) && Number(many.head.replace(/\D/g, '')) > 5, JSON.stringify([many.head, many.more]));
  await tap(page.locator('#searchList .sr-group[data-group="bookings"] .sr-more')); await sleep(150);
  res = await found(page);
  ok('…and tapping that chooses the page’s chip and lists them all', res.length === 1 && res[0].items.length === Number(many.head.replace(/\D/g, '')) && (await chipsNow(page)).filter(c => c.on).map(c => c.label).join() === 'Bookings', JSON.stringify([res.length, res[0] && res[0].items.length]));
  await tap(page.locator('#search .chip[data-group=""]')); await sleep(150);

  /* -------------------------------- nothing found -------------------------------- */
  res = await say(page, 'xqzsearchprobe');
  const none2 = await page.evaluate(() => ({ list: document.getElementById('searchList').hidden, options: document.querySelectorAll('#searchList [role=option]').length, blank: document.querySelector('.search-blank').innerText, expanded: document.getElementById('searchInput').getAttribute('aria-expanded'), chips: [...document.querySelectorAll('#search .chip-n')].map(c => c.textContent).join('') }));
  await sleep(600);
  ok('when nothing is found it says so, with what was typed and what to try, the list box is closed and every chip shows 0', res.length === 0 && none2.list && none2.options === 0 && none2.expanded === 'false' && /Nothing found for “xqzsearchprobe”/.test(none2.blank) && /fewer words/.test(none2.blank) && /^0+$/.test(none2.chips), JSON.stringify(none2));
  ok('…and that is announced too', (await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent)) === 'Nothing found for “xqzsearchprobe”');
  await page.screenshot({ path: S + '/search-none-360.png' });

  /* ----------------------- nothing leaves the device, nothing is kept ----------------------- */
  await page.keyboard.press('Escape'); await sleep(200);
  page.off('request', onReq);
  const after = await stored();
  ok('all of that searching asked nothing of the network', requests.length === 0, requests.join(' | '));
  ok('…and wrote nothing to the device’s storage: no history, no last search', after === before && !/xqzsearchprobe|harbour/i.test(after.replace(/Harbour (Brewing|Green)/g, '')), after === before ? '' : 'storage changed');
  const reopened = await (async () => { await openIt(page); await sleep(200); return page.evaluate(() => { const i = document.getElementById('searchInput'); return { value: i.value, selected: i.selectionStart === 0 && i.selectionEnd === i.value.length, focus: document.activeElement.id }; }); })();
  ok('opened again in the same sitting, what was typed is still in the field, selected so that typing replaces it', reopened.value === 'xqzsearchprobe' && reopened.selected && reopened.focus === 'searchInput', JSON.stringify(reopened));

  /* ------------------------------ it keeps up with the data ------------------------------ */
  res = await say(page, 'ottoline');
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('crew', { id: 'otto', name: 'Ottoline Byrne', role: 'Colourist', phone: '', email: '', link: '', notes: '' }))); await sleep(600);
  const fresh1 = await found(page);
  ok('something added while the search is open is found without typing again', res.length === 0 && titles(fresh1, 'crew').join() === 'Ottoline Byrne', JSON.stringify(fresh1));
  await page.evaluate(() => import('./js/store.js').then(s => s.remove('crew', 'otto'))); await sleep(600);
  ok('…and something removed is no longer listed', (await found(page)).length === 0);

  /* --------------------------------- the keyboard --------------------------------- */
  const active = page => page.evaluate(() => { const i = document.getElementById('searchInput'), id = i.getAttribute('aria-activedescendant'), o = id && document.getElementById(id); return { id: id || '', title: o ? (o.querySelector('.sr-title') || o).textContent : '', selected: document.querySelectorAll('#searchList [aria-selected=true]').length, focus: document.activeElement.id, ring: o ? getComputedStyle(o).outlineStyle !== 'none' && parseFloat(getComputedStyle(o).outlineWidth) >= 2 && /inset/.test(getComputedStyle(o).boxShadow) : false, inView: o ? (() => { const r = o.getBoundingClientRect(), l = document.getElementById('searchList').getBoundingClientRect(); return r.top >= l.top - 1 && r.bottom <= l.bottom + 1; })() : null }; });
  await say(page, 'harbour');
  const k0 = await active(page);
  await page.keyboard.press('ArrowDown'); const k1 = await active(page);
  await page.keyboard.press('ArrowDown'); const k2 = await active(page);
  await page.keyboard.press('ArrowUp'); const k3 = await active(page);
  await page.keyboard.press('ArrowUp'); const k4 = await active(page);
  ok('the arrow keys move a marked result down and up the list while the focus stays in the field; the marked one has a visible ring and a bar down its side', k0.id === '' && k1.title === 'Harbour Brewing brand film' && k1.selected === 1 && k1.ring && k1.inView && k2.title === 'Festival highlights' && k2.selected === 1 && k3.title === 'Harbour Brewing brand film' && k4.id === '' && k4.selected === 0 && [k0, k1, k2, k3, k4].every(k => k.focus === 'searchInput'), JSON.stringify([k0, k1, k2, k3, k4]));
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
  const kEnd = await active(page);
  ok('…stopping at the last one, which is scrolled into view', kEnd.title === 'Brewery day one, A cam' && kEnd.inView && kEnd.selected === 1, JSON.stringify(kEnd));
  for (const key of ['ArrowLeft', 'ArrowRight']) await page.keyboard.press(key);
  await page.locator('#search .chip[data-group="venues"]').focus();
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) await page.keyboard.press(key);
  ok('the arrow keys stay in the search: the Rolodex behind it does not turn', (await page.evaluate(() => window.logiPage())) === 'bookings');
  const tabs = [];
  await page.locator('#searchInput').focus();
  for (let i = 0; i < 16; i++) { await page.keyboard.press(i < 14 ? 'Tab' : 'Shift+Tab'); tabs.push(await page.evaluate(() => (document.activeElement.closest('#search') ? document.activeElement.id || document.activeElement.dataset.group || 'all' : 'OUTSIDE'))); }
  ok('Tab and Shift+Tab go round inside the panel: the field, ✕ and the chips', !tabs.includes('OUTSIDE') && tabs[0] === 'searchClose' && tabs[1] === 'all' && tabs[13] === 'searchInput' && tabs[14] === 'settings', tabs.join(' '));
  await page.locator('#searchInput').focus();
  await say(page, 'rivera');
  await page.keyboard.press('Enter'); const e1 = await active(page), e1s = await sState(page);
  ok('on a keyboard, Enter with no result marked marks the first one', e1.title === 'Sam Rivera' && e1s.open, JSON.stringify(e1));
  await page.keyboard.press('Enter'); await sleep(700);
  const e2 = await page.evaluate(() => { const f = document.querySelector('#page .found'); return { tab: window.logiPage(), found: f ? f.querySelector('strong').textContent : '', focus: !!f && document.activeElement === f }; });
  ok('Enter on a marked result closes the search and opens it: the crew member’s card, on the Crew page', sClosed(await sState(page)) && e2.tab === 'crew' && e2.found === 'Sam Rivera' && e2.focus, JSON.stringify(e2));
  await sleep(300);
  ok('…which is announced', /Sam Rivera opened/.test(await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent)), await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent));
  // "/" opens it when nothing is being typed; in a field it is just a "/".
  await page.locator('#page .search').click(); await page.keyboard.type('a/b');
  const typed = await page.evaluate(() => ({ value: document.querySelector('#page .search').value, open: !document.getElementById('searchBack').hidden }));
  ok('“/” typed in a field on the page is just typed: the search does not open', typed.value === 'a/b' && !typed.open, JSON.stringify(typed));
  await page.keyboard.press('Control+k'); await sleep(200);
  const viaK = await sState(page);
  ok('Ctrl+K opens the search from anywhere, even from a field', viaK.open && viaK.focus === 'searchInput', JSON.stringify(viaK));
  await page.keyboard.press('Escape'); await sleep(150);
  const esc = await sState(page);
  const backIn = await page.evaluate(() => { const a = document.activeElement; return { inField: a.matches('#page .search'), value: a.value }; });
  ok('Escape closes it, the page is usable again and the focus is back in the field it was opened from, with what was typed there', sClosed(esc) && backIn.inField && backIn.value === 'a/b', JSON.stringify([esc, backIn]));
  await page.locator('#page .search').fill(''); await page.locator('#page .search').dispatchEvent('input'); await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('/'); await sleep(200);
  const viaSlash = await sState(page);
  ok('“/” opens it when nothing is being typed, and the “/” does not land in the field', viaSlash.open && viaSlash.focus === 'searchInput' && !/\//.test(await page.locator('#searchInput').inputValue()), JSON.stringify(viaSlash));
  await tap(page.locator('#searchClose'));
  ok('the ✕ closes it too, a 44 px target', sClosed(await sState(page)) && (await page.evaluate(() => { document.getElementById('searchBack').hidden = false; const r = document.getElementById('searchClose').getBoundingClientRect(); document.getElementById('searchBack').hidden = true; return r.width >= 44 && r.height >= 44; })));

  /* ------------------------- a result opens the thing where it lives ------------------------- */
  await tidy(page); await page.evaluate(() => window.logiGo('field')); await sleep(300); // from a page that has nothing to do with any of them
  let at = await pick(page, 'harbour brewing', 'bookings', 'Harbour Brewing brand film');
  ok('a booking opens as the booking’s own page, with the search closed and the page usable', at.tab === 'bookings' && !at.search && !at.inert && (await page.locator('.bk-detail .hero h2').innerText()) === 'Harbour Brewing brand film' && at.focusInPage, JSON.stringify({ ...at, text: '' }));
  at = await pick(page, 'AL-88213', 'bookings', 'Product shots');
  const lic = await page.evaluate(() => { const el = document.getElementById('bk-licences'), r = el.getBoundingClientRect(); return { found: el.classList.contains('found'), inView: r.top >= 0 && r.top < innerHeight, title: document.querySelector('.bk-detail .hero h2').textContent }; });
  ok('a booking found by a licence opens on its licences', lic.title === 'Product shots' && lic.found && lic.inView, JSON.stringify(lic));
  at = await pick(page, 'ferry', 'bookings', 'Harbour Brewing brand film');
  const bud = await page.evaluate(() => { const el = document.getElementById('bk-budget'), r = el ? el.getBoundingClientRect() : null, fold = document.getElementById('bk-work'); return { found: !!el && el.classList.contains('found'), open: !!fold && fold.open, inView: !!r && r.height > 0 && r.top >= 0 && r.top < innerHeight, text: el ? el.textContent : '' }; });
  ok('a booking found by its budget opens with the fold-down the budget is in opened, on the budget', bud.found && bud.open && bud.inView && /Ferry tickets/.test(bud.text), JSON.stringify({ ...bud, text: bud.text.slice(0, 60) }));
  at = await pick(page, 'q-0042', 'money', 'Quote Q-0042');
  const quoteTab = await page.locator('.money-page [role=tab][aria-selected=true], .money-page .seg .on').first().innerText().catch(() => '');
  ok('a quote opens as that booking’s quote', at.tab === 'bookings' && (await page.locator('.money-page').count()) === 1 && /Q-0042/.test(at.text) && /Harbour Brewing brand film/.test(at.text) && /quote/i.test(quoteTab) && !at.search && !at.inert, quoteTab);
  at = await pick(page, 'inv-0007', 'money', 'Invoice INV-0007');
  const invTab = await page.locator('.money-page [role=tab][aria-selected=true], .money-page .seg .on').first().innerText().catch(() => '');
  ok('…and an invoice as its invoice', at.tab === 'bookings' && (await page.locator('.money-page').count()) === 1 && /INV-0007/.test(at.text) && /invoice/i.test(invTab) && !/quote/i.test(invTab), invTab);
  at = await pick(page, 'walkie', 'callsheets', 'Harbour Brewing brand film');
  ok('a call sheet opens as that booking’s call sheet', at.tab === 'bookings' && (await page.locator('.cs-page:not(.money-page)').count()) === 1 && /Walkie channel 4/.test(at.text) && /Unload at the goods yard/.test(at.text), at.text.slice(0, 200));
  at = await pick(page, 'fermentation', 'strips', 'Harbour Brewing brand film');
  await page.waitForSelector('.sb-page .sb-strip'); await sleep(400);
  const strip = await page.evaluate(() => { const f = document.querySelector('.sb-page .found'); return { found: f ? f.textContent : '', cls: f ? f.className : '' }; });
  ok('a stripboard opens as that booking’s board, on the scene that was found', at.tab === 'bookings' && /sb-strip/.test(strip.cls) && /Fermentation hall/i.test(strip.found), JSON.stringify(strip));
  at = await pick(page, 'zoe', 'crew', 'Zoë Müller');
  await page.screenshot({ path: S + '/search-opened-360.png' });
  ok('a crew member opens on the Crew page: their card, in view, outlined and focused', at.tab === 'crew' && /crew-card/.test(at.foundClass) && /Zoë Müller/.test(at.found) && at.inView && at.focusOnFound && !at.inert, JSON.stringify({ ...at, text: '' }));
  await page.locator('#page .search').fill('priya'); await page.locator('#page .search').dispatchEvent('input'); await sleep(150);
  const hiddenFirst = await page.locator('.crew-card', { hasText: 'Jo Chen' }).count();
  at = await pick(page, 'jo chen', 'crew', 'Jo Chen');
  ok('…also from the Crew page itself with its own filter hiding them: the filter is cleared', hiddenFirst === 0 && at.tab === 'crew' && /Jo Chen/.test(at.found) && at.inView && (await page.locator('.crew-card').count()) === 5 && (await page.locator('#page .search').inputValue()) === '', JSON.stringify({ hiddenFirst, found: at.found }));
  at = await pick(page, 'FX6-120934', 'gear', 'Sony FX6 body');
  ok('an item opens on the Equipment page: its card, in view and outlined', at.tab === 'gear' && /gear-card/.test(at.foundClass) && /Sony FX6 body/.test(at.found) && /FX6-120934/.test(at.found) && at.inView && at.sheets.length === 0, JSON.stringify({ ...at, text: '' }));
  at = await pick(page, 'lensworks', 'gear', 'Sony FX6 body');
  ok('…and found by its service log, with that log open over its card', at.tab === 'gear' && at.sheets.join() === 'Service log: Sony FX6 body' && /Sensor cleaned at Lensworks/.test(await page.locator('.sheet').innerText()), JSON.stringify(at.sheets));
  await page.keyboard.press('Escape'); await sleep(200);
  at = await pick(page, 'interview set', 'gear', 'Interview set');
  ok('a kit opens on the Equipment page’s Kits tab: its card, in view and outlined', at.tab === 'gear' && /kit-card/.test(at.foundClass) && /Interview set/.test(at.found) && at.inView && /^Kits/.test(await page.locator('#page .seg [aria-selected=true]').innerText()), JSON.stringify({ ...at, text: '' }));
  at = await pick(page, 'mill lane', 'venues', 'Northline Legal, level 9');
  ok('a venue opens as the venue’s own page', at.tab === 'venues' && (await page.locator('#page .hero h2').innerText()) === 'Northline Legal, level 9' && /Service entrance on Mill Lane/.test(at.text), at.text.slice(0, 120));
  at = await pick(page, 'taproom', 'venues', 'Harbour Brewing Co. taproom');
  ok('…and another venue from there replaces it (the page is drawn again, not left as it was)', at.tab === 'venues' && (await page.locator('#page .hero h2').innerText()) === 'Harbour Brewing Co. taproom', at.text.slice(0, 120));
  at = await pick(page, 'PL-991302', 'insurance', 'Public Liability');
  ok('a policy opens on the Insurance page: its card, in view and outlined', at.tab === 'insurance' && /policy-card/.test(at.foundClass) && /PL-991302/.test(at.found) && at.inView && at.focusOnFound, JSON.stringify({ ...at, text: '' }));
  at = await pick(page, 'best take', 'tcnotes', 'Brewery day one, A cam');
  ok('a timecode log opens as that log, on the note that was found', at.tab === 'tcnotes' && /Brewery day one, A cam/.test(at.text) && /tc-note/.test(at.foundClass) && /Best take of the pour/.test(at.found), JSON.stringify({ ...at, text: at.text.slice(0, 80) }));
  at = await pick(page, 'brewmaster', 'tcnotes', 'Brewery day one, A cam');
  const para = await page.evaluate(() => { const p = document.getElementById('sc-sp2'), r = p ? p.getBoundingClientRect() : null; return { there: !!p, text: p ? p.textContent : '', inView: !!r && r.top >= 0 && r.bottom <= innerHeight }; });
  ok('…and found by its script, on that line of the script', at.tab === 'tcnotes' && para.there && /brewmaster/.test(para.text) && para.inView, JSON.stringify(para));
  // Settings: the thing found is one among others (a template among templates, a line far down the price list), so
  // the section alone is not enough. More templates and a longer price list first, to have something to tell apart.
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => {
    d.projectTemplates = [{ id: 'pt0', name: 'Aerial survey', icon: '🚁', base: 'brand', deliverables: [], shots: '', schedule: [], notes: '' }, ...d.projectTemplates, { id: 'pt2', name: 'Charity gala', icon: '🎗️', base: 'event', deliverables: [], shots: '', schedule: [], notes: '' }];
    d.priceList = { ...d.priceList, list: [...Array.from({ length: 36 }, (_, i) => ({ id: 'fill' + i, key: '', desc: `Filming line ${i + 1}`, unit: 'day', price: 100 + i, cat: ['Filming and crew', 'Planning', 'Travel'][i % 3] })), ...d.priceList.list], updatedAt: Date.now() };
  }))); await sleep(300);
  at = await pick(page, 'teaser', 'settings', 'Brewery promo');
  const section = await page.evaluate(() => { const d = [...document.querySelectorAll('#page details.settings-section')].find(x => x.querySelector(':scope > summary .ss-title').textContent === 'Project templates'); return { open: !!d && d.open, groupOpen: !!d && d.parentElement.closest('details').open, text: d ? d.innerText : '', cards: d ? d.querySelectorAll('.list > .card').length : 0 }; });
  ok('a project template opens Settings on Project templates', at.tab === 'settings' && section.open && section.groupOpen && /Brewery promo/.test(section.text), JSON.stringify({ tab: at.tab, open: section.open }));
  ok('…on that template’s own card among the others: in view, outlined and focused', section.cards === 3 && /Brewery promo/.test(at.found) && !/Aerial survey|Charity gala/.test(at.found) && /\bcard\b/.test(at.foundClass) && at.inView && at.focusOnFound, JSON.stringify({ cards: section.cards, found: at.found, cls: at.foundClass, inView: at.inView, focus: at.focusOnFound }));
  await sleep(300);
  ok('…and what is announced is what is on screen', (await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent)) === 'Brewery promo opened', await page.evaluate(() => (document.getElementById('sr-live') || {}).textContent));
  at = await pick(page, 'release forms', 'settings', 'Workflow templates');
  const line = await page.evaluate(() => { const f = document.querySelector('#page .found'), ta = f && f.querySelector('textarea'); return { there: !!f, label: ta ? ta.getAttribute('aria-label') : '', has: !!ta && ta.value.split('\n').includes('Print the release forms'), open: !!f && !!f.closest('details.twirl') && f.closest('details.twirl').open, said: (document.getElementById('sr-live') || {}).textContent }; });
  ok('a checklist line of your own opens Settings on Workflow templates, with the box that holds the line unfolded, in view and outlined', at.tab === 'settings' && line.there && line.has && line.open && line.label === 'Brand / commercial: Prepped checklist' && at.inView && line.said === 'Workflow templates opened', JSON.stringify({ ...line, inView: at.inView }));
  at = await pick(page, 'underwater', 'settings', 'Price list');
  ok('the price list opens as the price list', at.sheets.join() === 'Price list' && /Underwater housing/.test(await page.evaluate(() => (document.querySelector('.sheet') || {}).textContent || '')), JSON.stringify(at.sheets));
  const priced = await page.evaluate(() => { const f = document.querySelector('.sheet .found'), body = document.querySelector('.sheet .sheet-body'), r = f ? f.getBoundingClientRect() : null, b = body.getBoundingClientRect(); return { found: f ? f.querySelector('strong').textContent : '', unfolded: !!f && f.closest('details').open, group: f ? f.closest('details').dataset.cat : '', inView: !!r && r.height > 0 && r.top >= b.top && r.bottom <= b.bottom + 1, focus: !!f && document.activeElement === f, lines: document.querySelectorAll('.sheet .price-item').length }; });
  ok('…on the line that was found, among 37: its group unfolded, the line in view, outlined and focused', priced.found === 'Underwater housing' && priced.unfolded && priced.group === 'Equipment hire' && priced.inView && priced.focus && priced.lines === 37, JSON.stringify(priced));
  await page.keyboard.press('Escape'); await sleep(200);
  at = await pick(page, 'your studio', 'me', 'Your details');
  ok('your own details open the Me page', at.tab === 'me' && /Your Studio/.test(at.text) && !at.search && !at.inert, at.text.slice(0, 80));

  /* ----------------------- sheets and walkthroughs close it; read-only ----------------------- */
  await openIt(page); await say(page, 'harbour');
  await page.evaluate(() => import('./js/a11y.js').then(m => m.openDisplaySettings())); await page.waitForSelector('.sheet');
  const underSheet = await sState(page);
  ok('a sheet that opens while the search is open closes the search first', !underSheet.open && underSheet.expanded === 'false' && !underSheet.bodyClass && underSheet.inert, JSON.stringify(underSheet));
  await page.keyboard.press('/'); await page.keyboard.press('Control+k'); await sleep(200);
  ok('…and while a sheet is up neither “/” nor Ctrl+K opens the search under it', !(await sState(page)).open && (await page.locator('.sheet').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and closing the sheet leaves the page usable', sClosed(await sState(page)));
  await tidy(page); await openIt(page);
  await page.evaluate(() => import('./js/tour.js').then(t => { t.runTour([{ title: 'A walkthrough', text: 'Started while the search was open.', target: null }]); })); await page.waitForSelector('.tour-card');
  ok('a walkthrough that starts while the search is open closes the search', !(await sState(page)).open);
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and the page is usable when it ends', sClosed(await sState(page)) && (await page.locator('.tour').count()) === 0, JSON.stringify(await sState(page)));
  await tidy(page); await openMenu(page); await sleep(250);
  await page.keyboard.press('Control+k'); await sleep(200);
  ok('the menu and the search are never open together: Ctrl+K does nothing while the menu is open', !(await sState(page)).open && (await menuState(page)).open);
  await page.keyboard.press('Escape'); await sleep(150);
  // Read-only (the trial is over, no licence): the store refuses every change. Searching and opening still work.
  const ro = await page.evaluate(async () => { const s = await import('./js/store.js'); s.setGate(() => false); return { can: s.canChangeQuietly(), db: s.serialize() }; });
  at = await pick(page, 'rivera', 'crew', 'Sam Rivera');
  const at2 = await pick(page, 'harbour brewing', 'bookings', 'Harbour Brewing brand film');
  const ro2 = await page.evaluate(async () => { const s = await import('./js/store.js'); const same = s.serialize(); s.setGate(null); return same; });
  ok('while Vdex is read-only the search still finds and opens things, and changes nothing', ro.can === false && /Sam Rivera/.test(at.found) && at2.tab === 'bookings' && (await page.locator('.bk-detail .hero h2').innerText()) === 'Harbour Brewing brand film' && ro2 === ro.db, JSON.stringify({ can: ro.can, same: ro2 === ro.db }));
  ok('the search shows no price, Buy button or link to a shop', await (async () => { await openIt(page); await say(page, 'e'); const t = await page.locator('#search').innerText(); const links = await page.locator('#search a').count(); await page.keyboard.press('Escape'); return links === 0 && !/buy|licence code|\bshop\b/i.test(t.replace(/Licence: [^\n]*/g, '')); })());
  await ctx.close();

  /* ------------------------------ a wide screen ------------------------------ */
  ({ ctx, page } = await open({ w: 1200, h: 800 }));
  await seed(page);
  const wideBar = await page.evaluate(() => { const b = document.getElementById('searchBtn'), r = b.getBoundingClientRect(), m = document.getElementById('menuBtn').getBoundingClientRect(), br = document.querySelector('.brand').getBoundingClientRect(), label = b.querySelector('.cloud-label'), key = b.querySelector('.search-key'); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), menuTop: Math.round(m.top), right: Math.round(r.right), menuLeft: Math.round(m.left), brandRight: Math.round(br.right), left: Math.round(r.left), label: label.textContent, labelW: Math.round(label.getBoundingClientRect().width), whole: label.scrollWidth <= label.clientWidth, key: getComputedStyle(key).display !== 'none' ? key.textContent : '', barH: Math.round(document.querySelector('.top').getBoundingClientRect().height), fits: document.documentElement.scrollWidth <= innerWidth }; });
  ok('at 1200 px the search control is a field-shaped button in the bar that reads “Search everything” in full, with the “/” key shown, between the brand and the hamburger on one slim row', wideBar.w >= 200 && wideBar.h >= 44 && wideBar.top === wideBar.menuTop && wideBar.right <= wideBar.menuLeft && wideBar.left >= wideBar.brandRight && wideBar.label === 'Search everything' && wideBar.labelW > 80 && wideBar.whole && wideBar.key === '/' && wideBar.barH <= 64 && wideBar.fits, JSON.stringify(wideBar));
  await page.screenshot({ path: S + '/search-bar-1200.png', clip: { x: 0, y: 0, width: 1200, height: 120 } });
  await page.keyboard.press('/'); await page.locator('#search').waitFor({ state: 'visible' }); await sleep(350);
  await say(page, 'harbour');
  const widePanel = await page.evaluate(() => { const p = document.getElementById('search'), r = p.getBoundingClientRect(), l = document.getElementById('searchList'); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), centred: Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2, fits: document.documentElement.scrollWidth <= innerWidth && p.scrollWidth <= p.clientWidth, listEnds: Math.round(l.getBoundingClientRect().bottom) <= Math.round(r.bottom), keys: getComputedStyle(document.querySelector('.search-keys') || document.body).display }; });
  ok('there the panel is a box near the top, centred, at most 680 px wide and inside the screen, with its results inside it', widePanel.w <= 680 && widePanel.w >= 500 && widePanel.centred && widePanel.top > 20 && widePanel.bottom <= 800 && widePanel.fits && widePanel.listEnds, JSON.stringify(widePanel));
  await page.screenshot({ path: S + '/search-results-1200.png' });
  await page.mouse.click(60, 600); await sleep(150);
  const offClick = await sState(page);
  ok('a click on the dimmed page beside it closes it, focus back on the search button', sClosed(offClick) && offClick.focus === 'searchBtn', JSON.stringify(offClick));
  // Thousands of records: the index is built when the search opens, and a search is a fraction of a second.
  const speed = await page.evaluate(async () => {
    const s = await import('./js/store.js'), m = await import('./js/search.js');
    const words = ['harbour', 'meadow', 'orchard', 'quarry', 'lantern', 'copper', 'willow', 'granite', 'saffron', 'marble', 'ember', 'juniper'], w = i => words[i % words.length], day = i => `20${27 + (i % 3)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
    const base = JSON.parse(s.serialize());
    base.bookings = Array.from({ length: 3000 }, (_, i) => ({ id: 'b' + i, title: `${w(i)} ${w(i * 7 + 3)} film ${i}`, client: `${w(i * 5 + 1)} & Co ${i}`, date: day(i), status: 'Confirmed', address: `${i} ${w(i * 3)} Road`, stakeholders: [{ name: `Person ${i}`, role: 'Client', phone: `+1 555 ${String(1000 + i)}` }], crew: [], gear: [], shots: [{ id: 'x' + i, text: `Wide of the ${w(i * 11)} at dawn`, done: false }, { id: 'y' + i, text: `Close on the ${w(i * 13)} sign`, done: false }], notes: `Bring the ${w(i * 17)} filter and call ${w(i * 19)} first. Job ${i}.` }));
    base.crew = Array.from({ length: 2000 }, (_, i) => ({ id: 'c' + i, name: `${w(i * 3)} ${w(i * 5)}son ${i}`, role: 'Gaffer', phone: `+44 7700 ${String(900000 + i)}`, email: `p${i}@example.com`, notes: `Met on the ${w(i * 7)} job.` }));
    base.gear = Array.from({ length: 2000 }, (_, i) => ({ id: 'g' + i, name: `${w(i)} light ${i}`, category: 'Lighting', serial: `SN-${100000 + i}`, location: `${w(i * 5)} shelf`, qty: 1, notes: '' }));
    s.replaceAll(base);
    const t0 = performance.now(); const ix = m.buildIndex(); const built = performance.now() - t0;
    const times = []; let n = 0;
    for (const q of ['harbour', 'saffron film 12', 'SN-101234', 'e', '5551234', 'call juniper first']) { const t = performance.now(); n += m.find(q).results.length; times.push(Math.round(performance.now() - t)); }
    return { entries: ix.entries.length, built: Math.round(built), times, n, serial: m.search('SN-101234').map(r => r.title).join() };
  });
  ok(`with 7,000 records the index is built in well under two seconds and a search takes well under a third of one (built in ${speed.built} ms, searches ${speed.times.join(', ')} ms)`, speed.entries >= 7000 && speed.built < 2000 && Math.max(...speed.times) < 300 && speed.serial === 'ember light 1234', JSON.stringify(speed));
  await page.keyboard.press('Control+k'); await sleep(200);
  const t0 = Date.now(); await page.locator('#searchInput').fill('saffron film'); await page.waitForFunction(() => /results/.test(document.getElementById('searchStatus').textContent), null, { timeout: 5000 }); const drawn = Date.now() - t0;
  const big = await page.evaluate(() => ({ options: document.querySelectorAll('#searchList [role=option]').length, status: document.getElementById('searchStatus').textContent, nodes: document.querySelectorAll('#search *').length }));
  ok(`…and typing shows the answer promptly without drawing thousands of rows (${drawn} ms, ${big.options} rows for “${big.status}”)`, drawn < 1500 && big.options <= 24 && big.nodes < 600 && /^\d+ results/.test(big.status), JSON.stringify(big));
  await tap(page.locator('#search .chip[data-group="bookings"]')); await sleep(200);
  const paged = await page.evaluate(() => ({ options: document.querySelectorAll('#searchList .sr:not(.sr-more)').length, more: (document.querySelector('#searchList .sr-more') || {}).textContent || '' }));
  await tap(page.locator('#searchList .sr-more')); await sleep(200);
  const paged2 = await page.evaluate(() => document.querySelectorAll('#searchList .sr:not(.sr-more)').length);
  ok('one page’s results come a screenful at a time, with Show more for the next', paged.options === 60 && /^Show more \(\d+ more\)$/.test(paged.more) && paged2 === 120, JSON.stringify([paged, paged2]));
  await ctx.close();

  /* ------------------------------ both themes, and a small screen ------------------------------ */
  ({ ctx, page } = await open({ w: 360, h: 480 }));
  await seed(page);
  await openIt(page); await say(page, 'harbour'); await page.keyboard.press('ArrowDown');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme }); await sleep(150);
    const c = await page.evaluate(() => { const lum = col => { const [r, g, b] = col.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { if (!/^color\(/.test(col)) v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }, ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }; const bg = getComputedStyle(document.getElementById('search')).backgroundColor, cs = sel => getComputedStyle(document.querySelector(sel)).color; return { bg, title: ratio(cs('#searchList .sr-title'), bg), meta: ratio(cs('#searchList .sr-meta'), bg), head: ratio(cs('#searchList .sr-head'), bg), status: ratio(cs('#searchStatus'), bg), label: ratio(cs('#searchList .sr-label'), bg) }; });
    ok(`in the ${scheme} theme the results keep their contrast (titles 7:1 or more, the smaller grey lines 4.5:1 or more)`, c.title >= 7 && c.meta >= 4.5 && c.head >= 4.5 && c.status >= 4.5 && c.label >= 4.5, JSON.stringify(c));
    await page.screenshot({ path: `${S}/search-results-360x480-${scheme}.png` });
  }
  const small = await page.evaluate(() => { const p = document.getElementById('search').getBoundingClientRect(), l = document.getElementById('searchList'), r = l.getBoundingClientRect(); return { box: [Math.round(p.left), Math.round(p.top), Math.round(p.width), Math.round(p.height)], listTop: Math.round(r.top), listBottom: Math.round(r.bottom), scrolls: l.scrollHeight > l.clientHeight, fits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2000 }; });
  ok('on a small screen (360 by 480) the panel still fills it, and the results scroll inside the room that is left under the field and the chips', JSON.stringify(small.box) === '[0,0,360,480]' && small.listBottom <= 480 && small.listBottom - small.listTop >= 240 && small.scrolls, JSON.stringify(small));
  await page.setViewportSize({ width: 740, height: 360 }); await sleep(200);
  const lying = await page.evaluate(() => { const p = document.getElementById('search').getBoundingClientRect(), l = document.getElementById('searchList').getBoundingClientRect(); return { box: [Math.round(p.left), Math.round(p.top), Math.round(p.width), Math.round(p.height)], list: Math.round(l.height), fits: document.documentElement.scrollWidth <= innerWidth }; });
  ok('on a phone held sideways (740 by 360) the panel takes the whole screen rather than a box, so the results keep most of the height', JSON.stringify(lying.box) === '[0,0,740,360]' && lying.list >= 190 && lying.fits, JSON.stringify(lying));
  await page.screenshot({ path: S + '/search-results-740x360.png' });
  await page.setViewportSize({ width: 360, height: 480 }); await sleep(200);
  await page.evaluate(() => { document.documentElement.dataset.text = 'xlarge'; document.documentElement.dataset.targets = 'large'; }); await sleep(150);
  const large = await page.evaluate(() => { const p = document.getElementById('search'), i = document.getElementById('searchInput'), chips = [...document.querySelectorAll('#search .chip')]; return { fits: p.scrollWidth <= p.clientWidth && [...p.querySelectorAll('*')].every(e => e.closest('.search-chips .chip') || e.getBoundingClientRect().right <= innerWidth + 1), font: parseFloat(getComputedStyle(i).fontSize), title: parseFloat(getComputedStyle(document.querySelector('#searchList .sr-title')).fontSize), chip: Math.round(chips[0].getBoundingClientRect().height), listH: Math.round(document.getElementById('searchList').getBoundingClientRect().height) }; });
  ok('with extra-large text and large buttons the field, the results and the chips grow with them and nothing is clipped sideways', large.fits && large.font >= 22 && large.title >= 22 && large.chip >= 54 && large.listH >= 150, JSON.stringify(large));
  await page.screenshot({ path: S + '/search-results-360x480-xlarge.png' });
  await ctx.close();

  /* ------------------------------------ locked ------------------------------------ */
  ({ ctx, page } = await open());
  await seed(page);
  await page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810')));
  await page.waitForFunction(() => !document.getElementById('lockBtn').hidden, null, { timeout: 60000 });
  await openIt(page); await say(page, 'harbour'); await page.keyboard.press('ArrowDown');
  const beforeLock = await page.evaluate(() => document.querySelectorAll('#searchList [role=option]').length);
  await page.evaluate(() => import('./js/lock.js').then(l => l.lockNow())); await page.waitForSelector('.lock');
  const locked = await page.evaluate(async () => { const m = await import('./js/search.js'), i = document.getElementById('searchInput'), back = document.getElementById('searchBack'); return { open: m.isOpen(), hidden: back.hidden, value: i.value, active: i.getAttribute('aria-activedescendant'), options: document.querySelectorAll('#searchList [role=option]').length, text: document.getElementById('search').textContent.replace(/Search everything…|✕/g, '').trim().length, marks: document.querySelectorAll('#search mark').length, expanded: document.getElementById('searchBtn').getAttribute('aria-expanded'), bodyClass: document.body.classList.contains('search-open'), top: !!document.elementFromPoint(180, 30).closest('.lock'), btnInert: !!document.getElementById('searchBtn').closest('[inert]') }; });
  ok('locking while the search is open closes it and empties it: nothing typed, no results and no marked words are left under the lock screen', beforeLock === 8 && !locked.open && locked.hidden && locked.value === '' && !locked.active && locked.options === 0 && locked.marks === 0 && locked.text === 0 && locked.expanded === 'false' && !locked.bodyClass && locked.top && locked.btnInert, JSON.stringify(locked));
  await page.keyboard.press('/'); await page.keyboard.press('Control+k'); await page.evaluate(() => window.logiSearch.open()); await sleep(300);
  const stillLocked = await page.evaluate(async () => { const m = await import('./js/search.js'); return { open: m.isOpen(), hidden: document.getElementById('searchBack').hidden, lock: document.querySelectorAll('.lock').length }; });
  ok('while Vdex is locked there is nothing to search: “/”, Ctrl+K and a call from the code all leave it closed', !stillLocked.open && stillLocked.hidden && stillLocked.lock === 1, JSON.stringify(stillLocked));
  await page.keyboard.type('246810'); await page.waitForSelector('.lock', { state: 'detached', timeout: 60000 }); await sleep(300);
  await openIt(page); await sleep(250);
  const afterLock = await page.evaluate(() => ({ value: document.getElementById('searchInput').value, options: document.querySelectorAll('#searchList [role=option]').length, blank: /Search everything in Vdex/.test(document.querySelector('.search-blank').textContent), focus: document.activeElement.id }));
  res = await say(page, 'harbour');
  ok('unlocked, the search opens empty and works again', afterLock.value === '' && afterLock.options === 0 && afterLock.blank && afterLock.focus === 'searchInput' && titles(res, 'bookings')[0] === 'Harbour Brewing brand film', JSON.stringify(afterLock));
  await page.keyboard.press('Escape');
  await page.evaluate(() => import('./js/lock.js').then(l => l.removePin())); await sleep(300);
  await ctx.close();

  /* ------------------- deep in a long list: the way back to the results ------------------- */
  // A result can land far down a long page, where the top bar and its search control have scrolled away. The Rolodex
  // bar stays, and carries a magnifier of its own there; opened again with the same words, the list is as it was left.
  ({ ctx, page } = await open({ w: 390, h: 800 }));
  await seed(page);
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { for (let i = 0; i < 400; i++) d.gear.push({ id: 'many' + i, name: `Probe light ${String(i).padStart(3, '0')}`, category: 'Lighting', serial: `ZX-${5000 + i}`, location: 'Van', qty: 1, notes: '', updatedAt: Date.now() }); }))); await sleep(400);
  const nav0 = await page.evaluate(() => { const b = document.getElementById('navSearch'); return { there: !!b, hidden: !b || b.hidden, top: Math.round(document.getElementById('searchBtn').getBoundingClientRect().top) }; });
  ok('at the top of a page the search control is the one in the top bar: the Rolodex bar shows no second magnifier', nav0.there && nav0.hidden && nav0.top >= 0, JSON.stringify(nav0));
  await openIt(page); await say(page, 'probe light');
  await tap(page.locator('#searchList .sr-group[data-group="gear"] .sr-more')); await sleep(200);
  await tap(page.locator('#searchList .sr-more')); await sleep(200);
  await page.evaluate(() => { document.querySelectorAll('#searchList .sr:not(.sr-more)')[99].scrollIntoView({ block: 'center' }); }); await sleep(150);
  const left = await page.evaluate(() => ({ rows: document.querySelectorAll('#searchList .sr:not(.sr-more)').length, top: Math.round(document.getElementById('searchList').scrollTop), title: document.querySelectorAll('#searchList .sr:not(.sr-more) .sr-title')[99].textContent }));
  await tap(page.locator('#searchList .sr:not(.sr-more)').nth(99)); await sleep(800);
  const deep = await page.evaluate(() => { const f = document.querySelector('#page .found'), nav = document.getElementById('rolodex'), b = document.getElementById('navSearch') || document.createElement('i'), r = b.getBoundingClientRect(), n = nav.getBoundingClientRect(), fr = f ? f.getBoundingClientRect() : null, hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), ico = document.querySelector('#rolodex .tab[aria-selected=true] .tab-ico').getBoundingClientRect(), up = document.querySelector('#rolodex .drum-btn.up').getBoundingClientRect();
    return { found: f ? f.querySelector('strong').textContent : '', y: Math.round(scrollY), topBar: Math.round(document.getElementById('searchBtn').getBoundingClientRect().bottom), tucked: nav.classList.contains('tucked'), navOnScreen: Math.round(n.top) === 0 && n.bottom > 100, cardClear: !!fr && fr.top >= n.bottom && fr.bottom <= innerHeight, shown: b.isConnected && !b.hidden, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], inBar: r.top >= n.top && r.bottom <= n.bottom && r.left >= 0 && r.right <= innerWidth, onTop: !!hit && !!hit.closest('#navSearch'), clear: r.right <= ico.left && r.right <= up.left, name: b.getAttribute('aria-label'), popup: b.getAttribute('aria-haspopup'), fits: document.documentElement.scrollWidth <= innerWidth }; });
  ok('a result far down a long list (400 items) is shown below the Rolodex bar, which stays on screen for it, the top bar long gone', deep.found === left.title && deep.y > 3000 && deep.topBar < 0 && !deep.tucked && deep.navOnScreen && deep.cardClear, JSON.stringify(deep));
  ok('…and there the Rolodex bar carries a magnifier: a 44 px button named Search everything, inside the bar, clear of the card’s icon and the ▲ ▼ buttons, with no sideways scroll', deep.shown && deep.box[2] >= 44 && deep.box[3] >= 44 && deep.inBar && deep.onTop && deep.clear && deep.name === 'Search everything' && deep.popup === 'dialog' && deep.fits, JSON.stringify(deep));
  await page.screenshot({ path: S + '/search-nav-magnifier-390.png' });
  await tap(page.locator('#navSearch')); await page.locator('#search').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); await sleep(300);
  const again = await page.evaluate(() => { const i = document.getElementById('searchInput'); return { open: !document.getElementById('searchBack').hidden, value: i.value, selected: i.selectionStart === 0 && i.selectionEnd === i.value.length, chip: (document.querySelector('#search .chip.on') || { dataset: {} }).dataset.group, rows: document.querySelectorAll('#searchList .sr:not(.sr-more)').length, top: Math.round(document.getElementById('searchList').scrollTop) }; });
  ok('that magnifier opens the search with the same words, and the list as it was left: the same chip, as many results, scrolled to the same place', again.open && again.value === 'probe light' && again.selected && again.chip === 'gear' && left.rows === 120 && again.rows === 120 && left.top > 1000 && Math.abs(again.top - left.top) <= 2, JSON.stringify({ left, again }));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('…and Escape gives the focus back to that magnifier, not to the button that has scrolled away', (await focusId(page)) === 'navSearch' && sClosed(await sState(page)), await focusId(page));
  const yDeep = await page.evaluate(() => scrollY);
  await page.evaluate(y => window.scrollTo(0, y + 300), yDeep); await sleep(150); await page.evaluate(y => window.scrollTo(0, y + 600), yDeep); await sleep(400);
  const down = await page.evaluate(() => ({ tucked: document.getElementById('rolodex').classList.contains('tucked'), bottom: Math.round((document.getElementById('navSearch') || document.body).getBoundingClientRect().bottom) }));
  await page.evaluate(y => window.scrollTo(0, y + 550), yDeep); await sleep(400);
  const upAgain = await page.evaluate(() => { const b = document.getElementById('navSearch'), r = b ? b.getBoundingClientRect() : { top: -1 }; return { tucked: document.getElementById('rolodex').classList.contains('tucked'), top: Math.round(r.top), hidden: !b || b.hidden }; });
  ok('the magnifier goes with its bar: away as the page scrolls down, back the moment it scrolls up', down.tucked && down.bottom <= 2 && !upAgain.tucked && upAgain.top >= 0 && !upAgain.hidden, JSON.stringify({ down, upAgain }));
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
  ok('back at the top of the page the Rolodex bar’s magnifier is gone again', await page.evaluate(() => { const b = document.getElementById('navSearch'); return !!b && b.hidden; }));
  await ctx.close();

  /* ------------------------------ a phone's own keyboard ------------------------------ */
  ({ ctx, page } = await open({ w: 390, h: 800, options: { hasTouch: true, isMobile: true } }));
  await seed(page);
  await page.locator('#searchBtn').tap(); await page.locator('#search').waitFor({ state: 'visible' }); await sleep(300);
  await say(page, 'rivera');
  const hint = await page.evaluate(() => ({ touch: matchMedia('(hover: none) and (pointer: coarse)').matches, key: document.getElementById('searchInput').enterKeyHint, focus: document.activeElement.id }));
  await page.keyboard.press('Enter'); await sleep(200);
  const put = await page.evaluate(() => ({ open: !document.getElementById('searchBack').hidden, focus: document.activeElement.id, marked: document.querySelectorAll('#searchList [aria-selected=true]').length, options: document.querySelectorAll('#searchList [role=option]').length, value: document.getElementById('searchInput').value }));
  ok('on a touch screen the keyboard’s Search key puts the keyboard away (the field lets go of the focus) and leaves the results as they are: nothing marked, nothing opened', hint.touch && hint.key === 'search' && hint.focus === 'searchInput' && put.open && put.focus !== 'searchInput' && put.marked === 0 && put.options > 0 && put.value === 'rivera', JSON.stringify({ hint, put }));
  await page.locator('#searchList .sr-group[data-group="crew"] .sr').first().tap(); await sleep(700);
  const tapped = await page.evaluate(() => { const f = document.querySelector('#page .found'); return { tab: window.logiPage(), found: f ? f.querySelector('strong').textContent : '', open: !document.getElementById('searchBack').hidden }; });
  ok('…and a tap on a result opens it', tapped.tab === 'crew' && tapped.found === 'Sam Rivera' && !tapped.open, JSON.stringify(tapped));
  await ctx.close();

  /* ------------------------------ ⌘K on Apple devices ------------------------------ */
  ({ ctx, page } = await open({ w: 1200, h: 800, init: () => { Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'MacIntel' }); } }));
  await seed(page);
  await page.evaluate(() => window.logiGo('crew')); await page.waitForSelector('#page .search'); await sleep(300);
  await page.locator('#page .search').click(); await page.keyboard.type('sam');
  await page.keyboard.press('Control+k'); await sleep(300);
  const ctrl = await page.evaluate(() => ({ open: !(document.getElementById('searchBack') || { hidden: true }).hidden, inField: document.activeElement.matches('#page .search'), keys: document.getElementById('searchBtn').getAttribute('aria-keyshortcuts') }));
  ok('on a Mac, Control+K in a text box is left to the system (it deletes to the end of the line there): the search stays closed and the focus stays in the box', !ctrl.open && ctrl.inField && ctrl.keys === '/ Meta+K', JSON.stringify(ctrl));
  await page.keyboard.press('Meta+k'); await page.locator('#search').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); await sleep(200);
  const cmd = await sState(page);
  await page.keyboard.press('Control+k'); await page.keyboard.type('x'); await sleep(150);
  const inside = await page.evaluate(() => ({ focus: document.activeElement.id, value: document.getElementById('searchInput').value }));
  await page.keyboard.press('Escape'); await sleep(200);
  const cmdBack = await page.evaluate(() => ({ inField: document.activeElement.matches('#page .search'), value: document.activeElement.value }));
  ok('…⌘K opens it, and closing it gives the focus back to that box with what was typed', cmd.open && cmd.focus === 'searchInput' && inside.focus === 'searchInput' && cmdBack.inField && cmdBack.value === 'sam', JSON.stringify({ cmd, inside, cmdBack }));
  await ctx.close();

  /* ----------------------------- nothing to search yet ----------------------------- */
  ({ ctx, page } = await open());
  await openIt(page); await sleep(250);
  const bare = await page.evaluate(() => ({ blank: document.querySelector('.search-blank').innerText, chips: document.querySelector('#search .search-chips').hidden || document.querySelectorAll('#search .chip').length === 0 }));
  ok('on a new, empty Vdex the search says there is nothing to search yet, and shows no chips', /Nothing to search yet/.test(bare.blank) && bare.chips, JSON.stringify(bare));
  // Records that cannot be read as they should be (a hand-edited or foreign backup can hold them): each costs at most
  // itself. Looked at from a page that lists none of them, since the Bookings page has its own trouble with one.
  await page.keyboard.press('Escape'); await page.evaluate(() => window.logiGo('field')); await sleep(400);
  const errorsBefore = errors.length;
  const odd = await page.evaluate(async () => {
    const s = await import('./js/store.js'), m = await import('./js/search.js');
    const base = JSON.parse(s.serialize());
    base.bookings = [{ id: 'a', title: 'Alpha wedding', date: '2027-01-01' }, { id: 'b', title: 'Bravo wedding', date: '2027-01-02', crew: 'c1', kits: 'k1', gear: 7 }, { id: 'c', title: 'Charlie wedding', date: '2027-01-03', hires: 'someone' }, { id: 'd', title: 'Delta wedding', date: '2027-01-04' }];
    base.kits = [{ id: 'k1', name: 'Wedding kit', gear: 'g1' }]; base.venues = [{ id: 'v1', name: 'Wedding barn' }];
    s.replaceAll(base);
    const found = m.search('wedding').map(r => r.title).sort();
    s.replaceAll({ ...base, bookings: [], kits: [], venues: [] });
    return found;
  });
  await sleep(200);
  const logged = errors.splice(errorsBefore);
  ok('a booking whose crew is not a list, and a kit whose items are not, are found like any other; a booking that cannot be read at all is passed over, and everything after it is still found', odd.join() === 'Alpha wedding,Bravo wedding,Delta wedding,Wedding barn,Wedding kit' && logged.length >= 1 && logged.every(e => /hires|filter is not a function/.test(e)), JSON.stringify({ odd, logged: logged.map(e => e.slice(0, 80)) }));
  await ctx.close();

  }

  ok('no page errors or Content Security Policy refusals', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

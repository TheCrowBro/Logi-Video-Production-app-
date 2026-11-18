// What is underneath the lock screen and the offer of a longer PIN, and what the lock screen does when things change
// under it. A key pressed on the lock screen or the offer stays there: a form, the role menu or a walkthrough
// underneath is not closed or moved by it, and after the unlock the page is out of reach only while something is
// really open over it. A walkthrough step that shows the menu or the search shows it again after an unlock, and shows
// it above a form the walkthrough was started from. The lock screen follows a PIN changed under it, wrong tries made
// in another tab and an erase from another tab; the app never starts behind a lock screen; the offer never comes over
// the terms; a PIN the disk would not take is not reported as set; and what the lock screen says to a screen reader
// (the wait, how many digits are in) is said from inside it, where it can be heard.
// ONLY=<part of a case's name> runs just those cases, for working on one.
const { chromium } = require('playwright');
const { TERMS_RECORD } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const OLD = '246810', P9 = '123456789', P12 = '135791357913', P18 = '123456789012345678';
const PHONE = { width: 360, height: 740 };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); page.on('dialog', d => d.accept()); };
  const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
  const cfg = async page => JSON.parse(await ls(page, 'logi-lock') || 'null');
  const mem = page => page.evaluate(() => import('./js/lock.js').then(l => { const c = l.config(); return c && { len: c.len, max: c.max, attempts: c.attempts || 0, salt: c.salt, autoLock: c.autoLock }; }));
  const lockUp = page => page.waitForSelector('.lock:not(.lock-setup)', { timeout: 30000 });
  const lockGone = page => page.waitForFunction(() => !document.querySelector('.lock:not(.lock-setup)'), null, { timeout: 60000 });
  const app = page => page.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
  // What comes after the lock screen: the offer of a longer PIN, or the app.
  const next = async page => { await page.waitForFunction(() => document.querySelector('.pin-offer') || (!document.querySelector('.lock') && document.querySelector('#rolodex .drum-btn')), null, { timeout: 60000 }); await sleep(700); return (await page.locator('.pin-offer').count()) ? 'offer' : 'app'; };
  const lockNow = page => page.evaluate(() => import('./js/lock.js').then(l => l.lockNow()));
  const unlock = async (page, pin = OLD) => { await lockUp(page); await page.keyboard.type(pin); await lockGone(page); await sleep(300); };
  const vaultWritten = page => page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
  // The app put away and brought back, as a phone does it.
  const setVis = (page, hidden) => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  // Deriving a key from a PIN takes this much longer, as it does on a phone.
  const slowPin = (page, ms) => page.evaluate(ms => { const real = SubtleCrypto.prototype.deriveKey; SubtleCrypto.prototype.deriveKey = function (...a) { return new Promise(r => setTimeout(r, ms)).then(() => real.apply(this, a)); }; }, ms);
  const dots = page => page.evaluate(() => { const el = document.querySelector('.lock:not(.lock-setup) .pin-dots'); return el ? { n: el.querySelectorAll('i').length, on: el.querySelectorAll('i.on').length } : { n: 0, on: -1 }; });
  const lockSays = page => page.evaluate(() => document.querySelector('.lock:not(.lock-setup) .lock-msg')?.textContent ?? '(no lock screen)');
  // The lock screen's own words for a screen reader, and whether anything stops them being heard.
  const heard = page => page.evaluate(() => { const r = document.querySelector('.lock:not(.lock-setup) .lock-card [role=status].sr-only'); return r ? { text: r.textContent, live: r.getAttribute('aria-live'), reachable: !r.closest('[inert]') && !r.closest('[aria-hidden=true]') } : { text: '(no region)', reachable: false }; });
  const state = page => page.evaluate(() => ({ appInert: document.getElementById('app').inert, sheets: document.querySelectorAll('.sheet-back').length, lock: document.querySelectorAll('.lock:not(.lock-setup)').length, offer: document.querySelectorAll('.pin-offer').length, tour: document.querySelectorAll('.tour').length, typed: document.querySelector('.sheet form [data-key="name"]')?.value ?? null, focus: document.activeElement.closest('.lock') ? 'lock' : document.activeElement.closest('.sheet') ? 'sheet' : document.activeElement.closest('#app') ? 'app' : document.activeElement.tagName }));
  // The page can be used: the hamburger takes a tap and opens the menu.
  const usable = async page => { const tapped = await page.locator('#menuBtn').click({ timeout: 4000 }).then(() => true, () => false); const open = tapped && await page.locator('#menu').waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false); if (open) { await page.keyboard.press('Escape'); await sleep(150); } return open && !(await page.evaluate(() => document.getElementById('app').inert)); };
  // An existing user with sample data and a PIN. old: the config as every version before longer PINs wrote it (no max).
  const existing = async ({ pin = OLD, old = false, patch = null, terms = null } = {}) => {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
    await ctx.addInitScript(t => { if (!localStorage.getItem('spec-seeded')) { localStorage.setItem('spec-seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await app(page);
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    await page.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), pin); await page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
    if (patch) await page.evaluate(p => import('./js/lock.js').then(l => l.setOption(p)), patch);
    await page.evaluate(() => new Promise(r => setTimeout(r, 400))); // the vault catches up with the sample data
    await page.evaluate(([old, terms]) => { localStorage.removeItem('logi-lock-setup'); if (terms) localStorage.setItem('logi-terms', terms); if (old) { const c = JSON.parse(localStorage.getItem('logi-lock')); delete c.max; localStorage.setItem('logi-lock', JSON.stringify(c)); } }, [old, terms]);
    return { ctx, page };
  };
  const bookings = page => page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length));
  // Crew → + Add, with a name typed into the form.
  const addForm = async (page, name = 'Robin Example') => { await page.evaluate(() => window.logiGo('crew')); await page.locator('.page-card[aria-label="Crew"] .page-head .btn.primary').click(); await page.locator('.sheet form [data-key="name"]').fill(name); };
  const card = page => page.evaluate(() => document.querySelector('.tour-card h2')?.textContent ?? '');
  const nextCard = async page => { const was = await page.locator('.tour-step').innerText(); await page.locator('.tour-card .btn.primary').click(); await page.waitForFunction(prev => !document.querySelector('.tour-card') || (document.querySelector('.tour-step') || {}).textContent !== prev, was, { timeout: 10000 }).catch(() => {}); await sleep(350); };
  const toCard = async (page, title) => { for (let i = 0; i < 12 && (await card(page)) !== title; i++) await nextCard(page); return (await card(page)) === title; };
  const shown = page => page.evaluate(() => { const m = document.getElementById('menuBack'), s = document.getElementById('searchBack'); return { menu: !!m && !m.hidden && document.body.classList.contains('menu-open'), search: !!s && !s.hidden && document.body.classList.contains('search-open') }; });

  const cases = [];
  const the = (name, fn) => cases.push([name, fn]);

  /* ------------------------- a key pressed on the lock screen stays on the lock screen ------------------------- */
  the('form under the lock', async () => {
    const { ctx, page } = await existing();
    await addForm(page);
    await lockNow(page); await lockUp(page);
    await page.keyboard.press('Escape'); await sleep(250);
    const locked = await state(page);
    ok('Escape on the lock screen does not close the form underneath: it is still there, with what was typed', locked.sheets === 1 && locked.typed === 'Robin Example' && locked.lock === 1, JSON.stringify(locked));
    ok('…the page behind stays out of reach, and the focus stays on the lock screen', locked.appInert && locked.focus === 'lock', JSON.stringify(locked));
    await page.keyboard.press('Space'); await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await sleep(250);
    const poked = await state(page);
    ok('…and Space and Tab open nothing behind it: they press the keypad', poked.sheets === 1 && poked.typed === 'Robin Example' && poked.focus === 'lock' && poked.appInert && (await dots(page)).on === 2, JSON.stringify(poked));
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    const after = await state(page);
    ok('after the PIN the form is as it was left, and can be used', after.sheets === 1 && after.typed === 'Robin Example' && after.appInert && !(await page.evaluate(() => document.querySelector('.sheet-back').inert)) && await page.locator('.sheet form [data-key="name"]').fill('Robin Example-Hale', { timeout: 2500 }).then(() => true, () => false), JSON.stringify(after));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…Escape closes it as usual, and the page is usable again', (await state(page)).sheets === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  the('role menu under the lock', async () => {
    const { ctx, page } = await existing();
    await addForm(page);
    await page.locator('.sheet form button[data-key="role"]').click(); await page.waitForSelector('.role-menu'); await sleep(200);
    await lockNow(page); await lockUp(page);
    await page.keyboard.press('Escape'); await sleep(250);
    ok('Escape on the lock screen leaves the role menu open over the form', (await page.locator('.role-menu').count()) === 1 && (await state(page)).sheets === 2);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    const inert = () => page.evaluate(() => [...document.querySelectorAll('.sheet-back')].map(b => b.inert));
    ok('after the PIN the role menu is on top and usable, the form under it out of reach as before', (await page.locator('.role-menu').count()) === 1 && (await inert()).join() === 'true,false', (await inert()).join());
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…Escape closes the role menu, and the form can be used and closed', (await page.locator('.role-menu').count()) === 0 && (await inert()).join() === 'false' && (await state(page)).typed === 'Robin Example' && await page.locator('.sheet .sheet-tools button[aria-label="Close"]').click({ timeout: 2500 }).then(() => true, () => false));
    await sleep(200);
    ok('…and then the page', (await state(page)).sheets === 0 && await usable(page));
    await ctx.close();
  });

  the('offer over a form', async () => {
    const { ctx, page } = await existing();
    await page.evaluate(() => window.logiGo('crew')); await page.waitForSelector('.page-card[aria-label="Crew"] .page-head .btn.primary');
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined }))); // the config as an older version left it
    // The offer's file is a moment late, so the person has a form open by the time the offer comes up.
    let release; const held = new Promise(r => { release = r; });
    await ctx.route('**/js/pin-offer.js', async r => { await held; await r.continue().catch(() => {}); });
    await lockNow(page); await unlock(page);
    await addForm(page);
    release(); await page.waitForSelector('.pin-offer', { timeout: 10000 }); await sleep(300);
    ok('(the offer of a longer PIN is up over an open form)', (await state(page)).offer === 1 && (await state(page)).sheets === 1);
    await page.keyboard.press('Escape'); await sleep(350);
    const st = await state(page);
    ok('Escape on the offer keeps the PIN and closes the offer only: the form underneath is still there, with what was typed', st.offer === 0 && (await cfg(page)).max === 20 && st.sheets === 1 && st.typed === 'Robin Example', JSON.stringify(st));
    ok('…and the form can be used', st.appInert && await page.locator('.sheet form [data-key="name"]').fill('Robin Example-Hale', { timeout: 2500 }).then(() => true, () => false));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…and closed, and then the page is usable', (await state(page)).sheets === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  the('walkthrough under the lock', async () => {
    const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
    const first = await card(page);
    await lockNow(page); await lockUp(page);
    await page.keyboard.press('ArrowRight'); await sleep(900);
    ok('the right arrow on the lock screen does not move the walkthrough underneath', (await card(page)) === first, `${first} → ${await card(page)}`);
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…and Escape does not end it', (await state(page)).tour === 1 && (await state(page)).appInert);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    await page.keyboard.press('ArrowRight'); await sleep(900);
    ok('after the PIN the walkthrough is where it was, and its keys work again', (await state(page)).tour === 1 && (await card(page)) !== first && (await card(page)) !== '', await card(page));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…Escape ends it, and the page is usable', (await state(page)).tour === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  the('sheet closed by code while locked', async () => {
    const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/util.js').then(u => { window.__sheet = u.sheet('A sheet', u.h('p', null, 'Closed by the app itself while Vdex is locked.')); }));
    await lockNow(page); await lockUp(page);
    await page.evaluate(() => window.__sheet.close()); await sleep(150);
    ok('a sheet that closes by itself while Vdex is locked does not put the page back in reach behind the lock screen', (await state(page)).sheets === 0 && (await state(page)).appInert);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    ok('…and after the PIN the page is usable: nothing is open, so nothing is out of reach', (await state(page)).sheets === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  /* --------------------------- a course started from a form's ? (it closes the form) --------------------------- */
  the('course from a form', async () => {
    const { ctx, page } = await existing();
    await addForm(page);
    await page.locator('.sheet .sheet-help').last().click(); await page.waitForSelector('.tour-card h2'); await sleep(300);
    await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet .card.tap', { hasText: 'Quotes & invoices, start to finish' }).click();
    await page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(300);
    for (let i = 0; i < 6 && (await state(page)).sheets > 0; i++) await nextCard(page);
    await sleep(500);
    ok('(the course has closed the form it was started from)', (await state(page)).sheets === 0 && (await state(page)).tour === 1, await card(page));
    await page.keyboard.press('Escape'); await sleep(300);
    const st = await state(page);
    ok('when a course started from a form ends, the page is usable: the form is gone, so nothing is out of reach', st.tour === 0 && st.sheets === 0 && !st.appInert && await usable(page), JSON.stringify(st));
    await ctx.close();
  });

  /* ------------------------ a walkthrough step that shows the menu or the search ------------------------ */
  the('menu step after an unlock', async () => {
    const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
    ok('(Getting around is on its menu step, the menu shown)', (await toCard(page, 'How syncing is going')) && (await shown(page)).menu);
    await lockNow(page); await lockUp(page); await sleep(200);
    ok('the lock screen closes the menu, as before', !(await shown(page)).menu);
    await page.keyboard.type(OLD); await lockGone(page);
    await page.waitForFunction(() => document.body.classList.contains('menu-open'), null, { timeout: 5000 }).catch(() => {}); await sleep(1000);
    const spot = () => page.evaluate(sel => { const s = document.querySelector('.tour-spot').getBoundingClientRect(), t = document.querySelector(sel)?.getBoundingClientRect(); return !!t && t.width > 0 && Math.abs(s.left + s.width / 2 - (t.left + t.width / 2)) < 12 && Math.abs(s.top + s.height / 2 - (t.top + t.height / 2)) < 12; }, '#menuStatus');
    ok('after the unlock the step shows the menu again, the spotlight on what the card is about', (await shown(page)).menu && (await card(page)) === 'How syncing is going' && await spot(), JSON.stringify(await shown(page)));
    ok('…still to look at and not to use, with the focus in the card', await page.evaluate(() => document.getElementById('menuBack').inert && !!document.activeElement.closest('.tour-card')));
    // back to the search step
    for (let i = 0; i < 3 && (await card(page)) !== 'What to type'; i++) { await page.locator('.tour-card').getByRole('button', { name: 'Back', exact: true }).click(); await sleep(800); }
    ok('(the step What to type shows the search panel)', (await card(page)) === 'What to type' && (await shown(page)).search);
    await lockNow(page); await lockUp(page); await sleep(200);
    const closed = !(await shown(page)).search;
    await page.keyboard.type(OLD); await lockGone(page);
    await page.waitForFunction(() => document.body.classList.contains('search-open'), null, { timeout: 5000 }).catch(() => {}); await sleep(600);
    ok('the search step shows its panel again after an unlock too', closed && (await shown(page)).search && (await card(page)) === 'What to type', JSON.stringify(await shown(page)));
    await page.keyboard.press('Escape'); await sleep(300);
    ok('the walkthrough ends as usual: menu and search closed, the page usable', (await state(page)).tour === 0 && !(await shown(page)).menu && !(await shown(page)).search && await usable(page));
    await ctx.close();
  });

  the('menu step over a form', async () => {
    const { ctx, page } = await existing();
    await addForm(page);
    await page.locator('.sheet .sheet-help').last().click(); await page.waitForSelector('.tour-card h2'); await sleep(300);
    await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet .card.tap', { hasText: 'Getting around' }).click();
    await page.waitForFunction(() => document.querySelector('.tour-card h2')?.textContent === 'The Rolodex', null, { timeout: 15000 }); await sleep(300);
    // What is drawn on top at the middle of the thing a step points at, the walkthrough's own layer aside.
    const onTop = sel => page.evaluate(sel => {
      const tour = document.querySelector('.tour'), layers = [document.getElementById('menuBack'), document.getElementById('searchBack'), ...document.querySelectorAll('.sheet-back')].filter(Boolean), was = layers.map(l => l.inert);
      tour.style.display = 'none'; layers.forEach(l => { l.inert = false; });
      const r = document.querySelector(sel).getBoundingClientRect(), el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 24));
      tour.style.display = ''; layers.forEach((l, i) => { l.inert = was[i]; });
      const z = x => Number(getComputedStyle(x).zIndex);
      return { top: el ? (el.closest('#menuBack') ? 'menu' : el.closest('#searchBack') ? 'search' : el.closest('.sheet-back') ? 'form' : el.tagName) : 'nothing', z: { menu: z(document.getElementById('menuBack')), search: document.getElementById('searchBack') ? z(document.getElementById('searchBack')) : null, sheet: z(document.querySelector('.sheet-back')), tour: z(tour) } };
    }, sel);
    ok('(Getting around, started from a form’s ?, is on its search step with the form still open)', (await toCard(page, 'What to type')) && (await state(page)).sheets === 1 && (await shown(page)).search);
    const s = await onTop('#searchInput');
    ok('the search panel a step points at is drawn above the form, and below the walkthrough', s.top === 'search' && s.z.search > s.z.sheet && s.z.search < s.z.tour, JSON.stringify(s));
    ok('(…and on to the step The menu)', (await toCard(page, 'The menu')) && (await shown(page)).menu);
    const m = await onTop('#menu .menu-list');
    ok('the menu a step points at is drawn above the form, and below the walkthrough', m.top === 'menu' && m.z.menu > m.z.sheet && m.z.menu < m.z.tour, JSON.stringify(m));
    await page.keyboard.press('Escape'); await sleep(300);
    const st = await state(page);
    ok('the form and what was typed in it survive the walkthrough', st.tour === 0 && st.sheets === 1 && st.typed === 'Robin Example' && st.appInert, JSON.stringify(st));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…and once it is closed the page is usable', (await state(page)).sheets === 0 && await usable(page));
    ok('a menu opened to be used is still under a sheet’s layer, as before (only one shown by a walkthrough is raised)', await page.evaluate(() => { const m = document.getElementById('menuBack'); return !m.classList.contains('shown') && Number(getComputedStyle(m).zIndex) === 90; }));
    await ctx.close();
  });

  /* ------------------------------- a tab still running the version before ------------------------------- */
  the('old tab writes its config back', async () => {
    const { ctx, page } = await existing({ old: true });
    const stale = await cfg(page); // the config a tab opened before the new PIN still holds in memory
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('(the offer is up, and a 12-digit PIN is set through it)', (await next(page)) === 'offer');
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    await page.locator('.pin-offer .pin-input').nth(0).fill(P12); await page.locator('.pin-offer .pin-input').nth(1).fill(P12); await page.locator('.pin-offer button[type=submit]').click();
    await app(page); await sleep(500);
    const mine = await cfg(page);
    // The other tab is any page of this site that does not run this version's lock: it writes what the published
    // version writes after a wrong PIN, its whole in-memory config with the count raised.
    const other = await ctx.newPage(); await other.goto(BASE + 'terms.html');
    await other.evaluate(c => localStorage.setItem('logi-lock', JSON.stringify({ ...c, attempts: 1, until: 0 })), stale);
    await sleep(500);
    const disk = await cfg(page), inMem = await mem(page);
    ok('a wrong PIN counted in a tab still running the version before does not put the old PIN back: the new one stays on the disk', disk.len === 12 && disk.max === 20 && disk.salt === mine.salt && disk.pin.ct === mine.pin.ct, JSON.stringify({ len: disk.len, max: disk.max, sameSalt: disk.salt === mine.salt }));
    ok('…and in this tab, with the wrong try counted', inMem.len === 12 && inMem.max === 20 && inMem.salt === mine.salt && disk.attempts === 1 && inMem.attempts === 1, JSON.stringify(inMem));
    await other.evaluate(c => localStorage.setItem('logi-lock', JSON.stringify({ ...c, autoLock: 5 })), stale); // a lock setting changed in that tab writes the same stale copy
    await sleep(500);
    ok('…nor does a lock setting changed in that tab, whose older count of wrong tries does not lower this one', (await cfg(page)).len === 12 && (await cfg(page)).max === 20 && (await mem(page)).len === 12 && (await cfg(page)).attempts === 1, JSON.stringify({ len: (await cfg(page)).len, max: (await cfg(page)).max, attempts: (await cfg(page)).attempts }));
    await other.close();
    await lockNow(page); await lockUp(page); await sleep(200);
    ok('the lock screen asks for the new PIN', (await dots(page)).n === 12);
    await page.keyboard.type(P12);
    ok('…which opens Vdex, with no second offer and the data all there', (await next(page)) === 'app' && (await bookings(page)) === 8 && (await cfg(page)).attempts === 0);
    await ctx.close();
  });

  /* ----------------------- the offer saves the PIN it checked, not what the field holds later ----------------------- */
  the('offer saves the checked PIN', async () => {
    const { ctx, page } = await existing();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true } });
    const mode = await page.evaluate(() => import('./js/lock.js').then(l => l.enrolBio()).catch(e => 'error: ' + e.message));
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    await lockNow(page); await lockUp(page);
    ok('(unlocked by fingerprint, so Set a new PIN asks for the current PIN and checks it first)', mode === 'prf' && (await next(page)) === 'offer', mode);
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(200);
    const f = n => page.locator('.pin-offer .pin-input').nth(n);
    await f(0).fill(OLD); await f(1).fill('482913'); await f(2).fill('482913');
    await slowPin(page, 1500);
    await page.locator('.pin-offer button[type=submit]').click(); await sleep(400);
    const busy = await page.evaluate(() => ({ save: document.querySelector('.pin-offer button[type=submit]').textContent, readOnly: [...document.querySelectorAll('.pin-offer .pin-input')].map(i => i.readOnly) }));
    ok('while the PIN is being saved the three fields cannot be typed in', busy.save === 'Saving…' && busy.readOnly.join() === 'true,true,true', JSON.stringify(busy));
    await f(1).focus(); await page.keyboard.type('7'); // a key pressed while it says Saving…
    const keyed = await f(1).inputValue();
    await page.evaluate(() => { document.querySelectorAll('.pin-offer .pin-input')[1].value = '4829137x'; }); // …and the field changed all the same, however that came about
    await page.waitForFunction(() => !document.querySelector('.pin-offer'), null, { timeout: 30000 }); await sleep(400);
    const c = await cfg(page), opens = pin => page.evaluate(p => import('./js/lock.js').then(l => l.checkPin(p)), pin);
    ok('a key pressed meanwhile changes nothing', keyed === '482913', keyed);
    ok('the PIN saved is the one that was checked and repeated, whatever the field held when the save got there', c.len === 6 && c.max === 20 && await opens('482913') && !(await opens('4829137x')), JSON.stringify({ len: c.len, max: c.max }));
    await ctx.close();
  });

  /* ------------------------- the PIN changes while a lock screen is up ------------------------- */
  the('pin saved under a lock screen', async () => {
    const { ctx, page } = await existing({ old: true });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('(the offer is up at the start)', (await next(page)) === 'offer');
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    await page.locator('.pin-offer .pin-input').nth(0).fill(P12); await page.locator('.pin-offer .pin-input').nth(1).fill(P12);
    await slowPin(page, 2000);
    await page.locator('.pin-offer button[type=submit]').click(); await sleep(200);
    await lockNow(page); await lockUp(page); // the lock comes up while the new PIN is still being saved
    const drawnWith = (await dots(page)).n;
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('logi-lock')).len === 12, null, { timeout: 30000 }); await sleep(300);
    ok('a lock screen that came up while a new PIN was being saved asks for the new PIN once it is saved', drawnWith === 6 && (await dots(page)).n === 12 && (await cfg(page)).max === 20, `${drawnWith} → ${(await dots(page)).n} dots`);
    await page.keyboard.type(P12);
    ok('…and the new PIN opens Vdex, with no second offer', (await next(page)) === 'app' && (await cfg(page)).attempts === 0 && (await bookings(page)) === 8, await lockSays(page));
    await ctx.close();
  });

  the('pin changed during a check', async () => {
    const { ctx, page: a } = await existing();
    await vaultWritten(a);
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await lockUp(b); await sleep(200);
    await slowPin(b, 3000);
    await b.keyboard.type('999999'); await sleep(300); // a mistyped PIN, still being checked…
    const checking = await lockSays(b);
    await a.bringToFront(); await a.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), P12); await sleep(300); // …when the PIN is changed in the other tab
    await b.bringToFront();
    const during = (await dots(b)).n;
    await b.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 });
    ok('a lock screen checking a PIN while the PIN is changed in another tab asks for the new one', checking === 'Checking…' && during === 12 && (await dots(b)).n === 12, `${checking} · ${during} dots`);
    await b.keyboard.type(P12);
    ok('…and opens with it', (await next(b)) === 'app' && (await bookings(b)) === 8);
    await ctx.close();
  });

  /* --------------------------- the app never starts behind a lock screen --------------------------- */
  the('lock over the start-up offer', async () => {
    const { ctx, page } = await existing({ old: true, patch: { autoLock: 0 } });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('(the offer is up at the start, ahead of the app)', (await next(page)) === 'offer' && (await page.locator('#rolodex .drum-btn').count()) === 0);
    const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
    await page.evaluate(() => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toast(n.textContent); }))).observe(document.body, { childList: true }));
    await setVis(page, true); await sleep(200); await setVis(page, false); // put away and brought back: Lock straight away
    await lockUp(page); await sleep(2500);
    const behind = await page.evaluate(() => ({ lock: document.querySelectorAll('.lock:not(.lock-setup)').length, offer: document.querySelectorAll('.pin-offer').length, drum: document.querySelectorAll('#rolodex .drum-btn').length, page: document.querySelectorAll('#page .page-card').length }));
    ok('a lock that comes up over the start-up offer takes the offer away and the app does not start behind the lock screen', behind.lock === 1 && behind.offer === 0 && behind.drum === 0 && behind.page === 0, JSON.stringify(behind));
    ok('…so nothing is said over the lock screen either', toasts.length === 0, toasts.join(' | '));
    await page.keyboard.type(OLD);
    ok('the next unlock brings the offer back, still ahead of the app', (await next(page)) === 'offer' && (await page.locator('#rolodex .drum-btn').count()) === 0);
    await page.getByRole('button', { name: 'Keep my current PIN' }).click();
    await app(page); await sleep(500);
    ok('…and its answer starts the app', (await cfg(page)).max === 20 && (await bookings(page)) === 8 && !(await page.evaluate(() => document.getElementById('app').inert)));
    await ctx.close();
  });

  /* ------------------------------ erased from another tab ------------------------------ */
  the('erase from another tab', async () => {
    const { ctx, page: a } = await existing();
    await vaultWritten(a);
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await lockUp(b); await sleep(300);
    await a.evaluate(() => { import('./js/lock.js').then(l => l.wipe('This device was erased. Link your storage or import a backup to get your data back.')); }).catch(() => {});
    await b.waitForSelector('.terms-gate', { timeout: 15000 }).catch(() => {}); await sleep(500);
    const st = await b.evaluate(() => ({ lock: document.querySelectorAll('.lock:not(.lock-setup)').length, gate: document.querySelectorAll('.terms-gate').length, keys: Object.keys(localStorage).filter(k => k.startsWith('logi-')) }));
    ok('a tab still at the lock screen it started with starts again when the device is erased in another tab: no lock screen is left to take the old PIN', st.lock === 0 && st.gate === 1, JSON.stringify(st));
    await b.keyboard.type(OLD); await sleep(1500);
    const later = await b.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('logi-')));
    ok('…and nothing of the erased data is written back', !later.includes('logi-vault') && !later.includes('logi-lock') && !later.includes('logi-db-v1'), later.join());
    await ctx.close();
  });

  /* ----------------------------------- Enter before the last digit ----------------------------------- */
  the('enter before the last digit', async () => {
    const { ctx, page } = await existing({ pin: P9, patch: { wipe: true } });
    await lockNow(page); await lockUp(page);
    await page.keyboard.type(P9.slice(0, 8)); await page.keyboard.press('Enter'); await sleep(900);
    const d = await dots(page);
    ok('Enter with one digit still to come sends nothing: no wrong PIN is counted and the digits stay', (await cfg(page)).attempts === 0 && d.on === 8 && (await lockSays(page)) === '' && (await state(page)).lock === 1, JSON.stringify(d) + ' ' + (await lockSays(page)));
    ok('…and a screen reader is told how far along the PIN is', (await heard(page)).text === '8 of 9', JSON.stringify(await heard(page)));
    await page.keyboard.type(P9.slice(8)); await lockGone(page);
    ok('…the last digit then opens Vdex', (await cfg(page)).attempts === 0);
    await ctx.close();
  });

  /* ------------------------------ wrong tries made in another tab ------------------------------ */
  the('wrong tries in another tab', async () => {
    const { ctx, page: a } = await existing({ patch: { wipe: true } });
    await vaultWritten(a);
    await a.reload(); await lockUp(a);
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await lockUp(b); await sleep(300);
    ok('(two tabs at their lock screens, nothing said yet)', (await lockSays(b)) === '' && (await lockSays(a)) === '');
    await a.bringToFront(); await a.keyboard.type('999999');
    await a.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 }); await sleep(300);
    ok('a wrong PIN in one tab is told on the other tab’s lock screen: the tries left before the erase', (await lockSays(b)) === '9 tries left before this device is erased.', await lockSays(b));
    // five wrong PINs in the other tab start a wait (written as that tab writes it, rather than typed five times)
    const write = patch => a.evaluate(p => { const c = JSON.parse(localStorage.getItem('logi-lock')); localStorage.setItem('logi-lock', JSON.stringify({ ...c, ...p })); }, patch);
    await write({ attempts: 5, until: Date.now() + 30000 }); await sleep(400);
    ok('a wait started in the other tab shows here, with its seconds and the tries left, instead of a keypad that does nothing with nothing said', /^Wrong PIN\. Try again in \d+ s\. 5 tries left before this device is erased\.$/.test(await lockSays(b)), await lockSays(b));
    await b.bringToFront(); await b.keyboard.type('123'); await sleep(200);
    ok('…the keypad waiting with it', (await dots(b)).on === 0);
    ok('…and a screen reader is told once, from inside the lock screen', /^Wrong PIN\. Wait \d+ seconds\. 5 tries left before this device is erased\.$/.test((await heard(b)).text) && (await heard(b)).reachable, JSON.stringify(await heard(b)));
    await write({ attempts: 9, until: 0 }); await sleep(400);
    ok('the last try before the erase is announced on this lock screen before it is used', (await lockSays(b)) === '1 try left before this device is erased.', await lockSays(b));
    await b.reload(); await lockUp(b); await sleep(300);
    ok('a lock screen drawn afresh says the tries left from the start', (await lockSays(b)) === '1 try left before this device is erased.' && (await heard(b)).text === '1 try left before this device is erased.', await lockSays(b));
    await b.keyboard.type(OLD); await lockGone(b); await sleep(400);
    ok('the right PIN opens Vdex and clears the count', (await cfg(b)).attempts === 0 && (await bookings(b)) === 8);
    await a.bringToFront(); await sleep(300);
    ok('…which the other tab’s lock screen takes too: its warning goes', (await lockSays(a)) === '', await lockSays(a));
    await ctx.close();
  });

  /* ------------------------------------ the offer and the terms ------------------------------------ */
  the('offer and the terms', async () => {
    const { ctx, page } = await existing({ old: true, patch: { autoLock: 0 }, terms: JSON.stringify({ v: '2025-01-01', at: '2025-01-02T12:00:00.000Z' }) });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD); await lockGone(page);
    await page.waitForSelector('.terms-gate'); await sleep(600);
    ok('(the terms have changed: they are asked first, with no offer)', /The terms have changed/.test(await page.locator('.terms-gate').innerText()) && (await page.locator('.pin-offer').count()) === 0);
    await setVis(page, true); await sleep(200); await setVis(page, false);
    await lockUp(page); await page.keyboard.type(OLD); await lockGone(page); await sleep(1500);
    const st = await page.evaluate(() => ({ offer: document.querySelectorAll('.pin-offer').length, gate: document.querySelectorAll('.terms-gate').length, gateInert: document.querySelector('.terms-gate')?.inert, terms: JSON.parse(localStorage.getItem('logi-terms')).v }));
    ok('an unlock while the terms are still to be agreed does not bring the offer over them', st.offer === 0 && st.gate === 1 && st.gateInert === false && st.terms === '2025-01-01', JSON.stringify(st));
    await page.locator('#terms-ok').check(); await page.locator('.terms-gate button[type=submit]').click();
    ok('the offer comes once the terms are agreed, ahead of the app', (await next(page)) === 'offer' && (await page.locator('#rolodex .drum-btn').count()) === 0 && (await page.locator('.terms-gate').count()) === 0);
    await page.getByRole('button', { name: 'Keep my current PIN' }).click(); await app(page); await sleep(400);
    ok('…and its answer starts the app', (await cfg(page)).max === 20 && !(await page.evaluate(() => document.getElementById('app').inert)));
    await ctx.close();
  });

  /* ----------------------------- a PIN the disk would not take is not set ----------------------------- */
  the('config that cannot be written', async () => {
    const { ctx, page } = await existing({ old: true });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('(the offer is up)', (await next(page)) === 'offer');
    const before = await cfg(page);
    // Storage full to the last characters: the config with the new PIN is a little longer than the one it replaces,
    // and the browser refuses it, while the vault, rewritten at the size it had, still fits.
    await page.evaluate(() => { const real = Storage.prototype.setItem; window.__full = true; Storage.prototype.setItem = function (k, v) { if (window.__full && k === 'logi-lock' && String(v).length > (this.getItem(k) || '').length) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return real.call(this, k, v); }; });
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    await page.locator('.pin-offer .pin-input').nth(0).fill(P12); await page.locator('.pin-offer .pin-input').nth(1).fill(P12); await page.locator('.pin-offer button[type=submit]').click();
    await page.waitForFunction(() => /Could not set the PIN/.test(document.querySelector('.pin-offer .lock-msg')?.textContent || '') || !document.querySelector('.pin-offer'), null, { timeout: 30000 }); await sleep(400);
    const said = await page.evaluate(() => document.querySelector('.pin-offer .lock-msg')?.textContent ?? '(the offer has gone)');
    const disk = await cfg(page), inMem = await mem(page);
    ok('a new PIN whose config the storage would not take is not reported as set: the offer stays and says so', said === 'Could not set the PIN: the browser storage is full' && !(await page.locator('.toast').allInnerTexts()).some(x => /PIN changed/.test(x)), said);
    ok('…the PIN on the disk and the PIN this tab holds are both still the old one', disk.len === 6 && disk.max === undefined && disk.salt === before.salt && inMem.len === 6 && inMem.max === undefined && inMem.salt === before.salt, JSON.stringify({ disk: { len: disk.len, max: disk.max }, mem: inMem }));
    ok('…which still opens the vault, and the fields can be typed in again', await page.evaluate(p => import('./js/lock.js').then(l => l.checkPin(p)), OLD) && !(await page.evaluate(() => [...document.querySelectorAll('.pin-offer .pin-input')].some(i => i.readOnly))));
    await page.evaluate(() => { window.__full = false; }); // space has been made
    await page.locator('.pin-offer button[type=submit]').click();
    await app(page); await sleep(500);
    ok('with room again the same PIN is saved, and the app starts', (await cfg(page)).len === 12 && (await cfg(page)).max === 20 && (await page.locator('.toast').allInnerTexts()).some(x => /PIN changed/.test(x)) && (await bookings(page)) === 8);
    await ctx.close();
  });

  /* ----------------------- what the lock screen says to a screen reader ----------------------- */
  the('lock screen live region', async () => {
    const { ctx, page } = await existing({ pin: P18, patch: { wipe: true } });
    await page.evaluate(() => import('./js/util.js').then(u => u.announce('Something the app said before it was locked'))); await sleep(150); // Vdex has been used: its shared live region exists
    await lockNow(page); await lockUp(page); await sleep(200);
    const shared = await page.evaluate(() => { const r = document.getElementById('sr-live'); return !!r && !!r.closest('[inert]'); });
    const h0 = await heard(page);
    ok('the lock screen has a live region of its own inside its card, which nothing makes inert (the app’s shared one is inert under the lock)', shared && h0.live === 'polite' && h0.reachable, JSON.stringify(h0));
    await page.keyboard.type(P18.slice(0, 8)); await sleep(200);
    const at8 = (await heard(page)).text;
    await page.keyboard.type(P18.slice(8, 11)); await sleep(200);
    const at11 = (await heard(page)).text;
    await page.keyboard.type(P18.slice(11, 12)); await sleep(200);
    const at12 = (await heard(page)).text;
    ok('with a long PIN, how many digits are in is said at every fourth digit', at8 === '8 of 18' && at11 === '8 of 18' && at12 === '12 of 18', [at8, at11, at12].join(' · '));
    await page.keyboard.press('Backspace'); await sleep(200);
    ok('…and whenever a digit is taken back', (await heard(page)).text === '11 of 18' && (await dots(page)).on === 11, (await heard(page)).text);
    ok('…never the digits themselves', !/\d{3}/.test((await heard(page)).text.replace(/\d+ of \d+/, '')));
    for (let i = 0; i < 11; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type(P18); await lockGone(page); await sleep(300);
    // a short PIN: every digit; and the wait after wrong PINs
    await page.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), OLD); await sleep(300);
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ attempts: 4 })));
    await lockNow(page); await lockUp(page); await sleep(200);
    await page.keyboard.type('99'); await sleep(200);
    const at2 = (await heard(page)).text;
    await page.keyboard.type('9'); await sleep(200);
    ok('with a PIN of up to ten digits it is said after every digit', at2 === '2 of 6' && (await heard(page)).text === '3 of 6', at2 + ' · ' + (await heard(page)).text);
    await page.keyboard.type('999'); // the fifth wrong PIN: a wait
    await page.waitForFunction(() => /Try again in/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 }); await sleep(200);
    const w = await heard(page), line = await page.evaluate(() => ({ text: document.querySelector('.lock-msg').textContent, live: document.querySelector('.lock-msg').getAttribute('aria-live') }));
    ok('the wait after wrong PINs is said once from inside the lock screen, where a screen reader hears it', /^Wrong PIN\. Wait \d+ seconds\. 5 tries left before this device is erased\.$/.test(w.text) && w.reachable, JSON.stringify(w));
    ok('…while the seconds ticking on screen are not read out one by one', /Try again in \d+ s\./.test(line.text) && line.live === 'off', JSON.stringify(line));
    await ctx.close();
  });

  const only = process.env.ONLY;
  for (const [name, fn] of cases) {
    if (only && !name.includes(only)) continue;
    try { await fn(); } catch (e) { console.log(`FAIL ${name}: the case stopped early — ` + String(e.stack || e.message).split('\n').slice(0, 3).join(' / ')); }
  }
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

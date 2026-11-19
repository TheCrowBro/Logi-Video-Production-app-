// What is underneath the lock screen and the offer of a longer PIN, and what the lock screen does when things change
// under it. A key pressed on the lock screen or the offer stays there: a form, the role menu or a walkthrough
// underneath is not closed or moved by it, and after the unlock the page is out of reach only while something is
// really open over it. A walkthrough step that shows the menu or the search shows it again after an unlock, and shows
// it above a form the walkthrough was started from. The lock screen follows a PIN changed under it, wrong tries made
// in another tab and an erase from another tab; the app never starts behind a lock screen; the offer never comes over
// the terms; a PIN the disk would not take is not reported as set; and what the lock screen says to a screen reader
// (the wait, how many digits are in) is said from inside it, where it can be heard. The two PIN fields do not take the
// cursor back from someone already in the second; arrow keys do not turn the Rolodex under a cover; Enter presses the
// lock screen's own buttons (never a digit key); and a sheet that code opens while a cover is up starts covered.
// And what is over what, beyond the lock: a tap beside a sheet on a touch screen presses nothing underneath; a
// walkthrough left while its next step is still being fetched leaves nothing open; the offer of a longer PIN closes
// the menu and the search it arrives over; a course asks before it closes a sheet that holds work without a box to
// type in; a file handed to Vdex waits for the PIN; a walkthrough that begins under the lock screen starts covered;
// and the keyboard focus goes back to where it was once the lock screen has gone.
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
  const existing = async ({ pin = OLD, old = false, patch = null, terms = null, options = {} } = {}) => {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1, ...options });
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
    const titles = () => page.evaluate(() => [...document.querySelectorAll('.sheet')].map(x => x.getAttribute('aria-label')));
    const course = () => page.locator('.sheet .card.tap', { hasText: 'Quotes & invoices, start to finish' }).click();
    // A course closes every sheet on its way, the form it was reached from included: that is said before it starts.
    await course(); await sleep(400);
    const asked = { titles: await titles(), text: await page.locator('.sheet').last().locator('.sheet-body p').innerText().catch(() => ''), buttons: await page.locator('.sheet').last().locator('.actions button').allInnerTexts().catch(() => []), tour: (await state(page)).tour };
    ok('a course chosen over an open form says first that the form would be closed and what was typed lost, in one sentence with two buttons', asked.titles.join('|') === 'Add trusted crew|Tutorials|A form is still open' && asked.text === 'This walkthrough closes “Add trusted crew”, and anything typed in it that is not saved would be lost.' && asked.buttons.join('|') === 'Back to the form|Close it and carry on' && asked.tour === 0, JSON.stringify(asked));
    await page.locator('.sheet').last().locator('button', { hasText: 'Back to the form' }).click(); await sleep(300);
    const back = { titles: await titles(), ...(await state(page)) };
    ok('Back to the form goes back to it: the form is the only sheet, what was typed is in it, the cursor is in it, and no course runs', back.titles.join('|') === 'Add trusted crew' && back.typed === 'Robin Example' && back.focus === 'sheet' && back.tour === 0 && await page.locator('.sheet form [data-key="name"]').fill('Robin Example-Hale', { timeout: 2500 }).then(() => true, () => false), JSON.stringify(back));
    // A page's own tutorial closes nothing, so it asks nothing and the form stays under it.
    await page.locator('.sheet .sheet-help').last().click(); await page.waitForSelector('.tour-card h2'); await sleep(300);
    await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet .card.tap', { hasText: /^Equipment$/ }).click(); await page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(900);
    const plain = { titles: await titles(), ...(await state(page)) };
    ok('a page’s own tutorial, which closes nothing, starts without asking and leaves the form as it is', plain.titles.join('|') === 'Add trusted crew' && plain.tour === 1 && plain.typed === 'Robin Example-Hale', JSON.stringify(plain));
    // …and from its first card the way to the course is the same, this time carried on with.
    await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet .card.tap');
    await course(); await sleep(400);
    await page.locator('.sheet').last().locator('button', { hasText: 'Close it and carry on' }).click();
    await page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(300);
    const on = { card: await card(page), ...(await state(page)) };
    ok('Close it and carry on closes the form and starts the course', on.sheets === 0 && on.tour === 1 && on.card === 'Quotes and invoices, start to finish', JSON.stringify(on));
    for (let i = 0; i < 4; i++) await nextCard(page);
    await sleep(300);
    await page.keyboard.press('Escape'); await sleep(300);
    const st = await state(page);
    ok('when a course started from a form ends, the page is usable: the form is gone, so nothing is out of reach', st.tour === 0 && st.sheets === 0 && !st.appInert && await usable(page), JSON.stringify(st));
    // with no form open there is nothing to ask
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openChooser())); await page.waitForSelector('.sheet .card.tap');
    await course(); await page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(300);
    ok('with no form open the course starts straight away, as before', (await state(page)).sheets === 0 && (await card(page)) === 'Quotes and invoices, start to finish');
    await page.keyboard.press('Escape'); await sleep(300);
    // the same question before the set-up walkthrough and the practice job, which close sheets too
    await addForm(page, 'Robin Example');
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openChooser())); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet button', { hasText: 'The set-up walkthrough again' }).click(); await sleep(400);
    const setUp = await page.locator('.sheet').last().locator('.sheet-body p').innerText().catch(() => '');
    await page.locator('.sheet').last().locator('button', { hasText: 'Back to the form' }).click(); await sleep(300);
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openMoneyGuide())); await page.waitForSelector('.sheet .money-guide-body');
    await page.locator('.sheet button', { hasText: 'Open the practice job' }).click(); await sleep(400);
    const job = await page.locator('.sheet').last().locator('.sheet-body p').first().innerText().catch(() => '');
    await page.locator('.sheet').last().locator('button', { hasText: 'Back to the form' }).click(); await sleep(300);
    const end = { titles: await titles(), ...(await state(page)) };
    ok('the set-up walkthrough and the practice job ask the same before they close a form, and going back keeps it', setUp === 'The set-up walkthrough closes “Add trusted crew”, and anything typed in it that is not saved would be lost.' && job === 'Opening the practice job closes “Add trusted crew”, and anything typed in it that is not saved would be lost.' && end.titles.join('|') === 'Add trusted crew' && end.typed === 'Robin Example' && end.tour === 0 && !(await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.some(b => b.practice)))), JSON.stringify([setUp, job, end]));
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
    await lockNow(page); await lockUp(page); await sleep(200);
    ok('the lock screen asks for the new PIN', (await dots(page)).n === 12);
    await page.keyboard.type(P12);
    ok('…which opens Vdex, with no second offer and the data all there', (await next(page)) === 'app' && (await bookings(page)) === 8 && (await cfg(page)).attempts === 0);
    // This tab restarted: which PINs its PIN replaced is kept in the config, so the old copy is still known for what it is.
    await page.reload(); await lockUp(page); await page.keyboard.type(P12);
    const restarted = await next(page);
    await other.evaluate(c => localStorage.setItem('logi-lock', JSON.stringify({ ...c, attempts: 2, until: 0 })), stale);
    await sleep(500);
    ok('…and it is the same after this tab has been restarted', restarted === 'app' && (await cfg(page)).len === 12 && (await cfg(page)).salt === mine.salt && (await cfg(page)).attempts === 2 && (await mem(page)).len === 12, JSON.stringify(await mem(page)));
    // A PIN set in that tab (Change PIN… there) is not its old copy written back: it is the PIN now, in this tab too.
    // Written as the version before writes it: the same data key under the new PIN, in the config it started with.
    const NEW8 = '87654321';
    const changed = await page.evaluate(async ([c, oldPin, newPin]) => { // worked out here (the other page runs no scripts of the app), written there
      const C = await import('./js/crypto.js');
      const raw = await C.decrypt(await C.pbkdf2Key(oldPin, C.fromB64(c.salt), c.iter), c.pin), salt = C.bytes(16);
      const pin = await C.encrypt(await C.pbkdf2Key(newPin, salt, c.iter), raw);
      return { ...c, salt: C.toB64(salt), pin, len: newPin.length, attempts: 0, until: 0 };
    }, [stale, OLD, NEW8]);
    await other.evaluate(c => localStorage.setItem('logi-lock', JSON.stringify(c)), changed);
    await sleep(500);
    const taken = await cfg(page), held = await mem(page);
    ok('a PIN newly set in the tab still running the version before is taken, as a PIN set in any other tab is: it is not put back to the one before', taken.len === 8 && taken.max === undefined && taken.salt !== mine.salt && held.len === 8 && held.salt === taken.salt, JSON.stringify({ disk: { len: taken.len, max: taken.max }, mem: held }));
    await lockNow(page); await lockUp(page); await sleep(200);
    const asked = (await dots(page)).n;
    await page.keyboard.type(NEW8); await lockGone(page);
    const offered = await page.waitForSelector('.pin-offer', { timeout: 15000 }).then(() => true, () => false);
    ok('…the lock screen asks for it, it opens Vdex, and as it was chosen under the old rule the longer PIN is offered again', asked === 8 && offered, `${asked} dots`);
    await page.getByRole('button', { name: 'Keep my current PIN' }).click(); await sleep(500);
    ok('…with the data all there', (await bookings(page)) === 8 && (await cfg(page)).max === 20 && (await cfg(page)).len === 8);
    // A write made from the config as it stood before a PIN change, landing after the change (its tab had not heard of
    // the change yet), carries max and the PIN that was replaced: it does not undo the change either.
    const x1 = await cfg(page);
    await page.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), P9); await sleep(400);
    const x2 = await cfg(page);
    await other.evaluate(c => localStorage.setItem('logi-lock', JSON.stringify({ ...c, attempts: 1 })), x1);
    await sleep(500);
    const end = await cfg(page);
    ok('a write that crossed a PIN change, made from the config as it was before it, does not put the replaced PIN back', x2.len === 9 && end.salt === x2.salt && end.len === 9 && end.attempts === 1 && (await mem(page)).salt === x2.salt, JSON.stringify({ len: end.len, attempts: end.attempts, same: end.salt === x2.salt }));
    await other.close();
    await ctx.close();
  });

  // A new PIN whose vault could not be written is taken back (setPin puts the config before it back). Another tab has
  // taken the new config by then, and must take the one before back too: to that tab it is a PIN that was replaced.
  the('pin taken back in one of two tabs', async () => {
    const { ctx, page: a } = await existing();
    await vaultWritten(a);
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await unlock(b); await app(b); await sleep(400);
    const before = await cfg(a);
    await a.bringToFront();
    // In this tab the vault cannot be written (the storage is full), and encrypting takes a moment, as on a phone.
    await a.evaluate(() => {
      const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'logi-vault') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return set.call(this, k, v); };
      const enc = SubtleCrypto.prototype.encrypt; SubtleCrypto.prototype.encrypt = function (...x) { return new Promise(r => setTimeout(r, 1500)).then(() => enc.apply(this, x)); };
    });
    await a.evaluate(p => { window.__set = import('./js/lock.js').then(l => l.setPin(p)).then(() => 'set', e => String(e.message || e)); }, P12);
    const tookNew = await b.waitForFunction(() => import('./js/lock.js').then(l => l.config().len === 12), null, { timeout: 10000, polling: 100 }).then(() => true, () => false);
    const said = await a.evaluate(() => window.__set);
    await sleep(600);
    const disk = await cfg(a), inA = await mem(a), inB = await mem(b);
    ok('a new PIN whose vault could not be written is not set, and the tab that tried says so', /could not be saved/.test(said) && disk.salt === before.salt && disk.len === 6 && inA.salt === before.salt, said);
    ok('…and the other tab, which had taken the new PIN meanwhile, goes back to the one before with it', tookNew && inB.salt === before.salt && inB.len === 6 && (await cfg(b)).pin.ct === before.pin.ct, JSON.stringify({ tookNew, inB }));
    await b.bringToFront(); await lockNow(b); await lockUp(b); await sleep(200);
    const asked = (await dots(b)).n;
    await b.keyboard.type(OLD); await lockGone(b); await sleep(300);
    ok('…so the PIN there was still opens Vdex there', asked === 6 && (await bookings(b)) === 8, `${asked} dots`);
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

  /* ------------------- the two PIN fields: the cursor is not taken from the second one ------------------- */
  the('pin fields keep the cursor', async () => {
    const { ctx, page } = await existing();
    // Change PIN… and Set a PIN… ask in this sheet. It puts the cursor in the first field a moment after it opens.
    const ask = () => page.evaluate(() => import('./js/lock.js').then(l => { window.__asked = l.askSecret({ title: 'New PIN', confirm: true }); }));
    await ask(); await page.waitForSelector('.sheet .pin-input');
    const first = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 200)); return document.activeElement.getAttribute('aria-label'); });
    ok('the sheet that asks for a new PIN puts the cursor in the first field', first === 'New PIN', first);
    await page.keyboard.press('Escape'); await sleep(200);
    // Someone (or a password manager) who is in the second field before that moment keeps the cursor there.
    const kept = await page.evaluate(async () => { const l = await import('./js/lock.js'); window.__asked = l.askSecret({ title: 'New PIN', confirm: true }); const [a, b] = document.querySelectorAll('.sheet .pin-input'); b.focus(); await new Promise(r => setTimeout(r, 200)); return { at: document.activeElement === b ? 'second' : document.activeElement === a ? 'first' : document.activeElement.tagName }; });
    await page.keyboard.insertText(P9); // goes where the cursor is, as typing and Playwright's fill() do
    const vals = await page.evaluate(() => [...document.querySelectorAll('.sheet .pin-input')].map(i => i.value));
    ok('…and leaves it alone when it is already in the second field: what is typed next lands there, not in the first', kept.at === 'second' && vals[0] === '' && vals[1] === P9, JSON.stringify([kept, vals]));
    await page.keyboard.press('Escape'); await sleep(200);
    await ctx.close();
    // The first-start set-up has the same two fields and the same moment.
    const c2 = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
    await c2.addInitScript(t => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); }, TERMS_RECORD);
    await c2.addInitScript(() => { const mo = new MutationObserver(() => { const f = document.querySelectorAll('.lock-setup .pin-input'); if (f.length === 2) { mo.disconnect(); f[1].focus(); window.__early = document.activeElement === f[1]; } }); mo.observe(document, { childList: true, subtree: true }); });
    const p2 = await c2.newPage(); watch(p2);
    await p2.goto(BASE); await p2.waitForSelector('.lock-setup .pin-input'); await sleep(300);
    const setUp = await p2.evaluate(() => { const f = document.querySelectorAll('.lock-setup .pin-input'); return { early: window.__early, at: document.activeElement === f[1] ? 'second' : document.activeElement === f[0] ? 'first' : document.activeElement.tagName }; });
    ok('the PIN set-up at a first start leaves the cursor in the second field too, when it is there already', setUp.early === true && setUp.at === 'second', JSON.stringify(setUp));
    await c2.close();
  });

  /* ----------------------------- arrow keys do not turn the Rolodex underneath ----------------------------- */
  the('arrows under a cover', async () => {
    const { ctx, page } = await existing();
    const section = () => page.evaluate(() => window.logiPage());
    await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
    await lockNow(page); await lockUp(page);
    for (const k of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) { await page.keyboard.press(k); await sleep(120); }
    await sleep(500);
    ok('arrow keys on the lock screen do not turn the Rolodex behind it', (await section()) === 'bookings' && (await state(page)).lock === 1, await section());
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    ok('…so after the PIN the section that was open is still the one open', (await section()) === 'bookings' && (await page.locator('#rolodex .tab[aria-selected="true"]').getAttribute('aria-label')).startsWith('Bookings'), await section());
    await page.keyboard.press('ArrowRight'); await sleep(700);
    ok('…and the arrow keys turn it again once the page is back', (await section()) === 'crew', await section());
    // under a walkthrough: left and right move its cards, and up and down belong to nothing underneath
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
    const at = await section();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await sleep(700);
    ok('under a walkthrough the up and down arrows do not turn it either', (await section()) === at && (await state(page)).tour === 1, `${at} → ${await section()}`);
    await page.keyboard.press('Escape'); await sleep(300);
    // under the offer of a longer PIN
    await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    await lockNow(page); await unlock(page); await page.waitForSelector('.pin-offer', { timeout: 10000 }); await sleep(300);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await sleep(600);
    ok('…nor on the offer of a longer PIN', (await section()) === 'bookings' && (await state(page)).offer === 1, await section());
    await page.keyboard.press('Escape'); await sleep(300);
    ok('…and the page is usable afterwards', await usable(page));
    await ctx.close();
  });

  /* ------------------------------ Enter presses the lock screen's own buttons ------------------------------ */
  the('enter on the lock buttons', async () => {
    // A fingerprint is "enrolled" so the two fingerprint buttons are on the screen; the device's own prompt is stood
    // in for, and says no every time, so only how often it was asked for counts.
    const { ctx, page } = await existing({ patch: { bio: { id: 'AAAA', pub: null, alg: null, mode: 'device', prfSalt: 'AAAA', wrap: null } } });
    await page.evaluate(() => { window.__bio = 0; navigator.credentials.get = () => { window.__bio++; return Promise.reject(Object.assign(new Error('not now'), { name: 'NotAllowedError' })); }; window.__confirms = []; window.confirm = m => { window.__confirms.push(m); return false; }; });
    await lockNow(page); await lockUp(page); await sleep(700); // the screen asks for the fingerprint once by itself
    const asked0 = await page.evaluate(() => window.__bio);
    const forgot = () => page.evaluate(() => ({ open: !document.getElementById('lock-forgot').hidden, said: document.querySelector('.lock .btn[aria-controls="lock-forgot"]').getAttribute('aria-expanded') }));
    await page.locator('.lock .btn[aria-controls="lock-forgot"]').focus(); await page.keyboard.press('Enter'); await sleep(150);
    const f1 = await forgot();
    ok('Enter on Forgot PIN? opens it, as Space does', f1.open && f1.said === 'true', JSON.stringify(f1));
    await page.locator('.lock-forgot button', { hasText: 'Erase this device' }).focus(); await page.keyboard.press('Enter'); await sleep(150);
    ok('Enter on Erase this device asks the question (answered no here, and nothing is erased)', (await page.evaluate(() => window.__confirms.join('|'))) === 'Erase all Vdex data on this device?' && !!(await ls(page, 'logi-vault')) && (await state(page)).lock === 1, await page.evaluate(() => window.__confirms.join('|')));
    await page.locator('.lock-forgot button', { hasText: 'Keep trying' }).focus(); await page.keyboard.press('Enter'); await sleep(150);
    const f2 = await forgot();
    ok('Enter on Keep trying closes it again', !f2.open && f2.said === 'false', JSON.stringify(f2));
    await page.locator('.lock .lock-bio').focus(); await page.keyboard.press('Enter'); await sleep(250);
    const asked1 = await page.evaluate(() => window.__bio);
    await page.locator('.lock .keypad .key[aria-label="Unlock with fingerprint or face"]').focus(); await page.keyboard.press('Enter'); await sleep(250);
    const asked2 = await page.evaluate(() => window.__bio);
    ok('Enter on Use fingerprint or face, and on the keypad’s fingerprint key, asks the device', asked0 === 1 && asked1 === 2 && asked2 === 3, [asked0, asked1, asked2].join(','));
    // what the Enter key is kept from: the keys that put a digit in or take one out
    await page.locator('.lock .key[aria-label="5"]').focus(); await page.keyboard.type('24'); await page.keyboard.press('Enter'); await sleep(300);
    const d1 = await dots(page);
    await page.locator('.lock .key[aria-label="Delete"]').focus(); await page.keyboard.press('Enter'); await sleep(300);
    const d2 = await dots(page);
    ok('Enter with a digit key or ⌫ in focus still presses neither: the digits typed stay as they are', d1.on === 2 && d2.on === 2, JSON.stringify([d1, d2]));
    ok('…and before the last digit it still sends nothing: no wrong PIN is counted', (await cfg(page)).attempts === 0 && (await state(page)).lock === 1 && (await heard(page)).text === '2 of 6', JSON.stringify(await heard(page)));
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    ok('the PIN still unlocks afterwards', (await state(page)).lock === 0 && await usable(page));
    await ctx.close();
  });

  /* --------------------------- a sheet that code opens while a cover is up --------------------------- */
  the('sheet opened under a cover', async () => {
    const { ctx, page } = await existing();
    // What a save that finishes, or a file that arrives, does while the lock screen is up: it opens a sheet.
    const openSheet = title => page.evaluate(t => import('./js/util.js').then(u => { const box = document.createElement('div'); const i = document.createElement('input'); i.setAttribute('aria-label', 'A field'); box.append(i); u.sheet(t, box); }), title);
    const sheetState = () => page.evaluate(() => [...document.querySelectorAll('.sheet-back')].map(b => ({ title: b.querySelector('.sheet').getAttribute('aria-label'), inert: b.inert, seen: getComputedStyle(b).visibility !== 'hidden' })));
    await lockNow(page); await lockUp(page);
    await openSheet('Opened under the lock'); await sleep(200);
    const under = await sheetState(), st = await state(page);
    ok('a sheet opened by code while the lock screen is up starts out of reach and out of sight, and the focus stays on the lock screen', under.length === 1 && under[0].inert && !under[0].seen && st.focus === 'lock' && st.appInert, JSON.stringify([under, st]));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('Escape on the lock screen does not close it', (await sheetState()).length === 1 && (await state(page)).lock === 1);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    const after = await sheetState();
    ok('after the PIN it is there to see and to use', after.length === 1 && !after[0].inert && after[0].seen && (await state(page)).appInert && await page.locator('.sheet input[aria-label="A field"]').fill('typed after the unlock', { timeout: 2500 }).then(() => true, () => false), JSON.stringify(after));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…Escape closes it then, and the page is usable', (await sheetState()).length === 0 && await usable(page), JSON.stringify(await state(page)));
    // over a form that was open already: after the unlock both are back, the newer one on top
    await addForm(page);
    await lockNow(page); await lockUp(page);
    await openSheet('Opened over the form'); await sleep(200);
    await page.keyboard.press('Escape'); await sleep(200);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(300);
    const two = await sheetState();
    ok('with a form open before the lock, both come back, and Escape closes the newer one first', two.length === 2 && two.every(x => !x.inert && x.seen) && two[1].title === 'Opened over the form' && (await state(page)).typed === 'Robin Example', JSON.stringify(two));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…then the form, with what was typed still in it', (await sheetState()).length === 1 && (await state(page)).typed === 'Robin Example');
    await page.keyboard.press('Escape'); await sleep(250);
    // under the offer of a longer PIN
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    await lockNow(page); await unlock(page); await page.waitForSelector('.pin-offer', { timeout: 10000 }); await sleep(300);
    await openSheet('Opened under the offer'); await sleep(200);
    const underOffer = await sheetState();
    await page.keyboard.press('Escape'); await sleep(350); // on the offer: keeps the PIN, closes the offer only
    const kept = await sheetState();
    ok('the same under the offer of a longer PIN: out of reach while it is up, untouched by its Escape, usable after it', underOffer.length === 1 && underOffer[0].inert && !underOffer[0].seen && (await state(page)).offer === 0 && kept.length === 1 && !kept[0].inert && kept[0].seen && await page.locator('.sheet input[aria-label="A field"]').fill('typed after the offer', { timeout: 2500 }).then(() => true, () => false), JSON.stringify([underOffer, kept]));
    await page.keyboard.press('Escape'); await sleep(250);
    ok('…and once it is closed the page is usable', (await sheetState()).length === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  /* ------------------------------ a tap beside a sheet, on a touch screen ------------------------------ */
  the('tap beside a sheet', async () => {
    const { ctx, page } = await existing({ options: { hasTouch: true, isMobile: true } });
    // A short sheet, as a link's preview or "Add to calendar" is: most of the page shows, dimmed, above it.
    const short = () => page.evaluate(() => import('./js/util.js').then(u => { u.sheet('A short sheet', u.h('p', null, 'The page shows above this sheet.')); }));
    const point = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, on: document.elementFromPoint(x, y).className }; }, sel);
    const tapOver = async sel => { await short(); await sleep(350); const p = await point(sel); await page.touchscreen.tap(p.x, p.y); await sleep(500); return p.on; };
    const on1 = await tapOver('#menuBtn'), s1 = { ...(await state(page)), ...(await shown(page)) };
    ok('one tap beside a sheet, where the hamburger lies underneath, closes the sheet and does nothing else: the menu does not open', on1 === 'sheet-back' && s1.sheets === 0 && !s1.menu && !s1.appInert, JSON.stringify([on1, s1]));
    const on2 = await tapOver('#lockBtn'), s2 = await state(page);
    ok('…where the lock button lies underneath, Vdex is not locked', on2 === 'sheet-back' && s2.sheets === 0 && s2.lock === 0, JSON.stringify([on2, s2]));
    const was = await page.evaluate(() => window.logiPage());
    const on3 = await tapOver('#rolodex .drum-btn.down'), s3 = { ...(await state(page)), section: await page.evaluate(() => window.logiPage()) };
    ok('…and where the Rolodex lies underneath, the section stays the one that was open', on3 === 'sheet-back' && s3.sheets === 0 && s3.section === was, JSON.stringify([on3, was, s3]));
    // with a mouse: a click beside it still closes it; a press that begins in the sheet and ends beside it does not
    await short(); await sleep(350);
    const box = await page.locator('.sheet').boundingBox(), x = box.x + box.width / 2;
    await page.mouse.move(x, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(x, box.y - 60, { steps: 4 }); await page.mouse.up(); await sleep(300);
    const dragged = (await state(page)).sheets;
    await page.mouse.click(x, box.y - 60); await sleep(300);
    ok('a press that begins inside the sheet and ends beside it leaves the sheet open; a click beside it closes it', dragged === 1 && (await state(page)).sheets === 0, `after the drag: ${dragged} sheet`);
    await ctx.close();
  });

  /* --------------------- a walkthrough left while its next step is still on its way --------------------- */
  the('walkthrough left mid-step', async () => {
    // The search and the menu are fetched the first time they are used: here that takes over a second.
    const slow = (ctx, file) => ctx.route('**/js/' + file, async r => { await sleep(1200); await r.continue().catch(() => {}); });
    const leave = async page => { await page.locator('.tour-card .btn.primary').click(); await sleep(150); await page.locator('.tour-card button', { hasText: 'Skip' }).click(); await sleep(2200); };
    const A = await existing();
    await slow(A.ctx, 'search.js');
    await A.page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await A.page.waitForSelector('.tour-card h2'); await sleep(300);
    ok('(Getting around is on the card before the one that shows the search)', await toCard(A.page, 'Search everything'));
    await leave(A.page); // Next, and Skip while the search is still being fetched
    const st = { ...(await state(A.page)), ...(await shown(A.page)) };
    ok('a walkthrough left while its next step was still fetching the search leaves nothing open: no panel appears afterwards, and the page is in reach', st.tour === 0 && !st.search && !st.appInert && await usable(A.page), JSON.stringify(st));
    await A.page.keyboard.press('/'); await sleep(700);
    ok('…and the search still opens when it is asked for', (await shown(A.page)).search && await A.page.evaluate(() => (document.activeElement || {}).id === 'searchInput'));
    await A.ctx.close();
    // the same for the menu, here with the walkthrough started from a form's ?
    const B = await existing();
    await slow(B.ctx, 'menu.js');
    await addForm(B.page);
    await B.page.locator('.sheet .sheet-help').last().click(); await B.page.waitForSelector('.tour-card h2'); await sleep(300);
    await B.page.getByRole('button', { name: 'Other pages…' }).click(); await B.page.waitForSelector('.sheet .card.tap');
    await B.page.locator('.sheet .card.tap', { hasText: 'Getting around' }).click(); await B.page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(300);
    ok('(Getting around, started from a form’s ?, is on the card before the first one that shows the menu)', await toCard(B.page, 'What comes back'));
    await leave(B.page);
    const sm = { ...(await state(B.page)), ...(await shown(B.page)) };
    ok('…left while the menu was still being fetched, no menu is drawn over the form afterwards, and the form can be used', sm.tour === 0 && !sm.menu && sm.sheets === 1 && sm.typed === 'Robin Example' && await B.page.locator('.sheet form [data-key="name"]').fill('Robin Example-Hale', { timeout: 2500 }).then(() => true, () => false), JSON.stringify(sm));
    await B.page.keyboard.press('Escape'); await sleep(250);
    ok('…and once the form is closed the page is usable', (await state(B.page)).sheets === 0 && await usable(B.page), JSON.stringify(await state(B.page)));
    await B.ctx.close();
    // a step that prepares something first (it goes to Settings and opens a section) does not do so after Skip
    const C = await existing();
    await C.page.evaluate(() => import('./js/tutorials.js').then(m => m.openChooser())); await C.page.waitForSelector('.sheet .card.tap');
    await C.page.locator('.sheet .card.tap', { hasText: 'Quotes & invoices, start to finish' }).click(); await C.page.waitForSelector('.tour-card h2', { timeout: 15000 }); await sleep(600);
    ok('(the money course is on the card before the one that opens a Settings section)', await toCard(C.page, 'How it works'));
    await C.page.locator('.tour-card .btn.primary').click(); await sleep(150); await C.page.locator('.tour-card button', { hasText: 'Skip' }).click(); await sleep(1800);
    const opened = await C.page.evaluate(() => { const d = document.querySelector('#page details[data-s="Quotes & invoices"]'); return d ? d.open : 'not there'; });
    ok('a step left during its wait does not run what it had prepared to do: the Settings section it opens stays shut', (await state(C.page)).tour === 0 && opened !== true && await usable(C.page), String(opened));
    await C.ctx.close();
    // What the person opens themselves while the left step's file is still on its way is theirs: the late step neither
    // closes it nor puts its own panel over it. Next, Skip, and then, before the search has arrived:
    const late = async after => {
      const D = await existing();
      await D.page.locator('#menuBtn').click(); await D.page.locator('#menu').waitFor({ state: 'visible' }); await D.page.keyboard.press('Escape'); await sleep(200); // the menu has been used before: its file is here
      await D.ctx.route('**/js/search.js', async r => { await sleep(1500); await r.continue().catch(() => {}); });
      await D.page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await D.page.waitForSelector('.tour-card h2'); await sleep(300);
      const on = await toCard(D.page, 'Search everything');
      await D.page.locator('.tour-card .btn.primary').click(); await sleep(150); await D.page.locator('.tour-card button', { hasText: 'Skip' }).click(); await sleep(150);
      const out = await after(D.page);
      await D.ctx.close();
      return { on, ...out };
    };
    const drawn = pg => pg.evaluate(() => { const s = document.getElementById('searchBack'); return !!s && !s.hidden; });
    const menu = await late(async pg => {
      await pg.locator('#menuBtn').click(); await pg.locator('#menu').waitFor({ state: 'visible' }); await sleep(200);
      const before = (await shown(pg)).menu; await sleep(2000);
      return { before, after: (await shown(pg)).menu, inMenu: await pg.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#menu')), search: await drawn(pg) };
    });
    ok('the menu opened by hand after leaving a walkthrough is not closed when the left step’s file arrives', menu.on && menu.before && menu.after && menu.inMenu && !menu.search, JSON.stringify(menu));
    const slash = await late(async pg => {
      await pg.keyboard.press('/'); await sleep(2300);
      return { search: (await shown(pg)).search, typing: await pg.evaluate(() => (document.activeElement || {}).id === 'searchInput'), inReach: await pg.evaluate(() => { const s = document.getElementById('searchBack'); return !!s && !s.inert; }) };
    });
    ok('…the search asked for with / in that moment opens, for use, with the cursor in its box', slash.on && slash.search && slash.typing && slash.inReach, JSON.stringify(slash));
    const other = await late(async pg => {
      await pg.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('gear'))); await pg.waitForSelector('.tour-card h2'); await sleep(2600);
      return { card: await card(pg), search: await drawn(pg), tour: (await state(pg)).tour };
    });
    ok('…and another walkthrough started in that moment does not get the left one’s search drawn over it', other.on && other.tour === 1 && !!other.card && other.card !== 'What to type' && !other.search, JSON.stringify(other));
  });

  /* ------------------- the offer of a longer PIN arriving over the open menu or search ------------------- */
  the('offer over the menu', async () => {
    for (const what of ['menu', 'search']) {
      const { ctx, page } = await existing();
      await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined }))); // the config as an older version left it
      // The offer's file is a moment late, so the person has opened the menu (or the search) by the time it comes up.
      let release; const held = new Promise(r => { release = r; });
      await ctx.route('**/js/pin-offer.js', async r => { await held; await r.continue().catch(() => {}); });
      await lockNow(page); await unlock(page);
      if (what === 'menu') { await page.locator('#menuBtn').click(); await page.locator('#menu').waitFor({ state: 'visible' }); } else { await page.keyboard.press('/'); await page.waitForSelector('#searchInput', { timeout: 8000 }); }
      await sleep(300);
      const open = (await shown(page))[what];
      release(); await page.waitForSelector('.pin-offer', { timeout: 10000 }); await sleep(300);
      const under = { ...(await state(page)), ...(await shown(page)) };
      ok(`the offer of a longer PIN arriving over the open ${what} closes it first, as the lock screen does`, open && under.offer === 1 && !under[what] && under.focus === 'lock', JSON.stringify(under));
      await page.keyboard.press('Escape'); await sleep(350);
      const st = { ...(await state(page)), ...(await shown(page)) };
      ok('…so Escape answers the offer (the PIN is kept) and leaves nothing open behind it', st.offer === 0 && (await cfg(page)).max === 20 && !st.menu && !st.search && !st.appInert && await usable(page), JSON.stringify(st));
      await ctx.close();
    }
    // over a walkthrough card that points into the menu: the menu is shown again for the card once the offer is answered
    const { ctx, page } = await existing();
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
    ok('(Getting around is on its menu step, the menu shown)', (await toCard(page, 'How syncing is going')) && (await shown(page)).menu);
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    let release; const held = new Promise(r => { release = r; });
    await ctx.route('**/js/pin-offer.js', async r => { await held; await r.continue().catch(() => {}); });
    await lockNow(page); await unlock(page); await sleep(700);
    release(); await page.waitForSelector('.pin-offer', { timeout: 10000 }); await sleep(300);
    await page.keyboard.press('Escape'); await sleep(1000);
    const st = { ...(await state(page)), ...(await shown(page)), card: await card(page), onNext: await page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest('.tour-card') && a.classList.contains('primary'); }), pointsAt: await page.evaluate(() => { const el = document.getElementById('menuStatus'); return !!el && el.offsetParent !== null; }) };
    ok('an offer answered over a walkthrough card that points into the menu leaves the menu shown for that card again, with the focus on the card', st.offer === 0 && st.tour === 1 && st.menu && st.pointsAt && st.card === 'How syncing is going' && st.onNext, JSON.stringify(st));
    await page.keyboard.press('Escape'); await sleep(300);
    ok('…and when the walkthrough ends the page is usable', (await state(page)).tour === 0 && !(await shown(page)).menu && await usable(page));
    await ctx.close();
    // The offer as it usually comes, its file not held back: the unlock has only just put the search back for the
    // card that points into it (“What comes back” prepares its words first, so the card is still on its way).
    const panel = pg => pg.evaluate(() => { const m = document.getElementById('menuBack'), s = document.getElementById('searchBack'); const of = el => (!el || el.hidden ? 'shut' : el.inert ? 'out of reach' : 'in reach'); return { menu: of(m), search: of(s) }; });
    const tabs = async (pg, n = 7) => { const at = []; for (let i = 0; i < n; i++) { await pg.keyboard.press('Tab'); at.push(await pg.evaluate(() => { const a = document.activeElement; return a.closest('.tour-card') ? 'card' : a.closest('#menu') ? 'menu' : a.closest('#search') ? 'search' : a.closest('#app') ? 'page' : a.tagName === 'BODY' || a.classList.contains('skip') || /Skip to content/.test(a.textContent || '') ? 'top' : a.tagName; })); } return at; };
    {
      const { ctx, page } = await existing();
      await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
      ok('(Getting around is on “What comes back”, the search shown)', (await toCard(page, 'What comes back')) && (await shown(page)).search);
      const step = await page.locator('.tour-step').innerText();
      await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
      await lockNow(page); await lockUp(page); await page.keyboard.type(OLD);
      await page.waitForSelector('.pin-offer', { timeout: 20000 }); await sleep(1500);
      const under = { card: await card(page), ...(await panel(page)) };
      await page.keyboard.press('Escape'); await sleep(1500);
      const st = { ...(await state(page)), card: await card(page), step: await page.locator('.tour-step').innerText().catch(() => ''), ...(await panel(page)), tabs: await tabs(page) };
      ok('the offer of a longer PIN coming up over a walkthrough card that shows the search leaves that search where it is: the card does not move on', under.card === 'What comes back' && under.search === 'out of reach' && st.offer === 0 && st.card === 'What comes back' && st.step === step, JSON.stringify([under, st.card, st.step]));
      ok('…and once it is answered the search is still there to look at and out of reach, with the keyboard kept to the card', st.search === 'out of reach' && st.menu === 'shut' && st.tour === 1 && st.tabs.every(x => x === 'card' || x === 'top'), JSON.stringify(st));
      await page.keyboard.press('Escape'); await sleep(300);
      ok('…and the page is usable when the walkthrough ends', (await state(page)).tour === 0 && await usable(page));
      await ctx.close();
    }
    // The offer answered in another tab while it is up here over a card that points into the menu: it goes, the menu
    // the card points into stays, and the focus is back on the card.
    {
      const { ctx, page } = await existing();
      await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
      const two = await ctx.newPage(); watch(two);
      await two.goto(BASE); await lockUp(two); await two.keyboard.type(OLD); await two.waitForSelector('.pin-offer', { timeout: 20000 }); await sleep(300);
      await page.bringToFront();
      await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
      ok('(the first tab is on its menu card, with the offer due)', (await toCard(page, 'How syncing is going')) && (await shown(page)).menu);
      await lockNow(page); await unlock(page); await page.waitForSelector('.pin-offer', { timeout: 20000 }); await sleep(400);
      await two.bringToFront(); await two.keyboard.press('Escape'); await sleep(600);
      await page.bringToFront(); await sleep(1500);
      const st = { ...(await state(page)), card: await card(page), ...(await panel(page)), pointsAt: await page.evaluate(() => { const el = document.getElementById('menuStatus'); return !!el && el.offsetParent !== null; }), onCard: await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.tour-card')) };
      ok('an offer answered in another tab goes from this one and leaves the walkthrough as it was: the menu its card points into is still shown, out of reach, and the focus is on the card', st.offer === 0 && st.tour === 1 && st.card === 'How syncing is going' && st.menu === 'out of reach' && st.pointsAt && st.onCard, JSON.stringify(st));
      await ctx.close();
    }
    // A menu put up for a walkthrough card while the lock screen is over it (Next, then the lock, and the menu's file
    // arrives after it): the lock screen's way out gives back what was in reach before, and this menu was not there
    // then. It is there to look at all the same, and stays out of reach.
    {
      const { ctx, page } = await existing();
      let release; const held = new Promise(r => { release = r; });
      await ctx.route('**/js/menu.js', async r => { await held; await r.continue().catch(() => {}); });
      await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
      ok('(Getting around is on the card before its first menu card, the menu never opened yet)', (await toCard(page, 'What comes back')) && (await panel(page)).menu === 'shut');
      await page.locator('.tour-card .btn.primary').click(); await sleep(150);
      await lockNow(page); await lockUp(page);
      release(); await sleep(900);
      await unlock(page); await sleep(900);
      const st = { ...(await state(page)), card: await card(page), ...(await panel(page)), tabs: await tabs(page) };
      ok('a menu that a walkthrough put up while the lock screen was over it is out of reach after the unlock, like any menu a walkthrough shows: the keyboard stays on the card', st.lock === 0 && st.tour === 1 && st.card === 'How syncing is going' && st.menu === 'out of reach' && st.tabs.every(x => x === 'card' || x === 'top'), JSON.stringify(st));
      await page.keyboard.press('Escape'); await sleep(300);
      ok('…and the page is usable when the walkthrough ends', (await state(page)).tour === 0 && (await panel(page)).menu === 'shut' && await usable(page));
      await ctx.close();
    }
  });

  /* ------------- a course started from a sheet that holds work but has no box to type in ------------- */
  the('course from a sheet with work in it', async () => {
    const { ctx, page } = await existing();
    const titles = () => page.evaluate(() => [...document.querySelectorAll('.sheet')].map(x => x.getAttribute('aria-label')));
    // The ? of the sheet on top, then Other pages…, then a course (which closes every sheet on its way).
    const toCourse = async () => { await page.locator('.sheet .sheet-help').last().click(); await page.waitForSelector('.tour-card h2'); await sleep(300); await page.getByRole('button', { name: 'Other pages…' }).click(); await page.waitForSelector('.sheet .card.tap'); await page.locator('.sheet .card.tap', { hasText: 'Quotes & invoices, start to finish' }).click(); await sleep(400); };
    const question = async () => ({ titles: await titles(), text: await page.locator('.sheet').last().locator('.sheet-body p').first().innerText().catch(() => ''), buttons: await page.locator('.sheet').last().locator('.actions button').allInnerTexts().catch(() => []), tour: (await state(page)).tour });
    // Equipment → Import…, a pasted list, and one column put right: nothing is left to type into, and there is work to lose
    await page.evaluate(() => window.logiGo('gear')); await page.locator('#page .subactions button', { hasText: 'Import…' }).click(); await page.waitForSelector('.sheet .gi-choose');
    await page.locator('#gi-paste').fill('Sony FX6,FX6-0001,Van\nZoom H6,H6-00003,Shelf A\nRode NTG,RD-00011,Shelf A\n'); await page.locator('.sheet .gi-use').click(); await page.waitForSelector('.sheet .gi-cols', { timeout: 20000 });
    const cols = () => page.evaluate(() => [...document.querySelectorAll('.sheet .gi-col select')].map(s => s.value).join());
    await page.locator('.sheet .gi-col select').nth(2).selectOption('notes'); await sleep(150);
    const set = await cols();
    await toCourse();
    const q1 = await question();
    ok('a course chosen from the ? of the Import sheet, with its columns set and nothing in it to type into, asks before it closes the sheet', q1.titles.join('|') === 'Import equipment|Tutorials|“Import equipment” is still open' && q1.text === 'This walkthrough closes “Import equipment”, and what was entered or chosen in it would be lost.' && q1.buttons.join('|') === 'Back to it|Close it and carry on' && q1.tour === 0, JSON.stringify(q1));
    await page.locator('.sheet').last().locator('button', { hasText: 'Back to it' }).click().catch(() => {}); await sleep(300);
    const b1 = { titles: await titles(), cols: await cols(), tour: (await state(page)).tour, focus: await page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest('.sheet') && a.offsetParent !== null && a.type !== 'file'; }) };
    ok('Back to it goes back to the sheet: the columns are as they were set, the focus is on something in it that can be seen, and no course runs', b1.titles.join('|') === 'Import equipment' && /notes/.test(set) && b1.cols === set && b1.tour === 0 && b1.focus, JSON.stringify([set, b1]));
    if ((await state(page)).tour) { await page.keyboard.press('Escape'); await sleep(300); }
    while (await page.locator('.sheet').count()) { await page.keyboard.press('Escape'); await sleep(250); }
    // the preview of a shared link, with a choice made on a row: once shown, its link is no longer waiting
    const link = await page.evaluate(async () => { const lp = await import('./js/link-pack.js'), s = await import('./js/store.js'); s.upsert('gear', { id: 'own-cam', name: 'Sony FX6', category: 'Camera', serial: 'FX6-77' }); return lp.pack({ v: 1, kind: 'gear', made: Date.now(), title: 'Two things', by: { name: 'Pat Producer' }, items: [{ ref: 'p1', name: 'Sony FX6', category: 'Camera', serial: 'FX6-77' }, { ref: 'p2', name: 'Sigma 24-70', category: 'Lens' }], kits: [] }); });
    await page.evaluate(l => { import('./js/share-add.js').then(m => m.arrived(l)); }, link); await page.waitForSelector('.sheet .add-preview', { timeout: 15000 }); await sleep(200);
    await page.locator('.sheet .add-dup select').first().selectOption('update'); await sleep(150);
    await toCourse();
    const q2 = await question();
    ok('the same from the ? of a shared link’s preview', q2.titles.join('|') === 'Add this equipment?|Tutorials|“Add this equipment?” is still open' && q2.text === 'This walkthrough closes “Add this equipment?”, and what was entered or chosen in it would be lost.' && q2.tour === 0, JSON.stringify(q2));
    await page.locator('.sheet').last().locator('button', { hasText: 'Back to it' }).click().catch(() => {}); await sleep(300);
    const b2 = { titles: await titles(), choice: await page.locator('.sheet .add-dup select').first().inputValue().catch(() => '(gone)'), tour: (await state(page)).tour };
    ok('…and going back leaves the preview with the choice that was made in it', b2.titles.join('|') === 'Add this equipment?' && b2.choice === 'update' && b2.tour === 0, JSON.stringify(b2));
    await toCourse();
    await page.locator('.sheet').last().locator('button', { hasText: 'Close it and carry on' }).click().catch(() => {});
    await page.waitForSelector('.tour-card h2', { timeout: 15000 }).catch(() => {}); await sleep(300);
    ok('Close it and carry on closes it and starts the course', (await state(page)).sheets === 0 && (await card(page)) === 'Quotes and invoices, start to finish', JSON.stringify(await state(page)));
    await page.keyboard.press('Escape'); await sleep(300);
    // a sheet of switches and lists, which take effect as they are set, is still closed without a question
    await page.evaluate(() => import('./js/a11y.js').then(m => m.openDisplaySettings())); await page.waitForSelector('.sheet'); await sleep(200);
    await toCourse(); await page.waitForSelector('.tour-card h2', { timeout: 15000 }).catch(() => {}); await sleep(300);
    ok('from a sheet that only holds switches (text size and theme) the course still starts without asking: there is nothing in it to lose', (await state(page)).tour === 1 && !(await titles()).some(t => /still open/.test(t)) && (await card(page)) === 'Quotes and invoices, start to finish', JSON.stringify([await titles(), await state(page)]));
    await page.keyboard.press('Escape'); await sleep(300);
    await ctx.close();
  });

  /* ----------------------------- a file handed to Vdex while it is locked ----------------------------- */
  the('file handed over while locked', async () => {
    const { ctx, page } = await existing();
    // What the iPhone app does when the phone hands it a file ("Copy to Vdex"), which also brings Vdex to the front.
    const hand = (name, text, type) => page.evaluate(([name, text, type]) => { import('./js/share-in.js').then(m => m.arrived(new File([text], name, { type }))); }, [name, text, type]);
    let phase = 'unlocked'; const asked = []; page.on('dialog', d => asked.push(`${phase}: ${d.message()}`)); // (the question is answered OK, by watch above)
    const before = await bookings(page);
    await lockNow(page); await lockUp(page); phase = 'locked';
    await hand('vdex-backup.json', JSON.stringify({ bookings: [], gear: [], crew: [] }), 'application/json'); await sleep(1500);
    const locked = { asked: [...asked], bookings: await bookings(page), toasts: await page.locator('.toast').count(), lock: (await state(page)).lock };
    ok('a backup file handed to Vdex while it is locked asks nothing over the lock screen and replaces nothing', before > 0 && locked.asked.length === 0 && locked.bookings === before && locked.toasts === 0 && locked.lock === 1, JSON.stringify([before, locked]));
    phase = 'unlocked'; await page.keyboard.type(OLD); await lockGone(page);
    await page.waitForFunction(() => document.querySelectorAll('.toast').length > 0, null, { timeout: 8000 }).catch(() => {});
    ok('…the question comes once the PIN has been entered, and only then is the file taken', asked.join('|') === 'unlocked: Replace your current data with this file?' && (await bookings(page)) === 0, JSON.stringify([asked, await bookings(page)]));
    // any other file waits the same way: no sheet is made under the lock screen
    await lockNow(page); await lockUp(page);
    await hand('script.txt', 'INT. ROOM - DAY\nA line.', 'text/plain'); await sleep(1200);
    const under = await state(page);
    await page.keyboard.type(OLD); await lockGone(page);
    const came = await page.waitForSelector('.sheet[aria-label="A file for Vdex"]', { timeout: 8000 }).then(() => true, () => false); await sleep(200);
    ok('a script handed over while locked opens no sheet under the lock screen: its sheet comes after the PIN, in reach', under.sheets === 0 && under.lock === 1 && came && !(await page.evaluate(() => document.querySelector('.sheet-back').inert)), JSON.stringify(under));
    await page.keyboard.press('Escape'); await sleep(250);
    // unlocked, nothing waits
    await hand('script.txt', 'INT. ROOM - DAY\nA line.', 'text/plain');
    ok('…and while Vdex is unlocked a file is asked about at once, as before', await page.waitForSelector('.sheet[aria-label="A file for Vdex"]', { timeout: 3000 }).then(() => true, () => false));
    await ctx.close();
  });

  /* ------------------------- a walkthrough that begins while the lock screen is up ------------------------- */
  the('walkthrough that starts under the lock', async () => {
    const { ctx, page } = await existing({ patch: { autoLock: 0 } }); // Lock: straight away
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openChooser())); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet .card.tap', { hasText: /^Equipment$/ }).click();
    await setVis(page, true); await sleep(100); await setVis(page, false); // put away and brought back before the tutorial has started
    await lockUp(page);
    await page.waitForSelector('.tour-card h2', { state: 'attached', timeout: 15000 }); await sleep(900);
    const first = await card(page);
    const under = await page.evaluate(() => ({ inert: document.querySelector('.tour').inert, focus: document.activeElement.closest('.lock') ? 'lock' : document.activeElement.closest('.tour') ? 'the walkthrough' : document.activeElement.tagName }));
    ok('a walkthrough that begins while the lock screen is up starts out of reach, and does not take the focus from the lock screen', (await state(page)).lock === 1 && first !== '' && under.inert && under.focus === 'lock', JSON.stringify([first, under]));
    await page.keyboard.press('ArrowRight'); await sleep(900);
    const moved = await card(page);
    await page.keyboard.press('Escape'); await sleep(300);
    ok('…and an arrow key and Escape pressed on the lock screen neither move it nor end it', moved === first && (await state(page)).tour === 1, `${first} → ${moved}, walkthroughs ${(await state(page)).tour}`);
    await page.keyboard.type(OLD); await lockGone(page); await sleep(400);
    const after = await page.evaluate(() => ({ inert: document.querySelector('.tour').inert, inCard: !!document.activeElement.closest('.tour-card') }));
    await page.keyboard.press('ArrowRight'); await sleep(900);
    ok('after the PIN it is in reach, with the focus on its card, and its keys work', !after.inert && after.inCard && (await card(page)) !== first && (await card(page)) !== '', JSON.stringify([after, await card(page)]));
    await page.keyboard.press('Escape'); await sleep(300);
    ok('…and Escape ends it, leaving the page usable', (await state(page)).tour === 0 && await usable(page), JSON.stringify(await state(page)));
    await ctx.close();
  });

  /* ------------------------ where the keyboard focus is after the lock screen has gone ------------------------ */
  the('focus after the unlock', async () => {
    const { ctx, page } = await existing();
    const again = async () => { await lockNow(page); await lockUp(page); await page.keyboard.type(OLD); await lockGone(page); await sleep(300); };
    await addForm(page, 'Robin'); // the cursor is in the Name box
    await again();
    const box = await page.evaluate(() => document.activeElement.getAttribute('data-key') || document.activeElement.tagName);
    await page.keyboard.type(' Example'); await sleep(100);
    ok('after the PIN the cursor is back in the box of the form it was in, and typing carries on there', box === 'name' && (await state(page)).typed === 'Robin Example', JSON.stringify([box, (await state(page)).typed]));
    await page.keyboard.press('Escape'); await sleep(250);
    await page.evaluate(() => import('./js/tutorials.js').then(m => m.openTutorial('around'))); await page.waitForSelector('.tour-card h2'); await sleep(400);
    const c1 = await card(page);
    await again();
    const onNext = await page.evaluate(() => { const a = document.activeElement; return !!a.closest('.tour-card') && a.classList.contains('primary'); });
    await page.keyboard.press('Enter'); await sleep(900);
    ok('…over a walkthrough it is back on the card’s Next, which Enter presses', onNext && (await card(page)) !== c1 && (await card(page)) !== '', `${c1} → ${await card(page)}`);
    await page.keyboard.press('Escape'); await sleep(300);
    await again();
    ok('…and with nothing open it goes to the page itself, as before', await page.evaluate(() => document.activeElement.id === 'page'), await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
    await ctx.close();
  });

  // ONLY is for working on one case by hand. It is never taken from a runner's environment (CI), a filtered run says
  // that it is one, and a filter that matches nothing fails: the spec must not pass with its cases left out.
  const only = process.env.CI ? '' : process.env.ONLY || '';
  const chosen = cases.filter(([name]) => !only || name.includes(only));
  if (only) console.log(chosen.length ? `NOTE ONLY=${only}: ${chosen.length} of ${cases.length} cases run, the others are not tested in this run` : `FAIL ONLY=${only} matches none of the ${cases.length} cases: nothing was tested`);
  for (const [name, fn] of chosen) {
    try { await fn(); } catch (e) { console.log(`FAIL ${name}: the case stopped early — ` + String(e.stack || e.message).split('\n').slice(0, 3).join(' / ')); }
  }
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

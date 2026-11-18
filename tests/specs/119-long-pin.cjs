// Longer PINs: any digits from 4 to 20 are a PIN (no advice, and one repeated digit is no longer refused), at the first
// start and under Settings → Security; the lock screen draws a dot for every digit, in two rows past ten, and still
// sends the PIN by itself at its length, from the keypad, a keyboard or a paste; and someone whose PIN was chosen when
// PINs stopped at 8 digits is asked once, after their next unlock, whether to set a new one or keep theirs
// (js/pin-offer.js), never again after either answer and never when the PIN was set on this version.
const { chromium } = require('playwright');
const { TERMS_RECORD, openSetting } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const P4 = '1111', P9 = '123456789', P20 = '12345678901234567890', OLD = '246810';
const PHONE = { width: 360, height: 740 };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let fileAway = false; // while the test keeps the offer's file out of reach, the browser logs that fetch as failed: the test's own doing
  const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if ((m.type() === 'error' && !(fileAway && /Failed to load resource/.test(m.text()))) || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); page.on('dialog', d => d.accept()); };
  const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k);
  const cfg = async page => JSON.parse(await ls(page, 'logi-lock') || 'null');
  const lockUp = page => page.waitForSelector('.lock:not(.lock-setup)', { timeout: 30000 });
  const lockGone = page => page.waitForFunction(() => !document.querySelector('.lock:not(.lock-setup)'), null, { timeout: 60000 });
  const app = page => page.waitForSelector('#rolodex .drum-btn', { timeout: 60000 });
  const keypad = async (page, pin) => { for (const d of pin) await page.locator(`.lock .key[aria-label="${d}"]`).click(); };
  // What comes after the lock screen: the offer of a longer PIN, or the app.
  const next = async page => { await page.waitForFunction(() => document.querySelector('.pin-offer') || (!document.querySelector('.lock') && document.querySelector('#rolodex .drum-btn')), null, { timeout: 60000 }); await sleep(700); return (await page.locator('.pin-offer').count()) ? 'offer' : 'app'; };
  const lockNow = page => page.evaluate(() => import('./js/lock.js').then(l => l.lockNow()));
  const dotsOf = page => page.evaluate(() => {
    const el = document.querySelector('.lock .pin-dots'); if (!el) return { n: 0, on: -1, label: 'no lock screen', perRow: [], sideways: true };
    const dots = [...el.querySelectorAll('i')].map(i => i.getBoundingClientRect()), card = document.querySelector('.lock .lock-card').getBoundingClientRect();
    const tops = [...new Set(dots.map(r => Math.round(r.top)))];
    const last = [...document.querySelectorAll('.lock .keypad .key')].pop().getBoundingClientRect();
    return { n: dots.length, on: el.querySelectorAll('i.on').length, label: el.getAttribute('aria-label'), role: el.getAttribute('role'), perRow: tops.map(t => dots.filter(r => Math.round(r.top) === t).length),
      left: Math.round(Math.min(...dots.map(r => r.left))), right: Math.round(Math.max(...dots.map(r => r.right))), size: Math.round(Math.min(...dots.map(r => Math.min(r.width, r.height)))),
      gap: dots.length > 1 ? Math.round(dots[1].left - dots[0].right) : 0, cardLeft: Math.round(card.left), cardRight: Math.round(card.right), vw: innerWidth, vh: innerHeight,
      sideways: document.querySelector('.lock').scrollWidth > document.querySelector('.lock').clientWidth || document.documentElement.scrollWidth > innerWidth, keypadBottom: Math.round(last.bottom) };
  });
  // An existing user with sample data and a PIN. old: the config as every version before longer PINs wrote it (no max).
  const existing = async ({ pin = OLD, old = true, viewport = PHONE, colorScheme = 'dark', patch = null } = {}) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme });
    await ctx.addInitScript(t => { if (!localStorage.getItem('spec-seeded')) { localStorage.setItem('spec-seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await app(page);
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    await page.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), pin); await page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
    if (patch) await page.evaluate(p => import('./js/lock.js').then(l => l.setOption(p)), patch);
    await page.evaluate(() => new Promise(r => setTimeout(r, 400))); // the vault catches up with the sample data
    await page.evaluate(old => { localStorage.removeItem('logi-lock-setup'); if (old) { const c = JSON.parse(localStorage.getItem('logi-lock')); delete c.max; localStorage.setItem('logi-lock', JSON.stringify(c)); } }, old);
    return { ctx, page };
  };
  const bookings = page => page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length));

  // --- the first start: 4, 9 and 20 digits are all a PIN; each opens Vdex from the keypad and from a keyboard ---
  for (const pin of [P4, P9, P20]) {
    const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
    await ctx.addInitScript(t => { if (!localStorage.getItem('spec-seeded')) { localStorage.setItem('spec-seeded', '1'); localStorage.setItem('logi-terms', t); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await page.waitForSelector('.lock-setup'); await sleep(300);
    const a = page.locator('.lock-setup .pin-input').nth(0), b = page.locator('.lock-setup .pin-input').nth(1), save = page.locator('.lock-setup button[type=submit]'), msg = page.locator('.lock-setup .lock-msg');
    if (pin === P4) {
      const text = await page.locator('.lock-setup').innerText();
      ok('the set-up screen says 4 to 20 digits and gives no advice about choosing one', /First, set a PIN/.test(text) && /(^|\n)4 to 20 digits\.(\n|$)/.test(text) && !/good length|birthday|phone number|4 to 8/i.test(text), text.replace(/\n+/g, ' / ').slice(0, 200));
      ok('…and still says a forgotten PIN cannot be recovered', /A forgotten PIN cannot be recovered/.test(text));
      await page.screenshot({ path: OUT + '/pin-setup-360.png' });
      const said = () => page.evaluate(() => document.querySelector('.lock-setup .lock-msg')?.textContent ?? '(the set-up screen has gone)');
      const refused = async (v, what) => { await a.fill(v); await b.fill(v); await save.click(); await sleep(400); ok(`${what} is refused at the set-up`, (await said()) === 'Use 4 to 20 digits.' && (await ls(page, 'logi-lock')) === null && (await page.locator('.lock-setup').count()) === 1, await said()); };
      await refused('123', '3 digits');
      await refused(P20 + '1', '21 digits');
      ok('…the 21 digits staying in the field to be refused, rather than being cut to 20 unseen', (await a.inputValue()).length === 21 && await page.evaluate(() => document.querySelector('.lock-setup .pin-input').maxLength > 21));
      await refused('12ab56', 'a PIN with letters in it');
      await a.fill(P9); await b.fill(P20); await save.click(); await sleep(200);
      ok('two PINs that differ are refused', (await msg.innerText()) === 'The two PINs differ.');
    }
    await a.fill(pin); await b.fill(pin); await save.click();
    await app(page).catch(() => {});
    const c = await cfg(page);
    ok(`a ${pin.length}-digit PIN${pin === P4 ? ' of one repeated digit' : ''} is taken at the first start`, !!c && c.len === pin.length && c.max === 20 && !!c.pin && !(await ls(page, 'logi-lock')).includes(pin) && !!(await ls(page, 'logi-vault')), JSON.stringify(c && { len: c.len, max: c.max }));
    await page.waitForSelector('.tour-card', { timeout: 10000 }); await sleep(300);
    ok('…the walkthrough follows, with no offer of a longer PIN during the first-run set-up', (await page.locator('.pin-offer').count()) === 0 && /Welcome to Vdex/.test(await page.locator('.tour-card h2').innerText()));
    if (pin === P4) { await page.locator('.tour-card .btn.primary').click(); await sleep(500); ok('the walkthrough’s PIN card gives the new length', /Your PIN/.test(await page.locator('.tour-card h2').innerText()) && /4 to 20 digits/.test(await page.locator('.tour-card p').innerText()) && !/4 to 8/.test(await page.locator('.tour-card p').innerText())); }
    await page.keyboard.press('Escape'); await sleep(200); await page.evaluate(() => localStorage.setItem('logi-tour', 'done'));
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
    await page.reload(); await lockUp(page); await sleep(200);
    const d = await dotsOf(page);
    ok(`the lock screen draws ${pin.length} dots for it and tells a screen reader so`, d.n === pin.length && d.label === `0 of ${pin.length} digits entered` && d.role === 'img' && !d.sideways, JSON.stringify(d));
    await keypad(page, pin.slice(0, -1)); await sleep(500);
    ok('…does nothing until the last digit is in', (await page.locator('.lock:not(.lock-setup)').count()) === 1 && (await page.locator('.pin-dots i.on').count()) === pin.length - 1 && (await page.locator('.lock-msg').innerText()) === '' && (await cfg(page)).attempts === 0);
    await keypad(page, pin.slice(-1));
    ok(`…and the ${pin.length}-digit PIN opens Vdex from the keypad, sent by itself at the last digit, with no offer for a PIN set on this version`, (await next(page)) === 'app');
    await page.locator('#lockBtn').click(); await lockUp(page);
    await page.keyboard.type(pin); await lockGone(page); await sleep(700);
    ok('…and from a keyboard, again with no offer', (await page.locator('.pin-offer').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
    await ctx.close();
  }

  // --- Settings → Security: the same rule for Set a PIN… and Change PIN… ---
  { const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
    await ctx.addInitScript(t => { if (!localStorage.getItem('spec-seeded')) { localStorage.setItem('spec-seeded', '1'); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); } }, TERMS_RECORD);
    const page = await ctx.newPage(); watch(page);
    await page.goto(BASE); await app(page);
    await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
    const security = async () => { await page.evaluate(() => window.logiGo('settings')); await sleep(400); await openSetting(page, 'Security'); };
    const field = n => page.locator('.sheet .pin-input').nth(n), submit = () => page.locator('.sheet button[type=submit]').click(), smsg = () => page.locator('.sheet .lock-msg').innerText();
    const twice = async v => { await field(0).fill(v); await field(1).fill(v); await submit(); };
    await security();
    await page.getByRole('button', { name: 'Set a PIN…' }).click(); await page.waitForSelector('.sheet .pin-input'); await sleep(200);
    const sheetText = await page.locator('.sheet').innerText();
    ok('Set a PIN… in Settings says 4 to 20 digits and gives no advice', /(^|\n)4 to 20 digits\.(\n|$)/.test(sheetText) && !/good length|birthday|phone number|4 to 8/i.test(sheetText), sheetText.replace(/\n+/g, ' / '));
    await page.screenshot({ path: OUT + '/pin-settings-360.png' });
    for (const [v, what] of [['123', '3 digits'], [P20 + '1', '21 digits'], ['12ab56', 'a PIN with letters in it']]) { await twice(v); await sleep(200); ok(`${what} is refused in Settings`, (await smsg()) === 'Use 4 to 20 digits.' && (await ls(page, 'logi-lock')) === null, await smsg()); }
    await twice(P4);
    await page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
    ok('a 4-digit PIN of one repeated digit is taken in Settings', (await cfg(page)).len === 4 && (await cfg(page)).max === 20);
    ok('Settings → Security says how long a new PIN may be', /Change PIN… sets a new one, 4 to 20 digits long\./.test(await page.locator('details[data-s="Security"]').innerText()));
    const unlockBoth = async (pin, what) => {
      await page.locator('#lockBtn').click(); await lockUp(page); await keypad(page, pin); await lockGone(page);
      await page.locator('#lockBtn').click(); await lockUp(page); const n = (await dotsOf(page)).n; await page.keyboard.type(pin); await lockGone(page); await sleep(600);
      ok(`${what} opens Vdex from the keypad and from a keyboard, with no offer`, n === pin.length && (await page.locator('.pin-offer').count()) === 0 && (await bookings(page)) === 8, n + ' dots');
    };
    await unlockBoth(P4, 'the 4-digit PIN set in Settings');
    let current = P4;
    for (const pin of [P9, P20]) {
      await security();
      await page.getByRole('button', { name: 'Change PIN…' }).click(); await page.waitForSelector('.sheet .pin-input');
      await field(0).fill(current); await submit();
      await page.waitForFunction(() => document.querySelectorAll('.sheet .pin-input').length === 2, null, { timeout: 30000 }); await sleep(200);
      if (pin === P9) {
        const t = await page.locator('.sheet').innerText();
        ok('Change PIN… says 4 to 20 digits, with no advice', /(^|\n)4 to 20 digits\.(\n|$)/.test(t) && !/good length|birthday|4 to 8/i.test(t), t.replace(/\n+/g, ' / '));
        await twice(P20 + '1'); await sleep(200); ok('…refuses 21 digits', (await smsg()) === 'Use 4 to 20 digits.' && (await cfg(page)).len === 4);
        await twice('123'); await sleep(200); ok('…and 3', (await smsg()) === 'Use 4 to 20 digits.' && (await cfg(page)).len === 4);
        await twice('2222'); await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 30000 }); await sleep(600);
        ok('…and takes a PIN of one repeated digit', (await cfg(page)).len === 4 && (await page.locator('.toast').allInnerTexts()).some(x => /PIN changed/.test(x)));
        await page.getByRole('button', { name: 'Change PIN…' }).click(); await page.waitForSelector('.sheet .pin-input');
        await field(0).fill('2222'); await submit();
        await page.waitForFunction(() => document.querySelectorAll('.sheet .pin-input').length === 2, null, { timeout: 30000 });
      }
      if (pin === P20) { await field(0).fill(pin); await field(1).fill(pin); await sleep(100); await page.screenshot({ path: OUT + '/pin-settings-20-360.png' }); }
      await twice(pin);
      await page.waitForFunction(n => JSON.parse(localStorage.getItem('logi-lock')).len === n, pin.length, { timeout: 30000 }); await sleep(700);
      ok(`a ${pin.length}-digit PIN is taken by Change PIN…`, (await cfg(page)).len === pin.length && !(await ls(page, 'logi-lock')).includes(pin));
      await unlockBoth(pin, `the ${pin.length}-digit PIN set in Settings`);
      current = pin;
    }

    // --- the lock screen with a 20-digit PIN on a 360 px phone ---
    await page.locator('#lockBtn').click(); await lockUp(page); await sleep(200);
    const d = await dotsOf(page);
    ok('20 dots sit in two rows of ten, inside the card and the 360 px screen, with nothing scrolling sideways', d.n === 20 && d.perRow.join() === '10,10' && d.left >= d.cardLeft && d.cardLeft >= 0 && d.right <= d.cardRight && d.cardRight <= 360 && !d.sideways, JSON.stringify(d));
    ok('…each dot as big as a short PIN’s, and apart from the next', d.size >= 14 && d.gap >= 8, `${d.size} px, ${d.gap} px apart`);
    ok('…and the whole keypad still shows below them without scrolling', d.keypadBottom <= d.vh, `${d.keypadBottom} of ${d.vh}`);
    await page.screenshot({ path: OUT + '/lock-20-empty-360.png' });
    await page.keyboard.type('1234567');
    ok('typing fills the dots and the label counts them', (await dotsOf(page)).on === 7 && (await dotsOf(page)).label === '7 of 20 digits entered');
    await page.keyboard.press('Backspace'); await page.locator('.lock .key[aria-label="Delete"]').click();
    ok('Backspace and the Delete key each take one digit back', (await dotsOf(page)).on === 5 && (await dotsOf(page)).label === '5 of 20 digits entered');
    await page.keyboard.type('6789012'); await page.screenshot({ path: OUT + '/lock-20-part-360.png' });
    await page.keyboard.type('3456789'); await sleep(400);
    ok('19 digits in: nothing is tried yet', (await dotsOf(page)).on === 19 && (await cfg(page)).attempts === 0 && (await page.locator('.lock-msg').innerText()) === '');
    await page.keyboard.type('9'); // the 20th digit is wrong
    await page.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 });
    ok('a wrong 20-digit PIN is sent at the 20th digit and counted as a wrong attempt', (await cfg(page)).attempts === 1 && (await dotsOf(page)).on === 0, await page.locator('.lock-msg').innerText());
    // paste: only digits, and never more than the PIN has
    const paste = text => page.evaluate(t => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, text);
    const lockSays = () => page.evaluate(() => document.querySelector('.lock:not(.lock-setup) .lock-msg')?.textContent ?? '(the lock screen has gone)');
    await paste(P20 + '1'); await sleep(1500);
    ok('a paste longer than the PIN is left out and said, not cut to fit and tried', (await dotsOf(page)).on === 0 && (await cfg(page)).attempts === 1 && /Not pasted/.test(await lockSays()), await lockSays());
    await paste('1234abcd'); await sleep(300);
    ok('…and so is one with letters in it', (await dotsOf(page)).on === 0 && (await cfg(page)).attempts === 1 && /Not pasted/.test(await lockSays()));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(t => navigator.clipboard.writeText(t), ' ' + P20 + '\n');
    await page.keyboard.press('Control+V');
    await lockGone(page); await sleep(500);
    ok('pasting the 20-digit PIN with the keyboard opens Vdex, the wrong-attempt count cleared', (await cfg(page)).attempts === 0 && (await bookings(page)) === 8);
    await page.setViewportSize({ width: 320, height: 568 }); await page.locator('#lockBtn').click(); await lockUp(page); await sleep(200);
    const narrow = await dotsOf(page);
    ok('on a 320 px phone the 20 dots still fit in two rows', narrow.perRow.join() === '10,10' && narrow.left >= narrow.cardLeft && narrow.right <= narrow.cardRight && narrow.cardRight <= 320 && !narrow.sideways && narrow.size >= 14, JSON.stringify(narrow));
    await page.keyboard.type(P20); await lockGone(page);
    await ctx.close(); }

  // --- 11 and 15 digits: even rows, the longer one first ---
  { const { ctx, page } = await existing({ pin: '12345678901', old: false });
    await lockNow(page); await lockUp(page); await sleep(200);
    const d11 = await dotsOf(page);
    await page.keyboard.type('12345678901'); await lockGone(page);
    await page.evaluate(() => import('./js/lock.js').then(l => l.setPin('123456789012345')));
    await lockNow(page); await lockUp(page); await sleep(200);
    const d15 = await dotsOf(page);
    await page.screenshot({ path: OUT + '/lock-15-360.png' });
    ok('11 dots are 6 over 5 and 15 are 8 over 7, inside the card', d11.perRow.join() === '6,5' && d15.perRow.join() === '8,7' && d15.left >= d15.cardLeft && d15.right <= d15.cardRight && !d15.sideways, JSON.stringify([d11.perRow, d15.perRow]));
    await page.keyboard.type('123456789012345'); await lockGone(page);
    await page.evaluate(() => import('./js/lock.js').then(l => l.setPin('1234567890')));
    await lockNow(page); await lockUp(page); await sleep(200);
    ok('up to ten digits stay in one row', (await dotsOf(page)).perRow.join() === '10' && !(await dotsOf(page)).sideways);
    await ctx.close(); }

  // --- the one-time offer to someone whose PIN is from before: keep the current one ---
  { const { ctx, page } = await existing({ patch: { wipe: true, autoLock: 5 } });
    await page.reload(); await lockUp(page);
    ok('a PIN from before still shows its own dots', (await dotsOf(page)).n === 6);
    await page.keyboard.type(OLD);
    ok('after the next unlock with a PIN from before, the offer comes first, ahead of the app', (await next(page)) === 'offer' && (await page.locator('#rolodex .drum-btn').count()) === 0);
    const text = await page.locator('.pin-offer').innerText();
    ok('it says a PIN can now be 4 to 20 digits and that this is asked once', /Your PIN can be longer now/.test(text) && /4 to 20 digits long/.test(text) && /asks this once/.test(text) && /Change PIN… under Settings → Security/.test(text), text.replace(/\n+/g, ' / '));
    ok('it offers Set a new PIN and a plain Keep my current PIN, and nothing about price or a shop', (await page.locator('.pin-offer button').allInnerTexts()).join('|') === 'Set a new PIN|Keep my current PIN' && !/\$|buy|licen[cs]e/i.test(text));
    const dlg = await page.evaluate(() => { const s = document.querySelector('.pin-offer'), b = [...s.querySelectorAll('button')].map(x => x.getBoundingClientRect()), c = s.querySelector('.lock-card').getBoundingClientRect(); return { role: s.getAttribute('role'), modal: s.getAttribute('aria-modal'), named: document.getElementById(s.getAttribute('aria-labelledby'))?.textContent, described: /4 to 20 digits long/.test(document.getElementById(s.getAttribute('aria-describedby'))?.textContent || ''), focus: document.activeElement.textContent, appInert: document.getElementById('app').inert, tall: Math.round(Math.min(...b.map(r => r.height))), inside: c.left >= 0 && c.right <= innerWidth && b.every(r => r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight), sideways: document.documentElement.scrollWidth > innerWidth || s.scrollWidth > s.clientWidth }; });
    ok('it is a named and described modal dialog with the focus on its first button, the app inert behind it, and buttons 44 px tall inside the screen', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.named === 'Your PIN can be longer now' && dlg.described && dlg.focus === 'Set a new PIN' && dlg.appInert && dlg.tall >= 44 && dlg.inside && !dlg.sideways, JSON.stringify(dlg));
    await page.screenshot({ path: OUT + '/pin-offer-360.png' });
    // closed without an answer (the app is shut): it has not been answered, so it is still there
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('left unanswered, it is there again after the next unlock', (await next(page)) === 'offer' && (await cfg(page)).max === undefined);
    await page.getByRole('button', { name: 'Keep my current PIN' }).click();
    await app(page); await sleep(600);
    const c = await cfg(page);
    ok('Keep my current PIN starts the app with the PIN, the lock timing and the erase switch as they were', (await page.locator('.pin-offer').count()) === 0 && c.len === 6 && c.max === 20 && c.wipe === true && c.autoLock === 5 && c.attempts === 0 && !(await page.evaluate(() => document.getElementById('app').inert)) && (await bookings(page)) === 8, JSON.stringify({ len: c.len, max: c.max, wipe: c.wipe, autoLock: c.autoLock }));
    await page.locator('#lockBtn').click(); await lockUp(page); await page.keyboard.type(OLD);
    ok('…and the offer never comes back: not at the next unlock', (await next(page)) === 'app');
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('…nor at the next start', (await next(page)) === 'app' && (await bookings(page)) === 8);
    await ctx.close(); }

  // --- the offer's own file cannot be fetched, or is slow: Vdex starts all the same. A file that could not be fetched is
  // offered again at the next start (the browser remembers a failed import for as long as the page lives, so the next
  // unlock in the same sitting cannot fetch it either); a slow one has arrived by the next unlock. ---
  { const { ctx, page } = await existing();
    fileAway = true; await ctx.route('**/js/pin-offer.js', r => r.abort());
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('with the offer’s file out of reach, the app starts without it and nothing is recorded', (await next(page)) === 'app' && (await cfg(page)).max === undefined && (await bookings(page)) === 8);
    await ctx.unroute('**/js/pin-offer.js'); fileAway = false;
    let sent = false;
    await ctx.route('**/js/pin-offer.js', async r => { await sleep(9000); sent = true; await r.continue().catch(() => {}); });
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    const started = await page.waitForSelector('#rolodex .drum-btn', { timeout: 8000 }).then(() => true, () => false);
    ok('a file that takes too long does not hold the start up', started && !sent && (await page.locator('.pin-offer').count()) === 0);
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => /pin-offer\.js/.test(e.name)), null, { timeout: 20000 }).catch(() => {}); await sleep(500);
    ok('…and arriving late, it does not come up over the app', sent && (await page.locator('.pin-offer').count()) === 0 && (await cfg(page)).max === undefined);
    await ctx.unroute('**/js/pin-offer.js');
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('…it is offered at the next start instead', (await next(page)) === 'offer');
    await ctx.close(); }

  // --- the offer: set a new PIN ---
  { const { ctx, page } = await existing({ patch: { wipe: true, autoLock: 5 } });
    await page.reload(); await lockUp(page); await keypad(page, OLD);
    ok('the offer follows an unlock from the keypad too', (await next(page)) === 'offer');
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(200);
    const f = n => page.locator('.pin-offer .pin-input').nth(n), omsg = () => page.locator('.pin-offer .lock-msg').innerText(), saveNew = () => page.locator('.pin-offer button[type=submit]').click();
    const text = await page.locator('.pin-offer').innerText();
    ok('Set a new PIN asks for the new PIN and again (the current one was typed a moment ago), says 4 to 20 digits and that a forgotten PIN cannot be recovered', (await page.locator('.pin-offer .pin-input').count()) === 2 && (await f(0).getAttribute('aria-label')) === 'New PIN' && (await f(1).getAttribute('aria-label')) === 'Repeat the PIN' && /(^|\n)4 to 20 digits\.(\n|$)/.test(text) && /A forgotten PIN cannot be recovered/.test(text) && !/good length|birthday|null|undefined/i.test(text) && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'New PIN', text.replace(/\n+/g, ' / '));
    await f(0).fill('123'); await f(1).fill('123'); await saveNew(); await sleep(200);
    ok('…refuses 3 digits', (await omsg()) === 'Use 4 to 20 digits.' && (await cfg(page)).len === 6);
    await f(0).fill(P20 + '1'); await f(1).fill(P20 + '1'); await saveNew(); await sleep(200);
    ok('…and 21', (await omsg()) === 'Use 4 to 20 digits.' && (await cfg(page)).len === 6);
    await f(0).fill(P20); await f(1).fill(P9); await saveNew(); await sleep(200);
    ok('…and two that differ, with the focus on the repeat', (await omsg()) === 'The two PINs differ.' && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Repeat the PIN' && (await cfg(page)).max === undefined);
    await page.screenshot({ path: OUT + '/pin-offer-new-360.png' });
    const before = await cfg(page);
    await f(1).fill(P20); await page.keyboard.press('Enter');
    await app(page); await sleep(600);
    const c = await cfg(page);
    ok('a 20-digit PIN is saved and the app starts, saying PIN changed', (await page.locator('.pin-offer').count()) === 0 && c.len === 20 && c.max === 20 && (await page.locator('.toast').allInnerTexts()).some(x => /PIN changed/.test(x)), JSON.stringify({ len: c.len, max: c.max }));
    ok('the same data key is wrapped again under the new PIN: new salt and wrap, the vault still opens, the data is all there', c.salt !== before.salt && c.pin.ct !== before.pin.ct && (await bookings(page)) === 8 && !(await ls(page, 'logi-lock')).includes(P20));
    ok('the lock timing, the erase switch and the wrong-PIN count are untouched', c.wipe === true && c.autoLock === 5 && c.attempts === 0 && c.until === 0 && c.iter === before.iter);
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
    await page.reload(); await lockUp(page); await sleep(200);
    ok('the next start asks for the new PIN: 20 dots', (await dotsOf(page)).n === 20);
    await page.keyboard.type(OLD); await page.keyboard.press('Enter'); await sleep(800);
    ok('the old PIN with Enter after it is not sent: it is short of the 20 digits, so nothing is tried and nothing is counted', (await cfg(page)).attempts === 0 && (await dotsOf(page)).on === 6 && (await page.locator('.lock-msg').innerText()) === '' && (await page.locator('.lock:not(.lock-setup)').count()) === 1, JSON.stringify(await dotsOf(page)));
    await page.keyboard.type('0'.repeat(14)); // 20 digits that begin with the old PIN
    await page.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 });
    ok('the old PIN no longer opens it, and a full-length wrong PIN counts as a wrong attempt (9 tries left before the erase that was switched on)', (await cfg(page)).attempts === 1 && /9 tries left before this device is erased/.test(await page.locator('.lock-msg').innerText()), await page.locator('.lock-msg').innerText());
    await page.keyboard.type(P20);
    ok('the new PIN opens it, with no second offer', (await next(page)) === 'app' && (await cfg(page)).attempts === 0);
    ok('…and the data is still readable after the change', (await bookings(page)) === 8 && (await page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.length)) === 8);
    await ctx.close(); }

  // --- the offer while Vdex is in use (unlocked after a while away), with Escape, a lock over it, and read-only ---
  { const { ctx, page } = await existing({ old: false });
    await page.evaluate(() => import('./js/store.js').then(s => s.setGate(() => false))); // read-only, as after the trial with no licence
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined }))); // the config as an older version left it
    ok('(read-only for this part, and the config has no max)', !(await page.evaluate(() => import('./js/store.js').then(s => s.canChange()))) && (await cfg(page)).max === undefined);
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await lockNow(page); await lockUp(page); await page.keyboard.type(OLD);
    ok('unlocking while Vdex is in use brings the offer over the page that was open', (await next(page)) === 'offer' && (await page.locator('.page-card[aria-label="Settings"]').count()) === 1 && (await page.evaluate(() => document.getElementById('app').inert)));
    await lockNow(page); await lockUp(page); await sleep(200);
    ok('a lock coming up takes the unanswered offer away', (await page.locator('.pin-offer').count()) === 0 && (await cfg(page)).max === undefined);
    await page.keyboard.type(OLD);
    ok('…and the next unlock brings it back', (await next(page)) === 'offer');
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    await page.locator('.pin-offer .pin-input').nth(0).fill(P9);
    await page.keyboard.press('Escape'); await sleep(150);
    ok('Escape on the new PIN steps back to the choice, with nothing changed', (await page.locator('.pin-offer .pin-input').count()) === 0 && (await page.evaluate(() => document.querySelector('.pin-offer h1')?.textContent)) === 'Your PIN can be longer now' && (await cfg(page)).max === undefined && (await page.evaluate(() => document.activeElement.textContent)) === 'Set a new PIN');
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    ok('Back does the same, and the fields come back empty', (await page.locator('.pin-offer .pin-input').nth(0).inputValue()) === '' && (await page.locator('.pin-offer button').allInnerTexts()).join('|') === 'Save the new PIN|Back');
    await page.locator('.pin-offer .pin-input').nth(0).fill(P9); await page.keyboard.press('Enter'); await sleep(150);
    ok('Enter on the first field moves to the second', (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Repeat the PIN' && (await cfg(page)).len === 6);
    await page.locator('.pin-offer .pin-input').nth(1).fill(P9); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.pin-offer'), null, { timeout: 30000 }); await sleep(400);
    ok('a new PIN is saved while Vdex is read-only (a PIN is not a change to the data), and the page underneath is usable again with the focus on it', (await cfg(page)).len === 9 && (await cfg(page)).max === 20 && !(await page.evaluate(() => document.getElementById('app').inert)) && (await page.evaluate(() => document.activeElement.id)) === 'page' && (await page.locator('.page-card[aria-label="Settings"]').count()) === 1);
    await lockNow(page); await lockUp(page); await page.keyboard.type(P9);
    ok('…it opens Vdex, and the offer does not come back', (await next(page)) === 'app' && (await bookings(page)) === 8);
    // Escape on the choice is the same as keeping the PIN
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    await lockNow(page); await lockUp(page); await page.keyboard.type(P9);
    ok('(the offer is up again for the Escape check)', (await next(page)) === 'offer');
    await page.keyboard.press('Escape'); await sleep(300);
    ok('Escape on the choice closes it for good, keeping the PIN', (await page.locator('.pin-offer').count()) === 0 && (await cfg(page)).max === 20 && (await cfg(page)).len === 9 && !(await page.evaluate(() => document.getElementById('app').inert)));
    await lockNow(page); await lockUp(page); await page.keyboard.type(P9);
    ok('…and it is not shown again', (await next(page)) === 'app');
    await ctx.close(); }

  // --- fingerprint or face: the offer after such an unlock asks for the current PIN first, and the unlock carries on working ---
  { const { ctx, page } = await existing({ old: false });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true } });
    const mode = await page.evaluate(() => import('./js/lock.js').then(l => l.enrolBio()).catch(e => 'error: ' + e.message));
    await page.evaluate(() => import('./js/lock.js').then(l => l.setOption({ max: undefined })));
    await lockNow(page); await lockUp(page);
    ok('(fingerprint or face is on, and unlocks by itself)', mode === 'prf' && (await next(page)) === 'offer', mode);
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(200);
    const labels = await page.locator('.pin-offer .pin-input').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    ok('after a fingerprint or face unlock, Set a new PIN asks for the current PIN first, and says the fingerprint carries on working', labels.join('|') === 'Current PIN|New PIN|Repeat the PIN' && /Fingerprint or face unlock carries on working/.test(await page.locator('.pin-offer').innerText()) && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Current PIN', labels.join('|'));
    await page.screenshot({ path: OUT + '/pin-offer-bio-360.png' });
    const f = n => page.locator('.pin-offer .pin-input').nth(n);
    await f(0).fill('999999'); await f(1).fill(P20); await f(2).fill(P20); await page.locator('.pin-offer button[type=submit]').click();
    await page.waitForFunction(() => /not your current PIN/.test(document.querySelector('.pin-offer .lock-msg').textContent), null, { timeout: 30000 });
    ok('a wrong current PIN changes nothing', (await cfg(page)).len === 6 && (await cfg(page)).max === undefined && (await page.locator('.pin-offer').count()) === 1 && (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Current PIN');
    await f(0).fill(OLD); await page.locator('.pin-offer button[type=submit]').click();
    await page.waitForFunction(() => !document.querySelector('.pin-offer'), null, { timeout: 30000 }); await sleep(400);
    const c = await cfg(page);
    ok('the right one and a 20-digit PIN are saved, the fingerprint’s own wrapped key left as it was', c.len === 20 && c.max === 20 && !!c.bio && !!c.bio.wrap);
    await lockNow(page); await lockUp(page);
    ok('fingerprint or face still unlocks after the change, with no second offer', (await next(page)) === 'app' && (await bookings(page)) === 8);
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await lockNow(page); await lockUp(page); await sleep(1200);
    await page.keyboard.type(P20); await lockGone(page);
    ok('…and so does the new PIN', (await bookings(page)) === 8);
    await ctx.close(); }

  // --- two tabs: an offer answered in one is answered in the other, which asks for the new PIN from then on ---
  { const { ctx, page: a } = await existing();
    await a.reload(); await lockUp(a); await a.keyboard.type(OLD);
    const b = await ctx.newPage(); watch(b);
    await b.goto(BASE); await lockUp(b); await b.keyboard.type(OLD);
    ok('(two tabs, each with the offer up)', (await next(a)) === 'offer' && (await next(b)) === 'offer');
    await b.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(150);
    await b.locator('.pin-offer .pin-input').nth(0).fill(P9); await b.locator('.pin-offer .pin-input').nth(1).fill(P9); await b.locator('.pin-offer button[type=submit]').click();
    await app(b); await a.waitForSelector('#rolodex .drum-btn', { timeout: 15000 }).catch(() => {}); await sleep(300);
    ok('a new PIN set in one tab takes the offer away in the other, which starts', (await a.locator('.pin-offer').count()) === 0 && (await a.locator('#rolodex .drum-btn').count()) > 0 && (await cfg(a)).len === 9);
    await a.bringToFront(); await sleep(300);
    if (!(await a.locator('.lock:not(.lock-setup)').count())) await lockNow(a);
    await lockUp(a); await sleep(200);
    ok('…and that tab’s lock screen asks for the new PIN: 9 dots', (await dotsOf(a)).n === 9);
    await a.keyboard.type(OLD + '000'); // nine digits that begin with the old PIN
    await a.waitForFunction(() => /Wrong PIN/.test(document.querySelector('.lock-msg').textContent), null, { timeout: 30000 });
    await a.keyboard.type(P9);
    ok('…the old PIN no longer opens it, the new one does, and no offer follows', (await next(a)) === 'app' && (await bookings(a)) === 8);
    await a.evaluate(() => import('./js/lock.js').then(l => l.setOption({ autoLock: 5 }))); await sleep(300);
    const c = await cfg(a);
    ok('a lock setting changed in that tab keeps the new PIN and the answer', c.len === 9 && c.max === 20 && c.autoLock === 5);
    // a tab still on the lock screen it started with, when the PIN changes elsewhere
    await b.close();
    await a.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('logi-vault')).v === 1; } catch { return false; } });
    const d = await ctx.newPage(); watch(d);
    await d.goto(BASE); await lockUp(d); await sleep(200);
    const dotsBefore = (await dotsOf(d)).n;
    await a.bringToFront(); await a.evaluate(p => import('./js/lock.js').then(l => l.setPin(p)), P20); await sleep(500);
    await d.bringToFront(); await sleep(300);
    ok('a tab waiting at its lock screen draws the dots again when the PIN is changed in another', dotsBefore === 9 && (await dotsOf(d)).n === 20 && (await d.locator('.lock:not(.lock-setup)').count()) === 1, `${dotsBefore} → ${(await dotsOf(d)).n}`);
    await d.keyboard.type(P20);
    ok('…and opens with the new PIN', (await next(d)) === 'app' && (await bookings(d)) === 8);
    await ctx.close(); }

  // --- how it looks: a wide screen and the light theme ---
  { const { ctx, page } = await existing({ viewport: { width: 1200, height: 800 }, colorScheme: 'light' });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD);
    ok('at 1200 px the offer is a centred card', (await next(page)) === 'offer' && await page.evaluate(() => { const c = document.querySelector('.pin-offer .lock-card').getBoundingClientRect(); return c.width <= 380 && Math.abs((c.left + c.right) / 2 - innerWidth / 2) < 2 && c.top >= 0 && c.bottom <= innerHeight; }));
    await page.screenshot({ path: OUT + '/pin-offer-1200-light.png' });
    await page.getByRole('button', { name: 'Set a new PIN' }).click(); await sleep(200);
    await page.locator('.pin-offer .pin-input').nth(0).fill(P20); await page.locator('.pin-offer .pin-input').nth(1).fill(P20);
    await page.screenshot({ path: OUT + '/pin-offer-new-1200-light.png' });
    await page.locator('.pin-offer button[type=submit]').click(); await app(page); await sleep(500);
    await lockNow(page); await lockUp(page); await sleep(300); await page.keyboard.type('12345678901');
    const wide = await dotsOf(page);
    ok('at 1200 px the 20 dots are two rows of ten in the card', wide.perRow.join() === '10,10' && wide.left >= wide.cardLeft && wide.right <= wide.cardRight && !wide.sideways);
    await page.screenshot({ path: OUT + '/lock-20-1200-light.png' });
    await ctx.close(); }
  { const { ctx, page } = await existing({ colorScheme: 'light' });
    await page.reload(); await lockUp(page); await page.keyboard.type(OLD); await next(page);
    await page.screenshot({ path: OUT + '/pin-offer-360-light.png' });
    await ctx.close(); }

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

// The licence as the desktop app's page shows it (js/licence.js), with a stand-in for the desktop bridge
// (window.vdexDesktop.licence): Settings → General → About & Licence, the trial bar, read-only after the trial, entering a code (including a
// full code moved from another computer), releasing, and that the website itself never loads any of it.
const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The stand-in bridge. window.__lic.state is what the desktop app would report; calls are recorded in window.__lic.calls.
const bridge = start => `(() => {
  const L = window.__lic = { state: ${JSON.stringify(start)}, calls: [], listeners: [] };
  const licensed = { enabled: true, mode: 'licensed', canEdit: true, seats: 3, licence: { name: 'Jane Smith', email: 'jane@example.com', comp: false, ref: '2:4242', seats: 3 } };
  const full = { error: 'full', seats: 3, swapsLeft: 2, computers: [
    { tag: 'tagMacAAAAAA', os: 'Mac', added: '2026-11-01', seen: '2026-11-02' },
    { tag: 'tagWinBBBBBB', os: 'Windows', added: '2026-11-01', seen: '2026-10-20' },
    { tag: 'tagLinCCCCCC', os: 'Linux', added: '2026-11-01', seen: '2026-11-01' }] };
  window.vdexDesktop = {
    platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({ status: 'current' }), onStatus: () => () => {},
    licence: {
      state: async () => (L.calls.push(['state']), L.state),
      enter: async (code, opts) => { L.calls.push(['enter', code, opts]); if (!/VDEX-/i.test(code)) return { error: 'Paste the whole code: it starts with VDEX-.' }; if (!(opts && opts.release)) return full; L.state = licensed; return licensed; },
      recheck: async () => (L.calls.push(['recheck']), L.state),
      release: async () => { L.calls.push(['release']); L.state = { enabled: true, mode: 'trial', canEdit: true, trialLeft: 12, trialEnds: '2026-11-14', seats: 3 }; return L.state; },
      code: async () => 'VDEX-AAAAA-BBBBB',
      buy: async () => { L.calls.push(['buy']); return true; },
      onChange: cb => { L.listeners.push(cb); return () => {}; },
    },
  };
  window.__licPush = s => { L.state = s; L.listeners.forEach(f => f(s)); };
})();`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (state, { desktop = true, width = 420 } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    if (desktop) await ctx.addInitScript(bridge(state));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
    const loaded = []; page.on('request', q => loaded.push(q.url()));
    await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page, loaded };
  };
  const about = async page => {
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'About & Licence');
    await sleep(300);
  };
  try {
    // The website: nothing about licences.
    let { ctx, page, loaded } = await open(null, { desktop: false });
    await about(page);
    await sleep(1800);
    ok('the website shows no licence until the owner switches it on (spec 104), and never loads the desktop bridge\'s side', !loaded.some(u => /desktop\//.test(u)) && (await page.locator('.licence-panel:not([hidden])').count()) === 0 && (await page.locator('.licence-bar').count()) === 0);
    await ctx.close();

    // Desktop, before selling starts: nothing either.
    ({ ctx, page } = await open({ enabled: false, mode: 'off', canEdit: true }));
    await about(page);
    ok('a desktop app with no licence keys shows nothing about licences', !(await page.locator('.licence-panel').isVisible().catch(() => false)) && (await page.locator('.licence-bar').count()) === 0);
    await ctx.close();

    // In the trial.
    ({ ctx, page } = await open({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 24, trialEnds: '2026-11-26', seats: 3 }));
    await about(page);
    const panel = page.locator('.licence-panel');
    ok('Settings → General → About & Licence shows the trial with its end date, and Buy and Enter licence code', /Free trial: 24 days left \(until/.test(await panel.innerText()) && (await panel.getByRole('button', { name: /Buy a licence/ }).count()) === 1 && (await panel.getByRole('button', { name: 'Enter licence code' }).count()) === 1);
    ok('no bar with more than a week of trial left', (await page.locator('.licence-bar').count()) === 0);
    await panel.getByRole('button', { name: /Buy a licence/ }).click();
    ok('Buy opens the shop through the desktop app', (await page.evaluate(() => window.__lic.calls.some(c => c[0] === 'buy'))));
    await page.evaluate(() => window.__licPush({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 5, trialEnds: '2026-11-07', seats: 3 }));
    await sleep(200);
    ok('in the last week a bar counts the days down', /Free trial: 5 days left/.test(await page.locator('.licence-bar').innerText().catch(() => '')));
    await page.screenshot({ path: OUT + '/licence-trial.png' });

    // Entering a code that is full on 3 other computers, and moving it here.
    await panel.getByRole('button', { name: 'Enter licence code' }).click();
    const sh = page.locator('.sheet');
    await sh.locator('textarea').fill('Here it is: VDEX-AAAAA-BBBBB thanks');
    await sh.getByRole('button', { name: 'Activate' }).click(); await sleep(200);
    ok('a full code lists its computers (type, added, last used) with a choice to move it', (await sh.locator('.lic-computers li').count()) === 3 && /Windows · added .* · last used/.test(await sh.innerText()) && /move it 2 more times this month/.test(await sh.innerText()));
    await page.screenshot({ path: OUT + '/licence-full.png' });
    await sh.locator('.lic-computers li').nth(1).getByRole('button', { name: 'Move it here' }).click(); await sleep(300);
    const enters = await page.evaluate(() => window.__lic.calls.filter(c => c[0] === 'enter'));
    ok('moving it sends that computer\'s tag, and the licence is shown', enters.at(-1)[2].release === 'tagWinBBBBBB' && (await page.locator('.sheet').count()) === 0 && /Licensed to Jane Smith \(jane@example.com\) · up to 3 devices/.test(await panel.innerText()));
    ok('the bar goes once licensed', (await page.locator('.licence-bar').count()) === 0);

    // Releasing.
    await panel.getByRole('button', { name: 'Release this computer' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Release this computer' }).click(); await sleep(300);
    ok('releasing this computer goes back to the trial', /Free trial: 12 days left/.test(await panel.innerText()));
    await ctx.close();

    // After the trial: read-only.
    ({ ctx, page } = await open({ enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, trialEnds: '2026-10-01', seats: 3 }));
    ok('after the trial a bar says Vdex is read-only, with Buy and Enter code', /trial has ended: Vdex is read-only/.test(await page.locator('.licence-bar').innerText()) && (await page.locator('.licence-bar .btn').count()) === 2);
    const quiet = await page.evaluate(() => import('./js/store.js').then(s => { const before = s.db.profile.currency; const r = s.update(d => { d.profile = { ...d.profile, currency: '€' }; }); return { r, same: s.db.profile.currency === before }; }));
    ok('a change made in the background is refused quietly', quiet.r === false && quiet.same && (await page.locator('.sheet').count()) === 0, JSON.stringify(quiet) + ' sheets ' + (await page.locator('.sheet').count()) + ' ' + (await page.evaluate(() => navigator.userActivation && navigator.userActivation.isActive)));
    await page.evaluate(() => window.logiGo('settings')); await sleep(400);
    await openSetting(page, 'Profile');
    const cur = page.locator('input[aria-label="Currency symbol"]');
    await cur.fill('£'); await cur.press('Enter'); await sleep(300);
    const stored = await page.evaluate(() => import('./js/store.js').then(s => s.db.profile.currency || '$'));
    ok('a change someone makes is refused and explained, with Buy and Enter code, and no "Saved"', stored !== '£' && /Vdex is read-only/.test(await page.locator('.sheet').innerText()) && (await page.locator('.sheet .btn').count()) >= 2 && (await page.locator('.toast').count()) === 0, stored);
    await page.screenshot({ path: OUT + '/licence-readonly.png' });
    await page.keyboard.press('Escape'); await sleep(200);
    const back = await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), value: document.activeElement?.value, fk: [...document.querySelectorAll('[data-fk]')].map(e => e.tagName + ':' + e.dataset.fk + ':' + (e.getAttribute('aria-label') || '')) }));
    ok('closing the explanation puts the focus back on the field, redrawn with what is stored', back.label === 'Currency symbol' && back.value !== '£', JSON.stringify(back));
    const exported = await page.evaluate(() => import('./js/store.js').then(s => typeof s.db.bookings.length === 'number'));
    ok('everything can still be read', exported);
    await ctx.close();

    // Read-only means read-only: printing and sending still work (without marking anything), but replacing the data does not.
    ({ ctx, page } = await open({ enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, trialEnds: '2026-10-01', seats: 3 }));
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); const b = s.db.bookings.find(x => /Harbour Brewing/.test(x.client || x.title)); if (b) b.callSheet = { ...(b.callSheet || {}), generalCall: '08:00' }; s.redraw(); })); // seeding the test's data, not a person's action
    const count0 = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length));
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.getByRole('button', { name: 'Call sheets' }).click(); await page.waitForSelector('.sheet .card.tap');
    await page.locator('.sheet .card.tap').filter({ hasText: 'Harbour Brewing' }).first().click(); await page.waitForSelector('.cs-page .cs-doc');
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.getByRole('button', { name: 'Print' }).click(); await sleep(500);
    ok('read-only: a call sheet still prints, with no read-only notice, and is not marked as sent', (await page.evaluate(() => window.__printed)) === 1 && (await page.locator('.sheet.licence-readonly').count()) === 0 && !/Sent/.test(await page.locator('.cs-page .status-line').innerText().catch(() => '')));
    const markBtn = page.getByRole('button', { name: 'Mark as sent' });
    if (await markBtn.count()) { await markBtn.click(); await sleep(300); }
    ok('…while Mark as sent, a change, is refused and explained', (await markBtn.count()) === 1 && (await page.locator('.sheet.licence-readonly').count()) === 1, `buttons ${await markBtn.count()}, sheets ${await page.locator('.sheet.licence-readonly').count()}, status ${await page.locator('.cs-page .status-line').innerText().catch(() => '?')}`);
    await page.keyboard.press('Escape'); await sleep(200);
    await page.evaluate(() => window.logiGo('settings')); await sleep(300);
    await openSetting(page, 'Storage, sync & backups'); await sleep(200);
    await page.getByRole('button', { name: 'Load sample data' }).click(); await sleep(300);
    ok('read-only: Load sample data is refused and explained, before any question', dialogs.length === 0 && (await page.locator('.sheet.licence-readonly').count()) === 1);
    await page.keyboard.press('Escape'); await sleep(200);
    await page.getByRole('button', { name: 'Load sample data' }).focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await sleep(100); // a recent key press: the import below counts as asked for
    const imported = await page.evaluate(() => import('./js/backup.js').then(async b => { const f = new File([JSON.stringify({ bookings: [{ id: 'x1', title: 'Imported', date: '2026-01-01', status: 'Booked' }], gear: [] })], 'b.json', { type: 'application/json' }); await b.importData(f); return import('./js/store.js').then(s => s.db.bookings.length); }));
    ok('read-only: importing a backup is refused too: replacing everything is a change', imported === count0 && dialogs.length === 0, `${imported} vs ${count0}`);
    await ctx.close();

    // A form saved while read-only stays open with what was typed.
    ({ ctx, page } = await open({ enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, trialEnds: '2026-10-01', seats: 3 }));
    await page.evaluate(() => window.logiGo('bookings')); await sleep(300);
    await page.locator('.page button:has-text("+ New")').first().click();
    await page.waitForSelector('.sheet form');
    const title = page.locator('.sheet form input[type="text"]').first();
    await title.fill('Wedding at the pier');
    await page.locator('.sheet form button[type="submit"]').click(); await sleep(300);
    const kept = await page.evaluate(() => ({ forms: document.querySelectorAll('.sheet form').length, typed: document.querySelector('.sheet form input[type="text"]')?.value, readOnly: !!document.querySelector('.sheet.licence-readonly'), focus: !!document.activeElement?.closest('.licence-readonly') }));
    const saved = await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.length));
    ok('saving a form while read-only keeps the form and what was typed, explains why, and moves focus to the explanation', kept.forms === 1 && kept.typed === 'Wedding at the pier' && kept.readOnly && kept.focus && saved === 0, JSON.stringify(kept));
    await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await sleep(200);
    ok('keys pressed straight after (someone still typing) never buy anything', !(await page.evaluate(() => window.__lic.calls.some(c => c[0] === 'buy'))));
    await page.keyboard.press('Escape'); await sleep(200);
    ok('closing the explanation returns to the form', await page.evaluate(() => !!document.activeElement?.closest('.sheet form') && !document.querySelector('.licence-readonly')));
    await ctx.close();

    // Erase all data on this device: everything Vdex keeps goes, except plain preferences, the terms agreed to and the
    // licence sign-in (which Sign out gives up).
    ({ ctx, page } = await open({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 20, seats: 3 }));
    await page.evaluate(() => { for (const [k, v] of Object.entries({ 'logi-cal-phone': '{"calendarId":"c1"}', 'logi-ms-token': '{"refresh":"r"}', 'logi-google-tokens': '{}', 'logi-feed-url': 'https://x/feed.ics', 'logi-wx': '{}', 'logi-google-email': 'jo@example.com', 'msal.cache': 'x', 'logi-prefs': '{"text":"large"}', 'vdex-licence': '{"on":true}' })) localStorage.setItem(k, v); });
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.evaluate(() => import('./js/store.js').then(s => s.eraseAll()))]);
    await sleep(500);
    const left = await page.evaluate(() => Object.keys(localStorage).sort());
    ok('erasing removes sign-ins, the phone calendar link, the feed link and the caches', !left.some(k => ['logi-cal-phone', 'logi-ms-token', 'logi-google-tokens', 'logi-feed-url', 'logi-wx', 'logi-google-email', 'msal.cache'].includes(k)), left.join(', '));
    ok('…and keeps the display preferences, the terms agreed to and the licence sign-in', left.includes('logi-prefs') && left.includes('logi-terms') && left.includes('vdex-licence'), left.join(', '));
    await ctx.close();

    // The bar offers each state's own next step: someone who has paid is never asked to buy again.
    for (const [state, button, text] of [
      [{ enabled: true, mode: 'pending', canEdit: false, daysLeft: 0, trialLeft: 0, seats: 3, licence: { name: 'Jane McDonald', email: 'jane@example.com', seats: 3 } }, 'Try again', /Read-only until your licence is activated on this computer/],
      [{ enabled: true, mode: 'offline', canEdit: false, seats: 3, licence: { name: 'Jane', seats: 3 } }, 'Try again', /Read-only until Vdex can check your licence online/],
      [{ enabled: true, mode: 'released', canEdit: false, trialLeft: 0, seats: 3, licence: { name: 'Jane', seats: 3 } }, 'Activate here again', /this computer is not on your licence/],
      [{ enabled: true, mode: 'cancelled', canEdit: false, trialLeft: 0, seats: 3, licence: { name: 'Jane', seats: 3 } }, 'Buy · 20 USD', /licence has been cancelled/],
    ]) {
      ({ ctx, page } = await open(state, { width: 360 }));
      const bar = page.locator('.licence-bar'), btxt = await bar.innerText(), h = await bar.evaluate(b => b.getBoundingClientRect().height);
      ok(`read-only bar for "${state.mode}": "${button}", a short message, and a compact bar on a narrow window`, (await bar.getByRole('button', { name: button }).count()) === 1 && text.test(btxt) && (state.mode === 'cancelled' || !/Buy/.test(btxt)) && !/jane mcdonald/.test(btxt) && h < 150, `${Math.round(h)}px: ${btxt.replace(/\n/g, ' | ')}`);
      if (state.mode === 'pending') {
        await page.evaluate(() => import('./js/util.js').then(u => u.toast('Saved')));
        const z = await page.evaluate(() => { const t = getComputedStyle(document.querySelector('.toast')), b = getComputedStyle(document.querySelector('.licence-bar')); return { above: Number(t.zIndex) > Number(b.zIndex), through: t.pointerEvents === 'none' }; });
        ok('messages show above the licence bar, and clicks still reach its buttons', z.above && z.through, JSON.stringify(z));
      }
      await ctx.close();
    }

    // The website's offline copy never stands in for the shop's pages.
    {
      const c = await browser.newContext({ viewport: { width: 420, height: 860 } });
      await c.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
      await c.addInitScript(acceptTerms());
      const p = await c.newPage();
      await p.goto(URL); await p.waitForSelector('#rolodex .drum-btn');
      await p.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 20000 });
      const buy = await p.goto(URL + 'buy'), thanks = await p.goto(URL + 'licence/thanks?session_id=cs_test_abc');
      const app = await p.goto(URL + 'index.html');
      ok('with the offline copy installed, /buy and /licence/… still go to the server, not the app', buy.status() === 404 && thanks.status() === 404 && app.status() === 200, `${buy.status()} ${thanks.status()}`);
      await c.close();
    }

    // The download page.
    ({ ctx, page } = await open(null, { desktop: false, width: 360 }));
    const dl = await page.goto(URL + 'download.html');
    ok('the download page links the three installers, the shop and the steps, and fits a phone', dl.status() === 200 && (await page.locator('a.dl').count()) === 3 && (await page.getAttribute('a.buy', 'href')) === '/buy' && /Enter licence code/.test(await page.innerText('body')) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
    await ctx.close();
    ok('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();

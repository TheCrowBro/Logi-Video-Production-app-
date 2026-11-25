// The teleprompter shown elsewhere and driven from here (js/prompter.js): on a linked device (two browser contexts
// joined by the WebRTC link of js/link.js), and in a window of its own on a second screen (prompter.html,
// js/prompter-screen.js, over a BroadcastChannel). Takes are logged on the remote's log and travel with it.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const APP = process.env.VDEX_URL || 'http://localhost:8123/';
(async () => {
  // Host candidates as plain addresses, so two contexts of one browser can reach each other without mDNS.
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const device = async viewport => {
    const ctx = await browser.newContext({ viewport });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.route('https://stun.l.google.com/**', r => r.abort());
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); if (!localStorage.getItem('logi-prompter')) localStorage.setItem('logi-prompter', JSON.stringify({ count: 0 })); });
    await ctx.addInitScript(acceptTerms());
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(APP); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => window.logiGo('tcnotes')); await sleep(400);
    return { ctx, page };
  };
  const state = (page, sel = '.prompter') => page.evaluate(s => document.querySelector(s)?.dataset.state || '', sel);
  const nowLine = (page, sel = '.pr-line.now') => page.evaluate(s => document.querySelector(s)?.textContent || '', sel);
  const takes = page => page.evaluate(() => import('./js/store.js').then(s => s.db.logs.find(l => l.practice).notes.filter(n => n.kind === 'roll').map(n => ({ text: n.text, dur: n.dur || '', rate: n.rate || '' }))));

  /* ---------------- a phone as the remote of a linked device ---------------- */
  const { page: A } = await device({ width: 420, height: 880 }), { page: B } = await device({ width: 844, height: 390 });
  await A.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(500);
  const offer = await A.evaluate(() => import('./js/link.js').then(l => l.createOffer()));
  const answer = await B.evaluate(code => import('./js/link.js').then(l => l.acceptOffer(code)), offer);
  await A.evaluate(code => import('./js/link.js').then(l => l.acceptAnswer(code)), answer);
  for (let i = 0; i < 40 && (await A.evaluate(() => import('./js/link.js').then(l => l.link.status))) !== 'connected'; i++) await sleep(250);
  await sleep(1200);
  ok('two devices linked, and the open log with its script reached the other', (await B.evaluate(() => import('./js/store.js').then(s => !!(s.db.logs.find(l => l.practice) || {}).script))));
  await A.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.showView('prompter'))); await sleep(400);
  ok('the Prompter view offers to prompt on the linked device', /^🔗 Prompt on /.test(await A.locator('.pr-on-peer').innerText()));
  await A.locator('.pr-on-peer').click(); await B.waitForSelector('.prompter', { timeout: 6000 }); await sleep(600);
  ok('Prompt on… opens the prompter there and the remote here', (await A.locator('.pr-remote').count()) === 1 && (await B.locator('.prompter').count()) === 1 && /paused · \d+:\d\d left/.test(await A.locator('.pr-rstatus').innerText()), await A.locator('.pr-rstatus').innerText());
  await A.locator('.pr-remote .pr-next').click(); await sleep(500);
  ok('▼ on the remote moves the prompter a line, and the remote lights it', /^Every batch/.test(await nowLine(B)) && /^Every batch/.test(await A.locator('.pr-ritem.now').innerText()));
  await A.locator('.pr-remote .pr-play').click(); await sleep(900);
  ok('Play on the remote runs it there, and the remote says so', (await state(B)) === 'running' && /^running/.test(await A.locator('.pr-rstatus').innerText()));
  await A.locator('.pr-remote .pr-play').click(); await sleep(400);
  await A.locator('.pr-ritem', { hasText: 'That colour' }).locator('button').click(); await sleep(500);
  ok('a tap on a line in the remote’s script sends the prompter there', /^That colour/.test(await nowLine(B)), await nowLine(B));
  await A.keyboard.press('r'); await sleep(1100);
  ok('R on the remote rolls: a pickup take from that line, running there with REC showing', (await state(B)) === 'running' && (await B.evaluate(() => !document.querySelector('.pr-rec').hidden)) && /^● REC take 1/.test(await A.locator('.pr-rstatus').innerText()));
  await A.keyboard.press('r'); await sleep(500);
  ok('R again cuts: it stops there, and the remote asks how the take went', (await state(B)) === 'paused' && (await A.locator('.pr-remote .pr-ratebox').isVisible()));
  await A.screenshot({ path: S + '/prompter-remote.png' });
  await A.keyboard.press('g'); await sleep(900);
  const tb = await takes(B);
  ok('the take, its length and its rating reach the other device with the log', tb.length === 1 && tb[0].text === '▶ Take 1 (pickup)' && /^0:0\d$/.test(tb[0].dur) && tb[0].rate === 'good', JSON.stringify(tb));
  await A.locator('.pr-remote .pr-settings').click(); await A.waitForSelector('.sheet .pref[aria-label="Mirror"]');
  await A.locator('.sheet .pref[aria-label="Mirror"] button', { hasText: 'Mirrored' }).click(); await sleep(500);
  ok('the remote’s ⚙ changes the other screen’s settings (mirrored for its rig)', await B.evaluate(() => document.querySelector('.pr-stage').classList.contains('mirror')));
  await A.keyboard.press('Escape'); await sleep(200);
  await A.locator('.pr-remote .pr-close').click(); await sleep(700);
  ok('closing the remote closes the prompter there', (await B.locator('.prompter').count()) === 0 && (await A.locator('.pr-remote').count()) === 0 && !(await A.evaluate(() => document.getElementById('app').inert)));
  ok('no errors on either device', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].join(' | '));

  /* ---------------- a computer: the prompter in a window on a second screen ---------------- */
  const { page } = await device({ width: 1280, height: 800 });
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(500);
  await page.locator('.tc-modes button', { hasText: 'Prompter' }).click(); await sleep(400);
  const [win] = await Promise.all([page.waitForEvent('popup'), page.locator('.pr-on-window').click()]);
  const werrors = []; win.on('pageerror', e => werrors.push(e.message));
  await win.waitForSelector('.pr-line', { timeout: 8000 }); await sleep(300);
  ok('🖥 Second screen opens the prompter in a window of its own, with the script, and this window as its remote', (await win.locator('.pr-line').count()) === 13 && (await page.locator('.pr-remote').count()) === 1 && /second screen/.test(await page.locator('.pr-remote .pr-title').innerText()));
  ok('…the window holds no data of its own: it has no app, no lock, only the stage', (await win.locator('#app, .lock').count()) === 0 && (await win.locator('.pr-stage').count()) === 1);
  await page.locator('.pr-remote .pr-play').click(); await sleep(900);
  ok('Play on the remote runs the window', (await state(win)) === 'running');
  await win.keyboard.press('Space'); await sleep(400);
  ok('Space pressed in the window pauses it, and the remote follows', (await state(win)) === 'paused' && (await page.locator('.pr-remote .pr-play').innerText()) === '▶ Play');
  await win.keyboard.press('r'); await sleep(900);
  ok('R pressed in the window rolls a take on the log in the main window', (await takes(page)).length === 1 && (await state(win)) === 'running');
  await win.keyboard.press('r'); await sleep(500); await win.keyboard.press('n'); await sleep(300);
  ok('…R cuts, and N rates it', (await takes(page))[0].rate === 'ng');
  await page.locator('.pr-remote .pr-settings').click(); await page.waitForSelector('.sheet .pref[aria-label="Line spacing"]');
  await page.locator('.sheet .pref[aria-label="Line spacing"] button', { hasText: 'Loose' }).click(); await sleep(400);
  ok('the remote’s ⚙ sets the window’s line spacing', (await win.evaluate(() => document.querySelector('.pr-col').style.lineHeight)) === '1.6');
  await page.keyboard.press('Escape'); await sleep(200);
  await win.screenshot({ path: S + '/prompter-window.png' });
  await page.locator('.pr-remote .pr-close').click(); await sleep(800);
  ok('closing the remote closes the window and gives the page back', win.isClosed() && (await page.locator('.pr-remote').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
  ok('no errors with a second screen', page.errors.length === 0 && werrors.length === 0, [...page.errors, ...werrors].join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL the prompter remote spec crashed — ' + (e && e.stack || e)); process.exit(1); });

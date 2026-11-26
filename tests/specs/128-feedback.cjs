// Report a problem or send feedback: its own button at the top of Settings, apart from the fold-downs, which opens an
// email to the support address with the version, where Vdex runs and the errors met since it opened filled in, and
// nothing from the person's records.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = [], made = /probe (failure|rejection)/; // the errors this spec makes on purpose are not the app's
  page.on('pageerror', e => { if (!made.test(e.message)) errors.push(e.message); });
  page.on('console', m => { if ((m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) && !made.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const own = await page.evaluate(() => import('./js/store.js').then(s => [...s.db.bookings.map(b => b.title), ...s.db.crew.map(c => c.name), ...s.db.gear.map(g => g.name)].filter(t => t && t.length > 3)));
  await page.evaluate(() => window.logiGo('settings')); await sleep(450);

  // ---- the button: at the top, on its own, seen without opening anything ----
  const place = await page.evaluate(() => {
    const card = document.querySelector('#page .feedback-card'), btn = card && card.querySelector('button.feedback-btn');
    if (!btn) return null;
    const first = document.querySelector('#page details.settings-group, #page details.settings-section'), r = btn.getBoundingClientRect();
    return { text: btn.textContent, inFold: !!btn.closest('details'), before: !!first && !!(card.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING), seen: r.top >= 0 && r.bottom <= innerHeight && r.width > 0, primary: btn.classList.contains('primary'), wide: r.width / card.getBoundingClientRect().width };
  });
  ok('Settings has its own Report a problem or send feedback button, above the fold-downs and outside them, on screen without opening anything', !!place && /Report a problem or send feedback/.test(place.text) && !place.inFold && place.before && place.seen && place.primary && place.wide > 0.8, JSON.stringify(place));

  // ---- the sheet: two emails to the support address, with the details and nothing of the person's own ----
  await page.locator('#page .feedback-btn').click(); await page.waitForSelector('.sheet .feedback');
  const read = () => page.evaluate(() => ({ title: document.querySelector('.sheet h2, .sheet .sheet-title')?.textContent || '', problem: document.querySelector('.sheet .feedback-problem')?.getAttribute('href') || '', idea: document.querySelector('.sheet .feedback-idea')?.getAttribute('href') || '', shown: document.querySelector('.sheet .feedback-details')?.textContent || '' }));
  let s = await read();
  const mail = href => { const u = new URL(href); return { to: decodeURIComponent(u.pathname), subject: u.searchParams.get('subject') || '', body: u.searchParams.get('body') || '' }; };
  const p = mail(s.problem), i = mail(s.idea), version = await page.evaluate(() => import('./js/version.js').then(v => v.VERSION));
  ok('Report a problem is an email to support@crowmade.app with the version in its subject and the questions to answer', p.to === 'support@crowmade.app' && p.subject.includes(version) && /problem/i.test(p.subject) && /What happened:/.test(p.body) && /What you expected instead:/.test(p.body), JSON.stringify({ to: p.to, subject: p.subject }));
  ok('Send an idea or feedback is an email to the same address with a subject of its own', i.to === 'support@crowmade.app' && i.subject.includes(version) && /feedback/i.test(i.subject) && /Your idea or feedback:/.test(i.body), JSON.stringify({ to: i.to, subject: i.subject }));
  ok('both emails carry the details the sheet shows: the version, where Vdex runs, the browser, the window, the display, the language, the storage and the connection', [p.body, i.body].every(b => b.includes(s.shown.trim())) && new RegExp(`^Vdex ${version.replace(/\./g, '\\.')}`).test(s.shown) && /Running as: the website, in a browser/.test(s.shown) && /Browser: Mozilla/.test(s.shown) && /Window: 420 × 900/.test(s.shown) && /Display: /.test(s.shown) && /Language: /.test(s.shown) && /Storage: this device only/.test(s.shown) && /Connection: online/.test(s.shown) && /Errors since Vdex opened: none/.test(s.shown), s.shown);
  const leaked = own.filter(t => s.problem.includes(encodeURIComponent(t)) || s.shown.includes(t) || p.body.includes(t));
  ok('nothing from the bookings, crew or kit is in the email or the details shown', own.length > 5 && leaked.length === 0, JSON.stringify({ checked: own.length, leaked }));
  ok('the email is short enough for every email app (under 2,000 characters)', s.problem.length < 2000 && s.idea.length < 2000, `${s.problem.length}, ${s.idea.length}`);

  // ---- Copy, for a computer with no email app ----
  await page.locator('.sheet .feedback-copy').click(); await sleep(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const toasts = await page.evaluate(() => window.__toasts.splice(0));
  ok('Copy puts the address and the details on the clipboard and says where to paste them', clip.startsWith('To: support@crowmade.app') && clip.includes(s.shown.trim()) && toasts.some(t => /Copied\. Paste it into an email to support@crowmade\.app/.test(t)), JSON.stringify({ clip: clip.slice(0, 60), toasts }));
  await page.keyboard.press('Escape'); await sleep(300);

  // ---- the errors met since Vdex opened: the last few, in words, and no more than three in the email ----
  await page.evaluate(() => { setTimeout(() => { throw new Error('probe failure one'); }, 0); Promise.reject(new TypeError('probe rejection two')); });
  await sleep(300);
  await page.locator('#page .feedback-btn').click(); await page.waitForSelector('.sheet .feedback');
  s = await read();
  ok('an error and a rejected promise since Vdex opened are in the details', /Errors since Vdex opened:\n- Error: probe failure one|Errors since Vdex opened:\n- (Uncaught )?Error: probe failure one/.test(s.shown) && /- TypeError: probe rejection two/.test(s.shown), s.shown.split('Errors since')[1]);
  await page.keyboard.press('Escape'); await sleep(250);
  await page.evaluate(() => { for (let n = 3; n <= 8; n++) setTimeout(() => { throw new Error('probe failure ' + n); }, n); });
  await sleep(300);
  await page.locator('#page .feedback-btn').click(); await page.waitForSelector('.sheet .feedback');
  s = await read();
  const listed = (s.shown.split('Errors since Vdex opened:')[1] || '').split('\n').filter(l => l.startsWith('- '));
  ok('only the last three go in the email, newest last', listed.length === 3 && /probe failure 8/.test(listed[2]) && /probe failure 6/.test(listed[0]), JSON.stringify(listed));
  await page.keyboard.press('Escape'); await sleep(250);

  // ---- a narrow phone: nothing pushes the page sideways ----
  await page.setViewportSize({ width: 320, height: 700 }); await sleep(300);
  const wide = async () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const pageOver = await wide();
  await page.locator('#page .feedback-btn').click(); await page.waitForSelector('.sheet .feedback');
  const sheetOver = await page.evaluate(() => { const sh = document.querySelector('.sheet'); return Math.max(document.documentElement.scrollWidth - innerWidth, sh.scrollWidth - sh.clientWidth); });
  ok('at 320 px the button and its sheet fit the screen', pageOver <= 0 && sheetOver <= 0, JSON.stringify({ pageOver, sheetOver }));
  await page.keyboard.press('Escape'); await sleep(250);

  // ---- the desktop app says so ----
  const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vdex/1.5.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36' });
  await ctx2.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx2.addInitScript(acceptTerms());
  const d = await ctx2.newPage();
  await d.goto(BASE); await d.waitForSelector('#rolodex .drum-btn');
  const runs = await d.evaluate(() => import('./js/feedback.js').then(m => m.details().split('\n').find(l => l.startsWith('Running as:'))));
  ok('in the desktop app it says the desktop app and the system', runs === 'Running as: the desktop app on Windows', runs);
  await ctx2.close();

  ok('no errors other than the ones made here', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL the feedback spec crashed — ' + (e && e.stack || e)); process.exit(1); });

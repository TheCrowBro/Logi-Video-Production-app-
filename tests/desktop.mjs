#!/usr/bin/env node
// Desktop smoke test: launches the Electron app (under xvfb-run on Linux), checks the window, the local server,
// the update bridge, and that no page errors or policy violations occur.
import { _electron as electron, chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await electron.launch({ args: ['desktop/main.js', '--no-sandbox'], cwd: repo, env: { ...process.env, NODE_OPTIONS: '', VDEX_TEST_NO_BROWSER: '1' }, timeout: 60000 });
const win = await app.firstWindow({ timeout: 60000 });
const bad = []; win.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) bad.push(m.text()); }); win.on('pageerror', e => bad.push('pageerror: ' + e.message));
await win.waitForLoadState('domcontentloaded');
const { TERMS_RECORD } = createRequire(import.meta.url)('./helpers.cjs');
await win.evaluate(t => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); }, TERMS_RECORD); // no tour, terms agreed, no PIN set-up (a PIN left in the profile still asks below)
await win.reload();
// A PIN left in this computer's test profile asks first; one from before longer PINs is then offered a new one, once, and is kept.
const pastLock = async () => { if (!(await win.locator('.lock').count())) return; await win.keyboard.type('2468'); await win.waitForSelector('.pin-offer, #rolodex .drum-btn', { timeout: 30000 }); if (await win.locator('.pin-offer').count()) await win.getByRole('button', { name: 'Keep my current PIN' }).click(); };
await pastLock();
await win.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
const info = await win.evaluate(async () => ({ url: location.href, bridge: !!window.vdexDesktop, state: window.vdexDesktop && (await window.vdexDesktop.updateState()).status, serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length, licence: window.vdexDesktop && window.vdexDesktop.licence && (await window.vdexDesktop.licence.state()) }));
// Sign-ins open in the web browser and come back through the local server, only for sign-ins the app started.
const base = new URL(info.url).origin;
const signin = {};
signin.refusesOthers = (await win.evaluate(() => window.vdexDesktop.openSignIn('https://evil.example/oauth2/authorize?state=vdex-x'))) === false;
signin.opens = (await win.evaluate(() => window.vdexDesktop.openSignIn('https://www.dropbox.com/oauth2/authorize?client_id=k&state=vdex-desktoptest'))) === true
  && (await app.evaluate(() => global.__vdexLastExternal)).startsWith('https://www.dropbox.com/');
const stranger = await fetch(base + '/?state=vdex-unknown&code=x');
signin.ignoresUnknown = stranger.ok && /has expired/.test(await stranger.text()); // never the app itself in the web browser
const back = await fetch(base + '/?state=vdex-desktoptest&code=abc');
signin.tellsTab = back.ok && /close this tab/.test(await back.text());
await win.waitForURL(u => /code=abc/.test(u.toString()) || !/state=/.test(u.toString()), { timeout: 15000 }).catch(() => {});
await win.waitForLoadState('domcontentloaded'); await new Promise(r => setTimeout(r, 800));
await pastLock(); // the PIN asks again after the reload
await win.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
signin.handsBack = !/state=vdex-desktoptest/.test(win.url()) && /out of date/.test(await win.evaluate(() => import('./js/store.js').then(s => s.cloud.notice))); 
signin.onceOnly = /has expired/.test(await (await fetch(base + '/?state=vdex-desktoptest&code=abc')).text());
signin.noWorkerHere = (await fetch(base + '/sw.js')).status === 404;
await win.evaluate(() => { window.__g = window.vdexDesktop.googleSignIn({ client: 'c.apps.googleusercontent.com', scope: 'https://www.googleapis.com/auth/drive.appdata', hint: 'h@example.com' }); });
await new Promise(r => setTimeout(r, 300));
const gUrl = await app.evaluate(() => global.__vdexLastExternal);
const gPage = await fetch(gUrl);
const gHtml = await gPage.text();
signin.googlePage = gPage.ok && /Continue with Google/.test(gHtml) && /h@example\.com/.test(gHtml) && /script-src 'nonce-/.test(gPage.headers.get('content-security-policy') || '');
const key = (gHtml.match(/"key":"([^"]+)"/) || [])[1];
const answer = JSON.stringify({ access_token: 'gt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.appdata' });
signin.googleNeedsPage = (await fetch(gUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: answer })).status === 403
  && (await fetch(gUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-Vdex-Key': key }, body: answer })).status === 403
  && (await fetch(gUrl)).status === 404; // the page is served once
const post = await fetch(gUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Vdex-Key': key }, body: answer });
const got = await win.evaluate(() => window.__g);
signin.googleAnswer = post.status === 204 && got.access_token === 'gt';
signin.googleOnce = (await fetch(gUrl)).status === 404 && (await fetch(base + '/__vdex/google?n=guess')).status === 404;
// Apple (iCloud): the same one-time page, with its own token checks, and a newer Connect replacing a waiting one
signin.icloudRefusesOdd = (await win.evaluate(() => window.vdexDesktop.icloudSignIn({ container: 'not a container', apiToken: 'x' }))).error === 'refused';
await win.evaluate(() => { window.__a1 = window.vdexDesktop.icloudSignIn({ container: 'iCloud.test.vdex', apiToken: 'abc123' }); });
await new Promise(r => setTimeout(r, 300));
await win.evaluate(() => { window.__a = window.vdexDesktop.icloudSignIn({ container: 'iCloud.test.vdex', apiToken: 'abc123' }); });
await new Promise(r => setTimeout(r, 300));
const aUrl = await app.evaluate(() => global.__vdexLastExternal);
signin.icloudReplaces = (await win.evaluate(() => window.__a1)).error === 'replaced';
signin.icloudNotGoogle = (await fetch(aUrl.replace('/__vdex/icloud', '/__vdex/google'))).status === 404;
const aPage = await fetch(aUrl), aHtml = await aPage.text(), aCsp = aPage.headers.get('content-security-policy') || '';
signin.icloudPage = /\/__vdex\/icloud\?n=/.test(aUrl) && aPage.ok && /Continue with Apple/.test(aHtml) && /iCloud\.test\.vdex/.test(aHtml) && /connect-src 'self' https:\/\/api\.apple-cloudkit\.com/.test(aCsp) && /script-src 'nonce-/.test(aCsp);
// the pages' own scripts must be valid JavaScript once served (escaping inside the template is easy to get wrong)
const parses = html => [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)].every(m => { try { new Function(m[1]); return true; } catch { return false; } }) && /<script nonce="[^"]+">/.test(html);
signin.pagesParse = parses(gHtml) && parses(aHtml);
const aKey = (aHtml.match(/"key":"([^"]+)"/) || [])[1];
const aPost = await fetch(aUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Vdex-Key': aKey }, body: JSON.stringify({ ckSession: 'ck-session-1' }) });
signin.icloudAnswer = aPost.status === 204 && (await win.evaluate(() => window.__a)).ckSession === 'ck-session-1' && (await fetch(aUrl)).status === 404;
// The licence bridge answers, and with no licence keys built in yet (desktop/licence-keys.json is empty) nobody is
// asked for a code; a refused caller (a page that is not the app) gets nothing.
const keysIn = Object.keys(JSON.parse((await import('node:fs')).readFileSync(resolve(repo, 'desktop/licence-keys.json'), 'utf8'))).length > 0;
const licenceOk = !!info.licence && info.licence.canEdit === true && (keysIn ? ['trial', 'founder', 'licensed'].includes(info.licence.mode) : info.licence.mode === 'off');
console.log((licenceOk ? 'PASS' : 'FAIL') + ' desktop licence bridge answers' + (keysIn ? '' : ' and stays out of the way until licence keys are built in') + ' —', JSON.stringify(info.licence));
// The price with tax for Buy: the main process asks the licence server and passes on only the price's shape (or
// nothing, offline or before the server has the address). It must never throw.
const priced = await win.evaluate(() => window.vdexDesktop.licence.localPrice().then(p => ({ p }), e => ({ error: String(e && e.message) })));
const priceOk = !priced.error && (priced.p === null || (typeof priced.p === 'object' && 'taxed' in priced.p && (priced.p.taxed === null || /^\d+\.\d\d$/.test(priced.p.taxed.total))));
console.log((priceOk ? 'PASS' : 'FAIL') + ' the desktop bridge answers the price with tax (or nothing) without failing —', JSON.stringify(priced));
// The privacy policy links to the deletion page: the app's own server must serve it (package.json lists it for the installers; spec 99 checks that list).
const policy = await (await fetch(base + '/privacy.html')).text(), deletion = await fetch(base + '/delete-account.html');
const deletionOk = /href="delete-account\.html"/.test(policy) && deletion.status === 200 && /^text\/html/.test(deletion.headers.get('content-type') || '') && /support@crowmade\.app/.test(await deletion.text());
console.log((deletionOk ? 'PASS' : 'FAIL') + ' the desktop app serves the deletion page the privacy policy links to');
// The app's local address opened in an ordinary web browser (not the app's window, so no desktop licence): the
// website's licence check runs there, finds no licence server at that address (the app's server answers with its own
// page), and so licences are on: a 30-day trial, then read-only, like any other browser (report item 1).
const browser = await chromium.launch();
const inBrowser = {};
try {
  const ctx = await browser.newContext();
  await ctx.addInitScript(t => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-terms', t); localStorage.setItem('logi-lock-setup', 'skip'); }, TERMS_RECORD);
  const tab = await ctx.newPage();
  const look = () => tab.evaluate(() => import('./js/licence.js').then(async m => { await m.initLicence(); const s = m.licenceState(), store = await import('./js/store.js'); return { bridge: !!window.vdexDesktop, mode: s && s.mode, trialLeft: s && s.trialLeft, canEdit: s && s.canEdit, paid: store.isPaid(), changed: store.update(d => { d.profile = { ...d.profile, name: 'Browser ' + Date.now() }; }) }; }));
  await tab.goto(base + '/'); await tab.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
  inBrowser.first = await look();
  // As if the browser had first opened it 31 days ago (an earlier version's stored "off" included): read-only.
  await tab.evaluate(() => localStorage.setItem('vdex-licence', JSON.stringify({ on: false, statusAt: Date.now() - 7 * 3600e3, first: Date.now() - 31 * 86400e3, seen: Date.now() - 60e3 })));
  await tab.reload(); await tab.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
  inBrowser.later = await look();
  await ctx.close();
} finally { await browser.close(); }
const browserOk = !inBrowser.first.bridge && inBrowser.first.mode === 'trial' && inBrowser.first.trialLeft === 30 && inBrowser.first.paid === false && inBrowser.first.changed === true
  && inBrowser.later.mode === 'ended' && inBrowser.later.canEdit === false && inBrowser.later.changed === false && inBrowser.later.paid === false;
console.log((browserOk ? 'PASS' : 'FAIL') + ' the app\'s local address in an ordinary web browser gets the website\'s trial and then read-only, not a free Vdex —', JSON.stringify(inBrowser));
const signinOk = Object.values(signin).every(Boolean);
console.log((signinOk ? 'PASS' : 'FAIL') + ' desktop sign-ins open in the web browser and come back only for sign-ins the app started —', JSON.stringify(signin));
await app.close();
const ok = licenceOk && signinOk && priceOk && deletionOk && browserOk && /^http:\/\/localhost:4783\d\/$/.test(info.url) && info.bridge && info.state === 'dev' && info.serviceWorkers === 0 && bad.length === 0;
console.log((ok ? 'PASS' : 'FAIL') + ' desktop app launches, serves locally, exposes the update bridge, keeps no service worker, no errors —', JSON.stringify(info), bad.join(' | '));
process.exit(ok ? 0 : 1);

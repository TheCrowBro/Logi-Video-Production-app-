#!/usr/bin/env node
// Desktop smoke test: launches the Electron app (under xvfb-run on Linux), checks the window, the local server,
// the update bridge, and that no page errors or policy violations occur.
import { _electron as electron } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await electron.launch({ args: ['desktop/main.js', '--no-sandbox'], cwd: repo, env: { ...process.env, NODE_OPTIONS: '', VDEX_TEST_NO_BROWSER: '1' }, timeout: 60000 });
const win = await app.firstWindow({ timeout: 60000 });
const bad = []; win.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) bad.push(m.text()); }); win.on('pageerror', e => bad.push('pageerror: ' + e.message));
await win.waitForLoadState('domcontentloaded');
await win.evaluate(() => localStorage.setItem('logi-tour', 'done'));
await win.reload();
if (await win.locator('.lock').count()) await win.keyboard.type('2468');
await win.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
const info = await win.evaluate(async () => ({ url: location.href, bridge: !!window.vdexDesktop, state: window.vdexDesktop && (await window.vdexDesktop.updateState()).status, serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length }));
// Sign-ins open in the web browser and come back through the local server, only for sign-ins the app started.
const base = new URL(info.url).origin;
const signin = {};
signin.refusesOthers = (await win.evaluate(() => window.vdexDesktop.openSignIn('https://evil.example/oauth2/authorize?state=vdex-x'))) === false;
signin.opens = (await win.evaluate(() => window.vdexDesktop.openSignIn('https://www.dropbox.com/oauth2/authorize?client_id=k&state=vdex-desktoptest'))) === true
  && (await app.evaluate(() => global.__vdexLastExternal)).startsWith('https://www.dropbox.com/');
const stranger = await fetch(base + '/?state=vdex-unknown&code=x');
signin.ignoresUnknown = stranger.ok && /<title>Vdex<\/title>/.test(await stranger.text());
const back = await fetch(base + '/?state=vdex-desktoptest&code=abc');
signin.tellsTab = back.ok && /close this tab/.test(await back.text());
await win.waitForURL(u => /code=abc/.test(u.toString()) || !/state=/.test(u.toString()), { timeout: 15000 }).catch(() => {});
await win.waitForLoadState('domcontentloaded'); await new Promise(r => setTimeout(r, 800));
if (await win.locator('.lock').count()) await win.keyboard.type('2468'); // a PIN left in this computer's test profile asks again after the reload
await win.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
signin.handsBack = !/state=vdex-desktoptest/.test(win.url()) && /did not come from this device/.test(await win.evaluate(() => import('./js/store.js').then(s => s.cloud.notice))); 
signin.onceOnly = /<title>Vdex<\/title>/.test(await (await fetch(base + '/?state=vdex-desktoptest&code=abc')).text());
await win.evaluate(() => { window.__g = window.vdexDesktop.googleSignIn({ client: 'c.apps.googleusercontent.com', scope: 'https://www.googleapis.com/auth/drive.appdata', hint: 'h@example.com' }); });
await new Promise(r => setTimeout(r, 300));
const gUrl = await app.evaluate(() => global.__vdexLastExternal);
const gPage = await fetch(gUrl);
const gHtml = await gPage.text();
signin.googlePage = gPage.ok && /Continue with Google/.test(gHtml) && /h@example\.com/.test(gHtml) && /script-src 'nonce-/.test(gPage.headers.get('content-security-policy') || '');
const post = await fetch(gUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: 'gt', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.appdata' }) });
const got = await win.evaluate(() => window.__g);
signin.googleAnswer = post.status === 204 && got.access_token === 'gt';
signin.googleOnce = (await fetch(gUrl)).status === 404 && (await fetch(base + '/__vdex/google?n=guess')).status === 404;
const signinOk = Object.values(signin).every(Boolean);
console.log((signinOk ? 'PASS' : 'FAIL') + ' desktop sign-ins open in the web browser and come back only for sign-ins the app started —', JSON.stringify(signin));
await app.close();
const ok = signinOk && /^http:\/\/localhost:4783\d\/$/.test(info.url) && info.bridge && info.state === 'dev' && info.serviceWorkers === 0 && bad.length === 0;
console.log((ok ? 'PASS' : 'FAIL') + ' desktop app launches, serves locally, exposes the update bridge, keeps no service worker, no errors —', JSON.stringify(info), bad.join(' | '));
process.exit(ok ? 0 : 1);

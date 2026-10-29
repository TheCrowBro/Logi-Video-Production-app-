#!/usr/bin/env node
// Desktop smoke test: launches the Electron app (under xvfb-run on Linux), checks the window, the local server,
// the update bridge, and that no page errors or policy violations occur.
import { _electron as electron } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = await electron.launch({ args: ['desktop/main.js', '--no-sandbox'], cwd: repo, env: { ...process.env, NODE_OPTIONS: '' }, timeout: 60000 });
const win = await app.firstWindow({ timeout: 60000 });
const bad = []; win.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) bad.push(m.text()); }); win.on('pageerror', e => bad.push('pageerror: ' + e.message));
await win.waitForLoadState('domcontentloaded');
await win.evaluate(() => localStorage.setItem('logi-tour', 'done'));
await win.reload();
if (await win.locator('.lock').count()) await win.keyboard.type('2468');
await win.waitForSelector('#rolodex .drum-btn', { timeout: 30000 });
const info = await win.evaluate(async () => ({ url: location.href, bridge: !!window.vdexDesktop, state: window.vdexDesktop && (await window.vdexDesktop.updateState()).status, serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length }));
await app.close();
const ok = /^http:\/\/localhost:4783\d\/$/.test(info.url) && info.bridge && info.state === 'dev' && info.serviceWorkers === 0 && bad.length === 0;
console.log((ok ? 'PASS' : 'FAIL') + ' desktop app launches, serves locally, exposes the update bridge, keeps no service worker, no errors —', JSON.stringify(info), bad.join(' | '));
process.exit(ok ? 0 : 1);

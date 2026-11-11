// Shared by the browser specs: a browser with Gigdex open on a phone-sized screen, the welcome tour marked as seen,
// errors collected, and a PASS / FAIL printer the runner counts.
//   const { open, ok, sleep } = require('../helpers.cjs');
//   const { browser, page, errors } = await open({ sample: true });
const { chromium } = require('playwright');
const BASE = process.env.GIGDEX_URL || 'http://localhost:8124/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
async function open({ sample = false, viewport = { width: 420, height: 900 }, tab = null, init = null, permissions = [] } = {}) {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true, permissions });
  await ctx.addInitScript(() => { try { localStorage.setItem('gigdex-tour', 'done'); } catch (e) { /* ignore */ } });
  if (init) await ctx.addInitScript(init);
  await ctx.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://*.tile.openstreetmap.org/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('#rolodex .drum-btn');
  if (sample) { await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(150); }
  if (tab) { await page.evaluate(t => window.logiGo(t), tab); await sleep(400); }
  return { browser, ctx, page, errors };
}
// Opens a section by id and waits for it to draw.
const go = async (page, id) => { await page.evaluate(t => window.logiGo(t), id); await sleep(400); };
// The top sheet (a form or panel), or null.
const topSheet = page => page.locator('.sheet').last();
module.exports = { open, ok, sleep, go, topSheet, BASE };

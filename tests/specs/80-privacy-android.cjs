// The privacy policy page, its link from Settings → About, and the Android package's agreement with the site.
const { chromium } = require('playwright');
const fs = require('fs');
const ROOT = process.env.VDEX_ROOT;
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });

  // The policy page itself
  const r = await page.goto(BASE + 'privacy.html');
  ok('privacy.html is served', !!r && r.status() === 200);
  ok('it is titled as the privacy policy', /privacy/i.test(await page.title()));
  const text = await page.evaluate(() => document.body.innerText);
  ok('it carries a last-updated date', /Last updated \d{1,2} \w+ \d{4}/.test(text));
  for (const s of ['Open-Meteo', 'OpenStreetMap', 'Dropbox', 'Google', 'Microsoft', 'GitHub', 'Camera', 'Microphone', 'Location']) ok(`it covers ${s}`, text.includes(s));
  ok('it fits a phone without sideways scrolling', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  ok('its back link returns to the app', (await page.locator('a.back').getAttribute('href')) === './');

  // Reachable from the app, and kept offline with it
  await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => window.logiGo('settings'));
  await page.locator('details.settings-section:has(> summary:has-text("About")) > summary').click();
  const link = page.locator('details.settings-section:has(> summary:has-text("About")) a[href="privacy.html"]');
  ok('Settings → About links the privacy policy', (await link.count()) === 1 && /Privacy policy/.test(await link.innerText()));
  const [popup] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
  await popup.waitForLoadState();
  ok('the link opens the policy page', /privacy\.html$/.test(popup.url()), popup.url());
  await popup.close();
  await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 20000 });
  const cachedPolicy = await page.evaluate(async () => { const c = await caches.open('logi-dev'); return !!(await c.match(new URL('privacy.html', location.href).href)); });
  ok('the policy is part of the offline set', cachedPolicy);

  // The Android package and the site agree
  const links = JSON.parse(fs.readFileSync(ROOT + '/.well-known/assetlinks.json', 'utf8'));
  const twa = JSON.parse(fs.readFileSync(ROOT + '/android/twa-manifest.json', 'utf8'));
  const version = /VERSION = '([^']+)'/.exec(fs.readFileSync(ROOT + '/js/version.js', 'utf8'))[1];
  const gradle = fs.readFileSync(ROOT + '/android/app/build.gradle', 'utf8');
  ok('asset links name the Android package', links[0].target.package_name === twa.packageId, twa.packageId);
  ok('asset links carry certificate fingerprints', links[0].target.sha256_cert_fingerprints.length > 0 && links[0].target.sha256_cert_fingerprints.every(f => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)));
  ok('the Android app opens the live site', twa.host === 'thecrowbro.github.io' && twa.startUrl.startsWith('/Logi-Video-Production-app-/'));
  ok('the Android version matches the app version', twa.appVersionName === version, `${twa.appVersionName} vs ${version}`);
  ok('the Android project carries the same version', gradle.includes(`versionName "${version}"`));
  ok('the Android app targets Android 16 (API 36), as Google Play requires', /targetSdkVersion 36/.test(gradle));
  ok('only the encrypted upload key is in the tree', fs.existsSync(ROOT + '/android/upload-key.keystore.enc') && !fs.existsSync(ROOT + '/android/upload-key.keystore'));
  ok('the store kit has the icon and feature graphic', fs.existsSync(ROOT + '/store/android/icon-512.png') && fs.existsSync(ROOT + '/store/android/feature-graphic.jpg'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + e.message); process.exit(1); });

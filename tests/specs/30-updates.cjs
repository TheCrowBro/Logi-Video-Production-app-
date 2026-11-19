const { chromium } = require('playwright');
const { acceptTerms, openSetting } = require('../helpers.cjs');
const fs = require('fs');
const { spawnSync } = require('child_process');
const ROOT = process.env.VDEX_ROOT;
const swPath = ROOT + '/sw.js', verPath = ROOT + '/js/version.js', laterPath = ROOT + '/later-page.html', laterJs = ROOT + '/js/later-page.js', utilPath = ROOT + '/js/util.js';
const origSw = fs.readFileSync(swPath, 'utf8'), origVer = fs.readFileSync(verPath, 'utf8'), origUtil = fs.readFileSync(utilPath, 'utf8');
const restore = () => { fs.writeFileSync(swPath, origSw); fs.writeFileSync(verPath, origVer); fs.writeFileSync(utilPath, origUtil); fs.rmSync(laterPath, { force: true }); fs.rmSync(laterJs, { force: true }); };
process.on('exit', restore);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' })); // no live weather calls in tests
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(process.env.VDEX_URL || 'http://localhost:8123/'); await page.waitForSelector('#rolodex .drum-btn');
  await page.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 20000 });
  const keys1 = await page.evaluate(() => caches.keys());
  ok('service worker installed with the dev cache', keys1.includes('logi-dev'), keys1.join(','));
  const cached = await page.evaluate(async () => (await (await caches.open('logi-dev')).keys()).length);
  ok('all app files precached', cached >= 48, cached + ' entries');
  ok('no "updated" bar on a fresh install', (await page.locator('.update-bar').count()) === 0);
  // A page this installed build does not hold: a newer build added it, and a link to it is opened before this copy has
  // updated. The worker asks the server for it; only an address the server has nothing for, or no connection, gets the app.
  const base = process.env.VDEX_URL || 'http://localhost:8123/';
  // The later page has a script of its own, which needs something the later build added to a module this build
  // also holds (js/util.js, here with one more export on the server than in the installed copy).
  fs.writeFileSync(laterPath, '<!doctype html><meta charset="utf-8"><title>A later page</title><p id="later">Added by a later build.</p><script type="module" src="js/later-page.js"></script>');
  fs.writeFileSync(laterJs, "import { h, brandNew } from './util.js';\ndocument.getElementById('later').dataset.ran = brandNew;\ndocument.body.append(h('p', null, 'The later page ran.'));\n");
  fs.writeFileSync(utilPath, origUtil + "\nexport const brandNew = 'with the later build';\n");
  const other = await ctx.newPage();
  const seen = () => other.evaluate(async () => ({ title: document.title, own: !!document.getElementById('later'), ran: (document.getElementById('later') || { dataset: {} }).dataset.ran || '', app: !!document.getElementById('rolodex'), controlled: !!navigator.serviceWorker.controller, hash: location.hash, kept: (await (await caches.open('logi-dev')).keys()).filter(r => /later-page|no-such-page/.test(r.url)).length }));
  await other.goto(base + 'later-page.html#1.abc'); await sleep(300);
  const later = await seen();
  ok('a page the installed build does not hold is fetched from the server and shown as itself, not replaced by the app, with the link’s fragment still in the address', later.controlled && later.title === 'A later page' && later.own && !later.app && later.hash === '#1.abc', JSON.stringify(later));
  ok('…what that page loads comes from the server too, so its script runs with the later build’s modules, not with the installed ones', later.ran === 'with the later build', JSON.stringify(later));
  ok('…and neither the page nor anything it loaded is added to the offline copy, which stays one build’s files', later.kept === 0 && (await page.evaluate(async () => (await (await caches.open('logi-dev')).keys()).length)) === cached, JSON.stringify(later));
  await other.goto(base + 'no-such-page.html'); await other.waitForSelector('#rolodex .drum-btn', { timeout: 20000 }).catch(() => {});
  const none = await seen();
  ok('an address the server has no page for still opens the app', none.controlled && none.title === 'Vdex' && none.app && none.kept === 0, JSON.stringify(none));
  await ctx.setOffline(true);
  await other.goto(base + 'later-page.html').catch(() => {}); await other.waitForSelector('#rolodex .drum-btn', { timeout: 20000 }).catch(() => {});
  const cut = await seen().catch(e => ({ error: e.message }));
  await ctx.setOffline(false);
  ok('…and so does that later page while there is no connection', cut.title === 'Vdex' && cut.app && !cut.own, JSON.stringify(cut));
  await other.close(); fs.rmSync(laterPath, { force: true }); fs.rmSync(laterJs, { force: true }); fs.writeFileSync(utilPath, origUtil);
  ok('…while this build’s own pages keep its own copy of that module', !/brandNew/.test(await page.evaluate(() => fetch('js/util.js').then(r => r.text()))));
  // The offline copy gone (the next cases show one way it goes): the next start with a connection puts back what it
  // fetches, the app's own page among it, so that Vdex opens again without one. (On a page of its own: a start with
  // no connection logs the requests that fail, which are not errors of the app.)
  const lost = await ctx.newPage();
  const held = () => lost.evaluate(async () => { const keys = (await (await caches.open('logi-dev')).keys()).map(r => new URL(r.url).pathname); return { files: keys.length, page: keys.filter(k => /\/(index\.html)?$/.test(k)).length }; });
  await lost.goto(base); await lost.waitForSelector('#rolodex .drum-btn');
  await lost.evaluate(() => caches.delete('logi-dev'));
  await lost.reload(); await lost.waitForSelector('#rolodex .drum-btn'); await sleep(800);
  const refilled = await held();
  await ctx.setOffline(true);
  const offline = await lost.reload().then(async () => { await lost.waitForSelector('#rolodex .drum-btn', { timeout: 15000 }); return 'opened'; }).catch(e => String(e.message).split('\n')[0]);
  await ctx.setOffline(false);
  ok('after the offline copy was lost, a start with a connection keeps the app’s own page again with the files it fetched', refilled.page >= 1 && refilled.files > 20, JSON.stringify(refilled));
  ok('…so the next start without a connection opens Vdex', offline === 'opened', offline);
  await lost.close();

  // An older worker that wakes while a new build installs. This runs on an address of its own (the same files on
  // another port, which the browser takes for another site, with its own worker and offline copy), where the server
  // can be told to answer slowly: the new build's install then lasts long enough to be met half-way.
  const { serve } = await import('../lib.mjs');
  const files = await serve(ROOT), answer = files.listeners('request')[0]; files.close();
  // Its worker script is answered from here, so a build deployed on this site is never seen by the other one.
  let slow = 0, swNow = origSw, down = false; // down: the server cannot be reached (it drops every connection)
  // asked: every file it was asked for. stuck: one file whose nth request from then on gets no answer (stuck.at: when it came).
  const asked = []; let stuck = null;
  const slowSite = require('http').createServer((req, res) => {
    if (down) return req.socket.destroy();
    if (/^\/sw\.js(\?|$)/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(swNow); }
    const file = req.url.split('?')[0]; asked.push(file);
    if (stuck && file === stuck.file && !--stuck.nth) { stuck.at = Date.now(); return; }
    setTimeout(() => answer(req, res), slow);
  });
  await new Promise(r => slowSite.listen(0, '127.0.0.1', r));
  const site = `http://localhost:${slowSite.address().port}/`;
  const ctx2 = await browser.newContext({ viewport: { width: 420, height: 860 } });
  await ctx2.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); }); await ctx2.addInitScript(acceptTerms());
  const p2 = await ctx2.newPage(); p2.on('dialog', d => d.accept());
  await p2.goto(site); await p2.waitForSelector('#rolodex .drum-btn'); await p2.waitForFunction(() => navigator.serviceWorker.controller != null, null, { timeout: 20000 });
  const SHELL = [...origSw.match(/const SHELL = \[([\s\S]*?)\n\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  // How many of the build's files its cache lacks (-1: there is no such cache).
  const missing = name => p2.evaluate(async ([n, shell]) => { if (!(await caches.has(n))) return -1; const have = new Set((await (await caches.open(n)).keys()).map(r => r.url)); return shell.filter(f => !have.has(new URL(f, location.origin + '/').href)).length; }, [name, SHELL]);
  const cdp = await ctx2.newCDPSession(p2); await cdp.send('ServiceWorker.enable');
  // deploy: a new build number on the server, found by the page; the install has begun once the new cache exists
  const until = async (ms, test) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await test()) return true; await sleep(100); } return false; };
  const deploy = async (build, list = null, pg = p2) => {
    swNow = origSw.replace("const BUILD = 'dev';", `const BUILD = '${build}';`);
    if (list) swNow = swNow.replace(/const SHELL = \[[\s\S]*?\n\];/, () => `const SHELL = [\n  ${list.map(f => `'${f}'`).join(', ')},\n];`);
    slow = 1500;
    await pg.evaluate(() => { navigator.serviceWorker.getRegistration().then(r => r.update()); });
    return until(15000, () => pg.evaluate(async n => (await caches.has(n)) && !!(await navigator.serviceWorker.getRegistration()).installing, 'logi-' + build));
  };
  // …and it has taken over once the cache of the build before it is gone (a worker drops the old caches as it takes
  // over). The page's own "cleanup" goes out 3 s after that; what is missing is then waited for, for a while.
  const settled = async build => {
    slow = 0;
    await until(30000, () => p2.evaluate(async n => (await caches.keys()).every(k => k === n || k === 'logi-share'), 'logi-' + build));
    await until(12000, async () => (await missing('logi-' + build)) === 0);
  };
  const startMissing = await missing('logi-dev');
  await sleep(3500); // (the page's "cleanup" after its own first take-over has gone out by now)
  await cdp.send('ServiceWorker.stopAllWorkers'); // the browser puts an idle worker to sleep after half a minute
  const begun = await deploy('test0');
  await p2.evaluate(() => fetch('js/pages/crew.js').then(r => r.text())); await sleep(400); // a first tap on Crew: the sleeping worker wakes to answer it, and tidies up
  const during = (await p2.evaluate(() => caches.keys())).sort().join();
  ok('a worker that wakes while a newer build is installing leaves that build’s half-filled cache alone', startMissing === 0 && begun && during === 'logi-dev,logi-test0', `${startMissing} missing at the start; install begun: ${begun}; caches then: ${during}`);
  // the same for the page's "cleanup", which goes to whichever worker answers for it
  await p2.evaluate(() => navigator.serviceWorker.controller.postMessage('cleanup')); await sleep(400);
  const during2 = (await p2.evaluate(() => caches.keys())).sort().join();
  ok('…also when the page asks it to tidy up at that moment', during2 === 'logi-dev,logi-test0', during2);
  await settled('test0');
  const took = { missing: await missing('logi-test0'), old: await missing('logi-dev') };
  ok('…and the new build takes over with its whole offline copy', took.missing === 0 && took.old === -1, JSON.stringify(took));
  // A worker from before that rule (the one published until now) deletes the new build's cache at that moment. This
  // build cannot stop it, so it puts back afterwards what is missing: here the cache is deleted for it mid-install.
  const begun2 = await deploy('test00');
  const deleted = await p2.evaluate(() => caches.delete('logi-test00')); await sleep(200);
  await settled('test00');
  const healed = { missing: await missing('logi-test00'), page: await p2.evaluate(async () => ((await caches.has('logi-test00')) ? (await (await caches.open('logi-test00')).keys()).filter(r => /\/(index\.html)?$/.test(new URL(r.url).pathname)).length : 0)) };
  ok('a new build whose cache was deleted while it installed puts back what is missing once it has taken over: every file, the app’s own page among them', begun2 && deleted && healed.missing === 0 && healed.page >= 1, JSON.stringify([begun2, deleted, healed]));
  await p2.reload(); await p2.waitForSelector('#rolodex .drum-btn');
  await ctx2.setOffline(true);
  const cut2 = await p2.reload().then(async () => { await p2.waitForSelector('#rolodex .drum-btn', { timeout: 15000 }); await p2.evaluate(() => window.logiGo('venues')); await p2.waitForSelector('.page-card[aria-label="Venues"]', { timeout: 8000 }); return 'opened, and a section not opened before came up'; }).catch(e => String(e.message).split('\n')[0]);
  await ctx2.setOffline(false);
  ok('…so after that update Vdex opens without a connection, with the sections that were never opened', /^opened/.test(cut2), cut2);
  // The same with Vdex closed while the new build installs (the tap that woke the old worker was the last thing done
  // in it). No page is left to ask for a tidy, and none makes a request, so the new build has to make itself whole as
  // it takes over. Watched from a page of the site that is not the app and asks the worker for nothing (an address
  // the site's own Worker answers).
  // The worker in the repository lists fewer files than a deploy's does (tools/stamp-build.mjs writes the whole list
  // at each deploy). This build lists every script, as a deployed one does, so that what it puts back is enough to
  // start from with nothing else in the cache.
  const scripts = dir => fs.readdirSync(`${ROOT}/${dir}`).flatMap(n => (fs.statSync(`${ROOT}/${dir}/${n}`).isDirectory() ? scripts(`${dir}/${n}`) : n.endsWith('.js') ? [`${dir}/${n}`] : []));
  const WHOLE = [...new Set([...SHELL, ...scripts('js')])];
  const watcher = await ctx2.newPage(); await watcher.goto(site + 'licence/web/status');
  const lacks = name => watcher.evaluate(async ([n, shell]) => { if (!(await caches.has(n))) return -1; const have = new Set((await (await caches.open(n)).keys()).map(r => r.url)); return shell.filter(f => !have.has(new URL(f, location.origin + '/').href)).length; }, [name, WHOLE]);
  const begun3 = await deploy('test000', WHOLE);
  const deleted3 = await p2.evaluate(() => caches.delete('logi-test000'));
  await p2.close(); slow = 0;
  const took3 = await until(30000, async () => !(await watcher.evaluate(() => caches.keys())).includes('logi-test00')); // it has taken over: the cache of the build before is gone
  await sleep(1500);
  const closed = await lacks('logi-test000');
  const cdp2 = await ctx2.newCDPSession(watcher); await cdp2.send('ServiceWorker.enable');
  await cdp2.send('ServiceWorker.stopAllWorkers'); await sleep(400); // the idle worker is put to sleep; the next start wakes it
  down = true;
  const opens = (pg, how, section, label) => how().then(async () => { await pg.waitForSelector('#rolodex .drum-btn', { timeout: 15000 }); await pg.evaluate(id => window.logiGo(id), section); await pg.waitForSelector(`.page-card[aria-label="${label}"]`, { timeout: 8000 }); return 'opened, and a section not opened before came up'; }).catch(e => String(e.message).split('\n')[0]);
  const p3 = await ctx2.newPage(); p3.on('dialog', d => d.accept());
  const cut3 = await opens(p3, () => p3.goto(site), 'insurance', 'Insurance');
  await p3.close();
  ok('a new build whose cache was deleted while it installed, with Vdex closed before it took over, has put every file back by itself as it took over', begun3 && deleted3 && took3 && closed === 0, JSON.stringify([begun3, deleted3, took3, closed]));
  ok('…so the next start, which has no connection, opens Vdex with the sections that were never opened', /^opened/.test(cut3), cut3);
  // A put-back that cannot be done for want of a connection is made good at the next start that has one: a tidy runs
  // each time a page is opened, not only when the worker starts. The offline copy is lost again and the worker put to
  // sleep; the next start has no connection (its tidy can fetch nothing); the start after that has one, with the same
  // worker still awake.
  await cdp2.send('ServiceWorker.stopAllWorkers'); await sleep(400);
  await watcher.evaluate(() => caches.delete('logi-test000'));
  const p4 = await ctx2.newPage();
  const lostStart = await p4.goto(site).then(() => 'opened', e => String(e.message).split('\n')[0]);
  await p4.close(); // (the browser's own error page would try again by itself once there is a connection)
  down = false;
  const p5 = await ctx2.newPage(); p5.on('dialog', d => d.accept());
  await p5.goto(site); await p5.waitForSelector('#rolodex .drum-btn', { timeout: 20000 });
  const again = await until(20000, async () => (await lacks('logi-test000')) === 0), left = await lacks('logi-test000');
  down = true;
  const cut4 = await opens(p5, () => p5.reload(), 'field', 'Field');
  down = false;
  ok('a put-back that failed for want of a connection is tried again once there is one, by the same worker: the start with a connection ends with every file in the offline copy, not only the ones it asked for', lostStart !== 'opened' && again && left === 0, JSON.stringify([lostStart, again, left]));
  ok('…so Vdex then opens without a connection, with a section never opened', /^opened/.test(cut4), cut4);
  // A build found while the one before it is still taking over. That build's cache is deleted while it installs (as
  // above), so it asks for every file a second time as it takes over, and one of them gets no answer: the take-over
  // drags on. Meanwhile the next build is deployed, found, and installed whole. When the build before stops waiting
  // (it gives a put-back 20 seconds), it must not drop the next build's cache with the old ones: that build would
  // fetch every file again, or take over with no offline copy if the connection had gone by then.
  stuck = { file: '/js/pages/insurance.js', nth: 2 };
  const begun4 = await deploy('test4', WHOLE, p5);
  const deleted4 = await p5.evaluate(() => caches.delete('logi-test4')); slow = 0;
  const dragging = await until(30000, async () => !!stuck.at && [0, 1].includes(await lacks('logi-test4'))); // its put-back has every file but the one that does not come (which the page's own tidy may have fetched meanwhile)
  const from = asked.length;
  const begun5 = await deploy('test5', WHOLE, p5); slow = 0;
  const took5 = await until(40000, async () => (await watcher.evaluate(() => caches.keys())).every(k => k === 'logi-test5' || k === 'logi-share')); // the next build has taken over: every other cache is gone
  const waited = Date.now() - stuck.at, lacks5 = await lacks('logi-test5');
  // How often each file of the build was asked for since it was deployed (not the stuck one: a tidy may ask for it again).
  const whole5 = WHOLE.map(f => new URL(f, site).pathname).filter(f => f !== stuck.file), since = asked.slice(from), times = whole5.map(f => since.filter(a => a === f).length);
  ok('a take-over whose put-back gets no answer for a file stops waiting for it after 20 seconds, so the page’s requests, and the next build, are not held up for as long as that file takes', begun4 && deleted4 && dragging && took5 && waited > 15000 && waited < 35000, JSON.stringify([begun4, deleted4, dragging, took5, waited]));
  ok('…and a build that was found and installed during that wait keeps its offline copy: the build before does not drop it with the old ones, so no file is fetched a second time', begun5 && took5 && lacks5 === 0 && times.every(n => n === 1), JSON.stringify([begun5, took5, lacks5, times.filter(n => n !== 1).length + ' of ' + whole5.length + ' files not asked for exactly once']));
  await ctx2.close(); slowSite.close();
  fs.writeFileSync(verPath, origVer.replace(/VERSION = '[^']+'/, "VERSION = '9.9.9'"));
  const served = await page.evaluate(() => fetch('js/version.js', { cache: 'no-store' }).then(r => r.text()));
  ok('cache-first: a changed file on the server is not mixed into the running version', !/9\.9\.9/.test(served) && /VERSION = /.test(served));
  const plain = await page.evaluate(() => import('./js/update.js').then(m => m.checkForUpdates()));
  ok('a check with no new build says current', plain.status === 'current', JSON.stringify(plain));
  fs.writeFileSync(swPath, origSw.replace("const BUILD = 'dev';", "const BUILD = 'test1';"));
  const result = await page.evaluate(() => import('./js/update.js').then(m => m.checkForUpdates()));
  ok('a new build on the server is found and installed in the background', result.status === 'ready', JSON.stringify(result));
  await page.waitForSelector('.update-bar', { timeout: 15000 });
  ok('the "Vdex has been updated" bar appears', /updated/.test(await page.locator('.update-bar').innerText()));
  await sleep(3600);
  const keys2 = await page.evaluate(() => caches.keys());
  ok('new cache in place, old one removed', keys2.includes('logi-test1') && !keys2.includes('logi-dev'), keys2.join(','));
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await openSetting(page, 'About & Licence');
  const about = await page.locator('details.settings-section:has(> summary:has-text("About"))').innerText();
  ok('Settings → General → About & Licence offers the reload', /new version has been downloaded/i.test(about) && /Reload now/.test(about));
  await page.screenshot({ path: process.env.S + '/update-bar.png' });
  await page.locator('.update-bar button', { hasText: 'Reload' }).click();
  await page.waitForLoadState('domcontentloaded'); await page.waitForSelector('#rolodex .drum-btn');
  const served2 = await page.evaluate(() => fetch('js/version.js').then(r => r.text()));
  ok('after the reload the new files are served', /9\.9\.9/.test(served2));
  ok('no bar after reloading into the new version', (await page.locator('.update-bar').count()) === 0);
  await page.evaluate(() => window.logiGo('settings')); await sleep(400);
  await openSetting(page, 'About & Licence');
  const about2 = await page.locator('details.settings-section:has(> summary:has-text("About"))').innerText();
  ok('About shows the running version is up to date', /Up to date/.test(about2) && /9\.9\.9/.test(about2));
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  // The stamp a deploy puts on these two files (tools/stamp-build.mjs), run here on the scratch copy.
  restore();
  const stamp = () => spawnSync(process.execPath, [ROOT + '/tools/stamp-build.mjs'], { env: { ...process.env, BUILD_SHA: 'abc1234def', GITHUB_SHA: '' }, encoding: 'utf8' });
  const good = stamp(), sw1 = fs.readFileSync(swPath, 'utf8'), ver1 = fs.readFileSync(verPath, 'utf8');
  ok('stamping a deploy writes the build into both files and lists the published files for offline use, the newest pages and modules among them', good.status === 0 && sw1.includes("const BUILD = 'abc1234';") && ver1.includes("export const BUILD = 'abc1234';") && ["'shared.html'", "'js/menu.js'", "'js/search.js'", "'js/roles.js'", "'js/role-picker.js'"].every(f => sw1.includes(f)), (good.stdout + good.stderr).trim());
  fs.writeFileSync(swPath, origSw.replace('const SHELL = [', 'const FILES = [')); fs.writeFileSync(verPath, origVer);
  const bad = stamp();
  ok('…and when a line it stamps is no longer there, it stops with an error and writes nothing, instead of publishing a half-stamped build', bad.status === 1 && /SHELL list in sw\.js/.test(bad.stderr) && fs.readFileSync(verPath, 'utf8') === origVer && !fs.readFileSync(swPath, 'utf8').includes('abc1234'), `exit ${bad.status}: ${(bad.stdout + bad.stderr).trim()}`);
  restore();
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

// Every section opens without errors, with and without the sample, and the page has no console errors.
const { open, ok, sleep, go } = require('../helpers.cjs');
(async () => {
  const { browser, page, errors } = await open();
  const ids = await page.evaluate(() => window.gigdexPages().map(p => p.id));
  ok('there are eleven sections', ids.length === 11, ids.join(', '));
  for (const id of ids) { await go(page, id); const head = await page.locator('#page .page-card').count(); ok(`${id} opens on an empty database`, head === 1); }
  // ? on a page whose boxes need data first still says something (Money on an empty device).
  await go(page, 'money'); await page.click('#helpBtn'); await sleep(900);
  ok('? on the empty Money page shows its walkthrough', (await page.locator('.tour-card').count()) === 1, await page.locator('.tour-card').count() + ' cards');
  await page.keyboard.press('Escape'); await sleep(200);
  // ? inside a panel that has no walkthrough of its own still explains it.
  await page.evaluate(() => import('./js/util.js').then(u => u.sheet('A panel with no walkthrough', u.h('p', null, 'Hello'))));
  await page.click('.sheet .sheet-help'); await sleep(600);
  ok('? in a panel without its own walkthrough shows a general one', (await page.locator('.tour-card').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(200);
  for (const id of ids) { await go(page, id); ok(`${id} opens with the sample loaded`, (await page.locator('#page .page-card').count()) === 1); }
  const counts = await page.evaluate(() => import('./js/store.js').then(s => Object.fromEntries(s.COLLECTIONS.map(c => [c, s.db[c].length]))));
  ok('the sample fills every list', Object.values(counts).every(n => n > 0), JSON.stringify(counts));
  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL smoke crashed — ' + e.message); process.exit(1); });

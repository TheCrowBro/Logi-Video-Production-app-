// The licence's price with tax for the UK, the EU and Australia (js/tax.js): the download page lists every one of
// them, and each total there is the one the licence server gives the app (cloudflare/worker.mjs, spec 102), so the
// page and the Buy buttons never disagree. When a country changes its rate, js/tax.js and download.html change together.
const { chromium } = require('playwright');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';

(async () => {
  const browser = await chromium.launch();
  try {
    // The page allows no scripts of its own (its CSP), so the test reads js/tax.js with the CSP set aside.
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, bypassCSP: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL + 'download.html');
    const r = await page.evaluate(async () => {
      const { RATES, PRICE, withTax } = await import('./js/tax.js');
      const items = [...document.querySelectorAll('.prices li[data-c]')].map(li => ({ c: li.dataset.c, total: li.querySelector('b') && li.querySelector('b').textContent, rest: li.textContent }));
      return { PRICE, codes: Object.keys(RATES), want: Object.fromEntries(Object.keys(RATES).map(c => [c, withTax(c)])), items, lead: document.querySelector('.lead').textContent, buy: document.querySelector('a.buy').textContent };
    });
    const listed = r.items.map(i => i.c);
    ok(`the download page lists all ${r.codes.length} places with their total: the UK, Australia and the 27 EU countries`, r.codes.length === 29 && listed.length === r.codes.length && r.codes.every(c => listed.filter(x => x === c).length === 1), `missing: ${r.codes.filter(c => !listed.includes(c)).join(', ') || 'none'}; extra or twice: ${listed.filter((c, i) => !r.codes.includes(c) || listed.indexOf(c) !== i).join(', ') || 'none'}`);
    // The UK and Australia name their tax; the EU list's heading says it is each country's VAT, so its entries give the rate.
    const wrong = r.items.filter(i => { const w = r.want[i.c]; return !w || i.total !== w.total || !i.rest.trim().endsWith(['GB', 'AU'].includes(i.c) ? ` ${w.rate}% ${w.tax}` : ` ${w.rate}%`); });
    ok('each total and rate on the page is the one js/tax.js gives (and so the licence server and the app)', wrong.length === 0, wrong.map(i => `${i.c}: ${i.rest.trim()} (want ${r.want[i.c] && r.want[i.c].total})`).join('; '));
    ok('the UK is 24.00 with 20% VAT and Australia 22.00 with 10% GST', /United Kingdom 24\.00 20% VAT/.test(r.items.find(i => i.c === 'GB').rest) && /Australia 22\.00 10% GST/.test(r.items.find(i => i.c === 'AU').rest));
    ok('the price before tax is 20 US dollars, and the opening paragraph says tax is added and links to the list', r.PRICE === 20 && /20 US dollars once plus any tax where you live \(the price with tax\)/.test(r.lead) && (await page.locator('.lead a[href="#price"]').count()) === 1 && (await page.locator('#price').count()) === 1);
    ok('Buy carries no price of its own: the prices are listed just above it', r.buy.trim() === 'Buy a licence');
    ok('the page says the checkout takes US dollars, or the buyer\'s currency at Stripe\'s rate', /pay in US dollars, or in your own currency at Stripe's exchange rate \(2 to 4% more\)/.test(await page.locator('main').innerText()));
    await page.locator('#price').scrollIntoViewIfNeeded();
    await page.screenshot({ path: OUT + '/download-prices.png', fullPage: true });
    const wide = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    await wide.goto(URL + 'download.html');
    const cols = await wide.evaluate(() => getComputedStyle(document.querySelectorAll('.prices')[1]).gridTemplateColumns.split(' ').length);
    ok('on a wide screen the EU list sits in columns; on a phone it fits the width', cols >= 3 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), `${cols} columns`);
    ok('no page errors', errors.length === 0, errors.join(' | '));

    // The Vdex page on crowmade.app (crowmade/vdex/index.html, written by tools/build-crowmade.mjs): a Buy button, and the
    // same totals beside it.
    const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
    const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
    const vdexPage = () => fs.readFileSync(path.join(ROOT, 'crowmade/vdex/index.html'), 'utf8');
    const committed = vdexPage();
    execFileSync(process.execPath, ['tools/build-crowmade.mjs'], { cwd: ROOT, stdio: 'pipe' });
    ok('crowmade/ is what tools/build-crowmade.mjs writes (rebuilt after every change to it or to js/tax.js)', vdexPage() === committed);
    const eu = r.codes.filter(c => c !== 'GB' && c !== 'AU').map(c => Number(r.want[c].total));
    ok('the crowmade.app Vdex page has a Buy button to vdex.crowmade.app/buy', /<a class="btn" href="https:\/\/vdex\.crowmade\.app\/buy">Buy a licence<\/a>/.test(committed));
    ok('…beside the price before tax and the totals with tax from js/tax.js, and a link to every country\'s price', committed.includes('20 US dollars once plus any tax where you live') && committed.includes(`With tax that is ${r.want.GB.total} US dollars in the UK, ${r.want.AU.total} in Australia, and ${Math.min(...eu).toFixed(2)} to ${Math.max(...eu).toFixed(2)} in the EU`) && committed.includes('href="https://vdex.crowmade.app/download.html#price"'));
    ok('…and says it is a licence, not a copy, with the terms linked (California\'s rule), and how the checkout takes payment', /You are buying a licence to use Vdex, not ownership of a copy\. It can be cancelled in the cases the <a href="https:\/\/vdex\.crowmade\.app\/terms\.html#paid">terms<\/a> describe\./.test(committed) && /pay in US dollars, or in your own currency at Stripe's exchange rate \(2 to 4% more\)/.test(committed));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('TEST CRASHED', e); process.exit(1); });

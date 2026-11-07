#!/usr/bin/env node
// Remakes the Google Play screenshots (store/android/screenshots) from the app itself, filled with its sample data, as the
// installed Play app shows it: no browser bar, no Install button, no prices or Buy. Phone 1080 × 1920, tablet 1600 × 2560.
// Run it after a visible change to the app, then upload the new files in the Play Console (docs/google-play.md, Step 4).
//   node tools/store-screenshots.mjs
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../tests/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'store', 'android', 'screenshots');
mkdirSync(out, { recursive: true });
const { TERMS_RECORD } = createRequire(import.meta.url)('../tests/helpers.cjs');
const server = await serve(root);
const URL = `http://localhost:${server.address().port}/index.html?src=play`; // the address the Play app opens
const UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
async function open({ width, height, scale, mobile }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: mobile, hasTouch: true, colorScheme: 'dark', locale: 'en-US', userAgent: UA, serviceWorkers: 'block' });
  // A fixed forecast, so the pictures never say it could not be fetched: partly cloudy, 9 to 14 degrees, light wind.
  await ctx.route('https://api.open-meteo.com/**', r => { const day = new globalThis.URL(r.request().url()).searchParams.get('start_date');
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ daily: { time: [day], weather_code: [2], temperature_2m_max: [14.2], temperature_2m_min: [8.6], precipitation_probability_max: [10], wind_speed_10m_max: [12.4], wind_gusts_10m_max: [24.1] } }) }); });
  await ctx.addInitScript(rec => {
    localStorage.setItem('logi-terms', rec); localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-lock-setup', 'skip');
    if (!localStorage.getItem('logi-loc')) localStorage.setItem('logi-loc', JSON.stringify({ lat: 51.5033, lon: -0.1195 })); // the sample venue, for the sun times
    Object.defineProperty(navigator, 'standalone', { get: () => true }); // installed: no Install button
  }, TERMS_RECORD);
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await fill(page);
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn'); await sleep(800);
  return { ctx, page };
}
// What the sample data leaves empty but the pictures should show: who the call sheet and invoices are from, and quotes and
// invoices at each stage (paid, overdue, accepted, awaiting an answer), priced the way the quote button suggests them.
const fill = page => page.evaluate(async () => {
  const store = await import('./js/store.js'), m = await import('./js/money.js');
  const day = off => { const x = new Date(); x.setDate(x.getDate() + off); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const id = () => Math.random().toString(36).slice(2, 10), bl = m.billing();
  const lines = b => m.suggestLines(b, 'quote', 'booking').map(l => ({ ...l, id: id(), price: l.price === '' || l.price == null ? (/day/i.test(l.desc) ? 650 : 180) : l.price }));
  const doc = (b, kind, n, status, at) => ({ number: n, date: day(at), ...(kind === 'quote' ? { until: day(at + 30) } : { due: day(at + 14) }), lines: lines(b), taxRate: Number(bl.taxRate) || 0, taxLabel: bl.taxLabel || 'Tax', notes: '', status, deposit: '', ...(kind === 'invoice' ? { payments: [] } : {}) });
  store.update(d => {
    d.profile = { ...d.profile, name: 'Alex Morgan', business: 'Morgan Films', phone: '+1 555 0100', email: 'alex@example.com', website: 'https://example.com' };
    const by = t => d.bookings.find(b => b.title.includes(t));
    const paid = by('Corporate headshots'), late = by('Festival highlights'), harbour = by('Harbour Brewing'), wedding = by('Wedding weekend');
    if (paid) { paid.quote = doc(paid, 'quote', 'Q-0101', 'Accepted', -30); const inv = doc(paid, 'invoice', 'INV-0101', 'Sent', -11); inv.payments = [{ id: id(), date: day(-4), amount: m.totals(inv).total, method: 'Bank transfer', note: '' }]; inv.status = 'Paid'; inv.paidAt = Date.now() - 4 * 864e5; paid.invoice = inv; }
    if (late) { late.quote = doc(late, 'quote', 'Q-0102', 'Accepted', -40); late.invoice = doc(late, 'invoice', 'INV-0102', 'Sent', -19); late.invoice.due = day(-5); }
    if (harbour) harbour.quote = doc(harbour, 'quote', 'Q-0103', 'Accepted', -6);
    if (wedding) wedding.quote = doc(wedding, 'quote', 'Q-0104', 'Sent', -2);
  });
  await new Promise(r => setTimeout(r, 400)); // the store saves in a moment
});
const tidy = page => page.evaluate(() => { document.querySelectorAll('.toast, .toasts > *').forEach(t => t.remove()); });
const top = page => page.evaluate(() => window.scrollTo(0, 0));
// Scrolls the first element matching the selector (or containing the text) to the top, leaving the given room above it.
const scrollTo = (page, sel, room = 12) => page.evaluate(([q, r]) => { const el = document.querySelector(q) || [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && e.textContent.trim() === q); if (el) window.scrollBy(0, el.getBoundingClientRect().top - r); }, [sel, room]);
const shot = async (page, name) => { await tidy(page); await sleep(500); await page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 88 }); console.log('wrote', name); };
const go = async (page, id) => { await page.evaluate(i => window.logiGo(i), id); await sleep(900); await top(page); };
const harbour = page => page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.find(b => /Harbour Brewing/.test(b.title)).id));
const openBooking = async page => { const id = await harbour(page); await go(page, 'bookings'); await page.evaluate(i => import('./js/pages/bookings.js').then(m => m.openBooking(i)), id); await sleep(900); };
const closeSheets = async page => { for (let i = 0; i < 3 && (await page.locator('.sheet').count()); i++) { await page.keyboard.press('Escape'); await sleep(300); } };

try {
  // Phone
  let { ctx, page } = await open({ width: 360, height: 640, scale: 3, mobile: true });
  await go(page, 'bookings'); await scrollTo(page, '.bk-tiles', 8); await sleep(700); await shot(page, 'phone-01-bookings.jpg');
  await openBooking(page); await top(page); await shot(page, 'phone-02-booking.jpg');
  await page.getByRole('button', { name: /Call sheet$/ }).first().click(); await sleep(1500); // the booking's call sheet, a view of its own
  await page.waitForFunction(() => !/Checking the forecast/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {});
  await scrollTo(page, 'CALL SHEET', 40); await sleep(500); await shot(page, 'phone-03-call-sheet.jpg'); await closeSheets(page);
  await go(page, 'gear'); await shot(page, 'phone-04-equipment.jpg');
  await go(page, 'crew'); await shot(page, 'phone-05-crew.jpg');
  await go(page, 'field'); await sleep(800); await shot(page, 'phone-06-field.jpg');
  await go(page, 'tcnotes');
  await page.evaluate(async () => { const t = await import('./js/pages/tcnotes.js'), s = await import('./js/store.js'); t.openPracticeLog(); s.update(d => { const l = d.logs.find(x => x.practice); if (l) { l.title = 'Harbour Brewing · A cam'; l.camera = 'FX6 · A cam'; } }); });
  await sleep(900); await shot(page, 'phone-07-timecode.jpg');
  await go(page, 'bookings'); await page.evaluate(() => import('./js/pages/bookings.js').then(m => m.showMonth())); await sleep(600);
  await page.getByRole('button', { name: /Money$/ }).first().click(); await sleep(1200);
  await shot(page, 'phone-08-money.jpg');
  await ctx.close();
  // Tablet
  ({ ctx, page } = await open({ width: 800, height: 1280, scale: 2, mobile: true }));
  await go(page, 'bookings'); await shot(page, 'tablet-01-bookings.jpg');
  await openBooking(page); await top(page); await shot(page, 'tablet-02-booking.jpg');
  await ctx.close();
} finally {
  await browser.close(); server.close();
}

// The show blocks on a show's page: Deal & fee, Running order, Guest list, Settlement. Opens the sample show (a versus
// deal) and the past sample show (a counted door), taps and types what a person would, and checks what shows and what
// is stored. Uses the real booking page when it draws the blocks (pages/bookings.js openBooking); otherwise it draws
// them the same way in a stand-in section (a <details id="blk-…"> per block, redrawn after every change).
const { open, ok, sleep, topSheet } = require('../helpers.cjs');

const INIT = () => {
  window.__copied = null; window.__printed = null;
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); } catch (e) { /* ignore */ }
  window.print = () => { const r = document.querySelectorAll('#print-root'); window.__printed = r.length ? r[r.length - 1].innerHTML : ''; window.dispatchEvent(new Event('afterprint')); };
};

// Draws the blocks for a booking: the real booking page if it has them, else the stand-in. Returns 'page' or 'harness'.
async function show(page, bookingId, ids) {
  let mode = 'harness';
  await page.evaluate(() => { const old = document.getElementById('sh-harness'); if (old) { old._unsub && old._unsub(); old.remove(); } });
  try {
    await page.evaluate(() => window.logiGo('bookings'));
    await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), bookingId);
    await sleep(500);
    if (await page.locator('#page details#blk-deal').count()) mode = 'page';
  } catch (e) { /* the stand-in it is */ }
  if (mode === 'page') {
    for (const id of ids) await page.evaluate(i => { const d = document.getElementById('blk-' + i); if (d && !d.open) d.open = true; }, id);
    await sleep(200);
    return mode;
  }
  await page.evaluate(async ({ bookingId, ids }) => {
    const store = await import('./js/store.js');
    const { BLOCKS } = await import('./js/blocks/index.js');
    const { currency } = await import('./js/model.js');
    const pageEl = document.getElementById('page');
    const old = document.getElementById('sh-harness'); if (old) { old._unsub && old._unsub(); old.remove(); }
    [...pageEl.children].forEach(c => { c.hidden = true; });
    const host = document.createElement('section'); host.id = 'sh-harness'; host.className = 'page-card';
    const css = document.createElement('style');
    css.textContent = '.blk{background:var(--card);border:1px solid var(--line);border-radius:14px;margin-bottom:10px}.blk>summary{display:flex;gap:8px;align-items:center;padding:12px 14px;cursor:pointer;min-height:44px;font-weight:700}.blk>summary .sum{margin-left:auto;font-weight:500;color:var(--muted);font-size:.85rem;text-align:right}.blk>.blk-body{padding:0 14px 14px}';
    host.append(css);
    pageEl.append(host);
    const blocks = ids.map(id => BLOCKS.find(x => x.id === id));
    const ctx = { sym: currency(), open: id => { const d = document.getElementById('blk-' + id); if (d) d.open = true; } };
    const draw = () => {
      const b = store.byId('bookings', bookingId), a = document.activeElement;
      const key = a && host.contains(a) ? (a.id || a.getAttribute('aria-label')) : null;
      for (const blk of blocks) {
        let d = document.getElementById('blk-' + blk.id);
        if (!d) { d = document.createElement('details'); d.className = 'blk'; d.id = 'blk-' + blk.id; d.open = true; host.append(d); }
        const sum = document.createElement('summary');
        const t = document.createElement('span'); t.textContent = `${blk.icon} ${blk.title}`;
        const s = document.createElement('span'); s.className = 'sum'; s.textContent = b ? blk.summary(b) : '';
        sum.append(t, s);
        const body = document.createElement('div'); body.className = 'blk-body';
        if (b) body.append(blk.render(b, ctx)); else body.textContent = 'This booking was deleted.';
        d.replaceChildren(sum, body);
      }
      if (key) { const again = [...host.querySelectorAll('[id],[aria-label]')].find(el => (el.id || el.getAttribute('aria-label')) === key); if (again) again.focus({ preventScroll: true }); }
    };
    draw();
    host._unsub = store.subscribe(() => queueMicrotask(draw));
  }, { bookingId, ids });
  await sleep(150);
  return mode;
}
const booking = (page, id) => page.evaluate(i => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.byId('bookings', i)))), id);
const summary = async (page, id) => ((await page.locator(`#blk-${id} > summary`).textContent()) || '').replace(/\s+/g, ' ').trim();
const until = (page, fn, arg, ms = 5000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
// Polls the stored booking until test(booking) holds (or 5 s pass).
async function storeHas(page, id, test, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const b = await booking(page, id);
    try { if (b && test(b)) return true; } catch (e) { /* not there yet */ }
    if (Date.now() > end) return false;
    await sleep(100);
  }
}
// model.fmtMoney of a sum rounded to the cent, as the blocks show it.
const money = (page, n) => page.evaluate(v => import('./js/model.js').then(m => m.fmtMoney(Math.round(v * 100) / 100)), n);

(async () => {
  const { browser, page, errors } = await open({ sample: true, init: INIT });
  const mode = await show(page, 's-show1', ['deal', 'running', 'guests', 'settlement']);
  console.log(`(blocks drawn by: ${mode === 'page' ? 'the booking page' : 'the stand-in section'})`);
  await page.waitForSelector('#blk-deal .sh-deal');

  /* ------------------------------- deal ------------------------------- */
  ok('deal: the closed box sums up the versus deal', (await summary(page, 'deal')).includes('$250 vs 70% after $300 costs'), await summary(page, 'deal'));
  const want = await page.evaluate(() => import('./js/model.js').then(m => { const d = { type: 'versus', fee: 250, pct: 70, ticketPrice: 12, capacity: 350, expenses: 300 }; return [0.25, 0.5, 0.75, 1].map(p => ({ t: String(Math.round(350 * p)), gross: m.fmtMoney(Math.round(350 * p) * 12), pays: m.fmtMoney(m.dealPays(d, Math.round(350 * p) * 12)) })); }));
  const rows = await page.$$eval('#blk-deal .sh-pays tbody tr', trs => trs.map(tr => [...tr.children].map(c => c.firstChild ? c.firstChild.textContent : c.textContent)));
  ok('deal: the table has a quarter, half, three quarters and a full house', rows.length === 4, JSON.stringify(rows));
  ok('deal: tickets, door and fee in each row match model.dealPays', rows.every((r, i) => r[1] === want[i].t && r[2] === want[i].gross && r[3] === want[i].pays), JSON.stringify({ rows, want }));
  ok('deal: a full house pays $2,730', rows[3] && rows[3][3] === '$2,730', rows[3] && rows[3][3]);
  const be = await page.locator('#blk-deal .sh-breakeven').textContent();
  ok('deal: the break-even says the 70% beats the guarantee from 55 tickets', /from 55 tickets/.test(be), be);
  const dep = page.locator('#sh-deposit-toggle');
  ok('deal: the deposit shows as received', (await dep.getAttribute('aria-pressed')) === 'true' && /received/i.test(await dep.textContent()));
  await dep.click();
  ok('deal: one tap marks the deposit as not received, and unticks the checklist line', await storeHas(page, 's-show1', b => b.deal.depositPaid === false && !(b.checks && b.checks['show-deposit'])));
  await page.locator('#sh-deposit-toggle').click();
  ok('deal: tapping again marks it received and ticks the checklist line', await storeHas(page, 's-show1', b => b.deal.depositPaid === true && b.checks['show-deposit'] === true));
  ok('deal: focus stays on the deposit button after the redraw', await page.evaluate(() => document.activeElement && document.activeElement.id === 'sh-deposit-toggle'));

  // A late deposit, through the form.
  await page.locator('#sh-deal-edit').click();
  let sh = topSheet(page);
  await sh.locator('#f-7-depositDue').waitFor();
  ok('deal form: opens with the deal filled in', (await sh.locator('#f-0-type').inputValue()) === 'versus' && (await sh.locator('#f-3-ticketPrice').inputValue()) === '12');
  await sh.locator('.sheet-help').click();
  await page.waitForSelector('.tour-card h2');
  ok('deal form: its ? runs a walkthrough of the form', (await page.locator('.tour-card h2').textContent()) === 'Kind of deal' && /1 \/ 5/.test(await page.locator('.tour-card .tour-step').textContent()), await page.locator('.tour-card').textContent());
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  const past = await page.evaluate(() => { const d = new Date(Date.now() - 4 * 864e5); return d.toISOString().slice(0, 10); });
  await sh.locator('#f-7-depositDue').fill(past);
  await sh.locator('.checks input[type=checkbox]').uncheck();
  await sh.locator('button[type=submit]').click();
  ok('deal form: saves the due date and the unpaid deposit', await storeHas(page, 's-show1', b => /^\d{4}-\d\d-\d\d$/.test(b.deal.depositDue) && b.deal.depositPaid === false && b.deal.ticketPrice === 12 && b.deal.fee === 250));
  ok('deal form: unticks the deposit checklist line', await storeHas(page, 's-show1', b => !(b.checks && b.checks['show-deposit'])));
  ok('deal: warns that the deposit is late', /was due/i.test(await page.locator('#blk-deal .sh-deposit .warn').textContent()));

  const steps = await page.evaluate(() => Promise.all(['deal', 'running', 'guests', 'settlement'].map(id => import(`./js/blocks/${id}.js`).then(m => m.default.tutorial))).then(all => all.flat().length));
  await page.evaluate(() => Promise.all([import('./js/tour.js'), ...['deal', 'running', 'guests', 'settlement'].map(id => import(`./js/blocks/${id}.js`))]).then(([t, ...bs]) => { t.runTour(bs.flatMap(b => b.default.tutorial)); }));
  await page.waitForSelector('.tour-card h2');
  const count = await page.locator('.tour-card .tour-step').textContent();
  ok('tutorial: the blocks’ walkthrough starts on the deal and finds its boxes', (await page.locator('.tour-card h2').textContent()) === 'Deal & fee' && Number(count.split('/')[1]) >= steps - 2, `${count} of ${steps} steps`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });

  /* ------------------------------- running order ------------------------------- */
  ok('running: the closed box shows our set and the acts', (await summary(page, 'running')).includes('Our set 21:15–22:00 · 2 acts'), await summary(page, 'running'));
  const names = await page.$$eval('#blk-running .sh-ro .sh-ro-name', n => n.map(x => x.textContent));
  ok('running: rows in time order', names.join('|') === 'Doors|Paper Kites (support)|The Night Owls', names.join('|'));
  ok('running: our slot shows its end time', (await page.locator('#blk-running .sh-ro-row.ours .sh-ro-time').textContent()).includes('–22:00'));
  await page.locator('#sh-ro-build').click();
  sh = topSheet(page);
  await sh.locator('#sh-b-doors').waitFor();
  ok('build: starts from the show times', (await sh.locator('#sh-b-doors').inputValue()) === '19:30' && (await sh.locator('#sh-b-setTime').inputValue()) === '21:15' && (await sh.locator('#sh-b-setLength').inputValue()) === '45' && (await sh.locator('#sh-b-curfew').inputValue()) === '23:00');
  ok('build: keeps the support act already in the order', (await sh.locator('#sh-b-before-0').inputValue()) === 'Paper Kites (support)' && (await sh.locator('#sh-b-before-0-len').inputValue()) === '35');
  await sh.locator('#sh-b-add-before').click();
  await sh.locator('#sh-b-before-1').fill('Late Bloomers');
  await sh.locator('#sh-b-before-1-len').fill('30');
  ok('build: the preview lays out the night before building', (await sh.locator('.sh-build-preview').textContent()).includes('Late Bloomers'));
  await sh.locator('#sh-build-go').click();
  const built = await storeHas(page, 's-show1', b => b.runningOrder.map(r => `${r.time} ${r.act} ${r.length}${r.ours ? '*' : ''}`).join('|') === '19:30 Doors 0|19:40 Paper Kites (support) 35|20:15 Changeover 15|20:30 Late Bloomers 30|21:00 Changeover 15|21:15 The Night Owls 45*|23:00 Curfew 0');
  ok('build: doors, supports back to back, 15-minute changeovers, our set, curfew', built, JSON.stringify((await booking(page, 's-show1')).runningOrder.map(r => `${r.time} ${r.act} ${r.length}`)));
  ok('running: the summary counts three acts', (await summary(page, 'running')).includes('Our set 21:15–22:00 · 3 acts'), await summary(page, 'running'));

  // Edit: our set runs past curfew, an after-midnight slot, an overlap.
  await page.locator('#sh-ro-edit').click();
  sh = topSheet(page);
  await sh.locator('#sh-r-5-length').waitFor();
  await sh.locator('.sheet-help').click();
  await page.waitForSelector('.tour-card h2');
  ok('running editor: its ? runs a walkthrough', (await page.locator('.tour-card h2').textContent()) === 'One line per slot');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.tour', { state: 'detached' });
  await sh.locator('#sh-r-5-length').fill('120');
  await sh.locator('#sh-r-3-time').fill('20:10');
  await sh.getByRole('button', { name: '+ Add a slot' }).click();
  await sh.locator('#sh-r-7-time').fill('00:30');
  await sh.locator('#sh-r-7-act').fill('Afterparty DJ');
  await sh.locator('#sh-r-7-length').fill('60');
  ok('running editor: shows each slot’s end as you type', (await sh.locator('.sh-row').nth(7).locator('.sh-row-note').textContent()).includes('01:30'));
  await sh.locator('button[type=submit]').click();
  ok('running editor: saves and syncs our set length to the show', await storeHas(page, 's-show1', b => b.setLength === 120 && b.setTime === '21:15' && b.runningOrder.length === 8));
  const order = (await booking(page, 's-show1')).runningOrder.map(r => r.act);
  ok('running: a slot after midnight sorts to the end of the night', order[order.length - 1] === 'Afterparty DJ', order.join('|'));
  ok('running: it is marked after midnight', (await page.locator('#blk-running .sh-ro-row').last().textContent()).includes('after midnight'));
  const warns = (await page.$$eval('#blk-running .warn', w => w.map(x => x.textContent))).join(' | ');
  ok('running: warns that our set ends after curfew', /Your set ends at 23:15, 15m after the curfew \(23:00\)/.test(warns), warns);
  ok('running: warns about the overlapping slots', /Paper Kites \(support\).*overlap by 5m/.test(warns), warns);
  ok('running: the closed box flags the curfew', (await summary(page, 'running')).includes('past curfew'), await summary(page, 'running'));
  await page.evaluate(() => import('./js/store.js').then(s => s.patch('bookings', 's-show1', { soundcheck: '19:45' })));
  await sleep(150);
  ok('running: warns when soundcheck is after doors', /Soundcheck \(19:45\) isn’t before doors \(19:30\)/.test((await page.$$eval('#blk-running .warn', w => w.map(x => x.textContent))).join(' ')));
  await page.locator('#sh-ro-copy').click();
  await sleep(100);
  const ro = await page.evaluate(() => window.__copied || '');
  ok('running: copies the order as text', ro.includes('21:15–23:15') && ro.includes('The Night Owls (us)'), ro);

  /* ------------------------------- guest list ------------------------------- */
  ok('guests: the closed box shows heads of the cap', (await summary(page, 'guests')).includes('3 of 6'), await summary(page, 'guests'));
  await page.locator('#sh-g-name').fill('Rosa Lind');
  await page.locator('#sh-g-plus').fill('2');
  await page.locator('#sh-g-note').fill('Promoter');
  await page.locator('#sh-g-name').press('Enter');
  ok('guests: quick add stores the name, +2 and note', await storeHas(page, 's-show1', b => b.guestList.some(g => g.name === 'Rosa Lind' && g.plus === 2 && g.note === 'Promoter' && g.in === false)));
  await sleep(120);
  ok('guests: the name box is empty and focused for the next guest', await page.evaluate(() => document.activeElement && document.activeElement.id === 'sh-g-name' && document.activeElement.value === ''));
  ok('guests: six heads of six', (await summary(page, 'guests')).includes('6 of 6'), await summary(page, 'guests'));
  await page.locator('#sh-g-name').fill('Tom Hale');
  await page.locator('#sh-g-add').click();
  await storeHas(page, 's-show1', b => b.guestList.length === 4);
  ok('guests: warns when the list is over the cap', /1 over the cap/.test(await page.locator('#blk-guests .warn').first().textContent()));
  ok('guests: the closed box flags it', (await summary(page, 'guests')).includes('⚠ 7 of 6'), await summary(page, 'guests'));
  await page.locator('#sh-g-name').fill('ivy chen');
  await page.locator('#sh-g-add').click();
  await sleep(200);
  ok('guests: a name already on the list is not added twice', (await booking(page, 's-show1')).guestList.length === 4);
  await page.getByRole('checkbox', { name: 'Ivy Chen is in' }).check();
  ok('guests: ticking in at the door is stored', await storeHas(page, 's-show1', b => b.guestList.find(g => g.name === 'Ivy Chen').in === true));
  ok('guests: counts Ivy and her +1 as in', (await summary(page, 'guests')).includes('· 2 in'), await summary(page, 'guests'));
  ok('guests: the tick keeps the focus', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Ivy Chen is in'));
  await page.locator('#sh-g-cap').fill('10');
  await page.locator('#sh-g-cap').press('Tab');
  ok('guests: the cap is saved', await storeHas(page, 's-show1', b => b.guestCap === 10));
  ok('guests: no warning under the cap', (await page.locator('#blk-guests .warn').count()) === 0);
  await page.getByRole('button', { name: 'Take Tom Hale off the list' }).click();
  ok('guests: delete (after a confirm) takes the guest off', await storeHas(page, 's-show1', b => !b.guestList.some(g => g.name === 'Tom Hale')));
  await page.getByRole('button', { name: 'Edit Sam (photographer)' }).click();
  sh = topSheet(page);
  await sh.locator('[data-key=plus]').waitFor();
  await sh.locator('[data-key=plus]').fill('1');
  await sh.locator('button[type=submit]').click();
  ok('guests: the edit sheet changes the +1s', await storeHas(page, 's-show1', b => b.guestList.find(g => g.name === 'Sam (photographer)').plus === 1));
  await page.locator('#sh-g-copy').click();
  await sleep(100);
  const gl = await page.evaluate(() => window.__copied || '');
  ok('guests: copies the list as text', gl.includes('Ivy Chen +1 (Agent)') && gl.includes('Rosa Lind +2 (Promoter)') && gl.includes('cap 10'), gl);
  await page.locator('#sh-g-print').click();
  await until(page, () => !!window.__printed && window.__printed.includes('GUEST LIST'));
  const door = await page.evaluate(() => window.__printed || '');
  ok('guests: prints a door list', door.includes('cs-doc') && door.includes('Rosa Lind') && door.includes('☑'), door.slice(0, 200));

  /* ------------------------------- a show with nothing on it ------------------------------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.upsert('bookings', { id: 't-bare', kind: 'show', status: 'hold', date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), venueId: 's-lantern' })));
  await show(page, 't-bare', ['deal', 'running', 'guests', 'settlement']);
  ok('bare show: the deal box says there is no deal yet', (await summary(page, 'deal')).includes('No deal yet') && (await page.locator('#sh-deal-add').count()) === 1);
  ok('bare show: running order and guests show their empty states', /No running order yet/.test(await page.locator('#blk-running').textContent()) && /No guests yet/.test(await page.locator('#blk-guests').textContent()));
  ok('bare show: the settlement is not settled yet', (await summary(page, 'settlement')).includes('Not settled yet'));
  await page.locator('#sh-deal-add').click();
  sh = topSheet(page);
  await sh.locator('#f-0-type').waitFor();
  ok('new deal: the capacity comes from the venue', (await sh.locator('#f-4-capacity').inputValue()) === '350');
  await sh.locator('#f-0-type').selectOption('door');
  await sh.locator('#f-2-pct').fill('80');
  await sh.locator('#f-3-ticketPrice').fill('10.5');
  await sh.locator('#f-4-capacity').fill('200');
  await sh.locator('button[type=submit]').click();
  ok('new deal: a door split is stored with numbers', await storeHas(page, 't-bare', b => b.deal.type === 'door' && b.deal.pct === 80 && b.deal.ticketPrice === 10.5 && b.deal.capacity === 200 && b.deal.fee === ''));
  const full = await page.$$eval('#blk-deal .sh-pays tbody tr', trs => trs.map(tr => tr.lastElementChild.textContent));
  ok('new deal: a full house of 200 at $10.50 pays 80% = $1,680', full[3] === '$1,680', full.join(' '));
  ok('new deal: the closed box reads 80% of the door', (await summary(page, 'deal')).includes('80% of the door'));
  await page.locator('#sh-ro-build').click();
  sh = topSheet(page);
  await sh.locator('#sh-b-setTime').waitFor();
  ok('build with no times: it asks for doors or a set time first', await sh.locator('#sh-build-go').isDisabled());
  await sh.locator('#sh-b-doors').fill('20:00');
  await sh.locator('#sh-b-before-0').fill('Opener');
  await sh.locator('#sh-b-setLength').fill('50');
  await sh.locator('#sh-build-go').click();
  ok('build from doors only: the opener goes on 30 minutes after doors and we follow', await storeHas(page, 't-bare', b => b.runningOrder.map(r => `${r.time} ${r.act}`).join('|') === '20:00 Doors|20:30 Opener|21:00 Changeover|21:15 Our set|23:00 Curfew'), JSON.stringify((await booking(page, 't-bare')).runningOrder));
  ok('build from doors only: the show gets the on-stage time', await storeHas(page, 't-bare', b => b.setTime === '21:15' && b.doors === '20:00' && b.setLength === 50), JSON.stringify((({ doors, setTime, setLength }) => ({ doors, setTime, setLength }))(await booking(page, 't-bare') || {})));
  // Deleted while a form is open: nothing breaks.
  await page.locator('#sh-deal-edit').click();
  sh = topSheet(page);
  await sh.locator('#f-1-fee').waitFor();
  await page.evaluate(() => import('./js/store.js').then(s => s.remove('bookings', 't-bare')));
  await sh.locator('#f-1-fee').fill('100');
  await sh.locator('button[type=submit]').click();
  await sleep(200);
  ok('deleted elsewhere: saving the open form changes nothing and does not break', (await page.evaluate(() => import('./js/store.js').then(s => !s.byId('bookings', 't-bare')))) && /deleted/i.test(await page.locator('.toast').last().textContent()));

  /* ------------------------------- settlement (the past show) ------------------------------- */
  await show(page, 's-past', ['deal', 'settlement']);
  await page.waitForSelector('#blk-settlement .sh-settle');
  const r0 = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/model.js')]).then(([s, m]) => { const r = m.settle(s.byId('bookings', 's-past')); return { ...r, f: Object.fromEntries(['gross', 'fee', 'owedOnNight', 'received', 'short', 'merch', 'costs', 'profit'].map(k => [k, m.fmtMoney(Math.round(r[k] * 100) / 100)])), pay: r.payouts.map(p => m.fmtMoney(p.amount)) }; }));
  ok('settle: model.settle reads the sample (214 tickets, $1,587.60 fee, $149.60 short)', r0.tickets === 214 && Math.abs(r0.fee - 1587.6) < 0.001 && Math.abs(r0.short - 149.6) < 0.001 && r0.merch === 370 && Math.abs(r0.profit - 1922.6) < 0.001, JSON.stringify(r0.f));
  ok('settle: the closed box shows the profit', (await summary(page, 'settlement')).includes('Profit ' + r0.f.profit), await summary(page, 'settlement'));
  const st = await page.locator('#blk-settlement').textContent();
  ok('settle: the door, the fee, what was owed and received match model.settle', ['Door: 214 × $12', r0.f.gross, r0.f.fee, r0.f.owedOnNight, r0.f.received].every(x => st.includes(x)), JSON.stringify(r0.f));
  ok('settle: says the promoter was short', (await page.locator('#sh-st-short').textContent()).includes(r0.f.short + ' short'));
  ok('settle: merch, costs and profit match', [r0.f.merch, r0.f.costs, r0.f.profit].every(x => st.includes(x)));
  const amts = await page.$$eval('#blk-settlement .sh-pay-amt', a => a.map(x => x.textContent));
  ok('settle: four equal payouts', amts.length === 4 && amts.every(a => a === r0.pay[0]) && r0.pay[0] === '$480.65', amts.join(' '));
  ok('settle: explains what a share of 2 means', /2 = a double share/.test(st));
  await page.locator('#sh-w-s-maya').fill('2');
  await page.locator('#sh-w-s-maya').press('Tab');
  ok('settle: a weight of 2 is stored for Maya', await storeHas(page, 's-past', b => b.settlement.shares && b.settlement.shares['s-maya'] === 2));
  const r1 = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/model.js')]).then(([s, m]) => m.settle(s.byId('bookings', 's-past')).payouts.map(p => m.fmtMoney(p.amount))));
  const amts2 = await page.$$eval('#blk-settlement .sh-pay-amt', a => a.map(x => x.textContent));
  ok('settle: Maya’s double share is twice the others', amts2.join(' ') === r1.join(' ') && r1[0] === '$769.04' && r1[1] === '$384.52', amts2.join(' '));
  ok('settle: an "equal shares again" button appears', (await page.locator('#sh-st-equal').count()) === 1);
  await page.locator('#sh-st-tickets').fill('250');
  await page.locator('#sh-st-tickets').press('Tab');
  ok('settle: a new ticket count is stored', await storeHas(page, 's-past', b => b.settlement.tickets === 250));
  const fee250 = await money(page, Math.max(250, (250 * 12 - 300) * 0.7));
  ok('settle: the fee follows the new count, rounded to the cent', fee250 === '$1,890' && (await page.locator('#blk-settlement').textContent()).includes(fee250), fee250);
  ok('settle: the deal box shows the counted night in its table', (await page.locator('#blk-deal .sh-night').count()) === 1);

  await page.locator('#sh-st-merch').click();
  sh = topSheet(page);
  await sh.locator('#sh-r-0-item').waitFor();
  await sh.getByRole('button', { name: '+ Add an item' }).click();
  await sh.locator('#sh-r-2-item').fill('Tote bag');
  await sh.locator('#sh-r-2-start').fill('10');
  await sh.locator('#sh-r-2-end').fill('4');
  await sh.locator('#sh-r-2-comps').fill('1');
  await sh.locator('#sh-r-2-price').fill('15');
  ok('merch sheet: works out what sold as you type', (await sh.locator('.sh-row').nth(2).locator('.sh-row-note').textContent()).includes('Sold 5'));
  await sh.locator('button[type=submit]').click();
  ok('merch sheet: saves the counts as numbers', await storeHas(page, 's-past', b => b.settlement.merch.length === 3 && b.settlement.merch[2].item === 'Tote bag' && b.settlement.merch[2].start === 10 && b.settlement.merch[2].comps === 1 && !!b.settlement.merch[2].id));
  await page.locator('#sh-st-costs').click();
  sh = topSheet(page);
  await sh.locator('#sh-r-0-desc').waitFor();
  await sh.getByRole('button', { name: '+ Add a cost' }).click();
  await sh.locator('#sh-r-1-desc').fill('Taxi');
  await sh.locator('#sh-r-1-amount').fill('25');
  await sh.locator('button[type=submit]').click();
  ok('costs sheet: saves the night’s costs', await storeHas(page, 's-past', b => b.settlement.costs.length === 2 && b.settlement.costs[1].amount === 25));
  await page.evaluate(() => import('./js/store.js').then(s => { const b = s.byId('bookings', 's-past'); s.patch('bookings', 's-past', { budget: [...(b.budget || []), { id: 'tb1', cat: 'Travel', desc: 'Fuel', amount: 40 }] }); }));
  await sleep(150);
  const r2 = await page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/model.js')]).then(([s, m]) => { const r = m.settle(s.byId('bookings', 's-past')); return { merch: r.merch, costs: r.costs, profit: m.fmtMoney(Math.round(r.profit * 100) / 100) }; }));
  ok('settle: merch with the tote bags and costs with the budget line', r2.merch === 445 && r2.costs === 100, JSON.stringify(r2));
  ok('settle: the box shows the budget line and the new profit', (await page.locator('#blk-settlement').textContent()).includes('Travel: Fuel') && (await summary(page, 'settlement')).includes(r2.profit), await summary(page, 'settlement'));

  await page.locator('#sh-st-settle').click();
  ok('settle: Mark settled sets the status, the time and the checklist line', await storeHas(page, 's-past', b => b.status === 'settled' && b.settlement.settledAt > 0 && b.checks && b.checks['show-settled'] === true));
  ok('settle: the closed box says settled', (await summary(page, 'settlement')).includes('· settled'));
  await page.locator('#sh-st-print').click();
  await until(page, () => !!window.__printed && window.__printed.includes('SETTLEMENT'));
  const doc = await page.evaluate(() => window.__printed || '');
  ok('settle: prints the settlement sheet', doc.includes('cs-doc') && doc.includes('Payouts') && doc.includes('Maya Brooks') && doc.includes('Tote bag'), doc.slice(0, 160));
  await page.locator('#sh-st-copy').click();
  await sleep(100);
  const tx = await page.evaluate(() => window.__copied || '');
  ok('settle: copies the settlement as text', tx.includes('Profit: ' + r2.profit) && tx.includes('Maya Brooks (share 2)'), tx.slice(0, 300));
  await page.locator('#sh-st-reopen').click();
  ok('settle: Reopen puts the show back to done and unticks the line', await storeHas(page, 's-past', b => b.status === 'done' && !b.settlement.settledAt && !(b.checks && b.checks['show-settled'])));

  // Every box on a narrow phone: nothing pushes the page sideways.
  await page.setViewportSize({ width: 360, height: 800 });
  await show(page, 's-show1', ['deal', 'running', 'guests', 'settlement']);
  await page.waitForSelector('#blk-settlement .sh-settle');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('the four boxes fit a 360px-wide phone', wide <= 360, `${wide}px`);

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL show crashed — ' + e.message); process.exit(1); });

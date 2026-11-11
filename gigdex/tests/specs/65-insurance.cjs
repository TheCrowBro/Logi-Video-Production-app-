// Insurance: the empty page, the sample's policies (order, renewal pills, stats), the cover-vs-backline check with the
// sample (cover 12,000 vs the backline's value) and after lowering the cover, an expired policy not counted, adding a
// policy with a certificate link (open and send, never the premium), deleting one, blank numbers, and the tutorials.
const { open, ok: say, sleep, go } = require('../helpers.cjs');
const ok = (name, cond, extra = '') => say(name, cond, String(extra).replace(/\s*\n\s*/g, ' / ')); // one line per result
// Runs fn(store module, arg) in the page (a source string evaluated by devtools: the page's CSP forbids eval).
const store = (page, fn, arg) => page.evaluate(`import('./js/store.js').then(s => (${fn.toString()})(s, ${JSON.stringify(arg ?? null)}))`);
const dayIn = (page, n) => page.evaluate(n => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, n);
const ids = page => page.locator('.ins-card').evaluateAll(els => els.map(e => e.dataset.id));
const form = (page, title) => page.locator(`.sheet[aria-label="${title}"]`);

(async () => {
  const { browser, page, errors } = await open({ tab: 'insurance' });
  await page.waitForSelector('.ins-page');

  /* ---------- empty ---------- */
  ok('an empty Insurance page explains what goes here', await page.locator('.ins-page .empty').isVisible());
  ok('and offers to add a policy', await page.locator('#ins-empty-add').isVisible());
  ok('with nothing to check, no stats and no cover check', (await page.locator('.ins-stats').count()) === 0 && (await page.locator('.ins-cover').count()) === 0);

  /* ---------- the sample ---------- */
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  await page.waitForSelector('.ins-card');
  ok('the sample shows two policies, the soonest renewal first', JSON.stringify(await ids(page)) === JSON.stringify(['s-ins2', 's-ins1']), (await ids(page)).join());
  const pl = page.locator('.ins-card[data-id="s-ins2"] .ins-pill'), eq = page.locator('.ins-card[data-id="s-ins1"] .ins-pill');
  ok('a renewal within 30 days has a warning pill', (await pl.innerText()) === '20 days left' && (await pl.getAttribute('class')).includes('ins-due'), await pl.innerText());
  ok('a later renewal has a calm pill', (await eq.innerText()) === '75 days left' && (await eq.getAttribute('class')).includes('ins-ok'), await eq.innerText());
  const stats = await page.locator('.ins-stats').innerText();
  ok('the stats count the policies, premiums and backline value', /2\s*policies/.test(stats) && stats.includes('$305') && stats.includes('$11,739'), stats.replace(/\n/g, ' '));
  ok('a line says a policy renews soon', (await page.locator('.ins-soon').innerText()).includes('1 policy renews within 30 days'));
  ok('the card shows cover, premium and renewal', /Cover\s*\$12,000/.test(await page.locator('.ins-card[data-id="s-ins1"] .ins-kv').innerText()) && /Premium\s*\$210 a year/.test(await page.locator('.ins-card[data-id="s-ins1"] .ins-kv').innerText()));
  ok('the sample cover (12,000) covers the backline: no warning', (await page.locator('.ins-warn').count()) === 0);
  const okNote = await page.locator('.ins-ok-note').innerText();
  ok('it says the cover is enough, and how little is to spare', okNote.includes('$12,000') && okNote.includes('$11,739') && okNote.includes('Only $261 to spare'), okNote);

  /* ---------- lower the cover ---------- */
  await page.click('[aria-label="Edit Instruments & equipment policy"]');
  await form(page, 'Edit policy').waitFor();
  ok('the edit form has the policy', (await form(page, 'Edit policy').locator('[data-key=cover]').inputValue()) === '12000');
  await form(page, 'Edit policy').locator('[data-key=cover]').fill('8000');
  await form(page, 'Edit policy').locator('button[type=submit]').click();
  await page.waitForSelector('.ins-warn');
  ok('the lower cover is stored as a number', await store(page, s => s.byId('insurance', 's-ins1').cover === 8000));
  const warn = await page.locator('.ins-warn').innerText();
  ok('lowering the cover below the backline warns', warn.includes('$8,000') && warn.includes('$3,739 short') && warn.includes('$11,739'), warn);
  ok('the warning offers to update the cover', await page.locator('#ins-raise').isVisible());
  await page.click('#ins-raise');
  await form(page, 'Edit policy').waitFor();
  ok('Update the cover opens that policy', (await form(page, 'Edit policy').locator('[data-key=cover]').inputValue()) === '8000');
  await page.keyboard.press('Escape'); await sleep(250);
  await store(page, s => s.upsert('gear', { id: 't-amp', name: 'Bass amp', category: 'Amps & cabs', value: 500, qty: 2 }));
  await sleep(200);
  ok('the check follows the backline as it grows', (await page.locator('.ins-warn').innerText()).includes('$4,739 short'), await page.locator('.ins-warn').innerText());
  await page.click('#ins-backline'); await sleep(700);
  ok('the warning links to Backline', (await page.evaluate(() => window.logiPage())) === 'backline');
  await go(page, 'insurance');

  /* ---------- an expired policy is not counted ---------- */
  const yesterday = await dayIn(page, -1);
  await page.click('[aria-label="Edit Instruments & equipment policy"]');
  await form(page, 'Edit policy').waitFor();
  await form(page, 'Edit policy').locator('[data-key=renewal]').fill(yesterday);
  await form(page, 'Edit policy').locator('button[type=submit]').click(); await sleep(300);
  const exp = page.locator('.ins-card[data-id="s-ins1"] .ins-pill');
  ok('an expired policy says so', (await exp.innerText()) === 'Expired 1 day ago' && (await exp.getAttribute('class')).includes('ins-expired'), await exp.innerText());
  const w2 = await page.locator('.ins-warn').innerText();
  ok('expired cover is not counted', w2.includes('no current instruments & equipment cover') && w2.includes('An expired policy is not counted'), w2);
  ok('premiums count only current policies', (await page.locator('.ins-stats').innerText()).includes('$95'));

  /* ---------- add a policy ---------- */
  const in10 = await dayIn(page, 10);
  await page.click('#ins-add');
  const add = form(page, 'Add policy');
  await add.waitFor();
  await add.locator('[data-key=type]').fill('Vehicle');
  await add.locator('[data-key=provider]').fill('Van Cover Co');
  await add.locator('[data-key=policy]').fill('VN-77');
  await add.locator('[data-key=cover]').fill('15000');
  await add.locator('[data-key=premium]').fill('480');
  await add.locator('[data-key=renewal]').fill(in10);
  await add.locator('[data-key=phone]').fill('+1 555 0190');
  await add.locator('[data-key=link]').fill('drive.example.com/van-cert.pdf');
  await add.locator('button[type=submit]').click(); await sleep(300);
  const van = await store(page, s => s.db.insurance.find(p => p.policy === 'VN-77'));
  ok('the new policy is stored', !!van && van.type === 'Vehicle' && van.provider === 'Van Cover Co');
  ok('with its numbers as numbers and its renewal date', van && van.cover === 15000 && van.premium === 480 && van.renewal === in10);
  ok('it takes its place by renewal date', JSON.stringify(await ids(page)) === JSON.stringify(['s-ins1', van.id, 's-ins2']), (await ids(page)).join());
  const vp = page.locator(`.ins-card[data-id="${van.id}"] .ins-pill`);
  ok('its renewal pill counts down', (await vp.innerText()) === '10 days left' && (await vp.getAttribute('class')).includes('ins-due'));
  ok('the certificate opens from the card', (await page.getAttribute(`.ins-card[data-id="${van.id}"] .ins-cert`, 'href')) === 'https://drive.example.com/van-cert.pdf');
  const send = decodeURIComponent(await page.getAttribute(`.ins-card[data-id="${van.id}"] .ins-send`, 'href'));
  ok('Send writes an email with the policy and the certificate link', send.startsWith('mailto:?subject=Vehicle certificate') && send.includes('Policy number: VN-77') && send.includes('https://drive.example.com/van-cert.pdf') && send.includes('Cover: $15,000'), send);
  ok('but never the premium', !send.includes('480'), send);
  ok('the insurer can be called from the card', (await page.locator(`.ins-card[data-id="${van.id}"] a[href="tel:+15550190"]`).count()) === 1);
  ok('the stats include it', /3\s*policies/.test(await page.locator('.ins-stats').innerText()) && (await page.locator('.ins-stats').innerText()).includes('$575'));

  /* ---------- new instruments cover from the warning ---------- */
  await page.click('#ins-add-eq');
  const eqForm = form(page, 'Add policy');
  await eqForm.waitFor();
  ok('the warning’s button starts an instruments policy for the backline’s value', (await eqForm.locator('[data-key=type]').inputValue()) === 'Instruments & equipment' && (await eqForm.locator('[data-key=cover]').inputValue()) === '12800', await eqForm.locator('[data-key=cover]').inputValue());
  await eqForm.locator('[data-key=provider]').fill('Sample Music Insurance');
  await eqForm.locator('[data-key=renewal]').fill(await dayIn(page, 365));
  await eqForm.locator('button[type=submit]').click(); await sleep(300);
  ok('with that cover in place the warning goes', (await page.locator('.ins-warn').count()) === 0 && (await page.locator('.ins-ok-note').count()) === 1);

  /* ---------- blank numbers ---------- */
  await page.click('#ins-add');
  await form(page, 'Add policy').waitFor();
  await form(page, 'Add policy').locator('[data-key=type]').fill('Travel & touring');
  await form(page, 'Add policy').locator('[data-key=provider]').fill('Road Cover');
  await form(page, 'Add policy').locator('button[type=submit]').click(); await sleep(300);
  const text = await page.locator('.ins-page').innerText();
  ok('a policy with no numbers or date shows no blanks or NaN', !/NaN|undefined|null/.test(text));
  const travelId = await store(page, s => s.db.insurance.find(p => p.provider === 'Road Cover').id);
  ok('it goes to the end, with no pill', (await ids(page)).pop() === travelId && (await page.locator(`.ins-card[data-id="${travelId}"] .ins-pill`).count()) === 0);

  /* ---------- delete ---------- */
  await page.click(`.ins-card[data-id="${van.id}"] [aria-label="Edit Vehicle policy"]`);
  await form(page, 'Edit policy').waitFor();
  await page.click('.sheet[aria-label="Edit policy"] .form-actions .btn.danger'); await sleep(300);
  ok('a policy can be deleted', await store(page, (s, id) => !s.byId('insurance', id), van.id) && (await page.locator(`.ins-card[data-id="${van.id}"]`).count()) === 0);

  /* ---------- tutorials ---------- */
  await page.click('#helpBtn');
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  ok('the page tutorial starts on Insurance', (await page.innerText('.tour-card h2')) === 'Insurance');
  await page.keyboard.press('Escape'); await sleep(250);
  await page.click('#ins-add');
  await form(page, 'Add policy').waitFor();
  await form(page, 'Add policy').locator('.sheet-help').click();
  await page.waitForSelector('.tour-card', { timeout: 8000 });
  ok('the policy form has its own tutorial', (await page.innerText('.tour-card h2')) === 'Type of cover');
  await page.keyboard.press('Escape'); await sleep(250);
  await page.keyboard.press('Escape'); await sleep(250);

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL insurance crashed — ' + e.message); process.exit(1); });

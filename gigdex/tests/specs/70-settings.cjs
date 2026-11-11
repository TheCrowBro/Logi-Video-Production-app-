// Settings and backups: your details and the contact card, the currency everywhere, saving a backup and bringing one
// back (merge, replace, a locked one, a Vdex file refused), the sample loaded and removed with references cleaned,
// the display and Quotes & invoices panels, help, remembered sections, a copy kept in a file, the reminder, and
// erasing the device.
const { open, ok, sleep, go, BASE } = require('../helpers.cjs');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');

// Like helpers.open, in a browser profile kept on disk: a file handle stored in IndexedDB only reads back there (in a
// throwaway profile, headless Chromium closes the page).
async function openKept({ sample = false, tab = null, init = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdex-profile-'));
  const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 420, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('gdex-tour', 'done'); } catch (e) { /* ignore */ } });
  if (init) await ctx.addInitScript(init);
  const page = ctx.pages()[0] || await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('#rolodex .drum-btn');
  if (sample) { await page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(150); }
  if (tab) await go(page, tab);
  const browser = { close: async () => { await ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
  return { browser, page, errors };
}

const data = page => page.evaluate(() => import('./js/store.js').then(s => JSON.parse(s.serialize())));
const run = (page, fn, arg) => page.evaluate(fn, arg);
// Tap like a person: bring it to the middle of the screen (clear of the Rolodex bar), then click.
async function tap(page, sel) {
  await page.waitForSelector(sel, { state: 'visible', timeout: 15000 });
  await page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await sleep(80);
  await page.click(sel);
}
async function openSec(page, id) {
  await page.waitForSelector('#se-' + id);
  if (!(await page.$eval('#se-' + id, d => d.open))) await tap(page, `#se-${id}-sum`);
  await sleep(150);
}
const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
async function download(page, sel) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), tap(page, sel)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
}
const pick = (page, name, body) => page.setInputFiles('#page .se-bk-input', { name, mimeType: 'application/json', buffer: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
const sheetOf = title => `.sheet[aria-label="${title}"]`;

(async () => {
  /* ------------------------------ a new device ------------------------------ */
  // This browser has no File System Access: the copy-in-a-file card explains instead.
  let { browser, page, errors } = await open({ tab: 'settings', init: () => { window.showSaveFilePicker = undefined; } });
  await page.waitForSelector('#se-profile');
  const ids = await page.$$eval('#page details.se-sec', ds => ds.map(d => d.id));
  ok('eight sections, in order', ids.join(',') === 'se-profile,se-billing,se-backups,se-display,se-help,se-sample,se-about,se-erase', ids.join(','));
  ok('every section has a line saying where it stands', (await page.$$eval('#page .se-sec > summary .se-sub', s => s.filter(x => x.textContent.trim()).length)) === 8);
  ok('your details say they are not set yet', /Not set yet/.test(await text(page, '#se-profile .se-sub')));

  // Your details
  await openSec(page, 'profile');
  ok('an empty profile offers to add your details', (await text(page, '#se-edit-profile')).includes('Add your details') && (await page.locator('#se-profile .se-empty').count()) === 1);
  ok('no contact card without a name and a way to reach you', await page.$eval('#se-vcf', b => b.disabled) && (await page.locator('#se-profile .se-qr-none').count()) === 1 && (await page.locator('#se-profile .se-qr').count()) === 0);
  await tap(page, '#se-edit-profile');
  await page.waitForSelector(sheetOf('Your details'));
  await page.click(`${sheetOf('Your details')} .sheet-help`);
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('the details form has its own walkthrough', /Who you are/.test(await text(page, '.tour-card h2')));
  await page.keyboard.press('Escape');
  await sleep(200);
  const fill = async (key, v) => page.fill(`${sheetOf('Your details')} [data-key="${key}"]`, v);
  await fill('name', 'Maya Brooks'); await fill('business', 'Night Owls, Ltd'); await fill('role', 'Band leader');
  await fill('phone', '+1 555 0141'); await fill('email', 'maya@example.com'); await fill('website', 'nightowls.example.com');
  await fill('location', 'Harbourtown'); await fill('address', '12 Quay Street\nHarbourtown HT1 2AB'); await fill('currency', ' £ '); await fill('bio', 'Singer and band leader.');
  await page.click(`${sheetOf('Your details')} button[type=submit]`);
  await sleep(300);
  let d = await data(page);
  ok('the profile is stored', d.profile.name === 'Maya Brooks' && d.profile.business === 'Night Owls, Ltd' && d.profile.role === 'Band leader' && d.profile.address === '12 Quay Street\nHarbourtown HT1 2AB' && d.profile.website === 'nightowls.example.com', JSON.stringify(d.profile));
  ok('the currency symbol is stored trimmed', d.profile.currency === '£', d.profile.currency);
  ok('the details show on the page', /Maya Brooks/.test(await text(page, '#se-profile .se-kv')) && /12 Quay Street/.test(await text(page, '#se-profile .se-kv')));
  ok('the section line shows the name and business', (await text(page, '#se-profile .se-sub')) === 'Maya Brooks · Night Owls, Ltd');
  ok('the edit button now says Edit', (await text(page, '#se-edit-profile')).includes('Edit your details'));
  await page.waitForSelector('#se-profile .se-qr svg', { timeout: 15000 });
  ok('the contact card shows as a QR code', (await page.locator('#se-profile .se-qr svg').count()) === 1);
  ok('the QR code is labelled for screen readers', /Maya Brooks/.test(await page.getAttribute('#se-profile .se-qr', 'aria-label')));

  // The currency on another page: every sum is formatted by model.fmtMoney.
  ok('the currency shows on other pages (fmtMoney)', (await run(page, () => import('./js/model.js').then(m => m.fmtMoney(1250)))) === '£1,250');
  ok('and in the profile', /£1,250/.test(await text(page, '#se-profile .se-kv')));

  // The contact card as a .vcf file
  const vcf = await download(page, '#se-vcf');
  ok('the contact card saves as a .vcf named after you', vcf.name === 'Maya Brooks.vcf', vcf.name);
  ok('the .vcf is a vCard with the details', /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/.test(vcf.text) && vcf.text.includes('N:Brooks;Maya;;;') && vcf.text.includes('FN:Maya Brooks') && vcf.text.includes('TEL;TYPE=CELL:+1 555 0141') && vcf.text.includes('EMAIL;TYPE=INTERNET:maya@example.com') && vcf.text.includes('URL:https://nightowls.example.com') && /END:VCARD$/.test(vcf.text), JSON.stringify(vcf.text));
  ok('commas and new lines are escaped in the vCard', vcf.text.includes('ORG:Night Owls\\, Ltd') && vcf.text.includes('ADR;TYPE=WORK:;;12 Quay Street\\nHarbourtown HT1 2AB;;;;'), JSON.stringify(vcf.text));

  // A blank currency falls back to $
  await tap(page, '#se-edit-profile');
  await page.waitForSelector(sheetOf('Your details'));
  await fill('currency', '');
  await page.click(`${sheetOf('Your details')} button[type=submit]`);
  await sleep(250);
  ok('a blank currency becomes $', (await data(page)).profile.currency === '$');
  await tap(page, '#se-edit-profile'); await page.waitForSelector(sheetOf('Your details')); await fill('currency', '£'); await page.click(`${sheetOf('Your details')} button[type=submit]`); await sleep(250);

  // Sample data
  await openSec(page, 'sample');
  ok('the sample is not loaded yet', /Not loaded/.test(await text(page, '#se-sample .se-sub')) && (await page.locator('#se-sample-remove').count()) === 0);
  await tap(page, '#se-sample-load');
  await sleep(300);
  d = await data(page);
  ok('loading the sample fills the database', d.bookings.some(b => b.id === 's-show1') && d.acts.some(a => a.id === 's-owls'));
  ok('the sample does not overwrite your details', d.profile.name === 'Maya Brooks');
  ok('the sample line counts the sample records', /\d+ sample records loaded/.test(await text(page, '#se-sample .se-sub')));

  // Backups: save one
  await openSec(page, 'backups');
  ok('only the sample: nothing of yours to back up', /Only the sample/.test(await text(page, '#page .se-bk-status')));
  ok('without File System Access the file card explains', (await page.locator('#page .se-bk-file[data-state=unsupported]').count()) === 1 && /Chrome or Edge/.test(await text(page, '#page .se-bk-file')));
  const bk = await download(page, '#page .se-bk-save');
  const saved = JSON.parse(bk.text);
  ok('a backup downloads as gdex-backup-YYYY-MM-DD.json', /^gdex-backup-\d{4}-\d{2}-\d{2}\.json$/.test(bk.name), bk.name);
  ok('the backup is a Gdex file with the records', saved.app === 'gdex' && saved.bookings.some(b => b.id === 's-show1') && saved.songs.length === 10 && saved.profile.name === 'Maya Brooks');
  ok('the time of the backup is remembered', Number(await run(page, () => localStorage.getItem('gdex-backup-at'))) > Date.now() - 60000);
  await sleep(200);
  ok('the panel says when the last backup was', /Last backup just now/.test(await text(page, '#page .se-bk-status')) && (await page.getAttribute('#page .se-bk-status', 'data-level')) === 'ok');
  ok('the section line follows without a redraw', /Last backup just now/.test(await text(page, '#se-backups .se-sub')));

  // Merge a modified copy: a new song comes in, a record only here stays, and a newer change here wins.
  const later = Date.now() + 5000;
  const modified = JSON.parse(bk.text);
  modified.songs.push({ id: 't-new', title: 'Brand New Song', actId: 's-owls', duration: 200, createdAt: later, updatedAt: later });
  modified.songs.find(s => s.id === 's-song2').title = 'Paper Moon (from the file)';
  modified.songs.find(s => s.id === 's-song2').updatedAt = later;
  await run(page, () => import('./js/store.js').then(s => { s.upsert('venues', { id: 't-local', kind: 'venue', name: 'Local Only Room' }); s.patch('songs', 's-song1', { title: 'Harbour Lights (live)' }); }));
  await sleep(100);
  await pick(page, 'gdex-backup-modified.json', modified);
  await page.waitForSelector(sheetOf('Bring back a backup'));
  const impText = await text(page, sheetOf('Bring back a backup'));
  ok('the import sheet says what is in the file and on this device', /In the file:.*11 songs/.test(impText) && /On this device now:.*10 songs/.test(impText) && /6 venues/.test(impText), impText.slice(0, 300));
  ok('it offers merge and replace', (await page.locator(`${sheetOf('Bring back a backup')} .se-imp-merge`).count()) === 1 && (await page.locator(`${sheetOf('Bring back a backup')} .se-imp-replace`).count()) === 1);
  await page.click(`${sheetOf('Bring back a backup')} .se-imp-merge`);
  const mergedToast = await page.locator('.toast', { hasText: 'Merged' }).last().innerText({ timeout: 5000 }).catch(() => '');
  d = await data(page);
  ok('merge brings in the new song', d.songs.some(s => s.id === 't-new' && s.title === 'Brand New Song'));
  ok('merge keeps a record that is only on this device', d.venues.some(v => v.id === 't-local'));
  ok('merge takes the file’s newer change', d.songs.find(s => s.id === 's-song2').title === 'Paper Moon (from the file)');
  ok('merge keeps this device’s newer change', d.songs.find(s => s.id === 's-song1').title === 'Harbour Lights (live)');
  ok('a toast says what the merge did', /Merged: 1 new, 1 updated/.test(mergedToast), mergedToast);
  ok('the import sheet closed', (await page.locator(sheetOf('Bring back a backup')).count()) === 0);

  // Replace with the original backup
  await sleep(2800); // the toast fades
  await pick(page, bk.name, bk.text);
  await page.waitForSelector(sheetOf('Bring back a backup'));
  await page.click(`${sheetOf('Bring back a backup')} .se-imp-replace`); // the confirm is accepted
  await sleep(400);
  d = await data(page);
  ok('replace makes this device like the file', !d.venues.some(v => v.id === 't-local') && !d.songs.some(s => s.id === 't-new') && d.songs.find(s => s.id === 's-song1').title === 'Harbour Lights' && d.bookings.length === saved.bookings.length);
  ok('replace keeps the details from the file', d.profile.name === 'Maya Brooks' && d.profile.currency === '£');

  // Files that are not Gdex backups are refused, and nothing changes.
  const before = (await data(page)).bookings.length;
  await pick(page, 'vdex-backup-2026-11-01.json', { version: 3, updatedAt: Date.now(), bookings: [{ id: 'v1', title: 'Wedding shoot' }], gear: [{ id: 'g1', name: 'FX3' }], crew: [{ id: 'c1', name: 'Cam Op' }], venues: [], logs: [], shifts: [], insurance: [] });
  await page.waitForSelector(sheetOf('That file can’t be used'));
  ok('a Vdex backup is refused with a clear message', /This is a Vdex backup, not a Gdex one/.test(await text(page, sheetOf('That file can’t be used'))));
  await page.click(`${sheetOf('That file can’t be used')} .btn.primary`);
  ok('the Vdex file changed nothing', (await data(page)).bookings.length === before && !(await data(page)).bookings.some(b => b.id === 'v1'));
  await pick(page, 'notes.json', '{ this is not json');
  await page.waitForSelector(sheetOf('That file can’t be used'));
  ok('a file that is not JSON is refused', /couldn’t be read as a backup/.test(await text(page, sheetOf('That file can’t be used'))));
  await page.keyboard.press('Escape');
  await pick(page, 'list.json', [1, 2, 3]);
  await page.waitForSelector(sheetOf('That file can’t be used'));
  ok('JSON that is not a Gdex backup is refused', /not a Gdex backup/.test(await text(page, sheetOf('That file can’t be used'))));
  await page.keyboard.press('Escape');
  await sleep(200);

  // A backup locked with a passphrase
  await tap(page, '#page .se-bk-lock');
  await page.waitForSelector(sheetOf('Save with a passphrase'));
  const passSheet = sheetOf('Save with a passphrase');
  await page.fill('#se-pass-1', 'short'); await page.fill('#se-pass-2', 'short');
  await page.click(`${passSheet} button[type=submit]`);
  ok('a short passphrase is refused', /at least 8/.test(await text(page, `${passSheet} .warn`)));
  await page.fill('#se-pass-1', 'night owls 2026'); await page.fill('#se-pass-2', 'night owls 2025');
  await page.click(`${passSheet} button[type=submit]`);
  ok('two different passphrases are refused', /don’t match/.test(await text(page, `${passSheet} .warn`)));
  await page.fill('#se-pass-2', 'night owls 2026');
  const [ldl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click(`${passSheet} button[type=submit]`)]);
  const locked = fs.readFileSync(await ldl.path(), 'utf8');
  ok('the locked backup is saved as .locked.json', /^gdex-backup-\d{4}-\d{2}-\d{2}\.locked\.json$/.test(ldl.suggestedFilename()), ldl.suggestedFilename());
  ok('the locked backup holds nothing readable', JSON.parse(locked).gdex === 'encrypted-backup' && !/Night Owls|Maya|Lantern/.test(locked));
  await sleep(300);
  await pick(page, ldl.suggestedFilename(), locked);
  await page.waitForSelector(sheetOf('Locked backup'));
  await page.fill('#se-pass-1', 'wrong passphrase');
  await page.click(`${sheetOf('Locked backup')} button[type=submit]`);
  await page.waitForSelector(`${sheetOf('Locked backup')} .warn:not([hidden])`, { timeout: 15000 });
  ok('a wrong passphrase does not open it', /doesn’t open this file/.test(await text(page, `${sheetOf('Locked backup')} .warn`)));
  await page.fill('#se-pass-1', 'night owls 2026');
  await page.click(`${sheetOf('Locked backup')} button[type=submit]`);
  await page.waitForSelector(sheetOf('Bring back a backup'), { timeout: 15000 });
  ok('the right passphrase opens it', /In the file:.*7 bookings/.test(await text(page, sheetOf('Bring back a backup'))));
  await page.click(`${sheetOf('Bring back a backup')} .btn.ghost`); // Cancel
  await sleep(200);
  ok('cancelling changes nothing', (await data(page)).bookings.length === before && (await page.locator('.sheet').count()) === 0);

  // Remove the sample: your own records stay, and their links to sample records are cleaned up.
  await run(page, () => import('./js/store.js').then(s => {
    s.upsert('people', { id: 't-me', name: 'Sam Keys', group: 'band' });
    s.upsert('bookings', { id: 't-own', kind: 'show', status: 'confirmed', date: '2026-12-01', actId: 's-owls', venueId: 's-lantern', setlistId: 's-clubset', people: ['s-maya', 't-me'], gear: ['s-tele'], settlement: { shares: { 's-maya': 1, 't-me': 1 } } });
    s.upsert('setlists', { id: 't-set', name: 'Own set', actId: 's-owls', items: [{ id: 'x1', songId: 's-song1' }, { id: 'x2', title: 'A new one' }] });
  }));
  await openSec(page, 'sample');
  await tap(page, '#se-sample-remove');
  await sleep(500);
  d = await data(page);
  const leftovers = ['bookings', 'acts', 'people', 'gear', 'kits', 'venues', 'songs', 'setlists', 'logs', 'shifts', 'insurance'].flatMap(c => d[c].filter(r => r.sample || /^s-/.test(r.id)).map(r => c + ':' + r.id));
  ok('removing the sample removes every sample record', leftovers.length === 0, leftovers.join(', '));
  const own = d.bookings.find(b => b.id === 't-own');
  ok('your own records stay', !!own && d.people.some(p => p.id === 't-me') && d.setlists.some(s => s.id === 't-set'));
  ok('a booking of yours loses its links to the sample', own.actId === '' && own.venueId === '' && own.setlistId === '' && own.people.join() === 't-me' && own.gear.length === 0 && !('s-maya' in own.settlement.shares), JSON.stringify(own));
  ok('it keeps the sample venue’s name as text', own.venueName === 'The Lantern Rooms' && /Quay Street/.test(own.address));
  const ownSet = d.setlists.find(s => s.id === 't-set');
  ok('a setlist of yours keeps the sample song’s title as text', ownSet.items[0].songId === '' && ownSet.items[0].title === 'Harbour Lights' && ownSet.actId === '');
  ok('removed records are remembered as deleted (a merge won’t bring them back)', ['s-show1', 's-owls', 's-song1'].every(id => d.deleted[id] > 0));
  ok('your details are not the sample’s, so they stay', d.profile.name === 'Maya Brooks');
  ok('the sample line says it is not loaded', /Not loaded/.test(await text(page, '#se-sample .se-sub')));

  // Display & accessibility
  await openSec(page, 'display');
  await page.locator('#se-display .seg button', { hasText: /^Large$/ }).first().click();
  await sleep(150);
  ok('the display panel works inside Settings', (await page.getAttribute('html', 'data-text')) === 'large');
  ok('its line follows the choice', /large text/i.test(await text(page, '#se-display .se-sub')));
  await page.locator('#se-display .seg button', { hasText: /^Standard$/ }).first().click();
  await sleep(150);
  ok('and back to standard', (await page.getAttribute('html', 'data-text')) === 'normal');

  // Quotes & invoices mounts money.js's panels
  await openSec(page, 'billing');
  await sleep(300);
  ok('Quotes & invoices mounts without errors', (await page.locator('#se-billing .se-money').count()) === 1 && !/Loading…|could not be loaded/.test(await text(page, '#se-billing .se-money')));

  // Help
  await openSec(page, 'help');
  await tap(page, '#se-tutorials');
  await page.waitForSelector(sheetOf('Tutorials'), { timeout: 10000 });
  ok('Help opens the tutorials chooser', (await page.locator(`${sheetOf('Tutorials')} .card.tap`).count()) === 11);
  await page.keyboard.press('Escape');
  await sleep(200);
  await run(page, () => window.logiHelp());
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('the Settings walkthrough runs', /Settings/.test(await text(page, '.tour-card h2')));
  for (let i = 0; i < 16 && (await page.locator('.tour-card').count()); i++) { await page.locator('.tour-card .btn.primary').click(); await sleep(450); }
  ok('the walkthrough reaches its end', (await page.locator('.tour').count()) === 0);

  // About
  await openSec(page, 'about');
  ok('About shows the version and where data is kept', /Gdex \d+\.\d+\.\d+/.test(await text(page, '#se-about')) && /stays in this browser, on this device/.test(await text(page, '#se-about')) && (await page.locator('#se-about a[href="privacy.html"]').count()) === 1);

  // The ☁ button opens the same panel in a sheet
  await page.click('#cloudBtn');
  await page.waitForSelector(`${sheetOf('Backups')} .se-bk-save`, { timeout: 10000 });
  ok('the ☁ button opens the Backups sheet', (await page.locator(`${sheetOf('Backups')} .se-bk-status`).count()) === 1);
  await page.click(`${sheetOf('Backups')} .sheet-help`);
  await page.waitForSelector('.tour-card', { timeout: 10000 });
  ok('the Backups sheet has its own walkthrough', /How safe your data is/.test(await text(page, '.tour-card h2')));
  await page.keyboard.press('Escape');
  await sleep(200);
  ok('Escape ends the walkthrough and keeps the sheet', (await page.locator('.tour').count()) === 0 && (await page.locator(sheetOf('Backups')).count()) === 1);
  await page.keyboard.press('Escape');
  await sleep(200);

  // Sections stay open across a reload
  const openNow = await page.$$eval('#page details.se-sec[open]', ds => ds.map(x => x.id).sort().join());
  await page.reload();
  await page.waitForSelector('#rolodex .drum-btn');
  await go(page, 'settings');
  await page.waitForSelector('#se-profile');
  ok('open sections are remembered', (await page.$$eval('#page details.se-sec[open]', ds => ds.map(x => x.id).sort().join())) === openNow, openNow);

  // The reminder
  const nudge = await run(page, () => import('./js/backup.js').then(async b => {
    const s = await import('./js/store.js');
    ['gdex-backup-at', 'gdex-file-at', 'gdex-backup-nudge'].forEach(k => localStorage.removeItem(k));
    s.upsert('bookings', { id: 't-old', kind: 'show', status: 'confirmed', date: '2026-12-05', createdAt: Date.now() - 3 * 864e5 });
    const first = b.nudgeIfStale(), second = b.nudgeIfStale();
    localStorage.removeItem('gdex-backup-nudge'); localStorage.setItem('gdex-backup-at', String(Date.now() - 2 * 864e5));
    const recent = b.nudgeIfStale();
    localStorage.removeItem('gdex-backup-nudge'); localStorage.setItem('gdex-backup-at', String(Date.now() - 20 * 864e5));
    const old = b.nudgeIfStale();
    return { first, second, recent, old, level: b.health().level };
  }));
  ok('with no backup, a reminder', nudge.first === true);
  ok('at most once every 14 days', nudge.second === false);
  ok('no reminder after a recent backup', nudge.recent === false);
  ok('a reminder when the last backup is old', nudge.old === true && nudge.level === 'old', JSON.stringify(nudge));

  // Erase this device
  await openSec(page, 'erase');
  ok('erase is disabled until ERASE is typed', await page.$eval('#se-erase-go', b => b.disabled));
  await page.fill('#se-erase-input', 'ERASE');
  await go(page, 'bookings'); await go(page, 'settings'); await page.waitForSelector('#se-erase-input');
  ok('leaving Settings disarms erase', (await page.$eval('#se-erase-input', i => i.value)) === '' && await page.$eval('#se-erase-go', b => b.disabled));
  await page.fill('#se-erase-input', 'eras');
  ok('a near miss keeps it disabled', await page.$eval('#se-erase-go', b => b.disabled));
  await page.fill('#se-erase-input', 'erase');
  ok('typing erase arms it', !(await page.$eval('#se-erase-go', b => b.disabled)));
  await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click('#se-erase-go')]);
  await page.waitForSelector('#rolodex .drum-btn');
  await sleep(300);
  d = await data(page);
  ok('erase empties the database', ['bookings', 'acts', 'people', 'gear', 'songs', 'venues', 'setlists'].every(c => d[c].length === 0) && d.profile.name === '' && d.profile.currency === '$');
  ok('and forgets the backup times', (await run(page, () => localStorage.getItem('gdex-backup-at'))) === null);
  // A merge keeps a newer profile that has no personal name but is filled in (a band or business name, currency…);
  // only an empty profile or the sample's stand-in gives way to the file's whatever their times.
  const merged = await page.evaluate(() => import('./js/store.js').then(st => {
    const local = { ...st.db, profile: { name: '', business: 'Real Sound', currency: '£', email: 'new@x.test', updatedAt: Date.now() } };
    const file = { app: 'gdex', profile: { name: 'Old Name', business: 'Old Biz', currency: '$', email: 'old@x.test', updatedAt: Date.now() - 365 * 864e5 } };
    const a = st.mergeDb(local, file).profile;
    const b = st.mergeDb({ ...st.db, profile: { name: 'Sample Producer', business: 'Sample Sound', updatedAt: Date.now() } }, file).profile;
    const c = st.mergeDb({ ...st.db, profile: { name: '', currency: '$', updatedAt: Date.now() } }, file).profile;
    return { a: a.business + ' ' + a.currency, b: b.name, c: c.name };
  }));
  ok('a merge keeps the newer filled-in profile without a name', merged.a === 'Real Sound £', JSON.stringify(merged));
  ok('…but the sample’s stand-in and an empty profile give way to the file’s', merged.b === 'Old Name' && merged.c === 'Old Name', JSON.stringify(merged));
  ok('no errors in the console (new device)', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  /* ------------------------------ a copy kept in a file ------------------------------ */
  // The file picker hands back a file in the browser's private file system, which behaves like one on disk.
  ({ browser, page, errors } = await openKept({ sample: true, tab: 'settings', init: () => {
    window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('gdex-db.json', { create: true });
  } }));
  const readCopy = () => page.evaluate(async () => { try { return await (await (await (await navigator.storage.getDirectory()).getFileHandle('gdex-db.json')).getFile()).text(); } catch { return ''; } });
  const kept = () => page.evaluate(() => new Promise(res => { const r = indexedDB.open('gdex', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const t = r.result.transaction('kv', 'readonly').objectStore('kv').get('fileHandle'); t.onsuccess = () => { res(!!t.result); r.result.close(); }; t.onerror = () => res(false); }; r.onerror = () => res(false); }));
  await openSec(page, 'backups');
  ok('the file card offers to choose a file', (await page.locator('#page .se-bk-file[data-state=off] .se-bk-link').count()) === 1);
  await tap(page, '#page .se-bk-link');
  await page.waitForSelector('#page .se-bk-file[data-state=saved]', { timeout: 15000 });
  let copy = await readCopy();
  ok('choosing a file writes the database to it', copy && JSON.parse(copy).app === 'gdex' && JSON.parse(copy).bookings.some(b => b.id === 's-show1'));
  ok('the file is remembered for next time', await kept());
  ok('the ☁ button shows the copy is saved', (await page.getAttribute('#cloudBtn', 'data-state')) === 'synced' && (await page.$eval('#cloudLabel', e => e.textContent)) === 'Saved');
  ok('the section line names the file', /copy in gdex-db\.json/.test(await text(page, '#se-backups .se-sub')));
  await run(page, () => import('./js/store.js').then(s => s.upsert('songs', { id: 't-copy', title: 'Copy Test Song' })));
  await sleep(2600);
  copy = await readCopy();
  ok('a change is written to the file a moment later', copy.includes('Copy Test Song'));
  await page.reload();
  await page.waitForSelector('#rolodex .drum-btn');
  await go(page, 'settings');
  await page.waitForSelector('#page .se-bk-file[data-state=saved]', { timeout: 15000 });
  ok('after a reload the file is linked again', /Copy kept in gdex-db\.json/.test(await text(page, '#page .se-bk-file')));
  await tap(page, '#page .se-bk-unlink');
  await page.waitForSelector('#page .se-bk-file[data-state=off]', { timeout: 10000 });
  ok('Stop unlinks the file', !(await kept()) && (await page.getAttribute('#cloudBtn', 'data-state')) === null);
  await run(page, () => import('./js/store.js').then(s => s.upsert('songs', { id: 't-after', title: 'After Stop Song' })));
  await sleep(2600);
  copy = await readCopy();
  ok('after Stop the file is left as it was', copy.includes('Copy Test Song') && !copy.includes('After Stop Song'));

  // The sample's stand-in name goes with the sample.
  ok('the sample fills in a stand-in name', (await data(page)).profile.name === 'Sample Producer');
  await openSec(page, 'sample');
  await tap(page, '#se-sample-remove');
  await sleep(400);
  d = await data(page);
  ok('removing the sample clears the stand-in name', d.profile.name === '' && d.profile.business === '');
  ok('and leaves records of your own', d.songs.some(s => s.id === 't-copy') && d.songs.some(s => s.id === 't-after'));
  ok('no errors in the console (file copy)', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();

  /* ------------------------------ the file asks again, or can't be written ------------------------------ */
  // A file whose permission and failures the test controls (it can't be kept in IndexedDB, as a real one can).
  ({ browser, page, errors } = await open({ tab: 'settings', init: () => {
    window.__perm = 'granted'; window.__fail = '';
    window.showSaveFilePicker = async () => {
      const real = await (await navigator.storage.getDirectory()).getFileHandle('wrapped.json', { create: true });
      return { kind: 'file', name: 'Gdex in Dropbox.json',
        queryPermission: async () => window.__perm, requestPermission: async () => (window.__perm = 'granted'),
        getFile: () => real.getFile(),
        createWritable: async () => { if (window.__fail) { const e = new Error('gone'); e.name = window.__fail; throw e; } return real.createWritable(); } };
    };
  } }));
  const readWrapped = () => page.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('wrapped.json')).getFile()).text());
  await openSec(page, 'backups');
  await tap(page, '#page .se-bk-link');
  await page.waitForSelector('#page .se-bk-file[data-state=saved]', { timeout: 15000 });
  ok('a file the browser can’t remember says so', /couldn’t remember the file/.test(await text(page, '#page .se-bk-file')));
  await run(page, () => { window.__perm = 'prompt'; return import('./js/store.js').then(s => s.upsert('songs', { id: 't-perm', title: 'Waiting Song' })); });
  await page.waitForSelector('#page .se-bk-file[data-state=needs-permission]', { timeout: 10000 });
  ok('when the browser asks again, the panel asks for your OK', /needs your OK to keep writing to Gdex in Dropbox\.json/.test(await text(page, '#page .se-bk-file')));
  ok('the ☁ button says Allow', (await page.getAttribute('#cloudBtn', 'data-state')) === 'needs-permission' && (await page.$eval('#cloudLabel', e => e.textContent)) === 'Allow');
  ok('the section line says so too', /needs your OK/.test(await text(page, '#se-backups .se-sub')));
  ok('nothing was written meanwhile', !(await readWrapped()).includes('Waiting Song'));
  await page.locator('#page .se-bk-file .btn.primary', { hasText: 'Allow' }).click();
  await page.waitForSelector('#page .se-bk-file[data-state=saved]', { timeout: 10000 });
  ok('Allow writes the changes made meanwhile', (await readWrapped()).includes('Waiting Song'));
  await run(page, () => { window.__fail = 'NotFoundError'; return import('./js/store.js').then(s => s.upsert('songs', { id: 't-fail', title: 'Lost Song' })); });
  await page.waitForSelector('#page .se-bk-file[data-state=error]', { timeout: 10000 });
  ok('a file that was moved says so, with Try again', /moved or deleted/.test(await text(page, '#page .se-bk-file')) && (await page.locator('#page .se-bk-file .btn', { hasText: 'Try again' }).count()) === 1);
  ok('the ☁ button says Not saved', (await page.$eval('#cloudLabel', e => e.textContent)) === 'Not saved');
  await run(page, () => { window.__fail = ''; });
  await page.locator('#page .se-bk-file .btn', { hasText: 'Try again' }).click();
  await page.waitForSelector('#page .se-bk-file[data-state=saved]', { timeout: 10000 });
  ok('Try again saves it', (await readWrapped()).includes('Lost Song'));
  ok('no errors in the console (asking again)', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL settings crashed — ' + e.message); process.exit(1); });

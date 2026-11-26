// The Timecode notes page and the field tools, driven as a person drives them: a note being typed outlives every redraw
// of the page, a stamp belongs to the note it was taken for, a change of frame rate keeps every timecode's moment,
// exports say "unsynced", the Sync and Link sheets follow what was done in them, a script line can be chosen by a tap
// or from the keyboard, record run counts a take that was rolling at the sync, and the Sun, white balance, noise and
// range tools let go of the compass, the camera and the microphone when they are left (and only then).
const { chromium } = require('playwright');
const fs = require('fs');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));

(async () => {
  const errors = [];
  const open = async (browser, { phone = true, init = null, permissions = null, clock = false } = {}) => {
    const ctx = await browser.newContext({ viewport: phone ? { width: 420, height: 900 } : { width: 1280, height: 900 }, hasTouch: phone, acceptDownloads: true, serviceWorkers: 'block', ...(permissions ? { permissions } : {}) });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); });
    await ctx.addInitScript(acceptTerms());
    if (init) await ctx.addInitScript({ content: init });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    if (clock) await page.clock.install();
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const toasts = page => page.evaluate(() => window.__toasts.splice(0));
  const openLog = async (page, id, view = 'notes') => { await page.evaluate(([id, view]) => import('./js/pages/tcnotes.js').then(m => m.openLog(id, view)), [id, view]); await sleep(300); };
  const logOf = (page, id) => page.evaluate(id => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.byId('logs', id)))), id);
  const rows = page => page.locator('.tc-note').evaluateAll(els => els.map(e => e.querySelector('.tc-badge').textContent + ' | ' + e.querySelector('.tc-text').textContent));
  const closeSheet = async page => { await page.locator('.sheet button[aria-label="Close"]').last().click(); await sleep(250); };

  /* ------------------------------ Timecode notes ------------------------------ */
  const browser = await chromium.launch();
  const A = await open(browser), page = A.page;
  await page.evaluate(() => import('./js/store.js').then(s => { const now = Date.now(), log = (id, title, rate, more = {}) => ({ id, title, rate, mode: 'free', created: '2026-11-01', notes: [], sync: null, take: 0, autoTakes: true, updatedAt: now, ...more });
    s.update(d => { d.logs.push(
      log('L1', 'Log one', '23.976', { sync: { frames: 86400, ms: now, how: 'typed', rolling: true } }), // 01:00:00:00
      log('L2', 'Log two', '25', { sync: { frames: 900000, ms: now, how: 'typed', rolling: true } }), // 10:00:00:00
      log('L3', 'Not synced', '23.976'),
      log('L4', 'Rec run', '23.976', { mode: 'record' }),
      log('L5', 'Drop frame', '29.97df'),
      log('L6', 'Thirty', '29.97', { sync: { frames: 108028, ms: now, how: 'typed', rolling: true } })); }); })); // 01:00:00:28

  // ---- a note being typed outlives a redraw of the page; its stamp stays with it ----
  await openLog(page, 'L1');
  await page.locator('.tc-compose').click(); await page.keyboard.type('Boom dips into frame at the');
  const stamp = await page.locator('.tc-stamp').first().innerText();
  await page.evaluate(() => import('./js/store.js').then(s => s.touch())); await sleep(200); // any change draws the page again (a sync that brought something, the linked device)
  const typed = () => page.evaluate(() => { const c = document.querySelector('.tc-compose'); return { text: c.value, focus: document.activeElement === c, at: c.selectionStart, stamp: document.querySelector('.tc-stamp').textContent }; });
  let t = await typed();
  ok('a note being typed keeps its text, the cursor and the focus when the page is drawn again', t.text === 'Boom dips into frame at the' && t.focus && t.at === 27, JSON.stringify(t));
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.logs.find(l => l.id === 'L1').notes.push({ id: 'n-far', frames: 86500, text: 'From the other device', at: new Date().toISOString() }); }))); await sleep(200);
  await page.getByRole('button', { name: /Mark now/ }).click(); await sleep(250);
  t = await typed();
  ok('…and through a note from another device and a tap on Mark now, with the stamp taken when the typing began', t.text === 'Boom dips into frame at the' && t.stamp === stamp && /^\d\d:\d\d:\d\d:\d\d$/.test(stamp), JSON.stringify(t) + ' ' + stamp);
  await page.locator('.tc-compose').press('Enter'); await sleep(300);
  ok('Enter adds the note at that stamp and empties the box', (await rows(page)).includes(stamp + ' | Boom dips into frame at the') && (await typed()).text === '', JSON.stringify(await rows(page)));

  // ---- a note being written is kept while another section is in front, so a reload asked for there asks first ----
  await page.locator('.tc-compose').fill('Take 3 is the keeper'); await sleep(100);
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  const asksBefore = await page.evaluate(() => { window.__asked = []; window.__confirm = window.confirm; window.confirm = m => { window.__asked.push(m); return false; }; return 0; });
  await page.evaluate(() => import('./js/update.js').then(u => u.reloadNow())); await sleep(300);
  const heldAsk = await page.evaluate(() => { const a = window.__asked; window.confirm = window.__confirm; return a; });
  await page.evaluate(() => window.logiGo('tcnotes')); await page.waitForSelector('.tc-compose'); await sleep(300);
  const keptDraft = await page.locator('.tc-compose').inputValue();
  await page.locator('.tc-compose').fill(''); await sleep(100);
  const noDraft = await page.evaluate(() => document.body.hasAttribute('data-draft-held'));
  ok('Reload for the new version asks first when a half-typed timecode note is held on a section that is not in front', heldAsk.length === 1 && /Anything typed and not saved will be lost/.test(heldAsk[0]) && keptDraft === 'Take 3 is the keeper' && !noDraft && asksBefore === 0, JSON.stringify([heldAsk, keptDraft, noDraft]));
  // ---- a stamp taken in one log is not carried into the next note of another ----
  await page.locator('.tc-compose').fill('half a thought'); await sleep(100);
  const leftBehind = (await typed()).stamp;
  await openLog(page, 'L2');
  t = await typed();
  ok('another log starts with an empty box and no stamp from the last one', t.text === '' && t.stamp === 'stamps when you type' && /^01:00:/.test(leftBehind), JSON.stringify(t) + ' ' + leftBehind);
  await page.locator('.tc-compose').fill('note in the second log'); await page.locator('.tc-compose').press('Enter'); await sleep(300);
  ok('…and its note is stamped by its own clock', (await rows(page)).some(r => /^10:00:0\d:\d\d \| note in the second log$/.test(r)), JSON.stringify(await rows(page)));

  // ---- a note edited in place: the next press does its job as well as saving the edit ----
  await openLog(page, 'L1');
  const far = page.locator('.tc-note[data-id="n-far"] .tc-text');
  let count = (await logOf(page, 'L1')).notes.length;
  // The cursor goes to the end of the note, wherever the tap landed in it and however a font wraps it (End alone is
  // the end of the line the tap was on: in a wider font the note is two lines, and the words went into the middle).
  const toEnd = () => far.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await far.click(); await toEnd(); await page.keyboard.type(' EDITED');
  await page.evaluate(() => import('./js/store.js').then(s => s.touch())); await sleep(200);
  const inPlace = await page.evaluate(() => { const el = document.activeElement; return { box: el.classList.contains('tc-text'), id: el.closest('.tc-note')?.dataset.id, text: el.textContent }; });
  ok('a note being edited in place keeps its text and the focus when the page is drawn again', inPlace.box && inPlace.id === 'n-far' && inPlace.text === 'From the other device EDITED', JSON.stringify(inPlace));
  await page.getByRole('button', { name: /Mark now/ }).click(); await sleep(300);
  let log = await logOf(page, 'L1');
  ok('Mark now pressed straight after editing a note marks, and the edit is saved', log.notes.length === count + 1 && log.notes.find(n => n.id === 'n-far').text === 'From the other device EDITED', log.notes.length + ' notes, was ' + count);
  await far.click(); await toEnd(); await page.keyboard.type(' again');
  await page.getByRole('button', { name: 'Export' }).click(); await sleep(300);
  ok('…and so does Export: its sheet opens, with the edit in it', (await page.locator('.sheet .export-preview').count()) === 1 && /again/.test(await page.locator('.sheet .export-preview').innerText()));
  await closeSheet(page);
  count = (await logOf(page, 'L1')).notes.length;
  await far.click(); await page.keyboard.type('x');
  await page.locator('.tc-note').last().locator('button[aria-label="Delete note"]').click(); await sleep(300);
  ok('…and ✕ on another note deletes it', (await logOf(page, 'L1')).notes.length === count - 1);

  // ---- a note taken before the sync is exported as unsynced, not at 00:00:00:00 ----
  await openLog(page, 'L3');
  await page.locator('.tc-compose').fill('before sync'); await page.getByRole('button', { name: '+ Add note' }).click(); await sleep(250);
  await page.getByRole('button', { name: 'Export' }).click(); await sleep(250);
  const preview = await page.locator('.sheet .export-preview').innerText();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Share as spreadsheet (.csv)' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('an unsynced note is exported as unsynced in the text, with an empty timecode in the spreadsheet', /^unsynced {2}before sync$/m.test(preview) && !/00:00:00:00/.test(preview + csv) && /^,"before sync",/m.test(csv), JSON.stringify([preview, csv]));
  await closeSheet(page);

  // ---- a new frame rate keeps the sync and every note's moment ----
  await page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.logs.find(l => l.id === 'L1').notes = [{ id: 'r1', frames: 86449, text: 'First note', at: '2026-11-01T10:00:02.000Z' }, { id: 'r2', frames: 100800, text: 'ten minutes in', at: '2026-11-01T10:10:00.000Z' }]; })));
  await openLog(page, 'L1');
  const setRate = async id => { await page.getByRole('button', { name: 'Log settings' }).click(); await page.waitForSelector('.sheet form'); await page.locator('.sheet form select[data-key="rate"]').selectOption(id); await page.locator('.sheet form button[type=submit]').click(); await sleep(350); };
  const was = await rows(page);
  await setRate('25');
  ok('changing a log from 23.976 to 25 keeps each note at the moment it was taken (2 s and 10 min 0.6 s after the sync)', JSON.stringify(was) === JSON.stringify(['01:00:02:01 | First note', '01:10:00:00 | ten minutes in']) && JSON.stringify(await rows(page)) === JSON.stringify(['01:00:02:01 | First note', '01:10:00:15 | ten minutes in']), JSON.stringify([was, await rows(page)]));
  await openLog(page, 'L6'); await setRate('25');
  log = await logOf(page, 'L6');
  ok('a sync at a frame number the new rate has no room for is kept, scaled (01:00:00:28 at 30 is :23 at 25), not thrown away', !!log.sync && log.sync.frames === 90023 && !/not synced/.test(await page.locator('.tc-head').innerText()), JSON.stringify(log.sync));
  const carried = await page.evaluate(() => Promise.all([import('./js/pages/tcnotes.js'), import('./js/timecode.js')]).then(([m, t]) => { const tc = (text, from, to) => t.framesToTc(m.carryTc(t.tcToFrames(text, t.rate(from)), t.rate(from), t.rate(to)), t.rate(to)); return [tc('01:00:00:28', '29.97', '25'), tc('01:01:00:00', '30', '29.97df'), tc('10:20:30:59', '59.94', '23.976'), tc('01:00:00:12', '25', '50'), tc('01:10:00:00', '30', '29.97df')]; }));
  ok('a timecode carried to another rate keeps its hour, minute and second; a number drop-frame skips becomes the next one', JSON.stringify(carried) === JSON.stringify(['01:00:00:23', '01:01:00;02', '10:20:30:23', '01:00:00:24', '01:10:00;00']), JSON.stringify(carried));

  // ---- the Sync sheet: what it says about a refused timecode, record run, Clear sync, the camera ----
  await openLog(page, 'L5');
  await page.getByRole('button', { name: 'Sync', exact: true }).click(); await page.waitForSelector('.sheet .tc-input');
  const trySync = async digits => { await toasts(page); await page.locator('.sheet .tc-input').fill(digits); await page.locator('.sheet .row-edit button.primary').click(); await sleep(200); return (await toasts(page)).join('|'); };
  const said = [await trySync('0100'), await trySync('25000000'), await trySync('01010000')];
  ok('in a drop-frame log only a number drop-frame skips is blamed on drop-frame', /^Enter the timecode/.test(said[0]) && /^Enter the timecode/.test(said[1]) && /skipped in drop-frame/.test(said[2]), JSON.stringify(said));
  await closeSheet(page);

  await openLog(page, 'L4');
  await page.getByRole('button', { name: 'Sync', exact: true }).click(); await page.waitForSelector('.sheet .tc-input');
  await page.locator('.sheet label.check input[type=checkbox]').check();
  await page.locator('.sheet .tc-input').fill('02000000'); await page.locator('.sheet .row-edit button.primary').click(); await sleep(400);
  log = await logOf(page, 'L4');
  ok('a take that is rolling when the log is synced is take 1, with its note at the synced timecode', log.take === 1 && log.notes.length === 1 && log.notes[0].text === '▶ Take 1' && log.notes[0].frames === 172800 && /recording take 1/.test(await page.locator('.tc-head').innerText()), JSON.stringify(log.notes));
  await sleep(1100); await page.getByRole('button', { name: /Cut/ }).click(); await sleep(300);
  log = await logOf(page, 'L4');
  ok('Cut gives that take its length and announces take 1', !!log.notes[0].dur && /^Cut\. Take 1 was/.test(await page.locator('#sr-live').innerText()), JSON.stringify([log.notes[0].dur, await page.locator('#sr-live').innerText()]));
  await page.getByRole('button', { name: /Roll/ }).click(); await sleep(300);
  ok('…and the next Roll is take 2', (await logOf(page, 'L4')).notes.some(n => n.text === '▶ Take 2'));

  await openLog(page, 'L2');
  await page.getByRole('button', { name: 'Re-sync' }).click(); await page.waitForSelector('.sheet .tc-clear');
  await page.locator('.sheet .tc-clear').click(); await sleep(350);
  ok('after Clear sync the sheet says “Not synced yet” and offers no second Clear sync', (await page.locator('.sheet .tc-live').innerText()) === 'Not synced yet' && (await page.locator('.sheet .tc-clear').count()) === 0, await page.locator('.sheet .tc-live').innerText());
  // The camera answers after the sheet was closed (a permission question answered late): it is switched off again.
  await page.evaluate(() => { window.__tracks = []; navigator.mediaDevices.getUserMedia = async () => { await new Promise(r => setTimeout(r, 600)); const s = document.createElement('canvas').captureStream(); window.__tracks.push(...s.getTracks()); return s; }; });
  await page.locator('.sheet .tc-cam-btn').click(); await sleep(100); await closeSheet(page); await sleep(900);
  const tracks = await page.evaluate(() => window.__tracks.map(t => t.readyState));
  ok('a camera allowed after the Sync sheet was closed is switched off', tracks.length === 1 && tracks[0] === 'ended', JSON.stringify(tracks));

  // ---- the script: a tap chooses a line and a second tap lets it go; the keyboard does the same ----
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(400);
  const scriptTab = () => page.getByRole('tab', { name: /^Script/ }).click().then(() => sleep(250));
  await scriptTab();
  const paras = page.locator('.sc-para'), sel = () => page.locator('.sc-para').evaluateAll(els => els.map((e, i) => (e.classList.contains('sel') ? i : -1)).filter(i => i >= 0));
  const markOff = () => page.locator('.sc-bar button.primary').isDisabled();
  await paras.nth(5).click(); const one = await sel();
  await paras.nth(5).click();
  ok('a second tap on the chosen script line lets it go', JSON.stringify(one) === '[5]' && (await sel()).length === 0 && (await markOff()), JSON.stringify([one, await sel()]));
  await paras.nth(6).click();
  await page.getByRole('tab', { name: /^Notes/ }).click(); await sleep(200); await scriptTab(); // the page is drawn again with line 6 chosen
  await paras.nth(7).click(); await paras.nth(6).click();
  ok('a line that was the chosen one at the last redraw can be chosen again after another', JSON.stringify(await sel()) === '[6]' && !(await markOff()), JSON.stringify(await sel()));
  const control = await paras.nth(3).evaluate(e => [e.getAttribute('role'), e.getAttribute('tabindex'), e.getAttribute('aria-pressed')]);
  await paras.nth(3).focus(); await page.keyboard.press('Enter');
  const byKey = [await sel(), await paras.nth(3).getAttribute('aria-pressed'), await markOff()];
  const focusNow = () => page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.classList.contains('sc-para') ? 'line ' + [...document.querySelectorAll('.sc-para')].indexOf(a) : a.textContent.trim()) : 'nothing'; });
  const onMark = await focusNow();
  await page.keyboard.press('Escape'); const letGo = [await sel(), await focusNow()];
  ok('a script line takes the focus and is chosen with Enter or Space, which puts the focus on Mark; Escape there lets the line go and goes back to it', JSON.stringify(control) === '["button","0","false"]' && JSON.stringify(byKey) === '[[3],"true",false]' && /Mark$/.test(onMark) && JSON.stringify(letGo) === '[[],"line 3"]', JSON.stringify([control, byKey, onMark, letGo]));
  // Mark by keyboard: the mark is made, the focus is back on the line, and the next line is one Tab on (not at the top of the page again)
  const marksOn3 = () => paras.nth(3).locator('.sc-badge').count(), had = await marksOn3();
  await page.keyboard.press(' '); await page.keyboard.press('Enter'); await sleep(350);
  const marked = [await marksOn3() - had, await focusNow(), await paras.nth(3).getAttribute('aria-label')];
  await page.keyboard.press('Tab'); if ((await focusNow()) !== 'line 4') await page.keyboard.press('Tab'); // (past the line's own mark, which is a button)
  ok('Mark pressed from the keyboard marks the chosen line and gives it the focus back, and the line reads to a screen reader as its own words', marked[0] === 1 && marked[1] === 'line 3' && !!marked[2] && !/^Mark at/.test(marked[2]) && (await focusNow()) === 'line 4', JSON.stringify([marked, await focusNow()]));
  const under = await page.evaluate(() => { const bar = document.querySelector('.sc-bar').getBoundingClientRect(); return [...document.querySelectorAll('.sc-para')].slice(0, 12).filter(p => { p.focus(); const r = p.getBoundingClientRect(); return r.bottom > bar.top + 1 && r.top < bar.bottom; }).length; });
  ok('a line reached by the keyboard is scrolled clear of the Mark bar', under === 0, String(under));

  // ---- the Link sheet: closed with a code showing, it can be started again; unlinked, it says so ----
  await openLog(page, 'L1');
  const linkBtn = p => p.locator('.page-head').getByRole('button', { name: /^🔗/ });
  await linkBtn(page).click(); await sleep(300);
  await page.getByRole('button', { name: 'Show a code' }).click(); await page.waitForSelector('.sheet .link-text', { timeout: 15000 });
  await closeSheet(page);
  await linkBtn(page).click(); await sleep(300);
  const again = await page.locator('.sheet').innerText();
  ok('a Link sheet closed while its code was showing can start again when it is reopened', (await page.locator('.sheet').getByRole('button', { name: 'Show a code' }).count()) === 1 && (await page.locator('.sheet').getByRole('button', { name: 'Scan a code' }).count()) === 1 && /was not finished/.test(again) && !/Code shown/.test(again), again.replace(/\s+/g, ' ').slice(-200));
  const B = await open(browser);
  await B.page.evaluate(() => window.logiGo('tcnotes')); await sleep(400);
  await page.getByRole('button', { name: 'Show a code' }).click(); await page.waitForSelector('.sheet .link-text', { timeout: 15000 });
  const offer = await page.locator('.sheet .link-text').innerText();
  await linkBtn(B.page).click(); await sleep(300);
  await B.page.getByRole('button', { name: 'Scan a code' }).click(); await sleep(400);
  await B.page.locator('.sheet textarea').fill(offer); await B.page.getByRole('button', { name: 'Use pasted code' }).click();
  await B.page.waitForSelector('.sheet .link-text', { timeout: 15000 });
  const answer = await B.page.locator('.sheet .link-text').innerText();
  await page.getByRole('button', { name: 'Next: scan the reply' }).click(); await sleep(400);
  await page.locator('.sheet textarea').fill(answer); await page.getByRole('button', { name: 'Use pasted code' }).click();
  const linked = await page.waitForFunction(() => import('./js/link.js').then(l => l.link.status === 'connected' && !!l.link.peer), null, { timeout: 20000 }).then(() => true, () => false);
  await sleep(600);
  ok('two devices link by swapping codes', linked && /Linked to/.test(await page.locator('.sheet').innerText()));
  await page.locator('.sheet').getByRole('button', { name: 'Unlink' }).click(); await sleep(900);
  const aSheet = await page.locator('.sheet').innerText(), bSheet = await B.page.locator('.sheet').innerText();
  ok('Unlink shows in the sheet at once: no longer “Linked to”, and the two buttons to link again', !/Linked to/.test(aSheet) && /Show a code/.test(aSheet), aSheet.replace(/\s+/g, ' ').slice(-160));
  ok('…and the other device’s sheet says the connection closed, without the used step and code', /Connection closed/.test(bSheet) && !/Now scan this reply/.test(bSheet) && (await B.page.locator('.sheet .link-text').count()) === 0 && /Show a code/.test(bSheet), bSheet.replace(/\s+/g, ' ').slice(0, 200));
  await B.ctx.close(); await A.ctx.close(); await browser.close();

  /* -------------------------------- Field tools -------------------------------- */
  // A browser with a stand-in camera and microphone. Every stream the page is given is kept, and the answer can be
  // held back as a permission question holds it.
  const SPY = `(() => { const md = navigator.mediaDevices; if (!md) return; const real = md.getUserMedia.bind(md); window.__streams = []; window.__delay = 0;
    md.getUserMedia = async c => { const d = window.__delay; if (d) await new Promise(r => setTimeout(r, d)); const s = await real(c); window.__streams.push(s); return s; };
    window.__live = () => window.__streams.map(s => s.getTracks().map(t => t.kind + ':' + t.readyState).join(',')); try { localStorage.setItem('logi-loc', JSON.stringify({ lat: 51.5074, lon: -0.1278 })); } catch (e) {} })();`;
  const media = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const F = await open(media, { init: SPY, permissions: ['camera', 'microphone'], clock: true }), fp = F.page;
  await fp.evaluate(() => window.logiGo('field')); await sleep(400);
  const tool = async name => { await fp.locator(`.seg.tools button[data-t="${name}"]`).click(); await sleep(400); };
  const turn = (alpha, absolute = true) => fp.evaluate(([alpha, absolute]) => { for (const type of absolute ? ['deviceorientationabsolute', 'deviceorientation'] : ['deviceorientation']) window.dispatchEvent(new DeviceOrientationEvent(type, { alpha, beta: 90, gamma: 0, absolute })); }, [alpha, absolute]);
  const finder = () => fp.locator('.finder').innerText().then(x => x.replace(/\s+/g, ' '));
  const aimBtn = fp.locator('.tool-body .card-row button.primary');

  // ---- Sun: aiming goes on until Stop aiming; a device without a compass is told so ----
  await tool('sun');
  await aimBtn.click(); await sleep(200); await turn(100); await sleep(100);
  const aiming = await finder();
  await fp.clock.fastForward(61000); await sleep(300);
  const later = [await aimBtn.innerText(), await finder()];
  await turn(200); await sleep(100);
  ok('Aim with phone is still aiming a minute later, and follows the phone', /Heading 260° true/.test(aiming) && later[0] === 'Stop aiming' && /Heading 260° true/.test(later[1]) && /Heading 160° true/.test(await finder()), JSON.stringify([aiming, later, await finder()]));
  await aimBtn.click(); await sleep(150); await aimBtn.click(); await sleep(200); // stop, and start again on a device with no compass
  await turn(10, false); await sleep(100); await turn(100, false); await sleep(100);
  const noHeading = await finder();
  await fp.clock.fastForward(2100); await sleep(200);
  ok('a motion reading that is no compass reading is not shown as a heading, and after two seconds the person is told', !/Heading/.test(noHeading) && /No compass sensor found|Motion access was refused/.test(await finder()), JSON.stringify([noHeading, await finder()]));
  await aimBtn.click(); await sleep(150);
  await fp.locator('.tool-body input[type=date]').fill('2026-12-08'); await fp.locator('.tool-body input[type=date]').dispatchEvent('change'); await sleep(300);
  const day = (await fp.locator('.tool-body .times').innerText()).match(/Day length [^\n]+/);
  ok('the day length never reads “60m” (London, 8 December 2026 is 8h 00m)', !!day && day[0] === 'Day length 8h 00m', String(day && day[0]));

  // ---- the camera and the microphone are let go when a tool is left ----
  const live = () => fp.evaluate(() => window.__live());
  const leftEarly = {};
  for (const [name, start] of [['wb', 'Start camera'], ['noise', 'Start metering'], ['range', 'Start']]) {
    await fp.evaluate(() => { window.__streams.length = 0; window.__delay = 700; });
    await tool(name); await fp.getByRole('button', { name: start, exact: true }).click(); await sleep(100);
    await tool('sun'); await sleep(1300);
    leftEarly[name] = await live();
  }
  ok('a camera or microphone allowed after its tool was left is switched off (white balance, noise, range)', Object.values(leftEarly).every(s => s.length === 1 && /ended$/.test(s[0]) && !/live/.test(s[0])), JSON.stringify(leftEarly));
  await fp.evaluate(() => { window.__streams.length = 0; window.__delay = 300; });
  await tool('wb'); await fp.evaluate(() => { const b = [...document.querySelectorAll('.tool-body button')].find(x => x.textContent === 'Start camera'); b.click(); b.click(); }); await sleep(1200);
  const twice = await live(); await tool('sun'); await sleep(300);
  ok('a second tap on Start camera starts no second camera, and leaving the tool switches the one off', twice.length === 1 && twice[0] === 'video:live' && (await live())[0] === 'video:ended', JSON.stringify([twice, await live()]));
  await fp.evaluate(() => { window.__streams.length = 0; window.__delay = 0; });
  await tool('range'); await fp.getByRole('button', { name: 'Feet' }).click(); await sleep(300);
  await fp.getByRole('button', { name: 'Start', exact: true }).click(); await sleep(900);
  const ranging = await live(); await tool('sun'); await sleep(300);
  ok('the range finder’s camera is switched off on leaving also after a switch to feet', ranging.length === 1 && ranging[0] === 'video:live' && (await live())[0] === 'video:ended', JSON.stringify([ranging, await live()]));
  await F.ctx.close(); await media.close();

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

// The teleprompter (js/prompter.js) on a TC Notes log: the Prompter view, the full-screen prompter and its keys, the
// speed in words a minute, takes rolled and cut from it in free run and in record run (which runs the log's clock),
// ratings, pickups, ⚑ marks, lines edited on set (their marks stay on them), the settings kept on the device, the
// licence (free in the trial, then with a licence), the quick start on the logs page, its tutorial, and a wide screen.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
(async () => {
  const browser = await chromium.launch();
  const boot = async (viewport, prefs) => {
    const ctx = await browser.newContext({ viewport });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    if (prefs) await ctx.addInitScript(p => { localStorage.setItem('logi-prompter', p); }, JSON.stringify(prefs));
    const page = await ctx.newPage();
    page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const pos = page => page.evaluate(() => -Number((/translate3d\(0px, (-?[\d.]+)px/.exec(document.querySelector('.pr-track').style.transform) || [0, 0])[1]));
  const now = page => page.evaluate(() => document.querySelector('.pr-line.now')?.textContent || '');
  const logOf = (page, pick = 'practice') => page.evaluate(p => import('./js/store.js').then(s => JSON.parse(JSON.stringify(p === 'practice' ? s.db.logs.find(l => l.practice) : s.db.logs.find(l => l.id === p)))), pick);
  const tc = () => import('./js/pages/tcnotes.js');

  /* ---------------- a phone, upright, with no countdown so the runs below are quick ---------------- */
  let { ctx, page } = await boot({ width: 420, height: 880 }, { count: 0 });
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(700);
  ok('a log has three views on a phone: Notes, Script, Prompter', JSON.stringify(await page.locator('.tc-views button').allInnerTexts()).includes('Prompter') && (await page.locator('.tc-views button').count()) === 3);
  await page.locator('.tc-views button', { hasText: 'Prompter' }).click(); await sleep(600);
  const sum = await page.locator('.pr-sum').innerText();
  ok('the Prompter view says how much is read and how long it takes (the sample: 32 words of dialogue)', /32 words to read/.test(sum) && /about 0:1\d at 140 words a minute/.test(sum), sum);
  ok('…with the settings for this screen and the speakers to choose from', (await page.locator('.pr-prefs .pref[aria-label="Mirror"]').count()) === 1 && JSON.stringify(await page.locator('.pr-prefs .pref[aria-label="Lines to read"] button').allInnerTexts()) === '["Everyone","ANA","TOM"]');
  await page.screenshot({ path: S + '/prompter-view.png' });
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter');
  ok('Open the prompter puts it over the page, the page out of reach', (await page.evaluate(() => document.getElementById('app').inert)) && (await page.locator('.prompter[role=dialog]').count()) === 1);
  ok('it opens on the first line, at the reading line', /INT\. HARBOUR/.test(await now(page)) && (await pos(page)) > 0);
  ok('the stage reads the script as a screenplay: names, directions dimmed, dialogue read', (await page.locator('.pr-line.r-cue').count()) === 3 && (await page.locator('.pr-line.r-say').count()) === 3 && (await page.locator('.pr-line.r-dir').count()) >= 4);
  await page.keyboard.press('PageDown'); await sleep(100);
  ok('Page Down (a clicker’s next) goes to the next line read aloud, past the names and directions', /^Every batch starts before sunrise/.test(await now(page)), await now(page));
  await page.keyboard.press('PageDown'); await sleep(100); await page.keyboard.press('PageUp'); await sleep(100);
  ok('Page Up goes back a line read aloud', /^Every batch/.test(await now(page)), await now(page));

  // The speed is words a minute: twice the speed scrolls about twice as far in the same time.
  const runFor = async ms => { await page.keyboard.press('Home'); await sleep(80); const a = await pos(page); await page.keyboard.press('Space'); await sleep(ms); await page.keyboard.press('Space'); await sleep(80); return (await pos(page)) - a; };
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  ok('↑ slows down by 5 words a minute a press', (await page.locator('.pr-wpm').innerText()) === '100 wpm', await page.locator('.pr-wpm').innerText());
  const slow = await runFor(1500);
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  const fast = await runFor(1500);
  ok('twice the words a minute scrolls about twice as far', slow > 5 && fast / slow > 1.6 && fast / slow < 2.5, `${slow.toFixed(1)} px at 100, ${fast.toFixed(1)} px at 200`);
  ok('Space pauses again', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'paused');
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp'); // back to 140

  // A take from the top in free run: a note, timed by the wall clock, and a rating after Cut.
  await page.keyboard.press('Home'); await sleep(100);
  await page.keyboard.press('r'); await sleep(1300);
  ok('R rolls: the take is logged and the script runs', (await page.locator('.pr-roll').innerText()) === '■ Cut' && (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'running');
  await page.keyboard.press('r'); await sleep(300);
  ok('R again cuts and asks how the take went', await page.locator('.pr-ratebox').isVisible());
  await page.screenshot({ path: S + '/prompter-rate.png' });
  await page.keyboard.press('g'); await sleep(200);
  let L = await logOf(page);
  let t1 = L.notes.find(n => n.kind === 'roll' && n.take === 1);
  ok('the take is a note on the log: Take 1 from the top, its timecode, its length and ★ Good', t1 && t1.text === '▶ Take 1' && !t1.para && Number.isFinite(t1.frames) && /^0:0[1-2]$/.test(t1.dur) && t1.rate === 'good', JSON.stringify(t1));
  ok('a take rolled at the top starts on the first line read aloud', /^Every batch/.test(await now(page)), await now(page));

  // A pickup: hold a line, Start from here, roll; ⚑ marks the line being read.
  await page.keyboard.press('Home'); await sleep(150);
  const line = page.locator('.pr-line', { hasText: 'That colour is six weeks' }); const lb = await line.boundingBox();
  await page.mouse.move(lb.x + 30, lb.y + 8); await page.mouse.down(); await sleep(750); await page.mouse.up(); await sleep(300);
  ok('holding a line offers it: start from here, mark it, edit it', (await page.locator('.sheet[aria-label="This line"]').count()) === 1 && (await page.locator('.sheet[aria-label="This line"] button').allInnerTexts()).join('|').includes('Start from here'));
  await page.locator('.sheet button', { hasText: 'Start from here' }).click(); await sleep(250);
  ok('Start from here brings that line to the reading line', /^That colour/.test(await now(page)), await now(page));
  await page.keyboard.press('r'); await sleep(700); await page.keyboard.press('f'); await sleep(300); await page.keyboard.press('r'); await sleep(250); await page.keyboard.press('n'); await sleep(200);
  L = await logOf(page);
  const t2 = L.notes.find(n => n.kind === 'roll' && n.take === 2), flagged = L.notes.find(n => /^⚑/.test(n.text));
  ok('a take started lower down is a pickup from that line', t2 && t2.text === '▶ Take 2 (pickup)' && t2.quote === 'That colour is six weeks of waiting.' && !!t2.para && t2.rate === 'ng', JSON.stringify(t2));
  ok('F marks the line being read, pinned to it, with the take', flagged && flagged.text === '⚑ Take 2' && flagged.para === t2.para, JSON.stringify(flagged));

  // A line edited on set keeps its marks: a mark on words follows them, a whole-line mark takes the new words.
  const every = L.script.paras.find(p => /^Every batch/.test(p.text));
  await page.evaluate(({ id }) => import('./js/store.js').then(s => s.update(d => { const l = d.logs.find(x => x.practice); const t = l.script.paras.find(p => p.id === id).text, at = t.indexOf('before sunrise'); l.notes.push({ id: 'n-words', frames: 1000, text: 'words', at: new Date().toISOString(), para: id, start: at, end: at + 14, quote: 'before sunrise' }, { id: 'n-line', frames: 1001, text: 'line', at: new Date().toISOString(), para: id, quote: t }); })), { id: every.id });
  await page.keyboard.press('Home'); await page.keyboard.press('PageDown'); await sleep(150);
  const eb = await page.locator('.pr-line', { hasText: 'Every batch starts' }).boundingBox();
  await page.mouse.move(eb.x + 30, eb.y + 8); await page.mouse.down(); await sleep(750); await page.mouse.up(); await sleep(300);
  await page.locator('.sheet button', { hasText: 'Edit line' }).click(); await page.waitForSelector('.sheet[aria-label="Edit line"]');
  ok('Edit line says the marks stay on it', /2 marks on this line stay on it/.test(await page.locator('.sheet[aria-label="Edit line"]').innerText()));
  await page.locator('.sheet[aria-label="Edit line"] textarea').fill("Every single batch starts before sunrise. If you're not here at five, you've missed the best part.");
  await page.locator('.sheet[aria-label="Edit line"] .btn.primary').click(); await sleep(400);
  L = await logOf(page);
  const p2 = L.script.paras.find(p => p.id === every.id), nw = L.notes.find(n => n.id === 'n-words'), nl = L.notes.find(n => n.id === 'n-line');
  ok('the line has its new words, on the stage too', /^Every single batch/.test(p2.text) && (await page.locator('.pr-line', { hasText: 'Every single batch' }).count()) === 1);
  ok('…a mark on words follows them, a mark on the line takes its new words, and the script is marked as changed', nw.para === every.id && p2.text.slice(nw.start, nw.end) === 'before sunrise' && nl.para === every.id && /^Every single batch/.test(nl.quote) && !!L.script.rev, JSON.stringify({ nw, q: nl.quote }));

  // Settings for the screen: mirrored for a rig, kept on this device; bigger text.
  await page.locator('.pr-settings').click(); await page.waitForSelector('.sheet[aria-label="Prompter settings"]');
  await page.locator('.sheet .pref[aria-label="Mirror"] button', { hasText: 'Mirrored' }).click(); await sleep(150);
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pr-stage')).getPropertyValue('--pr-fs')));
  await page.locator('.sheet .pr-set-size button[aria-label="Bigger text"]').click(); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(200);
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pr-stage')).getPropertyValue('--pr-fs')));
  ok('Escape closes the settings, not the prompter', (await page.locator('.sheet').count()) === 0 && (await page.locator('.prompter').count()) === 1);
  ok('mirrored turns the stage and not the buttons, and is kept on this device', (await page.evaluate(() => document.querySelector('.pr-stage').classList.contains('mirror') && getComputedStyle(document.querySelector('.pr-bottom')).transform === 'none')) && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-prompter'))).mirror === true);
  ok('bigger text is bigger', fs1 > fs0, `${fs0} → ${fs1}`);
  await page.locator('.pr-settings').click(); await page.waitForSelector('.sheet[aria-label="Prompter settings"]');
  await page.locator('.sheet .pref[aria-label="Line spacing"] button', { hasText: 'Loose' }).click(); await sleep(150); await page.keyboard.press('Escape'); await sleep(200);
  ok('loose line spacing spreads the lines', (await page.evaluate(() => document.querySelector('.pr-col').style.lineHeight)) === '1.6');
  await page.screenshot({ path: S + '/prompter-mirrored.png' });

  // Its own walkthrough, over it.
  await page.locator('.pr-help').click(); await page.waitForSelector('.tour-card h2');
  let spots = 0, cards = 0;
  for (let i = 0; i < 16; i++) { if (!(await page.locator('.tour-card h2').count())) break; cards++; if (!(await page.locator('.tour-spot').evaluate(el => el.classList.contains('center')))) spots++; const label = await page.locator('.tour-card .btn.primary').innerText(); await page.locator('.tour-card .btn.primary').click(); await sleep(420); if (label === 'Done') break; }
  ok(`the prompter’s ? walks through it: ${cards} steps, ${spots} highlighted, and it is still open after`, cards >= 10 && spots >= 9 && (await page.locator('.tour').count()) === 0 && (await page.locator('.prompter').count()) === 1);

  // A take left rolling in free run ends with the prompter.
  await page.keyboard.press('r'); await sleep(400); await page.keyboard.press('Escape'); await sleep(300);
  L = await logOf(page);
  ok('Escape closes the prompter and gives the page back', (await page.locator('.prompter').count()) === 0 && !(await page.evaluate(() => document.getElementById('app').inert)));
  ok('…and a free-run take still rolling ends with it, timed', !L.open && /^\d+:\d\d$/.test(L.notes.find(n => n.kind === 'roll' && n.take === 3)?.dur || ''));
  await page.locator('.tc-views button', { hasText: 'Notes' }).click(); await sleep(300);
  ok('the notes list shows each take’s rating, and a tap changes it', JSON.stringify(await page.locator('.tc-rate').allInnerTexts()).includes('★ Good') && JSON.stringify(await page.locator('.tc-rate').allInnerTexts()).includes('✕ No good'));
  const exported = await page.evaluate(() => import('./js/store.js').then(s => s.db.logs.find(l => l.practice)).then(l => l.notes.filter(n => n.rate).map(n => n.text + ' [' + n.dur + ']' + (n.rate === 'good' ? ' ★ Good' : ' ✕ No good'))));
  await page.locator('.tc-log-head .actions button', { hasText: 'Export' }).click(); await page.waitForSelector('.sheet .export-preview');
  const preview = await page.locator('.sheet .export-preview').innerText();
  ok('the export carries the ratings', exported.every(t => preview.includes(t.replace(/^▶ /, ''))) && /★ Good/.test(preview) && /✕ No good/.test(preview), preview.split('\n').filter(x => /Take/.test(x)).join(' / '));
  await page.keyboard.press('Escape'); await sleep(200);

  // The script's bar: Prompt from here opens the prompter on that line.
  await page.locator('.tc-views button', { hasText: 'Script' }).click(); await sleep(300);
  await page.locator('.sc-para', { hasText: 'Interview' }).click(); await sleep(150);
  await page.locator('.sc-prompt').click(); await page.waitForSelector('.prompter'); await sleep(200);
  ok('Prompt from here, in the script, opens the prompter on that line', /^Interview/.test(await now(page)), await now(page));
  await page.keyboard.press('Escape'); await sleep(200);

  // The licence: free in the trial; after it, without a licence, the prompter offers one instead of opening.
  await page.locator('.tc-views button', { hasText: 'Prompter' }).click(); await sleep(300);
  await page.evaluate(() => import('./js/store.js').then(s => { window.__asked = []; s.setPaid(false, what => window.__asked.push(what), { links: false }); }));
  await page.locator('.pr-open').click(); await sleep(300);
  ok('after the trial with no licence, the prompter offers a licence instead of opening', (await page.locator('.prompter').count()) === 0 && JSON.stringify(await page.evaluate(() => window.__asked)) === '["prompter"]');
  await page.evaluate(() => import('./js/store.js').then(s => s.setPaid(false, what => window.__asked.push(what), { links: true })));
  await page.locator('.pr-open').click(); await sleep(300);
  ok('in the free trial it opens', (await page.locator('.prompter').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.setPaid(true, null, { links: true })));

  // Record run with a sync: Roll and Cut in the prompter run the log's clock.
  const rid = await page.evaluate(async () => { const s = await import('./js/store.js'), d = await import('./js/docx.js'); const id = 'log-rec'; s.upsert('logs', { id, title: 'B cam, record run', created: '2026-11-25', rate: '25', mode: 'record', notes: [], take: 0, autoTakes: true, sync: { frames: 90000, ms: Date.now() - 5000, how: 'typed', rolling: false, dev: 'x' }, script: d.buildScript('Two hander', d.textToLines('PRESENTER: Welcome to the brewery.\n[Walk to the tanks]\nGUEST: Thanks for having me.\nPRESENTER: Let us start at five in the morning.')), scriptAt: Date.now() }); return id; });
  await page.evaluate(id => import('./js/pages/tcnotes.js').then(m => m.openLog(id, 'prompter')), rid); await sleep(500);
  ok('a plain script with “NAME:” lines has its speakers to choose from', JSON.stringify(await page.locator('.pr-prefs .pref[aria-label="Lines to read"] button').allInnerTexts()) === '["Everyone","PRESENTER","GUEST"]');
  await page.locator('.pr-prefs .pref[aria-label="Lines to read"] button', { hasText: 'PRESENTER' }).click(); await sleep(300);
  ok('choosing a speaker counts only their words, and is kept on the log', /12 words to read/.test(await page.locator('.pr-sum').innerText()) && (await logOf(page, rid)).prompt.focus === 'PRESENTER', await page.locator('.pr-sum').innerText());
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter'); await sleep(200);
  ok('…on the stage the other speaker’s lines are dimmed cues, the bracketed line a direction', (await page.locator('.pr-line.r-other').count()) === 1 && (await page.locator('.pr-line.r-dir').count()) === 1 && (await page.locator('.pr-line .pr-who').count()) >= 2);
  await page.keyboard.press('r'); await sleep(1200);
  let R = await logOf(page, rid);
  ok('Roll in record run starts the log’s clock and logs the take at the held timecode', R.sync.rolling === true && R.take === 1 && R.notes[0] && R.notes[0].frames === 90000);
  await page.keyboard.press('r'); await sleep(250);
  R = await logOf(page, rid);
  ok('Cut holds the clock again and gives the take its length', R.sync.rolling === false && R.sync.frames > 90000 && /^0:0[1-2]$/.test(R.notes[0].dur || ''), JSON.stringify({ sync: R.sync, n: R.notes[0] }));
  await page.keyboard.press('Escape'); await sleep(200);

  // The quick start on the logs page.
  await page.locator('.tc-log-head .btn.ghost.small').first().click(); await sleep(300);
  await page.locator('.tc-quick').click(); await page.waitForSelector('.sheet[aria-label="Teleprompter"]');
  ok('📜 Prompter on the logs page lists the scripts already in logs', (await page.locator('.sheet .card.tap').count()) === 2);
  await page.locator('.sheet .card.tap', { hasText: 'Two hander' }).click(); await sleep(500);
  ok('…and one opens on its log’s prompter view', (await page.locator('.tc-views button.on').innerText()) === 'Prompter' && /B cam/.test(await page.locator('.tc-head h2').innerText()));
  await page.locator('.tc-log-head .btn.ghost.small').first().click(); await sleep(300);
  await page.locator('.tc-quick').click(); await page.waitForSelector('.sheet[aria-label="Teleprompter"]');
  await page.locator('.sheet button', { hasText: 'A new script' }).click(); await page.waitForSelector('.sheet[aria-label="Add script"]');
  ok('A new script… offers the scripts used before, a file, Google Docs and the sample', (await page.locator('.sheet .imp-recent button').count()) === 2 && (await page.locator('.sheet .imp-word').count()) === 1 && (await page.locator('.sheet .imp-gdocs').count()) === 1);
  await page.locator('.sheet .tc-sample').click(); await page.locator('.sheet .btn.primary', { hasText: 'Use this script' }).click(); await sleep(500);
  const made = await page.evaluate(() => import('./js/store.js').then(s => s.db.logs.filter(l => l.title === 'Sample script').map(l => ({ mode: l.mode, sync: l.sync, paras: l.script && l.script.paras.length }))));
  ok('…and a new one gets a log of its own, opened on its prompter', made.length === 1 && made[0].mode === 'free' && made[0].sync === null && made[0].paras === 13 && (await page.locator('.tc-views button.on').innerText()) === 'Prompter', JSON.stringify(made));
  ok('no errors on the phone', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  /* ---------------- a countdown, landscape ---------------- */
  ({ ctx, page } = await boot({ width: 844, height: 390 }, { count: 3 }));
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(600);
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.showView('prompter'))); await sleep(500);
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter');
  await page.locator('.pr-play').click(); await sleep(300);
  ok('from the top, Play counts down first', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'count' && (await page.locator('.pr-count').innerText()) === '3' && (await page.locator('.pr-play').innerText()) === '❚❚ Pause');
  await page.screenshot({ path: S + '/prompter-countdown.png' });
  await sleep(3300);
  ok('…then runs', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'running');
  await sleep(2800);
  ok('while it runs the buttons step out of the way', await page.evaluate(() => document.querySelector('.prompter').classList.contains('hud-off')));
  await page.screenshot({ path: S + '/prompter-running.png' });
  ok('no errors in landscape', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  /* ---------------- a wide screen ---------------- */
  ({ ctx, page } = await boot({ width: 1280, height: 800 }));
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(600);
  ok('a wide screen keeps notes and script side by side, with the prompter beside them', JSON.stringify(await page.locator('.tc-modes button').allInnerTexts()) === '["Notes & script","Prompter"]' && (await page.locator('.tc-split').count()) === 1);
  await page.locator('.tc-modes button', { hasText: 'Prompter' }).click(); await sleep(400);
  ok('…and its Prompter view', (await page.locator('.pr-open').count()) === 1 && (await page.locator('.tc-split').count()) === 0);
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter'); await sleep(300);
  await page.screenshot({ path: S + '/prompter-wide.png' });
  ok('no errors on a wide screen', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  await browser.close();
})().catch(e => { console.log('FAIL the prompter spec crashed — ' + (e && e.stack || e)); process.exit(1); });

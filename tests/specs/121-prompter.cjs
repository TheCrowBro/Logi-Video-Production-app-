// The teleprompter (js/prompter.js) on a TC Notes log: the Prompter view, the full-screen prompter and its keys, the
// speed in words a minute, takes rolled and cut from it in free run and in record run (which runs the log's clock),
// ratings, pickups, ⚑ marks, lines edited on set (their marks stay on them), the settings kept on the device, the
// licence (free in the trial, then with a licence), the quick start on the logs page, its tutorial, and a wide screen.
// Its settings sit under three icons with twirl-downs; the reading line drags and has its own menu; a mouse wheel or a
// trackpad scrolls it (unless switched off); ← → change the speed; the pointer and the buttons keep out of sight while
// it runs, with the speed in a corner for a finger.
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
  // A setting is under one of three icons, in one of its twirl-downs: choose the icon, open the twirl-down.
  const settings = async (page, scope, tab, twirl) => {
    await page.locator(`${scope} .pr-tab[data-tab="${tab}"]`).click(); await sleep(120);
    if (twirl && !(await page.locator(`${scope} [data-twirl="${twirl}"]`).evaluate(d => d.open))) { await page.locator(`${scope} [data-twirl="${twirl}"] > summary`).click(); await sleep(150); }
  };

  /* ---------------- a phone, upright, with no countdown so the runs below are quick ---------------- */
  let { ctx, page } = await boot({ width: 420, height: 880 }, { count: 0 });
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(700);
  ok('a log has three views on a phone: Notes, Script, Prompter', JSON.stringify(await page.locator('.tc-views button').allInnerTexts()).includes('Prompter') && (await page.locator('.tc-views button').count()) === 3);
  await page.locator('.tc-views button', { hasText: 'Prompter' }).click(); await sleep(600);
  const sum = await page.locator('.pr-sum').innerText();
  ok('the Prompter view says how much is read and how long it takes (the sample: 32 words of dialogue)', /32 words to read/.test(sum) && /about 0:1\d at 140 words a minute/.test(sum), sum);
  ok('…with the settings for this screen under three icons, Script, Format and Other: Format the first time', JSON.stringify(await page.locator('.pr-setup .pr-tab').allInnerTexts()) === '["Script","Format","Other"]' && (await page.locator('.pr-setup .pr-tab.on').innerText()) === 'Format' && JSON.stringify(await page.locator('.pr-setup .pr-twirl .twirl-name').allInnerTexts()) === '["Text","Reading line","Rig"]');
  ok('…each twirl-down saying what it is set to, the first one open', JSON.stringify(await page.locator('.pr-setup .pr-twirl .twirl-sub').allInnerTexts()) === '["about 25 letters a line · normal spacing · medium column","a third down · highlight bar · arrow · yellow","not mirrored · upright"]' && JSON.stringify(await page.locator('.pr-setup .pr-twirl').evaluateAll(ds => ds.map(d => d.open))) === '[true,false,false]', JSON.stringify(await page.locator('.pr-setup .pr-twirl .twirl-sub').allInnerTexts()));
  await settings(page, '.pr-setup', 'script', 'show');
  ok('…Script: how it shows (with the speakers to choose from), Import or replace, Jump to a scene, Find a line', JSON.stringify(await page.locator('.pr-setup .pr-twirl .twirl-name').allInnerTexts()) === '["How it shows","Import or replace","Jump to a scene","Find a line"]' && JSON.stringify(await page.locator('.pr-setup .pref[aria-label="Lines to read"] button').allInnerTexts()) === '["Everyone","ANA","TOM"]');
  await settings(page, '.pr-setup', 'other');
  ok('…Other: the countdown, the speed, scrolling and the keys', JSON.stringify(await page.locator('.pr-setup .pr-twirl .twirl-name').allInnerTexts()) === '["Countdown","Speed","Scrolling","Keys and clickers"]' && /← → and ↑ ↓ change the speed/.test(await page.locator('.pr-setup .pr-keys-help').textContent()));
  await settings(page, '.pr-setup', 'script');
  await page.screenshot({ path: S + '/prompter-view.png' });
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter');
  ok('Open the prompter puts it over the page, the page out of reach', (await page.evaluate(() => document.getElementById('app').inert)) && (await page.locator('.prompter[role=dialog]').count()) === 1);
  ok('it opens on the first line, at the reading line', /INT\. HARBOUR/.test(await now(page)) && (await pos(page)) > 0);
  ok('its controls slide out as it opens, on the icon used last (Script)', (await page.locator('.prompter .pr-panel.open').count()) === 1 && (await page.locator('.pr-panel .pr-tab.on').innerText()) === 'Script' && (await page.locator('.pr-settings').getAttribute('aria-expanded')) === 'true');
  // On an upright phone the script is lifted above the drawer, and a change to the reading line shows there too.
  await sleep(400);
  const lifted = () => page.evaluate(() => { const r = document.querySelector('.pr-marker').getBoundingClientRect(), t = document.querySelector('.pr-top').getBoundingClientRect(), p = document.querySelector('.pr-panel').getBoundingClientRect(); return { line: Math.round(r.top), end: Math.round(r.bottom), bar: Math.round(t.bottom), drawer: Math.round(p.top) }; });
  const l1 = await lifted();
  ok('on an upright phone the script is lifted above the drawer, the reading line in sight', l1.line >= l1.bar && l1.end <= l1.drawer, JSON.stringify(l1));
  await settings(page, '.pr-panel', 'format', 'line');
  await page.locator('.pr-panel .pref[aria-label="Where it sits"] button', { hasText: 'The middle' }).click(); await sleep(400);
  const l2 = await lifted();
  ok('…and moving the reading line shows there too', l2.line > l1.line + 10 && l2.end <= l2.drawer, JSON.stringify(l2));
  await page.locator('.pr-panel .pref[aria-label="Where it sits"] button', { hasText: 'A third down' }).click(); await sleep(300);
  ok('the stage reads the script as a screenplay: names, directions dimmed, dialogue read', (await page.locator('.pr-line.r-cue').count()) === 3 && (await page.locator('.pr-line.r-say').count()) === 3 && (await page.locator('.pr-line.r-dir').count()) >= 4);
  await page.keyboard.press('PageDown'); await sleep(100);
  ok('Page Down (a clicker’s next) goes to the next line read aloud, past the names and directions', /^Every batch starts before sunrise/.test(await now(page)), await now(page));
  await page.keyboard.press('PageDown'); await sleep(100); await page.keyboard.press('PageUp'); await sleep(100);
  ok('Page Up goes back a line read aloud', /^Every batch/.test(await now(page)), await now(page));

  // The speed is words a minute: twice the speed scrolls about twice as far in the same time.
  const runFor = async ms => { await page.keyboard.press('Home'); await sleep(80); const a = await pos(page); await page.keyboard.press('Space'); await sleep(ms); await page.keyboard.press('Space'); await sleep(80); return (await pos(page)) - a; };
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  ok('↑ slows down by 5 words a minute a press', (await page.locator('.pr-wpm').innerText()) === '100 wpm', await page.locator('.pr-wpm').innerText());
  const onLine = await now(page);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(100);
  const sped = await page.locator('.pr-wpm').innerText();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await sleep(100);
  ok('← and → change the speed too, and no longer move a line (Page Up and Down do)', sped === '110 wpm' && (await page.locator('.pr-wpm').innerText()) === '100 wpm' && (await now(page)) === onLine, sped);
  const slow = await runFor(1500);
  ok('prompting puts the controls away', (await page.locator('.prompter .pr-panel.open').count()) === 0 && (await page.locator('.pr-settings').getAttribute('aria-expanded')) === 'false');
  ok('…and the script goes back down to its reading line', await page.evaluate(() => !document.querySelector('.pr-stage').style.translate));
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
  await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  ok('⚙ brings the controls back', (await page.locator('.pr-settings').getAttribute('aria-expanded')) === 'true');
  ok('…on the icon left chosen, with its twirl-downs as they were left', (await page.locator('.pr-panel .pr-tab.on').innerText()) === 'Format' && (await page.locator('.pr-panel [data-twirl="line"]').evaluate(d => d.open)));
  await settings(page, '.pr-panel', 'format', 'rig');
  await page.locator('.pr-panel .pref[aria-label="Mirror"] button', { hasText: 'Mirrored' }).click(); await sleep(150);
  const fs0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pr-stage')).getPropertyValue('--pr-fs')));
  await page.locator('.pr-panel .pr-set-size button[aria-label="Bigger text"]').click(); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(350);
  const fs1 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pr-stage')).getPropertyValue('--pr-fs')));
  ok('Escape puts the controls away, not the prompter', (await page.locator('.prompter .pr-panel.open').count()) === 0 && (await page.locator('.prompter').count()) === 1);
  ok('mirrored turns the stage and not the buttons, and is kept on this device', (await page.evaluate(() => document.querySelector('.pr-stage').classList.contains('mirror') && getComputedStyle(document.querySelector('.pr-bottom')).transform === 'none')) && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-prompter'))).mirror === true);
  ok('bigger text is bigger', fs1 > fs0, `${fs0} → ${fs1}`);
  await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await page.locator('.pr-panel .pref[aria-label="Line spacing"] button', { hasText: 'Loose' }).click(); await sleep(150); await page.keyboard.press('Escape'); await sleep(300);
  ok('loose line spacing spreads the lines', (await page.evaluate(() => document.querySelector('.pr-col').style.lineHeight)) === '1.6');
  await page.screenshot({ path: S + '/prompter-mirrored.png' });

  // Its own walkthrough, over it.
  await page.locator('.pr-help').click(); await page.waitForSelector('.tour-card h2');
  let spots = 0, cards = 0; const lit = {};
  for (let i = 0; i < 30; i++) {
    if (!(await page.locator('.tour-card h2').count())) break; cards++;
    const title = await page.locator('.tour-card h2').innerText(), centred = await page.locator('.tour-spot').evaluate(el => el.classList.contains('center'));
    if (!centred) spots++;
    lit[title] = !centred && (await page.evaluate(() => !!document.querySelector('.prompter .pr-panel.open')));
    // A step that opens or closes the controls first takes longer to come up: wait for the card to change, not a set time.
    const where = await page.locator('.tour-card .tour-step').innerText(), label = await page.locator('.tour-card .btn.primary').innerText();
    await page.locator('.tour-card .btn.primary').click(); if (label === 'Done') { await sleep(420); break; }
    await page.waitForFunction(w => document.querySelector('.tour-card .tour-step')?.innerText !== w, where, { timeout: 5000 }).catch(() => {}); await sleep(150);
  }
  ok(`the prompter’s ? walks through it: ${cards} steps, ${spots} highlighted, and it is still open after`, cards >= 15 && spots >= 14 && (await page.locator('.tour').count()) === 0 && (await page.locator('.prompter').count()) === 1);
  ok('…its steps open the controls (on the icon and twirl-down they point to) and put them away for the rest', lit['The controls'] === true && lit['Script, Format and Other'] === true && lit['Jump to a scene'] === true && lit['The countdown'] === true && lit['Scrolling'] === true && lit['The script, full screen'] === false && (await page.locator('.prompter .pr-panel.open').count()) === 0, JSON.stringify(lit));

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
  await page.locator('.pr-close').click(); await sleep(200);

  // The licence: free in the trial; after it, without a licence, the prompter offers one instead of opening.
  await page.locator('.tc-views button', { hasText: 'Prompter' }).click(); await sleep(300);
  await page.evaluate(() => import('./js/store.js').then(s => { window.__asked = []; s.setPaid(false, what => window.__asked.push(what), { links: false }); }));
  await page.locator('.pr-open').click(); await sleep(300);
  ok('after the trial with no licence, the prompter offers a licence instead of opening', (await page.locator('.prompter').count()) === 0 && JSON.stringify(await page.evaluate(() => window.__asked)) === '["prompter"]');
  await page.evaluate(() => import('./js/store.js').then(s => s.setPaid(false, what => window.__asked.push(what), { links: true })));
  await page.locator('.pr-open').click(); await sleep(300);
  ok('in the free trial it opens', (await page.locator('.prompter').count()) === 1);
  await page.locator('.pr-close').click(); await sleep(200);
  await page.evaluate(() => import('./js/store.js').then(s => s.setPaid(true, null, { links: true })));

  // Record run with a sync: Roll and Cut in the prompter run the log's clock.
  const rid = await page.evaluate(async () => { const s = await import('./js/store.js'), d = await import('./js/docx.js'); const id = 'log-rec'; s.upsert('logs', { id, title: 'B cam, record run', created: '2026-11-25', rate: '25', mode: 'record', notes: [], take: 0, autoTakes: true, sync: { frames: 90000, ms: Date.now() - 5000, how: 'typed', rolling: false, dev: 'x' }, script: d.buildScript('Two hander', d.textToLines('PRESENTER: Welcome to the brewery.\n[Walk to the tanks]\nGUEST: Thanks for having me.\nPRESENTER: Let us start at five in the morning.')), scriptAt: Date.now() }); return id; });
  await page.evaluate(id => import('./js/pages/tcnotes.js').then(m => m.openLog(id, 'prompter')), rid); await sleep(500);
  await settings(page, '.pr-setup', 'script', 'show');
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
  ok('…and the mouse pointer goes as soon as it starts', await page.evaluate(() => document.querySelector('.prompter').classList.contains('cursor-off')));
  await page.screenshot({ path: S + '/prompter-countdown.png' });
  await sleep(3300);
  ok('…then runs', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'running');
  await sleep(2800);
  ok('while it runs the buttons step out of the way', await page.evaluate(() => document.querySelector('.prompter').classList.contains('hud-off')));
  await page.screenshot({ path: S + '/prompter-running.png' });
  ok('…and the speed waits in the bottom-left corner, faint', (await page.locator('.pr-live').isVisible()) && Number(await page.locator('.pr-live-val').evaluate(el => getComputedStyle(el).opacity)) < 0.6 && (await page.locator('.pr-live-val').innerText()) === '140 wpm');
  await page.locator('.pr-live-btn[aria-label="Faster"]').click(); await sleep(250);
  ok('a tap on its + speeds it up without stopping it or bringing the buttons back', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'running' && (await page.locator('.pr-live-val').innerText()) === '145 wpm' && (await page.evaluate(() => document.querySelector('.prompter').classList.contains('hud-off'))), await page.locator('.pr-live-val').innerText());
  await page.keyboard.press('Space'); await sleep(200); await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await settings(page, '.pr-panel', 'other', 'count');
  await page.locator('.pr-panel .pr-count-switch button', { hasText: 'Off' }).click(); await sleep(150);
  ok('the countdown switches off, its lengths put away', (await page.locator('.pr-panel .pr-count-len').count()) === 0 && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-prompter'))).count === 0);
  await page.keyboard.press('Home'); await page.locator('.pr-play').click(); await sleep(300);
  ok('…and Play from the top then runs straight away', (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'running' && (await page.locator('.pr-count').isHidden()));
  await page.keyboard.press('Space'); await sleep(200); await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await page.locator('.pr-panel .pr-count-switch button', { hasText: 'On' }).click(); await sleep(150);
  ok('switched on again, it keeps its length', (await page.locator('.pr-panel .pr-count-len button.on').innerText()) === '3 s');
  await page.locator('.pr-panel .pr-count-len button', { hasText: '10 s' }).click(); await sleep(150);
  await page.keyboard.press('Home'); await page.locator('.pr-roll').click(); await sleep(300);
  ok('a 10-second countdown counts from 10, and the controls go', (await page.locator('.pr-count').innerText()) === '10' && (await page.locator('.prompter .pr-panel.open').count()) === 0);
  ok('no errors in landscape', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  /* ---------------- a wide screen, with a mouse ---------------- */
  ({ ctx, page } = await boot({ width: 1280, height: 800 }, { count: 0 }));
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(600);
  ok('a wide screen keeps notes and script side by side, with the prompter beside them', JSON.stringify(await page.locator('.tc-modes button').allInnerTexts()) === '["Notes & script","Prompter"]' && (await page.locator('.tc-split').count()) === 1);
  await page.locator('.tc-modes button', { hasText: 'Prompter' }).click(); await sleep(400);
  ok('…and its Prompter view', (await page.locator('.pr-open').count()) === 1 && (await page.locator('.tc-split').count()) === 0);
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter'); await sleep(300);
  await page.screenshot({ path: S + '/prompter-wide.png' });
  await page.keyboard.press('Escape'); await sleep(400); // the controls away

  // The reading line: its arrow (the pointer) drags over a still script, snapping to the three heights; the line beside
  // it becomes the one being read. At the very top of the script the first line goes with it, so nothing is skipped.
  const mark = () => page.evaluate(() => JSON.parse(localStorage.getItem('logi-prompter') || '{}').mark);
  const markerTop = () => page.evaluate(() => Math.round(document.querySelector('.pr-marker').getBoundingClientRect().top));
  const dragArrow = async dy => { const b = await page.locator('.pr-handle').boundingBox(); await page.mouse.move(b.x + 20, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + b.height / 2 + dy, { steps: 8 }); await page.mouse.up(); await sleep(250); };
  const lineAt = () => page.evaluate(() => { const l = [...document.querySelectorAll('.pr-line.r-say')][1]; return Math.round(l.getBoundingClientRect().top); });
  const first = { now: await now(page), top: await markerTop() };
  await dragArrow(-60);
  ok('at the very top of the script, the first line goes with the pointer, so nothing is skipped', (await now(page)) === first.now && (await markerTop()) < first.top - 40, `${first.top} → ${await markerTop()} · ${(await now(page)).slice(0, 24)}`);
  await page.keyboard.press('PageDown'); await sleep(250);
  const mid = { top: await markerTop(), y: await lineAt(), pos: await pos(page) };
  await dragArrow(170);
  const m1 = await mark(), moved = (await markerTop()) - mid.top, read = (await pos(page)) - mid.pos;
  ok('further in, dragging the guide arrow moves only the pointer: the script stays where it is, and the place read moves with the pointer', m1 > 0.4 && m1 < 0.48 && moved > 150 && Math.abs((await lineAt()) - mid.y) <= 1 && Math.abs(read - moved) <= 2, `${m1} · pointer ${moved} px, place read ${read.toFixed(1)} px, a line ${mid.y} → ${await lineAt()}`);
  await dragArrow(Math.round((0.5 - m1) * 800) - 4);
  ok('…and it snaps to the middle as it comes near', (await mark()) === 0.5, String(await mark()));
  const mb = await page.locator('.pr-marker').boundingBox();
  await page.mouse.click(mb.x + 520, mb.y + mb.height / 2, { button: 'right' }); await page.waitForSelector('.sheet[aria-label="The reading line"]');
  ok('a right-click on the reading line opens its own menu: the highlight bar, the pointer, its colour and strength, a lock and Reset', JSON.stringify(await page.locator('.sheet .pref-label').allInnerTexts()) === '["Highlight bar","Pointer","Colour","Strength","Lock it in place"]' && (await page.locator('.sheet .pr-line-reset').count()) === 1, JSON.stringify(await page.locator('.sheet .pref-label').allInnerTexts()));
  const barOn = await page.evaluate(() => getComputedStyle(document.querySelector('.pr-marker')).backgroundImage);
  await page.locator('.sheet .pref[aria-label="Highlight bar"] button', { hasText: 'Off' }).click(); await sleep(120);
  const barOff = await page.evaluate(() => ({ band: getComputedStyle(document.querySelector('.pr-marker')).backgroundImage, saved: JSON.parse(localStorage.getItem('logi-prompter')).lineBar }));
  ok('…its first switch turns the highlight bar off (and is kept on this device)', /gradient/.test(barOn) && barOff.band === 'none' && barOff.saved === false, JSON.stringify(barOff));
  await page.locator('.sheet .pref[aria-label="Pointer"] button', { hasText: 'Arrow and thin line' }).click(); await sleep(80);
  await page.locator('.sheet .pref[aria-label="Colour"] button', { hasText: 'Green' }).click(); await sleep(80);
  await page.locator('.sheet .pref[aria-label="Strength"] button', { hasText: 'Bold' }).click(); await sleep(150);
  const lk = await page.evaluate(() => { const m = document.querySelector('.pr-marker'); return { look: m.dataset.look, bar: m.dataset.bar, colour: m.dataset.colour, strength: m.dataset.strength, line: getComputedStyle(m).getPropertyValue('--pr-line').trim(), rule: getComputedStyle(m).borderTopWidth, saved: JSON.parse(localStorage.getItem('logi-prompter')) }; });
  ok('…an arrow with a thin green line, bold: on the stage at once, and kept', lk.look === 'thin' && lk.bar === 'off' && lk.colour === 'green' && lk.strength === 'bold' && lk.line === '#5fd68a' && lk.rule === '2px' && lk.saved.lineLook === 'thin' && lk.saved.lineColour === 'green' && lk.saved.lineStrength === 'bold', JSON.stringify({ ...lk, saved: undefined }));
  await page.locator('.sheet .pref[aria-label="Lock it in place"] button', { hasText: /^Locked$/ }).click(); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(300);
  const m2 = await mark();
  await dragArrow(-150);
  ok('locked, a drag leaves it where it is, and says so', (await mark()) === m2 && /locked/i.test(await page.locator('.pr-hint').innerText()), await page.locator('.pr-hint').innerText());
  await page.locator('.pr-handle').click(); await page.waitForSelector('.sheet[aria-label="The reading line"]');
  await page.locator('.sheet .pr-line-reset').click(); await sleep(150);
  const rs = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-prompter')));
  ok('a click on its arrow opens the menu too, and Reset puts it back: a third down, the highlight bar on, an arrow, yellow, normal, unlocked', rs.mark === 0.33 && rs.lineBar === true && rs.lineLook === 'arrow' && rs.lineColour === 'yellow' && rs.lineStrength === 'normal' && rs.lineLock === false, JSON.stringify(rs));
  await page.locator('.sheet .pref[aria-label="Highlight bar"] button', { hasText: 'Off' }).click(); await sleep(80);
  await page.locator('.sheet .pref[aria-label="Pointer"] button', { hasText: 'Hidden' }).click(); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(300);
  const hid = await page.evaluate(() => ({ arrow: getComputedStyle(document.querySelector('.pr-handle'), '::before').opacity, band: getComputedStyle(document.querySelector('.pr-marker')).backgroundImage }));
  ok('no bar and the pointer hidden: the talent sees no line, and a faint arrow is there to grab while it is paused', hid.arrow === '0.3' && hid.band === 'none', JSON.stringify(hid));
  await page.locator('.pr-handle').click(); await page.waitForSelector('.sheet[aria-label="The reading line"]');
  await page.locator('.sheet .pr-line-reset').click(); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(300);
  const spot = await page.evaluate(() => { const m = document.querySelector('.pr-marker').getBoundingClientRect(), bar = document.querySelector('.pr-bottom').getBoundingClientRect().top; const l = [...document.querySelectorAll('.pr-line')].find(x => { const r = x.getBoundingClientRect(); return r.height > 0 && r.top > m.bottom + 10 && r.bottom < bar - 10; }); if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
  await page.mouse.click(spot.x, spot.y, { button: 'right' }); await page.waitForSelector('.sheet[aria-label="This line"]');
  ok('a right-click on another line opens that line’s menu, as holding it does', (await page.locator('.sheet .btn', { hasText: 'Start from here' }).count()) === 1);
  await page.keyboard.press('Escape'); await sleep(250);

  // A mouse wheel or a trackpad scrolls it as a web page does: a wheel's click glides there rather than jumping.
  await page.keyboard.press('Home'); await sleep(150);
  const w0 = await pos(page);
  await page.mouse.move(640, 420); await page.mouse.wheel(0, 100); await sleep(40);
  const w1 = await pos(page); await sleep(500); const w2 = await pos(page);
  ok('a wheel’s click scrolls the script on, gliding there rather than jumping', w1 > w0 && w1 < w0 + 99 && Math.abs(w2 - (w0 + 100)) <= 1, `${w0} → ${w1} → ${w2}`);
  const w3 = await pos(page);
  await page.evaluate(() => document.querySelector('.pr-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true }))); await sleep(500);
  const row = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.pr-stage')).getPropertyValue('--pr-fs')) * parseFloat(document.querySelector('.pr-col').style.lineHeight));
  ok('…a wheel that counts in lines moves that many lines, the same in every browser', Math.abs((await pos(page)) - w3 - 3 * row) <= 2, `${((await pos(page)) - w3).toFixed(1)} for ${(3 * row).toFixed(1)}`);
  await page.keyboard.press('Home'); await sleep(100); await page.keyboard.press('Space'); await sleep(400);
  const r0 = await pos(page);
  for (let i = 0; i < 12; i++) { await page.evaluate(() => document.querySelector('.pr-stage').dispatchEvent(new WheelEvent('wheel', { deltaY: 0.5, deltaMode: 0, bubbles: true, cancelable: true }))); await sleep(50); }
  const r1 = await pos(page); await sleep(900); const r2 = await pos(page);
  await page.keyboard.press('Space'); await sleep(150);
  ok('while it runs, the scroll holds while the wheel scrolls it, then carries on from there', r1 - r0 < 10 && r2 - r1 > 10, `${(r1 - r0).toFixed(1)} px while scrolling, then ${(r2 - r1).toFixed(1)} px`);
  await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await settings(page, '.pr-panel', 'other', 'scroll');
  await page.locator('.pr-panel .pref[aria-label="Scroll with mouse or trackpad"] button', { hasText: 'Off' }).click(); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(400);
  const q0 = await pos(page);
  await page.mouse.move(640, 420); await page.mouse.wheel(0, 200); await sleep(400);
  await page.mouse.move(640, 520); await page.mouse.down(); await page.mouse.move(640, 320, { steps: 6 }); await page.mouse.up(); await sleep(250);
  ok('Scrolling off: the wheel and a mouse drag leave the script where it is, and it is kept', (await pos(page)) === q0 && JSON.parse(await page.evaluate(() => localStorage.getItem('logi-prompter'))).wheel === false && (await page.evaluate(() => document.querySelector('.prompter').dataset.state)) === 'paused', `${q0} → ${await pos(page)}`);
  await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await page.locator('.pr-panel .pref[aria-label="Scroll with mouse or trackpad"] button', { hasText: 'On' }).click(); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(400);

  // The mouse pointer while it runs: gone at once, back with a real move (not a nudge), gone again 2 seconds still.
  const cls = () => page.evaluate(() => document.querySelector('.prompter').className);
  await page.keyboard.press('Home'); await page.keyboard.press('Space'); await sleep(200);
  ok('as it starts, the mouse pointer goes at once (the buttons a little later)', /cursor-off/.test(await cls()) && !/hud-off/.test(await cls()), await cls());
  await page.mouse.move(402, 421); await sleep(30); await page.mouse.move(405, 423); await sleep(100);
  ok('…a nudge of the mouse leaves it out of sight', /cursor-off/.test(await cls()), await cls());
  await page.mouse.move(520, 470, { steps: 6 }); await sleep(100);
  ok('…a real move brings it back, with the buttons', !/cursor-off|hud-off/.test(await cls()), await cls());
  await sleep(2400);
  ok('…and after 2 seconds still, both go again', /cursor-off/.test(await cls()) && /hud-off/.test(await cls()), await cls());
  await page.keyboard.press('Space'); await sleep(150);
  ok('paused, the pointer is back', !/cursor-off/.test(await cls()), await cls());

  // Script: jump to a scene, find a line (typing there is not the prompter's keys), import or replace the script.
  await page.locator('.pr-settings').click(); await page.waitForSelector('.prompter .pr-panel.open');
  await settings(page, '.pr-panel', 'script', 'scenes');
  ok('Jump to a scene lists the top of the script and its scene headings', JSON.stringify(await page.locator('.pr-panel [data-twirl="scenes"] .pr-jump-item').allInnerTexts()) === '["↑ The top of the script","INT. HARBOUR BREWING TAPROOM — MORNING","EXT. LOADING BAY — CONTINUOUS"]', JSON.stringify(await page.locator('.pr-panel [data-twirl="scenes"] .pr-jump-item').allInnerTexts()));
  await page.locator('.pr-panel [data-twirl="scenes"] .pr-jump-item', { hasText: 'LOADING BAY' }).click(); await sleep(300);
  ok('…and one takes the prompter there', /^EXT\. LOADING BAY/.test(await now(page)), await now(page));
  await settings(page, '.pr-panel', 'script', 'find');
  await page.locator('.pr-panel .pr-find').fill('six weeks'); await sleep(150);
  ok('Find a line finds a few words, marked in the line', (await page.locator('.pr-panel .pr-found .pr-jump-item').count()) === 1 && (await page.locator('.pr-panel .pr-found mark').innerText()) === 'six weeks');
  await page.locator('.pr-panel .pr-find').press('r'); await sleep(150);
  ok('…typing there is not the prompter’s keys (R rolled no take)', (await page.locator('.pr-roll').innerText()) === '● Roll' && (await page.locator('.pr-panel .pr-find').inputValue()) === 'six weeksr');
  await page.locator('.pr-panel .pr-find').press('Backspace'); await sleep(150);
  await page.locator('.pr-panel .pr-found .pr-jump-item').click(); await sleep(300);
  ok('…and a tap goes to that line', /^That colour is six weeks/.test(await now(page)), await now(page));
  await settings(page, '.pr-panel', 'script', 'replace');
  await page.locator('.pr-panel .pr-replace').click(); await page.waitForSelector('.sheet[aria-label="Replace script"]');
  ok('Import or replace opens the Add script sheet over the prompter', (await page.locator('.prompter').count()) === 1 && (await page.locator('.sheet .imp-word').count()) === 1);
  await page.locator('.sheet textarea').fill('HOST: Welcome to the brewery.\nHOST: This is where it all begins.');
  await page.locator('.sheet button', { hasText: 'Use pasted text' }).click(); await sleep(150);
  await page.locator('.sheet .btn.primary', { hasText: 'Replace script' }).click(); await sleep(700);
  ok('…and the new script is on the stage from its top, the prompter still open', (await page.locator('.prompter').count()) === 1 && (await page.locator('.pr-line').count()) === 2 && /Welcome to the brewery/.test(await now(page)) && /2 lines/.test(await page.locator('.pr-panel [data-twirl="replace"] .twirl-sub').innerText()), await now(page));
  ok('no errors on a wide screen', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  await browser.close();
})().catch(e => { console.log('FAIL the prompter spec crashed — ' + (e && e.stack || e)); process.exit(1); });

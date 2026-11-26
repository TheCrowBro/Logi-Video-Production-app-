// Voice-follow in the teleprompter (js/prompter-voice.js, js/prompter-stage.js's follow mode): off until turned on,
// with a word about where the sound goes; while it runs, the words heard move the script to them; it listens only
// while the prompter runs; a recogniser that cannot start says why and the script carries on at its speed. The
// browser's speech recognition is replaced here by a stand-in the spec speaks through (window.__say).
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const APP = process.env.VDEX_URL || 'http://localhost:8123/';
(async () => {
  const browser = await chromium.launch();
  const boot = async (fail = '') => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-prompter', JSON.stringify({ count: 0 })); });
    await ctx.addInitScript(acceptTerms());
    // The stand-in recogniser: counts starts and stops, and hands what the spec "says" to the page, as results do.
    await ctx.addInitScript(f => {
      window.__rec = { starts: 0, stops: 0, live: null };
      window.SpeechRecognition = window.webkitSpeechRecognition = class { // newer Chromium has the unprefixed name too
        start() { window.__rec.starts++; window.__rec.live = this; if (f) setTimeout(() => { this.onerror && this.onerror({ error: f }); this.onend && this.onend(); }, 50); }
        stop() { window.__rec.stops++; window.__rec.live = null; }
        abort() { window.__rec.stops++; window.__rec.live = null; }
      };
      window.__say = text => { const r = window.__rec.live; if (!r || !r.onresult) return false; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: false })] }); return true; };
    }, fail);
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(APP); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(500);
    await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.showView('prompter'))); await sleep(400);
    await page.locator('.pr-open').click(); await page.waitForSelector('.prompter');
    return { ctx, page };
  };
  const now = page => page.evaluate(() => document.querySelector('.pr-line.now')?.textContent || '');
  const pos = page => page.evaluate(() => -Number((/translate3d\(0px, (-?[\d.]+)px/.exec(document.querySelector('.pr-track').style.transform) || [0, 0])[1]));
  const rec = page => page.evaluate(() => ({ starts: window.__rec.starts, stops: window.__rec.stops, live: !!window.__rec.live }));

  let { ctx, page } = await boot();
  ok('🎙 is on the prompter, and off', (await page.locator('.pr-voice').count()) === 1 && (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'false');
  await page.locator('.pr-voice').click(); await page.waitForSelector('.sheet[aria-label="Voice-follow"]');
  const note = await page.locator('.sheet[aria-label="Voice-follow"]').innerText();
  ok('turning it on first says where the sound goes, and asks', /Google’s speech service/.test(note) && /Apple’s/.test(note) && /records nothing and keeps nothing/.test(note) && (await rec(page)).starts === 0);
  await page.locator('.sheet button', { hasText: 'Not now' }).click(); await sleep(200);
  ok('Not now leaves it off', (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'false');
  await page.locator('.pr-voice').click(); await page.waitForSelector('.sheet[aria-label="Voice-follow"]');
  await page.locator('.sheet button', { hasText: 'Turn on voice-follow' }).click(); await sleep(300);
  ok('Turn on: 🎙 on, the speed says it follows the voice, and nothing listens yet (the prompter is not running)', (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'true' && /voice/.test(await page.locator('.pr-wpm').innerText()) && (await rec(page)).starts === 0);
  const p0 = await pos(page);
  await page.keyboard.press('Space'); await sleep(1200);
  ok('Play starts listening; with nothing said yet, the script stays where it is', (await rec(page)).live && Math.abs((await pos(page)) - p0) < 2 && /listening/.test(await page.locator('.pr-state').innerText()));
  await page.evaluate(() => window.__say('every batch starts before sunrise if you')); await sleep(1500);
  ok('words heard move the script to them', /^Every batch starts/.test(await now(page)), await now(page));
  await page.evaluate(() => window.__say('that colour is six weeks of')); await sleep(1500);
  ok('…on to the next line read aloud, past the direction between', /^That colour is six weeks/.test(await now(page)), await now(page));
  await page.evaluate(() => window.__say("interview's at 10 i've got")); await sleep(1500);
  ok('…and “10” heard matches “ten” in the script', /^Interview/.test(await now(page)), await now(page));
  await page.keyboard.press('Space'); await sleep(300);
  ok('pausing stops listening', !(await rec(page)).live && (await rec(page)).stops >= 1);
  await page.keyboard.press('v'); await sleep(200);
  ok('V turns it off again, and the speed comes back', (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'false' && /wpm/.test(await page.locator('.pr-wpm').innerText()));
  await page.keyboard.press('Home'); await page.keyboard.press('v'); await sleep(200);
  ok('…and on again without asking twice', (await page.locator('.sheet').count()) === 0 && (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape'); await sleep(300);
  ok('closing the prompter stops listening', !(await rec(page)).live);
  ok('no errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();

  // A recogniser that may not use the microphone: it says why, turns off, and the script runs at its speed.
  ({ ctx, page } = await boot('not-allowed'));
  await page.evaluate(() => localStorage.setItem('logi-voice-ok', '1'));
  await page.locator('.pr-voice').click(); await sleep(200);
  const before = await pos(page);
  await page.keyboard.press('Space'); await sleep(1500);
  ok('a microphone not allowed: it says so, voice-follow turns off, and the script carries on at its speed', /needs the microphone/.test(await page.locator('.pr-hint').innerText()) && (await page.locator('.pr-voice').getAttribute('aria-pressed')) === 'false' && (await pos(page)) > before + 5, await page.locator('.pr-hint').innerText());
  await ctx.close();
  // On a remote: its microphone listens, and the prompter in the second screen's window follows.
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await c.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); localStorage.setItem('logi-prompter', JSON.stringify({ count: 0 })); localStorage.setItem('logi-voice-ok', '1'); });
    await c.addInitScript(acceptTerms());
    await c.addInitScript(() => { window.__rec = { starts: 0, stops: 0, live: null }; window.SpeechRecognition = window.webkitSpeechRecognition = class { start() { window.__rec.starts++; window.__rec.live = this; } stop() { window.__rec.live = null; } abort() { window.__rec.live = null; } }; window.__say = text => { const r = window.__rec.live; if (!r || !r.onresult) return false; r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: false })] }); return true; }; });
    const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(APP); await p.waitForSelector('#rolodex .drum-btn');
    await p.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(500);
    await p.locator('.tc-modes button', { hasText: 'Prompter' }).click(); await sleep(300);
    const [win] = await Promise.all([p.waitForEvent('popup'), p.locator('.pr-on-window').click()]);
    await win.waitForSelector('.pr-line'); await sleep(300);
    await p.locator('.pr-remote .pr-voice').click(); await sleep(200);
    await p.locator('.pr-remote .pr-play').click(); await sleep(900);
    ok('🎙 on a remote listens here and puts the screen at the other end in voice mode', (await p.evaluate(() => !!window.__rec.live)) && /listening here/.test(await p.locator('.pr-rstatus').innerText()) && /voice/.test(await p.locator('.pr-remote .pr-wpm').innerText()));
    await p.evaluate(() => window.__say('that colour is six weeks')); await sleep(1500);
    ok('…and the words heard here move the prompter there', /^That colour/.test(await win.evaluate(() => document.querySelector('.pr-line.now')?.textContent || '')));
    await p.locator('.pr-remote .pr-close').click(); await sleep(500);
    ok('…which stops listening when the remote closes', !(await p.evaluate(() => !!window.__rec.live)) && errs.length === 0, errs.join(' | '));
    await c.close();
  }
  ok('the privacy policy says where voice-follow’s sound goes', await (async () => { const c = await browser.newContext(); const p = await c.newPage(); await p.goto(APP + 'privacy.html'); const t = await p.locator('body').innerText(); await c.close(); return /Voice-follow in the teleprompter/.test(t) && /Google's speech service/.test(t); })());
  await browser.close();
})().catch(e => { console.log('FAIL the voice-follow spec crashed — ' + (e && e.stack || e)); process.exit(1); });

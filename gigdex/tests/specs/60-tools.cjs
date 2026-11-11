// Tools: the switcher, the tuner (with Chromium's fake microphone, a beeping tone), the pitch detector on synthetic
// sine waves, the metronome's scheduler and keys, tap tempo and the delay table, the sound level meter and its noise
// limit, the set timer (pause, overtime, tonight's show and its curfew), and that leaving the page stops every sound.
const { open, ok, sleep, go } = require('../helpers.cjs');

const state = page => page.evaluate(() => (window.gdexAudioState ? window.gdexAudioState() : null));
const until = async (fn, ms = 6000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch { /* not ready */ } await sleep(step); } return false; };
const tab = async (page, id) => { await page.click(`#tl-tab-${id}`); await page.waitForSelector(`#tl-panel[data-tool="${id}"]`); await sleep(150); };
const text = (page, sel) => page.locator(sel).first().innerText();
const stored = (page, key) => page.evaluate(k => localStorage.getItem(k), key);

(async () => {
  const { browser, page, errors } = await open({ sample: true, tab: 'tools', permissions: ['microphone'] });
  await page.waitForSelector('.tl-seg');

  /* ------------------------------- the switcher ------------------------------- */
  ok('the tools page shows five tools', (await page.locator('.tl-seg [role=tab]').count()) === 5);
  for (const [id, sel] of [['tuner', '.tl-tuner'], ['metronome', '.tl-lights'], ['tempo', '#tl-tap'], ['meter', '.tl-db'], ['timer', '#tl-clock']]) {
    await tab(page, id);
    const on = await page.getAttribute(`#tl-tab-${id}`, 'aria-selected');
    ok(`${id} opens`, on === 'true' && (await page.locator(`#tl-panel ${sel}`).count()) === 1);
  }
  ok('the last tool used is remembered', (await stored(page, 'gdex-tool')) === 'timer');
  await page.focus('#tl-tab-timer');
  await page.keyboard.press('ArrowRight');
  await sleep(200);
  ok('arrow keys on the switcher move between tools, not sections', (await page.getAttribute('#tl-tab-tuner', 'aria-selected')) === 'true' && (await page.evaluate(() => window.logiPage())) === 'tools');
  await page.keyboard.press('End'); await sleep(150);
  ok('End jumps to the last tool', (await page.getAttribute('#tl-tab-timer', 'aria-selected')) === 'true');

  /* ------------------------------- pitch detection ------------------------------- */
  const pitch = await page.evaluate(async () => {
    const a = await import('./js/audio.js');
    const sine = (f, rate = 48000, n = 4096, amp = 0.5) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = amp * Math.sin(2 * Math.PI * f * i / rate + 0.4); return b; };
    const rich = (f, rate = 44100, n = 4096) => { const b = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / rate; b[i] = 0.3 * Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(4 * Math.PI * f * t + 1) + 0.2 * Math.sin(6 * Math.PI * f * t + 2); } return b; };
    const a440 = a.detectPitch(sine(440), 48000), e2 = a.detectPitch(sine(82.41), 48000), e2b = a.detectPitch(rich(82.41), 44100);
    return {
      a440, a440n: a.noteOf(a440).label, e2, e2n: a.noteOf(e2).label, e2b, e2bn: e2b && a.noteOf(e2b).label,
      lowB: a.detectPitch(sine(30.87, 44100), 44100), high: a.detectPitch(sine(1318.51), 48000),
      silence: a.detectPitch(new Float32Array(4096), 48000), quiet: a.detectPitch(sine(440, 48000, 4096, 0.001), 48000),
      at442: a.noteOf(440, 442), sharp: a.noteOf(446.4), fs: a.noteName(66), bflat: a.noteName(70),
    };
  });
  ok('a 440 Hz sine reads as A4 within 1 Hz', Math.abs(pitch.a440 - 440) < 1 && pitch.a440n === 'A4', String(pitch.a440));
  ok('an 82.41 Hz sine reads as E2', Math.abs(pitch.e2 - 82.41) < 0.5 && pitch.e2n === 'E2', String(pitch.e2));
  ok('a low E with strong overtones still reads as E2 (no octave jump)', pitch.e2bn === 'E2', String(pitch.e2b));
  ok('a five-string bass’s low B and a high E read right', Math.abs(pitch.lowB - 30.87) < 0.3 && Math.abs(pitch.high - 1318.51) < 3, `${pitch.lowB} ${pitch.high}`);
  ok('silence and a whisper read as no note', pitch.silence === null && pitch.quiet === null);
  ok('at A4 = 442, 440 Hz is A4 about 8 cents flat', pitch.at442.label === 'A4' && Math.round(pitch.at442.cents) === -8, JSON.stringify(pitch.at442));
  ok('446.4 Hz is A4 about 25 cents sharp', pitch.sharp.label === 'A4' && Math.round(pitch.sharp.cents) === 25);
  ok('note names use ♯, with the flat alias kept', pitch.fs.label === 'F♯4' && pitch.bflat.name === 'A♯' && pitch.bflat.flat === 'B♭');

  /* ------------------------------- tuner ------------------------------- */
  await tab(page, 'tuner');
  if (!(await until(async () => (await state(page)).tuner.listening, 2500))) await page.click('#tl-tuner-start');
  ok('the tuner listens once the microphone is allowed', await until(async () => { const s = await state(page); return s.tuner.listening && s.liveTracks >= 1; }));
  await sleep(1600);
  const cents = await text(page, '.tl-cents'), hz = await text(page, '.tl-hz');
  ok('the tuner shows a frequency or “Play a note”', (/^\d+\.\d Hz$/.test(hz) && /cents|In tune/.test(cents)) || (/Play a note/.test(cents) && hz === '— Hz'), `${cents} / ${hz}`);
  await page.click('#tl-a4-up');
  ok('raising A4 saves it and shows it', (await page.inputValue('#tl-a4')) === '441' && (await stored(page, 'gdex-a4')) === '441' && /A4 = 441 Hz/.test(await text(page, '.tl-a4-tag')));
  await page.fill('#tl-a4', '500'); await page.press('#tl-a4', 'Tab');
  ok('A4 stays within 415–466 Hz', (await page.inputValue('#tl-a4')) === '466' && (await stored(page, 'gdex-a4')) === '466');
  await page.click('#tl-a4-reset');
  ok('“Back to 440” resets concert pitch', (await page.inputValue('#tl-a4')) === '440' && (await stored(page, 'gdex-a4')) === '440');
  await page.click('.tl-tone .chip[data-midi="40"]');
  ok('tapping E2 plays the reference tone', await until(async () => (await state(page)).tuner.tone === 'E2') && /Stop/.test(await text(page, '#tl-tone-play')) && /82\.41 Hz/.test(await text(page, '.tl-tone-hz')));
  await page.selectOption('#tl-tone-oct', '3');
  ok('changing the octave retunes the tone', (await state(page)).tuner.tone === 'E3' && /164\.81 Hz/.test(await text(page, '.tl-tone-hz')));
  await page.click('#tl-tone-play');
  ok('Stop ends the tone', (await state(page)).tuner.tone === null && /Play/.test(await text(page, '#tl-tone-play')));
  // In the background (phone locked, another app) the microphone is let go, and taken again on return.
  const setHidden = on => page.evaluate(v => { if (v) Object.defineProperty(document, 'hidden', { value: true, configurable: true }); else delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }, on);
  await setHidden(true);
  ok('in the background the tuner lets the microphone go', await until(async () => (await state(page)).liveTracks === 0, 3000));
  await setHidden(false);
  ok('and listens again when Gdex comes back', await until(async () => { const s = await state(page); return s.tuner.listening && s.liveTracks >= 1; }));
  await page.click('#tl-tuner-start');
  ok('Stop listening turns the microphone off', await until(async () => { const s = await state(page); return !s.tuner.listening && s.liveTracks === 0; }));
  const aw = await page.evaluate(async () => {
    const a = await import('./js/audio.js');
    const c = new OfflineAudioContext(1, 128, 48000), chain = a.aWeighting(c);
    const f = new Float32Array([50, 100, 1000, 4000, 10000]), mag = new Float32Array(5), ph = new Float32Array(5), total = [1, 1, 1, 1, 1];
    chain.forEach(n => { if (n.getFrequencyResponse) { n.getFrequencyResponse(f, mag, ph); mag.forEach((m, i) => { total[i] *= m; }); } else total.forEach((_, i) => { total[i] *= n.gain.value; }); });
    return total.map(m => Math.round(20 * Math.log10(m) * 10) / 10);
  });
  const IEC = [-30.2, -19.1, 0, 1.0, -2.5];
  ok('the meter’s A-weighting follows the standard curve (within 1 dB)', aw.every((v, i) => Math.abs(v - IEC[i]) <= 1), aw.join(' / '));

  /* ------------------------------- metronome ------------------------------- */
  await tab(page, 'metronome');
  await page.fill('#tl-bpm', '150'); await page.press('#tl-bpm', 'Tab');
  let s = await state(page);
  ok('typing a tempo sets the metronome', s.metronome.bpm === 150 && (await page.inputValue('#tl-bpm-range')) === '150' && /Allegro/.test(await text(page, '.tl-mark')));
  await page.click('#tl-bpm-up'); await page.click('#tl-bpm-down'); await page.click('#tl-bpm-down');
  ok('− and + change the tempo by one', (await state(page)).metronome.bpm === 149 && (await page.inputValue('#tl-bpm')) === '149');
  await page.fill('#tl-bpm', '900'); await page.press('#tl-bpm', 'Tab');
  ok('the tempo stays within 30–300', (await state(page)).metronome.bpm === 300 && (await page.inputValue('#tl-bpm')) === '300');
  // Tap: Enter on the Tap button counts every tap, even at 240 BPM; a mouse tap counts once (its click is not a second tap).
  await page.evaluate(() => {
    window.__taps = { key: [], ptr: [] };
    document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'tl-metro-tap') window.__taps.key.push(performance.now()); }, true);
    document.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('#tl-metro-tap')) window.__taps.ptr.push(e.timeStamp); }, true);
  });
  const bpmOf = ts => (60000 * (ts.length - 1)) / (ts[ts.length - 1] - ts[0]);
  await page.focus('#tl-metro-tap');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Enter'); await sleep(250); }
  let tapped = await page.evaluate(() => window.__taps.key), tappedBpm = (await state(page)).metronome.bpm;
  ok('tapping the tempo with Enter counts every tap, even fast ones', tapped.length === 8 && Math.abs(tappedBpm - bpmOf(tapped)) <= 4, `${tappedBpm} BPM shown for ${bpmOf(tapped).toFixed(1)} tapped`);
  await sleep(2100); // the taps start again after two seconds
  for (let i = 0; i < 4; i++) { await page.click('#tl-metro-tap'); await sleep(400); }
  tapped = await page.evaluate(() => window.__taps.ptr); tappedBpm = (await state(page)).metronome.bpm;
  ok('a mouse tap counts once', tapped.length === 4 && Math.abs(tappedBpm - bpmOf(tapped)) <= 4, `${tappedBpm} BPM shown for ${bpmOf(tapped).toFixed(1)} tapped`);
  await page.fill('#tl-bpm', '120'); await page.press('#tl-bpm', 'Tab');
  await page.click('#tl-metro-run');
  const beatsSeen = new Set();
  for (let i = 0; i < 14; i++) { beatsSeen.add(await page.getAttribute('.tl-lights', 'data-beat')); await sleep(120); }
  s = await state(page);
  ok('Start schedules clicks on the audio clock', s.metronome.running && s.metronome.clicks >= 3, JSON.stringify(s.metronome));
  ok('the beat lights move in time', s.metronome.beats >= 2 && [...beatsSeen].filter(b => b !== '-1').length >= 2, [...beatsSeen].join(','));
  ok('the Start button turns into Stop', /Stop/.test(await text(page, '#tl-metro-run')));
  const c0 = (await state(page)).metronome.clicks; await sleep(1000); const perSec120 = (await state(page)).metronome.clicks - c0;
  await page.fill('#tl-bpm', '240'); await page.press('#tl-bpm', 'Tab');
  const c1 = (await state(page)).metronome.clicks; await sleep(1000); const perSec240 = (await state(page)).metronome.clicks - c1;
  ok('the tempo changes while it plays', (await state(page)).metronome.running && perSec240 > perSec120 && perSec120 >= 1 && perSec120 <= 3, `${perSec120} → ${perSec240} clicks a second`);
  await page.click('[data-sig="6/8"]');
  ok('6/8 shows six beat lights, eighth notes explained', (await page.locator('.tl-lights i').count()) === 6 && /dotted quarter = 160/.test(await text(page, '.tl-eighths')) && (await state(page)).metronome.sig === '6/8');
  await page.click('[data-sub="2"]');
  ok('a subdivision is kept', (await state(page)).metronome.sub === 2 && (await page.getAttribute('[data-sub="2"]', 'aria-pressed')) === 'true');
  await page.click('[data-sig="4/4"]'); await page.click('[data-sub="1"]');
  await page.focus('#tl-bpm-up');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowDown');
  await sleep(150);
  ok('arrow keys in the metronome change the tempo and never spin the Rolodex', (await state(page)).metronome.bpm === 236 && (await page.evaluate(() => window.logiPage())) === 'tools', String((await state(page)).metronome.bpm));
  await page.keyboard.press('Space'); await sleep(200);
  ok('Space stops the metronome', !(await state(page)).metronome.running && (await state(page)).metronome.bpm === 236);
  await page.keyboard.press('Space'); await sleep(300);
  ok('Space starts it again', (await state(page)).metronome.running);
  await page.keyboard.press('Space'); await sleep(150);
  const metro = JSON.parse(await stored(page, 'gdex-metronome'));
  ok('the metronome settings are saved', metro.bpm === 236 && metro.sig === '4/4' && metro.sub === 1 && metro.accent === true);
  await page.click('#tl-accent', { force: true });
  ok('accent on beat one can be turned off', JSON.parse(await stored(page, 'gdex-metronome')).accent === false && (await page.locator('.tl-lights i.acc').count()) === 0);
  await page.click('#tl-accent', { force: true });
  await page.click('#tl-metro-song');
  await page.waitForSelector('.sheet .tl-song');
  ok('“Use a song’s tempo” lists the songs that have one', (await page.locator('.sheet .tl-song').count()) === 10 && /BPM/.test(await text(page, '.sheet .tl-song')));
  await page.fill('#tl-song-q', 'harbour');
  ok('the song list can be searched', (await page.locator('.sheet .tl-song').count()) === 1);
  await page.click('.sheet .tl-song[data-song="s-song1"]');
  await sleep(200);
  ok('picking a song sets its tempo', (await state(page)).metronome.bpm === 128 && (await page.locator('.sheet').count()) === 0 && /Harbour Lights/.test(await text(page, '.tl-from')));
  await page.click('#tl-bpm-up');
  ok('changing the tempo by hand clears the song', await page.locator('.tl-from').isHidden());
  // A song without a tempo, and one deleted while the sheet was closed, never show up.
  await page.evaluate(() => import('./js/store.js').then(st => { st.patch('songs', 's-song2', { bpm: '' }); st.remove('songs', 's-song3'); }));
  await page.click('#tl-metro-song'); await page.waitForSelector('.sheet .tl-song');
  ok('songs without a tempo are left out, and say so', (await page.locator('.sheet .tl-song').count()) === 8 && /no tempo yet/.test(await text(page, '.sheet')));
  await page.keyboard.press('Escape');

  /* ------------------------------- tempo ------------------------------- */
  const taps = await page.evaluate(async () => {
    const t = await import('./js/tools-tempo.js');
    const tapper = t.createTapper();
    [0, 500, 1000, 1500].forEach(x => tapper.tap(x));
    const after = tapper.state().bpm;
    tapper.tap(4000); // more than two seconds later: starts again
    const table = t.delayTable(120), cell = (id, feel) => table.find(r => r.id === id).cells.find(c => c.feel === feel);
    return { pure: t.tapTempo([0, 500, 1000, 1500]), after, restarted: tapper.state().count, q: cell('1/4', 'straight').ms, de: cell('1/8', 'dotted').ms, et: cell('1/8', 'triplet').ms, hz: cell('1/4', 'straight').hz, rv: t.reverbTimes(120)[0] };
  });
  ok('taps 500 ms apart make 120 BPM', taps.pure === 120 && taps.after === 120);
  ok('tap tempo starts again after two seconds without a tap', taps.restarted === 1);
  ok('delay maths: quarter 500, dotted eighth 375, eighth triplet 166.7 at 120', taps.q === 500 && taps.de === 375 && Math.abs(taps.et - 166.667) < 0.001 && taps.hz === 2);
  ok('reverb for a small room at 120: 31.3 ms pre-delay, 468.8 ms decay', taps.rv.pre.toFixed(1) === '31.3' && taps.rv.decay.toFixed(1) === '468.8');
  await tab(page, 'tempo');
  await page.click('#tl-tempo-bpm');
  await page.evaluate(() => new Promise(done => { let n = 0; const go = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true })); if (++n < 5) setTimeout(go, 500); else done(); }; document.activeElement.blur(); go(); }));
  const tapShown = Number(await text(page, '.tl-tap-bpm'));
  ok('pressing T five times half a second apart reads about 120', tapShown >= 118 && tapShown <= 122 && /5 taps/.test(await text(page, '.tl-tap-sub')), String(tapShown));
  ok('the tapped tempo fills the calculator', Math.abs(Number(await page.inputValue('#tl-tempo-bpm')) - tapShown) <= 1);
  await page.fill('#tl-tempo-bpm', '120');
  const cellText = async (note, feel) => (await text(page, `.tl-dt-cell[data-note="${note}"][data-feel="${feel}"]`)).replace(/\s+/g, ' ');
  ok('the delay table: quarter = 500.0 ms (2.00 Hz)', (await cellText('1/4', 'straight')) === '500.0 2.00 Hz', await cellText('1/4', 'straight'));
  ok('the delay table: dotted eighth = 375.0 ms', (await cellText('1/8', 'dotted')).startsWith('375.0'));
  ok('the delay table: eighth triplet = 166.7 ms', (await cellText('1/8', 'triplet')).startsWith('166.7'));
  ok('one beat at 120 is 500.0 ms', (await page.inputValue('#tl-tempo-ms')) === '500.0');
  await page.fill('#tl-tempo-ms', '400');
  ok('typing milliseconds gives the tempo', (await page.inputValue('#tl-tempo-bpm')) === '150' && (await cellText('1/4', 'straight')).startsWith('400.0'));
  ok('the tempo is saved', JSON.parse(await stored(page, 'gdex-tempo')).bpm === 150);
  ok('the reverb table follows the tempo', /25\.0 ms/.test(await text(page, '[data-rv="room"]')));
  await page.click('#tl-tempo-metro');
  await page.waitForSelector('#tl-panel[data-tool="metronome"]');
  ok('“Use in the metronome” opens it at that tempo', (await page.inputValue('#tl-bpm')) === '150' && (await state(page)).metronome.bpm === 150);

  /* ------------------------------- meter ------------------------------- */
  await tab(page, 'meter');
  await page.click('#tl-meter-start');
  ok('the meter shows a level from the microphone', await until(async () => /^\d+$/.test(await text(page, '.tl-db-now')), 6000) && (await state(page)).liveTracks >= 1, await text(page, '.tl-db-now'));
  await sleep(800);
  s = await state(page);
  ok('it keeps the max and the last minute’s average', Number.isFinite(s.meter.max) && Number.isFinite(s.meter.avg) && /\d/.test(await text(page, '.tl-readouts')), JSON.stringify(s.meter));
  await page.selectOption('#tl-limit', 'custom');
  await page.fill('#tl-limit-db', '10');
  ok('a low limit shows the over-the-limit warning', await until(async () => page.locator('.tl-over').isVisible(), 3000) && /Over the limit/.test(await text(page, '.tl-over')));
  ok('the typed limit is saved', JSON.parse(await stored(page, 'gdex-meter-limit')).db === 10);
  await page.selectOption('#tl-limit', 'v:s-lantern');
  ok('a venue’s noise limit can be picked', (await state(page)).meter.limit === 98 && JSON.parse(await stored(page, 'gdex-meter-limit')).venueId === 's-lantern' && await page.locator('.tl-dbbar-limit').isVisible());
  await page.click('[data-w="Z"]');
  ok('flat weighting can be chosen, and the meter carries on with it', (await stored(page, 'gdex-meter-weight')) === '"Z"' && /^dB$/.test(await text(page, '.tl-db-unit')) && await until(async () => { const m = (await state(page)).meter; return m.listening && m.micWeight === 'Z' && m.max > 30; }), JSON.stringify((await state(page)).meter));
  await page.click('#tl-meter-start');
  ok('Stop turns the meter’s microphone off', await until(async () => (await state(page)).liveTracks === 0));
  // Stopped, the loudest moment holds still (Stop keeps it), so a new offset moves it by exactly the difference.
  await page.click('.tl-cal summary');
  const before = (await state(page)).meter.max;
  await page.fill('#tl-cal', '90');
  await sleep(150);
  ok('the calibration offset is saved and shifts the readings', (await stored(page, 'gdex-meter-cal')) === '90' && Number.isFinite(before) && (await state(page)).meter.max === before - 10, `${before} → ${(await state(page)).meter.max}`);
  // The microphone can take a while to start. A Stop tapped meanwhile, or Gdex going to the background, keeps it off;
  // a weighting picked meanwhile is the one it listens with.
  await page.evaluate(() => { const md = navigator.mediaDevices, real = md.getUserMedia.bind(md); window.__realGUM = real; md.getUserMedia = c => new Promise(r => setTimeout(r, 900)).then(() => real(c)); });
  const settled = () => until(async () => !(await state(page)).meter.starting, 6000);
  await page.click('#tl-meter-start');
  const startingText = await text(page, '#tl-meter-start');
  await page.click('#tl-meter-start');
  const stoppedText = await text(page, '#tl-meter-start');
  await settled(); await sleep(300);
  s = await state(page);
  ok('Stop tapped while the meter is starting keeps the microphone off', /Starting/.test(startingText) && /Start meter/.test(stoppedText) && !s.meter.listening && s.liveTracks === 0 && /Start meter/.test(await text(page, '#tl-meter-start')), `${startingText} → ${stoppedText} → ${JSON.stringify(s.meter)}, ${s.liveTracks} live`);
  await page.click('#tl-meter-start');
  await setHidden(true);
  await settled(); await sleep(300);
  s = await state(page);
  ok('going to the background while it starts keeps the microphone off', !s.meter.listening && s.liveTracks === 0, JSON.stringify(s.meter));
  await setHidden(false);
  await page.click('#tl-meter-start');
  await page.click('[data-w="A"]');
  ok('a weighting picked while it starts is the one it listens with', await until(async () => { const m = (await state(page)).meter; return m.listening && m.micWeight === 'A' && m.weight === 'A'; }, 8000), JSON.stringify((await state(page)).meter));
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.__realGUM; });
  await page.click('#tl-meter-start');
  ok('…and Stop turns it off', await until(async () => (await state(page)).liveTracks === 0));
  await page.evaluate(() => import('./js/store.js').then(st => st.remove('venues', 's-lantern')));
  await sleep(200);
  ok('a venue deleted elsewhere drops out of the limits', !(await page.locator('#tl-limit option[value="v:s-lantern"]').count()) && (await page.inputValue('#tl-limit')) === '' && /no longer in Venues/.test(await text(page, '#tl-panel > .tl-card:nth-child(2)')));

  /* ------------------------------- set timer ------------------------------- */
  await tab(page, 'timer');
  await page.fill('#tl-set-min', '1'); await page.press('#tl-set-min', 'Tab');
  ok('typing the set length sets the clock', (await text(page, '#tl-clock')) === '1:00' && JSON.parse(await stored(page, 'gdex-settimer')).total === 60);
  await page.click('#tl-set-run');
  await sleep(2400);
  const running = await text(page, '#tl-clock');
  ok('the set timer counts down', /^0:5[5-8]$/.test(running) && (await state(page)).timer.running, running);
  ok('under a minute left it turns red', (await page.getAttribute('.tl-timer', 'data-zone')) === 'one');
  await page.click('#tl-set-run');
  const paused = await text(page, '#tl-clock'); await sleep(1300);
  ok('Pause holds the time', (await text(page, '#tl-clock')) === paused && !(await state(page)).timer.running && /Resume/.test(await text(page, '#tl-set-run')));
  await page.click('#tl-set-run'); await page.click('#tl-set-minus'); await sleep(1200);
  ok('past zero it counts up in red as overtime', /^\+0:0\d$/.test(await text(page, '#tl-clock')) && (await page.getAttribute('.tl-timer', 'data-zone')) === 'over' && /Over time/.test(await text(page, '.tl-clock-status')), await text(page, '#tl-clock'));
  await page.click('#tl-set-reset'); // confirm() is accepted by the test browser
  ok('Reset goes back to the set length', (await text(page, '#tl-clock')) === '1:00' && !(await state(page)).timer.running && (await state(page)).wakeLock === false);
  await page.fill('#tl-set-min', '6'); await page.press('#tl-set-min', 'Tab');
  await page.click('#tl-set-run'); await sleep(300);
  ok('more than five minutes left is the normal colour', (await page.getAttribute('.tl-timer', 'data-zone')) === 'run');
  await page.focus('#tl-set-plus'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await sleep(200);
  ok('arrow keys inside a tool never spin the Rolodex', (await page.evaluate(() => window.logiPage())) === 'tools' && (await state(page)).timer.running);
  await page.click('#tl-set-minus'); await sleep(400);
  ok('at five minutes left it turns amber', (await page.getAttribute('.tl-timer', 'data-zone')) === 'five');
  // It keeps counting while another page is open.
  const t0 = (await state(page)).timer.remaining;
  await go(page, 'songs'); await sleep(1500); await go(page, 'tools'); await page.waitForSelector('#tl-clock');
  const t1 = (await state(page)).timer.remaining;
  ok('the timer keeps going on another page', (await state(page)).timer.running && t1 <= t0 - 1 && (await page.getAttribute('#tl-tab-timer', 'aria-selected')) === 'true', `${t0} → ${t1}`);
  await page.click('#tl-set-big');
  ok('Big screen shows the clock alone', await page.locator('.tl-full').isVisible() && /^\d:\d\d$/.test(await text(page, '.tl-full-clock')));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('Escape closes the big screen, and full screen with it', await page.locator('.tl-full').isHidden() && await until(() => page.evaluate(() => !document.fullscreenElement), 3000));
  await page.click('#tl-set-reset');
  ok('“No show tonight” is said plainly', /No show in Bookings tonight/.test(await text(page, '.tl-show')));
  // A show tonight, curfew after midnight, and no act or venue.
  await page.evaluate(() => import('./js/store.js').then(st => { const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; st.upsert('bookings', { id: 't-tonight', kind: 'show', status: 'confirmed', title: 'Late slot at the Cellar', date: iso, doors: '22:00', setTime: '23:30', setLength: 50, curfew: '00:30' }); }));
  await page.waitForSelector('#tl-set-show');
  ok('tonight’s show appears', /Late slot at the Cellar/.test(await text(page, '.tl-show')) && /On stage 23:30 · 50m set · curfew 00:30/.test(await text(page, '.tl-show')));
  ok('a curfew after midnight counts to the next morning', /Curfew 00:30/.test(await text(page, '.tl-curfew')) && /to go|Curfew is now/.test(await text(page, '.tl-curfew')) && !/null|undefined/.test(await text(page, '.tl-curfew')), (await text(page, '.tl-curfew')).replace(/\s+/g, ' '));
  await page.click('#tl-set-show');
  s = await state(page);
  ok('“Use tonight’s show” takes its set length', (await text(page, '#tl-clock')) === '50:00' && s.timer.total === 3000 && s.timer.bookingId === 't-tonight' && /In use/.test(await text(page, '.tl-show')));
  await page.evaluate(() => import('./js/store.js').then(st => st.remove('bookings', 't-tonight')));
  await sleep(400);
  ok('a show deleted elsewhere drops out, the timer stays', (await text(page, '#tl-clock')) === '50:00' && await page.locator('.tl-curfew').isHidden() && /No show in Bookings tonight/.test(await text(page, '.tl-show')));

  /* ------------------------------- leaving the page ------------------------------- */
  await tab(page, 'metronome'); await page.click('#tl-metro-run'); await sleep(300);
  await tab(page, 'tuner');
  ok('switching tools stops the metronome', !(await state(page)).metronome.running);
  if (!(await until(async () => (await state(page)).tuner.listening, 2500))) await page.click('#tl-tuner-start');
  ok('the tuner is listening before leaving', await until(async () => (await state(page)).liveTracks >= 1));
  await page.click('.tl-tone .chip[data-midi="69"]');
  await go(page, 'songs');
  s = await state(page);
  ok('leaving the page stops the microphone, the tone and the sound', s.liveTracks === 0 && s.context === 'none' && !s.tuner.listening && s.tuner.tone === null && !s.metronome.running && s.wakeLock === false, JSON.stringify(s));
  ok('and the Rolodex went where it was asked', (await page.evaluate(() => window.logiPage())) === 'songs');

  /* ------------------------------- tutorial ------------------------------- */
  await go(page, 'tools'); await tab(page, 'tempo');
  await page.click('#helpBtn');
  ok('the ? walkthrough explains the tools', await until(async () => /Five tools/.test(await text(page, '.tour-card')), 3000));
  await page.click('.tour-card .btn.primary'); await sleep(700);
  ok('and then the open tool', /Tap tempo/.test(await text(page, '.tour-card')));
  await page.keyboard.press('Escape');
  await page.click('#tl-tab-metronome'); await page.click('#tl-metro-song'); await page.waitForSelector('.sheet .tl-song');
  await page.click('.sheet .sheet-help');
  ok('the song sheet has its own walkthrough', await until(async () => /Find a song/.test(await text(page, '.tour-card')), 3000));
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape');

  /* ------------------------------- after a reload, and an empty database ------------------------------- */
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
  await go(page, 'tools'); await page.waitForSelector('.tl-seg');
  ok('the last tool is opened again after a reload', (await page.getAttribute('#tl-tab-metronome', 'aria-selected')) === 'true');
  ok('and so is its tempo', (await page.inputValue('#tl-bpm')) === '150' && JSON.parse(await stored(page, 'gdex-metronome')).bpm === 150);
  await page.evaluate(() => import('./js/store.js').then(st => st.eraseAll()));
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
  await go(page, 'tools'); await page.waitForSelector('.tl-seg');
  ok('erasing everything resets the tools too', (await page.getAttribute('#tl-tab-tuner', 'aria-selected')) === 'true');
  await tab(page, 'metronome');
  await page.click('#tl-metro-song'); await page.waitForSelector('.sheet .empty');
  ok('with no songs, the song sheet says what to do', /No songs yet/.test(await text(page, '.sheet .empty')));
  await page.keyboard.press('Escape');
  await tab(page, 'meter');
  ok('with no venues, the limit says where they come from', /Add a noise limit to a venue/.test(await text(page, '#tl-panel')));
  await tab(page, 'timer');
  ok('with no bookings, the timer still works', /No show in Bookings tonight/.test(await text(page, '.tl-show')) && /^\d+:\d\d$/.test(await text(page, '#tl-clock')));

  ok('no errors in the console', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL tools crashed — ' + e.message); process.exit(1); });

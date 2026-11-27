// Markers for the edit (js/marker-files.js): every note with a timecode as a marker, in a file for Avid Media
// Composer (tab-separated marker list), DaVinci Resolve (marker EDL), Premiere Pro (Final Cut Pro 7 XML) and Final Cut
// Pro (FCPXML), checked line by line and parsed as XML; drop-frame timecode; and the Export sheet offering them.
const { chromium } = require('playwright');
const { acceptTerms } = require('../helpers.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const APP = process.env.VDEX_URL || 'http://localhost:8123/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 880 }, acceptDownloads: true });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP); await page.waitForSelector('#rolodex .drum-btn');
  // A 25 fps log: a good take pinned to a line, a no-good take, a ⚑ mark, a note, and one note with no timecode.
  const files = await page.evaluate(async () => {
    const t = await import('./js/timecode.js'), m = await import('./js/marker-files.js');
    const r = t.rate('25'), f = tc => t.tcToFrames(tc, r);
    const log = { title: 'Brewery day one, A cam', rate: '25', notes: [
      { id: 'a', frames: f('01:04:22:15'), text: '▶ Take 2 (pickup)', kind: 'roll', take: 2, dur: '0:42', rate: 'good', quote: 'That colour is six weeks of waiting.', at: '' },
      { id: 'b', frames: f('01:02:00:00'), text: '▶ Take 1', kind: 'roll', take: 1, dur: '1:05', rate: 'ng', at: '' },
      { id: 'c', frames: f('01:05:10:05'), text: '⚑ Take 3', at: '' },
      { id: 'd', frames: f('01:06:00:00'), text: 'Plane overhead | wait\tfor it', at: '' },
      { id: 'e', frames: null, text: 'Before the sync', at: '' },
    ] };
    const df = { title: 'Drop frame', rate: '29.97df', notes: [{ id: 'x', frames: t.tcToFrames('02:10:00;02', t.rate('29.97df')), text: 'DF note', at: '' }] };
    return { avid: m.avidMarkers(log), resolve: m.resolveEdl(log), premiere: m.premiereXml(log), fcp: m.fcpxml(log), dfResolve: m.resolveEdl(df), dfPremiere: m.premiereXml(df), dfFcp: m.fcpxml(df), none: m.premiereXml({ title: 'x', rate: '25', notes: [{ frames: null, text: 'n' }] }) };
  });
  const avid = files.avid.split('\r\n').filter(Boolean).map(l => l.split('\t'));
  ok('Avid: one tab-separated line a marker, in timecode order, a note with no timecode left out', avid.length === 4 && avid.map(c => c[1]).join() === '01:02:00:00,01:04:22:15,01:05:10:05,01:06:00:00' && avid.every(c => c.length === 6 && c[0] === 'Vdex' && c[2] === 'V1' && c[5] === '1'), JSON.stringify(avid));
  ok('…colours by kind (no good red, good green, ⚑ yellow, a note cyan), the take named with its rating and length, the script line after it, and no tab inside a marker', avid.map(c => c[3]).join() === 'red,green,yellow,cyan' && avid[1][4] === 'Take 2 (pickup) ★ Good [0:42] — “That colour is six weeks of waiting.”' && avid[3][4] === 'Plane overhead | wait for it', JSON.stringify(avid.map(c => c[4])));
  const ev = files.resolve.split('\r\n');
  ok('Resolve: a marker EDL with its title and frame count mode, an event a marker at its timecode', ev[0] === 'TITLE: Brewery day one, A cam' && ev[1] === 'FCM: NON-DROP FRAME' && ev.filter(l => /^\d{3}  001      V     C        /.test(l)).length === 4 && /^001 .* 01:02:00:00 01:02:00:01 01:02:00:00 01:02:00:01/.test(ev[3]), ev.slice(0, 5).join(' / '));
  ok('…each comment with the colour, the name and a length of one frame, and a | in a note made safe', /^\|C:ResolveColorRed \|M:Take 1 ✕ No good \[1:05\] \|D:1$/.test(ev[4]) && ev.some(l => /^“That colour is six weeks of waiting\.” \|C:ResolveColorGreen \|M:Take 2 \(pickup\) ★ Good \[0:42\] \|D:1$/.test(l)) && ev.some(l => /\|M:Plane overhead \/ wait for it \|D:1$/.test(l)), ev.filter(l => /\|C:/.test(l)).join(' / '));
  const parsed = await page.evaluate(f => {
    const P = new DOMParser(), x = P.parseFromString(f.premiere, 'application/xml'), y = P.parseFromString(f.fcp, 'application/xml'), dx = P.parseFromString(f.dfPremiere, 'application/xml'), dy = P.parseFromString(f.dfFcp, 'application/xml');
    const bad = d => d.getElementsByTagName('parsererror').length > 0;
    return {
      bad: [x, y, dx, dy].map(bad),
      pr: { name: x.querySelector('sequence > name').textContent, start: x.querySelector('sequence > timecode > string').textContent, frame: x.querySelector('sequence > timecode > frame').textContent, base: x.querySelector('sequence > rate > timebase').textContent, ntsc: x.querySelector('sequence > rate > ntsc').textContent, ins: [...x.querySelectorAll('sequence > marker > in')].map(e => +e.textContent), names: [...x.querySelectorAll('sequence > marker > name')].map(e => e.textContent), comment: x.querySelector('sequence > marker:nth-of-type(2) > comment').textContent },
      fcp: { fd: y.querySelector('format').getAttribute('frameDuration'), tcStart: y.querySelector('sequence').getAttribute('tcStart'), starts: [...y.querySelectorAll('gap > marker')].map(e => e.getAttribute('start')), values: [...y.querySelectorAll('gap > marker')].map(e => e.getAttribute('value')), done: [...y.querySelectorAll('gap > marker')].map(e => e.getAttribute('completed')), gap: y.querySelector('gap').getAttribute('start'), event: y.querySelector('event').getAttribute('name') },
      df: { start: dx.querySelector('sequence > timecode > string').textContent, frame: +dx.querySelector('sequence > timecode > frame').textContent, fmt: dx.querySelector('displayformat').textContent, fcpFmt: dy.querySelector('sequence').getAttribute('tcFormat'), fd: dy.querySelector('format').getAttribute('frameDuration'), ins: [...dx.querySelectorAll('sequence > marker > in')].map(e => +e.textContent) },
    };
  }, files);
  ok('the Premiere and Final Cut files are well-formed XML', parsed.bad.every(b => !b), JSON.stringify(parsed.bad));
  ok('Premiere: a sequence starting at the hour before the first note (01:00:00:00, frame 90000 at 25), markers at their offsets from it', parsed.pr.start === '01:00:00:00' && parsed.pr.frame === '90000' && parsed.pr.base === '25' && parsed.pr.ntsc === 'FALSE' && JSON.stringify(parsed.pr.ins) === JSON.stringify([3000, 6565, 7755, 9000]) && parsed.pr.names[1] === 'Take 2 (pickup) ★ Good [0:42]' && parsed.pr.comment === '“That colour is six weeks of waiting.”', JSON.stringify(parsed.pr));
  ok('Final Cut: frames of 1/25 s, the timeline starting at 01:00:00:00, markers at the camera’s timecode on the gap clip, a good take ticked as done', parsed.fcp.fd === '100/2500s' && parsed.fcp.tcStart === '9000000/2500s' && parsed.fcp.gap === '9000000/2500s' && JSON.stringify(parsed.fcp.starts) === JSON.stringify(['9300000/2500s', '9656500/2500s', '9775500/2500s', '9900000/2500s']) && JSON.stringify(parsed.fcp.done) === JSON.stringify([null, '1', null, null]) && parsed.fcp.event === 'Vdex markers', JSON.stringify(parsed.fcp));
  ok('drop frame: the hour before 02:10:00;02 is 02:00:00;00 (frame 215784), and the files say drop frame', files.dfResolve.includes('FCM: DROP FRAME') && files.dfResolve.includes('02:10:00;02') && parsed.df.start === '02:00:00;00' && parsed.df.frame === 215784 && parsed.df.fmt === 'DF' && parsed.df.fcpFmt === 'DF' && parsed.df.fd === '1001/30000s' && parsed.df.ins[0] === 17984, JSON.stringify(parsed.df));
  ok('a log with no timecode on any note makes no marker file', files.none === '');
  // The Export sheet: the four files, each with where to import it.
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(600);
  await page.locator('.tc-log-head .actions button', { hasText: 'Export' }).click(); await page.waitForSelector('.sheet .tc-markers');
  ok('Export offers markers for Avid, Resolve, Premiere and Final Cut, each with where to import it', JSON.stringify(await page.locator('.sheet .tc-markers [data-marker]').evaluateAll(b => b.map(x => x.dataset.marker))) === '["avid","resolve","premiere","fcp"]' && (await page.locator('.sheet .tc-marker-file p').count()) === 4);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.locator('.sheet [data-marker="resolve"]').click()]);
  ok('…and saves one, named after the log', dl.suggestedFilename() === 'Practice_log_delete_when_done_markers.edl', dl.suggestedFilename());
  ok('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL the marker files spec crashed — ' + (e && e.stack || e)); process.exit(1); });

// Script files for TC Notes and the teleprompter (js/script-files.js, js/docx.js): a Word file's emphasis and its
// screenplay styles, a VIDEO | AUDIO table (the audio column is read, the video column is direction), Final Draft,
// PDF (a screenplay and a two-column script; the reader comes from cdnjs, so the PDF checks are skipped offline),
// a file dropped on the Add script sheet, the clipboard, and a PDF shared to Vdex going to the teleprompter.
const { chromium } = require('playwright');
const zlib = require('zlib');
const { acceptTerms } = require('../helpers.cjs');
const S = process.env.S;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const skip = (name, why) => console.log('SKIP ' + name + ' — ' + why);
const APP = process.env.VDEX_URL || 'http://localhost:8123/';

/* a .docx, built here: a zip of XML (as in spec 117) */
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const local = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), body = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    local.push(lh, nm, body); central.push(ch, nm); off += 30 + nm.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (t, pr = '') => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const cell = t => `<w:tc>${para(run(t))}</w:tc>`;
const docx = body => zip({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', 'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>` });
const AV = docx(
  para(run('Harbour Brewing: brand film')) +
  para(run('Every batch starts before sunrise. If you are not here at '), run('five', '<w:b/>'), run(', you have missed the '), run('best part', '<w:u w:val="single"/>'), run('.')) +
  para(run('Not bold, though it says so', '<w:b w:val="0"/>')) +
  `<w:tbl><w:tr>${cell('VIDEO')}${cell('AUDIO')}</w:tr><w:tr>${cell('Wide of the brewery at dawn')}${cell('Every batch starts before sunrise.')}</w:tr><w:tr>${cell('Close on the mash tun')}${cell('That colour is six weeks of waiting.')}</w:tr></w:tbl>`);
const STYLED = docx(['SceneHeading:INT. TAPROOM - MORNING', 'Action:Steam rises off the mash tun.', 'Character:ANA', 'Dialogue:Every batch starts before sunrise.', 'Character:TOM', 'Dialogue:Interview at ten.'].map(x => { const [st, t] = x.split(':'); return `<w:p><w:pPr><w:pStyle w:val="${st}"/></w:pPr>${run(t)}</w:p>`; }).join(''));
const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5"><Content>
<Paragraph Type="Scene Heading"><Text>INT. HARBOUR BREWING TAPROOM - MORNING</Text></Paragraph>
<Paragraph Type="Action"><Text>Steam rises off the mash tun.</Text></Paragraph>
<Paragraph Type="Shot"><Text>CLOSE ON THE TANK</Text></Paragraph>
<Paragraph Type="Character"><Text>ANA</Text></Paragraph>
<Paragraph Type="Parenthetical"><Text>(to camera)</Text></Paragraph>
<Paragraph Type="Dialogue"><Text>Every batch starts before </Text><Text Style="Bold">sunrise</Text><Text>.</Text></Paragraph>
<Paragraph><DualDialogue><Paragraph Type="Character"><Text>TOM</Text></Paragraph><Paragraph Type="Dialogue"><Text>Ten o'clock.</Text></Paragraph><Paragraph Type="Character"><Text>ANA</Text></Paragraph><Paragraph Type="Dialogue"><Text>Five.</Text></Paragraph></DualDialogue></Paragraph>
<Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
</Content><TitlePage><Content><Paragraph><Text>Not part of the script</Text></Paragraph></Content></TitlePage></FinalDraft>`;
/* a PDF, built here: Helvetica text at positions, one page per list */
function makePdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], kids = [];
  for (const rows of pages) {
    const stream = rows.map(([x, y, size, t]) => `BT /F1 ${size} Tf ${x} ${y} Td (${t.replace(/[\\()]/g, m => '\\' + m)}) Tj ET`).join('\n');
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(objs.length);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const SCREENPLAY_PDF = makePdf([
  [[108, 700, 12, 'INT. TAPROOM - MORNING'], [108, 676, 12, 'Early light through the dock windows.'], [252, 652, 12, 'ANA'], [180, 638, 12, 'Every batch starts before sunrise. If you'], [180, 624, 12, 'are not here at five, you have missed it.'], [530, 750, 12, '1.'], [250, 60, 12, '(MORE)']],
  [[530, 750, 12, '2.'], [252, 700, 12, 'TOM'], [180, 686, 12, 'Interview at ten.']],
]);
const AV_PDF = makePdf([[[72, 720, 12, 'VIDEO'], [320, 720, 12, 'AUDIO'], [72, 690, 12, 'Wide of the brewery at dawn'], [320, 690, 12, 'Every batch starts before sunrise.'], [72, 650, 12, 'Close on the mash tun'], [320, 650, 12, 'That colour is six weeks of waiting.']]]);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } });
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  // VDEX_PDFJS_DIR: a folder holding pdf.min.js and pdf.worker.min.js (3.11.174), served in cdnjs's place, for a run
  // without the internet. The page still checks their integrity.
  if (process.env.VDEX_PDFJS_DIR) await ctx.route('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*', r => r.fulfill({ path: require('path').join(process.env.VDEX_PDFJS_DIR, require('path').basename(new URL(r.request().url()).pathname)), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(APP); await page.waitForSelector('#rolodex .drum-btn');
  // Reads a file the way the Add script sheet does, in the page.
  const read = (name, buf, type = '') => page.evaluate(async ({ name, b64, type }) => {
    const m = await import('./js/script-files.js'), d = await import('./js/docx.js');
    try { const lines = await m.readScriptFile(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type })); const sc = d.buildScript(name, lines); const p = await import('./js/prompter.js'); return { lines, paras: sc.paras.map(x => ({ text: x.text, kind: x.kind, dir: !!x.dir, marks: x.marks || null })), roles: p.analyse(sc).map(a => a.role) }; } catch (e) { return { error: e.message }; }
  }, { name, b64: buf.toString('base64'), type });

  const av = await read('brand-film.docx', AV);
  const tbl = av.lines.slice(-4);
  ok('a Word file’s VIDEO | AUDIO table: the header row left out, the video column direction, the audio column read', !av.error && tbl.map(l => (l.dir ? 'V:' : 'A:') + l.text).join('|') === 'V:Wide of the brewery at dawn|A:Every batch starts before sunrise.|V:Close on the mash tun|A:That colour is six weeks of waiting.', JSON.stringify(av.error || tbl));
  const five = av.paras.find(p => /^Every batch starts before sunrise\. If/.test(p.text));
  ok('…its bold and underlined words are kept, for the prompter to show what to stress, and a run switched off is not', five && JSON.stringify(five.marks.map(([a, b, f]) => [five.text.slice(a, b), f])) === '[["five","b"],["best part","u"]]' && !av.paras.find(p => /^Not bold/.test(p.text)).marks, JSON.stringify(five && five.marks));
  ok('…and on the prompter the video lines are directions and the audio lines are read', JSON.stringify(av.roles.slice(-4)) === '["dir","say","dir","say"]', JSON.stringify(av.roles));
  const styled = await read('styled.docx', STYLED);
  ok('a Word screenplay’s own styles say what each line is', JSON.stringify(styled.paras.map(p => p.kind)) === '["heading","para","character","dialogue","character","dialogue"]', JSON.stringify(styled.paras.map(p => p.kind)));
  const fdx = await read('harbour.fdx', Buffer.from(FDX));
  ok('Final Draft: each paragraph’s own type, the title page left out, dual dialogue in order', !fdx.error && JSON.stringify(fdx.paras.map(p => p.kind)) === '["heading","para","para","character","paren","dialogue","character","dialogue","character","dialogue","transition"]' && !fdx.paras.some(p => /Not part/.test(p.text)), JSON.stringify(fdx.error || fdx.paras.map(p => p.kind + ':' + p.text)));
  ok('…a shot is direction, and bold is kept', fdx.paras[2].dir && JSON.stringify(fdx.paras[5].marks) === '[[26,33,"b"]]' && fdx.paras[5].text.slice(26, 33) === 'sunrise', JSON.stringify(fdx.paras[5]));
  ok('…and on the prompter it reads as a screenplay: dialogue read, names as cues, the shot a direction', JSON.stringify(fdx.roles) === '["head","dir","dir","cue","dir","say","cue","say","cue","say","dir"]', JSON.stringify(fdx.roles));
  const bad = await read('notes.fdx', Buffer.from('<FinalDraft><Nothing/></FinalDraft>'));
  ok('an .fdx with no script in it says so', /No script found/.test(bad.error || ''), bad.error);

  // PDF: the reader comes from cdnjs the first time; offline (or blocked) the PDF checks are skipped.
  const online = await page.evaluate(() => fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', { method: 'HEAD' }).then(r => r.ok).catch(() => false));
  if (!online) skip('PDF scripts', 'cdnjs.cloudflare.com cannot be reached from here');
  else {
    const sp = await read('screenplay.pdf', SCREENPLAY_PDF, 'application/pdf');
    ok('a screenplay PDF: rows joined into paragraphs by indent, page numbers and (MORE) left out', !sp.error && JSON.stringify(sp.lines.map(l => l.text)) === JSON.stringify(['INT. TAPROOM - MORNING', 'Early light through the dock windows.', 'ANA', 'Every batch starts before sunrise. If you are not here at five, you have missed it.', 'TOM', 'Interview at ten.']), JSON.stringify(sp.error || sp.lines.map(l => l.text)));
    ok('…read as a screenplay', JSON.stringify(sp.roles) === '["head","dir","cue","say","cue","say"]', JSON.stringify(sp.roles));
    const ap = await read('two-column.pdf', AV_PDF, 'application/pdf');
    ok('a PDF in VIDEO and AUDIO columns: the audio read, the video as direction, in order down the page', !ap.error && ap.lines.map(l => (l.dir ? 'V:' : 'A:') + l.text).join('|') === 'V:Wide of the brewery at dawn|A:Every batch starts before sunrise.|V:Close on the mash tun|A:That colour is six weeks of waiting.', JSON.stringify(ap.error || ap.lines));
    ok('the PDF reader came pinned with Subresource Integrity', await page.evaluate(() => [...document.querySelectorAll('script[src*="pdf.js/3.11.174"]')].every(s => /^sha512-/.test(s.integrity)) && document.querySelectorAll('script[src*="pdf.js/3.11.174"]').length === 2));
    const scan = await read('scan.pdf', makePdf([[]]), 'application/pdf');
    ok('a PDF with no text (a scan) says so', /No text found in this PDF/.test(scan.error || ''), scan.error);
  }

  // The Add script sheet: a file dropped on it, and the clipboard.
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(600);
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.showView('script'))); await sleep(300);
  await page.locator('.sc-head button', { hasText: 'Replace' }).click(); await page.waitForSelector('.sheet[aria-label="Replace script"]');
  ok('the sheet takes Word, PDF, Final Draft, Fountain and text', /\.pdf/.test(await page.locator('.sheet input[type=file]').getAttribute('accept')) && /\.fdx/.test(await page.locator('.sheet input[type=file]').getAttribute('accept')));
  await page.evaluate(b64 => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'brand-film.docx')); const body = document.querySelector('.sheet .sheet-body > .stack'); body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, AV.toString('base64'));
  await sleep(500);
  ok('a file dropped on the sheet is read', /brand-film — 7 lines/.test(await page.locator('.sheet .import-preview').innerText()), await page.locator('.sheet .import-preview').innerText());
  await page.evaluate(() => navigator.clipboard.writeText('PRESENTER: Welcome to the brewery.\nGUEST: Thanks for having me.'));
  await page.locator('.sheet .imp-clip').click(); await sleep(300);
  ok('📋 Paste from the clipboard reads it in one tap', /Pasted script — 2 lines/.test(await page.locator('.sheet .import-preview').innerText()));
  await page.locator('.sheet .icon-btn[aria-label="Close"]').click(); await sleep(200);

  // A PDF shared to Vdex: a script only, for TC Notes or the teleprompter (no shot list), and the teleprompter gives it a log.
  await page.evaluate(b64 => import('./js/share-in.js').then(m => m.arrived(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'brand-film.pdf', { type: 'application/pdf' }))), AV_PDF.toString('base64'));
  await page.waitForSelector('.sheet[aria-label="A file for Vdex"]');
  ok('a PDF handed to Vdex is offered to TC Notes and the teleprompter, not as a shot list', (await page.locator('.sheet .share-prompter').count()) === 1 && !/Shot list for a booking/.test(await page.locator('.sheet').innerText()));
  await page.locator('.sheet .share-prompter').click();
  await page.waitForSelector('.sheet[aria-label="Add script"]'); await sleep(online ? 1500 : 500);
  if (online) {
    await page.locator('.sheet .btn.primary', { hasText: 'Use this script' }).click(); await sleep(600);
    ok('…and the teleprompter makes it a log of its own, opened on its prompter', (await page.evaluate(() => import('./js/store.js').then(s => s.db.logs.some(l => l.title === 'brand-film' && l.script && l.script.paras.some(p => p.dir))))) && (await page.locator('.tc-views button.on').innerText()) === 'Prompter');
    await page.locator('.pr-open').click(); await page.waitForSelector('.prompter'); await sleep(300);
    ok('…where the video column shows as direction', (await page.locator('.pr-line.r-dir').count()) === 2 && (await page.locator('.pr-line.r-say').count()) === 2);
    await page.screenshot({ path: S + '/prompter-av.png' });
    await page.keyboard.press('Escape');
  } else ok('…and the teleprompter opens the Add script sheet for a log of its own', (await page.locator('.sheet[aria-label="Add script"]').count()) === 1);

  // Emphasis on the stage.
  await page.evaluate(async b64 => { const s = await import('./js/store.js'), d = await import('./js/docx.js'), f = await import('./js/script-files.js'); const lines = await f.readScriptFile(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'x.docx')); s.upsert('logs', { id: 'log-em', title: 'Emphasis', created: '2026-11-25', rate: '25', mode: 'free', notes: [], take: 0, sync: null, script: d.buildScript('Emphasis', lines), scriptAt: Date.now() }); }, AV.toString('base64'));
  await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openLog('log-em', 'prompter'))); await sleep(400);
  await page.locator('.pr-open').click(); await page.waitForSelector('.prompter'); await sleep(200);
  ok('the prompter shows the stress: bold and underlined words', (await page.locator('.pr-line .em-b').innerText()) === 'five' && (await page.locator('.pr-line .em-u').innerText()) === 'best part');
  await page.keyboard.press('Escape');
  ok('no errors', errors.length === 0, errors.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL the script files spec crashed — ' + (e && e.stack || e)); process.exit(1); });

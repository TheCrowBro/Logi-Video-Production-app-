// Importing a kit list kept somewhere else (Equipment → Import…): Vdex's own asset register there and back with
// nothing lost, the sample files in tests/fixtures (two kit apps' exports, a rental house's order, an insurer's
// schedule and a spreadsheet template as .xlsx from two different writers), a workbook built here to reach the odd
// corners of the format, pasted text of each shape, correcting a column, duplicates by serial number with each
// choice, categories, decimal commas, a list with no headings, an old .xls turned down kindly, the numbers in the
// summary, Undo, read-only mode, the PIN lock, hostile and silly files, 5,000 rows, and the layout at 360 px and 1200 px.
// And what a review found afterwards: quantities a list does not give, a row holding only a word (item or heading),
// number cells of an .xlsx, workbooks and lists made to waste time, a list made from one's own items and kits, room
// in the browser's storage (with and without a PIN) and saying so when a save is refused, a tap beside the sheet,
// where Undo goes, and a spreadsheet shared to the installed web app.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { acceptTerms } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const OUT = process.env.S || '/tmp';
const FIX = path.join(__dirname, '..', 'fixtures'); // read from the repository: the scratch copy the app is served from has no tests
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ----------------------------- a zip, and so an .xlsx, made by hand ----------------------------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files, { stored = [] } = {}) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'), plain = stored.includes(name), body = plain ? data : zlib.deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(plain ? 0 : 8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(plain ? 0 : 8, 10); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(local, nm, body); central.push(cd, nm); off += 30 + nm.length + body.length;
  }
  const cdBuf = Buffer.concat(central), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n', NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
// A workbook that uses what real ones use, a bit of each: a hidden first sheet, shared strings (plain, in several
// runs, with an entity, a phonetic guide and Excel's _x000D_ escape), an inline string, a formula's saved result, a
// boolean, an error, dates under a built-in and a custom date format counted from 1904, a number that needs tidying,
// a row with no cell references, a skipped row, a sheet whose tags carry a prefix and whose path is absolute, one
// part stored without compression.
const ODD_XLSX = zip({
  '[Content_Types].xml': XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'xl/workbook.xml': XML + `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Old list" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Kit &amp; cases" sheetId="2" r:id="rId2"/><sheet name="Lenses" sheetId="3" r:id="rId3"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x" Target="/xl/worksheets/third.xml"/><Relationship Id="rId4" Type="x" Target="styles.xml"/></Relationships>',
  'xl/sharedStrings.xml': XML + `<sst ${NS}><si><t>Item</t></si><si><t>Serial number</t></si><si><r><rPr><b/></rPr><t>Sony </t></r><r><t xml:space="preserve">FX6 &amp; cage</t></r><rPh sb="0" eb="1"><t>SONI</t></rPh></si><si><t>Bought</t></si><si><t>Value</t></si><si><t>Line one_x000D__x000A_line &lt;two&gt;</t></si><si><t>Notes</t></si><si><t>Quantity</t></si><si><t>OLD THING</t></si></sst>`,
  'xl/styles.xml': XML + `<styleSheet ${NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\ mmm\\ yyyy"/><numFmt numFmtId="165" formatCode="0.00&quot; kg d&quot;"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="4"/><xf numFmtId="165"/></cellXfs></styleSheet>`,
  'xl/worksheets/sheet1.xml': XML + `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>8</v></c></row></sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': XML + `<worksheet ${NS}><cols><col min="1" max="1" width="30"/></cols><sheetData>`
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c><c r="D1" t="s"><v>4</v></c><c r="E1" t="s"><v>6</v></c><c r="F1" t="s"><v>7</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="str"><f>CONCATENATE("FX6-",1)</f><v>FX6-1</v></c><c r="C2" s="1"><v>43538</v></c><c r="D2" s="3"><v>6100.1</v></c><c r="E2" t="s"><v>5</v></c><c r="F2"><v>2</v></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><r><t>Sigma </t></r><r><t>18-35</t></r></is></c><c r="B3"><v>4512345</v></c><c r="C3" s="2"><v>44000</v></c><c r="D3" s="4"><v>0.30000000000000004</v></c><c r="E3" t="e"><v>#N/A</v></c><c r="F3" t="b"><v>1</v></c></row>'
    + '<row r="5"><c t="inlineStr"><is><t>Zoom H6</t></is></c><c><v>7</v></c><c s="1"/></row>'
    + '</sheetData></worksheet>',
  'xl/worksheets/third.xml': XML + '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Lens</x:t></x:is></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Replacement value</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>Zeiss CP.3 35mm</x:t></x:is></x:c><x:c r="C2"><x:v>4390</x:v></x:c></x:row><x:row r="3"><x:c r="A3" t="inlineStr"><x:is><x:t>Zeiss CP.3 85mm</x:t></x:is></x:c><x:c r="C3"><x:v>4390.5</x:v></x:c></x:row></x:sheetData></x:worksheet>',
}, { stored: ['xl/workbook.xml'] });

(async () => {
  const browser = await chromium.launch();
  const errors = [], requests = [], dialogs = [];
  const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); p.on('dialog', d => { dialogs.push(d.message()); d.accept(); }); return p; };
  // A browser of its own: one that has agreed to the terms, skipped the PIN set-up and seen the tour.
  const open = async ({ width = 420, height = 900, init = null, light = false } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms().content);
    if (light) await ctx.addInitScript(() => { localStorage.setItem('logi-prefs', JSON.stringify({ scheme: 'light' })); });
    if (init) await ctx.addInitScript(init);
    ctx.on('request', q => requests.push(q.method() + ' ' + q.url()));
    const page = watch(await ctx.newPage());
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    return { ctx, page };
  };
  const gear = page => page.evaluate(() => import('./js/store.js').then(s => JSON.parse(JSON.stringify(s.db.gear))));
  const seed = (page, list) => page.evaluate(g => import('./js/store.js').then(s => { s.update(d => { d.gear = g; d.kits = []; d.bookings = []; }); }), list);
  const openImport = async page => { await page.evaluate(() => window.logiGo('gear')); await page.locator('#page .subactions button', { hasText: 'Import…' }).click(); await page.waitForSelector('.sheet .gi-choose'); };
  const give = (page, file) => page.setInputFiles('.sheet input.gi-file', file); // a path, or { name, mimeType, buffer }
  const named = (name, text, mimeType = 'text/csv') => ({ name, mimeType, buffer: Buffer.isBuffer(text) ? text : Buffer.from(text) });
  const paste = async (page, text) => { await page.locator('#gi-paste').fill(text); await page.locator('.sheet .gi-use').click(); };
  const previewed = page => page.waitForSelector('.sheet .gi-cols', { timeout: 20000 });
  const refused = async page => { await page.waitForSelector('.sheet .gi-warn:not([hidden])', { timeout: 20000 }); return page.locator('.sheet .gi-warn').innerText(); };
  const columns = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sheet .gi-col')].map(c => [c.querySelector('.gi-head').textContent, c.querySelector('select').value])));
  const setColumn = (page, heading, to) => page.locator('.sheet .gi-col', { has: page.locator('.gi-head', { hasText: new RegExp('^' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).locator('select').selectOption(to);
  const sum = page => page.locator('.sheet .gi-sum').innerText();
  const text = (page, sel) => page.locator(sel).first().innerText().catch(() => '');
  const add = async page => { await page.locator('.sheet .gi-go').click(); await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 30000 }); await sleep(250); };
  const bar = page => text(page, '.undo-bar');
  const byName = (list, name) => list.find(g => g.name === name) || {};
  // The whole way through for one list: Import…, choose it, read what Vdex made of it, add it.
  const run = async (page, file) => {
    await openImport(page); await give(page, file); await previewed(page);
    const out = { cols: await columns(page), sum: await sum(page), source: await text(page, '.sheet .gi-source'), passed: await text(page, '.sheet .gi-passed'), cats: await text(page, '.sheet .gi-cats'), money: await text(page, '.sheet .gi-money'), before: (await gear(page)).length };
    await add(page); out.bar = await bar(page); out.gear = await gear(page);
    return out;
  };

  /* ============================== the way in ============================== */
  const A = await open();
  await A.page.evaluate(() => window.logiGo('gear')); await A.page.waitForSelector('#page .empty');
  ok('an empty Equipment page offers to import a list, beside adding the first item', (await A.page.locator('#page .empty button').allInnerTexts()).join('|') === 'Add first item|📥 Import a list you already have');
  const loadedBefore = await A.page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /gear-import-ui|table-read|gear-columns/.test(n)).length);
  await A.page.evaluate(() => import('./js/store.js').then(s => s.loadSample())); await sleep(200);
  ok('Import… sits beside the asset register export', (await A.page.locator('#page .subactions button').allInnerTexts()).slice(0, 2).join('|') === '🧾 Asset register (CSV)|📥 Import…');
  await A.page.locator('#page .subactions button', { hasText: 'Import…' }).click(); await A.page.waitForSelector('.sheet .gi-choose'); await sleep(150);
  const loadedAfter = await A.page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /gear-import-ui|table-read|gear-columns/.test(n)).length);
  ok('the import code is fetched on first use, not at start-up', loadedBefore === 0 && loadedAfter === 3, `${loadedBefore} → ${loadedAfter}`);
  const start = await A.page.evaluate(() => { const s = document.querySelector('.sheet'), b = s.querySelector('.gi-choose'), f = s.querySelector('input.gi-file'); return { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), choose: b.tagName, focused: document.activeElement === b, accept: f.accept, text: s.innerText, pasteLabel: !!s.querySelector('label[for="gi-paste"]') }; });
  ok('the sheet is a labelled dialog; choosing a file is a real button that takes the focus; the paste box has a label', start.role === 'dialog' && start.label === 'Import equipment' && start.choose === 'BUTTON' && start.focused && start.pasteLabel, JSON.stringify({ ...start, text: undefined }));
  ok('it says what it takes, that nothing is added before it is checked, and that nothing leaves the device', /CSV or Excel \(\.xlsx\)/.test(start.text) && /asset register/.test(start.text) && /before anything is added/.test(start.text) && /Nothing is sent anywhere/.test(start.text) && /\.csv/.test(start.accept) && /\.xlsx/.test(start.accept));
  await A.page.keyboard.press('Escape'); await sleep(250);
  ok('Escape closes it and the focus goes back to Import…', (await A.page.locator('.sheet').count()) === 0 && await A.page.evaluate(() => (document.activeElement.dataset || {}).fk === 'gear-import'));

  /* ============================== Vdex's own asset register, there and back ============================== */
  await A.page.evaluate(() => import('./js/store.js').then(s => s.update(d => {
    d.profile = { ...d.profile, currency: '£', business: 'Quay Films', updatedAt: Date.now() };
    Object.assign(d.gear[0], { serial: 'FX6-120934', location: 'Flight case 1', value: 6000.5, purchased: '2024-03-01', warranty: '2027-03-01', firmware: '5.01', notes: 'Cage, "top handle"\nand a spare plate', log: [{ id: 'l1', date: '2026-01-10', kind: 'service', note: 'sensor', cost: 80 }, { id: 'l2', date: '2026-03-02', kind: 'repair', note: 'not a service' }] });
    Object.assign(d.gear[4], { qty: 4, value: 125 });
    d.gear.push({ id: 'odd1', name: '=SUM(1+1)*cmd|x', category: 'Teleprompters', serial: '+44-7700', location: '@home', qty: 2, value: '', notes: '-not a formula', updatedAt: 1 });
    // categories of one's own that Vdex would otherwise file under its own (Power, Grip), and an item that happens to be called Total
    d.gear.push({ id: 'odd2', name: 'V-mount 98Wh', category: 'Batteries', serial: '', location: 'Flight case 2', qty: 6, value: 220, notes: '', updatedAt: 1 }, { id: 'odd3', name: 'Total', category: 'Stands', serial: '', location: '', qty: 2, value: 50, notes: '', updatedAt: 1 });
  })));
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
  const register = fs.readFileSync(await dl.path(), 'utf8'), regLines = register.replace(/^\uFEFF/, '').split('\r\n');
  const mine = await gear(A.page);
  ok('the register writes text that starts like a formula so that a spreadsheet will not run it', /"'=SUM\(1\+1\)\*cmd\|x"/.test(register) && /"'\+44-7700"/.test(register) && /"'@home"/.test(register) && /"'-not a formula"/.test(register));

  const B = await open(); // someone else's empty Vdex
  await B.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.profile = { ...d.profile, currency: '£', business: 'Quay Films', updatedAt: Date.now() }; })));
  await openImport(B.page); await give(B.page, named('vdex-asset-register-2026-11-18.csv', Buffer.from(register)));
  await previewed(B.page);
  const regCols = await columns(B.page);
  ok('every column of the register is recognised, and its Total column is left out', same(regCols, { Item: 'name', Category: 'category', 'Serial number': 'serial', Where: 'location', Quantity: 'qty', 'Value each (£)': 'value', 'Total (£)': '', Purchased: 'purchased', 'Warranty until': 'warranty', Firmware: 'firmware', 'Last service': 'lastService', Notes: 'notes' }), JSON.stringify(regCols));
  ok('the summary counts every item, and the register’s total line is passed over', (await sum(B.page)) === `Adds ${mine.length}.` && /1 total row/.test(await text(B.page, '.sheet .gi-passed')), (await sum(B.page)) + ' ' + await text(B.page, '.sheet .gi-passed'));
  ok('nothing is added while the list is only being looked at, and nothing is said about currency when the list’s is this Vdex’s', (await gear(B.page)).length === 0 && (await B.page.locator('.sheet .gi-money').count()) === 0);
  const regCats = await text(B.page, '.sheet .gi-cats');
  await add(B.page);
  const theirs = await gear(B.page);
  ok('the register’s categories come back as they were written, also where Vdex knows the word (Batteries, Stands), and an item called “Total” comes back as an item', byName(theirs, 'V-mount 98Wh').category === 'Batteries' && byName(theirs, 'Total').category === 'Stands' && byName(theirs, 'Total').qty === 2 && byName(theirs, 'Total').value === 50 && !/becomes/.test(regCats) && /Kept as typed: /.test(regCats) && /Batteries/.test(regCats) && /Stands/.test(regCats), regCats + ' ' + JSON.stringify([byName(theirs, 'V-mount 98Wh'), byName(theirs, 'Total')]));
  const carried = g => ({ name: g.name, category: g.category || '', serial: g.serial || '', location: g.location || '', qty: Math.max(1, Number(g.qty) || 1), value: Number(g.value) || 0, purchased: g.purchased || '', warranty: g.warranty || '', firmware: g.firmware || '', notes: (g.notes || '').replace(/\r?\n/g, ' '), lastService: (g.log || []).filter(e => ['service', 'clean', 'calibration', 'check'].includes(e.kind) && e.date).map(e => e.date).sort().pop() || '' });
  const sorted = list => list.map(carried).sort((a, b) => a.name.localeCompare(b.name));
  ok('importing the register gives back every item with everything the register carries', theirs.length === mine.length && same(sorted(theirs), sorted(mine)), JSON.stringify(sorted(theirs).filter((x, i) => !same(x, sorted(mine)[i]))).slice(0, 400));
  const fx6 = byName(theirs, 'Sony FX6 body'), odd = byName(theirs, '=SUM(1+1)*cmd|x');
  ok('…the last service as a line in the service log, a formula-like name as the text it was, values as numbers', (fx6.log || []).length === 1 && fx6.log[0].date === '2026-01-10' && fx6.log[0].kind === 'service' && fx6.value === 6000.5 && fx6.qty === 1 && odd.serial === '+44-7700' && odd.location === '@home' && odd.notes === '-not a formula' && odd.qty === 2, JSON.stringify([fx6.log, odd]));
  await A.page.bringToFront();
  const [dl2] = await Promise.all([B.page.waitForEvent('download'), B.page.getByRole('button', { name: 'Asset register (CSV)' }).click()]);
  const again = fs.readFileSync(await dl2.path(), 'utf8').replace(/^\uFEFF/, '').split('\r\n');
  ok('the register exported from the copy is line for line the register it was made from', again.length === regLines.length && again.length === mine.length + 2 && same(again, regLines), again.find((l, i) => l !== regLines[i]) || '');
  await B.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  await openImport(B.page); await give(B.page, named('register-again.csv', Buffer.from(register))); await previewed(B.page);
  ok('importing the same register again adds nothing: every item is found, by serial number or by name', (await sum(B.page)) === `Adds 0, skips ${mine.length}.` && await B.page.locator('.sheet .gi-go').isDisabled(), await sum(B.page));
  await B.page.keyboard.press('Escape'); await sleep(200);
  await B.ctx.close();

  /* ============================== the sample files ============================== */
  const C = await open();
  // a kit app's export in the layout Sortly documents
  let r = await run(C.page, path.join(FIX, 'gear-kit-app-sortly-style.csv'));
  ok('kit app export (Sortly’s layout): the name, quantity, price of one, notes, folder, sub-folder and the custom fields are recognised; the rest is skipped',
    same(r.cols, { 'Entry Name': 'name', 'Entry Type': '', Quantity: 'qty', 'Min Level': '', Price: 'value', Value: '', Unit: '', Notes: 'notes', Tags: '', 'Barcode/QR1-Data': '', 'Barcode/QR1-Type': '', 'Sortly ID (SID)': '', 'Primary Folder': 'category', 'Subfolder-level1': 'location', 'Photo URLs': '', 'Serial Number': 'serial', 'Purchase Date': 'purchased' }), JSON.stringify(r.cols));
  const mc = byName(r.gear, 'Aputure MC RGB pocket light'), tp = byName(r.gear, 'Ikan PT4500 teleprompter'), fx = byName(r.gear, 'Sony FX6 body');
  ok('…11 items, its folders passed over, “Mics” as Audio, a category Vdex does not know kept as typed, the price of one rather than of the lot',
    r.sum === 'Adds 11.' && r.gear.length === 11 && /2 headings/.test(r.passed) && byName(r.gear, 'Sennheiser MKH 416').category === 'Audio' && tp.category === 'Teleprompters' && !tp.purchased && mc.qty === 4 && mc.value === 125 && mc.category === 'Lighting' && mc.location === 'Lighting bag' && mc.purchased === '2024-01-20' && byName(r.gear, 'V-mount battery 98Wh').category === 'Power' && fx.value === 6000 && fx.serial === 'FX6-120934' && fx.notes === 'Cage and top handle fitted. "A cam"', r.sum + ' ' + r.passed + ' ' + JSON.stringify([mc, tp]));
  ok('…and it says which categories it changed and which it kept', /“Mics” becomes Audio/.test(r.cats) && /“Lights” becomes Lighting/.test(r.cats) && /Kept as typed: Teleprompters/.test(r.cats) && r.bar.startsWith('11 added'), r.cats + ' | ' + r.bar);
  // another kit app's export in the layout Cheqroom documents
  await seed(C.page, []);
  r = await run(C.page, path.join(FIX, 'gear-kit-app-cheqroom-style.csv'));
  ok('kit app export (Cheqroom’s layout): brand and model join the name, the price paid is the value when there is no other, the written-down value and the codes are skipped',
    same(r.cols, { Name: 'name', Category: 'category', Location: 'location', Kind: '', Brand: 'make', Model: 'model', 'Serial Number': 'serial', 'Purchase Price': 'value', 'Purchase Date': 'purchased', 'Warranty Date': 'warranty', 'Residual Value': '', Barcode: '', 'Kit Name': '', Flag: '' }), JSON.stringify(r.cols));
  const acam = byName(r.gear, 'Sony FX6 A-cam');
  ok('…7 items, month-first dates read as such, a name that already holds its make and model left alone',
    r.sum === 'Adds 7.' && r.gear.length === 7 && acam.purchased === '2023-03-14' && acam.warranty === '2026-03-14' && acam.value === 5999 && acam.category === 'Camera' && acam.location === 'Studio' && !!byName(r.gear, 'Sony FE 24-70mm f/2.8 GM II').serial && byName(r.gear, 'Sachtler Flowtech 75 Sticks').category === 'Support' && byName(r.gear, 'Sennheiser MKH 416 Shotgun mic').category === 'Audio', r.sum + ' ' + JSON.stringify(r.gear.map(g => g.name)));
  // a rental house's order: semicolons, decimal commas, lines above the table, group headings, a total, Windows-1252
  ok('(the rental house sample is still in its Windows encoding, not re-saved as UTF-8)', !require('buffer').isUtf8(fs.readFileSync(path.join(FIX, 'gear-rental-house-order.csv'))));
  await seed(C.page, []);
  r = await run(C.page, path.join(FIX, 'gear-rental-house-order.csv'));
  ok('rental house order: the table is found under its opening lines, and the daily rate and line total are not taken for the value',
    same(r.cols, { Pos: '', Qty: 'qty', Article: 'name', 'Serial No.': 'serial', 'Daily rate': '', 'Replacement value': 'value', Total: '' }) && /12 rows under the headings/.test(r.source), JSON.stringify(r.cols) + r.source);
  const fx9 = byName(r.gear, 'Sony PXW-FX9 body'), bat = byName(r.gear, 'Sony BP-U70 battery'), sd = r.gear.find(g => /^Sound Devices 833/.test(g.name)) || {};
  ok('…decimal commas and points for thousands are read right (11.499,00 € is 11499; 265,50 € is 265.5)', fx9.value === 11499 && bat.value === 265.5 && bat.qty === 4 && byName(r.gear, 'ARRI SkyPanel S60-C').value === 5200, JSON.stringify([fx9.value, bat.value]));
  ok('…and since its values are in another currency than this Vdex shows, it says the numbers are kept as they are', /The values in this list are in €\. Vdex keeps the numbers as they are and shows them with your own currency sign \(\$\): nothing is converted\./.test(r.money), r.money);
  ok('…7 items; its group headings give the categories; the total is passed over; “n/a” is no serial number; the Windows text comes out right',
    r.sum === 'Adds 7.' && r.gear.length === 7 && /1 total row/.test(r.passed) && /4 headings/.test(r.passed) && fx9.category === 'Camera' && byName(r.gear, 'Zeiss CP.3 35mm T2.1').category === 'Lens' && sd.category === 'Audio' && sd.name === 'Sound Devices 833 – 8 track mixer/recorder' && byName(r.gear, 'Sanken COS-11D lavalier').serial === '' && byName(r.gear, 'Zeiss CP.3 35mm T2.1').serial === '51234567', r.sum + ' ' + r.passed + ' ' + sd.name);
  ok('…and the headings it passed over are named, each with its row, so a line wrongly taken for one can be seen', /4 headings \(row 5 “CAMERA”, row 8 “LENSES”, row 11 “LIGHTING”, row 13 “SOUND”\)/.test(r.passed), r.passed);
  // an insurer's schedule as .xlsx (written by openpyxl: inline strings, real date cells, a formula with no saved result)
  await seed(C.page, []);
  await openImport(C.page); await give(C.page, path.join(FIX, 'gear-insurer-schedule.xlsx')); await previewed(C.page);
  const sheets = await C.page.locator('.sheet .gi-pick select option').allInnerTexts();
  ok('insurer schedule (.xlsx): its sheets are offered, the first one shown', sheets.length === 2 && /^Schedule \(/.test(sheets[0]) && /^Cover \(/.test(sheets[1]) && (await C.page.locator('.sheet .gi-pick select').inputValue()) === '0', sheets.join('|'));
  const insCols = await columns(C.page);
  ok('…the headings are found under the title block; description, make and model make the name', same(insCols, { 'Item No': '', Description: 'name', Make: 'make', Model: 'model', 'Serial Number': 'serial', 'Date Purchased': 'purchased', 'Replacement Value': 'value', 'Owned / Hired': '' }), JSON.stringify(insCols));
  const insSum = await sum(C.page), insPassed = await text(C.page, '.sheet .gi-passed');
  await add(C.page);
  let g = await gear(C.page);
  const cam = byName(g, 'Sony FX6 Cinema camera body'), sig = byName(g, 'Sigma 18-35mm f/1.8 Art');
  ok('…6 items; date cells become dates, a serial number kept as a number becomes text, group headings give categories, the total is passed over',
    insSum === 'Adds 6.' && g.length === 6 && /1 total row/.test(insPassed) && /4 headings/.test(insPassed) && cam.purchased === '2023-03-14' && cam.value === 6100 && cam.serial === 'FX6-120934' && cam.category === 'Camera' && byName(g, 'Sony A7S III Mirrorless camera body').value === 3650.5 && sig.serial === '4512345' && sig.purchased === '2019-07-01' && sig.category === 'Lens' && byName(g, 'Sennheiser MKH 416 Shotgun microphone').category === 'Audio' && byName(g, 'DJI Mavic 3 Pro Drone with controller').category === 'Drone', insSum + ' ' + insPassed + ' ' + JSON.stringify([cam, sig]));
  // a home-inventory style template as .xlsx (written by LibreOffice: shared strings, dates under a custom format)
  await seed(C.page, []);
  r = await run(C.page, path.join(FIX, 'gear-spreadsheet-template.xlsx'));
  const fx3 = byName(r.gear, 'Sony FX3 Main camera');
  ok('spreadsheet template (.xlsx): what it is worth now is the value, not what was paid; where it was bought is skipped; the room is where it is',
    same(r.cols, { 'Item description': 'name', 'Make/Model': 'model', 'Serial number/ID': 'serial', 'Date purchased': 'purchased', 'Where purchased': '', 'Purchase price': '', 'Estimated current value': 'value', Room: 'location', Notes: 'notes' }) && r.sum === 'Adds 7.' && r.gear.length === 7 && fx3.value === 3200 && fx3.purchased === '2023-09-12' && fx3.location === 'Office' && fx3.serial === 'FX3-5567120' && fx3.notes === 'Cage, top handle and XLR unit' && byName(r.gear, 'Sigma 24-70mm f/2.8 DG DN Art Standard zoom').serial === '56120044', JSON.stringify(r.cols) + r.sum + JSON.stringify(fx3));

  /* ============================== a workbook built here, for the corners of the format ============================== */
  const odd2 = await C.page.evaluate(async b64 => {
    const T = await import('./js/table-read.js');
    const t = await T.readTableFile(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'odd.xlsx'));
    return t.sheets.map(s => ({ name: s.name, hidden: s.hidden, rows: s.rows }));
  }, ODD_XLSX.toString('base64'));
  const kit = (odd2[1] || {}).rows || [];
  ok('.xlsx: every sheet is read by its name, hidden or not, at a relative or an absolute path, with or without a tag prefix', odd2.length === 3 && odd2[0].name === 'Old list' && odd2[0].hidden === true && odd2[1].name === 'Kit & cases' && odd2[1].hidden === false && odd2[2].name === 'Lenses' && same(odd2[2].rows, [{ n: 1, cells: ['Lens', '', 'Replacement value'] }, { n: 2, cells: ['Zeiss CP.3 35mm', '', '4390'], nums: [2] }, { n: 3, cells: ['Zeiss CP.3 85mm', '', '4390.5'], nums: [2] }]), JSON.stringify(odd2[2]));
  ok('.xlsx: shared strings (in runs, with an entity, without the phonetic guide, with Excel’s own line break), a formula’s saved result, an inline string', same(kit[0], { n: 1, cells: ['Item', 'Serial number', 'Bought', 'Value', 'Notes', 'Quantity'] }) && kit[1].cells[0] === 'Sony FX6 & cage' && kit[1].cells[1] === 'FX6-1' && kit[1].cells[4] === 'Line one\r\nline <two>' && kit[2].cells[0] === 'Sigma 18-35', JSON.stringify(kit.slice(0, 3)));
  ok('.xlsx: day numbers under a built-in or a custom date format become dates (counted from 1904 here); other numbers stay numbers, tidied', kit[1].cells[2] === '2023-03-15' && kit[2].cells[2] === '2024-06-19' && kit[1].cells[3] === '6100.1' && kit[2].cells[3] === '0.3' && kit[2].cells[1] === '4512345', JSON.stringify([kit[1].cells, kit[2].cells]));
  ok('.xlsx: an error is an empty cell, a boolean is a word, a skipped row keeps the numbering, cells with no reference fall in order', kit[2].cells[4] === '' && kit[2].cells[5] === 'TRUE' && kit.length === 4 && same(kit[3], { n: 5, cells: ['Zoom H6', '7'], nums: [1] }), JSON.stringify(kit.slice(2)));
  // the Word reader shares the zip code that was widened for this: it still reads a document, and still says what is wrong
  const docx = await C.page.evaluate(async ([good, stored]) => {
    const D = await import('./js/docx.js'), file = b64 => new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'script.docx');
    const lines = async b64 => (await D.docxToLines(file(b64))).map(l => l.text), why = async f => { try { await D.docxToLines(f); return ''; } catch (e) { return e.message; } };
    return { good: await lines(good), stored: await lines(stored), notZip: await why(new File(['plain text, not a zip at all, long enough to look for a directory in'], 'x.docx')), noText: await why(file(btoa('PK\u0005\u0006' + '\u0000'.repeat(18)))) };
  }, [zip({ 'word/document.xml': XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>INT. TAPROOM - DAY</w:t></w:r></w:p><w:p><w:r><w:t>Steam rises.</w:t></w:r></w:p></w:body></w:document>' }).toString('base64'), zip({ 'word/document.xml': XML + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Stored, not squeezed</w:t></w:r></w:p></w:body></w:document>' }, { stored: ['word/document.xml'] }).toString('base64')]);
  ok('the Word (.docx) reader, which shares the zip code with this, reads as before and gives the same reasons when it cannot', same(docx.good, ['INT. TAPROOM - DAY', 'Steam rises.']) && same(docx.stored, ['Stored, not squeezed']) && docx.notZip === 'Not a .docx file' && docx.noText === 'No document text found in this file', JSON.stringify(docx));
  await seed(C.page, []);
  await openImport(C.page); await give(C.page, named('odd.xlsx', ODD_XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')); await previewed(C.page);
  const pick = C.page.locator('.sheet .gi-pick select');
  ok('the first sheet that is not hidden is shown, and the others can be chosen', (await pick.inputValue()) === '1' && (await pick.locator('option').allInnerTexts()).join('|') === 'Old list (2 rows)|Kit & cases (4 rows)|Lenses (3 rows)' && (await sum(C.page)) === 'Adds 3.', await sum(C.page));
  ok('…a quantity that is not a number is said, by row, before anything is added', /row 3: “TRUE” is not a quantity, so 1 is used/i.test(await text(C.page, '.sheet .gi-problems')), await text(C.page, '.sheet .gi-problems'));
  await pick.selectOption('2'); await sleep(200);
  ok('choosing another sheet shows that sheet’s columns and items, and keeps the focus on the chooser', same(await columns(C.page), { Lens: 'name', 'Replacement value': 'value' }) && (await sum(C.page)) === 'Adds 2.' && await C.page.evaluate(() => document.activeElement && document.activeElement.closest('.gi-pick') !== null), JSON.stringify(await columns(C.page)) + await sum(C.page));
  await add(C.page);
  g = await gear(C.page);
  ok('…and only that sheet is added', g.length === 2 && byName(g, 'Zeiss CP.3 85mm').value === 4390.5);

  /* ============================== pasted text, each shape ============================== */
  await seed(C.page, []);
  await C.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  // rows copied out of a spreadsheet arrive separated by tabs
  await openImport(C.page); await paste(C.page, 'Name\tSerial No\tQty\tReplacement Value\tStored\nSony FX6, body only\tFX6-1\t1\t£6,000.00\tVan\nAputure MC\t\t4\t£125.00\tLighting bag\n'); await previewed(C.page);
  ok('pasted from a spreadsheet (tabs): headings, a comma inside a cell, money with a sign and a thousands comma', same(await columns(C.page), { Name: 'name', 'Serial No': 'serial', Qty: 'qty', 'Replacement Value': 'value', Stored: 'location' }) && (await sum(C.page)) === 'Adds 2.' && /the pasted text: 2 rows under the headings/.test(await text(C.page, '.sheet .gi-source')), JSON.stringify(await columns(C.page)));
  await add(C.page); g = await gear(C.page);
  ok('…and the items come out whole', g.length === 2 && byName(g, 'Sony FX6, body only').value === 6000 && byName(g, 'Sony FX6, body only').location === 'Van' && byName(g, 'Aputure MC').qty === 4 && byName(g, 'Aputure MC').value === 125 && !byName(g, 'Aputure MC').serial);
  // a list, one item on each line
  await seed(C.page, []);
  await openImport(C.page); await paste(C.page, 'Kit list:\n- 2x Aputure 600d\n• Sony FX6 (S/N 4512345)\nSachtler Flowtech 75 x 2\n4x5 camera\n\nLenses:\n1. Sigma 18-35mm f/1.8\n'); await previewed(C.page);
  ok('pasted list, one item on each line: it is read as a list, with a quantity and a serial number where the lines have them', same(await columns(C.page), { Item: 'name', Quantity: 'qty', 'Serial number': 'serial' }) && (await sum(C.page)) === 'Adds 5.' && (await C.page.locator('.sheet .gi-header').count()) === 0 && /2 headings/.test(await text(C.page, '.sheet .gi-passed')) && /7 lines/.test(await text(C.page, '.sheet .gi-source')), JSON.stringify(await columns(C.page)) + await sum(C.page) + await text(C.page, '.sheet .gi-source'));
  ok('…and the two headings are named by their lines', (await text(C.page, '.sheet .gi-passed')) === 'Not items, so passed over: 2 headings (line 1 “Kit list”, line 7 “Lenses”).', await text(C.page, '.sheet .gi-passed'));
  await add(C.page); g = await gear(C.page);
  ok('…bullets and numbering go, “2x” and “x 2” are quantities, “4x5 camera” is a name, a serial number named as one is kept, “Lenses:” heads the lines under it',
    g.length === 5 && byName(g, 'Aputure 600d').qty === 2 && byName(g, 'Sony FX6').serial === '4512345' && byName(g, 'Sachtler Flowtech 75').qty === 2 && byName(g, '4x5 camera').qty === 1 && byName(g, 'Sigma 18-35mm f/1.8').category === 'Lens' && !byName(g, 'Aputure 600d').category, JSON.stringify(g.map(x => [x.name, x.qty, x.serial, x.category])));
  // the parser itself: quotes, line ends, the byte-order mark, separators
  const parsed = await C.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), rows = async (t, s) => (await T.parseSeparated(t, s)).rows.map(x => x.cells);
    return {
      quoted: await rows('\uFEFFItem,Notes\r\n"Sony FX6, body","Has a ""cage""\nand a plate"\r\n\r\n  Zoom H6 ,  plain  \r\n"",""\r\nlast,"no line end"'),
      numbered: (await T.parseSeparated('a,b\n\n\n"x\ny",2\nz,3')).rows.map(x => x.n),
      mac: await rows('a;b\rc;d\r'), mid: await rows('5" monitor,7\n'),
      wide: (await rows('a' + ','.repeat(500000) + 'z\nb,c\n', ',')).map(r => r.length), longCell: (await rows('"' + 'x'.repeat(300000) + '",ok\n', ','))[0].map(c => c.length),
      sniff: [T.sniffSeparator('a;b;c\n1,5;2;3\n4,5;5;6'), T.sniffSeparator('a\tb\n1\t2'), T.sniffSeparator('a,b\n1,2'), T.sniffSeparator('one\ntwo, three\nfour'), T.sniffSeparator('a|b|c\n1|2|3')],
      utf16: (await T.readTableFile(new File([new Uint8Array([0xFF, 0xFE, ...[...'Item\tQty\nMic\t2\n'].flatMap(c => [c.charCodeAt(0), 0])])], 'unicode.txt'))).sheets[0].rows.map(x => x.cells),
    };
  });
  ok('CSV: quoted cells with commas, line breaks and doubled quotes; a byte-order mark; Windows, Unix and old Mac line ends; blank and empty lines dropped; a last line with no line end', same(parsed.quoted, [['Item', 'Notes'], ['Sony FX6, body', 'Has a "cage"\nand a plate'], ['Zoom H6', 'plain'], ['last', 'no line end']]) && same(parsed.mac, [['a', 'b'], ['c', 'd']]) && same(parsed.mid, [['5" monitor', '7']]), JSON.stringify(parsed));
  ok('CSV: a line of half a million separators is 60 cells, and a cell of 300,000 characters is 2,000', same(parsed.wide, [60, 2]) && same(parsed.longCell, [2000, 2]), JSON.stringify([parsed.wide, parsed.longCell]));
  ok('CSV: rows keep the number they have in the file, whatever was dropped above them', same(parsed.numbered, [1, 4, 5]), JSON.stringify(parsed.numbered));
  ok('CSV: the separator is worked out (semicolon despite decimal commas, tab, comma, bar; none for a plain list), and Excel’s “Unicode text” is read', same(parsed.sniff, [';', '\t', ',', '', '|']) && same(parsed.utf16, [['Item', 'Qty'], ['Mic', '2']]), JSON.stringify([parsed.sniff, parsed.utf16]));
  // semicolons, decimal commas and another language's headings
  await seed(C.page, []);
  await openImport(C.page); await paste(C.page, 'Bezeichnung;Kategorie;Seriennummer;Anzahl;Neuwert;Kaufdatum\nSony FX6;Kamera;FX6-1;1;6.100,00 €;14.03.2023\nSennheiser MKH 416;Ton;MKH-2;2;1.050,50 €;30.06.2021\nStativ;Stative;;1;1.299;01.02.2024\n'); await previewed(C.page);
  const deCols = await columns(C.page); await add(C.page); g = await gear(C.page);
  ok('pasted with semicolons, decimal commas and German headings: columns, categories, values and day-first dates are right', same(deCols, { Bezeichnung: 'name', Kategorie: 'category', Seriennummer: 'serial', Anzahl: 'qty', Neuwert: 'value', Kaufdatum: 'purchased' }) && g.length === 3 && byName(g, 'Sony FX6').value === 6100 && byName(g, 'Sony FX6').category === 'Camera' && byName(g, 'Sony FX6').purchased === '2023-03-14' && byName(g, 'Sennheiser MKH 416').value === 1050.5 && byName(g, 'Sennheiser MKH 416').category === 'Audio' && byName(g, 'Sennheiser MKH 416').qty === 2 && byName(g, 'Stativ').value === 1299 && byName(g, 'Stativ').category === 'Support', JSON.stringify(deCols) + JSON.stringify(g.map(x => [x.name, x.value, x.category, x.purchased])));

  /* ============================== values, dates and categories, one by one ============================== */
  const unit = await C.page.evaluate(async () => {
    const G = await import('./js/gear-columns.js'), T = await import('./js/table-read.js');
    return {
      money: ['£1,299.00', '1.299,00 €', '1 299', "1'299.50", 'USD 450', '450,-', '12,50', '1,299', '0,125', '$6,000', 'US$ 450', '450 kr', '1.299.000', '(250)', '75 each'].map(x => G.parseAmount(x)),
      nothing: ['n/a', 'N/A', '-', '—', 'none', 'unknown', 'TBC', '', '?'].map(x => G.parseAmount(x)),
      notMoney: ['abc', '=1+1', 'FX6', 'A7', '12 months', '1,2,3,4x'].map(x => Number.isNaN(G.parseAmount(x))),
      dots: [G.parseAmount('1.299'), G.parseAmount('1.299', { dotThousands: true }), G.numberStyle(['1.299', '2.500', '800']).dotThousands, G.numberStyle(['1.299,00', '12,50']).dotThousands, G.numberStyle(['1299.50', '800']).dotThousands, G.numberStyle(['1,299', '2,500.75']).dotThousands, G.numberStyle(['0.125', '1.250']).dotThousands],
      dmy: ['2024-03-01', '01/03/2024', '1.3.2024', '1 Mar 2024', '1-Mar-24', 'March 1, 2024', 'Mar 2024', '45352', '2024-03-01T10:00:00Z', '31/12/2023', '03/04/24'].map(x => G.parseDate(x, 'dmy')),
      mdy: ['01/03/2024', '12/31/2023', '31/12/2023', '03/04/24'].map(x => G.parseDate(x, 'mdy')),
      badDate: ['soon', '13/13/2024', '30/02/2024', '2024-13-01', '99999'].map(x => G.parseDate(x)),
      order: [G.dateOrder(['03/14/2023', '01/02/2024']), G.dateOrder(['14/03/2023', '01/02/2024']), G.dateOrder(['14.03.2023'])],
      qty: ['', '3', 'x2', '2 pcs', '4.0', '0', 'two', '2.5', 'n/a', '100000'].map(x => G.parseQty(x).n), qtyNote: ['3', '0', 'two', '2.5'].map(x => !!G.parseQty(x).note),
      months: ['12', '12 months', '6 mo', '1 year', '2 yrs', 'annually', 'n/a', 'whenever'].map(x => G.parseMonths(x)),
      cats: ['Mics', 'Microphones', 'Tripods & Heads', 'Cameras/Bodies', 'Video > Lenses', 'LENSES', 'Batteries and chargers', 'lighting', 'Camera Accessories', 'Drones', 'Monitors', 'Memory cards', 'C-stands', 'Misc', 'n/a', 'Cameras & Lenses', 'Teleprompters'].map(x => G.mapCategory(x).to),
      own: [G.mapCategory('lens filters', ['Lens Filters', 'Camera']).to, G.mapCategory('mics', ['Mics']).to, G.mapCategory('CAMERA', ['Camera']).to],
      // headings other tools document: EZOfficeInventory's data dictionary, Rentman's equipment export, an insurer's schedule
      heads: Object.fromEntries(['Asset #', 'Name', 'Description', 'Group', 'Subgroup', 'Location Name', 'Product Model Number', 'Purchased On', 'Cost Price', 'Vendor', 'Asset Identification Number', 'Retire (yes/no)', 'Code', 'Type of Equipment', 'Rental/Sales', 'Rental price', 'Current quantity', 'Serial number (Serial number)', 'Est. replacement value', 'Camera serial no.', 'Date of last service', 'Sum insured', 'Total replacement value', 'Hire rate per day', 'Kit Name', 'Favourite colour'].map(x => [x, (G.headingKind(x) || {}).kind || null])),
      serial: [T.serialToISO(44999), T.serialToISO(43538, true), T.serialToISO(60), T.serialToISO(0), T.serialToISO('x')],
    };
  });
  ok('values: currency signs and codes, thousands separators, decimal commas, apostrophes and spaces', same(unit.money, [1299, 1299, 1299, 1299.5, 450, 450, 12.5, 1299, 0.125, 6000, 450, 450, 1299000, 250, 75]), JSON.stringify(unit.money));
  ok('values: words for nothing are nothing, and text is not a number (a formula is text; a model name is not money)', unit.nothing.every(x => x === '') && unit.notMoney.every(Boolean), JSON.stringify([unit.nothing, unit.notMoney]));
  ok('values: a point before three digits is a decimal point, unless the column writes thousands that way', same(unit.dots, [1.299, 1299, true, true, false, false, false]), JSON.stringify(unit.dots));
  ok('dates: ISO, slashes, points, month names, a month and a year, a spreadsheet’s day number; two-digit years; day first or month first as the column shows', same(unit.dmy, ['2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01', '2023-12-31', '2024-04-03']) && same(unit.mdy, ['2024-01-03', '2023-12-31', null, '2024-03-04']) && unit.badDate.every(x => x === null) && same(unit.order.slice(0, 2), ['mdy', 'dmy']), JSON.stringify([unit.dmy, unit.mdy, unit.badDate, unit.order]));
  ok('quantities default to 1; odd ones are put right and said', same(unit.qty, [1, 3, 2, 2, 4, 1, 1, 2, 1, 9999]) && same(unit.qtyNote, [false, true, true, true]), JSON.stringify([unit.qty, unit.qtyNote]));
  ok('service intervals: months, years and words', same(unit.months, [12, 12, 6, 12, 24, 12, '', null]), JSON.stringify(unit.months));
  ok('categories: Vdex’s own where recognised (“Mics” is Audio), the last step of a path, otherwise as typed', same(unit.cats, ['Audio', 'Audio', 'Support', 'Camera', 'Lens', 'Lens', 'Power', 'Lighting', 'Accessories', 'Drone', 'Monitoring', 'Media', 'Grip', 'Other', '', 'Cameras & Lenses', 'Teleprompters']), JSON.stringify(unit.cats));
  ok('categories: one the person already uses keeps their spelling, and wins over Vdex’s', same(unit.own, ['Lens Filters', 'Mics', 'Camera']), JSON.stringify(unit.own));
  ok('headings other tools document are known (EZOfficeInventory, Rentman, an insurer’s schedule), and an unknown one is left to what is in the column',
    same(unit.heads, { 'Asset #': 'skip', Name: 'name', Description: 'name', Group: 'category', Subgroup: 'skip', 'Location Name': 'location', 'Product Model Number': 'model', 'Purchased On': 'purchased', 'Cost Price': 'value', Vendor: 'skip', 'Asset Identification Number': 'serial', 'Retire (yes/no)': 'skip', Code: 'skip', 'Type of Equipment': 'category', 'Rental/Sales': 'skip', 'Rental price': 'skip', 'Current quantity': 'qty', 'Serial number (Serial number)': 'serial', 'Est. replacement value': 'value', 'Camera serial no.': 'serial', 'Date of last service': 'lastService', 'Sum insured': 'value', 'Total replacement value': 'total', 'Hire rate per day': 'skip', 'Kit Name': 'skip', 'Favourite colour': null }), JSON.stringify(unit.heads));
  ok('a spreadsheet’s day number is the date it shows (1900 and 1904 counts)', same(unit.serial, ['2023-03-14', '2023-03-15', '1900-02-28', '', '']), JSON.stringify(unit.serial));

  /* ============================== no headings, and correcting a column ============================== */
  await seed(C.page, []);
  await openImport(C.page); await paste(C.page, 'Sony FX6,FX6-0001,Cameras,Van,"$6,000.00"\nSigma 18-35,SIG-0002,Lenses,Shelf A,$800.00\nZoom H6,H6-00003,Mics,Shelf A,$300.00\nAputure 600d,AP-00004,Lights,Van,"$1,900.00"\n'); await previewed(C.page);
  const bare = await columns(C.page);
  ok('a list with no headings: Vdex says so, names the columns by letter, and tells them apart by what is in them (words, codes, kinds of kit, money)', (await C.page.locator('.sheet .gi-header input').isChecked()) === false && same(bare, { 'Column A': 'name', 'Column B': 'serial', 'Column C': 'category', 'Column D': '', 'Column E': 'value' }) && (await sum(C.page)) === 'Adds 4.', JSON.stringify(bare) + await sum(C.page));
  ok('…the first line is an item, not a heading', /Sony FX6/.test(await text(C.page, '.sheet .gi-sample')) && !/📍/.test(await text(C.page, '.sheet .gi-sample')));
  const titled = await C.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js');
    const t = await T.readTableText('Kit list for the insurer 2026,,,\nSony FX6,FX6-0001,Cameras,6000\nZoom H6,H6-00003,Mics,300\nSigma 18-35,SIG-0002,Lenses,800\n'), L = G.layout(t.sheets[0].rows), b = G.buildItems(L, G.guessColumns(L));
    return { header: L.header, names: b.items.map(x => x.name), headings: b.left.headings };
  });
  ok('…and a title line above such a list is passed over, not taken for an item or for the headings', titled.header === false && same(titled.names, ['Sony FX6', 'Zoom H6', 'Sigma 18-35']) && titled.headings === 1, JSON.stringify(titled));
  await setColumn(C.page, 'Column D', 'location'); await sleep(150);
  ok('correcting a column changes what would be added straight away', (await columns(C.page))['Column D'] === 'location' && /📍 Van/.test(await text(C.page, '.sheet .gi-sample')) && (await C.page.locator('.sheet .gi-col.skipped').count()) === 0, await text(C.page, '.sheet .gi-sample'));
  await C.page.locator('#gi-col-1').focus(); await setColumn(C.page, 'Column B', 'name'); await sleep(150);
  const swapped = await columns(C.page);
  ok('giving a column what another one had takes it from the other, and the focus stays on the control', swapped['Column B'] === 'name' && swapped['Column A'] === '' && /FX6-0001/.test(await text(C.page, '.sheet .gi-sample strong')) && await C.page.evaluate(() => document.activeElement.id === 'gi-col-1'), JSON.stringify(swapped));
  await setColumn(C.page, 'Column A', 'name'); await setColumn(C.page, 'Column B', 'serial'); await sleep(150);
  await C.page.locator('.sheet .gi-header input').check(); await sleep(200);
  ok('saying the first row holds the headings makes it the headings…', (await sum(C.page)) === 'Adds 3.' && 'Sony FX6' in (await columns(C.page)), await sum(C.page));
  await C.page.locator('.sheet .gi-header input').uncheck(); await sleep(200);
  ok('…and saying it does not makes it an item again', (await sum(C.page)) === 'Adds 4.' && same(await columns(C.page), bare));
  await setColumn(C.page, 'Column D', 'location'); await setColumn(C.page, 'Column E', ''); await setColumn(C.page, 'Column C', 'notes'); await sleep(150);
  await add(C.page); g = await gear(C.page);
  ok('what is added follows the corrected columns: the place is kept, a skipped column is left out, a column moved to Notes is notes under its heading', g.length === 4 && byName(g, 'Sony FX6').location === 'Van' && byName(g, 'Zoom H6').location === 'Shelf A' && byName(g, 'Sony FX6').serial === 'FX6-0001' && g.every(x => x.value === '' && x.category === '') && byName(g, 'Sony FX6').notes === 'Cameras', JSON.stringify(g.map(x => [x.name, x.location, x.value, x.category, x.notes])));

  /* ============================== duplicates by serial number: skip, update, add anyway ============================== */
  const OWNED = [
    { id: 'g1', name: 'Sony FX6 body', category: 'Camera', serial: 'FX6-120934', location: 'Flight case 1', qty: 1, value: 6000, notes: 'mine', log: [{ id: 'l1', date: '2026-01-10', kind: 'service', note: 'keep me', cost: '' }], updatedAt: 1 },
    { id: 'g2', name: 'Sennheiser MKH 416', category: 'Audio', serial: 'MKH 2219004', location: '', qty: 1, value: 1000, notes: '', updatedAt: 1 },
    { id: 'g3', name: 'Sachtler Flowtech 75', category: 'Support', serial: 'ft75-330218', location: '', qty: 1, value: 1400, notes: '', updatedAt: 1 },
    { id: 'g4', name: 'Aputure MC', category: 'Lighting', serial: '', location: '', qty: 4, value: 125, notes: '', updatedAt: 1 },
  ];
  const LIST = 'Item,Category,Serial number,Quantity,Value,Where,Notes\nSony FX6 cinema camera,Cameras,fx6 120934,1,6500,,From the list\nSennheiser MKH-416,Mics,MKH-2219004,1,1100,Audio bag,\nSachtler Flowtech 75,Tripods,FT75330218,1,1500,Van,\nAputure MC,Lighting,,4,130,,\nDJI Mavic 3 Pro,Drones,1581F5FKD234,1,2200,Studio,\n';
  await C.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  await seed(C.page, OWNED);
  await openImport(C.page); await give(C.page, named('list.csv', LIST)); await previewed(C.page);
  const dups = C.page.locator('.sheet .gi-dups');
  const why = await dups.locator('.add-why').allInnerTexts();
  ok('items already owned are found by serial number, whatever its capitals, spaces and hyphens, and left alone unless the person says otherwise', (await sum(C.page)) === 'Adds 1, skips 4.' && /Already in your Equipment \(4\)/.test(await dups.innerText()) && why.filter(w => /^Same serial number as your “/.test(w)).length === 3, await sum(C.page) + ' ' + why.join(' | '));
  ok('…an item with no serial number is found by its name, and that is said', why.filter(w => w === 'Same name as your “Aputure MC”, and neither has a serial number').length === 1, why.join(' | '));
  ok('each one has its own choice, with a name a screen reader can say', (await dups.locator('li select').count()) === 4 && (await dups.locator('li select').first().getAttribute('aria-label')) === 'What to do with Sony FX6 cinema camera' && (await dups.locator('li select').first().locator('option').allInnerTexts()).join('|') === 'Skip it: leave mine as it is|Update mine with these details|Add anyway, as another item');
  const everyone = dups.locator('select.gi-all');
  await everyone.selectOption('update'); await sleep(100); const allUpdate = await sum(C.page);
  await everyone.selectOption('add'); await sleep(100); const allAdd = await sum(C.page);
  await everyone.selectOption('skip'); await sleep(100);
  ok('“All of these” sets every one at once, and the summary follows', allUpdate === 'Adds 1, updates 4.' && allAdd === 'Adds 5.' && (await sum(C.page)) === 'Adds 1, skips 4.' && (await dups.locator('li select').evaluateAll(els => els.map(e => e.value))).every(v => v === 'skip'), allUpdate + ' / ' + allAdd);
  await dups.locator('li select').nth(0).selectOption('update'); await dups.locator('li select').nth(1).selectOption('add'); await sleep(100);
  ok('one updated, one added anyway, two skipped: the summary and the button say exactly that', (await sum(C.page)) === 'Adds 2, updates 1, skips 2.' && (await C.page.locator('.sheet .gi-go').innerText()) === 'Add 2 and update 1' && (await gear(C.page)).length === 4, await sum(C.page) + ' / ' + await C.page.locator('.sheet .gi-go').innerText());
  await setColumn(C.page, 'Where', ''); await setColumn(C.page, 'Where', 'location'); await sleep(150);
  ok('the choices made for single items survive a change to the columns', (await sum(C.page)) === 'Adds 2, updates 1, skips 2.', await sum(C.page));
  await add(C.page); g = await gear(C.page);
  const g1 = g.find(x => x.id === 'g1'), mkh = g.filter(x => /MKH/.test(x.name));
  ok('update: the owned item takes the list’s details, keeps its place in Vdex, its service log and whatever the list left empty', g1.name === 'Sony FX6 cinema camera' && g1.value === 6500 && g1.notes === 'From the list' && g1.category === 'Camera' && g1.location === 'Flight case 1' && g1.log.length === 1 && g1.log[0].note === 'keep me', JSON.stringify(g1));
  ok('add anyway: there are now two with that serial number, and the owned one is untouched', mkh.length === 2 && mkh.find(x => x.id === 'g2').value === 1000 && mkh.find(x => x.id !== 'g2').value === 1100 && mkh.find(x => x.id !== 'g2').location === 'Audio bag' && mkh.find(x => x.id !== 'g2').category === 'Audio', JSON.stringify(mkh));
  ok('skip: the owned items are as they were, and the new one is in', same(g.find(x => x.id === 'g3'), OWNED[2]) && same(g.find(x => x.id === 'g4'), OWNED[3]) && g.length === 6 && byName(g, 'DJI Mavic 3 Pro').category === 'Drone' && byName(g, 'DJI Mavic 3 Pro').value === 2200);
  ok('items from a spreadsheet are plain items: not marked as shared by anyone', g.every(x => !x.shared));

  /* ============================== afterwards: where it lands, and Undo ============================== */
  const after = await C.page.evaluate(() => { const b = document.querySelector('.undo-bar'), u = b && [...b.querySelectorAll('button')].find(x => x.textContent === 'Undo'); return { bar: b ? b.innerText.replace(/\s+/g, ' ') : '', focused: !!u && document.activeElement === u, outlined: document.querySelectorAll('.gear-card.just-added').length, toasts: document.querySelectorAll('.toast').length, role: b && b.getAttribute('role'), label: b && b.getAttribute('aria-label') }; });
  ok('afterwards the page shows what came in, and a bar says the same numbers as the summary and offers Undo, which has the focus', /^2 added, 1 updated, 2 skipped Undo/.test(after.bar) && after.focused && after.outlined === 3 && after.role === 'group' && after.label === 'Import finished', JSON.stringify(after));
  await C.page.locator('.undo-bar button', { hasText: 'Undo' }).click(); await sleep(300);
  g = await gear(C.page);
  const tomb = await C.page.evaluate(() => import('./js/store.js').then(s => Object.keys(s.db.deleted).length));
  ok('Undo removes what was added and puts back what was updated, exactly', g.length === 4 && same(g.map(({ updatedAt, ...x }) => x), OWNED.map(({ updatedAt, ...x }) => x)) && tomb === 2, JSON.stringify(g.find(x => x.id === 'g1')));
  ok('…says so, takes its bar away, and sends the focus back to Import…', /^Import undone: 2 items removed, 1 put back as it was$/.test(await text(C.page, '.toast')) && (await C.page.locator('.undo-bar').count()) === 0 && await C.page.evaluate(() => (document.activeElement.dataset || {}).fk === 'gear-import'), await text(C.page, '.toast'));
  // an import whose items were changed or used since is only undone as far as that is safe
  await openImport(C.page);
  ok('once undone, there is nothing more to undo under Import', (await C.page.locator('.sheet .gi-last').count()) === 0);
  await give(C.page, named('list.csv', LIST)); await previewed(C.page);
  await C.page.locator('.sheet .gi-dups select.gi-all').selectOption('update'); await sleep(100);
  await add(C.page);
  ok('(a second import: one added, four updated)', /^1 added, 4 updated/.test(await bar(C.page)) && (await gear(C.page)).length === 5, await bar(C.page));
  await C.page.locator('.undo-bar button[aria-label="Dismiss"]').click(); await sleep(150);
  await C.page.evaluate(() => import('./js/store.js').then(s => { const drone = s.db.gear.find(x => x.name === 'DJI Mavic 3 Pro'); s.update(d => { d.bookings.push({ id: 'bk1', title: 'Aerials', date: '2026-12-01', status: 'Confirmed', gear: [drone.id], crew: [], updatedAt: Date.now() }); }); s.upsert('gear', { ...s.byId('gear', 'g2'), notes: 'edited after the import' }); }));
  await openImport(C.page);
  const lastLine = await text(C.page, '.sheet .gi-last');
  ok('with its bar gone, the last import can still be undone from the Import sheet', /The last import \(1 added, 4 updated, from list\.csv\) can still be undone/.test(lastLine), lastLine);
  await C.page.locator('.sheet .gi-last button').click(); await sleep(300);
  g = await gear(C.page);
  ok('Undo leaves alone what has been used on a booking or edited since, and undoes the rest', g.length === 5 && !!byName(g, 'DJI Mavic 3 Pro').id && g.find(x => x.id === 'g2').notes === 'edited after the import' && g.find(x => x.id === 'g2').value === 1100 && same(g.find(x => x.id === 'g1').name, 'Sony FX6 body') && g.find(x => x.id === 'g3').value === 1400 && g.find(x => x.id === 'g4').value === 125, JSON.stringify(g.map(x => [x.id, x.name, x.value])));
  ok('…and says how many stayed', /^Import undone: 3 put back as they were\. 2 items changed or used since stay as they are$/.test(await text(C.page, '.toast')) && (await C.page.locator('.sheet .gi-last').count()) === 0, await text(C.page, '.toast'));
  await C.page.keyboard.press('Escape'); await sleep(200);
  // what the import adds lives through a backup, a restore and a merge with an older copy, and what was undone stays gone
  const kept = await C.page.evaluate(async list => {
    const s = await import('./js/store.js'), G = await import('./js/gear-columns.js'), T = await import('./js/table-read.js'), M = await import('./js/gear-import.js');
    s.update(d => { d.gear = []; d.bookings = []; });
    const t = await T.readTableText(list), L = G.layout(t.sheets[0].rows), b = G.buildItems(L, G.guessColumns(L));
    const done = M.applyGearImport(M.planGearImport(b.items, { matchNames: true }));
    const backup = s.exportJSON(), ids = done.added.slice();
    const back = M.undoGearImport(done);
    const merged = s.mergeDb(JSON.parse(s.serialize()), JSON.parse(backup));
    s.replaceAll(JSON.parse(backup));
    return { added: ids.length, removed: back.removed, afterMerge: merged.gear.filter(x => ids.includes(x.id)).length, restored: s.db.gear.length, fields: s.db.gear.find(x => x.name === 'Sennheiser MKH-416') };
  }, LIST);
  ok('imported items are ordinary records: a backup holds them and a restore brings them back whole', kept.added === 5 && kept.restored === 5 && kept.fields.serial === 'MKH-2219004' && kept.fields.value === 1100 && kept.fields.location === 'Audio bag', JSON.stringify(kept));
  ok('an undone import stays undone when an older copy that still has the items is merged in (another device, the cloud)', kept.removed === 5 && kept.afterMerge === 0, JSON.stringify(kept));

  /* ============================== hostile and silly files ============================== */
  await seed(C.page, []);
  await openImport(C.page);
  // an old .xls, by what is in it and by its name
  await give(C.page, named('kit list.xls', Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0, 0, 0, 0, 0]), 'application/vnd.ms-excel'));
  let no = await refused(C.page);
  ok('an old .xls is turned down kindly: what it is, that nothing was read, and what to do instead', /“kit list\.xls” is in the older Excel format \(\.xls\), which Vdex cannot read\. Nothing was read from it\. Open it in Excel, Numbers or Google Sheets, save it as Excel \(\.xlsx\) or CSV, and choose that file\./.test(no) && (await C.page.locator('.sheet .gi-warn').getAttribute('role')) === 'alert' && (await C.page.locator('.sheet .gi-choose').count()) === 1, no);
  await give(C.page, named('really-xls.csv', Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0])));
  ok('…whatever it is called', /older Excel format/.test(await refused(C.page)));
  await give(C.page, named('picture.csv', Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D]), Buffer.alloc(4000, 7)])));
  no = await refused(C.page);
  ok('a binary file named .csv is not read as a list', /“picture\.csv” is not a list Vdex can read: it is not text and not an Excel \.xlsx file\. Nothing was read from it\./.test(no), no);
  await give(C.page, named('doc.csv', '%PDF-1.7\n1 0 obj\n'));
  ok('a PDF says it is a PDF', /is a PDF/.test(await refused(C.page)));
  await give(C.page, named('gear.numbers', zip({ 'Index/Document.iwa': 'x', 'Metadata/Properties.plist': 'y' }), 'application/octet-stream'));
  no = await refused(C.page);
  ok('a Numbers file says how to export it', /is a Numbers file, which Vdex cannot read\. Nothing was read from it\. In Numbers, choose File → Export To → CSV or Excel/.test(no), no);
  await give(C.page, named('archive.xlsx', zip({ 'hello.txt': 'not a workbook' })));
  ok('a zip that is not a workbook says so', /is not an Excel workbook/.test(await refused(C.page)));
  await give(C.page, named('cut-short.xlsx', ODD_XLSX.subarray(0, 700)));
  ok('a damaged workbook says so', /could not be opened: it looks damaged/.test(await refused(C.page)));
  await give(C.page, named('empty.csv', ''));
  ok('an empty file says so', /“empty\.csv” is empty/.test(await refused(C.page)));
  await give(C.page, named('huge.csv', Buffer.alloc(21e6, 0x61)));
  no = await refused(C.page);
  ok('a file over 20 MB is turned down before it is read', /“huge\.csv” is 21 MB, more than Vdex will read \(20 MB\)\. Nothing was read from it\./.test(no), no);
  // a small workbook that unpacks into 70 MB
  const bomb = zip({ 'xl/workbook.xml': XML + `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`, 'xl/_rels/workbook.xml.rels': XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': Buffer.concat([Buffer.from(`<worksheet ${NS}><sheetData>`), Buffer.alloc(70e6, 0x20), Buffer.from('</sheetData></worksheet>')]) });
  const t0 = Date.now();
  await give(C.page, named('bomb.xlsx', bomb));
  no = await refused(C.page);
  ok('a small workbook that unpacks into far more than it should is stopped, not swallowed', bomb.length < 200000 && /unpacks into more than Vdex will read\. Nothing was read from it\./.test(no), `${bomb.length} bytes, ${Date.now() - t0} ms: ${no}`);
  // 150,000 rows that are opened and never closed: a reader that guesses where each one ends would take minutes
  const unclosed = zip({ 'xl/workbook.xml': XML + `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`, 'xl/_rels/workbook.xml.rels': XML + '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>` + '<row r="1"><c r="A1" t="inlineStr"><is><t>x<v>'.repeat(150000) });
  const t1 = Date.now();
  await give(C.page, named('unclosed.xlsx', unclosed));
  no = await refused(C.page);
  ok('a workbook of tags that are never closed is given up on at once', /“unclosed\.xlsx” has no rows in it/.test(no) && Date.now() - t1 < 15000, `${Date.now() - t1} ms: ${no}`);
  ok('after every refusal Import is still open on its first step, and nothing was added', (await C.page.locator('.sheet .gi-choose').count()) === 1 && (await C.page.locator('.sheet .gi-cols').count()) === 0 && (await gear(C.page)).length === 0);
  // a workbook hiding behind a .csv name is still a workbook
  await give(C.page, named('really-xlsx.csv', ODD_XLSX)); await previewed(C.page);
  ok('an .xlsx named .csv is read as what it is', (await sum(C.page)) === 'Adds 3.' && (await C.page.locator('.sheet .gi-pick select option').count()) === 3);
  await C.page.locator('.sheet button', { hasText: 'Choose another list' }).click(); await C.page.waitForSelector('.sheet .gi-choose'); await sleep(120);
  ok('“Choose another list” goes back to the first step, with the focus on choosing a file', await C.page.evaluate(() => document.activeElement.classList.contains('gi-choose')));
  await C.page.locator('#gi-paste').fill('Item\nSpare cable\n'); await C.page.locator('.sheet .gi-use').click(); await previewed(C.page);
  await C.page.locator('.sheet button', { hasText: 'Choose another list' }).click(); await C.page.waitForSelector('.sheet .gi-choose');
  ok('…and what was pasted is still in the box', (await C.page.locator('#gi-paste').inputValue()) === 'Item\nSpare cable\n');
  // formulas, HTML, very long cells
  const long = 'L'.repeat(50000);
  await give(C.page, named('nasty.csv', `Item,Serial number,Value,Notes,Where\n"=HYPERLINK(""http://evil.example"",""click"")",+4477,=1+1,@SUM(A1:A9),-2\n"<img src=x onerror=alert(1)><b>Bold</b> mic",<script>alert(2)</script>,10,"<a href=""javascript:alert(3)"">x</a>",<i>Van</i>\n${long},S-3,5,${long},${long}\n'=2+2,S-4,1,,\n`)); await previewed(C.page);
  const nastyDom = await C.page.evaluate(() => { const s = document.querySelector('.sheet'); return { tags: s.querySelectorAll('img, script, i, b:not(.gi-cats b):not(.gi-problems b), a').length, text: s.innerText, wide: s.querySelector('.sheet-body').scrollWidth - s.querySelector('.sheet-body').clientWidth }; });
  ok('HTML in a cell is shown as the text it is: no element is made of it, nothing runs', nastyDom.tags === 0 && dialogs.length === 0 && /<img src=x onerror=alert\(1\)><b>Bold<\/b> mic/.test(nastyDom.text) && nastyDom.wide <= 0, JSON.stringify({ tags: nastyDom.tags, dialogs, wide: nastyDom.wide }));
  const nastyProblems = await text(C.page, '.sheet .gi-problems');
  ok('a formula where a value should be is not a value, and is said; over-long cells are said too', /row 2: “=1\+1” is not a value, so the value is left empty/i.test(nastyProblems) && /row 4: a cell with more text than Vdex reads is cut short/i.test(nastyProblems) && /row 4: the name is shortened to 200 characters/i.test(nastyProblems) && /row 4: the place is shortened to 120 characters/i.test(nastyProblems), nastyProblems.replace(/\n/g, ' / ').slice(0, 600));
  await add(C.page); g = await gear(C.page);
  const formula = byName(g, '=HYPERLINK("http://evil.example","click")'), html = g.find(x => /Bold/.test(x.name)) || {}, big = g.find(x => /^L+$/.test(x.name)) || {};
  ok('formulas beginning with = + - @ are kept as plain text, nothing worked out', !!formula.id && formula.serial === '+4477' && formula.value === '' && formula.notes === '@SUM(A1:A9)' && formula.location === '-2' && !!byName(g, '=2+2').id, JSON.stringify(formula));
  ok('HTML is kept as text in the record, and on the Equipment page', html.name === '<img src=x onerror=alert(1)><b>Bold</b> mic' && html.serial === '<script>alert(2)</script>' && html.location === '<i>Van</i>' && (await C.page.locator('#page .gear-card img, #page .gear-card script, #page .gear-card i').count()) === 0 && dialogs.length === 0, JSON.stringify(html));
  ok('cells thousands of characters long are capped', big.name.length === 200 && big.notes.length === 2000 && big.location.length === 120 && g.length === 4, JSON.stringify([big.name.length, big.notes.length, big.location.length]));
  // more rows than Vdex reads in one go
  await C.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  await seed(C.page, []);
  let many = 'Item,Serial number\n'; for (let i = 0; i < 10050; i++) many += `Thing ${i},T-${100000 + i}\n`;
  await openImport(C.page); await give(C.page, named('many.csv', many)); await previewed(C.page);
  ok('a list longer than 10,000 rows is read as far as that, and says so', /only its first 10,000 rows are here/.test(await C.page.locator('.sheet').innerText()) && (await sum(C.page)) === 'Adds 9,999.', await sum(C.page));
  await C.page.keyboard.press('Escape'); await sleep(200);
  await C.ctx.close();

  /* ============================== 5,000 rows ============================== */
  const P = await open({ width: 1200, height: 800 });
  let bigCsv = 'Item,Category,Serial number,Where,Quantity,Value each (£),Purchased,Notes\r\n';
  for (let i = 0; i < 5000; i++) bigCsv += `"Item ${i}, with a comma",${['Cameras', 'Mics', 'Lenses', 'Widgets'][i % 4]},SN-${100000 + i},Shelf ${i % 20},${1 + i % 3},"£${(1000 + i).toLocaleString('en-GB')}.50",${String(13 + i % 15).padStart(2, '0')}/0${1 + i % 9}/2023,"Note ${i}"\r\n`;
  await P.page.evaluate(() => window.logiGo('gear')); await P.page.waitForSelector('#page .subactions');
  // A heartbeat: the longest wait between two ticks of a 10 ms timer is how long the page could not answer.
  await P.page.evaluate(() => { window.__gaps = []; let last = performance.now(); setInterval(() => { const now = performance.now(); window.__gaps.push(now - last); last = now; }, 10); });
  const worst = () => P.page.evaluate(() => { const w = Math.round(Math.max(0, ...window.__gaps)); window.__gaps = []; return w; });
  await P.page.locator('#page .subactions button', { hasText: 'Import…' }).click(); await P.page.waitForSelector('.sheet .gi-choose'); await worst();
  let t = Date.now();
  await give(P.page, named('five-thousand.csv', bigCsv)); await previewed(P.page);
  const readMs = Date.now() - t, readGap = await worst();
  ok('5,000 rows: the preview is there in a moment and the page never stops answering for long', (await sum(P.page)) === 'Adds 5,000.' && readGap < 1500, `preview after ${readMs} ms, longest pause ${readGap} ms`);
  ok('…the preview stays small: five sample items, however many rows', (await P.page.locator('.sheet .gi-sample li').count()) === 5 && (await P.page.locator('.sheet .gi-col').count()) === 8);
  t = Date.now();
  await P.page.locator('.sheet .gi-go').click(); await P.page.waitForSelector('.undo-bar', { timeout: 60000 });
  const addMs = Date.now() - t, addGap = await worst();
  const bigDb = await P.page.evaluate(() => import('./js/store.js').then(s => ({ n: s.db.gear.length, saved: JSON.parse(localStorage.getItem('logi-db-v1')).gear.length, sample: s.db.gear[4999], cards: document.querySelectorAll('#page .gear-card').length })));
  ok('…adding them takes a moment, they are saved, and the Equipment page shows them all', bigDb.n === 5000 && bigDb.saved === 5000 && bigDb.cards === 5000 && bigDb.sample.name === 'Item 4999, with a comma' && bigDb.sample.value === 5999.5 && bigDb.sample.category === 'Widgets' && bigDb.sample.purchased === '2023-05-17' && bigDb.sample.qty === 2 && addGap < 4000, `added after ${addMs} ms, longest pause ${addGap} ms ` + JSON.stringify({ ...bigDb, sample: [bigDb.sample.value, bigDb.sample.purchased] }));
  t = Date.now();
  await P.page.locator('.undo-bar button', { hasText: 'Undo' }).click(); await P.page.waitForSelector('.toast', { timeout: 60000 });
  ok('…and Undo takes all 5,000 back', (await gear(P.page)).length === 0 && /5,000 items removed/.test(await text(P.page, '.toast')), `${Date.now() - t} ms, longest pause ${await worst()} ms`);
  await P.ctx.close();

  /* ============================== read-only, the trial, and the PIN ============================== */
  const desktop = state => `window.vdexDesktop = { platform: 'linux', updateState: async () => ({ status: 'current' }), checkForUpdates: async () => ({ status: 'current' }), onStatus: () => () => {},
    licence: { state: async () => (${JSON.stringify(state)}), enter: async () => ({ error: 'no' }), recheck: async () => (${JSON.stringify(state)}), release: async () => (${JSON.stringify(state)}), code: async () => '', buy: async () => true, onChange: () => () => {} } };`;
  const R = await open({ init: desktop({ enabled: true, mode: 'ended', canEdit: false, trialLeft: 0, trialEnds: '2026-10-01', seats: 3 }) });
  await openImport(R.page); await paste(R.page, 'Item,Serial number\nSony FX6,FX6-1\nZoom H6,H6-1\n'); await previewed(R.page);
  ok('read-only (the trial is over, no licence): a list can still be opened and checked, and the sheet says it cannot be added', (await sum(R.page)) === 'Adds 2.' && /Vdex is read-only at the moment, so the list can be checked here but not added/.test(await text(R.page, '.sheet .gi-readonly')));
  await R.page.locator('.sheet .gi-go').click(); await R.page.waitForSelector('.sheet.licence-readonly', { timeout: 8000 });
  ok('…the last button is refused with the usual explanation: nothing is added, the list stays open, no bar offers Undo', /Vdex is read-only/.test(await R.page.locator('.sheet.licence-readonly').innerText()) && (await gear(R.page)).length === 0 && (await R.page.locator('.sheet .gi-cols').count()) === 1 && (await R.page.locator('.undo-bar, .toast').count()) === 0);
  ok('…and no price, Buy button or shop link is added by the import itself', !/\$|£|€|buy/i.test(await R.page.locator('.sheet', { has: R.page.locator('.gi-cols') }).innerText()));
  await R.ctx.close();
  const Tr = await open({ init: desktop({ enabled: true, mode: 'trial', canEdit: true, trialLeft: 20, trialEnds: '2026-12-08', seats: 3 }) });
  await openImport(Tr.page); await paste(Tr.page, 'Item,Serial number\nSony FX6,FX6-1\nZoom H6,H6-1\n'); await previewed(Tr.page);
  ok('during the trial nothing says the list cannot be added', (await Tr.page.locator('.sheet .gi-readonly').count()) === 0);
  await add(Tr.page);
  ok('importing needs no licence: on a trial the list goes in, and no licence is asked for', (await gear(Tr.page)).length === 2 && (await Tr.page.locator('.sheet').count()) === 0 && /^2 added/.test(await bar(Tr.page)));
  await Tr.ctx.close();
  // with a PIN, what is imported is sealed with everything else
  const L = await open();
  await L.page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810'))); await L.page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
  await openImport(L.page); await paste(L.page, 'Item,Serial number,Value\nSony FX6,FX6-1,6000\nZoom H6,H6-1,300\n'); await previewed(L.page); await add(L.page);
  await sleep(400);
  await L.page.goto(BASE); await L.page.waitForSelector('.lock', { timeout: 15000 }); await sleep(600);
  const sealed = await L.page.evaluate(() => ({ plain: localStorage.getItem('logi-db-v1'), vault: (localStorage.getItem('logi-vault') || '').includes('FX6-1'), probe: localStorage.getItem('logi-import-room') }));
  ok('with a PIN, an imported list is behind the lock like everything else: nothing of it is readable while locked', sealed.plain === null && sealed.vault === false && sealed.probe === null, JSON.stringify({ ...sealed, plain: sealed.plain && sealed.plain.length }));
  for (const d of '246810') await L.page.locator(`.lock .key[aria-label="${d}"]`).click();
  await L.page.waitForFunction(() => !document.querySelector('.lock'), null, { timeout: 30000 }); await sleep(300);
  g = await gear(L.page);
  ok('…and it is all there once the PIN is in', g.length === 2 && byName(g, 'Sony FX6').value === 6000 && byName(g, 'Zoom H6').serial === 'H6-1', JSON.stringify(g.map(x => x.name)));
  await L.ctx.close();
  // the iPhone app picks the file in the Files app
  const I = await open({ init: `window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { DocumentPicker: { open: async a => { window.__asked = a; return { name: 'kit.csv', type: 'text/csv', data: btoa('Item,Serial number\\nSony FX6,FX6-1\\nZoom H6,H6-1\\n') }; }, addListener: async (ev, cb) => { window.__handed = cb; return { remove() {} }; } } } };` });
  await openImport(I.page); await I.page.locator('.sheet .gi-choose').click(); await previewed(I.page);
  ok('in the iPhone app, Choose a file opens the Files app for a CSV or Excel file, and the list is read the same way', same((await I.page.evaluate(() => window.__asked)).types, ['csv', 'xlsx', 'tsv', 'txt', 'xls']) && (await sum(I.page)) === 'Adds 2.', JSON.stringify(await I.page.evaluate(() => window.__asked)));
  await I.page.keyboard.press('Escape'); await sleep(200);
  // a spreadsheet another app hands to Vdex ("Copy to Vdex" on a CSV in Mail or Files) can be the kit list
  await I.page.evaluate(() => window.__handed({ name: 'my kit.csv', type: 'text/csv', data: btoa('Item,Serial number,Value\nSony FX6,FX6-1,6000\nZoom H6,H6-1,300\nRode NTG5,NTG-9,450\n') })); await I.page.waitForSelector('.sheet'); await sleep(200);
  const offered = await I.page.locator('.sheet button.btn').allInnerTexts();
  await I.page.locator('.sheet button', { hasText: 'Kit list for Equipment' }).click(); await previewed(I.page);
  ok('a spreadsheet handed to Vdex by another app can be imported as the kit list: it opens on the preview, and still nothing is added before the last button', offered.includes('🎥 Kit list for Equipment') && offered.includes('🎬 Script for TC Notes') && (await sum(I.page)) === 'Adds 3.' && /my kit\.csv: 3 rows/.test(await text(I.page, '.sheet .gi-source')) && (await gear(I.page)).length === 0, offered.join('|') + ' ' + await sum(I.page));
  await I.ctx.close();

  /* ============================== a list that says nothing about quantities ============================== */
  const Q = await open({ width: 1200, height: 800 });
  const OWNED_QTY = [{ id: 'q1', name: 'Aputure MC', category: 'Lighting', serial: '', location: '', qty: 4, value: 90, notes: '', updatedAt: 1 }, { id: 'q2', name: 'Sony FX6', category: 'Camera', serial: 'FX6-1', location: '', qty: 2, value: 5000, notes: '', updatedAt: 1 }];
  await seed(Q.page, OWNED_QTY);
  await openImport(Q.page); await paste(Q.page, 'Item\tCategory\tSerial number\tReplacement value\nAputure MC\tLighting\t\t95\nSony FX6\tCamera\tFX6-1\t6000\nRode NTG\tAudio\tRD-11\t300\n'); await previewed(Q.page);
  await Q.page.locator('.sheet .gi-dups select.gi-all').selectOption('update'); await sleep(100);
  const noQtyGo = await Q.page.locator('.sheet .gi-go').innerText();
  await add(Q.page); g = await gear(Q.page);
  ok('updating owned items from a list with no Quantity column leaves their quantities alone (4 and 2 stay 4 and 2) and takes the new values; a new item is added as 1', noQtyGo === 'Add 1 and update 2' && byName(g, 'Aputure MC').qty === 4 && byName(g, 'Aputure MC').value === 95 && byName(g, 'Sony FX6').qty === 2 && byName(g, 'Sony FX6').value === 6000 && byName(g, 'Rode NTG').qty === 1, noQtyGo + ' ' + JSON.stringify(g.map(x => [x.name, x.qty, x.value])));
  await Q.page.locator('.undo-bar button', { hasText: 'Undo' }).click(); await sleep(250);
  ok('…and Undo has nothing to put right in the quantities', same((await gear(Q.page)).map(x => [x.name, x.qty, x.value]), [['Aputure MC', 4, 90], ['Sony FX6', 2, 5000]]), JSON.stringify((await gear(Q.page)).map(x => [x.name, x.qty, x.value])));
  await seed(Q.page, [OWNED_QTY[0], { id: 'q3', name: 'Rode NTG', category: 'Audio', serial: '', location: '', qty: 2, value: 280, notes: '', updatedAt: 1 }]);
  await openImport(Q.page); await paste(Q.page, 'Item\tCategory\tQty\tValue\nAputure MC\tLighting\t\t99\nRode NTG\tAudio\t3\t310\nZoom H6\tAudio\tn/a\t300\n'); await previewed(Q.page);
  await Q.page.locator('.sheet .gi-dups select.gi-all').selectOption('update'); await sleep(100);
  await add(Q.page); g = await gear(Q.page);
  ok('…the same where the Quantity column is there but a row leaves it empty: an empty cell changes nothing (4 stays 4), a quantity the list gives is taken (2 becomes 3)', byName(g, 'Aputure MC').qty === 4 && byName(g, 'Aputure MC').value === 99 && byName(g, 'Rode NTG').qty === 3 && byName(g, 'Rode NTG').value === 310 && byName(g, 'Zoom H6').qty === 1, JSON.stringify(g.map(x => [x.name, x.qty, x.value])));
  const shared = await Q.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js');
    const t = await T.readTableText('Item,Qty,Total\nBatteries,4,400\nCharger,,90\n'), L = G.layout(t.sheets[0].rows), b = G.buildItems(L, G.guessColumns(L));
    return b.items.map(x => [x.name, 'qty' in x ? x.qty : 'none', x.value]);
  });
  ok('a value of the whole row is still shared over the quantity the row gives, and over 1 when it gives none', same(shared, [['Batteries', 4, 100], ['Charger', 'none', 90]]), JSON.stringify(shared));

  /* ============================== a row with only a word: an item, or a heading over a group ============================== */
  await Q.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  await seed(Q.page, []);
  await openImport(Q.page); await paste(Q.page, 'Item\tCategory\tSerial number\tReplacement value\nAputure MC\tLighting\t\t95\nSony FX6\tCamera\tFX6-1\t6000\nTripod\t\t\t\nRode NTG\t\tRD-11\t300\n'); await previewed(Q.page);
  const loneSel = Q.page.locator('.sheet .gi-lone select');
  const lone0 = { sum: await sum(Q.page), found: await Q.page.locator('.sheet .gi-sample h4').textContent(), passed: await Q.page.locator('.sheet .gi-passed').count(), label: await Q.page.locator('.sheet .gi-lone').evaluate(e => e.firstChild.textContent), value: await loneSel.inputValue(), options: await loneSel.locator('option').allTextContents(), name: await loneSel.getAttribute('aria-label'), fits: await loneSel.evaluate(e => { const r = e.getBoundingClientRect(), sh = e.closest('.sheet').getBoundingClientRect(); return r.height >= 43.5 && r.left >= sh.left && r.right <= sh.right; }) };
  ok('a row holding only a one-word name such as Tripod is an item, not a heading: it is counted and nothing is passed over', lone0.sum === 'Adds 4.' && lone0.found === 'The 4 items found' && lone0.passed === 0, JSON.stringify(lone0));
  ok('…and the sheet says which rows it means and how it took them, with a control to say otherwise', lone0.label === '1 row with only a name, such as “Tripod”: ' && lone0.name === '1 row with only a name, such as “Tripod”' && lone0.value === 'items' && same(lone0.options, ['Group headings, not items', 'Items of their own']) && lone0.fits, JSON.stringify(lone0));
  await loneSel.focus(); await loneSel.selectOption('headings'); await sleep(150);
  const lone1 = { sum: await sum(Q.page), passed: await text(Q.page, '.sheet .gi-passed'), value: await Q.page.locator('.sheet .gi-lone select').inputValue(), focused: await Q.page.evaluate(() => !!(document.activeElement && document.activeElement.closest('.gi-lone'))) };
  ok('…saying they are group headings rebuilds the plan: the heading is named with its row, and the focus stays on the control', lone1.sum === 'Adds 3.' && lone1.passed === 'Not items, so passed over: 1 heading (row 4 “Tripod”).' && lone1.value === 'headings' && lone1.focused, JSON.stringify(lone1));
  await Q.page.locator('.sheet .gi-lone select').selectOption('items'); await sleep(150);
  await add(Q.page); g = await gear(Q.page);
  ok('…and as items, the Tripod is added and the row under it does not take “Support” from it', g.length === 4 && !!byName(g, 'Tripod').id && byName(g, 'Rode NTG').category === '' && byName(g, 'Rode NTG').serial === 'RD-11', JSON.stringify(g.map(x => [x.name, x.category])));
  await Q.page.locator('.undo-bar button[aria-label="Dismiss"]').click().catch(() => {});
  await seed(Q.page, []);
  await openImport(Q.page); await paste(Q.page, 'Item\tSerial number\tValue\nCAMERAS\t\t\nSony FX6\tFX6-1\t6000\nTripod\t\t\nLenses:\t\t\nSigma 18-35\tS-1\t800\n'); await previewed(Q.page);
  const mixed = { sum: await sum(Q.page), passed: await text(Q.page, '.sheet .gi-passed'), value: await Q.page.locator('.sheet .gi-lone select').inputValue(), options: await Q.page.locator('.sheet .gi-lone select option').allTextContents() };
  ok('where some such rows are written as headings (CAMERAS, Lenses:) and one is not, the headings are named and the control says how the rows were told apart', mixed.sum === 'Adds 3.' && mixed.passed === 'Not items, so passed over: 2 headings (row 2 “CAMERAS”, row 5 “Lenses:”).' && mixed.value === 'auto' && same(mixed.options, ['Headings only where written as one', 'Group headings, not items', 'Items of their own']), JSON.stringify(mixed));
  await Q.page.keyboard.press('Escape'); await sleep(200);
  const shapes = await Q.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js');
    const read = async (text, opt) => { const t = await T.readTableText(text), L = G.layout(t.sheets[0].rows), b = G.buildItems(L, G.guessColumns(L), opt); return { items: b.items.map(x => [x.name, x.category || '']), sections: b.left.sections, headings: b.left.headings, passed: (b.passed || []).map(x => `${x.n} ${x.text} > ${x.to}`), lone: b.lone }; };
    const groups = 'Item,Serial number,Value\nCameras,,\nSony FX6,FX6-1,6000\nLenses,,\nSigma 18-35,S-1,800\n';
    return {
      plain: await read('Item,Serial number,Value\nSony FX6,4512345,5999\nTripod,,\nGimbal,,\nAputure 600d,AP123456,1890\nSmallHD 502,,\nHeadphones,,\n'),
      withCategory: await read('Item,Qty,Category\nSony FX6,1,Cameras\nMonitor,,\nDrone,,\nBig Light,1,\n'),
      written: await read('Item,Serial number,Value\nCAMERAS,,\nSony FX6,FX6-1,6000\nTripod,,\nLenses:,,\nSigma 18-35,S-1,800\n'),
      acronym: await read('Item,Serial number,Value\nSony FX6,FX6-1,6000\nSSD,,\nLED,,\nSigma 18-35,S-1,800\n'),
      opens: await read(groups), opensAsItems: await read(groups, { lone: 'items' }),
      list: await read('2x Aputure 600d\nSony FX6 (S/N 4512345)\nTripod\n3x Batteries\n'),
      titled: await read('Kit list for the insurer 2026,,,\nSony FX6,FX6-0001,Cameras,6000\nZoom H6,H6-00003,Mics,300\nSigma 18-35,SIG-0002,Lenses,800\n'),
      // no row of headings: the first group's heading is among the lines taken for titles above the table
      bare: await read('Kit list 2026\nCameras\nSony FX6\tFX6-1\t6000\nSony A7S\tA7-2\t2900\nLenses\nSigma 18-35\tS-1\t800\nSigma 50\tS-2\t600\nAudio\nRode NTG\tR-1\t300\n'),
      bareAsItems: await read('Cameras\nSony FX6\tFX6-1\t6000\nSony A7S\tA7-2\t2900\nLenses\nSigma 18-35\tS-1\t800\n', { lone: 'items' }),
      bareCapitals: await read('CAMERAS\nSony FX6\tFX6-1\t6000\nSony A7S\tA7-2\t2900\nTripod\nLENSES\nSigma 18-35\tS-1\t800\n'),
    };
  });
  ok('with no Category column either, one-word names stay items (Tripod, Gimbal, Headphones) and give no category to the rows under them', same(shapes.plain.items, [['Sony FX6', ''], ['Tripod', ''], ['Gimbal', ''], ['Aputure 600d', ''], ['SmallHD 502', ''], ['Headphones', '']]) && shapes.plain.sections === 0 && same(shapes.plain.lone, { rows: 3, headings: 0, example: 'Tripod' }), JSON.stringify(shapes.plain));
  ok('with a Category column, “Monitor” and “Drone” on rows of their own are items, and a later row with no category stays without one', same(shapes.withCategory.items, [['Sony FX6', 'Camera'], ['Monitor', ''], ['Drone', ''], ['Big Light', '']]) && shapes.withCategory.lone.headings === 0, JSON.stringify(shapes.withCategory));
  ok('a word written as a heading (LENSES, Lenses:) still heads the rows under it and is named; a plain word among them is an item', same(shapes.written.items, [['Sony FX6', 'Camera'], ['Tripod', 'Camera'], ['Sigma 18-35', 'Lens']]) && same(shapes.written.passed, ['2 CAMERAS > Camera', '5 Lenses: > Lens']) && same(shapes.written.lone, { rows: 3, headings: 2, example: 'CAMERAS' }), JSON.stringify(shapes.written));
  ok('…and capitals do not make a heading of a word that is always written in them (SSD, LED)', same(shapes.acronym.items.map(x => x[0]), ['Sony FX6', 'SSD', 'LED', 'Sigma 18-35']) && shapes.acronym.sections === 0, JSON.stringify(shapes.acronym));
  ok('a list that plainly opens with a group heading keeps its headings, each named with its row; the person’s answer turns them all into items', same(shapes.opens.items, [['Sony FX6', 'Camera'], ['Sigma 18-35', 'Lens']]) && same(shapes.opens.passed, ['2 Cameras > Camera', '4 Lenses > Lens']) && same(shapes.opensAsItems.items, [['Cameras', ''], ['Sony FX6', ''], ['Lenses', ''], ['Sigma 18-35', '']]) && shapes.opensAsItems.passed.length === 0, JSON.stringify([shapes.opens, shapes.opensAsItems]));
  ok('in a pasted list with counts and serial numbers, a line that is only “Tripod” is an item too', same(shapes.list.items.map(x => x[0]), ['Aputure 600d', 'Sony FX6', 'Tripod', 'Batteries']) && shapes.list.sections === 0, JSON.stringify(shapes.list));
  ok('a title line passed over above a list with no headings is named as well', same(shapes.titled.passed, ['1 Kit list for the insurer 2026 > ']) && shapes.titled.headings === 1 && shapes.titled.items.length === 3, JSON.stringify(shapes.titled));
  ok('a list with no row of headings, divided by plain group headings, keeps them: “Cameras” is taken for a title above the table, and “Lenses” and “Audio” still head their rows and are not added as items', same(shapes.bare.items, [['Sony FX6', ''], ['Sony A7S', ''], ['Sigma 18-35', 'Lens'], ['Sigma 50', 'Lens'], ['Rode NTG', 'Audio']]) && same(shapes.bare.passed, ['1 Kit list 2026 > ', '2 Cameras > ', '5 Lenses > Lens', '8 Audio > Audio']) && same(shapes.bare.lone, { rows: 2, headings: 2, example: 'Lenses' }), JSON.stringify(shapes.bare));
  ok('…the person’s answer still makes items of them, and where the opening one is written as a heading (CAMERAS) a plain “Tripod” further down is an item', same(shapes.bareAsItems.items.map(x => x[0]), ['Sony FX6', 'Sony A7S', 'Lenses', 'Sigma 18-35']) && same(shapes.bareCapitals.items, [['Sony FX6', ''], ['Sony A7S', ''], ['Tripod', ''], ['Sigma 18-35', 'Lens']]), JSON.stringify([shapes.bareAsItems, shapes.bareCapitals]));

  /* ============================== guesses and values put right ============================== */
  const fixes = await Q.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js');
    const read = async text => { const t = await T.readTableText(text), L = G.layout(t.sheets[0].rows), cols = G.guessColumns(L), b = G.buildItems(L, cols); return { cols, items: b.items, problems: b.problems.map(p => p.text) }; };
    return {
      numbered: await read('Item,Description,Serial Number,Sum Insured\n1,Sony FX6 body,FX6-1,6000\n2,Sigma 18-35 lens,SG-2,800\n3,Rode NTG mic,RD-3,300\n4,Sachtler tripod,ST-4,900\n'),
      described: (await read('Item,Description,Value\nSony FX6,Cinema camera body,6000\nSigma 18-35,Zoom lens,800\nRode NTG,Mic,300\n')).cols,
      months: ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].map(w => G.parseMonths(w)),
      interval: await read('Item,Service every\nSony FX6,constructor\nZoom H6,annually\n'),
      dinars: [G.numberStyle(['450.500', '125.000'], { heading: 'Value (KWD)' }).dotThousands, G.numberStyle(['450.500 KWD', '125.000 KWD']).dotThousands, G.numberStyle(['1.299', '2.500']).dotThousands, G.parseAmount('KWD 450.500'), G.parseAmount('450.500 BHD')],
      dinarList: (await read('Item,Value (KWD)\nSony FX6,450.500\nZoom H6,125.000\n')).items.map(x => x.value),
      long: [Number.isNaN(G.parseAmount('-'.repeat(1999) + 'x')), G.parseQty('2' + ' '.repeat(1990) + 'q').n, G.parseDate('1' + ' /'.repeat(900)), G.parseMonths("1" + " ".repeat(1990) + "zz")],
    };
  });
  ok('an “Item” column of line numbers beside “Description” is left out, and the descriptions are the names (not the notes)', same(fixes.numbered.cols, ['', 'name', 'serial', 'value']) && same(fixes.numbered.items.map(x => [x.name, x.notes || '']), [['Sony FX6 body', ''], ['Sigma 18-35 lens', ''], ['Rode NTG mic', ''], ['Sachtler tripod', '']]), JSON.stringify(fixes.numbered));
  ok('…while an “Item” column of words beside “Description” is still the name, with the description as notes', same(fixes.described, ['name', 'notes', 'value']), JSON.stringify(fixes.described));
  ok('a service interval that is a word such as “constructor” is simply not understood: no interval is set, and the row says so', fixes.months.every(x => x === null) && !('serviceEvery' in fixes.interval.items[0]) && fixes.interval.items[1].serviceEvery === 12 && /“constructor” is not a number of months/.test(fixes.interval.problems.join(' ')), JSON.stringify([fixes.months.map(x => typeof x), fixes.interval]));
  ok('money written to three decimal places keeps its point as the decimal mark when the column names such a currency (KWD, BHD…); elsewhere 1.299 is still thousands', same(fixes.dinars, [false, false, true, 450.5, 450.5]) && same(fixes.dinarList, [450.5, 125]), JSON.stringify([fixes.dinars, fixes.dinarList]));
  ok('text far too long to be a number, a quantity, a date or an interval is not one, without a pattern being tried on it', same(fixes.long, [true, 1, null, null]), JSON.stringify(fixes.long));

  /* ============================== number cells of an .xlsx, and workbooks made to waste time ============================== */
  const RELS = targets => XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((t, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="${t}"/>`).join('')}</Relationships>`;
  const BOOK = sheets => XML + `<workbook ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([name, rid], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="${rid}"/>`).join('')}</sheets></workbook>`;
  const SHEET = rows => XML + `<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`;
  const cT = (ref, s) => `<c r="${ref}" t="inlineStr"><is><t>${s}</t></is></c>`, cN = (ref, v, style) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  // real number cells (6000, 2300, 308.625) under "Value", and codes kept as numbers under a format of zeros
  const NUM_XLSX = zip({
    'xl/workbook.xml': BOOK([['Kit', 'rId1']]), 'xl/_rels/workbook.xml.rels': RELS(['worksheets/sheet1.xml']),
    'xl/styles.xml': XML + `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="000000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': SHEET(`<row r="1">${cT('A1', 'Item')}${cT('B1', 'Serial number')}${cT('C1', 'Value')}</row><row r="2">${cT('A2', 'Sony FX6')}${cN('B2', 123, 1)}${cN('C2', 6000)}</row><row r="3">${cT('A3', 'Sigma 18-35')}${cN('B3', 45, 1)}${cN('C3', 2300)}</row><row r="4">${cT('A4', 'Filter set')}${cN('B4', 7, 1)}${cN('C4', 308.625)}</row>`),
  });
  const SAME_SIX = zip({ 'xl/workbook.xml': BOOK([1, 2, 3, 4, 5, 6].map(i => [`Copy ${i}`, 'rId1'])), 'xl/_rels/workbook.xml.rels': RELS(['worksheets/sheet1.xml']), 'xl/worksheets/sheet1.xml': SHEET(`<row r="1">${cT('A1', 'Item')}</row><row r="2">${cT('A2', 'Sony FX6')}</row>`) });
  const blankSheet = bytes => Buffer.concat([Buffer.from(`<worksheet ${NS}><sheetData>`), Buffer.alloc(bytes, 0x20), Buffer.from('</sheetData></worksheet>')]);
  const TWO_BIG = zip({ 'xl/workbook.xml': BOOK([['One', 'rId1'], ['Two', 'rId2']]), 'xl/_rels/workbook.xml.rels': RELS(['worksheets/sheet1.xml', 'worksheets/sheet2.xml']), 'xl/worksheets/sheet1.xml': blankSheet(45e6), 'xl/worksheets/sheet2.xml': blankSheet(45e6) });
  // 400,000 rows that hold nothing, then one that does: slow to get through, and nothing wrong with it
  let hollow = ''; for (let i = 1; i <= 400000; i++) hollow += `<row r="${i}"><c r="A${i}"><v></v></c></row>`;
  const SLOW_XLSX = zip({ 'xl/workbook.xml': BOOK([['Slow', 'rId1']]), 'xl/_rels/workbook.xml.rels': RELS(['worksheets/sheet1.xml']), 'xl/worksheets/sheet1.xml': SHEET(hollow + `<row r="400001">${cT('A400001', 'Item')}</row><row r="400002">${cT('A400002', 'SLOW ITEM')}</row>`) });
  const BIG_DOCX = zip({ 'word/document.xml': Buffer.concat([Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'), Buffer.alloc(70e6, 0x20), Buffer.from('</w:body></w:document>')]) });
  const books = await Q.page.evaluate(async ([num, six, big, slow, docx]) => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js'), D = await import('./js/docx.js');
    const file = (b64, name) => new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name), why = async f => { try { await f(); return 'read'; } catch (e) { return (e.code || '') + ': ' + e.message; } };
    const t = await T.readTableFile(file(num, 'numbers.xlsx')), L = G.layout(t.sheets[0].rows), b = G.buildItems(L, G.guessColumns(L));
    const typed = await T.readTableText('Item,Value\nSony FX6,6000\nSigma 18-35,2300\nFilter set,308.625\n'), TL = G.layout(typed.sheets[0].rows);
    let stop = false; setTimeout(() => { stop = true; }, 40);
    return {
      rows: t.sheets[0].rows, values: b.items.map(x => [x.name, x.serial, x.value]), typed: G.buildItems(TL, G.guessColumns(TL)).items.map(x => x.value),
      six: (await T.readTableFile(file(six, 'six.xlsx'))).sheets.map(s => s.name),
      stopped: await why(() => T.readTableFile(file(slow, 'slow.xlsx'), { abandoned: () => stop })),
      big: await why(() => T.readTableFile(file(big, 'two-big.xlsx'))),
      docx: await why(() => D.docxToLines(file(docx, 'huge.docx'))),
    };
  }, [NUM_XLSX, SAME_SIX, TWO_BIG, SLOW_XLSX, BIG_DOCX].map(b => b.toString('base64')));
  ok('.xlsx: a number cell is the number it holds: 308.625 under “Value” is 308.63, not 308,625, and the row says which of its cells were numbers', same(books.values.map(x => x[2]), [6000, 2300, 308.63]) && same(books.rows[3], { n: 4, cells: ['Filter set', '000007', '308.625'], nums: [2] }) && same(books.rows[0], { n: 1, cells: ['Item', 'Serial number', 'Value'] }), JSON.stringify([books.values, books.rows[3]]));
  ok('…the same figures typed into a CSV are still read the way the column writes its numbers (the rule for text is unchanged)', same(books.typed, [6000, 2300, 308625]), JSON.stringify(books.typed));
  ok('.xlsx: a code kept as a number under a format of zeros keeps its zeros (000123), as text', same(books.values.map(x => x[1]), ['000123', '000045', '000007']), JSON.stringify(books.values));
  ok('.xlsx: a worksheet the workbook names six times is read once', same(books.six, ['Copy 1']), JSON.stringify(books.six));
  ok('.xlsx: two worksheets that each unpack to less than the limit for one, but together to more than a workbook may, are stopped', /^big: This file unpacks into more than Vdex will read\./.test(books.big), books.big);
  ok('.xlsx: a read that nobody waits for any more stops instead of running to its end', /^abandoned: /.test(books.stopped), books.stopped);
  ok('a Word file whose text unpacks into far more than a script is stopped too', /^big: This \.docx file holds too much to open$/.test(books.docx), books.docx);
  // choosing another list while a slow one is still being read: the later choice is the one shown, and it stays
  await openImport(Q.page); await Q.page.locator('#gi-paste').fill('Item\nQuick one\n');
  await give(Q.page, named('slow.xlsx', SLOW_XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  await Q.page.locator('.sheet .gi-use').click(); await previewed(Q.page);
  const quick0 = await text(Q.page, '.sheet .gi-source'); await sleep(5000);
  const quick1 = { source: await text(Q.page, '.sheet .gi-source'), sample: await text(Q.page, '.sheet .gi-sample'), sum: await sum(Q.page) };
  ok('a list chosen while a slower one is still being read is the one shown, and the slower one does not push it aside when it arrives', /^the pasted text: 2 lines/.test(quick0) && /^the pasted text: 2 lines/.test(quick1.source) && /Quick one/.test(quick1.sample) && !/SLOW ITEM/.test(quick1.sample) && quick1.sum === 'Adds 1.', JSON.stringify([quick0, quick1]));
  await Q.page.keyboard.press('Escape'); await sleep(200);

  /* ============================== lists made to be slow ============================== */
  const slow = await Q.page.evaluate(async () => {
    const T = await import('./js/table-read.js'), G = await import('./js/gear-columns.js');
    const gaps = []; let last = performance.now(); const beat = setInterval(() => { const now = performance.now(); gaps.push(now - last); last = now; }, 10);
    const timed = async f => { gaps.length = 0; last = performance.now(); const t0 = performance.now(), got = await f(); return { ms: Math.round(performance.now() - t0), pause: Math.round(Math.max(0, ...gaps)), got }; };
    const out = {};
    // 2,000 lines of a letter, 1,990 spaces and another letter; then the same with commas and with brackets
    out.spaces = await timed(async () => (await T.readTableText(Array.from({ length: 2000 }, (_, i) => 'x' + i + ' '.repeat(1990) + 'y').join('\n'))).sheets[0].rows.length);
    out.commas = await timed(async () => (await T.listLines(Array.from({ length: 1000 }, (_, i) => ({ n: i + 1, cells: ['a' + i + ','.repeat(1990) + 'b'] })))).length);
    out.brackets = await timed(async () => (await T.listLines(Array.from({ length: 1000 }, (_, i) => ({ n: i + 1, cells: ['a' + i + '(('.repeat(990) + 'b'] })))).length);
    // a table whose cells are made to trip the value patterns, against one with ordinary text of the same length
    const table = cells => { let s = 'Item,Qty,Value,Notes\n'; for (let i = 0; i < 600; i++) s += `Thing ${i},${cells.map(c => '"' + c + '"').join(',')}\n`; return s; };
    const build = async cells => { const t = await T.readTableText(table(cells)); return timed(async () => { const L = G.layout(t.sheets[0].rows); return G.buildItems(L, G.guessColumns(L)).items.length; }); };
    out.plain = await build(['a'.repeat(1992), 'b'.repeat(1996), 'c'.repeat(1990)]);
    out.nasty = await build(['2' + ' '.repeat(1990) + 'q', '-'.repeat(1995) + 'x', 'sub' + ' '.repeat(1990) + 'x']);
    clearInterval(beat);
    return out;
  });
  ok('2,000 lines of 2,000 characters, almost all spaces, are read in a moment, and the page keeps answering meanwhile', slow.spaces.got === 2001 && slow.spaces.ms < 6000 && slow.spaces.pause < 1500, JSON.stringify(slow.spaces));
  ok('…as are 1,000 lines that are runs of commas or of brackets', slow.commas.got === 1001 && slow.commas.ms < 2500 && slow.brackets.got === 1001 && slow.brackets.ms < 2500, JSON.stringify([slow.commas, slow.brackets]));
  ok('cells made to trip the patterns for numbers and totals take about as long as ordinary text of the same length', slow.nasty.got === 600 && slow.nasty.ms <= slow.plain.ms * 4 + 250, `made to be slow ${slow.nasty.ms} ms, ordinary ${slow.plain.ms} ms`);

  /* ============================== one's own items and kits, when a list was made from them ============================== */
  const own = await Q.page.evaluate(async () => {
    const s = await import('./js/store.js'), M = await import('./js/gear-import.js');
    const mine = () => [{ id: 'g1', name: 'Sony FX6', category: 'Camera', serial: '4512345', location: 'Van', qty: 1, value: 6500, notes: 'edited since', updatedAt: 5 }, { id: 'g2', name: 'Aputure 600d', category: 'Lighting', serial: '', location: '', qty: 4, value: 1900, notes: '', updatedAt: 5 }, { id: 'g3', name: 'Rode NTG', category: 'Audio', serial: '', location: '', qty: 1, value: 300, notes: '', updatedAt: 5 }];
    const snap = () => JSON.stringify([s.db.gear.map(({ updatedAt, ...x }) => x), s.db.kits.map(({ updatedAt, ...x }) => x)]);
    // a list made from g1 and g2 as they once were, with the kit as it once was (two items)
    const old = [{ ref: 'g1', name: 'Sony FX6', category: 'Camera', serial: '4512345', location: 'Shelf A', qty: 1, value: 5000, notes: 'march' }, { ref: 'g2', name: 'Aputure 600d', category: 'Lighting', serial: '', location: '', qty: 2, value: 1900, notes: '' }];
    const kits = [{ ref: 'k1', name: 'Interview set', description: '', notes: '', items: [[0, 1], [1, 2]] }];
    s.update(d => { d.gear = mine(); d.kits = [{ id: 'k1', name: 'Interview set', description: '', gear: ['g1', 'g2', 'g3'], gearQty: { g2: 4 }, notes: '', updatedAt: 5 }]; d.bookings = []; });
    const before = snap(), plan = M.planGearImport(old), out = {};
    out.ownRows = plan.rows.map(r => [r.why, r.action, r.match && r.match.id]); out.ownCounts = M.planCounts(plan);
    const done = M.applyGearImport(plan, { kits, from: 'Me' });
    out.ownUntouched = snap() === before; out.ownDone = [done.added.length, done.updated.length, done.skipped, done.kits.length, done.kitsBefore.length];
    // the person may still choose Update for one of them: then that item, and the kit that names it, take the list's
    plan.rows[0].action = 'update'; M.applyGearImport(plan, { kits, from: 'Me' });
    out.chosen = [s.db.gear[0].location, s.db.gear[0].value, s.db.gear[1].qty, s.db.kits[0].gear];
    // copies added from someone else's list before are still updated by default; skipping them all leaves their kit alone
    s.update(d => { d.gear = []; d.kits = []; });
    const theirs = [{ ref: 'x1', name: 'Sony FX6', category: 'Camera', serial: '9000001', location: '', qty: 1, value: 5000, notes: '' }, { ref: 'x2', name: 'Sigma 24-70', category: 'Lens', serial: '9000002', location: '', qty: 1, value: 1100, notes: '' }], theirKit = [{ ref: 'xk', name: 'Interview kit', description: '', notes: '', items: [[0, 1], [1, 1]] }];
    M.applyGearImport(M.planGearImport(theirs), { kits: theirKit, from: 'Pat Producer' });
    s.update(d => { d.gear.push({ id: 'light', name: 'My light', category: 'Lighting', serial: '', qty: 1, value: 100, updatedAt: 1 }); d.kits[0].gear.push('light'); });
    const again = M.planGearImport(theirs);
    out.againRows = again.rows.map(r => [r.why, r.action]);
    again.rows.forEach(r => { r.action = 'skip'; });
    const skipped = M.applyGearImport(again, { kits: theirKit, from: 'Pat Producer' });
    out.skippedKit = [s.db.kits.length, s.db.kits[0].gear.length, s.db.kits[0].gear.includes('light'), skipped.kits.length, skipped.skipped];
    const third = M.planGearImport(theirs); M.applyGearImport(third, { kits: theirKit, from: 'Pat Producer' });
    out.updatedKit = [s.db.kits.length, s.db.kits[0].gear.length, s.db.kits[0].gear.includes('light')];
    // a new kit whose items were all skipped as duplicates is still made, of the owned items
    s.update(d => { d.kits = []; });
    const fourth = M.planGearImport(theirs); fourth.rows.forEach(r => { r.action = 'skip'; });
    M.applyGearImport(fourth, { kits: [{ ref: 'other', name: 'Second kit', description: '', notes: '', items: [[0, 1], [1, 1]] }], from: 'Pat Producer' });
    out.newKit = [s.db.kits.length, (s.db.kits[0] || {}).name, ((s.db.kits[0] || {}).gear || []).length];
    s.update(d => { d.gear = []; d.kits = []; });
    return out;
  });
  ok('a list made from one’s own items is found as such, and every row starts on Skip: one’s own item is at least as new as a list made from it', same(own.ownRows, [['ref', 'skip', 'g1'], ['ref', 'skip', 'g2']]) && same(own.ownCounts, { add: 0, update: 0, skip: 2 }), JSON.stringify([own.ownRows, own.ownCounts]));
  ok('…so adding it as it stands changes nothing: not the items edited since, and not the kit, which keeps the item added to it since', own.ownUntouched && same(own.ownDone, [0, 0, 2, 0, 0]), JSON.stringify(own.ownDone));
  ok('…while choosing Update for a row still updates that item, and then the kit that names it', same(own.chosen, ['Shelf A', 5000, 4, ['g1', 'g2']]), JSON.stringify(own.chosen));
  ok('items added from someone else’s list before still start on Update; with every row skipped, the kit made from that list is left as it is (an item put into it since stays)', same(own.againRows, [['ref', 'update'], ['ref', 'update']]) && same(own.skippedKit, [1, 3, true, 0, 2]), JSON.stringify([own.againRows, own.skippedKit]));
  ok('…with the rows updated, that kit is the list’s again; and a new kit whose rows were all skipped is still made of the owned items', same(own.updatedKit, [1, 2, false]) && same(own.newKit, [1, 'Second kit', 2]), JSON.stringify([own.updatedKit, own.newKit]));

  /* ============================== a tap beside the sheet, and where Undo goes ============================== */
  await seed(Q.page, []);
  await openImport(Q.page); await paste(Q.page, 'Sony FX6,FX6-0001,Van\nZoom H6,H6-00003,Shelf A\nSigma 18-35,SIG-0002,Shelf B\nRode NTG,RD-00011,Shelf A\n'); await previewed(Q.page);
  await setColumn(Q.page, 'Column C', 'notes'); await sleep(120);
  await Q.page.mouse.click(20, 400); await sleep(300);
  ok('a tap beside the Import sheet does not close it: the columns that were set are still there', (await Q.page.locator('.sheet .gi-cols').count()) === 1 && (await columns(Q.page))['Column C'] === 'notes', JSON.stringify(await columns(Q.page).catch(() => 'closed')));
  await Q.page.locator('.sheet button', { hasText: 'Choose another list' }).click(); await Q.page.waitForSelector('.sheet .gi-choose');
  await Q.page.mouse.click(20, 400); await sleep(300);
  ok('…nor on the first step, where the pasted list is still in its box; Escape still closes it', (await Q.page.locator('#gi-paste').inputValue().catch(() => '')).startsWith('Sony FX6,FX6-0001,Van') && await (async () => { await Q.page.keyboard.press('Escape'); await sleep(250); return (await Q.page.locator('.sheet').count()) === 0; })());
  // the bar's time is run on a clock the test can move
  await openImport(Q.page); await paste(Q.page, 'Item,Serial number\nSony FX6,FX6-1\nZoom H6,H6-1\nRode NTG,NTG-9\n'); await previewed(Q.page);
  await Q.page.clock.install();
  await add(Q.page);
  const said = await Q.page.evaluate(() => (document.getElementById('sr-live') || {}).textContent || '');
  ok('after an import a screen reader hears the numbers and where Undo will be: under Import… until Vdex is closed', said === '3 added. Undo is offered for a short while, and under Import… until Vdex is closed.', said);
  await Q.page.clock.fastForward(21000); await sleep(150);
  ok('the Undo bar does not leave while the focus is on it', (await Q.page.locator('.undo-bar').count()) === 1 && await Q.page.evaluate(() => document.activeElement.textContent === 'Undo'));
  await Q.page.evaluate(() => document.activeElement.blur()); await Q.page.clock.fastForward(5000); await sleep(150);
  const gone = { bar: await Q.page.locator('.undo-bar').count(), toasts: await Q.page.locator('.toast').allInnerTexts() };
  ok('once the focus has left it and its time is up, the bar goes and a line on the page says where Undo is now', gone.bar === 0 && same(gone.toasts, ['Undo is still under Import… until Vdex is closed']), JSON.stringify(gone));
  await openImport(Q.page);
  ok('…and it is there', /The last import \(3 added, from the pasted text\) can still be undone/.test(await text(Q.page, '.sheet .gi-last')), await text(Q.page, '.sheet .gi-last'));
  await Q.page.locator('.sheet .gi-last button').click(); await sleep(300);
  await Q.page.keyboard.press('Escape'); await sleep(200);
  await Q.ctx.close();

  /* ============================== room in the browser's storage, and saying so when a save is refused ============================== */
  const F = await open();
  // how many more characters this browser will keep for the app, found by trying; pad() grows or shrinks the database by that many
  const room = page => page.evaluate(() => { let lo = 0, hi = 12e6; while (hi - lo > 256) { const mid = (lo + hi) >> 1; try { localStorage.setItem('zz-room', 'x'.repeat(mid)); lo = mid; } catch { hi = mid; } } localStorage.removeItem('zz-room'); return lo; });
  const pad = (page, by) => page.evaluate(n => import('./js/store.js').then(s => { s.update(d => { const bio = d.profile.bio || ''; d.profile = { ...d.profile, bio: n >= 0 ? bio + 'b'.repeat(n) : bio.slice(0, n) }; }); }), by);
  const stored = page => page.evaluate(() => import('./js/store.js').then(s => { const d = JSON.parse(localStorage.getItem('logi-db-v1') || '{}'); return { gear: (d.gear || []).length, bio: ((d.profile || {}).bio || '').length, inMemory: (s.db.profile.bio || '').length }; }));
  const fullLine = page => page.evaluate(() => { const p = document.querySelector('.sheet .gi-sum + p.warn'); return p && !p.hidden ? p.textContent : ''; });
  await F.page.evaluate(() => window.logiGo('gear'));
  await pad(F.page, (await room(F.page)) - 90000); await sleep(200);
  const left90 = await room(F.page);
  let shortLines = ''; for (let i = 0; i < 600; i++) shortLines += `Thing ${i}\n`;
  await openImport(F.page); await paste(F.page, shortLines); await previewed(F.page);
  await F.page.locator('.sheet .gi-go').click(); await sleep(500);
  const tooBig = { line: await fullLine(F.page), open: await F.page.locator('.sheet .gi-cols').count(), gear: (await gear(F.page)).length, bar: await F.page.locator('.undo-bar').count(), stored: (await stored(F.page)).gear, probe: await F.page.evaluate(() => localStorage.getItem('logi-import-room')) };
  ok('a list that needs more room than the browser has left is turned down before anything is added: 600 short lines are about 120,000 characters once they are items, and 90,000 are free', left90 > 80000 && left90 < 95000 && tooBig.line === 'This list is bigger than the space Vdex has on this device, so nothing was added. Import it in parts, or leave out a column such as Notes.' && tooBig.open === 1 && tooBig.gear === 0 && tooBig.bar === 0 && tooBig.stored === 0 && tooBig.probe === null, JSON.stringify({ left90, ...tooBig }));
  await pad(F.page, -200000); await sleep(200);
  await add(F.page);
  const fits = { bar: await bar(F.page), stored: (await stored(F.page)).gear };
  await F.page.reload(); await F.page.waitForSelector('#rolodex .drum-btn');
  ok('…with room made, the same list goes in, is saved, and is still there after a reload', /^600 added/.test(fits.bar) && fits.stored === 600 && (await gear(F.page)).length === 600, JSON.stringify(fits));
  // rows that update what is owned take room too
  await F.page.evaluate(() => import('./js/store.js').then(s => s.update(d => { d.gear = Array.from({ length: 300 }, (_, i) => ({ id: 'own' + i, name: 'Owned ' + i, category: '', serial: '', location: '', qty: 1, value: '', notes: '', updatedAt: 1 })); d.deleted = {}; })));
  await F.page.evaluate(() => window.logiGo('gear'));
  await pad(F.page, (await room(F.page)) - 40000); await sleep(200);
  let noted = 'Item\tNotes\n'; for (let i = 0; i < 300; i++) noted += `Owned ${i}\t${'n'.repeat(300)}\n`;
  await openImport(F.page); await paste(F.page, noted); await previewed(F.page);
  await F.page.locator('.sheet .gi-dups select.gi-all').selectOption('update'); await sleep(100);
  const updates = await F.page.locator('.sheet .gi-go').innerText();
  await F.page.locator('.sheet .gi-go').click(); await sleep(500);
  ok('…an import that only updates is measured as well: 300 notes of 300 characters do not fit into 40,000, so nothing is changed', updates === 'Update 300 items' && /^This list is bigger than the space Vdex has on this device, so nothing was added\./.test(await fullLine(F.page)) && (await gear(F.page)).every(x => x.notes === ''), updates + ' / ' + await fullLine(F.page));
  await F.page.keyboard.press('Escape'); await sleep(250);
  // any other change the browser refuses to save is said, once, and saved with the next one that fits
  await pad(F.page, 80000); await sleep(300);
  const unsaved = { toasts: await F.page.locator('.toast').allInnerTexts(), spoken: await F.page.evaluate(() => (document.getElementById('sr-live') || {}).textContent || ''), ...(await stored(F.page)) };
  const NOT_SAVED = 'Not enough storage to save your last change: free some space, or erase old logs and bookings. Until then, changes may be gone when Vdex is closed.';
  ok('a change the browser will not save is said at once, on the page and to a screen reader, instead of being lost without a word', unsaved.toasts.filter(x => x === NOT_SAVED).length === 1 && unsaved.spoken === NOT_SAVED && unsaved.inMemory === unsaved.bio + 80000, JSON.stringify(unsaved));
  await sleep(3000); await pad(F.page, 10); await sleep(300);
  ok('…once a minute at most, however many changes follow', !(await F.page.locator('.toast').allInnerTexts()).includes(NOT_SAVED) && (await stored(F.page)).inMemory === unsaved.bio + 80010);
  await pad(F.page, -300000); await sleep(300);
  const savedAgain = await stored(F.page);
  ok('…and the next change that fits saves everything as it is now', savedAgain.bio === savedAgain.inMemory && savedAgain.gear === 300, JSON.stringify(savedAgain));
  await F.ctx.close();
  // with a PIN the encrypted copy lives in the same storage and grows with the list, so it is counted too
  const N = await open();
  await N.page.evaluate(() => import('./js/lock.js').then(l => l.setPin('246810'))); await N.page.waitForFunction(() => !!localStorage.getItem('logi-vault'), null, { timeout: 60000 });
  const vault = page => page.evaluate(() => (localStorage.getItem('logi-vault') || '').length);
  const leave = async (page, want) => { // both copies written, and about `want` characters free
    for (let k = 0; k < 4; k++) { const free = await room(page); if (Math.abs(free - want) < 12000) break; const v0 = await vault(page); await pad(page, Math.round((free - want) / 2.34)); await page.waitForFunction(v => (localStorage.getItem('logi-vault') || '').length !== v, v0, { timeout: 20000 }); await sleep(150); }
    return room(page);
  };
  await N.page.evaluate(() => window.logiGo('gear'));
  const left200 = await leave(N.page, 200000);
  await openImport(N.page); await paste(N.page, shortLines); await previewed(N.page);
  await N.page.locator('.sheet .gi-go').click(); await sleep(600);
  const pinFull = { line: await fullLine(N.page), gear: (await gear(N.page)).length, toasts: await N.page.locator('.toast').allInnerTexts() };
  ok('with a PIN, a list whose items would fit but whose encrypted copy would not is turned down too: 200,000 characters are free, the items need 120,000 and the encrypted copy about 180,000 more', Math.abs(left200 - 200000) < 12000 && /^This list is bigger than the space Vdex has on this device/.test(pinFull.line) && pinFull.gear === 0 && pinFull.toasts.length === 0, JSON.stringify({ left200, ...pinFull }));
  await N.page.keyboard.press('Escape'); await sleep(250);
  const left600 = await leave(N.page, 600000), vaultBefore = await vault(N.page);
  await openImport(N.page); await paste(N.page, shortLines); await previewed(N.page);
  await add(N.page); await N.page.waitForFunction(v => (localStorage.getItem('logi-vault') || '').length > v + 100000, vaultBefore, { timeout: 20000 }).catch(() => {});
  const pinFits = { grew: (await vault(N.page)) - vaultBefore, stored: (await stored(N.page)).gear, toasts: (await N.page.locator('.toast').allInnerTexts()).filter(x => /storage/i.test(x)), probe: await N.page.evaluate(() => localStorage.getItem('logi-import-room')) };
  ok('…and with room for both copies it goes in, and both are written', Math.abs(left600 - 600000) < 12000 && pinFits.stored === 600 && pinFits.grew > 150000 && pinFits.toasts.length === 0 && pinFits.probe === null, JSON.stringify({ left600, ...pinFits }));
  await N.page.locator('#lockBtn').click(); await N.page.waitForSelector('.lock'); await sleep(150);
  ok('the Undo bar is not drawn on the lock screen', (await N.page.locator('.undo-bar').count()) === 1 && !(await N.page.locator('.undo-bar').isVisible()));
  await N.ctx.close();

  /* ============================== a spreadsheet shared to the installed web app ============================== */
  const manifest = JSON.parse(fs.readFileSync(path.join(process.env.VDEX_ROOT || path.join(__dirname, '..', '..'), 'manifest.webmanifest'), 'utf8')), accepted = manifest.share_target.params.files[0].accept;
  ok('the web app’s share target lists CSV, tab-separated and Excel files beside scripts, under the field the service worker reads', manifest.share_target.params.files[0].name === 'file' && ['.csv', '.tsv', '.xlsx', 'text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx', 'text/plain'].every(x => accepted.includes(x)), accepted.join(' '));
  const SW = await browser.newContext({ viewport: { width: 420, height: 900 } }); // this one keeps the service worker: it is what receives a shared file
  await SW.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); }); await SW.addInitScript(acceptTerms().content);
  const sp = watch(await SW.newPage());
  await sp.goto(BASE); await sp.waitForSelector('#rolodex .drum-btn'); await sp.waitForFunction(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 60000 });
  // the phone's share sheet posts the file to ./share as a form, the way the manifest says
  await sp.evaluate(() => { const f = document.createElement('form'), i = document.createElement('input'), dt = new DataTransfer(); f.method = 'POST'; f.action = './share'; f.enctype = 'multipart/form-data'; i.type = 'file'; i.name = 'file'; dt.items.add(new File(['Item,Serial number,Value\nSony FX6,FX6-1,6000\nZoom H6,H6-1,300\n'], 'my kit.csv', { type: 'text/csv' })); i.files = dt.files; f.append(i); document.body.append(f); f.submit(); });
  await sp.waitForSelector('.sheet', { timeout: 30000 }); await sleep(200);
  const sharedIn = { title: await sp.locator('.sheet').getAttribute('aria-label'), buttons: await sp.locator('.sheet button.btn').allInnerTexts(), url: sp.url() };
  await sp.locator('.sheet button', { hasText: 'Kit list for Equipment' }).click(); await previewed(sp);
  ok('a CSV posted to the share target is parked by the service worker, picked up by the app and offered as the kit list; it opens on the preview with nothing added', sharedIn.title === 'A file for Vdex' && sharedIn.buttons.includes('🎥 Kit list for Equipment') && sharedIn.buttons.includes('🎬 Script for TC Notes') && !/share/.test(sharedIn.url) && (await sum(sp)) === 'Adds 2.' && /my kit\.csv: 2 rows/.test(await text(sp, '.sheet .gi-source')) && (await gear(sp)).length === 0, JSON.stringify(sharedIn) + ' ' + await sum(sp));
  await sp.keyboard.press('Escape'); await sleep(250);
  await sp.evaluate(b64 => import('./js/share-in.js').then(m => m.arrived(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'kit list.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))), NUM_XLSX.toString('base64')); await sp.waitForSelector('.sheet'); await sleep(150);
  const workbookIn = await sp.locator('.sheet button.btn').allInnerTexts();
  await sp.locator('.sheet button', { hasText: 'Kit list for Equipment' }).click(); await previewed(sp);
  ok('an Excel workbook handed to Vdex is offered as the kit list only (it cannot be a script or a shot list), and opens on the preview', same(workbookIn, ['🎥 Kit list for Equipment']) && (await sum(sp)) === 'Adds 3.', workbookIn.join('|') + ' ' + await sum(sp));
  await sp.keyboard.press('Escape'); await sleep(250);
  await sp.evaluate(() => import('./js/share-in.js').then(m => m.arrived(new File(['Item,Serial number\nSony FX6,FX6-1\n'], 'shared', { type: 'text/csv' })))); await sp.waitForSelector('.sheet'); await sleep(150);
  ok('a spreadsheet that arrives without a name that says so is known by its type', (await sp.locator('.sheet button.btn').allInnerTexts()).includes('🎥 Kit list for Equipment'));
  await sp.keyboard.press('Escape'); await sleep(200);
  await SW.close();

  /* ============================== how it looks: 360 px and 1200 px ============================== */
  for (const [width, height, light] of [[360, 740, false], [1200, 800, true]]) {
    const V = await open({ width, height, light });
    await V.page.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); s.update(d => { d.gear[5].serial = 'MKH-2219004'; d.gear[7].serial = 'FT75-330218'; }); })); await sleep(200);
    await V.page.evaluate(() => window.logiGo('gear')); await V.page.waitForSelector('#page .subactions');
    const pageFit = await V.page.evaluate(() => { const b = [...document.querySelectorAll('#page .subactions button')].find(x => /Import/.test(x.textContent)).getBoundingClientRect(); return { h: b.height, inside: b.left >= 0 && b.right <= innerWidth, wide: document.documentElement.scrollWidth - innerWidth }; });
    ok(`${width} px: the Import… button fits the Equipment page and is big enough to tap`, pageFit.h >= 44 && pageFit.inside && pageFit.wide <= 0, JSON.stringify(pageFit));
    await openImport(V.page); await sleep(350);
    await V.page.screenshot({ path: `${OUT}/gear-import-start-${width}.png` });
    const fit = () => V.page.evaluate(() => {
      const body = document.querySelector('.sheet .sheet-body'), sheet = document.querySelector('.sheet').getBoundingClientRect();
      const controls = [...body.querySelectorAll('select, button, textarea, label.check, summary')].filter(e => e.offsetParent), boxes = [...body.querySelectorAll('.gi-col, .gi-results li, .gi-results p, .gi-sum, .gi-problems')];
      return { wide: body.scrollWidth - body.clientWidth, sheetIn: sheet.left >= 0 && sheet.right <= innerWidth + 0.5, outside: [...controls, ...boxes].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < sheet.left - 0.5 || r.right > sheet.right + 0.5); }).length, small: controls.filter(e => e.getBoundingClientRect().height < 43.5).map(e => e.tagName + ':' + (e.textContent || '').slice(0, 20)), n: controls.length };
    });
    const f0 = await fit();
    ok(`${width} px: the first step fits: nothing off the side, every control at least 44 px high`, f0.wide <= 0 && f0.sheetIn && f0.outside === 0 && f0.small.length === 0 && f0.n >= 3, JSON.stringify(f0));
    await give(V.page, path.join(FIX, 'gear-kit-app-sortly-style.csv')); await previewed(V.page); await sleep(350);
    await V.page.screenshot({ path: `${OUT}/gear-import-columns-${width}.png` });
    const f1 = await fit();
    ok(`${width} px: the preview fits: no sideways scrolling, every column card, control and result inside the sheet, every control at least 44 px high`, f1.wide <= 0 && f1.sheetIn && f1.outside === 0 && f1.small.length === 0 && f1.n >= 20, JSON.stringify(f1));
    const cards = await V.page.evaluate(() => { const c = [...document.querySelectorAll('.sheet .gi-col')].map(e => e.getBoundingClientRect()); return { perRow: c.filter(r => Math.abs(r.top - c[0].top) < 2).length, clipped: [...document.querySelectorAll('.sheet .gi-head')].filter(e => e.scrollWidth > e.clientWidth + 1).length, named: [...document.querySelectorAll('.sheet .gi-col select')].every(e => /^What the column “.+” is$/.test(e.getAttribute('aria-label'))), status: document.querySelector('.sheet .gi-sum').getAttribute('role') }; });
    ok(`${width} px: the column cards are ${width < 500 ? 'one to a row' : 'several to a row'}, their headings whole, each control named for a screen reader, the summary announced`, (width < 500 ? cards.perRow === 1 : cards.perRow >= 2) && cards.clipped === 0 && cards.named && cards.status === 'status', JSON.stringify(cards));
    await V.page.locator('.sheet .gi-go').scrollIntoViewIfNeeded(); await sleep(200);
    await V.page.screenshot({ path: `${OUT}/gear-import-summary-${width}.png` });
    const end = await V.page.evaluate(() => { const g = document.querySelector('.sheet .gi-go').getBoundingClientRect(), s = document.querySelector('.sheet .gi-sum').getBoundingClientRect(); return { go: g.top >= 0 && g.bottom <= innerHeight && g.left >= 0 && g.right <= innerWidth, sum: s.top >= 0 && s.bottom <= innerHeight, text: document.querySelector('.sheet .gi-sum').textContent, label: document.querySelector('.sheet .gi-go').textContent }; });
    ok(`${width} px: the summary and the last button are on screen together`, end.go && end.sum && end.text === 'Adds 8, skips 3.' && end.label === 'Add 8 items to my Equipment', JSON.stringify(end));
    await add(V.page); await sleep(300);
    await V.page.screenshot({ path: `${OUT}/gear-import-done-${width}.png` });
    const ub = await V.page.evaluate(() => { const b = document.querySelector('.undo-bar'), r = b.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, centred: Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2, small: [...b.querySelectorAll('button')].filter(e => e.getBoundingClientRect().height < 43.5 || e.getBoundingClientRect().width < 43.5).length, text: b.innerText.replace(/\s+/g, ' ') }; });
    ok(`${width} px: the Undo bar is on screen, centred, with buttons big enough to tap`, ub.inside && ub.centred && ub.small === 0 && /^8 added, 3 skipped Undo/.test(ub.text), JSON.stringify(ub));
    await V.page.locator('#page .subactions button', { hasText: 'Share…' }).click(); await V.page.waitForSelector('.sheet'); await sleep(150);
    ok(`${width} px: the Undo bar steps aside while a sheet is open, and comes back`, !(await V.page.locator('.undo-bar').isVisible()) && await (async () => { await V.page.keyboard.press('Escape'); await sleep(200); return V.page.locator('.undo-bar').isVisible(); })());
    const aside = {};
    await V.page.locator('#menuBtn').click(); await V.page.locator('#menu').waitFor({ state: 'visible' }); await sleep(120); aside.menu = await V.page.locator('.undo-bar').isVisible();
    await V.page.keyboard.press('Escape'); await V.page.locator('#menu').waitFor({ state: 'hidden' }); await sleep(120); aside.afterMenu = await V.page.locator('.undo-bar').isVisible();
    await V.page.locator('#searchBtn').click(); await V.page.waitForFunction(() => document.body.classList.contains('search-open')); await sleep(120); aside.search = await V.page.locator('.undo-bar').isVisible();
    await V.page.keyboard.press('Escape'); await V.page.waitForFunction(() => !document.body.classList.contains('search-open')); await sleep(120); aside.afterSearch = await V.page.locator('.undo-bar').isVisible();
    ok(`${width} px: it steps aside for the menu and for the search as well, and comes back each time`, same(aside, { menu: false, afterMenu: true, search: false, afterSearch: true }), JSON.stringify(aside));
    await V.ctx.close();
  }

  /* ============================== nothing leaves the device ============================== */
  const away = requests.filter(q => !q.startsWith('GET ' + BASE) && !q.startsWith('GET https://api.open-meteo.com/') && !q.startsWith('GET blob:') && !q.startsWith('GET data:'));
  ok('through all of this nothing was sent anywhere: every request was a GET for one of the app’s own files', away.length === 0 && requests.length > 0, away.slice(0, 5).join(' | '));
  ok('no script errors and no Content-Security-Policy violations', errors.length === 0, errors.slice(0, 5).join(' | '));
  ok('nothing from a file ever ran: no dialog opened', dialogs.length === 0, dialogs.join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e)); process.exit(1); });

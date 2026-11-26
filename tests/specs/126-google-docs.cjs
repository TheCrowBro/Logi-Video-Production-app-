// A Google Doc as a script (js/gdocs-pick.js): offered only once Vdex's Google project has a picker key; then Google's
// sign-in, Google's file picker and Drive's export, each stood in for here, give the Add script sheet the Doc as a
// Word file. The page's own Content-Security-Policy is the real one, so the picker's script must be allowed by it.
const { chromium } = require('playwright');
const zlib = require('zlib');
const { acceptTerms } = require('../helpers.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const APP = process.env.VDEX_URL || 'http://localhost:8123/';
// A small Word file: a heading line, then a VIDEO | AUDIO table (as spec 122 builds them).
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
const p = t => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`, c = t => `<w:tc>${p(t)}</w:tc>`;
const DOC = zip({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', 'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('Brand film')}<w:tbl><w:tr>${c('VIDEO')}${c('AUDIO')}</w:tr><w:tr>${c('Wide of the brewery')}${c('Every batch starts before sunrise.')}</w:tr></w:tbl></w:body></w:document>` });
const CONFIG = key => `export const CLOUD_APPS = { icloud: { container: '', apiToken: '', desktopToken: '' }, dropbox: '', google: '123456789012-test.apps.googleusercontent.com', microsoft: '', googleCalendar: true, googlePickerKey: '${key}' };`;
// Google's sign-in script and the picker's, as small stand-ins.
const GIS = `window.google = window.google || {}; google.accounts = { oauth2: { initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok-123', expires_in: 3600, scope: cfg.scope }), 20) }) }, id: { initialize() {}, prompt() {} } };`;
const GAPI = `window.gapi = { load: (name, opts) => { window.google = window.google || {}; const P = { Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Document: { ID: 'id', NAME: 'name' }, ViewId: { DOCUMENTS: 'docs' }, DocsViewMode: { LIST: 'list' } };
  P.DocsView = class { setMimeTypes(m) { window.__pickerMime = m; return this; } setMode() { return this; } };
  P.PickerBuilder = class { addView() { return this; } setOAuthToken(t) { window.__pickerToken = t; return this; } setDeveloperKey(k) { window.__pickerKey = k; return this; } setAppId(a) { window.__pickerApp = a; return this; } setTitle() { return this; } setCallback(cb) { this.cb = cb; return this; } build() { const cb = this.cb; return { setVisible: () => setTimeout(() => cb(window.__pickerCancel ? { action: 'cancel' } : { action: 'picked', docs: [{ id: 'doc-42', name: 'Brand film: script v2' }] }), 30) }; } };
  google.picker = P; (opts.callback || opts)(); } };`;

(async () => {
  const browser = await chromium.launch();
  const boot = async key => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 880 } });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: CONFIG(key) }));
    await ctx.route('https://accounts.google.com/gsi/client*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GIS }));
    await ctx.route('https://apis.google.com/js/api.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: GAPI }));
    ctx.exported = [];
    await ctx.route('https://www.googleapis.com/drive/v3/files/**', r => { ctx.exported.push({ url: r.request().url(), auth: r.request().headers().authorization }); r.fulfill({ status: 200, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', headers: { 'access-control-allow-origin': '*' }, body: DOC }); });
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    await ctx.addInitScript(acceptTerms());
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('console', m => { if (/Content Security Policy|Refused to/.test(m.text())) page.errors.push(m.text()); });
    await page.goto(APP); await page.waitForSelector('#rolodex .drum-btn');
    await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.openPracticeLog())); await sleep(500);
    await page.evaluate(() => import('./js/pages/tcnotes.js').then(m => m.showView('script'))); await sleep(300);
    await page.locator('.sc-head button', { hasText: 'Replace' }).click(); await page.waitForSelector('.sheet .imp-gdocs');
    return { ctx, page };
  };
  let { ctx, page } = await boot('');
  ok('without a picker key, Google Docs is offered as download-as-Word or paste, with no picker button', (await page.locator('.sheet .imp-gdrive').count()) === 0 && /download it as Word/.test(await page.locator('.sheet .imp-gdocs').innerText()));
  await ctx.close();
  ({ ctx, page } = await boot('picker-key-1'));
  ok('with one, 📄 Choose from Google Docs', (await page.locator('.sheet .imp-gdrive').count()) === 1);
  await page.locator('.sheet .imp-gdrive').click();
  await page.waitForFunction(() => /Brand film/.test(document.querySelector('.sheet .import-preview')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const picker = await page.evaluate(() => ({ token: window.__pickerToken, key: window.__pickerKey, app: window.__pickerApp, mime: window.__pickerMime }));
  ok('it signs in to Google for the drive.file permission and opens the picker with the token, the key and the project number, for Docs only', picker.token === 'tok-123' && picker.key === 'picker-key-1' && picker.app === '123456789012' && picker.mime === 'application/vnd.google-apps.document', JSON.stringify(picker));
  ok('the chosen Doc is fetched from Drive as a Word file, with the token', ctx.exported.length === 1 && /\/files\/doc-42\/export\?mimeType=application%2Fvnd\.openxmlformats/.test(ctx.exported[0].url) && ctx.exported[0].auth === 'Bearer tok-123', JSON.stringify(ctx.exported));
  ok('…and read like any Word file: its name, its lines, the VIDEO | AUDIO table understood', /Brand film script v2 — 3 lines/.test(await page.locator('.sheet .import-preview').innerText()), await page.locator('.sheet .import-preview').innerText());
  await page.locator('.sheet .btn.primary', { hasText: 'Replace script' }).click(); await sleep(400);
  ok('Replace script takes it, the video line as direction', await page.evaluate(() => import('./js/store.js').then(s => { const sc = s.db.logs.find(l => l.practice).script; return sc.paras.length === 3 && sc.paras[1].dir === true && !sc.paras[2].dir; })));
  await page.locator('.sc-head button', { hasText: 'Replace' }).click(); await page.waitForSelector('.sheet .imp-gdrive');
  await page.evaluate(() => { window.__pickerCancel = true; });
  await page.locator('.sheet .imp-gdrive').click(); await sleep(600);
  ok('closing the picker leaves the sheet as it was', (await page.locator('.sheet[aria-label="Replace script"]').count()) === 1 && !/Brand film/.test(await page.locator('.sheet .import-preview').innerText()) && ctx.exported.length === 1);
  ok('no errors, and nothing refused by the page’s Content-Security-Policy', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  await browser.close();
})().catch(e => { console.log('FAIL the Google Docs spec crashed — ' + (e && e.stack || e)); process.exit(1); });

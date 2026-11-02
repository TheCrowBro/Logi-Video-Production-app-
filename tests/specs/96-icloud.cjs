// iCloud through Apple's CloudKit web service, with Apple stood in for: one tap to Apple's page and back, a session
// that changes with every request, a big database split across records and read back whole, dated backups, a run-out
// sign-in, a full iCloud, a link carrying someone else's session, the calendar feed note, and Disconnect.
const { chromium } = require('playwright');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ICLOUD = { container: 'iCloud.test.vdex', apiToken: 'webtoken123', desktopToken: 'desktoptoken456' };
const IDS = { dropbox: '', google: '', microsoft: '', icloud: ICLOUD };
const synced = page => page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'synced', null, { timeout: 15000 }).then(() => true, () => false);
const utf8 = s => Buffer.byteLength(s, 'utf8');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // A stand-in for CloudKit: private records by name, sessions that change with every answer, Apple's sign-in page.
  const fakeApple = async ctx => {
    const ck = { records: new Map(), zone: false, valid: new Set(), n: 0, used: [], stale: 0, tokens: new Set(), quota: false, deny: false, delay: 0, biggest: 0, signIns: 0, zoneDeletes: 0 };
    const issue = () => { const t = 'S' + (++ck.n) + '+/='; ck.valid.add(t); return t; }; // + / = as in real tokens
    const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-apple-cloudkit-web-auth-token' };
    await ctx.route('https://api.apple-cloudkit.com/**', async route => {
      const r = route.request(), u = new URL(r.url()), path = u.pathname;
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
      ck.tokens.add(u.searchParams.get('ckAPIToken'));
      const session = u.searchParams.get('ckWebAuthToken');
      const reply = (status, body, extra = {}) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
      if (!path.startsWith('/database/1/iCloud.test.vdex/production/')) return reply(400, { serverErrorCode: 'BAD_REQUEST', reason: 'wrong container ' + path });
      if (!session || !ck.valid.has(session)) { if (session) ck.stale++; return reply(421, { serverErrorCode: 'AUTHENTICATION_REQUIRED', redirectURL: 'https://idmsa.apple.com/IDMSWebAuth/signin?appIdKey=test' }); }
      ck.valid.delete(session); ck.used.push(session); const next = issue(); // a session is good for one round trip
      const head = { 'x-apple-cloudkit-web-auth-token': next };
      if (ck.delay) await sleep(ck.delay);
      if (path.endsWith('/public/users/caller')) return reply(200, { userRecordName: '_u1' }, head);
      const body = JSON.parse(r.postData() || '{}');
      if (ck.deny) return reply(403, { serverErrorCode: 'ACCESS_DENIED', reason: 'private db access disabled for this account' }, head);
      if (path.endsWith('/private/zones/modify')) return reply(200, { zones: body.operations.map(({ operationType, zone }) => {
        if (operationType === 'delete') { if (!ck.zone) return { zoneID: zone.zoneID, serverErrorCode: 'ZONE_NOT_FOUND' }; ck.zone = false; ck.records.clear(); ck.zoneDeletes++; return { zoneID: zone.zoneID, deleted: true }; }
        ck.zone = true; return { zoneID: zone.zoneID }; }) }, head);
      if ((body.zoneID || {}).zoneName !== 'Vdex') return reply(400, { serverErrorCode: 'BAD_REQUEST', reason: 'not in the Vdex zone' }, head);
      if (!ck.zone && path.endsWith('/private/records/lookup')) return reply(404, { serverErrorCode: 'ZONE_NOT_FOUND', reason: 'zone not found' }, head); // the whole request, as for lookups
      if (!ck.zone) return reply(200, { records: body.operations.map(({ record }) => ({ recordName: record.recordName, serverErrorCode: 'ZONE_NOT_FOUND', reason: 'zone not found' })) }, head); // per record, as for saves
      if (path.endsWith('/private/records/lookup')) return reply(200, { records: body.records.map(({ recordName }) => { const rec = ck.records.get(recordName); if (!rec) return { recordName, serverErrorCode: 'NOT_FOUND', reason: 'not found' }; const fields = body.desiredKeys ? Object.fromEntries(Object.entries(rec.fields).filter(([k]) => body.desiredKeys.includes(k))) : rec.fields; return { recordName, recordType: rec.recordType, fields }; }) }, head);
      if (path.endsWith('/private/records/modify')) {
        if (ck.quota) return reply(413, { serverErrorCode: 'QUOTA_EXCEEDED', reason: 'quota exceeded' }, head);
        return reply(200, { records: body.operations.map(({ operationType, record }) => {
          if (operationType === 'forceDelete') { ck.records.delete(record.recordName); return { recordName: record.recordName, deleted: true }; }
          const size = Object.values(record.fields).reduce((n, f) => n + utf8(String(f.value)), 0);
          ck.biggest = Math.max(ck.biggest, size);
          if (size > 1e6) return { recordName: record.recordName, serverErrorCode: 'LIMIT_EXCEEDED', reason: 'record too large' };
          ck.records.set(record.recordName, { recordType: record.recordType, fields: record.fields }); return { recordName: record.recordName, recordChangeTag: 'x' }; }) }, head);
      }
      return reply(404, { serverErrorCode: 'NOT_FOUND' });
    });
    // Apple's page: signs in, and sends the person back to the callback address with the session
    await ctx.route('https://idmsa.apple.com/**', route => { ck.signIns++; route.fulfill({ status: 302, headers: { location: BASE + '?ckWebAuthToken=' + encodeURIComponent(issue()) } }); });
    return ck;
  };
  const newPage = async () => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: `export const CLOUD_APPS = ${JSON.stringify(IDS)};` }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); });
    const ck = await fakeApple(ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if ((m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (421|413|404|403)/.test(m.text())) || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); // 421: asking who is signed in, before signing in; 413: the full-iCloud check; 404: no Vdex zone yet; 403: the Advanced Data Protection check
    page.on('dialog', d => d.accept());
    return { ctx, page, ck };
  };
  const openCloud = async page => { await page.locator('#cloudBtn').click(); await page.waitForSelector('.sheet .storage'); await sleep(200); };
  const toasts = page => page.evaluate(() => window.__toasts.join(' | '));
  const setVis = (page, hidden) => page.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  const status = page => page.evaluate(() => import('./js/store.js').then(s => s.cloud.status));

  // --- a link carrying a session Vdex did not ask for is not taken ---
  { const { ctx, page } = await newPage();
    await page.goto(BASE + '?ckWebAuthToken=SOMEONE-ELSES'); await page.waitForSelector('#rolodex .drum-btn'); await sleep(900);
    const st = await page.evaluate(() => ({ session: localStorage.getItem('logi-icloud-session'), provider: localStorage.getItem('logi-provider'), url: location.href }));
    ok('a link carrying someone else’s iCloud session is refused and cleaned from the address', !st.session && !st.provider && !/ckWebAuthToken/.test(st.url) && /wasn’t started here/.test(await toasts(page)), JSON.stringify(st));
    // an abandoned sign-in leaves no window open: the next visit without a session ends the wait
    await page.evaluate(() => localStorage.setItem('logi-icloud-pending', String(Date.now()))); // as if Connect was tapped and Apple's page then left
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn'); await sleep(300);
    await page.goto(BASE + '?ckWebAuthToken=SOMEONE-ELSES'); await page.waitForSelector('#rolodex .drum-btn'); await sleep(900);
    ok('…and so is one arriving after a sign-in was abandoned', !(await page.evaluate(() => localStorage.getItem('logi-icloud-session'))) && !(await page.evaluate(() => localStorage.getItem('logi-provider'))));
    await ctx.close(); }

  // --- a first connection that can't save is undone, and says why ---
  { const { ctx, page, ck } = await newPage();
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    ck.deny = true; // Advanced Data Protection with web access off
    await openCloud(page);
    await Promise.all([page.waitForURL(u => /ckWebAuthToken/.test(u.toString()) || ck.signIns === 1, { timeout: 15000 }), page.locator('.sheet .cloud-choice[data-svc="icloud"] button').click()]);
    await page.waitForSelector('#rolodex .drum-btn');
    await page.waitForFunction(() => window.__toasts.some(t => /Advanced Data Protection/.test(t)), null, { timeout: 10000 }).catch(() => {});
    const st = await page.evaluate(() => import('./js/store.js').then(s => ({ provider: localStorage.getItem('logi-provider'), session: localStorage.getItem('logi-icloud-session'), notice: s.cloud.notice, adapter: !!s.cloud.adapter })));
    ok('a first iCloud connection that can’t save is undone and says why, never “Connected”', !st.provider && !st.adapter && !st.session && /Advanced Data Protection/.test(st.notice) && !/Connected to iCloud/.test(await toasts(page)), JSON.stringify(st));
    await ctx.close(); }

  const { ctx, page, ck } = await newPage();
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#rolodex .drum-btn');
  await openCloud(page);
  ok('iCloud is ready to connect', !(await page.locator('.sheet .cloud-choice[data-svc="icloud"] button').isDisabled()) && /Apple ID/.test(await page.locator('.sheet .cloud-choice[data-svc="icloud"]').innerText()));

  // One tap: to Apple and back, connected, the first copy written
  await page.locator('.sheet .cloud-choice[data-svc="icloud"] button').click();
  await page.waitForFunction(() => localStorage.getItem('logi-provider') === 'icloud', null, { timeout: 15000 }).catch(() => {}); // only set once back from Apple
  await page.waitForSelector('#rolodex .drum-btn');
  const firstSynced = await synced(page);
  ok('Connect goes to Apple’s page and comes back connected', ck.signIns === 1 && (await page.evaluate(() => localStorage.getItem('logi-provider'))) === 'icloud' && firstSynced, JSON.stringify({ signIns: ck.signIns, toasts: await toasts(page) }));
  ok('the address bar is clean after coming back', !/ckWebAuthToken/.test(page.url()), page.url());
  ok('the copy is a record in the private database', !!ck.records.get('vdex-production-db.json') && JSON.parse(ck.records.get('vdex-production-db.json').fields.text.value).bookings !== undefined && ck.records.get('vdex-production-db.json').recordType === 'VdexFile');
  ok('only the website’s token is used on the website', JSON.stringify([...ck.tokens]) === '["webtoken123"]', JSON.stringify([...ck.tokens]));
  ok('every request carries the session from the answer before, and the newest is kept', ck.stale === 0 && ck.used.length >= 3 && (await page.evaluate(() => localStorage.getItem('logi-icloud-session'))) === 'S' + ck.n + '+/=', JSON.stringify({ stale: ck.stale, used: ck.used.length, n: ck.n }));
  ok('everything is in a zone of Vdex’s own, made on the first save', ck.zone);
  ok('dated backups sit beside it', [...ck.records.keys()].some(k => /^vdex-backup-(sun|mon|tue|wed|thu|fri|sat)\.json$/.test(k)) && [...ck.records.keys()].some(k => /^vdex-backup-\d{4}-\d{2}\.json$/.test(k)), [...ck.records.keys()].join(', '));
  await openCloud(page);
  const panel = await page.locator('.sheet .storage').innerText();
  ok('the panel says where the copy lives', /Connected to iCloud/.test(panel) && /private Vdex space in your iCloud/.test(panel) && /Up to date/.test(panel), panel.slice(0, 200).replace(/\s+/g, ' '));
  await page.keyboard.press('Escape'); await sleep(200);

  // A database bigger than one record: split, each part under the limit, read back whole; the old parts tidied later
  const big = 'é'.repeat(450000) + '🎬'.repeat(120000) + 'x'.repeat(300000); // 900 KB + 480 KB + 300 KB of text
  await page.evaluate(async notes => { const s = await import('./js/store.js'); s.update(d => { d.bookings.push({ id: 'big-one', title: 'Big notes', date: '2026-12-03', status: 'Confirmed', notes, updatedAt: Date.now() }); }); await s.sync(); }, big);
  await synced(page);
  const parts = [...ck.records.keys()].filter(k => k.startsWith('vdex-production-db.json~'));
  ok('a big database is split across records, each under iCloud’s 1 MB', parts.length >= 2 && ck.biggest <= 1e6 && Number(ck.records.get('vdex-production-db.json').fields.parts.value) === parts.length + 1, JSON.stringify({ parts: parts.length, biggest: ck.biggest }));
  const back = await page.evaluate(async () => { const d = await (await import('./js/providers.js')).icloudAdapter().read(); return (d.bookings.find(b => b.id === 'big-one') || {}).notes; });
  ok('…and read back whole, characters intact', back === big, back ? back.length + ' vs ' + big.length : 'missing');
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.update(d => { const b = d.bookings.find(x => x.id === 'big-one'); b.notes = 'short now'; b.updatedAt = Date.now(); }); await s.sync(); });
  await synced(page);
  ok('when it shrinks again the old parts are removed', ![...ck.records.keys()].some(k => k.startsWith('vdex-production-db.json~')) && Number(ck.records.get('vdex-production-db.json').fields.parts.value) === 1, [...ck.records.keys()].join(', '));

  // The calendar feed needs a public link, which iCloud does not give
  await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice');
  ok('the calendar panel explains iCloud gives no feed link, and offers the rest', /iCloud keeps Vdex’s copy private/.test(await page.locator('.sheet').innerText()) && (await page.locator('.sheet input[type=checkbox]').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(200);

  // iCloud full
  ck.quota = true;
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.update(d => { d.bookings.push({ id: 'q1', title: 'One more', date: '2026-12-04', status: 'Confirmed', updatedAt: Date.now() }); }); await s.sync(); });
  const qErr = await page.evaluate(() => import('./js/store.js').then(s => s.cloud.status + ': ' + s.cloud.error));
  ok('a full iCloud says so in plain words', /^error: Your iCloud storage is full/.test(qErr), qErr);
  ck.quota = false;

  // With a PIN: the lock's sealed copy keeps the newest session, also one that changed while a request was out
  await page.evaluate(async () => { await (await import('./js/lock.js')).setPin('246810'); });
  await page.evaluate(async () => (await import('./js/store.js')).sync()); await synced(page); await sleep(600); // the session moved on after the vault was first written
  await setVis(page, true); await sleep(700); await setVis(page, false); await sleep(900);
  await page.evaluate(async () => (await import('./js/store.js')).sync());
  const afterHide = await status(page), staleAfterHide = ck.stale;
  ok('with a PIN, hiding Vdex and coming back keeps iCloud signed in', afterHide === 'synced' && staleAfterHide === 0, JSON.stringify({ afterHide, stale: staleAfterHide }));
  ck.delay = 700;
  const inflight = page.evaluate(async () => (await import('./js/store.js')).sync());
  await sleep(200); await setVis(page, true); await sleep(1300); await setVis(page, false); await sleep(900);
  ck.delay = 0; await inflight.catch(() => {});
  await page.evaluate(async () => (await import('./js/store.js')).sync());
  const afterMid = await status(page);
  ok('…even when hidden in the middle of a request', afterMid === 'synced' && ck.stale === 0, JSON.stringify({ afterMid, stale: ck.stale }));
  await page.evaluate(async () => { await (await import('./js/lock.js')).removePin(); });

  // Two weeks later: the session has run out; Sign in again goes to Apple and back
  ck.valid.clear();
  await page.evaluate(async () => (await import('./js/store.js')).sync());
  await page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'needs-permission', null, { timeout: 8000 }).catch(() => {});
  ok('a run-out sign-in shows Sign in and forgets the old session', (await page.locator('#cloudBtn').innerText()).includes('Sign in') && !(await page.evaluate(() => localStorage.getItem('logi-icloud-session'))));
  await openCloud(page);
  await Promise.all([page.waitForURL(u => /ckWebAuthToken/.test(u.toString()) || ck.signIns === 2, { timeout: 15000 }), page.locator('.sheet button:has-text("Sign in again")').click()]);
  await page.waitForSelector('#rolodex .drum-btn');
  ok('…and one tap signs in again and carries on', ck.signIns === 2 && (await synced(page)) && (await page.evaluate(() => localStorage.getItem('logi-provider'))) === 'icloud' && !!ck.records.get('vdex-production-db.json') && JSON.parse(ck.records.get('vdex-production-db.json').fields.text.value).bookings.some(b => b.id === 'q1'));

  // The lock seals the session like the other sign-ins
  ok('the iCloud session is among the secrets the lock seals', await page.evaluate(async () => (await (await fetch('./js/lock.js')).text()).includes("'logi-icloud-session'")));

  // Restore while the sign-in has run out: says so, rather than "no backups"
  const keep = await page.evaluate(() => localStorage.getItem('logi-icloud-session')); ck.valid.clear();
  await page.evaluate(() => import('./js/backup.js').then(b => b.restoreFromCloud())); await sleep(400);
  ok('restoring with a run-out sign-in asks to sign in again instead of saying there are no backups', /wants you to sign in again before backups can be listed/.test(await toasts(page)) && (await status(page)) === 'needs-permission' && !(await page.locator('.sheet:has-text("No automatic backups yet")').count()));
  await page.keyboard.press('Escape'); await sleep(200); ck.valid.add(keep);

  // Disconnect
  await openCloud(page);
  await page.locator('.sheet button:has-text("Disconnect")').click(); await sleep(300);
  ok('Disconnect forgets the iCloud session and goes back to the choices', !(await page.evaluate(() => localStorage.getItem('logi-icloud-session'))) && !(await page.evaluate(() => localStorage.getItem('logi-provider'))) && (await page.locator('.sheet .cloud-choice[data-svc="icloud"]').count()) === 1);
  ok('…and leaves the copy in iCloud where it is', !!ck.records.get('vdex-production-db.json'));

  // Delete Vdex's copy from iCloud (Apple asks apps to offer it)
  await Promise.all([page.waitForURL(u => /ckWebAuthToken/.test(u.toString()) || ck.signIns === 3, { timeout: 15000 }), page.locator('.sheet .cloud-choice[data-svc="icloud"] button').click()]);
  await page.waitForSelector('#rolodex .drum-btn'); await synced(page);
  // with no sign-in to hand, it says so and goes nowhere
  const held = await page.evaluate(() => { const v = localStorage.getItem('logi-icloud-session'); localStorage.removeItem('logi-icloud-session'); return v; });
  await openCloud(page);
  await page.locator('.sheet button:has-text("Delete Vdex’s copy from iCloud")').click(); await sleep(600);
  ok('Delete with no sign-in to hand asks to sign in first and goes nowhere', ck.signIns === 3 && /Sign in to iCloud again first/.test(await toasts(page)) && (await page.evaluate(() => localStorage.getItem('logi-provider'))) === 'icloud' && ck.records.has('vdex-production-db.json'));
  await page.evaluate(v => localStorage.setItem('logi-icloud-session', v), held); await page.keyboard.press('Escape'); await sleep(200);
  // a copy on its way and parts a broken save left behind: all gone, nothing written after
  ck.records.set('vdex-production-db.json~orphan~1', { recordType: 'VdexFile', fields: { text: { value: 'left behind' } } });
  await page.evaluate(() => localStorage.removeItem('logi-backup-cloud')); // so the copy on its way also writes the day's backups
  ck.delay = 250;
  await page.evaluate(async () => { const s = await import('./js/store.js'); s.update(d => { d.bookings.push({ id: 'q2', title: 'Last edit', date: '2026-12-05', status: 'Confirmed', updatedAt: Date.now() }); }); });
  await sleep(1100); // the copy has started
  await openCloud(page);
  await page.locator('.sheet button:has-text("Delete Vdex’s copy from iCloud")').click();
  await page.waitForFunction(() => !localStorage.getItem('logi-provider'), null, { timeout: 15000 }).catch(() => {});
  await sleep(1200); ck.delay = 0;
  ok('Delete removes everything Vdex put in iCloud, broken leftovers too, with nothing written after; this device keeps its data', ck.records.size === 0 && !ck.zone && ck.zoneDeletes >= 1 && !(await page.evaluate(() => localStorage.getItem('logi-provider'))) && (await page.evaluate(() => import('./js/store.js').then(s => s.db.bookings.some(b => b.id === 'q2')))) && /deleted from iCloud/.test(await toasts(page)), [...ck.records.keys()].join(', ') + ' zone ' + ck.zone);
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

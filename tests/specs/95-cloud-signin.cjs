// Connecting cloud storage by signing in: the built-in apps, the one-tap Connect buttons, Dropbox's redirect round
// trip, Google's and Microsoft's sign-in windows (stood in for), undo on a cancelled sign-in, a developer's own key,
// Nextcloud's shortcut and folder creation, the calendar panel, and the "not switched on yet" state.
const { chromium } = require('playwright');
const { acceptTerms, menuClick, openMenu } = require('../helpers.cjs');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const IDS = { dropbox: 'dbxTestKey123', google: '123-test.apps.googleusercontent.com', microsoft: '11111111-2222-3333-4444-555555555555', icloud: { container: 'iCloud.test.vdex', apiToken: 'ck-test-token' } };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const synced = page => page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'synced', null, { timeout: 15000 }).then(() => true, () => false);
const roundTrip = async (page, act) => { await Promise.all([page.waitForEvent('framenavigated', { predicate: f => f === page.mainFrame() && /[?&]state=/.test(f.url()), timeout: 20000 }), act()]); await page.waitForSelector('#rolodex .drum-btn'); await sleep(300); };
const preflight = route => route.request().method() === 'OPTIONS' && (route.fulfill({ status: 204, headers: CORS }), true);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async ({ ids = IDS, stubs = true } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    if (ids) await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: `export const CLOUD_APPS = ${JSON.stringify(ids)};` }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); }); // every message, even one that has faded
    await ctx.addInitScript(acceptTerms());
    if (stubs) await ctx.addInitScript(() => {
      // Google Identity Services, standing in for the sign-in window
      window.google = { accounts: { oauth2: { initTokenClient: cfg => { window.__gcfg = cfg; return { requestAccessToken: o => { window.__greq = o; setTimeout(() => window.__gfail ? cfg.callback({ error: 'access_denied' }) : cfg.callback({ access_token: 'gtok' + Math.random(), expires_in: 3600, scope: window.__gdeny ? 'https://www.googleapis.com/auth/drive.appdata' : cfg.scope }), 10); } }; } } } };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if ((m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (400|404|409)/.test(m.text())) || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); // 404/409: the services' normal "no file yet" on a first connect; 400: Microsoft asking for consent to the calendar
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const openCloud = async page => { await menuClick(page, '#cloudBtn'); await page.waitForSelector('.sheet .storage'); await sleep(200); };
  const closeSheet = async page => { await page.keyboard.press('Escape'); await sleep(200); };
  const card = (page, svc) => page.locator(`.sheet .cloud-choice[data-svc="${svc}"]`);
  // Dropbox and OneDrive sit inside the folded "More ways"; open it first, as a person would
  const moreWays = async page => { const d = page.locator('.sheet details.twirl-more'); if (!(await d.evaluate(e => e.open))) { await d.locator('> summary').click(); await sleep(350); } };
  const tap = async (page, svc) => { if (svc === 'dropbox' || svc === 'onedrive') await moreWays(page); await card(page, svc).locator('button').click(); };

  // --- not switched on yet ---
  { const { ctx, page } = await newPage({ ids: { dropbox: '', google: '', microsoft: '', icloud: { container: '', apiToken: '' } } });
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    await openCloud(page);
    const disabled = await page.evaluate(() => ['gdrive', 'icloud', 'dropbox', 'onedrive'].map(s => document.querySelector(`.sheet .cloud-choice[data-svc="${s}"] button`).disabled));
    ok('without built-in apps every Connect button is greyed out', disabled.every(Boolean), JSON.stringify(disabled));
    const text = await page.locator('.sheet .storage').innerText();
    ok('…and the two up front say plainly they aren’t ready yet, with the publisher’s link kept apart', /Not ready yet/.test(text) && /see More ways below/.test(text) && (await page.locator('.sheet a.publisher-link[href$="docs/turn-on-sign-in.md"]').count()) === 4, (await page.locator('.sheet a.publisher-link').count()) + ' links');
    ok('no developer key boxes are in sight', (await page.locator('.sheet input[aria-label="Dropbox app key"]').isVisible()) === false);
    await ctx.close(); }

  // --- the layout: Google Drive and iCloud up front, the rest folded away ---
  { const { ctx, page } = await newPage();
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    await openCloud(page);
    const front = await page.evaluate(() => [...document.querySelectorAll('.sheet .storage > .stack > .cloud-choices > .cloud-choice')].map(c => c.dataset.svc));
    ok('only Google Drive and iCloud are offered up front', JSON.stringify(front) === '["gdrive","icloud"]', JSON.stringify(front));
    const hidden = await page.evaluate(() => ['dropbox', 'onedrive'].map(s => !!document.querySelector(`.sheet .cloud-choice[data-svc="${s}"]`).closest('details:not([open])')));
    ok('Dropbox, OneDrive, Nextcloud, the synced folder and no-cloud are kept, folded under More ways', hidden.every(Boolean) && (await page.locator('.sheet details.twirl-more:not([open]) summary:has-text("More ways")').count()) === 1 && !(await page.locator('.sheet button:has-text("Create database file")').isVisible()), JSON.stringify(hidden));
    await moreWays(page);
    const shown = await page.evaluate(() => [...document.querySelectorAll('.sheet details.twirl-more .twirl-body strong')].map(s => s.textContent));
    ok('…and opening it shows them all, with the developer keys folded once more', ['Dropbox', 'OneDrive'].every(n => shown.includes(n)) && shown.some(n => /Nextcloud/.test(n)) && shown.some(n => /synced folder/.test(n)) && shown.some(n => /No cloud/.test(n)) && (await card(page, 'dropbox').locator('button').isVisible()) && !(await page.locator('.sheet input[aria-label="Dropbox app key"]').isVisible()), JSON.stringify(shown));
    await page.locator('.sheet .seg button:has-text("Other WebDAV")').click(); await sleep(150);
    ok('…and it stays open when the panel redraws', await page.locator('.sheet details.twirl-more').evaluate(e => e.open));
    await ctx.close(); }

  // --- a key left in one of the old "paste your key" boxes ---
  { const { ctx, page } = await newPage();
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('logi-dropbox-key', 'x7k2oldsecret'); } });
    let used = null; await ctx.route('https://www.dropbox.com/oauth2/authorize**', r => { used = new URL(r.request().url()).searchParams.get('client_id'); r.fulfill({ status: 200, body: 'stop' }); });
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    const leftover = await page.evaluate(() => [localStorage.getItem('logi-dropbox-key'), localStorage.getItem('logi-own-dropbox')]);
    await openCloud(page); await tap(page, 'dropbox'); await sleep(800);
    ok('a key left in an old box, never used for a sign-in, no longer overrides the built-in app', used === IDS.dropbox && leftover[0] === null && leftover[1] === null, JSON.stringify({ used, leftover }));
    await ctx.close(); }

  // --- with the built-in apps ---
  const { ctx, page } = await newPage();
  let authUrl = null, tokenBody = null, uploads = 0;
  await ctx.route('https://www.dropbox.com/oauth2/authorize**', route => { authUrl = new URL(route.request().url()); const back = new URL(authUrl.searchParams.get('redirect_uri')); back.searchParams.set('code', 'CODE123'); back.searchParams.set('state', authUrl.searchParams.get('state')); route.fulfill({ status: 302, headers: { location: back.href } }); });
  await ctx.route('https://api.dropboxapi.com/oauth2/token', route => { if (preflight(route)) return; tokenBody = new URLSearchParams(route.request().postData()); json(route, 200, { access_token: 'dtok', refresh_token: 'drefresh', expires_in: 14400 }); });
  await ctx.route('https://api.dropboxapi.com/2/users/get_current_account', route => { if (preflight(route)) return; json(route, 200, { name: { display_name: 'Jo Test' }, email: 'jo@example.com' }); });
  await ctx.route('https://content.dropboxapi.com/2/files/**', route => { if (preflight(route)) return; if (/upload/.test(route.request().url())) { uploads++; return json(route, 200, {}); } return json(route, 409, { error_summary: 'path/not_found/' }); });
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#rolodex .drum-btn');
  await openCloud(page);
  const enabled = await page.evaluate(() => ['gdrive', 'icloud', 'dropbox', 'onedrive'].map(s => !document.querySelector(`.sheet .cloud-choice[data-svc="${s}"] button`).disabled));
  ok('with built-in apps every Connect button is ready', enabled.every(Boolean), JSON.stringify(enabled));
  ok('the panel speaks plainly: sign in, own folder only', /Sign in to your own cloud storage/.test(await page.locator('.sheet .storage').innerText()) && /cannot see, change or share any of your other files/.test(await page.locator('.sheet .storage').innerText()));

  // Dropbox: one tap → Dropbox → back → connected
  await tap(page, 'dropbox');
  await page.waitForFunction(() => localStorage.getItem('logi-provider') === 'dropbox' && !!localStorage.getItem('logi-dbx-token'), null, { timeout: 15000 });
  ok('Dropbox is asked with the built-in app key, PKCE and a long-lived sign-in', authUrl && authUrl.searchParams.get('client_id') === IDS.dropbox && authUrl.searchParams.get('code_challenge_method') === 'S256' && authUrl.searchParams.get('token_access_type') === 'offline');
  ok('the return address is the app folder, even when opened at index.html', authUrl && authUrl.searchParams.get('redirect_uri') === BASE, authUrl && authUrl.searchParams.get('redirect_uri'));
  ok('the code is exchanged with the same app and address, no secret', tokenBody && tokenBody.get('client_id') === IDS.dropbox && tokenBody.get('redirect_uri') === BASE && !!tokenBody.get('code_verifier') && !tokenBody.has('client_secret'));
  ok('the address bar is clean after coming back', !/code=|state=/.test(page.url()), page.url());
  ok('Dropbox is linked and the first copy is written', (await synced(page)) && uploads >= 1, 'uploads ' + uploads);
  await openCloud(page);
  const linked = await page.locator('.sheet .storage').innerText();
  ok('the panel shows who is signed in and where the copy lives', /Connected to Dropbox/.test(linked) && /Signed in as Jo Test · jo@example\.com/.test(linked) && /Apps › Vdex/.test(linked) && /Up to date/.test(linked), linked.slice(0, 160).replace(/\s+/g, ' '));
  const tok = await page.evaluate(() => JSON.parse(localStorage.getItem('logi-dbx-token')));
  ok('the sign-in remembers which app it belongs to, for refreshing', tok.client === IDS.dropbox && tok.refresh === 'drefresh');
  await page.locator('.sheet button:has-text("Disconnect")').click(); await sleep(300);
  ok('Disconnect returns to the choices and forgets the sign-in', (await card(page, 'dropbox').count()) === 1 && !(await page.evaluate(() => localStorage.getItem('logi-dbx-token'))) && !(await page.evaluate(() => localStorage.getItem('logi-cloud-who'))));

  // Google Drive: cancelled first, then signed in
  let gfiles = 0;
  await ctx.route('https://www.googleapis.com/**', route => { if (preflight(route)) return; const u = route.request().url(); if (/upload\/drive/.test(u)) { gfiles++; return json(route, 200, { id: 'file1' }); } if (/drive\/v3\/about/.test(u)) return json(route, 200, { user: { displayName: 'Gee Test', emailAddress: 'gee@example.com' } }); if (/alt=media/.test(u)) return json(route, 404, {}); return json(route, 200, { files: [] }); }); // a download finds no copy, so the next sync writes one again
  await page.evaluate(() => { window.__gfail = true; });
  await card(page, 'gdrive').locator('button').click();
  await page.waitForFunction(() => window.__toasts.some(t => /cancelled/i.test(t)), null, { timeout: 8000 }).catch(() => {});
  const gc = await page.evaluate(() => ({ p: localStorage.getItem('logi-provider'), toast: window.__toasts.filter(t => /Google/.test(t)).join(' | ') }));
  ok('a cancelled Google sign-in leaves nothing half-linked and says why', !gc.p && (await card(page, 'gdrive').count()) === 1 && /cancelled/i.test(gc.toast), JSON.stringify(gc));
  await page.evaluate(() => { window.__gfail = false; });
  await card(page, 'gdrive').locator('button').click();
  const gSynced = await synced(page);
  const gcfg = await page.evaluate(() => ({ id: window.__gcfg && window.__gcfg.client_id, scope: window.__gcfg && window.__gcfg.scope }));
  ok('Google is asked with the built-in client and only the private app-data scope', gcfg.id === IDS.google && gcfg.scope === 'https://www.googleapis.com/auth/drive.appdata', JSON.stringify(gcfg));
  ok('Google Drive is linked and the first copy is written', gSynced && (await page.evaluate(() => localStorage.getItem('logi-provider'))) === 'gdrive' && gfiles >= 1, 'files ' + gfiles);
  await page.waitForFunction(() => localStorage.getItem('logi-google-email') === 'gee@example.com', null, { timeout: 8000 }).catch(() => {});
  ok('the Google account is remembered and shown', /Signed in as Gee Test · gee@example\.com/.test(await page.locator('.sheet .storage').innerText()));
  // an hour later: the token has run out; one tap, and the account is named so Google can skip its chooser
  await page.evaluate(async () => { const p = await import('./js/providers.js'); p.forgetGoogleToken('https://www.googleapis.com/auth/drive.appdata'); (await import('./js/store.js')).sync(); });
  await page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'needs-permission', null, { timeout: 8000 }).catch(() => {});
  const hourUp = await page.evaluate(() => { const b = document.getElementById('menuBtn'); return { dot: b.dataset.dot, name: b.getAttribute('aria-label'), row: document.getElementById('cloudLabel').textContent, line: document.getElementById('menuStatusTitle').textContent }; });
  ok('when Google’s hour is up the hamburger carries an amber dot, and its name and the menu say to sign in again', hourUp.dot === 'amber' && hourUp.name === 'Menu. Google Drive needs you to sign in again' && hourUp.row === 'Sign in' && hourUp.line === 'Google Drive needs you to sign in again', JSON.stringify(hourUp));
  await page.locator('.sheet button:has-text("Sign in again")').click();
  const reSynced = await synced(page), reHint = await page.evaluate(() => window.__greq && window.__greq.login_hint);
  ok('signing in again takes one tap and names the account', reSynced && reHint === 'gee@example.com', JSON.stringify({ reSynced, reHint, state: await page.evaluate(() => document.getElementById('cloudBtn').dataset.state), err: await page.evaluate(() => import('./js/store.js').then(s => s.cloud.error)) }));
  await page.evaluate(() => localStorage.setItem('logi-google-scopes', localStorage.getItem('logi-google-scopes') + ' https://www.googleapis.com/auth/calendar.app.created'));
  await page.evaluate(async () => { (await import('./js/providers.js')).forgetGoogleToken('https://www.googleapis.com/auth/drive.appdata'); });
  // The storage still reads "synced" while Google's window is open, so that state says nothing about this tap: wait
  // for what the tap itself ends with, the panel's word that the copy is saved, before asking what the window left.
  const saidBefore = await page.evaluate(() => window.__toasts.length);
  await page.locator('.sheet button:has-text("Sync now")').click();
  await page.waitForFunction(n => window.__toasts.slice(n).some(t => /Up to date\. Your copy is saved\./.test(t)), saidBefore, { timeout: 15000 }).catch(() => {});
  await synced(page);
  ok('one Google window renews Drive and Calendar together', /drive\.appdata/.test(await page.evaluate(() => window.__gcfg.scope)) && /calendar\.app\.created/.test(await page.evaluate(() => window.__gcfg.scope)));
  ok('…and the calendar is then covered without another window', await page.evaluate(async () => { const p = await import('./js/providers.js'); return p.googleToken('https://www.googleapis.com/auth/calendar.app.created', false).then(t => !!t, () => false); }));
  await page.evaluate(() => { window.__gdeny = true; });
  const feedErr = await page.evaluate(async () => { try { await (await import('./js/store.js')).setFeed(true); return 'no error'; } catch (e) { return e.message; } });
  await page.evaluate(() => { window.__gdeny = false; });
  ok('turning down the feed permission says why and does not switch the feed on', /permission/.test(feedErr) && !(await page.evaluate(() => localStorage.getItem('logi-feed-drive'))), feedErr);
  await page.evaluate(async () => (await import('./js/store.js')).sync());
  ok('…and Google Drive storage carries on regardless', await synced(page));
  await page.locator('.sheet button:has-text("Disconnect")').click(); await sleep(300);

  // OneDrive: Microsoft's page and back, as with Dropbox; a cancel first, then a sign-in
  let odPuts = 0, msAuth = null, msTokenReqs = [], msCancel = true;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  await ctx.route('https://login.microsoftonline.com/common/oauth2/v2.0/authorize**', route => { msAuth = new URL(route.request().url()); const back = new URL(msAuth.searchParams.get('redirect_uri')); back.searchParams.set('state', msAuth.searchParams.get('state')); if (msCancel) { back.searchParams.set('error', 'access_denied'); back.searchParams.set('error_description', 'AADSTS65004: User declined to consent.'); } else back.searchParams.set('code', 'MSCODE'); route.fulfill({ status: 302, headers: { location: back.href } }); });
  await ctx.route('https://login.microsoftonline.com/common/oauth2/v2.0/token', route => { if (preflight(route)) return; const body = new URLSearchParams(route.request().postData()); msTokenReqs.push(Object.fromEntries(body)); if (body.get('grant_type') === 'refresh_token' && /Calendars/.test(body.get('scope')) && !msAuth.searchParams.get('scope').includes('Calendars')) return json(route, 400, { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented.' }); json(route, 200, { access_token: 'mtok' + msTokenReqs.length, refresh_token: 'mref' + msTokenReqs.length, expires_in: 3600, scope: body.get('scope'), id_token: b64({ alg: 'none' }) + '.' + b64({ name: 'Sam Test', preferred_username: 'sam@contoso.example' }) + '.sig' }); });
  // OneDrive keeps what was written; reading asks for the item's download address, as browsers must, then fetches that
  const odFiles = {}; let odDownloads = 0;
  await ctx.route('https://graph.microsoft.com/**', route => { if (preflight(route)) return; const r = route.request(), path = decodeURIComponent(new URL(r.url()).pathname);
    if (/\/me\/calendars/.test(path)) return json(route, r.method() === 'POST' ? 201 : 200, r.method() === 'POST' ? { id: 'cal1' } : { value: [] });
    const name = (path.match(/approot:\/([^:]+)/) || [])[1];
    if (r.method() === 'PUT') { odPuts++; odFiles[name] = r.postData(); return json(route, 201, {}); }
    if (/\/content$/.test(path)) return route.fulfill({ status: 302, headers: { location: 'https://dl.example.test/' + name } }); // what Graph does; browsers refuse it with a sign-in attached
    return name && odFiles[name] ? json(route, 200, { id: 'i1', '@microsoft.graph.downloadUrl': 'https://dl.example.test/' + encodeURIComponent(name) }) : json(route, 404, {}); });
  await ctx.route('https://dl.example.test/**', route => { odDownloads++; route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: odFiles[decodeURIComponent(new URL(route.request().url()).pathname.slice(1))] || '' }); });
  await roundTrip(page, () => tap(page, 'onedrive')); await sleep(600);
  ok('a cancelled Microsoft sign-in leaves OneDrive unlinked and says why', !(await page.evaluate(() => localStorage.getItem('logi-provider'))) && /cancelled/i.test(await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')));
  msCancel = false;
  await openCloud(page);
  ok('the reason stays in the panel until the next try', /cancelled/i.test(await page.locator('.sheet .storage .warn').innerText().catch(() => '')));
  await tap(page, 'onedrive');
  const odSynced = await synced(page); // only once the page has been to Microsoft and back
  ok('Microsoft is asked with the built-in app, the app-folder permission, PKCE and the app-folder return address', msAuth.searchParams.get('client_id') === IDS.microsoft && msAuth.searchParams.get('redirect_uri') === BASE && /Files\.ReadWrite\.AppFolder/.test(msAuth.searchParams.get('scope')) && /offline_access/.test(msAuth.searchParams.get('scope')) && msAuth.searchParams.get('code_challenge_method') === 'S256' && msAuth.searchParams.get('prompt') === 'select_account', msAuth.search.slice(0, 200));
  const ex = msTokenReqs.find(r => r.grant_type === 'authorization_code');
  ok('the code is exchanged with no secret', ex && ex.client_id === IDS.microsoft && ex.redirect_uri === BASE && !!ex.code_verifier && !('client_secret' in ex), JSON.stringify(ex));
  ok('OneDrive is linked and the first copy written', odSynced && (await page.evaluate(() => localStorage.getItem('logi-provider'))) === 'onedrive' && odPuts >= 1, 'puts ' + odPuts);
  await openCloud(page);
  ok('the panel shows the Microsoft account', /Signed in as Sam Test · sam@contoso\.example/.test(await page.locator('.sheet .storage').innerText()));
  await closeSheet(page);
  // a day later: the sign-in has run out; one tap, Microsoft and back, the account named so no chooser
  await page.evaluate(() => { const t = JSON.parse(localStorage.getItem('logi-ms-token')); t.refresh = null; t.access = {}; localStorage.setItem('logi-ms-token', JSON.stringify(t)); });
  await page.evaluate(async () => (await import('./js/store.js')).sync());
  await page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'needs-permission', null, { timeout: 8000 }).catch(() => {});
  await openCloud(page);
  await roundTrip(page, () => page.locator('.sheet button:has-text("Sign in again")').click());
  ok('signing in again names the account instead of asking which one', msAuth.searchParams.get('login_hint') === 'sam@contoso.example' && !msAuth.searchParams.get('prompt'));
  ok('…and OneDrive carries on, reading its copy back through the download address', (await synced(page)) && odDownloads >= 1, 'downloads ' + odDownloads);
  // Outlook calendar on top: the OneDrive sign-in is reused, consent for the calendar is asked once
  await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice');
  await roundTrip(page, () => page.locator('.sheet .cloud-choice[data-svc="microsoft"] button').click());
  let cs = {}; for (let i = 0; i < 60; i++) { cs = await page.evaluate(() => import('./js/store.js').then(s => s.db.calSync || {})); if (cs.calendarId) break; await sleep(250); }
  const calErr = await page.evaluate(() => import('./js/calendar.js').then(m => m.calState.status + ' ' + m.calState.error));
  ok('connecting Outlook asks for the calendar and keeps the OneDrive permission', /Calendars\.ReadWrite/.test(msAuth.searchParams.get('scope')) && /Files\.ReadWrite\.AppFolder/.test(msAuth.searchParams.get('scope')));
  ok('…and comes back with the calendar connected and made', cs.provider === 'microsoft' && cs.calendarId === 'cal1', JSON.stringify({ p: cs.provider, c: cs.calendarId, calErr }));
  await page.evaluate(async () => { (await import('./js/calendar.js')).disconnectCalendar(); });
  ok('disconnecting Outlook keeps the OneDrive sign-in', !!(await page.evaluate(() => localStorage.getItem('logi-ms-token'))));
  await page.evaluate(async () => (await import('./js/store.js')).unlinkCloud()); await sleep(300);
  ok('disconnecting OneDrive then forgets the Microsoft sign-in', !(await page.evaluate(() => localStorage.getItem('logi-ms-token'))));
  await openCloud(page);

  // A developer's own Dropbox key wins, with the address the page was opened at
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#rolodex .drum-btn'); await openCloud(page);
  await moreWays(page); await page.locator('.sheet summary:has-text("For developers")').click();
  await page.locator('.sheet input[aria-label="Dropbox app key"]').fill('myOwnKey');
  authUrl = null;
  await tap(page, 'dropbox');
  await page.waitForFunction(() => localStorage.getItem('logi-provider') === 'dropbox', null, { timeout: 15000 });
  ok('a developer key replaces the built-in one and keeps its own return address', authUrl && authUrl.searchParams.get('client_id') === 'myOwnKey' && authUrl.searchParams.get('redirect_uri') === BASE + 'index.html', authUrl && authUrl.searchParams.get('redirect_uri'));
  ok('…and the exchange matches it', tokenBody.get('client_id') === 'myOwnKey' && tokenBody.get('redirect_uri') === BASE + 'index.html');
  await synced(page); // let its first copy finish before disconnecting
  await page.evaluate(async () => { localStorage.removeItem('logi-own-dropbox'); (await import('./js/store.js')).unlinkCloud(); }); await sleep(300);

  // Nextcloud: only the address, the folder made on connect
  const dav = [];
  await ctx.route('https://cloud.example.test/**', route => { const r = route.request(); if (preflight(route)) return; dav.push(r.method() + ' ' + new URL(r.url()).pathname); if (r.method() === 'MKCOL') return route.fulfill({ status: 201, headers: CORS }); if (r.method() === 'PUT') return route.fulfill({ status: 201, headers: CORS }); return route.fulfill({ status: 404, headers: CORS }); });
  await openCloud(page);
  await moreWays(page);
  await page.locator('.sheet button[role=tab]:has-text("Nextcloud")').click();
  await page.locator('.sheet input[aria-label="Your Nextcloud address"]').fill('cloud.example.test');
  await page.locator('.sheet input[aria-label="Username"]').fill('jo');
  await page.locator('.sheet input[aria-label="App password"]').fill('app-pass');
  await page.locator('.sheet .card:has-text("Nextcloud") button:has-text("Connect")').click();
  await synced(page); // provider is set first, the first copy a moment later
  ok('Nextcloud needs only the address: the Vdex folder is made in the user’s files', dav.includes('MKCOL /remote.php/dav/files/jo/Vdex/') && dav.some(x => x === 'PUT /remote.php/dav/files/jo/Vdex/vdex-production-db.json'), dav.join(', ') + ' ' + JSON.stringify(await page.evaluate(() => import('./js/store.js').then(s => ({ status: s.cloud.status, error: s.cloud.error, notice: s.cloud.notice, adapter: s.cloud.adapter && s.cloud.adapter.id, provider: localStorage.getItem('logi-provider'), toast: (document.querySelector('.toast') || {}).textContent })))));
  ok('the panel names it Nextcloud', /Connected to Nextcloud \(cloud\.example\.test\)/.test(await page.locator('.sheet .storage').innerText()));
  await closeSheet(page);

  // Calendar: one tap, no key boxes
  await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice');
  const cal = await page.evaluate(() => [...document.querySelectorAll('.sheet .cloud-choice')].map(c => [c.dataset.svc, !c.querySelector('button').disabled]));
  ok('the calendar panel offers Google and Outlook as one-tap connections', JSON.stringify(cal) === '[["google",true],["microsoft",true]]' && (await page.locator('.sheet input[aria-label*="client"]').count()) === 0, JSON.stringify(cal));
  await page.locator('.sheet label.check input[type=checkbox]').check(); await sleep(500);
  ok('with Nextcloud the feed says to share the file from the server, and offers no link button that can’t work', /Share that file from your server/.test(await page.locator('.sheet').innerText()) && (await page.locator('.sheet button:has-text("Get the subscription link")').count()) === 0);
  await page.locator('.sheet label.check input[type=checkbox]').uncheck(); await sleep(300);

  // A copy that waited behind the lock is merged with the cloud's copy on unlock, never written over it
  const merged = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    let written = null; const remote = { ...JSON.parse(s.serialize()), bookings: [{ id: 'from-other-device', title: 'Made on the phone', date: '2026-12-01', status: 'Confirmed', updatedAt: Date.now() }] };
    s.update(d => { d.bookings.push({ id: 'made-here', title: 'Made on this device', date: '2026-12-02', status: 'Confirmed', updatedAt: Date.now() }); });
    s.cloud.adapter = { id: 'fake', label: 'Fake', ready: async () => true, read: async () => remote, write: async t => { written = JSON.parse(t); } };
    s.setSealed(true); await s.sync(); s.setSealed(false);
    for (let i = 0; i < 40 && !written; i++) await new Promise(r => setTimeout(r, 50));
    s.cloud.adapter = null;
    return { local: !!s.byId('bookings', 'from-other-device'), remoteKept: !!(written && written.bookings.some(b => b.id === 'from-other-device') && written.bookings.some(b => b.id === 'made-here')) };
  });
  ok('a copy that waited behind the lock is merged with the cloud copy, not written over it', merged.local && merged.remoteKept, JSON.stringify(merged));

  /* ---------------------------- syncing, restoring and the storage sheet: repairs after 1.4.0 ---------------------------- */
  // Two or more devices (browser contexts) share one stand-in WebDAV storage. Each device keeps its own list of script
  // errors: a storage that does not answer or refuses is part of these cases, and the browser logs those by itself.
  {
    const MAIN = 'vdex-production-db.json', pad = n => String(n).padStart(2, '0');
    const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), OLD_BACKUP = `vdex-backup-${prev.getFullYear()}-${pad(prev.getMonth() + 1)}.json`; // last month's dated backup: today's saves never write it
    const newCloud = () => ({ files: new Map(), log: [], auth: '', delay: 0, offline: false, fail: null });
    const dav = (ctx, cloud, name) => ctx.route('https://dav.example/**', async route => {
      const r = route.request(), m = r.method(), file = decodeURIComponent(new URL(r.url()).pathname.split('/').pop());
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      cloud.log.push(`${name} ${m} ${file}`); cloud.auth = r.headers().authorization || '';
      if (cloud.offline) return route.abort('internetdisconnected');
      if (cloud.delay) await sleep(cloud.delay);
      const refused = cloud.fail && cloud.fail(m, file); if (refused) return route.fulfill({ status: refused, headers: CORS, body: 'x' });
      if (m === 'MKCOL') return route.fulfill({ status: 201, headers: CORS });
      if (m === 'GET') return cloud.files.has(file) ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: cloud.files.get(file) }) : route.fulfill({ status: 404, headers: CORS, body: '' });
      if (m === 'PUT') { cloud.files.set(file, r.postData() || ''); return route.fulfill({ status: 201, headers: CORS }); }
      return route.fulfill({ status: 405, headers: CORS });
    });
    const scriptErrors = [];
    const device = async (cloud, name, { linked = true, width = 420, seed = null, clock = 0 } = {}) => { // clock: how far this device's clock is out (ms)
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
      await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
      await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: `export const CLOUD_APPS = ${JSON.stringify(IDS)};` }));
      await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); window.__toasts = []; addEventListener('DOMContentLoaded', () => new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true })); });
      await ctx.addInitScript(acceptTerms());
      if (clock) await ctx.addInitScript(off => { const R = Date, real = R.now.bind(R); class D extends R { constructor(...a) { if (a.length) super(...a); else super(real() + off); } static now() { return real() + off; } } window.Date = D; }, clock);
      // what a device holds before its first start: the link to the storage, and anything else the case gives it (once: a reload keeps what Vdex then wrote)
      await ctx.addInitScript(([linked, seed]) => { if (localStorage.getItem('case-seeded')) return; localStorage.setItem('case-seeded', '1'); if (linked) { localStorage.setItem('logi-webdav', JSON.stringify({ kind: 'webdav', url: 'https://dav.example/vdex', user: 'u', pass: 'p' })); localStorage.setItem('logi-provider', 'webdav'); } for (const [k, v] of Object.entries(seed || {})) localStorage.setItem(k, v); }, [linked, seed]);
      if (cloud) await dav(ctx, cloud, name);
      const page = await ctx.newPage(); page.said = [];
      page.on('pageerror', e => scriptErrors.push(`${name}: ${e.message}`)); page.on('dialog', d => { page.said.push(d.message()); d.accept(); });
      return { ctx, page, name };
    };
    const start = async page => { await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn'); await sleep(300); };
    const st = (page, fn, arg) => page.evaluate(`import('./js/store.js').then(s => (${fn})(s, ${JSON.stringify(arg === undefined ? null : arg)}))`);
    const add = (page, id, title, more = {}) => st(page, (s, [id, title, more]) => { s.upsert('bookings', { id, title, date: '2026-12-01', status: 'Confirmed', crew: [], gear: [], ...more }); }, [id, title, more]);
    const held = page => st(page, s => s.db.bookings.map(b => `${b.id}:${b.title}`).sort());
    const saved = async page => { await sleep(1000); await synced(page); await sleep(200); }; // a change is copied 0.8 s after it is made
    const syncNow = async page => { await st(page, s => s.sync()); await sleep(150); };
    const cloudDb = cloud => JSON.parse(cloud.files.get(MAIN));
    const front = async page => { await page.evaluate(() => { for (const hidden of [true, false]) { Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); } }); await sleep(700); await synced(page); };
    const toasts = page => page.evaluate(() => window.__toasts.splice(0));
    const state = page => st(page, s => ({ status: s.cloud.status, error: s.cloud.error, linked: !!s.cloud.adapter }));
    const sheetText = async page => (await page.locator('.sheet').last().innerText()).replace(/\s+/g, ' ');

    // ---- a change is merged into the cloud copy, never written over it ----
    const cloud = newCloud();
    const A = await device(cloud, 'A'), B = await device(cloud, 'B');
    await start(A.page); await add(A.page, 'keep', 'Keep me'); await add(A.page, 'edit', 'Right title');
    await st(A.page, s => { s.upsert('logs', { id: 'tl', title: 'Day one', rate: '25', mode: 'free', created: '2026-11-01', sync: null, take: 0, autoTakes: true, script: { name: 'First draft', imported: '2026-11-01T09:00:00.000Z', lines: [] }, scriptAt: 1, notes: [{ id: 'n1', text: 'In the backup', at: '2026-11-01T10:00:00.000Z' }] }); s.upsert('logs', { id: 'tl2', title: 'Day two', rate: '25', mode: 'free', created: '2026-11-02', sync: null, take: 0, autoTakes: true, notes: [] }); });
    await st(A.page, s => { s.update(d => { d.profile = { ...d.profile, name: 'Name in the backup', updatedAt: Date.now() }; d.billing = { ...d.billing, dayRate: 500, updatedAt: Date.now() }; d.priceList = { list: [{ id: 'pl1', name: 'Shoot day', price: 500 }], region: '', updatedAt: Date.now() }; d.templates = { corporate: { Enquiry: [{ t: 'Line in the backup' }] }, updatedAt: Date.now() }; }); });
    await saved(A.page);
    cloud.files.set(OLD_BACKUP, cloud.files.get(MAIN)); // the dated backup a restore goes back to, further down
    await start(B.page); await synced(B.page);
    await add(B.page, 'x', 'B made this'); await saved(B.page);
    cloud.log.length = 0;
    await add(A.page, 'y', 'A made this'); await saved(A.page); // A has not read the cloud copy since B saved
    const mine = cloud.log.filter(l => l.startsWith('A ') && l.endsWith(MAIN));
    ok('a change is saved by reading the cloud copy, merging and then writing: what another device saved meanwhile stays in it', mine.join() === `A GET ${MAIN},A PUT ${MAIN}` && cloudDb(cloud).bookings.map(b => b.id).sort().join() === 'edit,keep,x,y' && (await held(A.page)).length === 4, mine.join() + ' → ' + cloudDb(cloud).bookings.map(b => b.id).join());

    // ---- two devices holding the same records in another order are in step ----
    await syncNow(B.page); await syncNow(A.page); await syncNow(B.page); await sleep(300);
    const orders = [await st(A.page, s => s.db.bookings.map(b => b.id).join()), await st(B.page, s => s.db.bookings.map(b => b.id).join())];
    cloud.log.length = 0;
    for (let i = 0; i < 2; i++) { await front(A.page); await sleep(1100); await front(B.page); await sleep(1100); }
    const uploads = cloud.log.filter(l => / PUT /.test(l)), reads = cloud.log.filter(l => l.endsWith(`GET ${MAIN}`));
    ok('with nothing changed, coming to the front reads the cloud copy and uploads nothing, though each device keeps its own order', orders[0] !== orders[1] && orders[0].split(',').sort().join() === orders[1].split(',').sort().join() && uploads.length === 0 && reads.length >= 4, JSON.stringify([orders, uploads, reads.length]));

    // ---- a device that stays in view reads the cloud copy when its window is clicked into ----
    await st(B.page, s => s.update(d => { const b = d.bookings.find(x => x.id === 'edit'); b.status = 'Delivered'; b.updatedAt = Date.now(); })); await saved(B.page);
    cloud.log.length = 0;
    await A.page.evaluate(() => window.dispatchEvent(new Event('focus'))); await sleep(900);
    ok('a window that never left the screen takes in the other device’s change when it gets the focus', cloud.log.join() === `A GET ${MAIN}` && (await st(A.page, s => s.byId('bookings', 'edit').status)) === 'Delivered', cloud.log.join());

    // ---- a sync that failed is tried again by itself ----
    const C = await device(cloud, 'C');
    cloud.offline = true; await start(C.page); await sleep(600);
    const failedState = await state(C.page);
    cloud.offline = false; cloud.log.length = 0;
    await C.page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(900); await synced(C.page);
    ok('a device that started without a connection syncs by itself when the connection is back', failedState.status === 'error' && (await state(C.page)).status === 'synced' && (await held(C.page)).length === 4 && cloud.log.includes(`C GET ${MAIN}`), JSON.stringify([failedState, await state(C.page), cloud.log]));

    // ---- deleting a venue on one device takes it off the booking on the other ----
    await st(A.page, s => { s.upsert('venues', { id: 'v1', name: 'Dock Hall' }); s.update(d => { const b = d.bookings.find(x => x.id === 'keep'); b.venueId = 'v1'; b.updatedAt = Date.now(); }); }); await saved(A.page);
    await syncNow(B.page); const hadVenue = await st(B.page, s => s.byId('bookings', 'keep').venueId);
    await st(A.page, s => { s.remove('venues', 'v1'); }); await saved(A.page); await syncNow(B.page);
    ok('a venue deleted on one device is no longer on the booking on the other', hadVenue === 'v1' && (await st(B.page, s => [s.db.venues.length, s.byId('bookings', 'keep').venueId === undefined].join())) === '0,true');

    // ---- a restored backup stays restored, on every device ----
    await st(A.page, s => { s.remove('bookings', 'keep'); s.update(d => { const b = d.bookings.find(x => x.id === 'edit'); b.title = 'WRONG title'; b.updatedAt = Date.now(); }); }); await saved(A.page); await syncNow(B.page);
    const wrong = await held(B.page);
    // …a timecode log too: a note made since the backup, and a script put in its place since
    const logOf = page => st(page, s => { const l = s.byId('logs', 'tl'), l2 = s.byId('logs', 'tl2'); return l && l2 ? `${l.notes.map(n => n.id).sort().join('+')} / ${l.script ? l.script.name : 'no script'} / ${l2.script ? l2.script.name : 'no script'}` : 'no log'; });
    await st(A.page, s => { s.update(d => { const l = d.logs.find(x => x.id === 'tl'), l2 = d.logs.find(x => x.id === 'tl2'); l.notes.push({ id: 'n2', text: 'Made since the backup', at: new Date().toISOString() }); l.script = { name: 'Second draft', imported: new Date().toISOString(), lines: [] }; l2.script = { name: 'A first script', imported: new Date().toISOString(), lines: [] }; l.scriptAt = l2.scriptAt = Date.now(); l.updatedAt = l2.updatedAt = Date.now(); }); }); await saved(A.page); await syncNow(B.page);
    const logBefore = await logOf(B.page);
    // …and the settings: the profile, the billing settings, the price list and the checklists, each changed since the backup
    const setOf = page => st(page, s => [s.db.profile.name, s.db.billing.dayRate, (s.db.priceList.list || []).map(x => x.name).join('+') || 'no list', Object.keys(s.db.templates).filter(k => k !== 'updatedAt').join('+') || 'no checklists'].join(' / '));
    await st(A.page, s => { s.update(d => { d.profile = { ...d.profile, name: 'Name typed since', updatedAt: Date.now() }; d.billing = { ...d.billing, dayRate: 900, updatedAt: Date.now() }; d.priceList = { list: null, region: '', updatedAt: Date.now() }; d.templates = { updatedAt: Date.now() }; }); }); await saved(A.page); await syncNow(B.page);
    const setBefore = await setOf(B.page);
    await menuClick(A.page, '#cloudBtn'); await A.page.waitForSelector('.sheet .storage'); await sleep(200);
    await A.page.getByRole('button', { name: /Restore an automatic cloud backup/ }).click(); await A.page.locator('.sheet .card.tap', { hasText: OLD_BACKUP }).click(); await sleep(400);
    const asked = A.page.said.splice(0).join('|'), now = await held(A.page);
    await A.page.keyboard.press('Escape'); await sleep(200);
    await saved(A.page); await syncNow(B.page); await syncNow(A.page); await syncNow(B.page);
    const want = 'edit:Right title,keep:Keep me';
    ok('a restore says the other devices follow', /Replace the data on this device with vdex-backup-.+\? Your other devices follow at their next sync\./.test(asked), asked);
    ok('after a restore of a dated backup both devices end with what the backup holds: the deleted booking back, the old title, and nothing made since', wrong.join() === 'edit:WRONG title,x:B made this,y:A made this' && now.join() === want && (await held(A.page)).join() === want && (await held(B.page)).join() === want, JSON.stringify([wrong, now, await held(A.page), await held(B.page)]));
    ok('…and so with a timecode log: the note made since the backup and the scripts put in since are gone again on both devices', logBefore === 'n1+n2 / Second draft / A first script' && (await logOf(A.page)) === 'n1 / First draft / no script' && (await logOf(B.page)) === 'n1 / First draft / no script', JSON.stringify([logBefore, await logOf(A.page), await logOf(B.page)]));
    const SET = 'Name in the backup / 500 / Shoot day / corporate';
    ok('…and with the profile, the billing settings, the price list and the checklists: what was changed or emptied since the backup is as the backup has it, on both devices', setBefore === 'Name typed since / 900 / no list / no checklists' && (await setOf(A.page)) === SET && (await setOf(B.page)) === SET, JSON.stringify([setBefore, await setOf(A.page), await setOf(B.page)]));

    // ---- a damaged or foreign file given to Import backup… ----
    const importFile = async (page, name, text) => { page.said.length = 0; await toasts(page); await page.locator('.sheet .file-btn input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) }); await sleep(500); return { toast: (await toasts(page)).join('|'), asked: page.said.splice(0).join('|') }; };
    await menuClick(A.page, '#cloudBtn'); await A.page.waitForSelector('.sheet .storage'); await sleep(200);
    const cut = await importFile(A.page, 'cut.json', JSON.stringify({ version: 1, bookings: [{ id: 'q', title: 'Cut off' }] }).slice(0, 40));
    const foreign = await importFile(A.page, 'other.json', '{"gear":"none","name":"something else"}');
    const csvFile = await importFile(A.page, 'register.csv', '"Item","Category"\r\n"Lens cloth",""');
    const NOT = 'Import failed: this is not a Vdex backup file, or the file is incomplete.';
    ok('a backup cut short, another app’s file and a spreadsheet are each refused in words a person can act on, and nothing is replaced', [cut, foreign, csvFile].every(r => r.toast === NOT && r.asked === '') && (await held(A.page)).join() === want, JSON.stringify([cut, foreign, csvFile]));
    const mixed = await importFile(A.page, 'odd.json', JSON.stringify({ version: 1, bookings: [null, 'x', { title: 'No id', date: '2026-12-02' }, { id: 'ok', title: 'Fine', date: '2026-12-03', status: 'Confirmed' }], gear: [null], crew: [] }));
    await A.page.keyboard.press('Escape'); await sleep(300);
    await A.page.evaluate(() => window.logiGo('bookings')); await sleep(400);
    ok('a backup with entries that are no records is imported without them, and the question says what the file holds', /It holds 1 booking, 0 people, 0 items\./.test(mixed.asked) && mixed.toast === 'Imported' && (await held(A.page)).join() === 'ok:Fine' && (await A.page.locator('#rolodex .drum-btn').count()) > 0 && (await st(A.page, s => s.db.gear.length)) === 0, JSON.stringify(mixed));
    await saved(A.page); await syncNow(B.page);
    ok('…and the other device follows it without a script error', (await held(B.page)).join() === 'ok:Fine' && (await state(B.page)).status === 'synced', JSON.stringify(await state(B.page)));

    // ---- the example data replaces what was there, on every device ----
    A.page.said.length = 0;
    await menuClick(A.page, '#cloudBtn'); await A.page.waitForSelector('.sheet .storage'); await sleep(200);
    await A.page.getByRole('button', { name: 'Load sample data' }).click(); await sleep(300);
    const sampleAsked = A.page.said.splice(0).join('|');
    await A.page.keyboard.press('Escape'); await sleep(200);
    await saved(A.page); await syncNow(B.page); await syncNow(A.page);
    const afterSample = [await st(A.page, s => [s.db.bookings.length, s.db.gear.length, !!s.byId('bookings', 'ok')].join()), await st(B.page, s => [s.db.bookings.length, s.db.gear.length, !!s.byId('bookings', 'ok')].join())];
    ok('Load sample data replaces the data on a linked device too: both end with the examples only', afterSample[0] === '8,10,false' && afterSample[1] === '8,10,false', afterSample.join(' | '));
    ok('…and its question says so before anything is replaced', sampleAsked === 'Replace your current data with example data? Your other devices follow at their next sync.', sampleAsked);

    // ---- a device left unopened for most of a year does not bring back what was deleted meanwhile ----
    const DAY = 864e5, db0 = cloudDb(cloud);
    cloud.files.set(MAIN, JSON.stringify({ ...db0, deleted: { ...db0.deleted, old: Date.now() - 190 * DAY } }));
    const local = { version: 1, updatedAt: Date.now() - 200 * DAY, bookings: [{ id: 'old', title: 'Deleted long ago', date: '2026-01-10', status: 'Confirmed', updatedAt: Date.now() - 200 * DAY }], deleted: {} };
    const T = await device(cloud, 'T', { seed: { 'logi-db-v1': JSON.stringify(local) } });
    await start(T.page); await synced(T.page); await sleep(300);
    ok('a booking deleted 190 days ago stays deleted when a tablet last used 200 days ago is opened again', !(await held(T.page)).some(x => x.startsWith('old:')) && !cloudDb(cloud).bookings.some(b => b.id === 'old') && !!cloudDb(cloud).deleted.old, (await held(T.page)).length + ' bookings');
    await T.ctx.close(); await C.ctx.close();

    // ---- Disconnect, and Erase all data, while a sync is reading ----
    await add(B.page, 'last', 'B saved last'); await saved(B.page); // the cloud copy is now B's own, word for word: the sync below finds nothing to do
    cloud.delay = 450;
    await st(B.page, s => { s.sync(); setTimeout(() => s.unlinkCloud(), 80); }); await sleep(1300);
    ok('Disconnect while a sync is reading leaves “kept on this device only”, not “synced”', JSON.stringify(await state(B.page)) === '{"status":"off","error":"","linked":false}' && (await B.page.locator('#cloudBtn').getAttribute('data-state')) === 'off', JSON.stringify(await state(B.page)));
    await Promise.all([A.page.waitForEvent('load'), st(A.page, s => { s.sync(); setTimeout(() => s.eraseAll(), 60); })]);
    await A.page.waitForSelector('#rolodex .drum-btn'); await sleep(400);
    cloud.delay = 0;
    ok('Erase all data while a sync is reading leaves nothing on the device', (await st(A.page, s => [s.db.bookings.length, s.db.crew.length, s.db.gear.length, !!s.cloud.adapter].join())) === '0,0,0,false' && (await A.page.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1') || '{"bookings":[]}').bookings.length)) === 0);
    await A.ctx.close(); await B.ctx.close();

    // ---- found by the second check of these repairs ----
    // A restore on a device whose clock is out: 20 minutes behind it must still outrank what that device has taken
    // from the cloud; 20 minutes ahead it must not outrank what the other device does afterwards.
    for (const [word, off] of [['behind', -20 * 60e3], ['ahead', 20 * 60e3]]) {
      const cl = newCloud(), P = await device(cl, 'P', { clock: off }), Q = await device(cl, 'Q');
      await start(Q.page); await add(Q.page, 'b1', 'One'); await add(Q.page, 'b2', 'Two as in the backup'); await saved(Q.page);
      await start(P.page); await synced(P.page);
      const file = await st(P.page, s => s.exportJSON());
      await st(Q.page, s => { s.remove('bookings', 'b1'); s.upsert('bookings', { ...s.byId('bookings', 'b2'), title: 'Two changed since' }); }); await add(Q.page, 'b3', 'Three made since'); await saved(Q.page);
      await syncNow(P.page); const before = (await held(P.page)).join();
      await P.page.evaluate(text => import('./js/backup.js').then(m => m.importData(new File([text], 'file.json'))), file);
      await saved(P.page); await syncNow(Q.page); await syncNow(P.page);
      const want = 'b1:One,b2:Two as in the backup', restored = [(await held(P.page)).join(), (await held(Q.page)).join()];
      ok(`a restore on a device whose clock is 20 minutes ${word} holds after the sync, on both devices`, before === 'b2:Two changed since,b3:Three made since' && restored[0] === want && restored[1] === want, JSON.stringify([before, ...restored]));
      // …and work done on the other device afterwards is kept: an edit through the form, a deletion, a tick (stamped by its own code) and a payment on an invoice
      await st(Q.page, s => { s.upsert('bookings', { ...s.byId('bookings', 'b2'), title: 'Two edited after the restore', invoice: { number: 'INV-1', status: 'Sent', lines: [], payments: [{ id: 'p', amount: 5 }], updatedAt: Date.now() } }); s.remove('bookings', 'b1'); s.update(d => { const b = d.bookings.find(x => x.id === 'b2'); b.checks = { ticked: 1 }; b.updatedAt = Date.now(); }); });
      await saved(Q.page); await syncNow(P.page); await syncNow(Q.page);
      const after = await Promise.all([P, Q].map(d => st(d.page, s => s.db.bookings.map(b => `${b.id}:${b.title}:${Object.keys(b.checks || {}).join()}:${((b.invoice || {}).payments || []).length}`).join())));
      ok(`…and what the other device does after it is kept on both (the restoring clock ${word})`, after[0] === 'b2:Two edited after the restore:ticked:1' && after[1] === after[0], JSON.stringify(after));
      // found by the last check: with the restoring clock ahead, the other device's copy holds a later time than its own
      // clock, and whatever it changes is counted as later still. A change must go on knowing its own records by the
      // time they got: an equipment import is taken back by its Undo, and a call sheet marked sent after its stripboard
      // was arranged reads Sent (and Changed once the stripboard is arranged again).
      const scene = n => ({ list: [{ id: 'day-1', type: 'break' }, { id: 'sc' + n, type: 'scene', scene: String(n), set: 'Hall' }], cast: [] });
      const undo = await Q.page.evaluate(async () => { const g = await import('./js/gear-import.js'), s = await import('./js/store.js'); const done = g.applyGearImport(g.planGearImport([{ name: 'Lens from a list' }, { name: 'Light from a list' }], {}), {}), had = s.db.gear.length; const r = g.undoGearImport(done); return [had, r.removed, r.kept, s.db.gear.length].join(); });
      ok(`an equipment import made while the copy is ${off > 0 ? 'ahead of this device\'s clock' : 'in step with it'} is taken back by its Undo`, undo === '2,2,0,0', undo);
      await st(Q.page, (s, bd) => { s.update(d => { const b = d.bookings.find(x => x.id === 'b2'); b.board = { ...bd, updatedAt: Date.now() }; b.callSheet = { generalCall: '08:00', version: 1, editedAt: Date.now() }; b.updatedAt = Date.now(); }); }, scene(1));
      await Q.page.evaluate(() => import('./js/pages/bookings.js').then(m => m.openBooking('b2', { view: 'callsheet' })));
      await Q.page.locator('button', { hasText: 'Mark as sent' }).first().click();
      await Q.page.waitForFunction(() => import('./js/store.js').then(s => !!(s.byId('bookings', 'b2').callSheet || {}).sentAt));
      const sheet = () => Q.page.evaluate(() => Promise.all([import('./js/store.js'), import('./js/callsheet.js')]).then(([s, c]) => c.sheetState(s.byId('bookings', 'b2'))));
      const sentThen = await sheet(), line = (await Q.page.locator('.status-line').first().innerText()).replace(/\s+/g, ' ');
      await st(Q.page, (s, bd) => { s.update(d => { const b = d.bookings.find(x => x.id === 'b2'); b.board = { ...bd, updatedAt: Date.now() }; b.updatedAt = Date.now(); }); }, scene(2));
      ok(`a call sheet marked sent after its stripboard was arranged reads Sent, and Changed once the scenes are arranged again (the other clock ${word})`, sentThen === 'sent' && /Sent/.test(line) && !/Changed/.test(line) && (await sheet()) === 'changed', JSON.stringify([sentThen, line, await sheet()]));
      await P.ctx.close(); await Q.ctx.close();
    }
    // …and two such devices that each change the same booking before either has read the other: both count their
    // change as one past the same time. Stamped alike, each kept its own for ever (a tie goes to the copy here) and
    // uploaded the whole copy at every sync. Each running Vdex now counts in a seat of its own, so the two times
    // differ, one wins on both devices, and nothing more is uploaded.
    {
      const cl = newCloud(), P = await device(cl, 'P', { clock: 20 * 60e3 }), Q = await device(cl, 'Q'), R = await device(cl, 'R');
      await start(P.page); await add(P.page, 'x', 'Made where the clock is ahead'); await saved(P.page);
      await start(Q.page); await synced(Q.page); await start(R.page); await synced(R.page);
      // (a seat is drawn at each start, one of 256: should R have drawn Q's, it starts again)
      const seat = page => st(page, s => (typeof s.stampSeat === 'function' ? s.stampSeat() : -1)), seatQ = await seat(Q.page);
      for (let i = 0; i < 20 && seatQ >= 0 && (await seat(R.page)) === seatQ; i++) { await R.page.reload(); await R.page.waitForSelector('#rolodex .drum-btn'); await synced(R.page); }
      cl.offline = true; // neither reads the other's change before it has made its own
      await st(Q.page, s => s.upsert('bookings', { ...s.byId('bookings', 'x'), title: 'Changed on Q' }));
      await st(R.page, s => s.upsert('bookings', { ...s.byId('bookings', 'x'), title: 'Changed on R' }));
      const aheadOfClock = await st(Q.page, s => s.db.updatedAt > Date.now());
      cl.offline = false;
      for (let i = 0; i < 2; i++) { await syncNow(Q.page); await syncNow(R.page); }
      cl.log.length = 0;
      for (let i = 0; i < 3; i++) { await syncNow(Q.page); await syncNow(R.page); }
      const both = [(await held(Q.page)).join(), (await held(R.page)).join()], more = cl.log.filter(l => / PUT /.test(l) && l.endsWith(MAIN)).length;
      ok('two devices whose copy is ahead of their clocks each change the same booking before reading the other: they end with the same one and upload nothing more', aheadOfClock && both[0] === both[1] && /^x:Changed on [QR]$/.test(both[0]) && more === 0, JSON.stringify([aheadOfClock, both, more]));
      await P.ctx.close(); await Q.ctx.close(); await R.ctx.close();
    }
    // …but only what was itself stamped ahead counts as ahead. Counted past the newest time in the whole copy, a change
    // to a booking nobody stamped ahead carried the fast clock's time, and so did a deletion's mark on the bookings it
    // was taken off and every record a restore brought back: a later change made on a device that had not read the
    // fast clock (out of reach, or still on 1.4.0) was undone everywhere without a word, for as long as that clock led.
    {
      const cl = newCloud(), A = await device(cl, 'A'), C = await device(cl, 'C'), D = await device(cl, 'D'), X = await device(cl, 'X', { clock: 6 * 36e5 });
      const view = page => st(page, s => { const b = s.byId('bookings', 'b'); return `${b.title} / ${b.notes || 'no notes'} / ${b.gear.join('+')}`; });
      await start(A.page);
      await st(A.page, s => { s.upsert('gear', { id: 'g1', name: 'Camera' }); s.upsert('gear', { id: 'g2', name: 'Lens' }); });
      await add(A.page, 'b', 'Booked on A', { gear: ['g1', 'g2'], notes: '' }); await saved(A.page);
      await start(C.page); await synced(C.page); await start(D.page); await synced(D.page); // C and D go out of reach before anything is stamped ahead
      await start(X.page); await synced(X.page); await add(X.page, 'x', 'Made where the clock is 6 hours ahead'); await st(X.page, s => s.upsert('gear', { id: 'gx', name: 'Drone', serial: 'DX-1' })); await saved(X.page);
      await front(A.page);
      await st(A.page, s => s.upsert('bookings', { ...s.byId('bookings', 'b'), title: 'Renamed on A first' }));
      const stampA = await st(A.page, s => s.byId('bookings', 'b').updatedAt - Date.now()), copyA = await st(A.page, s => s.db.updatedAt - Date.now());
      await saved(A.page);
      cl.offline = true; await sleep(1500);
      await st(C.page, s => s.upsert('bookings', { ...s.byId('bookings', 'b'), title: 'Renamed on C later, out of reach', notes: 'Notes typed on C' })); await sleep(300);
      await st(A.page, s => s.remove('gear', 'g1')); // taken off booking b, which counts as changed one moment after A's own copy of it
      cl.offline = false; await sleep(1200);
      for (let i = 0; i < 3; i++) { await syncNow(A.page); await syncNow(C.page); }
      const ends = [await view(A.page), await view(C.page)], stored = cloudDb(cl).bookings.find(b => b.id === 'b'), WANT = 'Renamed on C later, out of reach / Notes typed on C / g2';
      ok('with another device’s clock 6 hours ahead, a booking changed here keeps this clock’s time, and a later change on a device out of reach stands everywhere, a deletion’s mark on it included', copyA > 5 * 36e5 && stampA < 2000 && ends.every(v => v === WANT) && `${stored.title} / ${stored.notes} / ${stored.gear.join('+')}` === WANT, JSON.stringify([copyA, stampA, ends]));
      // …and a restore made on a copy that holds the fast clock's time gives it to nothing restored: a change made after
      // it on a device still out of reach stands
      const file = await st(A.page, s => s.exportJSON());
      await A.page.evaluate(text => import('./js/backup.js').then(m => m.importData(new File([text], 'file.json'))), file);
      const restoredAt = await st(A.page, s => s.byId('bookings', 'b').updatedAt - Date.now());
      await saved(A.page);
      cl.offline = true; await sleep(1100);
      await st(D.page, s => s.upsert('bookings', { ...s.byId('bookings', 'b'), title: 'Renamed on D after the restore, out of reach' }));
      cl.offline = false; await sleep(1200);
      for (let i = 0; i < 2; i++) { await syncNow(D.page); await syncNow(A.page); await syncNow(C.page); }
      const after = [await view(A.page), await view(C.page), await view(D.page)];
      ok('…and a restore on that copy stamps the booking with this clock, so a change made after it on a device out of reach stands on every device', restoredAt < 2000 && after.every(v => v.startsWith('Renamed on D after the restore, out of reach / ')), JSON.stringify([restoredAt, after]));
      // …and an equipment import that updates the item stamped ahead and adds one beside it (the two then carry different times) is taken back by its Undo
      const undo = await A.page.evaluate(async () => { const g = await import('./js/gear-import.js'), s = await import('./js/store.js'); const done = g.applyGearImport(g.planGearImport([{ name: 'Drone', serial: 'DX-1', notes: 'from a list' }, { name: 'Light from a list' }], { onSerial: 'update' }), {}); const ats = new Set(s.db.gear.filter(x => ['Drone', 'Light from a list'].includes(x.name)).map(x => x.updatedAt)).size, r = g.undoGearImport(done); return [ats, r.removed, r.restored, r.kept, s.db.gear.map(x => `${x.name}:${x.notes || ''}`).sort().join('+')].join(); });
      ok('…and an equipment import that updates an item stamped ahead and adds another is taken back whole by its Undo', undo === '2,1,1,0,Drone:+Lens:', undo);
      await A.ctx.close(); await C.ctx.close(); await D.ctx.close(); await X.ctx.close();
    }
    // …and two copies of a booking with the same time that say different things (two starts that drew the same seat, or
    // two changes in the same millisecond) are settled alike on both devices. Each kept its own for good, and both
    // uploaded the whole copy at every sync.
    {
      const T = Date.now() - 60000, copy = title => JSON.stringify({ version: 1, updatedAt: T, bookings: [{ id: 'tie', title, date: '2026-12-01', status: 'Confirmed', crew: [], gear: [], updatedAt: T }], deleted: {} });
      const cl = newCloud(), P = await device(cl, 'P', { seed: { 'logi-db-v1': copy('Renamed on P') } }), Q = await device(cl, 'Q', { seed: { 'logi-db-v1': copy('Renamed on Q') } });
      await start(P.page); await synced(P.page); await start(Q.page); await synced(Q.page);
      for (let i = 0; i < 2; i++) { await syncNow(P.page); await syncNow(Q.page); }
      cl.log.length = 0;
      for (let i = 0; i < 3; i++) { await syncNow(P.page); await syncNow(Q.page); }
      const both = [(await held(P.page)).join(), (await held(Q.page)).join()], more = cl.log.filter(l => / PUT /.test(l) && l.endsWith(MAIN)).length, stored = cloudDb(cl).bookings.find(b => b.id === 'tie').title;
      ok('two copies of a booking with the same time and different words end the same on both devices and in the storage, and nothing more is uploaded', both[0] === both[1] && /^tie:Renamed on [PQ]$/.test(both[0]) && both[0] === 'tie:' + stored && more === 0, JSON.stringify([both, stored, more]));
      await P.ctx.close(); await Q.ctx.close();
    }
    {
      const cl = newCloud(), P = await device(cl, 'P'), Q = await device(cl, 'Q');
      const writes = name => cl.log.filter(l => l === `${name} PUT ${MAIN}`).length, rounds = async n => { cl.log.length = 0; for (let i = 0; i < n; i++) { await front(P.page); await sleep(150); await front(Q.page); await sleep(150); } return writes('P') + writes('Q'); };
      await start(P.page);
      await st(P.page, s => s.update(d => { const t = Date.now() - 60000; d.gear.push({ id: 'g1', name: 'Lens', updatedAt: t }, { id: 'g2', name: 'Light', updatedAt: t }); d.crew.push({ id: 'c1', name: 'Sam', updatedAt: t }); d.venues.push({ id: 'v1', name: 'Hall', updatedAt: t }); d.kits.push({ id: 'k1', name: 'Kit', gear: ['g1', 'g2'], gearQty: { g1: 2 }, updatedAt: t }); d.shifts.push({ id: 's1', date: '2026-11-02', start: 1, end: 2, breaks: [], updatedAt: t }); d.logs.push({ id: 'tl9', title: 'Log', notes: [], updatedAt: t });
        d.bookings.push({ id: 'x', title: 'Job', date: '2026-12-01', status: 'Confirmed', gear: ['g1', 'g2'], gearQty: { g1: 2 }, crew: ['c1'], kits: ['k1'], venueId: 'v1', updatedAt: t }); d.profile = { ...d.profile, name: 'Alex Example', updatedAt: t }; d.billing = { ...d.billing, dayRate: 500, updatedAt: t }; }));
      await saved(P.page); await start(Q.page); await synced(Q.page);
      // An item, a person and a venue deleted on one device and changed a moment later on the other, which had not heard
      await st(Q.page, s => { s.remove('gear', 'g1'); s.remove('crew', 'c1'); s.remove('venues', 'v1'); }); await saved(Q.page);
      await st(P.page, s => { s.upsert('gear', { ...s.byId('gear', 'g1'), notes: 'cleaned' }); s.upsert('crew', { ...s.byId('crew', 'c1'), phone: '555 0100' }); s.upsert('venues', { ...s.byId('venues', 'v1'), notes: 'ring first' }); });
      await saved(P.page); await syncNow(Q.page); await syncNow(P.page);
      const refs = page => st(page, s => { const b = s.byId('bookings', 'x'), k = s.byId('kits', 'k1'); return [`x gear ${b.gear.join('+')} crew ${(b.crew || []).join('+')} venue ${b.venueId || 'none'} qty ${Object.keys(b.gearQty || {}).join('+')}`, `k1 ${k.gear.join('+')}`, s.db.gear.map(g => g.id).sort().join('+')].join(' | '); });
      const refsNow = [await refs(P.page), await refs(Q.page)], idle = await rounds(3);
      ok('something deleted on one device and changed a moment later on another comes back off the bookings and kits, the same on both devices, and nothing is uploaded after that', refsNow[0] === 'x gear g2 crew  venue none qty  | k1 g2 | g1+g2' && refsNow[1] === refsNow[0] && idle === 0, JSON.stringify([...refsNow, idle]));
      // A file that carries one list is not a whole backup: what it does not carry stays, here and on the other device
      const kinds = page => st(page, s => [s.db.bookings.map(b => b.id).join('+'), s.db.crew.length, s.db.gear.map(g => g.id).join('+'), s.db.kits.length, s.db.venues.length, s.db.shifts.length, s.db.logs.length, s.db.profile.name, s.db.billing.dayRate].join(' / '));
      P.page.said.length = 0;
      await P.page.evaluate(text => import('./js/backup.js').then(m => m.importData(new File([text], 'items.json'))), JSON.stringify({ gear: [{ id: 'g9', name: 'The one item' }] }));
      const partAsked = P.page.said.splice(0).join('|');
      await saved(P.page); await syncNow(Q.page); await syncNow(P.page);
      const part = [await kinds(P.page), await kinds(Q.page)];
      ok('a file that carries only the equipment replaces only the equipment: bookings, people, venues, hours, logs and settings stay, on both devices', part[0] === 'x / 1 / g9 / 1 / 1 / 1 / 1 / Alex Example / 500' && part[1] === part[0], JSON.stringify(part));
      ok('…and the question says what will be deleted and what the file does not carry', partAsked === 'Replace your current data with this file? It holds 1 item. What is here and not in the file will be deleted: 2 items. It does not carry bookings, people, kits, venues, days of hours or timecode logs: those stay as they are. Your other devices follow at their next sync.', partAsked);
      // The example data on a linked device: the profile it fills in is the same on both, and nothing is uploaded for it afterwards
      await st(P.page, s => s.loadSample()); await saved(P.page); await syncNow(Q.page); await syncNow(P.page);
      const prof = await Promise.all([P, Q].map(d => st(d.page, s => [s.db.profile.name, s.db.profile.title].join('/')))), idle2 = await rounds(3);
      ok('after Load sample data both devices hold the same profile and upload nothing more', prof[0] === 'Alex Example/Videographer / DOP' && prof[1] === prof[0] && idle2 === 0, JSON.stringify([...prof, idle2]));
      // Switching the calendar feed on reads the cloud copy before it writes
      await add(Q.page, 'q-late', 'Made on Q meanwhile'); await saved(Q.page); cl.log.length = 0;
      await st(P.page, s => s.setFeed(true)); await sleep(300);
      const feedLog = cl.log.filter(l => l.startsWith('P ')).join(' ; ');
      ok('switching the calendar feed on reads the cloud copy first: what another device saved meanwhile stays in it, and the feed is written', /^P GET vdex-production-db\.json ; P PUT vdex-production-db\.json/.test(feedLog) && / PUT vdex-bookings\.ics/.test(feedLog) && cloudDb(cl).bookings.some(b => b.id === 'q-late') && (await held(P.page)).some(x => x.startsWith('q-late:')), feedLog);
      // On a slow storage the menu says Saving… from the moment the save starts, not Synced while the change is on this device alone
      await saved(P.page); cl.delay = 1200; await add(P.page, 'slow', 'Saved slowly'); await sleep(1500);
      const during = { state: await P.page.locator('#cloudBtn').getAttribute('data-state'), there: cloudDb(cl).bookings.some(b => b.id === 'slow') };
      cl.delay = 0; await sleep(2600); await synced(P.page);
      ok('while a change is on its way to a slow storage Vdex says Saving…, and Synced once it is there', during.state === 'saving' && !during.there && cloudDb(cl).bookings.some(b => b.id === 'slow') && (await P.page.locator('#cloudBtn').getAttribute('data-state')) === 'synced', JSON.stringify(during));
      await P.ctx.close(); await Q.ctx.close();
    }

    // "Get the subscription link" and "Create feed file" read the cloud copy before they write as well (the repair of
    // the feed switch covered them by reading only): with a stand-in storage that another device saves to meanwhile,
    // each reads first, keeps that device's booking here and in the storage, and writes a feed that holds it.
    {
      const F = await device(null, 'F', { linked: false });
      await start(F.page);
      const feed = await F.page.evaluate(async () => {
        const s = await import('./js/store.js'); await import('./js/calendar.js');
        s.upsert('bookings', { id: 'here', title: 'Made here', date: '2026-12-01', status: 'Confirmed', crew: [], gear: [] });
        const log = []; let text = s.exportJSON(), ics = '';
        const elsewhere = (id, title) => { const c = JSON.parse(text), at = Math.max(Date.now(), Number(c.updatedAt) || 0) + 5; c.bookings.push({ id, title, date: '2026-12-02', status: 'Confirmed', crew: [], gear: [], updatedAt: at }); c.updatedAt = at; text = JSON.stringify(c); };
        s.cloud.adapter = { id: 'fake', label: 'Stand-in', where: 'nowhere', ready: async () => true, read: async () => { log.push('read'); return JSON.parse(text); }, write: async t => { log.push('write'); text = t; }, writeAux: async x => { log.push('feed'); ics = x.text; }, shareLink: async n => 'https://files.example/' + n };
        s.update(d => { d.calSync = { ...d.calSync, feed: true, updatedAt: Date.now() }; });
        for (let i = 0; i < 200 && !(log.includes('write') && s.cloud.status === 'synced'); i++) await new Promise(r => setTimeout(r, 50)); // (the timed save of that change: waited for, not timed)
        log.length = 0;
        elsewhere('there', 'Saved by another device');
        const link = await s.feedLink(), linkLog = log.splice(0).join(' '), afterLink = [s.db.bookings.map(b => b.id).sort().join(), JSON.parse(text).bookings.map(b => b.id).sort().join(), ics.includes('Saved by another device') && ics.includes('Made here')];
        elsewhere('last', 'One more from elsewhere'); ics = '';
        window.showSaveFilePicker = async () => ({ name: 'vdex-bookings.ics' });
        await s.createFeedFile();
        return { link, linkLog, afterLink, fileLog: log.splice(0).join(' '), afterFile: [s.cloud.auxName, s.db.bookings.map(b => b.id).sort().join(), JSON.parse(text).bookings.map(b => b.id).sort().join(), ics.includes('One more from elsewhere') && ics.includes('Made here')] }; });
      ok('Get the subscription link reads the cloud copy first and keeps another device’s booking, in the feed too', feed.link === 'https://files.example/vdex-bookings.ics' && /^read /.test(feed.linkLog) && /feed/.test(feed.linkLog) && JSON.stringify(feed.afterLink) === '["here,there","here,there",true]', JSON.stringify([feed.link, feed.linkLog, feed.afterLink]));
      ok('Create feed file reads the cloud copy first and keeps another device’s booking, in the feed too', /^read /.test(feed.fileLog) && /feed/.test(feed.fileLog) && JSON.stringify(feed.afterFile) === '["vdex-bookings.ics","here,last,there","here,last,there",true]', JSON.stringify([feed.fileLog, feed.afterFile]));
      await F.ctx.close();
    }

    // A WebDAV link made under 1.4.0 with an accented letter in its password: that build sent one byte a letter, so the
    // server that accepted it refuses the UTF-8 form. The link goes on working, and remembers which form was taken.
    {
      const want = 'Basic ' + Buffer.from('u:pässwörd-é1', 'latin1').toString('base64'), seen = { refused: 0, ok: 0 }, files = new Map();
      const L = await device(null, 'L', { seed: { 'logi-webdav': JSON.stringify({ kind: 'webdav', url: 'https://dav.example/vdex', user: 'u', pass: 'pässwörd-é1' }) } });
      await L.ctx.route('https://dav.example/**', async route => {
        const r = route.request(), m = r.method(), file = decodeURIComponent(new URL(r.url()).pathname.split('/').pop());
        if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        if ((r.headers().authorization || '') !== want) { seen.refused++; return route.fulfill({ status: 401, headers: CORS, body: '' }); }
        seen.ok++;
        if (m === 'GET') return files.has(file) ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: files.get(file) }) : route.fulfill({ status: 404, headers: CORS, body: '' });
        if (m === 'PUT') { files.set(file, r.postData() || ''); return route.fulfill({ status: 201, headers: CORS }); }
        return route.fulfill({ status: 201, headers: CORS }); });
      await start(L.page); await synced(L.page);
      const first = { ...seen, status: (await state(L.page)).status, kept: await L.page.evaluate(() => JSON.parse(localStorage.getItem('logi-webdav')).latin1) };
      await add(L.page, 'lat', 'Saved after the update'); await saved(L.page);
      ok('a WebDAV link from before the update with ä, ö and é in its password still syncs: the form that server took is tried after one refusal, and kept', first.status === 'synced' && first.refused === 1 && first.kept === true && seen.refused === 1 && files.has(MAIN) && /Saved after the update/.test(files.get(MAIN)), JSON.stringify([first, seen]));
      await L.ctx.close();
      // found by the last check: Vdex put away while that first sync is being refused and tried again. The lock then
      // takes the link's settings off the disk (they are in the encrypted copy) and puts them back when Vdex is in
      // front again, unless something is there already. The form that worked must not be written in their place: a
      // bare "latin1" was all that was left of the address, the username and the password.
      const link = JSON.stringify({ kind: 'webdav', url: 'https://dav.example/vdex', user: 'u', pass: 'pässwörd-é1' }), M = await device(null, 'M', { seed: { 'logi-webdav': link } });
      let away = false;
      await M.ctx.route('https://dav.example/**', async route => {
        const r = route.request(), m = r.method(), file = decodeURIComponent(new URL(r.url()).pathname.split('/').pop());
        if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        if ((r.headers().authorization || '') !== want) { if (!away) { away = true; await M.page.evaluate(() => localStorage.removeItem('logi-webdav')); } return route.fulfill({ status: 401, headers: CORS, body: '' }); } // (as the lock does when Vdex is put away)
        if (m === 'GET') return files.has(file) ? route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: files.get(file) }) : route.fulfill({ status: 404, headers: CORS, body: '' });
        if (m === 'PUT') { files.set(file, r.postData() || ''); return route.fulfill({ status: 201, headers: CORS }); }
        return route.fulfill({ status: 201, headers: CORS }); });
      await start(M.page); await synced(M.page);
      const left = await M.page.evaluate(() => localStorage.getItem('logi-webdav')), then = (await state(M.page)).status;
      await M.page.evaluate(text => { if (localStorage.getItem('logi-webdav') == null) localStorage.setItem('logi-webdav', text); }, link); // (as the lock does when Vdex is in front again)
      await M.page.reload(); await M.page.waitForSelector('#rolodex .drum-btn'); await synced(M.page);
      const whole = await M.page.evaluate(() => JSON.parse(localStorage.getItem('logi-webdav') || '{}'));
      ok('…and with Vdex put away while it is tried again, nothing is written in place of the link’s settings: the link is whole afterwards and syncs', away && left === null && then === 'synced' && whole.url === 'https://dav.example/vdex' && whole.pass === 'pässwörd-é1' && whole.latin1 === true && (await state(M.page)).status === 'synced', JSON.stringify([left, then, whole, await state(M.page)]));
      await M.ctx.close();
    }

    // ---- two windows of Vdex on one device ----
    const W = await device(null, 'W', { linked: false }), w2 = await W.ctx.newPage(); w2.on('pageerror', e => scriptErrors.push('W2: ' + e.message));
    await start(W.page); await start(w2);
    await add(W.page, 'one', 'Made in window 1'); await sleep(250); await add(w2, 'two', 'Made in window 2'); await sleep(350);
    const onDisk = await w2.evaluate(() => JSON.parse(localStorage.getItem('logi-db-v1')).bookings.map(b => b.id).sort().join());
    ok('a booking made in one window is not lost when another window saves: both windows and the disk hold both', onDisk === 'one,two' && (await held(W.page)).length === 2 && (await held(w2)).length === 2, onDisk + ' | ' + (await held(W.page)).join());
    await w2.close();

    // ---- the storage sheet follows what was just done in it ----
    const page2 = W.page, cloud2 = newCloud(); await dav(W.ctx, cloud2, 'W');
    await menuClick(page2, '#cloudBtn'); await page2.waitForSelector('.sheet .storage'); await sleep(200);
    const health = () => page2.locator('.sheet .health-line').innerText(), restoreBtn = () => page2.locator('.sheet button', { hasText: 'Restore an automatic cloud backup' }).count();
    const before = [await health(), await restoreBtn()];
    await Promise.all([page2.waitForEvent('download'), page2.getByRole('button', { name: 'Export backup' }).click()]); await sleep(400);
    const afterExport = await health();
    // Import backup… is a control the keyboard reaches and works
    const imp = page2.locator('.sheet .file-btn input[type=file]');
    // (On a busy machine the sheet may still be drawing itself again after the export when the focus is put on it, and
    // the chooser may take seconds to open: the step is tried again once the sheet is still, and the chooser is waited
    // for, not a fixed time.)
    let reached = null;
    for (let i = 0; i < 4 && !(reached && reached.focused); i++) { if (i) await sleep(500); await page2.getByRole('button', { name: /Encrypted backup/ }).focus(); await page2.keyboard.press('Tab');
      reached = await imp.evaluate(el => ({ focused: document.activeElement === el, shown: getComputedStyle(el).display !== 'none', named: el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '', ring: getComputedStyle(el.closest('.file-btn')).outlineStyle })); }
    let chooser = false; for (const key of ['Enter', ' ']) if (!chooser) chooser = await Promise.all([page2.waitForEvent('filechooser', { timeout: 12000 }).then(() => true, () => false), page2.keyboard.press(key)]).then(r => r[0]);
    ok('Import backup… takes the focus on Tab, shows it, is named by its label and opens the file chooser on Enter', reached.focused && reached.shown && reached.named === 'Import backup…' && reached.ring === 'solid' && chooser, JSON.stringify([reached, chooser]));
    // connect: a folder address without https://, and a password with a character outside Latin-1
    const mine2 = []; page2.on('request', q => { if (q.url().startsWith(BASE) && /dav\.example/.test(q.url())) mine2.push(q.method() + ' ' + q.url()); });
    await moreWays(page2);
    await page2.locator('.sheet button[role=tab]:has-text("Other WebDAV")').click();
    await page2.locator('.sheet input[aria-label="Folder address"]').fill('dav.example/vdex'); await page2.locator('.sheet input[aria-label="Username"]').fill('u'); await page2.locator('.sheet input[aria-label="App password"]').fill('pässwörd€1');
    await toasts(page2);
    await page2.locator('.sheet .card:has-text("Nextcloud") button:has-text("Connect")').click(); await synced(page2); await sleep(400);
    const typed = Buffer.from((cloud2.auth || '').replace(/^Basic /, ''), 'base64').toString('utf8');
    ok('a WebDAV folder address typed without https:// reaches that server, and nothing is sent to Vdex’s own address', (await state(page2)).status === 'synced' && cloud2.log.includes(`W PUT ${MAIN}`) && mine2.length === 0 && /^Connected to WebDAV \(dav\.example\)/.test((await toasts(page2)).join('|')), JSON.stringify([cloud2.log.slice(0, 4), mine2]));
    ok('a password with ä, ö and € is sent as typed (UTF-8)', typed === 'u:pässwörd€1', typed);
    const afterConnect = [await health(), await restoreBtn()];
    ok('the Backups part follows: no copy anywhere at first, the backup file after Export backup, the cloud after connecting, with the Restore button', /No copy of your data exists anywhere but this device/.test(before[0]) && before[1] === 0 && /Last off-device copy: today \(backup file\)/.test(afterExport) && /Last off-device copy: today/.test(afterConnect[0]) && !/Link a cloud storage/.test(afterConnect[0]) && afterConnect[1] === 1, JSON.stringify([before, afterExport, afterConnect]));
    // a long account address wraps inside the connected card
    await page2.evaluate(() => { localStorage.setItem('logi-cloud-who', 'Test Person · alexandria.testington.longname@subdomain.example.com'); }); await page2.setViewportSize({ width: 360, height: 800 });
    await page2.keyboard.press('Escape'); await sleep(200); await menuClick(page2, '#cloudBtn'); await page2.waitForSelector('.sheet .cloud-linked'); await sleep(200);
    const edges = await page2.evaluate(() => { const card = document.querySelector('.sheet .cloud-linked .card').getBoundingClientRect(); return { card: Math.round(card.right), text: Math.round(Math.max(...[...document.querySelectorAll('.sheet .cloud-head strong, .sheet .cloud-head .small')].map(e => e.getBoundingClientRect().right))) }; });
    ok('a long account address wraps inside the connected card (360 px)', edges.text <= edges.card, JSON.stringify(edges));
    await page2.evaluate(() => localStorage.removeItem('logi-cloud-who')); await page2.setViewportSize({ width: 420, height: 900 });
    // backups that cannot be listed are not “no backups”; a dated backup that cannot be written is said
    cloud2.offline = true;
    await page2.getByRole('button', { name: /Restore an automatic cloud backup/ }).click(); await sleep(900);
    const unlisted = await sheetText(page2);
    cloud2.offline = false;
    await page2.locator('.sheet').last().getByRole('button', { name: 'Try again' }).click(); await sleep(900);
    const listed = await sheetText(page2);
    ok('Restore with the storage out of reach says it could not list the backups and offers Try again, which then lists them', /could not list the backups in WebDAV \(dav\.example\)/.test(unlisted) && !/No automatic backups yet/.test(unlisted) && /vdex-backup-/.test(listed), unlisted.slice(0, 200));
    await page2.keyboard.press('Escape'); await sleep(200);
    cloud2.fail = (m, file) => (m === 'PUT' && /^vdex-backup-/.test(file) ? 507 : 0);
    await page2.evaluate(() => localStorage.removeItem('logi-backup-cloud')); // as on the next day: a dated backup is due again
    await add(page2, 'three', 'Made later'); await saved(page2);
    const trouble = await page2.locator('.sheet .backup-trouble').innerText().catch(() => '');
    ok('a dated backup the storage refuses is said in the Backups part, while the copy itself is up to date', (await state(page2)).status === 'synced' && /Today’s automatic backup could not be written to WebDAV \(dav\.example\): WebDAV: the server has no room left\./.test(trouble), trouble);
    cloud2.fail = null;
    // a cloud copy that was cut short while it was being saved
    const whole = cloud2.files.get(MAIN); cloud2.files.set(MAIN, whole.slice(0, Math.floor(whole.length * 0.6)));
    await page2.locator('.sheet').getByRole('button', { name: 'Sync now' }).click(); await sleep(700);
    const damaged = [await state(page2), await page2.locator('.sheet .cloud-linked').innerText().then(x => x.replace(/\s+/g, ' '))];
    await page2.locator('.sheet').getByRole('button', { name: 'Replace it with this device’s copy' }).click(); await synced(page2); await sleep(400);
    const mended = (() => { try { return cloudDb(cloud2).bookings.map(b => b.id).sort().join(); } catch { return 'still damaged'; } })();
    ok('a damaged cloud copy is called damaged, and one tap puts this device’s copy in its place, the damaged one kept beside it', damaged[0].status === 'error' && /The copy in your storage is damaged/.test(damaged[1]) && !/Unterminated|JSON/.test(damaged[1]) && mended === 'one,three,two' && cloud2.files.get('vdex-damaged-copy.json') === whole.slice(0, Math.floor(whole.length * 0.6)) && (await state(page2)).status === 'synced', JSON.stringify([damaged, mended]));
    // disconnecting takes the Restore button away again
    await page2.locator('.sheet').getByRole('button', { name: 'Disconnect' }).click(); await sleep(500);
    ok('…and after Disconnect the Restore button is gone', (await restoreBtn()) === 0 && (await state(page2)).linked === false);
    await page2.keyboard.press('Escape'); await sleep(200);

    // ---- a file in a synced folder needs permission again, not a sign-in ----
    await st(page2, s => { s.cloud.adapter = { id: 'file', label: 'vdex-production-db.json', ready: async ask => { if (ask && window.__allow) window.__granted = true; return !!window.__granted; }, read: async () => null, write: async () => {} }; return s.sync(); }); await sleep(300); // allowed once the person says so at a tap, as the browser does it
    await openMenu(page2);
    const menuSays = await page2.evaluate(() => [document.getElementById('cloudLabel').textContent, document.getElementById('menuStatusTitle').textContent, document.getElementById('menuStatusText').textContent, document.getElementById('menuBtn').getAttribute('aria-label')]);
    await page2.locator('#cloudBtn').click(); await page2.waitForSelector('.sheet .cloud-linked'); await sleep(200);
    const fileCard = (await page2.locator('.sheet .cloud-linked .card').innerText()).replace(/\s+/g, ' ');
    await toasts(page2); await page2.evaluate(() => { window.__allow = true; });
    await page2.locator('.sheet').getByRole('button', { name: 'Allow access again' }).click(); await synced(page2); await sleep(300);
    const allowed = (await toasts(page2)).join('|');
    ok('a file in a synced folder that the browser no longer lets Vdex use asks for permission, with no word of signing in', menuSays[0] === 'Allow access' && menuSays[1] === 'Vdex needs your permission to use vdex-production-db.json again' && /Allow access again/.test(menuSays[2]) && !/[Ss]ign/.test(menuSays.join(' ') + fileCard) && /Needs your permission again/.test(fileCard) && allowed === 'Access allowed. Up to date.', JSON.stringify([menuSays, fileCard, allowed]));
    await page2.keyboard.press('Escape'); await sleep(200);

    // ---- the calendar feed: what came in from another device reaches it; a device not yet allowed to write it says so ----
    const feed = await page2.evaluate(async () => {
      const s = await import('./js/store.js'); await import('./js/calendar.js');
      const remote = { ...JSON.parse(s.serialize()), bookings: [...s.db.bookings, { id: 'phone', title: 'Made on the phone', date: '2026-12-05', status: 'Confirmed', updatedAt: Date.now() }] };
      let writes = 0; const aux = []; window.__feedOk = false; window.__refuse = false; // the storage below answers as one another device saved to last
      s.update(d => { d.calSync = { ...d.calSync, feed: true, updatedAt: Date.now() }; });
      s.cloud.adapter = { id: 'fake', label: 'Fake Drive', ready: async () => true, read: async () => JSON.parse(JSON.stringify({ ...remote, calSync: s.db.calSync, updatedAt: Date.now() + 1000 })), write: async () => { writes++; }, writeAux: async x => { aux.push(x.text); },
        feedReady: () => window.__feedOk, enableFeed: async () => { if (window.__refuse) throw new Error('Google sign-in was cancelled'); window.__feedOk = true; }, shareLink: async () => 'https://feed.example/x' };
      await s.sync(); await new Promise(r => setTimeout(r, 200));
      return { writes, aux: aux.length, holds: aux.some(x => /Made on the phone/.test(x)), has: !!s.byId('bookings', 'phone') };
    });
    ok('a booking that arrives from another device is written into the calendar feed, though nothing is uploaded', feed.has && feed.writes === 0 && feed.aux === 1 && feed.holds, JSON.stringify(feed));
    await page2.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page2.waitForSelector('.sheet .feed-allow'); await sleep(200);
    const notYet = await sheetText(page2);
    await toasts(page2); await page2.locator('.sheet').getByRole('button', { name: 'Let this device update the feed' }).click(); await sleep(500);
    ok('a device where the feed was switched on elsewhere says it may not update the feed yet, and one tap allows it', /has not been allowed to update the feed file on Fake Drive yet/.test(notYet) && !/Get the subscription link/.test(notYet) && (await toasts(page2)).join('|') === 'This device now updates the feed' && (await page2.locator('.sheet .feed-allow').count()) === 0 && /Get the subscription link/.test(await sheetText(page2)), notYet.slice(-260));
    const box = page2.locator('.sheet label.check input[type=checkbox]');
    await box.uncheck(); await sleep(400); await page2.evaluate(() => { window.__feedOk = false; window.__refuse = true; });
    await toasts(page2); await box.click(); await sleep(500);
    const refusedFeed = [await box.isChecked(), (await toasts(page2)).join('|'), await st(page2, s => s.db.calSync.feed)];
    ok('a feed that could not be switched on leaves its box unticked and says why', JSON.stringify(refusedFeed) === '[false,"The feed was not switched on: Google sign-in was cancelled.",false]', JSON.stringify(refusedFeed));
    await page2.keyboard.press('Escape'); await sleep(200);
    await st(page2, s => { s.cloud.adapter = null; });

    // ---- Google: tokens the lock put back after Vdex had loaded; a full storage ----
    await W.ctx.route('https://www.googleapis.com/**', route => { if (preflight(route)) return; const u = route.request().url(); if (/upload\/drive/.test(u)) return json(route, 403, { error: { code: 403, message: 'The user’s Drive storage quota has been exceeded.', errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded' }] } }); return json(route, 200, { files: [] }); });
    const google = await page2.evaluate(async () => {
      const p = await import('./js/providers.js'), scope = 'https://www.googleapis.com/auth/drive.appdata';
      const nothing = await p.googleToken(scope, false).then(() => 'a token', e => e.name);
      localStorage.setItem('logi-google-tokens', JSON.stringify({ [scope]: { value: 'kept-for-its-hour', exp: Date.now() + 50 * 60e3 } })); // as the lock does at the unlock
      const afterUnlock = await p.googleToken(scope, false).then(t => t, e => e.name);
      const full = await p.gdriveAdapter().write('{}').then(() => 'written', e => e.message);
      return { nothing, afterUnlock, full };
    });
    ok('Google tokens saved for their hour and put back by the lock after Vdex loaded are used: no sign-in is asked for', google.nothing === 'NotAllowedError' && google.afterUnlock === 'kept-for-its-hour', JSON.stringify(google));
    ok('a full Google storage says so, in words a person can act on', /^Your Google storage is full\. Free up some space in Google Drive, Gmail or Photos/.test(google.full), google.full);
    await W.ctx.close();

    // ---- Dropbox: a busy answer when the token is renewed is a passing error, not a lost sign-in ----
    for (const mode of ['503 with a page of text', '429']) {
      const D = await device(null, 'D', { linked: false, seed: { 'logi-provider': 'dropbox', 'logi-dbx-token': JSON.stringify({ refresh: 'r1', access: 'old', exp: 1, client: IDS.dropbox }) } });
      const box = { busy: true, tokens: 0, uploads: 0, file: '' };
      await D.ctx.route('https://api.dropboxapi.com/oauth2/token', route => { if (preflight(route)) return; box.tokens++; if (!box.busy) return json(route, 200, { access_token: 'new', expires_in: 14400 }); return mode === '429' ? json(route, 429, { error: 'too_many_requests' }) : route.fulfill({ status: 503, headers: { ...CORS, 'content-type': 'text/html' }, body: '<html>Service Unavailable</html>' }); });
      await D.ctx.route('https://content.dropboxapi.com/2/files/**', route => { if (preflight(route)) return; if (/upload/.test(route.request().url())) { box.uploads++; box.file = route.request().postData(); return json(route, 200, {}); } return box.file ? route.fulfill({ status: 200, headers: CORS, body: box.file }) : json(route, 409, { error_summary: 'path/not_found/' }); });
      await D.ctx.route('https://api.dropboxapi.com/2/**', route => (preflight(route) ? null : json(route, 200, {})));
      await start(D.page); await sleep(500);
      const busy = [await state(D.page), await D.page.evaluate(() => !!localStorage.getItem('logi-dbx-token'))];
      box.busy = false; await D.page.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(900); await synced(D.page);
      ok(`Dropbox answering ${mode} when the token is renewed: a passing error, the sign-in kept, and the next sync goes through`, busy[0].status === 'error' && new RegExp(`^Dropbox is not answering just now \\(${mode.slice(0, 3)}\\)$`).test(busy[0].error) && busy[1] === true && (await state(D.page)).status === 'synced' && box.uploads >= 1, JSON.stringify([busy, await state(D.page), box.uploads]));
      await D.ctx.close();
    }
    ok('the syncing and storage repairs: no script errors', scriptErrors.length === 0, scriptErrors.slice(0, 3).join(' | '));
  }
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

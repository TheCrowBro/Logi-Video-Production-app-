// Connecting cloud storage by signing in: the built-in apps, the one-tap Connect buttons, Dropbox's redirect round
// trip, Google's and Microsoft's sign-in windows (stood in for), undo on a cancelled sign-in, a developer's own key,
// Nextcloud's shortcut and folder creation, the calendar panel, and the "not switched on yet" state.
const { chromium } = require('playwright');
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
    if (stubs) await ctx.addInitScript(() => {
      // Google Identity Services, standing in for the sign-in window
      window.google = { accounts: { oauth2: { initTokenClient: cfg => { window.__gcfg = cfg; return { requestAccessToken: o => { window.__greq = o; setTimeout(() => window.__gfail ? cfg.callback({ error: 'access_denied' }) : cfg.callback({ access_token: 'gtok' + Math.random(), expires_in: 3600, scope: window.__gdeny ? 'https://www.googleapis.com/auth/drive.appdata' : cfg.scope }), 10); } }; } } } };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if ((m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (400|404|409)/.test(m.text())) || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); // 404/409: the services' normal "no file yet" on a first connect; 400: Microsoft asking for consent to the calendar
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const openCloud = async page => { await page.locator('#cloudBtn').click(); await page.waitForSelector('.sheet .storage'); await sleep(200); };
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
  ok('when Google’s hour is up the top bar says Sign in', (await page.locator('#cloudBtn').innerText()).includes('Sign in'));
  await page.locator('.sheet button:has-text("Sign in again")').click();
  const reSynced = await synced(page), reHint = await page.evaluate(() => window.__greq && window.__greq.login_hint);
  ok('signing in again takes one tap and names the account', reSynced && reHint === 'gee@example.com', JSON.stringify({ reSynced, reHint, state: await page.evaluate(() => document.getElementById('cloudBtn').dataset.state), err: await page.evaluate(() => import('./js/store.js').then(s => s.cloud.error)) }));
  await page.evaluate(() => localStorage.setItem('logi-google-scopes', localStorage.getItem('logi-google-scopes') + ' https://www.googleapis.com/auth/calendar.app.created'));
  await page.evaluate(async () => { (await import('./js/providers.js')).forgetGoogleToken('https://www.googleapis.com/auth/drive.appdata'); });
  await page.locator('.sheet button:has-text("Sync now")').click(); await synced(page);
  ok('one Google window renews Drive and Calendar together', /drive\.appdata/.test(await page.evaluate(() => window.__gcfg.scope)) && /calendar\.app\.created/.test(await page.evaluate(() => window.__gcfg.scope)));
  ok('…and the calendar is then covered without another window', await page.evaluate(async () => { const p = await import('./js/providers.js'); return !!(await p.googleToken('https://www.googleapis.com/auth/calendar.app.created', false)); }));
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
  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

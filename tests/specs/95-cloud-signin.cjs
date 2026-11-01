// Connecting cloud storage by signing in: the built-in apps, the one-tap Connect buttons, Dropbox's redirect round
// trip, Google's and Microsoft's sign-in windows (stood in for), undo on a cancelled sign-in, a developer's own key,
// Nextcloud's shortcut and folder creation, the calendar panel, and the "not switched on yet" state.
const { chromium } = require('playwright');
const BASE = process.env.VDEX_URL || 'http://localhost:8123/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const IDS = { dropbox: 'dbxTestKey123', google: '123-test.apps.googleusercontent.com', microsoft: '11111111-2222-3333-4444-555555555555' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const synced = page => page.waitForFunction(() => document.getElementById('cloudBtn')?.dataset.state === 'synced', null, { timeout: 15000 }).then(() => true, () => false);
const preflight = route => route.request().method() === 'OPTIONS' && (route.fulfill({ status: 204, headers: CORS }), true);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async ({ ids = IDS, stubs = true } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
    await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
    if (ids) await ctx.route('**/js/cloud-config.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: `export const CLOUD_APPS = ${JSON.stringify(ids)};` }));
    await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
    if (stubs) await ctx.addInitScript(() => {
      // Google Identity Services, standing in for the sign-in window
      window.google = { accounts: { oauth2: { initTokenClient: cfg => { window.__gcfg = cfg; return { requestAccessToken: o => { window.__greq = o; setTimeout(() => window.__gfail ? cfg.callback({ error: 'access_denied' }) : cfg.callback({ access_token: 'gtok' + Math.random(), expires_in: 3600, scope: window.__gdeny ? '' : cfg.scope }), 10); } }; } } } };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if ((m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (400|404|409)/.test(m.text())) || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); }); // 404/409: the services' normal "no file yet" on a first connect; 400: Microsoft asking for consent to the calendar
    page.on('dialog', d => d.accept());
    return { ctx, page };
  };
  const openCloud = async page => { await page.locator('#cloudBtn').click(); await page.waitForSelector('.sheet .storage'); await sleep(200); };
  const closeSheet = async page => { await page.keyboard.press('Escape'); await sleep(200); };
  const card = (page, svc) => page.locator(`.sheet .cloud-choice[data-svc="${svc}"]`);

  // --- not switched on yet ---
  { const { ctx, page } = await newPage({ ids: { dropbox: '', google: '', microsoft: '' } });
    await page.goto(BASE); await page.waitForSelector('#rolodex .drum-btn');
    await openCloud(page);
    const disabled = await page.evaluate(() => ['dropbox', 'gdrive', 'onedrive'].map(s => document.querySelector(`.sheet .cloud-choice[data-svc="${s}"] button`).disabled));
    ok('without built-in apps the three Connect buttons are greyed out', disabled.every(Boolean), JSON.stringify(disabled));
    const text = await page.locator('.sheet .storage').innerText();
    ok('…and say plainly that sign-in is not switched on, with a link to how', /Not switched on in this copy of Vdex yet/.test(text) && (await page.locator('.sheet a[href$="docs/turn-on-sign-in.md"]').count()) >= 3);
    ok('no developer key boxes are in sight', (await page.locator('.sheet input[aria-label="Dropbox app key"]').isVisible()) === false);
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
  const enabled = await page.evaluate(() => ['dropbox', 'gdrive', 'onedrive'].map(s => !document.querySelector(`.sheet .cloud-choice[data-svc="${s}"] button`).disabled));
  ok('with built-in apps all three Connect buttons are ready', enabled.every(Boolean), JSON.stringify(enabled));
  ok('the panel speaks plainly: sign in, own folder only', /Sign in to your own cloud storage/.test(await page.locator('.sheet .storage').innerText()) && /cannot see, change or share any of your other files/.test(await page.locator('.sheet .storage').innerText()));

  // Dropbox: one tap → Dropbox → back → connected
  await card(page, 'dropbox').locator('button').click();
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
  await card(page, 'gdrive').locator('button').click(); await sleep(600);
  ok('a cancelled Google sign-in leaves nothing half-linked and says why', !(await page.evaluate(() => localStorage.getItem('logi-provider'))) && (await card(page, 'gdrive').count()) === 1 && /cancelled/i.test(await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')));
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
  await page.locator('.sheet button:has-text("Disconnect")').click(); await sleep(300);

  // OneDrive: Microsoft's page and back, as with Dropbox; a cancel first, then a sign-in
  let odPuts = 0, msAuth = null, msTokenReqs = [], msCancel = true;
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  await ctx.route('https://login.microsoftonline.com/common/oauth2/v2.0/authorize**', route => { msAuth = new URL(route.request().url()); const back = new URL(msAuth.searchParams.get('redirect_uri')); back.searchParams.set('state', msAuth.searchParams.get('state')); if (msCancel) { back.searchParams.set('error', 'access_denied'); back.searchParams.set('error_description', 'AADSTS65004: User declined to consent.'); } else back.searchParams.set('code', 'MSCODE'); route.fulfill({ status: 302, headers: { location: back.href } }); });
  await ctx.route('https://login.microsoftonline.com/common/oauth2/v2.0/token', route => { if (preflight(route)) return; const body = new URLSearchParams(route.request().postData()); msTokenReqs.push(Object.fromEntries(body)); if (body.get('grant_type') === 'refresh_token' && /Calendars/.test(body.get('scope')) && !msAuth.searchParams.get('scope').includes('Calendars')) return json(route, 400, { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented.' }); json(route, 200, { access_token: 'mtok' + msTokenReqs.length, refresh_token: 'mref' + msTokenReqs.length, expires_in: 3600, scope: body.get('scope'), id_token: b64({ alg: 'none' }) + '.' + b64({ name: 'Sam Test', preferred_username: 'sam@contoso.example' }) + '.sig' }); });
  await ctx.route('https://graph.microsoft.com/**', route => { if (preflight(route)) return; if (route.request().method() === 'PUT') { odPuts++; return json(route, 201, {}); } if (/\/me\/calendars/.test(route.request().url())) return json(route, route.request().method() === 'POST' ? 201 : 200, route.request().method() === 'POST' ? { id: 'cal1' } : { value: [] }); return json(route, 404, {}); });
  await card(page, 'onedrive').locator('button').click();
  await page.waitForURL(u => !/state=/.test(u.toString()) && /127\.0\.0\.1|localhost/.test(u.toString()), { timeout: 15000 }); await page.waitForSelector('#rolodex .drum-btn'); await sleep(900);
  ok('a cancelled Microsoft sign-in leaves OneDrive unlinked and says why', !(await page.evaluate(() => localStorage.getItem('logi-provider'))) && /cancelled/i.test(await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')));
  msCancel = false;
  await openCloud(page);
  ok('the reason stays in the panel until the next try', /cancelled/i.test(await page.locator('.sheet .storage .warn').innerText().catch(() => '')));
  await card(page, 'onedrive').locator('button').click();
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
  await page.locator('.sheet button:has-text("Sign in again")').click();
  await page.waitForURL(u => !/state=/.test(u.toString()), { timeout: 15000 }); await page.waitForSelector('#rolodex .drum-btn');
  ok('signing in again names the account instead of asking which one', msAuth.searchParams.get('login_hint') === 'sam@contoso.example' && !msAuth.searchParams.get('prompt'));
  ok('…and OneDrive carries on', await synced(page));
  // Outlook calendar on top: the OneDrive sign-in is reused, consent for the calendar is asked once
  await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice');
  await page.locator('.sheet .cloud-choice[data-svc="microsoft"] button').click();
  await page.waitForURL(u => !/state=/.test(u.toString()), { timeout: 15000 }); await page.waitForSelector('#rolodex .drum-btn');
  await page.waitForFunction(() => import('./js/store.js').then(s => s.db.calSync && s.db.calSync.provider === 'microsoft' && !!s.db.calSync.calendarId), null, { timeout: 15000 }).catch(() => {});
  const cs = await page.evaluate(() => import('./js/store.js').then(s => s.db.calSync));
  ok('connecting Outlook asks for the calendar and keeps the OneDrive permission', /Calendars\.ReadWrite/.test(msAuth.searchParams.get('scope')) && /Files\.ReadWrite\.AppFolder/.test(msAuth.searchParams.get('scope')));
  ok('…and comes back with the calendar connected and made', cs.provider === 'microsoft' && cs.calendarId === 'cal1', JSON.stringify({ p: cs.provider, c: cs.calendarId }));
  await page.evaluate(async () => { (await import('./js/calendar.js')).disconnectCalendar(); });
  ok('disconnecting Outlook keeps the OneDrive sign-in', !!(await page.evaluate(() => localStorage.getItem('logi-ms-token'))));
  await page.evaluate(async () => (await import('./js/store.js')).unlinkCloud()); await sleep(300);
  ok('disconnecting OneDrive then forgets the Microsoft sign-in', !(await page.evaluate(() => localStorage.getItem('logi-ms-token'))));
  await openCloud(page);

  // A developer's own Dropbox key wins, with the address the page was opened at
  await page.goto(BASE + 'index.html'); await page.waitForSelector('#rolodex .drum-btn'); await openCloud(page);
  await page.locator('.sheet summary:has-text("Advanced")').click();
  await page.locator('.sheet input[aria-label="Dropbox app key"]').fill('myOwnKey');
  authUrl = null;
  await card(page, 'dropbox').locator('button').click();
  await page.waitForFunction(() => localStorage.getItem('logi-provider') === 'dropbox', null, { timeout: 15000 });
  ok('a developer key replaces the built-in one and keeps its own return address', authUrl && authUrl.searchParams.get('client_id') === 'myOwnKey' && authUrl.searchParams.get('redirect_uri') === BASE + 'index.html', authUrl && authUrl.searchParams.get('redirect_uri'));
  ok('…and the exchange matches it', tokenBody.get('client_id') === 'myOwnKey' && tokenBody.get('redirect_uri') === BASE + 'index.html');
  await page.evaluate(async () => { localStorage.removeItem('logi-dropbox-key'); (await import('./js/store.js')).unlinkCloud(); }); await sleep(300);

  // Nextcloud: only the address, the folder made on connect
  const dav = [];
  await ctx.route('https://cloud.example.test/**', route => { const r = route.request(); if (preflight(route)) return; dav.push(r.method() + ' ' + new URL(r.url()).pathname); if (r.method() === 'MKCOL') return route.fulfill({ status: 201, headers: CORS }); if (r.method() === 'PUT') return route.fulfill({ status: 201, headers: CORS }); return route.fulfill({ status: 404, headers: CORS }); });
  await openCloud(page);
  await page.locator('.sheet summary:has-text("Other ways")').click();
  await page.locator('.sheet button[role=tab]:has-text("Nextcloud")').click();
  await page.locator('.sheet input[aria-label="Your Nextcloud address"]').fill('cloud.example.test');
  await page.locator('.sheet input[aria-label="Username"]').fill('jo');
  await page.locator('.sheet input[aria-label="App password"]').fill('app-pass');
  await page.locator('.sheet .card:has-text("Nextcloud") button:has-text("Connect")').click();
  await page.waitForFunction(() => localStorage.getItem('logi-provider') === 'webdav', null, { timeout: 15000 }).catch(() => {});
  ok('Nextcloud needs only the address: the Vdex folder is made in the user’s files', dav.includes('MKCOL /remote.php/dav/files/jo/Vdex/') && dav.some(x => x === 'PUT /remote.php/dav/files/jo/Vdex/vdex-production-db.json'), dav.join(', '));
  ok('the panel names it Nextcloud', /Connected to Nextcloud \(cloud\.example\.test\)/.test(await page.locator('.sheet .storage').innerText()));
  await closeSheet(page);

  // Calendar: one tap, no key boxes
  await page.evaluate(() => import('./js/calendar.js').then(m => m.openCalendarSheet())); await page.waitForSelector('.sheet .cloud-choice');
  const cal = await page.evaluate(() => [...document.querySelectorAll('.sheet .cloud-choice')].map(c => [c.dataset.svc, !c.querySelector('button').disabled]));
  ok('the calendar panel offers Google and Outlook as one-tap connections', JSON.stringify(cal) === '[["google",true],["microsoft",true]]' && (await page.locator('.sheet input[aria-label*="client"]').count()) === 0, JSON.stringify(cal));

  ok('no page errors or CSP violations', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });

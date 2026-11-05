// The licence Worker (cloudflare/worker.mjs), bundled as Wrangler does and run in Cloudflare's own runtime (workerd,
// through Miniflare), with Stripe and Resend faked: the Buy link, the thank-you page, the Stripe webhook (email the
// code; cancel it on a refund), the 3-computer activation with swaps and release, the owner's signed requests, and
// the desktop app's licence talking to it end to end. Needs `npm ci --prefix cloudflare` (CI does it).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
const REPO = path.resolve(__dirname, '../..');
const NM = path.join(REPO, 'cloudflare/node_modules');
const codes = require(path.join(ROOT, 'desktop/licence-codes.js'));
const { createLicence } = require(path.join(ROOT, 'desktop/licence.js'));

(async () => {
  if (!fs.existsSync(path.join(NM, 'miniflare'))) { console.log('FAIL the Worker spec needs Wrangler\'s runtime — run: npm ci --prefix cloudflare'); process.exit(1); }
  const esbuild = require(path.join(NM, 'esbuild'));
  const { Miniflare, convertV4MiniflareOptions } = require(path.join(NM, 'miniflare'));
  let mf, mf2;
  try {
    const owner = await codes.newKeyPair(), shop = await codes.newKeyPair(), spare = await codes.newKeyPair(), stranger = await codes.newKeyPair();
    const KEYS = { 1: owner.publicKey, 2: shop.publicKey, 9: spare.publicKey };
    const ownerKey = await codes.importPrivate(codes.b64u.enc(owner.pkcs8)), shopKey = await codes.importPrivate(codes.b64u.enc(shop.pkcs8));
    // Bundle the Worker the way Wrangler does, with this test's keys in place of desktop/licence-keys.json.
    const out = await esbuild.build({ entryPoints: [path.join(ROOT, 'cloudflare/worker.mjs')], bundle: true, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], write: false, logLevel: 'silent',
      plugins: [{ name: 'test-keys', setup(b) { b.onLoad({ filter: /licence-keys\.json$/ }, () => ({ contents: JSON.stringify(KEYS), loader: 'json' })); } }] });
    const script = out.outputFiles[0].text;

    const calls = [];
    const sessions = new Map();
    const session = (id, extra = {}) => ({ id, object: 'checkout.session', status: 'complete', payment_status: 'paid', payment_link: 'plink_vdex', created: Date.parse('2026-11-02T12:00:00Z') / 1000, payment_intent: 'pi_' + id.slice(-12), customer_details: { name: 'Pat Buyer', email: 'Pat@Example.com' }, ...extra });
    let resendStatus = 200;
    const outbound = async request => {
      const u = new URL(request.url), body = request.method === 'POST' ? await request.text() : '';
      calls.push({ url: u.href, method: request.method, headers: Object.fromEntries(request.headers), body });
      if (u.hostname === 'api.stripe.com') {
        if (request.headers.get('authorization') !== 'Bearer rk_test_key') return new Response('{"error":{}}', { status: 401 });
        const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(cs_[A-Za-z0-9_]+)$/);
        if (m) return sessions.has(m[1]) ? Response.json(sessions.get(m[1])) : new Response('{"error":{}}', { status: 404 });
        if (u.pathname === '/v1/checkout/sessions') {
          const byEmail = u.searchParams.get('customer_details[email]');
          if (byEmail) return Response.json({ data: [...sessions.values()].filter(s => String(s.customer_details.email).toLowerCase() === byEmail && s.payment_link === u.searchParams.get('payment_link')) });
          return Response.json({ data: [...sessions.values()].filter(s => s.payment_intent === u.searchParams.get('payment_intent')) });
        }
      }
      if (u.hostname === 'api.resend.com') return new Response(JSON.stringify({ id: 'email_1' }), { status: resendStatus });
      return new Response('unexpected', { status: 599 });
    };
    const env = { LICENCE_SHOP_KEY: codes.b64u.enc(shop.pkcs8), STRIPE_SECRET_KEY: 'rk_test_key', STRIPE_WEBHOOK_SECRET: 'whsec_testsecret', STRIPE_PAYMENT_LINK: 'plink_vdex', BUY_URL: 'https://buy.stripe.com/test_vdex', RESEND_API_KEY: 're_test', REPLY_TO: 'help@crowmade.app', WEB_SIGN_IN: 'on' };
    const opts = bindings => convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2026-10-01', kvNamespaces: ['LICENCES'], bindings, outboundService: outbound,
      serviceBindings: { ASSETS: req => new Response('static file ' + new URL(req.url).pathname) } });
    mf = new Miniflare(opts(env));
    const SITE = 'https://vdex.crowmade.app';
    const get = (p, init) => mf.dispatchFetch(SITE + p, { redirect: 'manual', ...init });
    const post = (p, body, m = mf) => m.dispatchFetch(SITE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

    ok('any other address is the static website', (await (await get('/index.html')).text()) === 'static file /index.html');
    const buy = await get('/buy');
    ok('/buy goes to the Stripe payment link', buy.status === 302 && buy.headers.get('location') === 'https://buy.stripe.com/test_vdex');

    /* ---------------------------- after paying ---------------------------- */
    const sid = 'cs_test_a1B2c3D4e5F6g7H8i9J0';
    sessions.set(sid, session(sid));
    const th = await get('/licence/thanks?session_id=' + sid), html = await th.text();
    const code = (html.match(/<textarea id="code"[^>]*>([^<]+)<\/textarea>/) || [])[1];
    const v = code && (await codes.verifyCode(code, { keys: KEYS }));
    ok('the thank-you page shows a code made by the shop key, for the buyer, for 3 computers', th.status === 200 && v && v.status === 'valid' && v.licence.kid === 2 && v.licence.name === 'Pat Buyer' && v.licence.email === 'pat@example.com' && v.licence.seats === 3 && !v.licence.comp && v.licence.issued === '2026-11-02');
    ok('reloading the page shows the same code', (await (await get('/licence/thanks?session_id=' + sid)).text()).includes(code));
    const csp = th.headers.get('content-security-policy') || '', nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
    ok('the page carries its own strict security headers and is never cached', !!nonce && html.includes(`<script nonce="${nonce}">`) && /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && th.headers.get('cache-control') === 'no-store' && th.headers.get('x-robots-tag') === 'noindex');
    const xsid = 'cs_test_Z9y8X7w6V5u4T3s2R1q0';
    sessions.set(xsid, session(xsid, { customer_details: { name: '<img src=x onerror=alert(1)>', email: 'x@example.com' } }));
    ok('a buyer\'s name is shown as text, never as page code', !(await (await get('/licence/thanks?session_id=' + xsid)).text()).includes('<img src=x'));
    sessions.set('cs_test_otherProduct0000001', session('cs_test_otherProduct0000001', { payment_link: 'plink_other' }));
    sessions.set('cs_test_notPaidYet00000000001', session('cs_test_notPaidYet00000000001', { payment_status: 'unpaid' }));
    ok('a payment for something else gets no code', (await get('/licence/thanks?session_id=cs_test_otherProduct0000001')).status === 404);
    ok('a payment still being confirmed says so', (await get('/licence/thanks?session_id=cs_test_notPaidYet00000000001')).status === 202);
    ok('a made-up order number gets no code', (await get('/licence/thanks?session_id=cs_test_doesNotExist0000001')).status === 404 && (await get('/licence/thanks?session_id=../../v1/balance')).status === 404);

    /* ------------------------------ webhooks ------------------------------ */
    const signed = (event, t = Math.floor(Date.now() / 1000), secret = env.STRIPE_WEBHOOK_SECRET) => {
      const body = JSON.stringify(event), sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
      return mf.dispatchFetch(SITE + '/licence/stripe-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body });
    };
    const done = { id: 'evt_1', type: 'checkout.session.completed', data: { object: sessions.get(sid) } };
    calls.length = 0;
    const wh = await signed(done), mail = calls.find(c => c.url === 'https://api.resend.com/emails'), mb = mail && JSON.parse(mail.body);
    ok('a completed payment emails the same code through Resend, once per order', wh.status === 200 && mb && mb.to[0] === 'pat@example.com' && mb.text.includes(code) && mb.reply_to === 'help@crowmade.app' && mail.headers['idempotency-key'] === 'vdex-licence-' + sid);
    ok('a webhook with a wrong or old signature is refused', (await signed(done, undefined, 'whsec_wrong')).status === 400 && (await signed(done, Math.floor(Date.now() / 1000) - 3600)).status === 400);
    resendStatus = 500;
    ok('if the email fails, Stripe is told to try again', (await signed(done)).status === 502);
    resendStatus = 200;

    /* ---------------------------- 3 computers ---------------------------- */
    const id = n => 'install-' + String(n).padStart(14, '0');
    const act = (install, extra = {}) => post('/licence/activate', { code, install, os: 'Mac', ...extra });
    const a1 = await act(id(1)), j1 = await a1.json();
    const rc = j1.receipt && (await codes.readNote('active', j1.receipt, { keys: KEYS }));
    ok('activating returns a receipt signed by the shop key for this code and computer', a1.status === 200 && rc && rc.ref === v.licence.ref && rc.install === id(1) && j1.receipt.kid === 2);
    ok('activating the same computer again is fine and takes no extra place', (await act(id(1))).status === 200 && (await (await act(id(2))).json()).used === 2 && (await (await act(id(3))).json()).used === 3);
    const f4 = await act(id(4)), j4 = await f4.json();
    ok('a fourth computer is told the code is full, with the others listed by a tag, never their IDs', f4.status === 409 && j4.error === 'full' && j4.computers.length === 3 && j4.swapsLeft === 3 && j4.computers.every(c => /^[A-Za-z0-9_-]{12}$/.test(c.tag) && c.os === 'Mac' && !JSON.stringify(c).includes('install-')));
    ok('a tag cannot be used to release another computer without a counted swap', (await post('/licence/release', { code, install: j4.computers[0].tag })).status === 400);
    const sw = await act(id(4), { release: j4.computers[0].tag });
    ok('choosing a computer to move it from activates the new one', sw.status === 200 && (await (await act(id(1))).json()).error === 'full');
    let last;
    for (let k = 5; k <= 6; k++) { const jj = await (await act(id(k))).json(); last = await act(id(k), { release: jj.computers[0].tag }); }
    const j7 = await (await act(id(7))).json();
    ok('after 3 moves in 30 days the code cannot move again', last.status === 200 && j7.swapsLeft === 0 && (await act(id(7), { release: j7.computers[0].tag })).status === 429);
    const listed = (await mf.getKVNamespace('LICENCES').then(kv => kv.get('c:' + v.licence.ref, 'json'))).computers.map(c => c.id);
    ok('releasing a computer frees its place; an unlisted one is told so', (await post('/licence/release', { code, install: listed[0] })).status === 200 && (await post('/licence/release', { code, install: listed[0] })).status === 404 && (await act(id(8))).status === 200);
    ok('a code that does not check out, or a bad computer ID, is refused', (await post('/licence/activate', { code: code.slice(0, -3) + 'AAA', install: id(9) })).status === 400 && (await post('/licence/activate', { code, install: 'x' })).status === 400 && (await post('/licence/activate', 'not json')).status === 400);

    /* ------------------------------ refunds ------------------------------ */
    const rsid = 'cs_test_refundMe0000000000001'; sessions.set(rsid, session(rsid));
    const rcode = (await (await get('/licence/thanks?session_id=' + rsid)).text()).match(/<textarea id="code"[^>]*>([^<]+)</)[1];
    ok('a code works before its refund', (await post('/licence/activate', { code: rcode, install: id(20) })).status === 200);
    ok('a partial refund keeps the code', (await (await signed({ type: 'charge.refunded', data: { object: { refunded: false, payment_intent: sessions.get(rsid).payment_intent } } })).json()).ignored === 'charge.refunded');
    const rf = await (await signed({ type: 'charge.refunded', data: { object: { refunded: true, payment_intent: sessions.get(rsid).payment_intent } } })).json();
    ok('a full refund cancels the code bought with that payment, and only that one', rf.cancelled === 1 && (await (await post('/licence/activate', { code: rcode, install: id(20) })).json()).error === 'cancelled' && (await act(id(8))).status === 200);

    /* ---------------------------- the owner ---------------------------- */
    const adm = async (op, ref, { key = ownerKey, kid = 1, at = Date.now() } = {}) => { const r = await post('/licence/admin', await codes.signNote('admin', key, kid, { op, ref, at })); return { status: r.status, cors: r.headers.get('access-control-allow-origin'), ...(await r.json()) }; };
    const look = await adm('look', v.licence.ref);
    ok('the owner can look a code up (signed with key 1), from the generator page on their computer', look.status === 200 && look.computers.length === 3 && look.swaps === 3 && !look.cancelled && look.cors === '*');
    const pre = await mf.dispatchFetch(SITE + '/licence/admin', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    ok('the browser\'s pre-check for the generator page is answered', pre.status === 204 && /POST/.test(pre.headers.get('access-control-allow-methods')));
    ok('clearing a code empties its computers', (await adm('clear', v.licence.ref)).computers.length === 0 && (await act(id(30))).status === 200);
    ok('cancelling a code stops it activating; restoring brings it back', (await adm('cancel', v.licence.ref, { key: await codes.importPrivate(codes.b64u.enc(spare.pkcs8)), kid: 9 })).cancelled.why === 'owner' && (await act(id(30))).status === 403 && !(await adm('restore', v.licence.ref)).cancelled && (await act(id(30))).status === 200);
    ok('the shop key cannot make owner requests, and nor can anyone else', (await adm('clear', v.licence.ref, { key: shopKey, kid: 2 })).status === 403 && (await adm('clear', v.licence.ref, { key: await codes.importPrivate(codes.b64u.enc(stranger.pkcs8)), kid: 1 })).status === 403);
    const stale = await adm('look', v.licence.ref, { at: Date.now() - 3600e3 });
    ok('an old signed request is refused, with the server\'s time so the page can retry', stale.status === 403 && stale.error === 'stale' && Math.abs(stale.now - Date.now()) < 60e3);

    /* --------------------- the desktop app, end to end --------------------- */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-e2e-'));
    const lic = createLicence({ dir, keys: KEYS, site: SITE, post: async (url, body) => { const r = await mf.dispatchFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; } });
    await lic.state();
    const free = await codes.signCode(ownerKey, 1, { name: 'Riley Free', comp: true, issued: '2026-11-02' });
    const e2e = await lic.enter(free);
    ok('the desktop app activates a free code against the real Worker', e2e.mode === 'licensed' && e2e.licence.comp && e2e.licence.name === 'Riley Free');
    ok('and releases it', (await lic.release()).mode === 'trial');
    fs.rmSync(dir, { recursive: true, force: true });

    /* --------------------------- website sign-in --------------------------- */
    const mails = () => calls.filter(c => c.url === 'https://api.resend.com/emails').map(c => JSON.parse(c.body));
    const lastCode = to => { const m = mails().filter(x => x.to[0] === to).at(-1); return m && (m.subject.match(/^(\d{6}) is your Vdex sign-in code$/) || [])[1]; };
    const web = (path, body, m = mf) => post('/licence/web/' + path, body, m).then(async r => ({ status: r.status, ...(await r.json()) }));
    ok('the website is told sign-in is on once the owner switches it on', (await (await get('/licence/web/status')).json()).on === true);
    calls.length = 0;
    const stranger1 = await web('start', { email: 'nobody@example.com' });
    ok('an email with no licence gets the same answer, and no email is sent to it', stranger1.status === 200 && stranger1.ok && !stranger1.email && mails().length === 0);
    const st = await web('start', { email: '  PAT@example.com ' });
    const pc = lastCode('pat@example.com'), sent = mails().at(-1);
    ok('the buyer\'s email (any case) gets a 6-digit code, which the email says works for 15 minutes', st.status === 200 && /^\d{6}$/.test(pc || '') && /15 minutes/.test(sent.text) && !sent.text.includes(code));
    const wrong = await web('verify', { email: 'pat@example.com', code: pc === '000000' ? '111111' : '000000' });
    ok('a wrong code is refused', wrong.status === 400 && wrong.error === 'wrong-code');
    const probe = await web('verify', { email: 'nobody@example.com', code: '000000' });
    ok('checking a code says nothing about whether the email has a licence (same answer for one with none)', JSON.stringify(probe) === JSON.stringify(wrong));
    const good = await web('verify', { email: 'pat@example.com', code: pc });
    const tok = good.token && (await codes.readNote('web', good.token, { keys: KEYS, signers: [2] }));
    ok('the right code signs in: a token signed by the shop for that email and licence', good.status === 200 && tok && tok.email === 'pat@example.com' && tok.ref === v.licence.ref && good.licence.seats === 3 && good.licence.email === 'pat@example.com');
    ok('each code works once', (await web('verify', { email: 'pat@example.com', code: pc })).error === 'wrong-code');
    ok('a signed-in browser checks back and is confirmed', (await web('check', { token: good.token })).ok === true);
    ok('a made-up or edited token is refused', (await web('check', { token: { ...good.token, data: good.token.data.replace('pat@', 'pam@') } })).status === 401 && (await web('check', { token: await codes.signNote('web', ownerKey, 1, { email: 'x@example.com', ref: '1:1', iat: 1 }) })).status === 401);
    await adm('cancel', v.licence.ref);
    ok('once its licence is cancelled (a refund), the next check signs it out', (await web('check', { token: good.token })).error === 'cancelled');
    await adm('restore', v.licence.ref);
    // Five tries, and five codes an hour.
    await web('start', { email: 'pat@example.com' });
    for (let i = 0; i < 5; i++) await web('verify', { email: 'pat@example.com', code: '999999' === lastCode('pat@example.com') ? '888888' : '999999' });
    ok('after 5 wrong tries even the right code is refused until a new one is sent', (await web('verify', { email: 'pat@example.com', code: lastCode('pat@example.com') })).error === 'wrong-code');
    const before = mails().filter(x => x.to[0] === 'pat@example.com').length;
    for (let i = 0; i < 6; i++) await web('start', { email: 'pat@example.com' });
    ok('no more than 5 codes an hour, and 4 a day, go to one address', mails().filter(x => x.to[0] === 'pat@example.com').length - before <= 2, `${mails().filter(x => x.to[0] === 'pat@example.com').length - before} more`);
    // A free code: linked by the generator, or used instead of an email.
    const freeCode = await codes.signCode(ownerKey, 1, { name: 'Robin Free', email: 'robin@example.com', comp: true, issued: '2026-11-02' });
    const viaCode = await web('start', { code: freeCode });
    ok('a licence code can be used instead of an email: the code goes to the email inside it', viaCode.ok && viaCode.email === 'robin@example.com' && /^\d{6}$/.test(lastCode('robin@example.com') || ''));
    const rb = await web('verify', { email: 'robin@example.com', code: lastCode('robin@example.com') });
    ok('and signs in with that free licence', rb.status === 200 && rb.licence.comp === true && rb.licence.ref.startsWith('1:'));
    const freeCode2 = await codes.signCode(ownerKey, 1, { name: 'Sam Linked', email: 'sam@example.com', comp: true, issued: '2026-11-02' });
    const lnk = await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'link', ref: (await codes.verifyCode(freeCode2, { keys: KEYS })).licence.ref, code: freeCode2, at: Date.now() }));
    await web('start', { email: 'sam@example.com' });
    ok('the generator links a free code\'s email, which can then sign in with just the email', lnk.status === 200 && /^\d{6}$/.test(lastCode('sam@example.com') || ''));
    const dsk = await codes.signCode(ownerKey, 1, { name: 'Desk Top', email: 'desk@example.com', comp: true, issued: '2026-11-02' });
    await post('/licence/activate', { code: dsk, install: 'install-desk-0000000001', os: 'Windows' });
    await web('start', { email: 'desk@example.com' });
    ok('a code activated in the desktop app links its email too', /^\d{6}$/.test(lastCode('desk@example.com') || ''));
    // A buyer whose webhook never arrived is found in Stripe.
    const lsid = 'cs_test_lateWebhook0000000001'; sessions.set(lsid, session(lsid, { customer_details: { name: 'Late Buyer', email: 'late@example.com' } }));
    calls.length = 0;
    await web('start', { email: 'late@example.com' });
    ok('a buyer with no webhook yet is looked up in Stripe and gets a code', calls.some(c => /customer_details%5Bemail%5D=late%40example\.com|customer_details\[email\]=late%40example\.com/.test(c.url)) && /^\d{6}$/.test(lastCode('late@example.com') || ''));
    // The Google Play app takes one of the licence's places.
    const robinTok = rb.token;
    const p1 = await web('activate', { token: robinTok, install: 'install-play-000000000001' });
    ok('the Play app takes a place on the licence, listed as Android', p1.status === 200 && (await adm('look', rb.licence.ref)).computers.some(c => c.os === 'Android'));
    await web('activate', { token: robinTok, install: 'install-play-000000000002' }); await web('activate', { token: robinTok, install: 'install-play-000000000003' });
    const p4 = await web('activate', { token: robinTok, install: 'install-play-000000000004' });
    ok('a fourth device is told the licence is full, as on a computer', p4.status === 409 && p4.error === 'full' && p4.computers.length === 3);
    ok('signing out in the Play app gives its place back', (await web('release', { token: robinTok, install: 'install-play-000000000001' })).ok === true && (await adm('look', rb.licence.ref)).computers.length === 2);
    // Two licences on one email: a full one does not stop the phone using the other.
    const second = await codes.signCode(ownerKey, 1, { name: 'Robin Free', email: 'robin@example.com', comp: true, issued: '2026-11-02', serial: 777 });
    await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'link', ref: '1:777', code: second, at: Date.now() }));
    await web('activate', { token: robinTok, install: 'install-play-000000000005' }); // the first licence is full again (3 places)
    const moved = await web('activate', { token: robinTok, install: 'install-play-000000000006' });
    const mt = moved.token && (await codes.readNote('web', moved.token, { keys: KEYS, signers: [2] }));
    ok('when the signed-in licence is full and the same email has another with room, the phone goes there with a token for it', moved.status === 200 && mt && mt.ref === '1:777' && moved.licence.ref === '1:777');
    await adm('cancel', '1:777');
    const back = await web('activate', { token: moved.token, install: 'install-play-000000000006' });
    const bt = back.token && (await codes.readNote('web', back.token, { keys: KEYS, signers: [2] }));
    ok('when that licence is then refunded, the phone carries on with the email\'s other licence instead of being signed out', !!bt && bt.ref === rb.licence.ref && back.licence.ref === rb.licence.ref && back.error !== 'cancelled');
    await adm('restore', '1:777');
    ok('a place cannot be taken without a real sign-in', (await web('activate', { token: { kid: 2, data: '{}', sig: 'x' }, install: 'install-play-000000000009' })).status === 401);

    // Website sign-in switched off: buyers are not told to sign in on the website; and the day's email cap.
    ok('with website sign-in on, the thank-you page tells buyers how to sign in on the website', /On the website or in the Android app/.test(await (await get('/licence/thanks?session_id=' + sid)).text()));
    mf2 = new Miniflare(opts({ ...env, WEB_SIGN_IN: '' }));
    calls.length = 0;
    const offPage = await (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).text();
    const t2 = Math.floor(Date.now() / 1000), raw2 = JSON.stringify(done), sig2 = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${t2}.${raw2}`).digest('hex');
    await mf2.dispatchFetch(SITE + '/licence/stripe-webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t2},v1=${sig2}` }, body: raw2 });
    const offMail = mails().at(-1);
    ok('with it off, neither the thank-you page nor the purchase email mentions website sign-in', offPage.includes(code) && !/Sign in|sign in with this email/.test(offPage) && offMail && offMail.text.includes(code) && !/sign in with this email/.test(offMail.text));
    await mf2.dispose();
    mf2 = new Miniflare(opts({ ...env, SIGN_IN_EMAILS_PER_DAY: '1' }));
    const kv2 = await mf2.getKVNamespace('LICENCES'); await kv2.put('e:pat@example.com', JSON.stringify({ licences: [{ ref: v.licence.ref, seats: 3 }] }));
    const firstOk = (await post('/licence/web/start', { email: 'pat@example.com' }, mf2)).status;
    const capLic = await (await post('/licence/web/start', { email: 'pat@example.com' }, mf2)).json(), capNone = await (await post('/licence/web/start', { email: 'nobody@example.com' }, mf2)).json();
    ok('once the day\'s sign-in emails are used up, everyone gets the same "try tomorrow" answer (purchase emails keep their room)', firstOk === 200 && capLic.error === 'busy' && JSON.stringify(capLic) === JSON.stringify(capNone));
    await mf2.dispose();

    /* ----------------------------- not set up ----------------------------- */
    mf2 = new Miniflare(opts({}));
    ok('before the owner switches it on, the website is told sign-in is off', (await (await mf2.dispatchFetch(SITE + '/licence/web/status')).json()).on === false && (await post('/licence/web/start', { email: 'pat@example.com' }, mf2)).status === 503);
    ok('before the shop is set up, /buy says it is not on sale yet and activation says "not ready"', (await mf2.dispatchFetch(SITE + '/buy', { redirect: 'manual' })).status === 200 && (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 503);
    await mf2.dispose();
    mf2 = new Miniflare(opts({ ...env, LICENCE_SHOP_KEY: codes.b64u.enc(stranger.pkcs8) }));
    ok('a shop key that is not the one built into Vdex keeps the shop closed instead of selling codes no app accepts', (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 404);

    /* ------------------------------ the App Store ------------------------------ */
    // The iPhone app's purchase: a certificate chain of our own stands in for Apple's (the Worker is told its root).
    const { execSync } = require('child_process');
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-apple-')), run = cmd => execSync(cmd, { cwd: wd, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(path.join(wd, 'inter.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
    fs.writeFileSync(path.join(wd, 'leaf.ext'), 'basicConstraints=CA:FALSE\n1.2.840.113635.100.6.11.1=DER:05:00\n');
    fs.writeFileSync(path.join(wd, 'other.ext'), 'basicConstraints=CA:FALSE\n');
    run('openssl ecparam -name secp384r1 -genkey -noout -out root.key && openssl req -new -x509 -key root.key -sha384 -days 3650 -subj "/CN=Test Root CA/O=Vdex tests" -out root.pem && openssl x509 -in root.pem -outform der -out root.der');
    run('openssl ecparam -name prime256v1 -genkey -noout -out inter.key && openssl req -new -key inter.key -subj "/CN=Test WWDR/O=Vdex tests" -out inter.csr && openssl x509 -req -in inter.csr -CA root.pem -CAkey root.key -CAcreateserial -sha384 -days 3650 -extfile inter.ext -out inter.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out leaf.key && openssl req -new -key leaf.key -subj "/CN=Test App Store/O=Vdex tests" -out leaf.csr && openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -CAcreateserial -sha256 -days 3650 -extfile leaf.ext -out leaf.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out other.key && openssl req -new -key other.key -subj "/CN=Not the App Store/O=Vdex tests" -out other.csr && openssl x509 -req -in other.csr -CA inter.pem -CAkey inter.key -CAcreateserial -sha256 -days 3650 -extfile other.ext -out other.pem');
    const der = f => Buffer.from(fs.readFileSync(path.join(wd, f), 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const bu = buf => Buffer.from(buf).toString('base64url');
    const jws = (payload, { leaf = 'leaf', chain = ['leaf.pem', 'inter.pem', 'root.pem'] } = {}) => {
      const header = bu(JSON.stringify({ alg: 'ES256', x5c: chain.map(f => der(f).toString('base64')) })), body = bu(JSON.stringify(payload));
      const sig = crypto.sign('sha256', Buffer.from(header + '.' + body), { key: fs.readFileSync(path.join(wd, leaf + '.key'), 'utf8'), dsaEncoding: 'ieee-p1363' });
      return `${header}.${body}.${bu(sig)}`;
    };
    const txn = (over = {}) => ({ transactionId: '2000000123456789', originalTransactionId: '2000000123456789', bundleId: 'app.crowmade.vdex', productId: 'app.crowmade.vdex.licence', purchaseDate: Date.parse('2026-11-05T10:00:00Z'), originalPurchaseDate: Date.parse('2026-11-05T10:00:00Z'), quantity: 1, type: 'Non-Consumable', inAppOwnershipType: 'PURCHASED', signedDate: Date.now(), environment: 'Production', transactionReason: 'PURCHASE', storefront: 'USA', price: 19990, currency: 'USD', ...over });
    const aenv = { ...env, APPLE_BUNDLE_ID: 'app.crowmade.vdex', APPLE_ROOT_CA: fs.readFileSync(path.join(wd, 'root.der')).toString('base64') };
    ok('App Store purchases are off until the app is named', (await (await get('/licence/apple/status')).json()).on === false);
    await mf2.dispose(); mf2 = new Miniflare(opts(aenv));
    const apost = async (p, body) => { const r = await post(p, body, mf2); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    ok('…and on when it is', (await (await mf2.dispatchFetch(SITE + '/licence/apple/status')).json()).on === true);
    const iphone = id(21), claimed = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' }), cb = claimed.body;
    ok('a purchase signed by the App Store becomes a licence, the phone takes a place and gets a sign-in', claimed.status === 200 && cb.ok && !!cb.token && !!cb.licence && cb.licence.seats === 3 && cb.used === 1, JSON.stringify(claimed).slice(0, 200));
    const reclaim = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' });
    ok('claiming the same purchase again (a reinstall, Restore purchases) is the same licence and the same place', reclaim.body.ok && reclaim.body.licence.ref === cb.licence.ref && reclaim.body.used === 1, JSON.stringify(reclaim).slice(0, 160));
    const ipad = await apost('/licence/apple/claim', { jws: jws(txn()), install: id(22), os: 'iPad' });
    ok('an iPad on the same Apple ID takes a second of the three places', ipad.body.ok && ipad.body.used === 2 && ipad.body.licence.ref === cb.licence.ref, JSON.stringify(ipad).slice(0, 160));
    const chk = await apost('/licence/web/check', { token: cb.token });
    ok('the sign-in works like the website’s: the daily check says licensed, with no email behind it', chk.body.ok && chk.body.licence.ref === cb.licence.ref && chk.body.licence.email === '', JSON.stringify(chk).slice(0, 160));
    const seat2 = await apost('/licence/web/activate', { token: cb.token, install: iphone, os: 'iPhone' });
    ok('…and so does the weekly check of the phone’s place', seat2.body.ok && seat2.body.used === 2, JSON.stringify(seat2).slice(0, 160));
    const refusals = [
      ['a signature that is not the App Store’s', jws(txn(), { leaf: 'other', chain: ['other.pem', 'inter.pem', 'root.pem'] })],
      ['a tampered transaction', jws(txn()).replace(/\.[^.]+$/, '.' + bu(crypto.randomBytes(64)))],
      ['another app’s purchase', jws(txn({ bundleId: 'com.example.other' }))],
      ['another product', jws(txn({ productId: 'app.crowmade.vdex.tips' }))],
      ['a sandbox purchase, unless allowed', jws(txn({ environment: 'Sandbox' }))],
      ['a revoked purchase', jws(txn({ revocationDate: Date.now(), revocationReason: 0 }))],
    ];
    for (const [what, bad] of refusals) { const r = await apost('/licence/apple/claim', { jws: bad, install: id(23), os: 'iPhone' }); ok(`refused: ${what}`, r.status === 400 || r.status === 403, String(r.status) + ' ' + JSON.stringify(r.body).slice(0, 100)); }
    const noRoot = await apost('/licence/apple/claim', { jws: jws(txn({ originalTransactionId: '2000000999' }), { chain: ['leaf.pem', 'inter.pem'] }), install: id(24), os: 'iPhone' });
    ok('a chain sent without its root still verifies against the pinned root', noRoot.status === 200, JSON.stringify(noRoot).slice(0, 160));
    // a refund through Apple cancels it; a reversed refund restores it
    const notice = (type, over = {}) => jws({ notificationType: type, subtype: '', notificationUUID: 'n-' + type, version: '2.0', signedDate: Date.now(), data: { bundleId: 'app.crowmade.vdex', environment: 'Production', signedTransactionInfo: jws(txn(over)) } });
    ok('an unsigned notice is refused', (await apost('/licence/apple/notify', { signedPayload: 'x.y.z' })).status === 400);
    const refunded = await apost('/licence/apple/notify', { signedPayload: notice('REFUND') });
    const after = await apost('/licence/web/check', { token: cb.token });
    ok('a refund notice from Apple cancels the licence: the phone’s next check says so, and the purchase cannot be claimed again', refunded.body.cancelled === 1 && after.body.error === 'cancelled' && (await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' })).status === 403, JSON.stringify([refunded, after]).slice(0, 200));
    const reversed = await apost('/licence/apple/notify', { signedPayload: notice('REFUND_REVERSED') });
    ok('a refund that Apple reverses brings it back', reversed.body.restored === 1 && (await apost('/licence/web/check', { token: cb.token })).body.ok === true);
    ok('other notices are acknowledged and ignored', (await apost('/licence/apple/notify', { signedPayload: notice('DID_RENEW') })).body.ignored === 'DID_RENEW');
    await mf2.dispose(); mf2 = new Miniflare(opts({ ...aenv, APPLE_ALLOW_SANDBOX: 'on' }));
    ok('a sandbox purchase is taken when the owner allows it (for testing)', (await apost('/licence/apple/claim', { jws: jws(txn({ environment: 'Sandbox', originalTransactionId: '1000000555' })), install: id(25), os: 'iPhone' })).status === 200);
    fs.rmSync(wd, { recursive: true, force: true });

    /* ------------------------------ the config ------------------------------ */
    const wr = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudflare/wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    const { WORKER_ROUTES } = await import(path.join(ROOT, 'tools/site-files.mjs'));
    ok('only /buy and /licence/… run the script; the rest is served as files', wr.main === 'worker.mjs' && JSON.stringify(wr.assets.run_worker_first) === JSON.stringify(['/buy', '/licence/*']) && JSON.stringify(WORKER_ROUTES) === JSON.stringify(wr.assets.run_worker_first) && wr.assets.binding === 'ASSETS');
    ok('the licence store is created by Wrangler (no ID to set up), and dashboard secrets survive a publish', JSON.stringify(wr.kv_namespaces) === JSON.stringify([{ binding: 'LICENCES' }]) && wr.keep_vars === true);
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    if (mf) await mf.dispose().catch(() => {});
    if (mf2) await mf2.dispose().catch(() => {});
  }
})();

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
        if (u.pathname === '/v1/checkout/sessions') return Response.json({ data: [...sessions.values()].filter(s => s.payment_intent === u.searchParams.get('payment_intent')) });
      }
      if (u.hostname === 'api.resend.com') return new Response(JSON.stringify({ id: 'email_1' }), { status: resendStatus });
      return new Response('unexpected', { status: 599 });
    };
    const env = { LICENCE_SHOP_KEY: codes.b64u.enc(shop.pkcs8), STRIPE_SECRET_KEY: 'rk_test_key', STRIPE_WEBHOOK_SECRET: 'whsec_testsecret', STRIPE_PAYMENT_LINK: 'plink_vdex', BUY_URL: 'https://buy.stripe.com/test_vdex', RESEND_API_KEY: 're_test', REPLY_TO: 'help@crowmade.app' };
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

    /* ----------------------------- not set up ----------------------------- */
    mf2 = new Miniflare(opts({}));
    ok('before the shop is set up, /buy says it is not on sale yet and activation says "not ready"', (await mf2.dispatchFetch(SITE + '/buy', { redirect: 'manual' })).status === 200 && (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 503);
    await mf2.dispose();
    mf2 = new Miniflare(opts({ ...env, LICENCE_SHOP_KEY: codes.b64u.enc(stranger.pkcs8) }));
    ok('a shop key that is not the one built into Vdex keeps the shop closed instead of selling codes no app accepts', (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 404);

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

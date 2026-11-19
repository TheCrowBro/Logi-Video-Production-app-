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
    { // the price with tax in the country the request comes from (js/tax.js), for the Buy buttons
      const at = async country => { const r = await mf.dispatchFetch(SITE + '/licence/price', { cf: { country } }); return { cc: r.headers.get('cache-control') || '', body: await r.json() }; };
      const gb = (await at('GB')).body, au = (await at('AU')).body, de = (await at('DE')).body, fi = (await at('FI')).body, hu = (await at('HU')).body, lu = (await at('LU')).body;
      ok('/licence/price: 24.00 USD with 20% VAT in the UK, 22.00 with 10% GST in Australia', gb.taxed && gb.taxed.total === '24.00' && gb.taxed.tax === 'VAT' && gb.taxed.rate === 20 && gb.taxed.place === 'the UK' && au.taxed && au.taxed.total === '22.00' && au.taxed.tax === 'GST' && au.taxed.rate === 10, JSON.stringify([gb, au]));
      ok('…and each EU country\'s VAT: 23.80 in Germany, 25.10 in Finland (25.5%), 25.40 in Hungary, 23.40 in Luxembourg', de.taxed.total === '23.80' && fi.taxed.total === '25.10' && fi.taxed.rate === 25.5 && hu.taxed.total === '25.40' && lu.taxed.total === '23.40', JSON.stringify([de, fi, hu, lu]));
      const us = await at('US'), odd = (await at('<b>')).body;
      ok('…the price before tax anywhere else (any tax is added at checkout), and for a country it cannot read', us.body.taxed === null && us.body.country === 'US' && us.body.price === '20.00' && us.body.currency === 'USD' && odd.taxed === null && odd.country === '', JSON.stringify([us.body, odd]));
      ok('…and no answer is kept by a cache, since each is for one country', /no-store/.test(us.cc), us.cc);
    }

    /* ---------------------------- after paying ---------------------------- */
    const sid = 'cs_test_a1B2c3D4e5F6g7H8i9J0';
    sessions.set(sid, session(sid));
    const th = await get('/licence/thanks?session_id=' + sid), html = await th.text();
    const code = (html.match(/<textarea id="code"[^>]*>([^<]+)<\/textarea>/) || [])[1];
    const v = code && (await codes.verifyCode(code, { keys: KEYS }));
    ok('the thank-you page shows a code made by the shop key, for the buyer, for 3 computers', th.status === 200 && v && v.status === 'valid' && v.licence.kid === 2 && v.licence.name === 'Pat Buyer' && v.licence.email === 'pat@example.com' && v.licence.seats === 3 && !v.licence.comp && v.licence.issued === '2026-11-02');
    ok('reloading the page shows the same code', (await (await get('/licence/thanks?session_id=' + sid)).text()).includes(code));
    { // a new payment link (a new price) beside the old one: purchases through either still get their code
      const both = new Miniflare(opts({ ...env, STRIPE_PAYMENT_LINK: 'plink_newprice, plink_vdex' }));
      const again = await (await both.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid, { redirect: 'manual' })).text();
      ok('with a second payment link added, a purchase through the first still shows the same code', again.includes(code));
      await both.dispose();
    }
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
    // Turns (the desktop app from 1.4.0): a new one at each check, so a copy of an installation shows an old one.
    const tcode = await codes.signCode(ownerKey, 1, { name: 'Tess Turn', comp: true, issued: '2026-11-02', serial: 7001 });
    const tact = (install, turn) => post('/licence/activate', { code: tcode, install, os: 'Linux', ...(turn === undefined ? {} : { turn }) }).then(async r => ({ status: r.status, ...(await r.json()) }));
    const tlist = async () => ((await (await mf.getKVNamespace('LICENCES')).get('c:1:7001', 'json')) || { computers: [] }).computers.map(c => c.id);
    const tu1 = await tact(id(90), ''), tu2 = await tact(id(90), tu1.turn), tu3 = await tact(id(90), tu1.turn);
    ok('each check gives the desktop app a new turn, and an out-of-date one (a copy that checked after the other, or an answer lost on the way) takes that install off the list', tu1.status === 200 && /^[A-Za-z0-9_-]{16}$/.test(tu1.turn || '') && tu2.status === 200 && tu2.turn !== tu1.turn && tu3.status === 409 && tu3.error === 'stale' && !(await tlist()).includes(id(90)), JSON.stringify([tu1.turn, tu2.turn, tu3]));
    const told = await tact(id(91));
    ok('an app that sends no turn (a store app, an older desktop app) is answered as before, with none', told.status === 200 && !('turn' in told) && (await tact(id(91))).status === 200 && (await tlist()).includes(id(91)));
    const tu4 = await tact(id(92), ''), tu5 = await tact(id(92));
    ok('…but once an install has been given a turn, a request without one is out of date too', tu4.status === 200 && tu5.status === 409 && tu5.error === 'stale');
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

    /* ------------------------------ disputes ------------------------------ */
    // A dispute cancels the code at once; one closed in the seller's favour brings back what that dispute cancelled, and
    // nothing that was cancelled for another reason.
    const kv = await mf.getKVNamespace('LICENCES');
    const bought = async (sidN, who) => { sessions.set(sidN, session(sidN, { payment_intent: 'pi_of' + sidN.slice(8), customer_details: { name: who, email: who.toLowerCase().replace(/\W+/g, '.') + '@example.com' } })); const c = (await (await get('/licence/thanks?session_id=' + sidN)).text()).match(/<textarea id="code"[^>]*>([^<]+)</)[1]; return { code: c, ref: (await codes.verifyCode(c, { keys: KEYS })).licence.ref, pi: sessions.get(sidN).payment_intent }; };
    const dispute = (type, o) => signed({ type, data: { object: { object: 'dispute', ...o } } }).then(r => r.json());
    const works = async (c, n) => (await post('/licence/activate', { code: c, install: id(n) })).status;
    const d1 = await bought('cs_test_disputeOne00000000001', 'Dee Spute');
    ok('a code works before its payment is disputed', (await works(d1.code, 40)) === 200);
    const opened = await dispute('charge.dispute.created', { id: 'dp_test000000000001', status: 'needs_response', payment_intent: d1.pi });
    ok('a dispute cancels the code bought with that payment, and notes which dispute did it', opened.cancelled === 1 && (await works(d1.code, 40)) === 403 && (await kv.get('x:' + d1.ref, 'json')).why === 'dispute' && (await kv.get('x:' + d1.ref, 'json')).dispute === 'dp_test000000000001');
    const other = await dispute('charge.dispute.closed', { id: 'dp_test000000000099', status: 'won', payment_intent: d1.pi });
    ok('another dispute on the same payment being won does not bring it back', other.restored === 0 && (await works(d1.code, 40)) === 403);
    const won = await dispute('charge.dispute.closed', { id: 'dp_test000000000001', status: 'won', payment_intent: d1.pi });
    ok('the dispute being closed in the seller\'s favour brings the code back: the same computer is on it again', won.restored === 1 && (await works(d1.code, 40)) === 200 && (await kv.get('x:' + d1.ref)) === null);
    ok('telling the server twice changes nothing more', (await dispute('charge.dispute.closed', { id: 'dp_test000000000001', status: 'won', payment_intent: d1.pi })).restored === 0 && (await works(d1.code, 40)) === 200);
    await dispute('charge.dispute.created', { id: 'dp_test000000000002', status: 'warning_needs_response', payment_intent: d1.pi });
    const dropped = await dispute('charge.dispute.closed', { id: 'dp_test000000000002', status: 'warning_closed', payment_intent: d1.pi });
    ok('an inquiry the bank drops counts as in the seller\'s favour too', dropped.restored === 1 && (await works(d1.code, 40)) === 200);
    // Each payment's disputes are remembered, so the order Stripe's events arrive in changes nothing.
    const dL = await bought('cs_test_disputeLost0000000001', 'Lou Lost');
    await dispute('charge.dispute.created', { id: 'dp_test00000000000A', status: 'needs_response', payment_intent: dL.pi });
    await dispute('charge.dispute.created', { id: 'dp_test00000000000B', status: 'needs_response', payment_intent: dL.pi });
    const lost = await dispute('charge.dispute.closed', { id: 'dp_test00000000000A', status: 'lost', payment_intent: dL.pi });
    ok('a dispute that is lost leaves the code cancelled', lost.ok === true && (await works(dL.code, 46)) === 403);
    const wonAfterLost = await dispute('charge.dispute.closed', { id: 'dp_test00000000000B', status: 'won', payment_intent: dL.pi });
    ok('…and another dispute on that payment being won afterwards does not bring it back', wonAfterLost.restored === 0 && (await works(dL.code, 46)) === 403 && (await kv.get('x:' + dL.ref, 'json')).why === 'dispute');
    const dW = await bought('cs_test_disputeWarn0000000001', 'Wen Early');
    const early = await dispute('charge.dispute.closed', { id: 'dp_test00000000000C', status: 'warning_closed', payment_intent: dW.pi });
    const late = await dispute('charge.dispute.created', { id: 'dp_test00000000000C', status: 'warning_needs_response', payment_intent: dW.pi });
    ok('a dispute already closed in the seller\'s favour is not reopened by its "created" event arriving late', early.restored === 0 && late.cancelled === 0 && (await works(dW.code, 47)) === 200 && (await kv.get('x:' + dW.ref)) === null);
    const dT = await bought('cs_test_disputeTwoOpen00000001', 'Tia Twice');
    await dispute('charge.dispute.created', { id: 'dp_test00000000000D', status: 'needs_response', payment_intent: dT.pi });
    await dispute('charge.dispute.created', { id: 'dp_test00000000000E', status: 'needs_response', payment_intent: dT.pi });
    const firstWon = await dispute('charge.dispute.closed', { id: 'dp_test00000000000D', status: 'won', payment_intent: dT.pi });
    const bothWon = await dispute('charge.dispute.closed', { id: 'dp_test00000000000E', status: 'won', payment_intent: dT.pi });
    ok('with two disputes open, the code comes back only once both are closed in the seller\'s favour', firstWon.restored === 0 && bothWon.restored === 1 && (await works(dT.code, 48)) === 200);
    const dN = await bought('cs_test_disputeNoCreate000001', 'Nia Missed');
    const lostOnly = await dispute('charge.dispute.closed', { id: 'dp_test00000000000F', status: 'lost', payment_intent: dN.pi });
    ok('a lost dispute whose "created" event never came cancels the code', lostOnly.cancelled === 1 && (await works(dN.code, 49)) === 403);
    // Cancelled for another reason: that reason stands, whatever the dispute's end.
    const d2 = await bought('cs_test_disputeTwo00000000001', 'Owen Cancelled');
    await dispute('charge.dispute.created', { id: 'dp_test000000000003', status: 'needs_response', payment_intent: d2.pi });
    await adm('cancel', d2.ref);
    const afterOwner = await dispute('charge.dispute.closed', { id: 'dp_test000000000003', status: 'won', payment_intent: d2.pi });
    ok('a code the owner cancelled while it was disputed stays cancelled when the dispute is won', afterOwner.restored === 0 && (await works(d2.code, 41)) === 403 && (await kv.get('x:' + d2.ref, 'json')).why === 'owner');
    const d3 = await bought('cs_test_disputeThree000000001', 'Rae Funded');
    await signed({ type: 'charge.refunded', data: { object: { refunded: true, payment_intent: d3.pi } } });
    const onRefunded = await dispute('charge.dispute.created', { id: 'dp_test000000000004', status: 'needs_response', payment_intent: d3.pi });
    const afterRefund = await dispute('charge.dispute.closed', { id: 'dp_test000000000004', status: 'won', payment_intent: d3.pi });
    ok('a code refunded before the dispute stays cancelled as a refund, and the dispute\'s end does not bring it back', onRefunded.cancelled === 0 && afterRefund.restored === 0 && (await works(d3.code, 42)) === 403 && (await kv.get('x:' + d3.ref, 'json')).why === 'refund');
    const d4 = await bought('cs_test_disputeFour00000000001', 'Lee Later');
    await dispute('charge.dispute.created', { id: 'dp_test000000000005', status: 'needs_response', payment_intent: d4.pi });
    await signed({ type: 'charge.refunded', data: { object: { refunded: true, payment_intent: d4.pi } } });
    ok('…and so does one refunded while the dispute was open', (await dispute('charge.dispute.closed', { id: 'dp_test000000000005', status: 'won', payment_intent: d4.pi })).restored === 0 && (await works(d4.code, 43)) === 403);
    const d5 = await bought('cs_test_disputeFive00000000001', 'Old Record');
    await kv.put('x:' + d5.ref, JSON.stringify({ why: 'dispute', at: Date.now() - 5 * 86400e3 })); // as written before disputes were told apart
    ok('a dispute cancellation recorded before this version is undone by its dispute being won', (await dispute('charge.dispute.closed', { id: 'dp_test000000000006', status: 'won', payment_intent: d5.pi })).restored === 1 && (await works(d5.code, 44)) === 200);
    const d6 = await bought('cs_test_disputeSix000000000001', 'Nan Nameless');
    await dispute('charge.dispute.created', { id: 'dp_test000000000007', status: 'needs_response', payment_intent: d6.pi });
    const nameless = await dispute('charge.dispute.closed', { status: 'won', payment_intent: d6.pi }), odd = await dispute('charge.dispute.closed', { id: 'ch_test000000000007', status: 'won', payment_intent: d6.pi });
    ok('the end of a dispute that does not say which dispute it was restores nothing', nameless.ignored === 'no-dispute' && odd.ignored === 'no-dispute' && (await works(d6.code, 45)) === 403);
    ok('…until the dispute itself is closed in the seller\'s favour', (await dispute('charge.dispute.closed', { id: 'dp_test000000000007', status: 'won', payment_intent: d6.pi })).restored === 1 && (await works(d6.code, 45)) === 200);
    ok('a dispute event that is not signed by Stripe restores nothing',(await signed({ type: 'charge.dispute.closed', data: { object: { id: 'dp_test000000000003', status: 'won', payment_intent: d2.pi } } }, undefined, 'whsec_wrong')).status === 400 && (await works(d2.code, 41)) === 403);

    /* --------------------- the desktop app, end to end --------------------- */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-e2e-'));
    const lic = createLicence({ dir, keys: KEYS, site: SITE, post: async (url, body) => { const r = await mf.dispatchFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; } });
    await lic.state();
    const free = await codes.signCode(ownerKey, 1, { name: 'Riley Free', comp: true, issued: '2026-11-02' });
    const e2e = await lic.enter(free);
    ok('the desktop app activates a free code against the real Worker', e2e.mode === 'licensed' && e2e.licence.comp && e2e.licence.name === 'Riley Free');
    ok('and releases it', (await lic.release()).mode === 'trial');
    fs.rmSync(dir, { recursive: true, force: true });
    { // A copy of an installation (licence.json and the window-state file copied to other computers) needs a place of its own.
      const DAY = 86400e3, clock = { t: Date.now() }, lose = { next: false };
      const viaWorker = async (url, body) => { const r = await mf.dispatchFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const out = { status: r.status, body: await r.json().catch(() => ({})) }; if (lose.next) { lose.next = false; throw new Error('the answer was lost'); } return out; };
      const machine = d => createLicence({ dir: d, keys: KEYS, site: SITE, now: () => clock.t, post: viaWorker });
      const dirs = [0, 1, 2, 3].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-copy-')));
      const copyCode = await codes.signCode(ownerKey, 1, { name: 'Cody Copied', comp: true, issued: '2026-11-02', serial: 7002 });
      const pcs = dirs.map(machine);
      await pcs[0].state(); const first = await pcs[0].enter(copyCode);
      for (const d of dirs.slice(1)) fs.copyFileSync(path.join(dirs[0], 'licence.json'), path.join(d, 'licence.json'));
      let modes = [];
      for (let round = 0; round < 2; round++) { clock.t += 8 * DAY; modes = []; for (const pc of pcs) modes.push((await pc.recheck()).mode); }
      const ids = dirs.map(d => JSON.parse(fs.readFileSync(path.join(d, 'licence.json'), 'utf8')).install);
      const placed = (await (await mf.getKVNamespace('LICENCES')).get('c:1:7002', 'json')).computers;
      ok('copies of an activated installation each need a place of their own: within two weekly checks each has its own ID, three hold the licence\'s 3 places, and the fourth is not licensed', first.mode === 'licensed' && modes.filter(x => x === 'licensed').length === 3 && modes.filter(x => x === 'released').length === 1 && new Set(ids).size === 4 && placed.length === 3, `${modes.join()} · ${placed.length} places`);
      const keeper = pcs[modes.indexOf('licensed')];
      lose.next = true; clock.t += 8 * DAY; await keeper.recheck();
      clock.t += 8 * DAY; const afterLost = await keeper.recheck();
      const placed2 = (await (await mf.getKVNamespace('LICENCES')).get('c:1:7002', 'json')).computers;
      ok('…while a computer whose answer was lost on the way gets its own place back at its next check, as a move that is not counted', afterLost.mode === 'licensed' && placed2.length === 3 && (await adm('look', '1:7002')).swaps === 0, `${afterLost.mode} · ${placed2.length}`);
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    }
    { // The desktop app's checks against the real Worker, through what can go wrong on the way. plan: what happens to
      // each request in turn ('ok'; 'lose': the answer is lost; 'down': never sent; a number: answered that many ms late).
      const DAY = 86400e3, HOUR = 3600e3, clock = { t: Date.now() }, made = [];
      const worker = async (url, body) => { const r = await mf.dispatchFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
      const rig = (d, { ahead = 0, post } = {}) => {
        const p = { plan: [], sent: 0 };
        p.lic = createLicence({ dir: d, keys: KEYS, site: SITE, now: () => clock.t + ahead, post: post || (async (url, body) => {
          const step = p.plan.shift() || 'ok'; if (step === 'down') throw new Error('offline');
          p.sent++; const out = await worker(url, body);
          if (typeof step === 'number') await new Promise(r => setTimeout(r, step));
          if (step === 'lose') throw new Error('the answer was lost'); return out;
        }) });
        return p;
      };
      const folder = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-check-')); made.push(d); return d; };
      const places = async ref => (((await (await mf.getKVNamespace('LICENCES')).get('c:' + ref, 'json')) || {}).computers || []).length;
      // Activated after its trial: what follows is the licence alone.
      const activated = async (serial, opts) => { const d = folder(), pc = rig(d, opts); await pc.lic.state(); clock.t += 31 * DAY; const s = await pc.lic.enter(await codes.signCode(ownerKey, 1, { name: 'Dee Esk', comp: true, issued: '2026-11-02', serial })); return { d, pc, s }; };

      // licence.json cannot be replaced (a full disk) while Vdex stays open over its weekly check, and after a restart.
      const full = await activated(7101), tmp = path.join(full.d, 'licence.json.tmp'), hours = [];
      fs.mkdirSync(tmp); clock.t += 8 * DAY;
      for (let h = 0; h < 8; h++) { hours.push((await full.pc.lic.recheck()).mode + ':' + (await places('1:7101'))); clock.t += HOUR; }
      const restart = rig(full.d); hours.push((await restart.lic.recheck()).mode + ':' + (await places('1:7101')));
      fs.rmdirSync(tmp); clock.t += 2 * HOUR;
      const freed = await restart.lic.recheck(), second = await activated(7101);
      ok('a computer whose licence.json cannot be written (a full disk) over its weekly check stays licensed and takes no more places, hour after hour and after a restart; once it can be written it checks as before, and the licence\'s other places are still free', full.s.mode === 'licensed' && hours.every(x => x === 'licensed:1') && freed.mode === 'licensed' && second.s.mode === 'licensed' && (await places('1:7101')) === 2, hours.join(' ') + ` · ${freed.mode} · ${second.s.mode}`);

      // A weekly check's answer lost, then the next check answered "stale" and asking again under a new ID failing.
      const lost = await activated(7102);
      lost.pc.plan = ['lose']; clock.t += 8 * DAY; const l1 = await lost.pc.lic.recheck();
      lost.pc.plan = ['ok', 'down']; clock.t += 2 * HOUR; const l2 = await lost.pc.lic.recheck();
      clock.t += 30 * 60e3; const l3 = await lost.pc.lic.state();
      clock.t += 2 * HOUR; const l4 = await lost.pc.lic.recheck();
      ok('a computer whose weekly answer was lost, and which then could not ask again under a new ID, stays licensed throughout, and is back on the list at its next check as a move that is not counted', [l1, l2, l3, l4].every(x => x.mode === 'licensed' && x.canEdit) && (await places('1:7102')) === 1 && (await adm('look', '1:7102')).swaps === 0, [l1, l2, l3, l4].map(x => x.mode).join());

      // The background check and Try again at the same moment, the first answer coming late.
      const both = await activated(7103);
      both.pc.plan = [300]; clock.t += 8 * DAY;
      const [b1, b2] = await Promise.all([both.pc.lic.recheck(false), both.pc.lic.recheck(true)]), b3 = await both.pc.lic.state();
      ok('a background check and Try again at the same moment both end licensed, with one place on the list', b1.mode === 'licensed' && b2.mode === 'licensed' && b3.mode === 'licensed' && (await places('1:7103')) === 1, `${b1.mode} ${b2.mode} ${b3.mode}`);

      // The check answered from elsewhere with the receipt already in licence.json, played back: no check that got through.
      const played = await activated(7104), kept = JSON.parse(fs.readFileSync(path.join(played.d, 'licence.json'), 'utf8')).act.receipt, from = clock.t;
      const replay = rig(played.d, { post: async () => ({ status: 200, body: { ok: true, receipt: kept, turn: 'played-back-turn-0001' } }) }), replayed = [];
      for (const d of [60, 100, 200]) { clock.t = from + d * DAY; replayed.push((await replay.lic.recheck()).mode); }
      ok('a computer whose check is answered from elsewhere with the receipt it already has is licensed on day 60 and read-only on days 100 and 200, as with the check blocked', replayed.join() === 'licensed,offline,offline', replayed.join());

      // A computer whose clock is a year ahead.
      const fast = await activated(7105, { ahead: 365 * DAY });
      fast.pc.plan = ['down']; clock.t += 2 * HOUR; const f1 = await fast.pc.lic.recheck(true);
      const sent = fast.pc.sent; clock.t += 2 * HOUR; await fast.pc.lic.recheck();
      ok('a computer whose clock is a year ahead stays licensed when a check two hours after a good one fails, and is not asked to check again every hour', fast.s.mode === 'licensed' && f1.mode === 'licensed' && fast.pc.sent === sent, `${fast.s.mode} ${f1.mode} ${fast.pc.sent - sent}`);

      // Read-only after 90 days without a check, quit, and reopened with a connection 20 minutes after its last try.
      const away = await activated(7106);
      away.pc.plan = ['down']; clock.t += 95 * DAY; const o1 = await away.pc.lic.recheck();
      clock.t += 20 * 60e3; const back = rig(away.d), o2 = await back.lic.state(), o3 = await back.lic.recheck(false);
      ok('a computer read-only after 90 days without a check, reopened with a connection within the hour, is licensed again at the check made when it starts', o1.mode === 'offline' && o2.mode === 'offline' && o3.mode === 'licensed', `${o1.mode} ${o2.mode} ${o3.mode}`);
      for (const d of made) fs.rmSync(d, { recursive: true, force: true });
    }

    /* --------------------------- website sign-in --------------------------- */
    const mails = () => calls.filter(c => c.url === 'https://api.resend.com/emails').map(c => JSON.parse(c.body));
    const lastCode = to => { const m = mails().filter(x => x.to[0] === to).at(-1); return m && (m.subject.match(/^(\d{6}) is your Vdex sign-in code$/) || [])[1]; };
    const web = (path, body, m = mf) => post('/licence/web/' + path, body, m).then(async r => ({ status: r.status, ...(await r.json()) }));
    const onAnswer = await (await get('/licence/web/status')).json();
    ok('the website is told sign-in is on once the owner switches it on, with no note (on needs none)', onAnswer.on === true && !('note' in onAnswer), JSON.stringify(onAnswer));
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

    /* ------------------------ the store reviewers ------------------------ */
    // One address signs in with a code that does not change (REVIEW_EMAIL and REVIEW_CODE, made up here for each run).
    {
      const REVIEW = 'store-review@example.com', fixed = String(crypto.randomInt(100000, 1000000)), wrongs = n => Array.from({ length: n }, (_, i) => String((Number(fixed) - 100000 + 7919 * (i + 1)) % 900000 + 100000));
      const renv = { ...env, REVIEW_EMAIL: ' Store-Review@Example.com ', REVIEW_CODE: fixed };
      const utc = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
      const reviewCode = await codes.signCode(ownerKey, 1, { name: 'Store review', email: REVIEW, comp: true, issued: '2026-11-02', expires: '2099-12-31', seats: 10, serial: 4001 });
      const licensed = async m => (await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'link', ref: '1:4001', code: reviewCode, at: Date.now() }), m)).status;
      const startOf = async (email, m) => { const t0 = Date.now(), r = await post('/licence/web/start', { email }, m); return { status: r.status, body: await r.text(), type: r.headers.get('content-type'), ms: Date.now() - t0 }; };
      const fresh = async (bindings = renv, seed = null) => { const m = new Miniflare(opts(bindings)); if (seed) { const k = await m.getKVNamespace('LICENCES'); for (const [key, val] of Object.entries(seed)) await k.put(key, val); } return m; };
      let m = await fresh();
      try {
        const rkv = await m.getKVNamespace('LICENCES');
        await rkv.put('e:pat@example.com', JSON.stringify({ licences: [{ ref: v.licence.ref, seats: 3 }] }));
        const before = await web('verify', { email: REVIEW, code: fixed }, m);
        ok('the review address needs a licence like any other: without one, even the right code signs nobody in', before.status === 403 && before.error === 'no-licence');
        ok('the owner gives it a free licence with an end date', (await licensed(m)) === 200);
        calls.length = 0;
        const rs = await startOf(REVIEW, m), ns = await startOf('nobody@example.com', m), ps = await startOf('pat@example.com', m);
        ok('asking for a code for the review address is answered exactly as for any other address', rs.status === 200 && rs.body === ns.body && rs.body === ps.body && rs.status === ns.status && rs.status === ps.status && rs.type === ns.type && rs.body === '{"ok":true}', JSON.stringify([rs, ns, ps]));
        ok('…after about the time an email takes to hand over, so the wait does not single it out either', rs.ms >= 240 && rs.ms < 5000, `${rs.ms} ms`);
        ok('…sends no email to it (the licensed address beside it got one), and stores nothing about it', !mails().some(x => x.to.includes(REVIEW)) && mails().some(x => x.to[0] === 'pat@example.com') && (await rkv.get('w:' + REVIEW)) === null && !calls.some(c => c.url.includes('resend') && c.body.includes(REVIEW)));
        // Wrong tries are counted for each requester (the address Cloudflare gives in CF-Connecting-IP; an IPv6 /64 block
        // counts as one) and for everyone together. These requesters' addresses are from the ranges kept for examples.
        const from = (ip, code, mm = m) => mm.dispatchFetch(SITE + '/licence/web/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ email: REVIEW, code }) }).then(async r => ({ status: r.status, ...(await r.json()) }));
        const tagOf = (ip, d = utc()) => 'rv:' + d + ':' + crypto.createHash('sha256').update(`vdex-review|${env.LICENCE_SHOP_KEY}|${d}|${ip}`).digest('hex').slice(0, 24);
        const ipA = '198.51.100.7', ipB = '203.0.113.9', ipC = '192.0.2.10', ipD = '192.0.2.11';
        const wrongOne = await from(ipA, wrongs(1)[0]), wrongAny = await web('verify', { email: 'nobody@example.com', code: '000000' }, m);
        ok('a wrong code for it is refused with the answer anyone gets', wrongOne.status === 400 && JSON.stringify(wrongOne) === JSON.stringify(wrongAny));
        const rin = await from(ipA, fixed), rtok = rin.token && (await codes.readNote('web', rin.token, { keys: KEYS, signers: [2] }));
        ok('the fixed code signs in: a token for the review address and its licence, which shows its end date', rin.status === 200 && rtok && rtok.email === REVIEW && rtok.ref === '1:4001' && rin.licence.comp === true && rin.licence.expires === '2099-12-31' && rin.licence.seats === 10, JSON.stringify(rin).slice(0, 200));
        ok('…the sign-in works like any other (the daily check, a phone\'s place on the licence)', (await web('check', { token: rin.token }, m)).ok === true && (await web('activate', { token: rin.token, install: 'install-review-00000001', os: 'Android' }, m)).ok === true);
        const again2 = await web('verify', { email: ' STORE-review@example.com', code: `${fixed.slice(0, 3)} ${fixed.slice(3)}` }, m);
        ok('the code does not change: it signs in again, typed with a space and the address in capitals', again2.status === 200 && !!again2.token);
        // A reviewer who tries Delete my licence records (Apple's do) must not lock the next reviewer out.
        const rdel = await web('forget', { token: again2.token }, m);
        const rseats = (await (await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'look', ref: '1:4001', at: Date.now() }), m)).json()).computers;
        ok('a reviewer pressing Delete my licence records is signed out and the devices\' details are deleted, like anyone (their places stay held)', rdel.ok === true && rseats.length === 1 && rseats.every(c => !c.os && !c.added && !c.seen) && (await web('check', { token: again2.token }, m)).status === 401 && (await web('check', { token: rin.token }, m)).status === 401);
        const rback = await from(ipA, fixed);
        ok('…and the review address can still sign in afterwards: its licence stays linked', rback.status === 200 && (await web('check', { token: rback.token }, m)).ok === true);
        // Guessing from one address: 5 wrong tries a day, whatever a sign-in code's own counter would do.
        for (const w of wrongs(4).slice(1)) await from(ipA, w); // 4 wrong from A so far, with the one above
        ok('after 4 wrong tries from one requester the right code still signs in from there', (await from(ipA, fixed)).status === 200 && (await rkv.get(tagOf(ipA))) === '4' && (await rkv.get('rv:' + utc())) === '4');
        await from(ipA, wrongs(5)[4]);
        const locked = await from(ipA, fixed);
        ok('after its 5th wrong try that requester is refused, the right code included, with the same answer as a wrong code', locked.status === 400 && JSON.stringify(locked) === JSON.stringify(wrongAny) && (await rkv.get(tagOf(ipA))) === '5');
        ok('…while a reviewer anywhere else still signs in: one connection alone cannot lock the reviewers out', (await from(ipB, fixed)).status === 200);
        for (const w of wrongs(30).slice(5)) await from(ipA, w);
        ok('…and that requester\'s further tries are refused unlooked-at and not counted for everyone, so it cannot use up the day\'s 20', (await rkv.get('rv:' + utc())) === '5' && (await rkv.get(tagOf(ipA))) === '5' && (await from(ipB, fixed)).status === 200);
        await startOf(REVIEW, m);
        ok('asking for a new code does not reset the count (a sign-in code\'s own 5 tries start afresh with each code; these do not)', (await from(ipA, fixed)).status === 400);
        // An IPv6 network counts as one requester: its /64 block, however the address is written.
        for (const w of wrongs(33).slice(30)) await from('2001:db8:1:2::1', w);
        for (const w of wrongs(35).slice(33)) await from('2001:DB8:1:2:aaaa:bbbb:cccc:dddd', w);
        ok('addresses in one IPv6 /64 block share one count: 5 wrong tries from two of them close it to a third', (await from('2001:0db8:0001:0002::ffff', fixed)).status === 400 && (await from('2001:db8:1:3::1', fixed)).status === 200, (await rkv.get('rv:' + utc())) + ' in all');
        // Guessing from many addresses: 20 wrong tries a day in all, and then nobody, the right code included.
        for (const w of wrongs(40).slice(35)) await from(ipC, w);
        ok('after 15 wrong tries in all, from three requesters, the reviewers still sign in', (await rkv.get('rv:' + utc())) === '15' && (await from(ipB, fixed)).status === 200);
        for (const w of wrongs(45).slice(40)) await from(ipD, w);
        const shut = await from(ipB, fixed), shutNew = await from('192.0.2.200', fixed);
        ok('after 20 in all (four requesters\' worth) the address is refused for everyone until the next day, the right code included', (await rkv.get('rv:' + utc())) === '20' && shut.status === 400 && JSON.stringify(shut) === JSON.stringify(wrongAny) && shutNew.status === 400);
        const stored = (await rkv.list({ prefix: 'rv:' })).keys.map(k => k.name);
        ok('what is stored names no requester: a tag scrambled with the shop key and the day, kept for two days', stored.length === 5 && stored.every(k => /^rv:\d{4}-\d\d-\d\d(:[0-9a-f]{24})?$/.test(k)) && !stored.some(k => /198\.51|203\.0|192\.0|2001/.test(k)) && (await rkv.list({ prefix: 'rv:' })).keys.every(k => k.expiration && k.expiration * 1000 - Date.now() <= 2 * 86400e3 + 60e3), stored.join(' '));
        ok('no email was sent to the review address through any of this', !mails().some(x => x.to.includes(REVIEW)));
        await m.dispose();
        // The counts are kept in storage by the day: they outlive this copy of the script, and end with the day.
        m = await fresh(renv, { [tagOf(ipA)]: '5', ['rv:' + utc()]: '5' }); await licensed(m);
        ok('a fresh copy of the script still refuses that requester for the rest of the day, and only it', (await from(ipA, fixed)).status === 400 && (await from(ipB, fixed)).status === 200);
        await m.dispose();
        m = await fresh(renv, { ['rv:' + utc()]: '20' }); await licensed(m);
        ok('…and still refuses everyone once the day\'s 20 are used', (await from(ipB, fixed)).status === 400);
        await m.dispose();
        const y = utc(Date.now() - 86400e3);
        m = await fresh(renv, { ['rv:' + y]: '20', [tagOf(ipA, y)]: '5' }); await licensed(m);
        ok('the next day it signs in again', (await from(ipA, fixed)).status === 200);
        await m.dispose();
        // Many tries at once must not each get a look before the counts catch up.
        m = await fresh(); await licensed(m);
        const burst = await Promise.all(wrongs(40).map(w => from(ipA, w)));
        ok('40 wrong tries sent at once from one requester are all refused and count as its 5; the reviewers still sign in elsewhere', burst.every(r => r.status === 400 && r.error === 'wrong-code') && (await from(ipA, fixed)).status === 400 && (await (await m.getKVNamespace('LICENCES')).get('rv:' + utc())) === '5' && (await from(ipB, fixed)).status === 200, (await (await m.getKVNamespace('LICENCES')).get('rv:' + utc())) + ' stored');
        await m.dispose();
        m = await fresh(); await licensed(m);
        const crowd = await Promise.all(wrongs(60).map((w, i) => from(`198.51.100.${100 + (i % 30)}`, w)));
        ok('60 wrong tries sent at once from 30 requesters are all refused, and no more than 20 of them are counted', crowd.every(r => r.status === 400) && (await (await m.getKVNamespace('LICENCES')).get('rv:' + utc())) === '20' && (await from(ipB, fixed)).status === 400, (await (await m.getKVNamespace('LICENCES')).get('rv:' + utc())) + ' stored');
        await m.dispose();
        // With either setting missing, or a code that could not be typed, there is no such address.
        for (const [what, bindings] of [['the code is not set', { ...env, REVIEW_EMAIL: REVIEW }], ['the code is not 6 digits', { ...renv, REVIEW_CODE: fixed + '1' }], ['the address is not set', { ...env, REVIEW_CODE: fixed }]]) {
          m = await fresh(bindings); await licensed(m);
          calls.length = 0;
          await startOf(REVIEW, m);
          const real = lastCode(REVIEW), tryFixed = await web('verify', { email: REVIEW, code: fixed === real ? wrongs(1)[0] : fixed }, m);
          ok(`when ${what}, the address is like any other: it is emailed a code, and the fixed code signs nobody in`, /^\d{6}$/.test(real || '') && tryFixed.status === 400 && (await web('verify', { email: REVIEW, code: real }, m)).status === 200, JSON.stringify(tryFixed));
          await m.dispose();
        }
        m = null;
      } finally { if (m) await m.dispose().catch(() => {}); }
    }

    /* -------------------- deleting for a named address -------------------- */
    // The owner's way to do what Delete my licence records does, for an email address: behind FORGET_SECRET.
    {
      const secret = crypto.randomBytes(24).toString('base64url'), ADDR = 'forget.me@example.com';
      const forget = async (body, m, init = {}) => { const r = await m.dispatchFetch(SITE + '/licence/owner/forget', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: JSON.stringify(body), ...init }); return { status: r.status, cors: r.headers.get('access-control-allow-origin'), text: await r.text() }; };
      const unknown = await mf.dispatchFetch(SITE + '/licence/no-such-address', { method: 'POST', body: '{}' }), absent = await forget({ email: ADDR, secret }, mf);
      const pre0 = await mf.dispatchFetch(SITE + '/licence/owner/forget', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST' } });
      ok('until the owner sets the secret, the operation does not exist: its address answers like any unknown one', absent.status === 404 && absent.text === (await unknown.text()) && unknown.status === 404 && pre0.status === 404);
      let m = new Miniflare(opts({ ...env, FORGET_SECRET: secret.slice(0, 19) }));
      try {
        ok('a secret shorter than 20 characters does not switch it on', (await forget({ email: ADDR, secret: secret.slice(0, 19) }, m)).status === 404);
        await m.dispose(); m = new Miniflare(opts({ ...env, FORGET_SECRET: secret }));
        const fkv = await m.getKVNamespace('LICENCES'), fadm = async (op, ref, extra = {}) => (await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op, ref, at: Date.now(), ...extra }), m)).json();
        const fcode = await codes.signCode(ownerKey, 1, { name: 'Forget Me', email: ADDR, comp: true, issued: '2026-11-02', serial: 5001 });
        const fcode2 = await codes.signCode(ownerKey, 1, { name: 'Forget Me', email: ADDR, comp: true, issued: '2026-11-02', serial: 5002 });
        for (const n of [1, 2, 3, 4]) { const r = await post('/licence/activate', { code: fcode, install: id(60 + n), os: 'Windows' }, m); if (n === 4) await post('/licence/activate', { code: fcode, install: id(64), os: 'Windows', release: (await r.json()).computers[0].tag }, m); } // 3 computers, and one move
        await post('/licence/activate', { code: fcode2, install: id(70), os: 'Mac' }, m);
        await fadm('cancel', '1:5002');
        calls.length = 0;
        await web('start', { email: ADDR }, m);
        const fin = await web('verify', { email: ADDR, code: lastCode(ADDR) }, m);
        await web('start', { email: ADDR }, m); // a sign-in code waiting to be used
        const held = async () => ({ e: await fkv.get('e:' + ADDR, 'json'), w: await fkv.get('w:' + ADDR, 'json'), c: await fkv.get('c:1:5001', 'json'), c2: await fkv.get('c:1:5002', 'json'), x2: await fkv.get('x:1:5002', 'json') });
        const h0 = await held();
        ok('(an address with two licences, four devices, a sign-in and a waiting code is held)', fin.status === 200 && h0.e.licences.length === 2 && !!h0.w.h && h0.c.computers.length === 3 && h0.c.swaps.length === 1 && h0.c2.computers.length === 1 && h0.x2.why === 'owner');
        // Without the secret: one answer, whatever the address, and nothing happens.
        const tries = [];
        for (const sec of [undefined, '', 'x', secret.slice(0, -1), secret + 'x', secret.toUpperCase(), 12345, null, { a: 1 }]) for (const email of [ADDR, 'nobody.at.all@example.com', 'not an address']) tries.push(await forget({ email, ...(sec === undefined ? {} : { secret: sec }) }, m));
        tries.push(await forget({ email: ADDR, token: fin.token }, m)); // a sign-in is not the secret
        tries.push(await m.dispatchFetch(SITE + '/licence/owner/forget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' }).then(async r => ({ status: r.status, text: await r.text() })));
        const h1 = await held();
        ok('without the right secret every request gets the same refusal, for an address that is held, one that is not, and one that is no address', tries.every(t => t.status === 403 && t.text === '{"error":"refused"}'), JSON.stringify(tries.find(t => t.status !== 403 || t.text !== '{"error":"refused"}') || ''));
        ok('…and nothing is deleted', JSON.stringify(h1) === JSON.stringify(h0) && (await web('check', { token: fin.token }, m)).ok === true);
        const preF = await m.dispatchFetch(SITE + '/licence/owner/forget', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
        ok('the generator page (a file on the owner\'s computer) may ask: the browser\'s pre-check is answered, and other methods are not served', preF.status === 204 && /POST/.test(preF.headers.get('access-control-allow-methods')) && (await m.dispatchFetch(SITE + '/licence/owner/forget')).status === 405);
        ok('with the secret, something that is not an email address is said to be one', (await forget({ email: 'not an address', secret }, m)).text === '{"error":"invalid-email"}');
        const gone = await forget({ email: '  Forget.Me@Example.com ', secret: ` ${secret} ` }, m), h2 = await held();
        ok('with the secret, the address\'s records are deleted, and the answer says how much there was', gone.status === 200 && gone.cors === '*' && gone.text === JSON.stringify({ ok: true, licences: 2, devices: 4 }), gone.text);
        ok('…what the in-app Delete removes: the address\'s links to its licences, its sign-in code, and everything about the devices on those licences but a scrambled tag that holds each one\'s place', h2.e === null && h2.w === null && h2.c.computers.length === 3 && h2.c2.computers.length === 1 && [...h2.c.computers, ...h2.c2.computers].every(c => Object.keys(c).sort().join() === 'gone,tag' && /^[A-Za-z0-9_-]{12}$/.test(c.tag)), JSON.stringify(h2));
        ok('…and what it keeps: a cancellation, and the count of recent moves', h2.x2.why === 'owner' && h2.c.swaps.length === 1);
        ok('…every sign-in made before it stops working', (await web('check', { token: fin.token }, m)).status === 401);
        ok('nothing in storage names the address any more', !(await fkv.list()).keys.some(k => k.name.includes(ADDR)) && !JSON.stringify(await Promise.all((await fkv.list()).keys.map(k => fkv.get(k.name)))).includes(ADDR));
        const none = await forget({ email: 'nobody.at.all@example.com', secret }, m);
        ok('an address nothing is held for is answered the same way, with nothing found', none.status === 200 && none.text === JSON.stringify({ ok: true, licences: 0, devices: 0 }));
        // A deletion frees no place: another computer still finds the licence full (and moving it is counted).
        const fourth = await post('/licence/activate', { code: fcode, install: id(65), os: 'Windows' }, m);
        ok('deleting the records frees none of the licence\'s places: a new computer is told it is full', fourth.status === 409 && (await fourth.json()).computers.length === 3);
        // What the deletion page warns of: a computer that still has the code puts itself, and the address, back.
        const backOn = await post('/licence/activate', { code: fcode, install: id(62), os: 'Windows' }, m), h3 = await held();
        ok('a computer that still has the code puts itself and the address back at its next check, in its own kept place (so: Release this computer first)', backOn.status === 200 && h3.c.computers.length === 3 && h3.c.computers.filter(c => c.id).length === 1 && h3.e.licences.length === 1);
      } finally { await m.dispose().catch(() => {}); }
    }

    /* ----------------------------- not set up ----------------------------- */
    mf2 = new Miniflare(opts({}));
    ok('before the owner switches it on, the website is told sign-in is off', (await (await mf2.dispatchFetch(SITE + '/licence/web/status')).json()).on === false && (await post('/licence/web/start', { email: 'pat@example.com' }, mf2)).status === 503);
    // The page believes "off" only from a note signed with the shop's key (js/licence-web.js), so without the key there
    // is none, and licences are on.
    const keyless = await (await mf2.dispatchFetch(SITE + '/licence/web/status')).json();
    ok('…but with no shop key it can sign no note, so to the page licences are on', keyless.on === false && !keyless.note, JSON.stringify(keyless));
    ok('before the shop is set up, /buy says it is not on sale yet and activation says "not ready"', (await mf2.dispatchFetch(SITE + '/buy', { redirect: 'manual' })).status === 200 && (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 503);
    await mf2.dispose();
    const { WEB_SIGN_IN: _on, ...offEnv } = env;
    mf2 = new Miniflare(opts(offEnv));
    const offRes = await mf2.dispatchFetch(SITE + '/licence/web/status'), offAnswer = await offRes.json(), offNote = await codes.readNote('status', offAnswer.note, { keys: KEYS });
    ok('with sign-in switched off, the answer carries a note signed with the shop\'s key for that purpose alone, saying off and when', offAnswer.on === false && offAnswer.note && offAnswer.note.kid === 2 && !!offNote && offNote.off === true && Math.abs(offNote.at - Date.now()) < 60e3
      && !(await codes.readNote('web', offAnswer.note, { keys: KEYS })) && !(await codes.readNote('active', offAnswer.note, { keys: KEYS })), JSON.stringify(offAnswer).slice(0, 200));
    ok('…and nothing about the person is asked for or given: a plain GET, cached for 5 minutes like the answer before notes', offRes.headers.get('cache-control') === 'public, max-age=300' && Object.keys(offAnswer).sort().join() === 'note,on' && Object.keys(JSON.parse(offAnswer.note.data)).sort().join() === 'at,off');
    await mf2.dispose();
    mf2 = new Miniflare(opts({ ...env, LICENCE_SHOP_KEY: codes.b64u.enc(stranger.pkcs8) }));
    ok('a shop key that is not the one built into Vdex keeps the shop closed instead of selling codes no app accepts', (await post('/licence/activate', { code, install: id(1) }, mf2)).status === 503 && (await mf2.dispatchFetch(SITE + '/licence/thanks?session_id=' + sid)).status === 404);

    /* ------------------------------ the App Store ------------------------------ */
    // The iPhone app's purchase: a certificate chain of our own stands in for Apple's (the Worker is told its root).
    const { execSync } = require('child_process');
    const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-apple-')), run = cmd => execSync(cmd, { cwd: wd, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(path.join(wd, 'inter.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=DER:05:00\n');
    fs.writeFileSync(path.join(wd, 'plain-ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n');
    fs.writeFileSync(path.join(wd, 'leaf.ext'), 'basicConstraints=CA:FALSE\n1.2.840.113635.100.6.11.1=DER:05:00\n');
    fs.writeFileSync(path.join(wd, 'other.ext'), 'basicConstraints=CA:FALSE\n');
    run('openssl ecparam -name secp384r1 -genkey -noout -out root.key && openssl req -new -x509 -key root.key -sha384 -days 3650 -subj "/CN=Test Root CA/O=Vdex tests" -out root.pem && openssl x509 -in root.pem -outform der -out root.der');
    run('openssl ecparam -name prime256v1 -genkey -noout -out inter.key && openssl req -new -key inter.key -subj "/CN=Test WWDR/O=Vdex tests" -out inter.csr && openssl x509 -req -in inter.csr -CA root.pem -CAkey root.key -CAcreateserial -sha384 -days 3650 -extfile inter.ext -out inter.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out leaf.key && openssl req -new -key leaf.key -subj "/CN=Test App Store/O=Vdex tests" -out leaf.csr && openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -CAcreateserial -sha256 -days 3650 -extfile leaf.ext -out leaf.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out other.key && openssl req -new -key other.key -subj "/CN=Not the App Store/O=Vdex tests" -out other.csr && openssl x509 -req -in other.csr -CA inter.pem -CAkey inter.key -CAcreateserial -sha256 -days 3650 -extfile other.ext -out other.pem');
    // a forged App Store leaf issued by that end-entity certificate (as a developer's own Apple certificate could try), and an intermediate without Apple's marker
    run('openssl ecparam -name prime256v1 -genkey -noout -out forged.key && openssl req -new -key forged.key -subj "/CN=Forged App Store/O=Vdex tests" -out forged.csr && openssl x509 -req -in forged.csr -CA other.pem -CAkey other.key -CAcreateserial -sha256 -days 3650 -extfile leaf.ext -out forged.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out plain-ca.key && openssl req -new -key plain-ca.key -subj "/CN=Some CA/O=Vdex tests" -out plain-ca.csr && openssl x509 -req -in plain-ca.csr -CA root.pem -CAkey root.key -CAcreateserial -sha384 -days 3650 -extfile plain-ca.ext -out plain-ca.pem');
    run('openssl ecparam -name prime256v1 -genkey -noout -out under-plain.key && openssl req -new -key under-plain.key -subj "/CN=App Store under some CA/O=Vdex tests" -out under-plain.csr && openssl x509 -req -in under-plain.csr -CA plain-ca.pem -CAkey plain-ca.key -CAcreateserial -sha256 -days 3650 -extfile leaf.ext -out under-plain.pem');
    const der = f => Buffer.from(fs.readFileSync(path.join(wd, f), 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const bu = buf => Buffer.from(buf).toString('base64url');
    const jws = (payload, { leaf = 'leaf', chain = ['leaf.pem', 'inter.pem', 'root.pem'] } = {}) => {
      const header = bu(JSON.stringify({ alg: 'ES256', x5c: chain.map(f => der(f).toString('base64')) })), body = bu(JSON.stringify(payload));
      const sig = crypto.sign('sha256', Buffer.from(header + '.' + body), { key: fs.readFileSync(path.join(wd, leaf + '.key'), 'utf8'), dsaEncoding: 'ieee-p1363' });
      return `${header}.${body}.${bu(sig)}`;
    };
    const txn = (over = {}) => ({ transactionId: '2000000123456789', originalTransactionId: '2000000123456789', bundleId: 'app.crowmade.vdex', productId: 'app.crowmade.vdex.licence', purchaseDate: Date.parse('2026-11-05T10:00:00Z'), originalPurchaseDate: Date.parse('2026-11-05T10:00:00Z'), quantity: 1, type: 'Non-Consumable', inAppOwnershipType: 'PURCHASED', signedDate: Date.now(), environment: 'Production', transactionReason: 'PURCHASE', storefront: 'USA', price: 19990, currency: 'USD', ...over });
    const aenv = { ...env, WEB_SIGN_IN: 'on', APPLE_BUNDLE_ID: 'app.crowmade.vdex', APPLE_ROOT_CA: fs.readFileSync(path.join(wd, 'root.der')).toString('base64') };
    ok('App Store purchases are off until the app is named', (await (await get('/licence/apple/status')).json()).on === false);
    await mf2.dispose(); mf2 = new Miniflare(opts(aenv));
    const apost = async (p, body) => { const r = await post(p, body, mf2); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    ok('…and on when it is', (await (await mf2.dispatchFetch(SITE + '/licence/apple/status')).json()).on === true);
    const iphone = id(21), claimed = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' }), cb = claimed.body;
    ok('a purchase signed by the App Store becomes a licence and a sign-in, and the phone takes none of the 3 places', claimed.status === 200 && cb.ok && cb.appleDevices === true && !!cb.token && !!cb.licence && cb.licence.seats === 3 && cb.used === undefined, JSON.stringify(claimed).slice(0, 200));
    ok('…and a desktop code for the same licence, with no email in it yet', typeof cb.code === 'string' && (await codes.verifyCode(cb.code, { keys: KEYS })).licence.ref === cb.licence.ref && (await codes.verifyCode(cb.code, { keys: KEYS })).licence.email === '', String(cb.code).slice(0, 30));
    const reclaim = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' });
    ok('claiming the same purchase again (a reinstall, Restore purchases) is the same licence', reclaim.body.ok && reclaim.body.licence.ref === cb.licence.ref, JSON.stringify(reclaim).slice(0, 160));
    const ipad = await apost('/licence/apple/claim', { jws: jws(txn()), install: id(22), os: 'iPad' });
    const placesNow = await (await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'look', ref: cb.licence.ref, at: Date.now() }), mf2)).json();
    ok('an iPad on the same Apple Account is licensed too, and neither it nor the iPhone takes a place', ipad.body.ok && ipad.body.licence.ref === cb.licence.ref && placesNow.ok && placesNow.computers.length === 0, JSON.stringify([ipad.body, placesNow]).slice(0, 200));
    const chk = await apost('/licence/web/check', { token: cb.token });
    ok('the sign-in works like the website’s: the daily check says licensed, with no email behind it', chk.body.ok && chk.body.licence.ref === cb.licence.ref && chk.body.licence.email === '', JSON.stringify(chk).slice(0, 160));
    const withClock = await apost('/licence/web/check', { token: cb.token, clock: 1795000000000 }), oddClock = await apost('/licence/web/check', { token: cb.token, clock: '1795000000000' });
    const tv = await codes.readNote('web', withClock.body.token, { keys: KEYS }), tv2 = await codes.readNote('web', oddClock.body.token, { keys: KEYS });
    ok('each new token carries the time on the device\'s clock as it was sent and the licence\'s end date (none here), for the page to count by; a time that is not a whole number is left out', !!tv && tv.clock === 1795000000000 && tv.expires === '' && !!tv2 && !('clock' in tv2) && tv2.expires === '', JSON.stringify([tv, tv2]));
    const seat2 = await apost('/licence/web/activate', { token: cb.token, install: iphone, os: 'iPhone' });
    ok('…and an older app’s weekly check of its place is still answered', seat2.body.ok && seat2.body.used === 1, JSON.stringify(seat2).slice(0, 160));
    const refusals = [
      ['a signature that is not the App Store’s', jws(txn(), { leaf: 'other', chain: ['other.pem', 'inter.pem', 'root.pem'] })],
      ['a tampered transaction', jws(txn()).replace(/\.[^.]+$/, '.' + bu(crypto.randomBytes(64)))],
      ['another app’s purchase', jws(txn({ bundleId: 'com.example.other' }))],
      ['another product', jws(txn({ productId: 'app.crowmade.vdex.tips' }))],
      ['a sandbox purchase, unless allowed', jws(txn({ environment: 'Sandbox' }))],
      ['a revoked purchase', jws(txn({ revocationDate: Date.now(), revocationReason: 0 }))],
      ['a forged App Store leaf issued by a certificate that is not an authority', jws(txn(), { leaf: 'forged', chain: ['forged.pem', 'other.pem', 'inter.pem', 'root.pem'] })],
      ['…even with the end-entity passed off as the intermediate', jws(txn(), { leaf: 'forged', chain: ['forged.pem', 'other.pem', 'root.pem'] })],
      ['a chain whose intermediate is not Apple’s', jws(txn(), { leaf: 'under-plain', chain: ['under-plain.pem', 'plain-ca.pem', 'root.pem'] })],
      ['a chain with a stranger’s root in the root’s place', jws(txn(), { chain: ['leaf.pem', 'inter.pem', 'plain-ca.pem'] })],
    ];
    for (const [what, bad] of refusals) { const r = await apost('/licence/apple/claim', { jws: bad, install: id(23), os: 'iPhone' }); ok(`refused: ${what}`, r.status === 400 || r.status === 403, String(r.status) + ' ' + JSON.stringify(r.body).slice(0, 100)); }
    const noRoot = await apost('/licence/apple/claim', { jws: jws(txn({ originalTransactionId: '2000000999' }), { chain: ['leaf.pem', 'inter.pem'] }), install: id(24), os: 'iPhone' });
    ok('a chain sent without its root still verifies against the pinned root', noRoot.status === 200, JSON.stringify(noRoot).slice(0, 160));
    // The buyer adds an email address: then the website and the Android app sign in with it, and the desktop code carries it
    const mailsBefore = mails().length;
    const es = await apost('/licence/apple/email', { token: cb.token, email: 'app@example.com' }), ecode = lastCode('app@example.com');
    ok('an App Store buyer adding an email address gets a 6-digit code there', es.status === 200 && es.body.ok && !!ecode && mails().length === mailsBefore + 1, JSON.stringify(es.body));
    ok('…only with a sign-in: without one nothing is sent', (await apost('/licence/apple/email', { token: 'x.y.z', email: 'app@example.com' })).status === 401 && mails().length === mailsBefore + 1);
    ok('a wrong code does not link it', (await apost('/licence/apple/email/verify', { token: cb.token, email: 'app@example.com', code: '000000' })).status === 400);
    const linked = await apost('/licence/apple/email/verify', { token: cb.token, email: 'app@example.com', code: ecode });
    const linkedCode = linked.body.code && (await codes.verifyCode(linked.body.code, { keys: KEYS }));
    ok('the right code links the address: the licence shows it, and the desktop code now carries it', linked.status === 200 && linked.body.ok && linked.body.licence.email === 'app@example.com' && linkedCode && linkedCode.licence.ref === cb.licence.ref && linkedCode.licence.email === 'app@example.com', JSON.stringify(linked.body).slice(0, 160));
    ok('…the phone’s daily check shows the email too', (await apost('/licence/web/check', { token: cb.token })).body.licence.email === 'app@example.com');
    const ws = await apost('/licence/web/start', { email: 'app@example.com' }), wcode = lastCode('app@example.com');
    const wv = await apost('/licence/web/verify', { email: 'app@example.com', code: wcode });
    ok('…the website signs in with that email, to the same licence', ws.status === 200 && wv.status === 200 && wv.body.licence.ref === cb.licence.ref, JSON.stringify(wv.body).slice(0, 120));
    ok('…and a website sign-in, which is not the purchase’s own, cannot add addresses to it', (await apost('/licence/apple/email', { token: wv.body.token, email: 'other@example.com' })).status === 401 && !lastCode('other@example.com'));
    const desk = await apost('/licence/activate', { code: linked.body.code, install: id(26), os: 'Windows' });
    ok('…and the desktop app activates with the code on the same licence, taking one of its places', desk.status === 200 && desk.body.ok && desk.body.used === 2, JSON.stringify(desk.body).slice(0, 120));
    const again = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' });
    ok('claiming again after the link (a reinstall) shows the email, and its code carries it', again.status === 200 && again.body.licence.email === 'app@example.com' && (await codes.verifyCode(again.body.code, { keys: KEYS })).licence.email === 'app@example.com', JSON.stringify(again.body).slice(0, 140));
    const onDemand = await apost('/licence/apple/code', { token: cb.token });
    ok('the desktop code comes on demand for the purchase’s sign-in, and for nobody else', onDemand.status === 200 && onDemand.body.code === again.body.code && (await apost('/licence/apple/code', { token: wv.body.token })).status === 401 && (await apost('/licence/apple/code', { token: 'x.y.z' })).status === 401);
    const sends = []; for (let i = 0; i < 2; i++) sends.push((await apost('/licence/apple/email', { token: cb.token, email: `more${i}@example.com` })).status);
    ok('one purchase may send three codes a day (app@example.com was the first), and no more: the fourth is refused without an email', sends.every(s => s === 200) && (await apost('/licence/apple/email', { token: cb.token, email: 'more3@example.com' })).status === 503 && !lastCode('more3@example.com'), sends.join());
    ok('a code of the wrong length is refused outright', (await apost('/licence/apple/email/verify', { token: cb.token, email: 'app@example.com', code: '12345' })).status === 400);
    // a refund through Apple cancels it; a reversed refund restores it
    const notice = (type, over = {}) => jws({ notificationType: type, subtype: '', notificationUUID: 'n-' + type, version: '2.0', signedDate: Date.now(), data: { bundleId: 'app.crowmade.vdex', environment: 'Production', signedTransactionInfo: jws(txn(over)) } });
    ok('an unsigned notice is refused', (await apost('/licence/apple/notify', { signedPayload: 'x.y.z' })).status === 400);
    const refunded = await apost('/licence/apple/notify', { signedPayload: notice('REFUND') });
    const after = await apost('/licence/web/check', { token: cb.token });
    ok('a refund notice from Apple cancels the licence: the phone’s next check says so, and the purchase cannot be claimed again', refunded.body.cancelled === 1 && after.body.error === 'cancelled' && (await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' })).status === 403, JSON.stringify([refunded, after]).slice(0, 200));
    ok('…nor can an email be added to it, nor its code fetched', (await apost('/licence/apple/email', { token: cb.token, email: 'late@example.com' })).status === 403 && (await apost('/licence/apple/code', { token: cb.token })).status === 403);
    const reversed = await apost('/licence/apple/notify', { signedPayload: notice('REFUND_REVERSED') });
    ok('a refund that Apple reverses brings it back', reversed.body.restored === 1 && (await apost('/licence/web/check', { token: cb.token })).body.ok === true);
    ok('other notices are acknowledged and ignored', (await apost('/licence/apple/notify', { signedPayload: notice('DID_RENEW') })).body.ignored === 'DID_RENEW');
    // Delete my licence records
    const forgot = await apost('/licence/web/forget', { token: cb.token });
    const lookAfter = await (await post('/licence/admin', await codes.signNote('admin', ownerKey, 1, { op: 'look', ref: cb.licence.ref, at: Date.now() }), mf2)).json();
    ok('Delete my licence records forgets the purchase link, the email and what the devices list says about each device (only their places stay held)', forgot.status === 200 && forgot.body.ok && lookAfter.ok && lookAfter.computers.length === 2 && lookAfter.computers.every(c => !c.os && !c.added && !c.seen), JSON.stringify([forgot.body, lookAfter]).slice(0, 200));
    ok('…every sign-in made before it stops working: the phone’s own, and a website sign-in with the linked email', (await apost('/licence/web/check', { token: cb.token })).status === 401 && (await apost('/licence/web/check', { token: wv.body.token })).body.error === 'signed-out');
    ok('…and it cannot be repeated with the old sign-in', (await apost('/licence/web/forget', { token: cb.token })).status === 401);
    const restored = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' });
    ok('…while the licence itself stays: restoring the purchase makes the records afresh, with a sign-in that works', restored.status === 200 && restored.body.licence.ref === cb.licence.ref && (await apost('/licence/web/check', { token: restored.body.token })).body.ok === true, JSON.stringify(restored.body).slice(0, 120));
    await mf2.dispose(); mf2 = new Miniflare(opts({ ...aenv, APPLE_ALLOW_SANDBOX: 'on' }));
    const real = await apost('/licence/apple/claim', { jws: jws(txn()), install: iphone, os: 'iPhone' });
    const sand = await apost('/licence/apple/claim', { jws: jws(txn({ environment: 'Sandbox' })), install: id(25), os: 'iPhone' });
    ok('a sandbox purchase is taken when the owner allows it (for testing): a licence of its own, apart from the real purchase with the same number', sand.status === 200 && sand.body.ok && real.status === 200 && sand.body.licence.ref !== real.body.licence.ref, JSON.stringify([sand.body.licence, real.body.licence]).slice(0, 160));
    ok('…for 30 days (its end date signed into its token too), with no desktop code and no email', /^\d{4}-\d\d-\d\d$/.test(sand.body.licence.expires) && (await codes.readNote('web', sand.body.token, { keys: KEYS })).expires === sand.body.licence.expires && !sand.body.code && (await apost('/licence/apple/email', { token: sand.body.token, email: 'sand@example.com' })).status === 403 && (await apost('/licence/apple/code', { token: sand.body.token })).status === 403);
    ok('…and its daily check and its place work like any other', (await apost('/licence/web/check', { token: sand.body.token })).body.ok === true && (await apost('/licence/web/activate', { token: sand.body.token, install: id(25), os: 'iPhone' })).body.ok === true);
    const sandRefund = await apost('/licence/apple/notify', { signedPayload: notice('REFUND', { environment: 'Sandbox' }) });
    ok('a sandbox refund cancels the sandbox licence and leaves the real one alone', sandRefund.body.cancelled === 1 && (await apost('/licence/web/check', { token: sand.body.token })).body.error === 'cancelled' && (await apost('/licence/web/check', { token: real.body.token })).body.ok === true);
    fs.rmSync(wd, { recursive: true, force: true });

    /* ------------------------------ the config ------------------------------ */
    const wr = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudflare/wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    const { WORKER_ROUTES } = await import(path.join(ROOT, 'tools/site-files.mjs'));
    ok('only /buy and /licence/… run the script; the rest is served as files', wr.main === 'worker.mjs' && JSON.stringify(wr.assets.run_worker_first) === JSON.stringify(['/buy', '/licence/*']) && JSON.stringify(WORKER_ROUTES) === JSON.stringify(wr.assets.run_worker_first) && wr.assets.binding === 'ASSETS');
    ok('the licence store is created by Wrangler (no ID to set up), and dashboard secrets survive a publish', JSON.stringify(wr.kv_namespaces) === JSON.stringify([{ binding: 'LICENCES' }]) && wr.keep_vars === true);

    /* ------------------------------ the guides ------------------------------ */
    // What the owner is told must match what the Worker does, and no real address, code or secret is written down.
    const doc = f => fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8'), selling = doc('selling-desktop.md'), play = doc('google-play.md'), apple = doc('apple-app-store.md');
    const sentence = /Sign in with `?<review address>`? and the code `?<review code>`?\. The code does not change and no mailbox is needed\./;
    ok('both store guides give reviewers the fixed sign-in, with placeholders for the address and the code', sentence.test(play) && sentence.test(apple) && sentence.test(selling) && !/Gmail|mailbox for the reviewer|arrives in that mailbox/.test(play + apple));
    const workerText = fs.readFileSync(path.join(ROOT, 'cloudflare/worker.mjs'), 'utf8'), settings = ['REVIEW_EMAIL', 'REVIEW_CODE', 'FORGET_SECRET'];
    ok('the owner\'s guide names the three new settings, and the Worker reads exactly those', settings.every(n => selling.includes('`' + n + '`') && workerText.includes('env.' + n)));
    ok('…and nowhere gives any of them a value', ![selling, play, apple].some(t => /(REVIEW_EMAIL|REVIEW_CODE|FORGET_SECRET)`?\s*(=|:)\s*`?[^\s`(]/.test(t) || /review code[^.\n]{0,40}\b\d{6}\b/i.test(t)) && ![play, apple].some(t => /[A-Za-z0-9._%+-]+@(?!crowmade\.app\b)[A-Za-z0-9.-]+\.[a-z]{2,}/.test(t.replace(/you@example\.com/g, ''))));
    const hookStep = (selling.match(/\n9\. \*\*Webhook\.\*\*[^\n]*/) || [''])[0];
    ok('the webhook step lists every event the Worker acts on, the end of a dispute included', ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].every(e => hookStep.includes('`' + e + '`') && workerText.includes(`'${e}'`)), hookStep.trim().slice(0, 80));
    const nums = (workerText.match(/const REVIEW_TRIES = (\d+), REVIEW_TRIES_ALL = (\d+);/) || []).slice(1).map(Number), years = Math.round(1e6 / 2 / (nums[1] || 1) / 365);
    ok('the guides say what the Worker enforces: the review address\'s limits per connection and for everyone, what they give, and a deletion secret of 20 characters or more', nums.length === 2 && selling.includes(`After ${nums[0]} wrong tries in a day from one internet connection`) && selling.includes(`After ${nums[1]} wrong tries in a day from everyone together`) && selling.includes(`about ${years} years on average`) && [play, apple].every(t => t.includes(`After ${nums[0]} wrong codes in a day from one connection`) && t.includes(`after ${nums[1]} in a day from everyone together`)) && /20 characters or more/.test(selling) && /s\.length >= 20/.test(workerText), `${nums} → ${years} years`);
    ok('the product is a Vdex licence for one person on up to 3 devices, not a desktop licence', selling.includes('name "Vdex licence", description "One-off licence to use Vdex, for one person, on up to 3 devices"') && !/name "Vdex desktop licence"/.test(selling));
    // The review address and code, and the deletion secret, are the owner's to set in Cloudflare and are written nowhere
    // here: the only addresses at the publisher's domains in these files are the support and sending addresses (and the
    // made-up reply address the tests use).
    const walk = d => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []).flatMap(e => (e.name === 'node_modules' || e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(md|mjs|cjs|js|html|json|jsonc)$/.test(e.name) ? [path.join(d, e.name)] : []));
    const ours = [...['docs', 'cloudflare', 'js', 'desktop', 'tools'].flatMap(d => walk(path.join(ROOT, d))), ...walk(path.join(REPO, 'tests/specs')), ...fs.readdirSync(ROOT).filter(f => /\.(html|md|json)$/.test(f)).map(f => path.join(ROOT, f))];
    const atOurs = [...new Set(ours.flatMap(f => (fs.readFileSync(f, 'utf8').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) || []).map(a => a.toLowerCase())))].filter(a => /[@.]crowmade\.app$/.test(a));
    ok('no address at crowmade.app is written in the code, the guides or the tests but the support, sending and test reply addresses', ours.length > 100 && atOurs.every(a => ['support@crowmade.app', 'licences@vdex.crowmade.app', 'help@crowmade.app'].includes(a)), atOurs.join(', '));
    const google = doc('turn-on-sign-in.md');
    ok('Google\'s sign-in registration is given crowmade.app/vdex/ as the application home page', /application home page `https:\/\/crowmade\.app\/vdex\/`/.test(google) && /\| Application home page \(Google only\) \| `https:\/\/crowmade\.app\/vdex\/` \|/.test(google));
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exitCode = 1;
  } finally {
    if (mf) await mf.dispose().catch(() => {});
    if (mf2) await mf2.dispose().catch(() => {});
  }
})();

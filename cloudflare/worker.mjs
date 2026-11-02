// The vdex Worker. Everything at https://vdex.crowmade.app is the static website (served straight from the files in
// ./site), except these few addresses, which this script answers (wrangler.jsonc → assets.run_worker_first):
//
//   /buy                       goes to the Stripe payment page for the 20 USD desktop licence
//   /licence/thanks            where Stripe sends a buyer after paying: shows their licence code
//   /licence/stripe-webhook    Stripe tells us about payments (email the code), refunds and disputes (cancel it)
//   /licence/activate          a desktop app puts its computer on a code's list (at most 3 computers per code)
//   /licence/release           a desktop app takes its computer off the list
//   /licence/admin             the owner's generator page: look at, clear, cancel or restore a code (signed requests)
//
// Codes are made and checked by desktop/licence-codes.js, the same file the app and the generator use. The list of
// computers for each code, and which codes are cancelled, are kept in the LICENCES KV namespace (created by Wrangler on
// the first deploy). Secrets, set in Cloudflare (Workers & Pages → vdex → Settings → Variables and Secrets):
//   LICENCE_SHOP_KEY       the shop's private key (key 2), from the generator page; signs paid codes and activations
//   STRIPE_SECRET_KEY      a restricted Stripe key that can only read Checkout Sessions
//   STRIPE_WEBHOOK_SECRET  the signing secret of the webhook endpoint (whsec_…)
//   STRIPE_PAYMENT_LINK    the payment link's ID (plink_…): only payments made through it get a code
//   BUY_URL                the payment link's address (https://buy.stripe.com/…)
//   RESEND_API_KEY         Resend, to email codes (optional: without it the code is only shown after paying)
//   MAIL_FROM, REPLY_TO    the email's sender (default "Vdex <licences@vdex.crowmade.app>") and where replies go
import codes from '../desktop/licence-codes.js';
import KEYS from '../desktop/licence-keys.json';

const SITE = 'https://vdex.crowmade.app';
const SHOP_KID = 2;
const DAY = 86400e3;
const SWAPS = 3;                // moving a code to a new computer while all its places are taken: 3 times in 30 days
const enc = new TextEncoder();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const today = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/* -------------------------------- responses -------------------------------- */
const API_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
function page(status, title, body, script = '') {
  const nonce = codes.b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><style>
:root{--bg:#14110f;--card:#25201b;--line:#3a332b;--text:#f1e6cf;--muted:#a09584;--accent:#e0a43a;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#efe8da;--card:#fbf7ec;--line:#d4c9b0;--text:#2a2118;--muted:#756a58;--accent:#b87a10;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:40px 16px 64px}h1{font-size:1.6rem;line-height:1.2;margin:0 0 12px}a{color:var(--accent)}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:18px 0}
textarea{width:100%;font:15px/1.5 ui-monospace,Menlo,Consolas,monospace;color:inherit;background:transparent;border:1px solid var(--line);border-radius:10px;padding:10px;resize:vertical;word-break:break-all}
button,.btn{display:inline-block;font:inherit;font-weight:700;padding:10px 18px;border-radius:10px;border:0;background:var(--accent);color:#14110f;cursor:pointer;text-decoration:none;margin:8px 8px 0 0}
ol li{margin:6px 0}</style></head><body><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
async function readJson(request, max = 8000) {
  const text = await request.text().catch(() => '');
  if (!text || text.length > max) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}

/* ---------------------------------- keys ----------------------------------- */
// The shop key, checked once against the public key built into the apps: a key that does not match would make codes no
// app accepts, so the shop stays closed until it is fixed.
const shopKeys = new Map();
function shopKey(env) {
  const text = String(env.LICENCE_SHOP_KEY || '').trim();
  if (!text || !KEYS[SHOP_KID]) return Promise.resolve(null);
  if (!shopKeys.has(text)) shopKeys.set(text, (async () => {
    try { const k = await codes.importPrivate(text, true); if ((await codes.publicOf(k)) !== KEYS[SHOP_KID]) { console.error(`LICENCE_SHOP_KEY is not the key ${SHOP_KID} built into the app`); return null; } return codes.importPrivate(text); }
    catch (e) { console.error('LICENCE_SHOP_KEY could not be read: ' + e.message); return null; }
  })());
  return shopKeys.get(text);
}

/* -------------------------------- selling ---------------------------------- */
async function stripeGet(env, path) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) { console.error(`Stripe answered ${r.status} for ${path.split('?')[0]}`); return null; }
  return r.json();
}
const selling = env => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PAYMENT_LINK);
// The serial comes from the Checkout Session, so the thank-you page, a reload of it and the email all show the same code.
async function refForSession(id) { const h = await sha256('vdex-order|' + id); const serial = new DataView(h.buffer).getUint32(0) || 1; return { serial, ref: codes.refOf(SHOP_KID, serial) }; }
async function licenceForSession(s, env) {
  if (!s || typeof s !== 'object' || !/^cs_(live|test)_[A-Za-z0-9]{10,250}$/.test(String(s.id))) return { error: 'not-found' };
  if (s.status !== 'complete' || !['paid', 'no_payment_required'].includes(s.payment_status)) return { error: 'not-paid' };
  if (!env.STRIPE_PAYMENT_LINK || s.payment_link !== env.STRIPE_PAYMENT_LINK) return { error: 'not-ours' };
  const key = await shopKey(env); if (!key) return { error: 'not-ready' };
  const d = s.customer_details || {}, name = codes.fitText(d.name || ''), email = String(d.email || '').trim().toLowerCase();
  const mail = enc.encode(email).length <= 64 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : '';
  const { serial, ref } = await refForSession(s.id);
  const code = await codes.signCode(key, SHOP_KID, { serial, name: name || (mail ? '' : 'Vdex customer'), email: mail, issued: today((Number(s.created) || 0) * 1000 || Date.now()) });
  return { code, ref, name, email: email || '', sessionId: s.id };
}

async function thanks(url, env) {
  const id = url.searchParams.get('session_id') || '';
  if (!selling(env)) return page(503, 'The shop is not open yet', '<h1>The shop is not open yet</h1><p>If you have paid, reply to your receipt email and we will send your licence code.</p>');
  const s = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/.test(id) ? await stripeGet(env, 'checkout/sessions/' + encodeURIComponent(id)) : null;
  const r = await licenceForSession(s, env);
  if (r.error === 'not-paid') return page(202, 'Your payment is on its way', `<h1>Your payment is on its way</h1><p>Some payment methods take a little while to confirm. <a href="/licence/thanks?session_id=${esc(encodeURIComponent(id))}">Reload this page</a> in a minute. ${env.RESEND_API_KEY ? 'We will also email your code as soon as the payment is confirmed.' : ''}</p>`);
  if (r.error) return page(404, 'We could not find that order', '<h1>We could not find that order</h1><p>If you have just paid, wait a minute and reload this page. If it still does not work, reply to your receipt email and we will send your licence code.</p>');
  const who = r.name || r.email;
  return page(200, 'Thank you! Here is your Vdex licence code', `<h1>Thank you! Here is your licence code</h1>
<p>${who ? `Licensed to <b>${esc(who)}</b>. ` : ''}It works on up to 3 of your own computers.${env.RESEND_API_KEY && r.email ? ` We have also emailed it to ${esc(r.email)}.` : ' Keep a copy: this page is the only place it is shown.'}</p>
<div class="card"><label for="code" class="muted">Your licence code</label><textarea id="code" rows="5" readonly>${esc(r.code)}</textarea><button id="copy" type="button">Copy the code</button> <span id="copied" class="muted" role="status"></span></div>
<ol><li><a href="/download.html">Download Vdex</a> and open it, if you haven't yet.</li><li>In Vdex, open <b>Settings → About → Enter licence code</b>.</li><li>Paste the whole code and press <b>Activate</b>.</li></ol>
<p class="muted">The receipt from Stripe is your proof of purchase. Questions? Reply to the email your code comes in.</p>`,
  "document.getElementById('copy').onclick=async()=>{const t=document.getElementById('code'),m=document.getElementById('copied');try{await navigator.clipboard.writeText(t.value);m.textContent='Copied.'}catch(e){t.select();m.textContent='Press Ctrl+C (Cmd+C on a Mac) to copy.'}}");
}

// Stripe signs each webhook: header "t=<time>,v1=<HMAC-SHA256 of '<time>.<body>'>". Older than 5 minutes is refused.
async function stripeEvent(request, env) {
  const raw = await request.text(), header = request.headers.get('Stripe-Signature') || '';
  const t = (header.match(/(?:^|,)\s*t=(\d+)/) || [])[1], sigs = [...header.matchAll(/(?:^|,)\s*v1=([0-9a-f]{64})/g)].map(m => m[1]);
  if (!t || !sigs.length || !env.STRIPE_WEBHOOK_SECRET || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${raw}`)));
  const same = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
  if (!sigs.some(s => same(s, want))) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function webhook(request, env) {
  const ev = await stripeEvent(request, env);
  if (!ev) return json(400, { error: 'bad-signature' });
  const o = (ev.data && ev.data.object) || {};
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    const r = await licenceForSession(o, env);
    if (r.error === 'not-ready') return json(503, { error: 'not-ready' }); // Stripe tries again for up to 3 days
    if (r.error) return json(200, { ignored: r.error });
    if (env.RESEND_API_KEY && r.email && !(await sendCode(env, r))) return json(502, { error: 'email-failed' });
    return json(200, { ok: true, ref: r.ref });
  }
  // A full refund or a dispute cancels the code bought with that payment. A partial refund keeps it.
  if ((ev.type === 'charge.refunded' && o.refunded) || ev.type === 'charge.dispute.created') {
    const pi = typeof o.payment_intent === 'string' ? o.payment_intent : o.payment_intent && o.payment_intent.id;
    if (!pi || !/^pi_[A-Za-z0-9]{6,250}$/.test(pi)) return json(200, { ignored: 'no-payment' });
    const list = await stripeGet(env, `checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=5`);
    if (!list) return json(502, { error: 'stripe' });
    const why = ev.type === 'charge.refunded' ? 'refund' : 'dispute';
    let n = 0;
    for (const s of list.data || []) if (s.payment_link === env.STRIPE_PAYMENT_LINK) { await env.LICENCES.put('x:' + (await refForSession(s.id)).ref, JSON.stringify({ why, at: Date.now() })); n++; }
    return json(200, { ok: true, cancelled: n });
  }
  return json(200, { ignored: ev.type });
}
async function sendCode(env, r) {
  const text = `Thank you for buying Vdex.\n\nYour licence code:\n\n${r.code}\n\nTo use it: open Vdex on your computer, go to Settings → About → Enter licence code, paste the whole code and press Activate. It works on up to 3 of your own computers.\n\nDownload Vdex: ${SITE}/download.html\n\nKeep this email: it is your copy of the code.${env.REPLY_TO ? ' If you need help, reply to it.' : ''}\n`;
  const html = `<p>Thank you for buying Vdex.</p><p>Your licence code:</p><p style="font:15px/1.5 ui-monospace,Menlo,Consolas,monospace;word-break:break-all;background:#f4efe6;padding:12px;border-radius:8px">${esc(r.code)}</p><p>To use it: open Vdex on your computer, go to <b>Settings → About → Enter licence code</b>, paste the whole code and press <b>Activate</b>. It works on up to 3 of your own computers.</p><p><a href="${SITE}/download.html">Download Vdex</a></p><p>Keep this email: it is your copy of the code.${env.REPLY_TO ? ' If you need help, reply to it.' : ''}</p>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'vdex-licence-' + r.sessionId },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Vdex <licences@vdex.crowmade.app>', to: [r.email], ...(env.REPLY_TO ? { reply_to: env.REPLY_TO } : {}), subject: 'Your Vdex licence code', text, html }),
  }).catch(() => null);
  if (res && (res.ok || res.status === 409)) return true; // 409: this email was already sent (or is being sent) for this order
  console.error('Resend answered ' + (res ? res.status : 'nothing'));
  return false;
}

/* ------------------------------ 3 computers ------------------------------- */
// A computer is listed by the random ID its install made. Other computers only ever see a short tag made from it, so
// one computer cannot take another off the list except through a counted swap.
const tagOf = async id => codes.b64u.enc(await sha256('vdex-seat|' + id)).slice(0, 12);
const OS = new Set(['Mac', 'Windows', 'Linux']);
const validInstall = v => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
async function readCode(text) { try { const r = await codes.verifyCode(String(text || ''), { keys: KEYS }); return r; } catch { return null; } }
async function seats(env, ref) {
  const rec = await env.LICENCES.get('c:' + ref, 'json').catch(() => null);
  const computers = rec && Array.isArray(rec.computers) ? rec.computers.filter(c => c && validInstall(c.id)) : [];
  return { computers, swaps: rec && Array.isArray(rec.swaps) ? rec.swaps.filter(t => Number.isFinite(t) && Date.now() - t < 30 * DAY) : [] };
}
const shown = computers => Promise.all(computers.map(async c => ({ tag: await tagOf(c.id), os: c.os, added: c.added, seen: c.seen })));

async function activate(request, env) {
  const b = await readJson(request); if (!b || !validInstall(b.install)) return json(400, { error: 'invalid' });
  if (!env.LICENCES) return json(503, { error: 'not-ready' });
  const key = await shopKey(env); if (!key) return json(503, { error: 'not-ready' });
  const r = await readCode(b.code); if (!r) return json(400, { error: 'invalid' });
  if (r.status === 'expired') return json(403, { error: 'expired' });
  const ref = r.licence.ref, max = r.licence.seats;
  if (await env.LICENCES.get('x:' + ref)) return json(403, { error: 'cancelled' });
  const rec = await seats(env, ref), now = Date.now(), day = today(now);
  let list = rec.computers, changed = false;
  const mine = list.find(c => c.id === b.install);
  if (mine) { if (!mine.seen || now - Date.parse(mine.seen) > 6 * DAY) { mine.seen = day; changed = true; } }
  else {
    if (list.length >= max) {
      const tags = await Promise.all(list.map(c => tagOf(c.id)));
      const i = typeof b.release === 'string' ? tags.indexOf(b.release) : -1;
      if (i < 0) return json(409, { error: 'full', computers: await shown(list), swapsLeft: Math.max(0, SWAPS - rec.swaps.length) });
      if (rec.swaps.length >= SWAPS) return json(429, { error: 'swaps' });
      list = list.filter((_, j) => j !== i); rec.swaps.push(now);
    }
    list.push({ id: b.install, os: OS.has(b.os) ? b.os : 'Computer', added: day, seen: day }); changed = true;
  }
  if (changed) await env.LICENCES.put('c:' + ref, JSON.stringify({ computers: list, swaps: rec.swaps }));
  return json(200, { ok: true, receipt: await codes.signNote('active', key, SHOP_KID, { ref, install: b.install, at: now }), used: list.length, seats: max });
}
async function release(request, env) {
  const b = await readJson(request); if (!b || !validInstall(b.install)) return json(400, { error: 'invalid' });
  if (!env.LICENCES) return json(503, { error: 'not-ready' });
  const r = await readCode(b.code); if (!r) return json(400, { error: 'invalid' });
  const ref = r.licence.ref, rec = await seats(env, ref);
  if (!rec.computers.some(c => c.id === b.install)) return json(404, { error: 'not-listed' });
  await env.LICENCES.put('c:' + ref, JSON.stringify({ computers: rec.computers.filter(c => c.id !== b.install), swaps: rec.swaps }));
  return json(200, { ok: true });
}

/* ------------------------------ the owner ------------------------------- */
// Requests from the generator page, signed with the owner's key (1, or the spare 9) and good for 10 minutes.
async function admin(request, env) {
  const b = await readJson(request);
  const v = b && (await codes.readNote('admin', b, { keys: KEYS, signers: codes.OWNER_KIDS }));
  if (!v) return json(403, { error: 'not-signed' }, CORS);
  if (!Number.isFinite(v.at) || Math.abs(Date.now() - v.at) > 10 * 60e3) return json(403, { error: 'stale', now: Date.now() }, CORS);
  if (!/^\d{1,3}:\d{1,10}$/.test(String(v.ref))) return json(400, { error: 'bad-ref' }, CORS);
  if (!env.LICENCES) return json(503, { error: 'not-ready' }, CORS);
  const ref = v.ref;
  if (v.op === 'clear') await env.LICENCES.delete('c:' + ref);
  else if (v.op === 'cancel') await env.LICENCES.put('x:' + ref, JSON.stringify({ why: 'owner', at: Date.now() }));
  else if (v.op === 'restore') await env.LICENCES.delete('x:' + ref);
  else if (v.op !== 'look') return json(400, { error: 'bad-op' }, CORS);
  const rec = await seats(env, ref), x = await env.LICENCES.get('x:' + ref, 'json').catch(() => null);
  return json(200, { ok: true, ref, computers: await shown(rec.computers), swaps: rec.swaps.length, cancelled: x || null }, CORS);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), p = url.pathname, m = request.method;
    try {
      if (p === '/buy') {
        const to = String(env.BUY_URL || '');
        if (m === 'GET' && /^https:\/\/[^/\s]+\/\S*$/.test(to)) return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' } });
        return page(200, 'Vdex for desktop', '<h1>The desktop licence is not on sale yet</h1><p>Vdex for Windows, Mac and Linux will cost 20 USD once, for up to 3 of your own computers. Until then, <a href="/index.html">use Vdex in your web browser</a>.</p>');
      }
      if (p === '/licence/thanks' && m === 'GET') return await thanks(url, env);
      if (p === '/licence/stripe-webhook' && m === 'POST') return await webhook(request, env);
      if (p === '/licence/activate' && m === 'POST') return await activate(request, env);
      if (p === '/licence/release' && m === 'POST') return await release(request, env);
      if (p === '/licence/admin') return m === 'OPTIONS' ? new Response(null, { status: 204, headers: CORS }) : m === 'POST' ? await admin(request, env) : json(405, { error: 'method' }, CORS);
      if (p.startsWith('/licence/')) return json(404, { error: 'not-found' });
    } catch (e) {
      console.error(e && e.stack || e);
      return p.startsWith('/licence/') && p !== '/licence/thanks' ? json(500, { error: 'server' }) : page(500, 'Something went wrong', '<h1>Something went wrong</h1><p>Try again in a minute.</p>');
    }
    return env.ASSETS.fetch(request);
  },
};
export { licenceForSession, refForSession, tagOf };

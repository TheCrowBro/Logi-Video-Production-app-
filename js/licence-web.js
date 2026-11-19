// The website's licence (vdex.crowmade.app, and the Google Play app, which is the website in an Android app). The desktop
// app has its own (desktop/licence.js); js/licence.js shows either one, and both answer the same questions.
//
// The licence check is on unless the licence server says it is off in a note signed with the shop's key, which the page
// checks against the public keys below (the Worker sends one while the owner has WEB_SIGN_IN switched off). No answer,
// a blocked or failed request, a plain or made-up answer, a note signed with another key or one more than 3 days old
// (by the latest time this browser has seen) all mean on, and so does an "off" stored by a version from before notes.
// The page asks at most every 6 hours, and the request carries nothing about the person or their trial.
// From the first time this browser sees it on, there is a 30-day trial, for people who used the website before as well
// as new visitors. After that the website is read-only until someone signs in with the email address their licence
// belongs to: the Worker emails a 6-digit code, and the page keeps the signed token it gets back, checking it about once
// a day. Only the licence server's signature counts, never what is stored beside it: the token (signed with the shop's
// key, and naming the stored licence), a store app's receipt for its place, and the token's own time, from which the
// 90 days without a check are counted (each check brings a new token, and counts only with one newer than the token
// kept; the token also carries the time on this device's clock when it asked, and a free licence's end date). Browsers
// whose Web Crypto has no Ed25519 check the signatures with the bundled vendor/ed25519.js. When a licence that covered
// this browser or phone stops covering it (cancelled, refunded or charged back, past its end date, or the phone's
// place moved to another device), the time it learned so is kept here (`lapsed`, never sent), and Export backup stays
// open for 30 days from it (js/licence.js).
// The Google Play app also takes one of the licence's 3 places (like a computer running the desktop app), and never
// links to the shop: Google Play does not allow a Play app to send people to another way to pay.
// The iPhone app (apple/) takes a place the same way, and can also buy the licence through the App Store: Apple's
// signed purchase goes to /licence/apple/claim, which makes it a licence and a sign-in like the website's.
import * as native from './native.js';
const KEY = 'vdex-licence';
const PRODUCT = 'app.crowmade.vdex.licence'; // the App Store product (docs/apple-app-store.md)
const DAY = 86400e3, TRIAL_DAYS = 30;
const STATUS_EVERY = 6 * 3600e3;   // ask whether the licence check is on, at most this often
const CHECK_EVERY = DAY;           // confirm a sign-in about once a day
const SEAT_EVERY = 7 * DAY;        // the Play app confirms its place about once a week
const OFFLINE_LIMIT = 90 * DAY;    // a sign-in must be confirmed at least once in 90 days
const SEATS = 3;
const NOTE_LIFE = 3 * DAY;         // how long a note that licences are off is believed after it was signed
// The public keys of the licence server's signed notes: the same as desktop/licence-keys.json (spec 104 checks).
// The tests serve a copy of the page with a key of their own here (tests/lib.mjs).
const KEYS = {"1":"wSlaz7v7fQD63KBI5hQYpzcHfApySBg3Q9in2PNQyRo","2":"4b5NeFpKfxHay0HhdL5K_djauqO6LQ-kc6XLMx0kS9M","9":"wfsECLa4vjGuWnstxsrc5vxTXRroOYodT_ymBhfdmjw"};

const now = () => Date.now();
const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: asked again next time */ } };
const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = t => Uint8Array.from(atob(String(t).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// Ed25519 signatures are checked with Web Crypto where the browser has it, and otherwise (Safari and iOS before 17,
// Chrome before 137, Firefox before 129) with the bundled checker, vendor/ed25519.js (@noble/ed25519), which is loaded
// only then. One that could not be loaded is tried again at the next look, under another address (a browser remembers
// a module that failed to load).
const edOk = () => edOk.p || (edOk.p = crypto.subtle.importKey('raw', unb64(Object.values(KEYS)[0]), { name: 'Ed25519' }, false, ['verify']).then(() => true, () => false));
let noble = null, nobleTries = 0;
const nobleLib = () => noble || (noble = import(new URL('../vendor/ed25519.js', import.meta.url).href + (nobleTries ? `?try=${nobleTries}` : '')).catch(() => {
  noble = null; nobleTries++; throw Object.assign(new Error('vendor/ed25519.js could not be loaded'), { unloaded: true });
}));
// Whether `sig` is the signature of `prefix + data` by the public key `pub` (base64url): true, false, or undefined when
// it could not be checked now (the bundled checker did not load).
async function edCheck(pub, sig, prefix, data) {
  try {
    const p = unb64(pub), s = unb64(sig), m = new TextEncoder().encode(prefix + data);
    if (await edOk()) return await crypto.subtle.verify({ name: 'Ed25519' }, await crypto.subtle.importKey('raw', p, { name: 'Ed25519' }, false, ['verify']), s, m);
    return !!(await (await nobleLib()).verifyAsync(s, m, p));
  } catch (e) { return e && e.unloaded ? undefined : false; }
}
const json = t => { try { const v = JSON.parse(t); return v && typeof v === 'object' ? v : null; } catch { return null; } };

// The licence server's note { kid, data, sig } that licences are off: its value ({ off: true, at }) when it is signed
// by one of KEYS with the status prefix (desktop/licence-codes.js), else null, as also while it cannot be checked.
const checked = new Map(); // a note -> its value, or null: each note is checked once per page
const noteId = n => (n && typeof n === 'object' ? `${n.kid}.${n.sig}.${n.data}` : '');
function readOff(note) {
  if (!note || typeof note !== 'object' || typeof note.data !== 'string' || typeof note.sig !== 'string' || note.data.length > 400 || note.sig.length > 200
    || !Number.isInteger(note.kid) || !Object.prototype.hasOwnProperty.call(KEYS, note.kid)) return Promise.resolve(null);
  const id = noteId(note);
  if (!checked.has(id)) checked.set(id, edCheck(KEYS[note.kid], note.sig, 'VDEX-STATUS\0', note.data).then(good => {
    if (good === undefined) checked.delete(id);
    const v = good && json(note.data);
    return v && v.off === true && Number.isFinite(v.at) ? { at: v.at } : null;
  }));
  return checked.get(id);
}
// Whether the stored note (already checked: `off`) still says licences are off at this time.
const fresh = (off, latest) => !!off && latest < off.at + NOTE_LIFE && off.at < latest + NOTE_LIFE;
// The licence server's sign-in token (VDEX-WEB) and a store app's place receipt (VDEX-ACTIVE), signed with the shop's
// key (2), as the Worker signs them: their value when the signature is good, null when it is not, and undefined while
// it cannot be checked (the bundled checker did not load: asked again at the next look). Nothing typed into the
// browser's storage passes for either.
const SHOP_KID = 2;
const signed = new Map();
function readSigned(prefix, n) {
  if (!n || typeof n !== 'object' || n.kid !== SHOP_KID || !KEYS[SHOP_KID] || typeof n.data !== 'string' || typeof n.sig !== 'string' || n.data.length > 4000 || n.sig.length > 200) return Promise.resolve(null);
  const id = prefix + noteId(n);
  if (!signed.has(id)) signed.set(id, edCheck(KEYS[SHOP_KID], n.sig, prefix, n.data).then(good => { if (good === undefined) signed.delete(id); return good === undefined ? undefined : good ? json(n.data) : null; }));
  return signed.get(id);
}
const readToken = n => readSigned('VDEX-WEB\0', n), readReceipt = n => readSigned('VDEX-ACTIVE\0', n);
// When the 90 days without a check start, for a token (`iat`) or a receipt (`at`): the licence server's time on it, or
// the time on this device's clock when it asked (`clock`, which the server signs back as it was sent) where that is
// later and not later than the clock is now. So a clock that is simply ahead of the right time costs nothing, and one
// put back since, or a time sent by hand, counts from the server's time.
const since = (at, clock, t) => (Number.isFinite(clock) && clock <= t ? Math.max(Number(at) || 0, clock) : Number(at) || 0);

// bare: nothing but the request itself (no cookie, no address of the page it comes from), for the status question.
async function call(path, body, { bare = false } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15e3);
  try {
    const r = await fetch(path.startsWith('/') ? path : '/licence/web/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal }
      : { cache: 'no-store', signal: ctl.signal, ...(bare ? { credentials: 'omit', referrerPolicy: 'no-referrer' } : {}) });
    const b = await r.json().catch(() => null);
    return { status: r.status, body: b || {}, answered: !!b };
  } finally { clearTimeout(t); }
}

// The Google Play app opens /index.html?src=play (android/twa-manifest.json). It shares this browser storage with
// Chrome on that phone, so the phone stays marked as the Play app once seen. The iPhone app is known by its bridge
// (js/native.js), and has a storage of its own.
function markApp() {
  const s = read();
  if (!s.play && (/[?&]src=play(&|$)/.test(location.search) || /^android-app:\/\/app\.crowmade\.vdex/.test(document.referrer))) { s.play = true; write(s); }
  if (!s.ios && native.isApp) { s.ios = true; write(s); }
}
const inApp = s => !!(s.play || s.ios); // a store app: never links to the shop, and takes a place on the licence
// …except an iPhone or iPad licensed by an App Store purchase: Apple's licence covers all of the Apple Account's devices.
const viaOf = s => s.via || (s.token && s.licence && s.ios && !s.licence.email ? 'apple' : s.token ? 'email' : ''); // older sign-ins carry no via
const seated = s => inApp(s) && !(s.ios && viaOf(s) === 'apple');
// Whether a licence covers this browser or phone now: signed in, and in a store app that takes a place, on its list.
const covered = s => !!(s.token && s.licence) && !(seated(s) && s.seat !== 'ok');
const ended = (e, t) => !!e && t >= Date.parse(e + 'T00:00:00Z') + DAY; // a free licence given until a date (endsOf)
const latestOf = (s, t) => Math.max(t, s.seen || 0); // the latest time this browser has shown: winding the clock back gains nothing
// When a licence that covered this device stopped covering it: noted once, and kept (also after signing out, or in
// again with a licence that is still cancelled) until a licence covers it again.
const lapse = (s, t) => { if (!(s.lapsed > 0)) s.lapsed = latestOf(s, t); };

export function webLicence() {
  markApp();
  const listeners = new Set();
  let last = '';
  const emit = st => { const sig = JSON.stringify(st); if (sig !== last) { last = sig; listeners.forEach(f => { try { f(st); } catch { /* ignore */ } }); } };
  // The stored note, once its signature has been checked (`id` says which note `off` belongs to). Checking takes a
  // moment, so it is done before every look from outside (state, recheck); the state is worked out from it.
  // The same for the stored sign-in token (`tid`, `tok`) and place receipt (`rid`, `rec`); one that could not be checked
  // yet (undefined) is checked again at the next look from outside.
  const known = { id: '', off: null, tid: '', tok: null, rid: '', rec: null };
  async function learn() {
    { const n = read().note, id = noteId(n); if (id !== known.id) { const off = await readOff(n); if (noteId(read().note) === id) { known.id = id; known.off = off; } } }
    { const n = read().token, id = noteId(n); if (id !== known.tid || known.tok === undefined) { const v = await readToken(n); if (noteId(read().token) === id) { known.tid = id; known.tok = v; } } }
    { const n = read().seatReceipt, id = noteId(n); if (id !== known.rid || known.rec === undefined) { const v = await readReceipt(n); if (noteId(read().seatReceipt) === id) { known.rid = id; known.rec = v; } } }
  }
  // A token or receipt from the licence server's answer, checked before it is kept: its value, or null (the answer is
  // not used). It must be the licence server's, and signed later than `than`, the time on the one it replaces: an
  // answer kept from before and played back, or made up anywhere else, is no check that got through.
  async function take(kind, n, than = 0) {
    const v = await (kind === 'token' ? readToken(n) : readReceipt(n));
    if (!v || !(Number(kind === 'token' ? v.iat : v.at) > than)) return null;
    if (kind === 'token') { known.tid = noteId(n); known.tok = v; } else { known.rid = noteId(n); known.rec = v; }
    return v;
  }
  // The licence server's time on a stored token or receipt, once checked (0 for one that is not the server's).
  const iatOf = n => readToken(n).then(v => (v && Number(v.iat)) || 0), atOf = n => readReceipt(n).then(v => (v && Number(v.at)) || 0);
  // The stored token's value when it is the licence server's and names the stored licence; otherwise there is no sign-in.
  function tokenOf(s) {
    const id = noteId(s.token); if (!id || !s.licence || id !== known.tid) return null;
    const v = known.tok;
    return v && String(v.ref) === String(s.licence.ref) && (!v.email || v.email === String(s.licence.email || '').toLowerCase()) ? v : null;
  }
  // The stored place receipt's value when it is for this sign-in's licence and this phone.
  function receiptOf(s, tok) {
    const id = noteId(s.seatReceipt); if (!id || !tok || id !== known.rid) return null;
    const v = known.rec;
    return v && String(v.ref) === String(tok.ref) && v.install === s.install && Number.isFinite(v.at) ? v : null;
  }
  // A free licence's end date, as the licence server signed it into the token (tokens from before 1.4.0 carry none: then
  // as stored, until the next check brings a new token).
  const endsOf = (s, tok) => (tok && typeof tok.expires === 'string' ? tok.expires : (s.licence && s.licence.expires) || '');
  // When a check made in this page last failed (no answer, or not the licence server's): kept here, where nothing
  // typed into the browser's storage reaches it.
  const failed = { check: 0, seat: 0 };
  // Past the 90 days since the licence server last signed (the token's or the receipt's own time), read-only only once
  // a check made after them has failed (not while it is still checking).
  const lapsedCheck = (latest, at, fail, tried, ok) => latest - at > OFFLINE_LIMIT && (fail > at + OFFLINE_LIMIT || ((tried || 0) > at + OFFLINE_LIMIT && (tried || 0) > (ok || 0)));
  // A trial start later than the latest time this browser has seen counts as that time: no more than 30 days.
  const trialLeftOf = (s, t) => Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - Math.floor((latestOf(s, t) - Math.min(s.first || t, latestOf(s, t))) / DAY)));
  const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // the date where this browser is

  // s: the stored record, with token and seat as checked (`tok`, `rec`); a token that is not the licence server's is no sign-in.
  function describe(s, t, on, tok, rec) {
    const via = viaOf(s);
    const base = { kind: 'web', play: !!s.play, ios: !!s.ios, app: inApp(s), enabled: on, seats: (s.licence && s.licence.seats) || SEATS, os: s.play ? 'Android' : s.ios ? native.device() : 'Web', price: s.price || '', via };
    if (!on) return { ...base, mode: 'off', canEdit: true };
    const left = trialLeftOf(s, t), latest = latestOf(s, t);
    const trial = { trialLeft: left, trialEnds: localDay(new Date(Math.min(s.first || t, latest) + TRIAL_DAYS * DAY)), ...(s.lapsed > 0 ? { lapsedAt: s.lapsed } : {}) };
    if (s.cancelled && !s.token) return { ...base, ...trial, licence: s.licence || null, mode: 'cancelled', canEdit: left > 0, rejoins: !!s.cancelledToken }; // rejoins: shown to the licence server daily, so signed in again by itself if it works again
    if (s.licence && (s.expired || ended(endsOf(s, tok), t))) return { ...base, ...trial, licence: { ...s.licence, expires: endsOf(s, tok) || s.licence.expires }, mode: 'expired', canEdit: left > 0 }; // a free licence given until a date
    if (!tok) return { ...base, ...trial, mode: left > 0 ? 'trial' : 'ended', canEdit: left > 0 };
    const licence = s.licence;
    if (lapsedCheck(latest, since(tok.iat, tok.clock, t), failed.check, s.tried, s.checked)) return { ...base, licence, mode: 'offline', canEdit: false };
    if (seated(s)) {
      // Not on the licence's list: its place was moved to another device, or it signed in while all were taken. The
      // licence does not cover it, so Vdex is as it is without one here (js/licence.js).
      if (s.seat === 'released' || s.seat === 'full') return { ...base, ...trial, licence, mode: 'released', canEdit: left > 0 };
      // On the list only with the licence server's receipt for this phone, confirmed at least once in 90 days.
      // A phone given its place by an earlier version, which kept no receipt (`oldSeat`, noted at its first look with this
      // one), counts as on the list until its next place check, which is due at once and brings a receipt.
      if (s.seat !== 'ok' || !(rec || s.oldSeat)) return { ...base, ...trial, licence, mode: 'pending', daysLeft: 0, canEdit: left > 0 };
      if (rec && lapsedCheck(latest, since(rec.at, rec.clock, t), failed.seat, s.seatTried, s.seatChecked)) return { ...base, licence, mode: 'offline', canEdit: false };
    }
    return { ...base, licence, mode: 'licensed', canEdit: true };
  }
  let relearn = false;
  function state() {
    const s = read(), t = now();
    // A token or receipt not checked yet (written by another window): checked, then the state is given again.
    if (!relearn && ((s.token && noteId(s.token) !== known.tid) || (s.seatReceipt && noteId(s.seatReceipt) !== known.rid))) { relearn = true; learn().then(() => { relearn = false; state(); }, () => { relearn = false; }); }
    // On unless the stored note, checked, still says off. Before its check (a moment after the page opens) the last
    // answer stands in, and nothing is changed on account of it.
    const sure = noteId(s.note) === known.id;
    const on = sure ? !fresh(known.off, latestOf(s, t)) : s.on !== false;
    if (sure && s.on !== on) {
      // The trial only runs while the licence check is on: switched off and on again, it carries on where it was.
      if (s.on && !on) s.offAt = t;
      if (!s.on && on && s.first && s.offAt) { s.first = Math.min(t, s.first + Math.max(0, t - s.offAt)); s.seen = latestOf(s, t); }
      if (on) delete s.offAt;
      s.on = on;
    }
    if (on && !s.first) s.first = t;
    if (!s.seen || t > s.seen + 60e3) s.seen = Math.max(s.seen || 0, t); // the latest time seen: winding the clock back gains no trial days
    if (s.first > latestOf(s, t)) s.first = latestOf(s, t); // a trial cannot start later than now
    // Once, on the first look with this version: a licence refunded, cancelled or ended before it, which kept no day, is
    // taken to have stopped covering this device now, so its 30 days of Export backup run from here.
    // And a store app's place taken before it, which kept no receipt, counts until the first place check (oldSeat).
    if (on && !s.v14) { if ((s.cancelled || s.expired) && !s.token) lapse(s, t); if (s.token && s.seat === 'ok' && !s.seatReceipt) s.oldSeat = 1; s.v14 = 1; }
    const tok = tokenOf(s), rec = receiptOf(s, tok);
    const signedIn = !!tok && !(seated(s) && !(s.seat === 'ok' && (rec || s.oldSeat))); // covered(), with the token and the place as checked
    if (on && signedIn && ended(endsOf(s, tok), t)) lapse(s, t); // a licence given until a date that has passed here
    if (on && seated(s) && tok && s.seat === 'released') lapse(s, t); // moved off the list (a place moved before this version kept no day: from now)
    const st = describe(s, t, on, tok, rec);
    if (st.mode === 'licensed') delete s.lapsed; // covered again
    write(s);
    emit(st); return st;
  }
  const update = fn => { const s = read(); fn(s); write(s); return state(); };

  // Asks whether licences are on: at most every 6 hours, "Try again" included, and whether or not an answer comes (the
  // privacy policy says so), with a plain GET that carries nothing about the person. Only a note this page can check,
  // and fresh, is kept; any other answer means on. With no answer, a note already kept goes on counting until its 3 days
  // are up, and licences are on meanwhile if there is none.
  async function status() {
    const s = read(), before = s.statusAt;
    if (s.statusAt && now() - s.statusAt < STATUS_EVERY && now() >= s.statusAt) return;
    write({ ...s, statusAt: now() }); // the time it was asked, before asking
    let r;
    try { r = await call('status', null, { bare: true }); } catch (e) {
      // A request that could not be sent (no connection, or blocked) never reached the server: asked again at the next
      // look. One that timed out may have, so it waits its 6 hours.
      if (!(e && e.name === 'AbortError')) { const x = read(); if (before) x.statusAt = before; else delete x.statusAt; write(x); }
      return;
    }
    if (!(r.status === 200 && r.answered)) return; // something answered, not the licence server: as no answer
    const n = r.body.on === false && r.body.note && typeof r.body.note === 'object' ? { kid: r.body.note.kid, data: r.body.note.data, sig: r.body.note.sig } : null;
    const off = await readOff(n), keep = fresh(off, latestOf(read(), now()));
    known.id = keep ? noteId(n) : ''; known.off = keep ? off : null;
    update(x => { if (keep) x.note = n; else delete x.note; });
  }
  // The Play app's place on the licence. { ok } | { full, computers, swapsLeft } | { error }.
  async function seat(release) {
    const s = read(); if (!s.token) return { error: 'signed-out' };
    if (!s.install) update(x => { x.install = x.install || rand(); });
    const offline = () => { failed.seat = now(); update(x => { x.seatTried = now(); }); return { offline: true }; };
    // The times on the token and receipt kept now: an answer counts only with newer ones (take).
    const [iat, at] = await Promise.all([iatOf(read().token), atOf(read().seatReceipt)]);
    let r; try { r = await call('activate', { token: read().token, install: read().install, clock: now(), ...(s.ios ? { os: native.device() } : {}), ...(release ? { release } : {}) }); } catch { return offline(); }
    const b = r.body;
    // The place counts only with the licence server's signed receipt for it (b.token: moved to another of this email's
    // licences, which had room); an answer without them is not the licence server's.
    if (r.status === 200 && b.ok) {
      if ((b.token && !(await take('token', b.token, iat))) || !(await take('receipt', b.receipt, at))) return offline();
      failed.seat = 0; update(x => { x.seat = 'ok'; x.seatReceipt = b.receipt; delete x.oldSeat; x.seatChecked = x.seatTried = now(); if (b.token) { x.token = b.token; x.licence = b.licence || x.licence; } });
      return { ok: true };
    }
    if (b.token && (await take('token', b.token, iat))) update(x => { x.token = b.token; x.licence = b.licence || x.licence; }); // moved to another of this email's licences
    if (b.error === 'full') { update(x => { delete x.oldSeat; if (x.seat === 'ok') lapse(x, now()); x.seat = x.seat === 'ok' ? 'released' : 'full'; x.seatTried = now(); }); return { full: true, computers: Array.isArray(b.computers) ? b.computers.slice(0, 20) : [], swapsLeft: b.swapsLeft }; }
    if (b.error === 'swaps') return { error: 'This licence has been moved between devices 3 times in the last 30 days, so it cannot move again yet. Reply to the email your licence came in and we will sort it out.' };
    if (r.answered && ['cancelled', 'signed-out', 'expired'].includes(b.error)) { signedOut(b.error); return { error: { cancelled: 'This licence has been cancelled.', 'signed-out': 'You have been signed out. Sign in again.', expired: 'This licence has ended.' }[b.error] }; }
    return offline();
  }
  // A store app signing in to another licence while it holds a place on one: that place goes back first, so it is
  // not left taken on a licence this phone no longer uses (the next weekly check could not do it: the token is gone).
  async function giveBack(next) {
    const s = read();
    if (!inApp(s) || s.seat !== 'ok' || !s.token || !s.licence || (next && next.ref === s.licence.ref)) return;
    try { await call('release', { token: s.token, install: s.install }); } catch { /* the place can still be moved from the chooser later */ }
  }
  // Only when the licence server itself says so: a firewall's or a network filter's refusal is not an answer. A
  // licence that covered this device and is now cancelled or ended: the day this device learned so is kept.
  // A cancelled sign-in's token is kept aside (`cancelledToken`, no sign-in) and shown to the licence server once a day:
  // a cancellation for a payment dispute that is then settled in the seller's favour is undone there, and so here.
  function signedOut(why) { update(x => { if ((why === 'cancelled' || why === 'expired') && covered(x)) lapse(x, now()); if (why === 'cancelled' && x.token) { x.cancelledToken = x.token; x.cancelTried = now(); } delete x.token; delete x.seat; delete x.seatReceipt; delete x.oldSeat; if (why === 'cancelled') x.cancelled = true; if (why === 'expired') x.expired = true; else delete x.licence; }); }

  /* ------------------------------ the App Store ------------------------------ */
  // Apple's signed purchase → a licence, with this phone on it. Answers like verify(): the state, or { error }.
  async function claim(jws) {
    if (!read().install) update(x => { x.install = x.install || rand(); });
    let r; try { r = await call('/licence/apple/claim', { jws, install: read().install, os: native.device(), clock: now() }); } catch { update(x => { delete x.autoAt; }); return { error: 'Vdex could not reach the licence server. Check the internet connection, then use Restore purchases.' }; }
    const b = r.body, t = now();
    const good = !!(b.token && b.licence) && !!(await take('token', b.token)); // a token that is not the licence server's is no purchase confirmed
    if (good) { await giveBack(b.licence); update(x => { x.token = b.token; x.licence = b.licence; x.via = 'apple'; delete x.seat; delete x.seatReceipt; delete x.oldSeat; delete x.signedOut; x.checked = x.tried = t; delete x.cancelled; delete x.cancelledToken; delete x.expired; }); }
    if (r.status === 200 && b.ok && good) return state(); // no place to take: the purchase covers every iPhone and iPad of the Apple Account
    if (!r.answered) { update(x => { delete x.autoAt; }); return { error: 'Vdex could not reach the licence server. Check the internet connection, then use Restore purchases.' }; } // looked for again at the next check
    return { error: { cancelled: 'This purchase was refunded, so it no longer licenses Vdex. Buy again, or sign in with the email address of a licence.', revoked: 'Apple has revoked this purchase.', sandbox: 'That is a test purchase, which does not license Vdex.', 'not-ready': 'Buying in the app is not switched on yet. Try again later, or sign in with the email address of a licence.', swaps: 'This licence has been moved between devices 3 times in the last 30 days, so it cannot move again yet.' }[b.error] || 'Vdex could not confirm the purchase with Apple. Use Restore purchases in a moment.' };
  }
  async function buyInApp() {
    update(x => { delete x.signedOut; });
    let r; try { r = await native.purchases.buy(PRODUCT); } catch (e) { return { error: e.message || 'The App Store could not complete the purchase.' }; }
    if (!r || r.state === 'cancelled') return { cancelled: true };
    if (r.state === 'pending') { update(x => { delete x.autoAt; }); return { pending: true }; } // Ask to Buy: the entitlement arrives later, and recheck() picks it up
    if (!r.jws) return { error: 'The App Store did not return a receipt. Use Restore purchases.' };
    return claim(r.jws);
  }
  // Restore purchases: what this Apple ID owns (also after a reinstall, or on a second iPhone). quiet: no App Store round trip.
  async function restoreInApp(quiet = false) {
    if (!quiet) { update(x => { delete x.signedOut; }); try { await native.purchases.restore(); } catch { /* what the phone already knows may do */ } }
    let list = []; try { list = await native.purchases.owned(); } catch (e) { return { error: e.message || 'Could not ask the App Store.' }; }
    const mine = list.filter(x => x.productId === PRODUCT && x.jws && x.state !== 'revoked');
    if (!mine.length) return { error: 'No Vdex purchase was found for this Apple ID. If you bought with an email address, sign in with it.', none: true };
    let last = null;
    for (const x of mine) { const r = await claim(x.jws); if (r && !r.error) return r; last = r; }
    return last;
  }
  const askPrice = () => native.purchases.product(PRODUCT).then(p => { if (p && p.price) update(x => { x.price = p.price; }); }).catch(() => {});
  if (read().ios && native.purchases.available()) {
    askPrice();
    native.purchases.onTransaction(tx => { if (tx && tx.productId === PRODUCT && tx.jws && tx.state !== 'revoked') claim(tx.jws).catch(() => {}); });
  }
  // The buyer adds an email address to an App Store licence (then the website and the Android app sign in with it, and
  // the desktop code carries it). Step 1 sends a 6-digit code to it; step 2 links it.
  const EMAIL_ERR = { 'invalid-email': 'That email address does not look right.', 'email-failed': 'The email could not be sent just now. Try again in a minute.', busy: 'Vdex has sent as many emails as it can today. Please try again tomorrow.', 'not-ready': 'Adding an email is not available yet.', 'signed-out': 'Sign in again (Restore purchases), then add the address.', cancelled: 'This licence has been cancelled.', 'wrong-code': 'That code is not right, or has run out (a code works for 15 minutes and 5 tries). Check it, or send a new one.' };
  async function addEmail(email) {
    let r; try { r = await call('/licence/apple/email', { token: read().token, email }); } catch { return { error: 'Vdex could not reach the licence server. Check the internet connection and try again.' }; }
    return r.status === 200 && r.body.ok ? { ok: true } : { error: EMAIL_ERR[r.body.error] || 'Something went wrong. Try again.' };
  }
  async function verifyEmail(email, code) {
    let r; try { r = await call('/licence/apple/email/verify', { token: read().token, email, code }); } catch { return { error: 'Vdex could not reach the licence server. Check the internet connection and try again.' }; }
    if (r.status !== 200 || !r.body.ok) return { error: EMAIL_ERR[r.body.error] || 'Something went wrong. Try again.' };
    update(x => { x.licence = r.body.licence || x.licence; });
    return state();
  }
  // The desktop code of an App Store licence, fetched when asked for and kept nowhere on the phone.
  async function desktopCode() {
    let r; try { r = await call('/licence/apple/code', { token: read().token }); } catch { throw new Error('Vdex could not reach the licence server. Check the internet connection and try again.'); }
    if (r.status === 200 && r.body.code) return r.body.code;
    throw new Error({ sandbox: 'A test purchase has no code for the desktop app.', cancelled: 'This licence has been cancelled.', 'signed-out': 'Sign in again (Restore purchases) to get the code.' }[r.body.error] || 'The code could not be fetched just now. Try again in a minute.');
  }

  return {
    kind: 'web',
    get play() { return !!read().play; },
    get ios() { return !!read().ios; },
    get app() { return inApp(read()); },
    price: () => read().price || '',
    // The website's price with tax where this browser is (the licence server answers from the request's country:
    // GET /licence/price). Never in the store apps: the App Store shows its own price, and the Play app none.
    localPrice: async () => {
      const s = read(); if (s.ios || s.play) return null;
      try { const r = await call('/licence/price'); return r.status === 200 ? r.body : null; } catch { return null; }
    },
    // The answer to the status question is waited for 3 seconds at most: one that never comes (a request held open)
    // must not keep the licence unknown, and so Vdex unchecked. A later answer still counts, through onChange.
    state: async () => { await learn(); await Promise.race([status(), new Promise(r => setTimeout(r, 3000))]); return state(); },
    onChange: cb => { listeners.add(cb); return () => listeners.delete(cb); },
    // The shop in a new tab; in the iPhone app, the App Store purchase (answers like verify(), or { cancelled } / { pending }).
    buy: async () => { const s = read(); if (s.ios) return buyInApp(); if (!s.play) window.open('/buy', '_blank', 'noopener'); return true; },
    restore: async () => restoreInApp(false),
    addEmail, verifyEmail,
    // Delete my licence records: the licence server forgets this sign-in's email address or App Store purchase and the
    // devices on the licence, and every sign-in made before now stops working. Then this device is signed out.
    forget: async () => {
      const s = read(); if (!s.token) return { error: 'Sign in first: the records are found through your sign-in.' };
      let r; try { r = await call('forget', { token: s.token }); } catch { return { error: 'Vdex could not reach the licence server. Check the internet connection and try again.' }; }
      if (!(r.status === 200 && r.body.ok) && !(r.answered && r.status === 401)) return { error: 'The records could not be deleted just now. Try again in a minute.' };
      update(x => { delete x.token; delete x.licence; delete x.seat; delete x.seatReceipt; delete x.oldSeat; delete x.cancelled; delete x.cancelledToken; delete x.expired; delete x.via; if (x.ios) x.signedOut = true; });
      return state();
    },
    code: async () => (read().via === 'apple' || (read().ios && read().licence && !read().licence.email) ? desktopCode() : ''), // an App Store licence's desktop code, fetched when asked for
    // Step 1: email (or a licence code with an email inside). The Worker answers the same either way.
    start: async ({ email, code }) => {
      let r; try { r = await call('start', code ? { code } : { email }); } catch { return { error: 'Vdex could not reach the sign-in server. Check the internet connection and try again.' }; }
      const b = r.body;
      if (r.status === 200 && b.ok) return { ok: true, email: b.email || '' };
      return { error: { 'invalid-email': 'That email address does not look right.', 'invalid-code': 'That licence code is not valid, or has ended.', 'no-email': 'That licence code has no email address in it. Sign in with the email address your licence belongs to, or ask us to add one.', 'email-failed': 'The email could not be sent just now. Try again in a minute.', busy: 'Vdex has sent as many sign-in emails as it can today. Please try again tomorrow.', 'not-ready': 'Signing in is not available yet.' }[b.error] || 'Something went wrong. Try again.' };
    },
    // Step 2: the 6-digit code. Signs in, and in the Play app takes one of the licence's places.
    verify: async (email, code) => {
      let r; try { r = await call('verify', { email, code, clock: now() }); } catch { return { error: 'Vdex could not reach the sign-in server. Check the internet connection and try again.' }; }
      const b = r.body;
      if (r.status !== 200 || !b.token || !(await take('token', b.token))) return { error: { 'wrong-code': 'That code is not right, or has run out (a code works for 15 minutes and 5 tries). Check it, or send a new one.', 'no-licence': `No licence is linked to this email address. Use the one your licence belongs to${read().play ? '' : ', or buy a licence'}.` }[b.error] || 'Something went wrong. Try again.' };
      await giveBack(b.licence);
      update(x => { x.token = b.token; x.licence = b.licence; x.via = 'email'; delete x.signedOut; x.checked = x.tried = now(); delete x.cancelled; delete x.cancelledToken; delete x.expired; delete x.seat; delete x.seatReceipt; delete x.oldSeat; });
      if (inApp(read())) { const sr = await seat(); if (sr.full) return { ...state(), full: sr }; }
      return state();
    },
    // The Play app, when its licence is full: move the place from another device (its tag).
    seat: async release => { const r = await seat(release); return r.full ? { error: 'full', ...r } : r.error ? r : r.offline ? { ...state(), offline: true } : state(); },
    // Background: about once a day, and "Try again".
    recheck: async (force = false) => {
      await learn(); await status();
      let s = read(); const t = now(), on = state().enabled;
      if (s.ios && !s.price && native.purchases.available()) await askPrice(); // the App Store's price, until it has said it once
      // The iPhone app, signed out: a purchase this Apple ID already owns (a reinstall, a second iPhone) licenses it by itself,
      // unless the person signed out on purpose (Sign out): then only Restore purchases or a new purchase signs in again.
      if (on && !s.token && s.ios && !s.signedOut && native.purchases.available() && (force || !s.autoAt || t - s.autoAt > DAY || t < s.autoAt)) { update(x => { x.autoAt = t; }); await restoreInApp(true).catch(() => null); s = read(); }
      if (!on) return state();
      // Cancelled: the old sign-in is shown to the licence server once a day, and if the licence works again (a payment
      // dispute settled in the seller's favour) this device is signed in again with it.
      if (!s.token && s.cancelled && s.cancelledToken && (force || t - (s.cancelTried || 0) > CHECK_EVERY || t < (s.cancelTried || 0))) {
        update(x => { x.cancelTried = t; });
        try {
          const than = await iatOf(s.cancelledToken), r = await call('check', { token: s.cancelledToken, clock: now() }), b = r.body, tk = b.token;
          if (r.status === 200 && b.ok && b.licence && tk && (await take('token', tk, than))) update(x => { x.token = tk; x.licence = b.licence; x.checked = x.tried = now(); delete x.cancelled; delete x.cancelledToken; delete x.cancelTried; });
          else if (r.answered && (r.status === 401 || (r.status === 403 && b.error !== 'cancelled'))) update(x => { delete x.cancelledToken; delete x.cancelTried; }); // signed out or ended for good: nothing to wait for
        } catch { /* asked again tomorrow */ }
        s = read();
      }
      if (!s.token) return state();
      // Due about once a day by the time on the token (since(): the licence server's, or this device's clock when it asked;
      // and by the time stored here, which only makes it sooner), and at every look while the stored token is not one the
      // licence server signed for the stored licence.
      const tok = tokenOf(s), iat = tok ? since(tok.iat, tok.clock, t) : 0;
      if (force || !tok || t - iat > CHECK_EVERY || t < iat - DAY || t - (s.checked || 0) > CHECK_EVERY || t < (s.checked || 0)) {
        const fail = () => { failed.check = now(); update(x => { x.tried = now(); }); }; // no answer, or not the licence server's: try again later
        try {
          // A check gets through only with a new token from the licence server, newer than the one kept.
          const than = await iatOf(s.token), r = await call('check', { token: s.token, clock: now() }), b = r.body;
          if (r.status === 200 && b.ok && b.token && (await take('token', b.token, than))) { failed.check = 0; update(x => { x.checked = x.tried = now(); x.licence = b.licence || x.licence; x.token = b.token; }); }
          else if (r.answered && (r.status === 401 || r.status === 403) && ['signed-out', 'cancelled', 'expired'].includes(b.error)) signedOut(b.error);
          else fail();
        } catch { fail(); }
      }
      const s2 = read();
      if (seated(s2) && s2.token) {
        // On the list: about weekly, by the receipt's own time too, and at once without a receipt (one from an earlier
        // version, which kept none); moved off or full: daily; not yet: hourly.
        const t2 = now(), rec = receiptOf(s2, tokenOf(s2)), wait = s2.seat === 'ok' ? null : s2.seat ? DAY : 3600e3;
        const due = force || (wait === null ? !rec || t2 - since(rec.at, rec.clock, t2) > SEAT_EVERY || t2 - (s2.seatChecked || 0) > SEAT_EVERY : t2 - (s2.seatTried || 0) > wait) || t2 < (s2.seatTried || 0);
        if (due) await seat();
      }
      return state();
    },
    // Sign out (the Play app also gives back its place, which needs the internet).
    release: async () => {
      const s = read();
      if (inApp(s) && s.seat === 'ok' && s.token) {
        let r; try { r = await call('release', { token: s.token, install: s.install }); } catch { r = null; }
        if (!r || (r.status !== 200 && r.status !== 404 && r.status !== 400)) return { error: 'Vdex could not reach the licence server. Connect to the internet and try again, so this phone\'s place can go to another device.' };
      }
      update(x => { delete x.token; delete x.licence; delete x.seat; delete x.seatReceipt; delete x.oldSeat; delete x.cancelled; delete x.cancelledToken; delete x.expired; delete x.via; if (x.ios) x.signedOut = true; });
      return state();
    },
  };
}

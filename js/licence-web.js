// The website's licence (vdex.crowmade.app, and the Google Play app, which is the website in an Android app). The desktop
// app has its own (desktop/licence.js); js/licence.js shows either one, and both answer the same questions.
//
// Nothing changes until the owner switches it on (the Worker's WEB_SIGN_IN; /licence/web/status says so). From the
// first time this browser sees it on, there is a 30-day trial, for people who used the website before as well as new
// visitors. After that the website is read-only until someone signs in with the email address their licence belongs
// to: the Worker emails a 6-digit code, and the page keeps the signed token it gets back, checking it about once a day.
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

const now = () => Date.now();
const read = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: asked again next time */ } };
const rand = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function call(path, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15e3);
  try {
    const r = await fetch(path.startsWith('/') ? path : '/licence/web/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
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

export function webLicence() {
  markApp();
  const listeners = new Set();
  let last = '';
  const emit = st => { const sig = JSON.stringify(st); if (sig !== last) { last = sig; listeners.forEach(f => { try { f(st); } catch { /* ignore */ } }); } };

  function describe(s, t) {
    const via = viaOf(s);
    const base = { kind: 'web', play: !!s.play, ios: !!s.ios, app: inApp(s), enabled: !!s.on, seats: (s.licence && s.licence.seats) || SEATS, os: s.play ? 'Android' : s.ios ? native.device() : 'Web', price: s.price || '', via };
    if (!s.on) return { ...base, mode: 'off', canEdit: true };
    const left = Math.max(0, TRIAL_DAYS - Math.floor(((s.seen || t) - (s.first || t)) / DAY));
    const trial = { trialLeft: left, trialEnds: new Date((s.first || t) + TRIAL_DAYS * DAY).toISOString().slice(0, 10) };
    if (s.cancelled && !s.token) return { ...base, ...trial, licence: s.licence || null, mode: 'cancelled', canEdit: left > 0 };
    const ended = l => !!(l && l.expires && t >= Date.parse(l.expires + 'T00:00:00Z') + DAY);
    if (s.licence && (s.expired || ended(s.licence))) return { ...base, ...trial, licence: s.licence, mode: 'expired', canEdit: left > 0 }; // a free licence given until a date
    if (!s.token || !s.licence) return { ...base, ...trial, mode: left > 0 ? 'trial' : 'ended', canEdit: left > 0 };
    const licence = s.licence;
    // Past the limit, read-only only once a check made after it has failed (not while it is still checking).
    if (t - (s.checked || 0) > OFFLINE_LIMIT && (s.tried || 0) > (s.checked || 0) + OFFLINE_LIMIT) return { ...base, licence, mode: 'offline', canEdit: false };
    if (seated(s)) {
      if (s.seat === 'released' || s.seat === 'full') return { ...base, ...trial, licence, mode: 'released', canEdit: left > 0 };
      if (s.seat !== 'ok') return { ...base, ...trial, licence, mode: 'pending', daysLeft: 0, canEdit: left > 0 };
    }
    return { ...base, licence, mode: 'licensed', canEdit: true };
  }
  function state() {
    const s = read(), t = now();
    if (s.on && !s.first) s.first = t;
    if (!s.seen || t > s.seen + 60e3) s.seen = Math.max(s.seen || 0, t); // the latest time seen: winding the clock back gains no trial days
    write(s);
    const st = describe(s, t); emit(st); return st;
  }
  const update = fn => { const s = read(); fn(s); write(s); return state(); };

  async function status(force) {
    const s = read();
    if (!force && s.statusAt && now() - s.statusAt < STATUS_EVERY && now() >= s.statusAt) return;
    try {
      const r = await call('status');
      if (r.status === 200 && r.answered) update(x => {
        const on = !!r.body.on, t = now();
        // The trial only runs while the licence check is on: switched off and on again, it carries on where it was.
        if (x.on && !on) x.offAt = t;
        if (!x.on && on && x.first && x.offAt) { x.first = Math.min(t, x.first + Math.max(0, t - x.offAt)); x.seen = t; }
        if (on) delete x.offAt;
        x.on = on; x.statusAt = t;
      });
    } catch { /* offline: keep what we knew */ }
  }
  // The Play app's place on the licence. { ok } | { full, computers, swapsLeft } | { error }.
  async function seat(release) {
    const s = read(); if (!s.token) return { error: 'signed-out' };
    if (!s.install) update(x => { x.install = x.install || rand(); });
    let r; try { r = await call('activate', { token: read().token, install: read().install, ...(s.ios ? { os: native.device() } : {}), ...(release ? { release } : {}) }); } catch { update(x => { x.seatTried = now(); }); return { offline: true }; }
    const b = r.body;
    if (r.status === 200 && b.ok) { update(x => { x.seat = 'ok'; x.seatChecked = x.seatTried = now(); if (b.token) { x.token = b.token; x.licence = b.licence || x.licence; } }); return { ok: true }; } // b.token: moved to another of this email's licences, which had room
    if (b.token) update(x => { x.token = b.token; x.licence = b.licence || x.licence; }); // moved to another of this email's licences
    if (b.error === 'full') { update(x => { x.seat = x.seat === 'ok' ? 'released' : 'full'; x.seatTried = now(); }); return { full: true, computers: Array.isArray(b.computers) ? b.computers.slice(0, 20) : [], swapsLeft: b.swapsLeft }; }
    if (b.error === 'swaps') return { error: 'This licence has been moved between devices 3 times in the last 30 days, so it cannot move again yet. Reply to the email your licence came in and we will sort it out.' };
    if (r.answered && ['cancelled', 'signed-out', 'expired'].includes(b.error)) { signedOut(b.error); return { error: { cancelled: 'This licence has been cancelled.', 'signed-out': 'You have been signed out. Sign in again.', expired: 'This licence has ended.' }[b.error] }; }
    update(x => { x.seatTried = now(); }); return { offline: true };
  }
  // A store app signing in to another licence while it holds a place on one: that place goes back first, so it is
  // not left taken on a licence this phone no longer uses (the next weekly check could not do it: the token is gone).
  async function giveBack(next) {
    const s = read();
    if (!inApp(s) || s.seat !== 'ok' || !s.token || !s.licence || (next && next.ref === s.licence.ref)) return;
    try { await call('release', { token: s.token, install: s.install }); } catch { /* the place can still be moved from the chooser later */ }
  }
  // Only when the licence server itself says so: a firewall's or a network filter's refusal is not an answer.
  function signedOut(why) { update(x => { delete x.token; delete x.seat; if (why === 'cancelled') x.cancelled = true; if (why === 'expired') x.expired = true; else delete x.licence; }); }

  /* ------------------------------ the App Store ------------------------------ */
  // Apple's signed purchase → a licence, with this phone on it. Answers like verify(): the state, or { error }.
  async function claim(jws) {
    if (!read().install) update(x => { x.install = x.install || rand(); });
    let r; try { r = await call('/licence/apple/claim', { jws, install: read().install, os: native.device() }); } catch { update(x => { delete x.autoAt; }); return { error: 'Vdex could not reach the licence server. Check the internet connection, then use Restore purchases.' }; }
    const b = r.body, t = now();
    if (b.token && b.licence) { await giveBack(b.licence); update(x => { x.token = b.token; x.licence = b.licence; x.via = 'apple'; delete x.seat; delete x.signedOut; x.checked = x.tried = t; delete x.cancelled; delete x.expired; }); }
    if (r.status === 200 && b.ok) return state(); // no place to take: the purchase covers every iPhone and iPad of the Apple Account
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
    state: async () => { await status(false); return state(); },
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
      update(x => { delete x.token; delete x.licence; delete x.seat; delete x.cancelled; delete x.expired; delete x.via; if (x.ios) x.signedOut = true; });
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
      let r; try { r = await call('verify', { email, code }); } catch { return { error: 'Vdex could not reach the sign-in server. Check the internet connection and try again.' }; }
      const b = r.body;
      if (r.status !== 200 || !b.token) return { error: { 'wrong-code': 'That code is not right, or has run out (a code works for 15 minutes and 5 tries). Check it, or send a new one.', 'no-licence': `No licence is linked to this email address. Use the one your licence belongs to${read().play ? '' : ', or buy a licence'}.` }[b.error] || 'Something went wrong. Try again.' };
      await giveBack(b.licence);
      update(x => { x.token = b.token; x.licence = b.licence; x.via = 'email'; delete x.signedOut; x.checked = x.tried = now(); delete x.cancelled; delete x.expired; delete x.seat; });
      if (inApp(read())) { const sr = await seat(); if (sr.full) return { ...state(), full: sr }; }
      return state();
    },
    // The Play app, when its licence is full: move the place from another device (its tag).
    seat: async release => { const r = await seat(release); return r.full ? { error: 'full', ...r } : r.error ? r : r.offline ? { ...state(), offline: true } : state(); },
    // Background: about once a day, and "Try again".
    recheck: async (force = false) => {
      await status(force);
      let s = read(); const t = now();
      if (s.ios && !s.price && native.purchases.available()) await askPrice(); // the App Store's price, until it has said it once
      // The iPhone app, signed out: a purchase this Apple ID already owns (a reinstall, a second iPhone) licenses it by itself,
      // unless the person signed out on purpose (Sign out): then only Restore purchases or a new purchase signs in again.
      if (s.on && !s.token && s.ios && !s.signedOut && native.purchases.available() && (force || !s.autoAt || t - s.autoAt > DAY || t < s.autoAt)) { update(x => { x.autoAt = t; }); await restoreInApp(true).catch(() => null); s = read(); }
      if (!s.on || !s.token) return state();
      if (force || t - (s.checked || 0) > CHECK_EVERY || t < (s.checked || 0)) {
        try {
          const r = await call('check', { token: s.token });
          if (r.status === 200 && r.body.ok) update(x => { x.checked = x.tried = now(); x.licence = r.body.licence || x.licence; if (r.body.token) x.token = r.body.token; });
          else if (r.answered && (r.status === 401 || r.status === 403) && ['signed-out', 'cancelled', 'expired'].includes(r.body.error)) signedOut(r.body.error);
          else update(x => { x.tried = now(); }); // no answer, or not the licence server's: try again later
        } catch { update(x => { x.tried = now(); }); }
      }
      const s2 = read();
      if (seated(s2) && s2.token) {
        const t2 = now(), wait = s2.seat === 'ok' ? null : s2.seat ? DAY : 3600e3; // on the list: weekly; moved off or full: daily; not yet: hourly
        const due = force || (wait === null ? t2 - (s2.seatChecked || 0) > SEAT_EVERY : t2 - (s2.seatTried || 0) > wait) || t2 < (s2.seatTried || 0);
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
      update(x => { delete x.token; delete x.licence; delete x.seat; delete x.cancelled; delete x.expired; delete x.via; if (x.ios) x.signedOut = true; });
      return state();
    },
  };
}

// The website's licence (vdex.crowmade.app, and the Google Play app, which is the website in an Android app). The desktop
// app has its own (desktop/licence.js); js/licence.js shows either one, and both answer the same questions.
//
// Nothing changes until the owner switches it on (the Worker's WEB_SIGN_IN; /licence/web/status says so). From the
// first time this browser sees it on, there is a 30-day trial, for people who used the website before as well as new
// visitors. After that the website is read-only until someone signs in with the email address their licence belongs
// to: the Worker emails a 6-digit code, and the page keeps the signed token it gets back, checking it about once a day.
// The Google Play app also takes one of the licence's 3 places (like a computer running the desktop app), and never
// links to the shop: Google Play does not allow a Play app to send people to another way to pay.
const KEY = 'vdex-licence';
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
    const r = await fetch('/licence/web/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
    const b = await r.json().catch(() => null);
    return { status: r.status, body: b || {}, answered: !!b };
  } finally { clearTimeout(t); }
}

// The Google Play app opens /index.html?src=play (android/twa-manifest.json). It shares this browser storage with
// Chrome on that phone, so the phone stays marked as the Play app once seen.
function markPlay() {
  const s = read();
  if (!s.play && (/[?&]src=play(&|$)/.test(location.search) || /^android-app:\/\/app\.crowmade\.vdex/.test(document.referrer))) { s.play = true; write(s); }
}

export function webLicence() {
  markPlay();
  const listeners = new Set();
  let last = '';
  const emit = st => { const sig = JSON.stringify(st); if (sig !== last) { last = sig; listeners.forEach(f => { try { f(st); } catch { /* ignore */ } }); } };

  function describe(s, t) {
    const base = { kind: 'web', play: !!s.play, enabled: !!s.on, seats: (s.licence && s.licence.seats) || SEATS, os: s.play ? 'Android' : 'Web' };
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
    if (s.play) {
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
    let r; try { r = await call('activate', { token: read().token, install: read().install, ...(release ? { release } : {}) }); } catch { update(x => { x.seatTried = now(); }); return { offline: true }; }
    const b = r.body;
    if (r.status === 200 && b.ok) { update(x => { x.seat = 'ok'; x.seatChecked = x.seatTried = now(); if (b.token) { x.token = b.token; x.licence = b.licence || x.licence; } }); return { ok: true }; } // b.token: moved to another of this email's licences, which had room
    if (b.error === 'full') { update(x => { x.seat = x.seat === 'ok' ? 'released' : 'full'; x.seatTried = now(); }); return { full: true, computers: Array.isArray(b.computers) ? b.computers.slice(0, 20) : [], swapsLeft: b.swapsLeft }; }
    if (b.error === 'swaps') return { error: 'This licence has been moved between devices 3 times in the last 30 days, so it cannot move again yet. Reply to the email your licence came in and we will sort it out.' };
    if (r.answered && ['cancelled', 'signed-out', 'expired'].includes(b.error)) { signedOut(b.error); return { error: { cancelled: 'This licence has been cancelled.', 'signed-out': 'You have been signed out. Sign in again.', expired: 'This licence has ended.' }[b.error] }; }
    update(x => { x.seatTried = now(); }); return { offline: true };
  }
  // Only when the licence server itself says so: a firewall's or a network filter's refusal is not an answer.
  function signedOut(why) { update(x => { delete x.token; delete x.seat; if (why === 'cancelled') x.cancelled = true; if (why === 'expired') x.expired = true; else delete x.licence; }); }

  return {
    kind: 'web',
    get play() { return !!read().play; },
    state: async () => { await status(false); return state(); },
    onChange: cb => { listeners.add(cb); return () => listeners.delete(cb); },
    buy: async () => { if (!read().play) window.open('/buy', '_blank', 'noopener'); return true; },
    code: async () => '',
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
      update(x => { x.token = b.token; x.licence = b.licence; x.checked = x.tried = now(); delete x.cancelled; delete x.expired; delete x.seat; });
      if (read().play) { const sr = await seat(); if (sr.full) return { ...state(), full: sr }; }
      return state();
    },
    // The Play app, when its licence is full: move the place from another device (its tag).
    seat: async release => { const r = await seat(release); return r.full ? { error: 'full', ...r } : r.error ? r : r.offline ? { ...state(), offline: true } : state(); },
    // Background: about once a day, and "Try again".
    recheck: async (force = false) => {
      await status(force);
      const s = read(), t = now();
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
      if (s2.play && s2.token) {
        const t2 = now(), wait = s2.seat === 'ok' ? null : s2.seat ? DAY : 3600e3; // on the list: weekly; moved off or full: daily; not yet: hourly
        const due = force || (wait === null ? t2 - (s2.seatChecked || 0) > SEAT_EVERY : t2 - (s2.seatTried || 0) > wait) || t2 < (s2.seatTried || 0);
        if (due) await seat();
      }
      return state();
    },
    // Sign out (the Play app also gives back its place, which needs the internet).
    release: async () => {
      const s = read();
      if (s.play && s.seat === 'ok' && s.token) {
        let r; try { r = await call('release', { token: s.token, install: s.install }); } catch { r = null; }
        if (!r || (r.status !== 200 && r.status !== 404 && r.status !== 400)) return { error: 'Vdex could not reach the licence server. Connect to the internet and try again, so this phone\'s place can go to another device.' };
      }
      update(x => { delete x.token; delete x.licence; delete x.seat; delete x.cancelled; delete x.expired; });
      return state();
    },
  };
}

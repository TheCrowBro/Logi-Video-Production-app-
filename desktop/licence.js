// The desktop app's licence: a 30-day trial, then a licence code (bought for 20 USD, or a free one from the owner).
// A code covers up to 3 computers: the first time a code is used on a computer, Vdex activates it online at
// vdex.crowmade.app, which keeps a list of the computers using each code (a random ID made for this install and
// "Mac", "Windows" or "Linux"; nothing about the person or the hardware). After that Vdex checks about once a week
// that this computer is still on the list, and needs the internet at least once every 90 days.
//
// Everything else is decided here, offline: the code's signature, the trial clock, and what the page may do. When the
// trial is over and there is no working code, the page becomes read-only (see js/licence.js).
//
// A code entered while the licence server cannot be reached is kept and lets Vdex be edited for 14 days, once: when
// that wait began is remembered for each code, for good (also after "Remove the code", and in the copy beside the
// trial's start), so entering the code again starts no new wait. Until this computer has been added to the code's list
// online, the code is not a licence for anything else (cloud storage, backup and spreadsheet files: js/licence.js).
//
// Installs that ran Vdex before it was sold keep it free: while the app has no licence keys built in
// (desktop/licence-keys.json is empty) nobody is asked for a code, and every install that runs in that time, or that
// already has Vdex data from an earlier version, is marked as an early user and never asked.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const codes = require('./licence-codes.js');
const KEYS = require('./licence-keys.json');

const TRIAL_DAYS = 30;
const DAY = 86400e3, HOUR = 3600e3;
const RECHECK = 7 * DAY;          // a licensed computer confirms it is still on the code's list about once a week
const OFFLINE_LIMIT = 90 * DAY;   // and has to reach the internet at least once in 90 days
const PENDING_LIMIT = 14 * DAY;   // a code entered with no connection lets Vdex be edited for 14 days, once, before it must be activated
const SITE = 'https://vdex.crowmade.app';
const OS = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' };

const MESSAGES = {
  cancelled: 'This code has been cancelled, for example after a refund. If you think that is a mistake, reply to the email your code came in.',
  swaps: 'This code has been moved between devices 3 times in the last 30 days, so it cannot move again yet. Reply to the email your code came in and we will sort it out.',
  invalid: 'The licence server does not recognise this code. Check you copied all of it, or reply to the email your code came in.',
};

// `mirror` keeps a copy of when the trial started (and whether this is an early user), of when each code's wait began,
// and of when a licence stopped covering this computer, outside licence.json, in the desktop app's own window-state
// file, so deleting licence.json does not start a new trial, make an early user, give a code a second wait or lose
// that day. Nothing in either copy is sent anywhere.
const NO_MIRROR = { get: () => null, set: () => {} };
const newInstall = () => codes.b64u.enc(globalThis.crypto.getRandomValues(new Uint8Array(16))); // a random ID for this install
function createLicence({ dir, keys = KEYS, now = () => Date.now(), post, site = SITE, os = OS[process.platform] || 'Computer', priorData = () => false, mirror = NO_MIRROR, onChange = () => {} }) {
  const file = path.join(dir, 'licence.json');
  const enabled = Object.keys(keys || {}).length > 0;
  // What could not be written (a full disk, a folder that cannot be written to) is held here for the rest of this run, so
  // a turn or an install ID the licence server has just given is not forgotten: the next check would look like a copy's.
  let held = null;
  const read = () => { if (held) return JSON.parse(held); try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
  const write = s => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); held = null; return true; } catch { held = JSON.stringify(s); return false; } };
  // licence.json and, beside it, the copy of what must outlive it. An early user is one in both: the copy is never raised
  // to one by licence.json (edited), and licence.json follows the copy when the copy says no.
  const notFounder = () => { const m = enabled && mirror.get(); return !!m && Number.isFinite(m.first) && m.first > 0 && m.founder !== true; };
  const save = s => { if (s.founder && notFounder()) s.founder = false; write(s); if (Number.isFinite(s.first)) mirror.set({ first: s.first, founder: !!s.founder, seen: s.seen, ...(s.waits ? { waits: s.waits } : {}), ...(lapsedOf(s) ? { lapsed: s.lapsed } : {}) }); };
  // The latest time this computer has ever shown: winding the clock back gains no trial days and no waiting days.
  const clock = (s, t = now()) => Math.max(t, s.seen || 0);
  // When the wait of the code with this ref began (0: it never waited here). `waits` is { ref: time }, kept for good.
  const waitsOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, t]) => /^\d{1,3}:\d{1,10}$/.test(k) && Number.isFinite(t) && t > 0)) : {});
  const waitOf = (s, ref) => waitsOf(s.waits)[ref] || 0;
  const startWait = (s, ref, t) => { const w = waitsOf(s.waits); w[ref] = Math.min(w[ref] || Infinity, t); s.waits = w; };
  // The waits in both copies, each at its earliest: a wait missing from either copy is taken from the other.
  const bothWaits = (a, b) => { const w = waitsOf(a); for (const [k, t] of Object.entries(waitsOf(b))) w[k] = Math.min(w[k] || Infinity, t); return w; };
  const lapsedOf = s => (Number.isFinite(s.lapsed) && s.lapsed > 0 ? s.lapsed : 0);
  const receiptOk = new Map(); // a receipt's signature -> its value when it is good for this code and computer, else null (checked once per run)
  // When a check made in this run last failed (no answer, or not one to use): kept here, where no edit of licence.json
  // reaches it, for the 90 days without a check.
  let failedAt = 0;
  let last = '';
  // One check or activation at a time: two at once would send the same turn, and the second would look like a copy's.
  let queue = Promise.resolve();
  const inTurn = fn => { const p = queue.then(fn, fn); queue = p.then(() => {}, () => {}); return p; };

  // The licence as the page sees it. Never throws.
  async function state() {
    const s = read(), t = now();
    let dirty = false;
    if (!s.install) { s.install = newInstall(); dirty = true; }
    const m = mirror.get();
    if (!s.first) {
      if (m && Number.isFinite(m.first) && m.first > 0) { // licence.json was lost: the same trial, waits and lapse as before
        s.first = m.first; s.founder = !!m.founder; s.seen = Math.max(Number(m.seen) || 0, s.seen || 0);
        if (!lapsedOf(s) && lapsedOf(m)) s.lapsed = m.lapsed;
      } else { s.first = t; s.founder = !enabled || !!priorData(); }
      dirty = true;
    }
    // A code's wait is never forgotten while either copy remembers it (licence.json edited, or lost).
    const w = bothWaits(s.waits, m && m.waits);
    if (Object.keys(w).length && JSON.stringify(w) !== JSON.stringify(waitsOf(s.waits))) { s.waits = w; dirty = true; }
    if (!enabled && !s.founder) { s.founder = true; dirty = true; }
    if (s.founder && notFounder()) { s.founder = false; dirty = true; } // licence.json says early user, the copy beside it does not: edited
    // The trial began at the earlier of the two copies' times, and never later than the latest time ever seen: it lasts
    // no more than 30 days however either copy is edited.
    if (m && Number.isFinite(m.first) && m.first > 0 && m.first < s.first) { s.first = m.first; dirty = true; }
    if (t > (s.seen || 0) + 60e3 || !s.seen) { s.seen = Math.max(s.seen || 0, t); dirty = true; } // the latest time ever seen, so winding the clock back gains no trial days
    if (s.first > clock(s, t)) { s.first = clock(s, t); dirty = true; }
    // Once, on the first look with this version: a computer moved off its licence, or whose licence was cancelled, before
    // it (which kept no day for that) is taken to have learned of it now, so its 30 days of Export backup run from here.
    if (!s.v14) { if (s.act && (s.act.status === 'released' || s.act.status === 'cancelled') && !lapsedOf(s)) s.lapsed = clock(s, t); s.v14 = 1; dirty = true; }
    if (dirty) save(s);
    const r = await check(s), rv = r && s.act && s.act.status === 'active' ? await goodReceipt(s, r.licence) : null, good = !!rv;
    if (r) settle(s, r, good);
    const out = describe(s, r, t, rv);
    const sig = JSON.stringify(out); if (sig !== last) { last = sig; onChange(out); }
    return out;
  }
  // Two things state() may still have to write once the code has been read, done in one go on a fresh read of the
  // file (never on the copy read before the wait, which an enter() or recheck() may have replaced meanwhile):
  // an older version's single `enteredAt` becomes this code's wait, if the code is still waiting; and a code that was
  // active here and has now passed its end date gets the time this computer first saw that (`lapsed`, which recheck()
  // notes for a cancelled or moved one).
  function settle(s, r, good) {
    const old = !!s.enteredAt, ended = r.status === 'expired' && good && !s.lapsed;
    if (!old && !ended) return;
    const f = read(); if (f.code !== s.code) return;
    if (f.enteredAt) { if (!good) startWait(f, r.licence.ref, f.enteredAt); delete f.enteredAt; }
    if (ended && !f.lapsed) f.lapsed = clock(f);
    save(f);
    s.waits = f.waits; delete s.enteredAt; s.lapsed = f.lapsed;
  }
  async function check(s, at = s.seen) {
    if (!s.code) return null;
    try { const r = await codes.verifyCode(s.code, { keys, now: at }); return r; } catch { return null; } // a code no longer accepted (its key retired): back to the trial
  }
  // The activation receipt's value (the licence server's time on it included) when it is signed for this code and computer, else null.
  async function goodReceipt(s, lic) {
    const r = s.act && s.act.receipt; if (!r || !r.sig) return null;
    const k = JSON.stringify([r.kid, r.data, r.sig, lic.ref, s.install]);
    if (!receiptOk.has(k)) receiptOk.set(k, codes.readNote('active', r, { keys }).then(v => (!!v && v.ref === lic.ref && v.install === s.install ? v : null)));
    return receiptOk.get(k);
  }
  // When the 90 days without a check start: the licence server's time on the receipt, or the time on this computer's
  // clock when it asked (`clock`, which the server signs back as it was sent) where that is later and not later than the
  // clock is now. So a clock that is simply ahead of the right time costs nothing, and one put back since, or a time sent
  // by hand, counts from the server's time.
  const since = (rv, t) => { const at = Number(rv.at) || 0, c = rv.clock; return Number.isFinite(c) && c <= t ? Math.max(at, c) : at; };
  // Past the 90 days, and a check made after them has failed (in this run, or the last one noted in licence.json).
  const pastLimit = (s, rv, t) => {
    const a = s.act || {}, at = since(rv, t), tried = a.tried || 0;
    return clock(s, t) - at > OFFLINE_LIMIT && (failedAt > at + OFFLINE_LIMIT || (tried > at + OFFLINE_LIMIT && tried > (a.checked || 0)));
  };
  function trialLeft(s) { return Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - Math.floor(((s.seen || 0) - Math.min(s.first || 0, s.seen || 0)) / DAY))); }
  // The trial's last day, as the date where this computer is.
  const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // rv: the activation receipt's value, when it is good for this code and computer.
  function describe(s, r, t, rv) {
    const good = !!rv;
    const base = { enabled, buyUrl: site + '/buy', os, seats: codes.SEATS };
    if (!enabled) return { ...base, mode: 'off', canEdit: true };
    if (s.founder) return { ...base, mode: 'founder', canEdit: true };
    const left = trialLeft(s);
    const trial = { trialLeft: left, trialEnds: localDay(new Date((s.first || t) + TRIAL_DAYS * DAY)) };
    // lapsedAt: when this computer learned that a licence it was on no longer covers it (past its end date, cancelled,
    // or its place moved to another device). It stays, also after "Remove the code", until a code is activated here
    // again, and is absent when no licence that covered this computer has ended that way.
    const lapsed = lapsedOf(s) ? { lapsedAt: s.lapsed } : {};
    if (!r) return { ...base, ...trial, ...lapsed, mode: left > 0 ? 'trial' : 'ended', canEdit: left > 0 };
    const l = r.licence, licence = { name: l.name, email: l.email, comp: l.comp, ref: l.ref, issued: l.issued, expires: l.expires, seats: l.seats };
    const a = s.act || {};
    if (r.status === 'expired') return { ...base, ...trial, licence, ...lapsed, mode: 'expired', canEdit: left > 0 };
    if (a.status === 'cancelled') return { ...base, ...trial, licence, ...lapsed, mode: 'cancelled', canEdit: left > 0 };
    if (a.status === 'released') return { ...base, ...trial, licence, ...lapsed, mode: 'released', canEdit: left > 0 }; // this computer's place was moved: not on the licence
    // Past a limit, Vdex turns read-only only once a check made after the limit has failed, so someone opening Vdex
    // after a long break is not shown read-only while it is still checking. The 90 days run from the time on the receipt
    // (since(); each check brings a new one), by the latest time this computer has seen, and the failed check is one
    // made in this run or the last one noted in licence.json.
    if (a.status === 'active' && good) return pastLimit(s, rv, t) ? { ...base, licence, mode: 'offline', canEdit: false } : { ...base, licence, mode: 'licensed', canEdit: true };
    // Waiting: the code has not been activated on this computer. Its 14 days run from the first time it waited here,
    // by the latest time ever seen, and a code that never waited here (an activation that cannot be believed) has none.
    // After them Vdex turns read-only once a try made after them has failed (`late`, or the try's own time, which is
    // all an older version noted), not while it is still trying.
    const began = waitOf(s, l.ref) || s.enteredAt || 0;
    const daysLeft = began ? Math.max(0, Math.ceil((PENDING_LIMIT - Math.max(0, clock(s, t) - began)) / DAY)) : 0;
    const late = !!a.late || (a.tried || 0) > began + PENDING_LIMIT;
    return { ...base, ...trial, licence, ...lapsed, mode: 'pending', daysLeft, canEdit: daysLeft > 0 || left > 0 || !late };
  }
  // A try that did not activate a waiting code: noted, with whether the code's 14 days were already over.
  const failed = (s, ref, a, t, answered) => ({ ...a, tried: t, answered: !!answered, ...(clock(s, t) - (waitOf(s, ref) || s.enteredAt || 0) > PENDING_LIMIT ? { late: true } : {}) });

  // Asks the licence server to put this computer on the code's list. { ok, receipt, turn } | { full, computers } |
  // { cancelled } | { swaps } | { invalid } | { stale } | { offline } (with answered: true when the server did answer,
  // unusably). `turn`: the random value the server gave this computer at its last check, which changes at each one.
  // `than`: the licence server's time on the receipt kept now. Only a newer receipt is a check that got through: one
  // kept from before and played back is not.
  async function activate(code, install, release, turn = '', than = 0) {
    let res;
    try { res = await post(site + '/licence/activate', { code, install, os, turn, clock: now(), ...(release ? { release } : {}) }); } catch { return { offline: true }; }
    const b = (res && res.body) || {};
    if (res.status === 200 && b.receipt) {
      const v = await codes.readNote('active', b.receipt, { keys });
      const r = await check({ code, seen: now() });
      return v && r && v.ref === r.licence.ref && v.install === install && Number(v.at) > than ? { ok: true, receipt: b.receipt, turn: typeof b.turn === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.turn) ? b.turn : '' } : { offline: true, answered: true }; // an answer we cannot trust counts as no answer
    }
    if (b.error === 'full') return { full: true, computers: Array.isArray(b.computers) ? b.computers.slice(0, 20) : [], swapsLeft: b.swapsLeft };
    if (b.error === 'cancelled' || b.error === 'swaps' || b.error === 'invalid' || b.error === 'stale') return { [b.error]: true };
    return { offline: true, answered: true }; // the server is down, not set up yet, or says the code has ended
  }
  // The new ID noted for this code and not yet answered for (below), or ''.
  const nextOf = (s, code) => (s.next && typeof s.next === 'object' && s.next.code === code && typeof s.next.install === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s.next.install) ? s.next.install : '');
  // The same for this computer, with the turn it was last given. An out-of-date turn means another computer is running
  // a copy of this installation (licence.json copied with it), or an answer was lost on the way: the server has taken
  // this install off the list, and this computer asks again under a new random ID. So a copy needs a place of its own,
  // and a computer whose answer was lost gets its place back at once. The new ID becomes this computer's only once the
  // server has answered for it: until then the old ID and its receipt stay. It is noted for the code before it is asked
  // for (`next`), and while it is noted each check asks for it again, not for the old ID (already off the list) or yet
  // another new one, and Remove the code releases it too. So an answer lost on the way leaves no place that nothing
  // frees: a noted ID the server did list is taken off when it is asked for again without its turn ('stale'), and is
  // then asked for once more.
  // While licence.json cannot be written (a full disk), nothing is asked: the new turn could not be kept, so the next
  // check, or the next start, would look like a copy's and take another place. The receipt kept counts meanwhile.
  async function activateHere(code, release) {
    if (!write(read())) return { offline: true };
    const s = read(), mine = s.code === code && s.act ? s.act : {}, turn = typeof mine.turn === 'string' ? mine.turn : '';
    const kept = mine.receipt ? await codes.readNote('active', mine.receipt, { keys }).catch(() => null) : null, than = (kept && Number(kept.at)) || 0;
    const noted = nextOf(s, code);
    let a = noted ? { stale: true } : await activate(code, s.install, release, turn, than);
    if (a.stale) {
      const fresh = noted || newInstall();
      if (!noted) { const s1 = read(); s1.next = { code, install: fresh }; save(s1); }
      a = await activate(code, fresh, release, '', than);
      if (a.stale && noted) a = await activate(code, fresh, release, '', than); // listed by an answer that was lost, and off the list now
      if (a.stale) a = { offline: true, answered: true };
      if (a.ok || a.full || a.cancelled) { const s2 = read(); s2.install = fresh; delete s2.next; if (s2.act) delete s2.act.turn; save(s2); }
    }
    return a;
  }
  const active = (receipt, t, turn) => ({ status: 'active', receipt, checked: t, tried: t, ...(turn ? { turn } : {}) });

  // Checks a pasted code and activates it on this computer. Returns the new state, or { error } / { error: 'full', computers }.
  function enter(text, opts) { return inTurn(() => enterNow(text, opts)); }
  async function enterNow(text, { release } = {}) {
    let r;
    try { r = await codes.verifyCode(String(text || '').slice(0, 4000), { keys, now: now() }); } catch (e) { return { error: e.message || 'This code is not valid.' }; }
    if (r.status === 'expired') return { error: `This code ended on ${r.licence.expires}.` };
    const code = r.licence.code, ref = r.licence.ref;
    await state(); // makes the install's ID, and tidies what an older version left
    const a = await activateHere(code, typeof release === 'string' ? release.slice(0, 64) : '');
    if (a.full) return { error: 'full', computers: a.computers, swapsLeft: a.swapsLeft, seats: r.licence.seats };
    for (const k of ['cancelled', 'swaps', 'invalid']) if (a[k]) return { error: MESSAGES[k] };
    const s2 = read(), t = now();
    if (s2.code !== code || !s2.act) { s2.code = code; s2.act = {}; }
    if (a.ok) { s2.act = active(a.receipt, t, a.turn); delete s2.lapsed; }
    else if (s2.act.status) s2.act = { ...s2.act, tried: t, answered: !!a.answered }; // the same code again: on the list, moved off it or cancelled, as it was
    else { startWait(s2, ref, clock(s2, t)); s2.act = failed(s2, ref, s2.act, t, a.answered); } // the wait begins now, unless this code has waited here before
    save(s2);
    return { ...(await state()), offline: !a.ok };
  }

  // Background check: a licensed computer about once a week; one that cannot get through, about once an hour until it
  // does; one moved off the list, cancelled, or answered with an error, once a day. A code past its end date is not
  // checked at all. `force` checks now (the page's "Try again").
  function recheck(force = false) { return inTurn(() => recheckNow(force)); }
  async function recheckNow(force) {
    const s = read(); if (!enabled || s.founder || !s.code) return state();
    const a = s.act || {}, t = now(), r = await check(s, Math.max(s.seen || 0, t));
    if (!r || r.status === 'expired') return state();
    const was = a.status === 'active' ? await goodReceipt(s, r.licence) : null; // on the code's list until now
    let due;
    if (force || t < (a.tried || 0) || t < (a.checked || 0)) due = true; // asked to, or the clock went back
    // Read-only for want of a check (back after 90 days without one, and reopened within the hour): at once.
    else if (a.status === 'active' && was && pastLimit(s, was, t)) due = true;
    // On the list: about once a week, by the time on the receipt as well as the time noted here.
    else if (a.status === 'active') due = (t - (a.checked || 0) > RECHECK || !was || clock(s, t) - since(was, t) > RECHECK) && t - (a.tried || 0) > (a.answered ? DAY : HOUR);
    else due = t - (a.tried || 0) > (a.status || a.answered ? DAY : HOUR);
    if (!due) return state();
    const res = await activateHere(s.code, '');
    const s2 = read(); if (s2.code !== s.code) return state(); // changed while we waited
    const t2 = now();
    failedAt = res.offline ? t2 : res.ok ? 0 : failedAt; // a check that got through is no failure, whatever came before it
    if (res.ok) { s2.act = active(res.receipt, t2, res.turn); delete s2.lapsed; }
    else if (res.full || res.cancelled) {
      s2.act = { status: res.full ? 'released' : 'cancelled', tried: t2 };
      if (was) s2.lapsed = clock(s2, t2); // on the list until now: this is when the computer learned it no longer is
    }
    else s2.act = was || a.status === 'released' || a.status === 'cancelled' ? { ...a, tried: t2, answered: !!res.answered } : failed(s2, r.licence.ref, a, t2, res.answered); // offline, or an answer to look at again later
    save(s2);
    return state();
  }

  // Takes the code off this computer, freeing its place for another one. Needs the internet, except when the
  // computer was never on the list.
  function release() { return inTurn(releaseNow); }
  async function releaseNow() {
    await state(); // tidies what an older version left, so the code's wait is remembered past this
    const s = read(); if (!s.code) return state();
    const listed = s.act && (s.act.status === 'active' || s.act.status === 'released'), noted = nextOf(s, s.code);
    // This computer's ID when it is on the list, and a new ID noted for the code, which the server may have listed.
    for (const install of [...(listed ? [s.install] : []), ...(noted ? [noted] : [])]) {
      let res; try { res = await post(site + '/licence/release', { code: s.code, install }); } catch { res = null; }
      if (!res || (res.status !== 200 && res.status !== 404)) return { error: 'Vdex could not reach the licence server. Connect to the internet and try again, so the code can be used on another computer.' };
    }
    const s2 = read(); delete s2.code; delete s2.act; delete s2.next; save(s2); // `waits` and `lapsed` stay: a code's 14 days do not start again when it is entered again
    return state();
  }
  const code = () => read().code || '';

  return { state, enter, recheck, release, code, file, enabled };
}

// POST JSON with Chromium's network stack (it uses the system's proxy settings), giving up after 15 seconds.
function netPost(url, body) {
  const { net } = require('electron');
  return net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15e3) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

// The price with tax where this computer is (GET /licence/price: the server answers from the request's country), for
// the Buy button. Only the shape the page uses is passed on; anything else, or no answer within 10 seconds, is null.
function netPrice(url) {
  const { net } = require('electron');
  return net.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10e3) }).then(r => (r.ok ? r.json() : null)).then(b => {
    if (!b || typeof b !== 'object') return null; // no answer (offline, or an error): the page asks again later
    const t = b.taxed;
    return { taxed: t && typeof t === 'object' ? { place: String(t.place || '').slice(0, 40), tax: String(t.tax || '').slice(0, 8), rate: Number(t.rate) || 0, total: String(t.total || '').slice(0, 10) } : null };
  }).catch(() => null);
}

// Called from main.js before the window opens: hasPriorData must be read before this run creates any data.
function wireLicence({ ipcMain, fromApp, getWindow, shell, dir, hasPriorData, mirror, site }) {
  const send = s => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('licence:changed', s); };
  const prior = hasPriorData();
  const lic = createLicence({ dir, post: netPost, priorData: () => prior, mirror: mirror || NO_MIRROR, onChange: send, ...(site ? { site } : {}) });
  const guard = fn => (e, ...args) => (fromApp(e) ? fn(...args) : { error: 'refused' });
  ipcMain.handle('licence:state', guard(() => lic.state()));
  ipcMain.handle('licence:enter', guard((text, opts) => lic.enter(text, opts && typeof opts === 'object' ? { release: opts.release } : {})));
  ipcMain.handle('licence:recheck', guard(() => lic.recheck(true)));
  ipcMain.handle('licence:release', guard(() => lic.release()));
  ipcMain.handle('licence:code', guard(() => lic.code()));
  ipcMain.handle('licence:buy', guard(() => { shell.openExternal((site || SITE) + '/buy'); return true; }));
  ipcMain.handle('licence:price', guard(() => netPrice((site || SITE) + '/licence/price')));
  lic.state().catch(() => {});
  const tick = () => lic.recheck(false).catch(() => {});
  setTimeout(tick, 1500); // straight away, so a computer back after a long break is confirmed before anyone notices
  setInterval(tick, HOUR);
  return lic;
}

module.exports = { createLicence, wireLicence, TRIAL_DAYS, RECHECK, OFFLINE_LIMIT, PENDING_LIMIT, SITE };

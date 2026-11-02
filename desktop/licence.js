// The desktop app's licence: a 30-day trial, then a licence code (bought for 20 USD, or a free one from the owner).
// A code covers up to 3 computers: the first time a code is used on a computer, Vdex activates it online at
// vdex.crowmade.app, which keeps a list of the computers using each code (a random ID made for this install and
// "Mac", "Windows" or "Linux"; nothing about the person or the hardware). After that Vdex checks about once a week
// that this computer is still on the list, and needs the internet at least once every 90 days.
//
// Everything else is decided here, offline: the code's signature, the trial clock, and what the page may do. When the
// trial is over and there is no working code, the page becomes read-only (see js/licence.js).
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
const PENDING_LIMIT = 14 * DAY;   // a code entered with no connection works for 14 days before it must be activated
const SITE = 'https://vdex.crowmade.app';
const OS = { darwin: 'Mac', win32: 'Windows', linux: 'Linux' };

const MESSAGES = {
  cancelled: 'This code has been cancelled, for example after a refund. If you think that is a mistake, reply to the email your code came in.',
  swaps: 'This code has been moved between computers 3 times in the last 30 days, so it cannot move again yet. Reply to the email your code came in and we will sort it out.',
  invalid: 'The licence server does not recognise this code. Check you copied all of it, or reply to the email your code came in.',
};

// `mirror` keeps a copy of when the trial started (and whether this is an early user) outside licence.json, in the
// desktop app's own window-state file, so deleting licence.json does not start a new trial or make an early user.
const NO_MIRROR = { get: () => null, set: () => {} };
function createLicence({ dir, keys = KEYS, now = () => Date.now(), post, site = SITE, os = OS[process.platform] || 'Computer', priorData = () => false, mirror = NO_MIRROR, onChange = () => {} }) {
  const file = path.join(dir, 'licence.json');
  const enabled = Object.keys(keys || {}).length > 0;
  const read = () => { try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
  const write = s => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(s)); fs.renameSync(file + '.tmp', file); } catch { /* a read-only disk: carry on */ } };
  const receiptOk = new Map(); // a receipt's signature -> whether it is good for this code and computer (checked once per run)
  let last = '';

  // The licence as the page sees it. Never throws.
  async function state() {
    const s = read(), t = now();
    let dirty = false;
    if (!s.install) { s.install = codes.b64u.enc(globalThis.crypto.getRandomValues(new Uint8Array(16))); dirty = true; }
    if (!s.first) {
      const m = mirror.get();
      if (m && Number.isFinite(m.first) && m.first > 0) { s.first = m.first; s.founder = !!m.founder; s.seen = Math.max(Number(m.seen) || 0, s.seen || 0); } // licence.json was lost: same trial as before
      else { s.first = t; s.founder = !enabled || !!priorData(); }
      dirty = true;
    }
    if (!enabled && !s.founder) { s.founder = true; dirty = true; }
    if (t > (s.seen || 0) + 60e3 || !s.seen) { s.seen = Math.max(s.seen || 0, t); dirty = true; } // the latest time ever seen, so winding the clock back gains no trial days
    if (dirty) { write(s); mirror.set({ first: s.first, founder: !!s.founder, seen: s.seen }); }
    const r = await check(s), good = !!r && !!s.act && s.act.status === 'active' && (await goodReceipt(s, r.licence));
    const out = describe(s, r, t, good);
    const sig = JSON.stringify(out); if (sig !== last) { last = sig; onChange(out); }
    return out;
  }
  async function check(s, at = s.seen) {
    if (!s.code) return null;
    try { const r = await codes.verifyCode(s.code, { keys, now: at }); return r; } catch { return null; } // a code no longer accepted (its key retired): back to the trial
  }
  async function goodReceipt(s, lic) {
    const r = s.act && s.act.receipt; if (!r || !r.sig) return false;
    const k = JSON.stringify([r.kid, r.data, r.sig, lic.ref, s.install]);
    if (!receiptOk.has(k)) receiptOk.set(k, codes.readNote('active', r, { keys }).then(v => !!v && v.ref === lic.ref && v.install === s.install));
    return receiptOk.get(k);
  }
  function trialLeft(s) { return Math.max(0, TRIAL_DAYS - Math.floor(((s.seen || 0) - (s.first || 0)) / DAY)); }
  function describe(s, r, t, good) {
    const base = { enabled, buyUrl: site + '/buy', os, seats: codes.SEATS };
    if (!enabled) return { ...base, mode: 'off', canEdit: true };
    if (s.founder) return { ...base, mode: 'founder', canEdit: true };
    const left = trialLeft(s);
    const trial = { trialLeft: left, trialEnds: new Date((s.first || t) + TRIAL_DAYS * DAY).toISOString().slice(0, 10) };
    if (!r) return { ...base, ...trial, mode: left > 0 ? 'trial' : 'ended', canEdit: left > 0 };
    const l = r.licence, licence = { name: l.name, email: l.email, comp: l.comp, ref: l.ref, issued: l.issued, expires: l.expires, seats: l.seats };
    if (r.status === 'expired') return { ...base, ...trial, licence, mode: 'expired', canEdit: left > 0 };
    const a = s.act || {};
    if (a.status === 'cancelled') return { ...base, ...trial, licence, mode: 'cancelled', canEdit: left > 0 };
    if (a.status === 'released') return { ...base, ...trial, licence, mode: 'released', canEdit: left > 0 };
    // Past a limit, Vdex turns read-only only once a check made after the limit has failed, so someone opening Vdex
    // after a long break is not shown read-only while it is still checking.
    if (a.status === 'active' && good) {
      if (t - (a.checked || 0) > OFFLINE_LIMIT && (a.tried || 0) > (a.checked || 0) + OFFLINE_LIMIT) return { ...base, licence, mode: 'offline', canEdit: false };
      return { ...base, licence, mode: 'licensed', canEdit: true };
    }
    const waited = Math.max(0, t - (s.enteredAt || t)), daysLeft = Math.max(0, Math.ceil((PENDING_LIMIT - waited) / DAY));
    const failedSince = (a.tried || 0) > (s.enteredAt || 0) + PENDING_LIMIT;
    return { ...base, ...trial, licence, mode: 'pending', daysLeft, canEdit: daysLeft > 0 || left > 0 || !failedSince };
  }

  // Asks the licence server to put this computer on the code's list. { ok, receipt } | { full, computers } |
  // { cancelled } | { swaps } | { invalid } | { offline } (with answered: true when the server did answer, unusably).
  async function activate(code, install, release) {
    let res;
    try { res = await post(site + '/licence/activate', { code, install, os, ...(release ? { release } : {}) }); } catch { return { offline: true }; }
    const b = (res && res.body) || {};
    if (res.status === 200 && b.receipt) {
      const v = await codes.readNote('active', b.receipt, { keys });
      const r = await check({ code, seen: now() });
      return v && r && v.ref === r.licence.ref && v.install === install ? { ok: true, receipt: b.receipt } : { offline: true, answered: true }; // an answer we cannot trust counts as no answer
    }
    if (b.error === 'full') return { full: true, computers: Array.isArray(b.computers) ? b.computers.slice(0, 20) : [], swapsLeft: b.swapsLeft };
    if (b.error === 'cancelled' || b.error === 'swaps' || b.error === 'invalid') return { [b.error]: true };
    return { offline: true, answered: true }; // the server is down, not set up yet, or says the code has ended
  }
  const active = (receipt, t) => ({ status: 'active', receipt, checked: t, tried: t });

  // Checks a pasted code and activates it on this computer. Returns the new state, or { error } / { error: 'full', computers }.
  async function enter(text, { release } = {}) {
    let r;
    try { r = await codes.verifyCode(String(text || '').slice(0, 4000), { keys, now: now() }); } catch (e) { return { error: e.message || 'This code is not valid.' }; }
    if (r.status === 'expired') return { error: `This code ended on ${r.licence.expires}.` };
    const s = read(), code = r.licence.code;
    if (!s.install) await state();
    const install = read().install;
    const a = await activate(code, install, typeof release === 'string' ? release.slice(0, 64) : '');
    if (a.full) return { error: 'full', computers: a.computers, swapsLeft: a.swapsLeft, seats: r.licence.seats };
    for (const k of ['cancelled', 'swaps', 'invalid']) if (a[k]) return { error: MESSAGES[k] };
    const s2 = read(), t = now();
    if (s2.code !== code) { s2.code = code; s2.enteredAt = t; s2.act = {}; }
    s2.act = a.ok ? active(a.receipt, t) : { ...(s2.act || {}), tried: t, answered: !!a.answered };
    write(s2);
    return { ...(await state()), offline: !a.ok };
  }

  // Background check: a licensed computer about once a week; one that cannot get through, about once an hour until it
  // does; one moved off the list, cancelled, or answered with an error, once a day. A code past its end date is not
  // checked at all. `force` checks now (the page's "Try again").
  async function recheck(force = false) {
    const s = read(); if (!enabled || s.founder || !s.code) return state();
    const a = s.act || {}, t = now(), r = await check(s, Math.max(s.seen || 0, t));
    if (!r || r.status === 'expired') return state();
    let due;
    if (force || t < (a.tried || 0) || t < (a.checked || 0)) due = true; // asked to, or the clock went back
    else if (a.status === 'active') due = t - (a.checked || 0) > RECHECK && t - (a.tried || 0) > (a.answered ? DAY : HOUR);
    else due = t - (a.tried || 0) > (a.status || a.answered ? DAY : HOUR);
    if (!due) return state();
    const res = await activate(s.code, s.install, '');
    const s2 = read(); if (s2.code !== s.code) return state(); // changed while we waited
    const t2 = now();
    if (res.ok) s2.act = active(res.receipt, t2);
    else if (res.full) s2.act = { status: 'released', tried: t2 };
    else if (res.cancelled) s2.act = { status: 'cancelled', tried: t2 };
    else s2.act = { ...a, tried: t2, answered: !!res.answered }; // offline, or an answer to look at again later
    write(s2);
    return state();
  }

  // Takes the code off this computer, freeing its place for another one. Needs the internet, except when the
  // computer was never on the list.
  async function release() {
    const s = read(); if (!s.code) return state();
    const listed = s.act && (s.act.status === 'active' || s.act.status === 'released');
    if (listed) {
      let res; try { res = await post(site + '/licence/release', { code: s.code, install: s.install }); } catch { res = null; }
      if (!res || (res.status !== 200 && res.status !== 404)) return { error: 'Vdex could not reach the licence server. Connect to the internet and try again, so the code can be used on another computer.' };
    }
    const s2 = read(); delete s2.code; delete s2.act; delete s2.enteredAt; write(s2);
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
  lic.state().catch(() => {});
  const tick = () => lic.recheck(false).catch(() => {});
  setTimeout(tick, 1500); // straight away, so a computer back after a long break is confirmed before anyone notices
  setInterval(tick, HOUR);
  return lic;
}

module.exports = { createLicence, wireLicence, TRIAL_DAYS, RECHECK, OFFLINE_LIMIT, PENDING_LIMIT, SITE };

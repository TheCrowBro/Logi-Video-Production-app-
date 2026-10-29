// App lock: a PIN, plus fingerprint / face / Windows Hello where the device offers it, and a vault that keeps the
// database and sign-in secrets encrypted (AES-256-GCM) whenever the app is locked, in the background or closed.
// A random data key encrypts the vault; the PIN (through PBKDF2) and the biometric each hold a wrapped copy of it.
import { h, toast, announce, nodes, sheet } from './util.js';
import * as store from './store.js';
import * as C from './crypto.js';
import { haptic } from './a11y.js';

const CFG = 'logi-lock', VAULT = 'logi-vault', DB = 'logi-db-v1';
const SEALED = ['logi-dbx-token', 'logi-webdav', 'logi-loc', 'logi-wx']; // secrets and private settings that live outside the database
export const AUTO_LOCK = [[0, 'Straight away'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [-1, 'Only when Vdex is closed']];
const WAITS = [[12, 900], [9, 300], [7, 60], [5, 30]]; // wrong attempts → seconds before the next try
export const WIPE_AT = 10;

const S = { cfg: null, key: null, raw: null, locked: false, screen: null, hiddenAt: 0, timer: null, vaultRev: -1, extras: {}, extrasJson: '', pending: null, op: Promise.resolve(), resolveBoot: null, listeners: new Set(), entry: '', checking: false, keys: null };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
const readCfg = () => { try { const c = JSON.parse(lsGet(CFG)); return c && c.pin ? c : null; } catch { return null; } };
const saveCfg = c => { S.cfg = c; lsSet(CFG, c ? JSON.stringify(c) : null); S.listeners.forEach(f => f()); };
const chain = fn => { S.op = S.op.then(fn).catch(e => console.warn('lock:', e)); return S.op; };
export const enabled = () => !!S.cfg;
export const isLocked = () => S.locked;
export const config = () => S.cfg;
export const onChange = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };

/* ----------------------------------- vault ----------------------------------- */
const sealedKeys = () => { const ks = [...SEALED]; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('msal.')) ks.push(k); } } catch { /* ignore */ } return ks; };
const extrasNow = () => { const o = {}; for (const k of sealedKeys()) { const v = lsGet(k); if (v != null) o[k] = v; } return o; };

async function writeVault(force = false) {
  if (!S.key) return;
  const rev = store.revision();
  if (!store.isSealed()) { S.extras = extrasNow(); S.extrasJson = JSON.stringify(S.extras); } // while sealed the plaintext copies are gone: keep what we had
  if (!force && S.vaultRev === rev && lsGet(VAULT)) return;
  const db = store.serialize();
  const box = await C.encrypt(S.key, JSON.stringify({ db, extras: S.extras }));
  lsSet(VAULT, JSON.stringify({ v: 1, iv: box.iv, ct: box.ct }));
  S.vaultRev = rev; S.lastDb = db;
}
const scheduleVault = () => { if (!S.key) return; clearTimeout(S.pending); S.pending = setTimeout(() => chain(() => writeVault()), 200); };

// The app is hidden or locked: drop the plaintext copies. When the vault already holds exactly what is on disk this
// is synchronous, which matters on the way out of a page, where nothing asynchronous gets to finish.
function sealSync() {
  if (!S.key || store.isSealed()) return true;
  const current = lsGet(VAULT) && store.serialize() === S.lastDb && JSON.stringify(extrasNow()) === S.extrasJson;
  if (!current) return false;
  for (const k of [DB, ...sealedKeys()]) lsSet(k, null);
  store.setSealed(true);
  return true;
}
async function seal() {
  if (sealSync()) return;
  clearTimeout(S.pending);
  await writeVault(true);
  if (store.isSealed()) return;
  for (const k of [DB, ...sealedKeys()]) lsSet(k, null);
  store.setSealed(true);
}
const sealSoon = () => { if (!sealSync()) chain(seal); };

const dbTime = text => { try { return Number(JSON.parse(text).updatedAt) || 0; } catch { return 0; } };
// Put the plaintext copies back. While the app runs, the copy in memory wins; at boot the newest copy wins.
async function unseal(boot = false) {
  if (!S.key || S.unloading) return;
  const raw = lsGet(VAULT);
  if (raw) {
    const { db, extras } = JSON.parse(await C.decryptText(S.key, JSON.parse(raw)));
    if (S.unloading) return; // the page went away while decrypting: leave the storage sealed
    S.extras = extras || {}; S.extrasJson = JSON.stringify(S.extras); S.lastDb = db;
    for (const [k, v] of Object.entries(S.extras)) if (lsGet(k) == null) lsSet(k, v);
    if (boot) { const have = lsGet(DB); if (have == null || dbTime(db) > dbTime(have)) lsSet(DB, db); }
  }
  store.setSealed(false); // writes anything saved while sealed
  if (boot) store.reload(); else if (lsGet(DB) == null) store.flush();
  if (store.serialize() !== S.lastDb) await writeVault(true); // a normalised reload or edits made while sealed: keep the vault exact so sealing stays synchronous
  if (!boot && (document.hidden || S.locked)) sealSoon(); // hidden or locked again meanwhile
}

/* ------------------------------------ PIN ------------------------------------ */
const kdf = (pin, c) => C.pbkdf2Key(pin, C.fromB64(c.salt), c.iter);
async function openWithPin(pin, c = S.cfg) { try { return await C.decrypt(await kdf(pin, c), c.pin); } catch { return null; } }
async function adopt(raw) { S.raw = raw; S.key = await C.importAesKey(raw); }

export async function setPin(pin) { // first PIN makes a new data key; a later one re-wraps the same key
  const raw = S.raw || C.bytes(32);
  const salt = C.bytes(16), iter = C.PBKDF2_ITERATIONS;
  const wrap = await C.encrypt(await C.pbkdf2Key(pin, salt, iter), raw);
  await adopt(raw);
  saveCfg({ ...(S.cfg || { v: 1, autoLock: 1, wipe: false, bio: null }), salt: C.toB64(salt), iter, pin: wrap, len: pin.length, attempts: 0, until: 0 });
  await writeVault(true);
}
export async function checkPin(pin) { const raw = await openWithPin(pin); if (!raw) return false; await adopt(raw); return true; }
export async function removePin() { // the caller has just checked the PIN
  await chain(() => unseal());
  lsSet(VAULT, null); await forgetDeviceKey(); saveCfg(null); S.key = null; S.raw = null; S.vaultRev = -1;
}
export const setOption = patch => saveCfg({ ...S.cfg, ...patch });

const waitLeft = () => Math.max(0, Math.ceil((((S.cfg && S.cfg.until) || 0) - Date.now()) / 1000));
function recordFailure() {
  const attempts = (S.cfg.attempts || 0) + 1;
  const wait = (WAITS.find(([n]) => attempts >= n) || [0, 0])[1];
  saveCfg({ ...S.cfg, attempts, until: wait ? Date.now() + wait * 1000 : 0 });
  if (S.cfg.wipe && attempts >= WIPE_AT) { wipe('Too many wrong PINs: the data on this device has been erased.'); return true; }
  return false;
}
const recordSuccess = () => { if (S.cfg && (S.cfg.attempts || S.cfg.until)) saveCfg({ ...S.cfg, attempts: 0, until: 0 }); };

// Everything Vdex keeps on this device goes; the cloud copy and backup files are untouched.
export async function wipe(reason) {
  try { const keys = []; for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); keys.filter(k => k && (k.startsWith('logi-') || k.startsWith('msal.'))).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ }
  try { await new Promise(res => { const r = indexedDB.deleteDatabase('logi'); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch { /* ignore */ }
  if (reason) { try { sessionStorage.setItem('logi-wiped', reason); } catch { /* ignore */ } }
  location.reload();
}

/* --------------------------------- biometrics --------------------------------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('logi', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
async function deviceKey(create) { let k = await kv('readonly', s => s.get('lockDeviceKey')).catch(() => null); if (!k && create) { k = await C.generateDeviceKey(); await kv('readwrite', s => s.put(k, 'lockDeviceKey')); } return k || null; }
const forgetDeviceKey = () => kv('readwrite', s => s.delete('lockDeviceKey')).catch(() => {});

export async function bioAvailable() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; } }
const clientChallenge = resp => { try { return JSON.parse(C.utf8(resp.clientDataJSON)).challenge; } catch { return null; } };

function assert(bio) {
  const challenge = C.bytes(32);
  return navigator.credentials.get({ publicKey: {
    challenge, rpId: location.hostname, userVerification: 'required', timeout: 60000,
    allowCredentials: [{ type: 'public-key', id: C.fromB64url(bio.id), transports: ['internal'] }],
    extensions: bio.mode === 'prf' ? { prf: { eval: { first: C.fromB64(bio.prfSalt) } } } : undefined,
  } }).then(a => { if (clientChallenge(a.response) !== C.toB64url(challenge)) throw new Error('Biometric reply did not match'); return a; });
}

// Enrol the device's own authenticator. With the PRF extension the key is bound to the biometric itself; without it,
// the biometric gates a key kept in this app's own storage on the device.
export async function enrolBio() {
  if (!S.raw) throw new Error('Set a PIN first');
  const challenge = C.bytes(32), prfSalt = C.bytes(32);
  const cred = await navigator.credentials.create({ publicKey: {
    challenge, rp: { name: 'Vdex', id: location.hostname }, user: { id: C.bytes(16), name: 'vdex', displayName: 'Vdex' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    timeout: 60000, attestation: 'none', extensions: { prf: {} },
  } });
  if (clientChallenge(cred.response) !== C.toB64url(challenge)) throw new Error('Biometric reply did not match');
  const prf = !!(cred.getClientExtensionResults().prf || {}).enabled;
  const pub = cred.response.getPublicKey ? cred.response.getPublicKey() : null;
  const bio = { id: C.toB64url(cred.rawId), pub: pub ? C.toB64(pub) : null, alg: cred.response.getPublicKeyAlgorithm ? cred.response.getPublicKeyAlgorithm() : null, mode: prf ? 'prf' : 'device', prfSalt: C.toB64(prfSalt), wrap: null };
  if (prf) {
    const a = await assert(bio);
    const secret = ((a.getClientExtensionResults().prf || {}).results || {}).first;
    if (!secret) throw new Error('This device did not provide a biometric key');
    bio.wrap = await C.encrypt(await C.hkdfKey(secret, prfSalt, 'vdex-bio'), S.raw);
  } else bio.wrap = await C.encrypt(await deviceKey(true), S.raw);
  saveCfg({ ...S.cfg, bio });
  return bio.mode;
}
export async function forgetBio() { await forgetDeviceKey(); saveCfg({ ...S.cfg, bio: null }); }

async function unlockBio() {
  const bio = S.cfg && S.cfg.bio; if (!bio) return false;
  const a = await assert(bio);
  const authData = new Uint8Array(a.response.authenticatorData);
  if (!(authData[32] & 0x04)) throw new Error('The device did not verify you'); // user-verified flag
  let wrapKey;
  if (bio.mode === 'prf') {
    const secret = ((a.getClientExtensionResults().prf || {}).results || {}).first;
    if (!secret) throw new Error('No biometric key came back');
    wrapKey = await C.hkdfKey(secret, C.fromB64(bio.prfSalt), 'vdex-bio');
  } else {
    if (bio.pub && !(await verifyAssertion(bio, a))) throw new Error('Biometric check failed');
    wrapKey = await deviceKey(false);
    if (!wrapKey) throw new Error('The biometric key is missing on this device; use the PIN');
  }
  await adopt(await C.decrypt(wrapKey, bio.wrap));
  return true;
}
async function verifyAssertion(bio, a) {
  try {
    const spki = C.fromB64(bio.pub);
    const data = new Uint8Array([...new Uint8Array(a.response.authenticatorData), ...new Uint8Array(await C.sha256(a.response.clientDataJSON))]);
    if (bio.alg === -7) { const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(new Uint8Array(a.response.signature)), data); }
    if (bio.alg === -257) { const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, a.response.signature, data); }
    return true; // another algorithm: the authenticator's own user-verified flag is what we have
  } catch { return false; }
}
function derToRaw(sig) { // ECDSA signature: DER sequence of two integers → 64-byte r||s for WebCrypto
  let i = 2; if (sig[1] & 0x80) i += sig[1] & 0x7f;
  const int = () => { if (sig[i++] !== 0x02) throw new Error('bad signature'); let len = sig[i++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let j = 0; j < n; j++) len = (len << 8) | sig[i++]; } let v = sig.slice(i, i + len); i += len; if (v.length > 32) v = v.slice(v.length - 32); const out = new Uint8Array(32); out.set(v, 32 - v.length); return out; };
  const r = int(), s = int(); const out = new Uint8Array(64); out.set(r, 0); out.set(s, 32); return out;
}

/* ---------------------------------- lock screen ---------------------------------- */
function showLock() {
  if (S.screen) return;
  S.locked = true; S.entry = '';
  const app = document.getElementById('app');
  if (app) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
  document.querySelectorAll('.sheet-back').forEach(el => { el.inert = true; el.classList.add('behind-lock'); });
  const len = S.cfg.len || 6;
  const dots = h('div', { class: 'pin-dots', 'aria-label': 'PIN entry' });
  const msg = h('div', { class: 'lock-msg', role: 'status', 'aria-live': 'polite' });
  const forgot = h('div', { class: 'lock-forgot', hidden: true },
    h('p', { class: 'small' }, 'The PIN is the only key to the data on this device, so it cannot be recovered. You can erase this device and start again: if you linked a cloud storage or exported a backup, link it or import it afterwards and everything comes back.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('Erase all Vdex data on this device?')) wipe('This device was erased. Link your storage or import a backup to get your data back.'); } }, 'Erase this device'), h('button', { type: 'button', class: 'btn ghost', onclick: () => { forgot.hidden = true; } }, 'Keep trying')));
  const paint = () => dots.replaceChildren(...Array.from({ length: len }, (_, i) => h('i', { class: i < S.entry.length ? 'on' : '' })));
  const busy = () => S.checking || waitLeft() > 0;
  let ticker = null;
  const showWait = () => { clearInterval(ticker); const tick = () => { const left = waitLeft(); if (!left) { clearInterval(ticker); msg.textContent = 'You can try again.'; return; } msg.textContent = `Wrong PIN. Try again in ${left} s.`; }; tick(); ticker = setInterval(tick, 1000); };
  const press = d => { if (busy() || S.entry.length >= len) return; S.entry += d; haptic(8); paint(); if (S.entry.length === len) submit(); };
  const back = () => { if (busy()) return; S.entry = S.entry.slice(0, -1); paint(); };
  async function submit() {
    const pin = S.entry; S.entry = ''; paint();
    if (!pin || waitLeft() > 0) return;
    S.checking = true; msg.textContent = 'Checking…';
    const ok = await checkPin(pin);
    S.checking = false;
    if (ok) { recordSuccess(); return unlocked(); }
    haptic(60); S.screen.classList.remove('shake'); void S.screen.offsetWidth; S.screen.classList.add('shake');
    if (recordFailure()) return;
    if (waitLeft() > 0) return showWait();
    const left = S.cfg.wipe ? WIPE_AT - (S.cfg.attempts || 0) : 0;
    msg.textContent = 'Wrong PIN.' + (left > 0 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before this device is erased.` : '');
    announce(msg.textContent);
  }
  async function tryBio() {
    if (busy()) return;
    try { if (await unlockBio()) { recordSuccess(); unlocked(); } } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Biometric check cancelled. Use the PIN.' : (e.message || 'Biometric unlock failed'); }
  }
  const key = (label, fn, cls = '') => h('button', { type: 'button', class: 'key ' + cls, onclick: fn, 'aria-label': label === '⌫' ? 'Delete' : label }, label);
  const bio = !!S.cfg.bio;
  S.screen = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vdex is locked' },
    h('div', { class: 'lock-card' },
      h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'VDEX'),
      h('h1', null, 'Enter your PIN'),
      dots, msg,
      h('div', { class: 'keypad' }, ...'123456789'.split('').map(d => key(d, () => press(d))),
        bio ? h('button', { type: 'button', class: 'key soft', onclick: tryBio, 'aria-label': 'Unlock with fingerprint or face' }, '👤') : h('span', { 'aria-hidden': 'true' }),
        key('0', () => press('0')), key('⌫', back, 'soft')),
      bio && h('button', { type: 'button', class: 'btn ghost lock-bio', onclick: tryBio }, '👤 Use fingerprint or face'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => { forgot.hidden = !forgot.hidden; } }, 'Forgot PIN?'),
      forgot));
  S.keys = e => { if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { back(); e.preventDefault(); } else if (e.key === 'Enter' && S.entry.length >= 4) { submit(); e.preventDefault(); } };
  document.addEventListener('keydown', S.keys);
  document.body.append(S.screen);
  paint();
  if (waitLeft() > 0) showWait();
  const first = S.screen.querySelector('.key'); first && first.focus();
  if (bio && document.visibilityState === 'visible') setTimeout(() => tryBio(), 350);
  S.hideLock = () => { clearInterval(ticker); };
}
function hideLock() {
  if (!S.screen) return;
  S.hideLock && S.hideLock();
  document.removeEventListener('keydown', S.keys); S.keys = null;
  S.screen.remove(); S.screen = null;
  const app = document.getElementById('app');
  if (app) { app.inert = false; app.removeAttribute('aria-hidden'); }
  document.querySelectorAll('.sheet-back.behind-lock').forEach(el => { el.inert = false; el.classList.remove('behind-lock'); });
  const main = document.getElementById('page'); main && main.focus({ preventScroll: true });
}
function unlocked() {
  hideLock(); S.locked = false;
  if (S.resolveBoot) { const r = S.resolveBoot; S.resolveBoot = null; r(); }
  else chain(() => unseal());
  announce('Unlocked');
}
export function lockNow() { if (!S.cfg || S.screen) return; showLock(); sealSoon(); }

/* --------------------------------- boot & events --------------------------------- */
// Called before the app draws anything: with a PIN set, the lock screen must be passed first.
export async function gate() {
  S.cfg = readCfg();
  let wiped = null; try { wiped = sessionStorage.getItem('logi-wiped'); sessionStorage.removeItem('logi-wiped'); } catch { /* ignore */ }
  if (wiped) setTimeout(() => toast(wiped), 500);
  if (!S.cfg) { if (lsGet(VAULT)) lsSet(VAULT, null); return; }
  store.setSealed(true); // nothing is written in plain until the vault is open
  showLock();
  await new Promise(res => { S.resolveBoot = res; });
  await unseal(true);
}

export function init() {
  store.subscribe(() => { if (S.key && !store.isSealed()) scheduleVault(); });
  document.addEventListener('visibilitychange', () => {
    if (!S.cfg || S.unloading) return;
    const m = S.cfg.autoLock == null ? 1 : S.cfg.autoLock;
    clearTimeout(S.timer);
    if (document.hidden) {
      S.hiddenAt = Date.now();
      sealSoon();
      if (m === 0) S.locked = true; else if (m > 0) S.timer = setTimeout(() => { S.locked = true; }, m * 60000);
    } else {
      if (!S.locked && m > 0 && S.hiddenAt && Date.now() - S.hiddenAt >= m * 60000) S.locked = true;
      if (S.locked) showLock(); else chain(() => unseal());
    }
  });
  window.addEventListener('pagehide', () => { S.unloading = true; if (S.cfg) sealSoon(); });
  window.addEventListener('pageshow', () => { S.unloading = false; }); // back-forward cache
  // Another tab sealed the storage while this one is in use: put the plain copies back from memory and the vault.
  window.addEventListener('storage', e => { if (!S.cfg || !S.key || document.hidden || S.locked) return; if (e.key === DB && e.newValue == null) chain(() => unseal()); });
}

/* ------------------------------------ settings ------------------------------------ */
// A small sheet asking for a PIN or a passphrase, optionally typed twice. Resolves with the value or null.
export function askSecret({ title, confirm = false, numeric = true, intro = '', minLength = 4 } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = label => h('input', { type: 'password', inputMode: numeric ? 'numeric' : 'text', pattern: numeric ? '[0-9]*' : undefined, maxLength: numeric ? 8 : 128, autocomplete: numeric ? 'off' : 'new-password', 'aria-label': label, placeholder: label, class: 'pin-input' });
    const a = input(confirm ? (numeric ? 'New PIN' : 'Passphrase') : (numeric ? 'PIN' : 'Passphrase')), b = confirm ? input(numeric ? 'Repeat the PIN' : 'Repeat the passphrase') : null;
    const err = h('div', { class: 'lock-msg', role: 'alert' });
    let close = () => {};
    const submit = e => {
      e.preventDefault();
      const v = a.value;
      if (numeric ? !/^\d{4,8}$/.test(v) : v.length < minLength) { err.textContent = numeric ? 'Use 4 to 8 digits.' : `Use at least ${minLength} characters.`; return; }
      if (confirm && numeric && /^(\d)\1+$/.test(v)) { err.textContent = 'Not all the same digit, please.'; return; }
      if (b && b.value !== v) { err.textContent = numeric ? 'The two PINs differ.' : 'The two passphrases differ.'; return; }
      done = true; close(); resolve(v);
    };
    const form = h('form', { class: 'stack', onsubmit: submit },
      intro && h('p', { class: 'small muted' }, intro),
      numeric && confirm && h('p', { class: 'small muted' }, '4 to 8 digits; 6 or more is a good length. Avoid your birthday or phone number.'),
      a, b, err,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, confirm ? 'Save' : 'Continue'), h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel')));
    ({ close } = sheet(title, form, { dismissOnBackdrop: false, onClose: () => { if (!done) resolve(null); } }));
    setTimeout(() => a.focus(), 60);
  });
}

export function securityPanel() {
  const el = h('div', { class: 'stack' });
  let bioOk = null;
  bioAvailable().then(v => { bioOk = v; draw(); });
  const busyToast = (p, done) => p.then(done).catch(e => toast(e.name === 'NotAllowedError' ? 'Cancelled' : 'Could not do that: ' + (e.message || e)));
  const createPin = async () => { const pin = await askSecret({ title: 'Set a PIN', confirm: true }); if (!pin) return; await busyToast(setPin(pin), () => { toast('PIN set. Vdex now locks and encrypts its data.'); draw(); }); };
  const current = async () => { const pin = await askSecret({ title: 'Current PIN' }); if (!pin) return false; if (!(await checkPin(pin))) { toast('Wrong PIN'); return false; } return true; };
  const changePin = async () => { if (!(await current())) return; const pin = await askSecret({ title: 'New PIN', confirm: true }); if (!pin) return; await busyToast(setPin(pin), () => toast('PIN changed')); };
  const dropPin = async () => { if (!(await current())) return; if (!confirm('Remove the PIN? Vdex will no longer lock or encrypt its data on this device.')) return; await busyToast(removePin(), () => toast('PIN removed')); };
  const toggleBio = async input => {
    if (input.checked) { input.disabled = true; try { const mode = await enrolBio(); toast(mode === 'prf' ? 'Biometric unlock on' : 'Biometric unlock on (key kept on this device)'); } catch (e) { input.checked = false; toast(e.name === 'NotAllowedError' ? 'Cancelled' : 'Could not set up: ' + (e.message || e)); } input.disabled = false; }
    else await forgetBio();
    draw();
  };
  const draw = () => {
    const c = S.cfg;
    const lockWhen = c && (AUTO_LOCK.find(([v]) => v === (c.autoLock == null ? 1 : c.autoLock)) || AUTO_LOCK[1])[1].toLowerCase();
    el.replaceChildren(...nodes(
      c ? h('p', { class: 'status-line', 'data-state': 'synced' }, `🔒 PIN set${c.bio ? ' · fingerprint / face on' : ''} · locks ${lockWhen}`)
        : h('p', { class: 'warn small' }, '🔓 No PIN. Anyone who picks up this device with Vdex open can read your bookings, contacts, kit serials and insurance details.'),
      h('p', { class: 'small muted' }, 'With a PIN, Vdex locks its screen and keeps everything it stores encrypted (AES-256) whenever it is locked, in the background or closed. Only your PIN, or your fingerprint or face, opens it.'),
      h('div', { class: 'actions' },
        c ? [h('button', { class: 'btn primary', onclick: () => lockNow() }, '🔒 Lock now'), h('button', { class: 'btn ghost', onclick: changePin }, 'Change PIN…'), h('button', { class: 'btn ghost', onclick: dropPin }, 'Remove PIN…')]
          : h('button', { class: 'btn primary', onclick: createPin }, '🔒 Set a PIN…')),
      c && bioOk && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.bio, onchange: e => toggleBio(e.target) }), h('span', null, 'Unlock with fingerprint, face or Windows Hello', h('em', null, c.bio ? (c.bio.mode === 'prf' ? ' — the key is bound to your biometric' : ' — your biometric unlocks a key kept on this device') : ' — whatever your device already uses'))),
      c && bioOk === false && h('p', { class: 'small muted' }, 'This device or browser does not offer fingerprint or face unlock to web apps, so the PIN is the way in.'),
      c && h('div', { class: 'field' }, h('label', null, 'Lock when you leave the app'), h('select', { 'aria-label': 'Lock when you leave the app', onchange: e => setOption({ autoLock: Number(e.target.value) }) }, AUTO_LOCK.map(([v, l]) => h('option', { value: String(v), selected: v === (c.autoLock == null ? 1 : c.autoLock) }, l)))),
      c && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.wipe, onchange: e => setOption({ wipe: e.target.checked }) }), h('span', null, `Erase this device after ${WIPE_AT} wrong PINs`, h('em', null, ' — only sensible with a cloud storage linked or a recent backup'))),
      c && h('p', { class: 'small muted' }, 'Forgot the PIN? It cannot be recovered. The way back is to erase this device and restore from your cloud storage or a backup, so keep one of those current.')));
  };
  draw();
  const off = onChange(draw);
  return { el, destroy: off };
}

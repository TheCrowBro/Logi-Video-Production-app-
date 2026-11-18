// App lock: a PIN, plus fingerprint / face / Windows Hello where the device offers it, and a vault that keeps the
// database and sign-in secrets encrypted (AES-256-GCM) whenever the app is locked, in the background or closed.
// A random data key encrypts the vault; the PIN (through PBKDF2) and the biometric each hold a wrapped copy of it.
import { h, toast, announce, nodes, sheet, settleApp } from './util.js';
import * as store from './store.js';
import * as C from './crypto.js';
import { haptic } from './a11y.js';
import { refreshTour } from './tour.js';

const CFG = 'logi-lock', VAULT = 'logi-vault', DB = 'logi-db-v1', SETUP = 'logi-lock-setup';
const SEALED = ['logi-dbx-token', 'logi-ms-token', 'logi-google-tokens', 'logi-webdav', 'logi-loc', 'logi-wx', 'logi-cloud-who', 'logi-google-email', 'logi-icloud-session', 'logi-feed-url']; // secrets and private settings that live outside the database
export const AUTO_LOCK = [[0, 'Straight away'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes'], [-1, 'Only when Vdex is closed']];
const WAITS = [[12, 900], [9, 300], [7, 60], [5, 30]]; // wrong attempts → seconds before the next try
export const WIPE_AT = 10;
export const PIN_MIN = 4, PIN_MAX = 20; // digits in a PIN; any PIN within the length is accepted

const S = { cfg: null, key: null, raw: null, locked: false, screen: null, hiddenAt: 0, timer: null, vaultRev: -1, extras: {}, extrasJson: '', vaultExtras: null, pending: null, op: Promise.resolve(), resolveBoot: null, listeners: new Set(), entry: '', checking: false, keys: null, paste: null, byPin: false, offer: null, dropOffer: null, repaint: null, retell: null, pastTerms: false, onUnlock: null };
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } }; // false: the browser's storage is full or blocked
const FULL = 'Not enough storage to keep the encrypted copy of your data: free some space, or erase old logs and bookings. Until then the data is kept in plain.';
const storageFull = () => { if (Date.now() - (S.fullWarned || 0) < 60000) return; S.fullWarned = Date.now(); toast(FULL); announce(FULL); };
const readCfg = () => { try { const c = JSON.parse(lsGet(CFG)); return c && c.pin ? c : null; } catch { return null; } };
// The config as this tab holds it. A lock screen that is up draws its dots again, since the PIN's length may be what
// changed. saveCfg also writes it to the disk; false: the disk would not take it (setPin minds; the lock options carry
// on in memory).
const holdCfg = c => { S.cfg = c; S.listeners.forEach(f => f()); if (S.repaint) S.repaint(); };
const saveCfg = c => { const ok = lsSet(CFG, c ? JSON.stringify(c) : null); holdCfg(c); return ok; };
const chain = fn => { S.op = S.op.then(fn).catch(e => console.warn('lock:', e)); return S.op; };
// This device is being erased (here, or from another tab): forget the key, so nothing of this tab's copy is written back.
const letGo = () => { S.cfg = null; S.key = null; S.raw = null; clearTimeout(S.pending); S.listeners.forEach(f => f()); };
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
  // A sign-in can change with no change to the data (iCloud's session changes with every request): rewrite then too.
  if (!force && S.vaultRev === rev && lsGet(VAULT) && S.vaultExtras === S.extrasJson) return;
  const db = store.serialize(), extrasJson = S.extrasJson;
  const box = await C.encrypt(S.key, JSON.stringify({ db, extras: S.extras }));
  const json = JSON.stringify({ v: 1, iv: box.iv, ct: box.ct });
  if (!lsSet(VAULT, json)) { storageFull(); throw new Error('The encrypted copy could not be saved: the browser storage is full'); }
  S.vaultRev = rev; S.lastDb = db; S.vaultExtras = extrasJson; S.vaultHead = json.slice(0, 40); // exactly what the vault now holds, and which vault (the iv) it is
}
const scheduleVault = () => { if (!S.key) return; clearTimeout(S.pending); S.pending = setTimeout(() => chain(() => writeVault()), 200); };

// The app is hidden or locked: drop the plaintext copies. When the vault already holds exactly what is on disk this
// is synchronous, which matters on the way out of a page, where nothing asynchronous gets to finish.
function sealSync() {
  if (!S.key || store.isSealed()) return true;
  const current = (lsGet(VAULT) || '').slice(0, 40) === S.vaultHead && store.serialize() === S.lastDb && JSON.stringify(extrasNow()) === S.vaultExtras; // this tab's own last vault, holding exactly what is on disk
  if (!current) return false;
  for (const k of [DB, ...sealedKeys()]) lsSet(k, null);
  store.setSealed(true);
  return true;
}
async function seal() {
  if (sealSync()) return;
  clearTimeout(S.pending);
  try { await writeVault(true); } catch { return; } // nowhere to keep the encrypted copy: the plain copy stays (storageFull has said so)
  if (store.isSealed()) return;
  for (const k of [DB, ...sealedKeys()]) lsSet(k, null);
  store.setSealed(true);
}
const sealSoon = () => { if (!sealSync()) chain(seal); };

const dbTime = text => { try { return Number(JSON.parse(text).updatedAt) || 0; } catch { return 0; } };
// Put the plaintext copies back. While the app runs, the copy in memory wins; at boot the newest copy wins.
async function unseal(boot = false) {
  if (!S.key || S.unloading) return;
  if (!readCfg()) { letGo(); return; } // the config is gone from the disk: this device is being erased (from another tab, its keys going one by one), so nothing goes back
  const raw = lsGet(VAULT);
  if (raw) {
    let opened = null;
    try { opened = JSON.parse(await C.decryptText(S.key, JSON.parse(raw))); } catch { /* not this key's vault, or damaged */ }
    if (S.unloading || !S.key) return; // the page went away while decrypting, or the device was erased meanwhile: write nothing
    if (!readCfg()) { letGo(); return; } // …or its erase reached this tab while the vault was being opened
    if (!opened) {
      // The encrypted copy cannot be read (a damaged vault, or one written with another key): keep it aside and carry on
      // with the plain copy, which a fresh vault then replaces; never a blank page with no way on.
      lsSet('logi-vault-broken', raw); lsSet(VAULT, null); S.vaultRev = -1; S.lastDb = null; S.vaultHead = null;
      const m = lsGet(DB) ? 'The encrypted copy of your data could not be read, so Vdex is starting from the last plain copy.' : 'The encrypted copy of your data could not be read, and there is no plain copy on this device: link your cloud storage or import a backup to get your data back.';
      setTimeout(() => { toast(m); announce(m); }, 600);
    } else {
      const { db, extras } = opened;
      S.extras = extras || {}; S.extrasJson = JSON.stringify(S.extras); S.lastDb = db; S.vaultExtras = S.extrasJson; S.vaultHead = raw.slice(0, 40);
      for (const [k, v] of Object.entries(S.extras)) if (lsGet(k) == null) lsSet(k, v);
      if (boot) { const have = lsGet(DB); if (have == null || dbTime(db) > dbTime(have)) lsSet(DB, db); }
      else if (dbTime(db) > (Number(store.db.updatedAt) || 0)) { lsSet(DB, db); store.setSealed(false); store.reload(); } // another tab sealed newer data: take it, instead of writing this tab's older copy over it
    }
  }
  if (!S.key) return; // erased from another tab while this ran: nothing of this copy goes back
  store.setSealed(false); // writes anything saved while sealed
  if (boot) store.reload(); else if (lsGet(DB) == null) store.flush();
  if (store.serialize() !== S.lastDb) await writeVault(true); // a normalised reload or edits made while sealed: keep the vault exact so sealing stays synchronous
  if (document.hidden || S.locked) sealSoon(); // hidden or locked again meanwhile (at boot too: the page may have been put away while the PIN was checked)
}

/* ------------------------------------ PIN ------------------------------------ */
const kdf = (pin, c) => C.pbkdf2Key(pin, C.fromB64(c.salt), c.iter);
async function openWithPin(pin, c = S.cfg) { try { return await C.decrypt(await kdf(pin, c), c.pin); } catch { return null; } }
async function adopt(raw) { S.raw = raw; S.key = await C.importAesKey(raw); }

const ELSEWHERE = 'A PIN was just set in another tab: restart Vdex and enter it.';
export async function setPin(pin) { // first PIN makes a new data key; a later one re-wraps the same key
  const minting = !S.raw;
  if (minting && readCfg()) { const e = new Error(ELSEWHERE); e.code = 'elsewhere'; throw e; } // a config made in another tab holds a key this tab does not have
  const raw = S.raw || C.bytes(32);
  const salt = C.bytes(16), iter = C.PBKDF2_ITERATIONS;
  const wrap = await C.encrypt(await C.pbkdf2Key(pin, salt, iter), raw);
  if (minting && readCfg()) { const e = new Error(ELSEWHERE); e.code = 'elsewhere'; throw e; } // …or made while the key was being derived
  const before = S.cfg, hadKey = !!S.key;
  const dropKey = () => { if (!hadKey) { S.key = null; S.raw = null; } };
  await adopt(raw);
  // max: the longest PIN allowed when this one was chosen (offerLongerPin below). past: the salts of the PINs this one
  // replaces, the last eight, by which a copy of the config from before the change is known for what it is (takeConfig
  // below). A config the disk would not take is a PIN that was not set: the disk still holds the old one (or none),
  // which the next start would ask for, so this tab goes back to it and says so.
  const after = (c, s) => [...new Set([...(c.past || []), s])].slice(-8);
  const next = { ...(S.cfg || { v: 1, autoLock: 1, wipe: false, bio: null }), salt: C.toB64(salt), iter, pin: wrap, len: pin.length, max: PIN_MAX, past: S.cfg ? after(S.cfg, S.cfg.salt) : undefined, attempts: 0, until: 0 };
  if (!saveCfg(next)) { holdCfg(before); dropKey(); throw new Error('the browser storage is full'); }
  // No vault, no PIN: the plain copy stays as it was, and the config goes back to the one before. That one now replaces
  // the PIN that was not kept, and says so in its own past, so a tab that had already taken the new config takes it back.
  try { await writeVault(true); } catch (e) { saveCfg(before && { ...before, past: after(before, next.salt) }); dropKey(); throw e; }
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
  letGo(); // nothing of this tab's copy may be written on the way out
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
// Everything on the page but the lock (the app, sheets, a walkthrough, the update and licence bars, the skip link) goes
// inert while a lock screen is up, and comes back as it was. Sheets and the walkthrough answer no keys while they are
// inert (sheet() in js/util.js, runTour() in js/tour.js), so a key pressed on this screen stays on this screen. The page
// itself (#app) is not put back from memory: it is out of reach or not by what is open once the screen has gone.
// A sheet that code opens while the screen is up was not on the page to be covered: sheet() in js/util.js sees the
// screen (covered()) and starts it covered, marked data-covered, and it comes back here with the rest.
export function coverAll(screen) {
  const was = [...document.body.children].filter(el => el !== screen).map(el => [el, el.inert]);
  was.forEach(([el]) => { el.inert = true; });
  const app = document.getElementById('app'); if (app) app.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.sheet-back').forEach(el => el.classList.add('behind-lock'));
  return () => {
    was.forEach(([el, inert]) => { if (el.isConnected) el.inert = inert; });
    document.querySelectorAll('.sheet-back[data-covered]').forEach(el => { el.inert = false; el.removeAttribute('data-covered'); });
    settleApp();
    if (app) app.removeAttribute('aria-hidden');
    document.querySelectorAll('.sheet-back.behind-lock').forEach(el => el.classList.remove('behind-lock'));
  };
}
function showLock(notice = '') {
  if (S.screen) return;
  window.logiMenu?.close(); // the menu is not left open behind the lock
  window.logiSearch?.close(true); // nor the search, which also forgets what was typed and found
  S.locked = true; S.entry = '';
  // The PIN's length is read each time it is needed, never kept: the PIN can change while this screen is up (in another
  // tab, or by a save that finished after the lock came up), and the screen must then ask for the PIN there is now.
  const len = () => (S.cfg && S.cfg.len) || 6;
  const dots = h('div', { class: 'pin-dots', role: 'img' });
  // The wipe countdown, when the switch is on, goes on every message: the ninth wrong PIN must warn about the tenth.
  const leftText = () => { const left = S.cfg && S.cfg.wipe ? WIPE_AT - (S.cfg.attempts || 0) : 0; return left > 0 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before this device is erased.` : ''; };
  // Wrong tries already made (before a restart, or in another tab) are said from the start when the next ones can erase.
  const first = (notice + (S.cfg.attempts ? leftText() : '')).trim();
  const msg = h('div', { class: 'lock-msg', role: 'status', 'aria-live': 'polite' }, first);
  // What this screen says to a screen reader beyond the line above: the wait after wrong PINs, and how many digits are
  // in. It has a live region of its own inside the card, because everything outside the lock screen is inert while it
  // is up, the app's shared region (announce() in js/util.js) included, and nothing said there would be heard.
  const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  let saying = 0;
  const say = text => { clearTimeout(saying); live.textContent = ''; saying = setTimeout(() => { live.textContent = text; }, 50); };
  const count = () => `${S.entry.length} of ${len()}`;
  const forgot = h('div', { class: 'lock-forgot', id: 'lock-forgot', hidden: true },
    h('p', { class: 'small' }, 'The PIN is the only key to the data on this device, so it cannot be recovered. You can erase this device and start again: if you linked a cloud storage or exported a backup, link it or import it afterwards and everything comes back.'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('Erase all Vdex data on this device?')) wipe('This device was erased. Link your storage or import a backup to get your data back.'); } }, 'Erase this device'), h('button', { type: 'button', class: 'btn ghost', onclick: () => { forgot.hidden = true; forgotBtn.setAttribute('aria-expanded', 'false'); } }, 'Keep trying')));
  const forgotBtn = h('button', { type: 'button', class: 'btn ghost small', 'aria-expanded': 'false', 'aria-controls': 'lock-forgot', onclick: () => { forgot.hidden = !forgot.hidden; forgotBtn.setAttribute('aria-expanded', String(!forgot.hidden)); if (!forgot.hidden) forgot.scrollIntoView({ block: 'nearest' }); } }, 'Forgot PIN?');
  // One dot for each digit, however long the PIN: its length is no secret this screen could keep (it sends the PIN by
  // itself at that many digits, and the config beside the vault states it), and the dots are how the owner of a long
  // PIN sees how far along they are. More than ten go in even rows, so twenty fit the narrowest phone. When the length
  // has changed under the screen, the digits typed so far were for the PIN that was, and go.
  let drawn = 0;
  const paint = () => {
    const n = len();
    if (n !== drawn) {
      if (drawn) S.entry = '';
      drawn = n; dots.classList.toggle('rows', n > 10);
      if (n > 10) dots.style.setProperty('--cols', String(Math.ceil(n / Math.ceil(n / 10)))); else dots.style.removeProperty('--cols');
    }
    dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < S.entry.length ? 'on' : '' }))); dots.setAttribute('aria-label', `${S.entry.length} of ${n} digits entered`);
  };
  const busy = () => S.checking || waitLeft() > 0;
  let ticker = null;
  // The wait is said once; the seconds tick on screen without a screen reader repeating them.
  const showWait = () => { clearInterval(ticker); msg.setAttribute('aria-live', 'off'); say(`Wrong PIN. Wait ${waitLeft()} seconds.` + leftText()); const tick = () => { const left = waitLeft(); if (!left) { clearInterval(ticker); msg.setAttribute('aria-live', 'polite'); msg.textContent = 'You can try again.' + leftText(); return; } msg.textContent = `Wrong PIN. Try again in ${left} s.` + leftText(); }; tick(); ticker = setInterval(tick, 1000); };
  // How far along the PIN is, for a screen reader: after every digit of a PIN of up to ten, every fourth of a longer
  // one, and whenever a digit is taken back. The digits themselves are never said.
  const press = d => { const n = len(); if (busy() || S.entry.length >= n) return; S.entry += d; haptic(8); paint(); if (S.entry.length === n) submit(); else if (n <= 10 || S.entry.length % 4 === 0) say(count()); };
  const back = () => { if (busy()) return; S.entry = S.entry.slice(0, -1); paint(); say(count()); };
  async function submit() {
    const pin = S.entry; S.entry = ''; paint();
    if (!pin || waitLeft() > 0) return;
    S.checking = true; msg.textContent = 'Checking…';
    const ok = await checkPin(pin);
    S.checking = false;
    if (ok) { recordSuccess(); return unlocked(true); }
    haptic(60); S.screen.classList.remove('shake'); void S.screen.offsetWidth; S.screen.classList.add('shake');
    if (recordFailure()) return;
    if (waitLeft() > 0) return showWait();
    msg.textContent = 'Wrong PIN.' + leftText(); // the line is a live region of this screen: a screen reader hears it from there
  }
  async function tryBio() {
    if (busy()) return;
    try { if (await unlockBio()) { recordSuccess(); unlocked(false); } } catch (e) { msg.textContent = e.name === 'NotAllowedError' ? 'Biometric check cancelled. Use the PIN.' : (e.message || 'Biometric unlock failed'); }
  }
  // A digit key or ⌫: one of the keys that change what is entered (data-entry, which the Enter key looks for below).
  const key = (label, fn, cls = '') => h('button', { type: 'button', class: 'key ' + cls, 'data-entry': '', onclick: fn, 'aria-label': label === '⌫' ? 'Delete' : label }, label);
  const bio = !!S.cfg.bio;
  S.screen = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Vdex is locked' },
    h('div', { class: 'lock-card' },
      h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'VDEX'),
      h('h1', null, 'Enter your PIN'),
      dots, msg, live,
      h('div', { class: 'keypad' }, ...'123456789'.split('').map(d => key(d, () => press(d))),
        bio ? h('button', { type: 'button', class: 'key soft', onclick: tryBio, 'aria-label': 'Unlock with fingerprint or face' }, '👤') : h('span', { 'aria-hidden': 'true' }),
        key('0', () => press('0')), key('⌫', back, 'soft')),
      bio && h('button', { type: 'button', class: 'btn ghost lock-bio', onclick: tryBio }, '👤 Use fingerprint or face'),
      forgotBtn,
      forgot));
  // Enter never sends a PIN short of its length: the screen sends the PIN by itself at the last digit, so an earlier
  // Enter could only be a wrong PIN, and would be counted as one. It tells a screen reader how far along the PIN is
  // instead, and it must never press the digit key or ⌫ that has the focus: the PIN was typed on a keyboard, and that
  // key only has the focus because the screen put it there, or a tap did. (Only a config with no length recorded, which
  // no version has written, still sends on Enter from four digits.) On any other button of this screen (Forgot PIN?,
  // Erase this device, Keep trying, the fingerprint or face buttons) Enter is left alone and presses it, as everywhere.
  const ownButton = t => { const b = t && t.closest ? t.closest('button') : null; return !!b && S.screen.contains(b) && !b.hasAttribute('data-entry'); };
  S.keys = e => { if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); } else if (e.key === 'Backspace') { back(); e.preventDefault(); } else if (e.key === 'Enter') { if (ownButton(e.target)) return; e.preventDefault(); if (busy()) return; if (S.cfg.len) { if (S.entry) say(count()); } else if (S.entry.length >= PIN_MIN) submit(); } };
  // A pasted PIN (a long one kept in a password manager) goes in as if typed. Anything but digits, or more of them
  // than the PIN has, is left out and said: it is never cut to fit and tried as a guess.
  S.paste = e => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    if (busy()) return;
    const text = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/\s+/g, '');
    if (!/^\d+$/.test(text) || S.entry.length + text.length > len()) { msg.textContent = 'Not pasted: that is longer than your PIN, or not all digits.'; return; }
    for (const d of text) press(d);
  };
  document.addEventListener('keydown', S.keys);
  document.addEventListener('paste', S.paste);
  if (S.dropOffer) S.dropOffer(); // the offer of a longer PIN, if it is up, goes: it comes back after this unlock
  document.body.append(S.screen);
  S.uncover = coverAll(S.screen);
  paint();
  if (waitLeft() > 0) showWait(); else if (first) say(first);
  S.repaint = paint;
  // Wrong tries made in another tab count here too (takeConfig below): the wait, and how many tries are left before the
  // erase, are shown as they now stand, so the keypad never goes quiet, or the last try comes, with nothing said.
  S.retell = () => { if (waitLeft() > 0) return showWait(); clearInterval(ticker); msg.setAttribute('aria-live', 'polite'); msg.textContent = S.cfg.attempts ? leftText().trim() : ''; };
  const firstKey = S.screen.querySelector('.key'); firstKey && firstKey.focus();
  if (bio && document.visibilityState === 'visible') setTimeout(() => tryBio(), 350);
  S.hideLock = () => { clearInterval(ticker); clearTimeout(saying); };
}
function hideLock() {
  if (!S.screen) return;
  S.hideLock && S.hideLock();
  S.repaint = null; S.retell = null;
  document.removeEventListener('keydown', S.keys); S.keys = null;
  document.removeEventListener('paste', S.paste); S.paste = null;
  S.screen.remove(); S.screen = null;
  if (S.uncover) { S.uncover(); S.uncover = null; }
  const main = document.getElementById('page'); main && main.focus({ preventScroll: true });
}
// The page is hidden: seal, and lock now or after the chosen time.
function hiddenNow() {
  const m = S.cfg.autoLock == null ? 1 : S.cfg.autoLock;
  clearTimeout(S.timer); S.hiddenAt = Date.now();
  sealSoon();
  if (m === 0) S.locked = true; else if (m > 0) S.timer = setTimeout(() => { S.locked = true; }, m * 60000);
}
function unlocked(byPin) {
  hideLock(); S.locked = false; S.byPin = byPin;
  const boot = S.resolveBoot;
  if (boot) { S.resolveBoot = null; boot(); }
  else chain(() => unseal());
  if (document.hidden) hiddenNow(); // put away while the PIN was being checked: the usual rule applies from now
  announce('Unlocked');
  if (!boot && S.pastTerms) offerLongerPin(); // at the start of the app it waits for ensurePin(), which comes after the terms: never over them
  if (S.onUnlock) { const go = S.onUnlock; S.onUnlock = null; go(); } // ensurePin() is waiting for this unlock (after the line above, so it finds the offer)
  if (!S.locked) refreshTour(); // a walkthrough step that was showing the menu or the search shows it again (showLock closed them)
}
// PINs stopped at 8 digits until they could be 20. A config carries max, the longest PIN allowed when its PIN was chosen;
// one without it was made under the old rule, and its owner is told once, after the next unlock, that a PIN can be
// longer now, with the choice of setting a new one or keeping theirs (js/pin-offer.js, fetched only when it is due).
// Either answer writes max, so the offer never comes back; the config is not secret and is not in the vault. Until
// there is an answer the offer stays due: a lock screen coming up over it takes it away, and the next unlock, which
// may be by fingerprint where this one was by PIN, brings it back.
const offerDue = () => !!S.cfg && (S.cfg.max || 8) < PIN_MAX;
function offerLongerPin() {
  if (!offerDue() || S.offer || S.locked) return Promise.resolve();
  const knowsPin = S.byPin; // the PIN was typed a moment ago; after a fingerprint or face it is asked for, as Change PIN… does
  // The start of the app waits for the answer, but never long for the file. One that takes over five seconds is left
  // for the next unlock, when it has usually arrived. One that could not be fetched at all (offline, with no offline
  // copy yet) is offered again at the next start: the browser remembers a failed import for as long as the page lives,
  // so asking again at the next unlock gets the same failure without going to the network.
  const slow = new Promise((_, no) => setTimeout(() => no(new Error('the offer of a longer PIN could not be fetched in time')), 5000));
  S.offer = Promise.race([import('./pin-offer.js'), slow]).then(m => {
    if (!offerDue() || S.locked) return null;
    const o = m.show({ knowsPin }); S.dropOffer = o.drop; return o.done;
  }).catch(e => console.warn('lock:', e)).then(() => { S.offer = null; S.dropOffer = null; });
  return S.offer;
}
export function lockNow() { if (!S.cfg || S.screen) return; showLock(); sealSoon(); }
// Another tab changed the PIN, a lock setting or the count of wrong tries: this tab takes the config as it now stands,
// so it asks for the PIN there is now and never writes its older copy back over the change. The data key is the same
// one (a new key only follows an erase, which gate() handles). An offer answered in that tab is answered in this one.
// A lock screen that is up follows: its dots are drawn for the PIN's length as it now is, the wait and the tries left
// are told again when wrong tries were made elsewhere, and the whole screen is drawn again when the fingerprint unlock
// came or went (while a PIN is being checked it is left alone: the check ends with the message for the new count).
// One kind of write is not taken: a copy of the config from before a change this tab knows of. That is a config with a
// PIN this tab's PIN has replaced (its salt is in this tab's past, and this tab's is not in its past: setPin above), or
// with this tab's own PIN and no max where this tab has it. Such a copy comes from a tab still running a version from
// before longer PINs, which never takes what another tab wrote and writes back the whole config it started with, the
// old PIN included, whenever it counts a wrong try or a lock setting is changed in it (and from any tab whose write
// crossed a PIN change on its way here). This tab then puts its own config back, with the count of wrong tries (and the
// wait) from that write when it is the higher one: a wrong try there counts here, and that tab's older count never
// lowers this one. It can do so only while it is open: such a tab should be reloaded. A PIN newly set in such a tab is
// no stale copy (its salt is new), and is taken like any other.
const replaced = (a, b) => (a.past || []).includes(b.salt); // a's PIN came after b's
function takeConfig() {
  const c = readCfg(), was = S.cfg; if (!c) return;
  const stale = (replaced(was, c) && !replaced(c, was)) || (!!was.max && !c.max && c.salt === was.salt);
  if (stale) saveCfg({ ...was, attempts: Math.max(was.attempts || 0, c.attempts || 0), until: Math.max(was.until || 0, c.until || 0) });
  else holdCfg(c);
  const now = S.cfg;
  if (S.dropOffer && !offerDue()) S.dropOffer();
  if (!S.screen || S.checking) return;
  if (!now.bio !== !was.bio) { hideLock(); showLock(); }
  else if ((now.attempts || 0) !== (was.attempts || 0) || (now.until || 0) !== (was.until || 0) || !now.wipe !== !was.wipe) S.retell();
}

/* --------------------------------- boot & events --------------------------------- */
// Called before the app draws anything: with a PIN set, the lock screen must be passed first.
// A word about why this start looks the way it does (the device was erased; a PIN was set in another tab), left in
// sessionStorage by the tab that caused it: the gate that shows first says it, else a toast once the app is up.
export const notice = (take = true) => { try { const n = sessionStorage.getItem('logi-wiped'); if (n && take) sessionStorage.removeItem('logi-wiped'); return n || ''; } catch { return ''; } };
export async function gate() {
  // From the first lock screen on, not only once the app is up. The config changed in another tab: take it. The config
  // gone: this device was erased from another tab (Forgot PIN → Erase, or Erase all data), so this tab lets go of its
  // key and starts again. A lock screen left up would still take the old PIN and write the erased data back.
  window.addEventListener('storage', e => { if (e.key !== CFG || !S.cfg) return; if (e.newValue) takeConfig(); else if (e.oldValue) { letGo(); restart(); } });
  S.cfg = readCfg();
  if (!S.cfg) { if (lsGet(VAULT)) lsSet(VAULT, null); return; }
  store.setSealed(true); // nothing is written in plain until the vault is open
  showLock(notice());
  await new Promise(res => { S.resolveBoot = res; });
  await unseal(true);
}
// Start again through the gate: another tab set a PIN (or erased the device) while this one was on its way in.
const restart = why => { try { if (why) sessionStorage.setItem('logi-wiped', why); } catch { /* ignore */ } location.reload(); return new Promise(() => {}); };

// Everyone uses Vdex with a PIN. Runs once the terms are agreed and before anything is drawn: a device with no PIN yet
// (a first start, or an existing user's next one) sets it up on a full screen that nothing else can be used around.
// The automated tests boot with 'logi-lock-setup' = 'skip', which skips only this set-up: a PIN that exists always
// locks, because gate() above never looks at the flag.
export async function ensurePin() {
  S.pastTerms = true; // from here on an unlock may bring the offer of a longer PIN
  await pinReady();
  // The app starts when this resolves, so never while Vdex is locked: a lock screen that came up over the offer (or
  // while its file was on the way) took the offer away, and the app must not start, draw and say things behind that
  // lock screen. The next unlock brings the offer back, and its answer is waited for as before.
  while (S.locked || S.offer) { if (S.locked) await new Promise(res => { S.onUnlock = res; }); else await S.offer; }
}
function pinReady() {
  if (S.cfg) return offerLongerPin(); // a PIN from before longer PINs: the one-time offer, ahead of the app
  if (lsGet(SETUP) === 'skip') return Promise.resolve();
  if (readCfg()) return restart('A PIN was just set in another tab: enter it here.'); // made since gate() looked: this tab has no key for it
  let firstRun = false; try { firstRun = !localStorage.getItem('logi-tour'); } catch { /* ignore */ }
  const a = pinField('New PIN', 'next'), b = pinField('Repeat the PIN', 'done');
  const err = h('div', { class: 'lock-msg', role: 'alert' });
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save the PIN and continue');
  const card = h('form', { class: 'lock-card stack', noValidate: true });
  const screen = h('div', { class: 'lock lock-setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pin-setup-title' }, card);
  // Vdex open in two tabs at once, both at the set-up: the first PIN saved wins, and the other tab starts again on
  // the lock screen asking for it (a second set-up would wrap a new data key and lock the first tab's data away).
  const elsewhere = () => restart('A PIN was just set in another tab: enter it here.');
  const onStorage = e => { if (e.key === CFG && e.newValue) elsewhere(); };
  window.addEventListener('storage', onStorage);
  const why = notice(); // the device was erased from the lock screen: say so above the set-up
  return new Promise(resolve => {
    let finished = false, uncover = null;
    const done = () => { if (finished) return; finished = true; window.removeEventListener('storage', onStorage); screen.remove(); if (uncover) uncover(); announce('PIN set'); resolve(); };
    // The second card: fingerprint, face or Windows Hello, where the device offers it to web apps.
    const offerBio = () => {
      const turnOn = h('button', { class: 'btn primary', type: 'button' }, 'Turn it on');
      const notNow = h('button', { class: 'btn ghost', type: 'button', onclick: done }, 'Not now');
      turnOn.onclick = async () => {
        turnOn.disabled = notNow.disabled = true; // one answer: the device's prompt is up, and Not now meanwhile would mean both
        try { const mode = await enrolBio(); if (finished) { await forgetBio(); return; } toast(mode === 'prf' ? 'Biometric unlock on' : 'Biometric unlock on (key kept on this device)'); }
        catch (e) { if (!finished) toast(e.name === 'NotAllowedError' ? 'Cancelled: the PIN opens Vdex' : 'Could not set up: ' + (e.message || e)); }
        done();
      };
      card.replaceChildren(
        h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'VDEX'),
        h('h1', { id: 'pin-setup-title' }, 'Unlock with fingerprint, face or Windows Hello?'),
        h('p', { class: 'small' }, 'Whatever this device already uses to unlock can open Vdex as well. The PIN always works too, and this can be changed later under Settings → Security.'),
        h('div', { class: 'actions' }, turnOn, notNow));
      turnOn.focus();
    };
    card.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pinProblem(a.value) && b.value === '') { err.textContent = ''; b.focus(); return; } // Go on the first field: on to the second
      const problem = pinProblem(a.value, b.value);
      if (problem) { err.textContent = problem; announce(problem); (problem.startsWith('The two') ? b : a).focus(); return; }
      save.disabled = true; save.textContent = 'Setting up…'; err.textContent = '';
      if (readCfg()) return elsewhere(); // set in another tab meanwhile
      try { await setPin(a.value); } catch (e2) { if (e2.code === 'elsewhere') return elsewhere(); save.disabled = false; save.textContent = 'Save the PIN and continue'; err.textContent = 'Could not set the PIN: ' + (e2.message || e2); announce(err.textContent); return; }
      if (await bioAvailable()) offerBio(); else done();
    });
    card.append(
      h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'VDEX'),
      why && h('p', { class: 'warn small', role: 'status' }, why),
      h('h1', { id: 'pin-setup-title' }, firstRun ? 'First, set a PIN' : 'Set a PIN to keep using Vdex'),
      h('p', { class: 'small' }, firstRun
        ? 'Vdex keeps your bookings, contacts, kit serials and insurance details on this device, so it locks with a PIN. The PIN opens it, and everything it stores is encrypted whenever it is locked, in the background or closed.'
        : 'Vdex now locks with a PIN on every device. The PIN opens it, and everything it stores here is encrypted whenever it is locked, in the background or closed. Your data stays exactly where it is.'),
      h('p', { class: 'small muted' }, PIN_RULE),
      a, b, err,
      h('p', { class: 'warn small' }, 'A forgotten PIN cannot be recovered. The way back is to erase this device and restore from your cloud storage or a backup, so keep one of those current.'),
      h('p', { class: 'small muted' }, `Settings → Security sets when Vdex locks, adds fingerprint or face unlock, and has a switch to erase this device after ${WIPE_AT} wrong PINs: it stays off unless you turn it on.`),
      save);
    document.body.append(screen);
    uncover = coverAll(screen);
    setTimeout(() => { if (!card.contains(document.activeElement)) a.focus(); }, 60); // never take the cursor from a field someone is already typing in
  });
}

export function init() {
  store.subscribe(() => { if (S.key && !store.isSealed()) scheduleVault(); });
  addEventListener('vdex-secrets', () => { if (S.key && !store.isSealed()) scheduleVault(); }); // a sign-in changed on its own
  document.addEventListener('visibilitychange', () => {
    if (!S.cfg || S.unloading) return;
    const m = S.cfg.autoLock == null ? 1 : S.cfg.autoLock;
    clearTimeout(S.timer);
    if (document.hidden) hiddenNow();
    else {
      if (!S.locked && m > 0 && S.hiddenAt && Date.now() - S.hiddenAt >= m * 60000) S.locked = true;
      if (S.locked) showLock(); else chain(() => unseal());
    }
  });
  window.addEventListener('pagehide', () => { S.unloading = true; if (S.cfg) sealSoon(); });
  window.addEventListener('pageshow', () => { S.unloading = false; }); // back-forward cache
  // This device erased from another tab is handled in gate(), whose listener is there from the first lock screen on.
  // Another tab sealing the storage while this one is in use means the plain copies are put back from memory and the
  // vault.
  addEventListener('vdex-erased', letGo); // the erasing tab itself, before it reloads
  window.addEventListener('storage', e => {
    if (!S.cfg || !S.key || document.hidden || S.locked) return;
    // The other tab's changes reach this tab one key at a time: wait a moment, then unseal only if the vault and the
    // config are still there (an erase removes them right after the database).
    if (e.key === DB && e.newValue == null) setTimeout(() => { if (S.key && !S.locked && !document.hidden && lsGet(VAULT) && readCfg()) chain(() => unseal()); }, 250);
  });
}

/* ------------------------------------ settings ------------------------------------ */
// The one rule a PIN must meet, the same on the set-up screen, in Settings, for Change PIN and on the offer of a longer
// one: digits, and how many. Nothing within the length is refused. pinProblem gives the problem, or ''.
export const PIN_RULE = `${PIN_MIN} to ${PIN_MAX} digits.`;
const PIN_OK = new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`);
export const pinProblem = (v, again = null) => (!PIN_OK.test(v) ? `Use ${PIN_RULE}` : again != null && again !== v ? 'The two PINs differ.' : '');
// The field a PIN is typed into. It holds more than a PIN may, so that one typed or pasted too long is refused in words
// rather than cut short unseen behind the dots. one-time-code: a PIN is a code, never offered to a password manager.
export const pinField = (label, hint) => h('input', { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 64, autocomplete: 'one-time-code', enterKeyHint: hint, 'aria-label': label, placeholder: label, class: 'pin-input' });
// A small sheet asking for a PIN or a passphrase, optionally typed twice. Resolves with the value or null.
export function askSecret({ title, confirm = false, numeric = true, intro = '', minLength = 4 } = {}) {
  return new Promise(resolve => {
    let done = false;
    const input = label => (numeric ? pinField(label) : h('input', { type: 'password', inputMode: 'text', maxLength: 128, autocomplete: 'new-password', 'aria-label': label, placeholder: label, class: 'pin-input' }));
    const a = input(confirm ? (numeric ? 'New PIN' : 'Passphrase') : (numeric ? 'PIN' : 'Passphrase')), b = confirm ? input(numeric ? 'Repeat the PIN' : 'Repeat the passphrase') : null;
    const err = h('div', { class: 'lock-msg', role: 'alert' });
    let close = () => {};
    const submit = e => {
      e.preventDefault();
      const v = a.value;
      const problem = numeric ? pinProblem(v, b ? b.value : null) : v.length < minLength ? `Use at least ${minLength} characters.` : b && b.value !== v ? 'The two passphrases differ.' : '';
      if (problem) { err.textContent = problem; return; }
      done = true; close(); resolve(v);
    };
    const form = h('form', { class: 'stack', onsubmit: submit },
      intro && h('p', { class: 'small muted' }, intro),
      numeric && confirm && h('p', { class: 'small muted' }, PIN_RULE),
      a, b, err,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, confirm ? 'Save' : 'Continue'), h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel')));
    ({ close } = sheet(title, form, { dismissOnBackdrop: false, onClose: () => { if (!done) resolve(null); } }));
    // The first field gets the cursor once the sheet is up, unless someone is in the form already: a second field
    // reached within that moment (a quick Tab, a password manager) must not have its digits land in the first.
    setTimeout(() => { if (!form.contains(document.activeElement)) a.focus(); }, 60);
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
  const toggleBio = async input => {
    if (input.checked) { input.disabled = true; try { const mode = await enrolBio(); toast(mode === 'prf' ? 'Biometric unlock on' : 'Biometric unlock on (key kept on this device)'); } catch (e) { input.checked = false; toast(e.name === 'NotAllowedError' ? 'Cancelled' : 'Could not set up: ' + (e.message || e)); } input.disabled = false; }
    else await forgetBio();
    draw();
  };
  const draw = () => {
    const c = S.cfg;
    const lockWhen = c && (AUTO_LOCK.find(([v]) => v === (c.autoLock == null ? 1 : c.autoLock)) || AUTO_LOCK[1])[1].toLowerCase();
    const had = el.contains(document.activeElement) ? document.activeElement : null, hadKey = had && [had.tagName, had.getAttribute('aria-label') || (had.closest('label') || had).textContent.trim().slice(0, 60)].join('|');
    el.replaceChildren(...nodes(
      c ? h('p', { class: 'status-line', 'data-state': 'synced' }, `🔒 PIN set${c.bio ? ' · fingerprint / face on' : ''} · locks ${lockWhen}`)
        : h('p', { class: 'warn small' }, '🔓 No PIN. Anyone who picks up this device with Vdex open can read your bookings, contacts, kit serials and insurance details. Vdex asks for a PIN the next time it starts.'),
      h('p', { class: 'small muted' }, `Vdex locks its screen with your PIN and keeps your work and your sign-ins encrypted (AES-256) whenever it is locked, in the background or closed. Only your PIN, or your fingerprint or face, opens it. Every device that runs Vdex has a PIN; Change PIN… sets a new one, ${PIN_MIN} to ${PIN_MAX} digits long.`),
      h('div', { class: 'actions' },
        c ? [h('button', { class: 'btn primary', onclick: () => lockNow() }, '🔒 Lock now'), h('button', { class: 'btn ghost', onclick: changePin }, 'Change PIN…')]
          : h('button', { class: 'btn primary', onclick: createPin }, '🔒 Set a PIN…')),
      c && bioOk && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.bio, onchange: e => toggleBio(e.target) }), h('span', null, 'Unlock with fingerprint, face or Windows Hello', h('em', null, c.bio ? (c.bio.mode === 'prf' ? ' — the key is bound to your biometric' : ' — your biometric unlocks a key kept on this device') : ' — whatever your device already uses'))),
      c && bioOk === false && h('p', { class: 'small muted' }, 'This device or browser does not offer fingerprint or face unlock to web apps, so the PIN is the way in.'),
      c && h('div', { class: 'field' }, h('label', null, 'Lock when you leave the app'), h('select', { 'aria-label': 'Lock when you leave the app', onchange: e => setOption({ autoLock: Number(e.target.value) }) }, AUTO_LOCK.map(([v, l]) => h('option', { value: String(v), selected: v === (c.autoLock == null ? 1 : c.autoLock) }, l)))),
      c && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.wipe, onchange: e => setOption({ wipe: e.target.checked }) }), h('span', null, `Erase this device after ${WIPE_AT} wrong PINs`, h('em', null, ' — only sensible with a cloud storage linked or a recent backup'))),
      c && h('p', { class: 'small muted' }, 'Forgot the PIN? It cannot be recovered. The way back is to erase this device and restore from your cloud storage or a backup, so keep one of those current.')));
    if (hadKey) { const again = [...el.querySelectorAll('button, input, select')].find(x => [x.tagName, x.getAttribute('aria-label') || (x.closest('label') || x).textContent.trim().slice(0, 60)].join('|') === hadKey); if (again) again.focus({ preventScroll: true }); }
  };
  draw();
  const off = onChange(draw);
  return { el, destroy: off };
}

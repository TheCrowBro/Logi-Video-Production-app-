// Vdex licence codes: the one implementation of the code format, shared by the desktop app (desktop/licence.js), the
// website's Worker (cloudflare/worker.mjs, which sells and activates codes) and the owner's offline generator page
// (tools/licence-generator.template.html, built by tools/build-generator.mjs). It uses only Web Crypto, which all three
// have, so a code made by one is checked the same way by the others.
//
// A code is "VDEX-" followed by Crockford base32 (no I, L, O or U) of payload + Ed25519 signature, in groups of five.
// The signature covers "VDEX-LICENCE\0" + payload. Notes signed with the same keys use other prefixes ("VDEX-ACTIVE\0"
// for a computer's activation receipt, "VDEX-ADMIN\0" for the owner's requests to the Worker), so nothing signed for
// one purpose can be passed off as another. "VDEX-WEB\0" signs the website's sign-in tokens, and "VDEX-STATUS\0" the
// licence server's note that the website's licence check is switched off (js/licence-web.js reads it).
//
// Payload, format 1: version(1) kid(1) flags(1: bit 0 = free licence) edition(1: 1 = desktop) seats(1) serial(4)
// issued(2) expires(2: 0 = never; both in days from 1 Jan 2026) nameLength(1) name nameLength... emailLength(1) email.
'use strict';

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86400e3;
const HEADER = 13, SIG = 64, MAX_TEXT = 64, SEATS = 3;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const FLAG_COMP = 1, EDITION_DESKTOP = 1;
const PREFIX = { licence: 'VDEX-LICENCE\0', active: 'VDEX-ACTIVE\0', admin: 'VDEX-ADMIN\0', web: 'VDEX-WEB\0', status: 'VDEX-STATUS\0' };
// Key numbers: 1 = the owner's key (generator), 2 = the shop's key (a Worker secret), 9 = the owner's spare, kept
// apart. Only the owner's keys may sign requests to change what the Worker holds about a code.
const OWNER_KIDS = [1, 9];
const PKCS8_ED25519 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

class LicenceError extends Error { constructor(status, message) { super(message); this.status = status; } }

/* --------------------------------- bytes --------------------------------- */
const b64u = {
  enc: bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec: text => Uint8Array.from(atob(String(text).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const prefixed = (kind, bytes) => concat(enc.encode(PREFIX[kind]), bytes);

function b32encode(bytes) {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } value &= (1 << bits) - 1; }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const out = []; let bits = 0, value = 0;
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new LicenceError('invalid', 'The code has a character that does not belong in a Vdex code. Copy it again from your email.');
    value = (value << 5) | v; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    value &= (1 << bits) - 1;
  }
  if (bits >= 5 || value !== 0) throw new LicenceError('invalid', 'The code is incomplete. Copy it again, including every group.');
  return Uint8Array.from(out);
}
const formatCode = bytes => 'VDEX-' + b32encode(bytes).match(/.{1,5}/g).join('-');
// Finds the code in pasted text ("Your code: VDEX-ABCDE-… Thanks!"), in any case, with its groups split across lines by
// an email program. Groups are joined by dashes, so the words after the code are never taken as part of it.
function extract(text) {
  const m = String(text || '').slice(0, 4000).match(/VDEX-([0-9A-Z]+(?:\s*-\s*[0-9A-Z]+)*)/i);
  if (!m) throw new LicenceError('invalid', 'Paste the whole code: it starts with VDEX-.');
  return b32decode(m[1]);
}
const cleanCode = text => formatCode(extract(text));

/* -------------------------------- payload -------------------------------- */
const dayOf = date => { const t = Date.parse(String(date) + 'T00:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(t)) throw new Error('Dates are written YYYY-MM-DD'); return Math.floor((t - EPOCH) / DAY); };
const dateOf = day => new Date(EPOCH + day * DAY).toISOString().slice(0, 10);
const textBytes = s => enc.encode(String(s || '').normalize('NFC').trim());
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// Shortens text to what fits in a code (64 bytes of UTF-8) without cutting a character in half.
function fitText(s, max = MAX_TEXT) { let t = String(s || '').normalize('NFC').trim(); while (enc.encode(t).length > max) t = [...t].slice(0, -1).join(''); return t.trim(); }

function packPayload({ kid, serial, name = '', email = '', comp = false, seats = SEATS, issued = today(), expires = '' }) {
  const n = textBytes(name), e = textBytes(String(email || '').toLowerCase());
  if (!n.length && !e.length) throw new Error('A licence needs a name or an email address');
  if (n.length > MAX_TEXT || e.length > MAX_TEXT) throw new Error(`The name and the email address can be at most ${MAX_TEXT} letters each`);
  if (!(Number.isInteger(kid) && kid >= 1 && kid <= 255)) throw new Error('The key number must be 1 to 255');
  if (!(Number.isInteger(serial) && serial >= 1 && serial <= 0xffffffff)) throw new Error('The serial must be 1 to 4294967295');
  if (!(Number.isInteger(seats) && seats >= 1 && seats <= 255)) throw new Error('A licence covers 1 to 255 computers');
  const iss = dayOf(issued), exp = expires ? dayOf(expires) : 0;
  if (!(iss >= 0 && iss <= 0xffff) || !(exp >= 0 && exp <= 0xffff) || (exp && exp < iss)) throw new Error('Dates must be from 2026 on, and the end date after the issue date');
  const p = new Uint8Array(HEADER + 2 + n.length + e.length), v = new DataView(p.buffer);
  p[0] = 1; p[1] = kid; p[2] = comp ? FLAG_COMP : 0; p[3] = EDITION_DESKTOP; p[4] = seats;
  v.setUint32(5, serial); v.setUint16(9, iss); v.setUint16(11, exp);
  p[13] = n.length; p.set(n, 14); p[14 + n.length] = e.length; p.set(e, 15 + n.length);
  return p;
}
function unpackPayload(p) {
  const not = () => new LicenceError('invalid', 'This is not a Vdex licence code.');
  const newer = () => new LicenceError('newer', 'This code is for a newer version of Vdex. Update Vdex, then enter it again.');
  if (p.length < HEADER + 2) throw not();
  if (p[0] !== 1) throw p[0] > 1 ? newer() : not();
  const nl = p[13]; if (nl > MAX_TEXT || 14 + nl >= p.length) throw not();
  const el = p[14 + nl]; if (el > MAX_TEXT || 15 + nl + el !== p.length) throw not();
  if (p[2] & ~FLAG_COMP) throw newer();
  const v = new DataView(p.buffer, p.byteOffset, p.byteLength), exp = v.getUint16(11);
  let name, email;
  try { const d = new TextDecoder('utf-8', { fatal: true }); name = d.decode(p.subarray(14, 14 + nl)); email = d.decode(p.subarray(15 + nl, 15 + nl + el)); } catch { throw not(); }
  return { version: 1, kid: p[1], comp: !!(p[2] & FLAG_COMP), edition: p[3], seats: p[4], serial: v.getUint32(5), issued: dateOf(v.getUint16(9)), expires: exp ? dateOf(exp) : '', name, email };
}
const refOf = (kid, serial) => `${kid}:${serial}`;
const randomSerial = () => { const a = new Uint32Array(1); do globalThis.crypto.getRandomValues(a); while (a[0] === 0); return a[0]; };

/* --------------------------------- keys ---------------------------------- */
const pubCache = new Map();
function publicKey(kid, keys) {
  const x = keys && keys[kid]; if (!x || typeof x !== 'string') return null;
  if (!pubCache.has(x)) pubCache.set(x, subtle().importKey('raw', b64u.dec(x), { name: 'Ed25519' }, false, ['verify']).catch(() => null));
  return pubCache.get(x);
}
async function verifyBytes(kind, message, sig, kid, keys) {
  const key = await publicKey(kid, keys); if (!key || sig.length !== SIG) return false;
  try { return await subtle().verify({ name: 'Ed25519' }, key, sig, prefixed(kind, message)); } catch { return false; }
}
const signBytes = async (kind, privateKey, message) => new Uint8Array(await subtle().sign({ name: 'Ed25519' }, privateKey, prefixed(kind, message)));
// A private key kept as text (the Worker's secret): base64url PKCS#8.
const importPrivate = (pkcs8Text, extractable = false) => subtle().importKey('pkcs8', b64u.dec(String(pkcs8Text).trim()), { name: 'Ed25519' }, extractable, ['sign']);
async function publicOf(privateKey) { return (await subtle().exportKey('jwk', privateKey)).x; } // needs an extractable key
async function newKeyPair() {
  const pair = await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return { publicKey: b64u.enc(await subtle().exportKey('raw', pair.publicKey)), pkcs8: new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey)) };
}

/* --------------------------- making and checking --------------------------- */
// Signs a code. The same fields and serial always give the same code (Ed25519 signatures are deterministic), which is
// how the shop's thank-you page and its email show the same code.
async function signCode(privateKey, kid, fields) {
  const payload = packPayload({ ...fields, kid, serial: fields.serial || randomSerial() });
  return formatCode(concat(payload, await signBytes('licence', privateKey, payload)));
}
// { status: 'valid' | 'expired', licence } or throws LicenceError ('invalid' | 'newer' | 'unknown-key').
async function verifyCode(text, { keys, now = Date.now() } = {}) {
  const bytes = extract(text);
  if (bytes.length < HEADER + 2 + SIG) throw new LicenceError('invalid', 'The code is incomplete. Copy it again, including every group.');
  const payload = bytes.subarray(0, bytes.length - SIG), sig = bytes.subarray(bytes.length - SIG);
  const lic = unpackPayload(payload);
  if (!keys || !keys[lic.kid]) throw new LicenceError('unknown-key', 'This version of Vdex does not recognise who made this code. Update Vdex, then enter it again.');
  if (!(await verifyBytes('licence', payload, sig, lic.kid, keys))) throw new LicenceError('invalid', 'This code is not valid. Copy it again from your email, including every group.');
  if (lic.edition !== EDITION_DESKTOP) throw new LicenceError('invalid', 'This code is not for the Vdex desktop app.');
  lic.ref = refOf(lic.kid, lic.serial);
  lic.code = formatCode(bytes);
  if (lic.expires && now >= Date.parse(lic.expires + 'T00:00:00Z') + DAY) return { status: 'expired', licence: lic };
  return { status: 'valid', licence: lic };
}

// Signed notes: { kid, data: "<JSON text>", sig: "<base64url>" }.
async function signNote(kind, privateKey, kid, value) {
  const data = JSON.stringify(value);
  return { kid, data, sig: b64u.enc(await signBytes(kind, privateKey, enc.encode(data))) };
}
// The note's value if it is signed by one of `signers` (key numbers; all known keys when left out), else null.
async function readNote(kind, note, { keys, signers } = {}) {
  try {
    if (!note || typeof note.data !== 'string' || note.data.length > 4000 || !Number.isInteger(note.kid)) return null;
    if (signers && !signers.includes(note.kid)) return null;
    if (!(await verifyBytes(kind, enc.encode(note.data), b64u.dec(String(note.sig)), note.kid, keys))) return null;
    const v = JSON.parse(note.data); return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/* ---------------------- the owner's key files (generator) ---------------------- */
// A key file holds the private key encrypted with the owner's passphrase (PBKDF2 → AES-GCM), so a copy of the file alone
// cannot make codes.
async function wrappingKey(passphrase, salt, iterations) {
  if (String(passphrase).length < 12) throw new Error('Use a passphrase of at least 12 characters');
  const base = await subtle().importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aad = (kid, pub) => enc.encode(`vdex-licence-key|${kid}|${pub}`);
async function sealKeyFile(kid, pkcs8, publicKeyText, passphrase, label = '', iterations = 600000) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(kid, publicKeyText) }, await wrappingKey(passphrase, salt, iterations), pkcs8);
  return { type: 'vdex-licence-signing-key', version: 1, kid, label, alg: 'Ed25519', publicKey: publicKeyText, created: today(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64u.enc(salt) }, cipher: { name: 'AES-GCM', iv: b64u.enc(iv) }, encryptedPrivateKey: b64u.enc(ct) };
}
async function createKeyFile({ kid, passphrase, label = '', iterations }) {
  const { publicKey: pub, pkcs8 } = await newKeyPair();
  try { return await sealKeyFile(kid, pkcs8, pub, passphrase, label, iterations); } finally { pkcs8.fill(0); }
}
async function decryptKeyFile(file, passphrase) {
  if (!file || file.type !== 'vdex-licence-signing-key' || file.version !== 1) throw new Error('This is not a Vdex licence key file');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64u.dec(file.cipher.iv), additionalData: aad(file.kid, file.publicKey) },
      await wrappingKey(passphrase, b64u.dec(file.kdf.salt), file.kdf.iterations), b64u.dec(file.encryptedPrivateKey)));
  } catch (e) { if (/at least 12/.test(e.message)) throw e; throw new Error('Wrong passphrase, or the key file is damaged'); }
}
// Opens a key file for signing. The key cannot be read back out of the page, only used.
async function openKeyFile(file, passphrase) {
  const pkcs8 = await decryptKeyFile(file, passphrase);
  let privateKey; try { privateKey = await subtle().importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']); } finally { pkcs8.fill(0); }
  const probe = enc.encode('self-test'), pub = await publicKey(file.kid, { [file.kid]: file.publicKey });
  if (!pub || !(await subtle().verify({ name: 'Ed25519' }, pub, await subtle().sign({ name: 'Ed25519' }, privateKey, probe), probe))) throw new Error('The key file does not match its public key');
  return { kid: file.kid, publicKey: file.publicKey, label: file.label || '', privateKey };
}
// The shop key as the text the Worker keeps as a secret (base64url PKCS#8).
async function shopSecret(file, passphrase) { const pkcs8 = await decryptKeyFile(file, passphrase); try { return b64u.enc(pkcs8); } finally { pkcs8.fill(0); } }
// Paper backup: the 32-byte private seed as 52 characters. Anyone holding it can make codes: store it like cash.
async function paperBackup(file, passphrase) {
  const pkcs8 = await decryptKeyFile(file, passphrase);
  let k; try { k = await subtle().importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']); } finally { pkcs8.fill(0); }
  return `key ${file.kid}: ` + b32encode(b64u.dec((await subtle().exportKey('jwk', k)).d)).match(/.{1,4}/g).join(' ');
}
async function keyFileFromPaper(backup, passphrase, label = '') {
  const m = String(backup).match(/^\s*key\s*(\d{1,3})\s*:([\s\S]*)$/i); if (!m) throw new Error('A paper backup starts with "key 1:" (or the key\'s number)');
  const seed = b32decode(m[2]); if (seed.length !== 32) throw new Error('A paper backup has 52 characters after the key number');
  const pkcs8 = concat(PKCS8_ED25519, seed);
  try { const k = await subtle().importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']); return await sealKeyFile(Number(m[1]), pkcs8, await publicOf(k), passphrase, label); } finally { pkcs8.fill(0); }
}

module.exports = {
  EPOCH, DAY, SEATS, OWNER_KIDS, LicenceError, b64u, b32encode, b32decode, formatCode, extract, cleanCode, packPayload, unpackPayload,
  refOf, today, fitText, randomSerial, signCode, verifyCode, signNote, readNote, importPrivate, publicOf, newKeyPair,
  createKeyFile, openKeyFile, shopSecret, paperBackup, keyFileFromPaper,
};

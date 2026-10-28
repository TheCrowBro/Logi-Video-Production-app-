// WebCrypto helpers for the app lock and encrypted backups: AES-256-GCM for data, PBKDF2-SHA-256 for PINs and
// passphrases, HKDF for a key that comes from a biometric (WebAuthn PRF) secret. Nothing here keeps state.
const enc = new TextEncoder(), dec = new TextDecoder();
export const PBKDF2_ITERATIONS = 300000;
export const bytes = n => crypto.getRandomValues(new Uint8Array(n));
export function toB64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const toB64url = buf => toB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = s => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
export async function pbkdf2Key(secret, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function hkdfKey(ikm, salt, info) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const importAesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
export const generateDeviceKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
export async function encrypt(key, data) {
  const iv = bytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, typeof data === 'string' ? enc.encode(data) : data);
  return { iv: toB64(iv), ct: toB64(ct) };
}
export async function decrypt(key, box) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct))); }
export const decryptText = async (key, box) => dec.decode(await decrypt(key, box));
export const sha256 = data => crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data);
export const utf8 = buf => dec.decode(buf);

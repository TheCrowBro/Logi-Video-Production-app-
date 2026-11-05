// Checks what Apple signs for an App Store purchase: a StoreKit 2 transaction, or an App Store Server Notification.
// Both are JWS (JSON Web Signatures) whose header carries the signing certificate chain (x5c): the leaf that signed,
// Apple's Worldwide Developer Relations intermediate, and Apple Root CA - G3. We check that the chain is unbroken and
// of that shape (a leaf, one intermediate marked as Apple's (OID 1.2.840.113635.100.6.2.1), the root), that every
// certificate that signs another is a certificate authority (basicConstraints CA, keyCertSign where key usage is
// given: a developer's own Apple certificate must never pass as an issuer), that the chain ends at the Apple root
// built in here (its DER, fingerprint 63 34 3A BF …), that every certificate is within its dates, that the leaf is
// marked for the App Store (OID 1.2.840.113635.100.6.11.1), and that the signature over the JWS is the leaf's.
// Nothing is fetched: the root is pinned, as Apple recommends.
const APPLE_ROOT_B64 = 'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
const APPLE_APP_STORE_OID = '1.2.840.113635.100.6.11.1';
const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1'; // Apple's Worldwide Developer Relations intermediate
const BASIC_CONSTRAINTS = '2.5.29.19', KEY_USAGE = '2.5.29.15';
const b64 = { dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)) };
const text = u8 => new TextDecoder().decode(u8);

/* ------------------------------ a little DER ------------------------------ */
// One element: its tag, where its content starts and ends, and where the next element begins.
function el(u8, at) {
  if (at >= u8.length) throw new Error('DER: past the end');
  const tag = u8[at]; let p = at + 1, len = u8[p++];
  if (len & 0x80) { const n = len & 0x7f; if (n === 0 || n > 4) throw new Error('DER: bad length'); len = 0; for (let i = 0; i < n; i++) len = (len << 8) | u8[p++]; }
  if (p + len > u8.length) throw new Error('DER: length past the end');
  return { tag, start: p, end: p + len, next: p + len, raw: u8.subarray(at, p + len) };
}
// The children of a constructed element (a SEQUENCE, a SET, a context tag).
function kids(u8, e) { const out = []; for (let p = e.start; p < e.end;) { const k = el(u8, p); out.push(k); p = k.next; } return out; }
function oid(u8, e) {
  if (e.tag !== 0x06) throw new Error('DER: not an OID');
  const b = u8.subarray(e.start, e.end), parts = [];
  let v = 0;
  for (let i = 0; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { if (!parts.length) parts.push(Math.floor(v / 40), v % 40); else parts.push(v); v = 0; } }
  return parts.join('.');
}
function time(u8, e) { // UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime (YYYYMMDDHHMMSSZ)
  const s = text(u8.subarray(e.start, e.end));
  const m = e.tag === 0x17 ? s.match(/^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/) : s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/);
  if (!m) throw new Error('DER: bad time');
  const y = e.tag === 0x17 ? Number(m[1]) + (Number(m[1]) < 50 ? 2000 : 1900) : Number(m[1]);
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
}
const CURVES = { '1.2.840.10045.3.1.7': ['P-256', 32], '1.3.132.0.34': ['P-384', 48], '1.3.132.0.35': ['P-521', 66] };
const HASHES = { '1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384', '1.2.840.10045.4.3.4': 'SHA-512' };

// The parts of an X.509 certificate that the check needs.
export function parseCert(der) {
  const u8 = der instanceof Uint8Array ? der : new Uint8Array(der);
  const cert = el(u8, 0); if (cert.tag !== 0x30) throw new Error('not a certificate');
  const [tbs, sigAlg, sigVal] = kids(u8, cert);
  let fields = kids(u8, tbs);
  if (fields[0].tag === 0xa0) fields = fields.slice(1); // the version, when present
  const [, , issuer, validity, subject, spki, ...rest] = fields; // serial, signature algorithm (inside the tbs), issuer, validity, subject, key, then the extensions
  const [notBefore, notAfter] = kids(u8, validity).map(t => time(u8, t));
  const [keyAlg] = kids(u8, spki), [keyType, curve] = kids(u8, keyAlg);
  if (oid(u8, keyType) !== '1.2.840.10045.2.1') throw new Error('not an EC key');
  const [curveName, coordBytes] = CURVES[oid(u8, curve)] || [];
  if (!curveName) throw new Error('unknown curve');
  const sigOid = oid(u8, kids(u8, sigAlg)[0]), hash = HASHES[sigOid];
  if (!hash) throw new Error('unknown signature algorithm');
  const extensions = [];
  let ca = false, keyCertSign = null; // basicConstraints, and keyUsage when the certificate has one
  const ext = rest.find(r => r.tag === 0xa3);
  if (ext) for (const x of kids(u8, kids(u8, ext)[0])) {
    const parts = kids(u8, x), id = oid(u8, parts[0]), value = parts[parts.length - 1]; // extnID, critical (optional), extnValue
    extensions.push(id);
    if (id === BASIC_CONSTRAINTS) { const inner = el(u8, value.start); const flag = kids(u8, inner).find(k => k.tag === 0x01); ca = !!(flag && u8[flag.start] !== 0); }
    if (id === KEY_USAGE) { const bits = el(u8, value.start); keyCertSign = bits.end > bits.start + 1 && (u8[bits.start + 1] & 0x04) !== 0; } // the first content byte after the unused-bits count; keyCertSign is bit 5
  }
  const sig = u8.subarray(sigVal.start + 1, sigVal.end); // the BIT STRING's unused-bits byte, then the DER signature
  return { der: u8, tbs: tbs.raw, issuer: issuer.raw, subject: subject.raw, notBefore, notAfter, spki: spki.raw, curveName, coordBytes, hash, sig, extensions, ca, keyCertSign };
}
// An ECDSA signature in DER (SEQUENCE of two INTEGERs) → the fixed-width r||s that WebCrypto takes.
function rawSig(der, n) {
  const seq = el(der, 0), [r, s] = kids(der, seq);
  const fit = e => { let b = der.subarray(e.start, e.end); while (b.length > n && b[0] === 0) b = b.subarray(1); if (b.length > n) throw new Error('bad signature'); const out = new Uint8Array(n); out.set(b, n - b.length); return out; };
  const out = new Uint8Array(2 * n); out.set(fit(r), 0); out.set(fit(s), n); return out;
}
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const keyOf = c => crypto.subtle.importKey('spki', c.spki, { name: 'ECDSA', namedCurve: c.curveName }, false, ['verify']);

// The chain, leaf first: the leaf, Apple's intermediate, then the pinned root (sent or not). Each certificate is
// signed by the next, and only a certificate authority may sign: a certificate issued to a person or a device, even
// one of Apple's, cannot stand in for Apple's intermediate.
export async function verifyChain(certs, { root = b64.dec(APPLE_ROOT_B64), now = Date.now() } = {}) {
  if (!certs.length) throw new Error('no certificate');
  const rootCert = parseCert(root);
  const chain = certs.map(parseCert);
  if (chain.length === 3 && !eq(chain[2].der, rootCert.der)) throw new Error('not Apple\'s root');
  if (chain.length < 2 || chain.length > 3) throw new Error('not an App Store chain');
  for (const c of chain) if (now < c.notBefore || now > c.notAfter) throw new Error('a certificate is out of date');
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i], signer = i + 1 < chain.length ? chain[i + 1] : rootCert;
    if (i + 1 === chain.length && eq(c.der, rootCert.der)) break; // the chain ends with the root itself
    if (!eq(c.issuer, signer.subject)) throw new Error('the chain is broken');
    if (!signer.ca || signer.keyCertSign === false) throw new Error('signed by a certificate that is not an authority');
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: c.hash }, await keyOf(signer), rawSig(c.sig, signer.coordBytes), c.tbs);
    if (!ok) throw new Error('a certificate signature does not verify');
  }
  const last = chain[chain.length - 1];
  if (!eq(last.der, rootCert.der) && !eq(last.issuer, rootCert.subject)) throw new Error('not Apple\'s root');
  if (chain[0].ca) throw new Error('the signing certificate is an authority');
  if (!chain[1].extensions.includes(APPLE_INTERMEDIATE_OID)) throw new Error('not Apple\'s intermediate');
  return chain[0];
}

// A JWS from Apple → its payload (an object), once everything checks out. opts.root replaces the pinned root (tests).
export async function verifyAppleJws(jws, opts = {}) {
  const parts = String(jws || '').split('.');
  if (parts.length !== 3) throw new Error('not a JWS');
  const header = JSON.parse(text(b64.dec(parts[0])));
  if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || !header.x5c.length) throw new Error('not an Apple signature');
  const leaf = await verifyChain(header.x5c.map(b64.dec), opts);
  if (!leaf.extensions.includes(APPLE_APP_STORE_OID)) throw new Error('not signed for the App Store');
  if (leaf.curveName !== 'P-256') throw new Error('unexpected key');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await keyOf(leaf), b64.dec(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('the signature does not verify');
  return JSON.parse(text(b64.dec(parts[1])));
}

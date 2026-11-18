// Packs a document into a link: JSON → deflate (when the browser has CompressionStream) → base64url. The result
// travels in the URL fragment, which browsers never send to any server; the page that opens it unpacks it locally.
const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const pipe = async (bytes, Stream, kind) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(kind))).arrayBuffer());
// Unpacking with a ceiling: a few thousand characters can be made to unpack into gigabytes, so a reader that takes
// links from strangers stops as soon as the ceiling is passed (the error's code is 'big').
async function inflate(bytes, max) {
  if (!max) return pipe(bytes, DecompressionStream, 'deflate-raw');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
  for (let n = 0; ;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; if (n > max) { reader.cancel().catch(() => {}); throw Object.assign(new Error('This link holds too much to open.'), { code: 'big' }); }
    parts.push(value);
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
export async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') { try { return '1.' + toB64(await pipe(bytes, CompressionStream, 'deflate-raw')); } catch { /* plain below */ } }
  return '0.' + toB64(bytes);
}
export async function unpack(str, { max = 0 } = {}) {
  const [v, data] = String(str || '').replace(/^#/, '').split('.', 2);
  if (!data) throw new Error('This link does not contain a document.');
  let bytes = fromB64(data);
  if (v === '1') bytes = await inflate(bytes, max);
  else if (max && bytes.length > max) throw Object.assign(new Error('This link holds too much to open.'), { code: 'big' });
  return JSON.parse(new TextDecoder().decode(bytes));
}

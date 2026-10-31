// Packs a document into a link: JSON → deflate (when the browser has CompressionStream) → base64url. The result
// travels in the URL fragment, which browsers never send to any server; the page that opens it unpacks it locally.
const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0));
const pipe = async (bytes, Stream, kind) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new Stream(kind))).arrayBuffer());
export async function pack(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') { try { return '1.' + toB64(await pipe(bytes, CompressionStream, 'deflate-raw')); } catch { /* plain below */ } }
  return '0.' + toB64(bytes);
}
export async function unpack(str) {
  const [v, data] = String(str || '').replace(/^#/, '').split('.', 2);
  if (!data) throw new Error('This link does not contain a document.');
  let bytes = fromB64(data);
  if (v === '1') bytes = await pipe(bytes, DecompressionStream, 'deflate-raw');
  return JSON.parse(new TextDecoder().decode(bytes));
}

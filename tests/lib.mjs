// Shared bits for the browser specs: a static server serving a scratch copy of the app (specs may rewrite files
// to simulate a new deploy), a browser, and a tiny assertion that prints PASS / FAIL lines the runner counts.
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const codes = createRequire(import.meta.url)('../desktop/licence-codes.js');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.txt': 'text/plain' };
export function scratchCopy(repoRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'vdex-test-'));
  // Packages are left out at every level (cloudflare/node_modules alone is 200 MB; nothing the specs serve or bundle needs them).
  for (const n of readdirSync(repoRoot)) if (!['node_modules', 'dist', '.git', 'tests', '.github'].includes(n)) cpSync(join(repoRoot, n), join(dir, n), { recursive: true, filter: src => !/(^|[\\/])node_modules$/.test(src) });
  return dir;
}
// Licences are on unless the licence server sends a note, signed with a key whose public half is built into the page
// (KEYS in js/licence-web.js), saying they are off. The browser specs run with them off, as before the owner switched
// them on: each run makes a key of its own, puts its public half in place of the real ones in the scratch copy (the
// only copy that changes), and the server below answers the status address with a fresh note signed with it. Specs
// get the private half as VDEX_STATUS_KEY (base64url PKCS#8), to sign notes of their own or to give to the licence
// server they start.
export async function testKey(root) {
  const pair = await codes.newKeyPair(), file = join(root, 'js', 'licence-web.js'), src = readFileSync(file, 'utf8');
  const out = src.replace(/^const KEYS = \{[^\n]*\};$/m, () => `const KEYS = ${JSON.stringify({ 2: pair.publicKey })};`);
  if (out === src) throw new Error('js/licence-web.js has no line "const KEYS = {…};" to put the test key in');
  writeFileSync(file, out);
  return codes.b64u.enc(pair.pkcs8);
}
// A note signed with that key: by default the one the live Worker sends while licences are switched off.
export async function statusNote(key, value = { off: true, at: Date.now() }) { return codes.signNote('status', await codes.importPrivate(key), 2, value); }

export function serve(root, port = 0, key = process.env.VDEX_STATUS_KEY) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    // The live site's Worker answers this; here licences are switched off, as before the owner switched them on.
    if (p === '/licence/web/status') { const body = JSON.stringify({ on: false, ...(key ? { note: await statusNote(key) } : {}) }); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(body); }
    const file = resolve(root, '.' + p); if (!file.startsWith(resolve(root))) { res.writeHead(403); return res.end(); }
    try { statSync(file); } catch { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

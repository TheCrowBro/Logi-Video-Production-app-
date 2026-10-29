// Shared bits for the browser specs: a static server serving a scratch copy of the app (specs may rewrite files
// to simulate a new deploy), a browser, and a tiny assertion that prints PASS / FAIL lines the runner counts.
import { createServer } from 'node:http';
import { createReadStream, statSync, mkdtempSync, cpSync, readdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown', '.txt': 'text/plain' };
export function scratchCopy(repoRoot) {
  const dir = mkdtempSync(join(tmpdir(), 'vdex-test-'));
  for (const n of readdirSync(repoRoot)) if (!['node_modules', 'dist', '.git', 'tests', '.github'].includes(n)) cpSync(join(repoRoot, n), join(dir, n), { recursive: true });
  return dir;
}
export function serve(root, port = 0) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const file = resolve(root, '.' + p); if (!file.startsWith(resolve(root))) { res.writeHead(403); return res.end(); }
    try { statSync(file); } catch { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

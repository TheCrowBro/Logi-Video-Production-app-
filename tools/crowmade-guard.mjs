// Run by tools/deploy-crowmade.sh before it publishes crowmade/: a Cloudflare Pages deployment replaces the whole site, so this
// reads the live site at crowmade.pages.dev (from the home page and a few well-known files, following the site's own links) and
// refuses if any page or file there is missing from crowmade/. The pages this repository owns (/, /vdex/, /valheim/) may change;
// Little Journee's /journee/ and /littlelog/ are a Worker of their own (not part of the Pages site) and are ignored.
//   node tools/crowmade-guard.mjs    exit 0: nothing would go; 1: the list of what would; 2: the live site couldn't be read
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE = 'https://crowmade.pages.dev', root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'crowmade');
const SKIP = /^\/(journee|littlelog|cdn-cgi)(\/|$)/;
// An address with a rule in crowmade/_redirects is sent on deliberately, so it counts as published.
const redirected = new Set((fs.existsSync(path.join(root, '_redirects')) ? fs.readFileSync(path.join(root, '_redirects'), 'utf8') : '')
  .split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean));
const local = p => {
  if (redirected.has(p)) return true;
  const c = decodeURIComponent(p), cands = c.endsWith('/') ? [c + 'index.html'] : [c, c + '.html', c + '/index.html'];
  return cands.some(x => { const f = path.join(root, x); return f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile(); });
};
const seen = new Set(), queue = ['/', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/404.html'], missing = [];
let home;
while (queue.length) {
  const p = queue.shift(); if (seen.has(p) || SKIP.test(p)) continue; seen.add(p);
  let res; try { res = await fetch(LIVE + p, { redirect: 'manual' }); } catch (e) { console.error('Could not read', LIVE + p, e.message); process.exit(2); }
  if (p === '/') home = await res.clone().text();
  if (res.status !== 200) continue;
  const body = await res.text();
  // Pages serves the home page for unknown addresses: a well-known file that is just the home page isn't really there.
  if (p !== '/' && body === home) continue;
  if (!local(p)) missing.push(p);
  if (/text\/(html|css)/.test(res.headers.get('content-type') || '')) {
    for (const m of body.matchAll(/(?:href|src)="([^"#?]+)|url\(['"]?([^'")#?]+)/g)) {
      const u = new URL(m[1] || m[2], LIVE + p); if (u.origin === LIVE) queue.push(u.pathname);
    }
  }
}
if (missing.length) { console.error('Not published: these are live on crowmade.app but not in crowmade/, and would be removed:\n  ' + missing.join('\n  ')); process.exit(1); }
console.log(`Guard: all ${seen.size} live addresses checked; nothing would be removed.`);

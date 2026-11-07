// Run by tools/deploy-crowmade.sh before it publishes crowmade/: a Cloudflare Pages deployment replaces the whole site, and
// other sessions publish it too, so this reads the live site at crowmade.pages.dev (from the home page and a few well-known
// files, following the site's own links) and refuses if
//   - a page or file there is missing from crowmade/ (publishing would remove it), or
//   - a page or file there has changed since this branch last published it (tools/crowmade-published.json): another
//     session published newer work, which this copy does not have and would undo.
// The pages this repository owns (/, /vdex/, /valheim/) may differ from the live site when the change is this branch's own.
// Little Journee's /journee/ and /littlelog/ are a Worker of their own (not part of the Pages site) and are ignored.
//   node tools/crowmade-guard.mjs           exit 0: safe to publish; 1: the list of what would go or be undone; 2: the live
//                                           site couldn't be read
//   node tools/crowmade-guard.mjs --record  after publishing: writes tools/crowmade-published.json (each file's hash, the commit)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIVE = (process.env.CROWMADE_LIVE || 'https://crowmade.pages.dev').replace(/\/$/, ''); // CROWMADE_LIVE: tests only
const root = path.join(here, '..', 'crowmade'), RECORD = path.join(here, 'crowmade-published.json');
const SKIP = /^\/(journee|littlelog|cdn-cgi)(\/|$)/;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const walk = d => fs.readdirSync(d).sort().flatMap(n => { const p = path.join(d, n); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = f => path.relative(root, f).split(path.sep).join('/');

if (process.argv.includes('--record')) {
  let commit = ''; try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(here, '..') }).toString().trim(); } catch { /* not a checkout */ }
  const files = Object.fromEntries(walk(root).map(f => [rel(f), sha(fs.readFileSync(f))]));
  fs.writeFileSync(RECORD, JSON.stringify({ commit, at: new Date().toISOString(), files }, null, 2) + '\n');
  console.log(`Recorded what is live in tools/crowmade-published.json (${Object.keys(files).length} files, commit ${commit.slice(0, 7)}). Commit and push it.`);
  process.exit(0);
}

const published = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : { files: {} };
// An address with a rule in crowmade/_redirects is sent on deliberately, so it counts as published.
const redirected = new Set((fs.existsSync(path.join(root, '_redirects')) ? fs.readFileSync(path.join(root, '_redirects'), 'utf8') : '')
  .split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean));
const local = p => {
  const c = decodeURIComponent(p), cands = c.endsWith('/') ? [c + 'index.html'] : [c, c + '.html', c + '/index.html'];
  for (const x of cands) { const f = path.join(root, x); if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
};
const seen = new Set(), queue = ['/', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/404.html'], missing = [], undone = [];
let home;
while (queue.length) {
  const p = queue.shift(); if (seen.has(p) || SKIP.test(p)) continue; seen.add(p);
  let res; try { res = await fetch(LIVE + p, { redirect: 'manual' }); } catch (e) { console.error('Could not read', LIVE + p, e.message); process.exit(2); }
  if (res.status !== 200) continue;
  const body = Buffer.from(await res.arrayBuffer());
  if (p === '/') home = body;
  // Pages serves the home page for unknown addresses: a well-known file that is just the home page isn't really there.
  if (p !== '/' && home && body.equals(home)) continue;
  const f = local(p);
  if (!f) { if (!redirected.has(p)) missing.push(p); }
  else {
    // Changed since this branch last published it? Without a record of that, any difference counts.
    const was = published.files[rel(f)], live = sha(body);
    if (was ? live !== was : live !== sha(fs.readFileSync(f))) undone.push(p);
  }
  if (/text\/(html|css)/.test(res.headers.get('content-type') || '')) {
    for (const m of body.toString('utf8').matchAll(/(?:href|src)="([^"#?]+)|url\(['"]?([^'")#?]+)/g)) {
      const u = new URL(m[1] || m[2], LIVE + p); if (u.origin === LIVE) queue.push(u.pathname);
    }
  }
}
if (missing.length) console.error('Not published: these are live on crowmade.app but not in crowmade/, and would be removed:\n  ' + missing.join('\n  '));
if (undone.length) console.error(`Changed on crowmade.app since this branch last published it${published.commit ? ` (commit ${published.commit.slice(0, 7)})` : ''}: another session published newer work, which publishing this copy would undo:\n  ` + undone.join('\n  ')
  + '\nFetch every branch (git fetch origin; git branch -r --sort=-committerdate), bring that work into this one, then publish again.');
if (missing.length || undone.length) process.exit(1);
console.log(`Guard: all ${seen.size} live addresses checked; nothing would be removed or undone.`);

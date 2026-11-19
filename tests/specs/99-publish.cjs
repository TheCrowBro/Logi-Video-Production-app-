// What gets published: only the website's own files (never the Android, iPhone (apple/), desktop, docs, store or test
// sources), the Cloudflare copy with headers that match each page's own security policy, the dormant-until-set-up
// Cloudflare job, and an Android app whose package, address and asset links agree with each other and with
// vdex.crowmade.app.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
const REPO = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

try {
  // ---- the staged website ----
  const out = 'stage-test-' + process.pid;
  execFileSync(process.execPath, ['tools/stage-site.mjs', out], { cwd: ROOT, stdio: 'pipe' });
  const files = walk(path.join(ROOT, out)).map(f => path.relative(path.join(ROOT, out), f).split(path.sep).join('/'));
  const tops = [...new Set(files.map(f => f.split('/')[0]))].sort();
  ok('only the website is published: pages, styles, manifest, worker, js, vendor, icons and .well-known', JSON.stringify(tops) === JSON.stringify(['.well-known', 'crew.html', 'delete-account.html', 'download.html', 'icons', 'index.html', 'invoice.html', 'js', 'manifest.webmanifest', 'privacy.html', 'shared.html', 'signin-google.html', 'styles.css', 'sw.js', 'terms.html', 'vendor']), tops.join(', '));
  ok('no Android, iPhone, desktop, docs, store, test or tool files, no signing key, and never the licence generator or keys', !files.some(f => /^(android|apple|desktop|docs|store|tests|tools|cloudflare|\.github)\/|keystore|licence-(generator|key|codes)|package(-lock)?\.json$|\.md$/.test(f) && f !== 'vendor/LICENSES.md'), files.filter(f => /keystore|^android|^apple|^docs|licence-/.test(f)).join(', '));
  const shell = [...read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
  ok('every file the offline copy asks for is published', shell.every(f => files.includes(f)), shell.filter(f => !files.includes(f)).join(', '));
  ok('no _headers or _redirects in the plain copy', !files.includes('_headers') && !files.includes('_redirects'));
  const WORKER_ROUTES = JSON.parse(read('tools/site-files.mjs').match(/export const WORKER_ROUTES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const swRoutes = JSON.parse(read('sw.js').match(/const WORKER_ROUTES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  ok('the offline copy leaves the Worker\'s addresses (Buy, the code after paying) to the server', JSON.stringify(swRoutes) === JSON.stringify(WORKER_ROUTES) && /workerRoute\(new URL\(req\.url\)\)\) return;/.test(read('sw.js')) && /WORKER_ROUTES/.test(read('tools/stamp-build.mjs')));
  fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
  // a page nobody added to the list, or a link to a file that is not published, stops the deploy
  const stray = path.join(ROOT, 'stray-' + process.pid + '.html'); fs.writeFileSync(stray, '<!doctype html>');
  let refused = ''; try { execFileSync(process.execPath, ['tools/stage-site.mjs', out], { cwd: ROOT, stdio: 'pipe' }); } catch (e) { refused = String(e.stderr); }
  fs.rmSync(stray); fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
  ok('a new page left out of tools/site-files.mjs stops the deploy instead of silently missing', /not in tools\/site-files\.mjs/.test(refused), refused.slice(0, 120));
  const priv = read('privacy.html'); fs.writeFileSync(path.join(ROOT, 'privacy.html'), priv.replace('</body>', '<a href="docs/nowhere.md">x</a></body>'));
  refused = ''; try { execFileSync(process.execPath, ['tools/stage-site.mjs', out], { cwd: ROOT, stdio: 'pipe' }); } catch (e) { refused = String(e.stderr); }
  fs.writeFileSync(path.join(ROOT, 'privacy.html'), priv); fs.rmSync(path.join(ROOT, out), { recursive: true, force: true });
  ok('a page linking to an unpublished file stops the deploy', /privacy\.html → docs\/nowhere\.md/.test(refused), refused.slice(0, 120));

  // ---- the Cloudflare copy ----
  const cf = 'stage-cf-' + process.pid;
  execFileSync(process.execPath, ['tools/stage-site.mjs', cf, '--cloudflare'], { cwd: ROOT, stdio: 'pipe' });
  const headers = fs.readFileSync(path.join(ROOT, cf, '_headers'), 'utf8'), redirects = fs.readFileSync(path.join(ROOT, cf, '_redirects'), 'utf8');
  const block = p => { const m = headers.split(/\n(?=\S)/).find(b => b.split('\n')[0] === p); return m || ''; };
  const pages = ['index.html', 'privacy.html', 'terms.html', 'invoice.html', 'crew.html', 'shared.html', 'delete-account.html'];
  const match = pages.every(f => { const meta = read(f).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].trim().replace(/;$/, ''); return block('/' + f).includes(`Content-Security-Policy: ${meta}; frame-ancestors 'none'`); });
  ok('each page\'s security header is its own meta policy plus frame-ancestors', match);
  ok('"/" gets the start page\'s policy, and pages, worker and manifest are never cached stale', block('/').includes('Content-Security-Policy') && /Cache-Control: no-cache/.test(block('/sw.js')) && /no-cache/.test(block('/manifest.webmanifest')) && /no-cache/.test(block('/index.html')));
  ok('the asset links file is served as JSON', /Content-Type: application\/json/.test(block('/.well-known/assetlinks.json')));
  ok('"/" shows index.html instead of redirecting', redirects.trim() === '/ /index.html 200');
  ok('no _headers line is over Cloudflare\'s limit', headers.split('\n').every(l => l.length <= 2000));
  fs.rmSync(path.join(ROOT, cf), { recursive: true, force: true });

  // ---- the Cloudflare Worker and the workflow ----
  const wr = JSON.parse(read('cloudflare/wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  ok('the Worker serves static files by their own names at vdex.crowmade.app, with no workers.dev address', wr.name === 'vdex' && wr.assets.directory === './site' && wr.assets.html_handling === 'none' && JSON.stringify(wr.routes) === JSON.stringify([{ pattern: 'vdex.crowmade.app', custom_domain: true }]) && wr.workers_dev === false && wr.preview_urls === false);
  const lock = JSON.parse(read('cloudflare/package-lock.json'));
  ok('Wrangler is pinned to an exact version with its checksum', /^\d+\.\d+\.\d+$/.test(JSON.parse(read('cloudflare/package.json')).devDependencies.wrangler) && /^sha512-/.test(lock.packages['node_modules/wrangler'].integrity));
  const yml = fs.readFileSync(path.join(REPO, '.github/workflows/pages.yml'), 'utf8');
  ok('only Cloudflare publishes now (GitHub Pages stopped when the repository went private), from the staged site', !/upload-pages-artifact|deploy-pages|configure-pages|pages: write/.test(yml) && /stage-site\.mjs cloudflare\/site --cloudflare/.test(yml));
  ok('each change is tested once: on the working branch, not again on main', /\n  test:\n(?:.*\n){0,3}\s+if: github\.ref != 'refs\/heads\/main'/.test(yml));
  const cfJob = (yml.split('\n  cloudflare:\n')[1] || '').split(/\n  [a-z-]+:\n/)[0];
  ok('the Cloudflare job is skipped until its secrets exist, and its action is pinned by commit', /\n  cloudflare-ready:\n/.test(yml) && /needs: cloudflare-ready\n/.test(cfJob) && /if: github\.ref == 'refs\/heads\/main' && needs\.cloudflare-ready\.outputs\.go == '1'/.test(cfJob) && /cloudflare\/wrangler-action@[0-9a-f]{40} /.test(cfJob));
  ok('the live check only calls a missing address "not attached yet", and fails on a broken deploy', /6\|7\|35\|60\)/.test(cfJob) && /answered HTTP \$code after the deploy/.test(cfJob));
  const andr = fs.readFileSync(path.join(REPO, '.github/workflows/android.yml'), 'utf8');
  ok('the Android app is no longer published as a free public download, and the old one is removed in a job of its own', !/gh release create/.test(andr) && /\n  unpublish:\n/.test(andr) && /gh release delete android-latest/.test(andr) && /actions\/artifacts\/\$id/.test(andr) && /^permissions:\n  contents: read$/m.test(andr));
  ok('only the Play file is kept, for 3 days, and only from a build signed with the upload key', /if: env\.KEY_KIND == 'upload key'\n\s+uses: actions\/upload-artifact@[0-9a-f]{40}/.test(andr) && /retention-days: 3\n\s+path: android\/vdex-android\.aab\n/.test(andr) && !/path:[\s|]*[^\n]*\.apk/.test(andr));

  // ---- the desktop app's package ----
  // The installers carry the files package.json lists (build.files). A page in there that links to a page left out
  // would open on "Not found" in the desktop app: the privacy policy links to the deletion page, for one.
  const packed = JSON.parse(read('package.json')).build.files, packedPages = packed.filter(f => /^[^/*]+\.html$/.test(f));
  const inPack = f => packed.includes(f) || packed.some(g => g.endsWith('/**') && f.startsWith(g.slice(0, -2)));
  const dangling = packedPages.flatMap(pg => [...read(pg).matchAll(/<a\b[^>]*\shref="([^"#?:]+\.html)(?:[#?][^"]*)?"/g)].map(m => m[1]).filter(to => !inPack(to)).map(to => `${pg} → ${to}`));
  ok('the desktop app carries the deletion page, and every page its pages link to', packedPages.includes('delete-account.html') && packedPages.includes('privacy.html') && /href="delete-account\.html"/.test(read('privacy.html')) && !dangling.length, dangling.join(', ') || packedPages.join(', '));
  const needs = [...read('delete-account.html').matchAll(/(?:src|href)="([^"#?:]+\.(?:svg|png|css|js))"/g)].map(m => m[1]);
  ok('…with the files the deletion page itself loads', needs.length > 0 && needs.every(inPack), needs.join(', '));

  // ---- the Android app agrees with itself and the new address ----
  const twa = JSON.parse(read('android/twa-manifest.json')), gradle = read('android/app/build.gradle'), manifest = read('android/app/src/main/AndroidManifest.xml'), strings = read('android/app/src/main/res/values/strings.xml');
  const links = JSON.parse(read('.well-known/assetlinks.json'));
  ok('the Android package is app.crowmade.vdex everywhere', twa.packageId === 'app.crowmade.vdex' && links[0].target.package_name === twa.packageId && gradle.includes(`applicationId: '${twa.packageId}'`) && gradle.includes(`applicationId "${twa.packageId}"`) && gradle.includes(`namespace "${twa.packageId}"`) && manifest.includes(`package="${twa.packageId}"`));
  const javaDir = path.join(ROOT, 'android/app/src/main/java', ...twa.packageId.split('.'));
  ok('the Java sources live in the package\'s folder and declare it', ['Application.java', 'DelegationService.java', 'LauncherActivity.java'].every(f => fs.existsSync(path.join(javaDir, f)) && fs.readFileSync(path.join(javaDir, f), 'utf8').includes(`package ${twa.packageId};`)) && !fs.existsSync(path.join(ROOT, 'android/app/src/main/java/io')));
  ok('the Android app opens vdex.crowmade.app, marked as the Play app', twa.host === 'vdex.crowmade.app' && twa.startUrl === '/index.html?src=play' && gradle.includes(`hostName: '${twa.host}'`) && gradle.includes(`launchUrl: '${twa.startUrl}'`));
  ok('the app\'s manifest, icons, share target and site claim use the new address', gradle.includes("'https://vdex.crowmade.app/manifest.webmanifest'") && twa.webManifestUrl === 'https://vdex.crowmade.app/manifest.webmanifest' && twa.iconUrl.startsWith('https://vdex.crowmade.app/') && twa.shareTarget.action === 'https://vdex.crowmade.app/share' && gradle.includes('\\\\"action\\\\":\\\\"https://vdex.crowmade.app/share\\\\"') && strings.includes('https://vdex.crowmade.app\\"') && !/thecrowbro|127\.0\.0\.1|Logi-Video-Production-app-/.test(gradle + strings + JSON.stringify(twa) + read('android/app/src/main/res/raw/web_app_manifest.json')));
  const types = [...manifest.matchAll(/android:mimeType="([^"]*)"/g)].map(m => m[1]);
  ok('the share filter lists real file types only (Android refuses to install an app whose filter has ".docx")', types.length >= 3 && types.every(t => /^[a-z]+\/[a-z0-9.+-]+$/i.test(t)) && twa.shareTarget.params.files[0].accept.every(t => t.includes('/')), types.join(', '));
  ok('the app\'s built-in copy of the web manifest starts where the Play app starts', JSON.parse(read('android/app/src/main/res/raw/web_app_manifest.json')).start_url === twa.startUrl);
} catch (e) {
  console.log('FAIL spec crashed — ' + (e.stderr ? String(e.stderr) : e.message));
  process.exit(1);
}

#!/usr/bin/env node
// Stamps a build: writes the commit into js/version.js (BUILD, BUILT) and sw.js (cache name), and regenerates the
// service worker's file list from the tree, so every deploy is one versioned set of files and installed apps notice
// it. `--dev` keeps BUILD 'dev' and only refreshes the file list (run it after adding or removing a file). It also
// checks that every stylesheet in css/ is linked from index.html and every page in PAGES exists.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, ROOT_FILES, DIRS } from './site-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
let sha = dev ? 'dev' : process.env.BUILD_SHA || process.env.GITHUB_SHA || '';
if (!sha) { try { sha = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = Date.now().toString(36); } }
const build = dev ? 'dev' : sha.slice(0, 7), built = dev ? '' : new Date().toISOString().slice(0, 10);

const missing = [...PAGES, ...ROOT_FILES].filter(f => !existsSync(path.join(root, f)));
if (missing.length) { console.error('Missing files named in tools/site-files.mjs: ' + missing.join(', ')); process.exit(1); }
const walk = dir => (existsSync(dir) ? readdirSync(dir).sort().flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []);
const rel = p => path.relative(root, p).split(path.sep).join('/');
const files = [...PAGES, ...ROOT_FILES, ...DIRS.flatMap(d => walk(path.join(root, d)).map(rel))].filter(p => !/(^|\/)\./.test(p) && !/\.md$/.test(p));
const shell = ['./', ...files];

const index = readFileSync(path.join(root, 'index.html'), 'utf8');
const unlinked = walk(path.join(root, 'css')).map(rel).filter(f => !index.includes(`href="${f}"`));
if (unlinked.length) { console.error('Stylesheets not linked from index.html: ' + unlinked.join(', ')); process.exit(1); }

const vPath = path.join(root, 'js', 'version.js');
let v = readFileSync(vPath, 'utf8');
v = v.replace(/export const BUILD = '[^']*';/, `export const BUILD = '${build}';`).replace(/export const BUILT = '[^']*';/, `export const BUILT = '${built}';`);
writeFileSync(vPath, v);
const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
if (!/const SHELL = \[[\s\S]*?\n\];/.test(sw)) { console.error('sw.js has no SHELL list to rewrite'); process.exit(1); }
sw = sw.replace(/const BUILD = '[^']*';/, `const BUILD = '${build}';`).replace(/const SHELL = \[[\s\S]*?\n\];/, `const SHELL = [\n  ${shell.map(s => `'${s}'`).join(', ')},\n];`);
writeFileSync(swPath, sw);
console.log(`Stamped build ${build}${built ? ` (${built})` : ''}; ${shell.length} files in the offline set.`);

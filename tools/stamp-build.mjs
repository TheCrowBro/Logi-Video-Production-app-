#!/usr/bin/env node
// Stamps a deploy: writes the commit into js/version.js (BUILD, BUILT) and sw.js (cache name), and regenerates the
// service worker's file list from the tree, so every deploy is one versioned set of files and installed apps notice
// it. The workflows run this before publishing; the repository itself stays unstamped ("dev"). Exits with 1, having
// written nothing, when a line it stamps cannot be found.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, ROOT_FILES, DIRS, WORKER_ROUTES } from './site-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sha = process.env.BUILD_SHA || process.env.GITHUB_SHA || '';
if (!sha) { try { sha = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = Date.now().toString(36); } }
const build = sha.slice(0, 7), built = new Date().toISOString().slice(0, 10);

const walk = dir => readdirSync(dir).sort().flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = p => path.relative(root, p).split(path.sep).join('/');
const files = [...PAGES, ...ROOT_FILES, ...DIRS.flatMap(d => walk(path.join(root, d)).map(rel))].filter(p => !/(^|\/)\./.test(p)); // tools/site-files.mjs
const shell = ['./', ...files];

// Each stamp has to land. A pattern that no longer finds its line (the file was reshaped) would otherwise publish a
// build without its number, or with a stale offline list, and say nothing: so that stops here, before either file is
// written, with a non-zero exit that fails the workflow step.
const missed = [];
const swap = (text, file, what, pattern, value) => { if (!pattern.test(text)) { missed.push(`${what} in ${file}`); return text; } return text.replace(pattern, () => value); };
const vPath = path.join(root, 'js', 'version.js');
let v = readFileSync(vPath, 'utf8');
v = swap(v, 'js/version.js', 'the BUILD line', /export const BUILD = '[^']*';/, `export const BUILD = '${build}';`);
v = swap(v, 'js/version.js', 'the BUILT line', /export const BUILT = '[^']*';/, `export const BUILT = '${built}';`);
const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = swap(sw, 'sw.js', 'the BUILD line', /const BUILD = '[^']*';/, `const BUILD = '${build}';`);
sw = swap(sw, 'sw.js', 'the SHELL list', /const SHELL = \[[\s\S]*?\n\];/, `const SHELL = [\n  ${shell.map(s => `'${s}'`).join(', ')},\n];`);
sw = swap(sw, 'sw.js', 'the WORKER_ROUTES list', /const WORKER_ROUTES = \[[^\]]*\];/, `const WORKER_ROUTES = [${WORKER_ROUTES.map(r => `'${r}'`).join(', ')}];`);
if (missed.length) { console.error(`stamp-build: could not find ${missed.join(', ')}. Nothing was stamped.`); process.exit(1); }
writeFileSync(vPath, v);
writeFileSync(swPath, sw);
console.log(`Stamped build ${build} (${built}); ${shell.length} files in the offline set.`);

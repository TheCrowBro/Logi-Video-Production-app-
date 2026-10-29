#!/usr/bin/env node
// Stamps a deploy: writes the commit into js/version.js (BUILD, BUILT) and sw.js (cache name), and regenerates the
// service worker's file list from the tree, so every deploy is one versioned set of files and installed apps notice
// it. The workflows run this before publishing; the repository itself stays unstamped ("dev").
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let sha = process.env.BUILD_SHA || process.env.GITHUB_SHA || '';
if (!sha) { try { sha = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { sha = Date.now().toString(36); } }
const build = sha.slice(0, 7), built = new Date().toISOString().slice(0, 10);

const walk = dir => readdirSync(dir).sort().flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = p => path.relative(root, p).split(path.sep).join('/');
const files = ['index.html', 'styles.css', 'manifest.webmanifest', ...['js', 'vendor', 'icons'].flatMap(d => walk(path.join(root, d)).map(rel))].filter(p => !/(^|\/)\./.test(p));
const shell = ['./', ...files];

const vPath = path.join(root, 'js', 'version.js');
let v = readFileSync(vPath, 'utf8');
v = v.replace(/export const BUILD = '[^']*';/, `export const BUILD = '${build}';`).replace(/export const BUILT = '[^']*';/, `export const BUILT = '${built}';`);
writeFileSync(vPath, v);
const swPath = path.join(root, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/const BUILD = '[^']*';/, `const BUILD = '${build}';`).replace(/const SHELL = \[[\s\S]*?\n\];/, `const SHELL = [\n  ${shell.map(s => `'${s}'`).join(', ')},\n];`);
writeFileSync(swPath, sw);
console.log(`Stamped build ${build} (${built}); ${shell.length} files in the offline set.`);

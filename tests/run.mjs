#!/usr/bin/env node
// Runs the browser specs in tests/specs against a scratch copy of the app served on localhost:8123.
// Each spec prints PASS / FAIL lines; the run fails if any FAIL appears or a spec crashes.
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchCopy, serve } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const only = process.argv.slice(2);
const root = scratchCopy(repo);
const out = join(repo, 'tests', 'output'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const server = await serve(root);
const url = `http://localhost:${server.address().port}/`;
let failed = 0, passed = 0;
for (const f of readdirSync(join(here, 'specs')).filter(n => /\.(c?js|mjs)$/.test(n)).sort()) {
  if (only.length && !only.some(o => f.includes(o))) continue;
  process.stdout.write(`\n=== ${f} ===\n`);
  const code = await new Promise(res => {
    const child = spawn(process.execPath, [join(here, 'specs', f)], { env: { ...process.env, S: out, VDEX_ROOT: root, VDEX_URL: url }, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', d => { const t = String(d); process.stdout.write(t); passed += (t.match(/^PASS /gm) || []).length; failed += (t.match(/^FAIL /gm) || []).length; });
    child.on('close', res);
  });
  if (code !== 0) { failed++; console.log(`(spec exited with code ${code})`); }
}
server.close();
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

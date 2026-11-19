#!/usr/bin/env node
// Runs the browser specs in tests/specs against a scratch copy of the app served on localhost:8123.
// Each spec prints PASS / FAIL lines; the run fails if any FAIL appears or a spec crashes.
import { spawn } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchCopy, serve, testKey } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const only = process.argv.slice(2);
const root = scratchCopy(repo);
const out = join(repo, 'tests', 'output'); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
// A run that ends early must not leave its 40 MB scratch copy behind in the temp folder, nor a spec still running
// against it: whichever way the runner goes (to its end, Ctrl-C, a killed process, a crash, or its output pipe closed
// by whoever was reading it, as in `… | head`), the spec in hand is stopped and the copy removed on the way out.
let running = null;
const clean = () => { try { if (running) running.kill(); } catch { /* already gone */ } try { rmSync(root, { recursive: true, force: true }); } catch { /* already gone */ } };
process.on('exit', clean);
process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
process.stdout.on('error', () => process.exit(1)); // nobody is reading any more: end quietly instead of crashing on the next line
const key = await testKey(root); // licences off, with a note signed by a key of this run's own (tests/lib.mjs)
const server = await serve(root, 0, key);
const url = `http://localhost:${server.address().port}/`;
let failed = 0, passed = 0;
for (const f of readdirSync(join(here, 'specs')).filter(n => /\.(c?js|mjs)$/.test(n)).sort()) {
  if (only.length && !only.some(o => f.includes(o))) continue;
  process.stdout.write(`\n=== ${f} ===\n`);
  const code = await new Promise(res => {
    const child = running = spawn(process.execPath, [join(here, 'specs', f)], { env: { ...process.env, S: out, VDEX_ROOT: root, VDEX_URL: url, VDEX_STATUS_KEY: key }, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', d => { const t = String(d); process.stdout.write(t); passed += (t.match(/^PASS /gm) || []).length; failed += (t.match(/^FAIL /gm) || []).length; });
    child.on('close', code => { running = null; res(code); });
  });
  if (code !== 0) { failed++; console.log(`(spec exited with code ${code})`); }
}
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

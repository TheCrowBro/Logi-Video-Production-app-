#!/usr/bin/env node
// Builds the owner's licence generator, one self-contained page that works from a file on their computer:
// tools/licence-generator.template.html with desktop/licence-codes.js (the code format the app and the shop use)
// pasted in, written to tools/licence-generator.html. Run it after changing either file; tests/specs/101 checks the
// built page is current.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function buildGenerator() {
  const lib = readFileSync(join(root, 'desktop/licence-codes.js'), 'utf8');
  const page = readFileSync(join(root, 'tools/licence-generator.template.html'), 'utf8');
  if (!page.includes('/*LICENCE_CODES*/') || /<\/script/i.test(lib)) throw new Error('cannot inline desktop/licence-codes.js');
  return page.replace('/*LICENCE_CODES*/', () => '\n' + lib);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(root, 'tools/licence-generator.html'), buildGenerator());
  console.log('Wrote tools/licence-generator.html');
}

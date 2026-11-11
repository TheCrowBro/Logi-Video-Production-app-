#!/usr/bin/env node
// Drops rules from styles.css whose selectors name a class that nothing in Gdex uses (styles.css began as a copy of
// Vdex's, which styles many things Gdex does not have). Conservative: a class counts as used when its name appears
// anywhere in Gdex's scripts, pages or feature stylesheets, or starts with a prefix that is built at run time.
//   node tools/prune-css.mjs          report what would go
//   node tools/prune-css.mjs --write  rewrite styles.css
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = dir => readdirSync(dir).flatMap(n => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = [...walk(path.join(root, 'js')), ...walk(path.join(root, 'css')), ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => path.join(root, f))]
  .map(f => readFileSync(f, 'utf8')).join('\n');
const DYNAMIC = ['st-', 'tone-', 'is-', 'has-', 'print-']; // classes assembled in code ('st-' + status)
const words = new Set(sources.match(/[A-Za-z_][\w-]*/g));
const used = cls => words.has(cls) || DYNAMIC.some(p => cls.startsWith(p));

const css = readFileSync(path.join(root, 'styles.css'), 'utf8');
// Walk the stylesheet keeping comments, @-blocks and declarations; judge each selector list.
let out = '', i = 0, dropped = [];
function readBlock(start) { let depth = 0, j = start; for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) return j + 1; } } return j; }
function prune(text) {
  let res = '', k = 0;
  while (k < text.length) {
    const ws = text.slice(k).match(/^\s*/)[0]; if (ws) { res += ws; k += ws.length; if (k >= text.length) break; }
    if (text.startsWith('/*', k)) { const e = text.indexOf('*/', k) + 2; res += text.slice(k, e); k = e; continue; }
    const brace = text.indexOf('{', k);
    if (brace < 0) { res += text.slice(k); break; }
    const head = text.slice(k, brace);
    // find the matching close brace
    let depth = 0, j = brace;
    for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') { depth--; if (depth === 0) break; } }
    const body = text.slice(brace + 1, j);
    const lead = head.match(/^\s*/)[0], sel = head.trim();
    if (sel.startsWith('@media') || sel.startsWith('@supports') || sel.startsWith('@container')) {
      const inner = prune(body);
      if (inner.replace(/\/\*[\s\S]*?\*\//g, '').trim()) res += `${lead}${sel} {${inner}}`;
      else dropped.push(sel);
    } else if (sel.startsWith('@')) {
      res += `${lead}${sel} {${body}}`; // keyframes, font-face, page: kept as they are
    } else {
      const parts = sel.split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
      const keep = parts.filter(s => (s.match(/\.([A-Za-z_][\w-]*)/g) || []).every(c => used(c.slice(1))));
      if (keep.length === parts.length) res += `${lead}${sel} {${body}}`;
      else if (keep.length) { res += `${lead}${keep.join(', ')} {${body}}`; dropped.push(...parts.filter(p => !keep.includes(p))); }
      else dropped.push(...parts);
    }
    k = j + 1;
  }
  return res;
}
out = prune(css);
console.log(`${dropped.length} selectors unused; styles.css ${css.length} → ${out.length} bytes`);
if (process.argv.includes('--list')) console.log(dropped.join('\n'));
if (process.argv.includes('--write')) { writeFileSync(path.join(root, 'styles.css'), out.replace(/\n{3,}/g, '\n\n')); console.log('styles.css rewritten'); }

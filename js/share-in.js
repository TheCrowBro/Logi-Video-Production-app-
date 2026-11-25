// A file another app handed to Vdex. A backup is restored (after the usual question); anything else is a script for
// TC Notes or for the teleprompter (a log of its own), or a shot list for one of the bookings, and a spreadsheet (.csv,
// .tsv, .xlsx) may be the kit list for the Equipment page (js/gear-import-ui.js). A PDF or Final Draft file is a script
// only. Which files can arrive depends on where Vdex runs:
// - the web app installed from Chrome on Android takes what the share target in manifest.webmanifest lists: text,
//   Word, PDF, Final Draft, CSV, tab-separated and Excel (.xlsx) files. The service worker parks the file and js/app.js
//   picks it up;
// - the Play app has a share filter of its own (android/), which lists text, Word and PDF files only (from the build
//   after this one), so a spreadsheet is not offered to it from the share sheet;
// - the iPhone app ("Copy to Vdex") takes the document types in its Info.plist: text, Word, PDF, Final Draft (from the
//   build after this one) and CSV, not .tsv or .xlsx.
// Everywhere else, and for everything not listed, Equipment → Import… is the way in.
import { h, sheet, toast } from './util.js';
import { activeBookings, isSealed } from './store.js';
import { isLocked } from './lock.js';

// A spreadsheet by its name or, when the name says nothing (a file shared without one), by the type it came with.
const TABLE_TYPE = /^(?:text\/csv|text\/comma-separated-values|application\/csv|text\/tab-separated-values|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)\b/i;
const isWorkbook = file => /\.xlsx$/i.test(file.name || '') || /spreadsheetml\.sheet/i.test(file.type || '');
const isTable = file => /\.(csv|tsv|xlsx)$/i.test(file.name || '') || TABLE_TYPE.test(file.type || '');

// A file can be handed over while Vdex is locked: the hand-over itself brings the app to the front, where the lock
// screen is usually up. Nothing is asked and nothing is read until the PIN has been entered (and the terms agreed), as
// with a shared link (ready() in js/share-add.js): a backup's "Replace your current data with this file?" is the
// browser's own question, which no lock screen covers.
const ready = async () => { while (isLocked() || isSealed() || document.querySelector('body > .lock, body > .terms-gate')) await new Promise(r => setTimeout(r, 400)); };

export async function arrived(file) {
  await ready();
  const name = file.name || 'file';
  if (/\.json$/i.test(name)) { const b = await import('./backup.js'); return b.importData(file); }
  const bookings = activeBookings(), table = isTable(file), workbook = isWorkbook(file);
  // A PDF or a Final Draft file is a script (js/script-files.js reads it); a shot list is read from text or Word only.
  const script = /\.(pdf|fdx)$/i.test(name) || file.type === 'application/pdf';
  const kitList = primary => h('button', { class: 'btn ' + (primary ? 'primary' : 'ghost'), onclick: () => { sh.close(); import('./gear-import-ui.js').then(m => m.openGearImport({ file })).catch(e => toast('Could not open the import: ' + (e.message || e))); } }, '🎥 Kit list for Equipment');
  // An Excel workbook is not text, so it cannot be a script or a shot list: the kit list is all it can be here.
  const sh = workbook
    ? sheet('A file for Vdex', h('div', { class: 'stack' },
      h('p', null, h('b', null, name)),
      h('p', { class: 'small muted' }, 'If it is the kit list you already keep, bring it into Equipment: you check it there before anything is added.'),
      kitList(true)))
    : sheet('A file for Vdex', h('div', { class: 'stack' },
      h('p', null, h('b', null, name)),
      h('p', { class: 'small muted' }, script ? 'Use it as a script in TC Notes, or read it on the teleprompter (it gets a log of its own, where each take is logged).' : 'Use it as a script in TC Notes, read it on the teleprompter (it gets a log of its own, where each take is logged), or use it as a shot list for a booking: one shot per line, with each scene’s heading above its shots.' + (table ? ' Or, if it is the kit list you already keep, bring it into Equipment: you check it there before anything is added.' : '')),
      h('button', { class: 'btn primary', onclick: () => { sh.close(); import('./pages/tcnotes.js').then(m => m.receiveSharedFile(file)); } }, '🎬 Script for TC Notes'),
      h('button', { class: 'btn ghost share-prompter', onclick: () => { sh.close(); import('./pages/tcnotes.js').then(m => m.receiveSharedFile(file, { prompter: true })); } }, '📜 Teleprompter'),
      table && kitList(false),
      script ? '' : bookings.length
        ? h('div', { class: 'stack' }, h('div', { class: 'pref-label' }, 'Shot list for a booking'), ...bookings.slice(0, 12).map(b => h('button', { class: 'btn ghost', onclick: () => shotList(b, file, sh) }, `${b.title}${b.date ? ' · ' + b.date : ''}`)))
        : h('p', { class: 'small muted' }, 'No active booking to add a shot list to.')));
}
async function shotList(b, file, sh) {
  try {
    const { parseShotList, applyShotImport } = await import('./stripboard.js');
    const text = /\.docx$/i.test(file.name) ? (await (await import('./docx.js')).docxToLines(file)).map(l => l.text).join('\n') : await file.text();
    const parsed = parseShotList(text), n = parsed.scenes.reduce((t, s) => t + s.shots.length, 0) + parsed.loose.length;
    if (!n && !parsed.scenes.length) { toast(`Nothing found in ${file.name}: one shot per line, with each scene’s heading above its shots.`); return; }
    const added = applyShotImport(b, parsed);
    if (!added) return; // read-only, already explained
    sh.close();
    toast(added.scenes ? `${added.shots} shot${added.shots === 1 ? '' : 's'} added to ${b.title}, and ${added.scenes} scene${added.scenes === 1 ? '' : 's'} put on its stripboard: check them` : `${added.shots} shot${added.shots === 1 ? '' : 's'} added to ${b.title}`);
  } catch (e) { toast('Could not read that file: ' + (e.message || e)); }
}

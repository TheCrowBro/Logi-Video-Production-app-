// A file another app handed to Vdex. A backup is restored (after a tap, and the usual question); anything else is a script for
// TC Notes or a shot list for one of the bookings, and a spreadsheet (.csv, .tsv, .xlsx) may be the kit list for the
// Equipment page (js/gear-import-ui.js). Which files can arrive depends on where Vdex runs:
// - the web app installed from Chrome on Android takes what the share target in manifest.webmanifest lists: text,
//   Word, CSV, tab-separated and Excel (.xlsx) files. The service worker parks the file and js/app.js picks it up;
// - the Play app has a share filter of its own (android/), which lists text and Word files only, so a spreadsheet is
//   not offered to it from the share sheet;
// - the iPhone app ("Copy to Vdex") takes the document types in its Info.plist: text, Word and CSV, not .tsv or .xlsx.
// Everywhere else, and for everything not listed, Equipment → Import… is the way in.
import { h, sheet, toast, todayISO } from './util.js';
import { activeBookings, endOf, isSealed } from './store.js';
import { isLocked } from './lock.js';

// A spreadsheet by its name or, when the name says nothing (a file shared without one), by the type it came with.
const TABLE_TYPE = /^(?:text\/csv|text\/comma-separated-values|application\/csv|text\/tab-separated-values|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)\b/i;
const isWorkbook = file => /\.xlsx$/i.test(file.name || '') || /spreadsheetml\.sheet/i.test(file.type || '');
const isTable = file => /\.(csv|tsv|xlsx)$/i.test(file.name || '') || TABLE_TYPE.test(file.type || '');
// A Word file likewise: by its name, or by its type when it was shared without the .docx in its name.
const isDocx = file => /\.docx$/i.test(file.name || '') || /wordprocessingml/i.test(file.type || '');
// The first bytes of a zip (a Word, Excel or other packed file): never text, whatever the file is called.
const isZip = async file => { try { const b = new Uint8Array(await file.slice(0, 4).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4; } catch { return false; } };

// A file can be handed over while Vdex is locked: the hand-over itself brings the app to the front, where the lock
// screen is usually up. Nothing is asked and nothing is read until the PIN has been entered (and the terms agreed), as
// with a shared link (ready() in js/share-add.js).
const ready = async () => { while (isLocked() || isSealed() || document.querySelector('body > .lock, body > .terms-gate')) await new Promise(r => setTimeout(r, 400)); };

// The bookings a shot list is for: the shoots coming up, soonest first, then the past ones, newest first. Archived
// ones are left out. (In the order they were entered, the first dozen would be the oldest jobs.)
const forShots = () => { const t = todayISO(), past = b => endOf(b) < t; return activeBookings().filter(b => b.status !== 'Archived').sort((a, b) => past(a) - past(b) || (past(a) ? (b.date || '').localeCompare(a.date || '') : (a.date || '').localeCompare(b.date || ''))); };
const SHOWN = 12; // bookings offered as buttons; the rest are in a list under them
// A long name with no spaces (a script file's, a booking's) wraps inside the sheet instead of widening it.
const WRAP = 'overflow-wrap: anywhere; white-space: normal';

export async function arrived(file) {
  await ready();
  const name = file.name || 'file';
  // A backup is asked about on a sheet first, like every other file: the tap there is what restores it (and what lets
  // read-only mode explain itself), and the browser's own "replace everything?" question no longer comes from nowhere.
  if (/\.json$/i.test(name)) {
    const sh = sheet('A file for Vdex', h('div', { class: 'stack' },
      h('p', { style: WRAP }, h('b', null, name)),
      h('p', { class: 'small muted' }, 'A Vdex backup. Restoring it replaces what is on this device with what the file holds; Vdex asks once more before it does.'),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: async () => { sh.close(); (await import('./backup.js')).importData(file); } }, 'Restore this backup'), h('button', { class: 'btn ghost', onclick: () => sh.close() }, 'Not now'))));
    return;
  }
  const bookings = forShots(), table = isTable(file), workbook = isWorkbook(file);
  const kitList = primary => h('button', { class: 'btn ' + (primary ? 'primary' : 'ghost'), onclick: () => { sh.close(); import('./gear-import-ui.js').then(m => m.openGearImport({ file })).catch(e => toast('Could not open the import: ' + (e.message || e))); } }, '🎥 Kit list for Equipment');
  const title = b => `${b.title}${b.date ? ' · ' + b.date : ''}`;
  const more = bookings.length > SHOWN && h('select', { 'aria-label': 'More bookings', onchange: e => { const b = bookings.find(x => x.id === e.target.value); if (b) shotList(b, file, sh); e.target.value = ''; } },
    h('option', { value: '' }, `More bookings (${bookings.length - SHOWN})…`), ...bookings.slice(SHOWN).map(b => h('option', { value: b.id }, title(b))));
  // An Excel workbook is not text, so it cannot be a script or a shot list: the kit list is all it can be here.
  const sh = workbook
    ? sheet('A file for Vdex', h('div', { class: 'stack' },
      h('p', { style: WRAP }, h('b', null, name)),
      h('p', { class: 'small muted' }, 'If it is the kit list you already keep, bring it into Equipment: you check it there before anything is added.'),
      kitList(true)))
    : sheet('A file for Vdex', h('div', { class: 'stack' },
      h('p', { style: WRAP }, h('b', null, name)),
      h('p', { class: 'small muted' }, 'Use it as a script in TC Notes, or as a shot list for a booking: one shot per line, with each scene’s heading above its shots.' + (table ? ' Or, if it is the kit list you already keep, bring it into Equipment: you check it there before anything is added.' : '')),
      h('button', { class: 'btn primary', onclick: () => { sh.close(); import('./pages/tcnotes.js').then(m => m.receiveSharedFile(file)); } }, '🎬 Script for TC Notes'),
      table && kitList(false),
      bookings.length
        ? h('div', { class: 'stack' }, h('div', { class: 'pref-label' }, 'Shot list for a booking'), ...bookings.slice(0, SHOWN).map(b => h('button', { class: 'btn ghost', style: WRAP, onclick: () => shotList(b, file, sh) }, title(b))), more)
        : h('p', { class: 'small muted' }, 'No active booking to add a shot list to.')));
}
async function shotList(b, file, sh) {
  try {
    const { parseShotList, applyShotImport } = await import('./stripboard.js');
    const docx = isDocx(file);
    // Anything else packed as a zip is not text: its bytes must never become "shots".
    if (!docx && await isZip(file)) { toast('That file is not text, so it cannot be read as a shot list. A Word file, a text file or a pasted list can.'); return; }
    const text = docx ? (await (await import('./docx.js')).docxToLines(file)).map(l => l.text).join('\n') : await file.text();
    const parsed = parseShotList(text), n = parsed.scenes.reduce((t, s) => t + s.shots.length, 0) + parsed.loose.length;
    if (!n && !parsed.scenes.length) { toast(`Nothing found in ${file.name}: one shot per line, with each scene’s heading above its shots.`); return; }
    const added = applyShotImport(b, parsed);
    if (!added) return; // read-only, already explained
    sh.close();
    toast(added.scenes ? `${added.shots} shot${added.shots === 1 ? '' : 's'} added to ${b.title}, and ${added.scenes} scene${added.scenes === 1 ? '' : 's'} put on its stripboard: check them` : `${added.shots} shot${added.shots === 1 ? '' : 's'} added to ${b.title}`);
  } catch (e) { toast('Could not read that file: ' + (e.message || e)); }
}

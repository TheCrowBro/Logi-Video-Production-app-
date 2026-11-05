// A file another app handed to Vdex: "Copy to Vdex" on the iPhone, the share sheet on Android. A backup is restored
// (after the usual question); anything else is a script for TC Notes or a shot list for one of the bookings.
import { h, sheet, toast } from './util.js';
import { activeBookings } from './store.js';

export async function arrived(file) {
  const name = file.name || 'file';
  if (/\.json$/i.test(name)) { const b = await import('./backup.js'); return b.importData(file); }
  const bookings = activeBookings();
  const sh = sheet('A file for Vdex', h('div', { class: 'stack' },
    h('p', null, h('b', null, name)),
    h('p', { class: 'small muted' }, 'Use it as a script in TC Notes, or as a shot list for a booking: one shot per line, with each scene’s heading above its shots.'),
    h('button', { class: 'btn primary', onclick: () => { sh.close(); import('./pages/tcnotes.js').then(m => m.receiveSharedFile(file)); } }, '🎬 Script for TC Notes'),
    bookings.length
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

// Studio log: take logs for recording sessions. Open a log as the session starts and its timer runs; tap + Take the
// moment each take starts and it is numbered per song (Take 1, 2…, a new song starts again at 1) and stamped with the
// time. Rate each take Keep, Maybe or No, jot notes (a note is stamped the moment you start typing it, as Vdex's
// timecode notes are: on a take it reads how far into the take you were), see only the keepers, and send the log to
// the engineer as text or a spreadsheet. Adapted from the quick-capture page of Vdex (js/pages/tcnotes.js), without
// timecode, camera sync, scripts or device links.
//
// log = { id, bookingId, date, title, songId (the song the next takes are for), startedAt, takes: [{ id, n, songId,
// at, rating: 'keep'|'maybe'|'no'|'', text }], notes }
import { h, uid, toast, announce, empty, backBtn, fmtShort, fmtLong, todayISO, ymd, parseISO, groupBy, sheet, pad } from '../util.js';
import { db, byId, update, upsert, remove, redraw, covers } from '../store.js';
import { bookingTitle, actName, fmtDur, kindIcon } from '../model.js';
import { openForm } from '../form.js';
import { csv, saveFile, fileName } from '../print.js';
import { sheetTutorial } from '../tour.js';
import { haptic } from '../a11y.js';
import { fmtClock, clockTime } from '../clock.js';

const H = 36e5;
const KEY = 'gigdex-studio-log'; // the open log, so a reload comes back to it
// The page's own state, kept between redraws: the open log, the keepers filter, the search, and the note being typed
// (its text, the moment typing started, and the take it belongs to).
const S = { id: null, keepers: false, q: '', draft: '', stampAt: null, stampTake: null, lastAdded: null };
try { S.id = localStorage.getItem(KEY) || null; } catch { /* private mode */ }
const setOpen = id => { S.id = id || null; S.keepers = false; S.draft = ''; S.stampAt = null; S.stampTake = null; try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* ignore */ } };

export const RATINGS = [['keep', 'Keep', '✓'], ['maybe', 'Maybe', '?'], ['no', 'No', '✕']];
const ratingLabel = r => (RATINGS.find(x => x[0] === r) || ['', 'Not rated'])[1];

/* ------------------------------- helpers ------------------------------- */
const songTitle = id => (id && byId('songs', id) ? byId('songs', id).title : '');
const takesOf = l => (Array.isArray(l && l.takes) ? l.takes.filter(t => t && t.id) : []);
const keepersOf = l => takesOf(l).filter(t => t.rating === 'keep');
const startOf = l => Number(l && l.startedAt) || Number(l && l.createdAt) || (l && l.date ? parseISO(l.date).getTime() : Date.now());
const logDate = l => (l.date && /^\d{4}-\d{2}-\d{2}$/.test(l.date) ? l.date : ymd(new Date(startOf(l))));
// The next take number for a song in this log: one past the highest so far, so numbers are never reused.
export const nextTakeNo = (l, songId) => 1 + takesOf(l).filter(t => (t.songId || '') === (songId || '')).reduce((m, t) => Math.max(m, Number(t.n) || 0), 0);
// The songs a log covers, in the order they were first recorded (or the song it was started for).
function songsOf(l) {
  const ids = [...new Set(takesOf(l).sort((a, b) => Number(a.at) - Number(b.at)).map(t => t.songId || ''))];
  if (!ids.length && l.songId) ids.push(l.songId);
  return ids.map(id => songTitle(id) || (id ? 'Deleted song' : '')).filter(Boolean);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const latestTake = l => takesOf(l).sort((a, b) => Number(b.at) - Number(a.at))[0] || null;
const offsetText = (l, ms) => { const off = ms - startOf(l); return off >= 0 && off < 24 * H ? '+' + fmtClock(off) : ''; };
// The time of day a session note is stamped with: "19:05", whatever the phone's clock format (a 12-hour "07:05 PM"
// would not read as a stamp).
const stampTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
// A note line stamped "[0:42] …" (into the take) or "[11:05] …" (time of day, on the session notes) shows its stamp apart.
// Notes stamped before in a 12-hour format ("[07:05 PM] …") are read too.
const noteLines = text => String(text || '').split('\n').filter(x => x.trim()).map(line => {
  const m = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?\s?[Mm]\.?)?)\]\s*(.*)$/);
  return h('div', { class: 'sd-note-line' }, m && h('span', { class: 'sd-stamp-badge' }, m[1]), m ? m[2] : line);
});
// Focus the control with this id after the redraw an action causes (a keyboard user keeps their place).
const refocus = id => setTimeout(() => { const el = document.getElementById(id); if (el && document.activeElement !== el && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true }); }, 0);

// The songs to pick from, grouped: this session's songs, the act's other songs, everything else.
function songGroups(l) {
  const b = l.bookingId ? byId('bookings', l.bookingId) : null;
  const cur = l.songId ? byId('songs', l.songId) : null;
  const actId = (b && b.actId) || (cur && cur.actId) || '';
  const byTitle = (a, c) => String(a.title || '').localeCompare(String(c.title || ''));
  const session = ((b && b.songIds) || []).map(id => byId('songs', id)).filter(Boolean);
  const act = db.songs.filter(s => actId && s.actId === actId && !session.includes(s)).sort(byTitle);
  const rest = db.songs.filter(s => !session.includes(s) && !act.includes(s)).sort(byTitle);
  return [[b ? 'This session' : '', session], [actName(actId) || 'This act', act], [session.length || act.length ? 'Other songs' : 'Songs', rest]].filter(g => g[1].length);
}
const songOptionsFlat = l => [['', 'No song'], ...songGroups(l).flatMap(([, list]) => list.map(s => [s.id, s.title + (s.actId && actName(s.actId) ? ` · ${actName(s.actId)}` : '')]))];
function bookingOptions(currentId) {
  const today = todayISO(), dist = b => Math.abs(Date.parse(b.date || today) - Date.parse(today));
  const list = db.bookings.filter(b => b.kind === 'session' || b.kind === 'rehearsal' || b.id === currentId).sort((a, b) => dist(a) - dist(b));
  return [['', 'No booking'], ...list.map(b => [b.id, `${kindIcon(b.kind)} ${b.date ? fmtShort(b.date) + ' — ' : ''}${bookingTitle(b)}`])];
}
const defaultTitle = (song, b) => (song ? `${song.title} takes` : b ? `${bookingTitle(b)} takes` : `Takes ${fmtShort(todayISO())}`);

/* ------------------------------- shared API ------------------------------- */
// Go to the Studio log and open a log. Resolves once it is drawn.
export function openLog(id) {
  if (!id || !byId('logs', id)) { toast('That take log is no longer here.'); return Promise.resolve(); }
  setOpen(id);
  const go = window.logiPage && window.logiPage() === 'sessions' ? (redraw(), Promise.resolve()) : (window.logiGo ? window.logiGo('sessions') : Promise.resolve());
  return Promise.resolve(go).then(() => { window.scrollTo(0, 0); });
}
// Create a log ({ bookingId, songId, title, date }) and open it. Returns the stored record.
export function newLog(preset = {}) {
  const song = preset.songId ? byId('songs', preset.songId) : null;
  const b = preset.bookingId ? byId('bookings', preset.bookingId) : null;
  const rec = upsert('logs', {
    bookingId: b ? b.id : '', songId: song ? song.id : '', title: String(preset.title || '').trim() || defaultTitle(song, b),
    date: /^\d{4}-\d{2}-\d{2}$/.test(preset.date || '') ? preset.date : todayISO(), startedAt: Date.now(), takes: [], notes: '',
  });
  openLog(rec.id);
  return rec;
}

/* ------------------------------- changes ------------------------------- */
const changeLog = (id, fn) => update(d => { const x = d.logs.find(y => y.id === id); if (!x) return; x.takes = Array.isArray(x.takes) ? x.takes : []; fn(x); x.updatedAt = Date.now(); });
function addTake(l) {
  const fresh = byId('logs', l.id); if (!fresh) return;
  const songId = fresh.songId && byId('songs', fresh.songId) ? fresh.songId : '';
  const t = { id: uid(), n: nextTakeNo(fresh, songId), songId, at: Date.now(), rating: '', text: '' };
  S.lastAdded = t.id;
  changeLog(l.id, x => { x.takes.push(t); });
  haptic(25); announce(`Take ${t.n}${songTitle(songId) ? ' of ' + songTitle(songId) : ''}`);
}
function rate(l, t, r) {
  const next = t.rating === r ? '' : r;
  changeLog(l.id, x => { const y = x.takes.find(z => z.id === t.id); if (y) y.rating = next; });
  haptic(); announce(next ? `Take ${t.n}: ${ratingLabel(next)}` : `Take ${t.n}: rating cleared`);
}
function saveNote(l) {
  const text = S.draft.trim(); if (!text) return;
  const stampAt = S.stampAt || Date.now();
  const take = S.stampTake ? takesOf(byId('logs', l.id)).find(t => t.id === S.stampTake) : null;
  changeLog(l.id, x => {
    const y = take && x.takes.find(z => z.id === take.id);
    if (y) { const off = stampAt - Number(y.at); const pre = off >= 0 && off <= 20 * 6e4 ? `[${fmtDur(off / 1000)}] ` : ''; y.text = [y.text, pre + text].filter(Boolean).join('\n'); }
    else x.notes = [x.notes, `[${stampTime(stampAt)}] ${text}`].filter(Boolean).join('\n');
  });
  S.draft = ''; S.stampAt = null; S.stampTake = null;
  haptic(); announce(take ? `Note added to take ${take.n}` : 'Note added to the session notes');
}

/* ------------------------------- forms ------------------------------- */
function newLogForm(preset = {}) {
  const fake = { bookingId: preset.bookingId || '', songId: preset.songId || '' };
  openForm({
    title: 'New take log',
    values: { title: preset.title || '', songId: fake.songId, bookingId: fake.bookingId, date: todayISO() },
    fields: [
      { key: 'title', label: 'Title', placeholder: 'e.g. Undertow vocals', hint: 'Leave blank to name it after the song.' },
      { key: 'songId', label: 'Song for the first takes', type: 'select', options: songOptionsFlat(fake), hint: db.songs.length ? 'You can switch songs between takes.' : 'No songs yet: add them under Songs, or log takes without one.' },
      { key: 'bookingId', label: 'Studio session', type: 'select', options: bookingOptions(fake.bookingId) },
      { key: 'date', label: 'Date', type: 'date', required: true },
    ],
    saveLabel: 'Start the log',
    onSave: v => { newLog(v); toast('Log started. Tap + Take as each take starts.'); },
  });
}
function editLog(l) {
  openForm({
    title: 'Log details',
    values: { title: l.title || '', songId: l.songId || '', bookingId: l.bookingId || '', date: logDate(l), notes: l.notes || '' },
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'songId', label: 'Song for the next takes', type: 'select', options: songOptionsFlat(l) },
      { key: 'bookingId', label: 'Studio session', type: 'select', options: bookingOptions(l.bookingId) },
      { key: 'notes', label: 'Session notes', type: 'textarea', rows: 5, placeholder: 'Mic choices, settings, what to fix next time…' },
    ],
    onSave: v => { changeLog(l.id, x => { Object.assign(x, { title: v.title || x.title, date: v.date || x.date, songId: v.songId, bookingId: v.bookingId, notes: v.notes }); }); toast('Log saved'); },
    onDelete: () => { remove('logs', l.id); setOpen(null); toast('Log deleted'); },
  });
}
function editTake(l, t) {
  openForm({
    title: 'Edit take',
    values: { n: Number(t.n) || 1, songId: t.songId || '', rating: t.rating || '', text: t.text || '' },
    fields: [
      { key: 'n', label: 'Take number', type: 'number', min: 1, required: true },
      { key: 'rating', label: 'Rating', type: 'select', options: [['', 'Not rated'], ...RATINGS.map(([k, label]) => [k, label])] },
      { key: 'songId', label: 'Song', type: 'select', options: songOptionsFlat({ ...l, songId: t.songId }) },
      { key: 'text', label: 'Notes', type: 'textarea', rows: 4, placeholder: 'Great feel, pitchy in the bridge…', hint: `Recorded ${clockTime(Number(t.at))}. A [0:42] at the start of a line is how far into the take the note was made.` },
    ],
    onSave: v => changeLog(l.id, x => { const y = x.takes.find(z => z.id === t.id); if (y) Object.assign(y, { n: Math.max(1, Math.round(Number(v.n)) || 1), songId: v.songId, rating: v.rating, text: v.text }); }),
    onDelete: () => { changeLog(l.id, x => { x.takes = x.takes.filter(z => z.id !== t.id); }); toast(`Take ${t.n} deleted`); },
  });
}

/* ------------------------------- export ------------------------------- */
// Takes in song order (songs in the order first recorded, takes by number within a song).
function bySong(l, keepersOnly) {
  const takes = takesOf(l).filter(t => !keepersOnly || t.rating === 'keep').sort((a, b) => Number(a.at) - Number(b.at));
  const groups = groupBy(takes, t => t.songId || '');
  return [...groups].map(([id, list]) => [songTitle(id) || (id ? 'Deleted song' : 'No song'), list.sort((a, b) => (Number(a.n) || 0) - (Number(b.n) || 0) || Number(a.at) - Number(b.at))]);
}
export function logText(l, keepersOnly = false) {
  const b = l.bookingId ? byId('bookings', l.bookingId) : null;
  const all = takesOf(l), k = keepersOf(l);
  const out = [l.title || 'Take log', [fmtLong(logDate(l)), b && bookingTitle(b)].filter(Boolean).join(' · '), `Started ${clockTime(startOf(l))} · ${plural(all.length, 'take')} · ${plural(k.length, 'keeper')}`, ''];
  for (const [song, list] of bySong(l, keepersOnly)) {
    out.push(song.toUpperCase());
    for (const t of list) {
      out.push(`Take ${t.n} · ${clockTime(Number(t.at))} · ${ratingLabel(t.rating)}`);
      String(t.text || '').split('\n').filter(x => x.trim()).forEach(x => out.push('  ' + x));
    }
    out.push('');
  }
  if (!all.length) out.push('No takes yet.', '');
  if (k.length) { out.push('KEEPERS'); for (const [song, list] of bySong(l, true)) out.push(`${song}: ${list.map(t => t.n).join(', ')}`); out.push(''); }
  if (String(l.notes || '').trim()) out.push('SESSION NOTES', String(l.notes).trim(), '');
  return out.join('\n');
}
export function logCsv(l, keepersOnly = false) {
  const rows = [['Date', 'Song', 'Take', 'Time', 'Into the log', 'Rating', 'Notes']];
  takesOf(l).filter(t => !keepersOnly || t.rating === 'keep').sort((a, b) => Number(a.at) - Number(b.at)).forEach(t => {
    rows.push([ymd(new Date(Number(t.at))), songTitle(t.songId) || (t.songId ? 'Deleted song' : ''), t.n, clockTime(Number(t.at)), offsetText(l, Number(t.at)).slice(1), t.rating ? ratingLabel(t.rating) : '', String(t.text || '').replace(/\n/g, ' / ')]);
  });
  return csv(rows) + '\n';
}
function openExport(l) {
  let only = S.keepers && keepersOf(l).length > 0;
  const pre = h('pre', { class: 'sd-export-preview', tabindex: '0', 'aria-label': 'Preview of the text' });
  const fill = () => { pre.textContent = logText(l, only); };
  fill();
  const share = async () => {
    const text = logText(l, only);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: l.title, text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const done = await saveFile(text, fileName(l.title || 'Take log', 'txt'), 'text/plain');
    if (done) toast('Text file saved');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(logText(l, only)); toast('Copied. Paste it into a message or email.'); } catch { toast('Copying is not allowed here. Use Share instead.'); } };
  const sheetCsv = async () => { const done = await saveFile(logCsv(l, only), fileName(l.title || 'Take log', 'csv'), 'text/csv'); if (done) toast('Spreadsheet saved'); };
  sheet('Export take log', h('div', { class: 'stack sd-export' },
    h('p', { class: 'small muted' }, `${plural(takesOf(l).length, 'take')}, ${plural(keepersOf(l).length, 'keeper')}. Send the text to the engineer, or open the spreadsheet in Numbers, Excel or Google Sheets.`),
    keepersOf(l).length > 0 && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: only, onchange: e => { only = e.target.checked; fill(); } }), h('span', null, 'Keepers only')),
    h('button', { type: 'button', class: 'btn primary', onclick: share }, '↗ Share as text'),
    h('button', { type: 'button', class: 'btn ghost', onclick: copy }, '⧉ Copy text'),
    h('button', { type: 'button', class: 'btn ghost', id: 'sd-csv', onclick: sheetCsv }, '⬇ Spreadsheet (.csv)'),
    pre));
}

/* ------------------------------- list view ------------------------------- */
function logCard(l) {
  const b = l.bookingId ? byId('bookings', l.bookingId) : null;
  const n = takesOf(l).length, k = keepersOf(l).length, songs = songsOf(l);
  return h('button', { type: 'button', class: 'card tap sd-log', 'data-id': l.id, onclick: () => openLog(l.id) },
    h('div', { class: 'card-row' },
      h('div', null,
        h('strong', null, l.title || 'Take log'),
        h('div', { class: 'muted small' }, [fmtShort(logDate(l)), songs.slice(0, 3).join(', ') + (songs.length > 3 ? ` +${songs.length - 3}` : '')].filter(Boolean).join(' · ')),
        b && h('div', { class: 'muted small sd-log-booking' }, `${kindIcon(b.kind)} ${bookingTitle(b)}`)),
      h('div', { class: 'sd-log-pills' }, h('span', { class: 'pill' }, plural(n, 'take')), k > 0 && h('span', { class: 'pill st-confirmed' }, `★ ${plural(k, 'keeper')}`))));
}
function listView() {
  const logs = [...db.logs].sort((a, b) => logDate(b).localeCompare(logDate(a)) || startOf(b) - startOf(a));
  const today = todayISO();
  const todays = db.bookings.filter(b => b.kind === 'session' && b.status !== 'cancelled' && covers(b, today));
  const box = h('div', { class: 'sd-logs' });
  const match = l => { const q = S.q.trim().toLowerCase(); if (!q) return true; const b = l.bookingId && byId('bookings', l.bookingId); return [l.title, ...songsOf(l), b && bookingTitle(b), l.notes].some(x => String(x || '').toLowerCase().includes(q)); };
  const fill = () => {
    const shown = logs.filter(match);
    if (!logs.length) { box.replaceChildren(empty('Log takes while you record: tap + Take as each one starts, rate them Keep, Maybe or No, and jot notes for the comp. Start a log here, or from a studio session’s Take log box.', h('button', { type: 'button', class: 'btn primary', onclick: () => newLogForm() }, '+ New take log'))); return; }
    if (!shown.length) { box.replaceChildren(h('p', { class: 'muted' }, `No logs match “${S.q.trim()}”.`)); return; }
    const months = groupBy(shown, l => logDate(l).slice(0, 7));
    box.replaceChildren(...[...months].map(([ym, list]) => h('section', { class: 'sd-month' },
      h('h3', null, parseISO(ym + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('div', { class: 'list' }, list.map(logCard)))));
  };
  fill();
  return h('div', { class: 'sd-page sd-list-view' },
    h('div', { class: 'page-head' }, h('h1', null, 'Studio log'), h('button', { type: 'button', class: 'btn primary', id: 'sd-new', onclick: () => newLogForm() }, '+ New log')),
    todays.length > 0 && h('div', { class: 'card hero sd-today' },
      h('strong', null, todays.length === 1 ? 'In the studio today' : 'Studio sessions today'),
      todays.map(b => {
        const has = db.logs.find(l => l.bookingId === b.id && logDate(l) === today);
        return h('div', { class: 'card-row' },
          h('div', null, h('div', null, bookingTitle(b)), h('div', { class: 'muted small' }, [b.start && `${b.start}${b.end ? '–' + b.end : ''}`, ((b.songIds || []).map(songTitle).filter(Boolean)).join(', ')].filter(Boolean).join(' · '))),
          has ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => openLog(has.id) }, 'Open log')
            : h('button', { type: 'button', class: 'btn primary small', onclick: () => newLog({ bookingId: b.id, songId: (b.songIds || []).find(id => byId('songs', id)) || '' }) }, '● Start a log'));
      })),
    logs.length > 6 && h('input', { type: 'search', class: 'search', id: 'sd-search', placeholder: 'Search logs, songs, sessions…', 'aria-label': 'Search take logs', value: S.q, oninput: e => { S.q = e.target.value; fill(); } }),
    box);
}

/* ------------------------------- log view ------------------------------- */
function takeRow(l, t) {
  const song = songTitle(t.songId) || (t.songId ? 'Deleted song' : '');
  const name = `take ${t.n}${song ? ' of ' + song : ''}`;
  return h('li', { class: 'card sd-take r-' + (t.rating || 'none') + (t.id === S.lastAdded ? ' pop-in' : ''), 'data-id': t.id },
    h('div', { class: 'sd-take-top' },
      h('div', { class: 'sd-take-no', 'aria-hidden': 'true' }, h('small', null, 'TAKE'), h('b', null, String(t.n))),
      h('div', { class: 'sd-take-meta' },
        h('strong', { class: 'sd-take-song' }, h('span', { class: 'sr-only' }, `Take ${t.n}, `), song || 'No song'),
        h('span', { class: 'muted small' }, [clockTime(Number(t.at)), offsetText(l, Number(t.at))].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Edit ${name}`, onclick: () => editTake(l, t) }, '✎')),
    h('div', { class: 'sd-rate', role: 'group', 'aria-label': `Rate ${name}` },
      RATINGS.map(([k, label, ico]) => h('button', { type: 'button', class: 'sd-rate-' + k + (t.rating === k ? ' on' : ''), 'aria-pressed': t.rating === k ? 'true' : 'false', 'aria-label': `${label}: ${name}`, onclick: () => rate(l, t, k) }, h('span', { 'aria-hidden': 'true' }, ico), ' ' + label))),
    String(t.text || '').trim() && h('div', { class: 'sd-take-note' }, noteLines(t.text)));
}

function logView(l, setTimer) {
  const b = l.bookingId ? byId('bookings', l.bookingId) : null;
  const takes = takesOf(l), k = keepersOf(l), last = latestTake(l);
  const curSong = l.songId && byId('songs', l.songId) ? l.songId : '';
  const next = nextTakeNo(l, curSong);
  const start = startOf(l), live = Date.now() - start >= 0 && Date.now() - start < 24 * H;
  const back = () => { setOpen(null); redraw(); window.scrollTo(0, 0); refocus('sd-new'); };

  // The timer: the time since the log started, ticking without redrawing the page.
  const timer = h('span', { class: 'sd-timer', role: 'timer', 'aria-live': 'off' }, live ? fmtClock(Date.now() - start) : '');
  const sinceLast = h('span', { class: 'muted small sd-since' });
  const paint = () => {
    if (live) timer.textContent = fmtClock(Date.now() - start);
    const t = latestTake(byId('logs', l.id) || l);
    sinceLast.textContent = t && Date.now() - Number(t.at) < 6 * H ? `Last take ${fmtDur((Date.now() - Number(t.at)) / 1000)} ago` : '';
  };
  paint();
  setTimer(paint);

  // The song for the next takes (optgroups: this session, the act, the rest), and + New song.
  const songSel = h('select', { id: 'sd-song', 'aria-label': 'Song for the next takes', onchange: e => {
    const v = e.target.value;
    if (v === '+new') {
      e.target.value = curSong;
      const actId = (b && b.actId) || '';
      import('./songs.js').then(m => m.editSong({ actId }, saved => { if (saved && saved.id) changeLog(l.id, x => { x.songId = saved.id; }); })).catch(() => toast('Songs could not be opened.'));
      return;
    }
    changeLog(l.id, x => { x.songId = v; });
    announce(v ? `Next takes: ${songTitle(v)}, take ${nextTakeNo(byId('logs', l.id), v)}` : 'Next takes: no song');
  } },
  h('option', { value: '', selected: !curSong }, 'No song'),
  songGroups(l).map(([label, list]) => (label ? h('optgroup', { label }, list.map(s => h('option', { value: s.id, selected: s.id === curSong }, s.title))) : list.map(s => h('option', { value: s.id, selected: s.id === curSong }, s.title)))),
  h('option', { value: '+new' }, '+ New song…'));

  // The note being typed: stamped the moment typing starts, on the take that was the latest then.
  const stampLine = h('div', { class: 'muted small sd-stamp', id: 'sd-stamp' });
  const showStamp = () => {
    const t = S.stampTake ? takesOf(byId('logs', l.id) || l).find(x => x.id === S.stampTake) : null;
    const lt = latestTake(byId('logs', l.id) || l);
    if (S.stampAt) stampLine.replaceChildren(t ? `On take ${t.n}${songTitle(t.songId) ? ' of ' + songTitle(t.songId) : ''}, ` : 'In the session notes, ', h('b', null, t ? `${fmtDur((S.stampAt - Number(t.at)) / 1000)} into the take` : `at ${stampTime(S.stampAt)}`));
    else stampLine.textContent = lt ? `Goes on take ${lt.n}${songTitle(lt.songId) ? ' of ' + songTitle(lt.songId) : ''}, stamped the moment you start typing.` : 'Goes in the session notes, stamped the moment you start typing.';
  };
  showStamp();
  const note = h('textarea', { id: 'sd-note', rows: 2, class: 'sd-compose', placeholder: last ? 'Note on this take…' : 'Note on the session…', 'aria-label': last ? 'Note on the latest take' : 'Session note', 'aria-describedby': 'sd-stamp', value: S.draft });
  note.addEventListener('input', () => {
    S.draft = note.value;
    if (!S.stampAt && note.value.trim()) { S.stampAt = Date.now(); const lt = latestTake(byId('logs', l.id)); S.stampTake = lt ? lt.id : null; showStamp(); }
    if (!note.value.trim() && S.stampAt) { S.stampAt = null; S.stampTake = null; showStamp(); }
  });
  note.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveNote(l); } });

  const shown = takes.filter(t => !S.keepers || t.rating === 'keep').sort((a, c) => Number(c.at) - Number(a.at));
  const setKeepers = on => { S.keepers = on; redraw(); refocus(on ? 'sd-f-keep' : 'sd-f-all'); };
  const bk = b && h('button', { type: 'button', class: 'sd-link', onclick: () => import('./bookings.js').then(m => m.openBooking(b.id)) }, `${kindIcon(b.kind)} ${bookingTitle(b)}`);

  return h('div', { class: 'sd-page sd-log-view' },
    h('div', { class: 'page-head' },
      backBtn('Studio log', back),
      h('div', { class: 'actions sd-head-actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'sd-export', onclick: () => openExport(byId('logs', l.id) || l) }, '⬆ Export'),
        h('button', { type: 'button', class: 'icon-btn', id: 'sd-edit', 'aria-label': 'Log details', title: 'Log details', onclick: () => editLog(l) }, '⚙'))),
    h('div', { class: 'sd-title' },
      h('h1', null, l.title || 'Take log'),
      h('div', { class: 'muted small' }, fmtShort(logDate(l)), bk ? [' · ', bk] : '')),
    h('div', { class: 'card sd-deck' },
      h('div', { class: 'sd-timer-row' },
        live
          ? [h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, 'Time since the log started: '), timer, h('span', { class: 'muted small' }, `since ${clockTime(start)}`)]
          : [h('span', { class: 'muted small grow' }, takes.length ? `Recorded ${clockTime(Math.min(...takes.map(t => Number(t.at))))}–${clockTime(Math.max(...takes.map(t => Number(t.at))))}` : `Started ${fmtShort(ymd(new Date(start)))}, ${clockTime(start)}`),
            h('button', { type: 'button', class: 'btn ghost small', id: 'sd-restart', onclick: () => { changeLog(l.id, x => { x.startedAt = Date.now(); }); toast('Timer started from now'); } }, '▶ Timer from now')]),
      h('label', { class: 'sd-song-row' }, h('span', { class: 'muted small' }, 'Next takes'), songSel),
      h('button', { type: 'button', class: 'btn primary sd-take-btn', id: 'sd-take', onclick: () => { addTake(l); refocus('sd-take'); } },
        h('span', { class: 'sd-take-plus' }, '+ Take'),
        h('small', null, `Take ${next}${curSong ? ' · ' + songTitle(curSong) : ''}`)),
      h('div', { class: 'sd-take-after' }, sinceLast),
      h('div', { class: 'sd-composer' }, note,
        h('div', { class: 'card-row' }, stampLine, h('button', { type: 'button', class: 'btn ghost small', id: 'sd-note-add', onclick: () => { saveNote(l); refocus('sd-note'); } }, 'Add note')))),
    h('div', { class: 'card-row sd-filter' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Which takes to show' },
        h('button', { type: 'button', id: 'sd-f-all', class: S.keepers ? '' : 'on', 'aria-pressed': S.keepers ? 'false' : 'true', onclick: () => setKeepers(false) }, `All (${takes.length})`),
        h('button', { type: 'button', id: 'sd-f-keep', class: S.keepers ? 'on' : '', 'aria-pressed': S.keepers ? 'true' : 'false', onclick: () => setKeepers(true) }, `★ Keepers only (${k.length})`))),
    shown.length
      ? h('ol', { class: 'sd-takes', 'aria-label': S.keepers ? 'Keepers, newest first' : 'Takes, newest first' }, shown.map(t => takeRow(l, t)))
      : h('p', { class: 'muted small sd-none' }, S.keepers ? (takes.length ? 'No keepers yet. Rate a take Keep and it shows here.' : 'No takes yet.') : 'No takes yet. Tap + Take the moment each take starts: it is numbered and timed for you.'),
    String(l.notes || '').trim() && h('div', { class: 'card sd-session-notes' }, h('div', { class: 'card-row' }, h('strong', null, 'Session notes'), h('button', { type: 'button', class: 'btn ghost small', onclick: () => editLog(l) }, 'Edit')), noteLines(l.notes)));
}

/* ------------------------------- the page ------------------------------- */
export const sessions = {
  id: 'sessions', label: 'Studio log', icon: '🎙️',
  render(root) {
    const l = S.id ? byId('logs', S.id) : null;
    if (S.id && !l) setOpen(null); // deleted elsewhere: back to the list
    if (!l) { root.append(listView()); return undefined; }
    let iv = null;
    root.append(logView(l, fn => { iv = setInterval(() => { if (!document.hidden) fn(); }, 1000); }));
    S.lastAdded = null; // the new take pops in once, not again on every redraw
    return () => { clearInterval(iv); };
  },
  tutorial: () => (S.id && byId('logs', S.id) ? [
    { title: 'The take log', text: 'One log per recording session or song. The timer shows how long the log has been running.', target: ['.sd-title', '.sd-log-view .page-head'] },
    { title: 'Next takes', text: 'Pick the song the next takes are for. Each song counts its own takes: a new song starts again at Take 1.', target: ['.sd-song-row'] },
    { title: '+ Take', text: 'Tap it the moment a take starts. It is numbered and stamped with the time.', target: ['#sd-take'] },
    { title: 'Notes', text: 'Type a note while a take plays: it goes on the latest take, marked with how far into the take you started typing. Enter saves it.', target: ['.sd-composer'] },
    { title: 'Rate the takes', text: 'Keep, Maybe or No on each take. Tap again to clear. ✎ edits the number, song, rating or notes, or deletes the take.', target: ['.sd-take .sd-rate', '.sd-filter'] },
    { title: 'Keepers', text: 'Show only the takes rated Keep: the list for the comp.', target: ['.sd-filter'] },
    { title: 'Export', text: 'Send the log as text to the engineer, copy it, or save a spreadsheet.', target: ['#sd-export'] },
  ] : [
    { title: 'Studio log', text: 'Take logs for recording sessions: every take numbered, timed and rated, with notes for the comp.', target: ['.sd-list-view .page-head'] },
    { title: 'Today', text: 'A studio session today shows here, ready to start its log.', target: ['.sd-today'] },
    { title: 'Your logs', text: 'Newest first, by month: the songs, the session, how many takes and how many keepers.', target: ['.sd-logs .sd-log', '.sd-logs'] },
    { title: 'New log', text: 'Start a log for a song or a session. A studio session’s Take log box starts one too.', target: ['#sd-new'] },
  ]),
};

sheetTutorial('New take log', [
  { title: 'Name it', text: 'Leave the title blank and the log is named after the song.', target: ['.sheet [data-key=title]'] },
  { title: 'Song and session', text: 'The song for the first takes (you can switch between takes) and the studio session it belongs to, so it shows on that booking.', target: ['.sheet .form'] },
]);
sheetTutorial('Edit take', [
  { title: 'Fix a take', text: 'Change its number, rating or song, or write notes. Delete removes just this take.', target: ['.sheet .form'] },
]);
sheetTutorial('Log details', [
  { title: 'Log details', text: 'The title, date, song for the next takes, the studio session, and free notes about the session. Delete removes the whole log.', target: ['.sheet .form'] },
]);
sheetTutorial('Export take log', [
  { title: 'Share it', text: 'Share sends the log as text (or saves a text file). Copy puts it on the clipboard. The spreadsheet has one row per take.', target: ['.sd-export .btn.primary', '.sd-export'] },
  { title: 'Keepers only', text: 'Tick it to send just the keepers.', target: ['.sd-export .check'] },
]);

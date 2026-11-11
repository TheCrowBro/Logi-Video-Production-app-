// Songs: the library (grouped by act, filter chips, search), each song's sheet (key, tempo, length, the split sheet,
// the setlists it is in), the song form, the printed split sheet; and the Setlists view, whose cards open the editor in
// js/setlist.js.
import { h, toast, empty, safeUrl, fmtShort, fmtLong, todayISO, uid, sheet } from '../util.js';
import { db, byId, upsert, remove, update } from '../store.js';
import { SONG_STATUS, songStatusLabel, KEYS, SPLIT_ROLES, fmtDur, parseDur, actName, setlistLength, venueOf, bookingTitle, kindIcon } from '../model.js';
import { openForm } from '../form.js';
import { printElement } from '../print.js';
import { sheetTutorial } from '../tour.js';
import { openSetlist, newSetlist, liveSheet, plural, shortKey, tickShows } from '../setlist.js';
import { openBooking } from './bookings.js';

// View state survives redraws: which view, which act's chip, the search.
const S = { view: 'songs', act: '', q: '', lyrics: false, qBox: false }; // qBox: the search box was showing (kept until the view changes, so clearing it never pulls it away mid-typing)
const NO_ACT = '-';
export const TUNINGS = ['Standard', 'Drop D', 'E♭ standard', 'D standard', 'Drop C', 'Open G', 'Open D', 'DADGAD'];

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true });
const str = v => String(v ?? '').trim();
const isStandard = t => !str(t) || /^standard$/i.test(str(t));
// Parts of a line with " · " between them (nodes allowed), skipping the empty ones.
const dotted = parts => parts.filter(p => p != null && p !== false && p !== '').flatMap((p, i) => (i ? [' · ', p] : [p]));

/* ------------------------------- split sheets ------------------------------- */
// A share typed as "50", "50%", "33,3": a number (0 when blank or unreadable).
const toShare = v => { const t = str(v).replace('%', '').replace(',', '.'); const n = Number(t); return t && Number.isFinite(n) ? Math.max(0, n) : 0; };
export const splitTotal = splits => (splits || []).filter(Boolean).reduce((t, p) => t + (Number(p.share) || 0), 0);
export const splitOk = total => Math.abs(total - 100) < 0.01;
const fmtPct = n => `${Math.round((Number(n) || 0) * 100) / 100}%`;

const statusPill = s => h('span', { class: 'pill sg-st-' + (SONG_STATUS.some(x => x[0] === s) ? s : 'idea') }, songStatusLabel(s) || 'Idea');
const actOf = r => (r.actId && byId('acts', r.actId) ? r.actId : NO_ACT);
// [actKey, name, records] in act-name order, "No act" last.
function groupsOf(records) {
  const m = new Map();
  records.forEach(r => { const k = actOf(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([k, arr]) => [k, k === NO_ACT ? 'No act' : actName(k) || 'Untitled act', arr])
    .sort((a, b) => (a[0] === NO_ACT) - (b[0] === NO_ACT) || a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }));
}

/* ----------------------------------- page ----------------------------------- */
export const songs = {
  id: 'songs', label: 'Songs', icon: '🎼',
  render(root) {
    const draw = () => {
      const a = document.activeElement, typing = a && a.id === 'sg-q' && root.contains(a);
      root.replaceChildren(h('div', { class: 'sg-page' }, ...view(draw)));
      if (typing) { const i = root.querySelector('#sg-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
    };
    draw();
  },
  tutorial: () => (S.view === 'setlists' ? [
    { target: ['.sg-views'], title: 'Songs and setlists', text: 'Switch between your song library and your setlists.' },
    { target: ['.sg-acts'], title: 'By act', text: 'Show one act’s setlists, or all of them.' },
    { target: ['.sg-setlist'], title: 'A setlist', text: 'Its running time, songs and the next booking it is used at. Tap to edit: drag songs into order, add set breaks, and fit it to the slot.' },
    { target: ['#sg-new-setlist'], title: 'New setlist', text: 'Name it, pick the act, then add songs. You can also start one from a show’s Setlist box, sized to its set length.' },
  ] : [
    { target: ['.page-head'], title: 'Songs', text: 'Every song with its key, tempo, length and status, grouped by act.' },
    { target: ['.sg-views'], title: 'Songs and setlists', text: 'Switch to your setlists here.' },
    { target: ['.sg-acts'], title: 'By act', text: 'Show one act’s songs, or the songs without an act.' },
    { target: ['#sg-q'], title: 'Search', text: 'Find a song by title, key, tuning, ISRC or writer.' },
    { target: ['.sg-song'], title: 'A song', text: 'Tap for the details, the split sheet (who wrote it and their share), the setlists it is in, and Print split sheet.' },
    { target: ['#sg-new-song'], title: 'Add a song', text: 'Title, key, tempo and length (type 3:45), tuning, status, lyrics and chords, and the split sheet.' },
  ]),
};

function view(draw) {
  const isSongs = S.view !== 'setlists';
  const records = isSongs ? db.songs : db.setlists;
  const groups = groupsOf(records);
  if (S.act && S.act !== NO_ACT && !byId('acts', S.act)) S.act = ''; // the act was deleted
  const chipList = groups.map(([k, name]) => [k, name]);
  if (S.act && !chipList.some(([k]) => k === S.act)) chipList.push([S.act, S.act === NO_ACT ? 'No act' : actName(S.act)]);
  const chip = (k, name) => h('button', { class: 'chip' + (S.act === k ? ' on' : ''), type: 'button', 'aria-pressed': String(S.act === k), onclick: () => { S.act = S.act === k || !k ? '' : k; draw(); } }, name);
  return [
    h('div', { class: 'page-head' }, h('h1', null, 'Songs'),
      isSongs
        ? h('button', { class: 'btn primary', type: 'button', id: 'sg-new-song', 'data-fk': 'pg-new', onclick: () => editSong({ actId: S.act && S.act !== NO_ACT ? S.act : '' }) }, '+ Song')
        : h('button', { class: 'btn primary', type: 'button', id: 'sg-new-setlist', 'data-fk': 'pg-new', onclick: () => newSetlistForm() }, '+ New setlist')),
    h('div', { class: 'seg sg-views', role: 'group', 'aria-label': 'Show songs or setlists' },
      [['songs', 'Songs', db.songs.length], ['setlists', 'Setlists', db.setlists.length]].map(([v, l, n]) => h('button', {
        type: 'button', id: 'sg-view-' + v, class: S.view === v || (v === 'songs' && isSongs) ? 'on' : '', 'aria-pressed': String(S.view === v || (v === 'songs' && isSongs)),
        onclick: () => { S.view = v; S.qBox = false; draw(); },
      }, l, h('span', { class: 'sg-count' }, ' ' + n)))),
    // Kept while a search is on, so a search typed earlier can still be seen and cleared when few songs are left.
    isSongs && (db.songs.length > 3 || S.q || S.qBox) && (S.qBox = true) && h('input', { class: 'search sg-search', type: 'search', id: 'sg-q', placeholder: 'Search songs, keys, writers…', 'aria-label': 'Search songs', value: S.q, autocomplete: 'off', oninput: e => { S.q = e.target.value; draw(); } }),
    chipList.length > 1 && h('div', { class: 'chips sg-acts', role: 'group', 'aria-label': 'Filter by act' }, chip('', 'All'), chipList.map(([k, n]) => chip(k, n))),
    ...(isSongs ? songsList(draw) : setlistsList()),
  ];
}

function songsList(draw) {
  if (!db.songs.length) return [empty('Add your songs with their key, tempo and length, so setlists add up to the slot and the split sheet is ready before release.', h('button', { class: 'btn primary', type: 'button', onclick: () => editSong({}) }, '+ Add a song'))];
  const q = S.q.trim().toLowerCase();
  const match = s => !q || [s.title, s.key, shortKey(s.key), s.tuning, s.isrc, s.notes, actName(s.actId), songStatusLabel(s.status), ...(s.splits || []).map(p => p && p.name)].filter(Boolean).join(' ').toLowerCase().includes(q);
  const shown = groupsOf(db.songs.filter(s => (!S.act || actOf(s) === S.act) && match(s)));
  if (!shown.length) {
    return [empty(q ? `No songs match “${S.q.trim()}”.` : S.act === NO_ACT ? 'Every song belongs to an act.' : `No songs for ${actName(S.act) || 'this act'} yet.`,
      q ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { S.q = ''; draw(); } }, 'Clear the search')
        : S.act && S.act !== NO_ACT ? h('button', { class: 'btn primary', type: 'button', onclick: () => editSong({ actId: S.act }) }, '+ Add a song') : null)];
  }
  return shown.map(([k, name, arr]) => h('section', { class: 'sg-group', 'aria-label': name },
    h('h3', null, h('span', null, name), h('span', { class: 'sg-count' }, plural(arr.length, 'song'))),
    h('div', { class: 'list' }, arr.sort(byTitle).map(songCard))));
}

function songCard(s) {
  const splits = (s.splits || []).filter(Boolean), tot = splitTotal(splits);
  return h('button', { class: 'card tap sg-song', type: 'button', 'data-fk': 'pg-song-' + s.id, onclick: () => openSong(s.id) },
    h('span', { class: 'sg-top' }, h('span', { class: 'sg-title' }, s.title || 'Untitled'), statusPill(s.status)),
    h('span', { class: 'sg-meta' }, ...dotted([
      s.key ? h('span', { class: 'sg-key' }, s.key) : h('span', { class: 'sg-dim' }, 'no key'),
      s.bpm ? `${s.bpm} BPM` : '',
      s.duration ? fmtDur(s.duration) : h('span', { class: 'sg-miss' }, 'no length'),
      !isStandard(s.tuning) ? '🎸 ' + str(s.tuning) : '',
    ])),
    splits.length > 0 && !splitOk(tot) && h('span', { class: 'sg-flag' }, `⚠ Splits add up to ${fmtPct(tot)}`));
}

function setlistsList() {
  if (!db.setlists.length) return [empty('Build setlists from your songs: put them in order, add set breaks, and see the running time against the slot. Attach one to a show from its booking.', h('button', { class: 'btn primary', type: 'button', onclick: () => newSetlistForm() }, '+ New setlist'))];
  const shown = db.setlists.filter(l => !S.act || actOf(l) === S.act).sort(byName);
  if (!shown.length) return [empty(S.act === NO_ACT ? 'Every setlist belongs to an act.' : `No setlists for ${actName(S.act) || 'this act'} yet.`, S.act !== NO_ACT ? h('button', { class: 'btn primary', type: 'button', onclick: () => newSetlistForm() }, '+ New setlist') : null)];
  return [h('div', { class: 'list' }, shown.map(setlistCard))];
}

// The next live booking that uses a setlist, today on.
const nextUse = id => db.bookings.filter(b => b.setlistId === id && b.status !== 'cancelled' && (b.endDate || b.date || '') >= todayISO()).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;

function setlistCard(l) {
  const t = setlistLength(l), next = nextUse(l.id);
  const opts = next && next.kind === 'show' && Number(next.setLength) > 0 ? { target: Number(next.setLength), bookingId: next.id } : {};
  return h('button', { class: 'card tap sg-setlist', type: 'button', 'data-fk': 'pg-sl-' + l.id, onclick: () => openSetlist(l.id, opts) },
    h('span', { class: 'sg-top' }, h('span', { class: 'sg-title' }, l.name || 'Untitled setlist'), h('span', { class: 'sg-len' }, fmtDur(t.sec))),
    h('span', { class: 'sg-meta' }, ...dotted([actName(l.actId) || 'No act', plural(t.songs, 'song'), t.missing ? h('span', { class: 'sg-miss' }, `${t.missing} without a length`) : ''])),
    next && h('span', { class: 'sg-next' }, `${kindIcon(next.kind)} ${dotted([next.date && fmtShort(next.date), venueOf(next).name || bookingTitle(next), next.kind === 'show' && next.setLength ? `${next.setLength} min set` : '']).join('')}`));
}

function newSetlistForm() {
  const acts = [...db.acts].sort(byName);
  openForm({
    title: 'New setlist', saveLabel: 'Create',
    values: { name: '', actId: S.act && S.act !== NO_ACT ? S.act : acts.length === 1 ? acts[0].id : '' },
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'Club set, Festival 30, Acoustic…' },
      { key: 'actId', label: 'Act', type: 'select', options: [['', 'No act'], ...acts.map(a => [a.id, a.name || 'Untitled act'])] },
    ],
    onSave: v => { const rec = newSetlist({ name: v.name, actId: v.actId }); openSetlist(rec.id); },
  });
}

/* -------------------------------- song sheet -------------------------------- */
export function openSong(id) {
  if (!byId('songs', id)) { toast('That song is not there any more.'); return null; }
  return liveSheet('Song', ctx => { const s = byId('songs', id); return s ? songView(s, ctx) : null; }, { cls: 'sg-sheet' });
}

function songView(s, ctx) {
  const splits = (s.splits || []).filter(Boolean), tot = splitTotal(splits);
  const lists = db.setlists.filter(l => (l.items || []).some(it => it && it.songId === s.id)).sort(byName);
  const sessions = db.bookings.filter(b => (b.songIds || []).includes(s.id)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const link = safeUrl(s.link);
  const fact = (k, v) => (v ? h('div', { class: 'sg-fact' }, h('span', null, k), h('b', null, v)) : null);
  const where = l => { const songsOnly = (l.items || []).filter(it => it && !it.isBreak), at = songsOnly.findIndex(it => it.songId === s.id); return `No. ${at + 1} of ${songsOnly.length} · ${fmtDur(setlistLength(l).sec)}`; };
  return [
    h('div', { class: 'sg-hero' }, h('h2', null, s.title || 'Untitled'), h('div', { class: 'sg-hero-sub' }, h('span', null, actName(s.actId) || 'No act'), statusPill(s.status))),
    (s.key || s.bpm || s.duration || s.tuning || s.isrc)
      ? h('div', { class: 'sg-facts' }, fact('Key', s.key), fact('Tempo', s.bpm ? `${s.bpm} BPM` : ''), fact('Length', s.duration ? fmtDur(s.duration) : ''), fact('Tuning', str(s.tuning)), fact('ISRC', str(s.isrc)))
      : h('p', { class: 'small muted' }, 'No key, tempo or length yet. Add them so setlists add up and the band knows what is coming.'),
    h('div', { class: 'actions sg-song-actions' },
      h('button', { class: 'btn primary', type: 'button', 'data-fk': 'sg-edit', onclick: () => editSong(byId('songs', s.id) || s) }, '✎ Edit'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sg-print', onclick: () => printSplitSheet(s.id) }, '🖨 Print split sheet'),
      h('button', { class: 'btn ghost', type: 'button', 'data-fk': 'sg-addto', onclick: () => addToSetlist(s.id) }, '+ Add to a setlist'),
      link && h('a', { class: 'btn ghost', href: link, target: '_blank', rel: 'noopener noreferrer', 'data-fk': 'sg-link' }, '🔗 Open link')),
    h('section', { class: 'sg-sec' }, h('h3', null, 'Split sheet'), splitsView(s, splits, tot)),
    str(s.lyrics) && h('details', { class: 'twirl sg-lyr', open: S.lyrics, ontoggle: e => { S.lyrics = e.target.open; } },
      h('summary', { 'data-fk': 'sg-lyr' }, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '📝'), h('span', { class: 'twirl-name' }, 'Lyrics & chords')),
      h('div', { class: 'twirl-body' }, h('pre', { class: 'sg-lyrics' }, s.lyrics))),
    str(s.notes) && h('section', { class: 'sg-sec' }, h('h3', null, 'Notes'), h('p', { class: 'prewrap sg-notes' }, s.notes)),
    h('section', { class: 'sg-sec' }, h('h3', null, 'In setlists'),
      lists.length
        ? h('div', { class: 'sg-links' }, lists.map(l => h('button', { class: 'card tap sg-inlist', type: 'button', 'data-fk': 'sg-l-' + l.id, onclick: () => openSetlist(l.id) }, h('strong', null, l.name || 'Untitled setlist'), h('span', { class: 'muted small sg-block' }, where(l)))))
        : h('p', { class: 'small muted' }, 'Not in a setlist yet.')),
    sessions.length > 0 && h('section', { class: 'sg-sec' }, h('h3', null, 'Studio sessions'),
      h('div', { class: 'sg-links' }, sessions.map(b => h('button', { class: 'card tap', type: 'button', 'data-fk': 'sg-b-' + b.id, onclick: () => { ctx.close(); openBooking(b.id); } },
        h('strong', null, bookingTitle(b)), h('span', { class: 'muted small sg-block' }, dotted([b.date && fmtShort(b.date), venueOf(b).name]).join('')))))),
  ];
}

function splitsView(s, splits, tot) {
  if (!splits.length) {
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, 'Nobody on the split sheet yet. Agree who wrote what, and each share, before the song is released.'),
      h('div', null, h('button', { class: 'btn ghost small', type: 'button', 'data-fk': 'sg-add-splits', onclick: () => editSong(byId('songs', s.id) || s) }, '+ Add writers')));
  }
  return h('div', { class: 'sg-parties' },
    splits.map(p => h('div', { class: 'sg-party' },
      h('div', { class: 'card-row' },
        h('div', null, h('strong', null, p.name || 'No name'), p.role && h('span', { class: 'muted small' }, ' · ' + p.role)),
        h('b', { class: 'sg-share' }, fmtPct(p.share))),
      (p.pro || p.ipi || p.publisher) && h('div', { class: 'small muted' }, ...dotted([p.pro && 'PRO ' + p.pro, p.ipi && 'IPI ' + p.ipi, p.publisher && 'Publisher: ' + p.publisher])))),
    h('div', { class: 'sg-total ' + (splitOk(tot) ? 'ok' : 'bad') }, h('span', null, 'Total'), h('b', null, fmtPct(tot) + (splitOk(tot) ? ' ✓' : ''))),
    !splitOk(tot) && h('p', { class: 'warn sg-split-warn', role: 'status' }, `⚠ The shares add up to ${fmtPct(tot)}, not 100%. ${tot > 100 ? 'Someone has been given too much.' : 'Part of the song is not given to anyone yet.'} Edit the split sheet to fix it before anyone signs.`));
}

// Adds the song to the end of a setlist, or starts a new setlist with it.
function addToSetlist(songId) {
  const song = byId('songs', songId);
  if (!song) return;
  const lists = [...db.setlists].sort((a, b) => ((b.actId === song.actId) - (a.actId === song.actId)) || byName(a, b));
  let close = () => {};
  const pick = l => {
    close();
    update(d => { const x = d.setlists.find(y => y.id === l.id); if (!x) return; x.items = [...(x.items || []).filter(Boolean), { id: uid(), songId }]; x.updatedAt = Date.now(); });
    tickShows(l.id);
    toast(`Added to “${l.name || 'the setlist'}”`);
  };
  const body = h('div', { class: 'stack' },
    lists.length
      ? h('div', { class: 'sg-links' }, lists.map(l => { const t = setlistLength(l), has = (l.items || []).some(it => it && it.songId === songId); return h('button', { class: 'card tap', type: 'button', onclick: () => pick(l) }, h('strong', null, l.name || 'Untitled setlist'), h('span', { class: 'muted small sg-block' }, dotted([actName(l.actId) || 'No act', plural(t.songs, 'song'), fmtDur(t.sec), has && 'already in it']).join(''))); }))
      : h('p', { class: 'muted' }, 'No setlists yet.'),
    h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); const rec = newSetlist({ name: 'New setlist', actId: song.actId || '', items: [{ songId }] }); openSetlist(rec.id); } }, '+ New setlist with this song'));
  ({ close } = sheet('Add to a setlist', body));
}

/* --------------------------------- song form --------------------------------- */
export function editSong(s = {}, onSaved) {
  const src = (s && s.id && byId('songs', s.id)) || s || {};
  const isNew = !src.id;
  const acts = [...db.acts].sort(byName);
  const keyOpts = [['', 'Not set'], ...(src.key && !KEYS.includes(src.key) ? [src.key] : []), ...KEYS];
  const title = isNew ? 'Add a song' : 'Edit song';
  openForm({
    title, saveLabel: isNew ? 'Add song' : 'Save',
    values: {
      ...src, title: src.title || '', actId: src.actId && byId('acts', src.actId) ? src.actId : '', key: src.key || '', bpm: src.bpm ?? '',
      duration: Number(src.duration) > 0 ? fmtDur(src.duration) : '', tuning: src.tuning || '', status: src.status || 'idea',
      splits: (src.splits || []).filter(Boolean).map(p => ({ ...p, share: p.share ?? '' })),
    },
    fields: [
      { key: 'title', label: 'Title', required: true, placeholder: 'Song title' },
      { key: 'actId', label: 'Act', type: 'select', options: [['', 'No act'], ...acts.map(a => [a.id, a.name || 'Untitled act'])] },
      { key: 'key', label: 'Key', type: 'select', options: keyOpts },
      { key: 'bpm', label: 'Tempo (BPM)', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 120' },
      { key: 'duration', label: 'Length', placeholder: '3:45', hint: 'Minutes and seconds, like 3:45' },
      { key: 'tuning', label: 'Tuning', list: TUNINGS, placeholder: 'Standard' },
      { key: 'status', label: 'Status', type: 'select', options: SONG_STATUS },
      { key: 'isrc', label: 'ISRC', placeholder: 'e.g. GBAYE2400001', hint: 'The recording’s code, once it has one' },
      { key: 'link', label: 'Link', type: 'url', placeholder: 'Demo, chart or streaming link' },
      { key: 'lyrics', label: 'Lyrics & chords', type: 'textarea', rows: 6, placeholder: '[Verse 1]\nAm        F\nHarbour lights…' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
      { key: 'splits', label: 'Split sheet', type: 'rows', hint: 'Each writer and publisher with their share of the song. The shares should add up to 100%.',
        columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'share', label: 'Share %', type: 'number' }, { key: 'pro', label: 'PRO' }, { key: 'ipi', label: 'IPI' }, { key: 'publisher', label: 'Publisher' }] },
    ],
    onSave: v => {
      const fresh = (src.id && byId('songs', src.id)) || src;
      const raw = str(v.duration), dur = parseDur(raw);
      const splits = (Array.isArray(v.splits) ? v.splits : []).map(r => ({ id: r.id || uid(), name: str(r.name), role: str(r.role), share: toShare(r.share), pro: str(r.pro), ipi: str(r.ipi), publisher: str(r.publisher) }))
        .filter(r => r.name || r.share || r.publisher);
      const bpm = v.bpm === '' || v.bpm == null || !Number.isFinite(Number(v.bpm)) ? '' : Math.max(0, Number(v.bpm));
      const rec = upsert('songs', {
        ...fresh, ...v, id: fresh.id, title: str(v.title) || 'Untitled', actId: v.actId || '', key: v.key || '', bpm,
        duration: dur || (raw ? Number(fresh.duration) || 0 : 0), tuning: str(v.tuning), status: v.status || 'idea',
        isrc: str(v.isrc).toUpperCase(), link: str(v.link), lyrics: v.lyrics || '', notes: v.notes || '', splits,
      });
      const tot = splitTotal(splits);
      if (raw && !dur) toast(`Saved, but the length “${raw}” could not be read: type it like 3:45.`);
      else if (splits.length && !splitOk(tot)) toast(`Saved. The splits add up to ${fmtPct(tot)}, not 100%.`);
      else toast(isNew ? `“${rec.title}” added` : 'Song saved');
      if (onSaved) onSaved(rec);
    },
    onDelete: isNew ? null : () => { remove('songs', src.id); toast(`“${src.title || 'Song'}” deleted. Setlists keep its title.`); },
  });
  const all = document.querySelectorAll('.sheet[aria-label]'), form = all[all.length - 1];
  if (form && form.getAttribute('aria-label') === title) splitsHelper(form);
}

// The split sheet rows in the song form: laid out two by two (css/songs.css), the roles offered as suggestions, and the
// running total under them.
function splitsHelper(form) {
  const field = [...form.querySelectorAll('.field')].find(f => { const l = f.querySelector(':scope > label'); return l && l.textContent.trim().startsWith('Split sheet'); });
  const rows = field && field.querySelector('.rows');
  if (!rows) return;
  field.classList.add('sg-splits-field');
  const sum = h('p', { class: 'sg-split-sum', 'aria-live': 'polite' });
  // Filled boxes lose their placeholder, so the order of the boxes is spelled out above them.
  field.querySelector('.rows-legend')?.remove(); // the form's own column line: this one fits the two-by-two layout better
  rows.before(h('p', { class: 'sg-split-legend small muted' }, 'Each person: name; role and share %; PRO and IPI; publisher.'));
  field.append(h('datalist', { id: 'sg-split-roles' }, SPLIT_ROLES.map(r => h('option', { value: r }))), sum);
  const sync = () => {
    rows.querySelectorAll('input[aria-label="Role"]').forEach(i => { if (i.getAttribute('list') !== 'sg-split-roles') i.setAttribute('list', 'sg-split-roles'); });
    const shares = [...rows.querySelectorAll('input[aria-label="Share %"]')];
    const tot = shares.reduce((t, i) => t + toShare(i.value), 0), any = shares.some(i => str(i.value));
    const text = !any ? '' : splitOk(tot) ? `Total ${fmtPct(tot)} ✓` : `Total ${fmtPct(tot)}: the shares should add up to 100%`;
    if (sum.textContent !== text) sum.textContent = text;
    sum.className = 'sg-split-sum' + (any ? (splitOk(tot) ? ' ok' : ' bad') : '');
  };
  new MutationObserver(sync).observe(rows, { childList: true }); // rows are drawn again when one is added or removed
  field.addEventListener('input', sync);
  sync();
}

/* -------------------------------- split sheet print -------------------------------- */
export function splitDoc(s) {
  const splits = (s.splits || []).filter(Boolean), tot = splitTotal(splits), me = db.profile || {};
  const parties = splits.length ? splits : [{}, {}];
  return h('div', { class: 'cs-doc sg-split' },
    h('div', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-kicker' }, 'SPLIT SHEET'), h('div', { class: 'cs-brand' }, me.business || me.name || 'Song split agreement')),
      h('div', { class: 'cs-when' }, 'Date', h('b', null, fmtLong(todayISO())))),
    h('h2', null, s.title || 'Untitled'),
    h('div', { class: 'cs-sub' }, dotted([actName(s.actId) && 'Performed by ' + actName(s.actId), s.duration ? 'Length ' + fmtDur(s.duration) : '', str(s.isrc) && 'ISRC ' + str(s.isrc)]).join('') || 'Song details'),
    h('div', { class: 'cs-sec' }, h('h4', null, 'Writers and publishers'),
      splits.length
        ? h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), h('th', { class: 'num' }, 'Share'), h('th', null, 'PRO'), h('th', null, 'IPI / CAE'), h('th', null, 'Publisher'))),
          h('tbody', null, splits.map(p => h('tr', null, h('td', null, h('b', null, p.name || '—')), h('td', null, p.role || ''), h('td', { class: 'num' }, fmtPct(p.share)), h('td', null, p.pro || ''), h('td', null, p.ipi || ''), h('td', null, p.publisher || '')))),
          h('tfoot', null, h('tr', null, h('td', { colSpan: 2 }, h('b', null, 'Total')), h('td', { class: 'num' }, h('b', null, fmtPct(tot))), h('td', { colSpan: 3 }, ''))))
        : h('p', null, 'No writers or publishers have been added yet.')),
    splits.length > 0 && !splitOk(tot) && h('p', { class: 'sg-split-bad' }, `Check before signing: the shares add up to ${fmtPct(tot)}, not 100%.`),
    h('div', { class: 'cs-sec' }, h('h4', null, 'Agreed and signed'),
      h('p', { class: 'sg-sign-note' }, 'Each party agrees to the shares of the song (the composition) set out above, and that they are correct.'),
      h('div', { class: 'sg-sign' }, parties.map(p => h('div', { class: 'sg-sign-party' },
        h('div', { class: 'sg-sign-line' }),
        h('div', null, h('b', null, p.name || 'Name'), p.role ? ` · ${p.role}` : '', p.share ? ` · ${fmtPct(p.share)}` : ''),
        h('div', { class: 'sg-sign-sub' }, 'Signature and date'))))),
    h('div', { class: 'cs-foot' }, `Made with Gigdex on ${fmtLong(todayISO())}.`));
}
const SPLIT_CSS = pre => [
  ['.sg-split-bad', 'border:1.5px solid #b3321c;color:#b3321c;border-radius:8px;padding:6px 10px;font-weight:700'],
  ['.sg-sign-note', 'margin:4px 0 0;color:#444'],
  ['.sg-sign', 'display:grid;grid-template-columns:1fr 1fr;gap:4px 28px'],
  ['.sg-sign-party', 'break-inside:avoid;padding-top:38px'],
  ['.sg-sign-line', 'border-top:1px solid #111;margin-bottom:4px'],
  ['.sg-sign-sub', 'font-size:11px;color:#666'],
  ['tfoot td', 'border-top:2px solid #111;border-bottom:0'],
].map(([sel, decl]) => `${pre}${sel}{${decl}}`).join('');

export function printSplitSheet(id) {
  const s = byId('songs', id);
  if (!s) { toast('That song is not there any more.'); return; }
  printElement(splitDoc(s), SPLIT_CSS('#print-root '));
}

/* --------------------------------- tutorials --------------------------------- */
sheetTutorial('Song', [
  { target: ['.sg-hero'], title: 'The song', text: 'Its title, act and where it is: idea, demo, recording, mixing, mastered or released.' },
  { target: ['.sg-facts'], title: 'Key, tempo, length', text: 'What the band needs on the night. The length makes setlists add up.' },
  { target: ['.sg-song-actions'], title: 'Edit and print', text: 'Edit everything, print the split sheet for everyone to sign, or add the song to a setlist.' },
  { target: ['.sg-parties', '.sg-sec'], title: 'Split sheet', text: 'Who wrote it and each share, with PRO, IPI and publisher. The shares must add up to 100%; you are warned when they do not.' },
  { target: ['.sg-links'], title: 'In setlists', text: 'The setlists the song is in and where. Tap one to open it.' },
]);

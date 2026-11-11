// Songs box (studio sessions): the songs this session works on (booking.songIds). Pick them from the act's songs (every
// song when the session has no act), add a new song, and move each song along (demo → recording → mixing…) right here:
// the status is the song's own, so the Songs page shows it too.
import { h, toast } from '../util.js';
import { db, byId, patch } from '../store.js';
import { actName, SONG_STATUS, songStatusLabel, fmtDur } from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';

const songsOf = b => (Array.isArray(b.songIds) ? b.songIds : []).map(id => byId('songs', id)).filter(Boolean);
const songsPage = () => import('../pages/songs.js');
const byTitle = (a, c) => String(a.title || '').localeCompare(String(c.title || ''));

function pick(b) {
  const act = b.actId && byId('acts', b.actId);
  const actSongs = act ? db.songs.filter(s => s.actId === act.id).sort(byTitle) : [];
  const from = actSongs.length ? actSongs : [...db.songs].sort(byTitle);
  const chosen = songsOf(b).filter(s => !from.includes(s)); // already on the session from elsewhere: kept in the list
  const opt = (s, group) => ({ value: s.id, label: s.title || 'Untitled', group, hint: [songStatusLabel(s.status), s.key, s.bpm && `${s.bpm} BPM`].filter(Boolean).join(' · ') });
  const options = [...from.map(s => opt(s, actSongs.length ? `${act.name}’s songs` : act ? 'All songs (none for this act yet)' : 'Songs')), ...chosen.map(s => opt(s, 'Also on this session'))];
  openForm({
    title: 'Songs for this session',
    values: { songIds: songsOf(b).map(s => s.id) },
    fields: [{ key: 'songIds', label: 'Tick the songs this session works on', type: 'checks', options, empty: 'No songs yet. Add one with + New song.' }],
    onSave: v => {
      const fresh = byId('bookings', b.id); if (!fresh) return;
      const was = (fresh.songIds || []).filter(id => byId('songs', id));
      const keep = was.filter(id => v.songIds.includes(id)), add = v.songIds.filter(id => !keep.includes(id));
      patch('bookings', b.id, { songIds: [...keep, ...add] });
      toast(keep.length + add.length ? `${keep.length + add.length} song${keep.length + add.length === 1 ? '' : 's'} on this session` : 'No songs on this session');
    },
  });
}
function addNew(b) {
  songsPage().then(m => m.editSong({ actId: b.actId || '' }, saved => {
    if (!saved || !saved.id) return;
    const fresh = byId('bookings', b.id); if (!fresh) return;
    if (!(fresh.songIds || []).includes(saved.id)) patch('bookings', b.id, { songIds: [...(fresh.songIds || []), saved.id] });
  })).catch(() => toast('Songs could not be opened.'));
}
function setStatus(s, status) {
  if (!byId('songs', s.id)) return;
  patch('songs', s.id, { status });
}
function unlink(b, s) {
  const fresh = byId('bookings', b.id); if (!fresh) return;
  patch('bookings', b.id, { songIds: (fresh.songIds || []).filter(id => id !== s.id) });
  toast(`${s.title || 'The song'} is off this session (the song is still in Songs)`);
}

function songRow(b, s) {
  const meta = [s.key, s.bpm && `${s.bpm} BPM`, Number(s.duration) > 0 && fmtDur(s.duration), b.actId && s.actId && s.actId !== b.actId && actName(s.actId)].filter(Boolean).join(' · ');
  const status = s.status || '';
  return h('div', { class: 'sd-song', 'data-id': s.id },
    h('button', { type: 'button', class: 'sd-song-main', title: 'Open the song', onclick: () => songsPage().then(m => m.openSong(s.id)).catch(() => {}) },
      h('strong', { class: 'sd-song-title' }, s.title || 'Untitled'),
      meta && h('span', { class: 'muted small' }, meta)),
    h('select', { class: 'sd-status sd-st-' + (status || 'none'), 'aria-label': `Status of ${s.title || 'the song'}`, onchange: e => setStatus(s, e.target.value) },
      !status && h('option', { value: '', selected: true }, 'Status…'),
      SONG_STATUS.map(([v, label]) => h('option', { value: v, selected: v === status }, label))),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take ${s.title || 'the song'} off this session`, title: 'Take off this session', onclick: () => unlink(b, s) }, '✕'));
}

export default {
  id: 'worksongs', title: 'Songs', icon: '🎵', order: 25,
  kinds: ['session'],
  summary(b) {
    const t = songsOf(b).map(s => s.title || 'Untitled');
    return t.length > 3 ? `${t.slice(0, 2).join(', ')} +${t.length - 2} more` : t.join(', ');
  },
  render(b) {
    const songs = songsOf(b);
    const act = b.actId && byId('acts', b.actId);
    return h('div', { class: 'sd-worksongs' },
      songs.length
        ? h('div', { class: 'sd-songs' }, songs.map(s => songRow(b, s)))
        : h('p', { class: 'muted small' }, act ? `Which songs is this session for? Tick them from ${act.name}’s songs, or add a new one.` : 'Which songs is this session for? Tick them from your songs, or add a new one.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: `sd-pick-songs-${b.id}`, onclick: () => pick(b) }, '☑ Pick songs'),
        h('button', { type: 'button', class: 'btn ghost small', id: `sd-new-song-${b.id}`, onclick: () => addNew(b) }, '+ New song')));
  },
  tutorial: [
    { title: 'Songs', text: 'The songs this session works on. Change a song’s status here (demo, recording, mixing…): it changes in Songs too. ✕ takes a song off this session without deleting it.', target: ['#blk-worksongs .sd-worksongs', '.sd-worksongs'] },
  ],
};

sheetTutorial('Songs for this session', [
  { title: 'Pick the songs', text: 'Tick each song this session works on. The take log starts with the first one.', target: ['.sheet .checks', '.sheet .form'] },
]);

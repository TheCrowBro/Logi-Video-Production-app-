// Take log box (studio sessions): this session's take logs from the Studio log, with how many takes and keepers each
// has. Start a take log makes one for the session's first song and opens it; tapping a log opens it.
import { h, toast, fmtShort, todayISO } from '../util.js';
import { db, byId } from '../store.js';

const logsFor = id => db.logs.filter(l => l && l.bookingId === id).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (Number(b.startedAt) || 0) - (Number(a.startedAt) || 0));
const takesOf = l => (Array.isArray(l.takes) ? l.takes.filter(Boolean) : []);
const keepers = l => takesOf(l).filter(t => t.rating === 'keep').length;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const songTitle = id => (id && byId('songs', id) ? byId('songs', id).title : '');
const studio = () => import('../pages/sessions.js');

function start(b) {
  const songId = (b.songIds || []).find(id => byId('songs', id)) || '';
  const title = songTitle(songId) ? `${songTitle(songId)} takes` : `Session takes ${fmtShort(todayISO())}`;
  return studio().then(m => m.newLog({ bookingId: b.id, songId, title })).catch(() => toast('The Studio log could not be opened.'));
}

export default {
  id: 'takes', title: 'Take log', icon: '🎙️', order: 35,
  kinds: ['session'],
  summary(b) {
    const logs = logsFor(b.id); if (!logs.length) return '';
    return `${plural(logs.length, 'log')} · ${plural(logs.reduce((t, l) => t + keepers(l), 0), 'keeper')}`;
  },
  render(b) {
    const logs = logsFor(b.id);
    const startBtn = h('button', { type: 'button', class: 'btn ' + (logs.length ? 'ghost' : 'primary'), id: `sd-start-log-${b.id}`, onclick: () => start(b) }, '🎙️ Start a take log');
    if (!logs.length) return h('div', { class: 'sd-takes-box' },
      h('p', { class: 'muted small' }, 'Log the takes as you record: + Take as each one starts, rate them Keep, Maybe or No, and note what to use in the comp.'),
      h('div', { class: 'actions' }, startBtn));
    return h('div', { class: 'sd-takes-box' },
      h('div', { class: 'sd-takes-logs' }, logs.map(l => {
        const n = takesOf(l).length, k = keepers(l);
        const songs = [...new Set(takesOf(l).map(t => songTitle(t.songId)).filter(Boolean))];
        if (!songs.length && songTitle(l.songId)) songs.push(songTitle(l.songId));
        return h('button', { type: 'button', class: 'card tap sd-log', 'data-id': l.id, 'aria-label': `Open ${l.title || 'take log'}: ${plural(n, 'take')}, ${plural(k, 'keeper')}`, onclick: () => studio().then(m => m.openLog(l.id)) },
          h('div', { class: 'card-row' },
            h('div', null, h('strong', null, l.title || 'Take log'), h('div', { class: 'muted small' }, [l.date && fmtShort(l.date), songs.join(', ')].filter(Boolean).join(' · '))),
            h('div', { class: 'sd-log-pills' }, h('span', { class: 'pill' }, plural(n, 'take')), k > 0 && h('span', { class: 'pill st-confirmed' }, `★ ${k}`), h('span', { class: 'sd-open', 'aria-hidden': 'true' }, 'Open ›'))));
      })),
      h('div', { class: 'actions' }, startBtn));
  },
  tutorial: [
    { title: 'Take log', text: 'This session’s take logs from the Studio log. Start one when you start recording; tap a log to open it.', target: ['#blk-takes .sd-takes-box', '.sd-takes-box'] },
  ],
};

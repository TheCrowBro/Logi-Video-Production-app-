// The Setlist box on a show or a rehearsal: pick one of the act's setlists (or any other), or start a new one for this
// booking; see it compactly with its running time against the show's set length; edit it, print the stage copy, or
// take it off the booking. Attaching a setlist with songs to a show ticks "Setlist ready" on its checklist.
import { h, announce, toast, fmtShort } from '../util.js';
import { db, byId, patch } from '../store.js';
import { setlistLength, fmtDur, fmtMin, actName, markCheck, venueOf, bookingTitle } from '../model.js';
import { openSetlist, newSetlist, printSetlist, setlistPlan, shortKey, fitNote, tickShows, hasSongs, setClock, plural } from '../setlist.js';

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base', numeric: true });
const what = b => (b.kind === 'show' ? 'show' : b.kind === 'rehearsal' ? 'rehearsal' : 'booking');
const slotOf = b => (b && b.kind === 'show' && Number(b.setLength) > 0 ? Number(b.setLength) : 0);
const current = b => (b && b.setlistId ? byId('setlists', b.setlistId) : null);

function attach(b, id) {
  if (!id) return detach(b);
  const list = byId('setlists', id);
  if (!list) return;
  patch('bookings', b.id, { setlistId: id });
  // A setlist with songs is ready; an empty one is not, whatever the old one was.
  if (b.kind === 'show') { if (hasSongs(list)) tickShows(id); else markCheck(b.id, 'show-setlist', false); }
  announce(`${list.name || 'Setlist'} is now this ${what(b)}’s setlist`);
}
function detach(b) {
  const list = current(b);
  patch('bookings', b.id, { setlistId: '' });
  if (b.kind === 'show') markCheck(b.id, 'show-setlist', false);
  toast(`Setlist taken off this ${what(b)}${list ? `. “${list.name || 'Setlist'}” is still under Songs.` : ''}`);
}
// A new setlist named after the night ("The Lantern Rooms · Fri, Nov 16"), for the booking's act, opened in the editor.
function createFor(b) {
  const name = [venueOf(b).name, b.date && fmtShort(b.date)].filter(Boolean).join(' · ') || `${bookingTitle(b)} setlist`;
  const rec = newSetlist({ actId: (b.actId && byId('acts', b.actId) ? b.actId : ''), name });
  patch('bookings', b.id, { setlistId: rec.id });
  openSetlist(rec.id, { target: slotOf(b) || undefined, bookingId: b.id });
}

// The setlists to choose from: the booking's act's first, then the rest.
function chooser(b, list) {
  const act = b.actId && byId('acts', b.actId) ? b.actId : '';
  const mine = db.setlists.filter(s => act && s.actId === act).sort(byName);
  const others = db.setlists.filter(s => !(act && s.actId === act)).sort(byName);
  const opt = s => h('option', { value: s.id, selected: !!list && s.id === list.id }, `${s.name || 'Untitled setlist'} · ${fmtDur(setlistLength(s).sec)}`);
  const sel = h('select', { id: 'sg-blk-pick-' + b.id, 'aria-label': list ? 'Change this booking’s setlist' : 'Choose a setlist for this booking', onchange: e => attach(b, e.target.value) },
    h('option', { value: '', selected: !list }, list ? 'No setlist' : 'Choose a setlist…'),
    mine.length > 0 && h('optgroup', { label: actName(act) || 'This act' }, mine.map(opt)),
    others.length > 0 && h('optgroup', { label: mine.length ? 'Other setlists' : 'Setlists' }, others.map(opt)));
  return h('label', { class: 'sg-blk-pick' }, h('span', { class: 'small muted' }, list ? 'Setlist' : 'Use one of your setlists'), sel);
}

export default {
  id: 'setlist', title: 'Setlist', icon: '🎼', order: 40,
  kinds: ['show', 'rehearsal'],
  summary(b) {
    const list = current(b);
    if (!list) return '';
    const t = setlistLength(list);
    return `${list.name || 'Setlist'} · ${plural(t.songs, 'song')} · ${fmtDur(t.sec)}`;
  },
  render(b) {
    const list = current(b), slot = slotOf(b), isShow = b.kind === 'show';
    if (!list) {
      return h('div', { class: 'sg-blk' },
        h('p', { class: 'small muted' }, db.setlists.length
          ? `Pick one of your setlists, or start a new one from your songs${slot ? ` for the ${fmtMin(slot)} set` : ''}.`
          : `No setlists yet. Start one for this ${what(b)} from your songs${slot ? `, and fit it to the ${fmtMin(slot)} set` : ''}.`),
        db.setlists.length > 0 && chooser(b, null),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', 'data-fk': 'sg-blk-main-' + b.id, onclick: () => createFor(b) }, `+ New setlist for this ${what(b)}`)));
    }
    const p = setlistPlan(list), fit = fitNote(p.sec, slot), clock = isShow ? setClock(b, p.sec) : null;
    let encore = false;
    const rows = [];
    for (const r of p.rows) {
      if (r.kind === 'break') { rows.push(h('li', { class: 'sg-mini-break' }, r.title)); encore = /encore/i.test(r.title); continue; }
      if (r.it.encore && !encore) { rows.push(h('li', { class: 'sg-mini-break' }, 'Encore')); encore = true; }
      rows.push(h('li', null,
        h('span', { class: 'sg-mini-n' }, r.n + '.'),
        h('span', { class: 'sg-mini-t' }, r.title, r.it.segue && !r.last ? [h('span', { class: 'sg-mini-seg', title: 'Segue', 'aria-hidden': 'true' }, ' →'), h('span', { class: 'sr-only' }, ' (segue)')] : null),
        h('span', { class: 'sg-mini-m' }, [r.key && shortKey(r.key), r.dur ? fmtDur(r.dur) : '—'].filter(Boolean).join(' · '))));
    }
    return h('div', { class: 'sg-blk' },
      chooser(b, list),
      h('div', { class: 'sg-blk-total' },
        h('b', null, fmtDur(p.sec)),
        h('span', { class: 'muted' }, slot ? ` of a ${fmtMin(slot)} set · ` : ' running time · ', plural(p.songs, 'song')),
        list.actId && list.actId !== b.actId && actName(list.actId) && h('span', { class: 'muted small' }, ` · ${actName(list.actId)}’s setlist`)),
      fit.tone === 'over' && h('p', { class: 'warn sg-blk-fit' }, `⚠ ${fit.text}. Cut a song or ask the promoter for a longer set.`),
      fit.tone === 'under' && h('p', { class: 'sg-soft sg-blk-fit' }, `${fit.text}: room for another song or two.`),
      fit.tone === 'ok' && h('p', { class: 'sg-ok sg-blk-fit' }, '✓ ' + fit.text),
      isShow && !slot && h('p', { class: 'small muted' }, 'Add the set length to this show to check the setlist fits.'),
      clock && h('p', { class: 'small ' + (clock.late ? 'warn' : 'muted') }, `On at ${clock.on}, off about ${clock.off}${clock.late ? `: past the ${clock.curfew} curfew` : clock.curfew ? ` · curfew ${clock.curfew}` : ''}`),
      p.missing > 0 && h('p', { class: 'small muted' }, `${plural(p.missing, 'item')} ${p.missing === 1 ? 'has' : 'have'} no length yet, so the real running time is longer.`),
      rows.length ? h('ol', { class: 'sg-mini', 'aria-label': `${list.name || 'Setlist'}, in playing order` }, rows) : h('p', { class: 'small muted' }, 'Nothing in it yet: tap Edit to add songs.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary small', type: 'button', 'data-fk': 'sg-blk-main-' + b.id, onclick: () => openSetlist(list.id, { target: slot || undefined, bookingId: b.id }) }, '✎ Edit'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => printSetlist(list.id, { bookingId: b.id }) }, '🖨 Print'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => detach(b) }, `Remove from this ${what(b)}`)));
  },
  tutorial: [
    { target: ['#blk-setlist'], title: 'Setlist', text: 'Pick one of the act’s setlists or start a new one for this show. Its running time is checked against the set length (and the curfew), Edit opens the editor sized to the slot, and Print makes the big stage copy. A setlist with songs ticks “Setlist ready” on the checklist.' },
  ],
};

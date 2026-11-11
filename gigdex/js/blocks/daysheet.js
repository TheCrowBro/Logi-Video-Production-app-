// The day sheet box on a show, session or rehearsal: the day's times at a glance, the key lines of the sheet, whether
// the band has it, and the ways to send it. The full sheet (preview, what goes on it, QR code) opens from here.
import { h } from '../util.js';
import { byId } from '../store.js';
import { daySheetData, daySheetLink, sentState, stateText, missingBits, listWords, emailButton, emailCount, openDaySheet, shareDaySheet, printDaySheet, choices, sameChoices, TIME_LABELS } from '../daysheet.js';

const firstNames = people => { const n = people.map(p => (p.name || '').split(/\s+/)[0]).filter(Boolean); return n.length > 6 ? n.slice(0, 5).join(', ') + ` and ${n.length - 5} more` : n.join(', '); };

export default {
  id: 'daysheet', title: 'Day sheet', icon: '📋', order: 50,
  kinds: ['show', 'session', 'rehearsal'],

  // "Sent" once the band has it; until then the day's times.
  summary(b) {
    const st = sentState(b);
    if (st === 'sent') return 'Sent';
    if (st === 'changed') return 'Changed since sent';
    const d = daySheetData(b);
    if (!d || !d.times.length) return '';
    if (b.kind !== 'show') return d.times.map(x => x.t).join('–');
    const first = d.times[0], on = d.times.find(x => x.k === 'setTime');
    return [first && `${TIME_LABELS[first.k]} ${first.t}`, on && on !== first && `on ${on.t}`].filter(Boolean).join(' · ');
  },

  render(b) {
    const d = daySheetData(b);
    if (!d) return h('p', { class: 'muted' }, 'This booking is not here any more.');
    const st = sentState(b), inc = choices(), S = d.setlist;
    const lineupWord = b.kind === 'show' || b.kind === 'rehearsal' ? 'line-up' : 'booking';
    const lines = [
      ['📍', d.place.name || d.place.address ? [d.place.name, (d.place.address || '').replace(/\s*\n+\s*/g, ', ')].filter(Boolean).join(' · ') : ''],
      ['👥', d.people.length ? `${d.people.length} on the ${lineupWord}: ${firstNames(d.people)}` : ''],
      ['🎼', S ? [S.name || 'Setlist', S.songs ? `${S.songs} song${S.songs === 1 ? '' : 's'}` : 'no songs yet', S.total].filter(Boolean).join(' · ') : d.songs.length ? 'Songs: ' + d.songs.map(x => x.t).join(', ') : ''],
      ['🎟', d.guests ? `Guest list: ${d.guests.count}${d.guests.cap ? ' of ' + d.guests.cap : ''}` : ''],
      // Notes are free text the band will read: say so here, where the sheet is sent without its preview.
      ['📝', d.notes ? 'Your booking notes are on it: check they say nothing private' : String(b.notes || '').trim() ? 'Your booking notes are left off' : ''],
    ].filter(x => x[1]);
    const miss = missingBits(b, d);

    // The link, Email, Share and Print follow what goes on it at the moment of the tap: if it was changed since this box
    // was drawn, the link is made again (Email waits for it), so nothing taken off goes out.
    let url = '', made = null;
    const make = use => {
      made = use; url = ''; email.setAttribute('aria-disabled', 'true'); email.href = '#';
      daySheetLink(byId('bookings', b.id) || b, use).then(u => { if (made !== use) return; url = u; email.fill(u, use); }).catch(() => { /* the button says to wait; the sheet explains */ });
    };
    const link = () => { const now = choices(); if (!sameChoices(now, made)) make(now); return url; };
    const n = emailCount(b);
    const email = emailButton(b.id, link, inc, n ? `✉ Email (${n})` : '✉ Email', n ? `Email the day sheet to the band: ${n} ${n === 1 ? 'address' : 'addresses'}` : 'Email the day sheet to the band');
    make(inc);

    return h('div', { class: 'ds-blk' },
      d.times.length
        ? h('ul', { class: 'ds-strip', 'aria-label': 'Times in day order' }, d.times.map(x => h('li', { class: 'ds-chip' + (x.n ? ' late' : '') }, h('span', null, TIME_LABELS[x.k]), h('b', null, x.t), x.n ? h('em', null, 'after midnight') : null)))
        : h('p', { class: 'muted small' }, 'No times yet. Add them to the booking and they go on the sheet in the order the day runs.'),
      lines.length ? h('ul', { class: 'ds-lines' }, lines.map(([icon, text]) => h('li', null, h('span', { class: 'ds-ico', 'aria-hidden': 'true' }, icon), h('span', null, text)))) : null,
      miss.length ? h('p', { class: 'small muted ds-miss' }, `Not on it yet: ${listWords(miss)}.`) : null,
      h('p', { class: 'ds-state ' + st }, stateText(b, st)),
      h('div', { class: 'ds-blk-actions' },
        h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Open the day sheet', onclick: () => openDaySheet(b.id) }, '📋 Open sheet'),
        h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Share the day sheet link', onclick: () => { const u = link(); shareDaySheet(b.id, made, u); } }, '📤 Share link'),
        email,
        h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Print the day sheet', onclick: () => { link(); printDaySheet(b.id, made); } }, '🖨 Print')),
      h('div', { class: 'ds-onit' },
        h('p', { class: 'small muted' }, 'Never on it: the deal, fees, ticket price, settlement or budget.'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Choose what goes on the day sheet', onclick: () => openDaySheet(b.id, { parts: true }) }, '☑ What goes on it')));
  },

  tutorial: [
    { title: 'Day sheet', text: 'The band’s sheet for the day: times in order (after-midnight ones last), the venue, running order, line-up, setlist, backline, hospitality and your booking notes. Never the money.', target: ['#blk-daysheet'] },
    { title: 'Send it to the band', text: 'Share the link to the band chat, email everyone on the booking, or print it. Sending ticks “Day sheet sent” on the checklist. Open day sheet for the preview, the QR code and what goes on it.', target: ['#blk-daysheet .ds-blk-actions'] },
    { title: 'What goes on it', text: 'Your booking notes go on the sheet unless you leave them off, and the guest names only if you add them. Check here before you send it.', target: ['#blk-daysheet .ds-onit .btn'] },
  ],
};

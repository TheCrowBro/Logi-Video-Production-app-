// The page cast and crew open from a "Share with crew" link: the shoot packed into the URL fragment by the producer's
// copy of Vdex, drawn here read-only. No store, no account, nothing fetched but this page. Only the fields below are
// ever shown, and the link never carries money: no prices, rates, budgets, quotes or invoices.
import { h, fmtLong, fmtShort, mapsUrl, telUrl } from './util.js';
import { unpack } from './link-pack.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
addEventListener('hashchange', () => location.reload()); // another crew link opened in this same tab
const fail = msg => { box.replaceChildren(h('div', { class: 'msg' }, h('h1', null, 'This link does not open shoot info'), h('p', null, msg), h('p', null, 'Ask the producer who sent it for a fresh link.'))); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const kv = rows => { const r = rows.filter(([, v]) => v); return r.length ? h('dl', { class: 'kv' }, r.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null; };
const section = (title, ...kids) => { const body = kids.flat().filter(Boolean); return body.length ? [h('h2', null, title), ...body] : []; };
const link = (href, text) => h('a', { href }, text);
const slug = s => String(s || 'shoot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// A calendar file for the shoot, made here from what the link carries.
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d, t) => d.replace(/-/g, '') + (t ? 'T' + t.replace(':', '').padEnd(4, '0') + '00' : '');
const nextDay = d => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m - 1, dd + 1); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`; };
function ics(snap) {
  const last = snap.endDate || snap.date, start = snap.call.general || snap.start, end = snap.call.wrap || snap.end;
  const timed = /^\d{1,2}:\d{2}$/.test(start || '') && (!end || /^\d{1,2}:\d{2}$/.test(end));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vdex//Crew//EN', 'BEGIN:VEVENT', `UID:crew-${snap.date}-${slug(snap.title)}-${snap.made || 0}@vdex`, `DTSTAMP:${stamp}`,
    timed ? `DTSTART:${icsDate(snap.date, start.padStart(5, '0'))}` : `DTSTART;VALUE=DATE:${icsDate(snap.date)}`,
    timed ? `DTEND:${icsDate(last, (end || start).padStart(5, '0'))}` : `DTEND;VALUE=DATE:${nextDay(last)}`,
    `SUMMARY:${icsText(snap.title)}`, snap.location.address && `LOCATION:${icsText(snap.location.address)}`,
    `DESCRIPTION:${icsText([snap.producer && 'Producer: ' + snap.producer, snap.call.general && 'Call: ' + snap.call.general, 'Shoot info: ' + location.href].filter(Boolean).join('\n'))}`,
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
  return lines.join('\r\n') + '\r\n';
}
const save = (text, name, type) => { const a = h('a', { href: URL.createObjectURL(new File([text], name, { type })), download: name }); document.body.append(a); a.click(); a.remove(); };

(async () => {
  let snap;
  try { snap = await unpack(location.hash); } catch (e) { return fail(/document/.test(e.message || '') ? e.message : 'It is incomplete or damaged: part of it may have been cut off when it was copied.'); }
  if (!snap || snap.kind !== 'crew' || !isDate(snap.date)) return fail('It is incomplete or damaged.');
  snap.call = snap.call || {}; snap.location = snap.location || {};
  const when = snap.endDate && snap.endDate > snap.date ? `${fmtLong(snap.date)} → ${fmtLong(snap.endDate)}` : fmtLong(snap.date);
  document.title = `${snap.title || 'Shoot'} — ${fmtShort(snap.date)}`;
  bar.replaceChildren(
    h('div', { class: 'who' }, snap.title || 'Shoot info', snap.producer && h('small', null, 'from ' + snap.producer)),
    h('div', { class: 'acts' }, h('button', { class: 'btn', type: 'button', onclick: () => save(ics(snap), `${slug(snap.title)}.ics`, 'text/calendar') }, '📆 Add to calendar'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print')));

  const L = snap.location, C = snap.call;
  const days = [...new Set((snap.schedule || []).map(r => r.date || snap.date))].sort();
  const schedule = (snap.schedule || []).length ? days.map(d => [days.length > 1 && isDate(d) && h('div', { class: 'day' }, fmtLong(d)),
    h('table', null, h('tbody', null, snap.schedule.filter(r => (r.date || snap.date) === d).map(r => h('tr', null, h('td', { style: 'width:5.5em;white-space:nowrap' }, r.time || ''), h('td', null, r.item || '')))))]) : null;
  const people = (list, withCall) => list.length ? h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), withCall && h('th', null, 'Call'), h('th', null, 'Contact'))),
    h('tbody', null, list.map(p => h('tr', null, h('td', null, p.name || '—'), h('td', null, p.role || ''), withCall && h('td', null, p.call || ''),
      h('td', null, [p.phone && link(telUrl(p.phone), p.phone), p.phone && p.email && h('br'), p.email && link('mailto:' + p.email, p.email)]))))) : null;
  const kitGroups = {}; (snap.kit || []).forEach(k => { (kitGroups[k.cat || 'Other'] = kitGroups[k.cat || 'Other'] || []).push(k); });

  box.replaceChildren(h('div', { class: 'paper' },
    h('h1', null, snap.title || 'Shoot'),
    h('p', { class: 'sub' }, [snap.type, when].filter(Boolean).join(' · ')),
    snap.client && h('p', { class: 'sub' }, 'Client: ' + snap.client),
    ...section('Call', kv([['General call', C.general], ['Lunch', C.lunch], ['Wrap', C.wrap], ['Breaks', C.breaks], ['Dress', C.dress], ['Weather', C.weather], ['Emergency contact', C.emergency]])),
    ...section('Location', kv([['Venue', L.venue], ['Address', L.address && link(mapsUrl(L.address), L.address)], ['Access', L.access], ['Parking', L.parking], ['Power', L.power], ['Nearest hospital', L.hospital], ['Venue rules', L.rules]])),
    ...section('Schedule', schedule),
    ...section('Crew', people(snap.crew || [], true)),
    ...section('Client and on set', people(snap.contacts || [], false), snap.onSet && h('p', { class: 'pre' }, snap.onSet)),
    ...section('Shot list', (snap.shots || []).length ? h('ul', { class: 'plain' }, snap.shots.map(s => h('li', { class: s.done ? 'done' : '' }, (s.done ? '✓ ' : '○ ') + s.text))) : null),
    ...section('Equipment', Object.keys(kitGroups).length ? Object.entries(kitGroups).map(([cat, items]) => [h('div', { class: 'day' }, cat), h('ul', { class: 'plain' }, items.map(k => h('li', null, k.name + (k.qty > 1 ? ` × ${k.qty}` : ''))))]) : null),
    ...section('Deliverables', (snap.deliverables || []).length ? h('table', null, h('tbody', null, snap.deliverables.map(x => h('tr', null, h('td', null, x.name), h('td', null, x.duration || ''), h('td', null, isDate(x.due) ? 'due ' + fmtShort(x.due) : ''), h('td', null, x.status || ''))))) : null),
    ...section('Instructions', snap.notes && h('p', { class: 'pre' }, snap.notes)),
    h('p', { class: 'note' }, `Sent ${snap.made ? new Date(snap.made).toLocaleString() : ''}. This is a copy from that moment: if plans change, the producer sends a new link.`)));
})();

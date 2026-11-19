// The page cast and crew open from a "Share with crew" link: the shoot packed into the URL fragment by the producer's
// copy of Vdex, drawn here read-only. No store, no account, nothing fetched but this page. Only the fields below are
// ever shown, and the link never carries money: no prices, rates, budgets, quotes or invoices. Someone who uses Vdex
// can add the shoot to their own Bookings: "Add to my Vdex" hands the same packed link to the app (js/share-add.js).
import { h, fmtLong, fmtShort, mapsUrl, telUrl } from './util.js';
import { readShared, addHref, elsewhere, isDate } from './share-data.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
addEventListener('hashchange', () => location.reload()); // another crew link opened in this same tab
const fail = msg => { box.replaceChildren(h('div', { class: 'msg' }, h('h1', null, 'This link does not open shoot info'), h('p', null, msg), h('p', null, 'Ask the producer who sent it for a fresh link.'))); };
const kv = rows => { const r = rows.filter(([, v]) => v); return r.length ? h('dl', { class: 'kv' }, r.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null; };
const section = (title, ...kids) => { const body = kids.flat().filter(Boolean); return body.length ? [h('h2', null, title), ...body] : []; };
const link = (href, text) => h('a', { href }, text);
const slug = s => String(s || 'shoot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// A calendar file for the shoot, made here from what the link carries. Every value is cleaned first (a link can be
// made by anyone), each line is folded at 75 bytes, and the event keeps one id per shoot so a newer link updates it.
const icsText = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = line => { const out = []; let cur = '', bytes = 0; for (const ch of line) { const n = new TextEncoder().encode(ch).length; if (bytes + n > 74) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += n; } out.push(cur); return out.join('\r\n'); };
const TIME = /^(\d{1,2}):(\d{2})$/;
const at = (d, t) => { const [y, m, dd] = d.split('-').map(Number), x = TIME.exec(t || ''); return x ? new Date(y, m - 1, dd, Number(x[1]), Number(x[2])) : null; };
const stamp = x => `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}${String(x.getMinutes()).padStart(2, '0')}00`;
const dayStamp = (d, add = 0) => { const [y, m, dd] = d.split('-').map(Number), x = new Date(y, m - 1, dd + add); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`; };
function ics(snap) {
  const last = snap.endDate || snap.date, start = at(snap.date, snap.call.general || snap.start);
  let end = at(last, snap.call.wrap || snap.end);
  if (start && end && end <= start) end = new Date(end.getTime() + 864e5); // an overnight shoot wraps the next morning
  if (start && !end) end = new Date(start.getTime() + 36e5);              // no wrap time: an hour, rather than no length
  const made = snap.made || Date.now();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vdex//Crew//EN', 'BEGIN:VEVENT',
    snap.ref ? `UID:crew-${slug(snap.ref)}@vdex` : `UID:crew-${slug(snap.title)}-${snap.date}@vdex`, // a moved shoot replaces its event
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`, // when this file was made: every event must say
    `SEQUENCE:${Math.floor(made / 1000) % 2147483647}`, `LAST-MODIFIED:${new Date(made).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    start ? `DTSTART:${stamp(start)}` : `DTSTART;VALUE=DATE:${dayStamp(snap.date)}`,
    start ? `DTEND:${stamp(end)}` : `DTEND;VALUE=DATE:${dayStamp(last, 1)}`,
    `SUMMARY:${icsText(snap.title)}`, snap.location.address && `LOCATION:${icsText(snap.location.address)}`,
    `DESCRIPTION:${icsText([snap.producer && 'Producer: ' + snap.producer, snap.call.general && 'Call: ' + snap.call.general, 'Shoot info: ' + location.href].filter(Boolean).join('\n'))}`,
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
  return lines.map(l => fold(String(l).replace(/[\r\n]+/g, ' '))).join('\r\n') + '\r\n';
}
const save = (text, name, type) => { const a = h('a', { href: URL.createObjectURL(new File([text], name, { type })), download: name }); document.body.append(a); a.click(); a.remove(); };

(async () => {
  // Only the fields js/share-data.js allows are ever shown: anything else in a link is dropped, never drawn or written into a file.
  let snap;
  try { snap = await readShared(location.hash); } catch (e) {
    if (e.code === 'none') return fail('It has no shoot info in it: part of the link may be missing.');
    if (e.code === 'doc') return location.replace('invoice.html' + location.hash); // a quote or an invoice has its own page
    return fail(e.code === 'damaged' ? 'It is incomplete or damaged: part of it may have been cut off when it was copied.' : e.message);
  }
  if (snap.kind !== 'crew') return location.replace('shared.html' + location.hash); // a contact card or an equipment list has its own page
  const when = snap.endDate && snap.endDate > snap.date ? `${fmtLong(snap.date)} → ${fmtLong(snap.endDate)}` : fmtLong(snap.date);
  document.title = `${snap.title || 'Shoot'} — ${fmtShort(snap.date)}`;
  bar.replaceChildren(
    h('div', { class: 'who' }, snap.title || 'Shoot info', snap.producer && h('small', null, 'from ' + snap.producer)),
    h('div', { class: 'acts' }, h('a', { class: 'btn primary', href: addHref(location.hash, document.referrer), title: 'Opens Vdex and shows what would be added to your Bookings, before anything is' }, '＋ Add to my Vdex'),
      h('button', { class: 'btn', type: 'button', onclick: () => save(ics(snap), `${slug(snap.title)}.ics`, 'text/calendar') }, '📆 Add to calendar'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print')),
    elsewhere('Bookings'));

  const L = snap.location, C = snap.call;
  const days = [...new Set((snap.schedule || []).map(r => r.date || snap.date))].sort();
  const dayHeads = snap.endDate || days.some(d => d !== snap.date);
  const schedule = (snap.schedule || []).length ? days.map(d => [dayHeads && isDate(d) && h('div', { class: 'day' }, fmtLong(d)),
    h('table', null, h('tbody', null, snap.schedule.filter(r => (r.date || snap.date) === d).map(r => h('tr', null, h('td', { style: 'width:5.5em;white-space:nowrap' }, r.time || ''), h('td', null, r.item || '')))))]) : null;
  const people = (list, withCall) => list.length ? h('table', null,
    h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), withCall && h('th', { class: 'nw' }, 'Call'), h('th', null, 'Contact'))),
    h('tbody', null, list.map(p => h('tr', null, h('td', null, p.name || '—'), h('td', null, p.role || ''), withCall && h('td', { class: 'nw' }, p.call || ''),
      // p.email is an address and nothing more (js/share-data.js), so it can be a link; anything else written there is only
      // shown, and breaks where it must like an address does (.etext in crew.html), so a long one cannot widen the page
      h('td', null, [p.phone && link(telUrl(p.phone), p.phone), p.phone && (p.email || p.emailText) && h('br'), p.email ? link('mailto:' + p.email, p.email) : p.emailText && h('span', { class: 'etext' }, p.emailText)]))))) : null;
  // By category, in a Map: a category is text from the link, and one called "constructor" must not find anything on an object.
  const kitGroups = new Map(); (snap.kit || []).forEach(k => { const c = k.cat || 'Other'; kitGroups.set(c, [...(kitGroups.get(c) || []), k]); });

  box.replaceChildren(h('div', { class: 'paper' },
    h('h1', null, snap.title || 'Shoot'),
    h('p', { class: 'sub' }, [snap.type, when].filter(Boolean).join(' · ')),
    snap.client && h('p', { class: 'sub' }, 'Client: ' + snap.client),
    ...section('Call', kv([['General call', C.general], ['Lunch', C.lunch], ['Wrap', C.wrap], ['Breaks', C.breaks], ['Dress', C.dress], ['Weather', C.weather], ['Emergency contact', C.emergency]])),
    ...section('Location', kv([['Venue', L.venue], ['Address', L.address && link(mapsUrl(L.address), L.address)], ['Access', L.access], ['Parking', L.parking], ['Power', L.power], ['Nearest hospital', L.hospital], ['Venue rules', L.rules]])),
    ...section('Schedule', schedule),
    ...section('Crew', people(snap.crew || [], true)),
    ...section('Client and on set', people(snap.contacts || [], false), snap.onSet && h('p', { class: 'pre' }, snap.onSet)),
    ...section('Scenes', (snap.scenes || []).length ? snap.scenes.map(d => [h('div', { class: 'day' }, `Day ${d.n}${d.date ? ' · ' + fmtLong(d.date) : ''}${d.pages ? ' · ' + d.pages + ' pages' : ''}`),
      h('table', { class: 'scenes' }, h('tbody', null, d.items.map(x => (x.banner != null ? h('tr', { class: 'banner' }, h('td', { colspan: 4 }, x.banner)) : h('tr', { class: x.kind }, h('td', { class: 'nw' }, x.scene || '—'), h('td', null, h('b', null, [x.ie, x.set].filter(Boolean).join(' ')), x.tod && ` — ${x.tod}`, x.desc && h('div', null, x.desc), x.cast.length > 0 && h('div', { class: 'cast' }, x.cast.join(', '))), h('td', { class: 'nw' }, x.pages ? x.pages + ' pg' : ''))))))]) : null,
      snap.cut > 0 && h('p', { class: 'note' }, `This link holds more scenes than one shoot may bring: ${snap.cut.toLocaleString()} more ${snap.cut === 1 ? 'is' : 'are'} not shown.`)),
    ...section('Shot list', (snap.shots || []).length ? h('ul', { class: 'plain' }, snap.shots.map(s => h('li', { class: s.done ? 'done' : '' }, (s.done ? '✓ ' : '○ ') + s.text))) : null),
    ...section('Equipment', kitGroups.size ? [...kitGroups].map(([cat, items]) => [h('div', { class: 'day' }, cat), h('ul', { class: 'plain' }, items.map(k => h('li', null, k.name + (k.qty > 1 ? ` × ${k.qty}` : ''))))]) : null),
    ...section('Deliverables', (snap.deliverables || []).length ? h('table', null, h('tbody', null, snap.deliverables.map(x => h('tr', null, h('td', null, x.name), h('td', { class: 'nw' }, x.duration || ''), h('td', { class: 'nw' }, isDate(x.due) ? 'due ' + fmtShort(x.due) : ''), h('td', null, x.status || ''))))) : null),
    ...section('Instructions', snap.notes && h('p', { class: 'pre' }, snap.notes)),
    h('p', { class: 'note' }, `Sent ${snap.made ? new Date(snap.made).toLocaleString() : ''}. This is a copy from that moment: if plans change, the producer sends a new link.`),
    // Inside the paper, so it is printed too: the page's footer is not (crew.html hides .foot on paper).
    h('p', { class: 'note checked' }, 'The times, places, weather, sun times and emergency details here were entered or chosen by the producer. Vdex has not checked them and they may be out of date. Confirm with the producer.'))); // the call sheet's own notice (CHECK_NOTICE in js/callsheet.js), word for word
})();

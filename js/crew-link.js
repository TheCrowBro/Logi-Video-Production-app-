// "Share with crew": the shoot's practical details packed into a link, as the client's invoice link is, so no server
// is involved and nothing is stored online. What goes in is listed field by field below: prices, rates, budgets,
// quotes, invoices, kit values and booking notes are never copied in, whatever is ticked. Loaded on first use.
import { h, sheet, toast, fmtShort } from './util.js';
import { byId, endOf, usedQty } from './store.js';
import { callSheetData } from './callsheet.js';
import { typeLabel } from './workflow.js';
import { pack } from './link-pack.js';
import { SITE } from './version.js';

// What the producer can leave out. Client contacts are off unless chosen: they are the client's details, not the crew's.
export const PARTS = [
  ['client', 'Client name', true], ['crew', 'Crew, their call times and phone numbers', true], ['contacts', 'Client contacts and who is on set', false],
  ['shots', 'Shot list', true], ['kit', 'Equipment list (no values)', true], ['deliverables', 'Deliverables and due dates', true],
  ['rules', 'Venue rules', true], ['notes', 'Call sheet instructions', true],
];
const KEY = 'logi-crew-share';
const choices = () => { let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* defaults */ } return Object.fromEntries(PARTS.map(([k, , on]) => [k, typeof saved[k] === 'boolean' ? saved[k] : on])); };
const remember = inc => { try { localStorage.setItem(KEY, JSON.stringify(inc)); } catch { /* fine */ } };
const str = v => (v == null ? '' : String(v));
const person = p => ({ name: str(p.name), role: str(p.role), phone: str(p.phone), email: str(p.email) });

export function crewSnapshot(b, inc = choices()) {
  b = byId('bookings', b.id) || b;
  const d = callSheetData(b), { cs, v } = d;
  const snap = {
    v: 1, kind: 'crew', made: Date.now(),
    title: str(b.title), type: typeLabel(b.type), date: b.date, endDate: endOf(b) > b.date ? endOf(b) : '', start: str(b.start), end: str(b.end),
    producer: str(d.producerLine),
    call: { general: str(d.generalCall), lunch: str(cs.lunch), wrap: str(d.wrap), breaks: str(d.breaks), dress: str(cs.dress), weather: str(cs.weather), emergency: str(cs.emergency) },
    location: { venue: str(v && v.name), address: str(d.address), access: str(v && v.access), parking: str(v && v.parking), power: str(v && v.power), hospital: str(v && v.hospital), rules: inc.rules ? str(v && v.rules) : '' },
    schedule: d.schedule.map(r => ({ date: str(r.date), time: str(r.time), item: str(r.item) })),
  };
  if (inc.client) snap.client = str(b.client);
  if (inc.crew) snap.crew = d.crew.map(c => ({ ...person(c), call: str(c.call) }));
  if (inc.contacts) { snap.contacts = (b.stakeholders || []).map(person); snap.onSet = str(cs.attendees); }
  if (inc.shots) snap.shots = (b.shots || []).map(s => ({ text: str(s.text), done: !!s.done }));
  if (inc.kit) snap.kit = (b.gear || []).map(id => byId('gear', id)).filter(Boolean).map(g => ({ name: str(g.name), cat: str(g.category), qty: usedQty(b, g.id) }));
  if (inc.deliverables) snap.deliverables = (b.deliverables || []).map(x => ({ name: str(x.name), duration: str(x.duration), due: str(x.due), status: str(x.status) }));
  if (inc.notes) snap.notes = str(cs.notes);
  return snap;
}

const siteBase = () => (window.vdexDesktop || !/^https?:$/.test(location.protocol) ? SITE : new URL('./', location.href).href);
export async function crewLink(b, inc) { return siteBase() + 'crew.html#' + await pack(crewSnapshot(b, inc)); }

export function openCrewShare(b) {
  const inc = choices();
  const area = h('textarea', { class: 'share-link', readonly: true, rows: 4, 'aria-label': 'Link for the crew' });
  const mail = h('a', { class: 'btn ghost' }, '✉ Email the crew');
  const preview = h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener' }, 'Open preview');
  const qrBox = h('div', { class: 'share-qr' });
  let url = '', seq = 0;
  const make = async () => {
    const n = ++seq;
    try { const u = await crewLink(b, inc); if (n !== seq) return; url = u; } catch (e) { toast('Could not make the link: ' + (e.message || e)); return; }
    area.value = url; preview.href = url;
    const d = callSheetData(byId('bookings', b.id) || b), emails = d.crew.map(c => str(c.email).trim()).filter(Boolean);
    const subject = `Shoot info: ${b.title} — ${fmtShort(b.date)}`;
    const body = `Hi all,\n\nHere is everything for ${b.title} on ${fmtShort(b.date)}${endOf(b) > b.date ? ' to ' + fmtShort(endOf(b)) : ''}: times, the location, who is on and what we are shooting.\n\n${url}\n\nIf plans change I'll send a new link.\n\nThanks,\n${d.producer}`;
    mail.href = `mailto:${emails.join(',')}?` + new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
    import('./qr.js').then(m => m.qrSvg(url, { cellSize: 2 })).then(svg => { if (n === seq) qrBox.innerHTML = svg; }).catch(() => { qrBox.replaceChildren(); });
  };
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { area.select(); toast('Select the link and copy it'); } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: `Shoot info: ${b.title}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const toggles = h('div', { class: 'crew-parts' }, PARTS.map(([k, label]) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked: inc[k], onchange: e => { inc[k] = e.target.checked; remember(inc); make(); } }), h('span', null, label))));
  sheet(`Share with crew · ${b.title}`, h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'A read-only page for your cast and crew: the dates, call times, schedule and location, and whatever you tick below.'),
    h('p', { class: 'small muted' }, 'Prices, rates, budgets, quotes, invoices, kit values and your booking notes are never included. Everything is inside the link itself, so there is no server and nothing is stored online. Anyone who has the link can read it, so send it to your cast and crew only. If plans change, send a new link: an old one keeps showing what it had.'),
    toggles,
    area,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: copy }, '📋 Copy link'), h('button', { class: 'btn ghost', onclick: share }, '📤 Share…'), mail, preview),
    qrBox, h('p', { class: 'small muted', style: 'text-align:center' }, 'Crew can scan this to open it on their phone')));
  make();
}

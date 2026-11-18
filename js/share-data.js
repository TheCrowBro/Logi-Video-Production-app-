// What a shared Vdex link may carry, and nothing else. A link can be made or changed by anyone, so everything read
// from one passes through here first: one allow-list of fields for each kind (the shoot info for the crew, a contact
// card, an equipment list), the right types, and texts and lists cut to a sane length. Used by the public pages
// (crew.html, shared.html) and by the app when a shared thing is added (js/share-add.js). No store, nothing fetched.
import { safeUrl } from './util.js';
import { unpack } from './link-pack.js';

export const QR_MAX = 2800; // a longer link gets no QR code; it still works by copy, share or email
const VERSION = 1, LINK_MAX = 400000, JSON_MAX = 3e6; // characters in a link, bytes once unpacked: far above any honest link

const SAY = {
  none: 'That does not look like a Vdex link. A shared link starts with vdex.crowmade.app and has a long run of letters after a # sign: copy all of it.',
  big: 'This link holds far more than a shared booking, contact or equipment list would, so Vdex has not opened it.',
  damaged: 'This link is incomplete or damaged: part of it may have been cut off when it was copied. Ask for a fresh one.',
  kind: 'This link carries something this version of Vdex does not know. It may come from a newer version: update Vdex and try again.',
  doc: 'This is a quote or invoice link. It opens as a page to read; there is nothing in it to add to Vdex.',
};
const fail = code => Object.assign(new Error(SAY[code]), { code });

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const raw = v => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
// One line of text, and text that may run over several lines: control characters never get through.
const line = (v, max = 200) => raw(v).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, max);
const text = (v, max = 4000) => raw(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const list = (v, max, f) => (Array.isArray(v) ? v.filter(isObj).slice(0, max).map(f) : []);
export const isDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return false; const d = new Date(+m[1], +m[2] - 1, +m[3]); return +m[1] >= 1970 && +m[1] <= 2200 && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3]; };
export const isTime = s => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s || '');
const day = v => (isDate(line(v, 10)) ? line(v, 10) : '');
const time = v => (isTime(line(v, 5)) ? line(v, 5) : '');
const count = v => Math.min(9999, Math.max(1, Math.floor(Number(v)) || 1));
const amount = (v, max) => { if (v === '' || v == null || typeof v === 'boolean') return ''; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= max ? n : ''; };
const when = v => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 4e12 ? Math.floor(n) : 0; };
const head = r => { const v = Math.min(999, Math.max(1, Math.floor(Number(r.v)) || 1)); return { v, newer: v > VERSION, made: when(r.made) }; };
// An address someone may be emailed at, and a website: both end up in links, so anything that could carry more than
// an address (a subject, a second recipient, another scheme) is dropped.
export const mail = v => { const e = line(v, 200); return /^[^\s@?&#<>"'\\,;:%]+@[^\s@?&#<>"'\\,;:%]+\.[^\s@?&#<>"'\\,;:%]+$/.test(e) ? e : ''; };
const site = v => { const u = safeUrl(line(v, 500)); if (!u) return ''; try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes('.') ? x.href : ''; } catch { return ''; } };
// Who a shared thing is from, in one line.
export const fromLine = by => [by && by.name, by && by.business].filter(Boolean).join(' · ');

/* ------------------------------ shoot info for the crew ------------------------------ */
const STRIPS = ['sb-int-day', 'sb-ext-day', 'sb-int-night', 'sb-ext-night']; // strip colours: only these class names are ever used
const person = p => ({ name: line(p.name), role: line(p.role), phone: line(p.phone, 60), email: line(p.email), call: line(p.call, 40) });
function cleanCrew(r) {
  const c = isObj(r.call) ? r.call : {}, l = isObj(r.location) ? r.location : {}, by = isObj(r.by) ? r.by : {};
  const date = day(r.date); if (!date) throw fail('damaged');
  return {
    kind: 'crew', ...head(r), ref: line(r.ref, 80), title: line(r.title), type: line(r.type, 60), date, endDate: day(r.endDate) > date ? day(r.endDate) : '',
    start: time(r.start), end: time(r.end), producer: line(r.producer, 500), client: line(r.client),
    by: { name: line(by.name), business: line(by.business), phone: line(by.phone, 60), email: line(by.email) },
    call: { general: line(c.general, 40), lunch: line(c.lunch, 40), wrap: line(c.wrap, 40), breaks: line(c.breaks, 300), dress: text(c.dress, 1000), weather: text(c.weather, 1000), emergency: text(c.emergency, 500) },
    location: { venue: line(l.venue), address: text(l.address, 600), access: text(l.access, 2000), parking: text(l.parking, 1000), power: text(l.power, 1000), hospital: text(l.hospital, 1000), rules: text(l.rules, 6000) },
    schedule: list(r.schedule, 400, x => ({ date: day(x.date), time: line(x.time, 40), item: line(x.item, 400) })),
    crew: list(r.crew, 400, person), contacts: list(r.contacts, 200, person), onSet: text(r.onSet, 3000),
    scenes: list(r.scenes, 200, d => ({ n: Math.min(999, count(d.n)), date: day(d.date), pages: line(d.pages, 20), items: list(d.items, 400, x => (x.banner != null ? { banner: line(x.banner, 300) }
      : { scene: line(x.scene, 40), ie: line(x.ie, 20), set: line(x.set, 300), tod: line(x.tod, 60), desc: text(x.desc, 2000), cast: Array.isArray(x.cast) ? x.cast.slice(0, 100).map(n => line(n)).filter(Boolean) : [], pages: line(x.pages, 20), kind: STRIPS.includes(x.kind) ? x.kind : 'sb-int-day' })) })),
    shots: list(r.shots, 2000, x => ({ text: line(x.text, 600), done: x.done === true })),
    kit: list(r.kit, 2000, k => ({ name: line(k.name), cat: line(k.cat, 60), qty: count(k.qty) })),
    deliverables: list(r.deliverables, 300, x => ({ name: line(x.name), duration: line(x.duration, 60), due: day(x.due), status: line(x.status, 40) })),
    notes: text(r.notes, 8000),
  };
}

/* ---------------------------------- a contact card ---------------------------------- */
function cleanContact(r) {
  const c = { kind: 'contact', ...head(r), name: line(r.name), title: line(r.title), business: line(r.business), phone: line(r.phone, 60), email: mail(r.email), website: site(r.website), location: line(r.location) };
  if (!(c.name || c.business || c.phone || c.email)) throw fail('damaged');
  return c;
}
// The card as a vCard, for a phone's own contacts: every value escaped, one property a line.
const vc = s => String(s || '').replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
export function vcard(p) {
  const [first = '', ...rest] = (p.name || '').trim().split(/\s+/), url = safeUrl(p.website).replace(/[\u0000-\u0020]+/g, '');
  return [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${vc(rest.join(' '))};${vc(first)};;;`,
    `FN:${vc(p.name)}`,
    p.business && `ORG:${vc(p.business)}`,
    p.title && `TITLE:${vc(p.title)}`,
    p.phone && `TEL;TYPE=CELL:${vc(p.phone)}`,
    p.email && `EMAIL:${vc(p.email)}`,
    url && `URL:${url}`,
    p.location && `ADR;TYPE=WORK:;;${vc(p.location)};;;;`,
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
}

/* -------------------------------- an equipment list -------------------------------- */
// Items carry the fields of an equipment record under their own names, so what comes out of here goes straight into
// the import (js/gear-import.js). A kit names its items by their place in the list.
function cleanGear(r) {
  const by = isObj(r.by) ? r.by : {}, at = new Map(), items = [];
  (Array.isArray(r.items) ? r.items.slice(0, 2000) : []).forEach((x, i) => {
    const name = isObj(x) ? line(x.name) : ''; if (!name) return;
    at.set(i, items.length);
    items.push({ ref: line(x.ref, 80), name, category: line(x.category, 60), serial: line(x.serial, 120), location: line(x.location, 120), qty: count(x.qty), value: amount(x.value, 1e9),
      purchased: day(x.purchased), warranty: day(x.warranty), serviceEvery: amount(x.serviceEvery, 600), firmware: line(x.firmware, 60), notes: text(x.notes, 2000) });
  });
  if (!items.length) throw fail('damaged');
  const kits = list(r.kits, 200, k => ({ ref: line(k.ref, 80), name: line(k.name), description: line(k.description, 300), notes: text(k.notes, 2000),
    items: [...new Map((Array.isArray(k.items) ? k.items.slice(0, 2000) : []).filter(p => Array.isArray(p) && at.has(p[0])).map(p => [at.get(p[0]), count(p[1])]))] })).filter(k => k.name && k.items.length);
  return { kind: 'gear', ...head(r), title: line(r.title), currency: line(r.currency, 4), by: { name: line(by.name), business: line(by.business) }, items, kits };
}

/* ------------------------------------ reading ------------------------------------ */
// The cleaned contents of a parsed link, or an error whose message says what is wrong in plain words (its code:
// 'damaged', 'kind' for something this version does not know, 'doc' for a quote or invoice).
export function cleanShared(r) {
  if (!isObj(r)) throw fail('damaged');
  const kind = raw(r.kind);
  if (kind === 'crew') return cleanCrew(r);
  if (kind === 'contact') return cleanContact(r);
  if (kind === 'gear') return cleanGear(r);
  throw fail(kind === 'quote' || kind === 'invoice' ? 'doc' : kind ? 'kind' : 'damaged');
}
// The packed part of whatever was pasted, scanned or opened: a whole link (crew.html#…, shared.html#…,
// index.html#add=…), a fragment, or the packed text alone. Line breaks an email put into it are taken out.
export function packedOf(link) {
  const t = String(link == null ? '' : link).replace(/\s+/g, '');
  if (t.length > LINK_MAX) throw fail('big');
  const m = /(?:^|#)(?:add=)?([01]\.[A-Za-z0-9_-]+)$/.exec(t);
  if (!m) throw fail('none');
  return m[1];
}
export async function readShared(link) {
  const packed = packedOf(link);
  let data; try { data = await unpack(packed, { max: JSON_MAX }); } catch (e) { throw fail(e && e.code === 'big' ? 'big' : 'damaged'); }
  return cleanShared(data);
}

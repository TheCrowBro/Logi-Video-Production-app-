// Search across everything kept on this device. The control in the top bar opens a panel with one field; what is
// typed is looked for in every booking (with its call sheet, stripboard, quote and invoice), crew member, item of
// equipment, kit, venue, insurance policy and timecode log, and in your own details and settings lists. Results are
// grouped by the page they live on, chips keep them to one page, and choosing a result opens that thing where it lives.
// Nothing leaves the device and nothing about a search is saved: the index is built in memory when the panel opens,
// rebuilt when the data changes, and dropped, with what was typed, when Vdex locks. Searching changes nothing, so it
// works in read-only mode too. Fetched the first time the search is opened.
import { h, toast, announce, fmtShort, fmtLong, parseISO, todayISO } from './util.js';
import * as store from './store.js';
import { typeLabel, hiredPeople, rentalsOf } from './workflow.js';
import { sheetOf, sheetState } from './callsheet.js';
import { boardOf, ieOf } from './board.js';
import { KINDS, methodLabel, billedName } from './money.js';
import { PERMS } from './pages/venues.js';
import { findRole, groupOf } from './roles.js';

/* ---------------------------------- matching ---------------------------------- */
// Text is compared folded: lower case, accents and other marks dropped, curly quotes straightened, and a few letters
// that are not accents but are typed without them (ø, đ, ł, ß, æ, œ). "cafe" finds "Café", "soren" finds "Søren".
const LETTERS = { ø: 'o', đ: 'd', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', ς: 'σ', '‘': "'", '’': "'", '“': '"', '”': '"' };
export const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[øđłßæœıς‘’“”]/g, c => LETTERS[c]);
const WORD = /[\p{L}\p{N}]/u;
// What was typed, as words: all of them must be found, in any order. A word made of digits and phone punctuation is
// also looked for in phone numbers with their spaces and brackets taken out ("5550101" finds "+1 555 0101").
// Punctuation around a word is not part of it ("rivera," or a lone "-" between two words).
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const termsOf = q => [...new Set(fold(q).split(/\s+/).map(t => t.replace(EDGE, '')).filter(Boolean))].slice(0, 8).map(t => { const d = /^[\d().+-]+$/.test(t) ? t.replace(/\D/g, '') : ''; return { t, d: d.length >= 3 ? d : '' }; });
// How well one word matches one field: its weight, raised when the word is the whole field, starts it, or starts a
// word in it. 0 when it is not there.
function fieldScore(f, x) {
  let best = 0;
  for (let at = f.f.indexOf(x.t); at >= 0; at = f.f.indexOf(x.t, at + 1)) {
    const start = at === 0 || !WORD.test(f.f[at - 1]);
    best = Math.max(best, at === 0 ? (f.f.length === x.t.length ? 1.6 : 1.35) : start ? 1.15 : 1);
    if (start) break;
  }
  if (!best && x.d && f.d && f.d.includes(x.d)) best = 1;
  return best * f.w;
}

/* ----------------------------------- the index ----------------------------------- */
// The pages results are grouped by, in the order their chips are shown.
export const GROUPS = [['bookings', 'Bookings'], ['callsheets', 'Call sheets'], ['strips', 'Stripboard'], ['money', 'Money'], ['crew', 'Crew'], ['gear', 'Equipment'], ['venues', 'Venues'], ['insurance', 'Insurance'], ['tcnotes', 'TC Notes'], ['me', 'Me'], ['settings', 'Settings']];
const txt = v => (v == null ? '' : String(v).trim());
const join = (...parts) => parts.map(txt).filter(Boolean).join(' · ');
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const dayText = s => (isDay(s) ? `${fmtLong(s)} · ${s}` : ''); // found by "november", "friday" or the date as stored
const shortDay = s => (isDay(s) ? fmtShort(s) + (s.slice(0, 4) === todayISO().slice(0, 4) ? '' : ' ' + s.slice(0, 4)) : '');
const span = b => (b.endDate && b.endDate > b.date ? `${shortDay(b.date)} → ${shortDay(b.endDate)}` : shortDay(b.date));
const SHEET = { draft: 'Draft', sent: 'Sent', changed: 'Changed since it was sent' };
const PERM = { allowed: 'allowed', ask: 'needs approval', no: 'not allowed' };

// One thing that can be found: the page it is listed under, how to open it (kind, id), the two lines it is listed
// with, and the fields to look in, each [label, text, weight, { shown, at, tel }]. A match in a name or title weighs
// most, a match in notes least. shown: the text is already on the two lines, so it needs no snippet of its own.
// at: where inside the record the field lives, for opening on that spot. tel: a phone number in the text.
function entry(out, group, kind, id, icon, title, meta, fields, when) {
  const fs = [];
  for (const [label, text, w, o = {}] of fields) { const t = txt(text); if (t) fs.push({ label, text: t, f: fold(t), w, shown: !!o.shown, at: o.at || null, d: o.tel ? String(o.tel).replace(/\D/g, '') : '' }); }
  if (!fs.length) return;
  out.push({ group, kind, id, icon, title: txt(title) || 'Untitled', meta: txt(meta), fields: fs, all: fs.map(f => f.f).join('\n'), digits: fs.map(f => f.d).filter(Boolean).join(' '),
    near: isDay(when) ? Math.abs(parseISO(when) - parseISO(todayISO())) : Infinity });
}
const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const ids = v => (Array.isArray(v) ? v : []); // a list of ids (a booking's crew, kits and equipment, a kit's items)
// Goes through a list one record at a time: a record that cannot be read (a hand-edited or foreign backup can hold
// one) is passed over, and everything after it is still indexed.
const each = (rows, fn) => { for (const x of list(rows)) { try { fn(x); } catch (e) { console.error(e); } } };
// A role as the role list knows it (js/roles.js): the group it is filed under and the other names the same job goes
// by, so "cinematographer" or "camera" finds the DOP here as it does in the Crew page's own search box.
const roleFields = role => { const hit = findRole(role), group = groupOf(role); return group ? [['Group', group, 15], ['Also called', hit && [hit.role.name, ...hit.role.aka].filter(n => n !== hit.label).join(', '), 15]] : []; };

function bookingEntries(out, db) {
  const byId = rows => new Map(list(rows).map(x => [x.id, x])), crew = byId(db.crew), gear = byId(db.gear), kits = byId(db.kits), venues = byId(db.venues);
  const notes = new Map(); for (const s of list(db.shifts)) if (s.note && s.bookingId) notes.set(s.bookingId, [...(notes.get(s.bookingId) || []), s.note]);
  each(db.bookings, b => {
    if (!b.id) return;
    const venue = venues.get(b.venueId), people = ids(b.crew).map(id => crew.get(id)).filter(Boolean);
    entry(out, 'bookings', 'booking', b.id, '📅', b.title, join(span(b), b.client, b.status), [
      ['Project', b.title, 100, { shown: true }], ['Client', b.client, 70, { shown: true }], ['Stage', b.status, 40, { shown: true }], ['Job type', b.type && typeLabel(b.type), 35],
      ['Date', join(dayText(b.date), dayText(b.endDate)), 30], ['Address', b.address, 45], ['Venue', venue && venue.name, 30],
      ...list(b.stakeholders).map(s => ['Contact', join(s.name, s.role, s.phone, s.email), 55, { at: 'bk-stakeholders', tel: s.phone }]),
      ...hiredPeople(b).map(p => ['Hired', join(p.name, p.role, p.phone, p.email, p.notes), 45, { at: 'bk-hires', tel: p.phone }]),
      ...rentalsOf(b).map(r => ['Rented', join(r.item, r.from), 45, { at: 'bk-rentals' }]),
      ...list(b.shots).map(s => ['Shot', s.text, 30, { at: 'bk-shots' }]),
      ...list(b.deliverables).map(d => ['Deliverable', join(d.name, d.duration, d.status, d.link), 40, { at: 'bk-deliverables' }]),
      ...list(b.licences).map(l => ['Licence', join(l.kind, l.title, l.licence, l.source), 40, { at: 'bk-licences' }]),
      ...list(b.media).map(m => ['Card', m.label, 30, { at: 'bk-media' }]),
      ...list(b.budget && b.budget.lines).map(l => ['Budget', join(l.desc, l.cat, l.supplier), 30, { at: 'bk-budget' }]),
      ...list(b.extraChecks).map(c => ['Checklist', c.text, 25, { at: 'bk-work' }]),
      ...store.editDaysOf(b).map(d => ['Edit day', join(dayText(d.date), d.start && `${d.start}${d.end ? '–' + d.end : ''}`), 30]),
      ['Break terms', b.breakNote, 20], ...(notes.get(b.id) || []).map(n => ['Hours', n, 15]),
      ...people.map(c => ['Crew', join(c.name, c.role), 15, { at: 'bk-crew' }]),
      ...ids(b.kits).map(id => ['Kit', kits.get(id) && kits.get(id).name, 12, { at: 'bk-kit' }]), ...ids(b.gear).map(id => ['Equipment', gear.get(id) && gear.get(id).name, 12, { at: 'bk-kit' }]),
      ['Notes', b.notes, 20],
    ], b.date);
    // The booking's own documents are things of their own: each is found under its page and opens as itself.
    const about = [['Project', b.title, 60, { shown: true }], ['Client', b.client, 45, { shown: true }]];
    // A quote or an invoice is listed with the name it is headed to. On a booking added from someone's link that is the
    // person who shared it, not the booking's client (billedName in js/money.js); the booking's client is still looked
    // in, so the job's documents are found by either name.
    let to = txt(b.client); if (b.quote || b.invoice) { try { to = txt(billedName(b)); } catch { /* a record that cannot be read that far keeps its client */ } }
    const billed = [['Project', b.title, 60, { shown: true }], ['Client', to, 45, { shown: true }], to !== txt(b.client) && ['Client on the booking', b.client, 30]].filter(Boolean);
    for (const kind of ['quote', 'invoice']) {
      const doc = b[kind]; if (!doc || typeof doc !== 'object') continue;
      entry(out, 'money', kind, b.id, kind === 'quote' ? '🧾' : '💰', `${KINDS[kind].label} ${txt(doc.number)}`, join(b.title, to, doc.status, shortDay(doc.date)), [
        ['Number', `${KINDS[kind].label} ${txt(doc.number)}`, 100, { shown: true }], ...billed, ['Status', doc.status, 40, { shown: true }], ['Date', join(dayText(doc.date), dayText(doc.due), dayText(doc.until)), 25],
        ...list(doc.lines).map(l => ['Line', l.desc, 40]), ...list(doc.payments).map(p => ['Payment', join(methodLabel(p.method), p.note, dayText(p.date)), 25]), ['Notes', doc.notes, 20],
      ], doc.date || b.date);
    }
    if (b.callSheet && typeof b.callSheet === 'object') {
      const cs = sheetOf(b), own = [...cs.schedule.map(r => ['Schedule', [r.time, r.item].map(txt).filter(Boolean).join(' '), 45]), ['On set', cs.attendees, 35], ['Instructions', cs.notes, 35],
        ['Emergency contact', cs.emergency, 35, { tel: cs.emergency }], ['Dress code / bring', cs.dress, 25], ['Lunch', cs.lunch, 20], ['Weather', cs.weather, 20]].filter(f => txt(f[1]));
      if (own.length) entry(out, 'callsheets', 'callsheet', b.id, '📋', b.title, join('Call sheet', span(b), SHEET[sheetState(b)]), [...about, ...own], b.date);
    }
    if (b.board && Array.isArray(b.board.list)) {
      const bd = boardOf(b), scenes = bd.list.filter(x => x.type === 'scene');
      const own = [...scenes.map(x => ['Scene', join(x.scene && 'Scene ' + x.scene, [ieOf(x), x.set].filter(Boolean).join(' '), x.tod, x.desc, x.cast.join(', '), x.notes), 40, { at: x.id }]),
        ...bd.list.filter(x => x.type === 'banner').map(x => ['Banner', x.text, 25, { at: x.id }]), ['Cast', bd.cast.join(', '), 30]].filter(f => txt(f[1]));
      if (own.length) entry(out, 'strips', 'strips', b.id, '🎬', b.title, join('Stripboard', `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`, span(b)), [...about, ...own], b.date);
    }
  });
}

function listEntries(out, db) {
  const kitsOf = new Map(); for (const k of list(db.kits)) for (const id of ids(k.gear)) kitsOf.set(id, [...(kitsOf.get(id) || []), k.name]);
  each(db.crew, c => entry(out, 'crew', 'crew', c.id, '👥', c.name, join(c.role, c.phone, c.email), [
    ['Name', c.name, 100, { shown: true }], ['Role', c.role, 60, { shown: true }], ['Phone', c.phone, 50, { shown: true, tel: c.phone }], ['Email', c.email, 50, { shown: true }], ['Link to their work', c.link, 30], ['Notes', c.notes, 20],
    ...roleFields(c.role)]));
  each(db.gear, g => entry(out, 'gear', 'gear', g.id, '🎥', g.name, join(g.category, g.serial && 'S/N ' + g.serial, g.location && '📍 ' + g.location), [
    ['Item', g.name, 100, { shown: true }], ['Serial number', g.serial, 80, { shown: true }], ['Category', g.category, 40, { shown: true }], ['Where it is', g.location, 45, { shown: true }], ['Firmware', g.firmware, 25],
    ...list(g.log).map(e => ['Service log', join(e.note, shortDay(e.date)), 20, { at: 'service' }]), ...(kitsOf.get(g.id) || []).map(n => ['Kit', n, 12]), ['Notes', g.notes, 20]]));
  const gear = new Map(list(db.gear).map(g => [g.id, g]));
  each(db.kits, k => entry(out, 'gear', 'kit', k.id, '🧰', k.name, join('Kit', k.description, `${ids(k.gear).length} item${ids(k.gear).length === 1 ? '' : 's'}`), [
    ['Kit', k.name, 100, { shown: true }], ['Type of shoot', k.description, 50, { shown: true }], ...ids(k.gear).map(id => ['In this kit', gear.get(id) && gear.get(id).name, 25]), ['Notes', k.notes, 20]]));
  each(db.venues, v => entry(out, 'venues', 'venue', v.id, '📍', v.name, join(v.type, txt(v.address).replace(/\s*\n\s*/g, ', ')), [
    ['Venue', v.name, 100, { shown: true }], ['Type', v.type, 40, { shown: true }], ['Address', txt(v.address).replace(/\s*\n\s*/g, ', '), 60, { shown: true }], ['Contact', join(v.contact, v.phone, v.email), 50, { tel: v.phone }],
    ['Rules', v.rules, 30], ...PERMS.filter(([k]) => v.perms && PERM[v.perms[k]]).map(([k, l]) => ['Equipment rules', `${l}: ${PERM[v.perms[k]]}`, 20]),
    ['Permit', join(v.permit !== 'Unknown' && v.permit, v.permitNotes), 30], ['Access', v.access, 30], ['Parking', v.parking, 30], ['Power', v.power, 25], ['Hospital', v.hospital, 25], ['Notes', v.notes, 20]]));
  each(db.insurance, p => entry(out, 'insurance', 'policy', p.id, '🛡️', p.type || 'Policy', join(p.provider, p.policy && '#' + p.policy, isDay(p.renewal) && 'renews ' + shortDay(p.renewal)), [
    ['Type of cover', p.type, 90, { shown: true }], ['Provider', p.provider, 80, { shown: true }], ['Policy number', p.policy, 80, { shown: true }], ['Provider phone', p.phone, 40, { tel: p.phone }], ['Claims line', p.claims, 40, { tel: p.claims }],
    ['Renewal', dayText(p.renewal), 25], ['Link to policy document', p.link, 20], ['Notes', p.notes, 25]]));
  const titles = new Map(list(db.bookings).map(b => [b.id, b.title]));
  each(db.logs, l => {
    const sc = l.script && Array.isArray(l.script.paras) ? l.script : null;
    entry(out, 'tcnotes', 'log', l.id, '⏱️', l.title, join(l.camera, titles.get(l.bookingId), `${list(l.notes).length} note${list(l.notes).length === 1 ? '' : 's'}`, sc && 'script'), [
      ['Log', l.title, 100, { shown: true }], ['Camera / card', l.camera, 50, { shown: true }], ['Booking', titles.get(l.bookingId), 30, { shown: true }],
      ...list(l.notes).flatMap(n => [['Note', n.text, 35, { at: { note: n.id } }], ['Marked line', n.quote, 15, { at: { note: n.id } }]]),
      ['Script', sc && sc.name, 30], ...(sc ? list(sc.paras).map(p => ['Script', p.text, 12, { at: { para: p.id } }]) : [])], l.created);
  });
}

function ownEntries(out, db) {
  // One thing each (your details, each template, the checklists, the price list, the billing texts), kept apart like
  // the records above: an odd one costs only itself.
  each([db.profile || {}], p => entry(out, 'me', 'me', 'me', '🪪', 'Your details', join(p.name, p.business), [['Name', p.name, 70, { shown: true }], ['Business', p.business, 70, { shown: true }], ['Title', p.title, 40], ['Phone', p.phone, 40, { tel: p.phone }],
    ['Email', p.email, 40], ['Website', p.website, 40], ['Location', p.location, 40], ['About', p.bio, 20]]));
  each(db.projectTemplates, t => {
    if (!t.id) return;
    entry(out, 'settings', 'template', t.id, '📐', t.name, 'Project template', [['Template', t.name, 80, { shown: true }], ...list(t.deliverables).map(d => ['Deliverable', join(d.name, d.duration), 30]),
      ...txt(t.shots).split('\n').map(s => ['Shot', s, 25]), ...list(t.schedule).map(r => ['Schedule', [r.time, r.item].map(txt).filter(Boolean).join(' '), 25]), ['Instructions', t.instructions, 20], ['Notes', t.notes, 20]]);
  });
  each([db.templates || {}], all => {
    const custom = Object.entries(all).filter(([, v]) => v && typeof v === 'object').flatMap(([type, stages]) => Object.entries(stages).filter(([, lines]) => Array.isArray(lines)).flatMap(([stage, lines]) => lines.map(t => [stage, t, 25, { at: { type, stage, line: txt(t) } }])));
    entry(out, 'settings', 'checklists', 'checklists', '✅', 'Workflow templates', 'Your checklist lines for each stage', custom);
  });
  each([db.priceList || {}], pl => entry(out, 'settings', 'pricelist', 'pricelist', '🏷️', 'Price list', 'The lines you pick into quotes and invoices', list(pl.list).map(l => [txt(l.cat) || 'Line', l.desc, 30, { at: l.id && { line: String(l.id) } }])));
  each([db.billing || {}], bl => entry(out, 'settings', 'billing', 'billing', '🧾', 'Quotes & invoices', 'Payment terms and how to pay', [['Payment terms', bl.terms, 30], ['How to pay', bl.payment, 30], ['Account name', bl.accountName, 30], ['Pay link', join(bl.payLinkLabel, bl.payLink), 20]]));
}

let index = null; // { rev, entries, groups: the pages that have something }
export function buildIndex() {
  const db = store.db, entries = [];
  for (const part of [bookingEntries, listEntries, ownEntries]) { try { part(entries, db); } catch (e) { console.error(e); } } // each record is guarded by itself (each()); this is for whatever a part does before its records
  index = { rev: store.revision(), entries, groups: GROUPS.filter(([id]) => entries.some(e => e.group === id)).map(([id]) => id) };
  return index;
}
const fresh = () => (index && index.rev === store.revision() ? index : buildIndex());

// Everything that has all the words, best first: by the score, then (bookings and their documents) by how near the
// date is, then by name. Returns the matches and, for each, which field answered each word.
export function find(query) {
  const terms = termsOf(query), ix = fresh(), out = [];
  if (!terms.length) return { terms, results: out };
  for (const e of ix.entries) {
    if (!terms.every(x => e.all.includes(x.t) || (x.d && e.digits.includes(x.d)))) continue;
    let score = 0, hit = null; const used = [];
    for (const x of terms) {
      let best = 0, bf = null;
      for (const f of e.fields) { const s = fieldScore(f, x); if (s > best) { best = s; bf = f; } }
      score += best; if (bf && !used.includes(bf)) used.push(bf); if (bf && bf.at && !hit) hit = bf;
    }
    out.push({ e, score, used, at: hit ? hit.at : null });
  }
  out.sort((a, b) => b.score - a.score || a.e.near - b.e.near || a.e.title.localeCompare(b.e.title));
  return { terms, results: out };
}
// For other features and the tests: what a search finds, as plain records.
export const search = (query, group = '') => find(query).results.filter(r => !group || r.e.group === group).map(r => ({ group: r.e.group, kind: r.e.kind, id: r.e.id, title: r.e.title, meta: r.e.meta, score: r.score, at: r.at }));

/* ------------------------------ opening what was found ------------------------------ */
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { for (const end = Date.now() + ms; ;) { const v = fn(); if (v || Date.now() > end) return v; await tick(40); } };
// Goes to a section and resolves once it is drawn. When it is the one already open, it is drawn again: what it shows
// (which venue, which filter) has just been changed.
async function land(tab, prepare) {
  const here = window.logiPage() === tab;
  if (prepare) prepare();
  await window.logiGo(tab);
  if (here) store.redraw();
  await tick();
}
// Scrolls to something, clear of the Rolodex bar, and keeps that bar on screen: the jump is Vdex's own, not the person
// scrolling down, and the bar is the way on from here (the sections, and the magnifier back to the results).
const jump = (el, block) => { const nav = document.getElementById('rolodex'); el.style.scrollMarginTop = `${(nav ? nav.getBoundingClientRect().height : 0) + 12}px`; el.scrollIntoView({ block }); window.logiShowNav?.(true); };
const toPage = () => document.getElementById('page')?.focus({ preventScroll: true });
// Shows one card or box among others: scrolled to, outlined for a moment, and given the focus so a keyboard or a
// screen reader carries on from it.
function spot(el, block = 'center') {
  if (!el) return false;
  for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
  jump(el, block);
  for (const was of document.querySelectorAll('.found')) if (was !== el) was.classList.remove('found'); // one thing outlined at a time
  el.classList.add('found'); setTimeout(() => el.classList.remove('found'), 2600);
  if (!el.matches('a[href], button, input, [tabindex]')) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return true;
}
const card = id => document.querySelector(`#page [data-id="${CSS.escape(id)}"]`);
async function booking(id, patch, at) {
  await window.logiGo('bookings');
  const m = await import('./pages/bookings.js');
  if (!m.openBooking(id, patch)) return false;
  toPage();
  if (typeof at === 'string' && patch.view === 'strips') spot(await until(() => document.querySelector(`.sb-page [data-id="${CSS.escape(at)}"]`)));
  else if (typeof at === 'string') spot(document.getElementById(at), 'start');
  return true;
}
// Settings: the section is opened, and then the thing itself is shown in it where it can be told apart (a template's
// card, the box holding a checklist line). A handler that could only open the section answers with the section's
// name, so that is what gets announced, not the name of something that is not on screen.
const settings = async title => (await import('./pages/settings.js')).openSettingsSection(title);
const OPEN = {
  booking: (id, at) => booking(id, {}, at),
  quote: id => booking(id, { view: 'money', kind: 'quote' }),
  invoice: id => booking(id, { view: 'money', kind: 'invoice' }),
  callsheet: id => booking(id, { view: 'callsheet' }),
  strips: (id, at) => booking(id, { view: 'strips' }, at),
  crew: async id => { const m = await import('./pages/crew.js'); await land('crew', m.showAll); return spot(card(id)); },
  gear: async (id, at) => { const m = await import('./pages/gear.js'); await land('gear', () => m.showAll('items')); const ok = spot(card(id)); if (ok && at === 'service') m.serviceSheet(store.byId('gear', id)); return ok; },
  kit: async id => { const m = await import('./pages/gear.js'); await land('gear', () => m.showAll('kits')); return spot(card(id)); },
  venue: async id => { if (!store.byId('venues', id)) return false; const m = await import('./pages/venues.js'); await land('venues', () => m.openVenue(id)); window.scrollTo({ top: 0 }); toPage(); return true; },
  policy: async id => { await land('insurance'); return spot(card(id)); },
  log: async (id, at) => {
    const m = await import('./pages/tcnotes.js');
    if (!(await m.openLog(id, at && at.para ? 'script' : 'notes'))) return false;
    await tick(); toPage();
    if (at && at.note) spot(card(at.note));
    if (at && at.para) { const el = document.getElementById('sc-' + at.para); if (el) { jump(el, 'center'); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); } }
    return true;
  },
  me: async () => { await land('me'); window.scrollTo({ top: 0 }); toPage(); return true; },
  template: async id => { if (!(await settings('Project templates'))) return false; return spot((await import('./pages/settings.js')).templateCard(id)) || 'Project templates'; },
  checklists: async (id, at) => {
    if (!(await settings('Workflow templates'))) return false;
    // The box of that job type and stage (js/workflow.js names each "<type>: <stage> checklist", a type of your own with "(yours)").
    const name = at && at.line ? typeLabel(at.type) : '', plain = `${name}: ${at && at.stage} checklist`, own = ` ${name} (yours): ${at && at.stage} checklist`;
    const box = name && [...document.querySelectorAll('#page details[data-s="Workflow templates"] textarea')].find(t => { const a = t.getAttribute('aria-label') || ''; return (a === plain || a.endsWith(own)) && t.value.split('\n').some(l => l.trim() === at.line); });
    if (box) spot(box.closest('.field') || box);
    return true;
  },
  billing: () => settings('Quotes & invoices'),
  pricelist: async (id, at) => {
    (await import('./price-list.js')).openPriceList();
    if (at && at.line) spot(document.querySelector(`.sheet .price-list [data-id="${CSS.escape(at.line)}"]`)); // its group is unfolded and the line scrolled to
    return true;
  },
};
// What a handler answered: false when the thing is no longer there, otherwise true, or the name of what was opened
// when that is not the thing asked for.
async function reach(kind, id, at) {
  closeSearch();
  try { const got = await OPEN[kind](id, at); return got === undefined ? true : got; } catch (e) { console.error(e); return false; }
}
// Opens a record where it lives: openRecord('booking', id), 'quote' | 'invoice' | 'callsheet' | 'strips' (a booking's
// id), 'crew', 'gear', 'kit', 'venue', 'policy', 'log', 'me'. Resolves false when it is no longer there.
export const openRecord = async (kind, id, at = null) => (await reach(kind, id, at)) !== false;

/* ----------------------------------- the panel ----------------------------------- */
const PER_GROUP = 5, PAGE = 60; // with every page shown, the best few of each; with one page chosen, a screenful at a time
const btn = document.getElementById('searchBtn'), app = document.getElementById('app');
let back = null, panel, input, chips, status, listbox, blank; // built the first time the panel opens
let open = false, shown = false, wasInert = false, unsub = null, timer = 0, said = 0;
let filter = '', limit = PAGE, options = [], active = -1, last = null;
let opener = null; // what had the focus when the panel opened: it gets the focus back (the box someone was typing in, the magnifier that was tapped)
let place = null;  // where the list stood when the panel closed: its words, chip, length and scroll, for coming back to the same results
export const isOpen = () => open;
// Ctrl+K, or ⌘K on Apple devices, where Control+K in a text box is the system's own "delete to the end of the line"
// and is left to it. The same rule as the listener in js/app.js that opens the panel.
const APPLE = /Mac|iPhone|iPad/.test(navigator.platform || '');
const isK = e => (APPLE ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && (e.key || '').toLowerCase() === 'k';
// A phone or a tablet in the hand: its keyboard covers the results, and its Search key is not a way to move among them.
const byTouch = () => !!window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;

// The text as nodes, each place a word matched inside a <mark>. Built from text nodes, so nothing typed or stored is
// ever read as HTML. The folded text is made letter by letter here, to know where each folded letter came from.
function ranges(text, terms) {
  let folded = ''; const from = [];
  for (let i = 0; i < text.length; i++) { const f = fold(text[i]); for (let k = 0; k < f.length; k++) from.push(i); folded += f; }
  const out = [], add = (a, len) => { let end = from[a + len - 1] + 1; while (/[\u0300-\u036f]/.test(text[end] || '')) end++; out.push([from[a], end]); };
  for (const x of terms) {
    for (let at = folded.indexOf(x.t); at >= 0; at = folded.indexOf(x.t, at + x.t.length)) add(at, x.t.length);
    if (x.d) for (const m of folded.matchAll(new RegExp(x.d.split('').join('[\\s().-]*'), 'g'))) add(m.index, m[0].length); // a phone number typed without its spaces
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.reduce((all, r) => { const prev = all[all.length - 1]; if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]); else all.push(r); return all; }, []);
}
function marked(text, terms, excerpt = false) {
  text = String(text).replace(/\s+/g, ' ');
  let rs = ranges(text, terms), lead = '', tail = '';
  if (excerpt && text.length > 120) { // a long text: the part around the first match
    let a = Math.max(0, (rs[0] ? rs[0][0] : 0) - 36); if (a > 0) { const sp = text.indexOf(' ', a); if (sp >= 0 && sp < a + 14) a = sp + 1; }
    const b = Math.min(text.length, a + 120);
    rs = rs.filter(r => r[0] < b && r[1] > a).map(r => [Math.max(r[0], a) - a, Math.min(r[1], b) - a]);
    lead = a > 0 ? '… ' : ''; tail = b < text.length ? ' …' : ''; text = text.slice(a, b);
  }
  const out = []; let at = 0;
  for (const [a, b] of rs) { if (a > at) out.push(text.slice(at, a)); out.push(h('mark', null, text.slice(a, b))); at = b; }
  out.push(text.slice(at));
  return [lead, ...out, tail];
}

function build() {
  const glass = btn.querySelector('svg').cloneNode(true); glass.setAttribute('class', 'search-glass');
  input = h('input', { id: 'searchInput', type: 'search', role: 'combobox', placeholder: 'Search everything…', 'aria-label': 'Search everything in Vdex', 'aria-controls': 'searchList', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-describedby': 'searchStatus', autocomplete: 'off', enterKeyHint: 'search' });
  input.setAttribute('autocapitalize', 'none'); input.setAttribute('autocorrect', 'off'); input.setAttribute('spellcheck', 'false');
  chips = h('div', { class: 'chips search-chips', role: 'group', 'aria-label': 'Show results from' });
  status = h('p', { id: 'searchStatus', class: 'search-status muted small' });
  listbox = h('div', { id: 'searchList', class: 'search-list', role: 'listbox', 'aria-label': 'Search results', hidden: true });
  blank = h('div', { class: 'search-blank' });
  panel = h('div', { id: 'search', class: 'search-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
    h('div', { class: 'search-head' }, glass, input, h('button', { id: 'searchClose', class: 'icon-btn', type: 'button', 'aria-label': 'Close search', onclick: () => closeSearch() }, '✕')),
    chips, status, listbox, blank);
  back = h('div', { id: 'searchBack', class: 'search-back', hidden: true }, panel);
  document.body.append(back);
  btn.setAttribute('aria-controls', 'search');
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); }); // typing is not searched letter by letter
  // A tap on the dimmed page closes it (on the whole tap, as the menu does). Choosing a result is a tap or a click on
  // it; the field keeps the focus meanwhile, except on a touch screen, where touching the results puts the keyboard
  // away so they can be seen.
  let downOnBack = false;
  back.addEventListener('pointerdown', e => { downOnBack = e.target === back; });
  back.addEventListener('click', e => { if (e.target === back && downOnBack) closeSearch(); });
  listbox.addEventListener('mousedown', e => e.preventDefault());
  listbox.addEventListener('touchstart', () => input.blur(), { passive: true });
  listbox.addEventListener('click', e => { const o = e.target.closest('[role=option]'); if (o) choose(Number(o.dataset.i)); });
  // The page behind does not scroll under the panel: only the results and the row of chips move.
  for (const type of ['wheel', 'touchmove']) back.addEventListener(type, e => { if (e.ctrlKey || (e.touches && e.touches.length > 1)) return; if (!e.target.closest || !e.target.closest('.search-list, .search-chips, .search-blank')) e.preventDefault(); }, { passive: false });
}

// The chips: All, then each page that has something to search. Made again only when that set changes, so a chip
// keeps the focus while its count changes.
function drawChips(counts, total, searching) {
  const ids = ['', ...fresh().groups], have = [...chips.children].map(c => c.dataset.group);
  if (ids.join() !== have.join()) chips.replaceChildren(...ids.map(id => h('button', { class: 'chip', type: 'button', 'data-group': id, onclick: () => { setFilter(id); } }, h('span', null, id ? GROUPS.find(g => g[0] === id)[1] : 'All'), h('span', { class: 'chip-n' }))));
  if (!ids.includes(filter)) filter = '';
  for (const c of chips.children) {
    const id = c.dataset.group, n = id ? counts[id] || 0 : total, on = id === filter, name = c.firstChild.textContent;
    c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); c.classList.toggle('none', searching && !n);
    c.lastChild.textContent = searching ? String(n) : ''; c.setAttribute('aria-label', searching ? `${name}, ${n} result${n === 1 ? '' : 's'}` : name);
  }
  chips.hidden = ids.length < 2;
}
function setFilter(id) { filter = id; limit = PAGE; run(); const c = chips.querySelector(`[data-group="${id}"]`); if (c && document.activeElement !== input) c.focus(); if (c) c.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const label = id => GROUPS.find(g => g[0] === id)[1];
function option(r, terms) {
  const i = options.length; options.push(r);
  const snippets = r.used.filter(f => !f.shown).slice(0, 2);
  const body = h('span', { class: 'sr-body' }, h('span', { class: 'sr-title' }, marked(r.e.title, terms)), r.e.meta && h('span', { class: 'sr-meta' }, marked(r.e.meta, terms)),
    snippets.map(f => h('span', { class: 'sr-snip' }, h('span', { class: 'sr-label' }, f.label + ': '), marked(f.text, terms, true))));
  // Read out line by line: the name, the second line, then where the words were found.
  return h('div', { class: 'sr', role: 'option', id: 'sr-' + i, 'aria-selected': 'false', 'aria-label': [...body.children].map(c => c.textContent).join('. '), 'data-i': i, 'data-kind': r.e.kind }, h('span', { class: 'sr-ico', 'aria-hidden': 'true' }, r.e.icon), body);
}
const more = (text, act) => { const i = options.length; options.push({ more: act }); return h('div', { class: 'sr sr-more', role: 'option', id: 'sr-' + i, 'aria-selected': 'false', 'data-i': i }, text); };

// Runs the search for what is in the field and draws the answer: the chips with their counts, then either the results
// in their groups, or a few words (nothing typed yet, nothing to search, nothing found).
function run() {
  clearTimeout(timer);
  const q = input.value, { terms, results } = find(q), ix = fresh(), searching = terms.length > 0;
  const counts = {}; for (const r of results) counts[r.e.group] = (counts[r.e.group] || 0) + 1;
  drawChips(counts, results.length, searching);
  const mine = filter ? results.filter(r => r.e.group === filter) : results;
  options = []; active = -1; input.removeAttribute('aria-activedescendant');
  const kids = [];
  if (mine.length) {
    const order = [...new Set(mine.map(r => r.e.group))]; // already best first, so the page with the best match leads
    for (const g of order) {
      const all = mine.filter(r => r.e.group === g), some = filter ? all.slice(0, limit) : all.slice(0, PER_GROUP);
      kids.push(h('div', { class: 'sr-group', role: 'group', 'aria-label': `${label(g)}, ${plural(all.length, 'result')}`, 'data-group': g },
        h('div', { class: 'sr-head', 'aria-hidden': 'true' }, h('span', null, label(g)), h('span', { class: 'sr-count' }, String(all.length))),
        some.map(r => option(r, terms)),
        all.length > some.length && (filter ? more(`Show more (${all.length - some.length} more)`, () => { const y = listbox.scrollTop; limit += PAGE; run(); listbox.scrollTop = y; }) : more(`Show all ${all.length} in ${label(g)}`, () => setFilter(g)))));
    }
  }
  listbox.replaceChildren(...kids); listbox.hidden = !mine.length; listbox.scrollTop = 0;
  input.setAttribute('aria-expanded', String(mine.length > 0));
  const words = q.trim();
  let line = '', say = '';
  if (!ix.entries.length) blank.replaceChildren(h('h3', null, 'Nothing to search yet'), h('p', null, 'Add a booking, a crew member or some equipment, and it can be found here.'));
  else if (!searching) blank.replaceChildren(h('h3', null, 'Search everything in Vdex'),
    h('p', null, 'Type a name, a place, a serial number, a quote or invoice number, or a word from your notes. Bookings, crew, equipment, venues, insurance, quotes and invoices, call sheets and timecode notes are all looked through.'),
    h('p', null, 'Several words narrow it down: every one of them must be there, in any order. Capitals and accents do not matter.'),
    h('p', { class: 'muted small' }, 'Searching happens on this device. Nothing you type is sent anywhere, and nothing about it is saved.'),
    h('p', { class: 'muted small search-keys' }, '↑ ↓ move through the results · Enter opens one · Esc closes'));
  else if (!mine.length) {
    const elsewhere = results.length;
    say = filter && elsewhere ? `Nothing in ${label(filter)} for “${words}”` : `Nothing found for “${words}”`;
    blank.replaceChildren(h('h3', null, say), filter && elsewhere
      ? h('div', { class: 'stack' }, h('p', null, `${plural(elsewhere, 'result')} on other pages.`), h('button', { class: 'btn ghost', type: 'button', onclick: () => setFilter('') }, `Show all ${plural(elsewhere, 'result')}`))
      : h('p', null, 'Check the spelling, or try fewer words: every word typed has to be found in the same booking, person or item.'));
  } else {
    const pages = Object.keys(counts);
    line = filter ? `${plural(mine.length, 'result')} in ${label(filter)}` : `${plural(results.length, 'result')}${pages.length > 1 ? ` on ${pages.length} pages` : ' in ' + label(pages[0])}`;
    say = filter ? line : `${plural(results.length, 'result')}: ${GROUPS.filter(g => counts[g[0]]).map(g => `${g[1]} ${counts[g[0]]}`).join(', ')}`;
  }
  blank.hidden = mine.length > 0; status.textContent = line;
  last = { q, filter };
  const turn = ++said; // said once typing has paused, not at every letter
  if (say && !shown) setTimeout(() => { if (turn === said && open) announce(say); }, 500);
}

function setActive(i) {
  const was = document.getElementById('sr-' + active); if (was) was.setAttribute('aria-selected', 'false');
  active = i;
  const el = document.getElementById('sr-' + i);
  if (!el) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
  el.setAttribute('aria-selected', 'true'); input.setAttribute('aria-activedescendant', el.id);
  if (i === 0) listbox.scrollTop = 0; else el.scrollIntoView({ block: 'nearest' });
}
async function choose(i) {
  const r = options[i]; if (!r) return;
  if (r.more) return r.more(); // the focus stays where it is: in the field, or nowhere on a touch screen, where the keyboard is away
  const got = await reach(r.e.kind, r.e.id, r.at);
  if (got === false) toast('That could not be opened. It may have been removed.'); else announce(`${typeof got === 'string' ? got : r.e.title} opened`);
}

// The keyboard, taken before the page sees it (the Rolodex behind turns on the arrow keys): the arrows move through
// the results, Enter opens the one marked (or marks the first), Escape closes, and Tab stays inside the panel. On a
// touch screen Enter is the on-screen keyboard's Search key: with nothing marked it puts the keyboard away, so the
// results can be seen and one of them tapped.
const keys = e => {
  const key = e.key || '';
  if (e.isComposing) return; // a word still being put together on the keyboard keeps its keys
  if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); return closeSearch(); }
  if (isK(e)) { e.preventDefault(); e.stopPropagation(); input.focus(); input.select(); return; }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    if (document.activeElement !== input) input.focus();
    if (options.length) setActive(key === 'ArrowDown' ? Math.min(options.length - 1, active + 1) : active - 1);
    return;
  }
  if (key.startsWith('Arrow')) return e.stopPropagation();
  if (key === 'Enter' && e.target === input) { e.preventDefault(); if (active >= 0) choose(active); else if (byTouch()) input.blur(); else if (options.length) setActive(0); return; }
  if (key !== 'Tab') return;
  const items = [...panel.querySelectorAll('input, button:not([disabled])')].filter(el => el.offsetParent !== null), at = items.indexOf(document.activeElement);
  if (at >= 0 && at !== (e.shiftKey ? 0 : items.length - 1)) return; // inside the panel the browser's own Tab does it
  e.preventDefault(); items[e.shiftKey ? items.length - 1 : 0].focus();
};
const onData = () => { if (open && (!index || index.rev !== store.revision())) { clearTimeout(timer); timer = setTimeout(run, 150); } }; // something changed underneath: search again

// Opens the panel with the field ready to type in. What was last typed in this sitting is still there, selected, so
// typing replaces it, and with the same words the list is as it was left: the same chip, as many results, scrolled to
// the same place. show: a walkthrough is pointing at the panel, so it is there to look at and not to use; query: the
// words it shows (a walkthrough step may change them while the panel stays open).
export function openSearch({ show = false, query = null } = {}) {
  if (open) {
    if (shown !== show) closeSearch();
    else { if (!show) input.focus(); else if (query != null && query !== input.value) { input.value = query; filter = ''; limit = PAGE; run(); } return; }
  }
  if (app && app.inert && !show) return; // the page is out of reach (a sheet, the menu, a walkthrough, the lock): so is the search
  if (!back) build();
  const had = document.activeElement;
  opener = !show && had && had !== document.body ? had : null;
  open = true; shown = show;
  if (query != null) input.value = query;
  back.classList.toggle('shown', show); back.inert = show;
  back.hidden = false;
  btn.setAttribute('aria-expanded', 'true'); document.body.classList.add('search-open');
  wasInert = !!(app && app.inert); if (app) app.inert = true; // the page behind is out of reach, as under a sheet
  if (last && (last.q !== input.value)) filter = '';
  const again = !show && place && place.q === input.value && place.filter === filter ? place : null;
  limit = again ? again.limit : PAGE; run();
  if (again) listbox.scrollTop = again.top;
  if (show) return;
  unsub = store.subscribe(onData);
  document.addEventListener('keydown', keys, true);
  input.focus({ preventScroll: true }); input.select();
}

// Closes at once; the focus goes back to where it was when the panel opened (the box someone was typing in, the
// magnifier they tapped), or to the search button in the top bar when that is gone. forget: Vdex is locking, so what
// was typed, what was found and the index all go.
export function closeSearch(forget = false) {
  if (open) {
    open = false; clearTimeout(timer); said++;
    place = shown || !last ? null : { q: last.q, filter: last.filter, limit, top: listbox.scrollTop }; // read while the list is still laid out
    back.hidden = true; back.inert = false; back.classList.remove('shown');
    btn.setAttribute('aria-expanded', 'false'); document.body.classList.remove('search-open');
    document.removeEventListener('keydown', keys, true);
    if (unsub) { unsub(); unsub = null; }
    if (app) app.inert = wasInert;
    if (!shown) { const to = opener && opener.isConnected ? opener : btn; to.focus({ preventScroll: true }); if (document.activeElement !== to) btn.focus({ preventScroll: true }); }
    if (shown) { input.value = ''; filter = ''; }
    opener = null;
  }
  if (forget) { index = null; last = null; place = null; filter = ''; options = []; active = -1; if (back) { input.value = ''; input.removeAttribute('aria-activedescendant'); listbox.replaceChildren(); chips.replaceChildren(); blank.replaceChildren(); status.textContent = ''; } }
}

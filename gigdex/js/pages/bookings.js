// Bookings: the heart of Gigdex. Three views kept in module state (S): the month calendar with "Coming up" under it,
// one day, and a booking's own page (its header, then one fold-down box per block from js/blocks/index.js).
// Adapted from Vdex's bookings page: the month grid, the day list, press and hold to delete, duplicate.
import { h, nodes, ymd, todayISO, parseISO, fmtLong, fmtShort, daysUntil, toast, announce, sheet, empty, backBtn, hold, wasHeld, telUrl } from '../util.js';
import { db, byId, upsert, patch, remove, bookingsOn, upcoming, covers, lastDay } from '../store.js';
import * as model from '../model.js';
import { openForm } from '../form.js';
import { mapButtons } from '../map.js';
import { saveFile, fileName } from '../print.js';
import { sheetTutorial } from '../tour.js';
import { haptic } from '../a11y.js';
import { blocksFor } from '../blocks/index.js';
import { bookingIcs, allIcs, runOfDay } from '../ics.js';
import { openAct } from './acts.js';
import { venueChecks, openVenue } from './venues.js';

/* ------------------------------- words ------------------------------- */
const NOUN = { show: 'show', session: 'studio session', rehearsal: 'rehearsal', other: 'diary entry' };
const KIND_CHIP = { show: 'Shows', session: 'Sessions', rehearsal: 'Rehearsals', other: 'Other' };
const KIND_HELP = {
  show: 'A gig: load-in, set times, the deal, guest list and settlement.',
  session: 'Studio time: the rate, the songs, takes and what to deliver.',
  rehearsal: 'Band practice: the room, the times and the setlist.',
  other: 'Anything else in the diary: a radio slot, a shoot, a meeting.',
};
const STATUS_HELP = {
  hold: 'Date pencilled in, not confirmed yet.', offer: 'An offer to answer.', confirmed: 'Agreed and booked.',
  advanced: 'Details confirmed with the promoter.', done: 'It happened.', settled: 'Paid or settled up.',
  cancelled: 'Off. Stays in your records, out of clashes and money.',
};
const CONTACT_ROLES = ['Promoter', 'Booking agent', 'Venue manager', 'Production manager', 'Studio manager', 'Engineer', 'Producer', 'Client', 'Manager', 'Festival booker'];

/* ------------------------------- helpers ------------------------------- */
const isoOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const monthStart = iso => { const d = isoOk(iso) ? parseISO(iso) : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const safeColor = c => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c || '') ? c : '');
const actOf = b => (b && b.actId ? byId('acts', b.actId) : null);
const actStyle = b => { const c = safeColor(actOf(b) && actOf(b).color); return c ? `--act:${c}` : null; };
const tone = s => model.statusTone(s);
const pill = s => h('span', { class: 'pill ' + tone(s) }, model.statusLabel(s));
const multi = b => lastDay(b) > b.date;
const dateRange = (b, f) => (!isoOk(b.date) ? 'No date' : multi(b) ? `${f(b.date)} → ${f(lastDay(b))}` : f(b.date));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// The first time on the day with its name ("Load-in 17:00"), or "10:00–18:00" for studio time and rehearsals.
function timeLine(b) {
  const run = runOfDay(b);
  if (!run.length) return '';
  if (b.kind !== 'show') return run.map(x => x[1]).join('–');
  const [l, t] = run[0], set = run.find(x => x[0] === 'On stage');
  return `${l} ${t}` + (set && set !== run[0] ? ` · On ${set[1]}` : '');
}
// Where, without repeating the title: the venue's name unless "Act @ Venue" already says it; with the address
// (first line) when asked for, or when the name is already in the title.
function venueLine(b, withAddress = false) {
  const v = model.venueOf(b), name = v.name || '', addr = String(v.address || b.address || '').split('\n')[0].trim();
  const said = name && model.bookingTitle(b).includes(name);
  return [!said && name, (withAddress || said) && addr].filter(Boolean).join(', ');
}
const filtersOn = () => !!(S.kind || S.act);
const passes = b => (!S.kind || b.kind === S.kind) && (!S.act || b.actId === S.act);

/* ------------------------------- state ------------------------------- */
const S = { view: 'month', cursor: monthStart(todayISO()), day: todayISO(), id: null, kind: '', act: '', all: false, drawn: '' };
const OPEN = new Map(); // booking id → Set of open block ids (survives every redraw)
const openSet = id => { if (!OPEN.has(id)) OPEN.set(id, new Set()); return OPEN.get(id); };
let ROOT = null;

// What identifies a control across one of this page's own redraws (a filter chip, a month arrow, a day).
const keyOf = el => (!el || !ROOT || el === ROOT || !ROOT.contains(el) ? null
  : el.id ? '#' + el.id : el.dataset && el.dataset.date ? 'd' + el.dataset.date : el.getAttribute('aria-label') ? 'a' + el.getAttribute('aria-label') : 't' + el.tagName + (el.textContent || '').trim().slice(0, 60));
function draw(focus = false) {
  if (!ROOT) return;
  if (S.view === 'booking' && !byId('bookings', S.id)) { S.view = 'day'; focus = true; } // deleted (here or elsewhere): its day
  if (S.act && !byId('acts', S.act)) S.act = '';
  const was = focus ? null : keyOf(document.activeElement);
  ROOT.replaceChildren(S.view === 'booking' ? bookingPage(byId('bookings', S.id)) : S.view === 'day' ? dayView() : monthView());
  if (was) { const again = [...ROOT.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].find(x => keyOf(x) === was); if (again) again.focus({ preventScroll: true }); }
  // The back button's shine runs when a page is arrived at, not on the redraw every change causes.
  const key = [S.view, S.id, S.day].join('|');
  if (key !== S.drawn) ROOT.querySelectorAll('.back-btn').forEach(el => el.classList.add('shine'));
  S.drawn = key;
  if (focus) { const head = ROOT.querySelector('[data-view-head]'); if (head) head.focus({ preventScroll: true }); }
}
// Move to another view (or month): draws and, for a new view, goes to the top and puts the focus on its heading.
function go(p, { top = true } = {}) {
  const was = [S.view, S.id, S.day].join('|');
  Object.assign(S, p);
  const now = [S.view, S.id, S.day].join('|');
  draw(top && was !== now);
  if (top) window.scrollTo({ top: 0 });
}
const showBooking = b => go({ view: 'booking', id: b.id, day: covers(b, S.day) ? S.day : b.date, cursor: monthStart(b.date) });

export const bookings = {
  id: 'bookings', label: 'Bookings', icon: '📅',
  render(root) { ROOT = root; draw(); },
  tutorial: () => (S.view === 'booking' && byId('bookings', S.id) ? bookingSteps(byId('bookings', S.id)) : S.view === 'day' ? DAY_STEPS : MONTH_STEPS),
};

// Go to Bookings and show that booking's page. Resolves (true) once it is drawn; false when there is no such booking.
export function openBooking(id) {
  const b = byId('bookings', id);
  if (!b) { toast('That booking is not here any more.'); return Promise.resolve(false); }
  Object.assign(S, { view: 'booking', id: b.id, day: b.date, cursor: monthStart(b.date) });
  const here = () => window.logiPage && window.logiPage() === 'bookings' && ROOT && ROOT.isConnected;
  if (here()) { draw(true); window.scrollTo({ top: 0 }); return Promise.resolve(true); }
  return Promise.resolve(window.logiGo ? window.logiGo('bookings') : null).then(() => {
    const head = ROOT && ROOT.isConnected && ROOT.querySelector('[data-view-head]');
    if (head) head.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
    return !!byId('bookings', id);
  });
}

// Open the new-booking form, prefilled ({ kind, actId, venueId, date, setlistId }). Without a kind, asks for one first.
export function newBooking(preset = {}) {
  const p = preset && typeof preset === 'object' ? preset : {};
  if (p.kind && model.KINDS.some(k => k[0] === p.kind)) editBooking(blank(p.kind, p));
  else chooseKind(p);
}

/* ------------------------------- new / edit ------------------------------- */
function blank(kind, p = {}) {
  const v = p.venueId ? byId('venues', p.venueId) : null;
  return {
    kind, status: kind === 'show' || kind === 'session' ? 'hold' : 'confirmed', title: '',
    actId: p.actId && byId('acts', p.actId) ? p.actId : db.acts.length === 1 && kind !== 'other' ? db.acts[0].id : '',
    date: isoOk(p.date) ? p.date : todayISO(), endDate: '',
    venueId: v ? v.id : '', venueName: '', address: '',
    contact: v ? { name: v.contact || '', role: '', phone: v.phone || '', email: v.email || '' } : {},
    setlistId: p.setlistId && byId('setlists', p.setlistId) ? p.setlistId : '',
    people: [], gear: [], gearQty: {}, kits: [], checks: {},
    ...(kind === 'session' ? { rateUnit: 'hour' } : {}),
  };
}

function chooseKind(preset = {}) {
  const { close } = sheet('What are you booking?', h('div', { class: 'bk-kinds' },
    model.KINDS.map(([id, label, icon]) => h('button', { type: 'button', class: 'card tap bk-kind', 'data-kind': id, onclick: () => { close(); editBooking(blank(id, preset)); } },
      h('span', { class: 'bk-kind-ico', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'bk-kind-text' }, h('strong', null, label), h('span', { class: 'muted small' }, KIND_HELP[id]))))));
}

const sortByName = list => [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
// Venues for a kind of booking: the fitting kind first (studios for a session), the rest after with their kind named.
function venueOptions(kind) {
  const want = { show: ['venue', 'festival'], session: ['studio'], rehearsal: ['rehearsal'], other: [] }[kind] || [];
  const fits = v => want.includes(v.kind || 'venue');
  const list = sortByName(db.venues).sort((a, b) => Number(fits(b)) - Number(fits(a)));
  return [['', 'Not in my venues'], ...list.map(v => [v.id, (v.name || 'Unnamed venue') + (want.length && !fits(v) ? ` · ${model.venueKindLabel(v.kind)}` : '')])];
}

function fieldsFor(kind) {
  const acts = sortByName(db.acts);
  const noActs = !acts.length ? 'Add your bands and artists on the Acts page to pick them here.' : '';
  const act = (label = 'Act', none = 'No act') => ({ key: 'actId', label, type: 'select', options: [['', none], ...acts.map(a => [a.id, a.name || 'Unnamed act'])], hint: noActs || (kind === 'other' ? '' : 'Its members are added to the line-up when the line-up is empty.') });
  const status = { key: 'status', label: 'Status', type: 'select', options: model.statusesFor(kind).map(([id, label]) => [id, label]) };
  const date = { key: 'date', label: 'Date', type: 'date', required: true };
  const endDate = { key: 'endDate', label: 'Last day (more than one day)', type: 'date', hint: 'Leave blank for a single day.' };
  const venue = (label, nameLabel, ph) => [
    { key: 'venueId', label, type: 'select', options: venueOptions(kind), hint: db.venues.length ? '' : 'Save venues, studios and rooms on the Venues page to pick them here.' },
    { key: 'venueName', label: nameLabel, placeholder: ph },
    { key: 'address', label: 'Address', type: 'textarea', rows: 2 },
  ];
  const t = (key, label) => ({ key, label, type: 'time' });
  const title = { key: 'title', label: 'Title (optional)', placeholder: 'Blank: “Act @ Venue”', hint: 'Only if you want a name of your own on the calendar.' };
  const contact = [
    { key: 'contactName', label: kind === 'show' ? 'Promoter or contact' : 'Contact', list: sortByName(db.people).map(p => p.name).filter(Boolean), placeholder: 'Name' },
    { key: 'contactRole', label: 'Their role', list: CONTACT_ROLES },
    { key: 'contactPhone', label: 'Phone', type: 'tel' },
    { key: 'contactEmail', label: 'Email', type: 'email' },
  ];
  if (kind === 'show') return [act(), status, date, endDate, ...venue('Venue', 'Venue name', 'e.g. The Moth Club'),
    t('loadIn', 'Load-in'), t('soundcheck', 'Soundcheck'), t('doors', 'Doors'), t('setTime', 'On stage'),
    { key: 'setLength', label: 'Set length (minutes)', type: 'number', min: 0, placeholder: 'e.g. 45' }, t('curfew', 'Curfew'), title, ...contact];
  if (kind === 'session') return [act('Act', 'Not in my acts'), { key: 'client', label: 'Artist or client', placeholder: 'Who the session is for' }, status, date, endDate,
    ...venue('Studio', 'Studio name', 'e.g. Echo Chamber Studios'), t('start', 'Start'), t('end', 'Finish'),
    { key: 'rate', label: 'Rate', type: 'number', min: 0, step: 'any', placeholder: '0' }, { key: 'rateUnit', label: 'Per', type: 'select', options: model.RATE_UNITS }, title, ...contact];
  if (kind === 'rehearsal') return [act(), status, date, ...venue('Room', 'Room name', 'e.g. Basement Rehearsal Rooms'), t('start', 'Start'), t('end', 'Finish'), title];
  return [{ key: 'title', label: 'What', required: true, placeholder: 'e.g. Radio session, photo shoot, label meeting' }, status, date, endDate, t('start', 'Start'), t('end', 'Finish'),
    ...venue('Where', 'Place', 'e.g. BBC Maida Vale'), act('Act (optional)'), { key: 'fee', label: 'Fee', type: 'number', min: 0, step: 'any', placeholder: '0' }];
}

function editBooking(b) {
  const isNew = !b.id;
  const kind = model.KINDS.some(k => k[0] === b.kind) ? b.kind : 'other';
  const c = b.contact || {};
  const values = { ...b, kind, contactName: c.name || '', contactRole: c.role || '', contactPhone: c.phone || '', contactEmail: c.email || '' };
  if (!model.statusesFor(kind).some(s => s[0] === values.status)) values.status = model.statusesFor(kind)[0][0];
  openForm({
    title: `${isNew ? 'New' : 'Edit'} ${NOUN[kind]}`,
    values, fields: fieldsFor(kind), saveLabel: isNew ? 'Add' : 'Save',
    onSave: v => {
      const rec = tidy(v, kind);
      const stored = upsert('bookings', rec);
      haptic();
      if (isNew) { toast(`${model.kindLabel(kind)} added`); openBooking(stored.id); } else toast('Saved');
    },
    onDelete: isNew ? null : () => { if (remove('bookings', b.id) !== false) { toast('Booking deleted'); haptic(30); } },
  });
  wireForm(kind);
}

// What the form gave back, made into a booking record.
function tidy(v, kind) {
  const out = { ...v, kind };
  const str = x => String(x ?? '').trim();
  const contact = { name: str(v.contactName), role: str(v.contactRole), phone: str(v.contactPhone), email: str(v.contactEmail) };
  // A contact picked from People brings their number and email when those were left blank.
  const p = contact.name && db.people.find(x => str(x.name).toLowerCase() === contact.name.toLowerCase());
  if (p) { if (!contact.phone) contact.phone = p.phone || ''; if (!contact.email) contact.email = p.email || ''; if (!contact.role) contact.role = p.role || ''; }
  delete out.contactName; delete out.contactRole; delete out.contactPhone; delete out.contactEmail;
  out.contact = contact;
  out.title = str(v.title);
  if (!isoOk(out.endDate) || out.endDate <= out.date) out.endDate = '';
  // A saved venue brings its own name and address (and keeps them up to date); typed ones are for anywhere else.
  if (out.venueId && byId('venues', out.venueId)) { out.venueName = ''; out.address = ''; } else { out.venueId = ''; out.venueName = str(out.venueName); out.address = str(out.address); }
  if (out.actId && !byId('acts', out.actId)) out.actId = '';
  if (out.actId && kind === 'session') out.client = '';
  for (const k of ['setLength', 'rate', 'fee']) {
    if (out[k] === '' || out[k] == null || !Number.isFinite(Number(out[k]))) delete out[k];
    else out[k] = k === 'setLength' ? Math.max(0, Math.round(Number(out[k]))) : Math.max(0, Number(out[k]));
  }
  if (!model.statusesFor(kind).some(s => s[0] === out.status)) out.status = model.statusesFor(kind)[0][0];
  // The act's members join the line-up when nobody is on it yet.
  const act = out.actId && byId('acts', out.actId);
  if (act && !(out.people || []).length) out.people = (act.members || []).filter(id => byId('people', id));
  return out;
}

// The form is one schema for every case: a saved venue hides the boxes for typing a venue, and picking an act for a
// session hides the box for an artist who is not in Acts.
function wireForm(kind) {
  const forms = document.querySelectorAll('.sheet form.form'), form = forms[forms.length - 1];
  if (!form) return;
  const ctl = key => form.querySelector(`[data-key="${key}"]`) || form.querySelector(`select[id$="-${key}"]`);
  const fieldOf = key => { const el = ctl(key); return el ? el.closest('.field') : null; };
  const venueSel = ctl('venueId');
  if (venueSel) {
    const note = h('small', { class: 'muted bk-venue-note' });
    venueSel.closest('.field').append(note);
    const sync = fill => {
      const v = byId('venues', venueSel.value);
      for (const f of [fieldOf('venueName'), fieldOf('address')]) if (f) f.hidden = !!v;
      note.textContent = v ? (v.address ? `📍 ${String(v.address).split('\n')[0]}` : 'No address saved for this venue yet.') : 'Type the name and address below.';
      // A venue's own contact fills an empty contact.
      if (fill && v) {
        const [n, ph, em] = ['contactName', 'contactPhone', 'contactEmail'].map(ctl);
        if (n && ph && em && !n.value && !ph.value && !em.value) { n.value = v.contact || ''; ph.value = v.phone || ''; em.value = v.email || ''; }
      }
    };
    venueSel.addEventListener('change', () => sync(true));
    sync(false);
  }
  const actSel = ctl('actId'), client = kind === 'session' ? fieldOf('client') : null;
  if (actSel && client) { const sync = () => { client.hidden = !!actSel.value; }; actSel.addEventListener('change', sync); sync(); }
}

/* ------------------------------- status, duplicate, delete ------------------------------- */
function setStatus(b, s) {
  const cur = byId('bookings', b.id);
  if (!cur || cur.status === s) return;
  patch('bookings', b.id, { status: s });
  if (s === 'advanced') model.markCheck(b.id, 'show-advance', true); // marking a show advanced ticks that line
  setTimeout(() => { const btn = ROOT && ROOT.querySelector('.bk-status'); if (btn && document.activeElement !== btn && !document.querySelector('.sheet')) btn.focus({ preventScroll: true }); }, 30); // after the redraw (app.js also restores it by id)
  haptic();
  toast(`Status: ${model.statusLabel(s)}`);
}

function statusPicker(b) {
  const { close } = sheet('Booking status', h('div', { class: 'bk-status-list', role: 'radiogroup', 'aria-label': 'Status' },
    model.statusesFor(b.kind).map(([id, label, t]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(b.status === id), class: 'bk-status-opt' + (b.status === id ? ' on' : ''), 'data-status': id,
      onclick: () => { close(); setStatus(b, id); },
    }, h('span', { class: 'pill st-' + t }, label), h('span', { class: 'muted small' }, STATUS_HELP[id] || ''), b.status === id && h('span', { class: 'bk-tick', 'aria-hidden': 'true' }, '✓')))));
}

// A copy for another date: same act, venue, times, people and gear, but none of the money or the night (no
// settlement, quote, invoice, ticks or guests marked in), and on hold.
export function copyOf(b, date) {
  const off = isoOk(b.date) && isoOk(date) ? daysBetween(b.date, date) : 0;
  const c = JSON.parse(JSON.stringify(b));
  for (const k of ['id', 'createdAt', 'updatedAt', 'sample', 'settlement', 'quote', 'invoice']) delete c[k];
  c.status = 'hold'; c.checks = {}; c.date = date;
  if (c.endDate) c.endDate = addDays(c.endDate, off);
  if (Array.isArray(c.guestList)) c.guestList = c.guestList.map(g => ({ ...g, in: false }));
  if (c.deal && typeof c.deal === 'object') { c.deal.depositPaid = false; if (isoOk(c.deal.depositDue)) c.deal.depositDue = addDays(c.deal.depositDue, off); }
  if (Array.isArray(c.deliverables)) c.deliverables = c.deliverables.map(d => ({ ...d, done: false, due: isoOk(d.due) ? addDays(d.due, off) : d.due }));
  return c;
}

function duplicateSheet(b) {
  const span = multi(b) ? daysBetween(b.date, lastDay(b)) : 0;
  const input = h('input', { type: 'date', id: 'bk-dup-date', required: true, value: isoOk(b.date) ? addDays(b.date, 7) : todayISO() });
  const note = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const sync = () => { note.textContent = span && isoOk(input.value) ? `It runs to ${fmtShort(addDays(input.value, span))}, ${span + 1} days like this one.` : ''; };
  input.addEventListener('input', sync); sync();
  let close = () => {};
  const form = h('form', { class: 'stack', onsubmit: e => {
    e.preventDefault();
    if (!isoOk(input.value)) { input.focus(); return toast('Pick the date for the copy'); }
    close();
    const stored = upsert('bookings', copyOf(byId('bookings', b.id) || b, input.value));
    haptic();
    toast(`Copied to ${fmtShort(stored.date)}, on hold`);
    openBooking(stored.id);
  } },
    h('p', null, h('strong', null, model.bookingTitle(b)), h('span', { class: 'muted small' }, ' · ' + dateRange(b, fmtShort))),
    h('p', { class: 'muted small' }, 'The copy keeps the act, venue, times, contact, deal, people and gear. It starts on hold, with an empty checklist and no settlement, quote or invoice.'),
    h('div', { class: 'field' }, h('label', { for: 'bk-dup-date' }, 'New date'), input),
    note,
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn primary' }, '⧉ Make the copy'), h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel')));
  ({ close } = sheet('Duplicate booking', form));
  setTimeout(() => input.focus(), 60);
}

// Press and hold a booking (its card, or its header on its own page) for three seconds: this sheet offers to delete
// it. The Delete button on its page does the same for keyboards.
const HOLD_MS = 3000;
function deleteSheet(b) {
  const { close } = sheet('Delete this booking?', h('div', { class: 'stack' },
    h('p', null, h('strong', null, model.bookingTitle(b)), h('span', { class: 'muted small bk-del-when' }, [dateRange(b, fmtShort), model.kindLabel(b.kind)].join(' · '))),
    h('p', { class: 'small muted' }, b.kind === 'show'
      ? 'Its deal, running order, guest list, settlement, checklist ticks, quote and invoice go with it. Your act, venue, people and setlist stay. This cannot be undone.'
      : 'Its checklist ticks, notes, quote and invoice go with it. Take logs and clocked hours stay, unlinked. This cannot be undone.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn danger', onclick: () => { close(); if (remove('bookings', b.id) !== false) { toast('Booking deleted'); haptic(30); announce('Booking deleted'); } } }, '🗑 Delete booking'),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Keep it'))));
}
const holdToDelete = (el, b) => { hold(el, HOLD_MS, () => { haptic(20); deleteSheet(byId('bookings', b.id) || b); }); return el; };

function addToCalendar(b) {
  saveFile(bookingIcs(b), fileName(`${model.bookingTitle(b)} ${b.date || ''}`, 'ics'), 'text/calendar')
    .then(done => { if (done) toast('Calendar file saved. Open it to add the booking to your calendar.'); })
    .catch(() => toast('The calendar file could not be saved here.'));
}
function exportCalendar() {
  const list = upcoming().filter(passes);
  if (!list.length) return toast(filtersOn() ? 'Nothing coming up with these filters.' : 'Nothing coming up to export yet.');
  const act = S.act && byId('acts', S.act);
  const name = ['Gigdex', act && act.name, S.kind && KIND_CHIP[S.kind]].filter(Boolean).join(' – ');
  saveFile(allIcs(list, name), fileName(name, 'ics'), 'text/calendar')
    .then(done => { if (done) toast(`${plural(list.length, 'booking')} saved to a calendar file`); })
    .catch(() => toast('The calendar file could not be saved here.'));
}

/* ------------------------------- month ------------------------------- */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function monthView() {
  const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
  const total = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const today = todayISO();
  const all = db.bookings.filter(b => isoOk(b.date) && passes(b));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'day blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= total; d++) cells.push(dayCell(ymd(new Date(y, m, d)), all, today));
  const shift = n => go({ cursor: new Date(y, m + n, 1) }, { top: false });
  const grid = h('div', { class: 'cal bk-cal', role: 'group', 'aria-label': S.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) },
    WEEKDAYS.map(w => h('div', { class: 'wd', 'aria-hidden': 'true' }, w)), cells);
  swipeMonths(grid, shift);
  arrowKeys(grid);

  const list = upcoming().filter(passes);
  const shown = S.all ? list : list.slice(0, 8);
  const actsUsed = sortByName(db.acts.filter(a => db.bookings.some(b => b.actId === a.id)));
  const kindsUsed = model.KINDS.filter(([k]) => db.bookings.some(b => b.kind === k));
  const chip = (on, label, onclick, extra = {}) => h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick, ...extra }, label);
  const filters = (kindsUsed.length > 1 || S.kind || actsUsed.length > 1 || S.act) && h('div', { class: 'bk-filters', role: 'group', 'aria-label': 'Filters' },
    (kindsUsed.length > 1 || S.kind) && h('div', { class: 'chips', role: 'group', 'aria-label': 'Kind of booking' },
      chip(!S.kind, 'All kinds', () => go({ kind: '' }, { top: false })),
      model.KINDS.filter(([k]) => S.kind === k || kindsUsed.some(x => x[0] === k)).map(([k, , icon]) => chip(S.kind === k, `${icon} ${KIND_CHIP[k]}`, () => go({ kind: S.kind === k ? '' : k }, { top: false })))),
    (actsUsed.length > 1 || S.act) && h('div', { class: 'chips', role: 'group', 'aria-label': 'Act' },
      chip(!S.act, 'All acts', () => go({ act: '' }, { top: false })),
      actsUsed.concat(S.act && !actsUsed.some(a => a.id === S.act) && byId('acts', S.act) ? [byId('acts', S.act)] : []).map(a => chip(S.act === a.id,
        [h('span', { class: 'bk-swatch', style: safeColor(a.color) ? `--act:${safeColor(a.color)}` : null, 'aria-hidden': 'true' }), a.name || 'Unnamed act'],
        () => go({ act: S.act === a.id ? '' : a.id }, { top: false })))));

  return h('div', { class: 'bk-monthview' },
    h('div', { class: 'page-head' },
      h('h1', { tabindex: '-1', 'data-view-head': '' }, 'Bookings'),
      h('div', { class: 'bk-head-actions' },
        h('button', { type: 'button', class: 'btn ghost small bk-export', title: 'Save your upcoming bookings as a calendar file (.ics)', onclick: exportCalendar }, '📆 Export calendar'),
        h('button', { type: 'button', class: 'btn primary bk-new', onclick: () => newBooking({ date: today >= ymd(S.cursor) && today <= ymd(new Date(y, m, total)) ? today : ymd(S.cursor) }) }, '+ New'))),
    filters,
    h('section', { class: 'cal-panel box-dark bk-cal-panel', 'aria-label': 'Calendar' },
      h('div', { class: 'cal-nav' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
        h('div', { class: 'cal-title', 'aria-live': 'polite' }, S.cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        h('button', { type: 'button', class: 'btn ghost small', 'aria-label': 'This month', onclick: () => go({ cursor: monthStart(today) }, { top: false }) }, 'Today'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
      grid,
      h('div', { class: 'bk-legend muted', 'aria-hidden': 'true' }, h('span', null, h('i', { class: 'bk-dot st-confirmed' }), ' booked'), h('span', null, h('i', { class: 'bk-dot st-hold' }), ' hold or offer'), h('span', null, h('i', { class: 'bk-dot st-cancelled' }), ' cancelled'))),
    h('h3', { class: 'bk-agenda-head' }, filtersOn() ? 'Coming up (filtered)' : 'Coming up'),
    list.length
      ? h('div', { class: 'bk-agenda' },
        h('div', { class: 'list' }, shown.map(agendaCard)),
        list.length > 8 && h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost small', id: 'bk-agenda-more', onclick: () => go({ all: !S.all }, { top: false }) }, S.all ? 'Show fewer' : `Show all (${list.length})`)))
      : empty(filtersOn() ? 'Nothing coming up with these filters.' : 'Nothing coming up. Add a show, a studio session or a rehearsal, or tap a date on the calendar.',
        filtersOn() ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go({ kind: '', act: '' }, { top: false }) }, 'Clear the filters') : h('button', { type: 'button', class: 'btn primary', onclick: () => newBooking({}) }, '+ New booking')));
}

function dayCell(iso, all, today) {
  const list = all.filter(b => covers(b, iso)).sort((a, b) => model.firstTime(a).localeCompare(model.firstTime(b)));
  const d = parseISO(iso), dow = (d.getDay() + 6) % 7;
  // A booking over several days shows on each: its line runs on from the day before, and the name shows on the first
  // day and at the start of each week row.
  const seg = b => (!multi(b) ? '' : iso === b.date ? ' bk-seg-start' : iso === lastDay(b) ? ' bk-seg-end' : ' bk-seg-mid');
  const named = b => !multi(b) || iso === b.date || dow === 0;
  // The line leads with where (the act is its colour): a typed title, else the venue, else the act or client.
  const short = b => b.title || model.venueOf(b).name || model.bookingTitle(b);
  const mini = b => h('span', { class: `bk-mini ${tone(b.status)}${seg(b)}`, style: actStyle(b) }, named(b) ? `${model.kindIcon(b.kind)} ${short(b)}` : ' ');
  const dot = b => h('i', { class: `bk-dot ${tone(b.status)}${multi(b) ? ' bk-bar' + seg(b) : ''}`, style: actStyle(b) });
  const label = `${fmtLong(iso)}${iso === today ? ', today' : ''}: ${list.length ? list.map(b => `${model.bookingTitle(b)} (${model.statusLabel(b.status)})`).join(', ') : 'nothing booked'}`;
  return h('button', {
    type: 'button', class: 'day bk-day' + (iso === today ? ' today' : '') + (list.length ? ' has' : ''), 'data-date': iso, 'aria-label': label,
    'aria-current': iso === today ? 'date' : null, onclick: () => go({ view: 'day', day: iso }),
  },
    h('span', { class: 'num' }, d.getDate()),
    list.length > 0 && h('span', { class: 'bk-minis' }, list.slice(0, 3).map(mini), list.length > 3 && h('span', { class: 'more' }, `+${list.length - 3} more`)),
    list.length > 0 && h('span', { class: 'bk-dots', 'aria-hidden': 'true' }, list.slice(0, 4).map(dot), list.length > 4 && h('span', { class: 'more' }, '+')));
}

// Swipe the calendar left or right for the next or previous month (a scroll up or down is left alone).
function swipeMonths(grid, shift) {
  let x = null, y = 0, at = 0;
  grid.addEventListener('pointerdown', e => { if (e.button === 0) { x = e.clientX; y = e.clientY; } });
  grid.addEventListener('pointerup', e => {
    if (x == null) return;
    const dx = e.clientX - x, dy = e.clientY - y; x = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { at = Date.now(); setTimeout(() => shift(dx < 0 ? 1 : -1), 0); }
  });
  grid.addEventListener('pointercancel', () => { x = null; });
  grid.addEventListener('click', e => { if (Date.now() - at < 500) { e.stopPropagation(); e.preventDefault(); } }, true); // the tap that ends a swipe opens nothing
}
// Arrow keys move between days (up and down by a week), across into the next or previous month.
function arrowKeys(grid) {
  grid.addEventListener('keydown', e => {
    const cell = e.target.closest && e.target.closest('[data-date]');
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!cell || !step) return;
    e.preventDefault(); // the Rolodex keeps its arrows for the rest of the page
    const iso = addDays(cell.dataset.date, step);
    if (iso.slice(0, 7) !== cell.dataset.date.slice(0, 7)) go({ cursor: monthStart(iso) }, { top: false });
    const next = ROOT && ROOT.querySelector(`[data-date="${iso}"]`);
    if (next) next.focus();
  });
}

function agendaCard(b) {
  const d = parseISO(b.date), n = daysUntil(b.date);
  const when = n < 0 ? 'On now' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 14 ? `In ${n} days` : '';
  const card = h('button', { type: 'button', class: 'card tap bk-card', style: actStyle(b), 'data-id': b.id, title: 'Tap to open; press and hold to delete',
    onclick: () => { if (!wasHeld(card)) showBooking(b); } },
    h('span', { class: 'bk-date', 'aria-hidden': 'true' },
      h('span', null, d.toLocaleDateString(undefined, { weekday: 'short' })), h('b', null, d.getDate()), h('span', null, d.toLocaleDateString(undefined, { month: 'short' }))),
    h('span', { class: 'sr-only' }, dateRange(b, fmtLong) + '. '),
    h('span', { class: 'bk-card-main' },
      h('span', { class: 'bk-card-top' }, h('strong', { class: 'bk-card-title' }, h('span', { 'aria-hidden': 'true' }, model.kindIcon(b.kind) + ' '), model.bookingTitle(b)), pill(b.status)),
      h('span', { class: 'bk-card-sub muted small' }, [when, multi(b) && `to ${fmtShort(lastDay(b))}`, timeLine(b), venueLine(b) && `📍 ${venueLine(b)}`].filter(Boolean).join(' · '))));
  return holdToDelete(card, b);
}

/* -------------------------------- day -------------------------------- */
function dayView() {
  const list = bookingsOn(S.day);
  const shift = n => go({ day: addDays(S.day, n), cursor: monthStart(addDays(S.day, n)) }, { top: false });
  return h('div', { class: 'bk-dayview' },
    h('div', { class: 'page-head' },
      backBtn('Calendar', () => go({ view: 'month', cursor: monthStart(S.day) })),
      h('button', { type: 'button', class: 'btn primary bk-new-day', onclick: () => newBooking({ date: S.day }) }, '+ New on this day')),
    h('div', { class: 'cal-nav' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => shift(-1) }, '‹'),
      h('h2', { class: 'cal-title', tabindex: '-1', 'data-view-head': '' }, fmtLong(S.day), S.day === todayISO() && h('span', { class: 'muted small' }, ' · today')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next day', onclick: () => shift(1) }, '›')),
    list.length
      ? h('div', { class: 'list bk-daylist' }, list.map(dayCard))
      : empty('Nothing booked on this day.', h('button', { type: 'button', class: 'btn primary', onclick: () => newBooking({ date: S.day }) }, '+ Add a booking')));
}

function dayCard(b) {
  const people = (b.people || []).filter(id => byId('people', id)).length;
  const items = (b.gear || []).filter(id => byId('gear', id)).length;
  const card = h('button', { type: 'button', class: 'card tap bk-card bk-card-day', style: actStyle(b), 'data-id': b.id, title: 'Tap to open; press and hold to delete',
    onclick: () => { if (!wasHeld(card)) go({ view: 'booking', id: b.id }); } },
    h('span', { class: 'bk-card-main' },
      h('span', { class: 'bk-card-top' }, h('strong', { class: 'bk-card-title' }, h('span', { 'aria-hidden': 'true' }, model.kindIcon(b.kind) + ' '), model.bookingTitle(b)), pill(b.status)),
      h('span', { class: 'bk-card-sub muted small' }, [model.kindLabel(b.kind), multi(b) && dateRange(b, fmtShort), timeLine(b)].filter(Boolean).join(' · ')),
      venueLine(b, true) && h('span', { class: 'bk-card-sub muted small' }, '📍 ' + venueLine(b, true)),
      (people || items) ? h('span', { class: 'bk-card-sub muted small' }, [people && plural(people, 'person', 'people'), items && plural(items, 'item')].filter(Boolean).join(' · ')) : null));
  return holdToDelete(card, b);
}

/* ------------------------------- the booking ------------------------------- */
function bookingPage(b) {
  const here = covers(b, S.day) ? S.day : b.date;
  const blocks = blocksFor(b.kind);
  const ctx = {
    sym: model.currency(),
    open(id) {
      openSet(b.id).add(id);
      const el = document.getElementById('blk-' + id);
      if (el) { el.open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    },
  };
  return h('div', { class: 'bk-page' },
    h('div', { class: 'page-head' },
      backBtn(isoOk(here) ? fmtShort(here) : 'Day', () => go({ view: 'day', day: isoOk(here) ? here : todayISO() })),
      h('button', { type: 'button', class: 'btn ghost bk-edit', onclick: () => editBooking(byId('bookings', b.id) || b) }, '✎ Edit')),
    hero(b),
    h('div', { class: 'bk-actions' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => duplicateSheet(b) }, h('span', { 'aria-hidden': 'true' }, '⧉'), 'Duplicate'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => addToCalendar(b) }, h('span', { 'aria-hidden': 'true' }, '📆'), 'Add to calendar'),
      h('button', { type: 'button', class: 'btn ghost small bk-delete', onclick: () => deleteSheet(b) }, h('span', { 'aria-hidden': 'true' }, '🗑'), 'Delete')),
    h('div', { class: 'bk-blocks' }, blocks.map(blk => blockBox(b, blk, ctx))));
}

function hero(b) {
  const v = model.venueOf(b);
  const where = { ...v, address: v.address || b.address || '' };
  const act = actOf(b);
  const c = b.contact || {};
  const digits = c.phone ? telUrl(c.phone).slice(4) : '';
  let warns = [];
  try { warns = (venueChecks(b) || []).filter(w => w && w.text); } catch (e) { console.warn('venue warnings', e); } // [{ level: 'warn'|'info', text }]
  const el = h('section', { class: 'card hero bk-hero', style: actStyle(b), 'aria-label': 'Booking', title: 'Press and hold to delete this booking' },
    h('div', { class: 'bk-hero-top' },
      h('h2', { class: 'bk-title', tabindex: '-1', 'data-view-head': '' }, h('span', { class: 'bk-title-ico', 'aria-hidden': 'true' }, model.kindIcon(b.kind)), ' ', model.bookingTitle(b)),
      h('button', { type: 'button', id: 'bk-status', class: 'bk-status', 'aria-label': `Status: ${model.statusLabel(b.status)}. Change it`, 'aria-haspopup': 'dialog', onclick: () => statusPicker(b) },
        h('span', { class: 'pill ' + tone(b.status) }, model.statusLabel(b.status), h('span', { 'aria-hidden': 'true' }, ' ▾')))),
    h('div', { class: 'muted bk-when' }, `${model.kindLabel(b.kind)} · ${dateRange(b, fmtLong)}` + (multi(b) ? ` · ${daysBetween(b.date, lastDay(b)) + 1} days` : '')),
    timesStrip(b),
    (where.name || where.address) ? h('div', { class: 'bk-venue' },
      h('div', { class: 'bk-venue-line' },
        h('span', { 'aria-hidden': 'true' }, '📍 '),
        h('span', { class: 'bk-venue-text' }, h('strong', null, where.name || 'Address'), where.address && h('span', { class: 'muted small' }, String(where.address).replace(/\s*\n\s*/g, ', '))),
        b.venueId && byId('venues', b.venueId) && h('button', { type: 'button', class: 'btn ghost small', onclick: () => openVenue(b.venueId), 'aria-label': `Venue details: ${where.name}` }, 'Details')),
      mapButtons(where))
      : b.kind !== 'other' && h('p', { class: 'muted small' }, 'No venue yet. Edit to add one.'),
    warns.map(w => (w.level === 'info' ? h('div', { class: 'muted small bk-venue-info' }, 'ℹ︎ ' + w.text) : h('div', { class: 'warn' }, '⚠ ' + w.text))),
    (act || b.client) && h('div', { class: 'bk-act-row' },
      act ? h('button', { type: 'button', class: 'chip bk-act', style: actStyle(b), onclick: () => openAct(act.id), 'aria-label': `Act: ${act.name}. Open it` }, h('span', { class: 'bk-swatch', 'aria-hidden': 'true' }), act.name || 'Unnamed act')
        : h('span', { class: 'chip bk-act bk-client' }, '🎙 ' + b.client)),
    (c.name || c.phone || c.email) && h('div', { class: 'bk-contact' },
      h('div', { class: 'bk-contact-who' }, h('span', { class: 'muted small' }, c.role || 'Contact'), h('strong', null, c.name || c.phone || c.email)),
      h('div', { class: 'bk-contact-btns' },
        digits && h('a', { class: 'btn ghost small', href: 'tel:' + digits, 'aria-label': `Call ${c.name || 'the contact'}` }, '📞 Call'),
        digits && h('a', { class: 'btn ghost small', href: 'sms:' + digits, 'aria-label': `Text ${c.name || 'the contact'}` }, '💬 Text'),
        c.email && h('a', { class: 'btn ghost small', href: 'mailto:' + encodeURIComponent(c.email).replace(/%40/g, '@'), 'aria-label': `Email ${c.name || 'the contact'}` }, '✉ Email'))));
  return holdToDelete(el, b);
}

// The day's times in boxes, in the order the day runs. A time earlier than the first one is after midnight (+1).
function timesStrip(b) {
  const run = runOfDay(b);
  if (!run.length) return h('p', { class: 'muted small bk-notimes' }, b.kind === 'show' ? 'No times yet. Edit to add load-in, doors and the set time.' : 'No times yet. Edit to add the start and finish.');
  const first = run[0][1];
  const span = t => model.minutesBetween(first, t);
  const curfew = b.kind === 'show' && run.find(x => x[0] === 'Curfew');
  const boxes = run.map(([label, t]) => {
    const late = curfew && label === 'Off stage' && span(t) > span(curfew[1]);
    return h('div', { class: 'bk-time' + (late ? ' late' : ''), role: 'listitem' },
      h('span', null, label),
      h('b', null, t, t < first && h('small', { class: 'bk-next', title: 'the next day' }, '+1', h('span', { class: 'sr-only' }, ' the next day'))),
      label === 'On stage' && Number(b.setLength) > 0 && h('small', { class: 'muted' }, `${Number(b.setLength)} min set`),
      late && h('small', { class: 'bk-late' }, 'after curfew'));
  });
  if (b.kind !== 'show' && run.length === 2) boxes.push(h('div', { class: 'bk-time', role: 'listitem' }, h('span', null, 'Length'), h('b', null, model.fmtMin(model.minutesBetween(run[0][1], run[1][1])))));
  return h('div', { class: 'bk-times', role: 'list', 'aria-label': 'Times' }, boxes);
}

function blockBox(b, blk, ctx) {
  const set = openSet(b.id);
  let sum = '';
  try { sum = blk.summary ? blk.summary(b) || '' : ''; } catch (e) { console.warn(`The ${blk.id} box summary failed`, e); }
  const body = h('div', { class: 'blk-body' });
  let filled = false;
  const fill = () => {
    filled = true;
    let node;
    try { node = blk.render(byId('bookings', b.id) || b, ctx); } catch (e) { console.warn(`The ${blk.id} box failed`, e); node = h('p', { class: 'warn small' }, `This box could not be shown (${(e && e.message) || e}).`); }
    body.replaceChildren(...nodes(node));
  };
  const det = h('details', { class: 'blk', id: 'blk-' + blk.id, open: set.has(blk.id) },
    h('summary', null,
      h('span', { class: 'blk-ico', 'aria-hidden': 'true' }, blk.icon || '•'),
      h('span', { class: 'blk-text' }, h('span', { class: 'blk-title' }, blk.title || blk.id), sum !== '' && h('span', { class: 'blk-sum' }, String(sum)))),
    body);
  if (det.open) fill();
  det.addEventListener('toggle', () => {
    if (det.open) { set.add(blk.id); if (!filled) fill(); } else { set.delete(blk.id); filled = false; body.replaceChildren(); }
  });
  return det;
}

/* ------------------------------- walkthroughs ------------------------------- */
const MONTH_STEPS = [
  { title: 'New booking', text: 'Add a show, a studio session, a rehearsal or anything else in the diary.', target: ['.bk-new'] },
  { title: 'Export calendar', text: 'Saves your upcoming bookings as a calendar file for Apple, Google or Outlook Calendar, or to send to the band. No fees or deals go in it.', target: ['.bk-export'] },
  { title: 'Filters', text: 'Show one act, or one kind of booking, on the calendar and in the list.', target: ['.bk-filters'] },
  { title: 'The calendar', text: 'Each line or dot is a booking in its act’s colour. Hollow or dashed means a hold or an offer. Tap a day to see it; swipe, or use ‹ ›, for other months.', target: ['.bk-cal-panel'] },
  { title: 'Coming up', text: 'Your next bookings, soonest first. Tap one to open it. Press and hold one for three seconds to delete it.', target: ['.bk-agenda', '.bk-monthview .empty'] },
];
const DAY_STEPS = [
  { title: 'One day', text: 'Everything booked on this day. ‹ › move a day at a time.', target: ['.bk-dayview .cal-nav'] },
  { title: 'Add to this day', text: 'A new booking with this date already filled in.', target: ['.bk-new-day'] },
  { title: 'Bookings', text: 'Tap one to open it. Press and hold one for three seconds to delete it.', target: ['.bk-daylist', '.bk-dayview .empty'] },
  { title: 'Back to the month', text: 'Calendar takes you back to the month.', target: ['.bk-dayview .back-btn'] },
];
function bookingSteps(b) {
  const base = [
    { title: 'The booking', text: 'The date, the times in the order the day runs, the venue with directions, the act and the contact. Press and hold this card for three seconds to delete the booking.', target: ['.bk-hero'] },
    { title: 'Status', text: 'Tap to change it: hold, offer, confirmed, advanced, done, paid. A cancelled booking stays in your records but leaves clashes and money.', target: ['.bk-status'] },
    { title: 'Times', text: 'Off stage is worked out from the set time and length. A time marked +1 is after midnight.', target: ['.bk-times'] },
    { title: 'Edit', text: 'Change the date, venue, times or contact.', target: ['.bk-edit'] },
    { title: 'Copy, calendar, delete', text: 'Duplicate makes a copy on another date (on hold, without the money). Add to calendar saves a calendar file of this booking.', target: ['.bk-actions'] },
    { title: 'The boxes', text: 'Everything else about the booking, one box each: tap a box to open it. Boxes you open stay open.', target: ['.bk-blocks'] },
  ];
  const set = openSet(b.id);
  const extra = blocksFor(b.kind).filter(x => set.has(x.id)).flatMap(x => { try { return (typeof x.tutorial === 'function' ? x.tutorial(b) : x.tutorial) || []; } catch { return []; } });
  return [...base, ...extra];
}

const formSteps = kind => () => [
  kind !== 'other' && { title: 'The act', text: 'Who is playing. Its members join the line-up when it is empty.', target: ['select[id$="-actId"]'] },
  { title: 'Date', text: 'The day, and a last day for a festival weekend or a block of studio days.', target: ['[data-key="date"]'] },
  { title: 'Where', text: 'Pick a saved venue, or choose “Not in my venues” and type the name and address.', target: ['select[id$="-venueId"]', '[data-key="venueName"]'] },
  kind === 'show' && { title: 'Times', text: 'Load-in, soundcheck, doors, on stage and curfew. The set length works out when you are off stage.', target: ['[data-key="loadIn"]'] },
  kind === 'session' && { title: 'Rate', text: 'What the session costs: per hour, per day, per song or a flat fee.', target: ['[data-key="rate"]'] },
  kind !== 'rehearsal' && kind !== 'other' && { title: 'Contact', text: 'The promoter, agent or studio contact. Their phone and email give you call, text and email buttons on the booking.', target: ['[data-key="contactName"]'] },
].filter(Boolean);
for (const [kind] of model.KINDS) { sheetTutorial(`New ${NOUN[kind]}`, formSteps(kind)); sheetTutorial(`Edit ${NOUN[kind]}`, formSteps(kind)); }
sheetTutorial('What are you booking?', [{ title: 'Pick a kind', text: 'Each kind has its own form and boxes: a show has a deal and a guest list, a session a rate and takes.', target: ['.bk-kinds'] }]);
sheetTutorial('Booking status', [{ title: 'Status', text: 'Tap one to set it. Hold and offer show hollow on the calendar; cancelled leaves clashes and money.', target: ['.bk-status-list'] }]);
sheetTutorial('Duplicate booking', [{ title: 'New date', text: 'The copy goes on this date, on hold, with the same act, venue, times, people and gear.', target: ['#bk-dup-date'] }]);
sheetTutorial('Delete this booking?', [{ title: 'Delete', text: 'Deleting cannot be undone. Keep it closes this without changing anything.', target: ['.btn.danger'] }]);

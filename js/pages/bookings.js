import { h, pad, ymd, todayISO, parseISO, fmtLong, fmtShort, fmtTime, groupBy, mapsUrl, telUrl, empty, uid, toast, backBtn, sheet, hold, wasHeld } from '../util.js';
import { haptic } from '../a11y.js';
import { db, byId, bookingsOn, gearClash, upsert, remove, update, endOf, covers, onDay, isEditDay, editDaysOf, qtyOf, usedQty } from '../store.js';
import { openForm } from '../form.js';
import { editKit } from './gear.js';
import { venueWarnings, openVenue, chips as venueChips } from './venues.js';
import { mapButtons } from '../map.js';
import { openCalendarSheet, openAddToCalendar, shareBooking, mailtoLink } from '../calendar.js';
import { openHoursSheet, editShift, stats, fmtHm, defaultBreak, kindOf } from '../hours.js';
import { clockCard } from '../clock.js';
import { STATUSES as WF_STATUSES, STAGES, typeOptions, templateById, applyTemplateDefaults, applyTemplateExtras, saveBookingAsTemplate, pickTemplate, typeLabel, slugStatus, workflowBlock, openPipeline, hiresBlock, rentalsBlock, hiredPeople, shotsBlock, mediaBlock, deliverablesBlock, licencesBlock, crewRow, progress } from '../workflow.js';
import { callSheetPage, openCallSheets, sheetState, commitDraft } from '../callsheet.js';
import { moneyPage, openMoney, moneyBlock, budgetBlock, budgetTotals, docOf, totals, isOverdue, fmtMoney } from '../money.js';
import { forecastCard, forecastLine, locationFor } from '../weather.js';
import { getTimes } from '../suncalc.js';
import { boardPlan, fmtEighths } from '../board.js';

const STATUSES = WF_STATUSES;
// The stripboard loads on first use; once loaded it draws straight away, so a redraw after each change does not flicker.
let stripMod = null;
const stripsView = (b, go) => {
  if (stripMod) return stripMod.stripboardPage(b, go);
  const host = h('div', { class: 'sb-page' }, h('p', { class: 'muted' }, 'Opening the stripboard…'));
  import('../stripboard.js').then(m => { stripMod = m; if (host.isConnected) { const pg = m.stripboardPage(byId('bookings', b.id) || b, go); host.replaceWith(pg); pg.querySelectorAll('.back-btn').forEach(el => el.classList.add('shine')); } }).catch(e => host.replaceChildren(h('p', { class: 'warn' }, 'The stripboard could not be loaded. Check the connection and try again. ' + (e.message || ''))));
  return host;
};
const sceneCount = b => (b.board && Array.isArray(b.board.list) ? b.board.list.filter(x => x && x.type === 'scene').length : 0);
const S = { view: 'month', cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1), day: todayISO(), id: null };
let GO = null; // the current render's navigation, so a walkthrough can open a booking by id
// Opens a booking's page (or, with a patch such as { view: 'money', kind: 'quote' }, one of its tools). The Bookings
// section must be the one on screen: window.logiGo('bookings') first.
export function openBooking(id, patch = {}) {
  const b = byId('bookings', id); if (!b || !GO) return false;
  const d = parseISO(b.date);
  GO({ view: 'booking', id, day: b.date, cursor: new Date(d.getFullYear(), d.getMonth(), 1), kind: 'quote', ...patch });
  return true;
}
export function showMonth() { if (GO) GO({ view: 'month', cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }); }

const dateRange = (b, f) => endOf(b) > b.date ? `${f(b.date)} → ${f(endOf(b))}` : f(b.date);
const pill = s => h('span', { class: 'pill st-' + slugStatus(s) }, s);
const editDayText = d => fmtShort(d.date) + (d.start ? ` ${d.start}${d.end ? '–' + d.end : ''}` : '');

export const bookings = {
  id: 'bookings', label: 'Bookings', icon: '📅',
  render(root) {
    const go = patch => { if (patch.view && patch.view !== 'callsheet') commitDraft(); Object.assign(S, patch); draw(); window.scrollTo({ top: 0 }); };
    GO = go;
    const draw = () => {
      if ((S.view === 'booking' || S.view === 'callsheet' || S.view === 'money' || S.view === 'strips') && !byId('bookings', S.id)) S.view = 'day';
      root.replaceChildren(S.view === 'month' ? month(go) : S.view === 'day' ? day(go) : S.view === 'callsheet' ? callSheetPage(byId('bookings', S.id), go) : S.view === 'money' ? moneyPage(byId('bookings', S.id), S.kind || 'quote', go) : S.view === 'strips' ? stripsView(byId('bookings', S.id), go) : detail(go));
      // The back button's shine runs when a page is arrived at, not on the redraw every change causes.
      const key = [S.view, S.id, S.day, S.kind].join('|');
      if (key !== S.drawn) root.querySelectorAll('.back-btn').forEach(el => el.classList.add('shine'));
      S.drawn = key;
    };
    draw();
    // Leaving the tab while a call sheet is being edited saves the draft (a re-render of this same tab does not).
    return () => { queueMicrotask(() => { if (!document.querySelector('.cs-page')) commitDraft(); }); };
  },
};

function editBooking(b, go) {
  const isNew = !b.id;
  openForm({
    title: isNew ? 'New booking' : 'Edit booking',
    values: b,
    fields: [
      { key: 'title', label: 'Project', required: true, placeholder: 'e.g. Brand film for…' },
      { key: 'client', label: 'Client' },
      { key: 'type', label: 'Job type', type: 'select', options: typeOptions(), hint: 'Picks the pre- and post-production checklists. Your own templates (Settings → Work & billing → Project templates) are listed first.' },
      { key: 'date', label: 'Start date', type: 'date', required: true },
      { key: 'endDate', label: 'End date (multi-day)', type: 'date', hint: 'Leave blank for a single day.' },
      { key: 'editDays', label: 'Edit days', type: 'rows', columns: [{ key: 'date', label: 'Date', type: 'date' }, { key: 'start', label: 'Start', type: 'time' }, { key: 'end', label: 'Finish', type: 'time' }], hint: 'Post-production days for this project. They show on the calendar in their own colour, go to your calendar feed, and hours clocked on them count as editing. Times are optional.' },
      { key: 'status', label: 'Stage', type: 'select', options: STATUSES },
      { key: 'start', label: 'Start', type: 'time' },
      { key: 'end', label: 'Finish', type: 'time' },
      ...(db.venues.length ? [{ key: 'venueId', label: 'Venue', type: 'select', options: [['', 'No saved venue'], ...db.venues.map(v => [v.id, v.name])], hint: 'Fills in the address and checks your equipment against the venue’s rules.' }] : []),
      { key: 'address', label: 'Location / address', type: 'textarea', rows: 2 },
      { key: 'stakeholders', label: 'Stakeholders & contacts', type: 'rows', columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'email', label: 'Email', type: 'email' }] },
      { key: 'crew', label: 'Crew', type: 'checks', options: db.crew.map(c => ({ value: c.id, label: c.name, hint: c.role })), empty: 'Add people on the Crew page first.' },
      ...(db.kits.length ? [{ key: 'kits', label: 'Kits', type: 'checks', hint: 'Ticking a kit adds its equipment below. You can still adjust the list.', options: db.kits.map(k => ({ value: k.id, label: k.name, hint: `${(k.gear || []).length} items`, adds: { gear: k.gear || [] }, addsQty: k.gearQty || {} })) }] : []),
      { key: 'gear', qtyKey: 'gearQty', label: 'Equipment', type: 'checks', hint: db.kits.length ? 'Tick a kit above to load a whole set, then adjust here.' : 'Tip: save kits on the Equipment page to load a whole set in one tap.', options: db.gear.map(g => ({ value: g.id, label: g.name, group: g.category || 'Other', qtyMax: qtyOf(g), hint: qtyOf(g) > 1 ? `(${qtyOf(g)} owned)` : '' })).sort((a, b) => a.group.localeCompare(b.group)), empty: 'Add kit on the Equipment page first.' },
      { key: 'breakMinutes', label: 'Approved break per day (minutes)', type: 'number', min: 0, placeholder: String(defaultBreak()), hint: `The clock counts breaks against this and warns when it’s used up. Blank = your default (${defaultBreak()} min).` },
      { key: 'breakNote', label: 'Break terms', placeholder: 'e.g. 30 min lunch + 2 × 15 min' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => {
      const item = { ...v, id: v.id || uid() };
      if (item.breakMinutes === '' || item.breakMinutes == null) delete item.breakMinutes;
      if (!item.endDate || item.endDate <= item.date) delete item.endDate;
      // Edit days: a date each, in order, with the times only when given; none at all leaves the booking as it was.
      const rows = (item.editDays || []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')).map(r => ({ date: r.date, ...(r.start ? { start: r.start } : {}), ...(r.end ? { end: r.end } : {}) })).sort((a, b) => a.date.localeCompare(b.date));
      const byDate = new Map(); for (const r of rows) { const have = byDate.get(r.date); if (!have || (!have.start && r.start)) byDate.set(r.date, r); } // one row per date: the calendar keys its events by the date
      item.editDays = [...byDate.values()];
      if (!item.editDays.length) delete item.editDays;
      if (!item.venueId) delete item.venueId;
      else if (!(item.address || '').trim()) item.address = byId('venues', item.venueId)?.address || '';
      item.gearQty = Object.fromEntries(Object.entries(item.gearQty || {}).filter(([id]) => (item.gear || []).includes(id)));
      upsert('bookings', item);
      if (isNew) { const t = templateById(item.type); if (t) { const n = applyTemplateExtras(item.id, t); if (n) toast(`Template applied: ${n} item${n === 1 ? '' : 's'} added`); } }
      go({ view: 'booking', id: item.id, day: item.date, cursor: new Date(parseISO(item.date).getFullYear(), parseISO(item.date).getMonth(), 1) });
    },
    onDelete: isNew ? null : () => { remove('bookings', b.id); go({ view: 'day' }); },
  });
}

const blankBooking = date => ({ title: '', client: '', type: 'brand', date, endDate: '', status: 'Enquiry', start: '', end: '', address: '', stakeholders: [], crew: [], gear: [], notes: '' });

/* ------------------------------- month ------------------------------- */
function month(go) {
  const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
  const prefix = `${y}-${pad(m + 1)}-`;
  const byDay = new Map();
  for (const b of db.bookings) for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) { const iso = prefix + pad(d); if (onDay(b, iso)) { if (!byDay.has(iso)) byDay.set(iso, []); byDay.get(iso).push(b); } }
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const total = new Date(y, m + 1, 0).getDate();
  const today = todayISO();
  // An edit day (and not also a shoot day) is marked in the edit colour, so it is never taken for a shoot.
  const editOn = (b, iso) => isEditDay(b, iso) && !covers(b, iso);

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'day blank' }));
  for (let d = 1; d <= total; d++) {
    const iso = prefix + pad(d);
    const list = (byDay.get(iso) || []).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    cells.push(h('button', {
      class: 'day' + (iso === today ? ' today' : '') + (list.length ? ' has' : '') + (list.length && list.every(b => editOn(b, iso)) ? ' edit-day' : ''), type: 'button',
      'aria-label': `${fmtLong(iso)}, ${list.length} booking${list.length === 1 ? '' : 's'}${list.some(b => editOn(b, iso)) ? ', edit day' : ''}`,
      onclick: () => go({ view: 'day', day: iso }),
    },
      h('span', { class: 'num' }, d),
      list.slice(0, 2).map(b => h('span', { class: 'mini st-' + slugStatus(b.status) + (editOn(b, iso) ? ' edit' : '') }, (editOn(b, iso) ? '✂ ' : '') + b.title)),
      list.length > 2 && h('span', { class: 'more' }, `+${list.length - 2}`),
      list.length > 0 && h('span', { class: 'dots' }, list.slice(0, 4).map(b => h('i', { class: 'st-' + slugStatus(b.status) + (editOn(b, iso) ? ' edit' : '') })))));
  }

  // The next date that matters for a booking: its shoot, or, once the shoot is over, its next edit day.
  const nextOf = b => (endOf(b) >= today ? b.date : (editDaysOf(b).find(d => d.date >= today) || {}).date || b.date);
  const upcoming = db.bookings.filter(b => (endOf(b) >= today || editDaysOf(b).some(d => d.date >= today)) && b.status !== 'Cancelled')
    .sort((a, b) => (nextOf(a) + (a.start || '')).localeCompare(nextOf(b) + (b.start || ''))).slice(0, 4);

  return h('div', { class: 'bk-month' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Bookings'),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => pickTemplate(t => editBooking(applyTemplateDefaults(blankBooking(today), t), go)) }, '📐 From template'), h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(today), go) }, '+ New'))),
    // The tools for every shoot as a grid of even tiles: three to a row on a phone, all five on a wider screen.
    h('div', { class: 'subactions bk-tiles' }, ...[['🗂', 'Pipeline', () => openPipeline(b => go({ view: 'booking', id: b.id, day: b.date }))], ['📋', 'Call sheets', () => openCallSheets(b => go({ view: 'callsheet', id: b.id, day: b.date }))], ['💰', 'Money', () => openMoney(b => go({ view: 'money', id: b.id, kind: b.invoice && !b.quote ? 'invoice' : 'quote', day: b.date }))], ['📊', 'Hours & statistics', () => openHoursSheet()], ['📆', 'Calendar & email', openCalendarSheet]]
      .map(([ico, label, onclick]) => h('button', { class: 'btn ghost small tile', onclick }, h('span', { class: 'tile-ico', 'aria-hidden': 'true' }, ico), h('span', { class: 'tile-label' }, label)))),
    // A booking someone shared (their "Share with crew" link), pasted or scanned: for the desktop and iPhone apps, which a link cannot open.
    h('div', { class: 'subactions bk-add-link' }, h('button', { class: 'btn ghost small', title: 'Add a booking someone shared with you from Vdex', onclick: () => import('../share-add.js').then(m => m.openAddFromLink()).catch(e => toast('Could not open that: ' + (e.message || e))) }, '🔗 Add from a link')),
    // The calendar in a frame of its own, apart from the list of what is next.
    h('section', { class: 'cal-panel box-dark', 'aria-label': 'Calendar' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go({ cursor: new Date(y, m - 1, 1) }) }, '‹'),
        h('div', { class: 'cal-title' }, new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        h('button', { class: 'btn ghost small', onclick: () => go({ cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }) }, 'Today'),
        h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go({ cursor: new Date(y, m + 1, 1) }) }, '›')),
      h('div', { class: 'cal' },
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => h('div', { class: 'wd' }, w)), cells)),
    h('h3', null, 'Next up'),
    upcoming.length
      ? h('div', { class: 'list' }, upcoming.map(b => bookingCard(b, () => go({ view: 'booking', id: b.id, day: nextOf(b) }), true, endOf(b) >= today ? null : nextOf(b))))
      : empty('Nothing upcoming. Tap a date or “+ New” to add a booking.'));
}

// A booking in a list. On a day view the day is given, so an edit day says so and shows its own times.
// Press and hold a booking (its card in a list, or its header on its own page) for three seconds: a sheet offers to
// delete it. The ordinary way, Edit then Delete, stays for keyboards.
const HOLD_MS = 3000;
function deleteSheet(b) {
  const { close } = sheet('Delete this booking?', h('div', { class: 'stack' },
    h('p', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [dateRange(b, fmtShort), b.client].filter(Boolean).join(' · '))),
    h('p', { class: 'small muted' }, 'Its call sheet, stripboard, shot list, budget, quote and invoice go with it, and it leaves your calendar and your cloud copy. Hours logged on it stay in your statistics, unassigned. This cannot be undone.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn danger', onclick: () => { close(); if (remove('bookings', b.id) !== false) { toast('Booking deleted'); haptic(30); } } }, '🗑 Delete booking'),
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Keep it'))));
}
const holdToDelete = (el, b) => { hold(el, HOLD_MS, () => { haptic(20); deleteSheet(byId('bookings', b.id) || b); }); return el; };
function bookingCard(b, onclick, showDate, day = null) {
  const ed = day && !covers(b, day) ? editDaysOf(b).find(d => d.date === day) : null;
  const card = h('button', { class: 'card tap', type: 'button', title: 'Tap to open; press and hold to delete', onclick: e => { if (!wasHeld(card)) onclick(e); } },
    h('div', { class: 'card-row' },
      h('div', null,
        h('strong', null, b.title),
        h('div', { class: 'muted' }, [ed ? `✂ Edit day${ed.start ? ' · ' + ed.start + (ed.end ? '–' + ed.end : '') : ''}` : [(showDate || endOf(b) > b.date) && dateRange(b, fmtShort), b.start && `${b.start}${b.end ? '–' + b.end : ''}`].filter(Boolean).join(' · '), b.client].filter(Boolean).join(' · '))),
      h('span', { class: 'pills' }, ed && h('span', { class: 'pill edit' }, 'Edit day'), pill(b.status))),
    b.address && h('div', { class: 'muted small' }, '📍 ' + b.address.split('\n')[0]),
    h('div', { class: 'muted small' }, `🎥 ${(b.gear || []).length} items · 👥 ${(b.crew || []).length + hiredPeople(b).length} crew`));
  return holdToDelete(card, b);
}

/* -------------------------------- day -------------------------------- */
const sunText = (iso, b) => { const loc = locationFor(b || null); if (!loc) return ''; const t = getTimes(new Date(parseISO(iso).getTime() + 12 * 36e5), loc.lat, loc.lon); return `☀ Rise ${fmtTime(t.sunrise)} · Set ${fmtTime(t.sunset)} · Golden hour ${fmtTime(t.goldenHour)}`; };
function sunLine(iso, b) {
  const loc = locationFor(b || null);
  if (!loc) return null;
  return [h('div', { class: 'sunline muted' }, sunText(iso, b)), forecastLine(loc, iso)];
}
// The day's weather and sun on a booking: a card that fills itself in once the forecast arrives.
const dayCard = b => forecastCard(locationFor(b), b.date, { sun: sunText(b.date, b), when: fmtLong(b.date) });

function day(go) {
  const list = bookingsOn(S.day);
  const d = parseISO(S.day);
  const shift = n => go({ day: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) });
  return h('div', null,
    h('div', { class: 'page-head' },
      backBtn('Calendar', () => go({ view: 'month', cursor: new Date(d.getFullYear(), d.getMonth(), 1) })),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => pickTemplate(t => editBooking(applyTemplateDefaults(blankBooking(S.day), t), go)) }, '📐 From template'), h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(S.day), go) }, '+ New'))),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => shift(-1) }, '‹'),
      h('div', { class: 'cal-title' }, fmtLong(S.day)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => shift(1) }, '›')),
    sunLine(S.day),
    list.length
      ? h('div', { class: 'list' }, list.map(b => bookingCard(b, () => go({ view: 'booking', id: b.id }), false, S.day)))
      : empty('No bookings on this day.', h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(S.day), go) }, 'Add one')));
}

/* ------------------------------- detail ------------------------------- */
// Long lists fold after five: the rest shows on "Show all", and the choice survives the redraw every change causes.
const SHOW = new Set();
function fold(key, items, render, stay, limit = 5) {
  const open = SHOW.has(key) || items.length <= limit;
  return [render(open ? items : items.slice(0, limit)),
    items.length > limit && h('div', { class: 'actions fold-more' }, open
      ? h('button', { class: 'btn ghost small', 'data-fk': key, onclick: () => { SHOW.delete(key); stay(); } }, 'Show fewer')
      : h('button', { class: 'btn ghost small', 'data-fk': key, onclick: () => { SHOW.add(key); stay(); } }, `Show all (${items.length})`))];
}

function detail(go) {
  const b = byId('bookings', S.id);
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean);
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const gearGroups = groupBy(gear, g => g.category || 'Other');
  const total = gear.reduce((s, g) => s + (Number(g.value) || 0) * usedQty(b, g.id), 0);
  const units = gear.reduce((s, g) => s + usedQty(b, g.id), 0);
  const clashes = gear.filter(g => gearClash(b, g.id).length);
  const stay = () => { const y = window.scrollY; go({}); window.scrollTo(0, y); }; // redraw without jumping to the top
  const here = onDay(b, S.day) ? S.day : b.date, ed = editDaysOf(b);
  const actions = {
    crew: () => document.getElementById('bk-crew')?.scrollIntoView({ block: 'start' }), venue: () => (b.venueId ? openVenue(b.venueId) : window.logiGo('venues')), insurance: () => window.logiGo('insurance'),
    hires: () => document.getElementById('bk-hires')?.scrollIntoView({ block: 'start' }), shots: () => document.getElementById('bk-shots')?.scrollIntoView({ block: 'start' }), tcnotes: () => window.logiGo('tcnotes'),
    callsheet: () => go({ view: 'callsheet', id: b.id }), quote: () => go({ view: 'money', id: b.id, kind: 'quote' }), invoice: () => go({ view: 'money', id: b.id, kind: 'invoice' }), kit: () => document.getElementById('bk-kit')?.scrollIntoView({ block: 'start' }), field: () => window.logiGo('field'), media: () => document.getElementById('bk-media')?.scrollIntoView({ block: 'start' }),
    hours: () => openHoursSheet(b.id), licences: () => document.getElementById('bk-licences')?.scrollIntoView({ block: 'start' }), deliverables: () => document.getElementById('bk-deliverables')?.scrollIntoView({ block: 'start' }),
  };

  return h('div', { class: 'bk-detail' },
    h('div', { class: 'page-head' },
      backBtn(fmtShort(here), () => go({ view: 'day', day: here })),
      h('button', { class: 'btn ghost', onclick: () => editBooking(b, go) }, 'Edit')),
    holdToDelete(h('div', { class: 'card hero', title: 'Press and hold to delete this booking' },
      h('div', { class: 'card-row' }, h('h2', null, b.title), pill(b.status)),
      h('div', { class: 'muted' }, [dateRange(b, fmtLong), b.start && `${b.start}${b.end ? ' – ' + b.end : ''}`, typeLabel(b.type)].filter(Boolean).join(' · ')),
      ed.length > 0 && h('div', { class: 'small edit-days' }, '✂ Edit days: ' + ed.map(editDayText).join(', ')),
      b.shared && b.shared.at && h('div', { class: 'muted small shared-by' }, `🔗 ${b.shared.by ? 'Shared by ' + b.shared.by : 'Added from a shared link'} · ${b.shared.updated ? 'updated ' + new Date(b.shared.updated).toLocaleDateString() : 'added ' + new Date(b.shared.at).toLocaleDateString()}`), // js/share-import.js
      (b.stakeholders || []).some(s => s.email) && h('div', { class: 'muted small' }, '✉ ' + b.stakeholders.filter(s => s.email).map(s => s.email).join(', ')),
      b.client && h('div', null, '🏢 ', b.client),
      b.address && h('div', null, '📍 ', h('a', { href: mapsUrl(b.address.replace(/\n/g, ', ')), target: '_blank', rel: 'noopener' }, b.address)),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => openAddToCalendar(b) }, '📆 Add to calendar'), h('button', { class: 'btn ghost small', title: 'Shares the dates and times as a calendar file (.ics), not the project itself', onclick: () => shareBooking(b) }, '📤 Share calendar event'), h('a', { class: 'btn ghost small', href: mailtoLink(b) }, '✉ Email'))), b),
    // The booking's tools, right under its summary: three boxes, then the hours, then the day's weather and sun.
    h('div', { class: 'actions bk-tools' }, h('button', { class: 'btn ghost small', onclick: () => go({ view: 'callsheet', id: b.id }) }, `📋 Call sheet${{ none: '', draft: ' · draft', sent: ' · sent ✅', changed: ' · changed ⚠' }[sheetState(b)]}`),
      h('button', { class: 'btn ghost small sb-open', onclick: () => go({ view: 'strips', id: b.id }) }, `🎬 Stripboard & shot list${sceneCount(b) ? ` · ${sceneCount(b)} scene${sceneCount(b) === 1 ? '' : 's'}` : ''}`),
      h('button', { class: 'btn ghost small', onclick: () => import('../crew-link.js').then(m => m.openCrewShare(b)).catch(e => toast('Could not open sharing: ' + (e.message || e))) }, '👥 Share with crew')),
    hoursBlock(b),
    h('div', { class: 'actions bk-tools-more' },
      h('button', { class: 'btn ghost small', onclick: () => saveBookingAsTemplate(b, t => t && toast(`Saved as the “${t.name}” template`)) }, '📐 Save as template'),
      templateById(b.type) && h('button', { class: 'btn ghost small', onclick: () => { const n = applyTemplateExtras(b.id, templateById(b.type)); toast(n ? `${n} item${n === 1 ? '' : 's'} added from the template` : 'Nothing missing from the template'); } }, '↻ Apply template items')),
    dayCard(b),
    workFold(b, go, actions),
    venueBlock(b, gear),
    h('section', { class: 'block', id: 'bk-people' }, h('h3', null, 'People'),
      h('div', { class: 'sub', id: 'bk-stakeholders' }, h('h4', null, `Stakeholders (${(b.stakeholders || []).length})`),
        (b.stakeholders || []).length
          ? h('div', { class: 'list' }, b.stakeholders.map(s => h('div', { class: 'card-row card' },
            h('div', null, h('strong', null, s.name || '—'), h('div', { class: 'muted' }, s.role || '')),
            s.phone && h('a', { class: 'btn ghost small', href: telUrl(s.phone) }, '📞 ' + s.phone))))
          : h('p', { class: 'muted small' }, 'No stakeholders added: Edit the booking to add the client’s contacts.')),
      h('div', { class: 'sub', id: 'bk-crew' }, h('h4', null, `Crew (${crew.length})`),
        crew.length ? fold(`${b.id}:crew`, crew, list => h('div', { class: 'list' }, list.map(c => crewRow(b, c))), stay) : h('p', { class: 'muted small' }, 'No crew assigned: Edit the booking to add people from your Crew page.')),
      hiresBlock(b)),
    shotsSection(b, go),
    h('section', { class: 'block', id: 'bk-kit' }, h('h3', null, `Equipment (${units})`), [
      (b.kits || []).length > 0 && h('div', { class: 'muted small' }, 'Kits: ' + b.kits.map(id => byId('kits', id)?.name).filter(Boolean).join(', ')),
      clashes.length > 0 && h('div', { class: 'warn' }, `⚠ ${clashes.length} item${clashes.length > 1 ? 's are' : ' is'} also booked on another job that overlaps these dates.`),
      gear.length
        ? fold(`${b.id}:gear`, [...gearGroups].flatMap(([cat, items]) => items.map(g => [cat, g])), shown => [...groupBy(shown, x => x[0])].map(([cat, items]) => h('div', { class: 'gear-group' }, h('h4', null, cat),
          items.map(([, g]) => {
            const c = gearClash(b, g.id);
            return h('div', { class: 'card-row gear-line' + (c.length ? ' clash' : '') },
              h('span', null, g.name, usedQty(b, g.id) > 1 && h('b', { class: 'qty' }, ` ×${usedQty(b, g.id)}`), c.length > 0 && h('em', { class: 'clash-note' }, ' ⚠ also on: ' + c.map(x => x.title).join(', '))),
              h('span', { class: 'muted' }, [g.location && '📍 ' + g.location, g.serial].filter(Boolean).join(' · ')));
          }))), stay)
        : h('p', { class: 'muted' }, 'No equipment selected.'),
      gear.length > 0 && h('div', { class: 'muted small' }, `Kit value on this shoot: ${(db.profile.currency || '$')}${total.toLocaleString()}`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => window.logiGo(2) }, 'Open equipment list →'),
        gear.length > 0 && h('button', { class: 'btn ghost small', onclick: () => editKit({ name: b.title, description: '', gear: b.gear, gearQty: b.gearQty || {}, notes: '' }) }, '＋ Save as kit')),
      rentalsBlock(b),
    ]),
    h('div', { id: 'bk-media' }, mediaBlock(b)),
    h('div', { id: 'bk-deliverables' }, deliverablesBlock(b)),
    h('div', { id: 'bk-licences', class: 'block' }, licencesBlock(b)),
    b.notes && section('Notes', h('p', { class: 'prewrap' }, b.notes)));
}

// Workflow, budget, quote and invoice in one fold-down. Closed, its line says where the money and the project stand;
// it stays open across the redraw every tick causes, per booking.
const WORK_OPEN = new Set();
function workFold(b, go, actions) {
  const q = docOf(b, 'quote'), inv = docOf(b, 'invoice'), est = budgetTotals(b).est;
  const cur = STAGES.some(s => s[0] === b.status) ? b.status : 'Enquiry', pr = progress(b, cur);
  const parts = [
    `Budget ${est ? fmtMoney(est) : 'none yet'}`,
    q ? `Quote ${fmtMoney(totals(q, 'quote').total)} ${(q.status || 'Draft').toLowerCase()}` : 'No quote',
    inv ? `Invoice ${fmtMoney(totals(inv).total)} ${isOverdue(b) ? 'overdue' : inv.status === 'Sent' ? 'unpaid' : (inv.status || 'Draft').toLowerCase()}` : 'No invoice',
    b.status === 'Cancelled' ? 'Cancelled' : `${cur} ${pr.done}/${pr.total}`,
  ];
  const el = h('details', { class: 'twirl bk-work', id: 'bk-work', open: WORK_OPEN.has(b.id) },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '📋'), h('span', null, h('span', { class: 'twirl-name' }, 'Workflow, budget, quote & invoice'), h('span', { class: 'twirl-sub' }, parts.join(' · ')))),
    h('div', { class: 'twirl-body' }, workflowBlock(b, actions), budgetBlock(b), moneyBlock(b, go))); // not .stack: that would stretch every button inside to the full width
  el.addEventListener('toggle', () => { if (el.open) WORK_OPEN.add(b.id); else WORK_OPEN.delete(b.id); });
  return el;
}

// The stripboard's state and the shot list, together. After a shot-list import the board asks to be checked.
function shotsSection(b, go) {
  const plan = boardPlan(b), n = plan.scenes.length, r = b.shotImportReview;
  const line = n ? `${n} scene${n === 1 ? '' : 's'} · ${fmtPages(plan.eighths)} · ${plan.days.length} shooting day${plan.days.length === 1 ? '' : 's'}${plan.unscheduled ? ` · ${plan.unscheduled} not scheduled yet` : ''}` : 'No scenes yet: import a shot list or the script, or add scenes on the board.';
  return h('section', { class: 'block', id: 'bk-shots' }, h('h3', null, 'Stripboard & shot list'),
    h('div', { class: 'card stack' },
      h('div', { class: 'card-row' }, h('div', null, h('strong', null, 'Stripboard'), h('div', { class: 'muted small' }, line)), h('button', { class: 'btn ghost small sb-open2', onclick: () => go({ view: 'strips', id: b.id }) }, 'Open the board →')),
      r && h('div', { class: 'warn small review-note' }, `⚠ ${r.scenes} scene${r.scenes === 1 ? '' : 's'} came from the shot list imported on ${new Date(r.at).toLocaleDateString()}: check the scene numbers, interior or exterior and time of day (guessed where the heading left them out) and the page counts (set to 1/8: a shot list has no pages). `,
        h('button', { class: 'btn ghost small', onclick: () => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { delete x.shotImportReview; x.updatedAt = Date.now(); } }) }, 'Checked'))),
    shotsBlock(b));
}
const fmtPages = e => (e > 0 ? `${fmtEighths(e)} ${e === 8 ? 'page' : 'pages'}` : '0 pages');

function hoursBlock(b) {
  const shifts = db.shifts.filter(s => s.bookingId === b.id);
  const st = stats(shifts), edit = shifts.filter(s => kindOf(s) === 'edit'), shoot = shifts.filter(s => kindOf(s) !== 'edit');
  const split = edit.length && shoot.length ? ` · ${fmtHm(stats(shoot).worked)} on shoot days, ${fmtHm(stats(edit).worked)} editing` : edit.length ? ' · all editing' : '';
  // The clock itself (Start work, Stop work, breaks) sits here; while it runs a strip under the Rolodex repeats it on every page.
  return h('section', { class: 'block', id: 'bk-hours' }, h('h3', null, 'Hours'),
    h('div', { class: 'card box-dark' },
      clockCard(b),
      shifts.length
        ? h('div', { class: 'card-row' }, h('div', null, h('strong', null, fmtHm(st.worked)), h('div', { class: 'muted small' }, `${st.days} day${st.days === 1 ? '' : 's'} · breaks ${fmtHm(st.breaks)}${st.overtime ? ' · overtime ' + fmtHm(st.overtime) : ''}${split}`)))
        : h('p', { class: 'muted small' }, 'Nothing clocked yet. Start work here on the day; on an edit day, or any day that is not a shoot day, the hours count as editing.'),
      h('div', { class: 'muted small' }, `Approved break: ${b.breakMinutes != null && b.breakMinutes !== '' ? b.breakMinutes + ' min' : defaultBreak() + ' min (default)'}${b.breakNote ? ' · ' + b.breakNote : ''}`),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => openHoursSheet(b.id) }, '📊 Hours & statistics'), h('button', { class: 'btn ghost small', onclick: () => editShift(null, b.id) }, '+ Add hours'))));
}

function venueBlock(b, gear) {
  const v = b.venueId && byId('venues', b.venueId);
  if (!v) return null;
  const warns = venueWarnings(v, gear);
  return h('section', { class: 'block', id: 'bk-venue' }, h('h3', null, 'Venue'),
    h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('strong', null, v.name), h('button', { class: 'btn ghost small', onclick: () => openVenue(v.id) }, 'Rules & details →')),
      warns.map(w => h('div', { class: 'warn' }, '⚠ ' + w.text)),
      venueChips(v),
      (v.rules || '').trim() && h('div', { class: 'muted small prewrap' }, v.rules.split('\n').slice(0, 3).join('\n')),
      v.access && h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Access: '), v.access),
      mapButtons(v)));
}

const section = (title, ...kids) => h('section', { class: 'block' }, h('h3', null, title), ...kids);

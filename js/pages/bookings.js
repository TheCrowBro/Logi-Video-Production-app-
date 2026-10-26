import { h, pad, ymd, todayISO, parseISO, fmtLong, fmtShort, fmtTime, groupBy, mapsUrl, telUrl, empty, uid } from '../util.js';
import { db, byId, bookingsOn, gearClash, upsert, remove, endOf, covers, qtyOf, usedQty } from '../store.js';
import { openForm } from '../form.js';
import { editKit } from './gear.js';
import { venueWarnings, openVenue, chips as venueChips } from './venues.js';
import { mapButtons } from '../map.js';
import { getTimes } from '../suncalc.js';

const STATUSES = ['Enquiry', 'Confirmed', 'Shot', 'Delivered', 'Cancelled'];
const S = { view: 'month', cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1), day: todayISO(), id: null };

const dateRange = (b, f) => endOf(b) > b.date ? `${f(b.date)} → ${f(endOf(b))}` : f(b.date);
const pill = s => h('span', { class: 'pill st-' + s.toLowerCase() }, s);

export const bookings = {
  id: 'bookings', label: 'Bookings', icon: '📅',
  render(root) {
    const go = patch => { Object.assign(S, patch); draw(); window.scrollTo({ top: 0 }); };
    const draw = () => {
      if (S.view === 'booking' && !byId('bookings', S.id)) S.view = 'day';
      root.replaceChildren(S.view === 'month' ? month(go) : S.view === 'day' ? day(go) : detail(go));
    };
    draw();
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
      { key: 'date', label: 'Start date', type: 'date', required: true },
      { key: 'endDate', label: 'End date (multi-day)', type: 'date', hint: 'Leave blank for a single day.' },
      { key: 'status', label: 'Status', type: 'select', options: STATUSES },
      { key: 'start', label: 'Start', type: 'time' },
      { key: 'end', label: 'Finish', type: 'time' },
      ...(db.venues.length ? [{ key: 'venueId', label: 'Venue', type: 'select', options: [['', 'No saved venue'], ...db.venues.map(v => [v.id, v.name])], hint: 'Fills in the address and checks your equipment against the venue’s rules.' }] : []),
      { key: 'address', label: 'Location / address', type: 'textarea', rows: 2 },
      { key: 'stakeholders', label: 'Stakeholders & contacts', type: 'rows', columns: [{ key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'phone', label: 'Phone', type: 'tel' }] },
      { key: 'crew', label: 'Crew', type: 'checks', options: db.crew.map(c => ({ value: c.id, label: c.name, hint: c.role })), empty: 'Add people on the Crew page first.' },
      ...(db.kits.length ? [{ key: 'kits', label: 'Kits', type: 'checks', hint: 'Ticking a kit adds its equipment below. You can still adjust the list.', options: db.kits.map(k => ({ value: k.id, label: k.name, hint: `${(k.gear || []).length} items`, adds: { gear: k.gear || [] }, addsQty: k.gearQty || {} })) }] : []),
      { key: 'gear', qtyKey: 'gearQty', label: 'Equipment', type: 'checks', options: db.gear.map(g => ({ value: g.id, label: g.name, group: g.category || 'Other', qtyMax: qtyOf(g), hint: qtyOf(g) > 1 ? `(${qtyOf(g)} owned)` : '' })).sort((a, b) => a.group.localeCompare(b.group)), empty: 'Add kit on the Equipment page first.' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => {
      const item = { ...v, id: v.id || uid() };
      if (!item.endDate || item.endDate <= item.date) delete item.endDate;
      if (!item.venueId) delete item.venueId;
      else if (!(item.address || '').trim()) item.address = byId('venues', item.venueId)?.address || '';
      item.gearQty = Object.fromEntries(Object.entries(item.gearQty || {}).filter(([id]) => (item.gear || []).includes(id)));
      upsert('bookings', item);
      go({ view: 'booking', id: item.id, day: item.date, cursor: new Date(parseISO(item.date).getFullYear(), parseISO(item.date).getMonth(), 1) });
    },
    onDelete: isNew ? null : () => { remove('bookings', b.id); go({ view: 'day' }); },
  });
}

const blankBooking = date => ({ title: '', client: '', date, endDate: '', status: 'Enquiry', start: '', end: '', address: '', stakeholders: [], crew: [], gear: [], notes: '' });

/* ------------------------------- month ------------------------------- */
function month(go) {
  const y = S.cursor.getFullYear(), m = S.cursor.getMonth();
  const prefix = `${y}-${pad(m + 1)}-`;
  const byDay = new Map();
  for (const b of db.bookings) for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) { const iso = prefix + pad(d); if (covers(b, iso)) { if (!byDay.has(iso)) byDay.set(iso, []); byDay.get(iso).push(b); } }
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // Monday first
  const total = new Date(y, m + 1, 0).getDate();
  const today = todayISO();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'day blank' }));
  for (let d = 1; d <= total; d++) {
    const iso = prefix + pad(d);
    const list = (byDay.get(iso) || []).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    cells.push(h('button', {
      class: 'day' + (iso === today ? ' today' : '') + (list.length ? ' has' : ''), type: 'button',
      'aria-label': `${fmtLong(iso)}, ${list.length} booking${list.length === 1 ? '' : 's'}`,
      onclick: () => go({ view: 'day', day: iso }),
    },
      h('span', { class: 'num' }, d),
      list.slice(0, 2).map(b => h('span', { class: 'mini st-' + b.status.toLowerCase() }, b.title)),
      list.length > 2 && h('span', { class: 'more' }, `+${list.length - 2}`),
      list.length > 0 && h('span', { class: 'dots' }, list.slice(0, 4).map(b => h('i', { class: 'st-' + b.status.toLowerCase() })))));
  }

  const upcoming = db.bookings.filter(b => endOf(b) >= today && b.status !== 'Cancelled')
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''))).slice(0, 4);

  return h('div', null,
    h('div', { class: 'page-head' },
      h('h1', null, 'Bookings'),
      h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(today), go) }, '+ New')),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go({ cursor: new Date(y, m - 1, 1) }) }, '‹'),
      h('div', { class: 'cal-title' }, new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('button', { class: 'btn ghost small', onclick: () => go({ cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }) }, 'Today'),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => go({ cursor: new Date(y, m + 1, 1) }) }, '›')),
    h('div', { class: 'cal' },
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => h('div', { class: 'wd' }, w)), cells),
    h('h3', null, 'Next up'),
    upcoming.length
      ? h('div', { class: 'list' }, upcoming.map(b => bookingCard(b, () => go({ view: 'booking', id: b.id, day: b.date }), true)))
      : empty('Nothing upcoming. Tap a date or “+ New” to add a booking.'));
}

function bookingCard(b, onclick, showDate) {
  return h('button', { class: 'card tap', type: 'button', onclick },
    h('div', { class: 'card-row' },
      h('div', null,
        h('strong', null, b.title),
        h('div', { class: 'muted' }, [(showDate || endOf(b) > b.date) && dateRange(b, fmtShort), b.start && `${b.start}${b.end ? '–' + b.end : ''}`, b.client].filter(Boolean).join(' · '))),
      pill(b.status)),
    b.address && h('div', { class: 'muted small' }, '📍 ' + b.address.split('\n')[0]),
    h('div', { class: 'muted small' }, `🎥 ${(b.gear || []).length} items · 👥 ${(b.crew || []).length} crew`));
}

/* -------------------------------- day -------------------------------- */
function sunLine(iso) {
  let loc; try { loc = JSON.parse(localStorage.getItem('logi-loc')); } catch { /* none */ }
  if (!loc) return null;
  const t = getTimes(new Date(parseISO(iso).getTime() + 12 * 36e5), loc.lat, loc.lon);
  return h('div', { class: 'sunline muted' }, `☀ Rise ${fmtTime(t.sunrise)} · Set ${fmtTime(t.sunset)} · Golden hour ${fmtTime(t.goldenHour)}`);
}

function day(go) {
  const list = bookingsOn(S.day);
  const d = parseISO(S.day);
  const shift = n => go({ day: ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) });
  return h('div', null,
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => go({ view: 'month', cursor: new Date(d.getFullYear(), d.getMonth(), 1) }) }, '‹ Calendar'),
      h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(S.day), go) }, '+ New')),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => shift(-1) }, '‹'),
      h('div', { class: 'cal-title' }, fmtLong(S.day)),
      h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => shift(1) }, '›')),
    sunLine(S.day),
    list.length
      ? h('div', { class: 'list' }, list.map(b => bookingCard(b, () => go({ view: 'booking', id: b.id }))))
      : empty('No bookings on this day.', h('button', { class: 'btn primary', onclick: () => editBooking(blankBooking(S.day), go) }, 'Add one')));
}

/* ------------------------------- detail ------------------------------- */
function detail(go) {
  const b = byId('bookings', S.id);
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean);
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const gearGroups = groupBy(gear, g => g.category || 'Other');
  const total = gear.reduce((s, g) => s + (Number(g.value) || 0) * usedQty(b, g.id), 0);
  const units = gear.reduce((s, g) => s + usedQty(b, g.id), 0);
  const clashes = gear.filter(g => gearClash(b, g.id).length);

  return h('div', null,
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => go({ view: 'day', day: covers(b, S.day) ? S.day : b.date }) }, '‹ ' + fmtShort(covers(b, S.day) ? S.day : b.date)),
      h('button', { class: 'btn ghost', onclick: () => editBooking(b, go) }, 'Edit')),
    h('div', { class: 'card hero' },
      h('div', { class: 'card-row' }, h('h2', null, b.title), pill(b.status)),
      h('div', { class: 'muted' }, [dateRange(b, fmtLong), b.start && `${b.start}${b.end ? ' – ' + b.end : ''}`].filter(Boolean).join(' · ')),
      b.client && h('div', null, '🏢 ', b.client),
      b.address && h('div', null, '📍 ', h('a', { href: mapsUrl(b.address.replace(/\n/g, ', ')), target: '_blank', rel: 'noopener' }, b.address))),
    venueBlock(b, gear),
    sunLine(b.date),
    section('Stakeholders', (b.stakeholders || []).length
      ? h('div', { class: 'list' }, b.stakeholders.map(s => h('div', { class: 'card-row card' },
        h('div', null, h('strong', null, s.name || '—'), h('div', { class: 'muted' }, s.role || '')),
        s.phone && h('a', { class: 'btn ghost small', href: telUrl(s.phone) }, '📞 ' + s.phone))))
      : h('p', { class: 'muted' }, 'No stakeholders added.')),
    section(`Crew (${crew.length})`, crew.length
      ? h('div', { class: 'list' }, crew.map(c => h('div', { class: 'card-row card' },
        h('div', null, h('strong', null, c.name), h('div', { class: 'muted' }, c.role || '')),
        c.phone && h('a', { class: 'btn ghost small', href: telUrl(c.phone) }, '📞 ' + c.phone))))
      : h('p', { class: 'muted' }, 'No crew assigned.')),
    section(`Equipment (${units})`, [
      (b.kits || []).length > 0 && h('div', { class: 'muted small' }, 'Kits: ' + b.kits.map(id => byId('kits', id)?.name).filter(Boolean).join(', ')),
      clashes.length > 0 && h('div', { class: 'warn' }, `⚠ ${clashes.length} item${clashes.length > 1 ? 's are' : ' is'} also booked on another job that overlaps these dates.`),
      gear.length
        ? [...gearGroups].map(([cat, items]) => h('div', { class: 'gear-group' }, h('h4', null, cat),
          items.map(g => {
            const c = gearClash(b, g.id);
            return h('div', { class: 'card-row gear-line' + (c.length ? ' clash' : '') },
              h('span', null, g.name, usedQty(b, g.id) > 1 && h('b', { class: 'qty' }, ` ×${usedQty(b, g.id)}`), c.length > 0 && h('em', { class: 'clash-note' }, ' ⚠ also on: ' + c.map(x => x.title).join(', '))),
              h('span', { class: 'muted' }, g.serial || ''));
          })))
        : h('p', { class: 'muted' }, 'No equipment selected.'),
      gear.length > 0 && h('div', { class: 'muted small' }, `Kit value on this shoot: ${(db.profile.currency || '$')}${total.toLocaleString()}`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost small', onclick: () => window.logiGo(2) }, 'Open equipment list →'),
        gear.length > 0 && h('button', { class: 'btn ghost small', onclick: () => editKit({ name: b.title, description: '', gear: b.gear, gearQty: b.gearQty || {}, notes: '' }) }, '＋ Save as kit')),
    ]),
    b.notes && section('Notes', h('p', { class: 'prewrap' }, b.notes)));
}

function venueBlock(b, gear) {
  const v = b.venueId && byId('venues', b.venueId);
  if (!v) return null;
  const warns = venueWarnings(v, gear);
  return h('section', { class: 'block' }, h('h3', null, 'Venue'),
    h('div', { class: 'card' },
      h('div', { class: 'card-row' }, h('strong', null, v.name), h('button', { class: 'btn ghost small', onclick: () => openVenue(v.id) }, 'Rules & details →')),
      warns.map(w => h('div', { class: 'warn' }, '⚠ ' + w.text)),
      venueChips(v),
      (v.rules || '').trim() && h('div', { class: 'muted small prewrap' }, v.rules.split('\n').slice(0, 3).join('\n')),
      v.access && h('div', { class: 'small' }, h('span', { class: 'muted' }, 'Access: '), v.access),
      mapButtons(v)));
}

const section = (title, ...kids) => h('section', { class: 'block' }, h('h3', null, title), ...kids);

import { h, empty, fmtShort, safeUrl, telUrl, parseISO, daysUntil } from '../util.js';
import { db, byId, upsert, remove, activeBookings, endOf } from '../store.js';
import { openForm } from '../form.js';
import { miniMap, mapButtons, hasGeo } from '../map.js';

export const PERMS = [
  ['tripods', 'Tripods & stands'], ['lighting', 'Film lighting'], ['flash', 'Flash / strobes'], ['haze', 'Haze / smoke'],
  ['drones', 'Drones'], ['generators', 'Generators'], ['dollies', 'Dollies & track'], ['audio', 'Music / PA playback'], ['pyro', 'Open flame / pyro'],
];
export const TYPES = ['Studio', 'Office / corporate', 'Residential', 'Outdoor / public space', 'Venue / event hall', 'Hotel', 'Warehouse / industrial', 'Retail / restaurant', 'Other'];
const PERM_LABEL = { allowed: 'Allowed', ask: 'Needs approval', no: 'Not allowed' };
const PERM_ICON = { allowed: '✓', ask: '?', no: '✕' };
const S = { view: 'list', id: null, q: '' };

// Which of your equipment categories each venue permission governs.
const CATEGORY_PERM = { Drone: 'drones', Lighting: 'lighting', Support: 'tripods', Power: 'generators' };

// Warnings for a booking: gear categories the venue restricts.
export function venueWarnings(venue, gearItems) {
  const out = [];
  const seen = new Set();
  for (const g of gearItems) {
    const key = CATEGORY_PERM[g.category];
    const level = key && venue.perms && venue.perms[key];
    if (!level || level === 'allowed' || seen.has(key)) continue;
    seen.add(key);
    const label = PERMS.find(p => p[0] === key)[1];
    out.push({ level, text: `${label}: ${PERM_LABEL[level].toLowerCase()} at ${venue.name} (your booking includes ${g.category.toLowerCase()} gear)` });
  }
  return out;
}

export function openVenue(id) { S.view = 'detail'; S.id = id; window.logiGo(3); }

export function editVenue(v = {}, afterSave) {
  openForm({
    title: v.id ? 'Edit venue' : 'Add venue',
    values: { permit: 'Unknown', ...v },
    fields: [
      { key: 'name', label: 'Venue name', required: true },
      { key: 'type', label: 'Type', list: TYPES },
      { key: 'address', label: 'Address', type: 'textarea', rows: 2 },
      { key: 'geo', label: 'Map location', type: 'place', hint: 'Used for the map preview and directions.' },
      { key: 'mapLink', label: 'Saved map link (optional)', type: 'url', placeholder: 'Pin you have already saved' },
      { key: 'contact', label: 'Venue contact' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'perms', label: 'Equipment rules', type: 'matrix', items: PERMS },
      { key: 'rules', label: 'Other rules & restrictions', type: 'textarea', rows: 4, placeholder: 'e.g. No filming in the lobby after 6pm. Floor protection required.' },
      { key: 'permit', label: 'Filming permit', type: 'select', options: ['Unknown', 'Not needed', 'Required'] },
      { key: 'permitNotes', label: 'Permit / insurance requirements', type: 'textarea', rows: 2, placeholder: 'e.g. £5m public liability, certificate 7 days ahead' },
      { key: 'access', label: 'Access & hours', type: 'textarea', rows: 2, placeholder: 'e.g. Load-in 7am via rear gate, quiet after 9pm' },
      { key: 'parking', label: 'Parking & loading' },
      { key: 'power', label: 'Power available' },
      { key: 'checked', label: 'Rules last confirmed', type: 'date', hint: 'Set the date you last checked these rules with the venue.' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: val => { const item = { ...val, id: val.id || undefined }; upsert('venues', item); afterSave && afterSave(); },
    onDelete: v.id ? () => { remove('venues', v.id); S.view = 'list'; afterSave && afterSave(); } : null,
  });
}

export const chips = v => {
  const set = PERMS.filter(([k]) => v.perms && v.perms[k]);
  return set.length ? h('div', { class: 'perm-chips' }, set.map(([k, l]) => h('span', { class: 'perm perm-' + v.perms[k], title: PERM_LABEL[v.perms[k]] }, h('b', { 'aria-hidden': 'true' }, PERM_ICON[v.perms[k]]), ' ', l, h('span', { class: 'sr-only' }, ': ' + PERM_LABEL[v.perms[k]])))) : null;
};

export const venues = {
  id: 'venues', label: 'Venues', icon: '📍',
  render(root) {
    const go = patch => { Object.assign(S, patch); draw(); window.scrollTo({ top: 0 }); };
    const draw = () => {
      if (S.view === 'detail' && !byId('venues', S.id)) S.view = 'list';
      root.replaceChildren(S.view === 'list' ? list(go, draw) : detail(go, draw));
    };
    draw();
  },
};

function list(go, draw) {
  const q = S.q.toLowerCase();
  const items = db.venues.filter(v => !q || `${v.name} ${v.address} ${v.type}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  return h('div', null,
    h('div', { class: 'page-head' }, h('h1', null, 'Venues'), h('button', { class: 'btn primary', onclick: () => editVenue({}, draw) }, '+ Add')),
    db.venues.length > 4 && h('input', { class: 'search', type: 'search', placeholder: 'Search venues…', value: S.q, 'aria-label': 'Search venues', oninput: e => { S.q = e.target.value; draw(); const i = document.querySelector('.search'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); } }),
    items.length
      ? h('div', { class: 'list' }, items.map(v => h('div', { class: 'card venue-card' },
        h('button', { class: 'card-main', type: 'button', onclick: () => go({ view: 'detail', id: v.id }) },
          h('strong', null, v.name),
          h('div', { class: 'muted small' }, [v.type, v.address && v.address.split('\n')[0]].filter(Boolean).join(' · ')),
          chips(v),
          staleNote(v)),
        mapButtons(v))))
      : empty(db.venues.length ? 'No matches.' : 'Save the places you shoot with their rules, contacts and map pin, so you can check before you arrive.', db.venues.length ? null : h('button', { class: 'btn primary', onclick: () => editVenue({}, draw) }, 'Add a venue')));
}

function staleNote(v) {
  if (!v.checked) return null;
  const age = -daysUntil(v.checked);
  return h('div', { class: 'muted small' + (age > 180 ? ' stale' : '') }, `Rules confirmed ${parseISO(v.checked).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}${age > 180 ? ' · worth re-checking' : ''}`);
}

function detail(go, draw) {
  const v = byId('venues', S.id);
  const today = new Date().toISOString().slice(0, 10);
  const mine = activeBookings().filter(b => b.venueId === v.id && endOf(b) >= today).sort((a, b) => a.date.localeCompare(b.date));
  const row = (k, val) => val ? h('div', null, h('span', { class: 'muted' }, k), h('span', { class: 'v' }, val)) : null;
  return h('div', null,
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => go({ view: 'list' }) }, '‹ Venues'),
      h('button', { class: 'btn ghost', onclick: () => editVenue(v, draw) }, 'Edit')),
    h('div', { class: 'card hero' }, h('h2', null, v.name), h('div', { class: 'muted' }, v.type || ''), v.address && h('div', { class: 'prewrap' }, '📍 ' + v.address)),
    miniMap(v),
    hasGeo(v.geo) || v.address ? mapButtons(v) : h('p', { class: 'muted small' }, 'Add an address or map location to get directions.'),
    v.perms && Object.keys(v.perms).length > 0 && block('Equipment rules', chips(v)),
    (v.rules || '').trim() && block('Rules & restrictions', h('p', { class: 'prewrap' }, v.rules)),
    (v.permit && v.permit !== 'Unknown') || v.permitNotes
      ? block('Permits & insurance', h('div', { class: 'kv card' }, row('Permit', v.permit && v.permit !== 'Unknown' ? v.permit : ''), v.permitNotes && h('p', { class: 'prewrap' }, v.permitNotes)))
      : null,
    block('Access & logistics', h('div', { class: 'kv card' }, row('Access', v.access), row('Parking', v.parking), row('Power', v.power),
      !v.access && !v.parking && !v.power && h('span', { class: 'muted' }, 'Nothing recorded yet.'))),
    (v.contact || v.phone || v.email) && block('Contact', h('div', { class: 'card' },
      v.contact && h('strong', null, v.contact),
      h('div', { class: 'actions' }, v.phone && h('a', { class: 'btn ghost small', href: telUrl(v.phone) }, '📞 ' + v.phone), v.email && h('a', { class: 'btn ghost small', href: 'mailto:' + v.email }, '✉ ' + v.email)))),
    v.notes && block('Notes', h('p', { class: 'prewrap' }, v.notes)),
    staleNote(v),
    block('Upcoming shoots here', mine.length
      ? h('div', { class: 'list' }, mine.map(b => h('div', { class: 'card-row card' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, fmtShort(b.date))))))
      : h('p', { class: 'muted' }, 'None booked. Choose this venue when you create a booking.')));
}
const block = (t, ...k) => h('section', { class: 'block' }, h('h3', null, t), ...k);

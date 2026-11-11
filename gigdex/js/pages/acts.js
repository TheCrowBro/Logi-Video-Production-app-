// Acts: the bands and artists the person plays in, manages or produces. The list of acts, and one act's page in three
// parts: Overview (links, contact, bookings coming up, members, songs), Press kit (a one-page EPK and a big QR code for
// the merch desk) and Tech rider (input list, stage plot, riders, printed for the sound engineer). The documents live in
// js/acts-docs.js, the rider editors in js/acts-rider.js.
import { h, empty, backBtn, telUrl, toast, sheet, fmtShort, daysUntil, todayISO, parseISO } from '../util.js';
import { db, byId, upsert, update, remove, upcoming, redraw } from '../store.js';
import { venueOf, kindIcon, kindLabel, statusLabel, statusTone, firstTime, PEOPLE_GROUPS, setlistLength, fmtDur } from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { openBooking, newBooking } from './bookings.js';
import { parseLinks, ACT_COLORS, colorOf, stripeStyle, roleOf, membersOf, initials, plural, qrTarget, fillQr, epkDoc, printEpk, saveEpk,
  inputTable, inputRows, dupChannels, saveInputCsv, plotOf, saveRider, printRider as printRiderDoc } from '../acts-docs.js';
import { openInputList, openRiders, stagePlot } from '../acts-rider.js';

// View state survives the redraw after every change: which act is open, which part of it, the search.
const S = { view: 'list', id: null, tab: 'about', q: '', allBk: false };
const people = fn => import('./people.js').then(fn).catch(e => { console.error(e); toast('People could not be opened.'); });
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
const toTop = () => setTimeout(() => window.scrollTo(0, 0), 0);
const focusSoon = sel => setTimeout(() => { const el = document.querySelector(sel); if (el) el.focus({ preventScroll: true }); }, 0);
const GENRES = ['Indie rock', 'Rock', 'Pop', 'Alt R&B', 'R&B / Soul', 'Hip-hop', 'Electronic', 'Dance', 'Jazz', 'Folk', 'Country', 'Americana',
  'Singer-songwriter', 'Metal', 'Punk', 'Blues', 'Funk', 'Reggae', 'Latin', 'Classical', 'World', 'Gospel', 'Covers band', 'Function / wedding band'];

/* ------------------------------- the shared API ------------------------------- */
// Go to Acts and show this act. Resolves once it is drawn.
export function openAct(id) {
  if (!byId('acts', id)) { toast('That act is no longer in Acts.'); return Promise.resolve(); }
  Object.assign(S, { view: 'act', id, tab: 'about', allBk: false });
  return Promise.resolve(window.logiGo ? window.logiGo('acts') : null).then(() => { redraw(); toTop(); focusSoon('.ac-view .back-btn'); });
}

// The act's form. A new act gets the next colour no other act uses. onSaved(record) after a save.
const FORM_KEYS = ['name', 'genre', 'color', 'bio', 'links', 'email', 'phone', 'notes'];
export function editAct(a = {}, onSaved) {
  const cur = (a && a.id && byId('acts', a.id)) || a || {};
  const isNew = !cur.id;
  const colors = ACT_COLORS.slice();
  if (cur.color && !colors.some(c => c[0] === cur.color)) colors.push([cur.color, 'Its own colour']);
  const used = new Set(db.acts.map(x => x.color));
  const fresh = (ACT_COLORS.find(([c]) => c && !used.has(c)) || ACT_COLORS[1])[0];
  openForm({
    title: isNew ? 'New act' : 'Edit act',
    values: { ...cur, color: isNew && cur.color == null ? fresh : colorOf(cur) || cur.color || '' },
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'Band or artist name' },
      { key: 'genre', label: 'Genre', list: GENRES, placeholder: 'e.g. Indie rock' },
      { key: 'color', label: 'Colour', type: 'select', options: colors, hint: 'The stripe on the act’s cards.' },
      { key: 'email', label: 'Email', type: 'email', placeholder: 'band@…' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'links', label: 'Links', type: 'textarea', rows: 4, placeholder: 'Website: https://…\nSpotify: https://…\nInstagram: https://…', hint: 'One per line: a name, a colon, then the address. The first one is the QR code on the press kit.' },
      { key: 'bio', label: 'Bio', type: 'textarea', rows: 5, placeholder: 'Two or three sentences for promoters and press: who you are, what you sound like, where you’ve played.' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3, placeholder: 'Only you see these.' },
    ],
    saveLabel: isNew ? 'Add act' : 'Save',
    onSave: v => {
      const latest = (cur.id && byId('acts', cur.id)) || {};
      if (cur.id && !latest.id) return toast('That act was deleted meanwhile.');
      const fields = Object.fromEntries(FORM_KEYS.map(k => [k, typeof v[k] === 'string' ? v[k].trim() : (v[k] ?? '')]));
      if (!fields.name) fields.name = latest.name || 'Untitled act';
      const rec = upsert('acts', { members: [], inputList: [], stagePlot: [], riderTech: '', riderHospitality: '', ...cur, ...latest, ...fields });
      toast(isNew ? `${rec.name} added` : 'Saved');
      if (onSaved) onSaved(rec);
    },
    onDelete: isNew ? null : () => deleteAct(cur.id, true),
  });
}
export const printRider = actId => printRiderDoc(actId);

function deleteAct(id, confirmed = false) {
  const a = byId('acts', id);
  if (!a) return;
  if (!confirmed) {
    const nb = db.bookings.filter(b => b.actId === id).length, ns = db.songs.filter(s => s.actId === id).length, nl = db.setlists.filter(s => s.actId === id).length;
    const kept = [nb && plural(nb, 'booking'), ns && plural(ns, 'song'), nl && plural(nl, 'setlist')].filter(Boolean);
    const list = kept.length > 1 ? kept.slice(0, -1).join(', ') + ' and ' + kept[kept.length - 1] : kept[0];
    if (!confirm(`Delete ${a.name || 'this act'}?${list ? ` Its ${list} stay, without an act.` : ''} Its members stay in People.`)) return;
  }
  if (S.id === id) Object.assign(S, { view: 'list', id: null });
  remove('acts', id);
  toast(`${a.name || 'Act'} deleted`);
  toTop();
}

/* ------------------------------- the list ------------------------------- */
const newAct = () => editAct({}, rec => openAct(rec.id));
const nextOf = a => upcoming().find(b => b.actId === a.id) || null;
function whenText(b) {
  const t = todayISO();
  if (b.date <= t && t <= (b.endDate || b.date) && b.date !== t) return 'On now';
  const n = daysUntil(b.date);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtShort(b.date);
}
const whereText = b => { const v = venueOf(b).name; return v ? `${kindLabel(b.kind)} at ${v}` : kindLabel(b.kind); };

function actCard(a) {
  const next = nextOf(a), n = membersOf(a).length, songs = db.songs.filter(s => s.actId === a.id).length;
  return h('button', { type: 'button', class: 'card tap ac-card', style: stripeStyle(a), 'data-id': a.id, onclick: () => openAct(a.id) },
    h('span', { class: 'ac-card-name' }, a.name || 'Untitled act'),
    h('span', { class: 'ac-card-sub muted' }, [a.genre, n ? plural(n, 'member') : 'No members yet', songs > 0 && plural(songs, 'song')].filter(Boolean).join(' · ')),
    h('span', { class: 'ac-card-next small' + (next ? '' : ' muted') }, next ? [kindIcon(next.kind), ' Next: ', h('b', null, whenText(next)), ' · ', whereText(next)] : 'Nothing booked yet'));
}
function listView() {
  const all = [...db.acts].sort(byName);
  const listBox = h('div', { class: 'list ac-list' });
  const fill = () => {
    const q = all.length > 5 ? S.q.trim().toLowerCase() : ''; // no search box, no filter
    const shown = q ? all.filter(a => [a.name, a.genre, ...membersOf(a).map(p => p.name)].join(' ').toLowerCase().includes(q)) : all;
    listBox.replaceChildren(...(shown.length ? shown.map(actCard) : [h('p', { class: 'muted ac-nomatch' }, `No act matches “${S.q.trim()}”.`)]));
  };
  if (all.length) fill();
  return h('div', { class: 'ac-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Acts'), h('button', { type: 'button', class: 'btn primary', id: 'ac-new', onclick: newAct }, '+ New act')),
    all.length > 5 && h('input', { class: 'search', id: 'ac-search', type: 'search', placeholder: 'Search acts, genres, members…', 'aria-label': 'Search acts', value: S.q, autocomplete: 'off', oninput: e => { S.q = e.target.value; fill(); } }),
    all.length ? listBox : empty('An act is a band or artist you play in, manage or produce. Each one keeps its members, links, press kit and tech rider, and its shows and songs point back to it.',
      h('button', { type: 'button', class: 'btn primary', id: 'ac-new-empty', onclick: newAct }, '+ New act')));
}

/* ------------------------------- one act ------------------------------- */
const TABS = [['about', 'Overview'], ['epk', 'Press kit'], ['rider', 'Tech rider']];
const setTab = t => { if (S.tab !== t) { S.tab = t; redraw(); } };
function back() { Object.assign(S, { view: 'list', id: null }); redraw(); toTop(); focusSoon('#ac-new'); }

function hero(a) {
  const links = parseLinks(a.links), n = membersOf(a).length;
  return h('div', { class: 'card ac-hero', style: stripeStyle(a) },
    h('h1', { class: 'ac-title' }, a.name || 'Untitled act'),
    h('div', { class: 'muted' }, [a.genre, n ? plural(n, 'member') : 'No members yet'].filter(Boolean).join(' · ')),
    links.length > 0 && h('div', { class: 'actions ac-links', role: 'list', 'aria-label': 'Links' }, links.map(l =>
      h('a', { class: 'btn ghost small', role: 'listitem', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url, 'aria-label': `${l.label} (opens ${l.url})` }, h('span', { 'aria-hidden': 'true' }, l.icon), ' ' + l.label))),
    (a.email || a.phone) && h('div', { class: 'actions ac-contact' },
      a.email && h('a', { class: 'btn ghost small', href: 'mailto:' + a.email, 'aria-label': 'Email ' + a.email }, '✉ ', h('span', { class: 'ac-addr' }, a.email)),
      a.phone && h('a', { class: 'btn ghost small', href: telUrl(a.phone), 'aria-label': 'Call ' + a.phone }, '📞 ', h('span', { class: 'ac-addr' }, a.phone))),
    !links.length && !a.email && !a.phone && h('p', { class: 'small muted ac-hint' }, 'No links or contact yet. ✎ Edit adds them: they make the buttons here, the press kit and its QR code.'));
}

function actView(a) {
  return h('div', { class: 'ac-view' + (S.tab === 'rider' ? ' ac-view-rider' : '') },
    h('div', { class: 'page-head' }, backBtn('All acts', back), h('button', { type: 'button', class: 'btn ghost', id: 'ac-edit', 'aria-label': `Edit ${a.name || 'act'}`, onclick: () => editAct(a) }, '✎ Edit')),
    hero(a),
    h('div', { class: 'seg wide ac-tabs', role: 'tablist', 'aria-label': 'Parts of the act' }, TABS.map(([id, label]) =>
      h('button', { type: 'button', role: 'tab', id: 'ac-tab-' + id, class: S.tab === id ? 'on' : '', 'aria-selected': String(S.tab === id), onclick: () => setTab(id) }, label))),
    h('div', { role: 'tabpanel', 'aria-labelledby': 'ac-tab-' + S.tab, class: 'ac-panel' },
      S.tab === 'epk' ? epkTab(a) : S.tab === 'rider' ? riderTab(a) : aboutTab(a)));
}

/* Overview */
// On the act's own page the act's name would open every line, so a booking leads with its own title or its venue.
function bookingRow(b) {
  const d = parseISO(b.date), t = firstTime(b), v = venueOf(b).name, kind = kindLabel(b.kind);
  const main = b.title || v || kind;
  return h('button', { type: 'button', class: 'card tap ac-bk', onclick: () => openBooking(b.id) },
    h('span', { class: 'ac-bk-date', 'aria-hidden': 'true' },
      h('span', null, d.toLocaleDateString(undefined, { weekday: 'short' })), h('b', null, String(d.getDate())), h('span', null, d.toLocaleDateString(undefined, { month: 'short' }))),
    h('span', { class: 'ac-bk-main' },
      h('span', { class: 'sr-only' }, fmtShort(b.date) + (b.endDate && b.endDate > b.date ? ' to ' + fmtShort(b.endDate) : '') + ': '),
      h('strong', null, main === kind ? `${kindIcon(b.kind)} ${kind}` : main),
      h('span', { class: 'muted small' }, [main !== kind && `${kindIcon(b.kind)} ${kind}`, b.title && v, !v && 'Venue to be confirmed', t, b.endDate && b.endDate > b.date && 'until ' + fmtShort(b.endDate)].filter(Boolean).join(' · '))),
    h('span', { class: 'pill ' + statusTone(b.status) }, statusLabel(b.status)));
}
function aboutTab(a) {
  const coming = upcoming().filter(b => b.actId === a.id);
  const shown = S.allBk ? coming : coming.slice(0, 4);
  const members = membersOf(a), emails = members.map(p => String(p.email || '').trim()).filter(Boolean);
  const songs = db.songs.filter(s => s.actId === a.id), sets = db.setlists.filter(s => s.actId === a.id);
  return h('div', { class: 'ac-cols ac-about' },
    h('section', { class: 'ac-sec', id: 'ac-coming', 'aria-labelledby': 'ac-h-coming' },
      h('h3', { id: 'ac-h-coming' }, 'Coming up'),
      coming.length ? h('div', { class: 'list ac-bks' }, shown.map(bookingRow)) : h('p', { class: 'muted ac-none' }, 'Nothing booked for this act yet.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary small', id: 'ac-book', onclick: () => newBooking({ kind: 'show', actId: a.id }) }, '+ Book a show'),
        coming.length > 4 && h('button', { type: 'button', class: 'btn ghost small', id: 'ac-allbk', 'aria-expanded': String(S.allBk), onclick: () => { S.allBk = !S.allBk; redraw(); } }, S.allBk ? 'Show fewer' : `Show all ${coming.length}`))),
    h('section', { class: 'ac-sec', id: 'ac-members', 'aria-labelledby': 'ac-h-members' },
      h('h3', { id: 'ac-h-members' }, 'Members'),
      members.length ? h('div', { class: 'ac-mlist' }, members.map(p => h('div', { class: 'card ac-member' },
        h('button', { type: 'button', class: 'ac-member-main', 'aria-label': `${p.name}${roleOf(p) ? ', ' + roleOf(p) : ''}: open their card`, onclick: () => people(m => m.openPerson(p.id)) },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.name)),
          h('span', { class: 'ac-member-text' }, h('strong', null, p.name), roleOf(p) && h('span', { class: 'muted small' }, roleOf(p)))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take ${p.name} out of ${a.name}`, onclick: () => removeMember(a.id, p.id) }, '✕'))))
        : h('p', { class: 'muted ac-none' }, 'No members yet. Add the people who play in this act: they come from People.'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'ac-addm', onclick: () => openAddMembers(a.id) }, '+ Add member'),
        emails.length > 1 && h('a', { class: 'btn ghost small', id: 'ac-mailband', href: `mailto:${emails.join(',')}?subject=${encodeURIComponent(a.name || '')}` }, '✉ Email the band'))),
    h('section', { class: 'ac-sec', id: 'ac-songs', 'aria-labelledby': 'ac-h-songs' },
      h('h3', { id: 'ac-h-songs' }, 'Songs & setlists'),
      h('button', { type: 'button', class: 'card tap ac-songs-card', id: 'ac-open-songs', onclick: () => window.logiGo && window.logiGo('songs') },
        h('span', { class: 'ac-counts' }, h('span', null, h('b', null, String(songs.length)), songs.length === 1 ? ' song' : ' songs'), h('span', null, h('b', null, String(sets.length)), sets.length === 1 ? ' setlist' : ' setlists')),
        sets.slice(0, 3).map(s => { const l = setlistLength(s); return h('span', { class: 'small ac-setline' }, `🗒 ${s.name || 'Setlist'} · ${plural(l.songs, 'song')}${l.sec ? ' · ' + fmtDur(l.sec) : ''}`); }),
        h('span', { class: 'small muted' }, songs.length || sets.length ? 'Open Songs →' : 'Add songs and setlists in Songs →'))),
    h('section', { class: 'ac-sec', id: 'ac-bio', 'aria-labelledby': 'ac-h-bio' },
      h('h3', { id: 'ac-h-bio' }, 'Bio'),
      a.bio ? h('p', { class: 'prewrap ac-text' }, a.bio) : h('p', { class: 'muted ac-none' }, 'No bio yet. A few lines for promoters and press go on the press kit: ✎ Edit to add them.')),
    a.notes && h('section', { class: 'ac-sec', id: 'ac-notes', 'aria-labelledby': 'ac-h-notes' }, h('h3', { id: 'ac-h-notes' }, 'Notes'), h('p', { class: 'prewrap ac-text' }, a.notes)),
    h('div', { class: 'ac-sec ac-danger' }, h('button', { type: 'button', class: 'btn danger small', id: 'ac-delete', onclick: () => deleteAct(a.id) }, 'Delete this act')));
}

function removeMember(actId, personId) {
  const a = byId('acts', actId), p = byId('people', personId);
  if (!a) return;
  if (!confirm(`Take ${p ? p.name : 'this person'} out of ${a.name}? They stay in People.`)) return;
  update(d => { const x = d.acts.find(r => r.id === actId); if (!x) return; x.members = (x.members || []).filter(id => id !== personId); x.updatedAt = Date.now(); });
  toast(`${p ? p.name : 'Member'} taken out of ${a.name}`);
}
function addMember(actId, personId) {
  let added = false;
  update(d => { const x = d.acts.find(r => r.id === actId); if (!x || (x.members || []).includes(personId)) return; x.members = [...(x.members || []), personId]; x.updatedAt = Date.now(); added = true; });
  return added;
}

// Pick people to add, or make a new person. Each tap adds one; the sheet stays open for the next.
function openAddMembers(actId) {
  const a0 = byId('acts', actId);
  if (!a0) return;
  let q = '';
  const intro = h('p', { class: 'small muted' });
  const listBox = h('div', { class: 'ac-addm-list' });
  const search = db.people.length > 8 && h('input', { class: 'search', type: 'search', id: 'ac-addm-q', placeholder: 'Search people…', 'aria-label': 'Search people', autocomplete: 'off', oninput: e => { q = e.target.value; draw(); } });
  const draw = (focusAt = -1) => {
    const a = byId('acts', actId);
    if (!a) { close(); return; }
    const inAct = new Set(a.members || []);
    const free = db.people.filter(p => !inAct.has(p.id)).sort(byName);
    const ql = q.trim().toLowerCase();
    const shown = ql ? free.filter(p => [p.name, p.role, p.instrument, p.company].join(' ').toLowerCase().includes(ql)) : free;
    intro.textContent = `Tap someone to add them to ${a.name}. People live in the People section; an act lists who plays in it.`;
    const groups = [...PEOPLE_GROUPS, ['', 'Others']].map(([g, label]) => [label, shown.filter(p => (g ? p.group === g : !PEOPLE_GROUPS.some(([k]) => k === p.group)))]).filter(([, ps]) => ps.length);
    listBox.replaceChildren(...(shown.length ? groups.map(([label, ps]) => h('div', { class: 'ac-addm-group' }, h('h4', null, label), ps.map(p =>
      h('button', { type: 'button', class: 'card tap ac-addm-item', id: 'ac-addm-' + p.id, 'aria-label': `Add ${p.name}${roleOf(p) ? ' (' + roleOf(p) + ')' : ''} to ${a.name}`, onclick: () => pick(p) },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.name)),
        h('span', { class: 'ac-member-text' }, h('strong', null, p.name), roleOf(p) && h('span', { class: 'muted small' }, roleOf(p))),
        h('span', { class: 'ac-addm-plus', 'aria-hidden': 'true' }, '＋')))))
      : [h('p', { class: 'muted ac-none' }, ql && free.length ? `No one matches “${q.trim()}”.` : db.people.length ? 'Everyone in People is already in this act.' : 'No one in People yet. Add a new person.')]));
    if (focusAt >= 0) { const items = listBox.querySelectorAll('.ac-addm-item'); (items[Math.min(focusAt, items.length - 1)] || search || body.querySelector('#ac-addm-done')).focus(); }
  };
  const pick = p => {
    const items = [...listBox.querySelectorAll('.ac-addm-item')], at = items.findIndex(el => el.id === 'ac-addm-' + p.id);
    if (addMember(actId, p.id)) toast(`${p.name} added to ${(byId('acts', actId) || a0).name}`);
    draw(Math.max(0, at));
  };
  const newPerson = () => people(m => m.editPerson({ group: 'band' }, rec => {
    if (rec && rec.id && addMember(actId, rec.id)) toast(`${rec.name} added to ${(byId('acts', actId) || a0).name}`);
    draw();
  }));
  const body = h('div', { class: 'stack ac-addm' }, intro,
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', id: 'ac-addm-new', onclick: newPerson }, '+ New person')),
    search, listBox,
    h('div', { class: 'form-actions' }, h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn primary', id: 'ac-addm-done', onclick: () => close() }, 'Done')));
  draw();
  const { close } = sheet('Add members', body);
}

/* Press kit */
function showBigQr(a) {
  const t = qrTarget(a);
  if (!t) return;
  const box = h('div', { class: 'qr ac-qr-full', role: 'img', 'aria-label': 'QR code: ' + t.caption }, 'Making the code…');
  fillQr(box, t.text);
  sheet('QR code', h('div', { class: 'stack ac-qr-sheet' },
    h('h2', { class: 'ac-qr-name' }, a.name || 'Untitled act'), box,
    h('p', { class: 'qr-cap muted' }, t.caption),
    h('p', { class: 'small muted' }, 'Turn the screen brightness up and hold the phone still: it scans from about an arm’s length.')));
}
function epkTab(a) {
  const t = qrTarget(a), links = parseLinks(a.links);
  const qrBox = h('div', { class: 'qr ac-qr', role: 'img', 'aria-label': t ? 'QR code: ' + t.caption : 'No QR code yet' }, t ? 'Making the code…' : 'Add a link, an email or a phone number to make a QR code.');
  if (t) fillQr(qrBox, t.text);
  const doc = epkDoc(a);
  const slot = doc.querySelector('.ac-doc-qr-svg');
  if (slot && t) fillQr(slot, t.text);
  const missing = [!a.bio && 'a bio', !links.length && 'links', !(a.email || a.phone) && 'a contact', !membersOf(a).length && 'the members'].filter(Boolean);
  return h('div', { class: 'ac-epk-wrap' },
    h('section', { class: 'card ac-qr-card', 'aria-labelledby': 'ac-h-qr' },
      h('h3', { id: 'ac-h-qr' }, 'At the merch desk'),
      qrBox,
      h('div', { class: 'qr-cap muted' }, t ? t.caption : 'The QR code holds the first link, or the act’s contact card when there is no link.'),
      h('div', { class: 'actions center' },
        t && h('button', { type: 'button', class: 'btn primary', id: 'ac-qr-big', onclick: () => showBigQr(a) }, '⛶ Show it big'),
        !t && h('button', { type: 'button', class: 'btn ghost', id: 'ac-qr-edit', onclick: () => editAct(a) }, '✎ Add a link'))),
    h('section', { class: 'ac-epk', 'aria-labelledby': 'ac-h-epk' },
      h('h3', { id: 'ac-h-epk' }, 'Press kit'),
      h('p', { class: 'small muted' }, 'One page for promoters, venues and press, made from the act’s details. Print it, or save it as a web page to email or post.'),
      missing.length > 0 && h('p', { class: 'small ac-missing' }, `Worth adding: ${missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0]}.`),
      h('div', { class: 'cs-paper ac-paper' }, doc),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', id: 'ac-epk-print', onclick: () => printEpk(a.id) }, '🖨 Print'),
        h('button', { type: 'button', class: 'btn ghost', id: 'ac-epk-save', onclick: () => saveEpk(a.id) }, '⤓ Save as a web page'),
        h('button', { type: 'button', class: 'btn ghost', id: 'ac-epk-edit', onclick: () => editAct(a) }, '✎ Edit details'))));
}

/* Tech rider */
function riderTab(a) {
  const n = inputRows(a).length, dups = dupChannels(a), table = inputTable(a);
  return h('div', { class: 'ac-cols ac-rider' },
    h('section', { class: 'ac-sec', id: 'ac-inputs', 'aria-labelledby': 'ac-h-inputs' },
      h('h3', { id: 'ac-h-inputs' }, n ? `Input list · ${plural(n, 'input')}` : 'Input list'),
      table ? h('div', { class: 'ac-in-wrap' }, table) : h('p', { class: 'muted ac-none' }, 'No input list yet. Start from a preset (rock band, duo with tracks, solo acoustic) and change what differs.'),
      dups.length > 0 && h('div', { class: 'warn' }, `Channel${dups.length === 1 ? '' : 's'} ${dups.join(', ')} ${dups.length === 1 ? 'is' : 'are'} on the list twice. Renumber in the editor puts them in order.`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary small', id: 'ac-in-edit', onclick: () => openInputList(a.id) }, n ? '✎ Edit input list' : '+ Make the input list'),
        n > 0 && h('button', { type: 'button', class: 'btn ghost small', id: 'ac-in-csv', onclick: () => saveInputCsv(a.id) }, '⤓ CSV for the desk'))),
    h('section', { class: 'ac-sec', id: 'ac-plot', 'aria-labelledby': 'ac-h-plot' },
      h('h3', { id: 'ac-h-plot' }, 'Stage plot'),
      stagePlot(a)),
    h('section', { class: 'ac-sec', id: 'ac-riders', 'aria-labelledby': 'ac-h-riders' },
      h('h3', { id: 'ac-h-riders' }, 'Riders'),
      h('div', { class: 'ac-rider-texts' },
        h('div', { class: 'card ac-rider-text' }, h('h4', null, 'Technical rider'), a.riderTech ? h('p', { class: 'prewrap' }, a.riderTech) : h('p', { class: 'muted' }, 'Monitor mixes, risers, backline, power, changeover time…')),
        h('div', { class: 'card ac-rider-text' }, h('h4', null, 'Hospitality rider'), a.riderHospitality ? h('p', { class: 'prewrap' }, a.riderHospitality) : h('p', { class: 'muted' }, 'Water, towels, food, drinks, a dressing room…'))),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost small', id: 'ac-riders-edit', onclick: () => openRiders(a.id) }, '✎ Edit riders'))),
    h('div', { class: 'ac-sec ac-rider-out' },
      h('p', { class: 'small muted' }, `The tech rider prints the input list, ${plotOf(a).length ? 'the stage plot, ' : ''}the riders and the contact on plain paper for the sound engineer.`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary', id: 'ac-print-rider', onclick: () => printRider(a.id) }, '🖨 Print the tech rider'),
        h('button', { type: 'button', class: 'btn ghost', id: 'ac-save-rider', onclick: () => saveRider(a.id) }, '⤓ Save as a web page'))));
}

/* ------------------------------- the page ------------------------------- */
const listSteps = () => [
  { title: 'Acts', text: 'The bands and artists you play in, manage or produce. Each keeps its members, links, press kit and tech rider; bookings and songs point back to it.', target: ['.ac-page .page-head'] },
  { title: 'Add an act', text: 'A name, a genre, a colour for its stripe, a contact, and its links, one per line like “Spotify: https://…”.', target: ['#ac-new'] },
  { title: 'Your acts', text: 'Each card shows the genre, the members, the songs and the next booking. Tap one for everything else.', target: ['.ac-card', '.ac-page .empty'] },
  { title: 'Search', text: 'Find an act by its name, genre or a member’s name.', target: ['#ac-search'] },
];
const actSteps = () => [
  { title: 'The act', text: 'Name, genre and members, with its links as buttons and its contact. ✎ Edit changes them.', target: ['.ac-hero'], before: () => setTab('about') },
  { title: 'Three parts', text: 'Overview for bookings and members, Press kit for promoters and fans, Tech rider for the sound engineer.', target: ['.ac-tabs'] },
  { title: 'Coming up', text: 'This act’s bookings from today on. Tap one to open it, or book a new show for the act.', target: ['#ac-coming'] },
  { title: 'Members', text: 'People from the People section. Add someone already there or a new person; ✕ takes them out of the act (they stay in People).', target: ['#ac-members'] },
  { title: 'Songs & setlists', text: 'How many songs and setlists the act has. Tap to open Songs.', target: ['#ac-songs'] },
  { title: 'Press kit', text: 'A one-page press kit from the act’s details: bio, links, line-up, confirmed shows and contact. Print it, or save it as a web page to send.', target: ['.ac-epk'], before: () => setTab('epk') },
  { title: 'QR code', text: 'The act’s first link (or its contact card) as a QR code. Show it big at the merch desk so people can scan it.', target: ['.ac-qr-card'] },
  { title: 'Input list', text: 'Every channel for the sound engineer: source, mic or DI, stand. Start from a preset and change what differs.', target: ['#ac-inputs'], before: () => setTab('rider') },
  { title: 'Stage plot', text: 'Who and what stands where, the audience at the bottom. Drag the labels; add players and gear from the chips.', target: ['#ac-plot'] },
  { title: 'Riders', text: 'The technical and hospitality riders, as text.', target: ['#ac-riders'] },
  { title: 'Print the tech rider', text: 'Input list, stage plot, riders and contact on one document to print or send ahead of the show.', target: ['#ac-print-rider'] },
];

export const acts = {
  id: 'acts', label: 'Acts', icon: '🎸',
  render(root) {
    const a = S.view === 'act' ? byId('acts', S.id) : null;
    if (S.view === 'act' && !a) Object.assign(S, { view: 'list', id: null }); // deleted elsewhere
    if (!TABS.some(([id]) => id === S.tab)) S.tab = 'about';
    root.append(a ? actView(a) : listView());
  },
  tutorial: () => (S.view === 'act' && byId('acts', S.id) ? actSteps() : listSteps()),
};

const formSteps = [
  { title: 'Name', text: 'The band or artist name, as it goes on posters and the press kit.', target: ['input[data-key=name]'] },
  { title: 'Colour', text: 'The stripe on the act’s cards, so its bookings and songs are quick to tell apart.', target: ['select[id$="-color"]'] },
  { title: 'Links', text: 'One per line: a name, a colon, the address. They become buttons on the act, lines on the press kit, and the first one is its QR code.', target: ['textarea[data-key=links]'] },
  { title: 'Bio', text: 'Two or three sentences for promoters and press. It heads the press kit.', target: ['textarea[data-key=bio]'] },
];
sheetTutorial('New act', formSteps);
sheetTutorial('Edit act', formSteps);
sheetTutorial('Add members', [
  { title: 'Add members', text: 'Tap someone to add them to the act. Each tap adds one, and the sheet stays open for the next.', target: ['.ac-addm-list'] },
  { title: 'Someone new', text: 'Makes a person in People and adds them to this act in one go.', target: ['#ac-addm-new'] },
]);
sheetTutorial('QR code', [
  { title: 'Show it big', text: 'Hold the phone up at the merch desk: people scan it to follow the act or save its contact.', target: ['.ac-qr-full'] },
]);

// People: the band, the session players and crew you hire, and the promoters, agents and labels you deal with.
// A card per person (role, instruments, company, their acts, their next booking) with quick call / text / email; a
// sheet with everything else (acts, upcoming bookings, usual rate, the gear they own, notes); "Ask if they're free"
// for a booking (a text or email with the when and where, never the money); and their contact card as a QR code or a
// .vcf file. Act membership lives on the act (act.members); the form here can change it too.
import { h, nodes, empty, toast, sheet, telUrl, fmtShort, parseISO, todayISO } from '../util.js';
import { db, upsert, update, remove, byId, subscribe, personBookings, personClash, activeBookings, lastDay, upcoming, totalValue } from '../store.js';
import { PEOPLE_GROUPS, ROLES, PERSON_RATE_UNITS, kindIcon, bookingTitle, actName, venueOf, statusLabel, statusTone, fmtMoney, fmtMin } from '../model.js';
import { openForm } from '../form.js';
import { qrSvg, loadQR } from '../qr.js';
import { saveFile, fileName } from '../print.js';
import { sheetTutorial } from '../tour.js';

/* ------------------------------- small helpers ------------------------------- */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_IDS = PEOPLE_GROUPS.map(g => g[0]);
const groupOf = p => (GROUP_IDS.includes(p && p.group) ? p.group : '');
const groupLabel = g => (PEOPLE_GROUPS.find(x => x[0] === g) || ['', 'Not sorted yet'])[1];
const ONE = { band: 'Band member', session: 'Session player', crew: 'Crew', contact: 'Industry contact' };
const SHORT = { band: 'Band', session: 'Session', crew: 'Crew', contact: 'Contacts' }; // the filter chips, so all fit a phone
const unitLabel = u => (PERSON_RATE_UNITS.find(x => x[0] === u) || PERSON_RATE_UNITS[0])[1];
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
const nameOf = p => String((p && p.name) || '').trim() || 'No name';
const firstName = p => String((p && p.name) || '').trim().split(/\s+/)[0] || 'there';
const initials = name => { const w = String(name || '').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? [w[0], w[w.length - 1]] : w).map(x => [...x][0]).join('').toUpperCase() || '?'; };
const phoneOf = p => (p && /\d/.test(p.phone || '') ? telUrl(p.phone).slice(4) : '');
const emailOf = p => { const e = String((p && p.email) || '').trim().replace(/[\s<>"]/g, ''); return e.includes('@') ? e : ''; };
const smsUrl = (tel, body) => 'sms:' + tel + (body ? '?&body=' + encodeURIComponent(body) : '');
const mailUrl = (to, subject, body) => 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
const okColor = c => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '');
const actsOf = id => db.acts.filter(a => (a.members || []).includes(id)).sort(byName);
const today = () => todayISO();
// store.personBookings, but a booking still without a date (half made, or from an old backup) cannot break the page.
const bookingsOf = id => { try { return personBookings(id); } catch { return activeBookings().filter(b => (b.people || []).includes(id)).sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))); } };
const upcomingFor = id => bookingsOf(id).filter(b => ISO.test(b.date || '') && lastDay(b) >= today());
const pastFor = id => bookingsOf(id).filter(b => ISO.test(b.date || '') && lastDay(b) < today()).reverse();
// Bookings where this person is the promoter / client / studio contact (matched by email, else by name).
const asContact = p => {
  const mail = emailOf(p).toLowerCase(), name = String(p.name || '').trim().toLowerCase();
  return upcoming().filter(b => b.contact && !(b.people || []).includes(p.id) && ((mail && String(b.contact.email || '').trim().toLowerCase() === mail) || (!mail && name && String(b.contact.name || '').trim().toLowerCase() === name)));
};
// The rate as people say it: "$180 per day". '' when none is set.
const rateText = p => (p && p.rate !== '' && p.rate != null && Number.isFinite(Number(p.rate)) ? (Number(p.rate) > 0 ? `${fmtMoney(Number(p.rate))} ${unitLabel(p.rateUnit)}` : 'No fee') : '');
const dateText = b => (!ISO.test(b.date || '') ? 'No date yet' : ISO.test(b.endDate || '') && b.endDate > b.date ? `${fmtShort(b.date)} – ${fmtShort(b.endDate)}` : fmtShort(b.date));
const longDate = iso => parseISO(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
// The times that matter on a list line: a show's load-in and stage time; a session's start to finish (past midnight too).
function timesLine(b) {
  if (b.kind === 'show') return [b.loadIn && `load-in ${b.loadIn}`, b.setTime && `on stage ${b.setTime}`].filter(Boolean).join(' · ');
  if (b.start && b.end) return `${b.start}–${b.end}${b.end < b.start ? ' (past midnight)' : ''}`;
  return b.start || '';
}

/* ------------------------------- contact card (vCard) ------------------------------- */
const vesc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
// A vCard 3.0 with what another phone needs: name, company, role, phone, email, instruments and acts. Never the rate
// or your notes about them.
function vcard(p) {
  const w = String(p.name || '').trim().split(/\s+/).filter(Boolean);
  const family = w.length > 1 ? w[w.length - 1] : '', given = w.length > 1 ? w.slice(0, -1).join(' ') : (w[0] || '');
  const acts = actsOf(p.id).map(a => a.name);
  const note = [p.instrument && `Instruments: ${p.instrument}`, acts.length && `Acts: ${acts.join(', ')}`].filter(Boolean).join('. ');
  const tel = /\d/.test(p.phone || '') ? String(p.phone).trim() : '';
  return ['BEGIN:VCARD', 'VERSION:3.0', `N:${vesc(family)};${vesc(given)};;;`, `FN:${vesc(nameOf(p))}`,
    p.company && `ORG:${vesc(p.company)}`, p.role && `TITLE:${vesc(p.role)}`, tel && `TEL;TYPE=CELL:${vesc(tel)}`,
    emailOf(p) && `EMAIL;TYPE=INTERNET:${vesc(emailOf(p))}`, note && `NOTE:${vesc(note)}`, 'END:VCARD'].filter(Boolean).join('\r\n');
}
// QR markup for a vCard. Plain ASCII goes through the shared qrSvg; text with accents or other scripts ("Zoë",
// "Björk", "李") is encoded as UTF-8 so phones read the name right (the QR library's default keeps one byte a letter).
async function qrMarkup(text) {
  if (!/[^\x00-\x7f]/.test(text)) return qrSvg(text, { level: 'M' });
  const qrcode = await loadQR();
  const was = qrcode.stringToBytes;
  qrcode.stringToBytes = (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) || was;
  try { const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make(); return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } finally { qrcode.stringToBytes = was; }
}

/* ------------------------------- edit / add ------------------------------- */
const formTitle = p => (p && p.id && byId('people', p.id) ? 'Edit person' : 'Add a person');
// Set which acts a person is in (act.members), changing only the acts that differ.
function setMemberships(id, chosen) {
  const want = new Set(chosen || []);
  if (!db.acts.some(a => want.has(a.id) !== (a.members || []).includes(id))) return;
  update(d => d.acts.forEach(a => {
    const has = (a.members || []).includes(id);
    if (want.has(a.id) === has) return;
    a.members = has ? a.members.filter(x => x !== id) : [...(a.members || []), id];
    a.updatedAt = Date.now();
  }));
}

function edit(p = {}, onSaved, { actIds = null } = {}) {
  const stored = !!(p.id && byId('people', p.id));
  const acts = [...db.acts].sort(byName);
  const values = { ...p, group: groupOf(p) || 'band', rateUnit: PERSON_RATE_UNITS.some(u => u[0] === p.rateUnit) ? p.rateUnit : 'day', acts: actIds || (p.id ? actsOf(p.id).map(a => a.id) : []) };
  openForm({
    title: formTitle(p),
    values,
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'First and last name' },
      { key: 'group', label: 'Group', type: 'select', options: PEOPLE_GROUPS },
      { key: 'role', label: 'Role', list: ROLES, placeholder: 'Pick or type: Drums, FOH engineer, Promoter…' },
      { key: 'instrument', label: 'Instruments', placeholder: 'Guitar, backing vocals' },
      { key: 'company', label: 'Company', placeholder: 'Agency, label, venue or studio' },
      { key: 'phone', label: 'Phone', type: 'tel', placeholder: '+1 555 0100' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'rate', label: 'Usual rate', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 180', hint: 'What they usually charge you. Only you see it: it never goes into a message, a day sheet or their contact card.' },
      { key: 'rateUnit', label: 'Per', type: 'select', options: PERSON_RATE_UNITS },
      acts.length > 0 && { key: 'acts', label: 'Member of', type: 'checks', options: acts.map(a => ({ value: a.id, label: a.name, hint: a.genre || '' })), hint: 'The acts they play in. Each act’s page shows the same line-up.' },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Their mic, dietary needs, who they dep for…' },
    ].filter(Boolean),
    saveLabel: stored ? 'Save' : 'Add',
    onSave: v => {
      const { acts: chosen, ...rest } = v;
      const rec = { ...rest, name: String(rest.name || '').trim(), group: GROUP_IDS.includes(rest.group) ? rest.group : 'band' };
      if (!rec.name) { toast('Add a name to save this person.'); return edit(rec, onSaved, { actIds: chosen }); }
      if (rec.rate !== '' && rec.rate != null) rec.rate = Math.max(0, Number(rec.rate) || 0);
      const saved = upsert('people', rec);
      if (Array.isArray(chosen)) setMemberships(saved.id, chosen);
      toast(stored ? 'Saved' : `${saved.name} added`);
      if (onSaved) onSaved(saved);
    },
    onDelete: stored ? () => deletePerson(p.id, { asked: true }) : null,
  });
}
// Edit form for a person (also used by the booking's line-up and the acts page). onSaved(record) after it saves.
export function editPerson(p = {}, onSaved) { edit(p || {}, onSaved); }

/* ------------------------------- delete ------------------------------- */
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
function deleteMessage(p) {
  const bks = db.bookings.filter(b => (b.people || []).includes(p.id));
  const past = bks.filter(b => b.date && lastDay(b) < today()).length;
  const acts = actsOf(p.id), gear = db.gear.filter(g => g.owner === p.id);
  const on = [bks.length && 'on ' + plural(bks.length, 'booking') + (past ? ` (${past} of them past)` : ''), acts.length && `in ${plural(acts.length, 'act')} (${acts.map(a => a.name).join(', ')})`].filter(Boolean);
  return [`Delete ${nameOf(p)}?`,
    on.length ? `They are ${on.join(' and ')}. Deleting takes them off ${bks.length + acts.length === 1 ? 'it' : 'all of them'}${past ? ', and a past show’s payouts are then shared among the rest' : ''}.` : '',
    gear.length ? `${plural(gear.length, 'backline item')} they own will stay, with no owner.` : '',
    'This can’t be undone.'].filter(Boolean).join(' ');
}
const isReferenced = p => db.bookings.some(b => (b.people || []).includes(p.id)) || actsOf(p.id).length > 0 || db.gear.some(g => g.owner === p.id);
// asked: the edit form has already asked "Delete this permanently?"; ask again only to say what else it changes.
function deletePerson(id, { asked = false } = {}) {
  const p = byId('people', id);
  if (!p) return false;
  if ((!asked || isReferenced(p)) && !confirm(deleteMessage(p))) return false;
  remove('people', id);
  toast(`${nameOf(p)} deleted`);
  return true;
}

/* ------------------------------- the person sheet ------------------------------- */
const personSteps = [
  { title: 'Get in touch', text: 'Call, text or email them with the number and address saved here.', target: ['.pp-sheet .pp-quick'] },
  { title: 'Ask if they’re free', text: 'Pick a booking and send them a text or email with the date, the place and the times. The money is never in it.', target: ['#pp-ask'] },
  { title: 'Share their contact', text: 'A QR code another phone can scan, or a .vcf file to send.', target: ['#pp-share'] },
  { title: 'Acts', text: 'The acts they play in. Tap one to open it.', target: ['.pp-acts-sec'] },
  { title: 'Bookings', text: 'Their upcoming shows, sessions and rehearsals, with a warning when two land on the same day. Tap one to open it.', target: ['.pp-upcoming'] },
  { title: 'Details and rate', text: 'Their usual rate is for you only: it never goes into a message or their contact card.', target: ['.pp-details'] },
  { title: 'Edit', text: 'Change their details, group, rate and acts. Delete is at the bottom.', target: ['#pp-edit'] },
];
const sec = (title, cls, ...kids) => h('section', { class: 'pp-sec ' + (cls || '') }, h('h3', null, title), ...kids);
const kv = (k, v) => v && h('div', null, h('span', { class: 'muted' }, k), typeof v === 'string' ? h('span', { class: 'pp-val' }, v) : v);

function bookingItem(b, personId, close) {
  const clash = personId ? personClash(b, personId) : [];
  const t = timesLine(b);
  return h('button', { class: 'card tap pp-bk', type: 'button', 'data-fk': 'bk-' + b.id, 'data-id': b.id, onclick: () => { close(); import('./bookings.js').then(m => m.openBooking(b.id)); } },
    h('span', { class: 'pp-bk-top' }, h('span', { class: 'pp-bk-when' }, dateText(b) + (t ? ' · ' + t : '')), h('span', { class: 'pill ' + statusTone(b.status) }, statusLabel(b.status))),
    h('span', { class: 'pp-bk-title' }, `${kindIcon(b.kind)} ${bookingTitle(b)}`),
    clash.length > 0 && h('span', { class: 'pp-clash' }, `⚠ Also on ${clash.map(bookingTitle).join(', ')} that day`));
}

function personView(p, close) {
  const id = p.id, acts = actsOf(id), next = upcomingFor(id), past = pastFor(id), contactFor = asContact(p);
  const gear = db.gear.filter(g => g.owner === id).sort(byName);
  const gearValue = gear.reduce((s, g) => s + totalValue(g), 0);
  const tel = phoneOf(p), mail = emailOf(p), group = groupOf(p);
  const sub = [p.role, p.instrument && p.instrument !== p.role ? p.instrument : ''].filter(Boolean).join(' · ');
  return [
    h('div', { class: 'pp-hero' },
      h('span', { class: 'avatar big', 'aria-hidden': 'true' }, initials(p.name)),
      h('div', { class: 'pp-hero-text' },
        h('span', { class: 'pill pp-group' }, group ? ONE[group] : 'Not sorted yet'),
        sub && h('div', { class: 'pp-hero-sub' }, sub),
        p.company && h('div', { class: 'muted small' }, p.company)),
      h('button', { class: 'btn ghost small pp-edit', type: 'button', id: 'pp-edit', 'aria-label': `Edit ${nameOf(p)}`, onclick: () => edit(byId('people', id) || p) }, '✎ Edit')),
    quick(p, 'pp-quick'),
    h('div', { class: 'actions pp-tools' },
      group !== 'contact' && h('button', { class: 'btn primary small', type: 'button', id: 'pp-ask', onclick: () => askFree(id) }, '🙋 Ask if they’re free'),
      h('button', { class: 'btn ghost small', type: 'button', id: 'pp-share', onclick: () => shareContact(id) }, '▦ Share contact')),
    // An industry contact is rarely in an act or on a line-up: those sections show for them only when there is something.
    (acts.length > 0 || group !== 'contact') && sec('Acts', 'pp-acts-sec', acts.length
      ? h('div', { class: 'pp-actlist' }, acts.map(a => h('button', { class: 'chip pp-actchip', type: 'button', 'data-fk': 'act-' + a.id, 'aria-label': `Open ${a.name}`, onclick: () => import('./acts.js').then(m => m.openAct(a.id)) }, dot(a), a.name)))
      : h('p', { class: 'muted small' }, 'Not in an act. Tap Edit to add them to one.')),
    (next.length > 0 || group !== 'contact' || !contactFor.length) && sec('Coming up', 'pp-upcoming', next.length
      ? h('div', { class: 'pp-bks' }, next.map(b => bookingItem(b, id, close)))
      : h('p', { class: 'muted small' }, group === 'contact' ? 'Nothing coming up with them.' : 'Nothing booked yet. Ask if they’re free for a show or session.')),
    contactFor.length > 0 && sec('They’re the contact for', 'pp-contact-for', h('div', { class: 'pp-bks' }, contactFor.map(b => bookingItem(b, '', close)))),
    past.length > 0 && h('details', { class: 'twirl pp-past' },
      h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '🕘'), h('span', { class: 'twirl-name' }, 'Past bookings'), h('span', null, h('span', { class: 'tag' }, String(past.length)))),
      h('div', { class: 'twirl-body' }, past.slice(0, 12).map(b => bookingItem(b, '', close)), past.length > 12 && h('p', { class: 'muted small' }, `And ${past.length - 12} older.`))),
    sec('Details', 'pp-details', h('div', { class: 'kv pp-kv' },
      kv('Group', group ? groupLabel(group) : 'Not sorted yet'),
      kv('Role', p.role), kv('Instruments', p.instrument), kv('Company', p.company),
      tel && kv('Phone', h('a', { href: 'tel:' + tel }, p.phone)),
      mail && kv('Email', h('a', { href: 'mailto:' + mail }, mail)),
      kv('Usual rate', rateText(p) || 'Not set'))),
    gear.length > 0 && sec('Their gear', 'pp-gear', h('ul', { class: 'pp-gearlist' }, gear.map(g => h('li', null, h('span', null, g.name || 'Item', Number(g.qty) > 1 ? ` ×${Math.floor(Number(g.qty))}` : ''), h('span', { class: 'muted' }, [g.make, g.model].filter(Boolean).join(' '))))),
      h('p', { class: 'muted small' }, `On your backline list, worth ${fmtMoney(gearValue)}.`)),
    p.notes && sec('Notes', 'pp-notes', h('p', { class: 'prewrap pp-notetext' }, p.notes)),
    h('div', { class: 'pp-danger' }, h('button', { class: 'btn danger small', type: 'button', id: 'pp-delete', onclick: () => deletePerson(id) }, `Delete ${nameOf(p)}`)),
  ];
}

// View sheet for a person, from anywhere in the app. It follows changes while open and closes if they are deleted.
export function openPerson(id) {
  const p0 = byId('people', id);
  if (!p0) { toast('That person is no longer in People.'); return; }
  let title = nameOf(p0);
  sheetTutorial(title, personSteps);
  const body = h('div', { class: 'pp-sheet' });
  let unsub = null, queued = false;
  const s = sheet(title, body, { onClose: () => { if (unsub) unsub(); unsub = null; } });
  const draw = () => {
    queued = false;
    const p = byId('people', id);
    if (!p) { s.close(); return; }
    const a = document.activeElement, key = a && body.contains(a) ? (a.dataset.fk || a.id) : '';
    const top = body.parentElement ? body.parentElement.scrollTop : 0;
    if (nameOf(p) !== title) {
      title = nameOf(p); sheetTutorial(title, personSteps);
      s.el.setAttribute('aria-label', title);
      const head = s.el.querySelector('.sheet-head h2'); if (head) head.textContent = title;
    }
    body.replaceChildren(...personView(p, s.close).filter(Boolean));
    if (body.parentElement) body.parentElement.scrollTop = top;
    if (key) { const again = body.querySelector(`[data-fk="${CSS.escape(key)}"]`) || body.querySelector('#' + CSS.escape(key)); if (again) again.focus({ preventScroll: true }); }
  };
  draw();
  unsub = subscribe(() => { if (!queued) { queued = true; queueMicrotask(draw); } });
}

/* ------------------------------- ask if they're free ------------------------------- */
// The message: who, where, when and the times of the day. Never the deal, the fee or their rate.
function askText(p, b) {
  const act = actName(b.actId) || b.client || '';
  const v = venueOf(b);
  const what = b.kind === 'show' ? act || b.title || 'a show'
    : b.kind === 'session' ? (act ? `a studio session with ${act}` : b.title || 'a studio session')
      : b.kind === 'rehearsal' ? (act ? `a rehearsal with ${act}` : b.title || 'a rehearsal')
        : b.title || act || 'a booking';
  const where = v.name ? ` at ${v.name}` : '';
  const when = !ISO.test(b.date || '') ? '' : ISO.test(b.endDate || '') && b.endDate > b.date ? ` from ${longDate(b.date)} to ${longDate(b.endDate)}` : ` on ${longDate(b.date)}`;
  let times = '';
  if (b.kind === 'show') {
    const parts = [['loadIn', 'load-in'], ['soundcheck', 'soundcheck'], ['doors', 'doors'], ['setTime', 'on stage']].filter(([k]) => b[k]).map(([k, l]) => `${l} ${b[k]}`);
    if (Number(b.setLength) > 0) parts.push(`a ${fmtMin(b.setLength)} set`);
    if (parts.length) times = parts.join(', ').replace(/^./, c => c.toUpperCase()) + '.';
  } else if (b.start) times = b.end ? `From ${b.start} to ${b.end}${b.end < b.start ? ' (finishing after midnight)' : ''}.` : `From ${b.start}.`;
  const sign = String(db.profile.name || db.profile.business || '').trim();
  return [`Hi ${firstName(p)},`, `Are you free for ${what}${where}${when}?`, times, v.address && `Address: ${v.address}`, 'Let me know either way. Thanks!', sign].filter(Boolean).join('\n');
}
const askSubject = b => `Are you free${ISO.test(b.date || '') ? ' on ' + fmtShort(b.date) : ''}? ${bookingTitle(b)}`;

const askSteps = [
  { title: 'Which booking', text: 'Every upcoming show, session and rehearsal. The ones they are already on say so.', target: ['#pp-ask-booking'] },
  { title: 'The message', text: 'The date, the place and the times, written for you. Change anything before you send it. Money is never in it.', target: ['#pp-ask-text'] },
  { title: 'Send it', text: 'Opens your messages or email app with it filled in.', target: ['.pp-ask-send'] },
  { title: 'They said yes?', text: 'Put them on the booking’s line-up in one tap.', target: ['#pp-ask-add'] },
];
sheetTutorial('Ask if they’re free', askSteps);

function askFree(id) {
  const p = byId('people', id);
  if (!p) return;
  const list = upcoming().filter(b => ISO.test(b.date || ''));
  const body = h('div', { class: 'pp-ask' });
  const s = sheet('Ask if they’re free', body);
  if (!list.length) {
    body.append(empty('There are no upcoming bookings to ask about. Add a show, session or rehearsal first.',
      h('button', { class: 'btn primary', type: 'button', onclick: () => { s.close(); import('./bookings.js').then(m => m.newBooking({})); } }, '+ New booking')));
    return;
  }
  const isOn = b => (b.people || []).includes(id);
  let cur = list.find(b => !isOn(b)) || list[0];
  const tel = phoneOf(p), mail = emailOf(p);
  const text = h('textarea', { id: 'pp-ask-text', rows: 8 });
  const sms = tel ? h('a', { class: 'btn primary', id: 'pp-ask-sms' }, '💬 Text') : null;
  const email = mail ? h('a', { class: 'btn ghost', id: 'pp-ask-mail' }, '✉ Email') : null;
  const add = h('button', { class: 'btn ghost small', type: 'button', id: 'pp-ask-add' });
  const clash = h('p', { class: 'pp-clash', hidden: true });
  const sync = () => {
    if (sms) sms.href = smsUrl(tel, text.value);
    if (email) email.href = mailUrl(mail, askSubject(cur), text.value);
    const b = byId('bookings', cur.id) || cur, on = isOn(b);
    add.textContent = on ? `✓ On the line-up` : `+ Add ${firstName(p)} to the line-up`;
    add.disabled = on;
    const others = personClash(b, id);
    clash.hidden = !others.length;
    clash.textContent = others.length ? `⚠ ${firstName(p)} is already on ${others.map(bookingTitle).join(', ')} that day.` : '';
  };
  const label = b => `${dateText(b)} · ${kindIcon(b.kind)} ${bookingTitle(b)}${isOn(b) ? ' (on it)' : ''}`;
  const sel = h('select', { id: 'pp-ask-booking', onchange: () => { cur = byId('bookings', sel.value) || cur; text.value = askText(p, cur); sync(); } },
    list.map(b => h('option', { value: b.id, selected: b.id === cur.id }, label(b))));
  text.value = askText(p, cur);
  text.addEventListener('input', sync);
  add.addEventListener('click', () => {
    const b = byId('bookings', cur.id);
    if (!b || isOn(b)) return;
    update(d => { const x = d.bookings.find(r => r.id === b.id); if (!x) return; x.people = [...(x.people || []), id]; x.updatedAt = Date.now(); });
    cur = byId('bookings', b.id) || cur;
    [...sel.options].forEach(o => { const bb = byId('bookings', o.value); if (bb) o.textContent = label(bb); });
    toast(`${firstName(p)} added to ${bookingTitle(cur)}`);
    sync();
  });
  const copy = h('button', { class: 'btn ghost', type: 'button', id: 'pp-ask-copy', onclick: async () => {
    try { await navigator.clipboard.writeText(text.value); toast('Message copied'); } catch { text.focus(); text.select(); toast('Select the message and copy it'); }
  } }, '⧉ Copy');
  body.append(...nodes(
    h('div', { class: 'field' }, h('label', { for: 'pp-ask-booking' }, 'Booking'), sel),
    clash,
    h('div', { class: 'field' }, h('label', { for: 'pp-ask-text' }, `Message to ${firstName(p)}`), text,
      h('small', { class: 'muted' }, 'The date, place and times only. No fee, deal or rate.')),
    h('div', { class: 'actions pp-ask-send' }, sms, email, copy),
    !tel && !mail && h('p', { class: 'muted small' }, `No phone or email saved for ${firstName(p)}. Copy the message, or add their details with Edit.`),
    (tel || mail) && (!tel || !mail) && h('p', { class: 'muted small' }, tel ? 'No email saved: text it, or copy it.' : 'No phone number saved: email it, or copy it.'),
    h('div', { class: 'pp-ask-add' }, add)));
  sync();
}

/* ------------------------------- share contact ------------------------------- */
const shareSteps = [
  { title: 'Scan to save', text: 'Another phone’s camera reads this code and offers to save the contact. Their rate and your notes are not in it.', target: ['.pp-qr'] },
  { title: 'Or send the file', text: 'A .vcf contact file: share it, or save it to send later.', target: ['#pp-vcf'] },
];
sheetTutorial('Share contact', shareSteps);

function shareContact(id) {
  const p = byId('people', id);
  if (!p) return;
  const card = vcard(p);
  const box = h('div', { class: 'qr pp-qr', role: 'img', 'aria-label': `QR code with ${nameOf(p)}’s contact details` }, 'Making the code…');
  const save = async () => { const okd = await saveFile(vcard(byId('people', id) || p), fileName(nameOf(p), 'vcf'), 'text/vcard'); if (okd) toast('Contact file ready'); };
  sheet('Share contact', h('div', { class: 'pp-share' },
    h('div', { class: 'pp-share-who' }, h('strong', null, nameOf(p)), h('span', { class: 'muted small' }, [p.role, p.company].filter(Boolean).join(' · '))),
    box,
    h('p', { class: 'muted small pp-share-cap' }, `Scan it with a phone camera to save ${firstName(p)}’s details. Their rate and your notes are not included.`),
    !phoneOf(p) && !emailOf(p) && h('p', { class: 'warn' }, 'There is no phone number or email to share yet. Add them with Edit.'),
    h('div', { class: 'actions center' }, h('button', { class: 'btn primary', type: 'button', id: 'pp-vcf', onclick: save }, '⤓ Save .vcf'))));
  qrMarkup(card).then(svg => { box.replaceChildren(); box.innerHTML = svg; box.dataset.ready = '1'; })
    .catch(() => { box.textContent = 'Could not make a QR code here. Save the .vcf file instead.'; });
}

/* ------------------------------- the page ------------------------------- */
const S = { q: '', group: '', act: '' };
const dot = a => h('i', { class: 'pp-dot', 'aria-hidden': 'true', style: okColor(a.color) ? `background:${okColor(a.color)}` : null });

function quick(p, cls) {
  const tel = phoneOf(p), mail = emailOf(p);
  if (!tel && !mail) return null;
  const who = nameOf(p);
  return h('div', { class: 'actions ' + cls },
    tel && h('a', { class: 'btn ghost small', href: 'tel:' + tel, 'aria-label': `Call ${who}` }, '📞 Call'),
    tel && h('a', { class: 'btn ghost small', href: smsUrl(tel), 'aria-label': `Text ${who}` }, '💬 Text'),
    mail && h('a', { class: 'btn ghost small', href: 'mailto:' + mail, 'aria-label': `Email ${who}` }, '✉ Email'));
}

function card(p) {
  const acts = actsOf(p.id), next = upcomingFor(p.id)[0];
  const sub = [p.role, p.instrument && p.instrument !== p.role ? p.instrument : '', p.company, rateText(p)].filter(Boolean).join(' · ');
  return h('div', { class: 'card pp-card', 'data-id': p.id },
    h('div', { class: 'pp-row' },
      h('button', { class: 'pp-main', type: 'button', id: 'pp-open-' + p.id, onclick: () => openPerson(p.id) },
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.name)),
        h('span', { class: 'pp-text' },
          h('span', { class: 'pp-name' }, nameOf(p)),
          sub && h('span', { class: 'pp-sub' }, sub),
          acts.length > 0 && h('span', { class: 'pp-acts' }, acts.map(a => h('span', { class: 'pp-act' }, dot(a), h('span', { class: 'pp-act-name' }, a.name)))),
          next && h('span', { class: 'pp-next' }, `Next: ${dateText(next)} · ${kindIcon(next.kind)} ${bookingTitle(next)}`))),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit ${nameOf(p)}`, onclick: () => edit(p) }, '✎')),
    quick(p, 'pp-quick'));
}

function matches(p, words) {
  if (!words.length) return true;
  const hay = [p.name, p.role, p.instrument, p.company, p.notes, p.phone, p.email, groupLabel(groupOf(p)), ...actsOf(p.id).map(a => a.name)].join(' ').toLowerCase();
  return words.every(w => hay.includes(w));
}

function exportContacts(list) {
  if (!list.length) return;
  const name = list.length === 1 ? nameOf(list[0]) : 'Gigdex contacts' + (S.group ? ' - ' + groupLabel(S.group) : '') + (S.act && byId('acts', S.act) ? ' - ' + byId('acts', S.act).name : '');
  saveFile(list.map(vcard).join('\r\n') + '\r\n', fileName(name, 'vcf'), 'text/vcard').then(okd => { if (okd) toast(`${plural(list.length, 'contact')} ready to import`); });
}

function draw(root) {
  if (S.group && !GROUP_IDS.includes(S.group)) S.group = '';
  if (S.act && !byId('acts', S.act)) S.act = '';
  const all = [...db.people].sort(byName);
  const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const actMembers = S.act ? byId('acts', S.act).members || [] : [];
  const shown = all.filter(p => (!S.group || groupOf(p) === S.group) && (!S.act || actMembers.includes(p.id)) && matches(p, words));
  const filtered = !!(S.group || S.act || words.length);
  const counts = Object.fromEntries(GROUP_IDS.map(g => [g, all.filter(p => groupOf(p) === g).length]));
  const actsWithPeople = [...db.acts].filter(a => (a.members || []).some(m => byId('people', m))).sort(byName);
  // Local redraws (filters, search) keep the focus on the control that was used.
  const again = () => {
    const a = document.activeElement, id = a && root.contains(a) ? a.id : '', caret = a && a.id === 'pp-search' ? a.selectionStart : null;
    draw(root);
    const el = id && root.querySelector('#' + CSS.escape(id));
    if (el) { el.focus({ preventScroll: true }); if (caret != null) try { el.setSelectionRange(caret, caret); } catch { /* not a text box */ } }
  };
  const add = () => edit({ group: S.group || 'band' }, null, { actIds: S.act ? [S.act] : null });
  const chip = (id, on, onclick, ...kids) => h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', id, 'aria-pressed': String(on), onclick }, ...kids);
  const count = n => h('span', { class: 'pp-n' }, String(n));
  const groupChips = PEOPLE_GROUPS.filter(([g]) => counts[g] || S.group === g);

  let list;
  if (!all.length) {
    list = empty('Add your band, the session players and crew you hire, and the promoters and agents you deal with. Then put them on bookings, and ask who’s free in a tap.',
      h('button', { class: 'btn primary', type: 'button', id: 'pp-empty-add', onclick: add }, '+ Add a person'));
  } else if (!shown.length) {
    list = empty(S.group && !counts[S.group] && !words.length && !S.act ? `No ${groupLabel(S.group).toLowerCase()} yet.` : 'No one matches.',
      h('div', { class: 'actions center' },
        h('button', { class: 'btn ghost', type: 'button', id: 'pp-clear', onclick: () => { S.q = ''; S.group = ''; S.act = ''; draw(root); root.querySelector('#pp-add')?.focus(); } }, 'Show everyone'),
        S.group && h('button', { class: 'btn primary', type: 'button', id: 'pp-empty-add', onclick: add }, `+ Add ${ONE[S.group].toLowerCase()}`)));
  } else if (!S.group) {
    const sections = [...GROUP_IDS, ''].map(g => [g, shown.filter(p => groupOf(p) === g)]).filter(([, ps]) => ps.length);
    list = h('div', { class: 'pp-groupsecs' }, sections.map(([g, ps]) => h('section', { class: 'pp-groupsec', 'data-group': g || 'none' },
      h('h3', null, groupLabel(g), h('span', { class: 'pp-hn' }, ' · ' + ps.length)),
      h('div', { class: 'list' }, ps.map(card)))));
  } else list = h('div', { class: 'list' }, shown.map(card));

  root.replaceChildren(h('div', { class: 'pp-page' },
    h('div', { class: 'page-head' }, h('h1', null, 'People'), h('button', { class: 'btn primary', type: 'button', id: 'pp-add', 'aria-label': 'Add a person', onclick: add }, '+ Add')),
    (all.length > 3 || S.q) && h('input', { class: 'search', id: 'pp-search', type: 'search', placeholder: 'Search name, role, instrument, act…', value: S.q, 'aria-label': 'Search people', autocomplete: 'off',
      oninput: e => { S.q = e.target.value; again(); } }),
    all.length > 0 && h('div', { class: 'chips pp-groups', role: 'group', 'aria-label': 'Show a group' },
      chip('pp-g-all', !S.group, () => { S.group = ''; again(); }, 'Everyone ', count(all.length)),
      groupChips.map(([g]) => { const el = chip('pp-g-' + g, S.group === g, () => { S.group = S.group === g ? '' : g; again(); }, SHORT[g] + ' ', count(counts[g])); el.setAttribute('aria-label', `${groupLabel(g)}, ${counts[g]}`); return el; })),
    actsWithPeople.length > 0 && h('div', { class: 'chips pp-actfilter', role: 'group', 'aria-label': 'Show the people in an act' },
      chip('pp-a-all', !S.act, () => { S.act = ''; again(); }, 'All acts'),
      actsWithPeople.map(a => chip('pp-a-' + a.id, S.act === a.id, () => { S.act = S.act === a.id ? '' : a.id; again(); }, dot(a), a.name))),
    filtered && shown.length > 0 && h('p', { class: 'muted small pp-showing', role: 'status' }, `Showing ${plural(shown.length, 'person', 'people')} of ${all.length}.`),
    list,
    shown.length > 0 && h('div', { class: 'actions pp-foot' },
      h('button', { class: 'btn ghost small', type: 'button', id: 'pp-export', onclick: () => exportContacts(shown) }, filtered ? `⤓ Save these ${shown.length} as contacts (.vcf)` : '⤓ Save everyone as contacts (.vcf)'))));
}

export const people = {
  id: 'people', label: 'People', icon: '👥',
  render(root) { draw(root); },
  tutorial: () => [
    { title: 'People', text: 'Everyone you work with: your band, the session players and crew you hire, and the promoters, agents and labels you deal with. Tap + Add for someone new.', target: ['.pp-page .page-head'] },
    { title: 'Search', text: 'Find anyone by name, role, instrument, company or act.', target: ['#pp-search'] },
    { title: 'Groups', text: 'Show only band members, session players, crew or industry contacts.', target: ['.pp-groups'] },
    { title: 'Acts', text: 'Show only the people in one act.', target: ['.pp-actfilter'] },
    { title: 'A person', text: 'Their role, instruments, company, acts and next booking. Tap the card for their bookings, rate and notes, to ask if they’re free, or to share their contact.', target: ['.pp-card .pp-main'] },
    { title: 'Call, text or email', text: 'Straight from the card, with the number and address saved for them.', target: ['.pp-card .pp-quick'] },
    { title: 'Save as contacts', text: 'Save the people on screen as a contacts file (.vcf) your phone or computer can import.', target: ['#pp-export'] },
    { title: 'Nobody here yet', text: 'Add your band first, then the players, crew and contacts you work with.', target: ['#pp-empty-add'] },
  ],
};

const formSteps = [
  { title: 'Name and group', text: 'Band member, session player, crew or industry contact: the group sorts the People page.', target: ['[id$="-group"]'] },
  { title: 'Role', text: 'Pick one from the list or type your own: Drums, FOH engineer, Promoter…', target: ['[id$="-role"]'] },
  { title: 'Usual rate', text: 'What they charge you, per day, hour, show or song. Only you see it.', target: ['[id$="-rate"]'] },
  { title: 'Member of', text: 'Tick the acts they play in. The act’s line-up follows.', target: ['.checks'] },
];
sheetTutorial('Add a person', formSteps);
sheetTutorial('Edit person', formSteps);

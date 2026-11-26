import { h, telUrl, safeUrl, empty, fmtShort, todayISO, personRate, rateText, hasUnit, keepTypedRate, typedRateHint, toast } from '../util.js';
import { db, upsert, remove, crewBookings, endOf, touch } from '../store.js';
import { openForm } from '../form.js';
import { groupNames, groupOf, roleWords, fold, MY_ROLES } from '../roles.js';

// The filter: S.role is the group of roles being shown (a department, My roles for roles of your own, or No role;
// '' for everyone) and S.only one role within it, so clearing S.q and S.role shows everyone. Roles are compared the
// way the menu compares them, so "gaffer" and "Gaffer" on two cards are one chip.
const S = { q: '', role: '', only: '' };
const NO_ROLE = 'No role';
const roleOf = c => String(c.role || '').trim(), roleKey = c => fold(c.role);
const bucket = c => groupOf(c.role) || NO_ROLE;

// An older card holds the rate as it was typed ("$450/day", "£55 an hour"): the form shows the amount and the unit it
// reads and saves them as a number and a unit; the typed text is shown under the box, and what it cannot read ("TBC",
// "1,200 per week") stays as it is until an amount replaces it (keepTypedRate in util.js).
const rateValues = c => { const r = personRate(c); return { ...c, rate: r.amount === '' ? '' : r.amount, rateUnit: hasUnit(c) ? c.rateUnit : r.hourly ? 'hour' : 'day' }; };
function edit(c = {}) {
  openForm({
    title: c.id ? 'Edit crew member' : 'Add trusted crew',
    values: rateValues(c),
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'role', label: 'Role', type: 'role' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'rate', label: 'Rate', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 450', hint: typedRateHint(c) + 'Prices this person’s line on quotes, invoices and the budget: a day rate per shoot day, or an hourly rate for a standard day’s hours (Settings → Work & billing → Hours & breaks).' }, { key: 'rateUnit', label: 'Per', type: 'select', options: [['day', 'Day'], ['hour', 'Hour']] },
      { key: 'link', label: 'Link to their work', type: 'url', placeholder: 'https://… showreel / portfolio' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => upsert('crew', keepTypedRate(c, v)),
    onDelete: c.id ? () => remove('crew', c.id) : null,
  });
}

// "Add from a link": a contact card (or anything else) someone shared from their Vdex, pasted or scanned.
const addFromLink = () => import('../share-add.js').then(m => m.openAddFromLink()).catch(e => toast('Could not open that: ' + (e.message || e)));
// Opens the Crew page on one person, with nothing filtered away: where a contact card that was just added lands.
export async function showPerson(id) {
  S.q = ''; S.role = '';
  await window.logiGo('crew'); touch();
  setTimeout(() => { const el = document.querySelector(`.crew-card[data-id="${CSS.escape(id)}"]`); if (el) { el.classList.add('just-added'); el.scrollIntoView({ block: 'center' }); } }, 60);
}

export const crew = {
  id: 'crew', label: 'Crew', icon: '👥',
  render(root) {
    const draw = () => {
      // Chips for the groups that have people, in the menu's order; then, for the group chosen, the roles in use in it.
      const where = new Map(db.crew.map(c => [c, bucket(c)])), order = [...groupNames(), MY_ROLES, NO_ROLE], rank = c => order.indexOf(where.get(c));
      const groups = order.filter(g => db.crew.some(c => where.get(c) === g));
      if (!groups.includes(S.role)) S.role = '';
      const roles = S.role && S.role !== NO_ROLE ? [...new Map(db.crew.filter(c => where.get(c) === S.role).map(c => [roleKey(c), roleOf(c)]))].sort((a, b) => a[1].localeCompare(b[1])) : [];
      if (!roles.some(([key]) => key === S.only)) S.only = '';
      if (db.crew.length <= 3) S.q = ''; // too few people for the search box: a search left in it could not be cleared
      const q = S.q.toLowerCase();
      const list = db.crew.filter(c => (!S.role || where.get(c) === S.role) && (!S.only || roleKey(c) === S.only) && (!q || `${c.name} ${c.role} ${c.notes} ${roleWords(c.role)}`.toLowerCase().includes(q)))
        .sort((a, b) => rank(a) - rank(b) || roleOf(a).localeCompare(roleOf(b)) || a.name.localeCompare(b.name));
      // A chip keeps the focus through the redraw its tap causes, so the next one is a Tab away.
      const chip = (key, label, on, pick) => h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-chip': key, onclick: () => { pick(); draw(); root.querySelector(`[data-chip="${CSS.escape(key)}"]`)?.focus(); } }, label);

      root.replaceChildren(h('div', null,
        h('div', { class: 'page-head' }, h('h1', null, 'Trusted crew'), h('button', { class: 'btn primary', onclick: () => edit() }, '+ Add')),
        h('div', { class: 'subactions' }, h('button', { class: 'btn ghost small', onclick: addFromLink, title: 'Add a contact card someone shared with you from Vdex' }, '🔗 Add from a link')),
        db.crew.length > 3 && h('input', { class: 'search', type: 'search', placeholder: 'Search crew…', value: S.q, 'aria-label': 'Search crew', oninput: e => { S.q = e.target.value; draw(); const i = root.querySelector('.search'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); } }),
        groups.length > 1 && h('div', { class: 'chips', role: 'group', 'aria-label': 'Show one kind of role' },
          chip('all', 'All', !S.role, () => { S.role = ''; S.only = ''; }),
          groups.map(g => chip('g:' + g, g, S.role === g, () => { S.role = S.role === g ? '' : g; S.only = ''; }))),
        roles.length > 1 && h('div', { class: 'chips by-role', role: 'group', 'aria-label': `Show one role in ${S.role}` },
          chip('whole', 'Whole group', !S.only, () => { S.only = ''; }),
          roles.map(([key, label]) => chip('r:' + key, label, S.only === key, () => { S.only = S.only === key ? '' : key; }))),
        list.length
          ? h('div', { class: 'list' }, list.map(card))
          : empty(db.crew.length ? 'No matches.' : 'Add the freelancers you trust — sound, AC, gaffer, editor — with a link to their work.', db.crew.length ? null : h('button', { class: 'btn primary', onclick: () => edit() }, 'Add crew member'))));
    };
    draw();
  },
};

// For the search (js/search.js): the list with nothing filtered away, so the person it opens is on it.
export const showAll = () => { S.q = ''; S.role = ''; };

function card(c) {
  const link = safeUrl(c.link);
  const next = crewBookings(c.id).filter(b => endOf(b) >= todayISO()).slice(0, 2);
  return h('div', { class: 'card crew-card', 'data-id': c.id },
    h('div', { class: 'card-row' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (c.name || '?').split(/\s+/).map(w => [...w][0]).slice(0, 2).join('').toUpperCase()),
      h('div', { class: 'grow' }, h('strong', null, c.name), h('div', { class: 'muted' }, [c.role, rateText(c, db.profile.currency || '$')].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + c.name, onclick: () => edit(c) }, '✎')),
    h('div', { class: 'actions' },
      link && h('a', { class: 'btn ghost small', href: link, target: '_blank', rel: 'noopener noreferrer' }, '▶ View work'),
      c.phone && h('a', { class: 'btn ghost small', href: telUrl(c.phone) }, '📞 Call'),
      c.phone && h('a', { class: 'btn ghost small', href: 'sms:' + telUrl(c.phone).slice(4) }, '💬 Text'),
      c.email && h('a', { class: 'btn ghost small', href: 'mailto:' + c.email }, '✉ Email')),
    next.length > 0 && h('div', { class: 'muted small' }, 'Booked: ' + next.map(b => `${fmtShort(b.date)} (${b.title})`).join(', ')),
    c.notes && h('div', { class: 'muted small prewrap' }, c.notes));
}

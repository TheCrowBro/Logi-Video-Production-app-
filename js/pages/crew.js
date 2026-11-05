import { h, telUrl, safeUrl, empty, fmtShort, todayISO, personRate, rateText } from '../util.js';
import { db, upsert, remove, crewBookings, endOf } from '../store.js';
import { openForm } from '../form.js';

import { ROLES } from '../workflow.js';
export { ROLES };
const S = { q: '', role: '' };

// An older card holds the rate as it was typed ("$450/day", "£55 an hour"): the form shows the amount it reads and the
// unit, and saves them as a number and a unit.
const rateValues = c => { const r = personRate(c); return { ...c, rate: r.amount === '' ? (c.rate ?? '') : r.amount, rateUnit: c.rateUnit || (r.hourly ? 'hour' : 'day') }; };
function edit(c = {}) {
  openForm({
    title: c.id ? 'Edit crew member' : 'Add trusted crew',
    values: rateValues(c),
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'role', label: 'Role', list: ROLES, placeholder: 'Pick or type a role' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'rate', label: 'Rate', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 450', hint: 'Prices this person’s line on quotes, invoices and the budget: a day rate per shoot day, or an hourly rate for a standard day’s hours.' }, { key: 'rateUnit', label: 'Per', type: 'select', options: [['day', 'Day'], ['hour', 'Hour']] },
      { key: 'link', label: 'Link to their work', type: 'url', placeholder: 'https://… showreel / portfolio' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => upsert('crew', v),
    onDelete: c.id ? () => remove('crew', c.id) : null,
  });
}

export const crew = {
  id: 'crew', label: 'Crew', icon: '👥',
  render(root) {
    const draw = () => {
      const roles = [...new Set(db.crew.map(c => c.role).filter(Boolean))].sort();
      const q = S.q.toLowerCase();
      const list = db.crew.filter(c => (!S.role || c.role === S.role) && (!q || `${c.name} ${c.role} ${c.notes}`.toLowerCase().includes(q)))
        .sort((a, b) => (a.role || '').localeCompare(b.role || '') || a.name.localeCompare(b.name));

      root.replaceChildren(h('div', null,
        h('div', { class: 'page-head' }, h('h1', null, 'Trusted crew'), h('button', { class: 'btn primary', onclick: () => edit() }, '+ Add')),
        db.crew.length > 3 && h('input', { class: 'search', type: 'search', placeholder: 'Search crew…', value: S.q, 'aria-label': 'Search crew', oninput: e => { S.q = e.target.value; draw(); const i = root.querySelector('.search'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); } }),
        roles.length > 1 && h('div', { class: 'chips' },
          h('button', { class: 'chip' + (!S.role ? ' on' : ''), 'aria-pressed': !S.role, onclick: () => { S.role = ''; draw(); } }, 'All'),
          roles.map(r => h('button', { class: 'chip' + (S.role === r ? ' on' : ''), 'aria-pressed': S.role === r, onclick: () => { S.role = S.role === r ? '' : r; draw(); } }, r))),
        list.length
          ? h('div', { class: 'list' }, list.map(card))
          : empty(db.crew.length ? 'No matches.' : 'Add the freelancers you trust — sound, AC, gaffer, editor — with a link to their work.', db.crew.length ? null : h('button', { class: 'btn primary', onclick: () => edit() }, 'Add crew member'))));
    };
    draw();
  },
};

function card(c) {
  const link = safeUrl(c.link);
  const next = crewBookings(c.id).filter(b => endOf(b) >= todayISO()).slice(0, 2);
  return h('div', { class: 'card crew-card', 'data-id': c.id },
    h('div', { class: 'card-row' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (c.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()),
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

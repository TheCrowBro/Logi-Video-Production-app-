import { h, telUrl, safeUrl, empty, fmtShort, todayISO } from '../util.js';
import { db, upsert, remove, crewBookings, endOf } from '../store.js';
import { openForm } from '../form.js';

export const ROLES = ['Director', 'Producer', 'DOP', 'Camera Operator', '1st AC', '2nd AC', 'Gaffer', 'Grip', 'Sound Recordist', 'Boom Operator', 'Drone Pilot', 'Editor', 'Colourist', 'Motion Designer', 'MUA', 'Stylist', 'Runner', 'Location Manager', 'Other'];
const S = { q: '', role: '' };

function edit(c = {}) {
  openForm({
    title: c.id ? 'Edit crew member' : 'Add trusted crew',
    values: c,
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'role', label: 'Role', list: ROLES, placeholder: 'Pick or type a role' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'link', label: 'Link to their work', type: 'url', placeholder: 'https://… showreel / portfolio' },
      { key: 'rate', label: 'Day / hourly rate' },
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
          h('button', { class: 'chip' + (!S.role ? ' on' : ''), onclick: () => { S.role = ''; draw(); } }, 'All'),
          roles.map(r => h('button', { class: 'chip' + (S.role === r ? ' on' : ''), onclick: () => { S.role = S.role === r ? '' : r; draw(); } }, r))),
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
  return h('div', { class: 'card crew-card' },
    h('div', { class: 'card-row' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, (c.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()),
      h('div', { class: 'grow' }, h('strong', null, c.name), h('div', { class: 'muted' }, [c.role, c.rate].filter(Boolean).join(' · '))),
      h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + c.name, onclick: () => edit(c) }, '✎')),
    h('div', { class: 'actions' },
      link && h('a', { class: 'btn ghost small', href: link, target: '_blank', rel: 'noopener noreferrer' }, '▶ View work'),
      c.phone && h('a', { class: 'btn ghost small', href: telUrl(c.phone) }, '📞 Call'),
      c.phone && h('a', { class: 'btn ghost small', href: 'sms:' + telUrl(c.phone).slice(4) }, '💬 Text'),
      c.email && h('a', { class: 'btn ghost small', href: 'mailto:' + c.email }, '✉ Email')),
    next.length > 0 && h('div', { class: 'muted small' }, 'Booked: ' + next.map(b => `${fmtShort(b.date)} (${b.title})`).join(', ')),
    c.notes && h('div', { class: 'muted small prewrap' }, c.notes));
}

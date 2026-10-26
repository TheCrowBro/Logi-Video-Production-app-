import { h, groupBy, empty, fmtShort, todayISO, money } from '../util.js';
import { db, upsert, remove, gearBookings, endOf } from '../store.js';
import { openForm } from '../form.js';

export const CATEGORIES = ['Camera', 'Lens', 'Lighting', 'Audio', 'Support', 'Grip', 'Drone', 'Monitoring', 'Power', 'Media', 'Accessories', 'Other'];
const S = { q: '', cat: '' };

function edit(g = {}) {
  openForm({
    title: g.id ? 'Edit equipment' : 'Add equipment',
    values: g,
    fields: [
      { key: 'name', label: 'Item', required: true, placeholder: 'e.g. Sony FX6 body' },
      { key: 'category', label: 'Category', list: CATEGORIES },
      { key: 'serial', label: 'Serial number' },
      { key: 'value', label: 'Replacement value', type: 'number' },
      { key: 'purchased', label: 'Purchased', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => upsert('gear', v),
    onDelete: g.id ? () => remove('gear', g.id) : null,
  });
}

export const gear = {
  id: 'gear', label: 'Equipment', icon: '🎥',
  render(root) {
    const sym = db.profile.currency || '$';
    const draw = () => {
      const today = todayISO();
      const cats = [...new Set(db.gear.map(g => g.category || 'Other'))].sort();
      const q = S.q.toLowerCase();
      const list = db.gear.filter(g => (!S.cat || (g.category || 'Other') === S.cat) && (!q || `${g.name} ${g.serial} ${g.notes}`.toLowerCase().includes(q)));
      const groups = [...groupBy(list, g => g.category || 'Other')].sort((a, b) => a[0].localeCompare(b[0]));
      const total = db.gear.reduce((s, g) => s + (Number(g.value) || 0), 0);
      const out = db.gear.filter(g => gearBookings(g.id).some(b => endOf(b) >= today)).length;

      root.replaceChildren(h('div', null,
        h('div', { class: 'page-head' }, h('h1', null, 'Equipment'), h('button', { class: 'btn primary', onclick: () => edit() }, '+ Add')),
        db.gear.length > 0 && h('div', { class: 'stats' },
          stat(db.gear.length, 'items'), stat(money(total, sym), 'total value'), stat(out, 'booked ahead')),
        db.gear.length > 5 && h('input', { class: 'search', type: 'search', placeholder: 'Search kit or serial…', value: S.q, 'aria-label': 'Search equipment', oninput: e => { S.q = e.target.value; draw(); const i = root.querySelector('.search'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); } }),
        cats.length > 1 && h('div', { class: 'chips' },
          h('button', { class: 'chip' + (!S.cat ? ' on' : ''), onclick: () => { S.cat = ''; draw(); } }, 'All'),
          cats.map(c => h('button', { class: 'chip' + (S.cat === c ? ' on' : ''), onclick: () => { S.cat = S.cat === c ? '' : c; draw(); } }, c))),
        groups.length
          ? groups.map(([cat, items]) => h('section', { class: 'block' }, h('h3', null, cat),
            h('div', { class: 'list' }, items.sort((a, b) => a.name.localeCompare(b.name)).map(item => card(item, today, sym)))))
          : empty(db.gear.length ? 'No matches.' : 'Log every camera, lens, light and mic you own. Then assign them to shoots on the Bookings page.', db.gear.length ? null : h('button', { class: 'btn primary', onclick: () => edit() }, 'Add first item'))));
    };
    draw();
  },
};

const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));

function card(g, today, sym) {
  const all = gearBookings(g.id);
  const ahead = all.filter(b => endOf(b) >= today);
  const past = all.length - ahead.length;
  return h('div', { class: 'card gear-card' },
    h('div', { class: 'card-row' },
      h('div', { class: 'grow' }, h('strong', null, g.name), h('div', { class: 'muted small' }, [g.serial && 'S/N ' + g.serial, g.value !== '' && g.value != null && money(g.value, sym)].filter(Boolean).join(' · '))),
      h('span', { class: 'pill ' + (ahead.length ? 'st-confirmed' : 'st-delivered') }, ahead.length ? `${ahead.length} booked` : 'Free'),
      h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + g.name, onclick: () => edit(g) }, '✎')),
    ahead.length > 0 && h('ul', { class: 'bk-list' }, ahead.slice(0, 5).map(b => h('li', null, h('b', null, fmtShort(b.date) + (endOf(b) > b.date ? ' – ' + fmtShort(endOf(b)) : '')), ' — ', b.title, b.client && h('span', { class: 'muted' }, ` (${b.client})`)))),
    past > 0 && h('div', { class: 'muted small' }, `Used on ${past} past shoot${past > 1 ? 's' : ''}`),
    g.notes && h('div', { class: 'muted small prewrap' }, g.notes));
}

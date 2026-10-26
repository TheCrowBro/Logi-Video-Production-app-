import { h, groupBy, empty, fmtShort, todayISO, money } from '../util.js';
import { db, upsert, remove, gearBookings, endOf } from '../store.js';
import { openForm } from '../form.js';

export const CATEGORIES = ['Camera', 'Lens', 'Lighting', 'Audio', 'Support', 'Grip', 'Drone', 'Monitoring', 'Power', 'Media', 'Accessories', 'Other'];
const S = { q: '', cat: '', view: 'items' };

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

// Create / edit a reusable kit (a named set of equipment for a type of shoot).
export function editKit(k = {}) {
  openForm({
    title: k.id ? 'Edit kit' : 'New kit',
    values: k,
    fields: [
      { key: 'name', label: 'Kit name', required: true, placeholder: 'e.g. Interview set, Car shoot' },
      { key: 'description', label: 'Type of shoot' },
      { key: 'gear', label: 'Equipment in this kit', type: 'checks', options: db.gear.map(g => ({ value: g.id, label: g.name, group: g.category || 'Other' })).sort((a, b) => a.group.localeCompare(b.group)), empty: 'Add equipment first, then build kits from it.' },
      { key: 'notes', label: 'Notes / reminders', type: 'textarea', hint: 'Consumables, permits or things to buy or hire that are not in your inventory.' },
    ],
    onSave: v => upsert('kits', v),
    onDelete: k.id ? () => remove('kits', k.id) : null,
  });
}

function kitsView(sym) {
  const dupe = k => upsert('kits', { ...k, id: undefined, name: k.name + ' (copy)' });
  return h('div', null,
    h('p', { class: 'muted small' }, 'A kit is a saved list of gear for a type of shoot. Tick a kit when you create a booking and its equipment is added for you.'),
    db.kits.length
      ? h('div', { class: 'list' }, db.kits.map(k => {
        const items = (k.gear || []).map(id => db.gear.find(g => g.id === id)).filter(Boolean);
        const value = items.reduce((s, g) => s + (Number(g.value) || 0), 0);
        const groups = groupBy(items, g => g.category || 'Other');
        return h('div', { class: 'card' },
          h('div', { class: 'card-row' },
            h('div', { class: 'grow' }, h('strong', null, k.name), h('div', { class: 'muted small' }, [k.description, `${items.length} items`, money(value, sym)].filter(Boolean).join(' · '))),
            h('button', { class: 'icon-btn', 'aria-label': 'Duplicate ' + k.name, onclick: () => dupe(k) }, '⧉'),
            h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + k.name, onclick: () => editKit(k) }, '✎')),
          [...groups].map(([cat, list]) => h('div', { class: 'kit-line' }, h('b', null, cat + ': '), list.map(g => g.name).join(', '))),
          k.notes && h('div', { class: 'muted small prewrap' }, k.notes));
      }))
      : empty('No kits yet. Build one for each kind of job you take on.', h('button', { class: 'btn primary', onclick: () => editKit() }, 'Create a kit')));
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
        h('div', { class: 'page-head' }, h('h1', null, 'Equipment'), h('button', { class: 'btn primary', onclick: () => (S.view === 'kits' ? editKit() : edit()) }, S.view === 'kits' ? '+ New kit' : '+ Add')),
        h('div', { class: 'seg', role: 'tablist' },
          h('button', { class: S.view === 'items' ? 'on' : '', role: 'tab', 'aria-selected': S.view === 'items', onclick: () => { S.view = 'items'; draw(); } }, `Items (${db.gear.length})`),
          h('button', { class: S.view === 'kits' ? 'on' : '', role: 'tab', 'aria-selected': S.view === 'kits', onclick: () => { S.view = 'kits'; draw(); } }, `Kits (${db.kits.length})`)),
        S.view === 'kits' ? kitsView(sym) : [
        db.gear.length > 0 && h('div', { class: 'stats' },
          stat(db.gear.length, 'items'), stat(money(total, sym), 'total value'), stat(out, 'booked ahead')),
        db.gear.length > 5 && h('input', { class: 'search', type: 'search', placeholder: 'Search kit or serial…', value: S.q, 'aria-label': 'Search equipment', oninput: e => { S.q = e.target.value; draw(); const i = root.querySelector('.search'); i.focus(); i.setSelectionRange(S.q.length, S.q.length); } }),
        cats.length > 1 && h('div', { class: 'chips' },
          h('button', { class: 'chip' + (!S.cat ? ' on' : ''), 'aria-pressed': !S.cat, onclick: () => { S.cat = ''; draw(); } }, 'All'),
          cats.map(c => h('button', { class: 'chip' + (S.cat === c ? ' on' : ''), 'aria-pressed': S.cat === c, onclick: () => { S.cat = S.cat === c ? '' : c; draw(); } }, c))),
        groups.length
          ? groups.map(([cat, items]) => h('section', { class: 'block' }, h('h3', null, cat),
            h('div', { class: 'list' }, items.sort((a, b) => a.name.localeCompare(b.name)).map(item => card(item, today, sym)))))
          : empty(db.gear.length ? 'No matches.' : 'Log every camera, lens, light and mic you own. Then assign them to shoots on the Bookings page.', db.gear.length ? null : h('button', { class: 'btn primary', onclick: () => edit() }, 'Add first item'))]));
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

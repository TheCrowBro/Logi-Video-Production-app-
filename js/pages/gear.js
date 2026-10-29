import { h, groupBy, empty, fmtShort, todayISO, money, parseISO, ymd, daysUntil, sheet, toast, nodes, uid } from '../util.js';
import { exportAssetRegister } from '../backup.js';
import { db, upsert, remove, gearBookings, endOf, qtyOf, usedQty, totalValue, byId } from '../store.js';
import { openForm } from '../form.js';

export const CATEGORIES = ['Camera', 'Lens', 'Lighting', 'Audio', 'Support', 'Grip', 'Drone', 'Monitoring', 'Power', 'Media', 'Accessories', 'Other'];
const S = { q: '', cat: '', view: 'items' };

function edit(g = {}) {
  openForm({
    title: g.id ? 'Edit equipment' : 'Add equipment',
    values: { qty: 1, ...g },
    fields: [
      { key: 'name', label: 'Item', required: true, placeholder: 'e.g. Sony FX6 body' },
      { key: 'category', label: 'Category', list: CATEGORIES },
      { key: 'serial', label: 'Serial number' },
      { key: 'qty', label: 'Quantity owned', type: 'number', min: 1, hint: 'Bought 4 of the same light? Enter 4 here.' },
      { key: 'value', label: 'Replacement value (each)', type: 'number' },
      { key: 'purchased', label: 'Purchased', type: 'date' },
      { key: 'warranty', label: 'Warranty until', type: 'date' },
      { key: 'serviceEvery', label: 'Service every (months)', type: 'number', min: 0, hint: 'Vdex reminds you when a service, clean or calibration is due.' },
      { key: 'firmware', label: 'Firmware version' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onSave: v => upsert('gear', { ...v, qty: Math.max(1, Math.floor(Number(v.qty)) || 1) }),
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
      { key: 'gear', qtyKey: 'gearQty', label: 'Equipment in this kit', type: 'checks', options: db.gear.map(g => ({ value: g.id, label: g.name, group: g.category || 'Other', qtyMax: qtyOf(g) })).sort((a, b) => a.group.localeCompare(b.group)), empty: 'Add equipment first, then build kits from it.' },
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
        const value = items.reduce((s, g) => s + (Number(g.value) || 0) * usedQty(k, g.id), 0);
        const units = items.reduce((s, g) => s + usedQty(k, g.id), 0);
        const groups = groupBy(items, g => g.category || 'Other');
        return h('div', { class: 'card' },
          h('div', { class: 'card-row' },
            h('div', { class: 'grow' }, h('strong', null, k.name), h('div', { class: 'muted small' }, [k.description, `${units} item${units === 1 ? '' : 's'}`, money(value, sym)].filter(Boolean).join(' · '))),
            h('button', { class: 'icon-btn', 'aria-label': 'Duplicate ' + k.name, onclick: () => dupe(k) }, '⧉'),
            h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + k.name, onclick: () => editKit(k) }, '✎')),
          [...groups].map(([cat, list]) => h('div', { class: 'kit-line' }, h('b', null, cat + ': '), list.map(g => g.name + (usedQty(k, g.id) > 1 ? ` ×${usedQty(k, g.id)}` : '')).join(', '))),
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
      const total = db.gear.reduce((s, g) => s + totalValue(g), 0);
      const units = db.gear.reduce((s, g) => s + qtyOf(g), 0);
      const out = db.gear.filter(g => gearBookings(g.id).some(b => endOf(b) >= today)).length;

      root.replaceChildren(h('div', null,
        h('div', { class: 'page-head' }, h('h1', null, 'Equipment'), h('button', { class: 'btn primary', onclick: () => (S.view === 'kits' ? editKit() : edit()) }, S.view === 'kits' ? '+ New kit' : '+ Add')),
        h('div', { class: 'subactions' }, h('button', { class: 'btn ghost small', onclick: () => exportAssetRegister() }, '🧾 Asset register (CSV)')),
        h('div', { class: 'seg', role: 'tablist' },
          h('button', { class: S.view === 'items' ? 'on' : '', role: 'tab', 'aria-selected': S.view === 'items', onclick: () => { S.view = 'items'; draw(); } }, `Items (${db.gear.reduce((s, g) => s + qtyOf(g), 0)})`),
          h('button', { class: S.view === 'kits' ? 'on' : '', role: 'tab', 'aria-selected': S.view === 'kits', onclick: () => { S.view = 'kits'; draw(); } }, `Kits (${db.kits.length})`)),
        S.view === 'kits' ? kitsView(sym) : [
        serviceAlerts().length > 0 && h('div', { class: 'warn small' }, h('strong', null, '🔧 Due: '), serviceAlerts().map(x => `${x.g.name} (${x.states.map(st => st.text.toLowerCase()).join(', ')})`).join(' · ')),
        db.gear.length > 0 && h('div', { class: 'stats' },
          stat(units, 'items'), stat(money(total, sym), 'total value'), stat(out, 'booked ahead')),
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

/* -------------------------------- service log -------------------------------- */
// Per-item history of services, cleans, repairs, firmware updates and calibrations, with a service interval and the
// warranty date, so the Equipment page can say what is due before a shoot does.
export const LOG_KINDS = [['service', '🔧 Service'], ['clean', '🧽 Sensor / lens clean'], ['calibration', '🎯 Calibration'], ['check', '✅ Check / test'], ['repair', '🛠 Repair'], ['firmware', '⬆️ Firmware update'], ['other', '📝 Other']];
const kindLabel = k => (LOG_KINDS.find(x => x[0] === k) || LOG_KINDS[6])[1];
const monthsLater = (iso, n) => { const d = parseISO(iso); return ymd(new Date(d.getFullYear(), d.getMonth() + n, d.getDate())); };
export const lastService = g => (g.log || []).filter(e => ['service', 'clean', 'calibration', 'check'].includes(e.kind) && e.date).map(e => e.date).sort().pop() || '';
export const serviceDue = g => { const every = Number(g.serviceEvery) || 0; if (!every) return ''; const from = lastService(g) || g.purchased; return from ? monthsLater(from, every) : ''; };
export function serviceState(g) {
  const out = [], due = serviceDue(g), today = todayISO();
  if (due && due <= today) out.push({ level: 'due', text: `Service overdue (was due ${fmtShort(due)})` });
  else if (due && daysUntil(due) <= 30) out.push({ level: 'soon', text: `Service due ${fmtShort(due)}` });
  if (g.warranty) { const d = daysUntil(g.warranty); if (d < 0 && d >= -30) out.push({ level: 'soon', text: `Warranty ended ${fmtShort(g.warranty)}` }); else if (d >= 0 && d <= 60) out.push({ level: 'soon', text: `Warranty ends ${fmtShort(g.warranty)}` }); }
  return out;
}
export const serviceAlerts = () => db.gear.map(g => ({ g, states: serviceState(g) })).filter(x => x.states.length);
function addLogEntry(g, onDone) {
  openForm({ title: 'Log entry: ' + g.name, values: { date: todayISO(), kind: 'service', note: '', cost: '', firmware: '' },
    fields: [{ key: 'date', label: 'Date', type: 'date', required: true }, { key: 'kind', label: 'What', type: 'select', options: LOG_KINDS }, { key: 'note', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Where, what was done, who did it…' }, { key: 'cost', label: 'Cost', type: 'number', min: 0 }, { key: 'firmware', label: 'Firmware now (optional)', placeholder: 'Updates the item’s firmware version' }],
    onSave: v => { const cur = byId('gear', g.id); upsert('gear', { ...cur, log: [...(cur.log || []), { id: uid(), date: v.date, kind: v.kind, note: v.note, cost: v.cost }], ...(v.firmware ? { firmware: v.firmware } : {}) }); toast('Logged'); onDone && onDone(); } });
}
export function serviceSheet(g0) {
  const body = h('div', { class: 'stack' });
  let close = () => {};
  const draw = () => {
    const g = byId('gear', g0.id); if (!g) return close();
    const entries = [...(g.log || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const states = serviceState(g), due = serviceDue(g);
    body.replaceChildren(...nodes(
      states.length ? states.map(s => h('p', { class: 'warn small' }, (s.level === 'due' ? '⚠ ' : '⏰ ') + s.text)) : h('p', { class: 'small muted' }, [due ? `Next service due ${fmtShort(due)}` : 'No service interval set', g.warranty ? `warranty until ${fmtShort(g.warranty)}` : null, g.firmware ? `firmware ${g.firmware}` : null].filter(Boolean).join(' · ')),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => addLogEntry(g, draw) }, '+ Log an entry'), h('button', { class: 'btn ghost small', onclick: () => { close(); edit(g); } }, 'Edit item (interval, warranty, firmware)')),
      entries.length ? h('div', { class: 'list' }, ...entries.map(e => h('div', { class: 'card card-row' }, h('div', null, h('strong', null, kindLabel(e.kind)), h('div', { class: 'muted small' }, [e.date && fmtShort(e.date), e.cost !== '' && e.cost != null && money(e.cost, db.profile.currency || '$'), e.note].filter(Boolean).join(' · '))),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove entry', onclick: () => { if (confirm('Remove this entry?')) { upsert('gear', { ...byId('gear', g.id), log: (byId('gear', g.id).log || []).filter(x => x.id !== e.id) }); draw(); } } }, '✕'))))
        : h('p', { class: 'muted' }, 'Nothing logged yet. Services, sensor cleans, repairs, firmware updates and calibrations go here, so you know when each item was last looked after.')));
  };
  ({ close } = sheet('Service log: ' + g0.name, body));
  draw();
}
// A quiet reminder at most every three days when something is overdue.
export function serviceNudge() {
  const due = serviceAlerts().filter(x => x.states.some(s => s.level === 'due'));
  if (!due.length) return;
  let last = 0; try { last = Number(localStorage.getItem('logi-service-nudge')) || 0; } catch { /* ignore */ }
  if (Date.now() - last < 3 * 864e5) return;
  try { localStorage.setItem('logi-service-nudge', String(Date.now())); } catch { /* ignore */ }
  setTimeout(() => toast(`${due.length} item${due.length === 1 ? ' is' : 's are'} overdue for service. Equipment page.`), 2500);
}


function card(g, today, sym) {
  const all = gearBookings(g.id);
  const ahead = all.filter(b => endOf(b) >= today);
  const past = all.length - ahead.length;
  return h('div', { class: 'card gear-card' },
    h('div', { class: 'card-row' },
      h('div', { class: 'grow' }, h('strong', null, g.name), h('div', { class: 'muted small' }, [qtyOf(g) > 1 && `${qtyOf(g)} owned`, g.serial && 'S/N ' + g.serial, g.value !== '' && g.value != null && money(g.value, sym) + (qtyOf(g) > 1 ? ' each' : '')].filter(Boolean).join(' · '))),
      h('span', { class: 'pill ' + (ahead.length ? 'st-confirmed' : 'st-delivered') }, ahead.length ? `${ahead.length} booked` : 'Free'),
      h('button', { class: 'icon-btn', 'aria-label': 'Service log for ' + g.name, title: 'Service log', onclick: () => serviceSheet(g) }, '🔧'),
      h('button', { class: 'icon-btn', 'aria-label': 'Edit ' + g.name, onclick: () => edit(g) }, '✎')),
    serviceState(g).map(st => h('div', { class: (st.level === 'due' ? 'warn' : 'note') + ' small' }, (st.level === 'due' ? '⚠ ' : '⏰ ') + st.text)),
    ahead.length > 0 && h('ul', { class: 'bk-list' }, ahead.slice(0, 5).map(b => h('li', null, h('b', null, fmtShort(b.date) + (endOf(b) > b.date ? ' – ' + fmtShort(endOf(b)) : '')), (usedQty(b, g.id) > 1 ? ` ×${usedQty(b, g.id)}` : ''), ' — ', b.title, b.client && h('span', { class: 'muted' }, ` (${b.client})`)))),
    past > 0 && h('div', { class: 'muted small' }, `Used on ${past} past shoot${past > 1 ? 's' : ''}`),
    g.notes && h('div', { class: 'muted small prewrap' }, g.notes));
}

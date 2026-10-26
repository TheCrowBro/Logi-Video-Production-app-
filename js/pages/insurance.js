import { h, telUrl, safeUrl, empty, money, daysUntil, parseISO } from '../util.js';
import { db, upsert, remove, totalValue } from '../store.js';
import { openForm } from '../form.js';

const TYPES = ['Equipment', 'Public Liability', 'Professional Indemnity', 'Employers Liability', 'Drone', 'Vehicle', 'Travel', 'Business Interruption', 'Other'];

function edit(p = {}) {
  openForm({
    title: p.id ? 'Edit policy' : 'Add policy',
    values: p,
    fields: [
      { key: 'type', label: 'Type of cover', list: TYPES, required: true },
      { key: 'provider', label: 'Provider / broker', required: true },
      { key: 'policy', label: 'Policy number' },
      { key: 'cover', label: 'Sum insured / limit', type: 'number' },
      { key: 'premium', label: 'Annual premium', type: 'number' },
      { key: 'renewal', label: 'Renewal / expiry date', type: 'date' },
      { key: 'phone', label: 'Provider phone', type: 'tel' },
      { key: 'claims', label: 'Claims line', type: 'tel' },
      { key: 'link', label: 'Link to policy document', type: 'url', placeholder: 'Share link from your cloud drive' },
      { key: 'notes', label: 'Notes / exclusions', type: 'textarea' },
    ],
    onSave: v => upsert('insurance', v),
    onDelete: p.id ? () => remove('insurance', p.id) : null,
  });
}

export const insurance = {
  id: 'insurance', label: 'Insurance', icon: '🛡️',
  render(root) {
    const sym = db.profile.currency || '$';
    const list = [...db.insurance].sort((a, b) => (a.renewal || '9999').localeCompare(b.renewal || '9999'));
    const gearValue = db.gear.reduce((s, g) => s + totalValue(g), 0);
    const eqCover = db.insurance.filter(p => /equip|gear|kit/i.test(p.type) && (!p.renewal || daysUntil(p.renewal) >= 0)).reduce((s, p) => s + (Number(p.cover) || 0), 0);
    const annual = db.insurance.reduce((s, p) => s + (Number(p.premium) || 0), 0);

    root.append(h('div', null,
      h('div', { class: 'page-head' }, h('h1', null, 'Insurance'), h('button', { class: 'btn primary', onclick: () => edit() }, '+ Add')),
      db.insurance.length > 0 && h('div', { class: 'stats' }, stat(db.insurance.length, 'policies'), stat(money(annual, sym), 'premiums / yr'), stat(money(gearValue, sym), 'kit value logged')),
      gearValue > 0 && db.insurance.length > 0 && eqCover < gearValue && h('div', { class: 'warn' }, `⚠ Active equipment cover (${money(eqCover, sym)}) is below the value of logged kit (${money(gearValue, sym)}).`),
      list.length
        ? h('div', { class: 'list' }, list.map(p => card(p, sym)))
        : empty('Keep policy numbers, claims lines and renewal dates in one place — handy when a client or venue asks for your certificate.', h('button', { class: 'btn primary', onclick: () => edit() }, 'Add a policy'))));
  },
};

const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));

function card(p, sym) {
  const d = p.renewal ? daysUntil(p.renewal) : null;
  const tone = d == null ? '' : d < 0 ? 'st-cancelled' : d <= 30 ? 'st-enquiry' : 'st-confirmed';
  const link = safeUrl(p.link);
  return h('div', { class: 'card' },
    h('div', { class: 'card-row' },
      h('div', { class: 'grow' }, h('strong', null, p.type), h('div', { class: 'muted' }, [p.provider, p.policy && '#' + p.policy].filter(Boolean).join(' · '))),
      d != null && h('span', { class: 'pill ' + tone }, d < 0 ? `Expired ${-d}d ago` : d === 0 ? 'Expires today' : `${d} days left`),
      h('button', { class: 'icon-btn', 'aria-label': 'Edit policy', onclick: () => edit(p) }, '✎')),
    h('div', { class: 'kv' },
      p.cover !== '' && p.cover != null && kv('Cover', money(p.cover, sym)),
      p.premium !== '' && p.premium != null && kv('Premium', money(p.premium, sym) + ' / yr'),
      p.renewal && kv('Renews', parseISO(p.renewal).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))),
    h('div', { class: 'actions' },
      p.phone && h('a', { class: 'btn ghost small', href: telUrl(p.phone) }, '📞 Provider'),
      p.claims && h('a', { class: 'btn ghost small', href: telUrl(p.claims) }, '🚨 Claims'),
      link && h('a', { class: 'btn ghost small', href: link, target: '_blank', rel: 'noopener noreferrer' }, '📄 Document')),
    p.notes && h('div', { class: 'muted small prewrap' }, p.notes));
}
const kv = (k, v) => h('div', null, h('span', { class: 'muted' }, k), h('b', null, v));

// Insurance: the band's and the studio's policies in one place (instruments & equipment, public liability…), when
// each one renews, the certificate a venue asks for, and a check that the instruments & equipment cover is at least
// what the backline is worth (Backline's values × quantities).
import { h, telUrl, safeUrl, empty, daysUntil, parseISO, toast } from '../util.js';
import { db, upsert, remove, byId, totalValue } from '../store.js';
import { fmtMoney } from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';

const TYPES = ['Instruments & equipment', 'Public liability', 'Employers liability', 'Travel & touring', 'Vehicle', 'Event cancellation', 'Professional indemnity', 'Studio contents', 'Other'];
const ICONS = { instrument: '🎸', public: '👥', employer: '👷', travel: '✈️', vehicle: '🚐', cancel: '📅', indemnity: '⚖️', studio: '🎚️' };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
const has = v => v !== '' && v != null && Number.isFinite(Number(v));
// Instruments & equipment cover (also "gear", "backline" in a typed type). Studio contents is a separate policy.
const isEquipment = p => /instrument|equipment|\bgear\b|backline/i.test((p && p.type) || '');
const daysLeft = p => (ISO.test((p && p.renewal) || '') ? daysUntil(p.renewal) : null);
const isActive = p => { const d = daysLeft(p); return d == null || d >= 0; };
const iconOf = p => { const t = String(p.type || '').toLowerCase(); const k = Object.keys(ICONS).find(x => t.includes(x)) || (isEquipment(p) ? 'instrument' : ''); return k ? ICONS[k] : '🛡️'; };
const fmtDate = iso => parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const byRenewal = (a, b) => (ISO.test(a.renewal || '') ? a.renewal : '9999').localeCompare(ISO.test(b.renewal || '') ? b.renewal : '9999') || String(a.type || '').localeCompare(String(b.type || ''));
const days = n => `${n} day${n === 1 ? '' : 's'}`;

function renewalPill(p) {
  const d = daysLeft(p);
  if (d == null) return null;
  const [tone, text] = d < 0 ? ['ins-expired', `Expired ${days(-d)} ago`] : d === 0 ? ['ins-due', 'Renews today'] : d === 1 ? ['ins-due', 'Renews tomorrow'] : d <= 30 ? ['ins-due', `${days(d)} left`] : ['ins-ok', `${days(d)} left`];
  return h('span', { class: 'pill ins-pill ' + tone, title: 'Renews or ends on ' + fmtDate(p.renewal) }, text);
}

function edit(p = {}) {
  const stored = !!(p.id && byId('insurance', p.id));
  openForm({
    title: stored ? 'Edit policy' : 'Add policy',
    values: { ...p },
    fields: [
      { key: 'type', label: 'Type of cover', list: TYPES, required: true, placeholder: 'Pick or type' },
      { key: 'provider', label: 'Insurer or broker', required: true },
      { key: 'policy', label: 'Policy number' },
      { key: 'cover', label: 'Cover (sum insured or limit)', type: 'number', min: 0, step: 'any', placeholder: 'e.g. 12000', hint: 'For instruments & equipment, at least what your backline is worth.' },
      { key: 'premium', label: 'Premium a year', type: 'number', min: 0, step: 'any' },
      { key: 'renewal', label: 'Renews or ends on', type: 'date' },
      { key: 'phone', label: 'Insurer phone', type: 'tel' },
      { key: 'claims', label: 'Claims line', type: 'tel' },
      { key: 'link', label: 'Certificate or policy link', type: 'url', placeholder: 'A share link from your cloud drive', hint: 'Venues and promoters often ask for the public liability certificate: keep a link here to send it in a tap.' },
      { key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'What’s covered, the excess, exclusions (gear left in the van overnight, abroad…)' },
    ],
    saveLabel: stored ? 'Save' : 'Add',
    onSave: v => {
      const rec = { ...v, type: String(v.type || '').trim() || 'Other', provider: String(v.provider || '').trim() };
      for (const k of ['cover', 'premium']) if (has(rec[k])) rec[k] = Math.max(0, Number(rec[k]));
      upsert('insurance', rec);
      toast(stored ? 'Policy saved' : 'Policy added');
    },
    onDelete: stored ? () => { remove('insurance', p.id); toast('Policy deleted'); } : null,
  });
}

// An email with the policy's details and the certificate link, for a venue or promoter. Never the premium.
function sendUrl(p) {
  const who = String(db.profile.business || db.profile.name || '').trim();
  const subject = `${p.type || 'Insurance'} certificate${who ? ' – ' + who : ''}`;
  const details = [p.provider && `Insurer: ${p.provider}`, p.policy && `Policy number: ${p.policy}`, num(p.cover) > 0 && `Cover: ${fmtMoney(num(p.cover))}`,
    ISO.test(p.renewal || '') && `Valid until: ${fmtDate(p.renewal)}`, safeUrl(p.link) && `Certificate: ${safeUrl(p.link)}`].filter(Boolean);
  const body = ['Hi,', '', `Here are our ${String(p.type || 'insurance').toLowerCase()} details:`, ...details, '', 'Thanks,', who].join('\n').trim();
  return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

const stat = (v, l, cls) => h('div', { class: 'stat ' + (cls || '') }, h('b', null, v), h('span', null, l));
const kv = (k, v) => h('div', null, h('span', { class: 'muted' }, k), h('b', null, v));

function card(p) {
  const link = safeUrl(p.link), d = daysLeft(p);
  const tel = /\d/.test(p.phone || '') ? telUrl(p.phone) : '', claims = /\d/.test(p.claims || '') ? telUrl(p.claims) : '';
  const name = p.type || 'Policy';
  return h('div', { class: 'card ins-card' + (d != null && d < 0 ? ' ins-old' : ''), 'data-id': p.id },
    h('div', { class: 'card-row ins-row' },
      h('span', { class: 'ins-ico', 'aria-hidden': 'true' }, iconOf(p)),
      h('div', { class: 'grow ins-title' }, h('strong', null, name), h('div', { class: 'muted small' }, [p.provider, p.policy && '#' + p.policy].filter(Boolean).join(' · ') || 'No insurer yet')),
      renewalPill(p),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Edit ${name} policy`, onclick: () => edit(p) }, '✎')),
    (has(p.cover) || has(p.premium) || ISO.test(p.renewal || '')) && h('div', { class: 'kv ins-kv' },
      has(p.cover) && kv('Cover', num(p.cover) > 0 ? fmtMoney(num(p.cover)) : 'None'),
      has(p.premium) && kv('Premium', fmtMoney(num(p.premium)) + ' a year'),
      ISO.test(p.renewal || '') && kv(d != null && d < 0 ? 'Ended' : 'Renews', fmtDate(p.renewal))),
    (tel || claims || link) && h('div', { class: 'actions ins-actions' },
      link && h('a', { class: 'btn ghost small ins-cert', href: link, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open the ${name} certificate` }, '📄 Certificate'),
      link && h('a', { class: 'btn ghost small ins-send', href: sendUrl(p), 'aria-label': `Email the ${name} certificate` }, '✉ Send'),
      tel && h('a', { class: 'btn ghost small', href: tel, 'aria-label': `Call ${p.provider || 'the insurer'}` }, '📞 Insurer'),
      claims && h('a', { class: 'btn ghost small', href: claims, 'aria-label': `Call the claims line for ${name}` }, '🚨 Claims')),
    p.notes && h('div', { class: 'muted small prewrap ins-notes' }, p.notes));
}

// Instruments & equipment cover against the backline's value: a warning when it falls short, a quiet line when it's fine.
function coverCheck(gearValue, eq) {
  const live = eq.filter(isActive), cover = live.reduce((s, p) => s + num(p.cover), 0), expired = eq.length - live.length;
  const biggest = [...live].sort((a, b) => num(b.cover) - num(a.cover))[0];
  const toBackline = h('button', { class: 'btn ghost small', type: 'button', id: 'ins-backline', onclick: () => window.logiGo && window.logiGo('backline') }, '🎛️ Open Backline');
  if (!gearValue) {
    return live.length ? h('div', { class: 'ins-note ins-cover' }, h('p', null, 'Add your instruments and gear under Backline, with what each is worth, to check this cover against it.'), h('div', { class: 'actions' }, toBackline)) : null;
  }
  if (cover < gearValue) {
    const fix = biggest
      ? h('button', { class: 'btn primary small', type: 'button', id: 'ins-raise', onclick: () => edit(biggest) }, '✎ Update the cover')
      : h('button', { class: 'btn primary small', type: 'button', id: 'ins-add-eq', onclick: () => edit({ type: 'Instruments & equipment', cover: Math.ceil(gearValue / 100) * 100 }) }, '+ Add instruments cover');
    return h('div', { class: 'warn ins-warn ins-cover', role: 'note' },
      h('p', null, cover > 0
        ? `⚠ Your instruments & equipment cover (${fmtMoney(cover)}) is ${fmtMoney(gearValue - cover)} short of what your backline is worth (${fmtMoney(gearValue)}).`
        : `⚠ Your backline is worth ${fmtMoney(gearValue)}, and there is no ${eq.length ? 'current ' : ''}instruments & equipment cover here.`,
      expired ? ` ${expired === 1 ? 'An expired policy is' : expired + ' expired policies are'} not counted.` : ''),
      h('div', { class: 'actions' }, fix, toBackline));
  }
  const spare = cover - gearValue;
  return h('div', { class: 'ins-note ins-ok-note ins-cover' },
    h('p', null, `✓ Your instruments & equipment cover (${fmtMoney(cover)}) is more than your backline is worth (${fmtMoney(gearValue)}).`,
      spare < cover * 0.1 ? ` Only ${fmtMoney(spare)} to spare: raise it before you buy more gear.` : ''),
    h('div', { class: 'actions' }, toBackline));
}

export const insurance = {
  id: 'insurance', label: 'Insurance', icon: '🛡️',
  render(root) {
    const list = [...db.insurance].sort(byRenewal);
    const gearValue = db.gear.reduce((s, g) => s + totalValue(g), 0);
    const eq = db.insurance.filter(isEquipment);
    const annual = db.insurance.filter(isActive).reduce((s, p) => s + num(p.premium), 0);
    const soon = list.filter(p => { const d = daysLeft(p); return d != null && d >= 0 && d <= 30; });
    const expired = list.filter(p => !isActive(p));
    const add = () => edit();

    root.append(h('div', { class: 'ins-page' },
      h('div', { class: 'page-head' }, h('h1', null, 'Insurance'), h('button', { class: 'btn primary', type: 'button', id: 'ins-add', 'aria-label': 'Add a policy', onclick: add }, '+ Add')),
      list.length > 0 && h('div', { class: 'stats ins-stats' },
        stat(String(list.length), list.length === 1 ? 'policy' : 'policies'),
        stat(fmtMoney(annual), 'premiums a year'),
        stat(fmtMoney(gearValue), 'backline value')),
      (soon.length > 0 || expired.length > 0) && h('p', { class: 'small ins-soon', role: 'status' },
        [soon.length && `${soon.length === 1 ? '1 policy renews' : soon.length + ' policies renew'} within 30 days`, expired.length && `${expired.length} expired`].filter(Boolean).join(' · ') + '.'),
      (list.length > 0 || gearValue > 0) && coverCheck(gearValue, eq),
      list.length
        ? h('div', { class: 'list ins-list' }, list.map(card))
        : empty('Keep policy numbers, claims lines and renewal dates in one place, and the certificate a venue asks for one tap away.', h('button', { class: 'btn primary', type: 'button', id: 'ins-empty-add', onclick: add }, '+ Add a policy'))));
  },
  tutorial: () => [
    { title: 'Insurance', text: 'Your policies in one place: instruments & equipment, public liability, travel, the van. Tap + Add for a new one.', target: ['.ins-page .page-head'] },
    { title: 'At a glance', text: 'How many policies, what they cost a year, and what your backline is worth.', target: ['.ins-stats'] },
    { title: 'Cover vs backline', text: 'Your instruments & equipment cover against the value of everything under Backline. A warning shows when the cover falls short.', target: ['.ins-cover'] },
    { title: 'Renewals', text: 'Each policy shows the days left. It turns to the accent colour 30 days before it renews, and red once it has expired.', target: ['.ins-pill'] },
    { title: 'The certificate', text: 'Open it, or send it to a venue or promoter by email with the policy details.', target: ['.ins-cert', '.ins-card'] },
    { title: 'Edit', text: 'Change the cover, renewal date, phone numbers and notes, or delete the policy.', target: ['.ins-card .icon-btn'] },
    { title: 'Nothing here yet', text: 'Add your instruments & equipment cover first, then public liability: venues ask for it.', target: ['#ins-empty-add'] },
  ],
};

const formSteps = [
  { title: 'Type of cover', text: 'Pick one or type your own. Instruments & equipment cover is checked against your backline.', target: ['[data-key=type]'] },
  { title: 'Cover', text: 'The sum insured, or the limit for liability cover.', target: ['[data-key=cover]'] },
  { title: 'Renewal date', text: 'The page counts down to it and warns you 30 days before.', target: ['[data-key=renewal]'] },
  { title: 'Certificate link', text: 'A link to the certificate in your cloud drive, to send to venues in a tap.', target: ['[data-key=link]'] },
];
sheetTutorial('Add policy', formSteps);
sheetTutorial('Edit policy', formSteps);

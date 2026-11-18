// Settings: everything that isn't a record. Two fold-down groups first (General: display, profile, about and the
// licence; Work & billing: templates, quotes and invoices, hours and breaks), then the sections used while working, in
// the order people reach for them: calendar, field tools, storage and backups, security, and installing.
import { h, toast, nodes } from '../util.js';
import { acceptance } from '../terms.js';
import { db, update } from '../store.js';
import * as store from '../store.js';
import { storagePanel, backupPanel } from '../storage-ui.js';
import { displayPanel, prefsSummary } from '../a11y.js';
import { calendarPanel, calState, phoneLink, phoneState } from '../calendar.js';
import { openInstallHelp, installState } from '../install.js';
import { startTour } from '../tour.js';
import { VERSION, BUILD, BUILT } from '../version.js';
import { updatePanel } from '../update.js';
import * as notify from '../notify.js';
import { templatesPanel, projectTemplatesPanel, projectTemplates } from '../workflow.js';
import { billingPanel, billing } from '../money.js';
import { securityPanel, enabled as lockEnabled, config as lockConfig } from '../lock.js';
import { health as backupHealth } from '../backup.js';
import { openForm } from '../form.js';

const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };
const loc = () => { try { return JSON.parse(LS.get('logi-loc')); } catch { return null; } };

const OPEN = new Set();
export const GENERAL = 'General', WORK = 'Work & billing', STORAGE = 'Storage, sync & backups', ABOUT = 'About & Licence';

// Opens a section by its title, and the group it sits in, wherever it is: reveal('About & Licence').
export function reveal(title) {
  const d = [...document.querySelectorAll('#page details.settings-section, #page details.settings-group')].find(x => x.querySelector(':scope > summary .ss-title')?.textContent === title);
  if (!d) return false;
  for (let p = d; p; p = p.parentElement && p.parentElement.closest('details')) p.open = true;
  const nav = document.getElementById('rolodex'); // sticky at the top: the section lands under it, not behind it
  d.style.scrollMarginTop = `${(nav ? nav.getBoundingClientRect().height : 0) + 8}px`;
  d.scrollIntoView({ block: 'start' });
  d.querySelector(':scope > summary')?.focus({ preventScroll: true });
  return true;
}
// From any page: go to Settings and open that section. Resolves once it is on screen.
export async function openSettingsSection(title) {
  await window.logiGo('settings');
  await new Promise(r => setTimeout(r, 50));
  return reveal(title);
}

// The card of one project template in Settings → Work & billing → Project templates, once that section is on the page
// (the search lands on it). The cards are listed in the order of projectTemplates(). null when there is no such template.
export function templateCard(id) {
  const at = projectTemplates().findIndex(t => t.id === id);
  return at < 0 ? null : document.querySelectorAll('#page details[data-s="Project templates"] .ss-body .list > .card')[at] || null;
}

// Your name, business and contact details: one form, reached from Settings → General → Profile only.
export function editProfile() {
  openForm({
    title: 'Your details',
    values: db.profile,
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'business', label: 'Business name' },
      { key: 'title', label: 'Job title', placeholder: 'Videographer / DOP' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'website', label: 'Website', type: 'url', placeholder: 'https://yourwebsite.com' },
      { key: 'location', label: 'Based in' },
      { key: 'bio', label: 'Short bio', type: 'textarea' },
    ],
    onSave: v => update(d => { d.profile = { ...d.profile, ...v, updatedAt: Date.now() }; }),
  });
}

export const settings = {
  id: 'settings', label: 'Settings', icon: '⚙️',
  render(root) {
    const panels = [storagePanel(), calendarPanel(), securityPanel(), updatePanel()];
    // The licence (js/licence.js): it shows itself only once licences are switched on.
    const licenceSlot = h('div', { class: 'licence-slot' });
    let licence = null, gone = false;
    import('../licence.js').then(m => { if (gone) return; licence = m.licencePanel(); licenceSlot.replaceChildren(licence.el); }).catch(() => {});
    const display = displayPanel({ onTour: () => startTour() });
    // Sections and groups remember whether you opened or closed them, so a saved setting or a sync does not fold the
    // page up. Opening a section inside a closed group opens the group too, so a link straight to it always lands.
    const fold = (cls, title, status, body, open) => {
      const el = h('details', { class: cls, 'data-s': title, open: OPEN.has(title) || (open && !OPEN.has('!' + title)) },
        h('summary', null, h('span', { class: 'ss-title' }, title), status && h('span', { class: 'ss-status muted small' }, status)),
        h('div', { class: cls === 'settings-group' ? 'sg-body' : 'ss-body' }, body));
      // The browser also fires toggle for a details drawn open: that one is not a change of mind, so a group someone
      // folded up stays folded across the redraws a saved setting or a sync causes.
      let known = el.open;
      el.addEventListener('toggle', () => {
        if (el.open === known) return;
        known = el.open;
        if (el.open) { OPEN.add(title); OPEN.delete('!' + title); for (let p = el.parentElement && el.parentElement.closest('details'); p; p = p.parentElement && p.parentElement.closest('details')) p.open = true; }
        else { OPEN.delete(title); OPEN.add('!' + title); }
      });
      return el;
    };
    const section = (title, status, body, open = false) => fold('settings-section', title, status, body, open);
    const group = (title, status, sections, open = false) => fold('settings-group', title, status, sections, open);
    const c = store.cloud, cs = db.calSync || {}, l = loc();
    const calStatus = [cs.provider && cs.provider !== 'apple' && `${cs.provider === 'google' ? 'Google' : 'Microsoft'} · ${calState.status}`, phoneLink() && `this phone · ${phoneState.status}`].filter(Boolean).join(', ') || (cs.feed ? 'live feed on' : 'not linked');
    const storageStatus = () => [`${db.bookings.length} bookings · ${db.gear.length} items`, c.adapter ? `${c.adapter.label} · ${c.paused ? 'paused' : c.status}` : 'this device only', !store.isPaid() ? 'backups with a licence' : backupHealth().level === 'ok' ? `copy ${backupHealth().when}` : backupHealth().level === 'empty' ? '' : '⚠ no recent copy'].filter(Boolean).join(' · ');
    const rate = billing().dayRate, nTemplates = projectTemplates().length;
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
      group(GENERAL, db.profile.name || 'profile not set', [
        section('Display & accessibility', prefsSummary(), display.el),
        section('Profile', db.profile.name || 'not set', profilePanel()),
        section(ABOUT, 'v' + VERSION + (BUILD !== 'dev' ? ' · ' + BUILD : ''), h('div', { class: 'stack' },
          h('p', { class: 'small muted' }, `Vdex ${VERSION}${BUILD !== 'dev' ? ` · build ${BUILD}${BUILT ? ' (' + BUILT + ')' : ''}` : ''}. Bookings, crew, kit, venues, insurance, field tools and timecode notes for freelance videographers. Runs entirely in your browser; your data stays on your device and in the storage you link.`),
          acceptance() && h('p', { class: 'small muted' }, `You agreed to the terms of service on this device on ${new Date(acceptance().at || Date.now()).toLocaleDateString()}.`),
          licenceSlot,
          panels[3].el,
          h('div', { class: 'actions' },
            h('button', { class: 'btn ghost', onclick: () => startTour() }, '🧭 Take the tour'),
            h('a', { class: 'btn ghost', href: 'terms.html', target: '_blank', rel: 'noopener' }, 'Terms of service'),
            h('a', { class: 'btn ghost', href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy'),
            h('a', { class: 'btn ghost', href: 'vendor/LICENSES.md', target: '_blank', rel: 'noopener' }, 'Open-source licences')))),
      ]),
      group(WORK, [rate ? `day rate ${db.profile.currency || '$'}${rate}` : 'rates not set', nTemplates ? `${nTemplates} template${nTemplates === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), [
        section('Project templates', nTemplates ? `${nTemplates} of yours` : 'none yet', projectTemplatesPanel()),
        section('Workflow templates', Object.keys(db.templates || {}).filter(k => k !== 'updatedAt').length ? 'customised' : 'defaults', templatesPanel()),
        section('Quotes & invoices', rate ? `day rate ${db.profile.currency || '$'}${rate}` : 'rates not set', billingPanel()),
        section('Hours & breaks', `${LS.get('logi-stdday') || 10}h day · ${LS.get('logi-breakdefault') || 30} min break`, h('div', { class: 'stack' },
          h('div', { class: 'field' }, h('label', null, 'Standard day (hours)'), h('input', { type: 'number', min: 1, max: 24, step: 0.5, value: LS.get('logi-stdday') || 10, 'aria-label': 'Standard day in hours', onchange: e => { const n = Number(e.target.value); if (!(n >= 1 && n <= 24)) { e.target.value = LS.get('logi-stdday') || 10; return toast('Between 1 and 24 hours'); } LS.set('logi-stdday', String(n)); toast('Saved'); } }), h('small', { class: 'muted' }, 'Anything beyond this on a day counts as overtime in the statistics, and a crew member with an hourly rate is quoted for this many hours per shoot day.')),
          notifyPanel(),
          h('div', { class: 'field' }, h('label', null, 'Default approved break (minutes per day)'), h('input', { type: 'number', min: 0, step: 5, value: LS.get('logi-breakdefault') || 30, 'aria-label': 'Default approved break in minutes', onchange: e => { LS.set('logi-breakdefault', e.target.value); toast('Saved'); } }), h('small', { class: 'muted' }, 'Used when a booking doesn’t set its own.')))),
      ]),
      section('Calendar & email', calStatus, panels[1].el),
      section('Field tool defaults', [l ? `${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}°` : 'no location', LS.get('logi-units') === 'ft' ? 'feet' : 'metres'].join(' · '), fieldDefaults()),
      section(STORAGE, storageStatus(), h('div', { class: 'stack' }, panels[0].el, h('h3', { class: 'ss-sub' }, 'Backups'), backupPanel())),
      section('Security', lockEnabled() ? `PIN set${(lockConfig() || {}).bio ? ' · fingerprint / face' : ''}` : '⚠ no PIN', panels[2].el),
      installState().standalone ? '' : section('Install', installState().canPrompt ? 'ready to install' : 'see how', h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, 'Vdex runs in the browser as it is. Installing adds an icon to your home screen or desktop, opens it full-screen and keeps it available offline.'),
        h('button', { class: 'btn primary', onclick: () => { const b = document.getElementById('installBtn'); if (b && !b.hidden) b.click(); else openInstallHelp(); } }, '⤓ Install Vdex'))));
    // A sign-in changes what the backups can do: update that summary in place (the page is not redrawn).
    const unPaid = store.subscribe(reason => {
      if (reason !== 'licence') return;
      const s = [...root.querySelectorAll('details.settings-section')].find(x => x.querySelector('.ss-title')?.textContent === STORAGE);
      const st = s && s.querySelector('.ss-status'); if (st) st.textContent = storageStatus();
    });
    return () => { gone = true; unPaid(); panels.forEach(p => p.destroy && p.destroy()); if (licence) licence.destroy(); };
  },
};

function notifyPanel() {
  const wrap = h('div', { class: 'stack' });
  const draw = () => {
    const perm = notify.permission(), p = notify.notifyPrefs();
    const row = (label, key, hint, disabled) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!p[key], disabled, onchange: e => { notify.setNotifyPrefs({ [key]: e.target.checked }); draw(); } }), h('span', null, label, h('em', null, ' ' + hint)));
    wrap.replaceChildren(...nodes(
      h('div', { class: 'pref-label' }, 'Break notifications'),
      perm === 'unsupported' ? h('p', { class: 'small muted' }, 'This browser has no notifications.')
        : perm === 'denied' ? h('p', { class: 'warn small' }, 'Notifications are blocked for this site. Allow them in the browser’s site settings, then come back here.')
          : perm !== 'granted' ? h('button', { class: 'btn primary', onclick: async () => { await notify.requestPermission(); draw(); } }, '🔔 Turn on break notifications')
            : [row('Notify me when a timed break is up', 'enabled', 'a system notification with a Back to work button', false),
              row('Also warn two minutes before', 'early', 'for breaks of 10 minutes or more', !p.enabled),
              !notify.closedToo() && 'wakeLock' in navigator && row('Keep the screen on during breaks', 'wake', 'phones suspend the app in the background after a few minutes; a lit screen keeps the countdown alive', !p.enabled)],
      h('p', { class: 'small muted' }, notify.closedToo() ? 'The phone itself keeps the time, so the alert arrives even with Vdex closed or the phone locked, with Back to work and 5 more minutes on it.'
        : 'Works while the app is open on a computer, or in the background on a phone for the first few minutes (or for the whole break with the screen kept on). If the phone has suspended the app, the notification arrives the moment you return to it.')));
  };
  draw();
  return wrap;
}

function fieldDefaults() {
  const l = loc() || {};
  const lat = h('input', { type: 'number', step: 'any', min: -90, max: 90, placeholder: 'Latitude', 'aria-label': 'Latitude', value: l.lat ?? '' });
  const lon = h('input', { type: 'number', step: 'any', min: -180, max: 180, placeholder: 'Longitude', 'aria-label': 'Longitude', value: l.lon ?? '' });
  const saveLoc = () => { const a = parseFloat(lat.value), o = parseFloat(lon.value); if (a >= -90 && a <= 90 && o >= -180 && o <= 180) { LS.set('logi-loc', JSON.stringify({ lat: a, lon: o })); toast('Location saved'); } else if (!lat.value && !lon.value) { LS.set('logi-loc', null); } else toast('Enter a valid latitude and longitude'); };
  const gps = () => { if (!navigator.geolocation) return toast('Location is not available here'); navigator.geolocation.getCurrentPosition(p => { lat.value = +p.coords.latitude.toFixed(4); lon.value = +p.coords.longitude.toFixed(4); saveLoc(); }, () => toast('Could not get your location'), { timeout: 10000 }); };
  const num = (key, label, hint, attrs = {}) => h('div', { class: 'field' }, h('label', null, label), h('input', { type: 'number', step: 'any', value: LS.get(key) ?? '', 'aria-label': label, ...attrs, onchange: e => { LS.set(key, e.target.value); toast('Saved'); } }), h('small', { class: 'muted' }, hint));
  const units = LS.get('logi-units') || 'm';
  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', null, 'Location for the sun and Polaris tools'), h('div', { class: 'row-edit' }, lat, lon), h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: saveLoc }, 'Save'), h('button', { class: 'btn ghost small', onclick: gps }, 'Use GPS'))),
    h('div', { class: 'field' }, h('label', null, 'Distance units'), h('div', { class: 'seg' }, [['m', 'Metres'], ['ft', 'Feet']].map(([v, t]) => h('button', { type: 'button', class: units === v ? 'on' : '', 'aria-pressed': units === v, onclick: e => { LS.set('logi-units', v); e.target.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', b === e.target); }); } }, t)))),
    num('logi-decl', 'Magnetic declination (°, east positive)', 'Lets the compass pointer show true north. Look yours up for your area.'),
    num('logi-eyeh', 'Camera height for the range finder (m)', 'Height of the phone above the ground when you measure.', { min: 0.1 }),
    num('logi-cal', 'Noise meter calibration offset (dB)', 'Adjust once against a reference meter. Default 94.'));
}

// Profile: what is on file, the one place to change it, and the currency everything is priced in.
function profilePanel() {
  const p = db.profile;
  const line = (label, value) => value && h('div', null, h('span', { class: 'muted' }, label), h('span', null, value));
  const cur = h('input', { type: 'text', value: p.currency || '$', 'aria-label': 'Currency symbol', maxLength: 4, onchange: e => { update(d => { d.profile = { ...d.profile, currency: e.target.value.trim() || '$', updatedAt: Date.now() }; }); toast('Saved'); } });
  return h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Your details go on call sheets, quotes and invoices, and make the contact card and QR code on the Me page.'),
    p.name || p.business || p.phone || p.email
      ? h('div', { class: 'card kv profile-kv' }, line('Name', p.name), line('Business', p.business), line('Title', p.title), line('Phone', p.phone), line('Email', p.email), line('Website', p.website), line('Based in', p.location))
      : h('p', { class: 'muted' }, 'No details yet.'),
    p.bio && h('p', { class: 'small prewrap' }, p.bio),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: editProfile }, p.name ? '✎ Edit your details' : '+ Add your details'),
      h('button', { class: 'btn ghost', onclick: () => window.logiGo('me') }, 'Contact card and QR code →')),
    h('div', { class: 'field' }, h('label', null, 'Currency symbol'), cur, h('small', { class: 'muted' }, 'Used for gear values, kit totals, insurance figures, quotes and invoices.')));
}

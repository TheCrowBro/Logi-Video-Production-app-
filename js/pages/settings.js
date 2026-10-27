// Settings: everything that isn't a record — storage, calendar links, display, field-tool defaults, backups, about.
import { h, toast } from '../util.js';
import { db, update } from '../store.js';
import * as store from '../store.js';
import { storagePanel, backupPanel } from '../storage-ui.js';
import { displayPanel, prefsSummary } from '../a11y.js';
import { calendarPanel, calState } from '../calendar.js';
import { openInstallHelp, installState } from '../install.js';
import { startTour } from '../tour.js';
import { VERSION, REPO } from '../version.js';

const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null || v === '' ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };
const loc = () => { try { return JSON.parse(LS.get('logi-loc')); } catch { return null; } };

export const settings = {
  id: 'settings', label: 'Settings', icon: '⚙️',
  render(root) {
    const panels = [storagePanel(), calendarPanel()];
    const display = displayPanel({ onTour: () => startTour() });
    const section = (title, status, body, open = false) => h('details', { class: 'settings-section', open },
      h('summary', null, h('span', { class: 'ss-title' }, title), status && h('span', { class: 'ss-status muted small' }, status)),
      h('div', { class: 'ss-body' }, body));
    const c = store.cloud, cs = db.calSync || {}, l = loc();
    const calStatus = cs.provider ? `${cs.provider === 'google' ? 'Google' : 'Microsoft'} · ${calState.status}` : cs.feed ? 'live feed on' : 'not linked';
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
      section('Storage & sync', c.adapter ? `${c.adapter.label} · ${c.status}` : 'this device only', panels[0].el, !c.adapter),
      section('Calendar & email', calStatus, panels[1].el),
      section('Display & accessibility', prefsSummary(), display.el),
      section('Field tool defaults', [l ? `${l.lat.toFixed(2)}°, ${l.lon.toFixed(2)}°` : 'no location', LS.get('logi-units') === 'ft' ? 'feet' : 'metres'].join(' · '), fieldDefaults()),
      section('Profile', db.profile.name || 'not set', profilePanel()),
      !installState().standalone && section('Install', installState().canPrompt ? 'ready to install' : 'see how', h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, 'Logi runs in the browser as it is. Installing adds an icon to your home screen or desktop, opens it full-screen and keeps it available offline.'),
        h('button', { class: 'btn primary', onclick: () => { const b = document.getElementById('installBtn'); if (b && !b.hidden) b.click(); else openInstallHelp(); } }, '⤓ Install Logi'))),
      section('Backups & data', `${db.bookings.length} bookings · ${db.gear.length} items`, backupPanel()),
      section('About', 'v' + VERSION, h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, `Logi Production Deck ${VERSION}. Bookings, crew, kit, venues, insurance, field tools and timecode notes for freelance videographers. Runs entirely in your browser; your data stays on your device and in the storage you link.`),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', onclick: () => startTour() }, '🧭 Take the tour'),
          h('a', { class: 'btn ghost', href: 'vendor/LICENSES.md', target: '_blank', rel: 'noopener' }, 'Open-source licences'),
          h('a', { class: 'btn ghost', href: REPO, target: '_blank', rel: 'noopener noreferrer' }, 'Source on GitHub')))));
    return () => panels.forEach(p => p.destroy && p.destroy());
  },
};

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

function profilePanel() {
  const p = db.profile;
  const cur = h('input', { type: 'text', value: p.currency || '$', 'aria-label': 'Currency symbol', maxLength: 4, onchange: e => { update(d => { d.profile = { ...d.profile, currency: e.target.value.trim() || '$', updatedAt: Date.now() }; }); toast('Saved'); } });
  return h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('label', null, 'Currency symbol'), cur, h('small', { class: 'muted' }, 'Used for gear values, kit totals and insurance figures.')),
    h('p', { class: 'small muted' }, [p.name, p.business, p.email].filter(Boolean).join(' · ') || 'No contact details yet.'),
    h('button', { class: 'btn ghost', onclick: () => window.logiGo('me') }, 'Edit name, contact details and QR code →'));
}

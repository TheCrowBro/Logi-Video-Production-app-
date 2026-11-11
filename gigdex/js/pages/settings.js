// Settings: everything that isn't a record, in twirl-down sections that each say where they stand on their closed
// line: your details (and your contact card as a QR code and a .vcf file), quotes & invoices, backups, display &
// accessibility, help, the sample, about, and erasing this device. Which sections are open is remembered here.
import { h, toast, announce, safeUrl, telUrl } from '../util.js';
import * as store from '../store.js';
import { db, update } from '../store.js';
import { fmtMoney, currency } from '../model.js';
import { openForm } from '../form.js';
import { qrSvg, loadQR } from '../qr.js';
import { saveFile, fileName } from '../print.js';
import { displayPanel, prefsSummary } from '../a11y.js';
import { startTour, sheetTutorial } from '../tour.js';
import { VERSION, BUILD, BUILT } from '../version.js';
import { updatePanel } from '../update.js';
import { installState, openInstallHelp } from '../install.js';
import { backupPanel, health, fileState, onBackupChange, unlinkFile } from '../backup.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const S = { erase: '' }; // what is typed in the erase box survives the redraw after every change

/* ------------------------------- open sections ------------------------------- */
const OPEN_KEY = 'gigdex-settings-open';
const OPEN = (() => { try { const a = JSON.parse(localStorage.getItem(OPEN_KEY)); return new Set(Array.isArray(a) ? a : []); } catch { return new Set(); } })();
const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...OPEN])); } catch { /* private mode */ } };

// One twirl-down: icon, title, a line saying where it stands, and its body. onOpen runs when it is (or opens) open.
function section(id, icon, title, sub, body, onOpen) {
  const subEl = h('span', { class: 'twirl-sub se-sub' }, sub);
  const el = h('details', { class: 'twirl se-sec', id: 'se-' + id, 'data-s': id, open: OPEN.has(id) },
    h('summary', { id: `se-${id}-sum` }, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, icon), h('span', null, h('span', { class: 'twirl-name' }, title), subEl)),
    h('div', { class: 'twirl-body se-body' }, body));
  // The browser also fires toggle for a details drawn open: only a real change of mind is remembered.
  let known = el.open;
  el.addEventListener('toggle', () => {
    if (el.open === known) return;
    known = el.open;
    if (el.open) OPEN.add(id); else OPEN.delete(id);
    saveOpen();
    if (el.open && onOpen) onOpen();
  });
  if (el.open && onOpen) onOpen();
  return { el, sub: subEl };
}

// From any page: go to Settings and open a section ('profile', 'billing', 'backups'…). Resolves once it is on screen.
export async function openSettingsSection(id) {
  OPEN.add(id); saveOpen();
  await window.logiGo('settings');
  await new Promise(r => setTimeout(r, 60));
  const d = document.getElementById('se-' + id);
  if (!d) return false;
  d.open = true;
  const nav = document.getElementById('rolodex'); // sticky at the top: the section lands under it, not behind it
  d.style.scrollMarginTop = `${(nav ? nav.getBoundingClientRect().height : 0) + 8}px`;
  d.scrollIntoView({ block: 'start' });
  d.querySelector(':scope > summary')?.focus({ preventScroll: true });
  return true;
}

/* ------------------------------- your details ------------------------------- */
const PROFILE_KEYS = ['name', 'business', 'role', 'phone', 'email', 'website', 'location', 'address', 'bio'];
const CURRENCIES = ['$', '£', '€', '¥', '₹', 'A$', 'C$', 'NZ$', 'kr', 'R', 'CHF', 'zł'];

// The one place your name, business and contact details are changed.
export function editProfile() {
  openForm({
    title: 'Your details',
    values: { ...db.profile, currency: currency() },
    fields: [
      { key: 'name', label: 'Your name', placeholder: 'Alex Rivera' },
      { key: 'business', label: 'Business, band or project name', placeholder: 'Rivera Sound' },
      { key: 'role', label: 'What you do', placeholder: 'Producer, band leader, tour manager…', list: ['Producer', 'Band leader', 'Musician', 'Session musician', 'Engineer', 'Mix engineer', 'Tour manager', 'Manager', 'Artist', 'Songwriter', 'DJ'] },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'website', label: 'Website', type: 'url', placeholder: 'yourname.com' },
      { key: 'location', label: 'Based in', placeholder: 'City' },
      { key: 'address', label: 'Postal address', type: 'textarea', rows: 3, hint: 'For invoices: some clients need it there to pay.' },
      { key: 'currency', label: 'Currency symbol', list: CURRENCIES, placeholder: '$', hint: 'Used for every fee, deal, settlement, quote and invoice.' },
      { key: 'bio', label: 'Short bio', type: 'textarea', rows: 3, hint: 'A line or two about you.' },
    ],
    onSave: v => {
      const out = {};
      for (const k of PROFILE_KEYS) out[k] = String(v[k] ?? '').trim();
      out.currency = String(v.currency ?? '').trim().slice(0, 6) || '$';
      update(d => { d.profile = { ...d.profile, ...out, updatedAt: Date.now() }; });
      toast('Your details are saved');
    },
  });
}

// A vCard 3.0 for the profile: scanned from the QR code or saved as a .vcf file.
const vesc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/([;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
export function vcard(p = db.profile) {
  const name = String(p.name || '').trim().replace(/\s+/g, ' '), parts = name ? name.split(' ') : [];
  const given = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '', family = parts.length > 1 ? parts[parts.length - 1] : '';
  const site = safeUrl(String(p.website || '').trim()).replace(/[\r\n]/g, '');
  const address = String(p.address || '').trim(), city = String(p.location || '').trim();
  const locality = city && !address.toLowerCase().includes(city.toLowerCase()) ? city : '';
  return [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${vesc(family)};${vesc(given)};;;`,
    `FN:${vesc(name || p.business || '')}`,
    p.business && `ORG:${vesc(p.business)}`,
    p.role && `TITLE:${vesc(p.role)}`,
    p.phone && `TEL;TYPE=CELL:${vesc(p.phone)}`,
    p.email && `EMAIL;TYPE=INTERNET:${vesc(p.email)}`,
    site && `URL:${site}`,
    (address || locality) && `ADR;TYPE=WORK:;;${vesc(address)};${vesc(locality)};;;`,
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
}
const hasCard = p => !!(String(p.name || p.business || '').trim() && String(p.phone || p.email || p.website || '').trim());

// The QR library reads text byte by byte; unless it has been set to UTF-8, give it the UTF-8 bytes so names such as
// Zoë or José scan right. The code for the current card is kept, so a redraw shows it at once.
const qrCache = { text: '', svg: '' };
async function qrFor(text) {
  if (qrCache.text === text) return qrCache.svg;
  const q = await loadQR();
  const utf8 = q.stringToBytesFuncs && q.stringToBytes === q.stringToBytesFuncs['UTF-8'];
  const svg = await qrSvg(utf8 ? text : Array.from(new TextEncoder().encode(text), b => String.fromCharCode(b)).join(''));
  qrCache.text = text; qrCache.svg = svg;
  return svg;
}

async function saveCard() {
  const p = db.profile;
  if (!hasCard(p)) return toast('Add your name and a phone number or email first');
  if (await saveFile(vcard(p), fileName(p.name || p.business || 'Contact', 'vcf'), 'text/vcard')) toast('Contact card saved');
}

function contactBlock() {
  const p = db.profile, can = hasCard(p), text = can ? vcard(p) : '';
  const box = can
    ? h('div', { class: 'qr se-qr', role: 'img', 'aria-label': `QR code: the contact card of ${p.name || p.business}` }, h('span', { class: 'small' }, 'Making the code…'))
    : h('p', { class: 'empty small se-qr-none' }, 'Add your name and a phone number or email (Edit your details) to make your contact card.');
  const put = svg => box.replaceChildren(h('div', { class: 'se-qr-svg', html: svg }));
  let painted = false;
  const paint = () => {
    if (!can || painted) return;
    painted = true;
    if (qrCache.text === text) return put(qrCache.svg);
    qrFor(text).then(put).catch(() => { box.replaceChildren(h('span', { class: 'small' }, 'Too much for a QR code: shorten your details.')); });
  };
  const el = h('div', { class: 'se-contact' },
    h('h3', null, 'Share my contact'),
    h('p', { class: 'small muted' }, 'Someone scans the code with their phone camera to save your number and email. Or send the card as a file.'),
    box,
    h('div', { class: 'actions center' }, h('button', { type: 'button', class: 'btn ghost', id: 'se-vcf', disabled: !can, onclick: saveCard }, '⤓ Save contact card (.vcf)')));
  return { el, paint };
}

function profileBody() {
  const p = db.profile, has = PROFILE_KEYS.some(k => String(p[k] || '').trim());
  const site = safeUrl(String(p.website || '').trim());
  const line = (label, value) => value && h('div', null, h('span', { class: 'muted' }, label), h('span', { class: 'se-val' }, value));
  const contact = contactBlock();
  const body = [
    has && h('p', { class: 'small muted' }, 'They go on your day sheets, quotes and invoices, and on your contact card below.'),
    has
      ? h('div', { class: 'card kv se-kv' },
        line('Name', p.name), line('Business', p.business), line('What you do', p.role),
        p.phone && line('Phone', h('a', { href: telUrl(p.phone) }, p.phone)),
        p.email && line('Email', h('a', { href: 'mailto:' + p.email }, p.email)),
        p.website && line('Website', site ? h('a', { href: site, target: '_blank', rel: 'noopener noreferrer' }, p.website) : p.website),
        line('Based in', p.location),
        p.address && line('Postal address', h('span', { class: 'prewrap' }, p.address)),
        line('Currency', `${currency()}  (e.g. ${fmtMoney(1250)})`))
      : h('div', { class: 'empty se-empty' }, h('p', null, 'Add your name, business and contact details. They go on your day sheets, quotes and invoices.')),
    p.bio && h('p', { class: 'small prewrap se-bio' }, p.bio),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', id: 'se-edit-profile', onclick: editProfile }, has ? '✎ Edit your details' : '+ Add your details')),
    contact.el,
  ];
  return { body, paint: contact.paint };
}
const profileSummary = () => { const p = db.profile; return [p.name, p.business].map(x => String(x || '').trim()).filter(Boolean).join(' · ') || 'Not set yet: add your name and contact details'; };

/* ------------------------------- quotes & invoices ------------------------------- */
// money.js draws its own settings panels. It is fetched with this page and kept, so a redraw mounts them at once and
// the box someone is typing in keeps the focus.
let money = null;
const moneyReady = import('../money.js').then(m => (money = m)).catch(e => { console.error(e); return null; });
// A box in those panels saves on change, and the page redraws inside that change, before the browser moves the focus
// to the next box (Tab, or a tap on it). For that one redraw the same panel is kept, so the box the focus is going to
// still exists; a fresh one follows a moment later, and the redraw then keeps the focus where it went.
let moneySlot = null, moneyEdit = false;
function billingBody() {
  if (moneyEdit && moneySlot) return moneySlot;
  const slot = h('div', { class: 'stack se-money' });
  slot.addEventListener('change', () => {
    if (moneyEdit) return;
    moneyEdit = true;
    setTimeout(() => { moneyEdit = false; if (slot.isConnected) store.redraw(); }, 0);
  }, true);
  moneySlot = slot;
  const fill = m => {
    if (!m) return slot.replaceChildren(h('p', { class: 'small muted' }, 'Quotes & invoices could not be loaded. Check the connection and open Settings again.'));
    const kids = [h('p', { class: 'small muted' }, 'How your quotes and invoices are numbered, tax, the payment details printed on them, and the prices you pick lines from.')];
    for (const [make, head] of [[m.billingPanel, ''], [m.priceListPanel, 'Your price list']]) {
      try {
        const out = typeof make === 'function' ? make() : null, node = out && out.nodeType ? out : out && out.el && out.el.nodeType ? out.el : null;
        if (node) kids.push(head && h('h3', { class: 'se-money-head' }, head), node);
      } catch (e) { console.error(e); kids.push(h('p', { class: 'warn small' }, 'Part of this section could not be shown.')); }
    }
    slot.replaceChildren(...kids);
  };
  if (money) fill(money);
  else { slot.append(h('p', { class: 'small muted' }, 'Loading…')); moneyReady.then(m => { if (slot.isConnected) fill(m); }); }
  return slot;
}
const billingSummary = () => { const list = db.priceList && Array.isArray(db.priceList.list) ? db.priceList.list.length : 0; return list ? `${plural(list, 'price')} on your list · numbering, tax, payment details` : 'Numbering, tax, payment details and your prices'; };

/* ------------------------------- backups ------------------------------- */
function backupSummary() {
  const hl = health(), f = fileState();
  const bits = [hl.level === 'ok' ? `Last backup ${hl.when}` : hl.level === 'old' ? `⚠ Last backup ${hl.when}` : hl.level === 'none' ? '⚠ No backup yet' : 'Nothing to back up yet'];
  if (f.linked) bits.push(f.status === 'needs-permission' ? '⚠ the file copy needs your OK' : f.status === 'error' ? '⚠ the file copy wasn’t saved' : `copy in ${f.name}`);
  return bits.join(' · ');
}

/* ------------------------------- the sample ------------------------------- */
const sampleCount = () => store.COLLECTIONS.reduce((n, c) => n + db[c].filter(r => r && r.sample).length, 0);
function loadSample() {
  const before = sampleCount();
  store.loadSample();
  const added = sampleCount() - before;
  toast(added ? `Sample loaded: ${plural(added, 'record')}. Open Bookings to have a look.` : 'The whole sample is already here.');
}
// Every sample record goes through store.remove, so anything of yours that pointed at one (a booking for the sample
// act, at a sample venue, with a sample song) is unlinked instead of left pointing at nothing. Returns how many went.
export function removeSample() {
  const order = ['bookings', 'logs', 'shifts', 'setlists', 'songs', 'kits', 'gear', 'insurance', 'acts', 'people', 'venues'];
  const lists = [...order.filter(c => store.COLLECTIONS.includes(c)), ...store.COLLECTIONS.filter(c => !order.includes(c))];
  let n = 0;
  for (const list of lists) for (const r of store.db[list].filter(x => x && x.sample)) { store.remove(list, r.id); n++; }
  // The sample's stand-in name, if it is still the one loadSample filled in.
  const p = store.db.profile;
  if (p.name === 'Sample Producer' && p.business === 'Sample Sound') update(d => { d.profile = { ...d.profile, name: '', business: '', role: d.profile.role === 'Producer' ? '' : d.profile.role, updatedAt: Date.now() }; });
  return n;
}
function askRemove() {
  const all = store.COLLECTIONS.flatMap(c => db[c].filter(r => r && r.sample));
  if (!all.length) return toast('There is no sample to remove');
  const edited = all.filter(r => Number(r.updatedAt) > Number(r.createdAt) + 2000).length;
  if (!confirm(`Remove the ${plural(all.length, 'sample record')}?${edited ? ` ${edited} of them changed after loading, and those changes go too.` : ''} Your own records stay; anything of yours linked to a sample act, venue, song or person is unlinked.`)) return;
  const n = removeSample();
  toast(`Sample removed: ${plural(n, 'record')}`);
  announce('Sample removed');
}
function sampleBody() {
  const n = sampleCount();
  return [
    h('p', { class: 'small muted' }, 'A band and an artist in the studio, a few weeks of shows, sessions and rehearsals, songs and a setlist, backline, venues and insurance: enough to try every page. Sample records are marked, and come out again in one go.'),
    n > 0 && h('p', { class: 'small' }, `${plural(n, 'sample record')} on this device.`),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn ' + (n ? 'ghost' : 'primary'), id: 'se-sample-load', onclick: loadSample }, n ? 'Load it again' : 'Load the sample'),
      n > 0 && h('button', { type: 'button', class: 'btn danger', id: 'se-sample-remove', onclick: askRemove }, 'Remove the sample…')),
  ];
}

/* ------------------------------- about ------------------------------- */
const sizeText = bytes => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const isApple = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function install() {
  const b = document.getElementById('installBtn');
  if (b && !b.hidden) b.click(); else openInstallHelp();
}
function aboutBody(up) {
  let size = 0; try { size = new Blob([store.serialize()]).size; } catch { /* ignore */ }
  return [
    h('p', null, h('strong', null, `Gigdex ${VERSION}`), BUILD !== 'dev' ? ` · build ${BUILD}${BUILT ? ` (${BUILT})` : ''}` : '', h('br'),
      h('span', { class: 'small muted' }, 'The booking deck for music producers and their bands.')),
    h('div', { class: 'card se-where' },
      h('strong', null, 'Where your data is kept'),
      h('p', { class: 'small muted' }, 'Everything you enter stays in this browser, on this device. There is no account, and nothing is sent to a server: not your bookings, your contacts or your fees. A backup file keeps it safe and moves it to another device.'),
      h('p', { class: 'small muted' }, `It takes about ${sizeText(size)} here.`),
      isApple() && !installState().standalone && h('p', { class: 'small muted' }, 'On iPhone and iPad, Safari can clear a website’s data when it hasn’t been opened for a week or so. Add Gigdex to the Home Screen to keep it, and save a backup now and then.')),
    up.el,
    h('div', { class: 'actions' },
      h('a', { class: 'btn ghost', href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy'),
      !installState().standalone && h('button', { type: 'button', class: 'btn ghost', id: 'se-install', onclick: install }, '⤓ Install Gigdex')),
  ];
}

/* ------------------------------- erase ------------------------------- */
const eraseArmed = () => S.erase.trim().toUpperCase() === 'ERASE';
async function eraseDevice() {
  if (!eraseArmed()) return;
  S.erase = '';
  try { await unlinkFile(); } catch { /* nothing linked */ } // first, so the empty database is never written over the copy
  store.eraseAll();
  try { localStorage.removeItem(OPEN_KEY); } catch { /* ignore */ }
  toast('Everything on this device was erased');
  setTimeout(() => location.reload(), 400);
}
function eraseBody() {
  const go = h('button', { type: 'button', class: 'btn danger', id: 'se-erase-go', disabled: !eraseArmed(), onclick: eraseDevice }, 'Erase this device');
  const input = h('input', { type: 'text', id: 'se-erase-input', value: S.erase, autocomplete: 'off', autocapitalize: 'characters', 'aria-describedby': 'se-erase-warn',
    oninput: e => { S.erase = e.target.value; go.disabled = !eraseArmed(); },
    onkeydown: e => { if (e.key === 'Enter' && eraseArmed()) { e.preventDefault(); eraseDevice(); } } });
  input.spellcheck = false;
  return [
    h('p', { class: 'warn small', id: 'se-erase-warn' }, 'This removes everything Gigdex keeps on this device: bookings, acts, people, songs, setlists, backline, venues, take logs, insurance, your details and money settings. Backup files, and a copy kept in a file, stay as they are. There is no undo.'),
    h('div', { class: 'field' }, h('label', { for: 'se-erase-input' }, 'Type ERASE to confirm'), input),
    h('div', { class: 'actions' }, go),
  ];
}

/* ------------------------------- the page ------------------------------- */
const SECTIONS = [
  ['profile', 'Your details', 'Your name, business and contact details: they go on day sheets, quotes and invoices. Under them, your contact card as a QR code to scan and a file to send.'],
  ['billing', 'Quotes & invoices', 'How quotes and invoices are numbered, tax, your payment details, and your price list.'],
  ['backups', 'Backups', 'Save a backup file, bring one back, or keep a copy in a file in a synced folder. Everything else lives on this device only.'],
  ['display', 'Display & accessibility', 'Colour theme, light or dark, text size, bigger buttons, contrast, animation and vibration.'],
  ['help', 'Help', 'A walkthrough for any page, and the welcome tour.'],
  ['sample', 'Sample data', 'Load a sample band and a few weeks of bookings to try things out, and remove it again in one go.'],
  ['about', 'About', 'The version and updates, privacy, and where your data is kept.'],
  ['erase', 'Erase this device', 'Wipes everything Gigdex keeps on this device. You type ERASE first, so it can’t happen by accident.'],
];

export const settings = {
  id: 'settings', label: 'Settings', icon: '⚙️',
  render(root) {
    const done = [];
    const profile = profileBody();
    const display = displayPanel();
    const up = updatePanel();
    done.push(() => display.destroy && display.destroy(), () => up.destroy && up.destroy());

    const sec = {
      profile: section('profile', '🪪', 'Your details', profileSummary(), profile.body, profile.paint),
      billing: section('billing', '🧾', 'Quotes & invoices', billingSummary(), billingBody()),
      backups: section('backups', '☁️', 'Backups', backupSummary(), backupPanel()),
      display: section('display', '🔆', 'Display & accessibility', cap(prefsSummary()), display.el),
      help: section('help', '🧭', 'Help', 'Page tutorials and the welcome tour', [
        h('p', { class: 'small muted' }, 'Every page has a short walkthrough: tap ? at the top of any page, or pick one here. The welcome tour shows the whole app in about a minute.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn primary', id: 'se-tutorials', onclick: () => import('../tutorials.js').then(m => m.openChooser()).catch(e => { console.error(e); toast('The tutorials could not be opened.'); }) }, '📚 Page tutorials…'),
          h('button', { type: 'button', class: 'btn ghost', id: 'se-tour', onclick: () => startTour() }, '🧭 Take the welcome tour')),
      ]),
      sample: section('sample', '🧪', 'Sample data', sampleCount() ? `${plural(sampleCount(), 'sample record')} loaded` : 'Not loaded', sampleBody()),
      about: section('about', 'ℹ️', 'About', `Version ${VERSION}${BUILD !== 'dev' ? ' · ' + BUILD : ''} · your data stays on this device`, aboutBody(up)),
      erase: section('erase', '🗑️', 'Erase this device', 'Remove everything Gigdex keeps here', eraseBody()),
    };
    // A backup saved or the file copy written is not a change to the data, so the page is not redrawn: its line is.
    done.push(onBackupChange(() => { sec.backups.sub.textContent = backupSummary(); }));
    // The display choices are kept on the device, not in the data: their line follows a tap in the panel.
    display.el.addEventListener('click', () => setTimeout(() => { sec.display.sub.textContent = cap(prefsSummary()); }));

    root.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Settings')),
      h('div', { class: 'se-list' }, Object.values(sec).map(s => s.el)));
    return () => {
      done.forEach(f => { try { f(); } catch { /* already gone */ } });
      if (window.logiPage && window.logiPage() !== 'settings') S.erase = ''; // leaving Settings disarms the erase button
    };
  },
  tutorial: () => [
    { title: 'Settings', text: 'Everything that isn’t a booking or a record. Tap a section to open it; each one says where it stands on its closed line.', target: ['#page .page-head'] },
    ...SECTIONS.map(([id, title, text]) => ({ title, text, target: [`#se-${id} > summary`] })),
  ],
};

sheetTutorial('Your details', [
  { title: 'Who you are', text: 'Your name, and your business, band or project name, as they should read on day sheets and invoices.', target: ['[data-key="name"]'] },
  { title: 'How to reach you', text: 'Phone, email and website go on your contact card and on your documents.', target: ['[data-key="phone"]'] },
  { title: 'Postal address', text: 'For invoices: some clients need it there before they can pay.', target: ['[data-key="address"]'] },
  { title: 'Currency', text: 'The symbol for every fee, deal, settlement, quote and invoice: $, £, €…', target: ['[data-key="currency"]'] },
]);

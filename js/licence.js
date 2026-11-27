// The licence, as the page shows it, in the desktop app and on the website (and the Google Play app, which is the
// website). Each has its own source of truth and both answer the same questions:
//   desktop: desktop/licence.js through window.vdexDesktop.licence (30-day trial → a licence code → up to 3 devices)
//   website: js/licence-web.js (30-day trial → sign in with the licence's email; the Play app takes one of the 3 places)
// When the trial is over and there is no working licence, Vdex is read-only: the store refuses changes (store.setGate)
// and says why, while opening, searching and printing keep working. Cloud storage and saving backup and spreadsheet
// files need a licence from the start (store.setPaid). Making a link or QR code that passes on the contact card or
// equipment needs the trial or a licence. A device a paid licence stopped covering keeps Export backup for 30 days.
import { h, sheet, toast, announce, muteToasts } from './util.js';
import { setGate, redraw, setPaid, importChecked } from './store.js';

let P = null; // the licence: the desktop app's bridge, or the website's own
let ready = null;
const L = () => P;
const S = { cur: null, bar: null, listeners: new Set(), blockedAt: 0, input: 0, hide: '' };
export const licenceState = () => S.cur;
export const onLicence = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const day = iso => { const d = new Date(String(iso || '') + (String(iso).length === 10 ? 'T12:00:00' : '')); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const who = l => (l ? [l.name, l.email && l.name ? `(${l.email})` : l.email].filter(Boolean).join(' ') : '');
const web = () => !!P && P.kind === 'web';
const play = () => web() && !!P.play;  // the Google Play app: no prices and no link to the shop (Google Play's rule)
const ios = () => web() && !!P.ios;    // the iPhone app: buys through the App Store, never links to the shop (Apple's rule)
const app = () => web() && !!P.app;    // either store app: takes one of the licence's places
const here = () => (app() ? 'phone' : 'computer');
const price = () => (ios() && P.price && P.price()) || ''; // the App Store's price in the person's currency, once the App Store has said it; nothing before (Apple's rule: only its price)

// On the website and in the desktop app, the whole price where the law asks to see it before buying (the UK, the EU and
// Australia: js/tax.js). The licence server answers from the country the request comes from (GET /licence/price);
// until it has, and anywhere else, the price before tax. Not in the store apps: the App Store shows its own price, and
// the Play app none.
const T = { local: null, asked: false };
function askLocalPrice() {
  if (T.asked || !P || ios() || play() || typeof P.localPrice !== 'function') return;
  T.asked = true;
  Promise.resolve().then(() => P.localPrice()).then(b => {
    if (!b || typeof b !== 'object' || b.error) { T.asked = false; return; } // no answer: asked again at the next change
    const t = b.taxed;
    if (!t || !/^\d{1,4}\.\d\d$/.test(String(t.total)) || !/^(VAT|GST)$/.test(t.tax) || !(Number(t.rate) > 0) || typeof t.place !== 'string') return;
    T.local = { total: String(t.total), tax: t.tax, rate: Number(t.rate), place: t.place.slice(0, 40) };
    if (S.cur) set(S.cur); // the panel, the bar and an open offer show it
  }).catch(() => { T.asked = false; });
}
const tag = () => (T.local ? `${T.local.total} USD with ${T.local.tax}` : '20 USD'); // on the Buy buttons
const once = () => (T.local ? `${T.local.total} USD once in ${T.local.place}, including ${T.local.rate}% ${T.local.tax}` : '20 USD once plus any tax where you live');
// The offer as other screens word it (the setup tour): where Buy is offered, and the website's price ('' in the store
// apps: the App Store shows its own price, and the Play app has no Buy and no price, Google Play's rule).
export const offer = () => ({ buy: !play(), price: ios() || play() ? '' : once() });

// The states in which this device counts as having a licence (or licences are not switched on): cloud storage and
// saving data files work only in these (store.setPaid). A licence that is still waiting to be added to this device
// online ('pending': a code on a computer, a sign-in in a store app) is not a licence here yet: those begin once the
// device is on the licence's list. A device the licence does not cover ('released': its place was moved, or a store
// app signed in while all were taken) is as it is without a licence. One whose licence has not been confirmed online for
// 90 days ('offline') is read-only and keeps only Export backup, until it is confirmed again.
const PAID = new Set(['off', 'founder', 'licensed']);
const paid = s => PAID.has(s.mode);
const DAY = 86400e3, BACKUP_DAYS = 30;
// Links and QR codes that pass on the contact card or equipment: during the trial, or with a licence.
const links = s => paid(s) || s.trialLeft > 0;
// When a licence stopped covering this device (`lapsedAt`, kept on the device by either licence), Export backup works
// for 30 days from then. Someone who only ever had the trial has none.
const backupUntil = s => (s.mode === 'offline' ? Infinity : Number.isFinite(s.lapsedAt) && s.lapsedAt > 0 ? s.lapsedAt + BACKUP_DAYS * DAY : 0);
function set(s) {
  if (!s || s.error || !s.mode) return;
  S.cur = s;
  if (['trial', 'ended', 'cancelled', 'expired'].includes(s.mode)) askLocalPrice(); // the states that offer Buy
  setPaid(paid(s), needsLicence, { links: links(s), backupUntil: backupUntil(s), canEdit: s.canEdit !== false });
  if (paid(s) && S.needClose) closeWhenOnTop('licence-needed', 'needClose'); // just signed in: the offer is out of date
  if (s.canEdit !== false && S.roClose) closeWhenOnTop('licence-readonly', 'roClose'); // licensed now: the read-only explanation is out of date
  S.listeners.forEach(f => { try { f(s); } catch { /* ignore */ } });
  paintBar();
}
const refresh = async () => { await ready; const l = L(); if (l) set(await l.state().catch(() => null)); return S.cur; };

// A start that failed (the website's licence file could not be loaded) is tried again at the next call: store.js
// keeps Vdex read-only meanwhile, and calls again when the connection returns. The file is fetched before it is
// imported, as store.js does with this one (importChecked: a browser remembers a module that failed to load).
const WEB = { tries: 0, renamed: false };
export function initLicence() {
  if (!ready) ready = start().catch(e => { ready = null; P = null; throw e; });
  return ready;
}
async function start() {
  P = window.vdexDesktop && window.vdexDesktop.licence ? Object.assign(Object.create(window.vdexDesktop.licence), { kind: 'desktop' })
    : (await importChecked(new URL('./licence-web.js', import.meta.url), 'js/licence-web.js', WEB)).webLicence();
  set(await P.state().catch(() => null));
  P.onChange(set);
  // Another window signed in or out (the website keeps its sign-in in this browser's storage).
  window.addEventListener('storage', e => { if (e.key === 'vdex-licence' && web()) P.state().then(set).catch(() => {}); });
  setGate(({ form = false, quiet = false } = {}) => {
    if (!S.cur || S.cur.canEdit !== false) return true;
    if (quiet) return false; // a side effect of something allowed: skipped without a word
    muteToasts(600);
    // Background work (a calendar sync, say) is refused quietly; a change someone just asked for is explained.
    const asked = Date.now() - S.input < 3000;
    if (asked) {
      // A control on the page (a ticked box, a typed field) is redrawn to show what is stored, and keeps the focus
      // when the explanation closes. A form stays open as it is, so there is nothing to redraw.
      const twin = form ? null : rememberFocus();
      if (!document.querySelector('.sheet.licence-readonly')) readOnlySheet(); else announce('Vdex is read-only. Nothing was changed.');
      if (!form) { clearTimeout(S.redraw); S.redraw = setTimeout(() => { redraw(); if (twin) setTimeout(twin, 0); }, 0); } // the page redraws in a microtask; look for its new copy after that
    }
    return false;
  });
  const touched = e => { if (e.isTrusted) S.input = Date.now(); };
  for (const t of ['pointerdown', 'keydown', 'change']) document.addEventListener(t, touched, true);
  // The trial can run out while Vdex is open: look again whenever it comes back to the front, and every hour. The
  // website also confirms its sign-in in the background (about once a day; the desktop app does its own).
  const tick = () => (web() ? P.recheck(false).then(set).catch(() => {}) : refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  window.addEventListener('online', tick);
  setInterval(tick, 3600e3);
  if (web()) setTimeout(tick, 1500);
}

/* ------------------------------- what to say ------------------------------- */
// One line about the licence, and the buttons that go with it, for each state.
function describe(s) {
  const l = s.licence, seats = (l && l.seats) || s.seats || 3;
  const offer = play() ? 'sign in with the email address of your Vdex licence'
    : ios() ? `buy a licence (${price() ? price() + ' once, ' : 'once, '}for up to ${seats} of your devices), or sign in with the email address of a licence you already have`
      : web() ? `sign in with the email address you bought a licence with (${once()}, for up to ${seats} of your devices)`
        : `add a licence: ${once()}, for up to ${seats} of your devices`;
  const shop = !play(), restore = ios();
  switch (s.mode) {
    case 'founder': return { line: 'Free licence: thank you for using Vdex from the start.', tone: 'ok' };
    case 'trial': return { line: `Free trial: ${plural(s.trialLeft, 'day')} left${s.trialEnds ? ` (until ${day(s.trialEnds)})` : ''}. After that Vdex is read-only here until you ${offer}.`, buy: shop, enter: true, restore };
    case 'ended': return { line: `Your free trial has ended, so Vdex is read-only here: you can open, search and print everything, but not change it. To change things again, ${offer}.`, tone: 'warn', buy: shop, enter: true, restore };
    case 'licensed': return web()
      ? { line: s.via === 'apple' && ios()
          ? `Licensed through the App Store${l.email ? ' · ' + l.email : ''} · on every iPhone and iPad of your Apple Account, and up to ${plural(seats, 'other device')}.`
          : `${s.via === 'apple' ? 'Licensed through the App Store' + (l.email ? ' · ' + l.email : '') : `Signed in as ${l.email}`}${l.comp ? ' · free licence' : ''} · up to ${plural(seats, 'device')}${app() ? ', and this phone is one of them' : ''}.`, tone: 'ok', release: true, addEmail: s.via === 'apple' && !l.email, copy: s.via === 'apple' }
      : { line: `Licensed to ${who(l)}${l && l.comp ? ' · free licence' : ''} · up to ${plural(seats, 'device')}.`, tone: 'ok', copy: true, release: true };
    case 'pending': return web()
      ? { line: `Signed in as ${l.email}, but this phone is not on your licence yet: Vdex needs the internet once to add it. Cloud storage, backup files and spreadsheets start once it is added.`, tone: s.canEdit ? '' : 'warn', retry: true, release: true }
      : { line: `Licensed to ${who(l)}, but not activated on this computer yet: Vdex needs the internet once to do that${s.daysLeft > 0 ? ` (${plural(s.daysLeft, 'day')} left)` : ''}. Cloud storage, backup files and spreadsheets start once it is activated.`, tone: s.daysLeft > 0 ? '' : 'warn', retry: true, remove: true };
    case 'released': return { line: `This ${here()} is not on your licence: it is in use on ${plural(seats, 'other device')}, its limit. ${web() ? 'Add this phone' : 'Activate it here again'} to choose which device to take off.`, tone: 'warn', again: true, [web() ? 'release' : 'remove']: true };
    case 'cancelled': return { line: `This licence has been cancelled, for example after a refund. If you think that is a mistake, reply to the email your licence came in${ios() ? ', or to Apple for an App Store purchase' : ''}. ${!web() || s.rejoins ? 'If a payment dispute is settled in our favour, the licence works here again within a day.' : 'If a payment dispute is settled in our favour, sign in again to use it here.'}`, tone: 'warn', buy: shop, enter: true, restore, remove: !web() };
    case 'expired': return { line: `Your licence ended on ${day(l && l.expires)}.`, tone: 'warn', buy: shop, enter: true, restore, [web() ? 'release' : 'remove']: true };
    case 'offline': return { line: `Vdex has not been able to check your ${web() ? 'sign-in' : 'licence'} for 90 days, so it is read-only here and cloud storage and spreadsheets are paused until it can; Export backup still works. Connect to the internet and press Try again.`, tone: 'warn', retry: true };
    default: return null;
  }
}
function actions(s, d, after = () => {}) {
  const l = L(), b = [];
  if (d.buy) b.push(h('button', { class: 'btn primary', onclick: e => (ios() ? buyInApp(e.target, after) : l.buy()) }, ios() ? `Buy a licence${price() ? ' · ' + price() : ''}` : `Buy a licence · ${tag()}`));
  if (d.enter) b.push(h('button', { class: 'btn ghost', onclick: () => (web() ? signIn() : enterCode()) }, web() ? 'Sign in' : 'Enter licence code'));
  if (d.restore) b.push(h('button', { class: 'btn ghost', onclick: e => restoreInApp(e.target, after) }, 'Restore purchases'));
  if (d.again) b.push(h('button', { class: 'btn primary', onclick: async () => (web() ? addPhone() : enterCode(await l.code())) }, web() ? 'Add this phone' : 'Activate here again'));
  if (d.retry) b.push(h('button', { class: 'btn primary', onclick: e => retry(e.target, after) }, 'Try again'));
  if (d.addEmail) b.push(h('button', { class: 'btn ghost', onclick: () => addEmailSheet(after) }, 'Add your email'));
  if (d.copy) b.push(h('button', { class: 'btn ghost', onclick: async e => { const btn = e.target, was = btn.textContent; btn.disabled = true; btn.textContent = 'Fetching…'; let code = ''; try { code = await l.code(); } catch (err) { toast(err.message || 'The code could not be fetched'); } btn.disabled = false; btn.textContent = was; if (!code) return; try { await navigator.clipboard.writeText(code); toast(web() ? 'Licence code copied: paste it in the desktop app under Enter licence code' : 'Licence code copied'); } catch { toast('Could not copy'); } } }, web() ? 'Copy the code for the desktop app' : 'Copy the code'));
  if (d.release) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet() }, web() ? 'Sign out' : 'Release this computer'));
  if (d.release && web() && L().forget && ['licensed', 'pending', 'released', 'offline'].includes(s.mode)) b.push(h('button', { class: 'btn ghost small', onclick: () => forgetSheet() }, 'Delete my licence records'));
  if (d.remove) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet(true) }, 'Remove the code'));
  return b;
}

// The App Store purchase (the iPhone app): Apple's sheet, then the licence server confirms it and this phone takes a place.
async function buyInApp(btn, after = () => {}, restore = false) {
  const label = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = restore ? 'Checking…' : 'Buying…'; }
  const r = await (restore ? L().restore() : L().buy()).catch(e => ({ error: e.message }));
  if (btn) { btn.disabled = false; btn.textContent = label; }
  if (!r || r === true || r.cancelled) return;
  if (r.pending) { toast('Waiting for the purchase to be approved. Vdex is licensed here as soon as it is.'); return; }
  if (r.error) { toast(r.error); return; }
  set(r);
  if (r.full) return fullSheet(r.full);
  after();
  toast(r.mode === 'licensed' ? (restore ? 'Your purchase is back: Vdex is licensed on this phone.' : 'Thank you! Vdex is licensed on this phone.') : 'Your purchase is confirmed.');
}
const restoreInApp = (btn, after) => buyInApp(btn, after, true);
// The purchase is confirmed, but the licence's devices are all taken: choose one to take off.
function fullSheet(full) {
  const l = L(), msg = h('p', { class: 'small', role: 'status' });
  const sh = sheet('Add this phone', h('div', { class: 'stack' }, msg));
  const go = async tag => {
    const r = await l.seat(tag);
    if (r && r.error === 'full') return chooser(msg, r, go, 'phone');
    if (!r || r.error || r.offline) { msg.textContent = (r && typeof r.error === 'string' && r.error) || 'Vdex could not reach the licence server. Try again when you are online.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close(); toast('This phone is on your licence');
  };
  chooser(msg, full, go, 'phone');
}

// Checks the licence online now. The message says what the server answered, not just whether it is licensed.
async function retry(btn, after = () => {}) {
  const was = S.cur && S.cur.mode;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const r = await L().recheck(true).catch(() => null);
  set(r); after();
  const m = r && r.mode;
  toast(m === 'licensed' ? 'Licence confirmed' : m === 'released' ? 'Your licence is in use on its other devices' : m === 'cancelled' ? 'This licence has been cancelled' : m === was ? 'Still not able to reach the licence server' : 'Licence checked');
}

// Next to Buy on the website and in the desktop app: what is bought (California's rule for digital goods: a licence,
// not a copy, and it can be cancelled). In the iPhone app the App Store sells it, under Apple's terms.
const buyNote = d => (d && d.buy && !ios() && !play() ? h('p', { class: 'small muted licence-buy-note' }, 'You are buying a licence to use Vdex, not ownership of a copy. It can be cancelled in the cases the ', h('a', { href: 'terms.html#paid', target: '_blank', rel: 'noopener' }, 'terms'), ' describe. At checkout you can pay in US dollars, or in your own currency at Stripe’s exchange rate (2 to 4% more).') : '');

/* ------------------------ Settings → General → About & Licence ------------------------ */
export function licencePanel() {
  const el = h('div', { class: 'stack licence-panel', hidden: true });
  const draw = () => {
    const s = S.cur, d = s && describe(s);
    if (!d) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const b = actions(s, d, draw);
    el.replaceChildren(h('h3', { class: 'licence-title' }, 'Licence'), h('p', { class: 'small' + (d.tone === 'warn' ? ' licence-warn' : '') }, d.line), b.length ? h('div', { class: 'actions' }, ...b) : '', buyNote(d));
  };
  draw();
  const off = onLicence(draw);
  initLicence().then(() => { if (!S.cur) refresh(); else draw(); }).catch(() => {}); // not loaded: store.js keeps Vdex read-only and tries again
  return { el, destroy: off };
}

/* ---------------------------------- the bar ---------------------------------- */
// A bar at the bottom while the trial is in its last week, and whenever Vdex is read-only.
function paintBar() {
  const s = S.cur, d = s && describe(s);
  const urgent = s && s.canEdit === false;
  const show = d && (urgent || (s.mode === 'trial' && s.trialLeft <= 7) || (s.mode === 'pending' && s.daysLeft <= 7 && !web()));
  const key = s ? s.mode + (urgent ? '!' : '') : '';
  if (!show || S.hide === key) { if (S.bar) { S.bar.remove(); S.bar = null; document.body.classList.remove('has-licence-bar'); } return; }
  const URGENT = {
    ended: 'Your free trial has ended: Vdex is read-only.', offline: `Read-only until Vdex can check your ${web() ? 'sign-in' : 'licence'} online.`,
    pending: `Read-only until your licence is ${web() ? 'added to this phone' : 'activated on this computer'}.`, released: `Read-only: this ${here()} is not on your licence.`,
    cancelled: 'Read-only: this licence has been cancelled.', expired: 'Read-only: your licence has ended.',
  };
  const text = urgent ? URGENT[s.mode] || 'Vdex is read-only.' : s.mode === 'trial' ? `Free trial: ${plural(s.trialLeft, 'day')} left.` : 'Your licence is not activated on this computer yet.';
  const small = (label, onclick, primary) => h('button', { class: `btn ${primary ? 'primary' : 'ghost'} small`, onclick }, label);
  const enter = () => (web() ? signIn() : enterCode());
  // Each state's own next step: someone who has paid is never asked to buy again.
  const buttons = d.retry ? [small('Try again', e => retry(e.target), true), small('Details', () => detailsSheet())]
    : d.again ? [small(web() ? 'Add this phone' : 'Activate here again', async () => (web() ? addPhone() : enterCode(await L().code())), true), small('Details', () => detailsSheet())]
    : d.buy ? [small(ios() ? `Buy${price() ? ' · ' + price() : ' a licence'}` : `Buy · ${tag()}`, e => (ios() ? buyInApp(e.target) : L().buy()), true), small(web() ? 'Sign in' : 'Enter code', enter)]
    : d.enter ? [small('Sign in', enter, true)]
    : [small('Details', () => detailsSheet(), true)];
  const cls = 'update-bar licence-bar' + (urgent ? ' urgent' : '');
  const parts = [h('span', null, text), ...buttons,
    h('button', { class: 'icon-btn', 'aria-label': 'Hide until Vdex is next opened', onclick: () => { S.hide = key; paintBar(); } }, '✕')];
  if (!S.bar || S.bar.firstChild.textContent !== text) announce(text);
  // The same element every time, with its contents renewed: what the lock screen set on it when it came up (out of
  // reach while locked) stays, where a new element would sit behind that screen in the Tab order with a Buy button
  // that works. A bar first added while that screen is up starts out of reach too, marked data-covered, and the
  // screen's way out gives it back (coverAll in js/lock.js). That is underCover() in js/util.js, written out here:
  // this file is fetched after the start, and must not ask a start-up file for a name that a page still running
  // the build before does not have in it (such a page would then not load this file at all, and stay read-only).
  if (S.bar && S.bar.isConnected) { S.bar.className = cls; S.bar.replaceChildren(...parts); }
  else { S.bar = h('div', { class: cls, role: 'status' }, ...parts); if (document.querySelector('body > .lock')) { S.bar.inert = true; S.bar.dataset.covered = ''; } document.body.append(S.bar); }
  document.body.classList.add('has-licence-bar');
}

/* --------------------------------- sheets --------------------------------- */
// Marks the focused control so the sheet can hand focus back to its redrawn copy (util.sheet follows data-fk).
function rememberFocus() {
  document.querySelectorAll('[data-fk="licence-ro"]').forEach(e => delete e.dataset.fk);
  const el = document.activeElement, page = document.getElementById('page');
  if (!el || !page || !page.contains(el) || el.closest('[data-fk]')) return null;
  const sig = e => [e.tagName, e.type || '', e.getAttribute('aria-label') || '', e.name || '', e.id || '', (e.closest('label') || e).textContent.trim().slice(0, 80)].join('|');
  const want = sig(el), all = [...page.querySelectorAll(el.tagName)], nth = all.filter(e => sig(e) === want).indexOf(el);
  el.dataset.fk = 'licence-ro';
  return () => { const twin = [...page.querySelectorAll(el.tagName)].filter(e => sig(e) === want)[nth]; if (twin && twin !== el) twin.dataset.fk = 'licence-ro'; };
}
// Closes an explanation that is out of date (read-only, or "comes with a licence") once nothing is open over it (a
// sign-in sheet started from it), so focus goes back where it came from.
function closeWhenOnTop(cls, key) {
  const backs = [...document.querySelectorAll('.sheet-back')], top = backs[backs.length - 1];
  if (top && !top.querySelector('.' + cls)) { clearTimeout(S[key + 'Wait']); S[key + 'Wait'] = setTimeout(() => closeWhenOnTop(cls, key), 200); return; }
  const close = S[key]; S[key] = null; if (close) close();
}
function readOnlySheet() {
  const s = S.cur, d = describe(s) || {};
  const sh = sheet('Vdex is read-only', h('div', { class: 'stack' },
    h('p', null, d.line || 'Vdex is read-only here.'),
    h('p', { class: 'small muted' }, 'That change was not saved. Nothing already in Vdex was changed, and with a licence you can change everything again here.'),
    h('div', { class: 'actions' }, ...actions(s, d, () => sh.close())), buyNote(d)));
  sh.el.classList.add('licence-readonly');
  S.roClose = sh.close;
  announce('Vdex is read-only. That change was not saved.');
  // Focus goes to the sheet itself, not a button: someone still typing must not press Buy by accident.
  sh.el.tabIndex = -1;
  setTimeout(() => sh.el.focus(), 50);
}
// Asked for something that comes with a licence (cloud storage, a backup or a spreadsheet, a link or QR code that
// passes on the contact card or equipment): say so, and offer one.
const longDay = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
function needsLicence(what) {
  const s = S.cur || {};
  const keep = backupUntil(s) > Date.now() ? backupUntil(s) : 0; // a licence stopped covering this device less than 30 days ago
  const thing = what === 'cloud' ? 'Keeping a copy in your own cloud storage' : what === 'link' ? 'Sending your contact card or equipment as a link or QR code' : what === 'prompter' ? 'The teleprompter'
    : keep ? 'Saving spreadsheet files' : 'Saving backups and spreadsheet files';
  // A licence that is still waiting to be added to this device, or a device whose place on the licence was moved: its
  // own line and next step, never an offer to buy again.
  const d = ['pending', 'released', 'offline'].includes(s.mode) ? describe(s) : null;
  const sh = sheet('Comes with a licence', h('div', { class: 'stack' },
    h('p', null, `${thing} comes with a Vdex licence.`),
    d ? h('p', { class: 'small' }, d.line) : '',
    keep && s.mode !== 'offline' ? h('p', { class: 'small' }, `Export backup still saves a backup file of everything here until ${longDay(keep)}.`) : '',
    h('p', { class: 'small muted' }, `${s.mode === 'trial' ? 'Cloud storage, backup files and spreadsheets need the licence; everything else works during your free trial. ' : ''}PDFs, printing and links for clients and crew always work, and your data is kept on this device.`),
    h('div', { class: 'actions' }, ...actions(s, d ? { retry: d.retry, again: d.again } : { buy: !play(), enter: true, restore: ios() }, () => sh.close())), buyNote({ buy: !d })));
  sh.el.classList.add('licence-needed');
  S.needClose = sh.close;
  sh.el.tabIndex = -1; setTimeout(() => sh.el.focus(), 50); // not a button: someone still typing must not press Buy by accident
}
function detailsSheet() {
  const s = S.cur, d = describe(s); if (!d) return;
  const sh = sheet('Licence', h('div', { class: 'stack' }, h('p', null, d.line), h('div', { class: 'actions' }, ...actions(s, d, () => sh.close())), buyNote(d)));
}

const shortDay = iso => day(iso) || 'unknown';
// When a licence already has 3 devices: the list, with "Move it here" for each (3 times a month).
function chooser(msg, r, pick, what) {
  const list = h('ul', { class: 'lic-computers' }, ...(r.computers || []).map(c => h('li', null,
    h('span', null, h('b', null, c.os === 'Android' ? 'Android app' : /^iP/.test(c.os || '') ? `${c.os} app` : c.os || 'Computer'), ` · added ${shortDay(c.added)} · last used ${shortDay(c.seen)}`),
    h('button', { class: 'btn ghost small', disabled: !r.swapsLeft, onclick: () => pick(c.tag) }, 'Move it here'))));
  msg.className = 'small'; msg.replaceChildren(
    h('span', null, `Your licence is already in use on ${plural((r.computers || []).length, 'device')}, its limit. To use it on this ${what}, choose one to take it off. `),
    h('span', { class: 'muted' }, r.swapsLeft ? `You can move it ${plural(r.swapsLeft, 'more time')} this month.` : 'It has been moved 3 times this month already: reply to the email your licence came in and we will help.'),
    list);
  msg.tabIndex = -1; setTimeout(() => msg.focus(), 30); // the explanation, not a button: a stray Enter must not move the licence
}

// Desktop: pastes and activates a code. When all its devices are taken, offers to move it from one of them.
export function enterCode(prefill = '') {
  const l = L(); if (!l) return;
  const box = h('textarea', { rows: 4, class: 'licence-code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Licence code', placeholder: 'VDEX-…' });
  box.value = prefill;
  const msg = h('p', { class: 'small', role: 'status' });
  const go = h('button', { class: 'btn primary', onclick: () => send() }, 'Activate');
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Paste the code from your email: all of it, starting with VDEX-. Vdex activates it online once, so it can count the devices it is used on (up to 3).'),
    box, msg, h('div', { class: 'actions' }, go));
  const sh = sheet('Enter licence code', body);
  setTimeout(() => box.focus(), 50);
  async function send(release) {
    go.disabled = true; go.textContent = 'Activating…'; msg.textContent = ''; msg.className = 'small';
    const r = await l.enter(box.value, release ? { release } : {}).catch(e => ({ error: e.message }));
    go.disabled = false; go.textContent = 'Activate';
    if (r && r.error === 'full') return chooser(msg, r, send, 'computer');
    if (!r || r.error) { msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close();
    toast(r.mode === 'licensed' ? 'Thank you! Vdex is activated on this computer.' : r.mode === 'pending' ? 'Code saved. Vdex activates it the next time it is online.' : 'Vdex could not reach the licence server. Try again when you are online.');
  }
}

// The 6-digit code from the email, as typed or pasted (spaces and anything else around the digits are dropped). One that
// is not 6 digits is never sent: the box gets the focus back and the line under it says what is wanted.
const sixDigits = (box, msg) => { const code = box.value.replace(/\D/g, ''); if (code.length === 6) return code; msg.textContent = 'Type the 6 digits from the email.'; msg.className = 'small licence-warn'; box.focus(); return ''; };
// Website: sign in with the licence's email. Step 1 sends a 6-digit code there; step 2 checks it.
export function signIn() {
  const l = L(); if (!l || !web()) return;
  const msg = h('p', { class: 'small', role: 'status' });
  const email = h('input', { type: 'email', autocomplete: 'email', inputMode: 'email', 'aria-label': 'Email address', placeholder: 'you@example.com' });
  const codeBox = h('textarea', { rows: 3, class: 'licence-code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Licence code', placeholder: 'VDEX-…', hidden: true });
  let useCode = false, to = '';
  const toggle = h('button', { type: 'button', class: 'btn ghost small', onclick: () => { useCode = !useCode; codeBox.hidden = !useCode; email.hidden = useCode; toggle.textContent = useCode ? 'Use your email address instead' : 'Have a licence code? Use it instead'; (useCode ? codeBox : email).focus(); } }, 'Have a licence code? Use it instead');
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Email me a code');
  const step1 = h('form', { class: 'stack', novalidate: true, onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const addr = email.value.trim();
    if (!useCode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { msg.textContent = 'Type the email address your licence belongs to.'; msg.className = 'small licence-warn'; return; }
    if (useCode && !codeBox.value.trim()) { msg.textContent = 'Paste your licence code.'; msg.className = 'small licence-warn'; codeBox.focus(); return; }
    send.disabled = true; send.textContent = 'Sending…';
    const r = await l.start(useCode ? { code: codeBox.value } : { email: addr });
    send.disabled = false; send.textContent = 'Email me a code';
    if (r.error) { msg.textContent = r.error; msg.className = 'small licence-warn'; return; }
    to = (useCode ? r.email : addr).toLowerCase();
    step1.hidden = true; step2.hidden = false;
    whereTo.textContent = useCode ? `A 6-digit code is on its way to ${to}, the email address in your licence code. It works for 15 minutes.` : `If ${to} has a Vdex licence, a 6-digit code is on its way there. It works for 15 minutes. Nothing after a few minutes? Check your spam folder, or try the address you bought with.`;
    digits.focus();
  } },
  h('p', { class: 'small muted' }, app() ? 'Sign in with the email address of your Vdex licence. We email you a 6-digit code to type in here.'
    : 'Sign in with the email address you bought your licence with. We email you a 6-digit code to type in here.'),
  email, codeBox, !ios() && h('div', null, toggle), h('div', { class: 'actions' }, send)); // the iPhone app never takes a code (Apple's rule): email, or the App Store
  const whereTo = h('p', { class: 'small muted', role: 'status' });
  const digits = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 40, pattern: '[0-9 ]*', 'aria-label': '6-digit code', placeholder: '123456', class: 'licence-digits' }); // room for a code pasted with spaces around it: sixDigits() takes the digits
  const verify = h('button', { type: 'submit', class: 'btn primary' }, 'Sign in');
  const again = h('button', { type: 'button', class: 'btn ghost', onclick: () => { step2.hidden = true; step1.hidden = false; msg.textContent = ''; digits.value = ''; send.focus(); } }, 'Send a new code');
  const step2 = h('form', { class: 'stack', hidden: true, onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const addr = to, code = sixDigits(digits, msg); if (!code) return;
    verify.disabled = true; verify.textContent = 'Signing in…';
    const r = await l.verify(addr, code);
    verify.disabled = false; verify.textContent = 'Sign in';
    if (r && r.full) {
      set(r); step2.hidden = true;
      const pick = async tag => {
        const x = await l.seat(tag);
        if (x && x.error === 'full') return chooser(msg, x, pick, 'phone');
        if (!x || x.error || x.offline || x.mode !== 'licensed') { msg.textContent = (x && typeof x.error === 'string' && x.error !== 'full' && x.error) || 'Vdex could not reach the licence server. Try again when you are online.'; msg.className = 'small licence-warn'; return; }
        set(x); sh.close(); toast('Signed in. Thank you!');
      };
      return chooser(msg, r.full, pick, 'phone');
    }
    if (!r || r.error) { msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close();
    toast(r.mode === 'licensed' ? 'Signed in. Thank you!' : r.mode === 'pending' ? 'Signed in. Vdex adds this phone to your licence the next time it is online.' : 'Signed in.');
  } }, whereTo, digits, h('div', { class: 'actions' }, verify, again));
  const sh = sheet('Sign in to Vdex', h('div', { class: 'stack' }, step1, step2, msg));
  setTimeout(() => email.focus(), 50);
}

// An App Store licence: add an email address, so the same licence signs in on the website and in the Android app, and
// the desktop code carries it. Step 1 emails a 6-digit code there; step 2 links the address.
function addEmailSheet(after = () => {}) {
  const l = L(); if (!l || !l.addEmail) return;
  const msg = h('p', { class: 'small', role: 'status' });
  const email = h('input', { type: 'email', autocomplete: 'email', inputMode: 'email', 'aria-label': 'Email address', placeholder: 'you@example.com' });
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Email me a code');
  let to = '';
  const step1 = h('form', { class: 'stack', novalidate: true, onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const addr = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { msg.textContent = 'Type the email address to add.'; msg.className = 'small licence-warn'; return; }
    send.disabled = true; send.textContent = 'Sending…';
    const r = await l.addEmail(addr);
    send.disabled = false; send.textContent = 'Email me a code';
    if (r.error) { msg.textContent = r.error; msg.className = 'small licence-warn'; return; }
    to = addr.toLowerCase(); step1.hidden = true; step2.hidden = false;
    whereTo.textContent = `A 6-digit code is on its way to ${to}. It works for 15 minutes. Nothing after a few minutes? Check your spam folder.`;
    digits.focus();
  } },
  h('p', { class: 'small muted' }, 'Your licence works on up to 3 of your devices. With an email address on it, you can sign in with that address on the website and on your other devices, and the code for the desktop app carries it too. We email you a 6-digit code to type in here.'),
  email, h('div', { class: 'actions' }, send));
  const whereTo = h('p', { class: 'small muted', role: 'status' });
  const digits = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 40, pattern: '[0-9 ]*', 'aria-label': '6-digit code', placeholder: '123456', class: 'licence-digits' }); // room for a code pasted with spaces around it: sixDigits() takes the digits
  const link = h('button', { type: 'submit', class: 'btn primary' }, 'Add the address');
  const again = h('button', { type: 'button', class: 'btn ghost', onclick: () => { step2.hidden = true; step1.hidden = false; msg.textContent = ''; digits.value = ''; send.focus(); } }, 'Send a new code');
  const step2 = h('form', { class: 'stack', hidden: true, onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const code = sixDigits(digits, msg); if (!code) return;
    link.disabled = true; link.textContent = 'Adding…';
    const r = await l.verifyEmail(to, code);
    link.disabled = false; link.textContent = 'Add the address';
    if (!r || r.error) { msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close(); after();
    toast(`${to} is on your licence: sign in with it on the website and on your other devices.`);
  } }, whereTo, digits, h('div', { class: 'actions' }, link, again));
  const sh = sheet('Add your email', h('div', { class: 'stack' }, step1, step2, msg));
  setTimeout(() => email.focus(), 50);
}

// The Play app: put this phone (back) on the licence, choosing which device to take off when it is full.
async function addPhone() {
  const l = L();
  const msg = h('p', { class: 'small', role: 'status' }, 'Checking…');
  const sh = sheet('Add this phone', h('div', { class: 'stack' }, msg));
  const go = async tag => {
    const r = await l.seat(tag);
    if (r && r.error === 'full') return chooser(msg, r, go, 'phone');
    if (!r || r.error || r.offline) { msg.textContent = (r && r.error) || 'Vdex could not reach the licence server. Try again when you are online.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close(); toast('This phone is on your licence');
  };
  go();
}

// Delete my licence records (Apple's rule for apps with an account, and anyone's right to ask): says what goes and what
// stays before anything is deleted.
function forgetSheet() {
  const l = L(), s = S.cur || {}, lic = s.licence || {};
  const what = lic.email ? `the email address of your licence (${lic.email})` : 'the link between your licence and your App Store purchase';
  const msg = h('p', { class: 'small licence-warn', role: 'status' });
  const go = h('button', { class: 'btn danger', onclick: async () => {
    go.disabled = true; go.textContent = 'Deleting…';
    const r = await l.forget().catch(e => ({ error: e.message }));
    if (!r || r.error) { go.disabled = false; go.textContent = 'Delete my records'; msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; return; }
    set(r); sh.close(); toast('Your licence records have been deleted, and Vdex is signed out here');
  } }, 'Delete my records');
  const sh = sheet('Delete my licence records', h('div', { class: 'stack' },
    h('p', null, `This deletes what Vdex's licence server keeps about you: ${what}, and what the list of devices on your licence says about each one (each keeps its place for 90 days, so this frees none). Vdex signs out here, and your other devices are signed out at their next check. A computer that still has your licence code puts itself back at its next weekly check: use Release this computer there first.`),
    h('p', { class: 'small muted' }, `Your licence itself is not cancelled: ${lic.comp ? `sign in again with your licence code${ios() ? ' on the website' : ' (Have a licence code? Use it instead)'}, since a free licence is found again only by its code,` : `${ios() ? 'restore your App Store purchase, or ' : ''}sign in again at any time,`} and the records are made afresh. Stripe, the seller named on your receipt and Apple keep their own records of a purchase. Your work in Vdex is not touched.`),
    msg, h('div', { class: 'actions' }, go)));
}

function releaseSheet(removeOnly = false) {
  const l = L(), w = web();
  const label = removeOnly ? 'Remove the code' : w ? 'Sign out' : 'Release this computer';
  const go = h('button', { class: 'btn primary', onclick: async () => {
    go.disabled = true; go.textContent = w ? 'Signing out…' : 'Releasing…';
    const r = await l.release().catch(e => ({ error: e.message }));
    if (!r || r.error) { go.disabled = false; go.textContent = label; msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; return; }
    set(r); sh.close(); toast(removeOnly ? 'Licence code removed' : w ? 'Signed out' : 'This computer has been released');
  } }, label);
  const msg = h('p', { class: 'small licence-warn', role: 'status' });
  const sh = sheet(w ? 'Sign out' : removeOnly ? 'Remove the licence code' : 'Release this computer', h('div', { class: 'stack' },
    h('p', null, w ? `This signs Vdex out on this ${app() ? 'phone, and gives its place on your licence to another device' : 'browser'}.` : removeOnly ? 'This takes the licence code off this computer.' : 'This takes your licence off this computer, so you can use the code on another one.'),
    h('p', { class: 'small muted' }, `Your bookings and everything else stay here. Without a licence, Vdex here goes back to the free trial, or is read-only if the trial is over. You can ${w ? 'sign in' : 'enter the code'}${ios() ? ', or restore the App Store purchase,' : ''} again at any time.`),
    msg, h('div', { class: 'actions' }, go)));
}

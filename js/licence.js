// The licence, as the page shows it, in the desktop app and on the website (and the Google Play app, which is the
// website). Each has its own source of truth and both answer the same questions:
//   desktop: desktop/licence.js through window.vdexDesktop.licence (30-day trial → a licence code → up to 3 devices)
//   website: js/licence-web.js (30-day trial → sign in with the licence's email; the Play app takes one of the 3 places)
// When the trial is over and there is no working licence, Vdex is read-only: the store refuses changes (store.setGate)
// and says why, while opening, searching, printing and exporting keep working.
import { h, sheet, toast, announce, muteToasts } from './util.js';
import { setGate, redraw } from './store.js';

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
const here = () => (play() ? 'phone' : 'computer');

function set(s) {
  if (!s || s.error || !s.mode) return;
  S.cur = s;
  S.listeners.forEach(f => { try { f(s); } catch { /* ignore */ } });
  paintBar();
}
const refresh = async () => { await ready; const l = L(); if (l) set(await l.state().catch(() => null)); return S.cur; };

export function initLicence() {
  if (!ready) ready = start();
  return ready;
}
async function start() {
  P = window.vdexDesktop && window.vdexDesktop.licence ? Object.assign(Object.create(window.vdexDesktop.licence), { kind: 'desktop' })
    : (await import('./licence-web.js')).webLicence();
  set(await P.state().catch(() => null));
  P.onChange(set);
  setGate(({ form = false } = {}) => {
    if (!S.cur || S.cur.canEdit !== false) return true;
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
    : web() ? `sign in with the email address you bought a licence with (20 USD once, for up to ${seats} of your devices)`
      : `add a licence: 20 USD once, for up to ${seats} of your devices`;
  const shop = !play();
  switch (s.mode) {
    case 'founder': return { line: 'Free licence: thank you for using Vdex from the start.', tone: 'ok' };
    case 'trial': return { line: `Free trial: ${plural(s.trialLeft, 'day')} left${s.trialEnds ? ` (until ${day(s.trialEnds)})` : ''}. After that Vdex is read-only here until you ${offer}.`, buy: shop, enter: true };
    case 'ended': return { line: `Your free trial has ended, so Vdex is read-only here: you can open, search, print and export everything, but not change it. To change things again, ${offer}.`, tone: 'warn', buy: shop, enter: true };
    case 'licensed': return web()
      ? { line: `Signed in as ${l.email}${l.comp ? ' · free licence' : ''} · up to ${plural(seats, 'device')}${play() ? ', and this phone is one of them' : ''}.`, tone: 'ok', release: true }
      : { line: `Licensed to ${who(l)}${l && l.comp ? ' · free licence' : ''} · up to ${plural(seats, 'device')}.`, tone: 'ok', copy: true, release: true };
    case 'pending': return web()
      ? { line: `Signed in as ${l.email}, but this phone is not on your licence yet: Vdex needs the internet once to add it.`, tone: s.canEdit ? '' : 'warn', retry: true, release: true }
      : { line: `Licensed to ${who(l)}, but not activated on this computer yet: Vdex needs the internet once to do that${s.daysLeft > 0 ? ` (${plural(s.daysLeft, 'day')} left)` : ''}.`, tone: s.daysLeft > 0 ? '' : 'warn', retry: true, remove: true };
    case 'released': return { line: `This ${here()} is not on your licence: it is in use on ${plural(seats, 'other device')}, its limit. ${web() ? 'Add this phone' : 'Activate it here again'} to choose which device to take off.`, tone: 'warn', again: true, [web() ? 'release' : 'remove']: true };
    case 'cancelled': return { line: `This licence has been cancelled, for example after a refund. If you think that is a mistake, reply to the email your licence came in.`, tone: 'warn', buy: shop, enter: true, remove: !web() };
    case 'expired': return { line: `Your licence ended on ${day(l && l.expires)}.`, tone: 'warn', buy: shop, enter: true, remove: true };
    case 'offline': return { line: `Vdex has not been able to check your ${web() ? 'sign-in' : 'licence'} for 90 days. Connect to the internet and press Try again.`, tone: 'warn', retry: true };
    default: return null;
  }
}
function actions(s, d, after = () => {}) {
  const l = L(), b = [];
  if (d.buy) b.push(h('button', { class: 'btn primary', onclick: () => l.buy() }, 'Buy a licence · 20 USD'));
  if (d.enter) b.push(h('button', { class: 'btn ghost', onclick: () => (web() ? signIn() : enterCode()) }, web() ? 'Sign in' : 'Enter licence code'));
  if (d.again) b.push(h('button', { class: 'btn primary', onclick: async () => (web() ? addPhone() : enterCode(await l.code())) }, web() ? 'Add this phone' : 'Activate here again'));
  if (d.retry) b.push(h('button', { class: 'btn primary', onclick: e => retry(e.target, after) }, 'Try again'));
  if (d.copy) b.push(h('button', { class: 'btn ghost', onclick: async () => { try { await navigator.clipboard.writeText(await l.code()); toast('Licence code copied'); } catch { toast('Could not copy'); } } }, 'Copy the code'));
  if (d.release) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet() }, web() ? 'Sign out' : 'Release this computer'));
  if (d.remove) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet(true) }, 'Remove the code'));
  return b;
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

/* ------------------------------ Settings → About ------------------------------ */
export function licencePanel() {
  const el = h('div', { class: 'stack licence-panel', hidden: true });
  const draw = () => {
    const s = S.cur, d = s && describe(s);
    if (!d) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const b = actions(s, d, draw);
    el.replaceChildren(h('h3', { class: 'licence-title' }, 'Licence'), h('p', { class: 'small' + (d.tone === 'warn' ? ' licence-warn' : '') }, d.line), b.length ? h('div', { class: 'actions' }, ...b) : '');
  };
  draw();
  const off = onLicence(draw);
  initLicence().then(() => { if (!S.cur) refresh(); else draw(); });
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
    : d.buy ? [small('Buy · 20 USD', () => L().buy(), true), small(web() ? 'Sign in' : 'Enter code', enter)]
    : d.enter ? [small('Sign in', enter, true)]
    : [small('Details', () => detailsSheet(), true)];
  const bar = h('div', { class: 'update-bar licence-bar' + (urgent ? ' urgent' : ''), role: 'status' },
    h('span', null, text), ...buttons,
    h('button', { class: 'icon-btn', 'aria-label': 'Hide until Vdex is next opened', onclick: () => { S.hide = key; paintBar(); } }, '✕'));
  if (!S.bar || S.bar.firstChild.textContent !== text) announce(text);
  if (S.bar) S.bar.replaceWith(bar);
  S.bar = bar;
  if (!bar.isConnected) document.body.append(bar);
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
function readOnlySheet() {
  const s = S.cur, d = describe(s) || {};
  const sh = sheet('Vdex is read-only', h('div', { class: 'stack' },
    h('p', null, d.line || 'Vdex is read-only here.'),
    h('p', { class: 'small muted' }, 'That change was not saved. Everything already in Vdex is safe, and with a licence you can change everything again here.'),
    h('div', { class: 'actions' }, ...actions(s, d, () => sh.close()))));
  sh.el.classList.add('licence-readonly');
  announce('Vdex is read-only. That change was not saved.');
  // Focus goes to the sheet itself, not a button: someone still typing must not press Buy by accident.
  sh.el.tabIndex = -1;
  setTimeout(() => sh.el.focus(), 50);
}
function detailsSheet() {
  const s = S.cur, d = describe(s); if (!d) return;
  const sh = sheet('Licence', h('div', { class: 'stack' }, h('p', null, d.line), h('div', { class: 'actions' }, ...actions(s, d, () => sh.close()))));
}

const shortDay = iso => day(iso) || 'unknown';
// When a licence already has 3 devices: the list, with "Move it here" for each (3 times a month).
function chooser(msg, r, pick, what) {
  const list = h('ul', { class: 'lic-computers' }, ...(r.computers || []).map(c => h('li', null,
    h('span', null, h('b', null, c.os === 'Android' ? 'Android app' : c.os || 'Computer'), ` · added ${shortDay(c.added)} · last used ${shortDay(c.seen)}`),
    h('button', { class: 'btn ghost small', disabled: !r.swapsLeft, onclick: () => pick(c.tag) }, 'Move it here'))));
  msg.className = 'small'; msg.replaceChildren(
    h('span', null, `Your licence is already in use on ${plural((r.computers || []).length, 'device')}, its limit. To use it on this ${what}, choose one to take it off. `),
    h('span', { class: 'muted' }, r.swapsLeft ? `You can move it ${plural(r.swapsLeft, 'more time')} this month.` : 'It has been moved 3 times this month already: reply to the email your licence came in and we will help.'),
    list);
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

// Website: sign in with the licence's email. Step 1 sends a 6-digit code there; step 2 checks it.
export function signIn() {
  const l = L(); if (!l || !web()) return;
  const msg = h('p', { class: 'small', role: 'status' });
  const email = h('input', { type: 'email', autocomplete: 'email', inputMode: 'email', 'aria-label': 'Email address', placeholder: 'you@example.com' });
  const codeBox = h('textarea', { rows: 3, class: 'licence-code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Licence code', placeholder: 'VDEX-…', hidden: true });
  let useCode = false, to = '';
  const toggle = h('button', { type: 'button', class: 'btn ghost small', onclick: () => { useCode = !useCode; codeBox.hidden = !useCode; email.hidden = useCode; toggle.textContent = useCode ? 'Use your email address instead' : 'Have a licence code? Use it instead'; (useCode ? codeBox : email).focus(); } }, 'Have a licence code? Use it instead');
  const send = h('button', { type: 'submit', class: 'btn primary' }, 'Email me a code');
  const step1 = h('form', { class: 'stack', onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const addr = email.value.trim();
    if (!useCode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { msg.textContent = 'Type the email address your licence belongs to.'; msg.className = 'small licence-warn'; return; }
    send.disabled = true; send.textContent = 'Sending…';
    const r = await l.start(useCode ? { code: codeBox.value } : { email: addr });
    send.disabled = false; send.textContent = 'Email me a code';
    if (r.error) { msg.textContent = r.error; msg.className = 'small licence-warn'; return; }
    to = (useCode ? r.email : addr).toLowerCase();
    step1.hidden = true; step2.hidden = false;
    whereTo.textContent = useCode ? `A 6-digit code is on its way to ${to}, the email address in your licence code. It works for 15 minutes.` : `If ${to} has a Vdex licence, a 6-digit code is on its way there. It works for 15 minutes. Nothing after a few minutes? Check your spam folder, or try the address you bought with.`;
    digits.focus();
  } },
  h('p', { class: 'small muted' }, play() ? 'Sign in with the email address of your Vdex licence. We email you a 6-digit code to type in here.'
    : 'Sign in with the email address you bought your licence with. We email you a 6-digit code to type in here.'),
  email, codeBox, h('div', null, toggle), h('div', { class: 'actions' }, send));
  const whereTo = h('p', { class: 'small muted', role: 'status' });
  const digits = h('input', { type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 7, pattern: '[0-9 ]*', 'aria-label': '6-digit code', placeholder: '123456', class: 'licence-digits' });
  const verify = h('button', { type: 'submit', class: 'btn primary' }, 'Sign in');
  const again = h('button', { type: 'button', class: 'btn ghost', onclick: () => { step2.hidden = true; step1.hidden = false; msg.textContent = ''; digits.value = ''; } }, 'Send a new code');
  const step2 = h('form', { class: 'stack', hidden: true, onsubmit: async e => {
    e.preventDefault(); msg.textContent = ''; msg.className = 'small';
    const addr = to;
    verify.disabled = true; verify.textContent = 'Signing in…';
    const r = await l.verify(addr, digits.value);
    verify.disabled = false; verify.textContent = 'Sign in';
    if (r && r.full) { set(r); step2.hidden = true; return chooser(msg, r.full, async tag => { const x = await l.seat(tag); if (x && x.error && x.error !== 'full') { msg.textContent = x.error; msg.className = 'small licence-warn'; return; } set(await l.state()); sh.close(); toast('Signed in. Thank you!'); }, 'phone'); }
    if (!r || r.error) { msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close();
    toast(r.mode === 'licensed' ? 'Signed in. Thank you!' : r.mode === 'pending' ? 'Signed in. Vdex adds this phone to your licence the next time it is online.' : 'Signed in.');
  } }, whereTo, digits, h('div', { class: 'actions' }, verify, again));
  const sh = sheet('Sign in to Vdex', h('div', { class: 'stack' }, step1, step2, msg));
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
    h('p', null, w ? `This signs Vdex out on this ${play() ? 'phone, and gives its place on your licence to another device' : 'browser'}.` : removeOnly ? 'This takes the licence code off this computer.' : 'This takes your licence off this computer, so you can use the code on another one.'),
    h('p', { class: 'small muted' }, `Your bookings and everything else stay here. Without a licence, Vdex here goes back to the free trial, or is read-only if the trial is over. You can ${w ? 'sign in' : 'enter the code'} again at any time.`),
    msg, h('div', { class: 'actions' }, go)));
}

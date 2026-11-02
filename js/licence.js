// The desktop app's licence, as the page shows it (loaded only in the desktop app; the website stays free). The
// desktop app decides everything (desktop/licence.js) and tells the page through window.vdexDesktop.licence:
//   free trial (30 days) → a licence code (20 USD, or a free one from us) → up to 3 computers per code.
// When the trial is over and there is no working code, Vdex is read-only: the store refuses changes (store.setGate)
// and says why, while opening, searching, printing and exporting keep working.
import { h, sheet, toast, announce, muteToasts } from './util.js';
import { setGate, redraw } from './store.js';

const L = () => (window.vdexDesktop && window.vdexDesktop.licence) || null;
const S = { cur: null, bar: null, listeners: new Set(), blockedAt: 0, input: 0, hide: '' };
export const licenceState = () => S.cur;
export const onLicence = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const day = iso => { const d = new Date(String(iso || '') + (String(iso).length === 10 ? 'T12:00:00' : '')); return Number.isNaN(+d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const who = l => (l ? [l.name, l.email && l.name ? `(${l.email})` : l.email].filter(Boolean).join(' ') : '');

function set(s) {
  if (!s || s.error || !s.mode) return;
  S.cur = s;
  S.listeners.forEach(f => { try { f(s); } catch { /* ignore */ } });
  paintBar();
}
const refresh = async () => { const l = L(); if (l) set(await l.state().catch(() => null)); return S.cur; };

export async function initLicence() {
  const l = L(); if (!l) return;
  set(await l.state().catch(() => null));
  l.onChange(set);
  setGate(() => {
    if (!S.cur || S.cur.canEdit !== false) return true;
    muteToasts(600);
    // Background work (a calendar sync, say) is refused quietly; a change someone just asked for is explained.
    const asked = Date.now() - S.input < 3000;
    if (asked) {
      if (!document.querySelector('.sheet.licence-readonly')) readOnlySheet(); else announce('Vdex is read-only. Nothing was changed.');
      clearTimeout(S.redraw); S.redraw = setTimeout(redraw, 0); // a box ticked on screen goes back to what is stored
    }
    return false;
  });
  const touched = e => { if (e.isTrusted) S.input = Date.now(); };
  for (const t of ['pointerdown', 'keydown', 'change']) document.addEventListener(t, touched, true);
  // The trial can run out while Vdex is open: look again whenever it comes back to the front, and every hour.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(refresh, 3600e3);
}

/* ------------------------------- what to say ------------------------------- */
// One line about the licence, and the buttons that go with it, for each state.
function describe(s) {
  const l = s.licence, seats = (l && l.seats) || s.seats || 3;
  switch (s.mode) {
    case 'founder': return { line: 'Free licence: thank you for using Vdex from the start.', tone: 'ok' };
    case 'trial': return { line: `Free trial: ${plural(s.trialLeft, 'day')} left${s.trialEnds ? ` (until ${day(s.trialEnds)})` : ''}. After that Vdex is read-only until you add a licence: 20 USD once, for up to ${seats} of your computers.`, buy: true, enter: true };
    case 'ended': return { line: 'Your free trial has ended, so Vdex is read-only: you can open, search, print and export everything, but not change it. A licence is 20 USD once, for up to 3 of your computers.', tone: 'warn', buy: true, enter: true };
    case 'licensed': return { line: `Licensed to ${who(l)}${l && l.comp ? ' · free licence' : ''} · up to ${plural(seats, 'computer')}.`, tone: 'ok', copy: true, release: true };
    case 'pending': return { line: `Licensed to ${who(l)}, but not activated on this computer yet: Vdex needs the internet once to do that${s.daysLeft > 0 ? ` (${plural(s.daysLeft, 'day')} left)` : ''}.`, tone: s.daysLeft > 0 ? '' : 'warn', retry: true, remove: true };
    case 'released': return { line: `This computer is no longer on your licence: the code is in use on ${seats} other computers. Activate it here again to choose which computer to take off.`, tone: 'warn', again: true, remove: true };
    case 'cancelled': return { line: 'This licence code has been cancelled, for example after a refund. If you think that is a mistake, reply to the email your code came in.', tone: 'warn', buy: true, enter: true, remove: true };
    case 'expired': return { line: `Your licence ended on ${day(l && l.expires)}.`, tone: 'warn', buy: true, enter: true, remove: true };
    case 'offline': return { line: 'Vdex has not been able to check your licence for 90 days. Connect to the internet and press Try again.', tone: 'warn', retry: true };
    default: return null;
  }
}
function actions(s, d, after = () => {}) {
  const l = L(), b = [];
  if (d.buy) b.push(h('button', { class: 'btn primary', onclick: () => l.buy() }, 'Buy a licence · 20 USD'));
  if (d.enter) b.push(h('button', { class: 'btn ghost', onclick: () => enterCode() }, 'Enter licence code'));
  if (d.again) b.push(h('button', { class: 'btn primary', onclick: async () => enterCode(await l.code()) }, 'Activate here again'));
  if (d.retry) b.push(h('button', { class: 'btn primary', onclick: e => retry(e.target, after) }, 'Try again'));
  if (d.copy) b.push(h('button', { class: 'btn ghost', onclick: async () => { try { await navigator.clipboard.writeText(await l.code()); toast('Licence code copied'); } catch { toast('Could not copy'); } } }, 'Copy the code'));
  if (d.release) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet() }, 'Release this computer'));
  if (d.remove) b.push(h('button', { class: 'btn ghost', onclick: () => releaseSheet(true) }, 'Remove the code'));
  return b;
}

// Checks the licence online now. The message says what the server answered, not just whether it is licensed.
async function retry(btn, after = () => {}) {
  const was = S.cur && S.cur.mode;
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  const r = await L().recheck().catch(() => null);
  set(r); after();
  const m = r && r.mode;
  toast(m === 'licensed' ? 'Licence activated' : m === 'released' ? 'This code is in use on its other computers' : m === 'cancelled' ? 'This licence code has been cancelled' : m === was ? 'Still not able to reach the licence server' : 'Licence checked');
}

/* ------------------------------ Settings → About ------------------------------ */
export function licencePanel() {
  const el = h('div', { class: 'stack licence-panel' });
  const draw = () => {
    const s = S.cur, d = s && describe(s);
    if (!d) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    const b = actions(s, d, draw);
    el.replaceChildren(h('h3', { class: 'licence-title' }, 'Licence'), h('p', { class: 'small' + (d.tone === 'warn' ? ' licence-warn' : '') }, d.line), b.length ? h('div', { class: 'actions' }, ...b) : '');
  };
  draw();
  const off = onLicence(draw);
  if (!S.cur) refresh();
  return { el, destroy: off };
}

/* ---------------------------------- the bar ---------------------------------- */
// A bar at the bottom while the trial is in its last week, and whenever Vdex is read-only.
function paintBar() {
  const s = S.cur, d = s && describe(s);
  const urgent = s && s.canEdit === false;
  const show = d && (urgent || (s.mode === 'trial' && s.trialLeft <= 7) || (s.mode === 'pending' && s.daysLeft <= 7));
  const key = s ? s.mode + (urgent ? '!' : '') : '';
  if (!show || S.hide === key) { if (S.bar) { S.bar.remove(); S.bar = null; document.body.classList.remove('has-licence-bar'); } return; }
  const URGENT = {
    ended: 'Your free trial has ended: Vdex is read-only.', offline: 'Read-only until Vdex can check your licence online.',
    pending: 'Read-only until your licence is activated on this computer.', released: 'Read-only: this computer is no longer on your licence.',
    cancelled: 'Read-only: this licence code has been cancelled.', expired: 'Read-only: your licence has ended.',
  };
  const text = urgent ? URGENT[s.mode] || 'Vdex is read-only.' : s.mode === 'trial' ? `Free trial: ${plural(s.trialLeft, 'day')} left.` : 'Your licence is not activated on this computer yet.';
  const small = (label, onclick, primary) => h('button', { class: `btn ${primary ? 'primary' : 'ghost'} small`, onclick }, label);
  // Each state's own next step: someone who has paid is never asked to buy again.
  const buttons = d.retry ? [small('Try again', e => retry(e.target), true), small('Details', () => detailsSheet())]
    : d.again ? [small('Activate here again', async () => enterCode(await L().code()), true), small('Details', () => detailsSheet())]
    : d.buy ? [small('Buy · 20 USD', () => L().buy(), true), small('Enter code', () => enterCode())]
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
function readOnlySheet() {
  const s = S.cur, d = describe(s) || {};
  const sh = sheet('Vdex is read-only', h('div', { class: 'stack' },
    h('p', null, d.line || 'Vdex is read-only on this computer.'),
    h('p', { class: 'small muted' }, 'That change was not saved. Everything already in Vdex is safe, and the website (vdex.crowmade.app) still works as before. With a licence you can change everything again here.'),
    h('div', { class: 'actions' }, ...actions(s, d, () => sh.close()))));
  sh.el.classList.add('licence-readonly');
  announce('Vdex is read-only. That change was not saved.');
  setTimeout(() => { const b = sh.el.querySelector('.actions .btn'); if (b) b.focus(); }, 50);
}
function detailsSheet() {
  const s = S.cur, d = describe(s); if (!d) return;
  const sh = sheet('Licence', h('div', { class: 'stack' }, h('p', null, d.line), h('div', { class: 'actions' }, ...actions(s, d, () => sh.close()))));
}

const shortDay = iso => day(iso) || 'unknown';
// Pastes and activates a code. When all its computers are taken, offers to move it from one of them.
export function enterCode(prefill = '') {
  const l = L(); if (!l) return;
  const box = h('textarea', { rows: 4, class: 'licence-code', spellcheck: false, autocomplete: 'off', 'aria-label': 'Licence code', placeholder: 'VDEX-…' });
  box.value = prefill;
  const msg = h('p', { class: 'small', role: 'status' });
  const go = h('button', { class: 'btn primary', onclick: () => send() }, 'Activate');
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'Paste the code from your email: all of it, starting with VDEX-. Vdex activates it online once, so it can count the computers it is used on (up to 3).'),
    box, msg, h('div', { class: 'actions' }, go));
  const sh = sheet('Enter licence code', body);
  setTimeout(() => box.focus(), 50);
  async function send(release) {
    go.disabled = true; go.textContent = 'Activating…'; msg.textContent = ''; msg.className = 'small';
    const r = await l.enter(box.value, release ? { release } : {}).catch(e => ({ error: e.message }));
    go.disabled = false; go.textContent = 'Activate';
    if (r && r.error === 'full') return chooseComputer(r);
    if (!r || r.error) { msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; msg.className = 'small licence-warn'; return; }
    set(r); sh.close();
    toast(r.mode === 'licensed' ? 'Thank you! Vdex is activated on this computer.' : r.mode === 'pending' ? 'Code saved. Vdex activates it the next time it is online.' : 'Vdex could not reach the licence server. Try again when you are online.');
  }
  function chooseComputer(r) {
    const list = h('ul', { class: 'lic-computers' }, ...(r.computers || []).map(c => h('li', null,
      h('span', null, h('b', null, c.os || 'Computer'), ` · added ${shortDay(c.added)} · last used ${shortDay(c.seen)}`),
      h('button', { class: 'btn ghost small', disabled: !r.swapsLeft, onclick: () => send(c.tag) }, 'Move it here'))));
    msg.className = 'small'; msg.replaceChildren(
      h('span', null, `This code is already in use on ${plural((r.computers || []).length, 'computer')}, its limit. To use it here, choose one to take it off. `),
      h('span', { class: 'muted' }, r.swapsLeft ? `You can move the code ${plural(r.swapsLeft, 'more time')} this month.` : 'The code has been moved 3 times this month already: reply to the email your code came in and we will help.'),
      list);
  }
}

function releaseSheet(removeOnly = false) {
  const l = L();
  const go = h('button', { class: 'btn primary', onclick: async () => {
    go.disabled = true; go.textContent = 'Releasing…';
    const r = await l.release().catch(e => ({ error: e.message }));
    if (!r || r.error) { go.disabled = false; go.textContent = removeOnly ? 'Remove the code' : 'Release this computer'; msg.textContent = (r && r.error) || 'Something went wrong. Try again.'; return; }
    set(r); sh.close(); toast(removeOnly ? 'Licence code removed' : 'This computer has been released');
  } }, removeOnly ? 'Remove the code' : 'Release this computer');
  const msg = h('p', { class: 'small licence-warn', role: 'status' });
  const sh = sheet(removeOnly ? 'Remove the licence code' : 'Release this computer', h('div', { class: 'stack' },
    h('p', null, removeOnly ? 'This takes the licence code off this computer.' : 'This takes your licence off this computer, so you can use the code on another one.'),
    h('p', { class: 'small muted' }, 'Your bookings and everything else stay here. Without a licence, Vdex on this computer goes back to the free trial, or is read-only if the trial is over. You can enter the code again at any time.'),
    msg, h('div', { class: 'actions' }, go)));
}

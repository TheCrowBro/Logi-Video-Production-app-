// Small DOM + date helpers shared by every page.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'for') el.htmlFor = v;
    else if (k === 'style' || k === 'list' || k.startsWith('aria-') || k.startsWith('data-')) el.setAttribute(k, v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Children for replaceChildren/append with h()'s rules: skip null/false, flatten arrays, strings become text.
export const nodes = (...kids) => kids.flat(Infinity).filter(k => k != null && k !== false && k !== '').map(k => (k.nodeType ? k : document.createTextNode(String(k))));

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => ymd(new Date());
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtLong = s => parseISO(s).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtShort = s => parseISO(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtTime = d => d instanceof Date && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
export const daysUntil = s => Math.round((parseISO(s) - parseISO(todayISO())) / 864e5);

export function money(n, sym = '$') {
  const v = Number(n);
  if (!isFinite(v)) return '—';
  return sym + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// While Vdex is read-only (js/licence.js), a refused change must not be followed by its "Saved".
let toastsOffUntil = 0;
export const muteToasts = ms => { toastsOffUntil = Date.now() + ms; };
export function toast(msg) {
  if (Date.now() < toastsOffUntil) return;
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2700);
}

// Screen-reader announcements.
export function announce(msg) {
  let r = document.getElementById('sr-live');
  if (!r) { r = h('div', { id: 'sr-live', class: 'sr-only', role: 'status', 'aria-live': 'polite' }); document.body.append(r); }
  r.textContent = '';
  setTimeout(() => { r.textContent = msg; }, 50);
}

// The page (#app) is out of reach while anything is open over it: a sheet, a walkthrough, the menu, the search, or a
// full screen (the lock, the PIN set-up, the offer of a longer PIN, the terms). Whatever closes one of those calls this,
// which looks at what is on the page now. A flag remembered from when the thing opened can be out of date by then:
// what was underneath may have closed meanwhile, and writing the flag back would leave the page dead with nothing open.
export function settleApp() {
  const app = document.getElementById('app'); if (!app) return;
  app.inert = !!document.querySelector('.sheet-back, .tour, body > .lock, body > .terms-gate') || document.body.classList.contains('menu-open') || document.body.classList.contains('search-open');
}

const sheetStack = []; // open sheets, newest last: only the top one answers Escape and keeps Tab inside it
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])';

// Modal bottom sheet: traps focus, restores it on close, hides the page from assistive tech while open.
export function sheet(title, body, { onClose, dismissOnBackdrop = true } = {}) {
  window.logiMenu?.close(); window.logiSearch?.close(); // a sheet never opens over the menu or the search: they close first, and the focus comes back to their button
  const opener = document.activeElement;
  // If a redraw replaces the opener while the sheet is open, its stand-in (same data-fk) gets the focus back.
  const fk = opener && opener.closest && opener.closest('[data-fk]') ? opener.closest('[data-fk]').dataset.fk : null;
  const back = h('div', { class: 'sheet-back' });
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    back.remove(); document.removeEventListener('keydown', keys);
    const at = sheetStack.indexOf(back); if (at >= 0) sheetStack.splice(at, 1);
    settleApp(); // the page comes back only when nothing else is over it: not under a walkthrough, and not behind the lock
    if (opener && opener.isConnected) opener.focus();
    else if (fk) { const twin = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (twin) twin.focus({ preventScroll: true }); }
    onClose && onClose();
  };
  const keys = e => {
    // A sheet opened over this one handles the key. And a sheet that is out of reach answers no keys at all: under the
    // lock screen or the offer of a longer PIN, Escape belongs to that screen and must not close what is underneath.
    if (back.inert || sheetStack[sheetStack.length - 1] !== back) return;
    if (e.key === 'Escape') return close();
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('div', { class: 'sheet-tools' }, window.logiHelp && h('button', { class: 'icon-btn sheet-help', 'aria-label': 'Tutorial for this', title: 'Tutorial', onclick: () => window.logiHelp() }, '?'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕'))),
    h('div', { class: 'sheet-body' }, body));
  back.append(box);
  if (dismissOnBackdrop) back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', keys);
  document.body.append(back);
  sheetStack.push(back);
  settleApp();
  return { el: box, close };
}

export const mapsUrl = addr => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
export const telUrl = p => 'tel:' + String(p).replace(/[^\d+]/g, '');
export const safeUrl = u => {
  if (!u) return '';
  const s = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
  return /^https?:/i.test(s) ? s : '';
};

export const empty = (msg, action) => h('div', { class: 'empty' }, h('p', null, msg), action);

// The button that goes back up a level (day → calendar, booking → day, call sheet → booking): a clear return mark in
// a ring, with a shine when it appears and a pulse under the pointer. The text keeps the ‹ so its name reads as before.
export const backBtn = (label, onclick) => h('button', { class: 'btn ghost small back-btn', type: 'button', onclick }, h('span', { class: 'back-arrow' }, '‹'), ' ' + label);

/* ----------------------------------- rates ----------------------------------- */
// A rate typed freely: "450", "$450/day", "£55 an hour", "$500/day, OT $60/hr", "1.200,50 €". The amount that counts
// is the one per day (or with no unit); an hourly amount is used only when there is nothing else. A weekly rate, or
// nothing readable, gives '' so the line is left for the person to fill in.
const toNumber = t => { const m = t.match(/^(.*?)(?:[.,](\d{1,2}))?$/), whole = m[1].replace(/[.,\s]/g, ''); return Number(whole + (m[2] ? '.' + m[2] : '')); };
const RATE_UNIT = /^\s*(?:(?:\/|per\b|an?\b|each\b)\s*(hours?|hrs?|h|days?|d|weeks?|wk)|(hourly|daily|weekly))\b/i;
const COUNT = /^\s*(hours?|hrs?|h|days?|d|weeks?|wk|people|persons?|crew)\b/i; // "2 days at 450", "10hr day": a count, not a price
export function parseRate(r) {
  const s = String(r ?? ''), found = [], re = /\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?(?!\d)/g;
  for (let m; (m = re.exec(s));) {
    let rest = s.slice(m.index + m[0].length), n = toNumber(m[0]);
    if (/^k\b/i.test(rest)) { n *= 1000; rest = rest.slice(1); } // "$1k/day"
    const um = rest.match(RATE_UNIT), u = ((um && (um[1] || um[2])) || '').toLowerCase();
    if (!um && COUNT.test(rest)) continue;
    found.push({ n, unit: u[0] === 'h' ? 'hour' : u[0] === 'w' ? 'week' : u[0] === 'd' ? 'day' : '' });
  }
  const pick = found.find(f => f.unit === 'day') || found.find(f => f.unit === '') || found.find(f => f.unit === 'hour');
  return pick && Number.isFinite(pick.n) ? { amount: pick.n, hourly: pick.unit === 'hour' } : { amount: '', hourly: false };
}
// A person's rate (crew, or someone hired for a job): the amount and whether it is per hour. New records carry the
// amount as a number with rateUnit 'day' or 'hour'; older ones hold whatever was typed, read as above.
export const hasUnit = c => !!(c && typeof c === 'object' && (c.rateUnit === 'day' || c.rateUnit === 'hour') && c.rate !== '' && c.rate != null && Number.isFinite(Number(c.rate)));
export const personRate = c => (hasUnit(c) ? { amount: Number(c.rate), hourly: c.rateUnit === 'hour' }
  : c && typeof c === 'object' && (c.rate === '' || c.rate == null) && (c.rateUnit === 'day' || c.rateUnit === 'hour') ? { amount: '', hourly: c.rateUnit === 'hour' } // a unit chosen, no amount yet: the line is still an hours line
  : parseRate(c && typeof c === 'object' ? c.rate : c));
// The rate as shown on a card: "$450/day", "$55/hour"; an older typed rate is shown as it was typed.
export const rateText = (c, sym = '$') => { if (!hasUnit(c)) return String((c && typeof c === 'object' ? c.rate : c) ?? '').trim(); const n = Number(c.rate); return `${sym}${Number.isInteger(n) ? n : n.toFixed(2)}/${c.rateUnit}`; };
// Saving the form of an older record that held a typed rate: a blank amount keeps the typed text as it was; an amount
// replaces it, and anything the text said beyond an amount and a unit ("$500/day, OT $60/hr") goes into the notes.
const PLAIN_RATE = /^[^\d]{0,3}\d[\d.,\s]*(?:k\b)?\s*(?:\/|per\b|an?\b|each\b)?\s*(?:hours?|hrs?|h|days?|d|hourly|daily)?\s*\.?$/i;
export const typedRate = c => (c && !hasUnit(c) && typeof c.rate === 'string' && c.rate.trim() ? c.rate.trim() : '');
export function keepTypedRate(c, v) {
  const typed = typedRate(c); if (!typed) return v;
  if (v.rate === '' || v.rate == null) return { ...v, rate: typed, rateUnit: undefined };
  if (PLAIN_RATE.test(typed) || String(v.notes || '').includes(typed)) return v;
  return { ...v, notes: [v.notes, 'Rate as typed: ' + typed].filter(Boolean).join('\n') };
}
// The hint under the Rate box of such a record.
export const typedRateHint = c => { const typed = typedRate(c); if (!typed) return ''; return `Typed before: “${typed}”. ` + (personRate(c).amount === '' ? 'It stays as it is until an amount replaces it. ' : 'The amount and unit read from it are filled in; anything more it said goes into the notes when you save. '); };

/* ------------------------------- press and hold ------------------------------- */
// Hold a finger or the mouse button on an element for `ms` without moving and fn runs; the tap that would follow is
// swallowed. Moving (a scroll), lifting or losing the pointer first cancels. The element carries class 'holding'
// meanwhile, for a fill that shows the wait, and controls inside it (buttons, links, fields) are left alone.
export function hold(el, ms, fn, { ignore = 'button, a, input, select, textarea, summary' } = {}) {
  let timer = null, x = 0, y = 0;
  const stop = () => { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove('holding'); };
  el.addEventListener('pointerdown', e => {
    if (timer || e.button !== 0 || (ignore && e.target !== el && e.target.closest(ignore) && e.target.closest(ignore) !== el)) return;
    x = e.clientX; y = e.clientY;
    el.classList.add('holding');
    timer = setTimeout(() => { timer = null; el.classList.remove('holding'); el.dataset.held = '1'; setTimeout(() => { delete el.dataset.held; }, 1500); fn(e); }, ms);
  });
  el.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, stop);
  el.addEventListener('contextmenu', e => { if (timer || el.dataset.held) e.preventDefault(); }); // the browser's own long-press menu would end the hold early
}
export const wasHeld = el => { if (!el.dataset.held) return false; delete el.dataset.held; return true; };

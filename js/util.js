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

export function toast(msg) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2700);
}

// Generic bottom-sheet / dialog. Returns { el, close }.
export function sheet(title, body, { onClose } = {}) {
  const back = h('div', { class: 'sheet-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose && onClose(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, body));
  back.append(box);
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(back);
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

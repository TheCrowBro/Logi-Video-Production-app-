// An act's documents: the press kit (EPK) and the tech rider, as .cs-doc elements that print (js/print.js) and save as a
// web page, and the pieces the Acts page shares with them: the links read from the act's text, its QR code, the input
// list table and the stage plot drawing. Everything is built with h() from the act record, so typed text stays text.
import { h, safeUrl, telUrl, toast, fmtLong, fmtShort, todayISO, ymd } from './util.js';
import { db, byId, upcoming } from './store.js';
import { qrSvg } from './qr.js';
import { printElement, docPage, saveFile, fileName, csv } from './print.js';

/* ------------------------------- links ------------------------------- */
// Known services: a label when the line has none, and a small mark on the button.
const SERVICES = [
  [/(^|\.)spotify\.com$/, 'Spotify', '🎧'], [/(^|\.)music\.apple\.com$/, 'Apple Music', '🎵'], [/(^|\.)bandcamp\.com$/, 'Bandcamp', '💿'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud', '☁'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube', '▶'], [/(^|\.)instagram\.com$/, 'Instagram', '📷'],
  [/(^|\.)tiktok\.com$/, 'TikTok', '🎬'], [/(^|\.)(facebook\.com|fb\.com)$/, 'Facebook', '👥'], [/(^|\.)(twitter\.com|x\.com)$/, 'X', '↗'],
  [/(^|\.)linktr\.ee$/, 'Linktree', '🔗'], [/(^|\.)tidal\.com$/, 'Tidal', '🎵'], [/(^|\.)deezer\.com$/, 'Deezer', '🎵'],
];
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const serviceOf = url => { const host = hostOf(url); const s = SERVICES.find(([re]) => re.test(host)); return s ? { name: s[1], icon: s[2] } : null; };
// The first address on a line: with a scheme, starting www., or a bare domain ("instagram.com/band"), never the part of
// an email address after the @.
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"]*)?/i;

// act.links holds one link per line, "Label: url" (the label is optional). Returns [{ label, url, icon }] for the lines
// that hold a web address; anything else (a mailto:, a javascript: line, plain words) is left out.
export function parseLinks(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = line && line.match(URL_RE);
    if (!m) continue;
    const url = safeUrl(m[0].replace(/[),.;:!?]+$/, ''));
    if (!url || !hostOf(url)) continue;
    const svc = serviceOf(url);
    let label = line.slice(0, m.index).replace(/[\s:|>–—-]+$/, '').trim();
    if (!label) label = svc ? svc.name : hostOf(url);
    out.push({ label: label.length > 40 ? label.slice(0, 39) + '…' : label, url, icon: svc ? svc.icon : '🌐' });
  }
  return out;
}

/* ------------------------------- colours ------------------------------- */
// The stripe on an act's cards. Mid-tone colours that read on the light and the dark schemes; '' is the theme's accent.
export const ACT_COLORS = [['', 'Theme colour'], ['#ff5c8a', '🌸 Pink'], ['#ef4444', '🔴 Red'], ['#f97316', '🟠 Orange'], ['#eab308', '🟡 Gold'],
  ['#22c55e', '🟢 Green'], ['#14b8a6', '🌊 Teal'], ['#22d3ee', '💎 Cyan'], ['#3b82f6', '🔵 Blue'], ['#8b5cf6', '🟣 Purple'], ['#a8a29e', '⚪ Silver']];
export const colorOf = a => (a && /^#[0-9a-f]{3,8}$/i.test(String(a.color || '')) ? a.color : '');
export const stripeStyle = a => (colorOf(a) ? `--ac-color:${colorOf(a)}` : null);

/* ------------------------------- members ------------------------------- */
export const roleOf = p => (p && (p.instrument || p.role)) || '';
// The act's members that are still in People, in the act's order.
export const membersOf = a => (Array.isArray(a && a.members) ? a.members : []).map(id => byId('people', id)).filter(Boolean);
export const initials = name => String(name || '?').trim().split(/\s+/).map(w => [...w][0] || '').slice(0, 2).join('').toUpperCase() || '?';
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/* ------------------------------- QR code ------------------------------- */
const vEsc = s => String(s || '').replace(/([\\;,])/g, '\\$1').replace(/\r?\n/g, '\\n');
// The act's contact as a vCard, or '' when it has no email or phone to scan.
export function actVcard(a) {
  if (!a || !(a.email || a.phone)) return '';
  return ['BEGIN:VCARD', 'VERSION:3.0', `N:${vEsc(a.name)};;;;`, `FN:${vEsc(a.name)}`, `ORG:${vEsc(a.name)}`,
    a.phone && `TEL;TYPE=WORK:${vEsc(a.phone)}`, a.email && `EMAIL:${vEsc(a.email)}`, a.genre && `NOTE:${vEsc(a.genre)}`, 'END:VCARD'].filter(Boolean).join('\r\n');
}
// What the act's QR code holds: its first link, else its contact card. null when there is neither.
export function qrTarget(a) {
  const link = parseLinks(a && a.links)[0];
  if (link) return { text: link.url, caption: `${link.label}: ${link.url}`, what: link.label, link: true };
  const card = actVcard(a);
  return card ? { text: card, caption: `Scan to save ${a.name || 'the act'}’s contact`, what: 'contact card', link: false } : null;
}
// SVG markup per text, made once (medium error correction: it has to scan off a phone in a dark room).
const qrDone = new Map(), qrWait = new Map();
export function qrFor(text) {
  if (qrDone.has(text)) return Promise.resolve(qrDone.get(text));
  if (!qrWait.has(text)) qrWait.set(text, qrSvg(text, { level: 'M' }).then(svg => { qrDone.set(text, svg); qrWait.delete(text); return svg; }, e => { qrWait.delete(text); throw e; }));
  return qrWait.get(text);
}
// Puts the QR for text into el: at once when it was made before (no flash on a redraw), else when it is ready.
export function fillQr(el, text) {
  if (!el || !text) return;
  if (qrDone.has(text)) { el.innerHTML = qrDone.get(text); return; }
  qrFor(text).then(svg => { el.innerHTML = svg; }, () => { el.textContent = 'Too much for a QR code: shorten the link.'; });
}

/* ------------------------------- document parts ------------------------------- */
// A file name in plain ASCII ("Press kit - Bjork.html"): with an accent, a curly quote or an en dash in the name, Chromium
// saves the file as "download" instead.
const ascii = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
const fileFor = (kind, a, ext) => fileName(`${kind} - ${ascii(a.name) || 'act'}`, ext);
const sec = (title, ...kids) => h('div', { class: 'cs-sec' }, h('h4', null, title), ...kids);
const kv = (k, v) => h('div', { class: 'cs-kv' }, h('span', null, k), h('b', null, v));
const updatedISO = a => (a && a.updatedAt ? ymd(new Date(a.updatedAt)) : todayISO());
const cityOf = v => { const parts = String((v && v.address) || '').split(',').map(s => s.trim()).filter(Boolean); return parts.length > 1 ? parts[parts.length - 1] : ''; };
const venueName = b => { const v = b.venueId ? byId('venues', b.venueId) : null; return v ? [v.name, cityOf(v)] : [b.venueName || '', cityOf({ address: b.address })]; };
const showDate = b => (b.endDate && b.endDate > b.date ? `${fmtShort(b.date)} – ${fmtShort(b.endDate)}` : fmtShort(b.date));
// Confirmed shows still to come: the dates a press kit lists (holds and offers are not public yet).
export const pressShows = actId => upcoming().filter(b => b.actId === actId && b.kind === 'show' && ['confirmed', 'advanced'].includes(b.status)).slice(0, 12);
// Who to call about the act: its own email and phone, else the person using Gigdex.
function contactRows(a) {
  if (a.email || a.phone) return [a.email && kv('Email', h('a', { href: 'mailto:' + a.email }, a.email)), a.phone && kv('Phone', h('a', { href: telUrl(a.phone) }, a.phone))].filter(Boolean);
  const p = db.profile || {};
  if (!(p.phone || p.email)) return [];
  return [kv('Advance with', [p.name, p.business].filter(Boolean).join(', ') || 'Us'), p.email && kv('Email', h('a', { href: 'mailto:' + p.email }, p.email)), p.phone && kv('Phone', h('a', { href: telUrl(p.phone) }, p.phone))].filter(Boolean);
}
const head = (kicker, a) => h('div', { class: 'cs-head' },
  h('div', null, h('div', { class: 'cs-kicker' }, kicker), h('div', { class: 'cs-brand' }, a.name || 'Untitled act')),
  h('div', { class: 'cs-when' }, 'Updated', h('b', null, fmtLong(updatedISO(a)))));

// Extra rules for the documents, on top of js/doc-css.js. p is '#print-root ' when printing, '' in a saved page.
export const DOC_CSS = p => [
  `${p}.ac-doc-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start}`,
  `${p}.ac-doc-top h2{font-size:26px}`,
  `${p}.ac-doc-qr{display:grid;justify-items:center;gap:4px;font-size:10px;color:#555;text-align:center;max-width:150px}`,
  `${p}.ac-doc-qr-svg{width:120px;height:120px}`, `${p}.ac-doc-qr-svg svg{width:100%;height:100%;display:block}`,
  `${p}.ac-plot-svg{width:100%;max-width:640px;height:auto;display:block;margin:4px auto}`,
  `${p}.ac-in-table{font-variant-numeric:tabular-nums}`, `${p}.ac-in-table td.ac-ch{font-weight:700;width:36px}`,
].join('');

/* ------------------------------- press kit ------------------------------- */
// The one-page press kit. qrMarkup is the QR's SVG (trusted: made by vendor/qrcode.js); without it the slot stays empty
// for the caller to fill (the preview on the page fills it when the code is ready).
export function epkDoc(a, qrMarkup = '') {
  const links = parseLinks(a.links), members = membersOf(a), shows = pressShows(a.id), t = qrTarget(a);
  return h('div', { class: 'cs-doc ac-doc ac-epk-doc' },
    head('PRESS KIT', a),
    h('div', { class: 'ac-doc-top' },
      h('div', { class: 'ac-doc-intro' }, h('h2', null, a.name || 'Untitled act'), a.genre && h('div', { class: 'cs-sub' }, a.genre), a.bio && h('p', { class: 'cs-pre' }, a.bio)),
      t && h('div', { class: 'ac-doc-qr' }, h('div', { class: 'ac-doc-qr-svg', 'data-qr': t.text, html: qrMarkup || null }), h('span', null, t.link ? 'Scan: ' + t.what : 'Scan to save our contact'))),
    links.length > 0 && sec('Listen & follow', ...links.map(l => kv(l.label, h('a', { href: l.url }, l.url)))),
    members.length > 0 && sec('Line-up', ...members.map(p => kv(p.name, roleOf(p) || '—'))),
    shows.length > 0 && sec('Upcoming shows', h('table', null, h('tbody', null, shows.map(b => { const [name, city] = venueName(b); return h('tr', null, h('td', null, showDate(b)), h('td', null, [name || 'Venue to be announced', city].filter(Boolean).join(', '))); })))),
    ...(() => { const rows = contactRows(a); return rows.length ? [sec('Contact', ...rows)] : []; })(),
    h('div', { class: 'cs-foot' }, `${a.name || 'Untitled act'} · press kit · made with Gigdex`));
}
async function epkWithQr(a) {
  const t = qrTarget(a);
  let svg = '';
  if (t) { try { svg = await qrFor(t.text); } catch { svg = ''; } }
  return epkDoc(a, svg);
}
export async function printEpk(actId) {
  const a = byId('acts', actId);
  if (!a) { toast('That act is no longer in Acts.'); return false; }
  printElement(await epkWithQr(a), DOC_CSS('#print-root '));
  return true;
}
export async function saveEpk(actId) {
  const a = byId('acts', actId);
  if (!a) { toast('That act is no longer in Acts.'); return false; }
  const ok = await saveFile(docPage(`Press kit – ${a.name || 'act'}`, await epkWithQr(a), DOC_CSS('')), fileFor('Press kit', a, 'html'), 'text/html');
  if (ok) toast('Press kit saved');
  return ok;
}

/* ------------------------------- input list ------------------------------- */
// The rows worth showing: blank rows left in the editor are not printed.
export const inputRows = a => (Array.isArray(a && a.inputList) ? a.inputList : []).filter(r => r && [r.source, r.mic, r.stand, r.note].some(v => String(v || '').trim()));
const chText = r => (r.ch === '' || r.ch == null || !Number.isFinite(Number(r.ch)) ? '—' : String(r.ch));
// Channel numbers used more than once ([3, 7]), so the person can renumber.
export const dupChannels = a => { const seen = new Map(); inputRows(a).forEach(r => { const c = chText(r); if (c !== '—') seen.set(c, (seen.get(c) || 0) + 1); }); return [...seen].filter(([, n]) => n > 1).map(([c]) => c); };
// The input list as a table. doc: the printed one (a Note column); on screen the note goes under the source.
export function inputTable(a, { doc = false } = {}) {
  const rows = inputRows(a);
  if (!rows.length) return null;
  const th = t => h('th', { scope: 'col' }, t);
  return h('table', { class: 'ac-in-table' + (doc ? '' : ' ac-in-screen') },
    h('thead', null, h('tr', null, th('Ch'), th('Source'), th('Mic / DI'), th('Stand'), doc && th('Note'))),
    h('tbody', null, rows.map(r => h('tr', null,
      h('td', { class: 'ac-ch' }, chText(r)),
      h('td', null, r.source || '—', !doc && r.note && h('div', { class: 'ac-in-note' }, r.note)),
      h('td', null, r.mic || ''), h('td', null, r.stand || ''),
      doc && h('td', null, r.note || '')))));
}
export async function saveInputCsv(actId) {
  const a = byId('acts', actId);
  if (!a) return false;
  const rows = inputRows(a);
  if (!rows.length) { toast('The input list is empty.'); return false; }
  const ok = await saveFile(csv([['Ch', 'Source', 'Mic / DI', 'Stand', 'Note'], ...rows.map(r => [chText(r) === '—' ? '' : chText(r), r.source || '', r.mic || '', r.stand || '', r.note || ''])]), fileFor('Input list', a, 'csv'), 'text/csv');
  if (ok) toast('Input list saved');
  return ok;
}

/* ------------------------------- stage plot ------------------------------- */
const num = (v, d) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v));
export const clamp01 = v => Math.min(0.97, Math.max(0.03, Math.round(num(v, 0.5) * 1000) / 1000));
export const plotOf = a => (Array.isArray(a && a.stagePlot) ? a.stagePlot : []).filter(p => p && p.id);
// The stage is 3:2 on screen and on paper, so a label sits in the same place on both.
const SVG_NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs, ...kids) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
  return el;
};
export function plotSvg(plot) {
  const X = 12, Y = 26, W = 576, H = 384, total = Y + H + 48;
  const label = p => {
    const raw = String(p.label || 'Label'), text = [...raw].length > 26 ? [...raw].slice(0, 25).join('') + '…' : raw;
    const w = Math.min(220, Math.max(44, 18 + [...text].length * 7.2)), hgt = 26;
    const cx = Math.min(600 - w / 2 - 2, Math.max(w / 2 + 2, X + clamp01(p.x) * W)), cy = Y + clamp01(p.y) * H;
    return sv('g', null,
      sv('rect', { x: (cx - w / 2).toFixed(1), y: (cy - hgt / 2).toFixed(1), width: w.toFixed(1), height: hgt, rx: 6, fill: '#ffffff', stroke: '#111111', 'stroke-width': 1.5 }),
      sv('text', { x: cx.toFixed(1), y: (cy + 4).toFixed(1), 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#111111' }, text));
  };
  return sv('svg', { class: 'ac-plot-svg', viewBox: `0 0 600 ${total}`, width: 600, height: total, role: 'img', 'aria-label': 'Stage plot', 'font-family': 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' },
    sv('title', null, 'Stage plot'),
    sv('text', { x: 300, y: Y - 9, 'text-anchor': 'middle', 'font-size': 10, fill: '#666666', 'letter-spacing': 2 }, 'BACK OF STAGE'),
    sv('rect', { x: X, y: Y, width: W, height: H, rx: 8, fill: '#fafafa', stroke: '#111111', 'stroke-width': 2 }),
    sv('text', { x: X + 8, y: Y + H - 8, 'font-size': 10, fill: '#666666' }, 'Stage right'),
    sv('text', { x: X + W - 8, y: Y + H - 8, 'font-size': 10, fill: '#666666', 'text-anchor': 'end' }, 'Stage left'),
    plot.map(label),
    sv('line', { x1: X, x2: X + W, y1: Y + H + 14, y2: Y + H + 14, stroke: '#999999', 'stroke-dasharray': '6 5' }),
    sv('text', { x: 300, y: Y + H + 38, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#111111', 'letter-spacing': 6 }, 'AUDIENCE'));
}

/* ------------------------------- tech rider ------------------------------- */
export function riderDoc(a) {
  const rows = inputRows(a), plot = plotOf(a), members = membersOf(a), contact = contactRows(a);
  return h('div', { class: 'cs-doc ac-doc ac-rider-doc' },
    head('TECHNICAL RIDER', a),
    h('h2', null, a.name || 'Untitled act'),
    h('div', { class: 'cs-sub' }, [a.genre, rows.length > 0 && plural(rows.length, 'input'), members.length > 0 && plural(members.length, 'person on stage', 'people on stage')].filter(Boolean).join(' · ')),
    sec('Input list', rows.length ? inputTable(a, { doc: true }) : h('p', null, 'No input list given yet: please ask us.')),
    plot.length > 0 && sec('Stage plot', plotSvg(plot)),
    members.length > 0 && sec('Line-up', ...members.map(p => kv(p.name, roleOf(p) || '—'))),
    a.riderTech && sec('Technical rider', h('p', { class: 'cs-pre' }, a.riderTech)),
    a.riderHospitality && sec('Hospitality rider', h('p', { class: 'cs-pre' }, a.riderHospitality)),
    contact.length > 0 && sec('Contact', ...contact),
    h('div', { class: 'cs-foot' }, `${a.name || 'Untitled act'} · technical rider · made with Gigdex`));
}
// Prints the act's tech rider: input list, stage plot, riders and contact. Returns false when the act is gone.
export function printRider(actId) {
  const a = byId('acts', actId);
  if (!a) { toast('That act is no longer in Acts.'); return false; }
  printElement(riderDoc(a), DOC_CSS('#print-root '));
  return true;
}
export async function saveRider(actId) {
  const a = byId('acts', actId);
  if (!a) { toast('That act is no longer in Acts.'); return false; }
  const ok = await saveFile(docPage(`Tech rider – ${a.name || 'act'}`, riderDoc(a), DOC_CSS('')), fileFor('Tech rider', a, 'html'), 'text/html');
  if (ok) toast('Tech rider saved');
  return ok;
}

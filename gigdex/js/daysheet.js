// The day sheet: everything the band and crew need on the day of a show, session or rehearsal, built from the booking:
// the times in the order the day runs, the venue and how to get in, the running order, who is playing, contacts, the
// setlist, backline, hospitality, accommodation, how many are on the guest list, and notes. Never anything about money.
// One data object (daySheetData) feeds the preview, the printout, the saved web page, the text for a band chat and the
// link the band opens (daysheet.html), so they always agree. The document itself is drawn by js/daysheet-doc.js.
//
// Sending it (sharing the link, emailing, printing, copying the text, saving the page) ticks "Day sheet sent to the
// band" on a show's checklist and remembers what was sent on the booking (booking.daySheet = { sentAt, sig }), so the
// booking can say when the sheet has changed since.
import { h, toast, sheet, fmtShort, empty, pad } from './util.js';
import { db, byId, patch, subscribe, redraw, usedQty } from './store.js';
import { bookingTitle, actName, venueOf, addMinutes, fmtMin, fmtDur, setlistLength, itemTitle, isChecked, markCheck } from './model.js';
import { printElement, docPage, saveFile, fileName } from './print.js';
import { pack } from './link-pack.js';
import { shareBase } from './version.js';
import { sheetTutorial } from './tour.js';
import { cleanDaySheet, toLink, nightOrder, renderDaySheet, daySheetTextFrom, dsDocCss, EMAIL, TIME_LABELS } from './daysheet-doc.js';

export { TIME_LABELS };
const GONE = 'That booking is not here any more.';
const str = v => (v == null ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const HHMM = /^(\d{1,2}):(\d{2})$/;
const hhmm = t => { const m = HHMM.exec(str(t)); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(m[1])}:${m[2]}` : ''; };
const num = v => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : 0);
const GROUP = { band: 'Band', session: 'Session player', crew: 'Crew', contact: 'Contact' };
const ids = v => (Array.isArray(v) ? v : []);

/* ------------------------------- what goes on it ------------------------------- */
// The two things a person may want to leave off. Remembered on this device; where it cannot store them (a private
// window), the choice still holds until the app is closed, so nothing that was taken off goes back on.
export const PARTS = [
  ['guestNames', 'Guest list names and +1s', false, 'The number on the list is always on it'],
  ['notes', 'Booking notes', true, 'Check they say nothing private first'],
];
const KEY = 'gigdex-daysheet';
let unsaved = null;
export const choices = () => { let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* defaults */ } if (unsaved) saved = unsaved; return Object.fromEntries(PARTS.map(([k, , on]) => [k, typeof saved[k] === 'boolean' ? saved[k] : on])); };
const remember = inc => { try { localStorage.setItem(KEY, JSON.stringify(inc)); unsaved = null; } catch { unsaved = { ...inc }; } };
export const sameChoices = (a, c) => PARTS.every(([k]) => !!(a && a[k]) === !!(c && c[k]));
const ALL = { guestNames: true, notes: true };

/* ------------------------------- the data ------------------------------- */
// The booking's times in the order the day runs, after-midnight ones last: [{ k, t, n }]. Shows: load-in, soundcheck,
// doors, on stage, off stage (on stage + set length), curfew. Sessions, rehearsals and the rest: start and finish.
export function dayTimes(b) {
  if (!b) return [];
  const set = hhmm(b.setTime), len = Math.round(num(b.setLength));
  const raw = b.kind === 'show'
    ? [['loadIn', b.loadIn], ['soundcheck', b.soundcheck], ['doors', b.doors], ['setTime', set], ['offStage', set && len > 0 ? addMinutes(set, len) : ''], ['curfew', b.curfew]]
    : [['start', b.start], ['end', b.end]];
  return nightOrder(raw.map(([k, t]) => ({ k, t: hhmm(t) })).filter(x => x.t));
}

// Everything on the sheet, as plain words: the only fields that ever leave the app (see js/daysheet-doc.js).
export function daySheetData(b, inc = choices()) {
  if (!b) return null;
  const kind = ['show', 'session', 'rehearsal'].includes(b.kind) ? b.kind : 'other';
  const p = db.profile || {};
  const venue = b.venueId ? byId('venues', b.venueId) : null, place = venueOf(b);
  // On the day a phone is what counts: a line-up email shows only for someone with no phone number.
  const person = x => ({ name: str(x.name), role: str(x.instrument) || str(x.role) || GROUP[x.group] || '', phone: str(x.phone), email: str(x.phone) ? '' : str(x.email) });

  // Promoter / client from the booking, then the venue's own contact, each once.
  const contacts = [];
  const addContact = c => {
    if (!c || !(c.name || c.phone || c.email)) return;
    const same = x => (c.name && x.name.toLowerCase() === c.name.toLowerCase()) || (c.phone && x.phone.replace(/\D/g, '') === c.phone.replace(/\D/g, '')) || (c.email && x.email.toLowerCase() === c.email.toLowerCase());
    if (!contacts.some(same)) contacts.push(c);
  };
  const bc = b.contact && typeof b.contact === 'object' ? b.contact : {};
  addContact({ name: str(bc.name), role: str(bc.role) || (kind === 'show' ? 'Promoter' : 'Contact'), phone: str(bc.phone), email: str(bc.email) });
  if (venue && (str(venue.phone) || str(venue.email))) addContact({ name: str(venue.contact) || str(venue.name), role: { show: 'Venue', session: 'Studio', rehearsal: 'Rooms' }[kind] || 'Venue', phone: str(venue.phone), email: str(venue.email) });

  // The setlist with each song's key, tempo and length (a song deleted since keeps the title the setlist kept).
  const sl = b.setlistId ? byId('setlists', b.setlistId) : null;
  let setlist = null;
  if (sl) {
    const L = setlistLength(sl);
    setlist = {
      name: str(sl.name),
      rows: (Array.isArray(sl.items) ? sl.items : []).filter(it => it && typeof it === 'object').map(it => {
        if (it.isBreak) return { brk: true, t: str(it.title) || 'Break' };
        const song = it.songId ? byId('songs', it.songId) : null, sec = num(it.duration) || num(song && song.duration);
        return { t: itemTitle(it), key: str(song && song.key), len: sec > 0 ? fmtDur(sec) : '', segue: !!it.segue, encore: !!it.encore, note: str(it.note) };
      }),
      total: L.sec ? fmtDur(L.sec) : '', songs: L.songs, missing: L.missing,
    };
  }

  // Backline: the booking's gear and the items of any stage pack on it, with how many and whose it is. No values.
  const qty = new Map();
  ids(b.gear).forEach(id => qty.set(id, usedQty(b, id)));
  ids(b.kits).map(id => byId('kits', id)).filter(Boolean).forEach(k => ids(k.items).forEach(id => { if (!qty.has(id)) qty.set(id, Math.max(1, Math.floor(num(k.qty && k.qty[id])) || 1)); }));
  const gear = [...qty].map(([id, n]) => { const g = byId('gear', id); if (!g) return null; const owner = g.owner ? byId('people', g.owner) : null; return { name: str(g.name) || [str(g.make), str(g.model)].filter(Boolean).join(' ') || 'Item', qty: n, who: owner ? str(owner.name) : '' }; }).filter(Boolean);

  const gl = Array.isArray(b.guestList) ? b.guestList.filter(g => g && typeof g === 'object' && (str(g.name) || num(g.plus) > 0)) : [];
  const plus = g => Math.max(0, Math.floor(num(g.plus)));
  const count = gl.reduce((t, g) => t + 1 + plus(g), 0), cap = Math.max(0, Math.floor(num(b.guestCap)));

  return cleanDaySheet({
    v: 1, kind, ref: str(b.id), made: Date.now(),
    title: bookingTitle(b), act: (a => (a && !bookingTitle(b).includes(a) ? a : ''))(actName(b.actId) || str(b.client)),
    from: { name: str(p.name), business: str(p.business), phone: str(p.phone), email: str(p.email) },
    date: str(b.date), endDate: str(b.endDate), slot: kind === 'show' && num(b.setLength) > 0 ? fmtMin(b.setLength) : '',
    times: dayTimes(b),
    place: { name: str(place.name), address: str(place.address), geo: place.geo || null, loadIn: str(venue && venue.loadIn), parking: str(b.parking) || str(venue && venue.parking),
      stage: str(venue && venue.stage), pa: str(venue && venue.pa), noise: venue && num(venue.noiseLimit) > 0 ? `${Math.round(num(venue.noiseLimit))} dB` : '' },
    running: nightOrder((Array.isArray(b.runningOrder) ? b.runningOrder : []).filter(r => r && typeof r === 'object').map(r => ({ time: hhmm(r.time), act: str(r.act), len: num(r.length) > 0 ? fmtMin(r.length) : '', ours: !!r.ours })), 'time'),
    people: ids(b.people).map(id => byId('people', id)).filter(Boolean).map(person),
    contacts, setlist,
    songs: ids(b.songIds).map(id => byId('songs', id)).filter(Boolean).map(s => ({ t: str(s.title) || 'Untitled', key: str(s.key), bpm: num(s.bpm) > 0 ? String(Math.round(num(s.bpm))) : '', len: num(s.duration) > 0 ? fmtDur(s.duration) : '' })),
    due: (Array.isArray(b.deliverables) ? b.deliverables : []).filter(x => x && str(x.t)).map(x => ({ t: str(x.t), due: str(x.due), done: !!x.done })),
    gear, provided: str(b.backlineProvided) || str(venue && venue.backline),
    hospitality: str(b.hospitality), accommodation: str(b.accommodation),
    guests: count || cap ? { count, cap, names: inc.guestNames ? gl.filter(g => str(g.name)).map(g => ({ name: str(g.name), plus: plus(g) })) : [] } : null,
    notes: inc.notes ? str(b.notes) : '',
  });
}

// What the sheet still lacks, in words ("times", "the venue"…), for a gentle hint.
export function missingBits(b, d = daySheetData(b)) {
  if (!d) return [];
  const out = [];
  if (!d.date) out.push('a date');
  if (!d.times.length) out.push('times');
  if (!d.place.name && !d.place.address) out.push({ session: 'the studio', rehearsal: 'the room' }[d.kind] || 'the venue');
  if (!d.people.length) out.push(d.kind === 'show' || d.kind === 'rehearsal' ? 'the line-up' : 'who is coming');
  if (d.kind === 'show' && !d.setlist) out.push('a setlist');
  return out;
}
export const listWords = xs => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

export const daySheetText = (b, inc = choices()) => (b ? daySheetTextFrom(daySheetData(b, inc)) : '');
// The link the band opens: the sheet packed into the address after the #, which never reaches any server.
export async function daySheetLink(b, inc = choices()) {
  const base = shareBase() || new URL('./', location.href).href;
  return base + 'daysheet.html#' + await pack(toLink(daySheetData(b, inc)));
}
export const daySheetHtml = (b, inc = choices()) => docPage(`Day sheet – ${bookingTitle(b)}`, renderDaySheet(daySheetData(b, inc)), dsDocCss(''));

/* ------------------------------- sent or not ------------------------------- */
// A fingerprint of what the sheet says (with everything included), so "changed since it was sent" means the sheet
// itself changed, not the deal or the settlement.
const hash = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); } return (x >>> 0).toString(36); };
const sigOfData = d => hash(JSON.stringify({ ...d, made: 0 }));
export const sigOf = b => sigOfData(daySheetData(b, ALL));
const record = b => (b && b.daySheet && typeof b.daySheet === 'object' ? b.daySheet : {});
export const sentAt = b => num(record(b).sentAt);
// 'none' | 'sent' | 'changed'. A show counts as sent when its checklist line is ticked (also by hand).
export function sentState(b) {
  if (!b) return 'none';
  const sent = b.kind === 'show' ? isChecked(b, 'show-daysheet') : !!sentAt(b);
  if (!sent) return 'none';
  const sig = record(b).sig;
  return sig && sig !== sigOf(b) ? 'changed' : 'sent';
}
export function markSent(bookingId) {
  const b = byId('bookings', bookingId);
  if (!b) return;
  if (b.kind === 'show') markCheck(bookingId, 'show-daysheet', true);
  patch('bookings', bookingId, { daySheet: { sentAt: Date.now(), sig: sigOf(byId('bookings', bookingId)) } });
}
const when = t => new Date(t).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function stateText(b, st = sentState(b)) {
  const at = sentAt(b);
  if (st === 'sent') return `✓ Sent to the band${at ? ' ' + when(at) : ''}.`;
  if (st === 'changed') return `⚠ Changed since it was sent${at ? ' ' + when(at) : ''}: send it again so everyone has the latest.`;
  return b && b.kind === 'show' ? 'Not sent to the band yet.' : 'Not sent yet.';
}

/* ------------------------------- sending ------------------------------- */
const copy = async text => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };

// Share the link: the phone's share sheet where there is one, else the link is copied.
export async function shareDaySheet(bookingId, inc = choices(), url = '') {
  const b = byId('bookings', bookingId);
  if (!b) { toast(GONE); return false; }
  try { url = url || await daySheetLink(b, inc); } catch (e) { toast('Could not make the link: ' + (e.message || e)); return false; }
  const title = `Day sheet – ${bookingTitle(b)}`;
  if (typeof navigator.share === 'function') {
    try { await navigator.share({ title, text: `${title}${b.date ? ' – ' + fmtShort(b.date) : ''}`, url }); markSent(bookingId); toast('Shared. If anything changes, send it again.'); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  if (await copy(url)) { markSent(bookingId); toast('Link copied: paste it into the band chat.'); return true; }
  toast('The link could not be copied here. Open the day sheet and copy it from “QR code & link”.');
  return false;
}

// Email the band: everyone on the booking with an address. Mail apps stop at about 2,000 characters of link, so the
// text comes off first, then the link itself is copied for pasting. { href, to, mode: 'full'|'link'|'paste' }
export function emailFor(b, url, inc = choices()) {
  const to = [...new Set(ids(b.people).map(id => byId('people', id)).filter(Boolean).map(x => str(x.email)).filter(e => EMAIL.test(e)))];
  const title = bookingTitle(b), day = b.date ? fmtShort(b.date) : '';
  const subject = `Day sheet – ${title}${day ? ' – ' + day : ''}`;
  const p = db.profile || {}, sign = [str(p.name), str(p.business)].filter(Boolean).join(' · ');
  // Short, plain words: in a mail link every space costs three characters and a curly quote nine.
  const intro = "Hi all,\n\nHere's the day sheet:\n\n";
  const outro = `\n\nIf anything changes I'll send a new one.${sign ? '\n\n' + sign : ''}`;
  const mk = body => `mailto:${to.join(',')}?` + new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20');
  let mode = 'full', href = mk(intro + url + '\n\n' + daySheetText(b, inc) + outro);
  if (href.length > 1800) { mode = 'link'; href = mk(intro + url + outro); }
  if (href.length > 1800) { mode = 'paste'; href = mk(intro + '[Paste the link here: Gigdex copied it when you tapped Email]' + outro); }
  return { href, to, mode };
}
export const emailCount = b => new Set(ids(b && b.people).map(id => byId('people', id)).filter(Boolean).map(x => str(x.email)).filter(e => EMAIL.test(e))).size;
// The Email button: an ordinary mail link, filled in once the link is made. Tapping it marks the sheet as sent.
export function emailButton(bookingId, getUrl, inc, text, aria) {
  const a = h('a', { class: 'btn ghost', href: '#', 'aria-label': aria, 'aria-disabled': 'true', onclick: e => {
    const url = getUrl();
    if (!url || a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); toast('One moment: the link is still being made.'); return; }
    if (a.dataset.mode === 'paste') copy(url).then(okd => toast(okd ? 'The link is long, so it was copied: paste it into the email.' : 'Copy the link from “QR code & link” and paste it into the email.'));
    markSent(bookingId);
  } }, text);
  // fill(url, choices): the choices the link was made with, when they are not the ones the button was made with.
  a.fill = (url, use = inc) => { const b = byId('bookings', bookingId); if (!b || !url) return; const m = emailFor(b, url, use); a.href = m.href; a.dataset.mode = m.mode; a.removeAttribute('aria-disabled'); a.title = m.to.length ? `To ${m.to.length} ${m.to.length === 1 ? 'person' : 'people'} on the booking` : 'Nobody on the booking has an email address yet'; };
  return a;
}

export function printDaySheet(bookingId, inc = choices()) {
  const b = byId('bookings', bookingId);
  if (!b) { toast(GONE); return; }
  printElement(renderDaySheet(daySheetData(b, inc)), dsDocCss('#print-root '));
  markSent(bookingId);
}
export async function saveDaySheetPage(bookingId, inc = choices()) {
  const b = byId('bookings', bookingId);
  if (!b) { toast(GONE); return false; }
  const ok = await saveFile(daySheetHtml(b, inc), fileName(`Day sheet - ${bookingTitle(b)}${b.date ? ' ' + b.date : ''}`, 'html'), 'text/html');
  if (ok) { markSent(bookingId); toast('Day sheet saved as a web page.'); }
  return ok;
}
export async function copyDaySheetText(bookingId, inc = choices(), url = '') {
  const b = byId('bookings', bookingId);
  if (!b) { toast(GONE); return false; }
  const text = daySheetText(b, inc) + (url ? `\n\nThe full day sheet: ${url}` : '');
  if (await copy(text)) { markSent(bookingId); toast('Copied: paste it into the band chat or a text.'); return true; }
  toast('The text could not be copied here. Use Share link or Print instead.');
  return false;
}

/* ------------------------------- the sheet ------------------------------- */
let openOne = null;
// The day sheet in a sheet: where it stands, the ways to send it, what goes on it, and the preview.
// { parts: true } opens it at "What goes on it".
export function openDaySheet(bookingId, opts) {
  if (!byId('bookings', bookingId)) { toast(GONE); return null; }
  const atParts = !!(opts && opts.parts);
  if (openOne) openOne.close();
  const inc = choices();
  const get = () => byId('bookings', bookingId);
  let url = '', seq = 0, linkP = Promise.resolve(''), lastSig = '';

  const status = h('p', { class: 'ds-status', role: 'status', 'aria-live': 'polite' });
  const hints = h('p', { class: 'ds-hints small muted' });
  const paper = h('div', { class: 'cs-paper ds-preview', role: 'region', 'aria-label': 'Day sheet preview', tabindex: '0' });
  const ready = async () => { if (url) return url; try { return await linkP; } catch (e) { toast('Could not make the link: ' + (e.message || e)); return ''; } };

  const email = emailButton(bookingId, () => url, inc, '✉ Email the band', 'Email the day sheet to the band');
  const buttons = [
    h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Share the day sheet link', onclick: async () => shareDaySheet(bookingId, inc, await ready()) }, '📤 Share link'),
    email,
    h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Print the day sheet', onclick: () => printDaySheet(bookingId, inc) }, '🖨 Print'),
    h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Copy the day sheet as text', onclick: async () => copyDaySheetText(bookingId, inc, await ready()) }, '📋 Copy text'),
    h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Save the day sheet as a web page', onclick: () => saveDaySheetPage(bookingId, inc) }, '💾 Save web page'),
  ];
  const actions = h('div', { class: 'ds-actions' }, buttons);

  // The link itself, its QR code (the band can scan it off your phone), and the band's page to check.
  const linkArea = h('textarea', { class: 'share-link', readonly: true, rows: 3, 'aria-label': 'Link to the day sheet' });
  const qrBox = h('div', { class: 'qr ds-qr', role: 'img', 'aria-label': 'QR code of the day sheet link' }, 'Making the code…');
  const openLink = h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', 'aria-label': 'Open the band’s page' }, '↗ Open the band’s page');
  const copyLink = h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Copy the link', onclick: async () => { const u = await ready(); if (!u) return; if (await copy(u)) { markSent(bookingId); toast('Link copied.'); } else { linkArea.focus(); linkArea.select(); toast('Select the link and copy it.'); } } }, '📋 Copy link');
  const linkPanel = h('details', { class: 'twirl ds-link' },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '▦'), h('span', null, h('span', { class: 'twirl-name' }, 'QR code & link'), h('span', { class: 'twirl-sub' }, 'Let the band scan it off your phone'))),
    h('div', { class: 'twirl-body' }, qrBox, linkArea, h('div', { class: 'actions' }, copyLink, openLink)));
  const drawQr = () => {
    if (!linkPanel.open) return;
    if (!url) { qrBox.replaceChildren('Making the code…'); return; }
    if (url.length > 2800) { qrBox.replaceChildren(h('p', { class: 'small' }, 'This link is too long for a QR code. Leave off the guest names or notes below, or send the link instead.')); return; }
    const n = seq;
    import('./qr.js').then(m => m.qrSvg(url, { cellSize: 3 })).then(svg => { if (n === seq) qrBox.replaceChildren(h('div', { class: 'ds-qr-svg', html: svg })); })
      .catch(() => { if (n === seq) qrBox.replaceChildren('The QR code could not be made here. Send the link instead.'); });
  };
  linkPanel.addEventListener('toggle', drawQr);

  // While a new link is being made, nothing offers the old one (it may still show what was just taken off).
  const make = () => {
    const n = ++seq; url = '';
    linkArea.value = ''; openLink.removeAttribute('href'); email.setAttribute('aria-disabled', 'true'); email.href = '#';
    const b = get();
    linkP = b ? daySheetLink(b, inc) : Promise.resolve('');
    linkP.then(u => { if (n !== seq || !u) return; url = u; linkArea.value = u; openLink.href = u; email.fill(u); drawQr(); }).catch(e => { if (n === seq) toast('Could not make the link: ' + (e.message || e)); });
  };

  const partsSub = h('span', { class: 'twirl-sub' });
  const drawPartsSub = () => { partsSub.textContent = `Guest names ${inc.guestNames ? 'on' : 'off'} · notes ${inc.notes ? 'on' : 'off'}`; };
  const parts = h('details', { class: 'twirl ds-parts' },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '☑'), h('span', null, h('span', { class: 'twirl-name' }, 'What goes on it'), partsSub)),
    h('div', { class: 'twirl-body' },
      PARTS.map(([k, label, , hint]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: inc[k], 'aria-label': label, onchange: e => { inc[k] = e.target.checked; remember(inc); drawPartsSub(); refresh(true); redraw(); } }), h('span', null, label, h('em', null, ' · ' + hint)))),
      h('p', { class: 'small muted' }, 'Always on it: the times, where and how to get in, the running order, who is playing and how to reach them, the setlist, backline, hospitality and how many are on the guest list.'),
      h('p', { class: 'small muted' }, 'Never on it: the deal, fees, ticket price, settlement, budget, rates or invoices.')));
  drawPartsSub();

  const refresh = force => {
    const b = get();
    if (!b) {
      paper.replaceChildren(empty('This booking was deleted, so there is no day sheet to show.'));
      status.textContent = ''; hints.textContent = ''; buttons.forEach(x => { if (x.tagName === 'BUTTON') x.disabled = true; }); email.setAttribute('aria-disabled', 'true'); email.href = '#';
      seq++; url = ''; linkArea.value = ''; openLink.removeAttribute('href');
      return;
    }
    const d = daySheetData(b, inc), sig = sigOfData(d);
    if (force || sig !== lastSig) { lastSig = sig; paper.replaceChildren(renderDaySheet(d)); make(); }
    const st = sentState(b);
    status.className = 'ds-status ' + st; status.textContent = stateText(b, st);
    const miss = missingBits(b, d);
    hints.textContent = miss.length ? `Not on it yet: ${listWords(miss)}. Add ${miss.length === 1 ? 'it' : 'them'} on the booking and the sheet fills in.` : '';
    hints.hidden = !miss.length;
    const n = emailCount(b);
    email.lastChild.textContent = n ? `✉ Email the band (${n})` : '✉ Email the band';
    email.setAttribute('aria-label', n ? `Email the day sheet to the band: ${n} ${n === 1 ? 'address' : 'addresses'}` : 'Email the day sheet to the band');
  };

  const off = subscribe(() => queueMicrotask(() => refresh(false)));
  const body = h('div', { class: 'stack ds-sheet' },
    status, hints, actions,
    h('p', { class: 'small muted ds-explain' }, 'The link opens a read-only page with the sheet below, nothing else. It’s a snapshot: if anything changes, send it again.'),
    linkPanel, parts, paper);
  refresh(true);
  const s = sheet('Day sheet', body, { onClose: () => { off(); seq++; if (openOne === s) openOne = null; } });
  openOne = s;
  if (atParts) { parts.open = true; const sum = parts.querySelector('summary'); sum.focus({ preventScroll: true }); requestAnimationFrame(() => parts.scrollIntoView({ block: 'start' })); }
  return s;
}

/* ------------------------------- walkthrough ------------------------------- */
sheetTutorial('Day sheet', [
  { title: 'The day sheet', text: 'Everything the band and crew need on the day, built from the booking. It never shows the deal, fees, ticket price, settlement or budget.', target: ['.ds-preview'] },
  { title: 'Sent or not', text: 'Whether the band has it. Once sent, it says so here and on the booking, and warns you if the sheet changes afterwards.', target: ['.ds-status'] },
  { title: 'Send it', text: 'Share the link to the band chat, email everyone on the booking, print it, copy it as text, or save it as a web page. Any of these ticks “Day sheet sent” on a show’s checklist.', target: ['.ds-actions'] },
  { title: 'QR code & link', text: 'At the venue, let the band scan the code off your phone. Open the band’s page to see exactly what they see, with Add to calendar.', target: ['.ds-link > summary'] },
  { title: 'What goes on it', text: 'Choose whether the guest names and your booking notes go on. Gigdex remembers your choice on this device.', target: ['.ds-parts > summary'] },
]);

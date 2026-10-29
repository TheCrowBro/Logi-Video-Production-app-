// Call sheets: one per shoot, built from the booking, venue, crew (with their call times), kit, hires and the sun for
// the day, plus what a crew expects on a real call sheet: general call, a schedule, wrap, who is on set, weather,
// emergency contact and special instructions. Printable (PDF), shareable, saved as a web page, or emailed to the
// whole crew in one go. "Call sheets" on the Bookings page lists every shoot and whether its sheet has gone out.
import { h, sheet, toast, nodes, fmtLong, fmtShort, fmtTime, parseISO, todayISO, mapsUrl } from './util.js';
import { db, byId, endOf, upsert, subscribe, activeBookings } from './store.js';
import { getTimes } from './suncalc.js';
import { setCheck, itemId, crewRow } from './workflow.js';
import { openForm } from './form.js';
import { saveOrShare } from './backup.js';

const BLANK = { generalCall: '', lunch: '', wrap: '', schedule: [], attendees: '', weather: '', dress: '', emergency: '', notes: '', version: 0, editedAt: 0, sentAt: 0 };
export const sheetOf = b => ({ ...BLANK, ...(b.callSheet || {}) });
const hasContent = cs => !!(cs.generalCall || cs.lunch || cs.wrap || (cs.schedule || []).length || cs.attendees || cs.weather || cs.dress || cs.emergency || cs.notes);
export const sheetState = b => { const cs = sheetOf(b); return cs.sentAt ? (cs.editedAt > cs.sentAt ? 'changed' : 'sent') : hasContent(cs) ? 'draft' : 'none'; };
const STATE_LABEL = { none: 'Not started', draft: 'Draft', sent: 'Sent', changed: 'Changed since it was sent' };
const dateLabel = (b, f = fmtLong) => (endOf(b) > b.date ? `${f(b.date)} → ${f(endOf(b))}` : f(b.date));
const multiDay = b => endOf(b) > b.date;

/* ----------------------------------- data ----------------------------------- */
export function callSheetData(b) {
  const p = db.profile, v = b.venueId ? byId('venues', b.venueId) : null, cs = sheetOf(b);
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean).map(c => ({ ...c, call: (b.crewCall || {})[c.id] || cs.generalCall || b.start || '' }));
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const kit = {}; gear.forEach(g => { const c = g.category || 'Other'; kit[c] = (kit[c] || 0) + Math.max(1, Number((b.gearQty || {})[g.id]) || 1); });
  let loc = null; try { loc = v && v.geo && Number.isFinite(Number(v.geo.lat)) ? { lat: +v.geo.lat, lon: +v.geo.lon } : JSON.parse(localStorage.getItem('logi-loc')); } catch { /* none */ }
  const sun = loc ? getTimes(new Date(parseISO(b.date).getTime() + 12 * 36e5), loc.lat, loc.lon) : null;
  const address = (b.address || (v && v.address) || '').replace(/\n/g, ', ');
  const schedule = [...(cs.schedule || [])].filter(r => r && (r.time || r.item)).sort((x, y) => `${x.date || b.date} ${x.time || ''}`.localeCompare(`${y.date || b.date} ${y.time || ''}`));
  const days = multiDay(b) ? [...new Set([b.date, ...schedule.map(r => r.date).filter(Boolean)])].sort() : [b.date];
  const producer = [p.name, p.business].filter(Boolean).join(' · ') || 'Vdex';
  return { b, p, v, cs, crew, kit, hires: b.hires || [], sun, address, schedule, days, producer, generalCall: cs.generalCall || b.start || '', wrap: cs.wrap || b.end || '' };
}

/* ----------------------------------- text ----------------------------------- */
const line = (k, v) => (v ? `${k}: ${v}` : null);
export function callSheetText(b) {
  const d = callSheetData(b), { cs, v, p } = d;
  const sched = d.schedule.map(r => `${multiDay(b) && r.date ? fmtShort(r.date) + ' ' : ''}${r.time || '—'}  ${r.item || ''}`.trim());
  const out = [
    `CALL SHEET — ${b.title}${b.client ? ' (' + b.client + ')' : ''}`,
    dateLabel(b) + (cs.version ? `  ·  v${cs.version}` : ''),
    line('General call', d.generalCall), line('Lunch', cs.lunch), line('Wrap (planned)', d.wrap),
    '',
    'LOCATION',
    v && line('Venue', v.name), line('Address', d.address), v && line('Access', v.access), v && line('Parking', v.parking), v && line('Power', v.power), v && line('Nearest hospital', v.hospital),
    v && (v.rules || '').trim() && 'Venue rules: ' + v.rules.replace(/\n/g, '; '),
    (b.breakMinutes || b.breakNote) && line('Breaks', [b.breakMinutes && b.breakMinutes + ' min approved', b.breakNote].filter(Boolean).join(' · ')),
    '',
    sched.length && 'SCHEDULE', ...sched, sched.length && '',
    d.sun && 'SUN', d.sun && `Sunrise ${fmtTime(d.sun.sunrise)} · Golden hour ends ${fmtTime(d.sun.goldenHourEnd)} · Golden hour from ${fmtTime(d.sun.goldenHour)} · Sunset ${fmtTime(d.sun.sunset)}`,
    cs.weather && line('Weather', cs.weather), (d.sun || cs.weather) && '',
    'CREW',
    ...(d.crew.length ? d.crew.map(c => `${c.name} — ${c.role || 'crew'}${c.call ? ' · call ' + c.call : ''}${c.phone ? ' · ' + c.phone : ''}${c.email ? ' · ' + c.email : ''}`) : ['(no crew assigned)']),
    '',
    ((b.stakeholders || []).length || cs.attendees) && 'ON SET / CONTACTS',
    ...((b.stakeholders || []).map(s => [s.name, s.role, s.phone].filter(Boolean).join(' · '))),
    cs.attendees, ((b.stakeholders || []).length || cs.attendees) && '',
    Object.keys(d.kit).length && 'KIT', Object.keys(d.kit).length && Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · '),
    d.hires.length && 'Hires: ' + d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '),
    Object.keys(d.kit).length && '',
    cs.dress && line('Dress code / bring', cs.dress), cs.emergency && line('Emergency contact', cs.emergency), (cs.dress || cs.emergency) && '',
    (cs.notes || b.notes) && 'NOTES', cs.notes, b.notes && b.notes !== cs.notes ? b.notes : null, (cs.notes || b.notes) && '',
    `Produced by ${d.producer}${p.phone ? ' · ' + p.phone : ''}${p.email ? ' · ' + p.email : ''}`,
  ].filter(x => x !== null && x !== false && x !== undefined && x !== 0);
  return out.join('\n');
}

/* --------------------------------- document --------------------------------- */
// The same DOM serves the in-app preview, the print window and the saved web page.
export function renderDoc(b) {
  const d = callSheetData(b), { cs, v, p } = d;
  const sec = (title, ...kids) => { const body = nodes(...kids); return body.length ? h('section', { class: 'cs-sec' }, h('h4', null, title), ...body) : null; };
  const kv = (k, val) => val && h('div', { class: 'cs-kv' }, h('span', null, k), h('b', null, val));
  const time = (label, val) => val && h('div', { class: 'cs-time' }, h('span', null, label), h('b', null, val));
  const table = (head, rows) => rows.length && h('table', null, h('thead', null, h('tr', null, ...head.map(x => h('th', null, x)))), h('tbody', null, ...rows.map(r => h('tr', null, ...r.map(x => h('td', null, x || ''))))));
  const scheduleRows = day => d.schedule.filter(r => (r.date || b.date) === day).map(r => [r.time || '—', r.item || '']);
  return h('article', { class: 'cs-doc' },
    h('header', { class: 'cs-head' },
      h('div', null, h('div', { class: 'cs-brand' }, d.producer), h('div', { class: 'cs-kicker' }, 'CALL SHEET')),
      h('div', { class: 'cs-when' }, h('b', null, dateLabel(b, fmtShort)), h('div', null, cs.version ? `Version ${cs.version}` : 'Draft'))),
    h('h2', null, b.title), b.client && h('div', { class: 'cs-sub' }, b.client),
    h('div', { class: 'cs-times' }, time('General call', d.generalCall), time('Lunch', cs.lunch), time('Wrap', d.wrap), d.sun && time('Sunrise', fmtTime(d.sun.sunrise)), d.sun && time('Sunset', fmtTime(d.sun.sunset))),
    sec('Location', v && kv('Venue', v.name), kv('Address', d.address), v && kv('Access', v.access), v && kv('Parking', v.parking), v && kv('Power', v.power), v && kv('Nearest hospital', v.hospital),
      v && (v.rules || '').trim() && kv('Venue rules', v.rules.replace(/\n/g, '; ')), d.address && h('div', { class: 'cs-kv' }, h('span', null, 'Map'), h('a', { href: mapsUrl(d.address), target: '_blank', rel: 'noopener noreferrer' }, mapsUrl(d.address)))),
    d.schedule.length ? sec('Schedule', ...d.days.map(day => { const rows = scheduleRows(day); return rows.length && [multiDay(b) && h('div', { class: 'cs-day' }, fmtLong(day)), table(['Time', 'What'], rows)]; })) : null,
    sec('Crew', d.crew.length ? table(['Name', 'Role', 'Call', 'Phone', 'Email'], d.crew.map(c => [c.name, c.role || 'crew', c.call, c.phone, c.email])) : h('p', null, 'No crew assigned yet.')),
    sec('On set / contacts', (b.stakeholders || []).length && table(['Name', 'Role', 'Phone'], b.stakeholders.map(s => [s.name, s.role, s.phone])), cs.attendees && h('p', { class: 'cs-pre' }, cs.attendees),
      kv('Producer', [d.producer, p.phone, p.email].filter(Boolean).join(' · ')), kv('Emergency contact', cs.emergency)),
    sec('Kit', Object.keys(d.kit).length && h('p', null, Object.entries(d.kit).map(([c, n]) => `${c}: ${n}`).join(' · ')), d.hires.length && kv('Hires', d.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '))),
    sec('Day notes', d.sun && kv('Golden hour', `ends ${fmtTime(d.sun.goldenHourEnd)}, from ${fmtTime(d.sun.goldenHour)}`), kv('Weather', cs.weather), kv('Dress code / bring', cs.dress),
      (b.breakMinutes || b.breakNote) && kv('Breaks', [b.breakMinutes && b.breakMinutes + ' min approved', b.breakNote].filter(Boolean).join(' · ')),
      cs.notes && h('p', { class: 'cs-pre' }, cs.notes), b.notes && b.notes !== cs.notes && h('p', { class: 'cs-pre' }, b.notes)),
    h('footer', { class: 'cs-foot' }, `Produced by ${d.producer}${p.phone ? ' · ' + p.phone : ''}${p.email ? ' · ' + p.email : ''} · Made with Vdex on ${new Date().toLocaleDateString()}`));
}

const DOC_CSS = `body{margin:0;background:#fff;color:#111;font:13px/1.45 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
.cs-doc{max-width:760px;margin:0 auto;padding:28px 24px}.cs-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #111;padding-bottom:8px}
.cs-brand{font-weight:700;letter-spacing:.04em}.cs-kicker{font-size:11px;letter-spacing:.2em;color:#555}.cs-when{text-align:right;font-size:12px;color:#444}.cs-when b{display:block;font-size:14px;color:#111}
.cs-doc h2{margin:14px 0 2px;font-size:22px}.cs-sub{color:#444;margin-bottom:8px}.cs-times{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:12px 0}
.cs-time{border:1px solid #ddd;border-radius:8px;padding:8px 10px}.cs-time span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#666}.cs-time b{font-size:18px}
.cs-sec{margin-top:16px;break-inside:avoid}.cs-sec h4{margin:0 0 6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#555;border-bottom:1px solid #ddd;padding-bottom:3px}
.cs-kv{display:grid;grid-template-columns:140px 1fr;gap:8px;padding:3px 0}.cs-kv span{color:#666}.cs-kv a{color:#1a4e8a;word-break:break-all}
table{width:100%;border-collapse:collapse;margin:4px 0 8px}th,td{text-align:left;vertical-align:top;padding:5px 6px;border-bottom:1px solid #e3e3e3;font-size:12.5px}th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#666}
.cs-day{font-weight:700;margin:8px 0 2px}.cs-pre{white-space:pre-wrap;margin:4px 0}.cs-foot{margin-top:22px;padding-top:8px;border-top:1px solid #ddd;font-size:11px;color:#666}
@page{margin:14mm}@media print{.cs-doc{padding:0}}`;
const slug = s => String(s || 'shoot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export const callSheetHtml = b => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Call sheet — ${b.title.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</title><style>${DOC_CSS}</style></head><body>${renderDoc(b).outerHTML}</body></html>`;

/* ---------------------------------- editing ---------------------------------- */
export function editCallSheet(b, onDone) {
  const cs = sheetOf(b);
  const cols = [...(multiDay(b) ? [{ key: 'date', label: 'Date', type: 'date' }] : []), { key: 'time', label: 'Time', type: 'time' }, { key: 'item', label: 'What happens' }];
  openForm({
    title: 'Call sheet details',
    values: cs,
    fields: [
      { key: 'generalCall', label: 'General call', type: 'time', hint: b.start ? `Blank means the booking start (${b.start}). Each person's own call time is set on their crew row.` : 'When everyone is expected on set.' },
      { key: 'lunch', label: 'Lunch', type: 'time' },
      { key: 'wrap', label: 'Wrap (planned)', type: 'time', hint: b.end ? `Blank means the booking finish (${b.end}).` : '' },
      { key: 'schedule', label: 'Schedule', type: 'rows', columns: cols, hint: 'Crew call, set-up, first shot, interviews, lunch, company moves, wrap… one line each.' },
      { key: 'attendees', label: 'On set from the client / talent', type: 'textarea', rows: 2, placeholder: 'Who is coming, when, and who is looking after them' },
      { key: 'weather', label: 'Weather', placeholder: 'e.g. 14°C, showers from 3pm — bring rain covers' },
      { key: 'dress', label: 'Dress code / what to bring', placeholder: 'e.g. All black, sturdy boots, hi-vis for the yard' },
      { key: 'emergency', label: 'Emergency contact on the day', placeholder: 'Name · phone' },
      { key: 'notes', label: 'Special instructions', type: 'textarea', rows: 3, placeholder: 'Parking passes, radio channels, quiet zones, release forms, catering…' },
    ],
    onSave: v => {
      const next = { ...cs, ...v, version: (cs.version || 0) + 1, editedAt: Date.now() };
      upsert('bookings', { ...byId('bookings', b.id), callSheet: next });
      toast(`Call sheet saved (v${next.version})`);
      onDone && onDone();
    },
  });
}

/* ----------------------------------- viewer ----------------------------------- */
export function openCallSheet(b) {
  const id = b.id;
  const body = h('div', { class: 'stack' });
  let close = () => {};
  const markSent = () => {
    const cur = byId('bookings', id); if (!cur) return;
    setCheck(cur, itemId('Prepped', 'Call sheet sent'), true);
    upsert('bookings', { ...byId('bookings', id), callSheet: { ...sheetOf(cur), sentAt: Date.now() } });
    toast('Marked: call sheet sent');
  };
  const text = () => callSheetText(byId('bookings', id));
  const share = async () => { const cur = byId('bookings', id); if (navigator.share) { try { await navigator.share({ title: 'Call sheet — ' + cur.title, text: text() }); markSent(); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied'); markSent(); } catch { toast('Select the text and copy it'); } };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Pop-ups are blocked; use "Save as web page" instead');
    w.document.write(callSheetHtml(byId('bookings', id))); w.document.close(); w.focus();
    setTimeout(() => { try { w.print(); } catch { /* the user can print from the window */ } }, 250);
    markSent();
  };
  const saveHtml = async () => { const cur = byId('bookings', id); if (await saveOrShare(callSheetHtml(cur), `call-sheet-${slug(cur.title)}-${cur.date}.html`, 'text/html')) markSent(); };
  const emailHref = () => {
    const cur = byId('bookings', id);
    const to = (cur.crew || []).map(cid => byId('crew', cid)).filter(c => c && c.email).map(c => c.email.trim()).join(',');
    return `mailto:${to}?` + new URLSearchParams({ subject: `Call sheet — ${cur.title} — ${fmtShort(cur.date)}`, body: text() }).toString().replace(/\+/g, '%20');
  };
  const draw = () => {
    const cur = byId('bookings', id); if (!cur) return close();
    const cs = sheetOf(cur), state = sheetState(cur);
    const crew = (cur.crew || []).map(cid => byId('crew', cid)).filter(Boolean);
    const withEmail = crew.filter(c => c.email).length;
    body.replaceChildren(...nodes(
      h('div', { class: 'card-row' },
        h('p', { class: 'status-line', 'data-state': state === 'sent' ? 'synced' : state === 'changed' ? 'error' : '' }, `${state === 'sent' ? '✅' : state === 'changed' ? '⚠' : '📝'} ${STATE_LABEL[state]}${cs.sentAt ? ' · sent ' + new Date(cs.sentAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''}${cs.version ? ' · v' + cs.version : ''}`),
        state !== 'sent' && hasContent(cs) && h('button', { class: 'btn ghost small', onclick: markSent }, 'Mark as sent')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => editCallSheet(cur) }, '✏️ Edit details'),
        h('button', { class: 'btn ghost small', onclick: share }, '📤 Share'),
        h('a', { class: 'btn ghost small', href: emailHref(), onclick: markSent, title: withEmail ? `To: ${withEmail} crew member${withEmail === 1 ? '' : 's'}` : 'No crew email addresses yet' }, withEmail ? `✉ Email crew (${withEmail})` : '✉ Email'),
        h('button', { class: 'btn ghost small', onclick: print }, '🖨 Print / PDF'),
        h('button', { class: 'btn ghost small', onclick: saveHtml }, '💾 Save as web page'),
        h('button', { class: 'btn ghost small', onclick: copy }, 'Copy text')),
      crew.length ? h('details', { class: 'help' }, h('summary', null, `Crew call times and confirmations (${crew.length})`), h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Each person’s call time goes on the sheet; blank means the general call.'), ...crew.map(c => crewRow(cur, c)))) : h('p', { class: 'small muted' }, 'No crew on this booking yet. Add people on the booking, and their call times and phone numbers appear here.'),
      h('div', { class: 'cs-paper' }, renderDoc(cur)),
      h('p', { class: 'small muted' }, 'Built from the booking, venue, crew, kit, hires and the sun for the day, plus the details you add here. Print / PDF opens a clean page to save or print; Save as web page makes a file that opens on any phone.')));
  };
  const unsub = subscribe(draw);
  ({ close } = sheet('Call sheet', body, { onClose: unsub }));
  draw();
}

/* ------------------------------------ list ------------------------------------ */
export function openCallSheets() {
  const today = todayISO();
  const all = activeBookings().filter(b => b.status !== 'Archived');
  const upcoming = all.filter(b => endOf(b) >= today).sort((x, y) => x.date.localeCompare(y.date));
  const past = all.filter(b => endOf(b) < today).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12);
  let close = () => {};
  const row = b => { const st = sheetState(b), cs = sheetOf(b); return h('button', { class: 'card tap', type: 'button', onclick: () => { close(); openCallSheet(b); } },
    h('div', { class: 'card-row' }, h('div', null, h('strong', null, b.title), h('div', { class: 'muted small' }, [dateLabel(b, fmtShort), (cs.generalCall || b.start) && 'call ' + (cs.generalCall || b.start), (b.crew || []).length ? `${b.crew.length} crew` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'pill ' + (st === 'sent' ? 'st-confirmed' : st === 'changed' ? 'st-cancelled' : st === 'draft' ? 'st-enquiry' : '') }, STATE_LABEL[st]))); };
  const body = h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'One call sheet per shoot. Open one to fill in the schedule and details, then send it to the crew. ✅ means it has gone out; ⚠ means it changed since.'),
    upcoming.length ? h('div', { class: 'list' }, ...upcoming.map(row)) : h('p', { class: 'muted' }, 'No upcoming shoots. Add a booking first.'),
    past.length ? h('details', { class: 'help' }, h('summary', null, `Past shoots (${past.length})`), h('div', { class: 'list' }, ...past.map(row))) : null);
  ({ close } = sheet('Call sheets', body));
}

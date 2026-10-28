// Call sheet: everything the crew needs for the day, built from the booking, venue, crew, kit and sun times.
import { h, sheet, toast, fmtLong, fmtTime, parseISO } from './util.js';
import { db, byId, endOf } from './store.js';
import { getTimes } from './suncalc.js';
import { setCheck, itemId } from './workflow.js';

const line = (k, v) => (v ? `${k}: ${v}` : null);
export function callSheetText(b) {
  const p = db.profile, v = b.venueId && byId('venues', b.venueId);
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean);
  const gear = (b.gear || []).map(id => byId('gear', id)).filter(Boolean);
  const byCat = {}; gear.forEach(g => { const c = g.category || 'Other'; byCat[c] = (byCat[c] || 0) + Math.max(1, Number((b.gearQty || {})[g.id]) || 1); });
  let loc = null; try { loc = v && v.geo && Number.isFinite(Number(v.geo.lat)) ? { lat: +v.geo.lat, lon: +v.geo.lon } : JSON.parse(localStorage.getItem('logi-loc')); } catch { /* none */ }
  const t = loc ? getTimes(new Date(parseISO(b.date).getTime() + 12 * 36e5), loc.lat, loc.lon) : null;
  const addr = (b.address || (v && v.address) || '').replace(/\n/g, ', ');
  const out = [
    `CALL SHEET — ${b.title}${b.client ? ' (' + b.client + ')' : ''}`,
    `${fmtLong(b.date)}${endOf(b) > b.date ? ' → ' + fmtLong(endOf(b)) : ''}`,
    line('General call', b.start), line('Wrap (planned)', b.end),
    '',
    'LOCATION',
    line('Address', addr), v && line('Access', v.access), v && line('Parking', v.parking), v && line('Power', v.power), v && line('Nearest hospital', v.hospital), v && (v.rules || '').trim() && 'Venue rules: ' + v.rules.replace(/\n/g, '; '),
    (b.breakMinutes || b.breakNote) && line('Breaks', [b.breakMinutes && b.breakMinutes + ' min approved', b.breakNote].filter(Boolean).join(' · ')),
    '',
    t && 'SUN', t && `Sunrise ${fmtTime(t.sunrise)} · Golden hour ends ${fmtTime(t.goldenHourEnd)} · Golden hour from ${fmtTime(t.goldenHour)} · Sunset ${fmtTime(t.sunset)}`,
    t && '',
    'CREW',
    ...(crew.length ? crew.map(c => `${c.name} — ${c.role || 'crew'}${(b.crewCall || {})[c.id] ? ' · call ' + b.crewCall[c.id] : b.start ? ' · call ' + b.start : ''}${c.phone ? ' · ' + c.phone : ''}`) : ['(no crew assigned)']),
    '',
    (b.stakeholders || []).length && 'CONTACTS', ...((b.stakeholders || []).map(s => [s.name, s.role, s.phone].filter(Boolean).join(' · '))),
    (b.stakeholders || []).length && '',
    gear.length && 'KIT', gear.length && Object.entries(byCat).map(([c, n]) => `${c}: ${n}`).join(' · '),
    (b.hires || []).length && 'Hires: ' + b.hires.map(x => x.item + (x.from ? ' (' + x.from + ')' : '')).join(', '),
    gear.length && '',
    b.notes && 'NOTES', b.notes, b.notes && '',
    `Produced by ${[p.name, p.business].filter(Boolean).join(' / ') || 'Vdex'}${p.phone ? ' · ' + p.phone : ''}${p.email ? ' · ' + p.email : ''}`,
  ].filter(x => x !== null && x !== false && x !== undefined);
  return out.join('\n');
}

export function openCallSheet(b) {
  const text = callSheetText(b);
  const pre = h('pre', { class: 'export-preview callsheet' }, text);
  const markSent = () => { setCheck(b, itemId('Prepped', 'Call sheet sent'), true); toast('Marked: call sheet sent'); };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title: 'Call sheet — ' + b.title, text }); markSent(); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); markSent(); } catch { toast('Select the text and copy it'); } };
  const print = () => { const w = window.open('', '_blank'); if (!w) return toast('Pop-ups are blocked; use Copy instead'); w.document.write(`<!doctype html><title>Call sheet — ${b.title.replace(/</g, '&lt;')}</title><pre style="font:13px/1.5 -apple-system,system-ui,sans-serif;white-space:pre-wrap;padding:24px">${text.replace(/</g, '&lt;')}</pre>`); w.document.close(); w.focus(); w.print(); markSent(); };
  sheet('Call sheet', h('div', { class: 'stack' },
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: share }, '📤 Share'), h('button', { class: 'btn ghost', onclick: copy }, 'Copy'), h('a', { class: 'btn ghost', href: 'mailto:?' + new URLSearchParams({ subject: `Call sheet — ${b.title} ${b.date}`, body: text }).toString().replace(/\+/g, '%20'), onclick: markSent }, '✉ Email'), h('button', { class: 'btn ghost', onclick: print }, '🖨 Print / PDF')),
    pre,
    h('p', { class: 'small muted' }, 'Built from the booking, venue, crew (with their call times), kit, hires and the sun for the day. Edit the booking or venue to change it.')));
}

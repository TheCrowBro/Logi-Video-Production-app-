// Calendar integration, three strengths:
//  1. Add-to-calendar links and .ics files (any service, one booking or all, one-way, on demand).
//  2. A live .ics feed written into the linked cloud storage, which any calendar app can subscribe to.
//  3. Two-way sync with Google Calendar or Microsoft 365 / Outlook through their APIs.
import { h, sheet, toast, parseISO, ymd, fmtLong, fmtShort, icsText, icsFold } from './util.js';
import { db, byId, update, subscribe, activeBookings, endOf, cloud, editDaysOf } from './store.js';
import * as store from './store.js';
import * as providers from './providers.js';
import { SWITCH_ON, preloadSignIn } from './storage-ui.js';
import * as native from './native.js';

const pad = n => String(n).padStart(2, '0');
const utc = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = iso => iso.replace(/-/g, '');
const nextDay = iso => { const d = parseISO(iso); d.setDate(d.getDate() + 1); return ymd(d); };
const localDate = (iso, hm) => { const [y, m, d] = iso.split('-').map(Number); const [hh, mm] = (hm || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh || 0, mm || 0); };
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
// A finish that is not after the start on its own day is the next morning's: an overnight shoot. The next calendar
// day, not 24 hours on, so the night the clocks change still ends at the time on the clock. No finish: an hour.
const endAfter = (start, iso, finish) => { const end = localDate(iso, finish || '00:00'); if (finish && end > start) return end; if (!finish) return new Date(start.getTime() + 36e5); end.setDate(end.getDate() + 1); return end; };
const daysApart = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return ymd(d); };
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const CAL_NAME = 'Vdex bookings';
const NAMES = { google: 'Google Calendar', microsoft: 'Microsoft 365 / Outlook', apple: 'This phone’s calendar' };

/* ------------------------------ one event ------------------------------ */
export function eventOf(b) {
  const venue = b.venueId && byId('venues', b.venueId);
  const location = (b.address || (venue && venue.address) || '').replace(/\n/g, ', ');
  const allDay = !b.start;
  const start = allDay ? b.date : localDate(b.date, b.start);
  let end;
  if (allDay) end = nextDay(endOf(b)); // all-day end is exclusive
  else { end = localDate(endOf(b), b.end || b.start); if (end <= start) end = endAfter(start, endOf(b), b.end); }
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean).map(c => c.name + (c.role ? ` (${c.role})` : ''));
  const gearN = (b.gear || []).filter(id => byId('gear', id)).length;
  const lines = [b.client && 'Client: ' + b.client, 'Status: ' + b.status, venue && 'Venue: ' + venue.name, crew.length && 'Crew: ' + crew.join(', '),
    (b.stakeholders || []).length && 'Contacts: ' + b.stakeholders.map(s => [s.name, s.role, s.phone].filter(Boolean).join(' ')).join('; '),
    gearN > 0 && `Equipment: ${gearN} item${gearN === 1 ? '' : 's'}`, b.notes && '\n' + b.notes, '\nVdex booking ' + b.id].filter(Boolean);
  return { id: b.id, uid: `vdex-${b.id}@vdex.app`, title: b.title + (b.client ? ' — ' + b.client : ''), allDay, start, end, location, description: lines.join('\n'), status: b.status === 'Cancelled' ? 'CANCELLED' : b.status === 'Enquiry' ? 'TENTATIVE' : 'CONFIRMED' };
}
const hashOf = e => JSON.stringify([e.title, e.allDay, e.allDay ? e.start : e.start.getTime(), e.allDay ? e.end : e.end.getTime(), e.location, e.description, e.status]);

/* --------------------------------- .ics --------------------------------- */
const esc = icsText, fold = icsFold; // shared with the crew page's calendar file (js/util.js)
export function icsFor(bookings, extra = [], name = CAL_NAME) {
  const now = utc(new Date());
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vdex//Production Deck//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(name), 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const e of [...bookings.map(eventOf), ...extra]) {
    out.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + now, 'LAST-MODIFIED:' + utc(new Date(Number(e.updatedAt) || Date.now())),
      e.allDay ? 'DTSTART;VALUE=DATE:' + dateOnly(e.start) : 'DTSTART:' + utc(e.start), e.allDay ? 'DTEND;VALUE=DATE:' + dateOnly(e.end) : 'DTEND:' + utc(e.end),
      'SUMMARY:' + esc(e.title), e.location && 'LOCATION:' + esc(e.location), 'DESCRIPTION:' + esc(e.description), 'STATUS:' + e.status, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.filter(Boolean).map(fold).join('\r\n') + '\r\n';
}
// Deliverable due dates ride along as all-day events.
export function dueEvents() {
  const out = [];
  for (const b of activeBookings()) for (const d of b.deliverables || []) if (d.due && d.status !== 'Delivered') out.push({ id: 'del:' + d.id, uid: `vdex-del-${d.id}@vdex.app`, title: `Deliver: ${d.name} — ${b.title}`, allDay: true, start: d.due, end: nextDay(d.due), location: '', description: `${b.title}${b.client ? ' for ' + b.client : ''}\nDeliverable: ${d.name}${d.duration ? ' (' + d.duration + ')' : ''}\nStatus: ${d.status}\n\nVdex booking ${b.id}`, status: 'CONFIRMED', updatedAt: b.updatedAt });
  return out;
}
// Edit days ride along too, one event each, labelled so they are never mistaken for the shoot.
export function editEvents(bookings = activeBookings()) {
  const out = [];
  for (const b of bookings) for (const d of editDaysOf(b)) {
    const allDay = !d.start, start = allDay ? d.date : localDate(d.date, d.start);
    let end; if (allDay) end = nextDay(d.date); else end = endAfter(start, d.date, d.end);
    out.push({ id: 'edit:' + b.id + ':' + d.date, uid: `vdex-edit-${b.id}-${d.date}@vdex.app`, title: `Edit: ${b.title}${b.client ? ' — ' + b.client : ''}`, allDay, start, end, location: '', description: `Edit day for ${b.title}${b.client ? ' (' + b.client + ')' : ''}\n\nVdex booking ${b.id}`, status: b.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED', updatedAt: b.updatedAt });
  }
  return out;
}
export const feedIcs = () => icsFor(activeBookings(), [...dueEvents(), ...editEvents()]);
export const FEED_NAME = 'vdex-bookings.ics';
store.setAuxWriter(() => ({ name: FEED_NAME, text: feedIcs(), type: 'text/calendar' }));

/* ------------------------------ quick links ------------------------------ */
const q = o => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''))).toString();
export const googleLink = e => 'https://calendar.google.com/calendar/render?' + q({ action: 'TEMPLATE', text: e.title, dates: e.allDay ? `${dateOnly(e.start)}/${dateOnly(e.end)}` : `${utc(e.start)}/${utc(e.end)}`, details: e.description, location: e.location });
export const outlookLink = (e, host) => `https://outlook.${host}.com/calendar/0/deeplink/compose?` + q({ path: '/calendar/action/compose', rru: 'addevent', subject: e.title, startdt: e.allDay ? e.start : e.start.toISOString(), enddt: e.allDay ? e.end : e.end.toISOString(), body: e.description, location: e.location, allday: e.allDay ? 'true' : 'false' });
export const yahooLink = e => 'https://calendar.yahoo.com/?' + q({ v: 60, title: e.title, st: e.allDay ? dateOnly(e.start) : utc(e.start), et: e.allDay ? dateOnly(e.end) : utc(e.end), desc: e.description, in_loc: e.location, dur: e.allDay ? 'allday' : null });
export const summaryText = b => { const e = eventOf(b), ed = editDaysOf(b); return [e.title, (endOf(b) > b.date ? `${fmtLong(b.date)} → ${fmtLong(endOf(b))}` : fmtLong(b.date)) + (b.start ? ` · ${b.start}${b.end ? '–' + b.end : ''}` : ''), ed.length && 'Edit days: ' + ed.map(d => fmtShort(d.date) + (d.start ? ` ${d.start}${d.end ? '–' + d.end : ''}` : '')).join(', '), e.location && 'Where: ' + e.location, '', e.description].filter(x => x != null && x !== false && x !== 0).join('\n'); };
export const mailtoLink = b => 'mailto:?' + q({ subject: `Booking: ${b.title} — ${fmtShort(b.date)}`, body: summaryText(b) }).replace(/\+/g, '%20');
const slug = s => String(s).replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'booking';
async function shareIcs(name, text, title, body) {
  if (native.canShareFiles()) { try { await native.files.share(name, text, 'text/calendar', { title, text: body }); } catch (e) { toast('Could not share: ' + (e.message || e)); } return; }
  const file = new File([text], name, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ title, text: body, files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = h('a', { href: URL.createObjectURL(file), download: name }); document.body.append(a); a.click(); a.remove(); toast('Calendar file saved');
}
export const shareBooking = b => shareIcs(slug(b.title) + '.ics', icsFor([b], editEvents([b]), b.title), b.title, summaryText(b));
export const shareAll = () => shareIcs(FEED_NAME, feedIcs(), CAL_NAME, `${activeBookings().length} bookings from Vdex`);

export function openAddToCalendar(b) {
  const e = eventOf(b);
  const link = (label, href) => h('a', { class: 'btn ghost', href, target: '_blank', rel: 'noopener noreferrer' }, label);
  const phone = native.calendar.available() && h('button', { class: 'btn primary', onclick: async () => { try { if (await native.calendar.prompt({ title: e.title, location: e.location, description: e.description, isAllDay: e.allDay, startDate: ms(e, 'start'), endDate: e.allDay ? ms(e, 'end') - 1000 : ms(e, 'end') })) toast('Added to the calendar'); } catch (err) { toast('Could not add it: ' + (err.message || err)); } } }, '📱 This phone’s calendar');
  sheet('Add to calendar', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `${e.title} · ${fmtLong(b.date)}${b.start ? ' · ' + b.start : ''}`),
    phone,
    link('Google Calendar', googleLink(e)), link('Outlook.com', outlookLink(e, 'live')), link('Microsoft 365 / Office', outlookLink(e, 'office')), link('Yahoo Calendar', yahooLink(e)),
    h('button', { class: 'btn ghost', onclick: () => shareBooking(b) }, 'Apple Calendar / other (.ics file)'),
    h('a', { class: 'btn ghost', href: mailtoLink(b) }, '✉ Email the details'),
    h('p', { class: 'small muted' }, 'These add a copy of the booking once. For a calendar that updates itself, use Calendar on the Bookings page.')));
}

/* ------------------------------ two-way sync ------------------------------ */
// Two links can be live at once: the account link (Google or Microsoft), which is part of the database and so shared
// by every device, and, in the iPhone app, the phone's own calendar, a link of this device alone (its calendar and
// event ids mean nothing elsewhere), kept in this device's storage. Each keeps a "Vdex bookings" calendar in step.
export const calState = { status: 'idle', error: '', at: 0 }; // the account link: idle | syncing | ok | error | needs-auth
export const phoneState = { status: 'idle', error: '', at: 0 }; // the phone's calendar
const CAL_WORDS = { ok: 'Up to date', syncing: 'Updating…', 'needs-auth': 'Paused: tap Sync now and sign in to carry on', error: 'Could not update', idle: 'Connected' };
let pausedSaid = false; // a background update that needs a sign-in says so once, outside this panel
const subs = new Set(); export const onCalChange = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach(fn => fn(calState));
const setState = (st, status, error = '') => { st.status = status; st.error = error; if (status === 'ok') st.at = Date.now(); emit(); };

const PHONE_KEY = 'logi-cal-phone';
export const phoneLink = () => { try { const v = JSON.parse(localStorage.getItem(PHONE_KEY)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const savePhone = v => { try { if (v) localStorage.setItem(PHONE_KEY, JSON.stringify(v)); else localStorage.removeItem(PHONE_KEY); } catch { /* blocked storage: the link lasts this visit */ } };
const LINKS = {
  account: { key: 'account', state: calState, get: () => db.calSync, adapter: () => { const cs = db.calSync; return cs && cs.provider && cs.provider !== 'apple' ? ADAPTERS[cs.provider] : null; }, name: () => NAMES[db.calSync?.provider] || db.calSync?.provider || '',
    save: (calendarId, events) => update(d => { d.calSync = { ...d.calSync, calendarId, events, updatedAt: Date.now() }; }) },
  phone: { key: 'phone', state: phoneState, get: phoneLink, adapter: () => (phoneLink() && native.calendar.available() ? apple : null), name: () => NAMES.apple,
    save: (calendarId, events) => savePhone({ ...(phoneLink() || {}), calendarId, events, updatedAt: Date.now() }) },
};
const which = w => (w === 'phone' ? [LINKS.phone] : w === 'account' ? [LINKS.account] : [LINKS.account, LINKS.phone]);

// What a calendar edit means for the booking: date(s), times, title and address follow the event. The event is set
// against what Vdex sent (eventOf), never against the booking's own boxes: a finish Vdex had to make up for the
// calendar (an hour for a shoot with no finish, the next morning for an overnight one) is not an edit, and only a
// start or an end that was moved in the calendar is written back.
function patchFromEvent(b, r) {
  const patch = {}, ev = eventOf(b), multi = endOf(b) > b.date;
  const put = (k, v) => { if ((b[k] || '') !== (v || '')) patch[k] = v || undefined; };
  if (r.allDay) {
    if (!ev.allDay || r.start !== ev.start || r.end !== ev.end) {
      const last = addDays(r.end, -1);
      put('date', r.start); put('endDate', last > r.start ? last : ''); put('start', ''); put('end', '');
    }
  } else {
    const s = new Date(r.start), e = new Date(r.end);
    const startMoved = ev.allDay || s.getTime() !== ev.start.getTime(), endMoved = ev.allDay || e.getTime() !== ev.end.getTime();
    if (startMoved || endMoved) {
      const date = ymd(s), start = hm(s), sameLength = !ev.allDay && e.getTime() - s.getTime() === ev.end.getTime() - ev.start.getTime();
      let end, endDate;
      if (!ev.allDay && !b.end && (!endMoved || sameLength)) { // no finish in Vdex, and the event was only moved: still no finish
        end = ''; endDate = !multi ? '' : endMoved ? addDays(b.endDate, daysApart(b.date, date)) : b.endDate;
      } else { // a finish the next morning, on a one-day shoot, is an overnight finish and not a second day
        end = hm(e); const span = daysApart(date, ymd(e));
        endDate = span <= 0 || (span === 1 && !multi && end <= start) ? '' : ymd(e);
      }
      put('date', date); put('start', start); put('end', end); put('endDate', endDate > date ? endDate : '');
    }
  }
  const title = b.client && r.title.endsWith(' — ' + b.client) ? r.title.slice(0, -(' — ' + b.client).length) : r.title;
  if (title && title !== b.title) patch.title = title;
  if ((r.location || '') !== ev.location) patch.address = r.location || ''; // eventOf: the booking's address, or its venue's
  return Object.keys(patch).length ? patch : null;
}

// The dates a sync covers: every event it wants, and every event it made before (the mapping keeps each one's day), so
// an adapter that can only list a window of dates (the phone's calendar) lists all of them.
const dayOf = e => (e.allDay ? e.start : ymd(e.start));
function spanOf(events, mapping) {
  const days = [...events.map(dayOf), ...Object.values(mapping).map(m => m && m.day).filter(Boolean)].sort();
  return days.length ? { from: parseISO(days[0]).getTime() - 2 * 864e5, to: parseISO(days[days.length - 1]).getTime() + 3 * 864e5 } : null;
}
async function runSync(link, interactive) {
  const cs = link.get(); const ad = link.adapter();
  if (!ad) return;
  if (link.busy) { link.again = true; return; } // asked for while one is running (a booking changed meanwhile): it runs once more when this one ends
  link.busy = true; link.reached = false; setState(link.state, 'syncing');
  const mapping = { ...(cs.events || {}) }; let calendarId = cs.calendarId;
  try {
    calendarId = await ad.ensureCalendar(calendarId, interactive); link.reached = true;
    const wanted = () => [...activeBookings().map(b => ({ key: b.id, e: eventOf(b) })), ...dueEvents().map(e => ({ key: e.id, e })), ...editEvents().map(e => ({ key: e.id, e }))];
    const remote = await ad.list(calendarId, interactive, spanOf(wanted().map(w => w.e), mapping));
    const byLogi = new Map(remote.filter(r => r.logiId).map(r => [r.logiId, r]));
    // adopt events another device already created, so they are updated rather than duplicated
    for (const r of remote) if (r.logiId && !mapping[r.logiId] && (byId('bookings', r.logiId) || r.logiId.startsWith('del:') || r.logiId.startsWith('edit:'))) mapping[r.logiId] = { id: r.id, hash: '', at: 0 };
    // pull: edits made in the calendar. The two clocks are never set against each other (this device's can be seconds or
    // minutes out, and Vdex's own push would then pass for a calendar edit and undo what was just changed here):
    //  - a booking changed in Vdex since its last push (its hash differs), or an event taken over without one, goes out
    //    as Vdex has it, in the push below;
    //  - otherwise the event is looked at when the calendar's own stamp has moved since Vdex last looked at it (seen),
    //    or when that stamp is not known yet (the first listing after a push), and what differs from what was sent is
    //    a calendar edit.
    const changes = [];
    for (const [bid, m] of Object.entries(mapping)) {
      if (bid.startsWith('del:') || bid.startsWith('edit:')) continue;
      const r = byLogi.get(bid), b = byId('bookings', bid); if (!r || !b) continue;
      if (!m.hash || hashOf(eventOf(b)) !== m.hash) continue;
      if (m.seen != null && r.updated && r.updated <= m.seen) continue;
      const p = patchFromEvent(b, r); if (p) changes.push([bid, p]);
      if ((m.seen || null) !== (r.updated || null)) mapping[bid] = { ...m, seen: r.updated || null };
    }
    if (changes.length) update(d => { for (const [bid, p] of changes) { const b = d.bookings.find(x => x.id === bid); if (b) { Object.assign(b, p); for (const k of ['endDate', 'start', 'end']) if (b[k] === undefined || b[k] === '') delete b[k]; b.updatedAt = Date.now(); } } });
    // push: what the bookings are now, after the pull
    const want = wanted(), wantIds = new Set(want.map(w => w.key));
    for (const { key, e } of want) {
      const hash = hashOf(e), m = mapping[key], day = dayOf(e);
      if (!m || !byLogi.has(key)) { const id = await ad.create(calendarId, e); mapping[key] = { id, hash, at: Date.now(), day }; }
      else if (m.hash !== hash) { await ad.update(calendarId, m.id, e); mapping[key] = { id: m.id, hash, at: Date.now(), day }; }
      else if (m.day !== day) mapping[key] = { ...m, day };
    }
    for (const [bid, m] of Object.entries(mapping)) if (!wantIds.has(bid)) { if (byLogi.has(bid)) await ad.remove(calendarId, m.id); delete mapping[bid]; }
    setState(link.state, 'ok'); if (link === LINKS.account) pausedSaid = false;
  } catch (e) {
    const status = e.name === 'NotAllowedError' || /auth|sign|token|consent|expired|401/i.test(e.message || '') ? 'needs-auth' : 'error';
    setState(link.state, status, e.message || String(e));
    if (status === 'needs-auth' && !interactive && !pausedSaid && link === LINKS.account) { pausedSaid = true; toast(`${link.name()} is paused until you sign in again: Bookings → Calendar & email → Sync now.`); }
  } finally {
    link.busy = false;
    // Saved only when something changed (a save redraws the page and writes the cloud copy), and never after a disconnect.
    const now = link.adapter() && link.get();
    if (now && (calendarId !== now.calendarId || JSON.stringify(mapping) !== JSON.stringify(now.events || {}))) link.save(calendarId, mapping);
  }
  if (link.again) { link.again = false; await runSync(link, false); }
}
// Keeps the calendars in step now: both links, or one of them (which: 'account' | 'phone').
export async function syncCalendar({ interactive = false, which: w } = {}) { await Promise.all(which(w).map(l => runSync(l, interactive))); }
// Connect = sign in and make the calendar. If the sign-in is cancelled or fails, go back to not connected and say why.
export async function connectCalendar(provider) {
  if (provider === 'apple') { // the phone's calendar: this device only, no account
    if (!native.calendar.available()) throw new Error('The phone’s calendar is only available in the Vdex app on an iPhone.');
    await apple.signIn();
    savePhone({ calendarId: null, events: {}, updatedAt: Date.now() });
    await runSync(LINKS.phone, true);
    if (['error', 'needs-auth'].includes(phoneState.status) && !phoneLink()?.calendarId) { const msg = phoneState.error || 'Could not reach the calendar'; savePhone(null); setState(phoneState, 'idle'); throw new Error(msg); }
    return;
  }
  // Sign in first, and connect only once that has worked: an abandoned or cancelled sign-in leaves nothing half-done.
  // (Microsoft's sign-in goes to its page and back; the way back connects it.)
  try { await ADAPTERS[provider].signIn(); }
  catch (e) { if (e.name === 'AbortError') return; if (/^Carry on in your web browser/.test(e.message)) { toast(e.message); return; } throw e; }
  // The calendar Vdex made for this service before a Disconnect is used again (calendarFor names the service its id
  // belongs to): ensureCalendar makes a new one only when that one is gone, as with another account. Without it every
  // Disconnect and Connect left one more "Vdex bookings" calendar behind, with every booking in it.
  update(d => { const was = d.calSync || {}; d.calSync = { ...was, provider, calendarId: (was.calendarFor || was.provider) === provider ? was.calendarId || null : null, calendarFor: provider, events: {}, updatedAt: Date.now() }; });
  await runSync(LINKS.account, true);
  if (/^Carry on in your web browser/.test(calState.error || '')) { toast(calState.error); return; } // carries on in the web browser (desktop app)
  if (['error', 'needs-auth'].includes(calState.status) && (!db.calSync?.calendarId || !LINKS.account.reached)) { const msg = calState.error || 'Sign-in did not finish'; update(d => { d.calSync = { ...d.calSync, provider: null, updatedAt: Date.now() }; }); setState(calState, 'idle'); throw new Error(msg); }
}
export function disconnectCalendar(w = 'account') {
  if (w === 'phone') { savePhone(null); setState(phoneState, 'idle'); return; }
  ADAPTERS[db.calSync?.provider]?.signOut?.(); update(d => { const was = d.calSync || {}; d.calSync = { ...was, provider: null, calendarFor: was.provider || was.calendarFor || null, events: {}, updatedAt: Date.now() }; }); setState(calState, 'idle'); // the calendar's id is kept for the next Connect
}

// Push automatically after booking edits while a link is connected (only when a token is already in hand).
let lastHash = '', pushTimer = null;
subscribe(() => {
  if (!LINKS.account.adapter() && !LINKS.phone.adapter()) return;
  const hsh = JSON.stringify(activeBookings().map(b => [b.id, b.updatedAt, (b.deliverables || []).length]));
  if (hsh === lastHash) return; lastHash = hsh;
  clearTimeout(pushTimer); pushTimer = setTimeout(() => syncCalendar({ interactive: false }), 1500);
});

/* -------------------------------- adapters -------------------------------- */
const gdate = e => e.allDay ? { date: e.start } : { dateTime: e.start.toISOString(), timeZone: TZ };
const gend = e => e.allDay ? { date: e.end } : { dateTime: e.end.toISOString(), timeZone: TZ };
const gbody = e => ({ summary: e.title, description: e.description, location: e.location, start: gdate(e), end: gend(e), status: e.status === 'TENTATIVE' ? 'tentative' : 'confirmed', extendedProperties: { private: { logi: '1', logiId: e.id } } });
const GCAL = 'https://www.googleapis.com/calendar/v3';
const google = {
  scope: 'https://www.googleapis.com/auth/calendar.app.created',
  async call(path, init = {}, interactive = false) {
    const token = await providers.googleToken(google.scope, interactive);
    const r = await fetch(GCAL + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    if (r.status === 401) { providers.forgetGoogleToken(google.scope); throw new Error('Google sign-in expired — tap Sync now to reconnect'); }
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error('Google Calendar ' + r.status + ': ' + ((await r.json().catch(() => ({}))).error?.message || 'request failed'));
    return r;
  },
  async ensureCalendar(id, interactive) {
    if (id) { const r = await google.call(`/calendars/${encodeURIComponent(id)}`, {}, interactive); if (r.ok) return id; }
    const r = await google.call('/calendars', { method: 'POST', body: JSON.stringify({ summary: CAL_NAME, timeZone: TZ }) }, interactive);
    return (await r.json()).id;
  },
  async list(id) {
    const out = []; let token = '';
    do {
      const r = await google.call(`/calendars/${encodeURIComponent(id)}/events?maxResults=2500&singleEvents=true&privateExtendedProperty=logi%3D1${token ? '&pageToken=' + token : ''}`);
      const j = await r.json(); token = j.nextPageToken || '';
      for (const ev of j.items || []) if (ev.status !== 'cancelled') out.push({ id: ev.id, logiId: ev.extendedProperties?.private?.logiId, title: ev.summary || '', allDay: !!ev.start?.date, start: ev.start?.date || ev.start?.dateTime, end: ev.end?.date || ev.end?.dateTime, location: ev.location || '', updated: Date.parse(ev.updated) || 0 });
    } while (token);
    return out;
  },
  async create(id, e) { return (await (await google.call(`/calendars/${encodeURIComponent(id)}/events`, { method: 'POST', body: JSON.stringify(gbody(e)) })).json()).id; },
  async update(id, eid, e) { await google.call(`/calendars/${encodeURIComponent(id)}/events/${encodeURIComponent(eid)}`, { method: 'PATCH', body: JSON.stringify(gbody(e)) }); },
  async remove(id, eid) { await google.call(`/calendars/${encodeURIComponent(id)}/events/${encodeURIComponent(eid)}`, { method: 'DELETE' }); },
  signIn: () => providers.googleToken(google.scope, true),
  signOut() { providers.forgetGoogleToken(google.scope); },
};

const MS_PROP = 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name LogiId';
const msLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const mbody = e => ({ subject: e.title, body: { contentType: 'text', content: e.description }, location: { displayName: e.location }, isAllDay: e.allDay,
  start: { dateTime: e.allDay ? e.start + 'T00:00:00' : msLocal(e.start), timeZone: TZ }, end: { dateTime: e.allDay ? e.end + 'T00:00:00' : msLocal(e.end), timeZone: TZ },
  showAs: e.status === 'TENTATIVE' ? 'tentative' : 'busy', singleValueExtendedProperties: [{ id: MS_PROP, value: e.id }] });
const GRAPH = 'https://graph.microsoft.com/v1.0';
const microsoft = {
  async call(path, init = {}, interactive = false) {
    const token = await providers.microsoftToken([providers.MS_CAL], interactive, 'calendar');
    const r = await fetch(GRAPH + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: `outlook.timezone="${TZ}"` } });
    if (r.status === 401) throw new Error('Microsoft wants you to sign in again — tap Sync now');
    if (!r.ok && r.status !== 404) throw new Error('Microsoft 365 ' + r.status + ': ' + ((await r.json().catch(() => ({}))).error?.message || 'request failed'));
    return r;
  },
  async ensureCalendar(id, interactive) {
    if (id) { const r = await microsoft.call(`/me/calendars/${id}`, {}, interactive); if (r.ok) return id; }
    const found = await (await microsoft.call(`/me/calendars?$filter=name eq '${CAL_NAME}'`, {}, interactive)).json();
    if (found.value?.length) return found.value[0].id;
    return (await (await microsoft.call('/me/calendars', { method: 'POST', body: JSON.stringify({ name: CAL_NAME }) })).json()).id;
  },
  async list(id) {
    const out = []; let url = `/me/calendars/${id}/events?$top=500&$select=id,subject,start,end,isAllDay,location,lastModifiedDateTime&$expand=singleValueExtendedProperties($filter=id eq '${MS_PROP}')`;
    while (url) {
      const j = await (await microsoft.call(url)).json();
      for (const ev of j.value || []) out.push({ id: ev.id, logiId: ev.singleValueExtendedProperties?.[0]?.value, title: ev.subject || '', allDay: !!ev.isAllDay, start: ev.isAllDay ? ev.start.dateTime.slice(0, 10) : ev.start.dateTime, end: ev.isAllDay ? ev.end.dateTime.slice(0, 10) : ev.end.dateTime, location: ev.location?.displayName || '', updated: Date.parse(ev.lastModifiedDateTime) || 0 });
      url = j['@odata.nextLink'] ? j['@odata.nextLink'].replace(GRAPH, '') : null;
    }
    return out;
  },
  async create(id, e) { return (await (await microsoft.call(`/me/calendars/${id}/events`, { method: 'POST', body: JSON.stringify(mbody(e)) })).json()).id; },
  async update(id, eid, e) { await microsoft.call(`/me/events/${eid}`, { method: 'PATCH', body: JSON.stringify(mbody(e)) }); },
  async remove(id, eid) { await microsoft.call(`/me/events/${eid}`, { method: 'DELETE' }); },
  signIn: () => providers.microsoftToken([providers.MS_CAL], true, 'calendar'),
  signOut() { providers.microsoftSignOut({ keepToken: localStorage.getItem('logi-provider') === 'onedrive', keepWho: true }); }, // OneDrive storage shares the sign-in, and the account line is the storage's
};

// The phone's calendar, in the iPhone app (EventKit, through js/native.js). The booking's id rides in each event's
// URL, which is how Vdex's own events are told from the rest; the phone keeps a modification time for the pull.
const EVENT_URL = 'https://vdex.crowmade.app/?event=';
const logiIdOf = url => { const m = /[?&]event=([^&#]+)/.exec(url || ''); return m ? decodeURIComponent(m[1]) : undefined; };
const ms = (e, k) => (e.allDay ? localDate(e[k]).getTime() : e[k].getTime());
// An all-day event ends at 23:59:59 of its last day on the phone; Vdex's exclusive end is the day after.
const abody = (calendarId, e) => ({ calendarId, title: e.title, location: e.location, description: e.description, isAllDay: e.allDay, startDate: ms(e, 'start'), endDate: e.allDay ? ms(e, 'end') - 1000 : ms(e, 'end'), url: EVENT_URL + encodeURIComponent(e.id) });
const apple = {
  async signIn() { const r = await native.calendar.access(); if (r !== 'granted') throw new Error('Vdex needs access to the calendar. Allow it under Settings → Vdex → Calendars, then try again.'); },
  async ensureCalendar(id) {
    const list = await native.calendar.calendars();
    if (id && list.some(c => c.id === id)) return id;
    const ours = c => c.title === CAL_NAME && c.allowsContentModifications !== false && c.source && (c.source.type === 0 || /icloud/i.test(c.source.title || '')); // on this phone, or iCloud: a Google or Outlook account's calendar of the same name belongs to the account link
    const found = list.find(ours);
    return found ? found.id : native.calendar.createCalendar(CAL_NAME);
  },
  async list(id, interactive, span) {
    const WINDOW = 3 * 365 * 864e5; // the phone lists at most four years at a time
    const from = span ? span.from : Date.now() - 400 * 864e5, to = span ? span.to : Date.now() + 3 * 366 * 864e5;
    const all = new Map();
    for (let a = from; a < to; a += WINDOW) for (const ev of await native.calendar.events(a, Math.min(to, a + WINDOW))) all.set(ev.id, ev);
    return [...all.values()].filter(ev => ev.calendarId === id && logiIdOf(ev.url)).map(ev => {
      const allDay = !!ev.isAllDay, s = new Date(ev.startDate), e = new Date(ev.endDate + 1000);
      const start = allDay ? ymd(s) : s.toISOString();
      let end = allDay ? ymd(e) : new Date(ev.endDate).toISOString();
      if (allDay && end <= start) end = nextDay(start);
      return { id: ev.id, logiId: logiIdOf(ev.url), title: ev.title || '', allDay, start, end, location: ev.location || '', updated: Number(ev.lastModifiedDate) || 0 };
    });
  },
  create: (id, e) => native.calendar.create(abody(id, e)),
  async update(id, eid, e) { await native.calendar.update({ id: eid, ...abody(id, e) }); },
  async remove(id, eid) { await native.calendar.remove(eid); },
  signOut() {},
};
export const ADAPTERS = { google, microsoft };

/* --------------------------------- sheet --------------------------------- */
export function calendarPanel() {
  const body = h('div', { class: 'stack' });
  preloadSignIn();
  const help = text => h('details', { class: 'help' }, h('summary', null, 'Setup'), h('div', { class: 'small muted' }, text));
  // One tap: sign in and allow. Greyed out with a pointer to the switch-on guide until this copy of Vdex has its apps registered.
  const calChoice = (svc, name, sub) => { const on = providers.signIn.available(svc === 'google' ? 'google-calendar' : svc);
    return h('div', { class: 'card cloud-choice' + (on ? '' : ' off'), 'data-svc': svc }, h('span', { class: 'cloud-ico', 'aria-hidden': 'true' }, svc === 'google' ? '📅' : '📆'),
      h('div', { class: 'grow' }, h('strong', null, name), h('div', { class: 'small muted' }, on ? sub : `Not ready yet: sign-in for ${name} is still being set up for Vdex.`, !on && [' ', h('a', { href: SWITCH_ON, target: '_blank', rel: 'noopener', class: 'publisher-link' }, 'For the Vdex publisher: how to switch it on')])),
      h('button', { class: 'btn primary', disabled: !on, 'aria-label': `Connect ${name}`, onclick: () => connectCalendar(svc).then(draw).catch(e => toast(e.message)) }, 'Connect')); };
  const copy = url => async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Select the link and copy it'); } };
  const draw = () => {
    const cs = db.calSync || {}, n = activeBookings().length, a = cloud.adapter, pl = phoneLink();
    body.replaceChildren(
      h('div', { class: 'card' }, h('strong', null, 'Export once'),
        h('p', { class: 'small muted' }, `Save or share all ${n} active booking${n === 1 ? '' : 's'} as a calendar file. Any calendar app imports it.`),
        h('button', { class: 'btn ghost', onclick: () => store.requirePaid('export') && shareAll() }, '📤 Share bookings (.ics)')),
      h('div', { class: 'card' }, h('strong', null, 'Live feed (any calendar app)'),
        h('p', { class: 'small muted' }, 'Vdex keeps a vdex-bookings.ics file in your linked cloud storage up to date. Subscribe to its link once and your calendar follows every change by itself. One-way, from Vdex to the calendar.'),
        !a ? h('p', { class: 'note' }, 'Link a cloud storage first (the menu ☰ at the top, then Storage, sync & backups).')
          : cloud.paused ? h('p', { class: 'note' }, `${a.label} is paused: cloud storage comes with a licence, so the feed is not updated until then.`)
          : !a.writeAux ? h('p', { class: 'note' }, `${a.label} keeps Vdex’s copy private, so it can’t give your calendar a link to follow. Use Two-way sync below, or Export once.`)
          : [h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cs.feed, onchange: async e => { await store.setFeed(e.target.checked); draw(); } }), h('span', null, `Publish the feed to ${a.label}`)),
            cs.feed && a.id === 'file' && h('div', { class: 'stack' },
              cloud.auxName ? h('p', { class: 'small' }, `Feed file: ${cloud.auxName}. Share that file from your Dropbox / Drive / OneDrive app and use the link’s direct-download form (Dropbox: dl=1, OneDrive: ?download=1, Google Drive: drive.google.com/uc?export=download&id=…).`) : h('button', { class: 'btn ghost', onclick: async () => { try { await store.createFeedFile(); draw(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } } }, 'Choose where to save vdex-bookings.ics…')),
            cs.feed && a.id !== 'file' && !a.shareLink && h('p', { class: 'small' }, `Vdex keeps vdex-bookings.ics up to date in its folder on ${a.label}. Share that file from your server (Nextcloud: Share → Share link) and subscribe to that link.`),
            cs.feed && a.id !== 'file' && a.shareLink && h('div', { class: 'stack' },
              cloud.feedUrl ? [h('div', { class: 'link-text' }, cloud.feedUrl), h('button', { class: 'btn ghost small', onclick: copy(cloud.feedUrl) }, 'Copy subscription link')]
                : h('button', { class: 'btn ghost', onclick: async () => { try { await store.feedLink(); draw(); } catch (e) { toast(e.message); } } }, 'Get the subscription link'),
              cloud.feedError && h('div', { class: 'warn small' }, cloud.feedError)),
            cs.feed && help('Google Calendar (web): Other calendars → + → From URL → paste the link. Apple Calendar: File → New Calendar Subscription. iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Outlook: Add calendar → Subscribe from web. Refresh is up to the calendar: Apple lets you choose (5 min–weekly), Outlook about every 3 hours, Google up to a day.')]),
      h('div', { class: 'card' }, h('strong', null, 'Two-way sync'),
        h('p', { class: 'small muted' }, 'Keeps a “Vdex bookings” calendar in your account: bookings go to it, and date, time, title or location edits made there come back into Vdex.'),
        cs.provider && cs.provider !== 'apple'
          ? [h('p', { class: 'status-line', 'data-state': calState.status === 'ok' ? 'synced' : calState.status === 'error' ? 'error' : '' }, `${NAMES[cs.provider] || cs.provider} — ${CAL_WORDS[calState.status] ?? calState.status}${calState.at && calState.status === 'ok' ? ' · ' + new Date(calState.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}${calState.error && calState.status === 'error' ? ' (' + calState.error + ')' : ''}`),
            h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => syncCalendar({ interactive: true, which: 'account' }) }, 'Sync now'), h('button', { class: 'btn ghost', onclick: () => { disconnectCalendar('account'); draw(); } }, 'Disconnect'))]
          : [h('p', { class: 'small muted' }, 'Sign in to your calendar account and tap Allow. Vdex only touches the “Vdex bookings” calendar it makes.'),
            h('div', { class: 'stack cloud-choices' },
              calChoice('google', 'Google Calendar', 'About once an hour Google asks again: tap Sync now here.'),
              calChoice('microsoft', 'Outlook / Microsoft 365', 'Personal accounts work straight away; work accounts may need IT approval. About once a day, tap Sync now here.'))]),
      native.calendar.available() && h('div', { class: 'card', 'data-svc': 'apple' }, h('strong', null, 'This phone’s calendar'),
        h('p', { class: 'small muted' }, 'A “Vdex bookings” calendar in the Calendar app, kept in step both ways on this phone, with no sign-in. It can run beside an account above.'),
        pl && cs.provider && cs.provider !== 'apple' && h('p', { class: 'small warn' }, `If your ${NAMES[cs.provider]} account is also in this phone’s Calendar app, you will see each booking twice there: once from each link. Keep the one you prefer.`),
        pl
          ? [h('p', { class: 'status-line', 'data-state': phoneState.status === 'ok' ? 'synced' : phoneState.status === 'error' ? 'error' : '' }, `${NAMES.apple} — ${CAL_WORDS[phoneState.status] ?? phoneState.status}${phoneState.at && phoneState.status === 'ok' ? ' · ' + new Date(phoneState.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}${phoneState.error && phoneState.status === 'error' ? ' (' + phoneState.error + ')' : ''}`),
            h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => syncCalendar({ interactive: true, which: 'phone' }) }, 'Sync now'), h('button', { class: 'btn ghost', onclick: () => { disconnectCalendar('phone'); draw(); } }, 'Disconnect'))]
          : h('div', { class: 'actions' }, h('button', { class: 'btn primary', 'aria-label': 'Connect This phone’s calendar', onclick: () => connectCalendar('apple').then(draw).catch(e => toast(e.message)) }, 'Connect'))));
  };
  draw();
  const un1 = onCalChange(draw), un2 = store.subscribe(() => { if (document.activeElement?.tagName !== 'INPUT') draw(); });
  return { el: body, destroy: () => { un1(); un2(); } };
}
export function openCalendarSheet() { const p = calendarPanel(); sheet('Calendar & email', p.el, { onClose: p.destroy }); }

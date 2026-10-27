// Calendar integration, three strengths:
//  1. Add-to-calendar links and .ics files (any service, one booking or all, one-way, on demand).
//  2. A live .ics feed written into the linked cloud storage, which any calendar app can subscribe to.
//  3. Two-way sync with Google Calendar or Microsoft 365 / Outlook through their APIs.
import { h, sheet, toast, parseISO, ymd, fmtLong, fmtShort } from './util.js';
import { db, byId, update, subscribe, activeBookings, endOf, cloud } from './store.js';
import * as store from './store.js';
import * as providers from './providers.js';

const pad = n => String(n).padStart(2, '0');
const utc = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const dateOnly = iso => iso.replace(/-/g, '');
const nextDay = iso => { const d = parseISO(iso); d.setDate(d.getDate() + 1); return ymd(d); };
const localDate = (iso, hm) => { const [y, m, d] = iso.split('-').map(Number); const [hh, mm] = (hm || '00:00').split(':').map(Number); return new Date(y, m - 1, d, hh || 0, mm || 0); };
const hm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const CAL_NAME = 'Logi bookings';

/* ------------------------------ one event ------------------------------ */
export function eventOf(b) {
  const venue = b.venueId && byId('venues', b.venueId);
  const location = (b.address || (venue && venue.address) || '').replace(/\n/g, ', ');
  const allDay = !b.start;
  const start = allDay ? b.date : localDate(b.date, b.start);
  let end;
  if (allDay) end = nextDay(endOf(b)); // all-day end is exclusive
  else { end = localDate(endOf(b), b.end || b.start); if (end <= start) end = new Date(start.getTime() + 36e5); }
  const crew = (b.crew || []).map(id => byId('crew', id)).filter(Boolean).map(c => c.name + (c.role ? ` (${c.role})` : ''));
  const lines = [b.client && 'Client: ' + b.client, 'Status: ' + b.status, venue && 'Venue: ' + venue.name, crew.length && 'Crew: ' + crew.join(', '),
    (b.stakeholders || []).length && 'Contacts: ' + b.stakeholders.map(s => [s.name, s.role, s.phone].filter(Boolean).join(' ')).join('; '),
    (b.gear || []).length && `Equipment: ${b.gear.length} item${b.gear.length === 1 ? '' : 's'}`, b.notes && '\n' + b.notes, '\nLogi booking ' + b.id].filter(Boolean);
  return { id: b.id, uid: `logi-${b.id}@logi.app`, title: b.title + (b.client ? ' — ' + b.client : ''), allDay, start, end, location, description: lines.join('\n'), status: b.status === 'Cancelled' ? 'CANCELLED' : b.status === 'Enquiry' ? 'TENTATIVE' : 'CONFIRMED' };
}
const hashOf = e => JSON.stringify([e.title, e.allDay, e.allDay ? e.start : e.start.getTime(), e.allDay ? e.end : e.end.getTime(), e.location, e.description, e.status]);

/* --------------------------------- .ics --------------------------------- */
const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = line => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ' ' + s.slice(74); } out.push(s); return out.join('\r\n'); };
export function icsFor(bookings, name = CAL_NAME) {
  const now = utc(new Date());
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Logi//Production Deck//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(name), 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const b of bookings) {
    const e = eventOf(b);
    out.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + now, 'LAST-MODIFIED:' + utc(new Date(Number(b.updatedAt) || Date.now())),
      e.allDay ? 'DTSTART;VALUE=DATE:' + dateOnly(e.start) : 'DTSTART:' + utc(e.start), e.allDay ? 'DTEND;VALUE=DATE:' + dateOnly(e.end) : 'DTEND:' + utc(e.end),
      'SUMMARY:' + esc(e.title), e.location && 'LOCATION:' + esc(e.location), 'DESCRIPTION:' + esc(e.description), 'STATUS:' + e.status, 'END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.filter(Boolean).map(fold).join('\r\n') + '\r\n';
}
export const feedIcs = () => icsFor(activeBookings());
export const FEED_NAME = 'logi-bookings.ics';
store.setAuxWriter(() => ({ name: FEED_NAME, text: feedIcs(), type: 'text/calendar' }));

/* ------------------------------ quick links ------------------------------ */
const q = o => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''))).toString();
export const googleLink = e => 'https://calendar.google.com/calendar/render?' + q({ action: 'TEMPLATE', text: e.title, dates: e.allDay ? `${dateOnly(e.start)}/${dateOnly(e.end)}` : `${utc(e.start)}/${utc(e.end)}`, details: e.description, location: e.location });
export const outlookLink = (e, host) => `https://outlook.${host}.com/calendar/0/deeplink/compose?` + q({ path: '/calendar/action/compose', rru: 'addevent', subject: e.title, startdt: e.allDay ? e.start : e.start.toISOString(), enddt: e.allDay ? e.end : e.end.toISOString(), body: e.description, location: e.location, allday: e.allDay ? 'true' : 'false' });
export const yahooLink = e => 'https://calendar.yahoo.com/?' + q({ v: 60, title: e.title, st: e.allDay ? dateOnly(e.start) : utc(e.start), et: e.allDay ? dateOnly(e.end) : utc(e.end), desc: e.description, in_loc: e.location, dur: e.allDay ? 'allday' : null });
export const summaryText = b => { const e = eventOf(b); return [e.title, (endOf(b) > b.date ? `${fmtLong(b.date)} → ${fmtLong(endOf(b))}` : fmtLong(b.date)) + (b.start ? ` · ${b.start}${b.end ? '–' + b.end : ''}` : ''), e.location && 'Where: ' + e.location, '', e.description].filter(x => x != null && x !== false).join('\n'); };
export const mailtoLink = b => 'mailto:?' + q({ subject: `Booking: ${b.title} — ${fmtShort(b.date)}`, body: summaryText(b) }).replace(/\+/g, '%20');
const slug = s => String(s).replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'booking';
async function shareIcs(name, text, title, body) {
  const file = new File([text], name, { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ title, text: body, files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = h('a', { href: URL.createObjectURL(file), download: name }); document.body.append(a); a.click(); a.remove(); toast('Calendar file saved');
}
export const shareBooking = b => shareIcs(slug(b.title) + '.ics', icsFor([b], b.title), b.title, summaryText(b));
export const shareAll = () => shareIcs(FEED_NAME, feedIcs(), CAL_NAME, `${activeBookings().length} bookings from Logi`);

export function openAddToCalendar(b) {
  const e = eventOf(b);
  const link = (label, href) => h('a', { class: 'btn ghost', href, target: '_blank', rel: 'noopener noreferrer' }, label);
  sheet('Add to calendar', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `${e.title} · ${fmtLong(b.date)}${b.start ? ' · ' + b.start : ''}`),
    link('Google Calendar', googleLink(e)), link('Outlook.com', outlookLink(e, 'live')), link('Microsoft 365 / Office', outlookLink(e, 'office')), link('Yahoo Calendar', yahooLink(e)),
    h('button', { class: 'btn ghost', onclick: () => shareBooking(b) }, 'Apple Calendar / other (.ics file)'),
    h('a', { class: 'btn ghost', href: mailtoLink(b) }, '✉ Email the details'),
    h('p', { class: 'small muted' }, 'These add a copy of the booking once. For a calendar that updates itself, use Calendar on the Bookings page.')));
}

/* ------------------------------ two-way sync ------------------------------ */
export const calState = { status: 'idle', error: '', at: 0 }; // idle | syncing | ok | error | needs-auth
const subs = new Set(); export const onCalChange = fn => { subs.add(fn); return () => subs.delete(fn); };
const emit = () => subs.forEach(fn => fn(calState));
const setState = (status, error = '') => { calState.status = status; calState.error = error; if (status === 'ok') calState.at = Date.now(); emit(); };

// What a calendar edit means for the booking: date(s), times, title and address follow the event.
function patchFromEvent(b, r) {
  const patch = {};
  if (r.allDay) { if (r.start !== b.date) patch.date = r.start; const last = (() => { const d = parseISO(r.end); d.setDate(d.getDate() - 1); return ymd(d); })(); const endDate = last > r.start ? last : undefined; if ((b.endDate || undefined) !== endDate) patch.endDate = endDate; if (b.start) { patch.start = ''; patch.end = ''; } }
  else { const s = new Date(r.start), e = new Date(r.end); if (ymd(s) !== b.date) patch.date = ymd(s); const endDate = ymd(e) > ymd(s) ? ymd(e) : undefined; if ((b.endDate || undefined) !== endDate) patch.endDate = endDate; if (hm(s) !== (b.start || '')) patch.start = hm(s); if (hm(e) !== (b.end || '')) patch.end = hm(e); }
  const title = b.client && r.title.endsWith(' — ' + b.client) ? r.title.slice(0, -(' — ' + b.client).length) : r.title;
  if (title && title !== b.title) patch.title = title;
  if ((r.location || '') !== (b.address || '').replace(/\n/g, ', ')) patch.address = r.location || '';
  return Object.keys(patch).length ? patch : null;
}

let busy = false;
export async function syncCalendar({ interactive = false } = {}) {
  const cs = db.calSync; const ad = cs && cs.provider && ADAPTERS[cs.provider];
  if (!ad || busy) return;
  busy = true; setState('syncing');
  const mapping = { ...(cs.events || {}) }; let calendarId = cs.calendarId;
  try {
    calendarId = await ad.ensureCalendar(calendarId, interactive);
    const remote = await ad.list(calendarId, interactive);
    const byLogi = new Map(remote.filter(r => r.logiId).map(r => [r.logiId, r]));
    // adopt events another device already created, so they are updated rather than duplicated
    for (const r of remote) if (r.logiId && !mapping[r.logiId] && byId('bookings', r.logiId)) mapping[r.logiId] = { id: r.id, hash: '', at: 0 };
    // pull: edits made in the calendar since we last touched the event
    const changes = [];
    for (const [bid, m] of Object.entries(mapping)) { const r = byLogi.get(bid), b = byId('bookings', bid); if (r && b && r.updated > m.at + 2000 && r.updated > (Number(b.updatedAt) || 0)) { const p = patchFromEvent(b, r); if (p) changes.push([bid, p]); } }
    if (changes.length) update(d => { for (const [bid, p] of changes) { const b = d.bookings.find(x => x.id === bid); if (b) { Object.assign(b, p); for (const k of ['endDate', 'start', 'end']) if (b[k] === undefined || b[k] === '') delete b[k]; b.updatedAt = Date.now(); } } });
    // push
    const want = activeBookings(), wantIds = new Set(want.map(b => b.id));
    for (const b of want) {
      const e = eventOf(b), hash = hashOf(e), m = mapping[b.id];
      if (!m || !byLogi.has(b.id)) { const id = await ad.create(calendarId, e); mapping[b.id] = { id, hash, at: Date.now() }; }
      else if (m.hash !== hash) { await ad.update(calendarId, m.id, e); mapping[b.id] = { id: m.id, hash, at: Date.now() }; }
    }
    for (const [bid, m] of Object.entries(mapping)) if (!wantIds.has(bid)) { if (byLogi.has(bid)) await ad.remove(calendarId, m.id); delete mapping[bid]; }
    setState('ok');
  } catch (e) {
    setState(/auth|sign|token|consent|expired|401/i.test(e.message || '') ? 'needs-auth' : 'error', e.message || String(e));
  } finally {
    busy = false;
    update(d => { d.calSync = { ...d.calSync, calendarId, events: mapping, updatedAt: Date.now() }; });
  }
}
export function connectCalendar(provider) { update(d => { d.calSync = { ...d.calSync, provider, calendarId: null, events: {}, updatedAt: Date.now() }; }); return syncCalendar({ interactive: true }); }
export function disconnectCalendar() { ADAPTERS[db.calSync?.provider]?.signOut?.(); update(d => { d.calSync = { ...d.calSync, provider: null, calendarId: null, events: {}, updatedAt: Date.now() }; }); setState('idle'); }

// Push automatically after booking edits while a provider is connected (only when a token is already in hand).
let lastHash = '', pushTimer = null;
subscribe(() => {
  if (!db.calSync?.provider) return;
  const hsh = JSON.stringify(activeBookings().map(b => [b.id, b.updatedAt]));
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
    const token = await providers.microsoftToken(['Calendars.ReadWrite'], interactive);
    const r = await fetch(GRAPH + path, { ...init, headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: `outlook.timezone="${TZ}"` } });
    if (r.status === 401) throw new Error('Microsoft sign-in expired — tap Sync now to reconnect');
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
  signOut() { providers.microsoftSignOut(); },
};
export const ADAPTERS = { google, microsoft };

/* --------------------------------- sheet --------------------------------- */
export function calendarPanel() {
  const body = h('div', { class: 'stack' });
  const keyField = (label, get, set, ph) => h('input', { type: 'text', placeholder: ph, 'aria-label': label, value: get(), autocomplete: 'off', spellcheck: false, oninput: e => set(e.target.value) });
  const help = text => h('details', { class: 'help' }, h('summary', null, 'Setup'), h('div', { class: 'small muted' }, text));
  const copy = url => async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Select the link and copy it'); } };
  const draw = () => {
    const cs = db.calSync || {}, n = activeBookings().length, a = cloud.adapter;
    body.replaceChildren(
      h('div', { class: 'card' }, h('strong', null, 'Export once'),
        h('p', { class: 'small muted' }, `Save or share all ${n} active booking${n === 1 ? '' : 's'} as a calendar file. Any calendar app imports it.`),
        h('button', { class: 'btn ghost', onclick: shareAll }, '📤 Share bookings (.ics)')),
      h('div', { class: 'card' }, h('strong', null, 'Live feed (any calendar app)'),
        h('p', { class: 'small muted' }, 'Logi keeps a logi-bookings.ics file in your linked cloud storage up to date. Subscribe to its link once and your calendar follows every change by itself. One-way, from Logi to the calendar.'),
        !a ? h('p', { class: 'note' }, 'Link a cloud storage first (☁ at the top).')
          : [h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cs.feed, onchange: async e => { await store.setFeed(e.target.checked); draw(); } }), h('span', null, `Publish the feed to ${a.label}`)),
            cs.feed && a.id === 'file' && h('div', { class: 'stack' },
              cloud.auxName ? h('p', { class: 'small' }, `Feed file: ${cloud.auxName}. Share that file from your Dropbox / Drive / OneDrive app and use the link’s direct-download form (Dropbox: dl=1, OneDrive: ?download=1, Google Drive: drive.google.com/uc?export=download&id=…).`) : h('button', { class: 'btn ghost', onclick: async () => { try { await store.createFeedFile(); draw(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); } } }, 'Choose where to save logi-bookings.ics…')),
            cs.feed && a.id !== 'file' && h('div', { class: 'stack' },
              cloud.feedUrl ? [h('div', { class: 'link-text' }, cloud.feedUrl), h('button', { class: 'btn ghost small', onclick: copy(cloud.feedUrl) }, 'Copy subscription link')]
                : h('button', { class: 'btn ghost', onclick: async () => { try { await store.feedLink(); draw(); } catch (e) { toast(e.message); } } }, 'Get the subscription link'),
              cloud.feedError && h('div', { class: 'warn small' }, cloud.feedError)),
            cs.feed && help('Google Calendar (web): Other calendars → + → From URL → paste the link. Apple Calendar: File → New Calendar Subscription. iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar. Outlook: Add calendar → Subscribe from web. Refresh is up to the calendar: Apple lets you choose (5 min–weekly), Outlook about every 3 hours, Google up to a day.')]),
      h('div', { class: 'card' }, h('strong', null, 'Two-way sync'),
        h('p', { class: 'small muted' }, 'Keeps a “Logi bookings” calendar in your account: bookings go to it, and date, time, title or location edits made there come back into Logi.'),
        cs.provider
          ? [h('p', { class: 'status-line', 'data-state': calState.status === 'ok' ? 'synced' : calState.status === 'error' ? 'error' : '' }, `${cs.provider === 'google' ? 'Google Calendar' : 'Microsoft 365 / Outlook'} — ${calState.status}${calState.at ? ' · ' + new Date(calState.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}${calState.error ? ' (' + calState.error + ')' : ''}`),
            h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => syncCalendar({ interactive: true }) }, 'Sync now'), h('button', { class: 'btn ghost', onclick: () => { disconnectCalendar(); draw(); } }, 'Disconnect'))]
          : [h('div', { class: 'provider' }, h('strong', null, 'Google Calendar'),
              keyField('Google OAuth client ID', providers.settings.gdriveId, providers.settings.setGdriveId, 'Google OAuth client ID'),
              h('button', { class: 'btn primary', onclick: () => connectCalendar('google').then(draw) }, 'Connect Google Calendar'),
              help(`Same Google Cloud client ID as the Drive link (OAuth client, Web application, authorised JavaScript origin ${location.origin}); also enable the Google Calendar API in that project. The app only touches the calendar it creates. Google asks you to re-approve about hourly, so background pushes pause until you tap Sync now.`)),
            h('div', { class: 'provider' }, h('strong', null, 'Microsoft 365 / Outlook'),
              keyField('Microsoft application (client) ID', providers.settings.msId, providers.settings.setMsId, 'Microsoft application (client) ID'),
              h('button', { class: 'btn primary', onclick: () => connectCalendar('microsoft').then(draw) }, 'Connect Microsoft'),
              help(`Azure portal → App registrations → New: accounts in any organisational directory and personal Microsoft accounts; platform Single-page application with redirect URI ${location.origin + location.pathname}; API permission Calendars.ReadWrite (delegated). Paste the Application (client) ID. Sign-in stays refreshed in the background.`))]));
  };
  draw();
  const un1 = onCalChange(draw), un2 = store.subscribe(() => { if (document.activeElement?.tagName !== 'INPUT') draw(); });
  return { el: body, destroy: () => { un1(); un2(); } };
}
export function openCalendarSheet() { const p = calendarPanel(); sheet('Calendar & email', p.el, { onClose: p.destroy }); }

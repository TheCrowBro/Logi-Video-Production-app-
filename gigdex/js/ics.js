// Calendar files (.ics, RFC 5545) for bookings: one booking ("Add to calendar") or many ("Export calendar"). Nothing is
// sent anywhere; the file is saved or shared and the person imports it into Apple, Google or Outlook Calendar.
//
// Times are "floating" local times (no time zone): a show at 21:15 is at 21:15 wherever the phone is, which is what a
// band means. A booking starts at load-in (or the first time it has) and ends at the curfew (or the finish), rolled to
// the next day when that is past midnight. A booking with no times is an all-day event over its days.
// No money goes in: no deal, fee, rate or settlement. The description carries the times, the act and the people.
import { db, byId, lastDay } from './store.js';
import { bookingTitle, actName, venueOf, statusLabel, kindLabel, addMinutes } from './model.js';
import { parseISO, ymd, pad } from './util.js';

const CRLF = '\r\n';
const PRODID = '-//Gdex//Gdex//EN';

// TEXT values: backslash, semicolon and comma are escaped with a backslash, line breaks become \n (RFC 5545 3.3.11).
export const icsEscape = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

// Lines longer than 75 octets are folded: CRLF and a space, the space counting towards the next line's 75. Never in
// the middle of a character (UTF-8 runs of two to four octets stay together).
const enc = new TextEncoder();
export function foldLine(line) {
  const out = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of String(line)) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join(CRLF + ' ');
}

const HHMM = /^(\d{1,2}):(\d{2})$/;
const okTime = t => { const m = HHMM.exec(t || ''); return m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : ''; };
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const nextDay = iso => { const d = parseISO(iso); d.setDate(d.getDate() + 1); return ymd(d); };
const dateVal = iso => iso.replace(/-/g, '');
const local = (iso, hhmm) => `${dateVal(iso)}T${hhmm.replace(':', '')}00`;
const utcStamp = (d = new Date()) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

// The run of the day as [label, 'HH:MM'] in the order it happens (a show's off stage is the set time plus the set length).
export function runOfDay(b) {
  if (!b) return [];
  if (b.kind === 'show') {
    const off = okTime(b.setTime) && Number(b.setLength) > 0 ? addMinutes(okTime(b.setTime), Number(b.setLength)) : '';
    return [['Load-in', b.loadIn], ['Soundcheck', b.soundcheck], ['Doors', b.doors], ['On stage', b.setTime], ['Off stage', off], ['Curfew', b.curfew]].map(([l, t]) => [l, okTime(t)]).filter(x => x[1]);
  }
  return [['Start', b.start], ['Finish', b.end]].map(([l, t]) => [l, okTime(t)]).filter(x => x[1]);
}

// When the event runs: { allDay, start, end } with 'YYYY-MM-DD' (all day; end exclusive) or 'YYYYMMDDTHHMMSS' values.
export function eventWhen(b) {
  const first = b.date, last = lastDay(b);
  let start, end;
  if (b.kind === 'show') {
    start = okTime(b.loadIn) || okTime(b.soundcheck) || okTime(b.doors) || okTime(b.setTime);
    const run = runOfDay(b);
    end = okTime(b.curfew) || (run.find(x => x[0] === 'Off stage') || [])[1] || (run.length ? addMinutes(run[run.length - 1][1], 60) : '');
  } else {
    start = okTime(b.start);
    end = okTime(b.end) || (start ? addMinutes(start, 60) : '');
  }
  if (!start) return { allDay: true, start: first, end: nextDay(last) };
  // An end at or before the start is after midnight: the day after the last day (on a festival weekend too, so a
  // curfew at 00:30 ends the last night, not the one before it).
  const endDay = end <= start ? nextDay(last) : last;
  return { allDay: false, start: local(first, start), end: local(endDay, end) };
}

const STATUS = s => (s === 'cancelled' ? 'CANCELLED' : s === 'hold' || s === 'offer' ? 'TENTATIVE' : 'CONFIRMED');

function summaryOf(b) {
  const t = bookingTitle(b);
  if (b.title || b.kind === 'show' || b.kind === 'other') return t;
  return `${b.kind === 'session' ? 'Studio' : 'Rehearsal'}: ${t}`;
}

function descriptionOf(b) {
  const v = venueOf(b);
  const act = actName(b.actId);
  const c = b.contact || {};
  const people = (b.people || []).map(id => byId('people', id)).filter(Boolean).map(p => p.name + (p.role ? ` (${p.role})` : ''));
  const run = runOfDay(b).map(([l, t]) => `${l} ${t}` + (l === 'On stage' && Number(b.setLength) > 0 ? ` (${Number(b.setLength)} min set)` : ''));
  return [
    `${kindLabel(b.kind)} · ${statusLabel(b.status)}`,
    act ? 'Act: ' + act : b.client ? 'Artist: ' + b.client : '',
    run.length ? '\n' + run.join('\n') : '',
    v.name ? '\nVenue: ' + v.name : '',
    (c.name || c.phone) ? 'Contact: ' + [c.name, c.role && `(${c.role})`, c.phone].filter(Boolean).join(' ') : '',
    people.length ? '\nPeople: ' + people.join(', ') : '',
    '\nFrom Gdex',
  ].filter(Boolean).join('\n');
}

function eventLines(b, stamp) {
  if (!b || !okDate(b.date)) return [];
  const w = eventWhen(b);
  const v = venueOf(b);
  const where = [v.name, (v.address || '').replace(/\s*\n\s*/g, ', ')].filter(Boolean).join(', ');
  return [
    'BEGIN:VEVENT',
    `UID:${b.id}@gdex.crowmade.app`,
    'DTSTAMP:' + stamp,
    w.allDay ? 'DTSTART;VALUE=DATE:' + dateVal(w.start) : 'DTSTART:' + w.start,
    w.allDay ? 'DTEND;VALUE=DATE:' + dateVal(w.end) : 'DTEND:' + w.end,
    'SUMMARY:' + icsEscape(summaryOf(b)),
    where && 'LOCATION:' + icsEscape(where),
    'DESCRIPTION:' + icsEscape(descriptionOf(b)),
    'STATUS:' + STATUS(b.status),
    'END:VEVENT',
  ].filter(Boolean);
}

function calendar(list, name) {
  const stamp = utcStamp();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + PRODID, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(name),
    ...list.flatMap(b => eventLines(b, stamp)), 'END:VCALENDAR'];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// One booking as a calendar file.
export const bookingIcs = b => calendar([b], b ? bookingTitle(b) : 'Gdex');
// Many bookings (Export calendar: the upcoming ones) as one file.
export const allIcs = (bookings = db.bookings, name = 'Gdex bookings') => calendar((bookings || []).filter(Boolean), name);

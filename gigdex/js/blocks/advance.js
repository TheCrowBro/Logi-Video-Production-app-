// The advance checklist on a show (and the prep list on a session or rehearsal): the built-in lines from
// model.CHECKLISTS plus the person's own lines for that kind (db.templates[kind], shared by every booking of the kind),
// ticked per booking in booking.checks. "Email the promoter" writes the advance email: what is known, and a question
// for everything still blank.
import { h, uid, toast, fmtLong, fmtShort } from '../util.js';
import { db, update } from '../store.js';
import * as model from '../model.js';
import { openForm } from '../form.js';
import { sheetTutorial } from '../tour.js';
import { setDepositPaid } from './deal.js';

const PLURAL = { show: 'show', session: 'studio session', rehearsal: 'rehearsal', other: 'booking' };
const PREVIEW = new Set(); // bookings whose email preview is open (survives redraws)

function progressOf(b) {
  const lines = model.checklistFor(b.kind);
  return { lines, done: lines.filter(l => model.isChecked(b, l.id)).length };
}

// Tick or untick a line. "Deposit received" on a show goes through the deal, so the deal box, the settlement, the
// invoice and the Money page all see the deposit as paid (or not) too.
function tick(b, id, on) {
  if (id === 'show-deposit' && b.kind === 'show') setDepositPaid(b, on);
  else model.markCheck(b.id, id, on);
}

function addLine(kind, text) {
  const t = String(text || '').trim();
  if (!t) return false;
  update(d => {
    d.templates = d.templates && typeof d.templates === 'object' ? d.templates : {};
    const list = Array.isArray(d.templates[kind]) ? d.templates[kind] : [];
    d.templates[kind] = [...list, { id: uid(), t }];
    d.templates.updatedAt = Date.now();
  });
  return true;
}

function renameLine(kind, line) {
  openForm({
    title: 'Rename checklist line', saveLabel: 'Save',
    values: { t: line.t },
    fields: [{ key: 't', label: 'Line', required: true, hint: `It changes on every ${PLURAL[kind]}.` }],
    onSave: v => {
      const t = String(v.t || '').trim();
      if (!t) return;
      update(d => {
        const list = d.templates && Array.isArray(d.templates[kind]) ? d.templates[kind] : [];
        d.templates[kind] = list.map(x => (x && x.id === line.id ? { ...x, t } : x));
        d.templates.updatedAt = Date.now();
      });
      toast('Line renamed');
    },
  });
}

function deleteLine(kind, line) {
  if (!confirm(`Remove “${line.t}” from every ${PLURAL[kind]}’s checklist? Its ticks go too.`)) return;
  update(d => {
    const list = d.templates && Array.isArray(d.templates[kind]) ? d.templates[kind] : [];
    d.templates[kind] = list.filter(x => x && x.id !== line.id);
    d.templates.updatedAt = Date.now();
    const now = Date.now();
    d.bookings.forEach(b => { if (b.checks && b.checks[line.id]) { b.checks = { ...b.checks }; delete b.checks[line.id]; b.updatedAt = now; } });
  });
  toast('Line removed');
}

/* ------------------------------- the advance email ------------------------------- */
// Subject and body: the facts already on the booking (and its venue), then a question for each thing still blank.
export function advanceEmail(b) {
  const v = model.venueOf(b);
  const act = model.actName(b.actId) || b.client || '';
  const c = b.contact || {};
  const p = db.profile || {};
  const known = [], ask = [];
  const when = b.date ? fmtLong(b.date) + (b.endDate && b.endDate > b.date ? ` to ${fmtLong(b.endDate)}` : '') : '';
  if (when) known.push(`Date: ${when}`);
  if (act) known.push(`${b.kind === 'session' ? 'Artist' : 'Act'}: ${act}`);
  const place = [v.name, String(v.address || '').replace(/\s*\n\s*/g, ', ')].filter(Boolean).join(', ');
  if (place) known.push(`${b.kind === 'session' ? 'Studio' : 'Venue'}: ${place}`);
  if (b.kind === 'session') {
    if (b.start) known.push(`Start: ${b.start}`); else ask.push('What time can we start?');
    if (b.end) known.push(`Finish: ${b.end}`); else ask.push('What time do we need to finish by?');
    ask.push('Will there be an engineer, or are we engineering ourselves?');
    if (v.backline) known.push(`On site: ${v.backline}`); else ask.push('Which instruments, amps and mics are on site?');
    if (v.parking || b.parking) known.push(`Parking: ${b.parking || v.parking}`); else ask.push('Where do we park and load in?');
    ask.push('How will the session files be handed over (format, drive or cloud)?');
    ask.push('How and when would you like to be paid?');
  } else {
    if (b.loadIn) {
      known.push(`Load-in: ${b.loadIn}`);
      if (v.loadIn) known.push(`Load-in access: ${v.loadIn}`); else ask.push('How do we get the gear in at load-in (which door, any stairs or a lift)?');
    } else ask.push('What time is load-in, and how do we get the gear in (which door, any stairs or a lift)?');
    if (b.soundcheck) known.push(`Soundcheck: ${b.soundcheck}`); else ask.push('What time is our soundcheck?');
    if (b.doors) known.push(`Doors: ${b.doors}`); else ask.push('What time are doors?');
    const len = Number(b.setLength) > 0 ? Number(b.setLength) : 0;
    if (b.setTime) known.push(`On stage: ${b.setTime}` + (len ? ` for ${len} minutes (off stage ${model.addMinutes(b.setTime, len)})` : ''));
    else ask.push('What time are we on stage?');
    if (len && !b.setTime) known.push(`Set length: ${len} minutes`);
    if (!len) ask.push('How long is our set?');
    const curfew = b.curfew || v.curfew;
    if (curfew) known.push(`Curfew: ${curfew}`); else ask.push('What is the curfew?');
    const parking = b.parking || v.parking;
    if (parking) known.push(`Parking: ${parking}`); else ask.push('Is there parking for the van near the load-in?');
    const pa = [b.backlineProvided && `Backline: ${b.backlineProvided}`, !b.backlineProvided && v.backline && `Backline: ${v.backline}`, v.pa && `PA: ${v.pa}`].filter(Boolean);
    if (pa.length) known.push(...pa); else ask.push('What PA and backline are provided? We can send our input list and stage plot.');
    const hosp = b.hospitality || v.hospitality;
    if (hosp) known.push(`Hospitality: ${hosp}`); else ask.push('Is there hospitality or a buyout?');
    if (Number(b.guestCap) > 0) known.push(`Guest list: ${Number(b.guestCap)}`); else ask.push('What is our guest list allowance?');
    ask.push('Merch: who sells, and what is the venue’s cut?');
    ask.push('Settlement: cash or transfer, and who settles with us on the night?');
    ask.push('Is there Wi-Fi for the band?');
  }
  const first = String(c.name || '').trim().split(/\s+/)[0];
  const sign = [p.name, p.business, p.phone].filter(Boolean).join('\n');
  const what = b.kind === 'session' ? `our session${act ? ' for ' + act : ''}` : `${act || 'our show'}`;
  const subject = `${b.kind === 'session' ? 'Session' : 'Advance'}: ${model.bookingTitle(b)}${b.date ? ', ' + fmtShort(b.date) : ''}`;
  const body = [
    `Hi ${first || 'there'},`, '',
    `${b.kind === 'session' ? 'Getting ready for' : 'Advancing'} ${what}${v.name ? ' at ' + v.name : ''}${when ? ' on ' + fmtLong(b.date) : ''}. Here is what we have:`, '',
    ...known.map(x => '- ' + x), '',
    ask.length ? 'Could you let us know:' : 'Can you check this all looks right?', ...(ask.length ? ['', ...ask.map(x => '- ' + x)] : []), '',
    'Thanks,', sign || '',
  ].join('\n').replace(/\n+$/, '');
  return { subject, body, to: String(c.email || '').trim() };
}
const mailto = (to, subject, body) => 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace(/\n/g, '\r\n'));

function emailPart(b) {
  if (b.kind !== 'show' && b.kind !== 'session') return null;
  const { subject, body, to } = advanceEmail(b);
  const who = b.kind === 'show' ? 'promoter' : 'studio';
  const preview = h('details', { class: 'twirl bk-mail-preview', open: PREVIEW.has(b.id) },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '👀'), h('span', null, h('span', { class: 'twirl-name' }, 'Read the email first'), h('span', { class: 'twirl-sub' }, subject))),
    h('div', { class: 'twirl-body' }, h('pre', { class: 'bk-mail-text' }, body)));
  preview.addEventListener('toggle', () => { if (preview.open) PREVIEW.add(b.id); else PREVIEW.delete(b.id); });
  return h('div', { class: 'bk-email' },
    h('h4', null, b.kind === 'show' ? 'The advance email' : 'Email the studio'),
    h('p', { class: 'muted small' }, b.kind === 'show' ? 'What you know so far, and a question for everything still blank: load-in, parking, PA and backline, hospitality, guest list, merch, settlement, Wi-Fi.' : 'The date and times, and the questions to ask before the session.'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary small bk-mail', href: mailto(to, subject, body) }, b.kind === 'show' ? '✉ Email the promoter' : '✉ Email the studio'),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => copy(`Subject: ${subject}\n\n${body}`) }, '⧉ Copy the email')),
    !to && h('p', { class: 'muted small' }, `Add the ${who}’s email (Edit, then Contact) to send it straight to them.`),
    preview);
}
function copy(text) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return toast('Copying is not available here. Open the email instead.');
  navigator.clipboard.writeText(text).then(() => toast('Email copied'), () => toast('Could not copy. Open the email instead.'));
}

/* ------------------------------- the block ------------------------------- */
export default {
  id: 'advance', title: 'Advance checklist', icon: '✅', order: 15,
  kinds: ['show', 'session', 'rehearsal'],
  summary(b) {
    const { lines, done } = progressOf(b);
    if (!lines.length) return '';
    return done === lines.length ? `All ${lines.length} done ✓` : `${done} of ${lines.length}`;
  },
  render(b) {
    const { lines, done } = progressOf(b);
    const kind = b.kind;
    const pct = lines.length ? Math.round((done / lines.length) * 100) : 0;
    const input = h('input', { type: 'text', id: 'bk-adv-new', placeholder: 'Add your own line…', 'aria-label': `New checklist line for every ${PLURAL[kind]}`, autocomplete: 'off', maxLength: 140 });
    const add = () => { if (addLine(kind, input.value)) { toast('Line added to every ' + PLURAL[kind]); } else input.focus(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'bk-advance' },
      h('div', { class: 'bk-progress' },
        h('div', { class: 'card-row' }, h('strong', { class: 'bk-progress-text' }, `${done} of ${lines.length}`), lines.length > 0 && done === lines.length && h('span', { class: 'pill st-confirmed' }, 'All done')),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(lines.length), 'aria-valuenow': String(done), 'aria-label': 'Checklist done' }, h('i', { style: `width:${pct}%` }))),
      lines.length
        ? h('div', { class: 'checklist' }, lines.map(l => {
          const on = model.isChecked(b, l.id);
          return h('div', { class: 'check-item' + (on ? ' done' : '') + (l.own ? ' own' : ''), 'data-line': l.id },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: e => tick(b, l.id, e.target.checked) }), h('span', null, l.t)),
            l.own && h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Rename “${l.t}”`, onclick: () => renameLine(kind, l) }, '✎'),
            l.own && h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove “${l.t}”`, onclick: () => deleteLine(kind, l) }, '✕'));
        }))
        : h('p', { class: 'muted small' }, 'No lines yet. Add your own below.'),
      h('div', { class: 'row-edit bk-adv-add' }, input, h('button', { type: 'button', class: 'btn ghost small', onclick: add }, 'Add')),
      h('p', { class: 'muted small bk-adv-hint' }, `Your own lines are added to every ${PLURAL[kind]}’s checklist.`),
      emailPart(b));
  },
  tutorial: [
    { title: 'Checklist', text: 'Tick each step as it is done. Some tick themselves: sending the day sheet or an invoice, settling the night.', target: ['#blk-advance .bk-progress'] },
    { title: 'Your own lines', text: 'Add a line you always need. It shows on every booking of this kind; ✎ renames it and ✕ removes it.', target: ['#blk-advance .bk-adv-add'] },
    { title: 'The advance email', text: 'Writes the email to the promoter: what you know, and a question for everything still blank. Read it first, copy it, or open it in your mail app.', target: ['#blk-advance .bk-email'] },
  ],
};

sheetTutorial('Rename checklist line', [{ title: 'Rename', text: 'The new wording shows on every booking of this kind. Ticks stay.', target: ['[data-key="t"]'] }]);

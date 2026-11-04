// The stripboard: a shoot broken down scene by scene, one colour-coded strip per scene (white interior day, yellow
// exterior day, blue interior night, green exterior night) showing the scene number, set, time of day, cast numbers
// and page count, arranged into shooting days. Scenes come from the script (.docx, .txt, .fountain or pasted) or are
// added by hand. Strips are dragged by their handle (or moved with the arrow keys) between days; a day break strip
// ends each day and shows its total pages, as on a paper board. Loaded on first use.
import { h, sheet, toast, uid, fmtLong, fmtShort, announce, backBtn } from './util.js';
import { byId, update } from './store.js';
import { openForm } from './form.js';
import { docxToLines, textToLines, buildScript, SAMPLE_SCRIPT } from './docx.js';
import { printElement } from './callsheet.js';
import { shotsBlock } from './workflow.js';
import { boardOf, boardPlan, ieOf, dnOf, stripClass, fmtEighths, parseEighths, castNumbers, shootDayCount } from './board.js';

/* ------------------------------ script → scenes ------------------------------ */
// "12 INT. TAPROOM - NIGHT 12", "A12 EXT. LOADING BAY — CONTINUOUS", "INT./EXT. VAN - DAY #4#", "SCENE 13 - EXT. FIELD",
// Fountain's forced ".FLASHBACK".
const HEAD = /^(?:([A-Z]?\d+[A-Z]{0,2})[.)]?\s+)?(INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|INT|EXT|EST)[.:\s]\s*(.*)$/i;
const SCENE_WORD = /^SCENE\s+([A-Z]?\d+[A-Z]?)\b[\s.:—–-]*(.*)$/i;
export const isHeading = t => HEAD.test(t.replace(/^\.(?=[A-Za-z0-9])/, '')) || SCENE_WORD.test(t) || (/^\.(?!\.)[A-Za-z0-9]/.test(t) && t === t.toUpperCase());
// Words that make a part of the heading its time of day.
const TOD_WORD = /\b(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DAWN|DUSK|SUNRISE|SUNSET|NOON|MIDDAY|MIDNIGHT|TWILIGHT|MAGIC HOUR|GOLDEN HOUR|CONTINUOUS|SAME|LATER)\b/;
const LIGHT_WORD = /\b(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DAWN|DUSK|SUNRISE|SUNSET|NOON|MIDDAY|MIDNIGHT|TWILIGHT|MAGIC HOUR|GOLDEN HOUR)\b/;
// All-capitals lines that are not people: transitions, camera directions, markers.
const TRANSITION = /(^(CUT|FADE|DISSOLVE|SMASH CUT|MATCH CUT|JUMP CUT|TIME CUT|WIPE|IRIS)\b)|\bTO:$/;
// Whole words only, so real names (MORENO, SUPERVISOR, BLACKWOOD, CLOSETTE) are still cast.
const NOT_CAST = /^(?:CUT TO|FADE|DISSOLVE|SMASH|MATCH CUT|JUMP CUT|TIME CUT|WIPE|IRIS|THE END|CONTINUED|MORE|BACK TO|BACK|INTERCUT|TITLE|SUPER|CHYRON|CAPTION|FLASH ?BACK|END|LATER|MONTAGE|SERIES OF|INSERT|ANGLE|CLOSE|EXTREME|WIDE|POV|REVERSE|PRE-?LAP|OVER BLACK|BLACK|FREEZE|SPLIT SCREEN|ON SCREEN|ESTABLISHING|ACT|COLD OPEN|TEASER|TAG|CONTINUOUS|BEGIN|RESUME|SLOW MOTION|TIME LAPSE|ARCHIVE|STOCK)\b/;
// Shapes that are never a person: Fountain markup, centred text, a line ending in ':' or '<', "INSERT - X", "7 CONTINUED: 7".
const NOT_CUE = n => /^[>#=~!\[]|[:<]$|\bCONTINUED\b|\s[-–—]\s/.test(n) || /^[A-Z]?\d+[A-Z]?\s.*\s[A-Z]?\d+[A-Z]?$/.test(n);
const castName = t => t.replace(/\((?:[^)]*)\)/g, ' ').replace(/\s*\^$/, '').replace(/^@/, '').replace(/\s+/g, ' ').trim();
const castOk = (cue, n) => !/\(\s*V\.?\s*O\.?\s*\)/i.test(cue) && n.length >= 2 && n.length <= 30 && !NOT_CAST.test(n) && !NOT_CUE(n); // a voice-over is not on set
export function splitHeading(text) {
  let t = text.replace(/^\.(?=[A-Za-z0-9])/, '').trim(), num = '';
  const tag = t.match(/\s*#([\w.-]+)#\s*$/); if (tag) { num = tag[1]; t = t.slice(0, tag.index).trim(); } // Fountain scene number
  let ie = '', rest = t, m;
  if ((m = t.match(SCENE_WORD))) { num = num || m[1]; rest = m[2]; t = rest; }
  if ((m = t.match(HEAD))) { num = num || m[1] || ''; ie = m[2].toUpperCase().replace(/[\s.]+/g, ''); rest = m[3]; }
  const parts = rest.split(/\s+[-–—]+\s+|\s*[–—]\s*/);
  // The time of day is the last part that names one, with anything after it ("NIGHT - RAIN", "DAY - FLASHBACK").
  let i = parts.length - 1; while (i > 0 && !TOD_WORD.test(parts[i].toUpperCase())) i--;
  while (i > 1 && TOD_WORD.test(parts[i - 1].toUpperCase())) i--; // "NIGHT - CONTINUOUS" keeps both
  let tod = i > 0 ? parts.splice(i).join(' - ') : '';
  // A scene number repeated at the end ("… - NIGHT 12"): only after a time of day, or when it repeats the leading one.
  const strip = s => s.replace(/\s+([A-Z]?\d+[A-Z]{0,2})$/i, (all, n) => (!num || n.toUpperCase() === num.toUpperCase() ? ((num = num || n), '') : all));
  if (tod) tod = strip(tod); else if (num) parts[parts.length - 1] = strip(parts[parts.length - 1]);
  return { num, ie: ie === 'EST' ? 'EXT' : ie.replace(/^INT\/EXT|^EXT\/INT/, 'I/E'), set: parts.join(' - ').replace(/[.\s]+$/, '').trim(), tod: tod.trim().replace(/\.$/, '').toUpperCase() };
}
// Fountain and plain text: notes [[…]], the boneyard /* … */ (cut material), sections (#), synopses (=), page breaks
// (===), centred text (> … <), lyrics (~) and emphasis marks are not part of the scenes.
export function cleanScript(text) {
  return String(text || '').replace(/\r/g, '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '').replace(/\[\[[\s\S]*?(?:\]\]|$)/g, '')
    .split('\n').filter(l => !/^\s*(#|=(?!=)|={3,}\s*$)/.test(l))
    .map(l => l.replace(/^\s*>\s*(.*?)\s*<\s*$/, '$1').replace(/^\s*~\s?/, '').replace(/\*{1,3}(\S(?:[^*]*\S)?)\*{1,3}/g, '$1').replace(/(^|\s)_(\S(?:[^_]*\S)?)_(?=\s|$|[.,!?;:])/g, '$1$2'))
    .join('\n');
}
const isCue = t => { const n = t.replace(/\s*\^$/, ''); return (n.startsWith('@') || (n === n.toUpperCase() && /[A-Z]/.test(n))) && n.length <= 40 && !/[.!?:]$/.test(n.replace(/\s*\([^)]*\)\s*$/, '')) && !TRANSITION.test(n) && !isHeading(n); };
// Text and Fountain, read by paragraph (lines between blank lines), so a speech or action wrapped over several lines
// stays one paragraph, and a capitalised line on its own (a sub-heading, a camera direction) is never a speaker.
function textParas(text) {
  const raw = cleanScript(text), all = raw.split('\n').map(s => s.trim()), filled = all.filter(Boolean).length, blank = all.length - filled;
  if (blank < filled / 10) return null; // no paragraph breaks to go by: read it line by line instead
  // Paragraphs, split again at any scene heading inside one (a heading with no blank line before it).
  const out = [], blocks = raw.split(/\n[ \t]*\n/).map(b => b.split('\n').map(s => s.trim()).filter(Boolean)).filter(b => b.length)
    .flatMap(b => b.reduce((r, l, i) => { if (i && isHeading(l)) r.push([l]); else r[r.length - 1].push(l); return r; }, [[]]).filter(x => x.length));
  for (const b of blocks) {
    if (isHeading(b[0])) { out.push({ text: b[0], kind: 'heading' }); if (b.length > 1) out.push({ text: b.slice(1).join(' '), kind: 'para' }); continue; }
    if (b.length > 1 && isCue(b[0])) {
      out.push({ text: b[0], kind: 'character' }); let speech = [];
      const flush = () => { if (speech.length) out.push({ text: speech.join(' '), kind: 'dialogue' }); speech = []; };
      for (const l of b.slice(1)) { if (/^\(.*\)$/.test(l)) { flush(); out.push({ text: l, kind: 'paren' }); } else speech.push(l); }
      flush(); continue;
    }
    const t = b.join(' '); out.push({ text: t, kind: b.length === 1 && TRANSITION.test(t) ? 'transition' : 'para' });
  }
  return out;
}
// Word files: a screenplay's own paragraph styles (Scene Heading, Character, Dialogue…) when it has them; otherwise
// the general classification of js/docx.js, with every real scene heading marked first so a numbered heading is
// never taken for a speaker. A soft line break inside a paragraph splits a heading from what follows it.
const STYLE = [[/scene.?head|slug/i, 'heading'], [/^char/i, 'character'], [/dialog/i, 'dialogue'], [/paren/i, 'paren'], [/transition/i, 'transition'], [/action|general|descr|shot/i, 'para']];
function lineParas(lines) {
  lines = lines.flatMap(l => {
    const parts = String(l.text || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return [];
    if (parts.length > 1 && isHeading(parts[0])) return [{ ...l, text: parts[0] }, { text: parts.slice(1).join(' '), heading: false, style: '' }];
    if (parts.length > 1 && isCue(parts[0])) return [{ ...l, text: parts[0], heading: false }, { text: parts.slice(1).join(' '), heading: false, style: /^char/i.test(l.style || '') ? 'Dialogue' : '' }];
    return [{ ...l, text: parts.join(' ') }];
  });
  const styled = lines.map(l => { const hit = STYLE.find(([re]) => re.test(l.style || '')); return hit && hit[1]; });
  if (styled.filter(Boolean).length > lines.length / 3) return lines.map((l, i) => ({ text: l.text, kind: isHeading(l.text) ? 'heading' : styled[i] || 'para' }));
  const anyReal = lines.some(l => isHeading(l.text));
  return buildScript('script', lines.map(l => ({ ...l, heading: anyReal ? isHeading(l.text) : l.heading && !/^ACT\b/i.test(l.text) }))).paras.map(p => ({ text: p.text, kind: p.kind }));
}
// Screen lines each paragraph takes in a standard screenplay layout (about 55 to a page), for an estimated page count.
// The blank line before a speaker's name is already counted by the paragraph before it.
const LINES = { heading: () => 2, para: t => Math.ceil(t.length / 58) + 1, character: () => 1, paren: t => Math.ceil(t.length / 25), dialogue: t => Math.ceil(t.length / 35) + 1, transition: () => 2 };
// Reads a script (text, Fountain, or the paragraphs of a Word file) into scenes: number, interior or exterior, set,
// time of day, a one-line description, the cast and an estimated page count. Text before the first scene heading
// (the title page, notes) is left out.
// Text with no blank lines (a copy from a PDF, say) is wrapped line by line: a line that carries on a sentence joins it.
const unwrap = paras => paras.reduce((out, p) => { const q = out[out.length - 1]; if (q && p.kind === 'para' && (q.kind === 'dialogue' || q.kind === 'para') && !/[.!?:;…"'”’)\]—-]$/.test(q.text)) q.text += ' ' + p.text; else out.push({ ...p }); return out; }, []);
export function parseScenes(src) {
  const paras = typeof src === 'string' ? textParas(src) || unwrap(lineParas(textToLines(cleanScript(src)))) : lineParas(src);
  const scenes = []; let cur = null, lastDn = '';
  paras.forEach((p, i) => {
    if (p.kind === 'heading') {
      const s = splitHeading(p.text);
      cur = { id: uid(), type: 'scene', scene: s.num, ie: s.ie, set: s.set, tod: s.tod, dn: '', desc: '', cast: [], eighths: 0, notes: '', lines: LINES.heading(), action: '' };
      // "CONTINUOUS", "LATER", "SAME" with no light of its own: the strip keeps the colour of the scene before it.
      if (/\b(CONTINUOUS|SAME|LATER)\b/.test(cur.tod) && !LIGHT_WORD.test(cur.tod) && lastDn) cur.dn = lastDn === 'night' ? 'N' : 'D';
      lastDn = dnOf(cur); scenes.push(cur); return;
    }
    if (!cur) return;
    cur.lines += (LINES[p.kind] || LINES.para)(p.text);
    const next = paras[i + 1];
    if (p.kind === 'character') { const n = castName(p.text).toUpperCase(); if (castOk(p.text, n) && next && (next.kind === 'dialogue' || next.kind === 'paren') && !cur.cast.includes(n)) cur.cast.push(n); }
    else if (p.kind === 'para') { cur.action += ' ' + p.text; if (!cur.desc) cur.desc = p.text.length > 140 ? p.text.slice(0, 140).replace(/\s+\S*$/, '') + '…' : p.text; }
  });
  // Cast who are in a scene without speaking: a known character's name written in the scene's action.
  const known = [...new Set(scenes.flatMap(s => s.cast))].filter(n => n.length >= 3 && /^[A-Z][A-Z' .-]*$/.test(n));
  const caseless = n => n.charAt(0) + n.slice(1).toLowerCase(), esc = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  scenes.forEach(s => { for (const n of known) if (!s.cast.includes(n) && new RegExp(`\\b(?:${esc(n)}|${esc(caseless(n))})\\b`).test(s.action)) s.cast.push(n); });
  scenes.forEach(s => { s.eighths = Math.max(1, Math.round(s.lines / 55 * 8)); delete s.lines; delete s.action; });
  return scenes;
}
// The cast in billing order: most scenes first, then first appearance.
const castOrder = scenes => { const seen = new Map(); scenes.forEach((s, i) => s.cast.forEach(n => { const c = seen.get(n) || { n, count: 0, first: i }; c.count++; seen.set(n, c); })); return [...seen.values()].sort((a, b) => b.count - a.count || a.first - b.first).map(c => c.n); };

/* ---------------------------------- saving ---------------------------------- */
function saveBoard(b, fn) {
  update(d => {
    const x = d.bookings.find(y => y.id === b.id); if (!x) return;
    const bd = boardOf(x); fn(bd);
    x.board = { list: bd.list, cast: bd.cast, updatedAt: Date.now() }; x.updatedAt = Date.now();
  });
}
const current = b => byId('bookings', b.id) || b;
// The strip control that had the keyboard focus (a handle or a strip), so it gets it back after each redraw.
const UI = { focus: null };
const focusNeighbour = (b, id) => { const l = boardOf(current(b)).list, i = l.findIndex(x => x.id === id), n = l[i + 1] || l[i - 1]; UI.focus = n ? 'h' + n.id : 'add'; };
const dayOfItem = (plan, id) => { const d = plan.days.find(x => x.items.some(i => i.id === id)); return d ? d.n : 0; };
// Moves an item to the end of a day (0: unscheduled), keeping everything else in order.
function moveToDay(list, id, n) {
  const item = list.find(x => x.id === id); if (!item) return list;
  const rest = list.filter(x => x.id !== id), breaks = rest.map((x, i) => (x.type === 'break' ? i : -1)).filter(i => i >= 0);
  const at = n > 0 && breaks[n - 1] != null ? breaks[n - 1] : rest.length;
  rest.splice(at, 0, item); return rest;
}
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

/* ---------------------------------- forms ---------------------------------- */
const TODS = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'CONTINUOUS', 'LATER'];
function dayOptions(b) { const plan = boardPlan(current(b)); return [...plan.days.map(d => [String(d.n), `Day ${d.n}${d.date ? ' · ' + fmtShort(d.date) : ''}`]), ['0', 'Not scheduled yet']]; }
function editScene(b, scene) {
  b = current(b);
  const plan = boardPlan(b), isNew = !scene, nextNum = String((Math.max(0, ...plan.scenes.map(s => parseInt(s.scene, 10)).filter(Number.isFinite)) || 0) + 1);
  const values = scene ? { ...scene, cast: scene.cast.join(', '), pages: fmtEighths(scene.eighths), day: String(dayOfItem(plan, scene.id)) } : { scene: nextNum, ie: 'INT', set: '', tod: 'DAY', dn: '', desc: '', cast: '', pages: '1/8', day: '0', notes: '' };
  const sets = [...new Set(plan.scenes.map(s => s.set).filter(Boolean))];
  openForm({
    title: isNew ? 'Add a scene' : `Scene ${scene.scene || ''}`.trim(),
    values,
    fields: [
      { key: 'scene', label: 'Scene number', placeholder: 'e.g. 12 or 12A' },
      { key: 'ie', label: 'Interior or exterior', type: 'select', options: [['INT', 'Interior (INT)'], ['EXT', 'Exterior (EXT)'], ['I/E', 'Both (INT/EXT)']] },
      { key: 'set', label: 'Set or location', placeholder: 'e.g. HARBOUR TAPROOM', list: sets },
      { key: 'tod', label: 'Time of day', placeholder: 'DAY, NIGHT, DAWN…', list: TODS },
      { key: 'dn', label: 'Strip colour', type: 'select', options: [['', 'From the time of day'], ['D', 'Day'], ['N', 'Night']], hint: 'White interior day, yellow exterior day, blue interior night, green exterior night.' },
      { key: 'desc', label: 'What happens', type: 'textarea', rows: 2, placeholder: 'One line, as on the strip' },
      { key: 'cast', label: 'Cast in the scene', placeholder: 'Names, separated by commas', hint: plan.cast.length ? 'Cast numbers on the strip: ' + plan.cast.slice(0, 12).map((n, i) => `${i + 1} ${n}`).join(', ') + (plan.cast.length > 12 ? '…' : '') : 'Each name gets a number on the strips, in the order of the cast list.' },
      { key: 'pages', label: 'Pages', placeholder: '1 3/8', hint: 'In eighths of a page: 3/8, 1, 1 4/8…' },
      { key: 'day', label: 'Shooting day', type: 'select', options: dayOptions(b) },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Props, effects, extras, stunts… (stays on this board)' },
    ],
    saveLabel: isNew ? 'Add' : 'Save',
    onSave: v => {
      const e = parseEighths(v.pages); if (e == null) toast('Pages not understood, so they were left as they were: use eighths, like 1 3/8');
      const cast = [...new Set(String(v.cast || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
      const next = { ...(scene || { id: uid(), type: 'scene' }), scene: v.scene.trim(), ie: v.ie, set: v.set.trim().toUpperCase(), tod: v.tod.trim().toUpperCase(), dn: v.dn, desc: v.desc.trim(), cast, eighths: e == null ? (scene ? scene.eighths : 1) : e, notes: v.notes.trim() };
      saveBoard(b, bd => {
        bd.cast = [...bd.cast, ...cast.filter(n => !bd.cast.includes(n))];
        const i = bd.list.findIndex(x => x.id === next.id);
        if (i >= 0) bd.list[i] = next; else bd.list.push(next);
        const want = Number(v.day) || 0; if (isNew || want !== dayOfItem(boardPlan({ ...b, board: { list: bd.list } }), next.id)) bd.list = moveToDay(bd.list, next.id, want);
      });
      toast(isNew ? 'Scene added' : 'Scene saved'); UI.focus = 'b' + next.id;
    },
    onDelete: scene ? () => { focusNeighbour(b, scene.id); saveBoard(b, bd => { bd.list = bd.list.filter(x => x.id !== scene.id); }); toast('Scene removed'); } : null,
  });
}
function editBanner(b, banner) {
  openForm({
    title: banner ? 'Banner' : 'Add a banner',
    values: banner || { text: '', day: '0' },
    fields: [{ key: 'text', label: 'Banner text', required: true, placeholder: 'e.g. Company move to the harbour · Lunch · Night shoot' }, ...(banner ? [] : [{ key: 'day', label: 'Shooting day', type: 'select', options: dayOptions(b) }])],
    saveLabel: banner ? 'Save' : 'Add',
    onSave: v => {
      const next = { ...(banner || { id: uid(), type: 'banner' }), text: v.text.trim() };
      saveBoard(b, bd => { const i = bd.list.findIndex(x => x.id === next.id); if (i >= 0) bd.list[i] = next; else { bd.list.push(next); bd.list = moveToDay(bd.list, next.id, Number(v.day) || 0); } });
      UI.focus = 'b' + next.id;
    },
    onDelete: banner ? () => { focusNeighbour(b, banner.id); saveBoard(b, bd => { bd.list = bd.list.filter(x => x.id !== banner.id); }); } : null,
  });
}
function editCast(b) {
  const body = h('div', { class: 'stack' });
  // After a move or a rename the list is drawn again; the keyboard focus goes back to the same person's button.
  const draw = (focusName, which) => {
    const plan = boardPlan(current(b)), count = n => plan.scenes.filter(s => s.cast.includes(n)).length;
    const move = (n, d) => { saveBoard(b, bd => { const i = bd.cast.indexOf(n), j = i + d; if (i < 0 || j < 0 || j >= bd.cast.length) return; [bd.cast[i], bd.cast[j]] = [bd.cast[j], bd.cast[i]]; }); setTimeout(() => draw(n, d < 0 ? 'up' : 'down')); };
    const rename = n => openForm({ title: `Rename ${n}`, values: { name: n }, fields: [{ key: 'name', label: 'Name', required: true, hint: 'Changes every scene they are in. A name already on the list joins the two.' }],
      onSave: v => { const to = String(v.name || '').trim().toUpperCase(); if (!to || to === n) return; saveBoard(b, bd => { bd.cast = bd.cast.includes(to) ? bd.cast.filter(x => x !== n) : bd.cast.map(x => (x === n ? to : x)); bd.list.forEach(x => { if (x.type === 'scene') x.cast = [...new Set(x.cast.map(c => (c === n ? to : c)))]; }); }); setTimeout(() => draw(to, 'name')); } });
    const drop = n => { if (!confirm(`Take ${n} off the cast list and out of every scene?`)) return; const l = plan.cast, i = l.indexOf(n), next = l[i + 1] || l[i - 1]; saveBoard(b, bd => { bd.cast = bd.cast.filter(x => x !== n); bd.list.forEach(x => { if (x.type === 'scene') x.cast = x.cast.filter(c => c !== n); }); }); setTimeout(() => draw(next, 'x')); };
    body.replaceChildren(
      h('p', { class: 'small muted' }, 'Each person\'s number is the one printed on the strips. Move someone up or down to renumber them; renaming changes every scene they are in; ✕ takes a name that is not a person (a camera direction, a sound) off the list.'),
      plan.cast.length ? h('ol', { class: 'sb-cast-list' }, plan.cast.map((n, i) => h('li', { class: 'card-row', 'data-name': n },
        h('span', null, h('b', null, `${i + 1}  ${n}`), h('span', { class: 'muted small' }, ` · ${count(n)} scene${count(n) === 1 ? '' : 's'}`)),
        h('span', { class: 'actions' },
          h('button', { class: 'icon-btn', 'data-k': 'up', 'aria-label': `Move ${n} up`, disabled: i === 0, onclick: () => move(n, -1) }, '↑'),
          h('button', { class: 'icon-btn', 'data-k': 'down', 'aria-label': `Move ${n} down`, disabled: i === plan.cast.length - 1, onclick: () => move(n, 1) }, '↓'),
          h('button', { class: 'btn ghost small', 'data-k': 'name', onclick: () => rename(n) }, 'Rename'),
          h('button', { class: 'icon-btn', 'data-k': 'x', 'aria-label': `Take ${n} off the cast list`, onclick: () => drop(n) }, '✕')))))
        : h('p', { class: 'muted' }, 'No cast yet: they come from the script\'s character names, or from the scenes you add.'));
    if (focusName) { const row = [...body.querySelectorAll('li[data-name]')].find(r => r.dataset.name === focusName); const btn = row && (row.querySelector(`[data-k="${which}"]:not([disabled])`) || row.querySelector('[data-k]:not([disabled])')); if (btn) btn.focus(); }
  };
  draw(); sheet('Cast list', body);
}

/* ---------------------------------- import ---------------------------------- */
function openImport(b) {
  let close = () => {};
  const status = h('p', { class: 'small muted', role: 'status' });
  const use = (name, src) => {
    const scenes = parseScenes(src);
    if (!scenes.length) { status.textContent = `No scene headings found in ${name}. Scenes start with INT. or EXT. (for example "INT. KITCHEN - NIGHT").`; return; }
    const had = boardPlan(current(b)).scenes.length, apply = mode => {
      saveBoard(b, bd => {
        if (mode === 'replace') bd.list = bd.list.filter(x => x.type === 'break');
        // Scenes without a number continue after every number already in use, the board's and the script's own.
        const nums = [...bd.list.filter(x => x.type === 'scene'), ...scenes].map(x => parseInt(String(x.scene).replace(/^[A-Z]/i, ''), 10)).filter(Number.isFinite);
        let n = nums.length ? Math.max(...nums) : 0;
        scenes.forEach(s => { if (!s.scene) s.scene = String(++n); });
        bd.list.push(...scenes);
        bd.cast = [...(mode === 'replace' ? [] : bd.cast), ...castOrder(scenes)].filter((x, i, a) => a.indexOf(x) === i);
        if (mode === 'replace') { const used = new Set(scenes.flatMap(s => s.cast)); bd.cast = bd.cast.filter(x => used.has(x)); }
      });
      close(); toast(`${scenes.length} scene${scenes.length === 1 ? '' : 's'} added from ${name}, waiting under Not scheduled yet`);
    };
    if (!had) return apply('add');
    status.replaceChildren(`${scenes.length} scenes found in ${name}. The board already has ${had}: `,
      h('button', { class: 'btn ghost small', onclick: () => { if (confirm('Replace every scene on the board with the ones from this script? Banners and scheduling of the old scenes are lost.')) apply('replace'); } }, 'Replace them'), ' ',
      h('button', { class: 'btn primary small', onclick: () => apply('add') }, 'Add to the end'));
  };
  const fail = e => { status.textContent = 'Could not read that file: ' + (e.message || e); };
  const file = h('input', { type: 'file', accept: '.docx,.txt,.fountain,.md,.text,text/plain', 'aria-label': 'Script file', onchange: async e => {
    const f = e.target.files[0]; if (!f) return; status.textContent = 'Reading…';
    try { use(f.name, /\.docx$/i.test(f.name) ? await docxToLines(f) : await f.text()); } catch (err) { fail(err); }
  } });
  const paste = h('textarea', { rows: 5, placeholder: 'Or paste the script text here', 'aria-label': 'Pasted script text' });
  ({ close } = sheet('Scenes from a script', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'Pick the script: a Word file (.docx), Fountain, or plain text. Each scene heading (INT. / EXT. … - DAY or NIGHT) becomes a strip, with the characters who speak or are named in the action as its cast, and an estimated page count. Notes and cut scenes in a Fountain file are left out. Check the cast and the page counts: a script laid out differently from the standard counts differently.'),
    h('label', { class: 'btn primary file-btn' }, '📄 Choose a script file', file),
    paste, h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => { paste.value.trim() ? use('the pasted text', paste.value) : (status.textContent = 'Nothing pasted yet.'); } }, 'Use the pasted text'),
      h('button', { class: 'btn ghost small', onclick: () => use('the sample script', SAMPLE_SCRIPT) }, 'Try a sample script')),
    status)));
}

/* ------------------------------ shot list import ------------------------------ */
// A shot list as people write them: one shot per line, with the scene it belongs to as a heading above its shots
// ("INT. KITCHEN - DAY", "Scene 12", "12 EXT. QUAY - DUSK"). List marks and numbering in front of a shot are dropped.
// Shots before any heading, or in a list with no headings, are unsorted.
// A spreadsheet export (.csv): a header row names the columns and each later row is one shot. The description column
// (or the longest cell) is the shot; a Scene column groups the shots, by number or by slugline; Size and Move columns
// go in front of the description. Anything that does not look like that is read line by line below.
const csvRow = line => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(c => c.trim()); };
const COLUMNS = ['scene', 'sc', 'slugline', 'slug', 'shot', 'description', 'desc', 'action', 'what', 'notes', 'size', 'shot size', 'type', 'angle', 'move', 'movement', 'camera', 'lens', 'take', 'time', 'duration', 'sound', 'location', 'set', 'no', 'number', '#', 'done'];
function parseShotCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const rows = lines.map(csvRow), n = rows[0].length, head = rows[0].map(c => c.toLowerCase());
  if (n < 2 || rows.filter(r => r.length === n).length < rows.length * 0.8 || head.some(c => /\d/.test(c) || c.length > 24) || !head.some(c => COLUMNS.includes(c))) return null;
  const find = names => head.findIndex(c => names.includes(c));
  const iDesc = find(['description', 'desc', 'action', 'what', 'shot description', 'notes']), iScene = find(['scene', 'sc', 'slugline', 'slug']), iSize = find(['size', 'shot size', 'type', 'shot type']), iMove = find(['move', 'movement', 'camera', 'camera move']);
  const scenes = [], loose = [], byKey = new Map();
  for (const r of rows.slice(1)) {
    const desc = iDesc >= 0 ? r[iDesc] : r.reduce((a, c, i) => (i !== iScene && c.length > a.length ? c : a), '');
    const front = [iSize >= 0 && r[iSize], iMove >= 0 && r[iMove]].filter(Boolean).join(', ');
    const shot = [front, desc].filter(Boolean).join(': ');
    if (!shot) continue;
    const sc = iScene >= 0 ? r[iScene] : '';
    if (!sc) { loose.push(shot); continue; }
    let cur = byKey.get(sc.toLowerCase());
    if (!cur) { const hd = isHeading(sc) ? splitHeading(sc) : { num: sc.replace(/^(?:scene|sc\.?)\s*/i, ''), ie: '', set: '', tod: '' }; cur = { num: hd.num, ie: hd.ie, set: hd.set, tod: hd.tod, shots: [] }; byKey.set(sc.toLowerCase(), cur); scenes.push(cur); }
    cur.shots.push(shot);
  }
  return { scenes, loose };
}
export function parseShotList(text) {
  const csv = parseShotCsv(text); if (csv) return csv;
  const scenes = [], loose = []; let cur = null;
  for (const raw of cleanScript(text).split('\n')) {
    const t = raw.trim(); if (!t) continue;
    if (isHeading(t)) { const s = splitHeading(t); cur = { num: s.num, ie: s.ie, set: s.set, tod: s.tod, shots: [] }; scenes.push(cur); continue; }
    // List marks and shot numbers go ("3.", "(3)", "b)", "Shot 4a:"), but not a capital initial ("A. Ruiz") or a resolution ("4K - wide").
    const shot = t.replace(/^(?:[-*•–—]|\d{1,3}[.)]|\(\d{1,3}\)|[a-z][.)])\s+/, '').replace(/^(?:shot\s+)?\d{1,3}(?:(?![kK])[a-z])?\s*[:.-]\s+/i, '').trim();
    if (!shot) continue;
    (cur ? cur.shots : loose).push(shot);
  }
  return { scenes, loose };
}
// Puts the shots on the booking and the scene headings on the board: a heading whose number the board already has
// attaches its shots to that scene; a new one becomes a strip under Not scheduled yet, marked for a check (a shot list
// says nothing about pages, and often nothing about the time of day).
export function applyShotImport(b, parsed) {
  let added = { shots: 0, scenes: 0 };
  const done = update(d => {
    const x = d.bookings.find(y => y.id === b.id); if (!x) return;
    const bd = boardOf(x), have = new Set(bd.list.filter(s => s.type === 'scene').map(s => String(s.scene)));
    let next = Math.max(0, ...[...have].map(n => parseInt(String(n).replace(/^[A-Z]/i, ''), 10)).filter(Number.isFinite)) + 1;
    x.shots = [...(x.shots || [])];
    for (const sc of parsed.scenes) {
      let num = String(sc.num || '').trim();
      // A heading with no number is matched to a scene the board already has (same INT/EXT, set and time of day) before it gets a number of its own.
      if (!num) { const same = bd.list.find(s => s.type === 'scene' && (s.ie || 'INT').toUpperCase() === (sc.ie || 'INT').toUpperCase() && (s.set || '').trim().toLowerCase() === (sc.set || '').trim().toLowerCase() && (!sc.tod || !s.tod || String(s.tod).toUpperCase() === String(sc.tod).toUpperCase())); num = same ? String(same.scene) : String(next++); }
      if (!have.has(num)) { bd.list.push({ id: uid(), type: 'scene', scene: num, ie: sc.ie || 'INT', set: sc.set || '', tod: sc.tod || 'DAY', dn: '', desc: sc.shots[0] || '', cast: [], eighths: 1, notes: 'From the shot list: check the time of day and the pages.' }); have.add(num); added.scenes++; }
      for (const text of sc.shots) { x.shots.push({ id: uid(), text, done: false, scene: num }); added.shots++; }
    }
    for (const text of parsed.loose) { x.shots.push({ id: uid(), text, done: false }); added.shots++; }
    if (added.scenes) { x.board = { list: bd.list, cast: bd.cast, updatedAt: Date.now() }; x.shotImportReview = { at: Date.now(), scenes: (x.shotImportReview ? x.shotImportReview.scenes : 0) + added.scenes }; }
    x.updatedAt = Date.now();
  });
  return done === false ? null : added; // false: Vdex is read-only, and has already said so
}
export function openShotImport(b) {
  let close = () => {};
  const status = h('p', { class: 'small muted', role: 'status' });
  const use = (name, text) => {
    const parsed = parseShotList(text), n = parsed.scenes.reduce((t, s) => t + s.shots.length, 0) + parsed.loose.length;
    if (!n && !parsed.scenes.length) { status.textContent = `Nothing found in ${name}. One shot per line; put each scene's heading (INT. KITCHEN - DAY, or Scene 12) above its shots.`; return; }
    const added = applyShotImport(b, parsed);
    if (!added) return;
    close();
    toast(added.scenes ? `${added.shots} shot${added.shots === 1 ? '' : 's'} added, and ${added.scenes} scene${added.scenes === 1 ? '' : 's'} put on the stripboard: check them` : `${added.shots} shot${added.shots === 1 ? '' : 's'} added`);
  };
  const fail = e => { status.textContent = 'Could not read that file: ' + (e.message || e); };
  const file = h('input', { type: 'file', accept: '.docx,.txt,.csv,.md,.fountain,.text,text/plain,text/csv', 'aria-label': 'Shot list file', onchange: async e => {
    const f = e.target.files[0]; if (!f) return; status.textContent = 'Reading…';
    try { use(f.name, /\.docx$/i.test(f.name) ? (await docxToLines(f)).map(l => l.text).join('\n') : await f.text()); } catch (err) { fail(err); }
  } });
  const paste = h('textarea', { rows: 7, placeholder: 'INT. KITCHEN - DAY\nWide: Ana at the stove\nClose-up: hands on the kettle\n\nScene 12\nTracking shot along the quay', 'aria-label': 'Pasted shot list' });
  ({ close } = sheet('Import a shot list', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'One shot per line, from a file (text, CSV, Word) or pasted. Put each scene’s heading above its shots (INT. KITCHEN - DAY, or Scene 12) and Vdex groups the shots by scene and adds any scene the stripboard does not have yet. Shots with no heading above them go under Unsorted.'),
    h('p', { class: 'warn small' }, '⚠ Scenes made this way need a check afterwards: a shot list has no page counts (they are set to 1/8), and the time of day, interior or exterior are guessed where the heading leaves them out.'),
    h('label', { class: 'btn primary file-btn' }, '📄 Choose a file', file),
    paste, h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => { paste.value.trim() ? use('the pasted text', paste.value) : (status.textContent = 'Nothing pasted yet.'); } }, 'Add these shots')),
    status)));
}

/* ------------------------------ arranging tools ------------------------------ */
// Spreads the scenes, in their current order, over the shooting days so each day has about the same number of pages.
function spread(b) {
  const plan = boardPlan(current(b)), days = plan.days.length;
  if (!plan.scenes.length) return toast('Add scenes first');
  if (!days) return toast('Add a shooting day first');
  if (plan.days.some(d => d.scenes) && !confirm(`Spread all ${plan.scenes.length} scenes over the ${days} shooting day${days === 1 ? '' : 's'}, keeping their order, so each day has about the same number of pages?`)) return;
  saveBoard(b, bd => {
    const breaks = bd.list.filter(x => x.type === 'break'), items = bd.list.filter(x => x.type !== 'break'), total = items.reduce((t, x) => t + (x.type === 'scene' ? x.eighths : 0), 0);
    const out = []; let sum = 0, k = 0;
    for (const x of items) {
      // A day ends before or after a scene, whichever lands nearer the even share.
      if (x.type === 'scene' && k < days - 1) { const target = total * (k + 1) / days; if (sum > 0 && sum + x.eighths > target && target - sum < sum + x.eighths - target) out.push(breaks[k++]); }
      out.push(x); if (x.type === 'scene') sum += x.eighths;
      while (k < days - 1 && sum >= total * (k + 1) / days) out.push(breaks[k++]);
    }
    while (k < days) out.push(breaks[k++]);
    bd.list = out;
  });
  toast(`Spread over ${days} day${days === 1 ? '' : 's'}: about ${fmtEighths(Math.round(plan.eighths / days))} pages each`);
}
// Groups the unscheduled scenes by set, then interior or exterior, then day or night, then scene number.
function sortPool(b) {
  const plan = boardPlan(current(b)); if (plan.unscheduled < 2) return toast('Nothing to sort: fewer than two scenes are unscheduled');
  saveBoard(b, bd => {
    const lastBreak = bd.list.map(x => x.type).lastIndexOf('break'), head = bd.list.slice(0, lastBreak + 1), pool = bd.list.slice(lastBreak + 1);
    const scenes = pool.filter(x => x.type === 'scene').sort((x, y) => natural(x.set, y.set) || natural(ieOf(x), ieOf(y)) || natural(dnOf(x), dnOf(y)) || natural(x.scene, y.scene));
    bd.list = [...head, ...scenes, ...pool.filter(x => x.type !== 'scene')];
  });
  toast('Unscheduled scenes grouped by location');
}
const addDay = b => { saveBoard(b, bd => { const last = bd.list.map(x => x.type).lastIndexOf('break'); bd.list.splice(last + 1, 0, { id: uid(), type: 'break' }); }); toast('Shooting day added'); };
const removeBreak = (b, id, n, last) => { if (!confirm(`Remove day ${n}? ${last ? 'Its scenes go back to Not scheduled yet.' : 'Its scenes join the next day.'}`)) return; focusNeighbour(b, id); saveBoard(b, bd => { bd.list = bd.list.filter(x => x.id !== id); }); };
// Day breaks for the booking's days the board does not have yet (the booking grew after the board was made).
const addMissingDays = (b, n) => { saveBoard(b, bd => { for (let i = 0; i < n; i++) { const last = bd.list.map(x => x.type).lastIndexOf('break'); bd.list.splice(last + 1, 0, { id: uid(), type: 'break' }); } }); toast(`${n} shooting day${n === 1 ? '' : 's'} added`); };

/* ---------------------------------- print ---------------------------------- */
function boardDoc(b) {
  const plan = boardPlan(b), cast = plan.cast, used = new Set(plan.scenes.flatMap(x => x.cast));
  const row = x => (x.type === 'scene'
    ? h('tr', { class: 'sb-row ' + stripClass(x) }, h('td', null, x.scene), h('td', null, ieOf(x)), h('td', null, h('b', null, x.set), x.desc && h('div', null, x.desc)), h('td', null, x.tod || dnOf(x).toUpperCase()), h('td', null, castNumbers(x.cast, cast).join(', ')), h('td', null, fmtEighths(x.eighths)))
    : h('tr', { class: 'sb-row sb-banner' }, h('td', { colspan: 6 }, x.text)));
  const table = items => h('table', null, h('thead', null, h('tr', null, ...['Sc', 'I/E', 'Set', 'Time', 'Cast', 'Pages'].map(t => h('th', null, t)))), h('tbody', null, items.map(row)));
  return h('article', { class: 'cs-doc sb-doc' },
    h('header', { class: 'cs-head' }, h('div', null, h('div', { class: 'cs-brand' }, b.title), h('div', { class: 'cs-kicker' }, 'STRIPBOARD')), h('div', { class: 'cs-when' }, h('b', null, `${plan.scenes.length} scenes · ${fmtEighths(plan.eighths)} pages`), h('div', null, `${plan.days.length} shooting day${plan.days.length === 1 ? '' : 's'}`))),
    ...plan.days.map(d => h('section', { class: 'cs-sec' }, h('h4', null, `Day ${d.n} of ${d.of}${d.date ? ' · ' + fmtLong(d.date) : ''} · ${fmtEighths(d.eighths)} pages`), d.items.length ? table(d.items) : h('p', null, 'Nothing scheduled.'))),
    plan.pool.length > 0 && h('section', { class: 'cs-sec' }, h('h4', null, `Not scheduled yet · ${plan.unscheduled} scene${plan.unscheduled === 1 ? '' : 's'}`), table(plan.pool)),
    used.size > 0 && h('section', { class: 'cs-sec' }, h('h4', null, 'Cast'), h('p', null, cast.map((n, i) => (used.has(n) ? `${i + 1} ${n}` : '')).filter(Boolean).join(' · '))),
    h('footer', { class: 'cs-foot' }, `Made with Vdex on ${new Date().toLocaleDateString()}`));
}

/* ----------------------------------- page ----------------------------------- */
const LEGEND = [['sb-int-day', 'INT · day'], ['sb-ext-day', 'EXT · day'], ['sb-int-night', 'INT · night'], ['sb-ext-night', 'EXT · night']];
const liveBoard = () => document.querySelector('.sb-page .sb-board');
const tod = x => x.tod || (dnOf(x) === 'night' ? 'NIGHT' : 'DAY');
export function stripboardPage(b, go) {
  b = current(b);
  const plan = boardPlan(b), cast = plan.cast, list = h('ol', { class: 'sb-board', 'aria-label': 'Stripboard, in shooting order' });
  const dayN = x => { const i = plan.list.filter(y => y.type === 'break').findIndex(y => y.id === x.id); return i + 1; };
  const label = x => (x.type === 'scene' ? `scene ${x.scene || 'without a number'}${x.set ? ', ' + x.set : ''}` : x.type === 'banner' ? `banner ${x.text}` : `end of day ${dayN(x)}`);
  const save = ids => { const before = plan.list.map(x => x.id).join(); if (ids.join() === before) return false; saveBoard(b, bd => { const map = new Map(bd.list.map(x => [x.id, x])), next = ids.map(id => map.get(id)).filter(Boolean); bd.list = [...next, ...bd.list.filter(x => !ids.includes(x.id))]; }); return true; };
  const said = x => { const after = boardPlan(current(b)), d = after.days.find(y => y.items.some(i => i.id === x.id)); return x.type === 'break' ? `, ${label(x)} now has ${after.days[dayN(x) - 1] ? fmtEighths(after.days[dayN(x) - 1].eighths) : '0'} pages` : d ? `, day ${d.n}, which now has ${fmtEighths(d.eighths)} pages` : ', not scheduled'; };
  const moveBy = (x, d) => { const ids = plan.list.map(i => i.id), i = ids.indexOf(x.id), j = i + d; if (j < 0 || j >= ids.length) return false; [ids[i], ids[j]] = [ids[j], ids[i]]; UI.focus = 'h' + x.id; if (save(ids)) announce(`${label(x)} moved ${d < 0 ? 'up' : 'down'}${said(x)}`); return true; };
  // Arrow keys move an item one place; the new place is announced and the handle keeps the focus.
  const keyMove = (e, x) => {
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0; if (!d) return;
    e.preventDefault(); e.stopPropagation(); // the arrows move the strip, not the section wheel
    moveBy(x, d);
  };
  // Activating a handle (a tap, Enter, or a screen reader's double-tap) offers the moves as buttons.
  const moveMenu = x => {
    let close = () => {};
    const choose = fn => { close(); fn(); };
    const days = plan.days.map(d => h('button', { class: 'btn ghost small', onclick: () => choose(() => { UI.focus = 'h' + x.id; saveBoard(b, bd => { bd.list = moveToDay(bd.list, x.id, d.n); }); announce(`${label(x)} moved to the end of day ${d.n}`); }) }, `End of day ${d.n}${d.date ? ' · ' + fmtShort(d.date) : ''}`));
    ({ close } = sheet(`Move ${label(x)}`, h('div', { class: 'stack' },
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost', onclick: () => choose(() => moveBy(x, -1)) }, '↑ Up one'), h('button', { class: 'btn ghost', onclick: () => choose(() => moveBy(x, 1)) }, '↓ Down one')),
      x.type !== 'break' && h('p', { class: 'small muted' }, 'Or move it to the end of a day:'),
      x.type !== 'break' && h('div', { class: 'actions' }, ...days, h('button', { class: 'btn ghost small', onclick: () => choose(() => { UI.focus = 'h' + x.id; saveBoard(b, bd => { bd.list = moveToDay(bd.list, x.id, 0); }); announce(`${label(x)} moved to Not scheduled yet`); }) }, 'Not scheduled yet')))));
  };
  let dragged = false; // a drag just ended: the click that follows it is not a tap
  const handle = x => h('button', { class: 'sb-handle', type: 'button', 'data-fk': 'h' + x.id, 'data-handle': x.id, 'aria-label': `Move ${label(x)}: drag, use the up and down arrow keys, or activate for options`, title: 'Drag to move, or tap for options',
    onpointerdown: e => drag(e, x), onkeydown: e => keyMove(e, x), onclick: () => { if (dragged) { dragged = false; return; } moveMenu(x); } }, '⠿');
  // Dragging starts once the pointer has moved a little (a tap never moves anything). The strip stays where it is and
  // a drop line shows where it will go; it moves when let go. The page scrolls when the pointer nears the top (below the
  // section wheel) or the bottom. Everything is looked up afresh on each move, so a redraw during a drag loses nothing.
  const drag = (e, x) => {
    if (e.button > 0) return;
    const grip = e.currentTarget, y0 = e.clientY; let y = e.clientY, raf = 0, done = false, on = false, ghost = null;
    try { grip.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    const mark = h('li', { class: 'sb-drop', 'aria-hidden': 'true' });
    const liveLi = () => { const l = liveBoard(); return l && [...l.children].find(n => n.dataset && n.dataset.id === x.id); };
    const start = () => {
      on = true; const li = liveLi(); if (!li) return;
      const r = li.getBoundingClientRect();
      ghost = li.cloneNode(true); ghost.classList.add('sb-ghost'); ghost.removeAttribute('data-id');
      Object.assign(ghost.style, { position: 'fixed', left: r.left + 16 + 'px', top: r.top + 'px', width: r.width - 16 + 'px', height: r.height + 'px', margin: '0', pointerEvents: 'none', zIndex: '60' });
      document.body.append(ghost); li.classList.add('sb-placeholder'); document.body.classList.add('sb-dragging');
    };
    const place = () => {
      const l = liveBoard(), li = liveLi(); if (!l || !li) return;
      if (ghost) ghost.style.transform = `translateY(${y - y0}px)`;
      li.classList.add('sb-placeholder');
      const others = [...l.querySelectorAll(':scope > li[data-id]')].filter(n => n !== li);
      const before = others.find(n => { const q = n.getBoundingClientRect(); return y < q.top + q.height / 2; });
      if (before) { if (mark.nextElementSibling !== before || mark.parentNode !== l) l.insertBefore(mark, before); } else if (l.lastElementChild !== mark) l.append(mark);
    };
    const tick = () => {
      const top = (document.querySelector('.rolodex') || { getBoundingClientRect: () => ({ bottom: 0 }) }).getBoundingClientRect().bottom, edge = 64;
      const dy = y < Math.max(0, top) + edge ? -12 : y > innerHeight - edge ? 12 : 0;
      if (dy) { window.scrollBy(0, dy); place(); }
      raf = requestAnimationFrame(tick);
    };
    const move = ev => { if (ev.pointerId !== e.pointerId) return; y = ev.clientY; if (!on && Math.abs(y - y0) > 6) { start(); raf = requestAnimationFrame(tick); } if (on) { ev.preventDefault(); place(); } };
    const end = ev => {
      if (done || (ev && ev.pointerId != null && ev.pointerId !== e.pointerId)) return; done = true; cancelAnimationFrame(raf);
      removeEventListener('pointermove', move, true); removeEventListener('pointerup', end, true); removeEventListener('pointercancel', end, true); removeEventListener('keydown', esc, true);
      if (ghost) ghost.remove(); document.body.classList.remove('sb-dragging');
      const l = liveBoard(), li = liveLi(); if (li) li.classList.remove('sb-placeholder');
      const ids = on && l && mark.parentNode === l ? [...l.children].flatMap(n => (n === mark ? [x.id] : n !== li && n.dataset && n.dataset.id ? [n.dataset.id] : [])) : null;
      mark.remove();
      if (on) { dragged = true; setTimeout(() => { dragged = false; }, 400); }
      if (ev && ev.type === 'pointerup' && ids) { UI.focus = 'h' + x.id; if (save(ids)) announce(`${label(x)} moved${said(x)}`); }
    };
    const esc = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(null); } };
    // Listened for on the whole window, so the drag still ends properly if the pointer capture is lost.
    addEventListener('pointermove', move, { capture: true, passive: false }); addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true); addEventListener('keydown', esc, true);
  };
  const items = () => {
    const out = []; let d = 0;
    for (const x of plan.list) {
      if (x.type === 'break') {
        const day = plan.days[d++], last = d === plan.days.length;
        out.push(h('li', { class: 'sb-break', 'data-id': x.id },
          handle(x),
          h('div', { class: 'sb-break-text' }, h('b', null, `End of day ${day.n} of ${day.of}`), h('span', null, [day.date && fmtShort(day.date), `${fmtEighths(day.eighths)} page${day.eighths === 8 ? '' : 's'}`, `${day.scenes} scene${day.scenes === 1 ? '' : 's'}`].filter(Boolean).join(' · '))),
          h('button', { class: 'icon-btn sb-break-x', type: 'button', 'data-fk': 'x' + x.id, 'aria-label': `Remove day ${day.n}`, title: 'Remove this day', onclick: () => removeBreak(b, x.id, day.n, last) }, '✕'),
          last && h('div', { class: 'sb-pool-head', role: 'heading', 'aria-level': '2' }, `Not scheduled yet${plan.unscheduled ? ` · ${plan.unscheduled} scene${plan.unscheduled === 1 ? '' : 's'}` : ': drag scenes up into a day'}`)));
      } else if (x.type === 'banner') {
        out.push(h('li', { class: 'sb-banner', 'data-id': x.id }, handle(x), h('button', { class: 'sb-body', type: 'button', 'data-fk': 'b' + x.id, onclick: () => editBanner(b, x) }, x.text || 'Banner')));
      } else {
        const nums = castNumbers(x.cast, cast);
        out.push(h('li', { class: 'sb-strip ' + stripClass(x), 'data-id': x.id },
          handle(x),
          h('button', { class: 'sb-body', type: 'button', 'data-fk': 'b' + x.id, onclick: () => editScene(b, x), 'aria-label': `Scene ${x.scene || 'without a number'}, ${ieOf(x) || 'no INT or EXT'} ${tod(x)}, ${x.set || 'no set'}${x.desc ? ', ' + x.desc : ''}, ${fmtEighths(x.eighths)} page${x.eighths === 8 ? '' : 's'}${nums.length ? ', cast ' + nums.join(', ') : ''}. Edit` },
            h('span', { class: 'sb-num' }, x.scene || '—'),
            h('span', { class: 'sb-ie' }, [ieOf(x) || '—', tod(x)].join(' · ')),
            h('span', { class: 'sb-set' }, x.set || '—'),
            h('span', { class: 'sb-desc' }, x.desc || ''),
            h('span', { class: 'sb-cast' }, nums.length ? 'Cast ' + nums.join(', ') : ''),
            h('span', { class: 'sb-pages' }, fmtEighths(x.eighths)))));
      }
    }
    return out;
  };
  list.replaceChildren(...items());
  const empty = !plan.scenes.length, missing = shootDayCount(b) - plan.days.length;
  const root = h('div', { class: 'sb-page' },
    h('div', { class: 'page-head' }, backBtn('Booking', () => { UI.focus = null; go({ view: 'booking', id: b.id }); })),
    h('h1', null, 'Stripboard & shot list'), h('div', { class: 'muted' }, [b.title, b.client].filter(Boolean).join(' · ')),
    b.shotImportReview && h('div', { class: 'warn small review-note' }, `⚠ ${b.shotImportReview.scenes} scene${b.shotImportReview.scenes === 1 ? '' : 's'} came from a shot list: check the scene numbers, interior or exterior and time of day (guessed where the heading left them out) and the page counts (set to 1/8, as a shot list has no pages). `, h('button', { class: 'btn ghost small', onclick: () => update(d => { const x = d.bookings.find(y => y.id === b.id); if (x) { delete x.shotImportReview; x.updatedAt = Date.now(); } }) }, 'Checked')),
    h('p', { class: 'status-line' }, empty ? 'No scenes yet' : `${plan.scenes.length} scene${plan.scenes.length === 1 ? '' : 's'} · ${fmtEighths(plan.eighths)} pages · ${plan.days.length} shooting day${plan.days.length === 1 ? '' : 's'}${plan.unscheduled ? ` · ${plan.unscheduled} not scheduled yet` : ''}`),
    h('div', { class: 'actions sb-tools' },
      h('button', { class: 'btn ' + (empty ? 'primary' : 'ghost'), 'data-fk': 'import', onclick: () => openImport(b) }, '📄 Scenes from a script'),
      h('button', { class: 'btn ghost', 'data-fk': 'add', onclick: () => editScene(b, null) }, '＋ Scene'),
      h('button', { class: 'btn ghost small', 'data-fk': 'banner', onclick: () => editBanner(b, null) }, '＋ Banner'),
      h('button', { class: 'btn ghost small', 'data-fk': 'day', onclick: () => addDay(b) }, '＋ Day')),
    !empty && h('div', { class: 'actions sb-tools2' },
      h('button', { class: 'btn ghost small', 'data-fk': 'spread', onclick: () => spread(b) }, '⚖ Spread over the days'),
      h('button', { class: 'btn ghost small', 'data-fk': 'sort', onclick: () => sortPool(b) }, '↕ Group unscheduled by location'),
      h('button', { class: 'btn ghost small', 'data-fk': 'cast', onclick: () => editCast(b) }, `👥 Cast (${cast.length})`),
      h('button', { class: 'btn ghost small', 'data-fk': 'print', onclick: () => printElement(boardDoc(current(b))) }, '🖨 Print')),
    h('div', { class: 'sb-legend', role: 'group', 'aria-label': 'Strip colours' }, LEGEND.map(([c, t]) => h('span', { class: 'sb-chip ' + c }, t))),
    empty && h('p', { class: 'small muted' }, 'Start from the script, and each scene becomes a strip under "Not scheduled yet". Drag strips by their ⠿ handle into a day (or tap the handle for options), or press ⚖ Spread over the days. Each "End of day" strip adds up its pages.'),
    plan.days.length > shootDayCount(b) && h('p', { class: 'small muted' }, `The board has more shooting days than the booking's ${shootDayCount(b)}; days without a date follow on. Change the booking's end date to give them dates.`),
    missing > 0 && plan.days.length > 0 && h('p', { class: 'small muted' }, `The booking has ${shootDayCount(b)} days but the board has ${plan.days.length}. `, h('button', { class: 'btn ghost small', onclick: () => addMissingDays(b, missing) }, `Add the missing day${missing === 1 ? '' : 's'}`)),
    !plan.days.length && h('p', { class: 'warn' }, 'There are no shooting days: ＋ Day adds one.'),
    list,
    h('section', { class: 'block', id: 'sb-shots' }, h('h3', null, 'Shot list'), shotsBlock(b)));
  // Keep track of the focused control, and give it back after a redraw replaced it.
  root.addEventListener('focusin', e => { const k = e.target.closest && e.target.closest('[data-fk]'); UI.focus = k ? k.dataset.fk : null; });
  // Runs straight after the redraw that put this page on screen, before the next key press arrives.
  if (UI.focus) queueMicrotask(() => { const a = document.activeElement; if (a && a !== document.body && a.isConnected) return; const el = root.isConnected && root.querySelector(`[data-fk="${CSS.escape(UI.focus)}"]`); if (el) el.focus({ preventScroll: true }); });
  return root;
}

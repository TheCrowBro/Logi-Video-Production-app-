// Equipment → Import…: the kit list someone already keeps, brought into Vdex. Choose a CSV or Excel (.xlsx) file, or
// paste the list. Vdex shows what it takes each column for, and every one of them can be changed; under the columns
// it says what would be added, updated and skipped and which rows have a problem. Only the last button adds anything,
// and afterwards the import can be undone. It all happens on this device: js/table-read.js reads the file,
// js/gear-columns.js understands it, js/gear-import.js compares it with what is owned and adds it. Adding respects
// read-only mode and needs no licence. Whatever a file holds is only ever shown as text. Loaded on first use.
import { h, sheet, toast, announce, money, nodes, parseISO } from './util.js';
import * as store from './store.js';
import * as native from './native.js';
import * as T from './table-read.js';
import * as G from './gear-columns.js';
import * as M from './gear-import.js';

// Wide on purpose: a CSV is "text/csv" on one computer and an Excel type on the next, and a phone's picker greys out
// what is not listed. An old .xls can be picked too, so that it is turned down in a sentence rather than not offered.
const ACCEPT = '.csv,.tsv,.tab,.txt,.xlsx,.xls,text/csv,text/comma-separated-values,application/csv,text/tab-separated-values,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHOWN = { sample: 5, dups: 30, problems: 100 };
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const letters = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const day = d => parseISO(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/* ------------------------------------ undo ------------------------------------ */
// The last import of this visit can be taken back: from the bar that follows it for a short while, and after that
// from the Import sheet. undoGearImport() only undoes what nothing has touched since.
let last = null, bar = null, barTimer = 0;
const said = done => [done.added.length && `${done.added.length.toLocaleString()} added`, done.updated.length && `${done.updated.length.toLocaleString()} updated`, done.skipped && `${done.skipped.toLocaleString()} skipped`].filter(Boolean).join(', ') || 'Nothing changed';
function closeBar() {
  clearTimeout(barTimer); if (!bar) return;
  const held = bar.contains(document.activeElement); bar.remove(); bar = null;
  if (held) { const b = document.querySelector('[data-fk="gear-import"]'); if (b) b.focus({ preventScroll: true }); } // the focus goes back to Import, not nowhere
}
function undoLast() {
  if (!last) return false;
  const r = M.undoGearImport(last.done); if (!r) return false; // read-only: the gate has said why
  last = null; closeBar();
  const what = [r.removed && `${plural(r.removed, 'item')} removed`, r.restored && `${r.restored.toLocaleString()} put back as ${r.restored === 1 ? 'it was' : 'they were'}`].filter(Boolean).join(', ');
  const kept = r.kept ? `${plural(r.kept, 'item')} changed or used since ${r.kept === 1 ? 'stays' : 'stay'} as ${r.kept === 1 ? 'it is' : 'they are'}` : '';
  const text = what ? `Import undone: ${what}${kept ? '. ' + kept : ''}` : kept ? `Nothing was undone: ${kept}` : 'There was nothing left to undo';
  toast(text);
  return true;
}
function offerUndo(done) {
  closeBar();
  const undo = h('button', { class: 'btn small', type: 'button', onclick: undoLast }, 'Undo');
  bar = h('div', { class: 'undo-bar', role: 'group', 'aria-label': 'Import finished' }, h('span', null, said(done)), undo, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Dismiss', onclick: closeBar }, '✕'));
  document.body.append(bar);
  barTimer = setTimeout(closeBar, 20000);
  announce(`${said(done)}. Undo is offered for a short while, and under Import after that.`);
  return undo;
}

/* --------------------------------- room to keep it --------------------------------- */
// Vdex keeps everything in this browser's own storage, which has a ceiling (about 5 MB, shared with the encrypted
// copy when there is a PIN). A list that would not fit is turned down before anything is added, rather than added
// and then not saved: a test write of the size it needs either fits or does not.
function roomFor(items) {
  let vault = false; try { vault = localStorage.getItem('logi-vault') != null; } catch { /* blocked storage: nothing to test */ }
  const need = Math.ceil((JSON.stringify(items).length + items.length * 60) * (vault ? 2.4 : 1.05));
  if (need < 150000) return true;
  try { localStorage.setItem('logi-import-room', 'x'.repeat(need)); return true; } catch { return false; }
  finally { try { localStorage.removeItem('logi-import-room'); } catch { /* ignore */ } }
}

/* ------------------------------------ the sheet ------------------------------------ */
// file: a list that is already in hand (one another app handed to Vdex, js/share-in.js); it is read straight away.
export async function openGearImport({ file = null } = {}) {
  await import('./licence.js').then(m => m.initLicence()).catch(() => {}); // whether changes are allowed is known before Add is offered
  const body = h('div', { class: 'stack gi' });
  let open = true;
  const sh = sheet('Import equipment', body, { onClose: () => { open = false; } });
  const sym = store.db.profile.currency || '$';
  let table = null, sheetAt = 0, header = 'auto', L = null, targets = [], live = [], built = null, plan = null, all = 'skip';
  const chosen = new Map(); // row of the file → what to do with it, where the person chose for one item
  let pasted = ''; // what is in the paste box, kept while the sheet is open
  const show = (...kids) => body.replaceChildren(...nodes(kids));

  /* ------------------------------ step 1: the list ------------------------------ */
  function choose({ focus = true, given = null } = {}) {
    const warn = h('p', { class: 'warn small gi-warn', role: 'alert', hidden: true }), busy = h('p', { class: 'small muted gi-busy', role: 'status' });
    const say = text => { busy.textContent = ''; warn.textContent = text; warn.hidden = false; warn.scrollIntoView({ block: 'nearest' }); };
    const load = async read => {
      warn.hidden = true; busy.textContent = 'Reading…';
      let got; try { got = await read(); } catch (e) { return say(e && e.code ? e.message : 'That could not be read: ' + ((e && e.message) || e)); }
      if (!open) return;
      table = got; sheetAt = Math.max(0, table.sheets.findIndex(s => !s.hidden)); header = 'auto'; chosen.clear(); all = 'skip';
      analyse(); preview('step');
    };
    const fileIn = h('input', { type: 'file', class: 'gi-file', hidden: true, tabIndex: -1, accept: ACCEPT, onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) load(() => T.readTableFile(f)); } });
    // The iPhone app opens the Files app; everywhere else the browser's own file chooser.
    const pick = async () => {
      if (!native.isApp) return fileIn.click();
      let f = null; try { f = await native.files.open(['csv', 'xlsx', 'tsv', 'txt', 'xls']); } catch (e) { return say('Could not open the file: ' + (e.message || e)); }
      if (f) load(() => T.readTableFile(f));
    };
    const area = h('textarea', { id: 'gi-paste', rows: 5, spellcheck: false, autocapitalize: 'off', placeholder: 'Sony FX6\n2x Aputure 600d\nSennheiser MKH 416 (S/N 4512345)', value: pasted, oninput: e => { pasted = e.target.value; } });
    show(
      h('p', { class: 'small' }, 'Bring in the kit list you already keep, so you do not have to type it again. Vdex shows you what it makes of the list, and you can correct it, before anything is added.'),
      h('button', { class: 'btn primary gi-choose', type: 'button', onclick: pick }, '📄 Choose a file'), fileIn, warn, busy,
      h('p', { class: 'small muted' }, 'A CSV or Excel (.xlsx) file: your own spreadsheet, an export from another kit app, a rental house’s list, an insurer’s equipment schedule, or Vdex’s own asset register. From Numbers or Google Sheets, export or download it as CSV or Excel first.'),
      h('label', { class: 'gi-or', for: 'gi-paste' }, 'Or paste the list here'),
      area,
      h('p', { class: 'small muted' }, 'Rows copied out of a spreadsheet, or one item on each line.'),
      h('button', { class: 'btn ghost gi-use', type: 'button', onclick: () => load(() => T.readTableText(area.value)) }, 'Use the pasted list'),
      last && h('div', { class: 'note small gi-last' }, `The last import (${said(last.done)}, from ${last.name}) can still be undone. `, h('button', { class: 'btn ghost small', type: 'button', onclick: () => { if (undoLast()) choose(); } }, 'Undo that import')),
      h('p', { class: 'small muted' }, 'Nothing is sent anywhere: the list is read on this device.'));
    if (focus) setTimeout(() => { const b = body.querySelector('.gi-choose'); if (b && open) b.focus({ preventScroll: true }); }, 60);
    if (given) load(() => T.readTableFile(given));
  }

  /* --------------------------- step 2: columns and results --------------------------- */
  function analyse() {
    L = G.layout(table.sheets[sheetAt].rows, header); targets = G.guessColumns(L);
    live = Array.from({ length: L.width }, (_, i) => i).filter(i => L.body.some(r => (r.cells[i] ?? '') !== '')); // columns with nothing in them are not shown
  }
  function replan() {
    built = G.buildItems(L, targets, { own: [...new Set(store.db.gear.map(g => (g.category || '').trim()).filter(Boolean))] });
    plan = M.planGearImport(built.items, { matchNames: true });
    plan.rows.forEach((r, i) => { if (r.match) r.action = chosen.get(built.at[i]) || all; });
  }
  const heading = i => (L.head && L.head[i] ? short(L.head[i], 60) : `Column ${letters(i)}`);
  const examples = i => { const seen = []; for (const r of L.body) { const v = r.cells[i]; if (v && !seen.includes(v)) { seen.push(v); if (seen.length === 3) break; } } return seen.map(v => short(v.replace(/\s+/g, ' '), 28)).join(' · '); };
  const line = x => [
    h('div', null, h('strong', null, x.name), x.qty > 1 && ` × ${x.qty}`),
    h('div', { class: 'muted small' }, [x.category, x.serial && 'S/N ' + x.serial, x.value != null && x.value !== '' && money(x.value, sym) + (x.qty > 1 ? ' each' : ''), x.location && '📍 ' + x.location, x.purchased && 'bought ' + day(x.purchased), x.warranty && 'warranty until ' + day(x.warranty), x.serviceEvery && `service every ${x.serviceEvery} months`, x.lastService && 'last service ' + day(x.lastService), x.firmware && 'firmware ' + x.firmware].filter(Boolean).join(' · ') || 'No other details'),
    x.notes && h('div', { class: 'muted small prewrap' }, short(x.notes, 160))];

  function preview(focus) {
    const from = table.sheets[sheetAt], word = L.list ? 'line' : 'row', Word = L.list ? 'Line' : 'Row';
    const results = h('div', { class: 'stack gi-results' }), sum = h('p', { class: 'add-sum gi-sum', role: 'status' }), full = h('p', { class: 'warn small', role: 'alert', hidden: true });
    const go = h('button', { class: 'btn primary gi-go', type: 'button', onclick: () => add() });

    const tally = () => {
      const c = M.planCounts(plan);
      sum.textContent = [`Adds ${c.add.toLocaleString()}`, c.update && `updates ${c.update.toLocaleString()}`, c.skip && `skips ${c.skip.toLocaleString()}`].filter(Boolean).join(', ') + '.';
      go.textContent = c.add && c.update ? `Add ${c.add.toLocaleString()} and update ${c.update.toLocaleString()}` : c.update ? `Update ${plural(c.update, 'item')}` : `Add ${plural(c.add, 'item')} to my Equipment`;
      go.disabled = !(c.add + c.update);
    };
    const WHY = { serial: r => `Same serial number as your “${r.match.name}”`, name: r => `Same name as your “${r.match.name}”, and neither has a serial number`, ref: r => `The same item as your “${r.match.name}”` };
    const paint = () => {
      replan(); full.hidden = true;
      const n = built.items.length, dup = plan.rows.map((r, i) => ({ r, i })).filter(x => x.r.match), probs = built.problems, lf = built.left;
      const picks = [];
      const pick = ({ r, i }) => { const s = h('select', { 'aria-label': `What to do with ${r.item.name}`, onchange: e => { r.action = e.target.value; chosen.set(built.at[i], r.action); tally(); } }, M.ACTIONS.map(([v, label]) => h('option', { value: v, selected: v === r.action }, label))); picks.push([r, s]); return s; };
      const everyone = h('select', { class: 'gi-all', 'aria-label': dup.length > 1 ? 'What to do with every item you already have' : dup.length ? `What to do with ${dup[0].r.item.name}` : '', onchange: e => { all = e.target.value; chosen.clear(); dup.forEach(x => { x.r.action = all; }); picks.forEach(([, s]) => { s.value = all; }); tally(); } }, M.ACTIONS.map(([v, label]) => h('option', { value: v, selected: v === all }, label)));
      const passed = [lf.totals && plural(lf.totals, `total ${word}`), lf.headings + lf.sections && plural(lf.headings + lf.sections, 'heading'), lf.blank && plural(lf.blank, `${word} with nothing Vdex keeps`, `${word}s with nothing Vdex keeps`)].filter(Boolean);
      results.replaceChildren(...nodes(
        n ? h('section', { class: 'add-group gi-sample', 'aria-label': 'The first items' }, h('h4', null, n > SHOWN.sample ? `The first ${SHOWN.sample} of the ${n.toLocaleString()} items found` : n === 1 ? 'The item found' : `The ${n} items found`),
          h('ul', { class: 'add-list add-items' }, built.items.slice(0, SHOWN.sample).map(x => h('li', null, ...line(x)))))
          : h('p', { class: 'warn small gi-none' }, `No items come out of these columns. One of them has to be the Name, or a Make and a Model.`),
        n > 0 && built.currency && built.currency !== sym && h('p', { class: 'note small gi-money' }, `The values in this list are in ${built.currency}. Vdex keeps the numbers as they are and shows them with your own currency sign (${sym}): nothing is converted.`),
        (built.categories.length > 0 || built.kept.length > 0) && h('p', { class: 'small gi-cats' }, h('b', null, 'Categories: '),
          [built.categories.length > 0 && built.categories.slice(0, 12).map(c => `“${short(c.from, 30)}” becomes ${c.to}`).join(', ') + (built.categories.length > 12 ? ` and ${built.categories.length - 12} more` : '') + '.',
            built.kept.length > 0 && `Kept as typed: ${built.kept.slice(0, 12).map(c => short(c, 30)).join(', ')}${built.kept.length > 12 ? ` and ${built.kept.length - 12} more` : ''}.`].filter(Boolean).join(' ')),
        dup.length > 0 && h('section', { class: 'add-group gi-dups', 'aria-label': 'Items you already have' }, h('h4', null, `Already in your Equipment (${dup.length.toLocaleString()})`),
          h('label', { class: 'add-all small' }, dup.length > 1 ? 'All of these: ' : 'What to do with it: ', everyone),
          h('ul', { class: 'add-list add-items' }, dup.slice(0, SHOWN.dups).map(x => h('li', { class: 'add-dup' }, ...line(x.r.item), h('div', { class: 'small add-why' }, WHY[x.r.why](x.r)), dup.length > 1 && pick(x)))),
          dup.length > SHOWN.dups && h('p', { class: 'small muted' }, `And ${(dup.length - SHOWN.dups).toLocaleString()} more, which follow “All of these”.`)),
        probs.length > 0 && h('details', { class: 'gi-problems', open: probs.length <= 6 }, h('summary', null, `${plural(probs.length, word)} to look at`),
          h('ul', { class: 'small' }, probs.slice(0, SHOWN.problems).map(p => h('li', null, h('b', null, `${Word} ${p.n}: `), p.text))),
          probs.length > SHOWN.problems && h('p', { class: 'small muted' }, `And ${(probs.length - SHOWN.problems).toLocaleString()} more.`)),
        passed.length > 0 && h('p', { class: 'small muted gi-passed' }, `Not items, so passed over: ${passed.join(', ')}.`)));
      tally();
    };

    // One column for each thing, except notes: giving a column what another one had takes it from the other.
    const setCol = (i, v) => {
      targets[i] = v;
      if (v && v !== 'notes') targets.forEach((t, j) => { if (j !== i && t === v) { targets[j] = ''; const other = body.querySelector(`#gi-col-${j}`); if (other) { other.value = ''; other.closest('.gi-col').classList.add('skipped'); } announce(`“${heading(j)}” is now skipped: only one column can be that.`); } });
      body.querySelector(`#gi-col-${i}`).closest('.gi-col').classList.toggle('skipped', !v);
      paint();
    };
    const hidden = L.width - live.length;
    show(
      h('h3', { class: 'gi-step', tabIndex: -1, 'data-focus': 'step' }, 'Check the columns'),
      h('p', { class: 'small muted gi-source' }, `${short(table.name, 60)}: ${plural(L.body.length, word)}${L.header && !L.list ? ' under the headings' : ''}.`),
      from.truncated && h('p', { class: 'warn small' }, `This list is longer than Vdex reads in one go: only its first ${T.LIMITS.rows.toLocaleString()} rows are here. Import the rest from a second file.`),
      !store.canChangeQuietly() && h('p', { class: 'note small gi-readonly' }, 'Vdex is read-only at the moment, so the list can be checked here but not added.'),
      table.sheets.length > 1 && h('label', { class: 'gi-pick small' }, 'Sheet: ', h('select', { 'data-focus': 'sheet', onchange: e => { sheetAt = Number(e.target.value); header = 'auto'; chosen.clear(); analyse(); preview('sheet'); } }, table.sheets.map((s, i) => h('option', { value: i, selected: i === sheetAt }, `${short(s.name, 40)} (${plural(s.rows.length, 'row')})`)))),
      !L.list && h('label', { class: 'check gi-header' }, h('input', { type: 'checkbox', checked: L.header, 'data-focus': 'header', onchange: e => { header = e.target.checked ? (G.findHeader(from.rows) >= 0 ? 'auto' : true) : false; analyse(); preview('header'); } }), h('span', null, 'The first row holds the headings')),
      h('p', { class: 'small' }, 'This is what Vdex takes each column for. Change any it has wrong, or set it to Skip.'),
      h('div', { class: 'gi-cols' }, live.map(i => h('div', { class: 'gi-col' + (targets[i] ? '' : ' skipped') },
        h('div', { class: 'gi-head' }, heading(i)), h('div', { class: 'gi-eg muted small' }, examples(i)),
        h('select', { id: `gi-col-${i}`, 'aria-label': `What the column “${heading(i)}” is`, onchange: e => setCol(i, e.target.value) }, G.TARGETS.map(([v, label]) => h('option', { value: v, selected: v === targets[i] }, label)))))),
      hidden > 0 && h('p', { class: 'small muted' }, `${plural(hidden, 'empty column')} ${hidden === 1 ? 'is' : 'are'} not shown.`),
      results, sum, full,
      h('div', { class: 'actions add-actions' }, go,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => choose() }, 'Choose another list'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => sh.close() }, 'Cancel')));
    paint();
    const el = body.querySelector(`[data-focus="${focus}"]`); if (el) el.focus({ preventScroll: focus !== 'step' });
    if (focus === 'step') sh.el.querySelector('.sheet-body').scrollTop = 0;

    // The last step, and the only one that changes anything. While Vdex is read-only the usual sheet explains and this one stays.
    async function add() {
      if (!store.canChange()) return;
      const adding = plan.rows.filter(r => r.action === 'add' || (r.action === 'update' && !r.match)).map(r => r.item);
      if (!roomFor(adding)) { full.textContent = `This list is bigger than the space this browser gives Vdex on this device, so nothing was added. Import it in parts, or leave out a column such as Notes.`; full.hidden = false; full.scrollIntoView({ block: 'nearest' }); return; }
      go.disabled = true;
      const page = await import('./pages/gear.js'); // loaded already: Import is on that page
      const done = M.applyGearImport(plan);
      if (!done) { go.disabled = false; return; }
      last = done.added.length + done.updated.length ? { done, name: short(table.name, 40) } : null;
      sh.close();
      await page.showItems([...done.added, ...done.updated].slice(0, 40), { drawn: true }); // in the same breath as the change: the page is drawn once
      if (last) offerUndo(done).focus({ preventScroll: true }); else toast(said(done));
    }
  }
  choose({ given: file });
}

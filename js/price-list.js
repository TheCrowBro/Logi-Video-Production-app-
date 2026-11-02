// The price list: the lines a videographer charges for again and again (a filming day, an editing hour, a drone day,
// a music licence…), each with a price, picked into a quote or an invoice in a couple of taps. A new list starts
// from typical freelance rates for the person's region (js/price-rates.js): starting points, not advice, and every
// price is theirs to change. It is a record of its own in the database (db.priceList), so it syncs and merges by
// itself: a change to the other billing settings on another device never undoes it. Loaded on first use.
import { h, sheet, toast, uid, parseISO } from './util.js';
import { db, endOf, update } from './store.js';
import { openForm } from './form.js';
import { billing, fmtMoney } from './money.js';
import { knownCode } from './pay.js';
import { RATES, RATES_AS_OF } from './price-rates.js';

export const CATS = ['Filming and crew', 'Equipment hire', 'Planning', 'Editing and post-production', 'Music and stock footage', 'Travel', 'Delivery and extras', 'Packages', 'Other'];
// [key, the line as the client reads it, unit, category]. The keys match js/price-rates.js.
export const ITEMS = [
  ['shoot_day', 'Filming day: videographer with camera kit (up to 10 hours)', 'day', 0],
  ['shoot_half', 'Half filming day: videographer with camera kit (up to 5 hours)', 'half day', 0],
  ['shoot_hour', 'Filming by the hour (2-hour minimum)', 'hour', 0],
  ['event_hour', 'Event filming', 'hour', 0],
  ['second_camera', 'Second camera operator with camera', 'day', 0],
  ['sound', 'Sound recordist with sound kit', 'day', 0],
  ['gaffer', 'Gaffer / lighting technician', 'day', 0],
  ['drone', 'Drone filming: licensed pilot with drone', 'day', 0],
  ['director', 'Producer / director', 'day', 0],
  ['dit', 'Data management on set (copying and backing up the footage)', 'day', 0],
  ['prompter', 'Teleprompter with operator', 'day', 0],
  ['cam_hire', 'Cinema camera package with lenses', 'day', 1],
  ['light_hire', 'Lighting kit', 'day', 1],
  ['audio_hire', 'Audio kit (wireless microphones and boom)', 'day', 1],
  ['gimbal_hire', 'Gimbal / stabiliser', 'day', 1],
  ['preprod', 'Pre-production and planning (brief, script, shot list, schedule)', 'hour', 2],
  ['recce', 'Location recce', 'half day', 2],
  ['edit_hour', 'Editing', 'hour', 3],
  ['edit_day', 'Editing', 'day', 3],
  ['grade', 'Colour grading', 'hour', 3],
  ['mix', 'Sound mix and audio clean-up', 'hour', 3],
  ['motion', 'Motion graphics and titles', 'hour', 3],
  ['captions', 'Subtitles / captions (per finished minute)', 'minute', 3],
  ['social_cut', 'Social media cut-down (vertical or square version)', 'each', 3],
  ['revision', 'Extra round of changes', 'round', 3],
  ['music', 'Music licence (online and social use)', 'track', 4],
  ['stock_clip', 'Stock footage clip licence', 'clip', 4],
  ['travel_time', 'Travel time', 'hour', 5],
  ['mileage', 'Mileage', 'mile', 5],
  ['rush', 'Rush delivery', 'each', 6],
  ['raw_handover', 'Hand-over of the raw footage', 'each', 6],
  ['archive', 'Keeping the footage for 12 months', 'each', 6],
  ['wedding', 'Wedding: full day of filming with a highlight film', 'each', 7],
];
export const REGIONS = [['us', 'United States', 'USD'], ['ca', 'Canada', 'CAD'], ['uk', 'United Kingdom', 'GBP'], ['eu', 'Western Europe', 'EUR'], ['au', 'Australia and New Zealand', 'AUD']];
const IN_TEXT = { us: 'the United States', uk: 'the United Kingdom' }; // region names inside a sentence
const BY_CODE = { USD: 'us', CAD: 'ca', GBP: 'uk', EUR: 'eu', AUD: 'au', NZD: 'au' };
const UNITS = ['each', 'day', 'half day', 'hour', 'minute', 'round', 'track', 'clip', 'mile', 'km', 'week', 'person', 'night'];
// The person's currency, only when it is really known: an unfamiliar symbol gives '' (no typical rates), never US dollars.
const curCode = () => billing().currencyCode || knownCode(db.profile.currency || '$');
const curLabel = () => curCode() || String(db.profile.currency || '').trim() || 'your currency';
export const regionFor = code => BY_CODE[code] || '';
const regionName = r => (REGIONS.find(x => x[0] === r) || [, ''])[1];
const regionText = r => IN_TEXT[r] || regionName(r);
const regionCode = r => (REGIONS.find(x => x[0] === r) || [, , ''])[2];
const unitFor = (key, unit, region) => (key === 'mileage' ? (region === 'us' || region === 'uk' ? 'mile' : 'km') : unit);
const priceOk = p => p !== '' && p != null && Number.isFinite(Number(p));
const round5 = n => (n >= 50 ? Math.round(n / 5) * 5 : Math.round(n));

// A new list from the catalogue at a region's typical rates (no prices for a region with none). When the region's
// currency is the person's own, their day rate and editing hour rate from the settings win, and the half day and the
// editing day follow them in the same proportion as the typical rates, so a half day never costs more than a day.
export function startList(region, bl = billing()) {
  const R = RATES[region], typical = key => (R && R.items[key] ? R.items[key][1] : '');
  const own = regionCode(region) && regionCode(region) === curCode(), day = Number(bl.dayRate), hour = Number(bl.hourRate);
  return ITEMS.map(([key, desc, unit, c]) => {
    let price = typical(key);
    if (own && day > 0) { if (key === 'shoot_day') price = day; if (key === 'shoot_half' && price) price = round5(day * price / typical('shoot_day')); }
    if (own && hour > 0) { if (key === 'edit_hour') price = hour; if (key === 'edit_day' && price) price = round5(hour * price / typical('edit_hour')); }
    return { id: key, key, desc, unit: unitFor(key, unit, region), price, cat: CATS[c] };
  });
}
// A list from storage made safe to use: only objects, a unique id on every line, known groups, prices as numbers.
const tidy = list => { const seen = new Set(); return list.filter(i => i && typeof i === 'object').map((i, n) => {
  let id = String(i.id || i.key || 'line-' + n); while (seen.has(id)) id += '-' + n; seen.add(id);
  return { ...i, id, desc: String(i.desc ?? ''), unit: String(i.unit || 'each'), cat: CATS.includes(i.cat) ? i.cat : 'Other', price: priceOk(i.price) ? Number(i.price) : '' }; }); };
// The list in use: the person's own once they have changed anything, otherwise a fresh one for the region their
// currency belongs to (none, so no prices, for a currency the research does not cover).
export function priceList() {
  const pl = db.priceList;
  if (pl && Array.isArray(pl.list)) return { list: tidy(pl.list), region: REGIONS.some(r => r[0] === pl.region) ? pl.region : '', own: true, checked: pl.checked || '' };
  const region = regionFor(curCode());
  return { list: startList(region), region, own: false, checked: '' };
}
const saveList = (list, region, extra = {}) => update(d => { d.priceList = { list, region, checked: (d.priceList && d.priceList.checked) || '', ...extra, updatedAt: Date.now() }; });
// A change is made to the list as it is now, not as it was when the sheet was drawn: a sync may have brought a newer one.
const change = fn => { const { list, region, checked } = priceList(); saveList(fn(list), region, { checked }); };
// Low, typical and high for an item from the catalogue, in the region's own currency.
export const rangeOf = (key, region) => { const R = RATES[region]; return (R && key && R.items[key]) || null; };
const thinFor = (key, region) => { const R = RATES[region]; return !!(R && R.thin && R.thin.includes(key)); };
const money = (n, region) => {
  const rc = regionCode(region);
  if (rc && rc !== curCode()) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: rc, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); } catch { return `${rc} ${n}`; } }
  return fmtMoney(n).replace(/\.00$/, '');
};
const per = u => (!u || u === 'each' ? 'each' : 'per ' + u);
const priceText = i => (priceOk(i.price) ? `${fmtMoney(i.price)} ${per(i.unit)}` : `no price yet · ${per(i.unit)}`);
const grouped = list => { const by = new Map(CATS.map(c => [c, []])); for (const i of list) by.get(CATS.includes(i.cat) ? i.cat : 'Other').push(i); return [...by].filter(([, items]) => items.length); };
const shootDays = b => (b && b.date ? Math.max(1, Math.round((parseISO(endOf(b)) - parseISO(b.date)) / 864e5) + 1) : 1);
// Lines per day start at the number of shoot days (editing days excepted); the hourly filming line at its 2-hour minimum.
const qtyFor = (i, days) => (i.key === 'shoot_hour' ? 2 : i.unit === 'day' && i.cat !== CATS[3] ? days : 1);
const disclaimer = region => `The starting prices are typical freelance rates for ${region ? regionText(region) : 'your region'} from published rate guides, crew rate cards, surveys and price lists (${RATES_AS_OF}). They are a starting point, not advice: your market, experience, kit and the job decide your price.`;
// When the list came from a region whose currency is not the person's, until they say the prices are now theirs.
function currencyNote(onDone) {
  const { list, region, own, checked } = priceList(), cur = curCode(), rc = regionCode(region);
  if (!region && !own) return h('p', { class: 'warn' }, `There are no typical rates for ${curLabel()} yet, so the prices are blank: type in yours, or start from one of the regions in Settings → Quotes & invoices → Price list and change the prices into ${curLabel()}.`);
  if (!region || rc === cur || (cur && checked === cur) || !list.some(i => priceOk(i.price))) return null;
  return h('div', { class: 'warn' }, h('p', { style: 'margin:0 0 6px' }, `This list started from typical rates for ${regionText(region)}, which are in ${rc}, but your currency is ${curLabel()}. Check every price is in ${curLabel()} before you use it.`),
    own && cur && h('button', { class: 'btn ghost small', type: 'button', onclick: () => { update(d => { d.priceList = { ...d.priceList, checked: cur, updatedAt: Date.now() }; }); toast('Noted'); onDone && onDone(); } }, `✓ My prices are in ${cur}`));
}

// The editor: Settings → Quotes & invoices → Price list.
export function openPriceList() {
  const body = h('div', { class: 'stack price-list' });
  const edit = item => {
    const { region } = priceList(), range = item && rangeOf(item.key, region);
    openForm({
      title: item ? 'Edit price' : 'Add to the price list',
      values: item || { desc: '', unit: 'each', price: '', cat: 'Other' },
      fields: [
        { key: 'desc', label: 'Line on the quote or invoice', required: true, placeholder: 'e.g. Filming day, Drone footage, Same-day edit' },
        { key: 'price', label: `Price (${db.profile.currency || '$'})`, type: 'number', min: 0, step: 'any', hint: range ? `Typical in ${regionText(region)}: ${money(range[1], region)} (usually ${money(range[0], region)} to ${money(range[2], region)}).${thinFor(item.key, region) ? ' Few published rates exist for this one, so treat it as a rough guide.' : ''}` : 'Leave blank to fill in on each quote.' },
        { key: 'unit', label: 'Per', type: 'select', options: [...new Set([...(item && item.unit ? [item.unit] : []), ...UNITS])] },
        { key: 'cat', label: 'Group', type: 'select', options: CATS },
      ],
      saveLabel: item ? 'Save' : 'Add',
      onSave: v => {
        const next = { ...(item || { id: uid() }), desc: String(v.desc || '').trim(), unit: v.unit, cat: v.cat, price: v.price === '' || v.price == null ? '' : Number(v.price) };
        change(list => (item && list.some(i => i.id === item.id) ? list.map(i => (i.id === item.id ? next : i)) : [...list, next]));
        toast(item ? 'Price saved' : 'Added to the price list'); draw({ focus: next.id, open: next.cat });
      },
      onDelete: item ? () => { change(list => list.filter(i => i.id !== item.id)); toast('Removed from the price list'); draw({ focus: 'add' }); } : null,
    });
  };
  const draw = ({ focus, open } = {}) => {
    const { list, region, own } = priceList(), cur = curCode();
    const shown = body.childNodes.length ? new Set([...body.querySelectorAll('details[open]')].map(d => d.dataset.cat)) : new Set([CATS[0]]); // a redraw keeps the groups that were open
    if (open) shown.add(CATS.includes(open) ? open : 'Other');
    const pick = h('select', { id: 'pl-region', 'aria-label': 'Typical rates from' }, ...REGIONS.map(([k, name, c]) => h('option', { value: k, selected: k === (region || regionFor(cur) || 'us') ? 'selected' : null }, `${name} (${c})`)));
    const restart = () => {
      const now = priceList(), r = pick.value, mine = now.own ? now.list.filter(i => !i.key) : [];
      if (now.own && !confirm(`Start the price list again from typical rates for ${regionText(r)}? Your changes to the standard lines are replaced${mine.length ? '; the lines you added yourself are kept' : ''}.`)) return;
      saveList([...startList(r), ...mine], r, { checked: '' }); toast(`Price list set to typical rates for ${regionText(r)}`); draw({ focus: 'restart' });
    };
    body.replaceChildren(...[
      h('p', { class: 'small' }, 'The lines you charge for again and again. Pick them into a quote or an invoice with ＋ From the price list, then change the quantities.'),
      currencyNote(() => draw({ focus: 'add' })),
      ...grouped(list).map(([cat, items]) => h('details', { class: 'twirl budget-cat', open: shown.has(cat), 'data-cat': cat },
        h('summary', null, h('span', null, h('span', { class: 'twirl-name' }, cat), h('span', { class: 'twirl-sub' }, `${items.length} line${items.length === 1 ? '' : 's'}`))),
        h('div', { class: 'twirl-body stack' }, items.map(i => h('button', { class: 'card tap price-item', type: 'button', 'data-id': i.id, onclick: () => edit(i) },
          h('strong', null, i.desc || '—'), h('div', { class: 'muted small' }, priceText(i))))))),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', 'data-id': 'add', onclick: () => edit(null) }, '+ Add a line')),
      h('div', { class: 'field' }, h('label', { for: 'pl-region' }, 'Typical rates from'), pick),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', 'data-id': 'restart', onclick: restart }, own ? '↺ Start again from these rates' : 'Use these rates')),
      h('p', { class: 'small muted' }, disclaimer(region))].filter(Boolean));
    // Keyboard and screen-reader focus stays on the line just changed (or the next sensible button), not lost.
    if (focus) setTimeout(() => { const el = body.querySelector(`[data-id="${CSS.escape(focus)}"]`) || body.querySelector('[data-id="add"]'); if (el && el.isConnected) el.focus(); }, 0);
  };
  draw();
  sheet('Price list', body);
}

// The picker on a quote or invoice: tick lines, add them.
export function pickFromPriceList(b, onPick) {
  const { list, region } = priceList(), days = shootDays(b), chosen = new Set();
  const add = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Add lines');
  const status = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const count = () => { add.disabled = !chosen.size; add.textContent = chosen.size ? `Add ${chosen.size} line${chosen.size === 1 ? '' : 's'}` : 'Add lines'; };
  const rows = new Map(list.map(i => { const row = h('label', { class: 'check price-pick' },
    h('input', { type: 'checkbox', onchange: e => { if (e.target.checked) chosen.add(i.id); else chosen.delete(i.id); count(); } }),
    h('span', { class: 'price-pick-text' }, h('span', null, i.desc || '—'), h('em', null, priceText(i)))); row.dataset.q = `${i.desc} ${i.cat}`.toLowerCase(); return [i.id, row]; }));
  const groups = grouped(list).map(([cat, items]) => h('div', { class: 'stack price-group' }, h('h4', null, cat), items.map(i => rows.get(i.id))));
  const none = h('p', { class: 'muted small', hidden: true }, 'Nothing on the price list matches.');
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    for (const row of rows.values()) row.hidden = !!q && !row.dataset.q.includes(q);
    for (const g of groups) g.hidden = ![...g.querySelectorAll('label')].some(r => !r.hidden);
    none.hidden = groups.some(g => !g.hidden);
    const n = [...rows.values()].filter(r => !r.hidden).length;
    status.textContent = q ? `${n} line${n === 1 ? '' : 's'} match` : '';
  };
  // Escape in a search box with text in it clears the search; it does not close the sheet and lose what is ticked.
  const search = h('input', { type: 'search', placeholder: 'Search the price list', 'aria-label': 'Search the price list', oninput: filter,
    onkeydown: e => { if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; filter(); } } });
  let close = () => {};
  add.addEventListener('click', () => {
    const lines = list.filter(i => chosen.has(i.id)).map(i => ({ id: uid(), desc: i.desc, qty: qtyFor(i, days), unit: i.unit || 'each', price: priceOk(i.price) ? Number(i.price) : '' }));
    if (!lines.length) return; close(); onPick(lines);
  });
  ({ close } = sheet('Add from the price list', h('div', { class: 'stack price-picker' },
    currencyNote(),
    list.length ? [search, status, ...groups, none] : h('p', { class: 'muted' }, 'Your price list is empty.'),
    h('p', { class: 'small muted' }, `Prices come from your price list${region ? `, which started from typical rates for ${regionText(region)}` : ''}: check them before you send. Change the list in Settings → Quotes & invoices → Price list.`),
    h('div', { class: 'form-actions' }, add, h('button', { class: 'btn ghost', type: 'button', onclick: () => { close(); openPriceList(); } }, 'Edit the price list')))));
}

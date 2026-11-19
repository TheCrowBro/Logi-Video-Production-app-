// Sharing out: your contact card and your equipment, each packed into a link the way the crew link is, so no server
// is involved and nothing is stored online. The link opens shared.html, which shows it to read and offers "Add to my
// Vdex". A contact card carries what the vCard does (name, title, business, phone, email, website, where you are
// based). An equipment list is a one-off copy and carries everything that describes each item (GEAR_FIELDS in
// js/gear-import.js: name, category, serial number, where it is kept, quantity, value, purchase and warranty dates,
// service interval, firmware, notes), never its service log or the bookings it is on. Loaded on first use.
// Making either link or its QR code works during the trial and with a licence (requireLicence('link')); once the trial
// has ended without one, the same offer of a licence as for other licensed features is shown instead. The Me page's
// Contact card code is made the same way (js/pages/me.js). Opening a link, and booking, quote and invoice links, never
// need a licence.
import { h, sheet, toast, groupBy, money } from './util.js';
import { db, byId, qtyOf, usedQty, totalValue, requireLicence } from './store.js';
import { pack } from './link-pack.js';
import { SITE } from './version.js';
import { QR_MAX, QR_LARGE, GEAR_MAX, qrCaution, fromLine } from './share-data.js';
import { GEAR_FIELDS } from './gear-import.js';

const str = v => (v == null ? '' : String(v));
const filled = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null)); // empty fields are left out: a shorter link, a QR code that scans
const siteBase = () => (window.vdexDesktop || !/^https?:$/.test(location.protocol) ? SITE : new URL('./', location.href).href);

// A finished link and the ways to hand it over: copy, the share sheet, an email (a very long link does not fit in an
// email link, so it is copied to be pasted in), a preview, and with `qr` a QR code when the link is short enough to scan.
// A long link's code is drawn larger, and one longer than Vdex's own scanner reads says so under it (qrCaution).
function linkPanel(url, { label, title, subject, body, qr = '', tooLong = '' }) {
  const long = url.length > 1700;
  const area = h('textarea', { class: 'share-link', readonly: true, rows: 4, 'aria-label': label }, url);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { area.select(); toast('Select the link and copy it'); } };
  const share = async () => { if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } } copy(); };
  const mailTo = h('a', { class: 'btn ghost', href: 'mailto:?' + new URLSearchParams({ subject, body: body(long ? '[Paste the link here]' : url) }).toString().replace(/\+/g, '%20'),
    onclick: () => { if (long) navigator.clipboard?.writeText(url).then(() => toast('The link is long, so it was copied: paste it into the email'), () => toast('Copy the link above and paste it into the email')); } }, '✉ Email it');
  const qrBox = h('div', { class: 'share-qr' + (url.length > QR_LARGE ? ' large' : '') }), qrNote = h('p', { class: 'small muted share-qr-note', style: 'text-align:center', hidden: true }, [qr, qrCaution(url)].filter(Boolean).join('. '));
  if (qr && url.length > QR_MAX) qrBox.replaceChildren(h('p', { class: 'small muted', style: 'text-align:center' }, tooLong));
  else if (qr) import('./qr.js').then(m => m.qrSvg(url, { cellSize: 2 })).then(svg => { if (qrBox.isConnected) { qrBox.innerHTML = svg; qrNote.hidden = false; } }).catch(() => {}); // not into a panel that has been taken away since
  return { area, nodes: [area, h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: copy }, '📋 Copy link'), h('button', { class: 'btn ghost', type: 'button', onclick: share }, '📤 Share…'), mailTo, h('a', { class: 'btn ghost small', href: url, target: '_blank', rel: 'noopener' }, 'Open preview')), ...(qr ? [qrBox, qrNote] : [])] };
}

/* ---------------------------------- contact card ---------------------------------- */
export const contactSnapshot = (p = db.profile) => ({ v: 1, kind: 'contact', ...filled({ name: str(p.name).trim(), title: str(p.title).trim(), business: str(p.business).trim(), phone: str(p.phone).trim(), email: str(p.email).trim(), website: str(p.website).trim(), location: str(p.location).trim() }) });
export async function contactLink(p) { return siteBase() + 'shared.html#' + await pack(contactSnapshot(p)); }
// Me → My card's link…: the link the Me page's QR code holds, to send instead of showing the code.
export async function openContactShare(p = db.profile) {
  if (!(await requireLicence('link'))) return;
  let url; try { url = await contactLink(p); } catch (e) { return toast('Could not make the link: ' + (e.message || e)); }
  const me = fromLine(p);
  const panel = linkPanel(url, { label: 'Link to your contact card', title: p.name || 'Contact card', subject: `Contact details${p.name ? ': ' + p.name : ''}`,
    body: link => `Hi,\n\nHere are my contact details:\n\n${link}\n\nOpen it to save them to your phone, or to add me to your own Vdex.\n\nThanks${me ? ',\n' + me : ''}` });
  sheet('My contact card', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'A link to a small page with your name, title, business, phone, email, website and where you are based. Whoever opens it can save your details to their phone, or add you to the Crew list in their own Vdex.'),
    h('p', { class: 'small muted' }, 'Everything is inside the link itself, so nothing is stored online. Anyone who has the link can read it.'),
    ...panel.nodes));
  panel.area.focus();
}

/* ---------------------------------- equipment list ---------------------------------- */
const sorted = list => [...list].sort((a, b) => (a.category || 'Other').localeCompare(b.category || 'Other') || str(a.name).localeCompare(str(b.name)));
// items: equipment records; kits: kit records, kept only for the items that are in the list.
export function gearSnapshot({ items = sorted(db.gear), kits = [], title = '' } = {}) {
  const at = new Map(items.map((g, i) => [g.id, i])), p = db.profile;
  return { v: 1, kind: 'gear', made: Date.now(), title: str(title), currency: str(p.currency || '$'), by: filled({ name: str(p.name).trim(), business: str(p.business).trim() }),
    items: items.map(g => filled({ ref: g.id, ...Object.fromEntries(GEAR_FIELDS.map(f => [f, f === 'qty' ? (qtyOf(g) > 1 ? qtyOf(g) : '') : g[f]])) })),
    kits: kits.map(k => filled({ ref: k.id, name: str(k.name), description: str(k.description), notes: str(k.notes), items: (k.gear || []).filter(id => at.has(id)).map(id => [at.get(id), usedQty(k, id)]) })).filter(k => k.items.length) };
}
export async function gearLink(what) { return siteBase() + 'shared.html#' + await pack(gearSnapshot(what)); }

// What the three choices share: the whole list (with the kits), one kit, or the items ticked.
function chosen(S) {
  if (S.scope === 'kit') { const k = byId('kits', S.kit); return k ? { items: sorted((k.gear || []).map(id => byId('gear', id)).filter(Boolean)), kits: [k], title: k.name } : { items: [], kits: [], title: '' }; }
  if (S.scope === 'pick') return { items: sorted(db.gear.filter(g => S.picked.has(g.id))), kits: [], title: '' };
  return { items: sorted(db.gear), kits: db.kits, title: '' };
}

// Equipment page → Share…: choose what goes, read what goes with it, then make the link. The link is only made on the
// button, after the notice; changing the choice takes the old link away.
export async function openGearShare() {
  if (!(await requireLicence('link'))) return;
  const S = { scope: 'all', kit: db.kits[0] ? db.kits[0].id : '', picked: new Set() };
  const sym = db.profile.currency || '$', count = n => `${n} item${n === 1 ? '' : 's'}`;
  const choice = h('div', { class: 'stack' }), result = h('div', { class: 'stack share-result', 'aria-live': 'polite' });
  const makeBtn = h('button', { class: 'btn primary', type: 'button' }, '🔗 Make the link');
  let seq = 0;
  const clear = () => { seq++; result.replaceChildren(); makeBtn.disabled = !chosen(S).items.length; };

  const draw = focus => {
    const c = chosen(S), units = c.items.reduce((s, g) => s + qtyOf(g), 0), value = c.items.reduce((s, g) => s + totalValue(g), 0);
    const seg = h('div', { class: 'seg wide', role: 'group', 'aria-label': 'What to share' }, [['all', 'Whole list'], db.kits.length > 0 && ['kit', 'A kit'], ['pick', 'Pick items']].filter(Boolean)
      .map(([k, label]) => h('button', { type: 'button', class: S.scope === k ? 'on' : '', 'aria-pressed': String(S.scope === k), 'data-scope': k, onclick: () => { S.scope = k; draw(true); } }, label)));
    const sum = h('p', { class: 'small muted share-sum' }, c.items.length ? `${count(units)}${value ? `, worth ${money(value, sym)}` : ''}${c.kits.length && S.scope === 'all' ? `, and your ${c.kits.length} kit${c.kits.length === 1 ? '' : 's'}` : ''}.` : S.scope === 'pick' ? 'Tick the items to share.' : 'Nothing to share yet.');
    const kitPick = S.scope === 'kit' && h('div', { class: 'field' }, h('label', { for: 'share-kit' }, 'Kit'), h('select', { id: 'share-kit', onchange: e => { S.kit = e.target.value; draw(); } }, db.kits.map(k => h('option', { value: k.id, selected: k.id === S.kit }, k.name))));
    const picks = S.scope === 'pick' && h('div', { class: 'checks share-picks' }, [...groupBy(sorted(db.gear), g => g.category || 'Other')].map(([cat, items]) => h('fieldset', null, h('legend', null, cat),
      items.map(g => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.picked.has(g.id), onchange: e => { if (e.target.checked) S.picked.add(g.id); else S.picked.delete(g.id); const n = chosen(S).items; sum.textContent = n.length ? `${count(n.reduce((s, x) => s + qtyOf(x), 0))} ticked.` : 'Tick the items to share.'; clear(); } }),
        h('span', null, g.name, qtyOf(g) > 1 && h('em', null, ` ×${qtyOf(g)}`), g.serial && h('em', null, ` S/N ${g.serial}`)))))));
    choice.replaceChildren(...[seg, kitPick, picks, sum].filter(Boolean));
    clear();
    if (focus) choice.querySelector('.seg button.on')?.focus();
  };

  const make = async () => {
    const n = ++seq, c = chosen(S); if (!c.items.length) return;
    if (!(await requireLicence('link')) || n !== seq) return; // the trial may have ended since the sheet opened
    // One link carries GEAR_MAX items (js/share-data.js cuts a longer list on the other side), so a longer list is not made into one.
    if (c.items.length > GEAR_MAX) return void result.replaceChildren(h('p', { class: 'warn small share-many', role: 'alert' }, `One link carries ${GEAR_MAX.toLocaleString()} items at most, and this is ${c.items.length.toLocaleString()}. Share it in parts: one kit at a time, or pick items.`));
    makeBtn.disabled = true;
    let url; try { url = await gearLink(c); } catch (e) { if (n === seq) { makeBtn.disabled = false; toast('Could not make the link: ' + (e.message || e)); } return; }
    if (n !== seq) return; // the choice changed while the link was being made
    makeBtn.disabled = false;
    const what = c.title ? `the “${c.title}” kit` : 'my equipment list', me = fromLine(db.profile);
    const panel = linkPanel(url, { label: 'Link to the equipment list', title: c.title || 'Equipment list', subject: c.title ? `Kit: ${c.title}` : `Equipment list${db.profile.name ? ' from ' + db.profile.name : ''}`,
      body: link => `Hi,\n\nHere is ${what} from Vdex (${count(c.items.length)}), with serial numbers and values:\n\n${link}\n\nOpen it to read or print the list, or to add the items to your own Vdex. It is a copy from today.\n\nThanks${me ? ',\n' + me : ''}`,
      qr: 'A workmate can scan this to open the list on their phone', tooLong: 'This link is too long for a QR code. Share one kit or fewer items to get one, or send the link.' });
    result.replaceChildren(...panel.nodes);
    panel.area.focus();
  };
  makeBtn.addEventListener('click', make);

  const sh = sheet('Share equipment', h('div', { class: 'stack' },
    h('p', { class: 'small' }, 'A read-only page for a workmate: they can read and print the list, and add the items to their own Vdex. It is a one-off copy, so later changes here do not reach them.'),
    h('p', { class: 'warn share-warn', role: 'note' }, h('strong', null, 'Serial numbers and values go with it'), ', with each item’s category, quantity, where it is kept, purchase and warranty dates, service interval, firmware and notes. Its service log and your bookings do not. Everything is inside the link itself, so nothing is stored online, and anyone who has the link can read it: send it only to people you would hand that list to.'),
    choice, makeBtn, result));
  sh.el.tabIndex = -1; sh.el.focus({ preventScroll: true }); // the notice is read before anything is chosen
  draw();
}

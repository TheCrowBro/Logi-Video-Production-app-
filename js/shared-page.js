// The page a shared contact card or equipment list opens on (shared.html#…): what the sender's copy of Vdex packed
// into the URL fragment, drawn here to read, print or save. No store, no account, nothing fetched but this page.
// Only the fields js/share-data.js allows are ever shown. "Add to my Vdex" hands the same packed link to the app
// (index.html#add=…), which shows what would be added and asks before adding anything (js/share-add.js).
import { h, telUrl } from './util.js';
import { readShared, packedOf, vcard, fromLine } from './share-data.js';

const bar = document.getElementById('bar'), box = document.getElementById('doc');
addEventListener('hashchange', () => location.reload()); // another shared link opened in this same tab
const fail = msg => { box.replaceChildren(h('div', { class: 'msg' }, h('h1', null, 'This link does not open'), h('p', null, msg))); };
const save = (text, name, type) => { const a = h('a', { href: URL.createObjectURL(new File([text], name, { type })), download: name }); document.body.append(a); a.click(); a.remove(); };
const addBtn = what => h('a', { class: 'btn primary', href: 'index.html#add=' + packedOf(location.hash), title: `Opens Vdex and shows what would be added to your ${what}, before anything is` }, '＋ Add to my Vdex');
const sent = made => (made ? new Date(made).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function contact(c) {
  const name = c.name || c.business || 'Contact';
  document.title = `${name} — contact card`;
  bar.replaceChildren(
    h('div', { class: 'who' }, 'Contact card', h('small', null, 'shared with Vdex')),
    h('div', { class: 'acts' }, addBtn('Crew list'), h('button', { class: 'btn', type: 'button', onclick: () => save(vcard(c), `${name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40) || 'contact'}.vcf`, 'text/vcard') }, 'Save to my phone’s contacts')));
  const rows = [['Phone', c.phone && h('a', { href: telUrl(c.phone) }, c.phone)], ['Email', c.email && h('a', { href: 'mailto:' + c.email }, c.email)], ['Website', c.website && h('a', { href: c.website, target: '_blank', rel: 'noopener noreferrer' }, c.website.replace(/^https?:\/\//, '').replace(/\/$/, ''))], ['Based in', c.location]].filter(r => r[1]);
  box.replaceChildren(h('div', { class: 'paper card' },
    h('div', { class: 'top' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, name.split(/\s+/).map(w => [...w][0] || '').slice(0, 2).join('').toUpperCase()),
      h('div', null, h('h1', null, name), h('p', { class: 'sub' }, [c.title, c.name && c.business].filter(Boolean).join(' · ')))),
    rows.length > 0 && h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    h('p', { class: 'note' }, 'Add to my Vdex puts this card in your Crew list, after showing you what it holds. Save to my phone’s contacts downloads it as a contact file (.vcf).')));
}

function gear(g) {
  const from = fromLine(g.by), cur = g.currency, worth = v => cur + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const units = g.items.reduce((s, x) => s + x.qty, 0), total = g.items.reduce((s, x) => s + (Number(x.value) || 0) * x.qty, 0);
  const title = g.title || 'Equipment list';
  document.title = `${title}${from ? ' — ' + from : ''}`;
  bar.replaceChildren(
    h('div', { class: 'who' }, 'Equipment list', from && h('small', null, 'from ' + from)),
    h('div', { class: 'acts' }, addBtn('Equipment'), h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print')));
  const groups = new Map(); g.items.forEach(x => { const c = x.category || 'Other'; groups.set(c, [...(groups.get(c) || []), x]); });
  const item = x => h('li', null,
    h('span', { class: 'name' }, x.name, x.qty > 1 && ` × ${x.qty}`),
    h('span', { class: 'val' }, x.value !== '' ? worth(x.value) + (x.qty > 1 ? ' each' : '') : ''),
    h('span', { class: 'more' }, [x.serial && 'Serial number ' + x.serial, x.location && 'Kept: ' + x.location, x.purchased && 'Bought ' + sent(x.purchased + 'T12:00'), x.warranty && 'Warranty until ' + sent(x.warranty + 'T12:00'), x.serviceEvery !== '' && x.serviceEvery > 0 && `Service every ${plural(x.serviceEvery, 'month')}`, x.firmware && 'Firmware ' + x.firmware].filter(Boolean).join(' · ')),
    x.notes && h('span', { class: 'more notes' }, x.notes));
  box.replaceChildren(h('div', { class: 'paper' },
    h('h1', null, title),
    h('p', { class: 'sub' }, [plural(units, 'item'), total > 0 && 'worth ' + worth(total), from && 'from ' + from].filter(Boolean).join(' · ')),
    ...[...groups].flatMap(([cat, items]) => [h('h2', null, cat), h('ul', { class: 'items' }, items.map(item))]),
    ...(g.kits.length ? [h('h2', null, g.kits.length === 1 ? 'Kit' : 'Kits'), ...g.kits.map(k => h('div', { class: 'kit' }, h('strong', null, k.name), k.description && ` — ${k.description}`,
      h('p', null, k.items.map(([i, n]) => g.items[i].name + (n > 1 ? ` × ${n}` : '')).join(', ')), k.notes && h('p', { class: 'notes' }, k.notes)))] : []),
    h('p', { class: 'note' }, `${sent(g.made) ? `Sent ${sent(g.made)}. ` : ''}This is a one-off copy from that moment: it does not change when the sender’s list does. Add to my Vdex shows you every item first, and matches serial numbers you already have.`)));
}

(async () => {
  let snap;
  try { snap = await readShared(location.hash); } catch (e) {
    if (e.code === 'doc') return location.replace('invoice.html' + location.hash); // a quote or an invoice has its own page
    return fail(e.code === 'none' ? 'There is nothing in it: part of the link may be missing. Ask the person who sent it for a fresh one.' : e.message);
  }
  if (snap.kind === 'crew') return location.replace('crew.html' + location.hash); // shoot info has its own page
  (snap.kind === 'contact' ? contact : gear)(snap);
  if (snap.newer) box.querySelector('.paper').append(h('p', { class: 'note' }, 'This link was made with a newer version of Vdex, so this page may not show everything in it.'));
})();

import { h, safeUrl, telUrl, toast } from '../util.js';
import { db, update } from '../store.js';
import { openForm } from '../form.js';

let qrLib;
async function loadQR() {
  if (qrLib) return qrLib;
  await new Promise((res, rej) => document.head.append(h('script', { src: 'vendor/qrcode.js', onload: res, onerror: rej })));
  return (qrLib = window.qrcode);
}

const esc = s => String(s || '').replace(/([\;,])/g, '\\$1').replace(/\n/g, '\\n');

export function vcard(p) {
  const [first = '', ...rest] = (p.name || '').trim().split(/\s+/);
  return [
    'BEGIN:VCARD', 'VERSION:3.0',
    `N:${esc(rest.join(' '))};${esc(first)};;;`,
    `FN:${esc(p.name)}`,
    p.business && `ORG:${esc(p.business)}`,
    p.title && `TITLE:${esc(p.title)}`,
    p.phone && `TEL;TYPE=CELL:${esc(p.phone)}`,
    p.email && `EMAIL:${esc(p.email)}`,
    safeUrl(p.website) && `URL:${safeUrl(p.website)}`,
    p.location && `ADR;TYPE=WORK:;;${esc(p.location)};;;;`,
    'END:VCARD',
  ].filter(Boolean).join('\r\n');
}

const S = { mode: 'contact' };

function edit() {
  openForm({
    title: 'Your details',
    values: db.profile,
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'business', label: 'Business name' },
      { key: 'title', label: 'Job title', placeholder: 'Videographer / DOP' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'website', label: 'Website', type: 'url', placeholder: 'https://yourwebsite.com' },
      { key: 'location', label: 'Based in' },
      { key: 'currency', label: 'Currency symbol', hint: 'Used for gear value and insurance totals.' },
      { key: 'bio', label: 'Short bio', type: 'textarea' },
    ],
    onSave: v => update(d => { d.profile = { ...d.profile, ...v }; }),
  });
}

export const me = {
  id: 'me', label: 'Me', icon: '🪪',
  render(root) {
    const p = db.profile;
    const site = safeUrl(p.website);
    const qrBox = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' });
    const caption = h('div', { class: 'qr-cap muted' });
    const hasData = p.name || p.phone || p.email;

    async function paintQR() {
      const text = S.mode === 'site' ? site : vcard(p);
      caption.textContent = S.mode === 'site' ? site || 'Add your website first' : 'Scan to save my contact details';
      if (!text || (S.mode === 'contact' && !hasData)) { qrBox.textContent = 'Add your details to generate a QR code.'; return; }
      try {
        const qr = (await loadQR())(0, 'M');
        qr.addData(text); qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        qrBox.setAttribute('aria-label', S.mode === 'site' ? 'QR code for ' + site : 'QR code with contact details for ' + p.name);
      } catch { qrBox.textContent = 'Too much data for a QR code — shorten your details.'; }
    }

    const vcfFile = () => new File([vcard(p)], `${(p.name || 'contact').replace(/\W+/g, '_')}.vcf`, { type: 'text/vcard' });
    const share = async () => {
      const f = vcfFile();
      if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: p.name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); toast('Saved .vcf file');
    };

    root.append(h('div', null,
      h('div', { class: 'page-head' }, h('h1', null, 'Me'), h('button', { class: 'btn ghost', onclick: edit }, 'Edit')),
      h('div', { class: 'card id-card' },
        h('div', { class: 'id-top' },
          h('div', { class: 'avatar big', 'aria-hidden': 'true' }, (p.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()),
          h('div', null, h('h2', null, p.name || 'Add your name'), h('div', { class: 'muted' }, [p.title, p.business].filter(Boolean).join(' · ')), p.location && h('div', { class: 'muted small' }, '📍 ' + p.location))),
        h('div', { class: 'seg', role: 'tablist' },
          h('button', { class: S.mode === 'contact' ? 'on' : '', role: 'tab', 'aria-selected': S.mode === 'contact', onclick: () => { S.mode = 'contact'; me.render(clear(root)); } }, 'Contact card'),
          h('button', { class: S.mode === 'site' ? 'on' : '', role: 'tab', 'aria-selected': S.mode === 'site', onclick: () => { S.mode = 'site'; me.render(clear(root)); } }, 'Website')),
        qrBox, caption,
        h('div', { class: 'actions center' },
          h('button', { class: 'btn primary', onclick: share, disabled: !hasData }, 'Share contact (.vcf)'),
          site && h('a', { class: 'btn ghost', href: site, target: '_blank', rel: 'noopener noreferrer' }, '🌐 Open website'))),
      (p.phone || p.email) && h('div', { class: 'card kv' },
        p.phone && h('div', null, h('span', { class: 'muted' }, 'Phone'), h('a', { href: telUrl(p.phone) }, p.phone)),
        p.email && h('div', null, h('span', { class: 'muted' }, 'Email'), h('a', { href: 'mailto:' + p.email }, p.email)),
        site && h('div', null, h('span', { class: 'muted' }, 'Website'), h('a', { href: site, target: '_blank', rel: 'noopener noreferrer' }, p.website))),
      p.bio && h('p', { class: 'prewrap' }, p.bio)));
    paintQR();
  },
};

function clear(root) { root.replaceChildren(); return root; }

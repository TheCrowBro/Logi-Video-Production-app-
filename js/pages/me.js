import { h, safeUrl, telUrl, toast } from '../util.js';
import { db } from '../store.js';

import { loadQR } from '../qr.js';
import * as native from '../native.js';
import { vcard, QR_MAX, qrCaution } from '../share-data.js';
import { contactLink, openContactShare } from '../share-out.js';

// The QR code hands over one of three things. The card (the usual one) is a link to a small page with your details,
// which anyone can read, save to their phone's contacts, or add to their own Vdex; it is all inside the link, so no
// server holds it. "Phone contacts" is the plain vCard a phone's camera adds to its address book with no page between.
// The card's page has to be fetched by the phone that scans it, so it needs a connection there; the vCard needs none.
// The code last chosen is remembered on this device, so someone who works where there is no signal sets it once.
const MODES = [['card', 'Contact card'], ['vcard', 'Phone contacts'], ['site', 'Website']];
const KEY = 'logi-me-code';
const chosen = () => { let m = ''; try { m = localStorage.getItem(KEY) || ''; } catch { /* the usual one */ } return MODES.some(([k]) => k === m) ? m : 'card'; };
const S = { mode: chosen() };
const choose = mode => { S.mode = mode; try { localStorage.setItem(KEY, mode); } catch { /* kept until Vdex is closed */ } };

// The details are changed in one place only: Settings → General → Profile.
const edit = () => import('./settings.js').then(m => m.openSettingsSection('Profile'));

export const me = {
  id: 'me', label: 'Me', icon: '🪪',
  render(root) {
    const p = db.profile;
    const site = safeUrl(p.website);
    const qrBox = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' });
    const caption = h('div', { class: 'qr-cap muted' });
    const hasData = p.name || p.phone || p.email;

    async function paintQR() {
      const mode = S.mode;
      caption.textContent = mode === 'site' ? site || 'Add your website first' : mode === 'vcard' ? 'Scan to save my details straight into a phone’s contacts. No connection needed.' : 'Scan to open my contact card: save it to a phone, or add it to Vdex. The other phone needs a connection; Phone contacts works without one.';
      caption.classList.toggle('words', mode !== 'site'); // a sentence wraps between words; a web address may break anywhere
      if ((mode === 'site' && !site) || (mode !== 'site' && !hasData)) { qrBox.textContent = 'Add your details to generate a QR code.'; return; }
      try {
        const text = mode === 'site' ? site : mode === 'vcard' ? vcard(p) : await contactLink(p);
        if (mode !== S.mode || !qrBox.isConnected) return; // another code was asked for meanwhile
        if (mode === 'card' && text.length > QR_MAX) throw new Error('too long');
        if (mode === 'card' && qrCaution(text)) caption.textContent += ' ' + qrCaution(text);
        const qr = (await loadQR())(0, 'M');
        qr.addData(text); qr.make();
        qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        qrBox.setAttribute('aria-label', mode === 'site' ? 'QR code for ' + site : mode === 'vcard' ? 'QR code with contact details for ' + p.name : 'QR code that opens the contact card of ' + p.name);
      } catch { qrBox.textContent = 'Too much data for a QR code — shorten your details.'; }
    }

    const vcfFile = () => new File([vcard(p)], `${(p.name || 'contact').replace(/\W+/g, '_')}.vcf`, { type: 'text/vcard' });
    const share = async () => {
      const f = vcfFile();
      if (native.canShareFiles()) { try { await native.files.share(f.name, f, f.type, { title: p.name }); } catch (e) { toast('Could not share: ' + (e.message || e)); } return; }
      if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: p.name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      const a = h('a', { href: URL.createObjectURL(f), download: f.name }); document.body.append(a); a.click(); a.remove(); toast('Saved .vcf file');
    };
    // The card's link, to send instead of showing the code: copy, share or email (js/share-out.js).
    const sendLink = () => openContactShare(p);

    root.append(h('div', null,
      h('div', { class: 'page-head' }, h('h1', null, 'Me'), h('button', { class: 'btn ghost', onclick: edit, title: 'Your details are changed under Settings → General → Profile' }, 'Edit in Settings →')),
      h('div', { class: 'card id-card' },
        h('div', { class: 'id-top' },
          h('div', { class: 'avatar big', 'aria-hidden': 'true' }, (p.name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()),
          h('div', null, h('h2', null, p.name || 'Add your name'), h('div', { class: 'muted' }, [p.title, p.business].filter(Boolean).join(' · ') || (p.name ? '' : 'Settings → General → Profile')), p.location && h('div', { class: 'muted small' }, '📍 ' + p.location))),
        h('div', { class: 'seg me-modes', role: 'tablist', 'aria-label': 'What the QR code hands over' },
          MODES.map(([k, label]) => h('button', { class: S.mode === k ? 'on' : '', role: 'tab', 'aria-selected': S.mode === k, onclick: () => { choose(k); me.render(clear(root)); root.querySelector('.me-modes button.on')?.focus(); } }, label))),
        qrBox, caption,
        h('div', { class: 'actions center' },
          h('button', { class: 'btn primary', onclick: share, disabled: !hasData }, 'Share contact (.vcf)'),
          h('button', { class: 'btn ghost', onclick: sendLink, disabled: !hasData }, '🔗 My card’s link…'),
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

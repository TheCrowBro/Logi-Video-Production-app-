// Using Vdex means agreeing to its terms of service. Nothing in the app starts until they have been agreed to on this
// device, and everyone is asked again when the terms change: bump TERMS_VERSION then and update terms.html. The
// agreement is kept on the device, with when it was given. The privacy policy is shown alongside to inform, and is
// deliberately not part of the agreement (terms.html section 1).
import { h } from './util.js';

export const TERMS_VERSION = '2026-11-02.3'; // the terms' date, plus a count for a second change on the same day
const KEY = 'logi-terms';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
export const acceptance = () => { const r = read(); return r && r.v === TERMS_VERSION ? r : null; };

export function termsGate() {
  if (acceptance()) return Promise.resolve();
  const changed = !!read(); // accepted an earlier version
  return new Promise(resolve => {
    const others = [...document.body.children];
    others.forEach(el => { el.inert = true; });
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    const box = h('input', { type: 'checkbox', id: 'terms-ok' });
    const go = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Agree and continue');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    const form = h('form', { class: 'terms-card' },
      h('img', { src: 'icons/icon.svg', alt: '', class: 'terms-icon' }),
      h('h1', { id: 'terms-title' }, changed ? 'The terms have changed' : 'Before you start'),
      h('p', null, changed ? 'Please read and agree to the updated terms of service to keep using Vdex. Your information is safe and stays where it is.' : 'Vdex is free. To use it, please read and agree to its terms of service.'),
      h('ul', { class: 'terms-points' },
        h('li', null, 'Vdex comes as it is. It can have mistakes or lose information, so keep your own backups.'),
        h('li', null, 'You stay responsible for your shoots, your call sheets, quotes and invoices, your taxes, people’s safety, and the information you keep about others.'),
        h('li', null, 'The developer’s responsibility is very limited: many kinds of loss are excluded and the rest is capped at 50 US dollars (', link('terms.html#liability', 'sections 13 and 14'), '). This does not affect rights the law gives you that cannot be taken away.'),
        h('li', null, 'Your information stays on your device, and in storage you link. The developer never receives it.')),
      h('p', { class: 'terms-links' }, link('terms.html', 'Read the terms of service'), link('privacy.html', 'Read the privacy policy')),
      h('label', { class: 'check terms-check', for: 'terms-ok' }, box, h('span', null, 'I have read and agree to the ', link('terms.html', 'terms of service'), '.')),
      h('p', { class: 'small' }, 'The ', link('privacy.html', 'privacy policy'), ' explains how your information is handled.'),
      go,
      h('p', { class: 'small muted' }, 'If you don’t agree, close Vdex. Nothing is sent anywhere, and anything already on this device stays here.'));
    const gate = h('div', { class: 'terms-gate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'terms-title' }, form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!box.checked) return;
      try { localStorage.setItem(KEY, JSON.stringify({ v: TERMS_VERSION, at: new Date().toISOString() })); } catch { /* private mode: asked again next time */ }
      gate.remove(); others.forEach(el => { el.inert = false; });
      resolve();
    });
    document.body.append(gate);
    box.focus();
  });
}

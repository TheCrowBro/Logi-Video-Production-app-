// Using Vdex means agreeing to its terms of service and privacy policy. Nothing in the app starts until they have
// been accepted on this device, and everyone is asked again when the terms change: bump TERMS_VERSION then (to the
// terms' "Last updated" date) and update terms.html. The acceptance is kept on the device, with when it was given.
import { h } from './util.js';

export const TERMS_VERSION = '2026-11-02';
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
      h('p', null, changed ? 'Please read and accept the updated terms of service to keep using Vdex. Your information is safe and stays where it is.' : 'Vdex is free. To use it, please read and accept its terms of service and privacy policy.'),
      h('ul', { class: 'terms-points' },
        h('li', null, 'Vdex comes as it is. It can have mistakes or lose information, so keep your own backups.'),
        h('li', null, 'You stay responsible for your shoots, your quotes and invoices, your taxes, people’s safety, and the information you keep about others.'),
        h('li', null, 'As far as the law allows, the developer is not responsible for losses from using Vdex. Rights the law says cannot be taken away stay with you.'),
        h('li', null, 'Your information stays on your device, and in storage you link. The developer never receives it.')),
      h('p', { class: 'terms-links' }, link('terms.html', 'Read the terms of service'), link('privacy.html', 'Read the privacy policy')),
      h('label', { class: 'check terms-check', for: 'terms-ok' }, box, h('span', null, 'I have read and accept the ', link('terms.html', 'terms of service'), ' and the ', link('privacy.html', 'privacy policy'), '.')),
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

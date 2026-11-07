// Using Vdex means agreeing to its terms of service. Nothing in the app starts until they have been agreed to on this
// device, and everyone is asked again when the terms change: bump TERMS_VERSION then and update terms.html. The
// agreement is kept on the device, with when it was given. The privacy policy is shown alongside to inform, and is
// deliberately not part of the agreement (terms.html section 1).
import { h } from './util.js';
import { isApp } from './native.js';

export const TERMS_VERSION = '2026-11-07'; // the terms' date, plus a count for a second change on the same day
const KEY = 'logi-terms';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
export const acceptance = () => { const r = read(); return r && r.v === TERMS_VERSION ? r : null; };

export function termsGate() {
  if (acceptance()) return Promise.resolve();
  const changed = !!read(); // accepted an earlier version
  let why = ''; try { why = sessionStorage.getItem('logi-wiped') || ''; if (why) sessionStorage.removeItem('logi-wiped'); } catch { /* ignore */ } // the device was just erased: say so here, where the person lands
  return new Promise(resolve => {
    const others = [...document.body.children];
    others.forEach(el => { el.inert = true; });
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    const box = h('input', { type: 'checkbox', id: 'terms-ok' });
    const go = h('button', { class: 'btn primary', type: 'submit', disabled: true }, 'Agree and continue');
    box.addEventListener('change', () => { go.disabled = !box.checked; });
    const form = h('form', { class: 'terms-card' },
      h('img', { src: 'icons/icon.svg', alt: '', class: 'terms-icon' }),
      why && h('p', { class: 'warn small', role: 'status' }, why),
      h('h1', { id: 'terms-title' }, changed ? 'The terms have changed' : 'Before you start'),
      h('p', null, changed ? 'Please read and agree to the updated terms of service to keep using Vdex. Your information is safe and stays where it is.' : (isApp ? 'Vdex is free to try for 30 days. After that it becomes read-only until you buy the Vdex Licence in the app, a one-off purchase whose price the App Store shows before you buy, or sign in with a licence you already have. Cloud storage, backup files and spreadsheets need the licence from the start. ' : 'Vdex is free to try for 30 days, then needs a licence. ') + 'To use it, please read and agree to its terms of service.'),
      h('ul', { class: 'terms-points' },
        h('li', null, 'Vdex comes as it is. It can have mistakes or lose information, so keep your own backups.'),
        h('li', null, 'You stay responsible for your shoots, your call sheets, quotes and invoices, your taxes, people’s safety, and the information you keep about others.'),
        h('li', null, 'The developer’s responsibility is limited (', link('terms.html#liability', 'sections 13 to 16'), '). If you use Vdex for your business, many kinds of loss are excluded and the rest is capped at 50 US dollars. If you use it as a consumer, you keep your legal rights.'),
        h('li', null, 'Your work stays on your device, and in storage you link. The developer never receives it.')),
      h('p', { class: 'terms-links' }, link('terms.html', 'Read the terms of service'), link('privacy.html', 'Read the privacy policy')),
      h('label', { class: 'check terms-check', for: 'terms-ok' }, box, h('span', null, 'I am 18 or over, and I have read and agree to the ', link('terms.html', 'terms of service'), '.')),
      h('p', { class: 'small' }, 'The ', link('privacy.html', 'privacy policy'), ' explains how your information is handled.'),
      go,
      changed && h('p', { class: 'small' }, 'Want your information first? ', h('button', { type: 'button', class: 'btn ghost small terms-save', onclick: () => import('./backup.js').then(m => m.exportFile({ always: true })).catch(() => {}) }, 'Save a backup file'), ' It works whether or not you have a licence.'),
      h('p', { class: 'small muted' }, changed ? 'If you don’t agree, close Vdex. Nothing is sent anywhere, and anything already on this device stays here, but Vdex will not open again until you agree.' : 'If you don’t agree, close Vdex. Nothing is sent anywhere, and anything already on this device stays here.'));
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

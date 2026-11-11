// "Install" affordance: Chrome/Edge/Android get the real install prompt; iOS and others get instructions.
import { h, sheet } from './util.js';

const standalone = () => ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred = null;
export const installState = () => ({ standalone: standalone(), canPrompt: !!deferred, ios: isIOS() });

export function initInstall(btn) {
  if (!btn) return;
  if (standalone()) { btn.hidden = true; return; }
  btn.hidden = false;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  window.addEventListener('appinstalled', () => { deferred = null; btn.hidden = true; });
  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
      if (outcome === 'accepted') { deferred = null; btn.hidden = true; }
      return;
    }
    openInstallHelp();
  });
}

export function openInstallHelp() {
  const ios = isIOS();
  const steps = ios
    ? [['Open this page in Safari', 'Other iPhone browsers can’t add web apps to the Home Screen.'], ['Tap the Share button', 'The square with an arrow, at the bottom of the screen.'], ['Choose “Add to Home Screen”', 'Then tap Add. Gigdex opens full-screen like any other app, and works offline.']]
    : [['Chrome, Edge or Samsung Internet', 'On Android: menu ⋮ → “Install app” or “Add to Home screen”. On a computer: the install icon at the right of the address bar, or menu → “Install Gigdex”.'], ['Firefox', 'Firefox doesn’t install web apps; keep using it in a tab, or bookmark the page.'], ['Your data stays on this device', 'Each browser keeps its own copy. Move it between devices with a backup file (☁ at the top).']];
  sheet('Install Gigdex', h('div', { class: 'stack' },
    h('p', null, 'Gigdex runs in the browser as it is. Installing it adds an icon to your home screen or desktop, opens it full-screen and keeps it available offline. Both ways use the same address.'),
    h('ol', { class: 'install-steps' }, steps.map(([t, d]) => h('li', null, h('b', null, t), h('div', { class: 'muted small' }, d)))),
    ios && h('p', { class: 'muted small' }, 'The microphone (tuner and sound meter) works in the installed app on iOS 16.4 or later.')));
}

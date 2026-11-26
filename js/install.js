// "Install" affordance (a row of the menu, listed only while Vdex is not installed): Chrome/Edge/Android get the real install prompt; iOS and others get instructions.
import { h, sheet } from './util.js';
import { isApp } from './native.js';

const desktopApp = () => /\bElectron\//.test(navigator.userAgent); // the Vdex desktop app (Windows, Mac, Linux installers)
// The Google Play app is installed already, whatever its window looks like: Android shows it without the browser's bar
// only once it has verified the app's link to the site, and as a tab with a bar until then. It is known by the address
// its icon opens, by where it came from, and afterwards by the mark js/licence-web.js keeps (a start by a link, a
// share or a reload comes without the address).
const playApp = () => { try { return /[?&]src=play(&|$)/.test(location.search) || /^android-app:\/\/app\.crowmade\.vdex/.test(document.referrer) || !!JSON.parse(localStorage.getItem('vdex-licence') || '{}').play; } catch { return false; } };
const standalone = () => desktopApp() || isApp || playApp() || ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferred = null, button = null;
export const installState = () => ({ standalone: standalone(), canPrompt: !!deferred, ios: isIOS() });
// The browser offers its install prompt once, a moment after the page has loaded: while the lock screen or the terms
// are still up, before the app starts (initInstall below runs after them). So it is listened for from the moment this
// file runs, and kept for the Install row.
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; if (button && !standalone()) button.hidden = false; });
window.addEventListener('appinstalled', () => { deferred = null; if (button) button.hidden = true; });

export function initInstall(btn) {
  if (!btn) return;
  button = btn;
  if (standalone()) { btn.hidden = true; return; }
  btn.hidden = false;
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
    ? [['Tap the Share button', 'In Safari: the square with an arrow, at the bottom of the screen (at the top on an iPad). In Chrome, Edge or Firefox: Share, beside the address or in the browser’s menu.'], ['Choose “Add to Home Screen”', 'Then tap Add. Vdex opens full-screen like any other app, and works offline once set up (a licence is checked online at least once every 90 days).']]
    : [['Chrome, Edge or Samsung Internet', 'On Android: menu ⋮ → “Install app” or “Add to Home screen”. On a computer: the install icon at the right of the address bar, or menu → “Install Vdex”.'], ['Firefox', 'On Android: menu ⋮ → “Add app to Home screen”. On a computer, keep using Vdex in a tab, or bookmark the page.'], ['Same data everywhere', 'Link a cloud storage under Storage, sync & backups, in the menu ☰, and the installed app, your phone and your browser all share one database.']];
  sheet('Install Vdex', h('div', { class: 'stack' },
    // On an iPhone or iPad the Home Screen app does not share Safari's storage: it starts as a copy of its own.
    h('p', null, 'Vdex runs in the browser as it is. Installing it adds an icon to your home screen or desktop, opens it full-screen and keeps it available offline. ', ios ? 'On an iPhone or iPad the Home Screen app keeps its own copy, apart from the browser’s: to bring across what you entered here, link the same cloud storage in both, or export a backup here and import it there (both need a licence).' : 'Both ways use the same address and the same data.'),
    h('ol', { class: 'install-steps' }, steps.map(([t, d]) => h('li', null, h('b', null, t), h('div', { class: 'muted small' }, d)))),
    ios && h('p', { class: 'muted small' }, 'The camera, microphone and location work in the installed app on iOS 16.4 or later.')));
}

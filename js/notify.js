// Break notifications: a system notification when a timed break is up (and optionally two minutes before),
// shown through the service worker so it carries a "Back to work" button. Needs the page to still be alive:
// fine on a computer; on a phone the browser may suspend the app a few minutes after it goes to the background,
// so there is an opt-in screen wake lock for breaks and a catch-up notification the moment the app resumes.
import { toast } from './util.js';

const KEY = 'logi-notify';
const DEF = { enabled: false, early: true, wake: false };
let prefs = { ...DEF };
try { prefs = { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
export const notifyPrefs = () => ({ ...prefs });
export const setNotifyPrefs = patch => { prefs = { ...prefs, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

const desktopApp = /\bElectron\//.test(navigator.userAgent); // the desktop app shows plain notifications: Electron has no service-worker ones
export const supported = () => 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try { const r = await Notification.requestPermission(); if (r === 'granted') setNotifyPrefs({ enabled: true }); return r; } catch { return permission(); }
}

async function show(title, body, { tag = 'logi-break', actions = [], urgent = false } = {}) {
  if (permission() !== 'granted') return false;
  const opts = { body, tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', vibrate: urgent ? [250, 100, 250, 100, 400] : [200, 100, 200], requireInteraction: urgent, data: { tag } };
  try {
    const reg = !desktopApp && 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) { await reg.showNotification(title, { ...opts, actions }); return true; }
    const n = new Notification(title, opts); // no service worker (plain page or the desktop app): still a notification, without the buttons
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch { return false; }
}

// One scheduled break at a time: timers keyed by the break's start time so a redraw never double-books.
let scheduled = { key: null, timers: [], fired: new Set() };
export function scheduleBreak(br, label, onEnd) {
  if (!br) return cancelBreak();
  if (scheduled.key === br.start) return;
  cancelBreak(); scheduled.key = br.start;
  if (!prefs.enabled || permission() !== 'granted' || !br.planned) return;
  const end = br.start + br.planned * 6e4, now = Date.now();
  const at = (when, id, fn) => { if (scheduled.fired.has(id)) return; const t = setTimeout(() => { scheduled.fired.add(id); fn(); }, Math.max(0, when - now)); scheduled.timers.push(t); };
  if (prefs.early && br.planned >= 10) at(end - 2 * 6e4, 'early', () => { if (background()) show('2 minutes left', `Your ${label} break ends soon.`, { tag: 'logi-break-early' }); });
  at(end, 'end', () => { show('Break’s up', `Your ${label} break is over — tap Back to work when you’re on set.`, { urgent: true, actions: [{ action: 'back', title: '▶ Back to work' }, { action: 'later', title: '5 more min' }] }); onEnd && onEnd(); });
}
export function cancelBreak() { scheduled.timers.forEach(clearTimeout); scheduled = { key: null, timers: [], fired: new Set() }; }
const background = () => document.hidden || !document.hasFocus();

export const notifyAllowanceUsed = () => show('Approved break used up', 'Today’s approved break time for this production is gone.', { tag: 'logi-allowance' });

// Keep the screen on while a timed break runs (phones suspend background pages; a lit screen keeps the timer alive).
let lock = null;
export async function holdScreen(on) {
  if (!('wakeLock' in navigator)) return false;
  if (!on || !prefs.wake) { try { await lock?.release(); } catch { /* fine */ } lock = null; return false; }
  if (lock && !lock.released) return true;
  try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); return true; } catch { lock = null; return false; }
}

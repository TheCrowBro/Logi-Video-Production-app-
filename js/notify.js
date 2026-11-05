// Break notifications: a system notification when a timed break is up (and optionally two minutes before),
// shown through the service worker so it carries a "Back to work" button. Needs the page to still be alive:
// fine on a computer; on a phone the browser may suspend the app a few minutes after it goes to the background,
// so there is an opt-in screen wake lock for breaks and a catch-up notification the moment the app resumes.
// In the iPhone app the phone itself keeps the appointment: the notifications are scheduled with it for their
// times, with the same buttons, and arrive with the app closed (js/native.js).
import { toast } from './util.js';
import * as native from './native.js';

const KEY = 'logi-notify';
const DEF = { enabled: false, early: true, wake: false };
let prefs = { ...DEF };
try { prefs = { ...DEF, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
export const notifyPrefs = () => ({ ...prefs });
export const setNotifyPrefs = patch => { prefs = { ...prefs, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } };

const desktopApp = /\bElectron\//.test(navigator.userAgent); // the desktop app shows plain notifications: Electron has no service-worker ones
const phoneApp = native.notifications.available(); // the iPhone app: the phone's own notifications, scheduled with it
export const supported = () => phoneApp || 'Notification' in window;
// 'granted' | 'denied' | 'default' (not asked yet) | 'unsupported'
export const permission = () => (phoneApp ? { granted: 'granted', denied: 'denied' }[native.notifications.permission()] || 'default' : supported() ? Notification.permission : 'unsupported');
export const closedToo = () => phoneApp; // the alert comes with the app closed
export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try {
    const r = phoneApp ? await native.notifications.request() : await Notification.requestPermission();
    if (r === 'granted') setNotifyPrefs({ enabled: true });
    return permission();
  } catch { return permission(); }
}
if (phoneApp) native.notifications.refresh();

// The phone's notification ids: one of each kind at a time, so a re-schedule replaces rather than adds.
const IDS = { 'logi-break': 1, 'logi-break-early': 2, 'logi-allowance': 3 };
async function show(title, body, { tag = 'logi-break', actions = [], urgent = false, at = 0 } = {}) {
  if (permission() !== 'granted') return false;
  if (phoneApp) { try { return await native.notifications.schedule([{ id: IDS[tag] || 9, title, body, at, actions: actions.length > 0, extra: { tag } }]); } catch { return false; } }
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
  const endWords = ['Break’s up', `Your ${label} break is over — tap Back to work when you’re on set.`];
  if (phoneApp) {
    // The phone keeps the times, app open or not; the page's own countdown still says it in the foreground.
    const list = [{ id: IDS['logi-break'], title: endWords[0], body: endWords[1], at: Math.max(end, now + 1000), actions: true, extra: { tag: 'logi-break' } }];
    if (prefs.early && br.planned >= 10 && end - 2 * 6e4 > now) list.push({ id: IDS['logi-break-early'], title: '2 minutes left', body: `Your ${label} break ends soon.`, at: end - 2 * 6e4, extra: { tag: 'logi-break-early' } });
    native.notifications.schedule(list).catch(() => {});
    const t = setTimeout(() => { if (!scheduled.fired.has('end')) { scheduled.fired.add('end'); onEnd && onEnd(); } }, Math.max(0, end - now)); scheduled.timers.push(t);
    return;
  }
  const at = (when, id, fn) => { if (scheduled.fired.has(id)) return; const t = setTimeout(() => { scheduled.fired.add(id); fn(); }, Math.max(0, when - now)); scheduled.timers.push(t); };
  if (prefs.early && br.planned >= 10) at(end - 2 * 6e4, 'early', () => { if (background()) show('2 minutes left', `Your ${label} break ends soon.`, { tag: 'logi-break-early' }); });
  at(end, 'end', () => { show(endWords[0], endWords[1], { urgent: true, actions: [{ action: 'back', title: '▶ Back to work' }, { action: 'later', title: '5 more min' }] }); onEnd && onEnd(); });
}
export function cancelBreak() {
  scheduled.timers.forEach(clearTimeout); scheduled = { key: null, timers: [], fired: new Set() };
  if (phoneApp) native.notifications.cancel([IDS['logi-break'], IDS['logi-break-early']]).catch(() => {});
}
const background = () => document.hidden || !document.hasFocus();

export const notifyAllowanceUsed = () => show('Approved break used up', 'Today’s approved break time for this production is gone.', { tag: 'logi-allowance' });

// The buttons on a notification: cb('break-end' | 'break-extend'). The service worker's come through js/clock.js; the
// phone's come through here.
const actionSubs = new Set();
export const onAction = cb => { actionSubs.add(cb); return () => actionSubs.delete(cb); };
if (phoneApp) native.notifications.onAction((id, extra) => { if (extra && extra.tag && extra.tag !== 'logi-break') return; const type = id === 'back' ? 'break-end' : id === 'later' ? 'break-extend' : null; if (type) actionSubs.forEach(f => f(type)); });

// Keep the screen on while a timed break runs (phones suspend background pages; a lit screen keeps the timer alive).
let lock = null;
export async function holdScreen(on) {
  if (!('wakeLock' in navigator)) return false;
  if (!on || !prefs.wake) { try { await lock?.release(); } catch { /* fine */ } lock = null; return false; }
  if (lock && !lock.released) return true;
  try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); return true; } catch { lock = null; return false; }
}

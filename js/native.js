// The iPhone app (apple/): Vdex's website inside a thin app, which puts window.Capacitor on the page with the phone's
// own plugins. This is the one module that knows them. Everything else asks it the same questions and takes the web
// way when the answer is no: is this the app, and can it notify, save, open, share, print, buy and keep a calendar.
// Nothing here runs outside the app: the checks are cheap and every function is a plain no-op on the website.
const cap = typeof window !== 'undefined' ? window.Capacitor : null;
export const isApp = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform() && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios');
const plugin = name => (isApp && cap.Plugins && cap.Plugins[name]) || null;
export const has = name => !!plugin(name);
// The device, as the licence server lists it among a licence's places.
export const device = () => (/iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : 'iPhone');

/* ------------------------------- bytes ------------------------------- */
const b64 = async data => {
  if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
  else if (typeof data === 'string') data = new TextEncoder().encode(data);
  else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
  let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const fileOf = f => (f && f.name ? new File([fromB64(f.data || '')], f.name, { type: f.type || 'application/octet-stream' }) : null);

/* ------------------------------- files ------------------------------- */
// The Files app: save a file where the person chooses, open one, share one through the phone's share sheet.
export const files = {
  // → true once the file is saved somewhere, false when the picker is dismissed.
  async save(name, data, type = 'application/octet-stream') {
    const p = plugin('DocumentPicker'); if (!p) return false;
    const r = await p.save({ name, data: await b64(data), type });
    return !!(r && r.saved);
  },
  // → a File, or null when the picker is dismissed.
  async open(types = []) {
    const p = plugin('DocumentPicker'); if (!p) return null;
    return fileOf(await p.open({ types }));
  },
  // The share sheet with the file attached (Mail, Messages, AirDrop, Save to Files…). → false when dismissed.
  async share(name, data, type = 'application/octet-stream', { title = name, text = '' } = {}) {
    const fs = plugin('Filesystem'), sh = plugin('Share'); if (!fs || !sh) return false;
    const w = await fs.writeFile({ path: 'share/' + name, data: await b64(data), directory: 'CACHE', recursive: true });
    try { await sh.share({ title, text: text || undefined, files: [w.uri] }); return true; }
    catch (e) { if (/cancel/i.test(String(e && e.message))) return false; throw e; }
    finally { fs.deleteFile({ path: 'share/' + name, directory: 'CACHE' }).catch(() => {}); }
  },
  // The phone's print sheet for the page (AirPrint, or Save to Files as a PDF). → whether the sheet finished with a print.
  async print() {
    const p = plugin('DocumentPicker'); if (!p) return false;
    const r = await p.print(); return !!(r && r.printed);
  },
  // Files other apps hand to Vdex (a script from Mail or Files, a backup): each arrives here as a File.
  onShared(cb) {
    const p = plugin('DocumentPicker'); if (!p) return;
    p.addListener('file', f => { const file = fileOf(f); if (file) cb(file); });
  },
};
export const canShareFiles = () => isApp && has('Share') && has('Filesystem');

/* ---------------------------- notifications ---------------------------- */
// The phone's own notifications, which arrive with the app closed: scheduled for a time, with buttons.
const ACTIONS = 'VDEX_BREAK';
let perm = 'prompt', actionsRegistered = false;
const actionSubs = new Set();
let heldActions = []; // pressed before anyone listens (the app opened by the button, the lock screen first): handed to the first listener
export const notifications = {
  available: () => has('LocalNotifications'),
  // 'granted' | 'denied' | 'prompt', as last seen (asking the phone is asynchronous; refresh() keeps this current).
  permission: () => perm,
  async refresh() { const p = plugin('LocalNotifications'); if (!p) return perm; try { perm = (await p.checkPermissions()).display || perm; } catch { /* keep */ } return perm; },
  async request() { const p = plugin('LocalNotifications'); if (!p) return 'denied'; try { perm = (await p.requestPermissions()).display || 'denied'; } catch { perm = 'denied'; } return perm; },
  // list: [{ id, title, body, at (ms, optional: now when missing), actions (true for the break buttons), extra }]
  async schedule(list) {
    const p = plugin('LocalNotifications'); if (!p || !list.length) return false;
    if (!actionsRegistered) { actionsRegistered = true; await p.registerActionTypes({ types: [{ id: ACTIONS, actions: [{ id: 'back', title: 'Back to work', foreground: true }, { id: 'later', title: '5 more minutes' }] }] }).catch(() => {}); }
    await p.schedule({ notifications: list.map(n => ({ id: n.id, title: n.title, body: n.body, ...(n.at ? { schedule: { at: new Date(n.at), allowWhileIdle: true } } : {}), ...(n.actions ? { actionTypeId: ACTIONS } : {}), extra: n.extra || {}, sound: 'default' })) });
    return true;
  },
  async cancel(ids) { const p = plugin('LocalNotifications'); if (!p || !ids.length) return; await p.cancel({ notifications: ids.map(id => ({ id })) }).catch(() => {}); },
  // The buttons on a notification, and a tap on it: cb('back' | 'later' | 'tap', extra).
  onAction(cb) { actionSubs.add(cb); const held = heldActions; heldActions = []; for (const [id, extra] of held) { try { cb(id, extra); } catch { /* ignore */ } } return () => actionSubs.delete(cb); },
};
{
  const p = plugin('LocalNotifications');
  if (p) {
    notifications.refresh();
    p.addListener('localNotificationActionPerformed', ev => {
      const id = (ev && ev.actionId) || 'tap', extra = ev && ev.notification && ev.notification.extra;
      if (!actionSubs.size) { heldActions.push([id, extra]); return; }
      actionSubs.forEach(f => { try { f(id, extra); } catch { /* ignore */ } });
    });
  }
}

/* -------------------------------- haptics -------------------------------- */
export function haptic(ms = 12) {
  const p = plugin('Haptics'); if (!p) return false;
  p.impact({ style: ms >= 60 ? 'HEAVY' : ms >= 25 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
  return true;
}

/* -------------------------------- calendar -------------------------------- */
// The phone's calendar (EventKit through @ebarooni/capacitor-calendar): a "Vdex bookings" calendar kept in step both ways.
const CAL = () => plugin('CapacitorCalendar');
export const calendar = {
  available: () => has('CapacitorCalendar'),
  // → 'granted' | 'denied' | 'prompt'
  async access() {
    const c = CAL(); if (!c) return 'denied';
    const now = (await c.checkAllPermissions().catch(() => ({ result: {} }))).result || {};
    if (now.readCalendar === 'granted' && now.writeCalendar === 'granted') return 'granted';
    return (await c.requestFullCalendarAccess()).result || 'denied';
  },
  async calendars() { const c = CAL(); return c ? ((await c.listCalendars()).result || []) : []; },
  async createCalendar(title) { const c = CAL(); const r = await c.createCalendar({ title, color: '#e0a43a' }); return r.id; },
  async events(from, to) { const c = CAL(); return c ? ((await c.listEventsInRange({ from, to })).result || []) : []; },
  async create(ev) { const c = CAL(); return (await c.createEvent(ev)).id; },
  async update(ev) { const c = CAL(); await c.modifyEvent(ev); },
  async remove(id) { const c = CAL(); await c.deleteEvent({ id }); },
  // The phone's own "new event" screen, filled in: → whether it was saved.
  async prompt(ev) { const c = CAL(); if (!c) return false; const r = await c.createEventWithPrompt(ev); return !!(r && r.id); },
};

/* ------------------------------- purchases ------------------------------- */
// The App Store purchase of the licence (StoreKit 2, PurchasesPlugin.swift). Apple signs the purchase; the licence server
// checks that signature (cloudflare/worker.mjs) and makes it a licence like any other.
export const purchases = {
  available: () => has('Purchases'),
  // → { id, name, description, price (in the person's currency, "19,99 €") } or null
  async product(id) { const p = plugin('Purchases'); if (!p) return null; const r = await p.products({ ids: [id] }); return (r.products || []).find(x => x.id === id) || null; },
  // → { state: 'purchased', jws, … } | { state: 'cancelled' } | { state: 'pending' }
  async buy(id) { const p = plugin('Purchases'); if (!p) throw new Error('Buying in the app is not available here'); return p.buy({ id }); },
  // What this Apple ID owns: [{ state: 'owned' | 'revoked', jws, productId, … }]
  async owned() { const p = plugin('Purchases'); if (!p) return []; return (await p.current()).entitlements || []; },
  async restore() { const p = plugin('Purchases'); if (!p) return; await p.restore(); },
  // Purchases that finish outside buy() (an Ask to Buy approval, an interrupted purchase, another device): cb(transaction).
  onTransaction(cb) { const p = plugin('Purchases'); if (p) p.addListener('transaction', t => { try { cb(t); } catch { /* ignore */ } }); },
};

/* ------------------------------- sign-ins ------------------------------- */
// The phone's own sign-in window (ASWebAuthenticationSession: it shares Safari's sign-ins and is what Google, Microsoft,
// Dropbox and Apple expect of an app). The window ends on a vdex:// address, which comes back here.
export const auth = {
  available: () => has('WebAuth'),
  // → the vdex://… address the window ended on, or null when it was closed before the end.
  async start(url) { const p = plugin('WebAuth'); if (!p) return null; const r = await p.start({ url, scheme: 'vdex' }); return r && r.url ? String(r.url) : null; },
};

/* ------------------------------ legal pages ------------------------------ */
// In the iPhone app, the terms and the privacy policy open inside the app, not in Safari: Safari would show the
// website, with its own way to buy, outside the app. Both pages end with a link back to Vdex.
if (isApp && typeof document !== 'undefined') document.addEventListener('click', e => {
  const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
  if (!a || !a.href) return;
  let u; try { u = new URL(a.href, location.href); } catch { return; }
  if (u.origin !== location.origin || !/\/(terms|privacy)\.html$/.test(u.pathname)) return;
  e.preventDefault(); location.href = u.href;
}, true);

/* --------------------------------- the app --------------------------------- */
// Back from the background (the clock catches up, the licence looks again).
export function onResume(cb) { const p = plugin('App'); if (p) p.addListener('appStateChange', s => { if (s && s.isActive) cb(); }); }

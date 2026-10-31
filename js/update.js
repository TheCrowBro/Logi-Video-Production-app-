// Keeps the app current. The service worker is registered here; when a new build has been deployed (every push
// to the site stamps one), the new worker installs in the background and a bar offers to reload. Checks happen on
// start, when the app comes back to the front, when the network returns, and every hour. The desktop app has no
// service worker; its own updater (desktop/updater.js) is reached through window.vdexDesktop.
import { h, announce } from './util.js';
import { VERSION, BUILD, BUILT } from './version.js';

const S = { reg: null, ready: false, last: 0, bar: null, desktop: null, listeners: new Set() };
export const desktop = () => window.vdexDesktop || null;
export const onChange = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const emit = () => S.listeners.forEach(f => { try { f(); } catch { /* ignore */ } });
export const updateState = () => ({ version: VERSION, build: BUILD, built: BUILT, ready: S.ready, supported: !!S.reg, lastCheck: S.last, desktop: S.desktop });

export function reloadNow() {
  if (document.querySelector('.sheet-back form') && !confirm('Reload now? Anything typed in the open form will be lost.')) return;
  location.reload();
}
function showBar() {
  if (S.bar) return;
  S.bar = h('div', { class: 'update-bar', role: 'status' },
    h('span', null, 'Vdex has been updated.'),
    h('button', { class: 'btn primary small', onclick: reloadNow }, 'Reload for the new version'),
    h('button', { class: 'icon-btn', 'aria-label': 'Not now', onclick: () => { S.bar.remove(); S.bar = null; document.body.classList.remove('has-update-bar'); } }, '✕'));
  document.body.append(S.bar); document.body.classList.add('has-update-bar'); // room to scroll the page above the bar
  announce('A new version of Vdex is ready. Reload to use it.');
}

// Asks the browser to look for a new service worker now. Resolves once an update, if any, has taken over.
export async function checkForUpdates() {
  const d = desktop();
  if (d) { const s = await d.checkForUpdates(); S.desktop = s; emit(); return s; }
  if (!S.reg) return { status: 'unsupported' };
  S.last = Date.now(); emit();
  try { await S.reg.update(); } catch { return { status: 'offline' }; }
  const w = S.reg.installing || S.reg.waiting;
  if (w && !S.ready) {
    if (S.reg.waiting) S.reg.waiting.postMessage('skip-waiting');
    await new Promise(res => { const t = setTimeout(res, 20000); const stop = onChange(() => { if (S.ready) { clearTimeout(t); stop(); res(); } }); w.addEventListener('statechange', () => { if (w.state === 'redundant') { clearTimeout(t); stop(); res(); } }); });
  }
  return { status: S.ready ? 'ready' : 'current', version: VERSION, build: BUILD };
}

export function initUpdates() {
  const d = desktop();
  if (d) { // the desktop app ships its files inside the installer; a service worker would only keep stale copies
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
    d.updateState().then(s => { S.desktop = s; emit(); }).catch(() => {});
    d.onStatus(s => { S.desktop = s; emit(); });
    return;
  }
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) { S.ready = true; emit(); showBar(); }
    controlled = true;
    setTimeout(() => { try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('cleanup'); } catch { /* ignore */ } }, 3000);
  });
  // Registered once the page has loaded, so a first visit's own downloads are not competing with the offline copy.
  const register = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => { S.reg = reg; S.last = Date.now(); emit(); if (reg.waiting) reg.waiting.postMessage('skip-waiting'); }).catch(() => {});
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
  const check = () => { if (S.reg && !S.ready && Date.now() - S.last > 10 * 60000) { S.last = Date.now(); S.reg.update().catch(() => {}); } };
  setInterval(check, 60 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
}

/* ------------------------------ Settings → About ------------------------------ */
export function updatePanel() {
  const el = h('div', { class: 'stack' });
  let busy = false;
  const draw = () => {
    const st = updateState(), d = desktop(), ds = st.desktop;
    const when = st.lastCheck ? new Date(st.lastCheck).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    let line, actions = [];
    if (d) {
      const s = ds ? ds.status : 'idle';
      line = s === 'dev' ? 'Development run: updates are only checked in the installed app.'
        : s === 'checking' ? 'Checking for updates…'
        : s === 'downloading' ? `Downloading Vdex ${ds.available}… ${ds.progress || 0}%`
        : s === 'ready' ? `Vdex ${ds.available} is ready to install.`
        : s === 'available' ? `Vdex ${ds.available} is available to download.`
        : s === 'current' ? `Up to date${when ? ' · checked ' + when : ''}.`
        : s === 'error' ? `Could not check for updates (${ds.error || 'no connection'}).`
        : 'Vdex checks GitHub for new releases when it starts and every few hours.';
      if (s === 'ready') actions.push(h('button', { class: 'btn primary', onclick: () => d.installUpdate() }, '↻ Restart to update'));
      if (s === 'available' || s === 'error') actions.push(h('button', { class: 'btn ghost', onclick: () => d.openDownload() }, '⤓ Download the new version'));
    } else {
      line = st.ready ? 'A new version has been downloaded. Reload to use it.'
        : !st.supported ? 'Updates arrive when the site is reloaded (this browser keeps no offline copy).'
        : `Up to date${when ? ' · checked ' + when : ''}. New versions are fetched in the background whenever you open Vdex.`;
      if (st.ready) actions.push(h('button', { class: 'btn primary', onclick: reloadNow }, '↻ Reload now'));
    }
    const showCheck = d ? (ds ? ds.status !== 'dev' : true) : st.supported && !st.ready;
    if (showCheck) actions.push(h('button', { class: 'btn ghost', disabled: busy, onclick: async () => { busy = true; draw(); try { await checkForUpdates(); } finally { busy = false; draw(); } } }, busy ? 'Checking…' : 'Check for updates'));
    el.replaceChildren(h('p', { class: 'small muted' }, line), actions.length ? h('div', { class: 'actions' }, ...actions) : '');
  };
  draw();
  const off = onChange(draw);
  return { el, destroy: off };
}

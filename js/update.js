// Keeps the app current. The service worker is registered here; when a new build has been deployed (every push
// to the site stamps one), the new worker installs in the background and a bar offers to reload. Checks happen on
// start, when the app comes back to the front, when the network returns, and every hour. The desktop app has no
// service worker; its own updater (desktop/updater.js) is reached through window.vdexDesktop.
import { h, announce, underCover } from './util.js';
import { VERSION, BUILD, BUILT } from './version.js';

const S = { reg: null, ready: false, last: 0, asked: 0, failed: false, bar: null, desktop: null, listeners: new Set() };
export const desktop = () => window.vdexDesktop || null;
export const onChange = fn => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
const emit = () => S.listeners.forEach(f => { try { f(); } catch { /* ignore */ } });
// lastCheck: the last check that got through. failed: the latest one did not (no connection). coming: a new build is
// being fetched and has not taken over yet.
export const updateState = () => ({ version: VERSION, build: BUILD, built: BUILT, ready: S.ready, supported: !!S.reg, lastCheck: S.last, failed: S.failed, coming: !!S.reg && !S.ready && !!S.reg.active && !!(S.reg.installing || S.reg.waiting), desktop: S.desktop }); // (with no worker in charge yet it is the first offline copy that is being fetched, not a new version)

// A reload loses what is typed and not saved. In a sheet that is a form or any box with something in it; on the page it
// is a box whose text is kept only at a tap (data-draft: the timecode note being written). So it asks first.
export function reloadNow() {
  const text = el => !el.readOnly && !el.disabled && !['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color', 'hidden'].includes(el.type) && !!el.value;
  const typed = [...document.querySelectorAll('#page [data-draft], .sheet-back textarea, .sheet-back input')].some(text) || document.body.hasAttribute('data-draft-held'); // …or held while another section is in front (js/pages/tcnotes.js says so on the body)
  if ((typed || document.querySelector('.sheet-back form')) && !confirm('Reload now? Anything typed and not saved will be lost.')) return;
  location.reload();
}
function showBar() {
  if (S.bar) return;
  S.bar = underCover(h('div', { class: 'update-bar', role: 'status' },
    h('span', null, 'Vdex has been updated.'),
    h('button', { class: 'btn primary small', onclick: reloadNow }, 'Reload for the new version'),
    h('button', { class: 'icon-btn', 'aria-label': 'Not now', onclick: () => { S.bar.remove(); S.bar = null; document.body.classList.remove('has-update-bar'); } }, '✕'))); // under the lock screen it is out of reach like the rest
  document.body.append(S.bar); document.body.classList.add('has-update-bar'); // room to scroll the page above the bar
  announce('A new version of Vdex is ready. Reload to use it.');
}

// Asks the browser to look for a new service worker now. Resolves once an update, if any, has taken over.
export async function checkForUpdates() {
  const d = desktop();
  if (d) { let s; try { s = await d.checkForUpdates(); } catch (e) { s = { status: 'error', error: (e && e.message) || '' }; } S.desktop = s; emit(); return s; }
  if (!S.reg) return { status: 'unsupported' };
  S.asked = Date.now();
  try { await S.reg.update(); } catch { S.failed = true; emit(); return { status: 'offline' }; } // no connection: the time of the last check that got through stays
  S.failed = false; S.last = Date.now(); emit();
  const w = S.reg.installing || S.reg.waiting;
  if (w && !S.ready) {
    if (S.reg.waiting) S.reg.waiting.postMessage('skip-waiting');
    await new Promise(res => { const t = setTimeout(res, 20000); const stop = onChange(() => { if (S.ready) { clearTimeout(t); stop(); res(); } }); w.addEventListener('statechange', () => { if (w.state === 'redundant') { clearTimeout(t); stop(); res(); } }); });
  }
  return { status: S.ready ? 'ready' : updateState().coming ? 'downloading' : 'current', version: VERSION, build: BUILD }; // downloading: found, and still being fetched after 20 seconds
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
  const arrived = () => { if (S.ready) return; S.ready = true; emit(); showBar(); };
  // A new build can take over before this runs: the app starts only after the lock screen (and the terms), and a
  // worker found at that start is in charge within seconds. Its take-over then had no listener here, so the worker in
  // charge is asked which build it is (sw.js answers), and one that is not this page's build is the update.
  if (controlled) {
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'build' && e.data.build && e.data.build !== BUILD) arrived(); });
    try { navigator.serviceWorker.controller.postMessage('build'); } catch { /* the worker has gone: the next take-over is heard below */ }
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) arrived();
    controlled = true;
    setTimeout(() => { try { navigator.serviceWorker.controller && navigator.serviceWorker.controller.postMessage('cleanup'); } catch { /* ignore */ } }, 3000);
  });
  // Registered once the page has loaded, so a first visit's own downloads are not competing with the offline copy.
  // A build being fetched is shown as such in Settings: the panel is drawn again when one is found and as it moves on.
  const register = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // A start is a check only if the server was reached: with a worker already in charge the page came from the offline
    // copy, so the server is asked now, and the time is kept when it answers (a start with no connection says it could
    // not check). A first visit has just fetched everything.
    S.reg = reg; S.asked = Date.now();
    if (reg.active) reg.update().then(() => { S.failed = false; S.last = Date.now(); emit(); }, () => { S.failed = true; emit(); }); else S.last = Date.now();
    emit(); if (reg.waiting) reg.waiting.postMessage('skip-waiting');
    reg.addEventListener('updatefound', () => { emit(); if (reg.installing) reg.installing.addEventListener('statechange', emit); });
  }).catch(() => {});
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
  const check = () => { if (S.reg && !S.ready && Date.now() - S.asked > 10 * 60000) { S.asked = Date.now(); S.reg.update().then(() => { S.failed = false; S.last = Date.now(); emit(); }, () => { S.failed = true; emit(); }); } };
  setInterval(check, 60 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('online', check);
}

/* ------------------------ Settings → General → About & Licence ------------------------ */
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
        : s === 'store' ? 'Updates come from the store this copy was installed from.'
        : 'Vdex checks for new versions when it starts and every few hours.';
      if (s === 'ready') actions.push(h('button', { class: 'btn primary', onclick: () => d.installUpdate() }, '↻ Restart to update'));
      if (s === 'available') actions.push(h('button', { class: 'btn ghost', onclick: () => d.openDownload() }, '⤓ Download the new version'));
      if (s === 'error') actions.push(h('button', { class: 'btn ghost', onclick: () => d.openDownload() }, 'Open the download page')); // no new version is known: the page lists what there is
    } else {
      line = st.ready ? 'A new version has been downloaded. Reload to use it.'
        : !st.supported ? 'Updates arrive when the site is reloaded (this browser keeps no offline copy).'
        : st.coming ? 'A new version is downloading…'
        : st.failed ? `Could not check for updates (no connection).${when ? ' Last checked ' + when + '.' : ''}`
        : `Up to date${when ? ' · checked ' + when : ''}. New versions are fetched in the background whenever you open Vdex.`;
      if (st.ready) actions.push(h('button', { class: 'btn primary', onclick: reloadNow }, '↻ Reload now'));
    }
    const showCheck = d ? (ds ? !['dev', 'store'].includes(ds.status) : true) : st.supported && !st.ready;
    if (showCheck) actions.push(h('button', { class: 'btn ghost', disabled: busy, onclick: async () => { busy = true; draw(); try { await checkForUpdates(); } finally { busy = false; draw(); } } }, busy ? 'Checking…' : 'Check for updates'));
    el.replaceChildren(h('p', { class: 'small muted' }, line), actions.length ? h('div', { class: 'actions' }, ...actions) : '');
  };
  draw();
  const off = onChange(draw);
  return { el, destroy: off };
}

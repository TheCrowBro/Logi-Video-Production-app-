// Redundancy: how recent the last off-device copy is, backup files (plain or passphrase-encrypted), restoring one of
// the automatic cloud backups, and an asset register of the kit for insurers and police.
import { h, sheet, toast, nodes, todayISO } from './util.js';
import * as store from './store.js';
import * as C from './crypto.js';
import { askSecret } from './lock.js';

const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// The automatic backups rotate: one per weekday plus one per month, written next to the database in the linked storage.
export function backupNames(d = new Date()) {
  const names = WEEKDAYS.map(w => `vdex-backup-${w}.json`);
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const month = x => `vdex-backup-${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}.json`;
  return [...names, month(d), month(prev)];
}

export function health() {
  const exported = Number(lsGet('logi-backup-export')) || 0, synced = Number(lsGet('logi-sync-at')) || 0;
  let auto = null; try { auto = JSON.parse(lsGet('logi-backup-cloud')); } catch { /* none */ }
  const copies = [[synced, store.cloud.adapter ? store.cloud.adapter.label : 'cloud storage'], [exported, 'backup file'], [auto ? auto.at : 0, 'automatic cloud backup']].filter(([t]) => t > 0).sort((a, b) => b[0] - a[0]);
  const n = store.db.bookings.length + store.db.gear.length + store.db.crew.length + store.db.venues.length;
  if (!copies.length) return { level: n ? 'none' : 'empty', at: 0, days: Infinity, text: n ? 'No copy of your data exists anywhere but this device.' : 'Nothing to back up yet.' };
  const [at, via] = copies[0], days = Math.floor((Date.now() - at) / 864e5);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return { level: days > 7 ? 'warn' : 'ok', at, via, days, when, text: `Last off-device copy: ${when} (${via}).` };
}
export function healthLine() {
  const hl = health();
  return h('p', { class: hl.level === 'ok' ? 'status-line' : hl.level === 'empty' ? 'small muted' : 'warn small', 'data-state': hl.level === 'ok' ? 'synced' : undefined },
    (hl.level === 'ok' ? '✅ ' : hl.level === 'empty' ? '' : '⚠ ') + hl.text + (store.cloud.adapter ? '' : ' Link a cloud storage for a daily automatic backup.'));
}
// A quiet reminder at most every three days when the only copy is on this device or the last copy is old.
export function nudgeIfStale() {
  const hl = health(); if (hl.level === 'ok' || hl.level === 'empty') return;
  const last = Number(lsGet('logi-backup-nudge')) || 0; if (Date.now() - last < 3 * 864e5) return;
  lsSet('logi-backup-nudge', String(Date.now()));
  setTimeout(() => toast(hl.level === 'none' ? 'Your data only exists on this device. Settings → Backups & data.' : `No off-device copy for ${hl.days} days. Settings → Backups & data.`), 1500);
}

export async function saveOrShare(text, name, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name }); document.body.append(a); a.click(); a.remove();
  return true;
}

export async function exportFile({ encrypted = false } = {}) {
  let text = store.exportJSON(), name = `vdex-backup-${todayISO()}.json`;
  if (encrypted) {
    const pass = await askSecret({ title: 'Passphrase for this backup', confirm: true, numeric: false, minLength: 8, intro: 'Anyone with the file and this passphrase can open it, and a forgotten passphrase cannot be recovered.' });
    if (!pass) return;
    const salt = C.bytes(16), iter = C.PBKDF2_ITERATIONS;
    const box = await C.encrypt(await C.pbkdf2Key(pass, salt, iter), text);
    text = JSON.stringify({ vdex: 'encrypted-backup', v: 1, exported: new Date().toISOString(), kdf: { salt: C.toB64(salt), iter }, iv: box.iv, ct: box.ct });
    name = `vdex-backup-${todayISO()}.encrypted.json`;
  }
  if (await saveOrShare(text, name, 'application/json')) { lsSet('logi-backup-export', String(Date.now())); toast(encrypted ? 'Encrypted backup saved' : 'Backup saved'); store.touch(); }
}

export async function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  try {
    let data = JSON.parse(await f.text());
    if (data && data.vdex === 'encrypted-backup') {
      const pass = await askSecret({ title: 'Passphrase for this backup', numeric: false, minLength: 1 }); if (!pass) return;
      try { data = JSON.parse(await C.decryptText(await C.pbkdf2Key(pass, C.fromB64(data.kdf.salt), data.kdf.iter), data)); } catch { throw new Error('wrong passphrase'); }
    }
    if (!data || typeof data !== 'object' || !('bookings' in data || 'gear' in data)) throw new Error('Not a Vdex database file');
    if (confirm('Replace your current data with this file?')) { store.replaceAll(data); toast('Imported'); }
  } catch (err) { toast('Import failed: ' + err.message); }
}

export async function restoreFromCloud() {
  const a = store.cloud.adapter;
  if (!a || !a.readExtra) return toast('Link Dropbox, Google Drive, OneDrive or WebDAV first');
  const list = h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Looking for backups…'));
  const { close } = sheet('Restore a cloud backup', list);
  const found = [];
  for (const name of backupNames()) {
    try { const text = await a.readExtra(name); if (text) { const d = JSON.parse(text); found.push({ name, text, at: Number(d.updatedAt) || 0, n: (d.bookings || []).length }); } } catch { /* skip that one */ }
  }
  found.sort((x, y) => y.at - x.at);
  list.replaceChildren(...nodes(
    found.length
      ? found.map(f => h('button', { class: 'card tap', type: 'button', onclick: () => { if (confirm(`Replace the data on this device with ${f.name}?`)) { store.replaceAll(JSON.parse(f.text)); close(); toast('Restored'); } } },
        h('strong', null, f.name), h('div', { class: 'muted small' }, `${f.n} bookings · saved ${f.at ? new Date(f.at).toLocaleString() : 'unknown'}`)))
      : h('p', { class: 'muted small' }, 'No automatic backups yet. They are written once a day after a change, next to the database in your storage.'),
    h('p', { class: 'small muted' }, 'Vdex keeps one backup per weekday and one per month, so a mistake can be undone for about a week, or a month.')));
}

// Everything you own, with serial numbers and values: keep a copy with your insurer, and hand it to the police if kit goes missing.
export async function exportAssetRegister() {
  const sym = store.db.profile.currency || '$';
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['Item', 'Category', 'Serial number', 'Quantity', `Value each (${sym})`, `Total (${sym})`, 'Purchased', 'Notes'].map(q).join(',')];
  let total = 0;
  const gear = [...store.db.gear].sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.name || '').localeCompare(b.name || ''));
  for (const g of gear) {
    const qty = store.qtyOf(g), each = store.unitValue(g); total += each * qty;
    rows.push([g.name, g.category || '', g.serial || '', qty, each || '', each * qty || '', g.purchased || '', (g.notes || '').replace(/\r?\n/g, ' ')].map(q).join(','));
  }
  rows.push(['', '', '', '', 'Total', total, '', `Vdex asset register, ${new Date().toLocaleDateString()}${store.db.profile.business ? ', ' + store.db.profile.business : ''}`].map(q).join(','));
  if (await saveOrShare('﻿' + rows.join('\r\n'), `vdex-asset-register-${todayISO()}.csv`, 'text/csv')) toast('Asset register saved');
}

// STUB (settings agent): backups. openBackupSheet() opens the ☁ sheet; nudgeIfStale() reminds now and then.
import { sheet, h } from './util.js';
export function openBackupSheet() { sheet('Backups', h('p', { class: 'muted' }, 'Coming soon.')); }
export function nudgeIfStale() {}
export function backupPanel() { return h('div'); }

// Timecode notes: sync the phone to the camera's timecode, then every note is stamped with the running TC.
import { h, uid, sheet, toast, empty, fmtShort, todayISO, announce } from '../util.js';
import { db, byId, upsert, remove, update, subscribe } from '../store.js';
import * as storeRef from '../store.js';
import { openForm } from '../form.js';
import { RATES, rate, framesToTc, tcToFrames, looksLikeTc, tcAt, framesAt } from '../timecode.js';
import { haptic } from '../a11y.js';

const S = { id: null, pending: null }; // pending = frames captured when the user started typing the next note
try { S.id = localStorage.getItem('logi-tclog') || null; } catch { /* ignore */ }

const current = () => (S.id && byId('logs', S.id)) || null;
const settings = log => ({ r: rate(log.rate), sync: log.sync || null });
const nowTc = log => { const { r, sync } = settings(log); return sync ? tcAt(sync, r) : null; };
const nowFrames = log => { const { r, sync } = settings(log); return sync ? framesAt(sync, r) : null; };
const fmt = (frames, log) => framesToTc(frames, rate(log.rate));

function newLog() {
  openForm({
    title: 'New timecode log',
    values: { title: '', rate: '23.976', bookingId: '' },
    fields: [
      { key: 'title', label: 'Title', required: true, placeholder: 'e.g. Harbour Brewing — Day 1, A cam' },
      { key: 'rate', label: 'Camera frame rate', type: 'select', options: RATES.map(r => [r.id, r.label]), hint: 'Match the camera’s timecode setting, not the sensor rate. Most cameras are 23.976 or 25.' },
      { key: 'camera', label: 'Camera / card', placeholder: 'A cam, card 1' },
      ...(db.bookings.length ? [{ key: 'bookingId', label: 'Booking', type: 'select', options: [['', 'None'], ...[...db.bookings].sort((a, b) => b.date.localeCompare(a.date)).map(b => [b.id, `${fmtShort(b.date)} — ${b.title}`])] }] : []),
    ],
    onSave: v => {
      const log = { ...v, id: uid(), created: todayISO(), notes: [], sync: null };
      if (!log.bookingId) delete log.bookingId;
      S.id = log.id; try { localStorage.setItem('logi-tclog', log.id); } catch { /* ignore */ }
      upsert('logs', log);
    },
  });
}

function editLog(log) {
  openForm({
    title: 'Log settings',
    values: log,
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'rate', label: 'Camera frame rate', type: 'select', options: RATES.map(r => [r.id, r.label]), hint: 'Changing this after syncing keeps the sync moment but re-counts the frames.' },
      { key: 'camera', label: 'Camera / card' },
      ...(db.bookings.length ? [{ key: 'bookingId', label: 'Booking', type: 'select', options: [['', 'None'], ...[...db.bookings].sort((a, b) => b.date.localeCompare(a.date)).map(b => [b.id, `${fmtShort(b.date)} — ${b.title}`])] }] : []),
    ],
    onSave: v => {
      if (v.rate !== log.rate && log.sync) { // keep the timecode value shown at sync, in the new rate
        const old = rate(log.rate), nu = rate(v.rate);
        const f = tcToFrames(framesToTc(log.sync.frames, old).replace(';', ':'), nu);
        v.sync = f == null ? null : { ...log.sync, frames: f };
      }
      if (!v.bookingId) delete v.bookingId;
      upsert('logs', v);
    },
    onDelete: () => { remove('logs', log.id); S.id = null; },
  });
}

/* --------------------------------- sync --------------------------------- */
function openSync(log) {
  const r = rate(log.rate);
  const body = h('div', { class: 'stack' });
  let stream = null, raf = null, ocr = null, busy = false, closeSheet = () => {};
  const live = h('div', { class: 'tc-live muted' });
  const tick = () => { const t = nowTc(log); live.textContent = t ? `Running: ${t}` : 'Not synced yet'; };
  tick(); const iv = setInterval(tick, 100);

  // Manual: type what the camera shows, tap Sync at the moment it shows it.
  const manual = h('input', { type: 'text', inputMode: 'numeric', placeholder: `HH:MM:SS${r.df ? ';' : ':'}FF`, 'aria-label': 'Timecode shown on the camera', autocomplete: 'off', class: 'tc-input' });
  manual.addEventListener('input', () => { // auto-insert separators as digits are typed
    const d = manual.value.replace(/\D/g, '').slice(0, 8);
    manual.value = d.replace(/(\d{2})(?=\d)/g, '$1:');
  });
  const applySync = (frames, ms, how) => {
    upsert('logs', { ...byId('logs', log.id), sync: { frames, ms, how, at: new Date().toISOString() }, rate: log.rate });
    haptic(30); toast('Synced to ' + framesToTc(frames, r)); announce('Timecode synced'); closeSheet();
  };
  const syncNow = () => {
    const ms = Date.now();
    const f = tcToFrames(manual.value, r);
    if (f == null) return toast(r.df && manual.value ? 'That frame number is skipped in drop-frame. Check the camera.' : 'Enter the timecode as hours, minutes, seconds, frames.');
    applySync(f, ms, 'typed');
  };

  // Camera scan: OCR the timecode overlay on the camera's screen.
  const video = h('video', { autoplay: true, playsInline: true, muted: true, class: 'cam' });
  const canvas = document.createElement('canvas');
  const result = h('div', { class: 'tc-scan-result muted' }, 'Fill the box with the camera’s timecode display, then tap Scan.');
  const scanBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => scan() }, 'Scan');
  const startCam = async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
      video.srcObject = stream; camBtn.hidden = true; scanBtn.disabled = false;
      const track = stream.getVideoTracks()[0];
      try { const c = track.getCapabilities?.(); if (c?.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* fine */ }
      result.textContent = 'Loading the text reader…';
      loadOcr().then(() => { result.textContent = 'Fill the box with the camera’s timecode display, then tap Scan.'; }).catch(e => { result.textContent = 'Text reader unavailable (' + (e.message || 'needs a connection the first time') + '). Type the timecode instead.'; });
    } catch (e) { result.textContent = 'Camera unavailable: ' + (e.message || e.name) + '. Type the timecode instead.'; }
  };
  const camBtn = h('button', { class: 'btn ghost', onclick: startCam }, '📷 Use camera');

  async function loadOcr() {
    if (ocr) return ocr;
    if (!window.Tesseract) await new Promise((res, rej) => document.head.append(h('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js', onload: res, onerror: () => rej(new Error('could not load')) })));
    const w = await window.Tesseract.createWorker('eng', 1);
    await w.setParameters({ tessedit_char_whitelist: '0123456789:;.', tessedit_pageseg_mode: '7' }); // single line
    return (ocr = w);
  }

  async function scan() {
    if (busy || !video.videoWidth) return;
    busy = true; scanBtn.disabled = true; result.textContent = 'Reading…';
    const grabbedAt = Date.now(); // the timecode belongs to this moment, however long OCR takes
    const vw = video.videoWidth, vh = video.videoHeight;
    const bw = vw * 0.8, bh = vh * 0.18, bx = (vw - bw) / 2, by = (vh - bh) / 2; // matches .tc-reticle
    const scale = Math.max(1, 1200 / bw);
    canvas.width = Math.round(bw * scale); canvas.height = Math.round(bh * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, bx, by, bw, bh, 0, 0, canvas.width, canvas.height);
    // Grey + contrast stretch; try both polarities since overlays are white-on-dark or dark-on-light.
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), px = img.data;
    let lo = 255, hi = 0; const g = new Uint8ClampedArray(px.length / 4);
    for (let i = 0; i < g.length; i++) { const v = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) | 0; g[i] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const rng = Math.max(1, hi - lo);
    const paint = invert => { for (let i = 0; i < g.length; i++) { let v = ((g[i] - lo) * 255 / rng) | 0; if (invert) v = 255 - v; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v; px[i * 4 + 3] = 255; } ctx.putImageData(img, 0, 0); return canvas.toDataURL('image/png'); };
    let best = null;
    try {
      const w = await loadOcr();
      for (const inv of [false, true]) {
        const { data } = await w.recognize(paint(inv));
        const text = (data.text || '').replace(/[^\d:;.]/g, '').replace(/[.;]/g, ':');
        const m = text.match(/(\d{2}):?(\d{2}):?(\d{2}):?(\d{2})/) || text.replace(/:/g, '').match(/(\d{2})(\d{2})(\d{2})(\d{2})/);
        if (m) { const tc = `${m[1]}:${m[2]}:${m[3]}:${m[4]}`; const f = tcToFrames(tc, r); if (f != null && (!best || data.confidence > best.conf)) best = { tc, f, conf: data.confidence }; }
        if (best && best.conf > 80) break;
      }
    } catch (e) { result.textContent = 'Reader failed: ' + (e.message || e); busy = false; scanBtn.disabled = false; return; }
    busy = false; scanBtn.disabled = false;
    if (!best) { result.textContent = 'Couldn’t read a timecode. Get closer, avoid glare, keep the display level, or type it in.'; return; }
    result.replaceChildren(
      h('div', null, 'Read ', h('b', { class: 'tc-mono' }, best.tc), h('span', { class: 'muted small' }, ` (${Math.round(best.conf)}% sure)`)),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: () => applySync(best.f, grabbedAt, 'camera') }, 'Use this'),
        h('button', { class: 'btn ghost', onclick: () => { manual.value = best.tc; manual.focus(); } }, 'Edit first')));
  }

  body.append(
    live,
    h('div', { class: 'card' },
      h('strong', null, 'Type it'),
      h('p', { class: 'small muted' }, `Read the timecode on the camera, type it, and tap Sync at the instant the camera shows that value. ${r.label}.`),
      h('div', { class: 'row-edit' }, manual, h('button', { class: 'btn primary', onclick: syncNow }, 'Sync')),
      h('p', { class: 'small muted' }, 'Tip: set the camera to free-run timecode so it keeps counting between takes.')),
    h('div', { class: 'card' },
      h('strong', null, 'Scan it'),
      h('p', { class: 'small muted' }, 'Point the phone at the camera’s timecode display. The reading is taken the moment you tap Scan, so a slow read doesn’t put you out.'),
      h('div', { class: 'cam-wrap tc-cam' }, video, h('div', { class: 'tc-reticle', 'aria-hidden': 'true' })),
      h('div', { class: 'actions' }, camBtn, scanBtn), result),
    log.sync && h('button', { class: 'btn ghost', onclick: () => { upsert('logs', { ...byId('logs', log.id), sync: null }); toast('Sync cleared'); } }, 'Clear sync'));

  const { close } = sheet('Sync timecode', body, { onClose: () => { clearInterval(iv); cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); ocr && ocr.terminate().catch(() => {}); } });
  closeSheet = close;
  return close;
}

/* -------------------------------- export -------------------------------- */
const asText = log => `${log.title}\n${rate(log.rate).label}${log.camera ? ' · ' + log.camera : ''} · ${log.created}\n\n` + log.notes.map(n => `${fmt(n.frames, log)}  ${n.text}`).join('\n') + '\n';
const asCsv = log => 'Timecode,Note,Captured\n' + log.notes.map(n => `${fmt(n.frames, log)},"${String(n.text).replace(/"/g, '""')}",${n.at}`).join('\n') + '\n';

async function shareFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = h('a', { href: URL.createObjectURL(file), download: name }); document.body.append(a); a.click(); a.remove();
}
function openExport(log) {
  const base = log.title.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'timecode_notes';
  const copy = async () => { try { await navigator.clipboard.writeText(asText(log)); toast('Copied'); } catch { toast('Copy not allowed here. Use Share instead.'); } };
  sheet('Export notes', h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `${log.notes.length} notes. The CSV imports into a spreadsheet or your edit software’s marker tools.`),
    h('button', { class: 'btn primary', onclick: () => shareFile(base + '.txt', 'text/plain', asText(log)) }, 'Share as text (.txt)'),
    h('button', { class: 'btn ghost', onclick: () => shareFile(base + '.csv', 'text/csv', asCsv(log)) }, 'Share as spreadsheet (.csv)'),
    h('button', { class: 'btn ghost', onclick: copy }, 'Copy to clipboard'),
    h('pre', { class: 'export-preview' }, asText(log))));
}

/* --------------------------------- page --------------------------------- */
export const tcnotes = {
  id: 'tcnotes', label: 'TC Notes', icon: '⏱️', static: true,
  render(root) {
    let timer = null, draw;
    const stop = () => { clearInterval(timer); timer = null; };
    const unsub = subscribe(() => draw());
    draw = () => {
      stop();
      root.replaceChildren();
      const log = current();
      if (!log) { root.append(picker()); return; }
      root.append(logView(log, t => { timer = t; }));
    };
    draw();
    return () => { stop(); unsub(); };
  },
};
function picker() {
  const logs = [...db.logs].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  return h('div', null,
    h('div', { class: 'page-head' }, h('h1', null, 'Timecode notes'), h('button', { class: 'btn primary', onclick: newLog }, '+ New log')),
    h('p', { class: 'muted small' }, 'Sync the phone to your camera’s timecode once, then every note you jot down is stamped with the camera’s timecode for the edit.'),
    logs.length
      ? h('div', { class: 'list' }, logs.map(l => h('button', { class: 'card tap', type: 'button', onclick: () => { S.id = l.id; try { localStorage.setItem('logi-tclog', l.id); } catch { /* ignore */ } storeRef.update(() => {}); } },
        h('div', { class: 'card-row' }, h('div', null, h('strong', null, l.title), h('div', { class: 'muted small' }, [l.created && fmtShort(l.created), rate(l.rate).id + (rate(l.rate).df ? ' DF' : ''), l.camera, l.bookingId && byId('bookings', l.bookingId)?.title].filter(Boolean).join(' · '))),
          h('span', { class: 'pill ' + (l.sync ? 'st-confirmed' : '') }, `${l.notes.length} note${l.notes.length === 1 ? '' : 's'}`)))))
      : empty('No logs yet. Start one per camera or per shoot day.', h('button', { class: 'btn primary', onclick: newLog }, 'New log')));
}

function logView(log, setTimer) {
  const { r, sync } = settings(log);
  const clock = h('div', { class: 'tc-clock' + (sync ? '' : ' unsynced'), role: 'timer', 'aria-live': 'off' }, sync ? nowTc(log) : `--:--:--${r.df ? ';' : ':'}--`);
  const status = h('div', { class: 'muted small' }, sync ? `${r.label} · synced ${sync.how === 'camera' ? 'by camera scan' : 'by hand'} at ${new Date(sync.ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : `${r.label} · not synced — tap Sync and match the camera`);
  setTimer(setInterval(() => { if (sync && !document.hidden) clock.textContent = nowTc(log); }, 1000 / Math.min(r.nominal, 30)));

  // Composer: the stamp is taken when you start typing (that is the moment you saw it), and shown live.
  const stamp = h('span', { class: 'tc-mono tc-stamp' }, sync ? '—' : 'not synced');
  const input = h('textarea', { rows: 2, placeholder: sync ? 'Type a note — timecode is captured when you start typing' : 'Sync first, or notes are stamped as “unsynced”', 'aria-label': 'New note', class: 'tc-compose' });
  const refreshStamp = () => { stamp.textContent = S.pending != null ? fmt(S.pending, log) : (sync ? 'stamps when you type' : 'not synced'); };
  refreshStamp();
  input.addEventListener('input', () => { if (S.pending == null && input.value.trim()) { S.pending = nowFrames(log); refreshStamp(); } if (!input.value.trim()) { S.pending = null; refreshStamp(); } });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } });
  const add = () => {
    const text = input.value.trim();
    if (!text && S.pending == null) return;
    const frames = S.pending ?? nowFrames(log);
    S.pending = null; input.value = '';
    pushNote(log, { id: uid(), frames, text, at: new Date().toISOString() }); // re-renders the page
    document.querySelector('.tc-compose')?.focus(); haptic();
  };
  const mark = () => { // quick stamp with no text yet, for fast-moving moments
    const frames = nowFrames(log);
    pushNote(log, { id: uid(), frames, text: '', at: new Date().toISOString() }); haptic(20);
    announce('Marked ' + (frames == null ? 'unsynced' : fmt(frames, log)));
  };

  const notes = [...log.notes].sort((a, b) => (a.frames ?? -1) - (b.frames ?? -1) || a.at.localeCompare(b.at));
  return h('div', null,
    h('div', { class: 'page-head' },
      h('button', { class: 'btn ghost small', onclick: () => { S.id = null; try { localStorage.removeItem('logi-tclog'); } catch { /* ignore */ } storeRef.update(() => {}); } }, '‹ Logs'),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => openExport(log) }, 'Export'), h('button', { class: 'icon-btn', 'aria-label': 'Log settings', onclick: () => editLog(log) }, '⚙'))),
    h('div', { class: 'card tc-head' },
      h('div', { class: 'card-row' }, h('div', { class: 'grow' }, h('h2', null, log.title), h('div', { class: 'muted small' }, [log.camera, log.bookingId && byId('bookings', log.bookingId)?.title].filter(Boolean).join(' · '))),
        h('button', { class: 'btn ' + (sync ? 'ghost' : 'primary'), onclick: () => openSync(log) }, sync ? 'Re-sync' : 'Sync')),
      clock, status),
    h('div', { class: 'card tc-composer' },
      h('div', { class: 'card-row' }, h('span', { class: 'muted small' }, 'Next note at ', stamp), h('button', { class: 'btn ghost small', onclick: mark, title: 'Stamp the current timecode with no text' }, '⏺ Mark now')),
      input,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: add }, '+ Add note'))),
    notes.length
      ? h('ol', { class: 'tc-notes', 'aria-label': 'Notes' }, notes.map(n => noteRow(log, n)))
      : h('p', { class: 'muted small' }, 'Notes appear here, in timecode order.'));
}

function pushNote(log, note) { update(d => { const l = d.logs.find(x => x.id === log.id); if (l) l.notes.push(note); }); }

function noteRow(log, n) {
  const text = h('div', { class: 'tc-text' + (n.text ? '' : ' muted'), contentEditable: 'plaintext-only', spellcheck: true, 'aria-label': 'Note text', role: 'textbox' }, n.text || 'Tap to add text…');
  text.addEventListener('focus', () => { if (!n.text) text.textContent = ''; });
  text.addEventListener('blur', () => { const v = text.textContent.trim(); if (v !== (n.text || '')) update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.text = v; }); });
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } });
  const tc = h('button', { class: 'tc-mono tc-badge', type: 'button', title: 'Edit timecode', onclick: () => editStamp(log, n) }, n.frames == null ? 'unsynced' : fmt(n.frames, log));
  return h('li', { class: 'tc-note' }, tc, text, h('button', { class: 'icon-btn', 'aria-label': 'Delete note', onclick: () => update(d => { const l = d.logs.find(x => x.id === log.id); if (l) l.notes = l.notes.filter(x => x.id !== n.id); }) }, '✕'));
}

function editStamp(log, n) {
  const r = rate(log.rate);
  const input = h('input', { type: 'text', inputMode: 'numeric', class: 'tc-input', value: n.frames == null ? '' : fmt(n.frames, log), 'aria-label': 'Timecode' });
  const { close } = sheet('Edit timecode', h('div', { class: 'stack' }, input,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', onclick: () => { update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.frames = nowFrames(log); }); close(); } }, 'Stamp now'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => { const f = tcToFrames(input.value, r); if (f == null) return toast('Not a valid timecode for ' + r.label); update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.frames = f; }); close(); } }, 'Save'))));
  setTimeout(() => input.focus(), 50);
}

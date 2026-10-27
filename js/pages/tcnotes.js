// Timecode notes: sync the phone to the camera's timecode, then every note is stamped with the running TC.
import { h, uid, sheet, toast, empty, fmtShort, todayISO, announce } from '../util.js';
import { db, byId, upsert, remove, update, subscribe } from '../store.js';
import { openForm } from '../form.js';
import { RATES, rate, framesToTc, tcToFrames, tcAt, framesAt, durationText } from '../timecode.js';
import { haptic } from '../a11y.js';
import { docxToLines, textToLines, buildScript, SAMPLE_SCRIPT } from '../docx.js';

// pending = frames captured when the user started typing the next note; target = the script line/selection about to be marked
const S = { id: null, pending: null, view: 'notes', target: null, shared: null, redraw: () => {}, cleanupScript: null };
const WIDE = matchMedia('(min-width: 1000px)'); // laptop: script and notes side by side
try { S.id = localStorage.getItem('logi-tclog') || null; } catch { /* ignore */ }

const current = () => (S.id && byId('logs', S.id)) || null;
const MODES = [['free', 'Free run (camera clock always counts)'], ['record', 'Record run (counts only while recording)']];
const settings = log => ({ r: rate(log.rate), sync: log.sync || null, record: log.mode === 'record' });
const nowTc = log => { const { r, sync } = settings(log); return sync ? tcAt(sync, r) : null; };
const nowFrames = log => { const { r, sync } = settings(log); return sync ? framesAt(sync, r) : null; };
const fmt = (frames, log) => framesToTc(frames, rate(log.rate));

function newLog() {
  openForm({
    title: 'New timecode log',
    values: { title: '', rate: '23.976', mode: 'free', bookingId: '' },
    fields: [
      { key: 'title', label: 'Title', required: true, placeholder: 'e.g. Harbour Brewing — Day 1, A cam' },
      { key: 'rate', label: 'Camera frame rate', type: 'select', options: RATES.map(r => [r.id, r.label]), hint: 'Match the camera’s timecode setting, not the sensor rate. Most cameras are 23.976 or 25.' },
      { key: 'mode', label: 'Timecode mode', type: 'select', options: MODES, hint: 'Record run: you tap Roll and Cut with the camera, and each take is logged.' },
      { key: 'camera', label: 'Camera / card', placeholder: 'A cam, card 1' },
      ...(db.bookings.length ? [{ key: 'bookingId', label: 'Booking', type: 'select', options: [['', 'None'], ...[...db.bookings].sort((a, b) => b.date.localeCompare(a.date)).map(b => [b.id, `${fmtShort(b.date)} — ${b.title}`])] }] : []),
    ],
    onSave: v => {
      const log = { ...v, id: uid(), created: todayISO(), notes: [], sync: null, take: 0, autoTakes: true };
      if (!log.bookingId) delete log.bookingId;
      S.id = log.id; try { localStorage.setItem('logi-tclog', log.id); } catch { /* ignore */ }
      upsert('logs', log);
    },
  });
}

function editLog(log) {
  openForm({
    title: 'Log settings',
    values: { ...log, mode: log.mode || 'free', autoTakes: log.autoTakes === false ? 'no' : 'yes' },
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'rate', label: 'Camera frame rate', type: 'select', options: RATES.map(r => [r.id, r.label]), hint: 'Changing this after syncing keeps the sync moment but re-counts the frames.' },
      { key: 'mode', label: 'Timecode mode', type: 'select', options: MODES, hint: 'Switching to record run holds the clock at its current value until you tap Roll.' },
      { key: 'autoTakes', label: 'Log each take as a note (record run)', type: 'select', options: [['yes', 'Yes'], ['no', 'No']] },
      { key: 'camera', label: 'Camera / card' },
      ...(db.bookings.length ? [{ key: 'bookingId', label: 'Booking', type: 'select', options: [['', 'None'], ...[...db.bookings].sort((a, b) => b.date.localeCompare(a.date)).map(b => [b.id, `${fmtShort(b.date)} — ${b.title}`])] }] : []),
    ],
    onSave: v => {
      if (v.rate !== log.rate && log.sync) { // keep the timecode value shown at sync, in the new rate
        const old = rate(log.rate), nu = rate(v.rate);
        const f = tcToFrames(framesToTc(log.sync.frames, old).replace(';', ':'), nu);
        v.sync = f == null ? null : { ...log.sync, frames: f };
      }
      v.autoTakes = v.autoTakes !== 'no';
      if (v.mode !== (log.mode || 'free') && v.sync) { // carry the value shown right now into the new mode
        const now = Date.now();
        v.sync = { ...v.sync, frames: framesAt(v.sync, rate(v.rate), now), ms: now, rolling: v.mode === 'free' };
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
  const { record } = settings(log);
  const rollingBox = h('input', { type: 'checkbox', checked: !!(log.sync && log.sync.rolling !== false) });
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
    const rolling = record ? rollingBox.checked : true;
    upsert('logs', { ...byId('logs', log.id), sync: { frames, ms, how, rolling, at: new Date().toISOString() }, rate: log.rate });
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
    record && h('label', { class: 'check card' }, rollingBox, h('span', null, 'The camera is recording right now', h('em', null, ' — leave unticked if it is stopped and the display is holding its last timecode'))),
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
const asText = log => `${log.title}\n${rate(log.rate).label}${log.camera ? ' · ' + log.camera : ''} · ${log.created}\n\n` + log.notes.map(n => `${fmt(n.frames, log)}  ${n.quote ? (n.start != null ? `“${n.quote}”` : `¶ ${n.quote}`) + (n.text ? ' — ' : '') : ''}${n.text}${n.dur ? ` [${n.dur}]` : ''}`).join('\n') + '\n';
const csvq = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
const asCsv = log => 'Timecode,Note,Script line,Captured\n' + log.notes.map(n => `${fmt(n.frames, log)},${csvq(n.text + (n.dur ? ' [' + n.dur + ']' : ''))},${csvq(n.quote || '')},${n.at}`).join('\n') + '\n';

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
      stop(); S.cleanupScript && S.cleanupScript(); S.cleanupScript = null;
      const y = window.scrollY;
      root.replaceChildren();
      const log = current();
      if (!log) { root.append(picker()); return; }
      root.append(logView(log, t => { timer = t; }));
      window.scrollTo(0, y);
      if (S.shared) { const f = S.shared; S.shared = null; setTimeout(() => openImport(log, f), 50); }
    };
    S.redraw = draw;
    const onWide = () => draw();
    WIDE.addEventListener('change', onWide);
    draw();
    return () => { stop(); unsub(); WIDE.removeEventListener('change', onWide); S.cleanupScript && S.cleanupScript(); S.cleanupScript = null; };
  },
};
function picker() {
  const logs = [...db.logs].sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  return h('div', null,
    h('div', { class: 'page-head' }, h('h1', null, 'Timecode notes'), h('button', { class: 'btn primary', onclick: newLog }, '+ New log')),
    h('p', { class: 'muted small' }, 'Sync the phone to your camera’s timecode once, then every note you jot down is stamped with the camera’s timecode for the edit.'),
    S.shared && h('div', { class: 'warn' }, `“${S.shared.name}” is ready to add as a script. Open or create a log to attach it.`),
    logs.length
      ? h('div', { class: 'list' }, logs.map(l => h('button', { class: 'card tap', type: 'button', onclick: () => { S.id = l.id; S.view = 'notes'; S.target = null; try { localStorage.setItem('logi-tclog', l.id); } catch { /* ignore */ } S.redraw(); } },
        h('div', { class: 'card-row' }, h('div', null, h('strong', null, l.title), h('div', { class: 'muted small' }, [l.created && fmtShort(l.created), rate(l.rate).id + (rate(l.rate).df ? ' DF' : ''), l.camera, l.bookingId && byId('bookings', l.bookingId)?.title].filter(Boolean).join(' · '))),
          h('span', { class: 'pill ' + (l.sync ? 'st-confirmed' : '') }, `${l.notes.length} note${l.notes.length === 1 ? '' : 's'}`)))))
      : empty('No logs yet. Start one per camera or per shoot day.', h('button', { class: 'btn primary', onclick: newLog }, 'New log')));
}

function logView(log, setTimer) {
  const { r, sync, record } = settings(log);
  const rolling = !!sync && sync.rolling !== false;
  const clock = h('div', { class: 'tc-clock' + (sync ? '' : ' unsynced') + (record && sync && !rolling ? ' held' : ''), role: 'timer', 'aria-live': 'off' }, sync ? nowTc(log) : `--:--:--${r.df ? ';' : ':'}--`);
  const when = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const status = h('div', { class: 'muted small' }, !sync
    ? `${r.label} · ${record ? 'record run' : 'free run'} · not synced — tap Sync and match the camera`
    : record
      ? `${r.label} · record run · ${rolling ? `recording take ${log.take || 1} since ${when(sync.ms)}` : `camera stopped, holding since ${when(sync.ms)}`}`
      : `${r.label} · free run · synced ${sync.how === 'camera' ? 'by camera scan' : 'by hand'} at ${when(sync.ms)}`);
  const rollCut = record && h('div', { class: 'rollcut' },
    rolling
      ? h('button', { class: 'btn rec-btn cut', onclick: () => cut(log), 'aria-label': 'Cut: stop the timecode count' }, '■ Cut')
      : h('button', { class: 'btn rec-btn roll', disabled: !sync, onclick: () => roll(log), 'aria-label': 'Roll: start the timecode count' }, '● Roll'),
    h('span', { class: 'pill ' + (rolling ? 'st-cancelled' : '') }, rolling ? 'REC' : 'STBY'),
    !sync && h('span', { class: 'muted small' }, 'Sync first'));
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
      h('button', { class: 'btn ghost small', onclick: () => { S.id = null; S.target = null; try { localStorage.removeItem('logi-tclog'); } catch { /* ignore */ } S.redraw(); } }, '‹ Logs'),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => openExport(log) }, 'Export'), h('button', { class: 'icon-btn', 'aria-label': 'Log settings', onclick: () => editLog(log) }, '⚙'))),
    h('div', { class: 'card tc-head' },
      h('div', { class: 'card-row' }, h('div', { class: 'grow' }, h('h2', null, log.title), h('div', { class: 'muted small' }, [log.camera, log.bookingId && byId('bookings', log.bookingId)?.title].filter(Boolean).join(' · '))),
        h('button', { class: 'btn ' + (sync ? 'ghost' : 'primary'), onclick: () => openSync(log) }, sync ? 'Re-sync' : 'Sync')),
      clock, status, rollCut),
    !WIDE.matches && h('div', { class: 'seg wide tc-views', role: 'tablist' },
      h('button', { role: 'tab', class: S.view !== 'script' ? 'on' : '', 'aria-selected': S.view !== 'script', onclick: () => { S.view = 'notes'; S.redraw(); } }, `Notes (${log.notes.length})`),
      h('button', { role: 'tab', class: S.view === 'script' ? 'on' : '', 'aria-selected': S.view === 'script', onclick: () => { S.view = 'script'; S.redraw(); } }, log.script ? `Script (${log.notes.filter(n => n.para).length} marks)` : 'Script')),
    WIDE.matches
      ? h('div', { class: 'tc-split' }, h('div', { class: 'tc-pane' }, h('h3', null, `Notes (${log.notes.length})`), notesPane()), h('div', { class: 'tc-pane' }, h('h3', null, 'Script'), scriptView(log)))
      : S.view === 'script' ? scriptView(log) : notesPane());

  function notesPane() { return [
    h('div', { class: 'card tc-composer' },
      h('div', { class: 'card-row' }, h('span', { class: 'muted small' }, 'Next note at ', stamp), h('button', { class: 'btn ghost small', onclick: mark, title: 'Stamp the current timecode with no text' }, '⏺ Mark now')),
      input,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: add }, '+ Add note'))),
    notes.length
      ? h('ol', { class: 'tc-notes', 'aria-label': 'Notes' }, notes.map(n => noteRow(log, n)))
      : h('p', { class: 'muted small' }, 'Notes appear here, in timecode order.')]; }
}

// Record run: the camera's count only moves while it records. Roll restarts the count from the held value, Cut freezes it.
function roll(log) {
  const l = byId('logs', log.id); if (!l || !l.sync) return;
  const take = (l.take || 0) + 1, ms = Date.now();
  update(d => {
    const x = d.logs.find(y => y.id === log.id);
    x.sync = { ...x.sync, ms, rolling: true }; x.take = take;
    if (x.autoTakes !== false) x.notes.push({ id: uid(), frames: x.sync.frames, text: `▶ Take ${take}`, at: new Date().toISOString(), kind: 'roll', take });
  });
  haptic(20); announce(`Rolling, take ${take}`);
}
function cut(log) {
  const l = byId('logs', log.id); if (!l || !l.sync) return;
  const { r } = settings(l), ms = Date.now(), frames = framesAt(l.sync, r, ms), len = frames - l.sync.frames;
  update(d => {
    const x = d.logs.find(y => y.id === log.id);
    x.sync = { ...x.sync, frames, ms, rolling: false };
    const start = x.notes.find(n => n.kind === 'roll' && n.take === x.take);
    if (start) start.dur = durationText(len, r);
  });
  haptic(20); announce(`Cut. Take ${l.take} was ${durationText(len, r)}`);
}

function pushNote(log, note) { update(d => { const l = d.logs.find(x => x.id === log.id); if (l) l.notes.push(note); }); }

function noteRow(log, n) {
  const text = h('div', { class: 'tc-text' + (n.text ? '' : ' muted'), contentEditable: 'plaintext-only', spellcheck: true, 'aria-label': 'Note text', role: 'textbox' }, n.text || 'Tap to add text…');
  text.addEventListener('focus', () => { if (!n.text) text.textContent = ''; });
  text.addEventListener('blur', () => { const v = text.textContent.trim(); if (v !== (n.text || '')) update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.text = v; }); });
  text.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); text.blur(); } });
  const tc = h('button', { class: 'tc-mono tc-badge', type: 'button', title: 'Edit timecode', onclick: () => editStamp(log, n) }, n.frames == null ? 'unsynced' : fmt(n.frames, log));
  const quote = n.quote && h('button', { class: 'tc-quote', type: 'button', onclick: () => jumpTo(log, n), 'aria-label': 'Show this line in the script' }, n.start != null ? `“${n.quote}”` : `¶ ${n.quote}`, n.para && ' ↗');
  return h('li', { class: 'tc-note' + (n.kind === 'roll' ? ' take' : '') }, tc, h('div', { class: 'tc-body' }, quote, text, n.dur && h('span', { class: 'tc-dur muted small' }, `take length ${n.dur}`)), h('button', { class: 'icon-btn', 'aria-label': 'Delete note', onclick: () => update(d => { const l = d.logs.find(x => x.id === log.id); if (l) l.notes = l.notes.filter(x => x.id !== n.id); }) }, '✕'));
}

function editStamp(log, n) {
  const r = rate(log.rate);
  const input = h('input', { type: 'text', inputMode: 'numeric', class: 'tc-input', value: n.frames == null ? '' : fmt(n.frames, log), 'aria-label': 'Timecode' });
  const { close } = sheet('Edit timecode', h('div', { class: 'stack' }, input,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn ghost', onclick: () => { update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.frames = nowFrames(log); }); close(); } }, 'Stamp now'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => { const f = tcToFrames(input.value, r); if (f == null) return toast('Not a valid timecode for ' + r.label); update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.frames = f; }); close(); } }, 'Save'))));
  setTimeout(() => input.focus(), 50);
}

/* --------------------------------- script --------------------------------- */
// A note can be pinned to a script paragraph (para) and optionally a character range within it (start, end).
const MAXQ = 90;
const quoteOf = (p, start, end) => { const t = (start != null ? p.text.slice(start, end) : p.text).replace(/\s+/g, ' ').trim(); return t.length > MAXQ ? t.slice(0, MAXQ - 1) + '…' : t; };

function setScript(log, script) {
  update(d => {
    const l = d.logs.find(x => x.id === log.id); if (!l) return;
    l.script = script;
    l.notes.forEach(n => { if (n.para && !(script && script.paras.some(p => p.id === n.para))) { n.para = null; delete n.start; delete n.end; } });
  });
}

export function receiveSharedFile(file) { S.shared = file; S.view = 'script'; window.logiGo('tcnotes'); S.redraw(); } // redraw covers the case where this tab is already open

function openImport(log, preset) {
  let pending = null;
  const preview = h('div', { class: 'import-preview' });
  const useBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => {
    if (!pending) return;
    setScript(log, buildScript(pending.name, pending.lines)); S.view = 'script'; S.target = null; close();
    toast(`Script loaded: ${pending.lines.length} lines`);
  } }, log.script ? 'Replace script' : 'Use this script');
  const show = (name, lines) => {
    pending = { name, lines }; useBtn.disabled = !lines.length;
    preview.replaceChildren(h('div', { class: 'small' }, h('b', null, name), ` — ${lines.length} lines`),
      h('div', { class: 'import-sample muted small' }, lines.slice(0, 4).map(l => h('div', null, l.text)), lines.length > 4 && h('div', null, '…')));
  };
  const fail = e => { pending = null; useBtn.disabled = true; preview.replaceChildren(h('div', { class: 'warn' }, e.message || String(e))); };
  const readFile = async file => {
    try {
      preview.textContent = 'Reading…';
      const isDocx = /\.docx$/i.test(file.name) || /wordprocessingml/.test(file.type);
      const lines = isDocx ? await docxToLines(file) : textToLines(await file.text());
      if (!lines.length) throw new Error('No text found in that file');
      show(file.name.replace(/\.[^.]+$/, ''), lines);
    } catch (e) { fail(e); }
  };
  const fileIn = h('input', { type: 'file', accept: '.docx,.txt,.md,.fountain,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document', onchange: e => { const f = e.target.files[0]; if (f) readFile(f); } });
  const paste = h('textarea', { rows: 5, placeholder: 'Paste the script text here', 'aria-label': 'Pasted script text' });
  const body = h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('strong', null, 'Word document'),
      h('p', { class: 'small muted' }, 'A .docx from Word or Pages, or a Google Doc downloaded as Word (File → Download → Microsoft Word). Plain .txt and Fountain files work too.'),
      h('label', { class: 'btn ghost file-btn' }, '📄 Choose file…', fileIn)),
    h('div', { class: 'card' }, h('strong', null, 'Google Docs'),
      h('p', { class: 'small muted' }, 'Google doesn’t let an app read a Doc directly, so either download it as Word (above), share it to Logi from the Docs app on Android (⋮ → Share & export → Send a copy → Word), or select all, copy, and paste it here:'),
      paste, h('button', { class: 'btn ghost small', onclick: () => { const lines = textToLines(paste.value); lines.length ? show('Pasted script', lines) : fail(new Error('Nothing pasted yet')); } }, 'Use pasted text')),
    h('button', { class: 'btn ghost small', onclick: () => show('Sample script', textToLines(SAMPLE_SCRIPT)) }, 'Try a sample script'),
    preview,
    log.script && h('p', { class: 'small muted' }, 'Replacing the script keeps your notes and their quoted lines, but they are no longer pinned to a line.'),
    useBtn);
  const { close } = sheet(log.script ? 'Replace script' : 'Add script', body, { dismissOnBackdrop: false });
  if (preset) readFile(preset);
}

function scriptView(log) {
  const sc = log.script;
  if (!sc) return h('div', { class: 'empty' }, h('p', null, 'Add the script, then tap any line (or press and hold to select words) to pin a timecode note to it.'), h('button', { class: 'btn primary', onclick: () => openImport(log) }, '📄 Add script'));
  const byPara = new Map();
  for (const n of log.notes) if (n.para) { if (!byPara.has(n.para)) byPara.set(n.para, []); byPara.get(n.para).push(n); }
  const bar = actionBar(log);
  const body = h('div', { class: 'sc-body' }, sc.paras.map(p => paraEl(log, p, byPara.get(p.id) || [], bar)));
  const paraOf = node => (node && (node.nodeType === 1 ? node : node.parentNode))?.closest?.('.sc-para');
  const onSel = () => { // press-and-hold selection inside a line becomes the target
    const s = document.getSelection(); if (!s || !s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0), startEl = paraOf(r.startContainer), endEl = paraOf(r.endContainer);
    if (!startEl || !body.contains(startEl)) return;
    const p = sc.paras.find(x => x.id === startEl.dataset.id); if (!p) return;
    const textEl = startEl.querySelector('.sc-text');
    let start = offsetIn(textEl, r.startContainer, r.startOffset);
    let end = endEl === startEl ? offsetIn(textEl, r.endContainer, r.endOffset) : p.text.length;
    if (start == null || end == null) return;
    if (end < start) [start, end] = [end, start];
    if (end === start) return;
    S.target = { para: p.id, start, end, quote: quoteOf(p, start, end) };
    body.querySelectorAll('.sc-para.sel').forEach(x => x.classList.remove('sel'));
    bar.set(S.target);
  };
  document.addEventListener('selectionchange', onSel);
  S.cleanupScript = () => { document.removeEventListener('selectionchange', onSel); bar.stop(); };
  bar.set(S.target);
  return h('div', { class: 'script' },
    h('div', { class: 'card-row sc-head' },
      h('div', { class: 'muted small' }, `${sc.name} · ${sc.paras.length} lines · ${log.notes.filter(n => n.para).length} marks`),
      h('div', { class: 'actions' }, h('button', { class: 'btn ghost small', onclick: () => openImport(log) }, 'Replace'), h('button', { class: 'btn ghost small', onclick: () => { setScript(log, null); S.target = null; } }, 'Remove'))),
    body, bar.el);
}

// Character offset of a DOM point within a line, ignoring the timecode badges rendered inside it.
function offsetIn(root, node, offset) {
  if (!root.contains(node)) return null;
  const r = document.createRange(); r.setStart(root, 0); r.setEnd(node, offset);
  const frag = r.cloneContents(); frag.querySelectorAll('.sc-badge').forEach(b => b.remove());
  return frag.textContent.length;
}

function paraEl(log, p, notes, bar) {
  const selected = S.target && S.target.para === p.id && S.target.start == null;
  const whole = notes.filter(n => n.start == null), ranged = notes.filter(n => n.start != null);
  const el = h('div', { class: `sc-para kind-${p.kind}` + (selected ? ' sel' : ''), 'data-id': p.id, id: 'sc-' + p.id },
    whole.length > 0 && h('div', { class: 'sc-gutter' }, whole.map(n => badge(log, n))),
    h('div', { class: 'sc-text' }, segments(log, p, ranged)));
  el.addEventListener('click', e => {
    if (e.target.closest('.sc-badge')) return;
    const s = document.getSelection(); if (s && !s.isCollapsed) return; // the user is selecting words
    S.target = selected ? null : { para: p.id, quote: quoteOf(p) };
    el.parentNode.querySelectorAll('.sc-para.sel').forEach(x => x.classList.remove('sel'));
    if (S.target) el.classList.add('sel');
    bar.set(S.target);
  });
  return el;
}

// Split a line into plain and highlighted runs so overlapping marks still render.
function segments(log, p, ranged) {
  const text = p.text;
  if (!ranged.length) return [text];
  const pts = new Set([0, text.length]);
  ranged.forEach(n => { pts.add(Math.min(n.start, text.length)); pts.add(Math.min(n.end, text.length)); });
  const b = [...pts].sort((x, y) => x - y), out = [];
  for (let i = 0; i < b.length - 1; i++) {
    const a = b[i], z = b[i + 1];
    ranged.filter(n => n.start === a).forEach(n => out.push(badge(log, n)));
    const covered = ranged.some(n => n.start <= a && n.end >= z);
    out.push(covered ? h('mark', { class: 'sc-mark' }, text.slice(a, z)) : text.slice(a, z));
  }
  return out;
}

const badge = (log, n) => h('button', { class: 'sc-badge tc-mono', type: 'button', title: n.text || 'Timecode mark', 'aria-label': `Mark at ${n.frames == null ? 'unsynced' : fmt(n.frames, log)}${n.text ? ': ' + n.text : ''}`, onclick: () => editNote(log, n) }, n.frames == null ? '--' : fmt(n.frames, log));

function actionBar(log) {
  const { sync } = settings(log);
  const info = h('div', { class: 'sc-target small grow' });
  const live = h('span', { class: 'tc-mono tc-stamp' });
  const markBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => doMark('') }, '⏱ Mark');
  const noteBtn = h('button', { class: 'btn ghost', disabled: true, onclick: () => markWithNote() }, '✎ Mark + note');
  const tick = () => { live.textContent = sync ? nowTc(log) : 'not synced'; };
  const set = t => {
    if (!t) info.replaceChildren(h('span', { class: 'muted' }, 'Tap a line, or press and hold to select words, then Mark.'));
    else info.replaceChildren(t.start != null ? '“' : '¶ ', h('b', null, t.quote), t.start != null ? '”' : '');
    markBtn.disabled = noteBtn.disabled = !t;
  };
  const commit = (t, frames, text) => {
    S.target = null; document.getSelection()?.removeAllRanges();
    pushNote(log, { id: uid(), frames, text, at: new Date().toISOString(), para: t.para, start: t.start, end: t.end, quote: t.quote });
    haptic(20); announce(`Marked ${frames == null ? 'unsynced' : fmt(frames, log)}`);
  };
  const doMark = text => { const t = S.target; if (t) commit(t, nowFrames(log), text); };
  const markWithNote = () => {
    const t = S.target; if (!t) return;
    const frames = nowFrames(log); // the moment you tapped, not when you finish typing
    const ta = h('textarea', { rows: 3, placeholder: 'What happened here?', 'aria-label': 'Note' });
    const { close } = sheet('Mark + note', h('div', { class: 'stack' },
      h('div', { class: 'small muted' }, 'At ', h('b', { class: 'tc-mono' }, frames == null ? 'unsynced' : fmt(frames, log)), ' · ', t.start != null ? `“${t.quote}”` : `¶ ${t.quote}`),
      ta,
      h('div', { class: 'form-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { const text = ta.value.trim(); close(); commit(t, frames, text); } }, 'Save'))), { dismissOnBackdrop: false });
    setTimeout(() => ta.focus(), 50);
  };
  tick(); const iv = setInterval(tick, 250);
  const el = h('div', { class: 'sc-bar' }, h('div', { class: 'card-row' }, info, live), h('div', { class: 'actions' }, markBtn, noteBtn));
  return { el, set, stop: () => clearInterval(iv) };
}

function jumpTo(log, n) {
  if (!n.para) return toast('This note is no longer pinned to a line');
  S.view = 'script'; S.target = null; if (!WIDE.matches) S.redraw();
  const el = document.getElementById('sc-' + n.para);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1500); }
}

function editNote(log, n) {
  const ta = h('textarea', { rows: 3, value: n.text || '', 'aria-label': 'Note text' });
  const { close } = sheet('Note', h('div', { class: 'stack' },
    h('div', { class: 'card-row' },
      h('button', { class: 'tc-badge tc-mono', type: 'button', onclick: () => { close(); editStamp(log, n); } }, n.frames == null ? 'unsynced' : fmt(n.frames, log)),
      n.quote && h('span', { class: 'muted small grow' }, n.start != null ? `“${n.quote}”` : `¶ ${n.quote}`)),
    ta,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn danger', onclick: () => { close(); update(d => { const l = d.logs.find(x => x.id === log.id); if (l) l.notes = l.notes.filter(x => x.id !== n.id); }); } }, 'Delete'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn ghost', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { const v = ta.value.trim(); close(); update(d => { const l = d.logs.find(x => x.id === log.id); const m = l && l.notes.find(x => x.id === n.id); if (m) m.text = v; }); } }, 'Save'))), { dismissOnBackdrop: false });
  setTimeout(() => ta.focus(), 50);
}

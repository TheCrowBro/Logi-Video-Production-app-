// The sound level meter: the microphone through an A-weighting filter (or flat), read ten times a second. It shows the
// level now (smoothed like a meter's "fast" setting), the loudest moment, and the average over the last minute (Leq),
// which is what a venue's noise limit is usually judged on. It is an estimate: a phone's microphone isn't calibrated,
// so a saved offset lines it up with a real meter. A noise limit (from a venue, or typed) turns the average into a
// clear warning when the room is over it.
import { h, nodes, todayISO } from './util.js';
import { db, byId, bookingsOn } from './store.js';
import { micAnalyser, micLive, rmsOf, dbfs, aWeighting, registerState } from './audio.js';
import { pref, clamp, num, readout, repeatButton } from './tools-ui.js';

const CAL_KEY = 'gigdex-meter-cal', LIMIT_KEY = 'gigdex-meter-limit', WEIGHT_KEY = 'gigdex-meter-weight';
export const DEFAULT_CAL = 100; // a typical phone: speech at a metre reads about 60 dB, a loud band about 100
const WINDOW = 60000;           // the average covers the last minute
const LOW = 30, HIGH = 120;     // the bar's range in dB

const readCal = () => { const v = Number(pref.get(CAL_KEY, DEFAULT_CAL)); return Number.isFinite(v) ? clamp(v, 40, 160) : DEFAULT_CAL; };
// Hearing, in plain words, by the level now.
const feel = l => (l < 45 ? 'Quiet' : l < 65 ? 'Conversation level' : l < 85 ? 'Loud' : l < 100 ? 'Very loud: wear earplugs for a long set' : 'Dangerously loud: protect your ears');

let current = null;
registerState('meter', () => (current ? current() : { listening: false }));

export function meter(panel) {
  // wanted: the person still wants the meter on while the browser starts the microphone (a Stop tapped meanwhile, or
  // Gigdex going to the background, leaves it off when it arrives). micWeight: the weighting the live microphone uses.
  let mic = null, timer = 0, alive = true, starting = false, wanted = false, micWeight = null;
  let cal = readCal(), weight = pref.get(WEIGHT_KEY, 'A') === 'Z' ? 'Z' : 'A';
  let fast = null, max = null, lastT = 0, samples = [], startedAt = 0, warned = false;
  const buf = new Float32Array(4096);

  /* ---------- the limit ---------- */
  // Saved as { venueId }, { custom: true, db } or {} (no limit). With nothing saved, tonight's venue's limit is used
  // when it has one.
  const limitVenues = () => db.venues.filter(v => Number(v.noiseLimit) > 0).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const tonightVenue = () => { const b = bookingsOn(todayISO()).find(x => x.kind === 'show' && x.status !== 'cancelled' && x.venueId && Number((byId('venues', x.venueId) || {}).noiseLimit) > 0); return b ? b.venueId : ''; };
  let choice = pref.get(LIMIT_KEY, null);
  if (!choice || typeof choice !== 'object') { const v = tonightVenue(); choice = v ? { venueId: v } : {}; }
  const limitNow = () => {
    if (choice.venueId) { const v = byId('venues', choice.venueId); return v && Number(v.noiseLimit) > 0 ? { db: Number(v.noiseLimit), where: `at ${v.name || 'this venue'}` } : null; }
    return choice.custom && Number(choice.db) > 0 ? { db: Number(choice.db), where: '' } : null;
  };
  const sel = h('select', { id: 'tl-limit', 'aria-label': 'Noise limit' });
  const limitIn = h('input', { type: 'number', id: 'tl-limit-db', min: 1, max: 140, step: 1, inputMode: 'numeric', placeholder: 'e.g. 98', 'aria-label': 'Noise limit in dB' });
  const limitField = h('div', { class: 'tl-row tl-limit-db' }, limitIn, h('span', { class: 'muted' }, 'dB'));
  const limitNote = h('p', { class: 'muted small tl-note-p' });
  function drawLimit() {
    const vs = limitVenues();
    const gone = choice.venueId && !vs.some(v => v.id === choice.venueId);
    if (gone) choice = {};
    sel.replaceChildren(...nodes(
      h('option', { value: '' }, 'No limit'),
      vs.length > 0 && h('optgroup', { label: 'Venues' }, vs.map(v => h('option', { value: 'v:' + v.id }, `${v.name || 'Untitled venue'} · ${Number(v.noiseLimit)} dB`))),
      h('option', { value: 'custom' }, 'Type a limit…')));
    sel.value = choice.venueId ? 'v:' + choice.venueId : choice.custom ? 'custom' : '';
    limitField.hidden = sel.value !== 'custom';
    if (sel.value === 'custom' && document.activeElement !== limitIn) limitIn.value = Number(choice.db) > 0 ? String(choice.db) : '';
    limitNote.textContent = gone ? 'The venue that set this limit is no longer in Venues.' : !vs.length ? 'Add a noise limit to a venue (under Venues) to pick it here.' : 'Limits are usually an average over several minutes, measured at the mixing desk.';
    paint();
  }
  sel.addEventListener('change', () => {
    const v = sel.value;
    choice = v.startsWith('v:') ? { venueId: v.slice(2) } : v === 'custom' ? { custom: true, db: num(limitIn.value) > 0 ? num(limitIn.value) : '' } : {};
    pref.set(LIMIT_KEY, choice); drawLimit();
    if (v === 'custom') setTimeout(() => limitIn.focus(), 30);
  });
  limitIn.addEventListener('input', () => { const v = num(limitIn.value); choice = { custom: true, db: v > 0 ? clamp(v, 1, 140) : '' }; pref.set(LIMIT_KEY, choice); paint(); });

  /* ---------- the display ---------- */
  const big = h('b', { class: 'tl-db-now' }, '—');
  const unit = h('span', { class: 'tl-db-unit' });
  const bar = h('div', { class: 'tl-dbbar', 'aria-hidden': 'true' }, h('i', { class: 'tl-dbbar-fill' }), h('i', { class: 'tl-dbbar-limit', hidden: true }));
  const label = h('div', { class: 'tl-db-label muted' }, 'Tap Start meter and keep the microphone uncovered.');
  const maxEl = h('b', null, '—'), avgEl = h('b', null, '—'), avgSub = h('small', { class: 'muted' }), nowEl = h('b', null, '—');
  const warnBox = h('div', { class: 'warn tl-over', role: 'alert', hidden: true });
  const nearEl = h('p', { class: 'tl-near small', hidden: true });
  const err = h('div', { class: 'warn', role: 'alert', hidden: true });
  const startBtn = h('button', { type: 'button', class: 'btn primary', id: 'tl-meter-start', onclick: () => (mic || (starting && wanted) ? stopListening(true) : start()) }, '🎤 Start meter');
  const resetBtn = h('button', { type: 'button', class: 'btn ghost', id: 'tl-meter-reset', onclick: () => { fast = null; max = null; samples = []; startedAt = mic ? performance.now() : 0; warned = false; paint(); } }, 'Reset');
  const weightBtns = [['A', 'dB(A)', 'A-weighted, like venue limits'], ['Z', 'Flat', 'Unweighted (flat)']].map(([k, l, aria]) => h('button', { type: 'button', 'data-w': k, 'aria-pressed': 'false', 'aria-label': aria, onclick: () => setWeight(k) }, l));

  /* ---------- calibration ---------- */
  const calIn = h('input', { type: 'number', id: 'tl-cal', min: 40, max: 160, step: 0.5, inputMode: 'decimal', value: cal, 'aria-label': 'Calibration offset in dB' });
  const calSum = h('span', { class: 'twirl-sub' });
  const setCal = (v, typing) => { if (!Number.isFinite(v)) return; cal = clamp(Math.round(v * 2) / 2, 40, 160); pref.set(CAL_KEY, cal); if (!typing) calIn.value = String(cal); paint(); };
  calIn.addEventListener('input', () => { const v = num(calIn.value); if (v >= 40 && v <= 160) setCal(v, true); });
  calIn.addEventListener('change', () => setCal(num(calIn.value) >= 0 ? num(calIn.value) : cal));
  const calBox = h('details', { class: 'twirl tl-cal' },
    h('summary', null, h('span', { class: 'twirl-ico', 'aria-hidden': 'true' }, '🎚️'), h('span', null, h('span', { class: 'twirl-name' }, 'Calibrate'), calSum)),
    h('div', { class: 'twirl-body' },
      h('p', { class: 'small tl-note-p' }, 'Phone microphones differ. Stand next to a real sound level meter (front of house usually has one), read both, and nudge the offset until this one matches. It is saved on this device.'),
      h('div', { class: 'tl-row' }, h('label', { for: 'tl-cal', class: 'tl-label' }, 'Offset (dB)'),
        h('div', { class: 'tl-stepper' },
          repeatButton({ class: 'icon-btn', id: 'tl-cal-down', 'aria-label': 'Offset down 0.5 dB' }, '−', () => setCal(cal - 0.5)),
          calIn,
          repeatButton({ class: 'icon-btn', id: 'tl-cal-up', 'aria-label': 'Offset up 0.5 dB' }, '+', () => setCal(cal + 0.5)))),
      h('button', { type: 'button', class: 'btn ghost small', onclick: () => setCal(DEFAULT_CAL) }, `Back to ${DEFAULT_CAL}`)));

  /* ---------- measuring ---------- */
  const filters = w => (w === 'A' ? c => aWeighting(c) : null);
  // The microphone can take a while to start (the browser may ask first). When it arrives it is used only if the person
  // still wants it, and only with the weighting chosen now: one changed meanwhile starts it again with the right filters.
  async function start() {
    if (mic || !alive) return;
    wanted = true; err.hidden = true;
    if (starting) { paintButtons(); paint(); return; } // the start under way picks it up
    starting = true; paintButtons(); paint();
    try {
      for (;;) {
        const w = weight;
        const m = await micAnalyser({ fftSize: 4096, filters: filters(w) });
        if (!alive || !wanted) { m.stop(); return; }
        if (w !== weight) { m.stop(); continue; }
        mic = m; micWeight = w; lastT = performance.now();
        if (!startedAt) startedAt = lastT;
        timer = setInterval(tick, 100);
        return;
      }
    } catch (e) { wanted = false; if (e.code !== 'cancelled') { err.textContent = e.message; err.hidden = false; } }
    finally { starting = false; paintButtons(); paint(); }
  }
  // byHand: the person (or the page going away) stopped it, so a microphone still on its way is let go too.
  function stopListening(byHand = false) {
    if (byHand) wanted = false;
    clearInterval(timer); timer = 0;
    if (mic) { mic.stop(); mic = null; micWeight = null; }
    paintButtons(); paint();
  }
  async function setWeight(k) {
    if (k === weight) return;
    weight = k; pref.set(WEIGHT_KEY, k);
    fast = null; max = null; samples = []; startedAt = 0; warned = false; // a different weighting is a different measurement
    paintWeight();
    if (mic) { stopListening(); await start(); } else paint();
  }
  function tick() {
    if (!mic) return;
    if (!micLive(mic.stream)) { stopListening(true); err.textContent = 'The microphone stopped (unplugged, or taken by another app). Tap Start meter to carry on.'; err.hidden = false; return; }
    mic.analyser.getFloatTimeDomainData(buf);
    const raw = dbfs(rmsOf(buf)), e = 10 ** (raw / 10), now = performance.now();
    fast = fast == null ? e : fast + (e - fast) * (1 - Math.exp(-(now - lastT) / 125)); // "fast" time weighting
    lastT = now;
    const f = 10 * Math.log10(Math.max(fast, 1e-12));
    max = max == null ? f : Math.max(max, f);
    samples.push({ t: now, e });
    while (samples.length && now - samples[0].t > WINDOW) samples.shift();
    paint();
  }
  // Levels are kept below full scale and the offset added when shown, so a new calibration applies to all of them.
  const shown = raw => Math.max(0, raw + cal);
  const avgRaw = () => (samples.length ? 10 * Math.log10(samples.reduce((s, x) => s + x.e, 0) / samples.length) : null);

  function paint() {
    const lim = limitNow();
    const unitText = weight === 'A' ? 'dB(A)' : 'dB';
    unit.textContent = unitText;
    calSum.textContent = `Offset ${cal} dB${cal === DEFAULT_CAL ? ' (default)' : ''}`;
    const marker = bar.querySelector('.tl-dbbar-limit');
    marker.hidden = !lim;
    if (lim) marker.style.left = clamp((lim.db - LOW) / (HIGH - LOW), 0, 1) * 100 + '%';
    if (fast == null) {
      big.textContent = '—'; nowEl.textContent = '—'; maxEl.textContent = max == null ? '—' : `${shown(max).toFixed(0)}`;
      bar.firstChild.style.width = '0%'; bar.dataset.zone = 'ok';
      label.textContent = mic ? 'Listening…' : starting && wanted ? 'Starting the microphone…' : 'Tap Start meter and keep the microphone uncovered.';
    } else {
      const now = shown(10 * Math.log10(Math.max(fast, 1e-12)));
      big.textContent = now.toFixed(0); nowEl.textContent = now.toFixed(0); maxEl.textContent = shown(max).toFixed(0);
      bar.firstChild.style.width = clamp((now - LOW) / (HIGH - LOW), 0, 1) * 100 + '%';
      bar.dataset.zone = lim ? (now >= lim.db ? 'over' : now >= lim.db - 6 ? 'near' : 'ok') : now >= 100 ? 'over' : now >= 85 ? 'near' : 'ok';
      label.textContent = mic ? feel(now) : 'Paused. Tap Start meter to carry on, or Reset to start again.';
    }
    const a = avgRaw();
    const secs = samples.length ? Math.round((samples[samples.length - 1].t - samples[0].t) / 1000) : 0;
    avgEl.textContent = a == null ? '—' : shown(a).toFixed(0);
    avgSub.textContent = a == null ? '' : secs < 58 ? `${secs} s so far` : 'last 60 s';
    const avg = a == null ? null : shown(a);
    const over = !!(lim && avg != null && avg > lim.db);
    if (over) {
      warnBox.textContent = `⚠ Over the limit. The last ${secs < 58 ? `${secs} seconds` : 'minute'} averaged ${avg.toFixed(0)} ${unitText}; the limit${lim.where ? ' ' + lim.where : ''} is ${lim.db} dB. Ask front of house to bring it down.`;
      if (!warned) { warned = true; try { navigator.vibrate && navigator.vibrate([160, 90, 160]); } catch { /* no vibration */ } }
    } else warned = false;
    warnBox.hidden = !over;
    nearEl.hidden = over || !(lim && avg != null && avg > lim.db - 3);
    nearEl.textContent = lim && avg != null ? `Close to the limit: ${(lim.db - avg).toFixed(0)} dB to spare.` : '';
  }
  function paintButtons() {
    startBtn.textContent = starting && wanted ? 'Starting…' : mic ? '■ Stop' : '🎤 Start meter';
    startBtn.classList.toggle('ghost', !!mic); startBtn.classList.toggle('primary', !mic);
    display.classList.toggle('on', !!mic);
  }
  function paintWeight() { weightBtns.forEach(b => { const on = b.dataset.w === weight; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); }

  const display = h('div', { class: 'tl-meter' },
    h('div', { class: 'tl-db' }, big, unit),
    bar,
    h('div', { class: 'tl-dbscale', 'aria-hidden': 'true' }, [30, 60, 90, 120].map(v => h('span', { style: `left:${((v - LOW) / (HIGH - LOW)) * 100}%` }, String(v)))),
    label,
    h('div', { class: 'tl-readouts' }, readout('Now', nowEl), readout('Max', maxEl), readout('Last minute', avgEl, avgSub)));
  panel.append(
    h('div', { class: 'tl-card' }, display, warnBox, nearEl, err,
      h('div', { class: 'actions center' }, startBtn, resetBtn)),
    h('div', { class: 'tl-card' },
      h('label', { class: 'tl-label', for: 'tl-limit' }, 'Noise limit'),
      sel, limitField, limitNote,
      h('div', { class: 'tl-label' }, 'Weighting'),
      h('div', { class: 'seg tl-mini-seg', role: 'group', 'aria-label': 'Weighting' }, weightBtns),
      calBox),
    h('p', { class: 'muted small tl-foot' }, 'An estimate from your phone’s microphone, not a calibrated sound level meter: use it to keep an eye on the room, not to settle an argument with the council. Nothing is recorded.'));
  drawLimit(); paintWeight(); paintButtons(); paint();

  current = () => ({ listening: !!mic, starting, wanted, micWeight, now: fast == null ? null : Math.round(shown(10 * Math.log10(fast))), max: max == null ? null : Math.round(shown(max)), avg: avgRaw() == null ? null : Math.round(shown(avgRaw())), limit: (limitNow() || {}).db || null, weight, cal });

  return {
    stop() { alive = false; stopListening(true); current = null; },
    hidden() { if (mic || (starting && wanted)) { stopListening(true); label.textContent = 'Paused while Gigdex was in the background. Tap Start meter to carry on.'; } },
    data() { drawLimit(); },
  };
}

export const METER_STEPS = [
  { target: ['.tl-db'], title: 'Sound level', text: 'The level now, in dB(A) like venue limits. The bar turns amber near the limit and red over it.' },
  { target: ['.tl-readouts'], title: 'Max and the last minute', text: 'The loudest moment, and the average over the last minute: noise limits are judged on an average like this, not on single hits.' },
  { target: ['#tl-limit'], title: 'Noise limit', text: 'Pick a venue with a limit (from Venues) or type one. A warning shows when the room is over it.' },
  { target: ['.tl-cal'], title: 'Calibrate', text: 'A phone is not a calibrated meter. Match it once to a real meter with the offset, and it stays saved.' },
];

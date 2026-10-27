// Field tools: sun planner, Polaris finder, white balance reader, sound meter.
import { h, fmtTime, todayISO, parseISO, toast, pad } from '../util.js';
import { getPosition, getTimes, polarisPosition, compassPoint } from '../suncalc.js';
import { range } from '../range.js';

const TOOLS = [['sun', '☀ Sun'], ['polaris', '★ Polaris'], ['wb', '🌡 WB'], ['noise', '🔊 Noise'], ['range', '📏 Range']];
const S = { tool: 'sun', date: null, declination: 0 };
try { S.declination = Number(localStorage.getItem('logi-decl')) || 0; } catch { /* ignore */ }

export const field = {
  id: 'field', label: 'Field', icon: '☀️', static: true,
  render(root) {
    let stop = null;
    const body = h('div', { class: 'tool-body' });
    const open = tool => {
      stop && stop(); stop = null;
      S.tool = tool;
      seg.querySelectorAll('button').forEach(b => { const on = b.dataset.t === tool; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
      body.replaceChildren();
      stop = ({ sun, polaris, wb, noise, range })[tool](body) || null;
    };
    const seg = h('div', { class: 'seg tools', role: 'tablist' }, TOOLS.map(([t, l]) => h('button', { 'data-t': t, role: 'tab', onclick: () => open(t) }, l)));
    root.append(h('div', null, h('div', { class: 'page-head' }, h('h1', null, 'Field tools')), seg, body));
    open(S.tool);
    return () => stop && stop();
  },
};

/* ------------------------------ location ------------------------------ */
const getLoc = () => { try { return JSON.parse(localStorage.getItem('logi-loc')); } catch { return null; } };
const setLoc = l => { try { localStorage.setItem('logi-loc', JSON.stringify(l)); } catch { /* ignore */ } };

function locBar(onChange) {
  const label = h('span', { class: 'loc-label' });
  const paint = () => { const l = getLoc(); label.textContent = l ? `📍 ${l.lat.toFixed(4)}°, ${l.lon.toFixed(4)}°` : '📍 No location set'; };
  const lat = h('input', { type: 'number', step: 'any', min: -90, max: 90, placeholder: 'Latitude', 'aria-label': 'Latitude' });
  const lon = h('input', { type: 'number', step: 'any', min: -180, max: 180, placeholder: 'Longitude', 'aria-label': 'Longitude' });
  const manual = h('div', { class: 'row-edit manual', hidden: true }, lat, lon, h('button', {
    class: 'btn ghost small', type: 'button', onclick: () => {
      const a = parseFloat(lat.value), o = parseFloat(lon.value);
      if (!(a >= -90 && a <= 90 && o >= -180 && o <= 180)) return toast('Enter a valid latitude and longitude');
      setLoc({ lat: a, lon: o }); paint(); onChange(); manual.hidden = true;
    },
  }, 'Set'));
  const gps = () => {
    if (!navigator.geolocation) return toast('Location is not available — enter coordinates.');
    navigator.geolocation.getCurrentPosition(p => { setLoc({ lat: p.coords.latitude, lon: p.coords.longitude }); paint(); onChange(); },
      e => { toast(e.code === 1 ? 'Location permission denied — enter coordinates instead.' : 'Could not get location.'); manual.hidden = false; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  };
  paint();
  return h('div', { class: 'locbar' }, h('div', { class: 'card-row' }, label,
    h('span', null, h('button', { class: 'btn ghost small', onclick: gps }, 'Use GPS'), ' ', h('button', { class: 'btn ghost small', onclick: () => { manual.hidden = !manual.hidden; } }, 'Enter'))), manual);
}

const needLoc = () => h('div', { class: 'empty' }, h('p', null, 'Set your location (GPS or coordinates) to calculate.'));

/* ------------------------------- compass ------------------------------- */
// Live pointer: how far to turn / tilt the phone to aim at a target az/alt.
function finder(getTarget, label) {
  const out = h('div', { class: 'finder muted' }, 'Tap “Aim with phone” and hold the phone upright, back camera facing out.');
  let on = false, heading = null, pitch = null, off = [];
  const handler = e => {
    if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) heading = (360 - e.alpha) % 360;
    else if (e.alpha != null && heading == null) heading = (360 - e.alpha) % 360;
    if (e.beta != null) pitch = e.beta - 90;
    paint();
  };
  const paint = () => {
    const t = getTarget();
    if (!t || heading == null) return;
    const trueHeading = (heading + S.declination + 360) % 360;
    let dAz = ((t.azimuth - trueHeading + 540) % 360) - 180;
    const dAlt = t.altitude - (pitch ?? 0);
    const ok = Math.abs(dAz) < 3 && Math.abs(dAlt) < 3;
    out.className = 'finder' + (ok ? ' lock' : '');
    out.replaceChildren(
      h('div', { class: 'arrow', style: `transform: rotate(${dAz}deg)` }, '▲'),
      h('div', null, ok ? `On ${label}!` : `${Math.abs(dAz) < 3 ? 'Heading good' : `Turn ${dAz > 0 ? 'right' : 'left'} ${Math.abs(dAz).toFixed(0)}°`} · ${Math.abs(dAlt) < 3 ? 'tilt good' : `tilt ${dAlt > 0 ? 'up' : 'down'} ${Math.abs(dAlt).toFixed(0)}°`}`),
      h('small', { class: 'muted' }, `Heading ${trueHeading.toFixed(0)}° true · pitch ${(pitch ?? 0).toFixed(0)}°`));
  };
  const start = async () => {
    try {
      let denied = false;
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { denied = (await DeviceOrientationEvent.requestPermission()) !== 'granted'; } catch { denied = true; } }
      window.addEventListener('deviceorientationabsolute', handler);
      window.addEventListener('deviceorientation', handler);
      on = true; btn.textContent = 'Stop aiming';
      off = [() => window.removeEventListener('deviceorientationabsolute', handler), () => window.removeEventListener('deviceorientation', handler)];
      setTimeout(() => { if (heading == null) out.textContent = denied ? 'Motion access was refused. Allow “motion & orientation” for this site in the browser settings, then try again.' : 'No compass sensor found on this device.'; }, 2000);
    } catch { toast('Compass not available'); }
  };
  const stop = () => { off.forEach(f => f()); off = []; on = false; heading = null; btn.textContent = 'Aim with phone'; out.className = 'finder muted'; out.textContent = 'Tap “Aim with phone” and hold the phone upright, back camera facing out.'; };
  const btn = h('button', { class: 'btn primary', onclick: () => (on ? stop() : start()) }, 'Aim with phone');
  const decl = h('input', { type: 'number', step: 'any', value: S.declination, 'aria-label': 'Magnetic declination in degrees', oninput: e => { S.declination = Number(e.target.value) || 0; try { localStorage.setItem('logi-decl', S.declination); } catch { /* ignore */ } } });
  return { el: h('div', { class: 'card' }, h('div', { class: 'card-row' }, btn, h('label', { class: 'decl small muted' }, 'Declination° (E+) ', decl)), out), stop, repaint: paint };
}

/* --------------------------------- sun --------------------------------- */
function sun(root) {
  S.date = S.date || todayISO();
  let timer;
  const view = h('div');
  const noon = () => new Date(parseISO(S.date).getTime() + 12 * 36e5);
  let minute = null; // scrubber (minutes since local midnight); null = live
  let fin;

  const dateIn = h('input', { type: 'date', value: S.date, 'aria-label': 'Date', onchange: e => { S.date = e.target.value || todayISO(); minute = null; draw(); } });
  const bar = locBar(() => draw());

  const atMinute = () => {
    const base = parseISO(S.date);
    if (minute == null) return S.date === todayISO() ? new Date() : getTimes(noon(), getLoc().lat, getLoc().lon).solarNoon;
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, minute);
  };

  function draw() {
    fin && fin.stop();
    const loc = getLoc();
    if (!loc) { view.replaceChildren(needLoc()); return; }
    const t = getTimes(noon(), loc.lat, loc.lon);
    const now = atMinute();
    const pos = getPosition(now, loc.lat, loc.lon);
    const azAt = d => isNaN(d) ? null : getPosition(d, loc.lat, loc.lon).azimuth;
    const rows = [
      ['First light', t.dawn, 'sun-dawn'], ['Sunrise', t.sunrise, 'sun-rise', azAt(t.sunrise)], ['Golden hour ends', t.goldenHourEnd], ['Solar noon', t.solarNoon],
      ['Golden hour starts', t.goldenHour], ['Sunset', t.sunset, 'sun-set', azAt(t.sunset)], ['Blue hour', t.blueHourStart ?? t.dusk], ['Last light', t.dusk],
    ];
    const len = !isNaN(t.sunrise) && !isNaN(t.sunset) ? (t.sunset - t.sunrise) / 36e5 : null;

    const range = h('input', {
      type: 'range', min: 0, max: 1439, step: 5, value: minute ?? (now.getHours() * 60 + now.getMinutes()), 'aria-label': 'Scrub time of day',
      oninput: e => { minute = Number(e.target.value); draw2(); },
    });
    const live = h('div', { class: 'sun-now' });
    const chart = h('div', { class: 'chart' });
    const draw2 = () => {
      const when = atMinute();
      const p = getPosition(when, loc.lat, loc.lon);
      live.replaceChildren(
        h('div', null, h('b', null, fmtTime(when)), h('span', { class: 'muted' }, minute == null && S.date === todayISO() ? ' now' : ' (scrubbed)')),
        h('div', { class: 'readouts' },
          readout('Azimuth', `${p.azimuth.toFixed(0)}° ${compassPoint(p.azimuth)}`), readout('Elevation', `${p.altitude.toFixed(1)}°`),
          readout('Light', p.altitude > 6 ? 'Daylight' : p.altitude > -0.8 ? 'Golden hour' : p.altitude > -6 ? 'Civil twilight' : p.altitude > -12 ? 'Blue/nautical' : 'Night')));
      chart.replaceChildren(arc(loc, noon(), when, t));
    };
    draw2();
    fin = finder(() => getPosition(new Date(), loc.lat, loc.lon), 'the sun');

    view.replaceChildren(
      h('div', { class: 'card' }, live, chart, range, h('div', { class: 'row-edit' }, dateIn, h('button', { class: 'btn ghost small', onclick: () => { minute = null; S.date = todayISO(); dateIn.value = S.date; draw(); } }, 'Now'))),
      h('div', { class: 'card times' }, rows.map(([l, d, , az]) => h('div', { class: 'time-row' }, h('span', null, l), h('b', null, fmtTime(d)), az != null ? h('span', { class: 'muted' }, `${az.toFixed(0)}° ${compassPoint(az)}`) : h('span'))),
        len != null && h('div', { class: 'muted small' }, `Day length ${Math.floor(len)}h ${pad(Math.round((len % 1) * 60))}m`),
        isNaN(t.sunrise) && h('div', { class: 'muted small' }, 'Sun does not rise or set on this date at this latitude.')),
      fin.el, h('p', { class: 'muted small' }, 'Times are shown in this device’s time zone. Compass direction is magnetic unless you set the local declination.'));
    return fin;
  }
  root.append(bar, view);
  draw();
  timer = setInterval(() => { if (minute == null && S.date === todayISO() && getLoc() && !document.hidden && !view.querySelector('.finder.lock')) { const sel = document.activeElement; if (!(sel && sel.tagName === 'INPUT')) draw(); } }, 60000);
  return () => { clearInterval(timer); fin && fin.stop(); };
}

const readout = (k, v) => h('div', { class: 'readout' }, h('span', { class: 'muted' }, k), h('b', null, v));

function arc(loc, noon, when, t) {
  const W = 320, H = 150, top = 12, hz = 100, scale = (hz - top) / 90;
  const base = new Date(noon.getFullYear(), noon.getMonth(), noon.getDate());
  const X = m => (m / 1440) * W;
  let d = '';
  for (let m = 0; m <= 1440; m += 10) {
    const a = getPosition(new Date(base.getTime() + m * 6e4), loc.lat, loc.lon).altitude;
    d += `${m ? 'L' : 'M'}${X(m).toFixed(1)},${(hz - Math.max(-30, a) * scale).toFixed(1)} `;
  }
  const mins = (when - base) / 6e4;
  const alt = getPosition(when, loc.lat, loc.lon).altitude;
  const ns = 'http://www.w3.org/2000/svg';
  const el = (n, a, txt) => { const e = document.createElementNS(ns, n); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; return e; };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sun-svg', role: 'img', 'aria-label': 'Sun elevation through the day' });
  svg.append(el('rect', { x: 0, y: hz, width: W, height: H - hz, class: 'below' }));
  svg.append(el('line', { x1: 0, x2: W, y1: hz, y2: hz, class: 'horizon' }));
  [t.sunrise, t.sunset].forEach(ev => { if (!isNaN(ev)) svg.append(el('line', { x1: X((ev - base) / 6e4), x2: X((ev - base) / 6e4), y1: top, y2: hz + 6, class: 'tick' })); });
  svg.append(el('path', { d, class: 'curve' }));
  [0, 6, 12, 18, 24].forEach(hr => svg.append(el('text', { x: X(hr * 60), y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle' }, pad(hr))));
  svg.append(el('circle', { cx: X(Math.max(0, Math.min(1440, mins))), cy: hz - Math.max(-30, alt) * scale, r: 7, class: 'sun-dot' }));
  return svg;
}

/* ------------------------------- polaris ------------------------------- */
function polaris(root) {
  const view = h('div');
  let fin;
  const draw = () => {
    fin && fin.stop();
    const loc = getLoc();
    if (!loc) { view.replaceChildren(needLoc()); return; }
    const p = polarisPosition(new Date(), loc.lat, loc.lon);
    const visible = p.altitude > 0;
    fin = finder(() => polarisPosition(new Date(), loc.lat, loc.lon), 'Polaris');
    view.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'readouts big' },
          readout('Altitude', `${p.altitude.toFixed(2)}°`), readout('True azimuth', `${p.azimuth > 180 ? (p.azimuth - 360).toFixed(2) : p.azimuth.toFixed(2)}°`),
          readout('Latitude', `${loc.lat.toFixed(2)}°`)),
        visible
          ? h('p', null, `Polaris is ${p.altitude.toFixed(1)}° above the horizon, ${Math.abs(p.offsetFromNorth).toFixed(1)}° ${p.offsetFromNorth >= 0 ? 'east' : 'west'} of true north. Its height equals your latitude to within about ±1°, so it marks true north for aligning timelapse, star trackers and astro shoots.`)
          : h('p', { class: 'warn' }, 'Polaris is below the horizon from this latitude — it is only visible in the northern hemisphere.'),
        h('p', { class: 'muted small' }, 'Finding it: follow the two “pointer” stars at the end of the Big Dipper’s bowl, five times their spacing, to a modest star on the end of the Little Dipper’s handle. Cassiopeia’s W points to it from the other side.')),
      visible && fin.el);
  };
  root.append(locBar(draw), view);
  draw();
  return () => fin && fin.stop();
}

/* ---------------------------- white balance ---------------------------- */
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function cctFromRGB(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const sum = X + Y + Z;
  if (sum < 1e-4) return null;
  const x = X / sum, y = Y / sum, n = (x - 0.332) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

function wb(root) {
  const video = h('video', { autoplay: true, playsInline: true, muted: true, class: 'cam' });
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const read = h('div', { class: 'wb-read' }, 'Point the camera at a neutral grey or white card in the light you want to measure.');
  const note = h('p', { class: 'muted small' });
  const swatch = h('div', { class: 'swatch' });
  let stream, raf, held = null, camK = null, last = 0;

  const holdBtn = h('button', { class: 'btn ghost', disabled: true, onclick: () => { held = held ? null : last; holdBtn.textContent = held ? 'Release' : 'Hold reading'; } }, 'Hold reading');
  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start camera');

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (e) { read.textContent = 'Camera unavailable: ' + (e.message || e.name) + ' (needs HTTPS and permission).'; return; }
    video.srcObject = stream;
    startBtn.hidden = true; holdBtn.disabled = false;
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track.getCapabilities?.() || {};
      if (caps.whiteBalanceMode?.includes('manual') && caps.colorTemperature) {
        camK = Math.min(Math.max(5600, caps.colorTemperature.min), caps.colorTemperature.max);
        await track.applyConstraints({ advanced: [{ whiteBalanceMode: 'manual', colorTemperature: camK }] });
      }
    } catch { camK = null; }
    note.textContent = camK
      ? `Camera white balance locked at ${camK}K, so the reading reflects the light on your card.`
      : 'This camera keeps auto white balance on, so readings drift toward neutral. Treat them as a rough indication and trust a grey card + your camera’s own WB for exact work.';
    loop();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (video.videoWidth === 0) return;
    const s = Math.min(video.videoWidth, video.videoHeight) * 0.18;
    ctx.drawImage(video, (video.videoWidth - s) / 2, (video.videoHeight - s) / 2, s, s, 0, 0, 32, 32);
    const px = ctx.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
    const k = px.length / 4; r /= k; g /= k; b /= k;
    let cct = cctFromRGB(r, g, b);
    if (cct == null) return;
    if (camK) cct = 1e6 / (1e6 / cct + (1e6 / camK - 1e6 / 6504)); // shift from the locked white point
    cct = Math.min(Math.max(cct, 1500), 15000);
    const tint = ((g - (r + b) / 2) / Math.max(1, (r + g + b) / 3)) * 100;
    last = { cct, tint, r, g, b };
    const shown = held || last;
    swatch.style.background = `rgb(${shown.r | 0},${shown.g | 0},${shown.b | 0})`;
    const dim = (r + g + b) / 3 < 25 ? ' (too dark)' : (r + g + b) / 3 > 245 ? ' (overexposed)' : '';
    read.replaceChildren(
      h('div', { class: 'kelvin' }, `${Math.round(shown.cct / 50) * 50}K`, dim),
      h('div', { class: 'muted' }, `${shown.cct < 3800 ? 'Warm / tungsten' : shown.cct < 5000 ? 'Warm daylight' : shown.cct < 6200 ? 'Daylight' : shown.cct < 7500 ? 'Overcast / cool' : 'Shade / blue sky'} · Tint ${Math.abs(shown.tint) < 1.5 ? 'neutral' : shown.tint > 0 ? `+${shown.tint.toFixed(0)} green` : `${Math.abs(shown.tint).toFixed(0)} magenta`}`),
      h('small', { class: 'muted' }, `RGB ${shown.r | 0}, ${shown.g | 0}, ${shown.b | 0}${held ? ' · held' : ''}`));
  }

  root.append(h('div', { class: 'card' }, h('div', { class: 'cam-wrap' }, video, h('div', { class: 'reticle', 'aria-hidden': 'true' })),
    h('div', { class: 'wb-panel' }, swatch, read), h('div', { class: 'actions' }, startBtn, holdBtn), note));
  return () => { cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); };
}

/* -------------------------------- noise -------------------------------- */
function noise(root) {
  let ctxA, stream, raf, analyser, buf, cal = 94;
  try { cal = Number(localStorage.getItem('logi-cal')) || 94; } catch { /* ignore */ }
  const big = h('div', { class: 'db' }, '— dB');
  const label = h('div', { class: 'muted db-label' }, 'Tap start and keep the phone still, mic uncovered.');
  const stats = h('div', { class: 'readouts' });
  const meter = h('div', { class: 'meter' }, h('i'));
  const spark = h('canvas', { class: 'spark', width: 320, height: 70 });
  const hist = [];
  let sumE = 0, count = 0, min = Infinity, max = -Infinity;

  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start metering');
  const resetBtn = h('button', { class: 'btn ghost', onclick: () => { sumE = count = 0; min = Infinity; max = -Infinity; hist.length = 0; } }, 'Reset');
  const calIn = h('input', { type: 'number', value: cal, step: 1, 'aria-label': 'Calibration offset', oninput: e => { cal = Number(e.target.value) || 0; try { localStorage.setItem('logi-cal', cal); } catch { /* ignore */ } } });

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { label.textContent = 'Microphone unavailable: ' + (e.message || e.name) + ' (needs HTTPS and permission).'; return; }
    ctxA = new (window.AudioContext || window.webkitAudioContext)();
    await ctxA.resume();
    analyser = ctxA.createAnalyser(); analyser.fftSize = 2048;
    ctxA.createMediaStreamSource(stream).connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    startBtn.hidden = true;
    let lastPaint = 0;
    const tick = ts => {
      raf = requestAnimationFrame(tick);
      analyser.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      const db = Math.max(0, 20 * Math.log10(Math.max(rms, 1e-7)) + cal);
      sumE += 10 ** (db / 10); count++; min = Math.min(min, db); max = Math.max(max, db);
      if (ts - lastPaint < 100) return;
      lastPaint = ts;
      hist.push(db); if (hist.length > 300) hist.shift();
      big.textContent = `${db.toFixed(0)} dB`;
      meter.firstChild.style.width = (100 - Math.min(100, db / 1.2)) + '%';
      label.textContent = db < 35 ? 'Very quiet — excellent for dialogue' : db < 45 ? 'Quiet room — good for sync sound' : db < 55 ? 'Moderate — use close mics / lavs' : db < 70 ? 'Noisy — expect to need lavs or ADR' : db < 85 ? 'Loud — dialogue will struggle' : 'Very loud — hearing protection zone';
      stats.replaceChildren(readout('Avg (Leq)', (10 * Math.log10(sumE / count)).toFixed(0) + ' dB'), readout('Min', min.toFixed(0)), readout('Max', max.toFixed(0)));
      const c = spark.getContext('2d'), w = spark.width, hh = spark.height;
      c.clearRect(0, 0, w, hh);
      c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#e0a43a'; c.lineWidth = 2; c.beginPath();
      hist.forEach((v, i) => { const x = (i / 299) * w, y = hh - (Math.min(v, 110) / 110) * hh; i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    };
    raf = requestAnimationFrame(tick);
  }

  root.append(h('div', { class: 'card center' }, big, meter, label, stats, spark,
    h('div', { class: 'actions center' }, startBtn, resetBtn),
    h('label', { class: 'decl small muted' }, 'Calibration offset (dB) ', calIn),
    h('p', { class: 'muted small' }, 'Phone microphones aren’t calibrated, so this is an estimate. Compare against a reference meter once and adjust the offset to match.')));
  return () => { cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); ctxA && ctxA.close(); };
}

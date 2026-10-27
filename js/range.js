// Range finder. Two methods:
//  - AR measure: WebXR hit-testing (Android phones with ARCore, in Chrome). Distance from the camera to the
//    surface under the reticle, or the length between two dropped points.
//  - Tilt method: any phone with a motion sensor. Enter the camera height, aim at the point where the
//    subject meets the ground; distance = height / tan(angle). Aim at the top for the subject's height.
import { h, toast } from './util.js';
import { haptic } from './a11y.js';

const LS = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
let units = LS.get('logi-units') || 'm';
export const fmtLen = m => {
  if (!isFinite(m)) return '—';
  if (units === 'm') return m < 1 ? `${Math.round(m * 100)} cm` : `${m.toFixed(2)} m`;
  const inches = m / 0.0254, ft = Math.floor(inches / 12), inch = Math.round(inches - ft * 12);
  return inch === 12 ? `${ft + 1}′ 0″` : `${ft}′ ${inch}″`;
};

export async function arSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
}

export function range(root) {
  const stops = [];
  const unitSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Units' }, [['m', 'Metres'], ['ft', 'Feet']].map(([u, l]) => h('button', { type: 'button', class: units === u ? 'on' : '', 'aria-pressed': units === u, onclick: () => { units = u; LS.set('logi-units', u); root.replaceChildren(); stops.forEach(f => f()); range(root); } }, l)));
  root.append(
    h('div', { class: 'warn small' }, '⚠ Not every phone can measure distance. AR measuring needs an Android phone with ARCore, in Chrome. iPhones can’t do it in a browser yet. The tilt method works on most phones but is an estimate, about ±10%, and needs level ground.'),
    h('div', { class: 'card-row' }, h('strong', null, 'Range finder'), unitSeg),
    arCard(stops), tiltCard(stops));
  return () => stops.forEach(f => f());
}

/* ---------------------------------- AR ---------------------------------- */
function arCard(stops) {
  const note = h('p', { class: 'muted small' }, 'Checking whether this phone can measure in AR…');
  const btn = h('button', { class: 'btn primary', hidden: true, onclick: () => startAR().catch(e => toast('AR failed: ' + (e.message || e))) }, '📐 Measure in AR');
  arSupported().then(ok => {
    btn.hidden = !ok;
    note.textContent = ok
      ? 'Point the phone at a surface: the reticle locks on and the distance from the camera is shown. Tap “Set point” twice to measure a length between two places.'
      : 'AR measuring is not available on this phone or browser. Use the tilt method below.';
  });
  return h('div', { class: 'card' }, h('strong', null, 'AR measure'), note, h('div', { class: 'actions' }, btn));
}

// Minimal WebGL: a ring on the hit surface, dots for set points and a line between them.
async function startAR() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true });
  if (!gl) throw new Error('WebGL unavailable');
  const readout = h('div', { class: 'xr-readout' }, '—');
  const sub = h('div', { class: 'xr-sub' }, 'Finding a surface…');
  const setBtn = h('button', { class: 'btn primary', type: 'button' }, 'Set point');
  const resetBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Reset');
  const doneBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Done');
  const overlay = h('div', { class: 'xr-overlay' }, h('div', { class: 'xr-top' }, readout, sub), h('div', { class: 'xr-crosshair', 'aria-hidden': 'true' }), h('div', { class: 'xr-bar' }, setBtn, resetBtn, doneBtn));
  document.body.append(overlay);
  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', 'local'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
  overlay.addEventListener('beforexrselect', e => e.preventDefault()); // button taps shouldn't double as AR selects
  await gl.makeXRCompatible();
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  const ref = await session.requestReferenceSpace('local');
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewer });

  const prog = program(gl);
  const ring = new Float32Array(Array.from({ length: 48 }, (_, i) => { const a = (i / 48) * Math.PI * 2; return [Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06]; }).flat());
  const buf = gl.createBuffer();
  const points = []; let hit = null, cam = null;

  const draw = (proj, view, verts, mode, color, model) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(prog.p, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(prog.p);
    gl.uniformMatrix4fv(prog.mvp, false, mul(mul(proj, view), model || IDENT)); gl.uniform4fv(prog.c, color);
    gl.drawArrays(mode, 0, verts.length / 3);
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const onFrame = (t, frame) => {
    session.requestAnimationFrame(onFrame);
    const pose = frame.getViewerPose(ref); if (!pose) return;
    cam = pose.transform.position;
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(prog.program);
    const hits = frame.getHitTestResults(hitSource);
    hit = hits.length ? hits[0].getPose(ref) : null;
    for (const view of pose.views) {
      const vp = layer.getViewport(view); gl.viewport(vp.x, vp.y, vp.width, vp.height);
      const P = view.projectionMatrix, V = view.transform.inverse.matrix;
      if (hit) draw(P, V, ring, gl.LINE_LOOP, [1, 0.72, 0.2, 1], hit.transform.matrix);
      if (points.length) draw(P, V, new Float32Array(points.flatMap(p => [p.x, p.y, p.z])), gl.POINTS, [1, 1, 1, 1]);
      if (points.length === 1 && hit) draw(P, V, new Float32Array([points[0].x, points[0].y, points[0].z, hit.transform.position.x, hit.transform.position.y, hit.transform.position.z]), gl.LINES, [1, 0.72, 0.2, 1]);
      if (points.length === 2) draw(P, V, new Float32Array(points.flatMap(p => [p.x, p.y, p.z])), gl.LINES, [1, 1, 1, 1]);
    }
    if (points.length === 2) { readout.textContent = fmtLen(dist(points[0], points[1])); sub.textContent = 'Length between the two points · Reset to measure again'; }
    else if (hit) { readout.textContent = fmtLen(dist(cam, hit.transform.position)); sub.textContent = points.length === 1 ? `From point 1: ${fmtLen(dist(points[0], hit.transform.position))} · tap Set point` : 'Distance from the camera to the surface · tap Set point to start a length'; }
    else { readout.textContent = '—'; sub.textContent = 'Move the phone slowly over a surface to find it'; }
  };
  setBtn.addEventListener('click', () => { if (!hit) return toast('No surface under the reticle yet'); if (points.length >= 2) points.length = 0; points.push({ ...pos(hit.transform.position) }); haptic(); });
  resetBtn.addEventListener('click', () => { points.length = 0; });
  doneBtn.addEventListener('click', () => session.end());
  session.addEventListener('end', () => overlay.remove());
  session.requestAnimationFrame(onFrame);
}
const pos = p => ({ x: p.x, y: p.y, z: p.z });
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a, b) { // column-major 4x4
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function program(gl) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec3 p; uniform mat4 mvp; void main(){ gl_Position = mvp * vec4(p, 1.0); gl_PointSize = 14.0; }'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 c; void main(){ gl_FragColor = c; }'));
  gl.linkProgram(p);
  return { program: p, p: gl.getAttribLocation(p, 'p'), mvp: gl.getUniformLocation(p, 'mvp'), c: gl.getUniformLocation(p, 'c') };
}

/* --------------------------------- tilt --------------------------------- */
// Camera looking level: beta = 90. Tilting the camera down toward the floor lowers beta, so depression = 90 - beta.
export const tiltDistance = (heightM, depressionDeg) => depressionDeg > 0.5 && depressionDeg < 89.5 ? heightM / Math.tan(depressionDeg * Math.PI / 180) : null;
export const tiltHeight = (heightM, distanceM, elevationDeg) => heightM + distanceM * Math.tan(elevationDeg * Math.PI / 180);

function tiltCard(stops) {
  let eye = Number(LS.get('logi-eyeh')) || 1.5; // metres
  const toUnits = m => units === 'm' ? +m.toFixed(2) : +(m / 0.3048).toFixed(2);
  const fromUnits = v => units === 'm' ? Number(v) : Number(v) * 0.3048;
  const eyeIn = h('input', { type: 'number', step: 'any', min: 0.1, value: toUnits(eye), 'aria-label': 'Camera height above the ground', oninput: e => { const v = fromUnits(e.target.value); if (v > 0) { eye = v; LS.set('logi-eyeh', eye); } } });
  const big = h('div', { class: 'tc-clock range-read' }, '—');
  const angle = h('div', { class: 'muted small' }, 'Tap Start, hold the phone upright and aim the crosshair at the point where your subject meets the ground.');
  const heightOut = h('div', { class: 'small' });
  const video = h('video', { autoplay: true, playsInline: true, muted: true, class: 'cam' });
  const wrap = h('div', { class: 'cam-wrap range-cam', hidden: true }, video, h('div', { class: 'xr-crosshair in-card', 'aria-hidden': 'true' }));
  let stream = null, frozen = null, baseDist = null, pitch = null, live = false;
  const handler = e => { if (e.beta == null) return; pitch = 90 - e.beta; paint(); };
  const paint = () => {
    if (pitch == null) return;
    const dep = frozen ?? pitch;
    if (frozen == null) {
      const d = tiltDistance(eye, dep);
      big.textContent = d == null ? (dep <= 0.5 ? 'aim lower' : 'aim higher') : fmtLen(d);
      angle.textContent = `Tilt ${dep.toFixed(1)}° below level · line of sight ${d == null ? '—' : fmtLen(eye / Math.sin(dep * Math.PI / 180))}`;
    }
    if (baseDist != null) { // measuring the subject's height: aim at the top
      const el = -pitch; // elevation above level
      heightOut.textContent = el > -89 ? `Subject height ≈ ${fmtLen(tiltHeight(eye, baseDist, el))} (top is ${el.toFixed(1)}° ${el >= 0 ? 'above' : 'below'} level)` : '';
    }
  };
  const startBtn = h('button', { class: 'btn primary', onclick: start }, 'Start');
  const freezeBtn = h('button', { class: 'btn ghost', disabled: true, onclick: () => { if (frozen == null) { frozen = pitch; const d = tiltDistance(eye, frozen); baseDist = d; freezeBtn.textContent = 'Unfreeze'; angle.textContent = d == null ? 'No reading to freeze' : `Frozen at ${frozen.toFixed(1)}° · now aim at the top of the subject for its height`; haptic(); } else { frozen = null; baseDist = null; heightOut.textContent = ''; freezeBtn.textContent = 'Freeze'; paint(); } } }, 'Freeze');
  async function start() {
    try {
      // Some browsers answer "denied" without asking; listen anyway and only complain if nothing arrives.
      let denied = false;
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { denied = (await DeviceOrientationEvent.requestPermission()) !== 'granted'; } catch { denied = true; } }
      window.addEventListener('deviceorientation', handler); live = true; freezeBtn.disabled = false; startBtn.hidden = true;
      setTimeout(() => { if (pitch == null) angle.textContent = denied ? 'Motion access was refused. Allow “motion & orientation” for this site in the browser settings, then try again.' : 'No motion sensor found on this device.'; }, 2000);
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); video.srcObject = stream; wrap.hidden = false; } catch { /* camera is optional */ }
    } catch (e) { toast('Could not start: ' + (e.message || e)); }
  }
  stops.push(() => { window.removeEventListener('deviceorientation', handler); stream && stream.getTracks().forEach(t => t.stop()); });
  return h('div', { class: 'card' }, h('strong', null, 'Tilt method (any phone)'),
    h('div', { class: 'row-edit' }, h('label', { class: 'small muted' }, `Camera height (${units})`), eyeIn),
    wrap, big, angle, heightOut,
    h('div', { class: 'actions' }, startBtn, freezeBtn),
    h('p', { class: 'muted small' }, 'Works for subjects on the same level ground as you. Hold the phone upright in portrait; a 1° tilt error is roughly 2% of the distance.'));
}

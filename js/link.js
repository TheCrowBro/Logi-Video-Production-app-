// Direct phone <-> laptop link over WebRTC (works on the same Wi-Fi or hotspot, no internet needed).
// Signalling is done by hand: each side's connection details are squeezed into a short code shown as a QR.
// Once linked, the two clocks are measured against each other so timecode stamps agree to a few ms.

const lsGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

/* ------------------------------ this device ------------------------------ */
function guessName() {
  const ua = navigator.userAgent, app = matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser';
  const kind = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows PC' : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : 'Device';
  return `${kind} ${app}`;
}
export const me = lsGet('logi-dev') || { id: Math.random().toString(36).slice(2, 10), name: guessName() };
lsSet('logi-dev', me);

// Clock offsets to other devices: peerClock = myClock + off. Learned while linked, remembered for a day.
const offsets = lsGet('logi-clock') || {};
export const clockOffset = dev => { const o = offsets[dev]; return o && Date.now() - o.at < 864e5 ? o : null; };
export const nowOn = dev => Date.now() + (!dev || dev === me.id ? 0 : (clockOffset(dev)?.off || 0));

/* --------------------------------- codes --------------------------------- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const deflate = async text => b64u(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
const inflate = async code => new Response(new Blob([unb64u(code)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();

// Only what the other side needs: ICE credentials, DTLS fingerprint, role, and UDP host/reflexive candidates.
function squeeze(sdp) {
  const g = re => (sdp.match(re) || [])[1];
  const c = [...sdp.matchAll(/^a=candidate:\S+ \d (udp|tcp) \d+ (\S+) (\d+) typ (\w+)/gim)]
    .filter(m => m[1].toLowerCase() === 'udp' && (m[4] === 'host' || m[4] === 'srflx'))
    .map(m => [m[2], +m[3], m[4] === 'host' ? 'h' : 's']);
  const fp = g(/^a=fingerprint:sha-256 (\S+)/m);
  return { u: g(/^a=ice-ufrag:(\S+)/m), p: g(/^a=ice-pwd:(\S+)/m), f: b64u(Uint8Array.from(fp.split(':'), x => parseInt(x, 16))), s: g(/^a=setup:(\S+)/m), c };
}
function expand(d) {
  const fp = [...unb64u(d.f)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const lines = ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=ice-ufrag:' + d.u, 'a=ice-pwd:' + d.p, 'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + fp, 'a=setup:' + d.s, 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144'];
  d.c.forEach(([ip, port, t], i) => lines.push(`a=candidate:${i + 1} 1 udp ${(t === 'h' ? 2122260223 : 1686052607) - i} ${ip} ${port} typ ${t === 'h' ? 'host' : 'srflx'}${t === 's' ? ' raddr 0.0.0.0 rport 0' : ''} generation 0`));
  lines.push('a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}
const encode = async (kind, sdp) => `LOGI${kind}.` + await deflate(JSON.stringify(squeeze(sdp)));
export const codeKind = code => (String(code).trim().match(/^LOGI([OA])\./) || [])[1] || null; // O = offer (first device), A = answer
async function decode(code, kind) {
  const m = String(code).trim().match(/^LOGI([OA])\.([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('That is not a Logi link code');
  if (kind && m[1] !== kind) throw new Error(m[1] === 'O' ? 'That is a first-device code. Scan it with "Scan a code" on the other device.' : 'That is a reply code. Scan it on the device that showed the first code.');
  return expand(JSON.parse(await inflate(m[2])));
}

/* ------------------------------- connection ------------------------------- */
export const link = { status: 'idle', peer: null, offset: null, rtt: null, role: null, error: '' }; // idle | offering | answering | connected
const subs = new Set(), handlers = new Set();
export const onChange = fn => { subs.add(fn); return () => subs.delete(fn); };
export const onMessage = fn => { handlers.add(fn); return () => handlers.delete(fn); };
const emit = () => subs.forEach(fn => fn(link));
let pc = null, ch = null, clockTimer = null;

const gathered = p => new Promise(res => {
  if (p.iceGatheringState === 'complete') return res();
  const t = setTimeout(res, 2500); // no internet: STUN never answers, use what we have
  p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});

function fresh(role) {
  unlink(true);
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  link.role = role; link.error = '';
  pc.addEventListener('connectionstatechange', () => { if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && link.status === 'connected') { unlink(); link.error = 'Connection lost'; emit(); } });
  return pc;
}
function wire(channel) {
  ch = channel; ch.binaryType = 'arraybuffer';
  ch.addEventListener('open', () => { link.status = 'connected'; emit(); send({ t: 'hello', id: me.id, name: me.name }); measureClock(); clockTimer = setInterval(measureClock, 120000); });
  ch.addEventListener('close', () => { if (link.status === 'connected') { unlink(); link.error = 'Connection closed'; emit(); } });
  ch.addEventListener('message', e => receive(e.data));
}

// First device: make a code to show.
export async function createOffer() {
  const p = fresh('offer');
  wire(p.createDataChannel('logi', { ordered: true }));
  await p.setLocalDescription(await p.createOffer());
  await gathered(p);
  link.status = 'offering'; emit();
  return encode('O', p.localDescription.sdp);
}
// Second device: read the first device's code, make the reply code.
export async function acceptOffer(code) {
  const sdp = await decode(code, 'O');
  const p = fresh('answer');
  p.addEventListener('datachannel', e => wire(e.channel));
  await p.setRemoteDescription({ type: 'offer', sdp });
  await p.setLocalDescription(await p.createAnswer());
  await gathered(p);
  link.status = 'answering'; emit();
  return encode('A', p.localDescription.sdp);
}
// First device again: read the reply.
export async function acceptAnswer(code) {
  if (!pc || link.role !== 'offer') throw new Error('Show your code first, then scan the reply');
  await pc.setRemoteDescription({ type: 'answer', sdp: await decode(code, 'A') });
}
export function unlink(silent) {
  clearInterval(clockTimer); clockTimer = null;
  try { ch && ch.close(); } catch { /* ignore */ } try { pc && pc.close(); } catch { /* ignore */ }
  ch = null; pc = null;
  Object.assign(link, { status: 'idle', peer: null, offset: null, rtt: null, role: null, error: '' });
  if (!silent) emit();
}

/* -------------------------------- messages -------------------------------- */
const CHUNK = 48000; const parts = new Map();
export function send(obj) {
  if (!ch || ch.readyState !== 'open') return false;
  const s = JSON.stringify(obj);
  if (s.length <= CHUNK) { ch.send(s); return true; }
  const k = Math.random().toString(36).slice(2), n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) ch.send(JSON.stringify({ t: 'c', k, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  return true;
}
function receive(raw) {
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (m.t === 'c') { // reassemble a chunked message
    const p = parts.get(m.k) || { got: 0, d: new Array(m.n) }; parts.set(m.k, p);
    if (p.d[m.i] == null) { p.d[m.i] = m.d; p.got++; }
    if (p.got < m.n) return;
    parts.delete(m.k); try { m = JSON.parse(p.d.join('')); } catch { return; }
  }
  if (m.t === 'hello') { link.peer = { id: m.id, name: m.name }; emit(); return; }
  if (m.t === 'ping') { send({ t: 'pong', a: m.a, b: Date.now() }); return; }
  if (m.t === 'pong') { samples.push({ rtt: Date.now() - m.a, off: m.b - (m.a + Date.now()) / 2 }); return; }
  handlers.forEach(fn => fn(m));
}

// NTP-style: offset = peer clock − my clock from the lowest-latency round trip of a short burst.
let samples = [];
async function measureClock() {
  samples = [];
  for (let i = 0; i < 8; i++) { send({ t: 'ping', a: Date.now() }); await new Promise(r => setTimeout(r, 120)); }
  await new Promise(r => setTimeout(r, 300));
  if (!samples.length || !link.peer) return;
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  link.offset = best.off; link.rtt = best.rtt;
  offsets[link.peer.id] = { off: best.off, rtt: best.rtt, at: Date.now() }; lsSet('logi-clock', offsets);
  emit();
}

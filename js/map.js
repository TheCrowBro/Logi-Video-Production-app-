// Map helpers: external map links, a small OpenStreetMap preview, address lookup, and map-link parsing.
import { h, safeUrl } from './util.js';

const ZOOM = 16;

export const hasGeo = v => v && Number.isFinite(Number(v.lat)) && Number.isFinite(Number(v.lon)) && v.lat !== '' && v.lon !== '';
export const dest = v => (hasGeo(v.geo) ? `${v.geo.lat},${v.geo.lon}` : (v.address || '').replace(/\n/g, ', '));

export const googleUrl = v => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest(v))}`;
export const directionsUrl = v => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest(v))}`;
export const appleUrl = v => `https://maps.apple.com/?q=${encodeURIComponent(v.name || 'Venue')}&ll=${hasGeo(v.geo) ? v.geo.lat + ',' + v.geo.lon : ''}&address=${encodeURIComponent((v.address || '').replace(/\n/g, ', '))}`;

// Pull coordinates out of a pasted Google/Apple/OSM map link ("@51.5,-0.12", "q=51.5,-0.12", "!3d51.5!4d-0.12").
export function parseMapLink(url) {
  const s = decodeURIComponent(String(url || ''));
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|ll|query|destination|sll)=(-?\d+\.\d+)[, ](-?\d+\.\d+)/, /#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/, /mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon }; }
  }
  return null;
}

// Address -> coordinates via OpenStreetMap Nominatim (needs a connection).
export async function geocode(address) {
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Address lookup failed');
  const [hit] = await r.json();
  if (!hit) throw new Error('No match for that address — try adding the town or postcode');
  return { lat: +(+hit.lat).toFixed(6), lon: +(+hit.lon).toFixed(6) };
}

// Static map from OpenStreetMap tiles with a pin; tapping it opens the full map app.
export function miniMap(v) {
  if (!hasGeo(v.geo)) return null;
  const lat = Number(v.geo.lat), lon = Number(v.geo.lon), n = 2 ** ZOOM;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
  const inner = h('div', { class: 'map-inner' });
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) {
    const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
    if (ty < 0 || ty >= n) continue;
    inner.append(h('img', {
      alt: '', draggable: false, loading: 'lazy', referrerPolicy: 'no-referrer', src: `https://tile.openstreetmap.org/${ZOOM}/${((tx % n) + n) % n}/${ty}.png`,
      style: `left:${((tx - x) * 256).toFixed(1)}px;top:${((ty - y) * 256).toFixed(1)}px`,
    }));
  }
  return h('a', { class: 'minimap', href: googleUrl(v), target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Map of ${v.name || 'venue'}. Opens in your maps app.` },
    inner, h('span', { class: 'pin', 'aria-hidden': 'true' }, '📍'), h('span', { class: 'attrib' }, '© OpenStreetMap contributors'));
}

export function mapButtons(v) {
  if (!hasGeo(v.geo) && !(v.address || '').trim()) return null;
  const a = (href, label) => h('a', { class: 'btn ghost small', href, target: '_blank', rel: 'noopener noreferrer' }, label);
  const custom = safeUrl(v.mapLink);
  return h('div', { class: 'actions' }, a(directionsUrl(v), '🧭 Directions'), a(googleUrl(v), 'Google Maps'), a(appleUrl(v), 'Apple Maps'), custom && a(custom, 'Saved link'));
}

// Day forecast from Open-Meteo (free, no key): temperature range, chance of rain, wind and a one-line summary for a
// shoot day at the venue or the saved location, up to 16 days ahead. Cached for three hours. Nothing is sent but the
// coordinates and the date.
import { h, nodes, parseISO } from './util.js';
import { byId } from './store.js';

const CODES = { 0: ['☀️', 'Clear'], 1: ['🌤', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'], 45: ['🌫', 'Fog'], 48: ['🌫', 'Freezing fog'], 51: ['🌦', 'Light drizzle'], 53: ['🌦', 'Drizzle'], 55: ['🌧', 'Heavy drizzle'], 56: ['🌧', 'Freezing drizzle'], 57: ['🌧', 'Freezing drizzle'], 61: ['🌧', 'Light rain'], 63: ['🌧', 'Rain'], 65: ['🌧', 'Heavy rain'], 66: ['🌧', 'Freezing rain'], 67: ['🌧', 'Freezing rain'], 71: ['🌨', 'Light snow'], 73: ['🌨', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨', 'Snow grains'], 80: ['🌦', 'Showers'], 81: ['🌧', 'Showers'], 82: ['⛈', 'Heavy showers'], 85: ['🌨', 'Snow showers'], 86: ['🌨', 'Heavy snow showers'], 95: ['⛈', 'Thunderstorm'], 96: ['⛈', 'Thunderstorm with hail'], 99: ['⛈', 'Thunderstorm with hail'] };
const KEY = 'logi-wx';
const imperial = () => { try { return localStorage.getItem('logi-units') === 'ft'; } catch { return false; } };
export const canForecast = iso => { const d = (parseISO(iso) - new Date()) / 864e5; return d > -1 && d < 16; };
export function locationFor(b) {
  const v = b && b.venueId ? byId('venues', b.venueId) : null;
  if (v && v.geo && Number.isFinite(Number(v.geo.lat)) && Number.isFinite(Number(v.geo.lon))) return { lat: +v.geo.lat, lon: +v.geo.lon };
  try { const l = JSON.parse(localStorage.getItem('logi-loc')); if (l && Number.isFinite(Number(l.lat))) return { lat: +l.lat, lon: +l.lon }; } catch { /* none */ }
  return null;
}
export async function forecast(lat, lon, iso) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${iso},${imperial() ? 'i' : 'm'}`;
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* none */ }
  const hit = cache[key]; if (hit && Date.now() - hit.at < 3 * 3600e3) return hit.v;
  const units = imperial() ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto&start_date=${iso}&end_date=${iso}${units}`);
  if (!r.ok) throw new Error('forecast unavailable');
  const j = await r.json(), d = j.daily || {};
  if (!d.time || !d.time.length) return null;
  const [emoji, text] = CODES[d.weather_code[0]] || ['🌡', 'Weather'];
  const v = { emoji, text, tmin: Math.round(d.temperature_2m_min[0]), tmax: Math.round(d.temperature_2m_max[0]), rain: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null, wind: Math.round(d.wind_speed_10m_max[0]), gust: Math.round(d.wind_gusts_10m_max[0]), tUnit: imperial() ? '°F' : '°C', wUnit: imperial() ? 'mph' : 'km/h' };
  for (const k of Object.keys(cache)) if (Date.now() - cache[k].at > 3 * 3600e3) delete cache[k];
  cache[key] = { at: Date.now(), v };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return v;
}
export const summary = w => (w ? `${w.emoji} ${w.text}, ${w.tmin}–${w.tmax}${w.tUnit}${w.rain != null ? `, ${w.rain}% chance of rain` : ''}, wind to ${w.wind} ${w.wUnit}${w.gust > w.wind + 15 ? ` (gusts ${w.gust})` : ''}` : '');
// A line that fills itself in once the forecast arrives; optionally with a button that hands the text on.
export function forecastLine(loc, iso, { onUse, label = 'Add to call sheet' } = {}) {
  if (!loc || !canForecast(iso)) return null;
  const el = h('div', { class: 'wxline muted small' }, '🌤 Checking the forecast…');
  forecast(loc.lat, loc.lon, iso).then(w => {
    if (!w) { el.remove(); return; }
    el.replaceChildren(...nodes(summary(w), onUse && h('button', { class: 'btn ghost small', onclick: () => onUse(summary(w)) }, label)));
  }).catch(() => el.remove());
  return el;
}

// Day forecast from Open-Meteo (free, no key): temperature range, chance of rain, wind and a one-line summary for a
// shoot day at the venue or the saved location, up to 16 days ahead. Cached for three hours. Nothing is sent but the
// coordinates, rounded to two decimals first (about a kilometre: the saved location may be the person's own), the
// date and the units. The privacy policy says exactly this; change both together.
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
const sent = n => Number(n).toFixed(2); // a coordinate as it leaves the device
const cacheKey = (lat, lon, iso) => `${sent(lat)},${sent(lon)},${iso},${imperial() ? 'i' : 'm'}`;
const readCache = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
// The forecast already fetched for this place and day, if it is still fresh: drawn straight away, with no flash.
export function cachedForecast(lat, lon, iso) { const hit = readCache()[cacheKey(lat, lon, iso)]; return hit && Date.now() - hit.at < 3 * 3600e3 ? hit.v : undefined; }
export async function forecast(lat, lon, iso) {
  const key = cacheKey(lat, lon, iso), cache = readCache();
  const hit = cache[key]; if (hit && Date.now() - hit.at < 3 * 3600e3) return hit.v;
  const units = imperial() ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${sent(lat)}&longitude=${sent(lon)}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto&start_date=${iso}&end_date=${iso}${units}`);
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
// The day's weather as a card on the booking: a big symbol, the high and low, rain and wind, with the sun times under
// it. Without a location there is nothing to show; beyond the forecast's reach only the sun times show.
export function forecastCard(loc, iso, { sun = '', when = '' } = {}) {
  if (!loc) return null;
  const sunEl = sun ? h('div', { class: 'sunline muted small' }, sun) : null;
  const ico = h('div', { class: 'wx-ico', 'aria-hidden': 'true' }, canForecast(iso) ? '🌤' : '☀');
  const main = h('div', { class: 'wx-main' }, canForecast(iso) ? h('div', { class: 'wxline muted small' }, 'Checking the forecast…') : h('div', { class: 'muted small' }, `${when ? when + ': ' : ''}the forecast comes within 16 days of the day.`), sunEl);
  const el = h('div', { class: 'card wx-card box-dark', role: 'group', 'aria-label': 'Weather and sun' }, ico, main);
  const fill = w => {
    if (!w) { main.replaceChildren(...nodes(h('div', { class: 'muted small' }, 'No forecast for this day yet.'), sunEl)); return; }
    ico.textContent = w.emoji;
    main.replaceChildren(...nodes(
      h('div', { class: 'wx-head' }, h('b', { class: 'wx-text' }, w.text), h('span', { class: 'wx-temp' }, `${w.tmin}–${w.tmax}${w.tUnit}`)),
      h('div', { class: 'wxline small' }, [w.rain != null && `🌧 ${w.rain}% chance of rain`, `💨 wind to ${w.wind} ${w.wUnit}${w.gust > w.wind + 15 ? ` (gusts ${w.gust})` : ''}`].filter(Boolean).join(' · ')),
      sunEl));
  };
  if (canForecast(iso)) {
    const now = cachedForecast(loc.lat, loc.lon, iso); // the page is redrawn on every change: a known forecast must not flash
    if (now !== undefined) fill(now);
    else forecast(loc.lat, loc.lon, iso).then(fill).catch(() => main.replaceChildren(...nodes(h('div', { class: 'muted small' }, 'The forecast could not be fetched.'), sunEl)));
  }
  return el;
}
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

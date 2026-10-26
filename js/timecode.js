// SMPTE timecode maths: frame rates, drop-frame, running clock from a sync point.

export const RATES = [
  { id: '23.976', label: '23.976 (24p film / most cameras)', nominal: 24, scale: 1000 / 1001, df: false },
  { id: '24', label: '24 (true 24)', nominal: 24, scale: 1, df: false },
  { id: '25', label: '25 (PAL)', nominal: 25, scale: 1, df: false },
  { id: '29.97', label: '29.97 NDF', nominal: 30, scale: 1000 / 1001, df: false },
  { id: '29.97df', label: '29.97 DF (drop frame)', nominal: 30, scale: 1000 / 1001, df: true },
  { id: '30', label: '30', nominal: 30, scale: 1, df: false },
  { id: '50', label: '50', nominal: 50, scale: 1, df: false },
  { id: '59.94', label: '59.94 NDF', nominal: 60, scale: 1000 / 1001, df: false },
  { id: '59.94df', label: '59.94 DF (drop frame)', nominal: 60, scale: 1000 / 1001, df: true },
  { id: '60', label: '60', nominal: 60, scale: 1, df: false },
];
export const rate = id => RATES.find(r => r.id === id) || RATES[0];
const DAY = r => r.nominal * 60 * 60 * 24 - (r.df ? (r.nominal / 15) * (1440 - 144) : 0); // frame count in 24h of timecode

const p2 = n => String(n).padStart(2, '0');

// Frame count -> "HH:MM:SS:FF" (";" before frames for drop-frame, the usual convention).
export function framesToTc(frames, r) {
  const n = r.nominal;
  let f = ((Math.floor(frames) % DAY(r)) + DAY(r)) % DAY(r);
  if (r.df) {
    // Drop-frame skips 2 (30fps) or 4 (60fps) frame numbers each minute, except every 10th minute.
    const drop = n / 15;
    const perTenMin = n * 600 - drop * 9;
    const perMin = n * 60 - drop;
    const tens = Math.floor(f / perTenMin);
    let rem = f % perTenMin;
    const extraMin = rem < n * 60 ? 0 : Math.floor((rem - drop) / perMin);
    f += drop * (tens * 9 + extraMin);
  }
  const ff = f % n, s = Math.floor(f / n) % 60, m = Math.floor(f / (n * 60)) % 60, hh = Math.floor(f / (n * 3600)) % 24;
  return `${p2(hh)}:${p2(m)}:${p2(s)}${r.df ? ';' : ':'}${p2(ff)}`;
}

// "HH:MM:SS:FF" (any separators, frames optional) -> frame count, or null if not a timecode.
export function tcToFrames(text, r) {
  const m = String(text || '').trim().match(/^(\d{1,2})[:;.,\s](\d{1,2})[:;.,\s](\d{1,2})(?:[:;.,\s](\d{1,2}))?$/);
  if (!m) return null;
  const [hh, mm, ss, ff] = m.slice(1).map(x => Number(x || 0));
  const n = r.nominal;
  if (hh > 23 || mm > 59 || ss > 59 || ff >= n) return null;
  let f = ((hh * 60 + mm) * 60 + ss) * n + ff;
  if (r.df) {
    const drop = n / 15;
    const totalMin = hh * 60 + mm;
    if (ss === 0 && ff < drop && mm % 10 !== 0) return null; // these frame numbers don't exist in DF
    f -= drop * (totalMin - Math.floor(totalMin / 10));
  }
  return f;
}

export const looksLikeTc = text => /^\d{1,2}[:;.,]\d{2}[:;.,]\d{2}(?:[:;.,]\d{2})?$/.test(String(text || '').trim());

// A sync point is { ms: Date.now() when the camera showed it, frames }. Running timecode from one:
export const framesAt = (sync, r, nowMs = Date.now()) => sync.frames + Math.round(((nowMs - sync.ms) / 1000) * r.nominal * r.scale);
export const tcAt = (sync, r, nowMs) => framesToTc(framesAt(sync, r, nowMs), r);

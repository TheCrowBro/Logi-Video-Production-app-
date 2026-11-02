// The stripboard's data, shared by the stripboard page, the call sheet and the crew link. Each booking keeps one
// ordered list (booking.board.list) of scene strips, banners and day breaks. As on a physical board, a day break ends a
// shooting day, and everything after the last break is unscheduled. Page counts are kept in eighths of a page.
import { parseISO, ymd } from './util.js';
import { endOf } from './store.js';

export const shootDayCount = b => (b && b.date ? Math.max(1, Math.round((parseISO(endOf(b)) - parseISO(b.date)) / 864e5) + 1) : 1);
const str = v => (v == null ? '' : String(v));
// A strip as stored, made safe to draw: only the fields below, the right types, at most one of each id.
function tidy(x) {
  if (x.type === 'break') return { id: str(x.id), type: 'break' };
  if (x.type === 'banner') return { id: str(x.id), type: 'banner', text: str(x.text) };
  return { id: str(x.id), type: 'scene', scene: str(x.scene), ie: str(x.ie), set: str(x.set), tod: str(x.tod), dn: x.dn === 'D' || x.dn === 'N' ? x.dn : '',
    desc: str(x.desc), cast: Array.isArray(x.cast) ? x.cast.map(str).filter(Boolean) : [], eighths: Math.max(0, Math.round(Number(x.eighths) || 0)), notes: str(x.notes) };
}
// The board of a booking. One with nothing stored yet starts with a day break for each shoot day and no scenes.
export function boardOf(b) {
  const bd = b && b.board && typeof b.board === 'object' ? b.board : null, seen = new Set();
  const list = bd && Array.isArray(bd.list) ? bd.list.filter(x => x && typeof x === 'object' && x.id && !seen.has(String(x.id)) && seen.add(String(x.id))).map(tidy) : null;
  return {
    list: list || Array.from({ length: shootDayCount(b) }, (_, i) => ({ id: 'day-' + (i + 1), type: 'break' })),
    cast: bd && Array.isArray(bd.cast) ? [...new Set(bd.cast.map(str).filter(Boolean))] : [],
    updatedAt: Number(bd && bd.updatedAt) || 0,
  };
}
export const hasBoard = b => boardOf(b).list.some(x => x.type === 'scene');
export const hasScheduled = b => boardPlan(b).days.some(d => d.scenes > 0);

// Interior or exterior, and day or night: the strip's colour comes from these two, as on paper boards.
const NIGHT = /NIGHT|EVENING|DUSK|SUNSET|MIDNIGHT|TWILIGHT/i;
export const ieOf = s => { const v = str(s.ie).toUpperCase().replace(/\s+/g, ''); return /^(I\/E|INT\.?\/EXT\.?|EXT\.?\/INT\.?)$/.test(v) ? 'I/E' : /^EXT/.test(v) ? 'EXT' : /^INT/.test(v) ? 'INT' : ''; };
export const dnOf = s => (s.dn === 'N' ? 'night' : s.dn === 'D' ? 'day' : NIGHT.test(s.tod || '') ? 'night' : 'day');
export const stripClass = s => `sb-${ieOf(s) === 'EXT' || ieOf(s) === 'I/E' ? 'ext' : 'int'}-${dnOf(s)}`;
export const stripKind = s => `${ieOf(s) === 'EXT' || ieOf(s) === 'I/E' ? 'Exterior' : 'Interior'} ${dnOf(s)}`;

// Pages in eighths: 11 → "1 3/8", 3 → "3/8", 16 → "2".
export function fmtEighths(e) { e = Math.max(0, Math.round(Number(e) || 0)); const w = Math.floor(e / 8), r = e % 8; return w && r ? `${w} ${r}/8` : w ? String(w) : `${r}/8`; }
// "1 3/8", "1-3/8", "3/8", "2", "1.5" → eighths; anything unreadable → null.
export function parseEighths(t) {
  const s = str(t).trim().replace(/\s*pages?$/i, ''); if (!s) return 0;
  let m = s.match(/^(?:(\d+)[\s-]+)?(\d+)\s*\/\s*8$/); if (m) return (Number(m[1]) || 0) * 8 + Number(m[2]); // "1 3/8", "11/8"
  m = s.match(/^\d+(?:[.,]\d+)?$/); if (m) return Math.round(Number(s.replace(',', '.')) * 8);
  return null;
}

// The plan: each shooting day with its scenes and banners, its date and its page total, then what is unscheduled.
export function boardPlan(b) {
  const { list, cast } = boardOf(b), breaks = list.filter(x => x.type === 'break').length, have = shootDayCount(b);
  const start = b && b.date ? parseISO(b.date) : null;
  const days = Array.from({ length: breaks }, (_, i) => ({ n: i + 1, of: breaks, date: start && i < have ? ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)) : '', items: [], eighths: 0, scenes: 0, breakId: '' }));
  const pool = []; let d = 0;
  for (const x of list) {
    if (x.type === 'break') { if (days[d]) days[d].breakId = x.id; d++; continue; }
    if (d < breaks) { days[d].items.push(x); if (x.type === 'scene') { days[d].eighths += x.eighths; days[d].scenes++; } } else pool.push(x);
  }
  const scenes = list.filter(x => x.type === 'scene');
  return { days, pool, cast, list, scenes, eighths: scenes.reduce((t, x) => t + x.eighths, 0), unscheduled: pool.filter(x => x.type === 'scene').length };
}
export const castNumbers = (names, cast) => names.map(n => cast.indexOf(n) + 1).filter(n => n > 0).sort((a, b) => a - b);

// Timecode notes as markers for the edit: a file for each editor, written from its own format, each marker at the
// camera's timecode a note carries (notes with no timecode yet are left out). Loaded on first use, from Export.
//
// - Avid Media Composer: a marker list (tab-separated text: name, timecode, track, colour, comment, length), as the
//   Markers window exports and imports it; imported onto the clip or sequence in the monitor, by timecode.
// - DaVinci Resolve: an EDL of markers, as Resolve's Timelines → Export → Timeline Markers to EDL writes it (each
//   event's comment carries |C: colour |M: name |D: length), for Timelines → Import → Timeline Markers from EDL:
//   markers on the timeline at those timecodes.
// - Premiere Pro: Final Cut Pro 7 XML (xmeml), which Premiere imports: a sequence starting at the camera's timecode
//   with a marker at each note; footage placed on it at its own timecode lines up with them.
// - Final Cut Pro: FCPXML, a project in an event "Vdex markers" whose timeline starts at the camera's timecode, a gap
//   clip carrying a marker at each note.
// Takes are named "Take 3", with their rating and length; ⚑ marks and plain notes by their words; the script line a
// note is pinned to goes in the comment. Colours: a good take green, a no-good take red, other takes blue, ⚑ yellow,
// the rest cyan.
import { rate as rateOf, framesToTc } from './timecode.js';

const kindOf = n => (n.kind === 'roll' ? (n.rate === 'good' ? 'good' : n.rate === 'ng' ? 'ng' : 'take') : /^⚑/.test(n.text || '') ? 'flag' : 'note');
const nameOf = n => {
  if (n.kind === 'roll') return [String(n.text || `Take ${n.take}`).replace(/^▶\s*/, ''), n.rate === 'good' ? '★ Good' : n.rate === 'ng' ? '✕ No good' : '', n.dur ? `[${n.dur}]` : ''].filter(Boolean).join(' ');
  return String(n.text || '').trim() || 'Mark';
};
const oneLine = t => String(t || '').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
// The notes that have a timecode, in timecode order: { frames, name, comment, kind }.
export function markersOf(log) {
  return log.notes.filter(n => Number.isFinite(n.frames)).sort((a, b) => a.frames - b.frames)
    .map(n => ({ frames: n.frames, name: oneLine(nameOf(n)), comment: oneLine(n.quote ? `“${n.quote}”` : ''), kind: kindOf(n) }));
}
const nameFile = log => (log.title || 'timecode notes').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'timecode_notes';
const xml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Avid Media Composer */
const AVID = { good: 'green', ng: 'red', take: 'blue', flag: 'yellow', note: 'cyan' };
export function avidMarkers(log) {
  const r = rateOf(log.rate);
  return markersOf(log).map(m => ['Vdex', framesToTc(m.frames, r), 'V1', AVID[m.kind], [m.name, m.comment].filter(Boolean).join(' — '), '1'].join('\t')).join('\r\n') + '\r\n';
}

/* DaVinci Resolve */
const RESOLVE = { good: 'ResolveColorGreen', ng: 'ResolveColorRed', take: 'ResolveColorBlue', flag: 'ResolveColorYellow', note: 'ResolveColorCyan' };
export function resolveEdl(log) {
  const r = rateOf(log.rate), tc = f => framesToTc(f, r), pad = n => String(n).padStart(3, '0');
  const lines = [`TITLE: ${oneLine(log.title || 'Vdex markers').slice(0, 70)}`, `FCM: ${r.df ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  markersOf(log).forEach((m, i) => {
    lines.push(`${pad(i + 1)}  001      V     C        ${tc(m.frames)} ${tc(m.frames + 1)} ${tc(m.frames)} ${tc(m.frames + 1)}  `);
    lines.push(`${m.comment ? m.comment.replace(/\|/g, '/') + ' ' : ''}|C:${RESOLVE[m.kind]} |M:${m.name.replace(/\|/g, '/')} |D:1`);
    lines.push('');
  });
  return lines.join('\r\n');
}

// Where a timeline of markers starts: the hour before the first note (01:00:00:00 for notes from 01:04:22:15). An hour
// of drop-frame timecode is 108 (or 216) frames short of a full one.
const perHour = r => r.nominal * 3600 - (r.df ? (r.nominal / 15) * 54 : 0);
const hourOf = (frames, r) => frames - (frames % perHour(r));
const spanOf = (log, r) => { const ms = markersOf(log); if (!ms.length) return null; const start = Math.max(0, hourOf(ms[0].frames, r)); return { ms, start, end: ms[ms.length - 1].frames + Math.round(r.nominal * 10) }; };

/* Premiere Pro: Final Cut Pro 7 XML */
export function premiereXml(log) {
  const r = rateOf(log.rate), s = spanOf(log, r); if (!s) return '';
  const ntsc = r.scale !== 1 ? 'TRUE' : 'FALSE', rateXml = `<rate><timebase>${r.nominal}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const name = `${oneLine(log.title || 'Timecode notes')} — Vdex markers`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="vdex-markers">
    <name>${xml(name)}</name>
    <duration>${s.end - s.start}</duration>
    ${rateXml}
    <timecode>${rateXml}<string>${framesToTc(s.start, r)}</string><frame>${s.start}</frame><displayformat>${r.df ? 'DF' : 'NDF'}</displayformat></timecode>
    <media><video><format><samplecharacteristics>${rateXml}<width>1920</width><height>1080</height></samplecharacteristics></format><track/></video><audio><track/></audio></media>
${s.ms.map(m => `    <marker><name>${xml(m.name)}</name><comment>${xml(m.comment)}</comment><in>${m.frames - s.start}</in><out>-1</out></marker>`).join('\n')}
  </sequence>
</xmeml>
`;
}

/* Final Cut Pro: FCPXML */
export function fcpxml(log) {
  const r = rateOf(log.rate), s = spanOf(log, r); if (!s) return '';
  // A frame as a fraction of a second: 1001/24000s at 23.976, 1/25s at 25.
  const num = r.scale !== 1 ? 1001 : 100, den = r.scale !== 1 ? r.nominal * 1000 : r.nominal * 100;
  const t = f => (f === 0 ? '0s' : `${f * num}/${den}s`);
  const name = `${oneLine(log.title || 'Timecode notes')} — Vdex markers`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="Vdex ${xml(r.id)}" frameDuration="${num}/${den}s" width="1920" height="1080"/>
  </resources>
  <library>
    <event name="Vdex markers">
      <project name="${xml(name)}">
        <sequence format="r1" tcStart="${t(s.start)}" tcFormat="${r.df ? 'DF' : 'NDF'}" duration="${t(s.end - s.start)}">
          <spine>
            <gap name="Vdex notes" offset="${t(s.start)}" start="${t(s.start)}" duration="${t(s.end - s.start)}">
${s.ms.map(m => `              <marker start="${t(m.frames)}" duration="${t(1)}" value="${xml(m.name)}"${m.comment ? ` note="${xml(m.comment)}"` : ''}${m.kind === 'good' ? ' completed="1"' : ''}/>`).join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

export const MARKER_FILES = [
  { key: 'avid', label: 'Avid Media Composer markers (.txt)', ext: 'txt', type: 'text/plain', make: avidMarkers, how: 'Markers window → its menu → Import Markers, with the clip or sequence loaded: each marker lands at its timecode.' },
  { key: 'resolve', label: 'DaVinci Resolve markers (.edl)', ext: 'edl', type: 'text/plain', make: resolveEdl, how: 'Right-click the timeline → Timelines → Import → Timeline Markers from EDL. The timeline’s timecode must match the camera’s (a timeline that starts at the clip’s own timecode).' },
  { key: 'premiere', label: 'Premiere Pro markers (.xml)', ext: 'xml', type: 'application/xml', make: premiereXml, how: 'File → Import: a sequence that starts at the camera’s timecode with a marker at each note. Put the clip on it at its own timecode and they line up.' },
  { key: 'fcp', label: 'Final Cut Pro markers (.fcpxml)', ext: 'fcpxml', type: 'application/xml', make: fcpxml, how: 'File → Import → XML: a project in an event “Vdex markers” whose timeline starts at the camera’s timecode, with a marker at each note.' },
];
export const markerFileName = (log, f) => `${nameFile(log)}_markers.${f.ext}`;

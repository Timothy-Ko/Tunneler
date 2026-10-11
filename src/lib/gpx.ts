import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Pin, Track, PIN_TYPES } from '../types';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildGpx(projectName: string, tracks: Track[], pins: Pin[]): string {
  const wpts = pins
    .map(
      (p) =>
        `  <wpt lat="${p.lat}" lon="${p.lng}">\n` +
        `    <name>${esc(`${PIN_TYPES[p.type]?.label ?? 'Pin'}: ${p.title || ''}`.trim())}</name>\n` +
        `    <desc>${esc(p.note || '')}</desc>\n` +
        `    <time>${new Date(p.created_at).toISOString()}</time>\n` +
        `  </wpt>`
    )
    .join('\n');

  const trks = tracks
    .map((t) => {
      const seg = t.points
        .map((pt) => {
          const ele = pt.alt != null ? `<ele>${pt.alt.toFixed(1)}</ele>` : '';
          return `      <trkpt lat="${pt.lat}" lon="${pt.lng}">${ele}<time>${new Date(pt.t).toISOString()}</time></trkpt>`;
        })
        .join('\n');
      return `  <trk>\n    <name>${esc(t.name)}</name>\n    <trkseg>\n${seg}\n    </trkseg>\n  </trk>`;
    })
    .join('\n');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="TrenchMap" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata><name>${esc(projectName)}</name></metadata>\n` +
    `${wpts}\n${trks}\n</gpx>\n`
  );
}

export async function shareGpx(projectName: string, tracks: Track[], pins: Pin[]): Promise<void> {
  const xml = buildGpx(projectName, tracks, pins);
  const safe = projectName.replace(/[^a-z0-9]+/gi, '_') || 'trenchmap';
  const path = `${FileSystem.cacheDirectory}${safe}.gpx`;
  await FileSystem.writeAsStringAsync(path, xml, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'application/gpx+xml', UTI: 'public.xml' });
  }
}

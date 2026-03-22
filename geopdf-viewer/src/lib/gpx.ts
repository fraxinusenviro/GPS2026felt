/**
 * GPX import/export utilities.
 * Implements GPX 1.1 schema for waypoints and tracks.
 */

import type { Waypoint, Track, TrackPoint } from '@/types'
import { haversineDistance } from './coordinates'

// ─── Export ───────────────────────────────────────────────────────────────────

export function exportWaypointsGpx(waypoints: Waypoint[]): string {
  const wpts = waypoints
    .map(
      (wp) => `  <wpt lat="${wp.lat}" lon="${wp.lon}">
    ${wp.elevation !== undefined ? `<ele>${wp.elevation.toFixed(1)}</ele>` : ''}
    <time>${new Date(wp.timestamp).toISOString()}</time>
    <name>${escapeXml(wp.name)}</name>
    <desc>${escapeXml(wp.description)}</desc>
    <sym>${wp.icon}</sym>
  </wpt>`,
    )
    .join('\n')

  return gpxHeader() + wpts + '\n</gpx>'
}

export function exportTrackGpx(track: Track): string {
  const trkpts = track.points
    .map(
      (pt) => `      <trkpt lat="${pt.lat}" lon="${pt.lon}">
        ${pt.elevation !== undefined ? `<ele>${pt.elevation.toFixed(1)}</ele>` : ''}
        <time>${new Date(pt.timestamp).toISOString()}</time>
        ${pt.speed !== undefined ? `<speed>${pt.speed.toFixed(2)}</speed>` : ''}
      </trkpt>`,
    )
    .join('\n')

  const trk = `  <trk>
    <name>${escapeXml(track.name)}</name>
    <desc>${escapeXml(track.description)}</desc>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`

  return gpxHeader() + trk + '\n</gpx>'
}

export function exportAllGpx(waypoints: Waypoint[], tracks: Track[]): string {
  const wpts = waypoints
    .map(
      (wp) => `  <wpt lat="${wp.lat}" lon="${wp.lon}">
    ${wp.elevation !== undefined ? `<ele>${wp.elevation.toFixed(1)}</ele>` : ''}
    <time>${new Date(wp.timestamp).toISOString()}</time>
    <name>${escapeXml(wp.name)}</name>
    <desc>${escapeXml(wp.description)}</desc>
    <sym>${wp.icon}</sym>
  </wpt>`,
    )
    .join('\n')

  const trks = tracks
    .map((track) => {
      const trkpts = track.points
        .map(
          (pt) => `      <trkpt lat="${pt.lat}" lon="${pt.lon}">
        ${pt.elevation !== undefined ? `<ele>${pt.elevation.toFixed(1)}</ele>` : ''}
        <time>${new Date(pt.timestamp).toISOString()}</time>
      </trkpt>`,
        )
        .join('\n')

      return `  <trk>
    <name>${escapeXml(track.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`
    })
    .join('\n')

  return gpxHeader() + wpts + '\n' + trks + '\n</gpx>'
}

export function exportWaypointsCsv(waypoints: Waypoint[]): string {
  const rows = waypoints.map(
    (wp) =>
      `${wp.lat},${wp.lon},${wp.elevation ?? ''},${csvEscape(wp.name)},${csvEscape(wp.description)},${new Date(wp.timestamp).toISOString()}`,
  )
  return 'latitude,longitude,elevation,name,description,timestamp\n' + rows.join('\n')
}

export function exportTrackCsv(track: Track): string {
  const rows = track.points.map(
    (pt) =>
      `${new Date(pt.timestamp).toISOString()},${pt.lat},${pt.lon},${pt.elevation ?? ''},${pt.speed ?? ''},${pt.heading ?? ''}`,
  )
  return 'timestamp,latitude,longitude,elevation,speed,heading\n' + rows.join('\n')
}

export function exportWaypointsGeoJson(waypoints: Waypoint[]): string {
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: waypoints.map((wp) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [wp.lon, wp.lat, wp.elevation ?? 0] },
      properties: {
        name: wp.name,
        description: wp.description,
        timestamp: new Date(wp.timestamp).toISOString(),
        icon: wp.icon,
        color: wp.color,
      },
    })),
  }
  return JSON.stringify(fc, null, 2)
}

export function exportTrackGeoJson(track: Track): string {
  const fc: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: track.points.map((pt) => [pt.lon, pt.lat, pt.elevation ?? 0]),
        },
        properties: {
          name: track.name,
          description: track.description,
          startedAt: new Date(track.startedAt).toISOString(),
          endedAt: track.endedAt ? new Date(track.endedAt).toISOString() : null,
          totalDistanceM: track.totalDistance,
        },
      },
    ],
  }
  return JSON.stringify(fc, null, 2)
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface GpxImportResult {
  waypoints: Omit<Waypoint, 'id'>[]
  tracks: Omit<Track, 'id'>[]
}

export function parseGpx(xmlText: string): GpxImportResult {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')

  const waypoints: Omit<Waypoint, 'id'>[] = []
  const tracks: Omit<Track, 'id'>[] = []

  // Parse waypoints
  doc.querySelectorAll('wpt').forEach((el) => {
    const lat = parseFloat(el.getAttribute('lat') ?? '0')
    const lon = parseFloat(el.getAttribute('lon') ?? '0')
    const name = el.querySelector('name')?.textContent ?? 'Waypoint'
    const desc = el.querySelector('desc')?.textContent ?? ''
    const ele = el.querySelector('ele')?.textContent
    const time = el.querySelector('time')?.textContent

    waypoints.push({
      name,
      description: desc,
      lat,
      lon,
      elevation: ele ? parseFloat(ele) : undefined,
      timestamp: time ? new Date(time).getTime() : Date.now(),
      icon: 'pin',
      color: '#3b82f6',
    })
  })

  // Parse tracks
  doc.querySelectorAll('trk').forEach((trk) => {
    const name = trk.querySelector('name')?.textContent ?? 'Track'
    const desc = trk.querySelector('desc')?.textContent ?? ''
    const points: TrackPoint[] = []

    trk.querySelectorAll('trkpt').forEach((pt) => {
      const lat = parseFloat(pt.getAttribute('lat') ?? '0')
      const lon = parseFloat(pt.getAttribute('lon') ?? '0')
      const ele = pt.querySelector('ele')?.textContent
      const time = pt.querySelector('time')?.textContent
      const speed = pt.querySelector('speed')?.textContent

      points.push({
        lat,
        lon,
        elevation: ele ? parseFloat(ele) : undefined,
        timestamp: time ? new Date(time).getTime() : Date.now(),
        speed: speed ? parseFloat(speed) : undefined,
      })
    })

    if (points.length > 0) {
      let totalDistance = 0
      for (let i = 1; i < points.length; i++) {
        totalDistance += haversineDistance(
          points[i - 1].lat, points[i - 1].lon,
          points[i].lat, points[i].lon,
        )
      }

      tracks.push({
        name,
        description: desc,
        startedAt: points[0].timestamp,
        endedAt: points[points.length - 1].timestamp,
        points,
        totalDistance,
        color: '#ef4444',
      })
    }
  })

  return { waypoints, tracks }
}

// ─── Download helper ──────────────────────────────────────────────────────────

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })

  // Try File System Access API first (Chrome/Edge)
  if ('showSaveFilePicker' in window) {
    const ext = filename.split('.').pop() ?? 'txt'
    window
      .showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'File', accept: { [mimeType]: [`.${ext}`] } }],
      })
      .then(async (fileHandle) => {
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()
      })
      .catch(() => fallbackDownload(blob, filename))
  } else {
    fallbackDownload(blob, filename)
  }
}

function fallbackDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gpxHeader(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GeoPDF Web Viewer"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

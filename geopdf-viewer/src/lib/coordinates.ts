/**
 * Coordinate format conversion utilities.
 * Supports DD, DMS, DDM, UTM, and MGRS display formats.
 *
 * Also provides proj4-based reprojection with lazy EPSG definition loading.
 */

import proj4 from 'proj4'
import type { CoordFormat, MapRegistration, LatLon } from '@/types'
import { applyAffine, applyAffineInverse } from './affine'

// ─── Proj4 definition loader ──────────────────────────────────────────────────

const epsgCache = new Map<string, string>()

/** Lazy-load an EPSG definition from epsg.io and register with proj4 */
export async function ensureProjection(crs: string): Promise<void> {
  if (crs === 'EPSG:4326' || crs === 'WGS84') return
  if (epsgCache.has(crs)) {
    proj4.defs(crs, epsgCache.get(crs)!)
    return
  }

  // Check if already registered
  try {
    proj4(crs, 'EPSG:4326', [0, 0])
    return
  } catch {
    // Not registered – fetch it
  }

  const epsgCode = crs.replace(/^EPSG:/i, '')
  try {
    const res = await fetch(`https://epsg.io/${epsgCode}.proj4`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const def = await res.text()
    epsgCache.set(crs, def.trim())
    proj4.defs(crs, def.trim())
  } catch (err) {
    console.warn(`Failed to load projection ${crs}:`, err)
    // Fallback: try common built-in definitions
    registerFallback(crs)
  }
}

function registerFallback(crs: string): void {
  const epsg = parseInt(crs.replace(/^\D+/, ''))
  if (!epsg) return

  // UTM WGS84 North zones: 32601–32660
  if (epsg >= 32601 && epsg <= 32660) {
    const zone = epsg - 32600
    proj4.defs(crs, `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`)
    return
  }
  // UTM WGS84 South zones: 32701–32760
  if (epsg >= 32701 && epsg <= 32760) {
    const zone = epsg - 32700
    proj4.defs(crs, `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`)
    return
  }
  // NAD83 UTM North zones: 26901–26923
  if (epsg >= 26901 && epsg <= 26923) {
    const zone = epsg - 26900
    proj4.defs(crs, `+proj=utm +zone=${zone} +datum=NAD83 +units=m +no_defs`)
    return
  }
}

// ─── Coordinate conversion ────────────────────────────────────────────────────

/**
 * Convert a WGS-84 (lon, lat) to the map's projected coordinate space,
 * then to PDF user units.
 */
export function latLonToPdfPoint(
  lat: number,
  lon: number,
  reg: MapRegistration,
): { pdfX: number; pdfY: number } {
  let projX: number, projY: number

  if (reg.crs === 'EPSG:4326') {
    projX = lon; projY = lat
  } else {
    try {
      ;[projX, projY] = proj4(reg.crs, 'EPSG:4326').inverse([lon, lat])
      // proj4 forward: WGS84 → projected
      ;[projX, projY] = proj4('EPSG:4326', reg.crs, [lon, lat])
    } catch {
      // Fallback: treat as geographic if projection fails
      projX = lon; projY = lat
    }
  }

  // Inverse affine: projected → PDF units
  const [pdfX, pdfY] = applyAffineInverse(reg.affine, projX, projY)
  return { pdfX, pdfY }
}

/**
 * Convert PDF user units to WGS-84 (lat, lon).
 */
export function pdfPointToLatLon(
  pdfX: number,
  pdfY: number,
  reg: MapRegistration,
): LatLon {
  const [projX, projY] = applyAffine(reg.affine, pdfX, pdfY)

  if (reg.crs === 'EPSG:4326') {
    return { lat: projY, lon: projX }
  }

  try {
    const [lon, lat] = proj4(reg.crs, 'EPSG:4326', [projX, projY])
    return { lat, lon }
  } catch {
    return { lat: projY, lon: projX }
  }
}

// ─── Format display strings ───────────────────────────────────────────────────

export function formatCoordinate(lat: number, lon: number, format: CoordFormat): string {
  switch (format) {
    case 'DD':
      return formatDD(lat, lon)
    case 'DMS':
      return formatDMS(lat, lon)
    case 'DDM':
      return formatDDM(lat, lon)
    case 'UTM':
      return formatUTM(lat, lon)
    case 'MGRS':
      return formatMGRS(lat, lon)
    default:
      return formatDD(lat, lon)
  }
}

function formatDD(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(6)}° ${ns}  ${Math.abs(lon).toFixed(6)}° ${ew}`
}

function formatDMS(lat: number, lon: number): string {
  return `${toDMS(lat, 'NS')}  ${toDMS(lon, 'EW')}`
}

function toDMS(deg: number, dirs: string): string {
  const dir = deg >= 0 ? dirs[0] : dirs[1]
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const minFrac = (abs - d) * 60
  const m = Math.floor(minFrac)
  const s = ((minFrac - m) * 60).toFixed(2)
  return `${d}° ${m}' ${s}" ${dir}`
}

function formatDDM(lat: number, lon: number): string {
  return `${toDDM(lat, 'NS')}  ${toDDM(lon, 'EW')}`
}

function toDDM(deg: number, dirs: string): string {
  const dir = deg >= 0 ? dirs[0] : dirs[1]
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const m = ((abs - d) * 60).toFixed(4)
  return `${d}° ${m}' ${dir}`
}

function formatUTM(lat: number, lon: number): string {
  try {
    const zone = Math.floor((lon + 180) / 6) + 1
    const epsg = lat >= 0 ? `EPSG:${32600 + zone}` : `EPSG:${32700 + zone}`
    const [easting, northing] = proj4('EPSG:4326', epsg, [lon, lat])
    const hem = lat >= 0 ? 'N' : 'S'
    return `${zone}${hem}  ${Math.round(easting)} E  ${Math.round(northing)} N`
  } catch {
    return `UTM error`
  }
}

function formatMGRS(lat: number, lon: number): string {
  try {
    // Simple MGRS approximation
    const zone = Math.floor((lon + 180) / 6) + 1
    const epsg = lat >= 0 ? `EPSG:${32600 + zone}` : `EPSG:${32700 + zone}`
    const [easting, northing] = proj4('EPSG:4326', epsg, [lon, lat])
    // Band letter
    const bands = 'CDEFGHJKLMNPQRSTUVWX'
    const bandIdx = Math.floor((lat + 80) / 8)
    const band = bands[Math.max(0, Math.min(19, bandIdx))]
    const e100k = Math.floor(easting / 100000)
    const n100k = Math.floor(northing / 100000) % 20
    const eLetters = 'ABCDEFGH'
    const nLetters = 'ABCDEFGHJKLMNPQRSTUV'
    const eLet = eLetters[(e100k - 1) % 8] ?? 'A'
    const nLet = nLetters[n100k % 20]
    const eLocal = String(Math.floor(easting % 100000)).padStart(5, '0')
    const nLocal = String(Math.floor(northing % 100000)).padStart(5, '0')
    return `${zone}${band} ${eLet}${nLet} ${eLocal} ${nLocal}`
  } catch {
    return `MGRS error`
  }
}

// ─── Coordinate parsing (for search) ─────────────────────────────────────────

/** Parse a coordinate string in any supported format → { lat, lon } | null */
export function parseCoordinateString(input: string): LatLon | null {
  const s = input.trim()

  // Decimal degrees: "45.1234 -63.4567" or "45.1234N 63.4567W"
  const ddMatch = s.match(
    /^([-+]?\d{1,3}\.?\d*)[°\s,]*([NS])?\s*[,\s]\s*([-+]?\d{1,3}\.?\d*)[°\s]*([EW])?$/i,
  )
  if (ddMatch) {
    let lat = parseFloat(ddMatch[1])
    let lon = parseFloat(ddMatch[3])
    if (ddMatch[2]?.toUpperCase() === 'S') lat = -Math.abs(lat)
    if (ddMatch[4]?.toUpperCase() === 'W') lon = -Math.abs(lon)
    if (isValidLatLon(lat, lon)) return { lat, lon }
  }

  // DMS: "45°7'24.48"N 63°27'24.12"W"
  const dmsMatch = s.match(
    /(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["\s]*([NS])[,\s]+(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["\s]*([EW])/i,
  )
  if (dmsMatch) {
    const lat = dmsToDec(+dmsMatch[1], +dmsMatch[2], +dmsMatch[3], dmsMatch[4])
    const lon = dmsToDec(+dmsMatch[5], +dmsMatch[6], +dmsMatch[7], dmsMatch[8])
    if (isValidLatLon(lat, lon)) return { lat, lon }
  }

  return null
}

function dmsToDec(d: number, m: number, s: number, dir: string): number {
  const dec = d + m / 60 + s / 3600
  return dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W' ? -dec : dec
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

// ─── Haversine distance ───────────────────────────────────────────────────────

/** Distance between two WGS-84 points in metres */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Format a distance (metres) as a human-readable string */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(2)} km`
}

/** Format an area (square metres) as a human-readable string */
export function formatArea(sqm: number): string {
  if (sqm < 10000) return `${Math.round(sqm)} m²`
  const ha = sqm / 10000
  if (ha < 100) return `${ha.toFixed(2)} ha`
  return `${(sqm / 1e6).toFixed(3)} km²`
}

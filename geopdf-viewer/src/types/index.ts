// ─── Coordinate types ─────────────────────────────────────────────────────────

export interface LatLon {
  lat: number
  lon: number
}

export interface PdfPoint {
  x: number // PDF user units, origin bottom-left
  y: number
}

/** Affine transform: projected ← PDF point */
export interface AffineTransform {
  /** 2×3 matrix: [a, b, c, d, e, f] where proj = A·pdf + t */
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

// ─── Map types ────────────────────────────────────────────────────────────────

export type CoordFormat = 'DD' | 'DMS' | 'DDM' | 'UTM' | 'MGRS'

export interface MapRegistration {
  /** proj4 string or EPSG:XXXX */
  crs: string
  /** Affine transform: PDF units → projected coords */
  affine: AffineTransform
  /** page height in PDF user units (for y-flip) */
  pageHeightPt: number
  /** page width in PDF user units */
  pageWidthPt: number
  /** Bounding box in WGS-84 [west, south, east, north] */
  bounds?: [number, number, number, number]
}

export interface ImportedMap {
  id: string
  name: string
  fileName: string
  fileSize: number
  importedAt: number
  registration: MapRegistration | null
  thumbnailDataUrl?: string
  /** Total pages in the PDF */
  numPages: number
  /** Which page holds the map (usually 1) */
  mapPage: number
}

// ─── Waypoint types ───────────────────────────────────────────────────────────

export type WaypointIcon =
  | 'pin'
  | 'circle'
  | 'star'
  | 'flag'
  | 'warning'
  | 'camera'
  | 'sample'

export interface Waypoint {
  id: string
  name: string
  description: string
  lat: number
  lon: number
  elevation?: number
  timestamp: number
  icon: WaypointIcon
  color: string
  photoDataUrl?: string
}

// ─── Track types ──────────────────────────────────────────────────────────────

export interface TrackPoint {
  lat: number
  lon: number
  elevation?: number
  timestamp: number
  accuracy?: number
  speed?: number
  heading?: number
}

export interface Track {
  id: string
  name: string
  description: string
  startedAt: number
  endedAt?: number
  points: TrackPoint[]
  totalDistance: number // metres
  color: string
}

// ─── Overlay types ────────────────────────────────────────────────────────────

export interface VectorOverlay {
  id: string
  name: string
  fileName: string
  importedAt: number
  geojson: GeoJSON.FeatureCollection
  color: string
  visible: boolean
}

// ─── GPS types ────────────────────────────────────────────────────────────────

export interface GpsPosition {
  lat: number
  lon: number
  accuracy: number
  altitude?: number
  altitudeAccuracy?: number
  speed?: number
  heading?: number
  timestamp: number
}

// ─── UI / viewport types ──────────────────────────────────────────────────────

export interface ViewTransform {
  scale: number
  panX: number
  panY: number
  rotation: number // degrees
}

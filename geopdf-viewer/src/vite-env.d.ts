/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Extend Window for File System Access API
interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>
}

// GeoJSON types (minimal, augmenting global)
declare namespace GeoJSON {
  type GeoJsonTypes =
    | 'Point' | 'MultiPoint'
    | 'LineString' | 'MultiLineString'
    | 'Polygon' | 'MultiPolygon'
    | 'GeometryCollection'
    | 'Feature' | 'FeatureCollection'

  interface GeoJsonObject { type: GeoJsonTypes }

  interface Point extends GeoJsonObject { type: 'Point'; coordinates: number[] }
  interface MultiPoint extends GeoJsonObject { type: 'MultiPoint'; coordinates: number[][] }
  interface LineString extends GeoJsonObject { type: 'LineString'; coordinates: number[][] }
  interface MultiLineString extends GeoJsonObject { type: 'MultiLineString'; coordinates: number[][][] }
  interface Polygon extends GeoJsonObject { type: 'Polygon'; coordinates: number[][][] }
  interface MultiPolygon extends GeoJsonObject { type: 'MultiPolygon'; coordinates: number[][][][] }
  interface GeometryCollection extends GeoJsonObject {
    type: 'GeometryCollection'
    geometries: Geometry[]
  }

  type Geometry =
    | Point | MultiPoint | LineString | MultiLineString
    | Polygon | MultiPolygon | GeometryCollection

  type GeoJSON = Geometry | Feature | FeatureCollection

  interface Feature extends GeoJsonObject {
    type: 'Feature'
    geometry: Geometry
    properties: Record<string, unknown> | null
    id?: string | number
  }

  interface FeatureCollection extends GeoJsonObject {
    type: 'FeatureCollection'
    features: Feature[]
  }
}

// Web APIs not yet in TypeScript lib
interface WakeLockSentinel {
  release(): Promise<void>
  readonly released: boolean
  readonly type: 'screen'
}

interface Navigator {
  wakeLock: {
    request(type: 'screen'): Promise<WakeLockSentinel>
  }
}

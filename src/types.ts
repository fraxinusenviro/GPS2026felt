// ============================================================
// Core Data Types for Fraxinus Field Mapper
// ============================================================

export type GeometryType = 'Point' | 'LineString' | 'Polygon';
export type CaptureMethod = 'gps' | 'sketch';
export type ToolMode =
  | 'gps-point' | 'gps-point-stream' | 'gps-line' | 'gps-polygon'
  | 'sketch-point' | 'sketch-line' | 'sketch-polygon'
  | 'select' | 'edit-attrs' | 'delete' | 'edit-geometry' | 'none';

// ---- Feature Data Model ----
export interface FieldFeature {
  id: string;                   // UUID v4
  point_id: string;             // e.g. IB_2026_05_01_1241
  type: string;                 // User-selected preset TYPE
  desc: string;                 // Free-text description
  geometry_type: GeometryType;
  geometry: GeoJSONGeometry;
  capture_method: CaptureMethod;
  created_at: string;           // ISO 8601
  updated_at: string;           // ISO 8601
  created_by: string;           // user_id / initials
  lat: number | null;           // centroid lat (populated for points)
  lon: number | null;           // centroid lon
  elevation: number | null;     // metres above ellipsoid (GPS)
  accuracy: number | null;      // GPS horizontal accuracy (m)
  layer_id: string;             // Layer/preset group this belongs to
  notes: string;                // Additional notes
  photos: string[];             // base64 photo data URLs
}

// ---- GeoJSON minimal types (typed for clarity) ----
export interface GeoJSONPoint { type: 'Point'; coordinates: [number, number] | [number, number, number]; }
export interface GeoJSONLineString { type: 'LineString'; coordinates: Array<[number, number] | [number, number, number]>; }
export interface GeoJSONPolygon { type: 'Polygon'; coordinates: Array<Array<[number, number] | [number, number, number]>>; }
export type GeoJSONGeometry = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;

export interface GeoJSONFeature {
  type: 'Feature';
  id?: string | number;
  geometry: GeoJSONGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

// ---- Preset / Type configuration ----
export interface TypePreset {
  id: string;
  label: string;
  geometry_type: GeometryType | 'all';
  color: string;      // hex colour for map symbolisation
  icon?: string;      // optional SVG icon
  is_quick_entry: boolean; // show as Quick Entry button
}

export interface LayerPreset {
  id: string;
  name: string;
  geometry_type: GeometryType;
  color: string;
  stroke_color: string;
  stroke_width: number;
  fill_opacity: number;
  types: TypePreset[];
}

// ---- Settings ----
export interface AppSettings {
  user_id: string;              // User initials / ID for point_id generation
  default_layer_id: string;
  gps_distance_tolerance: number;  // metres between GPS stream points
  gps_time_tolerance: number;      // seconds between GPS stream points
  gps_min_accuracy: number;        // minimum GPS accuracy to accept (m)
  crosshair_visible: boolean;
  grid_visible: boolean;
  follow_user: boolean;
  hud_source: 'user' | 'crosshair';
  basemap_id: string;
  quick_entry_preset_id: string;
  quick_entry_preset_id_2: string;
  quick_entry_preset_id_3: string;
  wakelock_enabled: boolean;
  auto_save: boolean;
  coord_format: 'dd' | 'dms' | 'utm';
}

// ---- GPS State ----
export interface GPSState {
  lat: number;
  lon: number;
  elevation: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
  available: boolean;
}

// ---- Capture Session ----
export interface CaptureSession {
  id: string;
  tool_mode: ToolMode;
  geometry_type: GeometryType;
  capture_method: CaptureMethod;
  type: string;              // preset type for this capture
  desc: string;              // description for this capture
  coordinates: Array<[number, number] | [number, number, number]>;
  start_time: number;
  last_point_time: number;
  last_point_coords: [number, number] | null;
  point_count: number;
  total_distance: number; // metres
  paused: boolean;
  active: boolean;
}

// ---- Basemap definition ----
export interface BasemapDef {
  id: string;
  label: string;
  type: 'raster' | 'vector';
  url: string;          // tile URL template or style URL
  attribution: string;
  min_zoom?: number;
  max_zoom?: number;
  tile_size?: number;
  group?: string;   // palette group heading, e.g. "NS DNRR Forestry"
}

// ---- Online Data Connections ----
export type OnlineDataType = 'wms' | 'wmts' | 'wfs' | 'wcs' | 'esri-rest' | 'cog' | 'xyz';

export interface SavedConnection {
  id: string;
  name: string;
  type: OnlineDataType;
  url: string;
  group?: string;           // display group heading, e.g. "NS DNRR Forestry"
  params?: Record<string, string>;
  added_at: string;
}

export interface OnlineLayer {
  id: string;
  connection_id: string;
  name: string;
  type: OnlineDataType;
  visible: boolean;
  opacity: number;
  blend_mode: string;
  map_layer_id: string; // MapLibre layer ID
  tileUrl?: string;     // tile URL template for raster layers
}

// ---- Imported layers ----
export interface ImportedLayer {
  id: string;
  name: string;
  file_type: 'geojson' | 'kml' | 'shp' | 'mbtiles' | 'geopdf';
  data: GeoJSONFeatureCollection | null;
  tile_data?: Uint8Array;        // for mbtiles
  visible: boolean;
  opacity: number;
  color: string;
  added_at: string;
  label_field?: string;          // field to use for map labels (vector layers)
  bounds?: [number, number, number, number]; // [west,south,east,north] for mbtiles/geopdf zoom
  image_data_url?: string;       // JPEG data URL for georeferenced geopdf overlay
}

// ---- Events ----
export type AppEventType =
  | 'gps-update'
  | 'tool-changed'
  | 'feature-added'
  | 'feature-updated'
  | 'feature-deleted'
  | 'feature-selected'
  | 'feature-deselected'
  | 'capture-started'
  | 'capture-stopped'
  | 'capture-paused'
  | 'settings-changed'
  | 'layer-added'
  | 'layer-deleted'
  | 'layer-removed'
  | 'layer-visibility-changed'
  | 'basemap-changed'
  | 'grid-toggled'
  | 'toast';

export interface AppEvent<T = unknown> {
  type: AppEventType;
  payload?: T;
}

// ---- Export options ----
export interface ExportOptions {
  format: 'geojson' | 'shp' | 'kml' | 'csv';
  layer_ids?: string[];         // empty = all
  include_imported?: boolean;
}

// ---- Toast ----
export interface ToastMessage {
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

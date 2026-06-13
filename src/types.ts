// ============================================================
// Core Data Types for Fraxinus Field Mapper
// ============================================================

export type GeometryType = 'Point' | 'LineString' | 'Polygon';
export type CaptureMethod = 'gps' | 'sketch';
export type ToolMode =
  | 'gps-point' | 'gps-point-stream' | 'gps-line' | 'gps-polygon'
  | 'sketch-point' | 'sketch-line' | 'sketch-polygon' | 'sketch-freehand'
  | 'select' | 'edit-attrs' | 'delete' | 'edit-geometry' | 'lasso-select' | 'measure' | 'none';

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
  project_id: string;           // owning project ID
}

// ---- Project ----
export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  default_layer_id: string;     // active sketch layer for this project
  basemap_stack_json: string;   // JSON-serialized StackLayer[] from BasemapManager
  map_center: [number, number]; // [lng, lat]
  map_zoom: number;
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

// ---- Symbology Studio ----
export type SymbologyMethod = 'single' | 'categorical' | 'graduated' | 'proportional';
export type ClassifierName = 'Natural breaks' | 'Quantile' | 'Equal interval';

export interface SymbologyState {
  method: SymbologyMethod;
  field?: string;
  palette?: string;         // qualitative palette key for categorical
  ramp?: string;            // sequential ramp key for graduated
  classes?: number;         // 3–7 classes for graduated
  classifier?: ClassifierName;
  color?: string;           // single fill color
  opacity?: number;         // 0–1 overall opacity
  size?: number;            // circle-radius / line-width / outline-width
  // Point-specific
  outlineColor?: string;
  outlineWidth?: number;
  // Line-specific
  cap?: 'round' | 'butt' | 'square';
  casing?: boolean;
  casingColor?: string;
  casingWidth?: number;
  // Polygon-specific
  strokeColor?: string;
  strokeOpacity?: number;
}

// ---- Raster Symbology Studio ----
export type RasterStretchMode = 'percentile' | 'minmax' | 'stddev1' | 'stddev2' | 'custom';

export interface RasterSymbologyState {
  rampId: string;             // 'original' | key of RASTER_RAMPS
  invert?: boolean;
  mode?: 'continuous' | 'classified';
  classifier?: ClassifierName;
  classes?: number;           // 3–9 classes when classified
  stretch?: RasterStretchMode;
  stretchMin?: number;        // custom stretch range (data units; 0–255 for RGB tiles)
  stretchMax?: number;
}

// ---- Preset / Type configuration ----
export type PointShape = 'circle' | 'square' | 'diamond' | 'triangle';
export type DashPattern = 'solid' | 'dashed' | 'dotted';

export interface TypePreset {
  id: string;
  label: string;
  geometry_type: GeometryType | 'all';
  color: string;              // fill hex colour
  fill_opacity?: number;      // 0–1, default 1.0 (points/lines) or 0.35 (polygons)
  stroke_color?: string;      // hex, default '#ffffff' (points) or same as color
  stroke_width?: number;      // px, default 2
  shape?: PointShape;         // point shape, default 'circle'
  icon?: string;              // icon key from AVAILABLE_ICONS (e.g. 'tree')
  icon_color?: string;        // hex, default '#ffffff'
  icon_size?: number;         // icon scale multiplier relative to symbol (default 1.0 = 100%)
  size?: number;              // circle radius / symbol half-size in px (default 7)
  dash_pattern?: DashPattern; // line dash style, default 'solid'
  rotation?: number;          // shape rotation degrees 0-360, default 0
  icon_rotation?: number;     // icon overlay rotation degrees 0-360, default 0
  casing_color?: string;      // hex, line casing colour (border around line)
  casing_width?: number;      // px, extra width added each side for casing (default 0 = no casing)
  is_quick_entry: boolean;
  visible?: boolean;          // hide all features of this type on map (default true)
  show_labels?: boolean;      // show type label text on map (default true)
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
  project_id?: string;          // owning project ID (undefined = legacy global)
  visible?: boolean;            // TOC visibility toggle (default true)
  symbologyState?: SymbologyState; // data-driven symbology override
}

// ---- Settings ----
export interface AppSettings {
  user_id: string;              // User initials / ID for point_id generation
  default_layer_id: string;
  active_project_id: string;    // currently loaded project
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
  map_bg_color?: string;
  outdoor_mode: boolean;
  theme: 'dark' | 'light';
  font_family?: 'default' | 'oswald';
  theme_color?: string;
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

// ---- Vector overlay config (for nshn-vector and nsprd-vector types) ----
export interface VectorLayerConfig {
  endpoint: string;
  geomType: 'line' | 'polygon';
  where?: string;
  outFields?: string;
  resultRecordCount?: number;
  // Additional endpoints fetched in parallel and merged (e.g. roads HW + LO)
  additionalEndpoints?: string[];
  // Zoom-dependent endpoint: use highZoomEndpoint when zoom >= highZoomThreshold
  highZoomEndpoint?: string;
  highZoomThreshold?: number;
  // Styling: plain CSS color string OR a MapLibre expression array
  lineColor: string | unknown[];
  lineWidth: number | unknown[];
  fillColor?: string | unknown[];
  fillOpacity?: number;  // 0–1 default fill opacity override (e.g. 0.6 for 60%)
  // Human-readable field labels for the identify popup
  fieldLabels?: Record<string, string>;
}

// ---- Basemap definition ----
export interface BasemapDef {
  id: string;
  label: string;
  type: 'raster' | 'vector' | 'nsprd-vector' | 'nshn-vector' | 'hrdem-wcs' | 'cog-contour' | 'geojson';
  url: string;          // tile URL template or style URL (for 'geojson': the file URL to fetch)
  attribution: string;
  description?: string; // Data Library card description (catalogue layers)
  min_zoom?: number;
  max_zoom?: number;
  tile_size?: number;
  group?: string;   // palette group heading, e.g. "NS DNRR Forestry"
  vector_config?: VectorLayerConfig;
  // For COG raster layers: QGIS-style color stops [value, R, G, B, alpha 0-255]
  cog_colormap?: Array<[number, number, number, number, number]>;
  // For cog-contour layers: default threshold value in native units
  cog_contour_threshold?: number;
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
  project_id?: string;           // owning project ID (undefined = legacy)
  symbologyState?: SymbologyState; // data-driven symbology override
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

// ---- Tile Cache ----
export interface TileCacheLayerDef {
  defId: string;
  label: string;
  urlTemplate: string;
  type: 'xyz' | 'wms';
}

export interface TileCacheRecord {
  id: string;
  name: string;
  created_at: string;
  bbox: [number, number, number, number]; // [west, south, east, north] WGS84
  layers: TileCacheLayerDef[];
  zoom_min: number;
  zoom_max: number;
  tile_count: number;
  size_bytes: number;
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

// ---- Shared data library layers (org-shared uploads; synced via cloud) ----
// Metadata/index for a vector or raster dataset whose bytes live in R2.
export interface SharedLayer {
  id: string;                                   // uuid
  name: string;
  folder?: string;                              // slash-nestable grouping, e.g. "Wetlands"
  kind: 'vector' | 'raster';
  format: string;                               // 'geojson' | 'cog' | 'pmtiles' | …
  r2_key: string;                               // R2 object key holding the file
  size?: number;                                // bytes
  description?: string;                         // shown on the Data Library card
  source?: string;                              // attribution / provenance
  geometry_type?: 'Point' | 'LineString' | 'Polygon'; // vector hint
  bounds?: [number, number, number, number];    // [west, south, east, north]
  style?: { color?: string; opacity?: number; fillOpacity?: number; lineWidth?: number };
  field_labels?: Record<string, string>;        // identify popup field → label
  symbologyState?: SymbologyState;              // data-driven symbology (vector)
  added_at: string;
  added_by?: string;
  updated_at?: string;                          // drives last-write-wins
}

// ---- Project templates (preset basemap stack + datasets for new projects) ----
export interface StackSpec {
  defId: string;                          // BasemapDef id from the catalogue
  overrides?: Record<string, unknown>;    // StackLayer field overrides (opacity, visible, vec*, etc.)
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  stackSpecs: StackSpec[];                // index 0 = topmost overlay, last = base layer
}

// ---- Project bundle (for P2P sync via file) ----
export interface ProjectBundle {
  format: 'fm2026-bundle';
  version: number;
  exported_at: string;
  bundle_name: string;
  project: Project;
  features: FieldFeature[];
  layer_presets: LayerPreset[];
  type_presets: TypePreset[];
}

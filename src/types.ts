// ============================================================
// Core Data Types for Fraxinus Field Mapper
// ============================================================

export type GeometryType = 'Point' | 'LineString' | 'Polygon';
export type CaptureMethod = 'gps' | 'sketch';
export type ToolMode =
  | 'gps-point' | 'gps-point-stream' | 'gps-line' | 'gps-polygon'
  | 'sketch-point' | 'sketch-line' | 'sketch-polygon' | 'sketch-freehand'
  | 'sketch-shape' | 'annotate'
  | 'select' | 'edit-attrs' | 'delete' | 'edit-geometry' | 'lasso-select' | 'measure'
  | 'wetlands-plot' | 'photo-point' | 'none';

// ---- Shape drawing tools (Part 1) ----
// Geometric shapes drawn into the active sketch layer as ordinary project data
// (Polygon for area shapes, LineString for arc/bezier), or onto the graphical
// Annotations layer when the shape target is 'annotation'.
export type ShapeKind = 'circle' | 'ellipse' | 'rectangle' | 'square'
                      | 'arc' | 'bezier' | 'ngon' | 'buffer';
export type ShapeMethod = 'drag' | 'parametric';
export type ShapeTarget = 'data' | 'annotation';
export interface ShapeParams {
  radiusM: number;       // circle / arc / ngon radius
  majorM: number;        // ellipse semi-major axis (E-W)
  minorM: number;        // ellipse semi-minor axis (N-S)
  widthM: number;        // rectangle width
  heightM: number;       // rectangle height
  rotationDeg: number;   // shape rotation
  startAngleDeg: number; // arc start bearing
  endAngleDeg: number;   // arc end bearing
  segments: number;      // densification steps for circle/ellipse/arc
  sides: number;         // regular N-gon side count
  bufferM: number;       // buffer-around-feature distance
}

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
  wetland_data?: WetlandSurvey; // Wetland delineation survey (only on wetland-plot features)
  inventory_data?: InventoryFeatureData; // Biodiversity inventory observation (only on inventory features)
  photo_data?: PhotoPointData; // Photo point metadata (only on photo-point features)
}

// ---- Photo point metadata ----
export interface PhotoPointData {
  bearing: number;     // camera bearing 0–360° (direction the lens faces)
  observer?: string;   // observer name / initials
  caption?: string;    // short caption printed beneath the photo in the PDF log
  source?: 'gps' | 'exif'; // where coordinates/bearing came from (live GPS vs image EXIF)
}

// ---- Biodiversity inventory (ported from the NSINV app) ----
// Each observation becomes a point FieldFeature in the per-project
// "{projectId}-inventory" layer. The survey context is denormalized onto every
// observation feature (inventory_data) so a submitted survey reconstructs by
// grouping features on inventory_data.surveyId — this rides through IndexedDB
// and cloud sync inside the feature's JSON doc (no backend change required).
export interface SpeciesRecord {
  elcode: string;
  taxon: string;
  taxonGroup: string;
  family: string;
  mcode: string;
  commonName: string;
  scientificName: string;
  srank: string;
  grank?: string;
  nrank?: string;
  nprot?: string | null;
  sprot?: string | null;
  noteRank?: string | null;
  commonNameFr?: string;
}

export interface InventoryObservation {
  id: string;
  species: SpeciesRecord;
  timestamp: number;
  lat: number;
  lon: number;
  notes: string;
}

export interface InventorySurvey {
  id: string;
  surveyID: string;
  siteName: string;
  surveyor: string;
  locale: string;
  county: string;
  date: string;
  reportNote: string;
  startTime: number;
  endTime: number | null;
  pausedAt: number | null;
  pausedDuration: number;
  status: 'draft' | 'submitted';
  project_id: string;
  observations: InventoryObservation[];
}

// Per-observation survey context denormalized onto each FieldFeature.
export interface InventoryFeatureData {
  surveyId: string;
  surveyID: string;
  siteName: string;
  surveyor: string;
  locale: string;
  county: string;
  date: string;
  startTime: number;
  endTime: number | null;
  elcode: string;
  mcode: string;
  taxon: string;
  taxonGroup: string;
  family: string;
  commonName: string;
  scientificName: string;
  srank: string;
  sprot: string | null;
  nprot: string | null;
  grank: string;
  isSoCI: boolean;
  obsTimestamp: number;
}

// Inventory report configuration (mirrors NSINV report settings).
export interface InventoryReportFields {
  family: boolean; code: boolean; scientificName: boolean;
  srank: boolean; sprot: boolean; nprot: boolean; grank: boolean;
  latitude: boolean; longitude: boolean; time: boolean; notes: boolean;
}
export interface InventoryReportSettings {
  title: string;
  subtitle: string;
  sortOrder: 'time' | 'family' | 'commonName' | 'scientificName';
  includeMap: boolean;
  includeCurve: boolean;
  labelObsNumbers: boolean;
  colorScheme: 'fraxinus' | 'slate' | 'terracotta';
  fields: InventoryReportFields;
}

// ---- Wetland delineation survey (ported from the WETLANDS app) ----
// Stored inside a point FieldFeature in the dedicated per-project "Wetland Plots"
// layer. Field names mirror the WETLANDS schema verbatim so the ported PDF report
// consumes the survey unchanged. The whole object rides through local IndexedDB
// and cloud sync inside the feature's JSON doc (no backend change required).
export interface WetlandPhoto {
  name: string;
  type?: string;
  size?: number;
  dataUrl: string;   // base64 data URL (resized JPEG)
  ts?: string;       // ISO timestamp
}

export interface WetlandSurvey {
  id: string;
  timestamp: string;
  // Metadata
  SiteID: string; LocaleName: string; Province: string; date: string; time: string; observer: string;
  PLOT_ID: string; WetlandID: string; PLOT_TYPE: string; latitude: string | number; longitude: string | number;
  LocalRelief: string; PercentSlope: string | number; Landform: string;
  // Disturbance & problematic conditions
  DistSoilYN: string; DistVegYN: string; DistHydroYN: string;
  ProbSoilYN: string; ProbVegYN: string; ProbHydroYN: string;
  ClimHydroNormalYN: string; CircNormalYN: string;
  // Summary determinations
  SummaryHydroVegYN: string; SummaryHydricSoilYN: string; SummaryHydrologyYN: string; SummaryInWetlandYN: string;
  notes: string;
  // Hydrology
  RestrictiveLayer: string; RestrictiveLayerDepthCM: string | number;
  SurfaceWaterYN: string; SurfaceWaterDepthCM: string | number;
  WaterTableYN: string; WaterTableDepthCM: string | number;
  SaturationYN: string; SaturationDepthCM: string | number;
  HydricSoilIndicators: string[]; HydrologyPrimary: string[]; HydrologySecondary: string[];
  photos: WetlandPhoto[];
  // Dynamic keys: vegetation (TreeSp1..6 / ShrubSp1..6 / HerbSp1..10 + Cov/Status/Dom)
  // and soil horizons (SoilH1..4 + Restrictive/Depth/Texture/Matrix/Redox fields).
  [key: string]: unknown;
}

// ---- Project ----
export interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  color?: string;               // project accent color for visual identity in the library
  thumbnail_url?: string;       // size-reduced preview image (JPEG data URL) for the library card
  // Legacy map-state fields — kept for backward compat; new map state lives in ProjectMap.
  default_layer_id: string;     // active sketch layer (mirrors active ProjectMap.default_layer_id)
  basemap_stack_json: string;   // JSON-serialized StackLayer[] from BasemapManager (shared baseline)
  user_layer_views?: Record<string, string>; // per-user (user_id → stack JSON) symbology/visibility
  map_center: [number, number]; // [lng, lat]
  map_zoom: number;
}

// ---- ProjectMap — a named, saveable view within a Project ----
// Projects own the data (features, layer presets); maps own the view (basemap
// stack, viewport, active sketch layer). One project can have many maps.
export interface ProjectMap {
  id: string;
  project_id: string;               // owning Project.id (features/layers scoped here)
  name: string;
  basemap_stack_json: string;       // shared canonical basemap stack for this map
  user_layer_views?: Record<string, string>;  // per-user overrides (userId → stack JSON)
  user_viewports?: Record<string, { center: [number, number]; zoom: number }>; // per-user viewport
  map_center: [number, number];     // shared default viewport [lng, lat]
  map_zoom: number;
  default_layer_id: string;        // active sketch layer for capture in this map
  created_at: string;
  updated_at: string;
  created_by?: string;             // user_id of map creator
  thumbnail_url?: string;          // size-reduced preview image (JPEG data URL) for map rows
  show_global_overlay?: boolean;   // show cross-project features as a read-only reference layer
}

// ---- GeoJSON minimal types (typed for clarity) ----
export interface GeoJSONPoint { type: 'Point'; coordinates: [number, number] | [number, number, number]; }
export interface GeoJSONLineString { type: 'LineString'; coordinates: Array<[number, number] | [number, number, number]>; }
export interface GeoJSONPolygon { type: 'Polygon'; coordinates: Array<Array<[number, number] | [number, number, number]>>; }
export type GeoJSONGeometry = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon;

// ---- Graphical annotations (Part 2) ----
// Cartographic decoration scoped to a single ProjectMap. NOT field data: never
// listed in attribute tables nor included in feature/data exports. Each
// annotation records the zoom it was placed at (base_zoom) so it can be rendered
// at a constant ground size — growing/shrinking as the user zooms relative to
// that baseline (see MapManager size expressions).
export type AnnotationKind = 'text' | 'arrow' | 'callout' | 'shape' | 'marker' | 'highlighter' | 'note';
export interface Annotation {
  id: string;
  map_id: string;               // owning ProjectMap.id — the scoping key
  project_id: string;           // for convenience / cascade cleanup
  kind: AnnotationKind;
  geometry: GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon; // text/callout=Point anchor; arrow/leader=LineString; shape=Polygon|LineString
  text?: string;                // label / callout text
  tail_to?: [number, number];   // callout leader-line endpoint (optional)
  base_zoom: number;            // map.getZoom() at placement — scaling baseline
  base_size: number;            // px at base_zoom (text size px, or line width px)
  color: string;
  halo_color?: string;
  rotation?: number;            // degrees, for text / arrow
  created_at: string;
  updated_at: string;
  created_by: string;
}

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
  fill_pattern?: HatchPattern; // polygon fill pattern, default 'solid'
  // Custom legend label overrides, keyed by stable legend-entry key
  // ('all' | 'cat:<value>' | 'g:<index>'). Empty/missing = use generated label.
  legendLabels?: Record<string, string>;
  // Labels (any source attribute; empty/undefined = no labels)
  label_field?: string;
  label_size?: number;       // text size px
  label_color?: string;      // text colour
  // Point shape (default 'circle'; non-circle uses a symbol layer)
  shape?: PointShape;
  // Point icon overlay (key into ICON_PATHS; undefined = plain circle)
  icon?: string;
  icon_color?: string;
  icon_size?: number;        // scale multiplier ~0.5–2.5
  icon_rotation?: number;    // degrees 0–360
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
export type HatchPattern = 'solid' | 'hatch-h' | 'hatch-v' | 'hatch-cross' | 'hatch-diagonal';

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
  cap?: 'butt' | 'round' | 'square';  // line cap style, default 'round'
  rotation?: number;          // shape rotation degrees 0-360, default 0
  icon_rotation?: number;     // icon overlay rotation degrees 0-360, default 0
  casing_color?: string;      // hex, line casing colour (border around line)
  casing_width?: number;      // px, extra width added each side for casing (default 0 = no casing)
  fill_pattern?: HatchPattern; // polygon fill pattern, default 'solid'
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
  size?: number;                 // icon size (used by photo-points and future presets)
  types: TypePreset[];
  project_id?: string;          // owning project ID (undefined = legacy global)
  visible?: boolean;            // TOC visibility toggle (default true)
  show_labels?: boolean;        // show point labels on map (default true)
  label_field?: string;         // which feature field drives map labels (photo points: point_id|observer|notes|bearing|date)
  symbologyState?: SymbologyState; // data-driven symbology override
}

// ---- Settings ----
export interface AppSettings {
  user_id: string;              // User initials / ID for point_id generation
  default_layer_id: string;
  active_project_id: string;    // currently loaded project (for feature/layer scoping)
  active_map_id?: string;       // currently loaded map within the project
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
  font_family?: 'default' | 'oswald' | 'lato' | 'roboto-condensed';
  theme_color?: string;
  ui_style?: 'default' | 'topograph';
  // ---- Inventory module ----
  inventory_db_vertebrates?: boolean;
  inventory_db_vascular?: boolean;
  inventory_db_nonvascular?: boolean;
  inventory_db_invertebrates?: boolean;  // large (~2.5MB) — off by default, lazy-loaded
  inventory_report?: InventoryReportSettings;
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
  // Geographic extent [west, south, east, north] when known (e.g. shared layers),
  // used by "Zoom to Layer" for rasters that have no queryable vector source.
  bounds?: [number, number, number, number];
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
  source_crs?: string;           // original CRS of imported data (EPSG code); data stored as WGS84
  bounds?: [number, number, number, number]; // [west,south,east,north] for mbtiles/geopdf zoom
  minzoom?: number;              // mbtiles min stored zoom
  maxzoom?: number;              // mbtiles max stored zoom (source overzooms beyond this)
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

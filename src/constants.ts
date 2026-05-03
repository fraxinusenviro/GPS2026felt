import type { BasemapDef, AppSettings, TypePreset, LayerPreset, SavedConnection } from './types';

// ---- Default App Settings ----
export const DEFAULT_SETTINGS: AppSettings = {
  user_id: 'USER',
  default_layer_id: 'default',
  gps_distance_tolerance: 5,     // 5 metres
  gps_time_tolerance: 3,          // 3 seconds
  gps_min_accuracy: 20,           // 20m max acceptable accuracy
  crosshair_visible: true,
  grid_visible: false,
  follow_user: false,
  hud_source: 'crosshair',
  basemap_id: 'esri-imagery',
  quick_entry_preset_id: '',
  quick_entry_preset_id_2: '',
  quick_entry_preset_id_3: '',
  wakelock_enabled: false,
  auto_save: true,
  coord_format: 'dd'
};

// ---- Basemap Definitions ----
export const BASEMAPS: BasemapDef[] = [
  {
    id: 'esri-imagery',
    label: 'ESRI Imagery',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, GeoEye, Earthstar Geographics',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-hybrid',
    label: 'ESRI Imagery (Hybrid)',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, GeoEye',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    type: 'raster',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    tile_size: 256,
    max_zoom: 19
  },
  {
    id: 'topo',
    label: 'OpenTopoMap',
    type: 'raster',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap, © OpenStreetMap contributors',
    tile_size: 256,
    max_zoom: 17
  }
];

// ---- Default Type Presets ----
export const DEFAULT_TYPE_PRESETS: TypePreset[] = [
  { id: 'tree', label: 'Tree', geometry_type: 'Point', color: '#2d7a2d', icon: '', is_quick_entry: false },
  { id: 'road', label: 'Road', geometry_type: 'LineString', color: '#c8a020', icon: '', is_quick_entry: false },
  { id: 'stream', label: 'Stream', geometry_type: 'LineString', color: '#1a6aaa', icon: '', is_quick_entry: false },
  { id: 'frog', label: 'Frog', geometry_type: 'Point', color: '#4ab04a', icon: '', is_quick_entry: true },
  { id: 'building', label: 'Building', geometry_type: 'Polygon', color: '#aa4a4a', icon: '', is_quick_entry: false },
  { id: 'wetland', label: 'Wetland', geometry_type: 'Polygon', color: '#4a8aaa', icon: '', is_quick_entry: false },
  { id: 'invasive', label: 'Invasive Species', geometry_type: 'Point', color: '#c83030', icon: '', is_quick_entry: false },
  { id: 'sample', label: 'Sample Site', geometry_type: 'Point', color: '#9a4acc', icon: '', is_quick_entry: false },
  { id: 'boundary', label: 'Boundary', geometry_type: 'LineString', color: '#ff8800', icon: '', is_quick_entry: false },
  { id: 'habitat', label: 'Habitat', geometry_type: 'Polygon', color: '#6aaa2d', icon: '', is_quick_entry: false },
];

// ---- Default Layer Presets ----
export const DEFAULT_LAYER_PRESETS: LayerPreset[] = [
  {
    id: 'default',
    name: 'Field Survey',
    geometry_type: 'Point',
    color: '#4ade80',
    stroke_color: '#166534',
    stroke_width: 2,
    fill_opacity: 0.7,
    types: DEFAULT_TYPE_PRESETS
  }
];

const T = new Date().toISOString();

// ---- Default Saved Connections ----
export const DEFAULT_CONNECTIONS: SavedConnection[] = [
  // General
  { id: 'nasa-gibs-wms', name: 'NASA GIBS (MODIS)', type: 'wms', url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', added_at: T },
  { id: 'usgs-topo-wms', name: 'USGS TNM Topo', type: 'wms', url: 'https://basemap.nationalmap.gov/arcgis/services/USGSTopo/MapServer/WMSServer', added_at: T },
  { id: 'esri-world-wmts', name: 'ESRI World Imagery (WMTS)', type: 'wmts', url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/WMTS/1.0.0/WMTSCapabilities.xml', added_at: T },
  { id: 'usgs-nwis-wfs', name: 'USGS Streamflow Stations (WFS)', type: 'wfs', url: 'https://labs.waterdata.usgs.gov/geoserver/wmadata/ows', added_at: T },
  { id: 'esri-imagery-rest', name: 'ESRI World Imagery (REST)', type: 'esri-rest', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', added_at: T },
  { id: 'esri-streets-rest', name: 'ESRI World Streets (REST)', type: 'esri-rest', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer', added_at: T },
  { id: 'cog-example', name: 'Example COG (NOAA)', type: 'cog', url: 'https://noaa-emergency-response.s3.amazonaws.com/storms/harvey_2017/cog/20170901_NOAA_Harvey_TX_1m.tif', added_at: T },
];

// ---- Basemap Overlay Definitions (hillshade, etc.) ----
export const BASEMAP_OVERLAYS: import('./types').BasemapDef[] = [
  {
    id: 'hrdem-dtm-hillshade',
    label: 'Digital Terrain Model',
    type: 'raster',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dtm-hillshade&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    attribution: '© Natural Resources Canada',
    tile_size: 256,
    max_zoom: 17
  },
  {
    id: 'hrdem-dsm-hillshade',
    label: 'Digital Surface Model',
    type: 'raster',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dsm-hillshade&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    attribution: '© Natural Resources Canada',
    tile_size: 256,
    max_zoom: 17
  },

  // ---- NS Provincial ----
  {
    id: 'ns-plan-nsprd',
    label: 'NS Property Registry (NSPRD)',
    type: 'nsprd-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_UT83/MapServer/0/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20
  },
  {
    id: 'ns-nshn-watercourses',
    label: 'NS Watercourses (NSHN)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/7/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/7/query',
      geomType: 'line',
      where: "FEAT_CODE LIKE 'WARV%' OR FEAT_CODE LIKE 'WARS%' OR FEAT_CODE LIKE 'WACA%' OR FEAT_CODE LIKE 'WACORV%' OR FEAT_CODE LIKE 'WADI%' OR FEAT_CODE LIKE 'WAFU%' OR FEAT_CODE LIKE 'WAFI%' OR FEAT_CODE LIKE 'WASU%'",
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC,RIVNAME_1,SHAPE_Length',
      lineColor: '#4a90f0',
      lineWidth: 1.2,
    }
  },
  {
    id: 'ns-nshn-waterbodies',
    label: 'NS Waterbodies (NSHN)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/16/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/16/query',
      geomType: 'polygon',
      where: "FEAT_CODE NOT LIKE '%SW%' AND FEAT_CODE NOT LIKE '%MARSH%' AND FEAT_CODE NOT LIKE '%BOG%'",
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC,NAME_1,HID,SHAPE_Area,POLY_CLASS',
      lineColor: '#4a90f0',
      lineWidth: 1,
      fillColor: '#1a4a90',
      fillOpacity: 0.55,
    }
  },
  {
    id: 'ns-nshn-wetlands',
    label: 'NS Wetlands (NSHN)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/16/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/WTR/WTR_NSHN_UT83/MapServer/16/query',
      geomType: 'polygon',
      where: "FEAT_CODE LIKE '%SW%' OR FEAT_CODE LIKE '%MARSH%' OR FEAT_CODE LIKE '%BOG%'",
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC,NAME_1,HID,SHAPE_Area,POLY_CLASS',
      lineColor: '#5aae6a',
      lineWidth: 1,
      fillColor: '#3a7a4a',
      fillOpacity: 0.45,
    }
  },
  {
    id: 'ns-crown-parcels',
    label: 'NS Crown Parcels',
    type: 'raster',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/services/PLAN/PLAN_SimplifiedCrownParcels_UT83/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    attribution: '© Province of Nova Scotia',
    tile_size: 256,
    max_zoom: 20
  }
];

// ---- UTM Grid Intervals (metres) ----
export const GRID_INTERVALS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];

// ---- GPS Accuracy Thresholds ----
export const GPS_ACCURACY_GOOD = 5;     // metres - green
export const GPS_ACCURACY_FAIR = 15;    // metres - yellow
// > GPS_ACCURACY_FAIR = red

// ---- Map Layer IDs ----
export const LAYER_IDS = {
  COLLECTED_POINTS: 'collected-points',
  COLLECTED_POINTS_LABELS: 'collected-points-labels',
  COLLECTED_LINES: 'collected-lines',
  COLLECTED_POLYGONS_FILL: 'collected-polygons-fill',
  COLLECTED_POLYGONS_OUTLINE: 'collected-polygons-outline',
  SKETCH_PREVIEW: 'sketch-preview',
  GPS_TRACK_PREVIEW: 'gps-track-preview',
  USER_LOCATION: 'user-location',
  USER_ACCURACY: 'user-accuracy-circle',
  UTM_GRID: 'utm-grid',
  UTM_GRID_LABELS: 'utm-grid-labels',
  SELECTED_FEATURE: 'selected-feature-highlight',
};

// ---- Storage Keys ----
export const DB_NAME = 'FieldMapper2026';
export const DB_VERSION = 2;
export const STORE_FEATURES = 'features';
export const STORE_SETTINGS = 'settings';
export const STORE_PRESETS = 'presets';
export const STORE_LAYERS = 'layers';
export const STORE_CONNECTIONS = 'connections';
export const STORE_IMPORTED = 'imported_layers';
export const STORE_TILES = 'tiles';
export const STORE_ONLINE_LAYERS = 'online_layers';

// ---- Session ----
export function generateSessionId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

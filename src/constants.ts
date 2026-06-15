import type { BasemapDef, AppSettings, TypePreset, LayerPreset, SavedConnection, ProjectTemplate } from './types';

// ---- Default App Settings ----
export const DEFAULT_SETTINGS: AppSettings = {
  user_id: 'USER',
  default_layer_id: 'default',
  active_project_id: 'default',
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
  coord_format: 'dd',
  map_bg_color: '#000000',
  outdoor_mode: false,
  theme: 'dark',
  font_family: 'default',
  theme_color: '#4ade80',
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
  },
  {
    id: 'esri-light-grey',
    label: 'ESRI Light Grey Base',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-natgeo',
    label: 'ESRI NatGeo',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, National Geographic Society, Garmin',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-ocean',
    label: 'ESRI Ocean Basemap',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, GEBCO, NOAA, National Geographic, Garmin',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-street',
    label: 'ESRI Street Map',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors',
    tile_size: 256,
    max_zoom: 23
  },
  {
    id: 'esri-topo',
    label: 'ESRI Topographic',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, HERE, Garmin, FAO, NOAA, USGS',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-physical',
    label: 'ESRI World Physical',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, US National Park Service',
    tile_size: 256,
    max_zoom: 8
  },
  {
    id: 'esri-shaded-relief',
    label: 'ESRI World Shaded Relief',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, USGS, NGA, NASA',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'esri-terrain',
    label: 'ESRI World Terrain',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, USGS, NGA, NASA',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'google-hybrid',
    label: 'Google Hybrid',
    type: 'raster',
    url: 'http://mt0.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}',
    attribution: '© Google',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'google-satellite',
    label: 'Google Satellite',
    type: 'raster',
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attribution: '© Google',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'google-street',
    label: 'Google Street',
    type: 'raster',
    url: 'https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}',
    attribution: '© Google',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'google-terrain',
    label: 'Google Terrain',
    type: 'raster',
    url: 'http://mt0.google.com/vt/lyrs=t&hl=en&x={x}&y={y}&z={z}',
    attribution: '© Google',
    tile_size: 256,
    max_zoom: 18
  },
  {
    id: 'mapzen-terrain',
    label: 'Mapzen Global Terrain',
    type: 'raster',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    attribution: '© Mapzen, © OpenStreetMap contributors',
    tile_size: 256,
    max_zoom: 15
  },
];

// ---- Default Type Presets ----
export const DEFAULT_TYPE_PRESETS: TypePreset[] = [
  // Points
  { id: 'WL_BND_Pt',       label: 'WL_BND_Pt',       geometry_type: 'Point', color: '#ff8800', icon: '', is_quick_entry: false },
  { id: 'WL_Confirmed_Pt', label: 'WL_Confirmed_Pt', geometry_type: 'Point', color: '#22c55e', icon: '', is_quick_entry: false },
  { id: 'WC_CL_PT',        label: 'WC_CL_PT',        geometry_type: 'Point', color: '#3b82f6', icon: '', is_quick_entry: false },
  { id: 'WC_BANK_Pt',      label: 'WC_BANK_Pt',      geometry_type: 'Point', color: '#a78bfa', icon: '', is_quick_entry: false },
  { id: 'TRACKLOG_Pt',     label: 'TRACKLOG_Pt',     geometry_type: 'Point', color: '#facc15', icon: '', is_quick_entry: false },
  { id: 'ROAD_Pt',         label: 'ROAD_Pt',         geometry_type: 'Point', color: '#c8a020', icon: '', is_quick_entry: false },
  { id: 'TRAIL_Pt',        label: 'TRAIL_Pt',        geometry_type: 'Point', color: '#86efac', icon: '', is_quick_entry: false },
  { id: 'FEC_Pt',          label: 'FEC_Pt',          geometry_type: 'Point', color: '#f87171', icon: '', is_quick_entry: false },
  // Lines
  { id: 'WL_BND_Line',     label: 'WL_BND_Line',     geometry_type: 'LineString', color: '#ff8800', icon: '', is_quick_entry: false },
  { id: 'WC_CL_Line',      label: 'WC_CL_Line',      geometry_type: 'LineString', color: '#3b82f6', icon: '', is_quick_entry: false },
  { id: 'WC_BANK_Line',    label: 'WC_BANK_Line',    geometry_type: 'LineString', color: '#a78bfa', icon: '', is_quick_entry: false },
  { id: 'TRACKLOG_Line',   label: 'TRACKLOG_Line',   geometry_type: 'LineString', color: '#facc15', icon: '', is_quick_entry: false },
  // Polygons
  { id: 'WL_AREA_Poly',    label: 'WL_AREA_Poly',    geometry_type: 'Polygon', color: '#22c55e', icon: '', is_quick_entry: false },
  { id: 'HABITAT_Poly',    label: 'HABITAT_Poly',    geometry_type: 'Polygon', color: '#6aaa2d', icon: '', is_quick_entry: false },
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
    types: DEFAULT_TYPE_PRESETS.filter(t => t.geometry_type === 'Point'),
  },
  {
    id: 'default-line',
    name: 'Field Lines',
    geometry_type: 'LineString',
    color: '#facc15',
    stroke_color: '#b45309',
    stroke_width: 2,
    fill_opacity: 1.0,
    types: DEFAULT_TYPE_PRESETS.filter(t => t.geometry_type === 'LineString'),
  },
  {
    id: 'default-polygon',
    name: 'Field Polygons',
    geometry_type: 'Polygon',
    color: '#4ade80',
    stroke_color: '#166534',
    stroke_width: 2,
    fill_opacity: 0.4,
    types: DEFAULT_TYPE_PRESETS.filter(t => t.geometry_type === 'Polygon'),
  },
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
    label: 'DTM Hillshade',
    type: 'raster',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=dtm-hillshade&STYLES=&FORMAT=image/png&TRANSPARENT=TRUE&CRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}',
    attribution: '© Natural Resources Canada',
    tile_size: 256,
    max_zoom: 17
  },
  {
    id: 'hrdem-dsm-hillshade',
    label: 'DSM Hillshade',
    type: 'raster',
    group: 'Elevation',
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
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_UT83/MapServer/0/query',
      geomType: 'polygon',
      lineColor: '#cccccc',
      lineWidth: 0.8,
      fillColor: '#e8e0d0',
      fillOpacity: 0,
      outFields: 'OBJECTID,PID',
      fieldLabels: { OBJECTID: 'OID', PID: 'PID' },
    }
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
      lineColor: '#0066cc',
      lineWidth: 0.8,
      fillColor: '#000000',
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
      lineColor: '#000000',
      lineWidth: 0.5,
      fillColor: '#eab515',
      fillOpacity: 0.6,
    }
  },
  // ---- NS Topographic ----
  {
    id: 'ns-base-contours',
    label: 'NS Contour Lines (10k)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10k_Landforms_WM84/MapServer/2/query',
    attribution: 'Nova Scotia Topographic Database (NSTDB) 1:10,000',
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10k_Landforms_WM84/MapServer/2/query',
      geomType: 'line',
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC,ZVALUE',
      // chars 2-4 of FEAT_CODE: 'CI'/'DI' = index contour (bold), all others = regular (thin)
      lineColor: ['match', ['slice', ['get', 'FEAT_CODE'], 2, 4],
        'CI', '#e8c890',
        'DI', '#e8c890',
        '#c4a870',
      ],
      lineWidth: ['match', ['slice', ['get', 'FEAT_CODE'], 2, 4],
        'CI', 1.5,
        'DI', 1.5,
        0.75,
      ],
      fieldLabels: {
        FEAT_CODE: 'Feature Code',
        FEAT_DESC: 'Contour Type',
        ZVALUE: 'Elevation (m)',
      },
    },
  },
  // ---- NS Admin / Boundaries ----
  {
    id: 'ns-base-parks',
    label: 'NS Parks & Protected Areas',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10K_Delimiter_Boundaries_WM84/MapServer/4/query',
    attribution: 'Nova Scotia Topographic Database (NSTDB) 1:10,000',
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10K_Delimiter_Boundaries_WM84/MapServer/4/query',
      geomType: 'polygon',
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC,NAME',
      // National Park → dark green, Provincial Park → medium green, Protected Area → teal
      lineColor: ['match', ['get', 'FEAT_CODE'],
        'DLPKNA40', '#1a8040',
        'DLPKPR40', '#2a9a50',
        '#3aaa70',
      ],
      lineWidth: 1.5,
      fillColor: ['match', ['get', 'FEAT_CODE'],
        'DLPKNA40', '#1a8040',
        'DLPKPR40', '#2a9a50',
        '#3aaa70',
      ],
      fieldLabels: {
        FEAT_CODE: 'Classification',
        FEAT_DESC: 'Area Type',
        NAME: 'Name',
      },
    },
  },
  {
    id: 'ns-base-designated',
    label: 'NS Designated Areas',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10k_Designated_Areas_WM84/MapServer/1/query',
    attribution: 'Nova Scotia Topographic Database (NSTDB) 1:10,000',
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10k_Designated_Areas_WM84/MapServer/1/query',
      geomType: 'polygon',
      outFields: 'OBJECTID,FEAT_CODE,FEAT_DESC',
      lineColor: '#c8a830',
      lineWidth: 0.8,
      fillColor: '#c8a830',
      fieldLabels: {
        FEAT_CODE: 'Area Code',
        FEAT_DESC: 'Area Type',
      },
    },
  },
  // ---- NS Bio / Habitat ----
  {
    id: 'ns-bio-habitat',
    label: 'NS Significant Habitat',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BIO/WLD_ProvLandScapeViewer_WM84/MapServer/3/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BIO/WLD_ProvLandScapeViewer_WM84/MapServer/3/query',
      geomType: 'polygon',
      outFields: 'OBJECTID,FEATURE,SITE,HECTARES',
      resultRecordCount: 1000,
      lineColor: ['match', ['get', 'FEATURE'],
        'species at risk', '#ff0000', 'of concern', '#ff8040',
        'deer wintering', '#5aaa88', 'moose wintering', '#b06060',
        'migratory bird', '#5080aa', 'other habitat', '#8060a0', '#888888'],
      lineWidth: 0.8,
      fillColor: ['match', ['get', 'FEATURE'],
        'species at risk', '#ff0000', 'of concern', '#ffa77f',
        'deer wintering', '#9ed7c2', 'moose wintering', '#e39e9e',
        'migratory bird', '#9ebbd7', 'other habitat', '#b191b5', '#888888'],
      fieldLabels: { OBJECTID: 'OID', FEATURE: 'Habitat Type', SITE: 'Site ID', HECTARES: 'Area (ha)' },
    }
  },
  {
    id: 'ns-bio-nsnrr-wetlands',
    label: 'NS Wetlands (NSNRR)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BIO/WLD_ProvLandScapeViewer_WM84/MapServer/5/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/BIO/WLD_ProvLandScapeViewer_WM84/MapServer/5/query',
      geomType: 'polygon',
      outFields: 'OBJECTID,Wetland,Hectares,Surveyed',
      resultRecordCount: 1000,
      lineColor: ['match', ['get', 'Wetland'],
        'Bog', '#4c0073', 'Bog or Fen', '#8400a8', 'Fen', '#a882b3',
        'Marsh', '#aaaa40', 'Salt Marsh', '#896044', 'Swamp', '#5aaa88', 'Water', '#5aaada', '#888888'],
      lineWidth: 0.8,
      fillColor: ['match', ['get', 'Wetland'],
        'Bog', '#4c0073', 'Bog or Fen', '#8400a8', 'Fen', '#a882b3',
        'Marsh', '#aaaa40', 'Salt Marsh', '#896044', 'Swamp', '#5aaa88', 'Water', '#5aaada', '#888888'],
      fieldLabels: { OBJECTID: 'OID', Wetland: 'Wetland Class', Hectares: 'Area (ha)', Surveyed: 'Surveyed' },
    }
  },
  // ---- NS Old Growth Forest ----
  {
    id: 'ns-for-old-growth',
    label: 'NS Old Growth Forest',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/FOR/FOR_OldGrowthForestPolicy_WM84/MapServer/0/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/FOR/FOR_OldGrowthForestPolicy_WM84/MapServer/0/query',
      geomType: 'polygon',
      outFields: 'OBJECTID,Old_Growth,OLDGROWTXT,SELMETHOD,SELMETHTXT,HECTARES',
      resultRecordCount: 2000,
      lineColor: ['match', ['to-number', ['get', 'Old_Growth']], 1, '#1a4010', 2, '#5a8830', '#444444'],
      lineWidth: 0.8,
      fillColor: ['match', ['to-number', ['get', 'Old_Growth']], 1, '#2d6a1e', 2, '#a0c878', '#666666'],
      fieldLabels: { OBJECTID: 'OID', Old_Growth: 'Status Code', OLDGROWTXT: 'Status', SELMETHOD: 'Method Code', SELMETHTXT: 'Method', HECTARES: 'Area (ha)' },
    }
  },
  // ---- NS FEC Soil Type (zoom-dependent endpoint) ----
  {
    id: 'ns-for-fec-soil',
    label: 'NS FEC Soil Type',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/FOR/FOR_FEC_SoilType_WM84/MapServer/1/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/FOR/FOR_FEC_SoilType_WM84/MapServer/1/query',
      highZoomEndpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/FOR/FOR_FEC_SoilType_WM84/MapServer/2/query',
      highZoomThreshold: 15,
      geomType: 'polygon',
      outFields: 'OBJECTID,SoilType,STGroup,HECTARES',
      resultRecordCount: 1000,
      lineColor: '#8a6030',
      lineWidth: 0.6,
      fillColor: '#c8a46e',
      fieldLabels: { OBJECTID: 'OID', SoilType: 'Soil Type', STGroup: 'Soil Group', HECTARES: 'Area (ha)' },
    }
  },
  // ---- NS Roads (NSRN) — two endpoints merged ----
  {
    id: 'ns-trns-roads',
    label: 'NS Roads (NSRN)',
    type: 'nshn-vector',
    group: 'Nova Scotia',
    url: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/TRNS/TRNS_NSRN_Roads_WM84/MapServer/6/query',
    attribution: '© Province of Nova Scotia',
    max_zoom: 20,
    vector_config: {
      endpoint: 'https://nsgiwa.novascotia.ca/arcgis/rest/services/TRNS/TRNS_NSRN_Roads_WM84/MapServer/6/query',
      additionalEndpoints: ['https://nsgiwa.novascotia.ca/arcgis/rest/services/TRNS/TRNS_NSRN_Roads_WM84/MapServer/7/query'],
      geomType: 'line',
      outFields: 'OBJECTID,STREET,RTE_NO,FEAT_DESC,ROADCLASS,ROADC_DESC,OWNER_DESC,TRAFF_DESC',
      resultRecordCount: 2000,
      lineColor: ['match', ['get', 'ROADCLASS'],
        'HW', '#f0c040', 'AR', '#e0a030', 'CO', '#c8c8c8',
        'RE', '#886644', 'UN', '#886644', 'PR', '#777777', 'LN', '#777777', '#aaaaaa'],
      lineWidth: ['match', ['get', 'ROADCLASS'],
        'HW', 2.5, 'AR', 2.0, 'CO', 1.5, 'RE', 1.0, 'UN', 1.0, 1.0],
      fieldLabels: { OBJECTID: 'OID', STREET: 'Street', RTE_NO: 'Route No', FEAT_DESC: 'Description', ROADCLASS: 'Class Code', ROADC_DESC: 'Road Class', OWNER_DESC: 'Owner', TRAFF_DESC: 'Traffic Dir' },
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
  },

  // ---- Elevation (WCS) ----
  {
    id: 'hrdem-elevation',
    label: 'Elevation',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'hrdem-slope',
    label: 'Slope',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'hrdem-aspect',
    label: 'Aspect',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'hrdem-tpi',
    label: 'TPI',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'hrdem-contours',
    label: 'Contours',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },

  // ---- DSM — Digital Surface Model (elevation only; slope/aspect/TPI/contours not exposed) ----
  {
    id: 'hrdem-dsm-elevation',
    label: 'DSM Elevation',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DSM',
    tile_size: 256,
    max_zoom: 22,
  },

  // ---- Canopy Height Model (CHM = DSM − DTM) ----
  {
    id: 'hrdem-chm',
    label: 'Canopy Height (CHM)',
    type: 'hrdem-wcs',
    group: 'Elevation',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DSM/DTM',
    tile_size: 256,
    max_zoom: 22,
  },

  // ---- Raster Functions (computed from DTM) ----
  {
    id: 'raster-fn-hillshade',
    label: 'Hillshade',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-roughness',
    label: 'Terrain Roughness',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-slope-pct',
    label: 'Slope (% Grade)',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-aspect',
    label: 'Aspect (Directional)',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-tpi',
    label: 'Topographic Position Index',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DTM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-dsm-hillshade',
    label: 'DSM Hillshade',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DSM',
    tile_size: 256,
    max_zoom: 22,
  },
  {
    id: 'raster-fn-chm-focal',
    label: 'CHM Focal Statistics',
    type: 'hrdem-wcs',
    group: 'Raster Functions',
    url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic',
    attribution: '© Natural Resources Canada — HRDEM DSM/DTM',
    tile_size: 256,
    max_zoom: 22,
  },

  // ---- Wetland Indices (COG rasters) ----
  {
    id: 'wi-dtw',
    label: 'Depth to Water (DTW)',
    type: 'raster',
    group: 'Wetland Indices',
    url: `cog://${encodeURIComponent('https://nswetlands-mapping.s3.us-east-2.amazonaws.com/COG/DTW_cog.tif')}/{z}/{x}/{y}`,
    attribution: '© NS Wetlands Mapping',
    tile_size: 256,
    max_zoom: 22,
    cog_colormap: [
      [0,   8,   48,  107, 255],
      [10,  74,  137, 175, 255],
      [25,  89,  165, 210, 255],
      [50,  200, 220, 240, 255],
      [100, 247, 251, 255, 0  ],
    ],
  },
  {
    id: 'wi-gei',
    label: 'Groundwater Expression Index (GEI)',
    type: 'raster',
    group: 'Wetland Indices',
    url: `cog://${encodeURIComponent('https://nswetlands-mapping.s3.us-east-2.amazonaws.com/COG/GEI_cog.tif')}/{z}/{x}/{y}`,
    attribution: '© NS Wetlands Mapping',
    tile_size: 256,
    max_zoom: 22,
    cog_colormap: [
      [-15.878, 255, 255, 178, 255],
      [-11.892, 254, 201,  90, 255],
      [-11.702, 254, 198,  89, 255],
      [-11.564, 254, 195,  88, 255],
      [-11.434, 254, 193,  87, 255],
      [-11.276, 254, 191,  85, 255],
      [-11.035, 254, 187,  83, 255],
      [-10.445, 254, 177,  78, 255],
      [ -7.623, 251, 127,  55, 255],
      [ -0.694, 189,   0,  38, 255],
    ],
  },
  {
    id: 'wi-dtw-contour',
    label: 'DTW Threshold Contour',
    type: 'cog-contour',
    group: 'Wetland Indices',
    url: 'https://nswetlands-mapping.s3.us-east-2.amazonaws.com/COG/DTW_cog.tif',
    attribution: '© NS Wetlands Mapping',
    tile_size: 256,
    max_zoom: 22,
    cog_contour_threshold: 50,
  },
  {
    id: 'wi-pdep',
    label: 'Probability of Depression (PDEP)',
    type: 'raster',
    group: 'Wetland Indices',
    url: `cog://${encodeURIComponent('https://nswetlands-mapping.s3.us-east-2.amazonaws.com/COG/PDEP_cog.tif')}/{z}/{x}/{y}`,
    attribution: '© NS Wetlands Mapping',
    tile_size: 256,
    max_zoom: 22,
    cog_colormap: [
      [0.000, 222, 245, 229,   0],
      [0.100, 170, 225, 189, 255],
      [0.200,  97, 207, 172, 255],
      [0.300,  62, 180, 173, 255],
      [0.400,  52, 151, 169, 255],
      [0.500,  53, 123, 163, 255],
      [0.600,  57,  93, 156, 255],
      [0.700,  65,  63, 129, 255],
      [0.800,  56,  42,  84, 255],
      [0.900,  37,  23,  41, 255],
      [0.997,  11,   4,   5, 255],
    ],
  },
  // ── Federal ────────────────────────────────────────────────────────────────
  {
    id: 'fed-ec-cnwi',
    label: 'Canadian National Wetland Inventory (CNWI)',
    type: 'nshn-vector',
    url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CNWI/MapServer/1/query',
    attribution: '© Environment and Climate Change Canada',
    group: 'Federal',
    vector_config: {
      endpoint: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CNWI/MapServer/1/query',
      geomType: 'polygon',
      outFields: 'OBJECTID',
      lineColor: '#2563eb',
      lineWidth: 1,
      fillColor: '#3b82f6',
      fillOpacity: 0.25,
    },
  },
  {
    id: 'fed-ec-critical-habitat',
    label: 'Critical Habitat for Species at Risk',
    type: 'nshn-vector',
    url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/3/query',
    attribution: '© Environment and Climate Change Canada',
    group: 'Federal',
    vector_config: {
      endpoint: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/3/query',
      geomType: 'polygon',
      outFields: 'OBJECTID',
      lineColor: '#dc2626',
      lineWidth: 1,
      fillColor: '#ef4444',
      fillOpacity: 0.2,
    },
  },
  {
    id: 'fed-ec-critical-habitat-proposed',
    label: 'Proposed Critical Habitat for Species at Risk',
    type: 'nshn-vector',
    url: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/4/query',
    attribution: '© Environment and Climate Change Canada',
    group: 'Federal',
    vector_config: {
      endpoint: 'https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CriticalHabitat/MapServer/4/query',
      geomType: 'polygon',
      outFields: 'OBJECTID',
      lineColor: '#f97316',
      lineWidth: 1,
      fillColor: '#fb923c',
      fillOpacity: 0.2,
    },
  },
];

// ---- Named COG color ramps (normalized 0→1 RGB stops, no alpha — always fully opaque) ----
export const COG_RAMPS: Record<string, { label: string; stops: [number, number, number][] }> = {
  viridis:  { label: 'Viridis',  stops: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]] },
  plasma:   { label: 'Plasma',   stops: [[13,8,135],[156,23,158],[237,121,83],[246,207,32],[240,249,33]] },
  inferno:  { label: 'Inferno',  stops: [[0,0,4],[87,16,110],[188,55,84],[249,142,9],[252,255,164]] },
  blues:    { label: 'Blues',    stops: [[247,251,255],[198,219,239],[107,174,214],[33,113,181],[8,48,107]] },
  greens:   { label: 'Greens',   stops: [[247,252,245],[186,228,179],[116,196,118],[35,139,69],[0,68,27]] },
  reds:     { label: 'Reds',     stops: [[255,245,240],[252,187,161],[252,141,89],[222,45,38],[165,15,21]] },
  ylgnbu:   { label: 'YlGnBu',   stops: [[255,255,217],[161,218,180],[65,182,196],[34,94,168],[8,29,88]] },
  rdylbu:   { label: 'RdYlBu',   stops: [[165,0,38],[244,109,67],[255,255,191],[116,173,209],[49,54,149]] },
  spectral: { label: 'Spectral', stops: [[158,1,66],[213,62,79],[253,174,97],[255,255,191],[171,221,164],[72,153,119],[94,79,162]] },
  grays:    { label: 'Grays',    stops: [[255,255,255],[0,0,0]] },
  grays_r:  { label: 'Grays (R)',stops: [[0,0,0],[255,255,255]] },
};

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
export const DB_VERSION = 5;
export const STORE_FEATURES = 'features';
export const STORE_SETTINGS = 'settings';
export const STORE_PRESETS = 'presets';
export const STORE_LAYERS = 'layers';
export const STORE_CONNECTIONS = 'connections';
export const STORE_IMPORTED = 'imported_layers';
export const STORE_TILES = 'tiles';
export const STORE_ONLINE_LAYERS = 'online_layers';
export const STORE_TILE_CACHES = 'tile_caches';
export const STORE_PROJECTS = 'projects';
export const STORE_SHARED_LAYERS = 'shared_layers';

// ---- Project defaults ----

/** Returns 3 default layer presets scoped to a new project. */
export function DEFAULT_PROJECT_LAYER_PRESETS(projectId: string): LayerPreset[] {
  return [
    { id: `${projectId}-points`,   name: 'Points',   geometry_type: 'Point',      color: '#22c55e', stroke_color: '#166534', stroke_width: 2, fill_opacity: 0.8,  types: [], project_id: projectId, visible: true },
    { id: `${projectId}-lines`,    name: 'Lines',    geometry_type: 'LineString', color: '#3b82f6', stroke_color: '#1e40af', stroke_width: 2, fill_opacity: 1.0,  types: [], project_id: projectId, visible: true },
    { id: `${projectId}-polygons`, name: 'Polygons', geometry_type: 'Polygon',    color: '#f59e0b', stroke_color: '#92400e', stroke_width: 2, fill_opacity: 0.35, types: [], project_id: projectId, visible: true },
    // Wetland plots — kept spatially separate from default points so they render,
    // export and sync as their own layer. The rich survey data lives in each
    // feature's wetland_data field. Dark teal matches the WETLANDS report accent.
    { id: `${projectId}-wetlands`, name: 'Wetland Plots', geometry_type: 'Point', color: '#0b6b50', stroke_color: '#ffffff', stroke_width: 2, fill_opacity: 0.9, types: [], project_id: projectId, visible: true },
  ];
}

/** Returns the JSON string for a new project's default basemap stack.
 *  Stack array order: index 0 = topmost overlay, last index = base layer rendered at bottom.
 *  Default layout: property (top, no fill, black stroke) → imagery 50% → hillshade (base).
 */
export function buildDefaultProjectStack(): string {
  const esriDef = BASEMAPS.find(b => b.id === 'esri-imagery')!;
  const nsprdDef = (BASEMAP_OVERLAYS as BasemapDef[]).find(o => o.id === 'ns-plan-nsprd')!;
  const dtmDef   = (BASEMAP_OVERLAYS as BasemapDef[]).find(o => o.id === 'hrdem-dtm-hillshade')!;
  const t = Date.now();
  const stack = [
    // TOP: NS Property Registry — no fill, black stroke
    {
      instanceId: `ov-${t}-nsprd`, defId: nsprdDef.id, label: nsprdDef.label, url: nsprdDef.url,
      type: nsprdDef.type, vector_config: nsprdDef.vector_config,
      tileSize: 256, maxZoom: nsprdDef.max_zoom ?? 20,
      opacity: 1, visible: true, hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
      vecLineColor: '#cccccc', vecFillOpacityOverride: 0,
    },
    // MIDDLE: ESRI imagery at 50% opacity
    {
      instanceId: `ov-${t}-esri`, defId: esriDef.id, label: esriDef.label, url: esriDef.url,
      type: esriDef.type, tileSize: esriDef.tile_size ?? 256, maxZoom: esriDef.max_zoom ?? 19,
      opacity: 0.5, visible: true, hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    },
    // BOTTOM (base layer — must be last in array): DTM hillshade
    {
      instanceId: 'base-0', defId: dtmDef.id, label: dtmDef.label, url: dtmDef.url,
      type: dtmDef.type, tileSize: dtmDef.tile_size ?? 256, maxZoom: dtmDef.max_zoom ?? 17,
      opacity: 1, visible: true, hueRotate: 0, saturation: 0, contrast: 0, brightness: 1,
    },
  ];
  return JSON.stringify({ stack, collapsed: [] });
}

// ---- Project templates ----
// Declarative basemap stacks built at project-creation time via
// BasemapManager.buildStackJson (kept as pure data here to avoid an import cycle).
// stackSpecs order: index 0 = topmost overlay, last = base layer.
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'general',
    label: 'General',
    description: 'NS Property Registry, ESRI Imagery (50%), DTM Hillshade base.',
    stackSpecs: [
      { defId: 'ns-plan-nsprd', overrides: { vecFillOpacityOverride: 0, vecLineColor: '#cccccc' } },
      { defId: 'esri-imagery', overrides: { opacity: 0.5 } },
      { defId: 'hrdem-dtm-hillshade' },
    ],
  },
  {
    id: 'wetland',
    label: 'Wetland-centric',
    description: 'Wetlands (40%), NSHN watercourses & waterbodies, HRDEM 1 m contours, Depth to Water (50%), DTM Hillshade base.',
    stackSpecs: [
      { defId: 'ns-nshn-wetlands', overrides: { opacity: 0.4 } },
      { defId: 'ns-nshn-watercourses' },
      { defId: 'ns-nshn-waterbodies' },
      { defId: 'hrdem-contours' },
      { defId: 'wi-dtw', overrides: { opacity: 0.5 } },
      { defId: 'hrdem-dtm-hillshade' },
    ],
  },
];

// ---- Session ----
export function generateSessionId(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

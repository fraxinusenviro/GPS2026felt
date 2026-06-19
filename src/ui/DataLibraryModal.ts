import { BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import { NS_REST_ALL_DEFS, NS_REST_ALL_GROUP } from '../data/nsRestAll';
import { isSharedDef, isSharedGroup, sharedIdFromDef, SHARED_GROUP_ROOT } from '../data/sharedLayerDefs';
import type { BasemapDef } from '../types';
import { EventBus } from '../utils/EventBus';

// Cap on how many cards render at once (the NS REST catalogue is 1,000+ layers)
const MAX_GRID_CARDS = 200;

const USER_DATA_GROUP = 'user-data';

export interface UserDataEntry {
  userId: string;
  points: number;
  lines: number;
  polygons: number;
  wetlands: number;
  total: number;
  lastUpdated: string;
}

// ── Thumbnail type icons (public/layer-thumbs/type-*.png) ────────────────────
// esri-imagery, esri-hybrid, osm, topo use live tile fetches (not listed here).
// All others map to one of three generic type icons.

const R = './layer-thumbs/type-raster.png';
const L = './layer-thumbs/type-lines.png';
const P = './layer-thumbs/type-polygon.png';

const LAYER_THUMBS: Record<string, string> = {
  // ── Raster / continuous field
  'hrdem-dtm-hillshade':  './layer-thumbs/hrdem-dtm-hillshade.png',
  'hrdem-dsm-hillshade':  './layer-thumbs/hrdem-dsm-hillshade.png',
  'hrdem-elevation':      R,
  'hrdem-slope':          R,
  'hrdem-aspect':         R,
  'hrdem-tpi':            R,
  'hrdem-dsm-elevation':  R,
  'hrdem-chm':            R,
  'raster-fn-chm-focal':  R,
  'wi-dtw':               './layer-thumbs/wi-dtw.png',
  'wi-gei':               './layer-thumbs/wi-gei.png',
  'wi-pdep':              './layer-thumbs/wi-pdep.png',
  'ns-crown-parcels':     R,  // WMS raster

  // ── Line vector features
  'default-line':         L,
  'ns-nshn-watercourses': './layer-thumbs/ns-nshn-watercourses.png',
  'ns-base-contours':     L,
  'ns-trns-roads':        L,
  'hrdem-contours':       L,
  'wi-dtw-contour':       L,

  // ── Polygon vector features
  'default':              P,
  'default-polygon':      P,
  'ns-plan-nsprd':        './layer-thumbs/ns-plan-nsprd.png',
  'ns-nshn-waterbodies':  './layer-thumbs/ns-nshn-waterbodies.png',
  'ns-nshn-wetlands':     './layer-thumbs/ns-nshn-wetlands.png',
  'ns-base-parks':        './layer-thumbs/ns-base-parks.png',
  'ns-base-designated':   P,
  'ns-bio-habitat':       P,
  'ns-bio-nsnrr-wetlands':'./layer-thumbs/ns-bio-nsnrr-wetlands.png',
  'ns-for-old-growth':    P,
  'ns-for-fec-soil':      P,
};

// ── Layer label overrides for the Data Library ────────────────────────────────
// Elevation layers get "NRCan HRDEM" prefix here without touching constants.ts
const LABEL_OVERRIDES: Record<string, string> = {
  'hrdem-dtm-hillshade':  'NRCan HRDEM DTM Hillshade',
  'hrdem-dsm-hillshade':  'NRCan HRDEM DSM Hillshade',
  'hrdem-elevation':      'NRCan HRDEM Elevation (DTM)',
  'hrdem-slope':          'NRCan HRDEM Slope',
  'hrdem-aspect':         'NRCan HRDEM Aspect',
  'hrdem-tpi':            'NRCan HRDEM TPI',
  'hrdem-contours':       'NRCan HRDEM Contours',
  'hrdem-dsm-elevation':  'NRCan HRDEM DSM Elevation',
  'hrdem-chm':            'NRCan HRDEM Canopy Height (CHM)',
  'raster-fn-hillshade':       'Hillshade (DTM)',
  'raster-fn-dsm-hillshade':   'Hillshade (DSM)',
  'raster-fn-roughness':       'Terrain Roughness',
  'raster-fn-slope-pct':       'Slope (% Grade)',
  'raster-fn-aspect':          'Aspect (Directional)',
  'raster-fn-tpi':             'Topographic Position Index (TPI)',
  'raster-fn-chm-focal':       'CHM Focal Statistics',
};

// ── Layer descriptions ────────────────────────────────────────────────────────
const LAYER_DESCRIPTIONS: Record<string, string> = {
  'esri-imagery':           'High-resolution satellite and aerial imagery from ESRI\'s World Imagery service. Updated periodically with the best available imagery per location. Essential reference for land cover identification and field navigation.',
  'esri-hybrid':            'ESRI World Imagery with road and place-name labels overlaid. Combines satellite context with vector navigation features. Useful for field orientation and route planning.',
  'osm':                    'OpenStreetMap community-sourced street map. Shows roads, buildings, land use, and points of interest worldwide. Particularly detailed in settled areas.',
  'topo':                   'Topographic map rendered from OpenStreetMap and SRTM elevation data. Displays contours, terrain relief, and major features in the style of traditional topo maps.',
  'hrdem-dtm-hillshade':    'Digital Terrain Model hillshade derived from NRCan LiDAR HRDEM data. Removes vegetation and structures to reveal bare-earth terrain. 1–2 m resolution across most of Nova Scotia.',
  'hrdem-dsm-hillshade':    'Digital Surface Model hillshade from NRCan HRDEM LiDAR. Retains the height of trees, buildings, and other above-ground objects — useful for canopy structure analysis.',
  'ns-plan-nsprd':          'Nova Scotia Property Registry digital parcel boundaries with PID attributes. Served via the NS Geomatics Centre ESRI REST API. Supports the in-app PID search and identify tool.',
  'ns-nshn-watercourses':   'Nova Scotia Hydrographic Network (NSHN) classified watercourses including rivers, streams, ditches, and canals. Features coded by FEAT_CODE for regulatory screening and field navigation.',
  'ns-nshn-waterbodies':    'NSHN open-water polygons for lakes and ponds (excludes wetland classes). Provides accurate waterbody boundaries for water resources analysis and buffer delineation.',
  'ns-nshn-wetlands':       'Wetland polygons from the NSHN, including bogs, fens, marshes, swamps, and shallow water areas classified by FEAT_CODE. Useful for initial field targeting and regulatory context.',
  'ns-base-contours':       'Nova Scotia Topographic Database (NSTDB) 1:10,000 contour lines at 10 m intervals. Index contours are rendered heavier than intermediate contours using FEAT_CODE classification.',
  'ns-base-parks':          'Provincial and National Parks plus Protected Areas from the NSTDB 1:10,000 Delimiter Boundaries dataset. Polygon features styled by classification: National Park, Provincial Park, or Protected Area.',
  'ns-base-designated':     'Designated land-use areas from the NSTDB including protected zones and special management designations. Useful for environmental screening and regulatory context mapping.',
  'ns-bio-habitat':         'Provincial landscape-level significant wildlife habitat from NS Wildlife Division. Includes species at risk habitat, deer and moose wintering areas, and migratory bird habitat, colour-coded by feature type.',
  'ns-bio-nsnrr-wetlands':  'Provincial wetland inventory from NS Natural Resources & Renewables, classified by Wetland type (Bog, Fen, Marsh, Salt Marsh, Swamp, Water). Higher survey confidence than NSHN wetlands.',
  'ns-for-old-growth':      'Old Growth Forest Policy layer from NS Lands & Forestry. Status 1 = confirmed old growth (dark green), Status 2 = candidate old growth (medium green). Up to 2,000 records per view.',
  'ns-for-fec-soil':        'Forest Ecosystem Classification (FEC) Soil Type polygons from NS LF. Dual-resolution endpoint — switches to higher-detail tiles at zoom ≥ 15. Useful for site quality assessment and forest management.',
  'ns-trns-roads':          'NS Road Network (NSRN) with full classification: Highway, Arterial, Collector, Rural, Unclassified. Merged from two MapServer layers. Colour-coded and width-scaled by road class. Up to 2,000 records.',
  'ns-crown-parcels':       'Simplified Crown land parcel boundaries served via WMS from NS Geomatics Centre. Useful for identifying Crown land extent for initial project area screening and regulatory context.',
  'hrdem-elevation':        'Continuous elevation raster (DTM) from NRCan HRDEM LiDAR. Rendered with a terrain colour ramp from sea level (blue) through forest green, tan highlands, and brown upper slopes to white peaks.',
  'hrdem-slope':            'Slope gradient in degrees derived from the NRCan HRDEM DTM. Colour-coded from flat (green) through moderate (yellow) to steep terrain (red). Supports multiple stretch and unit options in the layer settings.',
  'hrdem-aspect':           'Terrain aspect (slope orientation) from NRCan HRDEM DTM. Rendered as a directional colour wheel: N = cool blue, E = orange, S = warm red, W = purple. Useful for solar exposure and cold-air drainage analysis.',
  'hrdem-tpi':              'Topographic Position Index from NRCan HRDEM DTM. Diverging colour scale distinguishes ridge crests (positive, red) from valley floors (negative, blue). Useful for landform classification and drainage analysis.',
  'hrdem-contours':         'On-demand contour lines generated from the NRCan HRDEM DTM via WCS. Default interval 1 m, rendered without a background raster for use as an overlay. Interval and colour configurable in layer settings.',
  'hrdem-dsm-elevation':    'Digital Surface Model elevation from NRCan HRDEM LiDAR. Includes the height of tree canopy and structures above bare ground. Compare with DTM to derive Canopy Height or identify built features.',
  'hrdem-chm':              'Canopy Height Model computed as DSM − DTM from NRCan HRDEM LiDAR. Represents vegetation and structure height above bare earth. Colour-coded from bare ground (light) to tall canopy (dark green).',
  'wi-dtw':                 'Depth to Water (DTW) index — a continuous-field model predicting depth to the saturated zone across the landscape. Lower values indicate wetter conditions closer to the surface. Developed by Fraxinus for Nova Scotia.',
  'wi-gei':                 'Groundwater Expression Index (GEI) — a field-validated spectral index derived from satellite imagery highlighting persistent moisture and groundwater discharge. Calibrated against field wetland assessments across NS.',
  'wi-dtw-contour':         'Single-threshold contour extracted from the DTW COG raster. Default threshold 50 cm depth to water — approximates the functional wetland boundary for rapid field targeting. Threshold is adjustable in layer settings.',
  'wi-pdep':                'Probability of Depression (PDEP) — a machine-learning model predicting the likelihood of terrain depressions that retain standing water. Higher values (darker purple) indicate greater depression probability. Developed for NS.',
  'raster-fn-hillshade':    'Greyscale hillshade computed from the NRCan HRDEM DTM. Renders pure Lambertian shading without an underlying colour ramp — ideal for draping over imagery or other rasters. Sun azimuth, altitude, and Z-factor are adjustable in the layer settings.',
  'raster-fn-dsm-hillshade':'Greyscale hillshade computed from the NRCan HRDEM DSM. Retains the height of tree canopy and structures in the shading, making canopy edges and building rooflines clearly visible. Azimuth, altitude, and Z-factor configurable in layer settings.',
  'raster-fn-roughness':    'Terrain roughness index — computed as the elevation range within each 3×3 cell neighbourhood on the NRCan HRDEM DTM. Smooth terrain (low values) appears green; rough, highly dissected terrain (high values) appears red. Useful for identifying exposed bedrock, landslide debris, and structural complexity.',
  'raster-fn-slope-pct':    'Slope gradient displayed in percent grade (rise/run × 100) derived from the NRCan HRDEM DTM. A practical metric for engineering and earthworks — slope % directly maps to cut-and-fill constraints. Colour ramp and invert settings are configurable.',
  'raster-fn-aspect':       'Terrain aspect — slope-facing direction rendered as a directional colour wheel on the NRCan HRDEM DTM. North-facing slopes appear cool blue; south-facing warm red; east orange; west purple. Used for solar exposure analysis, cold-air drainage mapping, and species habitat modelling.',
  'raster-fn-tpi':          'Topographic Position Index (TPI) from the NRCan HRDEM DTM — computed as the difference between each cell\'s elevation and the mean of its 8 neighbours. Positive values (red) indicate ridge crests; negative (blue) indicate valley floors and drains. Diverging colour ramp and stretch configurable.',
  'esri-light-grey':        'Minimal light-grey canvas basemap from ESRI. Low visual noise makes it ideal for overlaying thematic data layers where the basemap should recede. Labelled version available via ESRI Canvas series.',
  'esri-natgeo':            'National Geographic-style cartographic basemap from ESRI. Rich terrain rendering with a classic atlas aesthetic. Suitable for presentation-quality maps and regional context.',
  'esri-ocean':             'Ocean-focused basemap from ESRI with detailed bathymetric styling and seafloor terrain. Useful for coastal and marine project contexts.',
  'esri-street':            'World street map from ESRI with roads, place names, and points of interest. Highest resolution of the ESRI basemap set (zmax 23). Good for urban and roaded environments.',
  'esri-topo':              'Topographic basemap from ESRI combining terrain shading, contour context, and land cover. Blends satellite and cartographic elements for a practical field-navigation reference.',
  'esri-physical':          'Physical geography basemap from ESRI showing land cover, terrain, and major hydrographic features in natural tones. Limited to zoom level 8 — best used for regional or continental-scale overviews.',
  'esri-shaded-relief':     'Global shaded relief (hillshade) basemap from ESRI. Rendered in muted earth tones without road labels — useful as a neutral terrain-aware background for overlaying other data.',
  'esri-terrain':           'Bare terrain base from ESRI showing topographic shading and natural surface features without cultural labels. Good for environmental and natural resources context.',
  'google-hybrid':          'Google hybrid satellite imagery with road and place-name labels. Combines high-resolution aerial context with vector navigation features.',
  'google-satellite':       'Google satellite/aerial imagery without labels. High-resolution coverage with frequent updates in developed areas.',
  'google-street':          'Google road map layer with streets, transit, and points of interest. Standard Google Maps street view.',
  'google-terrain':         'Google terrain basemap emphasising topographic relief and natural features. Useful for landscape-scale field orientation.',
  'mapzen-terrain':         'Terrarium-encoded elevation tiles from the Mapzen/AWS open terrain dataset. Each pixel encodes absolute elevation — intended for programmatic elevation lookups rather than visual display.',
  'fed-ec-cnwi':                    'Canadian National Wetland Inventory (CNWI) from Environment and Climate Change Canada. Classifies wetland polygons across Canada including bogs, fens, marshes, swamps, and shallow water. Queried dynamically from the EC CWS MapServer.',
  'fed-ec-critical-habitat':        'Confirmed critical habitat areas for terrestrial species listed under the federal Species at Risk Act (SARA). Compiled by Environment and Climate Change Canada (ECCC) and Parks Canada. Polygon boundaries represent areas where critical habitat occurs — consult the corresponding recovery document for biophysical attribute requirements.',
  'fed-ec-critical-habitat-proposed':'Proposed critical habitat areas for terrestrial species at risk under SARA, prior to final posting. Compiled by ECCC and Parks Canada. Boundaries are subject to revision. Useful for early-stage screening of proposed project footprints against potential future critical habitat.',
  'raster-fn-chm-focal': 'Focal statistics applied to the Canopy Height Model (DSM − DTM from NRCan HRDEM LiDAR). Computes a neighbourhood statistic (mean, min, max, median, sum, or percentile) across a moving window of configurable shape and size. Useful for smoothing canopy roughness, identifying local canopy maxima, or computing structural percentile heights.',
};

// ── Raster Function configurable parameter schemas ────────────────────────────

interface RFParamConfig {
  id: string;
  label: string;
  type: 'number' | 'select';
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string; label: string }>;
  showWhen?: { param: string; value: string };
}

const RF_PARAM_SCHEMAS: Record<string, RFParamConfig[]> = {
  'raster-fn-hillshade': [
    { id: 'azimuth',  label: 'Sun Azimuth',  type: 'number', default: 315, min: 0,   max: 360, step: 15, unit: '°' },
    { id: 'altitude', label: 'Sun Altitude', type: 'number', default: 45,  min: 1,   max: 90,  step: 5,  unit: '°' },
    { id: 'zFactor',  label: 'Z-Factor',     type: 'number', default: 1,   min: 0.1, max: 10,  step: 0.1 },
  ],
  'raster-fn-dsm-hillshade': [
    { id: 'azimuth',  label: 'Sun Azimuth',  type: 'number', default: 315, min: 0,   max: 360, step: 15, unit: '°' },
    { id: 'altitude', label: 'Sun Altitude', type: 'number', default: 45,  min: 1,   max: 90,  step: 5,  unit: '°' },
    { id: 'zFactor',  label: 'Z-Factor',     type: 'number', default: 1,   min: 0.1, max: 10,  step: 0.1 },
  ],
  'raster-fn-slope-pct': [
    { id: 'unit',    label: 'Display Unit', type: 'select', default: 'percent',
      options: [{ value: 'percent', label: '% Grade' }, { value: 'degrees', label: 'Degrees' }] },
    { id: 'stretch', label: 'Stretch',      type: 'select', default: 'auto',
      options: [{ value: 'auto', label: 'Auto (data range)' }, { value: '0-45', label: '0–45°' }, { value: '0-90', label: '0–90°' }, { value: 'full', label: 'Full range' }] },
  ],
  'raster-fn-tpi': [
    { id: 'stretch', label: 'Stretch', type: 'select', default: 'symmetric',
      options: [{ value: 'symmetric', label: 'Symmetric (±max)' }, { value: 'auto', label: 'Auto (data range)' }] },
  ],
  'raster-fn-chm-focal': [
    { id: 'neighborhood', label: 'Neighborhood Shape', type: 'select', default: 'circle',
      options: [{ value: 'circle', label: 'Circle' }, { value: 'rectangle', label: 'Rectangle' }] },
    { id: 'radius', label: 'Radius (cells)', type: 'number', default: 3, min: 1, max: 20, step: 1,
      showWhen: { param: 'neighborhood', value: 'circle' } },
    { id: 'width',  label: 'Width (cells)',  type: 'number', default: 3, min: 1, max: 20, step: 1,
      showWhen: { param: 'neighborhood', value: 'rectangle' } },
    { id: 'height', label: 'Height (cells)', type: 'number', default: 3, min: 1, max: 20, step: 1,
      showWhen: { param: 'neighborhood', value: 'rectangle' } },
    { id: 'stat', label: 'Statistic', type: 'select', default: 'mean',
      options: [
        { value: 'mean',       label: 'Mean' },
        { value: 'min',        label: 'Min' },
        { value: 'max',        label: 'Max' },
        { value: 'median',     label: 'Median' },
        { value: 'sum',        label: 'Sum' },
        { value: 'percentile', label: 'Percentile' },
      ] },
    { id: 'percentile', label: 'Percentile (%)', type: 'number', default: 50, min: 0, max: 100, step: 5,
      showWhen: { param: 'stat', value: 'percentile' } },
  ],
};

// ── Thumbnail resolution ──────────────────────────────────────────────────────

function getThumb(def: BasemapDef): { src: string; isTile: boolean } {
  if (def.id in LAYER_THUMBS) return { src: LAYER_THUMBS[def.id], isTile: false };
  const url = def.url ?? '';
  // Fallback: any raster tile layer — grab a low-zoom tile
  if (def.type === 'raster' && url.includes('{z}') && !url.startsWith('cog://')) {
    const src = url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');
    return { src, isTile: true };
  }
  // Vector catalogue layers — generic geometry icon
  if (def.vector_config) {
    return { src: def.vector_config.geomType === 'line' ? L : P, isTile: false };
  }
  if (def.type === 'raster') return { src: R, isTile: false };
  return { src: './layer-thumbs/default.png', isTile: false };
}

function typeLabel(def: BasemapDef): string {
  if ((def.url ?? '').startsWith('cog://')) return 'COG Raster';
  if (def.group === 'Raster Functions') return 'Raster Function';
  switch (def.type) {
    case 'raster':       return 'Raster';
    case 'nsprd-vector': return 'Vector';
    case 'nshn-vector':  return 'Vector';
    case 'hrdem-wcs':    return 'Elevation (WCS)';
    case 'cog-contour':  return 'COG Contour';
    case 'geojson':      return 'Vector (GeoJSON)';
    default:             return def.type;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface DataLibraryCallbacks {
  onAddToMap: (def: BasemapDef) => void;
  onAddToMapWithParams: (def: BasemapDef, params: Record<string, unknown>) => void;
  onRenderImport: (container: HTMLElement) => void;
  onRenderExport: (container: HTMLElement) => void;
  isInStack: (defId: string) => boolean;
  // Shared static-data library (org-wide uploads synced via the cloud).
  getSharedDefs: () => BasemapDef[];
  onUploadShared: (data: { name: string; folder: string; file: File }) => Promise<void>;
  onDeleteShared: (sharedId: string) => Promise<void>;
  // Per-user collected field data summary.
  getUserDataEntries?: () => UserDataEntry[];
}

export class DataLibraryModal {
  private overlay: HTMLElement;
  private callbacks!: DataLibraryCallbacks;
  private searchQuery = '';
  private activeGroup = 'all';
  private activeView: 'library' | 'import' | 'export' = 'library';
  private configuringDefId: string | null = null;
  private uploadOpen = false;
  private uploading = false;
  private gridMode: 'card' | 'list' = 'card';

  constructor() {
    this.overlay = document.getElementById('data-library-overlay')!;
  }

  open(callbacks: DataLibraryCallbacks, initialGroup = 'all'): void {
    this.callbacks = callbacks;
    this.searchQuery = '';
    this.activeGroup = initialGroup;
    this.activeView = 'library';
    this.configuringDefId = null;
    this.uploadOpen = false;
    this.render();
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('dl-open'));
  }

  close(): void {
    this.overlay.classList.remove('dl-open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 250);
  }

  /** Re-render in place if the modal is currently open (e.g. shared layers synced in). */
  refreshIfOpen(): void {
    if (this.overlay.style.display !== 'none' && this.callbacks) this.render();
  }

  private get sharedDefs(): BasemapDef[] {
    return this.callbacks.getSharedDefs?.() ?? [];
  }

  private get allDefs(): BasemapDef[] {
    return [...BASEMAPS, ...BASEMAP_OVERLAYS, ...this.sharedDefs, ...NS_REST_ALL_DEFS];
  }

  private get sharedSubfolders(): string[] {
    const folders = new Set<string>();
    this.sharedDefs.forEach(d => {
      if (d.group && d.group.startsWith(`${SHARED_GROUP_ROOT}: `)) {
        folders.add(d.group.slice(`${SHARED_GROUP_ROOT}: `.length));
      }
    });
    return [...folders].sort();
  }

  private get groups(): string[] {
    const seen = new Set<string>();
    BASEMAP_OVERLAYS.forEach(d => { if (d.group) seen.add(d.group); });
    return [...[...seen].sort(), NS_REST_ALL_GROUP];
  }

  private filteredDefs(): BasemapDef[] {
    let defs = this.allDefs;
    if (this.activeGroup === USER_DATA_GROUP) return [];
    if (this.activeGroup !== 'all') {
      defs = this.activeGroup === 'basemaps'
        ? [...BASEMAPS]
        : this.activeGroup === NS_REST_ALL_GROUP
        ? [...NS_REST_ALL_DEFS]
        : isSharedGroup(this.activeGroup)
        ? (this.activeGroup === SHARED_GROUP_ROOT ? this.sharedDefs : this.sharedDefs.filter(d => d.group === this.activeGroup))
        : BASEMAP_OVERLAYS.filter(d => d.group === this.activeGroup);
    } else if (!this.searchQuery) {
      // Browsing "All Sources" without a search: hide the 1,000+ layer NS REST
      // catalogue so the curated library stays scannable (it has its own section).
      defs = defs.filter(d => d.group !== NS_REST_ALL_GROUP);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      defs = defs.filter(d =>
        (LABEL_OVERRIDES[d.id] ?? d.label).toLowerCase().includes(q) ||
        (d.group ?? '').toLowerCase().includes(q) ||
        d.attribution.toLowerCase().includes(q) ||
        (LAYER_DESCRIPTIONS[d.id] ?? d.description ?? '').toLowerCase().includes(q),
      );
    }
    return defs;
  }

  private renderCard(def: BasemapDef): string {
    const inStack = this.callbacks.isInStack(def.id);
    const { src, isTile } = getThumb(def);
    const displayLabel = LABEL_OVERRIDES[def.id] ?? def.label;
    const tl = typeLabel(def);
    const groupText = def.group ?? 'Standard';
    const desc = LAYER_DESCRIPTIONS[def.id] ?? def.description ?? 'A geospatial data layer for use in field mapping projects.';
    const source = def.attribution;
    const hasParams = def.group === 'Raster Functions' && def.id in RF_PARAM_SCHEMAS;

    const thumbImg = isTile
      ? `<img src="${src}" loading="lazy" alt="${displayLabel}" onerror="this.closest('.dl-card-thumb').classList.add('dl-thumb-err')" />`
      : `<img src="${src}" alt="${displayLabel}" />`;

    let addBtnContent: string;
    if (inStack && !hasParams) {
      addBtnContent = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> Added`;
    } else if (hasParams) {
      addBtnContent = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> Configure &amp; Add`;
    } else {
      addBtnContent = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Map`;
    }

    return `
      <div class="dl-card${inStack ? ' dl-card-active' : ''}" data-def-id="${def.id}">
        <div class="dl-card-thumb" title="Tap for layer info">
          <div class="dl-thumb-inner">
            <div class="dl-thumb-front">
              ${thumbImg}
              ${inStack ? `<div class="dl-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg></div>` : ''}
              <div class="dl-thumb-info-badge">ⓘ</div>
            </div>
            <div class="dl-thumb-back">
              <p class="dl-info-desc">${desc}</p>
              <div class="dl-info-attrs">
                <div class="dl-info-attr"><span class="dl-attr-key">Source</span><span class="dl-attr-val">${source}</span></div>
                <div class="dl-info-attr"><span class="dl-attr-key">Type</span><span class="dl-attr-val">${tl}</span></div>
                ${def.group ? `<div class="dl-info-attr"><span class="dl-attr-key">Group</span><span class="dl-attr-val">${def.group}</span></div>` : ''}
              </div>
              <div class="dl-thumb-back-hint">tap to flip back</div>
            </div>
          </div>
        </div>
        <div class="dl-card-body">
          <div class="dl-card-name">${displayLabel}</div>
          <div class="dl-card-meta">
            <span class="dl-card-group">${groupText}</span>
            <span class="dl-card-type">${tl}</span>
          </div>
        </div>
        <button class="dl-card-add${inStack && !hasParams ? ' dl-card-added' : ''}${hasParams ? ' dl-card-configure' : ''}" data-def-id="${def.id}">
          ${addBtnContent}
        </button>
        ${isSharedDef(def) ? `<button class="dl-card-del" data-shared-id="${sharedIdFromDef(def.id)}" title="Delete from shared library" aria-label="Delete from shared library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>` : ''}
      </div>`;
  }

  // Results grid markup — kept separate so the search box can refresh just this
  // region on each keystroke without rebuilding (and losing focus on) the input.
  private uploadToolbarHtml(): string {
    const folder = this.activeGroup.startsWith(`${SHARED_GROUP_ROOT}: `)
      ? this.activeGroup.slice(`${SHARED_GROUP_ROOT}: `.length) : '';
    return `
            <div class="dl-shared-toolbar">
              <button class="dl-shared-upload-btn" id="dl-shared-upload-toggle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                ${this.uploadOpen ? 'Cancel' : 'Upload data'}
              </button>
              ${this.uploadOpen ? `
              <div class="dl-shared-form">
                <input type="text" id="dl-up-name" class="dl-up-input" placeholder="Layer name" autocomplete="off" />
                <input type="text" id="dl-up-folder" class="dl-up-input" placeholder="Folder (optional)" value="${esc(folder)}" autocomplete="off" />
                <input type="file" id="dl-up-file" class="dl-up-file" accept=".geojson,.json,.tif,.tiff,.pmtiles" />
                <button class="dl-up-submit" id="dl-up-submit"${this.uploading ? ' disabled' : ''}>${this.uploading ? 'Uploading…' : 'Add to library'}</button>
              </div>` : ''}
            </div>`;
  }

  private renderListItem(def: BasemapDef): string {
    const inStack = this.callbacks.isInStack(def.id);
    const displayLabel = LABEL_OVERRIDES[def.id] ?? def.label;
    const tl = typeLabel(def);
    const hasParams = def.group === 'Raster Functions' && def.id in RF_PARAM_SCHEMAS;
    let addBtn: string;
    if (inStack && !hasParams) {
      addBtn = `<button class="dl-list-add dl-list-added" data-def-id="${def.id}" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg> Added</button>`;
    } else if (hasParams) {
      addBtn = `<button class="dl-list-add dl-list-configure" data-def-id="${def.id}">Configure</button>`;
    } else {
      addBtn = `<button class="dl-list-add" data-def-id="${def.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add</button>`;
    }
    return `<div class="dl-list-item${inStack ? ' dl-list-item-active' : ''}" data-def-id="${def.id}">
      <div class="dl-list-info">
        <span class="dl-list-name">${displayLabel}</span>
        <span class="dl-list-meta"><span class="dl-list-group">${def.group ?? 'Standard'}</span><span class="dl-list-type">${tl}</span></span>
      </div>
      ${addBtn}
      ${isSharedDef(def) ? `<button class="dl-card-del" data-shared-id="${sharedIdFromDef(def.id)}" title="Delete" aria-label="Delete from shared library"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : ''}
    </div>`;
  }

  private sectionedGridHtml(defs: BasemapDef[]): string {
    if (this.activeGroup !== 'all' || this.searchQuery) {
      const items = defs.slice(0, MAX_GRID_CARDS);
      return this.gridMode === 'list'
        ? `<div class="dl-list">${items.map(d => this.renderListItem(d)).join('')}</div>`
        : `<div class="dl-grid">${items.map(d => this.renderCard(d)).join('')}</div>`;
    }
    // For "All Sources" without search, group by section (each section capped at MAX_GRID_CARDS)
    const sections: Array<{ label: string; defs: BasemapDef[]; total: number }> = [
      { label: 'Standard Basemaps', defs: BASEMAPS, total: BASEMAPS.length },
      { label: 'Fraxinus Static Data', defs: this.sharedDefs, total: this.sharedDefs.length },
      ...this.groups.filter(g => g !== NS_REST_ALL_GROUP).map(g => {
        const all = BASEMAP_OVERLAYS.filter(d => d.group === g);
        return { label: g, defs: all, total: all.length };
      }),
    ]
      .filter(s => s.defs.length > 0)
      .map(s => ({ ...s, defs: s.defs.slice(0, MAX_GRID_CARDS) }));
    return sections.map(s => `
      <div class="dl-section-header">${s.label}<span class="dl-count">${s.total}</span></div>
      ${this.gridMode === 'list'
        ? `<div class="dl-list">${s.defs.map(d => this.renderListItem(d)).join('')}</div>`
        : `<div class="dl-grid dl-grid-section">${s.defs.map(d => this.renderCard(d)).join('')}</div>`
      }`).join('');
  }

  private renderUserDataView(): string {
    const entries = this.callbacks.getUserDataEntries?.() ?? [];
    const geomIcon = (g: 'point' | 'line' | 'polygon') => {
      if (g === 'point')   return `<svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><circle cx="12" cy="12" r="5"/></svg>`;
      if (g === 'line')    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11"><line x1="4" y1="20" x2="20" y2="4"/></svg>`;
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><polygon points="12 2 22 18 2 18"/></svg>`;
    };
    const wetlandIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M12 22V12"/><path d="M5 9c0-2.5 2-3 3.5-3 2 0 3 1 3 3s-1 3-3.5 3S5 11 5 9z"/><path d="M15.5 7c1 0 2.5.5 2.5 2.5S16 13 14 12"/></svg>`;
    const formatDate = (iso: string) => iso ? iso.slice(0, 10) : '—';

    const cards = entries.length === 0
      ? `<div class="dl-empty">No field data collected yet.</div>`
      : entries.map(e => `
        <div class="dl-userdata-card">
          <div class="dl-userdata-avatar">${esc(e.userId.slice(0, 2))}</div>
          <div class="dl-userdata-info">
            <div class="dl-userdata-userid">${esc(e.userId)}</div>
            <div class="dl-userdata-stats">
              ${e.points   > 0 ? `<span class="dl-uds dl-uds-point">${geomIcon('point')} ${e.points} pt${e.points !== 1 ? 's' : ''}</span>` : ''}
              ${e.lines    > 0 ? `<span class="dl-uds dl-uds-line">${geomIcon('line')} ${e.lines} ln${e.lines !== 1 ? 's' : ''}</span>` : ''}
              ${e.polygons > 0 ? `<span class="dl-uds dl-uds-poly">${geomIcon('polygon')} ${e.polygons} poly</span>` : ''}
              ${e.wetlands > 0 ? `<span class="dl-uds dl-uds-wetland">${wetlandIcon} ${e.wetlands} plot${e.wetlands !== 1 ? 's' : ''}</span>` : ''}
              ${e.total    === 0 ? `<span class="dl-uds">no features</span>` : ''}
            </div>
            <div class="dl-userdata-meta">
              <span class="dl-uds-total">${e.total} feature${e.total !== 1 ? 's' : ''}</span>
              <span class="dl-uds-date">last: ${formatDate(e.lastUpdated)}</span>
            </div>
          </div>
        </div>`).join('');

    return `
      <div class="dl-grid-wrap">
        <div class="dl-grid-label">
          User Data
          <span class="dl-count">${entries.length} user${entries.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="dl-section-header">Collected Field Features</div>
        <div class="dl-userdata-list">${cards}</div>
      </div>`;
  }

  private gridWrapHtml(defs: BasemapDef[]): string {
    if (this.activeGroup === USER_DATA_GROUP) return this.renderUserDataView();
    const toolbar = isSharedGroup(this.activeGroup) ? this.uploadToolbarHtml() : '';
    const labelText = this.activeGroup === 'all' ? 'All Sources' : this.activeGroup === 'basemaps' ? 'Standard Basemaps' : esc(this.activeGroup);
    return `
          <div class="dl-grid-wrap">
            ${toolbar}
            <div class="dl-grid-label">
              ${labelText}
              <span class="dl-count">${defs.length} layer${defs.length !== 1 ? 's' : ''}</span>
              ${this.gridMode === 'card' ? '<span class="dl-flip-hint-global">tap preview to flip for details</span>' : ''}
            </div>
            ${defs.length === 0
              ? `<div class="dl-empty">No layers match "<strong>${esc(this.searchQuery)}</strong>"</div>`
              : `${this.sectionedGridHtml(defs)}
                 ${defs.length > MAX_GRID_CARDS ? `<div class="dl-empty">Showing the first ${MAX_GRID_CARDS} of ${defs.length} layers — use the search box to narrow down the list.</div>` : ''}`
            }
          </div>`;
  }

  // Refresh only the results grid + the clear button, leaving the search input
  // (and its focus / caret position) untouched. Called on every search keystroke.
  private refreshResults(): void {
    const defs = this.filteredDefs();
    const wrap = this.overlay.querySelector('.dl-grid-wrap');
    if (wrap) {
      const tmp = document.createElement('div');
      tmp.innerHTML = this.gridWrapHtml(defs).trim();
      const fresh = tmp.firstElementChild;
      if (fresh) wrap.replaceWith(fresh);
    }

    // Sync view toggle button states
    this.overlay.querySelector('#dl-view-card')?.classList.toggle('active', this.gridMode === 'card');
    this.overlay.querySelector('#dl-view-list')?.classList.toggle('active', this.gridMode === 'list');

    // Keep the clear (✕) button in sync without touching the input element.
    const searchWrap = this.overlay.querySelector('.dl-search-wrap');
    if (searchWrap) {
      const existing = searchWrap.querySelector('#dl-search-clear');
      if (this.searchQuery && !existing) {
        const btn = document.createElement('button');
        btn.id = 'dl-search-clear';
        btn.className = 'dl-search-clear';
        btn.setAttribute('aria-label', 'Clear search');
        btn.textContent = '✕';
        btn.addEventListener('click', () => {
          this.searchQuery = '';
          const input = this.overlay.querySelector<HTMLInputElement>('#dl-search');
          if (input) input.value = '';
          this.refreshResults();
        });
        searchWrap.appendChild(btn);
      } else if (!this.searchQuery && existing) {
        existing.remove();
      }
    }

    this.wireCards();
  }

  private render(): void {
    try {
      this.renderInner();
    } catch (err) {
      console.error('[DataLibraryModal] render error:', err);
      this.overlay.innerHTML = `<div class="dl-modal" style="padding:32px;color:var(--color-text)">
        <p>The Data Library failed to load. Please close and try again.</p>
        <button onclick="this.closest('.dl-modal').parentElement.style.display='none'" style="margin-top:12px;padding:8px 16px;background:var(--color-accent);color:#fff;border:none;border-radius:6px;cursor:pointer">Close</button>
      </div>`;
    }
  }

  private renderInner(): void {
    const defs = this.filteredDefs();
    const groups = this.groups;

    this.overlay.innerHTML = `
      <div class="dl-modal">
        <div class="dl-sidebar">
          <div class="dl-sidebar-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
            <span>Data Library</span>
          </div>

          <nav class="dl-nav">
            <div class="dl-nav-section-label">Browse</div>
            <button class="dl-nav-item${this.activeView === 'library' && this.activeGroup === 'all' ? ' active' : ''}" data-group="all">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              All Sources
            </button>
            <button class="dl-nav-item${this.activeView === 'library' && this.activeGroup === 'basemaps' ? ' active' : ''}" data-group="basemaps">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
              Standard Basemaps
            </button>
            <div class="dl-nav-section-label" style="margin-top:6px">Fraxinus Static Data</div>
            <button class="dl-nav-item${this.activeView === 'library' && this.activeGroup === SHARED_GROUP_ROOT ? ' active' : ''}" data-group="${SHARED_GROUP_ROOT}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              All Static Data
            </button>
            ${this.sharedSubfolders.map(folder => {
              const groupId = `${SHARED_GROUP_ROOT}: ${folder}`;
              return `<button class="dl-nav-item dl-nav-subfolder${this.activeView === 'library' && this.activeGroup === groupId ? ' active' : ''}" data-group="${esc(groupId)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                ${esc(folder)}
              </button>`;
            }).join('')}
            <div class="dl-nav-section-label" style="margin-top:6px">Field Data</div>
            <button class="dl-nav-item${this.activeView === 'library' && this.activeGroup === USER_DATA_GROUP ? ' active' : ''}" data-group="${USER_DATA_GROUP}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              User Data
            </button>
            <div class="dl-nav-section-label" style="margin-top:6px">Overlay Layers</div>
            ${groups.map(g => {
              const icon = g === 'Raster Functions'
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M12 3v18M3 12h18M4.22 4.22l15.56 15.56M19.78 4.22 4.22 19.78"/></svg>`
                : g === 'Elevation'
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 17 9 11 13 15 21 7"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
              return `
              <button class="dl-nav-item${this.activeView === 'library' && this.activeGroup === g ? ' active' : ''}" data-group="${g}">
                ${icon}
                ${g}
              </button>`;
            }).join('')}
            <div class="dl-nav-sep"></div>
            <button class="dl-nav-item dl-nav-io${this.activeView === 'import' ? ' active' : ''}" data-view="import">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Import Data
            </button>
            <button class="dl-nav-item dl-nav-io${this.activeView === 'export' ? ' active' : ''}" data-view="export">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="13" height="13"><path d="M74.34,85.66A8,8,0,0,1,85.66,74.34L120,108.69V24a8,8,0,0,1,16,0v84.69l34.34-34.35a8,8,0,0,1,11.32,11.32l-48,48a8,8,0,0,1-11.32,0ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H84.4a4,4,0,0,1,2.83,1.17L111,145A24,24,0,0,0,145,145l23.8-23.8A4,4,0,0,1,171.6,120H224A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Export Data
            </button>
          </nav>
        </div>

        <div class="dl-main">
          <div class="dl-main-header">
            ${this.activeView === 'library' && !this.configuringDefId ? `
            <div class="dl-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" class="dl-search-icon">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="dl-search" class="dl-search" placeholder="Search layers, descriptions…" value="${esc(this.searchQuery)}" autocomplete="off" />
              ${this.searchQuery ? '<button id="dl-search-clear" class="dl-search-clear" aria-label="Clear search">✕</button>' : ''}
            </div>
            <div class="dl-view-toggle" role="group" aria-label="View mode">
              <button class="dl-view-btn${this.gridMode === 'card' ? ' active' : ''}" id="dl-view-card" title="Card view" aria-pressed="${this.gridMode === 'card'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              </button>
              <button class="dl-view-btn${this.gridMode === 'list' ? ' active' : ''}" id="dl-view-list" title="List view" aria-pressed="${this.gridMode === 'list'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
            </div>` : this.activeView !== 'library' ? `
            <div class="dl-io-title">
              ${this.activeView === 'import' ? 'Import Data' : 'Export Data'}
            </div>` : `<div class="dl-io-title">Configure Parameters</div>`}
            <button class="dl-close-btn" id="dl-close" aria-label="Close library">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          ${this.activeView === 'library' ? (this.configuringDefId ? this.renderConfigurePanel() : this.gridWrapHtml(defs)) : `
          <div class="dl-io-wrap" id="dl-io-container"></div>`}
        </div>
      </div>
    `;

    this.wireEvents();
  }

  private renderConfigurePanel(): string {
    const def = this.allDefs.find(d => d.id === this.configuringDefId);
    if (!def) return '';
    const schema = RF_PARAM_SCHEMAS[def.id];
    if (!schema) return '';
    const displayLabel = LABEL_OVERRIDES[def.id] ?? def.label;

    const rowHtml = schema.map(p => {
      const hiddenAttr = p.showWhen ? ' style="display:none"' : '';
      const showWhenAttr = p.showWhen ? ` data-show-when="${p.showWhen.param}:${p.showWhen.value}"` : '';
      const ctrl = p.type === 'select'
        ? `<select id="dlp-${p.id}" class="dl-param-select dl-param-ctrl-el">
            ${(p.options ?? []).map(o => `<option value="${o.value}"${o.value === String(p.default) ? ' selected' : ''}>${o.label}</option>`).join('')}
          </select>`
        : `<div style="display:flex;align-items:center;gap:4px">
            <input type="number" id="dlp-${p.id}" class="dl-param-number dl-param-ctrl-el" value="${p.default}"
              min="${p.min ?? ''}" max="${p.max ?? ''}" step="${p.step ?? 1}">
            ${p.unit ? `<span class="dl-param-unit">${p.unit}</span>` : ''}
          </div>`;
      return `<div class="dl-param-row" id="dlpr-${p.id}"${showWhenAttr}${hiddenAttr}>
        <label class="dl-param-label" for="dlp-${p.id}">${p.label}</label>
        <div class="dl-param-ctrl">${ctrl}</div>
      </div>`;
    }).join('');

    return `
      <div class="dl-config-panel">
        <div class="dl-config-header">
          <button class="dl-config-back" id="dl-config-cancel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
            Back to Library
          </button>
        </div>
        <div class="dl-config-layer-name">${displayLabel}</div>
        <p class="dl-config-subtitle">Adjust parameters before adding this layer to the map.</p>
        <div class="dl-config-form">${rowHtml}</div>
        <button class="dl-config-add-btn" id="dl-config-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add to Map
        </button>
      </div>`;
  }

  // Wire flip + add buttons on the result cards (re-runnable after refreshResults)
  private wireCards(): void {
    // Flip card thumbnails
    this.overlay.querySelectorAll<HTMLElement>('.dl-card-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        thumb.classList.toggle('dl-flipped');
      });
    });

    // Add to map (button only — card click no longer triggers add)
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-card-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const defId = btn.dataset.defId!;
        const def = this.allDefs.find(d => d.id === defId);
        if (!def) return;
        const hasParams = def.group === 'Raster Functions' && defId in RF_PARAM_SCHEMAS;
        // For configurable raster functions, always open the configure panel (even if already in stack)
        if (hasParams) {
          this.configuringDefId = defId;
          this.render();
          return;
        }
        if (this.callbacks.isInStack(defId)) return;
        this.callbacks.onAddToMap(def);
        this.refreshResults();
      });
    });

    // List-view add buttons
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-list-add:not(.dl-list-added)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const defId = btn.dataset.defId!;
        const def = this.allDefs.find(d => d.id === defId);
        if (!def) return;
        const hasParams = def.group === 'Raster Functions' && defId in RF_PARAM_SCHEMAS;
        if (hasParams) { this.configuringDefId = defId; this.render(); return; }
        if (this.callbacks.isInStack(defId)) return;
        this.callbacks.onAddToMap(def);
        this.refreshResults();
      });
    });

    // Shared-library: delete a layer (org-wide)
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-card-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const sid = btn.dataset.sharedId;
        if (!sid) return;
        if (!confirm('Delete this layer from the shared library for everyone?')) return;
        await this.callbacks.onDeleteShared(sid);
        this.refreshResults();
      });
    });

    // Shared-library: toggle the upload form
    this.overlay.querySelector('#dl-shared-upload-toggle')?.addEventListener('click', () => {
      this.uploadOpen = !this.uploadOpen;
      this.refreshResults();
    });

    // Shared-library: submit an upload
    this.overlay.querySelector('#dl-up-submit')?.addEventListener('click', async () => {
      const nameEl = this.overlay.querySelector<HTMLInputElement>('#dl-up-name');
      const folderEl = this.overlay.querySelector<HTMLInputElement>('#dl-up-folder');
      const fileEl = this.overlay.querySelector<HTMLInputElement>('#dl-up-file');
      const file = fileEl?.files?.[0];
      if (!file) { EventBus.emit('toast', { message: 'Choose a file to upload', type: 'info' }); return; }
      const name = (nameEl?.value.trim() || file.name.replace(/\.[^.]+$/, ''));
      const folder = folderEl?.value.trim() ?? '';
      this.uploading = true;
      this.refreshResults();
      try {
        await this.callbacks.onUploadShared({ name, folder, file });
        this.uploadOpen = false;
      } catch (err) {
        EventBus.emit('toast', { message: `Upload failed: ${(err as Error).message}`, type: 'error' });
      } finally {
        this.uploading = false;
        this.refreshResults();
      }
    });
  }

  private wireEvents(): void {
    // Close
    this.overlay.querySelector('#dl-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Search — refresh only the results grid so the input keeps focus while typing
    const searchEl = this.overlay.querySelector<HTMLInputElement>('#dl-search');
    searchEl?.addEventListener('input', () => {
      this.searchQuery = searchEl.value;
      this.refreshResults();
    });
    this.overlay.querySelector('#dl-search-clear')?.addEventListener('click', () => {
      this.searchQuery = '';
      if (searchEl) searchEl.value = '';
      this.refreshResults();
    });

    // View mode toggle (card / list)
    this.overlay.querySelector('#dl-view-card')?.addEventListener('click', () => {
      this.gridMode = 'card';
      this.refreshResults();
    });
    this.overlay.querySelector('#dl-view-list')?.addEventListener('click', () => {
      this.gridMode = 'list';
      this.refreshResults();
    });

    // Group nav (library layers)
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-nav-item[data-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeView = 'library';
        this.configuringDefId = null;
        this.activeGroup = btn.dataset.group ?? 'all';
        this.render();
      });
    });

    // View nav (import / export)
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeView = btn.dataset.view as 'import' | 'export';
        this.configuringDefId = null;
        this.render();
      });
    });

    // If already on import/export view (e.g. re-render), inject content
    if (this.activeView !== 'library') {
      const container = this.overlay.querySelector<HTMLElement>('#dl-io-container');
      if (container) {
        if (this.activeView === 'import') this.callbacks.onRenderImport(container);
        else this.callbacks.onRenderExport(container);
      }
    }

    this.wireCards();

    // Configure panel — back button
    this.overlay.querySelector('#dl-config-cancel')?.addEventListener('click', () => {
      this.configuringDefId = null;
      this.render();
    });

    // Configure panel — conditional row visibility
    const updateParamVisibility = () => {
      this.overlay.querySelectorAll<HTMLElement>('.dl-param-row[data-show-when]').forEach(row => {
        const raw = row.dataset.showWhen ?? '';
        const colonIdx = raw.indexOf(':');
        const paramId = raw.slice(0, colonIdx);
        const paramValue = raw.slice(colonIdx + 1);
        const ctrl = this.overlay.querySelector<HTMLSelectElement>(`#dlp-${paramId}`);
        row.style.display = (ctrl?.value === paramValue) ? '' : 'none';
      });
    };
    this.overlay.querySelectorAll<HTMLSelectElement>('.dl-param-select').forEach(sel => {
      sel.addEventListener('change', updateParamVisibility);
    });
    updateParamVisibility();

    // Configure panel — add button
    this.overlay.querySelector('#dl-config-add')?.addEventListener('click', () => {
      const def = this.allDefs.find(d => d.id === this.configuringDefId);
      if (!def) return;
      const schema = RF_PARAM_SCHEMAS[def.id];
      if (!schema) return;

      const params: Record<string, unknown> = {};
      schema.forEach(p => {
        const el = this.overlay.querySelector<HTMLInputElement | HTMLSelectElement>(`#dlp-${p.id}`);
        if (!el) return;
        params[p.id] = p.type === 'number' ? parseFloat((el as HTMLInputElement).value) : el.value;
      });

      this.callbacks.onAddToMapWithParams(def, params);
      this.configuringDefId = null;
      this.render();
      EventBus.emit('toast', { message: `Added: ${LABEL_OVERRIDES[def.id] ?? def.label}`, type: 'success', duration: 2000 });
    });
  }

}

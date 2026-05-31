import { BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import type { BasemapDef } from '../types';

// ── Per-layer PNG thumbnails (public/layer-thumbs/<id>.png) ──────────────────

const LAYER_THUMBS: Record<string, string> = {

  'esri-imagery': '/layer-thumbs/esri-imagery.png',
  'esri-hybrid': '/layer-thumbs/esri-hybrid.png',
  'osm': '/layer-thumbs/osm.png',
  'topo': '/layer-thumbs/topo.png',
  'default': '/layer-thumbs/default.png',
  'default-line': '/layer-thumbs/default-line.png',
  'default-polygon': '/layer-thumbs/default-polygon.png',
  'hrdem-dtm-hillshade': '/layer-thumbs/hrdem-dtm-hillshade.png',
  'hrdem-dsm-hillshade': '/layer-thumbs/hrdem-dsm-hillshade.png',
  'ns-plan-nsprd': '/layer-thumbs/ns-plan-nsprd.png',
  'ns-nshn-watercourses': '/layer-thumbs/ns-nshn-watercourses.png',
  'ns-nshn-waterbodies': '/layer-thumbs/ns-nshn-waterbodies.png',
  'ns-nshn-wetlands': '/layer-thumbs/ns-nshn-wetlands.png',
  'ns-base-contours': '/layer-thumbs/ns-base-contours.png',
  'ns-base-parks': '/layer-thumbs/ns-base-parks.png',
  'ns-base-designated': '/layer-thumbs/ns-base-designated.png',
  'ns-bio-habitat': '/layer-thumbs/ns-bio-habitat.png',
  'ns-bio-nsnrr-wetlands': '/layer-thumbs/ns-bio-nsnrr-wetlands.png',
  'ns-for-old-growth': '/layer-thumbs/ns-for-old-growth.png',
  'ns-for-fec-soil': '/layer-thumbs/ns-for-fec-soil.png',
  'ns-trns-roads': '/layer-thumbs/ns-trns-roads.png',
  'ns-crown-parcels': '/layer-thumbs/ns-crown-parcels.png',
  'hrdem-elevation': '/layer-thumbs/hrdem-elevation.png',
  'hrdem-slope': '/layer-thumbs/hrdem-slope.png',
  'hrdem-aspect': '/layer-thumbs/hrdem-aspect.png',
  'hrdem-tpi': '/layer-thumbs/hrdem-tpi.png',
  'hrdem-contours': '/layer-thumbs/hrdem-contours.png',
  'hrdem-dsm-elevation': '/layer-thumbs/hrdem-dsm-elevation.png',
  'hrdem-chm': '/layer-thumbs/hrdem-chm.png',
  'wi-dtw': '/layer-thumbs/wi-dtw.png',
  'wi-gei': '/layer-thumbs/wi-gei.png',
  'wi-dtw-contour': '/layer-thumbs/wi-dtw-contour.png',
  'wi-pdep': '/layer-thumbs/wi-pdep.png',
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
};

// ── Thumbnail resolution ──────────────────────────────────────────────────────

function getThumb(def: BasemapDef): { src: string; isTile: boolean } {
  if (def.id in LAYER_THUMBS) return { src: LAYER_THUMBS[def.id], isTile: false };
  // Fallback: any raster tile layer — grab a low-zoom tile
  if (def.type === 'raster' && def.url.includes('{z}') && !def.url.startsWith('cog://')) {
    const src = def.url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');
    return { src, isTile: true };
  }
  return { src: '/layer-thumbs/default.png', isTile: false };
}

function typeLabel(def: BasemapDef): string {
  if (def.url.startsWith('cog://')) return 'COG Raster';
  switch (def.type) {
    case 'raster':       return 'Raster';
    case 'nsprd-vector': return 'Vector';
    case 'nshn-vector':  return 'Vector';
    case 'hrdem-wcs':    return 'Elevation (WCS)';
    case 'cog-contour':  return 'COG Contour';
    default:             return def.type;
  }
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface DataLibraryCallbacks {
  onAddToMap: (def: BasemapDef) => void;
  onImport: () => void;
  onExport: () => void;
  isInStack: (defId: string) => boolean;
}

export class DataLibraryModal {
  private overlay: HTMLElement;
  private callbacks!: DataLibraryCallbacks;
  private searchQuery = '';
  private activeGroup = 'all';

  constructor() {
    this.overlay = document.getElementById('data-library-overlay')!;
  }

  open(callbacks: DataLibraryCallbacks): void {
    this.callbacks = callbacks;
    this.searchQuery = '';
    this.activeGroup = 'all';
    this.render();
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('dl-open'));
  }

  close(): void {
    this.overlay.classList.remove('dl-open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 250);
  }

  private get allDefs(): BasemapDef[] {
    return [...BASEMAPS, ...BASEMAP_OVERLAYS];
  }

  private get groups(): string[] {
    const seen = new Set<string>();
    BASEMAP_OVERLAYS.forEach(d => { if (d.group) seen.add(d.group); });
    return [...seen].sort();
  }

  private filteredDefs(): BasemapDef[] {
    let defs = this.allDefs;
    if (this.activeGroup !== 'all') {
      defs = this.activeGroup === 'basemaps'
        ? [...BASEMAPS]
        : BASEMAP_OVERLAYS.filter(d => d.group === this.activeGroup);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      defs = defs.filter(d =>
        (LABEL_OVERRIDES[d.id] ?? d.label).toLowerCase().includes(q) ||
        (d.group ?? '').toLowerCase().includes(q) ||
        d.attribution.toLowerCase().includes(q) ||
        (LAYER_DESCRIPTIONS[d.id] ?? '').toLowerCase().includes(q),
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
    const desc = LAYER_DESCRIPTIONS[def.id] ?? 'A geospatial data layer for use in field mapping projects.';
    const source = def.attribution;

    const thumbImg = isTile
      ? `<img src="${src}" loading="lazy" alt="${displayLabel}" onerror="this.closest('.dl-card-thumb').classList.add('dl-thumb-err')" />`
      : `<img src="${src}" alt="${displayLabel}" />`;

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
        <button class="dl-card-add${inStack ? ' dl-card-added' : ''}" data-def-id="${def.id}">
          ${inStack
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> Added`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Map`
          }
        </button>
      </div>`;
  }

  private render(): void {
    const defs = this.filteredDefs();
    const groups = this.groups;

    this.overlay.innerHTML = `
      <div class="dl-modal">
        <div class="dl-sidebar">
          <div class="dl-sidebar-header">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18">
              <path d="M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19.05L153.6,211.28a16,16,0,0,0,15.65,12.72,16.2,16.2,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM168.94,208,136,50.25l46.81-10.06h0L216,198Z"/>
              <path d="M115.86,26.47A16,16,0,0,0,96,13.17L49.19,23.23A16.09,16.09,0,0,0,37,42.45L70.14,200.25A16,16,0,0,0,85.79,212a16.25,16.25,0,0,0,3.38-.36L120,205.46a8,8,0,0,0-3.38-15.64L86,197.56,53.37,40.1,100.18,30l30,128a8,8,0,1,0,15.64-3.38Z"/>
            </svg>
            <span>Data Library</span>
          </div>

          <nav class="dl-nav">
            <button class="dl-nav-item${this.activeGroup === 'all' ? ' active' : ''}" data-group="all">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              All Sources
            </button>
            <button class="dl-nav-item${this.activeGroup === 'basemaps' ? ' active' : ''}" data-group="basemaps">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
              Standard Basemaps
            </button>
            ${groups.map(g => `
              <button class="dl-nav-item${this.activeGroup === g ? ' active' : ''}" data-group="${g}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                ${g}
              </button>`).join('')}
          </nav>

          <div class="dl-sidebar-actions">
            <button class="dl-action-btn" id="dl-import-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Import Data
            </button>
            <button class="dl-action-btn" id="dl-export-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M74.34,85.66A8,8,0,0,1,85.66,74.34L120,108.69V24a8,8,0,0,1,16,0v84.69l34.34-34.35a8,8,0,0,1,11.32,11.32l-48,48a8,8,0,0,1-11.32,0ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H84.4a4,4,0,0,1,2.83,1.17L111,145A24,24,0,0,0,145,145l23.8-23.8A4,4,0,0,1,171.6,120H224A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Export Data
            </button>
          </div>
        </div>

        <div class="dl-main">
          <div class="dl-main-header">
            <div class="dl-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" class="dl-search-icon">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="dl-search" class="dl-search" placeholder="Search layers, descriptions…" value="${this.searchQuery}" autocomplete="off" />
              ${this.searchQuery ? '<button id="dl-search-clear" class="dl-search-clear" aria-label="Clear search">✕</button>' : ''}
            </div>
            <button class="dl-close-btn" id="dl-close" aria-label="Close library">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="dl-grid-wrap">
            <div class="dl-grid-label">
              ${this.activeGroup === 'all' ? 'All Sources' : this.activeGroup === 'basemaps' ? 'Standard Basemaps' : this.activeGroup}
              <span class="dl-count">${defs.length} layer${defs.length !== 1 ? 's' : ''}</span>
              <span class="dl-flip-hint-global">tap preview to flip for details</span>
            </div>
            ${defs.length === 0
              ? `<div class="dl-empty">No layers match "<strong>${this.searchQuery}</strong>"</div>`
              : `<div class="dl-grid">${defs.map(d => this.renderCard(d)).join('')}</div>`
            }
          </div>
        </div>
      </div>
    `;

    this.wireEvents();
  }

  private wireEvents(): void {
    // Close
    this.overlay.querySelector('#dl-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Search
    const searchEl = this.overlay.querySelector<HTMLInputElement>('#dl-search');
    searchEl?.addEventListener('input', () => {
      this.searchQuery = searchEl.value;
      this.render();
    });
    this.overlay.querySelector('#dl-search-clear')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.render();
    });

    // Group nav
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeGroup = btn.dataset.group ?? 'all';
        this.render();
      });
    });

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
        if (this.callbacks.isInStack(defId)) return;
        const def = this.allDefs.find(d => d.id === defId);
        if (!def) return;
        this.callbacks.onAddToMap(def);
        this.render();
      });
    });

    // Import / Export
    this.overlay.querySelector('#dl-import-btn')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onImport();
    });
    this.overlay.querySelector('#dl-export-btn')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onExport();
    });
  }

}

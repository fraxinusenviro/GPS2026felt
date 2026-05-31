import { BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import type { BasemapDef } from '../types';

/** Generate a preview URL for a tile-based raster layer (eastern Canada area) */
const thumbUrl = (url: string): string =>
  url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');

/** Return true if the URL can produce a usable thumbnail tile */
const hasTileThumb = (def: BasemapDef): boolean => {
  if (def.type !== 'raster') return false;
  const u = def.url;
  return (u.includes('{z}') || u.includes('{x}')) && !u.startsWith('cog://');
};

/** Solid-colour SVG placeholder for vector / elevation / COG layers */
function placeholderSvg(color: string, icon: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${color}"/>${icon}</svg>`)}`;
}

const TYPE_THUMB: Record<string, string> = {
  'nsprd-vector':  placeholderSvg('#1a2820', '<text x="80" y="52" text-anchor="middle" font-size="28" fill="#cccccc" font-family="sans-serif">⬡</text>'),
  'nshn-vector':   placeholderSvg('#0d2030', '<text x="80" y="52" text-anchor="middle" font-size="28" fill="#4a90f0" font-family="sans-serif">〰</text>'),
  'hrdem-wcs':     placeholderSvg('#1a1208', '<text x="80" y="52" text-anchor="middle" font-size="26" fill="#c49a3a" font-family="sans-serif">▲</text>'),
  'cog-contour':   placeholderSvg('#0c1a18', '<text x="80" y="52" text-anchor="middle" font-size="22" fill="#50b090" font-family="sans-serif">≋</text>'),
};

function getGroupColor(group: string | undefined): string {
  switch (group) {
    case 'Elevation':      return '#8a6030';
    case 'Nova Scotia':    return '#2d6a4f';
    case 'Wetland Indices':return '#1a5070';
    default:               return '#2a3a4a';
  }
}

function getThumb(def: BasemapDef): { src: string; isTile: boolean } {
  if (hasTileThumb(def)) return { src: thumbUrl(def.url), isTile: true };
  if (def.type in TYPE_THUMB) return { src: TYPE_THUMB[def.type], isTile: false };
  // COG raster with cog:// prefix
  const color = getGroupColor(def.group);
  return { src: placeholderSvg(color, '<text x="80" y="52" text-anchor="middle" font-size="22" fill="rgba(255,255,255,0.4)" font-family="sans-serif">⬜</text>'), isTile: false };
}

function typeLabel(def: BasemapDef): string {
  switch (def.type) {
    case 'raster':       return def.url.startsWith('cog://') ? 'COG Raster' : 'Raster';
    case 'nsprd-vector': return 'Vector';
    case 'nshn-vector':  return 'Vector';
    case 'hrdem-wcs':    return 'Elevation';
    case 'cog-contour':  return 'COG Contour';
    default:             return def.type;
  }
}

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
      if (this.activeGroup === 'basemaps') {
        defs = BASEMAPS;
      } else {
        defs = BASEMAP_OVERLAYS.filter(d => d.group === this.activeGroup);
      }
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      defs = defs.filter(d =>
        d.label.toLowerCase().includes(q) ||
        (d.group ?? '').toLowerCase().includes(q) ||
        d.attribution.toLowerCase().includes(q),
      );
    }
    return defs;
  }

  private renderCard(def: BasemapDef): string {
    const inStack = this.callbacks.isInStack(def.id);
    const { src, isTile } = getThumb(def);
    const tl = typeLabel(def);
    const groupBadge = def.group
      ? `<span class="dl-card-group">${def.group}</span>`
      : `<span class="dl-card-group">Standard</span>`;

    return `
      <div class="dl-card${inStack ? ' dl-card-active' : ''}" data-def-id="${def.id}" title="${def.label}">
        <div class="dl-card-thumb">
          ${isTile
            ? `<img src="${src}" loading="lazy" alt="${def.label}" onerror="this.parentElement.classList.add('dl-thumb-error')" />`
            : `<img src="${src}" alt="${def.label}" />`
          }
          ${inStack ? '<div class="dl-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg></div>' : ''}
        </div>
        <div class="dl-card-body">
          <div class="dl-card-name">${def.label}</div>
          <div class="dl-card-meta">${groupBadge}<span class="dl-card-type">${tl}</span></div>
        </div>
        <button class="dl-card-add${inStack ? ' dl-card-added' : ''}" data-def-id="${def.id}" title="${inStack ? 'Already on map' : 'Add to map'}">
          ${inStack
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Added'
            : '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2.5"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.5" fill="none"/></svg> Add'
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              All Sources
            </button>
            <button class="dl-nav-item${this.activeGroup === 'basemaps' ? ' active' : ''}" data-group="basemaps">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
              Standard Basemaps
            </button>
            ${groups.map(g => `
              <button class="dl-nav-item${this.activeGroup === g ? ' active' : ''}" data-group="${g}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                ${g}
              </button>`).join('')}
          </nav>

          <div class="dl-sidebar-actions">
            <button class="dl-action-btn dl-import-btn" id="dl-import-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="15" height="15"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Import Data
            </button>
            <button class="dl-action-btn dl-export-btn" id="dl-export-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="15" height="15"><path d="M74.34,85.66A8,8,0,0,1,85.66,74.34L120,108.69V24a8,8,0,0,1,16,0v84.69l34.34-34.35a8,8,0,0,1,11.32,11.32l-48,48a8,8,0,0,1-11.32,0ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H84.4a4,4,0,0,1,2.83,1.17L111,145A24,24,0,0,0,145,145l23.8-23.8A4,4,0,0,1,171.6,120H224A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Export Data
            </button>
          </div>
        </div>

        <div class="dl-main">
          <div class="dl-main-header">
            <div class="dl-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="dl-search-icon">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="dl-search" class="dl-search" placeholder="Search library…" value="${this.searchQuery}" />
              ${this.searchQuery ? '<button id="dl-search-clear" class="dl-search-clear">✕</button>' : ''}
            </div>
            <button class="dl-close-btn" id="dl-close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="dl-grid-wrap">
            <div class="dl-grid-label">
              ${this.activeGroup === 'all' ? 'All Sources' : this.activeGroup === 'basemaps' ? 'Standard Basemaps' : this.activeGroup}
              <span class="dl-count">${defs.length} layer${defs.length !== 1 ? 's' : ''}</span>
            </div>
            ${defs.length === 0
              ? `<div class="dl-empty">No layers match your search.</div>`
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

    // Add to map
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-card-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const defId = btn.dataset.defId!;
        if (this.callbacks.isInStack(defId)) return;
        const def = [...BASEMAPS, ...BASEMAP_OVERLAYS].find(d => d.id === defId);
        if (!def) return;
        this.callbacks.onAddToMap(def);
        // Re-render to update added state
        this.render();
      });
    });

    // Card click = same as add
    this.overlay.querySelectorAll<HTMLElement>('.dl-card').forEach(card => {
      card.addEventListener('click', (e) => {
        const defId = card.dataset.defId!;
        if (this.callbacks.isInStack(defId)) return;
        if ((e.target as HTMLElement).closest('.dl-card-add')) return;
        const def = [...BASEMAPS, ...BASEMAP_OVERLAYS].find(d => d.id === defId);
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

import type { SymbologyState, SymbologyMethod, ClassifierName, GeoJSONFeatureCollection, GeoJSONGeometry } from '../types';
import {
  SEQ_RAMPS, QUAL_PALETTES, SINGLE_COLORS, OUTLINE_COLORS, LABEL_COLORS,
  sampleRamp, buildLegend, buildFullLayerSpec, detectFields, CLASSIFIERS,
} from '../lib/symbologyEngine';
import { ICON_PATHS, ICON_CATEGORIES } from './SymbolRenderer';
import { SymbologyPreviewMap } from './SymbologyPreviewMap';

export interface SymbologyOptions {
  title: string;
  geomType: 'point' | 'line' | 'polygon';
  features: { properties: Record<string, unknown> }[];
  /** Real geometry for the live preview map. When absent, the preview shows a placeholder. */
  previewFeatures?: { geometry: GeoJSONGeometry; properties: Record<string, unknown> }[];
  initialState?: SymbologyState;
  /** Label for the confirm button (default 'Apply'). E.g. 'Add to Map' for pre-add flows. */
  applyLabel?: string;
  onApply: (state: SymbologyState) => void;
}

const MAX_PREVIEW_FEATURES = 2000;

export class SymbologyStudio {
  private container: HTMLElement | null = null;
  private preview: SymbologyPreviewMap | null = null;
  private currentOptions: SymbologyOptions | null = null;

  open(options: SymbologyOptions): void {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    document.body.appendChild(overlay);
    this.container = overlay;
    this.currentOptions = options;
    this.mount(overlay, options);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  close(): void {
    this.preview?.destroy();
    this.preview = null;
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.currentOptions = null;
  }

  /** Build the working SymbologyState from defaults (+ optional persisted overrides). */
  private buildState(geomType: 'point' | 'line' | 'polygon', initialState?: SymbologyState): SymbologyState {
    return {
      method: initialState?.method ?? 'single',
      field: initialState?.field,
      palette: initialState?.palette ?? 'Bold',
      ramp: initialState?.ramp ?? 'Viridis',
      classes: initialState?.classes ?? 5,
      classifier: initialState?.classifier ?? 'Natural breaks',
      color: initialState?.color ?? SINGLE_COLORS[0],
      // Lines default to fully opaque; polygons get a translucent fill so basemap
      // shows through; points stay near-opaque.
      opacity: initialState?.opacity ?? (geomType === 'polygon' ? 0.65 : geomType === 'line' ? 1 : 0.9),
      size: initialState?.size ?? (geomType === 'point' ? 6 : geomType === 'line' ? 3 : 1.5),
      outlineColor: initialState?.outlineColor ?? '#0a0d12',
      outlineWidth: initialState?.outlineWidth ?? 1.5,
      cap: initialState?.cap ?? 'round',
      casing: initialState?.casing ?? false,
      casingColor: initialState?.casingColor ?? '#0a0d12',
      casingWidth: initialState?.casingWidth ?? 2,
      strokeColor: initialState?.strokeColor ?? '#ffffff',
      // strokeOpacity is only meaningful for polygon outlines. Force it undefined
      // for points/lines (ignoring any stale persisted value) so the map falls back
      // to the main opacity — a line at 100% opacity renders fully opaque, not the
      // old 0.4 leak that made every line translucent.
      strokeOpacity: geomType === 'polygon' ? (initialState?.strokeOpacity ?? 0.4) : undefined,
      legendLabels: initialState?.legendLabels ? { ...initialState.legendLabels } : {},
      label_field: initialState?.label_field ?? '',
      label_size: initialState?.label_size ?? 12,
      label_color: initialState?.label_color ?? '#f8fafc',
      icon: initialState?.icon,
      icon_color: initialState?.icon_color ?? '#ffffff',
      icon_size: initialState?.icon_size ?? 1,
      icon_rotation: initialState?.icon_rotation ?? 0,
    };
  }

  /**
   * Render the studio. `useDefaults` rebuilds from base defaults instead of the
   * caller's persisted state — used by the "Reset symbology" action.
   */
  private mount(overlay: HTMLElement, options: SymbologyOptions, useDefaults = false): void {
    const { title, geomType, features, initialState, onApply } = options;

    // A re-mount (reset) tears down the previous preview map first.
    this.preview?.destroy();
    this.preview = null;

    const fieldInfos = detectFields(features);
    const catFields = fieldInfos.filter(f => f.kind === 'categorical').map(f => f.name);
    const numFields = fieldInfos.filter(f => f.kind === 'numeric').map(f => f.name);
    const allFields = fieldInfos.map(f => f.name);

    const state = this.buildState(geomType, useDefaults ? undefined : initialState);

    // Set default field for initial method
    if (!state.field) {
      state.field = state.method === 'categorical' ? catFields[0] : numFields[0];
    }

    const geomLabel = geomType === 'point' ? 'Points' : geomType === 'line' ? 'Lines' : 'Polygons';
    const styleTitle = geomType === 'point' ? 'Point style' : geomType === 'line' ? 'Line style' : 'Polygon style';
    const legendCount = buildLegend(features, state).length;

    // ---- Left-column control groups (reused inside accordions) ----
    const sizeOpacityHtml = `
          <div class="ss-section">
            <div class="ss-lbl"><span id="ss-size-lbl">${this.sizeLabel(state.method, geomType)}</span> <span class="ss-val" id="ss-size-val">${+(state.size ?? 6)}px</span></div>
            <input type="range" id="ss-size" min="${geomType === 'polygon' ? 0 : geomType === 'line' ? 0.5 : 3}" max="${geomType === 'point' ? 16 : 8}" step="0.5" value="${state.size ?? 6}" />
          </div>
          <div class="ss-section">
            <div class="ss-lbl">${geomType === 'polygon' ? 'Fill opacity' : 'Opacity'} <span class="ss-val" id="ss-opacity-val">${Math.round((state.opacity ?? 0.9) * 100)}%</span></div>
            <input type="range" id="ss-opacity" min="0.05" max="1" step="0.05" value="${state.opacity ?? 0.9}" />
          </div>`;

    const pointStyleHtml = geomType === 'point' ? `
          <div class="ss-section">
            <div class="ss-lbl">Outline colour</div>
            <div class="ss-swatch-grid" id="ss-outline-swatches">
              ${this.swatchGrid(OUTLINE_COLORS, state.outlineColor, 'outline')}
            </div>
            <div class="ss-lbl" style="margin-top:8px">Outline width <span class="ss-val" id="ss-ow-val">${state.outlineWidth ?? 1.5}px</span></div>
            <input type="range" id="ss-ow" min="0" max="4" step="0.5" value="${state.outlineWidth ?? 1.5}" />
          </div>
          <div class="ss-section">
            <div class="ss-lbl">Icon overlay</div>
            <div class="ss-icon-grid" id="ss-icon-grid">
              <button class="ss-icon-btn${!state.icon ? ' on' : ''}" data-icon="" title="No icon">∅</button>
              ${ICON_CATEGORIES.flatMap(cat => cat.icons).filter(k => ICON_PATHS[k]).map(k => `
                <button class="ss-icon-btn${state.icon === k ? ' on' : ''}" data-icon="${k}" title="${k}">
                  <svg viewBox="0 0 256 256" width="16" height="16" fill="currentColor"><path d="${ICON_PATHS[k]}"/></svg>
                </button>`).join('')}
            </div>
            <div id="ss-icon-extra" class="${state.icon ? '' : 'ss-hidden'}">
              <div class="ss-lbl" style="margin-top:8px">Icon colour</div>
              <div class="ss-swatch-grid">
                ${this.swatchGrid(LABEL_COLORS, state.icon_color, 'icon-color')}
              </div>
              <div class="ss-lbl" style="margin-top:8px">Icon size <span class="ss-val" id="ss-isz-val">${(state.icon_size ?? 1).toFixed(1)}×</span></div>
              <input type="range" id="ss-icon-size" min="0.5" max="2.5" step="0.1" value="${state.icon_size ?? 1}" />
              <div class="ss-lbl" style="margin-top:8px">Icon rotation <span class="ss-val" id="ss-irot-val">${state.icon_rotation ?? 0}°</span></div>
              <input type="range" id="ss-icon-rot" min="0" max="360" step="5" value="${state.icon_rotation ?? 0}" />
            </div>
          </div>
          ` : '';

    const lineStyleHtml = geomType === 'line' ? `
          <div class="ss-section">
            <div class="ss-lbl">End cap</div>
            <div class="ss-seg">
              ${[['butt','Butt'],['round','Round'],['square','Square']].map(([v,t]) =>
                `<button class="ss-seg-btn${state.cap === v ? ' on' : ''}" data-cap="${v}">${t}</button>`
              ).join('')}
            </div>
          </div>
          <div class="ss-section">
            <div class="ss-lbl">Casing <span style="font-size:10px;opacity:.55">(border around line)</span></div>
            <div class="ss-seg">
              <button class="ss-seg-btn${!state.casing ? ' on' : ''}" data-casing="0">Off</button>
              <button class="ss-seg-btn${state.casing ? ' on' : ''}" data-casing="1">On</button>
            </div>
            <div id="ss-casing-extra" class="${state.casing ? '' : 'ss-hidden'}" style="margin-top:10px">
              <div class="ss-lbl">Casing colour</div>
              <div class="ss-swatch-grid">
                ${this.swatchGrid(OUTLINE_COLORS, state.casingColor, 'casing-color')}
              </div>
              <div class="ss-lbl" style="margin-top:8px">Casing width <span class="ss-val" id="ss-cw-val">${state.casingWidth ?? 2}px</span></div>
              <input type="range" id="ss-cw" min="0.5" max="5" step="0.5" value="${state.casingWidth ?? 2}" />
            </div>
          </div>
          ` : '';

    const polygonStyleHtml = geomType === 'polygon' ? `
          <div class="ss-section">
            <div class="ss-lbl">Stroke colour</div>
            <div class="ss-swatch-grid">
              ${this.swatchGrid(OUTLINE_COLORS, state.strokeColor, 'stroke')}
            </div>
            <div class="ss-lbl" style="margin-top:8px">Stroke opacity <span class="ss-val" id="ss-so-val">${Math.round((state.strokeOpacity ?? 0.4) * 100)}%</span></div>
            <input type="range" id="ss-so" min="0" max="1" step="0.05" value="${state.strokeOpacity ?? 0.4}" />
          </div>
          ` : '';

    const labelsHtml = `
          <div class="ss-section">
            <div class="ss-lbl">Label by field</div>
            <select id="ss-label-field" class="ss-select">
              <option value="">None</option>
              ${allFields.map(f => `<option value="${f}" ${f === state.label_field ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
            <div id="ss-label-extra" class="${state.label_field ? '' : 'ss-hidden'}">
              <div class="ss-lbl" style="margin-top:8px">Label size <span class="ss-val" id="ss-lsz-val">${state.label_size ?? 12}px</span></div>
              <input type="range" id="ss-label-size" min="8" max="22" step="1" value="${state.label_size ?? 12}" />
              <div class="ss-lbl" style="margin-top:8px">Label colour</div>
              <div class="ss-swatch-grid" id="ss-label-color-swatches">
                ${this.swatchGrid(LABEL_COLORS, state.label_color, 'label-color')}
              </div>
            </div>
          </div>`;

    overlay.innerHTML = `
      <div class="ss-panel">
        <div class="ss-header">
          <div class="ss-header-left">
            <span class="ss-title">${title || geomLabel} Symbology</span>
            <span class="ss-geom-badge">${geomLabel}</span>
          </div>
          <button class="ss-close" id="ss-close">✕</button>
        </div>
        <div class="ss-main">
          <div class="ss-body" id="ss-body">
            <!-- Method tabs -->
            <div class="ss-section">
              <div class="ss-lbl">Method</div>
              <div class="ss-seg" id="ss-method-seg">
                ${[
                  ['single', 'Single'],
                  ['categorical', 'Categories'],
                  ['graduated', 'Graduated'],
                  ...(geomType === 'point' ? [['proportional', 'Size by']] : []),
                ].map(([v, t]) =>
                  `<button class="ss-seg-btn${state.method === v ? ' on' : ''}" data-method="${v}">${t}</button>`
                ).join('')}
              </div>
            </div>

            <!-- Field selector -->
            <div class="ss-section${state.method === 'single' ? ' ss-hidden' : ''}" id="ss-field-section">
              <div class="ss-lbl">Classify by field</div>
              <select id="ss-field" class="ss-select">
                ${this.fieldOptions(state.method, catFields, numFields, state.field)}
              </select>
            </div>

            ${this.accordion('Colour & palette', `
              <div id="ss-color-section">${this.buildColorSection(state, features)}</div>
              <div id="ss-classifier-section" class="${state.method === 'graduated' ? '' : 'ss-hidden'}">${this.buildClassifierSection(state)}</div>
            `)}

            ${this.accordion(styleTitle, `${sizeOpacityHtml}${pointStyleHtml}${lineStyleHtml}${polygonStyleHtml}${labelsHtml}`)}

            ${this.accordion('Legend', `
              <div class="ss-lbl" style="font-size:10px;opacity:.55;margin-bottom:6px">click a label to rename</div>
              <div id="ss-legend">${this.buildLegendHtml(state, features, geomType)}</div>`,
              { collapsed: true, metaId: 'ss-legend-acc-meta', meta: `${legendCount} items` })}

            <!-- MapLibre expression output (collapsed by default) -->
            <div class="ss-section">
              <details class="ss-expr-details">
                <summary class="ss-lbl ss-expr-summary">MapLibre layer spec</summary>
                <div class="ss-expr-box">
                  <pre id="ss-expr-pre">${escapeHtml(JSON.stringify(buildFullLayerSpec(features, state, geomType), null, 2))}</pre>
                  <button class="ss-copy-btn" id="ss-copy">Copy</button>
                </div>
              </details>
            </div>
          </div><!-- /ss-body -->

          <div class="ss-col-right">
            <div class="ss-preview-head">
              <span class="ss-lbl">Preview</span>
              <a class="ss-link" id="ss-zoom-extent">Zoom to extent</a>
            </div>
            <div class="ss-preview-map" id="ss-preview-map"></div>
            <div class="ss-card">
              <div class="ss-card-title">Current symbology</div>
              <div id="ss-summary">${this.buildSummaryHtml(state, geomType)}</div>
            </div>
            <div class="ss-card">
              <div class="ss-card-title">Legend preview</div>
              <div id="ss-legend-preview">${this.buildLegendPreviewHtml(state, features, geomType)}</div>
            </div>
            <button class="btn-outline ss-reset-btn" id="ss-reset">↺ Reset symbology</button>
          </div>
        </div>
        <div class="ss-footer">
          <button class="btn-outline" id="ss-cancel">Cancel</button>
          <button class="btn-primary" id="ss-apply">${options.applyLabel ?? 'Apply'}</button>
        </div>
      </div>
    `;

    this.wire(overlay, state, geomType, features, catFields, numFields, onApply);
    this.mountPreview(overlay, options, state);
  }

  /** Reusable collapsible section wrapper for the left column. */
  private accordion(
    title: string,
    bodyHtml: string,
    opts?: { collapsed?: boolean; meta?: string; metaId?: string },
  ): string {
    const collapsed = opts?.collapsed ? ' collapsed' : '';
    const meta = opts?.meta !== undefined
      ? `<span class="ss-acc-meta"${opts.metaId ? ` id="${opts.metaId}"` : ''}>${opts.meta}</span>` : '';
    return `<div class="ss-acc${collapsed}">
      <button type="button" class="ss-acc-head" aria-expanded="${opts?.collapsed ? 'false' : 'true'}">
        <span class="ss-acc-title">${title}</span>
        ${meta}
        <svg class="ss-acc-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="ss-acc-body">${bodyHtml}</div>
    </div>`;
  }

  /** Create (or replace) the live preview map, or show a placeholder when no geometry. */
  private mountPreview(overlay: HTMLElement, options: SymbologyOptions, state: SymbologyState): void {
    const mapEl = overlay.querySelector<HTMLElement>('#ss-preview-map');
    if (!mapEl) return;
    const pf = options.previewFeatures;
    if (pf && pf.length) {
      const fc: GeoJSONFeatureCollection = {
        type: 'FeatureCollection',
        features: pf.slice(0, MAX_PREVIEW_FEATURES).map(f => ({ type: 'Feature', geometry: f.geometry, properties: f.properties })),
      };
      this.preview = new SymbologyPreviewMap();
      this.preview.mount(mapEl, fc);
      this.preview.restyle(state, options.features, options.geomType);
      // Container only gets its real size once the open transition settles.
      requestAnimationFrame(() => this.preview?.resize());
    } else {
      mapEl.classList.add('ss-preview-empty');
      mapEl.innerHTML = '<span>Live preview unavailable for this layer</span>';
      overlay.querySelector('#ss-zoom-extent')?.classList.add('ss-disabled');
    }
  }

  /** "Current symbology" summary rows on the right column. */
  private buildSummaryHtml(state: SymbologyState, geomType: 'point' | 'line' | 'polygon'): string {
    const methodNames: Record<SymbologyMethod, string> = {
      single: 'Single', categorical: 'Categories', graduated: 'Graduated', proportional: 'Size by',
    };
    const chip = (c?: string) => `<span class="ss-chip" style="background:${c ?? '#000'}"></span>${c ?? '—'}`;
    const rows: Array<[string, string]> = [['Method', methodNames[state.method]]];
    if (state.method !== 'single') rows.push(['Field', state.field || '—']);
    if (state.method === 'categorical') rows.push(['Palette', state.palette ?? '—']);
    if (state.method === 'graduated') rows.push(['Ramp', state.ramp ?? '—']);
    if (state.method === 'single' || state.method === 'proportional') rows.push(['Colour', chip(state.color)]);
    rows.push([this.sizeLabel(state.method, geomType), `${state.size ?? 6}px`]);
    rows.push([geomType === 'polygon' ? 'Fill opacity' : 'Opacity', `${Math.round((state.opacity ?? 0.9) * 100)}%`]);
    if (geomType === 'point') {
      rows.push(['Outline', chip(state.outlineColor)]);
      rows.push(['Outline width', `${state.outlineWidth ?? 1.5}px`]);
      rows.push(['Icon overlay', state.icon ?? 'None']);
    } else if (geomType === 'line') {
      rows.push(['End cap', state.cap ?? 'round']);
      rows.push(['Casing', state.casing ? `${state.casingWidth ?? 2}px` : 'Off']);
    } else {
      rows.push(['Stroke', chip(state.strokeColor)]);
      rows.push(['Stroke opacity', `${Math.round((state.strokeOpacity ?? 0.4) * 100)}%`]);
    }
    rows.push(['Label', state.label_field || 'None']);
    return rows.map(([k, v]) =>
      `<div class="ss-sum-row"><span class="ss-sum-k">${k}</span><span class="ss-sum-v">${v}</span></div>`).join('');
  }

  /** Static (read-only) legend chips for the right column. */
  private buildLegendPreviewHtml(
    state: SymbologyState,
    features: { properties: Record<string, unknown> }[],
    geomType: 'point' | 'line' | 'polygon',
  ): string {
    const legend = buildLegend(features, state);
    if (legend.length === 0) return '<span class="ss-no-data">No classifiable data</span>';
    return legend.map(l =>
      `<div class="ss-legpv-row"><span class="ss-chip${geomType === 'line' ? ' ss-chip-line' : ''}" style="background:${l.color}"></span><span class="ss-legpv-lbl">${escapeHtml(l.label)}</span></div>`
    ).join('');
  }

  // ---- Builders for dynamic sections ----

  // Swatch grid with a trailing custom colour-picker swatch.
  // `attr` is the data attribute used by the click wiring (e.g. 'color', 'outline').
  private swatchGrid(colors: string[], current: string | undefined, attr: string): string {
    const isCustom = !!current && !colors.includes(current);
    return `
      ${colors.map(c =>
        `<div class="ss-sw${c === current ? ' on' : ''}" data-${attr}="${c}" style="background:${c}" title="${c}"></div>`
      ).join('')}
      <label class="ss-sw ss-sw-custom${isCustom ? ' on' : ''}" title="Custom colour…"${isCustom ? ` style="background:${current}"` : ''}>
        <input type="color" class="ss-custom-color" data-custom-for="${attr}" value="${isCustom ? current : '#22aa77'}" />
      </label>`;
  }

  // Wires the custom colour input inside a swatch grid: picking a colour
  // deselects the preset swatches and routes the value through `setter`.
  private wireCustomColor(overlay: HTMLElement, attr: string, setter: (c: string) => void, rebuildDynamic: () => void): void {
    overlay.querySelectorAll<HTMLInputElement>(`input.ss-custom-color[data-custom-for="${attr}"]`).forEach(inp => {
      inp.addEventListener('input', () => {
        const label = inp.closest<HTMLElement>('.ss-sw-custom');
        const grid = label?.parentElement;
        grid?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
        if (label) { label.classList.add('on'); label.style.background = inp.value; }
        setter(inp.value);
        rebuildDynamic();
      });
      inp.addEventListener('click', e => e.stopPropagation());
    });
  }

  private buildColorSection(state: SymbologyState, features: { properties: Record<string, unknown> }[]): string {
    const m = state.method;

    if (m === 'single' || m === 'proportional') {
      return `<div class="ss-section">
        <div class="ss-lbl">Colour</div>
        <div class="ss-swatch-grid" id="ss-color-swatches">
          ${this.swatchGrid(SINGLE_COLORS, state.color, 'color')}
        </div>
      </div>`;
    }

    if (m === 'categorical') {
      // Sample sequential ramps to roughly the number of categories so the
      // preview reflects how categories will span the continuous ramp.
      const field = state.field ?? '';
      const catCount = field
        ? new Set(features.map(f => String((f.properties ?? {})[field] ?? ''))).size
        : 5;
      const sampleN = Math.max(2, Math.min(catCount || 5, 7));
      const row = (nm: string, cols: string[]) => `
        <div class="ss-ramp-item${nm === state.palette ? ' on' : ''}" data-palette="${nm}">
          <div class="ss-ramp-chips">${cols.map(c => `<span style="background:${c}"></span>`).join('')}</div>
          <span class="ss-ramp-nm">${nm}</span>
        </div>`;
      return `<div class="ss-section">
        <div class="ss-lbl">Qualitative palette</div>
        <div class="ss-ramp-rows" id="ss-palette-rows">
          ${Object.entries(QUAL_PALETTES).map(([nm, cols]) => row(nm, cols)).join('')}
        </div>
        <div class="ss-lbl" style="margin-top:10px">Continuous ramp</div>
        <div class="ss-ramp-rows" id="ss-palette-ramp-rows">
          ${Object.entries(SEQ_RAMPS).map(([nm, stops]) => row(nm, sampleRamp(stops, sampleN))).join('')}
        </div>
      </div>`;
    }

    // graduated
    const k = state.classes ?? 5;
    return `<div class="ss-section">
      <div class="ss-lbl">Colour ramp</div>
      <div class="ss-ramp-rows" id="ss-ramp-rows">
        ${Object.entries(SEQ_RAMPS).map(([nm, stops]) => {
          const cols = sampleRamp(stops, k);
          return `
            <div class="ss-ramp-item${nm === state.ramp ? ' on' : ''}" data-ramp="${nm}">
              <div class="ss-ramp-chips">${cols.map(c => `<span style="background:${c}"></span>`).join('')}</div>
              <span class="ss-ramp-nm">${nm}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>`;
  }

  private buildClassifierSection(state: SymbologyState): string {
    return `<div class="ss-two">
      <div>
        <div class="ss-lbl">Classifier</div>
        <select id="ss-classifier" class="ss-select">
          ${(Object.keys(CLASSIFIERS) as ClassifierName[]).map(c =>
            `<option value="${c}" ${c === state.classifier ? 'selected' : ''}>${c}</option>`
          ).join('')}
        </select>
      </div>
      <div>
        <div class="ss-lbl">Classes</div>
        <div class="ss-stepper">
          <button id="ss-cls-minus">−</button>
          <span id="ss-cls-num">${state.classes ?? 5}</span>
          <button id="ss-cls-plus">+</button>
        </div>
      </div>
    </div>`;
  }

  private buildLegendHtml(
    state: SymbologyState,
    features: { properties: Record<string, unknown> }[],
    geomType: 'point' | 'line' | 'polygon',
  ): string {
    const legend = buildLegend(features, state);
    if (legend.length === 0) {
      return '<span class="ss-no-data">No classifiable data — select a field and ensure features are loaded</span>';
    }
    return legend.map(l => {
      const isCustom = !!(state.legendLabels?.[l.key]);
      return `
      <div class="ss-legend-row${isCustom ? ' edited' : ''}">
        <span class="ss-legend-swatch${geomType === 'line' ? ' ss-legend-line' : ''}" style="background:${l.color}"></span>
        <input class="ss-legend-input" type="text"
          data-legend-key="${escapeAttr(l.key)}"
          value="${escapeAttr(l.label)}"
          placeholder="${escapeAttr(l.defaultLabel)}"
          title="Legend label (placeholder = original value)" />
        <button class="ss-legend-reset" data-legend-reset="${escapeAttr(l.key)}" title="Reset to original value">↺</button>
      </div>`;
    }).join('');
  }

  private fieldOptions(
    method: SymbologyMethod,
    catFields: string[],
    numFields: string[],
    current?: string,
  ): string {
    const fields = method === 'categorical' ? catFields : numFields;
    const kind = method === 'categorical' ? 'text' : 'numeric';
    if (fields.length === 0) return `<option value="">(no ${kind} fields detected)</option>`;
    return fields.map(f =>
      `<option value="${f}" ${f === current ? 'selected' : ''}>${f}</option>`
    ).join('');
  }

  private sizeLabel(method: SymbologyMethod, geomType: 'point' | 'line' | 'polygon'): string {
    if (method === 'proportional') return 'Max symbol size';
    if (geomType === 'point') return 'Point size';
    if (geomType === 'line') return 'Line width';
    return 'Outline width';
  }

  // ---- Wiring ----

  private wire(
    overlay: HTMLElement,
    state: SymbologyState,
    geomType: 'point' | 'line' | 'polygon',
    features: { properties: Record<string, unknown> }[],
    catFields: string[],
    numFields: string[],
    onApply: (s: SymbologyState) => void,
  ): void {
    // Close / cancel
    overlay.querySelector('#ss-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#ss-cancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });

    // Collapsible accordion sections (delegated so it survives section rebuilds).
    overlay.querySelector('#ss-body')?.addEventListener('click', e => {
      const head = (e.target as HTMLElement).closest<HTMLElement>('.ss-acc-head');
      if (!head) return;
      const acc = head.closest('.ss-acc');
      if (!acc) return;
      const collapsed = acc.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    });

    // Debounced live preview restyle (map paint is heavier than DOM text updates).
    let restyleTimer: number | undefined;
    const previewRestyle = () => {
      if (restyleTimer) clearTimeout(restyleTimer);
      restyleTimer = window.setTimeout(() => this.preview?.restyle(state, features, geomType), 70);
    };

    // Rebuild legend + expression + right-column cards, and restyle the preview.
    const rebuildDynamic = () => {
      const leg = overlay.querySelector('#ss-legend');
      if (leg) leg.innerHTML = this.buildLegendHtml(state, features, geomType);
      const pre = overlay.querySelector<HTMLElement>('#ss-expr-pre');
      if (pre) pre.textContent = JSON.stringify(buildFullLayerSpec(features, state, geomType), null, 2);
      const sum = overlay.querySelector('#ss-summary');
      if (sum) sum.innerHTML = this.buildSummaryHtml(state, geomType);
      const lpv = overlay.querySelector('#ss-legend-preview');
      if (lpv) lpv.innerHTML = this.buildLegendPreviewHtml(state, features, geomType);
      const legMeta = overlay.querySelector('#ss-legend-acc-meta');
      if (legMeta) legMeta.textContent = `${buildLegend(features, state).length} items`;
      previewRestyle();
    };

    // Reset symbology — re-render from base defaults (fresh DOM avoids stale closures).
    overlay.querySelector('#ss-reset')?.addEventListener('click', () => {
      if (this.container && this.currentOptions) this.mount(this.container, this.currentOptions, true);
    });

    // Zoom the preview to the layer's extent.
    overlay.querySelector('#ss-zoom-extent')?.addEventListener('click', () => this.preview?.zoomToExtent());

    // Rebuild the entire color section (after method change)
    const rebuildColorSection = () => {
      const cs = overlay.querySelector('#ss-color-section');
      if (cs) cs.innerHTML = this.buildColorSection(state, features);
      this.wireColorSection(overlay, state, features, geomType, rebuildDynamic);
      // Rebuild classifier section too (in case of class-count change)
      const clf = overlay.querySelector('#ss-classifier-section');
      if (clf) clf.innerHTML = this.buildClassifierSection(state);
      this.wireClassifierSection(overlay, state, features, geomType, rebuildDynamic);
      rebuildDynamic();
    };

    // Method tabs
    overlay.querySelectorAll<HTMLButtonElement>('[data-method]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMethod = btn.dataset.method as SymbologyMethod;
        if (newMethod === state.method) return;
        overlay.querySelectorAll('[data-method]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        state.method = newMethod;

        // Show/hide field section
        const fieldSec = overlay.querySelector<HTMLElement>('#ss-field-section');
        fieldSec?.classList.toggle('ss-hidden', state.method === 'single');

        // Update field dropdown for new method type
        const sel = overlay.querySelector<HTMLSelectElement>('#ss-field');
        if (sel && state.method !== 'single') {
          sel.innerHTML = this.fieldOptions(state.method, catFields, numFields, state.field);
          state.field = state.method === 'categorical' ? catFields[0] : numFields[0];
          if (sel.value) state.field = sel.value;
        }

        // Show/hide classifier section
        const clfSec = overlay.querySelector<HTMLElement>('#ss-classifier-section');
        clfSec?.classList.toggle('ss-hidden', state.method !== 'graduated');

        // Update size label
        const sizeLbl = overlay.querySelector<HTMLElement>('#ss-size-lbl');
        if (sizeLbl) sizeLbl.textContent = this.sizeLabel(state.method, geomType);

        rebuildColorSection();
      });
    });

    // Field dropdown
    overlay.querySelector<HTMLSelectElement>('#ss-field')?.addEventListener('change', e => {
      state.field = (e.target as HTMLSelectElement).value;
      rebuildDynamic();
    });

    // Wire color section (initial) and classifier
    this.wireColorSection(overlay, state, features, geomType, rebuildDynamic);
    this.wireClassifierSection(overlay, state, features, geomType, rebuildDynamic);

    // Size slider
    const sizeSlider = overlay.querySelector<HTMLInputElement>('#ss-size');
    const sizeVal = overlay.querySelector<HTMLElement>('#ss-size-val');
    sizeSlider?.addEventListener('input', () => {
      state.size = parseFloat(sizeSlider.value);
      if (sizeVal) sizeVal.textContent = `${state.size}px`;
      rebuildDynamic();
    });

    // Opacity
    const opSlider = overlay.querySelector<HTMLInputElement>('#ss-opacity');
    const opVal = overlay.querySelector<HTMLElement>('#ss-opacity-val');
    opSlider?.addEventListener('input', () => {
      state.opacity = parseFloat(opSlider.value);
      if (opVal) opVal.textContent = `${Math.round(state.opacity * 100)}%`;
      rebuildDynamic();
    });

    // Point: outline swatches + width
    if (geomType === 'point') {
      overlay.querySelectorAll<HTMLElement>('[data-outline]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          state.outlineColor = el.dataset.outline!;
          rebuildDynamic();
        });
      });
      this.wireCustomColor(overlay, 'outline', c => { state.outlineColor = c; }, rebuildDynamic);
      const owSlider = overlay.querySelector<HTMLInputElement>('#ss-ow');
      const owVal = overlay.querySelector<HTMLElement>('#ss-ow-val');
      owSlider?.addEventListener('input', () => {
        state.outlineWidth = parseFloat(owSlider.value);
        if (owVal) owVal.textContent = `${state.outlineWidth}px`;
        rebuildDynamic();
      });

      // Icon overlay
      overlay.querySelectorAll<HTMLButtonElement>('[data-icon]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-icon]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          state.icon = btn.dataset.icon || undefined;
          overlay.querySelector<HTMLElement>('#ss-icon-extra')?.classList.toggle('ss-hidden', !state.icon);
          rebuildDynamic();
        });
      });
      overlay.querySelectorAll<HTMLElement>('[data-icon-color]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          state.icon_color = el.dataset.iconColor!;
        });
      });
      this.wireCustomColor(overlay, 'icon-color', c => { state.icon_color = c; }, () => {});
      const iszSlider = overlay.querySelector<HTMLInputElement>('#ss-icon-size');
      const iszVal = overlay.querySelector<HTMLElement>('#ss-isz-val');
      iszSlider?.addEventListener('input', () => {
        state.icon_size = parseFloat(iszSlider.value);
        if (iszVal) iszVal.textContent = `${state.icon_size.toFixed(1)}×`;
      });
      const irotSlider = overlay.querySelector<HTMLInputElement>('#ss-icon-rot');
      const irotVal = overlay.querySelector<HTMLElement>('#ss-irot-val');
      irotSlider?.addEventListener('input', () => {
        state.icon_rotation = parseFloat(irotSlider.value);
        if (irotVal) irotVal.textContent = `${state.icon_rotation}°`;
      });
    }

    // Line: cap + casing
    if (geomType === 'line') {
      overlay.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-cap]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          state.cap = btn.dataset.cap as 'round' | 'butt' | 'square';
          rebuildDynamic();
        });
      });
      overlay.querySelectorAll<HTMLButtonElement>('[data-casing]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-casing]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          state.casing = btn.dataset.casing === '1';
          overlay.querySelector<HTMLElement>('#ss-casing-extra')?.classList.toggle('ss-hidden', !state.casing);
          rebuildDynamic();
        });
      });
      overlay.querySelectorAll<HTMLElement>('[data-casing-color]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          state.casingColor = el.dataset.casingColor!;
          rebuildDynamic();
        });
      });
      this.wireCustomColor(overlay, 'casing-color', c => { state.casingColor = c; }, rebuildDynamic);
      const cwSlider = overlay.querySelector<HTMLInputElement>('#ss-cw');
      const cwVal = overlay.querySelector<HTMLElement>('#ss-cw-val');
      cwSlider?.addEventListener('input', () => {
        state.casingWidth = parseFloat(cwSlider.value);
        if (cwVal) cwVal.textContent = `${state.casingWidth}px`;
        rebuildDynamic();
      });
    }

    // Polygon: stroke colour + opacity
    if (geomType === 'polygon') {
      overlay.querySelectorAll<HTMLElement>('[data-stroke]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          state.strokeColor = el.dataset.stroke!;
          rebuildDynamic();
        });
      });
      this.wireCustomColor(overlay, 'stroke', c => { state.strokeColor = c; }, rebuildDynamic);
      const soSlider = overlay.querySelector<HTMLInputElement>('#ss-so');
      const soVal = overlay.querySelector<HTMLElement>('#ss-so-val');
      soSlider?.addEventListener('input', () => {
        state.strokeOpacity = parseFloat(soSlider.value);
        if (soVal) soVal.textContent = `${Math.round(state.strokeOpacity * 100)}%`;
        rebuildDynamic();
      });
    }

    // Labels
    const labelSel = overlay.querySelector<HTMLSelectElement>('#ss-label-field');
    labelSel?.addEventListener('change', () => {
      state.label_field = labelSel.value || undefined;
      overlay.querySelector<HTMLElement>('#ss-label-extra')?.classList.toggle('ss-hidden', !state.label_field);
      rebuildDynamic();
    });
    const lszSlider = overlay.querySelector<HTMLInputElement>('#ss-label-size');
    const lszVal = overlay.querySelector<HTMLElement>('#ss-lsz-val');
    lszSlider?.addEventListener('input', () => {
      state.label_size = parseFloat(lszSlider.value);
      if (lszVal) lszVal.textContent = `${state.label_size}px`;
    });
    overlay.querySelectorAll<HTMLElement>('[data-label-color]').forEach(el => {
      el.addEventListener('click', () => {
        el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        state.label_color = el.dataset.labelColor!;
      });
    });
    this.wireCustomColor(overlay, 'label-color', c => { state.label_color = c; }, () => {});

    // Editable legend labels — delegated so listeners survive legend rebuilds.
    const legendEl = overlay.querySelector<HTMLElement>('#ss-legend');
    legendEl?.addEventListener('input', e => {
      const inp = (e.target as HTMLElement).closest<HTMLInputElement>('.ss-legend-input');
      if (!inp) return;
      const key = inp.dataset.legendKey;
      if (!key) return;
      state.legendLabels = state.legendLabels ?? {};
      const v = inp.value.trim();
      if (v && v !== (inp.placeholder ?? '')) state.legendLabels[key] = inp.value;
      else delete state.legendLabels[key];
      inp.closest('.ss-legend-row')?.classList.toggle('edited', !!state.legendLabels[key]);
    });
    legendEl?.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.ss-legend-reset');
      if (!btn) return;
      const key = btn.dataset.legendReset;
      if (!key || !state.legendLabels) return;
      delete state.legendLabels[key];
      legendEl.innerHTML = this.buildLegendHtml(state, features, geomType);
    });

    // Copy expression
    overlay.querySelector('#ss-copy')?.addEventListener('click', e => {
      const btn = e.currentTarget as HTMLButtonElement;
      const text = overlay.querySelector<HTMLElement>('#ss-expr-pre')?.textContent ?? '';
      const done = () => {
        btn.textContent = 'Copied!';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1400);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        done();
      }
    });

    // Apply
    overlay.querySelector('#ss-apply')?.addEventListener('click', () => {
      onApply({ ...state });
      this.close();
    });
  }

  // Wire color-picker section (single/categorical/graduated swatches/rows).
  // Called after initial mount and after re-rendering the color section.
  private wireColorSection(
    overlay: HTMLElement,
    state: SymbologyState,
    features: { properties: Record<string, unknown> }[],
    geomType: 'point' | 'line' | 'polygon',
    rebuildDynamic: () => void,
  ): void {
    // Single/proportional colour swatches
    overlay.querySelectorAll<HTMLElement>('[data-color]').forEach(el => {
      el.addEventListener('click', () => {
        el.parentElement?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        state.color = el.dataset.color!;
        rebuildDynamic();
      });
    });
    this.wireCustomColor(overlay, 'color', c => { state.color = c; }, rebuildDynamic);

    // Categorical palette rows
    overlay.querySelectorAll<HTMLElement>('[data-palette]').forEach(el => {
      el.addEventListener('click', () => {
        overlay.querySelectorAll('[data-palette]').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        state.palette = el.dataset.palette!;
        rebuildDynamic();
      });
    });

    // Graduated ramp rows
    overlay.querySelectorAll<HTMLElement>('[data-ramp]').forEach(el => {
      el.addEventListener('click', () => {
        overlay.querySelectorAll('[data-ramp]').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        state.ramp = el.dataset.ramp!;
        this.refreshRampChips(overlay, state);
        rebuildDynamic();
      });
    });
  }

  private wireClassifierSection(
    overlay: HTMLElement,
    state: SymbologyState,
    features: { properties: Record<string, unknown> }[],
    geomType: 'point' | 'line' | 'polygon',
    rebuildDynamic: () => void,
  ): void {
    overlay.querySelector<HTMLSelectElement>('#ss-classifier')?.addEventListener('change', e => {
      state.classifier = (e.target as HTMLSelectElement).value as ClassifierName;
      rebuildDynamic();
    });

    const numEl = overlay.querySelector<HTMLElement>('#ss-cls-num');
    const changeClasses = (delta: number) => {
      const next = (state.classes ?? 5) + delta;
      if (next < 3 || next > 7) return;
      state.classes = next;
      if (numEl) numEl.textContent = String(state.classes);
      this.refreshRampChips(overlay, state);
      rebuildDynamic();
    };
    overlay.querySelector('#ss-cls-minus')?.addEventListener('click', () => changeClasses(-1));
    overlay.querySelector('#ss-cls-plus')?.addEventListener('click', () => changeClasses(1));
  }

  // Refresh the colour chips inside each ramp row when class count or ramp changes.
  private refreshRampChips(overlay: HTMLElement, state: SymbologyState): void {
    const rampRows = overlay.querySelector('#ss-ramp-rows');
    if (!rampRows) return;
    rampRows.querySelectorAll<HTMLElement>('[data-ramp]').forEach(row => {
      const nm = row.dataset.ramp!;
      const stops = SEQ_RAMPS[nm] ?? SEQ_RAMPS.Viridis;
      const cols = sampleRamp(stops, state.classes ?? 5);
      const chips = row.querySelector('.ss-ramp-chips');
      if (chips) chips.innerHTML = cols.map(c => `<span style="background:${c}"></span>`).join('');
      row.classList.toggle('on', nm === state.ramp);
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

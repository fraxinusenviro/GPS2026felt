// Raster Symbology Studio — studio-style editor for raster layers (web tile
// sources, COG rasters, and HRDEM elevation products). Mirrors the vector
// Symbology Studio: a broad colour-ramp gallery, classification algorithms
// (natural breaks, quantiles, equal interval) and stretch options.

import type { RasterSymbologyState, ClassifierName, RasterStretchMode } from '../types';
import { RASTER_RAMPS, rampCssGradient, computeClassBreaks } from '../lib/rasterRamps';
import { equalIntervalClasses, breaksToClasses, classifiedRowsInlineHtml } from '../lib/rasterLegend';

export interface RasterSymbologyOptions {
  title: string;
  /** 'rgb' = plain tile/web source, 'cog' = COG raster, 'dem' = HRDEM product */
  kind: 'rgb' | 'cog' | 'dem';
  /** Include an "Original" entry that disables recolouring / restores the built-in colormap */
  hasOriginal?: boolean;
  /** CSS gradient preview for the "Original" entry */
  originalCss?: string;
  /** Offer the full DEM stretch-mode selector (elevation product) */
  demStretch?: boolean;
  /** Data-driven classifiers available (DEM products read the actual grid) */
  dataDriven?: boolean;
  /** Default custom stretch range (e.g. COG colormap range, current DEM range) */
  valueRange?: [number, number];
  /** Unit shown next to classified value ranges in the legend (e.g. 'm') */
  valueUnit?: string;
  /** Sampled pixel values — enables data-driven (Natural breaks / Quantile) class legend */
  dataValues?: number[];
  initial?: RasterSymbologyState;
  /** Label for the confirm button (default 'Apply'). E.g. 'Add to Map' for pre-add flows. */
  applyLabel?: string;
  onApply: (state: RasterSymbologyState) => void;
  /** Invoked when the studio is dismissed without applying (cancel / close / backdrop). */
  onCancel?: () => void;
}

const CLASSIFIER_NAMES: ClassifierName[] = ['Natural breaks', 'Quantile', 'Equal interval'];

export class RasterSymbologyStudio {
  private container: HTMLElement | null = null;

  open(options: RasterSymbologyOptions): void {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    document.body.appendChild(overlay);
    this.container = overlay;
    this.mount(overlay, options);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  close(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  private mount(overlay: HTMLElement, options: RasterSymbologyOptions): void {
    const { title, kind, onApply } = options;
    const hasOriginal = options.hasOriginal ?? (kind !== 'dem');
    const dataDriven = options.dataDriven ?? (kind === 'dem');
    const [hintMin, hintMax] = options.valueRange ?? (kind === 'rgb' ? [0, 255] : [0, 100]);

    const state: RasterSymbologyState = {
      rampId: options.initial?.rampId ?? (hasOriginal ? 'original' : 'viridis'),
      invert: options.initial?.invert ?? false,
      mode: options.initial?.mode ?? 'continuous',
      classifier: options.initial?.classifier ?? (dataDriven ? 'Natural breaks' : 'Equal interval'),
      classes: options.initial?.classes ?? 5,
      stretch: options.initial?.stretch ?? (kind === 'dem' ? 'percentile' : 'custom'),
      stretchMin: options.initial?.stretchMin ?? hintMin,
      stretchMax: options.initial?.stretchMax ?? hintMax,
    };

    const kindLabel = kind === 'rgb' ? 'Web Raster' : kind === 'cog' ? 'COG Raster' : 'Elevation';

    overlay.innerHTML = `
      <div class="ss-panel">
        <div class="ss-header">
          <div class="ss-header-left">
            <span class="ss-title">${escapeHtml(title)} Symbology</span>
            <span class="ss-geom-badge">${kindLabel}</span>
          </div>
          <button class="ss-close" id="rss-close">✕</button>
        </div>
        <div class="ss-body">

          <!-- Colour ramp gallery -->
          <div class="ss-section">
            <div class="ss-lbl">Colour ramp</div>
            <div class="ss-ramp-rows" id="rss-ramp-rows">
              ${hasOriginal ? `
                <div class="ss-ramp-item${state.rampId === 'original' ? ' on' : ''}" data-rss-ramp="original">
                  <div class="ss-ramp-chips"><span style="background:${options.originalCss ? 'none' : 'linear-gradient(to right,#555,#999)'};${options.originalCss ? `background-image:${options.originalCss}` : ''}"></span></div>
                  <span class="ss-ramp-nm">Original</span>
                </div>` : ''}
              ${Object.entries(RASTER_RAMPS).map(([k, def]) => `
                <div class="ss-ramp-item${state.rampId === k ? ' on' : ''}" data-rss-ramp="${k}">
                  <div class="ss-ramp-chips"><span style="background:${rampCssGradient(def.stops)}"></span></div>
                  <span class="ss-ramp-nm">${def.label}</span>
                </div>`).join('')}
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:8px;cursor:pointer">
              <input type="checkbox" id="rss-invert"${state.invert ? ' checked' : ''} /> Invert ramp
            </label>
          </div>

          <!-- Render mode + classification -->
          <div class="ss-section" id="rss-mode-section">
            <div class="ss-lbl">Render mode</div>
            <div class="ss-seg">
              <button class="ss-seg-btn${state.mode !== 'classified' ? ' on' : ''}" data-rss-mode="continuous">Continuous</button>
              <button class="ss-seg-btn${state.mode === 'classified' ? ' on' : ''}" data-rss-mode="classified">Classified</button>
            </div>
            <div id="rss-classify-opts" class="${state.mode === 'classified' ? '' : 'ss-hidden'}" style="margin-top:10px">
              <div class="ss-two">
                <div>
                  <div class="ss-lbl">Classifier</div>
                  ${dataDriven ? `
                  <select id="rss-classifier" class="ss-select">
                    ${CLASSIFIER_NAMES.map(c => `<option value="${c}"${c === state.classifier ? ' selected' : ''}>${c}</option>`).join('')}
                  </select>` : `
                  <div style="font-size:11px;opacity:.65;padding:6px 0">Equal interval<br><span style="font-size:9px;opacity:.7">(data-driven breaks need pixel access)</span></div>`}
                </div>
                <div>
                  <div class="ss-lbl">Classes</div>
                  <div class="ss-stepper">
                    <button id="rss-cls-minus">−</button>
                    <span id="rss-cls-num">${state.classes}</span>
                    <button id="rss-cls-plus">+</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Stretch -->
          <div class="ss-section" id="rss-stretch-section">
            <div class="ss-lbl">Stretch</div>
            ${options.demStretch ? `
            <div class="ss-seg" id="rss-stretch-seg" style="flex-wrap:wrap">
              ${([
                ['percentile', '2–98%'],
                ['minmax', 'Min–Max'],
                ['stddev1', '±1 SD'],
                ['stddev2', '±2 SD'],
                ['custom', 'Custom'],
              ] as [RasterStretchMode, string][]).map(([v, t]) =>
                `<button class="ss-seg-btn${state.stretch === v ? ' on' : ''}" data-rss-stretch="${v}">${t}</button>`
              ).join('')}
            </div>
            <div id="rss-custom-range" class="${state.stretch === 'custom' ? '' : 'ss-hidden'}" style="display:flex;gap:8px;margin-top:8px;align-items:center">
              <input type="number" id="rss-min" class="ss-select" style="flex:1" value="${state.stretchMin}" step="any" />
              <span style="font-size:11px;opacity:.6">to</span>
              <input type="number" id="rss-max" class="ss-select" style="flex:1" value="${state.stretchMax}" step="any" />
              <span style="font-size:11px;opacity:.6">m</span>
            </div>` : kind === 'cog' ? `
            <div style="display:flex;gap:8px;align-items:center">
              <input type="number" id="rss-min" class="ss-select" style="flex:1" value="${state.stretchMin}" step="any" title="Minimum value" />
              <span style="font-size:11px;opacity:.6">to</span>
              <input type="number" id="rss-max" class="ss-select" style="flex:1" value="${state.stretchMax}" step="any" title="Maximum value" />
            </div>
            <div style="font-size:9px;opacity:.5;margin-top:4px">Data values mapped across the ramp (native units)</div>` : `
            <div class="ss-lbl" style="margin-top:2px">Black point <span class="ss-val" id="rss-lo-val">${Math.round(state.stretchMin ?? 0)}</span></div>
            <input type="range" id="rss-lo" min="0" max="254" step="1" value="${Math.round(state.stretchMin ?? 0)}" />
            <div class="ss-lbl" style="margin-top:8px">White point <span class="ss-val" id="rss-hi-val">${Math.round(state.stretchMax ?? 255)}</span></div>
            <input type="range" id="rss-hi" min="1" max="255" step="1" value="${Math.round(state.stretchMax ?? 255)}" />
            <div style="font-size:9px;opacity:.5;margin-top:4px">Applied to tile luminance before the colour ramp</div>`}
          </div>

          <!-- Preview -->
          <div class="ss-section">
            <div class="ss-lbl">Preview</div>
            <div id="rss-preview" style="height:14px;border-radius:4px;border:1px solid var(--color-border,#444)"></div>
          </div>

          <!-- Classified legend table -->
          <div class="ss-section" id="rss-legend-section" style="${state.mode === 'classified' ? '' : 'display:none'}">
            <div class="ss-lbl">Class legend</div>
            <div id="rss-legend"></div>
          </div>

        </div>
        <div class="ss-footer">
          <button class="btn-outline" id="rss-cancel">Cancel</button>
          <button class="btn-primary" id="rss-apply">${options.applyLabel ?? 'Apply'}</button>
        </div>
      </div>
    `;

    this.wire(overlay, state, options, onApply);
  }

  private updatePreview(overlay: HTMLElement, state: RasterSymbologyState, options: RasterSymbologyOptions): void {
    const el = overlay.querySelector<HTMLElement>('#rss-preview');
    if (!el) return;
    if (state.rampId === 'original') {
      el.style.background = '';
      el.style.backgroundImage = options.originalCss ?? 'linear-gradient(to right,#555,#999)';
      return;
    }
    const def = RASTER_RAMPS[state.rampId];
    if (!def) { el.style.background = ''; return; }
    if (state.mode === 'classified') {
      const k = Math.max(2, Math.min(12, state.classes ?? 5));
      const segs: string[] = [];
      for (let i = 0; i < k; i++) {
        const t = k > 1 ? i / (k - 1) : 0.5;
        const stops = def.stops;
        const pos = Math.max(0, Math.min(1, state.invert ? 1 - t : t)) * (stops.length - 1);
        const lo = Math.floor(pos), hi = Math.min(stops.length - 1, lo + 1), f = pos - lo;
        const c = [0, 1, 2].map(j => Math.round(stops[lo][j] + (stops[hi][j] - stops[lo][j]) * f));
        segs.push(`rgb(${c[0]},${c[1]},${c[2]}) ${(i / k) * 100}% ${((i + 1) / k) * 100}%`);
      }
      el.style.backgroundImage = `linear-gradient(to right,${segs.join(',')})`;
    } else {
      el.style.backgroundImage = rampCssGradient(def.stops, state.invert);
    }
  }

  // Classified value-range → colour table (shown only in classified mode)
  private updateLegend(overlay: HTMLElement, state: RasterSymbologyState, options: RasterSymbologyOptions): void {
    const section = overlay.querySelector<HTMLElement>('#rss-legend-section');
    const el = overlay.querySelector<HTMLElement>('#rss-legend');
    if (!section || !el) return;
    const isClassified = state.mode === 'classified' && state.rampId !== 'original';
    section.style.display = isClassified ? '' : 'none';
    if (!isClassified) { el.innerHTML = ''; return; }
    const def = RASTER_RAMPS[state.rampId];
    if (!def) { el.innerHTML = ''; return; }
    const [hintMin, hintMax] = options.valueRange ?? (options.kind === 'rgb' ? [0, 255] : [0, 100]);
    const min = state.stretchMin ?? hintMin;
    const max = state.stretchMax ?? hintMax;
    const decimals = options.kind === 'rgb' ? 0 : 1;
    const k = state.classes ?? 5;
    const invert = state.invert ?? false;
    const unit = options.valueUnit ?? '';
    const dataDriven = state.classifier && state.classifier !== 'Equal interval' && (options.dataValues?.length ?? 0) >= 50;
    const classes = dataDriven
      ? breaksToClasses(def.stops, invert, computeClassBreaks(options.dataValues!, k, state.classifier as ClassifierName), min, max, unit, decimals)
      : equalIntervalClasses(def.stops, invert, k, min, max, unit, decimals);
    el.innerHTML = classifiedRowsInlineHtml(classes);
  }

  // Grey out classification + stretch when "Original" is selected (no recolouring)
  private updateSectionStates(overlay: HTMLElement, state: RasterSymbologyState, options: RasterSymbologyOptions): void {
    const disabled = state.rampId === 'original' && options.kind !== 'dem';
    ['#rss-mode-section', '#rss-stretch-section'].forEach(sel => {
      const el = overlay.querySelector<HTMLElement>(sel);
      if (el) {
        el.style.opacity = disabled ? '0.4' : '';
        el.style.pointerEvents = disabled ? 'none' : '';
      }
    });
  }

  private wire(
    overlay: HTMLElement,
    state: RasterSymbologyState,
    options: RasterSymbologyOptions,
    onApply: (s: RasterSymbologyState) => void,
  ): void {
    // Dismiss without applying — notify the caller (e.g. to reopen the Data Library) then close.
    const cancel = () => { this.close(); options.onCancel?.(); };
    overlay.querySelector('#rss-close')?.addEventListener('click', () => cancel());
    overlay.querySelector('#rss-cancel')?.addEventListener('click', () => cancel());
    overlay.addEventListener('click', e => { if (e.target === overlay) cancel(); });

    const refresh = () => {
      this.updatePreview(overlay, state, options);
      this.updateSectionStates(overlay, state, options);
      this.updateLegend(overlay, state, options);
    };

    // Ramp rows
    overlay.querySelectorAll<HTMLElement>('[data-rss-ramp]').forEach(el => {
      el.addEventListener('click', () => {
        overlay.querySelectorAll('[data-rss-ramp]').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        state.rampId = el.dataset.rssRamp!;
        refresh();
      });
    });

    // Invert
    overlay.querySelector<HTMLInputElement>('#rss-invert')?.addEventListener('change', e => {
      state.invert = (e.target as HTMLInputElement).checked;
      refresh();
    });

    // Mode
    overlay.querySelectorAll<HTMLButtonElement>('[data-rss-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-rss-mode]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        state.mode = btn.dataset.rssMode as 'continuous' | 'classified';
        overlay.querySelector('#rss-classify-opts')?.classList.toggle('ss-hidden', state.mode !== 'classified');
        refresh();
      });
    });

    // Classifier
    overlay.querySelector<HTMLSelectElement>('#rss-classifier')?.addEventListener('change', e => {
      state.classifier = (e.target as HTMLSelectElement).value as ClassifierName;
      this.updateLegend(overlay, state, options);
    });

    // Classes stepper
    const numEl = overlay.querySelector<HTMLElement>('#rss-cls-num');
    const changeClasses = (delta: number) => {
      const next = (state.classes ?? 5) + delta;
      if (next < 3 || next > 9) return;
      state.classes = next;
      if (numEl) numEl.textContent = String(next);
      refresh();
    };
    overlay.querySelector('#rss-cls-minus')?.addEventListener('click', () => changeClasses(-1));
    overlay.querySelector('#rss-cls-plus')?.addEventListener('click', () => changeClasses(1));

    // DEM stretch modes
    overlay.querySelectorAll<HTMLButtonElement>('[data-rss-stretch]').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('[data-rss-stretch]').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        state.stretch = btn.dataset.rssStretch as RasterStretchMode;
        overlay.querySelector('#rss-custom-range')?.classList.toggle('ss-hidden', state.stretch !== 'custom');
      });
    });

    // Custom min/max inputs (DEM custom + COG range)
    overlay.querySelector<HTMLInputElement>('#rss-min')?.addEventListener('input', e => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (isFinite(v)) { state.stretchMin = v; this.updateLegend(overlay, state, options); }
    });
    overlay.querySelector<HTMLInputElement>('#rss-max')?.addEventListener('input', e => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (isFinite(v)) { state.stretchMax = v; this.updateLegend(overlay, state, options); }
    });

    // RGB luminance levels
    const loSlider = overlay.querySelector<HTMLInputElement>('#rss-lo');
    const hiSlider = overlay.querySelector<HTMLInputElement>('#rss-hi');
    loSlider?.addEventListener('input', () => {
      state.stretchMin = parseInt(loSlider.value);
      const lbl = overlay.querySelector('#rss-lo-val');
      if (lbl) lbl.textContent = loSlider.value;
      if (hiSlider && parseInt(hiSlider.value) <= state.stretchMin!) {
        hiSlider.value = String(state.stretchMin! + 1);
        state.stretchMax = state.stretchMin! + 1;
        const hl = overlay.querySelector('#rss-hi-val');
        if (hl) hl.textContent = hiSlider.value;
      }
    });
    hiSlider?.addEventListener('input', () => {
      state.stretchMax = parseInt(hiSlider.value);
      const lbl = overlay.querySelector('#rss-hi-val');
      if (lbl) lbl.textContent = hiSlider.value;
      if (loSlider && parseInt(loSlider.value) >= state.stretchMax!) {
        loSlider.value = String(state.stretchMax! - 1);
        state.stretchMin = state.stretchMax! - 1;
        const ll = overlay.querySelector('#rss-lo-val');
        if (ll) ll.textContent = loSlider.value;
      }
    });

    // Apply
    overlay.querySelector('#rss-apply')?.addEventListener('click', () => {
      onApply({ ...state });
      this.close();
    });

    this.updatePreview(overlay, state, options);
    this.updateSectionStates(overlay, state, options);
    this.updateLegend(overlay, state, options);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

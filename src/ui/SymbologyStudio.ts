import type { SymbologyState, SymbologyMethod, ClassifierName } from '../types';
import {
  SEQ_RAMPS, QUAL_PALETTES, SINGLE_COLORS, OUTLINE_COLORS,
  sampleRamp, buildLegend, buildFullLayerSpec, detectFields, CLASSIFIERS,
} from '../lib/symbologyEngine';

export interface SymbologyOptions {
  title: string;
  geomType: 'point' | 'line' | 'polygon';
  features: { properties: Record<string, unknown> }[];
  initialState?: SymbologyState;
  onApply: (state: SymbologyState) => void;
}

export class SymbologyStudio {
  private container: HTMLElement | null = null;

  open(options: SymbologyOptions): void {
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

  private mount(overlay: HTMLElement, options: SymbologyOptions): void {
    const { title, geomType, features, initialState, onApply } = options;

    const fieldInfos = detectFields(features);
    const catFields = fieldInfos.filter(f => f.kind === 'categorical').map(f => f.name);
    const numFields = fieldInfos.filter(f => f.kind === 'numeric').map(f => f.name);
    const allFields = fieldInfos.map(f => f.name);

    const defaultColor = SINGLE_COLORS[0];
    const state: SymbologyState = {
      method: initialState?.method ?? 'single',
      field: initialState?.field,
      palette: initialState?.palette ?? 'Bold',
      ramp: initialState?.ramp ?? 'Viridis',
      classes: initialState?.classes ?? 5,
      classifier: initialState?.classifier ?? 'Natural breaks',
      color: initialState?.color ?? defaultColor,
      opacity: initialState?.opacity ?? (geomType === 'polygon' ? 0.65 : 0.9),
      size: initialState?.size ?? (geomType === 'point' ? 6 : geomType === 'line' ? 3 : 1.5),
      outlineColor: initialState?.outlineColor ?? '#0a0d12',
      outlineWidth: initialState?.outlineWidth ?? 1.5,
      cap: initialState?.cap ?? 'round',
      casing: initialState?.casing ?? false,
      casingColor: initialState?.casingColor ?? '#0a0d12',
      casingWidth: initialState?.casingWidth ?? 2,
      strokeColor: initialState?.strokeColor ?? '#ffffff',
      strokeOpacity: initialState?.strokeOpacity ?? 0.4,
      label_field: initialState?.label_field ?? '',
      label_size: initialState?.label_size ?? 12,
      label_color: initialState?.label_color ?? '#f8fafc',
      icon: initialState?.icon,
      icon_color: initialState?.icon_color ?? '#ffffff',
      icon_size: initialState?.icon_size ?? 1,
      icon_rotation: initialState?.icon_rotation ?? 0,
    };

    // Set default field for initial method
    if (!state.field) {
      state.field = state.method === 'categorical' ? catFields[0] : numFields[0];
    }

    const geomLabel = geomType === 'point' ? 'Points' : geomType === 'line' ? 'Lines' : 'Polygons';

    overlay.innerHTML = `
      <div class="ss-panel">
        <div class="ss-header">
          <div class="ss-header-left">
            <span class="ss-title">${title || geomLabel} Symbology</span>
            <span class="ss-geom-badge">${geomLabel}</span>
          </div>
          <button class="ss-close" id="ss-close">✕</button>
        </div>
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

          <!-- Color / palette / ramp section (rebuilt on method change) -->
          <div id="ss-color-section">
            ${this.buildColorSection(state, features)}
          </div>

          <!-- Classifier + classes (graduated only) -->
          <div id="ss-classifier-section" class="${state.method === 'graduated' ? '' : 'ss-hidden'}">
            ${this.buildClassifierSection(state)}
          </div>

          <!-- Size -->
          <div class="ss-section">
            <div class="ss-lbl">${this.sizeLabel(state.method, geomType)} <span class="ss-val" id="ss-size-val">${+(state.size ?? 6)}px</span></div>
            <input type="range" id="ss-size" min="${geomType === 'polygon' ? 0 : geomType === 'line' ? 0.5 : 3}" max="${geomType === 'point' ? 16 : 8}" step="0.5" value="${state.size ?? 6}" />
          </div>

          <!-- Opacity -->
          <div class="ss-section">
            <div class="ss-lbl">${geomType === 'polygon' ? 'Fill opacity' : 'Opacity'} <span class="ss-val" id="ss-opacity-val">${Math.round((state.opacity ?? 0.9) * 100)}%</span></div>
            <input type="range" id="ss-opacity" min="0.05" max="1" step="0.05" value="${state.opacity ?? 0.9}" />
          </div>

          <!-- Point: outline colour + width -->
          ${geomType === 'point' ? `
          <div class="ss-section">
            <div class="ss-lbl">Outline colour</div>
            <div class="ss-swatch-grid" id="ss-outline-swatches">
              ${this.swatchGrid(OUTLINE_COLORS, state.outlineColor, 'outline')}
            </div>
            <div class="ss-lbl" style="margin-top:8px">Outline width <span class="ss-val" id="ss-ow-val">${state.outlineWidth ?? 1.5}px</span></div>
            <input type="range" id="ss-ow" min="0" max="4" step="0.5" value="${state.outlineWidth ?? 1.5}" />
          </div>
          ` : ''}

          <!-- Line: end cap + casing -->
          ${geomType === 'line' ? `
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
          ` : ''}

          <!-- Polygon: stroke colour + opacity -->
          ${geomType === 'polygon' ? `
          <div class="ss-section">
            <div class="ss-lbl">Stroke colour</div>
            <div class="ss-swatch-grid">
              ${this.swatchGrid(OUTLINE_COLORS, state.strokeColor, 'stroke')}
            </div>
            <div class="ss-lbl" style="margin-top:8px">Stroke opacity <span class="ss-val" id="ss-so-val">${Math.round((state.strokeOpacity ?? 0.4) * 100)}%</span></div>
            <input type="range" id="ss-so" min="0" max="1" step="0.05" value="${state.strokeOpacity ?? 0.4}" />
          </div>
          ` : ''}

          <!-- Labels (any attribute) -->
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
                ${this.swatchGrid(['#f8fafc', '#0a0d12', '#ffd166', '#ef476f', '#06d6a0', '#118ab2'], state.label_color, 'label-color')}
              </div>
            </div>
          </div>

          <!-- Legend -->
          <div class="ss-section">
            <div class="ss-lbl">Legend</div>
            <div id="ss-legend">${this.buildLegendHtml(state, features, geomType)}</div>
          </div>

          <!-- MapLibre expression output -->
          <div class="ss-section">
            <div class="ss-lbl">MapLibre layer spec</div>
            <div class="ss-expr-box">
              <pre id="ss-expr-pre">${escapeHtml(JSON.stringify(buildFullLayerSpec(features, state, geomType), null, 2))}</pre>
              <button class="ss-copy-btn" id="ss-copy">Copy</button>
            </div>
          </div>

        </div><!-- /ss-body -->
        <div class="ss-footer">
          <button class="btn-outline" id="ss-cancel">Cancel</button>
          <button class="btn-primary" id="ss-apply">Apply</button>
        </div>
      </div>
    `;

    this.wire(overlay, state, geomType, features, catFields, numFields, onApply);
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
    return legend.map(l => `
      <div class="ss-legend-row">
        <span class="ss-legend-swatch${geomType === 'line' ? ' ss-legend-line' : ''}" style="background:${l.color}"></span>
        <span class="ss-legend-label">${escapeHtml(l.label)}</span>
      </div>
    `).join('');
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

    // Rebuild just the legend + expression
    const rebuildDynamic = () => {
      const leg = overlay.querySelector('#ss-legend');
      if (leg) leg.innerHTML = this.buildLegendHtml(state, features, geomType);
      const pre = overlay.querySelector<HTMLElement>('#ss-expr-pre');
      if (pre) pre.textContent = JSON.stringify(buildFullLayerSpec(features, state, geomType), null, 2);
    };

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
        const sizeDiv = overlay.querySelector('.ss-lbl[for-size]');
        if (sizeDiv) sizeDiv.textContent = this.sizeLabel(state.method, geomType);

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

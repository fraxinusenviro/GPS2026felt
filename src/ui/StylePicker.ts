import type { TypePreset, PointShape, DashPattern } from '../types';
import { ICON_CATEGORIES, ICON_PATHS, renderSwatchDataUrl, renderLineSwatchDataUrl, renderPolygonSwatchDataUrl } from './SymbolRenderer';

type OnSave = (updated: TypePreset) => void;

const SHAPE_OPTIONS: Array<{ value: PointShape; label: string; svg: string }> = [
  {
    value: 'circle',
    label: 'Circle',
    svg: '<circle cx="12" cy="12" r="8" fill="currentColor"/>',
  },
  {
    value: 'square',
    label: 'Square',
    svg: '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>',
  },
  {
    value: 'diamond',
    label: 'Diamond',
    svg: '<polygon points="12,3 21,12 12,21 3,12" fill="currentColor"/>',
  },
  {
    value: 'triangle',
    label: 'Triangle',
    svg: '<polygon points="12,4 22,20 2,20" fill="currentColor"/>',
  },
];

const DASH_OPTIONS: Array<{ value: DashPattern; label: string }> = [
  { value: 'solid',  label: '———' },
  { value: 'dashed', label: '- - -' },
  { value: 'dotted', label: '· · ·' },
];

/** Render a slider row with a synced numeric input. */
function sliderRow(
  id: string,
  valId: string,
  min: number,
  max: number,
  step: number,
  value: number,
  unit: string,
  formatVal: (v: number) => string,
): string {
  return `
    <div class="sp-slider-row">
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" />
      <input type="number" class="sp-num-input" id="${id}-num"
        min="${min}" max="${max}" step="${step}" value="${value}" />
      <span class="sp-val" id="${valId}">${formatVal(value)}${unit === '%' ? '' : unit}</span>
    </div>`;
}

export class StylePicker {
  private container: HTMLElement | null = null;

  open(preset: TypePreset, onSave: OnSave): void {
    this.close();

    const overlay = document.createElement('div');
    overlay.className = 'style-picker-overlay';
    overlay.innerHTML = this.buildHTML(preset);
    document.body.appendChild(overlay);
    this.container = overlay;

    requestAnimationFrame(() => overlay.classList.add('open'));
    this.wire(overlay, preset, onSave);
  }

  close(): void {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  private buildHTML(preset: TypePreset): string {
    const isPoint   = preset.geometry_type === 'Point'      || preset.geometry_type === 'all';
    const isLine    = preset.geometry_type === 'LineString';
    const isPoly    = preset.geometry_type === 'Polygon';

    const shape       = preset.shape       ?? 'circle';
    const fillOpacity = preset.fill_opacity ?? (isPoly ? 0.35 : 1.0);
    const strokeColor = preset.stroke_color ?? (isPoint ? '#ffffff' : preset.color);
    const strokeWidth = preset.stroke_width ?? 2;
    const iconColor   = preset.icon_color   ?? '#ffffff';
    const iconScale   = preset.icon_size    ?? 1.0;
    const size        = preset.size         ?? 7;
    const dashPattern = preset.dash_pattern ?? 'solid';
    const strokeDash  = (preset as TypePreset & { stroke_dash?: string }).stroke_dash ?? 'solid';
    const rotation    = preset.rotation     ?? 0;
    const iconRot     = preset.icon_rotation ?? 0;

    // Quick color palette — earth/field tones
    const palette = [
      '#4ade80','#22c55e','#15803d','#052e16',
      '#facc15','#f97316','#ef4444','#dc2626',
      '#60a5fa','#3b82f6','#1d4ed8','#0c4a6e',
      '#c084fc','#a855f7','#ffffff','#94a3b8',
      '#78350f','#b45309','#d4d4aa','#000000',
    ];

    const paletteHtml = `
      <div class="sp-section">
        <div class="sp-section-title">Quick Colors</div>
        <div class="sp-palette" id="sp-palette">
          ${palette.map(c => `
            <button class="sp-palette-swatch" data-color="${c}"
              style="background:${c};border:2px solid ${c === preset.color ? '#fff' : 'transparent'}"
              title="${c}"></button>
          `).join('')}
        </div>
      </div>
    `;

    return `
      <div class="style-picker-panel">
        <div class="sp-header">
          <div class="sp-title">
            <input class="sp-label-input" id="sp-label-input" type="text" value="${preset.label}" maxlength="40" />
            <span class="sp-geom-badge">${preset.geometry_type}</span>
          </div>
          <button class="sp-close" id="sp-close">✕</button>
        </div>

        <div class="sp-preview-sticky">
          <div class="sp-preview-row">
            <div class="sp-preview-col">
              <div class="sp-preview-box">
                <canvas id="sp-preview-canvas" width="64" height="64"></canvas>
              </div>
              <div class="sp-preview-label">Preview</div>
            </div>
            <div class="sp-preview-col">
              <div class="sp-actual-size-box">
                <canvas id="sp-actual-canvas" width="32" height="32"></canvas>
              </div>
              <div class="sp-preview-label">Actual Size</div>
            </div>
          </div>
        </div>

        <div class="sp-body">

          ${paletteHtml}

          ${isPoint || preset.geometry_type === 'all' ? `
          <!-- Shape -->
          <div class="sp-section">
            <div class="sp-section-title">Shape</div>
            <div class="sp-shape-grid">
              ${SHAPE_OPTIONS.map(s => `
                <button class="sp-shape-btn ${s.value === shape ? 'active' : ''}"
                  data-shape="${s.value}" title="${s.label}">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="none">
                    ${s.svg}
                  </svg>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Size -->
          <div class="sp-section">
            <div class="sp-section-title">Size</div>
            ${sliderRow('sp-size', 'sp-size-val', 4, 20, 0.5, size, 'px', v => v.toString())}
          </div>

          <!-- Shape Rotation -->
          <div class="sp-section">
            <div class="sp-section-title">Rotation</div>
            ${sliderRow('sp-rotation', 'sp-rotation-val', 0, 360, 1, rotation, '°', v => `${v}`)}
          </div>
          ` : ''}

          <!-- Fill color + opacity -->
          ${isPoint || isPoly || preset.geometry_type === 'all' ? `
          <div class="sp-section">
            <div class="sp-section-title">Fill</div>
            <div class="sp-row">
              <label class="sp-color-label">
                <input type="color" id="sp-fill-color" value="${preset.color}" />
                <span>Color</span>
              </label>
              ${isPoly || preset.geometry_type === 'all' ? `
              <div class="sp-slider-group">
                <span class="sp-slider-label-txt">Opacity</span>
                ${sliderRow('sp-fill-opacity', 'sp-fill-opacity-val', 0, 1, 0.05, fillOpacity, '%', v => `${Math.round(v * 100)}%`)}
              </div>` : ''}
            </div>
          </div>
          ` : ''}

          <!-- Stroke -->
          <div class="sp-section">
            <div class="sp-section-title">Stroke</div>
            <div class="sp-row">
              <label class="sp-color-label">
                <input type="color" id="sp-stroke-color" value="${strokeColor}" />
                <span>Color</span>
              </label>
            </div>
            <div class="sp-slider-group">
              <span class="sp-slider-label-txt">Width</span>
              ${sliderRow('sp-stroke-width', 'sp-stroke-width-val', 0, 8, 0.5, strokeWidth, 'px', v => `${v}`)}
            </div>
            ${isPoly ? `
            <div style="margin-top:8px">
              <span class="sp-slider-label-txt">Border Style</span>
              <div class="sp-dash-group" style="margin-top:4px">
                ${DASH_OPTIONS.map(d => `
                  <button class="sp-dash-btn sp-stroke-dash-btn ${d.value === strokeDash ? 'active' : ''}"
                    data-dash="${d.value}">${d.label}</button>
                `).join('')}
              </div>
            </div>` : ''}
          </div>

          ${isLine ? `
          <!-- Line color (primary) -->
          <div class="sp-section">
            <div class="sp-section-title">Line Color</div>
            <div class="sp-row">
              <label class="sp-color-label">
                <input type="color" id="sp-fill-color" value="${preset.color}" />
                <span>Color</span>
              </label>
            </div>
          </div>

          <!-- Dash pattern -->
          <div class="sp-section">
            <div class="sp-section-title">Dash Pattern</div>
            <div class="sp-dash-group">
              ${DASH_OPTIONS.map(d => `
                <button class="sp-dash-btn ${d.value === dashPattern ? 'active' : ''}"
                  data-dash="${d.value}">${d.label}</button>
              `).join('')}
            </div>
          </div>
          ` : ''}

          ${isPoint || preset.geometry_type === 'all' ? `
          <!-- Icon overlay -->
          <div class="sp-section">
            <div class="sp-section-title">Icon Overlay <span class="sp-optional">(optional)</span></div>
            <div class="sp-icon-grid" id="sp-icon-grid">
              <button class="sp-icon-btn ${!preset.icon ? 'active' : ''}" data-icon="" title="None">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm37.66,130.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>
              </button>
              ${ICON_CATEGORIES.map(cat => `
                <div class="sp-icon-category-label">${cat.label}</div>
                ${cat.icons.filter(key => ICON_PATHS[key]).map(key => `
                  <button class="sp-icon-btn ${preset.icon === key ? 'active' : ''}" data-icon="${key}" title="${key}">
                    <svg viewBox="0 0 256 256" width="18" height="18" fill="currentColor">
                      <path d="${ICON_PATHS[key]}"/>
                    </svg>
                  </button>
                `).join('')}
              `).join('')}
            </div>
            <div class="sp-row" style="margin-top:8px">
              <label class="sp-color-label">
                <input type="color" id="sp-icon-color" value="${iconColor}" />
                <span>Icon Color</span>
              </label>
            </div>
            <div class="sp-slider-group" style="margin-top:6px">
              <span class="sp-slider-label-txt">Icon Size</span>
              ${sliderRow('sp-icon-size', 'sp-icon-size-val', 0.5, 2.0, 0.05, iconScale, '%', v => `${Math.round(v * 100)}%`)}
            </div>
            <div class="sp-slider-group" style="margin-top:6px">
              <span class="sp-slider-label-txt">Icon Rotation</span>
              ${sliderRow('sp-icon-rotation', 'sp-icon-rotation-val', 0, 360, 1, iconRot, '°', v => `${v}`)}
            </div>
          </div>
          ` : ''}
        </div>

        <div class="sp-footer">
          <button class="btn-outline" id="sp-cancel">Cancel</button>
          <button class="btn-primary" id="sp-save">Apply Style</button>
        </div>
      </div>
    `;
  }

  private wire(overlay: HTMLElement, preset: TypePreset, onSave: OnSave): void {
    // Close buttons
    overlay.querySelector('#sp-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#sp-cancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Live preview updater
    const updatePreview = () => {
      const tmpPreset = this.collectState(overlay, preset);
      const isLine = tmpPreset.geometry_type === 'LineString';
      const isPoly = tmpPreset.geometry_type === 'Polygon';
      const getUrl = (sz: number) =>
        isLine ? renderLineSwatchDataUrl(tmpPreset, sz)
        : isPoly ? renderPolygonSwatchDataUrl(tmpPreset, sz)
        : renderSwatchDataUrl(tmpPreset, sz);

      const canvas = overlay.querySelector<HTMLCanvasElement>('#sp-preview-canvas');
      if (canvas) {
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, 64, 64);
        const img = new Image();
        img.src = getUrl(64);
        img.onload = () => ctx.drawImage(img, 0, 0);
      }

      const actualCanvas = overlay.querySelector<HTMLCanvasElement>('#sp-actual-canvas');
      if (actualCanvas) {
        const sz = (isLine || isPoly) ? 64 : Math.max(12, Math.round((tmpPreset.size ?? 7) * 4));
        actualCanvas.width = actualCanvas.height = sz;
        actualCanvas.style.width = `${sz}px`;
        actualCanvas.style.height = `${sz}px`;
        const ctx2 = actualCanvas.getContext('2d')!;
        ctx2.clearRect(0, 0, sz, sz);
        const img2 = new Image();
        img2.src = getUrl(sz);
        img2.onload = () => ctx2.drawImage(img2, 0, 0);
      }
    };

    // Palette swatches → update fill color + active border
    overlay.querySelectorAll<HTMLButtonElement>('.sp-palette-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const color = swatch.dataset.color ?? '';
        const fillInput = overlay.querySelector<HTMLInputElement>('#sp-fill-color');
        if (fillInput) { fillInput.value = color; }
        overlay.querySelectorAll<HTMLButtonElement>('.sp-palette-swatch').forEach(s => {
          s.style.borderColor = s === swatch ? '#fff' : 'transparent';
        });
        updatePreview();
      });
    });

    // Shape buttons
    overlay.querySelectorAll<HTMLButtonElement>('.sp-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.sp-shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updatePreview();
      });
    });

    // Icon buttons
    overlay.querySelectorAll<HTMLButtonElement>('.sp-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.sp-icon-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updatePreview();
      });
    });

    // Line dash buttons (only those NOT in the polygon stroke group)
    overlay.querySelectorAll<HTMLButtonElement>('.sp-dash-btn:not(.sp-stroke-dash-btn)').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.sp-dash-btn:not(.sp-stroke-dash-btn)').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Polygon stroke dash buttons
    overlay.querySelectorAll<HTMLButtonElement>('.sp-stroke-dash-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.sp-stroke-dash-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Sync each range ↔ number input pair, update value display, trigger preview
    const sliderIds = [
      { range: 'sp-size',         num: 'sp-size-num',         valId: 'sp-size-val',         fmt: (v: number) => `${v}px` },
      { range: 'sp-rotation',     num: 'sp-rotation-num',     valId: 'sp-rotation-val',     fmt: (v: number) => `${v}°` },
      { range: 'sp-fill-opacity', num: 'sp-fill-opacity-num', valId: 'sp-fill-opacity-val', fmt: (v: number) => `${Math.round(v * 100)}%` },
      { range: 'sp-stroke-width', num: 'sp-stroke-width-num', valId: 'sp-stroke-width-val', fmt: (v: number) => `${v}px` },
      { range: 'sp-icon-size',    num: 'sp-icon-size-num',    valId: 'sp-icon-size-val',    fmt: (v: number) => `${Math.round(v * 100)}%` },
      { range: 'sp-icon-rotation',num: 'sp-icon-rotation-num',valId: 'sp-icon-rotation-val',fmt: (v: number) => `${v}°` },
    ];

    for (const { range, num, valId, fmt } of sliderIds) {
      const rangeEl = overlay.querySelector<HTMLInputElement>(`#${range}`);
      const numEl   = overlay.querySelector<HTMLInputElement>(`#${num}`);
      const valEl   = overlay.querySelector<HTMLElement>(`#${valId}`);
      if (!rangeEl) continue;

      rangeEl.addEventListener('input', () => {
        const v = parseFloat(rangeEl.value);
        if (numEl) numEl.value = String(v);
        if (valEl) valEl.textContent = fmt(v);
        updatePreview();
      });

      numEl?.addEventListener('input', () => {
        const v = parseFloat(numEl.value);
        if (!isNaN(v)) {
          const clamped = Math.max(parseFloat(rangeEl.min), Math.min(parseFloat(rangeEl.max), v));
          rangeEl.value = String(clamped);
          if (valEl) valEl.textContent = fmt(clamped);
          updatePreview();
        }
      });
    }

    // Color inputs → live preview
    ['sp-fill-color', 'sp-stroke-color', 'sp-icon-color'].forEach(id => {
      overlay.querySelector(`#${id}`)?.addEventListener('input', updatePreview);
    });

    // Initial preview
    updatePreview();

    // Save
    overlay.querySelector('#sp-save')?.addEventListener('click', () => {
      const updated = this.collectState(overlay, preset);
      onSave(updated);
      this.close();
    });
  }

  private collectState(overlay: HTMLElement, original: TypePreset): TypePreset {
    const isPoly = original.geometry_type === 'Polygon';

    const label        = (overlay.querySelector<HTMLInputElement>('#sp-label-input'))?.value.trim() || original.label;
    const fillColor    = (overlay.querySelector<HTMLInputElement>('#sp-fill-color'))?.value    ?? original.color;
    const strokeColor  = (overlay.querySelector<HTMLInputElement>('#sp-stroke-color'))?.value  ?? original.stroke_color ?? '#ffffff';
    const iconColor    = (overlay.querySelector<HTMLInputElement>('#sp-icon-color'))?.value    ?? original.icon_color   ?? '#ffffff';
    const strokeWidth  = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-stroke-width-num') ?? overlay.querySelector<HTMLInputElement>('#sp-stroke-width'))?.value ?? '2');
    const size         = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-size-num') ?? overlay.querySelector<HTMLInputElement>('#sp-size'))?.value ?? '7');
    const fillOpacity  = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-fill-opacity-num') ?? overlay.querySelector<HTMLInputElement>('#sp-fill-opacity'))?.value ?? (isPoly ? '0.35' : '1'));
    const rotation     = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-rotation-num') ?? overlay.querySelector<HTMLInputElement>('#sp-rotation'))?.value ?? '0');
    const iconRotation = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-icon-rotation-num') ?? overlay.querySelector<HTMLInputElement>('#sp-icon-rotation'))?.value ?? '0');
    const iconSize     = parseFloat((overlay.querySelector<HTMLInputElement>('#sp-icon-size-num') ?? overlay.querySelector<HTMLInputElement>('#sp-icon-size'))?.value ?? '1');

    const activeShape     = overlay.querySelector<HTMLButtonElement>('.sp-shape-btn.active')?.dataset.shape as PointShape | undefined;
    const activeIcon      = overlay.querySelector<HTMLButtonElement>('.sp-icon-btn.active')?.dataset.icon ?? '';
    const activeDash      = overlay.querySelector<HTMLButtonElement>('.sp-dash-btn:not(.sp-stroke-dash-btn).active')?.dataset.dash as DashPattern | undefined;
    const activeStrokeDash = overlay.querySelector<HTMLButtonElement>('.sp-stroke-dash-btn.active')?.dataset.dash as DashPattern | undefined;

    return {
      ...original,
      label,
      color:         fillColor,
      fill_opacity:  isNaN(fillOpacity) ? original.fill_opacity : fillOpacity,
      stroke_color:  strokeColor,
      stroke_width:  isNaN(strokeWidth) ? original.stroke_width : strokeWidth,
      shape:         activeShape ?? original.shape,
      icon:          activeIcon || undefined,
      icon_color:    iconColor,
      icon_size:     isNaN(iconSize) ? original.icon_size : iconSize,
      size:          isNaN(size) ? original.size : size,
      dash_pattern:  activeDash ?? original.dash_pattern,
      rotation:      isNaN(rotation) ? original.rotation : rotation,
      icon_rotation: isNaN(iconRotation) ? original.icon_rotation : iconRotation,
      ...(isPoly && activeStrokeDash ? { stroke_dash: activeStrokeDash } : {}),
    };
  }
}

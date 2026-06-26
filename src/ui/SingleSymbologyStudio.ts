import type { TypePreset, PointShape, DashPattern } from '../types';
import { ICON_CATEGORIES, ICON_PATHS, renderSwatchDataUrl, renderLineSwatchDataUrl, renderPolygonSwatchDataUrl } from './SymbolRenderer';
import { SINGLE_COLORS, OUTLINE_COLORS, LABEL_COLORS } from '../lib/symbologyEngine';

type OnSave = (updated: TypePreset) => void;

const SHAPE_OPTS: Array<{ value: PointShape; label: string; svg: string }> = [
  { value: 'circle',   label: 'Circle',   svg: '<circle cx="12" cy="12" r="8" fill="currentColor"/>' },
  { value: 'square',   label: 'Square',   svg: '<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>' },
  { value: 'diamond',  label: 'Diamond',  svg: '<polygon points="12,3 21,12 12,21 3,12" fill="currentColor"/>' },
  { value: 'triangle', label: 'Triangle', svg: '<polygon points="12,4 22,20 2,20" fill="currentColor"/>' },
];

const DASH_OPTS: Array<{ value: DashPattern; label: string }> = [
  { value: 'solid',  label: '———' },
  { value: 'dashed', label: '- - -' },
  { value: 'dotted', label: '· · ·' },
];

/** Lite single-symbol editor for TypePreset — no classification, same look as SymbologyStudio. */
export class SingleSymbologyStudio {
  private container: HTMLElement | null = null;

  open(preset: TypePreset, onSave: OnSave): void {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'ss-overlay';
    document.body.appendChild(overlay);
    this.container = overlay;
    this.mount(overlay, { ...preset }, onSave);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  close(): void {
    if (this.container) { this.container.remove(); this.container = null; }
  }

  private mount(overlay: HTMLElement, draft: TypePreset, onSave: OnSave): void {
    const isPoint = draft.geometry_type === 'Point' || draft.geometry_type === 'all';
    const isLine  = draft.geometry_type === 'LineString';
    const isPoly  = draft.geometry_type === 'Polygon';
    const geomLabel = isPoly ? 'Polygons' : isLine ? 'Lines' : 'Points';

    overlay.innerHTML = this.buildHtml(draft, isPoint, isLine, isPoly, geomLabel);
    this.wire(overlay, draft, isPoint, isLine, isPoly, onSave);
    this.updatePreview(overlay, draft, isPoint, isLine, isPoly);
  }

  // ---- HTML builders ----

  private swatchGrid(colors: string[], current: string | undefined, attr: string): string {
    const isCustom = !!current && !colors.includes(current);
    return colors.map(c =>
      `<div class="ss-sw${c === current ? ' on' : ''}" data-${attr}="${c}" style="background:${c}" title="${c}"></div>`
    ).join('') + `
      <label class="ss-sw ss-sw-custom${isCustom ? ' on' : ''}" title="Custom colour…"${isCustom ? ` style="background:${current}"` : ''}>
        <input type="color" class="ss-custom-color" data-custom-for="${attr}" value="${isCustom ? current : '#22aa77'}" />
      </label>`;
  }

  private accordion(title: string, body: string, collapsed = false): string {
    return `<div class="ss-acc${collapsed ? ' collapsed' : ''}">
      <button type="button" class="ss-acc-head" aria-expanded="${!collapsed}">
        <span class="ss-acc-title">${title}</span>
        <svg class="ss-acc-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="ss-acc-body">${body}</div>
    </div>`;
  }

  private buildHtml(
    draft: TypePreset, isPoint: boolean, isLine: boolean, isPoly: boolean, geomLabel: string,
  ): string {
    const fillOpacity  = draft.fill_opacity  ?? (isPoly ? 0.35 : 1.0);
    const strokeColor  = draft.stroke_color  ?? (isPoint ? '#ffffff' : draft.color);
    const strokeWidth  = draft.stroke_width  ?? (isLine ? 3 : 2);
    const shape        = draft.shape         ?? 'circle';
    const size         = draft.size          ?? 7;
    const rotation     = draft.rotation      ?? 0;
    const casingColor  = draft.casing_color  ?? '#000000';
    const casingWidth  = draft.casing_width  ?? 0;

    const colourSection = this.accordion('Colour', `
      <div class="ss-section">
        <div class="ss-lbl">Fill colour</div>
        <div class="ss-swatch-grid" id="sss-color-swatches">
          ${this.swatchGrid(SINGLE_COLORS, draft.color, 'sss-color')}
        </div>
      </div>
    `);

    const outlineSection = this.accordion(isPoint ? 'Outline' : isPoly ? 'Stroke' : 'Stroke', `
      <div class="ss-section">
        <div class="ss-lbl">${isPoint ? 'Outline' : 'Stroke'} colour</div>
        <div class="ss-swatch-grid" id="sss-stroke-swatches">
          ${this.swatchGrid(OUTLINE_COLORS, strokeColor, 'sss-stroke')}
        </div>
        <div class="ss-lbl" style="margin-top:8px">${isPoint ? 'Outline' : 'Stroke'} width <span class="ss-val" id="sss-sw-val">${strokeWidth}px</span></div>
        <input type="range" id="sss-sw" min="0" max="${isPoint ? 6 : 8}" step="0.5" value="${strokeWidth}" />
      </div>
    `);

    const pointSection = isPoint ? this.accordion('Shape & Size', `
      <div class="ss-section">
        <div class="ss-lbl">Shape</div>
        <div class="ss-seg">
          ${SHAPE_OPTS.map(s => `
            <button class="ss-seg-btn${shape === s.value ? ' on' : ''}" data-sss-shape="${s.value}" title="${s.label}">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="none">${s.svg}</svg>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Size <span class="ss-val" id="sss-size-val">${size}px</span></div>
        <input type="range" id="sss-size" min="3" max="22" step="0.5" value="${size}" />
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Fill opacity <span class="ss-val" id="sss-fop-val">${Math.round(fillOpacity * 100)}%</span></div>
        <input type="range" id="sss-fop" min="0.05" max="1" step="0.05" value="${fillOpacity}" />
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Rotation <span class="ss-val" id="sss-rot-val">${rotation}°</span></div>
        <input type="range" id="sss-rot" min="0" max="360" step="1" value="${rotation}" />
      </div>
    `) : '';

    const iconSection = isPoint ? this.accordion('Icon overlay', `
      <div class="ss-section">
        <div class="ss-icon-grid" id="sss-icon-grid">
          <button class="ss-icon-btn${!draft.icon ? ' on' : ''}" data-sss-icon="" title="No icon">∅</button>
          ${ICON_CATEGORIES.flatMap(cat => cat.icons).filter(k => ICON_PATHS[k]).map(k => `
            <button class="ss-icon-btn${draft.icon === k ? ' on' : ''}" data-sss-icon="${k}" title="${k}">
              <svg viewBox="0 0 256 256" width="16" height="16" fill="currentColor"><path d="${ICON_PATHS[k]}"/></svg>
            </button>`).join('')}
        </div>
        <div id="sss-icon-extra" class="${draft.icon ? '' : 'ss-hidden'}">
          <div class="ss-lbl" style="margin-top:8px">Icon colour</div>
          <div class="ss-swatch-grid">
            ${this.swatchGrid(LABEL_COLORS, draft.icon_color ?? '#ffffff', 'sss-icon-color')}
          </div>
          <div class="ss-lbl" style="margin-top:8px">Icon size <span class="ss-val" id="sss-isz-val">${(draft.icon_size ?? 1).toFixed(1)}×</span></div>
          <input type="range" id="sss-icon-size" min="0.5" max="2.5" step="0.1" value="${draft.icon_size ?? 1}" />
          <div class="ss-lbl" style="margin-top:8px">Icon rotation <span class="ss-val" id="sss-irot-val">${draft.icon_rotation ?? 0}°</span></div>
          <input type="range" id="sss-icon-rot" min="0" max="360" step="5" value="${draft.icon_rotation ?? 0}" />
        </div>
      </div>
    `, true) : '';

    const lineSection = isLine ? this.accordion('Line style', `
      <div class="ss-section">
        <div class="ss-lbl">Width <span class="ss-val" id="sss-size-val">${strokeWidth}px</span></div>
        <input type="range" id="sss-size" min="0.5" max="16" step="0.5" value="${strokeWidth}" />
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Opacity <span class="ss-val" id="sss-fop-val">${Math.round(fillOpacity * 100)}%</span></div>
        <input type="range" id="sss-fop" min="0.05" max="1" step="0.05" value="${fillOpacity}" />
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Dash style</div>
        <div class="ss-seg">
          ${DASH_OPTS.map(d => `<button class="ss-seg-btn${(draft.dash_pattern ?? 'solid') === d.value ? ' on' : ''}" data-sss-dash="${d.value}">${d.label}</button>`).join('')}
        </div>
      </div>
      <div class="ss-section">
        <div class="ss-lbl">Casing width <span style="font-size:10px;opacity:.55">(border around line)</span> <span class="ss-val" id="sss-cw-val">${casingWidth}px</span></div>
        <input type="range" id="sss-cw" min="0" max="8" step="0.5" value="${casingWidth}" />
        <div id="sss-casing-extra" class="${casingWidth > 0 ? '' : 'ss-hidden'}" style="margin-top:8px">
          <div class="ss-lbl">Casing colour</div>
          <div class="ss-swatch-grid">
            ${this.swatchGrid(OUTLINE_COLORS, casingColor, 'sss-casing-color')}
          </div>
        </div>
      </div>
    `) : '';

    const polySection = isPoly ? this.accordion('Fill & stroke', `
      <div class="ss-section">
        <div class="ss-lbl">Fill opacity <span class="ss-val" id="sss-fop-val">${Math.round(fillOpacity * 100)}%</span></div>
        <input type="range" id="sss-fop" min="0.05" max="1" step="0.05" value="${fillOpacity}" />
      </div>
    `) : '';

    return `
      <div class="ss-panel">
        <div class="ss-header">
          <div class="ss-header-left">
            <span class="ss-title">${escHtml(draft.label)}</span>
            <span class="ss-geom-badge">${geomLabel}</span>
          </div>
          <button class="ss-close" id="sss-close">✕</button>
        </div>
        <div class="ss-main">
          <div class="ss-body" id="sss-body">
            ${colourSection}
            ${pointSection}
            ${outlineSection}
            ${iconSection}
            ${lineSection}
            ${polySection}
          </div>
          <div class="ss-col-right">
            <div class="ss-preview-head"><span class="ss-lbl">Preview</span></div>
            <div style="display:flex;align-items:center;justify-content:center;min-height:120px;background:var(--color-surface-2);border-radius:6px;padding:20px">
              <img id="sss-preview" width="80" height="80" style="image-rendering:pixelated" alt="style preview" />
            </div>
            <div class="ss-card" style="margin-top:12px">
              <div class="ss-card-title">Summary</div>
              <div id="sss-summary"></div>
            </div>
          </div>
        </div>
        <div class="ss-footer">
          <button class="btn-outline" id="sss-cancel">Cancel</button>
          <button class="btn-primary" id="sss-save">Save</button>
        </div>
      </div>
    `;
  }

  // ---- Preview & summary ----

  private updatePreview(overlay: HTMLElement, draft: TypePreset, isPoint: boolean, isLine: boolean, isPoly: boolean): void {
    const img = overlay.querySelector<HTMLImageElement>('#sss-preview');
    if (img) {
      img.src = isPoly
        ? renderPolygonSwatchDataUrl(draft, 80)
        : isLine
          ? renderLineSwatchDataUrl(draft, 80)
          : renderSwatchDataUrl(draft, 80);
    }
    const sum = overlay.querySelector('#sss-summary');
    if (sum) sum.innerHTML = this.buildSummary(draft, isPoint, isLine, isPoly);
  }

  private buildSummary(draft: TypePreset, isPoint: boolean, isLine: boolean, isPoly: boolean): string {
    const chip = (c: string) => `<span class="ss-chip" style="background:${c}"></span>${c}`;
    const rows: [string, string][] = [['Colour', chip(draft.color)]];
    if (isPoint) {
      rows.push(['Shape', draft.shape ?? 'circle']);
      rows.push(['Size', `${draft.size ?? 7}px`]);
      rows.push(['Opacity', `${Math.round((draft.fill_opacity ?? 1) * 100)}%`]);
      rows.push(['Outline', chip(draft.stroke_color ?? '#ffffff')]);
      if (draft.icon) rows.push(['Icon', draft.icon]);
    } else if (isPoly) {
      rows.push(['Fill opacity', `${Math.round((draft.fill_opacity ?? 0.35) * 100)}%`]);
      rows.push(['Stroke', chip(draft.stroke_color ?? draft.color)]);
      rows.push(['Stroke width', `${draft.stroke_width ?? 2}px`]);
    } else {
      rows.push(['Width', `${draft.stroke_width ?? 3}px`]);
      rows.push(['Opacity', `${Math.round((draft.fill_opacity ?? 1) * 100)}%`]);
      if (draft.dash_pattern && draft.dash_pattern !== 'solid') rows.push(['Dash', draft.dash_pattern]);
    }
    return rows.map(([k, v]) =>
      `<div class="ss-sum-row"><span class="ss-sum-k">${k}</span><span class="ss-sum-v">${v}</span></div>`
    ).join('');
  }

  // ---- Event wiring ----

  private wireCustomColor(overlay: HTMLElement, attr: string, setter: (c: string) => void, refresh: () => void): void {
    overlay.querySelectorAll<HTMLInputElement>(`input.ss-custom-color[data-custom-for="${attr}"]`).forEach(inp => {
      inp.addEventListener('input', () => {
        const label = inp.closest<HTMLElement>('.ss-sw-custom');
        const grid = label?.parentElement;
        grid?.querySelectorAll('.ss-sw').forEach(e => e.classList.remove('on'));
        if (label) { label.classList.add('on'); label.style.background = inp.value; }
        setter(inp.value);
        refresh();
      });
      inp.addEventListener('click', e => e.stopPropagation());
    });
  }

  private wire(
    overlay: HTMLElement,
    draft: TypePreset,
    isPoint: boolean,
    isLine: boolean,
    isPoly: boolean,
    onSave: OnSave,
  ): void {
    const refresh = () => this.updatePreview(overlay, draft, isPoint, isLine, isPoly);

    overlay.querySelector('#sss-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#sss-cancel')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', e => { if (e.target === overlay) this.close(); });

    overlay.querySelector('#sss-body')?.addEventListener('click', e => {
      const head = (e.target as HTMLElement).closest<HTMLElement>('.ss-acc-head');
      if (!head) return;
      const acc = head.closest('.ss-acc');
      if (!acc) return;
      const collapsed = acc.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    });

    // Fill colour swatches
    overlay.querySelectorAll<HTMLElement>('[data-sss-color]').forEach(el => {
      el.addEventListener('click', () => {
        el.parentElement?.querySelectorAll('[data-sss-color]').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        draft.color = el.dataset.sssColor!;
        refresh();
      });
    });
    this.wireCustomColor(overlay, 'sss-color', c => { draft.color = c; }, refresh);

    // Stroke/outline colour swatches
    overlay.querySelectorAll<HTMLElement>('[data-sss-stroke]').forEach(el => {
      el.addEventListener('click', () => {
        el.parentElement?.querySelectorAll('[data-sss-stroke]').forEach(e => e.classList.remove('on'));
        el.classList.add('on');
        draft.stroke_color = el.dataset.sssStroke!;
        refresh();
      });
    });
    this.wireCustomColor(overlay, 'sss-stroke', c => { draft.stroke_color = c; }, refresh);

    // Stroke/outline width
    const swSlider = overlay.querySelector<HTMLInputElement>('#sss-sw');
    const swVal = overlay.querySelector<HTMLElement>('#sss-sw-val');
    swSlider?.addEventListener('input', () => {
      draft.stroke_width = parseFloat(swSlider.value);
      if (swVal) swVal.textContent = `${draft.stroke_width}px`;
      refresh();
    });

    // Fill opacity / Line opacity
    const fopSlider = overlay.querySelector<HTMLInputElement>('#sss-fop');
    const fopVal = overlay.querySelector<HTMLElement>('#sss-fop-val');
    fopSlider?.addEventListener('input', () => {
      draft.fill_opacity = parseFloat(fopSlider.value);
      if (fopVal) fopVal.textContent = `${Math.round(draft.fill_opacity * 100)}%`;
      refresh();
    });

    if (isPoint) {
      // Shape
      overlay.querySelectorAll<HTMLButtonElement>('[data-sss-shape]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-sss-shape]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          draft.shape = btn.dataset.sssShape as PointShape;
          refresh();
        });
      });

      // Size
      const sizeSlider = overlay.querySelector<HTMLInputElement>('#sss-size');
      const sizeVal = overlay.querySelector<HTMLElement>('#sss-size-val');
      sizeSlider?.addEventListener('input', () => {
        draft.size = parseFloat(sizeSlider.value);
        if (sizeVal) sizeVal.textContent = `${draft.size}px`;
        refresh();
      });

      // Rotation
      const rotSlider = overlay.querySelector<HTMLInputElement>('#sss-rot');
      const rotVal = overlay.querySelector<HTMLElement>('#sss-rot-val');
      rotSlider?.addEventListener('input', () => {
        draft.rotation = parseFloat(rotSlider.value);
        if (rotVal) rotVal.textContent = `${draft.rotation}°`;
        refresh();
      });

      // Icon overlay
      overlay.querySelectorAll<HTMLButtonElement>('[data-sss-icon]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-sss-icon]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          draft.icon = btn.dataset.sssIcon || undefined;
          overlay.querySelector<HTMLElement>('#sss-icon-extra')?.classList.toggle('ss-hidden', !draft.icon);
          refresh();
        });
      });
      overlay.querySelectorAll<HTMLElement>('[data-sss-icon-color]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('[data-sss-icon-color]').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          draft.icon_color = el.dataset.sssIconColor!;
          refresh();
        });
      });
      this.wireCustomColor(overlay, 'sss-icon-color', c => { draft.icon_color = c; }, refresh);
      const iszSlider = overlay.querySelector<HTMLInputElement>('#sss-icon-size');
      const iszVal = overlay.querySelector<HTMLElement>('#sss-isz-val');
      iszSlider?.addEventListener('input', () => {
        draft.icon_size = parseFloat(iszSlider.value);
        if (iszVal) iszVal.textContent = `${draft.icon_size.toFixed(1)}×`;
        refresh();
      });
      const irotSlider = overlay.querySelector<HTMLInputElement>('#sss-icon-rot');
      const irotVal = overlay.querySelector<HTMLElement>('#sss-irot-val');
      irotSlider?.addEventListener('input', () => {
        draft.icon_rotation = parseFloat(irotSlider.value);
        if (irotVal) irotVal.textContent = `${draft.icon_rotation}°`;
        refresh();
      });
    }

    if (isLine) {
      // Line width (stored in stroke_width)
      const lwSlider = overlay.querySelector<HTMLInputElement>('#sss-size');
      const lwVal = overlay.querySelector<HTMLElement>('#sss-size-val');
      lwSlider?.addEventListener('input', () => {
        draft.stroke_width = parseFloat(lwSlider.value);
        if (lwVal) lwVal.textContent = `${draft.stroke_width}px`;
        refresh();
      });

      // Dash pattern
      overlay.querySelectorAll<HTMLButtonElement>('[data-sss-dash]').forEach(btn => {
        btn.addEventListener('click', () => {
          overlay.querySelectorAll('[data-sss-dash]').forEach(b => b.classList.remove('on'));
          btn.classList.add('on');
          draft.dash_pattern = btn.dataset.sssDash as DashPattern;
          refresh();
        });
      });

      // Casing width
      const cwSlider = overlay.querySelector<HTMLInputElement>('#sss-cw');
      const cwVal = overlay.querySelector<HTMLElement>('#sss-cw-val');
      cwSlider?.addEventListener('input', () => {
        draft.casing_width = parseFloat(cwSlider.value);
        if (cwVal) cwVal.textContent = `${draft.casing_width}px`;
        overlay.querySelector<HTMLElement>('#sss-casing-extra')?.classList.toggle('ss-hidden', (draft.casing_width ?? 0) <= 0);
        refresh();
      });

      // Casing colour
      overlay.querySelectorAll<HTMLElement>('[data-sss-casing-color]').forEach(el => {
        el.addEventListener('click', () => {
          el.parentElement?.querySelectorAll('[data-sss-casing-color]').forEach(e => e.classList.remove('on'));
          el.classList.add('on');
          draft.casing_color = el.dataset.sssCasingColor!;
          refresh();
        });
      });
      this.wireCustomColor(overlay, 'sss-casing-color', c => { draft.casing_color = c; }, refresh);
    }

    overlay.querySelector('#sss-save')?.addEventListener('click', () => {
      onSave({ ...draft });
      this.close();
    });
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

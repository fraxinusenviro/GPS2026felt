import { EventBus } from '../utils/EventBus';
import TEMPLATE_URL from '../assets/titleblock_template_transparent.png';
import { LayoutExtentSelector, type CropBox } from './LayoutExtentSelector';

interface FieldDef {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  placeholder: string;
  label: string;
  defaultFontSize: number;
  defaultWeight: string;
  defaultAlign: string;
}

interface FieldStyle {
  fontWeight: string;
  fontSize: number;
  color: string;
  textAlign: string;
}

interface AnnoState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: FieldStyle;
}

interface LayoutSavedState {
  version: 2;
  fields: Record<string, { html: string; style: FieldStyle }>;
  annotations: Array<AnnoState & { html: string }>;
}

const LS_KEY = 'fraxinus_layout_state';

const MAP_VP = { left: 0.78125, top: 1.40154, width: 85.25391, height: 97.47722 };

const FIELDS: FieldDef[] = [
  { id: 'legend_notes', left: 87.05, top: 12.0,  width: 12.65, height: 34.0, placeholder: 'Legend / Map Notes',         label: 'Legend / Notes',   defaultFontSize: 11, defaultWeight: '400', defaultAlign: 'left' },
  { id: 'title_band',   left: 87.05, top: 52.9,  width: 12.65, height: 9.2,  placeholder: 'Map Title / Client / Location', label: 'Map Title',       defaultFontSize: 13, defaultWeight: '500', defaultAlign: 'center' },
  { id: 'project',      left: 90.43, top: 62.85, width: 2.45,  height: 1.45, placeholder: 'Project #',                  label: 'Project #',        defaultFontSize: 9,  defaultWeight: '400', defaultAlign: 'left' },
  { id: 'drawn',        left: 90.43, top: 64.40, width: 2.45,  height: 1.45, placeholder: 'Drawn by',                   label: 'Drawn',            defaultFontSize: 9,  defaultWeight: '400', defaultAlign: 'left' },
  { id: 'checked',      left: 90.43, top: 65.95, width: 2.45,  height: 1.45, placeholder: 'Checked by',                 label: 'Checked',          defaultFontSize: 9,  defaultWeight: '400', defaultAlign: 'left' },
  { id: 'approved',     left: 90.43, top: 67.50, width: 2.45,  height: 1.45, placeholder: 'Approved by',                label: 'Approved',         defaultFontSize: 9,  defaultWeight: '400', defaultAlign: 'left' },
  { id: 'date',         left: 90.43, top: 69.05, width: 2.45,  height: 1.45, placeholder: 'Date',                       label: 'Date',             defaultFontSize: 9,  defaultWeight: '400', defaultAlign: 'left' },
  { id: 'figure',       left: 93.25, top: 62.85, width: 6.45,  height: 7.30, placeholder: 'Fig. #',                     label: 'Figure',           defaultFontSize: 18, defaultWeight: '700', defaultAlign: 'center' },
  { id: 'notes',        left: 87.05, top: 83.1,  width: 12.65, height: 8.2,  placeholder: 'Notes…',                     label: 'Notes',            defaultFontSize: 10, defaultWeight: '400', defaultAlign: 'left' },
  { id: 'params',       left: 87.05, top: 93.0,  width: 12.65, height: 6.4,  placeholder: 'Map Parameters…',            label: 'Map Parameters',   defaultFontSize: 10, defaultWeight: '400', defaultAlign: 'left' },
];

const DEFAULT_STYLE: FieldStyle = { fontWeight: '400', fontSize: 11, color: '#1a1a1a', textAlign: 'left' };

export class LayoutMode {
  private overlay: HTMLElement | null = null;
  private isActive = false;
  private fieldStyles = new Map<string, FieldStyle>();
  private selectedFieldId: string | null = null;
  private mapSnapshot: string | null = null;
  private templateMissing = false;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private cropBox: CropBox | null = null;

  // Zoom / pan state
  private scale = 1.0;
  private panX = 0;
  private panY = 0;
  private sheetBaseW = 0;
  private sheetBaseH = 0;

  // Annotations
  private annotations = new Map<string, AnnoState>();
  private annoCounter = 0;

  constructor(private getMapCanvas: () => HTMLCanvasElement) {
    for (const f of FIELDS) {
      this.fieldStyles.set(f.id, {
        fontWeight: f.defaultWeight,
        fontSize: f.defaultFontSize,
        color: '#1a1a1a',
        textAlign: f.defaultAlign,
      });
    }
  }

  // ── Public entry points ───────────────────────────────────────

  startExtentSelection(): void {
    if (this.isActive) return;
    const container = document.getElementById('map-container') as HTMLElement;
    const sel = new LayoutExtentSelector(
      container,
      (crop) => { this.openWithCrop(crop); },
      () => { /* user cancelled */ },
    );
    sel.open();
  }

  open(): void {
    this.openWithCrop(null);
  }

  close(): void {
    if (!this.isActive) return;
    this.saveState();
    this.isActive = false;
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.selectedFieldId = null;
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
  }

  // ── Internal open ─────────────────────────────────────────────

  private openWithCrop(crop: CropBox | null): void {
    if (this.isActive) return;
    this.isActive = true;
    this.cropBox = crop;

    try {
      this.mapSnapshot = this.getMapCanvas().toDataURL('image/png');
    } catch {
      this.mapSnapshot = null;
    }

    this.render();
  }

  // ── DOM construction ──────────────────────────────────────────

  private render(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'layout-mode-overlay';
    this.overlay.innerHTML = this.buildHTML();
    document.body.appendChild(this.overlay);
    this.wireEvents();

    const tmplImg = this.overlay.querySelector<HTMLImageElement>('#lm-template');
    if (tmplImg) {
      tmplImg.onerror = () => {
        this.templateMissing = true;
        tmplImg.style.display = 'none';
        const notice = this.overlay?.querySelector<HTMLElement>('#lm-tmpl-notice');
        if (notice) {
          notice.style.display = 'block';
          notice.textContent = `Template image failed to load from: ${TEMPLATE_URL}`;
        }
      };
      tmplImg.src = TEMPLATE_URL;
    }

    // Measure sheet after first paint, then fit + restore saved state
    requestAnimationFrame(() => {
      const sheet = this.overlay?.querySelector<HTMLElement>('#lm-sheet');
      if (sheet) {
        this.sheetBaseW = sheet.offsetWidth;
        this.sheetBaseH = sheet.offsetHeight;
        this.fitSheet();
      }
      this.restoreState();
    });
  }

  private buildHTML(): string {
    return `
      <div id="lm-toolbar">
        <div class="lm-tb-section">
          <span class="lm-title-badge">
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13" y="2" width="5" height="16" rx="0" fill="currentColor" opacity=".25"/><rect x="5" y="5" width="6" height="1.2" rx=".5"/><rect x="5" y="8" width="4" height="1.2" rx=".5"/></svg>
            Layout Mode
          </span>
        </div>

        <div class="lm-tb-section lm-field-section">
          <span class="lm-tb-dimmed" id="lm-field-name">Click a field to select</span>
        </div>

        <div class="lm-tb-section lm-style-section" id="lm-style-controls">
          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Weight</label>
            <select id="lm-font-weight" class="lm-select">
              <option value="300">Light</option>
              <option value="400" selected>Regular</option>
              <option value="500">Medium</option>
              <option value="600">SemiBold</option>
              <option value="700">Bold</option>
            </select>
          </div>

          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Size</label>
            <div class="lm-size-row">
              <button class="lm-icon-btn" id="lm-size-dec" title="Smaller">−</button>
              <span id="lm-size-display" class="lm-size-val">--</span>
              <button class="lm-icon-btn" id="lm-size-inc" title="Larger">+</button>
            </div>
          </div>

          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Align</label>
            <div class="lm-align-row">
              <button class="lm-icon-btn lm-align-btn" data-align="left" title="Left">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="1" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="1" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
              <button class="lm-icon-btn lm-align-btn" data-align="center" title="Center">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="3" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="4.5" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
              <button class="lm-icon-btn lm-align-btn" data-align="right" title="Right">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="5" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="8" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
            </div>
          </div>

          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Color</label>
            <input type="color" id="lm-color" value="#1a1a1a" class="lm-color-swatch" title="Text color" />
          </div>
        </div>

        <div class="lm-tb-section">
          <label class="lm-ctrl-label" style="align-self:center;margin-right:2px">Zoom</label>
          <button class="lm-icon-btn" id="lm-zoom-out" title="Zoom Out">−</button>
          <button class="lm-icon-btn" id="lm-zoom-fit" title="Fit to window" style="font-size:11px;width:auto;padding:0 5px;">⊡</button>
          <button class="lm-icon-btn" id="lm-zoom-in" title="Zoom In">+</button>
        </div>

        <div class="lm-tb-section lm-actions-section">
          <button class="lm-action-btn lm-anno-btn" id="lm-add-anno" title="Add free text annotation">
            <svg viewBox="0 0 18 18" fill="currentColor" width="13" height="13"><path d="M3 14l2-5L12 2l3 3-7 7-5 2zm2-5l3 3"/></svg>
            + Text
          </button>
          <button class="lm-action-btn lm-export-btn" id="lm-export-png">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 9 3zm-.5 3v3.3H6l3 3.7 3-3.7H9.5V6h-1z"/></svg>
            PNG
          </button>
          <button class="lm-action-btn lm-export-btn" id="lm-export-pdf">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M4 2h7l3 3v11H4V2zm7 0v3h3M7 9h4M7 12h4M7 6h2"/></svg>
            PDF
          </button>
          <button class="lm-action-btn lm-close-btn" id="lm-close" title="Exit Layout Mode (Esc)">✕ Exit</button>
        </div>
      </div>

      <div id="lm-workspace">
        <div id="lm-sheet">
          ${this.mapSnapshot
            ? `<img id="lm-map-snapshot" src="${this.mapSnapshot}" alt="" />`
            : `<div id="lm-map-placeholder"><span>Map snapshot unavailable<br><small>Enable preserveDrawingBuffer in map settings</small></span></div>`
          }
          <img id="lm-template" alt="" />
          <div id="lm-fields-layer">
            ${FIELDS.map(f => this.buildFieldEl(f)).join('\n')}
          </div>
        </div>
        <div id="lm-tmpl-notice" style="display:none"></div>
      </div>
    `;
  }

  private buildFieldEl(f: FieldDef): string {
    const s = this.fieldStyles.get(f.id)!;
    return `<div
      class="lm-field"
      id="lm-f-${f.id}"
      data-fid="${f.id}"
      contenteditable="true"
      spellcheck="false"
      data-placeholder="${f.placeholder}"
      style="left:${f.left}%;top:${f.top}%;width:${f.width}%;height:${f.height}%;font-family:'Oswald',sans-serif;font-weight:${s.fontWeight};font-size:${s.fontSize}px;color:${s.color};text-align:${s.textAlign};"
    ></div>`;
  }

  // ── Event wiring ──────────────────────────────────────────────

  private wireEvents(): void {
    if (!this.overlay) return;
    const ov = this.overlay;

    ov.querySelector('#lm-close')?.addEventListener('click', () => this.close());

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const active = document.activeElement;
        if (this.selectedFieldId && this.annotations.has(this.selectedFieldId)) {
          const content = ov.querySelector(`#lm-a-${this.selectedFieldId} .lm-anno-content`);
          if (active !== content) this.deleteAnnotation(this.selectedFieldId);
        }
      }
    };
    document.addEventListener('keydown', this.escHandler);

    // Field focus
    ov.querySelectorAll<HTMLElement>('.lm-field').forEach(el => {
      el.addEventListener('focus', () => this.selectField(el.dataset.fid!));
      el.addEventListener('blur', () => this.saveState());
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); }
      });
    });

    // Font weight
    const weightSel = ov.querySelector<HTMLSelectElement>('#lm-font-weight');
    weightSel?.addEventListener('change', () => this.applyProp('fontWeight', weightSel.value));

    // Size
    ov.querySelector('#lm-size-inc')?.addEventListener('click', () => {
      if (!this.selectedFieldId) return;
      const cur = this.getSelectedStyle();
      this.applyProp('fontSize', String(Math.min(72, cur.fontSize + 1)));
    });
    ov.querySelector('#lm-size-dec')?.addEventListener('click', () => {
      if (!this.selectedFieldId) return;
      const cur = this.getSelectedStyle();
      this.applyProp('fontSize', String(Math.max(6, cur.fontSize - 1)));
    });

    // Align
    ov.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
      btn.addEventListener('click', () => this.applyProp('textAlign', btn.dataset.align!));
    });

    // Color
    const colorInput = ov.querySelector<HTMLInputElement>('#lm-color');
    colorInput?.addEventListener('input', () => this.applyProp('color', colorInput.value));

    // Zoom
    ov.querySelector('#lm-zoom-in')?.addEventListener('click', () => this.zoomBy(1.2));
    ov.querySelector('#lm-zoom-out')?.addEventListener('click', () => this.zoomBy(1 / 1.2));
    ov.querySelector('#lm-zoom-fit')?.addEventListener('click', () => this.fitSheet());

    // Annotation add
    ov.querySelector('#lm-add-anno')?.addEventListener('click', () => this.addAnnotationAtCenter());

    // Exports
    ov.querySelector('#lm-export-png')?.addEventListener('click', () => void this.exportPNG());
    ov.querySelector('#lm-export-pdf')?.addEventListener('click', () => void this.exportPDF());

    // Workspace wheel zoom + drag pan
    const workspace = ov.querySelector<HTMLElement>('#lm-workspace')!;
    this.wireWorkspacePan(workspace);
    workspace.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.15, Math.min(4.0, this.scale * factor));
      this.applyTransform();
    }, { passive: false });
  }

  private wireWorkspacePan(workspace: HTMLElement): void {
    let panning = false;
    let startX = 0, startY = 0, origPX = 0, origPY = 0;

    workspace.addEventListener('pointerdown', (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lm-field, .lm-anno, .lm-anno-content, .lm-anno-resize, .lm-anno-delete, #lm-zoom-in, #lm-zoom-out, #lm-zoom-fit')) return;
      panning = true;
      startX = e.clientX; startY = e.clientY;
      origPX = this.panX; origPY = this.panY;
      workspace.classList.add('is-panning');
      workspace.setPointerCapture(e.pointerId);
    });
    workspace.addEventListener('pointermove', (e: PointerEvent) => {
      if (!panning) return;
      this.panX = origPX + (e.clientX - startX);
      this.panY = origPY + (e.clientY - startY);
      this.applyTransform();
    });
    workspace.addEventListener('pointerup', () => {
      panning = false;
      workspace.classList.remove('is-panning');
    });
  }

  // ── Zoom / pan ─────────────────────────────────────────────────

  private applyTransform(): void {
    const sheet = this.overlay?.querySelector<HTMLElement>('#lm-sheet');
    if (sheet) sheet.style.transform = `translate(${this.panX}px,${this.panY}px) scale(${this.scale})`;
  }

  private fitSheet(): void {
    const ws = this.overlay?.querySelector<HTMLElement>('#lm-workspace');
    if (!ws || !this.sheetBaseW || !this.sheetBaseH) return;
    this.scale = Math.min(
      (ws.clientWidth  - 32) / this.sheetBaseW,
      (ws.clientHeight - 32) / this.sheetBaseH,
      1.0,
    );
    this.panX = 0;
    this.panY = 0;
    this.applyTransform();
  }

  private zoomBy(factor: number): void {
    this.scale = Math.max(0.15, Math.min(4.0, this.scale * factor));
    this.applyTransform();
  }

  // ── Field selection + style ───────────────────────────────────

  private getSelectedStyle(): FieldStyle {
    if (!this.selectedFieldId) return { ...DEFAULT_STYLE };
    return this.fieldStyles.get(this.selectedFieldId)
        ?? this.annotations.get(this.selectedFieldId)?.style
        ?? { ...DEFAULT_STYLE };
  }

  private selectField(id: string): void {
    this.selectedFieldId = id;
    const isAnno = this.annotations.has(id);
    const s = isAnno ? this.annotations.get(id)!.style : (this.fieldStyles.get(id) ?? DEFAULT_STYLE);
    const def = FIELDS.find(f => f.id === id);

    const nameEl = this.overlay?.querySelector('#lm-field-name');
    if (nameEl) {
      nameEl.textContent = isAnno ? 'Annotation' : (def?.label ?? id);
      nameEl.classList.remove('lm-tb-dimmed');
      nameEl.classList.add('lm-tb-field-active');
    }

    const weightSel = this.overlay?.querySelector<HTMLSelectElement>('#lm-font-weight');
    if (weightSel) weightSel.value = s.fontWeight;
    const sizeDisplay = this.overlay?.querySelector('#lm-size-display');
    if (sizeDisplay) sizeDisplay.textContent = `${s.fontSize}px`;
    const colorInput = this.overlay?.querySelector<HTMLInputElement>('#lm-color');
    if (colorInput) colorInput.value = s.color;

    this.overlay?.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
      btn.classList.toggle('lm-btn-active', btn.dataset.align === s.textAlign);
    });

    this.overlay?.querySelectorAll<HTMLElement>('.lm-field').forEach(el => {
      el.classList.toggle('lm-field--selected', el.dataset.fid === id);
    });
    this.overlay?.querySelectorAll<HTMLElement>('.lm-anno').forEach(el => {
      el.classList.toggle('lm-anno--selected', el.dataset.aid === id);
    });
  }

  private applyProp(prop: 'fontWeight' | 'fontSize' | 'color' | 'textAlign', value: string): void {
    if (!this.selectedFieldId) return;
    const isAnno = this.annotations.has(this.selectedFieldId);
    const s: FieldStyle = isAnno
      ? this.annotations.get(this.selectedFieldId)!.style
      : (this.fieldStyles.get(this.selectedFieldId) ?? { ...DEFAULT_STYLE });

    if (prop === 'fontSize') s.fontSize = parseInt(value, 10);
    else if (prop === 'fontWeight') s.fontWeight = value;
    else if (prop === 'color') s.color = value;
    else if (prop === 'textAlign') {
      s.textAlign = value;
      this.overlay?.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
        btn.classList.toggle('lm-btn-active', btn.dataset.align === value);
      });
    }

    if (isAnno) this.annotations.get(this.selectedFieldId)!.style = s;
    else this.fieldStyles.set(this.selectedFieldId, s);

    const elId = isAnno ? `#lm-a-${this.selectedFieldId} .lm-anno-content` : `#lm-f-${this.selectedFieldId}`;
    const el = this.overlay?.querySelector<HTMLElement>(elId);
    if (el) {
      if (prop === 'fontSize')   el.style.fontSize   = `${s.fontSize}px`;
      if (prop === 'fontWeight') el.style.fontWeight = s.fontWeight;
      if (prop === 'color')      el.style.color      = s.color;
      if (prop === 'textAlign')  el.style.textAlign  = s.textAlign;
    }
    if (prop === 'fontSize') {
      const sizeDisplay = this.overlay?.querySelector('#lm-size-display');
      if (sizeDisplay) sizeDisplay.textContent = `${s.fontSize}px`;
    }
  }

  // ── Annotations ───────────────────────────────────────────────

  private addAnnotationAtCenter(): void {
    const sheet = this.overlay?.querySelector<HTMLElement>('#lm-sheet');
    const ws = this.overlay?.querySelector<HTMLElement>('#lm-workspace');
    if (!sheet || !ws) return;

    const sr = sheet.getBoundingClientRect();
    const wr = ws.getBoundingClientRect();
    // Centre of the visible workspace in sheet px (accounting for scale)
    const cx = ((wr.left + wr.width  / 2) - sr.left) / this.scale;
    const cy = ((wr.top  + wr.height / 2) - sr.top)  / this.scale;

    const id = `anno_${++this.annoCounter}`;
    const anno: AnnoState = {
      id,
      x: cx - 100,
      y: cy - 35,
      w: 200,
      h: 70,
      style: { fontWeight: '400', fontSize: 12, color: '#1a1a1a', textAlign: 'left' },
    };
    this.annotations.set(id, anno);
    this.mountAnnotation(anno, '');
    const content = this.overlay?.querySelector<HTMLElement>(`#lm-a-${id} .lm-anno-content`);
    content?.focus();
  }

  private mountAnnotation(anno: AnnoState, html: string): void {
    const layer = this.overlay?.querySelector<HTMLElement>('#lm-fields-layer');
    if (!layer) return;

    const el = document.createElement('div');
    el.className = 'lm-anno';
    el.id = `lm-a-${anno.id}`;
    el.dataset.aid = anno.id;
    el.style.left   = `${anno.x}px`;
    el.style.top    = `${anno.y}px`;
    el.style.width  = `${anno.w}px`;
    el.style.height = `${anno.h}px`;

    const s = anno.style;
    el.innerHTML = `
      <div class="lm-anno-content" contenteditable="true" spellcheck="false"
        style="font-family:'Oswald',sans-serif;font-weight:${s.fontWeight};font-size:${s.fontSize}px;color:${s.color};text-align:${s.textAlign};"
      >${html}</div>
      <button class="lm-anno-delete" title="Delete annotation">✕</button>
      <div class="lm-anno-resize"></div>
    `;

    // Focus → select
    el.querySelector('.lm-anno-content')?.addEventListener('focus', () => this.selectField(anno.id));
    el.querySelector('.lm-anno-content')?.addEventListener('blur',  () => this.saveState());
    el.querySelector('.lm-anno-content')?.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); document.execCommand('insertLineBreak'); }
    });

    // Delete button
    el.querySelector('.lm-anno-delete')?.addEventListener('click', () => this.deleteAnnotation(anno.id));

    // Drag to move
    this.wireAnnoDrag(el, anno);

    // Resize handle
    this.wireAnnoResize(el.querySelector<HTMLElement>('.lm-anno-resize')!, el, anno);

    layer.appendChild(el);
  }

  private wireAnnoDrag(el: HTMLElement, anno: AnnoState): void {
    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    el.addEventListener('pointerdown', (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('lm-anno-content') || t.classList.contains('lm-anno-resize') || t.classList.contains('lm-anno-delete')) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = anno.x; origY = anno.y;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      anno.x = origX + (e.clientX - startX) / this.scale;
      anno.y = origY + (e.clientY - startY) / this.scale;
      el.style.left = `${anno.x}px`;
      el.style.top  = `${anno.y}px`;
    });
    el.addEventListener('pointerup', () => { dragging = false; });
  }

  private wireAnnoResize(handle: HTMLElement, el: HTMLElement, anno: AnnoState): void {
    let startX = 0, startY = 0, origW = 0, origH = 0;

    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      e.preventDefault(); e.stopPropagation();
      startX = e.clientX; startY = e.clientY;
      origW = anno.w; origH = anno.h;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      anno.w = Math.max(60, origW + (e.clientX - startX) / this.scale);
      anno.h = Math.max(30, origH + (e.clientY - startY) / this.scale);
      el.style.width  = `${anno.w}px`;
      el.style.height = `${anno.h}px`;
    });
  }

  private deleteAnnotation(id: string): void {
    this.annotations.delete(id);
    this.overlay?.querySelector(`#lm-a-${id}`)?.remove();
    if (this.selectedFieldId === id) {
      this.selectedFieldId = null;
      const nameEl = this.overlay?.querySelector('#lm-field-name');
      if (nameEl) {
        nameEl.textContent = 'Click a field to select';
        nameEl.classList.add('lm-tb-dimmed');
        nameEl.classList.remove('lm-tb-field-active');
      }
    }
    this.saveState();
  }

  // ── Persistence ───────────────────────────────────────────────

  private saveState(): void {
    try {
      const fields: LayoutSavedState['fields'] = {};
      for (const f of FIELDS) {
        const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${f.id}`);
        fields[f.id] = { html: el?.innerHTML ?? '', style: this.fieldStyles.get(f.id) ?? { ...DEFAULT_STYLE } };
      }

      const annotations: LayoutSavedState['annotations'] = [];
      for (const [, anno] of this.annotations) {
        const content = this.overlay?.querySelector<HTMLElement>(`#lm-a-${anno.id} .lm-anno-content`);
        annotations.push({ ...anno, html: content?.innerHTML ?? '' });
      }

      const state: LayoutSavedState = { version: 2, fields, annotations };
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch { /* storage full or unavailable */ }
  }

  private restoreState(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const state = JSON.parse(raw) as LayoutSavedState;
      if (state.version !== 2) return;

      for (const f of FIELDS) {
        const saved = state.fields[f.id];
        if (!saved) continue;
        this.fieldStyles.set(f.id, saved.style);
        const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${f.id}`);
        if (el && saved.html) {
          el.innerHTML = saved.html;
          el.style.fontWeight = saved.style.fontWeight;
          el.style.fontSize   = `${saved.style.fontSize}px`;
          el.style.color      = saved.style.color;
          el.style.textAlign  = saved.style.textAlign;
        }
      }

      for (const saved of state.annotations) {
        const { html, ...anno } = saved;
        this.annoCounter = Math.max(this.annoCounter, parseInt(anno.id.replace('anno_', ''), 10) || 0);
        this.annotations.set(anno.id, anno);
        this.mountAnnotation(anno, html);
      }
    } catch { /* corrupt storage */ }
  }

  // ── Export ────────────────────────────────────────────────────

  private async buildExportCanvas(): Promise<HTMLCanvasElement> {
    const EW = 2048, EH = 1427;
    try { await document.fonts.load(`700 14px 'Oswald'`); } catch { /* ok */ }

    const out = document.createElement('canvas');
    out.width = EW; out.height = EH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, EW, EH);

    // 1) Map snapshot with crop or auto-letterbox
    if (this.mapSnapshot) {
      const img = await loadImage(this.mapSnapshot);
      const mx = EW * MAP_VP.left   / 100;
      const my = EH * MAP_VP.top    / 100;
      const mw = EW * MAP_VP.width  / 100;
      const mh = EH * MAP_VP.height / 100;

      if (this.cropBox) {
        const dpr = window.devicePixelRatio || 1;
        ctx.drawImage(img,
          this.cropBox.x * dpr, this.cropBox.y * dpr,
          this.cropBox.w * dpr, this.cropBox.h * dpr,
          mx, my, mw, mh);
      } else {
        // Auto letterbox-crop to avoid squish
        const tgtAR = mw / mh;
        const imgAR = img.naturalWidth / img.naturalHeight;
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (imgAR > tgtAR) { sw = sh * tgtAR; sx = (img.naturalWidth - sw) / 2; }
        else               { sh = sw / tgtAR; sy = (img.naturalHeight - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, mx, my, mw, mh);
      }
    }

    // 2) Template overlay
    if (!this.templateMissing) {
      try {
        const tmpl = await loadImage(TEMPLATE_URL);
        ctx.drawImage(tmpl, 0, 0, EW, EH);
      } catch { /* no template */ }
    }

    // 3) Text fields
    const scaleX = this.sheetBaseW ? EW / this.sheetBaseW : 1;
    const scaleY = this.sheetBaseH ? EH / this.sheetBaseH : 1;

    for (const f of FIELDS) {
      const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${f.id}`);
      const rawText = el?.innerText?.trim() ?? '';
      if (!rawText) continue;
      const s = this.fieldStyles.get(f.id)!;
      const x = EW * f.left   / 100;
      const y = EH * f.top    / 100;
      const w = EW * f.width  / 100;
      const h = EH * f.height / 100;
      this.drawTextBlock(ctx, rawText, s, x, y, w, h);
    }

    // 4) Annotations
    for (const [, anno] of this.annotations) {
      const content = this.overlay?.querySelector<HTMLElement>(`#lm-a-${anno.id} .lm-anno-content`);
      const rawText = content?.innerText?.trim() ?? '';
      if (!rawText) continue;
      this.drawTextBlock(ctx, rawText, anno.style,
        anno.x * scaleX, anno.y * scaleY,
        anno.w * scaleX, anno.h * scaleY);
    }

    return out;
  }

  private drawTextBlock(ctx: CanvasRenderingContext2D, text: string, s: FieldStyle,
                        x: number, y: number, w: number, h: number): void {
    const pad = 4;
    const lineH = s.fontSize * 1.35;
    ctx.save();
    ctx.font = `${s.fontWeight} ${s.fontSize}px 'Oswald', sans-serif`;
    ctx.fillStyle = s.color;
    ctx.textAlign = s.textAlign as CanvasTextAlign;
    ctx.textBaseline = 'top';
    const tx = s.textAlign === 'center' ? x + w / 2 : s.textAlign === 'right' ? x + w - pad : x + pad;

    const lines: string[] = [];
    for (const sourceLine of text.split('\n')) {
      const words = sourceLine.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let cur = '';
      for (const word of words) {
        const test = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(test).width > w - pad * 2 && cur) { lines.push(cur); cur = word; }
        else cur = test;
      }
      if (cur) lines.push(cur);
    }

    let ty = y + pad;
    for (const line of lines) {
      if (ty + lineH > y + h) break;
      ctx.fillText(line, tx, ty);
      ty += lineH;
    }
    ctx.restore();
  }

  async exportPNG(): Promise<void> {
    EventBus.emit('toast', { message: 'Generating PNG…', type: 'info', duration: 1500 });
    try {
      const canvas = await this.buildExportCanvas();
      const a = document.createElement('a');
      a.download = `fraxinus_layout_${datestamp()}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      EventBus.emit('toast', { message: 'Layout exported as PNG', type: 'success', duration: 2500 });
    } catch (err) {
      EventBus.emit('toast', { message: `Export failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  async exportPDF(): Promise<void> {
    EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 2000 });
    try {
      const canvas = await this.buildExportCanvas();
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const { default: jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      doc.addImage(imgData, 'JPEG', 0, 0, pw, ph);
      doc.save(`fraxinus_layout_${datestamp()}.pdf`);
      EventBus.emit('toast', { message: 'PDF downloaded', type: 'success', duration: 2500 });
    } catch (err) {
      EventBus.emit('toast', { message: `PDF failed: ${(err as Error).message}`, type: 'error' });
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

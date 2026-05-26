import { EventBus } from '../utils/EventBus';
import TEMPLATE_URL from '../assets/titleblock_template_transparent.png';
import { LayoutExtentSelector, type CropBox } from './LayoutExtentSelector';

// ── Interfaces ────────────────────────────────────────────────

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

export interface MapState {
  zoom: number;
  lat: number;
  lng: number;
  bearing: number;
  canvasW: number;
  canvasH: number;
}

interface ExportSettings {
  dpi: number;
  paperSize: string;
  landscape: boolean;
}

// ── Constants ─────────────────────────────────────────────────

const LS_KEY     = 'fraxinus_layout_state';
const LS_EXP_KEY = 'fraxinus_layout_export_settings';

const PAPER_SIZES: Record<string, { w: number; h: number; label: string }> = {
  tabloid: { w: 11,    h: 17,    label: '11×17 (Tabloid)' },
  letter:  { w: 8.5,  h: 11,    label: 'Letter (8.5×11)' },
  legal:   { w: 8.5,  h: 14,    label: 'Legal (8.5×14)' },
  a4:      { w: 8.27, h: 11.69, label: 'A4' },
  a3:      { w: 11.69,h: 16.54, label: 'A3' },
};

// Map viewport within the sheet (percentage of canvas dimensions)
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

// ── Class ────────────────────────────────────────────────────

export class LayoutMode {
  private overlay: HTMLElement | null = null;
  private isActive = false;
  private isEditExtentMode = false;
  private fieldStyles = new Map<string, FieldStyle>();
  private selectedFieldId: string | null = null;
  private mapSnapshot: string | null = null;
  private templateMissing = false;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private cropBox: CropBox | null = null;
  private mapState: MapState | null = null;

  // Zoom / pan state
  private scale = 1.0;
  private panX = 0;
  private panY = 0;
  private sheetBaseW = 0;
  private sheetBaseH = 0;

  // Annotations
  private annotations = new Map<string, AnnoState>();
  private annoCounter = 0;

  // Export settings
  private exportSettings: ExportSettings = { dpi: 200, paperSize: 'tabloid', landscape: true };
  private showScaleBar = false;
  private showNorthArrow = false;
  private useVectorLayout = false;

  constructor(
    private getMapCanvas: () => HTMLCanvasElement,
    private getMapStateFn?: () => MapState,
    private getHighResSnapshot?: () => Promise<string>,
  ) {
    for (const f of FIELDS) {
      this.fieldStyles.set(f.id, {
        fontWeight: f.defaultWeight,
        fontSize: f.defaultFontSize,
        color: '#1a1a1a',
        textAlign: f.defaultAlign,
      });
    }
    this.loadExportSettings();
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
    this.isEditExtentMode = false;
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

    // Capture map state for scale bar / north arrow
    if (this.getMapStateFn) {
      try { this.mapState = this.getMapStateFn(); } catch { this.mapState = null; }
    }

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

    // Hide raster template when in vector layout mode
    if (this.useVectorLayout && tmplImg) tmplImg.style.display = 'none';

    requestAnimationFrame(() => {
      const sheet = this.overlay?.querySelector<HTMLElement>('#lm-sheet');
      if (sheet) {
        this.sheetBaseW = sheet.offsetWidth;
        this.sheetBaseH = sheet.offsetHeight;
        this.fitSheet();
      }
      this.restoreState();
      this.updateVectorOverlay();
    });
  }

  private buildHTML(): string {
    const ps = PAPER_SIZES;
    const paperOpts = Object.entries(ps)
      .map(([k, v]) => `<option value="${k}" ${k === this.exportSettings.paperSize ? 'selected' : ''}>${v.label}</option>`)
      .join('');

    return `
      <div id="lm-toolbar">
        <div class="lm-tb-section">
          <span class="lm-title-badge">
            <svg viewBox="0 0 20 20" fill="currentColor" width="15" height="15"><rect x="2" y="2" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="13" y="2" width="5" height="16" rx="0" fill="currentColor" opacity=".25"/><rect x="5" y="5" width="6" height="1.2" rx=".5"/><rect x="5" y="8" width="4" height="1.2" rx=".5"/></svg>
            Layout
          </span>
        </div>

        <div class="lm-tb-section lm-field-section">
          <span class="lm-tb-dimmed" id="lm-field-name">Click a field</span>
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

        <div class="lm-tb-section lm-export-settings-section">
          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Paper</label>
            <select id="lm-paper-size" class="lm-select">${paperOpts}</select>
          </div>
          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">DPI</label>
            <input type="number" id="lm-dpi" class="lm-select lm-dpi-input"
              value="${this.exportSettings.dpi}" min="72" max="600" step="50" title="Export resolution (DPI)" />
          </div>
          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Orient</label>
            <button class="lm-icon-btn lm-orient-btn ${this.exportSettings.landscape ? 'lm-btn-active' : ''}" id="lm-orient" title="Toggle landscape/portrait">
              ${this.exportSettings.landscape ? 'Land' : 'Port'}
            </button>
          </div>
        </div>

        <div class="lm-tb-section lm-map-options-section">
          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Map Options</label>
            <div class="lm-align-row">
              <button class="lm-icon-btn lm-toggle-btn ${this.showScaleBar ? 'lm-btn-active' : ''}" id="lm-toggle-scalebar" title="Toggle scale bar">
                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><rect x="1" y="7" width="14" height="2" rx=".5"/><rect x="1" y="5" width="2" height="6" rx=".5"/><rect x="13" y="5" width="2" height="6" rx=".5"/><rect x="7" y="6" width="2" height="4" rx=".5"/></svg>
              </button>
              <button class="lm-icon-btn lm-toggle-btn ${this.showNorthArrow ? 'lm-btn-active' : ''}" id="lm-toggle-northarrow" title="Toggle north arrow">
                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M8 2l3 9-3-2-3 2z"/><path d="M8 14V9" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
              </button>
              <button class="lm-icon-btn lm-toggle-btn ${this.useVectorLayout ? 'lm-btn-active' : ''}" id="lm-toggle-vector" title="Toggle vector layout (SVG title block)">
                <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="1" width="5" height="14" fill="currentColor" opacity=".2"/><line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" stroke-width="1"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div class="lm-tb-section">
          <button class="lm-icon-btn lm-toggle-btn ${this.isEditExtentMode ? 'lm-btn-active' : ''}" id="lm-edit-extent" title="Pan &amp; zoom the live map to update the layout extent">
            <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><rect x="1" y="1" width="14" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 8h6M8 5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="8" r="2.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>
            Map Extent
          </button>
          <button class="lm-action-btn lm-capture-btn" id="lm-capture-extent" title="Capture current map view as layout extent" style="display:${this.isEditExtentMode ? 'flex' : 'none'}">
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>
            Capture
          </button>
        </div>

        <div class="lm-tb-section lm-actions-section">
          <button class="lm-action-btn lm-anno-btn" id="lm-add-anno" title="Add free text annotation">
            <svg viewBox="0 0 18 18" fill="currentColor" width="13" height="13"><path d="M3 14l2-5L12 2l3 3-7 7-5 2zm2-5l3 3"/></svg>
            Text
          </button>
          <button class="lm-action-btn lm-export-btn" id="lm-export-png">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 9 3zm-.5 3v3.3H6l3 3.7 3-3.7H9.5V6h-1z"/></svg>
            PNG
          </button>
          <button class="lm-action-btn lm-export-btn" id="lm-export-pdf">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M4 2h7l3 3v11H4V2zm7 0v3h3M7 9h4M7 12h4M7 6h2"/></svg>
            PDF
          </button>
          <button class="lm-action-btn lm-export-btn lm-svg-btn" id="lm-export-svg" title="Export as vector SVG">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><rect x="2" y="2" width="14" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 11l3-6 3 6" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="5.5" y1="9.5" x2="10.5" y2="9.5" stroke="currentColor" stroke-width="1"/></svg>
            SVG
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
          <img id="lm-template" alt="" style="${this.useVectorLayout ? 'display:none;' : ''}" />
          <div id="lm-vector-overlay" style="display:${this.useVectorLayout ? 'block' : 'none'};position:absolute;inset:0;pointer-events:none;"></div>
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
      if (e.key === 'Escape') {
        if (this.isEditExtentMode) { this.exitEditExtentMode(); return; }
        this.close();
      }
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

    // Paper size
    const paperSel = ov.querySelector<HTMLSelectElement>('#lm-paper-size');
    paperSel?.addEventListener('change', () => {
      this.exportSettings.paperSize = paperSel.value;
      this.saveExportSettings();
    });

    // DPI
    const dpiInput = ov.querySelector<HTMLInputElement>('#lm-dpi');
    dpiInput?.addEventListener('change', () => {
      const v = parseInt(dpiInput.value, 10);
      if (v >= 72 && v <= 600) {
        this.exportSettings.dpi = v;
        this.saveExportSettings();
      }
    });

    // Orientation
    ov.querySelector('#lm-orient')?.addEventListener('click', () => {
      this.exportSettings.landscape = !this.exportSettings.landscape;
      this.saveExportSettings();
      const btn = ov.querySelector<HTMLElement>('#lm-orient');
      if (btn) {
        btn.textContent = this.exportSettings.landscape ? 'Land' : 'Port';
        btn.classList.toggle('lm-btn-active', this.exportSettings.landscape);
      }
    });

    // Scale bar toggle
    ov.querySelector('#lm-toggle-scalebar')?.addEventListener('click', () => {
      this.showScaleBar = !this.showScaleBar;
      ov.querySelector('#lm-toggle-scalebar')?.classList.toggle('lm-btn-active', this.showScaleBar);
      this.saveExportSettings();
    });

    // North arrow toggle
    ov.querySelector('#lm-toggle-northarrow')?.addEventListener('click', () => {
      this.showNorthArrow = !this.showNorthArrow;
      ov.querySelector('#lm-toggle-northarrow')?.classList.toggle('lm-btn-active', this.showNorthArrow);
      this.saveExportSettings();
    });

    // Vector layout toggle
    ov.querySelector('#lm-toggle-vector')?.addEventListener('click', () => {
      this.useVectorLayout = !this.useVectorLayout;
      ov.querySelector('#lm-toggle-vector')?.classList.toggle('lm-btn-active', this.useVectorLayout);
      const tmpl = ov.querySelector<HTMLElement>('#lm-template');
      if (tmpl) tmpl.style.display = this.useVectorLayout ? 'none' : '';
      const vecOv = ov.querySelector<HTMLElement>('#lm-vector-overlay');
      if (vecOv) vecOv.style.display = this.useVectorLayout ? 'block' : 'none';
      this.updateVectorOverlay();
      this.saveExportSettings();
    });

    // Map extent mode
    ov.querySelector('#lm-edit-extent')?.addEventListener('click', () => this.toggleEditExtentMode());
    ov.querySelector('#lm-capture-extent')?.addEventListener('click', () => this.captureExtent());

    // Annotation add
    ov.querySelector('#lm-add-anno')?.addEventListener('click', () => this.addAnnotationAtCenter());

    // Exports
    ov.querySelector('#lm-export-png')?.addEventListener('click', () => void this.exportPNG());
    ov.querySelector('#lm-export-pdf')?.addEventListener('click', () => void this.exportPDF());
    ov.querySelector('#lm-export-svg')?.addEventListener('click', () => void this.exportSVG());

    // Workspace pan + pinch zoom
    const workspace = ov.querySelector<HTMLElement>('#lm-workspace')!;
    this.wireWorkspacePan(workspace);
  }

  private wireWorkspacePan(workspace: HTMLElement): void {
    const activePointers = new Map<number, { x: number; y: number }>();
    let panStartX = 0, panStartY = 0;
    let panOriginX = 0, panOriginY = 0;
    let pinchOriginScale = 1;
    let pinchOriginDist = 0;

    const pointerDist = () => {
      const pts = [...activePointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    workspace.addEventListener('pointerdown', (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lm-field, .lm-anno-content, .lm-anno-resize, .lm-anno-delete')) return;
      e.preventDefault();
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      workspace.setPointerCapture(e.pointerId);

      if (activePointers.size === 1) {
        panStartX = e.clientX;
        panStartY = e.clientY;
        panOriginX = this.panX;
        panOriginY = this.panY;
        workspace.classList.add('is-panning');
      } else if (activePointers.size === 2) {
        // Switch to pinch mode
        pinchOriginScale = this.scale;
        pinchOriginDist = pointerDist();
        workspace.classList.remove('is-panning');
        workspace.classList.add('is-pinching');
      }
    });

    workspace.addEventListener('pointermove', (e: PointerEvent) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 1) {
        this.panX = panOriginX + (e.clientX - panStartX);
        this.panY = panOriginY + (e.clientY - panStartY);
        this.applyTransform();
      } else if (activePointers.size === 2) {
        const d = pointerDist();
        if (pinchOriginDist > 0) {
          this.scale = Math.max(0.15, Math.min(4.0, pinchOriginScale * (d / pinchOriginDist)));
          this.applyTransform();
        }
      }
    });

    const onRelease = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 0) {
        workspace.classList.remove('is-panning', 'is-pinching');
      } else if (activePointers.size === 1) {
        // Remaining finger becomes new pan anchor
        const [id, pos] = [...activePointers.entries()][0];
        panStartX = pos.x;
        panStartY = pos.y;
        panOriginX = this.panX;
        panOriginY = this.panY;
        workspace.classList.remove('is-pinching');
        workspace.classList.add('is-panning');
        void id;
      }
    };

    workspace.addEventListener('pointerup', onRelease);
    workspace.addEventListener('pointercancel', onRelease);

    // Desktop wheel zoom
    workspace.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.15, Math.min(4.0, this.scale * factor));
      this.applyTransform();
    }, { passive: false });
  }

  // ── Map extent editing ────────────────────────────────────────

  private toggleEditExtentMode(): void {
    this.isEditExtentMode = !this.isEditExtentMode;
    const ov = this.overlay;
    if (!ov) return;

    const btn = ov.querySelector<HTMLElement>('#lm-edit-extent');
    const captureBtn = ov.querySelector<HTMLElement>('#lm-capture-extent');

    if (this.isEditExtentMode) {
      // Allow pointer events to pass through to the live map beneath
      ov.style.pointerEvents = 'none';
      // Re-enable pointer events on toolbar and capture button
      const toolbar = ov.querySelector<HTMLElement>('#lm-toolbar');
      if (toolbar) toolbar.style.pointerEvents = 'all';
      if (captureBtn) { captureBtn.style.pointerEvents = 'all'; captureBtn.style.display = 'flex'; }
      // Dim the snapshot to show the live map beneath
      const snap = ov.querySelector<HTMLElement>('#lm-map-snapshot');
      if (snap) snap.style.opacity = '0.15';
      const sheet = ov.querySelector<HTMLElement>('#lm-sheet');
      if (sheet) sheet.classList.add('lm-extent-mode');
      btn?.classList.add('lm-btn-active');
      EventBus.emit('toast', { message: 'Pan & zoom the map, then click Capture', type: 'info', duration: 3000 });
    } else {
      this.exitEditExtentMode();
    }
  }

  private exitEditExtentMode(): void {
    this.isEditExtentMode = false;
    const ov = this.overlay;
    if (!ov) return;
    ov.style.pointerEvents = '';
    const toolbar = ov.querySelector<HTMLElement>('#lm-toolbar');
    if (toolbar) toolbar.style.pointerEvents = '';
    const captureBtn = ov.querySelector<HTMLElement>('#lm-capture-extent');
    if (captureBtn) { captureBtn.style.display = 'none'; captureBtn.style.pointerEvents = ''; }
    const snap = ov.querySelector<HTMLElement>('#lm-map-snapshot');
    if (snap) snap.style.opacity = '';
    const sheet = ov.querySelector<HTMLElement>('#lm-sheet');
    if (sheet) sheet.classList.remove('lm-extent-mode');
    ov.querySelector('#lm-edit-extent')?.classList.remove('lm-btn-active');
  }

  private captureExtent(): void {
    try {
      this.mapSnapshot = this.getMapCanvas().toDataURL('image/png');
      if (this.getMapStateFn) {
        try { this.mapState = this.getMapStateFn(); } catch { /* ok */ }
      }
      const snap = this.overlay?.querySelector<HTMLImageElement>('#lm-map-snapshot');
      if (snap) snap.src = this.mapSnapshot;
      this.cropBox = null; // clear any prior crop — full new view
      this.exitEditExtentMode();
      EventBus.emit('toast', { message: 'Map extent updated', type: 'success', duration: 1500 });
    } catch (err) {
      EventBus.emit('toast', { message: `Capture failed: ${(err as Error).message}`, type: 'error' });
      this.exitEditExtentMode();
    }
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

  // ── Vector overlay ────────────────────────────────────────────

  private updateVectorOverlay(): void {
    const vecOv = this.overlay?.querySelector<HTMLElement>('#lm-vector-overlay');
    if (!vecOv || !this.useVectorLayout) return;
    const sheet = this.overlay?.querySelector<HTMLElement>('#lm-sheet');
    if (!sheet) return;
    const W = sheet.offsetWidth || 1746;
    const H = sheet.offsetHeight || 1240;
    vecOv.innerHTML = this.buildTitleBlockSVGPreview(W, H);
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

    el.querySelector('.lm-anno-content')?.addEventListener('focus', () => this.selectField(anno.id));
    el.querySelector('.lm-anno-content')?.addEventListener('blur',  () => this.saveState());
    el.querySelector('.lm-anno-content')?.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); document.execCommand('insertLineBreak'); }
    });

    el.querySelector('.lm-anno-delete')?.addEventListener('click', () => this.deleteAnnotation(anno.id));

    this.wireAnnoDrag(el, anno);
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
        nameEl.textContent = 'Click a field';
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

  private saveExportSettings(): void {
    try {
      localStorage.setItem(LS_EXP_KEY, JSON.stringify({
        ...this.exportSettings,
        showScaleBar: this.showScaleBar,
        showNorthArrow: this.showNorthArrow,
        useVectorLayout: this.useVectorLayout,
      }));
    } catch { /* ok */ }
  }

  private loadExportSettings(): void {
    try {
      const raw = localStorage.getItem(LS_EXP_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.dpi)        this.exportSettings.dpi        = saved.dpi;
      if (saved.paperSize)  this.exportSettings.paperSize  = saved.paperSize;
      if ('landscape' in saved) this.exportSettings.landscape = saved.landscape;
      if ('showScaleBar'   in saved) this.showScaleBar    = saved.showScaleBar;
      if ('showNorthArrow' in saved) this.showNorthArrow  = saved.showNorthArrow;
      if ('useVectorLayout' in saved) this.useVectorLayout = saved.useVectorLayout;
    } catch { /* ok */ }
  }

  // ── Export dimensions ─────────────────────────────────────────

  private getExportDimensions(): { EW: number; EH: number } {
    const ps = PAPER_SIZES[this.exportSettings.paperSize] ?? PAPER_SIZES.tabloid;
    let w = Math.round(ps.w * this.exportSettings.dpi);
    let h = Math.round(ps.h * this.exportSettings.dpi);
    if (this.exportSettings.landscape) {
      return { EW: Math.max(w, h), EH: Math.min(w, h) };
    }
    return { EW: Math.min(w, h), EH: Math.max(w, h) };
  }

  // ── Export ────────────────────────────────────────────────────

  private async buildExportCanvas(mapSrc?: string): Promise<HTMLCanvasElement> {
    const { EW, EH } = this.getExportDimensions();
    try { await document.fonts.load(`700 14px 'Oswald'`); } catch { /* ok */ }

    const out = document.createElement('canvas');
    out.width = EW; out.height = EH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, EW, EH);

    const snapshot = mapSrc ?? this.mapSnapshot;
    const mx = EW * MAP_VP.left   / 100;
    const my = EH * MAP_VP.top    / 100;
    const mw = EW * MAP_VP.width  / 100;
    const mh = EH * MAP_VP.height / 100;

    // 1) Map snapshot with crop or auto-letterbox
    if (snapshot) {
      const img = await loadImage(snapshot);
      if (this.cropBox) {
        const dpr = window.devicePixelRatio || 1;
        ctx.drawImage(img,
          this.cropBox.x * dpr, this.cropBox.y * dpr,
          this.cropBox.w * dpr, this.cropBox.h * dpr,
          mx, my, mw, mh);
      } else {
        const tgtAR = mw / mh;
        const imgAR = img.naturalWidth / img.naturalHeight;
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (imgAR > tgtAR) { sw = sh * tgtAR; sx = (img.naturalWidth - sw) / 2; }
        else               { sh = sw / tgtAR; sy = (img.naturalHeight - sh) / 2; }
        ctx.drawImage(img, sx, sy, sw, sh, mx, my, mw, mh);
      }
    }

    // 2) Scale bar (over map)
    if (this.showScaleBar) this.drawScaleBar(ctx, mx, my, mw, mh);

    // 3) North arrow (over map)
    if (this.showNorthArrow) this.drawNorthArrow(ctx, mx, my, mw, mh);

    // 4) Template overlay (raster mode) or vector title block
    if (this.useVectorLayout) {
      this.drawVectorTitleBlock(ctx, EW, EH);
    } else if (!this.templateMissing) {
      try {
        const tmpl = await loadImage(TEMPLATE_URL);
        ctx.drawImage(tmpl, 0, 0, EW, EH);
      } catch { /* no template */ }
    }

    // 5) Text fields
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

    // 6) Annotations
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

  // ── Scale bar ─────────────────────────────────────────────────

  private drawScaleBar(ctx: CanvasRenderingContext2D, mx: number, my: number, mw: number, mh: number): void {
    if (!this.mapState) return;

    const dpr = window.devicePixelRatio || 1;
    const { zoom, lat, canvasW } = this.mapState;
    const containerW = canvasW / dpr;

    // Meters per CSS pixel at this zoom and latitude
    const metersPerContainerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    // Meters per export pixel in the map frame
    const displayedCssW = this.cropBox ? this.cropBox.w : containerW;
    const metersPerExportPx = metersPerContainerPx * displayedCssW / mw;

    // Choose a round bar distance (~20% of frame width)
    const targetMeters = mw * 0.18 * metersPerExportPx;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetMeters, 1))));
    const multiples = [1, 2, 5, 10];
    let niceMeters = magnitude;
    for (const m of multiples) {
      if (magnitude * m <= targetMeters * 1.4) niceMeters = magnitude * m;
    }

    const barPx = niceMeters / metersPerExportPx;
    const label = niceMeters >= 1000 ? `${niceMeters / 1000} km` : `${Math.round(niceMeters)} m`;

    const barX = mx + 14;
    const barY = my + mh - 32;
    const barH = 7;

    // White backing
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(ctx, barX - 6, barY - 18, barPx + 20, barH + 26, 3);
    ctx.fill();

    // Alternating segments
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barPx / 2, barH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(barX + barPx / 2, barY, barPx / 2, barH);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barPx, barH);

    // End ticks
    ctx.beginPath();
    ctx.moveTo(barX, barY - 3); ctx.lineTo(barX, barY + barH + 3);
    ctx.moveTo(barX + barPx / 2, barY + 1); ctx.lineTo(barX + barPx / 2, barY + barH - 1);
    ctx.moveTo(barX + barPx, barY - 3); ctx.lineTo(barX + barPx, barY + barH + 3);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#222';
    ctx.font = `bold ${Math.max(9, mw * 0.008)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('0', barX, barY - 1);
    ctx.fillText(label, barX + barPx, barY - 1);
    ctx.restore();
  }

  // ── North arrow ────────────────────────────────────────────────

  private drawNorthArrow(ctx: CanvasRenderingContext2D, mx: number, my: number, mw: number, _mh: number): void {
    const bearing = this.mapState?.bearing ?? 0;
    const r = Math.max(18, mw * 0.018);
    const cx = mx + mw - r - 14;
    const cy = my + r + 14;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((bearing * Math.PI) / 180);

    // Background circle
    ctx.beginPath();
    ctx.arc(0, 0, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();

    // North half (dark)
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.38, 0);
    ctx.lineTo(0, -r * 0.18);
    ctx.closePath();
    ctx.fillStyle = '#222';
    ctx.fill();

    // South half (white with outline)
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.lineTo(r * 0.38, 0);
    ctx.lineTo(0, -r * 0.18);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();

    // "N" label above arrow (not rotated)
    ctx.save();
    const fontSize = Math.max(9, r * 0.7);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', cx, cy - r - 4);
    ctx.restore();
  }

  // ── Vector title block (canvas draw) ─────────────────────────

  private drawVectorTitleBlock(ctx: CanvasRenderingContext2D, EW: number, EH: number): void {
    const divX = EW * (MAP_VP.left + MAP_VP.width) / 100;
    const tbW  = EW - divX;

    ctx.save();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#f8f8f8';

    // Right sidebar background
    ctx.fillRect(divX, 0, tbW, EH);

    // Outer page border
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, EW - 2, EH - 2);

    // Vertical divider
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(divX, 0); ctx.lineTo(divX, EH);
    ctx.stroke();

    ctx.lineWidth = 0.75;
    ctx.strokeStyle = '#555';

    const hLine = (pct: number) => {
      const y = EH * pct / 100;
      ctx.beginPath();
      ctx.moveTo(divX, y); ctx.lineTo(EW, y);
      ctx.stroke();
    };

    // Horizontal dividers
    hLine(12);    // top of legend
    hLine(46);    // bottom of legend
    hLine(52.9);  // top of title
    hLine(62.1);  // bottom of title
    hLine(62.85); // info rows start
    hLine(64.4);
    hLine(65.95);
    hLine(67.5);
    hLine(69.05);
    hLine(70.5);  // end of info rows
    hLine(83.1);  // notes
    hLine(91.3);  // end of notes
    hLine(93.0);  // params

    // Vertical sub-divider in info rows (label | value | figure)
    const infoL = 90.43, figL = 93.25;
    const rowTop = EH * 62.85 / 100, rowBot = EH * 70.5 / 100;
    ctx.beginPath();
    ctx.moveTo(EW * infoL / 100, rowTop); ctx.lineTo(EW * infoL / 100, rowBot);
    ctx.moveTo(EW * figL  / 100, rowTop); ctx.lineTo(EW * figL  / 100, rowBot);
    ctx.stroke();

    // Label text for info rows
    const labelStyle: FieldStyle = { fontWeight: '400', fontSize: Math.max(7, EH * 0.008), color: '#666', textAlign: 'left' };
    const infoLabels = [
      { label: 'Project', pct: 62.85 },
      { label: 'Drawn',   pct: 64.40 },
      { label: 'Checked', pct: 65.95 },
      { label: 'Approved',pct: 67.50 },
      { label: 'Date',    pct: 69.05 },
    ];
    for (const row of infoLabels) {
      const ry = EH * row.pct / 100;
      const rh = EH * 1.45 / 100;
      this.drawTextBlock(ctx, row.label, labelStyle, divX + 2, ry + 1, EW * (infoL - MAP_VP.left - MAP_VP.width) / 100 - 4, rh);
    }

    // Section labels
    const secStyle: FieldStyle = { fontWeight: '300', fontSize: Math.max(7, EH * 0.007), color: '#888', textAlign: 'left' };
    this.drawTextBlock(ctx, 'LEGEND / MAP NOTES', secStyle, divX + 3, EH * 12 / 100 + 2, tbW - 6, EH * 0.02);
    this.drawTextBlock(ctx, 'MAP TITLE', secStyle, divX + 3, EH * 52.9 / 100 + 2, tbW - 6, EH * 0.02);
    this.drawTextBlock(ctx, 'NOTES', secStyle, divX + 3, EH * 83.1 / 100 + 2, tbW - 6, EH * 0.02);
    this.drawTextBlock(ctx, 'MAP PARAMETERS', secStyle, divX + 3, EH * 93 / 100 + 2, tbW - 6, EH * 0.02);

    ctx.restore();
  }

  // ── Vector title block (SVG preview) ─────────────────────────

  private buildTitleBlockSVGPreview(W: number, H: number): string {
    const divX = W * (MAP_VP.left + MAP_VP.width) / 100;
    const tbW  = W - divX;
    const parts: string[] = [];

    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="pointer-events:none">`);
    parts.push(`<rect x="${divX}" y="0" width="${tbW}" height="${H}" fill="#f8f8f8" stroke="none"/>`);
    parts.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="none" stroke="#222" stroke-width="2"/>`);
    parts.push(`<line x1="${divX}" y1="0" x2="${divX}" y2="${H}" stroke="#333" stroke-width="1.5"/>`);

    const lines = [12, 46, 52.9, 62.1, 62.85, 64.4, 65.95, 67.5, 69.05, 70.5, 83.1, 91.3, 93.0];
    for (const pct of lines) {
      const y = H * pct / 100;
      parts.push(`<line x1="${divX}" y1="${y}" x2="${W}" y2="${y}" stroke="#555" stroke-width="0.75"/>`);
    }

    const infoL = 90.43, figL = 93.25;
    const rowT = H * 62.85 / 100, rowB = H * 70.5 / 100;
    parts.push(`<line x1="${W * infoL / 100}" y1="${rowT}" x2="${W * infoL / 100}" y2="${rowB}" stroke="#555" stroke-width="0.75"/>`);
    parts.push(`<line x1="${W * figL  / 100}" y1="${rowT}" x2="${W * figL  / 100}" y2="${rowB}" stroke="#555" stroke-width="0.75"/>`);

    const labelRows = [
      { t: 'Project', p: 62.85 }, { t: 'Drawn', p: 64.4 }, { t: 'Checked', p: 65.95 },
      { t: 'Approved', p: 67.5 }, { t: 'Date', p: 69.05 },
    ];
    for (const r of labelRows) {
      parts.push(`<text x="${divX + 3}" y="${H * r.p / 100 + H * 0.009}" font-size="${Math.max(6, H * 0.007)}" fill="#888" font-family="sans-serif">${r.t}</text>`);
    }

    const secs = [
      { t: 'LEGEND / MAP NOTES', p: 12 }, { t: 'MAP TITLE', p: 52.9 },
      { t: 'NOTES', p: 83.1 }, { t: 'MAP PARAMETERS', p: 93 },
    ];
    for (const s of secs) {
      parts.push(`<text x="${divX + 3}" y="${H * s.p / 100 + H * 0.013}" font-size="${Math.max(5, H * 0.007)}" fill="#aaa" font-family="sans-serif" letter-spacing="0.05em">${s.t}</text>`);
    }

    parts.push('</svg>');
    return parts.join('');
  }

  // ── Text rendering ────────────────────────────────────────────

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

  // ── PNG Export ────────────────────────────────────────────────

  async exportPNG(): Promise<void> {
    EventBus.emit('toast', { message: 'Generating PNG…', type: 'info', duration: 1500 });
    try {
      let highRes: string | undefined;
      if (this.getHighResSnapshot) {
        try {
          highRes = await this.getHighResSnapshot();
        } catch { /* fall back to existing snapshot */ }
      }
      const canvas = await this.buildExportCanvas(highRes);
      const { EW, EH } = this.getExportDimensions();
      const ps = PAPER_SIZES[this.exportSettings.paperSize] ?? PAPER_SIZES.tabloid;
      const a = document.createElement('a');
      a.download = `fraxinus_layout_${datestamp()}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      EventBus.emit('toast', {
        message: `PNG exported (${EW}×${EH}px, ${this.exportSettings.dpi} DPI, ${ps.label})`,
        type: 'success', duration: 3000,
      });
    } catch (err) {
      EventBus.emit('toast', { message: `Export failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  // ── PDF Export ────────────────────────────────────────────────

  async exportPDF(): Promise<void> {
    EventBus.emit('toast', { message: 'Generating PDF…', type: 'info', duration: 2000 });
    try {
      let highRes: string | undefined;
      if (this.getHighResSnapshot) {
        try { highRes = await this.getHighResSnapshot(); } catch { /* ok */ }
      }
      const canvas = await this.buildExportCanvas(highRes);
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const { default: jsPDF } = await import('jspdf');

      const ps = PAPER_SIZES[this.exportSettings.paperSize] ?? PAPER_SIZES.tabloid;
      // jsPDF units in mm (1 inch = 25.4 mm)
      const wMM = ps.w * 25.4;
      const hMM = ps.h * 25.4;
      const [pw, ph] = this.exportSettings.landscape
        ? [Math.max(wMM, hMM), Math.min(wMM, hMM)]
        : [Math.min(wMM, hMM), Math.max(wMM, hMM)];

      const doc = new jsPDF({ orientation: this.exportSettings.landscape ? 'landscape' : 'portrait', unit: 'mm', format: [pw, ph] });
      doc.addImage(imgData, 'JPEG', 0, 0, pw, ph);
      doc.save(`fraxinus_layout_${datestamp()}.pdf`);
      EventBus.emit('toast', { message: `PDF downloaded (${ps.label}, ${this.exportSettings.dpi} DPI)`, type: 'success', duration: 3000 });
    } catch (err) {
      EventBus.emit('toast', { message: `PDF failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  // ── SVG Export ────────────────────────────────────────────────

  async exportSVG(): Promise<void> {
    EventBus.emit('toast', { message: 'Generating SVG…', type: 'info', duration: 1500 });
    try {
      const { EW, EH } = this.getExportDimensions();
      const svg = await this.buildExportSVG(EW, EH);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.download = `fraxinus_layout_${datestamp()}.svg`;
      a.href     = url;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      EventBus.emit('toast', { message: 'SVG exported (vector title block)', type: 'success', duration: 3000 });
    } catch (err) {
      EventBus.emit('toast', { message: `SVG failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  private async buildExportSVG(EW: number, EH: number): Promise<string> {
    const mx = EW * MAP_VP.left   / 100;
    const my = EH * MAP_VP.top    / 100;
    const mw = EW * MAP_VP.width  / 100;
    const mh = EH * MAP_VP.height / 100;

    const scaleX = this.sheetBaseW ? EW / this.sheetBaseW : 1;
    const scaleY = this.sheetBaseH ? EH / this.sheetBaseH : 1;

    const parts: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
      `  width="${EW}" height="${EH}" viewBox="0 0 ${EW} ${EH}">`,
      `<rect width="${EW}" height="${EH}" fill="white"/>`,
    ];

    // Map raster image
    if (this.mapSnapshot) {
      let clip = '';
      if (this.cropBox) {
        const dpr = window.devicePixelRatio || 1;
        const img = await loadImage(this.mapSnapshot);
        const iw = img.naturalWidth, ih = img.naturalHeight;
        // Build a cropped PNG via canvas
        const c = document.createElement('canvas');
        c.width = Math.round(this.cropBox.w * dpr);
        c.height = Math.round(this.cropBox.h * dpr);
        const cctx = c.getContext('2d')!;
        cctx.drawImage(img,
          this.cropBox.x * dpr, this.cropBox.y * dpr,
          this.cropBox.w * dpr, this.cropBox.h * dpr,
          0, 0, c.width, c.height);
        const cropped = c.toDataURL('image/png');
        parts.push(`<image x="${mx}" y="${my}" width="${mw}" height="${mh}" href="${cropped}" preserveAspectRatio="xMidYMid slice"/>`);
        void iw; void ih; void clip;
      } else {
        parts.push(`<image x="${mx}" y="${my}" width="${mw}" height="${mh}" href="${this.mapSnapshot}" preserveAspectRatio="xMidYMid slice"/>`);
      }
    }

    // Map border
    parts.push(`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="none" stroke="#333" stroke-width="1"/>`);

    // Scale bar (SVG)
    if (this.showScaleBar && this.mapState) {
      parts.push(this.buildScaleBarSVG(mx, my, mw, mh));
    }

    // North arrow (SVG)
    if (this.showNorthArrow) {
      parts.push(this.buildNorthArrowSVG(mx, my, mw, mh));
    }

    // Vector title block
    parts.push(this.buildTitleBlockSVGExport(EW, EH));

    // Text fields
    for (const f of FIELDS) {
      const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${f.id}`);
      const text = el?.innerText?.trim() ?? '';
      if (!text) continue;
      const s = this.fieldStyles.get(f.id)!;
      const x = EW * f.left   / 100;
      const y = EH * f.top    / 100;
      const w = EW * f.width  / 100;
      const h = EH * f.height / 100;
      parts.push(this.textToSVGGroup(text, s, x, y, w, h));
    }

    // Annotations
    for (const [, anno] of this.annotations) {
      const content = this.overlay?.querySelector<HTMLElement>(`#lm-a-${anno.id} .lm-anno-content`);
      const text = content?.innerText?.trim() ?? '';
      if (!text) continue;
      parts.push(this.textToSVGGroup(text, anno.style,
        anno.x * scaleX, anno.y * scaleY,
        anno.w * scaleX, anno.h * scaleY));
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  private buildTitleBlockSVGExport(EW: number, EH: number): string {
    const divX = EW * (MAP_VP.left + MAP_VP.width) / 100;
    const tbW  = EW - divX;
    const parts: string[] = [`<g id="title-block">`];

    parts.push(`<rect x="${divX}" y="0" width="${tbW}" height="${EH}" fill="#f8f8f8"/>`);
    parts.push(`<rect x="1" y="1" width="${EW - 2}" height="${EH - 2}" fill="none" stroke="#222" stroke-width="2"/>`);
    parts.push(`<line x1="${divX}" y1="0" x2="${divX}" y2="${EH}" stroke="#333" stroke-width="1.5"/>`);

    const hLines = [12, 46, 52.9, 62.1, 62.85, 64.4, 65.95, 67.5, 69.05, 70.5, 83.1, 91.3, 93.0];
    for (const p of hLines) {
      const y = EH * p / 100;
      parts.push(`<line x1="${divX}" y1="${y}" x2="${EW}" y2="${y}" stroke="#555" stroke-width="0.75"/>`);
    }

    const infoL = 90.43, figL = 93.25;
    const rowT = EH * 62.85 / 100, rowB = EH * 70.5 / 100;
    parts.push(`<line x1="${EW * infoL / 100}" y1="${rowT}" x2="${EW * infoL / 100}" y2="${rowB}" stroke="#555" stroke-width="0.75"/>`);
    parts.push(`<line x1="${EW * figL  / 100}" y1="${rowT}" x2="${EW * figL  / 100}" y2="${rowB}" stroke="#555" stroke-width="0.75"/>`);

    const fs = Math.max(7, EH * 0.008);
    const labelRows = [
      { t: 'Project #', p: 62.85 }, { t: 'Drawn',   p: 64.4  },
      { t: 'Checked',   p: 65.95 }, { t: 'Approved', p: 67.5 }, { t: 'Date', p: 69.05 },
    ];
    for (const r of labelRows) {
      const y = EH * r.p / 100 + fs + 1;
      parts.push(`<text x="${divX + 3}" y="${y}" font-size="${fs}" fill="#777" font-family="sans-serif">${xmlEsc(r.t)}</text>`);
    }

    const secs = [
      { t: 'LEGEND / MAP NOTES', p: 12 }, { t: 'MAP TITLE', p: 52.9 },
      { t: 'NOTES', p: 83.1 }, { t: 'MAP PARAMETERS', p: 93 },
    ];
    for (const s of secs) {
      const y = EH * s.p / 100 + fs + 1;
      parts.push(`<text x="${divX + 4}" y="${y}" font-size="${Math.max(6, fs * 0.85)}" fill="#aaa" font-family="sans-serif" letter-spacing="0.04em">${xmlEsc(s.t)}</text>`);
    }

    parts.push('</g>');
    return parts.join('\n');
  }

  private textToSVGGroup(text: string, s: FieldStyle, x: number, y: number, w: number, h: number): string {
    const pad = 4;
    const lineH = s.fontSize * 1.35;
    const lines = wrapTextSimple(text, w - pad * 2, s.fontSize);
    const anchor = s.textAlign === 'center' ? 'middle' : s.textAlign === 'right' ? 'end' : 'start';
    const tx = s.textAlign === 'center' ? x + w / 2 : s.textAlign === 'right' ? x + w - pad : x + pad;

    const svgLines: string[] = [];
    let ty = y + pad + s.fontSize;
    for (const line of lines) {
      if (ty > y + h) break;
      svgLines.push(
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" ` +
        `font-family="Oswald,sans-serif" font-size="${s.fontSize}" ` +
        `font-weight="${s.fontWeight}" fill="${s.color}" text-anchor="${anchor}">${xmlEsc(line)}</text>`
      );
      ty += lineH;
    }
    return svgLines.join('\n');
  }

  private buildScaleBarSVG(mx: number, my: number, mw: number, mh: number): string {
    if (!this.mapState) return '';
    const dpr = window.devicePixelRatio || 1;
    const { zoom, lat, canvasW } = this.mapState;
    const containerW = canvasW / dpr;
    const metersPerContainerPx = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    const displayedCssW = this.cropBox ? this.cropBox.w : containerW;
    const metersPerExportPx = metersPerContainerPx * displayedCssW / mw;
    const targetMeters = mw * 0.18 * metersPerExportPx;
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(targetMeters, 1))));
    let niceMeters = magnitude;
    for (const m of [1, 2, 5, 10]) {
      if (magnitude * m <= targetMeters * 1.4) niceMeters = magnitude * m;
    }
    const barPx = niceMeters / metersPerExportPx;
    const label = niceMeters >= 1000 ? `${niceMeters / 1000} km` : `${Math.round(niceMeters)} m`;
    const bx = mx + 14, by = my + mh - 32, bh = 7;
    const fs = Math.max(9, mw * 0.008);
    return `<g id="scale-bar">
  <rect x="${bx - 6}" y="${by - 18}" width="${barPx + 20}" height="${bh + 26}" rx="3" fill="rgba(255,255,255,0.88)"/>
  <rect x="${bx}" y="${by}" width="${barPx / 2}" height="${bh}" fill="#333"/>
  <rect x="${bx + barPx / 2}" y="${by}" width="${barPx / 2}" height="${bh}" fill="white" stroke="#333" stroke-width="1"/>
  <rect x="${bx}" y="${by}" width="${barPx}" height="${bh}" fill="none" stroke="#333" stroke-width="1"/>
  <line x1="${bx}" y1="${by - 3}" x2="${bx}" y2="${by + bh + 3}" stroke="#333" stroke-width="1"/>
  <line x1="${bx + barPx}" y1="${by - 3}" x2="${bx + barPx}" y2="${by + bh + 3}" stroke="#333" stroke-width="1"/>
  <text x="${bx}" y="${by - 2}" font-size="${fs}" fill="#222" font-family="sans-serif" font-weight="bold" text-anchor="middle">0</text>
  <text x="${bx + barPx}" y="${by - 2}" font-size="${fs}" fill="#222" font-family="sans-serif" font-weight="bold" text-anchor="middle">${xmlEsc(label)}</text>
</g>`;
  }

  private buildNorthArrowSVG(mx: number, my: number, mw: number, _mh: number): string {
    const bearing = this.mapState?.bearing ?? 0;
    const r = Math.max(18, mw * 0.018);
    const cx = mx + mw - r - 14;
    const cy = my + r + 14;
    const fs = Math.max(9, r * 0.7);
    return `<g id="north-arrow" transform="translate(${cx},${cy})">
  <circle r="${r + 3}" fill="rgba(255,255,255,0.9)" stroke="#555" stroke-width="1"/>
  <g transform="rotate(${bearing})">
    <path d="M0,${-r} L${r * 0.38},0 L0,${-r * 0.18} Z" fill="#222"/>
    <path d="M0,${r} L${r * 0.38},0 L0,${-r * 0.18} Z" fill="white" stroke="#555" stroke-width="0.8"/>
  </g>
  <text y="${-r - 4}" font-size="${fs}" fill="#222" font-family="sans-serif" font-weight="bold" text-anchor="middle">N</text>
</g>`;
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

function xmlEsc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function wrapTextSimple(text: string, maxW: number, fontSize: number): string[] {
  // Approximate character width for sans-serif
  const avgCharW = fontSize * 0.55;
  const maxChars = Math.max(1, Math.floor(maxW / avgCharW));
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const words = line.split(/\s+/).filter(Boolean);
    if (!words.length) { result.push(''); continue; }
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (test.length > maxChars && cur) { result.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) result.push(cur);
  }
  return result;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

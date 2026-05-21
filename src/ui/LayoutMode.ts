import { EventBus } from '../utils/EventBus';
import TEMPLATE_URL from '../assets/titleblock_template_transparent.png';

interface FieldDef {
  id: string;
  left: number;    // % of sheet width
  top: number;     // % of sheet height
  width: number;   // % of sheet width
  height: number;  // % of sheet height
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

// Map viewport bounds (% of full sheet) — matches FELT_Overlay02 template
const MAP_VP = { left: 0.78125, top: 1.40154, width: 85.25391, height: 97.47722 };

// Field positions matching the titleblock_template_transparent.png layout
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

export class LayoutMode {
  private overlay: HTMLElement | null = null;
  private isActive = false;
  private fieldStyles = new Map<string, FieldStyle>();
  private selectedFieldId: string | null = null;
  private mapSnapshot: string | null = null;
  private templateMissing = false;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

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

  open(): void {
    if (this.isActive) return;
    this.isActive = true;

    try {
      const canvas = this.getMapCanvas();
      // preserveDrawingBuffer must be true on MapLibre for this to work; fall back gracefully
      this.mapSnapshot = canvas.toDataURL('image/png');
    } catch {
      this.mapSnapshot = null;
    }

    this.render();
  }

  close(): void {
    if (!this.isActive) return;
    this.isActive = false;
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.selectedFieldId = null;
  }

  // ── DOM construction ──────────────────────────────────────────

  private render(): void {
    this.overlay = document.createElement('div');
    this.overlay.id = 'layout-mode-overlay';
    this.overlay.innerHTML = this.buildHTML();
    document.body.appendChild(this.overlay);
    this.wireEvents();
    // Set template src AFTER onerror is attached so we never miss a load failure
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
      tmplImg.src = TEMPLATE_URL; // set AFTER onerror so the event is never missed
    }
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
              <button class="lm-icon-btn lm-align-btn" data-align="left" id="lm-align-left" title="Left">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="1" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="1" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
              <button class="lm-icon-btn lm-align-btn" data-align="center" id="lm-align-center" title="Center">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="3" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="4.5" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
              <button class="lm-icon-btn lm-align-btn" data-align="right" id="lm-align-right" title="Right">
                <svg viewBox="0 0 14 14" fill="currentColor" width="13" height="13"><rect x="1" y="2" width="12" height="1.4" rx=".5"/><rect x="5" y="5.3" width="8" height="1.4" rx=".5"/><rect x="1" y="8.6" width="12" height="1.4" rx=".5"/><rect x="8" y="11.9" width="5" height="1.4" rx=".5"/></svg>
              </button>
            </div>
          </div>

          <div class="lm-ctrl-group">
            <label class="lm-ctrl-label">Color</label>
            <input type="color" id="lm-color" value="#1a1a1a" class="lm-color-swatch" title="Text color" />
          </div>
        </div>

        <div class="lm-tb-section lm-actions-section">
          <button class="lm-action-btn lm-export-btn" id="lm-export-png">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 9 3zm-.5 3v3.3H6l3 3.7 3-3.7H9.5V6h-1z"/></svg>
            PNG
          </button>
          <button class="lm-action-btn lm-export-btn" id="lm-export-pdf">
            <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><path d="M4 2h7l3 3v11H4V2zm7 0v3h3M7 9h4M7 12h4M7 6h2"/></svg>
            PDF
          </button>
          <button class="lm-action-btn lm-close-btn" id="lm-close" title="Exit Layout Mode (Esc)">
            ✕ Exit
          </button>
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

        <div id="lm-tmpl-notice" style="display:none">
          Template image not found. Place <code>titleblock_template_transparent.png</code> in the <code>/public</code> folder and reload.
        </div>
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

    // Close
    this.overlay.querySelector('#lm-close')?.addEventListener('click', () => this.close());

    this.escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.escHandler);

    // Field focus → select
    this.overlay.querySelectorAll<HTMLElement>('.lm-field').forEach(el => {
      el.addEventListener('focus', () => this.selectField(el.dataset.fid!));
      // Prevent Enter from creating <div> elements in contenteditable
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          document.execCommand('insertLineBreak');
        }
      });
    });

    // Font weight
    const weightSel = this.overlay.querySelector<HTMLSelectElement>('#lm-font-weight');
    weightSel?.addEventListener('change', () => this.applyProp('fontWeight', weightSel.value));

    // Size
    this.overlay.querySelector('#lm-size-inc')?.addEventListener('click', () => {
      if (!this.selectedFieldId) return;
      const cur = this.fieldStyles.get(this.selectedFieldId)!;
      this.applyProp('fontSize', String(Math.min(72, cur.fontSize + 1)));
    });
    this.overlay.querySelector('#lm-size-dec')?.addEventListener('click', () => {
      if (!this.selectedFieldId) return;
      const cur = this.fieldStyles.get(this.selectedFieldId)!;
      this.applyProp('fontSize', String(Math.max(6, cur.fontSize - 1)));
    });

    // Align
    this.overlay.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
      btn.addEventListener('click', () => this.applyProp('textAlign', btn.dataset.align!));
    });

    // Color
    const colorInput = this.overlay.querySelector<HTMLInputElement>('#lm-color');
    colorInput?.addEventListener('input', () => this.applyProp('color', colorInput.value));

    // Exports
    this.overlay.querySelector('#lm-export-png')?.addEventListener('click', () => void this.exportPNG());
    this.overlay.querySelector('#lm-export-pdf')?.addEventListener('click', () => void this.exportPDF());
  }

  // ── Field selection + style application ───────────────────────

  private selectField(id: string): void {
    this.selectedFieldId = id;
    const s = this.fieldStyles.get(id)!;

    // Update field name label
    const def = FIELDS.find(f => f.id === id);
    const nameEl = this.overlay?.querySelector('#lm-field-name');
    if (nameEl) {
      nameEl.textContent = def?.label ?? id;
      nameEl.classList.remove('lm-tb-dimmed');
      nameEl.classList.add('lm-tb-field-active');
    }

    // Sync toolbar
    const weightSel = this.overlay?.querySelector<HTMLSelectElement>('#lm-font-weight');
    if (weightSel) weightSel.value = s.fontWeight;

    const sizeDisplay = this.overlay?.querySelector('#lm-size-display');
    if (sizeDisplay) sizeDisplay.textContent = `${s.fontSize}px`;

    const colorInput = this.overlay?.querySelector<HTMLInputElement>('#lm-color');
    if (colorInput) colorInput.value = s.color;

    this.overlay?.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
      btn.classList.toggle('lm-btn-active', btn.dataset.align === s.textAlign);
    });

    // Highlight ring on selected field
    this.overlay?.querySelectorAll<HTMLElement>('.lm-field').forEach(el => {
      el.classList.toggle('lm-field--selected', el.dataset.fid === id);
    });
  }

  private applyProp(prop: 'fontWeight' | 'fontSize' | 'color' | 'textAlign', value: string): void {
    if (!this.selectedFieldId) return;
    const s = this.fieldStyles.get(this.selectedFieldId)!;

    if (prop === 'fontSize') {
      s.fontSize = parseInt(value, 10);
      const sizeDisplay = this.overlay?.querySelector('#lm-size-display');
      if (sizeDisplay) sizeDisplay.textContent = `${s.fontSize}px`;
    } else if (prop === 'fontWeight') {
      s.fontWeight = value;
    } else if (prop === 'color') {
      s.color = value;
    } else if (prop === 'textAlign') {
      s.textAlign = value;
      this.overlay?.querySelectorAll<HTMLElement>('.lm-align-btn').forEach(btn => {
        btn.classList.toggle('lm-btn-active', btn.dataset.align === value);
      });
    }

    this.fieldStyles.set(this.selectedFieldId, s);

    const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${this.selectedFieldId}`);
    if (el) {
      if (prop === 'fontSize')   el.style.fontSize   = `${s.fontSize}px`;
      if (prop === 'fontWeight') el.style.fontWeight = s.fontWeight;
      if (prop === 'color')      el.style.color      = s.color;
      if (prop === 'textAlign')  el.style.textAlign  = s.textAlign;
    }
  }

  // ── Export helpers ────────────────────────────────────────────

  private async buildExportCanvas(): Promise<HTMLCanvasElement> {
    const EW = 2048, EH = 1427;

    // Ensure Oswald is loaded for canvas rendering
    try { await document.fonts.load(`700 14px 'Oswald'`); } catch { /* ok */ }

    const out = document.createElement('canvas');
    out.width = EW;
    out.height = EH;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, EW, EH);

    // 1) Map snapshot
    if (this.mapSnapshot) {
      const img = await loadImage(this.mapSnapshot);
      const mx = EW * MAP_VP.left   / 100;
      const my = EH * MAP_VP.top    / 100;
      const mw = EW * MAP_VP.width  / 100;
      const mh = EH * MAP_VP.height / 100;
      ctx.drawImage(img, mx, my, mw, mh);
    }

    // 2) Title block template
    if (!this.templateMissing) {
      try {
        const tmpl = await loadImage(TEMPLATE_URL);
        ctx.drawImage(tmpl, 0, 0, EW, EH);
      } catch { /* no template found */ }
    }

    // 3) Text fields
    for (const f of FIELDS) {
      const el = this.overlay?.querySelector<HTMLElement>(`#lm-f-${f.id}`);
      const rawText = el?.innerText?.trim() ?? '';
      if (!rawText) continue;

      const s = this.fieldStyles.get(f.id)!;
      const x = EW * f.left   / 100;
      const y = EH * f.top    / 100;
      const w = EW * f.width  / 100;
      const h = EH * f.height / 100;
      const pad = 4;
      const lineH = s.fontSize * 1.35;

      ctx.save();
      ctx.font = `${s.fontWeight} ${s.fontSize}px 'Oswald', sans-serif`;
      ctx.fillStyle = s.color;
      ctx.textAlign = s.textAlign as CanvasTextAlign;
      ctx.textBaseline = 'top';

      const tx = s.textAlign === 'center' ? x + w / 2
               : s.textAlign === 'right'  ? x + w - pad
               : x + pad;

      // Word-wrap per line
      const lines: string[] = [];
      for (const sourceLine of rawText.split('\n')) {
        const words = sourceLine.split(/\s+/).filter(Boolean);
        if (words.length === 0) { lines.push(''); continue; }
        let cur = '';
        for (const word of words) {
          const test = cur ? `${cur} ${word}` : word;
          if (ctx.measureText(test).width > w - pad * 2 && cur) {
            lines.push(cur);
            cur = word;
          } else {
            cur = test;
          }
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

    return out;
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
    EventBus.emit('toast', { message: 'Preparing PDF…', type: 'info', duration: 1500 });
    try {
      const canvas = await this.buildExportCanvas();
      const dataUrl = canvas.toDataURL('image/png');

      const win = window.open('', '_blank');
      if (!win) {
        EventBus.emit('toast', { message: 'Popup blocked — use PNG export instead', type: 'warning' });
        return;
      }

      win.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Fraxinus Layout</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  @page{size:landscape;margin:0}
  html,body{width:100%;height:100%;background:#fff}
  body{display:flex;align-items:center;justify-content:center;min-height:100vh}
  img{max-width:100%;max-height:100vh;object-fit:contain;display:block}
  @media print{
    html,body{width:297mm;height:210mm}
    body{display:block}
    img{width:297mm;height:210mm;object-fit:contain}
  }
</style>
</head>
<body>
<img src="${dataUrl}" alt="Fraxinus Layout" />
<script>
  window.addEventListener('load', function(){
    setTimeout(function(){ window.print(); }, 400);
  });
<\/script>
</body>
</html>`);
      win.document.close();
      EventBus.emit('toast', { message: 'Print dialog opened — save as PDF', type: 'success', duration: 3000 });
    } catch (err) {
      EventBus.emit('toast', { message: `PDF export failed: ${(err as Error).message}`, type: 'error' });
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

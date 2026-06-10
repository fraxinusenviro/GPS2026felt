import { v4 as uuidv4 } from 'uuid';
import type { TypePreset, AppSettings, GeometryType } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { StylePicker } from './StylePicker';
import { renderSwatchDataUrl, renderLineSwatchDataUrl, renderPolygonSwatchDataUrl } from './SymbolRenderer';

export class PresetManager {
  private presets: TypePreset[] = [];
  private quickEntryPresetIds: [string, string, string] = ['', '', ''];
  private storage = StorageManager.getInstance();
  private stylePicker = new StylePicker();

  async init(settings: AppSettings): Promise<void> {
    this.presets = await this.storage.getAllTypePresets();
    this.quickEntryPresetIds = [
      settings.quick_entry_preset_id ?? '',
      settings.quick_entry_preset_id_2 ?? '',
      settings.quick_entry_preset_id_3 ?? '',
    ];
    this.populateTypeSelector();
    this.updateAllQuickEntryButtons();
  }

  getPresets(): TypePreset[] { return this.presets; }

  getPresetsForGeomType(geomType: GeometryType): TypePreset[] {
    return this.presets.filter(p => p.geometry_type === geomType || p.geometry_type === 'all');
  }

  getPreset(id: string): TypePreset | undefined {
    return this.presets.find(p => p.id === id);
  }

  getPresetByLabel(label: string): TypePreset | undefined {
    return this.presets.find(p => p.label === label);
  }

  getSelectedType(): string {
    const sel = document.getElementById('type-selector') as HTMLSelectElement;
    return sel?.value ?? '';
  }

  private populateTypeSelector(): void {
    const sel = document.getElementById('type-selector') as HTMLSelectElement;
    if (!sel) return;

    const current = sel.value;
    sel.innerHTML = '<option value="">None</option>';
    this.presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.label;
      opt.textContent = p.label;
      if (p.label === current) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  updatePresetsForTool(tool: string): void {
    const geomType: GeometryType =
      tool.includes('line') ? 'LineString' :
      tool.includes('polygon') ? 'Polygon' : 'Point';

    const filtered = this.getPresetsForGeomType(geomType);

    const sel = document.getElementById('type-selector') as HTMLSelectElement;
    if (sel) {
      const current = sel.value;
      sel.innerHTML = '<option value="">None</option>';
      filtered.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.label;
        opt.textContent = p.label;
        if (p.label === current) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    this.populateCaptureTypeSelector(tool);

    if (tool === 'gps-point') this.refreshPointHudPresets();
  }

  refreshPointHudPresets(): void {
    const container = document.getElementById('point-hud-presets');
    if (!container) return;
    const pointPresets = this.getPresetsForGeomType('Point').slice(0, 6);
    container.innerHTML = '';
    if (pointPresets.length === 0) return;
    const sel = document.getElementById('type-selector') as HTMLSelectElement | null;
    pointPresets.forEach(p => {
      const chip = document.createElement('button');
      chip.className = 'point-hud-preset-chip' + (sel?.value === p.label ? ' active' : '');
      chip.dataset.presetLabel = p.label;
      chip.innerHTML = `<span class="point-hud-preset-swatch" style="background:${p.color}"></span>${p.label}`;
      chip.addEventListener('click', () => {
        if (sel) sel.value = p.label;
        container.querySelectorAll('.point-hud-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      container.appendChild(chip);
    });
  }

  populateCaptureTypeSelector(tool: string): void {
    const capSel = document.getElementById('capture-type') as HTMLSelectElement;
    if (!capSel) return;

    const geomType: GeometryType =
      tool.includes('line') ? 'LineString' :
      tool.includes('polygon') ? 'Polygon' : 'Point';

    const filtered = this.getPresetsForGeomType(geomType);
    const current = capSel.value;
    capSel.innerHTML = '<option value="">-- Select Type --</option>';
    filtered.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.label;
      opt.textContent = p.label;
      if (p.label === current) opt.selected = true;
      capSel.appendChild(opt);
    });
  }

  updateAllQuickEntryButtons(): void {
    const slots: Array<{ btnId: string; labelId: string; index: number }> = [
      { btnId: 'btn-quick-entry',   labelId: 'quick-entry-label',   index: 0 },
      { btnId: 'btn-quick-entry-2', labelId: 'quick-entry-label-2', index: 1 },
      { btnId: 'btn-quick-entry-3', labelId: 'quick-entry-label-3', index: 2 },
    ];

    for (const { btnId, labelId, index } of slots) {
      const btn = document.getElementById(btnId) as HTMLButtonElement | null;
      const label = document.getElementById(labelId);
      if (!btn) continue;

      const presetId = this.quickEntryPresetIds[index];
      const preset = this.presets.find(p => p.id === presetId);

      if (preset) {
        if (label) label.textContent = preset.label;
        btn.title = `Quick Entry: ${preset.label}`;
        btn.style.background = `linear-gradient(135deg, ${preset.color}, ${preset.color}99)`;
        if (index > 0) btn.style.display = '';
      } else {
        if (label) label.textContent = index === 0 ? 'Quick Entry' : `QE ${index + 1}`;
        btn.title = 'Quick Entry';
        btn.style.background = '';
        if (index > 0) btn.style.display = 'none';
      }
    }
  }

  /** @deprecated Use updateAllQuickEntryButtons */
  updateQuickEntryButton(): void { this.updateAllQuickEntryButtons(); }

  setQuickEntryPreset(presetId: string, slot = 0): void {
    this.quickEntryPresetIds[slot] = presetId;
    this.updateAllQuickEntryButtons();
  }

  getQuickEntryType(slot = 0): string {
    const preset = this.presets.find(p => p.id === this.quickEntryPresetIds[slot]);
    return preset?.label ?? '';
  }

  // ============================================================
  // Settings UI for presets
  // ============================================================
  renderPresetsSettings(container: HTMLElement, onUpdate: () => void): void {
    container.innerHTML = `
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M243.31,136,144,36.69A15.86,15.86,0,0,0,132.69,32H40a8,8,0,0,0-8,8v92.69A15.86,15.86,0,0,0,36.69,144L136,243.31a16,16,0,0,0,22.63,0l84.68-84.68a16,16,0,0,0,0-22.63ZM84,96A12,12,0,1,1,96,84,12,12,0,0,1,84,96Z"/></svg>Type Presets</h4>
        <p class="settings-hint">Define feature types per geometry. Click the style button (palette) to edit symbology.</p>
        <div id="presets-list"></div>
        <button class="btn-outline" id="btn-add-preset">+ Add Preset</button>
      </div>
      <div class="settings-section">
        <h4><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="16" height="16"><path d="M213.85,125.46l-112,120a8,8,0,0,1-13.69-7l14.66-73.33L45.19,143.49a8,8,0,0,1-3-13l112-120a8,8,0,0,1,13.69,7L153.18,90.9l57.63,21.61a8,8,0,0,1,3,12.95Z"/></svg>Quick Entry Buttons</h4>
        <p class="settings-hint">Up to 3 Quick Entry buttons add a GPS point with one tap. Only Point presets are eligible.</p>
        ${[0, 1, 2].map(i => `
        <label>Button ${i + 1}${i === 0 ? ' (Bottom)' : i === 1 ? ' (Middle)' : ' (Top)'}
          <select id="quick-entry-select-${i}">
            <option value="">-- None --</option>
            ${this.presets.filter(p => p.geometry_type === 'Point').map(p => `<option value="${p.id}" ${p.id === this.quickEntryPresetIds[i] ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </label>`).join('')}
      </div>
    `;

    this.renderPresetList(container.querySelector('#presets-list')!);

    for (let i = 0; i < 3; i++) {
      container.querySelector(`#quick-entry-select-${i}`)?.addEventListener('change', (e) => {
        this.quickEntryPresetIds[i] = (e.target as HTMLSelectElement).value;
        this.updateAllQuickEntryButtons();
        onUpdate();
      });
    }

    container.querySelector('#btn-add-preset')?.addEventListener('click', () => {
      this.showAddPresetDialog(onUpdate, container);
    });
  }

  private renderPresetList(container: HTMLElement): void {
    const geomIcons: Record<string, string> = {
      Point:      '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
      LineString: '<polyline points="3,18 9,7 15,13 21,6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
      Polygon:    '<polygon points="12,3 21,9 18,20 6,20 3,9" fill="currentColor" fill-opacity="0.45" stroke="currentColor" stroke-width="1.5"/>',
      all:        '<circle cx="8" cy="12" r="3" fill="currentColor"/><line x1="12" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    };

    const groups: Array<{ geomType: GeometryType | 'all'; label: string }> = [
      { geomType: 'Point', label: 'Points' },
      { geomType: 'LineString', label: 'Lines' },
      { geomType: 'Polygon', label: 'Polygons' },
      { geomType: 'all', label: 'All Types' }
    ];

    let html = '';
    for (const { geomType, label } of groups) {
      const group = this.presets.filter(p => p.geometry_type === geomType);
      if (group.length === 0) continue;
      const iconSvg = geomIcons[geomType] ?? '';
      html += `<div class="preset-group-header" data-geom="${geomType}">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="none" style="flex-shrink:0;vertical-align:middle">${iconSvg}</svg>
        ${label}
      </div>`;
      html += group.map(p => {
        const swatchUrl =
          geomType === 'LineString' ? renderLineSwatchDataUrl(p, 26)
          : geomType === 'Polygon'  ? renderPolygonSwatchDataUrl(p, 26)
          : renderSwatchDataUrl(p, 26);
        return `
        <div class="preset-row" data-id="${p.id}">
          <img class="preset-swatch-img" src="${swatchUrl}" width="26" height="26" alt="" />
          <span class="preset-label">${p.label}</span>
          ${geomType === 'Point' ? `<span class="preset-qe-badge ${p.is_quick_entry ? 'active' : ''}" title="Quick Entry">QE</span>` : ''}
          <button class="preset-style-btn" data-id="${p.id}" title="Edit style">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" stroke-linecap="round">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
              <circle cx="8" cy="6" r="2" fill="var(--color-surface)"/><circle cx="16" cy="12" r="2" fill="var(--color-surface)"/><circle cx="10" cy="18" r="2" fill="var(--color-surface)"/>
            </svg>
          </button>
          <button class="preset-edit-btn" data-id="${p.id}" title="Edit label/geometry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="preset-del-btn" data-id="${p.id}" title="Delete">✕</button>
        </div>
        `;
      }).join('');
    }
    container.innerHTML = html;

    container.querySelectorAll<HTMLButtonElement>('.preset-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        await this.storage.deleteTypePreset(id);
        this.presets = this.presets.filter(p => p.id !== id);
        this.renderPresetList(container);
        this.populateTypeSelector();
        EventBus.emit('presets-changed', {});
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.preset-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const preset = this.presets.find(p => p.id === id);
        if (preset) this.showEditLabelDialog(preset, container);
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.preset-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const preset = this.presets.find(p => p.id === id);
        if (!preset) return;
        this.stylePicker.open(preset, async (updated) => {
          Object.assign(preset, updated);
          await this.storage.saveTypePreset(preset);
          const idx = this.presets.findIndex(p => p.id === preset.id);
          if (idx >= 0) this.presets[idx] = preset;
          this.renderPresetList(container);
          this.populateTypeSelector();
          EventBus.emit('presets-changed', {});
        });
      });
    });
  }

  private showEditLabelDialog(preset: TypePreset, listContainer: HTMLElement): void {
    EventBus.emit('show-modal', {
      title: 'Edit Preset',
      html: `
        <label>Label <input type="text" id="edit-preset-label" value="${preset.label}" /></label>
        <label>Geometry Type
          <select id="edit-preset-geom">
            <option value="Point" ${preset.geometry_type === 'Point' ? 'selected' : ''}>Point</option>
            <option value="LineString" ${preset.geometry_type === 'LineString' ? 'selected' : ''}>LineString</option>
            <option value="Polygon" ${preset.geometry_type === 'Polygon' ? 'selected' : ''}>Polygon</option>
            <option value="all" ${preset.geometry_type === 'all' ? 'selected' : ''}>All</option>
          </select>
        </label>
        <p class="settings-hint" style="margin-top:8px">To edit colour, icon and shape, use the palette button (🎨) in the preset list.</p>
      `,
      onConfirm: async () => {
        const label = (document.getElementById('edit-preset-label') as HTMLInputElement).value.trim();
        if (!label) return;
        preset.label = label;
        preset.geometry_type = (document.getElementById('edit-preset-geom') as HTMLSelectElement).value as GeometryType | 'all';
        await this.storage.saveTypePreset(preset);
        const idx = this.presets.findIndex(p => p.id === preset.id);
        if (idx >= 0) this.presets[idx] = preset;
        this.renderPresetList(listContainer);
        this.populateTypeSelector();
        EventBus.emit('presets-changed', {});
      }
    });
  }

  private showAddPresetDialog(onUpdate: () => void, parentContainer: HTMLElement): void {
    EventBus.emit('show-modal', {
      title: 'Add Preset',
      html: `
        <label>Label <input type="text" id="new-preset-label" placeholder="e.g. Tree" /></label>
        <label>Geometry Type
          <select id="new-preset-geom">
            <option value="Point">Point</option>
            <option value="LineString">LineString</option>
            <option value="Polygon">Polygon</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>Color <input type="color" id="new-preset-color" value="#4ade80" /></label>
        <p class="settings-hint" style="margin-top:8px">After adding, use the palette button to set icon, shape and other style options.</p>
      `,
      onConfirm: async () => {
        const label = (document.getElementById('new-preset-label') as HTMLInputElement).value.trim();
        if (!label) return;
        const geom = (document.getElementById('new-preset-geom') as HTMLSelectElement).value as GeometryType | 'all';
        const color = (document.getElementById('new-preset-color') as HTMLInputElement).value;

        const preset: TypePreset = {
          id: uuidv4(),
          label,
          geometry_type: geom,
          color,
          is_quick_entry: false,
        };
        await this.storage.saveTypePreset(preset);
        this.presets.push(preset);
        this.renderPresetList(parentContainer.querySelector('#presets-list')!);
        this.populateTypeSelector();
        EventBus.emit('presets-changed', {});
        onUpdate();
      }
    });
  }
}

import { v4 as uuidv4 } from 'uuid';
import type { TypePreset, AppSettings, GeometryType } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';

export class PresetManager {
  private presets: TypePreset[] = [];
  private quickEntryPresetIds: [string, string, string] = ['', '', ''];
  private storage = StorageManager.getInstance();

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

    // Update main toolbar type-selector
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

    // Also populate capture HUD type selector
    this.populateCaptureTypeSelector(tool);
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
        // Slot 0 (btn-quick-entry) is always visible; slots 1 and 2 only when assigned
        if (index > 0) btn.style.display = '';
      } else {
        if (label) label.textContent = index === 0 ? 'Quick Entry' : `QE ${index + 1}`;
        btn.title = 'Quick Entry';
        btn.style.background = '';
        // Hide slots 1 and 2 when no preset assigned
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
        <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>Type Presets</h4>
        <p class="settings-hint">Define types for each geometry type. These appear in the Type selector.</p>
        <div id="presets-list"></div>
        <button class="btn-outline" id="btn-add-preset">+ Add Preset</button>
      </div>
      <div class="settings-section">
        <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Quick Entry Buttons</h4>
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

  private geomSwatch(color: string, geomType: GeometryType | 'all'): string {
    if (geomType === 'LineString') {
      return `<svg class="preset-swatch" viewBox="0 0 26 14" width="26" height="14" aria-hidden="true">
        <polyline points="2,12 9,4 17,10 24,2" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }
    if (geomType === 'Polygon') {
      return `<svg class="preset-swatch" viewBox="0 0 22 16" width="22" height="16" aria-hidden="true">
        <polygon points="4,14 1,6 8,1 18,3 21,11 14,15" fill="${color}55" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    }
    // Point or 'all'
    return `<span class="preset-color-dot" style="background:${color}"></span>`;
  }

  private renderPresetList(container: HTMLElement): void {
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
      html += `<div class="preset-group-header" data-geom="${geomType}">${label}</div>`;
      html += group.map(p => `
        <div class="preset-row" data-id="${p.id}">
          ${this.geomSwatch(p.color, p.geometry_type)}
          <span class="preset-label">${p.label}</span>
          ${geomType === 'Point' ? `<span class="preset-qe-badge ${p.is_quick_entry ? 'active' : ''}" title="Quick Entry">QE</span>` : ''}
          <button class="preset-edit-btn" data-id="${p.id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="preset-del-btn" data-id="${p.id}" title="Delete">✕</button>
        </div>
      `).join('');
    }
    container.innerHTML = html;

    container.querySelectorAll<HTMLButtonElement>('.preset-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id!;
        await this.storage.deleteTypePreset(id);
        this.presets = this.presets.filter(p => p.id !== id);
        this.renderPresetList(container);
        this.populateTypeSelector();
      });
    });

    container.querySelectorAll<HTMLButtonElement>('.preset-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id!;
        const preset = this.presets.find(p => p.id === id);
        if (preset) this.showEditPresetDialog(preset, container);
      });
    });
  }

  private showEditPresetDialog(preset: TypePreset, listContainer: HTMLElement): void {
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
        <label>Color <input type="color" id="edit-preset-color" value="${preset.color}" /></label>
        ${preset.geometry_type === 'Point' ? `<label><input type="checkbox" id="edit-preset-qe" ${preset.is_quick_entry ? 'checked' : ''} /> Set as Quick Entry</label>` : ''}
      `,
      onConfirm: async () => {
        const label = (document.getElementById('edit-preset-label') as HTMLInputElement).value.trim();
        if (!label) return;
        preset.label = label;
        preset.geometry_type = (document.getElementById('edit-preset-geom') as HTMLSelectElement).value as GeometryType | 'all';
        preset.color = (document.getElementById('edit-preset-color') as HTMLInputElement).value;
        const qeEl = document.getElementById('edit-preset-qe') as HTMLInputElement | null;
        preset.is_quick_entry = preset.geometry_type === 'Point' && (qeEl?.checked ?? false);
        await this.storage.saveTypePreset(preset);
        this.renderPresetList(listContainer);
        this.populateTypeSelector();
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
        <label><input type="checkbox" id="new-preset-qe" /> Set as Quick Entry <small>(Point only)</small></label>
      `,
      onConfirm: async () => {
        const label = (document.getElementById('new-preset-label') as HTMLInputElement).value.trim();
        if (!label) return;
        const geom = (document.getElementById('new-preset-geom') as HTMLSelectElement).value as GeometryType | 'all';
        const color = (document.getElementById('new-preset-color') as HTMLInputElement).value;
        const isQE = geom === 'Point' && (document.getElementById('new-preset-qe') as HTMLInputElement).checked;

        const preset: TypePreset = {
          id: uuidv4(),
          label,
          geometry_type: geom,
          color,
          is_quick_entry: isQE
        };
        await this.storage.saveTypePreset(preset);
        this.presets.push(preset);
        this.renderPresetList(parentContainer.querySelector('#presets-list')!);
        this.populateTypeSelector();
        onUpdate();
      }
    });
  }
}

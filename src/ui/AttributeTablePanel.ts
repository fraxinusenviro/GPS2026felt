import { EventBus } from '../utils/EventBus';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface AttrTableRow {
  id?: string;
  properties: Record<string, unknown>;
}

export interface AttrTableOptions {
  layerName: string;
  rows: AttrTableRow[];
  readOnly?: boolean;
  onSave?: (rows: AttrTableRow[]) => Promise<void>;
}

export class AttributeTablePanel {
  private el: HTMLElement;
  private rows: AttrTableRow[] = [];
  private cols: string[] = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private onSaveCallback: ((rows: AttrTableRow[]) => Promise<void>) | null = null;
  private readOnly = false;
  private dirty = false;
  private layerName = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'attr-table-overlay';
    this.el.style.display = 'none';
    this.el.id = 'attr-table-overlay';
    document.body.appendChild(this.el);
  }

  open(opts: AttrTableOptions): void {
    this.layerName = opts.layerName;
    this.rows = opts.rows.map(r => ({ ...r, properties: { ...r.properties } }));
    this.onSaveCallback = opts.onSave ?? null;
    this.readOnly = opts.readOnly ?? !opts.onSave;
    this.dirty = false;
    const allKeys = new Set<string>();
    this.rows.forEach(r => Object.keys(r.properties).forEach(k => allKeys.add(k)));
    this.cols = [...allKeys].sort((a, b) => a.localeCompare(b));
    this.sortCol = null;
    this.sortAsc = true;
    this.render();
    this.el.style.display = 'flex';
    requestAnimationFrame(() => this.el.classList.add('at-open'));
  }

  close(): void {
    this.el.classList.remove('at-open');
    setTimeout(() => { this.el.style.display = 'none'; }, 220);
  }

  private sorted(): AttrTableRow[] {
    if (!this.sortCol) return this.rows;
    const col = this.sortCol;
    const asc = this.sortAsc;
    return [...this.rows].sort((a, b) => {
      const va = String(a.properties[col] ?? '');
      const vb = String(b.properties[col] ?? '');
      const cmp = va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
      return asc ? cmp : -cmp;
    });
  }

  private render(): void {
    const sortedRows = this.sorted();
    const colHeaders = this.cols.map(c => {
      const isSorted = this.sortCol === c;
      const sortIndicator = isSorted ? (this.sortAsc ? ' ▲' : ' ▼') : ' ⇅';
      return `<th class="at-th${isSorted ? ' at-sorted' : ''}" data-col="${esc(c)}" title="Sort by ${esc(c)}">${esc(c)}<span class="at-sort-arrow">${sortIndicator}</span></th>`;
    }).join('');

    const tbody = sortedRows.map((row, ri) => {
      const cells = this.cols.map(c => {
        const val = row.properties[c];
        const display = val == null ? '' : String(val);
        return `<td class="at-td${this.readOnly ? '' : ' at-editable'}" data-row="${ri}" data-col="${esc(c)}" title="${esc(display)}">${esc(display)}</td>`;
      }).join('');
      return `<tr class="at-tr"><td class="at-td at-rownum">${ri + 1}</td>${cells}</tr>`;
    }).join('');

    const tableIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>`;

    this.el.innerHTML = `
      <div class="attr-table-panel">
        <div class="attr-table-hdr">
          <div class="attr-table-title">
            ${tableIcon}
            <span>${esc(this.layerName)}</span>
            <span class="at-meta">${this.rows.length} row${this.rows.length !== 1 ? 's' : ''} · ${this.cols.length} col${this.cols.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="at-hdr-btns">
            ${!this.readOnly ? `<button class="btn-primary at-save-btn" id="at-save"${this.dirty ? '' : ' disabled'}>Save${this.dirty ? ' *' : ''}</button>` : `<span class="at-readonly-badge">Read-only</span>`}
            <button class="btn-outline at-close-btn" id="at-close">✕ Close</button>
          </div>
        </div>
        <div class="at-table-wrap">
          <table class="at-table">
            <thead><tr><th class="at-th at-rownum-th">#</th>${colHeaders}</tr></thead>
            <tbody>${tbody}</tbody>
          </table>
          ${sortedRows.length === 0 ? `<div class="at-empty">No features in this layer.</div>` : ''}
        </div>
      </div>`;
    this.wireEvents();
  }

  private wireEvents(): void {
    // Close
    this.el.querySelector('#at-close')?.addEventListener('click', () => this.close());
    this.el.addEventListener('click', e => { if (e.target === this.el) this.close(); });

    // Save
    this.el.querySelector('#at-save')?.addEventListener('click', async () => {
      if (!this.onSaveCallback || !this.dirty) return;
      const btn = this.el.querySelector<HTMLButtonElement>('#at-save');
      if (btn) btn.textContent = 'Saving…';
      try {
        await this.onSaveCallback(this.rows);
        this.dirty = false;
        EventBus.emit('toast', { message: 'Attributes saved', type: 'success', duration: 2000 });
        this.render();
      } catch {
        EventBus.emit('toast', { message: 'Failed to save attributes', type: 'error' });
        this.render();
      }
    });

    // Sort columns
    this.el.querySelectorAll<HTMLTableCellElement>('.at-th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col!;
        this.sortCol === col ? (this.sortAsc = !this.sortAsc) : (this.sortCol = col, this.sortAsc = true);
        this.render();
      });
    });

    // Edit cells
    if (this.readOnly) return;
    this.el.querySelectorAll<HTMLTableCellElement>('.at-editable').forEach(td => {
      td.addEventListener('click', () => {
        if (td.querySelector('input')) return;
        const rowIdx = parseInt(td.dataset.row!);
        const col = td.dataset.col!;
        const orig = String(this.rows[rowIdx]?.properties[col] ?? '');
        const input = document.createElement('input');
        input.type = 'text';
        input.value = orig;
        input.className = 'at-cell-input';
        td.textContent = '';
        td.appendChild(input);
        input.focus(); input.select();
        const commit = () => {
          const val = input.value;
          td.textContent = val;
          if (val !== orig) {
            this.rows[rowIdx].properties[col] = val;
            this.dirty = true;
            const saveBtn = this.el.querySelector<HTMLButtonElement>('#at-save');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save *'; }
          }
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          if (e.key === 'Escape') { td.textContent = orig; }
          e.stopPropagation();
        });
      });
    });
  }
}

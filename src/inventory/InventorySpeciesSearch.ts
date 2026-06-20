/**
 * Species search modal. Filters the combined species list across 5 fields
 * (common/scientific/mcode/taxon/family), caps results at 100, and returns the
 * picked SpeciesRecord to the caller. Ported from NSINV `_doFilterSpecies`.
 *
 * Durability notes: `show-modal` renders synchronously, so listeners are wired
 * immediately after emit (no requestAnimationFrame timing dependency). State is
 * fully re-initialised on every `open()` so the search keeps working across
 * repeated opens — including after resuming a draft. Selection is resolved via
 * the rendered slice (O(1)), never an indexOf into the full ~10k+ species list.
 */
import type { AppSettings, SpeciesRecord } from '../types';
import { EventBus } from '../utils/EventBus';
import { getSpeciesList, isSoCI, taxonIcon, escapeHtml } from './inventorySurvey';

export class InventorySpeciesSearch {
  private list: SpeciesRecord[] = [];
  private visible: SpeciesRecord[] = [];   // currently-rendered rows (data-idx maps here)
  private onPick: ((sp: SpeciesRecord) => void) | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private getSettings: () => AppSettings) {}

  open(onPick: (sp: SpeciesRecord) => void): void {
    // Reset all per-session state so a stale timer/handler from a previous open
    // can never interfere with this one.
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    this.onPick = onPick;
    this.visible = [];
    this.list = getSpeciesList(this.getSettings());

    EventBus.emit('show-modal', {
      title: 'Add Observation — search species',
      html: `
        <div class="inv-species-search">
          <input id="inv-species-input" type="search" class="inv-input" placeholder="Search common, scientific, code, taxon or family…" autocomplete="off" />
          <div id="inv-species-count" class="inv-species-count"></div>
          <div id="inv-species-results" class="inv-species-results" role="listbox"></div>
        </div>`,
      cancelLabel: 'Cancel',
      confirmLabel: 'Done',
    });

    // Modal.show() runs synchronously inside the emit above, so the elements
    // exist now — wire directly rather than depending on a frame callback.
    this.wire();
  }

  private wire(): void {
    const input = document.getElementById('inv-species-input') as HTMLInputElement | null;
    const results = document.getElementById('inv-species-results');
    if (!input || !results) return;

    this.filter('');

    input.addEventListener('input', () => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.filter(input.value), 150);
    });

    // Event delegation on the (stable) results container: survives the innerHTML
    // swaps that each filter() performs.
    results.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.species-item');
      if (!row) return;
      const sp = this.visible[Number(row.dataset.idx)];
      if (!sp) return;
      (document.getElementById('modal-close') as HTMLButtonElement | null)?.click();
      this.onPick?.(sp);
    });

    // Defer focus a tick so it lands after the modal's open transition starts.
    setTimeout(() => input.focus(), 0);
  }

  private filter(q: string): void {
    const query = q.toLowerCase().trim();
    const container = document.getElementById('inv-species-results');
    const countLabel = document.getElementById('inv-species-count');
    if (!container) return;

    const filtered = query
      ? this.list.filter(sp => {
          const cm = (sp.commonName || '').toLowerCase();
          const sc = (sp.scientificName || '').toLowerCase();
          const mc = (sp.mcode || '').toLowerCase();
          const tx = (sp.taxon || '').toLowerCase();
          const fm = (sp.family || '').toLowerCase();
          return cm.includes(query) || sc.includes(query) || mc.includes(query) || tx.includes(query) || fm.includes(query);
        })
      : this.list;

    if (countLabel) countLabel.textContent = `${filtered.length.toLocaleString()} result${filtered.length !== 1 ? 's' : ''}`;

    // Render the capped slice; data-idx maps into this.visible (O(1) selection).
    this.visible = filtered.slice(0, 100);
    container.innerHTML = this.visible.map((sp, idx) => {
      const soci = isSoCI(sp);
      const icon = taxonIcon(sp.taxon);
      const isSpecial = sp.taxon === 'Survey Start' || sp.taxon === 'Survey End';

      let nameHtml: string;
      if (isSpecial) {
        nameHtml = escapeHtml(sp.commonName);
      } else {
        nameHtml = sp.mcode ? `<strong>${escapeHtml(sp.mcode)}</strong> — ${escapeHtml(sp.commonName)}` : escapeHtml(sp.commonName);
        if (sp.scientificName) nameHtml += ` <em>${escapeHtml(sp.scientificName)}</em>`;
        if (sp.family) nameHtml += ` <span class="inv-family-tag">${escapeHtml(sp.family)}</span>`;
      }

      const badges: string[] = [];
      if (sp.srank) badges.push(`<span class="inv-srank-tag${soci ? ' inv-soci-tag' : ''}">${escapeHtml(sp.srank)}</span>`);
      if (sp.sprot) badges.push(`<span class="inv-sprot-tag">${escapeHtml(sp.sprot)}</span>`);
      if (sp.nprot) badges.push(`<span class="inv-nprot-tag">${escapeHtml(sp.nprot)}</span>`);
      if (sp.noteRank && /Exotic/i.test(sp.noteRank)) badges.push(`<span class="inv-exotic-tag">Exotic</span>`);

      return `<div class="species-item${soci ? ' soci-item' : ''}" data-idx="${idx}" tabindex="0" role="option">
        <span class="species-icon" aria-hidden="true">${icon}</span>
        <span class="species-name">${nameHtml}${badges.join('')}</span>
      </div>`;
    }).join('');

    if (filtered.length > 100) {
      container.insertAdjacentHTML('beforeend',
        `<div class="inv-search-overflow">…${(filtered.length - 100).toLocaleString()} more — refine your search</div>`);
    }
  }
}

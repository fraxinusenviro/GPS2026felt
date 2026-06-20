/**
 * Species search modal. Filters the combined species list across 5 fields
 * (common/scientific/mcode/taxon/family), caps results at 100, and returns the
 * picked SpeciesRecord to the caller. Ported from NSINV `_doFilterSpecies`.
 */
import type { AppSettings, SpeciesRecord } from '../types';
import { EventBus } from '../utils/EventBus';
import { getSpeciesList, isSoCI, taxonIcon, escapeHtml } from './inventorySurvey';

export class InventorySpeciesSearch {
  private list: SpeciesRecord[] = [];
  private onPick: ((sp: SpeciesRecord) => void) | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(private getSettings: () => AppSettings) {}

  open(onPick: (sp: SpeciesRecord) => void): void {
    this.onPick = onPick;
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

    requestAnimationFrame(() => {
      const input = document.getElementById('inv-species-input') as HTMLInputElement | null;
      const results = document.getElementById('inv-species-results');
      if (!input || !results) return;
      this.filter('');
      input.focus();
      input.addEventListener('input', () => {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.filter(input.value), 150);
      });
      // Event delegation: one click handler reads the species index off the row.
      results.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.species-item');
        if (!row) return;
        const idx = Number(row.dataset.idx);
        const sp = this.list[idx];
        if (!sp) return;
        (document.getElementById('modal-close') as HTMLButtonElement | null)?.click();
        this.onPick?.(sp);
      });
    });
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

    const visible = filtered.slice(0, 100);
    container.innerHTML = visible.map(sp => {
      const soci = isSoCI(sp);
      const icon = taxonIcon(sp.taxon);
      const isSpecial = sp.taxon === 'Survey Start' || sp.taxon === 'Survey End';
      const idx = this.list.indexOf(sp);

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

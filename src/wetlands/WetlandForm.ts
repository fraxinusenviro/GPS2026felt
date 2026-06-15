/**
 * Wetland plot survey editor — a full-screen panel reproducing the WETLANDS
 * 4-tab form (Metadata / Vegetation / Hydrology / Soils). Operates on a working
 * copy of a feature's wetland_data; on Save it writes back and invokes onSave.
 */
import type { FieldFeature, WetlandSurvey } from '../types';
import {
  defaultWetlandSurvey, metadataFields, hydrologyFields, VEG_GROUPS,
  yesNo, redoxTypeOptions, redoxLocationOptions, textureTriangleOptions,
  hydricSoilIndicators, wetlandHydrologyPrimary, wetlandHydrologySecondary,
  displayLabel, str, loadWetlandReferenceData, buildReferenceDatalists,
  applySpeciesLookup, recomputeDominanceFlags, vegetationMetricsFromSurvey,
  isRestrictiveHorizon, syncHorizonDepthLinks, computeHydricCandidateIndicators,
  munsellDisplay, fileToWetlandPhoto, type FieldDef,
} from './wetlandSurvey';

const PAGES = ['metadata', 'vegetation', 'hydrology', 'soils'] as const;
type Page = typeof PAGES[number];

const clone = <T>(o: T): T => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export class WetlandForm {
  private panel: HTMLElement;
  private survey: WetlandSurvey = defaultWetlandSurvey();
  private feature: FieldFeature | null = null;
  private activeTab = 0;
  private vegUi: Record<string, { max: number; count: number; collapsed: boolean }> = {
    Tree: { max: 6, count: 6, collapsed: false },
    Shrub: { max: 6, count: 6, collapsed: false },
    Herb: { max: 10, count: 10, collapsed: false },
  };
  private soilUi: { horizonCount: number; horizons: Record<number, { collapsed: boolean }> } = {
    horizonCount: 4,
    horizons: { 1: { collapsed: false }, 2: { collapsed: false }, 3: { collapsed: false }, 4: { collapsed: false } },
  };

  constructor(private onSave: (feature: FieldFeature) => void | Promise<void>) {
    injectStyles();
    this.panel = document.createElement('div');
    this.panel.id = 'wetland-form-panel';
    this.panel.className = 'wf-panel';
    this.panel.style.display = 'none';
    document.body.appendChild(this.panel);
  }

  isOpen(): boolean { return this.panel.style.display !== 'none'; }

  async open(feature: FieldFeature): Promise<void> {
    this.feature = feature;
    this.survey = feature.wetland_data ? clone(feature.wetland_data) : defaultWetlandSurvey();
    if (!this.survey.id) this.survey.id = feature.id;
    // Seed lat/lon from the dropped point if the survey has none yet.
    if (this.survey.latitude === '' && feature.lat != null) this.survey.latitude = feature.lat;
    if (this.survey.longitude === '' && feature.lon != null) this.survey.longitude = feature.lon;
    this.activeTab = 0;
    this.renderShell();
    this.panel.style.display = 'block';
    requestAnimationFrame(() => this.panel.classList.add('open'));
    await loadWetlandReferenceData();
    buildReferenceDatalists();
    this.renderActivePage();
  }

  close(): void {
    this.feature = null;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.feature) this.panel.style.display = 'none'; }, 250);
  }

  // ---- shell ----
  private renderShell(): void {
    this.panel.innerHTML = `
      <div class="wf-inner">
        <div class="wf-header">
          <div class="wf-header-top">
            <div class="wf-title">Wetland Plot · <span class="wf-plotid">${escapeHtml(str(this.survey.PLOT_ID) || this.feature?.point_id || 'New Plot')}</span></div>
            <button class="wf-close" id="wf-close" title="Close without saving" aria-label="Close">✕</button>
          </div>
          <div class="wf-tabs" id="wf-tabs"></div>
        </div>
        <div class="wf-body" id="wf-body"></div>
        <div class="wf-footer">
          <span class="wf-status" id="wf-status"></span>
          <div class="wf-foot-actions">
            <button id="wf-prev" class="wf-btn">‹ Prev</button>
            <button id="wf-next" class="wf-btn">Next ›</button>
            <button id="wf-cancel" class="wf-btn">Cancel</button>
            <button id="wf-save" class="wf-btn wf-primary">Save Plot</button>
          </div>
        </div>
      </div>`;

    const tabs = this.panel.querySelector('#wf-tabs')!;
    PAGES.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = p[0].toUpperCase() + p.slice(1);
      b.className = `wf-tab wf-tab-${p}` + (i === this.activeTab ? ' active' : '');
      b.onclick = () => this.setActiveTab(i);
      tabs.appendChild(b);
    });

    this.panel.querySelector('#wf-close')!.addEventListener('click', () => this.close());
    this.panel.querySelector('#wf-cancel')!.addEventListener('click', () => this.close());
    this.panel.querySelector('#wf-save')!.addEventListener('click', () => void this.save());
    this.panel.querySelector('#wf-prev')!.addEventListener('click', () => this.setActiveTab(this.activeTab - 1));
    this.panel.querySelector('#wf-next')!.addEventListener('click', () => this.setActiveTab(this.activeTab + 1));
  }

  private setActiveTab(i: number): void {
    this.activeTab = Math.max(0, Math.min(PAGES.length - 1, i));
    this.panel.querySelectorAll('.wf-tab').forEach((x, idx) => x.classList.toggle('active', idx === this.activeTab));
    this.renderActivePage();
  }

  private get page(): Page { return PAGES[this.activeTab]; }

  private renderActivePage(): void {
    const body = this.panel.querySelector('#wf-body') as HTMLElement;
    if (!body) return;
    body.className = `wf-body wf-page-${this.page}`;
    body.innerHTML = '';
    if (this.page === 'metadata') this.renderMetadata(body);
    else if (this.page === 'vegetation') this.renderVegetation(body);
    else if (this.page === 'hydrology') this.renderHydrology(body);
    else this.renderSoils(body);
  }

  // ---- generic field builder bound to the working survey ----
  private fieldEl(def: FieldDef): HTMLElement {
    const [name, type, options] = def;
    const w = document.createElement('div');
    w.className = 'wf-field';
    const label = document.createElement('label');
    label.textContent = displayLabel(name);
    w.appendChild(label);
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (type === 'select') {
      input = document.createElement('select');
      (options || []).forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v || '—'; (input as HTMLSelectElement).appendChild(o); });
    } else if (type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      (input as HTMLInputElement).type = type;
      if (type === 'number') (input as HTMLInputElement).step = 'any';
    }
    input.value = str(this.survey[name]);
    input.oninput = () => { this.survey[name] = input.value; };
    w.appendChild(input);
    return w;
  }

  // ---- Metadata ----
  private renderMetadata(root: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'wf-grid';
    metadataFields.forEach(def => {
      grid.appendChild(this.fieldEl(def));
      if (def[0] === 'longitude') {
        const locWrap = document.createElement('div');
        locWrap.className = 'wf-field';
        const lbl = document.createElement('label'); lbl.textContent = 'GPS Capture'; locWrap.appendChild(lbl);
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'wf-btn'; btn.textContent = 'Use Device Location';
        btn.onclick = () => navigator.geolocation.getCurrentPosition(
          pos => { this.survey.latitude = pos.coords.latitude; this.survey.longitude = pos.coords.longitude; this.renderActivePage(); },
          () => alert('Could not read location.'),
        );
        locWrap.appendChild(btn);
        grid.appendChild(locWrap);
      }
    });
    root.appendChild(card('Metadata', grid));

    const notesWrap = document.createElement('div');
    notesWrap.className = 'wf-field wf-field-block';
    notesWrap.appendChild(Object.assign(document.createElement('label'), { textContent: 'Notes' }));
    const ta = document.createElement('textarea');
    ta.value = str(this.survey.notes);
    ta.oninput = () => { this.survey.notes = ta.value; };
    notesWrap.appendChild(ta);
    root.appendChild(card('Notes', notesWrap));

    root.appendChild(this.photoCard());
  }

  private photoCard(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wf-field wf-field-block';
    const lbl = document.createElement('label'); lbl.textContent = 'Photos'; wrap.appendChild(lbl);
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])];
      const mapped = await Promise.all(files.map(f => fileToWetlandPhoto(f)));
      this.survey.photos = [...(this.survey.photos || []), ...mapped];
      this.renderActivePage();
    };
    wrap.appendChild(input);
    const preview = document.createElement('div');
    preview.className = 'wf-photo-preview';
    (this.survey.photos || []).forEach((p, idx) => {
      const item = document.createElement('div');
      item.className = 'wf-photo-item';
      const img = document.createElement('img'); img.src = p.dataUrl; img.alt = p.name;
      const del = document.createElement('button'); del.textContent = '×';
      del.onclick = () => { this.survey.photos.splice(idx, 1); this.renderActivePage(); };
      item.append(img, del);
      preview.appendChild(item);
    });
    wrap.appendChild(preview);
    return card('Photos', wrap);
  }

  // ---- Vegetation ----
  private renderVegetation(root: HTMLElement): void {
    VEG_GROUPS.forEach(([g, n]) => {
      const c = document.createElement('div');
      c.className = `wf-card wf-veg-${g.toLowerCase()}`;
      const head = document.createElement('div');
      head.className = 'wf-veg-head';
      head.innerHTML = `<h4>${g} Species</h4>`;
      const controls = document.createElement('div');
      controls.className = 'wf-veg-controls';
      const minus = btn('−'); const count = document.createElement('span'); count.className = 'wf-count'; count.textContent = String(this.vegUi[g].count); const plus = btn('+'); const chevBtn = chev(this.vegUi[g].collapsed);
      minus.onclick = () => { this.vegUi[g].count = Math.max(1, this.vegUi[g].count - 1); this.renderActivePage(); };
      plus.onclick = () => { this.vegUi[g].count = Math.min(this.vegUi[g].max, this.vegUi[g].count + 1); this.renderActivePage(); };
      chevBtn.onclick = () => { this.vegUi[g].collapsed = !this.vegUi[g].collapsed; this.renderActivePage(); };
      controls.append(minus, count, plus, chevBtn);
      head.appendChild(controls);
      c.appendChild(head);

      if (!this.vegUi[g].collapsed) {
        const table = document.createElement('div');
        table.className = 'wf-veg-table';
        const header = document.createElement('div');
        header.className = 'wf-veg-row wf-veg-header';
        header.innerHTML = `<div>#</div><div>Species (Common / Scientific / Code + Status)</div><div>% Cover</div><div>Dom</div>`;
        table.appendChild(header);
        for (let i = 1; i <= Math.min(this.vegUi[g].count, n); i++) {
          const row = document.createElement('div');
          row.className = 'wf-veg-row';
          const idx = document.createElement('div'); idx.className = 'wf-veg-idx'; idx.textContent = String(i);
          const species = document.createElement('input');
          species.type = 'text'; species.setAttribute('list', 'species-options');
          species.value = str(this.survey[`${g}Sp${i}`]);
          species.oninput = () => { this.survey[`${g}Sp${i}`] = species.value; };
          species.onchange = () => { applySpeciesLookup(this.survey, g, i, species.value); recomputeDominanceFlags(this.survey); this.renderActivePage(); };
          const cov = document.createElement('input');
          cov.type = 'number'; cov.step = 'any';
          cov.value = str(this.survey[`${g}Sp${i}Cov`]);
          cov.oninput = () => { this.survey[`${g}Sp${i}Cov`] = cov.value; recomputeDominanceFlags(this.survey); };
          cov.onchange = () => { recomputeDominanceFlags(this.survey); this.renderActivePage(); };
          const dom = document.createElement('input');
          dom.type = 'checkbox'; dom.disabled = true; dom.checked = !!this.survey[`${g}Sp${i}Dom`];
          dom.title = 'Auto-calculated using the 50/20 rule';
          row.append(idx, species, cov, dom);
          table.appendChild(row);
        }
        c.appendChild(table);
      }
      root.appendChild(c);
    });

    recomputeDominanceFlags(this.survey);
    const m = vegetationMetricsFromSurvey(this.survey);
    const summary = document.createElement('div');
    summary.className = 'wf-card';
    summary.innerHTML = `
      <h4>Vegetation Indices</h4>
      <div class="wf-indices">
        <div><strong>Dominance Test (A/B):</strong> ${m.dominanceA}/${m.dominanceB} = <strong>${m.dominancePct.toFixed(1)}%</strong></div>
        <div><strong>Dominance Pass (&gt;50%):</strong> ${m.dominancePass ? 'Yes' : 'No'}</div>
        <div><strong>Prevalence Index:</strong> <strong>${m.prevalenceIndex.toFixed(2)}</strong></div>
        <div><strong>Prevalence Pass (≤3.0):</strong> ${m.prevalencePass ? 'Yes' : 'No'}</div>
      </div>
      <p class="wf-muted">Coverage — OBL: ${m.cover.OBL.toFixed(2)}, FACW: ${m.cover.FACW.toFixed(2)}, FAC: ${m.cover.FAC.toFixed(2)}, FACU: ${m.cover.FACU.toFixed(2)}, UPL: ${m.cover.UPL.toFixed(2)}</p>`;
    root.appendChild(summary);
  }

  // ---- Hydrology ----
  private renderHydrology(root: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'wf-grid';
    hydrologyFields.forEach(def => grid.appendChild(this.fieldEl(def)));
    root.appendChild(card('Hydrology', grid));
    root.appendChild(this.checkGroup('HydrologyPrimary', wetlandHydrologyPrimary));
    root.appendChild(this.checkGroup('HydrologySecondary', wetlandHydrologySecondary));
  }

  private checkGroup(key: string, options: string[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wf-card';
    wrap.innerHTML = `<h4>${displayLabel(key)}</h4>`;
    const grid = document.createElement('div');
    grid.className = 'wf-check-grid';
    const current = (this.survey[key] as string[]) || [];
    options.forEach(opt => {
      const row = document.createElement('label');
      row.className = 'wf-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = current.includes(opt);
      cb.onchange = () => {
        const set = new Set((this.survey[key] as string[]) || []);
        if (cb.checked) set.add(opt); else set.delete(opt);
        this.survey[key] = [...set];
      };
      row.append(cb, document.createTextNode(opt));
      grid.appendChild(row);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // ---- Soils ----
  private renderSoils(root: HTMLElement): void {
    const top = document.createElement('div');
    top.className = 'wf-card';
    const head = document.createElement('div');
    head.className = 'wf-veg-head';
    head.innerHTML = `<h4>Soil Horizons</h4>`;
    const controls = document.createElement('div');
    controls.className = 'wf-veg-controls';
    const minus = btn('−'); const count = document.createElement('span'); count.className = 'wf-count'; count.textContent = String(this.soilUi.horizonCount); const plus = btn('+');
    minus.onclick = () => { this.soilUi.horizonCount = Math.max(1, this.soilUi.horizonCount - 1); this.renderActivePage(); };
    plus.onclick = () => { this.soilUi.horizonCount = Math.min(4, this.soilUi.horizonCount + 1); this.renderActivePage(); };
    controls.append(minus, count, plus);
    head.appendChild(controls);
    top.appendChild(head);
    root.appendChild(top);

    syncHorizonDepthLinks(this.survey, this.soilUi.horizonCount);

    for (let h = 1; h <= this.soilUi.horizonCount; h++) {
      const c = document.createElement('div');
      c.className = 'wf-card';
      const hh = document.createElement('div');
      hh.className = 'wf-veg-head';
      hh.innerHTML = `<h4>Soil Horizon ${h}</h4>`;
      const ctr = document.createElement('div');
      ctr.className = 'wf-veg-controls';
      const restLbl = document.createElement('label');
      restLbl.className = 'wf-restrictive';
      const rcb = document.createElement('input'); rcb.type = 'checkbox'; rcb.checked = isRestrictiveHorizon(this.survey, h);
      rcb.onchange = () => { this.survey[`SoilH${h}RestrictiveYN`] = rcb.checked ? 'Yes' : 'No'; syncHorizonDepthLinks(this.survey, this.soilUi.horizonCount); this.renderActivePage(); };
      restLbl.append(rcb, document.createTextNode(' Restrictive layer / pit end'));
      const chevBtn = chev(this.soilUi.horizons[h]?.collapsed);
      chevBtn.onclick = () => { this.soilUi.horizons[h].collapsed = !this.soilUi.horizons[h].collapsed; this.renderActivePage(); };
      ctr.append(restLbl, chevBtn);
      hh.appendChild(ctr);
      c.appendChild(hh);

      const priorRestrictive = h > 1 && Array.from({ length: h - 1 }, (_, i) => isRestrictiveHorizon(this.survey, i + 1)).includes(true);
      const thisRestrictive = isRestrictiveHorizon(this.survey, h);

      if (!this.soilUi.horizons[h]?.collapsed) {
        const table = document.createElement('div');
        table.className = 'wf-soil-table';
        const pairs: Array<[string, string, string, string, string, string]> = thisRestrictive
          ? [['Start Depth (cm)', `SoilH${h}StartDepthCM`, 'number', 'Restrictive Layer Note', `SoilH${h}RestrictiveNote`, 'text']]
          : [
            ['Start Depth (cm)', `SoilH${h}StartDepthCM`, 'number', 'End Depth (cm)', `SoilH${h}EndDepthCM`, 'number'],
            ['Thickness (cm)', `SoilH${h}ThickCM`, 'number', 'Texture', `SoilH${h}Texture`, 'text'],
            ['Matrix', `SoilH${h}Matrix`, 'text', 'Matrix %', `SoilH${h}MatrixPC`, 'number'],
            ['Redox', `SoilH${h}Redox`, 'text', 'Redox %', `SoilH${h}RedoxPC`, 'number'],
            ['Redox Type', `SoilH${h}RedoxType`, 'text', 'Redox Location', `SoilH${h}RedoxLoc`, 'text'],
          ];
        pairs.forEach(([l1, k1, t1, l2, k2, t2]) => {
          const row = document.createElement('div');
          row.className = 'wf-soil-row';
          row.append(this.buildSoilInput(l1, k1, t1, priorRestrictive), this.buildSoilInput(l2, k2, t2, priorRestrictive));
          table.appendChild(row);
        });
        c.appendChild(table);
      }
      root.appendChild(c);
    }

    const candidates = computeHydricCandidateIndicators(this.survey, this.soilUi.horizonCount);
    const hc = document.createElement('div');
    hc.className = 'wf-card';
    hc.innerHTML = `<h4>Hydric Indicator Candidates</h4><p class="wf-muted">From current soil entries: <strong>${candidates.length ? candidates.join(', ') : 'None yet'}</strong></p>`;
    root.appendChild(hc);

    root.appendChild(this.checkGroup('HydricSoilIndicators', hydricSoilIndicators));
  }

  private buildSoilInput(label: string, key: string, type: string, priorRestrictive: boolean): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'wf-soil-cell';
    cell.appendChild(Object.assign(document.createElement('label'), { textContent: label }));
    let input: HTMLInputElement | HTMLSelectElement;
    const selectFrom = (opts: string[]) => {
      const sel = document.createElement('select');
      opts.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v || '—'; sel.appendChild(o); });
      sel.value = str(this.survey[key]);
      sel.onchange = () => { this.survey[key] = sel.value; };
      return sel;
    };
    if (/SoilH\d+RedoxType$/.test(key)) input = selectFrom(redoxTypeOptions);
    else if (/SoilH\d+RedoxLoc$/.test(key)) input = selectFrom(redoxLocationOptions);
    else if (/SoilH\d+Texture$/.test(key)) input = selectFrom(textureTriangleOptions);
    else {
      const inp = document.createElement('input');
      inp.type = type; if (type === 'number') inp.step = 'any';
      inp.value = str(this.survey[key]);
      if (/SoilH\d+ThickCM$/.test(key)) { inp.readOnly = true; inp.title = 'Auto-calculated as End − Start.'; }
      const startMatch = key.match(/^SoilH(\d+)StartDepthCM$/);
      if (startMatch && Number(startMatch[1]) > 1) { inp.readOnly = true; inp.title = 'Auto-populated from previous horizon end depth.'; }
      if (/SoilH\d+(Matrix|Redox)$/.test(key)) { inp.setAttribute('list', 'munsell-options'); inp.placeholder = 'e.g., 10YR 4/3'; }
      inp.oninput = () => {
        this.survey[key] = inp.value;
        if (/^SoilH(\d+)(Start|End)DepthCM$/.test(key)) syncHorizonDepthLinks(this.survey, this.soilUi.horizonCount);
      };
      inp.onblur = () => {
        if (/SoilH\d+(Matrix|Redox)$/.test(key)) { const n = munsellDisplay(inp.value); inp.value = n; this.survey[key] = n; }
        if (/^SoilH(\d+)(Start|End)DepthCM$/.test(key)) { syncHorizonDepthLinks(this.survey, this.soilUi.horizonCount); this.renderActivePage(); }
      };
      input = inp;
    }
    if (priorRestrictive) { input.disabled = true; input.title = 'Disabled — a restrictive layer was marked in an earlier horizon.'; }
    cell.appendChild(input);
    return cell;
  }

  // ---- save ----
  private async save(): Promise<void> {
    if (!this.feature) return;
    recomputeDominanceFlags(this.survey);
    this.survey.timestamp = new Date().toISOString();
    const f = this.feature;
    f.wetland_data = this.survey;
    // Mirror lat/lon (possibly edited via GPS capture) onto the feature geometry.
    const lat = Number(this.survey.latitude);
    const lon = Number(this.survey.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0) {
      f.lat = lat; f.lon = lon;
      f.geometry = { type: 'Point', coordinates: [lon, lat] };
    }
    // Keep a readable description for the feature list / map labels.
    f.desc = str(this.survey.SiteID) || str(this.survey.PLOT_ID) || f.desc;
    const status = this.panel.querySelector('#wf-status');
    if (status) status.textContent = 'Saving…';
    await this.onSave(f);
    this.close();
  }
}

// ---- small DOM helpers ----
function btn(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'wf-mini'; b.textContent = text;
  return b;
}
function chev(collapsed: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'wf-chevron' + (collapsed ? ' collapsed' : '');
  b.textContent = '▾';
  b.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
  return b;
}
function card(title: string, child: HTMLElement): HTMLElement {
  const c = document.createElement('div');
  c.className = 'wf-card';
  c.innerHTML = `<h4>${escapeHtml(title)}</h4>`;
  c.appendChild(child);
  return c;
}
function escapeHtml(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'wetland-form-styles';
  style.textContent = `
  .wf-panel { position: fixed; inset: 0; z-index: var(--z-modal, 200); background: var(--color-bg); color: var(--color-text);
    font-family: var(--font); opacity: 0; transition: opacity .2s ease; overflow: hidden; }
  .wf-panel.open { opacity: 1; }
  .wf-inner { display: flex; flex-direction: column; height: 100%; }
  .wf-header { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
  .wf-header-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .wf-title { font-weight: 700; font-size: 16px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wf-plotid { color: var(--color-accent); }
  .wf-close { flex-shrink: 0; width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; line-height: 1; border-radius: var(--radius-sm); border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); cursor: pointer; }
  .wf-close:hover { background: var(--color-danger-dim); border-color: var(--color-danger); color: var(--color-danger); }
  .wf-tabs { display: flex; gap: 6px; }
  .wf-tab { flex: 1; padding: 9px 10px; border: 1px solid var(--color-border); border-bottom: 3px solid var(--tab-color, var(--color-border)); background: transparent; color: var(--color-text); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; font-weight: 600; font-family: inherit; }
  .wf-tab.active { color: #04140d; font-weight: 700; background: var(--tab-color, var(--color-accent)); border-color: var(--tab-color, var(--color-accent)); }
  .wf-tab-metadata { --tab-color: #38bdf8; }
  .wf-tab-vegetation { --tab-color: #4ade80; }
  .wf-tab-hydrology { --tab-color: #60a5fa; }
  .wf-tab-soils { --tab-color: #f59e0b; }
  /* Per-tab subsection theming */
  .wf-page-metadata { --wf-accent: #38bdf8; }
  .wf-page-vegetation { --wf-accent: #4ade80; }
  .wf-page-hydrology { --wf-accent: #60a5fa; }
  .wf-page-soils { --wf-accent: #f59e0b; }
  .wf-veg-tree { --wf-accent: #4ade80; }
  .wf-veg-shrub { --wf-accent: #c084fc; }
  .wf-veg-herb { --wf-accent: #60a5fa; }
  .wf-chevron { width: 38px; height: 38px; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; line-height: 1; font-weight: 700;
    border: 1px solid var(--wf-accent, var(--color-accent)); background: color-mix(in srgb, var(--wf-accent, var(--color-accent)) 18%, transparent);
    color: var(--wf-accent, var(--color-accent)); border-radius: var(--radius-sm); cursor: pointer; transition: transform .15s ease; }
  .wf-chevron.collapsed { transform: rotate(-90deg); }
  .wf-body { flex: 1; overflow-y: auto; padding: 14px 16px; max-width: 1100px; width: 100%; margin: 0 auto; }
  .wf-footer { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--color-border); background: var(--color-surface); }
  .wf-status { color: var(--color-accent); font-size: 13px; }
  .wf-foot-actions { margin-left: auto; display: flex; gap: 8px; }
  .wf-btn { padding: 10px 18px; border: 1px solid var(--color-border); background: transparent; color: var(--color-text); border-radius: var(--radius-sm); cursor: pointer; font-size: 14px; font-family: inherit; }
  .wf-btn:hover { border-color: var(--color-accent); color: var(--color-accent); background: var(--color-accent-dim); }
  .wf-btn.wf-primary { background: var(--color-accent); border-color: var(--color-accent); color: #04140d; font-weight: 700; }
  .wf-btn.wf-primary:hover { opacity: 0.9; color: #04140d; background: var(--color-accent); }
  .wf-mini { width: 34px; height: 34px; border: 1px solid var(--color-border); background: var(--color-surface-2); color: var(--color-text); border-radius: var(--radius-sm); cursor: pointer; font-size: 16px; }
  .wf-card { background: var(--color-surface); border: 1px solid var(--color-border); border-left: 5px solid var(--wf-accent, var(--color-accent)); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 12px; }
  .wf-card h4 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--wf-accent, var(--color-accent)); }
  /* Condensed inline rows: label + field on one line (Metadata / Hydrology) */
  .wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px 16px; }
  .wf-field { display: flex; align-items: center; gap: 10px; min-height: 38px; }
  .wf-field > label { flex: 0 0 44%; font-size: 14px; color: var(--color-text-dim); line-height: 1.2; }
  .wf-field input, .wf-field select, .wf-field textarea, .wf-soil-cell input, .wf-soil-cell select {
    flex: 1 1 auto; min-width: 0; width: 100%; padding: 9px 10px; border: 1px solid var(--color-border);
    background: var(--color-input-bg); color: var(--color-text); border-radius: var(--radius-sm); font-size: 15px; font-family: inherit; }
  .wf-field input:focus-visible, .wf-field select:focus-visible, .wf-field textarea:focus-visible,
  .wf-soil-cell input:focus-visible, .wf-soil-cell select:focus-visible { border-color: var(--color-accent); outline: none; }
  .wf-field.wf-field-block { flex-direction: column; align-items: stretch; gap: 5px; }
  .wf-field.wf-field-block > label { flex: none; }
  .wf-field textarea { min-height: 80px; resize: vertical; }
  .wf-veg-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .wf-veg-head h4 { margin: 0; }
  .wf-veg-controls { display: flex; align-items: center; gap: 8px; }
  .wf-count { min-width: 24px; text-align: center; font-weight: 700; font-size: 15px; }
  .wf-veg-table { display: flex; flex-direction: column; gap: 6px; }
  .wf-veg-row { display: grid; grid-template-columns: 26px 1fr 88px 36px; gap: 8px; align-items: center; }
  .wf-veg-header { font-size: 12px; color: var(--color-text-muted); }
  .wf-veg-row input[type=text], .wf-veg-row input[type=number] { padding: 9px 10px; border: 1px solid var(--color-border); background: var(--color-input-bg); color: var(--color-text); border-radius: var(--radius-sm); font-size: 15px; font-family: inherit; width: 100%; }
  .wf-veg-idx { text-align: center; color: var(--color-text-muted); font-weight: 600; }
  .wf-indices { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 14px; }
  .wf-muted { color: var(--color-text-muted); font-size: 13px; margin: 8px 0 0; }
  .wf-check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
  .wf-check { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.3; }
  .wf-check input { margin-top: 2px; width: 18px; height: 18px; flex-shrink: 0; }
  .wf-restrictive { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--color-text-dim); }
  .wf-soil-table { display: flex; flex-direction: column; gap: 8px; }
  .wf-soil-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
  .wf-soil-cell { display: flex; align-items: center; gap: 10px; min-height: 38px; }
  .wf-soil-cell > label { flex: 0 0 44%; font-size: 14px; color: var(--color-text-dim); line-height: 1.2; }
  .wf-photo-preview { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .wf-photo-item { position: relative; }
  .wf-photo-item img { width: 96px; height: 96px; object-fit: cover; border-radius: var(--radius-sm); border: 1px solid var(--color-border); }
  .wf-photo-item button { position: absolute; top: -6px; right: -6px; width: 22px; height: 22px; border-radius: 50%; border: none; background: var(--color-danger); color: #fff; cursor: pointer; }
  @media (max-width: 640px) {
    .wf-header { padding: 10px 12px; gap: 8px; }
    .wf-title { font-size: 15px; }
    .wf-tab { text-align: center; padding: 9px 4px; font-size: 13px; }
    .wf-body { padding: 12px; }
    .wf-grid, .wf-check-grid { grid-template-columns: 1fr; }
    .wf-indices { grid-template-columns: 1fr; }
    .wf-soil-row { grid-template-columns: 1fr; gap: 8px; }
    .wf-field > label, .wf-soil-cell > label { flex-basis: 46%; font-size: 15px; }
    .wf-field input, .wf-field select, .wf-soil-cell input, .wf-soil-cell select, .wf-veg-row input { font-size: 16px; padding: 11px 12px; }
    .wf-foot-actions { width: 100%; }
    .wf-foot-actions .wf-btn { flex: 1; }
    #wf-prev, #wf-next { display: none; }
  }
  `;
  document.head.appendChild(style);
}

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
          <div class="wf-title">Wetland Plot · <span class="wf-plotid">${escapeHtml(str(this.survey.PLOT_ID) || this.feature?.point_id || 'New Plot')}</span></div>
          <div class="wf-tabs" id="wf-tabs"></div>
          <button class="wf-close" id="wf-close" title="Close without saving">✕</button>
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
      b.className = 'wf-tab' + (i === this.activeTab ? ' active' : '');
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
    notesWrap.className = 'wf-field';
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
    wrap.className = 'wf-field';
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
      const minus = btn('−'); const count = document.createElement('span'); count.className = 'wf-count'; count.textContent = String(this.vegUi[g].count); const plus = btn('+'); const chev = btn(this.vegUi[g].collapsed ? '▸' : '▾');
      minus.onclick = () => { this.vegUi[g].count = Math.max(1, this.vegUi[g].count - 1); this.renderActivePage(); };
      plus.onclick = () => { this.vegUi[g].count = Math.min(this.vegUi[g].max, this.vegUi[g].count + 1); this.renderActivePage(); };
      chev.onclick = () => { this.vegUi[g].collapsed = !this.vegUi[g].collapsed; this.renderActivePage(); };
      controls.append(minus, count, plus, chev);
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
      const chev = btn(this.soilUi.horizons[h]?.collapsed ? '▸' : '▾');
      chev.onclick = () => { this.soilUi.horizons[h].collapsed = !this.soilUi.horizons[h].collapsed; this.renderActivePage(); };
      ctr.append(restLbl, chev);
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
  .wf-panel { position: fixed; inset: 0; z-index: 1400; background: var(--color-bg, #0f172a); color: var(--color-text, #e2e8f0);
    opacity: 0; transition: opacity .2s ease; overflow: hidden; }
  .wf-panel.open { opacity: 1; }
  .wf-inner { display: flex; flex-direction: column; height: 100%; }
  .wf-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--color-border, #334155); background: var(--color-surface, #1e293b); flex-wrap: wrap; }
  .wf-title { font-weight: 600; font-size: 14px; }
  .wf-plotid { color: #0fbf8f; }
  .wf-tabs { display: flex; gap: 6px; margin-left: auto; }
  .wf-tab { padding: 6px 12px; border: 1px solid var(--color-border, #334155); background: transparent; color: inherit; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .wf-tab.active { background: #0b6b50; border-color: #0b6b50; color: #fff; }
  .wf-close { background: transparent; border: none; color: inherit; font-size: 18px; cursor: pointer; padding: 4px 8px; }
  .wf-body { flex: 1; overflow-y: auto; padding: 14px; max-width: 1100px; width: 100%; margin: 0 auto; }
  .wf-footer { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-top: 1px solid var(--color-border, #334155); background: var(--color-surface, #1e293b); }
  .wf-status { color: #0fbf8f; font-size: 13px; }
  .wf-foot-actions { margin-left: auto; display: flex; gap: 8px; }
  .wf-btn { padding: 8px 14px; border: 1px solid var(--color-border, #334155); background: var(--color-surface, #1e293b); color: inherit; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .wf-btn.wf-primary { background: #0b6b50; border-color: #0b6b50; color: #fff; font-weight: 600; }
  .wf-mini { width: 28px; height: 28px; border: 1px solid var(--color-border, #334155); background: var(--color-surface, #1e293b); color: inherit; border-radius: 6px; cursor: pointer; }
  .wf-card { background: var(--color-surface, #1e293b); border: 1px solid var(--color-border, #334155); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
  .wf-card h4 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: .03em; color: #0fbf8f; }
  .wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  .wf-field { display: flex; flex-direction: column; gap: 4px; }
  .wf-field label { font-size: 12px; color: var(--color-text-muted, #94a3b8); }
  .wf-field input, .wf-field select, .wf-field textarea, .wf-soil-cell input, .wf-soil-cell select { padding: 7px 8px; border: 1px solid var(--color-border, #334155); background: var(--color-bg, #0f172a); color: inherit; border-radius: 6px; font-size: 13px; width: 100%; }
  .wf-field textarea { min-height: 70px; resize: vertical; }
  .wf-veg-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .wf-veg-head h4 { margin: 0; }
  .wf-veg-controls { display: flex; align-items: center; gap: 6px; }
  .wf-count { min-width: 22px; text-align: center; font-weight: 600; }
  .wf-veg-table { display: flex; flex-direction: column; gap: 6px; }
  .wf-veg-row { display: grid; grid-template-columns: 28px 1fr 90px 40px; gap: 8px; align-items: center; }
  .wf-veg-header { font-size: 11px; color: var(--color-text-muted, #94a3b8); }
  .wf-veg-row input[type=text], .wf-veg-row input[type=number] { padding: 6px 8px; border: 1px solid var(--color-border, #334155); background: var(--color-bg, #0f172a); color: inherit; border-radius: 6px; font-size: 13px; }
  .wf-veg-idx { text-align: center; color: var(--color-text-muted, #94a3b8); }
  .wf-indices { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 13px; }
  .wf-muted { color: var(--color-text-muted, #94a3b8); font-size: 12px; margin: 8px 0 0; }
  .wf-check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; }
  .wf-check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; }
  .wf-restrictive { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-muted, #94a3b8); }
  .wf-soil-table { display: flex; flex-direction: column; gap: 8px; }
  .wf-soil-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .wf-soil-cell { display: flex; flex-direction: column; gap: 4px; }
  .wf-soil-cell label { font-size: 12px; color: var(--color-text-muted, #94a3b8); }
  .wf-photo-preview { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .wf-photo-item { position: relative; }
  .wf-photo-item img { width: 90px; height: 90px; object-fit: cover; border-radius: 6px; border: 1px solid var(--color-border, #334155); }
  .wf-photo-item button { position: absolute; top: -6px; right: -6px; width: 20px; height: 20px; border-radius: 50%; border: none; background: #dc2626; color: #fff; cursor: pointer; }
  @media (max-width: 640px) { .wf-indices { grid-template-columns: 1fr; } .wf-soil-row { grid-template-columns: 1fr; } .wf-tabs { width: 100%; order: 3; } }
  `;
  document.head.appendChild(style);
}

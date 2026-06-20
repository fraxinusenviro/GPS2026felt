/**
 * Collapsible floating HUD shown while a survey is in progress. Owns the live
 * timer, summary stats, the observation list, and the species–time canvas curve.
 * Ported from NSINV (timer, renderStats, renderObservations, drawCurve).
 */
import type { InventorySurvey } from '../types';
import {
  formatElapsed, getElapsed, isSoCI, taxonIcon, escapeHtml,
  realObservations, uniqueSpeciesCount, TAXON_GROUP_MAP, REPORT_GROUP_ORDER,
} from './inventorySurvey';

export interface HUDCallbacks {
  onAddObs: () => void;
  onTogglePause: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onDeleteObs: (obsId: string) => void;
  onUpdateNotes: (obsId: string, notes: string) => void;
  onZoomObs: (obsId: string) => void;
}

type SortMode = 'newest' | 'oldest' | 'taxon';

export class InventoryHUD {
  private survey: InventorySurvey | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sortMode: SortMode = 'newest';
  private wired = false;

  constructor(private cb: HUDCallbacks) {}

  private el(id: string): HTMLElement | null { return document.getElementById(id); }

  show(survey: InventorySurvey): void {
    this.survey = survey;
    const hud = this.el('inv-hud');
    if (!hud) return;
    hud.style.display = 'flex';
    hud.classList.remove('collapsed');
    this.wire();
    this.update();
    this.startTimer();
  }

  hide(): void {
    this.stopTimer();
    this.survey = null;
    const hud = this.el('inv-hud');
    if (hud) hud.style.display = 'none';
  }

  setSurvey(survey: InventorySurvey): void { this.survey = survey; }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      const t = this.el('inv-hud-timer');
      if (t) t.textContent = formatElapsed(getElapsed(this.survey));
      this.updateSinceLast();
    }, 1000);
  }
  private stopTimer(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  private wire(): void {
    if (this.wired) return;
    this.wired = true;
    this.el('inv-hud-collapse')?.addEventListener('click', () => {
      this.el('inv-hud')?.classList.toggle('collapsed');
    });
    this.el('inv-hud-add')?.addEventListener('click', () => this.cb.onAddObs());
    this.el('inv-hud-pause')?.addEventListener('click', () => this.cb.onTogglePause());
    this.el('inv-hud-savedraft')?.addEventListener('click', () => this.cb.onSaveDraft());
    this.el('inv-hud-submit')?.addEventListener('click', () => this.cb.onSubmit());
    this.el('inv-hud-sort')?.addEventListener('click', () => this.cycleSort());

    const list = this.el('inv-obs-list');
    if (list) {
      list.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const row = target.closest<HTMLElement>('[data-obs-id]');
        if (!row) return;
        const id = row.dataset.obsId!;
        if (target.closest('.inv-obs-del')) { this.cb.onDeleteObs(id); return; }
        if (target.closest('.inv-obs-zoom')) { this.cb.onZoomObs(id); return; }
        row.querySelector('.inv-obs-details')?.classList.toggle('open');
      });
      list.addEventListener('input', (e) => {
        const inp = e.target as HTMLInputElement;
        if (!inp.classList.contains('inv-obs-notes')) return;
        const row = inp.closest<HTMLElement>('[data-obs-id]');
        if (row) this.cb.onUpdateNotes(row.dataset.obsId!, inp.value);
      });
    }
  }

  private cycleSort(): void {
    const modes: SortMode[] = ['newest', 'oldest', 'taxon'];
    this.sortMode = modes[(modes.indexOf(this.sortMode) + 1) % modes.length];
    const lbl = this.el('inv-hud-sort');
    if (lbl) lbl.textContent = { newest: 'NEW→OLD', oldest: 'OLD→NEW', taxon: 'BY TAXON' }[this.sortMode];
    this.renderObservations();
  }

  setPauseLabel(paused: boolean): void {
    const btn = this.el('inv-hud-pause');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    this.el('inv-hud-timer')?.classList.toggle('paused', paused);
  }

  update(): void {
    if (!this.survey) return;
    const t = this.el('inv-hud-timer');
    if (t) t.textContent = formatElapsed(getElapsed(this.survey));
    this.renderStats();
    this.renderObservations();
    this.drawCurve();
  }

  private updateSinceLast(): void {
    const el = this.el('inv-stat-since');
    if (!el || !this.survey || !this.survey.observations.length) { if (el) el.textContent = '—'; return; }
    const last = this.survey.observations[this.survey.observations.length - 1];
    const sec = Math.floor((Date.now() - last.timestamp) / 1000);
    const m = Math.floor(sec / 60), s = sec % 60;
    el.textContent = m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  private renderStats(): void {
    if (!this.survey) return;
    const obs = realObservations(this.survey);
    const unique = uniqueSpeciesCount(obs);
    const sociObs = obs.filter(o => isSoCI(o.species));
    const sociSp = uniqueSpeciesCount(sociObs);
    const set = (id: string, v: string | number) => { const e = this.el(id); if (e) e.textContent = String(v); };
    set('inv-stat-unique', unique);
    set('inv-stat-total', obs.length);
    set('inv-stat-soci-sp', `${sociSp} spp`);
    set('inv-stat-soci-obs', `${sociObs.length} obs`);
  }

  private renderObservations(): void {
    const list = this.el('inv-obs-list');
    const empty = this.el('inv-obs-empty');
    const obs = this.survey ? this.survey.observations : [];
    if (!list) return;
    if (!obs.length) { list.innerHTML = ''; if (empty) empty.style.display = ''; return; }
    if (empty) empty.style.display = 'none';

    const indexed = obs.map((o, idx) => ({ o, idx }));
    let ordered: typeof indexed;
    if (this.sortMode === 'taxon') {
      const rank: Record<string, number> = {};
      REPORT_GROUP_ORDER.forEach((g, i) => { rank[g] = i; });
      ordered = [...indexed].sort((a, b) => {
        const ga = rank[TAXON_GROUP_MAP[a.o.species.taxon] || a.o.species.taxon] ?? 999;
        const gb = rank[TAXON_GROUP_MAP[b.o.species.taxon] || b.o.species.taxon] ?? 999;
        if (ga !== gb) return ga - gb;
        return (a.o.species.commonName || '').localeCompare(b.o.species.commonName || '');
      });
    } else {
      ordered = this.sortMode === 'newest' ? [...indexed].reverse() : indexed;
    }

    list.innerHTML = ordered.map(({ o }, displayPos) => {
      const sp = o.species;
      const soci = isSoCI(sp);
      const exotic = sp.noteRank && /Exotic/i.test(sp.noteRank);
      const displayNum = this.sortMode === 'newest' ? obs.length - displayPos : displayPos + 1;
      const badges: string[] = [];
      if (sp.srank) badges.push(`<span class="inv-obs-badge inv-srank-tag">${escapeHtml(sp.srank)}</span>`);
      if (soci) badges.push(`<span class="inv-obs-badge inv-soci-tag">SoCI</span>`);
      if (exotic) badges.push(`<span class="inv-obs-badge inv-exotic-tag">Exotic</span>`);
      return `<div class="inv-obs-row${soci ? ' soci' : ''}" data-obs-id="${o.id}">
        <div class="inv-obs-summary">
          <span class="inv-obs-num">${displayNum}</span>
          <span class="inv-obs-emoji" title="${escapeHtml(sp.taxon)}">${taxonIcon(sp.taxon)}</span>
          <span class="inv-obs-name">
            <span class="inv-obs-common">${escapeHtml(sp.commonName || sp.mcode || sp.taxon)}</span>
            ${sp.scientificName ? `<em class="inv-obs-sci">${escapeHtml(sp.scientificName)}</em>` : ''}
            ${badges.join('')}
          </span>
          <span class="inv-obs-btns">
            <button class="inv-obs-zoom" title="Zoom to observation" aria-label="Zoom">◎</button>
            <button class="inv-obs-del" title="Remove observation" aria-label="Remove">✕</button>
          </span>
        </div>
        <div class="inv-obs-details">
          <div class="inv-obs-meta">
            ${sp.family ? `<span><strong>Family:</strong> ${escapeHtml(sp.family)}</span>` : ''}
            <span><strong>Lat/Lng:</strong> ${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}</span>
            <span><strong>Time:</strong> ${new Date(o.timestamp).toLocaleTimeString()}</span>
          </div>
          <input class="inv-obs-notes inv-input" type="text" placeholder="Notes…" value="${escapeHtml(o.notes)}" />
        </div>
      </div>`;
    }).join('');
  }

  private drawCurve(): void {
    const canvas = this.el('inv-species-curve') as HTMLCanvasElement | null;
    if (!canvas || !this.survey) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    const obs = this.survey.observations.filter(o =>
      !['Survey Start', 'Survey End'].includes(o.species.taxon) && o.species.elcode);
    if (obs.length < 2) {
      ctx.fillStyle = 'rgba(34,197,94,0.45)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
      ctx.fillText('Add ≥2 identified species to see the curve', W / 2, H / 2);
      return;
    }
    const sorted = [...obs].sort((a, b) => a.timestamp - b.timestamp);
    const seen = new Set<string>(); const points: { t: number; n: number }[] = [];
    sorted.forEach(o => { seen.add(o.species.elcode); points.push({ t: o.timestamp, n: seen.size }); });
    const pad = { top: 16, right: 16, bottom: 28, left: 36 };
    const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom;
    const t0 = points[0].t, t1 = points[points.length - 1].t, tRange = t1 - t0 || 1, maxN = points[points.length - 1].n;
    const tx = (t: number) => pad.left + ((t - t0) / tRange) * pw;
    const ty = (n: number) => pad.top + ph - (n / maxN) * ph;
    ctx.strokeStyle = 'rgba(120,150,120,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { const y = pad.top + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pw, y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(tx(points[0].t), ty(0));
    points.forEach(p => ctx.lineTo(tx(p.t), ty(p.n)));
    ctx.lineTo(tx(points[points.length - 1].t), ty(0)); ctx.closePath();
    ctx.fillStyle = 'rgba(34,197,94,0.14)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx(points[0].t), ty(points[0].n));
    points.forEach(p => ctx.lineTo(tx(p.t), ty(p.n)));
    ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(120,150,120,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top + ph); ctx.lineTo(pad.left + pw, pad.top + ph); ctx.stroke();
    ctx.fillStyle = '#7a9a60'; ctx.textAlign = 'right'; ctx.font = '10px monospace';
    [0, Math.round(maxN / 2), maxN].forEach(n => ctx.fillText(String(n), pad.left - 4, ty(n) + 4));
    ctx.textAlign = 'center'; ctx.fillText(`${Math.round(tRange / 60000)}min`, pad.left + pw / 2, H - 4);
  }
}

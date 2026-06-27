import * as turf from '@turf/turf';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from './CaptureManager';
import { haversineDistance } from '../utils/coordinates';

type LngLat = [number, number];

/**
 * Circle / ellipse drawing tool (first SHAPES tool after the v4 reset).
 *
 * Tap the map to set a center and drag to size the shape (live dashed radius line,
 * center point and an "R: NN m" badge). A pure tap (no drag) applies the radius
 * typed in the options card. "Constrain to circle" → perfect circle; unchecked →
 * free ellipse. The result is saved as an ordinary Polygon project-data feature
 * (with the selected TypePreset). One shape per activation, then auto-disarm.
 */
export class CircleTool {
  private active = false;
  private center: LngLat | null = null;
  private moved = false;
  private pointerCleanup: (() => void) | null = null;
  private onComplete: (() => void) | null = null;

  private static readonly STEPS = 64;
  private static readonly DRAG_PX = 4; // movement past this = a drag, not a tap

  constructor(private mapManager: MapManager, private captureManager: CaptureManager) {}

  setOnComplete(fn: () => void): void { this.onComplete = fn; }
  isActive(): boolean { return this.active; }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.center = null;
    this.moved = false;
    this.captureManager.setTool('sketch-shape');
    const map = this.mapManager.getMap();
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    this.attachPointerEvents();
    document.getElementById('circle-options')?.classList.remove('hidden');
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.detachPointerEvents();
    const map = this.mapManager.getMap();
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    this.mapManager.clearSketchPreview();
    document.getElementById('circle-options')?.classList.add('hidden');
    this.hideBadge();
    this.captureManager.setTool('none');
  }

  // ---- options-card reads ----
  private isConstrained(): boolean {
    return (document.getElementById('circle-constrain') as HTMLInputElement | null)?.checked ?? true;
  }
  private fieldRadiusM(): number {
    const v = parseFloat((document.getElementById('circle-radius') as HTMLInputElement | null)?.value ?? '50');
    return isNaN(v) || v <= 0 ? 50 : v;
  }
  private setFieldRadius(m: number): void {
    const el = document.getElementById('circle-radius') as HTMLInputElement | null;
    if (el) el.value = String(Math.round(m * 10) / 10);
  }
  private selectedType(): string {
    return (document.getElementById('circle-type') as HTMLSelectElement | null)?.value ?? '';
  }

  // ---- geometry ----
  /** Ring (open — closing dup dropped) for a circle of radiusM, or an ellipse with x/y semi-axes. */
  private buildRing(center: LngLat, xM: number, yM: number, constrained: boolean): LngLat[] {
    const feat = constrained
      ? turf.circle(center, Math.max(0.1, xM) / 1000, { steps: CircleTool.STEPS, units: 'kilometers' })
      : turf.ellipse(center, Math.max(0.1, xM) / 1000, Math.max(0.1, yM) / 1000, { steps: CircleTool.STEPS, units: 'kilometers' });
    return feat.geometry.coordinates[0] as LngLat[];
  }

  private preview(center: LngLat, cursor: LngLat, ring: LngLat[]): void {
    this.mapManager.updateSketchPreview([
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [center, cursor] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} },
    ]);
  }

  // ---- live radius badge ----
  private showBadge(at: LngLat, text: string): void {
    const badge = document.getElementById('shape-radius-badge');
    if (!badge) return;
    const p = this.mapManager.getMap().project(at);
    badge.style.left = `${p.x}px`;
    badge.style.top = `${p.y}px`;
    badge.textContent = text;
    badge.classList.remove('hidden');
  }
  private hideBadge(): void {
    document.getElementById('shape-radius-badge')?.classList.add('hidden');
  }

  // ---- pointer overlay (mirrors the freehand press-drag pattern) ----
  private attachPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();
    let downXY: { x: number; y: number } | null = null;

    const toLngLat = (e: PointerEvent): LngLat => {
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      return [ll.lng, ll.lat];
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.center = toLngLat(e);
      this.moved = false;
      downXY = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!this.center || !downXY || !e.buttons) return;
      e.preventDefault();
      if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > CircleTool.DRAG_PX) this.moved = true;
      if (!this.moved) return;
      const cursor = toLngLat(e);
      const constrained = this.isConstrained();
      const [cLng, cLat] = this.center;
      const xM = constrained
        ? haversineDistance(cLat, cLng, cursor[1], cursor[0])
        : haversineDistance(cLat, cLng, cLat, cursor[0]);
      const yM = constrained ? xM : haversineDistance(cLat, cLng, cursor[1], cLng);
      const ring = this.buildRing(this.center, xM, yM, constrained);
      this.preview(this.center, cursor, ring);
      if (constrained) this.setFieldRadius(xM);
      this.showBadge(cursor, constrained
        ? `R: ${Math.round(xM)} m`
        : `${Math.round(xM)} × ${Math.round(yM)} m`);
    };
    const onUp = (e: PointerEvent) => {
      if (!this.center) return;
      const center = this.center;
      const constrained = this.isConstrained();
      let ring: LngLat[];
      if (this.moved) {
        const cursor = toLngLat(e);
        const [cLng, cLat] = center;
        const xM = constrained
          ? haversineDistance(cLat, cLng, cursor[1], cursor[0])
          : haversineDistance(cLat, cLng, cLat, cursor[0]);
        const yM = constrained ? xM : haversineDistance(cLat, cLng, cursor[1], cLng);
        ring = this.buildRing(center, xM, yM, constrained);
      } else {
        // Pure tap → apply the typed radius.
        const r = this.fieldRadiusM();
        ring = this.buildRing(center, r, r, true);
      }
      this.center = null;
      downXY = null;
      void this.finalize(ring);
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    this.pointerCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }

  private detachPointerEvents(): void {
    this.pointerCleanup?.();
    this.pointerCleanup = null;
  }

  private async finalize(ring: LngLat[]): Promise<void> {
    this.mapManager.clearSketchPreview();
    this.hideBadge();
    if (ring.length >= 4) {
      await this.captureManager.saveSketchFromCoords('Polygon', ring, this.selectedType(), '');
    }
    this.onComplete?.();
  }
}

import * as turf from '@turf/turf';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from './CaptureManager';
import { haversineDistance } from '../utils/coordinates';

type LngLat = [number, number];

/** Which shape the tool currently draws. 'ngon' is a regular N-sided polygon. */
export type ShapeKind = 'rectangle' | 'triangle' | 'ngon';

/**
 * Rectangle / triangle / regular N-gon drawing tool (the SHAPES sub-tools after
 * Circle). Mirrors the CircleTool interaction model and shares the same options
 * card (#shape-options), preview layers and radius badge.
 *
 * Rectangle: tap a corner and drag to the opposite corner for a map-axis-aligned
 * box ("Constrain to square" forces equal sides); a pure tap drops a centered
 * square sized by the Size field.
 *
 * Triangle / N-gon: tap to set the center and drag to set the radius and
 * orientation (the dragged vertex follows the cursor); a pure tap applies the
 * typed Size as the radius with the shape pointing north. The N-gon's side count
 * comes from the Sides field (default 5). The result is saved as an ordinary
 * Polygon project-data feature with the selected TypePreset, then auto-disarms.
 */
export class ShapeTool {
  private active = false;
  private kind: ShapeKind = 'rectangle';
  private anchor: LngLat | null = null; // first corner (rectangle) or center (triangle/ngon)
  private moved = false;
  private pointerCleanup: (() => void) | null = null;
  private onComplete: (() => void) | null = null;

  private static readonly DRAG_PX = 4; // movement past this = a drag, not a tap

  constructor(private mapManager: MapManager, private captureManager: CaptureManager) {}

  setOnComplete(fn: () => void): void { this.onComplete = fn; }
  isActive(): boolean { return this.active; }
  getKind(): ShapeKind { return this.kind; }

  activate(kind: ShapeKind): void {
    if (this.active) this.deactivate();
    this.active = true;
    this.kind = kind;
    this.anchor = null;
    this.moved = false;
    this.captureManager.setTool('sketch-shape');
    const map = this.mapManager.getMap();
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    this.attachPointerEvents();
    document.getElementById('shape-options')?.classList.remove('hidden');
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.detachPointerEvents();
    const map = this.mapManager.getMap();
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    this.mapManager.clearSketchPreview();
    document.getElementById('shape-options')?.classList.add('hidden');
    this.hideBadge();
    this.captureManager.setTool('none');
  }

  // ---- options-card reads ----
  private isSquare(): boolean {
    return (document.getElementById('shape-constrain') as HTMLInputElement | null)?.checked ?? false;
  }
  private fieldSizeM(): number {
    const v = parseFloat((document.getElementById('shape-size') as HTMLInputElement | null)?.value ?? '50');
    return isNaN(v) || v <= 0 ? 50 : v;
  }
  private setFieldSize(m: number): void {
    const el = document.getElementById('shape-size') as HTMLInputElement | null;
    if (el) el.value = String(Math.round(m * 10) / 10);
  }
  /** Number of sides for a regular polygon (clamped to 3..24); triangle is fixed at 3. */
  private sides(): number {
    if (this.kind === 'triangle') return 3;
    const v = parseInt((document.getElementById('shape-sides') as HTMLInputElement | null)?.value ?? '5', 10);
    if (isNaN(v)) return 5;
    return Math.max(3, Math.min(24, v));
  }
  private selectedType(): string {
    return (document.getElementById('shape-type') as HTMLSelectElement | null)?.value ?? '';
  }

  // ---- geometry ----
  /** Closed ring (first vertex repeated) for a regular polygon centered at `center`. */
  private ngonRing(center: LngLat, radiusM: number, sides: number, rotationDeg: number): LngLat[] {
    const ring: LngLat[] = [];
    const r = Math.max(0.1, radiusM) / 1000;
    for (let i = 0; i < sides; i++) {
      const bearing = rotationDeg + (360 / sides) * i;
      const d = turf.destination(center, r, bearing, { units: 'kilometers' });
      ring.push(d.geometry.coordinates as LngLat);
    }
    ring.push(ring[0]);
    return ring;
  }

  /** Closed ring for a map-axis-aligned box from corner `a` to opposite corner `b`. */
  private boxRing(a: LngLat, b: LngLat, square: boolean): LngLat[] {
    let bLng = b[0], bLat = b[1];
    if (square) {
      const wM = haversineDistance(a[1], a[0], a[1], b[0]);
      const hM = haversineDistance(a[1], a[0], b[1], a[0]);
      const side = Math.max(wM, hM) / 1000;
      const ew = b[0] >= a[0] ? 90 : 270;
      const ns = b[1] >= a[1] ? 0 : 180;
      bLng = (turf.destination(a, side, ew, { units: 'kilometers' }).geometry.coordinates as LngLat)[0];
      bLat = (turf.destination(a, side, ns, { units: 'kilometers' }).geometry.coordinates as LngLat)[1];
    }
    return [[a[0], a[1]], [bLng, a[1]], [bLng, bLat], [a[0], bLat], [a[0], a[1]]];
  }

  /** Closed ring for a square of side `sideM` centered on `center`. */
  private centeredSquare(center: LngLat, sideM: number): LngLat[] {
    const half = sideM / 2 / 1000;
    const eLng = (turf.destination(center, half, 90, { units: 'kilometers' }).geometry.coordinates as LngLat)[0];
    const wLng = (turf.destination(center, half, 270, { units: 'kilometers' }).geometry.coordinates as LngLat)[0];
    const nLat = (turf.destination(center, half, 0, { units: 'kilometers' }).geometry.coordinates as LngLat)[1];
    const sLat = (turf.destination(center, half, 180, { units: 'kilometers' }).geometry.coordinates as LngLat)[1];
    return [[wLng, sLat], [eLng, sLat], [eLng, nLat], [wLng, nLat], [wLng, sLat]];
  }

  /** Build the live ring during a drag from `anchor` to `cursor`. */
  private dragRing(anchor: LngLat, cursor: LngLat): { ring: LngLat[]; badge: string } {
    if (this.kind === 'rectangle') {
      const ring = this.boxRing(anchor, cursor, this.isSquare());
      const w = haversineDistance(anchor[1], anchor[0], anchor[1], ring[1][0]);
      const h = haversineDistance(anchor[1], anchor[0], ring[2][1], anchor[0]);
      return { ring, badge: `${Math.round(w)} × ${Math.round(h)} m` };
    }
    const radiusM = haversineDistance(anchor[1], anchor[0], cursor[1], cursor[0]);
    const rotation = turf.bearing(anchor, cursor);
    const ring = this.ngonRing(anchor, radiusM, this.sides(), rotation);
    this.setFieldSize(radiusM);
    return { ring, badge: `R: ${Math.round(radiusM)} m` };
  }

  private preview(anchor: LngLat, cursor: LngLat, ring: LngLat[]): void {
    this.mapManager.updateSketchPreview([
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [anchor, cursor] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: anchor }, properties: {} },
    ]);
  }

  // ---- live readout badge ----
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

  // ---- pointer overlay (mirrors CircleTool) ----
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
      this.anchor = toLngLat(e);
      this.moved = false;
      downXY = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!this.anchor || !downXY || !e.buttons) return;
      e.preventDefault();
      if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > ShapeTool.DRAG_PX) this.moved = true;
      if (!this.moved) return;
      const cursor = toLngLat(e);
      const { ring, badge } = this.dragRing(this.anchor, cursor);
      this.preview(this.anchor, cursor, ring);
      this.showBadge(cursor, badge);
    };
    const onUp = (e: PointerEvent) => {
      if (!this.anchor) return;
      const anchor = this.anchor;
      let ring: LngLat[];
      if (this.moved) {
        ring = this.dragRing(anchor, toLngLat(e)).ring;
      } else if (this.kind === 'rectangle') {
        ring = this.centeredSquare(anchor, this.fieldSizeM());
      } else {
        ring = this.ngonRing(anchor, this.fieldSizeM(), this.sides(), 0);
      }
      this.anchor = null;
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

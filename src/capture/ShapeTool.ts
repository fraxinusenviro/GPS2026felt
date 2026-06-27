import * as turf from '@turf/turf';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from './CaptureManager';
import { haversineDistance } from '../utils/coordinates';

type LngLat = [number, number];

/** Which shape the tool currently draws. 'ngon' is a regular N-sided polygon. */
export type ShapeKind = 'rectangle' | 'triangle' | 'ngon';
type TriType = 'equilateral' | 'isosceles' | 'right';

/**
 * Rectangle / triangle / regular N-gon drawing tool (the SHAPES sub-tools after
 * Circle). Mirrors the CircleTool interaction model and shares the same options
 * card (#shape-options), preview layers and readout badge.
 *
 * Rectangle: tap a corner and drag to the opposite corner for a map-axis-aligned
 * box (the Width / Height fields track the drag; "Constrain to square" forces
 * equal sides); a pure tap drops a centered rectangle of the typed Width × Height.
 *
 * Triangle: the user picks a triangle type (equilateral → Side; isosceles /
 * right-angled → Base + Height) and the shape is built from those exact
 * dimensions, centered on the tap. Dragging rotates it toward the cursor.
 *
 * N-gon: Sides + Radius, where the Radius mode states whether the radius is the
 * outer (circumscribed, to a vertex) or inner (inscribed, to a side) enclosing
 * circle. Tap to set the center and drag to size + rotate; a pure tap applies the
 * typed radius pointing north.
 *
 * All shapes save as an ordinary Polygon project-data feature with the selected
 * TypePreset, then auto-disarm.
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
  private num(id: string, fallback: number): number {
    const v = parseFloat((document.getElementById(id) as HTMLInputElement | null)?.value ?? '');
    return isNaN(v) || v <= 0 ? fallback : v;
  }
  private setNum(id: string, m: number): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = String(Math.round(m * 10) / 10);
  }
  private str(id: string, fallback: string): string {
    return (document.getElementById(id) as HTMLSelectElement | null)?.value ?? fallback;
  }
  private isSquare(): boolean {
    return (document.getElementById('f-square') as HTMLInputElement | null)?.checked ?? false;
  }
  private sides(): number {
    const v = Math.round(this.num('f-sides', 5));
    return Math.max(3, Math.min(24, v));
  }
  private selectedType(): string {
    return (document.getElementById('shape-type') as HTMLSelectElement | null)?.value ?? '';
  }

  // ---- geometry helpers ----
  /** Move `center` by east/north metre offsets (signed). */
  private offset(center: LngLat, eastM: number, northM: number): LngLat {
    let p = center;
    if (Math.abs(eastM) > 1e-6)
      p = turf.destination(p, Math.abs(eastM) / 1000, eastM >= 0 ? 90 : 270, { units: 'kilometers' }).geometry.coordinates as LngLat;
    if (Math.abs(northM) > 1e-6)
      p = turf.destination(p, Math.abs(northM) / 1000, northM >= 0 ? 0 : 180, { units: 'kilometers' }).geometry.coordinates as LngLat;
    return p;
  }

  /** Place local (east, north) metre vertices around `center`, rotated `rotationDeg` clockwise from north. */
  private placeLocal(center: LngLat, pts: Array<[number, number]>, rotationDeg: number): LngLat[] {
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const ring = pts.map(([e, n]) => this.offset(center, e * cos + n * sin, -e * sin + n * cos));
    ring.push(ring[0]);
    return ring;
  }

  /** Closed ring for a regular polygon (circumradius `R`) centered at `center`. */
  private ngonRing(center: LngLat, R: number, sides: number, rotationDeg: number): LngLat[] {
    const ring: LngLat[] = [];
    const r = Math.max(0.1, R) / 1000;
    for (let i = 0; i < sides; i++) {
      const bearing = rotationDeg + (360 / sides) * i;
      ring.push(turf.destination(center, r, bearing, { units: 'kilometers' }).geometry.coordinates as LngLat);
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
      bLng = (turf.destination(a, side, b[0] >= a[0] ? 90 : 270, { units: 'kilometers' }).geometry.coordinates as LngLat)[0];
      bLat = (turf.destination(a, side, b[1] >= a[1] ? 0 : 180, { units: 'kilometers' }).geometry.coordinates as LngLat)[1];
    }
    return [[a[0], a[1]], [bLng, a[1]], [bLng, bLat], [a[0], bLat], [a[0], a[1]]];
  }

  /** Local (east, north) vertices for a triangle of the current type, centroid at origin, apex north. */
  private triangleLocal(): Array<[number, number]> {
    const type = this.str('f-tritype', 'equilateral') as TriType;
    if (type === 'isosceles') {
      const b = this.num('f-base', 100), h = this.num('f-theight', 80);
      return [[0, (2 * h) / 3], [-b / 2, -h / 3], [b / 2, -h / 3]];
    }
    if (type === 'right') {
      const b = this.num('f-base', 100), h = this.num('f-theight', 80);
      return [[-b / 3, -h / 3], [(2 * b) / 3, -h / 3], [-b / 3, (2 * h) / 3]];
    }
    // equilateral: regular triangle, circumradius = side / √3.
    const s = this.num('f-side', 100), R = s / Math.sqrt(3);
    return [[0, R], [-R * Math.sin((2 * Math.PI) / 3), R * Math.cos((2 * Math.PI) / 3)],
            [R * Math.sin((2 * Math.PI) / 3), R * Math.cos((2 * Math.PI) / 3)]];
  }

  /** Circumradius implied by the N-gon radius field + radius mode. */
  private ngonCircumradius(): number {
    const v = this.num('f-radius', 50);
    return this.str('f-radmode', 'circ') === 'insc' ? v / Math.cos(Math.PI / this.sides()) : v;
  }

  /** Build the live ring during a drag from `anchor` to `cursor`. */
  private dragRing(anchor: LngLat, cursor: LngLat): { ring: LngLat[]; badge: string } {
    if (this.kind === 'rectangle') {
      const ring = this.boxRing(anchor, cursor, this.isSquare());
      const w = haversineDistance(anchor[1], anchor[0], anchor[1], ring[1][0]);
      const h = haversineDistance(anchor[1], anchor[0], ring[2][1], anchor[0]);
      this.setNum('f-width', w);
      this.setNum('f-rheight', h);
      return { ring, badge: `${Math.round(w)} × ${Math.round(h)} m` };
    }
    const rotation = turf.bearing(anchor, cursor);
    if (this.kind === 'triangle') {
      return { ring: this.placeLocal(anchor, this.triangleLocal(), rotation), badge: `${Math.round((rotation + 360) % 360)}°` };
    }
    // ngon: vertex follows the cursor → circumradius = drag distance.
    const R = haversineDistance(anchor[1], anchor[0], cursor[1], cursor[0]);
    const sides = this.sides();
    const insc = this.str('f-radmode', 'circ') === 'insc';
    const shown = insc ? R * Math.cos(Math.PI / sides) : R;
    this.setNum('f-radius', shown);
    return { ring: this.ngonRing(anchor, R, sides, rotation), badge: `${insc ? 'r' : 'R'}: ${Math.round(shown)} m` };
  }

  /** Build the ring for a pure tap (no drag) at `anchor`, pointing north. */
  private tapRing(anchor: LngLat): LngLat[] {
    if (this.kind === 'rectangle') {
      const w = this.num('f-width', 100) / 2, h = this.num('f-rheight', 60) / 2;
      return this.placeLocal(anchor, [[-w, -h], [w, -h], [w, h], [-w, h]], 0);
    }
    if (this.kind === 'triangle') return this.placeLocal(anchor, this.triangleLocal(), 0);
    return this.ngonRing(anchor, this.ngonCircumradius(), this.sides(), 0);
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
      const ring = this.moved ? this.dragRing(anchor, toLngLat(e)).ring : this.tapRing(anchor);
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

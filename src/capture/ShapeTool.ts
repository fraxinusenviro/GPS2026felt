import * as turf from '@turf/turf';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from './CaptureManager';
import type { ShapeKind, ShapeMethod, ShapeTarget, ShapeParams } from '../types';
import { haversineDistance } from '../utils/coordinates';
import { EventBus } from '../utils/EventBus';

type LngLat = [number, number];
type Built = { geomType: 'LineString' | 'Polygon'; coords: LngLat[] };

const DEFAULT_PARAMS: ShapeParams = {
  radiusM: 50, majorM: 80, minorM: 40, widthM: 100, heightM: 60,
  rotationDeg: 0, startAngleDeg: 0, endAngleDeg: 180, segments: 64,
  sides: 6, bufferM: 25,
};

// Shapes that build from a centre/anchor by dragging out a radius or corner.
const DRAG_KINDS: ShapeKind[] = ['circle', 'ellipse', 'rectangle', 'square', 'ngon', 'arc'];

/**
 * Interactive drawing of standard geometric shapes. Produces ordinary project-data
 * LineString/Polygon features (via CaptureManager) or, when the target is
 * 'annotation', hands the geometry to an annotation sink. Mirrors the freehand
 * press-drag overlay pattern; bezier/buffer are click-driven and routed in from
 * App.wireMapInteractions.
 */
export class ShapeTool {
  private kind: ShapeKind = 'circle';
  private method: ShapeMethod = 'drag';
  private target: ShapeTarget = 'data';
  private params: ShapeParams = { ...DEFAULT_PARAMS };

  private active = false;
  private anchor: LngLat | null = null;     // drag centre/first corner
  private bezierPts: LngLat[] = [];          // click-to-add control points
  private pointerCleanup: (() => void) | null = null;
  private annotationSink: ((geomType: 'LineString' | 'Polygon', coords: LngLat[]) => void) | null = null;

  constructor(private mapManager: MapManager, private captureManager: CaptureManager) {}

  setShape(kind: ShapeKind): void { this.kind = kind; this.reset(); }
  setMethod(m: ShapeMethod): void { this.method = m; this.reset(); }
  setTarget(t: ShapeTarget): void { this.target = t; }
  setParams(p: Partial<ShapeParams>): void { this.params = { ...this.params, ...p }; }
  getShape(): ShapeKind { return this.kind; }
  isClickDriven(): boolean {
    return this.kind === 'bezier' || this.kind === 'buffer' || this.method === 'parametric';
  }
  setAnnotationSink(fn: (geomType: 'LineString' | 'Polygon', coords: LngLat[]) => void): void {
    this.annotationSink = fn;
  }

  activate(): void {
    this.active = true;
    this.reset();
    const map = this.mapManager.getMap();
    // Drag shapes capture the canvas; click-driven shapes leave panning enabled.
    if (this.method === 'drag' && DRAG_KINDS.includes(this.kind)) {
      map.dragPan.disable();
      this.attachPointerEvents();
    } else {
      map.dragPan.enable();
    }
  }

  deactivate(): void {
    this.active = false;
    this.detachPointerEvents();
    this.reset();
    this.mapManager.getMap().dragPan.enable();
    this.mapManager.clearSketchPreview();
  }

  private reset(): void {
    this.anchor = null;
    this.bezierPts = [];
    this.mapManager.clearSketchPreview();
    // Re-evaluate pointer capture if the method/kind changed while active.
    if (this.active) {
      this.detachPointerEvents();
      const map = this.mapManager.getMap();
      if (this.method === 'drag' && DRAG_KINDS.includes(this.kind)) {
        map.dragPan.disable();
        this.attachPointerEvents();
      } else {
        map.dragPan.enable();
      }
    }
  }

  // ---- Click-driven interactions (routed from App.wireMapInteractions) ----
  handleClick(lng: number, lat: number): void {
    if (!this.active) return;
    if (this.kind === 'bezier') {
      this.bezierPts.push([lng, lat]);
      this.previewBezier(null);
      return;
    }
    if (this.kind === 'buffer') {
      void this.handleBuffer(lng, lat);
      return;
    }
    if (this.method === 'parametric') {
      const built = this.buildParametric([lng, lat]);
      if (built) this.finalize(built);
    }
  }

  handleMove(lng: number, lat: number): void {
    if (!this.active) return;
    if (this.kind === 'bezier') { this.previewBezier([lng, lat]); return; }
    if (this.method === 'parametric' && this.kind !== 'buffer') {
      const built = this.buildParametric([lng, lat]);
      if (built) this.preview(built);
    }
  }

  /** Re-tapping the tool button: finish a bezier path, else just deactivate. */
  complete(): void {
    if (this.kind === 'bezier' && this.bezierPts.length >= 2) {
      const built = this.buildBezier();
      if (built) { this.finalize(built); return; }
    }
    this.deactivate();
  }

  // ---- Drag interactions ----
  private attachPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();

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
    };
    const onMove = (e: PointerEvent) => {
      if (!this.anchor || !e.buttons) return;
      e.preventDefault();
      const built = this.buildFromDrag(this.anchor, toLngLat(e), e.shiftKey);
      if (built) this.preview(built);
    };
    const onUp = (e: PointerEvent) => {
      if (!this.anchor) return;
      const built = this.buildFromDrag(this.anchor, toLngLat(e), e.shiftKey);
      this.anchor = null;
      if (built && this.hasArea(built)) this.finalize(built);
      else this.mapManager.clearSketchPreview();
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

  // ---- Geometry construction ----
  private buildFromDrag(anchor: LngLat, cursor: LngLat, shift: boolean): Built | null {
    const [aLng, aLat] = anchor;
    switch (this.kind) {
      case 'circle': {
        const rM = haversineDistance(aLat, aLng, cursor[1], cursor[0]);
        return this.circle(anchor, rM);
      }
      case 'ngon': {
        const rM = haversineDistance(aLat, aLng, cursor[1], cursor[0]);
        return this.ngon(anchor, rM);
      }
      case 'arc': {
        const rM = haversineDistance(aLat, aLng, cursor[1], cursor[0]);
        return this.arc(anchor, rM);
      }
      case 'ellipse': {
        const xM = haversineDistance(aLat, aLng, aLat, cursor[0]);
        const yM = haversineDistance(aLat, aLng, cursor[1], aLng);
        return this.ellipse(anchor, Math.max(1, xM), Math.max(1, yM));
      }
      case 'rectangle':
      case 'square': {
        let cLng = cursor[0], cLat = cursor[1];
        if (this.kind === 'square' || shift) {
          // Constrain to an equal-sided box (in degrees, adequate at field scale).
          const dx = cLng - aLng, dy = cLat - aLat;
          const s = Math.min(Math.abs(dx), Math.abs(dy));
          cLng = aLng + Math.sign(dx) * s;
          cLat = aLat + Math.sign(dy) * s;
        }
        const ring: LngLat[] = [[aLng, aLat], [cLng, aLat], [cLng, cLat], [aLng, cLat], [aLng, aLat]];
        return this.rotateRing(ring);
      }
    }
    return null;
  }

  private buildParametric(center: LngLat): Built | null {
    const p = this.params;
    switch (this.kind) {
      case 'circle': return this.circle(center, p.radiusM);
      case 'ngon': return this.ngon(center, p.radiusM);
      case 'arc': return this.arc(center, p.radiusM);
      case 'ellipse': return this.ellipse(center, p.majorM, p.minorM);
      case 'rectangle':
      case 'square': {
        const w = p.widthM;
        const h = this.kind === 'square' ? p.widthM : p.heightM;
        // Corners offset from the centre by signed east/west and north/south metres.
        const corner = (ew: number, ns: number): LngLat =>
          this.dest(this.dest(center, Math.abs(ew), ew >= 0 ? 90 : 270), Math.abs(ns), ns >= 0 ? 0 : 180);
        const ring: LngLat[] = [
          corner(-w / 2, -h / 2), corner(w / 2, -h / 2),
          corner(w / 2, h / 2), corner(-w / 2, h / 2),
        ];
        ring.push(ring[0]);
        return this.rotateRing(ring);
      }
    }
    return null;
  }

  private buildBezier(): Built | null {
    if (this.bezierPts.length < 2) return null;
    const line = turf.lineString(this.bezierPts);
    const spline = turf.bezierSpline(line, { resolution: 10000, sharpness: 0.85 });
    return { geomType: 'LineString', coords: spline.geometry.coordinates as LngLat[] };
  }

  private async handleBuffer(lng: number, lat: number): Promise<void> {
    const map = this.mapManager.getMap();
    const pt = map.project([lng, lat]);
    const hits = this.mapManager.queryFeaturesAtPoint(pt);
    const id = hits[0]?.properties?.id as string | undefined;
    if (!id) { EventBus.emit('toast', { message: 'Tap a feature to buffer', type: 'warning' }); return; }
    const { StorageManager } = await import('../storage/StorageManager');
    const feature = await StorageManager.getInstance().getFeature(id);
    if (!feature) return;
    const buffered = turf.buffer(
      feature.geometry as unknown as Parameters<typeof turf.buffer>[0],
      this.params.bufferM / 1000, { units: 'kilometers' }
    );
    if (!buffered) return;
    // buffer() may return a Feature or FeatureCollection (Polygon or MultiPolygon).
    const b = buffered as unknown as {
      type: string;
      geometry?: { type: string; coordinates: number[][][] | number[][][][] };
      features?: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }>;
    };
    const geom = b.type === 'FeatureCollection' ? b.features?.[0]?.geometry : b.geometry;
    if (!geom) return;
    const ring = (geom.type === 'MultiPolygon'
      ? (geom.coordinates as number[][][][])[0][0]
      : (geom.coordinates as number[][][])[0]) as LngLat[];
    this.finalize({ geomType: 'Polygon', coords: ring });
  }

  // ---- turf helpers (radii/axes in metres → kilometres for turf) ----
  private circle(center: LngLat, rM: number): Built {
    const c = turf.circle(center, Math.max(0.1, rM) / 1000, { steps: this.params.segments, units: 'kilometers' });
    return { geomType: 'Polygon', coords: c.geometry.coordinates[0] as LngLat[] };
  }
  private ellipse(center: LngLat, xM: number, yM: number): Built {
    const e = turf.ellipse(center, Math.max(0.1, xM) / 1000, Math.max(0.1, yM) / 1000,
      { steps: this.params.segments, units: 'kilometers', angle: this.params.rotationDeg });
    return { geomType: 'Polygon', coords: e.geometry.coordinates[0] as LngLat[] };
  }
  private arc(center: LngLat, rM: number): Built {
    const a = turf.lineArc(center, Math.max(0.1, rM) / 1000,
      this.params.startAngleDeg, this.params.endAngleDeg, { steps: this.params.segments, units: 'kilometers' });
    return { geomType: 'LineString', coords: a.geometry.coordinates as LngLat[] };
  }
  private ngon(center: LngLat, rM: number): Built {
    const sides = Math.max(3, Math.round(this.params.sides));
    const coords: LngLat[] = [];
    for (let i = 0; i < sides; i++) {
      const bearing = (360 / sides) * i + this.params.rotationDeg;
      coords.push(this.dest(center, Math.max(0.1, rM), bearing));
    }
    coords.push(coords[0]);
    return { geomType: 'Polygon', coords };
  }
  /** Destination point `distM` metres from origin along `bearingDeg`. */
  private dest(origin: LngLat, distM: number, bearingDeg: number): LngLat {
    const d = turf.destination(origin, distM / 1000, bearingDeg, { units: 'kilometers' });
    return d.geometry.coordinates as LngLat;
  }
  private rotateRing(ring: LngLat[]): Built {
    if (this.params.rotationDeg) {
      const poly = turf.polygon([ring]);
      const rot = turf.transformRotate(poly, this.params.rotationDeg);
      return { geomType: 'Polygon', coords: rot.geometry.coordinates[0] as LngLat[] };
    }
    return { geomType: 'Polygon', coords: ring };
  }

  // ---- preview / finalize ----
  private hasArea(b: Built): boolean {
    if (b.geomType === 'Polygon') return b.coords.length >= 4;
    return b.coords.length >= 2;
  }

  private preview(b: Built): void {
    const features: object[] = [{
      type: 'Feature',
      geometry: b.geomType === 'Polygon'
        ? { type: 'Polygon', coordinates: [b.coords] }
        : { type: 'LineString', coordinates: b.coords },
      properties: {},
    }];
    this.mapManager.updateSketchPreview(features);
  }

  private previewBezier(cursor: LngLat | null): void {
    const pts = cursor ? [...this.bezierPts, cursor] : [...this.bezierPts];
    if (pts.length < 2) {
      const verts = pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }));
      this.mapManager.updateSketchPreview(verts);
      return;
    }
    const spline = turf.bezierSpline(turf.lineString(pts), { resolution: 10000, sharpness: 0.85 });
    const features: object[] = [
      { type: 'Feature', geometry: spline.geometry, properties: {} },
      ...pts.map(p => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })),
    ];
    this.mapManager.updateSketchPreview(features);
  }

  private finalize(b: Built): void {
    this.mapManager.clearSketchPreview();
    this.bezierPts = [];
    if (this.target === 'annotation') {
      this.annotationSink?.(b.geomType, b.coords);
      return;
    }
    const type = (document.getElementById('sh-type') as HTMLSelectElement | null)?.value ?? '';
    void this.captureManager.saveShapeFeature(b.geomType, b.coords, type, '');
  }
}

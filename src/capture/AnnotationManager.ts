import { v4 as uuidv4 } from 'uuid';
import type { MapManager } from '../map/MapManager';
import type { CaptureManager } from './CaptureManager';
import type { StorageManager } from '../storage/StorageManager';
import type { Annotation, AnnotationKind } from '../types';
import { EventBus } from '../utils/EventBus';
import { haversineDistance } from '../utils/coordinates';
import { PIN_SHAPES, placeTemplate, buildArrowRing } from './annotationGraphics';

type LngLat = [number, number];

/** Annotation tool kinds exposed by the ANNOTATE flyout. */
export type AnnoTool = 'marker' | 'text' | 'note' | 'circle' | 'rectangle' | 'pentagon'
  | 'arrow' | 'highlighter' | 'freehand';

interface AnnoStyle {
  color: string; fill_color: string; fill_opacity: number;
  stroke_color: string; stroke_width: number; size: number;
  text: string; outline: boolean; shadow: boolean; padding: number;
  bg_color: string; shape: string; arrow: string;
}

/** Approximate ground metres per screen pixel (Web Mercator) at a zoom/latitude. */
function metersPerPixel(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/**
 * First-pass annotation tooling. Places graphical annotations (markers/pins, text,
 * notes, arrows, highlighter, and shape annotations) scoped to the active map,
 * reading style from the shared #anno-options card. Markers/arrows/shapes are built
 * as ground-geometry vector polygons so they scale naturally with zoom; text/notes
 * use the zoom-relative size expressions. Every placement records the current zoom
 * as base_zoom (the "zoom it was created at").
 */
export class AnnotationManager {
  private active = false;
  private kind: AnnoTool = 'marker';
  private annos: Annotation[] = [];
  private pointerCleanup: (() => void) | null = null;

  private static readonly DRAG_PX = 4;
  private static readonly CLICK_KINDS: AnnoTool[] = ['marker', 'text', 'note'];

  constructor(
    private mapManager: MapManager,
    private captureManager: CaptureManager,
    private storage: StorageManager,
    private getActiveMapId: () => string,
    private getProjectId: () => string,
    private getUserId: () => string,
    private isMapScoped: () => boolean,
  ) {}

  isActive(): boolean { return this.active; }
  getKind(): AnnoTool { return this.kind; }

  activate(kind: AnnoTool): void {
    if (this.active) this.deactivate();
    this.active = true;
    this.kind = kind;
    // Reuse the 'sketch-shape' tool token so the map's click handler ignores
    // these placements (no photo-point / select side effects).
    this.captureManager.setTool('sketch-shape');
    const map = this.mapManager.getMap();
    map.dragPan.disable();
    map.getCanvas().style.cursor = 'crosshair';
    this.attachPointerEvents();
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.detachPointerEvents();
    const map = this.mapManager.getMap();
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    this.mapManager.clearSketchPreview();
    this.captureManager.setTool('none');
  }

  // ---- style read from the #anno-options card ----
  private str(id: string, fallback: string): string {
    return (document.getElementById(id) as HTMLInputElement | null)?.value ?? fallback;
  }
  private num(id: string, fallback: number): number {
    const v = parseFloat((document.getElementById(id) as HTMLInputElement | null)?.value ?? '');
    return isNaN(v) ? fallback : v;
  }
  private bool(id: string, fallback: boolean): boolean {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el ? el.checked : fallback;
  }
  private style(): AnnoStyle {
    return {
      color: this.str('a-color', '#ffd400'),
      fill_color: this.str('a-fill', '#22d3ee'),
      fill_opacity: this.num('a-fillop', 60) / 100,
      stroke_color: this.str('a-stroke', '#ffffff'),
      stroke_width: this.num('a-strokew', 2),
      size: this.num('a-size', 16),
      text: this.str('a-text', ''),
      outline: this.bool('a-outline', true),
      shadow: this.bool('a-shadow', true),
      padding: this.num('a-padding', 8),
      bg_color: this.str('a-bg', '#1f2937'),
      shape: this.str('a-shape', 'pin'),
      arrow: this.str('a-arrow', 'simple'),
    };
  }

  private guardScope(): boolean {
    if (!this.isMapScoped() || !this.getActiveMapId()) {
      EventBus.emit('toast', { message: 'Annotations require an active map', type: 'warning' });
      return false;
    }
    return true;
  }

  private base(kind: AnnotationKind, s: AnnoStyle): Omit<Annotation, 'geometry'> {
    const now = new Date().toISOString();
    return {
      id: uuidv4(),
      map_id: this.getActiveMapId(),
      project_id: this.getProjectId(),
      kind,
      text: s.text,
      base_zoom: this.mapManager.getMap().getZoom(),
      base_size: s.size,
      color: s.color,
      halo_color: s.outline ? s.stroke_color : 'rgba(0,0,0,0)',
      rotation: 0,
      shape: s.shape,
      fill_color: s.fill_color,
      fill_opacity: s.fill_opacity,
      stroke_color: s.stroke_color,
      stroke_width: s.stroke_width,
      outline: s.outline,
      shadow: s.shadow,
      padding: s.padding,
      bg_color: s.bg_color,
      created_at: now,
      updated_at: now,
      created_by: this.getUserId(),
    };
  }

  // ---- placement ----
  private place(down: LngLat, up: LngLat, moved: boolean, path: LngLat[]): void {
    if (!this.guardScope()) return;
    const s = this.style();
    const zoom = this.mapManager.getMap().getZoom();

    switch (this.kind) {
      case 'text': {
        if (!s.text.trim()) { EventBus.emit('toast', { message: 'Enter annotation text first', type: 'warning' }); return; }
        void this.save({ ...this.base('text', s), geometry: { type: 'Point', coordinates: down } });
        break;
      }
      case 'note': {
        if (!s.text.trim()) { EventBus.emit('toast', { message: 'Enter note text first', type: 'warning' }); return; }
        void this.save({ ...this.base('note', s), geometry: { type: 'Point', coordinates: down } });
        break;
      }
      case 'marker': {
        const tpl = PIN_SHAPES[s.shape] ?? PIN_SHAPES.pin;
        const ground = s.size * metersPerPixel(zoom, down[1]);
        const ring = placeTemplate(down[0], down[1], tpl.points, ground, 0);
        void this.save({ ...this.base('marker', s), fill_color: s.color, fill_opacity: 1, geometry: { type: 'Polygon', coordinates: [ring] } });
        break;
      }
      case 'arrow': {
        if (!moved) return;
        const ring = buildArrowRing(down, up, s.arrow);
        void this.save({ ...this.base('arrow', s), shape: s.arrow, geometry: { type: 'Polygon', coordinates: [ring] } });
        break;
      }
      case 'highlighter': {
        if (path.length < 2) return;
        const anno = this.base('highlighter', s);
        anno.base_size = Math.max(8, s.stroke_width);
        anno.color = s.fill_color;
        void this.save({ ...anno, geometry: { type: 'LineString', coordinates: [...path] } });
        break;
      }
      case 'freehand': {
        if (path.length < 2) return;
        const anno = this.base('shape', s);
        anno.base_size = Math.max(2, s.stroke_width);
        anno.stroke_color = s.color;
        anno.stroke_width = Math.max(2, s.stroke_width);
        void this.save({ ...anno, geometry: { type: 'LineString', coordinates: [...path] } });
        break;
      }
      case 'circle':
      case 'rectangle':
      case 'pentagon': {
        if (!moved) return;
        const r = haversineDistance(down[1], down[0], up[1], up[0]);
        if (r < 0.5) return;
        const ring = this.shapeRing(down, r);
        void this.save({ ...this.base('shape', s), geometry: { type: 'Polygon', coordinates: [ring] } });
        break;
      }
    }
  }

  /** Build a centred shape annotation ring (circle / square / pentagon) of ground radius `r`. */
  private shapeRing(center: LngLat, r: number): LngLat[] {
    let unit: [number, number][];
    if (this.kind === 'rectangle') unit = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    else unit = this.regularUnit(this.kind === 'circle' ? 40 : 5);
    return placeTemplate(center[0], center[1], unit, r, 0);
  }
  private regularUnit(n: number): [number, number][] {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (2 * Math.PI * i) / n;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return pts;
  }

  private async save(anno: Annotation): Promise<void> {
    await this.storage.saveAnnotation(anno);
    await this.refresh();
    EventBus.emit('annotations-changed', { mapId: anno.map_id });
  }

  /** Reload the active map's annotations and render them. */
  async refresh(): Promise<void> {
    if (!this.isMapScoped() || !this.getActiveMapId()) {
      this.annos = [];
      this.mapManager.clearAnnotations();
      EventBus.emit('annotations-count', { count: 0, available: false, annos: [] });
      return;
    }
    this.annos = await this.storage.getAnnotationsByMap(this.getActiveMapId());
    this.mapManager.updateAnnotations(this.annos);
    EventBus.emit('annotations-count', { count: this.annos.length, available: true, annos: this.annos });
  }

  // ---- unified press / drag / release overlay ----
  private previewFor(down: LngLat, cur: LngLat, path: LngLat[]): void {
    let feat: object | null = null;
    if (this.kind === 'arrow') {
      feat = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [buildArrowRing(down, cur, this.style().arrow)] }, properties: {} };
    } else if (this.kind === 'highlighter' || this.kind === 'freehand') {
      feat = { type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties: {} };
    } else if (this.kind === 'circle' || this.kind === 'rectangle' || this.kind === 'pentagon') {
      const r = haversineDistance(down[1], down[0], cur[1], cur[0]);
      feat = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [this.shapeRing(down, r)] }, properties: {} };
    }
    this.mapManager.updateSketchPreview(feat ? [feat] : []);
  }

  private attachPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();
    let down: LngLat | null = null;
    let downXY: { x: number; y: number } | null = null;
    let moved = false;
    let path: LngLat[] = [];

    const toLngLat = (e: PointerEvent): LngLat => {
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      return [ll.lng, ll.lat];
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      down = toLngLat(e);
      downXY = { x: e.clientX, y: e.clientY };
      moved = false;
      path = [down];
    };
    const onMove = (e: PointerEvent) => {
      if (!down || !downXY || !e.buttons) return;
      e.preventDefault();
      if (Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y) > AnnotationManager.DRAG_PX) moved = true;
      const cur = toLngLat(e);
      if (this.kind === 'highlighter' || this.kind === 'freehand') path.push(cur);
      if (moved && !AnnotationManager.CLICK_KINDS.includes(this.kind)) this.previewFor(down, cur, path);
    };
    const onUp = (e: PointerEvent) => {
      if (!down) return;
      const d = down, up = toLngLat(e);
      down = null; downXY = null;
      this.mapManager.clearSketchPreview();
      this.place(d, up, moved, path);
      path = [];
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
}

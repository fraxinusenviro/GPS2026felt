import { v4 as uuidv4 } from 'uuid';
import type { MapManager } from '../map/MapManager';
import type { StorageManager } from '../storage/StorageManager';
import type { Annotation, AnnotationKind } from '../types';
import { EventBus } from '../utils/EventBus';

type LngLat = [number, number];

interface AnnotationStyle { kind: AnnotationKind; text: string; color: string; size: number; }

/**
 * Places graphical annotations (text, arrows/leaders, callouts, graphic shapes)
 * scoped to the active map. Text is click-to-place; arrows/callouts use a
 * press-drag overlay (mirrors the freehand pointer pattern). Every placement
 * records the current zoom as base_zoom so the annotation keeps a constant ground
 * size as the user zooms (see MapManager size expressions).
 */
export class AnnotationTool {
  private active = false;
  private pointerCleanup: (() => void) | null = null;
  private mode: 'place' | 'edit' = 'place';
  private annos: Annotation[] = [];          // last-loaded annotations for the active map
  private selected: Annotation | null = null; // currently selected annotation (edit mode)

  constructor(
    private mapManager: MapManager,
    private storage: StorageManager,
    private getActiveMapId: () => string,
    private getProjectId: () => string,
    private getUserId: () => string,
    private isMapScoped: () => boolean, // false for the All-Data virtual map
  ) {}

  private style(): AnnotationStyle {
    const kind = ((document.getElementById('anno-kind') as HTMLSelectElement | null)?.value
      ?? 'text') as AnnotationKind;
    const text = (document.getElementById('anno-text') as HTMLInputElement | null)?.value ?? '';
    const color = (document.getElementById('anno-color') as HTMLInputElement | null)?.value ?? '#ffd400';
    const size = parseFloat((document.getElementById('anno-size') as HTMLInputElement | null)?.value ?? '16');
    return { kind, text, color, size: isNaN(size) ? 16 : size };
  }

  activate(): void {
    this.active = true;
    this.applyPointerMode();
  }

  deactivate(): void {
    this.active = false;
    this.detachPointerEvents();
    this.mapManager.getMap().dragPan.enable();
    this.mapManager.clearSketchPreview();
    this.deselect();
  }

  setMode(mode: 'place' | 'edit'): void {
    this.mode = mode;
    if (mode === 'place') this.deselect();
    this.applyPointerMode();
  }

  /** Re-evaluate pointer capture after the user switches annotation kind/mode. */
  refreshMode(): void { this.applyPointerMode(); }

  /** Attach the press-drag overlay only when placing arrows/callouts. */
  private applyPointerMode(): void {
    if (!this.active) return;
    this.detachPointerEvents();
    const map = this.mapManager.getMap();
    const kind = this.style().kind;
    const needsDrag = this.mode === 'place' && (kind === 'arrow' || kind === 'callout');
    if (needsDrag) {
      map.dragPan.disable();
      this.attachPointerEvents();
    } else {
      map.dragPan.enable();
    }
  }

  // ---- map clicks (routed from App.wireMapInteractions) ----
  handleClick(lng: number, lat: number): void {
    if (!this.active) return;
    if (this.mode === 'edit') { this.selectAt(lng, lat); return; }
    if (this.style().kind !== 'text') return;
    void this.placeText(lng, lat);
  }

  // ---- selection / edit (edit mode) ----
  private selectAt(lng: number, lat: number): void {
    const map = this.mapManager.getMap();
    const hits = this.mapManager.queryAnnotationsAtPoint(map.project([lng, lat]));
    const id = hits[0]?.properties?.id as string | undefined;
    if (!id) { this.deselect(); return; }
    const anno = this.annos.find(a => a.id === id);
    if (!anno) { this.deselect(); return; }
    this.selected = anno;
    this.mapManager.highlightGeometry(anno.geometry);
    EventBus.emit('annotation-selected', { annotation: anno });
  }

  scaleSelected(size: number, persist: boolean): void {
    if (!this.selected || isNaN(size)) return;
    this.selected.base_size = size;
    this.mapManager.updateAnnotations(this.annos); // live preview
    if (persist) void this.storage.saveAnnotation(this.selected);
  }

  recolorSelected(color: string, persist: boolean): void {
    if (!this.selected) return;
    this.selected.color = color;
    this.mapManager.updateAnnotations(this.annos);
    if (persist) void this.storage.saveAnnotation(this.selected);
  }

  async deleteSelected(): Promise<void> {
    if (!this.selected) return;
    if (!confirm('Delete this annotation?')) return;
    const id = this.selected.id;
    await this.storage.deleteAnnotation(id);
    this.selected = null;
    this.mapManager.highlightGeometry(null);
    EventBus.emit('annotation-deselected', {});
    await this.refresh();
  }

  deselect(): void {
    if (!this.selected) return;
    this.selected = null;
    this.mapManager.highlightGeometry(null);
    EventBus.emit('annotation-deselected', {});
  }

  private base(): Omit<Annotation, 'geometry' | 'kind'> {
    const s = this.style();
    const now = new Date().toISOString();
    return {
      id: uuidv4(),
      map_id: this.getActiveMapId(),
      project_id: this.getProjectId(),
      text: s.text,
      base_zoom: this.mapManager.getMap().getZoom(),
      base_size: s.size,
      color: s.color,
      halo_color: 'rgba(0,0,0,0.85)',
      rotation: 0,
      created_at: now,
      updated_at: now,
      created_by: this.getUserId(),
    };
  }

  private guardScope(): boolean {
    if (!this.isMapScoped() || !this.getActiveMapId()) {
      EventBus.emit('toast', { message: 'Annotations require an active map', type: 'warning' });
      return false;
    }
    return true;
  }

  async placeText(lng: number, lat: number): Promise<void> {
    if (!this.guardScope()) return;
    const s = this.style();
    if (!s.text.trim()) { EventBus.emit('toast', { message: 'Enter annotation text first', type: 'warning' }); return; }
    const anno: Annotation = {
      ...this.base(), kind: 'text',
      geometry: { type: 'Point', coordinates: [lng, lat] },
    };
    await this.save(anno);
  }

  async placeArrow(start: LngLat, end: LngLat): Promise<void> {
    if (!this.guardScope()) return;
    const anno: Annotation = {
      ...this.base(), kind: 'arrow',
      geometry: { type: 'LineString', coordinates: [start, end] },
    };
    await this.save(anno);
  }

  async placeCallout(anchor: LngLat, tailTo: LngLat): Promise<void> {
    if (!this.guardScope()) return;
    const s = this.style();
    if (!s.text.trim()) { EventBus.emit('toast', { message: 'Enter callout text first', type: 'warning' }); return; }
    const anno: Annotation = {
      ...this.base(), kind: 'callout',
      geometry: { type: 'Point', coordinates: anchor },
      tail_to: tailTo,
    };
    await this.save(anno);
  }

  /** Place a graphic shape (from ShapeTool with target='annotation'). */
  async placeShape(geomType: 'LineString' | 'Polygon', coords: LngLat[]): Promise<void> {
    if (!this.guardScope()) return;
    const anno: Annotation = {
      ...this.base(), kind: 'shape',
      base_size: 2,
      geometry: geomType === 'Polygon'
        ? { type: 'Polygon', coordinates: [coords] }
        : { type: 'LineString', coordinates: coords },
    };
    await this.save(anno);
  }

  private async save(anno: Annotation): Promise<void> {
    await this.storage.saveAnnotation(anno);
    await this.refresh();
    EventBus.emit('toast', { message: 'Annotation added', type: 'success', duration: 1200 });
    EventBus.emit('annotations-changed', { mapId: anno.map_id });
  }

  /** Reload annotations for the active map and push them to the map source. */
  async refresh(): Promise<void> {
    if (!this.isMapScoped() || !this.getActiveMapId()) {
      this.annos = [];
      this.mapManager.clearAnnotations();
      EventBus.emit('annotations-count', { count: 0, available: false });
      return;
    }
    const annos = await this.storage.getAnnotationsByMap(this.getActiveMapId());
    this.annos = annos;
    this.mapManager.updateAnnotations(annos);
    EventBus.emit('annotations-count', { count: annos.length, available: true });
  }

  // ---- press-drag overlay for arrow / callout ----
  private attachPointerEvents(): void {
    const map = this.mapManager.getMap();
    const canvas = map.getCanvas();
    let start: LngLat | null = null;

    const toLngLat = (e: PointerEvent): LngLat => {
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      return [ll.lng, ll.lat];
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      start = toLngLat(e);
    };
    const onMove = (e: PointerEvent) => {
      if (!start || !e.buttons) return;
      e.preventDefault();
      this.mapManager.updateSketchPreview([{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [start, toLngLat(e)] },
        properties: {},
      }]);
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const end = toLngLat(e);
      const s = start; start = null;
      this.mapManager.clearSketchPreview();
      const moved = Math.abs(end[0] - s[0]) > 1e-7 || Math.abs(end[1] - s[1]) > 1e-7;
      if (!moved) return;
      if (this.style().kind === 'arrow') void this.placeArrow(s, end);
      else void this.placeCallout(end, s); // box at release point, leader to press point
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

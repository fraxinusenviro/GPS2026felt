import type maplibregl from 'maplibre-gl';

export class BBoxSelector {
  private overlay: HTMLDivElement;
  private box: HTMLDivElement;
  private active = false;

  // Box position in pixels (relative to map container)
  private boxLeft = 60;
  private boxTop = 100;
  private boxWidth = 200;
  private boxHeight = 150;

  constructor(
    private container: HTMLElement,
    private map: maplibregl.Map,
  ) {
    this.overlay = document.createElement('div');
    this.overlay.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:150;display:none';

    this.box = document.createElement('div');
    this.box.className = 'bbox-box';
    this.box.style.cssText =
      'position:absolute;border:2px solid #00ccff;background:rgba(0,200,255,0.08);cursor:move;box-sizing:border-box';

    const handles: Array<{ name: string; cursor: string }> = [
      { name: 'nw', cursor: 'nw-resize' },
      { name: 'n',  cursor: 'n-resize'  },
      { name: 'ne', cursor: 'ne-resize' },
      { name: 'w',  cursor: 'w-resize'  },
      { name: 'e',  cursor: 'e-resize'  },
      { name: 'sw', cursor: 'sw-resize' },
      { name: 's',  cursor: 's-resize'  },
      { name: 'se', cursor: 'se-resize' },
    ];
    for (const h of handles) {
      const el = document.createElement('div');
      el.dataset.handle = h.name;
      el.style.cssText =
        `position:absolute;width:10px;height:10px;background:#00ccff;border:1px solid #fff;cursor:${h.cursor};pointer-events:all`;
      this.positionHandle(el, h.name);
      this.box.appendChild(el);
    }

    this.overlay.appendChild(this.box);
    this.container.appendChild(this.overlay);
    this.bindEvents();
  }

  private positionHandle(el: HTMLDivElement, name: string): void {
    const s = el.style;
    const half = '-5px';
    const mid  = 'calc(50% - 5px)';
    const edge = '-5px';
    switch (name) {
      case 'nw': s.left = edge; s.top = edge; break;
      case 'n':  s.left = mid;  s.top = edge; break;
      case 'ne': s.right = edge; s.top = edge; break;
      case 'w':  s.left = edge; s.top = mid; break;
      case 'e':  s.right = edge; s.top = mid; break;
      case 'sw': s.left = edge; s.bottom = edge; break;
      case 's':  s.left = mid;  s.bottom = edge; break;
      case 'se': s.right = edge; s.bottom = edge; break;
    }
  }

  private updateBoxStyle(): void {
    this.box.style.left   = `${this.boxLeft}px`;
    this.box.style.top    = `${this.boxTop}px`;
    this.box.style.width  = `${this.boxWidth}px`;
    this.box.style.height = `${this.boxHeight}px`;
  }

  private bindEvents(): void {
    let dragging: string | null = null;
    let startX = 0, startY = 0;
    let startL = 0, startT = 0, startW = 0, startH = 0;

    const onDown = (e: PointerEvent) => {
      if (!this.active) return;
      const handle = (e.target as HTMLElement).dataset?.handle;
      dragging = handle ?? 'move';
      startX = e.clientX; startY = e.clientY;
      startL = this.boxLeft; startT = this.boxTop;
      startW = this.boxWidth; startH = this.boxHeight;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.stopPropagation();
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging || !this.active) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const MIN = 40;

      if (dragging === 'move') {
        this.boxLeft = startL + dx;
        this.boxTop  = startT + dy;
      } else {
        const resize = {
          n:  () => { this.boxTop = startT + dy; this.boxHeight = Math.max(MIN, startH - dy); },
          s:  () => { this.boxHeight = Math.max(MIN, startH + dy); },
          w:  () => { this.boxLeft = startL + dx; this.boxWidth = Math.max(MIN, startW - dx); },
          e:  () => { this.boxWidth = Math.max(MIN, startW + dx); },
          nw: () => { this.boxTop = startT + dy; this.boxHeight = Math.max(MIN, startH - dy); this.boxLeft = startL + dx; this.boxWidth = Math.max(MIN, startW - dx); },
          ne: () => { this.boxTop = startT + dy; this.boxHeight = Math.max(MIN, startH - dy); this.boxWidth = Math.max(MIN, startW + dx); },
          sw: () => { this.boxHeight = Math.max(MIN, startH + dy); this.boxLeft = startL + dx; this.boxWidth = Math.max(MIN, startW - dx); },
          se: () => { this.boxHeight = Math.max(MIN, startH + dy); this.boxWidth = Math.max(MIN, startW + dx); },
        };
        (resize as Record<string, () => void>)[dragging]?.();
      }

      this.updateBoxStyle();
      this.container.dispatchEvent(new CustomEvent('bbox-change', { detail: this.getBounds() }));
      e.stopPropagation();
      e.preventDefault();
    };

    const onUp = () => { dragging = null; };

    this.box.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  activate(): void {
    // Center box in viewport
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.boxWidth  = Math.round(w * 0.5);
    this.boxHeight = Math.round(h * 0.5);
    this.boxLeft   = Math.round((w - this.boxWidth)  / 2);
    this.boxTop    = Math.round((h - this.boxHeight) / 2);
    this.active = true;
    this.overlay.style.display = 'block';
    this.overlay.style.pointerEvents = 'none';
    this.box.style.pointerEvents = 'all';
    this.updateBoxStyle();
  }

  deactivate(): void {
    this.active = false;
    this.overlay.style.display = 'none';
  }

  getBounds(): [number, number, number, number] {
    const sw = this.map.unproject([this.boxLeft, this.boxTop + this.boxHeight]);
    const ne = this.map.unproject([this.boxLeft + this.boxWidth, this.boxTop]);
    return [sw.lng, sw.lat, ne.lng, ne.lat]; // [west, south, east, north]
  }

  destroy(): void {
    this.overlay.remove();
  }
}

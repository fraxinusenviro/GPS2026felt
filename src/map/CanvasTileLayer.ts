import type { Map as MapLibreMap } from 'maplibre-gl';

function lng2tile(lng: number, z: number): number {
  return (lng + 180) / 360 * Math.pow(2, z);
}
function lat2tile(lat: number, z: number): number {
  return (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
}
function tile2lng(x: number, z: number): number {
  return x / Math.pow(2, z) * 360 - 180;
}
function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export class CanvasTileLayer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: MapLibreMap;
  private tileUrl: string;
  private tileCache = new Map<string, HTMLImageElement | null>();
  private pendingLoads = new Set<string>();
  private boundOnRender: () => void;
  private resizeObserver: ResizeObserver;
  private frameId: number | null = null;

  constructor(
    mapContainer: HTMLElement,
    map: MapLibreMap,
    tileUrl: string,
    blendMode: string,
    opacity: number,
    visible: boolean,
  ) {
    this.map = map;
    this.tileUrl = tileUrl;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1';
    this.canvas.style.mixBlendMode = blendMode;
    this.canvas.style.opacity = visible ? String(opacity) : '0';
    mapContainer.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
    this.boundOnRender = this.scheduleRender.bind(this);

    this.resize();
    map.on('render', this.boundOnRender);

    this.resizeObserver = new ResizeObserver(() => { this.resize(); this.scheduleRender(); });
    this.resizeObserver.observe(mapContainer);

    this.scheduleRender();
  }

  private resize(): void {
    const dpr = devicePixelRatio;
    const c = this.map.getContainer();
    this.canvas.width  = c.clientWidth  * dpr;
    this.canvas.height = c.clientHeight * dpr;
  }

  setBlendMode(mode: string): void {
    this.canvas.style.mixBlendMode = mode;
  }

  setOpacityAndVisible(opacity: number, visible: boolean): void {
    this.canvas.style.opacity = visible ? String(opacity) : '0';
  }

  deactivate(): void {
    this.map.off('render', this.boundOnRender);
    this.resizeObserver.disconnect();
    if (this.frameId !== null) { cancelAnimationFrame(this.frameId); this.frameId = null; }
    this.canvas.remove();
    this.tileCache.clear();
    this.pendingLoads.clear();
  }

  private scheduleRender(): void {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.renderTiles();
    });
  }

  private getTileUrl(x: number, y: number, z: number): string {
    if (this.tileUrl.includes('{bbox-epsg-3857}')) {
      const HALF_EARTH = 20037508.3428;
      const n = Math.pow(2, z);
      const xmin = (x / n) * HALF_EARTH * 2 - HALF_EARTH;
      const xmax = ((x + 1) / n) * HALF_EARTH * 2 - HALF_EARTH;
      const ymax = -(y / n) * HALF_EARTH * 2 + HALF_EARTH;
      const ymin = -((y + 1) / n) * HALF_EARTH * 2 + HALF_EARTH;
      return this.tileUrl.replace('{bbox-epsg-3857}', `${xmin},${ymin},${xmax},${ymax}`);
    }
    return this.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  private loadTile(url: string): void {
    if (this.tileCache.has(url) || this.pendingLoads.has(url)) return;
    this.pendingLoads.add(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.pendingLoads.delete(url);
      this.tileCache.set(url, img);
      this.scheduleRender();
    };
    img.onerror = () => {
      this.pendingLoads.delete(url);
      this.tileCache.set(url, null);
    };
    img.src = url;
  }

  private renderTiles(): void {
    const ctx  = this.ctx;
    const dpr  = devicePixelRatio;
    const map  = this.map;
    const zoom = map.getZoom();

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.canvas.style.opacity === '0') return;

    const z       = Math.min(Math.max(Math.round(zoom), 0), 22);
    const maxTile = Math.pow(2, z);
    const bounds  = map.getBounds();

    // Add a 1-tile buffer on each side to hide loading seams
    const minTX = Math.floor(lng2tile(bounds.getWest(),  z)) - 1;
    const maxTX = Math.floor(lng2tile(bounds.getEast(),  z)) + 1;
    const minTY = Math.max(0, Math.floor(lat2tile(bounds.getNorth(), z)) - 1);
    const maxTY = Math.min(maxTile - 1, Math.floor(lat2tile(bounds.getSouth(), z)) + 1);

    for (let tx = minTX; tx <= maxTX; tx++) {
      for (let ty = minTY; ty <= maxTY; ty++) {
        const wx  = ((tx % maxTile) + maxTile) % maxTile;
        const url = this.getTileUrl(wx, ty, z);
        const img = this.tileCache.get(url);

        if (!img) {
          this.loadTile(url);
          continue;
        }

        // Project the 3 corners that define the tile's affine transform on screen.
        // (SW corner projects independently — not needed since affine uses NW/NE/SW)
        const nw = map.project([tile2lng(tx,     z), tile2lat(ty,     z)]);
        const ne = map.project([tile2lng(tx + 1, z), tile2lat(ty,     z)]);
        const sw = map.project([tile2lng(tx,     z), tile2lat(ty + 1, z)]);

        const iw = img.naturalWidth  || 256;
        const ih = img.naturalHeight || 256;

        const a = (ne.x - nw.x) / iw * dpr;
        const b = (ne.y - nw.y) / iw * dpr;
        const c = (sw.x - nw.x) / ih * dpr;
        const d = (sw.y - nw.y) / ih * dpr;
        const e = nw.x * dpr;
        const f = nw.y * dpr;

        ctx.save();
        ctx.setTransform(a, b, c, d, e, f);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      }
    }
  }
}

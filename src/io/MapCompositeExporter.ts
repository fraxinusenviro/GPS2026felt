import type { Map as MLMap } from 'maplibre-gl';
import type { MapManager } from '../map/MapManager';
import {
  lon2tile,
  lat2tile,
  tile2lon,
  tile2lat,
  clampBboxLat,
} from '../cache/tileUtils';

const TILE = 256;
// MapLibre GL's internal coordinate system uses a 512px reference tile, so when
// the map is rendered at integer zoom z, each XYZ-z tile occupies 512 CSS px on
// screen. We capture at that footprint and downscale to the 256px output tile
// (which also supersamples for sharper results).
const SCREEN_TILE = 512;

/**
 * Renders the *current* live MapLibre map (full basemap stack + every visible
 * overlay — vectors, HRDEM/COG rasters, rampify, WebGL blend, collected data)
 * into a composited (flattened) MBTiles pyramid.
 *
 * Because it captures the live map's own canvas, the output is exactly what the
 * user sees (WYSIWYG) rather than a re-implementation of the styling. The cost
 * is that the live map visibly pans/zooms during export; we lock it behind a
 * modal and restore the camera afterwards.
 */
export class MapCompositeExporter {
  constructor(private mapManager: MapManager) {}

  /**
   * @param bbox        [west, south, east, north] in WGS84 (typically the viewport)
   * @param zMin        lowest (integer) zoom level
   * @param zMax        highest (integer) zoom level
   * @param name        MBTiles name (metadata + filename)
   * @param onProgress  reports rendered/total tiles
   * @param controller  abort controller (wired to the modal's Cancel button)
   * @returns the generated .mbtiles file as a Blob
   */
  async export(
    bbox: [number, number, number, number],
    zMin: number,
    zMax: number,
    name: string,
    onProgress: (done: number, total: number, phase: string) => void = () => {},
    opts: { includeCollected?: boolean } = {},
    controller?: AbortController,
  ): Promise<{ blob: Blob; tileCount: number }> {
    const map = this.mapManager.getMap();
    const safeBbox = clampBboxLat(bbox);
    const signal = controller?.signal;
    const includeCollected = opts.includeCollected !== false;

    // Layers to temporarily hide so they are not baked into the composite:
    //  - the live GPS location marker / accuracy circle (never wanted offline)
    //  - optionally the user's collected Points/Lines/Polygons + previews
    const hideIds: string[] = ['user-location', 'user-accuracy-circle'];
    for (const ly of map.getStyle().layers ?? []) {
      const id = ly.id;
      if (id === 'selected-feature-highlight') hideIds.push(id);
      if (!includeCollected && (id.startsWith('collected-') || id === 'sketch-preview' || id === 'gps-track-preview')) {
        hideIds.push(id);
      }
    }
    const restoreVis: Array<[string, string]> = [];

    // ---- save state we will mutate ----
    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    const container = map.getContainer();
    const savedCss = container.style.cssText;
    const interactions = [
      'dragPan', 'scrollZoom', 'boxZoom', 'dragRotate',
      'keyboard', 'doubleClickZoom', 'touchZoomRotate',
    ] as const;

    const modal = this.createModal(() => controller?.abort());
    const setStatus = (msg: string) => {
      const el = modal.querySelector('.mce-status');
      if (el) el.textContent = msg;
    };

    // Whether the style contains async overlays (HRDEM/COG image sources or
    // rampify/cog raster tiles) that are NOT tracked by MapLibre's `idle`.
    const hasDynamicOverlays = this.styleHasDynamicOverlays(map);

    // Block size in tiles: render NxN tiles per camera move to amortize the
    // per-viewport HRDEM/COG fetch cost. Each tile is SCREEN_TILE (512) CSS px,
    // so cap the block so the backing store stays within GPU texture limits
    // (~4096px) on high-DPI screens.
    const dpr0 = window.devicePixelRatio || 1;
    const BLOCK = Math.max(1, Math.min(4, Math.floor(4096 / (SCREEN_TILE * dpr0))));

    try {
      for (const i of interactions) (map[i] as { disable: () => void }).disable();

      // Hide GPS / (optionally) collected layers, remembering prior visibility.
      for (const id of hideIds) {
        if (!map.getLayer(id)) continue;
        const prev = (map.getLayoutProperty(id, 'visibility') as string | undefined) ?? 'visible';
        restoreVis.push([id, prev]);
        map.setLayoutProperty(id, 'visibility', 'none');
      }

      // Resize the map container to an exact block-sized square so each block
      // renders 1:1 with the tile grid regardless of the real screen size.
      const side = BLOCK * SCREEN_TILE;
      container.style.cssText =
        `position:absolute;left:0;top:0;right:auto;bottom:auto;width:${side}px;height:${side}px;z-index:1;`;
      map.resize();

      // ---- enumerate work ----
      const blocks: Array<{ z: number; bx: number; by: number;
        xMin: number; xMax: number; yMin: number; yMax: number }> = [];
      let totalTiles = 0;
      for (let z = zMin; z <= zMax; z++) {
        const xMin = lon2tile(safeBbox[0], z);
        const xMax = lon2tile(safeBbox[2], z);
        const yMin = lat2tile(safeBbox[3], z); // north → smaller y
        const yMax = lat2tile(safeBbox[1], z);
        totalTiles += (xMax - xMin + 1) * (yMax - yMin + 1);
        for (let bx = xMin; bx <= xMax; bx += BLOCK) {
          for (let by = yMin; by <= yMax; by += BLOCK) {
            blocks.push({ z, bx, by, xMin, xMax, yMin, yMax });
          }
        }
      }

      const SQL = await this.initSql();
      const db = new SQL.Database();
      db.run(`
        CREATE TABLE metadata (name TEXT, value TEXT);
        CREATE TABLE tiles (
          zoom_level INTEGER,
          tile_column INTEGER,
          tile_row INTEGER,
          tile_data BLOB
        );
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
      `);
      const metaStmt = db.prepare('INSERT INTO metadata VALUES (?, ?)');
      for (const [k, v] of [
        ['name', name],
        ['type', 'baselayer'],
        ['version', '1.0'],
        ['description', 'Composited from GPS Field Mapper'],
        ['format', 'png'],
        ['bounds', `${safeBbox[0]},${safeBbox[1]},${safeBbox[2]},${safeBbox[3]}`],
        ['minzoom', String(zMin)],
        ['maxzoom', String(zMax)],
      ] as [string, string][]) metaStmt.run([k, v]);
      metaStmt.free();

      const tileStmt = db.prepare(
        'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
      );

      // Reused scratch canvas for slicing each 256px tile.
      const tileCanvas = document.createElement('canvas');
      tileCanvas.width = TILE;
      tileCanvas.height = TILE;
      const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true })!;

      let done = 0;
      let written = 0;

      for (let b = 0; b < blocks.length; b++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const blk = blocks[b];
        setStatus(`Rendering z${blk.z} — block ${b + 1} / ${blocks.length}`);

        // Centre the camera on the block centre (fractional tile coords) at the
        // exact integer zoom so the block aligns with the canvas tile grid.
        const cLng = tile2lon(blk.bx + BLOCK / 2, blk.z);
        const cLat = tile2lat(blk.by + BLOCK / 2, blk.z);
        map.jumpTo({ center: [cLng, cLat], zoom: blk.z, bearing: 0, pitch: 0 });

        await this.settle(map, hasDynamicOverlays, signal);

        const srcCanvas = map.getCanvas();
        const dpr = srcCanvas.width / srcCanvas.clientWidth;

        // Measure the real on-screen tile footprint via projection rather than
        // assuming it: at integer zoom this is SCREEN_TILE (512) CSS px, but
        // measuring is robust to MapLibre version / source tile-size quirks.
        const c0 = map.project([tile2lon(blk.bx, blk.z), tile2lat(blk.by, blk.z)]);
        const c1 = map.project([tile2lon(blk.bx + 1, blk.z), tile2lat(blk.by + 1, blk.z)]);
        const footprint = Math.round((c1.x - c0.x) * dpr);

        for (let tx = blk.bx; tx < blk.bx + BLOCK && tx <= blk.xMax; tx++) {
          for (let ty = blk.by; ty < blk.by + BLOCK && ty <= blk.yMax; ty++) {
            if (tx < blk.xMin || ty < blk.yMin) continue;

            // Locate this tile's NW corner on the live canvas via the map's own
            // projection (robust against sub-pixel camera rounding).
            const p = map.project([tile2lon(tx, blk.z), tile2lat(ty, blk.z)]);
            const sx = Math.round(p.x * dpr);
            const sy = Math.round(p.y * dpr);
            // Clamp the source rect to the canvas so rounding at the block edge
            // never reads out of bounds.
            const sw = Math.min(footprint, srcCanvas.width - sx);
            const sh = Math.min(footprint, srcCanvas.height - sy);
            if (sx < 0 || sy < 0 || sw <= 0 || sh <= 0) continue;

            tileCtx.clearRect(0, 0, TILE, TILE);
            // Downscale the (≈512px) footprint into the 256px output tile.
            const dw = TILE * (sw / footprint);
            const dh = TILE * (sh / footprint);
            tileCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, dw, dh);

            done++;
            // Skip fully-transparent tiles.
            const alpha = tileCtx.getImageData(0, 0, 1, 1).data[3];
            const center = tileCtx.getImageData(TILE / 2, TILE / 2, 1, 1).data[3];
            if (alpha === 0 && center === 0) {
              onProgress(done, totalTiles, 'render');
              continue;
            }

            const pngBlob = await new Promise<Blob>(resolve =>
              tileCanvas.toBlob(bl => resolve(bl!), 'image/png'),
            );
            const bytes = new Uint8Array(await pngBlob.arrayBuffer());
            const tmsY = (1 << blk.z) - 1 - ty;
            tileStmt.run([blk.z, tx, tmsY, bytes]);
            written++;
            onProgress(done, totalTiles, 'render');
          }
        }

        // Yield so the compositor/GC stay healthy across long exports.
        await new Promise(r => setTimeout(r, 0));
      }

      tileStmt.free();
      setStatus('Packaging MBTiles…');
      const data = db.export();
      db.close();

      const blob = new Blob([data.slice()], { type: 'application/x-sqlite3' });
      return { blob, tileCount: written };
    } finally {
      // Restore everything regardless of success/abort/error.
      for (const [id, vis] of restoreVis) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
      container.style.cssText = savedCss;
      map.resize();
      map.jumpTo(camera);
      for (const i of interactions) (map[i] as { enable: () => void }).enable();
      modal.remove();
    }
  }

  // ---- helpers ----

  private async initSql() {
    const initSqlJs = (await import('sql.js')).default;
    return initSqlJs({
      locateFile: (_f: string) => `${import.meta.env.BASE_URL}sql-wasm-browser.wasm`,
    });
  }

  /**
   * Returns once the current camera position is fully rendered. `idle` covers
   * tiled sources, but HRDEM/COG layers fetch asynchronously (debounced on
   * moveend) and are not tracked by it, so when dynamic overlays are present we
   * additionally wait out a quiet period of no `data` events.
   */
  private async settle(map: MLMap, dynamic: boolean, signal?: AbortSignal): Promise<void> {
    await new Promise<void>(res => map.once('idle', () => res()));

    if (dynamic) {
      const QUIET_MS = 1400;   // > HRDEM debounce (300) + typical fetch
      const TIMEOUT_MS = 12000;
      const start = Date.now();
      let lastData = Date.now();
      const onData = () => { lastData = Date.now(); };
      map.on('data', onData);
      try {
        // Ensure the debounced fetch has had a chance to fire at least once.
        await new Promise(r => setTimeout(r, 400));
        for (;;) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          if (map.areTilesLoaded() && Date.now() - lastData >= QUIET_MS) break;
          if (Date.now() - start >= TIMEOUT_MS) {
            console.warn('[MapCompositeExporter] block settle timed out');
            break;
          }
          await new Promise(r => setTimeout(r, 100));
        }
      } finally {
        map.off('data', onData);
      }
    }

    // Two animation frames to guarantee the composited frame (incl. custom
    // WebGL layers) is present in the preserved drawing buffer.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
  }

  private styleHasDynamicOverlays(map: MLMap): boolean {
    try {
      const style = map.getStyle();
      const srcs = Object.values(style.sources ?? {});
      return srcs.some(s => {
        const t = (s as { type?: string }).type;
        if (t === 'image') return true; // HRDEM / COG fill
        const tiles = (s as { tiles?: string[] }).tiles;
        return Array.isArray(tiles) && tiles.some(u =>
          u.startsWith('cog://') || u.startsWith('rampify://'));
      });
    } catch {
      return true; // be conservative
    }
  }

  private createModal(onCancel: () => void): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mce-export-overlay';
    el.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    el.innerHTML =
      '<div style="background:#1b1b1f;color:#eee;padding:24px 28px;border-radius:10px;' +
      'min-width:260px;text-align:center;font:14px system-ui,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5)">' +
      '<div style="font-weight:600;margin-bottom:10px">Exporting offline map…</div>' +
      '<div class="mce-status" style="opacity:0.8">Preparing…</div>' +
      '<div style="margin-top:12px;font-size:12px;opacity:0.55">Please don\'t interact with the map</div>' +
      '<button class="mce-cancel" style="margin-top:16px;padding:6px 18px;border:1px solid #555;' +
      'background:#2a2a30;color:#eee;border-radius:6px;cursor:pointer">Cancel</button>' +
      '</div>';
    el.querySelector<HTMLButtonElement>('.mce-cancel')?.addEventListener('click', onCancel);
    document.body.appendChild(el);
    return el;
  }
}

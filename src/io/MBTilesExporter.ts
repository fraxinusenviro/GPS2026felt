import { StorageManager } from '../storage/StorageManager';
import { buildTileCoords, buildTileUrl } from '../cache/tileUtils';
import { fetchVectorFeatures, renderVectorFeatures, renderContourFeatures } from './VectorTileRenderer';
import type { VectorLayerInfo, HrdemContourLayerInfo } from './VectorTileRenderer';
import { fetchHRDEM } from '../lib/hrdemWCS';
import { generateContours } from '../lib/contourGenerator';

const MIN_VECTOR_ZOOM = 12;
const CONTOUR_GRID_SIZE = 1024;

export class MBTilesExporter {
  private storage = StorageManager.getInstance();

  async exportCache(
    bbox: [number, number, number, number],
    zoomMin: number,
    zoomMax: number,
    name: string,
    rasterLayers: { url: string; opacity: number }[],
    vectorLayers: VectorLayerInfo[] = [],
    hrdemContourLayers: HrdemContourLayerInfo[] = [],
  ): Promise<void> {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (_filename: string) => `${import.meta.env.BASE_URL}sql-wasm-browser.wasm`,
    });

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

    const [west, south, east, north] = bbox;
    const metaRows: [string, string][] = [
      ['name', name],
      ['type', 'overlay'],
      ['version', '1.0'],
      ['description', 'Exported from GPS Field Mapper'],
      ['format', 'png'],
      ['bounds', `${west},${south},${east},${north}`],
      ['minzoom', String(zoomMin)],
      ['maxzoom', String(zoomMax)],
    ];
    const metaStmt = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    for (const [k, v] of metaRows) metaStmt.run([k, v]);
    metaStmt.free();

    const tileStmt = db.prepare(
      'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    );

    // Pre-fetch all vector features once for the entire bbox
    const vectorFeatures = vectorLayers.length > 0
      ? await Promise.all(vectorLayers.map(vl => fetchVectorFeatures(vl.config, bbox, zoomMax)))
      : [];

    // Pre-fetch HRDEM elevation + generate contours for the entire bbox
    const contourFeatures: GeoJSON.Feature[][] = await Promise.all(
      hrdemContourLayers.map(async cl => {
        try {
          const result = await fetchHRDEM(west, south, east, north, CONTOUR_GRID_SIZE, CONTOUR_GRID_SIZE, cl.surface);
          const fc = generateContours(result, cl.contourInterval);
          return fc.features as GeoJSON.Feature[];
        } catch {
          return [];
        }
      }),
    );

    const coords = buildTileCoords(bbox, zoomMin, zoomMax);

    for (const { x, y, z } of coords) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      let hasContent = false;

      // Draw raster layers
      for (const { url, opacity } of rasterLayers) {
        const blob = await this.fetchTile(url, x, y, z);
        if (!blob) continue;

        const bmp = await createImageBitmap(blob);
        ctx.globalAlpha = opacity;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        hasContent = true;
      }

      // Draw vector layers (only at zoom >= MIN_VECTOR_ZOOM)
      if (z >= MIN_VECTOR_ZOOM && vectorFeatures.length > 0) {
        for (let i = 0; i < vectorLayers.length; i++) {
          if (vectorFeatures[i].length === 0) continue;
          renderVectorFeatures(ctx, vectorFeatures[i], x, y, z, vectorLayers[i]);
          hasContent = true;
        }
      }

      // Draw HRDEM contours (only at zoom >= MIN_VECTOR_ZOOM)
      if (z >= MIN_VECTOR_ZOOM && contourFeatures.length > 0) {
        for (let i = 0; i < hrdemContourLayers.length; i++) {
          if (contourFeatures[i].length === 0) continue;
          renderContourFeatures(ctx, contourFeatures[i], x, y, z, hrdemContourLayers[i]);
          hasContent = true;
        }
      }

      if (!hasContent) continue;

      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      if (pixel[3] === 0) continue;

      const pngBlob = await new Promise<Blob>(resolve =>
        canvas.toBlob(b => resolve(b!), 'image/png'),
      );
      const bytes = new Uint8Array(await pngBlob.arrayBuffer());
      const tmsY = (1 << z) - 1 - y;
      tileStmt.run([z, x, tmsY, bytes]);
    }

    tileStmt.free();

    const data = db.export();
    db.close();

    const fileBlob = new Blob([data.slice()], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.mbtiles`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async fetchTile(url: string, x: number, y: number, z: number): Promise<Blob | null> {
    if (url.startsWith('bmcache://')) {
      // bmcache://cacheId/defId/{z}/{x}/{y}
      const parts = url.split('/');
      const layerId = `bmcache-${parts[2]}-${parts[3]}`;
      return this.storage.getTile(layerId, z, x, y);
    }

    if (url.startsWith('mbtiles://')) {
      // mbtiles://layerId/{z}/{x}/{y}
      const layerId = url.split('/')[2];
      return this.storage.getTile(layerId, z, x, y);
    }

    // Live XYZ or WMS
    try {
      const resp = await fetch(buildTileUrl(url, x, y, z));
      return resp.ok ? resp.blob() : null;
    } catch {
      return null;
    }
  }
}

import { StorageManager } from '../storage/StorageManager';
import { buildTileCoords } from '../cache/tileUtils';
import type { TileCacheRecord } from '../types';

export class MBTilesExporter {
  private storage = StorageManager.getInstance();

  async exportCache(
    record: TileCacheRecord,
    layerOpacities: { defId: string; opacity: number }[],
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

    const [west, south, east, north] = record.bbox;
    const metaRows: [string, string][] = [
      ['name', record.name],
      ['type', 'overlay'],
      ['version', '1.0'],
      ['description', 'Exported from GPS Field Mapper'],
      ['format', 'png'],
      ['bounds', `${west},${south},${east},${north}`],
      ['minzoom', String(record.zoom_min)],
      ['maxzoom', String(record.zoom_max)],
    ];
    const metaStmt = db.prepare('INSERT INTO metadata VALUES (?, ?)');
    for (const [k, v] of metaRows) {
      metaStmt.run([k, v]);
    }
    metaStmt.free();

    const tileStmt = db.prepare(
      'INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    );

    const coords = buildTileCoords(record.bbox, record.zoom_min, record.zoom_max);

    // Filter layerOpacities to only layers that exist in this cache record
    const cachedDefIds = new Set(record.layers.map(l => l.defId));
    const layers = layerOpacities.filter(l => cachedDefIds.has(l.defId));

    for (const { x, y, z } of coords) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      let hasContent = false;

      for (const { defId, opacity } of layers) {
        const layerId = `bmcache-${record.id}-${defId}`;
        const blob = await this.storage.getTile(layerId, z, x, y);
        if (!blob) continue;

        const bmp = await createImageBitmap(blob);
        ctx.globalAlpha = opacity;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        hasContent = true;
      }

      if (!hasContent) continue;

      // Skip fully-transparent tiles to reduce file size
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

    const fileBlob = new Blob([data], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${record.name}.mbtiles`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

import { StorageManager } from '../storage/StorageManager';
import type { TileCacheRecord, TileCacheLayerDef } from '../types';
import { buildTileCoords, buildTileUrl } from './tileUtils';

// ---- Estimate size per tile by layer type ----
function bytesPerTile(urlTemplate: string): number {
  if (urlTemplate.includes('WMS') || urlTemplate.includes('wms')) return 20 * 1024; // ~20 KB
  // XYZ / OSM
  if (urlTemplate.includes('openstreetmap') || urlTemplate.includes('opentopomap')) return 15 * 1024;
  return 40 * 1024; // imagery default ~40 KB
}

export class TileCacheManager {
  private storage = StorageManager.getInstance();

  estimateTileCount(
    bbox: [number, number, number, number],
    layers: TileCacheLayerDef[],
    zMin: number,
    zMax: number,
  ): { tileCount: number; estimatedBytes: number } {
    const coords = buildTileCoords(bbox, zMin, zMax);
    const tileCount = coords.length;
    const totalTiles = tileCount * layers.length;
    const avgBytes = layers.reduce((s, l) => s + bytesPerTile(l.urlTemplate), 0) / Math.max(1, layers.length);
    return { tileCount: totalTiles, estimatedBytes: Math.round(totalTiles * avgBytes) };
  }

  async downloadCache(
    params: {
      name: string;
      bbox: [number, number, number, number];
      layers: TileCacheLayerDef[];
      zMin: number;
      zMax: number;
    },
    onProgress: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<TileCacheRecord> {
    const { name, bbox, layers, zMin, zMax } = params;
    const cacheId = crypto.randomUUID();

    const tiles = buildTileCoords(bbox, zMin, zMax);

    const total = tiles.length * layers.length;
    let done = 0;
    let sizeBytes = 0;

    const CONCURRENCY = 6;

    for (const layer of layers) {
      const layerId = `bmcache-${cacheId}-${layer.defId}`;
      let i = 0;

      while (i < tiles.length) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const batch = tiles.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async ({ x, y, z }) => {
          const url = buildTileUrl(layer.urlTemplate, x, y, z);
          try {
            const resp = await fetch(url);
            if (resp.ok) {
              const blob = await resp.blob();
              sizeBytes += blob.size;
              await this.storage.saveTile(layerId, z, x, y, blob);
            }
          } catch { /* network error — skip tile */ }
          done++;
          onProgress(done, total);
        }));
        i += CONCURRENCY;
      }
    }

    const record: TileCacheRecord = {
      id: cacheId,
      name,
      created_at: new Date().toISOString(),
      bbox,
      layers,
      zoom_min: zMin,
      zoom_max: zMax,
      tile_count: done,
      size_bytes: sizeBytes,
    };
    await this.storage.saveCache(record);
    return record;
  }

  async deleteCache(cacheId: string): Promise<void> {
    const record = await this.storage.getCacheById(cacheId);
    if (!record) return;
    for (const layer of record.layers) {
      await this.storage.clearTilesForLayer(`bmcache-${cacheId}-${layer.defId}`);
    }
    await this.storage.deleteCache(cacheId);
  }

  async getAllCaches(): Promise<TileCacheRecord[]> {
    return this.storage.getAllCaches();
  }
}

import { StorageManager } from '../storage/StorageManager';
import type { TileCacheRecord, TileCacheLayerDef } from '../types';

// ---- Tile math ----
function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function lat2tile(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

function tile3857Bbox(x: number, y: number, z: number): string {
  const e = 20037508.3427892;
  const n = Math.pow(2, z);
  const w3857 = -e + x * ((e * 2) / n);
  const e3857 = w3857 + (e * 2) / n;
  const n3857 = e - y * ((e * 2) / n);
  const s3857 = n3857 - (e * 2) / n;
  return `${w3857},${s3857},${e3857},${n3857}`;
}

function buildTileUrl(urlTemplate: string, x: number, y: number, z: number): string {
  return urlTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{bbox-epsg-3857}', tile3857Bbox(x, y, z));
}

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
    const [west, south, east, north] = bbox;
    let tileCount = 0;
    for (let z = zMin; z <= zMax; z++) {
      const xMin = lon2tile(west,  z), xMax = lon2tile(east,  z);
      const yMin = lat2tile(north, z), yMax = lat2tile(south, z);
      tileCount += (xMax - xMin + 1) * (yMax - yMin + 1);
    }
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
  ): Promise<string> {
    const { name, bbox, layers, zMin, zMax } = params;
    const [west, south, east, north] = bbox;
    const cacheId = crypto.randomUUID();

    // Build full tile list
    const tiles: Array<{ x: number; y: number; z: number }> = [];
    for (let z = zMin; z <= zMax; z++) {
      const xMin = lon2tile(west,  z), xMax = lon2tile(east,  z);
      const yMin = lat2tile(north, z), yMax = lat2tile(south, z);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tiles.push({ x, y, z });
        }
      }
    }

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
    return cacheId;
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

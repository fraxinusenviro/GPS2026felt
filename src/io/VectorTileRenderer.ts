import type { VectorLayerConfig } from '../types';

export interface VectorLayerInfo {
  opacity: number;
  config: VectorLayerConfig;
  lineColorOverride?: string;
  fillColorOverride?: string;
  lineWidthOverride?: number;
  fillOpacityOverride?: number;
}

// ---- WFS fetch ----

export async function fetchVectorFeatures(
  config: VectorLayerConfig,
  bbox: [number, number, number, number],
  maxZoom: number,
): Promise<GeoJSON.Feature[]> {
  const endpoint =
    config.highZoomEndpoint && config.highZoomThreshold !== undefined && maxZoom >= config.highZoomThreshold
      ? config.highZoomEndpoint
      : config.endpoint;

  const endpoints = [endpoint, ...(config.additionalEndpoints ?? [])];
  const [west, south, east, north] = bbox;

  const params = new URLSearchParams({
    f: 'geojson',
    geometry: `${west},${south},${east},${north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outSR: '4326',
    outFields: config.outFields ?? '*',
    resultRecordCount: String(config.resultRecordCount ?? 2000),
  });
  if (config.where) params.set('where', config.where);

  const results = await Promise.all(
    endpoints.map(async ep => {
      try {
        const resp = await fetch(`${ep}?${params}`);
        if (!resp.ok) return [];
        const json = await resp.json() as { features?: GeoJSON.Feature[] };
        return json.features ?? [];
      } catch {
        return [];
      }
    }),
  );

  return results.flat();
}

// ---- Paint expression evaluator ----

function evalPaint(expr: string | number | unknown[], feature: GeoJSON.Feature): string | number {
  if (typeof expr === 'string' || typeof expr === 'number') return expr;
  if (Array.isArray(expr) && expr[0] === 'match') {
    const getExpr = expr[1] as unknown[];
    const prop = getExpr[1] as string;
    const value = feature.properties?.[prop];
    const pairs = expr.slice(2);
    for (let i = 0; i < pairs.length - 1; i += 2) {
      if (pairs[i] === value) return pairs[i + 1] as string | number;
    }
    return pairs[pairs.length - 1] as string | number;
  }
  return typeof expr === 'string' ? '#888888' : 1;
}

// ---- Coordinate projection ----

function lngLatToTilePixel(
  lng: number, lat: number,
  tileX: number, tileY: number, z: number,
): { x: number; y: number } {
  const n = 1 << z;
  const px = ((lng + 180) / 360 * n - tileX) * 256;
  const latRad = lat * Math.PI / 180;
  const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY) * 256;
  return { x: px, y: py };
}

// ---- Canvas renderer ----

export function renderVectorFeatures(
  ctx: CanvasRenderingContext2D,
  features: GeoJSON.Feature[],
  tileX: number,
  tileY: number,
  z: number,
  layer: VectorLayerInfo,
): void {
  const { opacity, config } = layer;

  for (const feature of features) {
    const geom = feature.geometry;
    if (!geom) continue;

    const lineColor = layer.lineColorOverride
      ?? String(evalPaint(config.lineColor, feature));
    const lineWidth = layer.lineWidthOverride
      ?? Number(evalPaint(config.lineWidth, feature));
    const fillColor = layer.fillColorOverride
      ?? (config.fillColor ? String(evalPaint(config.fillColor, feature)) : undefined);
    const fillOpacity = layer.fillOpacityOverride ?? config.fillOpacity ?? 0.4;

    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      const polygons: number[][][] =
        geom.type === 'Polygon' ? [geom.coordinates as number[][][]] : geom.coordinates as number[][][][];
      for (const rings of polygons) {
        ctx.beginPath();
        for (const ring of rings) {
          let first = true;
          for (const coord of ring) {
            const { x, y } = lngLatToTilePixel(coord[0], coord[1], tileX, tileY, z);
            if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        if (fillColor) {
          ctx.globalAlpha = fillOpacity * opacity;
          ctx.fillStyle = fillColor;
          ctx.fill('evenodd');
        }
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    } else if (geom.type === 'LineString' || geom.type === 'MultiLineString') {
      const lines: number[][][] =
        geom.type === 'LineString' ? [geom.coordinates as number[][]] : geom.coordinates as number[][][];
      for (const line of lines) {
        ctx.beginPath();
        let first = true;
        for (const coord of line) {
          const { x, y } = lngLatToTilePixel(coord[0], coord[1], tileX, tileY, z);
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
}

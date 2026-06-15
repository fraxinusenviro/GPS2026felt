// Web Mercator is undefined beyond this latitude.
export const MAX_MERCATOR_LAT = 85.0511287798;

export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
}

/** Longitude of a (possibly fractional) tile column's left edge. */
export function tile2lon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Latitude of a (possibly fractional) tile row's top edge. */
export function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Clamp a [w,s,e,n] bbox latitude to the Web Mercator valid range. */
export function clampBboxLat(
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [w, s, e, n] = bbox;
  return [
    w,
    Math.max(-MAX_MERCATOR_LAT, s),
    e,
    Math.min(MAX_MERCATOR_LAT, n),
  ];
}

export function buildTileCoords(
  bbox: [number, number, number, number],
  zMin: number,
  zMax: number,
): Array<{ x: number; y: number; z: number }> {
  const [west, south, east, north] = bbox;
  const tiles: Array<{ x: number; y: number; z: number }> = [];
  for (let z = zMin; z <= zMax; z++) {
    const xMin = lon2tile(west, z), xMax = lon2tile(east, z);
    const yMin = lat2tile(north, z), yMax = lat2tile(south, z);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ x, y, z });
      }
    }
  }
  return tiles;
}

export function tile3857Bbox(x: number, y: number, z: number): string {
  const e = 20037508.3427892;
  const n = Math.pow(2, z);
  const w3857 = -e + x * ((e * 2) / n);
  const e3857 = w3857 + (e * 2) / n;
  const n3857 = e - y * ((e * 2) / n);
  const s3857 = n3857 - (e * 2) / n;
  return `${w3857},${s3857},${e3857},${n3857}`;
}

export function buildTileUrl(urlTemplate: string, x: number, y: number, z: number): string {
  return urlTemplate
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{bbox-epsg-3857}', tile3857Bbox(x, y, z));
}

export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z),
  );
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

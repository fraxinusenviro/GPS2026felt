import proj4 from 'proj4';

// Register WGS84 and UTM projections
proj4.defs('WGS84', '+proj=longlat +datum=WGS84 +no_defs');

/**
 * Calculate the UTM zone number for a given longitude
 */
export function getUTMZone(lon: number): number {
  return Math.floor((lon + 180) / 6) + 1;
}

/**
 * Get the UTM projection string for a given zone and hemisphere
 */
export function getUTMProjString(zone: number, isNorth: boolean): string {
  return `+proj=utm +zone=${zone} +${isNorth ? 'north' : 'south'} +datum=WGS84 +units=m +no_defs`;
}

export interface UTMCoord {
  zone: number;
  hemisphere: 'N' | 'S';
  easting: number;
  northing: number;
  letter: string;
}

/**
 * Convert decimal degrees (lon, lat) to UTM
 */
export function lonLatToUTM(lon: number, lat: number): UTMCoord {
  const zone = getUTMZone(lon);
  const isNorth = lat >= 0;
  const projStr = getUTMProjString(zone, isNorth);

  const [easting, northing] = proj4('WGS84', projStr, [lon, lat]);
  const letter = getUTMLetter(lat);

  return {
    zone,
    hemisphere: isNorth ? 'N' : 'S',
    easting: Math.round(easting * 100) / 100,
    northing: Math.round(northing * 100) / 100,
    letter
  };
}

/**
 * Format UTM coordinate as string: "20N E 439998 N 4934519"
 */
export function formatUTM(coord: UTMCoord): string {
  return `${coord.zone}${coord.letter} E ${Math.round(coord.easting)} N ${Math.round(coord.northing)}`;
}

/**
 * Get UTM latitude band letter
 */
export function getUTMLetter(lat: number): string {
  const letters = 'CDEFGHJKLMNPQRSTUVWX';
  const idx = Math.floor((lat + 80) / 8);
  return letters[Math.max(0, Math.min(19, idx))] ?? 'N';
}

/**
 * Convert decimal degrees to DMS string
 */
export function ddToDMS(dd: number, isLon: boolean): string {
  const dir = isLon ? (dd >= 0 ? 'E' : 'W') : (dd >= 0 ? 'N' : 'S');
  const abs = Math.abs(dd);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(2);
  return `${deg}°${min}'${sec}"${dir}`;
}

/**
 * Format lat/lon as decimal degrees
 */
export function formatDD(lat: number, lon: number, precision = 6): string {
  return `${lat.toFixed(precision)}N, ${Math.abs(lon).toFixed(precision)}${lon >= 0 ? 'E' : 'W'}`;
}

/**
 * Calculate distance between two WGS84 points (Haversine) in metres
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in metres
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Calculate approximate area of polygon in square metres (on WGS84 sphere)
 * Uses the shoelace formula projected to a local UTM frame
 */
export function polygonAreaM2(coords: Array<[number, number]>): number {
  if (coords.length < 3) return 0;
  const centerLon = coords.reduce((s, c) => s + c[0], 0) / coords.length;
  const centerLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
  const zone = getUTMZone(centerLon);
  const projStr = getUTMProjString(zone, centerLat >= 0);

  const projected = coords.map(c => proj4('WGS84', projStr, [c[0], c[1]]));
  let area = 0;
  for (let i = 0; i < projected.length; i++) {
    const j = (i + 1) % projected.length;
    area += projected[i][0] * projected[j][1];
    area -= projected[j][0] * projected[i][1];
  }
  return Math.abs(area / 2);
}

/**
 * Calculate total length of a linestring in metres
 */
export function lineLength(coords: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

/**
 * Format metres as human-readable string
 */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/**
 * Format area as human-readable string
 */
export function formatArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  return `${(m2 / 10000).toFixed(2)} ha`;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a UTM grid for a given bounding box and interval (metres)
 * Returns a GeoJSON FeatureCollection of lines with label properties
 */
export function generateUTMGrid(
  bounds: { west: number; south: number; east: number; north: number },
  intervalM: number
): { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: Array<[number, number]> }; properties: { label: string; isEasting: boolean } }> } {
  const features: Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: Array<[number, number]> }; properties: { label: string; isEasting: boolean } }> = [];

  // Get centre UTM zone
  const centerLon = (bounds.west + bounds.east) / 2;
  const centerLat = (bounds.south + bounds.north) / 2;
  const zone = getUTMZone(centerLon);
  const isNorth = centerLat >= 0;
  const projStr = getUTMProjString(zone, isNorth);

  // Project corners to UTM
  const sw = proj4('WGS84', projStr, [bounds.west, bounds.south]);
  const ne = proj4('WGS84', projStr, [bounds.east, bounds.north]);

  // Snap to grid
  const minE = Math.floor(sw[0] / intervalM) * intervalM;
  const maxE = Math.ceil(ne[0] / intervalM) * intervalM;
  const minN = Math.floor(sw[1] / intervalM) * intervalM;
  const maxN = Math.ceil(ne[1] / intervalM) * intervalM;

  const steps = 20; // number of interpolation points per line for curvature

  // Northing lines (horizontal) - constant northing, varying easting
  for (let n = minN; n <= maxN; n += intervalM) {
    const coords: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const e = minE + ((maxE - minE) * i) / steps;
      try {
        const lonlat = proj4(projStr, 'WGS84', [e, n]);
        if (isFinite(lonlat[0]) && isFinite(lonlat[1])) {
          coords.push([lonlat[0], lonlat[1]]);
        }
      } catch { /* skip */ }
    }
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { label: `${Math.round(n)}`, isEasting: false }
      });
    }
  }

  // Easting lines (vertical) - constant easting, varying northing
  for (let e = minE; e <= maxE; e += intervalM) {
    const coords: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const n = minN + ((maxN - minN) * i) / steps;
      try {
        const lonlat = proj4(projStr, 'WGS84', [e, n]);
        if (isFinite(lonlat[0]) && isFinite(lonlat[1])) {
          coords.push([lonlat[0], lonlat[1]]);
        }
      } catch { /* skip */ }
    }
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { label: `${Math.round(e)}`, isEasting: true }
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Pick a sensible UTM grid interval based on map zoom level
 */
export function getGridInterval(zoom: number): number {
  if (zoom >= 18) return 25;
  if (zoom >= 17) return 50;
  if (zoom >= 16) return 100;
  if (zoom >= 14) return 250;
  if (zoom >= 13) return 500;
  if (zoom >= 11) return 1000;
  if (zoom >= 9) return 2500;
  if (zoom >= 7) return 5000;
  if (zoom >= 5) return 10000;
  if (zoom >= 3) return 25000;
  return 50000;
}

import * as turf from '@turf/turf';
import type { GeoJSONPolygon } from '../types';

/**
 * Classic stroke reshape: replaces one arc of a polygon's outer ring with the stroke.
 * The stroke must intersect the boundary at least twice.
 * Returns the larger of the two candidate polygons (preserves the main body), or null.
 */
export function reshapePolygonWithStroke(
  poly: GeoJSONPolygon,
  stroke: Array<[number, number]>
): GeoJSONPolygon | null {
  if (stroke.length < 2) return null;

  const strokeLine = turf.lineString(stroke);
  const ring       = poly.coordinates[0] as Array<[number, number]>;
  const ringLine   = turf.lineString(ring);

  const intersects = turf.lineIntersect(strokeLine, ringLine);
  if (intersects.features.length < 2) return null;

  // Sort intersections by their position along the stroke
  const sorted = intersects.features.map(
    (f: (typeof intersects.features)[number]) => ({
      coord: f.geometry!.coordinates as [number, number],
      loc:   turf.nearestPointOnLine(strokeLine, f).properties.location ?? 0,
    })
  ).sort(
    (a: { coord: [number,number]; loc: number }, b: { coord: [number,number]; loc: number }) =>
      a.loc - b.loc
  );

  const ptFirst = sorted[0].coord;
  const ptLast  = sorted[sorted.length - 1].coord;

  // Slice the stroke between the first and last boundary crossing
  const seg      = turf.lineSlice(turf.point(ptFirst), turf.point(ptLast), strokeLine);
  const strokePts = seg.geometry.coordinates as Array<[number, number]>;

  // Locate crossing points on the ring
  let iA = turf.nearestPointOnLine(ringLine, turf.point(ptFirst)).properties.index ?? 0;
  let iB = turf.nearestPointOnLine(ringLine, turf.point(ptLast)).properties.index  ?? 0;
  let ptA = ptFirst, ptB = ptLast;
  let strokeFwd = strokePts;

  // Normalise so iA ≤ iB
  if (iA > iB) {
    [iA, iB]     = [iB, iA];
    [ptA, ptB]   = [ptB, ptA];
    strokeFwd    = [...strokePts].reverse() as Array<[number, number]>;
  }

  const uniqueRing = ring.slice(0, -1) as Array<[number, number]>;
  const n = uniqueRing.length;

  // arc1: ptA → ptB following ring direction
  const arc1: Array<[number, number]> = [ptA];
  for (let i = iA + 1; i <= iB; i++) arc1.push(uniqueRing[i]);
  arc1.push(ptB);

  // arc2: ptB → ptA wrapping the other way
  const arc2: Array<[number, number]> = [ptB];
  for (let k = 0; k <= n - iB + iA; k++) arc2.push(uniqueRing[(iB + 1 + k) % n]);
  arc2.push(ptA);

  const strokeRev = [...strokeFwd].reverse() as Array<[number, number]>;
  const ring1 = [...strokeFwd, ...arc2.slice(1)];   // stroke A→B  + arc2 B→A
  const ring2 = [...arc1, ...strokeRev.slice(1)];   // arc1  A→B  + stroke reversed B→A
  const holes = poly.coordinates.slice(1);

  let cand1: ReturnType<typeof turf.polygon> | null = null;
  let cand2: ReturnType<typeof turf.polygon> | null = null;
  try { cand1 = turf.polygon([ring1, ...holes]); } catch (_) { /* invalid ring */ }
  try { cand2 = turf.polygon([ring2, ...holes]); } catch (_) { /* invalid ring */ }

  if (!cand1 && !cand2) return null;
  if (!cand1) return cand2!.geometry as GeoJSONPolygon;
  if (!cand2) return cand1.geometry  as GeoJSONPolygon;
  return (turf.area(cand1) >= turf.area(cand2)
    ? cand1.geometry : cand2.geometry) as GeoJSONPolygon;
}

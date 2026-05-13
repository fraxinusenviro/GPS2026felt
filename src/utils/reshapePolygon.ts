import * as turf from '@turf/turf';
import type { GeoJSONPolygon } from '../types';

/**
 * Classic stroke reshape: replaces one arc of a polygon's outer ring with the stroke.
 * The stroke must cross the polygon boundary at least twice.
 * Returns the larger of the two candidate polygons (preserves the main body), or null.
 *
 * Uses booleanPointInPolygon to detect boundary crossings (more reliable than
 * lineIntersect for dense/short strokes) and a direct segment-intersection formula
 * to find the exact crossing coordinates.
 */
export function reshapePolygonWithStroke(
  poly: GeoJSONPolygon,
  stroke: Array<[number, number]>
): GeoJSONPolygon | null {
  if (stroke.length < 2) return null;

  const ring       = poly.coordinates[0] as Array<[number, number]>;
  const uniqueRing = ring.slice(0, -1) as Array<[number, number]>;
  const n          = uniqueRing.length;
  if (n < 3) return null;

  // Deduplicate consecutive identical stroke points
  const pts: Array<[number, number]> = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    if (stroke[i][0] !== pts[pts.length - 1][0] || stroke[i][1] !== pts[pts.length - 1][1]) {
      pts.push(stroke[i]);
    }
  }
  if (pts.length < 2) return null;

  const turfPoly = turf.polygon([ring]);

  // Classify each stroke vertex as inside or outside the polygon
  const inside: boolean[] = pts.map(pt =>
    turf.booleanPointInPolygon(turf.point(pt), turfPoly)
  );

  // Find stroke segment indices where inside/outside transitions
  interface Crossing {
    pt:      [number, number]; // exact intersection coordinate
    ringIdx: number;           // ring segment i → (i+1)%n
  }
  const crossings: Crossing[] = [];

  for (let si = 0; si < pts.length - 1; si++) {
    if (inside[si] === inside[si + 1]) continue;
    // This stroke segment must cross the ring — find which ring segment
    const sp1 = pts[si], sp2 = pts[si + 1];
    for (let ri = 0; ri < n; ri++) {
      const rp1 = uniqueRing[ri];
      const rp2 = uniqueRing[(ri + 1) % n];
      const pt  = segSegIntersect(sp1, sp2, rp1, rp2);
      if (pt) {
        crossings.push({ pt, ringIdx: ri });
        break;
      }
    }
  }

  if (crossings.length < 2) return null;

  // Use the first and last crossings as the reshape entry/exit points
  const crossA = crossings[0];
  const crossB = crossings[crossings.length - 1];

  // Build the stroke slice between the two crossings
  let siA = -1, siB = -1;
  let idx = 0;
  for (let si = 0; si < pts.length - 1; si++) {
    if (inside[si] !== inside[si + 1]) {
      if (siA === -1) { siA = si; idx = 0; }
      siB = si;
    }
  }
  const strokeSeg: Array<[number, number]> = [crossA.pt];
  for (let si = siA + 1; si <= siB; si++) strokeSeg.push(pts[si]);
  strokeSeg.push(crossB.pt);
  void idx; // unused after refactor

  let iA       = crossA.ringIdx;
  let iB       = crossB.ringIdx;
  let ptA      = crossA.pt;
  let ptB      = crossB.pt;
  let strokeFwd: Array<[number, number]> = strokeSeg;

  // Normalise so iA ≤ iB
  if (iA > iB) {
    [iA, iB]     = [iB, iA];
    [ptA, ptB]   = [ptB, ptA];
    strokeFwd    = [...strokeSeg].reverse() as Array<[number, number]>;
  }

  // arc1: ptA → ring vertices (iA+1 … iB) → ptB  (forward along ring)
  const arc1: Array<[number, number]> = [ptA];
  for (let i = iA + 1; i <= iB; i++) arc1.push(uniqueRing[i]);
  arc1.push(ptB);

  // arc2: ptB → ring vertices (iB+1 … wrap … iA) → ptA  (other way round)
  const arc2: Array<[number, number]> = [ptB];
  for (let k = 0; k < n - iB + iA; k++) arc2.push(uniqueRing[(iB + 1 + k) % n]);
  arc2.push(ptA);

  const strokeRev = [...strokeFwd].reverse() as Array<[number, number]>;
  const ring1 = [...strokeFwd, ...arc2.slice(1)];  // stroke A→B  + arc2 B→A
  const ring2 = [...arc1,  ...strokeRev.slice(1)]; // arc1  A→B  + stroke B→A
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

/** Returns the intersection point of segments p1→p2 and p3→p4, or null. */
function segSegIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): [number, number] | null {
  const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
  const dx2 = p4[0] - p3[0], dy2 = p4[1] - p3[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-15) return null; // parallel / collinear
  const dx3 = p1[0] - p3[0], dy3 = p1[1] - p3[1];
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p1[0] + t * dx1, p1[1] + t * dy1];
}

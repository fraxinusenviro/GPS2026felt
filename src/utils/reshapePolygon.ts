import * as turf from '@turf/turf';
import type { GeoJSONPolygon } from '../types';

/**
 * Classic stroke reshape: replaces one arc of a polygon's outer ring with the stroke.
 * The stroke must cross the polygon boundary at least twice.
 * Returns the larger of the two candidate polygons (preserves the main body), or null.
 *
 * Uses brute-force segment×segment intersection (every stroke segment against every ring
 * segment) so it works regardless of whether stroke endpoints are inside or outside the
 * polygon — turf.lineIntersect and booleanPointInPolygon both have edge-case failures
 * for short/fast strokes that start and end outside the polygon.
 */
export function reshapePolygonWithStroke(
  poly: GeoJSONPolygon,
  stroke: Array<[number, number]>
): GeoJSONPolygon | null {
  if (stroke.length < 2) return null;

  // Deduplicate consecutive identical stroke points
  const pts: Array<[number, number]> = [stroke[0]];
  for (let i = 1; i < stroke.length; i++) {
    const prev = pts[pts.length - 1];
    if (stroke[i][0] !== prev[0] || stroke[i][1] !== prev[1]) pts.push(stroke[i]);
  }
  if (pts.length < 2) return null;

  const ring       = poly.coordinates[0] as Array<[number, number]>;
  const uniqueRing = ring.slice(0, -1) as Array<[number, number]>;
  const n          = uniqueRing.length;
  if (n < 3) return null;

  interface Crossing {
    pt:      [number, number];
    ringIdx: number;
    strokeT: number; // si + fractional t within that segment (for sorting)
  }

  // Test every stroke segment against every ring segment
  const crossings: Crossing[] = [];
  for (let si = 0; si < pts.length - 1; si++) {
    const sp1 = pts[si], sp2 = pts[si + 1];
    for (let ri = 0; ri < n; ri++) {
      const rp1 = uniqueRing[ri];
      const rp2 = uniqueRing[(ri + 1) % n];
      const hit = segSegIntersect(sp1, sp2, rp1, rp2);
      if (hit) crossings.push({ pt: hit.pt, ringIdx: ri, strokeT: si + hit.t });
    }
  }

  if (crossings.length < 2) return null;

  // Sort by position along the stroke; use first and last crossing
  crossings.sort((a, b) => a.strokeT - b.strokeT);
  const crossA = crossings[0];
  const crossB = crossings[crossings.length - 1];

  // Stroke slice between the two crossings
  const siA = Math.floor(crossA.strokeT);
  const siB = Math.floor(crossB.strokeT);
  const strokeSeg: Array<[number, number]> = [crossA.pt];
  for (let si = siA + 1; si <= siB; si++) strokeSeg.push(pts[si]);
  strokeSeg.push(crossB.pt);

  let iA       = crossA.ringIdx;
  let iB       = crossB.ringIdx;
  let ptA      = crossA.pt;
  let ptB      = crossB.pt;
  let strokeFwd: Array<[number, number]> = strokeSeg;

  // Normalise so iA ≤ iB
  if (iA > iB) {
    [iA, iB]   = [iB, iA];
    [ptA, ptB] = [ptB, ptA];
    strokeFwd  = [...strokeSeg].reverse() as Array<[number, number]>;
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
  const ring1 = [...strokeFwd, ...arc2.slice(1)];  // stroke A→B + arc2 B→A
  const ring2 = [...arc1,  ...strokeRev.slice(1)]; // arc1  A→B + stroke B→A
  const holes  = poly.coordinates.slice(1);

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

/** Parametric segment×segment intersection. Returns the intersection point and
 *  the t parameter (0–1 along p1→p2), or null if the segments don't intersect. */
function segSegIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): { pt: [number, number]; t: number } | null {
  const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
  const dx2 = p4[0] - p3[0], dy2 = p4[1] - p3[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-15) return null; // parallel / collinear
  const dx3 = p1[0] - p3[0], dy3 = p1[1] - p3[1];
  const t = (dx3 * dy2 - dy3 * dx2) / denom;
  const u = (dx3 * dy1 - dy3 * dx1) / denom;
  const EPS = 1e-9;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  const tc = Math.max(0, Math.min(1, t));
  return { pt: [p1[0] + tc * dx1, p1[1] + tc * dy1], t: tc };
}

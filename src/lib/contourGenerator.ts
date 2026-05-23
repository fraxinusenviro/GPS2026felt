/**
 * Marching-squares contour generator for Float32Array elevation grids.
 *
 * Operates directly on HRDEMResult data without any intermediate GeoJSON
 * point conversion — fast enough for 1024×1024 grids at interactive rates.
 */

import type { HRDEMResult } from './hrdemWCS';

// ---------------------------------------------------------------------------
// Marching-squares edge/case tables
// ---------------------------------------------------------------------------

// Corner bit mask: TL=8, TR=4, BR=2, BL=1
// For each of the 16 cases, list the pairs of edge indices where the contour
// line crosses.  Edge indices: 0=top, 1=right, 2=bottom, 3=left.
// Cases 5 and 10 are saddle-point ambiguities — resolved by averaging.
const EDGE_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  [],          // 0000 — all below
  [2, 3],      // 0001 — BL above
  [1, 2],      // 0010 — BR above
  [1, 3],      // 0011 — BR+BL above
  [0, 1],      // 0100 — TR above
  [0, 3, 1, 2],// 0101 — TR+BL above (saddle — two segments)
  [0, 2],      // 0110 — TR+BR above
  [0, 3],      // 0111 — TR+BR+BL above
  [0, 3],      // 1000 — TL above  (same shape mirrored)
  [0, 2],      // 1001 — TL+BL above
  [0, 1, 2, 3],// 1010 — TL+BR above (saddle — two segments)
  [0, 1],      // 1011 — TL+BR+BL above
  [1, 3],      // 1100 — TL+TR above
  [1, 2],      // 1101 — TL+TR+BL above
  [2, 3],      // 1110 — TL+TR+BR above
  [],          // 1111 — all above
];

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function gridToGeo(
  px: number, py: number,
  west: number, north: number,
  lonScale: number, latScale: number,
): [number, number] {
  return [west + px * lonScale, north - py * latScale];
}

// ---------------------------------------------------------------------------
// Per-level marching squares (returns raw segments)
// ---------------------------------------------------------------------------

type Segment = [[number, number], [number, number]];

function marchLevel(
  grid: Float32Array,
  width: number,
  height: number,
  nodata: number | null,
  threshold: number,
  west: number, north: number,
  lonScale: number, latScale: number,
): Segment[] {
  const segs: Segment[] = [];

  for (let row = 0; row < height - 1; row++) {
    for (let col = 0; col < width - 1; col++) {
      const tl = grid[ row      * width + col    ];
      const tr = grid[ row      * width + col + 1];
      const br = grid[(row + 1) * width + col + 1];
      const bl = grid[(row + 1) * width + col    ];

      // Skip cells that contain nodata/non-finite corners
      if (!isFinite(tl) || !isFinite(tr) || !isFinite(br) || !isFinite(bl)) continue;
      if (nodata !== null) {
        if (Math.abs(tl - nodata) < 0.001 || Math.abs(tr - nodata) < 0.001 ||
            Math.abs(br - nodata) < 0.001 || Math.abs(bl - nodata) < 0.001) continue;
      }

      const mask =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);

      const edges = EDGE_TABLE[mask];
      if (edges.length === 0) continue;

      // Interpolate crossing point on a given edge (0=top,1=right,2=bottom,3=left)
      const edgePt = (e: number): [number, number] => {
        switch (e) {
          case 0: { // top edge: col→col+1, row fixed
            const t = (threshold - tl) / (tr - tl);
            return gridToGeo(col + t, row, west, north, lonScale, latScale);
          }
          case 1: { // right edge: col+1 fixed, row→row+1
            const t = (threshold - tr) / (br - tr);
            return gridToGeo(col + 1, row + t, west, north, lonScale, latScale);
          }
          case 2: { // bottom edge: col→col+1, row+1 fixed
            const t = (threshold - bl) / (br - bl);
            return gridToGeo(col + t, row + 1, west, north, lonScale, latScale);
          }
          default: { // left edge: col fixed, row→row+1
            const t = (threshold - tl) / (bl - tl);
            return gridToGeo(col, row + t, west, north, lonScale, latScale);
          }
        }
      };

      // edges contains pairs: [e0,e1] or [e0,e1,e2,e3] for saddle cases
      segs.push([edgePt(edges[0]), edgePt(edges[1])]);
      if (edges.length === 4) {
        segs.push([edgePt(edges[2]), edgePt(edges[3])]);
      }
    }
  }

  return segs;
}

// ---------------------------------------------------------------------------
// Chain segments into polylines
// ---------------------------------------------------------------------------

function chainSegments(segs: Segment[], tol = 1e-10): [number, number][][] {
  if (segs.length === 0) return [];

  // Build adjacency: for each endpoint key, store which segment indices use it
  const ptKey = (p: [number, number]) => `${p[0].toFixed(10)},${p[1].toFixed(10)}`;

  type EndRef = { segIdx: number; end: 0 | 1 };
  const adj = new Map<string, EndRef[]>();

  const add = (key: string, ref: EndRef) => {
    const list = adj.get(key);
    if (list) list.push(ref);
    else adj.set(key, [ref]);
  };

  segs.forEach((seg, i) => {
    add(ptKey(seg[0]), { segIdx: i, end: 0 });
    add(ptKey(seg[1]), { segIdx: i, end: 1 });
  });

  const used = new Uint8Array(segs.length);
  const chains: [number, number][][] = [];

  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = 1;

    const chain: [number, number][] = [segs[start][0], segs[start][1]];

    // Extend forward from chain tail
    let growing = true;
    while (growing) {
      growing = false;
      const tail = chain[chain.length - 1];
      const neighbors = adj.get(ptKey(tail)) ?? [];
      for (const nb of neighbors) {
        if (used[nb.segIdx]) continue;
        used[nb.segIdx] = 1;
        growing = true;
        // Append the other end of this segment
        chain.push(nb.end === 0 ? segs[nb.segIdx][1] : segs[nb.segIdx][0]);
        break;
      }
    }

    // Extend backward from chain head
    growing = true;
    while (growing) {
      growing = false;
      const head = chain[0];
      const neighbors = adj.get(ptKey(head)) ?? [];
      for (const nb of neighbors) {
        if (used[nb.segIdx]) continue;
        used[nb.segIdx] = 1;
        growing = true;
        chain.unshift(nb.end === 0 ? segs[nb.segIdx][1] : segs[nb.segIdx][0]);
        break;
      }
    }

    if (chain.length >= 2) chains.push(chain);
  }

  void tol; // tolerance unused (string keys provide exact match)
  return chains;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_LEVELS = 100;

/**
 * Generate contour isolines from an HRDEM elevation grid.
 *
 * @param result  Decoded elevation data from fetchHRDEM()
 * @param interval  Vertical interval in metres between contour lines
 * @returns GeoJSON FeatureCollection of MultiLineString features, one per level
 */
export function generateContours(
  result: HRDEMResult,
  interval: number,
): GeoJSON.FeatureCollection<GeoJSON.MultiLineString> {
  const { grid, width, height, bbox, nodata, elevMin, elevMax } = result;
  const [west, south, east, north] = bbox;

  const lonScale = (east  - west)  / width;
  const latScale = (north - south) / height;

  const iv = Math.max(1, interval);
  const firstLevel = Math.ceil(elevMin  / iv) * iv;
  const lastLevel  = Math.floor(elevMax / iv) * iv;

  const features: GeoJSON.Feature<GeoJSON.MultiLineString>[] = [];
  let levelCount = 0;

  for (let level = firstLevel; level <= lastLevel; level += iv) {
    if (++levelCount > MAX_LEVELS) break;

    const segs = marchLevel(grid, width, height, nodata, level, west, north, lonScale, latScale);
    if (segs.length === 0) continue;

    const chains = chainSegments(segs);
    if (chains.length === 0) continue;

    features.push({
      type: 'Feature',
      properties: { level },
      geometry: {
        type: 'MultiLineString',
        coordinates: chains,
      },
    });
  }

  console.log(`[HRDEM] Contours: ${features.length} levels at ${iv}m interval`);

  return { type: 'FeatureCollection', features };
}

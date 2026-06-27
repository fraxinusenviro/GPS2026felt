// Vector graphics templates for annotation pins and arrows.
//
// Everything is a normalised unit polygon (roughly within [-1.5, 1.5], y-up) that
// gets scaled to a ground size at placement, so the resulting geometry is real
// ground geometry and therefore scales naturally with zoom (bigger as you zoom in,
// smaller as you zoom out) — matching the "store the zoom it was made at" intent
// without any per-frame work.

type Pt = [number, number];

export interface PinTemplate {
  /** Unit polygon points (y-up). */
  points: Pt[];
  /** 'tip' = the point sits at the polygon tip (classic pin); 'center' = centred. */
  anchor: 'tip' | 'center';
}

/** Build a regular polygon / star ring in unit space. */
function star(spikes: number, outer: number, inner: number, rot = -Math.PI / 2): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (Math.PI * i) / spikes;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
function ngon(n: number, r: number, rot = Math.PI / 2): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}
function circle(r: number, n = 32): Pt[] { return ngon(n, r, 0); }

/** Classic teardrop map pin: round head, tip at the origin (anchor point). */
function teardrop(): Pt[] {
  const head: Pt[] = [];
  const cy = 1.5, r = 0.95;
  // Head circle, leaving a gap at the bottom where the tip tapers in.
  for (let i = 0; i <= 28; i++) {
    const a = -Math.PI / 2 + 0.55 + (i / 28) * (2 * Math.PI - 1.1);
    head.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  // Taper down to the tip at (0,0).
  return [[0, 0], ...head];
}

function heart(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = Math.PI - (i / 40) * 2 * Math.PI;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x / 16, y / 16 + 0.2]);
  }
  return pts;
}

export const PIN_SHAPES: Record<string, PinTemplate> = {
  pin:      { points: teardrop(), anchor: 'tip' },
  circle:   { points: circle(1), anchor: 'center' },
  square:   { points: ngon(4, 1.05, Math.PI / 4), anchor: 'center' },
  diamond:  { points: ngon(4, 1.1, Math.PI / 2), anchor: 'center' },
  triangle: { points: ngon(3, 1.1, Math.PI / 2), anchor: 'center' },
  star:     { points: star(5, 1.1, 0.46), anchor: 'center' },
  burst:    { points: star(12, 1.1, 0.74), anchor: 'center' },
  heart:    { points: heart(), anchor: 'center' },
};

/** Arrow templates oriented along +x (tail at -1, head tip at +1), centred on y. */
export const ARROW_STYLES: Record<string, Pt[]> = {
  simple: [[-1, -0.12], [0.35, -0.12], [0.35, -0.4], [1, 0], [0.35, 0.4], [0.35, 0.12], [-1, 0.12]],
  block:  [[-1, -0.3], [0.3, -0.3], [0.3, -0.6], [1, 0], [0.3, 0.6], [0.3, 0.3], [-1, 0.3]],
  chevron:[[0.1, -0.5], [0.45, -0.5], [1, 0], [0.45, 0.5], [0.1, 0.5], [0.55, 0], ],
  double: [[-1, 0], [-0.45, -0.5], [-0.45, -0.2], [0.45, -0.2], [0.45, -0.5], [1, 0],
           [0.45, 0.5], [0.45, 0.2], [-0.45, 0.2], [-0.45, 0.5]],
};

export const PIN_KEYS = Object.keys(PIN_SHAPES);
export const ARROW_KEYS = Object.keys(ARROW_STYLES);

/** Offset a [lng,lat] by an east/north metre delta (small-offset approximation). */
function offsetMeters(lng: number, lat: number, east: number, north: number): Pt {
  const dLat = north / 111320;
  const dLng = east / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lng + dLng, lat + dLat];
}

/**
 * Place unit `points` at (lng,lat), scaled to `groundMeters` per unit and rotated
 * `rotationDeg` clockwise from north. Returns a closed ring of [lng,lat].
 */
export function placeTemplate(
  lng: number, lat: number, points: Pt[], groundMeters: number, rotationDeg = 0,
): Pt[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const ring = points.map(([x, y]) => {
    // rotate (east=x, north=y) clockwise by rad, then scale to ground metres
    const east = (x * cos + y * sin) * groundMeters;
    const north = (-x * sin + y * cos) * groundMeters;
    return offsetMeters(lng, lat, east, north);
  });
  ring.push(ring[0]);
  return ring;
}

/** Build an arrow polygon ring from a tail→head ground vector. */
export function buildArrowRing(tail: Pt, head: Pt, styleKey: string): Pt[] {
  const tpl = ARROW_STYLES[styleKey] ?? ARROW_STYLES.simple;
  const dEast = (head[0] - tail[0]) * 111320 * Math.max(0.01, Math.cos((tail[1] * Math.PI) / 180));
  const dNorth = (head[1] - tail[1]) * 111320;
  const len = Math.max(1, Math.hypot(dEast, dNorth));
  // Template spans x∈[-1,1] (length 2); midpoint sits halfway along the vector.
  const midLng = (tail[0] + head[0]) / 2, midLat = (tail[1] + head[1]) / 2;
  const bearing = (Math.atan2(dEast, dNorth) * 180) / Math.PI; // clockwise from north
  return placeTemplate(midLng, midLat, tpl, len / 2, bearing);
}

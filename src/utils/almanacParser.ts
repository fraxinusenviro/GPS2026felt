/**
 * Yuma GPS almanac parser.
 *
 * Yuma is a text format produced by most professional GPS receivers (Trimble,
 * Leica, etc.) and published daily by NAVCEN. Each satellite occupies one
 * key-value block preceded by a `****` header line.
 */

export interface AlmanacSatellite {
  prn:          number;   // PRN 1–32
  health:       number;   // 0 = healthy
  eccentricity: number;
  toe:          number;   // time of applicability — GPS seconds within week
  inclination:  number;   // orbital inclination (radians)
  omegaDot:     number;   // rate of right ascension (rad/s)
  sqrtA:        number;   // sqrt of semi-major axis (m^0.5)
  omega0:       number;   // right ascension at reference epoch (rad)
  w:            number;   // argument of perigee (rad)
  m0:           number;   // mean anomaly at reference epoch (rad)
  af0:          number;   // clock bias (s)
  af1:          number;   // clock drift (s/s)
  week:         number;   // GPS week number (full, rollover-corrected)
}

const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);

/** Correct a possibly-truncated 10-bit GPS week number to the full week count. */
function correctWeek(raw: number): number {
  const currentGpsWeek = Math.floor((Date.now() - GPS_EPOCH_MS) / (604800 * 1000));
  let w = raw;
  // Advance by 1024-week epochs until within ±512 weeks of today.
  while (w + 512 < currentGpsWeek) w += 1024;
  return w;
}

export function parseYumaAlmanac(text: string): AlmanacSatellite[] {
  const results: AlmanacSatellite[] = [];
  const lines = text.split(/\r?\n/);

  let block: Record<string, string> = {};
  let inBlock = false;

  const flush = () => {
    if (!inBlock || Object.keys(block).length === 0) return;
    const get = (key: string) => parseFloat(block[key] ?? 'NaN');
    const prn  = Math.round(get('id'));
    const week = Math.round(get('week'));
    if (isNaN(prn) || isNaN(week)) return;

    results.push({
      prn,
      health:       Math.round(get('health')),
      eccentricity: get('eccentricity'),
      toe:          get('time of applicability'),
      inclination:  get('orbital inclination'),
      omegaDot:     get('rate of right ascen'),
      sqrtA:        get('sqrt(a)'),
      omega0:       get('right ascen at week'),
      w:            get('argument of perigee'),
      m0:           get('mean anom'),
      af0:          get('af0'),
      af1:          get('af1'),
      week:         correctWeek(week),
    });
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('****') || line.startsWith('----')) {
      flush();
      block = {};
      inBlock = true;
      continue;
    }

    // Key-value line: everything before the last colon is the key.
    const colonIdx = line.lastIndexOf(':');
    if (colonIdx < 1) continue;

    const key   = line.slice(0, colonIdx).trim().toLowerCase().replace(/\s+/g, ' ');
    const value = line.slice(colonIdx + 1).trim();
    block[key] = value;
  }

  flush(); // last block (no trailing separator needed)
  return results;
}

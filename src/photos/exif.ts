// ============================================================
// Minimal, dependency-free EXIF reader for JPEG images.
//
// Extracts the fields the photo workflow needs: GPS position
// (lat / lon / altitude), the camera's facing direction
// (GPSImgDirection), and the original capture timestamp.
// Everything is parsed from the APP1 (Exif) segment by hand so
// the app stays offline-first with no extra runtime dependency.
// ============================================================

export interface ExifData {
  /** Decimal degrees, signed (N/E positive). */
  lat: number | null;
  lon: number | null;
  /** Metres above sea level (GPSAltitude, sign from GPSAltitudeRef). */
  altitude: number | null;
  /** Camera facing direction in degrees 0–360 (GPSImgDirection). */
  bearing: number | null;
  /** Capture instant as an ISO 8601 string (from DateTimeOriginal). */
  dateTime: string | null;
}

const EMPTY: ExifData = { lat: null, lon: null, altitude: null, bearing: null, dateTime: null };

// TIFF field type → byte size of one component.
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// GPS IFD tags.
const GPS = {
  LAT_REF: 0x0001, LAT: 0x0002,
  LON_REF: 0x0003, LON: 0x0004,
  ALT_REF: 0x0005, ALT: 0x0006,
  IMG_DIR_REF: 0x0010, IMG_DIR: 0x0011,
};

/** Read an unsigned int of `bytes` width honouring byte order. */
function readUint(view: DataView, offset: number, bytes: number, little: boolean): number {
  if (bytes === 1) return view.getUint8(offset);
  if (bytes === 2) return view.getUint16(offset, little);
  return view.getUint32(offset, little);
}

/** Decode a value at the IFD entry's value/offset slot into an array of numbers. */
function readValues(
  view: DataView, tiffStart: number, entryOffset: number, type: number, count: number, little: boolean,
): number[] {
  const size = TYPE_SIZE[type] ?? 1;
  const total = size * count;
  // Values ≤4 bytes live inline; larger ones are referenced by offset.
  const valueOffset = total <= 4 ? entryOffset + 8 : tiffStart + readUint(view, entryOffset + 8, 4, little);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = valueOffset + i * size;
    if (at + size > view.byteLength) break;
    switch (type) {
      case 1: case 7: out.push(view.getUint8(at)); break;            // BYTE / UNDEFINED
      case 3: out.push(view.getUint16(at, little)); break;           // SHORT
      case 4: out.push(view.getUint32(at, little)); break;           // LONG
      case 9: out.push(view.getInt32(at, little)); break;            // SLONG
      case 5: {                                                      // RATIONAL
        const num = view.getUint32(at, little);
        const den = view.getUint32(at + 4, little);
        out.push(den ? num / den : 0);
        break;
      }
      case 10: {                                                     // SRATIONAL
        const num = view.getInt32(at, little);
        const den = view.getInt32(at + 4, little);
        out.push(den ? num / den : 0);
        break;
      }
      default: out.push(view.getUint8(at));
    }
  }
  return out;
}

/** Read an ASCII string value (e.g. GPSLatitudeRef, DateTimeOriginal). */
function readAscii(
  view: DataView, tiffStart: number, entryOffset: number, count: number, little: boolean,
): string {
  const valueOffset = count <= 4 ? entryOffset + 8 : tiffStart + readUint(view, entryOffset + 8, 4, little);
  let s = '';
  for (let i = 0; i < count; i++) {
    const at = valueOffset + i;
    if (at >= view.byteLength) break;
    const c = view.getUint8(at);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Convert [deg, min, sec] + hemisphere ref into signed decimal degrees. */
function dmsToDecimal(dms: number[], ref: string): number | null {
  if (dms.length < 1) return null;
  const [d = 0, m = 0, s = 0] = dms;
  let dec = d + m / 60 + s / 3600;
  if (ref === 'S' || ref === 'W') dec = -dec;
  return dec;
}

/** Parse "YYYY:MM:DD HH:MM:SS" (EXIF) into an ISO 8601 string. */
function exifDateToIso(s: string): string | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Walk one IFD, invoking `onEntry(tag, type, count, entryOffset)` per entry. */
function eachEntry(
  view: DataView, tiffStart: number, ifdOffset: number, little: boolean,
  onEntry: (tag: number, type: number, count: number, entryOffset: number) => void,
): void {
  if (ifdOffset + 2 > view.byteLength) return;
  const count = view.getUint16(ifdOffset, little);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdOffset + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const cnt = view.getUint32(entryOffset + 4, little);
    onEntry(tag, type, cnt, entryOffset);
  }
}

/** Locate the Exif APP1 TIFF block inside a JPEG and return its start offset. */
function findTiffStart(view: DataView): number | null {
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null; // not a JPEG
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const segLen = view.getUint16(offset + 2, false);
    if (marker === 0xe1) {
      // APP1: expect "Exif\0\0" then the TIFF header.
      const sig = offset + 4;
      if (sig + 6 <= view.byteLength
        && view.getUint8(sig) === 0x45 && view.getUint8(sig + 1) === 0x78
        && view.getUint8(sig + 2) === 0x69 && view.getUint8(sig + 3) === 0x66) {
        return sig + 6;
      }
    }
    if (marker === 0xda) break; // start of scan — no more metadata
    offset += 2 + segLen;
  }
  return null;
}

/**
 * Parse the EXIF metadata from an image file. Returns all-null fields when the
 * file is not a JPEG or carries no EXIF (e.g. PNG, screenshots, stripped images).
 */
export async function readExif(file: Blob): Promise<ExifData> {
  try {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const tiffStart = findTiffStart(view);
    if (tiffStart == null) return { ...EMPTY };

    // TIFF header: byte order + 0x002A magic + IFD0 offset.
    const byteOrder = view.getUint16(tiffStart, false);
    const little = byteOrder === 0x4949; // 'II' = little-endian, 'MM' = big-endian
    const ifd0 = tiffStart + readUint(view, tiffStart + 4, 4, little);

    let gpsIfd: number | null = null;
    let exifIfd: number | null = null;
    eachEntry(view, tiffStart, ifd0, little, (tag, _type, _cnt, entryOffset) => {
      if (tag === 0x8825) gpsIfd = tiffStart + readUint(view, entryOffset + 8, 4, little); // GPS IFD pointer
      else if (tag === 0x8769) exifIfd = tiffStart + readUint(view, entryOffset + 8, 4, little); // Exif sub-IFD
    });

    const result: ExifData = { ...EMPTY };

    if (gpsIfd != null) {
      let latRef = 'N', lonRef = 'E', altRef = 0, dirRef = 'T';
      let latDms: number[] = [], lonDms: number[] = [];
      eachEntry(view, tiffStart, gpsIfd, little, (tag, type, cnt, entryOffset) => {
        switch (tag) {
          case GPS.LAT_REF: latRef = readAscii(view, tiffStart, entryOffset, cnt, little) || 'N'; break;
          case GPS.LON_REF: lonRef = readAscii(view, tiffStart, entryOffset, cnt, little) || 'E'; break;
          case GPS.LAT: latDms = readValues(view, tiffStart, entryOffset, type, cnt, little); break;
          case GPS.LON: lonDms = readValues(view, tiffStart, entryOffset, type, cnt, little); break;
          case GPS.ALT_REF: altRef = readValues(view, tiffStart, entryOffset, type, cnt, little)[0] ?? 0; break;
          case GPS.ALT: result.altitude = readValues(view, tiffStart, entryOffset, type, cnt, little)[0] ?? null; break;
          case GPS.IMG_DIR_REF: dirRef = readAscii(view, tiffStart, entryOffset, cnt, little) || 'T'; break;
          case GPS.IMG_DIR: result.bearing = readValues(view, tiffStart, entryOffset, type, cnt, little)[0] ?? null; break;
        }
      });
      void dirRef; // 'T' true north / 'M' magnetic — recorded direction used as-is
      result.lat = dmsToDecimal(latDms, latRef);
      result.lon = dmsToDecimal(lonDms, lonRef);
      if (result.altitude != null && altRef === 1) result.altitude = -result.altitude; // below sea level
      if (result.bearing != null) result.bearing = ((result.bearing % 360) + 360) % 360;
    }

    if (exifIfd != null) {
      eachEntry(view, tiffStart, exifIfd, little, (tag, _type, cnt, entryOffset) => {
        if (tag === 0x9003 && !result.dateTime) { // DateTimeOriginal
          result.dateTime = exifDateToIso(readAscii(view, tiffStart, entryOffset, cnt, little));
        }
      });
    }
    // Fallback to IFD0 DateTime (0x0132) if DateTimeOriginal was absent.
    if (!result.dateTime) {
      eachEntry(view, tiffStart, ifd0, little, (tag, _type, cnt, entryOffset) => {
        if (tag === 0x0132 && !result.dateTime) {
          result.dateTime = exifDateToIso(readAscii(view, tiffStart, entryOffset, cnt, little));
        }
      });
    }

    return result;
  } catch {
    return { ...EMPTY };
  }
}

/** True when the parsed EXIF carries a usable GPS position. */
export function hasExifLocation(e: ExifData): boolean {
  return e.lat != null && e.lon != null && isFinite(e.lat) && isFinite(e.lon);
}

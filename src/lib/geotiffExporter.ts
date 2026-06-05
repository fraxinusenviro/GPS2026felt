/**
 * Minimal Float32 GeoTIFF writer.
 *
 * Produces a single-band, uncompressed, EPSG:4326 GeoTIFF that is
 * recognised by GDAL, QGIS, and ArcGIS.
 *
 * Binary layout (little-endian):
 *   [0-7]       TIFF header
 *   [8+]        IFD (15 entries, sorted by tag)
 *   [values]    DOUBLE and SHORT arrays stored after IFD
 *   [data]      Float32 raster, row-major, 4-byte aligned
 */

import type { CutFillResult } from './cutFillEngine';
import type { HRDEMResult } from './hrdemWCS';

// TIFF field types
const T_SHORT  = 3;
const T_LONG   = 4;
const T_DOUBLE = 12;
const T_ASCII  = 2;

export function exportGeoTIFF(result: CutFillResult, filename: string): void {
  const { modifiedGrid, width, height, bbox, nodata } = result;
  const [west, south, east, north] = bbox;

  const lonPerPx = (east  - west)  / width;
  const latPerPx = (north - south) / height;

  const nodataVal = nodata ?? -9999;
  const nodataStr = String(nodataVal) + '\0';
  const nodataBytes = new TextEncoder().encode(nodataStr);

  // --- compute layout offsets ---
  const numEntries  = 15;
  const ifdStart    = 8;
  const ifdBytes    = 2 + numEntries * 12 + 4; // count + entries + next-IFD
  const valStart    = ifdStart + ifdBytes;       // = 194

  const mpsOff  = valStart;                     // ModelPixelScale  3×DOUBLE = 24 bytes
  const mtpOff  = mpsOff  + 24;                 // ModelTiepoint    6×DOUBLE = 48 bytes
  const gkdOff  = mtpOff  + 48;                 // GeoKeyDirectory  16×SHORT = 32 bytes
  const ndOff   = gkdOff  + 32;                 // GDAL_NODATA      ASCII

  // Float32 data must start at a 4-byte boundary
  const dataStart = Math.ceil((ndOff + nodataBytes.length) / 4) * 4;
  const dataBytes = width * height * 4;
  const totalSize = dataStart + dataBytes;

  const buf  = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  // --- TIFF header ---
  view.setUint16(0, 0x4949, true); // 'II' little-endian
  view.setUint16(2, 42,     true); // TIFF magic
  view.setUint32(4, ifdStart, true);

  // --- IFD ---
  let pos = ifdStart;
  view.setUint16(pos, numEntries, true);
  pos += 2;

  const entry = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(pos,     tag,   true);
    view.setUint16(pos + 2, type,  true);
    view.setUint32(pos + 4, count, true);
    view.setUint32(pos + 8, val,   true);
    pos += 12;
  };

  // Tags must be sorted ascending
  entry(256,   T_LONG,   1,  width);       // ImageWidth
  entry(257,   T_LONG,   1,  height);      // ImageLength
  entry(258,   T_SHORT,  1,  32);          // BitsPerSample = 32
  entry(259,   T_SHORT,  1,  1);           // Compression = none
  entry(262,   T_SHORT,  1,  1);           // PhotometricInterpretation
  entry(273,   T_LONG,   1,  dataStart);   // StripOffsets
  entry(277,   T_SHORT,  1,  1);           // SamplesPerPixel
  entry(278,   T_LONG,   1,  height);      // RowsPerStrip (single strip)
  entry(279,   T_LONG,   1,  dataBytes);   // StripByteCounts
  entry(284,   T_SHORT,  1,  1);           // PlanarConfiguration
  entry(339,   T_SHORT,  1,  3);           // SampleFormat = IEEE float
  entry(33550, T_DOUBLE, 3,  mpsOff);      // ModelPixelScaleTag
  entry(33922, T_DOUBLE, 6,  mtpOff);      // ModelTiepointTag
  entry(34735, T_SHORT,  16, gkdOff);      // GeoKeyDirectoryTag
  entry(42113, T_ASCII,  nodataBytes.length, ndOff); // GDAL_NODATA

  // Next IFD = 0 (no more images)
  view.setUint32(pos, 0, true);

  // --- ModelPixelScale: [lonPerPx, latPerPx, 0] ---
  view.setFloat64(mpsOff,      lonPerPx, true);
  view.setFloat64(mpsOff +  8, latPerPx, true);
  view.setFloat64(mpsOff + 16, 0,        true);

  // --- ModelTiepoint: [0, 0, 0, west, north, 0] ---
  // Ties pixel (0,0) → geographic (west, north)
  view.setFloat64(mtpOff,      0,     true);
  view.setFloat64(mtpOff +  8, 0,     true);
  view.setFloat64(mtpOff + 16, 0,     true);
  view.setFloat64(mtpOff + 24, west,  true);
  view.setFloat64(mtpOff + 32, north, true);
  view.setFloat64(mtpOff + 40, 0,     true);

  // --- GeoKeyDirectory (16 SHORT values) ---
  // Header + 3 keys: GTModelType=Geographic, GTRasterType=PixelIsArea, GeographicType=4326
  const gkd = [
    1, 1, 0, 3,        // KeyDirectoryVersion, KeyRevision, MinorRevision, NumberOfKeys
    1024, 0, 1, 2,     // GTModelTypeGeoKey = 2 (ModelTypeGeographic)
    1025, 0, 1, 1,     // GTRasterTypeGeoKey = 1 (RasterPixelIsArea)
    2048, 0, 1, 4326,  // GeographicTypeGeoKey = 4326 (GCS_WGS_84)
  ];
  for (let i = 0; i < gkd.length; i++) {
    view.setUint16(gkdOff + i * 2, gkd[i], true);
  }

  // --- GDAL_NODATA string ---
  const nd8 = new Uint8Array(buf, ndOff, nodataBytes.length);
  nd8.set(nodataBytes);

  // --- Float32 raster data (row-major) ---
  const f32 = new Float32Array(buf, dataStart, width * height);
  // Replace any unvisited nodata pixels with the nodata sentinel
  for (let i = 0; i < modifiedGrid.length; i++) {
    f32[i] = isFinite(modifiedGrid[i]) ? modifiedGrid[i] : nodataVal;
  }

  // --- trigger download ---
  const blob = new Blob([buf], { type: 'image/tiff' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Export an HRDEMResult grid as a Float32 GeoTIFF, optionally merged with a cut/fill modified grid. */
export function exportHRDEMGeoTIFF(result: HRDEMResult, filename: string, mergeGrid?: Float32Array): void {
  const { grid, width, height, bbox, nodata } = result;
  const [west, south, east, north] = bbox;
  const lonPerPx = (east  - west)  / width;
  const latPerPx = (north - south) / height;
  const nodataVal = nodata ?? -9999;
  const nodataStr = String(nodataVal) + '\0';
  const nodataBytes = new TextEncoder().encode(nodataStr);

  const numEntries  = 15;
  const ifdStart    = 8;
  const ifdBytes    = 2 + numEntries * 12 + 4;
  const valStart    = ifdStart + ifdBytes;
  const mpsOff  = valStart;
  const mtpOff  = mpsOff  + 24;
  const gkdOff  = mtpOff  + 48;
  const ndOff   = gkdOff  + 32;
  const dataStart = Math.ceil((ndOff + nodataBytes.length) / 4) * 4;
  const dataBytes = width * height * 4;
  const totalSize = dataStart + dataBytes;

  const buf  = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42,     true);
  view.setUint32(4, ifdStart, true);

  let pos = ifdStart;
  view.setUint16(pos, numEntries, true);
  pos += 2;

  const entry = (tag: number, type: number, count: number, val: number) => {
    view.setUint16(pos,     tag,   true);
    view.setUint16(pos + 2, type,  true);
    view.setUint32(pos + 4, count, true);
    view.setUint32(pos + 8, val,   true);
    pos += 12;
  };

  entry(256,   T_LONG,   1,  width);
  entry(257,   T_LONG,   1,  height);
  entry(258,   T_SHORT,  1,  32);
  entry(259,   T_SHORT,  1,  1);
  entry(262,   T_SHORT,  1,  1);
  entry(273,   T_LONG,   1,  dataStart);
  entry(277,   T_SHORT,  1,  1);
  entry(278,   T_LONG,   1,  height);
  entry(279,   T_LONG,   1,  dataBytes);
  entry(284,   T_SHORT,  1,  1);
  entry(339,   T_SHORT,  1,  3);
  entry(33550, T_DOUBLE, 3,  mpsOff);
  entry(33922, T_DOUBLE, 6,  mtpOff);
  entry(34735, T_SHORT,  16, gkdOff);
  entry(42113, T_ASCII,  nodataBytes.length, ndOff);
  view.setUint32(pos, 0, true);

  view.setFloat64(mpsOff,      lonPerPx, true);
  view.setFloat64(mpsOff +  8, latPerPx, true);
  view.setFloat64(mpsOff + 16, 0,        true);
  view.setFloat64(mtpOff,      0,     true);
  view.setFloat64(mtpOff +  8, 0,     true);
  view.setFloat64(mtpOff + 16, 0,     true);
  view.setFloat64(mtpOff + 24, west,  true);
  view.setFloat64(mtpOff + 32, north, true);
  view.setFloat64(mtpOff + 40, 0,     true);

  const gkd = [
    1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326,
  ];
  for (let i = 0; i < gkd.length; i++) view.setUint16(gkdOff + i * 2, gkd[i], true);

  new Uint8Array(buf, ndOff, nodataBytes.length).set(nodataBytes);

  const sourceGrid = mergeGrid ?? grid;
  const f32 = new Float32Array(buf, dataStart, width * height);
  for (let i = 0; i < sourceGrid.length; i++) {
    f32[i] = isFinite(sourceGrid[i]) ? sourceGrid[i] : nodataVal;
  }

  const blob = new Blob([buf], { type: 'image/tiff' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

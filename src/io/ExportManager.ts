import type { FieldFeature, GeoJSONFeatureCollection, GeoJSONFeature } from '../types';
import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';

export class ExportManager {
  private storage = StorageManager.getInstance();

  // ============================================================
  // GeoJSON Export
  // ============================================================

  /** Build GeoJSON string from stored features (or a provided subset). */
  async buildGeoJSON(features?: FieldFeature[]): Promise<string> {
    const data = features ?? await this.storage.getAllFeatures();
    return JSON.stringify(this.featuresToGeoJSON(data), null, 2);
  }

  /** Trigger a browser download for a GeoJSON string that was already built. */
  downloadGeoJSONString(json: string): void {
    this.download(json, `fieldmap_${this.timestamp()}.geojson`, 'application/json');
  }

  async exportGeoJSON(features?: FieldFeature[]): Promise<void> {
    const json = await this.buildGeoJSON(features);
    this.downloadGeoJSONString(json);
  }

  private featuresToGeoJSON(features: FieldFeature[]): GeoJSONFeatureCollection {
    return {
      type: 'FeatureCollection',
      features: features.map(f => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: {
          id: f.id,
          point_id: f.point_id,
          type: f.type,
          desc: f.desc,
          notes: f.notes,
          geometry_type: f.geometry_type,
          capture_method: f.capture_method,
          created_at: f.created_at,
          updated_at: f.updated_at,
          created_by: f.created_by,
          lat: f.lat,
          lon: f.lon,
          elevation: f.elevation,
          accuracy: f.accuracy,
          layer_id: f.layer_id
        }
      }))
    };
  }

  // ============================================================
  // KML Export
  // ============================================================
  async exportKML(features?: FieldFeature[]): Promise<void> {
    const data = features ?? await this.storage.getAllFeatures();
    const kml = this.featuresToKML(data);
    this.download(kml, `fieldmap_${this.timestamp()}.kml`, 'application/vnd.google-earth.kml+xml');
  }

  private featuresToKML(features: FieldFeature[]): string {
    const placemarks = features.map(f => {
      const coords = this.geometryToKMLCoords(f);
      const geomTag = this.geometryToKMLTag(f, coords);
      return `
    <Placemark>
      <name>${this.escape(f.point_id)}</name>
      <description><![CDATA[
        <b>Type:</b> ${this.escape(f.type)}<br/>
        <b>Description:</b> ${this.escape(f.desc)}<br/>
        <b>Notes:</b> ${this.escape(f.notes)}<br/>
        <b>Created:</b> ${f.created_at}<br/>
        <b>Accuracy:</b> ${f.accuracy !== null ? `±${f.accuracy.toFixed(1)}m` : 'N/A'}<br/>
        <b>Capture:</b> ${f.capture_method}
      ]]></description>
      <ExtendedData>
        <Data name="uuid"><value>${f.id}</value></Data>
        <Data name="point_id"><value>${f.point_id}</value></Data>
        <Data name="type"><value>${f.type}</value></Data>
        <Data name="created_by"><value>${f.created_by}</value></Data>
      </ExtendedData>
      ${geomTag}
    </Placemark>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Fraxinus Field Mapper Export</name>
    <description>Exported ${new Date().toISOString()}</description>
    ${placemarks}
  </Document>
</kml>`;
  }

  private geometryToKMLCoords(f: FieldFeature): string {
    const g = f.geometry;
    if (g.type === 'Point') {
      const [lon, lat, z] = g.coordinates as number[];
      return `${lon},${lat},${z ?? 0}`;
    } else if (g.type === 'LineString') {
      return (g.coordinates as Array<number[]>).map(c => `${c[0]},${c[1]},${c[2] ?? 0}`).join(' ');
    } else {
      return (g.coordinates[0] as Array<number[]>).map(c => `${c[0]},${c[1]},${c[2] ?? 0}`).join(' ');
    }
  }

  private geometryToKMLTag(f: FieldFeature, coords: string): string {
    if (f.geometry.type === 'Point') {
      return `<Point><coordinates>${coords}</coordinates></Point>`;
    } else if (f.geometry.type === 'LineString') {
      return `<LineString><coordinates>${coords}</coordinates></LineString>`;
    } else {
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }
  }

  // ============================================================
  // CSV Export
  // ============================================================
  async exportCSV(features?: FieldFeature[]): Promise<void> {
    const data = features ?? await this.storage.getAllFeatures();
    const csv = this.featuresToCSV(data);
    this.download(csv, `fieldmap_${this.timestamp()}.csv`, 'text/csv');
  }

  private featuresToCSV(features: FieldFeature[]): string {
    const headers = [
      'uuid', 'point_id', 'type', 'desc', 'notes', 'geometry_type',
      'capture_method', 'lat', 'lon', 'elevation', 'accuracy',
      'created_at', 'updated_at', 'created_by', 'layer_id'
    ];
    const rows = features.map(f => [
      f.id, f.point_id, f.type, f.desc, f.notes, f.geometry_type,
      f.capture_method, f.lat ?? '', f.lon ?? '', f.elevation ?? '', f.accuracy ?? '',
      f.created_at, f.updated_at, f.created_by, f.layer_id
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...rows].join('\r\n');
  }

  // ============================================================
  // Shapefile Export (binary SHP/DBF/SHX)
  // ============================================================
  async exportShapefile(features?: FieldFeature[]): Promise<void> {
    const data = features ?? await this.storage.getAllFeatures();
    EventBus.emit('toast', { message: 'Generating Shapefile...', type: 'info' });

    try {
      // Group by geometry type (SHP files are single geometry type)
      const points = data.filter(f => f.geometry_type === 'Point');
      const lines = data.filter(f => f.geometry_type === 'LineString');
      const polygons = data.filter(f => f.geometry_type === 'Polygon');

      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      if (points.length > 0) {
        const shp = this.buildPointSHP(points);
        const dbf = this.buildDBF(points);
        zip.file('points.shp', shp);
        zip.file('points.dbf', dbf);
        zip.file('points.prj', WGS84_PRJ);
      }
      if (lines.length > 0) {
        const shp = this.buildLineSHP(lines);
        const dbf = this.buildDBF(lines);
        zip.file('lines.shp', shp);
        zip.file('lines.dbf', dbf);
        zip.file('lines.prj', WGS84_PRJ);
      }
      if (polygons.length > 0) {
        const shp = this.buildPolygonSHP(polygons);
        const dbf = this.buildDBF(polygons);
        zip.file('polygons.shp', shp);
        zip.file('polygons.dbf', dbf);
        zip.file('polygons.prj', WGS84_PRJ);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fieldmap_${this.timestamp()}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      EventBus.emit('toast', { message: 'Shapefile exported successfully', type: 'success' });
    } catch (err) {
      EventBus.emit('toast', { message: `Shapefile export failed: ${(err as Error).message}`, type: 'error' });
    }
  }

  // ---- SHP binary builders ----
  private buildPointSHP(features: FieldFeature[]): ArrayBuffer {
    const recordSize = 28; // 8 header + 20 content for point shape
    const totalContentBytes = features.length * (8 + recordSize);
    const fileLength = (100 + totalContentBytes) / 2; // in 16-bit words

    const buf = new ArrayBuffer(100 + totalContentBytes);
    const view = new DataView(buf);

    // File header
    view.setInt32(0, 9994, false);    // file code
    view.setInt32(24, fileLength, false);
    view.setInt32(28, 1000, true);    // version
    view.setInt32(32, 1, true);       // shape type: Point

    // Compute bounding box
    const lons = features.map(f => (f.geometry as {coordinates: number[]}).coordinates[0]);
    const lats = features.map(f => (f.geometry as {coordinates: number[]}).coordinates[1]);
    view.setFloat64(36, Math.min(...lons), true);  // Xmin
    view.setFloat64(44, Math.min(...lats), true);  // Ymin
    view.setFloat64(52, Math.max(...lons), true);  // Xmax
    view.setFloat64(60, Math.max(...lats), true);  // Ymax

    let offset = 100;
    features.forEach((f, i) => {
      const coords = (f.geometry as {coordinates: number[]}).coordinates;
      // Record header
      view.setInt32(offset, i + 1, false);         // record number (1-based)
      view.setInt32(offset + 4, recordSize / 2, false); // content length in words
      // Shape record
      view.setInt32(offset + 8, 1, true);          // shape type: Point
      view.setFloat64(offset + 12, coords[0], true); // X
      view.setFloat64(offset + 20, coords[1], true); // Y
      offset += 8 + recordSize;
    });

    return buf;
  }

  private buildLineSHP(features: FieldFeature[]): ArrayBuffer {
    // Calculate total size
    let totalBytes = 0;
    const recordBodies: ArrayBuffer[] = [];

    features.forEach(f => {
      const coords = (f.geometry as {coordinates: number[][]}).coordinates;
      const numPts = coords.length;
      // Shape type 3 (Polyline): 4 + 32 + 4 + 4 + numPts*16
      const bodySize = 4 + 32 + 4 + 4 + numPts * 16;
      totalBytes += 8 + bodySize;

      const body = new ArrayBuffer(bodySize);
      const bv = new DataView(body);
      bv.setInt32(0, 3, true); // shape type Polyline
      const lons = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      bv.setFloat64(4, Math.min(...lons), true);
      bv.setFloat64(12, Math.min(...lats), true);
      bv.setFloat64(20, Math.max(...lons), true);
      bv.setFloat64(28, Math.max(...lats), true);
      bv.setInt32(36, 1, true);  // num parts
      bv.setInt32(40, numPts, true); // num points
      bv.setInt32(44, 0, true);  // part 0 starts at index 0
      let ptOffset = 48;
      coords.forEach(c => {
        bv.setFloat64(ptOffset, c[0], true);
        bv.setFloat64(ptOffset + 8, c[1], true);
        ptOffset += 16;
      });
      recordBodies.push(body);
    });

    const buf = new ArrayBuffer(100 + totalBytes);
    const view = new DataView(buf);
    view.setInt32(0, 9994, false);
    view.setInt32(24, (100 + totalBytes) / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 3, true); // Polyline

    let offset = 100;
    recordBodies.forEach((body, i) => {
      view.setInt32(offset, i + 1, false);
      view.setInt32(offset + 4, body.byteLength / 2, false);
      new Uint8Array(buf).set(new Uint8Array(body), offset + 8);
      offset += 8 + body.byteLength;
    });

    return buf;
  }

  private buildPolygonSHP(features: FieldFeature[]): ArrayBuffer {
    let totalBytes = 0;
    const recordBodies: ArrayBuffer[] = [];

    features.forEach(f => {
      const rings = (f.geometry as {coordinates: number[][][]}).coordinates;
      let numPts = 0;
      rings.forEach(r => numPts += r.length);
      const numParts = rings.length;
      const bodySize = 4 + 32 + 4 + 4 + numParts * 4 + numPts * 16;
      totalBytes += 8 + bodySize;

      const body = new ArrayBuffer(bodySize);
      const bv = new DataView(body);
      bv.setInt32(0, 5, true); // Polygon
      const allCoords = rings.flat();
      const lons = allCoords.map(c => c[0]);
      const lats = allCoords.map(c => c[1]);
      bv.setFloat64(4, Math.min(...lons), true);
      bv.setFloat64(12, Math.min(...lats), true);
      bv.setFloat64(20, Math.max(...lons), true);
      bv.setFloat64(28, Math.max(...lats), true);
      bv.setInt32(36, numParts, true);
      bv.setInt32(40, numPts, true);

      let partStart = 0;
      let partOffset = 44;
      rings.forEach(ring => {
        bv.setInt32(partOffset, partStart, true);
        partStart += ring.length;
        partOffset += 4;
      });
      let ptOffset = 44 + numParts * 4;
      rings.forEach(ring => {
        ring.forEach(c => {
          bv.setFloat64(ptOffset, c[0], true);
          bv.setFloat64(ptOffset + 8, c[1], true);
          ptOffset += 16;
        });
      });
      recordBodies.push(body);
    });

    const buf = new ArrayBuffer(100 + totalBytes);
    const view = new DataView(buf);
    view.setInt32(0, 9994, false);
    view.setInt32(24, (100 + totalBytes) / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 5, true); // Polygon

    let offset = 100;
    recordBodies.forEach((body, i) => {
      view.setInt32(offset, i + 1, false);
      view.setInt32(offset + 4, body.byteLength / 2, false);
      new Uint8Array(buf).set(new Uint8Array(body), offset + 8);
      offset += 8 + body.byteLength;
    });

    return buf;
  }

  private buildDBF(features: FieldFeature[]): ArrayBuffer {
    // DBF header + field descriptors + records
    const fields = [
      { name: 'UUID', type: 'C', length: 36 },
      { name: 'POINT_ID', type: 'C', length: 40 },
      { name: 'TYPE', type: 'C', length: 50 },
      { name: 'DESC', type: 'C', length: 100 },
      { name: 'NOTES', type: 'C', length: 100 },
      { name: 'CREATED_AT', type: 'C', length: 24 },
      { name: 'CREATED_BY', type: 'C', length: 20 },
      { name: 'ACCURACY', type: 'N', length: 10 },
      { name: 'ELEVATION', type: 'N', length: 10 },
    ];

    const headerSize = 32 + fields.length * 32 + 1;
    const recordSize = 1 + fields.reduce((s, f) => s + f.length, 0);
    const totalSize = headerSize + features.length * recordSize + 1;

    const buf = new ArrayBuffer(totalSize);
    const view = new Uint8Array(buf);

    // DBF version 3
    view[0] = 3;
    const now = new Date();
    view[1] = now.getFullYear() - 1900;
    view[2] = now.getMonth() + 1;
    view[3] = now.getDate();
    // Number of records
    const dv = new DataView(buf);
    dv.setInt32(4, features.length, true);
    dv.setInt16(8, headerSize, true);
    dv.setInt16(10, recordSize, true);

    // Field descriptors
    let fieldOffset = 32;
    fields.forEach(f => {
      const nameBytes = new TextEncoder().encode(f.name.padEnd(11, '\0').substring(0, 11));
      view.set(nameBytes, fieldOffset);
      view[fieldOffset + 11] = f.type.charCodeAt(0);
      view[fieldOffset + 16] = f.length;
      fieldOffset += 32;
    });
    view[fieldOffset] = 0x0D; // Header terminator

    // Records
    let recOffset = headerSize;
    features.forEach(f => {
      view[recOffset] = 0x20; // Active record
      recOffset++;

      const values: string[] = [
        f.id, f.point_id, f.type, f.desc, f.notes, f.created_at, f.created_by,
        f.accuracy !== null ? f.accuracy.toFixed(2) : '',
        f.elevation !== null ? f.elevation.toFixed(2) : ''
      ];

      fields.forEach((field, i) => {
        const val = (values[i] ?? '').substring(0, field.length).padEnd(field.length, ' ');
        const bytes = new TextEncoder().encode(val);
        view.set(bytes.slice(0, field.length), recOffset);
        recOffset += field.length;
      });
    });

    view[totalSize - 1] = 0x1A; // EOF marker
    return buf;
  }

  // ============================================================
  // Backup/Restore full dataset
  // ============================================================
  async exportBackup(): Promise<void> {
    const json = await this.storage.exportAllData();
    this.download(json, `fieldmap_backup_${this.timestamp()}.json`, 'application/json');
  }

  // ============================================================
  // Utility
  // ============================================================
  private download(content: string | ArrayBuffer, filename: string, mimeType: string): void {
    const blob = content instanceof ArrayBuffer
      ? new Blob([content], { type: mimeType })
      : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private timestamp(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}

const WGS84_PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

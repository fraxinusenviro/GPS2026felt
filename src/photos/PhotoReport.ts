import { jsPDF } from 'jspdf';
import type { FieldFeature } from '../types';
import { BASEMAPS } from '../constants';
import { registerPdfFont, type FontKey } from './pdfFonts';
import logoUrl from '../assets/logo.png';

type RGB = [number, number, number];

/** Body font name for the current render (a registered custom font or 'helvetica'). */
let BODY = 'helvetica';

export interface PhotoLogOptions {
  /** Masthead main heading. Default: "FIELD PHOTO LOG" */
  title?: string;
  /** Masthead sub-heading. Default: "Georeferenced Field Photos" */
  subtitle?: string;
  project?: string;
  site?: string;
  preparedBy?: string;
  company?: string;
  /** UI font from settings; embedded into the PDF (default → helvetica). */
  fontKey?: FontKey;
  /** Basemap tile-URL template ({z}/{x}/{y}) for locator maps. */
  basemapUrl?: string;
  /** Locator-map zoom (Web Mercator). */
  zoom?: number;
  /** When true, prepend a full-page overview map (page 1) showing all photo locations. */
  includeOverviewMap?: boolean;
}

/**
 * Pixel position of a feature on the live MapLibre canvas.
 * Null when the feature has no location or is outside the current viewport.
 */
export type FeatureProjection = { pixelX: number; pixelY: number } | null;

// ── Palette (ADM-001) ────────────────────────────────────────────────────────
const C: Record<string, RGB> = {
  brand:   [15, 110, 86],   // #0F6E56
  title:   [20, 59, 46],    // #143b2e
  accent:  [216, 90, 48],   // #D85A30
  rowShade:[245, 246, 242], // #f5f6f2
  hairline:[230, 232, 227], // #e6e8e3
  muted:   [90, 102, 96],   // #5a6660
  muted2:  [106, 122, 114], // #6a7a72
  ink:     [42, 50, 46],    // #2a322e
  notes:   [85, 85, 85],    // #555
  white:   [255, 255, 255],
  scale:   [58, 58, 58],
};

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// ── Formatting ────────────────────────────────────────────────────────────────
function bearingLabel(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d) % 360}° ${COMPASS_8[Math.round(d / 45) % 8]}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function formatCoord(v: number | null, axis: 'lat' | 'lon'): string {
  if (v == null) return '—';
  const dir = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  return `${Math.abs(v).toFixed(6)}° ${dir}`;
}

// ── Image helpers ───────────────────────────────────────────────────────────
/** Decode a data URL, honour EXIF orientation, and cover-crop to w×h px. */
async function coverCrop(dataUrl: string, w: number, h: number): Promise<string | null> {
  if (!dataUrl) return null;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.max(w / bmp.width, h / bmp.height);
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return null;
  }
}

/** Light grid placeholder so a locator panel always renders (offline / blocked). */
function placeholderMap(w: number, h: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#eef1ec';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e6e8e3';
  ctx.lineWidth = 1;
  const step = 32;
  for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  return canvas.toDataURL('image/png');
}

/** Load the masthead logo as a PNG data URL with its natural dimensions. */
async function loadLogo(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  try {
    const blob = await (await fetch(logoUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), w: bmp.width, h: bmp.height };
  } catch {
    return null;
  }
}

/** Fetch + stitch basemap tiles into a w×h image centred on lat/lon. */
async function fetchLocatorMap(
  lat: number, lon: number, z: number, w: number, h: number, urlTemplate: string,
): Promise<string | null> {
  const TILE = 256;
  const n = Math.pow(2, z);
  // Centre in global Web-Mercator pixels.
  const cx = ((lon + 180) / 360) * n * TILE;
  const latRad = (lat * Math.PI) / 180;
  const cy = (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) * n * TILE;
  const left = cx - w / 2;
  const top = cy - h / 2;
  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE);
  const tx1 = Math.floor((left + w) / TILE), ty1 = Math.floor((top + h) / TILE);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const jobs: Promise<void>[] = [];
  let gotAny = false;
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const url = urlTemplate
        .replace('{z}', String(z)).replace('{x}', String(tx))
        .replace('{y}', String(ty)).replace('{s}', 'a');
      jobs.push((async () => {
        try {
          const resp = await fetch(url, { mode: 'cors' });
          if (!resp.ok) return;
          const bmp = await createImageBitmap(await resp.blob());
          ctx.drawImage(bmp, tx * TILE - left, ty * TILE - top);
          gotAny = true;
        } catch { /* tile unavailable — leave gap */ }
      })());
    }
  }
  await Promise.all(jobs);
  return gotAny ? canvas.toDataURL('image/jpeg', 0.85) : null;
}

// ── Vector chrome ───────────────────────────────────────────────────────────
function setFill(doc: jsPDF, c: RGB) { doc.setFillColor(...c); }
function setText(doc: jsPDF, c: RGB) { doc.setTextColor(...c); }
function setDraw(doc: jsPDF, c: RGB) { doc.setDrawColor(...c); }

function drawCameraGlyph(doc: jsPDF, x: number, y: number, s: number): void {
  setFill(doc, C.brand);
  doc.roundedRect(x, y, s, s, 3, 3, 'F');
  // White camera: body + viewfinder bump + lens.
  setFill(doc, C.white);
  const bx = x + s * 0.18, by = y + s * 0.34, bw = s * 0.64, bh = s * 0.42;
  doc.roundedRect(bx, by, bw, bh, 1.5, 1.5, 'F');
  doc.rect(x + s * 0.36, y + s * 0.26, s * 0.18, s * 0.12, 'F');
  setFill(doc, C.brand);
  doc.circle(x + s / 2, by + bh / 2, s * 0.12, 'F');
  setFill(doc, C.white);
  doc.circle(x + s / 2, by + bh / 2, s * 0.06, 'F');
}

function drawMasthead(doc: jsPDF, x: number, y: number, w: number,
                      o: { title: string; subtitle: string; project: string; site: string },
                      logo: { dataUrl: string; w: number; h: number } | null): void {
  const glyph = 32;
  let titleX = x + glyph + 10;
  if (logo) {
    const lw = glyph * (logo.w / logo.h);
    doc.addImage(logo.dataUrl, 'PNG', x, y, lw, glyph);
    titleX = x + lw + 10;
  } else {
    drawCameraGlyph(doc, x, y, glyph);
  }

  doc.setFont(BODY, 'bold');
  doc.setFontSize(16);
  setText(doc, C.title);
  doc.text(o.title, titleX, y + 14);
  doc.setFont(BODY, 'normal');
  doc.setFontSize(8.5);
  setText(doc, C.muted2);
  doc.text(o.subtitle, titleX, y + 25);

  // Project / Site key-value block, positioned left of the right margin.
  const rows: [string, string][] = [['PROJECT', o.project], ['SITE', o.site]];
  const labelX = x + w - 260;
  const valueX = labelX + 52;
  let ry = y + 9;
  doc.setFontSize(8.5);
  for (const [k, v] of rows) {
    doc.setFont(BODY, 'bold');
    setText(doc, C.brand);
    doc.text(k, labelX, ry);
    doc.setFont(BODY, 'normal');
    setText(doc, C.ink);
    doc.text(v || '—', valueX, ry, { maxWidth: (x + w) - valueX });
    ry += 13;
  }

  // Full-width 2.5pt green rule.
  setDraw(doc, C.brand);
  doc.setLineWidth(2.5);
  doc.line(x, y + glyph + 8, x + w, y + glyph + 8);
}

function drawFooter(doc: jsPDF, x: number, w: number, yRule: number,
                    o: { company: string; pageNum: number; pageCount: number; preparedBy: string }): void {
  setDraw(doc, C.brand);
  doc.setLineWidth(1.5);
  doc.line(x, yRule, x + w, yRule);
  const ty = yRule + 11;
  doc.setFontSize(8.5);
  doc.setFont(BODY, 'bold');
  setText(doc, C.title);
  doc.text(o.company, x, ty);
  doc.setFont(BODY, 'normal');
  setText(doc, C.muted);
  doc.text(`Page ${o.pageNum} of ${o.pageCount}`, x + w / 2, ty, { align: 'center' });
  doc.text(`Prepared by: ${o.preparedBy}`, x + w, ty, { align: 'right' });
}

interface EntryData {
  seq: string;
  photoUri: string | null;
  mapUri: string;
  bearing: number | null;
  lat: number | null;
  datetime: string;
  observer: string;
  latStr: string;
  lonStr: string;
  elevStr: string;
  bearingStr: string;
  notes: string;
  scale: { lenPt: number; halfPt: number; fullLabel: string; halfLabel: string };
}

function drawMapOverlays(doc: jsPDF, mx: number, my: number, mw: number, mh: number,
                         e: EntryData): void {
  const cx = mx + mw / 2, cy = my + mh / 2;

  // View-direction wedge (translucent cone), bearing 0 = up.
  if (e.bearing != null) {
    const L = mh * 0.4;
    const half = (20 * Math.PI) / 180;
    const b = (e.bearing * Math.PI) / 180;
    const p1x = cx + Math.sin(b - half) * L, p1y = cy - Math.cos(b - half) * L;
    const p2x = cx + Math.sin(b + half) * L, p2y = cy - Math.cos(b + half) * L;
    const gs = (doc as any).GState({ opacity: 0.32 });
    (doc as any).setGState(gs);
    setFill(doc, C.accent);
    doc.triangle(cx, cy, p1x, p1y, p2x, p2y, 'F');
    (doc as any).setGState((doc as any).GState({ opacity: 1 }));
  }

  // Location marker: orange circle with a white outline, centred on the point.
  setDraw(doc, C.white);
  doc.setLineWidth(1.2);
  setFill(doc, C.accent);
  doc.circle(cx, cy, 3.4, 'FD');

  // Scale bar bottom-left.
  const sx = mx + 8, sy = my + mh - 8;
  setDraw(doc, C.scale);
  doc.setLineWidth(1);
  doc.line(sx, sy, sx + e.scale.lenPt, sy);
  doc.line(sx, sy - 2.5, sx, sy + 2.5);
  doc.line(sx + e.scale.halfPt, sy - 1.8, sx + e.scale.halfPt, sy + 1.8);
  doc.line(sx + e.scale.lenPt, sy - 2.5, sx + e.scale.lenPt, sy + 2.5);
  doc.setFont(BODY, 'normal');
  doc.setFontSize(5.5);
  setText(doc, C.scale);
  doc.text('0', sx, sy - 4, { align: 'center' });
  doc.text(e.scale.halfLabel, sx + e.scale.halfPt, sy - 4, { align: 'center' });
  doc.text(`${e.scale.fullLabel} m`, sx + e.scale.lenPt, sy - 4, { align: 'center' });

  // North badge bottom-right.
  const nx = mx + mw - 12, ny = my + mh - 12;
  setFill(doc, C.white);
  setDraw(doc, C.scale);
  doc.setLineWidth(0.7);
  doc.circle(nx, ny, 7, 'FD');
  setFill(doc, C.scale);
  doc.triangle(nx, ny - 5, nx - 2.5, ny + 4, nx, ny + 1.5, 'F');
  doc.triangle(nx, ny - 5, nx + 2.5, ny + 4, nx, ny + 1.5, 'F');
  doc.setFontSize(5);
  doc.setFont(BODY, 'bold');
  doc.text('N', nx, ny - 7.5, { align: 'center' });
}

function drawEntry(doc: jsPDF, x: number, y: number, w: number, h: number, e: EntryData): void {
  const panelW = 178;
  const gap = 12;
  const photoW = w - panelW - gap;
  const panelX = x + photoW + gap;

  // ── Photo ──
  if (e.photoUri) {
    doc.addImage(e.photoUri, 'JPEG', x, y, photoW, h);
  } else {
    setFill(doc, C.rowShade);
    doc.rect(x, y, photoW, h, 'F');
    doc.setFontSize(9);
    setText(doc, C.muted);
    doc.text('No photo', x + photoW / 2, y + h / 2, { align: 'center' });
  }
  // Sequence badge.
  doc.setFont(BODY, 'bold');
  doc.setFontSize(11);
  const bw = 8 + doc.getTextWidth(e.seq);
  setFill(doc, C.title);
  doc.roundedRect(x + 8, y + 8, bw, 15, 3, 3, 'F');
  setText(doc, C.white);
  doc.text(e.seq, x + 8 + bw / 2, y + 18, { align: 'center' });

  // ── Panel ──
  const mapH = panelW * 128 / 220;
  const rowH = 13.5;
  const rows: [string, string, RGB][] = [
    ['Photo ID', e.seq, C.ink],
    ['Date / Time', e.datetime, C.ink],
    ['Observer', e.observer, C.ink],
    ['Latitude', e.latStr, C.ink],
    ['Longitude', e.lonStr, C.ink],
    ['Elevation', e.elevStr, C.ink],
    ['Bearing', e.bearingStr, C.accent],
  ];
  const tableTop = y + mapH;
  const tableH = rows.length * rowH;

  // Notes height.
  doc.setFontSize(8);
  const notesLines = e.notes ? doc.splitTextToSize(e.notes, panelW - 12) as string[] : [];
  const notesH = e.notes ? 16 + notesLines.length * 9 : 0;
  const panelH = mapH + tableH + notesH;

  // Map raster + overlays.
  doc.addImage(e.mapUri, 'JPEG', panelX, y, panelW, mapH);
  drawMapOverlays(doc, panelX, y, panelW, mapH, e);
  setDraw(doc, C.hairline);
  doc.setLineWidth(0.5);
  doc.line(panelX, tableTop, panelX + panelW, tableTop);

  // Metadata table with alternating row shading.
  rows.forEach((r, i) => {
    const ry = tableTop + i * rowH;
    setFill(doc, i % 2 === 0 ? C.rowShade : C.white);
    doc.rect(panelX, ry, panelW, rowH, 'F');
    doc.setFont(BODY, 'bold');
    doc.setFontSize(7.5);
    setText(doc, C.muted);
    doc.text(r[0], panelX + 6, ry + 9);
    if (r[0] === 'Bearing') {
      const labelW = doc.getTextWidth(r[0]); // measured at the label's 7.5pt bold
      doc.setFont(BODY, 'normal');
      doc.setFontSize(5.5);
      setText(doc, C.muted2);
      doc.text('(from N)', panelX + 6 + labelW + 3, ry + 9);
    }
    const mono = r[0] === 'Latitude' || r[0] === 'Longitude';
    doc.setFont(mono ? 'courier' : BODY, r[2] === C.accent ? 'bold' : 'normal');
    doc.setFontSize(mono ? 7 : 7.5);
    setText(doc, r[2]);
    doc.text(r[1], panelX + 62, ry + 9, { maxWidth: panelW - 66 });
  });

  // Notes.
  if (e.notes) {
    const ny = tableTop + tableH;
    setDraw(doc, C.hairline);
    doc.setLineWidth(0.5);
    doc.line(panelX, ny, panelX + panelW, ny);
    doc.setFont(BODY, 'bold');
    doc.setFontSize(7);
    setText(doc, C.muted);
    doc.text('Notes', panelX + 6, ny + 10);
    doc.setFont(BODY, 'normal');
    doc.setFontSize(8);
    setText(doc, C.notes);
    doc.text(notesLines, panelX + 6, ny + 19);
  }

  // Panel border (rounded).
  setDraw(doc, C.hairline);
  doc.setLineWidth(0.75);
  doc.roundedRect(panelX, y, panelW, panelH, 4, 4, 'S');
}

// ── Main ─────────────────────────────────────────────────────────────────────
const MAP_PX_W = 440, MAP_PX_H = 256;
const PHOTO_PX_W = 720, PHOTO_PX_H = 600;

function scaleGeometry(lat: number, zoom: number, panelW: number): EntryData['scale'] {
  const mpp = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom);
  const ptPerPx = panelW / MAP_PX_W;
  let full = 100, half = 50;
  const maxPt = panelW * 0.42;
  while ((full / mpp) * ptPerPx > maxPt && full > 10) { full /= 2; half = full / 2; }
  return {
    lenPt: (full / mpp) * ptPerPx,
    halfPt: (half / mpp) * ptPerPx,
    fullLabel: String(full),
    halfLabel: String(half),
  };
}

/** Generate and download the photo log PDF in the ADM-001 two-up layout. */
export async function generatePhotoLogPdf(
  features: FieldFeature[],
  opts: PhotoLogOptions = {},
  mapCanvas?: HTMLCanvasElement,
  featureProjections?: FeatureProjection[],
): Promise<void> {
  const zoom = opts.zoom ?? 16;
  const basemapUrl = opts.basemapUrl
    ?? BASEMAPS.find(b => b.id === 'esri-imagery')?.url
    ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const panelW = 178;

  // Pre-build per-entry images (async) before the synchronous layout pass.
  const entries: EntryData[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const seq = String(i + 1).padStart(2, '0');
    const lat = f.lat, lon = f.lon;

    let mapUri: string | null = null;
    if (lat != null && lon != null) {
      mapUri = await fetchLocatorMap(lat, lon, zoom, MAP_PX_W, MAP_PX_H, basemapUrl);
    }
    if (!mapUri) mapUri = placeholderMap(MAP_PX_W, MAP_PX_H);

    const photoUri = await coverCrop(f.photos?.[0] ?? '', PHOTO_PX_W, PHOTO_PX_H);
    const bearing = f.photo_data ? f.photo_data.bearing : null;

    entries.push({
      seq,
      photoUri,
      mapUri,
      bearing,
      lat,
      datetime: formatDateTime(f.created_at),
      observer: f.photo_data?.observer ?? f.created_by ?? '—',
      latStr: formatCoord(lat, 'lat'),
      lonStr: formatCoord(lon, 'lon'),
      elevStr: f.elevation != null ? `${f.elevation.toFixed(1)} m` : '—',
      bearingStr: bearing != null ? bearingLabel(bearing) : '—',
      notes: f.notes?.trim() ?? '',
      scale: scaleGeometry(lat ?? 45, zoom, panelW),
    });
  }

  const logo = await loadLogo();

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  // Embed the selected UI font (default → built-in helvetica).
  BODY = await registerPdfFont(doc, opts.fontKey);
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const M = 36;
  const contentW = PAGE_W - M * 2;
  const entriesTop = M + 50;
  const footerRuleY = PAGE_H - M - 16;
  const entriesBottom = footerRuleY - 12;
  const entryH = (entriesBottom - entriesTop - 14) / 2;

  const hasOverview = !!(opts.includeOverviewMap && mapCanvas);
  const overviewOffset = hasOverview ? 1 : 0;
  const pageCount = overviewOffset + Math.max(1, Math.ceil(entries.length / 2));
  const company = opts.company ?? 'Fraxinus Environmental & Geomatics Ltd.';
  const preparedBy = opts.preparedBy ?? entries[0]?.observer ?? '—';
  const mastheadOpts = {
    title: opts.title ?? 'FIELD PHOTO LOG',
    subtitle: opts.subtitle ?? 'Georeferenced Field Photos',
    project: opts.project ?? 'Field Photo Log',
    site: opts.site ?? '',
  };

  // ── Overview map page (page 1) ─────────────────────────────────────────────
  if (hasOverview) {
    drawMasthead(doc, M, M, contentW, mastheadOpts, logo);

    const mapAreaTop = entriesTop;
    const mapAreaH = footerRuleY - mapAreaTop - 8;
    const canvasAspect = mapCanvas!.width / mapCanvas!.height;
    const mapW = contentW;
    const mapH = Math.min(mapAreaH, mapW / canvasAspect);
    const mapImageX = M;
    const mapImageY = mapAreaTop + (mapAreaH - mapH) / 2;

    doc.addImage(mapCanvas!.toDataURL('image/jpeg', 0.92), 'JPEG', mapImageX, mapImageY, mapW, mapH);

    // Numbered dots + bearing wedges for each feature.
    if (featureProjections) {
      const scaleX = mapW / mapCanvas!.width;
      const scaleY = mapH / mapCanvas!.height;
      for (let i = 0; i < entries.length; i++) {
        const proj = featureProjections[i];
        if (!proj) continue;
        const px = mapImageX + proj.pixelX * scaleX;
        const py = mapImageY + proj.pixelY * scaleY;
        const bearing = entries[i].bearing;

        // Bearing wedge (semi-transparent cone in the view direction).
        if (bearing != null) {
          const b = (bearing * Math.PI) / 180;
          const L = 14;
          const half = (22 * Math.PI) / 180;
          const p1x = px + Math.sin(b - half) * L;
          const p1y = py - Math.cos(b - half) * L;
          const p2x = px + Math.sin(b + half) * L;
          const p2y = py - Math.cos(b + half) * L;
          const gs = (doc as any).GState({ opacity: 0.55 });
          (doc as any).setGState(gs);
          setFill(doc, C.accent);
          doc.triangle(px, py, p1x, p1y, p2x, p2y, 'F');
          (doc as any).setGState((doc as any).GState({ opacity: 1 }));
        }

        // Orange dot with white outline.
        setFill(doc, C.accent);
        setDraw(doc, C.white);
        doc.setLineWidth(1);
        doc.circle(px, py, 5, 'FD');
        // Sequence label.
        doc.setFont(BODY, 'bold');
        doc.setFontSize(6.5);
        setText(doc, C.white);
        doc.text(entries[i].seq, px, py + 2.2, { align: 'center' });
      }
    }

    drawFooter(doc, M, contentW, footerRuleY, { company, preparedBy, pageNum: 1, pageCount });
    doc.addPage();
  }

  // ── Entry pages ────────────────────────────────────────────────────────────
  for (let i = 0; i < entries.length; i++) {
    const onPage = i % 2;
    if (i > 0 && onPage === 0) doc.addPage();
    if (onPage === 0) {
      drawMasthead(doc, M, M, contentW, mastheadOpts, logo);
    }
    const ey = entriesTop + onPage * (entryH + 14);
    if (onPage === 1) {
      setDraw(doc, C.hairline);
      doc.setLineWidth(0.5);
      doc.line(M, ey - 7, M + contentW, ey - 7);
    }
    drawEntry(doc, M, ey, contentW, entryH, entries[i]);

    const isLastOnPage = onPage === 1 || i === entries.length - 1;
    if (isLastOnPage) {
      drawFooter(doc, M, contentW, footerRuleY, {
        company, preparedBy,
        pageNum: overviewOffset + Math.floor(i / 2) + 1, pageCount,
      });
    }
  }

  const dateTag = new Date().toISOString().substring(0, 10);
  const slug = (opts.project ?? 'PhotoLog').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'PhotoLog';
  doc.save(`FieldPhotoLog_${slug}_${dateTag}_REV00.pdf`);
}

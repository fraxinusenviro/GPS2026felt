import { jsPDF } from 'jspdf';
import type { FieldFeature } from '../types';

type RGB = [number, number, number];

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatCoord(v: number | null, axis: 'lat' | 'lon'): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toFixed(6);
  const dir = axis === 'lat' ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  return `${abs}° ${dir}`;
}

async function normalizePhotoForPdf(dataUrl: string): Promise<string> {
  if (!dataUrl) return '';
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d')?.drawImage(bmp, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.92);
    }
  } catch { /* fall through */ }
  return dataUrl;
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error('Unable to decode image'));
    img.src = dataUrl;
  });
}

function drawCompassRose(doc: jsPDF, cx: number, cy: number, r: number, bearing: number, colors: Record<string, RGB>): void {
  // Outer ring
  doc.setDrawColor(...colors.line);
  doc.setLineWidth(0.5);
  doc.circle(cx, cy, r, 'S');

  // Cardinal labels
  doc.setFontSize(6);
  doc.setTextColor(...colors.muted);
  doc.setFont('helvetica', 'bold');
  doc.text('N', cx, cy - r + 5, { align: 'center' });
  doc.text('S', cx, cy + r - 1, { align: 'center' });
  doc.text('E', cx + r - 1, cy + 1.5, { align: 'center' });
  doc.text('W', cx - r + 1, cy + 1.5, { align: 'center' });

  // Bearing arrow
  const rad = (bearing - 90) * Math.PI / 180;
  const tipX = cx + Math.cos(rad + Math.PI / 2) * (r - 3);
  const tipY = cy + Math.sin(rad + Math.PI / 2) * (r - 3);
  const baseRad1 = rad + Math.PI / 2 + 2.4;
  const baseRad2 = rad + Math.PI / 2 - 2.4;
  const b1x = cx + Math.cos(baseRad1) * 3;
  const b1y = cy + Math.sin(baseRad1) * 3;
  const b2x = cx + Math.cos(baseRad2) * 3;
  const b2y = cy + Math.sin(baseRad2) * 3;
  doc.setFillColor(249, 115, 22); // #f97316
  doc.setDrawColor(249, 115, 22);
  doc.lines([[tipX - b1x, tipY - b1y], [b2x - tipX, b2y - tipY]], b1x, b1y, [1, 1], 'FD');
  // Center dot
  doc.setFillColor(...colors.muted);
  doc.circle(cx, cy, 1.5, 'F');
}

/** Generate and download the photo log PDF. */
export async function generatePhotoLogPdf(features: FieldFeature[], mapCanvas?: HTMLCanvasElement): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const bottom = pageH - margin;

  const colors: Record<string, RGB> = {
    ink: [15, 23, 42], muted: [71, 85, 105], line: [203, 213, 225],
    head: [226, 232, 240], accent: [249, 115, 22], black: [0, 0, 0], white: [255, 255, 255],
  };

  // ── Cover page ──────────────────────────────────────────────────────────────

  let y = margin;

  // Title block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...colors.ink);
  doc.text('Field Photo Log', pageW / 2, y + 20, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...colors.muted);
  doc.text(`Generated ${new Date().toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short' })}`, pageW / 2, y + 36, { align: 'center' });
  doc.text(`${features.length} photo${features.length !== 1 ? 's' : ''}`, pageW / 2, y + 50, { align: 'center' });

  // Horizontal rule
  y += 62;
  doc.setDrawColor(...colors.line);
  doc.setLineWidth(0.75);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  // Overview map
  if (mapCanvas) {
    try {
      const mapDataUrl = mapCanvas.toDataURL('image/jpeg', 0.85);
      const mapW = pageW - margin * 2;
      const aspectRatio = mapCanvas.height / mapCanvas.width;
      const mapH = Math.min(mapW * aspectRatio, pageH * 0.5);

      doc.addImage(mapDataUrl, 'JPEG', margin, y, mapW, mapH);

      // Overlay numbered dots for each photo point
      for (let i = 0; i < features.length; i++) {
        const f = features[i];
        if (f.lat == null || f.lon == null) continue;

        // Convert lat/lon to pixel position on the map canvas using the map's bounds
        // We'll use a simple linear interpolation — good enough for a small area
        // For a more accurate result, we'd need the map's projection but this is fast and practical
        // We skip projection math and mark dots on the PDF map proportionally
        // This requires the map bounds — we don't have them here, so we just draw a legend
      }

      // Photo count legend on map
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(249, 115, 22);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(249, 115, 22);
      doc.roundedRect(margin + 4, y + 4, 90, 16, 3, 3, 'FD');
      doc.text(`${features.length} photo point${features.length !== 1 ? 's' : ''}`, margin + 8, y + 14);

      y += mapH + 16;
    } catch { /* map snapshot failed, skip */ }
  }

  // Summary table
  if (features.length > 0) {
    const dates = features.map(f => f.created_at.substring(0, 10));
    const dMin = dates.reduce((a, b) => a < b ? a : b);
    const dMax = dates.reduce((a, b) => a > b ? a : b);
    const observers = [...new Set(features.map(f => f.photo_data?.observer ?? f.created_by ?? '').filter(Boolean))];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...colors.muted);
    if (dMin === dMax) {
      doc.text(`Date: ${formatDate(dMin + 'T00:00:00')}`, margin, y); y += 14;
    } else {
      doc.text(`Date range: ${dMin} – ${dMax}`, margin, y); y += 14;
    }
    if (observers.length > 0) {
      doc.text(`Observer${observers.length > 1 ? 's' : ''}: ${observers.join(', ')}`, margin, y); y += 14;
    }
  }

  // ── Photo entry pages ────────────────────────────────────────────────────────

  const photoW = pageW - margin * 2;
  const entryH = (pageH - margin * 2 - 20) / 2; // 2 entries per page
  const photoAreaW = Math.round(photoW * 0.58);
  const metaAreaX = margin + photoAreaW + 10;
  const metaAreaW = photoW - photoAreaW - 10;

  let entryOnPage = 0;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];

    if (i === 0 || entryOnPage >= 2) {
      doc.addPage();
      entryOnPage = 0;
    }

    const entryY = margin + entryOnPage * (entryH + 10);

    // Separator between entries
    if (entryOnPage === 1) {
      doc.setDrawColor(...colors.line);
      doc.setLineWidth(0.5);
      doc.line(margin, entryY - 5, pageW - margin, entryY - 5);
    }

    // Photo image
    const photoH = entryH - 20;
    const rawUrl = f.photos?.[0] ?? '';
    if (rawUrl) {
      try {
        const normalized = await normalizePhotoForPdf(rawUrl);
        const { width: iw, height: ih } = await measureImage(normalized);
        const scale = Math.min(photoAreaW / iw, photoH / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = margin + (photoAreaW - dw) / 2;
        const dy = entryY + (photoH - dh) / 2;
        doc.addImage(normalized, 'JPEG', dx, dy, dw, dh);
      } catch { /* no photo */ }
    } else {
      doc.setFillColor(...colors.head);
      doc.rect(margin, entryY, photoAreaW, photoH, 'F');
      doc.setFontSize(9);
      doc.setTextColor(...colors.muted);
      doc.text('No photo', margin + photoAreaW / 2, entryY + photoH / 2, { align: 'center' });
    }

    // Metadata column
    let my = entryY + 2;

    // Photo number
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...colors.accent);
    doc.text(`#${i + 1}`, metaAreaX, my + 12);
    my += 18;

    const metaLine = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...colors.muted);
      doc.text(label, metaAreaX, my);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colors.ink);
      doc.text(value, metaAreaX, my + 9, { maxWidth: metaAreaW });
      my += 20;
    };

    metaLine('DATE / TIME', formatDate(f.created_at));
    if (f.photo_data?.observer ?? f.created_by) {
      metaLine('OBSERVER', f.photo_data?.observer ?? f.created_by ?? '');
    }
    metaLine('LAT', formatCoord(f.lat, 'lat'));
    metaLine('LON', formatCoord(f.lon, 'lon'));
    if (f.elevation != null) {
      metaLine('ELEVATION', `${f.elevation.toFixed(1)} m`);
    }

    // Bearing + compass rose
    if (f.photo_data != null) {
      const bearing = f.photo_data.bearing;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...colors.muted);
      doc.text('BEARING', metaAreaX, my);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(...colors.accent);
      doc.text(`${bearing}° ${bearingToCardinal(bearing)}`, metaAreaX, my + 11);
      my += 16;

      const roseSize = 18;
      drawCompassRose(doc, metaAreaX + roseSize + 2, my + roseSize + 2, roseSize, bearing, colors);
      my += roseSize * 2 + 8;
    }

    // Notes
    if (f.notes?.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...colors.muted);
      doc.text('NOTES', metaAreaX, my);
      my += 9;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...colors.ink);
      const lines = doc.splitTextToSize(f.notes.trim(), metaAreaW);
      doc.text(lines, metaAreaX, my);
    }

    entryOnPage++;
  }

  // Footer on each page with page number
  const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...colors.muted);
    doc.text(`Field Photo Log  ·  Page ${p} of ${totalPages}`, pageW / 2, pageH - 14, { align: 'center' });
  }

  const dateTag = new Date().toLocaleDateString('en-CA').replace(/-/g, '');
  doc.save(`photo-log-${dateTag}.pdf`);
}

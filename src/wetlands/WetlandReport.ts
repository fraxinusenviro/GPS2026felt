/**
 * Per-plot wetland delineation PDF report. Ported from the WETLANDS app
 * (docs/app.js `exportRecordPdf`), using the bundled `jspdf` dependency instead
 * of the original CDN script injection. Layout is kept faithful to the original.
 */
import { jsPDF } from 'jspdf';
import type { WetlandSurvey } from '../types';
import {
  vegetationEntriesFromSurvey, autoDominantSet, vegetationMetricsFromSurvey,
  soilRows, extractCommonName, extractScientificName, displayLabel, dateStamp, str,
} from './wetlandSurvey';

type RGB = [number, number, number];

let pdfLogoDataUrlCache: string | null = null;

function getDataUrlImageFormat(dataUrl: string): string {
  const header = String(dataUrl || '').slice(0, 32).toLowerCase();
  if (header.startsWith('data:image/jpeg') || header.startsWith('data:image/jpg')) return 'JPEG';
  if (header.startsWith('data:image/webp')) return 'WEBP';
  return 'PNG';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read logo blob'));
    reader.readAsDataURL(blob);
  });
}

async function loadPdfLogoDataUrl(): Promise<string> {
  if (pdfLogoDataUrlCache != null) return pdfLogoDataUrlCache;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}wetlands/fraxinus-logo.jpg`);
    pdfLogoDataUrlCache = res.ok ? await blobToDataUrl(await res.blob()) : '';
  } catch {
    pdfLogoDataUrlCache = '';
  }
  return pdfLogoDataUrlCache;
}

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => reject(new Error('Unable to decode image'));
    img.src = dataUrl;
  });
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

function normalizePhotoObjects(s: WetlandSurvey): Array<{ name: string; dataUrl: string; missing: boolean }> {
  return (s.photos || []).map((p, idx) => ({
    name: p?.name || `Photo ${idx + 1}`,
    dataUrl: p?.dataUrl || '',
    missing: !p?.dataUrl,
  }));
}

/** Build the export base filename, matching the WETLANDS convention. */
export function reportBaseName(s: WetlandSurvey): string {
  return `${str(s.SiteID) || 'Survey'}_${str(s.PLOT_ID) || 'plot'}_${dateStamp()}`;
}

/** Generate and download the per-plot delineation PDF. */
export async function exportRecordPdf(s: WetlandSurvey, base = reportBaseName(s)): Promise<void> {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;
  const contentW = pageW - margin * 2;
  const bottom = pageH - margin;
  const logoDataUrl = await loadPdfLogoDataUrl();

  const colors: Record<string, RGB> = {
    ink: [15, 23, 42], muted: [71, 85, 105], line: [203, 213, 225],
    head: [226, 232, 240], accent: [11, 107, 80], black: [0, 0, 0], white: [255, 255, 255],
  };

  let y = margin;
  const newPage = () => { doc.addPage(); y = margin; };
  const ensureSpace = (need = 12) => { if (y + need > bottom) newPage(); };

  const drawHeader = () => {
    ensureSpace(60);
    const logoSize = 34;
    const textX = margin + logoSize + 10;
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, getDataUrlImageFormat(logoDataUrl), margin, y + 1, logoSize, logoSize); } catch { /* ignore */ }
    }
    doc.setDrawColor(...colors.line);
    doc.line(margin, y + 44, pageW - margin, y + 44);
    doc.setTextColor(...colors.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Wetland Delineation Report', textX, y + 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...colors.muted);
    doc.text('Nova Scotia Field Data Form', textX, y + 30);
    doc.text(`Generated ${new Date().toLocaleString()}`, pageW - margin, y + 16, { align: 'right' });
    y += 56;
  };

  const sectionTitle = (title: string) => {
    const barH = 14;
    ensureSpace(barH + 10);
    doc.setFillColor(...colors.black);
    doc.rect(margin, y, contentW, barH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...colors.white);
    doc.text(String(title || '').toUpperCase(), margin + 4, y + 9.5);
    y += barH + 8;
  };

  interface TableOpts {
    fontSize?: number; rowH?: number; headerH?: number; showHeader?: boolean;
    x?: number; tableW?: number; wrapCells?: boolean; shadeByStratum?: boolean;
    boldLeftColumn?: boolean; italicCols?: number[];
  }
  const drawTable = (title: string, headers: string[], rows: Array<Array<string | number>>, widths: number[], opts: TableOpts = {}) => {
    const fontSize = opts.fontSize ?? 8;
    const baseRowH = opts.rowH ?? 12;
    const headerH = opts.showHeader === false ? 0 : (opts.headerH ?? 14);
    sectionTitle(title);
    const x = opts.x ?? margin;
    const tableW = opts.tableW ?? contentW;
    const colW = widths || headers.map(() => tableW / headers.length);
    doc.setDrawColor(...colors.line);
    if (headerH > 0) {
      doc.setFillColor(...colors.head);
      doc.rect(x, y, tableW, headerH, 'FD');
      let cx = x;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(fontSize);
      doc.setTextColor(...colors.ink);
      headers.forEach((h, i) => { doc.text(String(h), cx + 4, y + 9); cx += colW[i]; });
    }
    let ry = y + headerH;
    rows.forEach((r) => {
      const wrapped = r.map((cell, i) => {
        const text = String(cell ?? '—');
        const splitByLine = text.split(/\n/g).flatMap(part => doc.splitTextToSize(part, colW[i] - 6));
        const lines = opts.wrapCells ? splitByLine : [splitByLine[0] || '—'];
        return lines.length ? lines : ['—'];
      });
      const rowH = Math.max(baseRowH, ...wrapped.map(lines => lines.length * (fontSize + 1) + 4));
      ensureSpace(rowH + 4);
      const stratum = String(r?.[0] || '').toLowerCase();
      if (opts.shadeByStratum) {
        if (stratum === 'tree') doc.setFillColor(232, 245, 233);
        else if (stratum === 'shrub') doc.setFillColor(243, 232, 245);
        else if (stratum === 'herb') doc.setFillColor(232, 240, 252);
        else doc.setFillColor(255, 255, 255);
        doc.rect(x, ry, tableW, rowH, 'FD');
      } else {
        doc.rect(x, ry, tableW, rowH);
      }
      let rx = x;
      wrapped.forEach((lines, i) => {
        const makeBold = opts.boldLeftColumn && i === 0;
        const makeItalic = Array.isArray(opts.italicCols) && opts.italicCols.includes(i);
        doc.setFont('helvetica', makeBold ? 'bold' : (makeItalic ? 'italic' : 'normal'));
        doc.setFontSize(fontSize);
        doc.setTextColor(...colors.ink);
        lines.forEach((ln, li) => { doc.text(String(ln || '—'), rx + 3, ry + 8.5 + li * (fontSize + 1)); });
        rx += colW[i];
      });
      let vx = x;
      for (let i = 0; i < headers.length - 1; i++) { vx += colW[i]; doc.line(vx, ry, vx, ry + rowH); }
      ry += rowH;
    });
    y = ry + 6;
  };

  const drawTopPairTables = (leftTitle: string, leftRows: string[][], rightTitle: string, rightRows: string[][]) => {
    const sectionH = 14;
    const gap = 10;
    const pairW = (contentW - gap) / 2;
    const rowH = 12;
    const innerTitleSpace = 12;
    const totalH = sectionH + 8 + innerTitleSpace + Math.max(leftRows.length * rowH, rightRows.length * rowH) + 10;
    ensureSpace(totalH);
    doc.setFillColor(...colors.black);
    doc.rect(margin, y, contentW, sectionH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...colors.white);
    doc.text('SURVEY OVERVIEW', margin + 4, y + 9.5);
    y += sectionH + 6;

    const wetlandLabel = str(s.PLOT_TYPE).toLowerCase().includes('upland') ? 'UPLAND' : 'WETLAND';
    const badges = [`Wetland ID: ${str(s.WetlandID) || '—'}`, wetlandLabel];
    let bx = margin;
    badges.forEach((txt, idx) => {
      const bw = Math.min(contentW * 0.55, Math.max(150, doc.getTextWidth(txt) + 22));
      if (idx === 1) {
        if (wetlandLabel === 'UPLAND') doc.setFillColor(98, 108, 124);
        else doc.setFillColor(11, 107, 80);
      } else {
        doc.setFillColor(33, 33, 33);
      }
      doc.roundedRect(bx, y, bw, 18, 4, 4, 'F');
      doc.setTextColor(...colors.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(txt, bx + 8, y + 12);
      bx += bw + 10;
    });
    y += 24;

    const leftX = margin;
    const rightX = margin + pairW + gap;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...colors.accent);
    doc.text(leftTitle.toUpperCase(), leftX, y + 8);
    doc.text(rightTitle.toUpperCase(), rightX, y + 8);
    y += innerTitleSpace;

    const drawSimple = (x: number, rows: string[][]) => {
      let ry = y;
      const colW = [pairW * 0.44, pairW * 0.56];
      rows.forEach((r) => {
        doc.setDrawColor(...colors.line);
        doc.rect(x, ry, pairW, rowH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...colors.ink);
        doc.text(String(r[0] ?? '—'), x + 3, ry + 8.5);
        doc.line(x + colW[0], ry, x + colW[0], ry + rowH);
        doc.setFont('helvetica', 'normal');
        const txt = doc.splitTextToSize(String(r[1] ?? '—'), colW[1] - 6)[0] || '—';
        doc.text(txt, x + colW[0] + 3, ry + 8.5);
        ry += rowH;
      });
      return ry;
    };
    const lyEnd = drawSimple(leftX, leftRows);
    const ryEnd = drawSimple(rightX, rightRows);
    y = Math.max(lyEnd, ryEnd) + 8;
  };

  drawHeader();

  const metadataRows: string[][] = [
    ['Site Name', str(s.SiteID) || '—'], ['Plot ID', str(s.PLOT_ID) || '—'], ['Wetland ID', str(s.WetlandID) || '—'],
    ['Surveyor', str(s.observer) || '—'], ['Locale', str(s.LocaleName) || '—'], ['Province', str(s.Province) || '—'],
    ['Date', str(s.date) || '—'], ['Time', str(s.time) || '—'], ['Latitude', str(s.latitude) || '—'], ['Longitude', str(s.longitude) || '—'],
    ['Local Relief', str(s.LocalRelief) || '—'], ['% Slope', str(s.PercentSlope) || '—'], ['Landform', str(s.Landform) || '—'], ['Plot Type', str(s.PLOT_TYPE) || '—'],
  ];
  const summaryRows: string[][] = [
    ['Hydrophytic Vegetation?', str(s.SummaryHydroVegYN) || '—'], ['Wetland Hydrology?', str(s.SummaryHydrologyYN) || '—'],
    ['Hydric Soil?', str(s.SummaryHydricSoilYN) || '—'], ['Point in Wetland?', str(s.SummaryInWetlandYN) || '—'],
  ];
  drawTopPairTables('Survey Metadata', metadataRows, 'Summary Conditions', summaryRows);

  const disturbanceRows = ['DistSoilYN', 'DistVegYN', 'DistHydroYN', 'ProbSoilYN', 'ProbVegYN', 'ProbHydroYN', 'ClimHydroNormalYN', 'CircNormalYN']
    .map(k => [displayLabel(k), str(s[k]) || '—']);
  drawTable('Disturbance & Problematic Conditions', ['Condition', 'Value'], disturbanceRows, [contentW * 0.66, contentW * 0.34], { showHeader: false, boldLeftColumn: true });

  const vegEntries = vegetationEntriesFromSurvey(s);
  const vegAuto = autoDominantSet(vegEntries);
  const vegRows = vegEntries.map(e => [
    e.group, extractCommonName(e.species || '—'), extractScientificName(e.species || '—'),
    e.status || '—', e.cover || '—', vegAuto.has(`${e.group}:${e.i}`) ? 'Y' : 'N',
  ]);
  drawTable('Vegetation', ['Layer', 'Common Name', 'Scientific Name', 'Status', '% Cover', 'Dom'],
    vegRows.length ? vegRows : [['—', '—', '—', '—', '—', '—']],
    [contentW * 0.10, contentW * 0.28, contentW * 0.30, contentW * 0.12, contentW * 0.14, contentW * 0.06],
    { italicCols: [2], shadeByStratum: true });

  const vMetrics = vegetationMetricsFromSurvey(s);
  drawTable('Vegetation Indices', ['Metric', 'Value'], [
    ['Dominance Test', `${vMetrics.dominanceA}/${vMetrics.dominanceB} (${vMetrics.dominancePct.toFixed(1)}%)`],
    ['Dominance Pass (>50%)', vMetrics.dominancePass ? 'Yes' : 'No'],
    ['Prevalence Index', vMetrics.prevalenceIndex.toFixed(2)],
    ['Prevalence Pass (<=3.0)', vMetrics.prevalencePass ? 'Yes' : 'No'],
  ], [contentW * 0.45, contentW * 0.55], { showHeader: false, boldLeftColumn: true });

  ensureSpace(44);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...colors.muted);
  const fp1 = 'Dominance Test uses the 50/20 rule by stratum (Tree/Shrub/Herb): rank by absolute cover, include species cumulatively exceeding 50% of stratum cover, plus any additional species at >=20% of stratum cover.';
  const fp2 = 'Prevalence Index is a weighted cover score using indicator-status classes (OBL, FACW, FAC, FACU, UPL).';
  const fp1Lines = doc.splitTextToSize(fp1, contentW);
  const fp2Lines = doc.splitTextToSize(fp2, contentW);
  doc.text(fp1Lines, margin, y + 7);
  y += fp1Lines.length * 7 + 3;
  doc.text(fp2Lines, margin, y + 7);
  y += fp2Lines.length * 7 + 5;

  // Page 2: soils / hydrology / notes
  newPage();
  drawHeader();

  const soilsRows = soilRows(s, true, true);
  const soilsPdfRows = soilsRows.map(r => {
    const start = r[1], end = r[2], restrictive = r[11], note = r[12];
    const range = restrictive === 'Yes'
      ? (start !== '—' ? `${start}+ (restrictive layer)` : 'restrictive layer')
      : ((start !== '—' && end !== '—') ? `${start}-${end} cm` : (start !== '—' ? `${start} cm` : '—'));
    const desc = restrictive === 'Yes' ? (note || 'Restrictive layer') : r[4];
    return [r[0], range, r[3], desc, r[5], r[6], r[7], r[8], r[9], r[10]];
  });

  sectionTitle('Hydric Soils');
  const soilsW = [contentW * 0.07, contentW * 0.16, contentW * 0.09, contentW * 0.15, contentW * 0.13, contentW * 0.06, contentW * 0.13, contentW * 0.06, contentW * 0.08, contentW * 0.07];
  const topHeaderH = 12;
  const subHeaderH = 12;
  const baseRowH = 12;
  ensureSpace(topHeaderH + subHeaderH + soilsPdfRows.length * baseRowH + 18);

  doc.setDrawColor(...colors.line);
  doc.setFillColor(...colors.head);
  doc.rect(margin, y, contentW, topHeaderH, 'FD');
  const xAt = (idx: number) => margin + soilsW.slice(0, idx).reduce((a, b) => a + b, 0);
  doc.setFillColor(224, 237, 255);
  doc.rect(xAt(4), y, soilsW[4] + soilsW[5], topHeaderH, 'F');
  doc.setFillColor(236, 228, 252);
  doc.rect(xAt(6), y, soilsW[6] + soilsW[7] + soilsW[8] + soilsW[9], topHeaderH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...colors.ink);
  doc.text('Matrix', xAt(4) + (soilsW[4] + soilsW[5]) / 2, y + 8, { align: 'center' });
  doc.text('Redox', xAt(6) + (soilsW[6] + soilsW[7] + soilsW[8] + soilsW[9]) / 2, y + 8, { align: 'center' });

  y += topHeaderH;
  doc.setFillColor(...colors.head);
  doc.rect(margin, y, contentW, subHeaderH, 'FD');
  const subHeaders = ['Horizon', 'Depth Range (cm)', 'Thickness (cm)', 'Texture / Note', 'Color', '%', 'Color', '%', 'Type', 'Location'];
  let sx = margin;
  subHeaders.forEach((h, i) => { doc.text(h, sx + 2, y + 8.5); sx += soilsW[i]; });

  let vx = margin;
  for (let i = 0; i < soilsW.length - 1; i++) { vx += soilsW[i]; doc.line(vx, y - topHeaderH, vx, y + subHeaderH + soilsPdfRows.length * baseRowH); }

  y += subHeaderH;
  soilsPdfRows.forEach(r => {
    const wrapped: string[][] = r.map((cell, i) => {
      const lines = doc.splitTextToSize(String(cell ?? '—'), soilsW[i] - 5) as string[];
      return lines.length ? lines : ['—'];
    });
    const rowH = Math.max(baseRowH, ...wrapped.map(lines => lines.length * 7.8 + 4));
    ensureSpace(rowH + 2);
    doc.rect(margin, y, contentW, rowH);
    let rx = margin;
    wrapped.forEach((lines, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal');
      lines.forEach((ln, li) => doc.text(String(ln), rx + 2, y + 8 + li * 7.8));
      rx += soilsW[i];
    });
    y += rowH;
  });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.2);
  doc.setTextColor(...colors.muted);
  const hydricList = (s.HydricSoilIndicators || []).join(', ') || '—';
  const hydricLines = doc.splitTextToSize(`Selected Hydric Soil Indicators: ${hydricList}`, contentW);
  doc.text(hydricLines, margin, y + 8);
  y += hydricLines.length * 8 + 4;

  const hydroRows: string[][] = [
    ['Restrictive Layer', str(s.RestrictiveLayer) || '—'], ['Restrictive Layer Depth (cm)', str(s.RestrictiveLayerDepthCM) || '—'],
    ['Surface Water', str(s.SurfaceWaterYN) || '—'], ['Surface Water Depth (cm)', str(s.SurfaceWaterDepthCM) || '—'],
    ['Water Table', str(s.WaterTableYN) || '—'], ['Water Table Depth (cm)', str(s.WaterTableDepthCM) || '—'],
    ['Saturation', str(s.SaturationYN) || '—'], ['Saturation Depth (cm)', str(s.SaturationDepthCM) || '—'],
    ['Primary Indicators', (s.HydrologyPrimary || []).join(', ') || '—'],
    ['Secondary Indicators', (s.HydrologySecondary || []).join(', ') || '—'],
  ];
  drawTable('Wetland Hydrology', ['Field', 'Value'], hydroRows, [contentW * 0.45, contentW * 0.55], { showHeader: false, boldLeftColumn: true, wrapCells: true });
  drawTable('Notes', ['Field', 'Value'], [['Notes', str(s.notes) || '—']], [contentW * 0.2, contentW * 0.8], { showHeader: false, boldLeftColumn: true, wrapCells: true });

  // Photos: new page, max 2 stacked per page, preserve aspect ratio.
  const photos = normalizePhotoObjects(s);
  if (photos.length) {
    newPage();
    drawHeader();
    sectionTitle('Field Photos');
    const slotsPerPage = 2;
    const gap = 16;
    const captionH = 12;
    const slotH = (bottom - y - gap) / slotsPerPage;
    for (let i = 0; i < photos.length; i++) {
      if (i > 0 && i % slotsPerPage === 0) { newPage(); drawHeader(); sectionTitle('Field Photos (continued)'); }
      const p = photos[i];
      const slotIndex = i % slotsPerPage;
      const top = y + slotIndex * (slotH + gap);
      const boxY = top + captionH;
      const boxH = slotH - captionH;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...colors.ink);
      doc.text(`${i + 1}. ${p.name}`, margin, top + 8);
      doc.setDrawColor(...colors.line);
      doc.rect(margin, boxY, contentW, boxH);
      if (!p.dataUrl) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...colors.muted);
        doc.text('Image data not available in this stored record.', margin + 6, boxY + 14);
        continue;
      }
      try {
        const normalizedUrl = await normalizePhotoForPdf(p.dataUrl);
        const dims = await measureImage(normalizedUrl);
        const iw = Math.max(1, dims.width);
        const ih = Math.max(1, dims.height);
        const scale = Math.min(contentW / iw, boxH / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;
        const dx = margin + (contentW - drawW) / 2;
        const dy = boxY + (boxH - drawH) / 2;
        let format = 'JPEG';
        if (normalizedUrl.includes('image/png')) format = 'PNG';
        else if (normalizedUrl.includes('image/webp')) format = 'WEBP';
        doc.addImage(normalizedUrl, format, dx, dy, drawW, drawH);
      } catch {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...colors.muted);
        doc.text('Could not decode this image.', margin + 6, boxY + 14);
      }
    }
  }

  doc.save(`${base}.pdf`);
}

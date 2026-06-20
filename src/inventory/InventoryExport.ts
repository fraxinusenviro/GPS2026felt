/**
 * Inventory survey exporters: CSV, GeoJSON, Markdown, HTML and PDF.
 * Ported from NSINV (exportCSV/GeoJSON/Markdown/HTML, buildReportHTML, exportPDF).
 *
 * The PDF uses the bundled `jspdf` (same dependency the wetland report uses) with
 * hand-rolled tables — no jspdf-autotable / CDN dependency — so export works
 * fully offline. Body text uses Helvetica (jsPDF core font); the on-screen UI
 * uses the app's Oswald web font.
 */
import { jsPDF } from 'jspdf';
import type { AppSettings, InventorySurvey, InventoryObservation, InventoryReportSettings } from '../types';
import {
  isSoCI, getGroupColor, hexToRgb,
  buildReportGroups, sortObservations, realObservations, uniqueSpeciesCount,
  getReportSettings, downloadText, escapeHtml, dateStamp,
} from './inventorySurvey';

type RGB = [number, number, number];

interface Column { key: string; label: string; }

const PDF_COLOR_SCHEMES: Record<string, {
  headColor: RGB; altColor: RGB; metaFill: RGB; metaDraw: RGB;
  titleRgb: RGB; subtitleRgb: RGB; groupRgb: RGB; ruleRgb: RGB; footerRgb: RGB;
  curveStroke: string; curveFill: string; curveAxis: string; curveGrid: string; curveLabel: string;
}> = {
  fraxinus: {
    headColor: [42, 80, 16], altColor: [240, 248, 232], metaFill: [237, 245, 224], metaDraw: [192, 216, 160],
    titleRgb: [42, 80, 16], subtitleRgb: [106, 128, 80], groupRgb: [58, 96, 32], ruleRgb: [192, 216, 160], footerRgb: [106, 128, 80],
    curveStroke: '#6abf4b', curveFill: 'rgba(106,191,75,0.12)', curveAxis: 'rgba(122,154,96,0.7)', curveGrid: 'rgba(42,56,32,0.25)', curveLabel: '#4a6030',
  },
  slate: {
    headColor: [30, 55, 90], altColor: [235, 241, 250], metaFill: [228, 237, 248], metaDraw: [160, 190, 220],
    titleRgb: [30, 55, 90], subtitleRgb: [90, 120, 160], groupRgb: [40, 70, 115], ruleRgb: [160, 190, 220], footerRgb: [90, 120, 160],
    curveStroke: '#4a90d9', curveFill: 'rgba(74,144,217,0.12)', curveAxis: 'rgba(74,120,175,0.7)', curveGrid: 'rgba(30,55,90,0.25)', curveLabel: '#3060a0',
  },
  terracotta: {
    headColor: [120, 48, 18], altColor: [252, 242, 234], metaFill: [250, 238, 228], metaDraw: [210, 162, 135],
    titleRgb: [120, 48, 18], subtitleRgb: [160, 100, 70], groupRgb: [140, 62, 28], ruleRgb: [210, 162, 135], footerRgb: [160, 100, 70],
    curveStroke: '#d4724a', curveFill: 'rgba(212,114,74,0.12)', curveAxis: 'rgba(185,105,60,0.7)', curveGrid: 'rgba(120,48,18,0.25)', curveLabel: '#a04828',
  },
};

function getReportColumns(rpt: InventoryReportSettings, format: 'md' | 'html' | 'pdf'): Column[] {
  const f = rpt.fields;
  const cols: Column[] = [{ key: 'num', label: '#' }];
  if (f.family) cols.push({ key: 'family', label: 'Family' });
  if (f.code) cols.push({ key: 'code', label: 'Code' });
  cols.push({ key: 'commonName', label: 'Common Name' });
  if (f.scientificName) cols.push({ key: 'scientificName', label: 'Scientific Name' });
  if (f.srank) cols.push({ key: 'srank', label: 'S-Rank' });
  if (f.sprot) cols.push({ key: 'sprot', label: 'Prov. Status' });
  if (f.nprot) cols.push({ key: 'nprot', label: 'COSEWIC' });
  if (f.grank) cols.push({ key: 'grank', label: 'G-Rank' });
  if (f.latitude) cols.push({ key: 'latitude', label: 'Lat' });
  if (f.longitude) cols.push({ key: 'longitude', label: 'Lng' });
  if (f.time && format !== 'md') cols.push({ key: 'time', label: 'Time' });
  if (f.notes) cols.push({ key: 'notes', label: 'Notes' });
  return cols;
}

function getColValue(key: string, o: InventoryObservation, rowIdx: number): string {
  const sp = o.species;
  switch (key) {
    case 'num': return String(rowIdx + 1);
    case 'family': return sp.family || '';
    case 'code': return sp.mcode || '';
    case 'commonName': return sp.commonName || '';
    case 'scientificName': return sp.scientificName || '';
    case 'srank': return sp.srank || '';
    case 'sprot': return sp.sprot || '';
    case 'nprot': return sp.nprot || '';
    case 'grank': return sp.grank || '';
    case 'latitude': return o.lat != null ? String(o.lat) : '';
    case 'longitude': return o.lon != null ? String(o.lon) : '';
    case 'time': return new Date(o.timestamp).toLocaleTimeString();
    case 'notes': return o.notes || '';
    default: return '';
  }
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function escMd(s: string): string { return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' '); }

function prefixFor(s: InventorySurvey): string {
  return (s.siteName || s.surveyID || 'Survey').replace(/[^\w-]+/g, '_');
}

// ── CSV ────────────────────────────────────────────────────────────
export function exportCSV(survey: InventorySurvey): void {
  const ts = dateStamp();
  const hdr = 'obsUUID,surveyID,siteName,surveyor,locale,county,timestamp,taxon,taxonGroup,family,elcode,mcode,commonName,scientificName,grank,nrank,nprot,sprot,srank,noteRank,latitude,longitude,notes\n';
  const rows = survey.observations.map(o => {
    const sp = o.species;
    return [
      csvEscape(o.id), csvEscape(survey.surveyID), csvEscape(survey.siteName),
      csvEscape(survey.surveyor), csvEscape(survey.locale), csvEscape(survey.county),
      csvEscape(new Date(o.timestamp).toISOString()),
      csvEscape(sp.taxon), csvEscape(sp.taxonGroup || ''), csvEscape(sp.family || ''),
      csvEscape(sp.elcode), csvEscape(sp.mcode), csvEscape(sp.commonName), csvEscape(sp.scientificName),
      csvEscape(sp.grank || ''), csvEscape(sp.nrank || ''), csvEscape(sp.nprot || ''),
      csvEscape(sp.sprot || ''), csvEscape(sp.srank), csvEscape(sp.noteRank || ''),
      o.lat, o.lon, csvEscape(o.notes),
    ].join(',');
  }).join('\n');
  downloadText(hdr + rows, `${prefixFor(survey)}_Inventory_Log_${ts}.csv`, 'text/csv');
}

// ── GeoJSON ──────────────────────────────────────────────────────────
export function exportGeoJSON(survey: InventorySurvey): void {
  const ts = dateStamp();
  const features = survey.observations
    .filter(o => o.lat != null && o.lon != null && !['Survey Start', 'Survey End'].includes(o.species.taxon))
    .map(o => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [o.lon, o.lat] },
      properties: {
        obsId: o.id, surveyID: survey.surveyID, siteName: survey.siteName, surveyor: survey.surveyor,
        date: survey.date, timestamp: new Date(o.timestamp).toISOString(),
        taxon: o.species.taxon || '', taxonGroup: o.species.taxonGroup || '',
        commonName: o.species.commonName || '', scientificName: o.species.scientificName || '',
        elcode: o.species.elcode || '', mcode: o.species.mcode || '',
        srank: o.species.srank || '', sprot: o.species.sprot || '', nprot: o.species.nprot || '',
        grank: o.species.grank || '', notes: o.notes || '', isSoCI: isSoCI(o.species),
      },
    }));
  const fc = {
    type: 'FeatureCollection', features,
    metadata: { surveyID: survey.surveyID, siteName: survey.siteName, surveyor: survey.surveyor, date: survey.date, generated: new Date().toISOString() },
  };
  downloadText(JSON.stringify(fc, null, 2), `${prefixFor(survey)}_Observations_${ts}.geojson`, 'application/geo+json');
}

// ── Markdown ─────────────────────────────────────────────────────────
export function exportMarkdown(survey: InventorySurvey, settings: AppSettings): void {
  const ts = dateStamp();
  const rpt = getReportSettings(settings);
  const cols = getReportColumns(rpt, 'md');
  const start = new Date(survey.startTime), end = new Date(survey.endTime || Date.now());
  const durMs = end.getTime() - start.getTime(), durMin = Math.floor(durMs / 60000), durSec = Math.floor((durMs % 60000) / 1000);

  let md = `# ${escMd(rpt.title)}\n`;
  if (rpt.subtitle && rpt.subtitle !== '-') md += `## ${escMd(rpt.subtitle)}\n`;
  md += '\n## Survey Metadata\n';
  md += `**Date:** ${escMd(survey.date)}  \n**Surveyor:** ${escMd(survey.surveyor)}  \n`;
  md += `**Site Name:** ${escMd(survey.siteName)}  \n**Locale:** ${escMd(survey.locale)}  \n`;
  md += `**County:** ${escMd(survey.county)}  \n**Survey ID:** ${escMd(survey.surveyID)}  \n`;
  md += `**Start:** ${start.toLocaleTimeString()}  \n**End:** ${end.toLocaleTimeString()}  \n`;
  md += `**Duration:** ${durMin}m ${durSec}s  \n`;
  if (survey.reportNote) md += `**Note:** ${escMd(survey.reportNote)}  \n`;
  md += '\n';

  const groups = buildReportGroups(realObservations(survey));
  for (const [groupName, group] of groups) {
    if (!group.length) continue;
    const sorted = sortObservations(group, rpt.sortOrder);
    md += `## ${groupName}\n`;
    md += '| ' + cols.map(c => c.label).join(' | ') + ' |\n';
    md += '| ' + cols.map(() => '---').join(' | ') + ' |\n';
    sorted.forEach((o, i) => {
      const vals = cols.map(col => col.key === 'scientificName'
        ? `*${escMd(o.species.scientificName || '')}*`
        : escMd(getColValue(col.key, o, i)));
      md += '| ' + vals.join(' | ') + ' |\n';
    });
    md += '\n';
  }
  downloadText(md, `${prefixFor(survey)}_Inventory_Report_${ts}.md`, 'text/markdown');
}

// ── HTML ─────────────────────────────────────────────────────────────
export function exportHTML(survey: InventorySurvey, settings: AppSettings): void {
  const ts = dateStamp();
  const rpt = getReportSettings(settings);
  const start = new Date(survey.startTime), end = new Date(survey.endTime || Date.now());
  const durMin = Math.floor((end.getTime() - start.getTime()) / 60000);
  const obs = realObservations(survey);
  const uniqueSp = uniqueSpeciesCount(obs);
  const sociObs = obs.filter(o => isSoCI(o.species));
  const cols = getReportColumns(rpt, 'html');
  const groups = buildReportGroups(obs);

  let tables = '';
  for (const [groupName, groupObs] of groups) {
    if (!groupObs.length) continue;
    const sorted = sortObservations(groupObs, rpt.sortOrder);
    const hdr = cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
    const tbody = sorted.map((o, i) => {
      const sp = o.species, soci = isSoCI(sp);
      const cells = cols.map(col => {
        if (col.key === 'scientificName') return `<td><em>${escapeHtml(sp.scientificName || '')}</em></td>`;
        if (col.key === 'srank') return `<td>${escapeHtml(sp.srank || '')}${soci ? ' <span class="badge">SoCI</span>' : ''}</td>`;
        return `<td>${escapeHtml(getColValue(col.key, o, i))}</td>`;
      }).join('');
      return `<tr${soci ? ' class="soci"' : ''}>${cells}</tr>`;
    }).join('');
    tables += `<h2>${escapeHtml(groupName)}</h2><table><thead><tr>${hdr}</tr></thead><tbody>${tbody}</tbody></table>\n`;
  }

  const subtitleHtml = (rpt.subtitle && rpt.subtitle !== '-') ? `<p class="subtitle">${escapeHtml(rpt.subtitle)}</p>` : '';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${escapeHtml(rpt.title)} – ${escapeHtml(survey.siteName)}</title>
<style>
@page{margin:1cm}
body{font-family:Arial,Helvetica,sans-serif;max-width:1400px;margin:0 auto;padding:12px;color:#1a2010;background:#f8faf4;font-size:8pt}
h1{color:#2a5010;font-size:14pt;margin:0}
.subtitle{color:#6a8050;font-size:9pt;margin:0 0 6px}
h2{color:#3a6020;font-size:10pt;margin:10px 0 3px;border-bottom:1px solid #c0d8a0;padding-bottom:2px}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:4px;background:#edf5e0;border:1px solid #c0d8a0;border-radius:4px;padding:7px;margin:6px 0}
.meta-item strong{display:block;font-size:7pt;color:#6a8050;text-transform:uppercase;letter-spacing:.06em}
.stats{display:flex;gap:12px;flex-wrap:wrap;background:#edf5e0;border:1px solid #c0d8a0;border-radius:4px;padding:7px;margin:6px 0}
.stat{text-align:center}.stat strong{display:block;font-size:14pt;color:#2a5010}.stat span{font-size:7pt;color:#6a8050}
table{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:8px}
th{background:#2a5010;color:#fff;padding:2px 4px;text-align:left;font-weight:600}
td{padding:1px 4px;border-bottom:1px solid #d0e8b0}
tr:nth-child(even){background:#f0f8e8}
tr.soci{background:#fff0f0}tr.soci td{color:#c03030}
.badge{background:#c03030;color:#fff;border-radius:2px;padding:0 3px;font-size:7pt;margin-left:2px}
.gen{color:#6a8050;font-size:7pt;margin:3px 0 6px}
@media print{body{background:#fff;padding:0}h2{page-break-inside:avoid}tr{page-break-inside:avoid}}
</style></head><body>
<h1>${escapeHtml(rpt.title)}</h1>${subtitleHtml}
<p class="gen">Generated ${new Date().toLocaleString()}</p>
<h2>Survey Metadata</h2>
<div class="meta-grid">
  <div class="meta-item"><strong>Site Name</strong>${escapeHtml(survey.siteName)}</div>
  <div class="meta-item"><strong>Survey ID</strong>${escapeHtml(survey.surveyID)}</div>
  <div class="meta-item"><strong>Surveyor</strong>${escapeHtml(survey.surveyor)}</div>
  <div class="meta-item"><strong>Locale</strong>${escapeHtml(survey.locale)}</div>
  <div class="meta-item"><strong>County</strong>${escapeHtml(survey.county)}</div>
  <div class="meta-item"><strong>Date</strong>${escapeHtml(survey.date)}</div>
  <div class="meta-item"><strong>Start</strong>${start.toLocaleTimeString()}</div>
  <div class="meta-item"><strong>End</strong>${end.toLocaleTimeString()}</div>
  <div class="meta-item"><strong>Duration</strong>${durMin} min</div>
  ${survey.reportNote ? `<div class="meta-item"><strong>Note</strong>${escapeHtml(survey.reportNote)}</div>` : ''}
</div>
<h2>Summary</h2>
<div class="stats">
  <div class="stat"><strong>${uniqueSp}</strong><span>Unique Species</span></div>
  <div class="stat"><strong>${obs.length}</strong><span>Total Observations</span></div>
  <div class="stat"><strong>${sociObs.length}</strong><span>SoCI Obs.</span></div>
  <div class="stat"><strong>${uniqueSpeciesCount(sociObs)}</strong><span>SoCI Species</span></div>
</div>
${tables}</body></html>`;
  downloadText(html, `${prefixFor(survey)}_Inventory_Report_${ts}.html`, 'text/html');
}

// ── Species–time curve image (canvas → PNG data URL) ───────────────────
function generateCurveImageB64(widthPx: number, heightPx: number, sortedObs: InventoryObservation[], rpt: InventoryReportSettings): string | null {
  if (!sortedObs || sortedObs.length < 2) return null;
  const seenAll = new Set<string>();
  const cumCounts = sortedObs.map(o => { if (o.species.elcode) seenAll.add(o.species.elcode); return seenAll.size; });
  const maxN = cumCounts[cumCounts.length - 1];
  if (maxN < 1) return null;
  const linePoints: { t: number; n: number }[] = []; let prevN = 0;
  sortedObs.forEach((o, i) => { if (cumCounts[i] > prevN) { linePoints.push({ t: o.timestamp, n: cumCounts[i] }); prevN = cumCounts[i]; } });
  if (linePoints.length < 2) return null;

  const scheme = PDF_COLOR_SCHEMES[rpt.colorScheme] || PDF_COLOR_SCHEMES.fraxinus;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx; canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, widthPx, heightPx);
  const W = widthPx, H = heightPx;
  const pad = { top: 28, right: 28, bottom: 62, left: 58 };
  const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom;
  const t0 = sortedObs[0].timestamp, t1 = sortedObs[sortedObs.length - 1].timestamp, tRange = t1 - t0 || 1;
  const tx = (t: number) => pad.left + ((t - t0) / tRange) * pw;
  const ty = (n: number) => pad.top + ph - (n / maxN) * ph;
  ctx.strokeStyle = scheme.curveGrid; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const gy = pad.top + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + pw, gy); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(tx(linePoints[0].t), ty(0));
  linePoints.forEach(p => ctx.lineTo(tx(p.t), ty(p.n)));
  ctx.lineTo(tx(linePoints[linePoints.length - 1].t), ty(0)); ctx.closePath();
  ctx.fillStyle = scheme.curveFill; ctx.fill();
  ctx.beginPath(); ctx.moveTo(tx(linePoints[0].t), ty(linePoints[0].n));
  linePoints.forEach(p => ctx.lineTo(tx(p.t), ty(p.n)));
  ctx.strokeStyle = scheme.curveStroke; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = scheme.curveAxis; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + ph); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top + ph); ctx.lineTo(pad.left + pw, pad.top + ph); ctx.stroke();
  const lfsz = Math.max(14, Math.round(H * 0.022));
  ctx.fillStyle = scheme.curveLabel; ctx.font = `${lfsz}px monospace`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  [0, Math.round(maxN / 2), maxN].forEach(n => ctx.fillText(String(n), pad.left - 8, ty(n)));
  ctx.save(); ctx.translate(16, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('Species', 0, 0); ctx.restore();
  const tRangeMin = tRange / 60000;
  const tickCandidates = [1, 2, 5, 10, 15, 20, 30, 60, 90, 120, 180, 240];
  let tickIntervalMin = 1;
  for (const c of tickCandidates) { if (tRangeMin / c <= 8) { tickIntervalMin = c; break; } }
  const tickIntervalMs = tickIntervalMin * 60000;
  ctx.strokeStyle = scheme.curveAxis; ctx.lineWidth = 1;
  ctx.fillStyle = scheme.curveLabel; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const tickFsz = Math.max(12, Math.round(H * 0.018));
  ctx.font = `${tickFsz}px monospace`;
  for (let ti = 0; ; ti++) {
    const tTick = t0 + ti * tickIntervalMs;
    if (tTick > t1 + tickIntervalMs * 0.5) break;
    const xTick = pad.left + Math.min(1, (tTick - t0) / tRange) * pw;
    ctx.beginPath(); ctx.moveTo(xTick, pad.top + ph); ctx.lineTo(xTick, pad.top + ph + 6); ctx.stroke();
    ctx.fillText(`${ti * tickIntervalMin}m`, xTick, pad.top + ph + 20);
  }
  ctx.font = `${lfsz}px monospace`; ctx.textAlign = 'center';
  ctx.fillText('Time (min)', pad.left + pw / 2, H - 8);
  const mr = Math.max(8, Math.round(Math.min(W, H) * 0.013));
  const mfsz = Math.max(8, Math.round(mr * 0.8));
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  sortedObs.forEach((o, idx) => {
    const px = tx(o.timestamp), py = ty(cumCounts[idx]);
    const { r, g, b } = hexToRgb(getGroupColor(o.species.taxon));
    ctx.beginPath(); ctx.arc(px, py, mr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, mr * 0.18); ctx.stroke();
    if (rpt.labelObsNumbers) { ctx.font = `bold ${mfsz}px sans-serif`; ctx.fillStyle = '#ffffff'; ctx.fillText(String(idx + 1), px, py); }
  });
  return canvas.toDataURL('image/png');
}

// ── Satellite overview map (ESRI World Imagery) ────────────────────────
function latToMercatorY(lat: number): number { return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }

async function fetchSatelliteMapData(observations: InventoryObservation[], widthPx: number, heightPx: number): Promise<{ imageDataUrl: string; bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } } | null> {
  if (!observations.length) return null;
  let minLat = observations[0].lat, maxLat = observations[0].lat, minLng = observations[0].lon, maxLng = observations[0].lon;
  observations.forEach(o => {
    if (o.lat < minLat) minLat = o.lat; if (o.lat > maxLat) maxLat = o.lat;
    if (o.lon < minLng) minLng = o.lon; if (o.lon > maxLng) maxLng = o.lon;
  });
  const latSpan = Math.max(maxLat - minLat, 0.01), lngSpan = Math.max(maxLng - minLng, 0.01);
  minLat -= latSpan * 0.2; maxLat += latSpan * 0.2; minLng -= lngSpan * 0.2; maxLng += lngSpan * 0.2;
  const bbox = { minLat, maxLat, minLng, maxLng };
  const bboxStr = `${minLng.toFixed(6)},${minLat.toFixed(6)},${maxLng.toFixed(6)},${maxLat.toFixed(6)}`;
  const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bboxStr}&bboxSR=4326&size=${widthPx},${heightPx}&format=png32&f=image`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const imageDataUrl = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return { imageDataUrl, bbox };
  } catch { return null; }
}

function compositeMapWithMarkers(mapData: { imageDataUrl: string; bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } }, sortedObs: InventoryObservation[], rpt: InventoryReportSettings): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      const { bbox } = mapData;
      const mercMinY = latToMercatorY(bbox.minLat), mercMaxY = latToMercatorY(bbox.maxLat);
      const toX = (lng: number) => (lng - bbox.minLng) / (bbox.maxLng - bbox.minLng) * W;
      const toY = (lat: number) => (1 - (latToMercatorY(lat) - mercMinY) / (mercMaxY - mercMinY)) * H;
      const r = Math.max(10, Math.round(Math.min(W, H) * 0.018));
      const fontSize = Math.max(9, Math.round(r * 0.85));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      sortedObs.forEach((o, idx) => {
        if (o.lat == null || o.lon == null) return;
        const x = toX(o.lon), y = toY(o.lat);
        const { r: cr, g: cg, b: cb } = hexToRgb(getGroupColor(o.species.taxon));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${cr},${cg},${cb})`; ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.stroke();
        if (rpt.labelObsNumbers) { ctx.font = `bold ${fontSize}px sans-serif`; ctx.fillStyle = '#ffffff'; ctx.fillText(String(idx + 1), x, y); }
      });
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = mapData.imageDataUrl;
  });
}

// ── PDF (bundled jsPDF, hand-rolled tables) ────────────────────────────
export async function exportPDF(survey: InventorySurvey, settings: AppSettings): Promise<void> {
  const rpt = getReportSettings(settings);
  const scheme = PDF_COLOR_SCHEMES[rpt.colorScheme] || PDF_COLOR_SCHEMES.fraxinus;
  const start = new Date(survey.startTime), end = new Date(survey.endTime || Date.now());
  const durMin = Math.floor((end.getTime() - start.getTime()) / 60000);
  const obs = realObservations(survey);
  const uniqueSp = uniqueSpeciesCount(obs);
  const sociObs = obs.filter(o => isSoCI(o.species));
  const cols = getReportColumns(rpt, 'pdf');
  const groups = buildReportGroups(obs);
  const sortedObs = [...obs].sort((a, b) => a.timestamp - b.timestamp);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const M = 10;
  const FONT = 'helvetica';
  const genTimestamp = `Generated ${new Date().toLocaleString()}`;

  const drawPageHeader = () => {
    doc.setFont(FONT, 'bold').setFontSize(12).setTextColor(...scheme.titleRgb);
    doc.text(rpt.title, M, M + 6);
    if (rpt.subtitle && rpt.subtitle !== '-') {
      doc.setFont(FONT, 'normal').setFontSize(7).setTextColor(...scheme.subtitleRgb);
      doc.text(rpt.subtitle, M, M + 11);
    }
    doc.setDrawColor(...scheme.ruleRgb).setLineWidth(0.3);
    doc.line(M, M + 14, PW - M, M + 14);
  };

  // Hand-rolled species table with per-row SoCI shading and a header band.
  const drawTable = (headers: string[], rows: string[][], startY: number, sociFlags: boolean[]): number => {
    const colW = headers.map((_, i) => {
      // give Common/Scientific/Notes more room
      const key = cols[i]?.key;
      if (key === 'commonName' || key === 'scientificName') return 2.2;
      if (key === 'notes') return 2;
      if (key === 'family') return 1.6;
      if (key === 'num') return 0.5;
      return 1;
    });
    const totalUnits = colW.reduce((a, b) => a + b, 0);
    const tableW = PW - M * 2;
    const widths = colW.map(u => (u / totalUnits) * tableW);
    const rowH = 5;
    const headH = 5.5;
    let y = startY;

    // header
    doc.setFillColor(...scheme.headColor);
    doc.rect(M, y, tableW, headH, 'F');
    doc.setFont(FONT, 'bold').setFontSize(7).setTextColor(255, 255, 255);
    let cx = M;
    headers.forEach((h, i) => { doc.text(String(h), cx + 1.5, y + 3.8); cx += widths[i]; });
    y += headH;

    doc.setFont(FONT, 'normal').setFontSize(7);
    rows.forEach((r, ri) => {
      if (y > PH - 14) { doc.addPage(); drawPageHeader(); y = M + 18; }
      const soci = sociFlags[ri];
      if (soci) { doc.setFillColor(255, 240, 240); doc.rect(M, y, tableW, rowH, 'F'); }
      else if (ri % 2 === 1) { doc.setFillColor(...scheme.altColor); doc.rect(M, y, tableW, rowH, 'F'); }
      let rx = M;
      r.forEach((cell, ci) => {
        const isSci = cols[ci]?.key === 'scientificName';
        doc.setFont(FONT, isSci ? 'italic' : 'normal');
        doc.setTextColor(...(soci ? [192, 48, 48] as RGB : [26, 32, 16] as RGB));
        const text = doc.splitTextToSize(String(cell ?? ''), widths[ci] - 3)[0] || '';
        doc.text(text, rx + 1.5, y + 3.6);
        rx += widths[ci];
      });
      y += rowH;
    });
    return y;
  };

  drawPageHeader();
  let y = M + 18;

  // Metadata box
  doc.setFont(FONT, 'bold').setFontSize(8).setTextColor(...scheme.groupRgb);
  doc.text('Survey Metadata', M, y); y += 2;
  const meta: [string, string][] = [
    ['Site Name', survey.siteName], ['Survey ID', survey.surveyID], ['Surveyor', survey.surveyor],
    ['Locale', survey.locale], ['County', survey.county], ['Date', survey.date],
    ['Start', start.toLocaleTimeString()], ['End', end.toLocaleTimeString()], ['Duration', `${durMin} min`],
    ...(survey.reportNote ? [['Note', survey.reportNote] as [string, string]] : []),
  ];
  const cols5 = 5;
  const metaW = (PW - M * 2) / cols5;
  const metaH = Math.ceil(meta.length / cols5) * 9 + 4;
  doc.setFillColor(...scheme.metaFill).setDrawColor(...scheme.metaDraw);
  doc.rect(M, y, PW - M * 2, metaH, 'FD');
  meta.forEach(([label, val], i) => {
    const mx = M + (i % cols5) * metaW + 2;
    const my = y + Math.floor(i / cols5) * 9 + 5;
    doc.setFont(FONT, 'bold').setFontSize(5).setTextColor(...scheme.subtitleRgb);
    doc.text(label.toUpperCase(), mx, my);
    doc.setFont(FONT, 'normal').setFontSize(6).setTextColor(26, 32, 16);
    doc.text(doc.splitTextToSize(String(val ?? ''), metaW - 3)[0] || '', mx, my + 3.5);
  });
  y += metaH + 4;

  // Summary stats
  doc.setFont(FONT, 'bold').setFontSize(8).setTextColor(...scheme.groupRgb);
  doc.text('Summary', M, y); y += 2;
  const statsData: [string, string][] = [
    [String(uniqueSp), 'Unique Species'], [String(obs.length), 'Total Observations'],
    [String(sociObs.length), 'SoCI Observations'], [String(uniqueSpeciesCount(sociObs)), 'SoCI Species'],
  ];
  const statW = (PW - M * 2) / statsData.length;
  doc.setFillColor(...scheme.metaFill).setDrawColor(...scheme.metaDraw);
  doc.rect(M, y, PW - M * 2, 11, 'FD');
  statsData.forEach(([val, label], i) => {
    const sx = M + i * statW + statW / 2;
    doc.setFont(FONT, 'bold').setFontSize(10).setTextColor(...scheme.titleRgb);
    doc.text(val, sx, y + 5, { align: 'center' });
    doc.setFont(FONT, 'normal').setFontSize(5).setTextColor(...scheme.subtitleRgb);
    doc.text(label, sx, y + 9, { align: 'center' });
  });
  y += 15;

  // Species tables per group
  for (const [groupName, groupObs] of groups) {
    if (!groupObs.length) continue;
    const sorted = sortObservations(groupObs, rpt.sortOrder);
    if (y > PH - 30) { doc.addPage(); drawPageHeader(); y = M + 18; }
    doc.setFont(FONT, 'bold').setFontSize(8).setTextColor(...scheme.groupRgb);
    doc.text(groupName, M, y);
    doc.setDrawColor(...scheme.ruleRgb).setLineWidth(0.3);
    doc.line(M, y + 1, PW - M, y + 1);
    y += 4;
    const body = sorted.map((o, i) => cols.map(c => getColValue(c.key, o, i)));
    const sociFlags = sorted.map(o => isSoCI(o.species));
    y = drawTable(cols.map(c => c.label), body, y, sociFlags) + 5;
  }

  // Optional overview map / curve pages
  const imgAvailW = PW - M * 2;
  const imgAvailH = PH - M * 2 - 22;
  const pxW = 1200, pxH = Math.round(pxW * imgAvailH / imgAvailW);

  if (rpt.includeMap) {
    const withCoords = sortedObs.filter(o => o.lat != null && o.lon != null);
    if (withCoords.length) {
      const mapData = await fetchSatelliteMapData(withCoords, pxW, pxH);
      if (mapData) {
        const composite = await compositeMapWithMarkers(mapData, sortedObs, rpt);
        if (composite) {
          doc.addPage(); drawPageHeader();
          doc.setFont(FONT, 'bold').setFontSize(9).setTextColor(...scheme.groupRgb);
          doc.text('Overview Map — Satellite View', M, M + 17);
          doc.addImage(composite, 'PNG', M, M + 21, imgAvailW, imgAvailH);
        }
      }
    }
  }

  if (rpt.includeCurve) {
    const curveImg = generateCurveImageB64(pxW, pxH, sortedObs, rpt);
    if (curveImg) {
      doc.addPage(); drawPageHeader();
      doc.setFont(FONT, 'bold').setFontSize(9).setTextColor(...scheme.groupRgb);
      doc.text('Species–Time Curve', M, M + 17);
      doc.addImage(curveImg, 'PNG', M, M + 21, imgAvailW, imgAvailH);
    }
  }

  // Running footer
  const totalPages = doc.internal.pages.length - 1;
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerRuleY = PH - 10;
    doc.setDrawColor(...scheme.ruleRgb).setLineWidth(0.3);
    doc.line(M, footerRuleY, PW - M, footerRuleY);
    doc.setFont(FONT, 'normal').setFontSize(6).setTextColor(...scheme.footerRgb);
    doc.text(genTimestamp, M, footerRuleY + 4);
    doc.text(`Page ${p} of ${totalPages}`, PW - M, footerRuleY + 4, { align: 'right' });
  }

  doc.save(`${prefixFor(survey)}_Inventory_Report_${dateStamp()}.pdf`);
}

/**
 * GeoPDF parsing and rendering for MapLibre overlay.
 *
 * Tries three registration strategies in order:
 *   1. OGC LGIDict (USGS, NRCan, Avenza)
 *   2. Adobe XMP geospatial extension
 *   3. Viewport / GPTS+LPTS array (older Acrobat exports)
 *
 * On success returns a JPEG data URL of the rendered page plus WGS-84
 * corner bounds ready for a MapLibre image source.
 */

import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import proj4 from 'proj4'

// Configure worker once at module evaluation time.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GeoPdfResult {
  /** JPEG data URL of the rendered first page (≤ 2048 px wide) */
  imageDataUrl: string
  /** WGS-84 [west, south, east, north], or null if no geo-registration found */
  bounds: [number, number, number, number] | null
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface AffineTransform {
  a: number; b: number; c: number; d: number; e: number; f: number
}

interface Registration {
  crs: string
  affine: AffineTransform
  pageWidthPt: number
  pageHeightPt: number
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseGeoPDF(data: ArrayBuffer): Promise<GeoPdfResult> {
  const pdfDoc = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const page = await pdfDoc.getPage(1)
  const vp = page.getViewport({ scale: 1 })
  const pageWidthPt = vp.viewBox[2] - vp.viewBox[0]
  const pageHeightPt = vp.viewBox[3] - vp.viewBox[1]

  // Try geo-registration strategies in priority order
  const reg =
    scanLGIDict(data, pageWidthPt, pageHeightPt) ??
    (await extractXmpRegistration(pdfDoc, pageWidthPt, pageHeightPt)) ??
    scanViewportCTM(data, pageWidthPt, pageHeightPt)

  let bounds: [number, number, number, number] | null = null
  if (reg) {
    ensureProjection(reg.crs)
    bounds = computeBounds(reg)
  }

  const imageDataUrl = await renderPageToDataUrl(page)
  pdfDoc.destroy()

  return { imageDataUrl, bounds }
}

// ─── LGIDict scanner ──────────────────────────────────────────────────────────

function scanLGIDict(
  data: ArrayBuffer,
  pageWidthPt: number,
  pageHeightPt: number,
): Registration | null {
  const bytes = new Uint8Array(data)

  // Scan first 10 MB (covers linearised USGS quads)
  const head = decodeLatin1(bytes, 0, Math.min(bytes.length, 10 * 1024 * 1024))
  let lgiIdx = head.indexOf('/LGIDict')

  // If not in the head, try the last 2 MB (non-linearised PDFs store the
  // page dict near the end)
  if (lgiIdx === -1) {
    const tailStart = Math.max(0, bytes.length - 2 * 1024 * 1024)
    const tail = decodeLatin1(bytes, tailStart, bytes.length)
    const tailIdx = tail.indexOf('/LGIDict')
    if (tailIdx === -1) return null
    // Re-decode a generous window around the found token
    const winStart = Math.max(0, tailStart + tailIdx - 100)
    const winEnd = Math.min(bytes.length, winStart + 8000)
    const win = decodeLatin1(bytes, winStart, winEnd)
    return parseLGISection(win, 0, pageWidthPt, pageHeightPt)
  }

  return parseLGISection(head, lgiIdx, pageWidthPt, pageHeightPt)
}

function parseLGISection(
  text: string,
  lgiIdx: number,
  pageWidthPt: number,
  pageHeightPt: number,
): Registration | null {
  try {
    const regIdx = text.indexOf('/Registration', lgiIdx)
    if (regIdx === -1) return null
    const gcps = parseRegistrationArray(text, regIdx + '/Registration'.length)
    if (gcps.length < 2) return null
    const crs = parseCrs(text, lgiIdx)
    return { crs, affine: gcpsToAffine(gcps), pageWidthPt, pageHeightPt }
  } catch {
    return null
  }
}

function parseRegistrationArray(
  text: string,
  startIdx: number,
): [number, number, number, number][] {
  const gcps: [number, number, number, number][] = []
  let i = startIdx
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '[') return gcps
  i++
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === ']') break
    if (text[i] === '[') {
      i++
      const nums: number[] = []
      while (i < text.length && text[i] !== ']') {
        const m = text.slice(i).match(/^[\s]*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/)
        if (m) { nums.push(parseFloat(m[1])); i += m[0].length } else i++
      }
      if (nums.length === 4) gcps.push([nums[0], nums[1], nums[2], nums[3]])
      i++ // skip closing ]
    } else {
      i++
    }
  }
  return gcps
}

function parseCrs(text: string, lgiStart: number): string {
  const projIdx = text.indexOf('/Projection', lgiStart)
  if (projIdx === -1) return 'EPSG:4326'
  const section = text.slice(projIdx, projIdx + 2000)

  const epsgMatch = section.match(/\/EPSG\s+(\d+)/) ?? section.match(/EPSG:(\d+)/)
  if (epsgMatch) return `EPSG:${epsgMatch[1]}`

  const projType = section.match(/\/ProjectionType\s+\/(\w+)/)?.[1] ?? ''
  const datum = section.match(/\/Datum\s+\(([^)]+)\)/)?.[1] ?? 'WGS84'
  const zone = +(section.match(/\/Zone\s+(\d+)/)?.[1] ?? section.match(/\/ZoneNumber\s+(\d+)/)?.[1] ?? 0)
  const isNorth =
    (section.match(/\/Hemisphere\s+\(([NS])\)/)?.[1] ??
      section.match(/\/Hemisphere\s+\/([NS])/)?.[1] ??
      'N') === 'N'

  if ((projType === 'UT' || projType === 'UTM') && zone) {
    if (datum.includes('WGS84') || datum.includes('WGS 84'))
      return isNorth ? `EPSG:${32600 + zone}` : `EPSG:${32700 + zone}`
    if (datum.includes('NAD83'))
      return isNorth ? `EPSG:${26900 + zone}` : `EPSG:${32100 + zone}`
    if (datum.includes('NAD27'))
      return isNorth ? `EPSG:${26700 + zone}` : `EPSG:${26800 + zone}`
  }

  if (projType === 'GE' || projType === 'Geographic' || projType === 'LE90') {
    if (datum.includes('NAD83')) return 'EPSG:4269'
    return 'EPSG:4326'
  }

  return 'EPSG:4326'
}

// ─── XMP scanner ──────────────────────────────────────────────────────────────

async function extractXmpRegistration(
  pdfDoc: PDFDocumentProxy,
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<Registration | null> {
  try {
    const meta = await pdfDoc.getMetadata()
    const xmp = (meta as { metadata?: { _metadata?: string } }).metadata?._metadata ?? null
    if (!xmp || (!xmp.includes('GeoRegistration') && !xmp.includes('geo:'))) return null
    const gcps = parseXmpGCPs(xmp)
    if (gcps.length < 2) return null
    const crs = xmp.match(/EPSG:(\d+)/i) ? `EPSG:${xmp.match(/EPSG:(\d+)/i)![1]}` : 'EPSG:4326'
    return { crs, affine: gcpsToAffine(gcps), pageWidthPt, pageHeightPt }
  } catch {
    return null
  }
}

function parseXmpGCPs(xmp: string): [number, number, number, number][] {
  const gcps: [number, number, number, number][] = []
  const re = /<[^>]*ControlPoint[^>]*>([\s\S]*?)<\/[^>]*ControlPoint>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xmp)) !== null) {
    const inner = m[1]
    const x = xmlNum(inner, 'x') ?? xmlNum(inner, 'PageX')
    const y = xmlNum(inner, 'y') ?? xmlNum(inner, 'PageY')
    const lon = xmlNum(inner, 'Longitude') ?? xmlNum(inner, 'longitude')
    const lat = xmlNum(inner, 'Latitude') ?? xmlNum(inner, 'latitude')
    if (x !== null && y !== null && lon !== null && lat !== null) gcps.push([x, y, lon, lat])
  }
  return gcps
}

function xmlNum(xml: string, tag: string): number | null {
  const m = new RegExp(`<[^>]*${tag}[^>]*>([^<]+)<`, 'i').exec(xml)
  return m ? parseFloat(m[1]) : null
}

// ─── Viewport / CTM scanner ───────────────────────────────────────────────────

function scanViewportCTM(
  data: ArrayBuffer,
  pageWidthPt: number,
  pageHeightPt: number,
): Registration | null {
  const bytes = new Uint8Array(data)
  const text = decodeLatin1(bytes, 0, Math.min(bytes.length, 10 * 1024 * 1024))
  const vpIdx = text.indexOf('/Viewport')
  if (vpIdx === -1) return null
  try {
    const section = text.slice(vpIdx, vpIdx + 4000)
    const gptsIdx = section.indexOf('/GPTS')
    const lptsIdx = section.indexOf('/LPTS')
    if (gptsIdx === -1 || lptsIdx === -1) return null
    const gpts = parseNumArray(section, gptsIdx + 5) // lat/lon pairs
    const lpts = parseNumArray(section, lptsIdx + 5) // normalised x/y
    if (gpts.length < 6 || lpts.length < 6) return null
    const gcps: [number, number, number, number][] = []
    const count = Math.min(gpts.length / 2, lpts.length / 2)
    for (let i = 0; i < count; i++) {
      gcps.push([
        lpts[i * 2] * pageWidthPt,
        lpts[i * 2 + 1] * pageHeightPt,
        gpts[i * 2 + 1], // lon
        gpts[i * 2],     // lat
      ])
    }
    if (gcps.length < 2) return null
    return { crs: 'EPSG:4326', affine: gcpsToAffine(gcps), pageWidthPt, pageHeightPt }
  } catch {
    return null
  }
}

function parseNumArray(text: string, startIdx: number): number[] {
  let i = startIdx
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '[') return []
  i++
  const nums: number[] = []
  while (i < text.length && text[i] !== ']') {
    const m = text.slice(i).match(/^[\s]*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/)
    if (m) { nums.push(parseFloat(m[1])); i += m[0].length } else i++
  }
  return nums
}

// ─── Affine transform math ────────────────────────────────────────────────────

function gcpsToAffine(gcps: [number, number, number, number][]): AffineTransform {
  if (gcps.length < 2) throw new Error('Need at least 2 GCPs')
  if (gcps.length === 2) {
    const [x1, y1, px1, py1] = gcps[0]
    const [x2, y2, px2, py2] = gcps[1]
    const dx = x2 - x1, dy = y2 - y1
    const dpx = px2 - px1, dpy = py2 - py1
    const denom = dx * dx + dy * dy
    const a = (dpx * dx + dpy * dy) / denom
    const b = (dpx * dy - dpy * dx) / denom
    const e = px1 - a * x1 - b * y1
    const f = py1 - b * x1 + a * y1
    return { a, b, c: -b, d: a, e, f }
  }
  const n = gcps.length
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0
  let sumPxX = 0, sumPxY = 0, sumPx = 0
  let sumPyX = 0, sumPyY = 0, sumPy = 0
  for (const [x, y, px, py] of gcps) {
    sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y
    sumPxX += px * x; sumPxY += px * y; sumPx += px
    sumPyX += py * x; sumPyY += py * y; sumPy += py
  }
  const M = [
    [sumXX, sumXY, sumX],
    [sumXY, sumYY, sumY],
    [sumX,  sumY,  n   ],
  ]
  const [a, b, e] = solveLinear3(M, [sumPxX, sumPxY, sumPx])
  const [c, d, f] = solveLinear3(M, [sumPyX, sumPyY, sumPy])
  return { a, b, c, d, e, f }
}

function solveLinear3(M: number[][], rhs: number[]): [number, number, number] {
  const A = M.map((row, i) => [...row, rhs[i]])
  for (let col = 0; col < 3; col++) {
    let maxRow = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row
    }
    ;[A[col], A[maxRow]] = [A[maxRow], A[col]]
    for (let row = col + 1; row < 3; row++) {
      const factor = A[row][col] / A[col][col]
      for (let k = col; k <= 3; k++) A[row][k] -= factor * A[col][k]
    }
  }
  const x = [0, 0, 0]
  for (let i = 2; i >= 0; i--) {
    x[i] = A[i][3]
    for (let j = i + 1; j < 3; j++) x[i] -= A[i][j] * x[j]
    x[i] /= A[i][i]
  }
  return [x[0], x[1], x[2]]
}

function applyAffine(t: AffineTransform, x: number, y: number): [number, number] {
  return [t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f]
}

// ─── Projection helpers ───────────────────────────────────────────────────────

/**
 * Register common UTM / geographic projections as proj4 definitions without a
 * network fetch. Covers the EPSG codes that USGS and NRCan GeoPDFs use.
 */
function ensureProjection(crs: string): void {
  if (crs === 'EPSG:4326') return
  try { proj4(crs, 'EPSG:4326', [0, 0]); return } catch { /* not registered yet */ }
  const epsg = parseInt(crs.replace(/^\D+/, ''))
  if (!epsg) return
  if (epsg >= 32601 && epsg <= 32660)
    proj4.defs(crs, `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`)
  else if (epsg >= 32701 && epsg <= 32760)
    proj4.defs(crs, `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`)
  else if (epsg >= 26901 && epsg <= 26923)
    proj4.defs(crs, `+proj=utm +zone=${epsg - 26900} +datum=NAD83 +units=m +no_defs`)
  else if (epsg >= 26701 && epsg <= 26723)
    proj4.defs(crs, `+proj=utm +zone=${epsg - 26700} +datum=NAD27 +units=m +no_defs`)
  else if (epsg === 4269)
    proj4.defs(crs, '+proj=longlat +datum=NAD83 +no_defs')
  else if (epsg === 4267)
    proj4.defs(crs, '+proj=longlat +datum=NAD27 +no_defs')
}

// ─── Bounds computation ───────────────────────────────────────────────────────

function computeBounds(reg: Registration): [number, number, number, number] {
  const { pageWidthPt: w, pageHeightPt: h } = reg
  const corners: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]]
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [x, y] of corners) {
    const [projX, projY] = applyAffine(reg.affine, x, y)
    let lon: number, lat: number
    if (reg.crs === 'EPSG:4326') {
      lon = projX; lat = projY
    } else {
      try { ;[lon, lat] = proj4(reg.crs, 'EPSG:4326', [projX, projY]) }
      catch { continue }
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  if (!isFinite(minLon)) return [-180, -90, 180, 90]
  return [minLon, minLat, maxLon, maxLat]
}

// ─── Rendering ────────────────────────────────────────────────────────────────

async function renderPageToDataUrl(page: pdfjs.PDFPageProxy): Promise<string> {
  const vp = page.getViewport({ scale: 1 })
  const scale = Math.min(2048 / vp.width, 3) // max 2048 px wide, max 3× DPR
  const scaledVp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scaledVp.width)
  canvas.height = Math.round(scaledVp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: scaledVp }).promise
  return canvas.toDataURL('image/jpeg', 0.85)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodeLatin1(bytes: Uint8Array, start: number, end: number): string {
  let str = ''
  for (let i = start; i < end && i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return str
}

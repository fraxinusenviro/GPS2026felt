/**
 * GeoPDF parsing pipeline.
 *
 * Supports:
 *  1. OGC Best Practice LGIDict (USGS, NRCan, etc.)
 *  2. Adobe XMP geospatial extension (some Avenza-produced maps)
 *  3. Viewport / CTM registration (older Acrobat exports)
 *
 * Returns a MapRegistration that includes the affine transform mapping
 * PDF user units → projected coordinates, plus the CRS string.
 */

import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import type { MapRegistration, ImportedMap } from '@/types'
import { gcpsToAffine } from './affine'

// Configure the PDF.js worker once when this chunk is first evaluated.
// This module is only reachable via lazy-loaded components (MapViewer, ImportMapSheet),
// so it always runs after React has mounted on the main bundle.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parsePdfFile(
  data: ArrayBuffer,
  fileName: string,
): Promise<{ pdfDoc: PDFDocumentProxy; map: ImportedMap }> {
  const loadingTask = pdfjs.getDocument({ data: data.slice(0) })
  const pdfDoc = await loadingTask.promise

  const numPages = pdfDoc.numPages
  const page = await pdfDoc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })

  // Page dimensions in PDF user units (1 pt = 1/72 inch)
  const pageWidthPt = viewport.viewBox[2] - viewport.viewBox[0]
  const pageHeightPt = viewport.viewBox[3] - viewport.viewBox[1]

  // Try to extract geospatial registration
  const registration = await extractRegistration(pdfDoc, data, pageWidthPt, pageHeightPt)

  // Generate thumbnail
  const thumbnailDataUrl = await renderThumbnail(page)

  // Derive bounds from registration (for display)
  let bounds: [number, number, number, number] | undefined
  if (registration) {
    bounds = computeBounds(registration, pageWidthPt, pageHeightPt)
    registration.bounds = bounds
  }

  const id = crypto.randomUUID()
  const map: ImportedMap = {
    id,
    name: stripExtension(fileName),
    fileName,
    fileSize: data.byteLength,
    importedAt: Date.now(),
    registration,
    thumbnailDataUrl,
    numPages,
    mapPage: 1,
  }

  return { pdfDoc, map }
}

// ─── Registration extraction ──────────────────────────────────────────────────

async function extractRegistration(
  pdfDoc: PDFDocumentProxy,
  rawData: ArrayBuffer,
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<MapRegistration | null> {
  // Strategy 1: Scan raw PDF bytes for LGIDict
  const lgi = scanLGIDict(rawData, pageWidthPt, pageHeightPt)
  if (lgi) return lgi

  // Strategy 2: Check XMP metadata for geospatial registration
  const xmp = await extractXmpRegistration(pdfDoc, pageWidthPt, pageHeightPt)
  if (xmp) return xmp

  // Strategy 3: Look for Viewport array with CTM (older format)
  const viewport = scanViewportCTM(rawData, pageWidthPt, pageHeightPt)
  if (viewport) return viewport

  return null
}

// ─── LGIDict scanner ──────────────────────────────────────────────────────────

/**
 * Scan the raw PDF bytes for the OGC LGIDict structure.
 * This is the format used by USGS National Map GeoPDFs.
 */
function scanLGIDict(
  data: ArrayBuffer,
  pageWidthPt: number,
  pageHeightPt: number,
): MapRegistration | null {
  const bytes = new Uint8Array(data)
  // Decode as Latin-1 (safe for binary PDF scanning)
  const text = decodeLatin1(bytes, 0, Math.min(bytes.length, 2 * 1024 * 1024))

  const lgiIdx = text.indexOf('/LGIDict')
  if (lgiIdx === -1) return null

  try {
    // Find the Registration array
    const regIdx = text.indexOf('/Registration', lgiIdx)
    if (regIdx === -1) return null

    const gcps = parseRegistrationArray(text, regIdx + '/Registration'.length)
    if (gcps.length < 3) return null

    // Find the Projection dict
    const crs = parseCrs(text, lgiIdx)

    const affine = gcpsToAffine(gcps)
    return { crs, affine, pageWidthPt, pageHeightPt }
  } catch {
    return null
  }
}

/**
 * Parse the Registration array: [[pdfX pdfY projX projY] ...]
 * PDF y-origin is at the bottom; we leave it as-is and flip when converting.
 */
function parseRegistrationArray(text: string, startIdx: number): [number, number, number, number][] {
  const gcps: [number, number, number, number][] = []
  let i = startIdx

  // Skip whitespace to opening bracket
  while (i < text.length && /\s/.test(text[i])) i++
  if (text[i] !== '[') return gcps
  i++

  while (i < text.length) {
    // Skip whitespace
    while (i < text.length && /[\s]/.test(text[i])) i++
    if (text[i] === ']') break

    if (text[i] === '[') {
      // Parse inner array: [pdfX pdfY projX projY]
      i++ // skip [
      const nums: number[] = []
      while (i < text.length && text[i] !== ']') {
        const numMatch = text.slice(i).match(/^[\s]*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/)
        if (numMatch) {
          nums.push(parseFloat(numMatch[1]))
          i += numMatch[0].length
        } else {
          i++
        }
      }
      if (nums.length === 4) {
        gcps.push([nums[0], nums[1], nums[2], nums[3]])
      }
      i++ // skip ]
    } else {
      i++
    }
  }

  return gcps
}

/**
 * Parse the CRS from the Projection dictionary inside LGIDict.
 * Returns a proj4 string or EPSG:XXXX string.
 */
function parseCrs(text: string, lgiStart: number): string {
  const projIdx = text.indexOf('/Projection', lgiStart)
  if (projIdx === -1) return 'EPSG:4326'

  const section = text.slice(projIdx, projIdx + 2000)

  // Look for EPSG code
  const epsgMatch = section.match(/\/EPSG\s+(\d+)/) || section.match(/EPSG:(\d+)/)
  if (epsgMatch) return `EPSG:${epsgMatch[1]}`

  // Look for ProjectionType
  const projTypeMatch = section.match(/\/ProjectionType\s+\/(\w+)/)
  const projType = projTypeMatch?.[1] ?? ''

  // Look for datum
  const datumMatch = section.match(/\/Datum\s+\(([^)]+)\)/)
  const datum = datumMatch?.[1] ?? 'WGS84'

  // Look for UTM zone
  const zoneMatch = section.match(/\/Zone\s+(\d+)/) || section.match(/\/ZoneNumber\s+(\d+)/)
  const zone = zoneMatch ? parseInt(zoneMatch[1]) : null

  const northMatch = section.match(/\/Hemisphere\s+\(([NS])\)/) || section.match(/\/Hemisphere\s+\/([NS])/)
  const isNorth = northMatch ? northMatch[1] === 'N' : true

  if (projType === 'UT' || projType === 'UTM') {
    if (zone) {
      // Map well-known datums to EPSG codes
      if (datum.includes('WGS84') || datum.includes('WGS 84')) {
        return isNorth ? `EPSG:${32600 + zone}` : `EPSG:${32700 + zone}`
      }
      if (datum.includes('NAD83')) {
        return isNorth ? `EPSG:${26900 + zone}` : `EPSG:${32100 + zone}`
      }
      if (datum.includes('NAD27')) {
        return isNorth ? `EPSG:${26700 + zone}` : `EPSG:${26800 + zone}`
      }
    }
  }

  if (projType === 'GE' || projType === 'Geographic' || projType === 'LE90') {
    if (datum.includes('WGS84') || datum.includes('WGS 84')) return 'EPSG:4326'
    if (datum.includes('NAD83')) return 'EPSG:4269'
    if (datum.includes('NAD27')) return 'EPSG:4267'
    return 'EPSG:4326'
  }

  return 'EPSG:4326'
}

// ─── XMP geospatial scanner ───────────────────────────────────────────────────

async function extractXmpRegistration(
  pdfDoc: PDFDocumentProxy,
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<MapRegistration | null> {
  try {
    const meta = await pdfDoc.getMetadata()
    const xmpStr: string | null = (meta as { contentDispositionFilename?: string; info?: object; metadata?: { _metadata?: string } }).metadata?._metadata ?? null
    if (!xmpStr) return null

    // Check for Adobe geospatial XMP
    if (!xmpStr.includes('GeoRegistration') && !xmpStr.includes('geo:')) return null

    const gcps = parseXmpGCPs(xmpStr)
    if (gcps.length < 3) return null

    const crs = parseXmpCRS(xmpStr)
    const affine = gcpsToAffine(gcps)
    return { crs, affine, pageWidthPt, pageHeightPt }
  } catch {
    return null
  }
}

function parseXmpGCPs(xmp: string): [number, number, number, number][] {
  const gcps: [number, number, number, number][] = []
  // Match ControlPoint elements
  const cpRegex = /<[^>]*ControlPoint[^>]*>([\s\S]*?)<\/[^>]*ControlPoint>/g
  let m: RegExpExecArray | null
  while ((m = cpRegex.exec(xmp)) !== null) {
    const inner = m[1]
    const x = parseXmlNum(inner, 'x') ?? parseXmlNum(inner, 'PageX')
    const y = parseXmlNum(inner, 'y') ?? parseXmlNum(inner, 'PageY')
    const lon = parseXmlNum(inner, 'Longitude') ?? parseXmlNum(inner, 'longitude')
    const lat = parseXmlNum(inner, 'Latitude') ?? parseXmlNum(inner, 'latitude')
    if (x !== null && y !== null && lon !== null && lat !== null) {
      gcps.push([x, y, lon, lat])
    }
  }
  return gcps
}

function parseXmlNum(xml: string, tag: string): number | null {
  const re = new RegExp(`<[^>]*${tag}[^>]*>([^<]+)<`, 'i')
  const m = re.exec(xml)
  return m ? parseFloat(m[1]) : null
}

function parseXmpCRS(xmp: string): string {
  const epsgMatch = xmp.match(/EPSG:(\d+)/) || xmp.match(/epsg:(\d+)/i)
  if (epsgMatch) return `EPSG:${epsgMatch[1]}`
  return 'EPSG:4326'
}

// ─── Viewport / CTM scanner ───────────────────────────────────────────────────

function scanViewportCTM(
  data: ArrayBuffer,
  pageWidthPt: number,
  pageHeightPt: number,
): MapRegistration | null {
  const bytes = new Uint8Array(data)
  const text = decodeLatin1(bytes, 0, Math.min(bytes.length, 2 * 1024 * 1024))

  // Look for /Viewport with /BBox and /Measure
  const vpIdx = text.indexOf('/Viewport')
  if (vpIdx === -1) return null

  try {
    const section = text.slice(vpIdx, vpIdx + 4000)

    // Check for /Measure with /GPTS (geographic points) and /LPTS (layout points)
    const gptsIdx = section.indexOf('/GPTS')
    const lptsIdx = section.indexOf('/LPTS')
    if (gptsIdx === -1 || lptsIdx === -1) return null

    const gpts = parseNumArray(section, gptsIdx + 5) // lat/lon pairs
    const lpts = parseNumArray(section, lptsIdx + 5) // x/y pairs in [0,1] normalized

    if (gpts.length < 6 || lpts.length < 6) return null

    // Build GCPs: PDF units from normalized lpts, geographic from gpts
    const gcps: [number, number, number, number][] = []
    const count = Math.min(gpts.length / 2, lpts.length / 2)
    for (let i = 0; i < count; i++) {
      const pdfX = lpts[i * 2] * pageWidthPt
      const pdfY = lpts[i * 2 + 1] * pageHeightPt
      const lat = gpts[i * 2]
      const lon = gpts[i * 2 + 1]
      gcps.push([pdfX, pdfY, lon, lat])
    }

    if (gcps.length < 3) return null

    const affine = gcpsToAffine(gcps)
    return { crs: 'EPSG:4326', affine, pageWidthPt, pageHeightPt }
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
    if (m) {
      nums.push(parseFloat(m[1]))
      i += m[0].length
    } else {
      i++
    }
  }
  return nums
}

// ─── Bounds computation ───────────────────────────────────────────────────────

import { applyAffine } from './affine'
import proj4 from 'proj4'

function computeBounds(
  reg: MapRegistration,
  pageWidthPt: number,
  pageHeightPt: number,
): [number, number, number, number] {
  // Sample the four corners of the PDF page
  const corners: [number, number][] = [
    [0, 0],
    [pageWidthPt, 0],
    [pageWidthPt, pageHeightPt],
    [0, pageHeightPt],
  ]

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity

  for (const [x, y] of corners) {
    const [projX, projY] = applyAffine(reg.affine, x, y)
    let lon: number, lat: number
    if (reg.crs === 'EPSG:4326') {
      lon = projX; lat = projY
    } else {
      try {
        ;[lon, lat] = proj4(reg.crs, 'EPSG:4326', [projX, projY])
      } catch {
        continue
      }
    }
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }

  return [minLon, minLat, maxLon, maxLat]
}

// ─── Thumbnail generation ─────────────────────────────────────────────────────

async function renderThumbnail(page: pdfjs.PDFPageProxy): Promise<string> {
  const viewport = page.getViewport({ scale: 1 })
  const targetWidth = 320
  const scale = targetWidth / viewport.width
  const scaledVp = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scaledVp.width)
  canvas.height = Math.round(scaledVp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvasContext: ctx, viewport: scaledVp }).promise
  return canvas.toDataURL('image/jpeg', 0.7)
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodeLatin1(bytes: Uint8Array, start: number, end: number): string {
  let str = ''
  for (let i = start; i < end && i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i])
  }
  return str
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

// ─── PDF page renderer ────────────────────────────────────────────────────────

/**
 * Render a PDF page to a canvas at the given scale.
 * Returns the canvas element.
 */
export async function renderPage(
  page: pdfjs.PDFPageProxy,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const viewport = page.getViewport({ scale })
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#f8f8f0'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
}

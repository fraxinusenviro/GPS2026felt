/**
 * Vector overlay import utilities.
 * Converts GeoJSON, KML/KMZ, Shapefile ZIP, and GPX to GeoJSON FeatureCollection.
 */

import { kml, gpx as toGeoJsonGpx } from '@tmcw/togeojson'
import shpjs from 'shpjs'
import type { VectorOverlay } from '@/types'

export async function importOverlayFile(file: File): Promise<Omit<VectorOverlay, 'id'>> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  let geojson: GeoJSON.FeatureCollection

  switch (ext) {
    case 'geojson':
    case 'json':
      geojson = await parseGeoJson(file)
      break
    case 'kml':
      geojson = await parseKml(file)
      break
    case 'kmz':
      geojson = await parseKmz(file)
      break
    case 'zip':
      geojson = await parseShapefile(file)
      break
    case 'gpx':
      geojson = await parseGpxToGeojson(file)
      break
    default:
      throw new Error(`Unsupported overlay format: .${ext}`)
  }

  return {
    name: file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    importedAt: Date.now(),
    geojson,
    color: randomColor(),
    visible: true,
  }
}

async function parseGeoJson(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await file.text()
  const parsed = JSON.parse(text) as GeoJSON.GeoJSON
  if (parsed.type === 'FeatureCollection') return parsed as GeoJSON.FeatureCollection
  if (parsed.type === 'Feature') {
    return { type: 'FeatureCollection', features: [parsed as GeoJSON.Feature] }
  }
  // Geometry only
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: parsed as GeoJSON.Geometry, properties: {} }],
  }
}

async function parseKml(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await file.text()
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  return kml(doc) as GeoJSON.FeatureCollection
}

async function parseKmz(file: File): Promise<GeoJSON.FeatureCollection> {
  // KMZ is a ZIP containing doc.kml
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const kmlEntry = Object.values(zip.files).find((f: { name: string }) => f.name.endsWith('.kml')) as import('jszip').JSZipObject | undefined
  if (!kmlEntry) throw new Error('No .kml found inside KMZ')
  const text = await kmlEntry.async('text')
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  return kml(doc) as GeoJSON.FeatureCollection
}

async function parseShapefile(file: File): Promise<GeoJSON.FeatureCollection> {
  const buffer = await file.arrayBuffer()
  const result = await shpjs(buffer)
  if (Array.isArray(result)) {
    // Multiple layers – merge all features
    const allFeatures = result.flatMap((fc) => fc.features)
    return { type: 'FeatureCollection', features: allFeatures }
  }
  return result as GeoJSON.FeatureCollection
}

async function parseGpxToGeojson(file: File): Promise<GeoJSON.FeatureCollection> {
  const text = await file.text()
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'application/xml')
  return toGeoJsonGpx(doc) as GeoJSON.FeatureCollection
}

function randomColor(): string {
  const colors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

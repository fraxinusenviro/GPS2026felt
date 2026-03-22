/**
 * Dexie.js database for all persistent client-side storage.
 * Stores: map files (ArrayBuffer), map metadata, waypoints, tracks, overlays.
 */
import Dexie, { type Table } from 'dexie'
import type { ImportedMap, Waypoint, Track, VectorOverlay } from '@/types'

interface MapFile {
  id: string
  data: ArrayBuffer
}

class GeoPdfDb extends Dexie {
  mapFiles!: Table<MapFile>
  maps!: Table<ImportedMap>
  waypoints!: Table<Waypoint>
  tracks!: Table<Track>
  overlays!: Table<VectorOverlay>

  constructor() {
    super('GeoPdfWebViewer')
    this.version(1).stores({
      mapFiles: 'id',
      maps: 'id, name, importedAt',
      waypoints: 'id, name, timestamp',
      tracks: 'id, name, startedAt',
      overlays: 'id, name, importedAt',
    })
  }
}

export const db = new GeoPdfDb()

// ─── Map file helpers ─────────────────────────────────────────────────────────

export async function saveMapFile(id: string, data: ArrayBuffer): Promise<void> {
  await db.mapFiles.put({ id, data })
}

export async function loadMapFile(id: string): Promise<ArrayBuffer | undefined> {
  const record = await db.mapFiles.get(id)
  return record?.data
}

export async function deleteMapFile(id: string): Promise<void> {
  await db.mapFiles.delete(id)
}

// ─── Map metadata helpers ─────────────────────────────────────────────────────

export async function saveMap(map: ImportedMap): Promise<void> {
  await db.maps.put(map)
}

export async function loadAllMaps(): Promise<ImportedMap[]> {
  return db.maps.orderBy('importedAt').reverse().toArray()
}

export async function deleteMap(id: string): Promise<void> {
  await Promise.all([db.maps.delete(id), db.mapFiles.delete(id)])
}

// ─── Waypoint helpers ─────────────────────────────────────────────────────────

export async function saveWaypoint(wp: Waypoint): Promise<void> {
  await db.waypoints.put(wp)
}

export async function loadAllWaypoints(): Promise<Waypoint[]> {
  return db.waypoints.orderBy('timestamp').reverse().toArray()
}

export async function deleteWaypoint(id: string): Promise<void> {
  await db.waypoints.delete(id)
}

// ─── Track helpers ────────────────────────────────────────────────────────────

export async function saveTrack(track: Track): Promise<void> {
  await db.tracks.put(track)
}

export async function loadAllTracks(): Promise<Track[]> {
  return db.tracks.orderBy('startedAt').reverse().toArray()
}

export async function deleteTrack(id: string): Promise<void> {
  await db.tracks.delete(id)
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────

export async function saveOverlay(overlay: VectorOverlay): Promise<void> {
  await db.overlays.put(overlay)
}

export async function loadAllOverlays(): Promise<VectorOverlay[]> {
  return db.overlays.orderBy('importedAt').reverse().toArray()
}

export async function deleteOverlay(id: string): Promise<void> {
  await db.overlays.delete(id)
}

import { create } from 'zustand'
import type { Track, TrackPoint, GpsPosition } from '@/types'
import { saveTrack, loadAllTracks, deleteTrack } from '@/lib/db'
import { haversineDistance } from '@/lib/coordinates'

export type RecordingInterval = 1 | 5 | 10

interface TrackState {
  tracks: Track[]
  isRecording: boolean
  activeTrack: Track | null
  recordingInterval: RecordingInterval
  minDistanceFilter: number // metres

  loadTracks: () => Promise<void>
  startRecording: (name?: string) => void
  stopRecording: () => Promise<Track | null>
  addTrackPoint: (pos: GpsPosition) => void
  deleteTrack: (id: string) => Promise<void>
  setRecordingInterval: (interval: RecordingInterval) => void
  setMinDistanceFilter: (metres: number) => void
}

let lastRecordedPoint: TrackPoint | null = null

export const useTrackStore = create<TrackState>()((set, get) => ({
  tracks: [],
  isRecording: false,
  activeTrack: null,
  recordingInterval: 1,
  minDistanceFilter: 3,

  loadTracks: async () => {
    const tracks = await loadAllTracks()
    set({ tracks })
  },

  startRecording: (name = `Track ${new Date().toLocaleString()}`) => {
    lastRecordedPoint = null
    const activeTrack: Track = {
      id: crypto.randomUUID(),
      name,
      description: '',
      startedAt: Date.now(),
      points: [],
      totalDistance: 0,
      color: '#ef4444',
    }
    set({ isRecording: true, activeTrack })
  },

  addTrackPoint: (pos: GpsPosition) => {
    const state = get()
    if (!state.isRecording || !state.activeTrack) return

    const pt: TrackPoint = {
      lat: pos.lat,
      lon: pos.lon,
      elevation: pos.altitude ?? undefined,
      timestamp: pos.timestamp,
      accuracy: pos.accuracy,
      speed: pos.speed ?? undefined,
      heading: pos.heading ?? undefined,
    }

    // Distance filter
    if (lastRecordedPoint) {
      const dist = haversineDistance(
        lastRecordedPoint.lat, lastRecordedPoint.lon,
        pt.lat, pt.lon,
      )
      if (dist < state.minDistanceFilter) return
    }

    lastRecordedPoint = pt

    const newDist = lastRecordedPoint
      ? haversineDistance(
          state.activeTrack.points[state.activeTrack.points.length - 1]?.lat ?? pt.lat,
          state.activeTrack.points[state.activeTrack.points.length - 1]?.lon ?? pt.lon,
          pt.lat,
          pt.lon,
        )
      : 0

    set((s) => ({
      activeTrack: s.activeTrack
        ? {
            ...s.activeTrack,
            points: [...s.activeTrack.points, pt],
            totalDistance: s.activeTrack.totalDistance + newDist,
          }
        : null,
    }))
  },

  stopRecording: async () => {
    const state = get()
    if (!state.activeTrack) return null

    const finished: Track = {
      ...state.activeTrack,
      endedAt: Date.now(),
    }

    await saveTrack(finished)
    set((s) => ({
      isRecording: false,
      activeTrack: null,
      tracks: [finished, ...s.tracks],
    }))
    lastRecordedPoint = null
    return finished
  },

  deleteTrack: async (id) => {
    await deleteTrack(id)
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }))
  },

  setRecordingInterval: (recordingInterval) => set({ recordingInterval }),
  setMinDistanceFilter: (minDistanceFilter) => set({ minDistanceFilter }),
}))

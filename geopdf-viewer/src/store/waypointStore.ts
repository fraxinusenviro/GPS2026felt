import { create } from 'zustand'
import type { Waypoint, VectorOverlay } from '@/types'
import {
  saveWaypoint,
  loadAllWaypoints,
  deleteWaypoint,
  saveOverlay,
  loadAllOverlays,
  deleteOverlay,
} from '@/lib/db'

interface WaypointState {
  waypoints: Waypoint[]
  overlays: VectorOverlay[]
  editingWaypointId: string | null

  // Waypoint actions
  loadWaypoints: () => Promise<void>
  addWaypoint: (wp: Omit<Waypoint, 'id'>) => Promise<Waypoint>
  updateWaypoint: (id: string, changes: Partial<Waypoint>) => Promise<void>
  removeWaypoint: (id: string) => Promise<void>
  setEditingWaypointId: (id: string | null) => void

  // Overlay actions
  loadOverlays: () => Promise<void>
  addOverlay: (overlay: Omit<VectorOverlay, 'id'>) => Promise<VectorOverlay>
  toggleOverlayVisibility: (id: string) => Promise<void>
  removeOverlay: (id: string) => Promise<void>
}

export const useWaypointStore = create<WaypointState>()((set, get) => ({
  waypoints: [],
  overlays: [],
  editingWaypointId: null,

  loadWaypoints: async () => {
    const waypoints = await loadAllWaypoints()
    set({ waypoints })
  },

  addWaypoint: async (wpData) => {
    const wp: Waypoint = { ...wpData, id: crypto.randomUUID() }
    await saveWaypoint(wp)
    set((state) => ({ waypoints: [wp, ...state.waypoints] }))
    return wp
  },

  updateWaypoint: async (id, changes) => {
    const state = get()
    const existing = state.waypoints.find((w) => w.id === id)
    if (!existing) return
    const updated = { ...existing, ...changes }
    await saveWaypoint(updated)
    set((s) => ({ waypoints: s.waypoints.map((w) => (w.id === id ? updated : w)) }))
  },

  removeWaypoint: async (id) => {
    await deleteWaypoint(id)
    set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) }))
  },

  setEditingWaypointId: (id) => set({ editingWaypointId: id }),

  loadOverlays: async () => {
    const overlays = await loadAllOverlays()
    set({ overlays })
  },

  addOverlay: async (overlayData) => {
    const overlay: VectorOverlay = { ...overlayData, id: crypto.randomUUID() }
    await saveOverlay(overlay)
    set((s) => ({ overlays: [overlay, ...s.overlays] }))
    return overlay
  },

  toggleOverlayVisibility: async (id) => {
    const state = get()
    const existing = state.overlays.find((o) => o.id === id)
    if (!existing) return
    const updated = { ...existing, visible: !existing.visible }
    await saveOverlay(updated)
    set((s) => ({ overlays: s.overlays.map((o) => (o.id === id ? updated : o)) }))
  },

  removeOverlay: async (id) => {
    await deleteOverlay(id)
    set((s) => ({ overlays: s.overlays.filter((o) => o.id !== id) }))
  },
}))

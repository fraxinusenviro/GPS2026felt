import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { ImportedMap, ViewTransform, CoordFormat } from '@/types'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadAllMaps } from '@/lib/db'

interface MapState {
  // Library
  maps: ImportedMap[]
  activeMapId: string | null

  // Runtime (not persisted)
  activePdfDoc: PDFDocumentProxy | null

  // View
  viewTransform: ViewTransform
  coordFormat: CoordFormat
  northUpLocked: boolean
  followGps: boolean

  // Actions
  setMaps: (maps: ImportedMap[]) => void
  addMap: (map: ImportedMap) => void
  removeMap: (id: string) => void
  setActiveMapId: (id: string | null) => void
  setActivePdfDoc: (doc: PDFDocumentProxy | null) => void
  setViewTransform: (vt: Partial<ViewTransform>) => void
  resetView: () => void
  setCoordFormat: (f: CoordFormat) => void
  setNorthUpLocked: (v: boolean) => void
  setFollowGps: (v: boolean) => void
  loadMapsFromDb: () => Promise<void>
}

const DEFAULT_VIEW: ViewTransform = { scale: 1, panX: 0, panY: 0, rotation: 0 }

// Custom idb-keyval storage adapter for Zustand persist
const idbStorage = {
  getItem: async (key: string) => {
    const val = await idbGet(key)
    return val ?? null
  },
  setItem: async (key: string, value: string) => {
    await idbSet(key, value)
  },
  removeItem: async (key: string) => {
    await idbDel(key)
  },
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      maps: [],
      activeMapId: null,
      activePdfDoc: null,
      viewTransform: DEFAULT_VIEW,
      coordFormat: 'DD',
      northUpLocked: false,
      followGps: true,

      setMaps: (maps) => set({ maps }),

      addMap: (map) =>
        set((state) => ({
          maps: [map, ...state.maps.filter((m) => m.id !== map.id)],
        })),

      removeMap: (id) =>
        set((state) => ({
          maps: state.maps.filter((m) => m.id !== id),
          activeMapId: state.activeMapId === id ? null : state.activeMapId,
        })),

      setActiveMapId: (id) => set({ activeMapId: id, viewTransform: DEFAULT_VIEW }),

      setActivePdfDoc: (doc) => set({ activePdfDoc: doc }),

      setViewTransform: (vt) =>
        set((state) => ({ viewTransform: { ...state.viewTransform, ...vt } })),

      resetView: () => set({ viewTransform: DEFAULT_VIEW }),

      setCoordFormat: (coordFormat) => set({ coordFormat }),

      setNorthUpLocked: (northUpLocked) => set({ northUpLocked }),

      setFollowGps: (followGps) => set({ followGps }),

      loadMapsFromDb: async () => {
        const maps = await loadAllMaps()
        set({ maps })
      },
    }),
    {
      name: 'geopdf-map-store',
      storage: createJSONStorage(() => idbStorage as unknown as Storage),
      partialize: (state) => ({
        activeMapId: state.activeMapId,
        coordFormat: state.coordFormat,
        northUpLocked: state.northUpLocked,
        // Don't persist: maps (loaded from db), activePdfDoc, viewTransform
      }),
    },
  ),
)

export const activeMapSelector = (state: MapState): ImportedMap | null =>
  state.maps.find((m) => m.id === state.activeMapId) ?? null

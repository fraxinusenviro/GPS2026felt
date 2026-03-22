import { create } from 'zustand'

export type ActivePanel = 'maps' | 'waypoints' | 'tracks' | 'overlays' | null
export type ActiveSheet = 'waypoint-editor' | 'import-map' | 'settings' | 'track-name' | null

interface UiState {
  drawerOpen: boolean
  activePanel: ActivePanel
  activeSheet: ActiveSheet
  sheetData: Record<string, unknown>
  searchQuery: string
  cursorLatLon: { lat: number; lon: number } | null
  gpsStatus: 'off' | 'requesting' | 'active' | 'error'
  gpsError: string | null

  setDrawerOpen: (open: boolean) => void
  toggleDrawer: () => void
  setActivePanel: (panel: ActivePanel) => void
  openSheet: (sheet: ActiveSheet, data?: Record<string, unknown>) => void
  closeSheet: () => void
  setSearchQuery: (q: string) => void
  setCursorLatLon: (pos: { lat: number; lon: number } | null) => void
  setGpsStatus: (status: 'off' | 'requesting' | 'active' | 'error', error?: string) => void
}

export const useUiStore = create<UiState>()((set) => ({
  drawerOpen: false,
  activePanel: 'maps',
  activeSheet: null,
  sheetData: {},
  searchQuery: '',
  cursorLatLon: null,
  gpsStatus: 'off',
  gpsError: null,

  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  setActivePanel: (activePanel) => set({ activePanel, drawerOpen: true }),
  openSheet: (activeSheet, sheetData = {}) => set({ activeSheet, sheetData }),
  closeSheet: () => set({ activeSheet: null, sheetData: {} }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCursorLatLon: (cursorLatLon) => set({ cursorLatLon }),
  setGpsStatus: (gpsStatus, error) =>
    set({ gpsStatus, gpsError: error ?? null }),
}))

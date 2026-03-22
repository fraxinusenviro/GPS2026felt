import React, { Suspense, useEffect } from 'react'
import { TopBar } from '@/components/TopBar'
import { BottomBar } from '@/components/BottomBar'
import { RightToolbar } from '@/components/RightToolbar'
import { LeftDrawer } from '@/components/LeftDrawer'
import { WaypointEditorSheet } from '@/components/WaypointEditorSheet'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useUiStore } from '@/store/uiStore'
import { useMapStore } from '@/store/mapStore'
import { useWaypointStore } from '@/store/waypointStore'
import { useTrackStore } from '@/store/trackStore'

// Lazy-loaded: both transitively import pdfjs-dist (~650 KB).
// Splitting them keeps the main bundle ~130 KB so iOS Safari can parse it.
const MapViewer = React.lazy(() =>
  import('@/components/MapViewer').then((m) => ({ default: m.MapViewer })),
)
const ImportMapSheet = React.lazy(() =>
  import('@/components/ImportMapSheet').then((m) => ({ default: m.ImportMapSheet })),
)

const MapViewerFallback: React.FC = () => (
  <div className="w-full h-full flex items-center justify-center bg-slate-900">
    <div className="text-center">
      <div className="w-12 h-12 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
      <p className="text-blue-300 text-sm">Loading map viewer…</p>
    </div>
  </div>
)

export const App: React.FC = () => {
  const activeSheet = useUiStore((s) => s.activeSheet)
  const loadMapsFromDb = useMapStore((s) => s.loadMapsFromDb)
  const loadWaypoints = useWaypointStore((s) => s.loadWaypoints)
  const loadOverlays = useWaypointStore((s) => s.loadOverlays)
  const loadTracks = useTrackStore((s) => s.loadTracks)

  // Bootstrap data from IndexedDB on first load
  useEffect(() => {
    loadMapsFromDb()
    loadWaypoints()
    loadOverlays()
    loadTracks()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 overflow-hidden">
      <TopBar />

      <div className="flex flex-1 overflow-hidden relative min-h-0">
        <LeftDrawer />
        <div className="flex-1 relative overflow-hidden min-w-0">
          {/* ErrorBoundary outside Suspense so chunk-load failures show error UI */}
          <ErrorBoundary>
            <Suspense fallback={<MapViewerFallback />}>
              <MapViewer />
            </Suspense>
          </ErrorBoundary>
          <RightToolbar />
        </div>
      </div>

      <BottomBar />

      {activeSheet === 'import-map' && (
        <Suspense fallback={null}>
          <ImportMapSheet />
        </Suspense>
      )}
      {activeSheet === 'waypoint-editor' && <WaypointEditorSheet />}
    </div>
  )
}

import React from 'react'
import { X, Map, MapPin, Route, Layers } from 'lucide-react'
import { useUiStore, type ActivePanel } from '@/store/uiStore'
import { useWaypointStore } from '@/store/waypointStore'
import { useTrackStore } from '@/store/trackStore'
import { MapLibrary } from './MapLibrary'
import { WaypointList } from './WaypointList'
import { TrackList } from './TrackList'
import { OverlayList } from './OverlayList'
import { cn } from '@/lib/utils'

const TABS: { id: ActivePanel; label: string; icon: React.ReactNode }[] = [
  { id: 'maps', label: 'Maps', icon: <Map size={15} /> },
  { id: 'waypoints', label: 'Points', icon: <MapPin size={15} /> },
  { id: 'tracks', label: 'Tracks', icon: <Route size={15} /> },
  { id: 'overlays', label: 'Layers', icon: <Layers size={15} /> },
]

export const LeftDrawer: React.FC = () => {
  const drawerOpen = useUiStore((s) => s.drawerOpen)
  const setDrawerOpen = useUiStore((s) => s.setDrawerOpen)
  const activePanel = useUiStore((s) => s.activePanel)
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  const waypointCount = useWaypointStore((s) => s.waypoints.length)
  const trackCount = useTrackStore((s) => s.tracks.length)
  const overlayCount = useWaypointStore((s) => s.overlays.length)

  const counts: Partial<Record<NonNullable<ActivePanel>, number>> = {
    waypoints: waypointCount,
    tracks: trackCount,
    overlays: overlayCount,
  }

  return (
    <>
      {/* Backdrop (mobile) */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          'w-72 bg-slate-900 border-r border-slate-700/50 flex flex-col z-30',
          'transition-all duration-200 ease-in-out shrink-0',
          // Mobile: fixed overlay
          'fixed left-0 top-12 bottom-10 lg:static lg:top-auto lg:bottom-auto',
          // Show/hide via transform on mobile; on desktop show/hide via width
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          !drawerOpen && 'lg:w-0 lg:border-r-0 lg:overflow-hidden',
        )}
        aria-label="Map library and data"
      >
        {/* Tabs */}
        <div className="flex border-b border-slate-700/50 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActivePanel(tab.id)}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors relative',
                activePanel === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-slate-400 hover:text-slate-200',
              )}
              aria-selected={activePanel === tab.id}
              role="tab"
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.id && counts[tab.id] !== undefined && counts[tab.id]! > 0 && (
                <span className="absolute top-1 right-2 bg-blue-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">
                  {counts[tab.id]! > 9 ? '9+' : counts[tab.id]}
                </span>
              )}
            </button>
          ))}
          {/* Close button */}
          <button
            onClick={() => setDrawerOpen(false)}
            className="px-3 text-slate-400 hover:text-white transition-colors lg:hidden"
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {activePanel === 'maps' && <MapLibrary />}
          {activePanel === 'waypoints' && <WaypointList />}
          {activePanel === 'tracks' && <TrackList />}
          {activePanel === 'overlays' && <OverlayList />}
        </div>
      </aside>
    </>
  )
}

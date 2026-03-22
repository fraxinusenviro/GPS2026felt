import React from 'react'
import {
  ZoomIn, ZoomOut, Compass, Navigation, Layers, LocateFixed,
  Circle, Play, Square, MapPin,
} from 'lucide-react'
import { useMapStore } from '@/store/mapStore'
import { useTrackStore } from '@/store/trackStore'
import { useUiStore } from '@/store/uiStore'
import { useGps } from '@/hooks/useGps'
import { cn } from '@/lib/utils'

export const RightToolbar: React.FC = () => {
  const { scale, rotation } = useMapStore((s) => s.viewTransform)
  const setViewTransform = useMapStore((s) => s.setViewTransform)
  const northUpLocked = useMapStore((s) => s.northUpLocked)
  const setNorthUpLocked = useMapStore((s) => s.setNorthUpLocked)
  const followGps = useMapStore((s) => s.followGps)
  const setFollowGps = useMapStore((s) => s.setFollowGps)

  const isRecording = useTrackStore((s) => s.isRecording)
  const startRecording = useTrackStore((s) => s.startRecording)
  const stopRecording = useTrackStore((s) => s.stopRecording)

  const gpsStatus = useUiStore((s) => s.gpsStatus)
  const setActivePanel = useUiStore((s) => s.setActivePanel)
  const openSheet = useUiStore((s) => s.openSheet)
  const { startGps } = useGps()

  const zoom = (factor: number) => {
    const newScale = Math.max(0.05, Math.min(32, scale * factor))
    setViewTransform({ scale: newScale })
  }

  const resetNorth = () => {
    setViewTransform({ rotation: 0 })
  }

  const handleGpsToggle = () => {
    if (gpsStatus === 'off' || gpsStatus === 'error') {
      startGps()
    }
    setFollowGps(!followGps)
  }

  const handleTrackToggle = async () => {
    if (isRecording) {
      const track = await stopRecording()
      if (track) openSheet('track-name', { trackId: track.id })
    } else {
      startRecording()
    }
  }

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2">
      <ToolbarGroup>
        {/* Zoom in */}
        <ToolbarButton onClick={() => zoom(1.4)} label="Zoom in" icon={<ZoomIn size={18} />} />
        {/* Scale indicator */}
        <div className="flex items-center justify-center h-8 text-xs text-slate-400 font-mono">
          {scale < 1 ? `1:${Math.round(1 / scale)}` : `${scale.toFixed(1)}×`}
        </div>
        {/* Zoom out */}
        <ToolbarButton onClick={() => zoom(1 / 1.4)} label="Zoom out" icon={<ZoomOut size={18} />} />
      </ToolbarGroup>

      <ToolbarGroup>
        {/* Compass / north reset */}
        <ToolbarButton
          onClick={resetNorth}
          label="Reset north"
          icon={
            <div style={{ transform: `rotate(${-rotation}deg)`, transition: 'transform 0.3s' }}>
              <Compass size={18} />
            </div>
          }
        />
        {/* North-up lock */}
        <ToolbarButton
          onClick={() => setNorthUpLocked(!northUpLocked)}
          label={northUpLocked ? 'Unlock rotation' : 'Lock north-up'}
          active={northUpLocked}
          icon={<span className="text-xs font-bold">N</span>}
        />
      </ToolbarGroup>

      <ToolbarGroup>
        {/* GPS follow */}
        <ToolbarButton
          onClick={handleGpsToggle}
          label={followGps ? 'Disable GPS follow' : 'Enable GPS follow'}
          active={followGps && gpsStatus === 'active'}
          pending={gpsStatus === 'requesting'}
          icon={
            gpsStatus === 'active'
              ? <Navigation size={18} />
              : <LocateFixed size={18} />
          }
        />
      </ToolbarGroup>

      <ToolbarGroup>
        {/* Track recording */}
        <ToolbarButton
          onClick={handleTrackToggle}
          label={isRecording ? 'Stop recording' : 'Start track recording'}
          active={isRecording}
          danger={isRecording}
          icon={isRecording ? <Square size={18} /> : <Play size={18} />}
        />
        {/* Drop waypoint */}
        <ToolbarButton
          onClick={() => openSheet('waypoint-editor', {})}
          label="Drop waypoint at GPS"
          icon={<MapPin size={18} />}
        />
      </ToolbarGroup>

      <ToolbarGroup>
        {/* Layer switcher */}
        <ToolbarButton
          onClick={() => setActivePanel('overlays')}
          label="Layers"
          icon={<Layers size={18} />}
        />
      </ToolbarGroup>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center justify-center gap-1.5 bg-red-600/90 rounded-lg px-2 py-1">
          <Circle size={8} className="text-red-200 fill-red-200 animate-pulse" />
          <span className="text-xs text-red-100 font-medium">REC</span>
        </div>
      )}
    </div>
  )
}

const ToolbarGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="bg-slate-900/90 backdrop-blur-sm border border-slate-700/50 rounded-xl overflow-hidden flex flex-col divide-y divide-slate-700/50 shadow-lg">
    {children}
  </div>
)

const ToolbarButton: React.FC<{
  onClick: () => void
  label: string
  icon: React.ReactNode
  active?: boolean
  pending?: boolean
  danger?: boolean
}> = ({ onClick, label, icon, active, pending, danger }) => (
  <button
    onClick={onClick}
    title={label}
    aria-label={label}
    className={cn(
      'flex items-center justify-center w-10 h-10 transition-colors',
      active && !danger && 'text-blue-400 bg-blue-500/20',
      danger && 'text-red-400 bg-red-500/20',
      pending && 'text-yellow-400',
      !active && !pending && !danger && 'text-slate-300 hover:text-white hover:bg-slate-700/60',
    )}
  >
    {icon}
  </button>
)

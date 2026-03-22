import React from 'react'
import { Route, Trash2, Download } from 'lucide-react'
import { useTrackStore } from '@/store/trackStore'
import { exportTrackGpx, exportTrackGeoJson, downloadBlob } from '@/lib/gpx'
import { formatDistance } from '@/lib/coordinates'
import type { Track } from '@/types'

export const TrackList: React.FC = () => {
  const tracks = useTrackStore((s) => s.tracks)
  const removeTrack = useTrackStore((s) => s.deleteTrack)
  const activeTrack = useTrackStore((s) => s.activeTrack)

  const handleDelete = async (e: React.MouseEvent, track: Track) => {
    e.stopPropagation()
    if (!confirm(`Delete track "${track.name}"?`)) return
    await removeTrack(track.id)
  }

  const handleExport = (e: React.MouseEvent, track: Track, format: 'gpx' | 'geojson') => {
    e.stopPropagation()
    const safeName = track.name.replace(/[^a-z0-9]/gi, '-')
    if (format === 'gpx') {
      downloadBlob(exportTrackGpx(track), `${safeName}.gpx`, 'application/gpx+xml')
    } else {
      downloadBlob(exportTrackGeoJson(track), `${safeName}.geojson`, 'application/geo+json')
    }
  }

  const formatDuration = (startedAt: number, endedAt?: number): string => {
    const ms = (endedAt ?? Date.now()) - startedAt
    const minutes = Math.floor(ms / 60000)
    if (minutes < 60) return `${minutes} min`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  if (tracks.length === 0 && !activeTrack) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
        <Route size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium text-slate-400">No tracks recorded</p>
        <p className="text-xs mt-1">Use the track button to start recording your path.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {/* Active track */}
      {activeTrack && (
        <div className="flex items-center gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg mb-1">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-red-200 font-medium truncate">{activeTrack.name}</p>
            <p className="text-[10px] text-red-400">
              {activeTrack.points.length} pts · {formatDistance(activeTrack.totalDistance)}
            </p>
          </div>
          <span className="text-[10px] text-red-400 font-mono">REC</span>
        </div>
      )}

      {/* Saved tracks */}
      {tracks.map((track) => (
        <div
          key={track.id}
          className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg group"
        >
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ background: track.color }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-200 font-medium truncate">{track.name}</p>
            <p className="text-[10px] text-slate-500">
              {formatDistance(track.totalDistance)} · {formatDuration(track.startedAt, track.endedAt)} · {track.points.length} pts
            </p>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => handleExport(e, track, 'gpx')}
              title="Export as GPX"
              className="p-1 text-slate-400 hover:text-blue-400 transition-colors"
            >
              <Download size={13} />
            </button>
            <button
              onClick={(e) => handleDelete(e, track)}
              title="Delete track"
              className="p-1 text-slate-400 hover:text-red-400 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

import React from 'react'
import { MapPin, Trash2, Download } from 'lucide-react'
import { useWaypointStore } from '@/store/waypointStore'
import { useUiStore } from '@/store/uiStore'
import { exportWaypointsGpx, exportWaypointsGeoJson, exportWaypointsCsv, downloadBlob } from '@/lib/gpx'
import type { Waypoint } from '@/types'

export const WaypointList: React.FC = () => {
  const waypoints = useWaypointStore((s) => s.waypoints)
  const removeWaypoint = useWaypointStore((s) => s.removeWaypoint)
  const setEditingWaypointId = useWaypointStore((s) => s.setEditingWaypointId)
  const openSheet = useUiStore((s) => s.openSheet)

  const handleEdit = (wp: Waypoint) => {
    setEditingWaypointId(wp.id)
    openSheet('waypoint-editor', { waypointId: wp.id })
  }

  const handleDelete = async (e: React.MouseEvent, wp: Waypoint) => {
    e.stopPropagation()
    if (!confirm(`Delete waypoint "${wp.name}"?`)) return
    await removeWaypoint(wp.id)
  }

  const handleExportAll = (format: 'gpx' | 'geojson' | 'csv') => {
    if (waypoints.length === 0) return
    const name = `waypoints-${Date.now()}`
    if (format === 'gpx') {
      downloadBlob(exportWaypointsGpx(waypoints), `${name}.gpx`, 'application/gpx+xml')
    } else if (format === 'geojson') {
      downloadBlob(exportWaypointsGeoJson(waypoints), `${name}.geojson`, 'application/geo+json')
    } else {
      downloadBlob(exportWaypointsCsv(waypoints), `${name}.csv`, 'text/csv')
    }
  }

  if (waypoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
        <MapPin size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium text-slate-400">No waypoints</p>
        <p className="text-xs mt-1">Right-click on the map to drop a waypoint.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Export bar */}
      <div className="flex items-center gap-2 p-2 border-b border-slate-700/50">
        <span className="text-xs text-slate-400 flex-1">{waypoints.length} waypoints</span>
        <div className="flex gap-1">
          {(['gpx', 'geojson', 'csv'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => handleExportAll(fmt)}
              className="text-[10px] px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors uppercase font-mono"
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {waypoints.map((wp) => (
          <div
            key={wp.id}
            className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-800/60 cursor-pointer border-b border-slate-700/30 group transition-colors"
            onClick={() => handleEdit(wp)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleEdit(wp)}
          >
            <div
              className="w-5 h-5 rounded-full shrink-0 border-2 border-white/30"
              style={{ background: wp.color }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-200 truncate font-medium">{wp.name}</p>
              <p className="text-[10px] text-slate-500">
                {wp.lat.toFixed(5)}, {wp.lon.toFixed(5)}
              </p>
            </div>
            <button
              onClick={(e) => handleDelete(e, wp)}
              className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
              aria-label={`Delete ${wp.name}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

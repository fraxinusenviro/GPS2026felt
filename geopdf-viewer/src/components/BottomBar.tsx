import React, { useCallback } from 'react'
import { ChevronDown, Crosshair, Signal, SignalZero, AlertCircle } from 'lucide-react'
import { useMapStore } from '@/store/mapStore'
import { useUiStore } from '@/store/uiStore'
import { formatCoordinate } from '@/lib/coordinates'
import type { CoordFormat } from '@/types'

const FORMATS: CoordFormat[] = ['DD', 'DMS', 'DDM', 'UTM', 'MGRS']

export const BottomBar: React.FC = () => {
  const coordFormat = useMapStore((s) => s.coordFormat)
  const setCoordFormat = useMapStore((s) => s.setCoordFormat)
  const viewTransform = useMapStore((s) => s.viewTransform)

  const cursorLatLon = useUiStore((s) => s.cursorLatLon)
  const gpsStatus = useUiStore((s) => s.gpsStatus)
  const gpsError = useUiStore((s) => s.gpsError)

  const cycleFormat = useCallback(() => {
    const idx = FORMATS.indexOf(coordFormat)
    setCoordFormat(FORMATS[(idx + 1) % FORMATS.length])
  }, [coordFormat, setCoordFormat])

  const coordStr = cursorLatLon
    ? formatCoordinate(cursorLatLon.lat, cursorLatLon.lon, coordFormat)
    : '—'

  // Approximate scale bar
  const scaleBarMetres = getScaleBarMetres(viewTransform.scale)

  return (
    <div className="h-10 bg-slate-900/95 backdrop-blur-sm border-t border-slate-700/50 flex items-center gap-3 px-3 shrink-0 z-40">
      {/* Coordinate display */}
      <button
        onClick={cycleFormat}
        className="flex items-center gap-1.5 text-xs font-mono text-slate-200 hover:text-white transition-colors group"
        title={`Format: ${coordFormat} (click to cycle)`}
        aria-label={`Coordinates: ${coordStr}. Format: ${coordFormat}. Click to cycle format.`}
      >
        <Crosshair size={13} className="text-blue-400 shrink-0" />
        <span className="whitespace-nowrap">{coordStr}</span>
        <span className="text-slate-500 text-[10px] group-hover:text-slate-400">({coordFormat})</span>
        <ChevronDown size={11} className="text-slate-500 group-hover:text-slate-300" />
      </button>

      <div className="flex-1" />

      {/* Scale bar */}
      <ScaleBar metres={scaleBarMetres} />

      {/* GPS status indicator */}
      <GpsIndicator status={gpsStatus} error={gpsError} />
    </div>
  )
}

// ─── Scale bar ────────────────────────────────────────────────────────────────

function getScaleBarMetres(displayScale: number): number {
  // Approximate: 1 PDF point ≈ 0.353 mm at 1:1
  // Assume typical USGS topo scale of ~1:24000
  const metersPerPoint = 0.353e-3 * 24000
  const viewWidthPx = 200
  const metersVisible = (viewWidthPx / displayScale) * metersPerPoint
  // Round to nice value
  const targets = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 25000, 50000]
  return targets.reduce((a, b) =>
    Math.abs(b - metersVisible / 4) < Math.abs(a - metersVisible / 4) ? b : a,
  )
}

const ScaleBar: React.FC<{ metres: number }> = ({ metres }) => {
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
  return (
    <div className="hidden sm:flex items-end gap-1 text-xs text-slate-400" aria-label={`Scale: ${label}`}>
      <div className="flex flex-col items-start gap-0.5">
        <div className="text-[10px] text-slate-500">{label}</div>
        <div className="h-2 w-16 border-l border-r border-b border-slate-400" />
      </div>
    </div>
  )
}

// ─── GPS indicator ────────────────────────────────────────────────────────────

const GpsIndicator: React.FC<{
  status: 'off' | 'requesting' | 'active' | 'error'
  error: string | null
}> = ({ status, error }) => {
  const icons = {
    off: <SignalZero size={14} className="text-slate-500" />,
    requesting: <Signal size={14} className="text-yellow-400 animate-pulse" />,
    active: <Signal size={14} className="text-green-400" />,
    error: <AlertCircle size={14} className="text-red-400" />,
  }

  const labels = {
    off: 'GPS off',
    requesting: 'Acquiring GPS…',
    active: 'GPS active',
    error: `GPS error: ${error}`,
  }

  return (
    <div
      className="flex items-center gap-1 text-xs text-slate-400"
      title={labels[status]}
      aria-label={labels[status]}
    >
      {icons[status]}
      <span className="hidden md:inline text-[11px]">{labels[status]}</span>
    </div>
  )
}

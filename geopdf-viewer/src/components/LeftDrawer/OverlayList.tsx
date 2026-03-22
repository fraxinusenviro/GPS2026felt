import React, { useRef } from 'react'
import { Layers, Eye, EyeOff, Trash2, Upload } from 'lucide-react'
import { useWaypointStore } from '@/store/waypointStore'
import { importOverlayFile } from '@/lib/overlay'
import type { VectorOverlay } from '@/types'

export const OverlayList: React.FC = () => {
  const overlays = useWaypointStore((s) => s.overlays)
  const addOverlay = useWaypointStore((s) => s.addOverlay)
  const toggleOverlayVisibility = useWaypointStore((s) => s.toggleOverlayVisibility)
  const removeOverlay = useWaypointStore((s) => s.removeOverlay)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportError(null)
    try {
      const overlay = await importOverlayFile(file)
      await addOverlay(overlay)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (e: React.MouseEvent, overlay: VectorOverlay) => {
    e.stopPropagation()
    if (!confirm(`Remove overlay "${overlay.name}"?`)) return
    await removeOverlay(overlay.id)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Import button */}
      <div className="p-2 border-b border-slate-700/50">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-300 border border-dashed border-slate-600 hover:border-blue-500 hover:text-blue-400 rounded-lg transition-colors disabled:opacity-50"
        >
          <Upload size={15} />
          {importing ? 'Importing…' : 'Import GeoJSON / KML / Shapefile'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".geojson,.json,.kml,.kmz,.zip,.gpx"
          className="hidden"
          onChange={handleImport}
        />
        {importError && (
          <p className="text-xs text-red-400 mt-1 px-1">{importError}</p>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {overlays.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
            <Layers size={28} className="mb-3 opacity-40" />
            <p className="text-sm text-slate-400">No overlays imported</p>
            <p className="text-xs mt-1">Import GeoJSON, KML, KMZ, or Shapefiles.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-2">
            {overlays.map((overlay) => (
              <div
                key={overlay.id}
                className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-800/50 border border-slate-700/50 rounded-lg group"
              >
                <div
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ background: overlay.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200 truncate">{overlay.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {overlay.geojson.features.length} features · {overlay.fileName}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleOverlayVisibility(overlay.id)}
                    title={overlay.visible ? 'Hide' : 'Show'}
                    className="p-1 text-slate-400 hover:text-white transition-colors"
                  >
                    {overlay.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, overlay)}
                    className="p-1 text-slate-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

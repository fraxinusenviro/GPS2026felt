import React, { useRef } from 'react'
import { Trash2, MapPin, Info } from 'lucide-react'
import { useMapStore, activeMapSelector } from '@/store/mapStore'
import { deleteMap as dbDeleteMap } from '@/lib/db'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import type { ImportedMap } from '@/types'

export const MapLibrary: React.FC = () => {
  const maps = useMapStore((s) => s.maps)
  const activeMapId = useMapStore((s) => s.activeMapId)
  const setActiveMapId = useMapStore((s) => s.setActiveMapId)
  const removeMap = useMapStore((s) => s.removeMap)
  const openSheet = useUiStore((s) => s.openSheet)

  const handleSelect = (id: string) => {
    setActiveMapId(activeMapId === id ? null : id)
  }

  const handleDelete = async (e: React.MouseEvent, map: ImportedMap) => {
    e.stopPropagation()
    if (!confirm(`Delete "${map.name}"? This cannot be undone.`)) return
    await dbDeleteMap(map.id)
    removeMap(map.id)
  }

  if (maps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 p-6 text-center">
        <MapPin size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium text-slate-400">No maps imported</p>
        <p className="text-xs mt-1 mb-4">Import a GeoPDF to get started.</p>
        <button
          onClick={() => openSheet('import-map')}
          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          Import Map
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {maps.map((map) => (
        <MapCard
          key={map.id}
          map={map}
          isActive={map.id === activeMapId}
          onSelect={() => handleSelect(map.id)}
          onDelete={(e) => handleDelete(e, map)}
        />
      ))}
    </div>
  )
}

const MapCard: React.FC<{
  map: ImportedMap
  isActive: boolean
  onSelect: () => void
  onDelete: (e: React.MouseEvent) => void
}> = ({ map, isActive, onSelect, onDelete }) => {
  const fileSize = formatFileSize(map.fileSize)
  const crs = map.registration?.crs ?? 'Unknown CRS'
  const importDate = new Date(map.importedAt).toLocaleDateString()

  return (
    <div
      className={cn(
        'rounded-xl border transition-all cursor-pointer group',
        isActive
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-slate-700 hover:border-slate-500 bg-slate-800/50',
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
    >
      {/* Thumbnail */}
      {map.thumbnailDataUrl ? (
        <div className="rounded-t-xl overflow-hidden bg-slate-700 h-28">
          <img
            src={map.thumbnailDataUrl}
            alt={`${map.name} thumbnail`}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="rounded-t-xl bg-slate-700 h-28 flex items-center justify-center text-slate-500">
          <MapPin size={24} />
        </div>
      )}

      {/* Info */}
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100 truncate">{map.name}</p>
            <p className="text-xs text-slate-400 truncate mt-0.5">{crs}</p>
          </div>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-slate-500 transition-all shrink-0"
            aria-label={`Delete ${map.name}`}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-slate-500">
          <span>{fileSize}</span>
          <span>·</span>
          <span>{map.numPages} page{map.numPages !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{importDate}</span>
        </div>
        {!map.registration && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-500">
            <Info size={10} />
            No geospatial data
          </div>
        )}
      </div>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

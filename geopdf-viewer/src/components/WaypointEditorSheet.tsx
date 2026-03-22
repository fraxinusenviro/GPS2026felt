/**
 * Bottom sheet for editing waypoint properties.
 */

import React, { useState, useEffect } from 'react'
import { X, Save, MapPin, Trash2 } from 'lucide-react'
import { useWaypointStore } from '@/store/waypointStore'
import { useUiStore } from '@/store/uiStore'
import { exportWaypointsGpx, downloadBlob } from '@/lib/gpx'
import type { Waypoint, WaypointIcon } from '@/types'
import { cn } from '@/lib/utils'

const ICON_OPTIONS: { id: WaypointIcon; label: string }[] = [
  { id: 'pin', label: '📍' },
  { id: 'circle', label: '⭕' },
  { id: 'star', label: '⭐' },
  { id: 'flag', label: '🚩' },
  { id: 'warning', label: '⚠️' },
  { id: 'camera', label: '📷' },
  { id: 'sample', label: '🧪' },
]

const COLOR_OPTIONS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
]

export const WaypointEditorSheet: React.FC = () => {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const sheetData = useUiStore((s) => s.sheetData)
  const waypointId = sheetData.waypointId as string | undefined

  const waypoints = useWaypointStore((s) => s.waypoints)
  const updateWaypoint = useWaypointStore((s) => s.updateWaypoint)
  const removeWaypoint = useWaypointStore((s) => s.removeWaypoint)
  const addWaypoint = useWaypointStore((s) => s.addWaypoint)
  const gpsStatus = useUiStore((s) => s.gpsStatus)

  const existing = waypoints.find((w) => w.id === waypointId)

  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [icon, setIcon] = useState<WaypointIcon>(existing?.icon ?? 'pin')
  const [color, setColor] = useState(existing?.color ?? '#3b82f6')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setDescription(existing.description)
      setIcon(existing.icon)
      setColor(existing.color)
    }
  }, [existing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!name.trim()) return
    setIsSaving(true)
    try {
      if (existing) {
        await updateWaypoint(existing.id, { name: name.trim(), description, icon, color })
      }
      closeSheet()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!existing) return
    if (!confirm(`Delete waypoint "${existing.name}"?`)) return
    await removeWaypoint(existing.id)
    closeSheet()
  }

  const handleExport = () => {
    if (!existing) return
    downloadBlob(exportWaypointsGpx([existing]), `${existing.name}.gpx`, 'application/gpx+xml')
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 z-50"
        onClick={closeSheet}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit Waypoint"
        className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-4 pb-8 md:max-w-lg md:mx-auto md:rounded-2xl md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:border"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-blue-400" />
            <h2 className="text-base font-semibold text-slate-100">
              {existing ? 'Edit Waypoint' : 'New Waypoint'}
            </h2>
          </div>
          <button onClick={closeSheet} className="p-1 text-slate-400 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Coordinates (read-only) */}
        {existing && (
          <div className="mb-3 text-xs font-mono text-slate-400 bg-slate-800 px-3 py-2 rounded-lg">
            {existing.lat.toFixed(6)}, {existing.lon.toFixed(6)}
            {existing.elevation !== undefined && ` · ${existing.elevation.toFixed(0)} m`}
          </div>
        )}

        {/* Name input */}
        <div className="mb-3">
          <label className="text-xs text-slate-400 mb-1 block">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Waypoint name"
            className="w-full bg-slate-800 border border-slate-600 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none transition-colors"
            autoFocus
            aria-label="Waypoint name"
          />
        </div>

        {/* Description */}
        <div className="mb-3">
          <label className="text-xs text-slate-400 mb-1 block">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional notes…"
            rows={2}
            className="w-full bg-slate-800 border border-slate-600 focus:border-blue-500 rounded-lg px-3 py-2 text-sm text-slate-100 outline-none transition-colors resize-none"
            aria-label="Waypoint description"
          />
        </div>

        {/* Icon picker */}
        <div className="mb-3">
          <label className="text-xs text-slate-400 mb-1.5 block">Icon</label>
          <div className="flex gap-2">
            {ICON_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setIcon(opt.id)}
                className={cn(
                  'w-10 h-10 rounded-lg text-lg flex items-center justify-center transition-colors border',
                  icon === opt.id ? 'border-blue-500 bg-blue-500/20' : 'border-slate-600 hover:border-slate-400 bg-slate-800',
                )}
                aria-label={opt.id}
                aria-pressed={icon === opt.id}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Color picker */}
        <div className="mb-4">
          <label className="text-xs text-slate-400 mb-1.5 block">Color</label>
          <div className="flex gap-2">
            {COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  'w-7 h-7 rounded-full transition-transform border-2',
                  color === c ? 'scale-125 border-white' : 'border-transparent',
                )}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!name.trim() || isSaving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors font-medium"
          >
            <Save size={14} />
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          {existing && (
            <>
              <button
                onClick={handleExport}
                className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
                title="Export as GPX"
              >
                ↓ GPX
              </button>
              <button
                onClick={handleDelete}
                className="px-3 py-2.5 bg-red-600/30 hover:bg-red-600/50 text-red-400 rounded-lg transition-colors"
                title="Delete waypoint"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

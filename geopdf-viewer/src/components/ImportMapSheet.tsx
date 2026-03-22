/**
 * Bottom sheet / modal for importing a map from local file or URL.
 */

import React, { useRef, useState, useCallback } from 'react'
import { X, Upload, Link2, AlertCircle, CheckCircle } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useMapStore } from '@/store/mapStore'
import { parsePdfFile } from '@/lib/geopdf'
import { saveMap, saveMapFile } from '@/lib/db'
import { cn } from '@/lib/utils'

export const ImportMapSheet: React.FC = () => {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const addMap = useMapStore((s) => s.addMap)
  const setActiveMapId = useMapStore((s) => s.setActiveMapId)

  const [tab, setTab] = useState<'file' | 'url'>('file')
  const [isDragging, setIsDragging] = useState(false)
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successName, setSuccessName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(async (file: File) => {
    setError(null)
    setSuccessName(null)
    setIsLoading(true)

    try {
      const data = await file.arrayBuffer()
      const { map } = await parsePdfFile(data, file.name)
      await saveMapFile(map.id, data)
      await saveMap(map)
      addMap(map)
      setActiveMapId(map.id)
      setSuccessName(map.name)
      setTimeout(() => closeSheet(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import map')
    } finally {
      setIsLoading(false)
    }
  }, [addMap, setActiveMapId, closeSheet])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleUrlImport = async () => {
    if (!url.trim()) return
    setError(null)
    setIsLoading(true)

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      const data = await res.arrayBuffer()
      const fileName = url.split('/').pop() ?? 'imported.pdf'
      const { map } = await parsePdfFile(data, fileName)
      await saveMapFile(map.id, data)
      await saveMap(map)
      addMap(map)
      setActiveMapId(map.id)
      setSuccessName(map.name)
      setTimeout(() => closeSheet(), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import from URL')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-50"
        onClick={closeSheet}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import Map"
        className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-4 pb-8 max-h-[80vh] overflow-y-auto md:max-w-lg md:mx-auto md:rounded-2xl md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:border"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-100">Import Map</h2>
          <button onClick={closeSheet} className="p-1 text-slate-400 hover:text-white" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-slate-800 rounded-lg p-1">
          {(['file', 'url'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 py-1.5 text-sm rounded-md transition-colors font-medium',
                tab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {t === 'file' ? 'Local File' : 'From URL'}
            </button>
          ))}
        </div>

        {/* File tab */}
        {tab === 'file' && (
          <div>
            <div
              className={cn(
                'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer',
                isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-slate-600 hover:border-slate-400',
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              aria-label="Drop a PDF file here or click to browse"
            >
              <Upload size={28} className="mx-auto mb-2 text-slate-500" />
              <p className="text-sm text-slate-300 font-medium">
                Drop a GeoPDF here, or click to browse
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Supports GeoPDF · GeoTIFF · PDF (any)
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.tif,.tiff"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* URL tab */}
        {tab === 'url' && (
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-slate-800 border border-slate-600 rounded-lg px-3">
                <Link2 size={14} className="text-slate-400 shrink-0" />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUrlImport()}
                  placeholder="https://example.com/map.pdf"
                  className="flex-1 bg-transparent py-2.5 text-sm text-slate-100 placeholder-slate-500 outline-none"
                  aria-label="Map URL"
                />
              </div>
              <button
                onClick={handleUrlImport}
                disabled={!url.trim() || isLoading}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium"
              >
                Load
              </button>
            </div>
          </div>
        )}

        {/* Status messages */}
        {isLoading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-blue-400">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
            Parsing and indexing map…
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 text-sm text-red-400 bg-red-500/10 rounded-lg p-3">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successName && (
          <div className="mt-4 flex items-center gap-2 text-sm text-green-400 bg-green-500/10 rounded-lg p-3">
            <CheckCircle size={15} className="shrink-0" />
            <span>Imported "<strong>{successName}</strong>" successfully!</span>
          </div>
        )}

        {/* Supported formats */}
        <div className="mt-5 pt-4 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 font-medium mb-2">Supported overlay formats (add after map load):</p>
          <div className="flex flex-wrap gap-1.5">
            {['GeoJSON', 'KML', 'KMZ', 'Shapefile (.zip)', 'GPX'].map((fmt) => (
              <span key={fmt} className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full">
                {fmt}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

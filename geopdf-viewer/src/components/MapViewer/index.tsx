/**
 * Main map viewport component.
 *
 * Layout (z-order, bottom → top):
 *   1. PDF canvas  (rendered PDF page)
 *   2. Vector overlay canvas  (GeoJSON overlays)
 *   3. SVG overlay  (GPS dot, waypoints, tracks)
 *
 * The three layers sit inside a transform container that handles
 * pan / zoom / rotate via CSS transforms.
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import * as pdfjs from 'pdfjs-dist'

import { PDFCanvas } from './PDFCanvas'
import { SVGOverlay } from './SVGOverlay'
import { VectorOverlayCanvas } from './VectorOverlayCanvas'

import { useMapStore, activeMapSelector } from '@/store/mapStore'
import { useWaypointStore } from '@/store/waypointStore'
import { useTrackStore } from '@/store/trackStore'
import { useUiStore } from '@/store/uiStore'
import { useGps } from '@/hooks/useGps'
import { usePanZoom } from '@/hooks/usePanZoom'

import { loadMapFile } from '@/lib/db'
import { ensureProjection, pdfPointToLatLon, latLonToPdfPoint } from '@/lib/coordinates'

const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
const RENDER_DPR = Math.min(DPR, 2)

export const MapViewer: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  const activeMap = useMapStore(activeMapSelector)
  const viewTransform = useMapStore((s) => s.viewTransform)
  const setViewTransform = useMapStore((s) => s.setViewTransform)
  const northUpLocked = useMapStore((s) => s.northUpLocked)
  const followGps = useMapStore((s) => s.followGps)
  const setActivePdfDoc = useMapStore((s) => s.setActivePdfDoc)

  const waypoints = useWaypointStore((s) => s.waypoints)
  const overlays = useWaypointStore((s) => s.overlays)
  const addWaypoint = useWaypointStore((s) => s.addWaypoint)
  const setEditingWaypointId = useWaypointStore((s) => s.setEditingWaypointId)

  const tracks = useTrackStore((s) => s.tracks)
  const activeTrack = useTrackStore((s) => s.activeTrack)

  const { position: gpsPosition } = useGps()
  const setCursorLatLon = useUiStore((s) => s.setCursorLatLon)
  const openSheet = useUiStore((s) => s.openSheet)

  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Canvas render scale ────────────────────────────────────────────────────
  // Defined early so it's available in all callbacks and effects below.

  const renderScale = useMemo(
    () => Math.max(0.5, Math.min(4, viewTransform.scale * RENDER_DPR)),
    [viewTransform.scale],
  )

  // ── Pan / zoom / rotate gestures ──────────────────────────────────────────

  usePanZoom({ containerRef: viewportRef, northUpLocked })

  // ── Load PDF when active map changes ──────────────────────────────────────

  useEffect(() => {
    if (!activeMap) {
      setPdfPage(null)
      setActivePdfDoc(null)
      return
    }

    setIsLoading(true)
    setError(null)
    let cancelled = false

    ;(async () => {
      try {
        const data = await loadMapFile(activeMap.id)
        if (!data || cancelled) return

        const pdf = await pdfjs.getDocument({ data: data.slice(0) }).promise
        if (cancelled) return

        setActivePdfDoc(pdf)
        const page = await pdf.getPage(activeMap.mapPage)
        if (cancelled) return

        setPdfPage(page)

        if (activeMap.registration?.crs) {
          await ensureProjection(activeMap.registration.crs)
        }

        fitMapToViewport(page, containerRef.current)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load map')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [activeMap?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function fitMapToViewport(page: PDFPageProxy, container: HTMLDivElement | null): void {
    if (!container) return
    const vp = page.getViewport({ scale: 1 })
    const cw = container.clientWidth || window.innerWidth
    const ch = container.clientHeight || window.innerHeight
    const scale = Math.min(cw / vp.width, ch / vp.height) * 0.9
    const panX = (cw - vp.width * scale) / 2
    const panY = (ch - vp.height * scale) / 2
    setViewTransform({ scale, panX, panY, rotation: 0 })
  }

  // ── GPS follow mode ───────────────────────────────────────────────────────

  const renderScaleRef = useRef(renderScale)
  useEffect(() => { renderScaleRef.current = renderScale }, [renderScale])

  useEffect(() => {
    if (!followGps || !gpsPosition || !activeMap?.registration || !containerRef.current) return
    const reg = activeMap.registration
    const { pdfX, pdfY } = latLonToPdfPoint(gpsPosition.lat, gpsPosition.lon, reg)
    const canvasPxX = pdfX * renderScaleRef.current
    const canvasPxY = (reg.pageHeightPt - pdfY) * renderScaleRef.current
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    setViewTransform({
      panX: cw / 2 - canvasPxX * viewTransform.scale,
      panY: ch / 2 - canvasPxY * viewTransform.scale,
    })
  }, [gpsPosition, followGps]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cursor coordinate tracking ────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!activeMap?.registration || !viewportRef.current) return
      const rect = viewportRef.current.getBoundingClientRect()
      const localX = (e.clientX - rect.left) / viewTransform.scale
      const localY = (e.clientY - rect.top) / viewTransform.scale
      const pdfX = localX / renderScaleRef.current
      const pdfY = activeMap.registration.pageHeightPt - localY / renderScaleRef.current
      const { lat, lon } = pdfPointToLatLon(pdfX, pdfY, activeMap.registration)
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) setCursorLatLon({ lat, lon })
    },
    [activeMap, viewTransform.scale, setCursorLatLon],
  )

  const handleMouseLeave = useCallback(() => setCursorLatLon(null), [setCursorLatLon])

  // ── Right-click waypoint placement ────────────────────────────────────────

  const handleContextMenu = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      if (!activeMap?.registration || !viewportRef.current) return
      const rect = viewportRef.current.getBoundingClientRect()
      const localX = (e.clientX - rect.left) / viewTransform.scale
      const localY = (e.clientY - rect.top) / viewTransform.scale
      const pdfX = localX / renderScaleRef.current
      const pdfY = activeMap.registration.pageHeightPt - localY / renderScaleRef.current
      const { lat, lon } = pdfPointToLatLon(pdfX, pdfY, activeMap.registration)
      const wp = await addWaypoint({
        name: `Waypoint ${new Date().toLocaleTimeString()}`,
        description: '',
        lat,
        lon,
        timestamp: Date.now(),
        icon: 'pin',
        color: '#3b82f6',
      })
      setEditingWaypointId(wp.id)
      openSheet('waypoint-editor', { waypointId: wp.id })
    },
    [activeMap, viewTransform.scale, addWaypoint, setEditingWaypointId, openSheet],
  )

  const handleCanvasReady = useCallback((w: number, h: number) => {
    setCanvasSize({ w, h })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────

  if (!activeMap) return <EmptyState />

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-slate-900 select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {/* Transform container */}
      <div
        ref={viewportRef}
        style={{
          position: 'absolute',
          transformOrigin: '0 0',
          transform: `translate(${viewTransform.panX}px, ${viewTransform.panY}px) scale(${viewTransform.scale}) rotate(${viewTransform.rotation}deg)`,
          willChange: 'transform',
          cursor: 'grab',
        }}
      >
        <PDFCanvas page={pdfPage} renderScale={renderScale} onCanvasReady={handleCanvasReady} />

        {activeMap.registration && canvasSize.w > 0 && (
          <VectorOverlayCanvas
            overlays={overlays.filter((o) => o.visible)}
            registration={activeMap.registration}
            canvasWidth={canvasSize.w}
            canvasHeight={canvasSize.h}
            renderScale={renderScale}
          />
        )}

        {activeMap.registration && canvasSize.w > 0 && (
          <SVGOverlay
            registration={activeMap.registration}
            canvasWidth={canvasSize.w}
            canvasHeight={canvasSize.h}
            renderScale={renderScale}
            gpsPosition={gpsPosition}
            waypoints={waypoints}
            tracks={tracks}
            activeTrack={activeTrack}
            onWaypointClick={(wp) => {
              setEditingWaypointId(wp.id)
              openSheet('waypoint-editor', { waypointId: wp.id })
            }}
          />
        )}
      </div>

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/70 z-50">
          <div className="text-center">
            <div className="w-12 h-12 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-blue-300 text-sm">Loading map…</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-50">
          <div className="bg-red-900/80 text-red-200 rounded-xl p-6 max-w-sm text-center mx-4">
            <p className="font-semibold mb-1">Failed to load map</p>
            <p className="text-sm opacity-80">{error}</p>
            <button
              onClick={() => setError(null)}
              className="mt-3 text-xs px-3 py-1 bg-red-700/60 hover:bg-red-600 rounded-lg transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!activeMap.registration && !isLoading && !error && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 bg-amber-800/90 text-amber-200 text-xs px-3 py-1.5 rounded-full shadow-lg pointer-events-none">
          ⚠ No geospatial registration found — GPS overlay unavailable
        </div>
      )}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => {
  const openSheet = useUiStore((s) => s.openSheet)
  const setActivePanel = useUiStore((s) => s.setActivePanel)

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-400">
      <svg viewBox="0 0 64 64" className="w-20 h-20 mb-4 opacity-30" aria-hidden="true">
        <rect width="64" height="64" rx="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 16 L32 8 L52 16 L52 48 L32 56 L12 48 Z" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="32" cy="28" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M32 34 L32 44" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <h2 className="text-xl font-semibold text-slate-300 mb-2">No map selected</h2>
      <p className="text-sm mb-6 text-center max-w-xs">
        Import a GeoPDF to get started, or choose a previously imported map from the library.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => openSheet('import-map')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Import Map
        </button>
        <button
          onClick={() => setActivePanel('maps')}
          className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm font-medium transition-colors"
        >
          Map Library
        </button>
      </div>
    </div>
  )
}

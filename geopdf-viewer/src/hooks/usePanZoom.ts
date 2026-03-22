/**
 * Pan, zoom, and rotate gesture handling for the map viewport.
 * Handles mouse wheel, pointer drag, pinch-to-zoom, and two-finger rotation.
 */

import { useRef, useCallback, useEffect } from 'react'
import { useMapStore } from '@/store/mapStore'

const MIN_SCALE = 0.05
const MAX_SCALE = 32
const INERTIA_FRICTION = 0.88

interface UsePanZoomOptions {
  containerRef: React.RefObject<HTMLDivElement | null>
  northUpLocked?: boolean
}

export function usePanZoom({ containerRef, northUpLocked }: UsePanZoomOptions): void {
  const setViewTransform = useMapStore((s) => s.setViewTransform)
  const viewTransform = useMapStore((s) => s.viewTransform)

  // Use refs for fast access without re-renders
  const vtRef = useRef(viewTransform)
  useEffect(() => { vtRef.current = viewTransform }, [viewTransform])

  // Inertia
  const velocity = useRef({ x: 0, y: 0 })
  const rafId = useRef<number | null>(null)
  const isDragging = useRef(false)
  const lastPointer = useRef({ x: 0, y: 0 })

  // Pinch state
  const pinchRef = useRef<{ dist: number; angle: number; cx: number; cy: number } | null>(null)

  const applyTransform = useCallback((delta: Partial<typeof vtRef.current>) => {
    const next = { ...vtRef.current, ...delta }
    next.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next.scale))
    if (northUpLocked) next.rotation = 0
    vtRef.current = next
    setViewTransform(next)
  }, [setViewTransform, northUpLocked])

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────

  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.12 : 0.89
    const rect = containerRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const vt = vtRef.current
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vt.scale * factor))
    const scaleDelta = newScale / vt.scale
    applyTransform({
      scale: newScale,
      panX: cx - (cx - vt.panX) * scaleDelta,
      panY: cy - (cy - vt.panY) * scaleDelta,
    })
  }, [applyTransform, containerRef])

  // ── Pointer drag ──────────────────────────────────────────────────────────

  const startInertia = useCallback(() => {
    const step = () => {
      const vel = velocity.current
      if (Math.abs(vel.x) < 0.5 && Math.abs(vel.y) < 0.5) {
        rafId.current = null
        return
      }
      velocity.current = { x: vel.x * INERTIA_FRICTION, y: vel.y * INERTIA_FRICTION }
      applyTransform({
        panX: vtRef.current.panX + vel.x,
        panY: vtRef.current.panY + vel.y,
      })
      rafId.current = requestAnimationFrame(step)
    }
    rafId.current = requestAnimationFrame(step)
  }, [applyTransform])

  const onPointerDown = useCallback((e: PointerEvent) => {
    if (e.button !== 0) return
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    isDragging.current = true
    lastPointer.current = { x: e.clientX, y: e.clientY }
    velocity.current = { x: 0, y: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - lastPointer.current.x
    const dy = e.clientY - lastPointer.current.y
    velocity.current = { x: dx, y: dy }
    lastPointer.current = { x: e.clientX, y: e.clientY }
    applyTransform({
      panX: vtRef.current.panX + dx,
      panY: vtRef.current.panY + dy,
    })
  }, [applyTransform])

  const onPointerUp = useCallback(() => {
    isDragging.current = false
    startInertia()
  }, [startInertia])

  // ── Touch pinch + rotate ──────────────────────────────────────────────────

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      const angle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX)
      const cx = (t1.clientX + t2.clientX) / 2
      const cy = (t1.clientY + t2.clientY) / 2
      pinchRef.current = { dist, angle, cx, cy }
    }
  }, [])

  const onTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 2 || !pinchRef.current) return
    e.preventDefault()
    const t1 = e.touches[0]
    const t2 = e.touches[1]
    const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const newAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX)
    const newCx = (t1.clientX + t2.clientX) / 2
    const newCy = (t1.clientY + t2.clientY) / 2
    const rect = containerRef.current!.getBoundingClientRect()

    const scaleRatio = newDist / pinchRef.current.dist
    const rotDelta = northUpLocked
      ? 0
      : ((newAngle - pinchRef.current.angle) * 180) / Math.PI

    const vt = vtRef.current
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, vt.scale * scaleRatio))
    const scaleDelta = newScale / vt.scale
    const cx = pinchRef.current.cx - rect.left
    const cy = pinchRef.current.cy - rect.top

    applyTransform({
      scale: newScale,
      panX: cx - (cx - vt.panX) * scaleDelta + (newCx - pinchRef.current.cx),
      panY: cy - (cy - vt.panY) * scaleDelta + (newCy - pinchRef.current.cy),
      rotation: vt.rotation + rotDelta,
    })

    pinchRef.current = { dist: newDist, angle: newAngle, cx: newCx, cy: newCy }
  }, [applyTransform, containerRef, northUpLocked])

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null
  }, [])

  // ── Event binding ─────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onWheel, onPointerDown, onPointerMove, onPointerUp, onTouchStart, onTouchMove, onTouchEnd, containerRef])
}

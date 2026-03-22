/**
 * GPS positioning hook using the Web Geolocation API.
 * Provides live position, heading, and screen wake lock during recording.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import type { GpsPosition } from '@/types'
import { useUiStore } from '@/store/uiStore'
import { useTrackStore } from '@/store/trackStore'

// ── Module-level shared GPS state ─────────────────────────────────────────────

let gpsPosition: GpsPosition | null = null
const positionListeners = new Set<(pos: GpsPosition | null) => void>()
let watchId: number | null = null
let wakeLock: WakeLockSentinel | null = null

function notifyListeners(pos: GpsPosition | null): void {
  gpsPosition = pos
  positionListeners.forEach((fn) => fn(pos))
}

async function acquireWakeLock(): Promise<void> {
  if ('wakeLock' in navigator && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock.request('screen')
    } catch {
      // Not critical
    }
  }
}

async function releaseWakeLock(): Promise<void> {
  if (wakeLock) {
    try { await wakeLock.release() } catch { /* ignore */ }
    wakeLock = null
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseGpsReturn {
  position: GpsPosition | null
  startGps: () => void
  stopGps: () => void
}

export function useGps(): UseGpsReturn {
  const [position, setPosition] = useState<GpsPosition | null>(gpsPosition)

  const setGpsStatus = useUiStore((s) => s.setGpsStatus)
  const addTrackPoint = useTrackStore((s) => s.addTrackPoint)
  const isRecording = useTrackStore((s) => s.isRecording)
  const recordingInterval = useTrackStore((s) => s.recordingInterval)

  const lastTrackTs = useRef<number>(0)

  // Subscribe to module-level GPS state
  useEffect(() => {
    const listener = (pos: GpsPosition | null) => {
      setPosition(pos)

      if (!pos) return

      // Track recording interval filter
      if (isRecording) {
        const now = pos.timestamp
        if (now - lastTrackTs.current >= recordingInterval * 1000) {
          addTrackPoint(pos)
          lastTrackTs.current = now
        }
      }
    }

    positionListeners.add(listener)
    // Deliver current position immediately
    if (gpsPosition) listener(gpsPosition)

    return () => { positionListeners.delete(listener) }
  }, [isRecording, recordingInterval, addTrackPoint])

  const startGps = useCallback((): void => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('error', 'Geolocation not supported')
      return
    }
    if (watchId !== null) {
      setGpsStatus('active')
      return
    }

    setGpsStatus('requesting')
    acquireWakeLock()

    watchId = navigator.geolocation.watchPosition(
      (nativePos) => {
        const pos: GpsPosition = {
          lat: nativePos.coords.latitude,
          lon: nativePos.coords.longitude,
          accuracy: nativePos.coords.accuracy,
          altitude: nativePos.coords.altitude ?? undefined,
          altitudeAccuracy: nativePos.coords.altitudeAccuracy ?? undefined,
          speed: nativePos.coords.speed ?? undefined,
          heading: nativePos.coords.heading ?? undefined,
          timestamp: nativePos.timestamp,
        }
        notifyListeners(pos)
        setGpsStatus('active')
      },
      (err) => {
        setGpsStatus('error', err.message)
        notifyListeners(null)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }, [setGpsStatus])

  const stopGps = useCallback((): void => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }
    notifyListeners(null)
    setGpsStatus('off')
    releaseWakeLock()
  }, [setGpsStatus])

  return { position, startGps, stopGps }
}

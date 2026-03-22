/**
 * SVG overlay layer rendered on top of the PDF canvas.
 * Shows GPS position, accuracy circle, waypoints, active track, and completed tracks.
 *
 * Coordinate conversion: WGS-84 → PDF units → canvas pixels (already scaled).
 */

import React, { useMemo } from 'react'
import type { MapRegistration, GpsPosition, Waypoint, Track } from '@/types'
import { latLonToPdfPoint, pdfPointToLatLon } from '@/lib/coordinates'

interface SVGOverlayProps {
  registration: MapRegistration
  canvasWidth: number   // rendered canvas pixel width
  canvasHeight: number  // rendered canvas pixel height
  renderScale: number   // PDF→canvas scale factor

  gpsPosition: GpsPosition | null
  waypoints: Waypoint[]
  tracks: Track[]
  activeTrack: Track | null

  onMapClick?: (lat: number, lon: number, x: number, y: number) => void
  onWaypointClick?: (wp: Waypoint) => void
}

export const SVGOverlay: React.FC<SVGOverlayProps> = ({
  registration,
  canvasWidth,
  canvasHeight,
  renderScale,
  gpsPosition,
  waypoints,
  tracks,
  activeTrack,
  onMapClick,
  onWaypointClick,
}) => {

  /** Convert WGS-84 → canvas pixel */
  const toCanvas = (lat: number, lon: number): [number, number] => {
    const { pdfX, pdfY } = latLonToPdfPoint(lat, lon, registration)
    // PDF origin is bottom-left; canvas origin is top-left
    const cx = pdfX * renderScale
    const cy = (registration.pageHeightPt - pdfY) * renderScale
    return [cx, cy]
  }

  const gpsPoint = useMemo(() => {
    if (!gpsPosition) return null
    return toCanvas(gpsPosition.lat, gpsPosition.lon)
  }, [gpsPosition, registration, renderScale])

  const accuracyRadius = useMemo(() => {
    if (!gpsPosition || !gpsPoint) return 0
    // Convert accuracy (metres) to canvas pixels
    // Rough approximation: use metres-per-degree at the given latitude
    const metersPerDegree = 111320 * Math.cos((gpsPosition.lat * Math.PI) / 180)
    const degPerMeter = 1 / metersPerDegree
    const accuracyDeg = gpsPosition.accuracy * degPerMeter
    // Convert to PDF units via the affine transform (approx: use scale factor)
    const { pdfX: px1 } = latLonToPdfPoint(gpsPosition.lat, gpsPosition.lon, registration)
    const { pdfX: px2 } = latLonToPdfPoint(gpsPosition.lat, gpsPosition.lon + accuracyDeg, registration)
    return Math.abs(px2 - px1) * renderScale
  }, [gpsPosition, gpsPoint, registration, renderScale])

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMapClick) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    // Canvas px → PDF units
    const pdfX = x / renderScale
    const pdfY = registration.pageHeightPt - y / renderScale
    // PDF units → projected → WGS-84
    const { lat, lon } = pdfPointToLatLon(pdfX, pdfY, registration)
    onMapClick(lat, lon, e.clientX, e.clientY)
  }

  const trackPath = (points: { lat: number; lon: number }[]): string => {
    if (points.length === 0) return ''
    return points.reduce((acc, pt, i) => {
      const [cx, cy] = toCanvas(pt.lat, pt.lon)
      return acc + (i === 0 ? `M${cx},${cy}` : `L${cx},${cy}`)
    }, '')
  }

  return (
    <svg
      width={canvasWidth}
      height={canvasHeight}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'visible',
        pointerEvents: onMapClick ? 'all' : 'none',
        cursor: onMapClick ? 'crosshair' : 'default',
      }}
      onClick={handleClick}
    >
      {/* Completed tracks */}
      {tracks.map((track) => (
        <path
          key={track.id}
          d={trackPath(track.points)}
          stroke={track.color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.8}
          pointerEvents="none"
        />
      ))}

      {/* Active recording track */}
      {activeTrack && activeTrack.points.length > 0 && (
        <path
          d={trackPath(activeTrack.points)}
          stroke="#ef4444"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity={0.9}
          pointerEvents="none"
        />
      )}

      {/* Waypoint markers */}
      {waypoints.map((wp) => {
        const [cx, cy] = toCanvas(wp.lat, wp.lon)
        const isVisible = cx >= -50 && cx <= canvasWidth + 50 && cy >= -50 && cy <= canvasHeight + 50
        if (!isVisible) return null
        return (
          <WaypointPin
            key={wp.id}
            cx={cx}
            cy={cy}
            color={wp.color}
            label={wp.name}
            onClick={(e) => {
              e.stopPropagation()
              onWaypointClick?.(wp)
            }}
          />
        )
      })}

      {/* GPS accuracy ring */}
      {gpsPoint && accuracyRadius > 2 && (
        <circle
          cx={gpsPoint[0]}
          cy={gpsPoint[1]}
          r={accuracyRadius}
          fill="rgba(59,130,246,0.12)"
          stroke="rgba(59,130,246,0.5)"
          strokeWidth={1.5}
          pointerEvents="none"
        />
      )}

      {/* GPS position dot + heading arrow */}
      {gpsPoint && (
        <GpsDot
          cx={gpsPoint[0]}
          cy={gpsPoint[1]}
          heading={gpsPosition?.heading ?? null}
        />
      )}
    </svg>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const WaypointPin: React.FC<{
  cx: number; cy: number; color: string; label: string
  onClick: (e: React.MouseEvent) => void
}> = ({ cx, cy, color, label, onClick }) => (
  <g
    transform={`translate(${cx},${cy})`}
    onClick={onClick}
    style={{ cursor: 'pointer', pointerEvents: 'all' }}
  >
    {/* Drop shadow */}
    <circle cx={0} cy={0} r={14} fill="rgba(0,0,0,0.2)" transform="translate(1,2)" />
    {/* Pin body */}
    <path
      d="M0,-18 C-8,-18 -12,-10 -12,-4 C-12,6 0,18 0,18 C0,18 12,6 12,-4 C12,-10 8,-18 0,-18 Z"
      fill={color}
      stroke="white"
      strokeWidth={2}
    />
    <circle cx={0} cy={-4} r={4} fill="white" opacity={0.9} />
    {/* Label */}
    <text
      x={0}
      y={26}
      textAnchor="middle"
      fill="white"
      fontSize={11}
      fontWeight="600"
      paintOrder="stroke"
      stroke="rgba(0,0,0,0.8)"
      strokeWidth={3}
      strokeLinejoin="round"
    >
      {label.length > 20 ? label.slice(0, 18) + '…' : label}
    </text>
  </g>
)

const GpsDot: React.FC<{ cx: number; cy: number; heading: number | null }> = ({
  cx, cy, heading,
}) => (
  <g transform={`translate(${cx},${cy})`} pointerEvents="none">
    {/* Outer pulse ring */}
    <circle cx={0} cy={0} r={16} fill="rgba(59,130,246,0.2)">
      <animate attributeName="r" from="12" to="24" dur="2s" repeatCount="indefinite" />
      <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
    </circle>
    {/* Heading cone */}
    {heading !== null && (
      <path
        d="M0,-32 L-10,-8 L10,-8 Z"
        fill="rgba(59,130,246,0.7)"
        transform={`rotate(${heading})`}
      />
    )}
    {/* White ring */}
    <circle cx={0} cy={0} r={10} fill="white" />
    {/* Blue dot */}
    <circle cx={0} cy={0} r={7} fill="#3b82f6" />
    {/* Center dot */}
    <circle cx={0} cy={0} r={2} fill="white" />
  </g>
)

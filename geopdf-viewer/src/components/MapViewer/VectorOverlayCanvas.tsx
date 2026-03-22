/**
 * Renders GeoJSON vector overlays onto an HTML5 canvas.
 * Sits above the PDF canvas but below the SVG overlay.
 */

import React, { useEffect, useRef } from 'react'
import type { VectorOverlay, MapRegistration } from '@/types'
import { latLonToPdfPoint } from '@/lib/coordinates'

interface VectorOverlayCanvasProps {
  overlays: VectorOverlay[]
  registration: MapRegistration
  canvasWidth: number
  canvasHeight: number
  renderScale: number
}

export const VectorOverlayCanvas: React.FC<VectorOverlayCanvasProps> = ({
  overlays,
  registration,
  canvasWidth,
  canvasHeight,
  renderScale,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    const toCanvas = (lat: number, lon: number): [number, number] => {
      const { pdfX, pdfY } = latLonToPdfPoint(lat, lon, registration)
      return [pdfX * renderScale, (registration.pageHeightPt - pdfY) * renderScale]
    }

    for (const overlay of overlays) {
      if (!overlay.visible) continue
      ctx.strokeStyle = overlay.color
      ctx.fillStyle = overlay.color + '44' // 27% opacity fill

      for (const feature of overlay.geojson.features) {
        drawFeature(ctx, feature, toCanvas, overlay.color)
      }
    }
  }, [overlays, registration, canvasWidth, canvasHeight, renderScale])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'none',
      }}
    />
  )
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  feature: GeoJSON.Feature,
  toCanvas: (lat: number, lon: number) => [number, number],
  color: string,
): void {
  const geom = feature.geometry
  if (!geom) return

  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.fillStyle = color + '44'
  ctx.lineWidth = 2.5

  switch (geom.type) {
    case 'Point': {
      const [lon, lat] = geom.coordinates as [number, number]
      const [cx, cy] = toCanvas(lat, lon)
      ctx.arc(cx, cy, 6, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = 'white'
      ctx.lineWidth = 1.5
      ctx.stroke()
      break
    }
    case 'MultiPoint':
      for (const coords of geom.coordinates as [number, number][]) {
        const [cx, cy] = toCanvas(coords[1], coords[0])
        ctx.arc(cx, cy, 6, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      }
      break
    case 'LineString':
      drawLineString(ctx, geom.coordinates as [number, number][], toCanvas)
      ctx.strokeStyle = color
      ctx.stroke()
      break
    case 'MultiLineString':
      for (const line of geom.coordinates as [number, number][][]) {
        drawLineString(ctx, line, toCanvas)
      }
      ctx.strokeStyle = color
      ctx.stroke()
      break
    case 'Polygon':
      drawPolygon(ctx, geom.coordinates as [number, number][][], toCanvas)
      ctx.fillStyle = color + '44'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.stroke()
      break
    case 'MultiPolygon':
      for (const poly of geom.coordinates as [number, number][][][]) {
        drawPolygon(ctx, poly, toCanvas)
      }
      ctx.fillStyle = color + '44'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.stroke()
      break
    case 'GeometryCollection':
      for (const g of geom.geometries) {
        drawFeature(ctx, { type: 'Feature', geometry: g, properties: {} }, toCanvas, color)
      }
      break
  }
}

function drawLineString(
  ctx: CanvasRenderingContext2D,
  coords: [number, number][],
  toCanvas: (lat: number, lon: number) => [number, number],
): void {
  if (coords.length === 0) return
  const [x0, y0] = toCanvas(coords[0][1], coords[0][0])
  ctx.moveTo(x0, y0)
  for (let i = 1; i < coords.length; i++) {
    const [x, y] = toCanvas(coords[i][1], coords[i][0])
    ctx.lineTo(x, y)
  }
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  rings: [number, number][][],
  toCanvas: (lat: number, lon: number) => [number, number],
): void {
  for (const ring of rings) {
    if (ring.length === 0) continue
    const [x0, y0] = toCanvas(ring[0][1], ring[0][0])
    ctx.moveTo(x0, y0)
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toCanvas(ring[i][1], ring[i][0])
      ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
}

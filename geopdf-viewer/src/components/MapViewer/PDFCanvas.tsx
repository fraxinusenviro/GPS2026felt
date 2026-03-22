/**
 * Renders a PDF page to an HTML canvas at the given scale.
 * Re-renders when the active map or scale changes significantly.
 */

import React, { useEffect, useRef, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { renderPage } from '@/lib/geopdf'

interface PDFCanvasProps {
  page: PDFPageProxy | null
  renderScale: number // scale at which to render (device pixel ratio aware)
  onCanvasReady?: (width: number, height: number) => void
}

export const PDFCanvas: React.FC<PDFCanvasProps> = ({ page, renderScale, onCanvasReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isRendering, setIsRendering] = useState(false)
  const renderKey = useRef<string>('')

  useEffect(() => {
    if (!page || !canvasRef.current) return

    const key = `${page.pageNumber}-${renderScale.toFixed(3)}`
    if (renderKey.current === key) return
    renderKey.current = key

    const canvas = canvasRef.current
    setIsRendering(true)

    renderPage(page, renderScale, canvas)
      .then(() => {
        onCanvasReady?.(canvas.width, canvas.height)
        setIsRendering(false)
      })
      .catch((err) => {
        console.error('PDF render error:', err)
        setIsRendering(false)
      })
  }, [page, renderScale, onCanvasReady])

  return (
    <div className="relative" style={{ display: 'contents' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          imageRendering: 'auto',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      />
      {isRendering && (
        <div className="absolute inset-0 bg-slate-900/30 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}

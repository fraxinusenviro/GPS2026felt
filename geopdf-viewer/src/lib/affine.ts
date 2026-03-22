/**
 * 2D affine transform utilities.
 *
 * Transforms are expressed as the 2×3 matrix:
 *   | a  b  e |
 *   | c  d  f |
 *
 * Mapping: [outX, outY] = [a*x + b*y + e,  c*x + d*y + f]
 *
 * In GeoPDF context this maps PDF user-units → projected coordinates.
 */

import type { AffineTransform } from '@/types'

/** Apply forward transform: PDF point → projected coordinates */
export function applyAffine(t: AffineTransform, x: number, y: number): [number, number] {
  return [t.a * x + t.b * y + t.e, t.c * x + t.d * y + t.f]
}

/** Apply inverse transform: projected coordinates → PDF point */
export function applyAffineInverse(t: AffineTransform, px: number, py: number): [number, number] {
  const det = t.a * t.d - t.b * t.c
  if (Math.abs(det) < 1e-12) throw new Error('Singular affine transform')
  const invA = t.d / det
  const invB = -t.b / det
  const invC = -t.c / det
  const invD = t.a / det
  const invE = (t.b * t.f - t.d * t.e) / det
  const invF = (t.c * t.e - t.a * t.f) / det
  return [invA * px + invB * py + invE, invC * px + invD * py + invF]
}

/**
 * Compute an affine transform from ground control points (GCPs).
 * Each GCP is [pdfX, pdfY, projX, projY].
 * Uses least-squares fit when there are ≥ 3 points.
 */
export function gcpsToAffine(gcps: [number, number, number, number][]): AffineTransform {
  if (gcps.length < 2) throw new Error('Need at least 2 GCPs')

  if (gcps.length === 2) {
    // Solve exactly for translation + uniform scale (no shear)
    const [x1, y1, px1, py1] = gcps[0]
    const [x2, y2, px2, py2] = gcps[1]
    const dx = x2 - x1
    const dy = y2 - y1
    const dpx = px2 - px1
    const dpy = py2 - py1
    const denom = dx * dx + dy * dy
    const a = (dpx * dx + dpy * dy) / denom
    const b = (dpx * dy - dpy * dx) / denom
    const e = px1 - a * x1 - b * y1
    const f = py1 - b * x1 + a * y1 // Note: c=-b, d=a for rotation
    // Wait - for 2-point we use similarity transform: a=d, b=-c
    return { a, b, c: -b, d: a, e, f }
  }

  // Least-squares for 3+ points
  // Build matrix equation: X = A * P where P = [a b c d e f]
  // For each GCP: projX = a*pdfX + b*pdfY + e
  //               projY = c*pdfX + d*pdfY + f
  // We solve two separate 3-parameter linear systems.

  const n = gcps.length
  // Matrices for X equation: a*x + b*y + e = px
  let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0
  let sumPxX = 0, sumPxY = 0, sumPx = 0
  let sumPyX = 0, sumPyY = 0, sumPy = 0

  for (const [x, y, px, py] of gcps) {
    sumX += x; sumY += y
    sumXX += x * x; sumYY += y * y; sumXY += x * y
    sumPxX += px * x; sumPxY += px * y; sumPx += px
    sumPyX += py * x; sumPyY += py * y; sumPy += py
  }

  // 3×3 normal matrix
  const M = [
    [sumXX, sumXY, sumX],
    [sumXY, sumYY, sumY],
    [sumX,  sumY,  n   ],
  ]

  const rxVec = [sumPxX, sumPxY, sumPx]
  const ryVec = [sumPyX, sumPyY, sumPy]

  const [a, b, e] = solveLinear3(M, rxVec)
  const [c, d, f] = solveLinear3(M, ryVec)

  return { a, b, c, d, e, f }
}

/** Gaussian elimination for 3×3 system */
function solveLinear3(M: number[][], rhs: number[]): [number, number, number] {
  const A = M.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < 3; col++) {
    // Find pivot
    let maxRow = col
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row
    }
    ;[A[col], A[maxRow]] = [A[maxRow], A[col]]

    for (let row = col + 1; row < 3; row++) {
      const factor = A[row][col] / A[col][col]
      for (let k = col; k <= 3; k++) {
        A[row][k] -= factor * A[col][k]
      }
    }
  }

  // Back substitution
  const x = [0, 0, 0]
  for (let i = 2; i >= 0; i--) {
    x[i] = A[i][3]
    for (let j = i + 1; j < 3; j++) {
      x[i] -= A[i][j] * x[j]
    }
    x[i] /= A[i][i]
  }

  return [x[0], x[1], x[2]]
}

// ============================================================
// Image helpers for the photo workflow.
//
// Camera photos on phones are routinely 3–8 MB and 4000+ px wide.
// Storing them verbatim as base64 (and decoding many at once for
// grids / PDF export) exhausts mobile Safari's per-tab memory and
// crashes the page. Everything that enters storage is therefore
// downscaled and re-encoded to a bounded JPEG first, and grids use
// small thumbnails so we never hold many full-size bitmaps at once.
//
// IMPORTANT: read EXIF from the *original* file before calling these
// — canvas re-encoding strips EXIF metadata.
// ============================================================

/** Read a Blob/File straight to a data URL (fallback when canvas is unavailable). */
function rawDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => resolve('');
    fr.readAsDataURL(file);
  });
}

interface ClosableBitmap extends ImageBitmap { close(): void }

async function decode(blob: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
}

function encodeScaled(bmp: ImageBitmap, maxDim: number, quality: number): string | null {
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bmp, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscale + re-encode an image File to an orientation-corrected JPEG data URL
 * suitable for storage. Falls back to the original bytes if the browser can't
 * decode it. `maxDim` bounds the longest edge (px).
 */
export async function fileToStorageDataUrl(file: Blob, maxDim = 2048, quality = 0.82): Promise<string> {
  const bmp = await decode(file);
  if (!bmp) return rawDataUrl(file);
  try {
    return encodeScaled(bmp, maxDim, quality) ?? await rawDataUrl(file);
  } finally {
    (bmp as ClosableBitmap).close?.();
  }
}

export interface RecompressResult {
  dataUrl: string;
  changed: boolean;
}

/**
 * Re-encode an already-stored image data URL down to the storage budget. Used by
 * the one-time migration of photos captured before downscaling existed. Returns
 * the original unchanged when it is already small enough, isn't a raster image,
 * or can't be decoded.
 *
 * @param maxDim   longest-edge cap (px)
 * @param minBytes only touch images whose encoded length exceeds this (skips thumbnails)
 */
export async function recompressStoredDataUrl(
  dataUrl: string, maxDim = 2048, quality = 0.82, minBytes = 700_000,
): Promise<RecompressResult> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
    return { dataUrl, changed: false };
  }
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await decode(blob);
    if (!bmp) return { dataUrl, changed: false };
    try {
      const oversized = Math.max(bmp.width, bmp.height) > maxDim;
      const heavy = dataUrl.length > minBytes;
      if (!oversized && !heavy) return { dataUrl, changed: false };
      const out = encodeScaled(bmp, maxDim, quality);
      // Keep the smaller of the two — never grow an image.
      if (out && out.length < dataUrl.length * 0.95) return { dataUrl: out, changed: true };
      return { dataUrl, changed: false };
    } finally {
      (bmp as ClosableBitmap).close?.();
    }
  } catch {
    return { dataUrl, changed: false };
  }
}

/**
 * Produce a small thumbnail JPEG data URL from a stored image (data URL or Blob).
 * Used for selection grids so we never decode many full-size images at once.
 */
export async function makeThumbnail(src: string | Blob, maxDim = 480, quality = 0.7): Promise<string> {
  const fallback = typeof src === 'string' ? src : '';
  try {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    const bmp = await decode(blob);
    if (!bmp) return fallback;
    try {
      return encodeScaled(bmp, maxDim, quality) ?? fallback;
    } finally {
      (bmp as ClosableBitmap).close?.();
    }
  } catch {
    return fallback;
  }
}

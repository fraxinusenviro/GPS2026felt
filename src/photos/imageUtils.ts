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

import { StorageManager } from '../storage/StorageManager';
import { EventBus } from '../utils/EventBus';
import { recompressStoredDataUrl } from './imageUtils';

// Bump the version suffix if the storage budget changes and a re-pass is wanted.
const FLAG = 'fm_photo_downscale_migration_v1';

function isDone(): boolean {
  try { return localStorage.getItem(FLAG) === 'done'; } catch { return false; }
}
function markDone(): void {
  try { localStorage.setItem(FLAG, 'done'); } catch { /* private mode — retry next launch */ }
}

const yieldToUi = () => new Promise<void>(res => setTimeout(res, 0));

/**
 * One-time pass that re-compresses photos captured before on-import downscaling
 * existed. Full-resolution camera photos are the cause of the mobile memory
 * crashes; this shrinks any already-stored ones in place.
 *
 * Safe to call on every launch: it no-ops once the per-device flag is set, and
 * it streams features one at a time (by key) so a device that is already close
 * to its memory limit never has to hold more than a single photo in memory.
 */
export async function runPhotoDownscaleMigration(): Promise<void> {
  if (isDone()) return;

  const storage = StorageManager.getInstance();
  let ids: string[];
  try {
    ids = await storage.getAllFeatureIds();
  } catch {
    return; // can't enumerate — leave the flag unset so we try again next launch
  }

  let rewrittenPhotos = 0;
  let hadError = false;

  for (const id of ids) {
    let feature;
    try {
      feature = await storage.getFeature(id);
    } catch {
      hadError = true;
      continue;
    }
    const photos = feature?.photos;
    if (!feature || !Array.isArray(photos) || photos.length === 0) continue;

    let changedAny = false;
    const next: string[] = [];
    for (const p of photos) {
      const r = await recompressStoredDataUrl(p);
      if (r.changed) { changedAny = true; rewrittenPhotos++; }
      next.push(r.dataUrl);
      await yieldToUi(); // keep the UI responsive between heavy decodes
    }

    if (changedAny) {
      feature.photos = next;
      try {
        await storage.saveFeature(feature); // bumps updated_at → syncs the smaller copies
      } catch {
        hadError = true;
      }
    }
  }

  // Only lock the migration in if we got all the way through cleanly.
  if (!hadError) markDone();

  if (rewrittenPhotos > 0) {
    EventBus.emit('toast', {
      message: `Optimised ${rewrittenPhotos} stored photo${rewrittenPhotos !== 1 ? 's' : ''}`,
      type: 'success',
      duration: 3000,
    });
  }
}

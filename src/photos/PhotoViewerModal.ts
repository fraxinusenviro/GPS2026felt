import type { FieldFeature } from '../types';
import { EventBus } from '../utils/EventBus';

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/**
 * Lightbox modal that displays a captured photo and its metadata.
 * Launched when a photo point is clicked on the map (see App.wireMapInteractions).
 */
export class PhotoViewerModal {
  private overlay: HTMLElement | null = null;
  private feature: FieldFeature | null = null;
  private photoIndex = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  open(feature: FieldFeature): void {
    this.feature = feature;
    this.photoIndex = 0;
    this.render();
  }

  close(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.feature = null;
  }

  private esc(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private render(): void {
    const f = this.feature;
    if (!f) return;

    let overlay = document.getElementById('photo-viewer-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'photo-viewer-overlay';
      overlay.className = 'pv-overlay';
      document.body.appendChild(overlay);
    }
    this.overlay = overlay;

    const photos = f.photos ?? [];
    const hasPhoto = photos.length > 0 && !!photos[this.photoIndex];
    const bearing = f.photo_data?.bearing ?? null;
    const observer = f.photo_data?.observer ?? f.created_by ?? '—';
    const dateStr = f.created_at ? new Date(f.created_at).toLocaleString() : '—';
    const coords = (f.lat != null && f.lon != null)
      ? `${f.lat.toFixed(6)}°, ${f.lon.toFixed(6)}°` : '—';
    const elev = f.elevation != null ? `${f.elevation.toFixed(1)} m` : null;
    const acc = f.accuracy != null ? `±${f.accuracy.toFixed(0)} m` : null;

    const meta: Array<[string, string]> = [
      ['Observer', this.esc(observer)],
      ['Bearing', bearing != null ? `${Math.round(bearing)}° ${bearingToCardinal(bearing)}` : '—'],
      ['Date', this.esc(dateStr)],
      ['Coordinates', this.esc(coords)],
    ];
    if (elev) meta.push(['Elevation', elev]);
    if (acc) meta.push(['Accuracy', acc]);

    const multi = photos.length > 1;

    overlay.innerHTML = `
      <div class="pv-backdrop" id="pv-backdrop"></div>
      <div class="pv-modal" role="dialog" aria-modal="true">
        <div class="pv-header">
          <span class="pv-title">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18"><path d="M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-80,32a44,44,0,1,1-44,44A44.05,44.05,0,0,0,128,88Zm0,72a28,28,0,1,0-28-28A28,28,0,0,0,128,160Z"/></svg>
            ${this.esc(f.point_id || 'Photo')}
          </span>
          <button class="pv-close" id="pv-close" title="Close">✕</button>
        </div>

        <div class="pv-image-wrap">
          ${hasPhoto
            ? `<img class="pv-image" id="pv-image" src="${photos[this.photoIndex]}" alt="Photo" />`
            : `<div class="pv-noimage">No image stored for this point</div>`}
          ${multi ? `
            <button class="pv-nav pv-prev" id="pv-prev" title="Previous">‹</button>
            <button class="pv-nav pv-next" id="pv-next" title="Next">›</button>
            <div class="pv-counter">${this.photoIndex + 1} / ${photos.length}</div>
          ` : ''}
        </div>

        <div class="pv-body">
          <div class="pv-meta-grid">
            ${meta.map(([k, v]) => `
              <div class="pv-meta-row">
                <span class="pv-meta-key">${k}</span>
                <span class="pv-meta-val">${v}</span>
              </div>`).join('')}
          </div>
          ${f.notes ? `<div class="pv-notes"><span class="pv-meta-key">Notes</span><p>${this.esc(f.notes)}</p></div>` : ''}
        </div>

        <div class="pv-footer">
          ${hasPhoto ? `<a class="pv-btn" id="pv-download" href="${photos[this.photoIndex]}" download="${this.esc(f.point_id || 'photo')}.jpg">↓ Download</a>` : ''}
          <button class="pv-btn" id="pv-edit">✎ Edit details</button>
          <button class="pv-btn pv-btn-primary" id="pv-done">Done</button>
        </div>
      </div>
    `;

    overlay.querySelector('#pv-close')?.addEventListener('click', () => this.close());
    overlay.querySelector('#pv-done')?.addEventListener('click', () => this.close());
    overlay.querySelector('#pv-backdrop')?.addEventListener('click', () => this.close());

    overlay.querySelector('#pv-edit')?.addEventListener('click', () => {
      const feat = this.feature;
      this.close();
      if (feat) EventBus.emit('feature-selected', { feature: feat });
    });

    overlay.querySelector('#pv-prev')?.addEventListener('click', () => {
      this.photoIndex = (this.photoIndex - 1 + photos.length) % photos.length;
      this.render();
    });
    overlay.querySelector('#pv-next')?.addEventListener('click', () => {
      this.photoIndex = (this.photoIndex + 1) % photos.length;
      this.render();
    });

    if (!this.keyHandler) {
      this.keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') this.close();
        else if (e.key === 'ArrowLeft' && multi) overlay!.querySelector<HTMLButtonElement>('#pv-prev')?.click();
        else if (e.key === 'ArrowRight' && multi) overlay!.querySelector<HTMLButtonElement>('#pv-next')?.click();
      };
      window.addEventListener('keydown', this.keyHandler);
    }
  }
}

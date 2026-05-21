export interface CropBox {
  x: number; // CSS px relative to map container left
  y: number; // CSS px relative to map container top
  w: number; // CSS px
  h: number; // CSS px
}

// Aspect ratio of the MAP_VP slot in the layout template:
// (2048 * 0.8525391) / (1427 * 0.9747722) ≈ 1.2553
const ASPECT = (2048 * 0.8525391) / (1427 * 0.9747722);
const MIN_W = 120;

export class LayoutExtentSelector {
  private overlay: HTMLElement | null = null;
  private box: HTMLElement | null = null;
  private boxX = 0;
  private boxY = 0;
  private boxW = 0;
  private boxH = 0;

  constructor(
    private container: HTMLElement,
    private onConfirm: (crop: CropBox) => void,
    private onCancel: () => void,
  ) {}

  open(): void {
    if (this.overlay) return;

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;

    // Initial box: 80% of container height, ASPECT-constrained, centred
    this.boxH = ch * 0.8;
    this.boxW = this.boxH * ASPECT;
    if (this.boxW > cw * 0.95) {
      this.boxW = cw * 0.95;
      this.boxH = this.boxW / ASPECT;
    }
    this.boxX = (cw - this.boxW) / 2;
    this.boxY = (ch - this.boxH) / 2;

    this.overlay = this.buildOverlay();
    this.container.appendChild(this.overlay);
    this.updateBoxStyle();
    this.wireDragBox();
    this.wireResizeHandles();
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.box = null;
  }

  private buildOverlay(): HTMLElement {
    const ov = document.createElement('div');
    ov.id = 'lm-extent-overlay';

    const header = document.createElement('div');
    header.id = 'lm-ext-header';
    header.innerHTML = `
      <span class="lm-ext-title">
        <svg viewBox="0 0 18 18" fill="currentColor" width="14" height="14"><rect x="1" y="1" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 1v4M13 1v4M5 13v4M13 13v4" stroke="currentColor" stroke-width="1.5"/></svg>
        Step 1 — Frame the map area
      </span>
      <span class="lm-ext-hint">Drag to reposition · Corner handles to resize</span>
      <div class="lm-ext-btns">
        <button id="lm-ext-cancel" class="lm-ext-btn lm-ext-cancel">Cancel</button>
        <button id="lm-ext-confirm" class="lm-ext-btn lm-ext-confirm">Confirm Extent →</button>
      </div>
    `;

    const box = document.createElement('div');
    box.id = 'lm-ext-box';
    this.box = box;

    // Four corner resize handles
    const corners = ['nw', 'ne', 'sw', 'se'] as const;
    for (const c of corners) {
      const h = document.createElement('div');
      h.className = 'lm-ext-handle';
      h.dataset.corner = c;
      box.appendChild(h);
    }

    ov.appendChild(header);
    ov.appendChild(box);

    ov.querySelector('#lm-ext-confirm')?.addEventListener('click', () => this.confirmBox());
    ov.querySelector('#lm-ext-cancel')?.addEventListener('click', () => {
      this.close();
      this.onCancel();
    });

    return ov;
  }

  private updateBoxStyle(): void {
    if (!this.box) return;
    this.box.style.left   = `${this.boxX}px`;
    this.box.style.top    = `${this.boxY}px`;
    this.box.style.width  = `${this.boxW}px`;
    this.box.style.height = `${this.boxH}px`;
  }

  private wireDragBox(): void {
    if (!this.box) return;
    const box = this.box;
    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;

    box.addEventListener('pointerdown', (e: PointerEvent) => {
      if ((e.target as HTMLElement).classList.contains('lm-ext-handle')) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = this.boxX; origY = this.boxY;
      box.setPointerCapture(e.pointerId);
    });

    box.addEventListener('pointermove', (e: PointerEvent) => {
      if (!dragging) return;
      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      this.boxX = Math.max(0, Math.min(cw - this.boxW, origX + (e.clientX - startX)));
      this.boxY = Math.max(0, Math.min(ch - this.boxH, origY + (e.clientY - startY)));
      this.updateBoxStyle();
    });

    box.addEventListener('pointerup', () => { dragging = false; });
  }

  private wireResizeHandles(): void {
    if (!this.box) return;
    this.box.querySelectorAll<HTMLElement>('.lm-ext-handle').forEach(handle => {
      const corner = handle.dataset.corner as 'nw' | 'ne' | 'sw' | 'se';
      let startX = 0, startY = 0;
      let origX = 0, origY = 0, origW = 0, origH = 0;

      handle.addEventListener('pointerdown', (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX; startY = e.clientY;
        origX = this.boxX; origY = this.boxY;
        origW = this.boxW; origH = this.boxH;
        handle.setPointerCapture(e.pointerId);
      });

      handle.addEventListener('pointermove', (e: PointerEvent) => {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        const cw = this.container.clientWidth;
        const ch = this.container.clientHeight;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let newX = origX, newY = origY, newW = origW, newH = origH;

        if (corner === 'se') {
          newW = Math.max(MIN_W, origW + dx);
          newH = newW / ASPECT;
        } else if (corner === 'sw') {
          newW = Math.max(MIN_W, origW - dx);
          newH = newW / ASPECT;
          newX = origX + origW - newW;
        } else if (corner === 'ne') {
          newW = Math.max(MIN_W, origW + dx);
          newH = newW / ASPECT;
          newY = origY + origH - newH;
        } else { // nw
          newW = Math.max(MIN_W, origW - dx);
          newH = newW / ASPECT;
          newX = origX + origW - newW;
          newY = origY + origH - newH;
        }

        // Clamp to container
        newX = Math.max(0, Math.min(cw - newW, newX));
        newY = Math.max(0, Math.min(ch - newH, newY));

        this.boxX = newX; this.boxY = newY;
        this.boxW = newW; this.boxH = newH;
        this.updateBoxStyle();
      });

      handle.addEventListener('pointerup', () => {});
    });
  }

  private confirmBox(): void {
    // Coordinates relative to the container's top-left
    const cr = this.container.getBoundingClientRect();
    const br = this.box!.getBoundingClientRect();
    const crop: CropBox = {
      x: br.left - cr.left,
      y: br.top  - cr.top,
      w: br.width,
      h: br.height,
    };
    this.close();
    this.onConfirm(crop);
  }
}

import { EventBus } from '../utils/EventBus';

interface ModalOptions {
  title: string;
  html: string;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export class Modal {
  private overlay = document.getElementById('modal-overlay')!;
  private content = document.getElementById('modal-content')!;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    EventBus.on<ModalOptions>('show-modal', (opts) => {
      this.show(opts);
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(opts: ModalOptions): void {
    // Cancel any pending hide so a freshly-opened modal isn't torn down by the
    // close animation of the one it replaced (e.g. Drafts list → species search).
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }

    const cancelBtn = (opts.cancelLabel !== undefined || opts.onCancel !== undefined)
      ? `<button class="btn-outline" id="modal-cancel">${opts.cancelLabel ?? 'Cancel'}</button>`
      : '';
    this.content.innerHTML = `
      <div class="modal-header">
        <h3>${opts.title}</h3>
        <button class="panel-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">
        ${opts.html}
      </div>
      <div class="modal-footer">
        <button class="btn-primary" id="modal-confirm">${opts.confirmLabel ?? 'Confirm'}</button>
        ${cancelBtn}
      </div>
    `;

    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('open'));

    document.getElementById('modal-close')?.addEventListener('click', () => {
      opts.onCancel?.();
      this.hide();
    });

    document.getElementById('modal-cancel')?.addEventListener('click', () => {
      opts.onCancel?.();
      this.hide();
    });

    document.getElementById('modal-confirm')?.addEventListener('click', async () => {
      await opts.onConfirm?.();
      this.hide();
    });
  }

  hide(): void {
    this.overlay.classList.remove('open');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { this.overlay.style.display = 'none'; this.hideTimer = null; }, 200);
  }
}

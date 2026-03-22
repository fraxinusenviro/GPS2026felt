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

  constructor() {
    EventBus.on<ModalOptions>('show-modal', (opts) => {
      this.show(opts);
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  show(opts: ModalOptions): void {
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
        <button class="btn-outline" id="modal-cancel">${opts.cancelLabel ?? 'Cancel'}</button>
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
    setTimeout(() => { this.overlay.style.display = 'none'; }, 200);
  }
}

import type { ToastMessage } from '../types';
import { EventBus } from '../utils/EventBus';

export class Toast {
  private container = document.getElementById('toast-container')!;

  constructor() {
    EventBus.on<ToastMessage>('toast', (msg) => {
      this.show(msg);
    });
  }

  show(msg: ToastMessage): void {
    const el = document.createElement('div');
    el.className = `toast toast-${msg.type}`;
    el.innerHTML = `
      <span class="toast-icon">${this.icon(msg.type)}</span>
      <span class="toast-msg">${msg.message}</span>
    `;

    this.container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));

    const duration = msg.duration ?? 3000;
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  private icon(type: string): string {
    const icons: Record<string, string> = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ'
    };
    return icons[type] ?? 'ℹ';
  }
}

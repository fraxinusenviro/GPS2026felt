import { copyToClipboard } from '../utils/coordinates';

interface LogEntry {
  level: 'log' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export class LogConsole {
  private panel: HTMLElement;
  private isOpen = false;
  private entries: LogEntry[] = [];
  private maxEntries = 500;

  constructor() {
    this.panel = this.createPanel();
    document.body.appendChild(this.panel);
    this.interceptConsole();
    this.wirePanel();
  }

  private createPanel(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'log-console';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="log-console-header">
        <span class="log-console-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
          Console
        </span>
        <div class="log-console-actions">
          <button id="log-copy-all" class="log-btn" title="Copy all to clipboard">Copy All</button>
          <button id="log-clear" class="log-btn" title="Clear console">Clear</button>
          <button id="log-close" class="log-btn log-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div id="log-entries" class="log-entries"></div>
    `;
    return el;
  }

  private wirePanel(): void {
    this.panel.querySelector('#log-close')?.addEventListener('click', () => this.hide());
    this.panel.querySelector('#log-clear')?.addEventListener('click', () => {
      this.entries = [];
      this.renderEntries();
    });
    this.panel.querySelector('#log-copy-all')?.addEventListener('click', async () => {
      const text = this.entries
        .map(e => `[${e.timestamp}] ${e.level.toUpperCase()}: ${e.message}`)
        .join('\n');
      await copyToClipboard(text);
    });
  }

  private interceptConsole(): void {
    const self = this;
    const originalLog = console.log.bind(console);
    const originalInfo = console.info.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      self.addEntry('log', args.map(a => self.format(a)).join(' '));
    };
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      self.addEntry('info', args.map(a => self.format(a)).join(' '));
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      self.addEntry('warn', args.map(a => self.format(a)).join(' '));
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      self.addEntry('error', args.map(a => self.format(a)).join(' '));
    };

    // Catch unhandled errors
    window.addEventListener('error', e => {
      self.addEntry('error', `Unhandled: ${e.message} @ ${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', e => {
      self.addEntry('error', `Unhandled Promise: ${e.reason}`);
    });
  }

  private format(val: unknown): string {
    if (val instanceof Error) return `${val.name}: ${val.message}`;
    if (typeof val === 'object' && val !== null) {
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    }
    return String(val);
  }

  addEntry(level: LogEntry['level'], message: string): void {
    const now = new Date();
    const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    this.entries.push({ level, message, timestamp: ts });
    if (this.entries.length > this.maxEntries) this.entries.shift();
    if (this.isOpen) this.appendEntry(this.entries[this.entries.length - 1]);
  }

  private appendEntry(entry: LogEntry): void {
    const container = this.panel.querySelector<HTMLElement>('#log-entries');
    if (!container) return;

    const row = document.createElement('div');
    row.className = `log-entry log-${entry.level}`;
    row.innerHTML = `
      <span class="log-ts">${entry.timestamp}</span>
      <span class="log-lvl">${entry.level.toUpperCase()}</span>
      <span class="log-msg">${this.escapeHtml(entry.message)}</span>
      <button class="log-copy-entry" title="Copy line">⎘</button>
    `;
    row.querySelector('.log-copy-entry')?.addEventListener('click', () => {
      copyToClipboard(`[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`);
    });
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private renderEntries(): void {
    const container = this.panel.querySelector<HTMLElement>('#log-entries');
    if (!container) return;
    container.innerHTML = '';
    this.entries.forEach(e => this.appendEntry(e));
  }

  show(): void {
    this.isOpen = true;
    this.panel.style.display = 'flex';
    this.renderEntries();
  }

  hide(): void {
    this.isOpen = false;
    this.panel.style.display = 'none';
  }

  toggle(): void {
    if (this.isOpen) this.hide(); else this.show();
  }
}

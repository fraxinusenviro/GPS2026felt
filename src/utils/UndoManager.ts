import { EventBus } from './EventBus';

export interface UndoAction {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export class UndoManager {
  private static _instance: UndoManager;
  private past: UndoAction[] = [];
  private future: UndoAction[] = [];
  private _locked = false;
  private readonly maxHistory = 50;

  static getInstance(): UndoManager {
    if (!UndoManager._instance) UndoManager._instance = new UndoManager();
    return UndoManager._instance;
  }

  get locked(): boolean { return this._locked; }

  push(action: UndoAction): void {
    if (this._locked) return;
    this.past.push(action);
    if (this.past.length > this.maxHistory) this.past.shift();
    this.future = [];
    this.notifyUI();
  }

  async undo(): Promise<void> {
    if (this._locked || this.past.length === 0) return;
    const action = this.past.pop()!;
    this._locked = true;
    try {
      await action.undo();
    } finally {
      this._locked = false;
    }
    this.future.push(action);
    this.notifyUI();
    EventBus.emit('toast', { message: `Undid: ${action.description}`, type: 'info', duration: 1500 });
  }

  async redo(): Promise<void> {
    if (this._locked || this.future.length === 0) return;
    const action = this.future.pop()!;
    this._locked = true;
    try {
      await action.redo();
    } finally {
      this._locked = false;
    }
    this.past.push(action);
    this.notifyUI();
    EventBus.emit('toast', { message: `Redid: ${action.description}`, type: 'info', duration: 1500 });
  }

  canUndo(): boolean { return this.past.length > 0; }
  canRedo(): boolean { return this.future.length > 0; }

  private notifyUI(): void {
    const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement | null;
    if (undoBtn) {
      undoBtn.disabled = !this.canUndo();
      undoBtn.title = this.canUndo()
        ? `Undo: ${this.past[this.past.length - 1].description} (Ctrl+Z)`
        : 'Nothing to undo (Ctrl+Z)';
    }
    const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement | null;
    if (redoBtn) {
      redoBtn.disabled = !this.canRedo();
      redoBtn.title = this.canRedo()
        ? `Redo: ${this.future[this.future.length - 1].description} (Ctrl+Y)`
        : 'Nothing to redo (Ctrl+Y)';
    }
  }
}

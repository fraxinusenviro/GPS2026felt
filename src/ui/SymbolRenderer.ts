import type { Map as MLMap } from 'maplibre-gl';
import type { TypePreset } from '../types';

// Lucide-style SVG paths (24×24 coordinate space, stroke-based)
export const ICON_PATHS: Record<string, string> = {
  tree:     'M12 2L7 11h3.5v9h3v-9H17L12 2z',
  building: 'M3 21V8l9-6 9 6v13H3zM9 21v-6h6v6',
  water:    'M6.5 22C4 17.5 4 13 6.5 10S9 7 9 3.5c0 0 3 1.5 3 5s-3 4-3 7.5 3 4 3 5.5',
  warning:  'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
  star:     'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  home:     'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM9 22V12h6v10',
  flag:     'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zM4 22v-7',
  pin:      'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0zM12 13a3 3 0 100-6 3 3 0 000 6z',
  camera:   'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11zM12 16a4 4 0 100-8 4 4 0 000 8z',
  leaf:     'M6.5 22C4 17.5 4 14 8.5 10S18 5 22 2c-3 3-3 7.5-6.5 11S7 17.5 6.5 22z',
  cross:    'M12 2v20M2 12h20',
  exclaim:  'M12 8v4m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z',
};

export const AVAILABLE_ICONS = Object.keys(ICON_PATHS);

// Canvas size for symbol rendering (48×48 → displayed at icon-size fraction)
const CANVAS_SIZE = 48;

function hexToRgba(hex: string, alpha = 1): string {
  const clean = hex.replace('#', '').padStart(6, '0');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case 'square': {
      const s = r * 1.45;
      const rad = Math.max(2, s * 0.18);
      if (ctx.roundRect) {
        ctx.roundRect(cx - s, cy - s, s * 2, s * 2, rad);
      } else {
        ctx.rect(cx - s, cy - s, s * 2, s * 2);
      }
      break;
    }
    case 'diamond': {
      const d = r * 1.4;
      ctx.moveTo(cx, cy - d);
      ctx.lineTo(cx + d, cy);
      ctx.lineTo(cx, cy + d);
      ctx.lineTo(cx - d, cy);
      ctx.closePath();
      break;
    }
    case 'triangle': {
      const t = r * 1.5;
      ctx.moveTo(cx, cy - t);
      ctx.lineTo(cx + t * 0.866, cy + t * 0.5);
      ctx.lineTo(cx - t * 0.866, cy + t * 0.5);
      ctx.closePath();
      break;
    }
    default: // circle
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }
}

function renderPresetCanvas(preset: TypePreset): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;

  const cx = CANVAS_SIZE / 2;
  const cy = CANVAS_SIZE / 2;
  // Max radius inside canvas with 3px margin for stroke
  const r = Math.max(4, Math.min((preset.size ?? 7) * 2.2, CANVAS_SIZE / 2 - 3));
  const fillOpacity = preset.fill_opacity ?? 1.0;
  const strokeColor = preset.stroke_color ?? '#ffffff';
  const strokeWidth = Math.max(1, preset.stroke_width ?? 2);
  const shape = preset.shape ?? 'circle';

  // Background shape
  drawShape(ctx, shape, cx, cy, r);
  ctx.fillStyle = hexToRgba(preset.color, fillOpacity);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();

  // Icon overlay
  if (preset.icon && ICON_PATHS[preset.icon]) {
    const iconColor = preset.icon_color ?? '#ffffff';
    const iconSize = r * 1.3;
    const offset = cx - iconSize / 2;

    ctx.save();
    ctx.translate(offset, offset);
    const scale = iconSize / 24;
    ctx.scale(scale, scale);
    ctx.strokeStyle = iconColor;
    ctx.lineWidth = Math.max(1.5, 1.8 / scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'transparent';
    const path = new Path2D(ICON_PATHS[preset.icon]);
    ctx.stroke(path);
    ctx.restore();
  }

  return canvas;
}

export class SymbolRenderer {
  private registeredIds = new Set<string>();

  constructor(private map: MLMap) {}

  imageKey(preset: TypePreset): string {
    return `preset-${preset.id}`;
  }

  /** Register (or refresh) a single preset's canvas image in MapLibre. */
  register(preset: TypePreset): void {
    if (!preset.id) return;
    const key = this.imageKey(preset);
    const canvas = renderPresetCanvas(preset);
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (this.map.hasImage(key)) this.map.removeImage(key);
    this.map.addImage(key, imageData, { sdf: false });
    this.registeredIds.add(preset.id);
  }

  /** Register all presets. */
  registerAll(presets: TypePreset[]): void {
    for (const p of presets) this.register(p);
  }

  unregister(presetId: string): void {
    const key = `preset-${presetId}`;
    if (this.map.hasImage(key)) this.map.removeImage(key);
    this.registeredIds.delete(presetId);
  }
}

/**
 * Render a small canvas swatch for display in preset lists (no MapLibre dependency).
 * Returns a data URL.
 */
export function renderSwatchDataUrl(preset: TypePreset, displaySize = 22): string {
  const canvas = renderPresetCanvas(preset);
  // Scale down to displaySize
  const out = document.createElement('canvas');
  out.width = out.height = displaySize;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, displaySize, displaySize);
  return out.toDataURL();
}

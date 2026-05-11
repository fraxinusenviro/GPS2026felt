import type { Map as MLMap } from 'maplibre-gl';
import type { TypePreset } from '../types';

// Lucide-style SVG paths (24×24 coordinate space, stroke-based)
export const ICON_PATHS: Record<string, string> = {
  // Common
  warning:    'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4m0 4h.01',
  star:       'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  home:       'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM9 22V12h6v10',
  flag:       'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1v12zM4 22v-7',
  pin:        'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0zM12 13a3 3 0 100-6 3 3 0 000 6z',
  camera:     'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2v11zM12 16a4 4 0 100-8 4 4 0 000 8z',
  cross:      'M12 2v20M2 12h20',
  exclaim:    'M12 8v4m0 4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z',
  building:   'M3 21V8l9-6 9 6v13H3zM9 21v-6h6v6',

  // Shapes
  hexagon:    'M12 3l8.66 5v10L12 21l-8.66-5V8z',
  pentagon:   'M12 3l8.09 5.88-3.09 9.5H7L3.91 8.88z',
  triangle:   'M12 4L22 20H2z',

  // Aquatic
  fish:       'M6 12C6 8 9 5 14 5C18 5 21 8 21 12C21 16 18 19 14 19C9 19 6 16 6 12ZM21 12L24 9M21 12L24 15',
  fish_symbol:'M2 12s5-7 10-7 10 7 10 7-5 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  water:      'M6.5 22C4 17.5 4 13 6.5 10S9 7 9 3.5c0 0 3 1.5 3 5s-3 4-3 7.5 3 4 3 5.5',
  wave:       'M2 12c2-4 5-4 7 0s5 4 7 0 5-4 7 0',

  // Animals
  bird:       'M22 7s-4 1-8 5c-2 2-3 6-3 9M22 7c-2-1-5-1-7 0-3 2-4 7-3 10M3 19s2-3 5-5',
  paw:        'M11 13a4 4 0 018 0c0 3-2.5 5.5-4 7H9c-1.5-1.5-4-4-4-7a4 4 0 018 0zM7.5 8a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM16.5 8a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM14 5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z',
  rabbit:     'M9 6a3 3 0 00-3 3v1M15 6a3 3 0 013 3v1M6 10c-1 2-1 4 0 5s3 2 6 2 5-1 6-2 1-3 0-5M6 15c0 3 1.5 6 3 7M18 15c0 3-1.5 6-3 7M9 22h6M12 22v-7',
  deer:       'M7 4C6 2 5 2 5 3M17 4c1-2 2-2 2-1M5 3c-1 1-1 3 1 4M19 3c1 1 1 3-1 4M6 7c-2 2-2 6 0 8M18 7c2 2 2 6 0 8M6 15c0 3 2 5 6 5M18 15c0 3-2 5-6 5M9 20l-1 3M15 20l1 3M12 10a3 3 0 110 6 3 3 0 010-6z',
  turtle:     'M12 4a4 4 0 110 8 4 4 0 010-8zM8 12c-3 1-4 3-4 5h16c0-2-1-4-4-5M7 17l-2 4M17 17l2 4M12 17v4',
  dragonfly:  'M12 8v8M9 5c-2 2-2 5 0 6M15 5c2 2 2 5 0 6M9 11c-3 0-5 2-4 4M15 11c3 0 5 2 4 4M10 16l-4 5M14 16l4 5M10 8h4',
  butterfly:  'M12 12c-2.5-4-7-5-9-2s1 6 4 5c2-.5 4-2 5-3M12 12c2.5-4 7-5 9-2s-1 6-4 5c-2-.5-4-2-5-3M12 12c-.5 2.5-1 5.5 0 8M12 12c.5-1.5.5-3 0-4',

  // Nature
  tree:       'M12 2L7 11h3.5v9h3v-9H17L12 2z',
  leaf:       'M6.5 22C4 17.5 4 14 8.5 10S18 5 22 2c-3 3-3 7.5-6.5 11S7 17.5 6.5 22z',
  mountain:   'M3 20l9-14 9 14H3zM9 20l3-5 3 5',
  sun:        'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M12 17a5 5 0 100-10 5 5 0 000 10z',
  moon:       'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z',
  cloud:      'M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z',
  snowflake:  'M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07',
  flower:     'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M3 12H6M18 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12',
  mushroom:   'M12 4c-4 0-7 3-7 7v1h14v-1c0-4-3-7-7-7zM5 12h14M12 12v9M9 21h6',
  flame:      'M12 2c0 4-4 6-4 10a5 5 0 0010 0c0-4-4-6-4-10zM9.5 18.5c.5 1 1.5 2 2.5 2s2-1 2.5-2',
};

export const ICON_CATEGORIES: Array<{ label: string; icons: string[] }> = [
  { label: 'Common',  icons: ['warning', 'star', 'home', 'flag', 'pin', 'camera', 'cross', 'exclaim', 'building'] },
  { label: 'Shapes',  icons: ['hexagon', 'pentagon', 'triangle'] },
  { label: 'Aquatic', icons: ['fish', 'fish_symbol', 'water', 'wave'] },
  { label: 'Animals', icons: ['bird', 'paw', 'rabbit', 'deer', 'turtle', 'dragonfly', 'butterfly'] },
  { label: 'Nature',  icons: ['tree', 'leaf', 'mountain', 'sun', 'moon', 'cloud', 'snowflake', 'flower', 'mushroom', 'flame'] },
];

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
  const shapeRad = ((preset.rotation ?? 0) * Math.PI) / 180;

  // Background shape (with optional rotation)
  ctx.save();
  if (shapeRad !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(shapeRad);
    ctx.translate(-cx, -cy);
  }
  drawShape(ctx, shape, cx, cy, r);
  ctx.fillStyle = hexToRgba(preset.color, fillOpacity);
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
  ctx.restore();

  // Icon overlay (with optional rotation)
  if (preset.icon && ICON_PATHS[preset.icon]) {
    const iconColor = preset.icon_color ?? '#ffffff';
    const iconSize = r * 1.3;
    const offset = cx - iconSize / 2;
    const iconRad = ((preset.icon_rotation ?? 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    if (iconRad !== 0) ctx.rotate(iconRad);
    ctx.translate(-iconSize / 2, -iconSize / 2);
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
    void offset; // suppress unused warning
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

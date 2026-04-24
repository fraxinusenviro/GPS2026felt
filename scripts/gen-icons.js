// Generate all PWA PNG icons from public/icon.svg
// Usage: node scripts/gen-icons.js
// Requires: pip install cairosvg  (or npm install sharp)

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const svgSrc = 'public/icon.svg';
const maskableSvgSrc = 'public/icon-maskable.svg';

const icons = [
  { src: svgSrc, out: 'public/favicon-16.png', size: 16 },
  { src: svgSrc, out: 'public/favicon-32.png', size: 32 },
  { src: svgSrc, out: 'public/apple-touch-icon.png', size: 180 },
  { src: svgSrc, out: 'public/icon-192.png', size: 192 },
  { src: svgSrc, out: 'public/icon-512.png', size: 512 },
  { src: maskableSvgSrc, out: 'public/icon-maskable-192.png', size: 192 },
  { src: maskableSvgSrc, out: 'public/icon-maskable-512.png', size: 512 },
];

// Try cairosvg (Python)
try {
  const py = icons.map(({ src, out, size }) =>
    `cairosvg.svg2png(url="${src}", write_to="${out}", output_width=${size}, output_height=${size})`
  ).join('\n');
  execSync(`python3 -c "import cairosvg\n${py}"`, { stdio: 'inherit' });
  console.log('All icons generated via cairosvg.');
  process.exit(0);
} catch { /* fall through */ }

// Try sharp (Node)
try {
  const { default: sharp } = await import('sharp');
  for (const { src, out, size } of icons) {
    await sharp(src).resize(size, size).png().toFile(out);
    console.log(`Generated ${out}`);
  }
  console.log('All icons generated via sharp.');
  process.exit(0);
} catch { /* fall through */ }

console.error('Neither cairosvg nor sharp is available.\n  pip install cairosvg  OR  npm install sharp');
process.exit(1);

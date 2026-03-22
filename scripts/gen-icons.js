// Script to generate PNG icons from SVG
// Run: node scripts/gen-icons.js
// Requires: npm install -g @resvg/resvg-js or use sharp

import { readFileSync, writeFileSync } from 'fs';

const svgContent = readFileSync('public/icon.svg', 'utf-8');

// If sharp is available
try {
  const { default: sharp } = await import('sharp');
  const buffer = Buffer.from(svgContent);
  await sharp(buffer).resize(192, 192).png().toFile('public/icon-192.png');
  await sharp(buffer).resize(512, 512).png().toFile('public/icon-512.png');
  console.log('PNG icons generated successfully');
} catch {
  console.log('sharp not available - using SVG icons (will work for PWA in most browsers)');
  // Copy SVG as fallback
  writeFileSync('public/icon-192.png', readFileSync('public/icon.svg'));
  writeFileSync('public/icon-512.png', readFileSync('public/icon.svg'));
}

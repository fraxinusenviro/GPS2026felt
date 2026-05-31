import { BASEMAPS, BASEMAP_OVERLAYS } from '../constants';
import type { BasemapDef } from '../types';

// ── SVG thumbnail helpers ─────────────────────────────────────────────────────

const svg = (content: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90">${content}</svg>`)}`;

const grad = (id: string, x1: string, y1: string, x2: string, y2: string, stops: string) =>
  `<defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient></defs>`;

const stop = (pct: string, col: string) => `<stop offset="${pct}" stop-color="${col}"/>`;

// ── Per-layer SVG thumbnails ──────────────────────────────────────────────────

const LAYER_THUMBS: Record<string, string> = {

  // ---- Elevation (DTM/DSM hillshades) ----
  'hrdem-dtm-hillshade': svg(
    grad('g','0','0','1','1',stop('0%','#e8e8e8')+stop('45%','#a0a0a0')+stop('100%','#1c1c1c')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<path d="M0,62 Q18,52 38,58 Q60,64 80,50 Q102,36 122,44 Q144,52 160,40" stroke="rgba(255,255,255,0.18)" stroke-width="1" fill="none"/>' +
    '<path d="M0,40 Q22,30 44,38 Q70,46 90,28 Q112,10 136,20 Q150,28 160,18" stroke="rgba(0,0,0,0.18)" stroke-width="0.8" fill="none"/>' +
    '<text x="8" y="82" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.5)">DTM Hillshade · 1–2 m LiDAR</text>'
  ),
  'hrdem-dsm-hillshade': svg(
    grad('g','0','0','1','1',stop('0%','#d8e0d0')+stop('45%','#8a9880')+stop('100%','#141c10')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<path d="M0,55 Q20,45 45,52 Q70,60 95,42 Q118,26 140,36 Q152,42 160,30" stroke="rgba(255,255,255,0.15)" stroke-width="1" fill="none"/>' +
    '<path d="M0,35 Q25,28 50,36 Q78,44 100,22 Q124,2 145,14 Q154,20 160,12" stroke="rgba(0,0,0,0.15)" stroke-width="0.8" fill="none"/>' +
    '<text x="8" y="82" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.5)">DSM Hillshade · includes canopy</text>'
  ),

  // ---- HRDEM products ----
  'hrdem-elevation': svg(
    grad('g','0','1','0','0',
      stop('0%','#1a3a8a')+stop('18%','#2e86ab')+stop('32%','#3cb878')+stop('52%','#70a025')+
      stop('68%','#c8a040')+stop('82%','#8b4513')+stop('94%','#c0c0c0')+stop('100%','#ffffff')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<path d="M0,72 Q30,68 60,74 Q90,80 120,70 Q145,62 160,66" stroke="rgba(0,0,0,0.2)" stroke-width="0.6" fill="none"/>' +
    '<path d="M0,55 Q25,50 55,56 Q85,62 110,50 Q135,40 160,46" stroke="rgba(0,0,0,0.2)" stroke-width="0.6" fill="none"/>' +
    '<path d="M0,38 Q28,32 58,38 Q88,44 112,30 Q136,18 160,26" stroke="rgba(0,0,0,0.15)" stroke-width="0.5" fill="none"/>' +
    '<text x="8" y="82" font-size="8" font-family="sans-serif" fill="rgba(0,0,0,0.45)">DTM Elevation · terrain colour ramp</text>'
  ),
  'hrdem-slope': svg(
    grad('g','0','1','0','0',
      stop('0%','#1a6e1a')+stop('30%','#a0c030')+stop('55%','#f0d000')+stop('75%','#e07010')+stop('100%','#b01010')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<path d="M0,80 L30,80 L30,60 L60,60 L60,40 L90,40 L90,20 L120,20 L120,10 L160,10" stroke="rgba(0,0,0,0.25)" stroke-width="1" fill="none"/>' +
    '<text x="4" y="88" font-size="7" font-family="sans-serif" fill="rgba(0,0,0,0.5)">0°</text>' +
    '<text x="138" y="16" font-size="7" font-family="sans-serif" fill="rgba(255,255,255,0.6)">45°+</text>' +
    '<text x="8" y="82" font-size="7.5" font-family="sans-serif" fill="rgba(255,255,255,0.0)"> </text>'
  ),
  'hrdem-aspect': svg(
    '<rect width="160" height="90" fill="#0d1a10"/>' +
    '<defs>' +
    '<radialGradient id="rn" cx="50%" cy="0%" r="50%"><stop offset="0%" stop-color="#3a8abf" stop-opacity="0.9"/><stop offset="100%" stop-color="transparent"/></radialGradient>' +
    '<radialGradient id="re" cx="100%" cy="50%" r="50%"><stop offset="0%" stop-color="#f0a030" stop-opacity="0.85"/><stop offset="100%" stop-color="transparent"/></radialGradient>' +
    '<radialGradient id="rs" cx="50%" cy="100%" r="50%"><stop offset="0%" stop-color="#d04020" stop-opacity="0.85"/><stop offset="100%" stop-color="transparent"/></radialGradient>' +
    '<radialGradient id="rw" cx="0%" cy="50%" r="50%"><stop offset="0%" stop-color="#9040c0" stop-opacity="0.85"/><stop offset="100%" stop-color="transparent"/></radialGradient>' +
    '</defs>' +
    '<ellipse cx="80" cy="45" rx="70" ry="40" fill="url(#rn)"/>' +
    '<ellipse cx="80" cy="45" rx="70" ry="40" fill="url(#re)"/>' +
    '<ellipse cx="80" cy="45" rx="70" ry="40" fill="url(#rs)"/>' +
    '<ellipse cx="80" cy="45" rx="70" ry="40" fill="url(#rw)"/>' +
    '<text x="74" y="14" font-size="9" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">N</text>' +
    '<text x="74" y="84" font-size="9" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">S</text>' +
    '<text x="146" y="50" font-size="9" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">E</text>' +
    '<text x="4" y="50" font-size="9" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">W</text>'
  ),
  'hrdem-tpi': svg(
    grad('g','0','0','1','0',
      stop('0%','#2166ac')+stop('35%','#74add1')+stop('50%','#ffffbf')+stop('65%','#f46d43')+stop('100%','#a50026')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<line x1="80" y1="0" x2="80" y2="90" stroke="rgba(0,0,0,0.2)" stroke-width="0.8"/>' +
    '<text x="4" y="50" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)">Valley</text>' +
    '<text x="58" y="50" font-size="8" font-family="sans-serif" fill="rgba(0,0,0,0.5)">Flat</text>' +
    '<text x="118" y="50" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)">Ridge</text>'
  ),
  'hrdem-contours': svg(
    '<rect width="160" height="90" fill="#f0ead8"/>' +
    // Index contours (bold)
    '<path d="M-5,22 Q20,16 45,24 Q70,32 95,20 Q120,8 145,18 Q155,22 165,18" stroke="#c4a870" stroke-width="1.4" fill="none"/>' +
    '<path d="M-5,72 Q22,66 48,74 Q74,82 100,68 Q125,56 145,64 Q155,68 165,62" stroke="#c4a870" stroke-width="1.4" fill="none"/>' +
    // Regular contours (thin)
    '<path d="M-5,32 Q18,28 42,34 Q66,40 90,30 Q114,20 140,28 Q152,32 165,28" stroke="#c4a870" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,42 Q16,38 40,44 Q64,50 88,40 Q112,30 138,38 Q150,42 165,38" stroke="#c4a870" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,52 Q14,48 38,54 Q62,60 86,50 Q110,40 136,48 Q148,52 165,48" stroke="#c4a870" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,62 Q16,58 42,64 Q68,70 94,58 Q118,48 142,56 Q152,60 165,56" stroke="#c4a870" stroke-width="0.7" fill="none"/>' +
    '<text x="8" y="88" font-size="7.5" font-family="sans-serif" fill="rgba(0,0,0,0.4)">HRDEM contour lines · on-demand</text>'
  ),
  'hrdem-dsm-elevation': svg(
    grad('g','0','1','0','0',
      stop('0%','#1a3a8a')+stop('15%','#2e86ab')+stop('30%','#3cb878')+stop('48%','#70a025')+
      stop('65%','#c8a040')+stop('80%','#8b4513')+stop('92%','#c0c0c0')+stop('100%','#ffffff')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    // building/structure outlines suggesting DSM
    '<rect x="25" y="28" width="14" height="10" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>' +
    '<rect x="55" y="20" width="18" height="12" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>' +
    '<rect x="100" y="24" width="12" height="10" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="0.8"/>' +
    '<text x="8" y="82" font-size="8" font-family="sans-serif" fill="rgba(0,0,0,0.4)">DSM Elevation · includes structures</text>'
  ),
  'hrdem-chm': svg(
    grad('g','0','1','0','0',
      stop('0%','#e8f5e0')+stop('20%','#a8d878')+stop('50%','#4a9830')+stop('80%','#1a5a10')+stop('100%','#0a2808')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    // tree canopy silhouettes
    '<ellipse cx="28" cy="42" rx="14" ry="18" fill="rgba(0,0,0,0.15)"/>' +
    '<ellipse cx="60" cy="32" rx="18" ry="22" fill="rgba(0,0,0,0.15)"/>' +
    '<ellipse cx="95" cy="28" rx="16" ry="20" fill="rgba(0,0,0,0.15)"/>' +
    '<ellipse cx="128" cy="36" rx="14" ry="18" fill="rgba(0,0,0,0.15)"/>' +
    '<text x="8" y="82" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.5)">CHM · canopy height model</text>'
  ),

  // ---- NS Vector layers ----
  'ns-plan-nsprd': svg(
    '<rect width="160" height="90" fill="#0e1a12"/>' +
    // horizontal parcel lines
    '<line x1="0" y1="22" x2="160" y2="22" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="0" y1="44" x2="160" y2="44" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="0" y1="66" x2="160" y2="66" stroke="#888" stroke-width="0.6"/>' +
    // vertical parcel lines
    '<line x1="28" y1="0" x2="28" y2="90" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="58" y1="0" x2="58" y2="90" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="90" y1="0" x2="90" y2="90" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="118" y1="0" x2="118" y2="90" stroke="#888" stroke-width="0.6"/>' +
    '<line x1="145" y1="0" x2="145" y2="90" stroke="#888" stroke-width="0.6"/>' +
    // slightly irregular sub-parcels
    '<line x1="0" y1="33" x2="58" y2="33" stroke="#666" stroke-width="0.5"/>' +
    '<line x1="90" y1="55" x2="160" y2="55" stroke="#666" stroke-width="0.5"/>' +
    '<line x1="44" y1="0" x2="44" y2="44" stroke="#666" stroke-width="0.5"/>' +
    '<line x1="118" y1="44" x2="118" y2="90" stroke="#555" stroke-width="0.5"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(200,200,200,0.6)">PID parcels · ESRI REST</text>'
  ),
  'ns-nshn-watercourses': svg(
    '<rect width="160" height="90" fill="#0a1820"/>' +
    '<path d="M0,18 Q12,14 24,20 Q38,28 52,22 Q68,14 80,22 Q94,30 108,24 Q124,16 140,22 Q152,26 160,20" stroke="#4a90f0" stroke-width="2.2" fill="none"/>' +
    '<path d="M0,42 Q15,36 30,44 Q50,54 70,46 Q88,38 100,46 Q115,56 135,48 Q148,42 160,48" stroke="#4a90f0" stroke-width="1.5" fill="none"/>' +
    '<path d="M0,66 Q20,60 40,68 Q60,76 80,64 Q100,52 118,62 Q136,72 160,64" stroke="#4a90f0" stroke-width="1.0" fill="none"/>' +
    '<path d="M50,22 Q55,34 60,44" stroke="#3a80e0" stroke-width="0.8" fill="none"/>' +
    '<path d="M108,24 Q112,36 110,46" stroke="#3a80e0" stroke-width="0.8" fill="none"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(80,150,240,0.6)">NSHN watercourses · classified</text>'
  ),
  'ns-nshn-waterbodies': svg(
    '<rect width="160" height="90" fill="#0a1820"/>' +
    '<path d="M32,12 Q58,8 80,16 Q104,24 112,40 Q118,56 108,68 Q96,80 72,82 Q46,84 30,70 Q12,56 14,38 Q16,20 32,12 Z" fill="#1a4a8a" stroke="#4a90f0" stroke-width="0.8"/>' +
    '<path d="M100,14 Q118,12 130,22 Q142,32 138,44 Q134,54 122,56 Q108,58 100,48 Q92,38 96,26 Z" fill="#1a3a7a" stroke="#3a80e0" stroke-width="0.6"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(80,150,240,0.6)">NSHN waterbodies · lakes &amp; ponds</text>'
  ),
  'ns-nshn-wetlands': svg(
    '<rect width="160" height="90" fill="#0a1208"/>' +
    '<path d="M14,14 Q38,8 65,16 Q90,24 100,40 Q108,54 96,66 Q82,78 56,80 Q28,82 14,66 Q0,50 4,32 Z" fill="#d4a010" fill-opacity="0.55" stroke="#000" stroke-width="0.7"/>' +
    '<path d="M108,20 Q128,16 142,28 Q155,40 150,55 Q145,68 130,70 Q112,72 106,58 Q100,44 108,30 Z" fill="#eab515" fill-opacity="0.45" stroke="#000" stroke-width="0.5"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(220,180,20,0.6)">NSHN wetlands · bogs, fens, marshes</text>'
  ),
  'ns-base-contours': svg(
    '<rect width="160" height="90" fill="#f0ead8"/>' +
    '<path d="M-5,15 Q25,10 55,17 Q82,24 110,14 Q135,5 165,12" stroke="#8a6030" stroke-width="1.5" fill="none"/>' +
    '<path d="M-5,30 Q20,26 48,32 Q74,38 100,26 Q126,14 160,24" stroke="#a07840" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,44 Q18,40 46,46 Q72,52 98,40 Q124,28 160,38" stroke="#a07840" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,58 Q16,54 44,60 Q70,66 96,54 Q122,42 160,52" stroke="#8a6030" stroke-width="1.5" fill="none"/>' +
    '<path d="M-5,72 Q14,68 42,74 Q68,80 94,68 Q120,56 160,66" stroke="#a07840" stroke-width="0.7" fill="none"/>' +
    '<path d="M-5,84 Q12,80 40,86 Q66,88 92,78 Q118,68 160,78" stroke="#a07840" stroke-width="0.7" fill="none"/>' +
    '<text x="8" y="86" font-size="7.5" font-family="sans-serif" fill="rgba(0,0,0,0.35)">NSTDB 10k contours · 10m interval</text>'
  ),
  'ns-base-parks': svg(
    '<rect width="160" height="90" fill="#0e2010"/>' +
    '<path d="M20,10 Q60,5 100,12 Q135,18 148,38 Q158,55 148,70 Q136,84 100,87 Q62,90 30,80 Q6,70 4,50 Q2,28 20,10 Z" fill="#1a5a20" stroke="#2a7a30" stroke-width="1.2"/>' +
    // tree symbols
    '<polygon points="40,60 48,38 56,60" fill="#2a8830" opacity="0.7"/>' +
    '<polygon points="70,55 80,30 90,55" fill="#2a8830" opacity="0.7"/>' +
    '<polygon points="96,62 104,42 112,62" fill="#2a8830" opacity="0.7"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(80,200,80,0.5)">Parks &amp; Protected Areas</text>'
  ),
  'ns-base-designated': svg(
    '<rect width="160" height="90" fill="#0e1208"/>' +
    '<path d="M18,12 Q50,6 85,14 Q118,22 140,38 Q155,52 148,68 Q138,82 108,86 Q72,90 40,78 Q12,66 8,46 Q4,24 18,12 Z" fill="none" stroke="#c8a830" stroke-width="1.5" stroke-dasharray="4,3"/>' +
    '<path d="M18,12 Q50,6 85,14 Q118,22 140,38 Q155,52 148,68 Q138,82 108,86 Q72,90 40,78 Q12,66 8,46 Q4,24 18,12 Z" fill="#c8a830" fill-opacity="0.12"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(200,170,40,0.6)">Designated Areas · boundaries</text>'
  ),
  'ns-bio-habitat': svg(
    '<rect width="160" height="90" fill="#080e08"/>' +
    '<path d="M4,4 Q30,4 50,20 Q68,36 60,54 Q50,70 28,74 Q6,78 4,56 Z" fill="#ff0000" fill-opacity="0.45" stroke="#ff0000" stroke-width="0.6"/>' +
    '<path d="M52,8 Q80,4 100,18 Q118,32 114,52 Q108,68 88,70 Q64,72 56,54 Q48,36 52,8 Z" fill="#5aaa88" fill-opacity="0.45" stroke="#4a9a78" stroke-width="0.6"/>' +
    '<path d="M96,10 Q128,8 148,24 Q164,40 156,62 Q148,80 124,82 Q104,84 96,64 Q88,46 96,10 Z" fill="#5080aa" fill-opacity="0.45" stroke="#4070aa" stroke-width="0.6"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(200,200,200,0.5)">Significant Habitat · SAR, deer, bird</text>'
  ),
  'ns-bio-nsnrr-wetlands': svg(
    '<rect width="160" height="90" fill="#0a0e0a"/>' +
    '<path d="M4,6 Q24,4 36,16 Q46,28 40,44 Q34,58 18,60 Q4,62 2,46 Q0,28 4,6 Z" fill="#4c0073" fill-opacity="0.7"/>' +
    '<path d="M38,4 Q62,2 76,16 Q88,28 82,46 Q76,62 56,64 Q38,66 34,48 Q28,28 38,4 Z" fill="#aaaa40" fill-opacity="0.6"/>' +
    '<path d="M78,8 Q102,4 118,18 Q132,32 126,50 Q120,66 100,68 Q80,70 76,52 Q70,32 78,8 Z" fill="#5aaa88" fill-opacity="0.6"/>' +
    '<path d="M118,12 Q144,8 156,26 Q166,44 156,60 Q146,74 128,74 Q112,74 110,58 Q108,40 118,12 Z" fill="#5aaada" fill-opacity="0.6"/>' +
    '<text x="8" y="84" font-size="7.5" font-family="sans-serif" fill="rgba(200,200,200,0.5)">NSNRR Wetlands · bog/fen/marsh/swamp</text>'
  ),
  'ns-for-old-growth': svg(
    '<rect width="160" height="90" fill="#0a1208"/>' +
    '<path d="M8,8 Q40,4 70,12 Q98,20 110,38 Q120,54 108,68 Q94,82 64,84 Q34,86 14,70 Q-4,54 2,34 Z" fill="#1a4010" stroke="#2a5818" stroke-width="0.8"/>' +
    '<path d="M70,14 Q100,10 128,22 Q152,34 152,54 Q152,72 130,80 Q108,86 90,74 Q72,62 74,44 Z" fill="#2d6a1e" stroke="#3a7a28" stroke-width="0.8"/>' +
    // old tree symbols
    '<polygon points="30,70 38,44 46,70" fill="#4a9030" opacity="0.5"/>' +
    '<polygon points="80,65 90,38 100,65" fill="#4a9030" opacity="0.5"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(80,180,60,0.5)">Old Growth Forest Policy areas</text>'
  ),
  'ns-for-fec-soil': svg(
    '<rect width="160" height="90" fill="#1a0e08"/>' +
    '<path d="M0,0 L65,0 L65,45 L0,45 Z" fill="#c8a46e" fill-opacity="0.7"/>' +
    '<path d="M65,0 L160,0 L160,30 L65,30 Z" fill="#a08050" fill-opacity="0.7"/>' +
    '<path d="M0,45 L80,45 L80,90 L0,90 Z" fill="#b89060" fill-opacity="0.7"/>' +
    '<path d="M80,30 L160,30 L160,70 L80,70 Z" fill="#d4b080" fill-opacity="0.7"/>' +
    '<path d="M65,45 L80,45 L80,90 L160,90 L160,70 Z" fill="#c0a070" fill-opacity="0.6"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(0,0,0,0.4)">FEC Soil Type · forest site quality</text>'
  ),
  'ns-trns-roads': svg(
    '<rect width="160" height="90" fill="#0e1208"/>' +
    // highway (yellow, wide)
    '<path d="M0,45 Q40,42 80,45 Q120,48 160,45" stroke="#f0c040" stroke-width="3" fill="none"/>' +
    // arterials (orange)
    '<path d="M28,0 Q32,22 35,45 Q38,65 42,90" stroke="#e0a030" stroke-width="1.8" fill="none"/>' +
    '<path d="M110,0 Q115,22 118,45 Q120,65 122,90" stroke="#e0a030" stroke-width="1.8" fill="none"/>' +
    // collectors (gray)
    '<path d="M0,22 Q30,20 55,25 Q75,30 90,22 Q110,14 140,20 Q152,24 160,20" stroke="#c8c8c8" stroke-width="1.2" fill="none"/>' +
    '<path d="M0,70 Q28,68 55,72 Q80,76 100,68 Q125,60 160,66" stroke="#c8c8c8" stroke-width="1.2" fill="none"/>' +
    // rural roads (thin)
    '<path d="M0,8 Q20,6 40,10" stroke="#886644" stroke-width="0.7" fill="none"/>' +
    '<path d="M120,78 Q140,76 160,80" stroke="#886644" stroke-width="0.7" fill="none"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(200,200,200,0.5)">NSRN · highways, collectors, local</text>'
  ),
  'ns-crown-parcels': svg(
    '<rect width="160" height="90" fill="#0e1810"/>' +
    // hatched crown parcels
    '<path d="M10,5 Q50,3 80,10 Q110,17 130,8 Q148,2 155,10 Q158,20 148,30 Q136,40 115,38 Q92,36 70,44 Q46,52 22,44 Q4,36 8,22 Z" fill="none" stroke="#5a8a40" stroke-width="1"/>' +
    '<line x1="10" y1="5" x2="22" y2="44" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<line x1="30" y1="4" x2="38" y2="46" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<line x1="55" y1="4" x2="58" y2="44" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<line x1="80" y1="10" x2="76" y2="44" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<line x1="104" y1="14" x2="97" y2="38" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<line x1="126" y1="8" x2="120" y2="38" stroke="#5a8a40" stroke-width="0.5" opacity="0.4"/>' +
    '<text x="8" y="84" font-size="8" font-family="sans-serif" fill="rgba(90,180,60,0.5)">Crown Parcels · WMS</text>'
  ),

  // ---- Wetland Indices ----
  'wi-dtw': svg(
    grad('g','0','0','0','1',
      stop('0%','#08306b')+stop('25%','#2166ac')+stop('50%','#74add1')+stop('75%','#c6dbef')+stop('100%','rgba(198,219,239,0)')) +
    '<rect width="160" height="90" fill="#1a2820"/>' +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<text x="4" y="14" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">0 cm</text>' +
    '<text x="4" y="86" font-size="8" font-family="sans-serif" fill="rgba(200,220,240,0.5)">100+ cm</text>' +
    '<text x="60" y="50" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.5)">Depth to Water</text>'
  ),
  'wi-gei': svg(
    grad('g','0','0','0','1',
      stop('0%','#189000')+stop('40%','#ffff00')+stop('70%','#ff8000')+stop('100%','#bd0026')) +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<text x="4" y="14" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)">High</text>' +
    '<text x="4" y="86" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)">Low</text>' +
    '<text x="38" y="50" font-size="8" font-family="sans-serif" fill="rgba(0,0,0,0.45)">Groundwater Expression Index</text>'
  ),
  'wi-dtw-contour': svg(
    '<rect width="160" height="90" fill="#d8e8f0"/>' +
    '<path d="M0,45 Q20,38 45,44 Q72,52 100,40 Q128,28 160,38" stroke="#1565c0" stroke-width="2.5" fill="none"/>' +
    '<text x="4" y="36" font-size="8" font-family="sans-serif" fill="#1565c0">DTW = 50 cm</text>' +
    '<text x="8" y="80" font-size="8" font-family="sans-serif" fill="rgba(0,60,120,0.5)">Wetland boundary contour</text>'
  ),
  'wi-pdep': svg(
    grad('g','0','0','0','1',
      stop('0%','#0d0221')+stop('30%','#38004e')+stop('60%','#7a1fa2')+stop('85%','#c28fdc')+stop('100%','rgba(194,143,220,0)')) +
    '<rect width="160" height="90" fill="#1a2820"/>' +
    '<rect width="160" height="90" fill="url(#g)"/>' +
    '<text x="4" y="14" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.7)" font-weight="bold">P = 1.0</text>' +
    '<text x="4" y="86" font-size="8" font-family="sans-serif" fill="rgba(200,180,220,0.5)">P = 0.0</text>' +
    '<text x="40" y="50" font-size="8" font-family="sans-serif" fill="rgba(255,255,255,0.5)">Prob. of Depression</text>'
  ),
};

// ── Layer label overrides for the Data Library ────────────────────────────────
// Elevation layers get "NRCan HRDEM" prefix here without touching constants.ts
const LABEL_OVERRIDES: Record<string, string> = {
  'hrdem-dtm-hillshade':  'NRCan HRDEM DTM Hillshade',
  'hrdem-dsm-hillshade':  'NRCan HRDEM DSM Hillshade',
  'hrdem-elevation':      'NRCan HRDEM Elevation (DTM)',
  'hrdem-slope':          'NRCan HRDEM Slope',
  'hrdem-aspect':         'NRCan HRDEM Aspect',
  'hrdem-tpi':            'NRCan HRDEM TPI',
  'hrdem-contours':       'NRCan HRDEM Contours',
  'hrdem-dsm-elevation':  'NRCan HRDEM DSM Elevation',
  'hrdem-chm':            'NRCan HRDEM Canopy Height (CHM)',
};

// ── Layer descriptions ────────────────────────────────────────────────────────
const LAYER_DESCRIPTIONS: Record<string, string> = {
  'esri-imagery':           'High-resolution satellite and aerial imagery from ESRI\'s World Imagery service. Updated periodically with the best available imagery per location. Essential reference for land cover identification and field navigation.',
  'esri-hybrid':            'ESRI World Imagery with road and place-name labels overlaid. Combines satellite context with vector navigation features. Useful for field orientation and route planning.',
  'osm':                    'OpenStreetMap community-sourced street map. Shows roads, buildings, land use, and points of interest worldwide. Particularly detailed in settled areas.',
  'topo':                   'Topographic map rendered from OpenStreetMap and SRTM elevation data. Displays contours, terrain relief, and major features in the style of traditional topo maps.',
  'hrdem-dtm-hillshade':    'Digital Terrain Model hillshade derived from NRCan LiDAR HRDEM data. Removes vegetation and structures to reveal bare-earth terrain. 1–2 m resolution across most of Nova Scotia.',
  'hrdem-dsm-hillshade':    'Digital Surface Model hillshade from NRCan HRDEM LiDAR. Retains the height of trees, buildings, and other above-ground objects — useful for canopy structure analysis.',
  'ns-plan-nsprd':          'Nova Scotia Property Registry digital parcel boundaries with PID attributes. Served via the NS Geomatics Centre ESRI REST API. Supports the in-app PID search and identify tool.',
  'ns-nshn-watercourses':   'Nova Scotia Hydrographic Network (NSHN) classified watercourses including rivers, streams, ditches, and canals. Features coded by FEAT_CODE for regulatory screening and field navigation.',
  'ns-nshn-waterbodies':    'NSHN open-water polygons for lakes and ponds (excludes wetland classes). Provides accurate waterbody boundaries for water resources analysis and buffer delineation.',
  'ns-nshn-wetlands':       'Wetland polygons from the NSHN, including bogs, fens, marshes, swamps, and shallow water areas classified by FEAT_CODE. Useful for initial field targeting and regulatory context.',
  'ns-base-contours':       'Nova Scotia Topographic Database (NSTDB) 1:10,000 contour lines at 10 m intervals. Index contours are rendered heavier than intermediate contours using FEAT_CODE classification.',
  'ns-base-parks':          'Provincial and National Parks plus Protected Areas from the NSTDB 1:10,000 Delimiter Boundaries dataset. Polygon features styled by classification: National Park, Provincial Park, or Protected Area.',
  'ns-base-designated':     'Designated land-use areas from the NSTDB including protected zones and special management designations. Useful for environmental screening and regulatory context mapping.',
  'ns-bio-habitat':         'Provincial landscape-level significant wildlife habitat from NS Wildlife Division. Includes species at risk habitat, deer and moose wintering areas, and migratory bird habitat, colour-coded by feature type.',
  'ns-bio-nsnrr-wetlands':  'Provincial wetland inventory from NS Natural Resources & Renewables, classified by Wetland type (Bog, Fen, Marsh, Salt Marsh, Swamp, Water). Higher survey confidence than NSHN wetlands.',
  'ns-for-old-growth':      'Old Growth Forest Policy layer from NS Lands & Forestry. Status 1 = confirmed old growth (dark green), Status 2 = candidate old growth (medium green). Up to 2,000 records per view.',
  'ns-for-fec-soil':        'Forest Ecosystem Classification (FEC) Soil Type polygons from NS LF. Dual-resolution endpoint — switches to higher-detail tiles at zoom ≥ 15. Useful for site quality assessment and forest management.',
  'ns-trns-roads':          'NS Road Network (NSRN) with full classification: Highway, Arterial, Collector, Rural, Unclassified. Merged from two MapServer layers. Colour-coded and width-scaled by road class. Up to 2,000 records.',
  'ns-crown-parcels':       'Simplified Crown land parcel boundaries served via WMS from NS Geomatics Centre. Useful for identifying Crown land extent for initial project area screening and regulatory context.',
  'hrdem-elevation':        'Continuous elevation raster (DTM) from NRCan HRDEM LiDAR. Rendered with a terrain colour ramp from sea level (blue) through forest green, tan highlands, and brown upper slopes to white peaks.',
  'hrdem-slope':            'Slope gradient in degrees derived from the NRCan HRDEM DTM. Colour-coded from flat (green) through moderate (yellow) to steep terrain (red). Supports multiple stretch and unit options in the layer settings.',
  'hrdem-aspect':           'Terrain aspect (slope orientation) from NRCan HRDEM DTM. Rendered as a directional colour wheel: N = cool blue, E = orange, S = warm red, W = purple. Useful for solar exposure and cold-air drainage analysis.',
  'hrdem-tpi':              'Topographic Position Index from NRCan HRDEM DTM. Diverging colour scale distinguishes ridge crests (positive, red) from valley floors (negative, blue). Useful for landform classification and drainage analysis.',
  'hrdem-contours':         'On-demand contour lines generated from the NRCan HRDEM DTM via WCS. Default interval 1 m, rendered without a background raster for use as an overlay. Interval and colour configurable in layer settings.',
  'hrdem-dsm-elevation':    'Digital Surface Model elevation from NRCan HRDEM LiDAR. Includes the height of tree canopy and structures above bare ground. Compare with DTM to derive Canopy Height or identify built features.',
  'hrdem-chm':              'Canopy Height Model computed as DSM − DTM from NRCan HRDEM LiDAR. Represents vegetation and structure height above bare earth. Colour-coded from bare ground (light) to tall canopy (dark green).',
  'wi-dtw':                 'Depth to Water (DTW) index — a continuous-field model predicting depth to the saturated zone across the landscape. Lower values indicate wetter conditions closer to the surface. Developed by Fraxinus for Nova Scotia.',
  'wi-gei':                 'Groundwater Expression Index (GEI) — a field-validated spectral index derived from satellite imagery highlighting persistent moisture and groundwater discharge. Calibrated against field wetland assessments across NS.',
  'wi-dtw-contour':         'Single-threshold contour extracted from the DTW COG raster. Default threshold 50 cm depth to water — approximates the functional wetland boundary for rapid field targeting. Threshold is adjustable in layer settings.',
  'wi-pdep':                'Probability of Depression (PDEP) — a machine-learning model predicting the likelihood of terrain depressions that retain standing water. Higher values (darker purple) indicate greater depression probability. Developed for NS.',
};

// ── Thumbnail resolution ──────────────────────────────────────────────────────

const thumbUrl = (url: string): string =>
  url.replace('{z}', '4').replace('{x}', '4').replace('{y}', '5').replace('{r}', '');

const hasTileThumb = (def: BasemapDef): boolean =>
  def.type === 'raster' && def.url.includes('{z}') && !def.url.startsWith('cog://');

function getThumb(def: BasemapDef): { src: string; isTile: boolean } {
  if (def.id in LAYER_THUMBS) return { src: LAYER_THUMBS[def.id], isTile: false };
  if (hasTileThumb(def)) return { src: thumbUrl(def.url), isTile: true };
  // Fallback: group-coloured placeholder
  const fallback = svg(`<rect width="160" height="90" fill="#1a2820"/><text x="80" y="50" text-anchor="middle" font-size="10" font-family="sans-serif" fill="rgba(255,255,255,0.3)">${def.label}</text>`);
  return { src: fallback, isTile: false };
}

function typeLabel(def: BasemapDef): string {
  if (def.url.startsWith('cog://')) return 'COG Raster';
  switch (def.type) {
    case 'raster':       return 'Raster';
    case 'nsprd-vector': return 'Vector';
    case 'nshn-vector':  return 'Vector';
    case 'hrdem-wcs':    return 'Elevation (WCS)';
    case 'cog-contour':  return 'COG Contour';
    default:             return def.type;
  }
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface DataLibraryCallbacks {
  onAddToMap: (def: BasemapDef) => void;
  onImport: () => void;
  onExport: () => void;
  isInStack: (defId: string) => boolean;
}

export class DataLibraryModal {
  private overlay: HTMLElement;
  private callbacks!: DataLibraryCallbacks;
  private searchQuery = '';
  private activeGroup = 'all';

  constructor() {
    this.overlay = document.getElementById('data-library-overlay')!;
  }

  open(callbacks: DataLibraryCallbacks): void {
    this.callbacks = callbacks;
    this.searchQuery = '';
    this.activeGroup = 'all';
    this.render();
    this.overlay.style.display = 'flex';
    requestAnimationFrame(() => this.overlay.classList.add('dl-open'));
  }

  close(): void {
    this.overlay.classList.remove('dl-open');
    setTimeout(() => { this.overlay.style.display = 'none'; }, 250);
  }

  private get allDefs(): BasemapDef[] {
    return [...BASEMAPS, ...BASEMAP_OVERLAYS];
  }

  private get groups(): string[] {
    const seen = new Set<string>();
    BASEMAP_OVERLAYS.forEach(d => { if (d.group) seen.add(d.group); });
    return [...seen].sort();
  }

  private filteredDefs(): BasemapDef[] {
    let defs = this.allDefs;
    if (this.activeGroup !== 'all') {
      defs = this.activeGroup === 'basemaps'
        ? [...BASEMAPS]
        : BASEMAP_OVERLAYS.filter(d => d.group === this.activeGroup);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      defs = defs.filter(d =>
        (LABEL_OVERRIDES[d.id] ?? d.label).toLowerCase().includes(q) ||
        (d.group ?? '').toLowerCase().includes(q) ||
        d.attribution.toLowerCase().includes(q) ||
        (LAYER_DESCRIPTIONS[d.id] ?? '').toLowerCase().includes(q),
      );
    }
    return defs;
  }

  private renderCard(def: BasemapDef): string {
    const inStack = this.callbacks.isInStack(def.id);
    const { src, isTile } = getThumb(def);
    const displayLabel = LABEL_OVERRIDES[def.id] ?? def.label;
    const tl = typeLabel(def);
    const groupText = def.group ?? 'Standard';
    const desc = LAYER_DESCRIPTIONS[def.id] ?? 'A geospatial data layer for use in field mapping projects.';
    const source = def.attribution;

    const thumbImg = isTile
      ? `<img src="${src}" loading="lazy" alt="${displayLabel}" onerror="this.closest('.dl-card-thumb').classList.add('dl-thumb-err')" />`
      : `<img src="${src}" alt="${displayLabel}" />`;

    return `
      <div class="dl-card${inStack ? ' dl-card-active' : ''}" data-def-id="${def.id}">
        <div class="dl-card-thumb" title="Tap for layer info">
          <div class="dl-thumb-inner">
            <div class="dl-thumb-front">
              ${thumbImg}
              ${inStack ? `<div class="dl-card-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg></div>` : ''}
              <div class="dl-thumb-info-badge">ⓘ</div>
            </div>
            <div class="dl-thumb-back">
              <p class="dl-info-desc">${desc}</p>
              <div class="dl-info-attrs">
                <div class="dl-info-attr"><span class="dl-attr-key">Source</span><span class="dl-attr-val">${source}</span></div>
                <div class="dl-info-attr"><span class="dl-attr-key">Type</span><span class="dl-attr-val">${tl}</span></div>
                ${def.group ? `<div class="dl-info-attr"><span class="dl-attr-key">Group</span><span class="dl-attr-val">${def.group}</span></div>` : ''}
              </div>
              <div class="dl-thumb-back-hint">tap to flip back</div>
            </div>
          </div>
        </div>
        <div class="dl-card-body">
          <div class="dl-card-name">${displayLabel}</div>
          <div class="dl-card-meta">
            <span class="dl-card-group">${groupText}</span>
            <span class="dl-card-type">${tl}</span>
          </div>
        </div>
        <button class="dl-card-add${inStack ? ' dl-card-added' : ''}" data-def-id="${def.id}">
          ${inStack
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><polyline points="20 6 9 17 4 12"/></svg> Added`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Map`
          }
        </button>
      </div>`;
  }

  private render(): void {
    const defs = this.filteredDefs();
    const groups = this.groups;

    this.overlay.innerHTML = `
      <div class="dl-modal">
        <div class="dl-sidebar">
          <div class="dl-sidebar-header">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="18" height="18">
              <path d="M231.65,194.55,198.46,36.75a16,16,0,0,0-19-12.39L132.65,34.42a16.08,16.08,0,0,0-12.3,19.05L153.6,211.28a16,16,0,0,0,15.65,12.72,16.2,16.2,0,0,0,3.38-.36l46.81-10.06A16.09,16.09,0,0,0,231.65,194.55ZM168.94,208,136,50.25l46.81-10.06h0L216,198Z"/>
              <path d="M115.86,26.47A16,16,0,0,0,96,13.17L49.19,23.23A16.09,16.09,0,0,0,37,42.45L70.14,200.25A16,16,0,0,0,85.79,212a16.25,16.25,0,0,0,3.38-.36L120,205.46a8,8,0,0,0-3.38-15.64L86,197.56,53.37,40.1,100.18,30l30,128a8,8,0,1,0,15.64-3.38Z"/>
            </svg>
            <span>Data Library</span>
          </div>

          <nav class="dl-nav">
            <button class="dl-nav-item${this.activeGroup === 'all' ? ' active' : ''}" data-group="all">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              All Sources
            </button>
            <button class="dl-nav-item${this.activeGroup === 'basemaps' ? ' active' : ''}" data-group="basemaps">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/></svg>
              Standard Basemaps
            </button>
            ${groups.map(g => `
              <button class="dl-nav-item${this.activeGroup === g ? ' active' : ''}" data-group="${g}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                ${g}
              </button>`).join('')}
          </nav>

          <div class="dl-sidebar-actions">
            <button class="dl-action-btn" id="dl-import-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M74.34,77.66a8,8,0,0,1,0-11.32l48-48a8,8,0,0,1,11.32,0l48,48a8,8,0,0,1-11.32,11.32L136,43.31V128a8,8,0,0,1-16,0V43.31L85.66,77.66A8,8,0,0,1,74.34,77.66ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16h68a4,4,0,0,1,4,4v3.46c0,13.45,11,24.79,24.46,24.54A24,24,0,0,0,152,128v-4a4,4,0,0,1,4-4h68A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Import Data
            </button>
            <button class="dl-action-btn" id="dl-export-btn">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="14" height="14"><path d="M74.34,85.66A8,8,0,0,1,85.66,74.34L120,108.69V24a8,8,0,0,1,16,0v84.69l34.34-34.35a8,8,0,0,1,11.32,11.32l-48,48a8,8,0,0,1-11.32,0ZM240,136v64a16,16,0,0,1-16,16H32a16,16,0,0,1-16-16V136a16,16,0,0,1,16-16H84.4a4,4,0,0,1,2.83,1.17L111,145A24,24,0,0,0,145,145l23.8-23.8A4,4,0,0,1,171.6,120H224A16,16,0,0,1,240,136Zm-40,32a12,12,0,1,0-12,12A12,12,0,0,0,200,168Z"/></svg>
              Export Data
            </button>
          </div>
        </div>

        <div class="dl-main">
          <div class="dl-main-header">
            <div class="dl-search-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15" class="dl-search-icon">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="dl-search" class="dl-search" placeholder="Search layers, descriptions…" value="${this.searchQuery}" autocomplete="off" />
              ${this.searchQuery ? '<button id="dl-search-clear" class="dl-search-clear" aria-label="Clear search">✕</button>' : ''}
            </div>
            <button class="dl-close-btn" id="dl-close" aria-label="Close library">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="dl-grid-wrap">
            <div class="dl-grid-label">
              ${this.activeGroup === 'all' ? 'All Sources' : this.activeGroup === 'basemaps' ? 'Standard Basemaps' : this.activeGroup}
              <span class="dl-count">${defs.length} layer${defs.length !== 1 ? 's' : ''}</span>
              <span class="dl-flip-hint-global">tap preview to flip for details</span>
            </div>
            ${defs.length === 0
              ? `<div class="dl-empty">No layers match "<strong>${this.searchQuery}</strong>"</div>`
              : `<div class="dl-grid">${defs.map(d => this.renderCard(d)).join('')}</div>`
            }
          </div>
        </div>
      </div>
    `;

    this.wireEvents();
  }

  private wireEvents(): void {
    // Close
    this.overlay.querySelector('#dl-close')?.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Search
    const searchEl = this.overlay.querySelector<HTMLInputElement>('#dl-search');
    searchEl?.addEventListener('input', () => {
      this.searchQuery = searchEl.value;
      this.render();
    });
    this.overlay.querySelector('#dl-search-clear')?.addEventListener('click', () => {
      this.searchQuery = '';
      this.render();
    });

    // Group nav
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeGroup = btn.dataset.group ?? 'all';
        this.render();
      });
    });

    // Flip card thumbnails
    this.overlay.querySelectorAll<HTMLElement>('.dl-card-thumb').forEach(thumb => {
      thumb.addEventListener('click', (e) => {
        e.stopPropagation();
        thumb.classList.toggle('dl-flipped');
      });
    });

    // Add to map (button only — card click no longer triggers add)
    this.overlay.querySelectorAll<HTMLButtonElement>('.dl-card-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const defId = btn.dataset.defId!;
        if (this.callbacks.isInStack(defId)) return;
        const def = this.allDefs.find(d => d.id === defId);
        if (!def) return;
        this.callbacks.onAddToMap(def);
        this.render();
      });
    });

    // Import / Export
    this.overlay.querySelector('#dl-import-btn')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onImport();
    });
    this.overlay.querySelector('#dl-export-btn')?.addEventListener('click', () => {
      this.close();
      this.callbacks.onExport();
    });
  }

}

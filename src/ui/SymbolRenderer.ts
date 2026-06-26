import type { Map as MLMap } from 'maplibre-gl';
import type { TypePreset, HatchPattern } from '../types';

// Phosphor fill icon paths — 256×256 coordinate space, fill-based
export const ICON_PATHS: Record<string, string> = {
  // ── Basic Shapes ──────────────────────────────────────────
  circle:     'M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z',
  square:     'M224,48V208a16,16,0,0,1-16,16H48a16,16,0,0,1-16-16V48A16,16,0,0,1,48,32H208A16,16,0,0,1,224,48Z',
  diamond:    'M240,128a15.85,15.85,0,0,1-4.67,11.28l-96.05,96.06a16,16,0,0,1-22.56,0h0l-96-96.06a16,16,0,0,1,0-22.56l96.05-96.06a16,16,0,0,1,22.56,0l96.05,96.06A15.85,15.85,0,0,1,240,128Z',
  triangle:   'M236.78,211.81A24.34,24.34,0,0,1,215.45,224H40.55a24.34,24.34,0,0,1-21.33-12.19,23.51,23.51,0,0,1,0-23.72L106.65,36.22a24.76,24.76,0,0,1,42.7,0L236.8,188.09A23.51,23.51,0,0,1,236.78,211.81Z',
  star:       'M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z',
  hexagon:    'M232,80.18v95.64a16,16,0,0,1-8.32,14l-88,48.17a15.88,15.88,0,0,1-15.36,0l-88-48.17a16,16,0,0,1-8.32-14V80.18a16,16,0,0,1,8.32-14l88-48.17a15.88,15.88,0,0,1,15.36,0l88,48.17A16,16,0,0,1,232,80.18Z',
  pentagon:   'M231.26,105.19l-32,107.54-.06.17A15.94,15.94,0,0,1,184,224H72A15.94,15.94,0,0,1,56.8,212.9l-.06-.17-32-107.54a16,16,0,0,1,5.7-17.63l87.92-68.31.18-.14a15.93,15.93,0,0,1,18.92,0l.18.14,87.92,68.31A16,16,0,0,1,231.26,105.19Z',
  plus:       'M128,24A104,104,0,1,0,232,128,104.13,104.13,0,0,0,128,24Zm40,112H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32a8,8,0,0,1,0,16Z',
  cross:      'M200,68H164V32a20,20,0,0,0-20-20H112A20,20,0,0,0,92,32V68H56A20,20,0,0,0,36,88v32a20,20,0,0,0,20,20H92v84a20,20,0,0,0,20,20h32a20,20,0,0,0,20-20V140h36a20,20,0,0,0,20-20V88A20,20,0,0,0,200,68Zm-4,48H152a12,12,0,0,0-12,12v92H116V128a12,12,0,0,0-12-12H60V92h44a12,12,0,0,0,12-12V36h24V80a12,12,0,0,0,12,12h44Z',

  // ── Navigation / Common ───────────────────────────────────
  pin:        'M128,16a88.1,88.1,0,0,0-88,88c0,75.3,80,132.17,83.41,134.55a8,8,0,0,0,9.18,0C136,236.17,216,179.3,216,104A88.1,88.1,0,0,0,128,16Zm0,56a32,32,0,1,1-32,32A32,32,0,0,1,128,72Z',
  flag:       'M232,56V176a8,8,0,0,1-2.76,6c-15.28,13.23-29.89,18-43.82,18-18.91,0-36.57-8.74-53-16.85C105.87,170,82.79,158.61,56,179.77V224a8,8,0,0,1-16,0V56a8,8,0,0,1,2.77-6h0c36-31.18,68.31-15.21,96.79-1.12C167,62.46,190.79,74.2,218.76,50A8,8,0,0,1,232,56Z',
  home:       'M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z',
  warning:    'M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z',
  exclaim:    'M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM120,104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm8,88a12,12,0,1,1,12-12A12,12,0,0,1,128,192Z',
  camera:     'M208,56H180.28L166.65,35.56A8,8,0,0,0,160,32H96a8,8,0,0,0-6.65,3.56L75.71,56H48A24,24,0,0,0,24,80V192a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V80A24,24,0,0,0,208,56Zm-44,76a36,36,0,1,1-36-36A36,36,0,0,1,164,132Z',
  building:   'M232,224H208V32h8a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16h8V224H24a8,8,0,0,0,0,16H232a8,8,0,0,0,0-16ZM88,56h24a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Zm0,40h24a8,8,0,0,1,0,16H88a8,8,0,0,1,0-16Zm-8,48a8,8,0,0,1,8-8h24a8,8,0,0,1,0,16H88A8,8,0,0,1,80,144Zm72,80H104V184h48Zm16-72H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Zm0-40H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Zm0-40H144a8,8,0,0,1,0-16h24a8,8,0,0,1,0,16Z',
  anchor:     'M224,144c0,38.11-27.67,45.66-49.9,51.72C149.77,202.36,136,207.31,136,232a8,8,0,0,1-16,0c0-24.69-13.77-29.64-38.1-36.28C59.67,189.66,32,182.11,32,144a8,8,0,0,1,16,0c0,24.69,13.77,29.64,38.1,36.28,11.36,3.1,24.12,6.6,33.9,14.34V128H88a8,8,0,0,1,0-16h32V82.83a28,28,0,1,1,16,0V112h32a8,8,0,0,1,0,16H136v66.62c9.78-7.74,22.54-11.24,33.9-14.34C194.23,173.64,208,168.69,208,144a8,8,0,0,1,16,0Z',
  compass:    'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm51.58,57.79-32,64a4.08,4.08,0,0,1-1.79,1.79l-64,32a4,4,0,0,1-5.37-5.37l32-64a4.08,4.08,0,0,1,1.79-1.79l64-32A4,4,0,0,1,179.58,81.79Z',
  footprints: 'M216.06,192v12A36,36,0,0,1,144,204V192a8,8,0,0,1,8-8h56A8,8,0,0,1,216.06,192ZM104,160h-56a8,8,0,0,0-8,8v12A36,36,0,0,0,112,180V168A8,8,0,0,0,104,160ZM76,16C64.36,16,53.07,26.31,44.2,45c-13.93,29.38-18.56,73,.29,96a8,8,0,0,0,6.2,2.93h50.55a8,8,0,0,0,6.2-2.93c18.85-23,14.22-66.65.29-96C98.85,26.31,87.57,16,76,16Zm78.8,152h50.55a8,8,0,0,0,6.2-2.93c18.85-23,14.22-66.65.29-96C202.93,50.31,191.64,40,180,40s-22.89,10.31-31.77,29c-13.93,29.38-18.56,73,.29,96A8,8,0,0,0,154.76,168Z',

  // ── Nature ────────────────────────────────────────────────
  tree:       'M128,187.85a72.44,72.44,0,0,0,8,4.62V232a8,8,0,0,1-16,0V192.47A72.44,72.44,0,0,0,128,187.85ZM198.1,62.59a76,76,0,0,0-140.2,0A71.71,71.71,0,0,0,16,127.8C15.9,166,48,199,86.14,200A72.22,72.22,0,0,0,120,192.47V156.94L76.42,135.16a8,8,0,1,1,7.16-14.32L120,139.06V88a8,8,0,0,1,16,0v27.06l36.42-18.22a8,8,0,1,1,7.16,14.32L136,132.94v59.53A72.17,72.17,0,0,0,168,200l1.82,0C208,199,240.11,166,240,127.8A71.71,71.71,0,0,0,198.1,62.59Z',
  tree_pine:  'M231.19,195.51A8,8,0,0,1,224,200H136v40a8,8,0,0,1-16,0V200H32a8,8,0,0,1-6.31-12.91l46-59.09H48a8,8,0,0,1-6.34-12.88l80-104a8,8,0,0,1,12.68,0l80,104A8,8,0,0,1,208,128H184.36l45.95,59.09A8,8,0,0,1,231.19,195.51Z',
  leaf:       'M223.45,40.07a8,8,0,0,0-7.52-7.52C139.8,28.08,78.82,51,52.82,94a87.09,87.09,0,0,0-12.76,49A101.72,101.72,0,0,0,46.7,175.2a4,4,0,0,0,6.61,1.43l85-86.3a8,8,0,0,1,11.32,11.32L56.74,195.94,42.55,210.13a8.2,8.2,0,0,0-.6,11.1,8,8,0,0,0,11.71.43l16.79-16.79c14.14,6.84,28.41,10.57,42.56,11.07q1.67.06,3.33.06A86.93,86.93,0,0,0,162,203.18C205,177.18,227.93,116.21,223.45,40.07Z',
  flower:     'M210.35,129.36c-.81-.47-1.7-.92-2.62-1.36.92-.44,1.81-.89,2.62-1.36a40,40,0,1,0-40-69.28c-.81.47-1.65,1-2.48,1.59.08-1,.13-2,.13-3a40,40,0,0,0-80,0c0,.94,0,1.94.13,3-.83-.57-1.67-1.12-2.48-1.59a40,40,0,1,0-40,69.28c.81.47,1.7.92,2.62,1.36-.92.44-1.81.89-2.62,1.36a40,40,0,1,0,40,69.28c.81-.47,1.65-1,2.48-1.59-.08,1-.13,2-.13,2.95a40,40,0,0,0,80,0c0-.94-.05-1.94-.13-2.95.83.57,1.67,1.12,2.48,1.59A39.79,39.79,0,0,0,190.29,204a40.43,40.43,0,0,0,10.42-1.38,40,40,0,0,0,9.64-73.28ZM128,156a28,28,0,1,1,28-28A28,28,0,0,1,128,156Z',
  sun:        'M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z',
  moon:       'M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z',
  snowflake:  'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm42.37,119.22,18.94-6.76a8,8,0,1,1,5.38,15.08l-15.48,5.52,4.52,16.87a8,8,0,0,1-5.66,9.8A8.23,8.23,0,0,1,176,184a8,8,0,0,1-7.73-5.93l-5.57-20.8L136,141.86v30.83l13.66,13.65a8,8,0,0,1-11.32,11.32L128,187.31l-10.34,10.35a8,8,0,0,1-11.32-11.32L120,172.69V141.86L93.3,157.27l-5.57,20.8A8,8,0,0,1,80,184a8.23,8.23,0,0,1-2.07-.27,8,8,0,0,1-5.66-9.8l4.52-16.87-15.48-5.52a8,8,0,0,1,5.38-15.08l18.94,6.76L112,128,85.63,112.78l-18.94,6.76A8.18,8.18,0,0,1,64,120a8,8,0,0,1-2.69-15.54l15.48-5.52L72.27,82.07a8,8,0,0,1,15.46-4.14l5.57,20.8L120,114.14V83.31L106.34,69.66a8,8,0,0,1,11.32-11.32L128,68.69l10.34-10.35a8,8,0,0,1,11.32,11.32L136,83.31v30.83l26.7-15.41,5.57-20.8a8,8,0,0,1,15.46,4.14l-4.52,16.87,15.48,5.52A8,8,0,0,1,192,120a8.18,8.18,0,0,1-2.69-.46l-18.94-6.76L144,128Z',
  flame:      'M173.79,51.48a221.25,221.25,0,0,0-41.67-34.34,8,8,0,0,0-8.24,0A221.25,221.25,0,0,0,82.21,51.48C54.59,80.48,40,112.47,40,144a88,88,0,0,0,176,0C216,112.47,201.41,80.48,173.79,51.48ZM96,184c0-27.67,22.53-47.28,32-54.3,9.48,7,32,26.63,32,54.3a32,32,0,0,1-64,0Z',
  drop:       'M174,47.75a254.19,254.19,0,0,0-41.45-38.3,8,8,0,0,0-9.18,0A254.19,254.19,0,0,0,82,47.75C54.51,79.32,40,112.6,40,144a88,88,0,0,0,176,0C216,112.6,201.49,79.32,174,47.75Zm9.85,105.59a57.6,57.6,0,0,1-46.56,46.55A8.75,8.75,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z',
  campfire:   'M132.19,25.19a8,8,0,0,0-8.38,0A156,156,0,0,0,96.24,48C77.77,67.13,68,87.9,68,108a60,60,0,0,0,120,0C188,60.08,134.47,26.59,132.19,25.19ZM128,152a24,24,0,0,1-24-24c0-24,24-40,24-40s24,16,24,40A24,24,0,0,1,128,152Zm95.62,74.42a8,8,0,0,1-10.05,5.2L128,204.39,42.43,231.62a8,8,0,1,1-4.85-15.25l64-20.37-64-20.38a8,8,0,1,1,4.85-15.24L128,187.6l85.57-27.22a8,8,0,1,1,4.85,15.24l-64,20.38,64,20.37A8,8,0,0,1,223.62,226.42Z',
  mountains:  'M254.88,195.92l-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84l-15.64,26.39a4,4,0,0,0,0,4.07l26.8,45.47a8.13,8.13,0,0,1-1.89,10.55,8,8,0,0,1-11.8-2.26L101.79,71.88a16,16,0,0,0-27.58,0L1.11,195.94a8,8,0,0,0,1,9.52A8.23,8.23,0,0,0,8.23,208H247.77a8.29,8.29,0,0,0,6.09-2.55A8,8,0,0,0,254.88,195.92ZM64.43,120,88,80l23.57,40ZM140,52a24,24,0,1,1,24,24A24,24,0,0,1,140,52Z',
  cloud:      'M160.06,40A88.1,88.1,0,0,0,81.29,88.67h0A87.48,87.48,0,0,0,72,127.73,8.18,8.18,0,0,1,64.57,136,8,8,0,0,1,56,128a103.66,103.66,0,0,1,5.34-32.92,4,4,0,0,0-4.75-5.18A64.09,64.09,0,0,0,8,152c0,35.19,29.75,64,65,64H160a88.09,88.09,0,0,0,87.93-91.48C246.11,77.54,207.07,40,160.06,40Z',

  // ── Wildlife ──────────────────────────────────────────────
  bird:       'M236.44,73.34,213.21,57.86A60,60,0,0,0,156,16h-.29C122.79,16.16,96,43.47,96,76.89V96.63L11.63,197.88l-.1.12A16,16,0,0,0,24,224h88A104.11,104.11,0,0,0,216,120V100.28l20.44-13.62a8,8,0,0,0,0-13.32ZM126.15,133.12l-60,72a8,8,0,1,1-12.29-10.24l60-72a8,8,0,1,1,12.29,10.24ZM164,80a12,12,0,1,1,12-12A12,12,0,0,1,164,80Z',
  rabbit:     'M199.28,149.8A71.58,71.58,0,0,0,193,129c19-37.94,30.45-88.28,17.34-110A22,22,0,0,0,190.94,8c-14.12,0-26,11.89-36.44,36.36-6.22,14.62-10.85,31.32-14,44.74a71.8,71.8,0,0,0-25,0c-3.13-13.42-7.76-30.12-14-44.74C91.1,19.89,79.18,8,65.06,8A22,22,0,0,0,45.64,19.08C32.53,40.76,44,91.1,63,129a71.58,71.58,0,0,0-6.26,20.76A52,52,0,1,0,128,225.52l-21.12-19.37a8,8,0,1,1,10.24-12.3L128,202.9l10.88-9.05a8,8,0,0,1,10.24,12.3L128,225.52a52,52,0,1,0,71.28-75.72Zm-126-36.53A218.45,218.45,0,0,1,58.4,67.08c-3.49-18.13-3.15-33,.93-39.72A6,6,0,0,1,65.06,24c6.61,0,14.52,9.7,21.72,26.62,5.93,13.94,10.35,30.12,13.33,43a71.72,71.72,0,0,0-26.88,19.64ZM100,176a12,12,0,1,1,12-12A12,12,0,0,1,100,176Zm56,0a12,12,0,1,1,12-12A12,12,0,0,1,156,176Zm20.55-69.17a71.89,71.89,0,0,0-20.66-13.2c3-12.89,7.4-29.07,13.33-43C176.42,33.7,184.33,24,190.94,24a6,6,0,0,1,5.73,3.36c4.08,6.74,4.42,21.59.93,39.72a218.45,218.45,0,0,1-14.83,46.19A72.6,72.6,0,0,0,176.55,106.83Z',
  fish:       'M168,76a12,12,0,1,1-12-12A12,12,0,0,1,168,76Zm48.72,67.64c-19.37,34.9-55.44,53.76-107.24,56.1l-22,51.41A8,8,0,0,1,80.1,256l-.51,0a8,8,0,0,1-7.19-5.78L57.6,198.39,5.8,183.56a8,8,0,0,1-1-15.05l51.41-22c2.35-51.78,21.21-87.84,56.09-107.22,24.75-13.74,52.74-15.84,71.88-15.18,18.64.64,36,4.27,38.86,6a8,8,0,0,1,2.83,2.83c1.69,2.85,5.33,20.21,6,38.85C232.55,90.89,230.46,118.89,216.72,143.64Zm-4.3-100.07c-14.15-3-64.1-11-100.3,14.75a81.21,81.21,0,0,0-16,15.07,36,36,0,0,0,39.35,38.44,8,8,0,0,1,8.73,8.73,36,36,0,0,0,38.47,39.34,80.81,80.81,0,0,0,15-16C223.42,107.73,215.42,57.74,212.42,43.57Z',
  butterfly:  'M128,100.17a108.42,108.42,0,0,0-8-12.64V56a8,8,0,0,1,16,0V87.53A108.42,108.42,0,0,0,128,100.17ZM232.7,50.48C229,45.7,221.84,40,209,40c-16.85,0-38.46,11.28-57.81,30.16A140.07,140.07,0,0,0,136,87.53V180a8,8,0,0,1-16,0V87.53a140.07,140.07,0,0,0-15.15-17.37C85.49,51.28,63.88,40,47,40,34.16,40,27,45.7,23.3,50.48c-6.82,8.77-12.18,24.08-.21,71.2,6.05,23.83,19.51,33,30.63,36.42A44,44,0,0,0,128,205.27a44,44,0,0,0,74.28-47.17c11.12-3.4,24.57-12.59,30.63-36.42C239.63,95.24,244.85,66.1,232.7,50.48Z',
  paw:        'M240,108a28,28,0,1,1-28-28A28,28,0,0,1,240,108ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm72,0a28,28,0,1,0-28-28A28,28,0,0,0,164,88Zm23.12,60.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a39.48,39.48,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72Z',

  // ── Landscape ─────────────────────────────────────────────
  waves:      'M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM197.2,176.87c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31a8,8,0,1,1-10.4-12.16c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,0,1,10.4,12.16Zm0-44c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31a8,8,0,0,1-10.4-12.16c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,1,1,10.4,12.16Zm0-44c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31A8,8,0,0,1,58.8,79.13c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,1,1,10.4,12.16Z',
  tent:       'M255.31,188.75l-64-144A8,8,0,0,0,184,40H72a8,8,0,0,0-7.31,4.75h0l0,.12v0L.69,188.75A8,8,0,0,0,8,200H248a8,8,0,0,0,7.31-11.25ZM64,184H20.31L64,85.7Zm16,0V85.7L123.69,184Z',

  // ── Backward-compat aliases ───────────────────────────────
  mountain:   'M254.88,195.92l-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84l-15.64,26.39a4,4,0,0,0,0,4.07l26.8,45.47a8.13,8.13,0,0,1-1.89,10.55,8,8,0,0,1-11.8-2.26L101.79,71.88a16,16,0,0,0-27.58,0L1.11,195.94a8,8,0,0,0,1,9.52A8.23,8.23,0,0,0,8.23,208H247.77a8.29,8.29,0,0,0,6.09-2.55A8,8,0,0,0,254.88,195.92ZM64.43,120,88,80l23.57,40ZM140,52a24,24,0,1,1,24,24A24,24,0,0,1,140,52Z',
  water:      'M174,47.75a254.19,254.19,0,0,0-41.45-38.3,8,8,0,0,0-9.18,0A254.19,254.19,0,0,0,82,47.75C54.51,79.32,40,112.6,40,144a88,88,0,0,0,176,0C216,112.6,201.49,79.32,174,47.75Zm9.85,105.59a57.6,57.6,0,0,1-46.56,46.55A8.75,8.75,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z',
  wave:       'M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32ZM197.2,176.87c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31a8,8,0,1,1-10.4-12.16c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,0,1,10.4,12.16Zm0-44c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31a8,8,0,0,1-10.4-12.16c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,1,1,10.4,12.16Zm0-44c-13.07,11.18-24.9,15.1-35.64,15.1-14.26,0-26.62-6.92-37.47-13-18.41-10.31-32.95-18.45-54.89.31A8,8,0,0,1,58.8,79.13c30.42-26,54.09-12.76,73.11-2.11,18.41,10.31,33,18.45,54.89-.31a8,8,0,1,1,10.4,12.16Z',
};

export const ICON_CATEGORIES: Array<{ label: string; icons: string[] }> = [
  { label: 'Shapes',     icons: ['circle', 'square', 'diamond', 'triangle', 'star', 'hexagon', 'pentagon', 'plus', 'cross'] },
  { label: 'Navigation', icons: ['pin', 'flag', 'home', 'compass', 'anchor'] },
  { label: 'Common',     icons: ['warning', 'camera', 'building', 'footprints'] },
  { label: 'Nature',     icons: ['tree', 'tree_pine', 'leaf', 'flower', 'sun', 'moon', 'snowflake', 'flame', 'drop', 'campfire', 'mountains', 'cloud'] },
  { label: 'Wildlife',   icons: ['bird', 'rabbit', 'fish', 'butterfly', 'paw'] },
  { label: 'Landscape',  icons: ['waves', 'tent'] },
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
  const r = Math.max(4, Math.min((preset.size ?? 7) * 2.2, CANVAS_SIZE / 2 - 3));
  const fillOpacity = preset.fill_opacity ?? 1.0;
  const strokeColor = preset.stroke_color ?? '#ffffff';
  const strokeWidth = Math.max(1, preset.stroke_width ?? 2);
  const shape = preset.shape ?? 'circle';
  const shapeRad = ((preset.rotation ?? 0) * Math.PI) / 180;

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

  // Icon overlay — Phosphor fill icons (256×256 coordinate space)
  if (preset.icon && ICON_PATHS[preset.icon]) {
    const iconColor = preset.icon_color ?? '#ffffff';
    const iconSize = r * 1.3 * (preset.icon_size ?? 1.0);
    const iconRad = ((preset.icon_rotation ?? 0) * Math.PI) / 180;

    ctx.save();
    ctx.translate(cx, cy);
    if (iconRad !== 0) ctx.rotate(iconRad);
    ctx.translate(-iconSize / 2, -iconSize / 2);
    const scale = iconSize / 256;
    ctx.scale(scale, scale);
    ctx.fillStyle = iconColor;
    const path = new Path2D(ICON_PATHS[preset.icon]);
    ctx.fill(path, 'evenodd');
    ctx.restore();
  }

  return canvas;
}

/** Sprite size and scale constants for shape symbol layers. */
export const SHAPE_SPRITE_SIZE = 64;
export const SHAPE_SPRITE_RADIUS = 28;
/** CSS pixel radius at icon-size=1 when pixelRatio=2 is passed to addImage. */
export const SHAPE_ICON_SCALE = SHAPE_SPRITE_RADIUS / 2; // = 14

/**
 * Render a point shape as a MapLibre-ready ImageData sprite.
 * Use with `map.addImage(id, data, { pixelRatio: 2 })`.
 * icon-size = desiredScreenRadiusPx / SHAPE_ICON_SCALE
 */
export function renderShapeSprite(
  shape: string,
  color: string,
  outlineColor: string,
  outlineWidth: number,
  opacity: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SHAPE_SPRITE_SIZE;
  const ctx = canvas.getContext('2d')!;
  const cx = SHAPE_SPRITE_SIZE / 2;
  const cy = SHAPE_SPRITE_SIZE / 2;
  drawShape(ctx, shape, cx, cy, SHAPE_SPRITE_RADIUS);
  ctx.fillStyle = hexToRgba(color, opacity);
  ctx.fill();
  if (outlineWidth > 0) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth * 2; // compensate for pixelRatio:2
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, SHAPE_SPRITE_SIZE, SHAPE_SPRITE_SIZE);
}

/**
 * Rasterize a single icon glyph (no shape behind it) for use as a MapLibre
 * icon-image overlay on point layers (Symbology Studio icon overlay). Returns
 * null for an unknown icon key.
 */
export function renderIconImageData(iconKey: string, color: string): ImageData | null {
  const path = ICON_PATHS[iconKey];
  if (!path) return null;
  const SIZE = 64;
  const PAD = 4;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const draw = SIZE - PAD * 2;
  ctx.translate(PAD, PAD);
  ctx.scale(draw / 256, draw / 256);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(path), 'evenodd');
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

/**
 * Render a tileable hatch pattern sprite for use with MapLibre's fill-pattern.
 * The tile is 16×16 CSS pixels (32×32 canvas pixels at pixelRatio:2).
 * Lines are drawn transparent-background so the fill-color shows through.
 * Use with `map.addImage(id, data, { pixelRatio: 2 })`.
 */
export function renderHatchImageData(pattern: HatchPattern, color: string, opacity: number): ImageData {
  const T = 32; // canvas pixels → 16 CSS px at pixelRatio:2
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = T;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, T, T);
  ctx.strokeStyle = hexToRgba(color, Math.min(1, opacity * 1.5));
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.beginPath();
  switch (pattern) {
    case 'hatch-h':
      ctx.moveTo(0, T / 2); ctx.lineTo(T, T / 2);
      break;
    case 'hatch-v':
      ctx.moveTo(T / 2, 0); ctx.lineTo(T / 2, T);
      break;
    case 'hatch-cross':
      ctx.moveTo(0, T / 2); ctx.lineTo(T, T / 2);
      ctx.moveTo(T / 2, 0); ctx.lineTo(T / 2, T);
      break;
    case 'hatch-diagonal':
      // / diagonal: two halves tile seamlessly
      ctx.moveTo(0, T / 2); ctx.lineTo(T / 2, 0);
      ctx.moveTo(T / 2, T); ctx.lineTo(T, T / 2);
      break;
    default:
      break;
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, T, T);
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
 * Render a small point-symbol swatch for display in preset lists.
 */
export function renderSwatchDataUrl(preset: TypePreset, displaySize = 22): string {
  const canvas = renderPresetCanvas(preset);
  const out = document.createElement('canvas');
  out.width = out.height = displaySize;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, displaySize, displaySize);
  return out.toDataURL();
}

/**
 * Render a line-style swatch showing the color, width, and dash pattern.
 */
export function renderLineSwatchDataUrl(preset: TypePreset, displaySize = 22): string {
  const canvas = document.createElement('canvas');
  canvas.width = displaySize;
  canvas.height = displaySize;
  const ctx = canvas.getContext('2d')!;
  const sw = Math.max(1.5, Math.min(preset.stroke_width ?? 2, displaySize / 4));
  ctx.strokeStyle = preset.color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (preset.dash_pattern === 'dashed') {
    ctx.setLineDash([displaySize * 0.28, displaySize * 0.18]);
  } else if (preset.dash_pattern === 'dotted') {
    ctx.setLineDash([sw * 1.2, displaySize * 0.2]);
  }
  const p = displaySize * 0.1;
  ctx.beginPath();
  ctx.moveTo(p, displaySize - p);
  ctx.lineTo(displaySize * 0.42, displaySize * 0.28);
  ctx.lineTo(displaySize * 0.7, displaySize * 0.62);
  ctx.lineTo(displaySize - p, p);
  ctx.stroke();
  return canvas.toDataURL();
}

/**
 * Render a polygon swatch showing fill color/opacity, optional hatch, and stroke.
 */
export function renderPolygonSwatchDataUrl(preset: TypePreset, displaySize = 22): string {
  const canvas = document.createElement('canvas');
  canvas.width = displaySize;
  canvas.height = displaySize;
  const ctx = canvas.getContext('2d')!;
  const p = displaySize * 0.06;
  ctx.beginPath();
  ctx.moveTo(p + displaySize * 0.08, displaySize * 0.48);
  ctx.lineTo(displaySize * 0.48, p);
  ctx.lineTo(displaySize - p, displaySize * 0.28);
  ctx.lineTo(displaySize - p - displaySize * 0.06, displaySize - p);
  ctx.lineTo(p, displaySize - p - displaySize * 0.08);
  ctx.closePath();
  const fillOpacity = preset.fill_opacity ?? 0.35;
  const fp = preset.fill_pattern;
  // With a hatch pattern use a lighter base fill so lines stand out
  ctx.fillStyle = hexToRgba(preset.color, fp && fp !== 'solid' ? fillOpacity * 0.25 : fillOpacity);
  ctx.fill();
  if (fp && fp !== 'solid') {
    ctx.save();
    ctx.clip();
    drawHatchOnCanvas(ctx, fp, preset.color, fillOpacity, displaySize);
    ctx.restore();
  }
  const sc = preset.stroke_color ?? preset.color;
  ctx.strokeStyle = sc.startsWith('#') ? sc : preset.color;
  ctx.lineWidth = Math.max(1, Math.min(preset.stroke_width ?? 1.5, 3));
  ctx.stroke();
  return canvas.toDataURL();
}

function drawHatchOnCanvas(
  ctx: CanvasRenderingContext2D,
  pattern: HatchPattern,
  color: string,
  opacity: number,
  size: number,
): void {
  ctx.strokeStyle = hexToRgba(color, Math.min(1, opacity * 2));
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.lineCap = 'square';
  const sp = size * 0.22; // spacing between hatch lines
  ctx.beginPath();
  if (pattern === 'hatch-h') {
    for (let y = sp; y < size; y += sp) { ctx.moveTo(0, y); ctx.lineTo(size, y); }
  } else if (pattern === 'hatch-v') {
    for (let x = sp; x < size; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, size); }
  } else if (pattern === 'hatch-cross') {
    for (let y = sp; y < size; y += sp) { ctx.moveTo(0, y); ctx.lineTo(size, y); }
    for (let x = sp; x < size; x += sp) { ctx.moveTo(x, 0); ctx.lineTo(x, size); }
  } else if (pattern === 'hatch-diagonal') {
    // / diagonal lines, seamless by drawing beyond bounds
    for (let k = -size; k < size * 2; k += sp) {
      ctx.moveTo(k, size);
      ctx.lineTo(k + size, 0);
    }
  }
  ctx.stroke();
}

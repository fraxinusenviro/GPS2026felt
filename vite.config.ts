import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  // Use './' so all asset URLs are relative — works on any subpath (GitHub Pages, etc.)
  base: './',
  define: {
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        // The invertebrate species DB (~2.5MB) is off by default and loaded on
        // demand — keep it out of the precache and cache it at runtime instead.
        globIgnores: ['**/db-invertebrates.js'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/db\/db-invertebrates\.js$/i,
            handler: 'CacheFirst',
            options: { cacheName: 'inventory-db', expiration: { maxEntries: 1, maxAgeSeconds: 90 * 24 * 3600 } }
          },
          {
            urlPattern: /^https:\/\/.*\.arcgisonline\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'esri-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 } }
          },
          {
            urlPattern: /^https:\/\/.*\.openstreetmap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'osm-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 } }
          },
          {
            urlPattern: /^https:\/\/.*\.stadiamaps\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'stadia-tiles', expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 } }
          },
          {
            urlPattern: /^https:\/\/nsgiwa\d*\.novascotia\.ca\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'ns-arcgis', expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 3600 } }
          }
        ]
      },
      manifest: {
        name: 'Fraxinus Field Mapper',
        short_name: 'FieldMapper',
        description: 'Offline-first GPS Data Collector for Environmental Fieldwork',
        theme_color: '#1a3a2a',
        background_color: '#1a3a2a',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        icons: [
          { src: 'favicon-32.png', sizes: '32x32', type: 'image/png' },
          { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  optimizeDeps: {
    exclude: ['sql.js', 'pdfjs-dist']
  },
  resolve: {
    alias: { '@': '/src' }
  },
  worker: {
    format: 'es'
  }
});

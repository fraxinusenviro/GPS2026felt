import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Use './' so all asset URLs are relative — works on any subpath (GitHub Pages, etc.)
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
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
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
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

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: false, // Never activate SW in dev — avoids blank page from cached builds
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/epsg\.io\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'epsg-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nominatim-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
      manifest: {
        name: 'GeoPDF Web Viewer',
        short_name: 'GeoPDF',
        description: 'Browser-based GeoPDF viewer with GPS, waypoints, and field data collection',
        theme_color: '#1e40af',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // pdfjs-dist is a webpack bundle; Vite's esbuild pre-bundler breaks it.
    // Serve it directly from node_modules and use ?url for the worker path.
    exclude: ['pdfjs-dist'],
  },
  build: {
    // Explicit transpile target ensures iOS Safari 14+ compatibility.
    target: ['es2020', 'chrome87', 'safari14'],
    rollupOptions: {
      output: {
        // Pin pdfjs-dist to a stable named chunk so the service worker can
        // cache it across deployments independently of MapViewer changes.
        manualChunks: (id) => {
          if (id.includes('pdfjs-dist')) return 'pdfjs'
        },
      },
    },
  },
})

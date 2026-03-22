import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// pdfjs-dist is now configured in src/lib/geopdf.ts, which is only reachable
// through lazy-loaded chunks (MapViewer, ImportMapSheet). This keeps the main
// bundle free of the ~650 KB pdfjs library so iOS Safari can parse it.

// In dev mode, unregister any lingering service workers from previous production builds.
// A cached SW on the same origin will intercept dev server requests and serve stale files.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister()),
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

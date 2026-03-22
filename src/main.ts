import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';
import { App } from './App';

// Register service worker — use relative path so it works on any deploy subpath
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration failure is non-fatal in development
    });
  });
}

// Boot app
const app = new App();
app.init().catch(err => {
  console.error('App initialization failed:', err);
  const map = document.getElementById('map');
  if (map) {
    map.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fff;background:#1a3a2a;flex-direction:column;gap:12px;padding:24px;text-align:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:48px;height:48px;color:#f87171"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <h2 style="margin:0;font-size:1.2rem">Failed to start</h2>
        <p style="margin:0;opacity:0.7">${err?.message || 'Unknown error'}</p>
        <button onclick="location.reload()" style="padding:8px 20px;background:#4ade80;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold">Reload</button>
      </div>
    `;
  }
});

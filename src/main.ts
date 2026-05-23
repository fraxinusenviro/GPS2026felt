import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';
import { App } from './App';
import { SwUpdate } from './utils/SwUpdate';

// Track SW updates before registering so controllerchange is never missed
SwUpdate.init();

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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" style="width:48px;height:48px;color:#f87171"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z"/></svg>
        <h2 style="margin:0;font-size:1.2rem">Failed to start</h2>
        <p style="margin:0;opacity:0.7">${err?.message || 'Unknown error'}</p>
        <button onclick="location.reload()" style="padding:8px 20px;background:#4ade80;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:bold">Reload</button>
      </div>
    `;
  }
});

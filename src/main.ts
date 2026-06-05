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

// Login overlay
function showLoginOverlay(): void {
  const overlay = document.createElement('div');
  overlay.id = 'login-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:rgba(0,0,0,0.88)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font-family:inherit',
  ].join(';');

  overlay.innerHTML = `
    <div style="
      background:#0b1a10;
      border:1px solid rgba(91,175,130,0.22);
      border-radius:12px;
      padding:36px 40px 32px;
      min-width:320px;
      max-width:380px;
      box-shadow:0 8px 40px rgba(0,0,0,0.7);
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:20px;
    ">
      <img src="/logo_text_white.png" alt="Fraxinus" style="max-width:200px;height:auto;opacity:0.92" />
      <div style="color:rgba(200,220,200,0.5);font-size:12px;letter-spacing:0.06em;text-transform:uppercase;margin-top:-8px">
        Field Mapping
      </div>
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <input id="login-pw" type="password" placeholder="Password"
          autocomplete="current-password"
          style="
            width:100%;box-sizing:border-box;
            background:#0d2518;
            border:1px solid rgba(91,175,130,0.3);
            border-radius:6px;
            color:#e8f5e9;
            padding:10px 14px;
            font-size:14px;
            outline:none;
            font-family:inherit;
          " />
        <div id="login-error" style="color:#f87171;font-size:12px;text-align:center;display:none">
          Incorrect password — please try again.
        </div>
        <button id="login-submit" style="
          background:rgba(74,222,128,0.15);
          border:1px solid rgba(74,222,128,0.4);
          border-radius:6px;
          color:#4ade80;
          padding:10px;
          font-size:14px;
          cursor:pointer;
          font-family:inherit;
          font-weight:500;
          letter-spacing:0.02em;
        ">Enter</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const pwInput = overlay.querySelector<HTMLInputElement>('#login-pw')!;
  const submitBtn = overlay.querySelector<HTMLButtonElement>('#login-submit')!;
  const errorEl = overlay.querySelector<HTMLElement>('#login-error')!;

  const attempt = () => {
    if (pwInput.value === 'Fraxinusenviro') {
      overlay.style.transition = 'opacity 0.4s';
      overlay.style.opacity = '0';
      setTimeout(() => { overlay.remove(); }, 400);
    } else {
      errorEl.style.display = 'block';
      pwInput.value = '';
      pwInput.focus();
      setTimeout(() => { errorEl.style.display = 'none'; }, 3000);
    }
  };

  submitBtn.addEventListener('click', attempt);
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  pwInput.focus();
}

showLoginOverlay();

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

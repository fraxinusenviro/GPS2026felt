import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';
import { App } from './App';
import { SwUpdate } from './utils/SwUpdate';

// Track SW updates before registering so controllerchange is never missed
SwUpdate.init();

// Register service worker — use relative path so it works on any deploy subpath.
// Hand the registration to SwUpdate.watch() so the app proactively checks for a
// new sw.js on launch + when it returns to the foreground (self-heals stale
// installed iOS PWAs).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => SwUpdate.watch(reg))
      .catch(() => {
        // SW registration failure is non-fatal in development
      });
  });
}

// Login overlay
function showLoginOverlay(): void {
  const buildDate = new Date(__APP_BUILD_DATE__).toLocaleDateString('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const version = __APP_VERSION__;

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
      border-radius:14px;
      padding:36px 36px 28px;
      min-width:320px;
      max-width:380px;
      width:90vw;
      box-shadow:0 12px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(91,175,130,0.08);
      display:flex;
      flex-direction:column;
      align-items:center;
      gap:0;
    ">

      <!-- Logo -->
      <img src="./logo_text_white.png" alt="Fraxinus Environmental &amp; Geomatics"
        style="max-width:200px;width:100%;height:auto;margin-bottom:16px" />

      <!-- Divider -->
      <div style="width:100%;height:1px;background:rgba(91,175,130,0.15);margin-bottom:16px"></div>

      <!-- App info block -->
      <div style="text-align:center;margin-bottom:20px;display:flex;flex-direction:column;gap:5px">
        <div style="color:#c8e6c9;font-size:15px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase">
          FIELD MAPPER
        </div>
        <div style="color:rgba(160,210,170,0.6);font-size:11px;letter-spacing:0.03em">
          GPS data collector &amp; GIS tools
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-top:4px">
          <span style="
            background:rgba(74,222,128,0.1);
            border:1px solid rgba(74,222,128,0.25);
            border-radius:4px;
            color:rgba(74,222,128,0.75);
            font-size:10px;
            padding:2px 8px;
            letter-spacing:0.05em;
          ">v${version}</span>
          <span style="color:rgba(160,210,170,0.4);font-size:10px">${buildDate}</span>
        </div>
      </div>

      <!-- PIN display -->
      <div id="pin-display" style="
        display:flex;
        gap:12px;
        margin-bottom:18px;
        height:16px;
        align-items:center;
        justify-content:center;
      ">
        ${Array.from({length:6}).map((_,i) => `<div id="pin-dot-${i}" style="width:12px;height:12px;border-radius:50%;background:rgba(91,175,130,0.2);border:1.5px solid rgba(91,175,130,0.35);transition:background 0.1s,border-color 0.1s"></div>`).join('')}
      </div>

      <!-- Error -->
      <div id="login-error" style="color:#f87171;font-size:11px;text-align:center;display:none;padding:2px 0;margin-bottom:6px;letter-spacing:0.03em">
        Incorrect PIN — try again
      </div>

      <!-- Number pad -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:240px">
        ${[1,2,3,4,5,6,7,8,9,'','0','⌫'].map(k => {
          if (k === '') return `<div></div>`;
          return `<button class="pin-key" data-key="${k}" style="
            background:rgba(91,175,130,0.08);
            border:1px solid rgba(91,175,130,0.2);
            border-radius:8px;
            color:#c8e6c9;
            font-size:20px;
            font-family:inherit;
            padding:14px 0;
            cursor:pointer;
            transition:background 0.1s,border-color 0.1s;
            user-select:none;
          ">${k}</button>`;
        }).join('')}
      </div>

      <!-- Footer note -->
      <div style="margin-top:18px;color:rgba(160,210,170,0.3);font-size:10px;text-align:center;letter-spacing:0.03em">
        Authorized use only · Fraxinus Environmental &amp; Geomatics
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  const errorEl = overlay.querySelector<HTMLElement>('#login-error')!;
  const dots = Array.from({length:6}, (_,i) => overlay.querySelector<HTMLElement>(`#pin-dot-${i}`)!);
  let pin = '';

  const updateDots = () => {
    dots.forEach((d, i) => {
      const filled = i < pin.length;
      d.style.background = filled ? '#4ade80' : 'rgba(91,175,130,0.2)';
      d.style.borderColor = filled ? '#4ade80' : 'rgba(91,175,130,0.35)';
    });
  };

  const shakeError = () => {
    errorEl.style.display = 'block';
    pin = '';
    updateDots();
    setTimeout(() => { errorEl.style.display = 'none'; }, 2500);
  };

  const attempt = () => {
    if (pin === '191919') {
      localStorage.setItem(PIN_KEY, __APP_VERSION__);
      overlay.style.transition = 'opacity 0.4s';
      overlay.style.opacity = '0';
      setTimeout(() => { overlay.remove(); }, 400);
    } else {
      shakeError();
    }
  };

  overlay.querySelectorAll<HTMLButtonElement>('.pin-key').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const key = btn.dataset.key!;
      if (key === '⌫') {
        pin = pin.slice(0, -1);
        updateDots();
      } else if (pin.length < 6) {
        pin += key;
        updateDots();
        if (pin.length === 6) setTimeout(attempt, 120);
      }
    });
    btn.addEventListener('pointerenter', () => { btn.style.background = 'rgba(91,175,130,0.18)'; btn.style.borderColor = 'rgba(91,175,130,0.4)'; });
    btn.addEventListener('pointerleave', () => { btn.style.background = 'rgba(91,175,130,0.08)'; btn.style.borderColor = 'rgba(91,175,130,0.2)'; });
  });

  document.addEventListener('keydown', function kh(e) {
    if (/^\d$/.test(e.key) && pin.length < 6) {
      pin += e.key;
      updateDots();
      if (pin.length === 6) setTimeout(attempt, 120);
    } else if (e.key === 'Backspace') {
      pin = pin.slice(0, -1);
      updateDots();
    } else if (e.key === 'Enter') {
      attempt();
    }
    if (!document.getElementById('login-overlay')) document.removeEventListener('keydown', kh);
  });
}

// Only show PIN when the version has never been verified, or changed (after an update)
const PIN_KEY = 'fm-pin-ok';
if (localStorage.getItem(PIN_KEY) !== __APP_VERSION__) {
  showLoginOverlay();
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

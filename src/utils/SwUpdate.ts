/**
 * Tracks service-worker lifecycle to detect when a new version has taken over.
 * With the VitePWA autoUpdate strategy the incoming SW calls skipWaiting()
 * immediately, so instead of watching for a "waiting" worker we listen for
 * the controllerchange event which fires once the new SW is in control.
 *
 * `watch()` then drives proactive update checks (on launch + foreground), so an
 * installed iOS home-screen PWA — which only re-checks sw.js on cold launch and
 * often paints from the old cache first — self-heals onto the latest build.
 */
// Auto-reload only if the update lands within this window after startup, i.e.
// before the user is mid-task. After that we show a passive "tap to reload"
// prompt instead, so an active field capture is never interrupted.
const GRACE_MS = 10_000;

// How often a long-lived foreground session re-checks for a new sw.js.
const UPDATE_INTERVAL_MS = 30 * 60_000;

export const SwUpdate = {
  hasUpdate: false,
  startedAt: 0,
  refreshing: false,

  init(): void {
    if (!('serviceWorker' in navigator)) return;

    this.startedAt = Date.now();

    // Remember whether we already had an active controller.
    // controllerchange on first install (null → new) is NOT an update.
    let hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        // A new SW just took control. If it arrived during the startup grace
        // window, nothing is in progress yet — reload now for true self-heal.
        if (Date.now() - this.startedAt < GRACE_MS) {
          if (this.refreshing) return;
          this.refreshing = true;
          this.reload();
          return;
        }
        // Otherwise surface a passive prompt; don't yank the page mid-task.
        this.hasUpdate = true;
        window.dispatchEvent(new CustomEvent('sw-update-ready'));
      } else {
        // First install; record that we now have a controller.
        hadController = !!navigator.serviceWorker.controller;
      }
    });
  },

  /**
   * Proactively poll the registration for a new sw.js: once on launch, again
   * whenever the app returns to the foreground (the key iOS trigger, since iOS
   * suspends standalone PWAs and only resumes them on tap), and periodically
   * for long-lived sessions. Discovered updates flow through the
   * controllerchange handler above. All checks are best-effort.
   */
  watch(reg: ServiceWorkerRegistration): void {
    const check = () => { reg.update().catch(() => {}); };

    check();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });

    setInterval(check, UPDATE_INTERVAL_MS);
  },

  reload(): void {
    window.location.reload();
  },

  /**
   * Aggressive cache-bust: wipe all Cache Storage entries and unregister the
   * service worker, then reload. With no controller and an empty cache the
   * reload fetches fresh assets from the network, and the SW re-registers
   * against the latest sw.js. Best-effort — always reloads regardless.
   */
  async forceReload(): Promise<void> {
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(() => {})));
      }
    } catch {
      // best-effort; reload regardless
    }
    window.location.reload();
  },
};

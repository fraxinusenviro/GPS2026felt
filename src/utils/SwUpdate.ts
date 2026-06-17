/**
 * Tracks service-worker lifecycle to detect when a new version has taken over.
 * With the VitePWA autoUpdate strategy the incoming SW calls skipWaiting()
 * immediately, so instead of watching for a "waiting" worker we listen for
 * the controllerchange event which fires once the new SW is in control.
 */
export const SwUpdate = {
  hasUpdate: false,

  init(): void {
    if (!('serviceWorker' in navigator)) return;

    // Remember whether we already had an active controller.
    // controllerchange on first install (null → new) is NOT an update.
    let hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) {
        this.hasUpdate = true;
        window.dispatchEvent(new CustomEvent('sw-update-ready'));
      } else {
        // First install; record that we now have a controller.
        hadController = !!navigator.serviceWorker.controller;
      }
    });
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

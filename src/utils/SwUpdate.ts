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
};

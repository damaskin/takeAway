/**
 * Registers the service worker at boot.
 *
 * It used to be registered only when a customer turned push notifications
 * on, which meant the offline shell existed for the small minority who did
 * — and the app was a browser error page for everyone else. Registration
 * is cheap and unconditional; push is still opt-in and asks separately.
 *
 * Failure is silent by design: there is no service worker in a private
 * window, on an insecure origin, or with site data blocked. None of that
 * should surface to someone who just wants a coffee.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // After load, so registration never competes with the first paint.
  const register = (): void => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

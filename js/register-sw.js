/* Registers the service worker so the app is installable + offline-capable.
   External file (not inline) because the CSP is script-src 'self' — inline
   scripts are blocked. Registered at scope '/' to match the manifest. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      // Non-fatal: the app works fine without the SW; just log for diagnostics.
      console.warn('[pwa] service worker registration failed:', err);
    });
  });
}

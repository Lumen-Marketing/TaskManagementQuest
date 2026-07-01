/* Quest HQ service worker.
   Goal: installable + offline-capable WITHOUT serving stale assets. We use a
   NETWORK-FIRST strategy for same-origin GETs — the latest deploy always wins
   when online; the cache is only a fallback when the network is unavailable.
   (Deliberately not precaching/cache-first: this app has been bitten by stale
   CSS/JS before, so freshness is prioritized over a few ms of load time.)

   Not handled here: cross-origin requests (Supabase, Sentry, CDN, fonts) pass
   straight through, and `env.json` is never cached (runtime config must be
   fresh). Bump CACHE_VERSION to invalidate old runtime caches on deploy. */
const CACHE_VERSION = 'questhq-v2';
const OFFLINE_FALLBACK = '/app.html';

self.addEventListener('install', (event) => {
  // Activate this SW immediately rather than waiting for all tabs to close.
  self.skipWaiting();
  // Warm the cache with the app shell so a cold offline start still works.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(['/app.html', '/index.html', '/manifest.webmanifest']).catch(() => {})
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only manage same-origin requests; let Supabase/Sentry/CDN/fonts through.
  if (url.origin !== self.location.origin) return;
  // Never cache runtime config — it must always be current.
  if (url.pathname.endsWith('/env.json')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of good, basic responses for offline fallback.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // For navigations with nothing cached, fall back to the app shell.
        if (req.mode === 'navigate') {
          const shell = await caches.match(OFFLINE_FALLBACK);
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});

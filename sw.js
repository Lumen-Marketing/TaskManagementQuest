/* Quest HQ service worker.
   Strategy (ADR-0001, docs/adr/0001-cache-first-versioned-static-assets.md):
   - VERSIONED static assets (same-origin URLs carrying ?v=BUILD_ID, stamped by
     tools/build-env.mjs at deploy) are immutable → CACHE-FIRST. A new deploy
     changes the URL, so freshness is guaranteed by the version, not by
     revalidation — repeat mobile visits stop re-validating ~60 assets.
   - Everything else same-origin (HTML/navigations, un-versioned dev assets)
     stays NETWORK-FIRST with conditional revalidation — the latest deploy
     always wins when online; the cache is only an offline fallback. This app
     has been bitten by stale CSS/JS before; do NOT "restore" network-first-
     everything or loosen the versioned rule without reading the ADR.

   Not handled here: cross-origin requests (Supabase, Sentry, CDN, fonts) pass
   straight through, and `env.json` is never cached (runtime config must be
   fresh). The cache version is stamped at build time: tools/build-env.mjs
   replaces the __BUILD_ID__ placeholder with a short content hash so each
   deploy purges the previous deploy's caches. When the placeholder is never
   replaced (dev/local, no build step) the literal fallback keeps sw.js valid
   and the version simply stays constant. */
const BUILD_ID = '__BUILD_ID__';
const CACHE_VERSION = 'questhq-' + (BUILD_ID.startsWith('__') ? 'dev' : BUILD_ID);
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

  // Immutable versioned assets (?v= stamped at deploy): cache-first (ADR-0001).
  if (url.searchParams.has('v')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // App-logic assets must never be silently stale: a plain fetch(req) is
  // answered by the HTTP cache within its max-age, so "network-first" quietly
  // becomes "HTTP-cache-first" and a deploy can leave a tab running old JS
  // against new data until a hard refresh (the Ctrl+F5 bug). cache:'no-cache'
  // forces a conditional revalidation (cheap 304 when unchanged). Navigations
  // can't be re-wrapped (Request mode 'navigate' is not constructible) and rely
  // on the server's no-cache headers; images/fonts keep normal HTTP caching.
  const dest = req.destination;
  const netReq = (dest === 'script' || dest === 'style' || dest === 'manifest')
    ? new Request(req, { cache: 'no-cache' })
    : req;

  event.respondWith(
    fetch(netReq)
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

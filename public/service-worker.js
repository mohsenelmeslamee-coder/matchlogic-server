const CACHE_VERSION = 'matchlogic-v8';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/match.html',
  '/css/style.css?v=7',
  '/js/main.js?v=7',
  '/js/match.js?v=7',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/header-logo.png',
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ✅ ONLY handle same-origin requests. Cross-origin requests (fonts,
  // ad scripts, third-party APIs, etc.) are left completely alone —
  // this also avoids ever fighting the page's own CSP, and avoids
  // caching/cloning responses we don't control.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Only intercept safe, cacheable GET requests
  if (request.method !== 'GET') {
    return;
  }

  // API calls — Network only, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Static assets (CSS/JS/icons) — Cache first, refresh in background
  if (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/')  ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async cache => {
        const cached = await cache.match(request);

        // Always try the network too, to keep the cache fresh,
        // but clone the response IMMEDIATELY — before anything
        // else touches/reads the original — to avoid
        // "Response body is already used" errors.
        const networkFetch = fetch(request).then(res => {
          if (res.ok) {
            cache.put(request, res.clone());
          }
          return res;
        }).catch(() => null);

        if (cached) {
          // Serve cached version instantly, keep cache fresh in background.
          // event.waitUntil ensures the SW stays alive until the update completes
          // — without it, the browser can terminate the SW mid-fetch.
          event.waitUntil(networkFetch);
          return cached;
        }

        const networkRes = await networkFetch;
        return networkRes || new Response('', { status: 504 });
      })
    );
    return;
  }

  // HTML pages — Network first, cache fallback
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        // Clone immediately, before returning/using the response any further.
        if (res.ok) {
          const resClone = res.clone();
          caches.open(DYNAMIC_CACHE).then(c => c.put(request, resClone));
        }
        return res;
      } catch (err) {
        const cached = await caches.match(request);
        return cached || caches.match('/index.html');
      }
    })()
  );
});

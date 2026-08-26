// Stamped by the build so every deploy ships a byte-different worker.
const BUILD = '__SW_BUILD__';
const CACHE_NAME = `runway-cache-${BUILD}`;

// The shell needed to boot offline, hashed chunks join the cache as they are used.
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png'
];

const OFFLINE_MISS = () =>
  new Response('Offline and asset not cached', { status: 504, statusText: 'Offline' });

/** True when the SPA fallback answered a missing asset with index.html instead of a 404. */
function isHtml(response) {
  return (response.headers.get('content-type') || '').includes('text/html');
}

function put(request, response) {
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

/** Always boots the newest index.html, falling back to the cached shell only when offline. */
async function networkFirstDocument(request) {
  try {
    const response = await fetch(request);
    if (response.ok && isHtml(response)) put('/index.html', response);
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/index.html')) || OFFLINE_MISS();
  }
}

/** Safe cache-first: an /assets/ filename is content-hashed, so a hit can never be stale. */
async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Caching an HTML fallback here is what poisons the next boot, so refuse it.
    if (response.ok && !isHtml(response)) put(request, response);
    return response;
  } catch {
    return OFFLINE_MISS();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic' && !isHtml(response)) put(request, response);
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  return (await network) || OFFLINE_MISS();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[SW] Failed to pre-cache ${asset}`, err);
          })
        )
      )
    )
  );
  // Deliberately no skipWaiting: the race UI prompts before reloading so an update never interrupts a leg.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Map tiles, fonts and every other origin go straight to the network.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(event.request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Stamped by the build so every deploy ships a byte-different worker.
const BUILD = '__SW_BUILD__';
const CACHE_NAME = `runway-cache-${BUILD}`;

// The shell needed to boot offline, hashed chunks join the cache as they are used.
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/maskable-icon-512x512.png',
  // Latin glyph ranges cover every label a board normally shows.
  '/glyphs/Noto%20Sans%20Regular/0-255.pbf',
  '/glyphs/Noto%20Sans%20Regular/256-511.pbf',
  // The build fills this with the race and map chunks, the MapLibre worker and the Latin fonts.
  ...JSON.parse('__SW_PRECACHE__')
];

// Runtime caches outlive a build because tiles and glyphs never change with the app, and each is capped by entry count.
const RUNTIME_CACHES = {
  tiles: { name: 'runway-runtime-tiles-v1', maxEntries: 500 },
  glyphs: { name: 'runway-runtime-glyphs-v1', maxEntries: 128 }
};

const TILE_HOSTS = /(^|\.)(basemaps\.cartocdn\.com|arcgisonline\.com)$/;

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

/** Drops the oldest entries once a runtime cache passes its cap. */
async function trim(cache, maxEntries) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

/** Cache-first with a size cap, for content that is immutable for a given URL. */
async function cacheFirstCapped(request, { name, maxEntries }) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque and error responses would fill the cap without ever being usable offline.
    if (response.ok && response.type !== 'opaque' && !isHtml(response)) {
      const copy = response.clone();
      const cache = await caches.open(name);
      await cache.put(request, copy).then(() => trim(cache, maxEntries)).catch(() => {});
    }
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
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && !key.startsWith('runway-runtime-'))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Basemap tiles are cached by URL; every other origin goes straight to the network.
  if (url.origin !== self.location.origin) {
    if (TILE_HOSTS.test(url.hostname)) event.respondWith(cacheFirstCapped(event.request, RUNTIME_CACHES.tiles));
    return;
  }
  if (url.pathname.startsWith('/api')) return;

  if (url.pathname.startsWith('/glyphs/')) {
    event.respondWith(cacheFirstCapped(event.request, RUNTIME_CACHES.glyphs));
    return;
  }

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

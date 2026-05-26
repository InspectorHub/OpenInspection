// OpenInspection Service Worker
// Strategy:
//   - Static assets (CSS/JS/images/manifest): cache-first, update in background
//   - CDN assets (Alpine.js, fonts): cache-first on first fetch
//   - HTML navigation: network-first, fall back to cache for offline shell
//   - /api/* requests: network-only (offline handled by IndexedDB in the app)

const SW_VERSION  = 'v2-b4';
const CACHE_NAME  = `openinspection-${SW_VERSION}`;

const PRECACHE_ASSETS = [
  '/styles.css',
  '/favicon.svg',
  '/logo.svg',
  '/manifest.json',
];

const CDN_HOSTS = [];

// ���� Install: precache static shell ������������������������������������������������������������������������������������
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  // Activate immediately ??don't wait for old tabs to close
  self.skipWaiting();
});

// ���� Activate: purge stale caches ����������������������������������������������������������������������������������������
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'sw-updated', version: SW_VERSION }));
  });
});

// ���� Fetch ����������������������������������������������������������������������������������������������������������������������������������������
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Photo files served from R2 via our API ??cache-first (keys are UUIDs, immutable)
  if (url.pathname.startsWith('/api/inspections/files/')) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
  }

  // All other API calls: network-only; offline handled by IndexedDB / photo queue
  if (url.pathname.startsWith('/api/')) {
    const isInspectionRead = /^\/api\/inspections\/[^/]+(\/results)?$/.test(url.pathname);
    if (isInspectionRead && request.method === 'GET') {
      event.respondWith(cacheFirstWithRefresh(request));
      return;
    }
    return; // all other API calls: network-only
  }

  // Static assets on our origin: stale-while-revalidate
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname === '/manifest.json');

  if (isStaticAsset) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
  }

  // CDN assets (Alpine.js, Google Fonts): cache-first, fetch & store on miss
  const isCdnAsset = CDN_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  if (isCdnAsset) {
    event.respondWith(cacheFirstWithRefresh(request));
    return;
  }

  // HTML navigation: network-first, serve cached shell on failure
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }
});

// ���� Helpers ��������������������������������������������������������������������������������������������������������������������������������������

async function cacheFirstWithRefresh(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Refresh in the background even when serving from cache
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await networkFetch);
}

async function networkFirstWithCacheFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline ??please reconnect to continue.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

// ── Background Sync (Chromium only — iOS Safari throws on register) ─────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'queue-changed') {
    try {
      self.registration.sync?.register('oi-sync');
    } catch { /* iOS Safari has no SyncManager */ }
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'oi-sync') return;
  event.waitUntil((async () => {
    // Cannot import ES modules into a classic SW — open a client to drive it
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    if (clients[0]) clients[0].postMessage({ type: 'drain-queue' });
  })());
});

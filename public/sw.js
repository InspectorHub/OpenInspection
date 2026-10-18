// OpenInspection Service Worker
//
// Two caches, kept apart on purpose:
//
//   STATIC_CACHE  Same for every visitor: CSS/JS/images/manifest. Cache-first, refreshed in the
//                 background. Nothing in it depends on who is signed in.
//
//   USER_CACHE    Everything that depends on the signed-in user, so it can work offline for THAT user
//                 and for nobody else:
//                   - a single inspection and its results (UUID ids only)
//                   - inspection photo files
//                   - HTML pages (the server-rendered document embeds the viewer's data)
//                 Every entry is stamped with the opaque session marker it was stored under
//                 (`x-oi-user`) and is served only to the SAME marker. The marker is learned from the
//                 page (`set-user` message) and from the `x-oi-session` header the server puts on
//                 document responses that carry a session.
//                 With no known user nothing is read from, or written to, this cache (fail closed).
//
// All other /api/* calls are network-only. The list, the counts and the dashboard are aggregates over
// whatever the caller may see; a cached copy of one is some other user's answer.
//
// Messages from the page:
//   { type: 'set-user', marker: string | null }  who is signed in now (null: nobody). A change purges USER_CACHE.
//   { type: 'clear-user-cache' }                 purge USER_CACHE and forget the user (sign-out).
//   { type: 'queue-changed' }                    register the background sync.

const SW_VERSION   = 'v4-a1';
const STATIC_CACHE = `openinspection-static-${SW_VERSION}`;
const USER_CACHE   = `openinspection-user-${SW_VERSION}`;
const META_CACHE   = `openinspection-meta-${SW_VERSION}`;
const KEEP_CACHES  = [STATIC_CACHE, USER_CACHE, META_CACHE];

const MARKER_URL   = `${self.location.origin}/__oi/user-marker`;
const USER_HEADER  = 'x-oi-user';
const SESSION_HEADER = 'x-oi-session';

const PRECACHE_ASSETS = [
  '/favicon.svg',
  '/logo.svg',
  '/manifest.json',
];

// Only an inspection id is cacheable. `/api/inspections/<segment>` is also where the reserved static
// routes live (counts, dashboard, templates, inspectors, bulk, wizard, schedule-conflicts, ...; the
// authoritative list is RESERVED_INSPECTION_SEGMENTS in server/lib/inspection/reserved-segments.ts).
// None of them is UUID-shaped, so matching the id shape excludes them all without a second copy of the
// list here; app/lib/sw.test.ts walks the server's list against this file to keep that true.
const INSPECTION_READ = /^\/api\/inspections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/results)?$/i;
const PHOTO_FILE_PREFIX = '/api/inspections/files/';
const LOGOUT_PATHS = ['/logout', '/agent-logout'];

// -- Install: precache the static shell ---------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Tolerant precache: a single 404 must not brick the whole install
      // ('/styles.css' did exactly that after the single-worker flatten).
      Promise.allSettled(PRECACHE_ASSETS.map((a) => cache.add(a)))
    )
  );
  // Activate immediately; don't wait for old tabs to close
  self.skipWaiting();
});

// -- Activate: purge every cache of an earlier version ------------------------------------------
// This is what removes the shared, user-blind cache that older versions wrote.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open clients immediately
  self.clients.claim();
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'sw-updated', version: SW_VERSION }));
  });
});

// -- Who is signed in ---------------------------------------------------------------------------
// The marker lives in a Cache entry, not in a variable: a worker is stopped and restarted all the
// time, and a variable would forget the user exactly when the page is offline.
async function readMarker() {
  try {
    const cache = await caches.open(META_CACHE);
    const hit = await cache.match(MARKER_URL);
    const text = hit ? await hit.text() : '';
    return text || null;
  } catch {
    return null;
  }
}

async function writeMarker(marker) {
  const cache = await caches.open(META_CACHE);
  if (marker) await cache.put(MARKER_URL, new Response(marker));
  else await cache.delete(MARKER_URL);
}

async function clearUserCache() {
  await writeMarker(null);
  await caches.delete(USER_CACHE);
}

// Record who is signed in. A different user (or nobody) means every USER_CACHE entry belongs to someone else.
async function setUser(marker) {
  const next = typeof marker === 'string' && marker.length > 0 && marker.length <= 128 ? marker : null;
  const current = await readMarker();
  if (current === next) return;
  await writeMarker(next);
  await caches.delete(USER_CACHE);
}

// -- Fetch --------------------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith('/api/')) {
    // Photo files served from R2 via our API: keys are UUIDs and immutable, but who may read one is
    // not, so they are cached per user like everything else that depends on access.
    if (url.pathname.startsWith(PHOTO_FILE_PREFIX) || INSPECTION_READ.test(url.pathname)) {
      event.respondWith(userCacheFirst(event, request));
    }
    return; // every other API call: network-only; offline editing is handled by the Yjs/IndexedDB layer
  }

  // Static assets on our origin: cache-first, refreshed in the background
  const isStaticAsset =
    sameOrigin &&
    (url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.jpg') ||
      url.pathname.endsWith('.jpeg') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.webp') ||
      url.pathname === '/manifest.json');

  if (isStaticAsset) {
    event.respondWith(staticCacheFirst(event, request));
    return;
  }

  // HTML navigation: network-first, serve this user's cached page on failure
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url));
    return;
  }
});

// -- Helpers ------------------------------------------------------------------------------------

async function staticCacheFirst(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);

  // Refresh in the background even when serving from cache
  const refresh = fetch(request).then((response) => {
    if (response.ok && response.status === 200) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

// Store a copy stamped with the marker it was fetched under.
async function putForUser(request, response, marker) {
  const headers = new Headers(response.headers);
  headers.set(USER_HEADER, marker);
  const stamped = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(USER_CACHE);
  await cache.put(request, stamped);
}

// A cached entry for exactly this user, or null. An entry stamped for anyone else is removed.
async function cachedForUser(request, marker) {
  const cache = await caches.open(USER_CACHE);
  const hit = await cache.match(request);
  if (!hit) return null;
  if (hit.headers.get(USER_HEADER) === marker) return hit;
  await cache.delete(request);
  return null;
}

async function userCacheFirst(event, request) {
  const marker = await readMarker();
  // Nobody known: behave as if this cache did not exist.
  if (!marker) return fetch(request);

  const cached = await cachedForUser(request, marker);

  const refresh = (async () => {
    let response;
    try {
      response = await fetch(request);
    } catch {
      return null;
    }
    // Copy now: the body can be read once, and the caller gets the original.
    const copy = response.ok && response.status === 200 ? response.clone() : null;
    if (copy) {
      // Sign-out or a different user may have happened while this was in flight.
      if ((await readMarker()) === marker) await putForUser(request, copy, marker);
    } else if (response.status === 401 || response.status === 403 || response.status === 404) {
      // The server no longer lets this user read it: forget our copy.
      const cache = await caches.open(USER_CACHE);
      await cache.delete(request);
    }
    return response;
  })();

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

async function navigate(request, url) {
  // Leaving the session: drop the user's cache before the request goes out.
  if (LOGOUT_PATHS.includes(url.pathname)) await clearUserCache();

  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    // The server stamps a document requested with a session with an opaque marker of that user, so a
    // landing page (SSO, an invite link, a bookmark) tells the worker who is looking before any script
    // runs. No header means "not told", not "signed out": nothing changes and the page is not stored.
    // Sign-out is announced by the page (set-user null) and by /logout above.
    const marker = response.headers.get(SESSION_HEADER);
    if (marker && response.status >= 200 && response.status < 300 && type.includes('text/html')) {
      await setUser(marker);
      if ((await readMarker()) === marker) await putForUser(request, response.clone(), marker);
    }
    return response;
  } catch {
    const marker = await readMarker();
    const cached = marker ? await cachedForUser(request, marker) : null;
    // `charset=utf-8` is load-bearing. The em-dash below is two UTF-8 bytes,
    // and a `text/plain` response with no charset is decoded with the browser's
    // legacy default, which rendered this sentence as mojibake on a machine with
    // a CJK locale. Found by reading the offline page in a browser; nothing in
    // the source looks wrong.
    return cached || new Response('Offline — please reconnect to continue.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// -- Messages and Background Sync ---------------------------------------------------------------
// (Background sync: Chromium only; iOS Safari throws on register.)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'queue-changed') {
    try {
      self.registration.sync?.register('oi-sync');
    } catch { /* iOS Safari has no SyncManager */ }
  } else if (data.type === 'set-user') {
    event.waitUntil(setUser(data.marker));
  } else if (data.type === 'clear-user-cache') {
    event.waitUntil(clearUserCache());
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

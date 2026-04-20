const CACHE_NAME = 'power-tier-list-v2';
const MAX_CACHE_ENTRIES = 80;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function shouldCache(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  // Never cache API/sync endpoints or dev HMR URLs.
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/@')) return false;
  if (url.pathname.startsWith('/node_modules/')) return false;
  if (url.searchParams.has('t')) return false;
  if (url.searchParams.has('import')) return false;
  if (url.searchParams.has('v')) return false;
  return true;
}

async function trimCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_CACHE_ENTRIES) return;
  const overflow = keys.length - MAX_CACHE_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!shouldCache(request)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone).then(() => trimCache(cache));
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') {
            return (
              caches.match('/power-tier-list/index.html') ||
              caches.match('/index.html') ||
              new Response('Offline', { status: 503 })
            );
          }
          return new Response('Offline', { status: 503 });
        })
      )
  );
});

// Service Worker — GuruAI Builder v1.0
// Strategi Cache: Offline First
// Dibuat oleh PWA Converter Engine v2.0

const CACHE_NAME = 'guruai-builder-v1-0-v1';
const STATIC_ASSETS = ['/', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './offline.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).catch(err => console.warn('[SW] Pre-cache partial failure:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => {
        console.log('[SW] Removing old cache:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached; // Always serve from cache when available
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return response;
      }).catch(() =>
        event.request.destination === 'document'
          ? caches.match('./offline.html')
          : new Response('Offline', { status: 503 })
      );
    })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'GuruAI Builder v1.0', body: 'Ada notifikasi baru!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-96.png'
    })
  );
});

self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
});

// Service Worker - Alat Premium (Smart Bloom & Topic Analyzer, GuruAI Builder, ghp-bridge.js)
// Letak: /Premium/sw-premium.js  (scope: /Premium/)
// Kenapa terpisah: SW di /Premium/Guru-Hub/ hanya mengendalikan halaman di dalam folder itu. Aplikasi premium
// dimuat dalam iframe dari /Premium/*.html (di luar folder Guru Hub) sehingga butuh SW dengan scope /Premium/.
// SW yang lebih spesifik (Guru Hub) tetap mengendalikan Guru Hub; berkas ini mengendalikan aplikasi premium.
// Strategi: Stale-While-Revalidate. TIDAK menyimpan Apps Script, login Google, atau API Gemini.
// Naikkan VERSI tiap kali mengunggah versi baru aplikasi premium.

const VERSI = 'v11';
const CACHE_NAME = 'alat-premium-cbt-kabut-digital-' + VERSI;
const STATIC_ASSETS = [
  './topik-bloom-classifier_pro.html',
  './guruai-builder.html',
  './media-interaktif.html',
  './ghp-bridge.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];
const HOST_LUAR_BOLEH = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(STATIC_ASSETS.map(u => cache.add(u).catch(err => console.warn('[SW-Premium] lewati', u, err && err.message))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.indexOf('alat-premium-cbt-kabut-digital-') === 0 && k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let u;
  try { u = new URL(req.url); } catch (e) { return; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  const seasal = u.origin === self.location.origin;
  if (!seasal && HOST_LUAR_BOLEH.indexOf(u.hostname) === -1) return;
  // Fragmen (#tiket=...) tidak ikut ke permintaan, jadi cocok dengan simpanan apa adanya.
  // ghp-bridge.js adalah GERBANG & protokol sinkron: selalu coba jaringan dulu (maks 3 detik), cache hanya cadangan offline.
  if (seasal && u.pathname.slice(-14) === '/ghp-bridge.js') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 3000);
        try {
          const resp = await fetch(req, { signal: ac.signal });
          clearTimeout(t);
          if (resp && resp.status === 200) cache.put(req, resp.clone()).catch(() => {});
          return resp;
        } catch (e) {
          clearTimeout(t);
          const cached = await cache.match(req);
          return cached || new Response('// offline', { status: 503, headers: { 'Content-Type': 'application/javascript' } });
        }
      })
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(req);
      const dariJaringan = fetch(req).then(resp => {
        if (resp && (resp.status === 200 || resp.type === 'opaque') && (resp.type !== 'opaque' || !seasal)) {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      }).catch(() => null);
      if (cached) { event.waitUntil(dariJaringan); return cached; }
      const resp = await dariJaringan;
      return resp || new Response('Sedang offline dan halaman ini belum tersimpan. Buka sekali saat online.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});

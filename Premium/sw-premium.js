// Service Worker — Alat Premium (Smart Bloom & Topic Analyzer, GuruAI Builder, ghp-bridge.js)
// Letak: /Premium/sw-premium.js  (scope: /Premium/)
// Kenapa terpisah: SW di /Premium/Guru-Hub/ hanya mengendalikan halaman di dalam folder itu. Aplikasi premium
// dimuat dalam iframe dari /Premium/*.html (di luar folder Guru Hub) sehingga butuh SW dengan scope /Premium/.
// SW yang lebih spesifik (Guru Hub) tetap mengendalikan Guru Hub; berkas ini mengendalikan aplikasi premium.
// Strategi: Stale-While-Revalidate. TIDAK menyimpan Apps Script, login Google, atau API Gemini.
// Naikkan VERSI tiap kali mengunggah versi baru aplikasi premium.

const VERSI = 'v1';
const CACHE_NAME = 'alat-premium-cbt-kabut-digital-' + VERSI;
const STATIC_ASSETS = [
  './topik-bloom-classifier_pro.html',
  './guruai-builder.html',
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

// Service Worker — Guru Hub · CBT Kabut Digital
// Letak: /Premium/Guru-Hub/sw.js  (scope: /Premium/Guru-Hub/)
// Strategi: Stale-While-Revalidate untuk berkas statis milik Guru Hub dan pustaka CDN tertentu.
// TIDAK PERNAH menyimpan: Apps Script (script.google.com / googleusercontent.com), login Google, API Gemini, dan
// permintaan non-GET. Data lisensi/sinkron harus selalu dari server -- yang basi di sini berbahaya.
// Aplikasi premium (/Premium/*.html) ditangani sw-premium.js (scope /Premium/), bukan berkas ini.
// Naikkan VERSI setiap kali Anda mengunggah index.html baru supaya simpanan lama dibersihkan.

const VERSI = 'v16';
const CACHE_NAME = 'guru-hub-cbt-kabut-digital-' + VERSI;
const STATIC_ASSETS = [
  './', './index.html', './manifest.json', './offline.html',
  './icons/icon-128.png', './icons/icon-144.png', './icons/icon-152.png', './icons/icon-192.png', './icons/icon-512.png'
];
const HOST_LUAR_BOLEH = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // Satu per satu: ikon yang belum ada (404) tidak boleh menggagalkan seluruh pra-simpan (addAll semua-atau-tidak-sama-sekali)
      Promise.all(STATIC_ASSETS.map(u => cache.add(u).catch(err => console.warn('[SW] lewati', u, err && err.message))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.indexOf('guru-hub-cbt-kabut-digital-') === 0 && k !== CACHE_NAME).map(k => caches.delete(k)))
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
  if (!seasal && HOST_LUAR_BOLEH.indexOf(u.hostname) === -1) return; // biarkan langsung ke jaringan
  // Berkas lain di domain yang sama tetapi di luar folder Guru Hub (mis. /Premium/*.html) bukan urusan SW ini
  const adalahDokumen = req.mode === 'navigate' || req.destination === 'document';

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      // Dokumen dibuka dengan query (mis. ?source=pwa) -> abaikan query agar tetap kena simpanan
      const cached = await cache.match(req, { ignoreSearch: adalahDokumen });
      const dariJaringan = fetch(req).then(resp => {
        if (resp && (resp.status === 200 || resp.type === 'opaque') && (resp.type !== 'opaque' || !seasal)) {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      }).catch(() => null);
      if (cached) { event.waitUntil(dariJaringan); return cached; }
      const resp = await dariJaringan;
      if (resp) return resp;
      if (adalahDokumen) { const off = await cache.match('./offline.html'); if (off) return off; }
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Guru Hub · CBT Kabut Digital', body: 'Ada notifikasi baru!' };
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

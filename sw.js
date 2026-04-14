/**
 * Service Worker - ネットワーク優先キャッシュ（常に最新を取得）
 */
const CACHE_NAME = 'sedori-app-v36';
const CACHE_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/models.js',
  './js/db.js',
  './js/app.js',
  './js/utils/image.js',
  './js/utils/csv.js',
  './js/utils/csv-import.js',
  './js/utils/charts.js',
  './js/utils/pdf.js',
  './js/utils/research.js',
  './js/ui/modal.js',
  './js/ui/products.js',
  './js/ui/expenses.js',
  './js/ui/materials.js',
  './js/ui/dashboard.js',
  './js/ui/reports.js',
  './js/ui/settings.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(CACHE_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // CDN やクロスオリジンはネットワーク優先
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }
  // ネットワーク優先: まずサーバーから取得し、キャッシュも更新。失敗時のみキャッシュを返す
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});

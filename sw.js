const CACHE_NAME = 'bicho-por-perto-v1';
const ASSETS = ['.', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('api.inaturalist.org')) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(e.request, c)); return res; }).catch(() => caches.match(e.request))); return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

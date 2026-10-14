const CACHE_NAME = 'jelajah-shell-v2-fullstack';
const CORE_FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('jelajah-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put('./index.html', response.clone()));
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
    return;
  }

  const localShellAsset = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/sw.js'].includes(url.pathname);
  if (!localShellAsset) return;
  event.respondWith(caches.match(request).then(cached => {
    const networkUpdate = fetch(request).then(response => {
      if (response && response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || networkUpdate;
  }));
});

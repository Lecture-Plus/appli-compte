// Service Worker – Budget Foyer
// Stratégie : Cache First pour l'app shell, réseau ignoré (tout est local)

const CACHE_NAME = 'budget-foyer-v1';

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/drive.js',
  './js/calculs.js',
  './js/utils.js',
  './js/app.js',
  './js/ui/dashboard.js',
  './js/ui/saisie.js',
  './js/ui/charges.js',
  './js/ui/stats.js',
  './js/ui/settings.js',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'
];

// Installation : mise en cache de tous les fichiers de l'app
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Erreur cache install:', err))
  );
});

// Activation : suppression des anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(n => n !== CACHE_NAME)
          .map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch : retourne depuis le cache, puis réseau en fallback
self.addEventListener('fetch', event => {
  // On ignore les requêtes non GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          // Mise en cache dynamique des nouvelles ressources
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
      .catch(() => caches.match('./index.html'))
  );
});

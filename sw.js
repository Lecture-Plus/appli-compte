// Service Worker – Compta+
// Stratégie : Network First pour l'app shell (auto-update), Cache pour CDN

const CACHE_NAME = 'compta-plus-v24';

const APP_SHELL = [
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/drive.js',
  './js/sync.js',
  './js/calculs.js',
  './js/utils.js',
  './js/app.js',
  './js/ui/dashboard.js',
  './js/ui/argent.js',
  './js/ui/saisie.js',
  './js/ui/charges.js',
  './js/ui/savings.js',
  './js/ui/budgets.js',
  './js/ui/stats.js',
  './js/ui/settings.js',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'
];

// CDN : toujours servi depuis le cache une fois mis en cache
const CDN_ORIGINS = ['cdn.jsdelivr.net'];

// Installation : téléchargement forcé sans cache HTTP
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        const requests = APP_SHELL.map(url =>
          url.startsWith('http')
            ? url
            : new Request(url, { cache: 'no-store' })
        );
        return cache.addAll(requests);
      })
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

// Notification click : ouvrir l'app sur la page saisie
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetPage = event.notification.data?.page ?? 'saisie';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.postMessage({ type: 'navigate', page: targetPage });
          return;
        }
      }
      return self.clients.openWindow(self.registration.scope + '#' + targetPage);
    })
  );
});

// Fetch : Network First pour l'app shell, Cache First pour CDN
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isCDN = CDN_ORIGINS.some(o => url.hostname.includes(o));

  if (isCDN) {
    // Cache First pour les libs CDN (elles ne changent pas)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      }).catch(() => caches.match('./index.html'))
    );
  } else {
    // Network First pour l'app shell : met à jour le cache à chaque requête réussie
    event.respondWith(
      fetch(new Request(event.request, { cache: 'no-store' }))
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
  }
});

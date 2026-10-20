// Service Worker de Agenda Fácil — v1
// Estrategia: cache-first con revalidación en background (stale-while-revalidate)

const CACHE_NAME = "agenda-facil-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "https://cdn.tailwindcss.com/3.4.16",
  "https://unpkg.com/lucide@0.451.0",
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,600&display=swap"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        // addAll falla si UNO falla; usar map con catch para no romper el install
        return Promise.all(PRECACHE.map(function (url) {
          return cache.add(url).catch(function () { /* ignora fallos de CDN */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  // No interceptar llamadas a wa.me
  if (event.request.url.indexOf("wa.me") !== -1) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      var fetchPromise = fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone).catch(function () {});
          });
        }
        return response;
      }).catch(function () { return cached; });

      return cached || fetchPromise;
    })
  );
});

// Mensajes desde la app
self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
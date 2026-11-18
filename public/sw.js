const CACHE = "radio-unab-v1";
const ASSETS = ["/", "/css/oyente.css", "/js/oyente.js", "/img/logo.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("/socket.io/")) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "Radio UNAB", body: "La radio está en vivo" };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/img/logo.jpg",
    badge: "/img/logo.jpg",
    vibrate: [200, 100, 200]
  }));
});

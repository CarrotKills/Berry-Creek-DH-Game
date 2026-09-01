const CACHE = "berry-creek-tics-v5";
const ASSETS = ["./", "./index.html", "./styles.css", "./score-engine.js", "./round-state.js", "./app.js", "./manifest.webmanifest", "./berry-creek-logo.jpeg"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

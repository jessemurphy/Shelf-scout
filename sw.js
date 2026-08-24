/* Shelf Scout service worker: network-first so a new deploy shows up on the
   next load, cache fallback so it opens offline in a store with no signal.
   Only same-origin GETs are cached — familynet and Google Books lookups
   pass straight through. */
const CACHE = "scout-v3";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js",
                "./vendor/zxing.min.js", "./manifest.json",
                "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true })
        .then((m) => m || caches.match("./index.html"))
    )
  );
});

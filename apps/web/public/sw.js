const CACHE = "crew-shell-v1";
const ICONS = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];
const SHELL = ["/crew/today", "/crew/map", "/crew/outbox", "/crew/me", "/crew/manifest.webmanifest"];

function cachePlan(url, method) {
  if (method !== "GET") return "bypass";
  const host = url.hostname.toLowerCase();
  if (host.includes("arcgis.com") || host.includes("arcgisonline.com") || host.includes("supabase")) return "bypass";
  if (url.origin !== self.location.origin) return "bypass";
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/_next/static/")) return "cache-first";
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/crew")) return "network-first";
  return "bypass";
}

function cacheFirst(request) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) void cache.put(request, response.clone());
          return response;
        }),
    ),
  );
}

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => caches.match(request).then((hit) => hit || offlineResponse(request)));
}

function offlineResponse(request) {
  if (request.mode === "navigate") {
    return new Response("No signal. Your work is saved on this phone.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(ICONS);
        await Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const plan = cachePlan(new URL(event.request.url), event.request.method);
  if (plan === "cache-first") event.respondWith(cacheFirst(event.request));
  else if (plan === "network-first") event.respondWith(networkFirst(event.request));
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "crew-outbox") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "crew-flush" });
    }),
  );
});

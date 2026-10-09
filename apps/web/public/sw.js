const BUILD_ID = /^[A-Za-z0-9._-]{1,64}$/;
const ICONS = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"];
const PRECACHE = ["/offline.html", "/crew/manifest.webmanifest", ...ICONS];

function crewCacheName(build) {
  const id = build && BUILD_ID.test(build) ? build : "dev";
  return "crew-shell-" + id;
}

const CACHE = crewCacheName(new URL(self.location.href).searchParams.get("build"));

function cachePlan(url, method) {
  if (method !== "GET") return "bypass";
  const host = url.hostname.toLowerCase();
  if (host.includes("arcgis.com") || host.includes("arcgisonline.com") || host.includes("supabase")) return "bypass";
  if (url.origin !== self.location.origin) return "bypass";
  if (
    url.pathname === "/offline.html" ||
    url.pathname === "/crew/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/")
  ) {
    return "cache-first";
  }
  if (url.pathname === "/crew/today") return "network-first";
  if (url.pathname === "/sw.js" || url.pathname.startsWith("/crew")) return "network-only";
  return "bypass";
}

function canCacheCrewPage(response) {
  return response.status === 200 && response.type === "basic" && response.redirected !== true;
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

function networkOnly(request) {
  return fetch(request).catch(() => offlineResponse(request));
}

function cachedThenOffline(request) {
  return caches.open(CACHE).then((cache) => cache.match(request).then((hit) => hit || offlineResponse(request)));
}

function networkFirst(request) {
  return fetch(request).then(
    (response) => {
      if (!canCacheCrewPage(response)) return cachedThenOffline(request);
      const copy = response.clone();
      void caches.open(CACHE).then((cache) => cache.put(request, copy));
      return response;
    },
    () => cachedThenOffline(request),
  );
}

function offlineResponse(request) {
  if (request.mode === "navigate") {
    return caches.match("/offline.html").then(
      (hit) =>
        hit ||
        new Response("No signal. Your work is saved on this phone.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    );
  }
  return Response.error();
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
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
  else if (plan === "network-only") event.respondWith(networkOnly(event.request));
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "crew-outbox") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "crew-flush" });
    }),
  );
});

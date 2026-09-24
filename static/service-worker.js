const CACHE_PREFIX = "football-attendance-";
const CACHE_NAME = `${CACHE_PREFIX}v23`;
const ASSET_VERSION = "20260924-3";
const APP_SHELL = [
  "/",
  "/miercuri",
  "/echipe",
  "/manage.html",
  "/inscrierile-mele",
  "/history.html",
  `/styles.css?v=${ASSET_VERSION}`,
  `/ui-enhancements.css?v=${ASSET_VERSION}`,
  `/app.js?v=${ASSET_VERSION}`,
  `/teams.js?v=${ASSET_VERSION}`,
  `/manage.js?v=${ASSET_VERSION}`,
  `/history.js?v=${ASSET_VERSION}`,
  `/manifest.webmanifest?v=${ASSET_VERSION}`,
  `/app-icon.svg?v=${ASSET_VERSION}`,
  `/app-icon-192.png?v=${ASSET_VERSION}`,
  `/app-icon-512.png?v=${ASSET_VERSION}`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(APP_SHELL.map((path) => new Request(path, { cache: "reload" }))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        const oldAppCaches = keys.filter(
          (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
        );
        await Promise.all(oldAppCaches.map((key) => caches.delete(key)));
        await self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    if (url.pathname.startsWith("/inscriere/")) {
      event.respondWith(
        fetch(new Request(request, { cache: "no-store" })).catch(() => caches.match("/manage.html")),
      );
      return;
    }
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          return (await caches.match(request)) || (await caches.match("/"));
        }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-store" }))
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || Response.error()),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  if (!payload || !["friday", "wednesday"].includes(payload.event)) return;
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || "Lista de fotbal a fost actualizată", {
      body: payload.body || "Verifică lista curentă.",
      icon: "/app-icon-192.png",
      data: { event: payload.event },
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: "ROSTER_CHANGED", event: payload.event }));
    }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.event === "wednesday" ? "/miercuri" : "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => new URL(client.url).pathname === path);
    if (existing) return existing.focus();
    return self.clients.openWindow(path);
  }));
});

/* Airtec Family Portal PWA service worker.
 *
 * Deliberately conservative for a multi-tenant, authenticated ERP:
 *   - /api/* is NEVER touched — always straight to network (tenant- and
 *     auth-scoped data must not be cached or served stale).
 *   - Immutable hashed build assets (/_next/static/*) are cache-first.
 *   - Navigations are network-first with an offline fallback page.
 *   - Same-origin static files (icons, manifest) are stale-while-revalidate.
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
const CACHE_VERSION = "airtec-portal-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Let the page trigger an immediate activation after an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle same-origin traffic; let the browser do everything else.
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls — auth/tenant-scoped, must hit the network live.
  if (url.pathname.startsWith("/api/")) return;

  // Immutable, content-hashed build output: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Page navigations: network-first, fall back to cached page then offline.html.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Other same-origin GETs (icons, fonts, manifest): stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || (await caches.match(OFFLINE_URL));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

// ── Push (design.md §6.3) ────────────────────────────────────────────
// Additive: the fetch/caching strategy above is untouched.

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: "New notification", body: event.data.text() }; }
  const { title, body, link, tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title || "AIRTEC", {
      body: body || "",
      // Collapses repeats of the same alert instead of stacking one per
      // delivery attempt.
      tag: tag || "airtec",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus a tab that is already open rather than opening a duplicate.
        const existing = clients.find((c) => c.url.startsWith(self.location.origin));
        if (existing) return existing.focus().then((c) => (c.navigate ? c.navigate(link) : c));
        return self.clients.openWindow(link);
      }),
  );
});

const CACHE = "lolyfans-v8";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/favicon-16.png",
  "/icons/favicon-32.png",
  "/icons/favicon-48.png",
  "/icons/logo-180.png",
  "/icons/logo-192.png",
  "/icons/logo-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — Lolyfans</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0c0a11;color:#f5f3f9;font-family:system-ui,sans-serif;text-align:center}
p{color:#8f8a9d}b{background:linear-gradient(135deg,#4fc9ff,#00aff0);
-webkit-background-clip:text;background-clip:text;color:transparent;font-size:24px}</style>
</head><body><div><b>Lolyfans</b><p>You're offline. Check your connection and try again.</p></div></body></html>`;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Pages: always hit the network so auth redirects are never cached or replayed
  // (cached/redirected navigations break installed PWAs and can cause redirect
  // loops). Only fall back to an offline page when the network is unavailable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(OFFLINE_HTML, {
            status: 503,
            headers: { "Content-Type": "text/html" },
          })
      )
    );
    return;
  }

  // Static assets: cache-first (hashed Next.js files and app icons are immutable).
  if (url.pathname.startsWith("/_next/static/") || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && !response.redirected) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
  // Everything else falls through to the network untouched.
});

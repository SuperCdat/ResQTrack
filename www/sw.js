// ResQTrack service worker — offline app shell + map tile cache.

const VERSION = "v1";
const SHELL_CACHE = `resqtrack-shell-${VERSION}`;
const TILE_CACHE  = `resqtrack-tiles-${VERSION}`;
const CDN_CACHE   = `resqtrack-cdn-${VERSION}`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./scriptui.js",
  "./i18n.js",
  "./firebase-data.js",
  "./transportationdata.json",
  "./output-onlinepngtools.png"
];

// Never cache — realtime, auth-sensitive, or user-specific.
const BYPASS_KEYWORDS = [
  "firebase",       // firebasedatabase.app, firebaseapp.com, …
  "firestore",
  "identitytoolkit",
  "securetoken",
  "mymemory",
  "osrm"
];

const TILE_HOSTS = ["openfreemap.org", "arcgisonline.com", "cartocdn.com"];

// Third-party libs, fonts, Firebase SDK (served from gstatic).
const CDN_HOSTS  = ["unpkg.com", "gstatic.com", "fonts.googleapis.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // cache.add per URL so one miss doesn't abort the whole install
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((e) => console.warn("[sw] cache miss", url, e))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("resqtrack-") && !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function hostMatches(hostname, list) {
  return list.some((h) => hostname.includes(h));
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.status === 200 || res.type === "opaque")) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    return hit || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const index = await cache.match("./index.html");
      if (index) return index;
    }
    return Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && (res.status === 200 || res.type === "opaque")) {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => hit);
  return hit || network;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Live data / auth / routing / translation: always network
  if (hostMatches(url.hostname, BYPASS_KEYWORDS)) return;

  // Map tiles: cache-first, so panning the same area works offline
  if (hostMatches(url.hostname, TILE_HOSTS)) {
    event.respondWith(cacheFirst(req, TILE_CACHE));
    return;
  }

  // CDN libraries + fonts: fast + resilient, background refresh
  if (hostMatches(url.hostname, CDN_HOSTS)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // Same-origin: app shell, data files, icon
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
  }
});
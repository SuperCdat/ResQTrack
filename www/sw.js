const VERSION = "v1";
const SHELL_CACHE   = `resqtrack-shell-${VERSION}`;
const CDN_CACHE     = `resqtrack-cdn-${VERSION}`;
const TILES_STREET  = `resqtrack-tiles-street-${VERSION}`;
const TILES_SAT     = `resqtrack-tiles-sat-${VERSION}`;
const TILE_CACHES   = [TILES_STREET, TILES_SAT];

// Satellite cache limits — these tiles are big (30–100 KB each), so cap them.
const SAT_MAX_ENTRIES = 2500;          // ~150–250 MB depending on tile weight
const SAT_TRIM_TO     = 1800;          // evict down to this when over cap

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

// Never cache — realtime, auth, or user-specific.
const BYPASS_KEYWORDS = [
  "firebase", "firestore", "identitytoolkit", "securetoken", "mymemory", "osrm"
];

// Street tiles get their own cache so satellite can't crowd them out.
const STREET_HOSTS = ["tile.openstreetmap.org", "openfreemap.org"];

// Satellite imagery + its dark label overlay (CARTO) — capped and evictable.
const SAT_HOSTS = ["arcgisonline.com", "basemaps.cartocdn.com"];

const CDN_HOSTS = ["unpkg.com", "gstatic.com", "fonts.googleapis.com"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(
      SHELL_ASSETS.map((url) =>
        cache.add(url).catch((e) => console.warn("[sw] cache miss", url, e))
      )
    );
    // Ask the browser not to evict us under storage pressure.
    if (self.navigator && self.navigator.storage && self.navigator.storage.persist) {
      self.navigator.storage.persist().catch(() => {});
    }
  })());
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

async function trimSatCache() {
  const cache = await caches.open(TILES_SAT);
  const keys = await cache.keys();
  if (keys.length <= SAT_MAX_ENTRIES) return;
  const drop = keys.length - SAT_TRIM_TO;
  for (let i = 0; i < drop; i++) {
    await cache.delete(keys[i]);
  }
  console.log(`[sw] trimmed ${drop} satellite tiles (${keys.length} → ${SAT_TRIM_TO})`);
}

async function cacheFirst(req, cacheName, isSat) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.status === 200 || res.type === "opaque")) {
      if (isSat) await trimSatCache();
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
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
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

  if (hostMatches(url.hostname, BYPASS_KEYWORDS)) return;

  if (hostMatches(url.hostname, STREET_HOSTS)) {
    event.respondWith(cacheFirst(req, TILES_STREET, false));
    return;
  }
  if (hostMatches(url.hostname, SAT_HOSTS)) {
    event.respondWith(cacheFirst(req, TILES_SAT, true));
    return;
  }
  if (hostMatches(url.hostname, CDN_HOSTS)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
  }
});

/* ---- Prefetch handler: page asks us to save a batch of satellite tiles ---- */

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "CACHE_TILES") return;
  cacheTilesBatch(msg.urls || []);
});

async function cacheTilesBatch(urls) {
  if (!urls.length) return;
  const cache = await caches.open(TILES_SAT);
  let done = 0;

  for (const url of urls) {
    try {
      const hit = await cache.match(url);
      if (!hit) {
        const res = await fetch(url, { mode: "no-cors" });
        if (res) await cache.put(url, res);
      }
    } catch (e) {
      // ignore single-tile failures — user just doesn't get that tile offline
    }
    done++;
    if (done % 25 === 0 || done === urls.length) {
      broadcastProgress(done, urls.length, done === urls.length);
    }
  }

  await trimSatCache();
}

async function broadcastProgress(done, total, complete) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage({ type: "TILE_PROGRESS", done, total, complete }));
}
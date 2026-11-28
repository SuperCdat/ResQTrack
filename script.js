let locatingmanually = false;
let findingLocation = false;
let globalTransportData = {};
let currentMarkers = [];
let ambulanceIcon;

let selectedAmbulance = null;
let lastRouteMetrics = null;

let locationRequestId = 0;

function ZoomIn() {
  map.zoomIn();
}

function ZoomOut() {
  map.zoomOut();
}

function LocateManually() {

  locatingmanually = !locatingmanually;

  locationRequestId++;
  findingLocation = false;
  setLocatingUI(false);

  if (locatingmanually) {
    map.doubleClickZoom.disable();
    console.log("Manual location mode: ON");
  } else {
    map.doubleClickZoom.enable();
    console.log("Manual location mode: OFF");
  }
}

function ToggleDrawer() {
  const menu = document.getElementById("mainmenu");
  if (!menu) return;

  // Phones: bottom sheet expands. Desktop: side panel slides off to the left.
  menu.classList.toggle(window.innerWidth > 768 ? "collapsed" : "expanded");
}

function ToggleDriverDrawer(event) {
  // The sign-out button lives in the header; let it do its own thing.
  if (event && event.target.closest && event.target.closest("button")) return;

  // Collapsing the driver panel is a mobile-only affordance.
  if (window.innerWidth > 768) return;

  const menu = document.getElementById("drivermenu");
  if (!menu) return;

  menu.classList.toggle("collapsed");
}

let mapOptions = {
  center: [10.38399, 105.43734],
  zoom: 10,
  zoomControl: false,
};

let map = new L.map("map", mapOptions);

// OpenStreetMap standard raster tiles.
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

const osmLightLayer = L.tileLayer(OSM_TILES, {
  attribution: OSM_ATTRIBUTION,
  maxZoom: 19,
  className: "osm-tiles osm-light"
});

const osmDarkLayer = L.tileLayer(OSM_TILES, {
  attribution: OSM_ATTRIBUTION,
  maxZoom: 19,
  className: "osm-tiles osm-dark"
});

let cartoLayer = null;

// Kept name for ToggleTheme / initTheme call sites.
function applyVectorTheme(isDark) {
  if (activeBase === "satellite") return;

  if (cartoLayer && map.hasLayer(cartoLayer)) {
    map.removeLayer(cartoLayer);
  }
  cartoLayer = isDark ? osmDarkLayer : osmLightLayer;
  cartoLayer.addTo(map);
}

// CARTO key — only used by the satellite labels overlay now.
const CARTO_KEY = "cb1_5fwb_1_daad9535186f86343eb1a022";
const LABEL_TILES = `https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`;

// Esri World Imagery — high-resolution aerial/satellite base
const ESRI_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/" +
  "World_Imagery/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, " +
  "and the GIS User Community";

const esriImageryLayer = L.tileLayer(ESRI_IMAGERY_TILES, {
  attribution: ESRI_ATTRIBUTION,
  maxZoom: 19,
  maxNativeZoom: 18
});

map.createPane("labelsPane");
map.getPane("labelsPane").style.zIndex = 350;
map.getPane("labelsPane").style.pointerEvents = "none";

const satelliteLabelsLayer = L.tileLayer(LABEL_TILES, {
  attribution: "© OpenStreetMap contributors © CARTO",
  subdomains: "abcd",
  maxZoom: 19,
  pane: "labelsPane"
});

let activeBase = "osm";
cartoLayer = osmLightLayer;
cartoLayer.addTo(map);

function ToggleSatellite() {
  const btn = document.getElementById("satellitetoggle");

  if (activeBase === "osm") {
    if (cartoLayer && map.hasLayer(cartoLayer)) map.removeLayer(cartoLayer);

    esriImageryLayer.addTo(map);
    satelliteLabelsLayer.addTo(map);

    activeBase = "satellite";
    document.body.classList.add("satellite-active");

    if (btn) {
      btn.textContent = "🗺️";
      btn.title = t("tt_map");
    }
  } else {
    map.removeLayer(esriImageryLayer);
    map.removeLayer(satelliteLabelsLayer);

    cartoLayer = document.body.classList.contains("dark-mode")
      ? osmDarkLayer
      : osmLightLayer;
    cartoLayer.addTo(map);

    activeBase = "osm";
    document.body.classList.remove("satellite-active");

    if (btn) {
      btn.textContent = "🛰️";
      btn.title = t("tt_satellite");
    }
  }

  updateSatSaveButton();
}

/* ---- Satellite offline: tile enumeration + prefetch ---- */

function lngToTileX(lng, z) {
  return Math.floor((lng + 180) / 360 * Math.pow(2, z));
}

function latToTileY(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z)
  );
}

// Esri tile URL — note {z}/{y}/{x} order (y before x).
function esriTileUrl(z, x, y) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}

function enumerateSatTiles(bounds, z, cap) {
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();
  const x0 = lngToTileX(nw.lng, z);
  const x1 = lngToTileX(se.lng, z);
  const y0 = latToTileY(nw.lat, z);
  const y1 = latToTileY(se.lat, z);
  const urls = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      urls.push(esriTileUrl(z, x, y));
      if (urls.length >= cap) return urls;
    }
  }
  return urls;
}

let saveSatBusy = false;
const SAT_ZOOM_LEVELS = 3;     // current + 2 deeper
const SAT_TOTAL_CAP = 800;     // hard ceiling per save

function setSaveSatStatus(text) {
  const btn = document.getElementById("savesatbtn");
  if (btn) btn.title = text || t("save_offline_view");
}

async function SaveSatelliteArea() {
  if (saveSatBusy) return;

  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) {
    setSaveSatStatus(t("offline_unavailable"));
    return;
  }
  if (!navigator.onLine) {
    setSaveSatStatus(t("online_required"));
    return;
  }
  if (activeBase !== "satellite") {
    setSaveSatStatus(t("save_requires_satellite"));
    return;
  }

  saveSatBusy = true;
  const btn = document.getElementById("savesatbtn");
  if (btn) btn.disabled = true;

  const bounds = map.getBounds();
  const z0 = Math.round(map.getZoom());
  const maxZ = 18; // Esri native limit
  const urls = [];

  for (let dz = 0; dz < SAT_ZOOM_LEVELS; dz++) {
    const z = Math.min(z0 + dz, maxZ);
    const remaining = SAT_TOTAL_CAP - urls.length;
    if (remaining <= 0) break;
    urls.push(...enumerateSatTiles(bounds, z, remaining));
  }

  if (!urls.length) {
    saveSatBusy = false;
    if (btn) btn.disabled = false;
    return;
  }

  setSaveSatStatus(t("saving_tiles", { n: urls.length }));
  navigator.serviceWorker.controller.postMessage({ type: "CACHE_TILES", urls });
}

// Progress messages from the service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "TILE_PROGRESS") return;

    if (msg.complete) {
      saveSatBusy = false;
      const btn = document.getElementById("savesatbtn");
      if (btn) btn.disabled = false;
      setSaveSatStatus(t("saved_tiles", { n: msg.total }));
    } else {
      setSaveSatStatus(t("saving_progress", { done: msg.done, total: msg.total }));
    }
  });
}

ambulanceIcon = L.icon({
  iconUrl: './output-onlinepngtools.png',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  tooltipAnchor: [0, 20]
});

const potholeIcon = L.divIcon({
  className: "pothole-marker",
  html: '<div class="pothole-dot">🕳️</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13]
});

let currentProvince = null;

const LAST_LOC_KEY = "resqtrack-last-loc";
let savedUserLoc = null;
try {
  const raw = JSON.parse(localStorage.getItem(LAST_LOC_KEY));
  if (raw && typeof raw.lat === "number" && typeof raw.lng === "number") savedUserLoc = raw;
} catch (e) {}

/* ---- Pothole state ---- */
let potholesByProvince = {};
let potholeMarkers = {};
let lastPotholeReportAt = 0;

const POTHOLE_NOTIFY_RADIUS_M = 200;
const POTHOLE_VERIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;   // server verifiedAt gate
const POTHOLE_DISMISS_COOLDOWN_MS = 2 * 60 * 60 * 1000;   // client dismiss gate
const POTHOLE_REPORT_THROTTLE_MS = 15000;
const POTHOLE_CD_KEY = "resqtrack-pothole-cd";

function applyCatalog(dataraw) {
  const bar = document.getElementById("loadbar");
  if (bar) bar.hidden = true;

  globalTransportData = dataraw || {};

  let province = dataraw && dataraw[currentProvince]
    ? currentProvince
    : (dataraw && "An Giang" in dataraw ? "An Giang" : Object.keys(dataraw || {})[0]);

  if (savedUserLoc && savedUserLoc.province && dataraw && dataraw[savedUserLoc.province]) {
    province = savedUserLoc.province;
  }

  // Restore the last known user position before loading the province, so the
  // list computes ETAs from it on first render.
  if (savedUserLoc) {
    setUserLocation(
      L.latLng(savedUserLoc.lat, savedUserLoc.lng),
      savedUserLoc.accuracy || null,
      { restore: true }
    );
    if (savedUserLoc.zoom) {
      map.setView([savedUserLoc.lat, savedUserLoc.lng], savedUserLoc.zoom);
    }
  }

  if (province) {
    loadProvinceData(province);
  }
}

// Fallback when Firebase is unavailable
function loadLocalData() {
  fetch("./transportationdata.json")
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      return response.json();
    })
    .then(applyCatalog)
    .catch(error => console.error("Error loading transportation data:", error));
}

function loadProvinceData(provinceName) {
  if (!globalTransportData[provinceName]) return;

  currentProvince = provinceName;
  let data = globalTransportData[provinceName];

  if (typeof addAmblist === 'function') {
    addAmblist(data);
  }

  currentMarkers.forEach(marker => map.removeLayer(marker));
  currentMarkers = [];

  for (let i = 0; i < data.length; i++) {
    if (!Array.isArray(data[i].pos) || data[i].pos.length < 2) continue;

    let marker = new L.Marker(data[i].pos, {
      title: localizeName(data[i].name),
      icon: ambulanceIcon
      
    });

    const potholeIcon = L.divIcon({
      className: "pothole-marker",
      html: '<div class="pothole-dot">🕳️</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    

    marker.provinceName = provinceName;
    marker.ambName = data[i].name;
    marker.ambId = data[i].id;

    // Live cars carry the driver's Firebase uid as id; only that driver's device matches.
    const isOwnCar = !!data[i].id && data[i].id === getDriverId();

    marker.bindTooltip(`${localizeProvince(provinceName)} - ${localizeName(data[i].name)}`, {
      direction: "bottom",
      permanent: true,
      className: isOwnCar ? "own-amb-tooltip" : ""
    });

    marker.addTo(map);
    currentMarkers.push(marker);
  }

  console.log(`Loaded province: ${provinceName}`);

  if (window.onProvinceLoaded) window.onProvinceLoaded(provinceName);

  saveLastLocation();

  if (driverUser && typeof window.watchPotholesForProvince === "function") {
    window.watchPotholesForProvince(provinceName);
  }
}

function detectClosestProvince(userLatLng) {
  let closestProvince = null;
  let minDistance = Infinity;

  for (let province in globalTransportData) {
    let ambList = globalTransportData[province];
    if (!ambList || ambList.length === 0) continue;

    let avgLat = ambList.reduce(
      (sum, item) => sum + item.pos[0], 0
    ) / ambList.length;

    let avgLng = ambList.reduce(
      (sum, item) => sum + item.pos[1], 0
    ) / ambList.length;

    let provinceCenter = L.latLng(avgLat, avgLng);
    let distance = userLatLng.distanceTo(provinceCenter);

    if (distance < minDistance) {
      minDistance = distance;
      closestProvince = province;
    }
  }

  return closestProvince;
}

let loc = null;
let locaccuracy = null;
let locfound = 0;
let locfoundaccuracy = 0;

function clearLocationLayers() {
  if (loc && map.hasLayer(loc)) {
    map.removeLayer(loc);
  }

  if (locaccuracy && map.hasLayer(locaccuracy)) {
    map.removeLayer(locaccuracy);
  }

  loc = null;
  locaccuracy = null;
}

function saveLastLocation() {
  if (!locfound) return;
  try {
    localStorage.setItem(LAST_LOC_KEY, JSON.stringify({
      lat: locfound.lat,
      lng: locfound.lng,
      accuracy: locfoundaccuracy || 0,
      province: currentProvince || null,
      zoom: (typeof map !== "undefined" && map) ? map.getZoom() : 14
    }));
  } catch (e) {}
}

function setUserLocation(latlng, accuracy = null, opts = {}) {
  const restore = !!(opts && opts.restore);
  clearLocationLayers();

  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  selectedAmbulance = null;
  lastRouteMetrics = null;
  if (typeof CloseInfoBox === "function") CloseInfoBox();

  locfound = L.latLng(latlng);
  locfoundaccuracy = accuracy || 0;

  loc = L.circleMarker(locfound, {
    color: '#ffffff', weight: 3, opacity: 1,
    fillColor: '#2563eb', fillOpacity: 1
  });

  if (accuracy && accuracy > 0) {
    loc.bindPopup(t("popup_gps", { m: Math.round(accuracy) }));
    locaccuracy = L.circle(locfound, {
      radius: accuracy,
      color: '#2563eb', weight: 2, opacity: 1,
      fillColor: '#2563eb', fillOpacity: 0.12
    });
    map.addLayer(locaccuracy);
  } else if (!restore) {
    loc.bindPopup(t("popup_manual"));
  }

  if (!restore) loc.openPopup();
  map.addLayer(loc);

  saveLastLocation();
}

// Disables the locate button and shows the top progress bar while a fix is pending
function setLocatingUI(isLocating) {
  const btn = document.getElementById("locatebutton");

  if (btn) {
    btn.disabled = isLocating;

    const label = btn.querySelector(".btn-label");
    if (label) {
      label.dataset.i18n = isLocating ? "locating" : "locate_auto";
      label.textContent = t(label.dataset.i18n);
    }
  }

  const bar = document.getElementById("loadbar");
  if (bar) bar.hidden = !isLocating;
}

map.on("dblclick", (e) => {
  if (!locatingmanually) return;

  locationRequestId++;
  findingLocation = false;
  setLocatingUI(false);

  setUserLocation(e.latlng);

  let matchedProvince = detectClosestProvince(e.latlng);

  if (matchedProvince) {
    loadProvinceData(matchedProvince);
  }

  locatingmanually = false;
  map.doubleClickZoom.enable();

  console.log("Manual location selected:", e.latlng);
});

function FindLocation() {
  if (findingLocation) {
    return;
  }

  findingLocation = true;
  setLocatingUI(true);

  let requestId = ++locationRequestId;

  map.once("locationfound", (e) => {
    if (requestId !== locationRequestId) return;

    findingLocation = false;
    setLocatingUI(false);

    setUserLocation(e.latlng, e.accuracy);

    map.flyTo(e.latlng, 14);

    let detectedProvince = detectClosestProvince(e.latlng);

    if (detectedProvince) {
      loadProvinceData(detectedProvince);

      console.log("User located in province:", detectedProvince);
    }
  });

  map.once("locationerror", (e) => {
    if (requestId !== locationRequestId) return;

    findingLocation = false;
    setLocatingUI(false);

    alert(t("alert_gps_error"));

    console.error("Geolocation error:", e.message);
  });

  try {
    map.locate({
      setView: false,
      enableHighAccuracy: true,
      maxZoom: 30
    });
  } catch (error) {
    findingLocation = false;
    setLocatingUI(false);
    console.error("Unable to start geolocation:", error);
  }
}

const THEME_KEY = "resqtrack-theme";

function ToggleTheme() {
  const isDark = document.body.classList.toggle("dark-mode");
  const btn = document.getElementById("themetoggle");

  if (btn) btn.innerHTML = isDark ? "☀️" : "🌙";

  applyVectorTheme(isDark);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", isDark ? "#202124" : "#ffffff");

  try {
    localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  } catch (e) {}
}

(function initTheme() {
  try {
    if (localStorage.getItem(THEME_KEY) === "dark") {
      document.body.classList.add("dark-mode");
      applyVectorTheme(true);
      const btn = document.getElementById("themetoggle");
      if (btn) btn.innerHTML = "☀️";
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", "#202124");
    }
  } catch (e) {}
})();

let routingControl = null;
let activeCardElement = null;

const ROAD_PROFILES = {
  city: { avgSpeed: 30, trafficFactor: 1.4 },
  countryside: { avgSpeed: 22, terrainPenalty: 1.6 },
  standard: { avgSpeed: 40, trafficFactor: 1.1 }
};

function calculateSmartETA(distanceMeters, baseTimeSeconds, endLatLng) {
  let distanceKm = distanceMeters / 1000;
  let isRural = distanceKm > 5;

  let profile = isRural
    ? ROAD_PROFILES.countryside
    : ROAD_PROFILES.city;

  let estimatedMinutes = baseTimeSeconds / 60;

  if (isRural) {
    estimatedMinutes *= profile.terrainPenalty;
  } else {
    estimatedMinutes *= profile.trafficFactor;
  }

  return {
    distanceKm: distanceKm.toFixed(1),
    timeMins: Math.max(1, Math.round(estimatedMinutes)),
    rawMins: estimatedMinutes
  };
}

let routeMetricsCache = {};
let etaRequestId = 0;

function etaCacheKey(start, pos) {
  return start.lat.toFixed(5) + "," + start.lng.toFixed(5) + "|" + pos[0] + "," + pos[1];
}

function fetchRouteMetrics(start, end) {
  return new Promise((resolve) => {
    if (!window.L || !L.Routing || !L.Routing.osrmv1) {
      resolve(null);
      return;
    }

    try {
      L.Routing.osrmv1().route(
        [L.Routing.waypoint(start), L.Routing.waypoint(end)],
        (err, routes) => {
          if (err || !routes || routes.length === 0) {
            resolve(null);
            return;
          }
          let s = routes[0].summary;
          resolve(calculateSmartETA(s.totalDistance, s.totalTime));
        }
      );
    } catch (e) {
      resolve(null);
    }
  });
}

function fallbackMetrics(start, end) {
  let d = start.distanceTo(end);
  let m = calculateSmartETA(d, (d / 1000) / 40 * 3600);
  m.approx = true;
  return m;
}

function calculateAllAmbulancesETA(ambulanceData, preserveSelection = false) {
  if (!locfound) return;

  let start = L.latLng(locfound.lat, locfound.lng);
  let requestId = ++etaRequestId;

  let items = ambulanceData.map((amb, index) => {
    let cached = routeMetricsCache[etaCacheKey(start, amb.pos)];
    return Object.assign({ index: index, amb: amb, pending: !cached }, cached || {});
  });

  let sortItems = (list) => list.sort((a, b) => a.rawMins - b.rawMins);

  if (items.every(it => !it.pending)) {
    updateAmbulanceListUIWithETA(sortItems(items), preserveSelection);
    return;
  }

  updateAmbulanceListUIWithETA(items, preserveSelection);

  Promise.all(items.map(async (it) => {
    if (!it.pending) return;

    let end = L.latLng(it.amb.pos[0], it.amb.pos[1]);
    let metrics = await fetchRouteMetrics(start, end);

    if (metrics) {
      routeMetricsCache[etaCacheKey(start, it.amb.pos)] = metrics;
    } else {
      metrics = fallbackMetrics(start, end);
    }

    Object.assign(it, metrics, { pending: false });
  })).then(() => {
    if (requestId !== etaRequestId) return;
    updateAmbulanceListUIWithETA(sortItems(items), true);
  });
}

function RouteToAmbulance(ambulancePos, ambulanceName, cardElement) {
  if (!locfound) {
    alert(t("alert_need_start"));
    return;
  }

  if (!L.Routing) {
    alert(t("alert_routing_lib"));
    return;
  }

  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }

  let startLatLng = L.latLng(locfound.lat, locfound.lng);
  let endLatLng = L.latLng(ambulancePos[0], ambulancePos[1]);

  activeCardElement = cardElement;

  routingControl = L.Routing.control({
    waypoints: [startLatLng, endLatLng],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    showAlternatives: false,
    createMarker: function() {
      return null;
    },
    missingRouteStyles: [
      { color: '#3b82f6', opacity: 1, weight: 8, lineCap: 'round', lineJoin: 'round' }
    ],
    lineOptions: {
      missingRouteTolerance: 0,
      styles: [
        {
          color: '#3b82f6',
          opacity: 1,
          weight: 8,
          lineCap: 'round',
          lineJoin: 'round'
        }
      ]
    }
  });

  routingControl.on('routesfound', function(e) {
    if (!e.routes || e.routes.length === 0) return;

    let summary = e.routes[0].summary;

    let smartMetrics = calculateSmartETA(
      summary.totalDistance,
      summary.totalTime,
      endLatLng
    );

    lastRouteMetrics = smartMetrics;
    routeMetricsCache[etaCacheKey(startLatLng, ambulancePos)] = smartMetrics;

    if (activeCardElement) {
      let subSpan = activeCardElement.querySelector('.card-sub');

      if (subSpan) {
        subSpan.textContent = t("card_eta", {
          min: smartMetrics.timeMins,
          km: smartMetrics.distanceKm
        });
      }
    }

    if (typeof renderInfoBox === 'function') {
      renderInfoBox();
    }
  });

  routingControl.addTo(map);
}

function refreshMapTexts() {
  currentMarkers.forEach(marker => {
    if (!marker.ambName) return;

    marker.setTooltipContent(
      `${localizeProvince(marker.provinceName)} - ${localizeName(marker.ambName)}`
    );

    let el = marker.getElement();
    if (el) el.title = localizeName(marker.ambName);
  });

  if (loc) {
    loc.setPopupContent(
      locfoundaccuracy > 0
        ? t("popup_gps", { m: Math.round(locfoundaccuracy) })
        : t("popup_manual")
    );
  }
}


/* ================= Live ambulance positions (from firebase-data.js) ================= */

let liveRefreshTimer = null;

function applyLivePosition(province, id, lat, lng) {
  if (province !== currentProvince) return;

  const amb = (globalTransportData[province] || []).find(a => a.id === id);
  if (!amb) return;

  amb.pos[0] = lat;
  amb.pos[1] = lng;

  const marker = currentMarkers.find(m => m.ambId === id);
  if (marker) marker.setLatLng(amb.pos);

  if (!liveRefreshTimer) liveRefreshTimer = setTimeout(refreshAfterLive, 10000);
}

function refreshAfterLive() {
  liveRefreshTimer = null;

  if (locfound && typeof currentAmbulanceData !== "undefined" && currentAmbulanceData.length) {
    calculateAllAmbulancesETA(currentAmbulanceData, true);
  }

  if (routingControl && selectedAmbulance) {
    routingControl.options.fitSelectedRoutes = false;
    routingControl.spliceWaypoints(1, 1, L.latLng(selectedAmbulance.pos));
  }
}

/* ================= Pothole reports (driver) ================= */

window.onPotholesUpdate = function (province, list) {
  if (province === null) {
    potholesByProvince = {};
    renderPotholes();
    return;
  }
  for (const k in potholesByProvince) {
    if (k !== province) delete potholesByProvince[k];
  }
  potholesByProvince[province] = list;
  renderPotholes();
};

function renderPotholes() {
  if (typeof map === "undefined" || !map) return;

  const list = potholesByProvince[currentProvince] || [];
  const keep = new Set(list.map((p) => p.id));

  for (const id in potholeMarkers) {
    if (!keep.has(id)) {
      map.removeLayer(potholeMarkers[id]);
      delete potholeMarkers[id];
    }
  }

  list.forEach((p) => {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
    if (potholeMarkers[p.id]) return;
    const m = L.marker([p.lat, p.lng], { icon: potholeIcon, interactive: false });
    m.addTo(map);
    potholeMarkers[p.id] = m;
  });
}

function setPotholeMsg(text, color = "var(--subtext)") {
  const el = document.querySelector(".pothole-status");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = color;
}

function potholeProvinceForReport() {
  const el = document.getElementById("driverProvince");
  return (el && el.value) || currentProvince;
}

async function reportPotholeAt(province, lat, lng) {
  if (!window.potholeApi || !driverUser) return;
  try {
    await window.potholeApi.report(province, lat, lng);
    setPotholeMsg(t("pothole_reported"), "var(--success)");
  } catch (e) {
    console.error("Pothole report failed:", e);
    setPotholeMsg(t("pothole_report_failed"), "var(--danger)");
  }
}

function PotholeReportHere() {
  if (!driverUser) return;
  if (Date.now() - lastPotholeReportAt < POTHOLE_REPORT_THROTTLE_MS) return;
  const province = potholeProvinceForReport();
  if (!province) return;
  if (!Array.isArray(simulatedPos) || simulatedPos.length < 2) return;
  lastPotholeReportAt = Date.now();
  reportPotholeAt(province, simulatedPos[0], simulatedPos[1]);
}

function getPotholeCooldowns() {
  try { return JSON.parse(localStorage.getItem(POTHOLE_CD_KEY)) || {}; } catch (e) { return {}; }
}

function getPotholeCooldown(id) {
  return getPotholeCooldowns()[id] || 0;
}

function setPotholeCooldown(id) {
  const c = getPotholeCooldowns();
  c[id] = Date.now();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const k in c) if (c[k] < cutoff) delete c[k];
  try { localStorage.setItem(POTHOLE_CD_KEY, JSON.stringify(c)); } catch (e) {}
}

function checkNearbyPotholes() {
  if (!driverUser || !currentProvince) return;
  if (!Array.isArray(simulatedPos) || simulatedPos.length < 2) return;

  const list = potholesByProvince[currentProvince] || [];
  if (!list.length) return;

  const me = L.latLng(simulatedPos[0], simulatedPos[1]);
  const now = Date.now();

  for (const p of list) {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    if (p.reportedBy === driverUser.uid) continue;
    if (p.verifiedAt && now - p.verifiedAt < POTHOLE_VERIFY_COOLDOWN_MS) continue;
    const cd = getPotholeCooldown(p.id);
    if (cd && now - cd < POTHOLE_DISMISS_COOLDOWN_MS) continue;

    const dist = me.distanceTo(L.latLng(p.lat, p.lng));
    if (dist <= POTHOLE_NOTIFY_RADIUS_M) {
      if (typeof showPotholeVerifyToast === "function") {
        showPotholeVerifyToast(currentProvince, p, Math.round(dist));
      }
      return; // one toast at a time
    }
  }
}

/* ================= Driver state, GPS & account ================= */

let currentRole = "user";
let driverGpsWatchId = null;
let simulatedPos = [10.38399, 105.43734];

let driverUser = null;              // Firebase Auth user while a driver is signed in
let driverPublishedProvince = null; // province whose live/ node currently holds this driver

const PROVINCE_CENTERS = {
  "Cần Thơ": [10.034185, 105.72255],
  "Hồ Chí Minh": [10.776889, 106.700806],
  "An Giang": [10.386, 105.435],
  "Vĩnh Long": [10.2537, 105.9722],
  "Đồng Tháp": [10.4938, 105.6882],
  "Hà Nội": [21.0285, 105.8542],
  "Đà Nẵng": [16.0678, 108.2208]
};

function getDriverId() {
  return driverUser ? driverUser.uid : null;
}

function setDriverProvince(province) {
  if (!province) return;

  const el = document.getElementById("driverProvince");
  if (!el) return;

  const hasOption = Array.from(el.options).some((o) => o.value === province);
  if (hasOption) el.value = province;
}

function setDriverMsg(text, color = "var(--subtext)") {
  const msgEl = document.getElementById("driverStatusMsg");
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.style.color = color;
}

function stopDriverGpsWatch() {
  if (driverGpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(driverGpsWatchId);
    driverGpsWatchId = null;
  }
}

function startDriverGpsWatch() {
  if (!navigator.geolocation) {
    setDriverMsg("Thiết bị không hỗ trợ GPS, đang giữ vị trí hiện tại.");
    return;
  }

  stopDriverGpsWatch();
  setDriverMsg("Đang theo dõi vị trí thực tế của bạn...", "var(--success)");

  let firstFix = true;

  driverGpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const accuracy = pos.coords.accuracy || 0;
      if (!firstFix && accuracy > 1000) return;

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const distMeters = L.latLng(lat, lng).distanceTo(L.latLng(simulatedPos[0], simulatedPos[1]));
      const moved = !firstFix && distMeters > 5;

      simulatedPos = [lat, lng];

      if (firstFix && typeof map !== "undefined" && map) {
        // Zoom to the driver once per sign-in so they can see their own car.
        map.flyTo(simulatedPos, Math.max(map.getZoom(), 15));
      }

      if (firstFix || moved) {
        firstFix = false;
        UpdateDriverStatus(false);
        setDriverMsg(
          moved ? "Đang di chuyển theo GPS thực tế..." : "Đang đứng yên tại vị trí thực tế.",
          "var(--success)"
        );
      }
    },
    (err) => {
      console.warn("Driver GPS watch error:", err.message);
      setDriverMsg("Không lấy được GPS (kiểm tra quyền định vị trình duyệt).");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000
    }
  );
}

/* ---- Driver account (Firebase Auth lives in firebase-data.js) ---- */

let authMode = "signin";

function setAuthError(text) {
  const el = document.getElementById("authError");
  if (el) el.textContent = text || "";
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";

  document.getElementById("authSignupFields").hidden = !signup;
  document.getElementById("authName").required = signup;
  document.getElementById("authPhone").required = signup;
  document.getElementById("authPassword").autocomplete = signup ? "new-password" : "current-password";
  document.getElementById("authTitle").dataset.i18n = signup ? "auth_title_signup" : "auth_title_signin";
  document.getElementById("authSubmit").dataset.i18n = signup ? "auth_submit_signup" : "auth_submit_signin";
  document.getElementById("authSwitch").dataset.i18n = signup ? "auth_switch_to_signin" : "auth_switch_to_signup";

  setAuthError("");
  applyStaticTranslations();
}

function ToggleAuthMode() {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
}

function OpenAuth() {
  setAuthMode("signin");
  document.getElementById("authBackdrop").hidden = false;
  document.getElementById("authEmail").focus();
}

function CloseAuth() {
  document.getElementById("authBackdrop").hidden = true;
  document.getElementById("authForm").reset();
  setAuthError("");
}

function authErrorText(err) {
  switch (err && err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return t("err_invalid_credential");
    case "auth/email-already-in-use":
      return t("err_email_in_use");
    case "auth/weak-password":
      return t("err_weak_password");
    case "auth/invalid-email":
      return t("err_invalid_email");
    case "auth/network-request-failed":
      return t("err_network");
    default:
      return t("err_generic");
  }
}

function nearestProvinceCenter(latlng) {
  let nearest = null;
  let minDistance = Infinity;

  for (const name in PROVINCE_CENTERS) {
    const center = PROVINCE_CENTERS[name];
    const distance = latlng.distanceTo(L.latLng(center[0], center[1]));
    if (distance < minDistance) {
      minDistance = distance;
      nearest = name;
    }
  }

  return nearest;
}

// Asks for GPS during sign-up so the new driver starts in the right province.
function locateProvinceForSignup() {
  return new Promise((resolve) => {
    if (!navigator.geolocation || typeof L === "undefined") {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latlng = L.latLng(pos.coords.latitude, pos.coords.longitude);
        let province = null;

        try {
          province = detectClosestProvince(latlng);
        } catch (e) {}

        resolve(province || nearestProvinceCenter(latlng));
      },
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
    );
  });
}

async function SubmitAuth(event) {
  event.preventDefault();

  if (!window.driverAuth) {
    setAuthError(t("auth_unavailable"));
    return;
  }

  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const submit = document.getElementById("authSubmit");

  submit.disabled = true;
  setAuthError("");

  try {
    if (authMode === "signup") {
      const hint = document.getElementById("authHint");
      if (hint) hint.textContent = t("auth_locating");

      const province = await locateProvinceForSignup();

      if (hint) hint.textContent = t("auth_loc_hint");
      if (document.getElementById("authBackdrop").hidden) return;

      await window.driverAuth.signUp(email, password, {
        name: document.getElementById("authName").value.trim(),
        phone: document.getElementById("authPhone").value.trim(),
        province: province
      });

      if (province) {
        setDriverProvince(province);
        UpdateDriverStatus(false);
      }
    } else {
      await window.driverAuth.signIn(email, password);
    }
    CloseAuth();
  } catch (err) {
    console.error("Driver auth error:", err);
    setAuthError(authErrorText(err));
  } finally {
    submit.disabled = false;
  }
}

async function DriverSignOut() {
  // Stop the GPS watch, then take the car off the map before the token goes away.
  stopDriverGpsWatch();

  if (driverUser && driverPublishedProvince && window.removeDriverLive) {
    await window.removeDriverLive(driverPublishedProvince, driverUser.uid);
  }
  driverPublishedProvince = null;

  if (window.driverAuth) await window.driverAuth.signOut();
}

// Called by firebase-data.js whenever the sign-in state changes (including on page load)
window.onDriverAuthChanged = async function (user) {
  if (!user) {
    driverUser = null;
    driverPublishedProvince = null;
    stopDriverGpsWatch();
    document.body.classList.remove("driver-mode");
    if (window.watchPotholesForProvince) window.watchPotholesForProvince(null);
    return;
  }

  driverUser = user;

  let profile = {};
  try {
    profile = (await window.driverAuth.loadProfile(user.uid)) || {};
  } catch (e) {
    console.warn("Could not load driver profile:", e);
  }

  document.getElementById("driverAccount").textContent = user.email;
  document.getElementById("driverName").value = profile.name || user.email;
  document.getElementById("driverPhone").value = profile.phone || "";
  setDriverProvince(profile.province);
  fillCare(profile.care);

  CloseInfoBox();
  document.body.classList.add("driver-mode");
  startDriverGpsWatch();
  UpdateDriverStatus(false);
  if (window.watchPotholesForProvince && currentProvince) {
    window.watchPotholesForProvince(currentProvince);
  }
};

function syncDriverCarToState(province, car) {
  if (typeof globalTransportData === "undefined" || !globalTransportData) return;
  if (!globalTransportData[province]) {
    globalTransportData[province] = [];
  }
  const list = globalTransportData[province];
  const idx = list.findIndex((item) => item.id === car.id);

  if (car.status === "available") {
    if (idx >= 0) list[idx] = car;
    else list.push(car);
  } else if (idx >= 0) {
    list.splice(idx, 1);
  }

  if (typeof loadProvinceData === "function") {
    loadProvinceData(province);
  }
}

function UpdateDriverStatus(shouldPan = false) {
  if (!driverUser) return;

  const statusEl = document.getElementById("driverStatus");
  const nameEl = document.getElementById("driverName");
  const phoneEl = document.getElementById("driverPhone");
  const provinceEl = document.getElementById("driverProvince");

  const status = statusEl ? statusEl.value : "available";
  const name = (nameEl && nameEl.value) || driverUser.email;
  const phonenumber = phoneEl ? phoneEl.value : "";
  const province = provinceEl ? provinceEl.value : (currentProvince || "Cần Thơ");

  if (shouldPan && PROVINCE_CENTERS[province]) {
    simulatedPos = [...PROVINCE_CENTERS[province]];
    if (typeof map !== "undefined" && map && typeof map.panTo === "function") {
      map.panTo(simulatedPos);
    }
  }

  const car = {
    id: getDriverId(),
    name,
    phonenumber,
    status,
    care: collectCare(),
    pos: [...simulatedPos]
  };

  // Moved to another province, or went offline: take the old live node down
  if (driverPublishedProvince && (driverPublishedProvince !== province || status === "offline")) {
    if (typeof window.removeDriverLive === "function") {
      window.removeDriverLive(driverPublishedProvince, car.id);
    }
    driverPublishedProvince = null;
  }

  syncDriverCarToState(province, car);

  if (status !== "offline" && typeof window.pushDriverLivePos === "function") {
    driverPublishedProvince = province;
    window.pushDriverLivePos(province, car.id, car.pos[0], car.pos[1], {
      name: car.name,
      phonenumber: car.phonenumber,
      status: car.status,
      care: car.care
    });
    
  }

  if (driverGpsWatchId !== null) return;
  if (status === "busy") {
    setDriverMsg(`Xe (${province}) đang bận - đã ẩn khỏi danh sách sẵn sàng.`, "var(--accent)");
  } else if (status === "available") {
    setDriverMsg(`Xe (${province}) đang sẵn sàng trên bản đồ.`, "var(--success)");
  } else {
    setDriverMsg(`Xe (${province}) đang tạm ngưng hoạt động.`, "var(--subtext)");
  }
  checkNearbyPotholes();
}

function PublishDriverNow() {
  const provinceEl = document.getElementById("driverProvince");
  const province = provinceEl ? provinceEl.value : (currentProvince || "An Giang");

  if (!Array.isArray(simulatedPos) || simulatedPos.length < 2) {
    simulatedPos = [...(PROVINCE_CENTERS[province] || [10.38399, 105.43734])];
  }

  const finishPublish = () => {
    UpdateDriverStatus(false);
    if (typeof map !== "undefined" && map && typeof map.panTo === "function") {
      map.panTo(simulatedPos);
    }
    setDriverMsg(
      `Đã cập nhật (${province}): [${simulatedPos[0].toFixed(5)}, ${simulatedPos[1].toFixed(5)}]`,
      "var(--success)"
    );
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        simulatedPos = [pos.coords.latitude, pos.coords.longitude];
        finishPublish();
      },
      () => {
        finishPublish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
  } else {
    finishPublish();
  }
}

/* ---- Driver care info: oxygen, equipment, medication ---- */

const CARE_EQUIPMENT = ["aed", "ecg", "suction", "ventilator", "splint"];
const CARE_MAX_MEDS = 20;

function buildCareEquipment() {
  const box = document.getElementById("careEquipment");
  if (!box) return;

  CARE_EQUIPMENT.forEach((key) => {
    const label = document.createElement("label");
    label.className = "check-row";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.equip = key;

    const text = document.createElement("span");
    text.dataset.i18n = "equip_" + key;

    label.append(input, text);
    box.appendChild(label);
  });

  applyStaticTranslations();
}

function AddMedRow(med) {
  const list = document.getElementById("careMeds");
  if (!list || list.children.length >= CARE_MAX_MEDS) return;

  const row = document.createElement("div");
  row.className = "med-row";

  const name = document.createElement("input");
  name.type = "text";
  name.className = "med-name";
  name.maxLength = 60;
  name.dataset.i18nPlaceholder = "care_med_name";
  name.value = (med && med.name) || "";

  const cond = document.createElement("input");
  cond.type = "text";
  cond.className = "med-for";
  cond.maxLength = 100;
  cond.dataset.i18nPlaceholder = "care_med_for";
  cond.value = (med && med.for) || "";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-btn";
  remove.dataset.i18n = "care_remove";
  remove.addEventListener("click", () => {
    row.remove();
    onCareChanged();
  });

  row.append(name, cond, remove);
  list.appendChild(row);
  applyStaticTranslations();
}

// Returns null when the driver has declared nothing (so nothing is stored or published)
function collectCare() {
  const oxygenEl = document.getElementById("careOxygen");
  if (!oxygenEl) return null;

  const oxygen = oxygenEl.checked;
  const equipment = CARE_EQUIPMENT.filter((key) => {
    const el = document.querySelector('#careEquipment input[data-equip="' + key + '"]');
    return el && el.checked;
  });
  const meds = Array.from(document.querySelectorAll("#careMeds .med-row"))
    .map((row) => ({
      name: row.querySelector(".med-name").value.trim(),
      for: row.querySelector(".med-for").value.trim()
    }))
    .filter((m) => m.name);
  const notes = document.getElementById("careNotes").value.trim();

  if (!oxygen && !equipment.length && !meds.length && !notes) return null;
  return { oxygen, equipment, meds, notes };
}

function fillCare(care) {
  care = care || {};
  const equipment = care.equipment || [];

  document.getElementById("careOxygen").checked = !!care.oxygen;
  document.querySelectorAll("#careEquipment input").forEach((el) => {
    el.checked = equipment.includes(el.dataset.equip);
  });
  document.getElementById("careMeds").replaceChildren();
  (care.meds || []).forEach((m) => AddMedRow(m));
  document.getElementById("careNotes").value = care.notes || "";
}

function saveDriverProfile() {
  if (!driverUser || !window.driverAuth) return;

  window.driverAuth.saveProfile(driverUser.uid, {
    name: document.getElementById("driverName").value.trim(),
    phone: document.getElementById("driverPhone").value.trim(),
    province: document.getElementById("driverProvince").value,
    care: collectCare()
  }).catch((e) => console.warn("Could not save driver profile:", e));
}

function onCareChanged() {
  if (!driverUser) return;
  saveDriverProfile();
  UpdateDriverStatus(false);
}

(function initCareForm() {
  buildCareEquipment();
  const box = document.getElementById("driverCare");
  if (box) box.addEventListener("change", onCareChanged);
})();

(function bindDriverFormListeners() {
  const ids = ["driverName", "driverPhone", "driverProvince", "driverStatus"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if ((id === "driverName" || id === "driverPhone" || id === "driverProvince") && driverUser && window.driverAuth) {
        saveDriverProfile();
      }
      UpdateDriverStatus(id === "driverProvince");
    });
  });
})();

function updateSatSaveButton() {
  const btn = document.getElementById("savesatbtn");
  if (!btn) return;
  btn.style.display = (activeBase === "satellite" && navigator.onLine) ? "flex" : "none";
}

window.addEventListener("online", () => {
  updateSatSaveButton();
  document.body.classList.remove("satellite-offline");
});
window.addEventListener("offline", () => {
  updateSatSaveButton();
  if (activeBase === "satellite") {
    document.body.classList.add("satellite-offline");
  }
});
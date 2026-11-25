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

  if (locatingmanually) {
    map.doubleClickZoom.disable();
    console.log("Manual location mode: ON");
  } else {
    map.doubleClickZoom.enable();
    console.log("Manual location mode: OFF");
  }
}

function ToggleDrawer() {
  if (window.innerWidth > 768) return;

  const menu = document.getElementById("mainmenu");
  if (menu) menu.classList.toggle("expanded");
}

function ToggleEquipmentPanel() {
  const panel = document.getElementById("equipmentPanel");
  const chevron = document.getElementById("eqChevron");
  const btn = document.querySelector(".equipment-toggle-btn");
  if (!panel) return;

  const isHidden = panel.classList.toggle("hidden");
  if (chevron) chevron.textContent = isHidden ? "▾" : "▴";
  if (btn) btn.setAttribute("aria-expanded", String(!isHidden));
}

function StepBeds(delta) {
  const input = document.getElementById("driverBeds");
  if (!input) return;

  const current = parseInt(input.value || "1", 10) || 1;
  const next = Math.min(6, Math.max(1, current + delta));
  input.value = String(next);
  input.dispatchEvent(new Event("change"));
}

function getDriverEquipment() {
  const bedsInput = document.getElementById("driverBeds");
  const rawBeds = parseInt(bedsInput ? bedsInput.value : "1", 10);
  const beds = Number.isFinite(rawBeds) ? Math.min(6, Math.max(1, rawBeds)) : 1;

  return {
    doctor: Boolean(document.getElementById("driverDoctor")?.checked),
    paramedic: Boolean(document.getElementById("driverParamedic")?.checked),
    ventilator: Boolean(document.getElementById("driverVentilator")?.checked),
    aed: Boolean(document.getElementById("driverAed")?.checked),
    trauma: Boolean(document.getElementById("driverTrauma")?.checked),
    infusion: Boolean(document.getElementById("driverInfusion")?.checked),
    beds
  };
}

let mapOptions = {
  center: [10.38399, 105.43734],
  zoom: 10,
  zoomControl: false,
};

let map = new L.map("map", mapOptions);

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

// Esri World Imagery — high-resolution aerial/satellite base
const ESRI_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/" +
  "World_Imagery/MapServer/tile/{z}/{y}/{x}";

// Esri reference overlays (no API key needed): road names + places/boundaries
const ESRI_ROADS_TILES =
  "https://services.arcgisonline.com/arcgis/rest/services/" +
  "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

const ESRI_PLACES_TILES =
  "https://services.arcgisonline.com/arcgis/rest/services/" +
  "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION =
  "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, " +
  "and the GIS User Community";

const osmLayer = L.tileLayer(OSM_TILES, {
  attribution: "© OpenStreetMap contributors",
  maxZoom: 19
});

// Base imagery layer
const esriImageryLayer = L.tileLayer(ESRI_IMAGERY_TILES, {
  attribution: ESRI_ATTRIBUTION,
  maxZoom: 19,
  maxNativeZoom: 18
});

// Dedicated pane: above imagery, below routes/markers, never blocks clicks
map.createPane("labelsPane");
map.getPane("labelsPane").style.zIndex = 350;
map.getPane("labelsPane").style.pointerEvents = "none";

// Esri draws roads/borders with semi-transparent pixels. This SVG filter boosts the
// alpha channel so those lines render solid, without widening them much.
(function () {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML =
    '<filter id="opaque-labels" color-interpolation-filters="sRGB">' +
    '<feComponentTransfer>' +
    '<feFuncA type="linear" slope="2.4" intercept="0"/>' +
    '</feComponentTransfer></filter>';
  document.body.appendChild(svg);
  map.getPane("labelsPane").style.filter = "url(#opaque-labels)";
})();

// Esri bakes semi-transparent lines (roads, province/country borders) into its tiles.
// An SVG alpha filter pushes every partly-transparent pixel to fully opaque.
(function makeLinesOpaque() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML =
    '<filter id="opaque-lines" color-interpolation-filters="sRGB">' +
    '<feComponentTransfer><feFuncA type="linear" slope="6" intercept="0"/></feComponentTransfer>' +
    "</filter>";
  document.body.appendChild(svg);
  map.getPane("labelsPane").style.filter = "url(#opaque-lines)";
})();

const esriLabelsLayer = L.layerGroup([
  L.tileLayer(ESRI_ROADS_TILES, {
    attribution: "",
    maxZoom: 19,
    maxNativeZoom: 18,
    pane: "labelsPane"
  }),
  L.tileLayer(ESRI_PLACES_TILES, {
    attribution: "",
    maxZoom: 19,
    maxNativeZoom: 18,
    pane: "labelsPane"
  })
]);

let activeBase = "osm";
map.addLayer(osmLayer);

function ToggleSatellite() {
  const btn = document.getElementById("satellitetoggle");

  if (activeBase === "osm") {
    map.removeLayer(osmLayer);

    esriImageryLayer.addTo(map);
    esriLabelsLayer.addTo(map);

    activeBase = "satellite";
    document.body.classList.add("satellite-active");

    if (btn) {
      btn.textContent = "🗺️";
      btn.title = t("tt_map");
    }
  } else {
    map.removeLayer(esriImageryLayer);
    map.removeLayer(esriLabelsLayer);

    osmLayer.addTo(map);

    activeBase = "osm";
    document.body.classList.remove("satellite-active");

    if (btn) {
      btn.textContent = "🛰️";
      btn.title = t("tt_satellite");
    }
  }
}

ambulanceIcon = L.icon({
  iconUrl: './output-onlinepngtools.png',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  tooltipAnchor: [0, 20]
});

let currentProvince = null;

// Called by firebase-data.js with the full catalog ({ province: [ambulances] })
function applyCatalog(dataraw) {
  globalTransportData = dataraw || {};

  let province = dataraw && dataraw[currentProvince]
    ? currentProvince
    : (dataraw && "Cần Thơ" in dataraw ? "Cần Thơ" : Object.keys(dataraw || {})[0]);

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

    marker.provinceName = provinceName;
    marker.ambName = data[i].name;
    marker.ambId = data[i].id;

    marker.bindTooltip(`${localizeProvince(provinceName)} - ${localizeName(data[i].name)}`, {
      direction: "bottom",
      permanent: true
    });

    marker.addTo(map);
    currentMarkers.push(marker);
  }

  console.log(`Loaded province: ${provinceName}`);

  if (window.onProvinceLoaded) window.onProvinceLoaded(provinceName);
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

function setUserLocation(latlng, accuracy = null) {
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
  } else {
    loc.bindPopup(t("popup_manual"));
  }

  loc.openPopup();
  map.addLayer(loc);
}

map.on("dblclick", (e) => {
  if (!locatingmanually) return;

  locationRequestId++;
  findingLocation = false;

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

  let requestId = ++locationRequestId;

  map.once("locationfound", (e) => {
    if (requestId !== locationRequestId) return;

    findingLocation = false;

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
    console.error("Unable to start geolocation:", error);
  }
}

const THEME_KEY = "resqtrack-theme";

function ToggleTheme() {
  const isDark = document.body.classList.toggle("dark-mode");
  const btn = document.getElementById("themetoggle");

  if (btn) btn.innerHTML = isDark ? "☀️" : "🌙";

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

        subSpan.style.color = 'var(--success)';
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


/* ================= Role Switcher, GPS & Simulation ================= */

let currentRole = "user";
let driverSimInterval = null;
let driverRouteCoords = [];
let driverRouteIndex = 0;
let driverGpsWatchId = null;
let simStartPos = null;
let simulatedPos = [10.034185, 105.72255];

let driverSimMarker = null;
let realPosBeforeSim = null;

let driverUser = null;
let driverPublishedProvince = null;

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

function setDriverMsg(text, color = "var(--subtext)") {
  const msgEl = document.getElementById("driverStatusMsg");
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.style.color = color;
}

function clearDriverSimMarker() {
  if (driverSimMarker && typeof map !== "undefined" && map && map.hasLayer(driverSimMarker)) {
    map.removeLayer(driverSimMarker);
  }
  driverSimMarker = null;
}

function stopDriverSim(msgText = null) {
  if (driverSimInterval) {
    clearInterval(driverSimInterval);
    driverSimInterval = null;
  }
  driverRouteCoords = [];
  driverRouteIndex = 0;
  if (msgText) setDriverMsg(msgText);
}

function stopDriverGpsWatch() {
  if (driverGpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(driverGpsWatchId);
    driverGpsWatchId = null;
  }
}

function resetDriverToRealLocation() {
  clearDriverSimMarker();

  const restoredPos = realPosBeforeSim ? [...realPosBeforeSim] : [...simulatedPos];
  realPosBeforeSim = null;
  simStartPos = null;
  simulatedPos = restoredPos;

  if (!navigator.geolocation) {
    if (typeof map !== "undefined" && map && typeof map.panTo === "function") {
      map.panTo(simulatedPos);
    }
    UpdateDriverStatus(false);
    startDriverGpsWatch();
    setDriverMsg("Đã tắt mô phỏng — đang ở đúng vị trí thật của bạn.", "var(--success)");
    return;
  }

  setDriverMsg("Đã tắt mô phỏng, đang lấy lại vị trí GPS thật...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      simulatedPos = [pos.coords.latitude, pos.coords.longitude];
      if (typeof map !== "undefined" && map && typeof map.panTo === "function") {
        map.panTo(simulatedPos);
      }
      UpdateDriverStatus(false);
      startDriverGpsWatch();
      setDriverMsg("Đã tắt mô phỏng — bạn đang ở đúng vị trí GPS thật.", "var(--success)");
    },
    () => {
      if (typeof map !== "undefined" && map && typeof map.panTo === "function") {
        map.panTo(simulatedPos);
      }
      UpdateDriverStatus(false);
      startDriverGpsWatch();
      setDriverMsg("Đã tắt mô phỏng — đã quay về vị trí thật của bạn.");
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 }
  );
}

function startDriverGpsWatch() {
  if (!navigator.geolocation) {
    setDriverMsg("Thiết bị không hỗ trợ GPS, đang giữ vị trí hiện tại.");
    return;
  }

  stopDriverSim();
  stopDriverGpsWatch();
  setDriverMsg("Đang theo dõi vị trí thực tế của bạn...", "var(--success)");

  let firstFix = true;

  driverGpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (driverSimInterval) return;

      const accuracy = pos.coords.accuracy || 0;
      if (!firstFix && accuracy > 1000) return;

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const distMeters = L.latLng(lat, lng).distanceTo(L.latLng(simulatedPos[0], simulatedPos[1]));
      const moved = !firstFix && distMeters > 5;

      simulatedPos = [lat, lng];

      if (firstFix && typeof map !== "undefined" && map && typeof map.panTo === "function") {
        map.panTo(simulatedPos);
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
      await window.driverAuth.signUp(email, password, {
        name: document.getElementById("authName").value.trim(),
        phone: document.getElementById("authPhone").value.trim()
      });
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
  stopDriverGpsWatch();
  stopDriverSim();

  if (driverUser && driverPublishedProvince && window.removeDriverLive) {
    await window.removeDriverLive(driverPublishedProvince, driverUser.uid);
  }
  driverPublishedProvince = null;

  if (window.driverAuth) await window.driverAuth.signOut();
}

window.onDriverAuthChanged = async function (user) {
  if (!user) {
    driverUser = null;
    driverPublishedProvince = null;
    clearDriverSimMarker();
    stopDriverSim();
    stopDriverGpsWatch();
    document.body.classList.remove("driver-mode");
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

  CloseInfoBox();
  document.body.classList.add("driver-mode");
  startDriverGpsWatch();
  UpdateDriverStatus(false);
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
  const equipment = getDriverEquipment();

  if (shouldPan && !driverSimInterval && PROVINCE_CENTERS[province]) {
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
    pos: [...simulatedPos],
    equipment
  };

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
      equipment: car.equipment
    });
  }

  if (driverSimInterval || driverGpsWatchId !== null) return;
  if (status === "busy") {
    setDriverMsg(`Xe (${province}) đang bận - đã ẩn khỏi danh sách sẵn sàng.`, "var(--accent)");
  } else if (status === "available") {
    setDriverMsg(`Xe (${province}) đang sẵn sàng trên bản đồ.`, "var(--success)");
  } else {
    setDriverMsg(`Xe (${province}) đang tạm ngưng hoạt động.`, "var(--subtext)");
  }
}

function PublishDriverNow() {
  if (driverSimInterval) {
    setDriverMsg(
      "Đang mô phỏng riêng trên máy — người dùng vẫn thấy vị trí thật.",
      "var(--success)"
    );
    return;
  }

  const provinceEl = document.getElementById("driverProvince");
  const province = provinceEl ? provinceEl.value : (currentProvince || "Cần Thơ");

  if (!Array.isArray(simulatedPos) || simulatedPos.length < 2) {
    simulatedPos = [...(PROVINCE_CENTERS[province] || [10.034185, 105.72255])];
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

(function bindDriverFormListeners() {
  const ids = [
    "driverName",
    "driverPhone",
    "driverProvince",
    "driverStatus",
    "driverDoctor",
    "driverParamedic",
    "driverVentilator",
    "driverAed",
    "driverTrauma",
    "driverInfusion",
    "driverBeds"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if ((id === "driverName" || id === "driverPhone") && driverUser && window.driverAuth) {
        window.driverAuth.saveProfile(driverUser.uid, {
          name: document.getElementById("driverName").value.trim(),
          phone: document.getElementById("driverPhone").value.trim()
        }).catch((e) => console.warn("Could not save driver profile:", e));
      }
      if (driverSimInterval) return;
      UpdateDriverStatus(id === "driverProvince");
    });
  });
})();

function buildRoadRoute(startLatLng, endLatLng, onReady) {
  if (!window.L || !L.Routing || !L.Routing.osrmv1) {
    onReady(null);
    return;
  }
  L.Routing.osrmv1().route(
    [L.Routing.waypoint(startLatLng), L.Routing.waypoint(endLatLng)],
    (err, routes) => {
      if (err || !routes || !routes[0] || !routes[0].coordinates || routes[0].coordinates.length < 2) {
        onReady(null);
        return;
      }
      onReady(routes[0].coordinates.map(pt => [pt.lat, pt.lng]));
    }
  );
}

function SimulateDrive() {
  const provinceEl = document.getElementById("driverProvince");
  const province = provinceEl ? provinceEl.value : (currentProvince || "Cần Thơ");

  if (driverSimInterval) {
    stopDriverSim();
    resetDriverToRealLocation();
    return;
  }

  stopDriverGpsWatch();
  clearDriverSimMarker();
  realPosBeforeSim = [...simulatedPos];
  simStartPos = [...simulatedPos];
  let simCurrentPos = [...simulatedPos];

  setDriverMsg("Đang tìm tuyến đường mô phỏng riêng cho tài xế...");

  const start = L.latLng(simCurrentPos[0], simCurrentPos[1]);
  const center = PROVINCE_CENTERS[province] || simCurrentPos;
  const dest = L.latLng(center[0] + 0.012, center[1] + 0.014);

  buildRoadRoute(start, dest, (coords) => {
    if (!coords) {
      realPosBeforeSim = null;
      simStartPos = null;
      startDriverGpsWatch();
      setDriverMsg("Không lấy được tuyến đường OSRM, thử lại sau.");
      return;
    }

    driverRouteCoords = coords;
    driverRouteIndex = 0;

    if (typeof map !== "undefined" && map) {
      driverSimMarker = L.circleMarker(simCurrentPos, {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 1
      }).addTo(map);
      driverSimMarker.bindTooltip("Xe mô phỏng (chỉ tài xế thấy)", {
        direction: "top"
      });
      if (typeof map.panTo === "function") {
        map.panTo(simCurrentPos);
      }
    }

    setDriverMsg("Đang mô phỏng riêng trên máy tài xế — người dùng vẫn thấy vị trí thật.", "var(--success)");

    driverSimInterval = setInterval(() => {
      if (driverRouteIndex >= driverRouteCoords.length) {
        stopDriverSim();
        resetDriverToRealLocation();
        return;
      }

      simCurrentPos = [...driverRouteCoords[driverRouteIndex]];
      if (driverSimMarker) {
        driverSimMarker.setLatLng(simCurrentPos);
      }
      driverRouteIndex += 2;
    }, 1500);
  });
}
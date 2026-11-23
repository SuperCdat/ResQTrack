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
    // Switch to hybrid satellite
    map.removeLayer(osmLayer);

    esriImageryLayer.addTo(map);
    esriLabelsLayer.addTo(map); // labels on top of imagery

    activeBase = "satellite";
    document.body.classList.add("satellite-active");

    if (btn) {
      btn.textContent = "🗺️";
      btn.title = t("tt_map");
    }
  } else {
    // Switch back to street map
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

fetch("./transportationdata.json")
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return response.json();
  })
  .then(dataraw => {
    globalTransportData = dataraw;

    let defaultProvince = "Cần Thơ" in dataraw
      ? "Cần Thơ"
      : Object.keys(dataraw)[0];

    if (defaultProvince) {
      loadProvinceData(defaultProvince);
    }
  })
  .catch(error => console.error("Error loading transportation data:", error));

function loadProvinceData(provinceName) {
  if (!globalTransportData[provinceName]) return;

  let data = globalTransportData[provinceName];

  if (typeof addAmblist === 'function') {
    addAmblist(data);
  }

  currentMarkers.forEach(marker => map.removeLayer(marker));
  currentMarkers = [];

  for (let i = 0; i < data.length; i++) {
    let marker = new L.Marker(data[i].pos, {
      title: localizeName(data[i].name),
      icon: ambulanceIcon
    });

    marker.provinceName = provinceName;
    marker.ambName = data[i].name;

    marker.bindTooltip(`${localizeProvince(provinceName)} - ${localizeName(data[i].name)}`, {
      direction: "bottom",
      permanent: true
    });

    marker.addTo(map);
    currentMarkers.push(marker);
  }

  console.log(`Loaded province: ${provinceName}`);
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
  if (meta) meta.setAttribute("content", isDark ? "#0f172a" : "#f8fafc");

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
      if (meta) meta.setAttribute("content", "#0f172a");
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
  if (typeof refreshHospitalTexts === "function") refreshHospitalTexts();
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


/* ================= Hospitals (OpenStreetMap / Overpass) ================= */

map.createPane("hospitalPane");
map.getPane("hospitalPane").style.zIndex = 590; // below ambulances (600)

const hospitalLayer = L.layerGroup().addTo(map);
const hospitalMarkers = new Map();
const HOSP_MIN_ZOOM = 11;
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];
let hospFetchedBounds = null;
let hospTimer = null;

// Estimated size ("bed equivalents"): real `beds` tag if present, otherwise footprint x floors
function hospitalScore(el) {
  const tags = el.tags || {};
  const beds = parseInt(tags.beds, 10);
  if (beds > 0) return beds;

  let score = 40;
  if (el.bounds) {
    const b = el.bounds;
    const lat = (b.minlat + b.maxlat) / 2;
    const h = (b.maxlat - b.minlat) * 111320;
    const w = (b.maxlon - b.minlon) * 111320 * Math.cos(lat * Math.PI / 180);
    const levels = parseFloat(tags["building:levels"]) || 2;
    score = (h * w * levels) / 90;
  }

  const name = ((tags.name || "") + " " + (tags["name:en"] || "")).toLowerCase();
  if (/đa khoa|general|trung ương|central|university|đại học|national|quốc gia/.test(name)) score *= 1.6;
  if (/phòng khám|clinic|trạm y tế|medical center|chuyên khoa/.test(name)) score *= 0.5;

  return Math.max(5, score);
}

// 0 (small) .. 1 (very large) on a log scale
function hospitalT(score) {
  return Math.min(1, Math.max(0, Math.log(score / 10) / Math.log(800 / 10)));
}

const HOSP_STOPS = [
  [0.0, [252, 205, 205]], // pale pink
  [0.5, [239, 68, 68]],   // red
  [1.0, [127, 15, 15]]    // deep red
];

function hospitalColor(k0) {
  for (let i = 1; i < HOSP_STOPS.length; i++) {
    if (k0 <= HOSP_STOPS[i][0]) {
      const [t1, c1] = HOSP_STOPS[i - 1];
      const [t2, c2] = HOSP_STOPS[i];
      const k = (k0 - t1) / (t2 - t1);
      return "rgb(" + c1.map((v, j) => Math.round(v + (c2[j] - v) * k)).join(",") + ")";
    }
  }
  return "rgb(127,15,15)";
}

function hospitalIcon(k) {
  const size = Math.round(22 + k * 16);
  const color = hospitalColor(k);
  const html =
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
    'style="filter: drop-shadow(0 1px 3px rgba(0,0,0,.6));">' +
    '<circle cx="12" cy="12" r="10.5" fill="' + color + '" stroke="#fff" stroke-width="2"/>' +
    '<path d="M10 6h4v4h4v4h-4v4h-4v-4H6v-4h4z" fill="#fff"/></svg>';

  return L.divIcon({
    className: "hospital-icon",
    html: html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function hospitalDisplayName(tags) {
  return (currentLang === "en" && tags["name:en"]) || tags.name || t("hosp_default_name");
}

function hospitalPopup(m) {
  const tg = m.hosp.tags;
  const lvl = m.hosp.k < 0.3 ? "size_1" : m.hosp.k < 0.55 ? "size_2" : m.hosp.k < 0.8 ? "size_3" : "size_4";
  let html = "<b>" + hospitalDisplayName(tg).replace(/</g, "&lt;") + "</b><br>" +
    t("hosp_size", { label: t(lvl) });
  const beds = parseInt(tg.beds, 10);
  if (beds > 0) html += "<br>" + t("hosp_beds", { n: beds });
  return html;
}

function addHospital(el) {
  const key = el.type + el.id;
  if (hospitalMarkers.has(key)) return;

  const pos = el.type === "node"
    ? [el.lat, el.lon]
    : el.center ? [el.center.lat, el.center.lon] : null;
  if (!pos) return;

  const k = hospitalT(hospitalScore(el));
  const tags = el.tags || {};

  const m = L.marker(pos, {
    icon: hospitalIcon(k),
    pane: "hospitalPane",
    zIndexOffset: Math.round(k * 1000) // bigger hospitals draw on top
  });
  m.hosp = { tags: tags, k: k };

  m.bindPopup(() => hospitalPopup(m));
  m.bindTooltip(() => hospitalDisplayName(tags), {
    permanent: true,
    direction: "right",
    offset: [12, 0],
    className: "hosp-label"
  });

  m.addTo(hospitalLayer);
  hospitalMarkers.set(key, m);
}

async function loadHospitals() {
  if (map.getZoom() < HOSP_MIN_ZOOM) return;

  const view = map.getBounds();
  if (hospFetchedBounds && hospFetchedBounds.contains(view)) return;

  const area = view.pad(0.3);
  const query =
    '[out:json][timeout:25];nwr["amenity"="hospital"](' +
    [area.getSouth(), area.getWest(), area.getNorth(), area.getEast()].join(",") +
    ");out center tags bb;";

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });
      if (!res.ok) continue;

      const json = await res.json();
      (json.elements || []).forEach(addHospital);
      hospFetchedBounds = area;
      return;
    } catch (e) {
      console.warn("Overpass failed:", url, e);
    }
  }
}

function scheduleHospitalLoad() {
  clearTimeout(hospTimer);
  hospTimer = setTimeout(loadHospitals, 500);
}

function updateZoomClass() {
  map.getContainer().classList.toggle("zoom-labels", map.getZoom() >= 15);
}

map.on("moveend", () => { updateZoomClass(); scheduleHospitalLoad(); });
updateZoomClass();
scheduleHospitalLoad();

// Legend (translated through data-i18n)
(function createHospitalLegend() {
  const el = document.createElement("div");
  el.id = "hosp-legend";
  el.innerHTML =
    '<div class="legend-title" data-i18n="legend_title"></div>' +
    '<div class="legend-bar"></div>' +
    '<div class="legend-row"><span data-i18n="legend_small"></span><span data-i18n="legend_large"></span></div>';
  document.body.appendChild(el);
  if (typeof applyStaticTranslations === "function") applyStaticTranslations();
})();

function refreshHospitalTexts() {
  hospitalMarkers.forEach(m => {
    m.getTooltip().update();
    if (m.isPopupOpen()) m.setPopupContent(hospitalPopup(m));
  });
}
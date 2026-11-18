
let locatingmanually = false;
let findingLocation = false;
let globalTransportData = {};
let currentMarkers = [];
let ambulanceIcon;

// Selected ambulance state (used to re-render text when language changes)
let selectedAmbulance = null;
let lastRouteMetrics = null;

// Dùng để nhận biết yêu cầu GPS mới nhất
let locationRequestId = 0;

function ZoomIn() {
  map.zoomIn();
}

function ZoomOut() {
  map.zoomOut();
}

function LocateManually() {
  locatingmanually = !locatingmanually;

  // Hủy hiệu lực kết quả GPS đang chờ
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

let mapOptions = {
  center: [10.38399, 105.43734],
  zoom: 10,
  zoomControl: false,
};

let map = new L.map("map", mapOptions);

let layer = new L.TileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});
map.addLayer(layer);

// Custom ambulance icon
ambulanceIcon = L.icon({
  iconUrl: './output-onlinepngtools.png',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  tooltipAnchor: [0, 20]
});

// Fetch data and initialize default view
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

// Function to render ambulances and markers for a specific province
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

// User location
let loc = null;
let locaccuracy = null;
let locfound = 0;
let locfoundaccuracy = 0;

// Remove old location markers and accuracy circle
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

// Update user's selected location
function setUserLocation(latlng, accuracy = null) {
  clearLocationLayers();

  // Starting point changed: old route and ETA are no longer valid
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  selectedAmbulance = null;
  lastRouteMetrics = null;
  if (typeof CloseInfoBox === "function") CloseInfoBox();

  locfound = L.latLng(latlng);
  locfoundaccuracy = accuracy || 0;

  loc = L.circleMarker(locfound);

  if (accuracy && accuracy > 0) {
    loc.bindPopup(t("popup_gps", { m: Math.round(accuracy) }));

    locaccuracy = L.circle(locfound, {
      radius: accuracy
    });

    map.addLayer(locaccuracy);
  } else {
    loc.bindPopup(t("popup_manual"));
  }

  loc.openPopup();
  map.addLayer(loc);
}

// Manual location selection
map.on("dblclick", (e) => {
  if (!locatingmanually) return;

  // Không cho kết quả GPS cũ ghi đè vị trí thủ công
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

  // Mỗi yêu cầu GPS có một ID riêng
  let requestId = ++locationRequestId;

  map.once("locationfound", (e) => {
    // Bỏ qua kết quả của yêu cầu GPS cũ
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
    // Bỏ qua lỗi của yêu cầu GPS cũ
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

function ToggleTheme() {
  document.body.classList.toggle('light-mode');

  const btn = document.getElementById('themetoggle');

  if (btn) {
    if (document.body.classList.contains('light-mode')) {
      btn.innerHTML = '🌙';
    } else {
      btn.innerHTML = '☀️';
    }
  }
}

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

// ---- Unified ETA: list and selected route use the SAME road-based calculation ----
let routeMetricsCache = {};
let etaRequestId = 0;

function etaCacheKey(start, pos) {
  return start.lat.toFixed(5) + "," + start.lng.toFixed(5) + "|" + pos[0] + "," + pos[1];
}

// Road route from OSRM (same service the route line uses) -> smart metrics
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

// Only used if the routing service is unreachable (marked approximate)
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

  // Show "calculating" placeholders first
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
    if (requestId !== etaRequestId) return; // newer request exists
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
    lineOptions: {
      styles: [{
        color: '#3b82f6',
        opacity: 0.9,
        weight: 6
      }]
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

        subSpan.style.color = '#22c55e';
      }
    }

    if (typeof renderInfoBox === 'function') {
      renderInfoBox();
    }
  });

  routingControl.addTo(map);
}

// Re-translate text that lives on the map (called when language changes)
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

let locatingmanually = false;
let findingLocation = false;
let globalTransportData = {};
let currentMarkers = [];
let ambulanceIcon;

function ZoomIn() {
  map.zoomIn();
}
function ZoomOut() {
  map.zoomOut();
}

function LocateManually() {
  locatingmanually = !locatingmanually;
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

// Fetch data and initialize default view (e.g., Cần Thơ or first available)
fetch("./transportationdata.json")
  .then(response => response.json())
  .then(dataraw => {
    globalTransportData = dataraw;
    
    // Default to Cần Thơ initially (or fallback to first key in JSON)
    let defaultProvince = "Cần Thơ" in dataraw ? "Cần Thơ" : Object.keys(dataraw)[0];
    loadProvinceData(defaultProvince);
  })
  .catch(error => console.error("Error loading transportation data:", error));

// Function to render ambulances and markers for a specific province
function loadProvinceData(provinceName) {
  if (!globalTransportData[provinceName]) return;

  let data = globalTransportData[provinceName];
  
  // Update sidebar list UI
  if (typeof addAmblist === 'function') {
    addAmblist(data);
  }

  // Clear existing markers from map
  currentMarkers.forEach(marker => map.removeLayer(marker));
  currentMarkers = [];

  // Add new markers for this province
  for (let i = 0; i < data.length; i++) {
    let marker = new L.Marker(data[i].pos, {
      title: data[i].name,
      icon: ambulanceIcon
    });
    marker.bindTooltip(`${provinceName} - ${data[i].name}`, { direction: "bottom", permanent: true });
    marker.addTo(map);
    currentMarkers.push(marker);
  }

  console.log(`Loaded province: ${provinceName}`);
}

// Function to find which province is closest to the user's GPS location
function detectClosestProvince(userLatLng) {
  let closestProvince = null;
  let minDistance = Infinity;

  for (let province in globalTransportData) {
    let ambList = globalTransportData[province];
    if (!ambList || ambList.length === 0) continue;

    // Calculate center of the province based on its ambulance coordinates
    let avgLat = ambList.reduce((sum, item) => sum + item.pos[0], 0) / ambList.length;
    let avgLng = ambList.reduce((sum, item) => sum + item.pos[1], 0) / ambList.length;
    let provinceCenter = L.latLng(avgLat, avgLng);

    // Calculate distance in meters using Leaflet
    let distance = userLatLng.distanceTo(provinceCenter);
    if (distance < minDistance) {
      minDistance = distance;
      closestProvince = province;
    }
  }

  return closestProvince;
}

let loc = new L.circleMarker();
let locaccuracy = new L.circle();

map.on("dblclick", (e) => {
  if (locatingmanually) {
    map.removeLayer(loc);
    map.removeLayer(locaccuracy);
    loc = new L.circleMarker(e.latlng);
    map.addLayer(loc);
    
    // Check closest province for manual drop point as well
    let matchedProvince = detectClosestProvince(e.latlng);
    if (matchedProvince) {
      loadProvinceData(matchedProvince);
    }
    
    findingLocation = false;
  }
  locatingmanually = false;
});

let locfound = 0;
let locfoundaccuracy = 0;

function FindLocation() {
  if (locfound != 0 && !findingLocation) {
    map.removeLayer(loc);
    loc = new L.circleMarker(locfound)
      .bindPopup("Bạn đang ở khoảng " + locfoundaccuracy / 2 + " mét quanh điểm này")
      .openPopup();
    map.addLayer(loc);
    map.flyTo(locfound, 14);
    locaccuracy = new L.circle(locfound, locfoundaccuracy / 2);
    map.addLayer(locaccuracy);
  }

  if (findingLocation) {
    return;
  }

  findingLocation = true;
  map.locate({ setView: false, enableHighAccuracy: true, maxZoom: 30 });

  map.on("locationfound", (e) => {
    map.removeLayer(loc);
    loc = new L.circleMarker(e.latlng)
      .bindPopup("Bạn đang ở khoảng " + e.accuracy / 2 + " mét quanh điểm này")
      .openPopup();
    map.addLayer(loc);
    map.flyTo(e.latlng, 14);
    locaccuracy = new L.circle(e.latlng, e.accuracy / 2);
    map.addLayer(locaccuracy);
    
    locfound = e.latlng;
    locfoundaccuracy = e.accuracy;

    // DETECT PROVINCE & FILTER AMBULANCES AUTOMATICALLY
    let detectedProvince = detectClosestProvince(e.latlng);
    if (detectedProvince) {
      loadProvinceData(detectedProvince);
      console.log("User located in province:", detectedProvince);
    }
  });
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

// Road condition & speed profiles (km/h) for realistic ETA estimation in Vietnam & rural areas
const ROAD_PROFILES = {
  city: { avgSpeed: 30, trafficFactor: 1.4 },      // Dense traffic, frequent stops
  countryside: { avgSpeed: 22, terrainPenalty: 1.6 }, // Potholes, unpaved or narrow roads
  standard: { avgSpeed: 40, trafficFactor: 1.1 }   // Open highways / arterial roads
};

/**
 * Dynamically computes a smart ETA considering distance, traffic, and countryside road conditions.
 * Prioritizes fastest actual arrival time over shortest geographical path.
 */
function calculateSmartETA(distanceMeters, baseTimeSeconds, endLatLng) {
  let distanceKm = distanceMeters / 1000;
  
  // Detect countryside/rural routes based on lower density/outer coordinates (or fallback factor)
  let isRural = distanceKm > 5; // Example heuristic for outer/rural routing
  let profile = isRural ? ROAD_PROFILES.countryside : ROAD_PROFILES.city;

  // Base duration from routing engine
  let estimatedMinutes = baseTimeSeconds / 60;

  // Apply road condition and traffic multipliers
  if (isRural) {
    estimatedMinutes *= profile.terrainPenalty; // Account for potholes and unpaved conditions
  } else {
    estimatedMinutes *= profile.trafficFactor;  // Account for urban traffic congestion
  }

  return {
    distanceKm: distanceKm.toFixed(1),
    timeMins: Math.max(1, Math.round(estimatedMinutes))
  };
}

/**
 * Calculates distance & ETA immediately for ALL ambulances in the current list,
 * sorting them by fastest arrival time.
 */
function calculateAllAmbulancesETA(ambulanceData) {
  if (!locfound) return;

  let startLatLng = L.latLng(locfound.lat || locfound[0], locfound.lng || locfound[1]);

  let calculations = ambulanceData.map((amb, index) => {
    let endLatLng = L.latLng(amb.pos[0], amb.pos[1]);
    
    // Direct distance as fallback initial measure
    let distMeters = startLatLng.distanceTo(endLatLng);
    
    // Initial estimation with countryside/traffic weight applied
    let isRural = distMeters > 5000;
    let speed = isRural ? 22 : 30; // km/h
    let estHours = (distMeters / 1000) / speed;
    let estMins = Math.max(1, Math.round(estHours * 60));

    return {
      index: index,
      amb: amb,
      distanceKm: (distMeters / 1000).toFixed(1),
      timeMins: estMins,
      rawMins: estHours * 60 // Used for strict sorting by time
    };
  });

  // Sort ambulances by FASTEST ETA first (prioritizing time over raw distance)
  calculations.sort((a, b) => a.rawMins - b.rawMins);

  // Update sidebar UI immediately with computed times
  updateAmbulanceListUIWithETA(calculations);
}

/**
 * Draw route line on map for the selected ambulance
 */
function RouteToAmbulance(ambulancePos, ambulanceName, cardElement) {
  if (!locfound) {
    alert("Vui lòng bấm 'Tự động định vị' hoặc 'Chọn thủ công' trước để chọn điểm xuất phát!");
    return;
  }

  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }

  let startLatLng = L.latLng(locfound.lat || locfound[0], locfound.lng || locfound[1]);
  let endLatLng = L.latLng(ambulancePos[0], ambulancePos[1]);

  activeCardElement = cardElement;

  routingControl = L.Routing.control({
    waypoints: [startLatLng, endLatLng],
    routeWhileDragging: false,
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: true,
    showAlternatives: false,
    createMarker: function() { return null; },
    lineOptions: {
      styles: [{ color: '#3b82f6', opacity: 0.9, weight: 6 }]
    }
  });

  routingControl.on('routesfound', function(e) {
    let summary = e.routes[0].summary;
    let smartMetrics = calculateSmartETA(summary.totalDistance, summary.totalTime, endLatLng);

    // Update active card subtext
    if (activeCardElement) {
      let subSpan = activeCardElement.querySelector('.card-sub');
      if (subSpan) {
        subSpan.innerHTML = `⚡ ${smartMetrics.timeMins} phút (${smartMetrics.distanceKm} km)`;
        subSpan.style.color = '#22c55e';
      }
    }

    // Update floating Info Box
    let etaBox = document.getElementById('ambinfoboxeta');
    if (etaBox) {
      etaBox.innerHTML = `⏱️ Dự kiến: <b>${smartMetrics.timeMins} phút</b> | 📏 Khoảng cách: <b>${smartMetrics.distanceKm} km</b><br><small style="opacity: 0.75;">(Đã bao gồm tình trạng đường & giao thông)</small>`;
    }
  });

  routingControl.addTo(map);
}
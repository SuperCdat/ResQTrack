
let locatingmanually = false;
let findingLocation = false;
let globalTransportData = {};
let currentMarkers = [];
let ambulanceIcon;

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
      title: data[i].name,
      icon: ambulanceIcon
    });

    marker.bindTooltip(`${provinceName} - ${data[i].name}`, {
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

  locfound = L.latLng(latlng);
  locfoundaccuracy = accuracy || 0;

  loc = L.circleMarker(locfound);

  if (accuracy && accuracy > 0) {
    loc.bindPopup(
      "Bạn đang ở khoảng " + Math.round(accuracy) + " mét quanh điểm này"
    );

    locaccuracy = L.circle(locfound, {
      radius: accuracy
    });

    map.addLayer(locaccuracy);
  } else {
    loc.bindPopup("Đây là vị trí xuất phát bạn đã chọn thủ công.");
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

    alert(
      "Không thể xác định vị trí của bạn. " +
      "Vui lòng kiểm tra quyền truy cập vị trí hoặc chọn thủ công."
    );

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
    timeMins: Math.max(1, Math.round(estimatedMinutes))
  };
}

function calculateAllAmbulancesETA(ambulanceData) {
  if (!locfound) return;

  let startLatLng = L.latLng(locfound.lat, locfound.lng);

  let calculations = ambulanceData.map((amb, index) => {
    let endLatLng = L.latLng(amb.pos[0], amb.pos[1]);

    let distMeters = startLatLng.distanceTo(endLatLng);
    let isRural = distMeters > 5000;
    let speed = isRural ? 22 : 30;

    let estHours = (distMeters / 1000) / speed;
    let estMins = Math.max(1, Math.round(estHours * 60));

    return {
      index: index,
      amb: amb,
      distanceKm: (distMeters / 1000).toFixed(1),
      timeMins: estMins,
      rawMins: estHours * 60
    };
  });

  calculations.sort((a, b) => a.rawMins - b.rawMins);

  updateAmbulanceListUIWithETA(calculations);
}

function RouteToAmbulance(ambulancePos, ambulanceName, cardElement) {
  if (!locfound) {
    alert(
      "Vui lòng bấm 'Tự động định vị' hoặc " +
      "'Chọn thủ công' trước để chọn điểm xuất phát!"
    );
    return;
  }

  if (!L.Routing) {
    alert("Không thể tải thư viện tìm đường. Vui lòng thử lại sau.");
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

    if (activeCardElement) {
      let subSpan = activeCardElement.querySelector('.card-sub');

      if (subSpan) {
        subSpan.innerHTML =
          `⚡ ${smartMetrics.timeMins} phút ` +
          `(${smartMetrics.distanceKm} km)`;

        subSpan.style.color = '#22c55e';
      }
    }

    let etaBox = document.getElementById('ambinfoboxeta');

    if (etaBox) {
      etaBox.innerHTML =
        `⏱️ Dự kiến: <b>${smartMetrics.timeMins} phút</b> | ` +
        `📏 Khoảng cách: <b>${smartMetrics.distanceKm} km</b>` +
        `<br><small style="opacity: 0.75;">` +
        `(Thời gian ước tính, chưa có dữ liệu giao thông trực tiếp)` +
        `</small>`;
    }
  });

  routingControl.addTo(map);
}

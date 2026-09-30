function ZoomIn() {
  map.zoomIn();
}
function ZoomOut() {
  map.zoomOut();
}

let mapOptions = {
  center:[10.38399, 105.43734],
  zoom: 10,
  zoomControl: false,
}

let map = new L.map('map', mapOptions);

map.locate({setView: true, enableHighAccuracy: true, maxZoom: 30});

map.on('locationfound', (e)=>{
  console.log(e.latlng);
  L.circleMarker(e.latlng).addTo(map).bindPopup("Bạn đang ở khoảng " + e.accuracy/2 + " mét quanh điểm này").openPopup();
  L.circle(e.latlng, e.accuracy/2).addTo(map);
})

let layer = new L.TileLayer('http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: '© OpenStreetMap contributors'});
map.addLayer(layer);

fetch('./transportationdata.json')
  .then(response => response.json())
  .then(data => {
    addAmblist(data);
    for (let i=0; i<data.length; i++) {
      let marker = new L.Marker(data[i].pos, {title: data[i].name});
      marker.bindTooltip(data[i].name, {direction: 'bottom', permanent: true});
      marker.addTo(map);
    }
  })
  .catch(error => console.error(error));


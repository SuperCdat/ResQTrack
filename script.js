let locatingmanually = false;
let findingLocation = false;



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
  center:[10.38399, 105.43734],
  zoom: 10,
  zoomControl: false,
}

let map = new L.map("map", mapOptions);



let layer = new L.TileLayer("http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {attribution: "© OpenStreetMap contributors"});
map.addLayer(layer);

fetch("./transportationdata.json")
  .then(response => response.json())
  .then(dataraw => {
    let data = dataraw["Cần Thơ"];
    addAmblist(data);
    for (let i=0; i<data.length; i++) {
      let marker = new L.Marker(data[i].pos, {title: data[i].name});
      marker.bindTooltip(data[i].name, {direction: "bottom", permanent: true});
      marker.addTo(map);
    }
  })
  .catch(error => console.error(error));




let loc = new L.circleMarker();
let locaccuracy = new L.circle();
map.on("dblclick", (e) => {
  if (locatingmanually) {
    map.removeLayer(loc);
    map.removeLayer(locaccuracy);
    loc = new L.circleMarker(e.latlng);
    map.addLayer(loc);
  }
  locatingmanually = false;
});

function FindLocation() {
  if (findingLocation) {
    return;
  }
  
  findingLocation = true;
  map.locate({setView: true, enableHighAccuracy: true, maxZoom: 30});
  

  map.on("locationfound", (e)=>{
    map.removeLayer(loc);
    console.log(e.latlng);
    loc = new L.circleMarker(e.latlng).bindPopup("Bạn đang ở khoảng " + e.accuracy/2 + " mét quanh điểm này").openPopup();
    map.addLayer(loc);
    locaccuracy = new L.circle(e.latlng, e.accuracy/2);
    map.addLayer(locaccuracy);
  })
}
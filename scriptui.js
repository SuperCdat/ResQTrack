function addAmblist(data) {
  // Store reference to raw data
  window.currentAmbulanceData = data;
  
  if (typeof locfound !== 'undefined' && locfound) {
    // If location is already known, immediately calculate and sort by ETA
    calculateAllAmbulancesETA(data);
  } else {
    // Standard rendering when location isn't set yet
    renderAmbulanceCards(data.map(item => ({ amb: item, timeMins: null, distanceKm: null })));
  }
}

function updateAmbulanceListUIWithETA(calculatedList) {
  renderAmbulanceCards(calculatedList);
}

function renderAmbulanceCards(itemList) {
  let amblist = document.getElementById("amblist");
  let ambinfoboxname = document.getElementById("ambinfoboxname");
  let ambinfoboxphonenumber = document.getElementById("ambinfoboxphonenumber");
  let etaBox = document.getElementById("ambinfoboxeta");
  let infobox = document.getElementById("ambinfobox");
  let callBtn = document.getElementById("call-btn");

  amblist.innerHTML = "";

  itemList.forEach((itemObj) => {
    let thisdata = itemObj.amb;
    
    let card = document.createElement("div");
    card.className = "amb-card";
    
    let iconSpan = document.createElement("div");
    iconSpan.className = "card-icon";
    iconSpan.innerHTML = "🚑";
    card.appendChild(iconSpan);

    let infoDiv = document.createElement("div");
    infoDiv.className = "card-info";
    
    let title = document.createElement("h3");
    title.innerHTML = thisdata.name;
    infoDiv.appendChild(title);

    let subtitle = document.createElement("span");
    subtitle.className = "card-sub";
    
    // Display instant calculated ETA if location is set
    if (itemObj.timeMins !== null) {
      subtitle.innerHTML = `⏱️ ${itemObj.timeMins} phút • ${itemObj.distanceKm} km`;
      subtitle.style.color = "#3b82f6";
    } else {
      subtitle.innerHTML = "Nhấn để chỉ đường";
    }
    infoDiv.appendChild(subtitle);
    
    card.appendChild(infoDiv);

    card.onclick = () => {
      map.flyTo(thisdata.pos, 15, { animate: true, duration: 1.2 });
      ambinfoboxname.innerHTML = thisdata.name;
      ambinfoboxphonenumber.innerHTML = "Sđt: " + thisdata.phonenumber;
      if (etaBox) {
        etaBox.innerHTML = itemObj.timeMins 
          ? `⏱️ Dự kiến: <b>${itemObj.timeMins} phút</b> | 📏 Khoảng cách: <b>${itemObj.distanceKm} km</b>`
          : "⏱️ Đang tính toán đường đi...";
      }
      
      infobox.classList.remove("hidden");
      if (callBtn) {
        callBtn.style.display = "flex";
        callBtn.href = "tel:" + thisdata.phonenumber;
      }

      if (typeof RouteToAmbulance === 'function') {
        RouteToAmbulance(thisdata.pos, thisdata.name, card);
      }
    };

    amblist.appendChild(card);
  });
}
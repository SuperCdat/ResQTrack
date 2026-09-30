function addAmblist(data) {
  let amblist = document.getElementById("amblist");
  for (let i=0; i<data.length; i++) {
    let div = document.createElement("div");
    div.style.minWidth = "calc(100% - 40px)";
    div.style.height = "70px";
    div.style.zIndex = "1001";
    div.style.backgroundColor = "red";
    div.style.padding = "15px 20px 15px 20px";
    amblist.appendChild(div);
    let title = document.createElement("h3");
    div.appendChild(title);
    title.innerHTML = data[i].name;
    title.style.margin = 0;
  }
}
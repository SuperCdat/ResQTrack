
/*
 * ResQTrack - scriptui.js
 * Quản lý danh sách xe cứu thương và Info Box.
 *
 * Tương thích với:
 * - script.js
 * - index.html
 * - transportationdata.json
 */

let currentAmbulanceData = [];

// =====================================================
// 1. HIỂN THỊ DANH SÁCH XE CỨU THƯƠNG
// =====================================================

function addAmblist(data) {
    const listElement = document.getElementById("amblist");

    if (!listElement) {
        console.error("Không tìm thấy phần tử #amblist.");
        return;
    }

    if (!Array.isArray(data)) {
        console.error("Dữ liệu xe cứu thương không hợp lệ:", data);
        renderAmbulanceCards([]);
        return;
    }

    currentAmbulanceData = data;
    window.currentAmbulanceData = data;

    // Nếu đã có vị trí xuất phát thì tính ETA sơ bộ.
    if (typeof locfound !== "undefined" && locfound) {
        calculateAllAmbulancesETA(data);
    } else {
        renderAmbulanceCards(data);
    }
}


// =====================================================
// 2. CẬP NHẬT DANH SÁCH SAU KHI TÍNH ETA
// =====================================================

function updateAmbulanceListUIWithETA(calculations) {
    if (!Array.isArray(calculations)) {
        console.error("Dữ liệu ETA không hợp lệ:", calculations);
        return;
    }

    renderAmbulanceCards(calculations);
}


// =====================================================
// 3. TẠO THẺ XE CỨU THƯƠNG
// =====================================================

function renderAmbulanceCards(data) {
    const listElement = document.getElementById("amblist");

    if (!listElement) {
        console.error("Không tìm thấy phần tử #amblist.");
        return;
    }

    listElement.replaceChildren();

    if (!Array.isArray(data) || data.length === 0) {
        const emptyMessage = document.createElement("div");

        emptyMessage.className = "empty-message";
        emptyMessage.textContent =
            "Không tìm thấy xe cứu thương trong khu vực này.";

        listElement.appendChild(emptyMessage);
        return;
    }

    data.forEach((item) => {
        // Hỗ trợ cả dữ liệu gốc và dữ liệu đã tính ETA.
        const ambulance = item.amb || item;

        if (!ambulance || !Array.isArray(ambulance.pos)) {
            console.warn("Bỏ qua dữ liệu xe không hợp lệ:", item);
            return;
        }

        const card = document.createElement("div");
        card.className = "amb-card";

        const icon = document.createElement("div");
        icon.className = "card-icon";
        icon.textContent = "🚑";

        const info = document.createElement("div");
        info.className = "card-info";

        const name = document.createElement("div");
        name.className = "card-name";
        name.textContent = ambulance.name || "Xe cứu thương";

        const sub = document.createElement("div");
        sub.className = "card-sub";

        if (
            typeof item.timeMins === "number" &&
            typeof item.distanceKm !== "undefined"
        ) {
            sub.textContent =
                `⚡ ${item.timeMins} phút (${item.distanceKm} km)`;
        } else {
            sub.textContent = "Chọn để xem thông tin và tuyến đường";
        }

        info.appendChild(name);
        info.appendChild(sub);

        card.appendChild(icon);
        card.appendChild(info);

        // Lưu thông tin xe để xử lý khi người dùng chọn.
        card.addEventListener("click", () => {
            selectAmbulance(ambulance, card);
        });

        listElement.appendChild(card);
    });
}


// =====================================================
// 4. CHỌN XE VÀ HIỂN THỊ INFO BOX
// =====================================================

function selectAmbulance(ambulance, cardElement) {
    if (!ambulance || !Array.isArray(ambulance.pos)) {
        console.error("Thông tin xe không hợp lệ:", ambulance);
        return;
    }

    // Đánh dấu thẻ đang được chọn.
    document.querySelectorAll(".amb-card").forEach(card => {
        card.classList.remove("active");
    });

    cardElement.classList.add("active");

    // Di chuyển bản đồ đến vị trí xe.
    map.flyTo(ambulance.pos, Math.max(map.getZoom(), 14));

    // Cập nhật tên xe.
    const nameElement = document.getElementById("ambinfoboxname");

    if (nameElement) {
        nameElement.textContent = ambulance.name || "Xe cứu thương";
    }

    // Cập nhật số điện thoại.
    const phoneElement = document.getElementById("ambinfoboxphonenumber");

    if (phoneElement) {
        phoneElement.textContent = ambulance.phonenumber || "Chưa có số điện thoại";
    }

    // Hiển thị nút gọi điện.
    const callButton = document.getElementById("call-btn");

    if (callButton) {
        if (ambulance.phonenumber) {
            callButton.href = "tel:" + ambulance.phonenumber;
            callButton.style.display = "inline-block";
        } else {
            callButton.style.display = "none";
            callButton.removeAttribute("href");
        }
    }

    // Hiển thị Info Box.
    const infoBox = document.getElementById("ambinfobox");

    if (infoBox) {
        infoBox.classList.remove("hidden");
        infoBox.style.display = "block";
    }

    // Cập nhật trạng thái ETA.
    const etaElement = document.getElementById("ambinfoboxeta");

    if (etaElement) {
        etaElement.textContent = "Đang tính toán tuyến đường...";
    }

    // Tìm đường đến xe cứu thương.
    RouteToAmbulance(
        ambulance.pos,
        ambulance.name,
        cardElement
    );
}


// =====================================================
// 5. ĐÓNG INFO BOX
// =====================================================

function CloseInfoBox() {
    const infoBox = document.getElementById("ambinfobox");

    if (!infoBox) {
        console.warn("Không tìm thấy Info Box.");
        return;
    }

    infoBox.style.display = "none";

    // Bỏ trạng thái chọn trên danh sách.
    document.querySelectorAll(".amb-card").forEach(card => {
        card.classList.remove("active");
    });
}

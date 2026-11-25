let currentAmbulanceData = [];

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

    if (typeof locfound !== "undefined" && locfound) {
        calculateAllAmbulancesETA(data, true);
    } else {
        renderAmbulanceCards(data, true);
    }
}

function updateAmbulanceListUIWithETA(calculations, preserveSelection = false) {
    if (!Array.isArray(calculations)) {
        console.error("Dữ liệu ETA không hợp lệ:", calculations);
        return;
    }

    renderAmbulanceCards(calculations, preserveSelection);
}

function getEquipmentBadgeList(equipment) {
    if (!equipment || typeof equipment !== "object") return [];

    const badges = [];
    if (equipment.doctor) badges.push(t("badge_doctor"));
    if (equipment.paramedic) badges.push(t("badge_paramedic"));
    if (equipment.ventilator) badges.push(t("badge_ventilator"));
    if (equipment.aed) badges.push(t("badge_aed"));
    if (equipment.trauma) badges.push(t("badge_trauma"));
    if (equipment.infusion) badges.push(t("badge_infusion"));

    const beds = parseInt(equipment.beds, 10);
    if (Number.isFinite(beds) && beds > 0) {
        badges.push(t("badge_beds", { n: beds }));
    }

    return badges;
}

function renderAmbulanceCards(data, preserveSelection = false) {
    const listElement = document.getElementById("amblist");

    if (!listElement) {
        console.error("Không tìm thấy phần tử #amblist.");
        return;
    }

    listElement.replaceChildren();
    activeCardElement = null;

    if (!Array.isArray(data) || data.length === 0) {
        const emptyMessage = document.createElement("div");

        emptyMessage.className = "empty-message";
        emptyMessage.textContent = t("empty_list");

        listElement.appendChild(emptyMessage);
        return;
    }

    data.forEach((item) => {
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
        name.textContent = localizeName(ambulance.name) || t("default_amb_name");

        const sub = document.createElement("div");
        sub.className = "card-sub";

        if (item.pending) {
            sub.textContent = t("card_calculating");
        } else if (
            typeof item.timeMins === "number" &&
            typeof item.distanceKm !== "undefined"
        ) {
            sub.textContent = (item.approx ? "~ " : "") + t("card_eta", {
                min: item.timeMins,
                km: item.distanceKm
            });
        } else {
            sub.textContent = t("card_hint");
        }

        info.appendChild(name);
        info.appendChild(sub);

        const eqSummary = getEquipmentBadgeList(ambulance.equipment);
        if (eqSummary.length > 0) {
            const eqLine = document.createElement("div");
            eqLine.className = "card-eq";
            eqLine.textContent = eqSummary.slice(0, 3).join(" • ");
            info.appendChild(eqLine);
        }

        const isSelected = preserveSelection && selectedAmbulance && (
            ambulance === selectedAmbulance ||
            (ambulance.id && selectedAmbulance.id && ambulance.id === selectedAmbulance.id) ||
            (ambulance.name && selectedAmbulance.name && ambulance.name === selectedAmbulance.name)
        );

        if (isSelected) {
            card.classList.add("active");
            activeCardElement = card;

            if (lastRouteMetrics) {
                sub.textContent = t("card_eta", {
                    min: lastRouteMetrics.timeMins,
                    km: lastRouteMetrics.distanceKm
                });
                sub.style.color = "var(--success)";
            }
        }

        card.appendChild(icon);
        card.appendChild(info);

        card.addEventListener("click", () => {
            selectAmbulance(ambulance, card);
        });

        listElement.appendChild(card);
    });
}

function renderEquipmentBadges(eqElement, equipment) {
    if (!eqElement) return;
    eqElement.replaceChildren();

    const badges = getEquipmentBadgeList(equipment);
    badges.forEach((label) => {
        const span = document.createElement("span");
        span.className = "badge-item";
        span.textContent = label;
        eqElement.appendChild(span);
    });
}

function renderInfoBox() {
    const nameElement = document.getElementById("ambinfoboxname");
    const phoneElement = document.getElementById("ambinfoboxphonenumber");
    const eqElement = document.getElementById("ambequipment");
    const etaElement = document.getElementById("ambinfoboxeta");
    const callButton = document.getElementById("call-btn");

    const amb = selectedAmbulance;

    if (nameElement) {
        nameElement.textContent = amb
            ? (localizeName(amb.name) || t("default_amb_name"))
            : t("info_select_title");
    }

    if (phoneElement) {
        if (!amb) {
            phoneElement.textContent = t("phone_placeholder");
        } else if (amb.phonenumber) {
            phoneElement.textContent = t("phone_label", { phone: amb.phonenumber });
        } else {
            phoneElement.textContent = t("phone_none");
        }
    }

    renderEquipmentBadges(eqElement, amb ? amb.equipment : null);

    if (etaElement) {
        if (!amb) {
            etaElement.textContent = t("eta_idle");
        } else if (lastRouteMetrics) {
            etaElement.innerHTML = t("eta_detail", {
                min: lastRouteMetrics.timeMins,
                km: lastRouteMetrics.distanceKm
            });
        } else {
            etaElement.textContent = t("eta_calculating");
        }
    }

    if (callButton) {
        if (amb && amb.phonenumber) {
            callButton.href = "tel:" + amb.phonenumber;
            callButton.style.display = "flex";
        } else {
            callButton.style.display = "none";
            callButton.removeAttribute("href");
        }
    }
}

function selectAmbulance(ambulance, cardElement) {
    if (!ambulance || !Array.isArray(ambulance.pos)) {
        console.error("Thông tin xe không hợp lệ:", ambulance);
        return;
    }

    document.querySelectorAll(".amb-card").forEach(card => {
        card.classList.remove("active");
    });

    cardElement.classList.add("active");
    activeCardElement = cardElement;

    map.flyTo(ambulance.pos, Math.max(map.getZoom(), 14));

    selectedAmbulance = ambulance;
    lastRouteMetrics = null;
    renderInfoBox();

    const infoBox = document.getElementById("ambinfobox");

    if (infoBox) infoBox.classList.remove("hidden");
    document.body.classList.add("has-info");

    if (window.innerWidth <= 768) {
        const menu = document.getElementById("mainmenu");
        if (menu) menu.classList.remove("expanded");
    }

    RouteToAmbulance(
        ambulance.pos,
        ambulance.name,
        cardElement
    );
}

function CloseInfoBox() {
    const infoBox = document.getElementById("ambinfobox");

    if (!infoBox) {
        console.warn("Không tìm thấy Info Box.");
        return;
    }

    infoBox.classList.add("hidden");
    document.body.classList.remove("has-info");

    selectedAmbulance = null;
    lastRouteMetrics = null;
    activeCardElement = null;

    document.querySelectorAll(".amb-card").forEach(card => {
        card.classList.remove("active");
    });
}

function refreshLanguageUI() {
    applyStaticTranslations();
    updateLangButton();

    if (currentAmbulanceData.length > 0) {
        if (typeof locfound !== "undefined" && locfound) {
            calculateAllAmbulancesETA(currentAmbulanceData, true);
        } else {
            renderAmbulanceCards(currentAmbulanceData, true);
        }
    }

    renderInfoBox();

    if (typeof refreshMapTexts === "function") {
        refreshMapTexts();
    }
}

applyStaticTranslations();
updateLangButton();
renderInfoBox();
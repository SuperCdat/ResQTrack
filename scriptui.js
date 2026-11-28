let currentAmbulanceData = [];

const CARE_ICONS = {
    oxygen: "🫧",
    aed: "⚡",
    ecg: "💓",
    suction: "🩺",
    ventilator: "🫁",
    splint: "🦴"
};

const CARE_NOTES_SOURCE_LANG = "vi";

const careNotesCache = {};

async function translateFree(text, sourceLang, targetLang) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.responseData.translatedText;
}

function decodeHtmlEntities(text) {
    const el = document.createElement("textarea");
    el.innerHTML = text;
    return el.value;
}

async function translateCareNotes(text) {
    if (!text) return null;
    if (currentLang === CARE_NOTES_SOURCE_LANG) return null;

    const key = currentLang + "|" + text;
    if (careNotesCache[key]) return careNotesCache[key];

    try {
        const raw = await translateFree(text, CARE_NOTES_SOURCE_LANG, currentLang);
        if (typeof raw !== "string") return null;

        // MyMemory signals quota/input errors in the payload with HTTP 200.
        const trimmed = raw.trim();
        if (!trimmed) return null;
        if (/^MYMEMORY WARNING/i.test(trimmed)) return null;
        if (/INVALID/i.test(trimmed) && trimmed.length < 80) return null;

        const decoded = decodeHtmlEntities(trimmed);
        if (decoded === text) return null; // no-op translation

        careNotesCache[key] = decoded;
        return decoded;
    } catch (e) {
        console.warn("Care notes translation failed:", e);
        return null;
    }
}

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
            }
        }

        info.appendChild(name);
        info.appendChild(sub);

        const chevron = document.createElement("span");
        chevron.className = "card-chevron";
        chevron.setAttribute("aria-hidden", "true");
        chevron.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="9 18 15 12 9 6"></polyline></svg>';

        card.appendChild(icon);
        card.appendChild(info);
        card.appendChild(chevron);

        card.addEventListener("click", () => {
            selectAmbulance(ambulance, card);
        });

        listElement.appendChild(card);
    });
}

function renderCareInfo(amb) {
    const box = document.getElementById("ambinfoboxcare");
    if (!box) return;

    box.replaceChildren();

    const care = amb && amb.care;
    const equipment = ((care && care.equipment) || []).filter((k) => CARE_EQUIPMENT.includes(k));
    const meds = ((care && care.meds) || []).filter((m) => m && m.name);
    const notes = (care && care.notes) || "";
    const hasOxygen = !!(care && care.oxygen);

    if (!hasOxygen && !equipment.length && !meds.length && !notes) {
        box.hidden = true;
        return;
    }

    // Everything below is driver-supplied: textContent only, never innerHTML.
    const add = (tag, className, text) => {
        const el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = text;
        return el;
    };

    box.appendChild(add("div", "care-title", t("care_user_title")));

    if (hasOxygen || equipment.length) {
        const chips = document.createElement("div");
        chips.className = "care-chips";
        if (hasOxygen) {
            chips.appendChild(add("span", "care-chip", (CARE_ICONS.oxygen || "") + " " + t("care_oxygen")));
        }
        equipment.forEach((k) => {
            const icon = CARE_ICONS[k] || "";
            chips.appendChild(add("span", "care-chip", icon + " " + t("equip_" + k)));
        });
        box.appendChild(chips);
    }

    if (meds.length) {
        box.appendChild(add("div", "care-sub", t("care_meds_user")));
        const ul = document.createElement("ul");
        ul.className = "care-meds";
        meds.forEach((m) => {
            const li = document.createElement("li");
            li.appendChild(add("b", "", m.name));
            if (m.for) li.appendChild(document.createTextNode(" – " + m.for));
            ul.appendChild(li);
        });
        box.appendChild(ul);
    }

    if (notes) {
        const notesEl = add("p", "care-text", notes);
        box.appendChild(notesEl);

        // Show the original immediately, swap to the translation when it arrives.
        // If the panel re-rendered or was closed meanwhile, isConnected is false
        // and the stale promise result is dropped.
        translateCareNotes(notes).then((translated) => {
            if (translated && notesEl.isConnected) {
                notesEl.textContent = translated;
            }
        });
    }

    box.hidden = false;
}

function renderInfoBox() {
    const nameElement = document.getElementById("ambinfoboxname");
    const phoneElement = document.getElementById("ambinfoboxphonenumber");
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

    renderCareInfo(amb);

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

    if (routingControl) {
        map.removeControl(routingControl);
        routingControl = null;
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

/* ---- Pothole verify toast (driver, near an active pothole) ---- */

let activePotholeToast = null;

function showPotholeVerifyToast(province, pothole, distanceM) {
  if (activePotholeToast && activePotholeToast.dataset.pid === pothole.id) return;
  dismissPotholeToast();

  const toast = document.createElement("div");
  toast.className = "pothole-toast";
  toast.dataset.pid = pothole.id;

  const title = document.createElement("div");
  title.className = "pt-title";
  title.textContent = t("pothole_toast_title", { m: distanceM });

  const actions = document.createElement("div");
  actions.className = "pt-actions";

  const still = document.createElement("button");
  still.type = "button";
  still.className = "text-btn";
  still.textContent = t("pothole_still_there");
  still.onclick = async () => {
    setPotholeCooldown(pothole.id);
    try { await window.potholeApi.verifyStillThere(province, pothole.id); } catch (e) {}
    dismissPotholeToast();
  };

  const fixed = document.createElement("button");
  fixed.type = "button";
  fixed.className = "action-btn";
  fixed.style.height = "32px";
  fixed.style.padding = "0 14px";
  fixed.textContent = t("pothole_fixed");
  fixed.onclick = async () => {
    setPotholeCooldown(pothole.id);
    try { await window.potholeApi.remove(province, pothole.id); } catch (e) {}
    dismissPotholeToast();
  };

  const close = document.createElement("button");
  close.type = "button";
  close.className = "close-btn";
  close.textContent = "✕";
  close.onclick = () => {
    setPotholeCooldown(pothole.id);
    dismissPotholeToast();
  };

  actions.append(still, fixed, close);
  toast.append(title, actions);
  document.body.appendChild(toast);
  activePotholeToast = toast;

  toast._timer = setTimeout(() => {
    setPotholeCooldown(pothole.id);
    dismissPotholeToast();
  }, 20000);
}

function dismissPotholeToast() {
  if (!activePotholeToast) return;
  if (activePotholeToast._timer) clearTimeout(activePotholeToast._timer);
  activePotholeToast.remove();
  activePotholeToast = null;
}